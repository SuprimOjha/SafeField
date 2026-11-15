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

from app.cache.sqlite_cache import SQLiteCache
from app.config import Settings, get_settings
from app.ingest.raw import incoming_dir
from app.ingest.shared import prune_snapshots_older_than
from app.services.imerg.grid_cache import ImergGridCache

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
    redacted = message
    for secret in (
        settings.earthdata_token,
        settings.earthdata_username,
        settings.earthdata_password,
    ):
        if secret and len(secret) >= 3:
            redacted = redacted.replace(secret, "[redacted]")
    return redacted[:2000]


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
        section.api_cache_entries = SQLiteCache(settings.cache_db_path).prune_older_than_days(
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


def run_data_refresh(
    *,
    trigger: str = "scheduler",
    settings: Settings | None = None,
    days: int | None = None,
    imerg_retention_days: int | None = None,
    signal_retention_days: int | None = None,
    api_cache_retention_days: int | None = None,
    prune: bool = True,
    today_utc: date | None = None,
    fetch_fn: Callable[..., dict[str, Any]] | None = None,
    root: Path | None = None,
    imerg_raw_dir: Path | None = None,
) -> AutomationStatus:
    """Install the latest IMERG days, then prune data outside retention windows.

    Safe to call from the scheduler, a CLI, or a workflow. A concurrent run is
    skipped rather than duplicated. Nothing is downloaded when credentials are
    absent, and no secret is written to the status file.
    """
    settings = settings or get_settings()
    today = today_utc or datetime.now(timezone.utc).date()
    refresh_days = days or settings.imerg_refresh_days
    imerg_keep = imerg_retention_days or settings.imerg_retention_days
    signal_keep = signal_retention_days or settings.signal_retention_days
    api_keep = api_cache_retention_days or settings.api_cache_retention_days
    for label, value in (
        ("days", refresh_days),
        ("imerg_retention_days", imerg_keep),
        ("signal_retention_days", signal_keep),
        ("api_cache_retention_days", api_keep),
    ):
        if value < 1:
            raise ValueError(f"{label} must be at least 1")

    started_at = datetime.now(timezone.utc)
    windows = {
        "imerg_refresh_days": refresh_days,
        "imerg_retention_days": imerg_keep,
        "signal_retention_days": signal_keep,
        "api_cache_retention_days": api_keep,
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
        grid_cache = ImergGridCache(settings.cache_db_path)
        imerg_section = _run_imerg(settings, refresh_days, grid_cache, fetch_fn)
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
            message = (
                f"Refresh partially completed: {imerg_section.error or prune_section.error}"
            )
        else:
            message = (
                f"Refresh failed: {imerg_section.error or prune_section.error}"
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
            windows=windows,
        )
        write_automation_status(status, automation_status_path(settings))
        return status
    finally:
        lock.release()
