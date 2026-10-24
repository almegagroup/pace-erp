/*
 * PO22 Family planner (owner 2026-10-22) — right item, right time, right lot.
 * Pure: no database call; never creates a PO, CSN, GRN, transfer or Store action.
 *
 * Demand is kept in its two real kinds:
 *   OWN   — a member's exclusive use (a Stroke / Pack BOM line with only that material).
 *   GROUP — a group pool (RDP, RDP_TLA …): any listed candidate may serve it.
 * Each day: a member first meets its own use; a group then takes only the members' free stock —
 * stock above Target days of the member's own use (protection) — in Group Settings order
 * (default Method C: most free first). Protected stock is used last (recorded as borrowed).
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
import { applySinglePurchaseConstraints, pickVendorOption, totalLeadTimeDays } from "./mts_optimizer_phase3d.logic.ts";
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
} from "./mts_optimizer_phase3d.types.ts";

const EPSILON = 0.0000001;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_CYCLE_DAYS = 30;
const MAX_LOTS = 400;

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
};

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
};

export type FamilyBuy = OptimizerAdvisoryBuy & {
  /** What the lot is for: "OWN" (the member's exclusive use) or the group ids it serves. */
  covers: readonly string[];
  need_kind: "OWN" | "GROUP";
};

export type FamilyResult = Omit<OptimizerProjectionResult, "advisory_buys"> & {
  advisory_buys: readonly FamilyBuy[];
  /** Per pool and day: group demand no member could meet (after protected stock). */
  group_unmet: ReadonlyArray<{ group_id: string; day: string; qty_base: number }>;
  /** Consumption ratio: per group and day, how much each member serves (Store instruction basis). */
  group_mix: ReadonlyArray<{ group_id: string; day: string; draws: Readonly<Record<string, number>> }>;
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
type Planned = { material_id: string; index: number; qty: number };

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

/** Days `balance` covers after index `from`, walking `use`; beyond the horizon the average use. */
function coverDays(balance: number, use: readonly number[], from: number): number | null {
  const total = use.reduce((s, q) => s + q, 0);
  if (total <= EPSILON) return null;
  if (balance <= EPSILON) return 0;
  let left = balance;
  let covered = 0;
  for (let i = from + 1; i < use.length; i += 1) {
    const need = use[i];
    if (need <= EPSILON) {
      if (left <= EPSILON) return covered;
      covered += 1;
      continue;
    }
    if (need > left + EPSILON) return covered;
    left = Math.max(0, left - need);
    covered += 1;
  }
  const avg = total / use.length;
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
  return covered + Math.floor(left / finalApprovedDailyUse + EPSILON);
}

/** Use over the `n` days after index `from` (beyond the horizon: average). */
function useAhead(use: readonly number[], from: number, n: number): number {
  const avg = use.length ? use.reduce((s, q) => s + q, 0) / use.length : 0;
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
  ownBalance: number[][]; // closing + group draws taken from protected stock (stock if groups had not borrowed)
  freeAfter: number[][]; // free stock above own protection after the day
  poolUnmet: number[][]; // pool index → day
  poolFreeShort: number[][];
  poolFree: number[][]; // free stock this pool could still use after the day (reserve-adjusted)
  poolDraw: number[][][]; // pool → member → day: who served the group (the consumption ratio)
  expired: number[]; // planning-only receipt life loss; must reconcile stock conservation
};

export function planFamily(input: FamilyPlannerInput): FamilyResult {
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
  // A standalone item's Target is a physical safety reserve, not a permission
  // to run stock down to zero in a later no-demand month.  Carry its final
  // approved non-zero daily own-use rate forward as the sizing rate only;
  // a current-month rate must not inflate coverage after known next-month use.
  // simulation still consumes the actual PO21 demand (zero means zero use).
  // Shared-group safety is deliberately deferred: one combined group reserve
  // must not be duplicated on every alternative member.
  const finalOwnDailyUse = own.map((series) => {
    const finalRate = [...series].reverse().find((qty) => qty > EPSILON) ?? 0;
    return series.map(() => finalRate);
  });

  const arrivalFlags: OptimizerArrivalFlag[] = [...(input.arrival_risks ?? [])];
  const confirmed = ids.map(() => zeros());
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
    confirmed[mIndex.get(a.material_id)!][i] += a.qty_base;
  }
  const manual: Planned[] = [];
  for (const l of input.manual_lots ?? []) {
    const i = dayIndex.get(l.plant_eta);
    if (i === undefined || !valid(l.qty_base) || l.qty_base <= EPSILON || !mIndex.has(l.material_id)) continue;
    manual.push({ material_id: l.material_id, index: i, qty: l.qty_base });
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
    });
    const desired = groupDesiredMaxDays(saved, memberMax) ?? target;
    return { target, critical, desired };
  };

  // Holding-cost tilt for the consumption ratio: costlier stock (more money tied up) is used a bit
  // more; unknown cost = neutral. Clamped so cost never overrides stock levels.
  const unitCost = ids.map((id) => {
    const costs = (policyOf.get(id)?.vendor_options ?? []).map((o) => o.unit_cost).filter((c): c is number => c !== null && c > 0);
    return costs.length ? Math.min(...costs) : null;
  });
  const known = unitCost.filter((c): c is number => c !== null);
  const avgCost = known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
  const costTilt = unitCost.map((c) => (c === null || avgCost === null ? 1 : Math.min(2, Math.max(0.5, c / avgCost))));
  const candIdx = pools.map((pool) => pool.candidates.filter((c) => mIndex.has(c)).map((c) => mIndex.get(c)!));
  /**
   * Owner 2026-10-22: a broader group takes a member's stock only above what the narrower groups
   * of that member need for its Target days (e.g. RDP leaves DA's TLA share alone, so RDP's own
   * best member is bought for RDP). A narrower group's need is shared over its members by stock.
   */
  const narrowerReserve = (m: number, p: number, i: number, bal: readonly number[]) => {
    if (memberDesiredMax[m][i] === null) return 0;
    let reserve = 0;
    pools.forEach((q, qi) => {
      if (qi === p || q.candidates.length >= pools[p].candidates.length || !candIdx[qi].includes(m)) return;
      const total = candIdx[qi].reduce((sum, k) => sum + Math.max(0, bal[k] - protection[k][i]), 0);
      const mine = Math.max(0, bal[m] - protection[m][i]);
      if (total <= EPSILON || mine <= EPSILON) return;
      reserve += useAhead(q.demand, i, groupCoverageAt(q, i).desired) * (mine / total);
    });
    return reserve;
  };

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
    if (left > EPSILON) receipts.push({ material_id: id, qty_base: left, valid_until: addDays(input.as_of, 120), reference: "Opening stock (planning assumption)", expiry_priority: false });
    return receipts;
  });

  const simulate = (lots: readonly Planned[]): Sim => {
    const s: Sim = {
      closing: ids.map(() => zeros()), use: ids.map(() => zeros()), draw: ids.map(() => zeros()), arrival: ids.map(() => zeros()),
      planned: ids.map(() => zeros()), ownBalance: ids.map(() => zeros()), freeAfter: ids.map(() => zeros()),
      poolUnmet: pools.map(() => zeros()), poolFreeShort: pools.map(() => zeros()), poolFree: pools.map(() => zeros()),
      poolDraw: pools.map(() => ids.map(() => zeros())),
      expired: ids.map(() => 0),
    };
    for (const l of lots) s.planned[mIndex.get(l.material_id)!][l.index] += l.qty;
    const bal = ids.map((id) => Number(input.opening_qty_by_material[id] ?? 0));
    const receiptLeft = simulatedOpeningReceipts.map((rows) => rows.map((row) => ({ ...row })));
    for (let i = 0; i < N; i += 1) {
      // A receipt is usable through valid_until.  Expired virtual stock is not
      // silently counted as cover; this is a planning warning, never a stock post.
      for (let m = 0; m < M; m += 1) {
        for (const receipt of receiptLeft[m]) {
          if (receipt.qty_base <= EPSILON || receipt.valid_until >= allDays[i]) continue;
          const expired = Math.min(Math.max(0, bal[m]), receipt.qty_base);
          bal[m] = roundQty(bal[m] - expired);
          s.expired[m] = roundQty(s.expired[m] + expired);
          receipt.qty_base = 0;
        }
      }
      for (let m = 0; m < M; m += 1) {
        s.arrival[m][i] = confirmed[m][i];
        bal[m] += confirmed[m][i] + s.planned[m][i] - own[m][i];
        s.use[m][i] = own[m][i];
        // Existing receipts are consumed FEFO.  Future arrivals/engine lots
        // remain aggregate because Store cannot physically issue them yet.
        let ownLeft = own[m][i];
        for (const receipt of receiptLeft[m]) {
          if (ownLeft <= EPSILON) break;
          const used = Math.min(ownLeft, receipt.qty_base);
          receipt.qty_base -= used;
          ownLeft -= used;
        }
      }
      pools.forEach((pool, p) => {
        let need = pool.demand[i];
        if (need <= EPSILON) return;
        const cand = candIdx[p];
        const free = (m: number) => Math.max(0, bal[m] - protection[m][i] - narrowerReserve(m, p, i, bal));
        const order = input.group_orders?.get(pool.group_id);
        const ordered = (fn: (m: number) => number) => (order
          ? orderByGroupUsage(cand.map((m) => ids[m]), (id) => fn(mIndex.get(id)!), order).map((id) => mIndex.get(id)!)
          : [...cand].sort((a, b) => fn(b) - fn(a) || cand.indexOf(a) - cand.indexOf(b)));
        const takeFrom = (m: number, qty: number) => {
          bal[m] -= qty; need -= qty; s.draw[m][i] += qty; s.use[m][i] += qty; s.poolDraw[p][m][i] += qty;
          let left = qty;
          for (const receipt of receiptLeft[m]) {
            if (left <= EPSILON) break;
            const used = Math.min(left, receipt.qty_base);
            receipt.qty_base -= used;
            left -= used;
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
          for (let pass = 0; pass < 4 && need > EPSILON; pass += 1) {
            const weights = cand.map((m) => free(m) * costTilt[m]);
            const total = weights.reduce((a, b) => a + b, 0);
            if (total <= EPSILON) break;
            const want = need;
            cand.forEach((m, k) => {
              const take = Math.min(free(m), want * (weights[k] / total), need);
              if (take > EPSILON) takeFrom(m, take);
            });
          }
        }
        if (need > EPSILON) s.poolFreeShort[p][i] = need;
        if (need > EPSILON) s.poolUnmet[p][i] = need;
      });
      pools.forEach((_pool, p) => {
        s.poolFree[p][i] = candIdx[p].reduce((sum, m) => sum + Math.max(0, bal[m] - protection[m][i] - narrowerReserve(m, p, i, bal)), 0);
      });
      for (let m = 0; m < M; m += 1) {
        s.closing[m][i] = bal[m];
        s.ownBalance[m][i] = bal[m];
        s.freeAfter[m][i] = Math.max(0, bal[m] - protection[m][i]);
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
    // A shared member can have no exclusive BOM use yet still carry a real
    // individual Target.  Its guard is measured against the group's actual
    // simulated draw from that member.  Otherwise RP-4099-style members could
    // only be replenished at the broader group Target and their 20-day
    // individual rule would never trigger.
    const usesGroupAsIndividualDemand = isSharedGroupMember[m] && own[m].every((qty) => qty <= EPSILON);
    const memberUse = usesGroupAsIndividualDemand ? sim.use[m] : own[m];
    if (!policy || memberUse.every((q) => q <= EPSILON)) return null;
    const from = (pendingOwn.get(id) ?? -1) + 1;
    for (let i = from; i < N; i += 1) {
      const t = targets[m][i].target;
      if (t === null || targets[m][i].critical === null) continue;
      const cover = isSharedGroupMember[m]
        ? coverDays(sim.ownBalance[m][i], memberUse, i)
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
      for (let i = from; i < N; i += 1) {
      const groupCoverage = groupCoverageAt(pool, i);
      if (groupCoverage.target === null || groupCoverage.critical === null) continue;
        const cover = freeCover(i);
        if (sim.poolFreeShort[p][i] > EPSILON || (cover !== null && cover <= groupCoverage.target)) { needIndex = i; break; }
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

  const place = (need: Need, sim: Sim) => {
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
      const constraints = need.option
        ? { ...policy, vendor_moq_qty_base: need.option.option.moq_qty_base, order_multiple_qty_base: need.option.option.order_multiple_qty_base, delivery_lot_qty_base: need.option.option.delivery_lot_qty_base ?? null }
        : policy;
      const orderQty = applySinglePurchaseConstraints(Math.max(roundQty(required), EPSILON * 10), constraints) ?? 0;
      lotQty = orderQty;
      const seq = (sequence.get(id) ?? 0) + 1;
      sequence.set(id, seq);
      const poBy = addDays(allDays[need.index], -lead);
      const covers = need.kind === "OWN"
        ? [usesGroupAsIndividualDemand ? "MEMBER_GUARD" : "OWN"]
        : [need.pool!.group_id];
      const why = need.kind === "OWN"
        ? (usesGroupAsIndividualDemand
          ? `Member guard: its allocated eligible-group use falls to its individual Target ${t} days on ${allDays[need.index]}.`
          : `Own use: cover of its own (exclusive) use falls to Target ${t} days on ${allDays[need.index]}.`)
        : `Group ${need.pool!.group_id}: free stock of its members falls to Target ${t} days on ${allDays[need.index]}; refill is sized to Group Desired Max ${window} days; ${need.late ? "fastest member to arrive" : "cheapest member that arrives in time"}.`;
      buys.push({
        material_id: id, sequence: seq, required_qty_base: roundQty(Math.max(0, required)), recommended_po_qty_base: orderQty,
        recommended_po_by: need.late ? input.as_of : poBy, estimated_plant_eta: allDays[arrivalIndex], need_date: allDays[need.index],
        lots: [{ lot_no: 1, plant_eta: allDays[arrivalIndex], qty_base: roundQty(lotQty) }], total_lead_time_days: lead,
        status: need.late ? "ADVISORY_LATE" : "ADVISORY",
        reason: need.late ? `${why} PO-by ${poBy} has passed; ordering today arrives ${allDays[arrivalIndex]}.` : `${why} Sized to Desired Max ${window} days; MOQ / multiple respected.`,
        advisory_only: true,
        vendor_id: need.option?.option.vendor_id ?? null, max_cover_days: roundQty(window),
        bridge: need.option?.bridge ?? false, cheapest_vendor_id: need.option?.cheapest ?? null,
        covers, need_kind: need.kind,
      });
      engineLots.push({ material_id: id, index: arrivalIndex, qty: lotQty });
    }
    if (need.kind === "OWN") pendingOwn.set(id, need.late ? arrivalIndex : need.index);
    else pendingGroup.set(need.pool!.key, need.late ? arrivalIndex : need.index);
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
      place(needs[0], sim);
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

  // Explainability is emitted by the simulator itself, never re-derived by the
  // browser from closing balances.  `sim.use` includes the member's own demand
  // plus pool draws, so the difference is the exact direct/exclusive draw.
  const allocationRows: FamilyResult["allocation_rows"][number][] = [];
  for (let i = 0; i < N; i += 1) {
    for (let m = 0; m < ids.length; m += 1) {
      const ownQty = sim.use[m][i] - sim.draw[m][i];
      if (ownQty > EPSILON) allocationRows.push({
        day: allDays[i], material_id: ids[m], destination_kind: "OWN", group_id: null,
        qty_base: roundQty(ownQty), closing_qty_base: roundQty(sim.closing[m][i]), rule: "DIRECT_EXCLUSIVE_RESERVE",
      });
    }
    pools.forEach((pool, p) => {
      for (let m = 0; m < ids.length; m += 1) {
        const qty = sim.poolDraw[p][m][i];
        if (qty <= EPSILON) continue;
        allocationRows.push({
          day: allDays[i], material_id: ids[m], destination_kind: "GROUP", group_id: pool.group_id,
          qty_base: roundQty(qty), closing_qty_base: roundQty(sim.closing[m][i]), rule: "GROUP_WATERFALL",
        });
      }
    });
  }

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
  const MAX_ROTATION_STEPS = 100_000;
  for (let step = 0; step < MAX_ROTATION_STEPS; step += 1) {
    let moved = false;
    for (let p = 0; p < pools.length; p += 1) {
      if (groupRate[p] <= EPSILON || virtualCandidateOrder(p).length === 0) continue;
      const left = reserveForGroup(p, groupRate[p], "SECOND_ROTATION", "Genuine excess rotation after all Group Desired-Max reservations; narrow-to-broad round-robin priority.");
      if (left + EPSILON < groupRate[p]) moved = true;
    }
    if (!moved) break;
  }
  // The only permitted residual is a material that has no approved eligible
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
    advisory_buys: buys.sort((a, b) => a.material_id.localeCompare(b.material_id) || a.sequence - b.sequence),
    group_unmet: groupUnmet,
    allocation_rows: allocationRows.sort((a, b) => a.day.localeCompare(b.day)
      || a.destination_kind.localeCompare(b.destination_kind) || String(a.group_id ?? "").localeCompare(String(b.group_id ?? ""))
      || a.material_id.localeCompare(b.material_id)),
    allocation_reconciliation: allocationReconciliation,
    group_actions: groupActions.sort((a, b) => a.group_id.localeCompare(b.group_id)),
    waterfall_reservations: waterfallReservations,
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
function familyScore(result: FamilyResult): [number, number, number] {
  let short = 0; let critical = 0; let target = 0;
  for (const r of result.rows) {
    if (r.closing_qty_base < -EPSILON) short += 1;
    if (r.critical_days !== null && r.max_cover_days !== null && r.max_cover_days < r.critical_days) critical += 1;
    if (r.target_days !== null && r.max_cover_days !== null && r.max_cover_days < r.target_days) target += 1;
  }
  short += new Set(result.group_unmet.map((u) => `${u.group_id}|${u.day}`)).size;
  return [short, critical, target];
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
export type FamilyArrivalOptimum = { current: FamilyArrivalScore; best: FamilyArrivalScore; shift_days: number; reason: string } | null;

/**
 * Owner 2026-10-22: when is a not-yet-shipped piece really needed? Dates across the horizon are
 * tried with the WHOLE family simulated (no new engine buys), so moving one member's arrival
 * shows its effect on the groups and the other members. Fewest stock-out / below-Critical /
 * below-Target member-days wins; on a tie the latest date (least money held); a prepone only when
 * strictly safer; shifts under 3 days are ignored. Min / Max days shown are the family's.
 */
export function optimizeFamilyArrival(input: FamilyPlannerInput, pieceKey: string): FamilyArrivalOptimum {
  const piece = input.confirmed_arrivals.find((a) => a.source_key === pieceKey);
  if (!piece || !piece.eta_to_plant || !ISO_DAY.test(piece.eta_to_plant)) return null;
  const currentEta = piece.eta_to_plant;
  const base = { ...input, plan_buys: false };
  const runs = new Map<string, FamilyResult>();
  const at = (eta: string) => {
    let r = runs.get(eta);
    if (!r) {
      r = planFamily({ ...base, confirmed_arrivals: input.confirmed_arrivals.map((a) => (a.source_key === pieceKey ? { ...a, eta_to_plant: eta } : a)) });
      runs.set(eta, r);
    }
    return r;
  };
  const cmp = (a: [number, number, number], b: [number, number, number]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const current = familyScore(at(currentEta));
  let bestEta = currentEta;
  let best = current;
  const all = dayList(input.as_of, input.horizon_end);
  const consider = (day: string) => {
    if (day === currentEta) return;
    const score = familyScore(at(day));
    const c = cmp(score, best);
    if (c < 0 || (c === 0 && day > bestEta)) {
      // A prepone is taken only when strictly safer than the current date.
      if (day < currentEta && cmp(score, current) >= 0) return;
      best = score; bestEta = day;
    }
  };
  // Coarse pass every 7 days, then every day within ±7 of the best (each try is a full family run).
  for (let k = 0; k < all.length; k += 7) consider(all[k]);
  const centre = all.indexOf(bestEta);
  for (let k = Math.max(0, centre - 7); k <= Math.min(all.length - 1, centre + 7); k += 1) consider(all[k]);
  let shift = Math.round((Date.parse(`${bestEta}T00:00:00Z`) - Date.parse(`${currentEta}T00:00:00Z`)) / 86_400_000);
  if (Math.abs(shift) < 3) { shift = 0; bestEta = currentEta; best = current; }
  const view = (eta: string, score: [number, number, number]): FamilyArrivalScore => ({
    eta, ...familyDays(at(eta), eta), shortage_days: score[0], days_below_critical: score[1], days_below_target: score[2], first_below_target_day: null,
  });
  const reason = shift === 0
    ? "Current date is right for the whole family."
    : cmp(best, current) < 0
      ? `Fewer family risk days (stock-out ${best[0]} vs ${current[0]}, below Critical ${best[1]} vs ${current[1]}, below Target ${best[2]} vs ${current[2]}).`
      : `Same family risk; the ${shift > 0 ? "later" : "earlier"} date holds less money.`;
  return { current: view(currentEta, current), best: view(bestEta, best), shift_days: shift, reason };
}
