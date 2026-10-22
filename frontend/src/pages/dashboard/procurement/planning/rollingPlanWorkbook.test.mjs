import test from "node:test";
import assert from "node:assert/strict";
import { buildPlanMatrix, buildRollingPlanWorkbook, companyLabel, sheetName } from "./rollingPlanWorkbook.js";

const company = (id, name, extra = {}) => ({
  company_id: id, company_name: name, calendar: { as_of: "2026-10-21", horizon_end: "2026-12-31", months: ["2026-10-01", "2026-11-01", "2026-12-01"] },
  demand_label: "Current effective plan",
  summary: { materials_planned: 2, runs_out: 1, below_critical: 1, below_target: 1, new_orders: 1, new_orders_late: 0, new_order_value: 500000, arrivals_overdue: 0, arrivals_no_eta: 1, moves_advised: 1 },
  blocks: [{
    kind: "RM", title: "RDP", is_family: true, members: ["VAE A", "VAE B"], uom: "KG", target_days: 35, critical_days: 20, first_shortage_day: null,
    rows: [{ day: "2026-10-21", opening: 1000, arrivals: 0, dispatch: null, use: 100, closing: 900, max_days: 9, min_stock: 900, min_days: 9, references: [], qtys: [], suppliers: [], statuses: [], best_dates: [] },
      { day: "2026-11-06", opening: 500, arrivals: 24750, dispatch: null, use: 100, closing: 25150, max_days: 40, min_stock: 400, min_days: 4, references: ["PO ACP/PO80/2026-27/1"], qtys: [24750], suppliers: ["DAIREN"], statuses: ["IN_TRANSIT"], best_dates: ["2026-10-30 (prepone 7 d)"] }],
    prediction: [{ source: "ENGINE", import_etd: "2026-10-26", port_eta: "2026-11-05", date: "2026-11-10", qty: 25000, max_days: 35, min_days: 22, material: "VAE A", supplier: "CELANESE", po_by: "2026-10-01" }],
  }],
  requirement: [{ material: "VAE A", type: "RM", uom: "KG", target_cov_days: 35, critical_cov_days: 20, current_stk_days: 9, next_month_cov: 30, current_req: 1, current_prorata: 1, req_nm: 1, prorata_nm: 1, current_stock: 900, intransit_cm: 0, intransit_nm: 0, below_target: true, below_critical: true, first_shortage_day: "2026-10-30", first_below_critical_day: "2026-10-21" }],
  buys: [{ material: "VAE A", type: "RM", uom: "KG", late: false, po_by: "2026-10-01", qty: 25000, plant_eta: "2026-11-10", lots: "", supplier: "CELANESE", full_cost_per_unit: 20, value: 500000, cost_missing: "", reason: "Covers to Max days" }],
  store: [{ period: "CM (rest)", product: "Putty", source: "Stroke 1", line_type: "FIXED", group: null, material: "VAE A", uom: "KG", demand_qty: 100, from_stock: 100, not_backed: 0, transfer: null }],
  arrivals: [{ material: "VAE A", uom: "KG", reference: "PO ACP/PO80/2026-27/1", supplier: "DAIREN", status: "IN_TRANSIT", qty: 24750, source_eta: "2026-11-06", planning_eta: null, overdue: false, no_eta: false, movable: true, engine_best_date: "2026-10-30", engine_reason: "Prepone 7 d" }],
  plan: { months: ["2026-10", "2026-11", "2026-12"], rows: [{ sku_label: "AP EXT PTY 40 KG", base_uom_code: "BAG", mother_group_name: "PUTTY", child_group_name: "EXT PUTTY", plan: { "2026-10": { qty: 8371, base_source: "FINAL" }, "2026-11": { qty: 8565, base_source: "ROLLING" } } }] },
  notes: [],
  ...extra,
});

test("rolling plan workbook: every tab, both companies, PLAN totals per group", async () => {
  const wb = buildRollingPlanWorkbook({ companies: [company("a", "Almeha Coatings"), company("b", "Jayashree Industries")], asOf: "2026-10-21" });
  const names = wb.worksheets.map((s) => s.name);
  assert.deepEqual(names, ["SUMMARY", "PLAN", "RM_PLANNING", "PM_PLANNING", "Almeha Coatings RM_PM", "Jayashree Industries RM_PM", "BUY_PLAN", "STORE_INSTRUCTIONS", "ARRIVALS"]);
  const buffer = await wb.xlsx.writeBuffer();
  assert.ok(buffer.byteLength > 5000, "valid xlsx written");
  const rm = wb.getWorksheet("RM_PLANNING");
  const texts = [];
  rm.eachRow((row) => texts.push(String(row.getCell(1).value ?? "")));
  assert.ok(texts.includes("Almeha Coatings — RDP (family: VAE A, VAE B)") && texts.includes("Jayashree Industries — RDP (family: VAE A, VAE B)"), "one block per company");
  assert.ok(texts.includes("Prediction"), "prediction under the block");
});

test("PLAN matrix: company × month columns, empty SKUs dropped", () => {
  const m = buildPlanMatrix([company("a", "A"), company("b", "B", { plan: { months: ["2026-10"], rows: [{ sku_label: "X", plan: {} }] } })]);
  assert.equal(m.columns.length, 4);
  assert.equal(m.entries.length, 1);
  assert.equal(m.entries[0].qty.get("a|2026-10"), 8371);
  assert.deepEqual(m.columns.slice(0, 3).map((c) => c.basis), ["FINAL", "ROLLING", "No plan"], "plan basis per month");
});

test("sheet names: 31 chars, no illegal characters, unique", () => {
  const used = new Set();
  assert.equal(sheetName("A/B:C RM_PM", used), "A B C RM_PM");
  assert.equal(sheetName("A/B:C RM_PM", used), "A B C RM_PM (2)");
  const long = sheetName("x".repeat(40), used);
  assert.equal(long.length, 31);
  const longAgain = sheetName("x".repeat(40), used);
  assert.ok(longAgain.length <= 31 && longAgain.endsWith("(2)"));
});

test("companyLabel: an internal UUID is never exported as a company name", () => {
  assert.equal(companyLabel({ company_id: "0d5b448b-2f00-4c73-a2a6-8537f49f971b", company_name: "0d5b448b-2f00-4c73-a2a6-8537f49f971b", company_code: "CMP003" }), "CMP003");
  assert.equal(companyLabel({ company_id: "0d5b448b-2f00-4c73-a2a6-8537f49f971b", company_name: "0d5b448b-2f00-4c73-a2a6-8537f49f971b", company_code: "" }), "—");
});
