import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { averageFixes, type Fix, type AverageConfig } from './gps-average';

// Arbitrary TEST thresholds, not recommended product values.
const cfg: AverageConfig = { maxAccuracyM: 50, minFixes: 3, madK: 3, madFloorM: 2, goodM: 5, fairM: 15 };
const M = 1 / 111195; // about 1 meter in degrees latitude
const fix = (dy: number, dx: number, acc: number, t = 0): Fix =>
  ({ lat: 27 + dy * M, lon: 85 + (dx * M) / Math.cos((27 * Math.PI) / 180), accuracyM: acc, timestamp: t });

describe('averageFixes', () => {
  it('averages a tight cluster near its centre', () => {
    const r = averageFixes([fix(0, 0, 4), fix(1, 0, 4), fix(-1, 0, 4), fix(0, 1, 4), fix(0, -1, 4)], cfg)!;
    assert.ok(Math.abs(r.lat - 27) * 111195 < 0.2);
    assert.equal(r.usedFixes, 5);
    assert.equal(r.quality, 'good');
  });

  it('rejects a far outlier', () => {
    const r = averageFixes([fix(0, 0, 4), fix(1, 0, 4), fix(0, 1, 4), fix(-1, 0, 4), fix(40, 40, 4)], cfg)!;
    assert.equal(r.usedFixes, 4);
    assert.equal(r.rejectedFixes, 1);
  });

  it('discards fixes worse than maxAccuracy', () => {
    const r = averageFixes([fix(0, 0, 4), fix(0, 1, 4), fix(1, 0, 4), fix(30, 0, 80)], cfg)!;
    assert.equal(r.usedFixes, 3);
  });

  it('returns null with too few usable fixes', () => {
    assert.equal(averageFixes([fix(0, 0, 4), fix(1, 0, 4)], cfg), null);
    assert.equal(averageFixes([fix(0, 0, 90), fix(1, 0, 90), fix(2, 0, 90)], cfg), null);
  });

  it('weights accurate fixes more', () => {
    const r = averageFixes([fix(0, 0, 2), fix(0, 0, 2), fix(6, 0, 20), fix(0, 0, 2)], { ...cfg, madFloorM: 10 })!;
    assert.ok(r.lat * 1 - 27 < 1 * M * 1); // pulled toward the accurate cluster
  });

  it('estimated error is at least the median reported accuracy', () => {
    const r = averageFixes([fix(0, 0, 12), fix(0, 0, 12), fix(0, 0, 12)], cfg)!;
    assert.ok(r.estimatedErrorM >= 12);
    assert.equal(r.quality, 'fair');
  });

  it('flags poor quality when error is large', () => {
    const r = averageFixes([fix(0, 0, 30), fix(0, 0, 30), fix(0, 0, 30)], cfg)!;
    assert.equal(r.quality, 'poor');
  });

  it('ignores non-finite input', () => {
    const bad: Fix = { lat: NaN, lon: 85, accuracyM: 5, timestamp: 0 };
    assert.equal(averageFixes([bad, bad, bad], cfg), null);
  });
});
