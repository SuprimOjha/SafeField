/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function loadTs(relativePath) {
  const source = fs.readFileSync(require("node:path").join(__dirname, "..", relativePath), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputText, { module, exports: module.exports, require });
  return module.exports;
}
const { averageFixes } = loadTs("src/lib/gps-average.ts");
const { polygonSelfIntersects, pointInRing, pointInDistricts } = loadTs("src/lib/field-geometry.ts");

// Arbitrary TEST thresholds, not recommended product values.
const surveyCfg = { maxAccuracyM: 15, minFixes: 2, madK: 3, madFloorM: 5, goodM: 10, fairM: 20 };

test("averageFixes averages accepted fixes and rejects poor accuracy", () => {
  const result = averageFixes([
    { lat: 27, lon: 85, accuracyM: 5, timestamp: 0 },
    { lat: 27.0002, lon: 85.0002, accuracyM: 10, timestamp: 1000 },
    { lat: 27.5, lon: 85.5, accuracyM: 30, timestamp: 2000 },
  ], surveyCfg);
  assert.equal(result.usedFixes, 2);
  assert.equal(result.rejectedFixes, 1);
  assert.ok(Math.abs(result.lat - 27.0001) < 1e-3);
  assert.ok(Math.abs(result.lon - 85.0001) < 1e-3);
});

test("averageFixes returns unavailable when every fix fails quality checks", () => {
  const result = averageFixes([
    { lat: 27, lon: 85, accuracyM: 0, timestamp: 0 },
    { lat: 27.001, lon: 85.001, accuracyM: 30, timestamp: 1000 },
  ], surveyCfg);
  assert.equal(result, null);
});

test("polygonSelfIntersects detects crossing edges and accepts a simple ring", () => {
  assert.equal(polygonSelfIntersects([[0,0],[2,2],[0,2],[2,0]]), true);
  assert.equal(polygonSelfIntersects([[0,0],[2,0],[2,2],[0,2]]), false);
});

test("pointInRing includes boundary and excludes exterior points", () => {
  const ring = [[0,0],[4,0],[4,4],[0,4]];
  assert.equal(pointInRing([2,2], ring), true);
  assert.equal(pointInRing([4,2], ring), true);
  assert.equal(pointInRing([5,2], ring), false);
});

test("pointInDistricts handles polygon geometry", () => {
  const districts = [{ type: "Polygon", coordinates: [[[80,26],[88,26],[88,30],[80,30],[80,26]]] }];
  assert.equal(pointInDistricts([85,28], districts), true);
  assert.equal(pointInDistricts([90,28], districts), false);
});
