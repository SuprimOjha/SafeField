import asyncio
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Query, Request, Response
from pydantic import BaseModel, Field

from app.decision.water_plan import WaterPlanRequest, WaterPlanResult, build_water_plan
from app.schemas import PowerSummaryResponse
from app.services.forecast_client import ForecastResponse, OpenMeteoForecastClient
from app.services.power_client import NasaPowerClient
from app.services.rain_resolution import resolve_recent_rainfall
from app.signals.agreement import SourceAgreement, rain_agreement
from app.signals.field import build_signal_bundle
from app.signals.models import SignalBundle, SourceStatus
from app.signals.rain_impact import RainImpact, assess_rain_impact
from app.signals.status import read_status, status_etag
from app.signals.stress import StressWatch, build_stress_watch


router = APIRouter(prefix="/api", tags=["SafeField signals"])

DataStatusState = Literal["ok", "not_installed", "error"]


class DataStatusResponse(BaseModel):
    status: DataStatusState
    generated_at: datetime | None = None
    sources: dict[str, SourceStatus] = Field(default_factory=dict)
    etag: str | None = None
    message: str | None = None


class FieldSignalsResponse(BaseModel):
    bundle: SignalBundle
    agreement: SourceAgreement
    rain_impact: RainImpact
    stress_watch: StressWatch
    power: PowerSummaryResponse
    forecast: ForecastResponse


@router.get("/data-status", response_model=DataStatusResponse)
def get_data_status(request: Request, response: Response) -> DataStatusResponse | Response:
    """Report the installed data snapshot state and support conditional reads."""
    try:
        status = read_status()
        etag = status_etag()
    except ValueError as exc:
        response.headers["Cache-Control"] = "no-store"
        return DataStatusResponse(status="error", message=str(exc))

    if status is None:
        response.headers["Cache-Control"] = "no-store"
        return DataStatusResponse(
            status="not_installed",
            message="No data status file is installed. Signals that need snapshots will report not_installed.",
        )

    if etag is not None:
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers={"ETag": etag})
        response.headers["ETag"] = etag
    return DataStatusResponse(
        status="ok",
        generated_at=status.generated_at,
        sources=status.sources,
        etag=etag,
    )


@router.get("/field-signals", response_model=FieldSignalsResponse)
async def get_field_signals(
    response: Response,
    lat: float = Query(..., ge=26.3, le=30.5, description="Latitude in Nepal"),
    lon: float = Query(..., ge=80.0, le=88.3, description="Longitude in Nepal"),
) -> FieldSignalsResponse:
    """Return every signal, agreement, rain impact and stress screening for a field."""
    response.headers["Cache-Control"] = "no-store"
    # Upstream calls use ~1.1 km rounded coordinates; the field geometry itself
    # is never required by this endpoint.
    lat_r = round(lat, 2)
    lon_r = round(lon, 2)

    power_client = NasaPowerClient()
    forecast_client = OpenMeteoForecastClient()
    power, forecast = await asyncio.gather(
        power_client.get_field_weather_and_history(lat_r, lon_r, history_years=10),
        forecast_client.get_5day_rain_forecast(lat_r, lon_r),
    )

    observation, candidates = resolve_recent_rainfall(lat_r, lon_r, power, hours=72)
    bundle = build_signal_bundle(lat_r, lon_r, summary=power, observation=observation)
    bundle.warnings.append(
        "Coordinates were rounded to 2 decimals (~1.1 km) before upstream requests; "
        "the field boundary stays on the device."
    )
    agreement = rain_agreement(candidates)
    impact = assess_rain_impact(power, forecast)
    watch = build_stress_watch(bundle, summary=power, impact=impact)
    return FieldSignalsResponse(
        bundle=bundle,
        agreement=agreement,
        rain_impact=impact,
        stress_watch=watch,
        power=power,
        forecast=forecast,
    )


@router.post("/water-plan", response_model=WaterPlanResult)
def post_water_plan(payload: WaterPlanRequest) -> WaterPlanResult:
    """Estimate water-balance timing; returns not_assessed without complete inputs."""
    return build_water_plan(payload)
