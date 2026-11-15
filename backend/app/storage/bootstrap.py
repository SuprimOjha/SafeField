"""Prepare and verify the optional Supabase resources at startup.

The database tables and storage bucket are created idempotently. Failures are
reported in a redacted status object instead of crashing the API, so the
health endpoint keeps answering while the next scheduled refresh retries.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.cache import create_cache, create_imerg_cache
from app.config import Settings, get_settings, redact_secrets
from app.storage.sync import get_storage, restore_from_storage


class DataStorageReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    postgres: Literal["disabled", "ok", "error"] = "disabled"
    storage: Literal["disabled", "ok", "error"] = "disabled"
    restored_files: int = 0
    error: str | None = None


def initialize_data_storage(
    settings: Settings | None = None,
    *,
    restore: bool = True,
) -> DataStorageReport:
    """Create the Postgres tables and Storage bucket, then restore files.

    ``restore=False`` only verifies connectivity, which is useful from a CLI.
    """
    resolved = settings or get_settings()
    report = DataStorageReport()
    errors: list[str] = []

    if resolved.postgres_cache_enabled:
        try:
            create_cache(resolved)
            create_imerg_cache(resolved)
            report.postgres = "ok"
        except Exception as exc:  # reported, never fatal at startup
            report.postgres = "error"
            errors.append(f"Postgres: {type(exc).__name__}: {exc}")

    if resolved.supabase_storage_enabled:
        try:
            if restore and resolved.supabase_restore_on_startup:
                outcome = restore_from_storage(resolved)
                if outcome.status == "error":
                    report.storage = "error"
                    errors.append(f"Storage: {outcome.error}")
                else:
                    report.storage = "ok"
                    report.restored_files = outcome.downloaded_files
            else:
                client = get_storage(resolved)
                if client is None:
                    report.storage = "disabled"
                else:
                    try:
                        client.ensure_bucket()
                        report.storage = "ok"
                    finally:
                        client.close()
        except Exception as exc:
            report.storage = "error"
            errors.append(f"Storage: {type(exc).__name__}: {exc}")

    combined = redact_secrets("; ".join(errors), resolved)[:500]
    report.error = combined or None
    return report


__all__ = ["DataStorageReport", "initialize_data_storage"]
