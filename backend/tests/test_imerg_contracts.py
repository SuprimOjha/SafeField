from datetime import datetime, timezone
import pytest
from app.services.imerg.contracts import (
    IMERGGranuleMetadata, IMERGIntersectingCell, summarize_intersecting_cells,
)


def granule(stream="LATE"):
    return IMERGGranuleMetadata(
        product="GPM_3IMERGHH", version="07B", stream=stream, granule_id="GPM-TEST-001",
        observation_start=datetime(2026, 11, 14, 0, tzinfo=timezone.utc),
        observation_end=datetime(2026, 11, 14, 0, 30, tzinfo=timezone.utc),
        processed_at=None, spatial_resolution_km=10, source_url="https://example.nasa.gov/granule",
    )


def test_area_weighted_estimate_uses_intersection_area():
    result = summarize_intersecting_cells(granule(), [
        IMERGIntersectingCell(cell_id="a", intersection_area_km2=1, precipitation_mm=10, quality="GOOD"),
        IMERGIntersectingCell(cell_id="b", intersection_area_km2=3, precipitation_mm=20, quality="GOOD"),
    ], expected_field_area_km2=4)
    assert result.area_weighted_precipitation_mm == 17.5
    assert result.valid_coverage_fraction == 1
    assert result.quality_status == "USABLE"


def test_missing_and_rejected_cells_are_not_zero_filled():
    result = summarize_intersecting_cells(granule(), [
        IMERGIntersectingCell(cell_id="a", intersection_area_km2=1, precipitation_mm=None, quality="MISSING"),
        IMERGIntersectingCell(cell_id="b", intersection_area_km2=1, precipitation_mm=0, quality="REJECTED"),
    ], expected_field_area_km2=2)
    assert result.area_weighted_precipitation_mm is None
    assert result.valid_cell_count == 0
    assert result.quality_status == "UNAVAILABLE"


def test_insufficient_valid_coverage_returns_no_estimate():
    result = summarize_intersecting_cells(granule(), [
        IMERGIntersectingCell(cell_id="a", intersection_area_km2=1, precipitation_mm=5, quality="GOOD"),
    ], expected_field_area_km2=4, minimum_coverage_fraction=0.8)
    assert result.area_weighted_precipitation_mm is None
    assert result.quality_status == "PARTIAL"


def test_final_and_late_streams_are_distinct_metadata_values():
    assert granule("LATE").stream != granule("FINAL").stream


def test_invalid_granule_interval_is_rejected():
    with pytest.raises(ValueError):
        IMERGGranuleMetadata(
            product="GPM", version="07B", stream="FINAL", granule_id="bad",
            observation_start=datetime(2026, 11, 14, 1, tzinfo=timezone.utc),
            observation_end=datetime(2026, 11, 14, 0, tzinfo=timezone.utc),
            spatial_resolution_km=10, source_url="https://example.nasa.gov",
        )


def test_duplicate_intersecting_cell_ids_are_rejected():
    cell = IMERGIntersectingCell(cell_id="same", intersection_area_km2=1, precipitation_mm=10, quality="GOOD")
    with pytest.raises(ValueError, match="unique"):
        summarize_intersecting_cells(granule(), [cell, cell], expected_field_area_km2=2)


def test_intersection_area_cannot_exceed_expected_field_area():
    cells = [
        IMERGIntersectingCell(cell_id="a", intersection_area_km2=2, precipitation_mm=10, quality="GOOD"),
        IMERGIntersectingCell(cell_id="b", intersection_area_km2=2, precipitation_mm=20, quality="GOOD"),
    ]
    with pytest.raises(ValueError, match="exceed"):
        summarize_intersecting_cells(granule(), cells, expected_field_area_km2=3)


def test_non_positive_expected_field_area_is_rejected():
    with pytest.raises(ValueError, match="positive"):
        summarize_intersecting_cells(granule(), [], expected_field_area_km2=0)


def test_minimum_coverage_threshold_must_be_in_unit_interval():
    with pytest.raises(ValueError, match="minimum_coverage_fraction"):
        summarize_intersecting_cells(granule(), [], expected_field_area_km2=1, minimum_coverage_fraction=0)


def test_quality_rejected_cells_are_counted_but_not_averaged():
    result = summarize_intersecting_cells(granule(), [
        IMERGIntersectingCell(cell_id="good", intersection_area_km2=4, precipitation_mm=8, quality="GOOD"),
        IMERGIntersectingCell(cell_id="suspect", intersection_area_km2=1, precipitation_mm=100, quality="SUSPECT"),
    ], expected_field_area_km2=5, minimum_coverage_fraction=0.8)
    assert result.area_weighted_precipitation_mm == 8
    assert result.valid_cell_count == 1
    assert result.rejected_cell_count == 1
    assert result.quality_status == "PARTIAL"
