import asyncio
from datetime import datetime, timezone
from typing import Any
import httpx
from app.config import get_settings


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


async def fetch_json_with_retry(
    url: str,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    retries: int = 2,
    timeout_seconds: float | None = None,
) -> dict[str, Any]:
    """Perform an async HTTP GET with bounded retries and explicit timeout."""
    settings = get_settings()
    timeout = timeout_seconds or settings.http_timeout_seconds
    last_exc: Exception | None = None

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        for attempt in range(retries + 1):
            try:
                response = await client.get(url, params=params, headers=headers)
                response.raise_for_status()
                return response.json()
            except (httpx.HTTPError, ValueError) as exc:
                last_exc = exc
                # A 429 is an explicit upstream rate limit. Immediate retries
                # consume more quota and do not help; let callers use cached data.
                if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 429:
                    break
                if attempt < retries:
                    await asyncio.sleep(0.6 * (attempt + 1))

    raise RuntimeError(f"Upstream request failed for {url}: {last_exc}")