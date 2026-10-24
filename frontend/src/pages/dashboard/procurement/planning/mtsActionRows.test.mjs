import assert from "node:assert/strict";
import test from "node:test";
import { buildActionRows } from "./mtsActionRows.js";

const plan = {
  calendar: { as_of: "2026-10-20" },
  risks: [
    { material_id: "A", first_shortage_day: "2026-10-24", first_below_critical_day: "2026-10-22" },
    { material_id: "B", first_shortage_day: null, first_below_critical_day: null },
    { material_id: "C", first_shortage_day: "2026-11-07", first_below_critical_day: null },
  ],
  buys: [
    { material_id: "A", material_name: "GABROSA", status: "ADVISORY_LATE", sequence: 1, recommended_po_qty_base: 20000, recommended_po_by: "2026-10-20", estimated_plant_eta: "2026-11-30", need_date: "2026-10-25", total_lead_time_days: 41, vendor_label: "V1" },
    { material_id: "B", material_name: "COMBIZELL", status: "ADVISORY", sequence: 1, recommended_po_qty_base: 25000, recommended_po_by: "2026-11-15", estimated_plant_eta: "2026-12-10", need_date: "2026-12-10", vendor_label: "V2" },
    { material_id: "B", material_name: "COMBIZELL", status: "ADVISORY", sequence: 2, recommended_po_qty_base: 25000, recommended_po_by: "2026-10-24", estimated_plant_eta: "2026-12-20", need_date: "2026-12-20", vendor_label: "V2" },
    { material_id: "C", material_name: "ELOTEX MP 2050", status: "UNKNOWN_POLICY", sequence: 0, required_qty_base: 671 },
    { material_id: "D", material_name: "TS U2121", status: "NO_BUY", sequence: 0 },
  ],
  group_assignments: [{ group_id: "G", group_label: "MHEC", month: "2026-12-01", reason: "NONE_SELECTED", uncovered_qty: 400 }],
  group_actions: [{ group_id: "G", group_label: "MHEC", first_below_critical_day: "2026-10-23", first_shortage_day: "2026-10-24", unresolved_qty_base: 400, ordered_actions: ["Bridge lot", "Transfer", "Escalate emergency"] }],
  arrival_flags: [{ material_id: "A", material_name: "GABROSA", reason: "ETA_PASSED", document: "CSN 1", message: "update it" }],
};

test("actions are ordered urgent → this week → planned → fix data, then by date", () => {
  const rows = buildActionRows(plan);
  assert.deepEqual(rows.map((r) => [r.level, r.material, r.action]), [
    ["URGENT", "GABROSA", "Order today"],
    ["URGENT", "MHEC", "Resolve group stock-out risk"],
    ["URGENT", "ELOTEX MP 2050", "Set Target / Critical days"],
    ["SOON", "GABROSA", "Update CSN ETA (overdue)"],
    ["SOON", "COMBIZELL", "Order (next order #2)"],
    ["PLAN", "COMBIZELL", "Order"],
    ["FIX_DATA", "MHEC", "Set up a vendor for a member of this group"],
  ]);
});

test("no-buy materials never appear", () => {
  assert.equal(buildActionRows(plan).some((r) => r.material === "TS U2121"), false);
  assert.deepEqual(buildActionRows(null), []);
});
