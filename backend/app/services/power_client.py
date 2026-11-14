from datetime import date, datetime, timedelta, timezone
from typing import Any
from app.cache.sqlite_cache import SQLiteCache
from app.schemas import DailyWeatherRecord, FreshnessBadge, PowerSummaryResponse
from app.services.http_client import fetch_json_with_retry, utc_now_iso


POWER_DAILY_ENDPOINT = "https://power.larc.nasa.gov/api/temporal/daily/point"
POWER_DOCS_URL = "https://power.larc.nasa.gov/docs/services/api/"
POWER_FILL_THRESHOLD = -900.0  # NASA POWER uses -999 for missing/unassimilated days
POWER_CACHE_TTL_SECONDS = 6 * 3600  # 6 hours


def _clean_power_val(raw: Any) -> float | None:
    if raw is None:
        return None
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None
    if val <= POWER_FILL_THRESHOLD:
        return None
    return round(val, 3)


def _format_yyyymmdd_to_iso(yyyymmdd: str) -> str:
    return f"{yyyymmdd[0:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:8]}"


class NasaPowerClient:
    """Client for NASA POWER Agroclimatology (AG) daily point observations."""

    def __init__(self, cache: SQLiteCache | None = None) -> None:
        self.cache = cache or SQLiteCache()

    async def get_field_weather_and_history(
        self,
        latitude: float,
        longitude: float,
        history_years: int = 30,
    ) -> PowerSummaryResponse:
        # Round coordinates to 2 decimals (~1.1 km) for cache efficiency; POWER grid is ~55 km
        lat_r = round(latitude, 2)
        lon_r = round(longitude, 2)
        cache_key = f"nasa_power_daily:{lat_r}:{lon_r}:y{history_years}"

        fresh_hit = self.cache.get(cache_key, allow_stale=False)
        if fresh_hit is not None:
            payload, fetched_at, _ = fresh_hit
            parsed = PowerSummaryResponse.model_validate(payload)
            parsed.freshness.status = "CACHED_FALLBACK"
            parsed.freshness.fetched_at_utc = fetched_at
            return parsed

        today_utc = datetime.now(timezone.utc).date()
        start_year = max(1981, today_utc.year - history_years)
        start_str = f"{start_year}0101"
        end_str = today_utc.strftime("%Y%m%d")

        params = {
            "parameters": "PRECTOTCORR,T2M,GWETTOP,GWETROOT",
            "community": "AG",
            "longitude": lon_r,
            "latitude": lat_r,
            "start": start_str,
            "end": end_str,
            "format": "JSON",
        }

        try:
            raw_json = await fetch_json_with_retry(POWER_DAILY_ENDPOINT, params=params, timeout_seconds=20.0)
            fetched_at = utc_now_iso()
            summary = self._parse_power_response(lat_r, lon_r, raw_json, fetched_at, status="LIVE")
            self.cache.set(cache_key, summary.model_dump(), fetched_at, POWER_CACHE_TTL_SECONDS)
            return summary
        except Exception as exc:
            stale_hit = self.cache.get(cache_key, allow_stale=True)
            if stale_hit is not None:
                payload, fetched_at, _ = stale_hit
                parsed = PowerSummaryResponse.model_validate(payload)
                parsed.freshness.status = "CACHED_FALLBACK"
                parsed.freshness.fetched_at_utc = fetched_at
                parsed.freshness.caveat = (
                    f"Showing cached NASA POWER data (upstream unreachable: {exc}). "
                    + parsed.freshness.caveat
                )
                return parsed

            return PowerSummaryResponse(
                latitude=lat_r,
                longitude=lon_r,
                freshness=FreshnessBadge(
                    dataset_name="NASA POWER Daily Agroclimatology (MERRA-2 / GEOS-IT)",
                    source_org="NASA Langley Research Center (LaRC)",
                    is_nasa=True,
                    status="UNAVAILABLE",
                    latest_observation_date=None,
                    fetched_at_utc=utc_now_iso(),
                    typical_latency="2-4 days",
                    spatial_resolution="0.5° x 0.625° (~55 km grid)",
                    caveat=f"UNAVAILABLE: Could not reach NASA POWER API ({exc}).",
                    docs_url=POWER_DOCS_URL,
                ),
                rain_last_24h_mm=None,
                rain_last_72h_mm=None,
                latest_surface_wetness=None,
                latest_root_wetness=None,
                latest_temp_c=None,
                recent_daily_records=[],
                historical_daily_records=[],
            )

    def _parse_power_response(
        self,
        latitude: float,
        longitude: float,
        raw_json: dict[str, Any],
        fetched_at_utc: str,
        status: str,
    ) -> PowerSummaryResponse:
        param_block = raw_json.get("properties", {}).get("parameter", {})
        precip_map: dict[str, Any] = param_block.get("PRECTOTCORR", {})
        temp_map: dict[str, Any] = param_block.get("T2M", {})
        gwettop_map: dict[str, Any] = param_block.get("GWETTOP", {})
        gwetroot_map: dict[str, Any] = param_block.get("GWETROOT", {})

        all_dates = sorted(precip_map.keys())
        records: list[DailyWeatherRecord] = []

        for d_str in all_dates:
            p_val = _clean_power_val(precip_map.get(d_str))
            t_val = _clean_power_val(temp_map.get(d_str))
            top_val = _clean_power_val(gwettop_map.get(d_str))
            root_val = _clean_power_val(gwetroot_map.get(d_str))

            # Skip trailing dates where NASA POWER has not yet assimilated data (-999)
            if p_val is None and t_val is None and top_val is None:
                continue

            records.append(
                DailyWeatherRecord(
                    date=_format_yyyymmdd_to_iso(d_str),
                    precip_mm=p_val,
                    temp_c=t_val,
                    surface_soil_wetness=top_val,
                    root_soil_wetness=root_val,
                )
            )

        latest_date: str | None = records[-1].date if records else None
        recent_records = records[-14:] if records else []

        # Compute recent 24h (latest valid day) and 72h (latest 3 valid days) rainfall
        valid_precip_days = [r for r in records[-7:] if r.precip_mm is not None]
        rain_24h = round(valid_precip_days[-1].precip_mm, 2) if len(valid_precip_days) >= 1 else None
        # Only call this a three-day total when the latest three valid records
        # are consecutive calendar days. POWER's newest record may itself be delayed.
        rain_72h = None
        if len(valid_precip_days) >= 3:
            last_three = valid_precip_days[-3:]
            dates = [date.fromisoformat(record.date) for record in last_three]
            if dates[1] - dates[0] == timedelta(days=1) and dates[2] - dates[1] == timedelta(days=1):
                rain_72h = round(sum(record.precip_mm for record in last_three if record.precip_mm is not None), 2)

        latest_rec = records[-1] if records else None

        return PowerSummaryResponse(
            latitude=latitude,
            longitude=longitude,
            freshness=FreshnessBadge(
                dataset_name="NASA POWER Daily Agroclimatology (PRECTOTCORR, T2M, GWETTOP, GWETROOT)",
                source_org="NASA Langley Research Center (LaRC)",
                is_nasa=True,
                status=status,  # type: ignore[arg-type]
                latest_observation_date=latest_date,
                fetched_at_utc=fetched_at_utc,
                typical_latency="2-4 days (gridded assimilation lag)",
                spatial_resolution="0.5° x 0.625° (~55 km grid cell)",
                caveat=(
                    "Gridded reanalysis/satellite-assimilated model output (~55 km cell), "
                    "not an on-farm rain gauge or soil probe."
                ),
                docs_url=POWER_DOCS_URL,
            ),
            rain_last_24h_mm=rain_24h,
            rain_last_72h_mm=rain_72h,
            latest_surface_wetness=latest_rec.surface_soil_wetness if latest_rec else None,
            latest_root_wetness=latest_rec.root_soil_wetness if latest_rec else None,
            latest_temp_c=latest_rec.temp_c if latest_rec else None,
            recent_daily_records=recent_records,
            historical_daily_records=records,
        )