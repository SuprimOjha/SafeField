from datetime import date, datetime, timezone

import pytest

from app.services.imerg.grid_cache import ImergGridCache, extract_product_version


def test_extracts_version_from_v07c_granule():
    assert extract_product_version(
        "3B-DAY-L.MS.MRG.3IMERG.20261113-S000000-E235959.V07C"
    ) == "07C"


def test_rejects_granule_without_explicit_product_version():
    with pytest.raises(ValueError, match="Cannot determine IMERG product version"):
        extract_product_version("3B-DAY-L.MS.MRG.3IMERG.20261113")


def test_cache_migrates_legacy_v07c_rows(tmp_path):
    db_path = tmp_path / "imerg.sqlite3"
    cache = ImergGridCache(db_path=str(db_path))
    fetched_at = datetime(2026, 11, 14, 14, 0, tzinfo=timezone.utc)

    with cache._connect() as conn:
        conn.execute(
            """
            INSERT INTO imerg_daily_cells
            (date_utc, latitude, longitude, precipitation_mm_day, valid_samples,
             granule_id, product, version, stream, fetched_at_utc)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                date(2026, 11, 13).isoformat(), 27.75, 85.35, 14.06, 48,
                "3B-DAY-L.MS.MRG.3IMERG.20261113-S000000-E235959.V07C",
                "GPM_3IMERGDL", "07B", "LATE", fetched_at.isoformat(),
            ),
        )

    # Reopening runs the safe, granule-ID-backed legacy metadata migration.
    ImergGridCache(db_path=str(db_path))
    with cache._connect() as conn:
        row = conn.execute("SELECT version FROM imerg_daily_cells").fetchone()

    assert row["version"] == "07C"


def test_store_uses_version_from_granule_id(tmp_path):
    cache = ImergGridCache(db_path=str(tmp_path / "store.sqlite3"))
    count = cache.store_daily_grid(
        date(2026, 11, 13),
        [27.75],
        [85.35],
        [[14.06]],
        [[48]],
        "3B-DAY-L.MS.MRG.3IMERG.20261113-S000000-E235959.V07C",
        datetime(2026, 11, 14, 14, 0, tzinfo=timezone.utc),
    )

    assert count == 1
    with cache._connect() as conn:
        row = conn.execute("SELECT version FROM imerg_daily_cells").fetchone()

    assert row["version"] == "07C"
