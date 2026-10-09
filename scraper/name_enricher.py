"""Query Open Food Facts for English product names using EAN barcodes."""
import asyncio
import logging
import os
import sys
sys.path.insert(0, "/app")

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import text

log = logging.getLogger(__name__)

DATABASE_URL = os.environ["DATABASE_URL"]
OFF_BASE = "https://world.openfoodfacts.org/api/v2/product"
BATCH = 50  # products per run to stay polite


async def enrich_product_names(limit: int = BATCH) -> dict:
    """Fetch English names from Open Food Facts for products with a barcode but no name_en."""
    engine = create_async_engine(DATABASE_URL)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with SessionLocal() as session:
        result = await session.execute(
            text("""
                SELECT id, barcode, name FROM products
                WHERE barcode IS NOT NULL AND barcode != ''
                  AND (name_en IS NULL OR name_en = '')
                ORDER BY id
                LIMIT :lim
            """),
            {"lim": limit},
        )
        rows = result.fetchall()

    log.info(f"Enriching {len(rows)} products via Open Food Facts")
    enriched = skipped = failed = 0

    async with httpx.AsyncClient(timeout=10, headers={"User-Agent": "AHPlanner/1.0 (personal grocery app)"}) as client:
        for product_id, barcode, name in rows:
            await asyncio.sleep(0.3)  # polite rate limit
            try:
                resp = await client.get(
                    f"{OFF_BASE}/{barcode}",
                    params={"fields": "product_name_en,product_name_nl,product_name"},
                )
                if resp.status_code == 404:
                    skipped += 1
                    continue
                resp.raise_for_status()
                data = resp.json()
                product = data.get("product") or {}

                name_en = (
                    product.get("product_name_en")
                    or product.get("product_name")
                    or None
                )
                if name_en:
                    name_en = name_en.strip() or None

                if not name_en:
                    skipped += 1
                    continue

                async with SessionLocal() as session:
                    await session.execute(
                        text("UPDATE products SET name_en = :name_en WHERE id = :id"),
                        {"name_en": name_en, "id": product_id},
                    )
                    await session.commit()
                    enriched += 1
                    log.debug(f"  {name} → {name_en}")

            except Exception as e:
                log.warning(f"OFF lookup failed for barcode {barcode}: {e}")
                failed += 1

    await engine.dispose()
    log.info(f"Enrichment done: {enriched} enriched, {skipped} skipped, {failed} failed")
    return {"enriched": enriched, "skipped": skipped, "failed": failed, "total": len(rows)}
