from datetime import date, datetime
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from database import get_db
from models import MealPlan, MealPlanDay, Meal, MealIngredient, ShoppingList
from services.costs import latest_snapshots, cost_meal
from services.planning import generate_plan

router = APIRouter(prefix="/plans", tags=["plans"])


class GeneratePlanRequest(BaseModel):
    start_date: date
    days: int
    person_ids: list[int]
    per_day_persons: list[list[int]] | None = None
    meat_days: int | None = None
    budget_eur: float | None = None
    name: str | None = None


class PlanDayOut(BaseModel):
    id: int
    date: date
    meal_id: int | None
    meal_name: str | None
    persons: list[int]
    portions: int
    is_leftovers: bool
    notes: str | None

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_day(cls, day: MealPlanDay) -> "PlanDayOut":
        return cls(
            id=day.id,
            date=day.date,
            meal_id=day.meal_id,
            meal_name=day.meal.name if day.meal else None,
            persons=day.persons,
            portions=day.portions,
            is_leftovers=day.is_leftovers,
            notes=day.notes,
        )


class MealPlanOut(BaseModel):
    id: int
    name: str | None
    created_at: datetime
    start_date: date
    days: int
    budget_eur: Decimal | None
    meat_days: int | None
    plan_days: list[PlanDayOut]

    model_config = {"from_attributes": True}


async def _load_plan(db: AsyncSession, plan_id: int) -> MealPlan:
    result = await db.execute(
        select(MealPlan)
        .options(
            selectinload(MealPlan.plan_days).selectinload(MealPlanDay.meal)
        )
        .where(MealPlan.id == plan_id)
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(404, "Plan not found")
    return plan


@router.get("/", response_model=list[MealPlanOut])
async def list_plans(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MealPlan)
        .options(selectinload(MealPlan.plan_days).selectinload(MealPlanDay.meal))
        .order_by(MealPlan.created_at.desc())
    )
    plans = result.scalars().all()
    return [_plan_to_out(p) for p in plans]


@router.post("/generate", response_model=MealPlanOut, status_code=201)
async def generate(body: GeneratePlanRequest, db: AsyncSession = Depends(get_db)):
    days_data = await generate_plan(
        db=db,
        start_date=body.start_date,
        days=body.days,
        person_ids=body.person_ids,
        meat_days=body.meat_days,
        budget_eur=body.budget_eur,
        per_day_persons=body.per_day_persons,
    )
    plan = MealPlan(
        name=body.name,
        start_date=body.start_date,
        days=body.days,
        budget_eur=body.budget_eur,
        meat_days=body.meat_days,
    )
    db.add(plan)
    await db.flush()

    for d in days_data:
        day = MealPlanDay(
            plan_id=plan.id,
            date=date.fromisoformat(d["date"]),
            meal_id=d["meal_id"],
            persons=d["persons"],
            portions=d["portions"],
            is_leftovers=d["is_leftovers"],
        )
        db.add(day)

    await db.commit()
    return _plan_to_out(await _load_plan(db, plan.id))


class PlanDayCost(BaseModel):
    day_id: int
    date: date
    meal_name: str | None
    portions: int
    cost: Decimal
    unpriced: int
    is_leftovers: bool


class PlanCost(BaseModel):
    plan_id: int
    total: Decimal
    per_portion: Decimal | None
    per_day: list[PlanDayCost]
    unpriced: int
    budget_eur: Decimal | None
    over_budget: bool | None
    shopping_total: Decimal | None  # whole packs on the latest generated shopping list


@router.get("/{plan_id}/cost", response_model=PlanCost)
async def plan_cost(plan_id: int, db: AsyncSession = Depends(get_db)):
    plan = await _load_plan(db, plan_id)
    meal_ids = {d.meal_id for d in plan.plan_days if d.meal_id}
    meals = {}
    if meal_ids:
        rows = await db.execute(
            select(Meal).options(selectinload(Meal.ingredients).selectinload(MealIngredient.product))
            .where(Meal.id.in_(meal_ids))
        )
        meals = {m.id: m for m in rows.scalars().all()}
    snaps = await latest_snapshots(db, {i.product_id for m in meals.values() for i in m.ingredients if i.product_id})

    per_day: list[PlanDayCost] = []
    total = Decimal(0)
    unpriced = 0
    portions_total = 0
    for d in plan.plan_days:
        cost, un = Decimal(0), 0
        meal = meals.get(d.meal_id) if d.meal_id else None
        if meal and not d.is_leftovers:
            mc = cost_meal(meal, d.portions, snaps, with_lines=False)
            cost, un = mc.total, mc.unpriced
            portions_total += d.portions
        total += cost
        unpriced += un
        per_day.append(PlanDayCost(
            day_id=d.id, date=d.date, meal_name=meal.name if meal else None,
            portions=d.portions, cost=cost, unpriced=un, is_leftovers=d.is_leftovers,
        ))
    total = round(total, 2)
    shopping_total = (await db.execute(
        select(ShoppingList.total_estimated).where(ShoppingList.plan_id == plan_id)
        .order_by(ShoppingList.generated_at.desc(), ShoppingList.id.desc()).limit(1)
    )).scalar_one_or_none()
    return PlanCost(
        plan_id=plan_id, total=total,
        per_portion=round(total / portions_total, 2) if portions_total else None,
        per_day=per_day, unpriced=unpriced, budget_eur=plan.budget_eur,
        over_budget=(total > plan.budget_eur) if plan.budget_eur else None,
        shopping_total=shopping_total,
    )


@router.get("/{plan_id}", response_model=MealPlanOut)
async def get_plan(plan_id: int, db: AsyncSession = Depends(get_db)):
    return _plan_to_out(await _load_plan(db, plan_id))


class UpdateDayRequest(BaseModel):
    meal_id: int | None = None
    clear_meal: bool = False
    notes: str | None = None
    is_leftovers: bool | None = None
    persons: list[int] | None = None


@router.patch("/{plan_id}/days/{day_id}", response_model=PlanDayOut)
async def update_day(
    plan_id: int,
    day_id: int,
    body: UpdateDayRequest,
    db: AsyncSession = Depends(get_db),
):
    day = await db.get(MealPlanDay, day_id)
    if not day or day.plan_id != plan_id:
        raise HTTPException(404, "Day not found")
    if body.clear_meal:
        day.meal_id = None
    elif body.meal_id is not None:
        day.meal_id = body.meal_id
    if body.notes is not None:
        day.notes = body.notes
    if body.is_leftovers is not None:
        day.is_leftovers = body.is_leftovers
    if body.persons is not None:
        day.persons = body.persons
    await db.commit()
    result = await db.execute(
        select(MealPlanDay)
        .options(selectinload(MealPlanDay.meal))
        .where(MealPlanDay.id == day_id)
    )
    return PlanDayOut.from_orm_day(result.scalar_one())


class UpdatePlanRequest(BaseModel):
    name: str | None = None
    budget_eur: float | None = None
    meat_days: int | None = None


@router.patch("/{plan_id}", response_model=MealPlanOut)
async def update_plan(plan_id: int, body: UpdatePlanRequest, db: AsyncSession = Depends(get_db)):
    plan = await db.get(MealPlan, plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    if body.name is not None:
        plan.name = body.name
    if body.budget_eur is not None:
        plan.budget_eur = body.budget_eur
    if body.meat_days is not None:
        plan.meat_days = body.meat_days
    await db.commit()
    return _plan_to_out(await _load_plan(db, plan_id))


@router.delete("/{plan_id}", status_code=204)
async def delete_plan(plan_id: int, db: AsyncSession = Depends(get_db)):
    plan = await db.get(MealPlan, plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    await db.delete(plan)
    await db.commit()


def _plan_to_out(plan: MealPlan) -> MealPlanOut:
    return MealPlanOut(
        id=plan.id,
        name=plan.name,
        created_at=plan.created_at,
        start_date=plan.start_date,
        days=plan.days,
        budget_eur=plan.budget_eur,
        meat_days=plan.meat_days,
        plan_days=[PlanDayOut.from_orm_day(d) for d in plan.plan_days],
    )
