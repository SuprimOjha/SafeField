"""Automatic installation of the latest NASA IMERG days with retention pruning.

Design rules:
- New data is installed before anything old is deleted.
- Only data older than a configured window is removed.
- Missing Earthdata credentials are reported honestly; nothing is fabricated.
- Credentials, file paths and precise coordinates never appear in the
  automation status file.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.cache import create_cache, create_imerg_cache
from app.cache.sqlite_cache import SQLiteCache
from app.config import Settings, get_settings, redact_secrets
from app.ingest.products import PRODUCTS as PRODUCT_SPECS
from app.ingest.products import ProductResult, refresh_snapshots
from app.ingest.raw import RawSnapshotAdapter, incoming_dir
from app.ingest.shared import (
    latest_snapshot_date,
    prune_snapshots_older_than,
    update_source_status,
)
from app.services.imerg.grid_cache import ImergGridCache
from app.signals.snapshots import source_dir
from app.storage.sync import get_storage, prune_remote, sync_up

AUTOMATION_SCHEMA_VERSION = 1
SNAPSHOT_SOURCES = ("smap", "lst", "vegetation")
GRANULE_DATE = re.compile(r"\.(\d{8})-S\d{6}")

RefreshStatus = Literal[
    "ok",
    "partial",
    "error",
    "skipped_no_credentials",
    "skipped_already_running",
]


class RefreshSection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok", "up_to_date", "skipped_no_credentials", "error"]
    requested_days: int
    installed_dates: list[str] = Field(default_factory=list)
    skipped_dates: list[str] = Field(default_factory=list)
    granule_ids: list[str] = Field(default_factory=list)
    error: str | None = None


class PruneSection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok", "skipped", "error"] = "skipped"
    imerg_days: int = 0
    imerg_raw_files: int = 0
    api_cache_entries: int = 0
    signal_snapshots: int = 0
    incoming_files: int = 0
    cutoffs: dict[str, str] = Field(default_factory=dict)
    error: str | None = None


class SnapshotSection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok", "skipped", "skipped_no_credentials", "error"] = "skipped"
    installed_files: int = 0
    skipped_files: int = 0
    staged_files: int = 0
    installed: dict[str, int] = Field(default_factory=dict)
    sources: dict[str, str] = Field(default_factory=dict)
    error: str | None = None


class StorageSection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok", "skipped", "error"] = "skipped"
    uploaded_files: int = 0
    deleted_files: int = 0
    error: str | None = None


class AutomationStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = AUTOMATION_SCHEMA_VERSION
    trigger: str
    status: RefreshStatus
    message: str
    started_at: datetime
    finished_at: datetime | None = None
    duration_seconds: float | None = None
    imerg: RefreshSection
    prune: PruneSection
    snapshots: SnapshotSection = Field(default_factory=SnapshotSection)
    storage: StorageSection = Field(default_factory=StorageSection)
    windows: dict[str, int] = Field(default_factory=dict)


class RefreshLock:
    """Cross-process lock so the scheduler and CLI never refresh at the same time."""

    def __init__(self, path: Path, stale_after_seconds: float) -> None:
        self.path = path
        self.stale_after_seconds = stale_after_seconds

    def acquire(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        while True:
            try:
                descriptor = os.open(
                    self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY
                )
            except FileExistsError:
                try:
                    age = time.time() - self.path.stat().st_mtime
                except FileNotFoundError:
                    continue
                if age <= self.stale_after_seconds:
                    return False
                # A crashed process left the lock behind; remove it and retry once.
                try:
                    self.path.unlink()
                except FileNotFoundError:
                    pass
                continue
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                handle.write(f"{os.getpid()} {datetime.now(timezone.utc).isoformat()}\n")
            return True

    def release(self) -> None:
        self.path.unlink(missing_ok=True)


def automation_status_path(settings: Settings | None = None) -> Path:
    return Path((settings or get_settings()).automation_status_path)


def lock_path(settings: Settings | None = None) -> Path:
    status_path = automation_status_path(settings)
    return status_path.with_name(status_path.name + ".lock")


def write_automation_status(
    status: AutomationStatus, path: Path | None = None
) -> Path:
    """Write the automation status atomically so readers never see partial JSON."""
    target = path or automation_status_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(
        status.model_dump(mode="json"), indent=2, ensure_ascii=False, sort_keys=True
    )
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=target.parent,
        prefix=target.name + ".",
        suffix=".tmp",
        delete=False,
    ) as handle:
        handle.write(payload)
        handle.write("\n")
        temporary = Path(handle.name)
    try:
        os.replace(temporary, target)
    except OSError:
        temporary.unlink(missing_ok=True)
        raise
    return target


def read_automation_status(path: Path | None = None) -> dict[str, Any] | None:
    target = path or automation_status_path()
    if not target.exists():
        return None
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"automation status is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("automation status must contain a JSON object")
    return payload


def has_earthdata_credentials(settings: Settings) -> bool:
    return bool(
        (settings.earthdata_username and settings.earthdata_password)
        or settings.earthdata_token
    )


def _redact(message: str, settings: Settings) -> str:
    return redact_secrets(message, settings)[:2000]


def _prune_raw_granules(directory: Path, cutoff: date) -> int:
    """Delete downloaded granule files older than cutoff (date in name, else mtime)."""
    if not directory.exists():
        return 0
    removed = 0
    for path in directory.iterdir():
        if not path.is_file():
            continue
        match = GRANULE_DATE.search(path.name)
        if match:
            try:
                file_day = date(
                    int(match.group(1)[0:4]),
                    int(match.group(1)[4:6]),
                    int(match.group(1)[6:8]),
                )
            except ValueError:
                continue
        else:
            file_day = datetime.fromtimestamp(
                path.stat().st_mtime, tz=timezone.utc
            ).date()
        if file_day < cutoff:
            path.unlink()
            removed += 1
    return removed


def _prune_incoming_files(source: str, cutoff: date) -> int:
    directory = incoming_dir(source)
    if not directory.exists():
        return 0
    removed = 0
    for path in directory.glob("*.json"):
        try:
            day = date.fromisoformat(path.stem)
        except ValueError:
            continue
        if day < cutoff:
            path.unlink()
            removed += 1
    return removed


def _run_imerg(
    settings: Settings,
    days: int,
    grid_cache: ImergGridCache,
    fetch_fn: Callable[..., dict[str, Any]] | None,
) -> RefreshSection:
    if not has_earthdata_credentials(settings):
        return RefreshSection(
            status="skipped_no_credentials",
            requested_days=days,
            error=(
                "No Earthdata credentials are configured; no new satellite data "
                "was requested. Set EARTHDATA_USERNAME and EARTHDATA_PASSWORD in backend/.env."
            ),
        )
    try:
        if fetch_fn is not None:
            result = fetch_fn(days=days, cache=grid_cache)
        else:
            from app.services.imerg.fetch_daily import fetch_imerg

            result = fetch_imerg(days=days, cache=grid_cache)
    except Exception as exc:  # the report records the real failure
        return RefreshSection(
            status="error",
            requested_days=days,
            error=_redact(f"{type(exc).__name__}: {exc}", settings),
        )

    processed = result.get("processed") or []
    status = "ok" if processed else "up_to_date"
    return RefreshSection(
        status=status,
        requested_days=days,
        installed_dates=[str(item.get("date_utc")) for item in processed if item.get("date_utc")],
        skipped_dates=[str(item) for item in result.get("skipped_dates") or []],
        granule_ids=[str(item.get("granule_id")) for item in processed if item.get("granule_id")],
    )


def _run_prune(
    settings: Settings,
    today: date,
    *,
    imerg_retention_days: int,
    signal_retention_days: int,
    api_cache_retention_days: int,
    root: Path | None,
    grid_cache: ImergGridCache,
    imerg_raw_dir: Path | None,
) -> PruneSection:
    imerg_cutoff = today - timedelta(days=imerg_retention_days)
    signal_cutoff = today - timedelta(days=signal_retention_days)
    raw_dir = imerg_raw_dir or Path(__file__).resolve().parents[2] / "data" / "imerg" / "raw"
    section = PruneSection(
        status="ok",
        cutoffs={
            "imerg": imerg_cutoff.isoformat(),
            "signals": signal_cutoff.isoformat(),
            "api_cache": (
                datetime.now(timezone.utc) - timedelta(days=api_cache_retention_days)
            ).isoformat(timespec="seconds"),
        },
    )
    try:
        section.imerg_days = grid_cache.prune_older_than(imerg_cutoff)
        section.imerg_raw_files = _prune_raw_granules(raw_dir, imerg_cutoff)
        section.api_cache_entries = create_cache(settings).prune_older_than_days(
            api_cache_retention_days
        )
        for source in SNAPSHOT_SOURCES:
            section.signal_snapshots += len(
                prune_snapshots_older_than(source, signal_cutoff, root)
            )
            section.incoming_files += _prune_incoming_files(source, signal_cutoff)
    except Exception as exc:  # keep the install result even if a prune target fails
        section.status = "error"
        section.error = _redact(f"{type(exc).__name__}: {exc}", settings)
    return section


def _scrub_paths(message: str, settings: Settings, source: str, root: Path | None) -> str:
    for path in (incoming_dir(source), source_dir(source, root)):
        message = message.replace(str(path), source)
    return _redact(message, settings)


def _run_snapshot_ingest(settings: Settings, *, root: Path | None = None) -> SnapshotSection:
    """Install staged raw snapshots that the product readers have produced.

    Files in ``data/incoming/<source>`` come from ``app.ingest.products`` (or a
    manual verified drop); this step validates and installs them. Days that are
    already installed are skipped, so a corrected raw file still requires the
    explicit ``ingest --force`` path instead of silently rewriting history.
    """
    section = SnapshotSection()
    staged_files = 0
    errors: list[str] = []

    for source in SNAPSHOT_SOURCES:
        directory = incoming_dir(source)
        if not directory.exists():
            continue
        days: list[date] = []
        for path in sorted(directory.glob("*.json")):
            try:
                days.append(date.fromisoformat(path.stem))
            except ValueError:
                continue
        if not days:
            continue

        staged_files += len(days)
        adapter = RawSnapshotAdapter(source)
        installed_dir = source_dir(source, root)
        source_errors: list[str] = []
        for day in days:
            if (installed_dir / f"{day.isoformat()}.json").exists():
                section.skipped_files += 1
                continue
            try:
                _, granule_ids, coverage = adapter.ingest_day(day, root=root)
            except Exception as exc:  # keep other sources and days moving
                source_errors.append(
                    _scrub_paths(
                        f"{source} {day.isoformat()}: {type(exc).__name__}: {exc}",
                        settings,
                        source,
                        root,
                    )
                )
                continue
            update_source_status(
                source,
                state="ok",
                latest_data_date=latest_snapshot_date(source, root) or day,
                product=adapter.product,
                version=adapter.version,
                coverage=coverage,
                granule_ids=granule_ids,
                root=root,
            )
            section.installed_files += 1
            section.installed[source] = section.installed.get(source, 0) + 1

        if source_errors:
            errors.extend(source_errors)
            update_source_status(
                source,
                state="error",
                last_error="; ".join(source_errors)[:2000],
                root=root,
            )

    if staged_files == 0:
        section.status = "skipped"
    elif errors:
        section.status = "error"
        section.error = "; ".join(errors)[:500]
    else:
        section.status = "ok"
    return section


def _run_snapshot_download(
    settings: Settings,
    today: date,
    *,
    root: Path | None,
    fetch_fn: Callable[..., list[ProductResult]] | None,
) -> list[ProductResult] | None:
    """Download and stage the newest NASA day/composite for every snapshot source.

    Returns ``None`` when no download was attempted because Earthdata
    credentials are absent. Every failure is reported as a result, never as a
    fabricated file.
    """
    if fetch_fn is None and not has_earthdata_credentials(settings):
        return None
    try:
        if fetch_fn is not None:
            return list(fetch_fn(settings, today, root=root))
        return refresh_snapshots(settings, today, root=root)
    except Exception as exc:  # one crashing download must not stop IMERG
        message = _redact(f"{type(exc).__name__}: {exc}", settings)
        return [
            ProductResult(source=source, status="error", error=message)
            for source in SNAPSHOT_SOURCES
        ]


def _record_snapshot_results(
    results: list[ProductResult],
    *,
    root: Path | None,
) -> None:
    """Reflect download outcomes in status.json without inventing coverage.

    ``staged`` results are recorded by ``_run_snapshot_ingest`` after the file
    is validated and installed, so they are left alone here.
    """
    for result in results:
        if result.status == "staged":
            continue
        spec = PRODUCT_SPECS.get(result.source)
        if spec is None:
            continue
        installed = latest_snapshot_date(result.source, root)
        if result.status == "up_to_date":
            if installed is None:
                continue
            update_source_status(
                result.source,
                state="ok",
                latest_data_date=installed or result.day,
                product=spec.short_name,
                version=spec.version,
                granule_ids=result.granule_ids if result.day == installed else None,
                root=root,
            )
        elif result.status == "error":
            update_source_status(
                result.source,
                state="error",
                last_error=result.error,
                root=root,
            )
        elif result.status == "not_available" and installed is None:
            update_source_status(
                result.source,
                state="missing",
                last_error=result.error,
                root=root,
            )


def _merge_snapshot_section(
    section: SnapshotSection,
    results: list[ProductResult] | None,
) -> None:
    if results is None:
        if section.status == "error":
            section.error = (
                section.error
                or "No Earthdata credentials are configured; no snapshot download "
                "was requested."
            )
        elif section.installed_files:
            section.status = "ok"
        else:
            section.status = "skipped_no_credentials"
            section.error = (
                "No Earthdata credentials are configured; no snapshot download was "
                "requested. Set EARTHDATA_USERNAME and EARTHDATA_PASSWORD in backend/.env."
            )
        return
    section.sources = {result.source: result.status for result in results}
    section.staged_files = sum(1 for result in results if result.status == "staged")
    failures = [
        f"{result.source}: {result.error}"
        for result in results
        if result.status == "error" and result.error
    ]
    if section.status == "error" or failures:
        section.status = "error"
        issues = [section.error] if section.error else []
        issues.extend(failures)
        section.error = "; ".join(item for item in issues if item)[:500] or None
    else:
        section.status = "ok"


def _run_storage_sync(
    settings: Settings,
    *,
    root: Path | None,
    raw_dir: Path | None,
    signal_cutoff: date,
    imerg_cutoff: date,
    recent_cutoff: date,
    keep_snapshots: int,
    storage: Any | None = None,
) -> StorageSection:
    """Mirror the recent window to Supabase Storage and delete older objects.

    The remote cap is enforced on every refresh, even with ``--no-prune``,
    because it protects a free-tier bucket rather than local retention.
    """
    client = storage or get_storage(settings)
    section = StorageSection()
    if client is None:
        return section
    try:
        reports = [
            sync_up(
                settings,
                root=root,
                raw_dir=raw_dir,
                recent_cutoff=recent_cutoff,
                keep_snapshots=keep_snapshots,
                storage=client,
            ),
            prune_remote(
                settings,
                signal_cutoff=signal_cutoff,
                imerg_cutoff=imerg_cutoff,
                recent_cutoff=recent_cutoff,
                keep_snapshots=keep_snapshots,
                storage=client,
            ),
        ]
        section.uploaded_files = sum(report.uploaded_files for report in reports)
        section.deleted_files = sum(report.deleted_files for report in reports)
        errors = [report.error for report in reports if report.status == "error"]
        if errors:
            section.status = "error"
            section.error = _redact("; ".join(item for item in errors if item), settings)
        else:
            section.status = "ok"
    except Exception as exc:  # storage must never hide the install result
        section.status = "error"
        section.error = _redact(f"{type(exc).__name__}: {exc}", settings)
    finally:
        if storage is None:
            client.close()
    return section


def run_data_refresh(
    *,
    trigger: str = "scheduler",
    settings: Settings | None = None,
    days: int | None = None,
    imerg_retention_days: int | None = None,
    signal_retention_days: int | None = None,
    api_cache_retention_days: int | None = None,
    prune: bool = True,
    download_snapshots: bool | None = None,
    today_utc: date | None = None,
    fetch_fn: Callable[..., dict[str, Any]] | None = None,
    snapshot_fetch_fn: Callable[..., list[ProductResult]] | None = None,
    root: Path | None = None,
    imerg_raw_dir: Path | None = None,
    storage: Any | None = None,
) -> AutomationStatus:
    """Install the latest IMERG days and NASA snapshots, then prune old data.

    Safe to call from the scheduler, a CLI, or a workflow. A concurrent run is
    skipped rather than duplicated. Nothing is downloaded when credentials are
    absent, and no secret is written to the status file.
    """
    settings = settings or get_settings()
    if download_snapshots is None:
        download_snapshots = settings.snapshot_download_enabled
    today = today_utc or datetime.now(timezone.utc).date()
    refresh_days = days or settings.imerg_refresh_days
    imerg_keep = imerg_retention_days or settings.imerg_retention_days
    signal_keep = signal_retention_days or settings.signal_retention_days
    api_keep = api_cache_retention_days or settings.api_cache_retention_days
    recent_days = settings.supabase_recent_days
    for label, value in (
        ("days", refresh_days),
        ("imerg_retention_days", imerg_keep),
        ("signal_retention_days", signal_keep),
        ("api_cache_retention_days", api_keep),
        ("supabase_recent_days", recent_days),
    ):
        if value < 1:
            raise ValueError(f"{label} must be at least 1")

    started_at = datetime.now(timezone.utc)
    windows = {
        "imerg_refresh_days": refresh_days,
        "imerg_retention_days": imerg_keep,
        "signal_retention_days": signal_keep,
        "api_cache_retention_days": api_keep,
        "supabase_recent_days": recent_days,
    }
    lock = RefreshLock(
        lock_path(settings),
        stale_after_seconds=max(settings.data_refresh_interval_hours * 3600 * 2, 3600),
    )
    if not lock.acquire():
        return AutomationStatus(
            trigger=trigger,
            status="skipped_already_running",
            message="Another data refresh is already running; this run was skipped.",
            started_at=started_at,
            imerg=RefreshSection(status="error", requested_days=refresh_days),
            prune=PruneSection(status="skipped"),
            windows=windows,
        )

    try:
        grid_cache = create_imerg_cache(settings)
        imerg_section = _run_imerg(settings, refresh_days, grid_cache, fetch_fn)
        snapshot_results = (
            _run_snapshot_download(
                settings,
                today,
                root=root,
                fetch_fn=snapshot_fetch_fn,
            )
            if download_snapshots
            else []
        )
        snapshot_section = _run_snapshot_ingest(settings, root=root)
        _merge_snapshot_section(snapshot_section, snapshot_results)
        if snapshot_results:
            _record_snapshot_results(snapshot_results, root=root)
        prune_section = (
            _run_prune(
                settings,
                today,
                imerg_retention_days=imerg_keep,
                signal_retention_days=signal_keep,
                api_cache_retention_days=api_keep,
                root=root,
                grid_cache=grid_cache,
                imerg_raw_dir=imerg_raw_dir,
            )
            if prune
            else PruneSection(status="skipped")
        )

        storage_section = _run_storage_sync(
            settings,
            root=root,
            raw_dir=imerg_raw_dir,
            signal_cutoff=today - timedelta(days=signal_keep),
            imerg_cutoff=today - timedelta(days=imerg_keep),
            recent_cutoff=today - timedelta(days=max(recent_days - 1, 0)),
            keep_snapshots=recent_days,
            storage=storage,
        )

        if imerg_section.status == "error":
            overall: RefreshStatus = (
                "partial" if prune_section.status != "error" else "error"
            )
        elif imerg_section.status == "skipped_no_credentials":
            overall = "skipped_no_credentials"
        elif prune_section.status == "error":
            overall = "partial"
        else:
            overall = "ok"

        if storage_section.status == "error" and overall == "ok":
            overall = "partial"
        if snapshot_section.status == "error" and overall == "ok":
            overall = "partial"

        installed = len(imerg_section.installed_dates)
        pruned_total = (
            prune_section.imerg_days
            + prune_section.imerg_raw_files
            + prune_section.api_cache_entries
            + prune_section.signal_snapshots
            + prune_section.incoming_files
        )
        if overall == "ok":
            message = (
                f"Installed {installed} new IMERG day(s); "
                f"removed {pruned_total} item(s) outside retention windows."
                if installed
                else "IMERG cache already covers the latest requested days; "
                f"removed {pruned_total} item(s) outside retention windows."
            )
        elif overall == "skipped_no_credentials":
            message = str(imerg_section.error)
        elif overall == "partial":
            issues = [
                f"IMERG: {imerg_section.error}" if imerg_section.error else "",
                f"prune: {prune_section.error}" if prune_section.error else "",
                f"snapshots: {snapshot_section.error}" if snapshot_section.error else "",
            ]
            message = "Refresh partially completed: " + (
                "; ".join(item for item in issues if item) or "see section statuses."
            )
        else:
            issues = [
                f"IMERG: {imerg_section.error}" if imerg_section.error else "",
                f"prune: {prune_section.error}" if prune_section.error else "",
                f"snapshots: {snapshot_section.error}" if snapshot_section.error else "",
            ]
            message = "Refresh failed: " + (
                "; ".join(item for item in issues if item) or "see section statuses."
            )

        if snapshot_section.installed_files:
            message += f" Installed {snapshot_section.installed_files} snapshot day(s) from staged files."
        if snapshot_section.sources:
            message += " Snapshot checks: " + ", ".join(
                f"{source}={status}"
                for source, status in sorted(snapshot_section.sources.items())
            ) + "."
        elif snapshot_section.status == "skipped_no_credentials":
            message += " Snapshot download skipped: no Earthdata credentials."

        if storage_section.status == "error":
            message += f" Supabase Storage sync failed: {storage_section.error}"
        elif storage_section.status == "ok" and (
            storage_section.uploaded_files or storage_section.deleted_files
        ):
            message += (
                f" Supabase Storage (last {recent_days} day(s)): uploaded "
                f"{storage_section.uploaded_files} file(s), removed "
                f"{storage_section.deleted_files}."
            )

        finished_at = datetime.now(timezone.utc)
        status = AutomationStatus(
            trigger=trigger,
            status=overall,
            message=message,
            started_at=started_at,
            finished_at=finished_at,
            duration_seconds=round((finished_at - started_at).total_seconds(), 3),
            imerg=imerg_section,
            prune=prune_section,
            snapshots=snapshot_section,
            storage=storage_section,
            windows=windows,
        )
        write_automation_status(status, automation_status_path(settings))
        return status
    finally:
        lock.release()
