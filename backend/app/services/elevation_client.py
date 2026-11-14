import math
import httpx
from typing import Any
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


class ElevationClient:
    """
    Samples Open-Elevation API on a 3x3 stencil; underlying DEM lineage is not asserted.
    """

    def __init__(self, cache: SQLiteCache | None = None) -> None:
        self.cache = cache or SQLiteCache()

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

        # Use Open-Elevation public REST API backed by SRTM/NASADEM 30m data
        url = "https://api.open-elevation.com/api/v1/lookup"
        locations_payload = {"locations": [{"latitude": pt[0], "longitude": pt[1]} for pt in points]}

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response_http = await client.post(url, json=locations_payload)
                response_http.raise_for_status()
                data = response_http.json()
            results = data.get("results", [])
            if len(results) != 9:
                raise ValueError("Incomplete elevation grid returned")

            elevations = [float(r["elevation"]) for r in results]
            center_elev = elevations[4]

            # Compute slope (%) using finite differences
            # dz/dx and dz/dy
            dx = 2.0 * delta * 111320.0 * math.cos(math.radians(lat_r))  # meters per 2*delta lon
            dy = 2.0 * delta * 111100.0                                 # meters per 2*delta lat

            dz_dx = ((elevations[2] + 2 * elevations[5] + elevations[8]) - (elevations[0] + 2 * elevations[3] + elevations[6])) / dx
            dz_dy = ((elevations[6] + 2 * elevations[7] + elevations[8]) - (elevations[0] + 2 * elevations[1] + elevations[2])) / dy

            slope_frac = math.sqrt(dz_dx**2 + dz_dy**2)
            slope_pct = round(slope_frac * 100.0, 1)

            if slope_pct < 2.0:
                category = "Flat (Terai)"
            elif slope_pct < 8.0:
                category = "Gentle Slope"
            elif slope_pct < 20.0:
                category = "Moderate Slope"
            else:
                category = "Steep Hillside"

            fetched_at = utc_now_iso()
            response = ElevationResponse(
                latitude=lat_r,
                longitude=lon_r,
                elevation_meters=round(center_elev, 1),
                slope_percent=slope_pct,
                terrain_category=category,
                freshness=FreshnessBadge(
                    dataset_name="Open-Elevation API (DEM lineage not verified)",
                    source_org="Open-Elevation service",
                    is_nasa=False,
                    status="LIVE",
                    latest_observation_date="Static Terrain Model (2000/2020)",
                    fetched_at_utc=fetched_at,
                    typical_latency="Static dataset (no recent change)",
                    spatial_resolution="Not verified by this integration",
                    caveat="Elevation values are returned by Open-Elevation. Underlying DEM source and effective resolution are not verified; slope is estimated from a local 3x3 stencil.",
                    docs_url="https://open-elevation.com/",
                ),
            )
            self.cache.set(cache_key, response.model_dump(), fetched_at, 30 * 86400)
            return response

        except Exception as exc:
            stale = self.cache.get(cache_key, allow_stale=True)
            if stale is not None:
                payload, fetched_at, _ = stale
                parsed = ElevationResponse.model_validate(payload)
                parsed.freshness.status = "CACHED_FALLBACK"
                parsed.freshness.fetched_at_utc = fetched_at
                parsed.freshness.caveat = (
                    f"Showing previously cached elevation estimate because the upstream request failed: {exc}. "
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
                    dataset_name="NASADEM / SRTM 30m Global Elevation Model",
                    source_org="Open-Elevation service",
                    is_nasa=True,
                    status="CACHED_FALLBACK",
                    latest_observation_date=None,
                    fetched_at_utc=utc_now_iso(),
                    typical_latency="Unknown",
                    spatial_resolution="Unknown",
                    caveat="Elevation service unavailable. No default elevation or slope is substituted.",
                    docs_url="https://lpdaac.usgs.gov/products/nasadem_hgtv001/",
                ),
            )
            return response