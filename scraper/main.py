import asyncio
import logging
import os
import threading
from datetime import datetime, timezone
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI
import uvicorn

from product_scraper import run_product_scrape, CHECKPOINT_FILE
from order_scraper import run_order_scrape, rematch_order_items, preview_order_scrape, reprice_order_items
from name_enricher import enrich_product_names
from nutrition_enricher import enrich_nutrition

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger(__name__)

# Small HTTP trigger API (port 8001) so the api container can request scrapes
trigger_app = FastAPI()
_loop: asyncio.AbstractEventLoop | None = None

_scrape_status: dict = {
    "running": False,
    "phase": None,
    "last_run_at": None,
    "last_error": None,
    "current_category": None,
    "current_subcat": None,
    "categories_done": 0,
    "categories_total": 0,
    "categories_skipped": 0,
    "subcats_done": 0,
    "subcats_total": 0,
    "subcats_skipped": 0,
    "products_this_run": 0,
}

_orders_status: dict = {
    "running": False,
    "mode": None,        # "full" | "incremental"
    "last_run_at": None,
    "last_error": None,
    "last_result": None, # {"pos": N, "online": N}
}


async def _run_full_scrape():
    global _scrape_status
    _scrape_status.update({
        "running": True,
        "last_error": None,
        "current_category": None,
        "current_subcat": None,
        "categories_done": 0,
        "categories_total": 0,
        "categories_skipped": 0,
        "subcats_done": 0,
        "subcats_total": 0,
        "subcats_skipped": 0,
        "products_this_run": 0,
    })
    try:
        _scrape_status["phase"] = "products"
        await run_product_scrape(_scrape_status)
        try:
            await rematch_order_items()
        except Exception as re:
            log.warning(f"Re-match after product scrape failed (non-fatal): {re}")
    except Exception as e:
        _scrape_status["last_error"] = str(e)
        log.error(f"Product scrape failed: {e}")
    finally:
        _scrape_status["running"] = False
        _scrape_status["phase"] = None
        _scrape_status["current_category"] = None
        _scrape_status["last_run_at"] = datetime.now(timezone.utc).isoformat()


async def _run_orders_with_status(full: bool = False):
    global _orders_status
    _orders_status.update({"running": True, "mode": "full" if full else "incremental", "last_error": None, "last_result": None})
    try:
        result = await run_order_scrape(full=full)
        _orders_status["last_result"] = result
    except Exception as e:
        _orders_status["last_error"] = str(e)
        log.error(f"Order scrape failed: {e}")
    finally:
        _orders_status["running"] = False
        _orders_status["mode"] = None
        _orders_status["last_run_at"] = datetime.now(timezone.utc).isoformat()


@trigger_app.post("/trigger/products")
async def trigger_products():
    if not _scrape_status["running"]:
        asyncio.run_coroutine_threadsafe(_run_full_scrape(), _loop)
    return {"ok": True}


@trigger_app.post("/trigger/orders")
async def trigger_orders(full: bool = False):
    if not _orders_status["running"]:
        asyncio.run_coroutine_threadsafe(_run_orders_with_status(full=full), _loop)
    return {"ok": True}


@trigger_app.get("/orders-status")
async def orders_status_endpoint():
    return _orders_status


@trigger_app.get("/health")
async def health():
    return {"ok": True}


@trigger_app.get("/status")
async def scraper_status():
    return _scrape_status


@trigger_app.post("/trigger/rematch")
async def trigger_rematch():
    """Re-match unmatched order items against current product catalog."""
    if not _orders_status["running"]:
        asyncio.run_coroutine_threadsafe(rematch_order_items(), _loop)
    return {"ok": True}


_reprice_status: dict = {"running": False, "last_result": None, "last_error": None}


async def _run_reprice():
    global _reprice_status
    _reprice_status.update({"running": True, "last_error": None})
    try:
        result = await reprice_order_items()
        _reprice_status["last_result"] = result
    except Exception as e:
        _reprice_status["last_error"] = str(e)
        log.error(f"Reprice failed: {e}")
    finally:
        _reprice_status["running"] = False


@trigger_app.post("/trigger/reprice")
async def trigger_reprice():
    """Re-fetch all order details to populate price_paid (actual) and regular_price (pre-bonus)."""
    if not _reprice_status["running"]:
        asyncio.run_coroutine_threadsafe(_run_reprice(), _loop)
    return {"ok": True, "already_running": _reprice_status["running"]}


@trigger_app.get("/reprice-status")
async def reprice_status_endpoint():
    return _reprice_status


@trigger_app.get("/trigger/orders-preview")
async def trigger_orders_preview():
    """Preview 1 POS + 1 online order with matching results — does NOT save to DB."""
    import asyncio as _asyncio
    future = _asyncio.run_coroutine_threadsafe(preview_order_scrape(), _loop)
    try:
        result = future.result(timeout=30)
    except Exception as e:
        return {"error": str(e)}
    return result


_enrich_status: dict = {"running": False, "last_result": None, "last_error": None}


async def _run_enrich(limit: int = 50):
    global _enrich_status
    _enrich_status.update({"running": True, "last_error": None})
    try:
        result = await enrich_product_names(limit=limit)
        _enrich_status["last_result"] = result
    except Exception as e:
        _enrich_status["last_error"] = str(e)
        log.error(f"Name enrichment failed: {e}")
    finally:
        _enrich_status["running"] = False


@trigger_app.post("/trigger/enrich-names")
async def trigger_enrich(limit: int = 50):
    """Enrich product names with English translations from Open Food Facts."""
    if not _enrich_status["running"]:
        asyncio.run_coroutine_threadsafe(_run_enrich(limit=limit), _loop)
    return {"ok": True}


@trigger_app.get("/enrich-status")
async def enrich_status():
    return _enrich_status


_nutrition_status: dict = {
    "running": False, "last_result": None, "last_error": None,
    "batches_done": 0, "total_updated": 0, "total_skipped": 0, "total_errors": 0,
}


async def _run_nutrition_enrich(batch_size: int = 500):
    global _nutrition_status
    _nutrition_status.update({
        "running": True, "last_error": None,
        "batches_done": 0, "total_updated": 0, "total_skipped": 0, "total_errors": 0,
    })
    try:
        while True:
            result = await enrich_nutrition(
                db_url=os.environ["DATABASE_URL"],
                store_id=1,
                batch_size=batch_size,
            )
            _nutrition_status["batches_done"] += 1
            _nutrition_status["total_updated"] += result.get("updated", 0)
            _nutrition_status["total_skipped"] += result.get("skipped", 0)
            _nutrition_status["total_errors"] += result.get("errors", 0)
            _nutrition_status["last_result"] = result
            log.info(f"Nutrition batch {_nutrition_status['batches_done']} done: {result}")
            if result.get("total", 0) == 0:
                break  # nothing left to enrich
        log.info(
            f"Nutrition enrichment complete: "
            f"{_nutrition_status['total_updated']} updated, "
            f"{_nutrition_status['total_skipped']} skipped, "
            f"{_nutrition_status['total_errors']} errors "
            f"across {_nutrition_status['batches_done']} batches"
        )
    except Exception as e:
        _nutrition_status["last_error"] = str(e)
        log.error(f"Nutrition enrichment failed: {e}")
    finally:
        _nutrition_status["running"] = False


@trigger_app.post("/trigger/enrich-nutrition")
async def trigger_enrich_nutrition(batch_size: int = 500):
    """Fetch nutrition data from AH API for products missing it."""
    if not _nutrition_status["running"]:
        asyncio.run_coroutine_threadsafe(_run_nutrition_enrich(batch_size=batch_size), _loop)
    return {"ok": True, "already_running": _nutrition_status["running"]}


@trigger_app.get("/nutrition-status")
async def nutrition_enrich_status():
    return _nutrition_status


@trigger_app.post("/trigger/reset-checkpoint")
async def trigger_reset_checkpoint():
    """Delete category checkpoint so next scrape re-scrapes all categories."""
    try:
        CHECKPOINT_FILE.unlink(missing_ok=True)
        log.info("Category checkpoint reset")
    except Exception as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True}


@trigger_app.post("/trigger/cleanup")
async def trigger_cleanup():
    """Purge zero-price bad snapshots and deduplicate consecutive identical snapshots."""
    asyncio.run_coroutine_threadsafe(_run_cleanup(), _loop)
    return {"ok": True}


async def _run_cleanup():
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from sqlalchemy import text
    engine = create_async_engine(os.environ["DATABASE_URL"])
    async with async_sessionmaker(engine, class_=AsyncSession)() as session:
        r1 = await session.execute(text(
            "DELETE FROM product_snapshots WHERE (price = 0 AND bonus_price IS NULL) OR (is_bonus = true AND bonus_price = 0)"
        ))
        r2 = await session.execute(text("""
            DELETE FROM product_snapshots
            WHERE id IN (
                SELECT id FROM (
                    SELECT id,
                           (LAG(price) OVER w IS NOT DISTINCT FROM price
                            AND LAG(is_bonus) OVER w IS NOT DISTINCT FROM is_bonus
                            AND LAG(bonus_price) OVER w IS NOT DISTINCT FROM bonus_price
                            AND LAG(bonus_until) OVER w IS NOT DISTINCT FROM bonus_until) as is_dup
                    FROM product_snapshots
                    WINDOW w AS (PARTITION BY product_id ORDER BY scraped_at)
                ) sub WHERE is_dup = true
            )
        """))
        await session.commit()
        log.info(f"Cleanup: removed {r1.rowcount} zero-price + {r2.rowcount} duplicate snapshots")
    await engine.dispose()


@trigger_app.get("/status/all")
async def all_status():
    return {"products": _scrape_status, "orders": _orders_status}


PRODUCTS_CRON = os.environ.get("PRODUCTS_CRON", "0 6 * * *")
ORDERS_CRON = os.environ.get("ORDERS_CRON", "0 7 * * 1")


async def main():
    global _loop
    _loop = asyncio.get_running_loop()

    # Start trigger HTTP server in background thread
    threading.Thread(
        target=lambda: uvicorn.run(trigger_app, host="0.0.0.0", port=8001, log_level="warning"),
        daemon=True,
    ).start()

    scheduler = AsyncIOScheduler()

    scheduler.add_job(
        _run_full_scrape,
        CronTrigger.from_crontab(PRODUCTS_CRON),
        id="products",
        name="Product scrape",
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        _run_orders_with_status,
        CronTrigger.from_crontab(ORDERS_CRON),
        id="orders",
        name="Order scrape",
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        _run_cleanup,
        CronTrigger.from_crontab("0 5 * * 0"),  # Sunday 05:00 before product scrape
        id="cleanup",
        name="Snapshot cleanup",
        misfire_grace_time=3600,
    )

    scheduler.start()
    log.info(f"Scraper started. Products: {PRODUCTS_CRON}, Orders: {ORDERS_CRON}")

    # Run product scrape immediately on first start if DB is empty
    try:
        from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
        from sqlalchemy import text
        engine = create_async_engine(os.environ["DATABASE_URL"])
        async with async_sessionmaker(engine, class_=AsyncSession)() as session:
            count = await session.execute(text("SELECT COUNT(*) FROM products"))
            if count.scalar_one() == 0:
                log.info("No products in DB — running initial scrape now")
                await _run_full_scrape()
        await engine.dispose()
    except Exception as e:
        log.error(f"Initial scrape check failed: {e}")

    try:
        while True:
            await asyncio.sleep(60)
    except (KeyboardInterrupt, SystemExit):
        scheduler.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
