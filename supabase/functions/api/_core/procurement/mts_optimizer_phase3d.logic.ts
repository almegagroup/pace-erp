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
  const total = demand.reduce((sum, qty) => sum + qty, 0);
  const average = demand.length === 0 ? 0 : total / demand.length;
  return (balance: number, fromIndex: number): number | null => {
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
 * Projects confirmed lifecycle arrivals plus proposed lots. Material-null GROUP_POOL demand is
 * reported per group and is never assigned to, or copied onto, a member material.
 */
export function projectDailyCoverage(input: OptimizerProjectionInput): OptimizerProjectionResult {
  if (!ISO_DAY.test(input.as_of) || !ISO_DAY.test(input.horizon_end) || input.horizon_end < input.as_of) throw new Error("PHASE3D_INVALID_HORIZON");
  const policyByMaterial = new Map(input.policies.map((policy) => [policy.material_id, policy]));
  if (policyByMaterial.size !== input.policies.length) throw new Error("PHASE3D_DUPLICATE_POLICY");
  const allDays = days(input.as_of, input.horizon_end);

  const demandByDay = new Map<string, number>();
  const pool = new Map<string, { qty: number; first: string | null }>();
  for (const row of input.daily_demand) {
    if (!validQty(row.qty_base) || row.required_by === null || !ISO_DAY.test(row.required_by)) continue;
    if (row.required_by < input.as_of || row.required_by > input.horizon_end) continue;
    if (row.material_id === null) {
      const groupKey = row.group_id ?? "";
      const seen = pool.get(groupKey) ?? { qty: 0, first: null };
      pool.set(groupKey, { qty: roundQty(seen.qty + row.qty_base), first: seen.first === null || row.required_by < seen.first ? row.required_by : seen.first });
    } else add(demandByDay, key(row.material_id, row.required_by), row.qty_base);
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
  ]);
  const rows: OptimizerDailyProjectionRow[] = [];
  const risks: OptimizerMaterialRisk[] = [];
  const buys: OptimizerAdvisoryBuy[] = [];

  for (const materialId of [...materialIds].sort()) {
    const opening0 = Number(input.opening_qty_by_material[materialId] ?? 0);
    if (!validQty(opening0)) throw new Error(`PHASE3D_INVALID_OPENING_QTY:${materialId}`);
    const policy = policyByMaterial.get(materialId);
    const demand = allDays.map((day) => demandByDay.get(key(materialId, day)) ?? 0);
    const cover = makeCoverFn(demand);
    const leadTime = policy ? totalLeadTimeDays(policy) : null;
    const plannedByIndex = new Map<number, number>();
    const queuedLots: number[] = [];
    let pendingUntil = -1;
    let sequence = 0;
    let balance = opening0;
    let firstShortage: string | null = null;
    let firstCritical: string | null = null;
    let firstTarget: string | null = null;
    const materialBuys: OptimizerAdvisoryBuy[] = [];

    allDays.forEach((day, index) => {
      const opening = balance;
      const arrival = arrivalByDay.get(key(materialId, day)) ?? 0;
      const need = demand[index];
      const { target, critical } = coverageAt(policy, day);
      let planned = plannedByIndex.get(index) ?? 0;
      let closing = roundQty(opening + arrival + planned - need);

      // D2: a proposed lot is needed on the first day cover falls to/below Target, unless one is pending.
      const canPlan = !!policy && target !== null && critical !== null && index > pendingUntil;
      if (canPlan) {
        const currentCover = cover(closing, index);
        if (currentCover !== null && currentCover <= target!) {
          const required = qtyToRestore(demand, index, closing, target!);
          if (required > EPSILON) {
            if (queuedLots.length > 0) {
              // Next dated lot of an already recommended order (no new PO).
              const lot = queuedLots.shift()!;
              planned = roundQty(planned + lot);
              plannedByIndex.set(index, planned);
              closing = roundQty(closing + lot);
              const last = materialBuys[materialBuys.length - 1];
              const lots = [...last.lots, { lot_no: last.lots.length + 1, plant_eta: day, qty_base: lot }];
              materialBuys[materialBuys.length - 1] = freeze({ ...last, lots });
            } else {
              const orderQty = applyOrderConstraints(required, policy!);
              sequence += 1;
              if (leadTime === null) {
                materialBuys.push(freeze({
                  material_id: materialId, sequence, required_qty_base: required, recommended_po_qty_base: orderQty, recommended_po_by: null,
                  estimated_plant_eta: day, need_date: day, lots: [], total_lead_time_days: null, status: "UNKNOWN_LEAD_TIME",
                  reason: "Lead time is missing (vendor route lead time / Booking Time); PO-by date is unknown and no lot is projected.", advisory_only: true as const,
                }));
                pendingUntil = allDays.length; // one unknown-lead-time recommendation is enough
              } else if (orderQty !== null) {
                const lots = splitIntoLots(orderQty, policy!.delivery_lot_qty_base);
                const poBy = addDays(day, -leadTime);
                const late = poBy < input.as_of;
                const eta = late ? addDays(input.as_of, leadTime) : day;
                const etaIndex = allDays.indexOf(eta);
                const firstLot = lots.shift()!;
                queuedLots.push(...lots);
                const plannedLots: OptimizerPlannedLot[] = [];
                if (etaIndex === index) {
                  planned = roundQty(planned + firstLot);
                  plannedByIndex.set(index, planned);
                  closing = roundQty(closing + firstLot);
                  plannedLots.push({ lot_no: 1, plant_eta: day, qty_base: firstLot });
                } else if (etaIndex > index) {
                  plannedByIndex.set(etaIndex, roundQty((plannedByIndex.get(etaIndex) ?? 0) + firstLot));
                  plannedLots.push({ lot_no: 1, plant_eta: eta, qty_base: firstLot });
                  pendingUntil = etaIndex;
                } else {
                  plannedLots.push({ lot_no: 1, plant_eta: eta, qty_base: firstLot });
                  pendingUntil = allDays.length; // earliest arrival is after the horizon
                }
                materialBuys.push(freeze({
                  material_id: materialId, sequence, required_qty_base: required, recommended_po_qty_base: orderQty,
                  recommended_po_by: late ? input.as_of : poBy, estimated_plant_eta: eta, need_date: day, lots: plannedLots, total_lead_time_days: leadTime,
                  status: late ? "ADVISORY_LATE" : "ADVISORY",
                  reason: late
                    ? `PO-by date ${poBy} has already passed; ordering today arrives ${eta}. The cover gap until then stays visible.`
                    : "Deterministic Target-cover replenishment; lead time = Booking Time + route lead time.",
                  advisory_only: true as const,
                }));
              }
            }
          }
        }
      }

      balance = closing;
      const maxCover = cover(closing, index);
      const minStock = roundQty(closing - arrival - planned);
      const minCover = cover(minStock, index);
      if (firstShortage === null && closing < -EPSILON) firstShortage = day;
      if (firstCritical === null && critical !== null && maxCover !== null && maxCover <= critical) firstCritical = day;
      if (firstTarget === null && target !== null && maxCover !== null && maxCover <= target) firstTarget = day;
      rows.push(freeze({
        material_id: materialId, day, opening_qty_base: roundQty(opening), confirmed_arrival_qty_base: arrival, planned_lot_qty_base: planned,
        demand_qty_base: need, closing_qty_base: closing, max_cover_days: maxCover, min_stock_qty_base: minStock, min_cover_days: minCover,
        target_days: target, critical_days: critical, executable_arrival: false as const,
      }));
    });

    risks.push(freeze({ material_id: materialId, first_shortage_day: firstShortage, first_below_critical_day: firstCritical, first_below_target_day: firstTarget, projected_closing_qty_base: roundQty(balance) }));
    const anyCoverage = allDays.some((day) => { const c = coverageAt(policy, day); return c.target !== null && c.critical !== null; });
    if (!policy || !anyCoverage) {
      buys.push(freeze({
        material_id: materialId, sequence: 0, required_qty_base: Math.max(0, roundQty(-balance)), recommended_po_qty_base: null, recommended_po_by: null,
        estimated_plant_eta: null, need_date: null, lots: [], total_lead_time_days: leadTime, status: "UNKNOWN_POLICY",
        reason: "Target/Critical policy is missing; no new-buy quantity is authorized.", advisory_only: true as const,
      }));
    } else if (materialBuys.length === 0) {
      buys.push(freeze({
        material_id: materialId, sequence: 0, required_qty_base: 0, recommended_po_qty_base: null, recommended_po_by: null, estimated_plant_eta: null,
        need_date: null, lots: [], total_lead_time_days: leadTime, status: "NO_BUY", reason: "Projected cover stays above Target through the horizon.", advisory_only: true as const,
      }));
    } else buys.push(...materialBuys);
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
