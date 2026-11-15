/**
 * Robust averaging of GPS fixes taken while the farmer stands still.
 * Pure function: no browser APIs. All thresholds are passed in (config), none are hard-coded here.
 *
 * Honest limits: averaging reduces random noise, NOT systematic error (multipath, atmosphere).
 * Fixes are correlated in time, so we do NOT claim error shrinks with sqrt(N).
 * `accuracyM` from the browser is a 95% confidence radius in meters.
 */
export interface Fix {
  lat: number;
  lon: number;
  accuracyM: number; // 95% confidence radius
  timestamp: number; // ms
}

export interface AverageConfig {
  maxAccuracyM: number;     // discard fixes worse than this
  minFixes: number;         // need at least this many after filtering
  madK: number;             // outlier cut: distance > madK * MAD (+ floor)
  madFloorM: number;        // minimum spread so tight clusters keep their points
  goodM: number;            // class thresholds on estimated error
  fairM: number;
}

export type QualityClass = 'good' | 'fair' | 'poor';

export interface AverageResult {
  lat: number;
  lon: number;
  usedFixes: number;
  rejectedFixes: number;
  medianReportedAccuracyM: number;
  spread95M: number;        // 95th percentile distance of used fixes from the mean
  estimatedErrorM: number;  // conservative: max(median reported accuracy, spread95)
  quality: QualityClass;
}

const R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil(p * s.length) - 1);
  return s[Math.max(0, idx)];
}

export function averageFixes(fixes: Fix[], cfg: AverageConfig): AverageResult | null {
  const valid = fixes.filter(
    (f) =>
      Number.isFinite(f.lat) && Number.isFinite(f.lon) &&
      Number.isFinite(f.accuracyM) && f.accuracyM > 0 && f.accuracyM <= cfg.maxAccuracyM
  );
  if (valid.length < cfg.minFixes) return null;

  // local plane around the first valid fix
  const lat0 = valid[0].lat, lon0 = valid[0].lon;
  const cos0 = Math.cos(toRad(lat0));
  const pts = valid.map((f) => ({
    x: R * toRad(f.lon - lon0) * cos0,
    y: R * toRad(f.lat - lat0),
    acc: f.accuracyM,
  }));

  // robust centre: per-axis median, then drop far outliers
  const mx = median(pts.map((p) => p.x));
  const my = median(pts.map((p) => p.y));
  const d = pts.map((p) => Math.hypot(p.x - mx, p.y - my));
  const mad = median(d);
  const cut = Math.max(cfg.madK * mad, cfg.madFloorM);
  const kept = pts.filter((_, i) => d[i] <= cut);
  if (kept.length < cfg.minFixes) return null;

  // inverse-variance weights (1 / accuracy^2)
  let sw = 0, sx = 0, sy = 0;
  for (const p of kept) {
    const w = 1 / (p.acc * p.acc);
    sw += w; sx += w * p.x; sy += w * p.y;
  }
  const cx = sx / sw, cy = sy / sw;

  const dist = kept.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const spread95M = percentile(dist, 0.95);
  const medAcc = median(kept.map((p) => p.acc));
  const estimatedErrorM = Math.max(medAcc, spread95M);

  const lat = lat0 + (cy / R) * (180 / Math.PI);
  const lon = lon0 + (cx / (R * cos0)) * (180 / Math.PI);

  return {
    lat, lon,
    usedFixes: kept.length,
    rejectedFixes: fixes.length - kept.length,
    medianReportedAccuracyM: medAcc,
    spread95M,
    estimatedErrorM,
    quality: estimatedErrorM <= cfg.goodM ? 'good' : estimatedErrorM <= cfg.fairM ? 'fair' : 'poor',
  };
}
