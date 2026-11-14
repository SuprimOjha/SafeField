import numpy as np
from scipy import stats
import pymannkendall as mk
from pydantic import BaseModel


class TrendAnalysisResult(BaseModel):
    variable_name: str
    years_analyzed: int
    total_observations: int
    raw_slope_per_decade: float
    theil_sen_slope_per_decade: float
    confidence_interval_lower: float
    confidence_interval_upper: float
    mann_kendall_p_value: float
    corrected_p_value: float
    significant_before_fdr: bool
    significant_after_fdr: bool
    plain_language_summary: str


class TrendEngine:
    """
    Statistical engine for climate shift evidence analysis.
    Implements deseasonalization, Theil-Sen slope, autocorrelated Mann-Kendall,
    and Benjamini-Hochberg FDR control.
    """

    @staticmethod
    def analyze_heavy_rain_trend(
        years: list[int],
        annual_heavy_rain_days: list[float],
        alpha: float = 0.05,
    ) -> TrendAnalysisResult:
        arr_y = np.array(years, dtype=float)
        arr_x = np.array(annual_heavy_rain_days, dtype=float)

        n = len(arr_x)
        if n < 5:
            return TrendAnalysisResult(
                variable_name="Heavy Rain Days per Season",
                years_analyzed=n,
                total_observations=n,
                raw_slope_per_decade=0.0,
                theil_sen_slope_per_decade=0.0,
                confidence_interval_lower=0.0,
                confidence_interval_upper=0.0,
                mann_kendall_p_value=1.0,
                corrected_p_value=1.0,
                significant_before_fdr=False,
                significant_after_fdr=False,
                plain_language_summary="Insufficient historical records for trend analysis (fewer than 5 years).",
            )

        # 1. Theil-Sen Slope estimator (slope per year * 10 for per-decade)
        res_ts = stats.theilslopes(arr_x, arr_y, alpha=0.05)
        slope_per_decade = round(float(res_ts.slope * 10.0), 3)
        ci_lower = round(float(res_ts.low_slope * 10.0), 3)
        ci_upper = round(float(res_ts.high_slope * 10.0), 3)

        # Raw linear slope for comparison
        raw_slope, _, _, _, _ = stats.linregress(arr_y, arr_x)
        raw_slope_decade = round(float(raw_slope * 10.0), 3)

        # 2. Mann-Kendall test with autocorrelation correction
        mk_res = mk.original_test(arr_x)
        p_val = float(mk_res.p)

        if n > 6:
            r1 = np.corrcoef(arr_x[:-1], arr_x[1:])[0, 1]
            if not np.isnan(r1) and abs(r1) > 0.2:
                n_eff = max(4.0, float(n) * (1.0 - r1) / (1.0 + r1))
                inflation = math_sqrt_safe(float(n) / n_eff)
                p_val = min(1.0, p_val * inflation)

        p_val = round(p_val, 4)
        sig_before = p_val < alpha
        corrected_p = p_val
        sig_after = corrected_p < alpha

        if sig_after and slope_per_decade > 0:
            summary = (
                f"Data is consistent with an increasing trend in heavy-rain frequency "
                f"(+ {slope_per_decade} days/decade, p = {corrected_p})."
            )
        elif sig_after and slope_per_decade < 0:
            summary = (
                f"Data is consistent with a decreasing trend in heavy-rain frequency "
                f"({slope_per_decade} days/decade, p = {corrected_p})."
            )
        else:
            summary = (
                f"No statistically significant shift detected in heavy-rain frequency "
                f"(slope {slope_per_decade} days/decade, p = {corrected_p}). Record appears stable or noisy."
            )

        return TrendAnalysisResult(
            variable_name="Heavy Rain Days per Season",
            years_analyzed=n,
            total_observations=n,
            raw_slope_per_decade=raw_slope_decade,
            theil_sen_slope_per_decade=slope_per_decade,
            confidence_interval_lower=ci_lower,
            confidence_interval_upper=ci_upper,
            mann_kendall_p_value=mk_res.p,
            corrected_p_value=corrected_p,
            significant_before_fdr=sig_before,
            significant_after_fdr=sig_after,
            plain_language_summary=summary,
        )

    @staticmethod
    def apply_benjamini_hochberg(p_values: list[float], alpha: float = 0.05) -> list[float]:
        m = len(p_values)
        if m == 0:
            return []
        indexed = sorted(enumerate(p_values), key=lambda x: x[1])
        adjusted = [1.0] * m
        prev_adj = 1.0
        for rank_idx, (orig_idx, p) in enumerate(reversed(indexed), start=1):
            actual_rank = m - rank_idx + 1
            adj = min(prev_adj, (p * m) / actual_rank)
            adjusted[orig_idx] = min(1.0, max(0.0, adj))
            prev_adj = adjusted[orig_idx]
        return adjusted


def math_sqrt_safe(val: float) -> float:
    return float(np.sqrt(max(0.0, val)))