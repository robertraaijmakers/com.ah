"""Ingredient-level cost estimates for meals and plans.

Costs are pro-rata (what the ingredients you actually use cost), not till prices:
2 eggs from a pack of 10 count as 2/10 of the pack price. Shopping-list totals
(whole packs) are a different number and are reported separately.
"""
from decimal import Decimal
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from models import Meal, MealIngredient, ProductSnapshot

_TO_KG = {"g": Decimal("0.001"), "kg": Decimal(1)}
_TO_L = {"ml": Decimal("0.001"), "l": Decimal(1)}
# Spoons: 15 / 5 ml, counted as grams for weight-based products
_SPOON_ML = {"el": Decimal(15), "tl": Decimal(5)}
_NEGLIGIBLE = {"snufje", "snuf", "naar smaak"}


class CostLine(BaseModel):
    ingredient_name: str
    quantity: Decimal | None
    unit: str | None
    product_name: str | None
    cost: Decimal | None  # None = could not be priced
    is_bonus: bool = False
    note: str | None = None


class MealCost(BaseModel):
    meal_id: int
    meal_name: str
    portions: int
    total: Decimal
    per_portion: Decimal | None
    priced: int
    unpriced: int
    lines: list[CostLine] = []


async def latest_snapshots(db: AsyncSession, product_ids: set[int]) -> dict[int, ProductSnapshot]:
    if not product_ids:
        return {}
    rows = await db.execute(
        select(ProductSnapshot)
        .where(ProductSnapshot.product_id.in_(product_ids))
        .distinct(ProductSnapshot.product_id)
        .order_by(ProductSnapshot.product_id, ProductSnapshot.scraped_at.desc())
    )
    return {s.product_id: s for s in rows.scalars().all()}


def _unit_price(snap: ProductSnapshot, per: str) -> Decimal | None:
    """Per-kg / per-litre / per-piece price, derived from the pack if not stored."""
    stored = {"kg": snap.price_per_kg, "l": snap.price_per_litre, "piece": snap.price_per_piece}[per]
    if stored:
        return Decimal(stored)
    eff = snap.effective_price
    if per == "kg" and snap.weight_g:
        return eff / (Decimal(snap.weight_g) / 1000)
    if per == "l" and snap.volume_ml:
        return eff / (Decimal(snap.volume_ml) / 1000)
    if per == "piece" and snap.pieces:
        return eff / Decimal(snap.pieces)
    return None


def ingredient_cost(ing: MealIngredient, snap: ProductSnapshot | None, scale: Decimal) -> tuple[Decimal | None, str | None]:
    """Returns (cost, note). cost None means 'unknown'; Decimal(0) with a note means 'ignored'."""
    unit = (ing.unit or "stuks").lower().strip()
    if unit in _NEGLIGIBLE:
        return Decimal(0), "verwaarloosbaar"
    if not ing.quantity:
        return None, "geen hoeveelheid"
    if snap is None:
        return None, "niet gekoppeld aan een product" if not ing.product_id else "geen prijs bekend"
    qty = ing.quantity * scale

    if unit in _TO_KG:
        up = _unit_price(snap, "kg")
        if up is not None:
            return qty * _TO_KG[unit] * up, None
    elif unit in _TO_L:
        up = _unit_price(snap, "l")
        if up is not None:
            return qty * _TO_L[unit] * up, None
    elif unit in _SPOON_ML:
        ml = qty * _SPOON_ML[unit]
        up = _unit_price(snap, "l") or None
        if up is not None:
            return ml / 1000 * up, None
        up = _unit_price(snap, "kg")
        if up is not None:
            return ml / 1000 * up, None
    elif unit in ("stuks", "stuk", "pieces", "piece"):
        up = _unit_price(snap, "piece")
        if up is not None:
            return qty * up, None
    # Unknown unit (teen, bos, plak, ...): fall back to whole-pack price if quantity is a count
    return None, f"eenheid '{unit}' niet te prijzen"


def cost_meal(meal: Meal, portions: int | None, snaps: dict[int, ProductSnapshot], with_lines: bool = True) -> MealCost:
    portions = portions or meal.portions_default or 4
    scale = Decimal(portions) / Decimal(meal.portions_default or portions)
    total = Decimal(0)
    priced = unpriced = 0
    lines: list[CostLine] = []
    for ing in meal.ingredients:
        if ing.optional:
            continue
        snap = snaps.get(ing.product_id) if ing.product_id else None
        cost, note = ingredient_cost(ing, snap, scale)
        if cost is None:
            unpriced += 1
        else:
            priced += 1
            total += cost
        if with_lines:
            lines.append(CostLine(
                ingredient_name=ing.ingredient_name,
                quantity=(ing.quantity * scale) if ing.quantity else None,
                unit=ing.unit,
                product_name=ing.product.name if ing.product else None,
                cost=round(cost, 2) if cost is not None else None,
                is_bonus=bool(snap and snap.is_bonus),
                note=note,
            ))
    total = round(total, 2)
    return MealCost(
        meal_id=meal.id, meal_name=meal.name, portions=portions, total=total,
        per_portion=round(total / portions, 2) if portions else None,
        priced=priced, unpriced=unpriced, lines=lines,
    )
