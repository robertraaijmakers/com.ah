from datetime import date, timedelta
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from models import Meal, MealHistory, MealRating, FamilyMember

MEAT_TAGS = {"vlees", "kip", "vis", "gehakt", "spek", "worst", "meat", "chicken", "fish"}
VEGETARIAN_TAGS = {"vegetarisch", "vegan", "vegetarian"}


def _is_meat_meal(meal: Meal) -> bool:
    tags = {t.lower() for t in (meal.tags or [])}
    return bool(tags & MEAT_TAGS) and not bool(tags & VEGETARIAN_TAGS)


def _passes_restrictions(meal: Meal, members: list[FamilyMember]) -> bool:
    restrictions = {}
    for m in members:
        for k, v in (m.dietary_restrictions or {}).items():
            if v:
                restrictions[k] = True

    tags = {t.lower() for t in (meal.tags or [])}
    if restrictions.get("vegetarian") or restrictions.get("vegetarisch"):
        if _is_meat_meal(meal):
            return False
    if restrictions.get("vegan"):
        if any(t in tags for t in {"zuivel", "eieren", "dairy", "eggs", "vlees", "vis"}):
            return False
    return True


async def generate_plan(
    db: AsyncSession,
    start_date: date,
    days: int,
    person_ids: list[int],
    meat_days: int | None,
    budget_eur: float | None,
    per_day_persons: list[list[int]] | None = None,
) -> list[dict]:
    members_result = await db.execute(
        select(FamilyMember).where(FamilyMember.id.in_(person_ids))
    )
    members = members_result.scalars().all()

    # Load all meals with ingredients and ratings
    meals_result = await db.execute(
        select(Meal).options(selectinload(Meal.ingredients), selectinload(Meal.ratings))
    )
    all_meals = meals_result.scalars().all()

    # Filter by dietary restrictions
    eligible = [m for m in all_meals if _passes_restrictions(m, list(members))]

    # Get recently cooked meals (last 14 days) to avoid repeats
    cutoff = date.today() - timedelta(days=14)
    recent_result = await db.execute(
        select(MealHistory.meal_id).where(MealHistory.cooked_at >= cutoff)
    )
    recent_ids = {row[0] for row in recent_result.all()}

    # Score meals: prefer higher rated, avoid recent
    def score(meal: Meal) -> float:
        if meal.ratings:
            avg = sum(r.rating for r in meal.ratings) / len(meal.ratings)
        else:
            avg = 3.0
        recency_penalty = 2.0 if meal.id in recent_ids else 0.0
        return avg - recency_penalty

    eligible.sort(key=score, reverse=True)

    meat_quota = meat_days if meat_days is not None else days // 2
    meat_used = 0
    plan = []

    for i in range(days):
        day_date = start_date + timedelta(days=i)
        want_meat = meat_used < meat_quota and (days - i) > (meat_quota - meat_used)

        chosen = None
        chosen_ids = {p["meal_id"] for p in plan if p.get("meal_id")}

        for meal in eligible:
            if meal.id in chosen_ids:
                continue
            if want_meat and not _is_meat_meal(meal):
                continue
            if not want_meat and _is_meat_meal(meal):
                continue
            chosen = meal
            break

        # Fallback: any eligible not yet chosen
        if not chosen:
            for meal in eligible:
                if meal.id not in chosen_ids:
                    chosen = meal
                    break

        if chosen and _is_meat_meal(chosen):
            meat_used += 1

        day_persons = (per_day_persons[i] if per_day_persons and i < len(per_day_persons) else person_ids)
        plan.append({
            "date": day_date.isoformat(),
            "meal_id": chosen.id if chosen else None,
            "meal_name": chosen.name if chosen else None,
            "persons": day_persons,
            "portions": len(day_persons),
            "is_leftovers": False,
        })

    return plan
