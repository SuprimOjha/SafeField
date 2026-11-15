from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.api import routes
from app.main import create_app
from app.services.imerg.grid_cache import ImergGridCache


class _Provider:
    def __init__(self, cache):
        self.cache = cache

    @property
    def is_available(self) -> bool:
        return True


def test_status_probe_requires_both_coordinates(monkeypatch, tmp_path):
    cache = ImergGridCache(str(tmp_path / "status-pair.sqlite"))
    monkeypatch.setattr(routes, "ImergLateProvider", lambda: _Provider(cache))

    response = TestClient(create_app()).get("/api/integrations/imerg/status?probe_lat=27.4")

    assert response.status_code == 422


def test_status_probe_reports_point_lookup(monkeypatch, tmp_path):
    cache = ImergGridCache(str(tmp_path / "status-probe.sqlite"))
    today = datetime.now(timezone.utc).date()
    days = [today - timedelta(days=offset) for offset in (1, 2, 3)]
    for day in days:
        cache.store_daily_grid(
            day,
            [27.5],
            [85.25],
            [[1.0]],
            [[48]],
            f"3B-DAY-L.MS.MRG.3IMERG.{day:%Y%m%d}-S000000-E235959.V07C",
            datetime.now(timezone.utc),
        )
    monkeypatch.setattr(routes, "ImergLateProvider", lambda: _Provider(cache))

    response = TestClient(create_app()).get(
        "/api/integrations/imerg/status?probe_lat=27.46&probe_lon=85.28"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "CACHE_READY"
    assert body["point_probe"]["nearest_cell"] == [27.5, 85.25]
    assert body["point_probe"]["matched_days"] == sorted(day.isoformat() for day in days)
