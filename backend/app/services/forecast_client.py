import logging
import math
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from app.cache import create_cache
from app.cache.sqlite_cache import SQLiteCache
from app.schemas import FreshnessBadge
from app.services.http_client import fetch_json_with_retry, utc_now_iso


NEPAL_TZ = ZoneInfo("Asia/Kathmandu")


class DailyForecastItem(BaseModel):
    date: str
    precipitation_sum_mm: float | None
    precipitation_probability_max: int | None
    temperature_2m_max_c: float | None = None
    temperature_2m_min_c: float | None = None
    wind_speed_10m_max_kmh: float | None = None
    weather_code: int | None = None
    precipitation_hours: float | None = None


class ForecastResponse(BaseModel):
    latitude: float
    longitude: float
    freshness: FreshnessBadge
    forecast_days: list[DailyForecastItem]
    expected_rain_next_48h_mm: float | None
    expected_rain_next_120h_mm: float | None
    rain_expected_soon: bool | None


OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_DOCS = "https://open-meteo.com/en/docs"
FORECAST_CACHE_TTL_SECONDS = 3 * 3600  # Open-Meteo models update several times daily
RATE_LIMIT_COOLDOWN_SECONDS = 30 * 60
logger = logging.getLogger(__name__)


def _finite_number(values: list, index: int, minimum: float | None = None, maximum: float | None = None) -> float | None:
    if index >= len(values) or values[index] is None:
        return None
    try:
        value = float(values[index])
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value):
        return None
    if minimum is not None and value < minimum:
        return None
    if maximum is not None and value > maximum:
        return None
    return value


def _hourly_total(hourly: dict, window_hours: int) -> float | None:
    """Sum complete future hourly precipitation periods in Nepal local time."""
    times = hourly.get("time", [])
    precipitation = hourly.get("precipitation", [])
    if not isinstance(times, list) or not isinstance(precipitation, list):
        return None

    now = datetime.now(NEPAL_TZ)
    current_hour = now.replace(minute=0, second=0, microsecond=0)
    # Hourly precipitation is accumulated over the hour ending at its timestamp.
    # If now is part-way through an hour, skip that partially elapsed interval.
    first_future_hour = current_hour + timedelta(hours=1 if now.minute == 0 and now.second == 0 else 2)
    future_values: list[tuple[datetime, float | None]] = []

    for index, raw_time in enumerate(times):
        try:
            timestamp = datetime.fromisoformat(str(raw_time))
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=NEPAL_TZ)
            else:
                timestamp = timestamp.astimezone(NEPAL_TZ)
        except (TypeError, ValueError):
            continue
        if timestamp < first_future_hour:
            continue
        value = _finite_number(precipitation, index, minimum=0)
        future_values.append((timestamp, value))

    future_values.sort(key=lambda item: item[0])
    window = future_values[:window_hours]
    # Never turn missing/non-consecutive hourly periods into zero precipitation.
    if len(window) != window_hours or any(value is None for _, value in window):
        return None
    for previous, current in zip(window, window[1:]):
        if current[0] - previous[0] != timedelta(hours=1):
            return None
    return round(sum(value for _, value in window if value is not None), 2)


class OpenMeteoForecastClient:
    """Five-day non-NASA forecast client with cached responses and honest failure states."""

    def __init__(self, cache: SQLiteCache | None = None) -> None:
        self.cache = cache or create_cache()

    async def get_5day_rain_forecast(self, latitude: float, longitude: float) -> ForecastResponse:
        # Open-Meteo's forecast grid is roughly 9–11 km. Two-decimal cache keys
        # avoid a new upstream request for every tiny marker movement.
        lat_r = round(latitude, 2)
        lon_r = round(longitude, 2)
        cache_key = f"open_meteo_forecast:{lat_r}:{lon_r}"

        hit = self.cache.get(cache_key, allow_stale=False)
        if hit is not None:
            payload, fetched_at, _ = hit
            parsed = ForecastResponse.model_validate(payload)
            if parsed.freshness.status == "LIVE":
                parsed.freshness.status = "CACHED_FALLBACK"
            parsed.freshness.fetched_at_utc = fetched_at
            return parsed

        params = {
            "latitude": lat_r,
            "longitude": lon_r,
            "daily": (
                "precipitation_sum,precipitation_probability_max,"
                "temperature_2m_max,temperature_2m_min,wind_speed_10m_max,"
                "weather_code,precipitation_hours"
            ),
            "hourly": "precipitation",
            "forecast_days": 5,
            # A little extra hourly range ensures 120 complete future hours
            # remain available after excluding the currently in-progress hour.
            "forecast_hours": 126,
            "timezone": "Asia/Kathmandu",
            "cell_selection": "land",
        }

        try:
            raw = await fetch_json_with_retry(OPEN_METEO_URL, params=params, timeout_seconds=12.0)
            daily_data = raw.get("daily", {})
            dates = daily_data.get("time", [])
            if not isinstance(dates, list) or len(dates) != 5:
                raise ValueError("Open-Meteo did not return exactly five daily forecast dates")

            def values_for(key: str) -> list:
                value = daily_data.get(key, [])
                return value if isinstance(value, list) else []

            sums = values_for("precipitation_sum")
            probabilities = values_for("precipitation_probability_max")
            max_temps = values_for("temperature_2m_max")
            min_temps = values_for("temperature_2m_min")
            max_winds = values_for("wind_speed_10m_max")
            weather_codes = values_for("weather_code")
            precipitation_hours = values_for("precipitation_hours")

            items: list[DailyForecastItem] = []
            for index, forecast_date in enumerate(dates):
                precip = _finite_number(sums, index, minimum=0)
                probability = _finite_number(probabilities, index, minimum=0, maximum=100)
                weather_code_value = _finite_number(weather_codes, index, minimum=0, maximum=99)
                items.append(
                    DailyForecastItem(
                        date=str(forecast_date),
                        precipitation_sum_mm=round(precip, 2) if precip is not None else None,
                        precipitation_probability_max=int(probability) if probability is not None else None,
                        temperature_2m_max_c=_finite_number(max_temps, index),
                        temperature_2m_min_c=_finite_number(min_temps, index),
                        wind_speed_10m_max_kmh=_finite_number(max_winds, index, minimum=0),
                        weather_code=int(weather_code_value) if weather_code_value is not None else None,
                        precipitation_hours=_finite_number(precipitation_hours, index, minimum=0, maximum=24),
                    )
                )

            hourly_data = raw.get("hourly", {})
            if not isinstance(hourly_data, dict):
                hourly_data = {}
            next_48h = _hourly_total(hourly_data, 48)
            next_120h = _hourly_total(hourly_data, 120)
            rain_soon = next_48h > 5.0 if next_48h is not None else None

            fetched_at = utc_now_iso()
            response = ForecastResponse(
                latitude=float(raw.get("latitude", lat_r)),
                longitude=float(raw.get("longitude", lon_r)),
                freshness=FreshnessBadge(
                    dataset_name="Open-Meteo 5-Day Weather Forecast (Non-NASA)",
                    source_org="Open-Meteo weather models",
                    is_nasa=False,
                    status="LIVE",
                    latest_observation_date=items[0].date,
                    fetched_at_utc=fetched_at,
                    typical_latency="Frequently updated forecast model runs",
                    spatial_resolution="~9–11 km model grid; selected land cell",
                    caveat=(
                        "NON-NASA MODEL FORECAST. Daily values are model estimates for the selected "
                        "grid cell, not field observations. Precipitation includes rain, showers and "
                        "snow; verify important decisions against local conditions."
                    ),
                    docs_url=OPEN_METEO_DOCS,
                ),
                forecast_days=items,
                expected_rain_next_48h_mm=next_48h,
                expected_rain_next_120h_mm=next_120h,
                rain_expected_soon=rain_soon,
            )
            self.cache.set(cache_key, response.model_dump(), fetched_at, FORECAST_CACHE_TTL_SECONDS)
            return response

        except Exception as exc:
            logger.warning(
                "Open-Meteo forecast request failed for cache location %.2f, %.2f: %s",
                lat_r,
                lon_r,
                exc,
            )
            stale = self.cache.get(cache_key, allow_stale=True)
            if stale is not None:
                payload, fetched_at, _ = stale
                parsed = ForecastResponse.model_validate(payload)
                if parsed.forecast_days:
                    parsed.freshness.status = "CACHED_FALLBACK"
                    parsed.freshness.fetched_at_utc = fetched_at
                    parsed.freshness.caveat += " Showing the last successful forecast because the provider is currently unavailable."
                    return parsed

            is_rate_limited = "429" in str(exc) or "too many requests" in str(exc).lower()
            if is_rate_limited:
                caveat = (
                    "Open-Meteo is temporarily rate limiting requests (HTTP 429). "
                    "No forecast value is assumed. Check local weather and try again later."
                )
                negative_cache_ttl = RATE_LIMIT_COOLDOWN_SECONDS
            else:
                caveat = (
                    "Open-Meteo did not return a usable forecast. No forecast value is assumed. "
                    "Check local weather and try again later."
                )
                negative_cache_ttl = 5 * 60

            unavailable = ForecastResponse(
                latitude=lat_r,
                longitude=lon_r,
                freshness=FreshnessBadge(
                    dataset_name="Open-Meteo 5-Day Weather Forecast (Non-NASA)",
                    source_org="Open-Meteo",
                    is_nasa=False,
                    status="UNAVAILABLE",
                    latest_observation_date=None,
                    fetched_at_utc=utc_now_iso(),
                    typical_latency="Frequently updated forecast model runs",
                    spatial_resolution="~9–11 km model grid; selected land cell",
                    caveat=caveat,
                    docs_url=OPEN_METEO_DOCS,
                ),
                forecast_days=[],
                expected_rain_next_48h_mm=None,
                expected_rain_next_120h_mm=None,
                rain_expected_soon=None,
            )
            # Negative-cache failures to avoid repeatedly hitting an upstream 429.
            self.cache.set(cache_key, unavailable.model_dump(), utc_now_iso(), negative_cache_ttl)
            return unavailable
