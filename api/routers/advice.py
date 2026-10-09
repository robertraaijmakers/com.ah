from datetime import datetime
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from database import get_db
from models import BuyAdvice
from services.advice import generate_buy_advice

router = APIRouter(prefix="/advice", tags=["advice"])


class ProductMini(BaseModel):
    id: int
    name: str
    image_url: str | None
    category: str | None

    model_config = {"from_attributes": True}


class BuyAdviceOut(BaseModel):
    id: int
    product_id: int
    product: ProductMini
    advice_type: str
    current_price: Decimal
    avg_price_90d: Decimal | None
    savings_pct: Decimal | None
    message: str | None
    generated_at: datetime
    expires_at: datetime | None

    model_config = {"from_attributes": True}


@router.get("/", response_model=list[BuyAdviceOut])
async def list_advice(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(BuyAdvice)
        .options(selectinload(BuyAdvice.product))
        .where(BuyAdvice.dismissed == False)
        .order_by(BuyAdvice.savings_pct.desc().nullslast())
    )
    return result.scalars().all()


@router.post("/{advice_id}/dismiss", status_code=204)
async def dismiss(advice_id: int, db: AsyncSession = Depends(get_db)):
    adv = await db.get(BuyAdvice, advice_id)
    if not adv:
        raise HTTPException(404, "Advice not found")
    adv.dismissed = True
    await db.commit()


@router.post("/run", status_code=200)
async def run_advice_engine(db: AsyncSession = Depends(get_db)):
    count = await generate_buy_advice(db)
    return {"created": count}
