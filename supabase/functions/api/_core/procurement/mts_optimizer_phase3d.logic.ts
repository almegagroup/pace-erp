/* PO22 Phase 3D — pure daily coverage / future-consignment projection.
 * It makes no database call and never creates a PO, CSN, GRN, transfer or Store action.
 */
import { roundQty } from "./mts_requirement.logic.ts";
import type {
  OptimizerAdvisoryBuy,
  OptimizerDailyProjectionRow,
  OptimizerMaterialPlanningPolicy,
  OptimizerMaterialRisk,
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

function dailyRate(rows: readonly OptimizerDailyProjectionRow[], start: string, count: number): number {
  const selection = rows.filter((row) => row.day >= start).slice(0, count);
  return selection.length === 0 ? 0 : selection.reduce((total, row) => total + row.demand_qty_base, 0) / selection.length;
}

/**
 * Projects confirmed lifecycle arrivals only. Material-null GROUP_POOL demand
 * remains visible as unresolved risk and is never assigned to a default member.
 */
export function projectDailyCoverage(input: OptimizerProjectionInput): OptimizerProjectionResult {
  if (!ISO_DAY.test(input.as_of) || !ISO_DAY.test(input.horizon_end) || input.horizon_end < input.as_of) throw new Error("PHASE3D_INVALID_HORIZON");
  const policyByMaterial = new Map(input.policies.map((policy) => [policy.material_id, policy]));
  if (policyByMaterial.size !== input.policies.length) throw new Error("PHASE3D_DUPLICATE_POLICY");
  const materialIds = new Set<string>([...Object.keys(input.opening_qty_by_material), ...input.daily_demand.flatMap((row) => row.material_id ? [row.material_id] : []), ...input.confirmed_arrivals.map((row) => row.material_id)]);
  const demandByDay = new Map<string, number>();
  const arrivalByDay = new Map<string, number>();
  const unresolvedByDay = new Map<string, number>();
  for (const row of input.daily_demand) {
    if (!validQty(row.qty_base) || row.required_by === null || !ISO_DAY.test(row.required_by)) continue;
    if (row.material_id === null) add(unresolvedByDay, row.required_by, row.qty_base);
    else add(demandByDay, key(row.material_id, row.required_by), row.qty_base);
  }
  for (const row of input.confirmed_arrivals) {
    if (!validQty(row.qty_base) || row.eta_to_plant === null || !ISO_DAY.test(row.eta_to_plant) || row.eta_to_plant < input.as_of) continue;
    add(arrivalByDay, key(row.material_id, row.eta_to_plant), row.qty_base);
  }
  const rows: OptimizerDailyProjectionRow[] = [];
  const risks: OptimizerMaterialRisk[] = [];
  const buys: OptimizerAdvisoryBuy[] = [];
  const allDays = days(input.as_of, input.horizon_end);
  const unresolvedGroupQty = [...unresolvedByDay.entries()].filter(([day]) => day >= input.as_of && day <= input.horizon_end).reduce((sum, [, qty]) => sum + qty, 0);
  for (const materialId of [...materialIds].sort()) {
    let balance = Number(input.opening_qty_by_material[materialId] ?? 0);
    if (!validQty(balance)) throw new Error(`PHASE3D_INVALID_OPENING_QTY:${materialId}`);
    const materialRows: OptimizerDailyProjectionRow[] = [];
    for (const day of allDays) {
      const opening = balance;
      const arrival = arrivalByDay.get(key(materialId, day)) ?? 0;
      const demand = demandByDay.get(key(materialId, day)) ?? 0;
      balance = roundQty(opening + arrival - demand);
      materialRows.push(freeze({ material_id: materialId, day, opening_qty_base: opening, confirmed_arrival_qty_base: arrival, demand_qty_base: demand, closing_qty_base: balance, executable_arrival: false as const }));
    }
    rows.push(...materialRows);
    const policy = policyByMaterial.get(materialId);
    const rate = dailyRate(materialRows, input.as_of, 30);
    const criticalFloor = policy?.critical_days !== null && policy?.critical_days !== undefined && rate > EPSILON ? rate * policy.critical_days : null;
    const targetFloor = policy?.target_days !== null && policy?.target_days !== undefined && rate > EPSILON ? rate * policy.target_days : null;
    const first = (floor: number) => materialRows.find((row) => row.closing_qty_base < floor - EPSILON)?.day ?? null;
    const shortageDay = first(0);
    const criticalDay = criticalFloor === null ? null : first(criticalFloor);
    const targetDay = targetFloor === null ? null : first(targetFloor);
    risks.push(freeze({ material_id: materialId, first_shortage_day: shortageDay, first_below_critical_day: criticalDay, first_below_target_day: targetDay, projected_closing_qty_base: balance, unresolved_group_pool_qty_base: roundQty(unresolvedGroupQty) }));
    const required = Math.max(0, roundQty((targetFloor ?? 0) - balance));
    if (required <= EPSILON) { buys.push(freeze({ material_id: materialId, required_qty_base: 0, recommended_po_qty_base: null, recommended_po_by: null, estimated_plant_eta: null, status: "NO_BUY", reason: "Projected closing balance meets the available target policy.", advisory_only: true as const })); continue; }
    if (!policy || policy.target_days === null || policy.critical_days === null) { buys.push(freeze({ material_id: materialId, required_qty_base: required, recommended_po_qty_base: null, recommended_po_by: null, estimated_plant_eta: null, status: "UNKNOWN_POLICY", reason: "Target/Critical policy is missing; no new-buy quantity is authorized.", advisory_only: true as const })); continue; }
    if (policy.configured_lead_time_days === null || !Number.isInteger(policy.configured_lead_time_days) || policy.configured_lead_time_days < 0) { buys.push(freeze({ material_id: materialId, required_qty_base: required, recommended_po_qty_base: null, recommended_po_by: null, estimated_plant_eta: null, status: "UNKNOWN_LEAD_TIME", reason: "Configured plant lead time is missing or invalid; PO-by date is unknown.", advisory_only: true as const })); continue; }
    const eta = shortageDay ?? input.horizon_end;
    buys.push(freeze({ material_id: materialId, required_qty_base: required, recommended_po_qty_base: applyOrderConstraints(required, policy), recommended_po_by: addDays(eta, -policy.configured_lead_time_days), estimated_plant_eta: eta, status: "ADVISORY", reason: "Deterministic target-floor replenishment; lead time already includes processing and plant delivery.", advisory_only: true as const }));
  }
  return freeze({ rows: rows.sort((a, b) => a.material_id.localeCompare(b.material_id) || a.day.localeCompare(b.day)), risks: risks.sort((a, b) => a.material_id.localeCompare(b.material_id)), advisory_buys: buys.sort((a, b) => a.material_id.localeCompare(b.material_id)) });
}
