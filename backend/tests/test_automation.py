import asyncio
import json
import sqlite3
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.cache.sqlite_cache import SQLiteCache
from app.config import Settings
from app.ingest.automation import (
    lock_path,
    read_automation_status,
    run_data_refresh,
)
from app.ingest.products import ProductResult
from app.ingest.scheduler import DataRefreshScheduler
from app.ingest.shared import write_snapshot
from app.services.imerg.fetch_daily import fetch_imerg
from app.services.imerg.grid_cache import ImergGridCache
from app.signals.status import read_status


TODAY = date(2026, 11, 15)


@pytest.fixture(autouse=True)
def isolated_data_paths(tmp_path, monkeypatch):
    monkeypatch.setenv("SAFEFIELD_STATUS_PATH", str(tmp_path / "status.json"))
    monkeypatch.setenv("SAFEFIELD_INCOMING_DIR", str(tmp_path / "incoming"))


def no_snapshot_download(settings, today, *, root=None):
    """Test double: never contact Earthdata from the automation tests."""
    return []


def make_settings(tmp_path: Path, **overrides) -> Settings:
    values = {
        "cache_db_path": str(tmp_path / "cache.db"),
        "automation_status_path": str(tmp_path / "automation-status.json"),
        "earthdata_username": "pilot@example.test",
        "earthdata_password": "correct-horse-battery",
        "earthdata_token": "",
        "imerg_refresh_days": 3,
        "imerg_retention_days": 30,
        "api_cache_retention_days": 30,
        "signal_retention_days": 120,
        "data_refresh_interval_hours": 6.0,
        "snapshot_download_enabled": True,
    }
    values.update(overrides)
    return Settings(**values)


def store_day(cache: ImergGridCache, day: date, value: float = 1.0) -> None:
    cache.store_daily_grid(
        day,
        [27.0],
        [85.0],
        [[value]],
        [[48]],
        f"3B-DAY-L.MS.MRG.3IMERG.{day:%Y%m%d}-S000000-E235959.V07C",
        datetime.now(timezone.utc),
    )


def staged_smap_payload(day: date) -> dict:
    return {
        "product": "SPL4SMGP",
        "version": "008",
        "data_date": day.isoformat(),
        "fetched_at": f"{TODAY.isoformat()}T00:00:00+00:00",
        "resolution_km": 9.0,
        "grid_spacing_km": 9.0,
        "coverage_fraction": 1.0,
        "granule_ids": [f"SPL4SMGP.008.{day:%Y%m%d}00"],
        "cells": [
            {
                "latitude": 27.7,
                "longitude": 85.3,
                "surface_sm": 0.22,
                "root_sm": 0.2,
                "quality": "good",
            }
        ],
    }


def installed_lst_payload(day: date) -> dict:
    return {
        "product": "VNP21A1D",
        "version": "002",
        "data_date": day.isoformat(),
        "fetched_at": f"{TODAY.isoformat()}T00:00:00+00:00",
        "resolution_km": 11.1,
        "grid_spacing_km": 11.1,
        "granule_ids": [f"VNP21A1D.A2026{day.timetuple().tm_yday:03d}.h25v06.002.h5"],
        "cells": [
            {
                "latitude": 27.7,
                "longitude": 85.3,
                "lst_day_c": 24.5,
                "lst_night_c": None,
                "qc_good": True,
                "clear_sky": True,
            }
        ],
    }


def must_not_fetch(**kwargs):
    raise AssertionError("fetch must not be called")


def test_grid_cache_lists_and_prunes_installed_days(tmp_path):
    cache = ImergGridCache(str(tmp_path / "cache.db"))
    store_day(cache, TODAY - timedelta(days=3))
    store_day(cache, TODAY - timedelta(days=2))
    store_day(cache, TODAY - timedelta(days=1))

    assert cache.installed_dates() == [
        TODAY - timedelta(days=1),
        TODAY - timedelta(days=2),
        TODAY - timedelta(days=3),
    ]
    assert cache.installed_dates(limit=2) == [
        TODAY - timedelta(days=1),
        TODAY - timedelta(days=2),
    ]
    assert cache.has_day(TODAY - timedelta(days=2)) is True
    assert cache.has_day(TODAY) is False
    assert cache.latest_installed_date() == TODAY - timedelta(days=1)

    removed = cache.prune_older_than(TODAY - timedelta(days=2))
    assert removed == 1
    assert cache.has_day(TODAY - timedelta(days=3)) is False
    assert cache.has_day(TODAY - timedelta(days=2)) is True


def test_fetch_imerg_skips_download_when_latest_days_are_installed(tmp_path):
    cache = ImergGridCache(str(tmp_path / "cache.db"))
    for offset in (1, 2, 3):
        store_day(cache, TODAY - timedelta(days=offset))

    result = fetch_imerg(days=3, cache=cache, today_utc=TODAY)

    assert result["status"] == "up_to_date"
    assert result["processed"] == []
    assert sorted(result["skipped_dates"]) == sorted(
        (TODAY - timedelta(days=offset)).isoformat() for offset in (1, 2, 3)
    )


def test_sqlite_cache_never_returns_entries_past_retention(tmp_path):
    cache = SQLiteCache(str(tmp_path / "api.db"))
    cache.set("power:test", {"value": 1}, "2026-01-01T00:00:00Z", ttl_seconds=60)
    old_epoch = time.time() - 40 * 86400
    with sqlite3.connect(str(tmp_path / "api.db")) as conn:
        conn.execute("UPDATE api_cache SET created_epoch = ? WHERE cache_key = ?", (old_epoch, "power:test"))
        conn.commit()

    assert cache.get("power:test", allow_stale=True, max_stale_seconds=30 * 86400) is None
    assert cache.get("power:test", allow_stale=True, max_stale_seconds=60 * 86400) is not None
    assert cache.prune_older_than(time.time() - 30 * 86400) == 1
    assert cache.count() == 0


def test_refresh_without_credentials_reports_honestly_and_fetches_nothing(tmp_path):
    settings = make_settings(tmp_path, earthdata_username="", earthdata_password="", earthdata_token="")

    report = run_data_refresh(
        settings=settings,
        fetch_fn=must_not_fetch,
        today_utc=TODAY,
        root=tmp_path / "signals",
        imerg_raw_dir=tmp_path / "raw",
    )

    assert report.status == "skipped_no_credentials"
    assert "backend/.env" in report.message
    assert report.snapshots.status == "skipped_no_credentials"
    payload = read_automation_status(Path(settings.automation_status_path))
    assert payload["status"] == "skipped_no_credentials"
    assert payload["imerg"]["installed_dates"] == []
    assert payload["snapshots"]["status"] == "skipped_no_credentials"
    assert "correct-horse-battery" not in json.dumps(payload)


def test_snapshot_download_results_are_recorded_honestly(tmp_path):
    settings = make_settings(tmp_path)
    signals_root = tmp_path / "signals"
    installed_day = TODAY - timedelta(days=1)
    write_snapshot("lst", installed_day, installed_lst_payload(installed_day), root=signals_root)

    def snapshot_fetch(settings, today, *, root=None):
        return [
            ProductResult(
                source="smap",
                status="not_available",
                error="No completed SPL4SMGP day with all eight granules.",
            ),
            ProductResult(
                source="lst",
                status="up_to_date",
                day=installed_day,
                granule_ids=["VNP21A1D.A2026318.h25v06.002.h5"],
            ),
            ProductResult(source="vegetation", status="error", error="RuntimeError: boom"),
        ]

    report = run_data_refresh(
        settings=settings,
        fetch_fn=lambda days, cache: {"processed": [], "skipped_dates": []},
        snapshot_fetch_fn=snapshot_fetch,
        today_utc=TODAY,
        root=signals_root,
        imerg_raw_dir=tmp_path / "raw",
    )

    assert report.snapshots.status == "error"
    assert report.snapshots.sources == {
        "smap": "not_available",
        "lst": "up_to_date",
        "vegetation": "error",
    }
    assert report.status == "partial"
    status = read_status()
    assert status is not None
    assert status.sources["smap"].status == "missing"
    assert "SPL4SMGP" in (status.sources["smap"].last_error or "")
    assert status.sources["lst"].status == "ok"
    assert status.sources["lst"].latest_data_date == installed_day
    assert status.sources["lst"].product == "VNP21A1D"
    assert status.sources["lst"].granule_ids == ["VNP21A1D.A2026318.h25v06.002.h5"]
    assert status.sources["vegetation"].status == "error"


def test_refresh_installs_new_day_then_prunes_only_old_data(tmp_path, monkeypatch):
    settings = make_settings(tmp_path)
    cache = ImergGridCache(settings.cache_db_path)
    old_day = TODAY - timedelta(days=40)
    recent_day = TODAY - timedelta(days=2)
    store_day(cache, old_day)
    store_day(cache, recent_day)

    signals_root = tmp_path / "signals"
    for day in (old_day, recent_day):
        directory = signals_root / "smap"
        directory.mkdir(parents=True, exist_ok=True)
        (directory / f"{day.isoformat()}.json").write_text("{}", encoding="utf-8")

    incoming_root = tmp_path / "incoming"
    monkeypatch.setenv("SAFEFIELD_INCOMING_DIR", str(incoming_root))
    for day in (old_day, recent_day):
        directory = incoming_root / "smap"
        directory.mkdir(parents=True, exist_ok=True)
        (directory / f"{day.isoformat()}.json").write_text(
            json.dumps(staged_smap_payload(day)), encoding="utf-8"
        )

    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    (raw_dir / "3B-DAY-L.MS.MRG.3IMERG.20261001-S000000-E235959.V07C.nc4").write_bytes(b"old")
    (raw_dir / "3B-DAY-L.MS.MRG.3IMERG.20261113-S000000-E235959.V07C.nc4").write_bytes(b"new")

    api_cache = SQLiteCache(settings.cache_db_path)
    api_cache.set("power:old", {"value": 1}, "2026-09-01T00:00:00Z", ttl_seconds=60)
    with sqlite3.connect(settings.cache_db_path) as conn:
        conn.execute(
            "UPDATE api_cache SET created_epoch = ? WHERE cache_key = ?",
            (time.time() - 40 * 86400, "power:old"),
        )
        conn.commit()

    calls = []

    def fake_fetch(days, cache):
        calls.append(days)
        assert cache.has_day(recent_day)
        return {
            "status": "ok",
            "processed": [
                {
                    "date_utc": (TODAY - timedelta(days=1)).isoformat(),
                    "granule_id": "3B-DAY-L.MS.MRG.3IMERG.20261114-S000000-E235959.V07C",
                    "valid_cells": 1,
                }
            ],
            "skipped_dates": [],
        }

    report = run_data_refresh(
        settings=settings,
        fetch_fn=fake_fetch,
        snapshot_fetch_fn=no_snapshot_download,
        today_utc=TODAY,
        root=signals_root,
        imerg_raw_dir=raw_dir,
        imerg_retention_days=10,
        signal_retention_days=10,
        api_cache_retention_days=10,
    )

    assert calls == [3]
    assert report.status == "ok"
    assert report.imerg.installed_dates == ["2026-11-14"]
    assert report.prune.imerg_days == 1
    assert report.prune.imerg_raw_files == 1
    assert report.prune.api_cache_entries == 1
    assert report.prune.signal_snapshots == 1
    assert report.prune.incoming_files == 1
    assert cache.has_day(old_day) is False
    assert cache.has_day(recent_day) is True
    assert not (signals_root / "smap" / f"{old_day.isoformat()}.json").exists()
    assert (signals_root / "smap" / f"{recent_day.isoformat()}.json").exists()
    assert not (incoming_root / "smap" / f"{old_day.isoformat()}.json").exists()
    assert (incoming_root / "smap" / f"{recent_day.isoformat()}.json").exists()
    assert not (raw_dir / "3B-DAY-L.MS.MRG.3IMERG.20261001-S000000-E235959.V07C.nc4").exists()
    assert (raw_dir / "3B-DAY-L.MS.MRG.3IMERG.20261113-S000000-E235959.V07C.nc4").exists()
    assert api_cache.count() == 0


def test_refresh_skips_when_another_run_holds_the_lock(tmp_path):
    settings = make_settings(tmp_path)
    lock = lock_path(settings)
    lock.parent.mkdir(parents=True, exist_ok=True)
    lock.write_text("other-process", encoding="utf-8")

    report = run_data_refresh(
        settings=settings,
        fetch_fn=must_not_fetch,
        today_utc=TODAY,
        root=tmp_path / "signals",
        imerg_raw_dir=tmp_path / "raw",
    )

    assert report.status == "skipped_already_running"
    assert lock.exists()


def test_stale_lock_is_recovered(tmp_path):
    settings = make_settings(tmp_path)
    lock = lock_path(settings)
    lock.parent.mkdir(parents=True, exist_ok=True)
    lock.write_text("crashed-process", encoding="utf-8")
    stale = time.time() - 3 * 24 * 3600
    import os

    os.utime(lock, (stale, stale))

    report = run_data_refresh(
        settings=settings,
        fetch_fn=lambda days, cache: {"processed": [], "skipped_dates": []},
        snapshot_fetch_fn=no_snapshot_download,
        today_utc=TODAY,
        root=tmp_path / "signals",
        imerg_raw_dir=tmp_path / "raw",
    )

    assert report.status == "ok"
    assert not lock.exists()


def test_refresh_redacts_credentials_from_errors(tmp_path):
    settings = make_settings(tmp_path)

    def failing_fetch(days, cache):
        raise RuntimeError(
            f"login failed for {settings.earthdata_username} using {settings.earthdata_password}"
        )

    report = run_data_refresh(
        settings=settings,
        fetch_fn=failing_fetch,
        snapshot_fetch_fn=no_snapshot_download,
        today_utc=TODAY,
        root=tmp_path / "signals",
        imerg_raw_dir=tmp_path / "raw",
    )

    assert report.status == "partial"
    raw_status = Path(settings.automation_status_path).read_text(encoding="utf-8")
    assert settings.earthdata_username not in raw_status
    assert settings.earthdata_password not in raw_status
    assert "[redacted]" in raw_status


@pytest.mark.asyncio
async def test_scheduler_stops_without_running_when_delay_is_pending(tmp_path):
    settings = make_settings(
        tmp_path,
        data_refresh_startup_delay_seconds=3600,
        earthdata_username="",
        earthdata_password="",
    )
    scheduler = DataRefreshScheduler(settings)
    stop = asyncio.Event()
    task = asyncio.create_task(scheduler.run(stop))
    await asyncio.sleep(0)

    await scheduler.stop(task, stop)

    assert task.done()
    assert not lock_path(settings).exists()
