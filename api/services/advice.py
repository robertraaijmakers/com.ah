"""Price alerts ("prijsalerts") for products the household actually buys.

An alert is only created when, for a product *family* (all pack sizes and multi-packs that share a
product_group_name), one of the currently available options is at least MIN_SAVING cheaper per
unit (kg / litre / piece) than the family's normal best price, and no other option in the family
is cheaper right now. So a bonus 3-pack that still costs more per kg than the regular 1 kg pot
never produces an alert.

Families only count if they were ordered in at least MIN_ORDERS different orders in the last
LOOKBACK_DAYS, which keeps deodorant, ready-made meal kits and other one-offs out.
"""
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from sqlalchemy import bindparam, delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from models import BuyAdvice

ADVICE_TYPE = "deal"  # rows with another type come from the old engine and are rebuilt
MIN_SAVING = Decimal("0.10")   # at least 10% below the family's normal best unit price
MIN_ORDERS = 2                 # bought in at least 2 different orders...
LOOKBACK_DAYS = 365            # ...within the last year
DISMISS_SUPPRESS_DAYS = 14     # a manually dismissed alert stays away for this long
ADVICE_TTL_DAYS = 7

_UNIT_LABEL = {"kg": "kg", "l": "liter", "piece": "stuk"}

_BOUGHT_FAMILIES_SQL = text("""
    SELECT COALESCE(p.product_group_name, 'p' || p.id) AS fam, COUNT(DISTINCT oi.order_id) AS n
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    WHERE o.order_date >= :since
    GROUP BY 1
    HAVING COUNT(DISTINCT oi.order_id) >= :min_orders
""")

_MEMBERS_SQL = text("""
    SELECT p.id, p.name, COALESCE(p.product_group_name, 'p' || p.id) AS fam,
           s.price, s.is_bonus, s.bonus_price, s.bonus_until,
           s.price_per_kg, s.price_per_litre, s.price_per_piece
    FROM products p
    JOIN LATERAL (
        SELECT * FROM product_snapshots WHERE product_id = p.id ORDER BY scraped_at DESC LIMIT 1
    ) s ON true
    WHERE p.is_active
      AND (p.last_seen_at IS NULL OR p.last_seen_at >= now() - interval '7 days')
      AND COALESCE(p.product_group_name, 'p' || p.id) IN :fams
""").bindparams(bindparam("fams", expanding=True))


@dataclass
class Option:
    product_id: int
    name: str
    regular_pack: Decimal       # list price of the pack
    current_pack: Decimal       # price right now (bonus if valid)
    regular_unit: Decimal       # per kg / litre / piece
    current_unit: Decimal


def _dec(v) -> Decimal | None:
    return Decimal(str(v)) if v is not None else None


def _build_options(rows, today: date) -> tuple[str, list[Option]] | None:
    """Pick one comparable unit for the family and compute regular/current unit prices."""
    for kind, col in (("kg", "price_per_kg"), ("l", "price_per_litre"), ("piece", "price_per_piece")):
        opts: list[Option] = []
        for r in rows:
            unit_snap = _dec(getattr(r, col))
            price = _dec(r.price)
            if not unit_snap or not price or price <= 0:
                continue
            bonus_price = _dec(r.bonus_price)
            snap_effective = bonus_price if r.is_bonus and bonus_price else price
            if snap_effective <= 0:
                continue
            bonus_valid = bool(r.is_bonus and bonus_price and (r.bonus_until is None or r.bonus_until >= today))
            current_pack = bonus_price if bonus_valid else price
            # unit prices in the snapshot were computed from the effective price at scrape time
            per_euro = unit_snap / snap_effective
            opts.append(Option(
                product_id=r.id, name=r.name, regular_pack=price, current_pack=current_pack,
                regular_unit=price * per_euro, current_unit=current_pack * per_euro,
            ))
        if opts:
            return kind, opts
    return None


async def generate_buy_advice(db: AsyncSession) -> int:
    """Rebuild the alert list. Returns the number of new alerts created."""
    now = datetime.now(timezone.utc)
    today = now.date()

    # Expired alerts are removed (not "dismissed"): a dismissed row means the user said no thanks.
    await db.execute(delete(BuyAdvice).where(BuyAdvice.dismissed == False, BuyAdvice.expires_at < now))  # noqa: E712

    fams = [r.fam for r in await db.execute(
        _BOUGHT_FAMILIES_SQL, {"since": now - timedelta(days=LOOKBACK_DAYS), "min_orders": MIN_ORDERS}
    )]
    candidates: dict[int, tuple[Option, Option, str, Decimal]] = {}  # product_id -> (best, normal, kind, saving)
    if fams:
        members: dict[str, list] = {}
        for r in await db.execute(_MEMBERS_SQL, {"fams": fams}):
            members.setdefault(r.fam, []).append(r)
        for rows in members.values():
            built = _build_options(rows, today)
            if not built:
                continue
            kind, opts = built
            best = min(opts, key=lambda o: o.current_unit)          # cheapest right now
            normal = min(opts, key=lambda o: o.regular_unit)        # cheapest at normal prices
            saving = (normal.regular_unit - best.current_unit) / normal.regular_unit
            if saving >= MIN_SAVING:
                candidates[best.product_id] = (best, normal, kind, saving)

    existing = (await db.execute(select(BuyAdvice))).scalars().all()
    live = {a.product_id: a for a in existing if not a.dismissed}
    recently_dismissed = {
        a.product_id for a in existing
        if a.dismissed and a.generated_at and a.generated_at >= now - timedelta(days=DISMISS_SUPPRESS_DAYS)
    }

    # Drop alerts that no longer qualify (old engine rows, bonus ended, a better pack appeared, ...)
    for pid, adv in live.items():
        if pid not in candidates or adv.advice_type != ADVICE_TYPE:
            await db.delete(adv)

    created = 0
    for pid, (best, normal, kind, saving) in candidates.items():
        if pid in recently_dismissed:
            continue
        label = _UNIT_LABEL[kind]
        message = f"Nu €{best.current_unit:.2f} per {label} in plaats van normaal €{normal.regular_unit:.2f}"
        if normal.product_id != best.product_id:
            message += f" ({normal.name})"
        message += f", {saving * 100:.0f}% voordeliger."
        fields = dict(
            advice_type=ADVICE_TYPE, current_price=best.current_pack, avg_price_90d=best.regular_pack,
            savings_pct=round(saving * 100, 2), message=message, expires_at=now + timedelta(days=ADVICE_TTL_DAYS),
        )
        adv = live.get(pid)
        if adv and adv.advice_type == ADVICE_TYPE:
            for k, v in fields.items():
                setattr(adv, k, v)
        else:
            db.add(BuyAdvice(product_id=pid, **fields))
            created += 1

    await db.commit()
    return created
