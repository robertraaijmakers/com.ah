from datetime import datetime
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from datetime import timedelta, timezone
from sqlalchemy import select, text, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from database import get_db
from models import BuyAdvice
from services.advice import ADVICE_TYPE, generate_buy_advice

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
    times_ordered: int = 0

    model_config = {"from_attributes": True}


@router.get("/", response_model=list[BuyAdviceOut])
async def list_advice(db: AsyncSession = Depends(get_db)):
    # Price alerts stay fresh without a scheduler: refresh when the newest advice is over 12h old.
    last = (await db.execute(select(func.max(BuyAdvice.generated_at)))).scalar_one_or_none()
    has_old_engine_rows = (await db.execute(
        select(func.count()).select_from(BuyAdvice).where(BuyAdvice.dismissed == False, BuyAdvice.advice_type != ADVICE_TYPE)  # noqa: E712
    )).scalar_one() > 0
    if last is None or has_old_engine_rows or datetime.now(timezone.utc) - last > timedelta(hours=12):
        await generate_buy_advice(db)

    result = await db.execute(
        select(BuyAdvice)
        .options(selectinload(BuyAdvice.product))
        .where(BuyAdvice.dismissed == False)
    )
    items = list(result.scalars().all())
    # How often the household bought this product or any other pack size of the same family
    counts = {
        r.fam: r.n
        for r in await db.execute(text(
            "SELECT COALESCE(p.product_group_name, 'p' || p.id) AS fam, COUNT(DISTINCT oi.order_id) AS n "
            "FROM order_items oi JOIN products p ON p.id = oi.product_id GROUP BY 1"
        ))
    }
    out = []
    for a in items:
        o = BuyAdviceOut.model_validate(a)
        o.times_ordered = int(counts.get(a.product.product_group_name or f"p{a.product_id}", 0))
        out.append(o)
    # Products you buy often first, then biggest saving
    out.sort(key=lambda o: (-(o.times_ordered > 0), -float(o.savings_pct or 0)))
    return out


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
