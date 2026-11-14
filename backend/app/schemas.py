from typing import Literal
from pydantic import BaseModel, Field


SourceStatus = Literal["LIVE", "CACHED_FALLBACK", "UNAVAILABLE"]


class FreshnessBadge(BaseModel):
    dataset_name: str
    source_org: str
    is_nasa: bool
    status: SourceStatus
    latest_observation_date: str | None = Field(
        default=None,
        description="ISO date (YYYY-MM-DD) of the most recent valid data point returned by the source.",
    )
    fetched_at_utc: str = Field(
        description="ISO-8601 UTC timestamp when this payload was retrieved from the upstream API or cache.",
    )
    typical_latency: str = Field(
        description="Honest operational lag of this dataset (e.g. '2-4 days').",
    )
    spatial_resolution: str
    caveat: str
    docs_url: str


class DailyWeatherRecord(BaseModel):
    date: str
    precip_mm: float | None
    temp_c: float | None
    surface_soil_wetness: float | None
    root_soil_wetness: float | None


class PowerSummaryResponse(BaseModel):
    latitude: float
    longitude: float
    freshness: FreshnessBadge
    rain_last_24h_mm: float | None
    rain_last_72h_mm: float | None
    latest_surface_wetness: float | None
    latest_root_wetness: float | None
    latest_temp_c: float | None
    recent_daily_records: list[DailyWeatherRecord]
    historical_daily_records: list[DailyWeatherRecord]


class GibsLayerInfo(BaseModel):
    layer_id: str
    title: str
    tile_matrix_set: str
    wmts_url_template: str
    time_extent: str | None = None
    verified_in_capabilities: bool


class SatelliteObservationStatus(BaseModel):
    freshness: FreshnessBadge
    latest_granule_id: str | None = None
    granule_time_start: str | None = None
    granule_time_end: str | None = None
    gibs_overlay: GibsLayerInfo | None = None