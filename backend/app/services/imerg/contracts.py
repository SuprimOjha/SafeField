from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


IMERGStream = Literal["LATE", "FINAL"]
IMERGQuality = Literal["GOOD", "SUSPECT", "MISSING", "REJECTED"]


class IMERGGranuleMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product: str = Field(min_length=3)
    version: str = Field(min_length=2)
    stream: IMERGStream
    granule_id: str = Field(min_length=3)
    observation_start: datetime
    observation_end: datetime
    processed_at: datetime | None = None
    spatial_resolution_km: float = Field(gt=0)
    source_url: str = Field(min_length=8)

    @model_validator(mode="after")
    def interval_is_ordered(self):
        if self.observation_end <= self.observation_start:
            raise ValueError("Granule observation_end must be after observation_start")
        return self


class IMERGIntersectingCell(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cell_id: str = Field(min_length=1)
    intersection_area_km2: float = Field(gt=0)
    precipitation_mm: float | None = Field(default=None, ge=0)
    quality: IMERGQuality


class IMERGFieldSummary(BaseModel):
    granule: IMERGGranuleMetadata
    expected_field_area_km2: float = Field(gt=0)
    valid_coverage_fraction: float = Field(ge=0, le=1)
    area_weighted_precipitation_mm: float | None = Field(default=None, ge=0)
    valid_cell_count: int = Field(ge=0)
    rejected_cell_count: int = Field(ge=0)
    quality_status: Literal["USABLE", "PARTIAL", "UNAVAILABLE"]
    caveat: str


def summarize_intersecting_cells(
    granule: IMERGGranuleMetadata,
    cells: list[IMERGIntersectingCell],
    expected_field_area_km2: float,
    minimum_coverage_fraction: float = 0.8,
) -> IMERGFieldSummary:
    """Area-weight valid cells; never turn missing/poor-quality cells into zero.

    The coverage threshold is an explicit operational setting, not an agronomic
    threshold. Callers must derive intersections from the actual field geometry.
    """
    if expected_field_area_km2 <= 0:
        raise ValueError("expected_field_area_km2 must be positive")
    if not 0 < minimum_coverage_fraction <= 1:
        raise ValueError("minimum_coverage_fraction must be in (0, 1]")

    cell_ids = [cell.cell_id for cell in cells]\n    if len(cell_ids) != len(set(cell_ids)):\n        raise ValueError("intersecting cell identifiers must be unique")\n    total_intersection_area = sum(cell.intersection_area_km2 for cell in cells)\n    if total_intersection_area > expected_field_area_km2 * 1.01:\n        raise ValueError("intersecting cell areas exceed the expected field area")\n\n    valid = [cell for cell in cells if cell.quality == "GOOD" and cell.precipitation_mm is not None]
    rejected_count = len(cells) - len(valid)
    valid_area = sum(cell.intersection_area_km2 for cell in valid)
    coverage = min(valid_area / expected_field_area_km2, 1.0)
    weighted = None
    if valid and coverage >= minimum_coverage_fraction:
        weighted = sum(cell.precipitation_mm * cell.intersection_area_km2 for cell in valid) / valid_area

    if weighted is None:
        status = "UNAVAILABLE" if not valid else "PARTIAL"
        caveat = "Insufficient valid spatial coverage; no field rainfall estimate is reported."
    elif rejected_count:
        status = "PARTIAL"
        caveat = "Area-weighted estimate uses only GOOD cells; some intersecting cells were rejected or missing."
    else:
        status = "USABLE"
        caveat = "Area-weighted estimate from quality-approved intersecting cells; compare with local gauges where possible."

    return IMERGFieldSummary(
        granule=granule,
        expected_field_area_km2=expected_field_area_km2,
        valid_coverage_fraction=round(coverage, 4),
        area_weighted_precipitation_mm=None if weighted is None else round(weighted, 3),
        valid_cell_count=len(valid),
        rejected_cell_count=rejected_count,
        quality_status=status,
        caveat=caveat,
    )
