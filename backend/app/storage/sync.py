"""Mirror recent data files to Supabase Storage and restore them on startup.

The backend keeps writing to the local data directories. Supabase Storage is a
live cache for the most recent days only: snapshots, staged raw JSON, downloaded
IMERG granules and ``status.json`` are uploaded after a refresh, and everything
older than ``supabase_recent_days`` is deleted remotely. That keeps a free-tier
bucket from filling up. The long timeline is published to the git ``data``
branch by the data-publish workflow instead, and local disk keeps the longer
retention windows.

No field geometry is mirrored; these directories contain satellite and
provider data only.
"""

from __future__ import annotations

import os
import re
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Literal

import httpx

from app.config import Settings, get_settings
from app.ingest.raw import incoming_dir
from app.signals.snapshots import source_dir
from app.signals.status import status_path
from app.storage.supabase_storage import (
    SupabaseStorage,
    SupabaseStorageError,
    content_type_for,
)

SNAPSHOT_SOURCES = ("smap", "lst", "vegetation")
STATUS_OBJECT = "status.json"
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
        resolved.supabase_storage_key,
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


def recent_window_start(settings: Settings, today: date | None = None) -> date:
    """First day of the live window that Supabase Storage keeps."""
    day = today or datetime.now(timezone.utc).date()
    return day - timedelta(days=max(settings.supabase_recent_days - 1, 0))


def upload_directory(
    storage: SupabaseStorage,
    local_dir: Path,
    prefix: str,
    report: StorageSyncReport,
    *,
    force: bool = False,
    keep_after: date | None = None,
    parse_date: Callable[[str], date | None] | None = None,
) -> None:
    files = _iter_files(local_dir)
    if not files:
        return
    remote = storage.list_names(prefix)
    for path in files:
        key = f"{prefix}/{path.relative_to(local_dir).as_posix()}"
        if keep_after is not None:
            day = parse_date(key) if parse_date else None
            if day is None or day < keep_after:
                continue
        size = path.stat().st_size
        if not force and remote.get(key) == size:
            continue
        storage.upload_bytes(key, path.read_bytes(), content_type_for(key))
        report.uploaded_files += 1


def upload_file(
    storage: SupabaseStorage,
    local_path: Path,
    key: str,
    report: StorageSyncReport,
    *,
    force: bool = False,
) -> None:
    if not local_path.exists():
        return
    remote = storage.list_names("")
    size = local_path.stat().st_size
    if not force and remote.get(key) == size:
        return
    storage.upload_bytes(key, local_path.read_bytes(), content_type_for(key))
    report.uploaded_files += 1


def restore_file(
    storage: SupabaseStorage,
    local_path: Path,
    key: str,
    report: StorageSyncReport,
) -> None:
    if local_path.exists():
        return
    if key not in storage.list_names(""):
        return
    local_path.parent.mkdir(parents=True, exist_ok=True)
    data = storage.download_bytes(key)
    with tempfile.NamedTemporaryFile(
        "wb", dir=local_path.parent, prefix=local_path.name + ".", suffix=".tmp", delete=False
    ) as handle:
        handle.write(data)
        temporary = Path(handle.name)
    try:
        os.replace(temporary, local_path)
    except OSError:
        temporary.unlink(missing_ok=True)
        raise
    report.downloaded_files += 1


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
    today: date | None = None,
    recent_cutoff: date | None = None,
) -> StorageSyncReport:
    resolved = settings or get_settings()
    cutoff = recent_cutoff or recent_window_start(resolved, today)

    def action(client: SupabaseStorage, report: StorageSyncReport) -> None:
        for source in SNAPSHOT_SOURCES:
            upload_directory(
                client,
                source_dir(source, root),
                f"signals/{source}",
                report,
                force=force,
                keep_after=cutoff,
                parse_date=_date_from_json_key,
            )
            upload_directory(
                client,
                incoming_dir(source),
                f"incoming/{source}",
                report,
                force=force,
                keep_after=cutoff,
                parse_date=_date_from_json_key,
            )
        upload_directory(
            client,
            raw_dir or default_raw_dir(),
            "imerg/raw",
            report,
            force=force,
            keep_after=cutoff,
            parse_date=_date_from_granule_key,
        )
        upload_file(client, status_path(), STATUS_OBJECT, report, force=force)

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
        restore_file(client, status_path(), STATUS_OBJECT, report)

    return _run(action, settings or get_settings(), storage)


def prune_remote(
    settings: Settings | None = None,
    *,
    signal_cutoff: date,
    imerg_cutoff: date,
    recent_cutoff: date | None = None,
    storage: SupabaseStorage | None = None,
) -> StorageSyncReport:
    """Delete remote objects outside the live window.

    ``recent_cutoff`` caps the bucket to the Supabase live window; local
    retention windows are longer because the git ``data`` branch archives them.
    """

    def action(client: SupabaseStorage, report: StorageSyncReport) -> None:
        signal_day = recent_cutoff or signal_cutoff
        imerg_day = recent_cutoff or imerg_cutoff
        for source in SNAPSHOT_SOURCES:
            delete_remote_before(
                client, f"signals/{source}", signal_day, report, parse_date=_date_from_json_key
            )
            delete_remote_before(
                client, f"incoming/{source}", signal_day, report, parse_date=_date_from_json_key
            )
        delete_remote_before(
            client, "imerg/raw", imerg_day, report, parse_date=_date_from_granule_key
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
    "STATUS_OBJECT",
    "StorageSyncReport",
    "delete_remote_before",
    "default_raw_dir",
    "get_storage",
    "prune_remote",
    "recent_window_start",
    "restore_directory",
    "restore_down",
    "restore_file",
    "restore_from_storage",
    "sync_up",
    "upload_directory",
    "upload_file",
]
