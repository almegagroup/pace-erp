import test from "node:test";
import assert from "node:assert/strict";
import * as workbookModule from "./rollingPlanWorkbook.js";
import { buildPlanMatrix, buildRollingPlanWorkbook, companyLabel, sheetName } from "./rollingPlanWorkbook.js";

const company = (id, name, extra = {}) => ({
  company_id: id, company_name: name, calendar: { as_of: "2026-10-21", horizon_end: "2026-12-31", months: ["2026-10-01", "2026-11-01", "2026-12-01"] },
  demand_label: "Current effective plan",
  summary: { materials_planned: 2, runs_out: 1, below_critical: 1, below_target: 1, new_orders: 1, new_orders_late: 0, new_order_value: 500000, arrivals_overdue: 0, arrivals_no_eta: 1, moves_advised: 1 },
  blocks: [{
    kind: "RM", title: "RDP", is_family: true, members: ["VAE A", "VAE B"], uom: "KG", target_days: 35, critical_days: 20, first_shortage_day: null,
    rows: [{ day: "2026-10-21", opening: 1000, arrivals: 0, dispatch: null, use: 100, closing: 900, max_days: 9, min_stock: 900, min_days: 9, references: [], qtys: [], suppliers: [], statuses: [], best_dates: [] },
      { day: "2026-11-06", opening: 500, arrivals: 24750, dispatch: null, use: 100, closing: 25150, max_days: 40, min_stock: 400, min_days: 4, references: ["PO ACP/PO80/2026-27/1"], qtys: [24750], suppliers: ["DAIREN"], statuses: ["IN_TRANSIT"], best_dates: ["2026-10-30 (prepone 7 d)"], best_cells: [{ etd: "2026-10-01", port: "2026-10-26", plant: "2026-10-30", why: "Now 2026-11-06 is too late." }] }],
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
  assert.deepEqual(names, ["SUMMARY", "PLAN", "RM Stand-alone", "RM Group", "RM MHEC", "RM RDP", "PM Stand-alone", "PM Group", "Almeha Coatings RM_PM", "Jayashree Industries RM_PM", "STORE_INSTRUCTIONS"], "the locked tab list (owner 2026-11-18)");
  const buffer = await wb.xlsx.writeBuffer();
  assert.ok(buffer.byteLength > 5000, "valid xlsx written");
  const rm = wb.getWorksheet("RM RDP");
  const texts = [];
  rm.eachRow((row) => texts.push(String(row.getCell(1).value ?? "")));
  assert.ok(texts.includes("Almeha Coatings — RDP (family: VAE A, VAE B)") && texts.includes("Jayashree Industries — RDP (family: VAE A, VAE B)"), "one block per company");
  assert.ok(texts.some((t) => t.startsWith("1. TODAY")), "today is the first section of the block");
  assert.ok(!texts.some((t) => t.includes("ALL ORDERS AT A GLANCE") || t.includes("POOL DIARY")), "glance and pool diary sections are gone");
});

test("PLAN matrix: company × month columns, empty SKUs dropped", () => {
  const m = buildPlanMatrix([company("a", "A"), company("b", "B", { plan: { months: ["2026-10"], rows: [{ sku_label: "X", plan: {} }] } })]);
  assert.equal(m.columns.length, 4);
  assert.equal(m.entries.length, 1);
  assert.equal(m.entries[0].qty.get("a|2026-10"), 8371);
  assert.deepEqual(m.columns.slice(0, 3).map((c) => c.basis), ["FINAL", "ROLLING", "No plan"], "plan basis per month");
});

test("SUMMARY: held CSNs are visible but stay outside planning totals", () => {
  const wb = buildRollingPlanWorkbook({ companies: [company("a", "Almeha Coatings", {
    held_csns: [{ csn_number: "3000000999", material: "VAE A", supplier: "DAIREN", qty: 25000, uom: "KG", previous_status: "TRN", reason: "Vendor document correction", held_at: "2026-10-31", eta: "2026-11-06" }],
  })], asOf: "2026-10-31" });
  const summary = wb.getWorksheet("SUMMARY");
  const cells = [];
  summary.eachRow((row) => row.eachCell((cell) => cells.push(String(cell.value ?? ""))));
  assert.ok(cells.includes("CSNs on Hold — excluded from every planning total"));
  assert.ok(cells.includes("3000000999"));
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

test("a group-covered alert stays amber with its remark on the Summary attention list", async () => {
  const covered = { material: "COMBIZELL", type: "RM", uom: "KG", target_cov_days: 30, critical_cov_days: 20, current_stk_days: 60, next_month_cov: 40, current_req: 1, current_prorata: 1, req_nm: 1, prorata_nm: 1, current_stock: 1000, intransit_cm: 0, intransit_nm: 0, below_target: true, below_critical: true, first_shortage_day: "2026-12-07", first_below_critical_day: "2026-11-26", note: "Its own stock runs out, but group MHEC stays covered by: TS U2121 — no purchase needed for this item.", group_covered: true };
  const wb = buildRollingPlanWorkbook({ companies: [company("a", "Almeha Coatings", { requirement: [covered] })], asOf: "2026-10-27" });
  const summary = wb.getWorksheet("SUMMARY");
  let remark = "";
  summary.eachRow((row) => row.eachCell((cell) => { if (String(cell.value ?? "").startsWith("Its own stock runs out")) { remark = String(cell.value); assert.equal(cell.font?.color?.argb, "FFB45309", "group-covered alert stays amber"); } }));
  assert.ok(remark.includes("stays covered"), "the group-covered remark is on the Summary attention list");
  await wb.xlsx.writeBuffer();
});

test("removed tabs stay removed (owner 2026-11-18)", () => {
  const wb = buildRollingPlanWorkbook({ companies: [company("a", "Almeha Coatings")], asOf: "2026-10-21" });
  const names = wb.worksheets.map((x) => x.name);
  for (const gone of ["BUY_PLAN", "STORE_EXCESS", "STORE_TRANSFERS", "STORE_DETAIL", "ARRIVALS", "WATERFALL_SUMMARY", "EXPLAIN_README", "EXPLAIN_DAILY", "EXPLAIN_DRAWS", "EXPLAIN_GROUPS"]) assert.ok(!names.includes(gone), `${gone} is gone`);
  assert.equal(names.at(-1), "STORE_INSTRUCTIONS", "STORE_INSTRUCTIONS is the only store tab and the last one");
});

test("STORE_INSTRUCTIONS: items by period with the child groups of one parent on ONE row", async () => {
  const base = company("a", "Almeha Coatings");
  const store = [
    { period: "CM (rest)", mother_group: "PUTTY", child_group: "EXT PUTTY", product: "P1", source: "S1", line_type: "GROUP", group: "ACID", material: "Tartaric Acid", uom: "KG", demand_qty: 100, from_stock: 100, not_backed: 0 },
    { period: "CM (rest)", mother_group: "PUTTY", child_group: "INT PUTTY", product: "P2", source: "S2", line_type: "GROUP", group: "ACID", material: "Tartaric Acid", uom: "KG", demand_qty: 50, from_stock: 40, not_backed: 10 },
  ];
  const store_transfers = [{ material: "Tartaric Acid", uom: "KG", period: "CM (rest)", from: "R003", to: "R001", qty: 600, by: "2026-10-28" }, { material: "Tartaric Acid", uom: "KG", period: "NM", from: "R001", to: "R002", qty: 150, by: "2026-11-01" }];
  const wb = buildRollingPlanWorkbook({ companies: [{ ...base, store, store_transfers }], asOf: "2026-10-28" });
  const items = wb.getWorksheet("STORE_INSTRUCTIONS");
  assert.equal(items.rowCount, 2, "header + ONE row for both child groups");
  assert.equal(items.getRow(2).getCell(8).value, 140, "Issue now");
  assert.equal(items.getRow(2).getCell(7).value, "EXT PUTTY; INT PUTTY", "child groups on one row");
  await wb.xlsx.writeBuffer();
});

test("RM RDP family block: each level (Exclusive and groups) with its own Min / Max / Critical in the status table", async () => {
  const base = company("a", "Almeha Coatings");
  const sections = [
    { label: "Exclusive — Gabrosa", kind: "OWN", members: ["Gabrosa"], target_days: 30, max_days: 60, critical_days: 20, rows: [] },
    { label: "MHEC", kind: "GROUP", members: ["Gabrosa", "Combizell"], target_days: 30, max_days: 60, critical_days: 15, rows: [] }];
  const wb = buildRollingPlanWorkbook({ companies: [{ ...base, blocks: [{ ...base.blocks[0], refill_method: "2nd refill", refill_method_why: "chosen by the system: test", level_sections: sections, level_today: [], excess_after: [{ material: "Gabrosa", qty: 4000 }], qa_stock: [{ material: "Gabrosa", uom: "KG", qty: 2500 }], qa_extra_days: 3 }] }], asOf: "2026-10-28" });
  const cells = [];
  wb.getWorksheet("RM RDP").eachRow((row) => row.eachCell((c) => cells.push(String(c.value ?? ""))));
  assert.ok(cells.some((l) => l.includes("Min 30 · Max 60 · Critical 20")), "the Exclusive level Min / Max / Critical");
  assert.ok(cells.some((l) => l.includes("Min 30 · Max 60 · Critical 15")), "the group level Min / Max / Critical");
  assert.ok(cells.some((l) => l.includes("Gabrosa: 4,000")), "the excess pool today");
  assert.ok(cells.some((l) => l.includes("Gabrosa: 2,500")) && cells.some((l) => l.includes("cover grows by about 3 d")), "the QA stock and its effect on the cover");
  assert.ok(!cells.some((l) => l.includes("Refill method") || l.includes("How to read")), "no refill-method line and no how-to-read paragraph");
  await wb.xlsx.writeBuffer();
});
test("STORE_INSTRUCTIONS from the month-by-month plan: actual stock apart from unreceived pieces", async () => {
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
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((c) => items.getRow(1).getCell(c).value),
    ["Company", "Use from", "Use to", "Item", "Material group", "PO21 parent group", "Child group(s)", "Issue now", "Wait for receipt", "Keep aside after this period", "UoM", "Note"]);
  assert.deepEqual([items.getRow(2).getCell(2).value, items.getRow(2).getCell(3).value], ["28 Oct", "31 Oct"], "dates in two columns");
  assert.deepEqual([items.getRow(2).getCell(5).value, items.getRow(2).getCell(6).value, items.getRow(2).getCell(7).value], ["MHEC", "PUTTY", "EXT PUTTY; INT PUTTY"], "item group and product groups stay as they were");
  assert.deepEqual([items.getRow(2).getCell(8).value, items.getRow(2).getCell(9).value, items.getRow(2).getCell(10).value], [400, null, 900], "October is actual stock; 900 stays aside");
  assert.deepEqual([items.getRow(3).getCell(8).value, items.getRow(3).getCell(9).value], [0, 800], "November: nothing now, 800 waits for receipts");
  assert.match(String(items.getRow(3).getCell(12).value), /600 only after its CSN\/PO is received/);
  assert.match(String(items.getRow(3).getCell(12).value), /150 depends on a CSN\/PO whose ETA passed or is missing: do not issue/);
  assert.match(String(items.getRow(3).getCell(12).value), /50 depends on a lot nobody has ordered/);
  await wb.xlsx.writeBuffer();
});

test("STORE_INSTRUCTIONS: every company gets its rows, also when only another company has the month plan", async () => {
  const withPlan = { ...company("a", "Almeha Coatings"), store_plan: { rows: [
    { period: "October 2026 (from 28)", period_order: 0, period_from: "2026-10-28", period_to: "2026-10-31", item: "TS U2121", material_key: "m1", group: "MHEC", mother_group: "PUTTY", child_group: "EXT PUTTY", uom: "KG", use_stock: 400, use_arrival: 0, use_assumed: 0, use_lot: 0, keep_qty: 900, keep_max_days: 60, not_backed: 0 },
  ], excess: [] } };
  const fallbackOnly = { ...company("b", "Jayashree Industries"), store_plan: { rows: [], excess: [] },
    store: [{ period: "CM (rest)", period_from: "2026-10-28", period_to: "2026-10-31", product: "Putty", group: "ACID", mother_group: "PUTTY", child_group: "EXT PUTTY", material: "Tartaric Acid", material_key: "m2", uom: "KG", from_stock: 120, not_backed: 5, keep_qty: 300, keep_max_days: 55, group_related: true }] };
  const wb = buildRollingPlanWorkbook({ companies: [withPlan, fallbackOnly], asOf: "2026-10-28" });
  const items = wb.getWorksheet("STORE_INSTRUCTIONS");
  const companies = [];
  items.eachRow((row, n) => { if (n > 1) companies.push(String(row.getCell(1).value)); });
  assert.deepEqual(companies, ["Almeha Coatings", "Jayashree Industries"], "both companies are listed");
  assert.equal(items.getRow(3).getCell(8).value, 120, "the fallback company's Issue now");
  assert.equal(items.getRow(3).getCell(10).value, 300, "and its Keep aside");
  await wb.xlsx.writeBuffer();
});

test("RM Stand-alone: the suggested ETD / port / plant dates and the reason are separate columns", () => {
  const base = company("a", "Almeha Coatings");
  const wb = buildRollingPlanWorkbook({ companies: [{ ...base, blocks: [{ ...base.blocks[0], is_family: false }] }], asOf: "2026-10-21" });
  const rm = wb.getWorksheet("RM Stand-alone");
  let head = null; let arrival = null;
  rm.eachRow((row) => { const v = row.values; if (v.includes("ETD (suggested)")) head = v; if (v.includes("PO ACP/PO80/2026-27/1")) arrival = v; });
  const at = (label) => head.indexOf(label);
  assert.ok(at("ETD (suggested)") > 0 && at("ETA to Port (suggested)") > 0 && at("ETA to Plant (suggested)") > 0 && at("Why this date") > 0);
  assert.equal(arrival[at("ETD (suggested)")], "2026-10-01");
  assert.equal(arrival[at("ETA to Port (suggested)")], "2026-10-26");
  assert.equal(arrival[at("ETA to Plant (suggested)")], "2026-10-30");
  assert.equal(arrival[at("Why this date")], "Now 2026-11-06 is too late.");
});

test("Group tabs: MHEC and RDP families sit on their own tabs; Today, level by level, new orders", () => {
  const base = company("a", "Almeha Coatings");
  const rec = { etd: "2026-09-24", etd_actual: true, port: "2026-10-10", port_actual: true, plant: "2026-11-12", type: "IMPORT" };
  const recDue = { etd: "2026-10-19", etd_actual: true, port: "2026-11-23", port_actual: true, plant: "2026-11-29", type: "IMPORT" };
  const lot = { kind: "Existing order", ref: "PO ASC/PO123/2026-27/1 · CSN 3000000229 (TRN)", material: "TS U2121", supplier: "SHANDONG", status: "IN_TRANSIT", lot_qty: 25000, existing_eta: "2026-11-12", engine_eta: "2026-11-12", action: "", etd: "", port: "", plant: "2026-11-12", why: "Long reason. More words.", absent: "If PO X · CSN 3000000239 (ORD) (2026-12-24) does not come: this order must land at plant by 2026-11-30 (24 d before its recorded date)", to_level: 25000, pct: 1, min_a: 51, max_a: 60, min_b: 51, max_b: 60, excess: 100, excess_split: "TS U2121: 100 KG", level_status: "Above Min", rec };
  const mhec = { ...base.blocks[0], title: "MHEC", members: ["Gabrosa", "TS U2121"], level_sections: [{ label: "MHEC", kind: "GROUP", members: ["Gabrosa", "TS U2121"], target_days: 30, max_days: 60, critical_days: 15, rows: [{ kind: "Stock today", min_a: 60, max_a: null, prorata_b: 1250 }, { ...lot, ref: "PO ASC/PO999/2026-27 · CSN 3000000555 (ORD)", existing_eta: "2026-11-29", engine_eta: "2026-11-21", min_a: 22, min_b: 31, prorata_a: 1, prorata_b: 1 }, { ...lot, ref: "PO ASC/PO888/2026-27 · CSN 3000000556 (ORD)", existing_eta: "2026-11-20", engine_eta: "2026-12-02", min_a: 50, min_b: 30, prorata_a: 1, prorata_b: 1 }, { ...lot, rec: recDue, ref: "PO ASC/PO777/2026-27 · CSN 3000000557 (ORD)", existing_eta: "2026-11-25", engine_eta: "2026-11-25", min_a: 40, min_b: 40, prorata_a: 1, prorata_b: 1 }, { ...lot, prorata_a: 1250, prorata_b: 1300, new_lots_a: [{ day: "2026-11-05", material: "Gabrosa", qty: 11000 }], new_lots_b: [] }] }],
    level_today: [{ label: "MHEC", opening: [{ material: "TS U2121", qty: 26000 }], reserve: [{ material: "TS U2121", qty: 25000 }], left: [{ material: "TS U2121", qty: 1000 }] }], excess_after: [{ material: "TS U2121", qty: 1000 }],
    pool_diary: [{ day: "2026-11-12", lands_a: ["+ TS U2121 25,000 (ASC/PO123/2026-27)"], pool_a: { total: 100, by: [{ material: "TS U2121", qty: 100 }] }, lands_b: [], pool_b: null, notes: [] }], projection_total: [], prediction: [] };
  const wb = buildRollingPlanWorkbook({ companies: [{ ...base, blocks: [mhec] }], asOf: "2026-10-21" });
  const names = wb.worksheets.map((x) => x.name);
  assert.ok(names.includes("RM MHEC") && names.includes("RM RDP"));
  const sheet = wb.getWorksheet("RM MHEC");
  const cells = [];
  sheet.eachRow((row) => row.eachCell((c) => cells.push(String(c.value ?? ""))));
  assert.ok(cells.some((t) => t.startsWith("1. TODAY")), "today first");
  assert.ok(cells.some((t) => t.startsWith("2. LEVEL BY LEVEL")) && cells.some((t) => t.startsWith("3. NEW ORDERS THE ENGINE ADDS")), "level-by-level table and new orders");
  assert.ok(!cells.some((t) => t.startsWith("4. EXCESS POOL") || t.startsWith("5. FAMILY DAY BY DAY")), "no separate excess-pool or day-by-day tables");
  assert.ok(cells.some((t) => t.includes("ETD 2026-09-24 (ATD)")), "the Tracker's ATD");
  assert.ok(cells.some((t) => t.includes("Must land by 2026-11-21: on 2026-11-29 this level is at 22 d, below Min 30")), "a too-late order: the Tracker-date cover and the Suggested date");
  assert.ok(cells.some((t) => t.includes("Can wait until 2026-12-02: cover is then 30 d (Min 30)")), "an order that can wait");
  assert.ok(cells.some((t) => t.startsWith("On time. Cover after it lands: 40 d (Min 30)")), "an order on its Suggested date");
  assert.ok(cells.some((t) => t.includes("Port 2026-11-23 (ATA, due)") && t.includes("ETD 2026-10-19 (ATD)") && !t.includes("(ATD, due)")), "a port date still ahead of today says due; a past ETD does not");
  assert.ok(cells.some((t) => t.includes("Port 2026-10-10 (ATA)") && !t.includes("2026-10-10 (ATA, due)")), "a past actual date is plain");
  const head = []; sheet.eachRow((row) => { if (String(row.getCell(1).value) === "Tracker date") head.push(row.values.slice(1).map(String)); });
  assert.deepEqual(head[0], ["Tracker date", "Order", "Lot qty", "Taken by this level", "Cover before (d)", "Cover after (d)", "Excess after (this level's items)", "Suggested date", "Suggested: cover before → after (d)", "Suggested: excess after", "Why this date"], "level table columns");
  assert.ok(!cells.some((t) => /recorded|Recorded|\bEngine date\b|If another order|ONE plan for the whole sheet|NEW lot not counted|POOL DIARY|How to read|Refill method/.test(t) && !t.startsWith("NEW (engine)")), "old wording is gone");
  const amber = []; sheet.eachRow((row) => { const c = row.getCell(8); if (c.fill?.fgColor?.argb === "FFFFF2CC") amber.push(c.address); });
  assert.ok(amber.length >= 1, "a Suggested date that differs from the Tracker date is amber");
  assert.ok(cells.some((t) => t.includes("Stock lasts") === false) && cells.some((t) => t === "1,250"), "pro-rata today");
  assert.equal(wb.getWorksheet("RM Group").rowCount, 1, "no other RM group family -> only the empty-text row");
});

test("Requirement sheet: an item used through a group shows the group and the group's demand, so a 0 own demand is not read as no need", () => {
  const base = company("a", "Almeha Coatings");
  const row = { ...base.requirement[0], material: "RP-4099", current_req: 0, req_nm: 0, current_stock: 40838, current_stk_days: null, current_stk_days_note: "Via RDP", group_via: "RDP — RDP", group_demand: 301000 };
  const wb = buildRollingPlanWorkbook({ companies: [{ ...base, requirement: [row] }], asOf: "2026-10-21" });
  const sheet = wb.getWorksheet("Almeha Coatings RM_PM");
  const header = sheet.getRow(1).values.map((v) => String(v ?? ""));
  const at = (label) => header.indexOf(label);
  assert.ok(at("Group (via)") > 0 && at("Group demand (CM+NM)") > 0, "both columns exist");
  const r = sheet.getRow(2);
  assert.equal(r.getCell(at("Group (via)")).value, "RDP — RDP");
  assert.equal(r.getCell(at("Group demand (CM+NM)")).value, 301000);
  assert.equal(r.getCell(at("CURRENT_STOCK")).value, 40838, "the item's own stock stays visible");
  assert.equal(r.getCell(at("CURRENT STK DAYS")).value, "Via RDP", "a blank cover says why");
});

test("Day table (Stand-alone / folded): a suggested lot is listed on the day it lands, labelled not counted", () => {
  const base = company("a", "Almeha Coatings");
  const block = { ...base.blocks[0], title: "PULMIX 4033", is_family: false, members: ["PULMIX 4033"], uom: "KG", rows: [
    { day: "2026-11-16", opening: 3477.52, arrivals: 0, dispatch: null, use: 168.84, closing: 3308.68, excess: 0, max_days: 22, min_stock: 3308.68, min_days: 22, references: [], qtys: [], suppliers: [], statuses: [], best_dates: [], suggested_lot: null },
    { day: "2026-11-21", opening: 2633.32, arrivals: 0, dispatch: null, use: 168.84, closing: 2464.48, excess: 0, max_days: 14, min_stock: 2464.48, min_days: 14, references: [], qtys: [], suppliers: [], statuses: [], best_dates: [], suggested_lot: 4600 },
  ] };
  const wb = buildRollingPlanWorkbook({ companies: [{ ...base, blocks: [block] }], asOf: "2026-10-21" });
  const cells = [];
  wb.getWorksheet("RM Stand-alone").eachRow((row) => row.eachCell((c) => cells.push(String(c.value ?? ""))));
  assert.ok(cells.some((t) => t.includes("NEW lot (suggested, not counted)")), "the suggested lot is named on its day");
  assert.ok(cells.some((t) => t.includes("4,600 KG")), "with its quantity");
});

test("QA stock + a shortage: the family title and the QA row say it may be a QA delay, not a missing order", async () => {
  const base = company("a", "Almeha Coatings");
  const wb = buildRollingPlanWorkbook({ companies: [{ ...base, blocks: [{ ...base.blocks[0], first_shortage_day: "2027-01-17", level_sections: [], level_today: [], excess_after: [], qa_stock: [{ material: "Gabrosa", uom: "KG", qty: 2500 }], qa_extra_days: 3 }] }], asOf: "2026-11-16" });
  const cells = [];
  wb.getWorksheet("RM RDP").eachRow((row) => row.eachCell((c) => cells.push(String(c.value ?? ""))));
  assert.ok(cells.some((l) => l.includes("RUNS OUT 2027-01-17 (but 2,500 KG is still in QA")), "the title names the QA stock");
  assert.ok(cells.some((l) => l.includes("may be a QA delay, not a missing order")), "the QA row warns before ordering");
  await wb.xlsx.writeBuffer();
});

test("a CSN is never named without its PO: section 2 Order column and the held-CSN table (owner 2026-11-17)", async () => {
  const base = company("a", "Almeha Coatings");
  const sections = [{ label: "Exclusive — Gabrosa", kind: "OWN", members: ["Gabrosa"], target_days: 30, max_days: 60, critical_days: 20,
    rows: [{ kind: "Existing order", ref: "PO ASCP2627-0192/1 · CSN 3000000370 (TRN)", material: "Gabrosa", supplier: "DAIREN", status: "In transit", lot_qty: 41500, existing_eta: "2026-11-18", engine_eta: "2026-11-18", min_a: 40, max_a: 80, min_b: 40, max_b: 80 }] }];
  const wb = buildRollingPlanWorkbook({ companies: [{ ...base, held_csns: [{ csn_number: "3000000999", po_number: "ASCP2627-0300/1", material: "VAE A", supplier: "DAIREN", qty: 25000, uom: "KG", previous_status: "TRN", reason: "x", held_at: "2026-10-31", eta: "2026-11-06" }],
    blocks: [{ ...base.blocks[0], level_sections: sections, level_today: [], excess_after: [] }] }], asOf: "2026-11-16" });
  const cells = [];
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => cells.push(String(c.value ?? "")))));
  assert.ok(cells.some((l) => l.includes("PO ASCP2627-0192/1 · CSN 3000000370 (in transit)")), "Order column names PO and CSN together");
  assert.ok(!cells.some((l) => /^CSN 3000000370/m.test(l)), "no line starts with the CSN alone");
  assert.ok(cells.includes("ASCP2627-0300/1") && cells.includes("3000000999"), "held CSN table lists the PO next to the CSN");
  await wb.xlsx.writeBuffer();
});

test("section 2: readable shipment status, 'not shipped' vs 'in transit', and ordered by the recorded plant date", async () => {
  const base = company("a", "Almeha Coatings");
  const mk = (ref, status, rec, eng) => ({ kind: "Existing order", ref, material: "Gabrosa", supplier: "DAIREN", status, lot_qty: 25000, existing_eta: rec, engine_eta: eng, min_a: 40, max_a: 80, min_b: 40, max_b: 80 });
  const sections = [{ label: "Exclusive — Gabrosa", kind: "OWN", members: ["Gabrosa"], target_days: 30, max_days: 60, critical_days: 20,
    rows: [mk("PO P1/1 · CSN 3000000454 (ORD)", "ORDERED", "2026-11-25", "2026-11-16"), mk("PO P2/1 · CSN 3000000352 (TRN)", "IN_TRANSIT", "2026-11-22", "2026-11-22")] }];
  const wb = buildRollingPlanWorkbook({ companies: [{ ...base, blocks: [{ ...base.blocks[0], level_sections: sections, level_today: [], excess_after: [] }] }], asOf: "2026-11-16" });
  const cells = [];
  wb.getWorksheet("RM RDP").eachRow((row) => row.eachCell((c) => cells.push(String(c.value ?? ""))));
  const orders = cells.filter((l) => l.includes("CSN 3000000"));
  assert.ok(orders[0].includes("CSN 3000000352 (in transit)") && orders[0].includes("In transit"), "the in-transit order is first and says so");
  assert.ok(orders[1].includes("CSN 3000000454 (not shipped)") && orders[1].includes("Ordered (not shipped)"), "the not-shipped order says so");
  assert.ok(!cells.some((l) => /· (ORDERED|IN_TRANSIT)$/m.test(l)), "no raw status code");
  await wb.xlsx.writeBuffer();
});

test("a level already below Min today says so and names the shipment on the road", async () => {
  const base = company("a", "Almeha Coatings");
  const sections = [{ label: "RDP — RDP", kind: "GROUP", members: ["RP-4099"], target_days: 30, max_days: 65, critical_days: 15, today_cover: 27, today_cover_until: "2026-12-12",
    rows: [{ kind: "Existing order", ref: "PO P2/1 · CSN 3000000352 (TRN)", material: "RP-4099", supplier: "X", status: "IN_TRANSIT", lot_qty: 25000, existing_eta: "2026-11-22", engine_eta: "2026-11-22" }] }];
  const wb = buildRollingPlanWorkbook({ companies: [{ ...base, blocks: [{ ...base.blocks[0], level_sections: sections, level_today: [], excess_after: [] }] }], asOf: "2026-11-16" });
  const cells = [];
  wb.getWorksheet("RM RDP").eachRow((row) => row.eachCell((c) => cells.push(String(c.value ?? ""))));
  assert.ok(cells.some((l) => l.includes("BELOW MIN TODAY (27 d < Min 30 d), until the shipment on the road lands")), "the level says it is below Min today");
  assert.ok(cells.some((l) => l.includes("An order that has not shipped cannot fix these days.")), "and why no order date is chased");
  await wb.xlsx.writeBuffer();
});

test("a stand-alone item already below Min today says so and names the shipment on the road (not a family level)", async () => {
  const base = company("a", "Almeha Coatings");
  const solo = { ...base.blocks[0], title: "SILRES", is_family: false, members: ["SILRES"], target_days: 25, rows: [
    { day: "2026-11-16", opening: 2000, arrivals: 0, dispatch: null, use: 100, closing: 1900, max_days: 19, min_stock: 1900, min_days: 19, references: [], qtys: [], suppliers: [], statuses: [], best_dates: [] },
    { day: "2026-11-22", opening: 1300, arrivals: 2500, dispatch: null, use: 100, closing: 3700, max_days: 37, min_stock: 1200, min_days: 12, references: ["PO P1/1 · CSN 3000000352 (TRN)"], qtys: [2500], suppliers: ["X"], statuses: ["IN_TRANSIT"], best_dates: [""] }] };
  const wb = buildRollingPlanWorkbook({ companies: [{ ...base, blocks: [solo] }], asOf: "2026-11-16" });
  const cells = [];
  wb.getWorksheet("RM Stand-alone").eachRow((row) => row.eachCell((c) => cells.push(String(c.value ?? ""))));
  assert.ok(cells.some((l) => l.includes("BELOW MIN TODAY (19 d < Min 25 d), until the shipment on the road lands")), "the stand-alone item says it is below Min today");
  await wb.xlsx.writeBuffer();
});

test("section 3 is the new-orders table, with the other route", async () => {
  const base = company("a", "Almeha Coatings");
  const wb = buildRollingPlanWorkbook({ companies: [{ ...base, blocks: [{ ...base.blocks[0], level_sections: [], level_today: [], excess_after: [], projection_total: [] }] }], asOf: "2026-11-16" });
  const cells = [];
  wb.getWorksheet("RM RDP").eachRow((row) => row.eachCell((c) => cells.push(String(c.value ?? ""))));
  assert.ok(cells.some((l) => l.startsWith("3. NEW ORDERS THE ENGINE ADDS")), "section 3 is the new-orders table");
  await wb.xlsx.writeBuffer();
});

test("a failed self-check is printed in red on the block (family and stand-alone layouts)", async () => {
  const base = company("a", "Almeha Coatings");
  const issues = ["2026-11-23: Closing 9000 does not equal Opening + landed + new order - use (6794.48)"];
  const wb = buildRollingPlanWorkbook({ companies: [{ ...base, blocks: [{ ...base.blocks[0], self_check: issues, level_sections: [], level_today: [], excess_after: [] }, { ...base.blocks[0], title: "SOLO", is_family: false, members: ["SOLO"], self_check: issues }] }], asOf: "2026-11-16" });
  const cells = [];
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => cells.push(String(c.value ?? "")))));
  assert.ok(cells.filter((l) => l.startsWith("SELF-CHECK FAILED (1): 2026-11-23: Closing 9000")).length >= 2, "both layouts print the failed check");
  await wb.xlsx.writeBuffer();
});

test("family block (owner 2026-11-18): whole days rounded down, per-level excess, Tracker / Suggested names, new orders with the other route", async () => {
  const base = company("a", "Almeha Coatings");
  const proj = { kind: "Projection", ref: "NEW (engine)", po_by: "2026-10-24", material: "Celanese RDP", supplier: "CELANESE", status: "Projection", lot_qty: 25000, existing_eta: "2026-11-08", engine_eta: "2026-11-08", etd: "2026-10-26", port: "2026-11-05",
    to_level: 13800, min_a_before: 16.9, min_a: 29.8, min_b_before: 16.9, min_b: 29.8, excess_a: 0, excess: 2269, why: "Triggered by group free stock — RDP", action: "Order by 2026-10-24" };
  const order = { kind: "Existing order", ref: "PO ACP/PO50/2026-27/1 · CSN 3000000433 (ORD)", material: "Celanese RDP", supplier: "CELANESE", status: "ORDERED", lot_qty: 24000, existing_eta: "2026-10-06", engine_eta: "2026-10-04", to_level: 20500,
    min_a_before: 26.9, min_a: 43.1, min_b_before: 28.6, min_b: 45, excess_a: 0, excess: 2269, action: "Prepone to 2026-10-04", arr_note: "" };
  const sections = [{ label: "Group — Celanese + CCDS", kind: "GROUP", members: ["Celanese RDP", "CCDS"], target_days: 25, max_days: 45, critical_days: 12, today_cover: 24.6,
    rows: [{ kind: "Stock today", lot_qty: 30605, to_level: 30605, prorata_b: 1243, min_a: 24.6, excess: 0 }, order, proj] }];
  const projection_total = [{ po_by: "2026-10-24", material: "Celanese RDP", supplier: "CELANESE", qty: 25000, etd: "2026-10-26", port: "2026-11-05", recorded_eta: "2026-11-08", engine_eta: "2026-11-08",
    alternatives: "LOCAL · Celanese RDP · Local vendor: ETD 2026-11-02, lands 2026-11-10", parts: [{ level: "Group — Celanese + CCDS", qty: 13800 }] }];
  const wb = buildRollingPlanWorkbook({ companies: [{ ...base, blocks: [{ ...base.blocks[0], title: "RDP", level_sections: sections, level_today: [], excess_after: [], projection_total }] }], asOf: "2026-10-21" });
  const rows = [];
  wb.getWorksheet("RM RDP").eachRow((row) => rows.push(row.values.slice(1).map((v) => String(v ?? ""))));
  const newRow = rows.find((r) => r[1]?.startsWith("NEW (engine)"));
  assert.equal(newRow[4], "16", "cover before is rounded DOWN (16.9 -> 16)");
  assert.equal(newRow[5], "29", "cover after is rounded down (29.8 -> 29)");
  assert.equal(newRow[8], "16 → 29", "Suggested before → after, whole days");
  assert.equal(newRow[9], "2,269", "excess after on the Suggested date");
  const ordered = rows.find((r) => r[1]?.includes("CSN 3000000433"));
  assert.equal(ordered[4], "26", "26.9 -> 26");
  assert.equal(ordered[8], "28 → 45");
  assert.ok(ordered[10].includes("Prepone to 2026-10-04"), "the engine's decision is in the Why column");
  const p3 = rows.find((r) => r[0]?.startsWith("Celanese RDP") && r[0].includes("Order by 2026-10-24") && r.some((c) => c.includes("LOCAL")) && r.some((c) => c.includes("ETD 2026-10-26 → Port 2026-11-05 → Plant 2026-11-08")));
  assert.ok(p3, "new-orders table row with the other route");
  assert.ok(rows.some((r) => r[0] === "New order" && r.includes("Tracker date") && r.includes("Suggested date")), "new-orders header uses Tracker / Suggested date");
  assert.ok(!rows.flat().some((c) => /If another order does not come/.test(c)), "no 'if another order does not come' text anywhere");
  await wb.xlsx.writeBuffer();
});

test("stand-alone tabs keep their layout but use Suggested wording and no 'if another order does not come' column", () => {
  const base = company("a", "Almeha Coatings");
  const wb = buildRollingPlanWorkbook({ companies: [{ ...base, blocks: [{ ...base.blocks[0], is_family: false }] }], asOf: "2026-10-21" });
  const cells = [];
  wb.getWorksheet("RM Stand-alone").eachRow((row) => row.eachCell((c) => cells.push(String(c.value ?? ""))));
  assert.ok(cells.includes("Tracker date: ETD / Port / Plant") && cells.includes("ETD (suggested)"));
  assert.ok(!cells.includes("If another order does not come") && !cells.some((c) => c.includes("(engine)")), "old wording is gone");
});

test("the download page imports downloadRollingPlanWorkbook: it must stay exported (a missing export shows as 'h is not a function')", () => {
  assert.equal(typeof workbookModule.downloadRollingPlanWorkbook, "function");
});
