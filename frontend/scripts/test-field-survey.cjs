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

test("averageFixes averages accepted fixes and rejects poor accuracy", () => {
  const result = averageFixes([
    { latitude: 27, longitude: 85, accuracy: 5 },
    { latitude: 27.0002, longitude: 85.0002, accuracy: 10 },
    { latitude: 27.5, longitude: 85.5, accuracy: 30 },
  ], { maxAccuracyMeters: 15 });
  assert.equal(result.usedCount, 2);
  assert.equal(result.rejectedCount, 1);
  assert.ok(Math.abs(result.latitude - 27.0001) < 1e-10);
  assert.ok(Math.abs(result.longitude - 85.0001) < 1e-10);
});

test("averageFixes returns unavailable when every fix fails quality checks", () => {
  const result = averageFixes([{ latitude: 27, longitude: 85, accuracy: 0 }, { latitude: 100, longitude: 85, accuracy: 2 }]);
  assert.equal(result.latitude, null);
  assert.equal(result.usedCount, 0);
  assert.equal(result.rejectedCount, 2);
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
