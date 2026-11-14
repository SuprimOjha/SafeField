from datetime import datetime
from typing import Literal, Protocol
from pydantic import BaseModel, Field


RainfallKind = Literal["observation", "model", "forecast", "fallback", "farmer_input", "assumption"]


class RainfallProvenance(BaseModel):
    source_name: str
    kind: RainfallKind
    observed_start_utc: datetime
    observed_end_utc: datetime
    fetched_at_utc: datetime
    spatial_resolution: str | None
    latency_note: str
    dataset: str
    version: str
    stream: str | None = None
    granule_ids: list[str] = Field(default_factory=list)
    units: str


class RainfallObservation(BaseModel):
    status: Literal["AVAILABLE", "UNAVAILABLE"]
    amount_mm: float | None = Field(default=None, ge=0)
    window_hours: int
    provenance: RainfallProvenance | None = None
    unavailable_reason: str | None = None


class RainfallProvider(Protocol):
    def get_recent_rain(self, latitude: float, longitude: float, hours: int) -> RainfallObservation:
        """Return a cached observation with its true observation interval and provenance."""
