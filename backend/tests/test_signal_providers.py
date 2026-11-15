import json
from datetime import date, timedelta
from pathlib import Path

from app.schemas import DailyWeatherRecord, FreshnessBadge, PowerSummaryResponse
from app.services.forecast_client import DailyForecastItem, ForecastResponse
from app.signals.config import SignalGates
from app.signals.heat import build_heat_air_signal, count_heat_days, forecast_heat_days
from app.signals.lst import LstProvider
from app.signals.smap import SmapProvider
from app.signals.vegetation import VegProvider


GATES = SignalGates()


def write_snapshot(root: Path, source: str, day: str, payload: dict) -> Path:
    directory = root / source
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{day}.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def smap_payload(day: str, **overrides) -> dict:
    payload = {
        "product": "SPL4SMGP",
        "version": "008",
        "data_date": day,
        "fetched_at": f"{day}T03:00:00+00:00",
        "resolution_km": 9,
        "model_only": False,
        "coverage_fraction": 1.0,
        "granule_ids": ["G-SMAP-1"],
        "cells": [
            {
                "latitude": 26.45,
                "longitude": 87.28,
                "surface_sm": 0.31,
                "root_sm": 0.29,
                "quality": "good",
            },
            {
                "latitude": 26.60,
                "longitude": 87.40,
                "surface_sm": 0.22,
                "root_sm": 0.24,
                "quality": "good",
            },
        ],
    }
    payload.update(overrides)
    return payload


def lst_payload(day: str, **overrides) -> dict:
    payload = {
        "product": "MOD11A1",
        "version": "061",
        "data_date": day,
        "fetched_at": f"{day}T05:00:00+00:00",
        "resolution_km": 1,
        "granule_ids": ["G-LST-1"],
        "cells": [
            {
                "latitude": 26.45,
                "longitude": 87.28,
                "lst_day_c": 31.5,
                "lst_night_c": 18.0,
                "qc_good": True,
                "clear_sky": True,
            }
        ],
    }
    payload.update(overrides)
    return payload


def veg_payload(day: str, **overrides) -> dict:
    payload = {
        "product": "MOD13Q1",
        "version": "061",
        "composite_start": (date.fromisoformat(day) - timedelta(days=15)).isoformat(),
        "composite_end": day,
        "fetched_at": f"{day}T06:00:00+00:00",
        "resolution_m": 250,
        "granule_ids": ["G-VEG-1"],
        "cells": [
            {"latitude": 26.45, "longitude": 87.28, "ndvi": 0.62, "evi": 0.41, "qa_good": True}
        ],
    }
    payload.update(overrides)
    return payload


def test_smap_reports_not_installed_without_snapshots(tmp_path):
    signal = SmapProvider(root=tmp_path, gates=GATES).get_signal(26.45, 87.28, date(2026, 11, 12))
    assert signal.status == "not_installed"
    assert signal.value is None
    assert signal.provenance is None
    assert "run the smap ingest" in (signal.unavailable_reason or "").lower()


def test_smap_available_signal_carries_model_provenance(tmp_path):
    write_snapshot(tmp_path, "smap", "2026-11-10", smap_payload("2026-11-10"))
    signal = SmapProvider(root=tmp_path, gates=GATES).get_signal(26.45, 87.28, date(2026, 11, 12))
    assert signal.status == "available"
    assert signal.value == 0.31
    assert signal.unit == "m³/m³ (volumetric)"
    assert signal.vs_normal == "unknown"
    assert signal.provenance is not None
    assert signal.provenance.kind == "model"
    assert signal.provenance.is_nasa is True
    assert signal.provenance.version == "008"
    assert signal.provenance.valid_date == date(2026, 11, 10)
    assert "not a field probe" in signal.provenance.caveat


def test_smap_newest_malformed_snapshot_is_not_silently_skipped(tmp_path):
    write_snapshot(tmp_path, "smap", "2026-11-09", smap_payload("2026-11-09"))
    write_snapshot(tmp_path, "smap", "2026-11-10", {"product": "SPL4SMGP"})
    signal = SmapProvider(root=tmp_path, gates=GATES).get_signal(26.45, 87.28, date(2026, 11, 12))
    assert signal.status == "unavailable"
    assert "malformed" in (signal.unavailable_reason or "").lower()


def test_smap_snapshot_older_than_gate_is_stale(tmp_path):
    write_snapshot(tmp_path, "smap", "2026-11-01", smap_payload("2026-11-01"))
    signal = SmapProvider(root=tmp_path, gates=GATES).get_signal(26.45, 87.28, date(2026, 11, 12))
    assert signal.status == "stale"
    assert signal.value == 0.31
    assert "not live data" in (signal.quality_note or "")


def test_smap_low_coverage_is_partial(tmp_path):
    payload = smap_payload("2026-11-10", coverage_fraction=0.4)
    write_snapshot(tmp_path, "smap", "2026-11-10", payload)
    signal = SmapProvider(root=tmp_path, gates=GATES).get_signal(26.45, 87.28, date(2026, 11, 12))
    assert signal.status == "partial"
    assert "below the" in (signal.quality_note or "")


def test_lst_requires_clear_quality_pixels(tmp_path):
    payload = lst_payload("2026-11-10")
    payload["cells"] = [{**payload["cells"][0], "clear_sky": False}]
    write_snapshot(tmp_path, "lst", "2026-11-10", payload)
    signal = LstProvider(root=tmp_path, gates=GATES).get_signal(26.45, 87.28, date(2026, 11, 11))
    assert signal.status == "unavailable"
    assert "no clear observation" in (signal.unavailable_reason or "").lower()


def test_lst_available_signal_is_surface_skin_not_air(tmp_path):
    write_snapshot(tmp_path, "lst", "2026-11-10", lst_payload("2026-11-10"))
    signal = LstProvider(root=tmp_path, gates=GATES).get_signal(26.45, 87.28, date(2026, 11, 11))
    assert signal.status == "available"
    assert signal.name == "heat_surface"
    assert signal.value == 31.5
    assert "surface skin" in (signal.unit or "")
    assert signal.provenance is not None
    assert "not air temperature" in signal.provenance.caveat


def test_vegetation_available_uses_composite_end_date(tmp_path):
    write_snapshot(tmp_path, "vegetation", "2026-11-10", veg_payload("2026-11-10"))
    signals = VegProvider(root=tmp_path, gates=GATES).get_signals(
        26.45, 87.28, date(2026, 11, 11)
    )
    assert signals["ndvi"].value == 0.62
    assert signals["evi"].value == 0.41
    assert signals["ndvi"].provenance is not None
    assert signals["ndvi"].provenance.valid_date == date(2026, 11, 10)
    assert signals["ndvi"].provenance.spatial_resolution == "250 m composite grid"


def test_vegetation_insufficient_clear_images_is_unavailable(tmp_path):
    payload = veg_payload("2026-11-10")
    payload["cells"] = [
        {"latitude": 26.45, "longitude": 87.28, "ndvi": 0.62, "evi": 0.41, "qa_good": False}
    ]
    write_snapshot(tmp_path, "vegetation", "2026-11-10", payload)
    signal = VegProvider(root=tmp_path, gates=GATES).get_signal(
        26.45, 87.28, date(2026, 11, 11)
    )
    assert signal.status == "unavailable"
    assert "not enough clear images" in (signal.unavailable_reason or "").lower()


def weather_record(day: str, temp_max: float | None, temp_c: float | None = 24.0) -> DailyWeatherRecord:
    return DailyWeatherRecord(
        date=day,
        precip_mm=0.0,
        temp_c=temp_c,
        temp_max_c=temp_max,
        temp_min_c=12.0,
        surface_soil_wetness=0.3,
        root_soil_wetness=0.4,
    )


def power_summary(status: str) -> PowerSummaryResponse:
    records = [
        weather_record("2026-11-07", 34.0),
        weather_record("2026-11-08", 36.2),
        weather_record("2026-11-09", None),
        weather_record("2026-11-10", 37.5),
    ]
    return PowerSummaryResponse(
        latitude=26.45,
        longitude=87.28,
        freshness=FreshnessBadge(
            dataset_name="NASA POWER Daily Agroclimatology (MERRA-2 / GEOS-IT)",
            source_org="NASA Langley Research Center (LaRC)",
            is_nasa=True,
            status=status,  # type: ignore[arg-type]
            latest_observation_date="2026-11-10",
            fetched_at_utc="2026-11-12T00:00:00+00:00",
            typical_latency="2-4 days",
            spatial_resolution="0.5° x 0.625° (~55 km grid cell)",
            caveat="Gridded reanalysis output, not an on-farm gauge.",
            docs_url="https://power.larc.nasa.gov/docs/services/api/",
        ),
        rain_last_24h_mm=None,
        rain_last_72h_mm=None,
        latest_surface_wetness=0.3,
        latest_root_wetness=0.4,
        latest_temp_c=24.0,
        recent_daily_records=records,
        historical_daily_records=records,
    )


def test_count_heat_days_does_not_treat_missing_days_as_cool():
    records = [
        weather_record("2026-11-07", 34.0),
        weather_record("2026-11-08", 36.2),
        weather_record("2026-11-09", None),
        weather_record("2026-11-10", 37.5),
    ]
    hot, observed = count_heat_days(records, 35.0, window_days=7)
    assert (hot, observed) == (2, 3)


def test_heat_air_signal_from_live_power_is_model_not_observation():
    signal = build_heat_air_signal(power_summary("LIVE"), gates=GATES)
    assert signal.name == "heat_air"
    assert signal.status == "available"
    assert signal.value == 37.5
    assert signal.provenance is not None
    assert signal.provenance.kind == "model"
    assert signal.provenance.version == "not reported by provider"
    assert "heat-day screening level" in (signal.quality_note or "")
    assert "Design assumption" in (signal.quality_note or "")


def test_heat_air_signal_from_cached_power_is_stale_and_cached():
    signal = build_heat_air_signal(power_summary("CACHED_FALLBACK"), gates=GATES)
    assert signal.status == "stale"
    assert signal.provenance is not None
    assert signal.provenance.kind == "cached"
    assert "not live data" in (signal.quality_note or "")


def test_heat_air_unavailable_power_never_invents_a_value():
    signal = build_heat_air_signal(power_summary("UNAVAILABLE"), gates=GATES)
    assert signal.status == "unavailable"
    assert signal.value is None
    assert signal.provenance is None


def test_forecast_heat_days_counts_only_available_forecast_days():
    forecast = ForecastResponse(
        latitude=26.45,
        longitude=87.28,
        freshness=FreshnessBadge(
            dataset_name="Open-Meteo 5-Day Weather Forecast (Non-NASA)",
            source_org="Open-Meteo",
            is_nasa=False,
            status="LIVE",
            latest_observation_date="2026-11-12",
            fetched_at_utc="2026-11-12T00:00:00+00:00",
            typical_latency="Frequently updated",
            spatial_resolution="~9-11 km",
            caveat="NON-NASA MODEL FORECAST.",
            docs_url="https://open-meteo.com/en/docs",
        ),
        forecast_days=[
            DailyForecastItem(
                date="2026-11-12",
                precipitation_sum_mm=0.0,
                precipitation_probability_max=5,
                temperature_2m_max_c=36.0,
            ),
            DailyForecastItem(
                date="2026-11-13",
                precipitation_sum_mm=0.0,
                precipitation_probability_max=5,
                temperature_2m_max_c=None,
            ),
            DailyForecastItem(
                date="2026-11-14",
                precipitation_sum_mm=0.0,
                precipitation_probability_max=5,
                temperature_2m_max_c=35.0,
            ),
        ],
        expected_rain_next_48h_mm=0.0,
        expected_rain_next_120h_mm=0.0,
        rain_expected_soon=False,
    )
    assert forecast_heat_days(forecast, 35.0) == (2, 2)
