from fastapi import APIRouter, Query, HTTPException
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


router = APIRouter(prefix="/api", tags=["SafeField API"])


class FieldAssessmentResponse(BaseModel):
    latitude: float
    longitude: float
    power_summary: PowerSummaryResponse
    elevation: ElevationResponse
    soil_texture: SoilTextureResponse
    forecast: ForecastResponse
    decision: DecisionResult
    climate_trend: TrendAnalysisResult


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

    # Evaluate decision engine
    decision_engine = FertilizerDecisionEngine()
    decision_res = decision_engine.evaluate_timing(
        rain_last_72h_mm=power_res.rain_last_72h_mm,
        expected_rain_next_48h_mm=forecast_res.expected_rain_next_48h_mm if forecast_res.freshness.status != "UNAVAILABLE" else None,
        soil_wetness=power_res.latest_surface_wetness,
        sand_percent=sand_percent_override if sand_percent_override is not None else (soil_res.sand_percent if soil_res.freshness.status != "UNAVAILABLE" else None),
        slope_percent=elev_res.slope_percent,
        fertilizer_type=fertilizer_type,
        crop_stage=crop_stage,
        priority_save_money=save_money,
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
    )


async def asyncio_gather_safe(*coros):
    import asyncio
    return await asyncio.gather(*coros)