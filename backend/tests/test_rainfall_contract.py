from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.services.rainfall import RainfallObservation, RainfallProvenance


def provenance(**overrides):
    values = {
        "source_name": "GPM IMERG Late",
        "kind": "observation",
        "observed_start_utc": datetime(2026, 11, 12, tzinfo=timezone.utc),
        "observed_end_utc": datetime(2026, 11, 13, tzinfo=timezone.utc),
        "fetched_at_utc": datetime(2026, 11, 14, tzinfo=timezone.utc),
        "spatial_resolution": "0.1 degree",
        "latency_note": "Near-real-time product",
        "dataset": "GPM_3IMERGDL",
        "version": "07B",
        "units": "mm/day",
    }
    values.update(overrides)
    return RainfallProvenance(**values)


def test_available_rainfall_requires_amount_and_provenance():
    with pytest.raises(ValidationError):
        RainfallObservation(status="AVAILABLE", amount_mm=3, window_hours=24)


def test_unavailable_rainfall_requires_explanation():
    with pytest.raises(ValidationError):
        RainfallObservation(status="UNAVAILABLE", window_hours=24)


def test_unavailable_rainfall_cannot_report_numeric_amount():
    with pytest.raises(ValidationError):
        RainfallObservation(status="UNAVAILABLE", amount_mm=0, window_hours=24, unavailable_reason="No cache")


def test_available_rainfall_cannot_carry_unavailable_reason():
    with pytest.raises(ValidationError):
        RainfallObservation(
            status="AVAILABLE", amount_mm=0, window_hours=24,
            provenance=provenance(), unavailable_reason="Stale cache",
        )


def test_available_zero_rainfall_is_valid_with_provenance():
    result = RainfallObservation(
        status="AVAILABLE", amount_mm=0, window_hours=24, provenance=provenance(),
    )
    assert result.amount_mm == 0


def test_rainfall_window_must_be_positive():
    with pytest.raises(ValidationError):
        RainfallObservation(status="UNAVAILABLE", window_hours=0, unavailable_reason="Missing")


def test_provenance_observation_interval_must_be_ordered():
    with pytest.raises(ValidationError):
        provenance(
            observed_start_utc=datetime(2026, 11, 14, tzinfo=timezone.utc),
            observed_end_utc=datetime(2026, 11, 13, tzinfo=timezone.utc),
        )
