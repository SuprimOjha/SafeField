from datetime import date, timedelta
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from water_balance import days_until_trigger, etc_mm, raw_mm, taw_mm


class SourcedNumber(BaseModel):
    """A number that cannot enter the water balance without its origin."""

    model_config = ConfigDict(extra="forbid")

    value: float
    unit: str = Field(min_length=1)
    label: Literal["source", "assumption"]
    source: str = Field(min_length=1)


class WaterPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    awc_mm_per_m: SourcedNumber | None = None
    root_depth_m: SourcedNumber | None = None
    allowed_depletion_fraction: SourcedNumber | None = None
    crop_coefficient_kc: SourcedNumber | None = None
    current_depletion_mm: SourcedNumber | None = None
    et0_forecast_mm: list[SourcedNumber] = Field(default_factory=list)
    rain_forecast_mm: list[SourcedNumber] = Field(default_factory=list)


class WaterPlanResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["not_assessed", "estimated"]
    missing_inputs: list[str] = Field(default_factory=list)
    invalid_inputs: list[str] = Field(default_factory=list)
    taw_mm: float | None = None
    raw_mm: float | None = None
    current_depletion_mm: float | None = None
    days_until_stress: int | None = None
    estimated_stress_date: date | None = None
    inputs: dict[str, Any] = Field(default_factory=dict)
    explanation: str
    disclaimer: str = (
        "FAO-56 style single-crop-coefficient estimate from the supplied inputs. It does not "
        "model runoff, capillary rise, percolation or other stresses and does not recommend "
        "an irrigation amount. Confirm with local extension advice and field observation. "
        "No water, fertilizer or pesticide dose is provided."
    )


_REQUIRED = [
    "awc_mm_per_m",
    "root_depth_m",
    "allowed_depletion_fraction",
    "crop_coefficient_kc",
    "current_depletion_mm",
    "et0_forecast_mm",
]


def _describe(name: str, item: SourcedNumber) -> dict:
    return {
        "value": item.value,
        "unit": item.unit,
        "label": item.label,
        "source": item.source,
    }


def build_water_plan(
    request: WaterPlanRequest,
    start_date: date | None = None,
) -> WaterPlanResult:
    """Return 'not_assessed' unless every required input has a provenance label."""
    missing = [name for name in _REQUIRED if getattr(request, name) in (None, [])]
    if missing:
        return WaterPlanResult(
            status="not_assessed",
            missing_inputs=missing,
            explanation=(
                "The water balance was not assessed because required inputs are missing: "
                + ", ".join(missing)
                + ". Missing inputs are never replaced with default soil, crop or weather values."
            ),
        )

    assert request.awc_mm_per_m is not None
    assert request.root_depth_m is not None
    assert request.allowed_depletion_fraction is not None
    assert request.crop_coefficient_kc is not None
    assert request.current_depletion_mm is not None

    et0 = request.et0_forecast_mm
    rain = request.rain_forecast_mm
    invalid: list[str] = []
    if not rain:
        invalid.append("rain_forecast_mm (an explicit dry forecast must be supplied, not assumed)")
    if len(rain) != len(et0):
        invalid.append(
            f"forecast lengths differ: et0_forecast_mm={len(et0)}, rain_forecast_mm={len(rain)}"
        )

    taw = raw = None
    try:
        taw = taw_mm(request.awc_mm_per_m.value, request.root_depth_m.value)
        raw = raw_mm(taw, request.allowed_depletion_fraction.value)
    except ValueError as exc:
        invalid.append(str(exc))

    if invalid:
        return WaterPlanResult(
            status="not_assessed",
            invalid_inputs=invalid,
            explanation="The water balance was not assessed: " + "; ".join(invalid) + ".",
        )

    assert taw is not None and raw is not None
    if not 0 <= request.current_depletion_mm.value <= taw:
        return WaterPlanResult(
            status="not_assessed",
            invalid_inputs=[
                f"current_depletion_mm must be between 0 and TAW ({taw:.1f} mm)"
            ],
            explanation="The water balance was not assessed because current depletion is outside the root-zone range.",
        )
    if any(item.value < 0 for item in et0) or any(item.value < 0 for item in rain):
        return WaterPlanResult(
            status="not_assessed",
            invalid_inputs=["forecast values must be non-negative"],
            explanation="The water balance was not assessed because a forecast value is negative.",
        )

    etc_series = [etc_mm(request.crop_coefficient_kc.value, item.value) for item in et0]
    days = days_until_trigger(
        request.current_depletion_mm.value,
        raw,
        taw,
        etc_series,
        [item.value for item in rain],
    )
    start = start_date or date.today()
    stress_date = start + timedelta(days=days - 1) if days is not None else None
    if days is not None:
        explanation = (
            f"With the supplied inputs, depletion reaches the management-allowed threshold "
            f"({raw:.1f} mm) on forecast day {days} ({stress_date.isoformat()}). This is an "
            "estimate, not an irrigation schedule; confirm before acting."
        )
    else:
        explanation = (
            "With the supplied inputs, depletion does not reach the management-allowed "
            f"threshold ({raw:.1f} mm) within the {len(et0)}-day forecast. The estimate is "
            "limited by the forecast horizon and the supplied inputs."
        )

    return WaterPlanResult(
        status="estimated",
        taw_mm=round(taw, 2),
        raw_mm=round(raw, 2),
        current_depletion_mm=round(request.current_depletion_mm.value, 2),
        days_until_stress=days,
        estimated_stress_date=stress_date,
        inputs={
            name: _describe(name, getattr(request, name))
            for name in _REQUIRED
            if isinstance(getattr(request, name), SourcedNumber)
        }
        | {
            "et0_forecast_mm": [item.model_dump() for item in et0],
            "rain_forecast_mm": [item.model_dump() for item in rain],
        },
        explanation=explanation,
    )
