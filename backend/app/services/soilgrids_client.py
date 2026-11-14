from typing import Any
from app.cache.sqlite_cache import SQLiteCache
from app.schemas import FreshnessBadge
from app.services.http_client import fetch_json_with_retry, utc_now_iso
from pydantic import BaseModel


class SoilTextureResponse(BaseModel):
    latitude: float
    longitude: float
    clay_percent: float | None
    silt_percent: float | None
    sand_percent: float | None
    texture_class: str
    freshness: FreshnessBadge


SOILGRIDS_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"
SOILGRIDS_DOCS = "https://rest.isric.org/soilgrids/v2.0/docs"
SOILGRIDS_CACHE_TTL = 30 * 86400


def _extract_layer_mean_percent(layer: dict[str, Any]) -> float | None:
    """Convert a SoilGrids texture mean (g/kg, scaled by 10) to percent.

    Missing means stay missing. In particular, they are never replaced by a
    plausible-looking default such as 300 (30%).
    """
    depths = layer.get("depths") or []
    if not depths:
        return None
    raw_value = (depths[0].get("values") or {}).get("mean")
    if raw_value is None:
        return None
    try:
        value = float(raw_value)
    except (TypeError, ValueError):
        return None
    if not 0 <= value <= 1000:
        return None
    return round(value / 10.0, 1)


class SoilGridsClient:
    """Queries ISRIC SoilGrids 250m REST API for 0-5cm texture estimates."""

    def __init__(self, cache: SQLiteCache | None = None) -> None:
        self.cache = cache or SQLiteCache()

    async def get_soil_texture(self, latitude: float, longitude: float) -> SoilTextureResponse:
        lat_r = round(latitude, 4)
        lon_r = round(longitude, 4)
        cache_key = f"soilgrids_texture:{lat_r}:{lon_r}"

        hit = self.cache.get(cache_key, allow_stale=False)
        if hit is not None:
            payload, _, _ = hit
            return SoilTextureResponse.model_validate(payload)

        params = {
            "lat": lat_r,
            "lon": lon_r,
            "property": ["clay", "silt", "sand"],
            "depth": "0-5cm",
            "value": "mean",
        }

        try:
            raw = await fetch_json_with_retry(SOILGRIDS_URL, params=params, timeout_seconds=12.0)
            layers = raw.get("properties", {}).get("layers", [])
            props = {
                layer.get("name"): _extract_layer_mean_percent(layer)
                for layer in layers
                if layer.get("name") in {"clay", "silt", "sand"}
            }

            clay = props.get("clay")
            silt = props.get("silt")
            sand = props.get("sand")
            if clay is None or silt is None or sand is None:
                raise ValueError("SoilGrids omitted one or more valid texture means")

            if sand > 55.0:
                texture_class = "Sandy"
            elif clay > 35.0:
                texture_class = "Clayey"
            else:
                texture_class = "Loamy"

            fetched_at = utc_now_iso()
            response = SoilTextureResponse(
                latitude=lat_r,
                longitude=lon_r,
                clay_percent=clay,
                silt_percent=silt,
                sand_percent=sand,
                texture_class=texture_class,
                freshness=FreshnessBadge(
                    dataset_name="ISRIC SoilGrids 250m Topsoil Properties (0-5cm)",
                    source_org="ISRIC World Soil Information (CC BY 4.0)",
                    is_nasa=False,
                    status="LIVE",
                    latest_observation_date="Global Digital Soil Mapping (2020)",
                    fetched_at_utc=fetched_at,
                    typical_latency="Static global model",
                    spatial_resolution="250 meter",
                    caveat=(
                        "Non-NASA SoilGrids predicted topsoil properties at 250 m. "
                        "These are model estimates, not a field soil test."
                    ),
                    docs_url=SOILGRIDS_DOCS,
                ),
            )
            self.cache.set(cache_key, response.model_dump(), fetched_at, SOILGRIDS_CACHE_TTL)
            return response

        except Exception as exc:
            stale = self.cache.get(cache_key, allow_stale=True)
            if stale is not None:
                payload, fetched_at, _ = stale
                parsed = SoilTextureResponse.model_validate(payload)
                parsed.freshness.status = "CACHED_FALLBACK"
                parsed.freshness.fetched_at_utc = fetched_at
                parsed.freshness.caveat = (
                    f"Showing previously cached SoilGrids estimate because the upstream request failed: {exc}. "
                    + parsed.freshness.caveat
                )
                return parsed

            return SoilTextureResponse(
                latitude=lat_r,
                longitude=lon_r,
                clay_percent=None,
                silt_percent=None,
                sand_percent=None,
                texture_class="Unavailable",
                freshness=FreshnessBadge(
                    dataset_name="ISRIC SoilGrids 250m Topsoil Properties",
                    source_org="ISRIC World Soil Information (CC BY 4.0)",
                    is_nasa=False,
                    status="UNAVAILABLE",
                    latest_observation_date=None,
                    fetched_at_utc=utc_now_iso(),
                    typical_latency="Static global model",
                    spatial_resolution="250 meter",
                    caveat=(
                        f"SoilGrids request failed or returned incomplete data: {exc}. "
                        "No regional or default value is substituted. Confirm locally."
                    ),
                    docs_url=SOILGRIDS_DOCS,
                ),
            )
