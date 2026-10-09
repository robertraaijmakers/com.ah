from datetime import datetime
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from database import get_db
from models import Meal, MealIngredient, MealRating, MealHistory, PantryItem, Product, ProductSnapshot
from services import ollama as ollama_svc

router = APIRouter(prefix="/meals", tags=["meals"])


class IngredientIn(BaseModel):
    ingredient_name: str
    product_id: int | None = None
    quantity: Decimal | None = None
    unit: str | None = None
    optional: bool = False
    substitute_notes: str | None = None


class MealIn(BaseModel):
    name: str
    category: str | None = None
    description: str | None = None
    instructions: str | None = None
    source_url: str | None = None
    portions_default: int = 4
    prep_minutes: int | None = None
    cook_minutes: int | None = None
    tags: list[str] = []
    nutrition_score: int | None = None
    makes_leftovers: bool = False
    ingredients: list[IngredientIn] = []


class LinkedProductOut(BaseModel):
    id: int
    name: str
    brand: str | None
    image_url: str | None
    product_group_name: str | None
    current_price: Decimal | None
    current_bonus_price: Decimal | None
    is_bonus: bool
    price_per_kg: Decimal | None
    price_per_litre: Decimal | None
    price_per_piece: Decimal | None

    model_config = {"from_attributes": True}


class IngredientOut(BaseModel):
    id: int
    ingredient_name: str
    product_id: int | None
    quantity: Decimal | None
    unit: str | None
    optional: bool
    skip_linking: bool
    substitute_notes: str | None
    linked_product: LinkedProductOut | None = None

    model_config = {"from_attributes": True}


class RatingOut(BaseModel):
    id: int
    family_member_id: int
    rating: int
    cooked_at: datetime
    notes: str | None

    model_config = {"from_attributes": True}


_STARTER_CATEGORIES = {"soep", "soup", "voorgerecht", "starter", "amuse", "salade", "salad"}


class MealNutrition(BaseModel):
    energy_kcal: float | None = None
    fat: float | None = None
    saturated_fat: float | None = None
    carbohydrates: float | None = None
    sugars: float | None = None
    fiber: float | None = None
    protein: float | None = None
    salt: float | None = None
    ingredients_with_data: int = 0
    ingredients_total: int = 0


class MealOut(BaseModel):
    id: int
    name: str
    category: str | None
    is_starter: bool
    description: str | None
    instructions: str | None
    source_url: str | None
    portions_default: int
    prep_minutes: int | None
    cook_minutes: int | None
    tags: list[str]
    nutrition_score: int | None
    makes_leftovers: bool
    estimated_price: Decimal | None
    ingredients: list[IngredientOut]
    ratings: list[RatingOut]
    nutrition: MealNutrition | None = None

    model_config = {"from_attributes": True}


class MealPatch(BaseModel):
    name: str | None = None
    category: str | None = None
    instructions: str | None = None
    portions_default: int | None = None
    tags: list[str] | None = None
    nutrition_score: int | None = None
    makes_leftovers: bool | None = None


class IngredientPatch(BaseModel):
    ingredient_name: str | None = None
    quantity: Decimal | None = None
    unit: str | None = None
    optional: bool | None = None


class RatingIn(BaseModel):
    family_member_id: int
    rating: int
    notes: str | None = None


class LinkProductIn(BaseModel):
    product_id: int | None = None
    skip_linking: bool = False


class ShoppingOption(BaseModel):
    product_id: int
    name: str
    brand: str | None
    image_url: str | None
    effective_price: Decimal
    price_per_kg: Decimal | None
    price_per_litre: Decimal | None
    price_per_piece: Decimal | None
    is_bonus: bool
    is_cheapest: bool


class ShoppingSuggestion(BaseModel):
    ingredient_id: int
    ingredient_name: str
    quantity: Decimal | None
    unit: str | None
    linked_product_id: int | None
    linked_product_name: str | None
    linked_product_group: str | None
    options: list[ShoppingOption]  # sorted cheapest first; empty if no linked product


_UNIT_TO_G: dict[str, float] = {
    "g": 1.0, "kg": 1000.0,
    "ml": 1.0, "l": 1000.0,
    "el": 15.0, "tl": 5.0,
    "snufje": 1.0,
}


def _build_meal_nutrition(meal: Meal) -> MealNutrition | None:
    totals: dict[str, float] = {}
    keys = ["energy_kcal", "fat", "saturated_fat", "carbohydrates", "sugars", "fiber", "protein", "salt"]
    with_data = 0
    total_countable = 0

    for ing in meal.ingredients:
        if ing.skip_linking:
            continue
        total_countable += 1
        if not ing.product:
            continue
        snap = ing.product.snapshots[0] if ing.product.snapshots else None
        if not snap or not snap.nutrition:
            continue

        nutrition: dict = snap.nutrition
        per_unit = nutrition.get("per_unit", "100g")  # "100g" or "100ml"
        qty = float(ing.quantity or 0)
        if qty == 0:
            continue

        unit = (ing.unit or "g").lower().strip()

        # Determine base amount (in grams or ml matching per_unit)
        if unit in _UNIT_TO_G:
            amount = qty * _UNIT_TO_G[unit]
        elif unit == "stuks":
            weight_g = float(snap.weight_g or 0)
            volume_ml = float(snap.volume_ml or 0)
            pieces = float(snap.pieces or 1)
            amount = qty * (weight_g + volume_ml) / pieces
        else:
            continue

        factor = amount / 100.0
        with_data += 1
        for key in keys:
            if key in nutrition:
                totals[key] = round(totals.get(key, 0.0) + nutrition[key] * factor, 2)

    if not totals:
        return MealNutrition(ingredients_with_data=with_data, ingredients_total=total_countable)

    return MealNutrition(
        ingredients_with_data=with_data,
        ingredients_total=total_countable,
        **{k: round(totals[k], 1) for k in keys if k in totals},
    )


async def _load_meal_with_products(meal_id: int, db: AsyncSession) -> Meal | None:
    result = await db.execute(
        select(Meal)
        .options(
            selectinload(Meal.ingredients).selectinload(MealIngredient.product).selectinload(Product.snapshots),
            selectinload(Meal.ratings),
        )
        .where(Meal.id == meal_id)
    )
    return result.scalar_one_or_none()


def _build_ingredient_out(ing: MealIngredient) -> IngredientOut:
    linked = None
    if ing.product:
        p = ing.product
        snap = p.snapshots[0] if p.snapshots else None
        linked = LinkedProductOut(
            id=p.id,
            name=p.name,
            brand=p.brand,
            image_url=p.image_url,
            product_group_name=p.product_group_name,
            current_price=snap.price if snap else None,
            current_bonus_price=snap.bonus_price if snap else None,
            is_bonus=snap.is_bonus if snap else False,
            price_per_kg=snap.price_per_kg if snap else None,
            price_per_litre=snap.price_per_litre if snap else None,
            price_per_piece=snap.price_per_piece if snap else None,
        )
    return IngredientOut(
        id=ing.id,
        ingredient_name=ing.ingredient_name,
        product_id=ing.product_id,
        quantity=ing.quantity,
        unit=ing.unit,
        optional=ing.optional,
        skip_linking=ing.skip_linking,
        substitute_notes=ing.substitute_notes,
        linked_product=linked,
    )


def _build_meal_out(meal: Meal) -> MealOut:
    return MealOut(
        id=meal.id,
        name=meal.name,
        category=meal.category,
        is_starter=(meal.category or "").lower().strip() in _STARTER_CATEGORIES,
        description=meal.description,
        instructions=meal.instructions,
        source_url=meal.source_url,
        portions_default=meal.portions_default,
        prep_minutes=meal.prep_minutes,
        cook_minutes=meal.cook_minutes,
        tags=meal.tags,
        nutrition_score=meal.nutrition_score,
        makes_leftovers=meal.makes_leftovers,
        estimated_price=meal.estimated_price,
        ingredients=[_build_ingredient_out(i) for i in meal.ingredients],
        ratings=[RatingOut.model_validate(r) for r in meal.ratings],
        nutrition=_build_meal_nutrition(meal),
    )


@router.get("/", response_model=list[MealOut])
async def list_meals(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Meal)
        .options(
            selectinload(Meal.ingredients).selectinload(MealIngredient.product).selectinload(Product.snapshots),
            selectinload(Meal.ratings),
        )
        .order_by(Meal.name)
    )
    return [_build_meal_out(m) for m in result.scalars()]


@router.post("/", response_model=MealOut, status_code=201)
async def create_meal(body: MealIn, db: AsyncSession = Depends(get_db)):
    meal_data = body.model_dump(exclude={"ingredients"})
    meal = Meal(**meal_data)
    db.add(meal)
    await db.flush()
    for ing_data in body.ingredients:
        db.add(MealIngredient(meal_id=meal.id, **ing_data.model_dump()))
    await db.commit()
    meal = await _load_meal_with_products(meal.id, db)
    return _build_meal_out(meal)


@router.get("/categories", response_model=list[str])
async def list_meal_categories(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Meal.category).where(Meal.category.isnot(None)).distinct().order_by(Meal.category)
    )
    return [r[0] for r in result.all()]


@router.get("/{meal_id}", response_model=MealOut)
async def get_meal(meal_id: int, db: AsyncSession = Depends(get_db)):
    meal = await _load_meal_with_products(meal_id, db)
    if not meal:
        raise HTTPException(404, "Meal not found")
    return _build_meal_out(meal)


@router.put("/{meal_id}", response_model=MealOut)
async def update_meal(meal_id: int, body: MealIn, db: AsyncSession = Depends(get_db)):
    meal = await _load_meal_with_products(meal_id, db)
    if not meal:
        raise HTTPException(404, "Meal not found")
    for k, v in body.model_dump(exclude={"ingredients"}).items():
        setattr(meal, k, v)
    for ing in meal.ingredients:
        await db.delete(ing)
    await db.flush()
    for ing_data in body.ingredients:
        db.add(MealIngredient(meal_id=meal.id, **ing_data.model_dump()))
    await db.commit()
    meal = await _load_meal_with_products(meal_id, db)
    return _build_meal_out(meal)


@router.delete("/{meal_id}", status_code=204)
async def delete_meal(meal_id: int, db: AsyncSession = Depends(get_db)):
    meal = await db.get(Meal, meal_id)
    if not meal:
        raise HTTPException(404, "Meal not found")
    await db.delete(meal)
    await db.commit()


@router.patch("/{meal_id}", response_model=MealOut)
async def patch_meal(meal_id: int, body: MealPatch, db: AsyncSession = Depends(get_db)):
    meal = await _load_meal_with_products(meal_id, db)
    if not meal:
        raise HTTPException(404, "Meal not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(meal, k, v)
    await db.commit()
    meal = await _load_meal_with_products(meal_id, db)
    return _build_meal_out(meal)


@router.patch("/{meal_id}/ingredients/{ingredient_id}", response_model=IngredientOut)
async def patch_ingredient(
    meal_id: int,
    ingredient_id: int,
    body: IngredientPatch,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(MealIngredient)
        .options(selectinload(MealIngredient.product).selectinload(Product.snapshots))
        .where(MealIngredient.id == ingredient_id, MealIngredient.meal_id == meal_id)
    )
    ing = result.scalar_one_or_none()
    if not ing:
        raise HTTPException(404, "Ingredient not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(ing, k, v)
    await db.commit()
    result = await db.execute(
        select(MealIngredient)
        .options(selectinload(MealIngredient.product).selectinload(Product.snapshots))
        .where(MealIngredient.id == ingredient_id)
    )
    return _build_ingredient_out(result.scalar_one())


@router.post("/{meal_id}/ingredients", response_model=IngredientOut, status_code=201)
async def add_ingredient(meal_id: int, body: IngredientIn, db: AsyncSession = Depends(get_db)):
    meal = await db.get(Meal, meal_id)
    if not meal:
        raise HTTPException(404, "Meal not found")
    ing = MealIngredient(meal_id=meal_id, **body.model_dump())
    db.add(ing)
    await db.commit()
    result = await db.execute(
        select(MealIngredient)
        .options(selectinload(MealIngredient.product).selectinload(Product.snapshots))
        .where(MealIngredient.id == ing.id)
    )
    return _build_ingredient_out(result.scalar_one())


@router.delete("/{meal_id}/ingredients/{ingredient_id}", status_code=204)
async def delete_ingredient(meal_id: int, ingredient_id: int, db: AsyncSession = Depends(get_db)):
    ing = (await db.execute(
        select(MealIngredient).where(MealIngredient.id == ingredient_id, MealIngredient.meal_id == meal_id)
    )).scalar_one_or_none()
    if not ing:
        raise HTTPException(404, "Ingredient not found")
    await db.delete(ing)
    await db.commit()


@router.patch("/{meal_id}/ingredients/{ingredient_id}/link", response_model=IngredientOut)
async def link_ingredient_product(
    meal_id: int,
    ingredient_id: int,
    body: LinkProductIn,
    db: AsyncSession = Depends(get_db),
):
    """Link or unlink an ingredient to a specific product."""
    result = await db.execute(
        select(MealIngredient)
        .options(selectinload(MealIngredient.product).selectinload(Product.snapshots))
        .where(MealIngredient.id == ingredient_id, MealIngredient.meal_id == meal_id)
    )
    ing = result.scalar_one_or_none()
    if not ing:
        raise HTTPException(404, "Ingredient not found")
    if body.skip_linking:
        ing.product_id = None
        ing.skip_linking = True
    else:
        if body.product_id is not None:
            product = await db.get(Product, body.product_id)
            if not product:
                raise HTTPException(404, "Product not found")
        ing.product_id = body.product_id
        ing.skip_linking = False
    await db.commit()
    result = await db.execute(
        select(MealIngredient)
        .options(selectinload(MealIngredient.product).selectinload(Product.snapshots))
        .where(MealIngredient.id == ingredient_id)
    )
    ing = result.scalar_one()
    return _build_ingredient_out(ing)


@router.get("/{meal_id}/shopping-suggestions", response_model=list[ShoppingSuggestion])
async def shopping_suggestions(meal_id: int, db: AsyncSession = Depends(get_db)):
    """
    For each ingredient, find all products in the same product group and return them
    sorted cheapest first (effective price per unit). Unlinked ingredients return empty options.
    """
    meal = await _load_meal_with_products(meal_id, db)
    if not meal:
        raise HTTPException(404, "Meal not found")

    suggestions = []
    for ing in meal.ingredients:
        if ing.skip_linking:
            continue
        if not ing.product or not ing.product.product_group_name:
            suggestions.append(ShoppingSuggestion(
                ingredient_id=ing.id,
                ingredient_name=ing.ingredient_name,
                quantity=ing.quantity,
                unit=ing.unit,
                linked_product_id=ing.product_id,
                linked_product_name=ing.product.name if ing.product else None,
                linked_product_group=None,
                options=[],
            ))
            continue

        group_name = ing.product.product_group_name
        unit_type = ing.product.unit_type

        # Find all products in the same group with their latest snapshot
        result = await db.execute(
            select(Product)
            .options(selectinload(Product.snapshots))
            .where(
                Product.product_group_name == group_name,
                Product.store_id == ing.product.store_id,
            )
        )
        group_products = result.scalars().all()

        def _eff_price(p: Product) -> Decimal | None:
            snap = p.snapshots[0] if p.snapshots else None
            if not snap or snap.price == 0:
                return None
            return snap.bonus_price if snap.is_bonus and snap.bonus_price else snap.price

        def _unit_price(p: Product) -> Decimal | None:
            snap = p.snapshots[0] if p.snapshots else None
            if not snap:
                return None
            if unit_type == "weight":
                return snap.price_per_kg
            if unit_type == "volume":
                return snap.price_per_litre
            return snap.price_per_piece

        # Sort by per-unit price, then by effective total price
        def _sort_key(p: Product):
            up = _unit_price(p)
            ep = _eff_price(p)
            return (up if up else Decimal("9999"), ep if ep else Decimal("9999"))

        sorted_products = sorted(group_products, key=_sort_key)

        options = []
        for i, p in enumerate(sorted_products):
            snap = p.snapshots[0] if p.snapshots else None
            ep = _eff_price(p)
            if ep is None:
                continue
            options.append(ShoppingOption(
                product_id=p.id,
                name=p.name,
                brand=p.brand,
                image_url=p.image_url,
                effective_price=ep,
                price_per_kg=snap.price_per_kg if snap else None,
                price_per_litre=snap.price_per_litre if snap else None,
                price_per_piece=snap.price_per_piece if snap else None,
                is_bonus=snap.is_bonus if snap else False,
                is_cheapest=(i == 0),
            ))

        suggestions.append(ShoppingSuggestion(
            ingredient_id=ing.id,
            ingredient_name=ing.ingredient_name,
            quantity=ing.quantity,
            unit=ing.unit,
            linked_product_id=ing.product_id,
            linked_product_name=ing.product.name,
            linked_product_group=group_name,
            options=options,
        ))

    return suggestions


@router.post("/{meal_id}/rate", response_model=RatingOut, status_code=201)
async def rate_meal(meal_id: int, body: RatingIn, db: AsyncSession = Depends(get_db)):
    meal = await db.get(Meal, meal_id)
    if not meal:
        raise HTTPException(404, "Meal not found")
    if not (1 <= body.rating <= 5):
        raise HTTPException(400, "Rating must be 1-5")
    rating = MealRating(meal_id=meal_id, **body.model_dump())
    db.add(rating)
    await db.commit()
    await db.refresh(rating)
    return rating


_IMPORT_SYSTEM = """
You are a recipe parser. Extract structured recipe data from Dutch text and return JSON.
Return exactly this JSON structure (no extra keys):
{
  "name": "recipe name in Dutch",
  "category": "category label if present (often the first short line before the recipe name, e.g. 'Soep', 'Pasta', 'Vlees'), else null",
  "description": "one-sentence description in Dutch",
  "instructions": "numbered step-by-step instructions in Dutch — EACH step on its OWN line, starting with '1.\\n2.\\n3.' etc. Combine ALL instruction sections into one sequential list. Preserve all original steps.",
  "portions_default": 4,
  "prep_minutes": null,
  "cook_minutes": null,
  "tags": ["tag1", "tag2"],
  "makes_leftovers": false,
  "ingredients": [
    {
      "ingredient_name": "full descriptive ingredient name in Dutch including adjectives (e.g. 'Griekse yoghurt', 'groentebouillon', 'kerriepoeder')",
      "quantity": 1.0,
      "unit": "stuks/g/ml/el/tl/snuf/naar smaak",
      "optional": false
    }
  ]
}
Rules:
- quantity: number only (e.g. 400 for 400g). Convert fractions: 1½ = 1.5. Use null if unspecified.
- unit: "g" for gram, "ml" for ml; convert liters to ml (1.5l = 1500ml). "el"=tablespoon, "tl"=teaspoon. null if unclear.
- portions_default: estimate from yield description (e.g. "2 liter soep" = 6, "5 pizza's" = 5, "4 personen" = 4).
- makes_leftovers: true for soep, stoofpot, ovenschotels, or any large-batch recipe.
- tags: pick from: vegetarisch, vegan, vlees, vis, soep, pasta, stamppot, bakken, snel, feest, seizoen.
- optional: true only when explicitly marked optional/facultatief in the source text.
- ingredient_name: the canonical ingredient ONLY — 1 to 4 words, no quantities, no preparation notes, no parenthetical remarks. Include meaningful adjectives: "Griekse yoghurt", "groentebouillon", "kerriepoeder", "reuzenbonen". Do NOT include: amounts, units, instructions like "zaad verwijderd", or source notes like "van 2½ tablet".
- DEDUPLICATION: if the same ingredient appears multiple times (e.g. "gedroogde gist" listed as both 7g and 3g variants), include it ONCE using the primary/default quantity. Add a note in description if there is a meaningful variant.
- SKIP generic pantry staples that are not specific products: "zout", "peper", "water", "olie" (when standalone). Include them only when they are specific (e.g. "olijfolie", "zeezout").
"""


class ImportMealRequest(BaseModel):
    text: str
    category: str | None = None  # override parsed category


class ImportMatchNote(BaseModel):
    ingredient_name: str
    matched: bool
    product_name: str | None = None
    product_id: int | None = None


class ImportMealOut(BaseModel):
    meal: MealOut
    match_notes: list[ImportMatchNote]


@router.post("/import-text", response_model=ImportMealOut, status_code=201)
async def import_meal_from_text(body: ImportMealRequest, db: AsyncSession = Depends(get_db)):
    """Parse free-form Dutch recipe text with Ollama, match products, create meal."""
    if not await ollama_svc.is_available():
        raise HTTPException(503, "Ollama not available — run: ollama serve")

    # 1. Parse recipe text via Ollama JSON mode
    try:
        parsed = await ollama_svc.complete_json(body.text, _IMPORT_SYSTEM)
    except Exception as e:
        raise HTTPException(502, f"Ollama parse error: {e}")

    # 2. For each ingredient, find best product match
    match_notes: list[ImportMatchNote] = []
    ingredients_in: list[dict] = []

    # Truly generic pantry staples that should never be linked to a product
    _PANTRY_SKIP = {"zout", "peper", "water", "olie", "boter", "bloem", "suiker", "azijn"}

    for ing in parsed.get("ingredients", []):
        iname = ing.get("ingredient_name", "")
        qty_raw = ing.get("quantity")
        qty = float(qty_raw) if qty_raw is not None else None
        unit = ing.get("unit") or None
        optional = bool(ing.get("optional", False))

        # Skip if LLM included a generic pantry staple despite prompt instruction
        if iname.lower().strip() in _PANTRY_SKIP:
            match_notes.append(ImportMatchNote(ingredient_name=iname, matched=False))
            ingredients_in.append({
                "ingredient_name": iname, "product_id": None,
                "quantity": float(ing.get("quantity")) if ing.get("quantity") else None,
                "unit": ing.get("unit") or None,
                "optional": bool(ing.get("optional", False)),
                "substitute_notes": None,
            })
            continue

        # Search strategy: full name → each meaningful word → compound-word splits
        _STOP = {
            "in", "en", "of", "met", "van", "op", "de", "het", "een", "voor", "uit",
            "netto", "uitgelekt", "gedroogd", "gedroogde", "vers", "verse",
            "tablet", "tabletten", "blokje", "blokjes", "bakje", "blikje", "blik",
            "stukje", "stukjes", "halve", "half", "hele",
            "geroosterd", "geroosterde", "optioneel", "facultatief",
        }
        words = [w for w in iname.lower().split() if w not in _STOP and len(w) > 3]
        # For Dutch compound words (>=7 chars), split into prefix/suffix candidates.
        # Search prefixes first (specific part) then suffixes (generic ending).
        compound_prefixes_set = set()
        compound_suffixes_set = set()
        for w in words:
            if len(w) >= 7:
                for n in range(4, min(len(w), 8)):
                    compound_prefixes_set.add(w[:n])
                for n in range(6, min(len(w), 10)):
                    compound_suffixes_set.add(w[-n:])
        ordered_compounds = (
            sorted(compound_prefixes_set, key=len, reverse=True) +
            sorted(compound_suffixes_set - compound_prefixes_set, key=len, reverse=True)
        )
        # Deduplicate, keep only useful candidates (no stop words, len > 3)
        seen: set[str] = set()
        search_candidates: list[str] = [iname]
        for t in sorted(words, key=len, reverse=True) + ordered_compounds:
            if t not in seen and t not in _STOP and len(t) > 3:
                search_candidates.append(t)
                seen.add(t)

        # Also lower the prefix-length threshold for very short ingredient names
        def _plausible_ext(product_name: str, search_term: str) -> bool:
            pn_words = set(product_name.lower().split())
            st_words = set(search_term.lower().split())
            if pn_words & st_words:
                return True
            min_len = 2 if len(search_term) <= 3 else 4
            for sw in st_words:
                if len(sw) >= min_len:
                    for pw in pn_words:
                        if pw.startswith(sw) and len(pw) - len(sw) <= 3:
                            return True
            return False

        matched_id = None
        matched_name = None
        for search_term in search_candidates:
            if not search_term:
                continue
            # Fetch top-5 by name length; pick first that passes plausibility
            res = await db.execute(
                select(Product.id, Product.name)
                .where(
                    or_(
                        Product.name.ilike(f"%{search_term}%"),
                        Product.name_en.ilike(f"%{search_term}%"),
                    )
                )
                .order_by(func.length(Product.name))
                .limit(5)
            )
            rows = res.fetchall()
            for row in rows:
                if _plausible_ext(row.name, search_term):
                    matched_id = row.id
                    matched_name = row.name
                    break
            if matched_id:
                break

        match_notes.append(ImportMatchNote(
            ingredient_name=iname,
            matched=matched_id is not None,
            product_name=matched_name,
            product_id=matched_id,
        ))
        ingredients_in.append({
            "ingredient_name": iname,
            "product_id": matched_id,
            "quantity": qty,
            "unit": unit,
            "optional": optional,
            "substitute_notes": None,
        })

    # 3. Post-process instructions: split into lines, renumber all steps sequentially
    import re as _re
    raw_instructions = parsed.get("instructions") or ""
    # First pass: ensure each numbered step is on its own line
    split = _re.sub(r'[\s]*(\d+\.)\s*\n?\s*', r'\n\1 ', raw_instructions).strip()
    # Second pass: collect only numbered-step lines and renumber 1…N
    step_num = 0
    result_lines = []
    for line in split.split('\n'):
        line = line.strip()
        if not line:
            continue
        if _re.match(r'^\d+\.', line):
            step_num += 1
            line = _re.sub(r'^\d+\.', f'{step_num}.', line, count=1)
            result_lines.append(line)
        # Non-numbered lines (headers like "(30 min)") are intentionally dropped
    instructions = '\n'.join(result_lines)

    # 3. Create meal
    category = body.category or parsed.get("category") or None
    meal = Meal(
        name=parsed.get("name", "Onbekend recept"),
        category=category,
        description=parsed.get("description"),
        instructions=instructions,
        source_url=None,
        portions_default=int(parsed.get("portions_default") or 4),
        prep_minutes=parsed.get("prep_minutes"),
        cook_minutes=parsed.get("cook_minutes"),
        tags=parsed.get("tags") or [],
        makes_leftovers=bool(parsed.get("makes_leftovers", False)),
    )
    db.add(meal)
    await db.flush()
    for ing_data in ingredients_in:
        db.add(MealIngredient(meal_id=meal.id, **ing_data))
    await db.commit()

    meal = await _load_meal_with_products(meal.id, db)
    return ImportMealOut(meal=_build_meal_out(meal), match_notes=match_notes)


@router.post("/{meal_id}/cooked", status_code=201)
async def log_cooked(
    meal_id: int,
    persons: list[int],
    portions: int = 4,
    notes: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    meal = await db.get(Meal, meal_id)
    if not meal:
        raise HTTPException(404, "Meal not found")
    history = MealHistory(meal_id=meal_id, persons=persons, portions=portions, notes=notes)
    db.add(history)

    # Use up linked ingredients from the pantry (only where the unit matches)
    ingredients = (await db.execute(
        select(MealIngredient).where(MealIngredient.meal_id == meal_id, MealIngredient.product_id.isnot(None))
    )).scalars().all()
    scale = Decimal(str(portions)) / Decimal(str(meal.portions_default or portions))
    consumed = 0
    for ing in ingredients:
        if ing.optional or not ing.quantity:
            continue
        needed = ing.quantity * scale
        rows = (await db.execute(
            select(PantryItem)
            .where(PantryItem.product_id == ing.product_id, PantryItem.unit == (ing.unit or "stuks"))
            .order_by(PantryItem.expires_at.asc().nullslast())
        )).scalars().all()
        for row in rows:
            if needed <= 0:
                break
            used = min(row.quantity, needed)
            row.quantity -= used
            needed -= used
            consumed += 1
            if row.quantity <= 0:
                await db.delete(row)
    await db.commit()
    return {"ok": True, "pantry_items_used": consumed}
