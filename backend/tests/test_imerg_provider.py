from datetime import date, datetime, timezone
from app.services.imerg.grid_cache import ImergGridCache
from app.services.imerg.provider import ImergLateProvider


def test_imerg_late_provider_implements_read_only_rainfall_contract(tmp_path):
    cache = ImergGridCache(str(tmp_path / "cache.sqlite"))
    fetched = datetime(2026, 11, 14, tzinfo=timezone.utc)
    for day in [date(2026, 11, 11), date(2026, 11, 12), date(2026, 11, 13)]:
        cache.store_daily_grid(day, [27.0], [85.0], [[1.0]], [[48]], f"granule-{day}", fetched)
    provider = ImergLateProvider(cache)
    result = provider.get_recent_rain(27.0, 85.0, 72)
    assert result.status == "AVAILABLE"
    assert result.amount_mm == 3.0
    assert result.provenance is not None
    assert result.provenance.kind == "observation"


def test_imerg_late_provider_reports_uninstalled_cache_as_unavailable(tmp_path):
    cache = ImergGridCache(str(tmp_path / "empty.sqlite"))
    provider = ImergLateProvider(cache)
    assert provider.is_available is False
    result = provider.get_recent_rain(27.0, 85.0, 72)
    assert result.status == "UNAVAILABLE"
    assert result.amount_mm is None
    assert "cached" in result.unavailable_reason.lower()
