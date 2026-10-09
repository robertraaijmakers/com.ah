import json
import httpx
from pathlib import Path
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/scraper", tags=["scraper"])

TOKENS_FILE = Path("/app/secrets/ah_tokens.json")

AH_LOGIN_URL = (
    "https://login.ah.nl/secure/oauth/authorize"
    "?client_id=appie&redirect_uri=appie://login-exit&response_type=code"
)


class AuthStatus(BaseModel):
    authenticated: bool
    expires_at: str | None
    login_url: str


class CallbackRequest(BaseModel):
    redirect_url: str  # Full URL: appie://login-exit?code=...


@router.get("/auth/status", response_model=AuthStatus)
async def auth_status():
    if TOKENS_FILE.exists():
        tokens = json.loads(TOKENS_FILE.read_text())
        expires_at = tokens.get("expires_at")
        authenticated = bool(tokens.get("access_token"))
    else:
        expires_at = None
        authenticated = False
    return AuthStatus(authenticated=authenticated, expires_at=expires_at, login_url=AH_LOGIN_URL)


@router.get("/auth/login-url")
async def login_url():
    return {"url": AH_LOGIN_URL, "instructions": (
        "1. Open the URL in your browser. "
        "2. Log in with your AH account. "
        "3. After login the browser will try to open 'appie://...' — copy that full URL from the address bar. "
        "4. Paste it in POST /scraper/auth/callback."
    )}


@router.post("/auth/callback")
async def auth_callback(body: CallbackRequest):
    import httpx
    url = body.redirect_url.strip()
    if "code=" not in url:
        raise HTTPException(400, "No code found in URL. Expected appie://login-exit?code=...")

    code = url.split("code=")[1].split("&")[0]

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api.ah.nl/mobile-auth/v1/auth/token",
            headers={"User-Agent": "Appie/8.22.3", "Content-Type": "application/json"},
            json={"clientId": "appie", "code": code},
        )
        if resp.status_code != 200:
            raise HTTPException(400, f"AH auth failed: {resp.text}")
        data = resp.json()

    expires_at = datetime.now(timezone.utc).timestamp() + data.get("expires_in", 7200) - 60
    tokens = {
        "access_token": data["access_token"],
        "refresh_token": data["refresh_token"],
        "expires_at": datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat(),
    }
    TOKENS_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKENS_FILE.write_text(json.dumps(tokens, indent=2))
    return {"ok": True, "expires_at": tokens["expires_at"]}


SCRAPER_URL = "http://scraper:8001"


@router.post("/trigger")
async def trigger_scrape():
    """Trigger a manual products + bonus scrape via the scraper container."""
    async with httpx.AsyncClient(timeout=5) as client:
        try:
            await client.post(f"{SCRAPER_URL}/trigger/products")
        except Exception as e:
            raise HTTPException(503, f"Scraper niet bereikbaar: {e}")
    return {"ok": True, "message": "Scrape started in background"}


@router.get("/scrape-status")
async def scrape_status():
    """Return current product scrape progress from the scraper container."""
    async with httpx.AsyncClient(timeout=3) as client:
        try:
            resp = await client.get(f"{SCRAPER_URL}/status")
            return resp.json()
        except Exception:
            return {"running": False, "phase": None, "last_run_at": None, "last_error": None}


@router.post("/trigger-orders")
async def trigger_orders(full: bool = False):
    """Trigger order scrape. full=true fetches 365 days; default is incremental (30 days)."""
    async with httpx.AsyncClient(timeout=5) as client:
        try:
            await client.post(f"{SCRAPER_URL}/trigger/orders", params={"full": full})
        except Exception as e:
            raise HTTPException(503, f"Scraper niet bereikbaar: {e}")
    return {"ok": True, "mode": "full" if full else "incremental"}


@router.get("/orders-status")
async def orders_status():
    """Return current order scrape progress."""
    async with httpx.AsyncClient(timeout=3) as client:
        try:
            resp = await client.get(f"{SCRAPER_URL}/orders-status")
            return resp.json()
        except Exception:
            return {"running": False, "mode": None, "last_run_at": None, "last_error": None, "last_result": None}


@router.get("/orders-preview")
async def orders_preview():
    """Fetch 1 POS + 1 online order and preview matching — does NOT save to DB."""
    async with httpx.AsyncClient(timeout=35) as client:
        try:
            resp = await client.get(f"{SCRAPER_URL}/trigger/orders-preview")
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            raise HTTPException(503, f"Scraper niet bereikbaar of fout: {e}")


@router.post("/trigger-rematch")
async def trigger_rematch():
    """Re-attempt product matching for all fuzzy/unmatched order items."""
    async with httpx.AsyncClient(timeout=5) as client:
        try:
            await client.post(f"{SCRAPER_URL}/trigger/rematch")
        except Exception as e:
            raise HTTPException(503, f"Scraper niet bereikbaar: {e}")
    return {"ok": True}


@router.post("/trigger-reprice")
async def trigger_reprice():
    """Re-fetch all order details to backfill price_paid (actual) and regular_price (pre-bonus)."""
    async with httpx.AsyncClient(timeout=5) as client:
        try:
            await client.post(f"{SCRAPER_URL}/trigger/reprice")
        except Exception as e:
            raise HTTPException(503, f"Scraper niet bereikbaar: {e}")
    return {"ok": True}


@router.get("/reprice-status")
async def reprice_status():
    async with httpx.AsyncClient(timeout=3) as client:
        try:
            resp = await client.get(f"{SCRAPER_URL}/reprice-status")
            return resp.json()
        except Exception:
            return {"running": False, "last_result": None, "last_error": None}


@router.post("/trigger-cleanup")
async def trigger_cleanup():
    """Remove zero-price snapshots and deduplicate consecutive identical snapshots."""
    async with httpx.AsyncClient(timeout=5) as client:
        try:
            await client.post(f"{SCRAPER_URL}/trigger/cleanup")
        except Exception as e:
            raise HTTPException(503, f"Scraper niet bereikbaar: {e}")
    return {"ok": True}


@router.post("/reset-checkpoint")
async def reset_checkpoint():
    """Clear per-category scrape checkpoint so next scrape re-scrapes everything."""
    async with httpx.AsyncClient(timeout=5) as client:
        try:
            await client.post(f"{SCRAPER_URL}/trigger/reset-checkpoint")
        except Exception as e:
            raise HTTPException(503, f"Scraper niet bereikbaar: {e}")
    return {"ok": True}


@router.post("/enrich-names")
async def enrich_names(limit: int = 50):
    """Enrich product names with English translations from Open Food Facts."""
    async with httpx.AsyncClient(timeout=5) as client:
        try:
            await client.post(f"{SCRAPER_URL}/trigger/enrich-names", params={"limit": limit})
        except Exception as e:
            raise HTTPException(503, f"Scraper niet bereikbaar: {e}")
    return {"ok": True}


@router.get("/enrich-status")
async def get_enrich_status():
    async with httpx.AsyncClient(timeout=3) as client:
        try:
            resp = await client.get(f"{SCRAPER_URL}/enrich-status")
            return resp.json()
        except Exception:
            return {"running": False, "last_result": None, "last_error": None}


@router.post("/enrich-nutrition")
async def enrich_nutrition(batch_size: int = 100):
    """Fetch nutrition data from AH API for products missing it."""
    async with httpx.AsyncClient(timeout=5) as client:
        try:
            await client.post(f"{SCRAPER_URL}/trigger/enrich-nutrition", params={"batch_size": batch_size})
        except Exception as e:
            raise HTTPException(503, f"Scraper niet bereikbaar: {e}")
    return {"ok": True}


@router.get("/nutrition-status")
async def get_nutrition_status():
    async with httpx.AsyncClient(timeout=3) as client:
        try:
            resp = await client.get(f"{SCRAPER_URL}/nutrition-status")
            return resp.json()
        except Exception:
            return {"running": False, "last_result": None, "last_error": None}


@router.get("/status")
async def scraper_status():
    authenticated = TOKENS_FILE.exists() and bool(
        json.loads(TOKENS_FILE.read_text()).get("access_token")
        if TOKENS_FILE.exists() else False
    )
    return {
        "authenticated": authenticated,
        "tokens_file": str(TOKENS_FILE),
    }
