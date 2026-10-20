/* PO22 P1 — item / family plan (owner 2026-10-20).
 * Design: docs/mts-planning/PO22-P1-FAMILY-PLANNING-DETAIL-2026-10-20.md
 * Pure functions only: family closure, beyond-plan forecast, family day grid.
 */
import { addDays, nextMonth, type GroupMember, type PlanLineVersion } from "./mts_requirement.logic.ts";

const EPSILON = 0.000001;
const round = (value: number) => Math.round(value * 1e6) / 1e6;

// ─────────────────────────────────────────────────────────────────────────────
// Family: closure over material ↔ group membership (owner: all members, their
// exclusive demand and their other groups are included).
// ─────────────────────────────────────────────────────────────────────────────
export type ItemFamily = { member_ids: string[]; group_ids: string[]; is_family: boolean };

export function familyClosure(materialId: string, groupMembers: ReadonlyMap<string, readonly GroupMember[]>): ItemFamily {
  const membersOf = new Map<string, string[]>();
  const groupsOf = new Map<string, string[]>();
  for (const [groupId, members] of groupMembers) {
    for (const member of members) {
      if (!member.active) continue;
      membersOf.set(groupId, [...(membersOf.get(groupId) ?? []), member.material_id]);
      groupsOf.set(member.material_id, [...(groupsOf.get(member.material_id) ?? []), groupId]);
    }
  }
  const materials = new Set<string>([materialId]);
  const groups = new Set<string>();
  const queue = [materialId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const groupId of groupsOf.get(current) ?? []) {
      if (groups.has(groupId)) continue;
      groups.add(groupId);
      for (const member of membersOf.get(groupId) ?? []) {
        if (!materials.has(member)) { materials.add(member); queue.push(member); }
      }
    }
  }
  return { member_ids: [...materials].sort(), group_ids: [...groups].sort(), is_family: groups.size > 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Forecast for months PO21 has no plan for (owner 2026-10-20, §4 of the P1 design):
//   S  = same month last year(s) actual dispatch (avg of covered years)
//   T  = last 3 complete months' dispatch ÷ the same 3 months a year earlier, capped 0.7 – 1.3
//   P3 = average of the last 3 complete months' effective PO21 plan
//   Forecast = ½ × S × T + ½ × P3;  S missing → avg(P3, last-3 actual);  P3 missing → S × T.
// Quantities in KG. A month not covered by actuals is "no data" (null), never 0.
// ─────────────────────────────────────────────────────────────────────────────
export const FORECAST_TREND_MIN = 0.7;
export const FORECAST_TREND_MAX = 1.3;

export type ForecastInputs = {
  /** `${sku}|${YYYY-MM-01}` → dispatched KG; only covered months are present (0 allowed). */
  dispatchKg: ReadonlyMap<string, number>;
  /** Months for which dispatch actuals are covered (a missing key inside them = 0). */
  coveredMonths: ReadonlySet<string>;
  /** `${sku}|${month}` → effective PO21 plan KG for the 3 reference months. */
  planKg: ReadonlyMap<string, number>;
  /** Months that have any PO21 plan at all (company-level). */
  plannedMonths: ReadonlySet<string>;
};

export type SkuForecast = {
  sku_material_id: string;
  month: string;
  qty_kg: number;
  basis: "SEASONAL_AND_PLAN" | "PLAN_AND_ACTUAL" | "PLAN_ONLY" | "SEASONAL_ONLY" | "ACTUAL_ONLY";
  seasonal_kg: number | null;
  trend: number | null;
  plan_avg_kg: number | null;
  actual_avg_kg: number | null;
};

const shiftMonths = (month: string, delta: number) => {
  const y = Number(month.slice(0, 4)); const m = Number(month.slice(5, 7)) - 1 + delta;
  const year = y + Math.floor(m / 12); const mm = ((m % 12) + 12) % 12 + 1;
  return `${year}-${String(mm).padStart(2, "0")}-01`;
};

function avgDefined(values: Array<number | null>): number | null {
  const list = values.filter((v): v is number => v !== null);
  return list.length === 0 ? null : list.reduce((s, v) => s + v, 0) / list.length;
}

/** Last 3 complete months before the as-of month. */
export function referenceMonths(asOfMonth: string): string[] {
  return [shiftMonths(asOfMonth, -3), shiftMonths(asOfMonth, -2), shiftMonths(asOfMonth, -1)];
}

export function forecastSkuMonth(sku: string, month: string, asOfMonth: string, inputs: ForecastInputs): SkuForecast | null {
  const actual = (m: string) => (inputs.coveredMonths.has(m) ? inputs.dispatchKg.get(`${sku}|${m}`) ?? 0 : null);
  const seasonal = avgDefined([actual(shiftMonths(month, -12)), actual(shiftMonths(month, -24))]);
  const refs = referenceMonths(asOfMonth);
  const actualAvg = avgDefined(refs.map(actual));
  const lastYearAvg = avgDefined(refs.map((m) => actual(shiftMonths(m, -12))));
  const trend = actualAvg !== null && lastYearAvg !== null && lastYearAvg > EPSILON
    ? Math.min(FORECAST_TREND_MAX, Math.max(FORECAST_TREND_MIN, actualAvg / lastYearAvg)) : null;
  const planned = refs.filter((m) => inputs.plannedMonths.has(m));
  const planAvg = planned.length === 0 ? null : planned.reduce((s, m) => s + (inputs.planKg.get(`${sku}|${m}`) ?? 0), 0) / planned.length;
  const seasonalAdj = seasonal === null ? null : seasonal * (trend ?? 1);
  let qty: number; let basis: SkuForecast["basis"];
  if (seasonalAdj !== null && planAvg !== null) { qty = 0.5 * seasonalAdj + 0.5 * planAvg; basis = "SEASONAL_AND_PLAN"; }
  else if (planAvg !== null && actualAvg !== null) { qty = 0.5 * planAvg + 0.5 * actualAvg; basis = "PLAN_AND_ACTUAL"; }
  else if (planAvg !== null) { qty = planAvg; basis = "PLAN_ONLY"; }
  else if (seasonalAdj !== null) { qty = seasonalAdj; basis = "SEASONAL_ONLY"; }
  else if (actualAvg !== null) { qty = actualAvg; basis = "ACTUAL_ONLY"; }
  else return null;
  return {
    sku_material_id: sku, month, qty_kg: round(Math.max(0, qty)), basis,
    seasonal_kg: seasonal === null ? null : round(seasonal), trend: trend === null ? null : round(trend),
    plan_avg_kg: planAvg === null ? null : round(planAvg), actual_avg_kg: actualAvg === null ? null : round(actualAvg),
  };
}

/**
 * Forecast plan lines for every horizon month without any PO21 plan. They enter the normal
 * explosion as ROLLING lines (spread evenly over the month), tagged FORECAST|… so they are never
 * mistaken for a real plan. kgPerBase converts KG back to the SKU base unit.
 */
export function buildForecastPlanLines(
  skuIds: readonly string[], horizonMonths: readonly string[], asOfMonth: string, inputs: ForecastInputs,
  kgPerBase: (sku: string) => number | null,
): { lines: PlanLineVersion[]; forecasts: SkuForecast[]; forecastMonths: string[] } {
  const forecastMonths = horizonMonths.filter((m) => !inputs.plannedMonths.has(m));
  const lines: PlanLineVersion[] = []; const forecasts: SkuForecast[] = [];
  for (const month of forecastMonths) {
    for (const sku of [...skuIds].sort()) {
      const forecast = forecastSkuMonth(sku, month, asOfMonth, inputs);
      const factor = kgPerBase(sku);
      if (!forecast || !(forecast.qty_kg > EPSILON) || !factor || !(factor > 0)) continue;
      forecasts.push(forecast);
      lines.push({
        entry_id: `FORECAST|${sku}|${month}`, version_no: 1, plan_month: month, plan_type: "ROLLING",
        urgent_mode: null, urgent_from_date: null, urgent_to_date: null, sku_material_id: sku,
        base_qty: round(forecast.qty_kg / factor), is_cancelled: false, created_at: "1970-01-01T00:00:00Z",
      });
    }
  }
  return { lines, forecasts, forecastMonths };
}

// ─────────────────────────────────────────────────────────────────────────────
// Family day grid (sheet PLANNING tab equivalent).
// ─────────────────────────────────────────────────────────────────────────────
export type MemberDayRow = {
  material_id: string; day: string; opening_qty_base: number; confirmed_arrival_qty_base: number;
  planned_lot_qty_base: number; demand_qty_base: number; group_draw_qty_base: number; closing_qty_base: number;
};

export type FamilyDayRow = {
  day: string; opening: number; arrivals: number; planned_lot: number; use: number;
  /** Group demand no member could meet that day (a shortage). */
  unmet_group: number; closing: number; max_days: number | null; min_stock: number; min_days: number | null;
};

/** Whole + fractional days `balance` covers from `fromIndex`, walking the coming days' use (owner: forward). */
export function forwardCoverDays(balance: number, uses: readonly number[], fromIndex: number): number | null {
  const tail = uses.slice(fromIndex);
  const total = tail.reduce((s, u) => s + u, 0);
  if (!(total > EPSILON)) return null;
  let left = balance; let days = 0;
  if (left <= EPSILON) return 0;
  for (const use of tail) {
    if (use <= EPSILON) { days += 1; continue; }
    if (left >= use) { left -= use; days += 1; continue; }
    return Math.round((days + left / use) * 100) / 100;
  }
  const avg = total / tail.length; // beyond the horizon: average daily use
  return Math.round((days + left / avg) * 100) / 100;
}

export function familyDayGrid(
  days: readonly string[], memberRows: readonly MemberDayRow[], unmetGroupByDay: ReadonlyMap<string, number>,
): FamilyDayRow[] {
  const byDay = new Map<string, MemberDayRow[]>();
  for (const row of memberRows) byDay.set(row.day, [...(byDay.get(row.day) ?? []), row]);
  const sums = days.map((day) => {
    const rows = byDay.get(day) ?? [];
    const sum = (f: (r: MemberDayRow) => number) => rows.reduce((s, r) => s + f(r), 0);
    return {
      day, opening: sum((r) => r.opening_qty_base), arrivals: sum((r) => r.confirmed_arrival_qty_base),
      planned_lot: sum((r) => r.planned_lot_qty_base), memberUse: sum((r) => r.demand_qty_base),
      unmet: unmetGroupByDay.get(day) ?? 0,
    };
  });
  const uses = sums.map((s) => s.memberUse + s.unmet);
  let carriedShort = 0;
  return sums.map((s, index) => {
    const opening = s.opening - carriedShort;
    const closing = opening + s.arrivals + s.planned_lot - uses[index];
    carriedShort += s.unmet;
    const minStock = opening - uses[index];
    return {
      day: s.day, opening: round(opening), arrivals: round(s.arrivals), planned_lot: round(s.planned_lot),
      use: round(uses[index]), unmet_group: round(s.unmet), closing: round(closing),
      max_days: forwardCoverDays(closing, uses, index + 1), min_stock: round(minStock),
      min_days: forwardCoverDays(minStock, uses, index + 1),
    };
  });
}

/** Every day from `from` to `to` inclusive. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(day);
  return out;
}

/** Months from `first` for `count` months. */
export function monthRange(first: string, count: number): string[] {
  const out = [first];
  while (out.length < count) out.push(nextMonth(out[out.length - 1]));
  return out;
}

export type ArrivalStatus = "AT_GATE" | "IN_TRANSIT" | "ORDERED" | "BULK" | "STO" | "SUB_CSN";

export function arrivalStatus(kind: string, dateSource: string): ArrivalStatus {
  if (kind === "AT_GATE") return "AT_GATE";
  if (kind === "IN_TRANSIT") return "IN_TRANSIT";
  if (kind === "STO_IN_TRANSIT") return "STO";
  if (kind === "SUB_CSN_PLANNED") return "SUB_CSN";
  if (dateSource === "BULK_CALL_OFF") return "BULK";
  return "ORDERED";
}
