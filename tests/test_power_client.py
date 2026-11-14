from app.services.power_client import NasaPowerClient


def make_payload(dates):
    return {
        "properties": {
            "parameter": {
                "PRECTOTCORR": {day: value for day, value in dates},
                "T2M": {day: 25.0 for day, _ in dates},
                "GWETTOP": {day: 0.4 for day, _ in dates},
                "GWETROOT": {day: 0.5 for day, _ in dates},
            }
        }
    }


def test_three_day_rain_total_requires_consecutive_calendar_days():
    client = NasaPowerClient()
    payload = make_payload([
        ("20261101", 1.0),
        ("20261103", 2.0),
        ("20261104", 3.0),
    ])
    result = client._parse_power_response(26.45, 87.28, payload, "2026-11-14T00:00:00+00:00", "LIVE")
    assert result.rain_last_72h_mm is None


def test_three_consecutive_daily_values_are_summed():
    client = NasaPowerClient()
    payload = make_payload([
        ("20261101", 1.0),
        ("20261102", 2.0),
        ("20261103", 3.0),
    ])
    result = client._parse_power_response(26.45, 87.28, payload, "2026-11-14T00:00:00+00:00", "LIVE")
    assert result.rain_last_72h_mm == 6.0
