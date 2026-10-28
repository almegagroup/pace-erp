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
  assert.deepEqual(names, ["SUMMARY", "PLAN", "RM_PLANNING", "PM_PLANNING", "Almeha Coatings RM_PM", "Jayashree Industries RM_PM", "BUY_PLAN", "STORE_INSTRUCTIONS", "STORE_EXCESS", "STORE_TRANSFERS", "STORE_DETAIL", "ARRIVALS", "WATERFALL_SUMMARY", "WATERFALL_LEVELS", "WATERFALL_FLOW", "WATERFALL_WHO_HOLDS"]);
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

test("EXPLAIN tabs: README, daily waterfall, draws and group dates; a group-covered alert stays amber with its remark", async () => {
  const explain = {
    daily: [
      { material: "COMBIZELL", uom: "KG", role: "Group only", day: "2026-11-26", opening: 40000, arrival: 0, engine_lot: 0, use: 1250, group_draw: 1250, closing: 38750, cover_days: 30, target_days: 30, critical_days: 20, flag: "AT / BELOW TARGET" },
      { material: "COMBIZELL", uom: "KG", role: "Group only", day: "2026-12-07", opening: 1000, arrival: 0, engine_lot: 0, use: 1250, group_draw: 1250, closing: -250, cover_days: 0, target_days: 30, critical_days: 20, flag: "STOCK-OUT" },
    ],
    draws: [{ day: "2026-11-26", material: "COMBIZELL", uom: "KG", destination: "MHEC", flow: "Group allocation", qty: 1250, closing: 38750, source: "Opening stock 6000000023", source_kind: "Counted opening stock" }],
    groups: [{ group: "MHEC", members: "COMBIZELL, TS U2121", first_below_target_day: null, first_below_critical_day: null, first_shortage_day: null, unresolved_qty: 0, actions: "" }],
  };
  const covered = { material: "COMBIZELL", type: "RM", uom: "KG", target_cov_days: 30, critical_cov_days: 20, current_stk_days: 60, next_month_cov: 40, current_req: 1, current_prorata: 1, req_nm: 1, prorata_nm: 1, current_stock: 1000, intransit_cm: 0, intransit_nm: 0, below_target: true, below_critical: true, first_shortage_day: "2026-12-07", first_below_critical_day: "2026-11-26", note: "Its own stock runs out, but group MHEC stays covered by: TS U2121 — no purchase needed for this item.", group_covered: true };
  const wb = buildRollingPlanWorkbook({ companies: [company("a", "Almeha Coatings", { explain, requirement: [covered] })], asOf: "2026-10-27" });
  const names = wb.worksheets.map((s) => s.name);
  assert.deepEqual(names.slice(-4), ["EXPLAIN_README", "EXPLAIN_DAILY", "EXPLAIN_DRAWS", "EXPLAIN_GROUPS"]);
  assert.deepEqual(names.slice(-8, -4), ["WATERFALL_SUMMARY", "WATERFALL_LEVELS", "WATERFALL_FLOW", "WATERFALL_WHO_HOLDS"]);
  const dailySheet = wb.getWorksheet("EXPLAIN_DAILY");
  assert.equal(dailySheet.rowCount, 3, "header + 2 daily rows");
  assert.equal(dailySheet.getRow(3).getCell(15).value, "STOCK-OUT");
  const summary = wb.getWorksheet("SUMMARY");
  let remark = "";
  summary.eachRow((row) => row.eachCell((cell) => { if (String(cell.value ?? "").startsWith("Its own stock runs out")) { remark = String(cell.value); assert.equal(cell.font?.color?.argb, "FFB45309", "group-covered alert is amber, not red"); } }));
  assert.ok(remark.includes("stays covered"), "the group-covered remark is on the Summary attention list");
  await wb.xlsx.writeBuffer();
});

test("WATERFALL tabs: one sentence per family, the levels, the flow and who holds what — the same blocks as 4A", async () => {
  const waterfall = {
    levels: [{ level_kind: "OWN", label: "Exclusive — Gabrosa", members: ["Gabrosa"], target_days: 30, critical_days: 20, max_days: 60, cover_days_now: 60, reserve_now: 6670, next_min_day: "2026-11-27" },
      { level_kind: "GROUP", label: "MHEC", members: ["Gabrosa", "Combizell", "TS U2121"], target_days: 30, critical_days: 15, max_days: 60, cover_days_now: 60, reserve_now: 84390, next_min_day: "2026-11-27" }],
    events: [
      { day: "2026-11-12", kind: "RECEIPT", level_kind: "POOL", level: "Pool", material: "TS U2121", qty: 25000, wanted: 0, shortfall: 0, pool_before: 0, pool_after: 0, by_material: [], references: ["PO ASC/PO123 · CSN 3000000229"] },
      { day: "2027-03-19", kind: "TOP_UP", level_kind: "GROUP", level: "MHEC", material: null, qty: 14655, wanted: 43559, shortfall: 28904, pool_before: 14655, pool_after: 0, by_material: [{ material: "Gabrosa", qty: 12294 }], references: [] },
    ],
    matrix: [{ day: "2026-10-28", levels: [{ level: "Exclusive — Gabrosa", by_material: [{ material: "Gabrosa", qty: 6670 }] }, { level: "MHEC", by_material: [{ material: "Gabrosa", qty: 100 }] }], pool: [{ material: "Gabrosa", qty: 230 }], closing: [{ material: "Gabrosa", qty: 7000 }] }],
  };
  const base = company("a", "Almeha Coatings");
  const withWaterfall = { ...base, blocks: [{ ...base.blocks[0], title: "MHEC", waterfall }] };
  const wb = buildRollingPlanWorkbook({ companies: [withWaterfall], asOf: "2026-10-28" });
  assert.equal(wb.getWorksheet("WATERFALL_SUMMARY").rowCount, 2, "header + one family");
  assert.match(String(wb.getWorksheet("WATERFALL_SUMMARY").getRow(2).getCell(4).value), /MHEC will be short about 28,904 KG from 2027-03-19/);
  assert.equal(wb.getWorksheet("WATERFALL_LEVELS").rowCount, 3, "header + two levels");
  assert.equal(wb.getWorksheet("WATERFALL_FLOW").rowCount, 3, "header + receipt + top-up");
  const holds = wb.getWorksheet("WATERFALL_WHO_HOLDS");
  const heldFor = [];
  holds.eachRow((row, n) => { if (n > 1) heldFor.push(String(row.getCell(5).value)); });
  assert.deepEqual(heldFor, ["Exclusive — Gabrosa", "MHEC", "Pool (excess)", "TOTAL STOCK"]);
  await wb.xlsx.writeBuffer();
});

test("STORE tabs: items by period with the child groups of one parent on ONE row, and the R-store transfers", async () => {
  const base = company("a", "Almeha Coatings");
  const store = [
    { period: "CM (rest)", mother_group: "PUTTY", child_group: "EXT PUTTY", product: "P1", source: "S1", line_type: "GROUP", group: "ACID", material: "Tartaric Acid", uom: "KG", demand_qty: 100, from_stock: 100, not_backed: 0 },
    { period: "CM (rest)", mother_group: "PUTTY", child_group: "INT PUTTY", product: "P2", source: "S2", line_type: "GROUP", group: "ACID", material: "Tartaric Acid", uom: "KG", demand_qty: 50, from_stock: 40, not_backed: 10 },
  ];
  const store_transfers = [{ material: "Tartaric Acid", uom: "KG", period: "CM (rest)", from: "R003", to: "R001", qty: 600, by: "2026-10-28" }, { material: "Tartaric Acid", uom: "KG", period: "NM", from: "R001", to: "R002", qty: 150, by: "2026-11-01" }];
  const wb = buildRollingPlanWorkbook({ companies: [{ ...base, store, store_transfers }], asOf: "2026-10-28" });
  const items = wb.getWorksheet("STORE_INSTRUCTIONS");
  assert.equal(items.rowCount, 2, "header + ONE row for both child groups");
  assert.equal(items.getRow(2).getCell(7).value, 140);
  assert.equal(items.getRow(2).getCell(13).value, "EXT PUTTY; INT PUTTY");
  const transfers = wb.getWorksheet("STORE_TRANSFERS");
  assert.equal(transfers.rowCount, 3);
  assert.deepEqual([transfers.getRow(2).getCell(5).value, transfers.getRow(2).getCell(6).value, transfers.getRow(2).getCell(7).value], ["R003", "R001", 600]);
  assert.ok(wb.getWorksheet("STORE_DETAIL"), "the old product-wise rows stay as STORE_DETAIL");
  await wb.xlsx.writeBuffer();
});

test("RM_PLANNING family block: whole-family note and each level (Exclusive and groups) with its own Min / Max / Critical", async () => {
  const base = company("a", "Almeha Coatings");
  const waterfall = { levels: [
    { level_kind: "OWN", label: "Exclusive — Gabrosa", members: ["Gabrosa"], target_days: 30, critical_days: 20, max_days: 60, cover_days_now: 60, reserve_now: 6670, next_min_day: "2026-11-27" },
    { level_kind: "GROUP", label: "MHEC", members: ["Gabrosa", "Combizell"], target_days: 30, critical_days: 15, max_days: 60, cover_days_now: 60, reserve_now: 84390, next_min_day: null }], events: [], matrix: [] };
  const wb = buildRollingPlanWorkbook({ companies: [{ ...base, blocks: [{ ...base.blocks[0], waterfall }] }], asOf: "2026-10-28" });
  const lines = [];
  wb.getWorksheet("RM_PLANNING").eachRow((row) => lines.push(String(row.getCell(1).value ?? "")));
  assert.ok(lines.some((l) => l.includes("WHOLE family")), "the whole-family note");
  assert.ok(lines.some((l) => l.includes("Exclusive — Gabrosa: Min 30 / Max 60 / Critical 20 d · reserve 6670 KG (covers 60 d) · next Min 2026-11-27")), "the Exclusive level line");
  assert.ok(lines.some((l) => l.includes("MHEC: Min 30 / Max 60 / Critical 15 d") && l.includes("not in horizon")), "the group level line");
  await wb.xlsx.writeBuffer();
});

test("STORE tabs from the month-by-month plan: actual stock apart from unreceived pieces, and the excess left", async () => {
  const base = company("a", "Almeha Coatings");
  const store_plan = {
    rows: [
      { period: "October 2026 (from 28)", period_order: 0, period_from: "2026-10-28", period_to: "2026-10-31", item: "TS U2121", material_key: "m1", group: "MHEC", mother_group: "PUTTY", child_group: "EXT PUTTY; INT PUTTY", uom: "KG", use_stock: 400, use_arrival: 0, use_assumed: 0, use_lot: 0, keep_qty: 900, keep_max_days: 60, not_backed: 0 },
      { period: "November 2026", period_order: 1, period_from: "2026-11-01", period_to: "2026-11-30", item: "TS U2121", material_key: "m1", group: "MHEC", mother_group: "PUTTY", child_group: "EXT PUTTY; INT PUTTY", uom: "KG", use_stock: 0, use_arrival: 600, use_assumed: 150, use_lot: 50, keep_qty: 700, keep_max_days: 60, not_backed: 0 },
    ],
    excess: [{ period: "October 2026 (from 28)", period_order: 0, item: "TS U2121", uom: "KG", stock_now: 26000, excess_qty: 12000, closing_qty: 25600 }],
  };
  const wb = buildRollingPlanWorkbook({ companies: [{ ...base, store_plan }], asOf: "2026-10-28" });
  const items = wb.getWorksheet("STORE_INSTRUCTIONS");
  assert.equal(items.rowCount, 3);
  assert.equal(items.getRow(1).getCell(7).value, "Issue from stock now");
  assert.deepEqual([items.getRow(2).getCell(7).value, items.getRow(2).getCell(8).value], [400, 0], "October is actual stock");
  assert.deepEqual([items.getRow(3).getCell(7).value, items.getRow(3).getCell(8).value, items.getRow(3).getCell(9).value, items.getRow(3).getCell(10).value], [0, 600, 150, 50], "November depends on receipts");
  assert.match(String(items.getRow(3).getCell(17).value), /Do not issue against: a CSN\/PO not received yet, a piece whose ETA passed or is missing, a lot nobody has ordered/);
  const excess = wb.getWorksheet("STORE_EXCESS");
  assert.equal(excess.rowCount, 2);
  assert.equal(excess.getRow(2).getCell(5).value, 12000);
  await wb.xlsx.writeBuffer();
});
