"""Mirror local data files to Supabase Storage and restore them on startup.

The backend keeps writing to the local data directories. Supabase Storage is a
durable copy: snapshots, staged raw JSON and downloaded IMERG granules are
uploaded after a refresh, removed remotely when their retention window ends,
and restored into an empty working directory on startup. Local disk therefore
stays a cache rather than the only copy.

No field geometry is mirrored; these directories contain satellite and
provider data only.
"""

from __future__ import annotations

import os
import re
import tempfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Callable, Literal

import httpx

from app.config import Settings, get_settings
from app.ingest.raw import incoming_dir
from app.signals.snapshots import source_dir
from app.storage.supabase_storage import (
    SupabaseStorage,
    SupabaseStorageError,
    content_type_for,
)

SNAPSHOT_SOURCES = ("smap", "lst", "vegetation")
GRANULE_DATE = re.compile(r"\.(\d{8})-S\d{6}")
JSON_DAY = re.compile(r"^(\d{4}-\d{2}-\d{2})\.json$")

SyncStatus = Literal["ok", "skipped", "error"]


@dataclass
class StorageSyncReport:
    status: SyncStatus = "skipped"
    uploaded_files: int = 0
    downloaded_files: int = 0
    deleted_files: int = 0
    error: str | None = None


def default_raw_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "data" / "imerg" / "raw"


def get_storage(settings: Settings | None = None) -> SupabaseStorage | None:
    resolved = settings or get_settings()
    if not resolved.supabase_storage_enabled:
        return None
    return SupabaseStorage(
        resolved.supabase_url,
        resolved.supabase_service_role_key,
        resolved.supabase_storage_bucket,
    )


def _iter_files(directory: Path) -> list[Path]:
    if not directory.exists():
        return []
    return sorted(
        path
        for path in directory.rglob("*")
        if path.is_file() and not path.name.endswith(".tmp")
    )


def upload_directory(
    storage: SupabaseStorage,
    local_dir: Path,
    prefix: str,
    report: StorageSyncReport,
    *,
    force: bool = False,
) -> None:
    files = _iter_files(local_dir)
    if not files:
        return
    remote = storage.list_names(prefix)
    for path in files:
        key = f"{prefix}/{path.relative_to(local_dir).as_posix()}"
        size = path.stat().st_size
        if not force and remote.get(key) == size:
            continue
        storage.upload_bytes(key, path.read_bytes(), content_type_for(key))
        report.uploaded_files += 1


def restore_directory(
    storage: SupabaseStorage,
    local_dir: Path,
    prefix: str,
    report: StorageSyncReport,
) -> None:
    remote = storage.list_names(prefix)
    for key in remote:
        relative = key[len(prefix) + 1 :] if key.startswith(prefix + "/") else key
        if not relative or relative.endswith("/"):
            continue
        target = local_dir / relative
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        data = storage.download_bytes(key)
        with tempfile.NamedTemporaryFile(
            "wb", dir=target.parent, prefix=target.name + ".", suffix=".tmp", delete=False
        ) as handle:
            handle.write(data)
            temporary = Path(handle.name)
        try:
            os.replace(temporary, target)
        except OSError:
            temporary.unlink(missing_ok=True)
            raise
        report.downloaded_files += 1


def _date_from_json_key(key: str) -> date | None:
    match = JSON_DAY.match(key.rsplit("/", 1)[-1])
    if not match:
        return None
    try:
        return date.fromisoformat(match.group(1))
    except ValueError:
        return None


def _date_from_granule_key(key: str) -> date | None:
    match = GRANULE_DATE.search(key.rsplit("/", 1)[-1])
    if not match:
        return None
    raw = match.group(1)
    try:
        return date(int(raw[0:4]), int(raw[4:6]), int(raw[6:8]))
    except ValueError:
        return None


def delete_remote_before(
    storage: SupabaseStorage,
    prefix: str,
    cutoff: date,
    report: StorageSyncReport,
    *,
    parse_date: Callable[[str], date | None],
) -> None:
    victims = [
        key
        for key in storage.list_names(prefix)
        if (day := parse_date(key)) is not None and day < cutoff
    ]
    if victims:
        report.deleted_files += storage.delete_objects(victims)


def _run(
    action: Callable[[SupabaseStorage, StorageSyncReport], None],
    settings: Settings,
    storage: SupabaseStorage | None,
) -> StorageSyncReport:
    report = StorageSyncReport()
    client = storage or get_storage(settings)
    if client is None:
        return report
    try:
        client.ensure_bucket()
        action(client, report)
        report.status = "ok"
    except (SupabaseStorageError, httpx.HTTPError, OSError, ValueError) as exc:
        report.status = "error"
        report.error = f"{type(exc).__name__}: {exc}"[:500]
    finally:
        if storage is None:
            client.close()
    return report


def sync_up(
    settings: Settings | None = None,
    *,
    root: Path | None = None,
    raw_dir: Path | None = None,
    force: bool = False,
    storage: SupabaseStorage | None = None,
) -> StorageSyncReport:
    resolved = settings or get_settings()

    def action(client: SupabaseStorage, report: StorageSyncReport) -> None:
        for source in SNAPSHOT_SOURCES:
            upload_directory(client, source_dir(source, root), f"signals/{source}", report, force=force)
            upload_directory(client, incoming_dir(source), f"incoming/{source}", report, force=force)
        upload_directory(client, raw_dir or default_raw_dir(), "imerg/raw", report, force=force)

    return _run(action, resolved, storage)


def restore_down(
    settings: Settings | None = None,
    *,
    root: Path | None = None,
    storage: SupabaseStorage | None = None,
) -> StorageSyncReport:
    """Restore snapshot and staged JSON files that are missing locally."""

    def action(client: SupabaseStorage, report: StorageSyncReport) -> None:
        for source in SNAPSHOT_SOURCES:
            restore_directory(client, source_dir(source, root), f"signals/{source}", report)
            restore_directory(client, incoming_dir(source), f"incoming/{source}", report)

    return _run(action, settings or get_settings(), storage)


def prune_remote(
    settings: Settings | None = None,
    *,
    signal_cutoff: date,
    imerg_cutoff: date,
    storage: SupabaseStorage | None = None,
) -> StorageSyncReport:
    def action(client: SupabaseStorage, report: StorageSyncReport) -> None:
        for source in SNAPSHOT_SOURCES:
            delete_remote_before(
                client, f"signals/{source}", signal_cutoff, report, parse_date=_date_from_json_key
            )
            delete_remote_before(
                client, f"incoming/{source}", signal_cutoff, report, parse_date=_date_from_json_key
            )
        delete_remote_before(
            client, "imerg/raw", imerg_cutoff, report, parse_date=_date_from_granule_key
        )

    return _run(action, settings or get_settings(), storage)


def restore_from_storage(settings: Settings | None = None) -> StorageSyncReport:
    """Restore snapshots and staged JSON on startup; raw granules stay remote."""
    resolved = settings or get_settings()
    if not resolved.supabase_restore_on_startup:
        return StorageSyncReport(status="skipped")
    return restore_down(resolved)


__all__ = [
    "SNAPSHOT_SOURCES",
    "StorageSyncReport",
    "delete_remote_before",
    "default_raw_dir",
    "get_storage",
    "prune_remote",
    "restore_directory",
    "restore_down",
    "restore_from_storage",
    "sync_up",
    "upload_directory",
]
