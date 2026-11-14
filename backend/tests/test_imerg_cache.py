from datetime import date, datetime, timezone
from app.services.imerg.grid_cache import ImergGridCache


def test_grid_cache_returns_sum_for_consecutive_complete_utc_days(tmp_path):
    cache = ImergGridCache(str(tmp_path / "cache.sqlite"))
    fetched = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)
    for day, value in [(date(2026, 11, 11), 2.0), (date(2026, 11, 12), 3.0), (date(2026, 11, 13), 4.0)]:
        cache.store_daily_grid(day, [27.0], [85.0], [[value]], [[48]], f"granule-{day}", fetched)
    result = cache.get_recent_rain(27.01, 85.01, 72)
    assert result.status == "AVAILABLE"
    assert result.amount_mm == 9.0
    assert result.provenance is not None
    assert result.provenance.stream == "LATE"


def test_grid_cache_refuses_gapped_daily_records(tmp_path):
    cache = ImergGridCache(str(tmp_path / "cache.sqlite"))
    fetched = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)
    for day, value in [(date(2026, 11, 10), 2.0), (date(2026, 11, 12), 3.0), (date(2026, 11, 13), 4.0)]:
        cache.store_daily_grid(day, [27.0], [85.0], [[value]], [[48]], f"granule-{day}", fetched)
    result = cache.get_recent_rain(27.0, 85.0, 72)
    assert result.status == "UNAVAILABLE"
    assert result.amount_mm is None


def test_grid_cache_does_not_store_missing_or_zero_sample_cells(tmp_path):
    cache = ImergGridCache(str(tmp_path / "cache.sqlite"))
    inserted = cache.store_daily_grid(date(2026, 11, 13), [27.0], [85.0], [[None]], [[0]], "g1", datetime.now(timezone.utc))
    assert inserted == 0
    result = cache.get_recent_rain(27.0, 85.0, 24)
    assert result.status == "UNAVAILABLE"



def test_grid_cache_refuses_stale_daily_records(tmp_path):
    cache = ImergGridCache(str(tmp_path / "cache.sqlite"))
    fetched = datetime(2026, 11, 14, tzinfo=timezone.utc)
    for day in [date(2026, 11, 1), date(2026, 11, 2), date(2026, 11, 3)]:
        cache.store_daily_grid(day, [27.0], [85.0], [[1.0]], [[48]], f"granule-{day}", fetched)
    result = cache.get_recent_rain(27.0, 85.0, 72)
    assert result.status == "UNAVAILABLE"
    assert result.amount_mm is None



def test_polygon_rainfall_uses_area_weighted_grid_intersections(tmp_path):
    cache = ImergGridCache(str(tmp_path / "cache.sqlite"))
    fetched = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)
    grid = [[10.0, 20.0], [30.0, 40.0]]
    counts = [[48, 48], [48, 48]]
    for day in [date(2026, 11, 11), date(2026, 11, 12), date(2026, 11, 13)]:
        cache.store_daily_grid(day, [27.0, 27.1], [85.0, 85.1], grid, counts, f"granule-{day}", fetched)
    polygon = [(84.95, 26.95), (85.15, 26.95), (85.15, 27.15), (84.95, 27.15), (84.95, 26.95)]
    result = cache.get_recent_rain(27.05, 85.05, 72, polygon)
    assert result.status == "AVAILABLE"
    assert result.provenance is not None
    assert result.provenance.spatial_method == "area_weighted_polygon"
    assert result.provenance.coverage_fraction is not None
    assert result.provenance.coverage_fraction >= 0.8
    assert 74.0 <= result.amount_mm <= 76.0


def test_polygon_rainfall_refuses_insufficient_spatial_coverage(tmp_path):
    cache = ImergGridCache(str(tmp_path / "cache.sqlite"))
    fetched = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)
    for day in [date(2026, 11, 11), date(2026, 11, 12), date(2026, 11, 13)]:
        cache.store_daily_grid(day, [27.0], [85.0], [[10.0]], [[48]], f"granule-{day}", fetched)
    polygon = [(84.95, 26.95), (85.15, 26.95), (85.15, 27.15), (84.95, 27.15), (84.95, 26.95)]
    result = cache.get_recent_rain(27.05, 85.05, 72, polygon)
    assert result.status == "UNAVAILABLE"
    assert result.amount_mm is None
    assert "coverage" in (result.unavailable_reason or "")


def test_polygon_rainfall_rejects_self_intersecting_geometry(tmp_path):
    cache = ImergGridCache(str(tmp_path / "cache.sqlite"))
    polygon = [(85.0, 27.0), (85.1, 27.1), (85.0, 27.1), (85.1, 27.0), (85.0, 27.0)]
    result = cache.get_recent_rain(27.0, 85.0, 72, polygon)
    assert result.status == "UNAVAILABLE"
    assert result.amount_mm is None
