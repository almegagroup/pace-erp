import test from "node:test";
import assert from "node:assert/strict";
import { applySheetDeltas, typedToDeltas } from "./mtsSheetGrid.js";

const grid = [1, 2, 3, 4].map((n) => ({ day: `2026-12-0${n}`, opening: 1000 - (n - 1) * 100, use: 100, closing: 1000 - n * 100, min_stock: 1000 - n * 100, prorata_max_days: 9 - n + 1, prorata_min_days: 9 - n + 1 }));

test("a quantity typed on a day lifts that day's Closing and every later Opening/Closing", () => {
  const out = applySheetDeltas(grid, { "2026-12-02": 500 });
  assert.equal(out[0].closing, 900, "days before are untouched");
  assert.equal(out[1].opening, 900);
  assert.equal(out[1].closing, 1300, "same day: closing includes the lot");
  assert.equal(out[1].min_stock, 800, "same day: Min Stock is before the lot lands");
  assert.equal(out[1].prorata_max_days, 13);
  assert.equal(out[1].prorata_min_days, 8);
  assert.equal(out[2].opening, 1300);
  assert.equal(out[3].closing, 1000 - 400 + 500);
});

test("a negative quantity lowers Max Days", () => {
  const out = applySheetDeltas(grid, { "2026-12-02": -300 });
  assert.equal(out[1].closing, 500);
  assert.equal(out[1].prorata_max_days, 5);
  assert.equal(out[3].closing, 300, "later days carry the reduction (600 − 300)");
});

test("no change returns the same rows", () => {
  assert.equal(applySheetDeltas(grid, {}), grid);
});

test("typedToDeltas: saved lots are not counted twice, a preview only keeps the below-zero part", () => {
  assert.deepEqual(typedToDeltas({ a: 500 }, { a: 200 }, false), { a: 300 });
  assert.deepEqual(typedToDeltas({ a: 500 }, { a: 200 }, true), { a: 0 });
  assert.deepEqual(typedToDeltas({ a: -10000 }, {}, true), { a: -10000 });
  assert.deepEqual(typedToDeltas({ a: -10000 }, {}, false), { a: -10000 });
});
