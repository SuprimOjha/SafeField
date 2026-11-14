from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.api.routes import parse_field_polygon
from app.content_packs.loader import validate_content
from app.decision.fertilizer_engine import FertilizerDecisionEngine
from app.services.imerg.grid_cache import ImergGridCache
from app.services.rainfall import RainfallObservation
from app.services.soilgrids_client import _extract_layer_mean_percent


def make_cache(tmp_path, values=(1.0, 2.0, 3.0), counts=(48, 48, 48), latitudes=(27.0,), longitudes=(85.0,)):
    cache = ImergGridCache(str(tmp_path / "regressions.sqlite"))
    today = datetime.now(timezone.utc).date()
    days = [today - timedelta(days=3), today - timedelta(days=2), today - timedelta(days=1)]
    fetched = datetime.now(timezone.utc)
    for day, value, count in zip(days, values, counts):
        grid = [[float(value) for _ in longitudes] for _ in latitudes]
        sample_grid = [[int(count) for _ in longitudes] for _ in latitudes]
        cache.store_daily_grid(day, list(latitudes), list(longitudes), grid, sample_grid, f"granule-{day}", fetched)
    return cache


def field_box(west=84.95, south=26.95, east=85.05, north=27.05):
    return [(west, south), (east, south), (east, north), (west, north), (west, south)]


def valid_inputs(**overrides):
    values = {
        "rain_last_72h_mm": 2.0,
        "expected_rain_next_48h_mm": 0.0,
        "soil_wetness": 0.45,
        "sand_percent": 35.0,
        "slope_percent": 1.0,
        "fertilizer_type": "Urea",
        "crop_stage": "Vegetative / Tillering",
        "priority_save_money": True,
    }
    values.update(overrides)
    return values


def test_regression_helpers_use_recent_utc_days(tmp_path):
    cache = make_cache(tmp_path)
    result = cache.get_recent_rain(27.0, 85.0, 72)
    assert result.status == "AVAILABLE"
    assert result.amount_mm == 6.0


def test_zero_precipitation_is_a_valid_measurement(tmp_path):
    cache = make_cache(tmp_path, values=(0.0, 0.0, 0.0))
    result = cache.get_recent_rain(27.0, 85.0, 72)
    assert result.status == "AVAILABLE"
    assert result.amount_mm == 0.0


def test_cache_returns_latest_complete_day_for_24_hour_window(tmp_path):
    cache = make_cache(tmp_path, values=(1.0, 2.0, 3.0))
    result = cache.get_recent_rain(27.0, 85.0, 24)
    assert result.status == "AVAILABLE"
    assert result.amount_mm == 3.0


def test_cache_returns_two_latest_days_for_48_hour_window(tmp_path):
    cache = make_cache(tmp_path, values=(1.0, 2.0, 3.0))
    result = cache.get_recent_rain(27.0, 85.0, 48)
    assert result.status == "AVAILABLE"
    assert result.amount_mm == 5.0


def test_cache_rejects_non_whole_day_window(tmp_path):
    cache = make_cache(tmp_path)
    result = cache.get_recent_rain(27.0, 85.0, 25)
    assert result.status == "UNAVAILABLE"
    assert "whole-day" in (result.unavailable_reason or "")


def test_cache_reports_fresh_recent_data(tmp_path):
    cache = make_cache(tmp_path)
    assert cache.has_fresh_data() is True


def test_empty_cache_is_not_reported_as_ready(tmp_path):
    cache = ImergGridCache(str(tmp_path / "empty.sqlite"))
    assert cache.has_fresh_data() is False


def test_cache_rejects_data_older_than_five_days(tmp_path):
    cache = ImergGridCache(str(tmp_path / "stale.sqlite"))
    old_day = datetime.now(timezone.utc).date() - timedelta(days=6)
    cache.store_daily_grid(old_day, [27.0], [85.0], [[1.0]], [[48]], "stale", datetime.now(timezone.utc))
    assert cache.has_fresh_data() is False


def test_cache_rejects_future_observation_dates(tmp_path):
    cache = ImergGridCache(str(tmp_path / "future.sqlite"))
    future_day = datetime.now(timezone.utc).date() + timedelta(days=1)
    cache.store_daily_grid(future_day, [27.0], [85.0], [[1.0]], [[48]], "future", datetime.now(timezone.utc))
    assert cache.has_fresh_data() is False


def test_cache_does_not_store_negative_precipitation(tmp_path):
    cache = ImergGridCache(str(tmp_path / "negative.sqlite"))
    inserted = cache.store_daily_grid(date.today(), [27.0], [85.0], [[-0.1]], [[48]], "negative", datetime.now(timezone.utc))
    assert inserted == 0


def test_cache_does_not_store_cells_without_valid_samples(tmp_path):
    cache = ImergGridCache(str(tmp_path / "no-samples.sqlite"))
    inserted = cache.store_daily_grid(date.today(), [27.0], [85.0], [[5.0]], [[0]], "empty-cell", datetime.now(timezone.utc))
    assert inserted == 0


def test_cache_stores_zero_precipitation_with_valid_samples(tmp_path):
    cache = ImergGridCache(str(tmp_path / "zero.sqlite"))
    inserted = cache.store_daily_grid(date.today(), [27.0], [85.0], [[0.0]], [[48]], "zero", datetime.now(timezone.utc))
    assert inserted == 1


def test_point_lookup_rejects_38_valid_half_hour_samples(tmp_path):
    cache = make_cache(tmp_path, counts=(38, 48, 48))
    result = cache.get_recent_rain(27.0, 85.0, 72)
    assert result.status == "UNAVAILABLE"
    assert "39" in (result.unavailable_reason or "")


def test_point_lookup_accepts_39_valid_half_hour_samples(tmp_path):
    cache = make_cache(tmp_path, counts=(39, 39, 39))
    result = cache.get_recent_rain(27.0, 85.0, 72)
    assert result.status == "AVAILABLE"
    assert result.amount_mm == 6.0


def test_point_lookup_rejects_a_gap_between_daily_granules(tmp_path):
    cache = ImergGridCache(str(tmp_path / "gap.sqlite"))
    today = datetime.now(timezone.utc).date()
    fetched = datetime.now(timezone.utc)
    for offset in (1, 2, 4):
        day = today - timedelta(days=offset)
        cache.store_daily_grid(day, [27.0], [85.0], [[1.0]], [[48]], f"granule-{day}", fetched)
    result = cache.get_recent_rain(27.0, 85.0, 72)
    assert result.status == "UNAVAILABLE"
    assert "gap" in (result.unavailable_reason or "")
