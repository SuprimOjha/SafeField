import asyncio
import xml.etree.ElementTree as ET
from typing import Any
import httpx
from app.cache import create_cache
from app.cache.sqlite_cache import SQLiteCache
from app.config import get_settings
from app.schemas import FreshnessBadge, GibsLayerInfo, SatelliteObservationStatus
from app.services.http_client import fetch_json_with_retry, utc_now_iso


CMR_GRANULES_URL = "https://cmr.earthdata.nasa.gov/search/granules.json"
CMR_DOCS_URL = "https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html"
GIBS_CAPABILITIES_URL = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml"
GIBS_DOCS_URL = "https://nasa-gibs.github.io/gibs-api-docs/"

CMR_CACHE_TTL_SECONDS = 3600  # 1 hour
GIBS_CACHE_TTL_SECONDS = 24 * 3600  # 24 hours


class NasaCmrGibsClient:
    """
    Discovers latest GPM IMERG and SMAP granules over Nepal via NASA CMR
    and verifies live GIBS WMTS raster overlay identifiers from WMTSCapabilities.xml.
    """

    def __init__(self, cache: SQLiteCache | None = None) -> None:
        self.cache = cache or create_cache()
        self.settings = get_settings()

    async def get_gibs_layer_catalog(self) -> dict[str, GibsLayerInfo]:
        """Fetches and parses GIBS WMTSCapabilities.xml to verify active IMERG and SMAP layer IDs."""
        cache_key = "nasa_gibs_capabilities_imerg_smap"
        hit = self.cache.get(cache_key, allow_stale=False)
        if hit is not None:
            payload, _, _ = hit
            return {k: GibsLayerInfo.model_validate(v) for k, v in payload.items()}

        try:
            async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
                resp = await client.get(GIBS_CAPABILITIES_URL)
                resp.raise_for_status()
                xml_text = resp.text

            layers = self._parse_wmts_capabilities(xml_text)
            if layers:
                self.cache.set(
                    cache_key,
                    {k: v.model_dump() for k, v in layers.items()},
                    utc_now_iso(),
                    GIBS_CACHE_TTL_SECONDS,
                )
            return layers
        except Exception:
            stale = self.cache.get(cache_key, allow_stale=True)
            if stale is not None:
                payload, _, _ = stale
                return {k: GibsLayerInfo.model_validate(v) for k, v in payload.items()}
            return {}

    def _parse_wmts_capabilities(self, xml_text: str) -> dict[str, GibsLayerInfo]:
        root = ET.fromstring(xml_text)
        ns = {
            "wmts": "http://www.opengis.net/wmts/1.0",
            "ows": "http://www.opengis.net/ows/1.1",
        }

        found: dict[str, GibsLayerInfo] = {}
        for layer_el in root.findall(".//wmts:Contents/wmts:Layer", ns):
            id_el = layer_el.find("ows:Identifier", ns)
            title_el = layer_el.find("ows:Title", ns)
            if id_el is None or not id_el.text:
                continue

            layer_id = id_el.text.strip()
            title = title_el.text.strip() if (title_el is not None and title_el.text) else layer_id

            # Match verified IMERG Precipitation Rate and SMAP Soil Moisture visualization layers
            is_imerg_target = "IMERG_Precipitation_Rate" in layer_id and "30min" not in layer_id
            is_smap_target = "SMAP_L4_Analyzed_Root_Zone_Soil_Moisture" in layer_id or (
                "SMAP" in layer_id and "Soil_Moisture" in layer_id
            )

            if not (is_imerg_target or is_smap_target):
                continue

            tms_link = layer_el.find("wmts:TileMatrixSetLink/wmts:TileMatrixSet", ns)
            tms = tms_link.text.strip() if (tms_link is not None and tms_link.text) else "GoogleMapsCompatible_Level6"

            time_el = layer_el.find("wmts:Dimension[ows:Identifier='Time']/wmts:Default", ns)
            extent_el = layer_el.find("wmts:Dimension[ows:Identifier='Time']/wmts:Value", ns)
            time_extent = extent_el.text.strip() if (extent_el is not None and extent_el.text) else None
            default_date = time_el.text.strip() if (time_el is not None and time_el.text) else "default"

            # ResourceURL template if present in capabilities
            res_el = layer_el.find("wmts:ResourceURL[@resourceType='tile']", ns)
            if res_el is not None and res_el.attrib.get("template"):
                template = (
                    res_el.attrib["template"]
                    .replace("{Time}", default_date)
                    .replace("{TileMatrixSet}", tms)
                    .replace("{TileMatrix}", "{z}")
                    .replace("{TileRow}", "{y}")
                    .replace("{TileCol}", "{x}")
                )
            else:
                template = (
                    f"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/"
                    f"{layer_id}/default/{default_date}/{tms}/{{z}}/{{y}}/{{x}}.png"
                )

            key = "imerg" if is_imerg_target else "smap"
            if key not in found:
                found[key] = GibsLayerInfo(
                    layer_id=layer_id,
                    title=title,
                    tile_matrix_set=tms,
                    wmts_url_template=template,
                    time_extent=time_extent,
                    verified_in_capabilities=True,
                )

        return found

    async def _query_latest_cmr_granule(
        self,
        short_name: str,
        dataset_label: str,
        typical_latency: str,
        spatial_resolution: str,
        caveat: str,
        gibs_key: str,
    ) -> SatelliteObservationStatus:
        cache_key = f"nasa_cmr_latest:{short_name}"
        nepal_bbox = (
            f"{self.settings.nepal_min_lon},{self.settings.nepal_min_lat},"
            f"{self.settings.nepal_max_lon},{self.settings.nepal_max_lat}"
        )

        gibs_catalog = await self.get_gibs_layer_catalog()
        gibs_layer = gibs_catalog.get(gibs_key)

        hit = self.cache.get(cache_key, allow_stale=False)
        if hit is not None:
            payload, fetched_at, _ = hit
            parsed = SatelliteObservationStatus.model_validate(payload)
            parsed.freshness.status = "CACHED_FALLBACK"
            parsed.freshness.fetched_at_utc = fetched_at
            parsed.gibs_overlay = gibs_layer
            return parsed

        params: dict[str, Any] = {
            "short_name": short_name,
            "bounding_box": nepal_bbox,
            "sort_key": "-start_date",
            "page_size": 1,
        }

        try:
            data = await fetch_json_with_retry(CMR_GRANULES_URL, params=params, timeout_seconds=15.0)
            entries = data.get("feed", {}).get("entry", [])
            fetched_at = utc_now_iso()

            if not entries:
                raise ValueError(f"No CMR granules returned for {short_name} over Nepal bbox")

            latest = entries[0]
            granule_id = str(latest.get("producer_granule_id") or latest.get("title") or latest.get("id"))
            time_start = str(latest.get("time_start", ""))
            time_end = str(latest.get("time_end", ""))
            obs_date = time_start[:10] if len(time_start) >= 10 else None

            result = SatelliteObservationStatus(
                freshness=FreshnessBadge(
                    dataset_name=dataset_label,
                    source_org="NASA EOSDIS Common Metadata Repository (CMR) & GIBS",
                    is_nasa=True,
                    status="LIVE",
                    latest_observation_date=obs_date,
                    fetched_at_utc=fetched_at,
                    typical_latency=typical_latency,
                    spatial_resolution=spatial_resolution,
                    caveat=caveat,
                    docs_url=CMR_DOCS_URL,
                ),
                latest_granule_id=granule_id,
                granule_time_start=time_start or None,
                granule_time_end=time_end or None,
                gibs_overlay=gibs_layer,
            )
            self.cache.set(cache_key, result.model_dump(), fetched_at, CMR_CACHE_TTL_SECONDS)
            return result

        except Exception as exc:
            stale = self.cache.get(cache_key, allow_stale=True)
            if stale is not None:
                payload, fetched_at, _ = stale
                parsed = SatelliteObservationStatus.model_validate(payload)
                parsed.freshness.status = "CACHED_FALLBACK"
                parsed.freshness.fetched_at_utc = fetched_at
                parsed.gibs_overlay = gibs_layer
                return parsed

            return SatelliteObservationStatus(
                freshness=FreshnessBadge(
                    dataset_name=dataset_label,
                    source_org="NASA EOSDIS CMR",
                    is_nasa=True,
                    status="UNAVAILABLE",
                    latest_observation_date=None,
                    fetched_at_utc=utc_now_iso(),
                    typical_latency=typical_latency,
                    spatial_resolution=spatial_resolution,
                    caveat=f"UNAVAILABLE: CMR granule query failed ({exc}).",
                    docs_url=CMR_DOCS_URL,
                ),
                latest_granule_id=None,
                granule_time_start=None,
                granule_time_end=None,
                gibs_overlay=gibs_layer,
            )

    async def get_imerg_and_smap_status(self) -> dict[str, SatelliteObservationStatus]:
        imerg_task = self._query_latest_cmr_granule(
            short_name="GPM_3IMERGDE",
            dataset_label="GPM IMERG Early Run Daily Precipitation (GPM_3IMERGDE)",
            typical_latency="~4-14 hours (satellite microwave/IR estimate)",
            spatial_resolution="0.1° x 0.1° (~10 km)",
            caveat="Satellite precipitation estimate; terrain in Nepal hills can cause localized bias.",
            gibs_key="imerg",
        )
        smap_task = self._query_latest_cmr_granule(
            short_name="SPL4SMGP",
            dataset_label="SMAP Level-4 Global 3-Hourly Surface & Root-Zone Soil Moisture (SPL4SMGP)",
            typical_latency="2-3 days (L-band radiometer assimilated into land model)",
            spatial_resolution="9 km EASE-Grid 2.0",
            caveat="Assimilated L-band soil moisture (0-5 cm & 0-100 cm); dense canopy/steep slopes reduce accuracy.",
            gibs_key="smap",
        )
        imerg_res, smap_res = await asyncio.gather(imerg_task, smap_task)
        return {"imerg": imerg_res, "smap": smap_res}