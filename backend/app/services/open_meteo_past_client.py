"""Open-Meteo reanalysis past-days rainfall provider.

The IMERG grid cache requires NASA Earthdata credentials plus a manual
`fetch-imerg` run, so hosted deployments usually run without it and the
"Local rainfall" card stays permanently unavailable. This provider returns the
freshest real daily precipitation available without credentials: Open-Meteo's
reanalysis-backed `past_days` daily rain_sum (ERA5 / ECMWF best-match blend,
~9-11 km grid). Totals cover complete UTC days only, carry a true observation
window and honest provenance (kind="model"), and never substitute a guessed
value when the lookup fails.
"""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx

from app.services.rainfall import RainfallObservation, RainfallProvenance

NEPAL_TZ = ZoneInfo("Asia/Kathmandu")
OPEN_METEO_PAST_URL = "https://api.open-meteo.com/v1/forecast"
MAX_CACHE_AGE_DAYS = 5


def _unavailable(window_hours: int, reason: str) -> RainfallObservation:
    return RainfallObservation(
        status="UNAVAILABLE",
        amount_mm=None,
        window_hours=window_hours,
        provenance=None,
        unavailable_reason=reason,
    )


def get_recent_rain_reanalysis(latitude: float, longitude: float, hours: int) -> RainfallObservation:
    if hours <= 0 or hours % 24:
        return _unavailable(hours, "Daily reanalysis rainfall supports whole-day windows only.")
    required_days = hours // 24

    lat_r = round(latitude, 2)
    lon_r = round(longitude, 2)
    params = {
        "latitude": lat_r,
        "longitude": lon_r,
        "daily": "rain_sum",
        "past_days": required_days + 2,
        "forecast_days": 1,
        "timezone": "UTC",
    }

    try:
        response = httpx.get(OPEN_METEO_PAST_URL, params=params, timeout=12.0)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        return _unavailable(
            hours,
            f"Reanalysis rainfall lookup failed ({exc}). No usable local-scale observation "
            "is available for the requested window.",
        )

    daily = payload.get("daily") or {}
    times = daily.get("time") or []
    rain_values = daily.get("rain_sum") or []
    if not isinstance(times, list) or not isinstance(rain_values, list) or len(times) != len(rain_values) or not times:
        return _unavailable(hours, "The reanalysis past-days response was incomplete.")

    today_utc = datetime.now(timezone.utc).date()
    complete_days: list[tuple[date, float | None]] = []
    for raw_time, raw_value in zip(times, rain_values):
        try:
            day = date.fromisoformat(str(raw_time)[:10])
        except (TypeError, ValueError):
            continue
        if day >= today_utc:
            # Today's row is a partial day and is never used.
            continue
        if raw_value is None:
            complete_days.append((day, None))
            continue
        try:
            value = float(raw_value)
        except (TypeError, ValueError):
            complete_days.append((day, None))
            continue
        complete_days.append((day, value if value >= 0 else None))

    complete_days.sort(key=lambda item: item[0])
    selected = complete_days[-required_days:]
    if len(selected) != required_days:
        return _unavailable(
            hours,
            f"The reanalysis archive returned only {len(selected)} complete past day(s); "
            f"{required_days} consecutive days are required.",
        )
    for previous, current in zip(selected, selected[1:]):
        if (current[0] - previous[0]).days != 1:
            return _unavailable(hours, "The reanalysis daily records contain a date gap; no rolling total is reported.")
    if any(value is None for _, value in selected):
        return _unavailable(hours, "The nearest reanalysis grid cell is missing one or more daily precipitation values.")

    newest_age_days = (today_utc - selected[-1][0]).days
    if newest_age_days > MAX_CACHE_AGE_DAYS:
        return _unavailable(hours, "The newest reanalysis day is more than five days old; no stale rainfall total is used.")

    amount = round(sum(value for _, value in selected if value is not None), 2)
    provenance = RainfallProvenance(
        source_name="Open-Meteo Reanalysis Daily Precipitation (non-NASA)",
        kind="model",
        observed_start_utc=datetime.combine(selected[0][0], time.min, tzinfo=timezone.utc),
        observed_end_utc=datetime.combine(selected[-1][0] + timedelta(days=1), time.min, tzinfo=timezone.utc),
        fetched_at_utc=datetime.now(timezone.utc),
        spatial_resolution="~9–11 km reanalysis grid; nearest grid cell to selected point",
        latency_note=(
            "Reanalysis daily totals are produced from weather-model and gauge-blended data "
            "after each UTC day closes; the reported interval is the true observation window, "
            "typically 6–24 hours behind real time."
        ),
        dataset="ERA5 / ECMWF IFS best-match blend (via Open-Meteo)",
        version="Open-Meteo v1 API",
        stream=None,
        granule_ids=[],
        units="mm/day summed over complete UTC days",
        spatial_method="nearest_grid_cell",
        coverage_fraction=None,
    )
    return RainfallObservation(
        status="AVAILABLE",
        amount_mm=amount,
        window_hours=hours,
        provenance=provenance,
        unavailable_reason=None,
    )
