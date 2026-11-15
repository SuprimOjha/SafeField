import json
from datetime import date
from pathlib import Path

from app.config import Settings
from app.ingest.automation import read_automation_status, run_data_refresh
from app.signals.status import read_status

TODAY = date(2026, 11, 15)


def make_settings(tmp_path: Path, **overrides) -> Settings:
    values = {
        "cache_db_path": str(tmp_path / "cache.db"),
        "automation_status_path": str(tmp_path / "automation-status.json"),
        "earthdata_username": "pilot@example.test",
        "earthdata_password": "correct-horse-battery",
        "earthdata_token": "",
        "imerg_refresh_days": 1,
        "imerg_retention_days": 30,
        "api_cache_retention_days": 30,
        "signal_retention_days": 120,
        "supabase_db_url": "",
        "supabase_url": "",
        "supabase_service_role_key": "",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def smap_payload(day: date) -> dict:
    return {
        "product": "SPL4SMGP",
        "version": "008",
        "data_date": day.isoformat(),
        "fetched_at": f"{TODAY.isoformat()}T00:00:00Z",
        "resolution_km": 9.0,
        "coverage_fraction": 1.0,
        "granule_ids": ["SPL4SMGP.008.test"],
        "cells": [
            {
                "latitude": 27.0,
                "longitude": 85.0,
                "surface_sm": 0.2,
                "root_sm": 0.18,
                "quality": "good",
            }
        ],
    }


def up_to_date_fetch(days, cache):
    return {"status": "up_to_date", "processed": [], "skipped_dates": []}


def no_snapshot_download(settings, today, *, root=None):
    """Test double: the lifecycle tests must not contact Earthdata."""
    return []


def test_refresh_installs_valid_staged_snapshot_and_updates_status(tmp_path, monkeypatch):
    settings = make_settings(tmp_path)
    signals = tmp_path / "signals"
    incoming = tmp_path / "incoming" / "smap"
    status_file = tmp_path / "status.json"
    incoming.mkdir(parents=True)
    day = TODAY
    (incoming / f"{day.isoformat()}.json").write_text(
        json.dumps(smap_payload(day)), encoding="utf-8"
    )
    monkeypatch.setenv("SAFEFIELD_INCOMING_DIR", str(tmp_path / "incoming"))
    monkeypatch.setenv("SAFEFIELD_STATUS_PATH", str(status_file))

    report = run_data_refresh(
        settings=settings,
        fetch_fn=up_to_date_fetch,
        snapshot_fetch_fn=no_snapshot_download,
        today_utc=TODAY,
        root=signals,
        imerg_raw_dir=tmp_path / "raw",
    )

    assert report.status == "ok"
    assert report.snapshots.installed_files == 1
    assert report.snapshots.installed == {"smap": 1}
    assert (signals / "smap" / f"{day.isoformat()}.json").exists()
    status = read_status(status_file)
    assert status is not None
    assert status.sources["smap"].status == "ok"
    assert status.sources["smap"].product == "SPL4SMGP"
    payload = read_automation_status(Path(settings.automation_status_path))
    assert payload["snapshots"]["installed_files"] == 1


def test_refresh_skips_snapshot_day_that_is_already_installed(tmp_path, monkeypatch):
    settings = make_settings(tmp_path)
    signals = tmp_path / "signals"
    incoming = tmp_path / "incoming" / "smap"
    day = TODAY
    (signals / "smap").mkdir(parents=True)
    incoming.mkdir(parents=True)
    (signals / "smap" / f"{day.isoformat()}.json").write_text("{}", encoding="utf-8")
    (incoming / f"{day.isoformat()}.json").write_text(
        json.dumps(smap_payload(day)), encoding="utf-8"
    )
    monkeypatch.setenv("SAFEFIELD_INCOMING_DIR", str(tmp_path / "incoming"))
    monkeypatch.setenv("SAFEFIELD_STATUS_PATH", str(tmp_path / "status.json"))

    report = run_data_refresh(
        settings=settings,
        fetch_fn=up_to_date_fetch,
        snapshot_fetch_fn=no_snapshot_download,
        today_utc=TODAY,
        root=signals,
        imerg_raw_dir=tmp_path / "raw",
    )

    assert report.snapshots.installed_files == 0
    assert report.snapshots.skipped_files == 1
    assert (signals / "smap" / f"{day.isoformat()}.json").read_text(encoding="utf-8") == "{}"


def test_invalid_staged_snapshot_is_reported_without_stopping_imerg(tmp_path, monkeypatch):
    settings = make_settings(tmp_path)
    incoming = tmp_path / "incoming" / "smap"
    incoming.mkdir(parents=True)
    (incoming / f"{TODAY.isoformat()}.json").write_text("{}", encoding="utf-8")
    status_file = tmp_path / "status.json"
    monkeypatch.setenv("SAFEFIELD_INCOMING_DIR", str(tmp_path / "incoming"))
    monkeypatch.setenv("SAFEFIELD_STATUS_PATH", str(status_file))

    def fetched(days, cache):
        return {
            "status": "ok",
            "processed": [{"date_utc": TODAY.isoformat(), "granule_id": "granule.V07C"}],
            "skipped_dates": [],
        }

    report = run_data_refresh(
        settings=settings,
        fetch_fn=fetched,
        snapshot_fetch_fn=no_snapshot_download,
        today_utc=TODAY,
        root=tmp_path / "signals",
        imerg_raw_dir=tmp_path / "raw",
    )

    assert report.status == "partial"
    assert report.imerg.installed_dates == [TODAY.isoformat()]
    assert report.snapshots.status == "error"
    assert "smap" in (report.snapshots.error or "")
    assert not (tmp_path / "signals" / "smap" / f"{TODAY.isoformat()}.json").exists()
    status = read_status(status_file)
    assert status is not None and status.sources["smap"].status == "error"


def test_invalid_snapshot_error_does_not_leak_the_incoming_path(tmp_path, monkeypatch):
    settings = make_settings(tmp_path)
    incoming = tmp_path / "incoming" / "smap"
    incoming.mkdir(parents=True)
    (incoming / f"{TODAY.isoformat()}.json").write_text("{}", encoding="utf-8")
    monkeypatch.setenv("SAFEFIELD_INCOMING_DIR", str(tmp_path / "incoming"))
    monkeypatch.setenv("SAFEFIELD_STATUS_PATH", str(tmp_path / "status.json"))

    report = run_data_refresh(
        settings=settings,
        fetch_fn=up_to_date_fetch,
        snapshot_fetch_fn=no_snapshot_download,
        today_utc=TODAY,
        root=tmp_path / "signals",
        imerg_raw_dir=tmp_path / "raw",
    )

    assert str(incoming) not in (report.snapshots.error or "")


def test_data_storage_endpoint_reports_initialized_resources():
    from fastapi.testclient import TestClient

    from app.main import create_app

    app = create_app()
    app.state.data_storage = {
        "postgres": "ok",
        "storage": "error",
        "restored_files": 3,
        "error": "HTTP 403 for bucket",
    }

    response = TestClient(app).get("/api/integrations/data-storage")

    assert response.status_code == 200
    body = response.json()
    assert body["postgres"]["status"] == "ok"
    assert body["storage"]["status"] == "error"
    assert body["storage"]["restored_files"] == 3
    assert body["storage"]["recent_days"] >= 1
    assert body["retention_windows"]["signal_retention_days"] >= 1
    assert body["retention_windows"]["supabase_recent_days"] >= 1
