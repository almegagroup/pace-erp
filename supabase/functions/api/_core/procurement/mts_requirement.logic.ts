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
  horizon: string[];      // every day CM start .. NM end
};

/** CM = the selected plan month; the as-of date must lie inside it. */
export function buildCalendar(planMonth: string, asOf: string): PlanningCalendar | null {
  if (!isIsoDate(planMonth) || planMonth.slice(8) !== "01" || !isIsoDate(asOf)) return null;
  const cmStart = planMonth;
  const cmEnd = monthEnd(cmStart);
  if (asOf < cmStart || asOf > cmEnd) return null;
  const nmStart = nextMonth(cmStart);
  const nmEnd = monthEnd(nmStart);
  const horizon: string[] = [];
  for (let day = cmStart; day <= nmEnd; day = addDays(day, 1)) horizon.push(day);
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
};

export type UrgentWindow = { qty: number; from: string; to: string };

export type EffectiveSkuMonth = {
  plan_month: string;
  sku_material_id: string;
  base_source: "FINAL" | "ROLLING" | null;
  base_qty: number | null;
  additional_qty: number;
  urgent_extra: UrgentWindow[];
  urgent_from_plan: UrgentWindow[];
  effective_qty: number | null; // null = nothing entered (distinct from 0)
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
    const key = `${line.plan_month}|${line.sku_material_id}`;
    byKey.set(key, [...(byKey.get(key) ?? []), line]);
  }
  const result: EffectiveSkuMonth[] = [];
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
    result.push({
      plan_month,
      sku_material_id,
      base_source: baseSource,
      base_qty: baseQty === null ? null : roundQty(baseQty),
      additional_qty: roundQty(additional),
      urgent_extra: urgentExtra,
      urgent_from_plan: urgentFromPlan,
      effective_qty: anyDemand ? roundQty((baseQty ?? 0) + additional + extra) : null,
    });
  }
  return result;
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
};

export type ExplosionResult = {
  records: DemandRecord[];
  warnings: Warning[];
  exceptions: Warning[];
  prodshadeDaily: Map<string, Map<string, number>>; // prodshade → day → KG
  skuDailyKg: Map<string, Map<string, number>>;     // sku → day → KG
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

function activeMembers(input: ExplosionInput, groupId: string | null): string[] {
  if (!groupId) return [];
  return (input.groupMembers.get(groupId) ?? [])
    .filter((member) => member.active && input.materials.get(member.material_id)?.status !== "INACTIVE")
    .map((member) => member.material_id)
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
  const months = [input.calendar.cmStart, input.calendar.nmStart];
  const exceptionKeys = new Set<string>();
  const addException = (key: string, warning: Warning) => {
    if (exceptionKeys.has(key)) return;
    exceptionKeys.add(key);
    exceptions.push(warning);
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
  }

  // Prodshade day demand = Σ its SKUs, then Tab 2 period overrides per month.
  for (const [skuId, daily] of skuDailyKg) {
    const prodshadeId = input.skus.get(skuId)!.prodshade_material_id;
    const target = prodshadeDaily.get(prodshadeId) ?? new Map<string, number>();
    for (const [day, qty] of daily) target.set(day, (target.get(day) ?? 0) + qty);
    prodshadeDaily.set(prodshadeId, target);
  }
  for (const [prodshadeId, daily] of prodshadeDaily) {
    for (const month of months) {
      const periods = input.strokeSettings.get(`${month}|${prodshadeId}`) ?? [];
      const monthLast = monthEnd(month);
      const monthDaily = new Map([...daily].filter(([day]) => day >= month && day <= monthLast));
      applyPeriodOverrides(monthDaily, month, periods, prodshadeId, warnings);
      for (const day of [...daily.keys()]) if (day >= month && day <= monthLast) daily.delete(day);
      for (const [day, qty] of monthDaily) daily.set(day, qty);
    }
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
        const rmQty = (Number(line.dosage_pct) / 100) * qty;
        if (rmQty <= EPSILON) continue;
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
      for (const day of [...daily.keys()].sort()) {
        const kg = daily.get(day) ?? 0;
        const qty = (kg / kgPerOuter) * perOuterBase;
        if (qty <= EPSILON) continue;
        records.push({
          day,
          kind: "PM",
          pool_key: `PM|${bom.pack_bom_id}|${line.material_id}`,
          candidates: [line.material_id, ...members],
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
        });
      }
    }
  }

  records.sort((a, b) => a.day.localeCompare(b.day) || a.sort_key.localeCompare(b.sort_key));
  return { records, warnings, exceptions, prodshadeDaily, skuDailyKg };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Allocation of demand pools to individual materials (stock counted once)
// ─────────────────────────────────────────────────────────────────────────────
export type StockRow = { material_id: string; storage_location_id: string; stock_type_code: string; qty: number };
export type ReservationRow = { material_id: string; storage_location_id: string; qty: number };

export type MaterialStockPosition = {
  usable_at_required: number;      // UNRESTRICTED − open reservations, at required locations
  unrestricted_at_required: number;
  reserved_at_required: number;
  other_sloc_unrestricted: number; // transfer candidates; never usable at the required location
  quality_inspection: number;
  blocked: number;
  other_stock_types: number;       // IN_TRANSIT / FOR_REPROCESS / RESERVED stock types
  required_locations: string[];
  other_locations: string[];
};

export type AllocationResult = {
  /** material → day → demand attributed to that material (full horizon). */
  dailyByMaterial: Map<string, Map<string, number>>;
  /** material → day → part of that demand covered from usable stock at the required location. */
  fromStockByMaterial: Map<string, Map<string, number>>;
  /** pool traceability: pool → { candidates, demand, per material }. */
  pools: Map<string, { kind: "RM" | "PM"; candidates: string[]; group_id: string | null; use_primary: boolean | null; storage_location_id: string | null; total: number; byMaterial: Map<string, number>; prodshades: Set<string>; skus: Set<string>; strokes: Set<string>; pack_boms: Set<string>; outer_qty: number; outer_uom_code: string | null; fill_qty_per_outer: number | null }>;
  stock: Map<string, MaterialStockPosition>;
};

function bump(map: Map<string, Map<string, number>>, material: string, day: string, qty: number) {
  const inner = map.get(material) ?? new Map<string, number>();
  inner.set(day, (inner.get(day) ?? 0) + qty);
  map.set(material, inner);
}

/**
 * Same "count once" rule production uses (computeMtsAutoDeriveRowsForGroup,
 * process_order.handlers.ts): per pool, draw from the procurement target's own
 * usable stock first, then the other candidates smallest-available-first, and
 * subtract what was drawn from the shared pool before the next pool. Days are
 * processed chronologically from the as-of date. Whatever stock cannot cover
 * is attributed once to the pool's procurement target (candidates[0]). Days
 * before the as-of date are already consumed and attributed to the target.
 */
export function allocateDemand(
  records: DemandRecord[],
  calendar: PlanningCalendar,
  stockRows: StockRow[],
  reservations: ReservationRow[],
  applyReservations: boolean,
): AllocationResult {
  const usable = new Map<string, number>(); // `${material}|${sloc}` → remaining usable
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
        quality_inspection: 0, blocked: 0, other_stock_types: 0,
        required_locations: [...(requiredLocations.get(material) ?? [])].sort(), other_locations: [],
      };
      stock.set(material, pos);
    }
    return pos;
  };
  const otherLocations = new Map<string, Set<string>>();
  for (const row of stockRows) {
    const qty = Number(row.qty);
    if (Math.abs(qty) <= EPSILON) continue;
    const pos = position(row.material_id);
    const isRequired = (requiredLocations.get(row.material_id) ?? new Set()).has(row.storage_location_id);
    if (row.stock_type_code === "UNRESTRICTED") {
      if (isRequired) {
        pos.unrestricted_at_required += qty;
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
  // Usable pool per required location.
  const unrestrictedByKey = new Map<string, number>();
  for (const row of stockRows) {
    if (row.stock_type_code !== "UNRESTRICTED") continue;
    const key = `${row.material_id}|${row.storage_location_id}`;
    unrestrictedByKey.set(key, (unrestrictedByKey.get(key) ?? 0) + Number(row.qty));
  }
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

  const dailyByMaterial = new Map<string, Map<string, number>>();
  const fromStockByMaterial = new Map<string, Map<string, number>>();
  const pools: AllocationResult["pools"] = new Map();
  // DEPENDENT ordering: each pool draws from the stock left by the pools before it.
  for (const record of records) {
    const pool = pools.get(record.pool_key) ?? {
      kind: record.kind, candidates: record.candidates, group_id: record.group_id, use_primary: record.use_primary,
      storage_location_id: record.storage_location_id, total: 0, byMaterial: new Map<string, number>(),
      prodshades: new Set<string>(), skus: new Set<string>(), strokes: new Set<string>(), pack_boms: new Set<string>(),
      outer_qty: 0, outer_uom_code: record.outer_uom_code, fill_qty_per_outer: record.fill_qty_per_outer,
    };
    pool.total += record.qty;
    pool.outer_qty += record.outer_qty ?? 0;
    pool.prodshades.add(record.prodshade_material_id);
    if (record.sku_material_id) pool.skus.add(record.sku_material_id);
    if (record.stroke_master_id) pool.strokes.add(record.stroke_master_id);
    if (record.pack_bom_id) pool.pack_boms.add(record.pack_bom_id);
    pools.set(record.pool_key, pool);
    const target = record.candidates[0];
    const attribute = (material: string, qty: number, fromStock: boolean) => {
      bump(dailyByMaterial, material, record.day, qty);
      if (fromStock) bump(fromStockByMaterial, material, record.day, qty);
      pool.byMaterial.set(material, (pool.byMaterial.get(material) ?? 0) + qty);
    };
    if (record.day < calendar.asOf || !record.storage_location_id) {
      attribute(target, record.qty, false);
      continue;
    }
    const keyOf = (material: string) => `${material}|${record.storage_location_id}`;
    const ordered = [
      target,
      ...record.candidates.slice(1).sort((a, b) =>
        (usable.get(keyOf(a)) ?? 0) - (usable.get(keyOf(b)) ?? 0) || a.localeCompare(b)),
    ];
    let remaining = record.qty;
    for (const material of ordered) {
      if (remaining <= EPSILON) break;
      const available = usable.get(keyOf(material)) ?? 0;
      if (available <= EPSILON) continue;
      const draw = Math.min(available, remaining);
      usable.set(keyOf(material), available - draw);
      attribute(material, draw, true);
      remaining -= draw;
    }
    if (remaining > EPSILON) attribute(target, remaining, false);
  }
  return { dailyByMaterial, fromStockByMaterial, pools, stock };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Inbound supply: one dated event per physical unit (owner Q-T06)
// ─────────────────────────────────────────────────────────────────────────────
export type InboundKind = "AT_GATE" | "IN_TRANSIT" | "SCHEDULED_LOT" | "PO_REMAINDER" | "STO_IN_TRANSIT";
export type InboundEvent = {
  material_id: string;
  qty: number;               // material base unit
  date: string | null;       // ETA to plant; null = UNKNOWN
  kind: InboundKind;
  date_source: string;       // e.g. CSN_ETA_TO_PLANT, LOT_DELIVERY_DATE, PO_EXPECTED_DELIVERY, GATE_ENTRY, NONE
  reference: string;         // human document reference (PO / CSN / GE / lot numbers)
};

export type PoLineInboundInput = {
  material_id: string;
  po_number: string;
  line_number: number;
  open_qty: number;              // PO unit (open = ordered − GRN posted)
  base_per_po_unit: number | null; // ordered_qty_base_uom / ordered_qty
  expected_delivery_date: string | null;
  at_gate: Array<{ qty_base: number; reference: string; date: string | null }>; // GE lines not yet GRN-posted
  csns: Array<{ csn_number: string; status: string; dispatch_qty: number | null; received_qty: number | null; eta: string | null; is_mother_with_children: boolean }>;
  lots: Array<{ lot_number: string; balance_qty: number; delivery_date: string | null }>; // PO unit
};

const CSN_CLOSED = new Set(["GRD", "GED", "KOF", "CAN"]);

/**
 * Partitions one open PO line's remaining quantity into mutually exclusive
 * dated pieces, in this order, each capped by what is still unallocated:
 *   1. arrived at gate, GRN not yet posted (dated the as-of day)
 *   2. dispatched CSNs (TRN / ORD with a dispatch qty) at their ETA to plant
 *   3. PO lot balances at their delivery date
 *   4. remainder at the earliest ETA of a not-yet-dispatched CSN, else the PO
 *      expected delivery date, else UNKNOWN.
 * The PO line is the ceiling; CSN po_qty is never summed; a mother CSN that
 * has sub-CSNs is skipped (its children carry the quantity).
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
      });
    }
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
  byDay: Map<string, number>; // dated events inside the horizon (as-of .. NM end)
};

export function bucketInbound(events: InboundEvent[], calendar: PlanningCalendar): InboundBuckets {
  const buckets: InboundBuckets = { overdue: 0, cm: 0, nm: 0, later: 0, unknown: 0, total: 0, byDay: new Map() };
  for (const event of events) {
    buckets.total += event.qty;
    if (!event.date) { buckets.unknown += event.qty; continue; }
    if (event.date < calendar.asOf) { buckets.overdue += event.qty; continue; }
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
export type ConfiguredLeadTime = { vendor_label: string; route: "DOMESTIC" | "IMPORT"; days: number; detail: string };
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
  effective_source: "LEGACY_MAX_PLUS_4" | "CONFIGURED_MAX_TRANSIT" | "UNKNOWN";
};

export const LEGACY_LEAD_TIME_BUFFER_DAYS = 4;

function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return round2(sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower));
}

/**
 * Effective lead time used for coverage, in this precedence (documented):
 *   1. observed history: max observed + 4 days (keeps the legacy sheet rule,
 *      now explicitly labelled as a maximum, not an average);
 *   2. configured vendor transit master (largest route, transit only — the
 *      masters hold no vendor processing time);
 *   3. UNKNOWN (never zero).
 */
export function computeLeadTime(configured: ConfiguredLeadTime[], observedDays: number[]): LeadTimeResult {
  const valid = observedDays.filter((d) => Number.isFinite(d) && d >= 0).sort((a, b) => a - b);
  const configuredDays = configured.map((c) => c.days).filter((d) => Number.isFinite(d) && d >= 0);
  const observedMax = valid.length ? valid[valid.length - 1] : null;
  const legacy = observedMax === null ? null : observedMax + LEGACY_LEAD_TIME_BUFFER_DAYS;
  const configuredMax = configuredDays.length ? Math.max(...configuredDays) : null;
  const effective = legacy ?? configuredMax;
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
    effective_source: legacy !== null ? "LEGACY_MAX_PLUS_4" : configuredMax !== null ? "CONFIGURED_MAX_TRANSIT" : "UNKNOWN",
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
  for (let day = calendar.asOf; day <= calendar.nmEnd; day = addDays(day, 1)) {
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
};

export type MetricsInput = {
  calendar: PlanningCalendar;
  demandByDay: Map<string, number>;
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
  if (policy.critical_cov_days !== null && cover < policy.critical_cov_days) return "CRITICAL";
  if (cover < policy.target_cov_days) return "BELOW_TARGET";
  return "OK";
}

export function computeMaterialMetrics(input: MetricsInput): MaterialMetrics {
  const { calendar, demandByDay, inbound, policy } = input;
  const cmReq = sumRange(demandByDay, calendar.cmStart, calendar.cmEnd);
  const cmProrata = sumRange(demandByDay, calendar.asOf, calendar.cmEnd);
  const nmReq = sumRange(demandByDay, calendar.nmStart, calendar.nmEnd);
  const nmDaily = calendar.nmDaysInMonth > 0 ? nmReq / calendar.nmDaysInMonth : 0;
  const forwardDays = calendar.cmDaysLeft + calendar.nmDaysInMonth;
  const avgDaily = forwardDays > 0 ? (cmProrata + nmReq) / forwardDays : 0;
  const hasDemand = cmProrata + nmReq > EPSILON;

  const cmInbound = new Map([...inbound.byDay].filter(([day]) => day <= calendar.cmEnd));
  const stockOnly = coverageDays(input.stock, calendar, demandByDay, null, nmDaily);
  const withCm = coverageDays(input.stock, calendar, demandByDay, cmInbound, nmDaily);
  const withAll = coverageDays(input.stock, calendar, demandByDay, inbound.byDay, nmDaily);

  const currentBalance = input.stock - cmProrata;
  const nmOpening = currentBalance + inbound.cm;
  const nmClosing = nmOpening + inbound.nm - nmReq;
  const statusNm: MaterialMetrics["status_nm"] = nmReq <= EPSILON && cmProrata <= EPSILON
    ? "NO_DEMAND"
    : nmClosing >= -EPSILON ? "COVERED" : nmOpening >= -EPSILON ? "SHORT_IN_NM" : "SHORT_BEFORE_NM";

  const target = policy?.target_cov_days ?? null;
  const critical = policy?.critical_cov_days ?? null;
  const below = (cover: number | null, threshold: number | null) =>
    threshold === null || !hasDemand ? null : (cover ?? Number.POSITIVE_INFINITY) < threshold;

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

  const inboundRisk: MaterialMetrics["inbound_risk"] = inbound.total <= EPSILON
    ? "NONE"
    : inbound.overdue > EPSILON ? "OVERDUE" : inbound.unknown > EPSILON ? "ETA_UNKNOWN" : "ON_TIME";

  const r = roundQty;
  return {
    cm_days_in_month: calendar.cmDaysInMonth,
    cm_days_left: calendar.cmDaysLeft,
    nm_days_in_month: calendar.nmDaysInMonth,
    cm_req: r(cmReq),
    cm_prorata: r(cmProrata),
    cm_cons: r(input.consumption),
    cm_balance_req: r(Math.max(0, cmReq - input.consumption)),
    nm_req: r(nmReq),
    nm_prorata: r(nmReq),
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
    below_target: below(stockOnly.days, target),
    below_critical: below(stockOnly.days, critical),
    below_target_with_in: below(withAll.days, target),
    below_critical_with_in: below(withAll.days, critical),
    nm_req_days: nmReqDays,
    next_month_req: nextMonthReq === null ? null : r(nextMonthReq),
    total_req: totalReq === null ? null : r(totalReq),
    total_prorata: totalProrata === null ? null : r(totalProrata),
    avg_daily_req: r(avgDaily),
    safety_day_stock: critical === null ? null : r(critical * avgDaily),
    lead_time_stock: input.leadTimeDays === null ? null : r(input.leadTimeDays * avgDaily),
    total_stock_level: critical === null || input.leadTimeDays === null ? null : r((critical + input.leadTimeDays) * avgDaily),
    net_req: netReq === null ? null : r(netReq),
    moq_base_qty: input.moqBaseQty === null ? null : r(input.moqBaseQty),
    net_req_moq: netReqMoq === null ? null : r(netReqMoq),
    identifier: classify(stockOnly.days, hasDemand, policy),
    id2: classify(withAll.days, hasDemand, policy),
    inbound_risk: inboundRisk,
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
  /** Every RM/PM material of the company's MTS strokes / Pack BOMs (shown even with zero demand). */
  materialUniverse: string[];
};

export type RequirementOutput = {
  rows: RequirementRow[];
  warnings: Warning[];
  exceptions: Warning[];
  effective: EffectiveSkuMonth[];
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
  const allocation = allocateDemand(explosion.records, input.calendar, input.stockRows, input.reservations, input.applyReservations);
  const warnings = [...explosion.warnings];
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

  const materialIds = [...new Set([
    ...input.materialUniverse,
    ...allocation.dailyByMaterial.keys(),
    ...poolsByMaterial.keys(),
  ])].sort();
  const emptyStock = (): MaterialStockPosition => ({
    usable_at_required: 0, unrestricted_at_required: 0, reserved_at_required: 0, other_sloc_unrestricted: 0,
    quality_inspection: 0, blocked: 0, other_stock_types: 0, required_locations: [], other_locations: [],
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
        quality_inspection: roundQty(stock.quality_inspection),
        blocked: roundQty(stock.blocked),
        other_stock_types: roundQty(stock.other_stock_types),
      },
      inbound: {
        overdue: roundQty(bucketTotals.overdue), cm: roundQty(bucketTotals.cm), nm: roundQty(bucketTotals.nm),
        later: roundQty(bucketTotals.later), unknown: roundQty(bucketTotals.unknown), total: roundQty(bucketTotals.total),
      },
      inbound_events: events.map((event) => ({ ...event, qty: roundQty(event.qty) })),
      pools: (poolsByMaterial.get(materialId) ?? []).sort((a, b) => a.pool_key.localeCompare(b.pool_key)),
      lead_time: leadTime,
      policy,
      from_stock_qty: roundQty(fromStock),
    };
  });
  return { rows, warnings, exceptions: explosion.exceptions, effective };
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
