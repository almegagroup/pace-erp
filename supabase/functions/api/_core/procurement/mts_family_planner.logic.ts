/*
 * PO22 Family planner (owner 2026-10-22) — right item, right time, right lot.
 * Pure: no database call; never creates a PO, CSN, GRN, transfer or Store action.
 *
 * Demand is kept in its two real kinds:
 *   OWN   — a member's exclusive use (a Stroke / Pack BOM line with only that material).
 *   GROUP — a group pool (RDP, RDP_TLA …): any listed candidate may serve it.
 * Direct/exclusive protection is always retained first.  Each group then owns a
 * persistent claim on genuine free physical stock: it is created on opening / a
 * dated receipt, declines only through that group's use, and can be restored
 * from real unreserved stock only when it reaches Target.  Group Settings order
 * (default Method C: most free first) selects the material inside that claim.
 *
 * Needs, earliest first, one lot at a time, re-simulating the whole family after each lot:
 *   OWN need   — a member's own cover (own use only) falls to its Target → that member is bought.
 *   GROUP need — the free stock of the group's members falls to the Target of the member that
 *                would be bought → only a member selected for that month's new buy may be bought;
 *                when none is selected, the shortage remains visible rather than silently buying
 *                another member.
 * A lot arrives on the need day, sized to Target + order cycle of the load it covers (own use, or
 * the group's use), MOQ / order multiple applied and capped to one vendor delivery lot. Surplus simply stays in
 * the member and feeds the groups through the free-stock rule, so later buys shrink by themselves.
 */
import { orderByGroupUsage, type GroupUsageOrder } from "../../_shared/groupUsageOrder.logic.ts";
import { DEFAULT_GROUP_TARGET_DAYS, defaultCriticalDays, effectiveGroupCoveragePolicies, groupDesiredMaxDays, type GroupCoveragePolicyVersion } from "./mts_group_policy.logic.ts";
import { runFamilyPurposeLedger } from "./mts_family_purpose_ledger.logic.ts";
import { applySinglePurchaseConstraints, bookingDaysOf, pickVendorOption, totalLeadTimeDays } from "./mts_optimizer_phase3d.logic.ts";
import { roundQty } from "./mts_requirement.logic.ts";
import type {
  OptimizerAdvisoryBuy,
  OptimizerArrivalFlag,
  OptimizerDailyProjectionRow,
  OptimizerGroupPoolRisk,
  OptimizerMaterialPlanningPolicy,
  OptimizerMaterialRisk,
  OptimizerPlannedLot,
  OptimizerProjectionResult,
  OptimizerVendorOption,
} from "./mts_optimizer_phase3d.types.ts";

const EPSILON = 0.0000001;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_CYCLE_DAYS = 30;
const MAX_LOTS = 400;
/** Credit-days tilt smoothing (owner 2026-10-26): one month. */
const CREDIT_TILT_SMOOTHING_DAYS = 30;

function addDays(day: string, amount: number): string { return new Date(Date.parse(`${day}T00:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10); }
function dayList(from: string, through: string): string[] { const out: string[] = []; for (let d = from; d <= through; d = addDays(d, 1)) out.push(d); return out; }
/** a < b, element by element (first difference decides). */
function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let k = 0; k < a.length; k += 1) if (a[k] !== b[k]) return a[k] < b[k];
  return false;
}
const valid = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v) && v >= 0;

export type FamilyOwnDemand = { material_id: string; required_by: string; qty_base: number };
export type FamilyGroupDemand = { group_id: string; candidates: readonly string[]; required_by: string; qty_base: number };
export type FamilyArrival = { source_key: string; material_id: string; eta_to_plant: string | null; qty_base: number };
export type FamilyLot = { material_id: string; plant_eta: string; qty_base: number; vendor_id?: string | null };
/**
 * Planning-only receipt identity.  This is deliberately not a batch/issue ledger:
 * it tells the allocator which part of today's counted stock Store should consume
 * first.  Actual Store issue remains outside PO22.
 */
export type FamilyOpeningReceipt = {
  material_id: string;
  qty_base: number;
  valid_until: string;
  reference: string;
  /** A dated GRN/Opening-stock receipt with an earlier expiry may override Group Settings locally. */
  expiry_priority: boolean;
  /**
   * Owner 2026-10-28: the 120-day rule only decides which lot is used first (FEFO). A receipt with no real expiry date
   * (opening stock, GRN with expiry type N_A) is never removed from the plan; `valid_until` is then only its FEFO rank.
   */
  no_expiry?: boolean;
};

type FamilyAllocationSourceKind = "OPENING" | "CONFIRMED_ETA" | "MANUAL_LOT" | "ENGINE_LOT";
/** `arrived_day`: -1 for counted opening stock, else the day index the confirmed ETA / lot lands (FEFO age). */
type SimReceipt = FamilyOpeningReceipt & { source_kind: FamilyAllocationSourceKind; arrived_day: number };

export type FamilyPlannerInput = {
  as_of: string;
  horizon_end: string;
  opening_qty_by_material: Readonly<Record<string, number>>;
  /** Virtual allocation of the counted opening stock to its receipt source; advisory only. */
  opening_receipts?: readonly FamilyOpeningReceipt[];
  own_demand: readonly FamilyOwnDemand[];
  group_demand: readonly FamilyGroupDemand[];
  /** Effective-dated family group guardrails; missing group Target defaults to 30 days. */
  group_coverage_policies?: readonly GroupCoveragePolicyVersion[];
  /** Narrow levels keep their next refill when a broad level tops up (default on). Only a test switches it off, to prove the rule. */
  hold_back?: boolean;
  confirmed_arrivals: readonly FamilyArrival[];
  /** Dated-inbound risks retained for explanation; they never become simulated stock. */
  arrival_risks?: readonly OptimizerArrivalFlag[];
  policies: readonly OptimizerMaterialPlanningPolicy[];
  manual_lots?: readonly FamilyLot[];
  /** Group Settings: group → which member first. Absent = most free stock first (Method C). */
  group_orders?: ReadonlyMap<string, GroupUsageOrder>;
  /** D3: month (YYYY-MM-01) → members explicitly authorised for a new buy. */
  selections?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Materials displayed in the monthly selector. New engine lots for these are fail-closed unless selected. */
  selection_controlled_members?: ReadonlySet<string>;
  /** Planning off: only simulate (arrival optimizer). */
  plan_buys?: boolean;
  /** false = skip the event log / Material × Level matrix (the arrival optimizer re-runs the family many times). */
  trace?: boolean;
  /** Owner 2026-10-30: also return, for every day, each level's cover / Min / Max (days) and the pool, for the schedule check Excel. */
  level_days?: boolean;
  /** Days (YYYY-MM-DD) that always get a Material × Level snapshot — e.g. the end of the current / next month for the Store "keep" quantity. */
  checkpoints?: readonly string[];
};

/**
 * Owner 2026-10-28 (docs/mts-planning/PO22-WATERFALL-OWNER-METHOD-2026-10-28.md §13): the flow of the waterfall as events — a receipt
 * landing in the pool, a level topping up to its own Max, or a level WAITING (at / below Min, pool too short). One row per event day.
 */
export type FamilyLevelEvent = {
  day: string;
  kind: "OPENING_RESERVE" | "RECEIPT" | "TOP_UP" | "WAITING";
  level_kind: "OWN" | "GROUP" | "POOL";
  /** OWN: the material with its own (exclusive) use; GROUP: the group id; POOL (receipt): null. */
  level_id: string | null;
  /** RECEIPT: the material that landed. */
  material_id: string | null;
  qty: number;
  by_material: Readonly<Record<string, number>>;
  /** What the level needed to reach its own Max, and how much of it the pool could not give. */
  wanted: number;
  shortfall: number;
  /** Unreserved (pool) stock of the whole family just before / after this event. */
  pool_before: number;
  pool_after: number;
  references: readonly string[];
  /** Owner 2026-10-29: days the level's own reserve covers after this event, and the level's Min (Target) days then. Null = no demand ahead / no Min. */
  cover_days_after?: number | null;
  min_days?: number | null;
};

/** Material × Level snapshot after the events of a day: KG of each material held for each level, and what is left in the pool. */
export type FamilyLevelMatrix = {
  day: string;
  levels: ReadonlyArray<{ level_kind: "OWN" | "GROUP"; level_id: string; by_material: Readonly<Record<string, number>> }>;
  pool: Readonly<Record<string, number>>;
  closing: Readonly<Record<string, number>>;
};

/** Block 1 of the family table: each level's Min / Max / Critical days, reserve and cover on the first day (the rest is `level_events`). */
export type FamilyLevelPolicy = {
  level_kind: "OWN" | "GROUP";
  level_id: string;
  /** Materials that may serve this level (a group's candidates; the material itself for Exclusive). */
  members: readonly string[];
  target_days: number | null;
  critical_days: number | null;
  desired_days: number | null;
  reserve_now: number;
  /** Days the reserve covers (walking the level's own plan demand); null = no demand. */
  cover_days_now: number | null;
};

export type FamilyBuy = OptimizerAdvisoryBuy & {
  /** What the lot is for: "OWN" (the member's exclusive use) or the group ids it serves. */
  covers: readonly string[];
  need_kind: "OWN" | "GROUP";
  /** Owner 2026-10-28: the cover (days) that triggered this lot — the group's free stock for a group need, the item's own use for an own need — and the Min it was compared with (the item's own Target for a group need, D10). */
  trigger_cover_days?: number | null;
  /** Owner 2026-10-29: the group whose free stock triggered this lot (null for an own-use trigger). */
  trigger_group_id?: string | null;
  trigger_min_days?: number | null;
  /**
   * Owner 2026-10-30: only for a LATE new order (no lot can land before the level reaches its Min). The Min cannot be saved: how many days the
   * level sits below its Min until the earliest possible lot lands, how low its cover goes, and whether even the Critical is broken.
   */
  min_gap?: { days_below_min: number; from: string; to: string; lowest_cover_days: number; min_days: number; critical_days: number | null; critical_broken: boolean } | null;
  /**
   * Owner 2026-10-30: a lot timed at the ITEM's own (lower) Min lands while a level it serves is still below ITS Min (the pool covers the gap).
   * How many days that level sits below its Min before this lot lands, how low its cover goes, and how many days that stays above its Critical.
   */
  min_dip?: { level_label_id: string; level_kind: "OWN" | "GROUP"; days_below_min: number; from: string; to: string; lowest_cover_days: number; min_days: number; critical_days: number | null; days_above_critical: number | null; ask_day: string | null; ask_wanted_qty: number | null; ask_got_qty: number | null; pool_qty_at_ask: number | null } | null;
};

export type FamilyResult = Omit<OptimizerProjectionResult, "advisory_buys"> & {
  advisory_buys: readonly FamilyBuy[];
  /** Event log of the waterfall (receipts, top-ups, waiting levels) and the Material × Level matrix on each event day. */
  level_events: readonly FamilyLevelEvent[];
  /** Only when the input asked for `level_days`: end-of-day cover of every level against its Min and Max (days), reserve held and the pool left. */
  level_days: ReadonlyArray<{ day: string; pool_qty: number; levels: ReadonlyArray<{ level_kind: "OWN" | "GROUP"; level_id: string; level_key: string; members: readonly string[]; cover_days: number | null; max_cover_days: number | null; min_days: number | null; max_days: number | null; reserve_qty: number }> }>;
  level_matrix: readonly FamilyLevelMatrix[];
  level_policies: readonly FamilyLevelPolicy[];
  /** Owner 2026-10-29: every day a level's own reserve covers fewer days than its Min (Target) — the level is being run below its protection. */
  level_risk: ReadonlyArray<{ day: string; level_kind: "OWN" | "GROUP"; level_id: string; cover_days: number; min_days: number; critical_days: number | null }>;
  /** Per pool and day: group demand no member could meet (after protected stock). */
  group_unmet: ReadonlyArray<{ group_id: string; day: string; qty_base: number }>;
  /** Consumption ratio: per group and day, how much each member serves (Store instruction basis). */
  group_mix: ReadonlyArray<{ group_id: string; day: string; draws: Readonly<Record<string, number>> }>;
  /**
   * Canonical carried group-purpose balances.  An opening/receipt event
   * creates a claim for current use plus Desired-Max forward cover; the claim
   * then declines only through that group's draw.  Store ratio may consume
   * only its own group's balance.
   */
  group_bucket_reservations: ReadonlyArray<{
    group_id: string;
    day: string;
    material_id: string;
    reserved_qty_base: number;
    rule: "GROUP_DESIRED_MAX_WATERFALL";
  }>;
  /**
   * One actual simulated draw.  IDs stay internal here; the API boundary resolves
   * them to business labels before returning an explainability report.
   */
  allocation_rows: ReadonlyArray<{
    day: string;
    material_id: string;
    destination_kind: "OWN" | "GROUP";
    group_id: string | null;
    qty_base: number;
    closing_qty_base: number;
    /** Physical planning source consumed by this draw; never a Store issue confirmation. */
    source_reference: string;
    source_kind: FamilyAllocationSourceKind;
    rule: "DIRECT_EXCLUSIVE_RESERVE" | "GROUP_WATERFALL";
  }>;
  /** Per-member proof that the event-time waterfall did not create or double-count stock. */
  allocation_reconciliation: ReadonlyArray<{
    material_id: string;
    opening_qty_base: number;
    confirmed_arrival_qty_base: number;
    planned_lot_qty_base: number;
    own_allocated_qty_base: number;
    group_allocated_qty_base: number;
    expired_qty_base: number;
    closing_qty_base: number;
    variance_qty_base: number;
  }>;
  /** Group protection is independent from individual member guards. */
  group_actions: ReadonlyArray<{
    group_id: string;
    first_below_target_day: string | null;
    first_below_critical_day: string | null;
    first_shortage_day: string | null;
    unresolved_qty_base: number;
    ordered_actions: readonly string[];
  }>;
  /**
   * Post-horizon reservation of the actual closing carry. It never consumes
   * physical stock or invents demand; it makes the owner-approved waterfall
   * allocation explicit for the next dated planning event.
   */
  waterfall_reservations: ReadonlyArray<{
    material_id: string;
    group_id: string | null;
    qty_base: number;
    available_after_qty_base: number;
    stage: "DIRECT_DESIRED_MAX" | "GROUP_DESIRED_MAX" | "SECOND_ROTATION" | "CARRY_NO_APPROVED_DEMAND";
    rule: string;
  }>;
};

type Pool = { key: string; group_id: string; candidates: string[]; demand: number[] };
type Planned = {
  material_id: string;
  index: number;
  qty: number;
  source_reference: string;
  source_kind: Extract<FamilyAllocationSourceKind, "MANUAL_LOT" | "ENGINE_LOT">;
};

function targetAt(policy: OptimizerMaterialPlanningPolicy | undefined, day: string): { target: number | null; critical: number | null; desiredMaxOverride: number | null } {
  if (!policy) return { target: null, critical: null, desiredMaxOverride: null };
  let target = policy.target_days;
  let critical = policy.critical_days;
  let desiredMaxOverride = policy.desired_max_days_override ?? null;
  let best: string | null = null;
  for (const v of policy.coverage_versions ?? []) {
    if (v.effective_from > day || (best !== null && v.effective_from <= best)) continue;
    best = v.effective_from; target = v.target_days; critical = v.critical_days; desiredMaxOverride = v.desired_max_days_override ?? null;
  }
  const safeTarget = valid(target) ? target : null;
  return {
    target: safeTarget,
    critical: valid(critical) ? critical : null,
    desiredMaxOverride: safeTarget !== null && valid(desiredMaxOverride) && desiredMaxOverride >= safeTarget ? desiredMaxOverride : null,
  };
}

/**
 * Owner 2026-10-28: a PO21 plan that stops before the horizon end (no demand in its last days) says "no plan after here",
 * not "no use". Beyond that point no demand is invented and days are not counted. A plan that runs to the horizon end
 * keeps the old rule (average of the days that actually use stock).
 */
const PLAN_TAIL_DAYS = 7;
function planContinues(use: readonly number[]): boolean {
  for (let i = Math.max(0, use.length - PLAN_TAIL_DAYS); i < use.length; i += 1) if (use[i] > EPSILON) return true;
  return false;
}

/**
 * Days `balance` covers after index `from`, walking `use`. When the plan has ended and the stock outlasts it, the answer is
 * null ("beyond the plan"), never a long run of zero-demand days. Within a plan that continues to the horizon end, the
 * average use of the days that actually use stock is extrapolated.
 */
function coverDays(balance: number, use: readonly number[], from: number): number | null {
  const total = use.reduce((s, q) => s + q, 0);
  if (total <= EPSILON) return null;
  if (balance <= EPSILON) return 0;
  let lastActive = -1;
  for (let i = use.length - 1; i >= 0; i -= 1) if (use[i] > EPSILON) { lastActive = i; break; }
  const continues = planContinues(use);
  let left = balance;
  let covered = 0;
  for (let i = from + 1; i < use.length; i += 1) {
    const need = use[i];
    if (need <= EPSILON) {
      if (left <= EPSILON) return covered;
      if (!continues && i > lastActive) return null;
      covered += 1;
      continue;
    }
    if (need > left + EPSILON) return covered;
    left = Math.max(0, left - need);
    covered += 1;
  }
  if (!continues) return null;
  // Beyond the horizon, extrapolate at the average of the days that actually use stock. Averaging over
  // the whole horizon let zero-demand months (no PO21 plan) dilute the rate, so a few hundred kg looked
  // like 500+ days (owner 2026-10-27: DISPELAIR P 893 498 d, MECELLOSE FMC 1258 d).
  const activeDays = use.reduce((n, q) => n + (q > EPSILON ? 1 : 0), 0);
  const avg = activeDays > 0 ? total / activeDays : 0;
  return avg <= EPSILON ? covered : covered + Math.floor(left / avg + EPSILON);
}

/**
 * Coverage for a standalone own-use item.  A month without an approved PO21
 * plan has zero consumption, so its calendar days must not make coverage look
 * longer.  We walk the real positive demand days, then express any retained
 * balance at the final approved daily rate in the horizon.  This is a coverage/reporting rate
 * only; the simulation continues to consume the real (possibly zero) demand.
 */
function standaloneCoverageDays(balance: number, use: readonly number[], from: number, finalApprovedDailyUse: number): number | null {
  if (finalApprovedDailyUse <= EPSILON) return null;
  if (balance <= EPSILON) return 0;
  let left = balance;
  let covered = 0;
  for (let i = from + 1; i < use.length; i += 1) {
    const need = use[i];
    if (need <= EPSILON) continue;
    if (need > left + EPSILON) return covered;
    left = Math.max(0, left - need);
    covered += 1;
  }
  // Owner 2026-10-28: a standalone item follows the same rule as the waterfall — stock that outlasts a PO21 plan which ended before
  // the horizon end is "beyond plan", not a few leftover days.
  if (!planContinues(use)) return null;
  return covered + Math.floor(left / finalApprovedDailyUse + EPSILON);
}

/** Use over the `n` days after index `from`. Beyond the horizon: the average use if the plan runs to the end, else none (no plan = no invented demand). */
const ACTIVE_AVERAGE = new WeakMap<readonly number[], { length: number; avg: number }>();
function useAhead(use: readonly number[], from: number, n: number): number {
  // Beyond the horizon: the average of the days that actually use stock. Averaging over the whole horizon let zero-demand
  // months (no PO21 plan) dilute the rate (same as coverDays, owner 2026-10-27). Cached per series: this runs in the hot loop.
  // A plan that ended before the horizon end gets rate 0 (owner 2026-10-28: no March buy from a demand nobody planned).
  let cached = ACTIVE_AVERAGE.get(use);
  if (!cached || cached.length !== use.length) {
    let total = 0;
    let active = 0;
    for (const q of use) { total += q; if (q > EPSILON) active += 1; }
    cached = { length: use.length, avg: active > 0 && planContinues(use) ? total / active : 0 };
    ACTIVE_AVERAGE.set(use, cached);
  }
  const avg = cached.avg;
  let sum = 0;
  for (let k = 1; k <= Math.max(0, Math.floor(n)); k += 1) sum += from + k < use.length ? use[from + k] : avg;
  return sum;
}

type Sim = {
  closing: number[][]; // member index → day
  use: number[][];
  draw: number[][];
  arrival: number[][];
  planned: number[][];
  /** Owner 2026-10-29: what the member's OWN (exclusive) level can reach: its own reserve plus the member's stock still in the pool (stock held in group reserves is not reachable). */
  ownAvail: number[][];
  ownBalance: number[][]; // closing + group draws taken from protected stock (stock if groups had not borrowed)
  freeAfter: number[][]; // free stock above own protection after the day
  poolUnmet: number[][]; // pool index → day
  poolFreeShort: number[][];
  poolFree: number[][]; // free stock this pool could still use after the day (reserve-adjusted)
  poolDraw: number[][][]; // pool → member → day: who served the group (the consumption ratio)
  poolBucket: number[][][]; // pool → member → day: carried Group Desired-Max purpose reservation
  sourceDraws: Array<{
    day: number;
    material: number;
    destination_kind: "OWN" | "GROUP";
    group: number | null;
    qty: number;
    source_reference: string;
    source_kind: FamilyAllocationSourceKind;
  }>;
  expired: number[]; // planning-only receipt life loss; must reconcile stock conservation
  levelEvents: Array<{
    day: number; kind: FamilyLevelEvent["kind"]; level_kind: FamilyLevelEvent["level_kind"]; level: number | null; material: number | null;
    qty: number; by_material: number[]; wanted: number; shortfall: number; pool_before: number; pool_after: number; references: string[];
    cover_days_after?: number | null; min_days?: number | null;
  }>;
  matrix: Array<{ day: number; own: number[]; groups: number[][]; pool: number[]; closing: number[] }>;
  /** Per day and level: the level's own reserve covers fewer days than its Min (Target). */
  risk: Array<{ day: number; kind: "OWN" | "GROUP"; level: number; cover: number; min: number; critical: number | null }>;
  levelDays: Array<{ day: number; pool_qty: number; levels: Array<{ kind: "OWN" | "GROUP"; level: number; cover: number | null; maxCover: number | null; min: number | null; max: number | null; reserve: number }> }>;
};

/** Every material the planner sees in this input (same set the per-family run builds). */
function plannerMaterialIds(input: FamilyPlannerInput): string[] {
  return [...new Set<string>([
    ...Object.keys(input.opening_qty_by_material),
    ...(input.opening_receipts ?? []).map((r) => r.material_id),
    ...input.own_demand.map((r) => r.material_id),
    ...input.group_demand.flatMap((r) => r.candidates),
    ...input.confirmed_arrivals.map((r) => r.material_id),
    ...(input.manual_lots ?? []).map((l) => l.material_id),
  ])].sort();
}

/** Cost and credit days of the vendor a member would normally be rebought from (its cheapest). */
function tiltInputs(policy: OptimizerMaterialPlanningPolicy | undefined): { cost: number | null; credit: number | null } {
  const options = (policy?.vendor_options ?? []).filter((o) => o.unit_cost !== null && o.unit_cost > 0);
  const cheapest = options.length ? options.reduce((a, b) => ((b.unit_cost as number) < (a.unit_cost as number) ? b : a)) : null;
  const creditOf = (o: OptimizerVendorOption | undefined) => (o?.credit_days === null || o?.credit_days === undefined ? null : Math.max(0, o.credit_days));
  return {
    cost: cheapest ? cheapest.unit_cost : null,
    credit: cheapest ? creditOf(cheapest) : creditOf((policy?.vendor_options ?? []).find((o) => o.credit_days !== null && o.credit_days !== undefined)),
  };
}

/** Company-wide averages behind the consumption-ratio tilt (cost and vendor credit days). */
type TiltBasis = { cost: number | null; credit: number | null };
function plannerTiltBasis(input: FamilyPlannerInput, ids: readonly string[]): TiltBasis {
  const policyOf = new Map(input.policies.map((p) => [p.material_id, p]));
  const rows = ids.map((id) => tiltInputs(policyOf.get(id)));
  const avg = (values: Array<number | null>) => {
    const known = values.filter((v): v is number => v !== null);
    return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
  };
  return { cost: avg(rows.map((r) => r.cost)), credit: avg(rows.map((r) => r.credit)) };
}

/**
 * Owner 2026-10-26 (performance): materials that share no group never affect each other's
 * waterfall, needs or lots, so each connected family is planned on its own and the results are
 * joined. The company-wide cost / credit averages are passed in so the tilt is identical to a single
 * company-wide run. Before this, every lot re-simulated all ~108 materials (PROD: 258 s for one
 * Planning request, blocking every other request on the server).
 */
export function planFamily(input: FamilyPlannerInput): FamilyResult {
  if (!ISO_DAY.test(input.as_of) || !ISO_DAY.test(input.horizon_end) || input.horizon_end < input.as_of) throw new Error("FAMILY_PLANNER_INVALID_HORIZON");
  const ids = plannerMaterialIds(input);
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let walk = id;
    while (parent.get(walk) !== root) { const next = parent.get(walk)!; parent.set(walk, root); walk = next; }
    return root;
  };
  for (const g of input.group_demand) {
    for (let k = 1; k < g.candidates.length; k += 1) {
      const a = find(g.candidates[0]); const b = find(g.candidates[k]);
      if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
    }
  }
  const components = new Map<string, Set<string>>();
  for (const id of ids) {
    const root = find(id);
    components.set(root, (components.get(root) ?? new Set<string>()).add(id));
  }
  const tiltBasis = plannerTiltBasis(input, ids);
  if (components.size <= 1) return planFamilyComponent(input, tiltBasis);
  const parts = [...components.values()].map((members) => {
    const has = (id: string) => members.has(id);
    return planFamilyComponent({
      ...input,
      opening_qty_by_material: Object.fromEntries(Object.entries(input.opening_qty_by_material).filter(([id]) => has(id))),
      opening_receipts: input.opening_receipts?.filter((r) => has(r.material_id)),
      own_demand: input.own_demand.filter((r) => has(r.material_id)),
      group_demand: input.group_demand.filter((r) => r.candidates.length > 0 && has(r.candidates[0])),
      confirmed_arrivals: input.confirmed_arrivals.filter((a) => has(a.material_id)),
      arrival_risks: input.arrival_risks?.filter((a) => has(a.material_id)),
      policies: input.policies.filter((p) => has(p.material_id)),
      manual_lots: input.manual_lots?.filter((l) => has(l.material_id)),
    }, tiltBasis);
  });
  const all = <K extends keyof FamilyResult>(key: K) => parts.flatMap((part) => [...(part[key] as readonly unknown[])]) as unknown as FamilyResult[K];
  const mixByKey = new Map<string, Record<string, number>>();
  for (const part of parts) for (const m of part.group_mix) mixByKey.set(`${m.group_id}|${m.day}`, { ...(mixByKey.get(`${m.group_id}|${m.day}`) ?? {}), ...m.draws });
  return {
    rows: [...all("rows")].sort((a, b) => a.material_id.localeCompare(b.material_id) || a.day.localeCompare(b.day)),
    risks: [...all("risks")].sort((a, b) => a.material_id.localeCompare(b.material_id)),
    group_pool_risks: [...all("group_pool_risks")].sort((a, b) => String(a.group_id ?? "").localeCompare(String(b.group_id ?? ""))),
    arrival_flags: [...all("arrival_flags")].sort((a, b) => a.source_key.localeCompare(b.source_key)),
    advisory_buys: [...all("advisory_buys")].sort((a, b) => a.material_id.localeCompare(b.material_id) || a.sequence - b.sequence),
    group_unmet: all("group_unmet"),
    level_events: [...all("level_events")].sort((a, b) => a.day.localeCompare(b.day)),
    level_days: (() => {
      const byDay = new Map<string, { day: string; pool_qty: number; levels: FamilyResult["level_days"][number]["levels"][number][] }>();
      for (const part of parts) for (const d of part.level_days) {
        const cur = byDay.get(d.day) ?? { day: d.day, pool_qty: 0, levels: [] };
        cur.pool_qty = roundQty(cur.pool_qty + d.pool_qty);
        cur.levels.push(...d.levels);
        byDay.set(d.day, cur);
      }
      return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
    })(),
    level_matrix: [...all("level_matrix")].sort((a, b) => a.day.localeCompare(b.day)),
    level_policies: all("level_policies"),
    level_risk: [...all("level_risk")].sort((a, b) => a.day.localeCompare(b.day)),
    allocation_rows: [...all("allocation_rows")].sort((a, b) => a.day.localeCompare(b.day)
      || a.destination_kind.localeCompare(b.destination_kind) || String(a.group_id ?? "").localeCompare(String(b.group_id ?? ""))
      || a.material_id.localeCompare(b.material_id)),
    allocation_reconciliation: [...all("allocation_reconciliation")].sort((a, b) => a.material_id.localeCompare(b.material_id)),
    group_actions: [...all("group_actions")].sort((a, b) => a.group_id.localeCompare(b.group_id)),
    waterfall_reservations: all("waterfall_reservations"),
    group_bucket_reservations: [...all("group_bucket_reservations")].sort((a, b) => a.day.localeCompare(b.day) || a.group_id.localeCompare(b.group_id) || a.material_id.localeCompare(b.material_id)),
    group_mix: [...mixByKey].map(([k, draws]) => ({ group_id: k.split("|")[0], day: k.split("|")[1], draws }))
      .sort((a, b) => a.day.localeCompare(b.day) || a.group_id.localeCompare(b.group_id)),
  };
}

function planFamilyComponent(input: FamilyPlannerInput, tiltBasis: TiltBasis): FamilyResult {
  if (!ISO_DAY.test(input.as_of) || !ISO_DAY.test(input.horizon_end) || input.horizon_end < input.as_of) throw new Error("FAMILY_PLANNER_INVALID_HORIZON");
  const allDays = dayList(input.as_of, input.horizon_end);
  const N = allDays.length;
  const dayIndex = new Map(allDays.map((d, i) => [d, i]));
  const policyOf = new Map(input.policies.map((p) => [p.material_id, p]));

  const ids = [...new Set<string>([
    ...Object.keys(input.opening_qty_by_material),
    ...(input.opening_receipts ?? []).map((r) => r.material_id),
    ...input.own_demand.map((r) => r.material_id),
    ...input.group_demand.flatMap((r) => r.candidates),
    ...input.confirmed_arrivals.map((r) => r.material_id),
    ...(input.manual_lots ?? []).map((l) => l.material_id),
  ])].sort();
  const mIndex = new Map(ids.map((id, i) => [id, i]));
  const M = ids.length;
  const zeros = () => Array.from({ length: N }, () => 0);

  const own = ids.map(() => zeros());
  for (const r of input.own_demand) {
    const i = dayIndex.get(r.required_by);
    if (i === undefined || !valid(r.qty_base)) continue;
    own[mIndex.get(r.material_id)!][i] += r.qty_base;
  }
  const poolByKey = new Map<string, Pool>();
  for (const r of input.group_demand) {
    const i = dayIndex.get(r.required_by);
    if (i === undefined || !valid(r.qty_base) || r.candidates.length === 0) continue;
    const key = `${r.group_id}|${[...r.candidates].sort().join(",")}`;
    const pool = poolByKey.get(key) ?? { key, group_id: r.group_id, candidates: [...r.candidates], demand: zeros() };
    pool.demand[i] += r.qty_base;
    poolByKey.set(key, pool);
  }
  // Narrower pools first (owner Method C), then by key — deterministic.
  const pools = [...poolByKey.values()].sort((a, b) => a.candidates.length - b.candidates.length || a.key.localeCompare(b.key));
  const isSharedGroupMember = ids.map((id) => pools.some((pool) => pool.candidates.includes(id)));
  /** How many levels (its own exclusive use + every group) can draw this material. */
  const levelsServed = ids.map((id, m) => pools.filter((pool) => pool.candidates.includes(id)).length + (own[m].some((qty) => qty > EPSILON) ? 1 : 0));
  // A standalone item's Target is a physical safety reserve, not a permission
  // to run stock down to zero in a later no-demand month.  Carry its final
  // approved non-zero daily own-use rate forward as the sizing rate only;
  // a current-month rate must not inflate coverage after known next-month use.
  // simulation still consumes the actual PO21 demand (zero means zero use).
  // Shared-group safety is deliberately deferred: one combined group reserve
  // must not be duplicated on every alternative member.
  // Owner 2026-10-28: the reserve applies across a no-demand GAP (later demand exists), not after the plan's last demand day —
  // a standalone item follows the same rule as the waterfall (no invented demand, no order after the plan).
  const finalOwnDailyUse = own.map((series) => {
    const finalRate = [...series].reverse().find((qty) => qty > EPSILON) ?? 0;
    let lastActive = -1;
    series.forEach((qty, i) => { if (qty > EPSILON) lastActive = i; });
    return series.map((_qty, i) => (i < lastActive ? finalRate : 0));
  });

  const arrivalFlags: OptimizerArrivalFlag[] = [...(input.arrival_risks ?? [])];
  const confirmed = ids.map(() => zeros());
  const confirmedSources = new Map<string, Array<{ qty: number; reference: string }>>();
  for (const a of input.confirmed_arrivals) {
    if (!valid(a.qty_base) || a.qty_base <= EPSILON) continue;
    let eta = a.eta_to_plant;
    if (eta === null || !ISO_DAY.test(eta) || eta < input.as_of) {
      const reason = eta === null || !ISO_DAY.test(eta) ? "ETA_MISSING" : "ETA_PASSED";
      arrivalFlags.push({
        source_key: a.source_key, material_id: a.material_id, eta_to_plant: a.eta_to_plant, assumed_eta: null, reason,
        message: reason === "ETA_PASSED"
          ? "ETA has passed and the material has not arrived — update this CSN in CSN Tracker. This receipt is risk-only, not assumed as stock."
          : "No plant ETA — set it in CSN Tracker. This receipt is risk-only, not assumed as stock.",
      });
      continue;
    }
    const i = dayIndex.get(eta);
    if (i === undefined) {
      // A confirmed ERP PO/CSN remains evidence even when it lands after the
      // current Family horizon.  It must not silently disappear or inflate
      // today's safety cover / suppress a current buy recommendation.
      arrivalFlags.push({
        source_key: a.source_key, material_id: a.material_id, eta_to_plant: eta, assumed_eta: null, reason: "ETA_AFTER_HORIZON",
        message: `Confirmed plant ETA ${eta} is after this planning horizon — shown as future evidence, not counted as current Family stock.`,
      });
      continue;
    }
    const materialIndex = mIndex.get(a.material_id)!;
    confirmed[materialIndex][i] += a.qty_base;
    const sourceKey = `${materialIndex}|${i}`;
    confirmedSources.set(sourceKey, [
      ...(confirmedSources.get(sourceKey) ?? []),
      { qty: a.qty_base, reference: a.source_key },
    ]);
  }
  const manual: Planned[] = [];
  for (const l of input.manual_lots ?? []) {
    const i = dayIndex.get(l.plant_eta);
    if (i === undefined || !valid(l.qty_base) || l.qty_base <= EPSILON || !mIndex.has(l.material_id)) continue;
    manual.push({
      material_id: l.material_id,
      index: i,
      qty: l.qty_base,
      source_reference: `Your lot (${l.plant_eta})`,
      source_kind: "MANUAL_LOT",
    });
  }

  const targets = ids.map((id) => allDays.map((d) => targetAt(policyOf.get(id), d)));
  // Protection after day i: direct/exclusive use of the member through its
  // Desired Max. Group use may never consume this protected quantity.
  const memberDesiredMax = ids.map((id, m) => allDays.map((d, i) => {
    const target = targets[m][i].target;
    if (target === null) return null;
    return targets[m][i].desiredMaxOverride ?? (target + (policyOf.get(id)?.cycle_days ?? DEFAULT_CYCLE_DAYS));
  }));
  const protection = ids.map((_, m) => allDays.map((_d, i) => {
    const desired = memberDesiredMax[m][i];
    return desired === null ? 0 : useAhead(own[m], i, desired);
  }));

  const groupCoverageAt = (pool: Pool, i: number) => {
    const saved = effectiveGroupCoveragePolicies(input.group_coverage_policies ?? [], allDays[i]).get(pool.group_id);
    const target = saved?.target_days ?? DEFAULT_GROUP_TARGET_DAYS;
    const critical = saved?.critical_days ?? defaultCriticalDays(target);
    const memberMax = pool.candidates.map((id) => {
      const m = mIndex.get(id);
      return m === undefined ? null : memberDesiredMax[m][i];
    }).filter((value): value is number => value !== null);
    // A candidate with no individual policy can still contribute its real
    // opening stock or ETA on the event day, but it cannot define a future
    // replenishment window.  Letting that null erase every configured member
    // Max silently collapsed Group Desired Max to Target; a late MOQ then
    // looked below Target again the next day and created a duplicate buy.
    // If no candidate has a configured Max, the documented group Target
    // fallback still applies.
    // Owner 2026-10-28: a group's Max is never below its own Min (RDP_TOT WHITE showed Min 30 / Max 27).
    const desired = Math.max(target, groupDesiredMaxDays(saved, memberMax) ?? target);
    return { target, critical, desired };
  };

  // Consumption-ratio tilt (owner 2026-10-22 cost, 2026-10-26 credit days). Inside a group, a
  // member's share of the use follows its free stock, tilted towards:
  //   - costlier stock (more money tied up), and
  //   - stock whose usual vendor gives longer credit: using it brings its re-buy forward, and that
  //     re-buy is paid later, so cash goes out later. Advance / 0 days is the least favoured.
  // Both are relative to the company-wide average; unknown = neutral. The combined tilt is clamped
  // to 0.5–2 so money never overrides stock levels.
  const tiltOf = ids.map((id) => tiltInputs(policyOf.get(id)));
  const costTilt = tiltOf.map(({ cost, credit }) => {
    const byCost = cost === null || tiltBasis.cost === null ? 1 : cost / tiltBasis.cost;
    // Smoothed by one month so 0 vs 15 days does not swing the ratio like 0 vs 90 days would.
    const byCredit = credit === null || tiltBasis.credit === null ? 1 : (credit + CREDIT_TILT_SMOOTHING_DAYS) / (tiltBasis.credit + CREDIT_TILT_SMOOTHING_DAYS);
    return Math.min(2, Math.max(0.5, byCost * byCredit));
  });
  const candIdx = pools.map((pool) => pool.candidates.filter((c) => mIndex.has(c)).map((c) => mIndex.get(c)!));
  const checkpointDays = new Set(input.checkpoints ?? []);
  const simulatedOpeningReceipts = ids.map((id) => {
    const opening = Math.max(0, Number(input.opening_qty_by_material[id] ?? 0));
    let left = opening;
    const supplied = (input.opening_receipts ?? [])
      .filter((r) => r.material_id === id && valid(r.qty_base) && r.qty_base > EPSILON && ISO_DAY.test(r.valid_until))
      .sort((a, b) => a.valid_until.localeCompare(b.valid_until) || a.reference.localeCompare(b.reference));
    const receipts = supplied.flatMap((r) => {
      const qty = Math.min(left, r.qty_base);
      left = Math.max(0, left - qty);
      return qty > EPSILON ? [{ ...r, qty_base: qty }] : [];
    });
    // Backward-compatible pure callers that do not provide receipt sources still
    // receive one virtual opening receipt.  The handler provides the real opening
    // import/GRN basis in production.
    if (left > EPSILON) receipts.push({ material_id: id, qty_base: left, valid_until: addDays(input.as_of, 120), reference: "Opening stock (planning assumption)", expiry_priority: false, no_expiry: true });
    return receipts;
  });

  const simulate = (lots: readonly Planned[]): Sim => {
    const s: Sim = {
      closing: ids.map(() => zeros()), use: ids.map(() => zeros()), draw: ids.map(() => zeros()), arrival: ids.map(() => zeros()),
      planned: ids.map(() => zeros()), ownBalance: ids.map(() => zeros()), ownAvail: ids.map(() => zeros()), freeAfter: ids.map(() => zeros()),
      poolUnmet: pools.map(() => zeros()), poolFreeShort: pools.map(() => zeros()), poolFree: pools.map(() => zeros()),
      poolDraw: pools.map(() => ids.map(() => zeros())),
      poolBucket: pools.map(() => ids.map(() => zeros())),
      sourceDraws: [],
      expired: ids.map(() => 0),
      levelEvents: [],
      matrix: [],
      risk: [],
      levelDays: [],
    };
    for (const l of lots) s.planned[mIndex.get(l.material_id)!][l.index] += l.qty;
    const bal = ids.map((id) => Number(input.opening_qty_by_material[id] ?? 0));
    const receiptLeft: SimReceipt[][] = simulatedOpeningReceipts.map((rows) => rows.map((row) => ({ ...row, source_kind: "OPENING", arrived_day: -1 })));
    // A group reserve is a claim on real physical stock.  It is created on
    // the opening/receipt event, then reduced only by that group's draw.  It
    // must not be recreated from the whole balance on every calendar day.
    const purposeReserve = pools.map(() => Array.from({ length: M }, () => 0));
    // A second, movable claim for the stock left after every purpose has its
    // Desired-Max protection.  Unlike `purposeReserve`, this claim is released
    // and waterfalled again on the next receipt or when any hard purpose falls
    // below Target.  This makes an overlapping group see physical excess once,
    // not once per group.
    const excessReserve = pools.map(() => Array.from({ length: M }, () => 0));
    // Owner 2026-10-28: Exclusive / own use is a level like any group: a persistent reserve, run down
    // by its own use to its own Min (Target), then claimed from the pool up to its own Max. Before this
    // it was a rolling "next Max days" protection that never had a Min or a top-up event.
    const ownReserve = ids.map(() => 0);
    // A level that is waiting is logged once when it starts waiting, not on every day it keeps waiting.
    const waitingOwn = ids.map(() => false);
    const waitingPool = pools.map(() => false);
    for (let i = 0; i < N; i += 1) {
      const eventsAtDayStart = s.levelEvents.length;
      // A receipt is usable through valid_until.  Expired virtual stock is not
      // silently counted as cover; this is a planning warning, never a stock post.
      for (let m = 0; m < M; m += 1) {
        for (const receipt of receiptLeft[m]) {
          if (receipt.qty_base <= EPSILON || receipt.valid_until >= allDays[i] || receipt.no_expiry === true) continue;
          const expired = Math.min(Math.max(0, bal[m]), receipt.qty_base);
          bal[m] = roundQty(bal[m] - expired);
          s.expired[m] = roundQty(s.expired[m] + expired);
          // A purpose reservation is only a claim on the underlying physical
          // stock.  If that stock expires, remove the claim as well (broad
          // groups lose their later waterfall claim first).  Otherwise a
          // future group draw could consume an already-expired VINNAPAS/GRN
          // balance and make the material go negative.
          let expiredReserve = expired;
          for (let p = purposeReserve.length - 1; p >= 0 && expiredReserve > EPSILON; p -= 1) {
            const reserved = purposeReserve[p][m];
            const released = Math.min(reserved, expiredReserve);
            if (released <= EPSILON) continue;
            purposeReserve[p][m] = roundQty(reserved - released);
            expiredReserve = roundQty(expiredReserve - released);
          }
          for (let p = excessReserve.length - 1; p >= 0 && expiredReserve > EPSILON; p -= 1) {
            const reserved = excessReserve[p][m];
            const released = Math.min(reserved, expiredReserve);
            if (released <= EPSILON) continue;
            excessReserve[p][m] = roundQty(reserved - released);
            expiredReserve = roundQty(expiredReserve - released);
          }
          if (expiredReserve > EPSILON) ownReserve[m] = roundQty(Math.max(0, ownReserve[m] - expiredReserve));
          receipt.qty_base = 0;
        }
      }
      for (let m = 0; m < M; m += 1) {
        for (const source of confirmedSources.get(`${m}|${i}`) ?? []) {
          s.levelEvents.push({ day: i, kind: "RECEIPT", level_kind: "POOL", level: null, material: m, qty: source.qty, by_material: ids.map((_x, k) => (k === m ? source.qty : 0)), wanted: 0, shortfall: 0, pool_before: 0, pool_after: 0, references: [source.reference] });
          receiptLeft[m].push({
            material_id: ids[m], qty_base: source.qty, valid_until: "9999-12-31",
            reference: source.reference, expiry_priority: false, source_kind: "CONFIRMED_ETA", arrived_day: i,
          });
        }
        for (const lot of lots.filter((row) => row.index === i && mIndex.get(row.material_id) === m)) {
          s.levelEvents.push({ day: i, kind: "RECEIPT", level_kind: "POOL", level: null, material: m, qty: lot.qty, by_material: ids.map((_x, k) => (k === m ? lot.qty : 0)), wanted: 0, shortfall: 0, pool_before: 0, pool_after: 0, references: [lot.source_reference] });
          receiptLeft[m].push({
            material_id: ids[m], qty_base: lot.qty, valid_until: "9999-12-31",
            reference: lot.source_reference, expiry_priority: false, source_kind: lot.source_kind, arrived_day: i,
          });
        }
        s.arrival[m][i] = confirmed[m][i];
        bal[m] += confirmed[m][i] + s.planned[m][i] - own[m][i];
        s.use[m][i] = own[m][i];
        ownReserve[m] = roundQty(Math.max(0, ownReserve[m] - own[m][i]));
        // Existing receipts are consumed FEFO.  Future arrivals/engine lots
        // remain aggregate because Store cannot physically issue them yet.
        let ownLeft = own[m][i];
        for (const receipt of receiptLeft[m]) {
          if (ownLeft <= EPSILON) break;
          const used = Math.min(ownLeft, receipt.qty_base);
          receipt.qty_base -= used;
          ownLeft -= used;
          s.sourceDraws.push({
            day: i, material: m, destination_kind: "OWN", group: null, qty: used,
            source_reference: receipt.reference, source_kind: receipt.source_kind,
          });
        }
      }
      // Direct/exclusive protection stays first.  Group reserves then persist
      // through days until their own group consumes them.
      const newlyAvailable = i === 0 || ids.some((_id, m) => confirmed[m][i] > EPSILON || s.planned[m][i] > EPSILON);
      const unreserved = ids.map((_id, m) => Math.max(0, bal[m] - ownReserve[m]
        - purposeReserve.reduce((sum, reserve) => sum + reserve[m], 0)
        - excessReserve.reduce((sum, reserve) => sum + reserve[m], 0)));
      // Owner 2026-10-29: a broad level never takes the last stock a NARROWER level will ask for at its next refill. For every narrower
      // level (an Exclusive material, or a group listed before this one) its headroom up to its own Max is kept in the pool: for an
      // Exclusive level on its material, for a group on the member that serves the most levels (the shared material is used last).
      const holdBackFor = (p: number, m: number) => {
        if (i === 0 || input.hold_back === false) return 0;
        let held = 0;
        const own0 = memberDesiredMax[m][i];
        if (own0 !== null && own[m].some((qty) => qty > EPSILON)) held += Math.max(0, useAhead(own[m], i, own0) - ownReserve[m]);
        for (let q = 0; q < p; q += 1) {
          const cands = candIdx[q];
          if (!cands.includes(m)) continue;
          const designated = [...cands].sort((a, b) => levelsServed[b] - levelsServed[a] || ids[a].localeCompare(ids[b]))[0];
          if (designated !== m) continue;
          const wantedQ = pools[q].demand[i] + useAhead(pools[q].demand, i, groupCoverageAt(pools[q], i).desired);
          held += Math.max(0, wantedQ - purposeReserve[q].reduce((sum, qty) => sum + Math.max(0, qty), 0));
        }
        return held;
      };
      const takeBucket = (p: number, m: number, qty: number) => {
        const take = Math.min(Math.max(0, qty), Math.max(0, unreserved[m] - holdBackFor(p, m)));
        if (take <= EPSILON) return 0;
        purposeReserve[p][m] = roundQty(purposeReserve[p][m] + take);
        unreserved[m] = roundQty(unreserved[m] - take);
        return take;
      };
      // Owner 2026-10-28 (FEFO across lots): inside a group, the member holding the OLDEST remaining
      // receipt is served first and the one whose stock is newest last (counted opening stock = -1, a
      // confirmed ETA / lot = the day it lands). Members tied on age keep the stock-weighted ratio.
      const oldestArrival = (m: number) => receiptLeft[m].reduce((min, r) => (r.qty_base > EPSILON ? Math.min(min, r.arrived_day) : min), Number.POSITIVE_INFINITY);
      // Owner 2026-10-28: the material that serves FEWER levels is used first (TS U2121 only serves Group B, Combizell A and B,
      // Gabrosa Exclusive + A + B), so a shared material stays in the pool for the narrower levels that can use nothing else.
      // Then FEFO by the age of the oldest remaining receipt; members still tied keep the stock-weighted ratio.
      // Computed once per day: it only orders members, and the day's own receipts / use are already booked here.
      const ageOf = ids.map((_x, m) => oldestArrival(m));
      const priorityTiers = (members: readonly number[]): number[][] => {
        if (members.length === 1) return [[members[0]]];
        const keyOf = (m: number) => levelsServed[m] * 1_000_000 + (ageOf[m] === Number.POSITIVE_INFINITY ? 999_999 : ageOf[m] + 1);
        const keyed = members.map((m) => ({ m, key: keyOf(m) })).sort((a, b) => a.key - b.key);
        const tiers: number[][] = [];
        keyed.forEach(({ m, key }, k) => { if (k > 0 && keyed[k - 1].key === key) tiers[tiers.length - 1].push(m); else tiers.push([m]); });
        return tiers;
      };
      const releaseExcess = () => {
        excessReserve.forEach((reserve) => reserve.forEach((qty, m) => {
          if (qty <= EPSILON) return;
          unreserved[m] = roundQty(unreserved[m] + qty);
          reserve[m] = 0;
        }));
      };
      // Owner 2026-10-28: a level (Exclusive or a group) claims from the pool only when it is at or
      // below its OWN Min (Target) -- or on day 0 -- never merely because a receipt landed. A level that
      // reached Min while the pool was short stays below Min, so it is "waiting" and is served first
      // (narrow -> broad) as soon as stock appears.
      const poolBreach = pools.map((pool, p) => {
        const targetQty = pool.demand[i] + useAhead(pool.demand, i, groupCoverageAt(pool, i).target);
        // `targetQty` includes the current draw plus the configured forward Target window.  A carried balance
        // exactly equal to it still serves today, so the claim is made once it falls BELOW it (strict: with
        // Desired Max = Target an equal balance would otherwise rebuild every day).  Needs future demand.
        return targetQty > EPSILON && purposeReserve[p].reduce((sum, qty) => sum + qty, 0) + EPSILON < targetQty;
      });
      const ownBreach = ids.map((_id, m) => {
        const target = targets[m][i].target;
        if (target === null || memberDesiredMax[m][i] === null || own[m].every((qty) => qty <= EPSILON)) return false;
        // Own use is already drawn at the top of the day, so the reserve is compared with the days still ahead.
        const targetQty = useAhead(own[m], i, target);
        return targetQty > EPSILON && ownReserve[m] + EPSILON < targetQty;
      });
      const hardTargetBreach = poolBreach.some(Boolean) || ownBreach.some(Boolean);
      const allocationEvent = newlyAvailable || hardTargetBreach;
      if (allocationEvent) releaseExcess();
      // Exclusive / own use first: top its reserve up to its own Max from the unreserved stock of that material.
      const poolOf = () => unreserved.reduce((sum, qty) => sum + qty, 0);
      ids.forEach((_id, m) => {
        const desired = memberDesiredMax[m][i];
        if (desired === null || own[m].every((qty) => qty <= EPSILON)) return;
        if (!(i === 0 || ownBreach[m])) return;
        const wanted = Math.max(0, useAhead(own[m], i, desired) - ownReserve[m]);
        const take = Math.min(wanted, unreserved[m]);
        const poolBefore = poolOf();
        if (take > EPSILON) {
          ownReserve[m] = roundQty(ownReserve[m] + take);
          unreserved[m] = roundQty(unreserved[m] - take);
        }
        const stillShort = wanted - Math.max(0, take) > EPSILON;
        const alreadyWaiting = waitingOwn[m];
        waitingOwn[m] = stillShort;
        if (wanted > EPSILON && !(take <= EPSILON && alreadyWaiting)) {
          s.levelEvents.push({
            day: i, kind: take <= EPSILON ? "WAITING" : i === 0 ? "OPENING_RESERVE" : "TOP_UP", level_kind: "OWN", level: m, material: m,
            qty: roundQty(Math.max(0, take)), by_material: ids.map((_x, k) => (k === m ? roundQty(Math.max(0, take)) : 0)),
            wanted: roundQty(wanted), shortfall: roundQty(Math.max(0, wanted - Math.max(0, take))), pool_before: roundQty(poolBefore), pool_after: roundQty(poolOf()), references: [],
            cover_days_after: coverDays(ownReserve[m], own[m], i), min_days: targets[m][i].target,
          });
        }
      });
      if (allocationEvent) pools.forEach((pool, p) => {
        if (!(i === 0 || poolBreach[p])) return;
        let wanted = pool.demand[i] + useAhead(pool.demand, i, groupCoverageAt(pool, i).desired);
        wanted = Math.max(0, wanted - purposeReserve[p].reduce((sum, qty) => sum + qty, 0));
        if (wanted <= EPSILON) return;
        const wantedAtStart = wanted;
        const poolBeforeRefill = poolOf();
        const reserveBeforeRefill = [...purposeReserve[p]];
        const cand = candIdx[p];
        const order = input.group_orders?.get(pool.group_id);
        const normalOrder = order
          ? orderByGroupUsage(cand.map((m) => ids[m]), (id) => unreserved[mIndex.get(id)!], order).map((id) => mIndex.get(id)!)
          : [];
        const expiryFirst = [...cand].filter((m) => receiptLeft[m].some((r) => r.expiry_priority && r.qty_base > EPSILON))
          .sort((a, b) => {
            const earliest = (m: number) => receiptLeft[m].filter((r) => r.expiry_priority && r.qty_base > EPSILON)
              .map((r) => r.valid_until).sort()[0] ?? "9999-12-31";
            return earliest(a).localeCompare(earliest(b)) || ids[a].localeCompare(ids[b]);
          });
        const runDown = order ? [] : [...cand].filter((m) => hasNoFutureReplenishment(ids[m], i)).sort((a, b) => ids[a].localeCompare(ids[b]));
        for (const m of expiryFirst) {
          if (wanted <= EPSILON) break;
          wanted = roundQty(wanted - takeBucket(p, m, wanted));
        }
        if (order) {
          for (const m of normalOrder) {
            if (wanted <= EPSILON) break;
            wanted = roundQty(wanted - takeBucket(p, m, wanted));
          }
        } else {
          for (const m of runDown) {
            if (wanted <= EPSILON) break;
            wanted = roundQty(wanted - takeBucket(p, m, wanted));
          }
          // The no-fixed-order bucket preserves Method C's stock-weighted
          // rotation.  FEFO and run-down have already received their explicit
          // priority share above; the remainder is shared over normal members.
          for (const tier of priorityTiers(cand)) {
            for (let pass = 0; pass < 4 && wanted > EPSILON; pass += 1) {
              const weights = tier.map((m) => unreserved[m] * costTilt[m]);
              const total = weights.reduce((sum, qty) => sum + qty, 0);
              if (total <= EPSILON) break;
              const thisPass = wanted;
              tier.forEach((m, k) => {
                if (wanted <= EPSILON) return;
                wanted = roundQty(wanted - takeBucket(p, m, thisPass * (weights[k] / total)));
              });
            }
          }
        }
        const byMaterial = purposeReserve[p].map((qty, k) => roundQty(qty - reserveBeforeRefill[k]));
        const took = byMaterial.reduce((sum, qty) => sum + qty, 0);
        const poolStillShort = wantedAtStart - Math.max(0, took) > EPSILON;
        const poolAlreadyWaiting = waitingPool[p];
        waitingPool[p] = poolStillShort;
        if (took <= EPSILON && poolAlreadyWaiting) return;
        s.levelEvents.push({
          day: i, kind: took <= EPSILON ? "WAITING" : i === 0 ? "OPENING_RESERVE" : "TOP_UP", level_kind: "GROUP", level: p, material: null,
          qty: roundQty(Math.max(0, took)), by_material: byMaterial, wanted: roundQty(wantedAtStart), shortfall: roundQty(Math.max(0, wantedAtStart - Math.max(0, took))),
          pool_before: roundQty(poolBeforeRefill), pool_after: roundQty(poolOf()), references: [],
          cover_days_after: coverDays(purposeReserve[p].reduce((sum, qty) => sum + Math.max(0, qty), 0), pool.demand, i), min_days: groupCoverageAt(pool, i).target,
        });
      });
      // Second rotation: every genuine residual unit receives one, and only
      // one, purpose owner.  A small slice per group keeps the narrow → broad
      // waterfall fair; the member sequence still observes FEFO, saved order,
      // and no-future-buy run-down before normal stock/cost rotation.
      const takeExcess = (p: number, m: number, qty: number) => {
        const take = Math.min(Math.max(0, qty), unreserved[m]);
        if (take <= EPSILON) return 0;
        excessReserve[p][m] = roundQty(excessReserve[p][m] + take);
        unreserved[m] = roundQty(unreserved[m] - take);
        return take;
      };
      if (allocationEvent) {
        const nextSlice = (pool: Pool) => pool.demand.slice(i).find((qty) => qty > EPSILON) ?? 0;
        // Do not allocate a small day-slice one pass at a time.  A large MOQ
        // (or a low-volume group) can otherwise repeat the exact same
        // narrow-to-broad allocation thousands of times in one request and
        // make every PO22 tab wait for the shared planning query.  Build one
        // genuine waterfall round, then repeat that *same* round in bulk until
        // one material would be exhausted.  The next round re-evaluates FEFO,
        // saved order, run-down and normal stock/cost order from the remaining
        // physical balance.  Thus this is mathematically the same rotation,
        // but bounded by material depletion events rather than stock quantity.
        while (unreserved.some((qty) => qty > EPSILON)) {
          const beforeRound = [...unreserved];
          const roundByPool = pools.map(() => Array.from({ length: M }, () => 0));
          const roundByMaterial = Array.from({ length: M }, () => 0);
          let moved = false;
          pools.forEach((pool, p) => {
            let wanted = nextSlice(pool);
            if (wanted <= EPSILON) return;
            const cand = candIdx[p];
            const order = input.group_orders?.get(pool.group_id);
            const expiryFirst = [...cand].filter((m) => receiptLeft[m].some((r) => r.expiry_priority && r.qty_base > EPSILON))
              .sort((a, b) => ids[a].localeCompare(ids[b]));
            const saved = order
              ? orderByGroupUsage(cand.map((m) => ids[m]), (id) => unreserved[mIndex.get(id)!], order).map((id) => mIndex.get(id)!)
              : [];
            const runDown = order ? [] : [...cand].filter((m) => hasNoFutureReplenishment(ids[m], i)).sort((a, b) => ids[a].localeCompare(ids[b]));
            const normal = [...cand].sort((a, b) => levelsServed[a] - levelsServed[b] || (ageOf[a] === ageOf[b] ? 0 : ageOf[a] < ageOf[b] ? -1 : 1) || unreserved[b] * costTilt[b] - unreserved[a] * costTilt[a] || ids[a].localeCompare(ids[b]));
            for (const m of [...new Set([...expiryFirst, ...saved, ...runDown, ...normal])]) {
              if (wanted <= EPSILON) break;
              const took = takeExcess(p, m, wanted);
              wanted = roundQty(wanted - took);
              if (took <= EPSILON) continue;
              roundByPool[p][m] = roundQty(roundByPool[p][m] + took);
              roundByMaterial[m] = roundQty(roundByMaterial[m] + took);
              moved = true;
            }
          });
          if (!moved) break;

          // A complete round has just been applied.  Repeat it as many times
          // as every material used in that round can support.  The smallest
          // quotient identifies the next material boundary; after it, a fresh
          // normal-order calculation is required and the loop continues.
          let extraRounds = Number.POSITIVE_INFINITY;
          roundByMaterial.forEach((used, m) => {
            if (used <= EPSILON) return;
            extraRounds = Math.min(extraRounds, Math.max(0, Math.floor((beforeRound[m] + EPSILON) / used) - 1));
          });
          if (!(extraRounds > 0 && Number.isFinite(extraRounds))) continue;
          pools.forEach((_pool, p) => roundByPool[p].forEach((used, m) => {
            if (used <= EPSILON) return;
            const additional = roundQty(used * extraRounds);
            excessReserve[p][m] = roundQty(excessReserve[p][m] + additional);
            unreserved[m] = roundQty(Math.max(0, unreserved[m] - additional));
          }));
        }
      }
      pools.forEach((pool, p) => {
        let need = pool.demand[i];
        if (need <= EPSILON) return;
        const cand = candIdx[p];
        // Owner 2026-10-29 (PDF "How PO22 plans RM purchases"): a level uses its OWN reserve; the pool changes only on a receipt or a top-up.
        // The movable second-rotation excess is a fallback only when the level's own reserve cannot cover today's use (the level is waiting).
        const ownReserveToday = purposeReserve[p].reduce((sum, qty) => sum + Math.max(0, qty), 0);
        const useExcess = ownReserveToday + EPSILON < need;
        const free = (m: number) => Math.max(0, purposeReserve[p][m]) + (useExcess ? Math.max(0, excessReserve[p][m]) : 0);
        const order = input.group_orders?.get(pool.group_id);
        const ordered = (fn: (m: number) => number) => (order
          ? orderByGroupUsage(cand.map((m) => ids[m]), (id) => fn(mIndex.get(id)!), order).map((id) => mIndex.get(id)!)
          : [...cand].sort((a, b) => fn(b) - fn(a) || cand.indexOf(a) - cand.indexOf(b)));
        const takeFrom = (m: number, wantedQty: number) => {
          // A proportional share can exceed the physical balance by a rounding residue; a group never draws stock that is not there.
          const qty = Math.min(wantedQty, Math.max(0, bal[m]));
          if (qty <= EPSILON) return;
          bal[m] -= qty;
          const hard = Math.min(Math.max(0, purposeReserve[p][m]), qty);
          purposeReserve[p][m] = roundQty(purposeReserve[p][m] - hard);
          excessReserve[p][m] = roundQty(excessReserve[p][m] - Math.max(0, qty - hard));
          need -= qty; s.draw[m][i] += qty; s.use[m][i] += qty; s.poolDraw[p][m][i] += qty;
          let left = qty;
          for (const receipt of receiptLeft[m]) {
            if (left <= EPSILON) break;
            const used = Math.min(left, receipt.qty_base);
            receipt.qty_base -= used;
            left -= used;
            s.sourceDraws.push({
              day: i, material: m, destination_kind: "GROUP", group: p, qty: used,
              source_reference: receipt.reference, source_kind: receipt.source_kind,
            });
          }
        };
        // A short-life GRN/Opening receipt gets first call on this group's
        // available stock.  This intentionally overrides a saved group order
        // only for that expiring quantity; normal order/Method C resumes after.
        const expiryFirst = [...cand].filter((m) => receiptLeft[m].some((r) => r.expiry_priority && r.qty_base > EPSILON))
          .sort((a, b) => {
            const earliest = (m: number) => receiptLeft[m].filter((r) => r.expiry_priority && r.qty_base > EPSILON)
              .map((r) => r.valid_until).sort()[0] ?? "9999-12-31";
            return earliest(a).localeCompare(earliest(b)) || ids[a].localeCompare(ids[b]);
          });
        for (const m of expiryFirst) {
          if (need <= EPSILON) break;
          const priorityQty = receiptLeft[m].filter((r) => r.expiry_priority).reduce((sum, r) => sum + r.qty_base, 0);
          const take = Math.min(free(m), priorityQty, need);
          if (take > EPSILON) takeFrom(m, take);
        }
        if (order) {
          for (const m of ordered(free)) {
            if (need <= EPSILON) break;
            const take = Math.min(free(m), need);
            if (take > EPSILON) takeFrom(m, take);
          }
        } else {
          // A member not authorised for a buy in any remaining month is not
          // discarded. After FEFO it is deliberately run down before normal
          // proportional rotation with replenishable alternatives.
          for (const m of [...cand].filter((member) => hasNoFutureReplenishment(ids[member], i)).sort((a, b) => ids[a].localeCompare(ids[b]))) {
            if (need <= EPSILON) break;
            const take = Math.min(free(m), need);
            if (take > EPSILON) takeFrom(m, take);
          }
          // Smart consumption ratio (owner 2026-10-22, default): the group's use is shared over the
          // members in proportion to their free stock, tilted to the costlier stock (it ties up more
          // working capital). Every member rotates, none piles up, own use stays protected, and the
          // ratio changes by itself as arrivals change each member's free stock.
          for (const tier of priorityTiers(cand)) {
            for (let pass = 0; pass < 4 && need > EPSILON; pass += 1) {
              const weights = tier.map((m) => free(m) * costTilt[m]);
              const total = weights.reduce((a, b) => a + b, 0);
              if (total <= EPSILON) break;
              const want = need;
              tier.forEach((m, k) => {
                const take = Math.min(free(m), want * (weights[k] / total), need);
                if (take > EPSILON) takeFrom(m, take);
              });
            }
          }
        }
        if (need > EPSILON) s.poolFreeShort[p][i] = need;
        if (need > EPSILON) s.poolUnmet[p][i] = need;
      });
      // Owner 2026-10-29: end of day, how many days each level's OWN reserve still covers against its Min (Target).
      // A level left below its Min (the pool could not refill it) is the risk a lot must prevent, day by day.
      pools.forEach((pool, p) => {
        const cover = coverDays(purposeReserve[p].reduce((sum, qty) => sum + Math.max(0, qty), 0), pool.demand, i);
        const policy = groupCoverageAt(pool, i);
        if (cover !== null && cover + 1e-9 < policy.target) s.risk.push({ day: i, kind: "GROUP", level: p, cover, min: policy.target, critical: policy.critical });
      });
      ids.forEach((_id, m) => {
        const target = targets[m][i].target;
        if (target === null || own[m].every((qty) => qty <= EPSILON)) return;
        const cover = coverDays(ownReserve[m], own[m], i);
        if (cover !== null && cover + 1e-9 < target) s.risk.push({ day: i, kind: "OWN", level: m, cover, min: target, critical: targets[m][i].critical });
      });
      if (input.level_days) {
        s.levelDays.push({
          day: i, pool_qty: roundQty(ids.reduce((sum, _x, m) => sum + Math.max(0, bal[m] - ownReserve[m] - purposeReserve.reduce((acc, reserve) => acc + Math.max(0, reserve[m]), 0)), 0)),
          levels: [
            ...ids.flatMap((_id, m) => (own[m].every((qty) => qty <= EPSILON) ? [] : [{ kind: "OWN" as const, level: m, cover: coverDays(ownReserve[m], own[m], i), maxCover: coverDays(ownReserve[m] + ids.reduce((sum, _x, k) => sum + Math.max(0, bal[k] - ownReserve[k] - purposeReserve.reduce((acc, reserve) => acc + Math.max(0, reserve[k]), 0)), 0), own[m], i), min: targets[m][i].target, max: memberDesiredMax[m][i], reserve: roundQty(ownReserve[m]) }])),
            ...pools.map((pool, p) => ({ kind: "GROUP" as const, level: p, cover: coverDays(purposeReserve[p].reduce((sum, qty) => sum + Math.max(0, qty), 0), pool.demand, i), maxCover: coverDays(purposeReserve[p].reduce((sum, qty) => sum + Math.max(0, qty), 0) + ids.reduce((sum, _x, k) => sum + Math.max(0, bal[k] - ownReserve[k] - purposeReserve.reduce((acc, reserve) => acc + Math.max(0, reserve[k]), 0)), 0), pool.demand, i), min: groupCoverageAt(pool, i).target, max: groupCoverageAt(pool, i).desired, reserve: roundQty(purposeReserve[p].reduce((sum, qty) => sum + Math.max(0, qty), 0)) })),
          ],
        });
      }
      pools.forEach((_pool, p) => {
        const bucketFree = purposeReserve[p].reduce((sum, qty) => sum + Math.max(0, qty), 0)
          + excessReserve[p].reduce((sum, qty) => sum + Math.max(0, qty), 0);
        s.poolFree[p][i] = roundQty(bucketFree);
        // The existing bucket table remains the auditable Desired-Max hard
        // protection.  Movable second-rotation excess contributes to actual
        // coverage (`poolFree`) but is deliberately not mislabelled as a
        // group-specific Desired-Max reservation.
        ids.forEach((_id, m) => { s.poolBucket[p][m][i] = roundQty(Math.max(0, purposeReserve[p][m]) + s.poolDraw[p][m][i]); });
      });
      for (let m = 0; m < M; m += 1) {
        s.closing[m][i] = bal[m];
        s.ownBalance[m][i] = bal[m];
        s.ownAvail[m][i] = ownReserve[m] + Math.max(0, bal[m] - ownReserve[m] - purposeReserve.reduce((sum, reserve) => sum + Math.max(0, reserve[m]), 0));
        s.freeAfter[m][i] = Math.max(0, bal[m] - protection[m][i]);
      }
      // Owner 2026-10-28: a Material × Level snapshot on every event day (and the first / last day) for the 4A table / Excel.
      if (input.trace !== false && (i === 0 || i === N - 1 || s.levelEvents.length > eventsAtDayStart || checkpointDays.has(allDays[i]))) {
        s.matrix.push({
          day: i, own: ids.map((_x, m) => roundQty(ownReserve[m])), groups: pools.map((_pool, p) => purposeReserve[p].map((qty) => roundQty(Math.max(0, qty)))),
          pool: ids.map((_x, m) => roundQty(Math.max(0, bal[m] - ownReserve[m] - purposeReserve.reduce((sum, reserve) => sum + Math.max(0, reserve[m]), 0)))),
          closing: ids.map((_x, m) => roundQty(bal[m])),
        });
      }
    }
    return s;
  };

  const engineLots: Planned[] = [];
  const buys: FamilyBuy[] = [];
  const sequence = new Map<string, number>();
  const pendingOwn = new Map<string, number>(); // material → index up to which its own need is handled
  const pendingGroup = new Map<string, number>(); // pool key → index

  type Need = { kind: "OWN" | "GROUP"; index: number; material: string; pool?: Pool; option: ReturnType<typeof pickVendorOption>; late: boolean };
  const monthOf = (i: number) => `${allDays[i].slice(0, 7)}-01`;
  // Selection only controls a *new* engine lot. Existing stock, confirmed
  // arrivals, and a user-fixed lot are always simulated. A material outside
  // the selector keeps legacy behavior because the user has no UI control for
  // it; a displayed candidate is fail-closed when unchecked.
  const isSelectedForNewBuy = (id: string, i: number) => !input.selection_controlled_members?.has(id)
    || Boolean(input.selections?.get(monthOf(i))?.has(id));
  /** Existing stock stays eligible; no authorised future buy makes it run-down priority. */
  const hasNoFutureReplenishment = (id: string, i: number) => Boolean(input.selection_controlled_members?.has(id))
    && !allDays.slice(i).some((_day, offset) => isSelectedForNewBuy(id, i + offset));

  const ownNeed = (sim: Sim, m: number): Need | null => {
    const id = ids[m];
    const policy = policyOf.get(id);
    // Owner 2026-10-27: a material with NO exclusive use of its own, that only serves
    // groups, has no individual guard. Its use is whatever the waterfall happens to draw
    // from it, so a guard on that draw is self-fulfilling: the biggest stock is drawn
    // first and always "falls to Target" first even while the group is comfortable (and
    // every lot it receives raises its own draw again). When such a member runs out the
    // other members carry the group; a purchase is needed only when the group itself
    // falls to its Target (groupNeed). Exclusive use keeps its guard.
    const usesGroupAsIndividualDemand = isSharedGroupMember[m] && own[m].every((qty) => qty <= EPSILON);
    if (usesGroupAsIndividualDemand) return null;
    const memberUse = own[m];
    if (!policy || memberUse.every((q) => q <= EPSILON)) return null;
    const from = (pendingOwn.get(id) ?? -1) + 1;
    for (let i = from; i < N; i += 1) {
      const t = targets[m][i].target;
      if (t === null || targets[m][i].critical === null) continue;
      const cover = isSharedGroupMember[m]
        ? coverDays(sim.ownAvail[m][i], memberUse, i)
        : standaloneCoverageDays(sim.ownBalance[m][i], own[m], i, finalOwnDailyUse[m][i]);
      const safetyFloor = isSharedGroupMember[m] ? 0 : finalOwnDailyUse[m][i] * t;
      const atCoverageTarget = cover !== null && cover <= t;
      const atPhysicalSafetyFloor = safetyFloor > EPSILON && sim.ownBalance[m][i] <= safetyFloor + EPSILON;
      if (atCoverageTarget || atPhysicalSafetyFloor) {
        if (!isSelectedForNewBuy(id, i)) continue;
        const option = pickVendorOption(policy, allDays[i], input.as_of);
        if (!option && totalLeadTimeDays(policy) === null) return null;
        const lead = option?.option.lead_time_days ?? totalLeadTimeDays(policy);
        const earliest = lead === null ? null : Math.max(0, lead);
        const late = earliest !== null && i < earliest;
        // Owner 2026-10-28: a LATE need (no lot can land before the shortage day) is only worth a lot if the item is still short when the
        // earliest lot could land, counting what already arrives by then. A confirmed PO landing two days after the dip cures it
        // (Action tab: PM-00060 asked "Order today" with a 10,000 PO arriving on 13 Nov).
        if (late && earliest !== null) {
          const ai = Math.min(N - 1, earliest);
          const coverAtArrival = isSharedGroupMember[m]
            ? coverDays(sim.ownAvail[m][ai], memberUse, ai)
            : standaloneCoverageDays(sim.ownBalance[m][ai], own[m], ai, finalOwnDailyUse[m][ai]);
          const floorAtArrival = isSharedGroupMember[m] ? 0 : finalOwnDailyUse[m][ai] * t;
          const coverOk = coverAtArrival === null || coverAtArrival > t;
          const floorOk = floorAtArrival <= EPSILON || sim.ownBalance[m][ai] > floorAtArrival + EPSILON;
          if (coverOk && floorOk) continue;
        }
        return { kind: "OWN", index: i, material: id, option, late };
      }
    }
    return null;
  };

  const groupNeed = (sim: Sim, p: number): Need | null => {
    const pool = pools[p];
    const from = (pendingGroup.get(pool.key) ?? -1) + 1;
    // Free stock of the pool's members after day i, against the pool's own use ahead.
    const freeCover = (i: number) => coverDays(sim.poolFree[p][i], pool.demand, i);
    let best: Need | null = null;
    let bestRank: [number, number, number, number, number] | null = null;
    pool.candidates.forEach((id, order) => {
      const m = mIndex.get(id);
      const policy = policyOf.get(id);
      if (m === undefined || !policy) return;
      let needIndex = -1;
      let needBuyAt = 0;
      for (let i = from; i < N; i += 1) {
      const groupCoverage = groupCoverageAt(pool, i);
      if (groupCoverage.target === null || groupCoverage.critical === null) continue;
        const cover = freeCover(i);
        // Owner 2026-10-28: the group refills from the pool at the GROUP's Min, but a member that has to be BOUGHT is connected
        // at its OWN Min (Gabrosa 20 days inside a 30-day group), not at the group's.
        const buyAt = targets[m][i].target ?? groupCoverage.target;
        if (sim.poolFreeShort[p][i] > EPSILON || (cover !== null && cover <= buyAt)) { needIndex = i; needBuyAt = buyAt; break; }
      }
      if (needIndex < 0) return;
      // This is a real authorization, not a cost preference: a member the
      // buyer left unchecked must never be substituted just because it is
      // cheaper or faster. With no selected candidate, no lot is created and
      // the pool shortage remains visible for the user to resolve.
      if (!isSelectedForNewBuy(id, needIndex)) return;
      const option = pickVendorOption(policy, allDays[needIndex], input.as_of);
      const lead = option?.option.lead_time_days ?? totalLeadTimeDays(policy);
      if (lead === null) return; // cannot be bought (no vendor / lead time)
      const late = lead !== null && needIndex < lead;
      // Owner 2026-10-28: a LATE need (no lot can land before the shortage day) is only worth a lot if the group is still short when the
      // earliest lot could land. If a lot already placed for a sibling group (or a confirmed arrival) lifts the group's cover above
      // this member's Min by then, a second lot on the same date is not needed (CMP005 RDP: two Dairen lots on 20 Dec).
      if (late && lead !== null) {
        const arrivalCover = freeCover(Math.min(N - 1, lead));
        if (arrivalCover === null || arrivalCover > needBuyAt) return;
      }
      const rank: [number, number, number, number, number] = [
        late ? 1 : 0,
        late ? (lead ?? Number.POSITIVE_INFINITY) : (option?.option.unit_cost ?? Number.POSITIVE_INFINITY),
        needIndex,
        order,
        // Kept deterministic for equally priced/dated selected candidates.
        0,
      ];
      if (!bestRank || lexLess(rank, bestRank)) {
        bestRank = rank;
        best = { kind: "GROUP", index: needIndex, material: id, pool, option, late };
      }
    });
    return best;
  };

  /**
   * One physical purchase can cover more than one requirement.  In particular,
   * an own/exclusive guard and one eligible group can ask for the
   * same material on the same arrival day.  They are separate safety purposes,
   * not separate POs: net their requirements first, then apply MOQ/multiple
   * once.  The next simulation allocates that one receipt through the normal
   * event-day waterfall.
   */
  const place = (needsForLot: readonly Need[], sim: Sim) => {
    const need = needsForLot[0];
    const id = need.material;
    const m = mIndex.get(id)!;
    const policy = policyOf.get(id)!;
    const t = need.kind === "GROUP" ? groupCoverageAt(need.pool!, need.index).target : targets[m][need.index].target ?? 0;
    const lead = need.option?.option.lead_time_days ?? totalLeadTimeDays(policy) ?? 0;
    const arrivalIndex = need.late ? Math.min(N - 1, lead) : need.index;
    let lotQty: number;
    {
      const cycle = need.option?.option.cycle_days ?? policy.cycle_days ?? DEFAULT_CYCLE_DAYS;
      // For an individual/member guard, a saved Desired-Max override replaces
      // the calculated Target + cycle.  Group coverage keeps its independently
      // derived/overridden Desired Max.
      const window = need.kind === "GROUP"
        ? groupCoverageAt(need.pool!, need.index).desired
        : memberDesiredMax[m][need.index] ?? (t + cycle);
      const before = arrivalIndex - 1;
      const usesGroupAsIndividualDemand = isSharedGroupMember[m] && own[m].every((qty) => qty <= EPSILON);
      const memberUse = usesGroupAsIndividualDemand ? sim.use[m] : own[m];
      const demandRequired = need.kind === "OWN"
        ? useAhead(memberUse, before, window + 1) - Math.max(0, before >= 0 ? sim.ownBalance[m][before] : Number(input.opening_qty_by_material[id] ?? 0))
        : useAhead(need.pool!.demand, before, window + 1) - (before >= 0 ? sim.poolFree[pools.indexOf(need.pool!)][before] : 0);
      const availableBeforeArrival = Math.max(0, before >= 0 ? sim.ownBalance[m][before] : Number(input.opening_qty_by_material[id] ?? 0));
      // Scope deliberately limited to standalone own-use materials (Tot White).
      // On a zero-demand gap, demandRequired would otherwise round to a
      // meaningless epsilon lot even though the configured physical Target
      // reserve is being exhausted.  Refill to Target + order cycle using the
      // last approved non-zero daily own-use rate; do not simulate fake use.
      const safetyRequired = need.kind === "OWN" && !isSharedGroupMember[m]
        ? Math.max(0, own[m][arrivalIndex] + finalOwnDailyUse[m][need.index] * window - availableBeforeArrival)
        : 0;
      const required = Math.max(demandRequired, safetyRequired);
      const requiredByNeed = [required];
      for (const other of needsForLot.slice(1)) {
        const otherPoolIndex = other.pool ? pools.indexOf(other.pool) : -1;
        const otherTarget = other.kind === "GROUP" ? groupCoverageAt(other.pool!, other.index).target : targets[m][other.index].target ?? 0;
        const otherWindow = other.kind === "GROUP"
          ? groupCoverageAt(other.pool!, other.index).desired
          : memberDesiredMax[m][other.index] ?? (otherTarget + cycle);
        const otherBefore = arrivalIndex - 1;
        const otherMemberUse = usesGroupAsIndividualDemand ? sim.use[m] : own[m];
        const otherDemandRequired = other.kind === "OWN"
          ? useAhead(otherMemberUse, otherBefore, otherWindow + 1) - Math.max(0, otherBefore >= 0 ? sim.ownBalance[m][otherBefore] : Number(input.opening_qty_by_material[id] ?? 0))
          : useAhead(other.pool!.demand, otherBefore, otherWindow + 1) - (otherBefore >= 0 ? sim.poolFree[otherPoolIndex][otherBefore] : 0);
        const otherSafetyRequired = other.kind === "OWN" && !isSharedGroupMember[m]
          ? Math.max(0, own[m][arrivalIndex] + finalOwnDailyUse[m][other.index] * otherWindow - availableBeforeArrival)
          : 0;
        requiredByNeed.push(Math.max(otherDemandRequired, otherSafetyRequired));
      }
      let combinedRequired = requiredByNeed.reduce((sum, qty) => sum + Math.max(0, qty), 0);
      // When several direct/group purposes require this exact material/vendor/
      // arrival, size one physical receipt from a single purpose ledger.  It
      // allocates the real pre-arrival stock Direct → narrow → broad first, so
      // shared stock is not subtracted once for every visible group row.
      if (needsForLot.length > 1) {
        const opening = Object.fromEntries(ids.map((material, materialIndex) => [
          material,
          Math.max(0, before >= 0 ? sim.ownBalance[materialIndex][before] : Number(input.opening_qty_by_material[material] ?? 0)),
        ]));
        const ledger = runFamilyPurposeLedger({
          opening,
          supplies: [],
          days: 1,
          purposes: needsForLot.map((candidate) => {
            const candidateMaterial = mIndex.get(candidate.material)!;
            const candidateTarget = candidate.kind === "GROUP"
              ? groupCoverageAt(candidate.pool!, candidate.index).target
              : targets[candidateMaterial][candidate.index].target ?? 0;
            const candidateWindow = candidate.kind === "GROUP"
              ? groupCoverageAt(candidate.pool!, candidate.index).desired
              : memberDesiredMax[candidateMaterial][candidate.index] ?? (candidateTarget + cycle);
            const candidateUse = candidate.kind === "GROUP"
              ? candidate.pool!.demand
              : (isSharedGroupMember[candidateMaterial] && own[candidateMaterial].every((qty) => qty <= EPSILON)
                ? sim.use[candidateMaterial]
                : own[candidateMaterial]);
            return {
              id: `${candidate.kind}:${candidate.pool?.key ?? candidate.material}`,
              priority: candidate.kind === "OWN" ? 0 : 1 + pools.indexOf(candidate.pool!),
              candidates: candidate.kind === "OWN" ? [candidate.material] : candidate.pool!.candidates,
              demand: [candidateUse[arrivalIndex] ?? 0],
              target_balance: [useAhead(candidateUse, arrivalIndex + 1, candidateTarget)],
              desired_balance: [useAhead(candidateUse, arrivalIndex + 1, candidateWindow)],
            };
          }),
        });
        combinedRequired = ledger.rows.reduce((sum, row) => sum + row.shortage_qty + row.desired_shortfall_qty, 0);
      }
      const constraints = need.option
        ? { ...policy, vendor_moq_qty_base: need.option.option.moq_qty_base, order_multiple_qty_base: need.option.option.order_multiple_qty_base, delivery_lot_qty_base: need.option.option.delivery_lot_qty_base ?? null }
        : policy;
      const orderQty = applySinglePurchaseConstraints(Math.max(roundQty(combinedRequired), EPSILON * 10), constraints) ?? 0;
      lotQty = orderQty;
      const seq = (sequence.get(id) ?? 0) + 1;
      sequence.set(id, seq);
      const bookingDays = bookingDaysOf(policy, need.option?.option.booking_time_days);
      const poBy = addDays(allDays[need.index], -lead - bookingDays);
      const poLate = !need.late && poBy < input.as_of;
      const covers = [...new Set(needsForLot.flatMap((candidate) => candidate.kind === "OWN"
        ? [usesGroupAsIndividualDemand ? "MEMBER_GUARD" : "OWN"]
        : [candidate.pool!.group_id]))];
      const groupTrigger = need.kind === "GROUP";
      const triggerMin = groupTrigger ? (targets[m][need.index].target ?? t) : t;
      const triggerCover = groupTrigger
        ? coverDays(sim.poolFree[pools.indexOf(need.pool!)][need.index], need.pool!.demand, need.index)
        : (isSharedGroupMember[m] ? coverDays(sim.ownAvail[m][need.index], own[m], need.index) : standaloneCoverageDays(sim.ownBalance[m][need.index], own[m], need.index, finalOwnDailyUse[m][need.index]));
      const why = needsForLot.length === 1
        ? (need.kind === "OWN"
          ? (usesGroupAsIndividualDemand
            ? `Member guard: its allocated eligible-group use falls to its individual Target ${t} days on ${allDays[need.index]}.`
            : `Own use: cover of its own (exclusive) use falls to Target ${t} days on ${allDays[need.index]}.`)
          : `Group ${need.pool!.group_id}: free stock of its members falls to ${triggerMin} days (this member's own Min) on ${allDays[need.index]}; refill is sized to Group Desired Max ${window} days; ${need.late ? "fastest member to arrive" : "cheapest member that arrives in time"}.`)
        : `One physical ${id} lot nets ${covers.map((cover) => cover === "OWN" ? "own use" : cover === "MEMBER_GUARD" ? "member guard" : `group ${cover}`).join(" + ")} on the same arrival date; MOQ / multiple applied once, then the event-day waterfall allocates it.`;
      buys.push({
        material_id: id, sequence: seq, required_qty_base: roundQty(Math.max(0, combinedRequired)), recommended_po_qty_base: orderQty,
        recommended_po_by: need.late ? input.as_of : poBy, estimated_plant_eta: allDays[arrivalIndex], need_date: allDays[need.index],
        lots: [{ lot_no: 1, plant_eta: allDays[arrivalIndex], qty_base: roundQty(lotQty) }], total_lead_time_days: lead,
        status: need.late ? "ADVISORY_LATE" : "ADVISORY",
        reason: need.late ? `${why} PO-by ${poBy} has passed; ordering today arrives ${allDays[arrivalIndex]}.` : `${why} Sized to Desired Max ${window} days; MOQ / multiple respected.${poLate ? ` PO-by ${poBy} (${bookingDays} d booking before dispatch) has passed - PO is late; ask the vendor to dispatch at once.` : ""}`,
        advisory_only: true,
        vendor_id: need.option?.option.vendor_id ?? null, max_cover_days: roundQty(window),
        bridge: need.option?.bridge ?? false, cheapest_vendor_id: need.option?.cheapest ?? null,
        covers, need_kind: needsForLot.some((candidate) => candidate.kind === "GROUP") ? "GROUP" : "OWN",
        trigger_cover_days: triggerCover, trigger_min_days: triggerMin, trigger_group_id: groupTrigger ? need.pool!.group_id : null,
      });
      engineLots.push({
        material_id: id,
        index: arrivalIndex,
        qty: lotQty,
        source_reference: `Engine lot ${id} #${sequence.get(id) ?? 1}`,
        source_kind: "ENGINE_LOT",
      });
    }
    for (const candidate of needsForLot) {
      if (candidate.kind === "OWN") pendingOwn.set(id, candidate.late ? arrivalIndex : candidate.index);
      else pendingGroup.set(candidate.pool!.key, candidate.late ? arrivalIndex : candidate.index);
    }
  };

  let sim = simulate([...manual]);
  if (input.plan_buys !== false) {
    for (let iteration = 0; iteration < MAX_LOTS; iteration += 1) {
      const needs: Need[] = [];
      for (let m = 0; m < M; m += 1) { const n = ownNeed(sim, m); if (n) needs.push(n); }
      for (let p = 0; p < pools.length; p += 1) { const n = groupNeed(sim, p); if (n) needs.push(n); }
      if (needs.length === 0) break;
      // DEPENDENT: one lot at a time, earliest need first; the next need is found on the new projection.
      needs.sort((a, b) => a.index - b.index || (a.kind === "OWN" ? 0 : 1) - (b.kind === "OWN" ? 0 : 1) || a.material.localeCompare(b.material));
      const first = needs[0];
      const firstPolicy = policyOf.get(first.material)!;
      const firstLead = first.option?.option.lead_time_days ?? totalLeadTimeDays(firstPolicy) ?? 0;
      const firstArrival = first.late ? Math.min(N - 1, firstLead) : first.index;
      const sameArrivalNeeds = needs.filter((candidate) => {
        if (candidate.material !== first.material) return false;
        const policy = policyOf.get(candidate.material)!;
        const lead = candidate.option?.option.lead_time_days ?? totalLeadTimeDays(policy) ?? 0;
        const arrival = candidate.late ? Math.min(N - 1, lead) : candidate.index;
        return arrival === firstArrival && (candidate.option?.option.vendor_id ?? null) === (first.option?.option.vendor_id ?? null);
      });
      // An own guard and one group need can safely be netted into this receipt.
      // Leave additional same-material groups for the next whole-family
      // simulation: their pools may overlap, so blindly summing them here
      // could count the same eligible stock twice.
      const sameReceipt = sameArrivalNeeds;
      place(sameReceipt, sim);
      sim = simulate([...manual, ...engineLots]);
    }
  }

  // Output in the Phase 3D shape so every screen / export keeps working.
  const rows: OptimizerDailyProjectionRow[] = [];
  const risks: OptimizerMaterialRisk[] = [];
  ids.forEach((id, m) => {
    let firstShortage: string | null = null;
    let firstCritical: string | null = null;
    let firstTarget: string | null = null;
    for (let i = 0; i < N; i += 1) {
      const { target, critical } = targets[m][i];
      const closing = roundQty(sim.closing[m][i]);
      const opening = i === 0 ? Number(input.opening_qty_by_material[id] ?? 0) : sim.closing[m][i - 1];
      // Do not count a later zero-demand calendar month as hundreds of days
      // of cover for a standalone item.  Shared-group coverage retains the
      // existing family allocator semantics until that design is finalised.
      const maxCover = isSharedGroupMember[m]
        ? coverDays(closing, sim.use[m], i)
        : standaloneCoverageDays(closing, sim.use[m], i, finalOwnDailyUse[m][i]);
      const minStock = roundQty(closing - sim.arrival[m][i] - sim.planned[m][i]);
      if (firstShortage === null && closing < -EPSILON) firstShortage = allDays[i];
      if (firstCritical === null && critical !== null && maxCover !== null && maxCover <= critical) firstCritical = allDays[i];
      if (firstTarget === null && target !== null && maxCover !== null && maxCover <= target) firstTarget = allDays[i];
      rows.push({
        material_id: id, day: allDays[i], opening_qty_base: roundQty(opening), confirmed_arrival_qty_base: roundQty(sim.arrival[m][i]),
        planned_lot_qty_base: roundQty(sim.planned[m][i]), demand_qty_base: roundQty(sim.use[m][i]), group_draw_qty_base: roundQty(sim.draw[m][i]),
        closing_qty_base: closing, max_cover_days: maxCover, min_stock_qty_base: minStock,
        min_cover_days: isSharedGroupMember[m]
          ? coverDays(minStock, sim.use[m], i)
          : standaloneCoverageDays(minStock, sim.use[m], i, finalOwnDailyUse[m][i]),
        target_days: target, critical_days: critical, executable_arrival: false,
      });
    }
    risks.push({ material_id: id, first_shortage_day: firstShortage, first_below_critical_day: firstCritical, first_below_target_day: firstTarget, projected_closing_qty_base: roundQty(sim.closing[m][N - 1]) });
    if (!buys.some((b) => b.material_id === id)) {
      const policy = policyOf.get(id);
      const hasPolicy = !!policy && allDays.some((d) => { const c = targetAt(policy, d); return c.target !== null && c.critical !== null; });
      buys.push({
        material_id: id, sequence: 0, required_qty_base: Math.max(0, roundQty(-sim.closing[m][N - 1])), recommended_po_qty_base: null, recommended_po_by: null,
        estimated_plant_eta: null, need_date: null, lots: [] as OptimizerPlannedLot[], total_lead_time_days: policy ? totalLeadTimeDays(policy) : null,
        status: hasPolicy ? "NO_BUY" : "UNKNOWN_POLICY",
        reason: hasPolicy ? "Own use and the groups it serves stay covered through the horizon (stock, arrivals and other members' lots)." : "Target/Critical policy is missing; no new-buy quantity is authorized.",
        advisory_only: true, covers: [], need_kind: "OWN",
      });
    }
  });

  const unmetByGroup = new Map<string, { qty: number; first: string | null }>();
  const groupUnmet: Array<{ group_id: string; day: string; qty_base: number }> = [];
  pools.forEach((pool, p) => {
    for (let i = 0; i < N; i += 1) {
      const q = sim.poolUnmet[p][i];
      if (q <= EPSILON) continue;
      groupUnmet.push({ group_id: pool.group_id, day: allDays[i], qty_base: roundQty(q) });
      const seen = unmetByGroup.get(pool.group_id) ?? { qty: 0, first: null };
      unmetByGroup.set(pool.group_id, { qty: roundQty(seen.qty + q), first: seen.first ?? allDays[i] });
    }
  });
  const groupPoolRisks: OptimizerGroupPoolRisk[] = [...unmetByGroup].sort(([a], [b]) => a.localeCompare(b))
    .map(([group_id, v]) => ({ group_id, unresolved_qty_base: v.qty, first_day: v.first }));

  // Target is the desired operating safety; Critical is the escalation point.
  // Do not hide a Critical group merely because the planner could not create a
  // buy: surface the agreed operational sequence rather than calling the plan
  // unworkable or silently consuming protected stock.
  const groupActions: FamilyResult["group_actions"][number][] = pools.flatMap((pool, p) => {
    let firstTarget: string | null = null;
    let firstCritical: string | null = null;
    let firstShortage: string | null = null;
    for (let i = 0; i < N; i += 1) {
      const coverage = groupCoverageAt(pool, i);
      const cover = coverDays(sim.poolFree[p][i], pool.demand, i);
      if (firstTarget === null && cover !== null && cover <= coverage.target) firstTarget = allDays[i];
      if (firstCritical === null && cover !== null && cover <= coverage.critical) firstCritical = allDays[i];
      if (firstShortage === null && sim.poolUnmet[p][i] > EPSILON) firstShortage = allDays[i];
    }
    if (firstCritical === null && firstShortage === null) return [];
    const unresolvedQty = groupUnmet.filter((row) => row.group_id === pool.group_id).reduce((sum, row) => sum + row.qty_base, 0);
    return [{
      group_id: pool.group_id,
      first_below_target_day: firstTarget,
      first_below_critical_day: firstCritical,
      first_shortage_day: firstShortage,
      unresolved_qty_base: roundQty(unresolvedQty),
      ordered_actions: [
        "Bridge lot from an eligible member/vendor",
        "Transfer from an eligible company/location surplus",
        "Expedite or use a faster eligible vendor",
        "Approve an eligible alternative material",
        "Escalate emergency action; report the exact stock-out date if no option is feasible",
      ],
    }];
  });

  // Explainability is emitted by the simulator itself, never re-derived by
  // the browser from closing balances.  The trace retains the planning source
  // that actually supplied a draw (opening, a dated ERP receipt, a fixed lot
  // or an engine lot).  It remains planning evidence, not a Store issue post.
  const allocationRows: FamilyResult["allocation_rows"][number][] = sim.sourceDraws
    .filter((row) => row.qty > EPSILON)
    .map((row) => ({
      day: allDays[row.day], material_id: ids[row.material],
      destination_kind: row.destination_kind,
      group_id: row.group === null ? null : pools[row.group].group_id,
      qty_base: roundQty(row.qty), closing_qty_base: roundQty(sim.closing[row.material][row.day]),
      source_reference: row.source_reference, source_kind: row.source_kind,
      rule: row.destination_kind === "OWN" ? "DIRECT_EXCLUSIVE_RESERVE" : "GROUP_WATERFALL",
    }));

  // This is a calculation invariant, not a browser-side report formula. It
  // locks every current/future source to one direct/group destination or the
  // retained closing/expiry balance before later waterfall work is added.
  const allocationReconciliation: FamilyResult["allocation_reconciliation"][number][] = ids.map((id, m) => {
    const opening = Math.max(0, Number(input.opening_qty_by_material[id] ?? 0));
    const confirmedQty = confirmed[m].reduce((sum, qty) => sum + qty, 0);
    const plannedQty = sim.planned[m].reduce((sum, qty) => sum + qty, 0);
    const ownQty = own[m].reduce((sum, qty) => sum + qty, 0);
    const groupQty = sim.draw[m].reduce((sum, qty) => sum + qty, 0);
    const closing = sim.closing[m][N - 1] ?? opening;
    const expired = sim.expired[m];
    const variance = roundQty(opening + confirmedQty + plannedQty - ownQty - groupQty - expired - closing);
    if (Math.abs(variance) > 0.00001) throw new Error(`FAMILY_PLANNER_QUANTITY_NOT_CONSERVED:${id}`);
    return {
      material_id: id, opening_qty_base: roundQty(opening), confirmed_arrival_qty_base: roundQty(confirmedQty), planned_lot_qty_base: roundQty(plannedQty),
      own_allocated_qty_base: roundQty(ownQty), group_allocated_qty_base: roundQty(groupQty), expired_qty_base: roundQty(expired),
      closing_qty_base: roundQty(closing), variance_qty_base: variance,
    };
  });

  // W3b — reserve the *real calculated closing* into the next coverage
  // waterfall. This is deliberately separate from daily consumption: when
  // PO21 has no approved eligible demand, remaining stock is carried with an
  // explicit reason instead of being falsely consumed or assigned.
  const reservationBalance = sim.closing.map((series) => Math.max(0, series[N - 1] ?? 0));
  const waterfallReservations: FamilyResult["waterfall_reservations"][number][] = [];
  const reserve = (m: number, groupId: string | null, requested: number, stage: FamilyResult["waterfall_reservations"][number]["stage"], rule: string) => {
    const qty = Math.min(Math.max(0, requested), reservationBalance[m]);
    if (qty <= EPSILON) return 0;
    reservationBalance[m] = roundQty(reservationBalance[m] - qty);
    waterfallReservations.push({
      material_id: ids[m], group_id: groupId, qty_base: roundQty(qty), available_after_qty_base: roundQty(reservationBalance[m]), stage, rule,
    });
    return qty;
  };
  const finalIndex = N - 1;
  // Pass 0: no shared group may borrow the member's future direct/exclusive
  // Desired-Max protection. A group-only material has zero direct reserve.
  for (let m = 0; m < M; m += 1) {
    const desired = memberDesiredMax[m][finalIndex] ?? 0;
    const directNeed = useAhead(own[m], finalIndex, desired);
    reserve(m, null, directNeed, "DIRECT_DESIRED_MAX", "Direct/exclusive Desired-Max reserve before any group allocation.");
  }
  const virtualCandidateOrder = (p: number) => {
    const pool = pools[p];
    const candidates = candIdx[p].filter((m) => reservationBalance[m] > EPSILON);
    const saved = input.group_orders?.get(pool.group_id);
    if (saved) return orderByGroupUsage(candidates.map((m) => ids[m]), (id) => reservationBalance[mIndex.get(id)!], saved)
      .map((id) => mIndex.get(id)!).filter((m) => reservationBalance[m] > EPSILON);
    return [...candidates].sort((a, b) => {
      const runDownA = hasNoFutureReplenishment(ids[a], finalIndex) ? 1 : 0;
      const runDownB = hasNoFutureReplenishment(ids[b], finalIndex) ? 1 : 0;
      return runDownB - runDownA
        || (reservationBalance[b] * costTilt[b]) - (reservationBalance[a] * costTilt[a])
        || ids[a].localeCompare(ids[b]);
    });
  };
  const reserveForGroup = (p: number, requested: number, stage: "GROUP_DESIRED_MAX" | "SECOND_ROTATION", rule: string) => {
    let left = Math.max(0, requested);
    for (const m of virtualCandidateOrder(p)) {
      if (left <= EPSILON) break;
      left -= reserve(m, pools[p].group_id, left, stage, rule);
    }
    return left;
  };
  const groupRate = pools.map((pool) => pool.demand.reduce((sum, qty) => sum + qty, 0) / Math.max(1, N));
  // Pass 1: narrow groups reserve to their own Desired Max first. A group
  // which is already satisfied receives no further Desired-Max reservation;
  // its candidates remain available to the next eligible group.
  pools.forEach((pool, p) => {
    if (groupRate[p] <= EPSILON) return;
    const desired = groupCoverageAt(pool, finalIndex).desired;
    reserveForGroup(p, groupRate[p] * desired, "GROUP_DESIRED_MAX", "Smallest-member-count group first; reserve through its Group Desired Max, then skip to the next eligible group.");
  });
  // Pass 2: genuine usable excess rotates through every still-demanding
  // eligible group in the same narrow-to-broad priority. A round is one
  // average demand day per group, so no material is stranded merely because
  // every group has already reached Desired Max.
  // Pass 2: genuine usable excess rotates through every still-demanding
  // eligible group in the same narrow-to-broad priority. A round is one
  // average demand day per group, so no material is stranded merely because
  // every group has already reached Desired Max.
  //
  // Do not execute this one average-day round literally for every unit of a
  // large opening / MOQ balance. This block is called while building the
  // ordinary PO22 payload, so a 100,000-round safety cap used to hold the
  // Node event loop for minutes and make unrelated saves (for example
  // Payment Terms) wait behind the planner. Run one genuine round, then
  // apply the identical round in bulk through the next material-depletion
  // boundary. The next pass deliberately re-evaluates member order from the
  // remaining physical balance, retaining the existing waterfall priority.
  while (reservationBalance.some((qty) => qty > EPSILON)) {
    const beforeRound = [...reservationBalance];
    const roundByPool = pools.map(() => Array.from({ length: M }, () => 0));
    const roundByMaterial = Array.from({ length: M }, () => 0);
    let moved = false;
    for (let p = 0; p < pools.length; p += 1) {
      if (groupRate[p] <= EPSILON || virtualCandidateOrder(p).length === 0) continue;
      const beforePool = [...reservationBalance];
      const left = reserveForGroup(p, groupRate[p], "SECOND_ROTATION", "Genuine excess rotation after all Group Desired-Max reservations; narrow-to-broad round-robin priority.");
      const used = roundQty(Math.max(0, groupRate[p] - left));
      if (used <= EPSILON) continue;
      moved = true;
      beforePool.forEach((qty, m) => {
        const allocated = roundQty(Math.max(0, qty - reservationBalance[m]));
        if (allocated <= EPSILON) return;
        roundByPool[p][m] = allocated;
        roundByMaterial[m] = roundQty(roundByMaterial[m] + allocated);
      });
    }
    if (!moved) break;

    let extraRounds = Number.POSITIVE_INFINITY;
    roundByMaterial.forEach((used, m) => {
      if (used <= EPSILON) return;
      extraRounds = Math.min(extraRounds, Math.max(0, Math.floor((beforeRound[m] + EPSILON) / used) - 1));
    });
    if (!(extraRounds > 0 && Number.isFinite(extraRounds))) continue;
    roundByPool.forEach((byMaterial, p) => byMaterial.forEach((used, m) => {
      if (used <= EPSILON) return;
      reserve(m, pools[p].group_id, roundQty(used * extraRounds), "SECOND_ROTATION", "Genuine excess rotation after all Group Desired-Max reservations; narrow-to-broad round-robin priority.");
    }));
  }  // The only permitted residual is a material that has no approved eligible
  // group demand in this horizon (or a defensive rotation bound). It remains
  // visible carry for the next dated run, never fake consumption.
  reservationBalance.forEach((qty, m) => {
    if (qty <= EPSILON) return;
    const hasEligibleDemand = pools.some((pool, p) => groupRate[p] > EPSILON && candIdx[p].includes(m));
    reserve(m, null, qty, "CARRY_NO_APPROVED_DEMAND", hasEligibleDemand
      ? "Carry retained after the bounded second rotation; it remains eligible for the next dated Family planning run."
      : "No approved eligible group demand in this horizon; carry forward without inventing consumption.");
  });
  // W3b must close its own ledger too: every non-negative ending balance is
  // either reserved to one future purpose or labelled carry.
  for (let m = 0; m < M; m += 1) {
    const allocated = waterfallReservations.filter((row) => row.material_id === ids[m]).reduce((sum, row) => sum + row.qty_base, 0);
    const closing = Math.max(0, sim.closing[m][finalIndex] ?? 0);
    if (Math.abs(roundQty(closing - allocated)) > 0.00001) throw new Error(`FAMILY_PLANNER_RESERVATION_NOT_CONSERVED:${ids[m]}`);
  }

  return {
    rows: rows.sort((a, b) => a.material_id.localeCompare(b.material_id) || a.day.localeCompare(b.day)),
    risks: risks.sort((a, b) => a.material_id.localeCompare(b.material_id)),
    group_pool_risks: groupPoolRisks,
    arrival_flags: arrivalFlags.sort((a, b) => a.source_key.localeCompare(b.source_key)),
    advisory_buys: buys.map((b) => {
      if (b.status !== "ADVISORY_LATE" && b.estimated_plant_eta) {
        const landIdx = allDays.indexOf(b.estimated_plant_eta);
        if (landIdx > 0) {
          const levels: Array<{ kind: "OWN" | "GROUP"; idx: number; id: string }> = [];
          if (b.need_kind === "OWN") levels.push({ kind: "OWN", idx: ids.indexOf(b.material_id), id: b.material_id });
          for (const c of b.covers) { const gi = pools.findIndex((pl) => pl.group_id === c); if (gi >= 0) levels.push({ kind: "GROUP", idx: gi, id: c }); }
          let best: NonNullable<FamilyBuy["min_dip"]> | null = null;
          for (const lv of levels) {
            if (lv.idx < 0) continue;
            const rd = new Set(sim.risk.filter((r) => r.kind === lv.kind && r.level === lv.idx).map((r) => r.day));
            if (!rd.has(landIdx - 1)) continue;
            let start = landIdx - 1;
            while (rd.has(start - 1)) start -= 1;
            const run = sim.risk.filter((r) => r.kind === lv.kind && r.level === lv.idx && r.day >= start && r.day < landIdx);
            const low = run.reduce((a, c) => (c.cover < a.cover ? c : a));
            // The last time this level asked the pool (at or before the first short day): what it wanted, what it got and what the pool held.
            const ask = sim.levelEvents.filter((e) => e.level_kind === lv.kind && e.level === lv.idx && e.day <= start + 1 && e.shortfall > EPSILON).sort((a, c) => c.day - a.day)[0]
              ?? sim.levelEvents.filter((e) => e.level_kind === lv.kind && e.level === lv.idx && e.day >= start && e.day < landIdx && e.shortfall > EPSILON)[0];
            const dip = { ask_day: ask ? allDays[ask.day] : null, ask_wanted_qty: ask ? ask.wanted : null, ask_got_qty: ask ? ask.qty : null, pool_qty_at_ask: ask ? ask.pool_before : null, level_label_id: lv.id, level_kind: lv.kind, days_below_min: landIdx - start, from: allDays[start], to: allDays[landIdx - 1], lowest_cover_days: low.cover, min_days: low.min, critical_days: low.critical, days_above_critical: low.critical === null ? null : low.cover - low.critical };
            if (!best || dip.days_below_min > best.days_below_min) best = dip;
          }
          if (best) return { ...b, min_dip: best };
        }
      }
      if (b.status !== "ADVISORY_LATE" || !b.need_date || !b.estimated_plant_eta) return b;
      const from = allDays.indexOf(b.need_date);
      const to = allDays.indexOf(b.estimated_plant_eta);
      const levelIdx = b.need_kind === "OWN" ? ids.indexOf(b.material_id) : pools.findIndex((p) => p.group_id === b.trigger_group_id);
      if (from < 0 || to < 0 || levelIdx < 0) return b;
      const dip = sim.risk.filter((r) => r.kind === b.need_kind && r.level === levelIdx && r.day >= from && r.day < to);
      if (dip.length === 0) return b;
      const low = dip.reduce((a, c) => (c.cover < a.cover ? c : a));
      return { ...b, min_gap: {
        days_below_min: dip.length, from: allDays[dip[0].day], to: allDays[dip[dip.length - 1].day], lowest_cover_days: low.cover, min_days: low.min, critical_days: low.critical,
        critical_broken: low.critical !== null && low.cover + 1e-9 < low.critical,
      } };
    }).sort((a, b) => a.material_id.localeCompare(b.material_id) || a.sequence - b.sequence),
    group_unmet: groupUnmet,
    level_events: sim.levelEvents.map((event) => ({
      day: allDays[event.day], kind: event.kind, level_kind: event.level_kind,
      level_id: event.level_kind === "OWN" && event.level !== null ? ids[event.level] : event.level_kind === "GROUP" && event.level !== null ? pools[event.level].group_id : null,
      material_id: event.material !== null ? ids[event.material] : null, qty: event.qty,
      by_material: Object.fromEntries(event.by_material.map((qty, m) => [ids[m], qty]).filter(([, qty]) => (qty as number) > EPSILON)),
      wanted: event.wanted, shortfall: event.shortfall, pool_before: event.pool_before, pool_after: event.pool_after, references: event.references,
      cover_days_after: event.cover_days_after ?? null, min_days: event.min_days ?? null,
    })).sort((a, b) => a.day.localeCompare(b.day)),
    level_risk: sim.risk.map((r) => ({
      day: allDays[r.day], level_kind: r.kind,
      level_id: r.kind === "OWN" ? ids[r.level] : pools[r.level].group_id,
      cover_days: r.cover, min_days: r.min, critical_days: r.critical,
    })),
    level_days: sim.levelDays.map((d) => ({
      day: allDays[d.day], pool_qty: d.pool_qty,
      levels: d.levels.map((l) => ({ level_kind: l.kind, level_id: l.kind === "OWN" ? ids[l.level] : pools[l.level].group_id, level_key: l.kind === "OWN" ? `OWN|${ids[l.level]}` : pools[l.level].key, members: l.kind === "OWN" ? [ids[l.level]] : pools[l.level].candidates, cover_days: l.cover, max_cover_days: l.maxCover, min_days: l.min, max_days: l.max, reserve_qty: l.reserve })),
    })),
    level_matrix: sim.matrix.map((snap) => ({
      day: allDays[snap.day],
      levels: [
        ...ids.flatMap((id, m) => (own[m].some((qty) => qty > EPSILON) ? [{ level_kind: "OWN" as const, level_id: id, by_material: { [id]: snap.own[m] } }] : [])),
        ...pools.map((pool, p) => ({
          level_kind: "GROUP" as const, level_id: pool.group_id,
          by_material: Object.fromEntries(snap.groups[p].map((qty, m) => [ids[m], qty]).filter(([, qty]) => (qty as number) > EPSILON)),
        })),
      ],
      pool: Object.fromEntries(snap.pool.map((qty, m) => [ids[m], qty])),
      closing: Object.fromEntries(snap.closing.map((qty, m) => [ids[m], qty])),
    })),
    level_policies: (() => {
      const first = sim.matrix[0];
      if (!first) return [];
      const rows: FamilyLevelPolicy[] = [];
      ids.forEach((id, m) => {
        if (!own[m].some((qty) => qty > EPSILON)) return;
        rows.push({
          level_kind: "OWN", level_id: id, members: [id], target_days: targets[m][0].target, critical_days: targets[m][0].critical, desired_days: memberDesiredMax[m][0],
          reserve_now: first.own[m], cover_days_now: coverDays(first.own[m], own[m], -1),
        });
      });
      pools.forEach((pool, p) => {
        const coverage = groupCoverageAt(pool, 0);
        const reserve = first.groups[p].reduce((sum, qty) => sum + qty, 0);
        rows.push({ level_kind: "GROUP", level_id: pool.group_id, members: [...pool.candidates], target_days: coverage.target, critical_days: coverage.critical, desired_days: coverage.desired, reserve_now: roundQty(reserve), cover_days_now: coverDays(reserve, pool.demand, -1) });
      });
      return rows;
    })(),
    allocation_rows: allocationRows.sort((a, b) => a.day.localeCompare(b.day)
      || a.destination_kind.localeCompare(b.destination_kind) || String(a.group_id ?? "").localeCompare(String(b.group_id ?? ""))
      || a.material_id.localeCompare(b.material_id)),
    allocation_reconciliation: allocationReconciliation,
    group_actions: groupActions.sort((a, b) => a.group_id.localeCompare(b.group_id)),
    waterfall_reservations: waterfallReservations,
    group_bucket_reservations: (() => {
      const rows: Array<FamilyResult["group_bucket_reservations"][number]> = [];
      pools.forEach((pool, p) => {
        for (let i = 0; i < N; i += 1) {
          ids.forEach((material_id, m) => {
            const reserved_qty_base = sim.poolBucket[p][m][i];
            if (reserved_qty_base <= EPSILON) return;
            rows.push({ group_id: pool.group_id, day: allDays[i], material_id, reserved_qty_base, rule: "GROUP_DESIRED_MAX_WATERFALL" });
          });
        }
      });
      return rows.sort((a, b) => a.day.localeCompare(b.day) || a.group_id.localeCompare(b.group_id) || a.material_id.localeCompare(b.material_id));
    })(),
    group_mix: (() => {
      const mix = new Map<string, Record<string, number>>();
      pools.forEach((pool, p) => {
        for (let i = 0; i < N; i += 1) {
          ids.forEach((id, m) => {
            const q = sim.poolDraw[p][m][i];
            if (q <= EPSILON) return;
            const k = `${pool.group_id}|${allDays[i]}`;
            const row = mix.get(k) ?? {};
            row[id] = roundQty((row[id] ?? 0) + q);
            mix.set(k, row);
          });
        }
      });
      return [...mix].map(([k, draws]) => ({ group_id: k.split("|")[0], day: k.split("|")[1], draws }))
        .sort((a, b) => a.day.localeCompare(b.day) || a.group_id.localeCompare(b.group_id));
    })(),
  };
}

/** Family-wide risk of a projection: stock-out / below-Critical / below-Target member-days + unmet group days. */
function lastFamilyDemandDay(result: FamilyResult): string | null {
  let last: string | null = null;
  for (const r of result.rows) if (r.demand_qty_base > EPSILON && (last === null || r.day > last)) last = r.day;
  return last;
}

/**
 * Family-wide risk of a projection (owner 2026-10-29, the PDF's waterfall): [stock-out + unserved group days,
 * level-days below Critical, level-days below Min]. A level-day is a day a level's OWN reserve covers fewer days than its own
 * Min (Target) — the pool could not refill it. Falling short of Max is normal (the early warning) and is not counted.
 * Days after the PO21 plan's last demand day carry no risk (no plan, not no use).
 */
function familyScore(result: FamilyResult): [number, number, number] {
  const planEnd = lastFamilyDemandDay(result);
  let short = 0;
  for (const r of result.rows) {
    if (planEnd !== null && r.day > planEnd) continue;
    if (r.closing_qty_base < -EPSILON) short += 1;
  }
  short += new Set(result.group_unmet.filter((u) => planEnd === null || u.day <= planEnd).map((u) => `${u.group_id}|${u.day}`)).size;
  const inPlan = result.level_risk.filter((r) => planEnd === null || r.day <= planEnd);
  const critical = inPlan.filter((r) => r.critical_days !== null && r.cover_days + 1e-9 < r.critical_days).length;
  return [short, critical, inPlan.length];
}

/** Family Min / Max days on a day: whole family stock before / after that day's arrivals, against the family use ahead. */
function familyDays(result: FamilyResult, day: string): { min_days: number | null; max_days: number | null } {
  const byDay = new Map<string, { closing: number; minStock: number; use: number }>();
  for (const r of result.rows) {
    const seen = byDay.get(r.day) ?? { closing: 0, minStock: 0, use: 0 };
    byDay.set(r.day, { closing: seen.closing + r.closing_qty_base, minStock: seen.minStock + r.min_stock_qty_base, use: seen.use + r.demand_qty_base });
  }
  const days = [...byDay.keys()].sort();
  const use = days.map((d) => byDay.get(d)!.use);
  const i = days.indexOf(day);
  if (i < 0) return { min_days: null, max_days: null };
  const whole = (v: number | null) => (v === null ? null : Math.floor(v + 1e-9));
  return { min_days: whole(coverDays(byDay.get(day)!.minStock, use, i)), max_days: whole(coverDays(byDay.get(day)!.closing, use, i)) };
}

export type FamilyArrivalScore = {
  eta: string;
  min_days: number | null;
  max_days: number | null;
  shortage_days: number;
  days_below_critical: number;
  days_below_target: number;
  first_below_target_day: string | null;
};
export type FamilyArrivalOptimum = {
  current: FamilyArrivalScore; best: FamilyArrivalScore; shift_days: number; reason: string;
  /** True when every date up to the PO21 plan's last demand day is equally safe: the piece is not needed inside the plan. */
  not_needed_in_plan: boolean; plan_end: string | null;
  /** Only when not_needed_in_plan: why — what the family holds at the plan's last day (base units). */
  plan_cover: { plan_days: number; stock_at_plan_end_with: number; stock_at_plan_end_without: number | null; avg_daily_use: number } | null;
  /**
   * Owner 2026-10-29: the top-up that makes the advised date the limit. For a later / right date it is the first level the pool cannot
   * fill one day after the advised date; for a prepone it is the one the current date leaves unfilled. Null when no date is advised.
   */
  binding: { day: string; min_day: string; level_kind: "OWN" | "GROUP"; level_id: string; cover_days: number; min_days: number; critical_days: number | null; desired_days: number | null; topup: { day: string; wanted: number; shortfall: number; pool_before: number } | null } | null;
  /** Owner 2026-10-30: what the date protects ("MIN" = every level stays at or above its Min; "CRITICAL" = only above Critical). */
  protect: "MIN" | "CRITICAL";
  /** Owner 2026-10-30: the absolute latest plant date that still keeps every level above its CRITICAL (null when none is needed / no later date). */
  critical_latest_eta: string | null;
} | null;

/**
 * Owner 2026-10-30: the advised date PROTECTS THE MIN (default). A piece is "needed" when, without it, a level goes below its Min (or stock
 * runs out / group demand is unserved) inside the plan. `protect = "CRITICAL"` is the older, looser rule (only Critical is guarded); the
 * absolute latest date under that looser rule is always returned as `critical_latest_eta`.
 */
export function optimizeFamilyArrival(input: FamilyPlannerInput, pieceKey: string, protect: "MIN" | "CRITICAL" = "MIN"): FamilyArrivalOptimum {
  const piece = input.confirmed_arrivals.find((a) => a.source_key === pieceKey);
  if (!piece || !piece.eta_to_plant || !ISO_DAY.test(piece.eta_to_plant)) return null;
  const currentEta = piece.eta_to_plant;
  const base = { ...input, plan_buys: false, trace: false };
  const runs = new Map<string, FamilyResult>();
  const withPiece = (patch: (a: FamilyPlannerInput["confirmed_arrivals"][number]) => FamilyPlannerInput["confirmed_arrivals"][number]) =>
    planFamily({ ...base, confirmed_arrivals: input.confirmed_arrivals.map((a) => (a.source_key === pieceKey ? patch(a) : a)) });
  const at = (eta: string) => {
    let r = runs.get(eta);
    if (!r) { r = withPiece((a) => ({ ...a, eta_to_plant: eta })); runs.set(eta, r); }
    return r;
  };
  const cur = at(currentEta);
  const planEndDay = lastFamilyDemandDay(cur);
  const without = withPiece((a) => ({ ...a, qty_base: 0 }));
  const earliest = at(input.as_of);
  const inPlan = (day: string) => planEndDay === null || day <= planEndDay;
  const riskDays = (r: FamilyResult) => {
    const keys = new Map<string, { day: string; key: string }>();
    for (const row of r.rows) if (inPlan(row.day) && row.closing_qty_base < -EPSILON) keys.set(`STOCK|${row.day}`, { day: row.day, key: `STOCK|${row.day}` });
    for (const u of r.group_unmet) if (inPlan(u.day)) keys.set(`UNMET|${u.group_id}|${u.day}`, { day: u.day, key: `UNMET|${u.group_id}|${u.day}` });
    for (const x of r.level_risk) if (inPlan(x.day)) keys.set(`${x.level_kind}|${x.level_id}|${x.day}`, { day: x.day, key: `${x.level_kind}|${x.level_id}|${x.day}` });
    return keys;
  };
  const withoutRisk = riskDays(without);
  const earlyRisk = riskDays(earliest);
  const isCritical = (x: { critical_days: number | null; cover_days: number }) => x.critical_days !== null && x.cover_days + 1e-9 < x.critical_days;
  const preventedFor = (onlyCritical: boolean) => [
    ...without.rows.filter((row) => inPlan(row.day) && row.closing_qty_base < -EPSILON && !earlyRisk.has(`STOCK|${row.day}`)).map((row) => ({ day: row.day, level: null as null | { level_kind: "OWN" | "GROUP"; level_id: string } })),
    ...without.group_unmet.filter((u) => inPlan(u.day) && !earlyRisk.has(`UNMET|${u.group_id}|${u.day}`)).map((u) => ({ day: u.day, level: { level_kind: "GROUP" as const, level_id: u.group_id } })),
    ...without.level_risk.filter((x) => inPlan(x.day) && (!onlyCritical || isCritical(x)) && !earlyRisk.has(`${x.level_kind}|${x.level_id}|${x.day}`)).map((x) => ({ day: x.day, level: { level_kind: x.level_kind, level_id: x.level_id } })),
  ].sort((a, b) => a.day.localeCompare(b.day));
  const prevented = preventedFor(protect === "CRITICAL");
  const preventedCritical = preventedFor(true);
  let criticalLatest: string | null = null;
  if (preventedCritical.length > 0) {
    criticalLatest = addDays(preventedCritical[0].day, -1);
    if (criticalLatest < input.as_of) criticalLatest = input.as_of;
  }
  const needed = prevented.length > 0;
  const firstDay = prevented[0]?.day ?? null;
  let bestEta = currentEta;
  if (needed && firstDay !== null) {
    bestEta = addDays(firstDay, -1);
    if (bestEta < input.as_of) bestEta = input.as_of;
  }
  let shift = Math.round((Date.parse(`${bestEta}T00:00:00Z`) - Date.parse(`${currentEta}T00:00:00Z`)) / 86_400_000);
  if (!needed || Math.abs(shift) < 3) { shift = 0; bestEta = currentEta; }
  const notNeededInPlan = !needed && planEndDay !== null;
  const best = bestEta === currentEta ? cur : at(bestEta);
  const view = (eta: string, r: FamilyResult): FamilyArrivalScore => {
    const sc = familyScore(r);
    return { eta, ...familyDays(r, eta), shortage_days: sc[0], days_below_critical: sc[1], days_below_target: sc[2], first_below_target_day: null };
  };
  const limit = protect === "MIN" ? "Min" : "Critical";
  const reason = notNeededInPlan
    ? `Not needed inside the PO21 plan (it ends ${planEndDay}): without this lot no level goes below its ${limit} before the plan ends.`
    : shift === 0
      ? `Current date is right: without this lot a level first goes below its ${limit} on ${firstDay ?? "—"}.`
      : shift > 0
        ? `Can wait: without this lot a level first goes below its ${limit} on ${firstDay}.`
        : `Too late: without this lot a level first goes below its ${limit} on ${firstDay}.`;
  // Why this piece is needed: the level that first depends on it, in the run without the piece.
  let binding: NonNullable<FamilyArrivalOptimum>["binding"] = null;
  const first = prevented[0];
  const hit = first?.level ? without.level_risk.filter((x) => x.level_kind === first.level!.level_kind && x.level_id === first.level!.level_id && x.day <= first.day && !earlyRisk.has(`${x.level_kind}|${x.level_id}|${x.day}`)).sort((a, b) => a.day.localeCompare(b.day))[0] : undefined;
  if (first?.level && hit) {
    const atFirst = without.level_risk.find((x) => x.level_kind === hit.level_kind && x.level_id === hit.level_id && x.day === first.day) ?? hit;
    const policy = without.level_policies.find((l) => l.level_kind === hit.level_kind && l.level_id === hit.level_id);
    const prior = [...without.level_events].reverse().find((e) => e.level_kind === hit.level_kind && e.level_id === hit.level_id && (e.kind === "TOP_UP" || e.kind === "WAITING") && e.day <= hit.day);
    binding = {
      day: first.day, min_day: hit.day, level_kind: hit.level_kind, level_id: hit.level_id, cover_days: atFirst.cover_days, min_days: hit.min_days, critical_days: hit.critical_days,
      desired_days: policy?.desired_days ?? null,
      topup: prior ? { day: prior.day, wanted: prior.wanted, shortfall: prior.shortfall, pool_before: prior.pool_before } : null,
    };
  }
  // When no ETA can be fixed because the plan has no use after its last day, say why — the days the stock already covers, and how much of
  // the family stock is left over (excess) when the plan ends, with and without this lot.
  let planCover: NonNullable<FamilyArrivalOptimum>["plan_cover"] = null;
  if (notNeededInPlan && planEndDay !== null) {
    const stockAt = (r: FamilyResult) => r.rows.filter((x) => x.day === planEndDay).reduce((sum, x) => sum + x.closing_qty_base, 0);
    const tail = dayList(addDays(planEndDay, -29), planEndDay);
    const use = cur.rows.filter((x) => tail.includes(x.day)).reduce((sum, x) => sum + x.demand_qty_base, 0);
    planCover = {
      plan_days: dayList(input.as_of, planEndDay).length,
      stock_at_plan_end_with: roundQty(stockAt(cur)),
      stock_at_plan_end_without: withoutRisk.size === 0 ? roundQty(stockAt(without)) : null,
      avg_daily_use: roundQty(use / tail.length),
    };
  }
  return { current: view(currentEta, cur), best: view(bestEta, best), shift_days: shift, reason, not_needed_in_plan: notNeededInPlan, plan_end: planEndDay, plan_cover: planCover, binding, protect, critical_latest_eta: criticalLatest };
}

/**
 * Owner 2026-10-30: what a move costs against the TARGET (Min), not only against Critical. The advised date only guarantees Critical; moving the
 * piece to `eta` leaves the level below its Min for more days and lets its cover sink to a lowest value. This measures exactly that, for the
 * level the date was decided on (or every level when none is named), comparing the piece on its recorded date with the piece on `eta`.
 */
export type FamilyMoveCost = { below_min_days_now: number; below_min_days_moved: number; lowest_cover_days_moved: number | null; min_days: number | null; critical_days: number | null } | null;
export function familyMoveCost(input: FamilyPlannerInput, pieceKey: string, eta: string, level: { level_kind: "OWN" | "GROUP"; level_id: string } | null): FamilyMoveCost {
  const piece = input.confirmed_arrivals.find((a) => a.source_key === pieceKey);
  if (!piece || !piece.eta_to_plant || !ISO_DAY.test(piece.eta_to_plant) || !ISO_DAY.test(eta)) return null;
  const base = { ...input, plan_buys: false, trace: false };
  const run = (when: string) => planFamily({ ...base, confirmed_arrivals: input.confirmed_arrivals.map((a) => (a.source_key === pieceKey ? { ...a, eta_to_plant: when } : a)) });
  const now = run(piece.eta_to_plant);
  const moved = eta === piece.eta_to_plant ? now : run(eta);
  const planEnd = lastFamilyDemandDay(now);
  // Only the days up to the landing day depend on this piece's date; later days are decided by the next lots (not in this run), so they are not counted.
  const cutoff = eta > piece.eta_to_plant ? eta : piece.eta_to_plant;
  // A day that is below Min even when the piece lands today is not caused by this piece's date, so it is left out of the cost.
  const early = new Set(run(input.as_of).level_risk.map((x) => `${x.level_kind}|${x.level_id}|${x.day}`));
  const pick = (r: FamilyResult) => r.level_risk.filter((x) => (planEnd === null || x.day <= planEnd) && x.day <= cutoff && !early.has(`${x.level_kind}|${x.level_id}|${x.day}`)
    && (!level || (x.level_kind === level.level_kind && x.level_id === level.level_id)));
  const nowRisk = pick(now);
  const movedRisk = pick(moved);
  const lowest = movedRisk.length ? movedRisk.reduce((a, b) => (b.cover_days < a.cover_days ? b : a)) : null;
  return {
    below_min_days_now: nowRisk.length, below_min_days_moved: movedRisk.length,
    lowest_cover_days_moved: lowest ? lowest.cover_days : null, min_days: lowest ? lowest.min_days : null, critical_days: lowest ? lowest.critical_days : null,
  };
}

/**
 * Owner 2026-10-29: what happens when SEVERAL not-yet-shipped pieces move at once. Each piece's advised date is judged alone; together they can need
 * more new buying or leave more level-days below Min. Both runs include the engine's own new buys, so the extra buying is the real cost.
 */
export type FamilyTogether = { extra_buy_qty_base: number; below_min_days_now: number; below_min_days_moved: number; critical_days_now: number; critical_days_moved: number };
export function optimizeFamilyTogether(input: FamilyPlannerInput, moves: ReadonlyMap<string, string>): FamilyTogether {
  const run = (arrivals: FamilyPlannerInput["confirmed_arrivals"]) => planFamily({ ...input, plan_buys: true, trace: false, confirmed_arrivals: arrivals });
  const now = run(input.confirmed_arrivals);
  const moved = run(input.confirmed_arrivals.map((a) => (moves.has(a.source_key) ? { ...a, eta_to_plant: moves.get(a.source_key)! } : a)));
  const bought = (r: FamilyResult) => r.rows.reduce((sum, x) => sum + x.planned_lot_qty_base, 0);
  const critical = (r: FamilyResult) => r.level_risk.filter((x) => x.critical_days !== null && x.cover_days + 1e-9 < x.critical_days).length;
  return {
    extra_buy_qty_base: roundQty(bought(moved) - bought(now)),
    below_min_days_now: now.level_risk.length, below_min_days_moved: moved.level_risk.length,
    critical_days_now: critical(now), critical_days_moved: critical(moved),
  };
}
