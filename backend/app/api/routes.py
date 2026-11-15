from fastapi import APIRouter, Query, HTTPException, Request
import json
import math
from pydantic import BaseModel, Field
from app.config import get_settings
from app.schemas import PowerSummaryResponse, SatelliteObservationStatus
from app.services.power_client import NasaPowerClient
from app.services.cmr_gibs_client import NasaCmrGibsClient
from app.services.elevation_client import ElevationClient, ElevationResponse
from app.services.forecast_client import OpenMeteoForecastClient, ForecastResponse
from app.services.soilgrids_client import SoilGridsClient, SoilTextureResponse
from app.stats.trend_engine import TrendEngine, TrendAnalysisResult
from app.decision.fertilizer_engine import FertilizerDecisionEngine, DecisionResult
from app.content_packs.loader import validate_content
from app.services.rainfall import RainfallObservation
from app.services.imerg.provider import ImergLateProvider
from app.services.rain_resolution import resolve_recent_rainfall
from app.signals.agreement import SourceAgreement, rain_agreement
from app.signals.field import build_signal_bundle
from app.signals.models import SignalBundle
from app.signals.rain_impact import RainImpact, assess_rain_impact
from app.signals.stress import StressWatch, build_stress_watch
from datetime import date, datetime, time, timedelta, timezone


router = APIRouter(prefix="/api", tags=["SafeField API"])


def parse_field_polygon(raw: str | None) -> list[tuple[float, float]] | None:
    if raw is None:
        return None
    try:
        coordinates = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="field_polygon must be a JSON array of [longitude, latitude] pairs.") from exc
    if not isinstance(coordinates, list) or len(coordinates) < 3 or len(coordinates) > 201:
        raise HTTPException(status_code=422, detail="field_polygon must contain between 3 and 200 vertices.")
    points: list[tuple[float, float]] = []
    for point in coordinates:
        if not isinstance(point, list) or len(point) != 2:
            raise HTTPException(status_code=422, detail="Each field_polygon vertex must contain exactly longitude and latitude.")
        try:
            lon_value, lat_value = float(point[0]), float(point[1])
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="Field polygon coordinates must be numeric.") from exc
        if not math.isfinite(lon_value) or not math.isfinite(lat_value) or not (80.0 <= lon_value <= 88.3 and 26.3 <= lat_value <= 30.5):
            raise HTTPException(status_code=422, detail="Field polygon coordinates must lie inside the Nepal pilot bounding box.")
        points.append((lon_value, lat_value))
    if points[0] != points[-1]:
        points.append(points[0])
    if len(points) < 4 or len(points) > 201:
        raise HTTPException(status_code=422, detail="A field polygon requires 3–200 unique vertices.")
    return points


class FieldAssessmentResponse(BaseModel):
    latitude: float
    longitude: float
    power_summary: PowerSummaryResponse
    elevation: ElevationResponse
    soil_texture: SoilTextureResponse
    forecast: ForecastResponse
    decision: DecisionResult
    climate_trend: TrendAnalysisResult
    rainfall_observation: RainfallObservation
    # Additive fields; older clients can ignore them.
    signals: SignalBundle | None = None
    rain_agreement: SourceAgreement | None = None
    rain_impact: RainImpact | None = None
    stress_watch: StressWatch | None = None


@router.get("/districts")
async def get_nepal_districts() -> dict[str, str]:
    return {
        "pilot_districts": "Morang, Sunsari, Jhapa, Ilam",
        "bounding_box": "Lat 26.3 to 30.5 N, Lon 80.0 to 88.3 E",
        "default_focus": "Biratnagar, Morang (26.45 N, 87.28 E)",
    }


@router.get("/content")
def get_farmer_content() -> dict[str, object]:
    """Serve verified content-pack records; empty packs are reported as empty."""
    report = validate_content()
    return {
        "status": report["status"],
        "sources": report["source_records"],
        "fertilizer_references": report["fertilizer"],
        "home_remedies": report["remedies"],
        "agrochemical_safety": report["agrochemical_safety"],
        "conversions": report["conversions_data"],
        "skipped": report["skipped"],
        "warnings": report["warnings"],
        "error": report.get("error"),
    }


@router.get("/field-assessment", response_model=FieldAssessmentResponse)
async def assess_field(
    lat: float = Query(..., ge=26.3, le=30.5, description="Latitude in Nepal"),
    lon: float = Query(..., ge=80.0, le=88.3, description="Longitude in Nepal"),
    fertilizer_type: str = Query("Urea", description="Urea, DAP, or Compost/FYM"),
    crop_stage: str = Query("Vegetative / Tillering", description="Crop growth stage"),
    save_money: bool = Query(True, description="Legacy preference; currently has no effect on the decision"),
    sand_percent_override: float | None = Query(None, ge=0, le=100, description="Optional farmer-provided soil texture estimate"),
    field_polygon: str | None = Query(None, max_length=30000, description="Optional JSON array of [longitude, latitude] field boundary coordinates"),
) -> FieldAssessmentResponse:
    power_client = NasaPowerClient()
    cmr_client = NasaCmrGibsClient()
    elevation_client = ElevationClient()
    forecast_client = OpenMeteoForecastClient()
    soil_client = SoilGridsClient()

    # Fetch all data concurrently
    power_res, elev_res, soil_res, forecast_res = await asyncio_gather_safe(
        power_client.get_field_weather_and_history(lat, lon, history_years=10),
        elevation_client.get_field_slope_and_elevation(lat, lon),
        soil_client.get_soil_texture(lat, lon),
        forecast_client.get_5day_rain_forecast(lat, lon),
    )

    # Prefer installed IMERG Late grid cells; use area-weighted polygon coverage when supplied.
    parsed_field_polygon = parse_field_polygon(field_polygon)
    rainfall_observation, rainfall_candidates = resolve_recent_rainfall(
        lat, lon, power_res, hours=72, field_polygon=parsed_field_polygon
    )

    # Evaluate decision engine
    decision_engine = FertilizerDecisionEngine()
    decision_res = decision_engine.evaluate_timing(
        rain_last_72h_mm=rainfall_observation.amount_mm if rainfall_observation.status == "AVAILABLE" else None,
        expected_rain_next_48h_mm=forecast_res.expected_rain_next_48h_mm if forecast_res.freshness.status != "UNAVAILABLE" else None,
        soil_wetness=power_res.latest_surface_wetness,
        sand_percent=sand_percent_override if sand_percent_override is not None else (soil_res.sand_percent if soil_res.freshness.status != "UNAVAILABLE" else None),
        slope_percent=elev_res.slope_percent,
        fertilizer_type=fertilizer_type,
        crop_stage=crop_stage,
        priority_save_money=save_money,
        rainfall_observation=rainfall_observation,
    )

    # Compute climate trend (heavy rain days per season over historical records)
    # Group daily precip by year, count days with precip > 15mm
    yearly_heavy_days: dict[int, int] = {}
    for rec in power_res.historical_daily_records:
        if rec.precip_mm is not None and rec.date:
            yr = int(rec.date[:4])
            # Retain years with valid precipitation but zero heavy-rain days.
            # Omitting them would bias the trend toward years with at least one
            # heavy-rain event and distort the slope and significance test.
            yearly_heavy_days.setdefault(yr, 0)
            if rec.precip_mm >= 15.0:
                yearly_heavy_days[yr] += 1

    sorted_yrs = sorted(yearly_heavy_days.keys())
    counts = [float(yearly_heavy_days[yr]) for yr in sorted_yrs]

    trend_res = TrendEngine.analyze_heavy_rain_trend(sorted_yrs, counts)

    signal_bundle = build_signal_bundle(
        lat, lon, summary=power_res, observation=rainfall_observation
    )
    rain_impact = assess_rain_impact(power_res, forecast_res)
    stress_watch = build_stress_watch(signal_bundle, summary=power_res, impact=rain_impact)

    return FieldAssessmentResponse(
        latitude=lat,
        longitude=lon,
        power_summary=power_res,
        elevation=elev_res,
        soil_texture=soil_res,
        forecast=forecast_res,
        decision=decision_res,
        climate_trend=trend_res,
        rainfall_observation=rainfall_observation,
        signals=signal_bundle,
        rain_agreement=rain_agreement(rainfall_candidates),
        rain_impact=rain_impact,
        stress_watch=stress_watch,
    )


@router.get("/integrations/imerg/status")
async def get_imerg_integration_status(
    probe_lat: float | None = None,
    probe_lon: float | None = None,
) -> dict[str, object]:
    """Report the local IMERG cache state; the API never downloads granules."""
    if (probe_lat is None) != (probe_lon is None):
        raise HTTPException(status_code=422, detail="Provide both probe_lat and probe_lon, or neither.")
    provider = ImergLateProvider()
    ready = provider.is_available
    installed_days = provider.cache.installed_dates(limit=10)
    payload: dict[str, object] = {
        "integration": "GPM IMERG Late daily",
        "status": "CACHE_READY" if ready else "NOT_INSTALLED",
        "used_by_field_assessment": ready,
        "latest_installed_date": installed_days[0].isoformat() if installed_days else None,
        "installed_days": [day.isoformat() for day in installed_days],
        "installed_cells_by_day": provider.cache.cell_counts_by_day(limit=10),
        "supported_streams_in_contract": ["LATE"],
        "message": "Recent IMERG Late cells are cached and used for rainfall screening." if ready else "No fresh IMERG Late cache is installed; field assessment falls back to NASA POWER where available.",
        "next_steps": [] if ready else [
            "Add EARTHDATA_USERNAME and EARTHDATA_PASSWORD to backend/.env.",
            "The backend refreshes IMERG automatically; or run python -m app.cli refresh-data from the backend directory.",
            "Validate the local cache against rain gauges before operational use.",
        ],
    }
    if probe_lat is not None and probe_lon is not None:
        payload["point_probe"] = provider.cache.point_lookup_probe(probe_lat, probe_lon)
    return payload


@router.get("/integrations/imerg/automation")
async def get_imerg_automation_status() -> dict[str, object]:
    """Report the last automatic refresh result; never includes credentials."""
    from app.ingest.automation import read_automation_status

    try:
        payload = read_automation_status()
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {
        "status": "NOT_RUN" if payload is None else payload.get("status"),
        "last_run": payload,
    }


@router.get("/integrations/data-storage")
async def get_data_storage_status(request: Request) -> dict[str, object]:
    """Report Supabase readiness and retention windows without exposing secrets."""
    settings = get_settings()
    report = getattr(request.app.state, "data_storage", None) or {}
    return {
        "postgres": {
            "enabled": settings.postgres_cache_enabled,
            "status": report.get("postgres", "unknown"),
        },
        "storage": {
            "enabled": settings.supabase_storage_enabled,
            "bucket": settings.supabase_storage_bucket if settings.supabase_storage_enabled else None,
            "status": report.get("storage", "unknown"),
            "restored_files": report.get("restored_files", 0),
            "recent_days": settings.supabase_recent_days,
        },
        "retention_windows": {
            "imerg_refresh_days": settings.imerg_refresh_days,
            "imerg_retention_days": settings.imerg_retention_days,
            "api_cache_retention_days": settings.api_cache_retention_days,
            "signal_retention_days": settings.signal_retention_days,
            "supabase_recent_days": settings.supabase_recent_days,
        },
        "error": report.get("error"),
    }


async def asyncio_gather_safe(*coros):
    import asyncio
    return await asyncio.gather(*coros)