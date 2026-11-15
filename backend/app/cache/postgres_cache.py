"""Supabase Postgres cache backends.

The SQLite implementations remain the local default. These subclasses keep the
same public API and SQL, translating the project's ``?`` placeholders to
psycopg's ``%s`` and reusing a small connection pool. The SQLite classes are
not rewritten, so existing tests and local development keep working unchanged.

Privacy: cache keys already use rounded coordinates, and this layer stores
exactly what the SQLite cache stores.
"""

from __future__ import annotations

import re
import threading
from typing import Any, Iterable, Sequence

from app.cache.sqlite_cache import SQLiteCache
from app.config import Settings, get_settings
from app.services.imerg.grid_cache import ImergGridCache


IMERG_TABLE_DDL = """
    CREATE TABLE IF NOT EXISTS imerg_daily_cells (
        date_utc TEXT NOT NULL,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        precipitation_mm_day DOUBLE PRECISION NOT NULL,
        valid_samples INTEGER NOT NULL,
        granule_id TEXT NOT NULL,
        product TEXT NOT NULL,
        version TEXT NOT NULL,
        stream TEXT NOT NULL,
        fetched_at_utc TEXT NOT NULL,
        PRIMARY KEY(date_utc, latitude, longitude, granule_id)
    )
"""

API_CACHE_TABLE_DDL = """
    CREATE TABLE IF NOT EXISTS api_cache (
        cache_key TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        fetched_at_utc TEXT NOT NULL,
        created_epoch DOUBLE PRECISION NOT NULL,
        ttl_seconds INTEGER NOT NULL
    )
"""


_QUALIFIED_TABLES = re.compile(r"(?<![\w.])(api_cache|imerg_daily_cells)(?![\w])")


def qualify_tables(sql: str) -> str:
    """Qualify cache tables so a transaction-mode pooler cannot lose search_path."""
    return _QUALIFIED_TABLES.sub(r"safefield.\1", sql)


def to_pg_placeholders(sql: str) -> str:
    """Convert the project's ``?`` placeholders to psycopg ``%s`` placeholders.

    None of this project's parameterised statements contain a literal ``?``,
    and statements containing a literal ``%`` (the legacy version fix) are
    executed without parameters, so psycopg does not format them.
    """
    return sql.replace("?", "%s")


_pools: dict[str, Any] = {}
_pool_lock = threading.Lock()


def _connection_pool(db_url: str):
    from psycopg.rows import dict_row
    from psycopg_pool import ConnectionPool

    with _pool_lock:
        pool = _pools.get(db_url)
        if pool is None:
            pool = ConnectionPool(
                db_url,
                min_size=1,
                max_size=4,
                open=True,
                kwargs={"row_factory": dict_row, "connect_timeout": 10},
            )
            _pools[db_url] = pool
        return pool


def close_postgres_pools() -> None:
    """Close pooled connections (used on application shutdown and in tests)."""
    with _pool_lock:
        pools = list(_pools.values())
        _pools.clear()
    for pool in pools:
        try:
            pool.close()
        except Exception:  # a dead pool must not block shutdown
            pass


class PgConnection:
    """Small adapter so SQLite-style ``with``/``execute`` code runs on psycopg."""

    def __init__(self, db_url: str) -> None:
        self._context = _connection_pool(db_url).connection()
        self._conn = self._context.__enter__()
        try:
            # Keep this project's tables out of the "public" schema, which
            # Supabase exposes through PostgREST to the anon key. The backend
            # connects as the database owner and uses this private schema.
            self._conn.execute("CREATE SCHEMA IF NOT EXISTS safefield")
            self._conn.execute("SET search_path TO safefield, public")
            self._conn.commit()
        except BaseException as exc:
            # Release the pooled connection instead of leaking it when schema
            # setup fails; __exit__ is the only path that returns it.
            try:
                self._conn.rollback()
            except Exception:
                pass
            self._context.__exit__(type(exc), exc, exc.__traceback__)
            raise

    def execute(self, sql: str, params: Sequence[Any] | None = None):
        statement = qualify_tables(sql)
        if params is None or len(params) == 0:
            return self._conn.execute(statement)
        return self._conn.execute(to_pg_placeholders(statement), params)

    def executemany(self, sql: str, rows: Iterable[Sequence[Any]]):
        with self._conn.cursor() as cursor:
            cursor.executemany(to_pg_placeholders(qualify_tables(sql)), rows)
            return cursor

    def commit(self) -> None:
        self._conn.commit()

    def __enter__(self) -> "PgConnection":
        return self

    def __exit__(self, exc_type, exc, traceback) -> bool:
        try:
            if exc_type is None:
                self._conn.commit()
            else:
                self._conn.rollback()
        finally:
            self._context.__exit__(exc_type, exc, traceback)
        return False


class PostgresCache(SQLiteCache):
    """Cache backend storing API responses in Supabase Postgres."""

    def __init__(self, db_url: str | None = None, settings: Settings | None = None) -> None:
        resolved = settings or get_settings()
        self.db_url = (db_url or resolved.supabase_db_url).strip()
        if not self.db_url:
            raise ValueError(
                "SUPABASE_DB_URL is not set; configure it in backend/.env to use Supabase Postgres."
            )
        self._init_db()

    def _connect(self) -> PgConnection:
        return PgConnection(self.db_url)

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(API_CACHE_TABLE_DDL)
            conn.commit()


class PostgresImergGridCache(ImergGridCache):
    """IMERG grid cache storing cells in Supabase Postgres."""

    def __init__(self, db_url: str | None = None, settings: Settings | None = None) -> None:
        resolved = settings or get_settings()
        self.db_url = (db_url or resolved.supabase_db_url).strip()
        if not self.db_url:
            raise ValueError(
                "SUPABASE_DB_URL is not set; configure it in backend/.env to use Supabase Postgres."
            )
        self._init_db()

    def _connect(self) -> PgConnection:
        return PgConnection(self.db_url)

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(IMERG_TABLE_DDL)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_imerg_daily_location "
                "ON imerg_daily_cells(latitude, longitude, date_utc)"
            )
            conn.execute(
                "UPDATE imerg_daily_cells SET version = '07C' "
                "WHERE granule_id LIKE '%.V07C' AND version <> '07C'"
            )
            conn.commit()

    def _insert_cells_sql(self) -> str:
        return """INSERT INTO imerg_daily_cells
                (date_utc, latitude, longitude, precipitation_mm_day, valid_samples, granule_id, product, version, stream, fetched_at_utc)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (date_utc, latitude, longitude, granule_id) DO UPDATE SET
                    precipitation_mm_day = excluded.precipitation_mm_day,
                    valid_samples = excluded.valid_samples,
                    product = excluded.product,
                    version = excluded.version,
                    stream = excluded.stream,
                    fetched_at_utc = excluded.fetched_at_utc"""
