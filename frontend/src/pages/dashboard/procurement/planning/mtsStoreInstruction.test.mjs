import assert from "node:assert/strict";
import test from "node:test";
import { aggregateStoreItems, normaliseStoreRows, periodSpan, transferRows } from "./mtsStoreInstruction.js";

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

test("only group items are listed; the reserve to keep is shared over the parent-group rows by use and never counted twice", () => {
  const rows = normaliseStoreRows([
    { period: "CM", period_label: "CM (rest)", period_from: "2026-10-28", period_to: "2026-10-31", material_id: "m1", material_name: "TS U2121", group_id: "g", group_label: "MHEC", mother_group: "PUTTY", child_group: "EXT", executable_qty: 300, not_backed_qty: 0, uom: "KG", group_related: true, keep_qty: 1000, keep_max_days: 60 },
    { period: "CM", period_label: "CM (rest)", period_from: "2026-10-28", period_to: "2026-10-31", material_id: "m1", material_name: "TS U2121", group_id: "g", group_label: "MHEC", mother_group: "PAINT", child_group: "PRIMER", executable_qty: 100, not_backed_qty: 0, uom: "KG", group_related: true, keep_qty: 1000, keep_max_days: 60 },
    { period: "CM", period_label: "CM (rest)", material_id: "x", material_name: "Straight item", group_id: null, group_label: null, mother_group: "PUTTY", child_group: "EXT", executable_qty: 5, not_backed_qty: 0, uom: "KG", group_related: false, keep_qty: 0, keep_max_days: null },
  ]);
  assert.equal(rows.length, 2, "the straight item is not part of the Store group instructions");
  const items = aggregateStoreItems(rows);
  assert.equal(items.length, 2);
  assert.equal(items.reduce((s, i) => s + i.keep, 0), 1000, "keep 1000 is split 750 / 250, not repeated");
  assert.equal(items.find((i) => i.mother === "PUTTY").keep, 750);
  assert.equal(items[0].keep_days, 60);
});

test("the period shows from and to", () => {
  assert.equal(periodSpan("2026-10-28", "2026-10-31"), "28 Oct → 31 Oct");
  assert.equal(periodSpan(null, null), "");
});

test("month plan rows: actual stock first, the rest told plainly as not issuable", async () => {
  const { planItemRows, issueNote } = await import("./mtsStoreInstruction.js");
  const rows = planItemRows([
    { period_label: "November 2026", period_order: 1, material_id: "m1", material_name: "TS U2121", group_label: "MHEC", mother_group: "PUTTY", child_group: "EXT", use_stock: 0, use_arrival: 10, use_assumed: 5, use_lot: 0, keep_qty: 100, keep_max_days: 60, not_backed_qty: 0, level_kind: "GROUP" },
    { period_label: "October 2026 (from 28)", period_order: 0, material_id: "m1", material_name: "TS U2121", group_label: "MHEC", mother_group: "PUTTY", child_group: "EXT", use_stock: 40, use_arrival: 0, use_assumed: 0, use_lot: 0, keep_qty: 100, keep_max_days: 60, not_backed_qty: 0, level_kind: "GROUP" },
  ]);
  assert.equal(rows[0].period, "October 2026 (from 28)", "earlier period first");
  assert.equal(issueNote(rows[0]), "", "nothing waits on a receipt in October");
  assert.match(issueNote(rows[1]), /^Do not issue against: a CSN\/PO not received yet, a piece whose ETA passed or is missing\.$/);
});
