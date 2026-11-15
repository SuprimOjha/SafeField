from datetime import date, datetime, timedelta
from typing import Iterable

from app.schemas import DailyWeatherRecord, PowerSummaryResponse
from app.services.forecast_client import ForecastResponse
from app.signals.anomaly import compute_anomaly
from app.signals.config import SignalGates, get_gates
from app.signals.models import SignalName, SignalProvenance, SignalValue


HEAT_AIR: SignalName = "heat_air"
POWER_SOURCE_KEY = "power"


def _count_hot_days(
    pairs: list[tuple[date, float]],
    threshold_c: float,
    window_days: int,
) -> tuple[int, int]:
    """Count days at or above the screening threshold inside the latest window.

    Missing days are excluded rather than treated as cool days, and the caller
    is told how many days actually had a value.
    """
    if not pairs:
        return 0, 0
    latest = max(day for day, _ in pairs)
    cutoff = latest - timedelta(days=window_days - 1)
    observed = [(day, value) for day, value in pairs if cutoff <= day <= latest]
    hot = sum(1 for _, value in observed if value >= threshold_c)
    return hot, len(observed)


def count_heat_days(
    records: Iterable[DailyWeatherRecord],
    threshold_c: float,
    window_days: int = 7,
) -> tuple[int, int]:
    pairs = [
        (date.fromisoformat(record.date), record.temp_max_c)
        for record in records
        if record.temp_max_c is not None
    ]
    return _count_hot_days(pairs, threshold_c, window_days)


def forecast_heat_days(
    forecast: ForecastResponse,
    threshold_c: float,
    window_days: int | None = None,
) -> tuple[int, int]:
    """Count forecast days above the screening threshold.

    The result is a model forecast, not an observation, and must be labelled as
    such by whatever displays it.
    """
    pairs = [
        (date.fromisoformat(item.date), item.temperature_2m_max_c)
        for item in forecast.forecast_days
        if item.temperature_2m_max_c is not None
    ]
    if window_days is None:
        if not pairs:
            return 0, 0
        window_days = (max(day for day, _ in pairs) - min(day for day, _ in pairs)).days + 1
    return _count_hot_days(pairs, threshold_c, window_days)


def build_heat_air_signal(
    summary: PowerSummaryResponse,
    gates: SignalGates | None = None,
) -> SignalValue:
    """Build the air-temperature heat signal from a NASA POWER summary."""
    gates = gates or get_gates()
    if summary.freshness.status == "UNAVAILABLE":
        return SignalValue(
            name=HEAT_AIR,
            status="unavailable",
            unavailable_reason=(
                "NASA POWER did not return air temperature for this location. "
                + summary.freshness.caveat
            ),
        )

    records = [
        record
        for record in summary.historical_daily_records
        if record.temp_max_c is not None
    ]
    if not records:
        return SignalValue(
            name=HEAT_AIR,
            status="unavailable",
            unavailable_reason="NASA POWER returned no T2M_MAX daily maximum temperature for this location.",
        )

    latest = records[-1]
    latest_date = date.fromisoformat(latest.date)
    cached = summary.freshness.status == "CACHED_FALLBACK"
    hot_days, observed_days = count_heat_days(
        records, gates.heat_day_max_c, window_days=gates.anomaly_window_days
    )
    anomaly = compute_anomaly(
        [(date.fromisoformat(record.date), record.temp_max_c) for record in records],
        latest_date,
        float(latest.temp_max_c),
        gates,
    )

    notes = [
        f"Daily maximum air temperature. In the last {gates.anomaly_window_days} days with a "
        f"value, {hot_days} of {observed_days} reached the {gates.heat_day_max_c:g} °C "
        f"heat-day screening level ({gates.assumption_note})."
    ]
    if cached:
        notes.append("Showing the last cached NASA POWER response; this is not live data.")
    if anomaly.reason:
        notes.append(anomaly.reason)

    return SignalValue(
        name=HEAT_AIR,
        status="stale" if cached else "available",
        value=round(float(latest.temp_max_c), 2),
        unit="°C (daily maximum air temperature at 2 m)",
        vs_normal=anomaly.vs_normal,
        anomaly=anomaly.anomaly,
        baseline=anomaly.baseline,
        baseline_years=anomaly.years_used,
        provenance=_provenance(summary, latest_date, cached),
        quality_note=" ".join(notes),
    )


def _provenance(
    summary: PowerSummaryResponse,
    latest_date: date,
    cached: bool,
) -> SignalProvenance:
    fetched_at = datetime.fromisoformat(summary.freshness.fetched_at_utc.replace("Z", "+00:00"))
    return SignalProvenance(
        source_name=summary.freshness.dataset_name,
        product="NASA POWER Daily Agroclimatology, T2M_MAX",
        # POWER's daily point API does not return a product version; saying so
        # keeps the envelope honest instead of inventing a version string.
        version="not reported by provider",
        source_key=POWER_SOURCE_KEY,
        kind="cached" if cached else "model",
        is_nasa=summary.freshness.is_nasa,
        valid_date=latest_date,
        fetched_at=fetched_at,
        spatial_resolution=summary.freshness.spatial_resolution,
        latency_note=summary.freshness.typical_latency,
        caveat=summary.freshness.caveat,
    )
