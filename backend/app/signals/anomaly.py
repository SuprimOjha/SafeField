from datetime import date
from statistics import fmean, median

from pydantic import BaseModel

from app.signals.config import SignalGates
from app.signals.models import VsNormal


class AnomalyResult(BaseModel):
    vs_normal: VsNormal
    baseline: float | None = None
    anomaly: float | None = None
    years_used: int = 0
    percentile_rank: float | None = None
    reason: str | None = None


def _calendar_distance(left: date, right: date) -> int:
    left_day = left.timetuple().tm_yday
    right_day = right.timetuple().tm_yday
    difference = abs(left_day - right_day)
    # Compare the same calendar window across years without wrapping at New Year.
    return min(difference, 366 - difference)


def _rank_percentile(value: float, baseline: list[float]) -> float:
    below = sum(1 for item in baseline if item < value)
    equal = sum(1 for item in baseline if item == value)
    return 100.0 * (below + 0.5 * equal) / len(baseline)


def classify_percentile(percentile: float, gates: SignalGates) -> VsNormal:
    if percentile <= gates.much_below_percentile:
        return "much_below"
    if percentile <= gates.below_percentile:
        return "below"
    if percentile < gates.above_percentile:
        return "near_normal"
    if percentile < gates.much_above_percentile:
        return "above"
    return "much_above"


def compute_anomaly(
    series: list[tuple[date, float | None]],
    target_date: date,
    target_value: float | None,
    gates: SignalGates,
) -> AnomalyResult:
    """Compare a value with the same calendar window in previous years.

    The baseline is the median of yearly means inside the window. A year only
    contributes when it has at least one valid value. The target year is
    excluded so the value cannot be compared with itself.
    """
    yearly_values: dict[int, list[float]] = {}
    for observed_date, value in series:
        if value is None:
            continue
        if observed_date.year == target_date.year:
            continue
        if _calendar_distance(observed_date, target_date) > gates.anomaly_window_days:
            continue
        yearly_values.setdefault(observed_date.year, []).append(value)

    baseline = [fmean(values) for values in yearly_values.values()]
    years_used = len(baseline)
    if years_used < gates.anomaly_min_years:
        return AnomalyResult(
            vs_normal="unknown",
            years_used=years_used,
            reason=(
                f"Not enough prior years for a normal: {years_used} year(s) with data "
                f"inside the ±{gates.anomaly_window_days}-day calendar window; "
                f"{gates.anomaly_min_years} are required."
            ),
        )
    if target_value is None:
        return AnomalyResult(
            vs_normal="unknown",
            baseline=round(median(baseline), 3),
            years_used=years_used,
            reason="No current value is available to compare with the normal.",
        )

    percentile = _rank_percentile(target_value, baseline)
    baseline_median = median(baseline)
    return AnomalyResult(
        vs_normal=classify_percentile(percentile, gates),
        baseline=round(baseline_median, 3),
        anomaly=round(target_value - baseline_median, 3),
        years_used=years_used,
        percentile_rank=round(percentile, 1),
        reason=(
            f"Compared with {years_used} prior year(s) within ±{gates.anomaly_window_days} "
            f"calendar days. Versus-normal class is a software classification "
            f"assumption, not an agronomic threshold."
        ),
    )
