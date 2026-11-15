from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.api import signal_routes
from app.main import create_app
from app.schemas import DailyWeatherRecord, FreshnessBadge, PowerSummaryResponse
from app.services.forecast_client import DailyForecastItem, ForecastResponse
from app.services.rainfall import RainfallObservation, RainfallProvenance
from app.signals.models import DataStatusFile, SourceStatus
from app.signals.status import write_status


UTC = timezone.utc


def power_summary() -> PowerSummaryResponse:
    records = [
        DailyWeatherRecord(
            date=f"2026-11-{day:02d}",
            precip_mm=0.0,
            temp_c=24.0,
            temp_max_c=30.0,
            temp_min_c=12.0,
            surface_soil_wetness=0.3,
            root_soil_wetness=0.4,
        )
        for day in range(5, 12)
    ]
    return PowerSummaryResponse(
        latitude=26.45,
        longitude=87.28,
        freshness=FreshnessBadge(
            dataset_name="NASA POWER Daily Agroclimatology (MERRA-2 / GEOS-IT)",
            source_org="NASA Langley Research Center (LaRC)",
            is_nasa=True,
            status="LIVE",
            latest_observation_date="2026-11-11",
            fetched_at_utc="2026-11-12T00:00:00+00:00",
            typical_latency="2-4 days",
            spatial_resolution="0.5° x 0.625° (~55 km grid cell)",
            caveat="Gridded reanalysis output, not an on-farm gauge.",
            docs_url="https://power.larc.nasa.gov/docs/services/api/",
        ),
        rain_last_24h_mm=0.0,
        rain_last_72h_mm=0.0,
        latest_surface_wetness=0.3,
        latest_root_wetness=0.4,
        latest_temp_c=24.0,
        recent_daily_records=records,
        historical_daily_records=records,
    )


def forecast() -> ForecastResponse:
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
        expected_rain_next_48h_mm=0.0,
        expected_rain_next_120h_mm=0.0,
        rain_expected_soon=False,
    )


def rainfall() -> RainfallObservation:
    end = datetime(2026, 11, 11, tzinfo=UTC)
    return RainfallObservation(
        status="AVAILABLE",
        amount_mm=18.0,
        window_hours=72,
        provenance=RainfallProvenance(
            source_name="NASA GPM IMERG Late",
            kind="observation",
            observed_start_utc=end - timedelta(hours=72),
            observed_end_utc=end,
            fetched_at_utc=end + timedelta(hours=3),
            spatial_resolution="0.1° grid",
            latency_note="14 hours",
            dataset="GPM_3IMERGDL",
            version="07",
            units="mm",
        ),
    )


def test_data_status_reports_not_installed(tmp_path, monkeypatch):
    monkeypatch.setenv("SAFEFIELD_STATUS_PATH", str(tmp_path / "missing.json"))
    client = TestClient(create_app())
    response = client.get("/api/data-status")
    assert response.status_code == 200
    assert response.json()["status"] == "not_installed"


def test_data_status_etag_supports_304(tmp_path, monkeypatch):
    path = tmp_path / "status.json"
    monkeypatch.setenv("SAFEFIELD_STATUS_PATH", str(path))
    write_status(
        DataStatusFile(
            generated_at=datetime(2026, 11, 12, tzinfo=UTC),
            sources={
                "smap": SourceStatus(
                    source="smap",
                    status="ok",
                    latest_data_date=date(2026, 11, 10),
                    product="SPL4SMGP",
                    version="008",
                )
            },
        )
    )
    client = TestClient(create_app())
    first = client.get("/api/data-status")
    assert first.status_code == 200
    assert first.json()["status"] == "ok"
    etag = first.headers["ETag"]
    second = client.get("/api/data-status", headers={"If-None-Match": etag})
    assert second.status_code == 304


def test_data_status_reports_malformed_file_without_crashing(tmp_path, monkeypatch):
    path = tmp_path / "status.json"
    path.write_text("{not json", encoding="utf-8")
    monkeypatch.setenv("SAFEFIELD_STATUS_PATH", str(path))
    client = TestClient(create_app())
    response = client.get("/api/data-status")
    assert response.status_code == 200
    assert response.json()["status"] == "error"
    assert "not valid JSON" in response.json()["message"]


def test_water_plan_endpoint_not_assessed_without_inputs():
    client = TestClient(create_app())
    response = client.post("/api/water-plan", json={})
    assert response.status_code == 200
    assert response.json()["status"] == "not_assessed"
    assert response.json()["missing_inputs"]


def test_water_plan_endpoint_estimates_with_complete_inputs():
    number = {"label": "assumption", "source": "test vector"}
    payload = {
        "awc_mm_per_m": {**number, "value": 100.0, "unit": "mm/m"},
        "root_depth_m": {**number, "value": 0.5, "unit": "m"},
        "allowed_depletion_fraction": {**number, "value": 0.5, "unit": "fraction"},
        "crop_coefficient_kc": {**number, "value": 0.5, "unit": "fraction"},
        "current_depletion_mm": {**number, "value": 10.0, "unit": "mm"},
        "et0_forecast_mm": [{**number, "value": 20.0, "unit": "mm"}] * 3,
        "rain_forecast_mm": [{**number, "value": 0.0, "unit": "mm"}] * 3,
    }
    client = TestClient(create_app())
    response = client.post("/api/water-plan", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "estimated"
    assert response.json()["days_until_stress"] == 2


def test_field_signals_rounds_coordinates_and_returns_all_parts(tmp_path, monkeypatch):
    monkeypatch.setenv("SAFEFIELD_SIGNAL_DATA_DIR", str(tmp_path / "signals"))
    seen: dict[str, tuple[float, float]] = {}

    async def fake_power(self, latitude, longitude, history_years=30):
        seen["power"] = (latitude, longitude)
        return power_summary()

    async def fake_forecast(self, latitude, longitude):
        seen["forecast"] = (latitude, longitude)
        return forecast()

    monkeypatch.setattr(signal_routes.NasaPowerClient, "get_field_weather_and_history", fake_power)
    monkeypatch.setattr(signal_routes.OpenMeteoForecastClient, "get_5day_rain_forecast", fake_forecast)
    monkeypatch.setattr(
        signal_routes,
        "resolve_recent_rainfall",
        lambda lat, lon, power, hours=72: (rainfall(), [rainfall()]),
    )

    client = TestClient(create_app())
    response = client.get("/api/field-signals", params={"lat": 26.456, "lon": 87.284})
    assert response.status_code == 200
    assert seen == {"power": (26.46, 87.28), "forecast": (26.46, 87.28)}
    body = response.json()
    assert body["bundle"]["latitude"] == 26.46
    assert body["bundle"]["signals"]["rain"]["value"] == 18.0
    assert body["bundle"]["signals"]["heat_air"]["status"] == "available"
    assert body["bundle"]["signals"]["soil_moisture_root"]["status"] == "not_installed"
    assert body["agreement"]["state"] == "insufficient_sources"
    assert body["rain_impact"]["classification"] == "none"
    assert body["stress_watch"]["overall"] == "unknown"
    assert response.headers["cache-control"] == "no-store"
