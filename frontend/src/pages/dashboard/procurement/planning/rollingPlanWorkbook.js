/*
 * PO22 Plan Excel (owner 2026-10-21, redesigned 2026-11-18) — the old "rolling_plan" workbook built from ERP, for the
 * Final or the Rolling plan alike (PO21 effective plan: Final where it exists, else Rolling):
 * every company the user can see in one file. Tabs:
 *   SUMMARY · PLAN · RM Stand-alone · RM Group · RM MHEC · RM RDP · PM Stand-alone · PM Group ·
 *   <Company> RM_PM (requirement) · STORE_INSTRUCTIONS.
 * Family tabs: 1 Today, 2 Level by level (every order on its Tracker date, Suggested date beside it), 3 New orders the engine adds.
 * "Tracker date" = the date in the CSN Tracker; "Suggested date" = the date the engine advises. Days are whole, rounded down.
 * Names only, never PACE codes. Loaded with a dynamic import so exceljs stays out of the page bundle.
 */
import ExcelJS from "exceljs";
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
const BLOCK_HEAD = ["Date", "Opening", "ETA to Plant", "Quantity to Dispatch", "Pro-rata", "Closing", "Excess (not needed yet)", "Max Days", "Min Stk", "Min Days", "PO / CSN", "Qty", "Supplier", "ST", "What to do (suggested)", "ETD (suggested)", "ETA to Port (suggested)", "ETA to Plant (suggested)", "Why this date", "Tracker date: ETD / Port / Plant"];
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
/** Owner 2026-10-30: the lot is timed at the ITEM's own (lower) Min, so when it lands the level it serves is still below ITS Min (the pool covers the gap): say how many days, and how far above Critical it stays. */
const minDipText = (d) => {
  if (!d) return "";
  const crit = d.critical_days !== null && d.critical_days !== undefined ? `, Critical ${d.critical_days} d` : "";
  const above = d.days_above_critical !== null && d.days_above_critical !== undefined ? ` ${Math.floor(d.days_above_critical)} d ${d.days_above_critical >= 0 ? "above" : "BELOW"} Critical.` : "";
  const fmt = (n) => new Intl.NumberFormat("en-IN").format(Math.round(n));
  const ask = d.ask_day && d.pool_qty_at_ask !== null && d.pool_qty_at_ask !== undefined
    ? ` On ${d.ask_day} it asked the pool for ${fmt(d.ask_wanted_qty)} KG, got ${fmt(d.ask_got_qty)} KG (pool held ${fmt(d.pool_qty_at_ask)} KG).` : "";
  return `When this lot lands, ${d.level_label} sits below its Min for ${d.days_below_min} day(s) (${d.from} to ${d.to}): the pool could not refill it.${ask} Cover down to ${Math.floor(d.lowest_cover_days)} d (Min ${d.min_days} d${crit}).${above}`;
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
  return [join("action"), join("etd"), join("port"), join("plant"), join("why") || (r.best_dates ?? []).filter(Boolean).join("\n")];
}


// ─────────────────────────────────────────────────────────────────────────────
// Group tabs (owner 2026-11-04): one lean block per family — orders at a glance, the pool diary, level by level, and the day-by-day table folded.
// Every fact appears once; the long engine wording and the day-by-day table are folded (click [+] at the left edge), nothing is dropped.
// ─────────────────────────────────────────────────────────────────────────────
// Whole numbers from 100 up; below that up to 3 decimals, so a family kept in MT never shows 0.167 MT/day as "0".
const qty = (n) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  return Math.abs(v) >= 100 ? Math.round(v).toLocaleString("en-US") : Number(v.toFixed(3)).toLocaleString("en-US", { maximumFractionDigits: 3 });
};
const matLines = (list) => {
  const items = (list ?? []).filter((x) => x.qty > 0.5);
  return items.length ? `${items.map((x) => `${x.material}: ${qty(x.qty)}`).join("\n")}\nTotal: ${qty(items.reduce((sum, x) => sum + x.qty, 0))}` : "—";
};
/** "If CSN 3000000239 does not come → land by 2026-11-30" instead of the full paragraph (the full wording stays in the folded rows). */
/** The CSN Tracker's own legs: ATD (BL date) when shipped else ETD; ATA at port when arrived else ETA; ETA to plant. */
/**
 * Owner 2026-11-17: a level already below its Min today says so, and names the shipment on the road that lifts it: an order that has not
 * shipped cannot fix those days, so no advised date is chased for them.
 */
const belowMinToday = (sct) => {
  const cover = sct.today_cover;
  if (cover === null || cover === undefined || sct.target_days === null || sct.target_days === undefined || Number(cover) >= Number(sct.target_days)) return "";
  const road = (sct.rows ?? []).filter((r) => r.kind === "Existing order" && (r.status === "IN_TRANSIT" || r.status === "AT_GATE") && r.existing_eta)
    .map((r) => String(r.existing_eta).slice(0, 10)).sort()[0];
  return `\nBELOW MIN TODAY (${Math.floor(Number(cover))} d < Min ${days(sct.target_days) ?? sct.target_days} d)${road ? `, until the shipment on the road lands ${day(road)}` : ""}. An order that has not shipped cannot fix these days.`;
};
const recordedText = (rec, fallbackPlant, today = null) => {
  const due = (d) => Boolean(today && d && String(d).slice(0, 10) > today);
  const tag = (actual, d, name) => (actual ? ` (${name}${due(d) ? ", due" : ""})` : "");
  return rec
    ? `ETD ${day(rec.etd) || "—"}${tag(rec.etd_actual, rec.etd, "ATD")}\nPort ${day(rec.port) || "—"}${tag(rec.port_actual, rec.port, "ATA")}\nPlant ${day(rec.plant) || day(fallbackPlant) || "—"}`
    : (fallbackPlant ? `Plant ${day(fallbackPlant)}` : "—");
};
/** The plan's as-of day (for "order-by already passed"): the first row of the family's day table. */

// Family tabs (owner 2026-11-18): the same day table and Prediction as the Stand-alone tabs and the old rolling-plan file (the engine's own Opening /
// Pro-rata / Closing / Max Days / Min Days per date), preceded by ONE small table: what each level holds today.
function writeFamilyToday(sheet, b) {
  const u = b.uom ?? "";
  const sections = b.level_sections ?? [];
  if (!sections.length && !(b.qa_stock ?? []).length && !(b.excess_after ?? []).length) return;
  const cap = sheet.addRow(["Today — what each level holds"]);
  cap.getCell(1).font = { bold: true };
  styleHeader(sheet.addRow(["Level (narrow first)", "Min · Max · Critical (days)", "Held by this level", `Use / day today (${u})`, "Cover today (days, follows the monthly plan)", "Note"]));
  for (const sct of sections) {
    const todayRow = (sct.rows ?? []).find((r) => r.kind === "Stock today");
    const low = sct.today_cover !== null && sct.today_cover !== undefined && sct.target_days !== null && sct.target_days !== undefined && Number(sct.today_cover) < Number(sct.target_days);
    const row = sheet.addRow([`${sct.label}\n${(sct.members ?? []).join(" + ")}`, `Min ${days(sct.target_days) ?? "—"} · Max ${days(sct.max_days) ?? "—"} · Critical ${days(sct.critical_days) ?? "—"}`,
      qty(sct.reserve_now ?? todayRow?.lot_qty), qty(todayRow?.prorata_b), days(sct.today_cover) ?? "—", low ? belowMinToday(sct).trim() : ""]);
    row.eachCell((cell) => { cell.border = BORDER; cell.alignment = { vertical: "top", wrapText: true }; });
    if (low) { row.getCell(5).font = { bold: true, color: { argb: RED } }; row.getCell(6).font = { color: { argb: RED } }; }
  }
  const pool = sheet.addRow(["EXCESS POOL (no level needs it yet)", "", matLines(b.excess_after)]);
  pool.eachCell((cell) => { cell.border = BORDER; cell.alignment = { vertical: "top", wrapText: true }; cell.font = { bold: true }; });
  if ((b.qa_stock ?? []).length) {
    const qaTotal = b.qa_stock.reduce((sum, x) => sum + x.qty, 0);
    const qa = sheet.addRow(["IN QA today (not counted)", "", matLines(b.qa_stock), "", "", b.qa_extra_days !== null && b.qa_extra_days !== undefined ? `If all ${qty(qaTotal)} ${u} passes QA, the family's cover grows by about ${days(b.qa_extra_days)} d.${b.first_shortage_day ? ` The shortage from ${b.first_shortage_day} may be a QA delay, not a missing order: chase QA before ordering.` : ""}` : "Cover effect not shown: no planned use."]);
    qa.eachCell((cell) => { cell.border = BORDER; cell.alignment = { vertical: "top", wrapText: true }; });
  }
  sheet.addRow([]);
}

/** A suggested lot lands on this day but is never counted in the numbers beside it (owner 2026-11-12): list it in the PO / CSN column. */
/** The engine's Suggested-date columns; a stand-alone row also says how far below Min it is on the Tracker date (Min Days = the cover before landing). */
function belowMinWhy(b, r, sections) {
  const cols = bestColumns(r);
  if (!sections && (r.references ?? []).length && b.target_days !== null && b.target_days !== undefined && r.min_days !== null && r.min_days !== undefined && Number(r.min_days) < Number(b.target_days)) {
    const target = Math.floor(Number(b.target_days) + 1e-9);
    const floor = Math.floor(Number(r.min_days) + 1e-9);
    cols[4] = [cols[4], `On the Tracker date the cover before landing is ${floor} d: below Min ${target} by ${target - floor} d.`].filter(Boolean).join("\n");
  }
  return cols;
}
// Family tabs, last two columns (owner 2026-11-18): for every stock / CSN / projection row, each level's Min → Max (cover before → after landing) on the
// Tracker date and on the Suggested date, and the excess left in each level. All numbers are the engine's own; nothing is estimated here.
const LEVEL_HEAD = ["Level Min → Max   (Tracker date | Suggested date)", "Excess by level   (Tracker | Suggested)"];
const levelDays = (v, beyond, u = "") => (v !== null && v !== undefined ? String(Math.floor(Number(v) + 1e-9)) : beyond ? `${beyond.days} d to plan end + ${qty(beyond.left)} ${u} spare`.replace("  ", " ") : "—");
const belowMinNote = (before, sct) => {
  if (before === null || before === undefined || sct.target_days === null || sct.target_days === undefined) return "";
  const gap = Math.floor(Number(sct.target_days) + 1e-9) - Math.floor(Number(before) + 1e-9);
  return gap > 0 ? `  ⚠ below Min ${Math.floor(Number(sct.target_days) + 1e-9)} by ${gap} d` : "";
};
function levelColumns(b, match, isToday = false) {
  const minMax = []; const excess = [];
  for (const sct of b.level_sections ?? []) {
    const rows = (sct.rows ?? []).filter((r) => (isToday ? r.kind === "Stock today" : match(r)));
    if (!rows.length) continue;
    for (const r of rows) {
      const mm = isToday
        ? `${sct.label}: ${levelDays(sct.today_cover)} d cover today`
        : `${sct.label}: ${levelDays(r.min_a_before, r.min_a_before_x, b.uom ?? "")} → ${levelDays(r.max_a, r.max_a_x, b.uom ?? "")}${belowMinNote(r.min_a_before, sct)}  |  ${levelDays(r.min_b_before, r.min_b_before_x, b.uom ?? "")} → ${levelDays(r.max_b, r.max_b_x, b.uom ?? "")}${belowMinNote(r.min_b_before, sct)}`;
      const ex = isToday ? `${sct.label}: ${qty(r.excess)}` : `${sct.label}: ${qty(r.excess_a)}  |  ${qty(r.excess)}`;
      if (!minMax.includes(mm)) minMax.push(mm);
      if (!excess.includes(ex)) excess.push(ex);
    }
  }
  return [minMax.join("\n"), excess.join("\n")];
}

function writeBlocks(sheet, companies, kind, { filter = () => true, sections = false, emptyText } = {}) {
  const list = companies.flatMap((c) => (c.blocks ?? []).filter((b) => b.kind === kind && filter(b)).map((b) => ({ ...b, company: c })))
    .sort((a, b) => a.title.localeCompare(b.title) || companyLabel(a.company).localeCompare(companyLabel(b.company)));
  if (list.length === 0) { sheet.addRow([emptyText ?? `No ${kind} item with use, arrival or order in the horizon.`]); return; }
  for (const b of list) {
    const title = sheet.addRow([`${companyLabel(b.company)} — ${b.title}${b.is_family ? ` (family: ${b.members.join(", ")})` : ""}`]);
    title.getCell(1).font = { bold: true };
    title.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_FILL } };
    // A family has one Target / Critical per member: show each, not just the first member's pair.
    const policyFacts = b.is_family && (b.members_policy ?? []).length ? `Target / Critical — ${b.members_policy.join(" · ")}` : null;
    const facts = [`Unit ${b.uom ?? "—"}`, ...(policyFacts ? [policyFacts] : [`Target ${b.target_days ?? "—"} d`, `Critical ${b.critical_days ?? "—"} d`]), b.first_shortage_day ? `RUNS OUT ${b.first_shortage_day}${(b.qa_stock ?? []).length ? ` (but ${qty(b.qa_stock.reduce((sum, x) => sum + x.qty, 0))} ${b.uom ?? ""} is still in QA)` : ""}` : "",
      (b.gaps ?? []).length ? `ENGINE CANNOT PLAN — ${b.gaps.join("; ")}` : ""].filter(Boolean).join(" · ");
    const factRow = sheet.addRow([facts]);
    if (b.is_family && (b.members_stock ?? []).length) {
      const stockRow = sheet.addRow([`Member stock: ${b.members_stock.join(" · ")}`]);
      stockRow.getCell(1).font = { italic: true };
    }
    if (b.first_shortage_day || (b.gaps ?? []).length) factRow.getCell(1).font = { bold: true, color: { argb: RED } };
    // Owner 2026-11-17: the sheet proves itself; a failed check is printed in red on the block.
    if ((b.self_check ?? []).length) {
      const failed = sheet.addRow([`SELF-CHECK FAILED (${b.self_check.length}): ${b.self_check.slice(0, 3).join(" · ")}`]);
      failed.getCell(1).font = { bold: true, color: { argb: RED } };
    }
    // Owner 2026-11-17: a stand-alone item already below its Min today says so (same wording as a family level) and names the shipment on the road.
    if (!b.is_family) {
      const first = (b.rows ?? [])[0];
      const road = (b.rows ?? []).filter((r) => r.day > (first?.day ?? "") && (r.statuses ?? []).some((st) => st === "IN_TRANSIT" || st === "AT_GATE")).map((r) => r.day).sort()[0];
      if (first && first.min_days !== null && first.min_days !== undefined && b.target_days !== null && b.target_days !== undefined && Number(first.min_days) < Number(b.target_days)) {
        const line = sheet.addRow([`BELOW MIN TODAY (${Math.floor(Number(first.min_days))} d < Min ${b.target_days} d)${road ? `, until the shipment on the road lands ${day(road)}` : ""}. An order that has not shipped cannot fix these days.`]);
        line.getCell(1).font = { bold: true, color: { argb: RED } };
      }
    }
    if (b.together_note) {
      const tn = sheet.addRow([b.together_note]);
      tn.getCell(1).font = { italic: true, bold: true };
    }
    if (sections) writeFamilyToday(sheet, b);
    styleHeader(sheet.addRow(sections ? [...BLOCK_HEAD, ...LEVEL_HEAD] : BLOCK_HEAD));
    const asOfDay = (b.rows ?? [])[0]?.day ?? "";
    // Owner 2026-11-18: the stock / CSN table holds stock and CSNs only. No new lot (suggested or projected) is put in it: the day table stops at the last
    // recorded order, and new orders live in their own Projection table below.
    let lastRecordedIndex = 0;
    (b.rows ?? []).forEach((r, index) => { if ((r.references ?? []).length > 0) lastRecordedIndex = index; });
    const dayRows = (b.rows ?? []).filter((r, index) => index <= lastRecordedIndex && (index === 0 || (r.references ?? []).length > 0 || (r.dispatch !== null && r.dispatch !== undefined && Number(r.dispatch) !== 0)));
    for (const r of dayRows) {
      const row = sheet.addRow([
        day(r.day), num(r.opening), num(r.arrivals) || null, num(r.dispatch), num(r.use), num(r.closing), num(r.excess), coverCell(r.max_days, r.max_days_est, r.closing, b.plan_end), num(r.min_stock), coverCell(r.min_days, r.min_days_est, r.min_stock, b.plan_end),
        r.references.join("\n"), r.qtys.join("\n"), r.suppliers.join("\n"),
        r.statuses.map((s) => STATUS_LABEL[s] ?? s).join("\n"),
        ...belowMinWhy(b, r, sections),
        (r.rec_cells ?? []).map((rec) => recordedText(rec, null)).filter((t) => t !== "—").join("\n"),
        ...(sections ? levelColumns(b, (x) => x.kind === "Existing order" && x.existing_eta && (String(x.existing_eta).slice(0, 10) === r.day || (String(x.existing_eta).slice(0, 10) < asOfDay && r.day === asOfDay)), r.day === asOfDay && !(r.references ?? []).length) : []),
      ]);
      row.eachCell((cell, i) => { cell.border = BORDER; if (i >= 2 && i <= 10) cell.numFmt = NUM; cell.alignment = { vertical: "top", wrapText: i >= 11 }; });
      if (r.closing < 0) row.getCell(6).font = { bold: true, color: { argb: RED } };
      if (b.critical_days !== null && r.min_days !== null && r.min_days < b.critical_days) row.getCell(10).font = { bold: true, color: { argb: RED } };
      else if (b.target_days !== null && r.min_days !== null && r.min_days < b.target_days) row.getCell(10).font = { bold: true, color: { argb: AMBER } };
    }
    // Owner 2026-11-18: the existing Prediction table is the projection table (not mixed into the stock / CSN table). It shows the next new orders IF the
    // not-yet-shipped orders move to their Suggested dates. The engine gives no single family Max / Min for that plan, so those two columns show each level's
    // Min → Max and excess instead (never blank). Trigger columns come from the same lot in the Tracker-date plan when it exists there.
    const suggestedLots = Array.isArray(b.projection_total) ? b.projection_total.filter((p) => p.engine_eta).sort((x, y) => String(x.engine_eta).localeCompare(String(y.engine_eta))) : null;
    if (suggestedLots ? suggestedLots.length : b.prediction.length) {
      const cap = sheet.addRow([suggestedLots ? "Prediction — the next new orders if the orders move to their Suggested dates" : "Prediction"]);
      cap.getCell(1).font = { bold: true, italic: true };
      const head = [...PRED_HEAD];
      if (suggestedLots) head.push("Family worst Min (Suggested date)");
      if (suggestedLots) { head[5] = "Level Min → Max (Suggested date)"; head[6] = "Excess by level (Suggested)"; }
      styleHeader(sheet.addRow(head));
      const shown = suggestedLots ?? b.prediction;
      for (const x of shown) {
        let cells;
        if (suggestedLots) {
          const same = (b.prediction ?? []).find((y) => y.material === x.material && day(y.date) === day(x.recorded_eta));
          let worst = null;
          const minMax = []; const excess = [];
          for (const sct of b.level_sections ?? []) {
            for (const r of (sct.rows ?? []).filter((q) => q.kind === "Projection" && q.material === x.material && String(q.engine_eta ?? "").slice(0, 10) === String(x.engine_eta).slice(0, 10))) {
              minMax.push(`${sct.label}: ${levelDays(r.min_b_before, r.min_b_before_x, b.uom ?? "")} → ${levelDays(r.max_b, r.max_b_x, b.uom ?? "")}${belowMinNote(r.min_b_before, sct)}`);
              excess.push(`${sct.label}: ${qty(r.excess)}`);
              if (r.min_b_before !== null && r.min_b_before !== undefined && (worst === null || Number(r.min_b_before) < worst.value)) worst = { value: Number(r.min_b_before), label: sct.label };
            }
          }
          cells = ["Suggested", day(x.etd), day(x.port), day(x.engine_eta), num(x.qty), [...new Set(minMax)].join("\n") || "—", [...new Set(excess)].join("\n") || "—", x.material, x.supplier ?? "", day(x.po_by),
            same?.uom ?? b.uom ?? "", same ? days(same.trigger_cover_days) : "", same ? days(same.trigger_min_days) : "", same ? triggeredBy(same) : "", same ? [minGapText(same.min_gap), minDipText(same.min_dip)].filter(Boolean).join("\n") : "", "", "", "", x.alternatives || "—", worst ? `${Math.floor(worst.value + 1e-9)} d (${worst.label})` : "—"];
        } else {
          cells = [x.source === "YOU" ? "Planner" : "Suggested", day(x.import_etd), day(x.port_eta), day(x.date), num(x.qty), coverCell(x.max_days, x.max_days_est, 0, b.plan_end), coverCell(x.min_days, x.min_days_est, 0, b.plan_end), x.material, x.supplier ?? "", day(x.po_by),
            x.uom ?? "", days(x.trigger_cover_days), days(x.trigger_min_days), triggeredBy(x), [minGapText(x.min_gap), minDipText(x.min_dip)].filter(Boolean).join("\n"), "", "", "", alternativesText(x.alternatives)];
        }
        const row = sheet.addRow(cells);
        row.eachCell((cell, i) => { cell.border = BORDER; if (i === 5 || (!suggestedLots && (i === 6 || i === 7))) cell.numFmt = NUM; });
        for (const c of suggestedLots ? [6, 7, 14, 15, 19, 20] : [14, 15, 19]) row.getCell(c).alignment = { wrapText: true, vertical: "top" };
      }
    }
    sheet.addRow([]);
    sheet.addRow([]);
  }
  widths(sheet, sections ? [16, 26, 24, 18, 13, 13, 38, 13, 13, 13, 42, 42, 13, 9, 10, 10, 10, 10, 14, 26, 56, 34] : [16, 26, 24, 18, 13, 13, 38, 13, 13, 13, 42, 42, 13, 9, 10, 10, 10, 10, 14, 14, 44, 40]);
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
  const heldCsns = companies.flatMap((c) => (c.held_csns ?? []).map((row) => ({ ...row, company: companyLabel(c) })));
  if (heldCsns.length) {
    const held = summary.addRow(["CSNs on Hold — excluded from every planning total"]);
    held.getCell(1).font = { bold: true, color: { argb: "9A3412" } };
    addTable(summary, [
      { label: "Company", key: "company" }, { label: "PO", key: "po_number" }, { label: "CSN", key: "csn_number" }, { label: "Material", key: "material" },
      { label: "Supplier", key: "supplier" }, { label: "Qty", value: (r) => num(r.qty), num: true }, { label: "UoM", key: "uom" },
      { label: "Before Hold", key: "previous_status" }, { label: "Hold reason", key: "reason" }, { label: "Held on", value: (r) => day(r.held_at) }, { label: "ETA", value: (r) => day(r.eta) },
    ], heldCsns, { color: () => AMBER });
    summary.addRow([]);
  }
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
  // Owner 2026-11-03: RM and PM each get a Stand-alone tab (items in no group) and a Group tab (every group member, also one that is exclusive in some product).
  writeBlocks(wb.addWorksheet(sheetName("RM Stand-alone", used)), companies, "RM", { filter: (b) => !b.is_family, emptyText: "No stand-alone RM item with use, arrival or order in the horizon." });
  // Owner 2026-11-04: the MHEC and RDP families (the two big shared-pool groups) get their own tabs; "RM Group" keeps every other group.
  const familyTab = (b) => (/MHEC/i.test(b.title) ? "MHEC" : /RDP/i.test(b.title) ? "RDP" : "OTHER");
  writeBlocks(wb.addWorksheet(sheetName("RM Group", used)), companies, "RM", { filter: (b) => b.is_family && familyTab(b) === "OTHER", sections: true, emptyText: "No RM group item with use, arrival or order in the horizon." });
  writeBlocks(wb.addWorksheet(sheetName("RM MHEC", used)), companies, "RM", { filter: (b) => b.is_family && familyTab(b) === "MHEC", sections: true, emptyText: "No MHEC family with use, arrival or order in the horizon." });
  writeBlocks(wb.addWorksheet(sheetName("RM RDP", used)), companies, "RM", { filter: (b) => b.is_family && familyTab(b) === "RDP", sections: true, emptyText: "No RDP family with use, arrival or order in the horizon." });
  writeBlocks(wb.addWorksheet(sheetName("PM Stand-alone", used)), companies, "PM", { filter: (b) => !b.is_family, emptyText: "No stand-alone PM item with use, arrival or order in the horizon." });
  writeBlocks(wb.addWorksheet(sheetName("PM Group", used)), companies, "PM", { filter: (b) => b.is_family, sections: true, emptyText: "No PM group item with use, arrival or order in the horizon." });

  // Requirement per company
  for (const c of companies) {
    const sheet = wb.addWorksheet(sheetName(`${companyLabel(c)} RM_PM`, used));
    addTable(sheet, [
      { label: "ITEMS", key: "material" }, { label: "TYPE", key: "type" }, { label: "UoM", key: "uom" },
      { label: "Target Cov", value: (r) => num(r.target_cov_days), num: true }, { label: "Critical Cov", value: (r) => num(r.critical_cov_days), num: true },
      { label: "CURRENT STK DAYS", value: (r) => num(r.current_stk_days) ?? r.current_stk_days_note ?? null, num: true }, { label: "Next Month cov", value: (r) => num(r.next_month_cov), num: true },
      { label: "Current Req", value: (r) => num(r.current_req), num: true }, { label: "Current Prorata", value: (r) => num(r.current_prorata), num: true },
      { label: "Req NM", value: (r) => num(r.req_nm), num: true }, { label: "Prorata NM", value: (r) => num(r.prorata_nm), num: true },
      { label: "CURRENT_STOCK", value: (r) => num(r.current_stock), num: true }, { label: "Group (via)", key: "group_via" }, { label: "Group demand (CM+NM)", value: (r) => num(r.group_demand), num: true }, { label: "INTRANSIT CM (dispatched)", value: (r) => num(r.intransit_cm), num: true },
      { label: "OPEN PO CM", value: (r) => num(r.open_po_cm), num: true }, { label: "INTRANSIT NM (dispatched)", value: (r) => num(r.intransit_nm), num: true }, { label: "OPEN PO NM", value: (r) => num(r.open_po_nm), num: true },
      { label: "Runs out on", value: (r) => day(r.first_shortage_day) }, { label: "Below Critical from", value: (r) => day(r.first_below_critical_day) },
      { label: "Remark", key: "note" },
    ], c.requirement, { color: (r) => (r.group_covered ? AMBER : r.first_shortage_day ? RED : r.below_critical ? AMBER : null) });
    widths(sheet, [40, 6, 7, 10, 10, 12, 12, 12, 12, 12, 12, 13, 22, 14, 12, 12, 12, 12, 12, 14, 50]);
    sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  }

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

  return wb;
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
