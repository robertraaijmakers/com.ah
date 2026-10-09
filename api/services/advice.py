from datetime import datetime, timedelta, timezone
from decimal import Decimal
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from models import Product, ProductSnapshot, BuyAdvice


async def generate_buy_advice(db: AsyncSession) -> int:
    """Run advice engine. Returns count of new advice records created."""

    # Dismiss expired advice
    now = datetime.now(timezone.utc)
    expired_result = await db.execute(
        select(BuyAdvice).where(BuyAdvice.expires_at < now, BuyAdvice.dismissed == False)
    )
    for adv in expired_result.scalars().all():
        adv.dismissed = True

    cutoff_90 = now - timedelta(days=90)
    created = 0

    # Find products with price history (at least 5 snapshots)
    products_result = await db.execute(
        select(Product.id)
        .join(ProductSnapshot, Product.id == ProductSnapshot.product_id)
        .where(ProductSnapshot.scraped_at >= cutoff_90)
        .group_by(Product.id)
        .having(func.count(ProductSnapshot.id) >= 5)
    )
    product_ids = [row[0] for row in products_result.all()]

    for product_id in product_ids:
        # Skip if undismissed advice already exists for this product
        existing = await db.execute(
            select(BuyAdvice).where(
                BuyAdvice.product_id == product_id,
                BuyAdvice.dismissed == False,
            )
        )
        if existing.scalar_one_or_none():
            continue

        # Get latest snapshot
        latest_result = await db.execute(
            select(ProductSnapshot)
            .where(ProductSnapshot.product_id == product_id)
            .order_by(ProductSnapshot.scraped_at.desc())
            .limit(1)
        )
        latest = latest_result.scalar_one_or_none()
        if not latest:
            continue

        # Calculate 90-day average
        avg_result = await db.execute(
            select(func.avg(ProductSnapshot.price))
            .where(
                ProductSnapshot.product_id == product_id,
                ProductSnapshot.scraped_at >= cutoff_90,
            )
        )
        avg_price = avg_result.scalar_one_or_none()
        if not avg_price:
            continue

        avg_price = Decimal(str(avg_price))
        current = latest.effective_price
        savings_pct = ((avg_price - current) / avg_price * 100) if avg_price > 0 else Decimal("0")

        if savings_pct >= 15 or latest.is_bonus:
            advice_type = "on_sale"
            message = f"Currently {savings_pct:.0f}% below 90-day average (€{avg_price:.2f}). Good time to stock up."
        else:
            continue

        advice = BuyAdvice(
            product_id=product_id,
            advice_type=advice_type,
            current_price=current,
            avg_price_90d=avg_price,
            savings_pct=savings_pct,
            message=message,
            expires_at=now + timedelta(days=7),
        )
        db.add(advice)
        created += 1

    await db.commit()
    return created
