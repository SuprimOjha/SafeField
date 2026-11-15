from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.services.forecast_client import _finite_number, _hourly_total


NEPAL = ZoneInfo("Asia/Kathmandu")


def test_hourly_total_sums_next_complete_48_hours():
    start = datetime.now(NEPAL).replace(minute=0, second=0, microsecond=0)
    times = [(start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(1, 50)]
    hourly = {"time": times, "precipitation": [0.5] * 49}
    assert _hourly_total(hourly, 48) == 24.0


def test_hourly_total_returns_none_when_hourly_data_has_a_gap():
    start = datetime(2026, 11, 14, 12, tzinfo=NEPAL)
    times = [(start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(1, 49)]
    precipitation = [0.0] * 48
    precipitation[17] = None
    assert _hourly_total({"time": times, "precipitation": precipitation}, 48) is None


def test_hourly_total_does_not_treat_missing_hours_as_zero():
    start = datetime(2026, 11, 14, 12, tzinfo=NEPAL)
    times = [(start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(1, 48)]
    assert _hourly_total({"time": times, "precipitation": [0.0] * 47}, 48) is None


def test_finite_number_rejects_nan_infinity_and_negative_rain():
    assert _finite_number([float("nan")], 0) is None
    assert _finite_number([float("inf")], 0) is None
    assert _finite_number([-0.1], 0, minimum=0) is None
    assert _finite_number([0.0], 0, minimum=0) == 0.0


def test_finite_number_accepts_valid_precipitation_probability():
    assert _finite_number([65], 0, minimum=0, maximum=100) == 65.0
    assert _finite_number([101], 0, minimum=0, maximum=100) is None
