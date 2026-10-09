import os
import json
from typing import AsyncIterator
import httpx

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://host.docker.internal:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:14b")

SYSTEM_PROMPT = """You are a helpful meal planning and grocery assistant for a Dutch family.
You help plan meals, optimize grocery shopping, and provide nutrition insights.
Respond concisely and practically. When listing items, be specific.
Prices are in euros. Products are from Albert Heijn (AH)."""


async def chat_stream(messages: list[dict], system: str = SYSTEM_PROMPT) -> AsyncIterator[str]:
    payload = {
        "model": OLLAMA_MODEL,
        "messages": [{"role": "system", "content": system}] + messages,
        "stream": True,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream("POST", f"{OLLAMA_URL}/api/chat", json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if line:
                    data = json.loads(line)
                    if chunk := data.get("message", {}).get("content", ""):
                        yield chunk
                    if data.get("done"):
                        break


async def complete(prompt: str, system: str = SYSTEM_PROMPT) -> str:
    payload = {
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
        resp.raise_for_status()
        return resp.json()["message"]["content"]


async def complete_json(prompt: str, system: str) -> dict:
    """Call Ollama with JSON output mode. Returns parsed dict."""
    payload = {
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "stream": False,
        "format": "json",
    }
    async with httpx.AsyncClient(timeout=180) as client:
        resp = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
        resp.raise_for_status()
        raw = resp.json()["message"]["content"]
        return json.loads(raw)


async def is_available() -> bool:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags")
            return resp.status_code == 200
    except Exception:
        return False
