from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas import PowerSummaryResponse
from app.services.forecast_client import ForecastResponse
from app.signals.config import SignalGates, get_gates


RainImpactClass = Literal["heavy_recent", "heavy_forecast", "none", "unknown"]


class RainImpact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    classification: RainImpactClass
    rain_24h_mm: float | None = None
    rain_72h_mm: float | None = None
    forecast_48h_mm: float | None = None
    thresholds: dict[str, float]
    summary: str
    assumption_note: str


def assess_rain_impact(
    power: PowerSummaryResponse | None,
    forecast: ForecastResponse | None,
    gates: SignalGates | None = None,
) -> RainImpact:
    """Screen recent and forecast rain without turning missing data into 'none'.

    The depth cut-offs are design assumptions pending agronomist review. The
    underlying rain values are coarse NASA POWER grid estimates, not on-field
    measurements.
    """
    gates = gates or get_gates()
    thresholds = {
        "rain_heavy_24h_mm": gates.rain_heavy_24h_mm,
        "rain_heavy_72h_mm": gates.rain_heavy_72h_mm,
        "rain_heavy_forecast_mm": gates.rain_heavy_forecast_mm,
    }
    assumption_note = (
        "Depth cut-offs are "
        f"{gates.rain_heavy_24h_mm:g} mm in 24 h, {gates.rain_heavy_72h_mm:g} mm in 72 h "
        f"and {gates.rain_heavy_forecast_mm:g} mm forecast in 48 h: "
        f"{gates.assumption_note} They are screening aids, not flood or crop-damage thresholds."
    )

    rain_24h = power.rain_last_24h_mm if power and power.freshness.status != "UNAVAILABLE" else None
    rain_72h = power.rain_last_72h_mm if power and power.freshness.status != "UNAVAILABLE" else None
    forecast_48h = (
        forecast.expected_rain_next_48h_mm
        if forecast and forecast.freshness.status != "UNAVAILABLE"
        else None
    )

    recent_heavy = (
        (rain_24h is not None and rain_24h >= gates.rain_heavy_24h_mm)
        or (rain_72h is not None and rain_72h >= gates.rain_heavy_72h_mm)
    )
    forecast_heavy = forecast_48h is not None and forecast_48h >= gates.rain_heavy_forecast_mm

    if recent_heavy:
        return RainImpact(
            classification="heavy_recent",
            rain_24h_mm=rain_24h,
            rain_72h_mm=rain_72h,
            forecast_48h_mm=forecast_48h,
            thresholds=thresholds,
            summary=(
                "Recent rain reaches the screening depth on the coarse NASA POWER grid. "
                "Check drainage and local field conditions; this is not a flood warning."
            ),
            assumption_note=assumption_note,
        )
    if forecast_heavy:
        return RainImpact(
            classification="heavy_forecast",
            rain_24h_mm=rain_24h,
            rain_72h_mm=rain_72h,
            forecast_48h_mm=forecast_48h,
            thresholds=thresholds,
            summary=(
                "The non-NASA forecast expects rain above the screening depth in the next "
                "48 hours. Recheck before field operations; forecasts can change."
            ),
            assumption_note=assumption_note,
        )
    if rain_24h is None and rain_72h is None and forecast_48h is None:
        return RainImpact(
            classification="unknown",
            thresholds=thresholds,
            summary=(
                "No recent or forecast rain value is available. Missing data is not treated "
                "as dry conditions."
            ),
            assumption_note=assumption_note,
        )
    return RainImpact(
        classification="none",
        rain_24h_mm=rain_24h,
        rain_72h_mm=rain_72h,
        forecast_48h_mm=forecast_48h,
        thresholds=thresholds,
        summary=(
            "Available rain values are below the screening depths. This does not prove that "
            "fields are dry or that irrigation is needed."
        ),
        assumption_note=assumption_note,
    )
