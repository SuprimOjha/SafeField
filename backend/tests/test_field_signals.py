import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from app.decision.water_plan import (
    SourcedNumber,
    WaterPlanRequest,
    build_water_plan,
)
from app.schemas import DailyWeatherRecord, FreshnessBadge, PowerSummaryResponse
from app.services.forecast_client import DailyForecastItem, ForecastResponse
from app.services.rainfall import RainfallObservation, RainfallProvenance
from app.signals.agreement import rain_agreement, soil_moisture_agreement
from app.signals.config import SignalGates
from app.signals.field import build_rain_signal, build_signal_bundle
from app.signals.models import SignalBundle, SignalProvenance, SignalValue
from app.signals.rain_impact import assess_rain_impact
from app.signals.stress import build_stress_watch


GATES = SignalGates()
UTC = timezone.utc


def rainfall(
    amount: float | None,
    end: datetime,
    *,
    source_name: str = "NASA GPM IMERG Late",
    dataset: str = "GPM_3IMERGDL",
    kind: str = "observation",
    window_hours: int = 72,
) -> RainfallObservation:
    if amount is None:
        return RainfallObservation(
            status="UNAVAILABLE",
            amount_mm=None,
            window_hours=window_hours,
            provenance=None,
            unavailable_reason="No rainfall value was available.",
        )
    return RainfallObservation(
        status="AVAILABLE",
        amount_mm=amount,
        window_hours=window_hours,
        provenance=RainfallProvenance(
            source_name=source_name,
            kind=kind,  # type: ignore[arg-type]
            observed_start_utc=end - timedelta(hours=window_hours),
            observed_end_utc=end,
            fetched_at_utc=end + timedelta(hours=3),
            spatial_resolution="0.1° grid",
            latency_note="14 hours",
            dataset=dataset,
            version="07",
            units="mm",
        ),
    )


def test_imerg_rain_signal_is_labelled_nasa_observation():
    observation = rainfall(18.5, datetime(2026, 11, 11, 0, tzinfo=UTC))
    signal = build_rain_signal(observation)
    assert signal.status == "available"
    assert signal.value == 18.5
    assert signal.unit == "mm over 72 h"
    assert signal.provenance is not None
    assert signal.provenance.kind == "observation"
    assert signal.provenance.is_nasa is True
    assert signal.provenance.valid_date == date(2026, 11, 11)
    assert "not a rain gauge" in signal.provenance.caveat


def test_non_nasa_reanalysis_rain_signal_is_not_labelled_nasa():
    observation = rainfall(
        4.0,
        datetime(2026, 11, 11, 0, tzinfo=UTC),
        source_name="Open-Meteo Reanalysis Daily Precipitation (non-NASA)",
        dataset="ERA5 best-match",
        kind="model",
    )
    signal = build_rain_signal(observation)
    assert signal.provenance is not None
    assert signal.provenance.is_nasa is False
    assert signal.provenance.kind == "model"
    assert signal.provenance.source_key == "open_meteo_past"


def test_non_nasa_label_does_not_mark_source_agreement_as_nasa():
    end = datetime(2026, 11, 11, 0, tzinfo=UTC)
    agreement = rain_agreement(
        [
            rainfall(20.0, end),
            rainfall(
                21.0,
                end,
                source_name="Open-Meteo Reanalysis Daily Precipitation (non-NASA)",
                dataset="ERA5",
                kind="model",
            ),
        ],
        gates=GATES,
    )
    assert agreement.state == "agree"
    assert [source.is_nasa for source in agreement.sources] == [True, False]


def test_unavailable_rain_never_carries_a_zero():
    signal = build_rain_signal(
        rainfall(None, datetime(2026, 11, 11, 0, tzinfo=UTC))
    )
    assert signal.status == "unavailable"
    assert signal.value is None
    assert signal.unavailable_reason


def test_rain_agreement_requires_same_window():
    end = datetime(2026, 11, 11, 0, tzinfo=UTC)
    left = rainfall(20.0, end)
    right = rainfall(22.0, end, source_name="Open-Meteo reanalysis", dataset="ERA5", kind="model")
    agreement = rain_agreement([left, right], gates=GATES)
    assert agreement.state == "agree"
    assert agreement.spread_mm == 2.0
    assert len(agreement.sources) == 2


def test_rain_agreement_flags_large_spread():
    end = datetime(2026, 11, 11, 0, tzinfo=UTC)
    agreement = rain_agreement(
        [rainfall(5.0, end), rainfall(40.0, end, source_name="Other model", dataset="MODEL", kind="model")],
        gates=GATES,
    )
    assert agreement.state == "disagree"
    assert agreement.spread_mm == 35.0


def test_rain_agreement_does_not_compare_different_dates():
    agreement = rain_agreement(
        [
            rainfall(5.0, datetime(2026, 11, 10, 0, tzinfo=UTC)),
            rainfall(40.0, datetime(2026, 11, 11, 0, tzinfo=UTC)),
        ],
        gates=GATES,
    )
    assert agreement.state == "insufficient_sources"
    assert agreement.spread_mm is None


def test_single_rain_source_is_insufficient_not_agreement():
    agreement = rain_agreement(
        [rainfall(20.0, datetime(2026, 11, 11, 0, tzinfo=UTC))], gates=GATES
    )
    assert agreement.state == "insufficient_sources"


def test_soil_moisture_sources_are_not_forced_into_a_score():
    agreement = soil_moisture_agreement()
    assert agreement.topic == "soil_moisture"
    assert agreement.state == "not_comparable"


def weather_record(day: str, temp_max: float | None) -> DailyWeatherRecord:
    return DailyWeatherRecord(
        date=day,
        precip_mm=0.0,
        temp_c=24.0,
        temp_max_c=temp_max,
        temp_min_c=12.0,
        surface_soil_wetness=0.3,
        root_soil_wetness=0.4,
    )


def power_summary(
    rain_24h: float | None = None,
    rain_72h: float | None = None,
    max_temps: list[float] | None = None,
    status: str = "LIVE",
) -> PowerSummaryResponse:
    records = [
        weather_record(f"2026-11-{day:02d}", temperature)
        for day, temperature in zip(range(5, 12), max_temps or [30.0] * 7)
    ]
    return PowerSummaryResponse(
        latitude=26.45,
        longitude=87.28,
        freshness=FreshnessBadge(
            dataset_name="NASA POWER Daily Agroclimatology (MERRA-2 / GEOS-IT)",
            source_org="NASA Langley Research Center (LaRC)",
            is_nasa=True,
            status=status,  # type: ignore[arg-type]
            latest_observation_date="2026-11-11",
            fetched_at_utc="2026-11-12T00:00:00+00:00",
            typical_latency="2-4 days",
            spatial_resolution="0.5° x 0.625° (~55 km grid cell)",
            caveat="Gridded reanalysis output, not an on-farm gauge.",
            docs_url="https://power.larc.nasa.gov/docs/services/api/",
        ),
        rain_last_24h_mm=rain_24h,
        rain_last_72h_mm=rain_72h,
        latest_surface_wetness=0.3,
        latest_root_wetness=0.4,
        latest_temp_c=24.0,
        recent_daily_records=records,
        historical_daily_records=records,
    )


def forecast_response(rain_48h: float | None) -> ForecastResponse:
    return ForecastResponse(
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
                temperature_2m_max_c=30.0,
            )
        ],
        expected_rain_next_48h_mm=rain_48h,
        expected_rain_next_120h_mm=rain_48h,
        rain_expected_soon=None,
    )


def test_rain_impact_heavy_recent():
    impact = assess_rain_impact(power_summary(rain_72h=85.0), forecast_response(0.0), gates=GATES)
    assert impact.classification == "heavy_recent"
    assert "Design assumption" in impact.assumption_note


def test_rain_impact_heavy_forecast_only():
    impact = assess_rain_impact(power_summary(rain_72h=0.0), forecast_response(12.0), gates=GATES)
    assert impact.classification == "heavy_forecast"


def test_rain_impact_missing_is_unknown_not_none():
    impact = assess_rain_impact(None, None, gates=GATES)
    assert impact.classification == "unknown"


def make_signal(name: str, vs_normal: str = "near_normal", status: str = "available") -> SignalValue:
    if status in {"unavailable", "not_installed"}:
        return SignalValue(
            name=name,  # type: ignore[arg-type]
            status=status,  # type: ignore[arg-type]
            unavailable_reason="Not installed for this test.",
        )
    return SignalValue(
        name=name,  # type: ignore[arg-type]
        status=status,  # type: ignore[arg-type]
        value=1.0,
        unit="test",
        vs_normal=vs_normal,  # type: ignore[arg-type]
        provenance=SignalProvenance(
            source_name="Test source",
            product="TEST",
            version="1",
            kind="model",
            is_nasa=True,
            valid_date=date(2026, 11, 10),
            fetched_at=datetime(2026, 11, 11, tzinfo=UTC),
            spatial_resolution="test",
            latency_note="test",
            caveat="test",
        ),
    )


def bundle_with(**overrides: SignalValue) -> SignalBundle:
    names = [
        "rain",
        "soil_moisture_surface",
        "soil_moisture_root",
        "heat_air",
        "heat_surface",
        "ndvi",
        "evi",
    ]
    signals = {name: overrides.get(name, make_signal(name)) for name in names}
    return SignalBundle(
        latitude=26.45,
        longitude=87.28,
        generated_at=datetime(2026, 11, 12, tzinfo=UTC),
        signals=signals,
    )


def test_stress_watch_flags_below_normal_soil_moisture():
    bundle = bundle_with(
        soil_moisture_root=make_signal("soil_moisture_root", "much_below"),
    )
    watch = build_stress_watch(bundle, impact=assess_rain_impact(None, None, gates=GATES))
    assert watch.overall == "watch"
    water = next(factor for factor in watch.factors if factor.factor == "water")
    assert water.state == "watch"
    assert any("much below" in item for item in water.evidence)


def test_stress_watch_all_normal_and_dry_is_no_watch():
    bundle = bundle_with()
    summary = power_summary(rain_24h=0.0, rain_72h=0.0)
    impact = assess_rain_impact(summary, forecast_response(0.0), gates=GATES)
    watch = build_stress_watch(bundle, summary=summary, impact=impact, gates=GATES)
    assert watch.overall == "no_watch"
    assert "not certify" in watch.summary


def test_stress_watch_missing_signals_are_unknown_not_normal():
    bundle = bundle_with(
        soil_moisture_root=make_signal("soil_moisture_root", status="not_installed"),
        soil_moisture_surface=make_signal("soil_moisture_surface", status="not_installed"),
    )
    watch = build_stress_watch(bundle, impact=assess_rain_impact(None, None, gates=GATES))
    assert watch.overall == "unknown"


def test_stress_watch_heat_day_count_triggers_watch():
    bundle = bundle_with()
    summary = power_summary(max_temps=[30, 31, 36, 37, 30, 31, 30])
    watch = build_stress_watch(
        bundle,
        summary=summary,
        impact=assess_rain_impact(summary, forecast_response(0.0), gates=GATES),
        gates=GATES,
    )
    heat = next(factor for factor in watch.factors if factor.factor == "heat")
    assert heat.state == "watch"
    assert any("heat-day screening level" in item for item in heat.evidence)


def write_snapshot(root: Path, source: str, day: str, payload: dict) -> None:
    directory = root / source
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{day}.json").write_text(json.dumps(payload), encoding="utf-8")


def test_field_bundle_includes_all_signals_and_missing_source_warnings(tmp_path):
    write_snapshot(
        tmp_path,
        "smap",
        "2026-11-10",
        {
            "product": "SPL4SMGP",
            "version": "008",
            "data_date": "2026-11-10",
            "fetched_at": "2026-11-11T03:00:00+00:00",
            "resolution_km": 9,
            "cells": [
                {
                    "latitude": 26.45,
                    "longitude": 87.28,
                    "surface_sm": 0.31,
                    "root_sm": 0.29,
                    "quality": "good",
                }
            ],
        },
    )
    write_snapshot(
        tmp_path,
        "lst",
        "2026-11-10",
        {
            "product": "MOD11A1",
            "version": "061",
            "data_date": "2026-11-10",
            "fetched_at": "2026-11-11T05:00:00+00:00",
            "resolution_km": 1,
            "cells": [
                {
                    "latitude": 26.45,
                    "longitude": 87.28,
                    "lst_day_c": 31.0,
                    "qc_good": True,
                    "clear_sky": True,
                }
            ],
        },
    )
    write_snapshot(
        tmp_path,
        "vegetation",
        "2026-11-10",
        {
            "product": "MOD13Q1",
            "version": "061",
            "composite_start": "2026-10-26",
            "composite_end": "2026-11-10",
            "fetched_at": "2026-11-11T06:00:00+00:00",
            "resolution_m": 250,
            "cells": [
                {"latitude": 26.45, "longitude": 87.28, "ndvi": 0.6, "evi": 0.4, "qa_good": True}
            ],
        },
    )
    bundle = build_signal_bundle(
        26.45,
        87.28,
        summary=power_summary(rain_72h=10.0),
        observation=rainfall(18.0, datetime(2026, 11, 11, 0, tzinfo=UTC)),
        today=date(2026, 11, 12),
        gates=GATES,
        root=tmp_path,
    )
    assert set(bundle.signals) == {
        "rain",
        "soil_moisture_surface",
        "soil_moisture_root",
        "heat_air",
        "heat_surface",
        "ndvi",
        "evi",
    }
    assert bundle.signals["soil_moisture_root"].value == 0.29
    assert bundle.signals["heat_surface"].value == 31.0
    assert bundle.signals["ndvi"].value == 0.6
    assert bundle.warnings == []


def sourced(value: float, unit: str = "mm") -> SourcedNumber:
    return SourcedNumber(
        value=value, unit=unit, label="assumption", source="test vector, not agronomic data"
    )


def complete_plan_request() -> WaterPlanRequest:
    return WaterPlanRequest(
        awc_mm_per_m=sourced(100.0, "mm/m"),
        root_depth_m=sourced(0.5, "m"),
        allowed_depletion_fraction=sourced(0.5, "fraction"),
        crop_coefficient_kc=sourced(0.5, "fraction"),
        current_depletion_mm=sourced(10.0),
        et0_forecast_mm=[sourced(20.0), sourced(20.0), sourced(20.0)],
        rain_forecast_mm=[sourced(0.0), sourced(0.0), sourced(0.0)],
    )


def test_water_plan_is_not_assessed_without_inputs():
    result = build_water_plan(WaterPlanRequest())
    assert result.status == "not_assessed"
    assert "awc_mm_per_m" in result.missing_inputs
    assert result.days_until_stress is None


def test_water_plan_estimates_days_until_stress_with_sourced_inputs():
    result = build_water_plan(complete_plan_request(), start_date=date(2026, 11, 15))
    assert result.status == "estimated"
    assert result.taw_mm == 50.0
    assert result.raw_mm == 25.0
    assert result.days_until_stress == 2
    assert result.estimated_stress_date == date(2026, 11, 16)
    assert result.inputs["allowed_depletion_fraction"]["label"] == "assumption"


def test_water_plan_requires_explicit_dry_forecast():
    request = complete_plan_request()
    request.rain_forecast_mm = []
    result = build_water_plan(request)
    assert result.status == "not_assessed"
    assert any("rain_forecast_mm" in item for item in result.invalid_inputs)


def test_water_plan_rejects_invalid_depletion_fraction():
    request = complete_plan_request()
    request.allowed_depletion_fraction = sourced(1.5)
    result = build_water_plan(request)
    assert result.status == "not_assessed"
    assert result.invalid_inputs


def test_water_plan_rejects_depletion_above_taw():
    request = complete_plan_request()
    request.current_depletion_mm = sourced(500.0)
    result = build_water_plan(request)
    assert result.status == "not_assessed"
