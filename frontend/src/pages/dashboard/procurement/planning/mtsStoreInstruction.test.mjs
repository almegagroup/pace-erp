import assert from "node:assert/strict";
import test from "node:test";
import { aggregateStoreItems, normaliseStoreRows, transferRows } from "./mtsStoreInstruction.js";

test("child groups of one parent that use the same item share ONE row; a different parent stays a separate row", () => {
  const rows = normaliseStoreRows([
    { period: "CM", period_label: "CM (rest)", material_id: "m1", material_name: "Tartaric Acid", group_label: "ACID", mother_group: "PUTTY", child_group: "EXT PUTTY", executable_qty: 100, not_backed_qty: 0, uom: "KG" },
    { period: "CM", period_label: "CM (rest)", material_id: "m1", material_name: "Tartaric Acid", group_label: "ACID", mother_group: "PUTTY", child_group: "INT PUTTY", executable_qty: 50, not_backed_qty: 10, uom: "KG" },
    { period: "CM", period_label: "CM (rest)", material_id: "m1", material_name: "Tartaric Acid", group_label: "ACID", mother_group: "PUTTY", child_group: "EXT PUTTY", executable_qty: 25, not_backed_qty: 0, uom: "KG" },
    { period: "CM", period_label: "CM (rest)", material_id: "m1", material_name: "Tartaric Acid", group_label: "ACID", mother_group: "PAINT", child_group: "PRIMER", executable_qty: 7, not_backed_qty: 0, uom: "KG" },
    { period: "NM", period_label: "NM · Nov", material_id: "m1", material_name: "Tartaric Acid", group_label: "ACID", mother_group: "PUTTY", child_group: "EXT PUTTY", executable_qty: 40, not_backed_qty: 0, uom: "KG" },
  ]);
  const items = aggregateStoreItems(rows);
  assert.equal(items.length, 3, "PUTTY CM, PAINT CM, PUTTY NM");
  const putty = items.find((i) => i.mother === "PUTTY" && i.period === "CM (rest)");
  assert.equal(putty.qty, 175);
  assert.equal(putty.not_backed, 10);
  assert.equal(putty.child, "EXT PUTTY; INT PUTTY", "both child groups on one row");
  assert.equal(items[0].period, "CM (rest)", "current month first");
});

test("a group remainder with no material is listed as not assigned and keeps its own row", () => {
  const items = aggregateStoreItems(normaliseStoreRows([{ period: "NM", period_label: "NM", material_id: null, group_id: "g1", group_label: "MHEC", mother_group: "PUTTY", child_group: "EXT", executable_qty: 0, not_backed_qty: 90, uom: null }]));
  assert.equal(items[0].item, "MHEC — not assigned");
  assert.equal(items[0].not_backed, 90);
});

test("transfers read by date, then item", () => {
  const rows = transferRows([
    { by: "2026-11-01", material_name: "B", from: "R001", to: "R002" },
    { by: "2026-10-28", material_name: "Z", from: "R003", to: "R001" },
    { by: "2026-10-28", material_name: "A", from: "R003", to: "R002" },
  ]);
  assert.deepEqual(rows.map((r) => r.material_name), ["A", "Z", "B"]);
});
