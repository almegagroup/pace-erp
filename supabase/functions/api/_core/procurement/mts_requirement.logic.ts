/*
 * File-Path: supabase/functions/api/_core/procurement/mts_requirement.logic.ts
 * Domain: PROCUREMENT / MTS PLANNING
 * Purpose: PO22 Requirement — pure, database-free calculation engine.
 *          Every number on the Requirement Report is produced here from
 *          already-loaded source rows, so the same inputs always give the same
 *          output (deterministic) and every rule is unit-tested directly
 *          (mts_requirement.logic.test.ts).
 *
 *          Contract: docs/mts-planning/PO22-REQUIREMENT-CALCULATION-CONTRACT.md
 *
 *          Pipeline:
 *            1. effectivePlanAt()      PO21 plan lines → effective monthly SKU demand
 *                                      (optionally as the plan stood at a timestamp)
 *            2. skuDailyDemand()       monthly SKU demand → day-wise KG
 *                                      (calendar pro-rata + Urgent windows)
 *            3. explodeDemand()        SKU/Prodshade day demand → RM via effective
 *                                      Stroke periods, PM via company Pack BOM
 *            4. allocateDemand()       group demand pools → individual materials,
 *                                      stock counted once (production's rule)
 *            5. partitionPoLineInbound() PO / GE / CSN / lot → one dated inbound
 *                                      event per physical unit (owner Q-T06)
 *            6. computeLeadTime()      configured vs observed lead time
 *            7. computeMaterialMetrics() all REQUIREMENT-sheet business fields
 *
 *          Nothing here reads or writes the database. Planning never writes
 *          stock, reservation, PO, CSN, GRN, production or GL records.
 * Authority: Backend
 */

import { orderByGroupUsage, type GroupUsageOrder } from "../../_shared/groupUsageOrder.logic.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────
const QTY_DECIMALS = 6;
const EPSILON = 0.000001;
const DAY_MS = 86_400_000;

export function roundQty(value: number): number {
  const factor = 10 ** QTY_DECIMALS;
  return Math.round(value * factor) / factor;
}
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toUtcMs(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`);
}
export function addDays(isoDate: string, days: number): string {
  return new Date(toUtcMs(isoDate) + days * DAY_MS).toISOString().slice(0, 10);
}
/** Inclusive day count from..to (0 when to < from). */
export function daysInclusive(from: string, to: string): number {
  const diff = Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
  return diff < 0 ? 0 : diff + 1;
}
export function monthStart(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}
export function monthEnd(monthFirstDay: string): string {
  const year = Number(monthFirstDay.slice(0, 4));
  const month = Number(monthFirstDay.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
export function nextMonth(monthFirstDay: string): string {
  return addDays(monthEnd(monthFirstDay), 1);
}
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = toUtcMs(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}
function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}
function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

// ─────────────────────────────────────────────────────────────────────────────
// Planning calendar (as-of date, current month CM, next month NM)
// ─────────────────────────────────────────────────────────────────────────────
export type PlanningCalendar = {
  asOf: string;           // start of this day is the stock / consumption cut-off
  cmStart: string;
  cmEnd: string;
  nmStart: string;
  nmEnd: string;
  cmDaysInMonth: number;
  cmDaysLeft: number;     // inclusive: as-of .. CM end
  cmDaysElapsed: number;  // CM start .. day before as-of
  nmDaysInMonth: number;
  horizon: string[];      // every day CM start .. horizonEnd
  /** Plan months exploded: CM, NM, then any extra months (P1 item plan); default CM + NM. */
  months: string[];
  /** Last day of the planning horizon (= nmEnd unless extra months are asked for). */
  horizonEnd: string;
};

/** CM = the selected plan month; the as-of date must lie inside it. */
export function buildCalendar(planMonth: string, asOf: string, extraMonths = 0): PlanningCalendar | null {
  if (!isIsoDate(planMonth) || planMonth.slice(8) !== "01" || !isIsoDate(asOf)) return null;
  if (!Number.isInteger(extraMonths) || extraMonths < 0 || extraMonths > 12) return null;
  const cmStart = planMonth;
  const cmEnd = monthEnd(cmStart);
  if (asOf < cmStart || asOf > cmEnd) return null;
  const nmStart = nextMonth(cmStart);
  const nmEnd = monthEnd(nmStart);
  const months = [cmStart, nmStart];
  for (let i = 0; i < extraMonths; i += 1) months.push(nextMonth(months[months.length - 1]));
  const horizonEnd = monthEnd(months[months.length - 1]);
  const horizon: string[] = [];
  for (let day = cmStart; day <= horizonEnd; day = addDays(day, 1)) horizon.push(day);
  return {
    asOf,
    cmStart,
    cmEnd,
    nmStart,
    nmEnd,
    cmDaysInMonth: daysInclusive(cmStart, cmEnd),
    cmDaysLeft: daysInclusive(asOf, cmEnd),
    cmDaysElapsed: daysInclusive(cmStart, addDays(asOf, -1)),
    nmDaysInMonth: daysInclusive(nmStart, nmEnd),
    horizon,
    months,
    horizonEnd,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Effective PO21 plan (same rule as erp_planning.customer_plan_effective)
// ─────────────────────────────────────────────────────────────────────────────
export type PlanLineVersion = {
  /** Immutable customer_plan_line row id when read from ERP. */
  source_id?: string;
  entry_id: string;
  version_no: number;
  plan_month: string;
  plan_type: "ROLLING" | "FINAL" | "ADDITIONAL" | "URGENT";
  urgent_mode: "FROM_PLAN" | "EXTRA" | null;
  urgent_from_date: string | null;
  urgent_to_date: string | null;
  sku_material_id: string;
  base_qty: number;
  is_cancelled: boolean;
  created_at: string;
  /**
   * PO21 cross-company production (owner 2026-10-20): the company that owns this plan line when it
   * is produced by the company being planned. Absent = the planned company's own line. Each origin's
   * FINAL-else-ROLLING rule is applied separately, then the demands are added.
   */
  origin_company_id?: string;
};

export type UrgentWindow = { qty: number; from: string; to: string };

/**
 * One effective PO21 plan line (exact customer_plan_line version) that makes
 * up an SKU-month.  Superseded versions, cancelled entries and a ROLLING base
 * replaced by a FINAL are never contributors.
 *   BASE / ADDITIONAL — share the month pool in proportion to their qty.
 *   URGENT_EXTRA      — adds its own qty inside its own window.
 *   URGENT_FROM_PLAN  — re-phases pool qty into its window; adds nothing.
 */
export type PlanLineRef = {
  source_id: string | null;
  entry_id: string;
  version_no: number;
  plan_type: PlanLineVersion["plan_type"];
  urgent_mode: PlanLineVersion["urgent_mode"];
  role: "BASE" | "ADDITIONAL" | "URGENT_EXTRA" | "URGENT_FROM_PLAN";
  qty: number;
  from: string | null;
  to: string | null;
};

/**
 * The part of one demand quantity that comes from one effective plan line.
 * `adds_qty=false` marks an Urgent FROM_PLAN line that only moved quantity
 * into this day; its qty is already counted under the BASE/ADDITIONAL lines.
 * Σ qty of the adds_qty=true contributions = the demand quantity.
 */
export type PlanLineContribution = {
  source_id: string | null;
  entry_id: string;
  version_no: number;
  plan_type: PlanLineVersion["plan_type"];
  urgent_mode: PlanLineVersion["urgent_mode"];
  role: PlanLineRef["role"];
  sku_material_id: string;
  adds_qty: boolean;
  qty: number;
};

export type EffectiveSkuMonth = {
  plan_month: string;
  sku_material_id: string;
  base_source: "FINAL" | "ROLLING" | null;
  base_qty: number | null;
  additional_qty: number;
  urgent_extra: UrgentWindow[];
  urgent_from_plan: UrgentWindow[];
  effective_qty: number | null; // null = nothing entered (distinct from 0)
  /** Exact effective plan-line versions behind this SKU-month (set by effectivePlanAt). */
  contributors?: PlanLineRef[];
};

/**
 * Effective monthly demand per SKU. `demandAt` (ISO timestamp) reconstructs the
 * plan as it stood at that moment from the append-only versions; null = latest.
 * Effective = latest FINAL if present else latest ROLLING, + every ADDITIONAL,
 * + every URGENT EXTRA. URGENT FROM_PLAN re-phases and never adds.
 */
export function effectivePlanAt(lines: PlanLineVersion[], demandAt: string | null): EffectiveSkuMonth[] {
  const cutoff = demandAt ? Date.parse(demandAt) : null;
  const latestByEntry = new Map<string, PlanLineVersion>();
  for (const line of lines) {
    if (cutoff !== null && Date.parse(line.created_at) > cutoff) continue;
    const seen = latestByEntry.get(line.entry_id);
    if (!seen || line.version_no > seen.version_no) latestByEntry.set(line.entry_id, line);
  }
  const byKey = new Map<string, PlanLineVersion[]>();
  for (const line of latestByEntry.values()) {
    if (line.is_cancelled) continue;
    const key = `${line.plan_month}|${line.sku_material_id}|${line.origin_company_id ?? ""}`;
    byKey.set(key, [...(byKey.get(key) ?? []), line]);
  }
  const perOrigin: EffectiveSkuMonth[] = [];
  for (const [key, group] of [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [plan_month, sku_material_id] = key.split("|");
    const sum = (rows: PlanLineVersion[]) => rows.reduce((total, row) => total + Number(row.base_qty), 0);
    const finals = group.filter((row) => row.plan_type === "FINAL");
    const rollings = group.filter((row) => row.plan_type === "ROLLING");
    const additionals = group.filter((row) => row.plan_type === "ADDITIONAL");
    const window = (row: PlanLineVersion): UrgentWindow => ({
      qty: Number(row.base_qty),
      from: String(row.urgent_from_date),
      to: String(row.urgent_to_date),
    });
    const urgentExtra = group.filter((row) => row.plan_type === "URGENT" && row.urgent_mode === "EXTRA")
      .sort((a, b) => a.entry_id.localeCompare(b.entry_id)).map(window);
    const urgentFromPlan = group.filter((row) => row.plan_type === "URGENT" && row.urgent_mode === "FROM_PLAN")
      .sort((a, b) => a.entry_id.localeCompare(b.entry_id)).map(window);
    const baseSource = finals.length > 0 ? "FINAL" : rollings.length > 0 ? "ROLLING" : null;
    const baseQty = finals.length > 0 ? sum(finals) : rollings.length > 0 ? sum(rollings) : null;
    const additional = sum(additionals);
    const extra = urgentExtra.reduce((total, row) => total + row.qty, 0);
    const anyDemand = baseQty !== null || additionals.length > 0 || urgentExtra.length > 0;
    const ref = (row: PlanLineVersion, role: PlanLineRef["role"]): PlanLineRef => ({
      source_id: row.source_id ?? null,
      entry_id: row.entry_id,
      version_no: row.version_no,
      plan_type: row.plan_type,
      urgent_mode: row.urgent_mode,
      role,
      qty: Number(row.base_qty),
      from: role === "URGENT_EXTRA" || role === "URGENT_FROM_PLAN" ? String(row.urgent_from_date) : null,
      to: role === "URGENT_EXTRA" || role === "URGENT_FROM_PLAN" ? String(row.urgent_to_date) : null,
    });
    const byEntry = (a: PlanLineVersion, b: PlanLineVersion) => a.entry_id.localeCompare(b.entry_id);
    const contributors: PlanLineRef[] = [
      ...(finals.length > 0 ? finals : rollings).sort(byEntry).map((row) => ref(row, "BASE")),
      ...additionals.sort(byEntry).map((row) => ref(row, "ADDITIONAL")),
      ...group.filter((row) => row.plan_type === "URGENT" && row.urgent_mode === "EXTRA").sort(byEntry).map((row) => ref(row, "URGENT_EXTRA")),
      ...group.filter((row) => row.plan_type === "URGENT" && row.urgent_mode === "FROM_PLAN").sort(byEntry).map((row) => ref(row, "URGENT_FROM_PLAN")),
    ];
    perOrigin.push({
      plan_month,
      sku_material_id,
      base_source: baseSource,
      base_qty: baseQty === null ? null : roundQty(baseQty),
      additional_qty: roundQty(additional),
      urgent_extra: urgentExtra,
      urgent_from_plan: urgentFromPlan,
      effective_qty: anyDemand ? roundQty((baseQty ?? 0) + additional + extra) : null,
      contributors,
    });
  }
  // Several origins of one month × SKU (own plan + plans produced for other companies) add up.
  const merged = new Map<string, EffectiveSkuMonth>();
  for (const entry of perOrigin) {
    const key = `${entry.plan_month}|${entry.sku_material_id}`;
    const seen = merged.get(key);
    if (!seen) { merged.set(key, entry); continue; }
    merged.set(key, {
      ...seen,
      base_source: seen.base_source === "FINAL" || entry.base_source === "FINAL" ? "FINAL" : seen.base_source ?? entry.base_source,
      base_qty: seen.base_qty === null && entry.base_qty === null ? null : roundQty((seen.base_qty ?? 0) + (entry.base_qty ?? 0)),
      additional_qty: roundQty(seen.additional_qty + entry.additional_qty),
      urgent_extra: [...seen.urgent_extra, ...entry.urgent_extra],
      urgent_from_plan: [...seen.urgent_from_plan, ...entry.urgent_from_plan],
      effective_qty: seen.effective_qty === null && entry.effective_qty === null ? null : roundQty((seen.effective_qty ?? 0) + (entry.effective_qty ?? 0)),
      contributors: [...(seen.contributors ?? []), ...(entry.contributors ?? [])],
    });
  }
  return [...merged.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Day-wise SKU demand inside one month
// ─────────────────────────────────────────────────────────────────────────────
export type Warning = { code: string; message: string; material_id?: string; sku_material_id?: string; prodshade_material_id?: string };

/** Spreads qty evenly over the days of [from, to] ∩ [monthFirst, monthLast]. */
function spreadOver(daily: Map<string, number>, qty: number, from: string, to: string, monthFirst: string, monthLast: string): boolean {
  const start = maxDate(from, monthFirst);
  const end = minDate(to, monthLast);
  const days = daysInclusive(start, end);
  if (days === 0) return false;
  const perDay = qty / days;
  for (let day = start; day <= end; day = addDays(day, 1)) daily.set(day, (daily.get(day) ?? 0) + perDay);
  return true;
}

/**
 * Day-wise demand of one SKU in one month (SKU base unit).
 *   * Base + Additional are spread by calendar-day pro-rata over the month,
 *     except the quantity that Urgent FROM_PLAN entries pull into their own
 *     windows (re-phasing — the month total does not change).
 *   * Urgent EXTRA adds its quantity inside its own window.
 *   * A window wholly outside the month falls back to the whole month (warned).
 */
export function skuDailyDemand(entry: EffectiveSkuMonth, warnings: Warning[]): Map<string, number> {
  const monthFirst = entry.plan_month;
  const monthLast = monthEnd(monthFirst);
  const daily = new Map<string, number>();
  if (entry.effective_qty === null) return daily;
  const pool = (entry.base_qty ?? 0) + entry.additional_qty;
  const fromPlanTotal = entry.urgent_from_plan.reduce((total, row) => total + row.qty, 0);
  const movable = Math.min(fromPlanTotal, pool);
  if (fromPlanTotal > pool + EPSILON) {
    warnings.push({
      code: "URGENT_FROM_PLAN_EXCEEDS_PLAN",
      message: `Urgent From Plan ${roundQty(fromPlanTotal)} exceeds the plan ${roundQty(pool)} for ${monthFirst}; only the plan quantity is re-phased.`,
      sku_material_id: entry.sku_material_id,
    });
  }
  spreadOver(daily, pool - movable, monthFirst, monthLast, monthFirst, monthLast);
  let scale = fromPlanTotal > EPSILON ? movable / fromPlanTotal : 0;
  if (!Number.isFinite(scale)) scale = 0;
  for (const row of entry.urgent_from_plan) {
    const qty = row.qty * scale;
    if (!spreadOver(daily, qty, row.from, row.to, monthFirst, monthLast)) {
      spreadOver(daily, qty, monthFirst, monthLast, monthFirst, monthLast);
      warnings.push({ code: "URGENT_WINDOW_OUTSIDE_MONTH", message: `Urgent window ${row.from}..${row.to} is outside ${monthFirst}; spread over the month.`, sku_material_id: entry.sku_material_id });
    }
  }
  for (const row of entry.urgent_extra) {
    if (!spreadOver(daily, row.qty, row.from, row.to, monthFirst, monthLast)) {
      spreadOver(daily, row.qty, monthFirst, monthLast, monthFirst, monthLast);
      warnings.push({ code: "URGENT_WINDOW_OUTSIDE_MONTH", message: `Urgent window ${row.from}..${row.to} is outside ${monthFirst}; spread over the month.`, sku_material_id: entry.sku_material_id });
    }
  }
  return daily;
}

/**
 * Splits skuDailyDemand() by effective plan line, day by day, using exactly the
 * same phasing.  Σ adds_qty contributions per day = skuDailyDemand() for that
 * day.  Never changes a quantity; attribution only.
 */
export function skuDailyContributions(entry: EffectiveSkuMonth): Map<string, PlanLineContribution[]> {
  const monthFirst = entry.plan_month;
  const monthLast = monthEnd(monthFirst);
  const result = new Map<string, PlanLineContribution[]>();
  if (entry.effective_qty === null) return result;
  const refs = entry.contributors ?? [];
  const spreadWindow = (daily: Map<string, number>, qty: number, from: string | null, to: string | null) => {
    if (!from || !to || !spreadOver(daily, qty, from, to, monthFirst, monthLast)) spreadOver(daily, qty, monthFirst, monthLast, monthFirst, monthLast);
  };
  const push = (day: string, ref: PlanLineRef, adds: boolean, qty: number) => {
    if (qty <= EPSILON) return;
    const list = result.get(day) ?? [];
    list.push({
      source_id: ref.source_id, entry_id: ref.entry_id, version_no: ref.version_no, plan_type: ref.plan_type,
      urgent_mode: ref.urgent_mode, role: ref.role, sku_material_id: entry.sku_material_id, adds_qty: adds, qty,
    });
    result.set(day, list);
  };
  const pool = (entry.base_qty ?? 0) + entry.additional_qty;
  const fromPlanTotal = entry.urgent_from_plan.reduce((total, row) => total + row.qty, 0);
  const movable = Math.min(fromPlanTotal, pool);
  let scale = fromPlanTotal > EPSILON ? movable / fromPlanTotal : 0;
  if (!Number.isFinite(scale)) scale = 0;

  const poolDaily = new Map<string, number>();
  spreadOver(poolDaily, pool - movable, monthFirst, monthLast, monthFirst, monthLast);
  const rephased: Array<[PlanLineRef, Map<string, number>]> = [];
  for (const ref of refs.filter((row) => row.role === "URGENT_FROM_PLAN")) {
    const daily = new Map<string, number>();
    spreadWindow(daily, ref.qty * scale, ref.from, ref.to);
    for (const [day, qty] of daily) poolDaily.set(day, (poolDaily.get(day) ?? 0) + qty);
    rephased.push([ref, daily]);
  }
  const poolRefs = refs.filter((row) => row.role === "BASE" || row.role === "ADDITIONAL");
  const poolRefTotal = poolRefs.reduce((total, row) => total + row.qty, 0);
  for (const day of [...poolDaily.keys()].sort()) {
    const qty = poolDaily.get(day) ?? 0;
    if (poolRefTotal > EPSILON) for (const ref of poolRefs) push(day, ref, true, qty * (ref.qty / poolRefTotal));
    for (const [ref, daily] of rephased) push(day, ref, false, daily.get(day) ?? 0);
  }
  for (const ref of refs.filter((row) => row.role === "URGENT_EXTRA")) {
    const daily = new Map<string, number>();
    spreadWindow(daily, ref.qty, ref.from, ref.to);
    for (const [day, qty] of daily) push(day, ref, true, qty);
  }
  return result;
}

function scaleContributions(list: readonly PlanLineContribution[], factor: number): PlanLineContribution[] {
  return list.map((row) => ({ ...row, qty: row.qty * factor }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Explosion: Prodshade → RM (Stroke) and SKU → PM (Pack BOM)
// ─────────────────────────────────────────────────────────────────────────────
export type SkuInfo = {
  sku_material_id: string;
  prodshade_material_id: string;
  base_uom_code: string;
  /** KG per one SKU base unit (1 for KG; master conversion for L etc.; null = unknown). */
  kg_per_base_unit: number | null;
};

export type StrokeLine = {
  stroke_line_id: string;
  material_id: string;
  dosage_pct: number | null;
  material_group_id: string | null;
  storage_location_id: string | null;
  display_order: number;
};
export type StrokeInfo = { stroke_master_id: string; stroke_number: string; prodshade_material_id: string; lines: StrokeLine[] };
export type StrokePeriod = { stroke_master_id: string; period_from: string; period_to: string; planned_base_qty: number | null };
/** Key `${month}|${prodshade}` → periods saved on PO21 Tab 2 (absent = default current stroke). */
export type StrokeSettingMap = Map<string, StrokePeriod[]>;
export type PrimaryDecision = { stroke_master_id: string; material_group_id: string; effective_month: string; use_primary: boolean };
export type GroupMember = {
  material_id: string;
  active: boolean;
  /** The actual material-group row identity supplied by the loader. */
  group_id?: string;
  /** Immutable membership-row identity when supplied by the read-only loader. */
  source_id?: string;
};

export type PackBomLine = {
  /** Immutable Pack BOM INPUT-line identity when supplied by the read-only loader. */
  pack_bom_line_id?: string;
  material_id: string;
  qty: number;
  uom_code: string;
  storage_location_id: string | null;
  material_group_id: string | null;
};
export type PackBomInfo = {
  pack_bom_id: string;
  sfg_qty: number | null;    // KG of Prodshade per OUTPUT qty
  output_qty: number | null; // outer units the BOM is written for (1 for MTS)
  /** User-facing outer-pack unit from the Pack BOM OUTPUT line (for example BAG or DRUM). */
  output_uom_code: string | null;
  inputs: PackBomLine[];
};

export type MaterialInfo = {
  material_id: string;
  material_type: string;
  base_uom_code: string;
  status: string | null;
  /** fixed conversions FROM uom TO base uom: uom → factor (1 uom = factor base). */
  to_base_factors: Record<string, number>;
};

/** One unit of demand, before allocation to an individual material. */
export type DemandRecord = {
  day: string;
  kind: "RM" | "PM";
  pool_key: string;               // one demand pool = one stroke line or one Pack BOM line
  candidates: string[];           // eligible materials; candidates[0] = procurement target
  storage_location_id: string | null;
  qty: number;                    // in the base unit of every candidate
  prodshade_material_id: string;
  sku_material_id: string | null;
  stroke_master_id: string | null;
  stroke_line_id: string | null;
  pack_bom_id: string | null;
  /** PM source only: the immutable Pack BOM INPUT line. */
  pack_bom_line_id: string | null;
  /** PM source only: physical outer packs represented by this daily demand record. */
  outer_qty: number | null;
  /** PM source only: the Pack BOM OUTPUT unit. Never inferred from a material UoM. */
  outer_uom_code: string | null;
  /** PM source only: KG of product in one outer unit, derived from the active Pack BOM. */
  fill_qty_per_outer: number | null;
  group_id: string | null;
  use_primary: boolean | null;
  sort_key: string;
  /**
   * Effective PO21 plan-line versions behind this record, in this record's
   * unit (RM/PM base).  Σ adds_qty qty = qty.  In a month with a Tab 2 period
   * quantity override, RM shares follow each line's share of the month.
   */
  plan_line_contributions: PlanLineContribution[];
};

export type ExplosionInput = {
  calendar: PlanningCalendar;
  effective: EffectiveSkuMonth[];
  skus: Map<string, SkuInfo>;
  currentStrokeByProdshade: Map<string, string | null>;
  strokes: Map<string, StrokeInfo>;
  strokeSettings: StrokeSettingMap;
  primaryDecisions: PrimaryDecision[];
  groupMembers: Map<string, GroupMember[]>;
  packBoms: Map<string, PackBomInfo>;
  materials: Map<string, MaterialInfo>;
  prodshadeLabels: Map<string, string>;
  /** Material ids mapped to the company (sorted); absent = no mapping filter (legacy / tests). */
  mappedMaterialIds?: string[];
};

export type ExplosionResult = {
  records: DemandRecord[];
  warnings: Warning[];
  exceptions: Warning[];
  prodshadeDaily: Map<string, Map<string, number>>; // prodshade → day → KG
  skuDailyKg: Map<string, Map<string, number>>;     // sku → day → KG
  /** prodshade → day → plan-line contributions in KG (Σ adds_qty = prodshadeDaily). */
  prodshadeDailyContributions: Map<string, Map<string, PlanLineContribution[]>>;
};

/** Use Primary for a Stroke × RM group in a month: latest decision on or before the month; none = Yes. */
export function resolveUsePrimary(decisions: PrimaryDecision[], strokeId: string, groupId: string, month: string): boolean {
  let best: PrimaryDecision | null = null;
  for (const decision of decisions) {
    if (decision.stroke_master_id !== strokeId || decision.material_group_id !== groupId) continue;
    if (decision.effective_month > month) continue;
    if (!best || decision.effective_month > best.effective_month) best = decision;
  }
  return best ? best.use_primary : true;
}

/** Converts qty in `uom` to the material's base unit using fixed master conversions; null = unknown. */
export function toMaterialBase(material: MaterialInfo | undefined, qty: number, uom: string): number | null {
  if (!material) return null;
  const unit = String(uom ?? "").toUpperCase();
  if (!unit || unit === String(material.base_uom_code).toUpperCase()) return qty;
  const factor = material.to_base_factors[unit];
  return factor && factor > 0 ? qty * factor : null;
}

/** Order UoM (owner 2026-10-22): unit a buy quantity is shown in, beside the base unit. */
export type OrderUnit = { order_uom_code: string; base_per_order_unit: number; order_uom_source: "VENDOR" | "POLICY" };

/**
 * The vendor's MM03 Supply UoM wins, else the Material Settings Order UoM. Only a unit with a
 * fixed master conversion (or MT for KG) counts; the base unit itself or an unknown unit → null.
 */
export function orderUnitOf(material: MaterialInfo | undefined, vendorSupplyUom: string | null | undefined, policyOrderUom: string | null | undefined): OrderUnit | null {
  if (!material) return null;
  const base = String(material.base_uom_code ?? "").toUpperCase();
  const tries: Array<[string | null | undefined, OrderUnit["order_uom_source"]]> = [[vendorSupplyUom, "VENDOR"], [policyOrderUom, "POLICY"]];
  for (const [raw, source] of tries) {
    const unit = String(raw ?? "").trim().toUpperCase();
    if (!unit || unit === base) continue;
    const factor = material.to_base_factors[unit];
    if (factor && factor > 0) return { order_uom_code: unit, base_per_order_unit: factor, order_uom_source: source };
  }
  return null;
}

function activeMembers(input: ExplosionInput, groupId: string | null): string[] {
  if (!groupId) return [];
  // Defensive until the database uniqueness migration reaches every environment:
  // a duplicate membership must never duplicate a group's demand/candidate.
  return [...new Set((input.groupMembers.get(groupId) ?? [])
    .filter((member) => member.active && input.materials.get(member.material_id)?.status !== "INACTIVE")
    .map((member) => member.material_id))]
    .sort();
}

/**
 * Prodshade day demand with Tab 2 period overrides applied. A period's
 * planned_base_qty replaces the calendar pro-rata for its own days; the rest of
 * the month keeps the remaining quantity in its own day-wise proportion.
 */
function applyPeriodOverrides(daily: Map<string, number>, month: string, periods: StrokePeriod[], prodshadeId: string, warnings: Warning[]) {
  const overrides = periods.filter((period) => period.planned_base_qty !== null && period.planned_base_qty !== undefined);
  if (overrides.length === 0) return;
  const monthLast = monthEnd(month);
  const total = [...daily.values()].reduce((sum, qty) => sum + qty, 0);
  const overrideDays = new Set<string>();
  const next = new Map<string, number>();
  let overrideTotal = 0;
  for (const period of overrides) {
    const start = maxDate(period.period_from, month);
    const end = minDate(period.period_to, monthLast);
    const days = daysInclusive(start, end);
    if (days === 0) continue;
    const perDay = Number(period.planned_base_qty) / days;
    overrideTotal += Number(period.planned_base_qty);
    for (let day = start; day <= end; day = addDays(day, 1)) {
      overrideDays.add(day);
      next.set(day, perDay);
    }
  }
  const remaining = total - overrideTotal;
  if (remaining < -EPSILON) {
    warnings.push({
      code: "STROKE_PERIOD_QTY_EXCEEDS_PLAN",
      message: `Stroke period quantities ${roundQty(overrideTotal)} exceed the month plan ${roundQty(total)} for ${month}; the period quantities are used and the other days get 0.`,
      prodshade_material_id: prodshadeId,
    });
  }
  const restDays = [...daily.keys()].filter((day) => !overrideDays.has(day));
  const restOriginal = restDays.reduce((sum, day) => sum + (daily.get(day) ?? 0), 0);
  const allMonthDays: string[] = [];
  for (let day = month; day <= monthLast; day = addDays(day, 1)) allMonthDays.push(day);
  const freeDays = allMonthDays.filter((day) => !overrideDays.has(day));
  for (const day of freeDays) {
    let qty = 0;
    if (remaining > EPSILON) {
      qty = restOriginal > EPSILON ? ((daily.get(day) ?? 0) / restOriginal) * remaining : remaining / freeDays.length;
    }
    next.set(day, qty);
  }
  daily.clear();
  for (const [day, qty] of next) if (qty > EPSILON) daily.set(day, qty);
}

export function explodeDemand(input: ExplosionInput): ExplosionResult {
  const warnings: Warning[] = [];
  const exceptions: Warning[] = [];
  const records: DemandRecord[] = [];
  const skuDailyKg = new Map<string, Map<string, number>>();
  const prodshadeDaily = new Map<string, Map<string, number>>();
  const skuContribKg = new Map<string, Map<string, PlanLineContribution[]>>();
  const prodshadeContrib = new Map<string, Map<string, PlanLineContribution[]>>();
  const months = input.calendar.months ?? [input.calendar.cmStart, input.calendar.nmStart];
  const exceptionKeys = new Set<string>();
  const addException = (key: string, warning: Warning) => {
    if (exceptionKeys.has(key)) return;
    exceptionKeys.add(key);
    exceptions.push(warning);
  };
  // Owner 2026-10-20: a material not mapped to the company is never a candidate there.
  const mapped = input.mappedMaterialIds ? new Set(input.mappedMaterialIds) : null;
  const keepMapped = (candidates: string[], materialId: string, keyPart: string, scope: Warning): string[] => {
    if (!mapped) return candidates;
    const kept = candidates.filter((id) => mapped.has(id));
    if (kept.length === 0) {
      addException(`NOT_MAPPED|${keyPart}`, {
        ...scope,
        code: "MATERIAL_NOT_MAPPED_TO_COMPANY",
        message: "This material is not mapped to the company and its group has no mapped member; its demand is not shown. Map it to the company or correct the Stroke / Pack BOM.",
        material_id: materialId,
      });
    }
    return kept;
  };

  // SKU day demand in KG.
  for (const entry of input.effective) {
    if (!months.includes(entry.plan_month)) continue;
    const sku = input.skus.get(entry.sku_material_id);
    if (!sku) {
      if ((entry.effective_qty ?? 0) > EPSILON) {
        addException(`SKU_UNRESOLVED|${entry.sku_material_id}`, {
          code: "SKU_NOT_CURRENT_MTS_SKU",
          message: "A planned SKU no longer resolves to a company MTS Prodshade; its demand is not exploded.",
          sku_material_id: entry.sku_material_id,
        });
      }
      continue;
    }
    if (sku.kg_per_base_unit === null || !(sku.kg_per_base_unit > 0)) {
      if ((entry.effective_qty ?? 0) > EPSILON) {
        addException(`SKU_UOM|${sku.sku_material_id}`, {
          code: "SKU_KG_CONVERSION_MISSING",
          message: `SKU base unit ${sku.base_uom_code} has no verified conversion to KG; its RM/PM demand is not exploded.`,
          sku_material_id: sku.sku_material_id,
        });
      }
      continue;
    }
    const daily = skuDailyDemand(entry, warnings);
    const kgDaily = skuDailyKg.get(sku.sku_material_id) ?? new Map<string, number>();
    for (const [day, qty] of daily) kgDaily.set(day, (kgDaily.get(day) ?? 0) + qty * sku.kg_per_base_unit);
    skuDailyKg.set(sku.sku_material_id, kgDaily);
    const contribDaily = skuContribKg.get(sku.sku_material_id) ?? new Map<string, PlanLineContribution[]>();
    for (const [day, list] of skuDailyContributions(entry)) {
      contribDaily.set(day, [...(contribDaily.get(day) ?? []), ...scaleContributions(list, sku.kg_per_base_unit)]);
    }
    skuContribKg.set(sku.sku_material_id, contribDaily);
  }

  // Prodshade day demand = Σ its SKUs, then Tab 2 period overrides per month.
  for (const [skuId, daily] of skuDailyKg) {
    const prodshadeId = input.skus.get(skuId)!.prodshade_material_id;
    const target = prodshadeDaily.get(prodshadeId) ?? new Map<string, number>();
    for (const [day, qty] of daily) target.set(day, (target.get(day) ?? 0) + qty);
    prodshadeDaily.set(prodshadeId, target);
    const contribTarget = prodshadeContrib.get(prodshadeId) ?? new Map<string, PlanLineContribution[]>();
    for (const [day, list] of skuContribKg.get(skuId) ?? []) contribTarget.set(day, [...(contribTarget.get(day) ?? []), ...list]);
    prodshadeContrib.set(prodshadeId, contribTarget);
  }
  for (const [prodshadeId, daily] of prodshadeDaily) {
    const contribDaily = prodshadeContrib.get(prodshadeId) ?? new Map<string, PlanLineContribution[]>();
    for (const month of months) {
      const periods = input.strokeSettings.get(`${month}|${prodshadeId}`) ?? [];
      const monthLast = monthEnd(month);
      const monthDaily = new Map([...daily].filter(([day]) => day >= month && day <= monthLast));
      applyPeriodOverrides(monthDaily, month, periods, prodshadeId, warnings);
      for (const day of [...daily.keys()]) if (day >= month && day <= monthLast) daily.delete(day);
      for (const [day, qty] of monthDaily) daily.set(day, qty);
      const overridden = periods.some((period) => period.planned_base_qty !== null && period.planned_base_qty !== undefined);
      if (!overridden) continue;
      // A Tab 2 period quantity re-phases the whole month: each plan line keeps
      // its share of the month's planned quantity on every day.
      const monthShares = new Map<string, PlanLineContribution>();
      let monthTotal = 0;
      for (const [day, list] of contribDaily) {
        if (day < month || day > monthLast) continue;
        for (const row of list) {
          if (!row.adds_qty) continue;
          const key = `${row.sku_material_id}|${row.entry_id}|${row.version_no}`;
          const seen = monthShares.get(key);
          monthShares.set(key, seen ? { ...seen, qty: seen.qty + row.qty } : { ...row });
          monthTotal += row.qty;
        }
        contribDaily.delete(day);
      }
      if (monthTotal <= EPSILON) continue;
      const shares = [...monthShares.values()];
      for (const [day, qty] of monthDaily) contribDaily.set(day, scaleContributions(shares, qty / monthTotal));
    }
    prodshadeContrib.set(prodshadeId, contribDaily);
  }

  // RM: each day uses the stroke of the Tab 2 period covering it, else the current stroke.
  const prodshadeIds = [...prodshadeDaily.keys()].sort((a, b) =>
    (input.prodshadeLabels.get(a) ?? a).localeCompare(input.prodshadeLabels.get(b) ?? b) || a.localeCompare(b));
  for (const prodshadeId of prodshadeIds) {
    const daily = prodshadeDaily.get(prodshadeId)!;
    const label = input.prodshadeLabels.get(prodshadeId) ?? prodshadeId;
    for (const day of [...daily.keys()].sort()) {
      const qty = daily.get(day) ?? 0;
      if (qty <= EPSILON) continue;
      const month = monthStart(day);
      const periods = input.strokeSettings.get(`${month}|${prodshadeId}`) ?? [];
      const period = periods.find((p) => day >= p.period_from && day <= p.period_to);
      const strokeId = period?.stroke_master_id ?? input.currentStrokeByProdshade.get(prodshadeId) ?? null;
      if (periods.length > 0 && !period) {
        const key = `PERIOD_GAP|${prodshadeId}|${month}`;
        if (!exceptionKeys.has(key)) {
          exceptionKeys.add(key);
          warnings.push({ code: "STROKE_PERIOD_GAP", message: `${label}: some days of ${month} are outside every saved stroke period; the current stroke is used for them.`, prodshade_material_id: prodshadeId });
        }
      }
      const stroke = strokeId ? input.strokes.get(strokeId) : undefined;
      if (!stroke) {
        addException(`NO_STROKE|${prodshadeId}`, {
          code: "MISSING_STROKE",
          message: `${label} has planned demand but no current / period MTS stroke; its RM demand is not exploded.`,
          prodshade_material_id: prodshadeId,
        });
        continue;
      }
      for (const line of stroke.lines) {
        if (line.dosage_pct === null || line.dosage_pct === undefined) {
          addException(`NO_DOSAGE|${line.stroke_line_id}`, {
            code: "STROKE_LINE_DOSAGE_MISSING",
            message: `${label} stroke ${stroke.stroke_number}: a line has no dosage; it is skipped.`,
            prodshade_material_id: prodshadeId,
            material_id: line.material_id,
          });
          continue;
        }
        if (!line.storage_location_id) {
          addException(`NO_SLOC|${line.stroke_line_id}`, {
            code: "STROKE_LINE_LOCATION_MISSING",
            message: `${label} stroke ${stroke.stroke_number}: a line has no storage location in Stroke Master; its stock is not matched to a location.`,
            prodshade_material_id: prodshadeId,
            material_id: line.material_id,
          });
        }
        const members = activeMembers(input, line.material_group_id).filter((id) => id !== line.material_id);
        let usePrimary: boolean | null = null;
        let candidates = [line.material_id];
        if (line.material_group_id && members.length > 0) {
          usePrimary = resolveUsePrimary(input.primaryDecisions, stroke.stroke_master_id, line.material_group_id, month);
          candidates = usePrimary ? [line.material_id, ...members] : [...members];
        }
        candidates = keepMapped(candidates, line.material_id, line.stroke_line_id, { prodshade_material_id: prodshadeId, code: "", message: "" });
        if (candidates.length === 0) continue;
        const rmQty = (Number(line.dosage_pct) / 100) * qty;
        if (rmQty <= EPSILON) continue;
        const dayContrib = prodshadeContrib.get(prodshadeId)?.get(day) ?? [];
        records.push({
          day,
          kind: "RM",
          pool_key: `RM|${line.stroke_line_id}`,
          candidates,
          storage_location_id: line.storage_location_id,
          qty: rmQty,
          prodshade_material_id: prodshadeId,
          sku_material_id: null,
          stroke_master_id: stroke.stroke_master_id,
          stroke_line_id: line.stroke_line_id,
          pack_bom_id: null,
          pack_bom_line_id: null,
          outer_qty: null,
          outer_uom_code: null,
          fill_qty_per_outer: null,
          group_id: line.material_group_id,
          use_primary: usePrimary,
          sort_key: `1|${label}|${String(line.display_order).padStart(6, "0")}|${line.stroke_line_id}`,
          plan_line_contributions: scaleContributions(dayContrib, Number(line.dosage_pct) / 100),
        });
      }
    }
  }

  // PM: SKU day KG → outer units via the company Pack BOM (SFG KG per outer) → PM lines.
  const skuIds = [...skuDailyKg.keys()].sort();
  for (const skuId of skuIds) {
    const daily = skuDailyKg.get(skuId)!;
    const total = [...daily.values()].reduce((sum, qty) => sum + qty, 0);
    if (total <= EPSILON) continue;
    const sku = input.skus.get(skuId)!;
    const bom = input.packBoms.get(skuId);
    if (!bom) {
      addException(`NO_BOM|${skuId}`, {
        code: "MISSING_PACK_BOM",
        message: "This SKU has planned demand in this company but no ACTIVE company Pack BOM; its PM demand is not exploded.",
        sku_material_id: skuId,
      });
      continue;
    }
    const outputQty = bom.output_qty && bom.output_qty > 0 ? bom.output_qty : 1;
    if (!bom.sfg_qty || !(bom.sfg_qty > 0)) {
      addException(`BOM_SFG|${skuId}`, {
        code: "PACK_BOM_SFG_QTY_MISSING",
        message: "The Pack BOM has no SFG quantity per outer unit; PM demand cannot be derived.",
        sku_material_id: skuId,
      });
      continue;
    }
    const kgPerOuter = bom.sfg_qty / outputQty;
    for (const line of bom.inputs) {
      const material = input.materials.get(line.material_id);
      const perOuterBase = toMaterialBase(material, Number(line.qty) / outputQty, line.uom_code);
      if (perOuterBase === null) {
        addException(`BOM_UOM|${bom.pack_bom_id}|${line.material_id}`, {
          code: "PM_UOM_CONVERSION_MISSING",
          message: `Pack BOM unit ${line.uom_code} has no verified conversion to the PM base unit; this PM line is skipped.`,
          sku_material_id: skuId,
          material_id: line.material_id,
        });
        continue;
      }
      const members = activeMembers(input, line.material_group_id).filter((id) => id !== line.material_id);
      const pmCandidates = keepMapped([line.material_id, ...members], line.material_id, `${bom.pack_bom_id}|${line.material_id}`, { sku_material_id: skuId, code: "", message: "" });
      if (pmCandidates.length === 0) continue;
      for (const day of [...daily.keys()].sort()) {
        const kg = daily.get(day) ?? 0;
        const qty = (kg / kgPerOuter) * perOuterBase;
        if (qty <= EPSILON) continue;
        records.push({
          day,
          kind: "PM",
          pool_key: `PM|${bom.pack_bom_id}|${line.material_id}`,
          candidates: pmCandidates,
          storage_location_id: line.storage_location_id,
          qty,
          prodshade_material_id: sku.prodshade_material_id,
          sku_material_id: skuId,
          stroke_master_id: null,
          stroke_line_id: null,
          pack_bom_id: bom.pack_bom_id,
          pack_bom_line_id: line.pack_bom_line_id ?? null,
          // Presentation-only provenance.  Requirement math remains in the PM
          // material's base unit; this makes the individual Pack BOM's physical
          // outer-pack count visible without flattening mixed pack sizes.
          outer_qty: kg / kgPerOuter,
          outer_uom_code: bom.output_uom_code,
          fill_qty_per_outer: kgPerOuter,
          group_id: line.material_group_id,
          use_primary: null,
          sort_key: `2|${skuId}|${line.material_id}`,
          plan_line_contributions: scaleContributions(skuContribKg.get(skuId)?.get(day) ?? [], perOuterBase / kgPerOuter),
        });
      }
    }
  }

  records.sort((a, b) => a.day.localeCompare(b.day) || a.sort_key.localeCompare(b.sort_key));
  return { records, warnings, exceptions, prodshadeDaily, skuDailyKg, prodshadeDailyContributions: prodshadeContrib };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Allocation of demand pools to individual materials (stock counted once)
// ─────────────────────────────────────────────────────────────────────────────
export type StockRow = { material_id: string; storage_location_id: string; stock_type_code: string; qty: number };
export type ReservationRow = { material_id: string; storage_location_id: string; qty: number };

/**
 * R→R advisory route (source contract §5, owner D1/D12): a transfer is only ever suggested between
 * raw-material stores (R-series codes). Every source must be an R store (otherwise the qty is not
 * a pure R stock and nothing is suggested); the destination is an R store among the counted /
 * required locations, or UNKNOWN — never S/P/F, never a fabricated location.
 */
/**
 * Owner 2026-10-20: a material that is not mapped to the company (no ACTIVE
 * erp_master.material_company_ext row) is never shown in that company's PO22.
 * Unmapped group members are dropped from the pool (the company cannot stock or
 * buy them); an unmapped material named directly on a stroke / Pack BOM keeps
 * its demand out of the universe and is reported, never silently counted.
 */
export function applyCompanyMaterialMapping(input: {
  directMaterialIds: readonly string[];
  members: readonly GroupMember[];
  mapped: ReadonlySet<string>;
}): { members: GroupMember[]; universe: string[]; unmappedDirect: string[]; unmappedMembers: string[] } {
  // Data integrity is enforced in the database too, but one repeated row must not make
  // planning count the same material twice while a historical environment is being repaired.
  const membersByMaterial = new Map<string, GroupMember>();
  for (const member of input.members) {
    if (!input.mapped.has(member.material_id)) continue;
    const prior = membersByMaterial.get(member.material_id);
    membersByMaterial.set(member.material_id, prior ? { ...prior, active: prior.active || member.active } : member);
  }
  const members = [...membersByMaterial.values()];
  const unmappedMembers = [...new Set(input.members.filter((m) => !input.mapped.has(m.material_id)).map((m) => m.material_id))].sort();
  const direct = [...new Set(input.directMaterialIds.filter(Boolean))];
  const unmappedDirect = direct.filter((id) => !input.mapped.has(id)).sort();
  const universe = [...new Set([
    ...direct.filter((id) => input.mapped.has(id)),
    ...members.filter((m) => m.active).map((m) => m.material_id),
  ])];
  return { members, universe, unmappedDirect, unmappedMembers };
}

export const isRawStoreCode = (code: string) => /^R\d/i.test(code.trim());
export function rToRTransferRoute(sourceCodes: readonly string[], destinationCodes: readonly string[]): { from: string; to: string } | null {
  const sources = [...new Set(sourceCodes.filter(Boolean))];
  if (sources.length === 0 || !sources.every(isRawStoreCode)) return null;
  const to = [...new Set(destinationCodes.filter((code) => isRawStoreCode(code) && !sources.includes(code)))];
  return { from: sources.join(", "), to: to.length > 0 ? to.join(" / ") : "an R store (destination UNKNOWN)" };
}

export type MaterialStockPosition = {
  /**
   * Usable stock = UNRESTRICTED − open reservations. With a company location policy
   * (owner D1/D12) this is pooled over every COUNTED location; without one it is the
   * stock at the stroke / Pack BOM line's required location (legacy behaviour).
   */
  usable_at_required: number;
  unrestricted_at_required: number;
  reserved_at_required: number;
  /** Shown, never counted: TRANSFER_SOURCE locations (e.g. R003; unconfigured locations too) → R→R transfer referral when an R store. */
  other_sloc_unrestricted: number;
  /** Not counted and not referred (e.g. OT01 / OT02 / admix shop floor). */
  excluded_unrestricted: number;
  quality_inspection: number;
  blocked: number;
  other_stock_types: number;       // IN_TRANSIT / FOR_REPROCESS / RESERVED stock types
  required_locations: string[];    // counted (pooled mode) or required locations
  other_locations: string[];       // transfer-source locations holding stock
  /**
   * Posted stock already promised to another company by an open Sub-CSN / its STO (owner
   * 2026-10-20, Distribution mode). Taken out of usable stock; it leaves on the STO.
   */
  committed_transfer_out: number;
  /** Method C: usable stock kept back for this material's own exclusive use after the horizon. */
  exclusive_protected: number;
  /** Method C fallback: protected stock a group still had to use (shortage would stop production). */
  protection_used: number;
};

/** Company planning role of a storage location (owner D1/D12). */
export type LocationRole = "COUNTED" | "TRANSFER_SOURCE" | "EXCLUDED";

export type GroupPoolDemand = {
  group_id: string;
  kind: "RM" | "PM";
  /** day → group demand (whole pool) and the part stock could not cover (never assigned to a member). */
  demandByDay: Map<string, number>;
  uncoveredByDay: Map<string, number>;
  /** member → qty drawn from that member's stock for this group. */
  drawnByMaterial: Map<string, number>;
  candidates: Set<string>;
  pool_keys: Set<string>;
};

export type AllocationResult = {
  /** material → day → demand attributed to that material (full horizon). */
  dailyByMaterial: Map<string, Map<string, number>>;
  /** material → day → part of that demand covered from usable stock. */
  fromStockByMaterial: Map<string, Map<string, number>>;
  /** material → horizon qty of its own fixed demand / of group demand drawn from its stock. */
  fixedByMaterial: Map<string, number>;
  groupShareByMaterial: Map<string, number>;
  /** Material-null group pools (RM Use Primary = No, PM groups): uncovered demand stays with the group. */
  groups: Map<string, GroupPoolDemand>;
  /** pool traceability: pool → { candidates, demand, per material }. */
  pools: Map<string, PoolAllocation>;
  stock: Map<string, MaterialStockPosition>;
};

export type StorePeriod = "CM" | "NM";
export type PoolAllocation = {
  kind: "RM" | "PM"; candidates: string[]; group_id: string | null; use_primary: boolean | null; storage_location_id: string | null;
  total: number; byMaterial: Map<string, number>; prodshades: Set<string>; skus: Set<string>; strokes: Set<string>; pack_boms: Set<string>;
  outer_qty: number; outer_uom_code: string | null; fill_qty_per_outer: number | null;
  /** Store report (Phase 2D §6): demand from as-of per period, and what current stock backs, per material. */
  periodDemand: Record<StorePeriod, number>;
  periodFromStock: Map<string, Record<StorePeriod, number>>;
};

function bump(map: Map<string, Map<string, number>>, material: string, day: string, qty: number) {
  const inner = map.get(material) ?? new Map<string, number>();
  inner.set(day, (inner.get(day) ?? 0) + qty);
  map.set(material, inner);
}

/** A group pool whose shortage belongs to the group, not to a member (Phase 2D §3, owner D3). */
export function isGroupOwnedPool(record: Pick<DemandRecord, "group_id" | "kind" | "use_primary">): boolean {
  return !!record.group_id && (record.kind === "PM" || record.use_primary === false);
}

export type AllocationOptions = {
  /** Company location policy; when present stock is pooled over COUNTED locations (owner D12). */
  locationRoles?: Map<string, LocationRole>;
  /** material → base qty of posted stock promised to another company (open Sub-CSN / STO). */
  committedTransferOut?: Map<string, number>;
  /** material → Critical / Target days that protect its own exclusive use from group draws (Method C). */
  protectionDays?: Map<string, { critical_days: number | null; target_days: number | null }>;
  /** PO22 Group Settings (owner 2026-10-22): group → which member first. Absent = Method C. */
  groupOrders?: ReadonlyMap<string, GroupUsageOrder>;
};

/**
 * Same "count once" rule production uses (computeMtsAutoDeriveRowsForGroup,
 * process_order.handlers.ts), with the owner's D3 order:
 *   pass 1 — FIXED lines (one material only) draw from their own material's stock, by date;
 *   pass 2 — GROUP lines draw from what is left, by date (owner Method C, 2026-10-20):
 *            each member first keeps Critical, then Target days of its own exclusive use after
 *            the horizon (protected); a group uses only the free stock above that, the member
 *            with the most free stock first (the primary only breaks a tie). Only if the
 *            group would still be short does it use protected stock (Target part, then Critical
 *            part), recorded as protection_used so the member's own buy is triggered.
 * Uncovered fixed / Use-Primary-Yes demand is attributed to candidates[0]; uncovered
 * material-null group demand (Use Primary = No, PM groups) stays with the group.
 * Days before the as-of date are already consumed and attributed to the target.
 */
export function allocateDemand(
  records: DemandRecord[],
  calendar: PlanningCalendar,
  stockRows: StockRow[],
  reservations: ReservationRow[],
  applyReservations: boolean,
  options: AllocationOptions = {},
): AllocationResult {
  const roles = options.locationRoles;
  const pooled = !!roles;
  const roleOf = (location: string): LocationRole => roles?.get(location) ?? "TRANSFER_SOURCE";
  const usable = new Map<string, number>(); // pooled: material → usable; legacy: material|sloc → usable
  const requiredLocations = new Map<string, Set<string>>();
  for (const record of records) {
    if (!record.storage_location_id) continue;
    for (const candidate of record.candidates) {
      const set = requiredLocations.get(candidate) ?? new Set<string>();
      set.add(record.storage_location_id);
      requiredLocations.set(candidate, set);
    }
  }
  const reservedByKey = new Map<string, number>();
  if (applyReservations) {
    for (const row of reservations) {
      const key = `${row.material_id}|${row.storage_location_id}`;
      reservedByKey.set(key, (reservedByKey.get(key) ?? 0) + Number(row.qty));
    }
  }
  const stock = new Map<string, MaterialStockPosition>();
  const position = (material: string) => {
    let pos = stock.get(material);
    if (!pos) {
      pos = {
        usable_at_required: 0, unrestricted_at_required: 0, reserved_at_required: 0, other_sloc_unrestricted: 0,
        excluded_unrestricted: 0, quality_inspection: 0, blocked: 0, other_stock_types: 0,
        required_locations: pooled ? [] : [...(requiredLocations.get(material) ?? [])].sort(), other_locations: [],
        committed_transfer_out: 0, exclusive_protected: 0, protection_used: 0,
      };
      stock.set(material, pos);
    }
    return pos;
  };
  const otherLocations = new Map<string, Set<string>>();
  const countedLocations = new Map<string, Set<string>>();
  const unrestrictedByKey = new Map<string, number>();
  for (const row of stockRows) {
    const qty = Number(row.qty);
    if (Math.abs(qty) <= EPSILON) continue;
    const pos = position(row.material_id);
    if (row.stock_type_code === "UNRESTRICTED") {
      const counted = pooled
        ? roleOf(row.storage_location_id) === "COUNTED"
        : (requiredLocations.get(row.material_id) ?? new Set()).has(row.storage_location_id);
      if (counted) {
        pos.unrestricted_at_required += qty;
        const key = `${row.material_id}|${row.storage_location_id}`;
        unrestrictedByKey.set(key, (unrestrictedByKey.get(key) ?? 0) + qty);
        if (pooled) {
          const set = countedLocations.get(row.material_id) ?? new Set<string>();
          set.add(row.storage_location_id);
          countedLocations.set(row.material_id, set);
        }
      } else if (pooled && roleOf(row.storage_location_id) === "EXCLUDED") {
        pos.excluded_unrestricted += qty;
      } else {
        pos.other_sloc_unrestricted += qty;
        const set = otherLocations.get(row.material_id) ?? new Set<string>();
        set.add(row.storage_location_id);
        otherLocations.set(row.material_id, set);
      }
    } else if (row.stock_type_code === "QUALITY_INSPECTION") {
      pos.quality_inspection += qty;
    } else if (row.stock_type_code === "BLOCKED") {
      pos.blocked += qty;
    } else {
      pos.other_stock_types += qty;
    }
  }
  for (const [material, set] of otherLocations) position(material).other_locations = [...set].sort();
  if (pooled) {
    // Usable per material = Σ over counted locations of max(0, unrestricted − reserved there).
    const materials = new Set([...countedLocations.keys(), ...[...reservedByKey.keys()].map((key) => key.split("|")[0])]);
    for (const material of materials) {
      const pos = position(material);
      const locations = new Set([
        ...(countedLocations.get(material) ?? []),
        ...[...reservedByKey.keys()].filter((key) => key.startsWith(`${material}|`)).map((key) => key.split("|")[1]).filter((loc) => roleOf(loc) === "COUNTED"),
      ]);
      pos.required_locations = [...(countedLocations.get(material) ?? [])].sort();
      let total = 0;
      for (const location of locations) {
        const key = `${material}|${location}`;
        const reserved = reservedByKey.get(key) ?? 0;
        pos.reserved_at_required += reserved;
        total += Math.max(0, (unrestrictedByKey.get(key) ?? 0) - reserved);
      }
      usable.set(material, total);
      pos.usable_at_required = total;
    }
  } else {
    for (const [material, locations] of requiredLocations) {
      const pos = position(material);
      for (const location of locations) {
        const key = `${material}|${location}`;
        const reserved = reservedByKey.get(key) ?? 0;
        pos.reserved_at_required += reserved;
        const net = Math.max(0, (unrestrictedByKey.get(key) ?? 0) - reserved);
        usable.set(key, net);
        pos.usable_at_required += net;
      }
    }
  }

  // Owner 2026-10-20 (Distribution mode): stock promised to another company by an open Sub-CSN
  // leaves on its STO, so it is never usable here. Largest location first in legacy mode.
  for (const [material, qty] of options.committedTransferOut ?? new Map<string, number>()) {
    if (!(qty > EPSILON)) continue;
    const pos = position(material);
    pos.committed_transfer_out += qty;
    let left = qty;
    const keys = pooled
      ? [material]
      : [...usable.keys()].filter((key) => key.startsWith(`${material}|`))
        .sort((a, b) => (usable.get(b) ?? 0) - (usable.get(a) ?? 0) || a.localeCompare(b));
    for (const key of keys) {
      if (left <= EPSILON) break;
      const have = usable.get(key) ?? 0;
      const taken = Math.min(have, left);
      usable.set(key, have - taken);
      left -= taken;
    }
    pos.usable_at_required = Math.max(0, pos.usable_at_required - (qty - left));
  }

  const dailyByMaterial = new Map<string, Map<string, number>>();
  const fromStockByMaterial = new Map<string, Map<string, number>>();
  const fixedByMaterial = new Map<string, number>();
  const groupShareByMaterial = new Map<string, number>();
  const groups = new Map<string, GroupPoolDemand>();
  const pools: AllocationResult["pools"] = new Map();
  const addTo = (map: Map<string, number>, key: string, qty: number) => map.set(key, (map.get(key) ?? 0) + qty);

  const processRecord = (record: DemandRecord) => {
    const pool: PoolAllocation = pools.get(record.pool_key) ?? {
      kind: record.kind, candidates: record.candidates, group_id: record.group_id, use_primary: record.use_primary,
      storage_location_id: record.storage_location_id, total: 0, byMaterial: new Map<string, number>(),
      prodshades: new Set<string>(), skus: new Set<string>(), strokes: new Set<string>(), pack_boms: new Set<string>(),
      outer_qty: 0, outer_uom_code: record.outer_uom_code, fill_qty_per_outer: record.fill_qty_per_outer,
      periodDemand: { CM: 0, NM: 0 }, periodFromStock: new Map(),
    };
    const period: StorePeriod | null = record.day < calendar.asOf || record.day > calendar.nmEnd ? null : record.day <= calendar.cmEnd ? "CM" : "NM";
    if (period) pool.periodDemand[period] += record.qty;
    pool.total += record.qty;
    pool.outer_qty += record.outer_qty ?? 0;
    pool.prodshades.add(record.prodshade_material_id);
    if (record.sku_material_id) pool.skus.add(record.sku_material_id);
    if (record.stroke_master_id) pool.strokes.add(record.stroke_master_id);
    if (record.pack_bom_id) pool.pack_boms.add(record.pack_bom_id);
    pools.set(record.pool_key, pool);
    const groupOwned = isGroupOwnedPool(record);
    const isFixed = !record.group_id || record.candidates.length <= 1;
    let group: GroupPoolDemand | null = null;
    if (groupOwned) {
      group = groups.get(record.group_id!) ?? {
        group_id: record.group_id!, kind: record.kind, demandByDay: new Map(), uncoveredByDay: new Map(),
        drawnByMaterial: new Map(), candidates: new Set(), pool_keys: new Set(),
      };
      record.candidates.forEach((c) => group!.candidates.add(c));
      group.pool_keys.add(record.pool_key);
      addTo(group.demandByDay, record.day, record.qty);
      groups.set(record.group_id!, group);
    }
    const target = record.candidates[0];
    const attribute = (material: string, qty: number, fromStock: boolean) => {
      bump(dailyByMaterial, material, record.day, qty);
      if (fromStock) bump(fromStockByMaterial, material, record.day, qty);
      pool.byMaterial.set(material, (pool.byMaterial.get(material) ?? 0) + qty);
      if (isFixed) addTo(fixedByMaterial, material, qty);
      else if (fromStock) addTo(groupShareByMaterial, material, qty);
      if (fromStock && period) {
        const byPeriod = pool.periodFromStock.get(material) ?? { CM: 0, NM: 0 };
        byPeriod[period] += qty;
        pool.periodFromStock.set(material, byPeriod);
      }
      if (group && fromStock) addTo(group.drawnByMaterial, material, qty);
    };
    const uncovered = (qty: number) => {
      if (group) addTo(group.uncoveredByDay, record.day, qty);
      else attribute(target, qty, false);
    };
    if (record.day < calendar.asOf) {
      // Already consumed: not a stock decision. Group-owned demand stays group demand only.
      if (!group) attribute(target, record.qty, false);
      return;
    }
    if (!pooled && !record.storage_location_id) {
      uncovered(record.qty);
      return;
    }
    const keyOf = (material: string) => (pooled ? material : `${material}|${record.storage_location_id}`);
    let remaining = record.qty;
    const draw = (material: string, limit: number) => {
      const available = usable.get(keyOf(material)) ?? 0;
      const qty = Math.min(available, remaining, limit);
      if (qty <= EPSILON) return 0;
      usable.set(keyOf(material), available - qty);
      attribute(material, qty, true);
      remaining -= qty;
      return qty;
    };
    if (isFixed) {
      draw(target, Infinity);
      if (remaining > EPSILON) uncovered(remaining);
      return;
    }
    // Method C tiers: free stock above Target protection, then the Target part, then the Critical part.
    const floors = (material: string): [number, number, number] => {
      const p = protection.get(material);
      return [p?.target ?? 0, p?.critical ?? 0, 0];
    };
    const headroom = (material: string, tier: number) => Math.max(0, totalUsable(material) - floors(material)[tier]);
    // Method C rule 4: the member with the most free stock first; the primary (candidates[0])
    // goes first only on a tie.
    // Group Settings override rule 4 for this group (most / least stock first, or a fixed
    // member order); the protection tiers above still apply.
    const groupOrder = record.group_id ? options.groupOrders?.get(record.group_id) : undefined;
    for (let tier = 0; tier < 3 && remaining > EPSILON; tier += 1) {
      const ordered = groupOrder
        ? orderByGroupUsage(record.candidates, (material) => headroom(material, tier), groupOrder)
        : record.candidates
          .map((material, index) => ({ material, index, free: headroom(material, tier) }))
          .sort((a, b) => b.free - a.free || a.index - b.index)
          .map((entry) => entry.material);
      for (const material of ordered) {
        if (remaining <= EPSILON) break;
        const taken = draw(material, headroom(material, tier));
        if (tier > 0 && taken > EPSILON) position(material).protection_used += taken;
      }
    }
    if (remaining > EPSILON) uncovered(remaining);
  };

  // Usable left for a material across every key (pooled: one key; legacy: all its locations).
  const totalUsable = (material: string): number => {
    if (pooled) return usable.get(material) ?? 0;
    let total = 0;
    for (const [key, qty] of usable) if (key.startsWith(`${material}|`)) total += qty;
    return total;
  };
  const protection = new Map<string, { critical: number; target: number }>();

  // DEPENDENT ordering: pass 1 (fixed) then pass 2 (group, narrowest group first); inside each,
  // chronological — each record draws from the stock left by the records before it.
  const fixedRecords = records.filter((r) => !r.group_id || r.candidates.length <= 1);
  // Method C: a group with fewer usable members is served before a broader one (owner 2026-10-20,
  // e.g. RDP_TLA = VINNAPAS/VAE only, before RDP which also has RP-4099/ELOTEX); then by date.
  // Stable sort keeps the chronological order inside each width.
  const groupRecords = records.filter((r) => r.group_id && r.candidates.length > 1)
    .map((record, index) => ({ record, index }))
    .sort((a, b) => a.record.candidates.length - b.record.candidates.length || a.index - b.index)
    .map((entry) => entry.record);
  for (const record of fixedRecords) processRecord(record);
  // Method C protection: average daily exclusive (fixed) use over the horizon × Critical / Target
  // days, capped by what pass 1 left. It covers the days after the horizon.
  const horizonDays = daysInclusive(calendar.asOf, calendar.horizonEnd ?? calendar.nmEnd);
  for (const [material, days] of options.protectionDays ?? new Map()) {
    let fixedFromAsOf = 0;
    for (const [day, qty] of dailyByMaterial.get(material) ?? new Map<string, number>()) if (day >= calendar.asOf) fixedFromAsOf += qty;
    if (!(fixedFromAsOf > EPSILON) || !(horizonDays > 0)) continue;
    const rate = fixedFromAsOf / horizonDays;
    const left = totalUsable(material);
    const target = Math.min(left, rate * Math.max(0, Number(days.target_days ?? 0), Number(days.critical_days ?? 0)));
    const critical = Math.min(target, rate * Math.max(0, Number(days.critical_days ?? 0)));
    if (target <= EPSILON) continue;
    protection.set(material, { critical, target });
    position(material).exclusive_protected = target;
  }
  for (const record of groupRecords) processRecord(record);
  return { dailyByMaterial, fromStockByMaterial, fixedByMaterial, groupShareByMaterial, groups, pools, stock };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Inbound supply: one dated event per physical unit (owner Q-T06)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * SUB_CSN_PLANNED: this company's share of another company's PO, planned by a Sub-CSN (or its
 * not-yet-dispatched STO line) — Distribution mode, owner 2026-10-20. Not dispatched yet.
 */
export type InboundKind = "AT_GATE" | "IN_TRANSIT" | "SCHEDULED_LOT" | "PO_REMAINDER" | "STO_IN_TRANSIT" | "SUB_CSN_PLANNED";
export type InboundEvent = {
  material_id: string;
  qty: number;               // material base unit
  date: string | null;       // ETA to plant; null = UNKNOWN
  kind: InboundKind;
  date_source: string;       // e.g. CSN_ETA_TO_PLANT, LOT_DELIVERY_DATE, PO_EXPECTED_DELIVERY, GATE_ENTRY, NONE
  reference: string;         // human document reference (PO / CSN / GE / lot numbers)
  /** CSN behind this piece (ETD / port dates in the item plan). */
  csn_id?: string;
  /** Key of a not-yet-shipped piece the planner may reschedule (P1); absent = cannot be moved. */
  reschedule_key?: string;
  /** Source date before a planning reschedule replaced `date`. */
  original_date?: string | null;
};

/**
 * P1 (owner 2026-10-20): a planning-side rescheduled ETA replaces the date of a not-yet-shipped
 * piece. CSN Tracker itself is never changed; the source date is kept in original_date.
 */
export function applyInboundReschedules(events: InboundEvent[], reschedules: ReadonlyMap<string, string | null>): InboundEvent[] {
  return events.map((event) => {
    if (!event.reschedule_key || !reschedules.has(event.reschedule_key)) return event;
    const date = reschedules.get(event.reschedule_key) ?? null;
    if (!date) return event; // a cleared reschedule = back to the source date
    return { ...event, original_date: event.date, date, date_source: "PLANNING_RESCHEDULE" };
  });
}

export type PoLineInboundInput = {
  material_id: string;
  /** purchase_order_line id — reschedule key of the remainder / lots (P1). */
  po_line_id?: string;
  po_number: string;
  line_number: number;
  open_qty: number;              // PO unit (open = ordered − GRN posted)
  base_per_po_unit: number | null; // ordered_qty_base_uom / ordered_qty
  expected_delivery_date: string | null;
  /** PO delivery type. BULK POs never get a CSN in this ERP (owner 2026-10-20). */
  delivery_type?: string | null;
  at_gate: Array<{ qty_base: number; reference: string; date: string | null }>; // GE lines not yet GRN-posted
  csns: Array<{ id?: string; csn_number: string; status: string; dispatch_qty: number | null; received_qty: number | null; eta: string | null; is_mother_with_children: boolean }>;
  lots: Array<{ lot_number: string; balance_qty: number; delivery_date: string | null }>; // PO unit
  /**
   * Base qty of this still-open line already promised to another company by Sub-CSNs
   * (owner 2026-10-20). Removed first; it is counted at the consignee instead.
   */
  committed_transfer_base?: number;
};

const CSN_CLOSED = new Set(["GRD", "GED", "KOF", "CAN"]);

/**
 * Partitions one open PO line's remaining quantity into mutually exclusive
 * dated pieces, in this order, each capped by what is still unallocated:
 *   1. arrived at gate, GRN not yet posted (dated the as-of day)
 *   2. dispatched CSNs (TRN / ORD with a dispatch qty) at their ETA to plant
 *   3. PO lot balances at their delivery date
 *   4. BULK PO: remainder available from the as-of day (call-off, no CSN — owner 2026-10-20)
 *   4. remainder at the earliest ETA of a not-yet-dispatched CSN, else the PO
 *      expected delivery date, else UNKNOWN.
 * The PO line is the ceiling; CSN po_qty is never summed; a mother CSN that
 * has sub-CSNs is skipped (its children carry the quantity). Quantity promised
 * to another company by a Sub-CSN (committed_transfer_base) is removed first.
 */
export function partitionPoLineInbound(line: PoLineInboundInput, asOf: string, warnings: Warning[]): InboundEvent[] {
  const events: InboundEvent[] = [];
  const ref = `PO ${line.po_number}/${line.line_number}`;
  if (line.base_per_po_unit === null || !(line.base_per_po_unit > 0)) {
    warnings.push({ code: "PO_UOM_RATIO_MISSING", message: `${ref}: ordered quantity has no base-unit ratio; inbound not counted.`, material_id: line.material_id });
    return events;
  }
  let remaining = Math.max(0, Number(line.open_qty)) * line.base_per_po_unit;
  const take = (qty: number) => {
    const piece = Math.min(Math.max(0, qty), remaining);
    remaining -= piece;
    return piece;
  };
  take(Number(line.committed_transfer_base ?? 0));
  for (const gate of line.at_gate) {
    const qty = take(gate.qty_base);
    if (qty > EPSILON) events.push({ material_id: line.material_id, qty, date: asOf, kind: "AT_GATE", date_source: "GATE_ENTRY_AWAITING_GRN", reference: `${ref} · ${gate.reference}` });
  }
  const dispatched = line.csns
    .filter((csn) => !CSN_CLOSED.has(csn.status) && !csn.is_mother_with_children && Number(csn.dispatch_qty ?? 0) > EPSILON)
    .sort((a, b) => String(a.eta ?? "9999").localeCompare(String(b.eta ?? "9999")) || a.csn_number.localeCompare(b.csn_number));
  for (const csn of dispatched) {
    const openPo = Math.max(0, Number(csn.dispatch_qty) - Number(csn.received_qty ?? 0));
    const qty = take(openPo * line.base_per_po_unit);
    if (qty > EPSILON) {
      events.push({
        material_id: line.material_id, qty, date: csn.eta, kind: "IN_TRANSIT",
        date_source: csn.eta ? "CSN_ETA_TO_PLANT" : "NONE", reference: `${ref} · CSN ${csn.csn_number} (${csn.status})`,
        ...(csn.id ? { csn_id: csn.id } : {}),
      });
    }
  }
  const lots = [...line.lots].sort((a, b) => String(a.delivery_date ?? "9999").localeCompare(String(b.delivery_date ?? "9999")) || a.lot_number.localeCompare(b.lot_number));
  for (const lot of lots) {
    const qty = take(Number(lot.balance_qty) * line.base_per_po_unit);
    if (qty > EPSILON) {
      events.push({
        material_id: line.material_id, qty, date: lot.delivery_date, kind: "SCHEDULED_LOT",
        date_source: lot.delivery_date ? "LOT_DELIVERY_DATE" : "NONE", reference: `${ref} · Lot ${lot.lot_number}`,
        ...(line.po_line_id ? { reschedule_key: `PO_LOT|${line.po_line_id}|${lot.lot_number}` } : {}),
      });
    }
  }
  if (remaining > EPSILON && String(line.delivery_type ?? "").toUpperCase() === "BULK") {
    // Owner 2026-10-20 (option A): a BULK PO is called off as needed and never gets a CSN, so its
    // open quantity is available from the as-of day — no CSN ETA is asked for.
    events.push({ material_id: line.material_id, qty: remaining, date: asOf, kind: "PO_REMAINDER", date_source: "BULK_CALL_OFF", reference: `${ref} (BULK)` });
    remaining = 0;
  }
  if (remaining > EPSILON) {
    const scheduled = line.csns
      .filter((csn) => !CSN_CLOSED.has(csn.status) && !csn.is_mother_with_children && Number(csn.dispatch_qty ?? 0) <= EPSILON && csn.eta)
      .sort((a, b) => String(a.eta).localeCompare(String(b.eta)));
    const csn = scheduled[0];
    const date = csn?.eta ?? line.expected_delivery_date ?? null;
    events.push({
      material_id: line.material_id, qty: remaining, date, kind: "PO_REMAINDER",
      date_source: csn ? "CSN_ETA_TO_PLANT" : line.expected_delivery_date ? "PO_EXPECTED_DELIVERY" : "NONE",
      reference: csn ? `${ref} · CSN ${csn.csn_number} (${csn.status})` : ref,
      ...(csn?.id ? { csn_id: csn.id, reschedule_key: `CSN|${csn.id}` } : line.po_line_id ? { reschedule_key: `PO_LINE|${line.po_line_id}` } : {}),
    });
    remaining = 0;
  }
  return events;
}

export type InboundBuckets = {
  overdue: number;    // ETA before the as-of date, not yet received
  cm: number;         // as-of .. CM end (includes arrived-at-gate)
  nm: number;         // NM
  later: number;      // after NM
  unknown: number;    // no ETA
  total: number;
  /** Physically dispatched / at gate (CSN, gate entry, STO in transit) vs open PO (lot / remainder). */
  dispatched: number;
  open_po: number;
  /**
   * Dated events inside the horizon (as-of .. NM end). Owner D5: overdue and no-ETA
   * events are assumed to arrive on the as-of date (never dropped) and stay flagged
   * in `overdue` / `unknown`.
   */
  byDay: Map<string, number>;
};

export function bucketInbound(events: InboundEvent[], calendar: PlanningCalendar): InboundBuckets {
  const buckets: InboundBuckets = { overdue: 0, cm: 0, nm: 0, later: 0, unknown: 0, total: 0, dispatched: 0, open_po: 0, byDay: new Map() };
  const assumeToday = (qty: number) => buckets.byDay.set(calendar.asOf, (buckets.byDay.get(calendar.asOf) ?? 0) + qty);
  for (const event of events) {
    buckets.total += event.qty;
    if (event.kind === "SCHEDULED_LOT" || event.kind === "PO_REMAINDER" || event.kind === "SUB_CSN_PLANNED") buckets.open_po += event.qty;
    else buckets.dispatched += event.qty;
    if (!event.date) { buckets.unknown += event.qty; assumeToday(event.qty); continue; }
    if (event.date < calendar.asOf) { buckets.overdue += event.qty; assumeToday(event.qty); continue; }
    if (event.date <= calendar.cmEnd) buckets.cm += event.qty;
    else if (event.date <= calendar.nmEnd) buckets.nm += event.qty;
    else { buckets.later += event.qty; continue; }
    buckets.byDay.set(event.date, (buckets.byDay.get(event.date) ?? 0) + event.qty);
  }
  return buckets;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Lead time
// ─────────────────────────────────────────────────────────────────────────────
export type ConfiguredLeadTime = {
  vendor_label: string; route: "DOMESTIC" | "IMPORT"; days: number; detail: string; vendor_id?: string;
  /** Route time only (transit / sail + clearance + inland), Booking Time excluded. */
  route_days?: number;
};
export type LeadTimeResult = {
  configured_min: number | null;
  configured_max: number | null;
  configured_routes: ConfiguredLeadTime[];
  observed_count: number;
  observed_avg: number | null;
  observed_max: number | null;
  observed_p90: number | null;
  legacy_equivalent: number | null; // observed max + 4 (sheet: MAXIFS(CONSOILI_MVT!R, material) + 4)
  effective: number | null;
  effective_source: "CONFIGURED_MAX" | "LEGACY_MAX_PLUS_4" | "UNKNOWN";
  /** Owner-approved suggestion (advisory, never applied automatically), Booking Time excluded. */
  suggested_critical_days?: number | null;
  suggested_target_days?: number | null;
  delay_sample_count?: number;
  /** P3: why this suggestion (route + late-arrival margin + sample size). */
  suggestion_reason?: string | null;
};

/** P3 (owner 2026-10-20): the reason shown next to the suggested Target / Critical days. */
export function safetySuggestionReason(routeDays: number | null, critical: number | null, samples: number): string | null {
  if (routeDays === null && critical === null) return null;
  const parts: string[] = [];
  if (routeDays !== null) parts.push(`route ${routeDays} d`);
  if (critical !== null) parts.push(`+ ${critical} d late-arrival margin (9 of 10 of the last ${samples} shipment${samples === 1 ? "" : "s"} arrived within it)`);
  else parts.push("+ no shipment history yet for a late-arrival margin");
  return `Target = ${parts.join(" ")}; Critical = that margin.`;
}

/**
 * Suggested safety days (owner 2026-10-19, Booking Time excluded):
 *   Suggested Critical = p90 of how many days received shipments arrived later than their route
 *                        time (arrival − dispatch − route days; early = 0);
 *   Suggested Target   = longest route time of the material's vendors + Suggested Critical.
 * No delay history → Critical unknown and Target = route time alone (still a lower bound).
 */
export function suggestSafetyDays(routeOnlyMaxDays: number | null, delayDays: number[]): { critical: number | null; target: number | null; samples: number } {
  const valid = delayDays.filter((d) => Number.isFinite(d)).map((d) => Math.max(0, d)).sort((a, b) => a - b);
  const p90 = percentile(valid, 0.9);
  const critical = p90 === null ? null : Math.ceil(p90);
  const target = routeOnlyMaxDays === null ? null : routeOnlyMaxDays + (critical ?? 0);
  return { critical, target, samples: valid.length };
}

export const LEGACY_LEAD_TIME_BUFFER_DAYS = 4;

function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return round2(sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower));
}

/**
 * Effective lead time used for coverage, in this precedence (owner decision D2/D6,
 * 2026-10-19):
 *   1. configured vendor lead time = Booking Time (blank = 0) + route master
 *      (largest across this material's vendors/routes);
 *   2. fallback: observed history max + 4 days (the legacy sheet rule);
 *   3. UNKNOWN (never zero).
 */
export function computeLeadTime(configured: ConfiguredLeadTime[], observedDays: number[]): LeadTimeResult {
  const valid = observedDays.filter((d) => Number.isFinite(d) && d >= 0).sort((a, b) => a - b);
  const configuredDays = configured.map((c) => c.days).filter((d) => Number.isFinite(d) && d >= 0);
  const observedMax = valid.length ? valid[valid.length - 1] : null;
  const legacy = observedMax === null ? null : observedMax + LEGACY_LEAD_TIME_BUFFER_DAYS;
  const configuredMax = configuredDays.length ? Math.max(...configuredDays) : null;
  const effective = configuredMax ?? legacy;
  return {
    configured_min: configuredDays.length ? Math.min(...configuredDays) : null,
    configured_max: configuredMax,
    configured_routes: [...configured].sort((a, b) => a.vendor_label.localeCompare(b.vendor_label) || a.route.localeCompare(b.route)),
    observed_count: valid.length,
    observed_avg: valid.length ? round2(valid.reduce((s, d) => s + d, 0) / valid.length) : null,
    observed_max: observedMax,
    observed_p90: percentile(valid, 0.9),
    legacy_equivalent: legacy,
    effective,
    effective_source: configuredMax !== null ? "CONFIGURED_MAX" : legacy !== null ? "LEGACY_MAX_PLUS_4" : "UNKNOWN",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Coverage and all REQUIREMENT business fields
// ─────────────────────────────────────────────────────────────────────────────
export type CoverageResult = {
  days: number | null;          // null = no demand at all (infinite cover)
  stockout_date: string | null; // first day the projected balance cannot cover demand
  extrapolated: boolean;        // ran past NM end at the NM daily rate
};

/**
 * Date-wise coverage from the as-of date: walks each day adding dated inbound
 * (when given) and removing that day's demand. Partial days count as a
 * fraction. Past NM end the NM average daily rate is extrapolated.
 */
export function coverageDays(
  opening: number,
  calendar: PlanningCalendar,
  demandByDay: Map<string, number>,
  inboundByDay: Map<string, number> | null,
  extrapolationRate: number,
): CoverageResult {
  let balance = opening;
  let covered = 0;
  for (let day = calendar.asOf; day <= (calendar.horizonEnd ?? calendar.nmEnd); day = addDays(day, 1)) {
    balance += inboundByDay?.get(day) ?? 0;
    const demand = demandByDay.get(day) ?? 0;
    if (demand <= EPSILON) { covered += 1; continue; }
    if (balance >= demand - EPSILON) { balance -= demand; covered += 1; continue; }
    const fraction = balance > 0 ? balance / demand : 0;
    return { days: round2(covered + fraction), stockout_date: day, extrapolated: false };
  }
  const totalDemand = [...demandByDay.entries()].filter(([day]) => day >= calendar.asOf).reduce((s, [, q]) => s + q, 0);
  if (totalDemand <= EPSILON && extrapolationRate <= EPSILON) return { days: null, stockout_date: null, extrapolated: false };
  // Demand exists only in CM and stock outlasts it: covered through NM end, no rate to extrapolate.
  if (extrapolationRate <= EPSILON) return { days: covered, stockout_date: null, extrapolated: false };
  return { days: round2(covered + Math.max(0, balance) / extrapolationRate), stockout_date: null, extrapolated: true };
}

export type PolicyRow = {
  material_id: string;
  effective_from: string;
  target_cov_days: number | null;
  critical_cov_days: number | null;
  moq_qty: number | null;
  moq_uom_code: string | null;
  moq_source: "VENDOR" | "COMPANY" | "NONE";
  moq_active: boolean;
  version_no: number;
  /** D10 item carrying Rate (INR per base unit); optional. */
  carrying_rate_per_uom?: number | null;
  /** Order UoM (owner 2026-10-22): unit buy quantities are shown in; null = base unit. */
  order_uom_code?: string | null;
};

/** Policy used on `asOf`: the row with the latest effective_from <= asOf. */
export function effectivePolicy(rows: PolicyRow[], materialId: string, asOf: string): PolicyRow | null {
  let best: PolicyRow | null = null;
  for (const row of rows) {
    if (row.material_id !== materialId || row.effective_from > asOf) continue;
    if (!best || row.effective_from > best.effective_from) best = row;
  }
  return best;
}

/** What-if Safety / Target days for one simulation run (never saved). */
export type PolicyOverride = { target_cov_days: number | null; critical_cov_days: number | null };

/**
 * Simulation only: replaces Target / Critical days of the given materials on every policy row
 * (all effective dates), so the run behaves as if those days were set. A material with no policy
 * row gets a minimal one. MOQ and carrying rate stay as saved.
 */
export function applyPolicyOverrides(rows: readonly PolicyRow[], overrides: ReadonlyMap<string, PolicyOverride>): PolicyRow[] {
  if (overrides.size === 0) return [...rows];
  const result = rows.map((row) => {
    const o = overrides.get(row.material_id);
    return o ? { ...row, target_cov_days: o.target_cov_days, critical_cov_days: o.critical_cov_days } : row;
  });
  for (const [materialId, o] of overrides) {
    if (rows.some((row) => row.material_id === materialId)) continue;
    result.push({
      material_id: materialId, effective_from: "1900-01-01", target_cov_days: o.target_cov_days, critical_cov_days: o.critical_cov_days,
      moq_qty: null, moq_uom_code: null, moq_source: "NONE", moq_active: false, version_no: 0, carrying_rate_per_uom: null,
    });
  }
  return result;
}

/**
 * NM REQ DAYS (ERP, date-aware): how many days of next month must already be
 * covered now so that cover from the as-of date reaches Target days:
 *   clamp(Target − CM days left, 0, days in NM).
 * Legacy differs per company (verified directly on 2026-10-16): CMP003 has
 * a 15th-of-month step, while CMP005/CMP011 use target minus days left. This
 * single policy-driven rule is an intentional ERP smoothing correction; the
 * reconciliation report records the exact variance rather than hiding it.
 */
export function nmRequiredDays(targetDays: number | null, calendar: PlanningCalendar): number | null {
  if (targetDays === null || targetDays === undefined) return null;
  return Math.min(calendar.nmDaysInMonth, Math.max(0, round2(targetDays - calendar.cmDaysLeft)));
}

/** Demand in the first `days` (fractional) days of NM. */
export function demandForFirstNmDays(demandByDay: Map<string, number>, calendar: PlanningCalendar, days: number): number {
  let remaining = days;
  let total = 0;
  for (let day = calendar.nmStart; day <= calendar.nmEnd && remaining > EPSILON; day = addDays(day, 1)) {
    const share = Math.min(1, remaining);
    total += (demandByDay.get(day) ?? 0) * share;
    remaining -= share;
  }
  return total;
}

export type MaterialMetrics = {
  cm_days_in_month: number;
  cm_days_left: number;
  nm_days_in_month: number;
  cm_req: number;            // CURRENT MONTH REQ / Current Req — whole CM
  cm_prorata: number;        // CURRENT MONTH PRORATA / Current Prorata — as-of .. CM end
  cm_cons: number;           // CURRENT CONS. — posted consumption CM start .. day before as-of
  cm_balance_req: number;    // max(0, CM req − CM consumption) — alternative "remaining" view
  nm_req: number;            // Req NM — whole NM
  nm_prorata: number;        // Prorata NM — NM has no elapsed days, equals Req NM
  current_stock: number;     // CURRENT_STOCK — usable at required locations, start of as-of day
  current_balance: number;   // Current Balance — stock − CM prorata (CM end, no inbound)
  intransit_cm: number;
  intransit_nm: number;
  intransit_overdue: number;
  intransit_unknown: number;
  intransit_later: number;
  nm_opening: number;        // current balance + inbound in CM
  nm_closing: number;        // NM opening + inbound in NM − Req NM
  status_nm: "NO_DEMAND" | "COVERED" | "SHORT_IN_NM" | "SHORT_BEFORE_NM";
  current_stk_days: number | null;  // CURRENT STK DAYS — stock only, date-wise
  current_cov: number | null;       // Current Cov — stock + inbound arriving in CM
  next_month_cov: number | null;    // Next Month Cov — NM opening ÷ NM daily rate
  cov_till_nm: number | null;       // Cov till NM — stock + all dated inbound through NM
  stockout_date: string | null;
  stockout_date_with_inbound: string | null;
  cover_extrapolated: boolean;
  target_cov_days: number | null;
  critical_cov_days: number | null;
  below_target: boolean | null;
  below_critical: boolean | null;
  below_target_with_in: boolean | null;
  below_critical_with_in: boolean | null;
  nm_req_days: number | null;       // NM REQ DAYS
  next_month_req: number | null;    // NEXT MONTH REQ — NM demand for NM REQ DAYS
  total_req: number | null;         // TOTAL REQ = CM req + NEXT MONTH REQ
  total_prorata: number | null;     // TOTAL PRORATA = CM prorata + NEXT MONTH REQ
  avg_daily_req: number;            // forward average daily demand (as-of .. NM end)
  safety_day_stock: number | null;  // Safety Day Stock = Critical days × avg daily
  lead_time_stock: number | null;   // Lead time Stock = effective lead time × avg daily
  total_stock_level: number | null; // Total Stock = safety + lead-time stock
  net_req: number | null;           // max(0, TOTAL PRORATA − stock − inbound dated by the target window end)
  moq_base_qty: number | null;      // policy MOQ in material base unit
  net_req_moq: number | null;       // net req raised to MOQ when MOQ is active
  identifier: "NO_DEMAND" | "NO_POLICY" | "CRITICAL" | "BELOW_TARGET" | "OK";
  id2: "NO_DEMAND" | "NO_POLICY" | "CRITICAL" | "BELOW_TARGET" | "OK";
  inbound_risk: "NONE" | "ON_TIME" | "ETA_UNKNOWN" | "OVERDUE";
  // ── Sheet REQUIREMENT meanings (owner decision D2, 2026-10-19) ──────────────
  /** H: remaining CM = CM req − consumption so far; when ≤ 0 the sheet shows Req NM instead. */
  sheet_current_req: number;
  sheet_current_req_basis: "CM_REMAINING" | "NM";
  /** I: daily rate of H (over CM days left, or NM days when H is the NM basis). */
  current_prorata_daily: number;
  /** K: NM daily rate. */
  nm_prorata_daily: number;
  /** AB = NM REQ DAYS × K. */
  sheet_next_month_req: number | null;
  /** AC = H + AB. */
  sheet_total_req: number | null;
  /** AD: daily rate over the cover window (CM days left + NM REQ DAYS). */
  total_prorata_daily: number;
  /** N: H − current stock (+ = shortage). */
  current_balance_shortage: number;
  /** Dispatched / at gate vs open PO (lot / remainder) inbound. */
  intransit_dispatched: number;
  intransit_open_po: number;
  /** AJ: reorder level (Safety + Lead-time stock) ≥ current stock. */
  reorder_flag: boolean | null;
  /** X: 0 = no total requirement; else 1 + below Target + below Critical (only when reorder flag). */
  priority_score: number | null;
};

export type MetricsInput = {
  calendar: PlanningCalendar;
  demandByDay: Map<string, number>;
  /**
   * Sheet columns (CM Req, Req NM, Current Req / Prorata, Safety, Reorder): the gross plan
   * demand of this material as the BOM / stroke line's own item (owner 2026-10-22: Current
   * Prorata = (CM plan − consumed) ÷ CM days left). Defaults to demandByDay. demandByDay stays
   * the stock-allocated demand used for cover days / stock-out.
   */
  planDemandByDay?: Map<string, number>;
  consumption: number;
  stock: number;
  inbound: InboundBuckets;
  policy: PolicyRow | null;
  moqBaseQty: number | null;
  leadTimeDays: number | null;
};

function sumRange(map: Map<string, number>, from: string, to: string): number {
  let total = 0;
  for (const [day, qty] of map) if (day >= from && day <= to) total += qty;
  return total;
}

function classify(coverDays: number | null, hasDemand: boolean, policy: PolicyRow | null): MaterialMetrics["identifier"] {
  if (!hasDemand) return "NO_DEMAND";
  if (!policy || policy.target_cov_days === null) return "NO_POLICY";
  const cover = coverDays ?? Number.POSITIVE_INFINITY;
  if (policy.critical_cov_days !== null && cover <= policy.critical_cov_days) return "CRITICAL";
  if (cover <= policy.target_cov_days) return "BELOW_TARGET";
  return "OK";
}

export function computeMaterialMetrics(input: MetricsInput): MaterialMetrics {
  const { calendar, demandByDay, inbound, policy } = input;
  const cmReq = sumRange(demandByDay, calendar.cmStart, calendar.cmEnd);
  const cmProrata = sumRange(demandByDay, calendar.asOf, calendar.cmEnd);
  const nmReq = sumRange(demandByDay, calendar.nmStart, calendar.nmEnd);
  const nmDaily = calendar.nmDaysInMonth > 0 ? nmReq / calendar.nmDaysInMonth : 0;
  const planDemand = input.planDemandByDay ?? demandByDay;
  const planCmReq = sumRange(planDemand, calendar.cmStart, calendar.cmEnd);
  const planNmReq = sumRange(planDemand, calendar.nmStart, calendar.nmEnd);
  const forwardDays = calendar.cmDaysLeft + calendar.nmDaysInMonth;
  const avgDaily = forwardDays > 0 ? (cmProrata + nmReq) / forwardDays : 0;
  const hasDemand = cmProrata + nmReq > EPSILON;

  const cmInbound = new Map([...inbound.byDay].filter(([day]) => day <= calendar.cmEnd));
  const stockOnly = coverageDays(input.stock, calendar, demandByDay, null, nmDaily);
  const withCm = coverageDays(input.stock, calendar, demandByDay, cmInbound, nmDaily);
  const withAll = coverageDays(input.stock, calendar, demandByDay, inbound.byDay, nmDaily);

  const currentBalance = input.stock - cmProrata;
  // D5: an overdue or ETA-less arrival is assumed to arrive today (it is already in the cover
  // days); leaving it out made Next Month Cov 0 while Current Cov counted it (owner 2026-10-22).
  const nmOpening = currentBalance + inbound.cm + inbound.overdue + inbound.unknown;
  const nmClosing = nmOpening + inbound.nm - nmReq;
  const statusNm: MaterialMetrics["status_nm"] = nmReq <= EPSILON && cmProrata <= EPSILON
    ? "NO_DEMAND"
    : nmClosing >= -EPSILON ? "COVERED" : nmOpening >= -EPSILON ? "SHORT_IN_NM" : "SHORT_BEFORE_NM";

  const target = policy?.target_cov_days ?? null;
  const critical = policy?.critical_cov_days ?? null;
  // D2: Below Target / Critical are inclusive (<=), like the sheet.
  const below = (cover: number | null, threshold: number | null) =>
    threshold === null || !hasDemand ? null : (cover ?? Number.POSITIVE_INFINITY) <= threshold;

  const nmReqDays = nmRequiredDays(target, calendar);
  const nextMonthReq = nmReqDays === null ? null : demandForFirstNmDays(demandByDay, calendar, nmReqDays);
  const totalReq = nextMonthReq === null ? null : cmReq + nextMonthReq;
  const totalProrata = nextMonthReq === null ? null : cmProrata + nextMonthReq;
  // Inbound usable by the end of the target window (CM end + NM REQ DAYS).
  let netReq: number | null = null;
  if (totalProrata !== null && nmReqDays !== null) {
    const windowEnd = addDays(calendar.cmEnd, Math.ceil(nmReqDays));
    const inboundByWindow = sumRange(inbound.byDay, calendar.asOf, minDate(windowEnd, calendar.nmEnd));
    netReq = Math.max(0, totalProrata - input.stock - inboundByWindow);
  }
  let netReqMoq: number | null = netReq;
  if (netReq !== null && policy?.moq_active && input.moqBaseQty !== null && netReq > EPSILON) {
    netReqMoq = Math.max(netReq, input.moqBaseQty);
  }

  // Sheet REQUIREMENT meanings (D2): H, I, K, AB, AC, AD, N, AG–AJ, X.
  const remainingCm = planCmReq - input.consumption;
  const cmBasis = remainingCm > EPSILON;
  const sheetCurrentReq = cmBasis ? remainingCm : planNmReq;
  const nmProrataDaily = calendar.nmDaysInMonth > 0 ? planNmReq / calendar.nmDaysInMonth : 0;
  const currentProrataDaily = cmBasis ? (calendar.cmDaysLeft > 0 ? remainingCm / calendar.cmDaysLeft : 0) : nmProrataDaily;
  const sheetNextMonthReq = nmReqDays === null ? null : nmReqDays * nmProrataDaily;
  const sheetTotalReq = sheetNextMonthReq === null ? null : sheetCurrentReq + sheetNextMonthReq;
  const coverWindow = calendar.cmDaysLeft + (nmReqDays ?? 0);
  const totalProrataDaily = cmBasis
    ? (coverWindow > 0 ? (sheetTotalReq ?? sheetCurrentReq) / coverWindow : 0)
    : currentProrataDaily;
  const safetyStock = target === null ? null : target * totalProrataDaily;
  const leadStock = input.leadTimeDays === null ? null : input.leadTimeDays * totalProrataDaily;
  const totalStockLevel = safetyStock === null || leadStock === null ? null : safetyStock + leadStock;
  const reorderFlag = !hasDemand || totalStockLevel === null ? null : totalStockLevel >= input.stock - EPSILON;
  const belowTarget = below(stockOnly.days, target);
  const belowCritical = below(stockOnly.days, critical);
  const priorityScore = reorderFlag !== true ? null
    : (sheetTotalReq ?? 0) <= EPSILON ? 0 : 1 + (belowTarget ? 1 : 0) + (belowCritical ? 1 : 0);

  const inboundRisk: MaterialMetrics["inbound_risk"] = inbound.total <= EPSILON
    ? "NONE"
    : inbound.overdue > EPSILON ? "OVERDUE" : inbound.unknown > EPSILON ? "ETA_UNKNOWN" : "ON_TIME";

  const r = roundQty;
  return {
    cm_days_in_month: calendar.cmDaysInMonth,
    cm_days_left: calendar.cmDaysLeft,
    nm_days_in_month: calendar.nmDaysInMonth,
    cm_req: r(planCmReq),
    cm_prorata: r(cmProrata),
    cm_cons: r(input.consumption),
    cm_balance_req: r(Math.max(0, planCmReq - input.consumption)),
    nm_req: r(planNmReq),
    nm_prorata: r(planNmReq),
    current_stock: r(input.stock),
    current_balance: r(currentBalance),
    intransit_cm: r(inbound.cm),
    intransit_nm: r(inbound.nm),
    intransit_overdue: r(inbound.overdue),
    intransit_unknown: r(inbound.unknown),
    intransit_later: r(inbound.later),
    nm_opening: r(nmOpening),
    nm_closing: r(nmClosing),
    status_nm: statusNm,
    current_stk_days: hasDemand ? stockOnly.days : null,
    current_cov: hasDemand ? withCm.days : null,
    next_month_cov: nmDaily > EPSILON ? round2(Math.max(0, nmOpening) / nmDaily) : null,
    cov_till_nm: hasDemand ? withAll.days : null,
    stockout_date: stockOnly.stockout_date,
    stockout_date_with_inbound: withAll.stockout_date,
    cover_extrapolated: stockOnly.extrapolated || withAll.extrapolated,
    target_cov_days: target,
    critical_cov_days: critical,
    below_target: belowTarget,
    below_critical: belowCritical,
    below_target_with_in: below(withAll.days, target),
    below_critical_with_in: below(withAll.days, critical),
    nm_req_days: nmReqDays,
    next_month_req: nextMonthReq === null ? null : r(nextMonthReq),
    total_req: totalReq === null ? null : r(totalReq),
    total_prorata: totalProrata === null ? null : r(totalProrata),
    avg_daily_req: r(avgDaily),
    // D2: Safety Day Stock = Target days × AD (sheet AG); Lead-time stock = lead time × AD (AH).
    safety_day_stock: safetyStock === null ? null : r(safetyStock),
    lead_time_stock: leadStock === null ? null : r(leadStock),
    total_stock_level: totalStockLevel === null ? null : r(totalStockLevel),
    net_req: netReq === null ? null : r(netReq),
    moq_base_qty: input.moqBaseQty === null ? null : r(input.moqBaseQty),
    net_req_moq: netReqMoq === null ? null : r(netReqMoq),
    identifier: classify(stockOnly.days, hasDemand, policy),
    id2: classify(withAll.days, hasDemand, policy),
    inbound_risk: inboundRisk,
    sheet_current_req: r(sheetCurrentReq),
    sheet_current_req_basis: cmBasis ? "CM_REMAINING" : "NM",
    current_prorata_daily: r(currentProrataDaily),
    nm_prorata_daily: r(nmProrataDaily),
    sheet_next_month_req: sheetNextMonthReq === null ? null : r(sheetNextMonthReq),
    sheet_total_req: sheetTotalReq === null ? null : r(sheetTotalReq),
    total_prorata_daily: r(totalProrataDaily),
    current_balance_shortage: r(sheetCurrentReq - input.stock),
    intransit_dispatched: r(inbound.dispatched),
    intransit_open_po: r(inbound.open_po),
    reorder_flag: reorderFlag,
    priority_score: priorityScore,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reproducibility
// ─────────────────────────────────────────────────────────────────────────────
/** Stable JSON (sorted object keys, Maps/Sets as sorted arrays) for fingerprints. */
export function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (input instanceof Map) return [...input.entries()].map(([k, v]) => [String(k), normalize(v)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    if (input instanceof Set) return [...input].map(String).sort();
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.keys(input as Record<string, unknown>).sort().map((key) => [key, normalize((input as Record<string, unknown>)[key])]));
    }
    if (typeof input === "number") return Number.isFinite(input) ? roundQty(input) : null;
    return input ?? null;
  };
  return JSON.stringify(normalize(value));
}

// ─────────────────────────────────────────────────────────────────────────────
// Whole pipeline (handler loads sources, this computes)
// ─────────────────────────────────────────────────────────────────────────────
/** CONS bucket of get_stock_history = Σ(IN) − Σ(OUT) of P261/P262; consumption = −CONS (reversals net off). */
export function consumptionFromConsBucket(consBucket: number | null | undefined): number {
  const value = Number(consBucket ?? 0);
  return Number.isFinite(value) ? -value : 0;
}

export type PoolTrace = {
  pool_key: string;
  kind: "RM" | "PM";
  group_id: string | null;
  use_primary: boolean | null;
  candidates: string[];
  storage_location_id: string | null;
  pool_total: number;          // whole pool demand over the horizon
  this_material_qty: number;   // part of the pool attributed to this material
  prodshade_ids: string[];
  sku_ids: string[];
  stroke_ids: string[];
  pack_bom_ids: string[];
  /** Physical pack provenance for PM pools; absent for RM pools. */
  outer_qty: number | null;
  outer_uom_code: string | null;
  fill_qty_per_outer: number | null;
};

export type RequirementRow = {
  material_id: string;
  kind: "RM" | "PM" | "OTHER";
  metrics: MaterialMetrics;
  stock: MaterialStockPosition;
  inbound: Omit<InboundBuckets, "byDay">;
  inbound_events: InboundEvent[];
  pools: PoolTrace[];
  lead_time: LeadTimeResult | null;
  policy: PolicyRow | null;
  from_stock_qty: number;      // horizon demand covered by usable stock in allocation
  /** D3: this material's own fixed (exclusive) demand vs group demand drawn from its stock (horizon). */
  fixed_demand_qty: number;
  group_share_qty: number;
  /** Internal: day → demand attributed to this material (not serialised by the API). */
  daily_demand: Map<string, number>;
};

/** D3: one row per material-null group pool (RM Use Primary = No, PM groups). */
export type GroupRequirementRow = {
  group_id: string;
  kind: "RM" | "PM";
  member_ids: string[];
  cm_demand: number;            // group demand as-of .. CM end
  nm_demand: number;
  covered_from_stock: number;   // drawn from members' counted stock after fixed demand
  uncovered_cm: number;         // group shortage, never assigned to a member
  uncovered_nm: number;
  first_uncovered_day: string | null;
  cover_days: number | null;    // days from as-of until the first uncovered day (null = covered through NM)
  members_inbound_total: number;
  members: Array<{
    material_id: string;
    drawn_qty: number;          // this group's demand met from this member
    fixed_demand_qty: number;   // the member's own exclusive demand (met first)
    usable_stock: number;
    target_cov_days: number | null;
    critical_cov_days: number | null;
    below_target: boolean | null;
    below_critical: boolean | null;
  }>;
  any_member_below_target: boolean;
  any_member_below_critical: boolean;
  /** Internal: day → group shortage (not serialised by the API). */
  uncovered_by_day: Map<string, number>;
};

export type RequirementInput = Omit<ExplosionInput, "effective"> & {
  planLines: PlanLineVersion[];
  demandAt: string | null;
  stockRows: StockRow[];
  reservations: ReservationRow[];
  applyReservations: boolean;
  consumptionByMaterial: Map<string, number>;
  inboundEvents: InboundEvent[];
  policies: PolicyRow[];
  leadTimes: Map<string, LeadTimeResult>;
  /** Every RM/PM material of the company's MTS strokes / Pack BOMs (policy lookups; rows show only planned ones). */
  materialUniverse: string[];
  /** Company planning location roles (owner D1/D12); absent = legacy required-location stock. */
  locationRoles?: Map<string, LocationRole>;
  /** material → posted stock promised to another company by an open Sub-CSN / STO (base qty). */
  committedTransferOut?: Map<string, number>;
  /** PO22 Group Settings in force on the as-of date (group → member order). */
  groupOrders?: Map<string, GroupUsageOrder>;
};

/**
 * Store Material Usage Instruction row (Phase 2D §6): one product source line × period × material.
 * Executable = backed by current posted counted stock only; the rest is not yet backed (future /
 * uncovered) and is never an issue instruction. Σ executable + not_backed = demand per line/period.
 */
export type StoreInstructionRow = {
  pool_key: string;
  kind: "RM" | "PM";
  period: StorePeriod;
  prodshade_ids: string[];
  sku_ids: string[];
  stroke_ids: string[];
  pack_bom_ids: string[];
  line_type: "FIXED" | "GROUP";
  group_id: string | null;
  /** null = group pool remainder not assigned to a member. */
  material_id: string | null;
  demand_qty: number;          // line demand in the period (repeated on each row of the line)
  executable_qty: number;      // this material's share backed by current stock
  not_backed_qty: number;      // only on the remainder row
};

export type RequirementOutput = {
  rows: RequirementRow[];
  groups: GroupRequirementRow[];
  store_rows: StoreInstructionRow[];
  warnings: Warning[];
  exceptions: Warning[];
  effective: EffectiveSkuMonth[];
  /** Exploded demand before any stock allocation (PO22 family planner input; never serialised). */
  records: DemandRecord[];
};

export function moqInBase(policy: PolicyRow | null, material: MaterialInfo | undefined): number | null {
  if (!policy || policy.moq_qty === null || !policy.moq_uom_code) return null;
  const unit = policy.moq_uom_code.toUpperCase();
  if (!material) return null;
  if (unit === String(material.base_uom_code).toUpperCase()) return policy.moq_qty;
  // Stored conversions may be base→uom; to_base_factors already holds both directions.
  return toMaterialBase(material, policy.moq_qty, unit);
}

export function buildRequirementRows(input: RequirementInput): RequirementOutput {
  const effective = effectivePlanAt(input.planLines, input.demandAt);
  const explosion = explodeDemand({ ...input, effective });
  const protectionDays = new Map<string, { critical_days: number | null; target_days: number | null }>();
  for (const materialId of new Set([...input.materialUniverse, ...explosion.records.flatMap((r) => r.candidates)])) {
    const policy = effectivePolicy(input.policies, materialId, input.calendar.asOf);
    if (policy) protectionDays.set(materialId, { critical_days: policy.critical_cov_days, target_days: policy.target_cov_days });
  }
  const allocation = allocateDemand(explosion.records, input.calendar, input.stockRows, input.reservations, input.applyReservations, {
    locationRoles: input.locationRoles, committedTransferOut: input.committedTransferOut, protectionDays,
    groupOrders: input.groupOrders,
  });
  const warnings = [...explosion.warnings];
  for (const [materialId, pos] of allocation.stock) {
    if (pos.protection_used > EPSILON) {
      warnings.push({ code: "EXCLUSIVE_PROTECTION_USED", message: `A group had no free stock left and used ${roundQty(pos.protection_used)} of this material's protected stock (kept for its own exclusive use). Buy this material soon.`, material_id: materialId });
    }
  }
  // Sheet plan demand: every record's full qty to the BOM / stroke line's own item
  // (candidates[0]), whatever stock later serves it. Use Primary = No lists members only, so
  // that demand belongs to the group row, not to a member.
  const planDemandByMaterial = new Map<string, Map<string, number>>();
  for (const record of explosion.records) {
    if (record.use_primary === false) continue;
    const owner = record.candidates[0];
    if (!owner) continue;
    const byDay = planDemandByMaterial.get(owner) ?? new Map<string, number>();
    byDay.set(record.day, (byDay.get(record.day) ?? 0) + record.qty);
    planDemandByMaterial.set(owner, byDay);
  }
  const eventsByMaterial = new Map<string, InboundEvent[]>();
  for (const event of input.inboundEvents) eventsByMaterial.set(event.material_id, [...(eventsByMaterial.get(event.material_id) ?? []), event]);

  const poolsByMaterial = new Map<string, PoolTrace[]>();
  for (const [poolKey, pool] of allocation.pools) {
    for (const candidate of pool.candidates) {
      const trace: PoolTrace = {
        pool_key: poolKey,
        kind: pool.kind,
        group_id: pool.group_id,
        use_primary: pool.use_primary,
        candidates: pool.candidates,
        storage_location_id: pool.storage_location_id,
        pool_total: roundQty(pool.total),
        this_material_qty: roundQty(pool.byMaterial.get(candidate) ?? 0),
        prodshade_ids: [...pool.prodshades].sort(),
        sku_ids: [...pool.skus].sort(),
        stroke_ids: [...pool.strokes].sort(),
        pack_bom_ids: [...pool.pack_boms].sort(),
        outer_qty: pool.outer_uom_code ? roundQty(pool.outer_qty) : null,
        outer_uom_code: pool.outer_uom_code,
        fill_qty_per_outer: pool.outer_uom_code && pool.fill_qty_per_outer !== null
          ? roundQty(pool.fill_qty_per_outer)
          : null,
      };
      poolsByMaterial.set(candidate, [...(poolsByMaterial.get(candidate) ?? []), trace]);
    }
  }

  // Owner 2026-10-20: a material of an MTS stroke / Pack BOM whose SKUs have no plan in CM/NM is not
  // shown (it would only surface unrelated MTO/HPS housekeeping). Rows = materials the effective plan
  // actually reaches: direct demand, group pool candidates (incl. members that only lend stock).
  const materialIds = [...new Set([
    ...explosion.records.flatMap((r) => r.candidates),
    ...allocation.dailyByMaterial.keys(),
    ...poolsByMaterial.keys(),
  ])].sort();
  const emptyStock = (): MaterialStockPosition => ({
    usable_at_required: 0, unrestricted_at_required: 0, reserved_at_required: 0, other_sloc_unrestricted: 0,
    excluded_unrestricted: 0, quality_inspection: 0, blocked: 0, other_stock_types: 0, required_locations: [], other_locations: [],
    committed_transfer_out: 0, exclusive_protected: 0, protection_used: 0,
  });

  const rows: RequirementRow[] = materialIds.map((materialId) => {
    const material = input.materials.get(materialId);
    const demand = allocation.dailyByMaterial.get(materialId) ?? new Map<string, number>();
    const stock = allocation.stock.get(materialId) ?? emptyStock();
    const events = (eventsByMaterial.get(materialId) ?? []).slice().sort((a, b) =>
      String(a.date ?? "9999").localeCompare(String(b.date ?? "9999")) || a.reference.localeCompare(b.reference));
    const buckets = bucketInbound(events, input.calendar);
    const policy = effectivePolicy(input.policies, materialId, input.calendar.asOf);
    const moq = moqInBase(policy, material);
    if (policy?.moq_qty !== null && policy?.moq_qty !== undefined && moq === null) {
      warnings.push({ code: "MOQ_UOM_CONVERSION_MISSING", message: `MOQ unit ${policy.moq_uom_code} has no verified conversion to the base unit; MOQ not applied.`, material_id: materialId });
    }
    const leadTime = input.leadTimes.get(materialId) ?? null;
    const metrics = computeMaterialMetrics({
      calendar: input.calendar,
      demandByDay: demand,
      planDemandByDay: planDemandByMaterial.get(materialId) ?? new Map<string, number>(),
      consumption: input.consumptionByMaterial.get(materialId) ?? 0,
      stock: stock.usable_at_required,
      inbound: buckets,
      policy,
      moqBaseQty: moq,
      leadTimeDays: leadTime?.effective ?? null,
    });
    const fromStock = [...(allocation.fromStockByMaterial.get(materialId)?.values() ?? [])].reduce((s, q) => s + q, 0);
    const { byDay: _byDay, ...bucketTotals } = buckets;
    const kind = material?.material_type === "RM" ? "RM" : material?.material_type === "PM" ? "PM" : "OTHER";
    return {
      material_id: materialId,
      kind,
      metrics,
      stock: {
        ...stock,
        usable_at_required: roundQty(stock.usable_at_required),
        unrestricted_at_required: roundQty(stock.unrestricted_at_required),
        reserved_at_required: roundQty(stock.reserved_at_required),
        other_sloc_unrestricted: roundQty(stock.other_sloc_unrestricted),
        excluded_unrestricted: roundQty(stock.excluded_unrestricted),
        quality_inspection: roundQty(stock.quality_inspection),
        blocked: roundQty(stock.blocked),
        other_stock_types: roundQty(stock.other_stock_types),
        committed_transfer_out: roundQty(stock.committed_transfer_out),
        exclusive_protected: roundQty(stock.exclusive_protected),
        protection_used: roundQty(stock.protection_used),
      },
      inbound: {
        overdue: roundQty(bucketTotals.overdue), cm: roundQty(bucketTotals.cm), nm: roundQty(bucketTotals.nm),
        later: roundQty(bucketTotals.later), unknown: roundQty(bucketTotals.unknown), total: roundQty(bucketTotals.total),
        dispatched: roundQty(bucketTotals.dispatched), open_po: roundQty(bucketTotals.open_po),
      },
      inbound_events: events.map((event) => ({ ...event, qty: roundQty(event.qty) })),
      pools: (poolsByMaterial.get(materialId) ?? []).sort((a, b) => a.pool_key.localeCompare(b.pool_key)),
      lead_time: leadTime,
      policy,
      from_stock_qty: roundQty(fromStock),
      fixed_demand_qty: roundQty(allocation.fixedByMaterial.get(materialId) ?? 0),
      group_share_qty: roundQty(allocation.groupShareByMaterial.get(materialId) ?? 0),
      daily_demand: demand,
    };
  });

  const rowById = new Map(rows.map((row) => [row.material_id, row]));
  const { calendar } = input;
  const groups: GroupRequirementRow[] = [...allocation.groups.values()].map((group) => {
    const inRange = (map: Map<string, number>, from: string, to: string) =>
      [...map].filter(([day]) => day >= from && day <= to).reduce((sum, [, qty]) => sum + qty, 0);
    const uncoveredDays = [...group.uncoveredByDay].filter(([day, qty]) => day >= calendar.asOf && qty > EPSILON).map(([day]) => day).sort();
    const firstUncovered = uncoveredDays[0] ?? null;
    const memberIds = [...group.candidates].sort();
    const members = memberIds.map((id) => {
      const row = rowById.get(id);
      return {
        material_id: id,
        drawn_qty: roundQty(group.drawnByMaterial.get(id) ?? 0),
        fixed_demand_qty: row?.fixed_demand_qty ?? 0,
        usable_stock: row?.stock.usable_at_required ?? 0,
        target_cov_days: row?.metrics.target_cov_days ?? null,
        critical_cov_days: row?.metrics.critical_cov_days ?? null,
        below_target: row?.metrics.below_target ?? null,
        below_critical: row?.metrics.below_critical ?? null,
      };
    });
    return {
      group_id: group.group_id,
      kind: group.kind,
      member_ids: memberIds,
      cm_demand: roundQty(inRange(group.demandByDay, calendar.asOf, calendar.cmEnd)),
      nm_demand: roundQty(inRange(group.demandByDay, calendar.nmStart, calendar.nmEnd)),
      covered_from_stock: roundQty([...group.drawnByMaterial.values()].reduce((sum, qty) => sum + qty, 0)),
      uncovered_cm: roundQty(inRange(group.uncoveredByDay, calendar.asOf, calendar.cmEnd)),
      uncovered_nm: roundQty(inRange(group.uncoveredByDay, calendar.nmStart, calendar.nmEnd)),
      first_uncovered_day: firstUncovered,
      cover_days: firstUncovered === null ? null : daysInclusive(calendar.asOf, firstUncovered) - 1,
      members_inbound_total: roundQty(memberIds.reduce((sum, id) => sum + (rowById.get(id)?.inbound.total ?? 0), 0)),
      members,
      any_member_below_target: members.some((m) => m.below_target === true),
      any_member_below_critical: members.some((m) => m.below_critical === true),
      uncovered_by_day: group.uncoveredByDay,
    };
  }).sort((a, b) => a.group_id.localeCompare(b.group_id));
  const storeRows: StoreInstructionRow[] = [];
  for (const [poolKey, pool] of [...allocation.pools].sort(([a], [b]) => a.localeCompare(b))) {
    for (const period of ["CM", "NM"] as const) {
      const demand = pool.periodDemand[period];
      if (demand <= EPSILON) continue;
      const base = {
        pool_key: poolKey, kind: pool.kind, period,
        prodshade_ids: [...pool.prodshades].sort(), sku_ids: [...pool.skus].sort(), stroke_ids: [...pool.strokes].sort(), pack_bom_ids: [...pool.pack_boms].sort(),
        line_type: (pool.group_id && pool.candidates.length > 1 ? "GROUP" : "FIXED") as StoreInstructionRow["line_type"],
        group_id: pool.group_id, demand_qty: roundQty(demand),
      };
      let backed = 0;
      for (const [material, byPeriod] of [...pool.periodFromStock].sort(([a], [b]) => a.localeCompare(b))) {
        if (byPeriod[period] <= EPSILON) continue;
        backed += byPeriod[period];
        storeRows.push({ ...base, material_id: material, executable_qty: roundQty(byPeriod[period]), not_backed_qty: 0 });
      }
      const rest = demand - backed;
      if (rest > EPSILON) {
        const owner = isGroupOwnedPool({ group_id: pool.group_id, kind: pool.kind, use_primary: pool.use_primary }) ? null : pool.candidates[0];
        storeRows.push({ ...base, material_id: owner, executable_qty: 0, not_backed_qty: roundQty(rest) });
      }
    }
  }
  return { rows, groups, store_rows: storeRows, warnings, exceptions: explosion.exceptions, effective, records: explosion.records };
}

export type UomConversion = { from_uom_code: string; to_uom_code: string; conversion_factor: number | null; variable_conversion: boolean | null; active: boolean | null };

/**
 * unit → factor such that 1 unit = factor × base unit. Only fixed, active,
 * positive master conversions (both directions of a row touching the base
 * unit), plus the owner's standard 1 MT = 1000 KG for a KG-base material.
 * Never invents a factor.
 */
export function buildToBaseFactors(baseUomCode: string, conversions: UomConversion[]): Record<string, number> {
  const base = String(baseUomCode ?? "").toUpperCase();
  const factors: Record<string, number> = {};
  if (base === "KG") factors.MT = 1000;
  for (const row of conversions) {
    if (row.active === false || row.variable_conversion === true) continue;
    const factor = Number(row.conversion_factor);
    if (!Number.isFinite(factor) || factor <= 0) continue;
    const from = String(row.from_uom_code ?? "").toUpperCase();
    const to = String(row.to_uom_code ?? "").toUpperCase();
    if (to === base && from && from !== base && factors[from] === undefined) factors[from] = factor;
    else if (from === base && to && to !== base && factors[to] === undefined) factors[to] = 1 / factor;
  }
  return factors;
}
