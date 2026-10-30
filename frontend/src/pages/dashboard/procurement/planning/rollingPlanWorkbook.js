/*
 * PO22 Plan Excel (owner 2026-10-21) — the old "rolling_plan" workbook built from ERP, for the
 * Final or the Rolling plan alike (PO21 effective plan: Final where it exists, else Rolling):
 * every company the user can see in one file. Tabs:
 *   SUMMARY · PLAN (PO21, company × 3 months) · RM_PLANNING · PM_PLANNING (family / item blocks:
 *   today + arrival rows, then Prediction) · <Company>_RM_PM (requirement) · BUY_PLAN ·
 *   STORE_INSTRUCTIONS · ARRIVALS · EXPLAIN_README · EXPLAIN_DAILY · EXPLAIN_DRAWS · EXPLAIN_GROUPS
 *   (the waterfall day by day: what each material did, what each group drew from whom, when a guard fired).
 * Names only, never PACE codes. Loaded with a dynamic import so exceljs stays out of the page bundle.
 */
import ExcelJS from "exceljs";
import { flowRows, matrixGrid, waterfallVerdict } from "./mtsWaterfall.js";
import { aggregateStoreItems, dayShort, simpleStoreNote, storeWaitQty } from "./mtsStoreInstruction.js";
import { companyLabel } from "./mtsCompanyLabel.js";

export { companyLabel };

const TITLE_FILL = "FFFBBC04";   // yellow block title, as in the old file
const HEAD_FILL = "FFFFE699";    // light yellow column header
const SECTION_FILL = "FFFFF2CC";
const TOTAL_FILL = "FFFCE4D6";
const RED = "FFC00000";
const AMBER = "FFB45309";
const NUM = "#,##0.##";
const BORDER = { top: { style: "thin", color: { argb: "FFBFBFBF" } }, left: { style: "thin", color: { argb: "FFBFBFBF" } }, bottom: { style: "thin", color: { argb: "FFBFBFBF" } }, right: { style: "thin", color: { argb: "FFBFBFBF" } } };

const STATUS_LABEL = { AT_GATE: "At gate", IN_TRANSIT: "In transit", ORDERED: "Ordered (not shipped)", BULK: "Bulk call-off", STO: "STO", SUB_CSN: "Sub-CSN" };

/** Days are whole, rounded down (sheet ROUNDDOWN). */
function days(value) {
  const n = num(value);
  return n === null ? null : Math.floor(n + 1e-9);
}
function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}
function day(value) {
  return value ? String(value).slice(0, 10) : "";
}
/** Excel sheet name: ≤ 31 chars, no []:*?/\ . */
export function sheetName(base, used) {
  const clean = String(base).replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim() || "Sheet";
  let name = clean.slice(0, 31);
  for (let i = 2; used.has(name.toUpperCase()); i += 1) name = `${clean.slice(0, 31 - String(i).length - 3)} (${i})`;
  used.add(name.toUpperCase());
  return name;
}

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = BORDER;
  });
}
function addTable(sheet, columns, rows, { color } = {}) {
  styleHeader(sheet.addRow(columns.map((c) => c.label)));
  for (const r of rows) {
    const row = sheet.addRow(columns.map((c) => (c.value ? c.value(r) : r[c.key]) ?? null));
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.border = BORDER;
      if (c.num) cell.numFmt = NUM;
    });
    const tone = color?.(r);
    if (tone) row.eachCell((cell) => { cell.font = { ...(cell.font ?? {}), color: { argb: tone } }; });
  }
}
function widths(sheet, list) {
  list.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAN: rows grouped Mother → Child group with a TOTAL per child group; columns = company × month.
// ─────────────────────────────────────────────────────────────────────────────
export function buildPlanMatrix(companies) {
  const monthsOf = (c) => (c.plan?.months ?? []).slice(0, 3);
  const columns = companies.flatMap((c) => monthsOf(c).map((m) => ({ company: c, month: m })));
  const bySku = new Map();
  for (const c of companies) {
    for (const r of c.plan?.rows ?? []) {
      const key = `${r.mother_group_name || "Not grouped"}|${r.child_group_name || "Not grouped"}|${r.sku_label}`;
      const entry = bySku.get(key) ?? { mother: r.mother_group_name || "Not grouped", child: r.child_group_name || "Not grouped", sku: r.sku_label, uom: r.base_uom_code, qty: new Map() };
      for (const m of monthsOf(c)) {
        const q = num(r.plan?.[m]?.qty);
        if (q !== null) entry.qty.set(`${c.company_id}|${m}`, (entry.qty.get(`${c.company_id}|${m}`) ?? 0) + q);
      }
      bySku.set(key, entry);
    }
  }
  const entries = [...bySku.values()].filter((e) => [...e.qty.values()].some((q) => q !== 0))
    .sort((a, b) => a.mother.localeCompare(b.mother) || a.child.localeCompare(b.child) || a.sku.localeCompare(b.sku));
  // Which plan each company-month is built on: FINAL where a Final exists, else ROLLING (per SKU).
  for (const col of columns) {
    const sources = new Set((col.company.plan?.rows ?? []).map((r) => r.plan?.[col.month]?.base_source).filter(Boolean));
    col.basis = sources.size === 0 ? "No plan" : sources.size === 1 ? [...sources][0] : [...sources].sort().join(" + ");
  }
  return { columns, entries };
}

function writePlan(sheet, companies) {
  const { columns, entries } = buildPlanMatrix(companies);
  const top = sheet.addRow(["", "", ...columns.map((col, i) => (i === 0 || columns[i - 1].company !== col.company ? companyLabel(col.company) : ""))]);
  top.font = { bold: true };
  styleHeader(sheet.addRow(["DESCRIPTION", "UoM", ...columns.map((c) => c.month.slice(0, 7))]));
  styleHeader(sheet.addRow(["Plan basis", "", ...columns.map((c) => c.basis)]));
  let currentMother = null;
  let currentChild = null;
  let groupRows = [];
  const flush = () => {
    if (!groupRows.length) return;
    const total = sheet.addRow([`${currentChild} — TOTAL PLAN`, groupRows[0].uom ?? "", ...columns.map((c) => {
      const values = groupRows.map((e) => e.qty.get(`${c.company.company_id}|${c.month}`)).filter((q) => q !== undefined);
      return values.length ? values.reduce((s, q) => s + q, 0) : null;
    })]);
    total.eachCell((cell, i) => { cell.font = { bold: true }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } }; if (i > 2) cell.numFmt = NUM; });
    groupRows = [];
  };
  for (const e of entries) {
    if (e.mother !== currentMother) {
      flush();
      currentMother = e.mother; currentChild = null;
      const r = sheet.addRow([e.mother]);
      r.getCell(1).font = { bold: true }; r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_FILL } };
    }
    if (e.child !== currentChild) {
      flush();
      currentChild = e.child;
      const r = sheet.addRow([e.child]);
      r.getCell(1).font = { bold: true, italic: true }; r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_FILL } };
    }
    const row = sheet.addRow([e.sku, e.uom ?? "", ...columns.map((c) => e.qty.get(`${c.company.company_id}|${c.month}`) ?? null)]);
    row.eachCell((cell, i) => { if (i > 2) cell.numFmt = NUM; });
    groupRows.push(e);
  }
  flush();
  widths(sheet, [44, 8, ...columns.map(() => 12)]);
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 3 }];
}

// ─────────────────────────────────────────────────────────────────────────────
// Planning blocks: one per family / item per company — today + arrival rows, then Prediction.
// ─────────────────────────────────────────────────────────────────────────────
const BLOCK_HEAD = ["Date", "Opening", "ETA to Plant", "Quantity to Dispatch", "Pro-rata", "Closing", "Excess (not needed yet)", "Max Days", "Min Stk", "Min Days", "PO / CSN", "Qty", "Supplier", "ST", "What to do (engine)", "ETD (engine)", "ETA to Port (engine)", "ETA to Plant (engine)", "Why this date — Min / Max by group", "If another order does not come"];
/** Owner 2026-10-29: name the group(s) whose free stock triggered the order, not just "Group free stock". */
const triggeredBy = (x) => {
  const also = Array.isArray(x.trigger_also_groups) && x.trigger_also_groups.length ? ` (same lot also feeds: ${x.trigger_also_groups.join(", ")})` : "";
  if (x.trigger_kind === "GROUP") return `Group free stock${x.trigger_group ? ` — ${x.trigger_group}` : ""}${also}`;
  if (x.trigger_kind === "OWN") return `Its own use${also}`;
  return also.trim();
};
/** Owner 2026-10-30: a late new order cannot save the Min: say how long it is below Min, how low the cover goes and whether Critical holds. */
const minGapText = (g) => {
  if (!g) return "";
  const crit = g.critical_days !== null && g.critical_days !== undefined ? `, Critical ${g.critical_days} d` : "";
  return `Min cannot be saved: below Min for ${g.days_below_min} day(s) (${g.from} to ${g.to}), cover down to ${Math.floor(g.lowest_cover_days)} d (Min ${g.min_days} d${crit}). ${g.critical_broken ? "Critical is ALSO broken." : "Critical holds."}`;
};
/** Owner 2026-10-30: the same need through the other route (import <-> local): ETD / Port / Plant, only what can still connect from today. */
const alternativesText = (list) => (Array.isArray(list) ? list : [])
  .map((a) => `${a.route === "IMPORT" ? "IMPORT" : "LOCAL"} · ${a.material} · ${a.vendor}: ETD ${a.etd}${a.port ? ` · Port ${a.port}` : ""} · Plant ${a.plant}${a.moq ? ` · MOQ ${new Intl.NumberFormat("en-IN").format(a.moq)}` : ""}`).join("\n");
const PRED_HEAD = ["", "Import ETD / Dispatch date", "LCL-ETD / Port ETA", "Date", "Quantity to Dispatch", "Family Max Days", "Family Min Days", "Material", "Supplier", "PO by", "UoM", "Cover that triggered the order (d)", "Item's own Min it was compared with (d)", "Triggered by", "Min / Critical status", "", "", "", "Other route (import ↔ local): only options that can still connect if ordered from today"];

/**
 * Days of cover. When the stock outlasts the PO21 plan the engine sends no day count but an estimate at the plan's average daily use:
 * shown as "≈ 66 d (plan to 31 Jan)" so the number stays and nobody reads it as a promise (owner 2026-10-28).
 */
function coverCell(value, estimate, stock, planEnd) {
  const d = days(value);
  if (d !== null) return d;
  const e = days(estimate);
  if (e !== null) return `≈ ${e} d${planEnd ? ` (plan to ${String(planEnd).slice(0, 10)})` : ""}`;
  return num(stock) > 0 ? "outlasts plan" : d;
}

/** The engine's ETD / port / plant dates and the reason, one line per not-yet-shipped piece on the row (owner 2026-10-29). */
function bestColumns(r) {
  const cells = r.best_cells ?? [];
  const join = (key) => cells.map((c) => c?.[key] ?? "").filter(Boolean).join("\n");
  return [join("action"), join("etd"), join("port"), join("plant"), join("why") || (r.best_dates ?? []).filter(Boolean).join("\n"), join("absent")];
}

function writeBlocks(sheet, companies, kind) {
  const list = companies.flatMap((c) => (c.blocks ?? []).filter((b) => b.kind === kind).map((b) => ({ ...b, company: c })))
    .sort((a, b) => a.title.localeCompare(b.title) || companyLabel(a.company).localeCompare(companyLabel(b.company)));
  if (list.length === 0) { sheet.addRow([`No ${kind} item with use, arrival or order in the horizon.`]); return; }
  for (const b of list) {
    const title = sheet.addRow([`${companyLabel(b.company)} — ${b.title}${b.is_family ? ` (family: ${b.members.join(", ")})` : ""}`]);
    title.getCell(1).font = { bold: true };
    title.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_FILL } };
    // A family has one Target / Critical per member: show each, not just the first member's pair.
    const policyFacts = b.is_family && (b.members_policy ?? []).length ? `Target / Critical — ${b.members_policy.join(" · ")}` : null;
    const facts = [`Unit ${b.uom ?? "—"}`, ...(policyFacts ? [policyFacts] : [`Target ${b.target_days ?? "—"} d`, `Critical ${b.critical_days ?? "—"} d`]), b.first_shortage_day ? `RUNS OUT ${b.first_shortage_day}` : "",
      (b.gaps ?? []).length ? `ENGINE CANNOT PLAN — ${b.gaps.join("; ")}` : ""].filter(Boolean).join(" · ");
    const factRow = sheet.addRow([facts]);
    if (b.is_family && (b.members_stock ?? []).length) {
      const stockRow = sheet.addRow([`Member stock: ${b.members_stock.join(" · ")}`]);
      stockRow.getCell(1).font = { italic: true };
    }
    if (b.first_shortage_day || (b.gaps ?? []).length) factRow.getCell(1).font = { bold: true, color: { argb: RED } };
    // Owner 2026-10-28: the family is reported as a whole (every group and the exclusive use of its members together); each level
    // is listed beneath, narrow first, with its own Min / Max / Critical days, reserve and next Min date.
    if (b.is_family && (b.waterfall?.levels ?? []).length) {
      const note = sheet.addRow(["Opening / Pro-rata / Closing / Excess / Max Days / Min Days below are the WHOLE family: all groups and the exclusive use of its members together. A receipt is not all used at once: Excess = what is in the pool after that day, held for no level yet (normal, not a problem). ≈ N d (plan to date) = the stock outlasts the PO21 plan (the plan has no demand after its last day, so no later use is invented); N is the days at the plan's average daily use. ETD / ETA to Port / ETA to Plant (engine) = the latest dates at which a not-yet-shipped order still keeps every level above its Critical days (a level may sit below its Min, never below Critical); a lot that no level depends on inside the plan gets no date, only the reason. \"If another order does not come\" = the DEADLINE for this order if that other order never arrives (this order judged alone, other orders on their recorded dates); the engine date beside it is stricter because it also guards against several orders being late together. \"Recorded date\" = the plant date stored in the CSN / PO; if it has already passed with no shipment recorded the order is overdue, not postponed: ask the vendor where the goods are and update the CSN Tracker. Levels, narrow first:"]);
      note.getCell(1).font = { italic: true };
      for (const l of b.waterfall.levels) {
        const line = sheet.addRow([`  ${l.label}: Min ${days(l.target_days) ?? "—"} / Max ${days(l.max_days) ?? "—"} / Critical ${days(l.critical_days) ?? "—"} d · reserve ${num(l.reserve_now) ?? 0} ${b.uom ?? ""} (covers ${days(l.cover_days_now) ?? "—"} d) · next Min ${l.next_min_day ?? "not in horizon"}`]);
        line.getCell(1).font = { italic: true };
      }
    }
    if (b.together_note) {
      const tn = sheet.addRow([b.together_note]);
      tn.getCell(1).font = { italic: true, bold: true };
    }
    styleHeader(sheet.addRow(BLOCK_HEAD));
    for (const r of b.rows) {
      const row = sheet.addRow([
        day(r.day), num(r.opening), num(r.arrivals) || null, num(r.dispatch), num(r.use), num(r.closing), num(r.excess), coverCell(r.max_days, r.max_days_est, r.closing, b.plan_end), num(r.min_stock), coverCell(r.min_days, r.min_days_est, r.min_stock, b.plan_end),
        r.references.join("\n"), r.qtys.join("\n"), r.suppliers.join("\n"),
        r.statuses.map((s) => STATUS_LABEL[s] ?? s).join("\n"),
        ...bestColumns(r),
      ]);
      row.eachCell((cell, i) => { cell.border = BORDER; if (i >= 2 && i <= 10) cell.numFmt = NUM; cell.alignment = { vertical: "top", wrapText: i >= 11 }; });
      if (r.closing < 0) row.getCell(6).font = { bold: true, color: { argb: RED } };
      if (b.critical_days !== null && r.min_days !== null && r.min_days < b.critical_days) row.getCell(10).font = { bold: true, color: { argb: RED } };
      else if (b.target_days !== null && r.min_days !== null && r.min_days < b.target_days) row.getCell(10).font = { bold: true, color: { argb: AMBER } };
    }
    if (b.prediction.length) {
      const p = sheet.addRow(["Prediction"]);
      p.getCell(1).font = { bold: true, italic: true };
      styleHeader(sheet.addRow(PRED_HEAD));
      for (const x of b.prediction) {
        const row = sheet.addRow([
          x.source === "YOU" ? "Planner" : "Engine", day(x.import_etd), day(x.port_eta), day(x.date), num(x.qty), coverCell(x.max_days, x.max_days_est, 0, b.plan_end), coverCell(x.min_days, x.min_days_est, 0, b.plan_end), x.material, x.supplier ?? "", day(x.po_by),
          x.uom ?? "", days(x.trigger_cover_days), days(x.trigger_min_days), triggeredBy(x), minGapText(x.min_gap), "", "", "", alternativesText(x.alternatives),
        ]);
        row.eachCell((cell, i) => { cell.border = BORDER; if (i >= 5 && i <= 7) cell.numFmt = NUM; });
        row.getCell(14).alignment = { wrapText: true, vertical: "top" };
        row.getCell(15).alignment = { wrapText: true, vertical: "top" };
        row.getCell(19).alignment = { wrapText: true, vertical: "top" };
      }
    }
    sheet.addRow([]);
  }
  widths(sheet, [12, 12, 12, 14, 11, 12, 14, 9, 12, 9, 34, 11, 30, 16, 40, 12, 12, 12, 70, 50]);
}

// ─────────────────────────────────────────────────────────────────────────────
export function buildRollingPlanWorkbook({ companies, asOf }) {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const used = new Set();

  // SUMMARY
  const summary = wb.addWorksheet(sheetName("SUMMARY", used));
  const head = summary.addRow([`MTS Plan — as of ${asOf}`]);
  head.getCell(1).font = { bold: true, size: 14 };
  summary.addRow([`Generated ${new Date().toLocaleString("en-IN")} · Demand = PO21 effective plan: Final where a Final exists, else Rolling (+ Additional, Urgent Extra) · advisory: no PO is created by this file`]);
  summary.addRow(["Stock is counted until its stated expiry date (GRN with a date or shelf life). Opening stock and GRN without an expiry are never dropped: cut-off or receipt + 120 days only decides which lot is used first. Where stock outlasts the PO21 plan, days show as ≈ N d (plan to <date>), at the plan's average daily use."]);
  summary.addRow([]);
  addTable(summary, [
    { label: "Company", value: (c) => companyLabel(c) },
    { label: "Horizon", value: (c) => `${c.calendar.as_of} → ${c.calendar.horizon_end}` },
    { label: "Demand", value: (c) => c.demand_label },
    { label: "Bulk RM left out", value: (c) => c.bulk_rm_excluded ?? 0, num: true },
    { label: "Materials planned", value: (c) => c.summary.materials_planned, num: true },
    { label: "Runs out", value: (c) => c.summary.runs_out, num: true },
    { label: "Below Critical", value: (c) => c.summary.below_critical, num: true },
    { label: "Below Target", value: (c) => c.summary.below_target, num: true },
    { label: "New orders", value: (c) => c.summary.new_orders, num: true },
    { label: "…of which late", value: (c) => c.summary.new_orders_late, num: true },
    { label: "New order value (₹)", value: (c) => c.summary.new_order_value, num: true },
    { label: "Arrivals ETA passed", value: (c) => c.summary.arrivals_overdue, num: true },
    { label: "Arrivals without ETA", value: (c) => c.summary.arrivals_no_eta, num: true },
    { label: "Arrival moves advised", value: (c) => c.summary.moves_advised, num: true },
  ], companies, { color: (c) => (c.summary.runs_out ? RED : null) });
  summary.addRow([]);
  const att = summary.addRow(["Needs attention (runs out or below Critical)"]);
  att.getCell(1).font = { bold: true };
  addTable(summary, [
    { label: "Company", value: (r) => r.company },
    { label: "Material", key: "material" },
    { label: "Type", key: "type" },
    { label: "Runs out on", value: (r) => day(r.first_shortage_day) },
    { label: "Below Critical from", value: (r) => day(r.first_below_critical_day) },
    { label: "Stock days now", value: (r) => num(r.current_stk_days), num: true },
    { label: "Target / Critical", value: (r) => `${r.target_cov_days ?? "—"} / ${r.critical_cov_days ?? "—"}` },
    { label: "Note", value: (r) => r.note ?? "" },
  ], companies.flatMap((c) => c.requirement.filter((r) => r.first_shortage_day || r.below_critical).map((r) => ({ ...r, company: companyLabel(c) }))),
  { color: (r) => (r.group_covered ? AMBER : r.first_shortage_day ? RED : AMBER) });
  const skipped = companies.flatMap((c) => c.notes ?? []);
  if (skipped.length) { summary.addRow([]); skipped.forEach((n) => summary.addRow([n])); }
  widths(summary, [34, 30, 26, 14, 10, 12, 12, 12, 12, 16, 14, 14, 14, 70]);

  // PLAN
  writePlan(wb.addWorksheet(sheetName("PLAN", used)), companies);

  // Planning blocks
  writeBlocks(wb.addWorksheet(sheetName("RM_PLANNING", used)), companies, "RM");
  writeBlocks(wb.addWorksheet(sheetName("PM_PLANNING", used)), companies, "PM");

  // Requirement per company
  for (const c of companies) {
    const sheet = wb.addWorksheet(sheetName(`${companyLabel(c)} RM_PM`, used));
    addTable(sheet, [
      { label: "ITEMS", key: "material" }, { label: "TYPE", key: "type" }, { label: "UoM", key: "uom" },
      { label: "Target Cov", value: (r) => num(r.target_cov_days), num: true }, { label: "Critical Cov", value: (r) => num(r.critical_cov_days), num: true },
      { label: "CURRENT STK DAYS", value: (r) => num(r.current_stk_days), num: true }, { label: "Next Month cov", value: (r) => num(r.next_month_cov), num: true },
      { label: "Current Req", value: (r) => num(r.current_req), num: true }, { label: "Current Prorata", value: (r) => num(r.current_prorata), num: true },
      { label: "Req NM", value: (r) => num(r.req_nm), num: true }, { label: "Prorata NM", value: (r) => num(r.prorata_nm), num: true },
      { label: "CURRENT_STOCK", value: (r) => num(r.current_stock), num: true }, { label: "INTRANSIT CM", value: (r) => num(r.intransit_cm), num: true },
      { label: "INTRANSIT NM", value: (r) => num(r.intransit_nm), num: true },
      { label: "Runs out on", value: (r) => day(r.first_shortage_day) }, { label: "Below Critical from", value: (r) => day(r.first_below_critical_day) },
      { label: "Remark", key: "note" },
    ], c.requirement, { color: (r) => (r.group_covered ? AMBER : r.first_shortage_day ? RED : r.below_critical ? AMBER : null) });
    widths(sheet, [40, 6, 7, 10, 10, 12, 12, 12, 12, 12, 12, 13, 12, 12, 12, 14, 50]);
    sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  }

  // BUY_PLAN
  const buy = wb.addWorksheet(sheetName("BUY_PLAN", used));
  addTable(buy, [
    { label: "Company", value: (r) => r.company }, { label: "Material", key: "material" }, { label: "Type", key: "type" },
    { label: "PO by", value: (r) => day(r.po_by) }, { label: "Qty", value: (r) => num(r.qty), num: true }, { label: "UoM", key: "uom" },
    { label: "Plant ETA", value: (r) => day(r.plant_eta) }, { label: "Delivery lots", key: "lots" }, { label: "Supplier", key: "supplier" },
    { label: "Full cost / unit (₹)", value: (r) => num(r.full_cost_per_unit), num: true }, { label: "Value (₹)", value: (r) => num(r.value), num: true },
    { label: "Cost gaps", key: "cost_missing" }, { label: "Late", value: (r) => (r.late ? "LATE" : "") }, { label: "Why", key: "reason" },
  ], companies.flatMap((c) => c.buys.map((b) => ({ ...b, company: companyLabel(c) }))), { color: (r) => (r.late ? RED : null) });
  widths(buy, [26, 36, 6, 12, 12, 7, 12, 30, 30, 14, 14, 30, 7, 60]);

  // STORE_INSTRUCTIONS (owner 2026-10-28): Period · Item · Group · Quantity · PO21 parent group · child group(s) — the child groups of
  // one parent that use the same item share ONE row. STORE_TRANSFERS: R003 -> R001 / R002 and R001 <-> R002. STORE_DETAIL = the old product-wise rows.
  // Owner 2026-10-28: for the WHOLE horizon, month by month; only ACTUAL stock may be issued (CSN / PO not yet received, an ETA that passed or is
  // missing, and an unordered lot are listed apart as "do not issue against"). Companies without the month plan fall back to the CM + NM rows.
  const storeItems = wb.addWorksheet(sheetName("STORE_INSTRUCTIONS", used));
  // Owner 2026-10-28: EVERY company gets its rows. A company without the month-by-month plan falls back to its CM + NM rows, shaped like the
  // plan rows (it used to be dropped whenever another company had the month plan).
  const planRows = companies.flatMap((c) => {
    if ((c.store_plan?.rows ?? []).length > 0) return c.store_plan.rows.map((r) => ({ ...r, company: companyLabel(c) }));
    return aggregateStoreItems((c.store ?? []).filter((x) => x.group_related !== false).map((x) => ({
      period: x.period, period_order: String(x.period).startsWith("CM") ? 0 : 1, period_from: x.period_from, period_to: x.period_to, item: x.material, key_id: x.material_key ?? x.material,
      group: x.group ?? "", mother: x.mother_group ?? "", child: x.child_group ?? "", qty: x.from_stock, not_backed: x.not_backed, uom: x.uom, keep: x.keep_qty ?? null, keep_days: x.keep_max_days ?? null,
    }))).map((r) => ({
      company: companyLabel(c), period: r.period, period_from: r.period_from, period_to: r.period_to, item: r.item, group: r.group, mother_group: r.mother, child_group: r.child,
      uom: r.uom, use_stock: r.qty, use_arrival: 0, use_assumed: 0, use_lot: 0, keep_qty: r.keep, keep_max_days: r.keep_days, not_backed: r.not_backed,
    }));
  });
  // The Store sheet is SIMPLE — Use from · Use to · Item · groups · Issue now · Wait for receipt · Keep aside after this period · Note.
  addTable(storeItems, [
    { label: "Company", key: "company" }, { label: "Use from", value: (r) => dayShort(r.period_from) }, { label: "Use to", value: (r) => dayShort(r.period_to) },
    { label: "Item", key: "item" }, { label: "Material group", key: "group" },
    { label: "PO21 parent group", key: "mother_group" }, { label: "Child group(s)", key: "child_group" },
    { label: "Issue now", value: (r) => num(r.use_stock), num: true },
    { label: "Wait for receipt", value: (r) => num(storeWaitQty(r)) || null, num: true },
    { label: "Keep aside after this period", value: (r) => num(r.keep_qty), num: true }, { label: "UoM", key: "uom" },
    { label: "Note", value: (r) => simpleStoreNote({ use_arrival: r.use_arrival, use_assumed: r.use_assumed, use_lot: r.use_lot, not_backed: r.not_backed }) },
  ], planRows, { color: (r) => (r.use_assumed > 0 || r.not_backed > 0 ? RED : null) });
  widths(storeItems, [26, 11, 11, 40, 28, 24, 40, 14, 16, 18, 7, 80]);
  const excessRows = companies.flatMap((c) => (c.store_plan?.excess ?? []).map((e) => ({ ...e, company: companyLabel(c) })));
  const storeExcess = wb.addWorksheet(sheetName("STORE_EXCESS", used));
  addTable(storeExcess, [
    { label: "Company", key: "company" }, { label: "At the end of", key: "period" }, { label: "Item", key: "item" }, { label: "Stock today", value: (r) => num(r.stock_now), num: true },
    { label: "Excess left in the pool", value: (r) => num(r.excess_qty), num: true }, { label: "Total stock then (planned)", value: (r) => num(r.closing_qty), num: true }, { label: "UoM", key: "uom" },
  ], excessRows);
  widths(storeExcess, [26, 26, 44, 16, 22, 24, 7]);
  const storeTransfers = wb.addWorksheet(sheetName("STORE_TRANSFERS", used));
  addTable(storeTransfers, [
    { label: "Company", key: "company" }, { label: "Transfer by", value: (r) => day(r.by) }, { label: "For period", key: "period" }, { label: "Item", key: "material" },
    { label: "From", key: "from" }, { label: "To", key: "to" }, { label: "Quantity", value: (r) => num(r.qty), num: true }, { label: "UoM", key: "uom" },
  ], companies.flatMap((c) => (c.store_transfers ?? []).map((t) => ({ ...t, company: companyLabel(c) }))));
  widths(storeTransfers, [26, 14, 18, 44, 8, 8, 14, 7]);
  const store = wb.addWorksheet(sheetName("STORE_DETAIL", used));
  addTable(store, [
    { label: "Company", value: (r) => r.company }, { label: "Period", key: "period" },
    { label: "Parent group", value: (r) => r.mother_group ?? "" }, { label: "Child group", value: (r) => r.child_group ?? "" },
    { label: "Product", key: "product" },
    { label: "Stroke / Pack BOM", key: "source" }, { label: "Line", key: "line_type" }, { label: "Material group", key: "group" },
    { label: "Material to use", key: "material" }, { label: "Line demand", value: (r) => num(r.demand_qty), num: true },
    { label: "From physical stock", value: (r) => num(r.from_stock), num: true }, { label: "Not yet backed", value: (r) => num(r.not_backed), num: true },
    { label: "UoM", key: "uom" }, { label: "Planned consumption reason", value: (r) => r.reason ?? "" },
    { label: "Use first from", value: (r) => r.use_first ?? "" }, { label: "Transfer first", key: "transfer" },
  ], companies.flatMap((c) => c.store.map((s) => ({ ...s, company: companyLabel(c) }))), { color: (r) => (r.not_backed > 0 ? RED : null) });
  widths(store, [26, 16, 22, 22, 34, 34, 8, 22, 34, 12, 14, 14, 7, 60, 34, 40]);

  // ARRIVALS
  const arr = wb.addWorksheet(sheetName("ARRIVALS", used));
  addTable(arr, [
    { label: "Company", value: (r) => r.company }, { label: "Material", key: "material" }, { label: "PO / CSN", key: "reference" },
    { label: "Supplier", key: "supplier" }, { label: "Status", value: (r) => STATUS_LABEL[r.status] ?? r.status },
    { label: "Qty", value: (r) => num(r.qty), num: true }, { label: "UoM", key: "uom" },
    { label: "ETA (CSN / PO)", value: (r) => day(r.source_eta) }, { label: "Planning ETA", value: (r) => day(r.planning_eta) },
    { label: "Issue", value: (r) => (r.no_eta ? "No ETA" : r.overdue ? "ETA passed" : "") },
    { label: "Engine best date", value: (r) => day(r.engine_best_date) }, { label: "Vendor can move it?", key: "vendor_window" }, { label: "Why", key: "engine_reason" },
  ], companies.flatMap((c) => c.arrivals.map((a) => ({ ...a, company: companyLabel(c) }))), { color: (r) => (r.no_eta || r.overdue ? RED : null) });
  widths(arr, [26, 34, 44, 30, 18, 12, 7, 14, 14, 12, 16, 22, 60]);

  writeWaterfall(wb, companies, used);
  writeExplain(wb, companies, used);

  return wb;
}

// ─────────────────────────────────────────────────────────────────────────────
// WATERFALL (owner 2026-10-28, docs/mts-planning/PO22-WATERFALL-OWNER-METHOD-2026-10-28.md §13): the same four blocks as the 4A table —
// one plain sentence per family, each level's Min / Max days, the flow (receipts, top-ups, waiting levels) and who holds what.
// ─────────────────────────────────────────────────────────────────────────────
function writeWaterfall(wb, companies, used) {
  const families = companies.flatMap((c) => (c.blocks ?? []).filter((b) => b.waterfall && b.is_family).map((b) => ({ company: companyLabel(c), title: b.title, kind: b.kind, waterfall: b.waterfall })));
  const sentence = addSheetWithTable(wb, used, "WATERFALL_SUMMARY", [
    { label: "Company", key: "company" }, { label: "Family", key: "title" }, { label: "Type", key: "kind" },
    { label: "What to know", value: (r) => waterfallVerdict(r.waterfall, null).text }, { label: "Worst level", value: (r) => waterfallVerdict(r.waterfall, null).tone },
  ], families, { color: (r) => (waterfallVerdict(r.waterfall, null).tone === "ok" ? null : RED) });
  widths(sentence, [26, 40, 8, 100, 12]);

  const levels = addSheetWithTable(wb, used, "WATERFALL_LEVELS", [
    { label: "Company", key: "company" }, { label: "Family", key: "title" }, { label: "Level", key: "label" },
    { label: "Members", value: (r) => r.members.join("; ") },
    { label: "Min days", value: (r) => days(r.target_days), num: true }, { label: "Max days", value: (r) => days(r.max_days), num: true },
    { label: "Critical days", value: (r) => days(r.critical_days), num: true }, { label: "Cover now (days)", value: (r) => days(r.cover_days_now), num: true },
    { label: "Reserve now (KG)", value: (r) => num(r.reserve_now), num: true }, { label: "Next Min", value: (r) => r.next_min_day ?? "not in horizon" },
  ], families.flatMap((f) => f.waterfall.levels.map((l) => ({ ...l, company: f.company, title: f.title }))));
  widths(levels, [26, 40, 30, 60, 10, 10, 12, 16, 16, 14]);

  const flow = addSheetWithTable(wb, used, "WATERFALL_FLOW", [
    { label: "Company", key: "company" }, { label: "Family", key: "title" }, { label: "Date", key: "day" }, { label: "What happened", key: "what" },
    { label: "Level", key: "level" }, { label: "KG", value: (r) => num(r.qty), num: true }, { label: "From which material", key: "detail" },
    { label: "Short (KG)", value: (r) => (r.short ? num(r.shortfall) : null), num: true },
    { label: "Pool before", value: (r) => (r.what.startsWith("Receipt") ? null : num(r.pool_before)), num: true },
    { label: "Pool after", value: (r) => (r.what.startsWith("Receipt") ? null : num(r.pool_after)), num: true },
  ], families.flatMap((f) => flowRows(f.waterfall).map((r) => ({ ...r, company: f.company, title: f.title }))), { color: (r) => (r.short ? RED : null) });
  widths(flow, [26, 40, 12, 56, 32, 12, 60, 12, 14, 14]);

  const holds = addSheetWithTable(wb, used, "WATERFALL_WHO_HOLDS", [
    { label: "Company", key: "company" }, { label: "Family", key: "title" }, { label: "Date", key: "day" }, { label: "Material", key: "material" },
    { label: "Held for", key: "held_for" }, { label: "KG", value: (r) => num(r.qty), num: true },
  ], families.flatMap((f) => (f.waterfall.matrix ?? []).flatMap((snap) => {
    const grid = matrixGrid(f.waterfall, snap.day);
    return grid.rows.flatMap((row) => [
      ...grid.levels.map((level, i) => ({ company: f.company, title: f.title, day: snap.day, material: row.material, held_for: level, qty: row.cells[i] })),
      { company: f.company, title: f.title, day: snap.day, material: row.material, held_for: "Pool (excess)", qty: row.pool },
      { company: f.company, title: f.title, day: snap.day, material: row.material, held_for: "TOTAL STOCK", qty: row.total },
    ]).filter((r) => r.qty > 0.5 || r.held_for === "TOTAL STOCK");
  })));
  widths(holds, [26, 40, 12, 44, 34, 14]);
}

function addSheetWithTable(wb, used, name, columns, rows, options) {
  const sheet = wb.addWorksheet(sheetName(name, used));
  addTable(sheet, columns, rows, options);
  return sheet;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPLAIN: the waterfall day by day (owner 2026-10-27). Quantities are in the material's BASE unit (see UoM).
// ─────────────────────────────────────────────────────────────────────────────
const EXPLAIN_README = [
  ["How the plan decides — read this first"],
  [""],
  ["1. Three kinds of guard decide whether to buy:"],
  ["   • Own guard — the item has an exclusive/direct use. Stock for that use is protected first (through its Target + order cycle); groups cannot touch it."],
  ["   • Group guard — the group's members together (free stock, after every member's protected direct use) cover the group's demand for fewer days than the group's Target. This is the only guard for a group-only item."],
  ["   • There is NO separate guard on a group-only item (role \"Group only\"). If it runs out the other members carry the group; the plan buys only when the group itself reaches its Target."],
  [""],
  ["2. Every day the engine does this, in order (sheet EXPLAIN_DAILY = result, EXPLAIN_DRAWS = who gave what):"],
  ["   a. Receipts of that day arrive (confirmed ETAs and engine lots); stock past its expiry is dropped."],
  ["   b. Direct/exclusive use is taken first, oldest receipt first."],
  ["   c. Each group claims stock for today's demand plus its Desired-Max days ahead — smallest group first, then the broader ones."],
  ["   d. Inside a group the members are used in this order: expiring stock first → the saved Group Settings order → members with no future buy authorised (run down first) → otherwise in proportion to free stock, tilted to costlier stock and longer vendor credit (tilt capped 0.5–2×)."],
  ["   e. Left-over stock is shared once more narrow-to-broad, so one physical unit is claimed by one group only."],
  ["   f. The day's group demand is drawn from the members as decided in (d) — see EXPLAIN_DRAWS."],
  ["   g. Guards are tested on the closing balance; a guard that is hit asks for a lot (lead time → PO-by, then MOQ / multiple)."],
  [""],
  ["3. Columns in EXPLAIN_DAILY: Opening + Arrival + Engine lot − Use = Closing. 'Group draw' is the part of Use that was group demand drawn from this item. Cover days = days the closing balance lasts at the item's coming use. Flag: AT / BELOW TARGET, BELOW CRITICAL or STOCK-OUT for the item itself."],
  ["   A flag on a 'Group only' item is information, not an order: look at EXPLAIN_GROUPS — only the group's own dates matter for buying."],
  [""],
  ["4. Arrivals counted: only confirmed ETAs inside the horizon. An ETA after the horizon (e.g. a late-January CSN) is shown in ARRIVALS but is not stock for this run."],
  ["5. Everything here is advisory — no PO or stock movement is created by this file."],
];

function writeExplain(wb, companies, used) {
  const withExplain = companies.filter((c) => c.explain);
  if (withExplain.length === 0) return;

  const readme = wb.addWorksheet(sheetName("EXPLAIN_README", used));
  EXPLAIN_README.forEach((line, i) => {
    const row = readme.addRow(line);
    if (i === 0) row.getCell(1).font = { bold: true, size: 14 };
  });
  readme.getColumn(1).width = 190;

  const daily = wb.addWorksheet(sheetName("EXPLAIN_DAILY", used));
  addTable(daily, [
    { label: "Company", value: (r) => r.company }, { label: "Material", key: "material" }, { label: "Role", key: "role" },
    { label: "Date", value: (r) => day(r.day) }, { label: "UoM (base)", key: "uom" },
    { label: "Opening", value: (r) => num(r.opening), num: true }, { label: "Arrival (confirmed)", value: (r) => num(r.arrival) || null, num: true },
    { label: "Engine lot", value: (r) => num(r.engine_lot) || null, num: true }, { label: "Use", value: (r) => num(r.use), num: true },
    { label: "of which group draw", value: (r) => num(r.group_draw) || null, num: true }, { label: "Closing", value: (r) => num(r.closing), num: true },
    { label: "Cover days", value: (r) => days(r.cover_days), num: true },
    { label: "Target", value: (r) => num(r.target_days), num: true }, { label: "Critical", value: (r) => num(r.critical_days), num: true },
    { label: "Flag", key: "flag" },
  ], withExplain.flatMap((c) => c.explain.daily.map((d) => ({ ...d, company: companyLabel(c) }))),
  { color: (r) => (r.flag === "STOCK-OUT" ? RED : r.flag === "BELOW CRITICAL" ? (r.role === "Group only" ? AMBER : RED) : r.flag ? AMBER : null) });
  widths(daily, [26, 40, 20, 12, 9, 13, 14, 12, 12, 14, 13, 10, 8, 9, 18]);
  daily.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
  daily.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 15 } };

  const draws = wb.addWorksheet(sheetName("EXPLAIN_DRAWS", used));
  addTable(draws, [
    { label: "Company", value: (r) => r.company }, { label: "Date", value: (r) => day(r.day) }, { label: "Material", key: "material" },
    { label: "UoM (base)", key: "uom" }, { label: "Goes to", key: "destination" }, { label: "Flow", key: "flow" },
    { label: "Qty", value: (r) => num(r.qty), num: true }, { label: "Closing after draw", value: (r) => num(r.closing), num: true },
    { label: "Taken from (receipt)", key: "source" }, { label: "Receipt kind", key: "source_kind" },
  ], withExplain.flatMap((c) => c.explain.draws.map((d) => ({ ...d, company: companyLabel(c) }))));
  widths(draws, [26, 12, 40, 9, 30, 22, 13, 17, 36, 26]);
  draws.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];
  draws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 10 } };

  const groups = wb.addWorksheet(sheetName("EXPLAIN_GROUPS", used));
  addTable(groups, [
    { label: "Company", value: (r) => r.company }, { label: "Group", key: "group" }, { label: "Members", key: "members" },
    { label: "First below Target", value: (r) => day(r.first_below_target_day) }, { label: "First below Critical", value: (r) => day(r.first_below_critical_day) },
    { label: "First shortage", value: (r) => day(r.first_shortage_day) }, { label: "Unmet qty (base)", value: (r) => num(r.unresolved_qty), num: true },
    { label: "Action chain", key: "actions" },
  ], withExplain.flatMap((c) => c.explain.groups.map((g) => ({ ...g, company: companyLabel(c) }))),
  { color: (r) => (r.first_shortage_day ? RED : r.first_below_critical_day ? RED : r.first_below_target_day ? AMBER : null) });
  widths(groups, [26, 30, 70, 16, 18, 14, 16, 90]);
}

export async function downloadRollingPlanWorkbook({ companies, asOf, fileName }) {
  const wb = buildRollingPlanWorkbook({ companies, asOf });
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
