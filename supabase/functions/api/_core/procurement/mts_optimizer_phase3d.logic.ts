/* PO22 Phase 3D — pure daily coverage / future-consignment projection (sheet PLANNING equivalent).
 * It makes no database call and never creates a PO, CSN, GRN, transfer or Store action.
 *
 * Owner decisions applied (common:docs/po22-common/OWNER-DECISIONS-2026-10-19-REQUIREMENT-AND-GROUPS.md):
 *   D2  lot trigger = first day cover falls to/below Target (not the sheet's exact `= Target+1`);
 *       Below Target / Critical are inclusive (<=).
 *   D3  Target / Critical are per material and effective-dated.
 *   D4  MOQ and order multiple are separate vendor constraints; a PO may arrive as dated lots.
 *   D5  a past or missing CSN ETA is assumed to arrive on as_of (never dropped) and flagged.
 *   D6  total lead time = Booking Time (blank = 0) + route lead time.
 * Unused stock of an earlier lot simply stays in the running balance (carry-forward).
 */
import { roundQty } from "./mts_requirement.logic.ts";
import type {
  OptimizerAdvisoryBuy,
  OptimizerArrivalFlag,
  OptimizerDailyProjectionRow,
  OptimizerGroupPoolRisk,
  OptimizerMaterialPlanningPolicy,
  OptimizerMaterialRisk,
  OptimizerPlannedLot,
  OptimizerProjectionInput,
  OptimizerProjectionResult,
} from "./mts_optimizer_phase3d.types.ts";

const EPSILON = 0.0000001;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function freeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) freeze(child); } return value; }
function addDays(day: string, amount: number): string { return new Date(Date.parse(`${day}T00:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10); }
function days(from: string, through: string): string[] { const out: string[] = []; for (let day = from; day <= through; day = addDays(day, 1)) out.push(day); return out; }
function add(map: Map<string, number>, key: string, qty: number): void { map.set(key, roundQty((map.get(key) ?? 0) + qty)); }
function key(materialId: string, day: string): string { return `${materialId}|${day}`; }
function validQty(value: number): boolean { return Number.isFinite(value) && value >= 0; }
function validDays(value: number | null | undefined): value is number { return value !== null && value !== undefined && Number.isFinite(value) && value >= 0; }

/** Enforces MOQ first, then an independent order multiple; null means no buy recommendation. */
export function applyOrderConstraints(requiredQtyBase: number, policy: OptimizerMaterialPlanningPolicy): number | null {
  if (!validQty(requiredQtyBase) || requiredQtyBase <= EPSILON) return null;
  const moq = policy.vendor_moq_qty_base;
  const multiple = policy.order_multiple_qty_base;
  if (moq !== null && (!validQty(moq) || moq <= EPSILON)) throw new Error(`PHASE3D_INVALID_MOQ:${policy.material_id}`);
  if (multiple !== null && (!validQty(multiple) || multiple <= EPSILON)) throw new Error(`PHASE3D_INVALID_ORDER_MULTIPLE:${policy.material_id}`);
  let quantity = Math.max(requiredQtyBase, moq ?? 0);
  if (multiple !== null) quantity = Math.ceil((quantity - EPSILON) / multiple) * multiple;
  return roundQty(quantity);
}

/** Splits an order into dated delivery lots of `lotQty` (last lot takes the remainder). */
export function splitIntoLots(orderQty: number, lotQty: number | null | undefined): number[] {
  if (!lotQty || !(lotQty > EPSILON) || lotQty >= orderQty - EPSILON) return [roundQty(orderQty)];
  const lots: number[] = [];
  let remaining = orderQty;
  while (remaining > EPSILON) {
    const qty = Math.min(lotQty, remaining);
    lots.push(roundQty(qty));
    remaining = roundQty(remaining - qty);
  }
  return lots;
}

/** D6: total lead time = booking (blank = 0) + route; else the configured total; null = unknown. */
export function totalLeadTimeDays(policy: OptimizerMaterialPlanningPolicy): number | null {
  if (validDays(policy.route_lead_time_days)) {
    const booking = validDays(policy.booking_time_days) ? policy.booking_time_days : 0;
    return Math.round(booking + policy.route_lead_time_days);
  }
  if (validDays(policy.configured_lead_time_days) && Number.isInteger(policy.configured_lead_time_days)) return policy.configured_lead_time_days;
  return null;
}

function coverageAt(policy: OptimizerMaterialPlanningPolicy | undefined, day: string): { target: number | null; critical: number | null } {
  if (!policy) return { target: null, critical: null };
  let target = policy.target_days;
  let critical = policy.critical_days;
  let best: string | null = null;
  for (const version of policy.coverage_versions ?? []) {
    if (version.effective_from > day || (best !== null && version.effective_from <= best)) continue;
    best = version.effective_from;
    target = version.target_days;
    critical = version.critical_days;
  }
  return { target: validDays(target) ? target : null, critical: validDays(critical) ? critical : null };
}

/**
 * Whole days a balance covers after `fromIndex`, walking the dated demand; beyond the horizon the
 * average horizon daily demand is used. null = no demand at all (cover is not meaningful).
 */
function makeCoverFn(demand: readonly number[]) {
  // Totals are read on each call: rule 6 group draws add to `demand` while the projection runs.
  return (balance: number, fromIndex: number): number | null => {
    const total = demand.reduce((sum, qty) => sum + qty, 0);
    const average = demand.length === 0 ? 0 : total / demand.length;
    if (total <= EPSILON) return null;
    if (balance <= EPSILON) return 0;
    let remaining = balance;
    let covered = 0;
    for (let index = fromIndex + 1; index < demand.length; index += 1) {
      const need = demand[index];
      if (need > remaining + EPSILON) return covered;
      remaining -= need;
      covered += 1;
    }
    return average <= EPSILON ? covered : covered + Math.floor(remaining / average + EPSILON);
  };
}

/** Qty that brings the cover of `closing` (after day `index`) back above `targetDays`. */
function qtyToRestore(demand: readonly number[], index: number, closing: number, targetDays: number): number {
  const window = Math.floor(targetDays) + 1;
  const average = demand.length === 0 ? 0 : demand.reduce((sum, qty) => sum + qty, 0) / demand.length;
  let need = 0;
  for (let step = 1; step <= window; step += 1) need += index + step < demand.length ? demand[index + step] : average;
  return Math.max(0, roundQty(need - closing));
}

/**
 * P2 (owner 2026-10-20): the vendor for a lot needed on `needDay` — the cheapest option that can
 * arrive in time; if none can, the fastest (late). `bridge` = the cheapest overall cannot make it
 * and a costlier one is used for this lot. null = no option with a known lead time.
 */
export function pickVendorOption(policy: OptimizerMaterialPlanningPolicy, needDay: string, asOf: string) {
  const options = (policy.vendor_options ?? []).filter((o) => validDays(o.lead_time_days));
  if (options.length === 0) return null;
  const cost = (o: { unit_cost: number | null }) => (o.unit_cost === null ? Number.POSITIVE_INFINITY : o.unit_cost);
  const byCost = [...options].sort((a, b) => cost(a) - cost(b) || a.lead_time_days! - b.lead_time_days! || a.vendor_id.localeCompare(b.vendor_id));
  const inTime = byCost.filter((o) => addDays(needDay, -o.lead_time_days!) >= asOf);
  const cheapest = byCost[0];
  if (inTime.length > 0) {
    const option = inTime[0];
    return { option, bridge: option.vendor_id !== cheapest.vendor_id, cheapest: cheapest.vendor_id };
  }
  const fastest = [...options].sort((a, b) => a.lead_time_days! - b.lead_time_days! || cost(a) - cost(b) || a.vendor_id.localeCompare(b.vendor_id))[0];
  return { option: fastest, bridge: fastest.vendor_id !== cheapest.vendor_id, cheapest: cheapest.vendor_id };
}

type MaterialState = {
  id: string;
  policy: OptimizerMaterialPlanningPolicy | undefined;
  demand: number[];
  groupDraw: number[];
  cover: (balance: number, fromIndex: number) => number | null;
  leadTime: number | null;
  plannedByIndex: Map<number, number>;
  queuedLots: number[];
  pendingUntil: number;
  sequence: number;
  balance: number;
  firstShortage: string | null;
  firstCritical: string | null;
  firstTarget: string | null;
  buys: OptimizerAdvisoryBuy[];
  // per-day working values
  opening: number;
  arrival: number;
  planned: number;
  closing: number;
};

/**
 * Projects confirmed lifecycle arrivals plus proposed lots, all materials day by day.
 * Material-null GROUP_POOL demand is reported per group and is never copied onto a member.
 * With `groups` (Method C rule 6) a group's demand is first met from the members' free stock;
 * DEPENDENT ordering: each day, every material's own balance first, then group draws (narrowest
 * group first), then replenishment planning — later days see the stock earlier draws left.
 */
export function projectDailyCoverage(input: OptimizerProjectionInput): OptimizerProjectionResult {
  if (!ISO_DAY.test(input.as_of) || !ISO_DAY.test(input.horizon_end) || input.horizon_end < input.as_of) throw new Error("PHASE3D_INVALID_HORIZON");
  const policyByMaterial = new Map(input.policies.map((policy) => [policy.material_id, policy]));
  if (policyByMaterial.size !== input.policies.length) throw new Error("PHASE3D_DUPLICATE_POLICY");
  const allDays = days(input.as_of, input.horizon_end);
  const dayIndex = new Map(allDays.map((day, index) => [day, index]));
  const groupDefinitions = new Map((input.groups ?? []).map((g) => [g.group_id, g]));
  const groupMembers = new Map((input.groups ?? []).map((g) => [g.group_id, [...g.member_ids]]));

  const demandByDay = new Map<string, number>();
  const pool = new Map<string, { qty: number; first: string | null }>();
  const addPool = (groupKey: string, day: string, qty: number) => {
    const seen = pool.get(groupKey) ?? { qty: 0, first: null };
    pool.set(groupKey, { qty: roundQty(seen.qty + qty), first: seen.first === null || day < seen.first ? day : seen.first });
  };
  /** day index → group → assigned material ('' = none) → qty (rule 6). */
  const groupDemand = new Map<number, Map<string, Map<string, number>>>();
  for (const row of input.daily_demand) {
    if (!validQty(row.qty_base) || row.required_by === null || !ISO_DAY.test(row.required_by)) continue;
    if (row.required_by < input.as_of || row.required_by > input.horizon_end) continue;
    if (row.group_id && groupMembers.has(row.group_id)) {
      const index = dayIndex.get(row.required_by)!;
      const byGroup = groupDemand.get(index) ?? new Map<string, Map<string, number>>();
      const byMaterial = byGroup.get(row.group_id) ?? new Map<string, number>();
      byMaterial.set(row.material_id ?? "", roundQty((byMaterial.get(row.material_id ?? "") ?? 0) + row.qty_base));
      byGroup.set(row.group_id, byMaterial);
      groupDemand.set(index, byGroup);
    } else if (row.material_id === null) addPool(row.group_id ?? "", row.required_by, row.qty_base);
    else add(demandByDay, key(row.material_id, row.required_by), row.qty_base);
  }

  const arrivalByDay = new Map<string, number>();
  const arrivalFlags: OptimizerArrivalFlag[] = [];
  for (const row of input.confirmed_arrivals) {
    if (!validQty(row.qty_base) || row.qty_base <= EPSILON) continue;
    let eta = row.eta_to_plant;
    if (eta === null || !ISO_DAY.test(eta) || eta < input.as_of) {
      const reason = eta === null || !ISO_DAY.test(eta) ? "ETA_MISSING" : "ETA_PASSED";
      arrivalFlags.push(freeze({
        source_key: row.source_key, material_id: row.material_id, eta_to_plant: row.eta_to_plant, assumed_eta: input.as_of, reason,
        message: reason === "ETA_PASSED"
          ? "ETA has passed and the material has not arrived — update this CSN in CSN Tracker. Assumed to arrive today until then."
          : "No plant ETA — set it in CSN Tracker. Assumed to arrive today until then.",
      }));
      eta = input.as_of;
    }
    if (eta > input.horizon_end) continue;
    add(arrivalByDay, key(row.material_id, eta), row.qty_base);
  }

  const materialIds = new Set<string>([
    ...Object.keys(input.opening_qty_by_material),
    ...[...demandByDay.keys()].map((entry) => entry.split("|")[0]),
    ...input.confirmed_arrivals.map((row) => row.material_id),
    ...input.daily_demand.filter((row) => row.group_id && groupMembers.has(row.group_id) && row.material_id).map((row) => row.material_id as string),
    ...(input.manual_lots ?? []).map((lot) => lot.material_id),
  ]);
  const states = new Map<string, MaterialState>();
  for (const materialId of [...materialIds].sort()) {
    const opening0 = Number(input.opening_qty_by_material[materialId] ?? 0);
    if (!validQty(opening0)) throw new Error(`PHASE3D_INVALID_OPENING_QTY:${materialId}`);
    const policy = policyByMaterial.get(materialId);
    const demand = allDays.map((day) => demandByDay.get(key(materialId, day)) ?? 0);
    states.set(materialId, {
      id: materialId, policy, demand, groupDraw: allDays.map(() => 0), cover: makeCoverFn(demand),
      leadTime: policy ? totalLeadTimeDays(policy) : null, plannedByIndex: new Map(), queuedLots: [], pendingUntil: -1, sequence: 0,
      balance: opening0, firstShortage: null, firstCritical: null, firstTarget: null, buys: [], opening: 0, arrival: 0, planned: 0, closing: 0,
    });
  }
  // P4: user-fixed lots are planned lots on their date (a date outside the horizon is ignored).
  for (const lot of input.manual_lots ?? []) {
    const st = states.get(lot.material_id);
    const index = dayIndex.get(lot.plant_eta);
    if (!st || index === undefined || !validQty(lot.qty_base) || lot.qty_base <= EPSILON) continue;
    st.plannedByIndex.set(index, roundQty((st.plannedByIndex.get(index) ?? 0) + lot.qty_base));
  }
  const ordered = [...states.values()];
  const rows: OptimizerDailyProjectionRow[] = [];

  /** Free stock of a member after day `index`: closing above Target days of its own demand. */
  const freeAfter = (st: MaterialState, index: number, day: string): number => {
    const { target } = coverageAt(st.policy, day);
    const reserve = target === null ? 0 : qtyToRestore(st.demand, index, 0, target);
    return Math.max(0, roundQty(st.closing - reserve));
  };

  allDays.forEach((day, index) => {
    // 1. Own balance before any decision.
    for (const st of ordered) {
      st.opening = st.balance;
      st.arrival = arrivalByDay.get(key(st.id, day)) ?? 0;
      st.planned = st.plannedByIndex.get(index) ?? 0;
      st.closing = roundQty(st.opening + st.arrival + st.planned - st.demand[index]);
    }

    // 2. Rule 6: group demand from members' free stock (narrowest group first), rest to the
    //    assigned member (a buy) or the group pool.
    const byGroup = groupDemand.get(index);
    if (byGroup) {
      const groupOrder = [...byGroup.keys()].sort((a, b) => groupMembers.get(a)!.length - groupMembers.get(b)!.length || a.localeCompare(b));
      for (const groupId of groupOrder) {
        for (const [assigned, qty] of [...byGroup.get(groupId)!].sort(([a], [b]) => a.localeCompare(b))) {
          let remaining = qty;
          const preferences = groupDefinitions.get(groupId)?.consumption_preference_by_material ?? {};
          const members = groupMembers.get(groupId)!.map((id) => states.get(id)).filter((st): st is MaterialState => !!st)
            .map((st) => ({ st, free: freeAfter(st, index, day), preference: Math.max(0.05, Number(preferences[st.id] ?? 1) || 1) }))
            // Economic rotation is only a bounded tie-break among already-free
            // stock. It cannot consume a protected balance or invent supply.
            .sort((a, b) => (b.free * b.preference) - (a.free * a.preference) || b.free - a.free || Number(b.st.id === assigned) - Number(a.st.id === assigned) || a.st.id.localeCompare(b.st.id));
          for (const { st, free } of members) {
            if (remaining <= EPSILON) break;
            const draw = roundQty(Math.min(free, remaining));
            if (draw <= EPSILON) continue;
            st.demand[index] = roundQty(st.demand[index] + draw);
            st.groupDraw[index] = roundQty(st.groupDraw[index] + draw);
            st.closing = roundQty(st.closing - draw);
            remaining = roundQty(remaining - draw);
          }
          if (remaining > EPSILON) {
            const target = assigned ? states.get(assigned) : undefined;
            if (target) {
              target.demand[index] = roundQty(target.demand[index] + remaining);
              target.closing = roundQty(target.closing - remaining);
            } else addPool(groupId, day, remaining);
          }
        }
      }
    }

    // 3. Replenishment (D2) and 4. the day's row, per material.
    for (const st of ordered) {
      const { policy, demand, cover, leadTime } = st;
      const materialId = st.id;
      const { target, critical } = coverageAt(policy, day);
      let planned = st.planned;
      let closing = st.closing;

      // D2: a proposed lot is needed on the first day cover falls to/below Target, unless one is pending.
      const canPlan = !!policy && target !== null && critical !== null && index > st.pendingUntil;
      if (canPlan) {
        const currentCover = cover(closing, index);
        if (currentCover !== null && currentCover <= target!) {
          const required = qtyToRestore(demand, index, closing, target!);
          if (required > EPSILON) {
            if (st.queuedLots.length > 0) {
              // Next dated lot of an already recommended order (no new PO).
              const lot = st.queuedLots.shift()!;
              planned = roundQty(planned + lot);
              st.plannedByIndex.set(index, planned);
              closing = roundQty(closing + lot);
              const last = st.buys[st.buys.length - 1];
              const lots = [...last.lots, { lot_no: last.lots.length + 1, plant_eta: day, qty_base: lot }];
              st.buys[st.buys.length - 1] = freeze({ ...last, lots });
            } else {
              // P2: pick the vendor for this lot, size it to Max days (Target + cycle).
              const pick = pickVendorOption(policy!, day, input.as_of);
              const lotLead = pick ? pick.option.lead_time_days : leadTime;
              const cycle = pick?.option.cycle_days ?? policy!.cycle_days ?? null;
              const sizedRequired = cycle !== null && cycle > 0 ? qtyToRestore(demand, index, closing, target! + cycle) : required;
              const constraints = pick
                ? { ...policy!, vendor_moq_qty_base: pick.option.moq_qty_base, order_multiple_qty_base: pick.option.order_multiple_qty_base, delivery_lot_qty_base: pick.option.delivery_lot_qty_base ?? null }
                : policy!;
              const orderQty = applyOrderConstraints(sizedRequired, constraints);
              const p2 = pick || cycle !== null
                ? { vendor_id: pick?.option.vendor_id ?? null, max_cover_days: cycle !== null ? roundQty(target! + cycle) : null, bridge: pick?.bridge ?? false, cheapest_vendor_id: pick?.cheapest ?? null }
                : {};
              st.sequence += 1;
              if (lotLead === null) {
                st.buys.push(freeze({
                  material_id: materialId, sequence: st.sequence, required_qty_base: sizedRequired, recommended_po_qty_base: orderQty, recommended_po_by: null,
                  estimated_plant_eta: day, need_date: day, lots: [], total_lead_time_days: null, status: "UNKNOWN_LEAD_TIME",
                  reason: "Lead time is missing (vendor route lead time / Booking Time); PO-by date is unknown and no lot is projected.", advisory_only: true as const,
                  ...p2,
                }));
                st.pendingUntil = allDays.length; // one unknown-lead-time recommendation is enough
              } else if (orderQty !== null) {
                const lots = splitIntoLots(orderQty, constraints.delivery_lot_qty_base);
                const poBy = addDays(day, -lotLead);
                const late = poBy < input.as_of;
                const eta = late ? addDays(input.as_of, lotLead) : day;
                const etaIndex = allDays.indexOf(eta);
                const firstLot = lots.shift()!;
                st.queuedLots.push(...lots);
                const plannedLots: OptimizerPlannedLot[] = [];
                if (etaIndex === index) {
                  planned = roundQty(planned + firstLot);
                  st.plannedByIndex.set(index, planned);
                  closing = roundQty(closing + firstLot);
                  plannedLots.push({ lot_no: 1, plant_eta: day, qty_base: firstLot });
                } else if (etaIndex > index) {
                  st.plannedByIndex.set(etaIndex, roundQty((st.plannedByIndex.get(etaIndex) ?? 0) + firstLot));
                  plannedLots.push({ lot_no: 1, plant_eta: eta, qty_base: firstLot });
                  st.pendingUntil = etaIndex;
                } else {
                  plannedLots.push({ lot_no: 1, plant_eta: eta, qty_base: firstLot });
                  st.pendingUntil = allDays.length; // earliest arrival is after the horizon
                }
                st.buys.push(freeze({
                  material_id: materialId, sequence: st.sequence, required_qty_base: sizedRequired, recommended_po_qty_base: orderQty,
                  recommended_po_by: late ? input.as_of : poBy, estimated_plant_eta: eta, need_date: day, lots: plannedLots, total_lead_time_days: lotLead,
                  status: late ? "ADVISORY_LATE" : "ADVISORY",
                  reason: late
                    ? `PO-by date ${poBy} has already passed; ordering today arrives ${eta}. The cover gap until then stays visible.`
                    : pick?.bridge
                      ? "Bridge: the cheapest vendor cannot arrive in time, so this lot uses the fastest vendor; the cheaper vendor takes the later lots."
                      : cycle !== null ? "Sized to Max days (Target + best order cycle); vendor MOQ / multiple respected." : "Deterministic Target-cover replenishment; lead time = Booking Time + route lead time.",
                  advisory_only: true as const,
                  ...p2,
                }));
              }
            }
          }
        }
      }

      st.balance = closing;
      const maxCover = cover(closing, index);
      const minStock = roundQty(closing - st.arrival - planned);
      const minCover = cover(minStock, index);
      if (st.firstShortage === null && closing < -EPSILON) st.firstShortage = day;
      if (st.firstCritical === null && critical !== null && maxCover !== null && maxCover <= critical) st.firstCritical = day;
      if (st.firstTarget === null && target !== null && maxCover !== null && maxCover <= target) st.firstTarget = day;
      rows.push(freeze({
        material_id: materialId, day, opening_qty_base: roundQty(st.opening), confirmed_arrival_qty_base: st.arrival, planned_lot_qty_base: planned,
        demand_qty_base: demand[index], group_draw_qty_base: st.groupDraw[index], closing_qty_base: closing, max_cover_days: maxCover,
        min_stock_qty_base: minStock, min_cover_days: minCover, target_days: target, critical_days: critical, executable_arrival: false as const,
      }));
    }
  });

  const risks: OptimizerMaterialRisk[] = [];
  const buys: OptimizerAdvisoryBuy[] = [];
  for (const st of ordered) {
    risks.push(freeze({ material_id: st.id, first_shortage_day: st.firstShortage, first_below_critical_day: st.firstCritical, first_below_target_day: st.firstTarget, projected_closing_qty_base: roundQty(st.balance) }));
    const anyCoverage = allDays.some((day) => { const c = coverageAt(st.policy, day); return c.target !== null && c.critical !== null; });
    if (!st.policy || !anyCoverage) {
      buys.push(freeze({
        material_id: st.id, sequence: 0, required_qty_base: Math.max(0, roundQty(-st.balance)), recommended_po_qty_base: null, recommended_po_by: null,
        estimated_plant_eta: null, need_date: null, lots: [], total_lead_time_days: st.leadTime, status: "UNKNOWN_POLICY",
        reason: "Target/Critical policy is missing; no new-buy quantity is authorized.", advisory_only: true as const,
      }));
    } else if (st.buys.length === 0) {
      buys.push(freeze({
        material_id: st.id, sequence: 0, required_qty_base: 0, recommended_po_qty_base: null, recommended_po_by: null, estimated_plant_eta: null,
        need_date: null, lots: [], total_lead_time_days: st.leadTime, status: "NO_BUY", reason: "Projected cover stays above Target through the horizon.", advisory_only: true as const,
      }));
    } else buys.push(...st.buys);
  }

  const groupPoolRisks: OptimizerGroupPoolRisk[] = [...pool.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([groupId, value]) => freeze({ group_id: groupId === "" ? null : groupId, unresolved_qty_base: value.qty, first_day: value.first }));
  return freeze({
    rows: rows.sort((a, b) => a.material_id.localeCompare(b.material_id) || a.day.localeCompare(b.day)),
    risks: risks.sort((a, b) => a.material_id.localeCompare(b.material_id)),
    group_pool_risks: groupPoolRisks,
    arrival_flags: arrivalFlags.sort((a, b) => a.source_key.localeCompare(b.source_key)),
    advisory_buys: buys.sort((a, b) => a.material_id.localeCompare(b.material_id) || a.sequence - b.sequence),
  });
}
