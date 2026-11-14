import json
import sqlite3
import time
from pathlib import Path
from typing import Any
from app.config import get_settings


class SQLiteCache:
    """Lightweight SQLite key-value cache with TTL and stale-fallback support."""

    def __init__(self, db_path: str | None = None) -> None:
        settings = get_settings()
        self.db_path = Path(db_path or settings.cache_db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=10.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS api_cache (
                    cache_key TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    fetched_at_utc TEXT NOT NULL,
                    created_epoch REAL NOT NULL,
                    ttl_seconds INTEGER NOT NULL
                )
                """
            )
            conn.commit()

    def get(self, key: str, allow_stale: bool = False) -> tuple[dict[str, Any], str, bool] | None:
        """
        Returns (payload_dict, fetched_at_utc, is_stale) or None if missing.
        If allow_stale=False, expired entries return None.
        If allow_stale=True, expired entries are returned with is_stale=True for offline/error fallback.
        """
        now = time.time()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT payload_json, fetched_at_utc, created_epoch, ttl_seconds FROM api_cache WHERE cache_key = ?",
                (key,),
            ).fetchone()

        if row is None:
            return None

        is_expired = (now - float(row["created_epoch"])) > int(row["ttl_seconds"])
        if is_expired and not allow_stale:
            return None

        payload = json.loads(row["payload_json"])
        return payload, str(row["fetched_at_utc"]), is_expired

    def set(self, key: str, payload: dict[str, Any], fetched_at_utc: str, ttl_seconds: int) -> None:
        now = time.time()
        serialized = json.dumps(payload, ensure_ascii=False)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO api_cache (cache_key, payload_json, fetched_at_utc, created_epoch, ttl_seconds)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    fetched_at_utc = excluded.fetched_at_utc,
                    created_epoch = excluded.created_epoch,
                    ttl_seconds = excluded.ttl_seconds
                """,
                (key, serialized, fetched_at_utc, now, ttl_seconds),
            )
            conn.commit()