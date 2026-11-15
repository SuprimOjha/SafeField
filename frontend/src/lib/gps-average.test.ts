// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { averageFixes, Fix, AverageConfig } from './gps-average';

// Arbitrary TEST thresholds, not recommended product values.
const cfg: AverageConfig = { maxAccuracyM: 50, minFixes: 3, madK: 3, madFloorM: 2, goodM: 5, fairM: 15 };
const M = 1 / 111195; // about 1 meter in degrees latitude
const fix = (dy: number, dx: number, acc: number, t = 0): Fix =>
  ({ lat: 27 + dy * M, lon: 85 + (dx * M) / Math.cos((27 * Math.PI) / 180), accuracyM: acc, timestamp: t });

describe('averageFixes', () => {
  it('averages a tight cluster near its centre', () => {
    const r = averageFixes([fix(0, 0, 4), fix(1, 0, 4), fix(-1, 0, 4), fix(0, 1, 4), fix(0, -1, 4)], cfg)!;
    expect(Math.abs(r.lat - 27) * 111195).toBeLessThan(0.2);
    expect(r.usedFixes).toBe(5);
    expect(r.quality).toBe('good');
  });

  it('rejects a far outlier', () => {
    const r = averageFixes([fix(0, 0, 4), fix(1, 0, 4), fix(0, 1, 4), fix(-1, 0, 4), fix(40, 40, 4)], cfg)!;
    expect(r.usedFixes).toBe(4);
    expect(r.rejectedFixes).toBe(1);
  });

  it('discards fixes worse than maxAccuracy', () => {
    const r = averageFixes([fix(0, 0, 4), fix(0, 1, 4), fix(1, 0, 4), fix(30, 0, 80)], cfg)!;
    expect(r.usedFixes).toBe(3);
  });

  it('returns null with too few usable fixes', () => {
    expect(averageFixes([fix(0, 0, 4), fix(1, 0, 4)], cfg)).toBeNull();
    expect(averageFixes([fix(0, 0, 90), fix(1, 0, 90), fix(2, 0, 90)], cfg)).toBeNull();
  });

  it('weights accurate fixes more', () => {
    const r = averageFixes([fix(0, 0, 2), fix(0, 0, 2), fix(6, 0, 20), fix(0, 0, 2)], { ...cfg, madFloorM: 10 })!;
    expect(r.lat * 1 - 27).toBeLessThan(1 * M * 1); // pulled toward the accurate cluster
  });

  it('estimated error is at least the median reported accuracy', () => {
    const r = averageFixes([fix(0, 0, 12), fix(0, 0, 12), fix(0, 0, 12)], cfg)!;
    expect(r.estimatedErrorM).toBeGreaterThanOrEqual(12);
    expect(r.quality).toBe('fair');
  });

  it('flags poor quality when error is large', () => {
    const r = averageFixes([fix(0, 0, 30), fix(0, 0, 30), fix(0, 0, 30)], cfg)!;
    expect(r.quality).toBe('poor');
  });

  it('ignores non-finite input', () => {
    const bad: Fix = { lat: NaN, lon: 85, accuracyM: 5, timestamp: 0 };
    expect(averageFixes([bad, bad, bad], cfg)).toBeNull();
  });
});
