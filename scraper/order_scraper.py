import asyncio
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import text
import os
import json

from ah_client import AHClient

log = logging.getLogger(__name__)

DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_async_engine(DATABASE_URL)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

PAGE_SIZE = 50


def _detect_pos_channel(receipt: dict) -> str:
    # POS receipts are always in-store; online orders come via the orders endpoint
    return "in_shop"


def _parse_date(raw: str) -> datetime | None:
    """Parse ISO datetime string; always returns tz-aware UTC datetime or None."""
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


async def _get_existing_ids(session: AsyncSession, store_id: int) -> set[str]:
    """Load all known order external_ids for this store into a set for O(1) dedup."""
    rows = await session.execute(
        text("SELECT external_id FROM orders WHERE store_id = :sid AND external_id IS NOT NULL"),
        {"sid": store_id},
    )
    return {r[0] for r in rows}


async def _insert_order(
    session: AsyncSession,
    store_id: int,
    external_id: str,
    order_date: datetime,
    total: float,
    channel: str,
    raw: dict,
) -> int:
    res = await session.execute(
        text("""
            INSERT INTO orders (store_id, external_id, order_date, total_price, order_channel, raw_json)
            VALUES (:sid, :eid, :dt, :total, :channel, CAST(:raw AS jsonb))
            ON CONFLICT DO NOTHING
            RETURNING id
        """),
        {"sid": store_id, "eid": external_id, "dt": order_date,
         "total": total, "channel": channel, "raw": json.dumps(raw)},
    )
    row = res.fetchone()
    return row[0] if row else None


def _extract_item_fields(product: dict) -> tuple[str, str | None, str | None, str | None, float, float, float]:
    """Return (name, webshop_id, hq_id, ean, qty, price_paid, regular_price).

    price_paid   = currentPrice (actual charged, lower when on bonus)
    regular_price = priceBeforeBonus (list price; equals price_paid when not on bonus)

    Handles two formats:
    - POS receipt product: top-level dict with id (POS id), name, price/amount.
      After ConvertPOSIDs enrichment, may have a 'webshop_id' key injected.
    - Online order (taxonomy format): nested product dict with webshopId + orderedProduct qty/price.
    """
    product_node = product.get("product") or product

    name = product_node.get("name") or product_node.get("title") or ""

    # Online taxonomy format: webshopId is in the nested product node
    # POS: injected as webshop_id (snake_case) at top-level after convert_pos_ids
    webshop_id = str(product_node.get("webshopId") or product_node.get("webshop_id") or product.get("webshop_id") or "") or None
    hq_id = None  # taxonomy endpoint doesn't expose hqId; POS uses id (pos-space, not webshop)
    ean = str(product_node.get("ean") or "") or None

    qty = float(product.get("quantity", 1))

    regular_price = float(product_node.get("priceBeforeBonus") or 0)
    current_price = float(product_node.get("currentPrice") or 0)

    if regular_price == 0 and current_price == 0:
        # POS fallback: price.amount is unit price, amount.amount is line total
        price_obj = product.get("price") or {}
        current_price = float(price_obj.get("amount") or 0)
        if current_price == 0:
            amount_obj = product.get("amount") or {}
            line_total = float(amount_obj.get("amount") or 0)
            current_price = round(line_total / qty, 4) if qty > 0 else line_total
        regular_price = current_price  # POS has no bonus breakdown
    elif regular_price == 0:
        regular_price = current_price  # not on bonus: list price = paid price
    elif current_price == 0:
        current_price = regular_price  # no current price exposed: assume list price

    return name, webshop_id, hq_id, ean, qty, current_price, regular_price


async def _match_product(
    session: AsyncSession,
    store_id: int,
    webshop_id: str | None,
    hq_id: str | None,
    ean: str | None,
    name: str,
) -> tuple[int | None, str]:
    """
    4-level product matching: webshopId → hqId → barcode/EAN → fuzzy name.
    Returns (product_id, confidence).
    """
    # Level 1a: match by webshop ID (products.external_id = AH webshopId)
    if webshop_id:
        r = await session.execute(
            text("SELECT id FROM products WHERE store_id=:sid AND external_id=:eid LIMIT 1"),
            {"sid": store_id, "eid": webshop_id},
        )
        pid = r.scalar_one_or_none()
        if pid:
            return pid, "exact"

    # Level 1b: match by hqId (products.hq_id column)
    if hq_id:
        try:
            hq_id_int = int(hq_id)
            r = await session.execute(
                text("SELECT id FROM products WHERE store_id=:sid AND hq_id=:hid LIMIT 1"),
                {"sid": store_id, "hid": hq_id_int},
            )
            pid = r.scalar_one_or_none()
            if pid:
                return pid, "exact"
        except ValueError:
            pass

    # Level 2: match by EAN/barcode (stored in products.barcode since enrichment)
    external_id = webshop_id  # kept for store in order_items.external_product_id
    if ean and len(ean) >= 8:
        r = await session.execute(
            text("SELECT id FROM products WHERE store_id=:sid AND barcode=:ean LIMIT 1"),
            {"sid": store_id, "ean": ean},
        )
        pid = r.scalar_one_or_none()
        if pid:
            return pid, "exact"

    # Level 3: fuzzy name match — require ALL significant words in product name
    if name and len(name) >= 3:
        words = [w for w in name.lower().split() if len(w) >= 3][:4]
        if words:
            conditions = " AND ".join([f"lower(p.name) LIKE :w{i}" for i in range(len(words))])
            params: dict = {"sid": store_id}
            params.update({f"w{i}": f"%{w}%" for i, w in enumerate(words)})
            r = await session.execute(
                text(f"SELECT p.id FROM products p WHERE p.store_id=:sid AND {conditions} LIMIT 1"),
                params,
            )
            pid = r.scalar_one_or_none()
            if pid:
                return pid, "fuzzy"

    return None, "none"


async def _insert_items(session: AsyncSession, order_id: int, store_id: int, products: list[dict]) -> None:
    for product in products:
        name, webshop_id, hq_id, ean, qty, price_paid, regular_price = _extract_item_fields(product)
        product_id, confidence = await _match_product(session, store_id, webshop_id, hq_id, ean, name)
        await session.execute(
            text("""
                INSERT INTO order_items
                  (order_id, product_id, ingredient_name, external_product_id, match_confidence, quantity, price_paid, regular_price)
                VALUES (:oid, :pid, :name, :epid, :conf, :qty, :price, :reg_price)
                ON CONFLICT DO NOTHING
            """),
            {
                "oid": order_id, "pid": product_id, "name": name,
                "epid": webshop_id or hq_id, "conf": confidence,
                "qty": qty, "price": price_paid, "reg_price": regular_price,
            },
        )


async def _scrape_pos_receipts(
    client: AHClient, store_id: int, cutoff: datetime, existing_ids: set[str]
) -> tuple[int, set[str]]:
    """Fetch in-store (POS) receipts back to cutoff. Returns (count_imported, new_ids)."""
    imported = 0
    new_ids: set[str] = set()
    offset = 0

    while True:
        receipts = await client.get_pos_receipts_page(offset=offset, limit=PAGE_SIZE)
        if not receipts:
            break

        page_dates: list[datetime] = []
        for receipt in receipts:
            receipt_id = str(receipt["id"])
            order_date = _parse_date(receipt.get("dateTime", ""))
            if order_date:
                page_dates.append(order_date)

            if receipt_id in existing_ids or receipt_id in new_ids:
                continue

            # Stop importing if clearly before cutoff, but keep paging to find newer ones
            if order_date and order_date < cutoff:
                continue

            try:
                details = await client.get_pos_receipt_details(receipt_id)
                products = details.get("products", [])

                # Batch-convert POS product IDs to webshop IDs for exact matching
                pos_ids = [p.get("id") for p in products if p.get("id")]
                if pos_ids:
                    try:
                        id_map = await client.convert_pos_ids(pos_ids)
                        for p in products:
                            ws_id = id_map.get(p.get("id"))
                            if ws_id:
                                p["webshop_id"] = str(ws_id)
                    except Exception as conv_err:
                        log.warning(f"POS ID conversion failed for {receipt_id}: {conv_err}")

                channel = _detect_pos_channel(receipt)
                total = float((receipt.get("totalAmount") or {}).get("amount", 0) or 0)
                dt = order_date or datetime.now(timezone.utc)

                async with SessionLocal() as session:
                    order_id = await _insert_order(session, store_id, receipt_id, dt, total, channel, receipt)
                    if order_id:
                        await _insert_items(session, order_id, store_id, products)
                        await session.commit()
                        imported += 1
                        new_ids.add(receipt_id)
                        log.info(f"Imported POS receipt {receipt_id} ({len(products)} items, {channel})")
            except Exception as e:
                log.error(f"Failed POS receipt {receipt_id}: {e}")

        # Stop paging when all dates on this page are before the cutoff
        if page_dates and min(page_dates) < cutoff:
            break
        if not page_dates:
            break  # no parseable dates — stop to avoid infinite loop
        offset += PAGE_SIZE
        await asyncio.sleep(0.5)

    return imported, new_ids


def _flatten_taxonomy_products(details: dict) -> list[dict]:
    """Flatten groupedProductsInTaxonomy into a list of product dicts compatible with _extract_item_fields."""
    products = []
    for group in details.get("groupedProductsInTaxonomy", []):
        for op in group.get("orderedProducts", []):
            products.append({
                "product": op.get("product", {}),
                "quantity": op.get("quantity", 1),
            })
    return products


async def _scrape_online_orders(
    client: AHClient, store_id: int, cutoff: datetime, existing_ids: set[str]
) -> int:
    """Fetch online orders (CLOSED fulfillments) back to cutoff, paginating until exhausted."""
    imported = 0
    offset = 0

    while True:
        page = await client.get_online_orders_page(offset=offset, limit=PAGE_SIZE)
        if not page:
            break
        offset += len(page)

        stop_early = False
        for order in page:
            order_id_ext = str(order.get("orderId", ""))
            if not order_id_ext:
                continue

            raw_date = (order.get("delivery") or {}).get("slot", {}).get("date") or ""
            order_date = _parse_date(raw_date)

            if order_date and order_date < cutoff:
                stop_early = True
                continue
            if order_id_ext in existing_ids:
                continue

            try:
                details = await client.get_online_order_details(order_id_ext)
                products = _flatten_taxonomy_products(details)
                total = float((order.get("totalPrice") or {}).get("totalPrice", {}).get("amount") or 0)
                dt = order_date or datetime.now(timezone.utc)

                async with SessionLocal() as session:
                    order_id_db = await _insert_order(session, store_id, order_id_ext, dt, total, "online", order)
                    if order_id_db:
                        await _insert_items(session, order_id_db, store_id, products)
                        await session.commit()
                        imported += 1
                        log.info(f"Imported online order {order_id_ext} ({len(products)} items)")
                await asyncio.sleep(0.3)
            except Exception as e:
                log.error(f"Failed online order {order_id_ext}: {e}")

        if stop_early:
            break

    return imported


async def run_order_scrape(full: bool = False) -> dict:
    """
    Scrape orders from AH API.

    Cutoff logic:
    - full=True: always go back 365 days
    - full=False (incremental): use MAX(order_date) from DB minus 2-day overlap.
      Falls back to 365 days if DB is empty, so first run is always a full scrape.

    Deduplication: preloads all known external IDs into memory for O(1) set lookup,
    avoiding an N+1 query per receipt.
    """
    async with AHClient() as client:
        if not client._token:
            log.warning("No auth token — skipping order scrape. Authenticate via UI first.")
            return {"pos": 0, "online": 0, "skipped": True}

        async with SessionLocal() as session:
            store_id = (await session.execute(
                text("SELECT id FROM stores WHERE name = 'Albert Heijn' LIMIT 1")
            )).scalar_one()

            last_order_date = (await session.execute(
                text("SELECT MAX(order_date) FROM orders WHERE store_id = :sid"),
                {"sid": store_id},
            )).scalar_one_or_none()

            # full=True: fetch everything the API exposes (no cutoff)
            # incremental: from last known order minus 2-day overlap
            # empty DB: treat as full
            if full or last_order_date is None:
                cutoff = datetime(2000, 1, 1, tzinfo=timezone.utc)  # effectively no cutoff
                mode = "full (all history)"
            else:
                cutoff = last_order_date - timedelta(days=2)
                mode = f"incremental (from {last_order_date.date()} -2d)"

            existing_ids = await _get_existing_ids(session, store_id)

        log.info(f"Starting order scrape: {mode}, {len(existing_ids)} orders already in DB")

        pos_count, new_pos_ids = await _scrape_pos_receipts(client, store_id, cutoff, existing_ids)
        existing_ids.update(new_pos_ids)  # avoid re-checking POS IDs in online pass
        online_count = await _scrape_online_orders(client, store_id, cutoff, existing_ids)

    log.info(f"Order scrape complete: {pos_count} POS receipts, {online_count} online orders imported")
    return {"pos": pos_count, "online": online_count, "skipped": False}


async def preview_order_scrape() -> dict:
    """
    Fetch and parse 1 POS receipt + 1 online order without saving to DB.
    Returns parsed preview so the operator can validate matching quality.
    """
    async with AHClient() as client:
        if not client._token:
            return {"error": "No auth token — authenticate via UI first."}

        async with SessionLocal() as session:
            store_id = (await session.execute(
                text("SELECT id FROM stores WHERE name = 'Albert Heijn' LIMIT 1")
            )).scalar_one()

        result: dict = {"pos": None, "online": None}

        # --- POS: fetch first receipt ---
        try:
            receipts = await client.get_pos_receipts_page(offset=0, limit=1)
            if receipts:
                r = receipts[0]
                receipt_id = str(r["id"])
                order_date = _parse_date(r.get("dateTime", ""))
                details = await client.get_pos_receipt_details(receipt_id)
                pos_products = details.get("products", [])
                pos_ids = [p.get("id") for p in pos_products if p.get("id")]
                if pos_ids:
                    try:
                        id_map = await client.convert_pos_ids(pos_ids)
                        for p in pos_products:
                            ws_id = id_map.get(p.get("id"))
                            if ws_id:
                                p["webshop_id"] = str(ws_id)
                    except Exception:
                        pass
                items = []
                async with SessionLocal() as session:
                    for p in pos_products:
                        name, webshop_id, hq_id, ean, qty, price, regular_price = _extract_item_fields(p)
                        product_id, confidence = await _match_product(
                            session, store_id, webshop_id, hq_id, ean, name
                        )
                        product_name = None
                        if product_id:
                            row = (await session.execute(
                                text("SELECT name FROM products WHERE id=:pid"), {"pid": product_id}
                            )).one_or_none()
                            product_name = row[0] if row else None
                        items.append({
                            "name": name,
                            "webshop_id": webshop_id,
                            "hq_id": hq_id,
                            "ean": ean,
                            "qty": qty,
                            "price_paid": price,
                            "regular_price": regular_price,
                            "matched_product_id": product_id,
                            "matched_product_name": product_name,
                            "confidence": confidence,
                        })
                result["pos"] = {
                    "receipt_id": receipt_id,
                    "order_date": order_date.isoformat() if order_date else None,
                    "channel": _detect_pos_channel(r),
                    "total": float((r.get("totalAmount") or {}).get("amount", 0) or 0),
                    "items": items,
                    "raw_receipt_keys": list(r.keys()),
                }
        except Exception as e:
            result["pos"] = {"error": str(e)}

        # --- Online: fetch first CLOSED fulfillment ---
        try:
            orders = await client.get_online_orders_page(offset=0, limit=1)
            if orders:
                o = orders[0]
                order_id_ext = str(o.get("orderId", ""))
                raw_date = (o.get("delivery") or {}).get("slot", {}).get("date") or ""
                order_date = _parse_date(raw_date)
                details = await client.get_online_order_details(order_id_ext)
                products = _flatten_taxonomy_products(details)
                items = []
                async with SessionLocal() as session:
                    for line in products:
                        name, webshop_id, hq_id, ean, qty, price, regular_price = _extract_item_fields(line)
                        product_id, confidence = await _match_product(
                            session, store_id, webshop_id, hq_id, ean, name
                        )
                        product_name = None
                        if product_id:
                            row = (await session.execute(
                                text("SELECT name FROM products WHERE id=:pid"), {"pid": product_id}
                            )).one_or_none()
                            product_name = row[0] if row else None
                        items.append({
                            "name": name,
                            "webshop_id": webshop_id,
                            "hq_id": hq_id,
                            "ean": ean,
                            "qty": qty,
                            "price_paid": price,
                            "regular_price": regular_price,
                            "matched_product_id": product_id,
                            "matched_product_name": product_name,
                            "confidence": confidence,
                        })
                result["online"] = {
                    "order_id": order_id_ext,
                    "order_date": order_date.isoformat() if order_date else None,
                    "total": float((o.get("totalPrice") or {}).get("totalPrice", {}).get("amount") or 0),
                    "items": items,
                    "raw_order_keys": list(o.keys()),
                }
        except Exception as e:
            result["online"] = {"error": str(e)}

    return result


async def rematch_order_items() -> dict:
    """
    Re-attempt product matching for all order_items without exact confidence.
    Run after a fresh product scrape to pick up newly-enriched barcodes.
    """
    log.info("Starting order item re-matching")
    updated = 0
    still_unmatched = 0

    async with SessionLocal() as session:
        store_id = (await session.execute(
            text("SELECT id FROM stores WHERE name = 'Albert Heijn' LIMIT 1")
        )).scalar_one()

        items = (await session.execute(
            text("""
                SELECT id, ingredient_name, external_product_id
                FROM order_items
                WHERE match_confidence != 'exact'
                ORDER BY id
            """)
        )).fetchall()

    for item_id, name, external_id in items:
        async with SessionLocal() as session:
            pid, confidence = await _match_product(session, store_id, external_id, None, None, name or "")
            if pid:
                await session.execute(
                    text("UPDATE order_items SET product_id=:pid, match_confidence=:conf WHERE id=:iid"),
                    {"pid": pid, "conf": confidence, "iid": item_id},
                )
                await session.commit()
                updated += 1
            else:
                still_unmatched += 1

    log.info(f"Re-match complete: {updated} updated, {still_unmatched} still unmatched")
    return {"updated": updated, "still_unmatched": still_unmatched}


async def reprice_order_items() -> dict:
    """
    Re-fetch all order details from AH API and update price_paid (actual) + regular_price (pre-bonus).
    Run this once after migration 016 to backfill bonus savings data for historical orders.
    """
    log.info("Starting order item reprice")
    updated_orders = 0
    updated_items = 0
    errors = 0

    async with AHClient() as client:
        if not client._token:
            return {"error": "No auth token — authenticate via UI first."}

        async with SessionLocal() as session:
            store_id = (await session.execute(
                text("SELECT id FROM stores WHERE name = 'Albert Heijn' LIMIT 1")
            )).scalar_one()

            orders = (await session.execute(
                text("SELECT id, external_id, order_channel FROM orders WHERE store_id = :sid ORDER BY id"),
                {"sid": store_id},
            )).fetchall()

        for order_id, external_id, channel in orders:
            try:
                if channel == "in_shop":
                    details = await client.get_pos_receipt_details(external_id)
                    products = details.get("products", [])
                    pos_ids = [p.get("id") for p in products if p.get("id")]
                    if pos_ids:
                        try:
                            id_map = await client.convert_pos_ids(pos_ids)
                            for p in products:
                                ws_id = id_map.get(p.get("id"))
                                if ws_id:
                                    p["webshop_id"] = str(ws_id)
                        except Exception as conv_err:
                            log.warning(f"POS ID conversion failed for {external_id}: {conv_err}")
                else:
                    details = await client.get_online_order_details(external_id)
                    products = _flatten_taxonomy_products(details)

                async with SessionLocal() as session:
                    for product in products:
                        name, webshop_id, hq_id, ean, qty, price_paid, regular_price = _extract_item_fields(product)
                        epid = webshop_id or hq_id
                        if not epid:
                            continue
                        result = await session.execute(
                            text("""
                                UPDATE order_items
                                SET price_paid = :price, regular_price = :reg_price
                                WHERE order_id = :oid AND external_product_id = :epid
                            """),
                            {"price": price_paid, "reg_price": regular_price, "oid": order_id, "epid": epid},
                        )
                        updated_items += result.rowcount
                    await session.commit()

                updated_orders += 1
                await asyncio.sleep(0.3)
            except Exception as e:
                errors += 1
                log.error(f"Reprice failed for order {external_id}: {e}")

    log.info(f"Reprice complete: {updated_orders} orders, {updated_items} items updated, {errors} errors")
    return {"updated_orders": updated_orders, "updated_items": updated_items, "errors": errors}
