// Climate trend engine (port of stats/trend_engine.py). Implements the
// Theil-Sen slope estimator with a Sen (1968) rank-based confidence interval,
// the original Mann-Kendall test with tie correction, lag-1 autocorrelation
// variance inflation, and a plain-language summary. Pure TypeScript — no
// numpy/scipy/pymannkendall required on the server.

import type { TrendAnalysisResult } from "@/types/safefield";

const ALPHA = 0.05;
const Z_975 = 1.959963984540054; // two-sided 95% normal quantile

/** Abramowitz & Stegun 7.1.26 erf approximation (|error| < 1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Upper-tail probability of the standard normal distribution. */
function normalSf(z: number): number {
  return 0.5 * (1 - erf(z / Math.SQRT2));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function interpolateRank(sortedValues: number[], rank1based: number): number {
  const index0 = Math.max(0, Math.min(sortedValues.length - 1, Math.floor(rank1based) - 1));
  const fraction = rank1based - Math.floor(rank1based);
  const next = Math.min(sortedValues.length - 1, index0 + 1);
  return sortedValues[index0] + fraction * (sortedValues[next] - sortedValues[index0]);
}

/** Ordinary least-squares slope (scipy linregress equivalent). */
function olsSlope(x: number[], y: number[]): number {
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - meanX) * (y[i] - meanY);
    den += (x[i] - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Theil-Sen slope: median of all pairwise slopes. */
function theilSenSlope(x: number[], y: number[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < x.length; i++) {
    for (let j = i + 1; j < x.length; j++) {
      if (x[j] !== x[i]) slopes.push((y[j] - y[i]) / (x[j] - x[i]));
    }
  }
  return slopes.length ? median(slopes) : 0;
}

/**
 * Sen (1968) rank-based confidence interval for the Theil-Sen slope,
 * following Gilbert (1987) section 16.4.2: the CI bounds are the order
 * statistics of the pairwise-slope distribution at ranks (N ± Cα)/2, where
 * Cα = z * sqrt(n(n-1)(2n+5)/18).
 */
function theilSenCi(x: number[], y: number[]): { lower: number; upper: number } {
  const n = x.length;
  const slopes: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (x[j] !== x[i]) slopes.push((y[j] - y[i]) / (x[j] - x[i]));
    }
  }
  if (!slopes.length) return { lower: 0, upper: 0 };
  const sorted = [...slopes].sort((a, b) => a - b);
  const totalPairs = slopes.length;
  const cAlpha = Z_975 * Math.sqrt((n * (n - 1) * (2 * n + 5)) / 18);
  const lowerRank = (totalPairs - cAlpha) / 2;
  const upperRank = (totalPairs + cAlpha) / 2;
  return {
    lower: interpolateRank(sorted, Math.max(1, lowerRank)),
    upper: interpolateRank(sorted, Math.min(totalPairs, upperRank)),
  };
}

/** Original Mann-Kendall test (pymannkendall.original_test equivalent). */
function mannKendallPValue(values: number[]): number {
  const n = values.length;
  let s = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      s += Math.sign(values[j] - values[i]);
    }
  }

  // Tie correction
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let tieTerm = 0;
  for (const count of counts.values()) {
    if (count > 1) tieTerm += count * (count - 1) * (2 * count + 5);
  }
  const variance = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  if (variance <= 0) return 1.0;

  const z = s > 0 ? (s - 1) / Math.sqrt(variance) : s < 0 ? (s + 1) / Math.sqrt(variance) : 0;
  let p = normalSf(Math.abs(z)) * 2;
  if (!Number.isFinite(p) || p < 0) p = 0;
  return Math.min(1, Math.max(0, p));
}

/** Lag-1 Pearson autocorrelation of the series. */
function lag1Autocorrelation(values: number[]): number {
  const n = values.length;
  if (n < 3) return 0;
  const a = values.slice(0, n - 1);
  const b = values.slice(1);
  const meanA = a.reduce((x, y) => x + y, 0) / a.length;
  const meanB = b.reduce((x, y) => x + y, 0) / b.length;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - meanA) * (b[i] - meanB);
    denA += (a[i] - meanA) ** 2;
    denB += (b[i] - meanB) ** 2;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function analyzeHeavyRainTrend(years: number[], annualHeavyRainDays: number[]): TrendAnalysisResult {
  const n = annualHeavyRainDays.length;
  if (n < 5) {
    return {
      variable_name: "Heavy Rain Days per Season",
      years_analyzed: n,
      total_observations: n,
      raw_slope_per_decade: 0.0,
      theil_sen_slope_per_decade: 0.0,
      confidence_interval_lower: 0.0,
      confidence_interval_upper: 0.0,
      mann_kendall_p_value: 1.0,
      corrected_p_value: 1.0,
      significant_before_fdr: false,
      significant_after_fdr: false,
      plain_language_summary: "Insufficient historical records for trend analysis (fewer than 5 years).",
    };
  }

  const slopePerDecade = round3(theilSenSlope(years, annualHeavyRainDays) * 10.0);
  const ci = theilSenCi(years, annualHeavyRainDays);
  const ciLower = round3(ci.lower * 10.0);
  const ciUpper = round3(ci.upper * 10.0);
  const rawSlopeDecade = round3(olsSlope(years, annualHeavyRainDays) * 10.0);

  let pValue = mannKendallPValue(annualHeavyRainDays);
  if (n > 6) {
    const r1 = lag1Autocorrelation(annualHeavyRainDays);
    if (Number.isFinite(r1) && Math.abs(r1) > 0.2) {
      const nEff = Math.max(4.0, (n * (1.0 - r1)) / (1.0 + r1));
      const inflation = Math.sqrt(Math.max(0, n / nEff));
      pValue = Math.min(1.0, pValue * inflation);
    }
  }
  pValue = Math.round(pValue * 10000) / 10000;
  const sigBefore = pValue < ALPHA;
  const correctedP = pValue;
  const sigAfter = correctedP < ALPHA;

  let summary: string;
  if (sigAfter && slopePerDecade > 0) {
    summary = `Data is consistent with an increasing trend in heavy-rain frequency (+ ${slopePerDecade} days/decade, p = ${correctedP}).`;
  } else if (sigAfter && slopePerDecade < 0) {
    summary = `Data is consistent with a decreasing trend in heavy-rain frequency (${slopePerDecade} days/decade, p = ${correctedP}).`;
  } else {
    summary = `No statistically significant shift detected in heavy-rain frequency (slope ${slopePerDecade} days/decade, p = ${correctedP}). Record appears stable or noisy.`;
  }

  return {
    variable_name: "Heavy Rain Days per Season",
    years_analyzed: n,
    total_observations: n,
    raw_slope_per_decade: rawSlopeDecade,
    theil_sen_slope_per_decade: slopePerDecade,
    confidence_interval_lower: ciLower,
    confidence_interval_upper: ciUpper,
    mann_kendall_p_value: pValue,
    corrected_p_value: correctedP,
    significant_before_fdr: sigBefore,
    significant_after_fdr: sigAfter,
    plain_language_summary: summary,
  };
}
