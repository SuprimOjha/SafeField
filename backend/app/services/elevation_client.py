import math
import httpx
from typing import Any
from app.cache import create_cache
from app.cache.sqlite_cache import SQLiteCache
from app.schemas import FreshnessBadge
from app.services.http_client import fetch_json_with_retry, utc_now_iso
from pydantic import BaseModel


class ElevationResponse(BaseModel):
    latitude: float
    longitude: float
    elevation_meters: float | None
    slope_percent: float | None
    terrain_category: str  # "Flat (Terai)", "Gentle Slope", "Moderate Slope", "Steep Hillside"
    freshness: FreshnessBadge


def _slope_from_stencil(elevations: list[float], delta: float, lat_deg: float) -> float:
    """Horn-style 3x3 finite-difference slope (%) from nine stencil elevations."""
    dx = 2.0 * delta * 111320.0 * math.cos(math.radians(lat_deg))  # metres per 2*delta lon
    dy = 2.0 * delta * 111100.0                                    # metres per 2*delta lat

    dz_dx = ((elevations[2] + 2 * elevations[5] + elevations[8]) - (elevations[0] + 2 * elevations[3] + elevations[6])) / dx
    dz_dy = ((elevations[6] + 2 * elevations[7] + elevations[8]) - (elevations[0] + 2 * elevations[1] + elevations[2])) / dy

    slope_frac = math.sqrt(dz_dx**2 + dz_dy**2)
    return round(slope_frac * 100.0, 1)


def _terrain_category(slope_pct: float) -> str:
    if slope_pct < 2.0:
        return "Flat (Terai)"
    if slope_pct < 8.0:
        return "Gentle Slope"
    if slope_pct < 20.0:
        return "Moderate Slope"
    return "Steep Hillside"


async def _fetch_open_meteo_elevations(points: list[tuple[float, float]]) -> list[float]:
    """Fetch elevations from the Open-Meteo Elevation API (Copernicus DEM GLO-90).

    The public Open-Elevation endpoint rate-limits shared cloud IPs (HTTP 429),
    which left terrain data permanently unavailable on hosted deployments.
    Open-Meteo serves up to 100 coordinates per request without a key, so it is
    used as the primary provider; Open-Elevation remains as a fallback.
    """
    latitudes = ",".join(f"{pt[0]:.6f}" for pt in points)
    longitudes = ",".join(f"{pt[1]:.6f}" for pt in points)
    async with httpx.AsyncClient(timeout=10.0) as client:
        response_http = await client.get(
            "https://api.open-meteo.com/v1/elevation",
            params={"latitude": latitudes, "longitude": longitudes},
        )
        response_http.raise_for_status()
        data = response_http.json()
    elevations = data.get("elevation")
    if not isinstance(elevations, list) or len(elevations) != len(points):
        raise ValueError("Open-Meteo elevation grid incomplete")
    values = [float(value) for value in elevations]
    if not all(math.isfinite(value) for value in values):
        raise ValueError("Open-Meteo elevation grid contained non-finite values")
    return values


async def _fetch_open_elevation_elevations(points: list[tuple[float, float]]) -> list[float]:
    url = "https://api.open-elevation.com/api/v1/lookup"
    locations_payload = {"locations": [{"latitude": pt[0], "longitude": pt[1]} for pt in points]}
    async with httpx.AsyncClient(timeout=10.0) as client:
        response_http = await client.post(url, json=locations_payload)
        response_http.raise_for_status()
        data = response_http.json()
    results = data.get("results", [])
    if len(results) != 9:
        raise ValueError("Incomplete elevation grid returned")
    return [float(r["elevation"]) for r in results]


class ElevationClient:
    """
    Samples DEM elevation on a 3x3 stencil (~90 m spacing) for slope estimation.
    Primary provider: Open-Meteo Elevation API (Copernicus DEM GLO-90).
    Fallback provider: Open-Elevation public API. DEM lineage is disclosed per provider.
    """

    def __init__(self, cache: SQLiteCache | None = None) -> None:
        self.cache = cache or create_cache()

    async def get_field_slope_and_elevation(self, latitude: float, longitude: float) -> ElevationResponse:
        lat_r = round(latitude, 4)
        lon_r = round(longitude, 4)
        cache_key = f"elevation_slope:{lat_r}:{lon_r}"

        hit = self.cache.get(cache_key, allow_stale=False)
        if hit is not None:
            payload, _, _ = hit
            return ElevationResponse.model_validate(payload)

        # Sample 3x3 grid with ~0.0008 deg offset (~90m spacing) for slope calculation
        delta = 0.0008
        points = [
            (lat_r + delta, lon_r - delta), (lat_r + delta, lon_r), (lat_r + delta, lon_r + delta),
            (lat_r, lon_r - delta),         (lat_r, lon_r),         (lat_r, lon_r + delta),
            (lat_r - delta, lon_r - delta), (lat_r - delta, lon_r), (lat_r - delta, lon_r + delta),
        ]

        providers = [
            {
                "name": "Open-Meteo Elevation API",
                "dataset": "Copernicus DEM GLO-90 (via Open-Meteo Elevation API)",
                "docs_url": "https://open-meteo.com/en/docs/elevation-api",
                "fetch": lambda: _fetch_open_meteo_elevations(points),
            },
            {
                "name": "Open-Elevation service",
                "dataset": "Open-Elevation API (DEM lineage not verified)",
                "docs_url": "https://open-elevation.com/",
                "fetch": lambda: _fetch_open_elevation_elevations(points),
            },
        ]

        last_exc: Exception | None = None
        for provider in providers:
            try:
                elevations = await provider["fetch"]()  # type: ignore[operator]
                center_elev = elevations[4]
                slope_pct = _slope_from_stencil(elevations, delta, lat_r)
                category = _terrain_category(slope_pct)

                fetched_at = utc_now_iso()
                response = ElevationResponse(
                    latitude=lat_r,
                    longitude=lon_r,
                    elevation_meters=round(center_elev, 1),
                    slope_percent=slope_pct,
                    terrain_category=category,
                    freshness=FreshnessBadge(
                        dataset_name=provider["dataset"],
                        source_org=provider["name"],
                        is_nasa=False,
                        status="LIVE",
                        latest_observation_date="Static Terrain Model (Copernicus DEM GLO-90, 2019–2021 release)",
                        fetched_at_utc=fetched_at,
                        typical_latency="Static dataset (no recent change)",
                        spatial_resolution="90 m grid cells sampled on a 3x3 stencil",
                        caveat=(
                            f"Elevation values are returned by {provider['name']} (Copernicus DEM GLO-90). "
                            "Slope is estimated from a local 3x3 stencil; it is a terrain model estimate, "
                            "not a surveyed field measurement."
                        ),
                        docs_url=provider["docs_url"],
                    ),
                )
                self.cache.set(cache_key, response.model_dump(), fetched_at, 30 * 86400)
                return response
            except Exception as exc:
                last_exc = exc

        stale = self.cache.get(cache_key, allow_stale=True)
        if stale is not None:
            payload, fetched_at, _ = stale
            parsed = ElevationResponse.model_validate(payload)
            parsed.freshness.status = "CACHED_FALLBACK"
            parsed.freshness.fetched_at_utc = fetched_at
            parsed.freshness.caveat = (
                f"Showing previously cached elevation estimate because the upstream request failed: {last_exc}. "
                + parsed.freshness.caveat
            )
            return parsed

        # Do not substitute guessed elevation or slope when no verified result exists.
        response = ElevationResponse(
            latitude=lat_r,
            longitude=lon_r,
            elevation_meters=None,
            slope_percent=None,
            terrain_category="Unavailable",
            freshness=FreshnessBadge(
                dataset_name="Copernicus DEM GLO-90 Global Elevation Model",
                source_org="Open-Meteo Elevation API / Open-Elevation service",
                is_nasa=False,
                status="UNAVAILABLE",
                latest_observation_date=None,
                fetched_at_utc=utc_now_iso(),
                typical_latency="Unknown",
                spatial_resolution="Unknown",
                caveat=f"Elevation service unavailable: {last_exc}. No default elevation or slope is substituted.",
                docs_url="https://open-meteo.com/en/docs/elevation-api",
            ),
        )
        return response
