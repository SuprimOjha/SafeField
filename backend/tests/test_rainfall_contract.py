from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.services import rain_resolution
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


def test_non_finite_rainfall_amount_is_rejected():
    with pytest.raises(ValidationError):
        RainfallObservation(
            status="AVAILABLE", amount_mm=float("nan"), window_hours=24,
            provenance=provenance(),
        )


def test_negative_rainfall_amount_is_rejected():
    with pytest.raises(ValidationError):
        RainfallObservation(
            status="AVAILABLE", amount_mm=-0.1, window_hours=24,
            provenance=provenance(),
        )


def test_coverage_fraction_outside_unit_interval_is_rejected():
    with pytest.raises(ValidationError):
        provenance(coverage_fraction=1.1)


def test_unavailable_message_keeps_every_provider_reason(monkeypatch):
    class FakeImergProvider:
        def get_recent_rain(self, *args, **kwargs):
            return RainfallObservation(
                status="UNAVAILABLE",
                window_hours=72,
                unavailable_reason="Only 0 daily IMERG record(s) are cached; 3 consecutive days are required.",
            )

    monkeypatch.setattr(rain_resolution, "ImergLateProvider", FakeImergProvider)
    monkeypatch.setattr(
        rain_resolution,
        "get_recent_rain_reanalysis",
        lambda *args, **kwargs: RainfallObservation(
            status="UNAVAILABLE",
            window_hours=72,
            unavailable_reason="Reanalysis lookup failed (HTTP 429).",
        ),
    )
    power = SimpleNamespace(
        recent_daily_records=[],
        rain_last_72h_mm=None,
        freshness=SimpleNamespace(spatial_resolution="~55 km grid cell"),
    )

    result, candidates = rain_resolution.resolve_recent_rainfall(26.45, 87.28, power, hours=72)

    assert result.status == "UNAVAILABLE"
    assert "Only 0 daily IMERG record(s) are cached" in result.unavailable_reason
    assert "HTTP 429" in result.unavailable_reason
    assert len(candidates) == 3
