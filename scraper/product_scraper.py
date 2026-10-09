import asyncio
import json
import logging
from datetime import timedelta
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import select, text
import os
import sys
sys.path.insert(0, "/app")

CHECKPOINT_FILE = Path("/app/data/category_checkpoint.json")
CHECKPOINT_FILE.parent.mkdir(parents=True, exist_ok=True)
SKIP_IF_SCRAPED_WITHIN_HOURS = 20

# Checkpoint key prefixes
_SUBCAT_PREFIX = "sub:"
_KNOWN_SUBCATS_KEY = "_known_subcats"


def _load_checkpoint() -> dict:
    try:
        return json.loads(CHECKPOINT_FILE.read_text())
    except Exception:
        return {}


def _save_checkpoint(checkpoint: dict) -> None:
    try:
        CHECKPOINT_FILE.write_text(json.dumps(checkpoint))
    except Exception as e:
        log.warning(f"Failed to write checkpoint: {e}")


def _mark_done(key: str, checkpoint: dict) -> None:
    checkpoint[key] = datetime.now(timezone.utc).timestamp()
    _save_checkpoint(checkpoint)


from ah_client import AHClient, parse_product

log = logging.getLogger(__name__)

DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_async_engine(DATABASE_URL)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def upsert_product(session: AsyncSession, store_id: int, parsed: dict) -> None:
    from sqlalchemy import text

    # Upsert product
    result = await session.execute(
        text("SELECT id FROM products WHERE store_id = :sid AND external_id = :eid"),
        {"sid": store_id, "eid": parsed["external_id"]},
    )
    row = result.fetchone()

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)

    if row:
        product_id = row[0]
        await session.execute(
            text("""
                UPDATE products SET name=:name, brand=:brand, category=:category,
                sub_category=:sub_category, image_url=:image_url,
                product_group_name=CASE WHEN group_override THEN product_group_name ELSE :product_group_name END,
                product_type_group=CASE WHEN type_group_override THEN product_type_group ELSE :product_type_group END,
                shelf_life_days=COALESCE(:shelf_life_days, shelf_life_days),
                barcode=COALESCE(:barcode, barcode),
                bundle_child_external_id=COALESCE(:bundle_child_external_id, bundle_child_external_id),
                hq_id=COALESCE(:hq_id, hq_id),
                shop_type=COALESCE(:shop_type, shop_type),
                available_online=:available_online,
                nix18=:nix18,
                nutriscore_letter=COALESCE(:nutriscore_letter, nutriscore_letter),
                is_active=true,
                last_seen_at=:now
                WHERE id=:id
            """),
            {**{k: parsed[k] for k in ("name", "brand", "category", "sub_category", "image_url",
                "product_group_name", "product_type_group", "shelf_life_days", "barcode",
                "bundle_child_external_id", "hq_id", "shop_type", "available_online", "nix18",
                "nutriscore_letter")}, "id": product_id, "now": now},
        )
    else:
        result = await session.execute(
            text("""
                INSERT INTO products (store_id, external_id, name, brand, category, sub_category,
                    image_url, unit_type, shelf_life_days, product_group_name, product_type_group,
                    barcode, bundle_child_external_id, hq_id, shop_type, available_online,
                    nix18, nutriscore_letter, is_active, last_seen_at)
                VALUES (:store_id, :external_id, :name, :brand, :category, :sub_category,
                    :image_url, :unit_type, :shelf_life_days, :product_group_name, :product_type_group,
                    :barcode, :bundle_child_external_id, :hq_id, :shop_type, :available_online,
                    :nix18, :nutriscore_letter, true, :now)
                RETURNING id
            """),
            {"store_id": store_id, **{k: parsed[k] for k in (
                "external_id", "name", "brand", "category", "sub_category", "image_url",
                "unit_type", "shelf_life_days", "product_group_name", "product_type_group",
                "barcode", "bundle_child_external_id", "hq_id", "shop_type",
                "available_online", "nix18", "nutriscore_letter")}, "now": now},
        )
        product_id = result.fetchone()[0]

    # If bundle: inherit group name from child product (authoritative, no name-matching needed)
    if parsed.get("bundle_child_external_id"):
        child = await session.execute(
            text("SELECT product_group_name FROM products WHERE store_id=:sid AND external_id=:eid LIMIT 1"),
            {"sid": store_id, "eid": parsed["bundle_child_external_id"]},
        )
        child_row = child.fetchone()
        if child_row and child_row[0]:
            await session.execute(
                text("UPDATE products SET product_group_name=:gn WHERE id=:id AND NOT group_override"),
                {"gn": child_row[0], "id": product_id},
            )

    # Insert snapshot only if price/bonus state changed vs latest
    snap = parsed["snapshot"]
    last = await session.execute(
        text("""
            SELECT price, is_bonus, bonus_price, bonus_until
            FROM product_snapshots
            WHERE product_id = :pid
            ORDER BY scraped_at DESC LIMIT 1
        """),
        {"pid": product_id},
    )
    last_row = last.fetchone()
    if last_row:
        lp, lib, lbp, lbu = last_row
        def _eq(a, b):
            if a is None and b is None:
                return True
            if a is None or b is None:
                return False
            return round(float(a), 4) == round(float(b), 4)
        if (
            _eq(lp, snap["price"])
            and bool(lib) == bool(snap["is_bonus"])
            and _eq(lbp, snap["bonus_price"])
            and str(lbu) == str(snap["bonus_until"])
        ):
            return  # nothing changed

    await session.execute(
        text("""
            INSERT INTO product_snapshots
            (product_id, scraped_at, price, is_bonus, bonus_price, bonus_until,
             price_per_kg, price_per_litre, price_per_100g, price_per_100ml, price_per_piece,
             weight_g, volume_ml, pieces, nutrition)
            VALUES
            (:product_id, :scraped_at, :price, :is_bonus, :bonus_price, :bonus_until,
             :price_per_kg, :price_per_litre, :price_per_100g, :price_per_100ml, :price_per_piece,
             :weight_g, :volume_ml, :pieces, CAST(:nutrition AS json))
        """),
        {
            "product_id": product_id,
            "scraped_at": datetime.now(timezone.utc),
            "nutrition": __import__("json").dumps(snap["nutrition"]) if snap["nutrition"] else None,
            **{k: snap[k] for k in snap if k != "nutrition"},
        },
    )


async def _process_raw(raw: dict, store_id: int) -> bool:
    """Parse and upsert a single raw product dict. Returns True on success."""
    try:
        parsed = parse_product(raw)
        async with SessionLocal() as session:
            await upsert_product(session, store_id, parsed)
            await session.commit()
        return True
    except Exception as e:
        log.warning(f"Failed to parse product {raw.get('webshopId')}: {e}")
        return False


async def run_product_scrape(progress: dict | None = None):
    """
    Two-phase product scrape for maximum coverage.

    Phase 1 — Taxonomy sweep:
      Queries AH top-level categories (28) PLUS all leaf-level subcategory taxonomy IDs
      (68) exposed via the search filter facets. Pre-seeds known subcategory names from DB.

    Phase 2 — Sub-category keyword sweep:
      Searches by each unique subCategory name from: DB history + Phase 1 discoveries +
      taxonomy filter labels. Catches products that rank too low in taxonomy queries.

    Re-scans skip recently completed categories/sub-categories via checkpoint timestamps.
    """
    log.info("Starting product scrape (Phase 1: taxonomy sweep)")

    async with SessionLocal() as session:
        result = await session.execute(
            text("SELECT id FROM stores WHERE name = 'Albert Heijn' LIMIT 1")
        )
        store_id = result.scalar_one()

    checkpoint = _load_checkpoint()
    now_ts = datetime.now(timezone.utc).timestamp()
    skip_threshold = SKIP_IF_SCRAPED_WITHIN_HOURS * 3600

    # Sub-categories: start from checkpoint, then pre-seed from DB to never lose
    # subcategories that ranked too low in Phase 1 of the CURRENT run.
    discovered_subcats: set[str] = set(checkpoint.get(_KNOWN_SUBCATS_KEY, []))
    async with SessionLocal() as session:
        db_subcats = await session.execute(
            text("SELECT DISTINCT sub_category FROM products WHERE store_id = :sid AND sub_category IS NOT NULL"),
            {"sid": store_id},
        )
        for row in db_subcats:
            discovered_subcats.add(row[0])
    log.info(f"Pre-seeded {len(discovered_subcats)} sub-categories from checkpoint+DB")

    total = 0

    # ── Phase 1: Taxonomy sweep ────────────────────────────────────────────────
    async with AHClient() as client:
        top_cats = [c for c in await client.get_categories() if c.get("id") or c.get("taxonomyId")]

        # Also include the 68 leaf-level subcategory taxonomy IDs from search filter facets.
        # These cover niche subcategories (e.g. "Groenteconserven") that are too small to
        # dominate any top-level taxonomy sweep but have a dedicated filter bucket.
        tax_opts = await client.get_all_taxonomy_options()
        # Add their labels to Phase 2 seeds immediately
        for opt in tax_opts:
            if opt.get("label"):
                discovered_subcats.add(opt["label"])
        # Build the combined category list: top-level + subcategory IDs (deduplicated)
        top_ids = {str(c.get("id", c.get("taxonomyId", ""))) for c in top_cats}
        sub_cats_from_facets = [
            {"id": opt["id"], "name": opt["label"]}
            for opt in tax_opts
            if str(opt["id"]) not in top_ids
        ]
        all_cats = top_cats + sub_cats_from_facets
        log.info(f"Phase 1: {len(top_cats)} top-level + {len(sub_cats_from_facets)} subcategory taxonomy IDs = {len(all_cats)} total")

        if progress is not None:
            progress["phase"] = "1/2 Taxonomy sweep"
            progress["categories_total"] = len(all_cats)

        done = 0
        skipped = 0
        for cat in all_cats:
            cat_id = str(cat.get("id", cat.get("taxonomyId", "")))
            cat_name = cat.get("name", cat_id)

            last_scraped = checkpoint.get(cat_id)
            if last_scraped and (now_ts - last_scraped) < skip_threshold:
                age_h = (now_ts - last_scraped) / 3600
                log.info(f"Phase 1 skip {cat_name} (scraped {age_h:.1f}h ago)")
                skipped += 1
                if progress is not None:
                    progress["categories_skipped"] = skipped
                continue

            if progress is not None:
                progress["current_category"] = cat_name
                progress["categories_started"] = done + skipped + 1

            try:
                cat_total = 0
                page = 0
                while True:
                    try:
                        data = await client.get_products_by_category(cat_id, page=page)
                    except Exception as page_err:
                        # AH API returns 400 when page index exceeds their hard cap (~page 12).
                        # Treat as end-of-results rather than a failure.
                        err_str = str(page_err)
                        if "400" in err_str or "Bad Request" in err_str:
                            log.debug(f"Phase 1 {cat_name} page {page}: 400 = end of results")
                            break
                        raise
                    products = data.get("products", [])
                    if not products:
                        break
                    for raw in products:
                        # Collect sub-categories for Phase 2 regardless of processing outcome
                        sc = raw.get("subCategory")
                        if sc:
                            discovered_subcats.add(sc)
                        # Process all products (no mainCategory filter — AH taxonomy API
                        # returns a relevance-ranked full catalog, not just this category)
                        if await _process_raw(raw, store_id):
                            cat_total += 1
                            total += 1
                            if progress is not None:
                                progress["products_this_run"] = total
                    if len(products) < client.PAGE_SIZE:
                        break
                    page += 1

                done += 1
                log.info(f"Phase 1 category {cat_name}: {cat_total} products ({page} pages)")
                if progress is not None:
                    progress["categories_done"] = done

                # Persist discovered sub-categories and mark category done
                checkpoint[_KNOWN_SUBCATS_KEY] = sorted(discovered_subcats)
                _mark_done(cat_id, checkpoint)

            except Exception as e:
                log.error(f"Phase 1 failed category {cat_id} ({cat_name}): {e}")

    # ── Phase 2: Sub-category sweep ────────────────────────────────────────────
    log.info(f"Phase 2: {len(discovered_subcats)} sub-categories to search")
    if progress is not None:
        progress["phase"] = "2/2 Sub-category sweep"
        progress["subcats_total"] = len(discovered_subcats)

    subcat_done = 0
    subcat_skipped = 0

    async with AHClient() as client:
        for sub_cat in sorted(discovered_subcats):
            key = f"{_SUBCAT_PREFIX}{sub_cat}"
            last_scraped = checkpoint.get(key)
            if last_scraped and (now_ts - last_scraped) < skip_threshold:
                subcat_skipped += 1
                if progress is not None:
                    progress["subcats_skipped"] = subcat_skipped
                continue

            if progress is not None:
                progress["current_subcat"] = sub_cat
                progress["subcats_started"] = subcat_done + subcat_skipped + 1

            try:
                sub_total = 0
                page = 0
                while True:
                    products = await client.search_products(sub_cat, page=page)
                    if not products:
                        break
                    for raw in products:
                        if await _process_raw(raw, store_id):
                            sub_total += 1
                            total += 1
                            if progress is not None:
                                progress["products_this_run"] = total
                    if len(products) < client.PAGE_SIZE:
                        break
                    page += 1

                subcat_done += 1
                log.info(f"Phase 2 sub-category '{sub_cat}': {sub_total} products")
                if progress is not None:
                    progress["subcats_done"] = subcat_done
                _mark_done(key, checkpoint)

            except Exception as e:
                log.error(f"Phase 2 failed sub-category '{sub_cat}': {e}")

    log.info(f"Product scrape complete: {total} products processed")
    log.info(f"Discovered {len(discovered_subcats)} unique sub-categories")

    # Deactivate products not seen in recent scrapes (3x daily cycle buffer)
    try:
        async with SessionLocal() as session:
            cutoff = datetime.now(timezone.utc) - timedelta(days=3)
            deactivated = await session.execute(text("""
                UPDATE products SET is_active = false
                WHERE store_id = :sid
                  AND is_active = true
                  AND (last_seen_at IS NULL OR last_seen_at < :cutoff)
            """), {"sid": store_id, "cutoff": cutoff})
            await session.commit()
            if deactivated.rowcount:
                log.info(f"Deactivated {deactivated.rowcount} products not seen since {cutoff.date()}")
    except Exception as e:
        log.warning(f"Product deactivation step failed (non-fatal): {e}")
