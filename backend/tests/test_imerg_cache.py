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
