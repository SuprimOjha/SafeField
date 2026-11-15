import json
from datetime import date
from pathlib import Path

import pytest

from app.ingest.publish import publish_data
from app.ingest.raw import RawSnapshotAdapter
from app.ingest.runner import run_ingest
from app.ingest.shared import (
    DataTransferError,
    enforce_size_guard,
    latest_snapshot_date,
    prune_snapshots,
    snapshot_files,
    walk_back_days,
    write_snapshot,
)
from app.signals.status import read_status


def raw_smap_payload(day: str) -> dict:
    return {
        "product": "SPL4SMGP",
        "version": "008",
        "data_date": day,
        "fetched_at": f"{day}T03:00:00+00:00",
        "resolution_km": 9,
        "granule_ids": ["G-1"],
        "cells": [
            {
                "latitude": 26.45,
                "longitude": 87.28,
                "surface_sm": 0.31,
                "root_sm": 0.29,
                "quality": "good",
            }
        ],
    }


@pytest.fixture
def data_env(tmp_path, monkeypatch):
    data_dir = tmp_path / "signals"
    status_path = tmp_path / "status.json"
    monkeypatch.setenv("SAFEFIELD_SIGNAL_DATA_DIR", str(data_dir))
    monkeypatch.setenv("SAFEFIELD_STATUS_PATH", str(status_path))
    return data_dir, status_path


def write_raw(source_dir: Path, day: str, payload: dict) -> Path:
    source_dir.mkdir(parents=True, exist_ok=True)
    path = source_dir / f"{day}.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_walk_back_days_is_oldest_first_and_excludes_today():
    days = walk_back_days(3, today=date(2026, 11, 12))
    assert days == [date(2026, 11, 9), date(2026, 11, 10), date(2026, 11, 11)]


def test_raw_ingest_writes_snapshot_and_status(data_env):
    incoming = data_env[0].parent / "incoming" / "smap"
    write_raw(incoming, "2026-11-10", raw_smap_payload("2026-11-10"))
    adapter = RawSnapshotAdapter("smap", incoming_root=incoming)
    report = run_ingest(1, adapter=adapter, today=date(2026, 11, 11))
    assert report.status == "ok"
    assert report.written == [date(2026, 11, 10)]
    assert latest_snapshot_date("smap") == date(2026, 11, 10)
    status = read_status()
    assert status is not None
    assert status.sources["smap"].status == "ok"
    assert status.sources["smap"].latest_data_date == date(2026, 11, 10)
    assert status.sources["smap"].granule_ids == ["G-1"]


def test_raw_ingest_is_idempotent(data_env):
    incoming = data_env[0].parent / "incoming" / "smap"
    write_raw(incoming, "2026-11-10", raw_smap_payload("2026-11-10"))
    adapter = RawSnapshotAdapter("smap", incoming_root=incoming)
    assert run_ingest(1, adapter=adapter, today=date(2026, 11, 11)).written == [date(2026, 11, 10)]
    second = run_ingest(1, adapter=adapter, today=date(2026, 11, 11))
    assert second.written == []
    assert second.skipped == [date(2026, 11, 10)]


def test_raw_ingest_fills_gaps_and_reports_failures(data_env):
    incoming = data_env[0].parent / "incoming" / "smap"
    write_raw(incoming, "2026-11-10", raw_smap_payload("2026-11-10"))
    adapter = RawSnapshotAdapter("smap", incoming_root=incoming)
    run_ingest(1, adapter=adapter, today=date(2026, 11, 11))

    write_raw(incoming, "2026-11-11", raw_smap_payload("2026-11-11"))
    report = run_ingest(3, adapter=adapter, today=date(2026, 11, 12))
    assert report.written == [date(2026, 11, 11)]
    assert report.skipped == [date(2026, 11, 10)]
    assert list(report.failed) == ["2026-11-09"]
    assert report.status == "partial"
    status = read_status()
    assert status is not None
    assert status.sources["smap"].status == "error"
    assert "2026-11-09" in (status.sources["smap"].last_error or "")


def test_raw_ingest_rejects_date_mismatch(data_env):
    incoming = data_env[0].parent / "incoming" / "smap"
    write_raw(incoming, "2026-11-10", raw_smap_payload("2026-11-09"))
    adapter = RawSnapshotAdapter("smap", incoming_root=incoming)
    report = run_ingest(1, adapter=adapter, today=date(2026, 11, 11))
    assert report.status == "error"
    assert "describes 2026-11-09" in report.failed["2026-11-10"]


def test_snapshot_writer_requires_force_to_rewrite(data_env):
    day = date(2026, 11, 10)
    write_snapshot("smap", day, raw_smap_payload("2026-11-10"))
    with pytest.raises(DataTransferError):
        write_snapshot("smap", day, raw_smap_payload("2026-11-10") | {"granule_ids": ["G-2"]})
    path, changed = write_snapshot(
        "smap", day, raw_smap_payload("2026-11-10") | {"granule_ids": ["G-2"]}, overwrite=True
    )
    assert changed is True
    assert json.loads(path.read_text(encoding="utf-8"))["granule_ids"] == ["G-2"]


def test_prune_and_size_guard(data_env):
    for offset in range(5):
        day = date(2026, 11, 5 + offset)
        write_snapshot("smap", day, raw_smap_payload(day.isoformat()))
    removed = prune_snapshots("smap", keep=3)
    assert [path.name for path in removed] == ["2026-11-05.json", "2026-11-06.json"]
    assert len(snapshot_files("smap")) == 3
    with pytest.raises(DataTransferError):
        enforce_size_guard(max_bytes=10)


def test_publish_data_mirrors_and_removes_stale_files(data_env, tmp_path):
    data_dir, status_path = data_env
    write_snapshot("smap", date(2026, 11, 10), raw_smap_payload("2026-11-10"))
    status_path.write_text(
        json.dumps({"schema_version": 1, "generated_at": "2026-11-11T00:00:00+00:00", "sources": {}}),
        encoding="utf-8",
    )
    target = tmp_path / "data-branch"
    (target / "signals" / "smap").mkdir(parents=True)
    (target / "signals" / "smap" / "2026-11-09.json").write_text("{}", encoding="utf-8")

    result = publish_data(target, source_root=data_dir, status_file=status_path)
    assert result["changed"] is True
    assert "smap/2026-11-10.json" in result["copied"]
    assert result["removed"] == ["smap/2026-11-09.json"]
    assert (target / "signals" / "smap" / "2026-11-10.json").exists()
    assert (target / "status.json").exists()

    second = publish_data(target, source_root=data_dir, status_file=status_path)
    assert second["changed"] is False


def test_publish_refuses_to_erase_existing_data_with_empty_source(data_env, tmp_path):
    target = tmp_path / "data-branch"
    (target / "signals" / "smap").mkdir(parents=True)
    (target / "signals" / "smap" / "2026-11-09.json").write_text("{}", encoding="utf-8")
    with pytest.raises(DataTransferError):
        publish_data(target, source_root=data_env[0], status_file=data_env[1])
