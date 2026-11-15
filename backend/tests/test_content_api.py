from fastapi.testclient import TestClient

from app.api import routes
from app.main import create_app


def test_content_endpoint_reports_installed_packs():
    response = TestClient(create_app()).get("/api/content")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] in {"ok", "partial", "error"}
    assert isinstance(body["sources"], dict)
    assert isinstance(body["fertilizer_references"], list)
    assert isinstance(body["home_remedies"], list)
    assert isinstance(body["conversions"], list)
    assert isinstance(body["skipped"], dict)
    assert isinstance(body["warnings"], list)


def test_content_endpoint_maps_verified_records(monkeypatch):
    report = {
        "status": "ok",
        "source_records": {
            "src": {
                "title": "Official source",
                "authority": "Authority",
                "year": 2024,
                "url": "https://example.org/source",
                "accessed": "2026-11-14",
                "official": True,
                "language": "en",
            }
        },
        "fertilizer": [{"id": "ref-1", "verified": True, "sourceKey": "src"}],
        "remedies": [{"id": "rem-1", "verified": True, "sourceKey": "src"}],
        "conversions_data": [{"unit": "ropani", "toHectare": 0.0508, "sourceKey": "src", "verified": True}],
        "skipped": {"fertilizer": 0, "conversion": 0, "remedy": 0},
        "warnings": [],
    }
    monkeypatch.setattr(routes, "validate_content", lambda: report)

    body = TestClient(create_app()).get("/api/content").json()

    assert body["status"] == "ok"
    assert body["sources"] == report["source_records"]
    assert body["fertilizer_references"] == report["fertilizer"]
    assert body["home_remedies"] == report["remedies"]
    assert body["conversions"] == report["conversions_data"]
