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
export const wholeDays = (days: number | null) => (days === null ? null : Math.floor(days + 1e-9));

export function forwardCoverDays(balance: number, uses: readonly number[], fromIndex: number): number | null {
  const tail = uses.slice(fromIndex);
  const total = tail.reduce((s, u) => s + u, 0);
  if (!(total > EPSILON)) return null;
  let left = balance; let days = 0;
  if (left <= EPSILON) return 0;
  for (const use of tail) {
    // A calendar day with no use only extends cover while stock remains.  Without
    // this guard an exact depletion followed by zero-demand days was reported as
    // dozens of extra days of stock (the TOT White 24-Dec jump).
    if (use <= EPSILON) {
      if (left <= EPSILON) return days;
      days += 1;
      continue;
    }
    if (left + EPSILON >= use) { left = Math.max(0, left - use); days += 1; continue; }
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
      // Whole days, rounded down (sheet ROUNDDOWN): 49.7 days of stock is 49 full days.
      max_days: wholeDays(forwardCoverDays(closing, uses, index + 1)), min_stock: round(minStock),
      min_days: wholeDays(forwardCoverDays(minStock, uses, index + 1)),
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

export type ArrivalStatus = "ACTUAL_GR" | "AT_GATE" | "IN_TRANSIT" | "ORDERED" | "BULK" | "STO" | "SUB_CSN";

export function arrivalStatus(kind: string, dateSource: string): ArrivalStatus {
  if (kind === "POSTED_GR") return "ACTUAL_GR";
  if (kind === "AT_GATE") return "AT_GATE";
  if (kind === "IN_TRANSIT") return "IN_TRANSIT";
  if (kind === "STO_IN_TRANSIT") return "STO";
  if (kind === "SUB_CSN_PLANNED") return "SUB_CSN";
  if (dateSource === "BULK_CALL_OFF") return "BULK";
  return "ORDERED";
}

// ─────────────────────────────────────────────────────────────────────────────
// P2 — reschedule advice for not-yet-shipped arrivals (owner 2026-10-20).
// The ideal plant date of an arrival = the first day this member's cover, WITHOUT that arrival,
// falls to its Target. Earlier than the ETA → advance; much later → postpone (money not tied up).
// Advice only: the planner may store a rescheduled ETA; CSN Tracker is changed by the user.
// ─────────────────────────────────────────────────────────────────────────────
/** PO number of an arrival reference "PO <po_number>/<line> · …" (null for STO / Sub-CSN pieces). */
export function poNumberOfReference(reference: string): string | null {
  const m = /^PO (.+?)\/\d+(?:\s|$|\s·|\s\()/.exec(`${reference} `);
  return m ? m[1] : null;
}

export type MemberProjectionDay = { day: string; closing: number; use: number; target_days: number | null };

export const RESCHEDULE_TOLERANCE_DAYS = 3;

export function rescheduleAdvice(rows: readonly MemberProjectionDay[], eta: string | null, qty: number): { suggested_eta: string; shift_days: number; reason: string } | null {
  if (!eta || rows.length === 0 || !(qty > EPSILON)) return null;
  const uses = rows.map((r) => r.use);
  let ideal: string | null = null;
  for (let i = 0; i < rows.length; i += 1) {
    const target = rows[i].target_days;
    if (target === null) continue;
    const without = rows[i].closing - (rows[i].day >= eta ? qty : 0);
    const cover = forwardCoverDays(without, uses, i + 1);
    if (cover !== null && cover <= target) { ideal = rows[i].day; break; }
  }
  if (ideal === null) {
    const last = rows[rows.length - 1].day;
    if (last <= eta) return null;
    const shift = Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${eta}T00:00:00Z`)) / 86_400_000);
    return shift > RESCHEDULE_TOLERANCE_DAYS ? { suggested_eta: last, shift_days: shift, reason: "Not needed within the horizon — postpone to free working capital." } : null;
  }
  const shift = Math.round((Date.parse(`${ideal}T00:00:00Z`) - Date.parse(`${eta}T00:00:00Z`)) / 86_400_000);
  if (Math.abs(shift) <= RESCHEDULE_TOLERANCE_DAYS) return null;
  return shift < 0
    ? { suggested_eta: ideal, shift_days: shift, reason: `Without it, cover falls to Target on ${ideal} — advance ${-shift} days.` }
    : { suggested_eta: ideal, shift_days: shift, reason: `Not needed before ${ideal} — postpone ${shift} days to free working capital.` };
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner 2026-10-21: the best date for one not-yet-shipped arrival, tried on EVERY day of the
// horizon (not a rule of thumb). Moving one piece only changes the closing between the old and the
// new date, and a day's cover depends only on its own closing, so each day is scored once with and
// once without the piece and every candidate date is then O(1) from prefix sums.
// Order of preference: fewest stock-out days → fewest days below Critical → fewest days below
// Target → latest date (least money held). Other arrivals and lots stay where they are; group
// re-allocation and the engine's own new lots are not re-planned here (Preview does that).
// ─────────────────────────────────────────────────────────────────────────────
export type ArrivalDay = MemberProjectionDay & { critical_days?: number | null };
export type ArrivalScore = {
  eta: string;
  /** Cover on the arrival day without / with the piece (sheet Min Days / Max Days). */
  min_days: number | null;
  max_days: number | null;
  shortage_days: number;
  days_below_critical: number;
  days_below_target: number;
  first_below_target_day: string | null;
};
export type ArrivalOptimum = { current: ArrivalScore; best: ArrivalScore; shift_days: number; reason: string } | null;

export function optimizeArrivalDate(rows: readonly ArrivalDay[], eta: string | null, qty: number): ArrivalOptimum {
  if (!eta || rows.length === 0 || !(qty > EPSILON)) return null;
  const n = rows.length;
  const uses = rows.map((r) => r.use);
  // Closing without this piece; the piece counts from its own day onwards.
  const base = rows.map((r) => r.closing - (r.day >= eta ? qty : 0));
  const coverBase = base.map((b, i) => forwardCoverDays(b, uses, i + 1));
  const coverPlus = base.map((b, i) => forwardCoverDays(b + qty, uses, i + 1));
  const flags = (closing: number, cover: number | null, row: ArrivalDay) => ({
    short: closing < -EPSILON ? 1 : 0,
    critical: row.critical_days !== null && row.critical_days !== undefined && cover !== null && cover < row.critical_days ? 1 : 0,
    target: row.target_days !== null && cover !== null && cover < row.target_days ? 1 : 0,
  });
  const without = rows.map((r, i) => flags(base[i], coverBase[i], r));
  const withIt = rows.map((r, i) => flags(base[i] + qty, coverPlus[i], r));
  // pre[k] = Σ over days < k without the piece; suf[k] = Σ over days ≥ k with it.
  const pre = [{ short: 0, critical: 0, target: 0 }];
  for (let i = 0; i < n; i += 1) pre.push({ short: pre[i].short + without[i].short, critical: pre[i].critical + without[i].critical, target: pre[i].target + without[i].target });
  const suf = Array.from({ length: n + 1 }, () => ({ short: 0, critical: 0, target: 0 }));
  for (let i = n - 1; i >= 0; i -= 1) suf[i] = { short: suf[i + 1].short + withIt[i].short, critical: suf[i + 1].critical + withIt[i].critical, target: suf[i + 1].target + withIt[i].target };
  const firstBelow = (k: number) => {
    for (let i = 0; i < n; i += 1) if ((i < k ? without[i] : withIt[i]).target || (i === k && without[i].target)) return rows[i].day;
    return null;
  };
  // On the arrival day itself the stock before the piece (Min days) must also hold the line.
  const arrivalDayExtra = (k: number, field: "short" | "critical" | "target") => (k < n ? Math.max(0, without[k][field] - withIt[k][field]) : 0);
  const key = (k: number) => (["short", "critical", "target"] as const).map((f) => pre[k][f] + suf[k][f] + arrivalDayExtra(k, f));
  const score = (k: number): ArrivalScore => {
    const [shortage, critical, target] = key(k);
    return {
      eta: k < n ? rows[k].day : eta,
      min_days: k < n ? wholeDays(coverBase[k]) : null,
      max_days: k < n ? wholeDays(coverPlus[k]) : null,
      shortage_days: shortage, days_below_critical: critical, days_below_target: target,
      first_below_target_day: firstBelow(k),
    };
  };
  const currentIndex = rows.findIndex((r) => r.day >= eta);
  const current = score(currentIndex === -1 ? n : currentIndex);
  let bestIndex = 0;
  for (let k = 1; k < n; k += 1) {
    const a = key(k); const b = key(bestIndex);
    if (a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] <= b[2])))) bestIndex = k; // ties → later day
  }
  const best = score(bestIndex);
  const worseOrSame = (x: ArrivalScore, y: ArrivalScore) =>
    x.shortage_days > y.shortage_days || (x.shortage_days === y.shortage_days && (x.days_below_critical > y.days_below_critical || (x.days_below_critical === y.days_below_critical && x.days_below_target >= y.days_below_target)));
  // Keep the current date when it is already as safe and within the tolerance, or strictly safer.
  const shift = Math.round((Date.parse(`${best.eta}T00:00:00Z`) - Date.parse(`${eta}T00:00:00Z`)) / 86_400_000);
  if (!worseOrSame(current, best)) return { current, best: current, shift_days: 0, reason: "Current date is already the best." };
  const sameRisk = current.shortage_days === best.shortage_days && current.days_below_critical === best.days_below_critical && current.days_below_target === best.days_below_target;
  // Prepone only when it is strictly safer; small moves are not worth a vendor call.
  if (sameRisk && (shift < 0 || Math.abs(shift) <= RESCHEDULE_TOLERANCE_DAYS)) return { current, best: current, shift_days: 0, reason: "Current date is fine." };
  const gain = [
    current.shortage_days !== best.shortage_days ? `stock-out days ${current.shortage_days} → ${best.shortage_days}` : "",
    current.days_below_critical !== best.days_below_critical ? `days below Critical ${current.days_below_critical} → ${best.days_below_critical}` : "",
    current.days_below_target !== best.days_below_target ? `days below Target ${current.days_below_target} → ${best.days_below_target}` : "",
  ].filter(Boolean).join(", ");
  const reason = shift < 0
    ? `Prepone ${-shift} d to ${best.eta}: ${gain || "safer"}. Vendor must be able to deliver by then.`
    : sameRisk
      ? `Postpone ${shift} d to ${best.eta}: same safety, less money held${bestIndex === n - 1 ? " (not needed within the horizon)" : ""}.`
      : `Postpone ${shift} d to ${best.eta}: ${gain}.`;
  return { current, best, shift_days: shift, reason };
}

/**
 * Several movable pieces of one material: optimised one after another (earliest first), each
 * seeing the earlier ones already at their best date, so two pieces never "fix" the same gap.
 * `current` is always the piece's own date in today's plan.
 */
export function optimizeArrivalSet(
  rows: readonly ArrivalDay[], pieces: ReadonlyArray<{ key: string; eta: string | null; qty: number }>,
): Map<string, ArrivalOptimum> {
  const result = new Map<string, ArrivalOptimum>();
  let working = rows.map((r) => ({ ...r }));
  for (const piece of [...pieces].sort((a, b) => String(a.eta ?? "9999").localeCompare(String(b.eta ?? "9999")) || a.key.localeCompare(b.key))) {
    const own = optimizeArrivalDate(rows, piece.eta, piece.qty);
    const seq = optimizeArrivalDate(working, piece.eta, piece.qty);
    if (!own || !seq) { result.set(piece.key, null); continue; }
    result.set(piece.key, { ...seq, current: own.current });
    if (seq.shift_days !== 0 && piece.eta) {
      const from = piece.eta; const to = seq.best.eta;
      working = working.map((r) => ({ ...r, closing: r.closing - (r.day >= from ? piece.qty : 0) + (r.day >= to ? piece.qty : 0) }));
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// P2 — R store ↔ R store transfer instructions (owner: R001 / R002 both ways).
// Need of store Rn = demand of lines located at Rn or its shop floor Sn (S00n fed from R00n —
// assumption shown on screen). Short stores are filled from stores with more than their own need.
// ─────────────────────────────────────────────────────────────────────────────
export type LocationNeed = { location: string; need: number; stock: number };
export type TransferInstruction = { from: string; to: string; qty: number };

export function storeKey(locationCode: string): string | null {
  const m = /^([RSP])(\d+)$/i.exec(locationCode.trim());
  if (!m) return null;
  // Shop floor S00n is fed from store R00n; packing locations P00n stand on their own (owner 2026-10-22: P ↔ P too).
  return `${m[1].toUpperCase() === "P" ? "P" : "R"}${m[2].padStart(3, "0")}`;
}

export function locationTransfers(needs: readonly LocationNeed[]): TransferInstruction[] {
  const byStore = new Map<string, { need: number; stock: number }>();
  for (const n of needs) {
    const store = storeKey(n.location);
    if (!store) continue;
    const seen = byStore.get(store) ?? { need: 0, stock: 0 };
    byStore.set(store, { need: seen.need + n.need, stock: seen.stock + n.stock });
  }
  const short = [...byStore].map(([store, v]) => ({ store, qty: v.need - v.stock })).filter((s) => s.qty > EPSILON).sort((a, b) => b.qty - a.qty || a.store.localeCompare(b.store));
  const spare = [...byStore].map(([store, v]) => ({ store, qty: v.stock - v.need })).filter((s) => s.qty > EPSILON).sort((a, b) => b.qty - a.qty || a.store.localeCompare(b.store));
  const out: TransferInstruction[] = [];
  // DEPENDENT: each shortage consumes the spare the previous ones left; R ↔ R and P ↔ P only.
  for (const s of short) {
    let remaining = s.qty;
    for (const p of spare.filter((x) => x.store[0] === s.store[0])) {
      if (remaining <= EPSILON) break;
      const qty = Math.min(remaining, p.qty);
      if (qty <= EPSILON) continue;
      out.push({ from: p.store, to: s.store, qty: round(qty) });
      p.qty -= qty; remaining -= qty;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// P2 — another company's spare stock (owner: suggestion only; user raises the STO / Sub-CSN).
// Spare = the lowest projected closing over the horizon minus that company's own Target days of
// average use — so the sender is never put below its own Target.
// ─────────────────────────────────────────────────────────────────────────────
export function companySpare(rows: readonly { closing: number; use: number; target_days: number | null }[]): number {
  if (rows.length === 0) return 0;
  const avgUse = rows.reduce((s, r) => s + r.use, 0) / rows.length;
  const target = Math.max(0, ...rows.map((r) => r.target_days ?? 0));
  const minClosing = Math.min(...rows.map((r) => r.closing));
  return Math.max(0, round(minClosing - target * avgUse));
}
