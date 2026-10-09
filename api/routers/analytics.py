import csv
import io
import json as _json
import math
import os
import statistics
from collections import defaultdict
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from database import get_db

router = APIRouter(prefix="/analytics", tags=["analytics"])

_SEASON_SQL = """
    CASE
        WHEN EXTRACT(month FROM o.order_date) IN (3,4,5)  THEN 'Lente'
        WHEN EXTRACT(month FROM o.order_date) IN (6,7,8)  THEN 'Zomer'
        WHEN EXTRACT(month FROM o.order_date) IN (9,10,11) THEN 'Herfst'
        ELSE 'Winter'
    END
"""

_SEASON_ORDER = "CASE period_label WHEN 'Lente' THEN 1 WHEN 'Zomer' THEN 2 WHEN 'Herfst' THEN 3 ELSE 4 END"


def _to_dt(s: str) -> datetime:
    dt = datetime.fromisoformat(s)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _date_filter(start: str | None, end: str | None) -> tuple[str, dict]:
    from datetime import timedelta
    clauses, params = [], {}
    if start:
        clauses.append("o.order_date >= :start_date")
        params["start_date"] = _to_dt(start)
    if end:
        clauses.append("o.order_date < :end_date")
        params["end_date"] = _to_dt(end) + timedelta(days=1)
    return (" AND " + " AND ".join(clauses)) if clauses else "", params


async def _store_id(db: AsyncSession) -> int | None:
    return (await db.execute(
        text("SELECT id FROM stores WHERE name = 'Albert Heijn' LIMIT 1")
    )).scalar_one_or_none()


@router.get("/years")
async def analytics_years(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(text("""
        SELECT DISTINCT EXTRACT(year FROM o.order_date)::int AS yr
        FROM orders o
        JOIN stores s ON s.id = o.store_id AND s.name = 'Albert Heijn'
        WHERE o.order_date IS NOT NULL
        ORDER BY yr DESC
    """))).fetchall()
    return {"years": [r.yr for r in rows]}


@router.get("/summary")
async def analytics_summary(
    start: str | None = Query(None),
    end: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sid = await _store_id(db)
    if not sid:
        return {"total_orders": 0, "total_spent": 0.0, "avg_per_order": 0.0,
                "first_date": None, "last_date": None}

    date_sql, date_params = _date_filter(start, end)
    row = (await db.execute(text(f"""
        SELECT
            COUNT(*)                          AS total_orders,
            COALESCE(SUM(total_price), 0)    AS total_spent,
            COALESCE(AVG(total_price), 0)    AS avg_per_order,
            MIN(order_date)                  AS first_date,
            MAX(order_date)                  AS last_date
        FROM orders o
        WHERE o.store_id = :sid AND o.total_price IS NOT NULL {date_sql}
    """), {"sid": sid, **date_params})).fetchone()

    return {
        "total_orders": row.total_orders,
        "total_spent": round(float(row.total_spent), 2),
        "avg_per_order": round(float(row.avg_per_order), 2),
        "first_date": row.first_date.date().isoformat() if row.first_date else None,
        "last_date": row.last_date.date().isoformat() if row.last_date else None,
    }


@router.get("/top-products")
async def top_products(
    limit: int = Query(20, ge=5, le=100),
    start: str | None = Query(None),
    end: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sid = await _store_id(db)
    if not sid:
        return {"products": []}

    date_sql, date_params = _date_filter(start, end)
    rows = (await db.execute(text(f"""
        SELECT
            p.name,
            COUNT(DISTINCT o.id)           AS order_count,
            SUM(oi.quantity)                                                               AS total_qty,
            SUM(oi.price_paid * oi.quantity)                                               AS total_spent,
            SUM((COALESCE(oi.regular_price, oi.price_paid) - oi.price_paid) * oi.quantity) AS total_savings
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN products p ON p.id = oi.product_id
        WHERE o.store_id = :sid AND p.name IS NOT NULL {date_sql}
        GROUP BY p.name
        ORDER BY total_qty DESC, order_count DESC
        LIMIT :lim
    """), {"sid": sid, "lim": limit, **date_params})).fetchall()

    return {
        "products": [
            {
                "name": r.name,
                "order_count": r.order_count,
                "total_qty": round(float(r.total_qty or 0), 2),
                "total_spent": round(float(r.total_spent or 0), 2),
                "total_savings": round(float(r.total_savings or 0), 2),
            }
            for r in rows
        ]
    }


@router.get("/spending")
async def spending_analytics(
    period: str = Query("month", pattern="^(week|month|year|season)$"),
    start: str | None = Query(None),
    end: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sid = await _store_id(db)
    if not sid:
        return {"period": period, "data": []}

    date_sql, date_params = _date_filter(start, end)
    params = {"sid": sid, **date_params}

    if period == "season":
        rows = (await db.execute(text(f"""
            SELECT
                {_SEASON_SQL} AS label,
                COUNT(DISTINCT o.id)  AS order_count,
                SUM(o.total_price)    AS total_spent,
                AVG(o.total_price)    AS avg_per_order
            FROM orders o
            WHERE o.store_id = :sid AND o.total_price IS NOT NULL {date_sql}
            GROUP BY label
            ORDER BY CASE label WHEN 'Lente' THEN 1 WHEN 'Zomer' THEN 2 WHEN 'Herfst' THEN 3 ELSE 4 END
        """), params)).fetchall()
        data = [
            {
                "label": r.label,
                "order_count": r.order_count,
                "total_spent": float(r.total_spent or 0),
                "avg_per_order": float(r.avg_per_order or 0),
            }
            for r in rows
        ]
    else:
        rows = (await db.execute(text(f"""
            SELECT
                DATE_TRUNC('{period}', o.order_date) AS period_start,
                COUNT(DISTINCT o.id)                  AS order_count,
                SUM(o.total_price)                    AS total_spent,
                AVG(o.total_price)                    AS avg_per_order
            FROM orders o
            WHERE o.store_id = :sid AND o.total_price IS NOT NULL {date_sql}
            GROUP BY period_start
            ORDER BY period_start
        """), params)).fetchall()
        data = [
            {
                "label": r.period_start.strftime(
                    "%d %b" if period == "week" else "%b %Y" if period == "month" else "%Y"
                ),
                "period_start": r.period_start.isoformat(),
                "order_count": r.order_count,
                "total_spent": float(r.total_spent or 0),
                "avg_per_order": float(r.avg_per_order or 0),
            }
            for r in rows
        ]

    return {"period": period, "data": data}


@router.get("/nutrition")
async def nutrition_analytics(
    period: str = Query("month", pattern="^(week|month|year|season)$"),
    start: str | None = Query(None),
    end: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sid = await _store_id(db)
    if not sid:
        return {"period": period, "data": [], "has_nutrition_data": False}

    date_sql, date_params = _date_filter(start, end)
    params = {"sid": sid, **date_params}

    if period == "season":
        label_expr = f"({_SEASON_SQL}) AS period_label"
        order_clause = _SEASON_ORDER
    else:
        label_expr = f"DATE_TRUNC('{period}', o.order_date) AS period_label"
        order_clause = "period_label"

    # Aggregate nutrition per order first, then average across orders in each period.
    # LEFT JOINs so orders without matched products/nutrition are still counted.
    rows = (await db.execute(text(f"""
        SELECT
            period_label,
            COUNT(DISTINCT order_id)      AS order_count,
            AVG(NULLIF(order_kcal, 0))    AS avg_kcal,
            AVG(NULLIF(order_protein, 0)) AS avg_protein,
            AVG(NULLIF(order_fat, 0))     AS avg_fat,
            AVG(NULLIF(order_carbs, 0))   AS avg_carbs,
            AVG(NULLIF(order_sat_fat, 0)) AS avg_sat_fat,
            AVG(NULLIF(order_sugars, 0))  AS avg_sugars,
            AVG(NULLIF(order_fiber, 0))   AS avg_fiber,
            AVG(NULLIF(order_salt, 0))    AS avg_salt,
            SUM(order_kcal)               AS total_kcal,
            SUM(order_protein)            AS total_protein,
            SUM(order_fat)                AS total_fat,
            SUM(order_carbs)              AS total_carbs,
            SUM(order_fiber)              AS total_fiber,
            SUM(order_salt)               AS total_salt
        FROM (
            SELECT
                o.id AS order_id,
                {label_expr},
                SUM(COALESCE((ps.nutrition->>'energy_kcal')::numeric, 0) * oi.quantity)     AS order_kcal,
                SUM(COALESCE((ps.nutrition->>'protein')::numeric, 0) * oi.quantity)          AS order_protein,
                SUM(COALESCE((ps.nutrition->>'fat')::numeric, 0) * oi.quantity)              AS order_fat,
                SUM(COALESCE((ps.nutrition->>'carbohydrates')::numeric, 0) * oi.quantity)    AS order_carbs,
                SUM(COALESCE((ps.nutrition->>'saturated_fat')::numeric, 0) * oi.quantity)    AS order_sat_fat,
                SUM(COALESCE((ps.nutrition->>'sugars')::numeric, 0) * oi.quantity)           AS order_sugars,
                SUM(COALESCE((ps.nutrition->>'fiber')::numeric, 0) * oi.quantity)            AS order_fiber,
                SUM(COALESCE((ps.nutrition->>'salt')::numeric, 0) * oi.quantity)             AS order_salt
            FROM orders o
            JOIN order_items oi ON oi.order_id = o.id
            LEFT JOIN products p ON p.id = oi.product_id AND p.store_id = :sid
            LEFT JOIN LATERAL (
                SELECT nutrition FROM product_snapshots
                WHERE product_id = p.id AND nutrition IS NOT NULL
                ORDER BY scraped_at DESC LIMIT 1
            ) ps ON true
            WHERE o.store_id = :sid {date_sql}
            GROUP BY o.id, period_label
        ) sub
        GROUP BY period_label
        ORDER BY {order_clause}
    """), params)).fetchall()

    def _f(v) -> float | None:
        return round(float(v), 2) if v is not None else None

    def _label(v) -> str:
        if isinstance(v, str):
            return v
        return v.strftime("%d %b" if period == "week" else "%b %Y" if period == "month" else "%Y")

    data = [
        {
            "label": _label(r.period_label),
            "period_start": None if isinstance(r.period_label, str) else r.period_label.isoformat(),
            "order_count": r.order_count,
            "avg_kcal": _f(r.avg_kcal),
            "avg_protein": _f(r.avg_protein),
            "avg_fat": _f(r.avg_fat),
            "avg_carbs": _f(r.avg_carbs),
            "avg_sat_fat": _f(r.avg_sat_fat),
            "avg_sugars": _f(r.avg_sugars),
            "avg_fiber": _f(r.avg_fiber),
            "avg_salt": _f(r.avg_salt),
            "total_kcal": _f(r.total_kcal),
            "total_protein": _f(r.total_protein),
            "total_fat": _f(r.total_fat),
            "total_carbs": _f(r.total_carbs),
            "total_fiber": _f(r.total_fiber),
            "total_salt": _f(r.total_salt),
        }
        for r in rows
    ]

    has_nutrition_data = any(d["avg_kcal"] is not None for d in data)
    return {"period": period, "data": data, "has_nutrition_data": has_nutrition_data}


# ─── Category spending ────────────────────────────────────────────────────────

@router.get("/categories")
async def category_spending(
    start: str | None = Query(None),
    end: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sid = await _store_id(db)
    if not sid:
        return {"categories": []}

    date_sql, date_params = _date_filter(start, end)
    rows = (await db.execute(text(f"""
        SELECT
            COALESCE(p.category, 'Onbekend')                                               AS category,
            COUNT(DISTINCT o.id)                                                           AS order_count,
            SUM(oi.price_paid * oi.quantity)                                               AS total_spent,
            SUM(COALESCE(oi.regular_price, oi.price_paid) * oi.quantity)                   AS total_regular,
            SUM((COALESCE(oi.regular_price, oi.price_paid) - oi.price_paid) * oi.quantity) AS total_savings,
            COUNT(oi.id)                                                                   AS item_count
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN products p ON p.id = oi.product_id
        WHERE o.store_id = :sid {date_sql}
        GROUP BY p.category
        ORDER BY total_spent DESC
    """), {"sid": sid, **date_params})).fetchall()

    return {
        "categories": [
            {
                "category": r.category,
                "order_count": r.order_count,
                "total_spent": round(float(r.total_spent or 0), 2),
                "total_savings": round(float(r.total_savings or 0), 2),
                "item_count": r.item_count,
            }
            for r in rows
        ]
    }


# ─── Product search/sort ──────────────────────────────────────────────────────

@router.get("/products")
async def products_analytics(
    limit: int = Query(50, ge=5, le=200),
    sort_by: str = Query("order_count", pattern="^(order_count|total_spent|total_qty|avg_price)$"),
    search: str | None = Query(None),
    start: str | None = Query(None),
    end: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sid = await _store_id(db)
    if not sid:
        return {"products": []}

    date_sql, date_params = _date_filter(start, end)
    search_sql = "AND p.name ILIKE :search" if search else ""
    params = {"sid": sid, "lim": limit, **date_params}
    if search:
        params["search"] = f"%{search}%"

    sort_col = {
        "order_count": "order_count",
        "total_spent": "total_spent",
        "total_qty": "total_qty",
        "avg_price": "avg_price",
    }[sort_by]

    rows = (await db.execute(text(f"""
        SELECT
            p.name,
            p.category,
            COUNT(DISTINCT o.id)                                AS order_count,
            SUM(oi.quantity)                                    AS total_qty,
            SUM(oi.price_paid * oi.quantity)                    AS total_spent,
            CASE WHEN SUM(oi.quantity) > 0
                 THEN SUM(oi.price_paid * oi.quantity) / SUM(oi.quantity)
                 ELSE NULL END                                  AS avg_price,
            MIN(o.order_date)                                   AS first_bought,
            MAX(o.order_date)                                   AS last_bought
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN products p ON p.id = oi.product_id
        WHERE o.store_id = :sid AND p.name IS NOT NULL {date_sql} {search_sql}
        GROUP BY p.name, p.category
        ORDER BY {sort_col} DESC NULLS LAST
        LIMIT :lim
    """), params)).fetchall()

    def _d(v) -> str | None:
        return v.date().isoformat() if v else None

    return {
        "products": [
            {
                "name": r.name,
                "category": r.category,
                "order_count": r.order_count,
                "total_qty": round(float(r.total_qty or 0), 2),
                "total_spent": round(float(r.total_spent or 0), 2),
                "avg_price": round(float(r.avg_price), 2) if r.avg_price else None,
                "first_bought": _d(r.first_bought),
                "last_bought": _d(r.last_bought),
            }
            for r in rows
        ]
    }


# ─── CSV export ──────────────────────────────────────────────────────────────

@router.get("/export")
async def export_orders_csv(
    start: str | None = Query(None, description="ISO date, e.g. 2026-08-01"),
    end: str | None = Query(None, description="ISO date, e.g. 2026-08-31"),
    db: AsyncSession = Depends(get_db),
):
    sid = await _store_id(db)
    if not sid:
        return StreamingResponse(iter([""]), media_type="text/csv")

    date_sql, date_params = _date_filter(start, end)

    rows = (await db.execute(text(f"""
        SELECT
            o.order_date,
            o.external_id                                  AS order_id,
            o.order_channel,
            p.name                                         AS product_name,
            p.brand,
            p.category,
            oi.quantity,
            oi.price_paid,
            CASE WHEN oi.quantity > 0
                 THEN oi.price_paid / oi.quantity ELSE NULL END AS unit_price
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN products p ON p.id = oi.product_id
        WHERE o.store_id = :sid
                    {date_sql}
        ORDER BY o.order_date, o.external_id, p.name
    """), {
        "sid": sid,
                **date_params,
    })).fetchall()

    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";", quoting=csv.QUOTE_MINIMAL)
    writer.writerow([
        "Datum", "Bestelling ID", "Kanaal",
        "Product", "Merk", "Categorie",
        "Hoeveelheid", "Eenheidsprijs", "Totaal",
    ])
    for r in rows:
        writer.writerow([
            r.order_date.date().isoformat() if r.order_date else "",
            r.order_id or "",
            r.order_channel or "",
            r.product_name or "",
            r.brand or "",
            r.category or "",
            str(r.quantity).replace(".", ",") if r.quantity else "1",
            f"{float(r.unit_price):.2f}".replace(".", ",") if r.unit_price else "",
            f"{float(r.price_paid):.2f}".replace(".", ",") if r.price_paid else "",
        ])

    label = f"{start[:7]}" if start else "alles"
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f'attachment; filename="bestellingen-{label}.csv"'},
    )


# ─── Shopping list recommendations ───────────────────────────────────────────

def _exp_weight(days_ago: float, decay: float = 0.02) -> float:
    return math.exp(-decay * max(0, days_ago))


def _consumption_pattern(purchases: list[tuple[datetime, float]], now: datetime, decay: float):
    """Returns (avg_interval_days, median_qty, consumption_rate, days_since_last, est_inventory, days_until_needed, confidence)."""
    purchases = sorted(purchases, key=lambda x: x[0])
    qtys = [q for _, q in purchases]
    median_qty = statistics.median(qtys)
    purchase_count = len(purchases)

    if purchase_count >= 2:
        intervals: list[tuple[float, float]] = []
        for i in range(1, len(purchases)):
            prev, curr = purchases[i - 1][0], purchases[i][0]
            interval = (curr - prev).total_seconds() / 86400
            days_ago = (now - curr).total_seconds() / 86400
            intervals.append((interval, _exp_weight(days_ago, decay)))

        w_sum = sum(w for _, w in intervals)
        avg_interval = sum(iv * w for iv, w in intervals) / w_sum if w_sum else 0
        median_interval = statistics.median(iv for iv, _ in intervals)
    else:
        last_dt = purchases[-1][0]
        days_since_only = (now - last_dt).total_seconds() / 86400
        avg_interval = max(days_since_only, 7)
        median_interval = avg_interval

    consumption_rate = median_qty / avg_interval if avg_interval > 0 else 0
    last_dt = purchases[-1][0]
    days_since_last = (now - last_dt).total_seconds() / 86400
    est_inventory = max(0, median_qty - days_since_last * consumption_rate)
    days_until = min(9999.0, est_inventory / consumption_rate) if consumption_rate > 0 else 9999.0

    # Confidence
    count_factor = min(1.0, purchase_count / 10.0)
    if median_interval > 0:
        ratio = days_since_last / median_interval
        recency = max(0, 1 - (ratio - 1) * 0.3) if ratio > 1 else 1.0
    else:
        recency = 0.5
    confidence = round(min(0.9, count_factor * recency * 0.9), 2)

    return avg_interval, median_interval, median_qty, consumption_rate, days_since_last, est_inventory, days_until, confidence, last_dt


@router.get("/recommendations")
async def shopping_recommendations(
    days_ahead: int = Query(7, ge=1, le=30),
    min_purchases: int = Query(3, ge=1, le=10),
    max_interval: float = Query(60.0, ge=7, le=180),
    max_days_since: float = Query(90.0, ge=14, le=365),
    decay_rate: float = Query(0.02, ge=0.001, le=0.1),
    start: str | None = Query(None),
    end: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sid = await _store_id(db)
    if not sid:
        return {"needed": [], "soon": [], "estimated_total": 0, "items_analyzed": 0}

    now = datetime.now(timezone.utc)
    cutoff = _to_dt(
        (now.replace(tzinfo=None) - __import__('datetime').timedelta(days=int(max_days_since * 2))).date().isoformat()
    )
    date_sql, date_params = _date_filter(start, end)

    rows = (await db.execute(text(f"""
        SELECT
            p.name,
            p.id                      AS product_id,
            o.order_date,
            SUM(oi.quantity)          AS qty,
            AVG(oi.price_paid / NULLIF(oi.quantity, 0)) AS unit_price
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN products p ON p.id = oi.product_id
        WHERE o.store_id = :sid
          AND p.name IS NOT NULL
          AND o.order_date >= :cutoff
            {date_sql}
        GROUP BY p.name, p.id, o.order_date
        ORDER BY p.name, o.order_date
        """), {"sid": sid, "cutoff": cutoff, **date_params})).fetchall()

    # Group by product name
    by_product: dict[str, list[tuple[datetime, float]]] = defaultdict(list)
    unit_prices: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        dt = r.order_date if r.order_date.tzinfo else r.order_date.replace(tzinfo=timezone.utc)
        by_product[r.name].append((dt, float(r.qty or 1)))
        if r.unit_price:
            unit_prices[r.name].append(float(r.unit_price))

    needed, soon = [], []

    for name, purchases in by_product.items():
        if len(purchases) < min_purchases:
            continue

        (avg_interval, median_interval, median_qty, consumption_rate,
         days_since_last, est_inventory, days_until, confidence, last_dt) = _consumption_pattern(
            purchases, now, decay_rate
        )

        if avg_interval > max_interval:
            continue
        if days_since_last > max_days_since:
            continue

        median_price = statistics.median(unit_prices[name]) if unit_prices[name] else 0.0
        suggested_qty = max(1, math.ceil(median_qty))

        item = {
            "name": name,
            "suggested_qty": suggested_qty,
            "days_until_needed": round(days_until, 1),
            "est_inventory": round(est_inventory, 1),
            "avg_interval_days": round(avg_interval, 1),
            "last_bought_days_ago": round(days_since_last, 0),
            "purchase_count": len(purchases),
            "median_price": round(median_price, 2),
            "estimated_cost": round(median_price * suggested_qty, 2),
            "confidence": confidence,
        }

        if days_until <= days_ahead:
            needed.append(item)
        elif days_until <= days_ahead * 2:
            soon.append(item)

    needed.sort(key=lambda x: x["days_until_needed"])
    soon.sort(key=lambda x: x["days_until_needed"])

    return {
        "needed": needed,
        "soon": soon,
        "estimated_total": round(sum(x["estimated_cost"] for x in needed), 2),
        "items_analyzed": len(by_product),
        "planning_horizon_days": days_ahead,
    }


# ─── Health scorecard ─────────────────────────────────────────────────────────

_FISH_KW = {"vis", "zalm", "tonijn", "makreel", "haring", "sardine", "garnalen",
             "kabeljauw", "forel", "tilapia", "tuna", "lekkerbekje", "kibbeling", "ansjovis"}
_PROC_MEAT_KW = {"salami", "spek", "worst", "bacon", "bifi", "knaks", "rookworst",
                  "leverworst", "chorizo", "pepperoni", "vleeswaren", "pastrami"}
_PROC_MEAT_ING = {"nitriet", "nitraat", "e250", "e251", "e252", "natriumnitriet",
                   "rookaroma", "conserveermiddel", "pekel"}
_PLANT_KW = {"vivera", "vegan", "vegetarisch", "tofu", "tempeh", "quorn", "plantaardig", "vege"}
_LEGUME_KW = {"linzen", "kikkererwten", "kidneyboon", "bruine boon", "edamame",
               "hummus", "chickpea", "lentil", "peulvruch"}
_WHOLE_GRAIN_NAME_KW = {"volkoren", "meergranen", "spelt", "havermout", "rogge", "wholegrain", "oat",
                         "zilvervlies", "bruinbrood", "bruin brood"}
_NUTS_KW = {"noten", "amandelen", "cashew", "walnoot", "pinda", "pistache", "hazelnoot",
             "sesamzaad", "lijnzaad", "chiazaad", "pindakaas"}
# Ingredient signals ordered by specificity — position in ingredient list encodes weight
_WHOLE_GRAIN_ING = ("volkoren", "spelt", "rogge", "havervlokken", "havermout", "meergranen", "haver")
_REFINED_GRAIN_ING = ("tarwebloem", "bloem", "maismeel", "rijstmeel")
# Drink sugar signals
_LOW_SUGAR_DRINK_NAME = ("0.0", "0,0", " zero", "suikervrij", "no sugar", "sugar free",
                          "koffie", "thee", "espresso", "americano", "capsule", " cups", " pad ",
                          "water")
_SUGARY_DRINK_NAME = ("sap", "juice", "smoothie", "cola", "limonade", "frisdrank",
                       "energy drink", "siroop", "cider", "radler")

_GROUP_META: dict[str, dict] = {
    "vegetables":       {"label": "Groenten",                "emoji": "🥦", "good_high": True,  "g": 10, "y": 5},
    "fruit":            {"label": "Fruit",                   "emoji": "🍎", "good_high": True,  "g": 6,  "y": 3},
    "fish":             {"label": "Vis",                     "emoji": "🐟", "good_high": True,  "g": 3,  "y": 1},
    "legumes":          {"label": "Peulvruchten",            "emoji": "🫘", "good_high": True,  "g": 2,  "y": 0.5},
    "fresh_meat":       {"label": "Vers vlees",              "emoji": "🥩", "good_high": None,  "g": 0,  "y": 0},
    "processed_meat":   {"label": "Verwerkt vlees",          "emoji": "🥓", "good_high": False, "g": 4,  "y": 8},
    "plant_protein":    {"label": "Plantaardig eiwit",       "emoji": "🌿", "good_high": True,  "g": 2,  "y": 0.5},
    "dairy_eggs":       {"label": "Zuivel & eieren",         "emoji": "🥚", "good_high": None,  "g": 0,  "y": 0},
    "non_food":         {"label": "Non-food",                "emoji": "🧴", "good_high": None,  "g": 0,  "y": 0},
    "cheese":           {"label": "Kaas",                    "emoji": "🧀", "good_high": None,  "g": 0,  "y": 0},
    "whole_grains":     {"label": "Volle granen",            "emoji": "🌾", "good_high": True,  "g": 5,  "y": 2},
    "refined_grains":   {"label": "Verfijnde granen",        "emoji": "🍞", "good_high": False, "g": 15, "y": 25},
    "nuts_seeds":       {"label": "Noten & zaden",           "emoji": "🥜", "good_high": True,  "g": 1,  "y": 0},
    "treats":           {"label": "Snacks & zoet",           "emoji": "🍪", "good_high": False, "g": 5,  "y": 10},
    "convenience":      {"label": "Kant-en-klaar",           "emoji": "🍱", "good_high": False, "g": 8,  "y": 15},
    "sugary_drinks":    {"label": "Suikerhoudende dranken",  "emoji": "🧃", "good_high": False, "g": 2,  "y": 5},
    "low_sugar_drinks": {"label": "Dranken (weinig suiker)", "emoji": "💧", "good_high": None,  "g": 0,  "y": 0},
    "other_food":       {"label": "Overig",                  "emoji": "🫙", "good_high": None,  "g": 0,  "y": 0},
}


def _grain_type(name: str, ing: str) -> str:
    """Whole vs refined grain: name first, then dominant ingredient by position."""
    if any(k in name for k in _WHOLE_GRAIN_NAME_KW):
        return "whole_grains"
    if not ing:
        return "refined_grains"
    whole_pos = min((ing.find(k) for k in _WHOLE_GRAIN_ING if ing.find(k) >= 0), default=999999)
    refined_pos = min((ing.find(k) for k in _REFINED_GRAIN_ING if ing.find(k) >= 0), default=999999)
    if whole_pos == refined_pos == 999999:
        return "refined_grains"
    return "whole_grains" if whole_pos <= refined_pos else "refined_grains"


def _meat_type(name: str, ing: str) -> str:
    """Fresh vs processed meat: name keywords first, then ingredient processing signals."""
    if any(k in name for k in _PROC_MEAT_KW):
        return "processed_meat"
    if ing and any(k in ing for k in _PROC_MEAT_ING):
        return "processed_meat"
    return "fresh_meat"


def _drink_type(name: str, ing: str, sugars: float | None) -> str:
    """Sugary vs low-sugar drink: name > nutrition > ingredients."""
    if any(k in name for k in _LOW_SUGAR_DRINK_NAME):
        return "low_sugar_drinks"
    if any(k in name for k in _SUGARY_DRINK_NAME):
        return "sugary_drinks"
    if sugars is not None:
        return "sugary_drinks" if sugars > 5.0 else "low_sugar_drinks"
    if ing and "suiker" in ing[:150]:
        return "sugary_drinks"
    return "sugary_drinks"  # conservative default


def _classify(name: str, category: str | None, ingredients: str | None = None,
              sugars: float | None = None) -> str:
    n = name.lower()
    cat = (category or "").lower()
    ing = (ingredients or "").lower()

    # Non-food — category is authoritative
    if any(k in cat for k in ("huishouden", "dier", "persoonlijke", "baby", "drogisterij", "gezondheid")):
        return "non_food"

    # Drinks domain — sub-classified by name/nutrition/ingredients
    if any(k in cat for k in ("drank", "bier", "wijn", "koffie", "thee", "aperitief")):
        return _drink_type(n, ing, sugars)

    # Vegetables & fruit — category is truth, but legumes take priority
    if "groente" in cat or "aardappel" in cat:
        if any(k in n for k in _LEGUME_KW) or (ing and any(k in ing for k in _LEGUME_KW)):
            return "legumes"
        return "vegetables"
    if "fruit" in cat:
        return _drink_type(n, ing, sugars) if any(k in n for k in ("sap", "juice", "smoothie")) else "fruit"

    # Dairy & eggs
    if any(k in cat for k in ("zuivel", "eieren", "boter")):
        return "dairy_eggs"

    # Cheese / vleeswaren
    if "kaas" in cat or "vleeswaren" in cat:
        return _meat_type(n, ing) if any(k in n for k in _PROC_MEAT_KW) else "cheese"

    # Fish (standalone "Vis" category)
    if "vis" in cat and "vlees" not in cat:
        return "fish"

    # Vlees — category gives domain, name+ingredients give subtype
    if "vlees" in cat:
        if any(k in n for k in _FISH_KW):
            return "fish"
        if any(k in n for k in _PLANT_KW):
            return "plant_protein"
        return _meat_type(n, ing)

    # Vegetarisch / vegan / plantaardig
    if any(k in cat for k in ("vegetarisch", "vegan", "plantaardig")):
        if any(k in n for k in ("drink", "haver", "oat", "soja", "rijst", "melk", "milk")):
            return _drink_type(n, ing, sugars)
        return "plant_protein"

    # Bakkerij — category says grain, ingredients say whole vs refined
    if "bakkerij" in cat or "brood" in cat or "gebak" in cat:
        return _grain_type(n, ing)

    # Pasta, rijst, wereldkeuken — only grain-classify actual grain products; sauces/spice mixes → other_food
    if "pasta" in cat or "rijst" in cat or "wereldkeuken" in cat:
        if any(k in n for k in _LEGUME_KW) or (ing and any(k in ing for k in _LEGUME_KW)):
            return "legumes"
        _PASTA_GRAIN_KW = ("pasta", "spaghetti", "penne", "fusilli", "linguine", "fettucine",
                            "rigatoni", "farfalle", "lasagne", "tagliatelle", "gnocchi",
                            "tortilla", "taco", "wrap", "rijst", "noodle", "couscous", "bulgur",
                            "mie", "orzo", "vermicelli")
        if any(k in n for k in _PASTA_GRAIN_KW):
            return _grain_type(n, ing)
        return "other_food"

    # Ontbijtgranen, beleg — sweet toppings first, then nuts, then grain
    if "ontbijt" in cat or "beleg" in cat:
        _SWEET_TOPPING_KW = ("hagelslag", "jam", "honing", "stroop", "nutella", "chocopasta",
                              "chocoladepasta", "speculaaspasta")
        if any(k in n for k in _SWEET_TOPPING_KW) or (sugars is not None and sugars > 40):
            return "treats"
        if any(k in n for k in _NUTS_KW) or (ing and any(k in ing for k in _NUTS_KW)):
            return "nuts_seeds"
        if any(k in n for k in _WHOLE_GRAIN_NAME_KW) or ing:
            return _grain_type(n, ing)
        return "other_food"

    # Snacks / treats
    if any(k in cat for k in ("snack", "snoep", "chocolade", "koek", "borrel", "tussendoortje")):
        return "treats"

    # Diepvries
    if "diepvries" in cat:
        if any(k in n for k in _FISH_KW):
            return "fish"
        if any(k in n for k in ("groente", "spinazie", "broccoli", "erwt", "boontje", "wortelen")):
            return "vegetables"
        if any(k in n for k in _PLANT_KW):
            return "plant_protein"
        if any(k in n for k in ("ijs", "lollie", "sorbet", "ijsje", "waterijs", "softijs")):
            return "treats"
        return "convenience"

    # Houdbaar — diverse; name then ingredient signals
    if "houdbaar" in cat:
        if any(k in n for k in _LEGUME_KW) or (ing and any(k in ing for k in _LEGUME_KW)):
            return "legumes"
        if any(k in n for k in _NUTS_KW) or (ing and any(k in ing for k in _NUTS_KW)):
            return "nuts_seeds"
        if any(k in n for k in _FISH_KW) or (ing and any(k in ing for k in _FISH_KW)):
            return "fish"
        if any(k in n for k in ("chips", "koek", "biscuit", "cracker", "chocola", "snoep")):
            return "treats"
        if ing and any(k in ing for k in _WHOLE_GRAIN_ING + _REFINED_GRAIN_ING):
            return _grain_type(n, ing)
        return "other_food"

    # Ingredient-based fallback for unrecognised categories
    if ing:
        if any(k in ing for k in _LEGUME_KW):
            return "legumes"
        if any(k in ing for k in _FISH_KW):
            return "fish"
        if any(k in ing for k in _WHOLE_GRAIN_ING + _REFINED_GRAIN_ING):
            return _grain_type(n, ing)

    return "other_food"


def _rate(group: str, pct: float) -> str:
    meta = _GROUP_META.get(group, {})
    direction = meta.get("good_high")
    if direction is None:
        return "neutral"
    g, y = meta["g"], meta["y"]
    if direction:
        return "green" if pct >= g else ("yellow" if pct >= y else "red")
    else:
        return "green" if pct <= g else ("yellow" if pct <= y else "red")


@router.get("/health-score")
async def health_score(
    start: str | None = Query(None),
    end: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sid = await _store_id(db)
    if not sid:
        return {"groups": [], "food_spend": 0, "start": start, "end": end}

    date_sql, date_params = _date_filter(start, end)

    rows = (await db.execute(text(f"""
        SELECT p.id, p.name, p.category, p.ingredients,
               (SELECT (nutrition->>'sugars')::float
                FROM product_snapshots WHERE product_id = p.id
                ORDER BY scraped_at DESC LIMIT 1) AS sugars,
               SUM(oi.price_paid * oi.quantity)                                               AS spent,
               SUM((COALESCE(oi.regular_price, oi.price_paid) - oi.price_paid) * oi.quantity) AS savings
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN products p ON p.id = oi.product_id
        WHERE o.store_id = :sid {date_sql}
          AND p.name IS NOT NULL
        GROUP BY p.id, p.name, p.category, p.ingredients
    """), {"sid": sid, **date_params})).fetchall()

    totals: dict[str, float] = defaultdict(float)
    savings_by_group: dict[str, float] = defaultdict(float)
    for r in rows:
        grp = _classify(r.name or "", r.category, r.ingredients, r.sugars)
        totals[grp] += float(r.spent or 0)
        savings_by_group[grp] += float(r.savings or 0)

    food_spend = sum(v for k, v in totals.items() if k != "non_food")
    total_spend = sum(totals.values())
    total_savings = sum(savings_by_group.values())

    groups = []
    for group, meta in _GROUP_META.items():
        spent = totals.get(group, 0.0)
        pct = (spent / food_spend * 100) if food_spend > 0 and group != "non_food" else (
            (spent / total_spend * 100) if total_spend > 0 else 0.0
        )
        groups.append({
            "group": group,
            "label": meta["label"],
            "emoji": meta["emoji"],
            "spent": round(spent, 2),
            "savings": round(savings_by_group.get(group, 0.0), 2),
            "pct": round(pct, 1),
            "rating": _rate(group, pct),
        })

    groups.sort(key=lambda g: g["spent"], reverse=True)
    return {
        "groups": groups,
        "food_spend": round(food_spend, 2),
        "total_spend": round(total_spend, 2),
        "total_savings": round(total_savings, 2),
        "start": start,
        "end": end,
    }


# ─── Ollama chat agent ────────────────────────────────────────────────────────

_OLLAMA_URL = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434")
_OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:14b")


async def _build_context(start: str | None, end: str | None, db: AsyncSession) -> str:
    sid = await _store_id(db)
    if not sid:
        return ""

    date_sql, date_params = _date_filter(start, end)

    rows = (await db.execute(text(f"""
        SELECT p.id, p.name, p.category, p.ingredients,
               (SELECT (nutrition->>'sugars')::float
                FROM product_snapshots WHERE product_id = p.id
                ORDER BY scraped_at DESC LIMIT 1) AS sugars,
               SUM(oi.quantity) AS qty, SUM(oi.price_paid * oi.quantity) AS spent
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN products p ON p.id = oi.product_id
        WHERE o.store_id = :sid {date_sql}
          AND p.name IS NOT NULL
        GROUP BY p.id, p.name, p.category, p.ingredients
        ORDER BY spent DESC
        LIMIT 80
    """), {"sid": sid, **date_params})).fetchall()

    if not rows:
        return ""

    lines = [f"Aankopen {start or 'alles'} t/m {end or 'heden'} (top 80 op uitgaven):"]
    for r in rows:
        lines.append(f"- {r.name} ({r.category or '?'}) | {float(r.qty or 1):.0f}x | €{float(r.spent or 0):.2f}")

    # Add food group summary
    totals: dict[str, float] = defaultdict(float)
    for r in rows:
        grp = _classify(r.name or "", r.category, r.ingredients, r.sugars)
        totals[grp] += float(r.spent or 0)
    food_spend = sum(v for k, v in totals.items() if k != "non_food")
    if food_spend > 0:
        lines.append("\nVoedselgroepen (% van voedseluitgaven):")
        for grp, meta in _GROUP_META.items():
            pct = totals.get(grp, 0) / food_spend * 100
            if pct > 0.5:
                rating = _rate(grp, pct)
                lines.append(f"  {meta['emoji']} {meta['label']}: {pct:.1f}% ({rating})")

    return "\n".join(lines)


@router.post("/chat")
async def chat(request: Request, db: AsyncSession = Depends(get_db)):
    import httpx
    body = await request.json()
    question: str = body.get("question", "")
    messages: list[dict] = body.get("messages", [])
    start: str | None = body.get("start")
    end: str | None = body.get("end")

    if not question.strip():
        return {"error": "question is required"}

    context = ""
    if not messages:
        context = await _build_context(start, end, db)

    system = (
        "Je bent een ervaren diëtist die een Nederlands gezin helpt inzicht te krijgen "
        "in hun eetpatroon op basis van Albert Heijn boodschappendata. "
        "Geef praktische, vriendelijke adviezen in het Nederlands. "
        "Wees specifiek over de producten die je ziet. "
        "Houd antwoorden beknopt maar inhoudsvol. Gebruik kopjes waar zinvol."
    )
    if context:
        system += f"\n\nBoodschappendata:\n{context}"

    ollama_msgs = [{"role": "system", "content": system}]
    ollama_msgs.extend(messages)
    ollama_msgs.append({"role": "user", "content": question})

    async def stream():
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                async with client.stream("POST", f"{_OLLAMA_URL}/api/chat", json={
                    "model": _OLLAMA_MODEL,
                    "messages": ollama_msgs,
                    "stream": True,
                }) as resp:
                    async for line in resp.aiter_lines():
                        if not line:
                            continue
                        try:
                            chunk = _json.loads(line)
                            content = chunk.get("message", {}).get("content", "")
                            done = chunk.get("done", False)
                            yield f"data: {_json.dumps({'content': content, 'done': done})}\n\n"
                            if done:
                                break
                        except Exception:
                            pass
        except Exception as e:
            yield f"data: {_json.dumps({'content': f'[Fout: {e}]', 'done': True})}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
