from datetime import date, datetime, timedelta, timezone

import pytest

from app.services.imerg.grid_cache import ImergGridCache


def _recent_days():
    today = datetime.now(timezone.utc).date()
    return [today - timedelta(days=offset) for offset in (1, 2, 3)]


def _granule_id(day: date, version: str = "07C") -> str:
    return (
        f"3B-DAY-L.MS.MRG.3IMERG.{day:%Y%m%d}"
        f"-S000000-E235959.V{version}"
    )


def _store_days(cache, days, amounts, counts=None, versions=None):
    fetched_at = datetime.now(timezone.utc)
    counts = counts or [48] * len(days)
    versions = versions or ["07C"] * len(days)
    for day, amount, count, version in zip(days, amounts, counts, versions):
        cache.store_daily_grid(
            day,
            [27.0],
            [85.0],
            [[amount]],
            [[count]],
            _granule_id(day, version),
            fetched_at,
        )


def test_valid_zero_rainfall_is_available_not_missing(tmp_path):
    cache = ImergGridCache(str(tmp_path / "zero-rain.sqlite"))
    _store_days(cache, _recent_days(), [0.0, 0.0, 0.0], [48, 48, 48])

    result = cache.get_recent_rain(27.0, 85.0, 72)

    assert result.status == "AVAILABLE"
    assert result.amount_mm == 0.0
    assert result.provenance is not None
    assert result.provenance.version == "07C"
    # Point queries use the 39/48 temporal sample gate, not polygon area coverage.
    assert result.provenance.coverage_fraction is None


@pytest.mark.parametrize("precipitation", [None, float("nan"), float("inf"), -9999.0])
def test_missing_fill_or_non_finite_rainfall_is_not_stored_as_zero(
    tmp_path, precipitation
):
    cache = ImergGridCache(str(tmp_path / "invalid-rain.sqlite"))
    inserted = cache.store_daily_grid(
        datetime.now(timezone.utc).date() - timedelta(days=1),
        [27.0],
        [85.0],
        [[precipitation]],
        [[48]],
        _granule_id(datetime.now(timezone.utc).date() - timedelta(days=1)),
        datetime.now(timezone.utc),
    )

    assert inserted == 0


def test_zero_sample_count_is_not_a_valid_zero_rainfall_observation(tmp_path):
    cache = ImergGridCache(str(tmp_path / "zero-count.sqlite"))
    day = datetime.now(timezone.utc).date() - timedelta(days=1)

    inserted = cache.store_daily_grid(
        day, [27.0], [85.0], [[0.0]], [[0]], _granule_id(day),
        datetime.now(timezone.utc),
    )

    assert inserted == 0
    result = cache.get_recent_rain(27.0, 85.0, 24)
    assert result.status == "UNAVAILABLE"
    assert result.amount_mm is None


def test_38_of_48_samples_makes_the_72_hour_point_total_unavailable(tmp_path):
    cache = ImergGridCache(str(tmp_path / "low-coverage.sqlite"))
    _store_days(cache, _recent_days(), [1.0, 2.0, 3.0], [48, 38, 48])

    result = cache.get_recent_rain(27.0, 85.0, 72)

    assert result.status == "UNAVAILABLE"
    assert result.amount_mm is None
    assert "fewer than 39" in (result.unavailable_reason or "")


def test_39_of_48_samples_is_accepted_and_daily_values_are_summed(tmp_path):
    cache = ImergGridCache(str(tmp_path / "minimum-valid.sqlite"))
    _store_days(cache, _recent_days(), [1.25, 2.5, 3.75], [39, 48, 39])

    result = cache.get_recent_rain(27.0, 85.0, 72)

    assert result.status == "AVAILABLE"
    assert result.amount_mm == 7.5
    assert result.provenance is not None
    assert result.provenance.granule_ids == sorted(
        _granule_id(day) for day in _recent_days()
    )


def test_a_missing_utc_day_prevents_a_72_hour_total(tmp_path):
    cache = ImergGridCache(str(tmp_path / "date-gap.sqlite"))
    today = datetime.now(timezone.utc).date()
    days = [today - timedelta(days=1), today - timedelta(days=2), today - timedelta(days=4)]
    _store_days(cache, days, [1.0, 2.0, 4.0])

    result = cache.get_recent_rain(27.0, 85.0, 72)

    assert result.status == "UNAVAILABLE"
    assert result.amount_mm is None
    assert "date gap" in (result.unavailable_reason or "")


def test_mixed_imerg_product_versions_are_not_combined(tmp_path):
    cache = ImergGridCache(str(tmp_path / "mixed-versions.sqlite"))
    _store_days(
        cache,
        _recent_days(),
        [1.0, 2.0, 3.0],
        versions=["07C", "07B", "07C"],
    )

    result = cache.get_recent_rain(27.0, 85.0, 72)

    assert result.status == "UNAVAILABLE"
    assert result.amount_mm is None
    assert "mixed product versions" in (result.unavailable_reason or "")


def test_cell_counts_by_day_reports_each_installed_day(tmp_path):
    cache = ImergGridCache(str(tmp_path / "cell-counts.sqlite"))
    days = _recent_days()
    _store_days(cache, days, [1.0, 2.0, 3.0])

    assert cache.cell_counts_by_day() == {day.isoformat(): 1 for day in days}


def test_missing_day_reason_names_the_cell_and_dates(tmp_path):
    cache = ImergGridCache(str(tmp_path / "missing-days.sqlite"))
    days = _recent_days()
    fetched_at = datetime.now(timezone.utc)
    cache.store_daily_grid(
        days[0], [27.0], [85.0], [[1.0]], [[48]], _granule_id(days[0]), fetched_at
    )
    cache.store_daily_grid(
        days[1], [27.1], [85.0], [[2.0]], [[48]], _granule_id(days[1]), fetched_at
    )
    cache.store_daily_grid(
        days[2], [27.1], [85.0], [[3.0]], [[48]], _granule_id(days[2]), fetched_at
    )

    result = cache.get_recent_rain(27.0, 85.0, 72)

    assert result.status == "UNAVAILABLE"
    assert "(27.00, 85.00)" in result.unavailable_reason
    assert days[0].isoformat() not in result.unavailable_reason
    assert days[1].isoformat() in result.unavailable_reason
    assert days[2].isoformat() in result.unavailable_reason
