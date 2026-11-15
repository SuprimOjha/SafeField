"""Cache backend selection.

Local development keeps SQLite. Setting SUPABASE_DB_URL switches the API
response cache and the IMERG grid cache to Supabase Postgres without changing
any caller.
"""

from app.cache.sqlite_cache import SQLiteCache
from app.config import Settings, get_settings


def create_cache(settings: Settings | None = None, db_path: str | None = None) -> SQLiteCache:
    resolved = settings or get_settings()
    if resolved.postgres_cache_enabled:
        from app.cache.postgres_cache import PostgresCache

        return PostgresCache(settings=resolved)
    return SQLiteCache(db_path or resolved.cache_db_path)


def create_imerg_cache(settings: Settings | None = None):
    resolved = settings or get_settings()
    if resolved.postgres_cache_enabled:
        from app.cache.postgres_cache import PostgresImergGridCache

        return PostgresImergGridCache(settings=resolved)
    from app.services.imerg.grid_cache import ImergGridCache

    return ImergGridCache(resolved.cache_db_path)
