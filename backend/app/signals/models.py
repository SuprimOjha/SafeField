from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


SignalName = Literal[    "rain",
    "soil_moisture_surface",
    "soil_moisture_root",
    "heat_air",
    "heat_surface",
    "ndvi",
    "evi",
]
SignalKind = Literal[
    "observation",
    "model",
    "forecast",
    "fallback",
    "cached",
    "farmer_input",
    "assumption",
]
SignalStatus = Literal["available", "partial", "stale", "unavailable", "not_installed"]
VsNormal = Literal[
    "much_below",
    "below",
    "near_normal",
    "above",
    "much_above",
    "unknown",
]
SourceState = Literal["ok", "stale", "missing", "error"]


def is_nasa_source_name(source_name: str) -> bool:
    """Detect NASA products without treating 'non-NASA' as NASA.

    Several honest provenance strings say "(non-NASA)", so a plain substring
    test would mislabel them. Removing the negation first keeps the NASA flag
    truthful.
    """
    lowered = source_name.lower().replace("non-nasa", "").replace("non nasa", "")
    return "nasa" in lowered or "imerg" in lowered


class SignalProvenance(BaseModel):
    """Everything a Data Receipt needs to explain one value."""

    model_config = ConfigDict(extra="forbid")

    source_name: str = Field(min_length=3)
    product: str = Field(min_length=2)
    version: str = Field(min_length=1)
    kind: SignalKind
    is_nasa: bool
    valid_date: date | None = None
    observed_start: datetime | None = None
    observed_end: datetime | None = None
    fetched_at: datetime
    spatial_resolution: str = Field(min_length=1)
    latency_note: str = Field(min_length=1)
    granule_ids: list[str] = Field(default_factory=list)
    coverage_fraction: float | None = Field(default=None, ge=0, le=1)
    model_only: bool | None = None
    source_key: str | None = None
    caveat: str = Field(min_length=1)
    resolution_note: str = (
        "Area around your field. Satellite pixels are much larger than a small "
        "plot; drawing a polygon does not increase the source resolution."
    )

    @model_validator(mode="after")
    def interval_is_ordered(self):
        if (
            self.observed_start is not None
            and self.observed_end is not None
            and self.observed_end <= self.observed_start
        ):
            raise ValueError("observed_end must be after observed_start")
        return self


class SignalValue(BaseModel):
    """One signal with its value, versus-normal class and provenance."""

    model_config = ConfigDict(extra="forbid")

    name: SignalName
    status: SignalStatus
    value: float | None = None
    unit: str | None = None
    vs_normal: VsNormal = "unknown"
    anomaly: float | None = None
    baseline: float | None = None
    baseline_years: int = 0
    provenance: SignalProvenance | None = None
    unavailable_reason: str | None = None
    quality_note: str | None = None

    @model_validator(mode="after")
    def state_matches_evidence(self):
        if self.status in {"available", "partial", "stale"}:
            if self.value is None or self.provenance is None:
                raise ValueError("reported signals require a value and provenance")
        if self.status in {"unavailable", "not_installed"}:
            if self.value is not None:
                raise ValueError("unavailable signals cannot carry a numeric value")
            if not self.unavailable_reason:
                raise ValueError("unavailable signals require a reason")
        return self


class SignalBundle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    latitude: float
    longitude: float
    generated_at: datetime
    signals: dict[SignalName, SignalValue] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)

    def signal(self, name: SignalName) -> SignalValue | None:
        return self.signals.get(name)


class SourceStatus(BaseModel):
    """Per-source state persisted to status.json on the data branch."""

    model_config = ConfigDict(extra="forbid")

    source: str = Field(min_length=2)
    status: SourceState
    last_success_at: datetime | None = None
    latest_data_date: date | None = None
    coverage: float | None = Field(default=None, ge=0, le=1)
    version: str | None = None
    product: str | None = None
    granule_ids: list[str] = Field(default_factory=list)
    last_error: str | None = None
    files: list[str] = Field(default_factory=list)


class DataStatusFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = 1
    generated_at: datetime
    sources: dict[str, SourceStatus] = Field(default_factory=dict)
