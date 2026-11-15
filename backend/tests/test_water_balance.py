import pytest
from water_balance import *

# NOTE: numbers below are arbitrary TEST VECTORS for the arithmetic, not agronomic data.

def test_etc():
    assert etc_mm(0.5, 4.0) == 2.0

def test_taw_raw():
    t = taw_mm(100.0, 0.5)
    assert t == 50.0 and raw_mm(t, 0.5) == 25.0

def test_dry_day_increases_depletion():
    r = step(10, 0, 0, 5, 60)
    assert r.dr_mm == 15 and r.excess_mm == 0

def test_rain_refills_and_reports_excess():
    r = step(10, 20, 0, 5, 60)
    assert r.dr_mm == 0 and r.absorbed_mm == 15 and r.excess_mm == 5

def test_depletion_capped_at_taw():
    assert step(58, 0, 0, 5, 60).dr_mm == 60

def test_irrigation_counts_like_rain():
    assert step(30, 0, 25, 5, 60).dr_mm == 10

def test_ks_regions():
    assert ks(30, 60, 30) == 1.0
    assert ks(45, 60, 30) == 0.5
    assert ks(60, 60, 30) == 0.0

def test_days_until_trigger_no_rain():
    assert days_until_trigger(20, 30, 60, [4, 4, 4, 4]) == 3

def test_rain_delays_trigger():
    assert days_until_trigger(20, 30, 60, [4, 4, 4, 4], [0, 15, 0, 0]) is None

def test_trigger_already_reached():
    assert days_until_trigger(30, 30, 60, [1]) == 1

def test_volume_exact():
    assert irrigation_volume_litres(1, 1) == 10_000
    assert irrigation_volume_litres(20, 0.25) == 50_000

@pytest.mark.parametrize("bad", [(-1, 0, 0, 1, 60), (0, -1, 0, 1, 60)])
def test_negative_inputs_rejected(bad):
    with pytest.raises(ValueError):
        step(*bad)

def test_bad_p_rejected():
    with pytest.raises(ValueError):
        raw_mm(50, 0)
