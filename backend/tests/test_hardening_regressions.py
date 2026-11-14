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
