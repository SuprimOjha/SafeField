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
    texture_class: str  # "Sandy", "Loamy", "Clayey"
    freshness: FreshnessBadge


SOILGRIDS_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"
SOILGRIDS_DOCS = "https://rest.isric.org/soilgrids/v2.0/docs"
SOILGRIDS_CACHE_TTL = 30 * 86400  # 30 days


class SoilGridsClient:
    """Queries ISRIC SoilGrids 250m REST API for topsoil (0-5cm) sand/silt/clay fractions."""

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

            props: dict[str, float] = {}
            for layer in layers:
                name = layer.get("name")
                depths = layer.get("depths", [])
                if depths and name in ["clay", "silt", "sand"]:
                    # SoilGrids returns values scaled by 10 (e.g. g/kg or dg/kg -> divide by 10 for %)
                    val_mean = depths[0].get("values", {}).get("mean", 300)
                    props[name] = round(float(val_mean) / 10.0, 1)

            clay = props.get("clay")
            silt = props.get("silt")
            sand = props.get("sand")

            # Classify only when all modelled fractions are present.
            if sand is None or clay is None or silt is None:
                raise ValueError("SoilGrids omitted one or more texture layers")
            if sand > 55.0:
                t_class = "Sandy"
            elif clay > 35.0:
                t_class = "Clayey"
            else:
                t_class = "Loamy"

            fetched_at = utc_now_iso()
            response = SoilTextureResponse(
                latitude=lat_r,
                longitude=lon_r,
                clay_percent=clay,
                silt_percent=silt,
                sand_percent=sand,
                texture_class=t_class,
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
                        "NON-NASA SOIL DATA: ISRIC SoilGrids 250m predicted soil properties. "
                        "Farmer can override texture on Screen B if local soil differs."
                    ),
                    docs_url=SOILGRIDS_DOCS,
                ),
            )
            self.cache.set(cache_key, response.model_dump(), fetched_at, SOILGRIDS_CACHE_TTL)
            return response

        except Exception:
            # Never replace unavailable point data with a regional guess.
            response = SoilTextureResponse(
                latitude=lat_r,
                longitude=lon_r,
                clay_percent=None,
                silt_percent=None,
                sand_percent=None,
                texture_class="Unavailable",
                freshness=FreshnessBadge(
                    dataset_name="ISRIC SoilGrids 250m Topsoil Properties",
                    source_org="ISRIC (CC BY 4.0)",
                    is_nasa=False,
                    status="UNAVAILABLE",
                    latest_observation_date="Static Model",
                    fetched_at_utc=utc_now_iso(),
                    typical_latency="Static dataset",
                    spatial_resolution="250 meter",
                    caveat="SoilGrids unavailable; no regional default is substituted. Confirm texture with a soil test or local technician.",
                    docs_url=SOILGRIDS_DOCS,
                ),
            )
            return response