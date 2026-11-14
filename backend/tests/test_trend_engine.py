import numpy as np
import pytest
from app.stats.trend_engine import TrendEngine


def test_trend_engine_recovers_known_slope():
    # Generate 30 years of data with a known upward trend of +0.5 days/year (+5.0 days/decade)
    np.random.seed(42)
    years = list(range(1995, 2025))
    base = 10.0
    trend = 0.5
    noise = np.random.normal(0, 1.0, size=len(years))
    values = [base + (yr - 1995) * trend + ns for yr, ns in zip(years, noise)]

    res = TrendEngine.analyze_heavy_rain_trend(years, values)

    # Theil-Sen slope should be close to 5.0 days/decade
    assert 4.0 <= res.theil_sen_slope_per_decade <= 6.0
    assert res.significant_after_fdr is True
    assert "consistent with" in res.plain_language_summary


def test_trend_engine_false_positive_rate_on_pure_noise():
    # Run 100 simulations of pure random noise; false positive rate (p < 0.05) should be near 5%
    np.random.seed(100)
    false_positives = 0
    simulations = 100
    years = list(range(2000, 2025))

    for _ in range(simulations):
        noise_values = np.random.normal(20.0, 3.0, size=len(years))
        res = TrendEngine.analyze_heavy_rain_trend(years, list(noise_values), alpha=0.05)
        if res.significant_after_fdr:
            false_positives += 1

    fpr = false_positives / simulations
    # Allowable window for stochastic noise test: 0% to 15%
    assert fpr <= 0.15


def test_benjamini_hochberg_adjustment():
    p_vals = [0.001, 0.02, 0.04, 0.50, 0.80]
    adj = TrendEngine.apply_benjamini_hochberg(p_vals, alpha=0.05)
    assert len(adj) == 5
    assert adj[0] <= adj[1] <= adj[3]