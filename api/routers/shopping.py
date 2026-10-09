from datetime import datetime
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from database import get_db
from models import ShoppingList, ShoppingListItem, PantryItem, Product
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
        .options(selectinload(ShoppingList.items))
        .where(ShoppingList.id == list_id)
    )
    sl = result.scalar_one_or_none()
    if not sl:
        raise HTTPException(404, "Shopping list not found")
    return sl


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

    item.is_checked = True

    if item.product_id and item.quantity > 0:
        pantry = PantryItem(
            product_id=item.product_id,
            quantity=item.quantity,
            unit=item.unit,
        )
        db.add(pantry)

    await db.commit()
    return {"ok": True, "added_to_pantry": item.product_id is not None}
