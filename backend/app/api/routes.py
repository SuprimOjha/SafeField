from fastapi import APIRouter, Query, HTTPException
import json
import math
from pydantic import BaseModel, Field
from app.schemas import PowerSummaryResponse, SatelliteObservationStatus
from app.services.power_client import NasaPowerClient
from app.services.cmr_gibs_client import NasaCmrGibsClient
from app.services.elevation_client import ElevationClient, ElevationResponse
from app.services.forecast_client import OpenMeteoForecastClient, ForecastResponse
from app.services.soilgrids_client import SoilGridsClient, SoilTextureResponse
from app.stats.trend_engine import TrendEngine, TrendAnalysisResult
from app.decision.fertilizer_engine import FertilizerDecisionEngine, DecisionResult
from app.content_packs.loader import validate_content
from app.services.rainfall import RainfallObservation, RainfallProvenance
from app.services.imerg.provider import ImergLateProvider
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


@router.get("/districts")
async def get_nepal_districts() -> dict[str, str]:
    return {
        "pilot_districts": "Morang, Sunsari, Jhapa, Ilam",
        "bounding_box": "Lat 26.3 to 30.5 N, Lon 80.0 to 88.3 E",
        "default_focus": "Biratnagar, Morang (26.45 N, 87.28 E)",
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
    rainfall_observation = ImergLateProvider().get_recent_rain(lat, lon, 72, parsed_field_polygon)
    if rainfall_observation.status != "AVAILABLE" and power_res.rain_last_72h_mm is not None:
        records = [record for record in power_res.recent_daily_records if record.precip_mm is not None][-3:]
        if len(records) == 3:
            dates = [date.fromisoformat(record.date) for record in records]
            if dates[1] - dates[0] == timedelta(days=1) and dates[2] - dates[1] == timedelta(days=1):
                fetched_at = datetime.fromisoformat(power_res.freshness.fetched_at_utc.replace("Z", "+00:00"))
                rainfall_observation = RainfallObservation(
                    status="AVAILABLE", amount_mm=power_res.rain_last_72h_mm, window_hours=72,
                    provenance=RainfallProvenance(
                        source_name="NASA POWER PRECTOTCORR (fallback when IMERG is unavailable)", kind="fallback",
                        observed_start_utc=datetime.combine(dates[0], time.min, tzinfo=timezone.utc),
                        observed_end_utc=datetime.combine(dates[-1] + timedelta(days=1), time.min, tzinfo=timezone.utc),
                        fetched_at_utc=fetched_at, spatial_resolution=power_res.freshness.spatial_resolution,
                        latency_note="POWER daily reanalysis-based data, typically delayed 2–4 days; not an IMERG observation.",
                        dataset="NASA POWER PRECTOTCORR", version="daily API",
                        units="mm/day summed over three consecutive UTC days",
                        spatial_method="point_grid",
                    ),
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
            if rec.precip_mm >= 15.0:
                yearly_heavy_days[yr] = yearly_heavy_days.get(yr, 0) + 1

    sorted_yrs = sorted(yearly_heavy_days.keys())
    counts = [float(yearly_heavy_days[yr]) for yr in sorted_yrs]

    trend_res = TrendEngine.analyze_heavy_rain_trend(sorted_yrs, counts)

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
    )


@router.get("/integrations/imerg/status")
async def get_imerg_integration_status() -> dict[str, object]:
    """Report the local IMERG cache state; the API never downloads granules."""
    provider = ImergLateProvider()
    ready = provider.is_available
    return {
        "integration": "GPM IMERG Late daily",
        "status": "CACHE_READY" if ready else "NOT_INSTALLED",
        "used_by_field_assessment": ready,
        "supported_streams_in_contract": ["LATE"],
        "message": "Recent IMERG Late cells are cached and used for rainfall screening." if ready else "No fresh IMERG Late cache is installed; field assessment falls back to NASA POWER where available.",
        "next_steps": [] if ready else [
            "Configure NASA Earthdata Login credentials.",
            "Run python -m app.cli fetch-imerg --days 7 from the backend directory.",
            "Validate the local cache against rain gauges before operational use.",
        ],
    }


async def asyncio_gather_safe(*coros):
    import asyncio
    return await asyncio.gather(*coros)