import json
import asyncio
from datetime import datetime, timezone
from pathlib import Path
import httpx

TOKENS_FILE = Path("/app/secrets/ah_tokens.json")
AH_AUTH_BASE = "https://api.ah.nl/mobile-auth/v1/auth"
HEADERS = {"User-Agent": "Appie/8.22.3", "Content-Type": "application/json"}


def _load_tokens() -> dict:
    if not TOKENS_FILE.exists():
        return {}
    return json.loads(TOKENS_FILE.read_text())


def _save_tokens(tokens: dict) -> None:
    TOKENS_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKENS_FILE.write_text(json.dumps(tokens, indent=2))


def _is_expired(tokens: dict) -> bool:
    expires_at = tokens.get("expires_at")
    if not expires_at:
        return True
    try:
        exp = datetime.fromisoformat(expires_at)
        return datetime.now(timezone.utc) >= exp
    except ValueError:
        return True


async def _refresh(refresh_token: str) -> dict | None:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{AH_AUTH_BASE}/token/refresh",
            headers=HEADERS,
            json={"clientId": "appie", "refreshToken": refresh_token},
        )
        if resp.status_code == 200:
            return resp.json()
    return None


async def get_access_token() -> str | None:
    tokens = _load_tokens()
    if not tokens.get("access_token"):
        return None

    if not _is_expired(tokens):
        return tokens["access_token"]

    # Try refresh
    refresh_token = tokens.get("refresh_token")
    if refresh_token:
        new_tokens = await _refresh(refresh_token)
        if new_tokens:
            expires_at = datetime.now(timezone.utc).timestamp() + new_tokens.get("expires_in", 7200) - 60
            tokens = {
                "access_token": new_tokens["access_token"],
                "refresh_token": new_tokens["refresh_token"],
                "expires_at": datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat(),
            }
            _save_tokens(tokens)
            print("AH token refreshed successfully")
            return tokens["access_token"]

    print("WARNING: AH token expired and refresh failed. Re-authenticate via UI.")
    return None


async def get_anonymous_token() -> str:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{AH_AUTH_BASE}/token/anonymous",
            headers=HEADERS,
            json={"clientId": "appie"},
        )
        resp.raise_for_status()
        return resp.json()["access_token"]
