from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas import PowerSummaryResponse
from app.signals.config import SignalGates, get_gates
from app.signals.heat import count_heat_days
from app.signals.models import SignalBundle, SignalValue
from app.signals.rain_impact import RainImpact


StressFactorName = Literal["water", "heat", "vegetation", "rain"]
FactorState = Literal["watch", "no_watch", "unknown"]
OverallState = Literal["watch", "no_watch", "unknown"]


class StressFactor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    factor: StressFactorName
    state: FactorState
    evidence: list[str] = Field(default_factory=list)
    reason: str


class StressWatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    overall: OverallState
    factors: list[StressFactor]
    summary: str
    disclaimer: str = (
        "Screening only. This is not a crop diagnosis, does not rule out stress, and is not "
        "a recommendation to apply water, fertilizer or pesticide. Confirm with local "
        "observation and a qualified extension worker."
    )


_BELOW = {"below", "much_below"}
_ABOVE = {"above", "much_above"}


def _state_from_signals(
    signals: list[SignalValue],
    watching: set[str],
) -> tuple[FactorState, list[str], str]:
    if not signals:
        return "unknown", [], "No signal was supplied for this factor."
    evidence: list[str] = []
    unavailable: list[str] = []
    for signal in signals:
        if signal.status in {"unavailable", "not_installed"}:
            unavailable.append(f"{signal.name}: {signal.unavailable_reason}")
            continue
        if signal.vs_normal in watching:
            day = signal.provenance.valid_date.isoformat() if signal.provenance and signal.provenance.valid_date else "unknown date"
            evidence.append(f"{signal.name} is {signal.vs_normal.replace('_', ' ')} vs normal (valid {day}).")
    if evidence:
        return "watch", evidence, "At least one available signal is outside the local normal range."
    missing_or_unknown = [
        signal.name
        for signal in signals
        if signal.status in {"unavailable", "not_installed"} or signal.vs_normal == "unknown"
    ]
    if missing_or_unknown:
        return (
            "unknown",
            unavailable,
            "Versus-normal status is unknown or unavailable for: "
            + ", ".join(missing_or_unknown)
            + ". Missing data is not treated as normal.",
        )
    return "no_watch", [], "Available signals are inside the local normal range."


def build_stress_watch(
    bundle: SignalBundle,
    summary: PowerSummaryResponse | None = None,
    impact: RainImpact | None = None,
    gates: SignalGates | None = None,
) -> StressWatch:
    """Combine signal classes into a conservative screening watch.

    A watch means the available indicators merit a field check. No watch means
    only that the available indicators did not cross the software classes; it
    never certifies the crop as healthy.
    """
    gates = gates or get_gates()
    factors: list[StressFactor] = []

    water_signals = [
        signal
        for signal in (bundle.signal("soil_moisture_root"), bundle.signal("soil_moisture_surface"))
        if signal is not None
    ]
    water_state, water_evidence, water_reason = _state_from_signals(water_signals, _BELOW)
    factors.append(
        StressFactor(
            factor="water",
            state=water_state,
            evidence=water_evidence,
            reason=water_reason,
        )
    )

    heat_signals = [
        signal for signal in (bundle.signal("heat_air"),) if signal is not None
    ]
    heat_state, heat_evidence, heat_reason = _state_from_signals(heat_signals, _ABOVE)
    hot_days: int | None = None
    observed_days = 0
    if summary is not None and summary.freshness.status != "UNAVAILABLE":
        hot_days, observed_days = count_heat_days(
            summary.historical_daily_records,
            gates.heat_day_max_c,
            window_days=gates.anomaly_window_days,
        )
        if hot_days > 0:
            heat_state = "watch"
            heat_evidence.append(
                f"{hot_days} of {observed_days} recent days reached the "
                f"{gates.heat_day_max_c:g} °C heat-day screening level "
                f"({gates.assumption_note})."
            )
            heat_reason = "Recent daily maximum air temperature crossed the screening level."
    if heat_state != "watch":
        surface = bundle.signal("heat_surface")
        if surface is not None and surface.vs_normal in _ABOVE:
            heat_state = "watch"
            heat_evidence.append(
                f"Daytime surface skin temperature is {surface.vs_normal.replace('_', ' ')} "
                "vs normal (a surface quantity, not air temperature)."
            )
            heat_reason = "Surface temperature is above the local normal range; check the crop."
    factors.append(
        StressFactor(
            factor="heat",
            state=heat_state,
            evidence=heat_evidence,
            reason=heat_reason,
        )
    )

    veg_signals = [signal for signal in (bundle.signal("ndvi"),) if signal is not None]
    veg_state, veg_evidence, veg_reason = _state_from_signals(veg_signals, _BELOW)
    factors.append(
        StressFactor(
            factor="vegetation",
            state=veg_state,
            evidence=veg_evidence,
            reason=veg_reason,
        )
    )

    if impact is None:
        rain_state: FactorState = "unknown"
        rain_reason = "Rain impact was not assessed for this field."
    elif impact.classification in {"heavy_recent", "heavy_forecast"}:
        rain_state = "watch"
        rain_reason = impact.summary
    elif impact.classification == "none":
        rain_state = "no_watch"
        rain_reason = impact.summary
    else:
        rain_state = "unknown"
        rain_reason = impact.summary
    factors.append(
        StressFactor(
            factor="rain",
            state=rain_state,
            evidence=[impact.summary] if impact is not None else [],
            reason=rain_reason,
        )
    )

    states = [factor.state for factor in factors]
    if "watch" in states:
        overall: OverallState = "watch"
        summary_text = (
            "At least one screening factor flagged a reason to check the field. "
            "This is not a diagnosis and does not prescribe an input."
        )
    elif "unknown" in states:
        overall = "unknown"
        summary_text = (
            "No factor flagged a watch, but some signals are unavailable or lack a local "
            "normal. Missing data is not treated as normal."
        )
    else:
        overall = "no_watch"
        summary_text = (
            "No screening factor crossed its class using the available signals. This does "
            "not certify the crop as healthy or stress-free."
        )

    return StressWatch(overall=overall, factors=factors, summary=summary_text)
