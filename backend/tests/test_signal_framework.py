from datetime import date, datetime, timezone

import pytest
from pydantic import ValidationError

from app.signals.anomaly import compute_anomaly
from app.signals.config import SignalGates, get_gates, reset_gates_cache
from app.signals.models import (
    DataStatusFile,
    SignalProvenance,
    SignalValue,
    SourceStatus,
)
from app.signals.status import read_status, status_etag, write_status


def _provenance(**overrides) -> SignalProvenance:
    values = {
        "source_name": "NASA GPM IMERG Late Run",
        "product": "GPM_3IMERGDL",
        "version": "07C",
        "kind": "observation",
        "is_nasa": True,
        "valid_date": date(2026, 11, 13),
        "observed_start": datetime(2026, 11, 11, tzinfo=timezone.utc),
        "observed_end": datetime(2026, 11, 14, tzinfo=timezone.utc),
        "fetched_at": datetime(2026, 11, 15, 6, tzinfo=timezone.utc),
        "spatial_resolution": "0.1° (~10 km)",
        "latency_note": "Late Run, about 14 hours after a completed UTC day.",
        "granule_ids": ["3B-DAY-L.MS.MRG.3IMERG.20261113-S000000-E235959.V07C"],
        "coverage_fraction": 1.0,
        "caveat": "Gridded satellite estimate, not a field gauge.",
    }
    values.update(overrides)
    return SignalProvenance(**values)


def test_available_signal_requires_value_and_provenance():
    value = SignalValue(
        name="rain",
        status="available",
        value=12.4,
        unit="mm",
        provenance=_provenance(),
    )
    assert value.vs_normal == "unknown"

    with pytest.raises(ValidationError):
        SignalValue(name="rain", status="available", value=None, provenance=_provenance())

    with pytest.raises(ValidationError):
        SignalValue(name="rain", status="available", value=12.4, provenance=None)


def test_unavailable_signal_cannot_carry_a_number_or_omit_reason():
    signal = SignalValue(
        name="soil_moisture_root",
        status="not_installed",
        unavailable_reason="No SMAP snapshot is installed on this deployment.",
    )
    assert signal.value is None

    with pytest.raises(ValidationError):
        SignalValue(
            name="soil_moisture_root",
            status="unavailable",
            value=0.0,
            unavailable_reason="No data.",
        )

    with pytest.raises(ValidationError):
        SignalValue(name="soil_moisture_root", status="unavailable")


def test_partial_signal_may_report_a_value_with_a_quality_note():
    signal = SignalValue(
        name="heat_surface",
        status="partial",
        value=31.2,
        unit="°C",
        provenance=_provenance(kind="observation", is_nasa=True),
        quality_note="Only 62% of the pixels around the field were clear.",
    )
    assert signal.value == 31.2


def test_provenance_rejects_reversed_observation_interval():
    with pytest.raises(ValidationError):
        _provenance(
            observed_start=datetime(2026, 11, 14, tzinfo=timezone.utc),
            observed_end=datetime(2026, 11, 13, tzinfo=timezone.utc),
        )


def test_status_file_round_trip_and_etag(tmp_path):
    path = tmp_path / "status.json"
    status = DataStatusFile(
        generated_at=datetime(2026, 11, 15, 12, tzinfo=timezone.utc),
        sources={
            "imerg": SourceStatus(
                source="imerg",
                status="ok",
                last_success_at=datetime(2026, 11, 15, 6, tzinfo=timezone.utc),
                latest_data_date=date(2026, 11, 13),
                coverage=0.99,
                version="07C",
                product="GPM_3IMERGDL",
                granule_ids=["granule-1"],
                files=["imerg/2026-11-13.json"],
            )
        },
    )

    assert read_status(path) is None
    assert status_etag(path) is None

    write_status(status, path)
    loaded = read_status(path)
    assert loaded is not None
    assert loaded.sources["imerg"].latest_data_date == date(2026, 11, 13)
    assert loaded.sources["imerg"].version == "07C"

    first_etag = status_etag(path)
    assert first_etag is not None
    status.sources["imerg"].last_error = "retry scheduled"
    write_status(status, path)
    assert status_etag(path) != first_etag


def test_malformed_status_file_raises_instead_of_looking_empty(tmp_path):
    path = tmp_path / "status.json"
    path.write_text("{not json", encoding="utf-8")
    with pytest.raises(ValueError):
        read_status(path)


def test_anomaly_classifies_against_prior_years_without_current_year():
    gates = SignalGates(anomaly_window_days=7, anomaly_min_years=3)
    target = date(2026, 7, 15)
    series = [
        (date(2020, 7, 15), 10.0),
        (date(2021, 7, 15), 12.0),
        (date(2022, 7, 15), 14.0),
        (date(2023, 7, 15), 16.0),
        (date(2026, 7, 15), 100.0),  # current year must not enter its own baseline
    ]

    result = compute_anomaly(series, target, 5.0, gates)
    assert result.vs_normal == "much_below"
    assert result.baseline == 13.0
    assert result.anomaly == -8.0
    assert result.years_used == 4

    middle = compute_anomaly(series, target, 13.0, gates)
    assert middle.vs_normal == "near_normal"


def test_anomaly_returns_unknown_when_prior_years_are_insufficient():
    gates = SignalGates(anomaly_window_days=7, anomaly_min_years=3)
    series = [(date(2024, 7, 15), 10.0), (date(2025, 7, 15), 12.0)]
    result = compute_anomaly(series, date(2026, 7, 15), 12.0, gates)
    assert result.vs_normal == "unknown"
    assert result.baseline is None
    assert "Not enough prior years" in (result.reason or "")


def test_gates_can_be_overridden_from_a_json_file(tmp_path, monkeypatch):
    gates_file = tmp_path / "gates.json"
    gates_file.write_text('{"heat_day_max_c": 30.0, "anomaly_min_years": 5}', encoding="utf-8")
    monkeypatch.setenv("SAFEFIELD_SIGNAL_GATES_PATH", str(gates_file))
    reset_gates_cache()
    try:
        gates = get_gates()
        assert gates.heat_day_max_c == 30.0
        assert gates.anomaly_min_years == 5
        assert gates.max_snapshot_age_days == 5
    finally:
        reset_gates_cache()
