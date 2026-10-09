from datetime import datetime, date, timedelta, timezone
from decimal import Decimal
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select, func, text, case, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from database import get_db
from models import Product, ProductSnapshot, Store

router = APIRouter(prefix="/products", tags=["products"])


class SnapshotOut(BaseModel):
    id: int
    scraped_at: datetime
    price: Decimal
    is_bonus: bool
    bonus_price: Decimal | None
    bonus_until: date | None
    price_per_100g: Decimal | None
    price_per_100ml: Decimal | None
    price_per_kg: Decimal | None
    price_per_litre: Decimal | None
    price_per_piece: Decimal | None
    weight_g: int | None
    volume_ml: int | None
    pieces: int | None
    nutrition: dict | None

    model_config = {"from_attributes": True}


class BundleInfo(BaseModel):
    id: int
    name: str
    price_per_kg: Decimal | None = None
    price_per_litre: Decimal | None = None
    price_per_piece: Decimal | None = None


class OrderBought(BaseModel):
    times: int
    min_price_paid: Decimal | None = None
    min_per_kg: Decimal | None = None
    min_per_litre: Decimal | None = None
    min_per_piece: Decimal | None = None


class ProductOut(BaseModel):
    id: int
    external_id: str
    name: str
    name_en: str | None
    brand: str | None
    category: str | None
    sub_category: str | None
    image_url: str | None
    unit_type: str
    shelf_life_days: int | None
    product_group_name: str | None
    group_override: bool
    product_type_group: str | None
    type_group_override: bool
    # AH identifiers
    hq_id: int | None = None
    barcode: str | None = None
    gln: str | None = None
    # Channel & attributes
    shop_type: str | None = None
    available_online: bool = True
    available_in_store: bool | None = None
    nutriscore_letter: str | None = None
    nix18: bool = False
    dietary_flags: dict | None = None
    # Lifecycle
    is_active: bool = True
    latest_snapshot: SnapshotOut | None
    # Cheapest bundle that contains this single product (populated by list search)
    bundle: BundleInfo | None = None
    # Purchase history stats (populated by list search)
    order_bought: OrderBought | None = None

    model_config = {"from_attributes": True}


class ProductsPage(BaseModel):
    total: int
    items: list[ProductOut]


class ProductGroupOut(BaseModel):
    group_name: str
    variant_count: int
    products: list[ProductOut]


class ProductGroupsPage(BaseModel):
    total_groups: int
    groups: list[ProductGroupOut]


class PatchGroupIn(BaseModel):
    group_name: str | None  # None = clear override, let scraper re-normalize


class PatchNameEnIn(BaseModel):
    name_en: str | None


class TypeGroupOut(BaseModel):
    type_group: str
    product_count: int
    brands: list[str]
    min_price: float | None
    max_price: float | None


class TypeGroupsPage(BaseModel):
    total_groups: int
    groups: list[TypeGroupOut]


class PatchTypeGroupIn(BaseModel):
    type_group: str | None


class PeriodStats(BaseModel):
    count: int
    min_price: Decimal | None
    avg_price: Decimal | None
    max_price: Decimal | None
    min_per_unit: Decimal | None
    avg_per_unit: Decimal | None
    max_per_unit: Decimal | None
    unit_label: str | None


class PriceHistoryEntry(BaseModel):
    scraped_at: datetime
    price: Decimal
    effective_price: Decimal
    is_bonus: bool
    bonus_until: date | None
    price_per_kg: Decimal | None
    price_per_litre: Decimal | None
    price_per_100g: Decimal | None
    price_per_100ml: Decimal | None
    price_per_piece: Decimal | None
    product_id: int | None = None
    product_name: str | None = None


class GroupProductRef(BaseModel):
    id: int
    name: str


class PriceStatsOut(BaseModel):
    product_id: int
    unit_type: str
    periods: dict[str, PeriodStats]
    history: list[PriceHistoryEntry]
    group_name: str | None = None
    group_products: list[GroupProductRef] = []
    filter_product_id: int | None = None


@router.get("/stats")
async def product_stats(db: AsyncSession = Depends(get_db)):
    from sqlalchemy import distinct
    total = (await db.execute(select(func.count()).select_from(Product))).scalar_one()
    cats = (await db.execute(select(func.count(distinct(Product.category))))).scalar_one()
    groups = (await db.execute(
        select(func.count(distinct(Product.product_group_name)))
        .where(Product.product_group_name.isnot(None))
    )).scalar_one()
    return {"total_products": total, "total_categories": cats, "total_groups": groups}


@router.get("/nutrition-stats")
async def nutrition_stats(db: AsyncSession = Depends(get_db)):
    """Counts of products by nutrition enrichment state, for settings dashboard."""
    row = (await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE p.is_active)                                         AS total_active,
            COUNT(*) FILTER (WHERE p.is_active AND ps.nutrition IS NOT NULL)            AS with_nutrition,
            COUNT(*) FILTER (WHERE p.is_active AND p.details_scrape_error IS NOT NULL)  AS with_error,
            COUNT(*) FILTER (WHERE p.is_active AND p.details_scraped_at IS NULL)        AS never_attempted,
            MAX(p.details_scraped_at)                                                   AS last_enriched_at
        FROM products p
        LEFT JOIN LATERAL (
            SELECT nutrition
            FROM product_snapshots
            WHERE product_id = p.id
            ORDER BY scraped_at DESC LIMIT 1
        ) ps ON true
    """))).one()
    return {
        "total_active": row.total_active,
        "with_nutrition": row.with_nutrition,
        "with_error": row.with_error,
        "never_attempted": row.never_attempted,
        "last_enriched_at": row.last_enriched_at.isoformat() if row.last_enriched_at else None,
    }


@router.post("/enrich-units")
async def enrich_product_units(db: AsyncSession = Depends(get_db)):
    """For multi-packs with only piece count, derive total weight/volume from single-unit siblings."""
    rows = (await db.execute(text("""
        WITH latest AS (
            SELECT DISTINCT ON (product_id)
                product_id, id snap_id, pieces, weight_g, volume_ml, price, is_bonus, bonus_price
            FROM product_snapshots
            ORDER BY product_id, scraped_at DESC
        ),
        multi AS (
            SELECT p.id product_id, p.name, p.product_group_name, p.store_id,
                   p.bundle_child_external_id,
                   l.snap_id, l.pieces, l.price, l.is_bonus, l.bonus_price
            FROM products p JOIN latest l ON l.product_id = p.id
            WHERE p.product_group_name IS NOT NULL
              AND l.pieces > 1
              AND l.weight_g IS NULL AND l.volume_ml IS NULL
        ),
        singles AS (
            SELECT p.external_id, p.name, p.product_group_name, p.store_id, l.weight_g, l.volume_ml
            FROM products p JOIN latest l ON l.product_id = p.id
            WHERE (l.pieces IS NULL OR l.pieces = 1)
              AND (l.weight_g IS NOT NULL OR l.volume_ml IS NOT NULL)
        ),
        -- Primary: match by AH-provided bundle_child_external_id (authoritative)
        exact_match AS (
            SELECT m.snap_id, m.pieces, m.price, m.is_bonus, m.bonus_price,
                   s.weight_g unit_wg, s.volume_ml unit_vml, 1 priority
            FROM multi m
            JOIN singles s ON s.store_id = m.store_id
                          AND s.external_id = m.bundle_child_external_id
            WHERE m.bundle_child_external_id IS NOT NULL
        ),
        -- Fallback: longest name-prefix match within same group
        name_match AS (
            SELECT DISTINCT ON (m.snap_id)
                m.snap_id, m.pieces, m.price, m.is_bonus, m.bonus_price,
                s.weight_g unit_wg, s.volume_ml unit_vml, 2 priority
            FROM multi m
            JOIN singles s ON s.store_id = m.store_id
                          AND s.product_group_name = m.product_group_name
                          AND m.name ILIKE (s.name || '%')
            WHERE m.bundle_child_external_id IS NULL
            ORDER BY m.snap_id, length(s.name) DESC
        ),
        combined AS (SELECT * FROM exact_match UNION ALL SELECT * FROM name_match)
        SELECT snap_id, pieces, price, is_bonus, bonus_price, unit_wg, unit_vml
        FROM combined
    """))).fetchall()

    updated = 0
    for snap_id, pieces, price, is_bonus, bonus_price, unit_wg, unit_vml in rows:
        eff = float(bonus_price if is_bonus and bonus_price else price)
        wg = unit_wg * pieces if unit_wg else None
        vml = unit_vml * pieces if unit_vml else None
        pkg = round(eff / wg * 1000, 4) if wg else None
        pl = round(eff / vml * 1000, 4) if vml else None
        p100g = round(eff / wg * 100, 4) if wg else None
        p100ml = round(eff / vml * 100, 4) if vml else None
        await db.execute(text("""
            UPDATE product_snapshots
            SET weight_g=:wg, volume_ml=:vml,
                price_per_kg=:pkg, price_per_litre=:pl,
                price_per_100g=:p100g, price_per_100ml=:p100ml
            WHERE id=:sid AND price_per_kg IS NULL AND weight_g IS NULL
        """), {"wg": wg, "vml": vml, "pkg": pkg, "pl": pl, "p100g": p100g, "p100ml": p100ml, "sid": snap_id})
        updated += 1

    # Also backfill single items: price_per_piece = effective price, pieces = 1
    single_result = await db.execute(text("""
        UPDATE product_snapshots
        SET pieces = 1,
            price_per_piece = CASE WHEN is_bonus AND bonus_price IS NOT NULL
                                   THEN ROUND(bonus_price, 4)
                                   ELSE ROUND(price, 4) END
        WHERE (pieces IS NULL OR pieces = 0) AND price_per_piece IS NULL AND price > 0
    """))
    single_updated = single_result.rowcount

    await db.commit()
    return {"enriched": updated, "single_items_backfilled": single_updated}


@router.get("/suggest")
async def suggest_products(
    q: str = Query(..., min_length=2),
    limit: int = Query(8, le=20),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Return name+id suggestions for autocomplete."""
    result = await db.execute(
        select(Product.id, Product.name, Product.name_en, Product.brand)
        .where(
            (Product.name.ilike(f"%{q}%") | Product.name_en.ilike(f"%{q}%"))
            & (Product.is_active == True)
        )
        .order_by(Product.name)
        .limit(limit)
    )
    return [{"id": r.id, "name": r.name, "name_en": r.name_en, "brand": r.brand} for r in result]


@router.get("/", response_model=ProductsPage)
async def search_products(
    q: str | None = Query(None),
    category: str | None = None,
    type_group: str | None = None,
    bonus_only: bool = False,
    include_inactive: bool = False,
    exclude_bundles: bool = True,
    limit: int = Query(48, le=200),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    # Build dynamic WHERE clause for the lateral-join query
    where_parts: list[str] = []
    params: dict = {"lim": limit, "off": offset}

    if not include_inactive:
        where_parts.append("p.is_active = true")
    if exclude_bundles:
        where_parts.append("p.bundle_child_external_id IS NULL")
    if q:
        where_parts.append("(p.name ILIKE :q OR p.name_en ILIKE :q)")
        params["q"] = f"%{q}%"
    if category:
        where_parts.append("p.category ILIKE :cat")
        params["cat"] = f"%{category}%"
    if type_group:
        where_parts.append("p.product_type_group = :type_group")
        params["type_group"] = type_group
    if bonus_only:
        where_parts.append(
            "(SELECT is_bonus FROM product_snapshots"
            " WHERE product_id = p.id ORDER BY scraped_at DESC LIMIT 1) = true"
        )

    where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    # Use LATERAL JOINs to:
    # 1. Get the latest snapshot for each product (for own price)
    # 2. Find the cheapest bundle that contains this single product
    # 3. Sort by effective cheapest per-unit price (own or via bundle)
    sql = f"""
        SELECT
            p.id,
            bp.id               AS bundle_id,
            bp.name             AS bundle_name,
            bps.price_per_kg    AS bundle_price_per_kg,
            bps.price_per_litre AS bundle_price_per_litre,
            bps.price_per_piece AS bundle_price_per_piece,
            ord.times_ordered   AS order_times,
            ord.min_price_paid  AS order_min_price_paid,
            ord.min_per_kg      AS order_min_per_kg,
            ord.min_per_litre   AS order_min_per_litre,
            ord.min_per_piece   AS order_min_per_piece,
            COUNT(*) OVER()     AS total_count
        FROM products p
        LEFT JOIN LATERAL (
            SELECT price_per_kg, price_per_litre, price_per_piece
            FROM product_snapshots
            WHERE product_id = p.id
            ORDER BY scraped_at DESC LIMIT 1
        ) ps ON true
        LEFT JOIN LATERAL (
            SELECT pb.id, pb.name
            FROM products pb
            WHERE pb.store_id = p.store_id
              AND pb.bundle_child_external_id = p.external_id
              AND pb.is_active = true
            ORDER BY (
                SELECT COALESCE(price_per_kg, price_per_litre, price_per_piece)
                FROM product_snapshots WHERE product_id = pb.id
                ORDER BY scraped_at DESC LIMIT 1
            ) ASC NULLS LAST
            LIMIT 1
        ) bp ON true
        LEFT JOIN LATERAL (
            SELECT price_per_kg, price_per_litre, price_per_piece
            FROM product_snapshots
            WHERE product_id = bp.id
            ORDER BY scraped_at DESC LIMIT 1
        ) bps ON bp.id IS NOT NULL
        LEFT JOIN LATERAL (
            SELECT
                COUNT(DISTINCT oi.order_id)                                              AS times_ordered,
                MIN(oi.price_paid)                                                       AS min_price_paid,
                MIN(CASE WHEN snap.weight_g > 0
                        THEN oi.price_paid / (snap.weight_g::numeric / 1000) END)       AS min_per_kg,
                MIN(CASE WHEN snap.volume_ml > 0
                        THEN oi.price_paid / (snap.volume_ml::numeric / 1000) END)      AS min_per_litre,
                MIN(CASE WHEN snap.pieces > 0
                        THEN oi.price_paid / snap.pieces::numeric END)                  AS min_per_piece
            FROM order_items oi
            JOIN LATERAL (
                SELECT weight_g, volume_ml, pieces
                FROM product_snapshots WHERE product_id = p.id
                ORDER BY scraped_at DESC LIMIT 1
            ) snap ON true
            WHERE oi.product_id = p.id AND oi.price_paid > 0
        ) ord ON true
        {where_sql}
        ORDER BY
            LEAST(
                COALESCE(ps.price_per_kg, ps.price_per_litre, ps.price_per_piece),
                COALESCE(bps.price_per_kg, bps.price_per_litre, bps.price_per_piece)
            ) ASC NULLS LAST,
            p.name ASC
        LIMIT :lim OFFSET :off
    """

    rows = (await db.execute(text(sql), params)).fetchall()
    if not rows:
        return ProductsPage(total=0, items=[])

    total = rows[0].total_count
    ordered_ids = [r.id for r in rows]
    pid_to_bundle: dict[int, BundleInfo | None] = {
        r.id: BundleInfo(
            id=r.bundle_id,
            name=r.bundle_name,
            price_per_kg=r.bundle_price_per_kg,
            price_per_litre=r.bundle_price_per_litre,
            price_per_piece=r.bundle_price_per_piece,
        ) if r.bundle_id else None
        for r in rows
    }
    pid_to_order: dict[int, OrderBought | None] = {
        r.id: OrderBought(
            times=r.order_times,
            min_price_paid=r.order_min_price_paid,
            min_per_kg=r.order_min_per_kg,
            min_per_litre=r.order_min_per_litre,
            min_per_piece=r.order_min_per_piece,
        ) if r.order_times else None
        for r in rows
    }

    prods_result = await db.execute(
        select(Product).options(selectinload(Product.snapshots)).where(Product.id.in_(ordered_ids))
    )
    prods_by_id = {p.id: p for p in prods_result.scalars().all()}

    items: list[ProductOut] = []
    for pid in ordered_ids:
        p = prods_by_id.get(pid)
        if p:
            out = ProductOut.model_validate(p)
            updates: dict = {}
            b = pid_to_bundle.get(pid)
            if b:
                updates["bundle"] = b
            ob = pid_to_order.get(pid)
            if ob:
                updates["order_bought"] = ob
            if updates:
                out = out.model_copy(update=updates)
            items.append(out)

    return ProductsPage(total=total, items=items)


@router.get("/groups", response_model=ProductGroupsPage)
async def list_product_groups(
    q: str | None = Query(None),
    bonus_only: bool = False,
    limit: int = Query(20, le=100),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """Return products grouped by product_group_name, sorted cheapest-first within each group."""
    # Build base filters
    name_filter = (
        Product.name.ilike(f"%{q}%") | Product.name_en.ilike(f"%{q}%") | Product.product_group_name.ilike(f"%{q}%")
    ) if q else None
    group_filter = Product.product_group_name.isnot(None) & (Product.is_active == True)

    bonus_subq = None
    if bonus_only:
        bonus_subq = (
            select(ProductSnapshot.product_id)
            .where(ProductSnapshot.is_bonus == True)
            .order_by(ProductSnapshot.product_id, ProductSnapshot.scraped_at.desc())
            .distinct(ProductSnapshot.product_id)
            .scalar_subquery()
        )

    # Count distinct group names
    count_q = select(func.count(func.distinct(Product.product_group_name))).where(group_filter)
    if name_filter is not None:
        count_q = count_q.where(name_filter)
    if bonus_subq is not None:
        count_q = count_q.where(Product.id.in_(bonus_subq))

    total = (await db.execute(count_q)).scalar_one()

    # Get paginated group names
    groups_q = select(Product.product_group_name).where(group_filter)
    if name_filter is not None:
        groups_q = groups_q.where(name_filter)
    if bonus_subq is not None:
        groups_q = groups_q.where(Product.id.in_(bonus_subq))
    groups_q = (
        groups_q.group_by(Product.product_group_name)
        .order_by(Product.product_group_name)
        .offset(offset)
        .limit(limit)
    )
    group_names = [r[0] for r in (await db.execute(groups_q)).all()]

    if not group_names:
        return ProductGroupsPage(total_groups=total, groups=[])

    # Load all products for those group names
    products_result = await db.execute(
        select(Product)
        .options(selectinload(Product.snapshots))
        .where(Product.product_group_name.in_(group_names))
        .order_by(Product.product_group_name, Product.name)
    )
    all_products = products_result.scalars().all()

    # Group and sort cheapest-first by effective price
    from collections import defaultdict
    groups_map: dict[str, list[Product]] = defaultdict(list)
    for p in all_products:
        groups_map[p.product_group_name].append(p)

    def _eff_price(p: Product) -> Decimal:
        snap = p.snapshots[0] if p.snapshots else None
        if not snap or snap.price == 0:
            return Decimal("9999")
        return snap.bonus_price if snap.is_bonus and snap.bonus_price else snap.price

    groups_out = []
    for gname in group_names:
        prods = sorted(groups_map.get(gname, []), key=_eff_price)
        groups_out.append(ProductGroupOut(
            group_name=gname,
            variant_count=len(prods),
            products=prods,
        ))

    return ProductGroupsPage(total_groups=total, groups=groups_out)


@router.get("/type-groups", response_model=TypeGroupsPage)
async def list_type_groups(
    q: str | None = Query(None),
    limit: int = Query(20, le=100),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """Return cross-brand product type groups (e.g. 'Bruine bonen') with price range and brands."""
    from sqlalchemy import distinct as sa_distinct

    type_filter = Product.product_type_group.isnot(None) & (Product.is_active == True)
    search_filter = Product.product_type_group.ilike(f"%{q}%") if q else None

    count_q = select(func.count(func.distinct(Product.product_type_group))).where(type_filter)
    if search_filter is not None:
        count_q = count_q.where(search_filter)
    total = (await db.execute(count_q)).scalar_one()

    groups_q = select(Product.product_type_group).where(type_filter)
    if search_filter is not None:
        groups_q = groups_q.where(search_filter)
    groups_q = (
        groups_q.group_by(Product.product_type_group)
        .order_by(Product.product_type_group)
        .offset(offset)
        .limit(limit)
    )
    type_group_names = [r[0] for r in (await db.execute(groups_q)).all()]

    if not type_group_names:
        return TypeGroupsPage(total_groups=total, groups=[])

    # Aggregate per type group: count, distinct brands, min/max latest effective price
    rows = await db.execute(
        select(
            Product.product_type_group,
            func.count(Product.id),
            func.array_agg(func.distinct(Product.brand)).label("brands"),
        )
        .where(Product.product_type_group.in_(type_group_names))
        .group_by(Product.product_type_group)
        .order_by(Product.product_type_group)
    )
    agg = {r[0]: {"count": r[1], "brands": [b for b in (r[2] or []) if b]} for r in rows}

    # Get price ranges via latest snapshot per product
    price_rows = await db.execute(
        text("""
            SELECT p.product_type_group,
                   MIN(CASE WHEN ps.is_bonus AND ps.bonus_price IS NOT NULL THEN ps.bonus_price ELSE ps.price END),
                   MAX(ps.price)
            FROM products p
            JOIN LATERAL (
                SELECT price, is_bonus, bonus_price
                FROM product_snapshots
                WHERE product_id = p.id
                ORDER BY scraped_at DESC LIMIT 1
            ) ps ON true
            WHERE p.product_type_group = ANY(:groups) AND ps.price > 0
            GROUP BY p.product_type_group
        """),
        {"groups": type_group_names},
    )
    prices = {r[0]: (r[1], r[2]) for r in price_rows}

    groups_out = []
    for tg in type_group_names:
        a = agg.get(tg, {"count": 0, "brands": []})
        pr = prices.get(tg, (None, None))
        groups_out.append(TypeGroupOut(
            type_group=tg,
            product_count=a["count"],
            brands=sorted(a["brands"])[:10],
            min_price=float(pr[0]) if pr[0] is not None else None,
            max_price=float(pr[1]) if pr[1] is not None else None,
        ))

    return TypeGroupsPage(total_groups=total, groups=groups_out)


@router.patch("/{product_id}/type-group", response_model=ProductOut)
async def patch_product_type_group(
    product_id: int,
    body: PatchTypeGroupIn,
    db: AsyncSession = Depends(get_db),
):
    """Manually set or clear a product's type group. Overrides scraper assignment."""
    product = await db.get(Product, product_id, options=[selectinload(Product.snapshots)])
    if not product:
        raise HTTPException(404, "Product not found")
    product.product_type_group = body.type_group.strip() if body.type_group else None
    product.type_group_override = body.type_group is not None
    await db.commit()
    await db.refresh(product)
    return product


@router.patch("/{product_id}/group", response_model=ProductOut)
async def patch_product_group(
    product_id: int,
    body: PatchGroupIn,
    db: AsyncSession = Depends(get_db),
):
    """Manually set or clear a product's group name. Setting overrides scraper normalization."""
    product = await db.get(Product, product_id, options=[selectinload(Product.snapshots)])
    if not product:
        raise HTTPException(404, "Product not found")
    product.product_group_name = body.group_name
    product.group_override = body.group_name is not None
    await db.commit()
    await db.refresh(product)
    return product


@router.patch("/{product_id}/name-en", response_model=ProductOut)
async def patch_product_name_en(
    product_id: int,
    body: PatchNameEnIn,
    db: AsyncSession = Depends(get_db),
):
    """Manually set or clear the English name for a product."""
    product = await db.get(Product, product_id, options=[selectinload(Product.snapshots)])
    if not product:
        raise HTTPException(404, "Product not found")
    product.name_en = body.name_en.strip() if body.name_en else None
    await db.commit()
    await db.refresh(product)
    return product


@router.get("/{product_id}/variants", response_model=list[ProductOut])
async def get_product_variants(product_id: int, db: AsyncSession = Depends(get_db)):
    """Return all products in the same product_group_name (package variants)."""
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(404, "Product not found")
    if not product.product_group_name:
        return []
    result = await db.execute(
        select(Product)
        .options(selectinload(Product.snapshots))
        .where(
            Product.product_group_name == product.product_group_name,
            Product.store_id == product.store_id,
        )
        .order_by(Product.name)
    )
    return result.scalars().all()


@router.get("/{product_id}/price-stats", response_model=PriceStatsOut)
async def get_price_stats(
    product_id: int,
    filter_product_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(404, "Product not found")

    # Collect all products in this group (for group-level stats)
    group_products: list[GroupProductRef] = []
    stat_ids: list[int] = [product_id]
    if product.product_group_name:
        gp_rows = (await db.execute(
            select(Product.id, Product.name)
            .where(
                Product.product_group_name == product.product_group_name,
                Product.store_id == product.store_id,
            )
            .order_by(Product.name)
        )).all()
        group_products = [GroupProductRef(id=r.id, name=r.name) for r in gp_rows]
        stat_ids = [r.id for r in gp_rows] or [product_id]

    # Narrow to single product when filter is active
    valid_filter = filter_product_id if filter_product_id and filter_product_id in stat_ids else None
    if valid_filter:
        stat_ids = [valid_filter]

    unit_col, unit_label = _unit_col_and_label(product.unit_type)

    eff_price_expr = case(
        (and_(ProductSnapshot.is_bonus, ProductSnapshot.bonus_price.isnot(None)), ProductSnapshot.bonus_price),
        else_=ProductSnapshot.price,
    )

    periods: dict[str, PeriodStats] = {}
    for label, days in [("3m", 90), ("6m", 180), ("1y", 365), ("all", None)]:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days) if days else None
        where = [ProductSnapshot.product_id.in_(stat_ids), ProductSnapshot.price > 0]
        if cutoff:
            where.append(ProductSnapshot.scraped_at >= cutoff)

        unit_attr = getattr(ProductSnapshot, unit_col) if unit_col else None
        row = await db.execute(
            select(
                func.count(ProductSnapshot.id),
                func.min(eff_price_expr),
                func.avg(eff_price_expr),
                func.max(ProductSnapshot.price),
                func.min(unit_attr) if unit_attr is not None else func.min(ProductSnapshot.price),
                func.avg(unit_attr) if unit_attr is not None else func.avg(ProductSnapshot.price),
                func.max(unit_attr) if unit_attr is not None else func.max(ProductSnapshot.price),
            ).where(*where)
        )
        cnt, mn, avg_, mx, mn_u, avg_u, mx_u = row.one()
        periods[label] = PeriodStats(
            count=cnt or 0,
            min_price=mn,
            avg_price=round(avg_, 2) if avg_ else None,
            max_price=mx,
            min_per_unit=mn_u,
            avg_per_unit=round(avg_u, 4) if avg_u else None,
            max_per_unit=mx_u,
            unit_label=unit_label,
        )

    hist_rows = (await db.execute(
        select(ProductSnapshot, Product.id, Product.name)
        .join(Product, ProductSnapshot.product_id == Product.id)
        .where(ProductSnapshot.product_id.in_(stat_ids), ProductSnapshot.price > 0)
        .order_by(ProductSnapshot.scraped_at.asc())
        .limit(500)
    )).all()
    history = [
        PriceHistoryEntry(
            scraped_at=s.scraped_at,
            price=s.price,
            effective_price=s.bonus_price if s.is_bonus and s.bonus_price else s.price,
            is_bonus=s.is_bonus,
            bonus_until=s.bonus_until,
            price_per_kg=s.price_per_kg,
            price_per_litre=s.price_per_litre,
            price_per_100g=s.price_per_100g,
            price_per_100ml=s.price_per_100ml,
            price_per_piece=s.price_per_piece,
            product_id=pid,
            product_name=pname,
        )
        for s, pid, pname in hist_rows
    ]

    return PriceStatsOut(
        product_id=product_id,
        unit_type=product.unit_type,
        periods=periods,
        history=history,
        group_name=product.product_group_name,
        group_products=group_products,
        filter_product_id=valid_filter,
    )


def _unit_col_and_label(unit_type: str) -> tuple[str | None, str | None]:
    if unit_type == "weight":
        return "price_per_kg", "/kg"
    if unit_type == "volume":
        return "price_per_litre", "/l"
    if unit_type == "pieces":
        return "price_per_piece", "/st"
    return None, None


@router.get("/{product_id}/order-stats")
async def get_product_order_stats(product_id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(text("""
        SELECT
            COUNT(DISTINCT o.id)        AS times_ordered,
            MAX(o.order_date)           AS last_ordered_at,
            SUM(oi.quantity)            AS total_qty,
            MIN(oi.price_paid)          AS min_price_paid,
            AVG(oi.price_paid)          AS avg_price_paid,
            -- Normalize: price_paid / (weight_g/1000) for /kg, price_paid / (volume_ml/1000) for /l
            MIN(CASE WHEN ps.weight_g > 0
                    THEN oi.price_paid / (ps.weight_g::numeric / 1000)
                END)                    AS min_per_kg,
            AVG(CASE WHEN ps.weight_g > 0
                    THEN oi.price_paid / (ps.weight_g::numeric / 1000)
                END)                    AS avg_per_kg,
            MIN(CASE WHEN ps.volume_ml > 0
                    THEN oi.price_paid / (ps.volume_ml::numeric / 1000)
                END)                    AS min_per_litre,
            AVG(CASE WHEN ps.volume_ml > 0
                    THEN oi.price_paid / (ps.volume_ml::numeric / 1000)
                END)                    AS avg_per_litre,
            MIN(CASE WHEN ps.pieces > 0
                    THEN oi.price_paid / ps.pieces::numeric
                END)                    AS min_per_piece,
            AVG(CASE WHEN ps.pieces > 0
                    THEN oi.price_paid / ps.pieces::numeric
                END)                    AS avg_per_piece,
            p.unit_type
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        JOIN LATERAL (
            SELECT weight_g, volume_ml, pieces
            FROM product_snapshots
            WHERE product_id = p.id
            ORDER BY scraped_at DESC LIMIT 1
        ) ps ON true
        WHERE oi.product_id = :pid AND oi.price_paid > 0
        GROUP BY p.unit_type
    """), {"pid": product_id})).one_or_none()

    if not row or row.times_ordered == 0:
        return None

    def _f(v) -> float | None:
        return round(float(v), 4) if v is not None else None

    return {
        "times_ordered": row.times_ordered,
        "total_qty": float(row.total_qty or 0),
        "last_ordered_at": row.last_ordered_at.isoformat() if row.last_ordered_at else None,
        "min_price_paid": _f(row.min_price_paid),
        "avg_price_paid": _f(row.avg_price_paid),
        "min_per_kg": _f(row.min_per_kg),
        "avg_per_kg": _f(row.avg_per_kg),
        "min_per_litre": _f(row.min_per_litre),
        "avg_per_litre": _f(row.avg_per_litre),
        "min_per_piece": _f(row.min_per_piece),
        "avg_per_piece": _f(row.avg_per_piece),
        "unit_type": row.unit_type,
    }


@router.get("/{product_id}", response_model=ProductOut)
async def get_product(product_id: int, db: AsyncSession = Depends(get_db)):
    product = await db.get(Product, product_id, options=[selectinload(Product.snapshots)])
    if not product:
        raise HTTPException(404, "Product not found")
    return product


@router.get("/{product_id}/history", response_model=list[SnapshotOut])
async def get_price_history(
    product_id: int,
    days: int = Query(90, le=365),
    db: AsyncSession = Depends(get_db),
):
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    result = await db.execute(
        select(ProductSnapshot)
        .where(ProductSnapshot.product_id == product_id, ProductSnapshot.scraped_at >= cutoff)
        .order_by(ProductSnapshot.scraped_at.asc())
    )
    return result.scalars().all()
