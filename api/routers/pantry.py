from datetime import date, datetime, timedelta
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from database import get_db
from models import PantryItem, Product, ProductSnapshot

router = APIRouter(prefix="/pantry", tags=["pantry"])


class PantryItemIn(BaseModel):
    product_id: int
    quantity: Decimal
    unit: str
    expires_at: date | None = None


class ProductMini(BaseModel):
    id: int
    name: str
    image_url: str | None
    category: str | None

    model_config = {"from_attributes": True}


class PantryItemOut(BaseModel):
    id: int
    product_id: int
    quantity: Decimal
    unit: str
    added_at: datetime
    expires_at: date | None
    product: ProductMini

    model_config = {"from_attributes": True}


@router.get("/", response_model=list[PantryItemOut])
async def list_pantry(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PantryItem)
        .options(selectinload(PantryItem.product))
        .order_by(PantryItem.expires_at.asc().nullslast())
    )
    return result.scalars().all()


@router.post("/", response_model=PantryItemOut, status_code=201)
async def add_to_pantry(body: PantryItemIn, db: AsyncSession = Depends(get_db)):
    product = await db.get(Product, body.product_id, options=[selectinload(Product.snapshots)])
    if not product:
        raise HTTPException(404, "Product not found")

    expires_at = body.expires_at
    if not expires_at and product.shelf_life_days:
        expires_at = date.today() + timedelta(days=product.shelf_life_days)

    item = PantryItem(
        product_id=body.product_id,
        quantity=body.quantity,
        unit=body.unit,
        expires_at=expires_at,
    )
    db.add(item)
    await db.commit()
    result = await db.execute(
        select(PantryItem).options(selectinload(PantryItem.product)).where(PantryItem.id == item.id)
    )
    return result.scalar_one()


@router.delete("/{item_id}", status_code=204)
async def remove_from_pantry(item_id: int, db: AsyncSession = Depends(get_db)):
    item = await db.get(PantryItem, item_id)
    if not item:
        raise HTTPException(404, "Pantry item not found")
    await db.delete(item)
    await db.commit()


@router.patch("/{item_id}/consume")
async def consume_pantry_item(item_id: int, quantity: Decimal, db: AsyncSession = Depends(get_db)):
    item = await db.get(PantryItem, item_id)
    if not item:
        raise HTTPException(404, "Pantry item not found")
    item.quantity = max(Decimal("0"), item.quantity - quantity)
    if item.quantity == 0:
        await db.delete(item)
    await db.commit()
    return {"remaining": float(item.quantity) if item.quantity > 0 else 0}
