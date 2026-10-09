from datetime import datetime
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from database import get_db
from models import ShoppingList, ShoppingListItem, PantryItem, Product
from routers.pantry import add_or_merge
from services.shopping import generate_shopping_list

router = APIRouter(prefix="/shopping", tags=["shopping"])


class ShoppingItemOut(BaseModel):
    id: int
    product_id: int | None
    ingredient_name: str
    quantity: Decimal
    unit: str
    estimated_price: Decimal | None
    from_pantry_quantity: Decimal
    is_bonus: bool
    is_checked: bool
    reasoning: str | None
    category: str | None = None

    model_config = {"from_attributes": True}


class ShoppingListOut(BaseModel):
    id: int
    plan_id: int
    generated_at: datetime
    total_estimated: Decimal | None
    items: list[ShoppingItemOut]

    model_config = {"from_attributes": True}


async def _load_list(db: AsyncSession, list_id: int) -> ShoppingList:
    result = await db.execute(
        select(ShoppingList)
        .options(selectinload(ShoppingList.items).selectinload(ShoppingListItem.product))
        .where(ShoppingList.id == list_id)
    )
    sl = result.scalar_one_or_none()
    if not sl:
        raise HTTPException(404, "Boodschappenlijst niet gevonden")
    for it in sl.items:
        it.category = it.product.category if it.product else None
    return sl


class ManualItemIn(BaseModel):
    ingredient_name: str
    quantity: Decimal = Decimal("1")
    unit: str = "stuks"


@router.get("/latest", response_model=ShoppingListOut)
async def latest_list(db: AsyncSession = Depends(get_db)):
    list_id = (await db.execute(
        select(ShoppingList.id).order_by(ShoppingList.generated_at.desc(), ShoppingList.id.desc()).limit(1)
    )).scalar_one_or_none()
    if list_id is None:
        raise HTTPException(404, "Nog geen boodschappenlijst")
    return await _load_list(db, list_id)


@router.post("/{list_id}/items", response_model=ShoppingItemOut, status_code=201)
async def add_manual_item(list_id: int, body: ManualItemIn, db: AsyncSession = Depends(get_db)):
    name = body.ingredient_name.strip()
    if not name:
        raise HTTPException(422, "Naam is verplicht")
    if not await db.get(ShoppingList, list_id):
        raise HTTPException(404, "Boodschappenlijst niet gevonden")
    item = ShoppingListItem(
        shopping_list_id=list_id, ingredient_name=name, quantity=body.quantity,
        unit=body.unit.strip() or "stuks", from_pantry_quantity=0, is_bonus=False, reasoning="handmatig toegevoegd",
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    item.category = None
    return item


@router.delete("/{list_id}/items/{item_id}", status_code=204)
async def delete_item(list_id: int, item_id: int, db: AsyncSession = Depends(get_db)):
    item = await db.get(ShoppingListItem, item_id)
    if not item or item.shopping_list_id != list_id:
        raise HTTPException(404, "Item niet gevonden")
    await db.delete(item)
    await db.commit()


@router.post("/generate/{plan_id}", response_model=ShoppingListOut, status_code=201)
async def generate(plan_id: int, db: AsyncSession = Depends(get_db)):
    sl = await generate_shopping_list(db, plan_id)
    return await _load_list(db, sl.id)


@router.get("/{list_id}", response_model=ShoppingListOut)
async def get_list(list_id: int, db: AsyncSession = Depends(get_db)):
    return await _load_list(db, list_id)


@router.patch("/{list_id}/items/{item_id}/check")
async def check_item(list_id: int, item_id: int, checked: bool = True, db: AsyncSession = Depends(get_db)):
    item = await db.get(ShoppingListItem, item_id)
    if not item or item.shopping_list_id != list_id:
        raise HTTPException(404, "Item not found")
    item.is_checked = checked
    await db.commit()
    return {"ok": True}


@router.post("/{list_id}/items/{item_id}/bought")
async def mark_bought(list_id: int, item_id: int, db: AsyncSession = Depends(get_db)):
    """Mark item as bought and auto-add to pantry."""
    result = await db.execute(
        select(ShoppingListItem)
        .options(selectinload(ShoppingListItem.product))
        .where(ShoppingListItem.id == item_id, ShoppingListItem.shopping_list_id == list_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Item not found")

    if item.is_checked:
        # Already bought: don't add to the pantry a second time
        return {"ok": True, "added_to_pantry": False}
    item.is_checked = True

    added = False
    if item.product_id and item.quantity > 0:
        await add_or_merge(db, item.product_id, item.quantity, item.unit, None)
        added = True

    await db.commit()
    return {"ok": True, "added_to_pantry": added}


@router.post("/{list_id}/items/{item_id}/unbought")
async def mark_unbought(list_id: int, item_id: int, db: AsyncSession = Depends(get_db)):
    """Undo 'bought': uncheck and take the quantity back out of the pantry."""
    item = await db.get(ShoppingListItem, item_id)
    if not item or item.shopping_list_id != list_id:
        raise HTTPException(404, "Item niet gevonden")
    if item.is_checked and item.product_id and item.quantity > 0:
        row = (await db.execute(
            select(PantryItem).where(PantryItem.product_id == item.product_id, PantryItem.unit == item.unit)
            .order_by(PantryItem.id).limit(1)
        )).scalar_one_or_none()
        if row:
            row.quantity -= item.quantity
            if row.quantity <= 0:
                await db.delete(row)
    item.is_checked = False
    await db.commit()
    return {"ok": True}
