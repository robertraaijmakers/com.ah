from decimal import Decimal
from collections import defaultdict
from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from models import MealPlan, MealPlanDay, Meal, MealIngredient, PantryItem, Product, ProductSnapshot, ShoppingList, ShoppingListItem


async def generate_shopping_list(db: AsyncSession, plan_id: int) -> ShoppingList:
    plan = await db.get(MealPlan, plan_id, options=[
        selectinload(MealPlan.plan_days).selectinload(MealPlanDay.meal).selectinload(Meal.ingredients).selectinload(MealIngredient.product)
    ])
    if not plan:
        raise HTTPException(status_code=404, detail=f"Plan {plan_id} not found")

    # Aggregate ingredients across all days
    # key: (ingredient_name, unit) -> total quantity
    ingredient_totals: dict[tuple[str, str], dict] = defaultdict(lambda: {"quantity": Decimal("0"), "product_id": None, "ingredient_name": ""})

    for day in plan.plan_days:
        if not day.meal or day.is_leftovers:
            continue
        scale = Decimal(str(day.portions)) / Decimal(str(day.meal.portions_default or day.portions))
        for ing in day.meal.ingredients:
            if ing.optional:
                continue
            unit = ing.unit or "stuks"
            qty = (ing.quantity or Decimal("1")) * scale
            key = (ing.ingredient_name.lower(), unit)
            ingredient_totals[key]["quantity"] += qty
            ingredient_totals[key]["ingredient_name"] = ing.ingredient_name
            if ing.product_id:
                ingredient_totals[key]["product_id"] = ing.product_id

    # Load pantry
    pantry_result = await db.execute(
        select(PantryItem).options(selectinload(PantryItem.product))
    )
    pantry = pantry_result.scalars().all()
    pantry_by_product: dict[int, PantryItem] = {p.product_id: p for p in pantry}

    # Build shopping list items
    shopping_list = ShoppingList(plan_id=plan_id)
    db.add(shopping_list)
    await db.flush()

    total = Decimal("0")

    for (ingredient_name, unit), data in ingredient_totals.items():
        needed = data["quantity"]
        product_id = data["product_id"]
        from_pantry = Decimal("0")

        if product_id and product_id in pantry_by_product:
            pantry_item = pantry_by_product[product_id]
            if pantry_item.unit == unit:
                from_pantry = min(pantry_item.quantity, needed)
                needed = max(Decimal("0"), needed - from_pantry)

        estimated_price = None
        is_bonus = False

        if product_id and needed > 0:
            latest_snap = await _get_latest_snapshot(db, product_id)
            if latest_snap:
                estimated_price = latest_snap.effective_price
                is_bonus = latest_snap.is_bonus
                total += estimated_price

        item = ShoppingListItem(
            shopping_list_id=shopping_list.id,
            product_id=product_id,
            ingredient_name=data["ingredient_name"],
            quantity=needed,
            unit=unit,
            estimated_price=estimated_price,
            from_pantry_quantity=from_pantry,
            is_bonus=is_bonus,
            reasoning=_build_reasoning(from_pantry, is_bonus, estimated_price),
        )
        db.add(item)

    shopping_list.total_estimated = total
    await db.commit()
    await db.refresh(shopping_list)
    return shopping_list


async def _get_latest_snapshot(db: AsyncSession, product_id: int) -> ProductSnapshot | None:
    result = await db.execute(
        select(ProductSnapshot)
        .where(ProductSnapshot.product_id == product_id)
        .order_by(ProductSnapshot.scraped_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


def _build_reasoning(from_pantry: Decimal, is_bonus: bool, price: Decimal | None) -> str:
    parts = []
    if from_pantry > 0:
        parts.append(f"{from_pantry:g} uit voorraad")
    if is_bonus:
        parts.append("bonusprijs")
    if price:
        parts.append(f"€{price:.2f}")
    return " · ".join(parts) if parts else ""
