import asyncio
import json
import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import text

from ah_client import AHClient

log = logging.getLogger(__name__)

_NUTRIENT_MAP: dict[str, dict[str, str]] = {
    "ENER-": {"kcal": "energy_kcal", "kJ": "energy_kj"},
    "FAT":   {"g": "fat"},
    "FASAT": {"g": "saturated_fat"},
    "CHOAVL": {"g": "carbohydrates"},
    "SUGAR-": {"g": "sugars"},
    "FIBTG": {"g": "fiber"},
    "PRO-":  {"g": "protein"},
    "SALTEQ": {"g": "salt"},
}

# Property key prefixes: sp_include_ means product QUALIFIES for that filter
_DIETARY_MAP = {
    "sp_include_dieet_vegetarisch": "vegetarian",
    "sp_include_dieet_veganistisch": "vegan",
    "sp_exclude_dieet_veganistisch": "not_vegan",  # resolved below
    "sp_include_intolerance_geen_gluten": "gluten_free",
    "sp_exclude_intolerance_geen_gluten": "contains_gluten",
    "sp_include_intolerance_geen_lactose": "lactose_free",
    "sp_exclude_intolerance_geen_lactose": "contains_lactose",
    "sp_include_intolerance_geen_noten": "nut_free",
    "sp_include_intolerance_geen_pindas": "peanut_free",
    "sp_include_intolerance_geen_vis": "fish_free",
    "sp_include_intolerance_geen_eieren": "egg_free",
    "sp_include_intolerance_geen_soja": "soy_free",
}


def _parse_nutrition(detail: dict) -> dict | None:
    ni = detail.get("tradeItem", {}).get("nutritionalInformation", {})
    headers = ni.get("nutrientHeaders", [])
    if not headers:
        return None

    header = headers[0]
    basis = header.get("nutrientBasisQuantity", {})
    per_value = float(basis.get("value") or 100)
    per_unit_code = basis.get("measurementUnitCode", {}).get("value", "g")
    result: dict = {"per_unit": f"100{per_unit_code}"}

    for nd in header.get("nutrientDetail", []):
        code = nd.get("nutrientTypeCode", {}).get("value")
        if code not in _NUTRIENT_MAP:
            continue
        for q in nd.get("quantityContained", []):
            unit = q.get("measurementUnitCode", {}).get("value")
            field = _NUTRIENT_MAP[code].get(unit)
            if field and q.get("value") is not None:
                raw_val = float(q["value"])
                normalized = round(raw_val * 100 / per_value, 4) if per_value != 100 else round(raw_val, 4)
                result[field] = normalized

    return result if len(result) > 1 else None


def _parse_dietary_flags(detail: dict) -> dict:
    props: dict = detail.get("properties", {})
    flags: dict = {}

    for prop_key, flag_name in _DIETARY_MAP.items():
        if prop_key in props:
            if flag_name == "not_vegan":
                flags["vegan"] = False
            elif flag_name.startswith("contains_"):
                inverse = flag_name.replace("contains_", "") + "_free"
                flags[inverse] = False
            else:
                flags[flag_name] = True

    # Resolve available_in_store from da_available_in_store property
    if "da_available_in_store" in props:
        val = props["da_available_in_store"]
        if isinstance(val, list):
            val = val[0] if val else None
        available_in_store = str(val).lower() == "true" if val is not None else None
    else:
        available_in_store = None

    return {"flags": flags, "available_in_store": available_in_store}


def _parse_ingredients(detail: dict) -> str | None:
    trade = detail.get("tradeItem", {})
    for key in ("ingredientStatement", "ingredients", "ingredientsText"):
        val = trade.get(key)
        if val and isinstance(val, str):
            return val.strip() or None
    # Some responses nest it directly on the root
    for key in ("ingredientStatement", "ingredients"):
        val = detail.get(key)
        if val and isinstance(val, str):
            return val.strip() or None
    return None


async def enrich_nutrition(db_url: str, store_id: int, batch_size: int = 500) -> dict:
    engine = create_async_engine(db_url, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    updated = 0
    skipped = 0
    errors = 0

    async with Session() as session:
        rows = (await session.execute(text("""
            SELECT DISTINCT ON (p.id) p.id, p.external_id, ps.id AS snapshot_id
            FROM products p
            JOIN product_snapshots ps ON ps.product_id = p.id
            WHERE p.store_id = :store_id
              AND p.is_active = true
              AND (
                p.details_scraped_at IS NULL
                OR p.details_scraped_at < NOW() - INTERVAL '30 days'
                OR (p.details_scrape_error IS NOT NULL
                    AND p.details_scraped_at < NOW() - INTERVAL '1 day')
              )
            ORDER BY p.id, ps.scraped_at DESC
            LIMIT :lim
        """), {"store_id": store_id, "lim": batch_size})).fetchall()

    log.info("nutrition_enricher: %d products to enrich", len(rows))

    now = datetime.now(timezone.utc)
    sem = asyncio.Semaphore(5)  # max 5 concurrent AH API requests

    counters = {"updated": 0, "skipped": 0, "errors": 0}

    async def _enrich_one(client: AHClient, row) -> None:
        async with sem:
            try:
                detail = await client._get(f"/mobile-services/product/detail/v4/fir/{row.external_id}")

                nutrition = _parse_nutrition(detail)
                extra = _parse_dietary_flags(detail)
                ingredients = _parse_ingredients(detail)

                trade = detail.get("tradeItem", {})
                gln = trade.get("gln")
                gtin = (trade.get("gtin") or "").lstrip("0") or None
                if gtin and len(gtin) < 8:
                    gtin = None

                async with Session() as session:
                    await session.execute(text("""
                        UPDATE products
                        SET gln = COALESCE(:gln, gln),
                            barcode = COALESCE(:gtin, barcode),
                            available_in_store = COALESCE(:ais, available_in_store),
                            dietary_flags = COALESCE(CAST(:flags AS json), dietary_flags),
                            ingredients = COALESCE(:ingredients, ingredients),
                            details_scraped_at = :now,
                            details_scrape_error = NULL
                        WHERE id = :pid
                    """), {
                        "gln": gln,
                        "gtin": gtin,
                        "ais": extra["available_in_store"],
                        "flags": json.dumps(extra["flags"]) if extra["flags"] else None,
                        "ingredients": ingredients,
                        "now": now,
                        "pid": row.id,
                    })

                    if nutrition:
                        await session.execute(text("""
                            UPDATE product_snapshots
                            SET nutrition = CAST(:nut AS jsonb)
                            WHERE id = :sid
                        """), {"nut": json.dumps(nutrition), "sid": row.snapshot_id})
                        counters["updated"] += 1
                    else:
                        counters["skipped"] += 1

                    await session.commit()
                    log.debug("enriched %s (nutrition=%s)", row.external_id, nutrition is not None)

            except Exception as exc:
                log.warning("detail enrich failed for %s: %s", row.external_id, exc)
                counters["errors"] += 1
                err_msg = str(exc)[:500]
                try:
                    async with Session() as session:
                        await session.execute(text("""
                            UPDATE products
                            SET details_scraped_at = :now,
                                details_scrape_error = :err
                            WHERE id = :pid
                        """), {"now": now, "err": err_msg, "pid": row.id})
                        await session.commit()
                except Exception:
                    pass

    async with AHClient() as client:
        await asyncio.gather(*[_enrich_one(client, row) for row in rows])

    updated = counters["updated"]
    skipped = counters["skipped"]
    errors = counters["errors"]

    # Propagate nutrition from single items to their bundle products.
    # Bundles (N×pack) have the same per-100g nutrition as the child; AH's detail endpoint
    # returns no nutrition for virtual bundles, so we copy it from the child's latest snapshot.
    async with Session() as session:
        bundle_result = await session.execute(text("""
            WITH child_nutrition AS (
                SELECT
                    p_bundle.id          AS bundle_product_id,
                    p_bundle.store_id    AS store_id,
                    ps_child.nutrition   AS nutrition
                FROM products p_bundle
                JOIN products p_child
                  ON p_child.store_id    = p_bundle.store_id
                 AND p_child.external_id = p_bundle.bundle_child_external_id
                JOIN LATERAL (
                    SELECT nutrition
                    FROM product_snapshots
                    WHERE product_id = p_child.id
                    ORDER BY scraped_at DESC LIMIT 1
                ) ps_child ON true
                WHERE p_bundle.store_id = :sid
                  AND p_bundle.bundle_child_external_id IS NOT NULL
                  AND p_bundle.is_active = true
                  AND ps_child.nutrition IS NOT NULL
            )
            UPDATE product_snapshots ps_bundle
            SET nutrition = cn.nutrition
            FROM child_nutrition cn
            WHERE ps_bundle.product_id = cn.bundle_product_id
              AND ps_bundle.id = (
                  SELECT id FROM product_snapshots
                  WHERE product_id = cn.bundle_product_id
                  ORDER BY scraped_at DESC LIMIT 1
              )
              AND ps_bundle.nutrition IS NULL
        """), {"sid": store_id})
        bundle_nutrition_updated = bundle_result.rowcount

        # Mark those bundles as successfully enriched (clear any error state)
        await session.execute(text("""
            UPDATE products p_bundle
            SET details_scraped_at  = NOW(),
                details_scrape_error = NULL
            FROM products p_child
            JOIN LATERAL (
                SELECT nutrition
                FROM product_snapshots
                WHERE product_id = p_child.id
                ORDER BY scraped_at DESC LIMIT 1
            ) ps_child ON true
            WHERE p_bundle.bundle_child_external_id = p_child.external_id
              AND p_bundle.store_id = p_child.store_id
              AND p_bundle.store_id = :sid
              AND ps_child.nutrition IS NOT NULL
              AND (p_bundle.details_scraped_at IS NULL
                   OR p_bundle.details_scrape_error IS NOT NULL)
        """), {"sid": store_id})
        await session.commit()

    if bundle_nutrition_updated:
        log.info("Propagated nutrition to %d bundle snapshots from child products", bundle_nutrition_updated)

    # Count products currently in error state (for reporting)
    async with Session() as session:
        error_count = (await session.execute(text(
            "SELECT COUNT(*) FROM products WHERE store_id = :sid AND details_scrape_error IS NOT NULL",
        ), {"sid": store_id})).scalar() or 0

    await engine.dispose()
    return {
        "updated": updated,
        "skipped": skipped,
        "errors": errors,
        "total": len(rows),
        "bundle_nutrition_updated": bundle_nutrition_updated,
        "products_with_error": error_count,
    }
