from datetime import datetime
from typing import Literal, Protocol
from pydantic import BaseModel, ConfigDict, Field, model_validator


RainfallKind = Literal["observation", "model", "forecast", "fallback", "farmer_input", "assumption"]


class RainfallProvenance(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
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
    spatial_method: Literal["nearest_grid_cell", "area_weighted_polygon"] = "nearest_grid_cell"
    coverage_fraction: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode="after")
    def observation_interval_is_ordered(self):
        if self.observed_end_utc <= self.observed_start_utc:
            raise ValueError("observed_end_utc must be after observed_start_utc")
        return self


class RainfallObservation(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    status: Literal["AVAILABLE", "UNAVAILABLE"]
    amount_mm: float | None = Field(default=None, ge=0)
    window_hours: int = Field(gt=0)
    provenance: RainfallProvenance | None = None
    unavailable_reason: str | None = None

    @model_validator(mode="after")
    def availability_matches_evidence(self):
        if self.status == "AVAILABLE":
            if self.amount_mm is None or self.provenance is None:
                raise ValueError("available rainfall requires an amount and source provenance")
            if self.unavailable_reason is not None:
                raise ValueError("available rainfall cannot include an unavailable reason")
        else:
            if self.amount_mm is not None:
                raise ValueError("unavailable rainfall cannot include a numeric amount")
            if not self.unavailable_reason:
                raise ValueError("unavailable rainfall requires an explanation")
        return self


class RainfallProvider(Protocol):
    def get_recent_rain(self, latitude: float, longitude: float, hours: int, field_polygon: list[tuple[float, float]] | None = None) -> RainfallObservation:
        """Return a cached observation with its true observation interval and provenance."""
