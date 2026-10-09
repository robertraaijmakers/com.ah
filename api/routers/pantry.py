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


async def add_or_merge(db: AsyncSession, product_id: int, quantity: Decimal, unit: str, expires_at: date | None) -> PantryItem:
    """Add to an existing pantry row for the same product+unit instead of creating duplicates."""
    existing = (await db.execute(
        select(PantryItem).where(PantryItem.product_id == product_id, PantryItem.unit == unit)
        .order_by(PantryItem.id).limit(1)
    )).scalar_one_or_none()
    if existing:
        existing.quantity += quantity
        if expires_at and (existing.expires_at is None or expires_at < existing.expires_at):
            existing.expires_at = expires_at
        return existing
    item = PantryItem(product_id=product_id, quantity=quantity, unit=unit, expires_at=expires_at)
    db.add(item)
    await db.flush()
    return item


class PantryItemUpdate(BaseModel):
    quantity: Decimal | None = None
    unit: str | None = None
    expires_at: date | None = None
    clear_expiry: bool = False


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

    item = await add_or_merge(db, body.product_id, body.quantity, body.unit, expires_at)
    await db.commit()
    result = await db.execute(
        select(PantryItem).options(selectinload(PantryItem.product)).where(PantryItem.id == item.id)
    )
    return result.scalar_one()


@router.patch("/{item_id}", response_model=PantryItemOut)
async def update_pantry_item(item_id: int, body: PantryItemUpdate, db: AsyncSession = Depends(get_db)):
    item = await db.get(PantryItem, item_id)
    if not item:
        raise HTTPException(404, "Voorraaditem niet gevonden")
    if body.quantity is not None:
        if body.quantity < 0:
            raise HTTPException(422, "Hoeveelheid mag niet negatief zijn")
        item.quantity = body.quantity
    if body.unit:
        item.unit = body.unit
    if body.clear_expiry:
        item.expires_at = None
    elif body.expires_at is not None:
        item.expires_at = body.expires_at
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
