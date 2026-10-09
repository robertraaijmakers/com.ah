import asyncio
import random
import re
from datetime import date
from typing import Any, AsyncIterator
import httpx
from auth import get_access_token, get_anonymous_token

BASE = "https://api.ah.nl"
HEADERS = {
    "User-Agent": "Appie/9.28 (iPhone17,3; iPhone; CPU OS 26_1 like Mac OS X)",
    "Content-Type": "application/json",
    "Accept": "application/json",
    "x-application": "AHWEBSHOP",
    "x-client-name": "appie-ios",
    "x-client-version": "9.28",
}

# Category default shelf life in days
SHELF_LIFE_DEFAULTS: dict[str, int] = {
    "Zuivel, eieren & boter": 10,
    "Vlees, vis & vega": 4,
    "Groente & fruit": 6,
    "Brood & gebak": 4,
    "Kaas & vleeswaren": 10,
    "Diepvries": 90,
    "Dranken": 365,
    "Houdbaar": 365,
    "Pasta, rijst & wereldkeuken": 365,
    "Sauzen, oliën & kruiden": 180,
    "Ontbijt & beleg": 90,
    "Snacks & snoep": 90,
    "Huishouden & dier": 730,
    "Baby & kind": 365,
    "Persoonlijke verzorging": 730,
}


class AHClient:
    def __init__(self):
        self._token: str | None = None
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self):
        self._client = httpx.AsyncClient(timeout=30, headers=HEADERS)
        self._token = await get_access_token() or await get_anonymous_token()
        return self

    async def __aexit__(self, *_):
        if self._client:
            await self._client.aclose()

    def _auth_headers(self) -> dict:
        return {"Authorization": f"Bearer {self._token}"}

    async def _get(self, path: str, params: dict | None = None, retries: int = 3) -> Any:
        await asyncio.sleep(random.uniform(0.5, 1.5))  # rate limit
        last_exc: Exception | None = None
        for attempt in range(retries):
            try:
                resp = await self._client.get(
                    f"{BASE}{path}",
                    params=params,
                    headers=self._auth_headers(),
                )
                if resp.status_code in (500, 502, 503, 504) and attempt < retries - 1:
                    await asyncio.sleep(2 ** attempt * 2)
                    continue
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError as e:
                last_exc = e
                if e.response.status_code < 500 or attempt >= retries - 1:
                    raise
                await asyncio.sleep(2 ** attempt * 2)
            except httpx.TransportError as e:
                last_exc = e
                if attempt >= retries - 1:
                    raise
                await asyncio.sleep(2 ** attempt * 2)
        raise last_exc  # type: ignore

    PAGE_SIZE = 250  # AH rejects size=1000 with HTTP 500

    async def search_products(self, query: str = "", page: int = 0, size: int = 250) -> list[dict]:
        data = await self._get(
            "/mobile-services/product/search/v2",
            params={"query": query, "size": size, "page": page},
        )
        return data.get("products", [])

    async def get_categories(self) -> list[dict]:
        data = await self._get("/mobile-services/v1/product-shelves/categories")
        return data if isinstance(data, list) else data.get("categories", [])

    async def get_all_taxonomy_options(self) -> list[dict]:
        """Return the 68 subcategory taxonomy options exposed by the search filter facets."""
        data = await self._get("/mobile-services/product/search/v2", {"size": 1, "page": 0})
        filters = data.get("filters", [])
        tax_filter = next((f for f in filters if f["id"] == "taxonomy"), None)
        return tax_filter.get("options", []) if tax_filter else []

    async def get_products_by_category(self, taxonomy_id: str, page: int = 0) -> dict:
        # sortOn=TAXONOMY is broken in AH API — it ignores the taxonomy filter and returns
        # products from random categories. Omitting sortOn returns correct taxonomy results
        # mixed with a small fraction of cross-category products (filtered by mainCategory later).
        return await self._get(
            "/mobile-services/product/search/v2",
            params={"taxonomy": taxonomy_id, "size": self.PAGE_SIZE, "page": page},
        )

    async def _graphql(self, query: str, variables: dict) -> dict:
        resp = await self._client.post(
            f"{BASE}/graphql",
            headers=self._auth_headers(),
            json={"query": query, "variables": variables},
        )
        resp.raise_for_status()
        return resp.json().get("data", {})

    async def get_pos_receipts_page(self, offset: int = 0, limit: int = 50) -> list[dict]:
        """In-store (POS) receipts, one page."""
        data = await self._graphql("""
        query FetchPosReceipts($offset: Int!, $limit: Int!) {
          posReceiptsPage(pagination: {offset: $offset, limit: $limit}) {
            posReceipts { id dateTime totalAmount { amount } }
          }
        }""", {"offset": offset, "limit": limit})
        return data.get("posReceiptsPage", {}).get("posReceipts", [])

    async def get_online_orders_page(self, offset: int = 0, limit: int = 50) -> list[dict]:
        """Past (CLOSED) online delivery/pickup orders via orderFulfillments GraphQL."""
        try:
            data = await self._graphql("""
            query OrderFulfillmentsClosed($offset: Int) {
              orderFulfillments(status: CLOSED, offset: $offset) {
                result {
                  orderId
                  statusCode
                  statusDescription
                  shoppingType
                  transactionCompleted
                  totalPrice { totalPrice { amount } }
                  delivery {
                    status
                    slot { date dateDisplay timeDisplay }
                  }
                }
              }
            }""", {"offset": offset})
            return data.get("orderFulfillments", {}).get("result", [])
        except Exception:
            return []

    async def get_pos_receipt_details(self, receipt_id: str) -> dict:
        data = await self._graphql("""
        query FetchReceipt($id: String!) {
          posReceiptDetails(id: $id) {
            id
            products {
              id
              quantity
              name
              price { amount }
              amount { amount }
            }
          }
        }""", {"id": receipt_id})
        return data.get("posReceiptDetails", {})

    async def convert_pos_ids(self, pos_ids: list[int]) -> dict[int, int]:
        """Batch-convert POS receipt product IDs to webshop product IDs."""
        unique = list({i for i in pos_ids if i and i > 0})
        if not unique:
            return {}
        parts = " ".join(f"p{i}: productConvertId(sourceId: {pid})" for i, pid in enumerate(unique))
        data = await self._graphql(f"query Convert {{ {parts} }}", {})
        result = {}
        for i, pid in enumerate(unique):
            v = data.get(f"p{i}")
            if v and v > 0:
                result[pid] = v
        return result

    async def get_online_order_details(self, order_id: str) -> dict:
        """Get full order details including products grouped by taxonomy."""
        try:
            data = await self._get(f"/mobile-services/order/v1/{order_id}/details-grouped-by-taxonomy")
            return data
        except Exception:
            return {}

    # Legacy alias
    async def get_receipts(self, limit: int = 50, offset: int = 0) -> list[dict]:
        return await self.get_pos_receipts_page(offset=offset, limit=limit)

    async def get_receipt_details(self, receipt_id: str) -> dict:
        return await self.get_pos_receipt_details(receipt_id)


_NX_WEIGHT = re.compile(
    r'^(\d+)\s*[xX×]\s*([\d,.]+)\s*(kg|gram|g|liter|litre|l|cl|ml)\s*$', re.I
)

_PIECES_FROM_NAME = [
    re.compile(r'\b(\d+)\s*-?\s*pack\b', re.I),
    re.compile(r'\b(\d+)\s*[xX×]\s*\d', re.I),
]
_PIECES_WORDS = {'duo': 2, 'trio': 3, 'dubbel': 2}


def _extract_pieces_from_name(name: str) -> int | None:
    for pat in _PIECES_FROM_NAME:
        m = pat.search(name)
        if m:
            try:
                v = int(m.group(1))
                if 1 < v <= 48:
                    return v
            except (ValueError, IndexError):
                pass
    nl = name.lower()
    for word, count in _PIECES_WORDS.items():
        if re.search(r'\b' + word + r'\b', nl):
            return count
    return None


_SIZE_STRIP = [
    re.compile(r'\s*\d+\s*[-–]?\s*(?:stuks?|pack|st\.?)\s*$', re.I),
    re.compile(r'\s*\d+[\.,]?\d*\s*(?:kg|gram|g|liter|litre|l|ml|cl)\s*$', re.I),
    re.compile(r'\s*\(\d+[\.,]?\d*\s*(?:kg|gram|g|liter|l|ml|cl)\)\s*$', re.I),
    re.compile(r'\s*,\s*\d+[\.,]?\d*\s*(?:kg|gram|g|liter|l|ml|cl)\s*$', re.I),
    re.compile(r'\s*\d+\s*[xX]\s*[\d,.]+\s*(?:kg|gram|g|liter|l|ml|cl)?\s*$', re.I),
    re.compile(r'\s*\d+\s*[xX]\s*$', re.I),  # trailing "6x" after size is stripped
    re.compile(r'\s*(?:voordeelpak|megapack|multipack|familiepack|trio|duo)\s*$', re.I),
    # Packaging-size qualifiers that don't contain numbers
    re.compile(r'\s*(?:extra\s*)?(?:groot|kleine?|mini|maxi)verpakking\s*$', re.I),
    re.compile(r'\s*(?:voordeel|mega|super|familie|jumbo)\s*(?:pak|verpakking|formaat)\s*$', re.I),
    re.compile(r'\s*(?:economy|economy\s*size|value\s*pack)\s*$', re.I),
    # Trailing size letters (XXL, XL) only when clearly a size indicator
    re.compile(r'\s+(?:XXL|XL)\s*$'),
]


_QUALITY_MODS = re.compile(
    r'^(Biologisch|Bio|Premium|Vers(?:e)?|Huismerk|Excellent)\s+',
    re.I,
)


def normalize_product_name(name: str) -> str:
    """Strip pack/size suffixes to produce a base name for grouping variants."""
    n = name.strip()
    changed = True
    while changed:
        prev = n
        for pat in _SIZE_STRIP:
            n = pat.sub('', n).strip()
        changed = n != prev
    return n or name.strip()


def derive_group_name(name: str, brand: str | None) -> str:
    """Normalize to cross-brand group: strip brand prefix + quality modifiers."""
    n = normalize_product_name(name)
    if brand:
        prefix = brand + " "
        # Strip repeated brand prefix (AH API sometimes doubles it)
        while n.lower().startswith(prefix.lower()):
            n = n[len(prefix):].strip()
    n = _QUALITY_MODS.sub('', n).strip()
    return n or normalize_product_name(name)


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except (ValueError, TypeError):
        return None


def parse_product(raw: dict) -> dict:
    """Normalize AH API product dict to our schema."""
    webshop_id = str(raw.get("webshopId", raw.get("id", "")))
    name = raw.get("title", raw.get("name", ""))
    ean = str(raw.get("ean", raw.get("gtin", "") or "")).strip() or None
    price = float(raw.get("currentPrice") or raw.get("priceBeforeBonus") or 0)
    price_before_bonus = raw.get("priceBeforeBonus")
    is_bonus = raw.get("isBonus", False)
    brand = raw.get("brand", {})
    brand_name = brand.get("name") if isinstance(brand, dict) else brand

    # Parse sales unit size for weight/volume/pieces
    sales_unit = raw.get("salesUnitSize", "")
    weight_g = volume_ml = pieces = None
    unit_type = "pieces"

    if sales_unit:
        su = sales_unit.lower().strip()
        nx_m = _NX_WEIGHT.match(su)
        if nx_m:
            # "2x350ml", "3x500g" — multi-pack with explicit per-piece size
            count = int(nx_m.group(1))
            amount = float(nx_m.group(2).replace(',', '.'))
            unit = nx_m.group(3).lower()
            pieces = count
            if unit == 'kg':
                weight_g = int(round(count * amount * 1000))
                unit_type = "weight"
            elif unit in ('gram', 'g'):
                weight_g = int(round(count * amount))
                unit_type = "weight"
            elif unit in ('liter', 'litre', 'l'):
                volume_ml = int(round(count * amount * 1000))
                unit_type = "volume"
            elif unit == 'cl':
                volume_ml = int(round(count * amount * 10))
                unit_type = "volume"
            elif unit == 'ml':
                volume_ml = int(round(count * amount))
                unit_type = "volume"
        elif "kg" in su:
            try:
                weight_g = int(float(su.replace("kg", "").strip()) * 1000)
                unit_type = "weight"
            except ValueError:
                pass
        elif "g" in su and "kg" not in su:
            try:
                weight_g = int(su.replace("g", "").strip())
                unit_type = "weight"
            except ValueError:
                pass
        elif "l" in su and "ml" not in su and "cl" not in su:
            try:
                volume_ml = int(float(su.replace("l", "").strip()) * 1000)
                unit_type = "volume"
            except ValueError:
                pass
        elif "cl" in su:
            try:
                volume_ml = int(float(su.replace("cl", "").strip()) * 10)
                unit_type = "volume"
            except ValueError:
                pass
        elif "ml" in su:
            try:
                volume_ml = int(su.replace("ml", "").strip())
                unit_type = "volume"
            except ValueError:
                pass
        elif "st" in su or "stuks" in su:
            try:
                pieces = int(su.replace("stuks", "").replace("st", "").strip())
                unit_type = "pieces"
            except ValueError:
                pass

    # For virtual bundles (e.g. "2-pack"), AH exposes the exact child product and quantity
    bundle_child_external_id = None
    virtual_items = raw.get("virtualBundleItems") or []
    if raw.get("isVirtualBundle") and virtual_items:
        # Take the first (usually only) child item
        child = virtual_items[0]
        bundle_child_external_id = str(child["productId"])
        if not pieces and child.get("quantity"):
            pieces = int(child["quantity"])

    # Extract pieces count from name when salesUnitSize doesn't expose it
    if not pieces:
        pieces = _extract_pieces_from_name(name)

    # Price per unit — use discounted price when on bonus for display accuracy
    # Always compute price_per_piece: single items = 1 piece = full price
    price_per_kg = price_per_litre = price_per_100g = price_per_100ml = price_per_piece = None
    effective = price  # currentPrice (discounted when bonus)

    if weight_g and weight_g > 0:
        price_per_100g = round(effective / weight_g * 100, 4)
        price_per_kg = round(effective / weight_g * 1000, 4)
    if volume_ml and volume_ml > 0:
        price_per_100ml = round(effective / volume_ml * 100, 4)
        price_per_litre = round(effective / volume_ml * 1000, 4)

    effective_pieces = pieces if (pieces and pieces > 0) else 1
    price_per_piece = round(effective / effective_pieces, 4)
    if not pieces:
        pieces = 1

    category = raw.get("mainCategory", "")
    shelf_life = SHELF_LIFE_DEFAULTS.get(category)

    # Regular price is price_before_bonus when on sale; currentPrice is the discounted price
    regular_price = float(price_before_bonus) if is_bonus and price_before_bonus else price
    discounted_price = price if is_bonus and price_before_bonus else None

    # Availability and channel
    avail_status = raw.get("orderAvailabilityStatus", "IN_ASSORTMENT")
    available_online = raw.get("availableOnline", True)
    # available_in_store is in the detail endpoint properties; None = unknown from search
    shop_type = raw.get("shopType")
    nix18 = raw.get("nix18", False)
    raw_nutriscore = raw.get("nutriscore")
    nutriscore_letter = raw_nutriscore if raw_nutriscore and len(raw_nutriscore) == 1 else None
    hq_id = raw.get("hqId")

    return {
        "external_id": webshop_id,
        "name": name,
        "brand": brand_name,
        "category": category,
        "sub_category": raw.get("subCategory"),
        "image_url": (raw.get("images") or [{}])[0].get("url") if raw.get("images") else raw.get("imageUrl"),
        "unit_type": unit_type,
        "shelf_life_days": shelf_life,
        "product_group_name": derive_group_name(name, brand_name),
        "product_type_group": raw.get("subCategory"),
        "barcode": ean,
        "bundle_child_external_id": bundle_child_external_id,
        # New metadata fields
        "hq_id": hq_id,
        "shop_type": shop_type,
        "available_online": available_online,
        "nix18": bool(nix18),
        "nutriscore_letter": nutriscore_letter,
        "availability_status": avail_status,  # IN_ASSORTMENT | OUT_OF_STOCK | INACTIVE
        "snapshot": {
            "price": round(regular_price, 2),
            "is_bonus": is_bonus,
            "bonus_price": round(discounted_price, 2) if discounted_price else None,
            "bonus_until": _parse_date(raw.get("bonusEndDate")),
            "price_per_kg": price_per_kg,
            "price_per_litre": price_per_litre,
            "price_per_100g": price_per_100g,
            "price_per_100ml": price_per_100ml,
            "price_per_piece": price_per_piece,
            "weight_g": weight_g,
            "volume_ml": volume_ml,
            "pieces": pieces,
            "nutrition": _parse_nutrition(raw),
        },
    }


def _parse_nutrition(raw: dict) -> dict | None:
    nutr = raw.get("nutritionalInformation") or raw.get("nutrition")
    if not nutr:
        return None
    if isinstance(nutr, list):
        result = {}
        for item in nutr:
            key = item.get("key", "").lower().replace(" ", "_")
            result[key] = item.get("value")
        return result or None
    return nutr if isinstance(nutr, dict) else None
