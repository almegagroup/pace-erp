import assert from "node:assert/strict";
import test from "node:test";
import { flowRows, matrixGrid, waterfallVerdict } from "./mtsWaterfall.js";

const waterfall = {
  events: [
    { day: "2026-10-28", kind: "OPENING_RESERVE", level_kind: "GROUP", level: "Group B", qty: 85797, wanted: 85797, shortfall: 0, pool_before: 108754, pool_after: 22957, by_material: [{ material: "TS", qty: 26000 }], references: [] },
    { day: "2026-11-12", kind: "RECEIPT", level_kind: "POOL", level: "Pool", material: "TS", qty: 25000, wanted: 0, shortfall: 0, pool_before: 0, pool_after: 0, by_material: [], references: ["PO ASC/PO123 · CSN 3000000229"] },
    { day: "2027-03-19", kind: "TOP_UP", level_kind: "GROUP", level: "Group B", qty: 14655, wanted: 43559, shortfall: 28904, pool_before: 14655, pool_after: 0, by_material: [{ material: "Gabrosa", qty: 12294 }], references: [] },
  ],
  matrix: [{
    day: "2026-10-28",
    levels: [{ level: "Exclusive — Gabrosa", by_material: [{ material: "Gabrosa", qty: 6670 }] }, { level: "Group B", by_material: [{ material: "Gabrosa", qty: 100 }, { material: "TS", qty: 900 }] }],
    pool: [{ material: "Gabrosa", qty: 230 }, { material: "TS", qty: 100 }],
    closing: [{ material: "Gabrosa", qty: 7000 }, { material: "TS", qty: 1000 }],
  }],
};

test("flow rows say what happened in words, one row per event day", () => {
  const rows = flowRows(waterfall);
  assert.equal(rows.length, 3);
  assert.match(rows[1].what, /Receipt lands in the pool.*CSN 3000000229/);
  assert.equal(rows[2].short, true);
  assert.match(rows[2].detail, /Gabrosa: 12,294/);
});

test("the Material x Level grid adds up row by row and says so", () => {
  const grid = matrixGrid(waterfall, "2026-10-28");
  assert.deepEqual(grid.levels, ["Exclusive — Gabrosa", "Group B"]);
  assert.equal(grid.rows[0].held, 7000);
  assert.equal(grid.ok, true);
  const broken = matrixGrid({ ...waterfall, matrix: [{ ...waterfall.matrix[0], closing: [{ material: "Gabrosa", qty: 9999 }, { material: "TS", qty: 1000 }] }] });
  assert.equal(broken.ok, false);
});

test("the first sentence names the short level, the amount, the date and the order", () => {
  const verdict = waterfallVerdict(waterfall, [{ material_name: "TS U2121", qty: 25000, po_by: "2027-01-12", eta_plant: "2027-03-18" }]);
  assert.equal(verdict.tone, "warn");
  assert.match(verdict.text, /Group B will be short about 28,904 KG from 2027-03-19/);
  assert.match(verdict.text, /Order TS U2121 \(25,000\) by 2027-01-12/);
  const fine = waterfallVerdict({ events: [waterfall.events[0]] });
  assert.equal(fine.tone, "ok");
});

test("a short Exclusive level is shown as the worst case", () => {
  const verdict = waterfallVerdict({ events: [{ day: "2027-03-27", kind: "TOP_UP", level_kind: "OWN", level: "Exclusive — Gabrosa", shortfall: 3335 }] });
  assert.equal(verdict.tone, "bad");
});
