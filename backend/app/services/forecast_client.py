from datetime import datetime, timezone
from typing import Any
from app.cache.sqlite_cache import SQLiteCache
from app.schemas import FreshnessBadge
from app.services.http_client import fetch_json_with_retry, utc_now_iso
from pydantic import BaseModel


class DailyForecastItem(BaseModel):
    date: str
    precipitation_sum_mm: float | None
    precipitation_probability_max: int | None


class ForecastResponse(BaseModel):
    latitude: float
    longitude: float
    freshness: FreshnessBadge
    forecast_days: list[DailyForecastItem]
    expected_rain_next_48h_mm: float | None
    expected_rain_next_120h_mm: float | None
    rain_expected_soon: bool | None  # True if > 5mm expected in next 48-72h


OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_DOCS = "https://open-meteo.com/en/docs"
FORECAST_CACHE_TTL_SECONDS = 3 * 3600  # 3 hours


class OpenMeteoForecastClient:
    """
    Queries 5-day precipitation forecast from Open-Meteo.
    Explicitly badged as Non-NASA with CC BY 4.0 licence.
    """

    def __init__(self, cache: SQLiteCache | None = None) -> None:
        self.cache = cache or SQLiteCache()

    async def get_5day_rain_forecast(self, latitude: float, longitude: float) -> ForecastResponse:
        lat_r = round(latitude, 3)
        lon_r = round(longitude, 3)
        cache_key = f"open_meteo_forecast:{lat_r}:{lon_r}"

        hit = self.cache.get(cache_key, allow_stale=False)
        if hit is not None:
            payload, fetched_at, _ = hit
            parsed = ForecastResponse.model_validate(payload)
            parsed.freshness.status = "CACHED_FALLBACK"
            parsed.freshness.fetched_at_utc = fetched_at
            return parsed

        params = {
            "latitude": lat_r,
            "longitude": lon_r,
            "daily": "precipitation_sum,precipitation_probability_max",
            "timezone": "Asia/Kathmandu",
            "forecast_days": 5,
        }

        try:
            raw = await fetch_json_with_retry(OPEN_METEO_URL, params=params, timeout_seconds=10.0)
            daily_data = raw.get("daily", {})
            dates = daily_data.get("time", [])
            sums = daily_data.get("precipitation_sum", [])
            probs = daily_data.get("precipitation_probability_max", [])

            items: list[DailyForecastItem] = []
            for i, d in enumerate(dates):
                p_sum = float(sums[i]) if i < len(sums) and sums[i] is not None else None
                p_prob = int(probs[i]) if i < len(probs) and probs[i] is not None else None
                items.append(
                    DailyForecastItem(
                        date=str(d),
                        precipitation_sum_mm=round(p_sum, 2) if p_sum is not None else None,
                        precipitation_probability_max=p_prob,
                    )
                )

            next_48h = (
                round(sum(item.precipitation_sum_mm for item in items[:2] if item.precipitation_sum_mm is not None), 2)
                if len(items) >= 2 and all(item.precipitation_sum_mm is not None for item in items[:2])
                else None
            )
            next_120h = (
                round(sum(item.precipitation_sum_mm for item in items[:5] if item.precipitation_sum_mm is not None), 2)
                if len(items) >= 5 and all(item.precipitation_sum_mm is not None for item in items[:5])
                else None
            )
            rain_soon = next_48h > 5.0 if next_48h is not None else None

            fetched_at = utc_now_iso()
            response = ForecastResponse(
                latitude=lat_r,
                longitude=lon_r,
                freshness=FreshnessBadge(
                    dataset_name="Open-Meteo 5-Day Weather Forecast (Non-NASA)",
                    source_org="Open-Meteo / ECMWF / GFS Models (CC BY 4.0)",
                    is_nasa=False,
                    status="LIVE",
                    latest_observation_date=items[0].date if items else None,
                    fetched_at_utc=fetched_at,
                    typical_latency="Real-time hourly updates",
                    spatial_resolution="~9-11 km model grid",
                    caveat=(
                        "NON-NASA FORECAST: Used solely for 2-5 day rain outlook. "
                        "All observed baseline data and climate shift trends remain 100% NASA."
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
            stale = self.cache.get(cache_key, allow_stale=True)
            if stale is not None:
                payload, fetched_at, _ = stale
                parsed = ForecastResponse.model_validate(payload)
                parsed.freshness.status = "CACHED_FALLBACK"
                parsed.freshness.fetched_at_utc = fetched_at
                return parsed

            return ForecastResponse(
                latitude=lat_r,
                longitude=lon_r,
                freshness=FreshnessBadge(
                    dataset_name="Open-Meteo 5-Day Weather Forecast (Non-NASA)",
                    source_org="Open-Meteo",
                    is_nasa=False,
                    status="UNAVAILABLE",
                    latest_observation_date=None,
                    fetched_at_utc=utc_now_iso(),
                    typical_latency="Real-time",
                    spatial_resolution="~10 km",
                    caveat=f"UNAVAILABLE: Forecast API unreachable ({exc}). Relying on NASA observed soil/rain only.",
                    docs_url=OPEN_METEO_DOCS,
                ),
                forecast_days=[],
                expected_rain_next_48h_mm=None,
                expected_rain_next_120h_mm=None,
                rain_expected_soon=None,
            )