/* PO22 Phase 3C — deterministic joint current-stock allocator.
 * Existing PO22 requirement formulas deliberately remain untouched.
 */
import { roundQty } from "./mts_requirement.logic.ts";
import type { OptimizerDemandInput, OptimizerInputSnapshot } from "./mts_optimizer_input.types.ts";
import type {
  OptimizerAllocationException,
  OptimizerAllocationInput,
  OptimizerAllocationResult,
  OptimizerAllocationRow,
  OptimizerGroupMember,
  OptimizerMaterialBalance,
  OptimizerProjectedInbound,
} from "./mts_optimizer_phase3c.types.ts";

const EPSILON = 0.0000001;

function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return value;
}
function add(map: Map<string, number>, key: string, qty: number): void {
  map.set(key, roundQty((map.get(key) ?? 0) + qty));
}
function currentStockBlocked(snapshot: OptimizerInputSnapshot, materialId: string): boolean {
  return snapshot.planning_blockers.some((blocker) => blocker.material_id === materialId && blocker.domain === "EXECUTABLE_STOCK")
    || snapshot.missing_data.some((missing) => missing.material_id === materialId && missing.source === "RESERVATION")
}
function demandSort(left: OptimizerDemandInput, right: OptimizerDemandInput): number {
  // An exact production date has priority over a monthly/period forecast. Never
  // invent an exact date for a null source date.
  const leftDate = left.required_by ?? "9999-12-31";
  const rightDate = right.required_by ?? "9999-12-31";
  return leftDate.localeCompare(rightDate)
    || (left.demand_kind === right.demand_kind ? 0 : left.demand_kind === "FIXED_EXCLUSIVE" ? -1 : 1)
    || left.source_key.localeCompare(right.source_key);
}
function state(required: number, allocated: number, blocked: boolean): OptimizerAllocationRow["allocation_state"] {
  if (blocked) return "BLOCKED";
  if (allocated <= EPSILON) return "UNALLOCATED";
  return allocated + EPSILON >= required ? "ALLOCATED" : "PARTIAL";
}

type MaterialState = { base_uom_code: string; posted: number; reserved: number; opening: number; remaining: number; blocked: boolean };

function materialStates(snapshot: OptimizerInputSnapshot): Map<string, MaterialState> {
  const materials = new Map(snapshot.materials.map((row) => [row.material_id, row.base_uom_code]));
  const posted = new Map<string, number>();
  const reserved = new Map<string, number>();
  for (const row of snapshot.stock) {
    if (row.planning_eligible && row.qty_base !== null) add(posted, row.material_id, row.qty_base);
  }
  for (const row of snapshot.reservations) {
    if (["OPEN", "PARTIAL"].includes(row.status.toUpperCase()) && row.qty_base !== null) add(reserved, row.material_id, row.qty_base);
  }
  const result = new Map<string, MaterialState>();
  for (const [materialId, base_uom_code] of materials) {
    const isBlocked = currentStockBlocked(snapshot, materialId);
    const physical = posted.get(materialId) ?? 0;
    const reservation = reserved.get(materialId) ?? 0;
    const opening = isBlocked ? 0 : Math.max(0, roundQty(physical - reservation));
    result.set(materialId, { base_uom_code, posted: physical, reserved: reservation, opening, remaining: opening, blocked: isBlocked });
  }
  return result;
}

function membersByDemandGroup(rows: readonly OptimizerGroupMember[]): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.active || !row.demand_source_key || !row.group_id || !row.material_id || !row.source_key) continue;
    const set = out.get(`${row.demand_source_key}\u0000${row.group_id}`) ?? new Set<string>();
    set.add(row.material_id);
    out.set(`${row.demand_source_key}\u0000${row.group_id}`, set);
  }
  return new Map([...out.entries()].map(([demandSource, members]) => [demandSource, [...members].sort()]));
}

function rowFor(demand: OptimizerDemandInput, materialId: string | null, executableQty: number, uncoveredQty: number, blocked: boolean, reason: string | null): OptimizerAllocationRow {
  return freeze({
    demand_source_key: demand.source_key, product_id: demand.product_id, source_line_id: demand.source_line_id,
    required_by: demand.required_by, demand_kind: demand.demand_kind, group_id: demand.group_id,
    material_id: materialId, base_uom_code: demand.base_uom_code, required_qty_base: roundQty(executableQty + uncoveredQty),
    executable_qty_base: roundQty(executableQty), uncovered_qty_base: roundQty(uncoveredQty),
    allocation_state: state(executableQty + uncoveredQty, executableQty, blocked), executable: true, reason,
  });
}

/**
 * Allocates only posted, eligible company stock net of valid reservations.
 * Future inbound is returned separately for a later dated-projection phase and
 * can never increase `executable_qty_base` in this result.
 */
export function allocateCurrentPhysicalStock(input: OptimizerAllocationInput): OptimizerAllocationResult {
  const snapshot = input.snapshot;
  const states = materialStates(snapshot);
  const members = membersByDemandGroup(input.group_members);
  const suppliedGroupsByDemand = new Map<string, Set<string>>();
  for (const member of input.group_members) {
    if (!member.active || !member.demand_source_key || !member.group_id || !member.material_id || !member.source_key) continue;
    const groups = suppliedGroupsByDemand.get(member.demand_source_key) ?? new Set<string>();
    groups.add(member.group_id);
    suppliedGroupsByDemand.set(member.demand_source_key, groups);
  }
  const rows: OptimizerAllocationRow[] = [];
  const exceptions: OptimizerAllocationException[] = [];
  const demands = [...snapshot.demand].sort(demandSort);

  for (const demand of demands) {
    if (demand.qty_base === null || !demand.base_uom_code || demand.qty_base < 0) {
      exceptions.push(freeze({ code: "DEMAND_NOT_NORMALIZED", source_key: demand.source_key, material_id: demand.material_id, message: "Demand lacks verified base-UOM quantity and is not allocated." }));
      rows.push(rowFor(demand, demand.material_id, 0, 0, true, "DEMAND_NOT_NORMALIZED"));
      continue;
    }
    let remainingNeed = demand.qty_base;
    if (demand.demand_kind === "FIXED_EXCLUSIVE") {
      if (!demand.material_id) {
        exceptions.push(freeze({ code: "FIXED_MATERIAL_MISSING", source_key: demand.source_key, material_id: null, message: "Fixed/exclusive demand requires a material identity." }));
        rows.push(rowFor(demand, null, 0, remainingNeed, true, "FIXED_MATERIAL_MISSING"));
        continue;
      }
      const material = states.get(demand.material_id);
      const compatible = !!material && material.base_uom_code === demand.base_uom_code;
      const blocked = !compatible || !!material?.blocked;
      if (blocked) exceptions.push(freeze({ code: "MATERIAL_EXECUTABLE_STOCK_BLOCKED", source_key: demand.source_key, material_id: demand.material_id, message: "Fixed demand has no verified executable material balance." }));
      const allocated = blocked ? 0 : Math.min(remainingNeed, material!.remaining);
      if (!blocked) material!.remaining = roundQty(material!.remaining - allocated);
      rows.push(rowFor(demand, demand.material_id, allocated, remainingNeed - allocated, blocked, blocked ? "EXECUTABLE_STOCK_BLOCKED" : allocated + EPSILON < remainingNeed ? "PHYSICAL_SHORTAGE" : null));
      continue;
    }
    if (!demand.group_id) {
      exceptions.push(freeze({ code: "GROUP_ID_MISSING", source_key: demand.source_key, material_id: null, message: "Group-pool demand requires a group identity." }));
      rows.push(rowFor(demand, null, 0, remainingNeed, true, "GROUP_ID_MISSING"));
      continue;
    }
    const suppliedGroups = suppliedGroupsByDemand.get(demand.source_key);
    if (suppliedGroups && !suppliedGroups.has(demand.group_id)) {
      exceptions.push(freeze({ code: "GROUP_MEMBER_GROUP_MISMATCH", source_key: demand.source_key, material_id: null, message: "Group-member evidence belongs to a different group than the demand source and was rejected." }));
      rows.push(rowFor(demand, null, 0, remainingNeed, true, "GROUP_MEMBER_GROUP_MISMATCH"));
      continue;
    }
    const candidateIds = members.get(`${demand.source_key}\u0000${demand.group_id}`) ?? [];
    const candidates = candidateIds.map((id) => [id, states.get(id)] as const)
      .filter((pair): pair is readonly [string, MaterialState] => !!pair[1] && pair[1].base_uom_code === demand.base_uom_code && !pair[1].blocked)
      // Prefer the greatest *currently available* eligible quantity; tie-break
      // only after feasibility is equal, never as an arbitrary default owner.
      .sort((a, b) => b[1].remaining - a[1].remaining || a[0].localeCompare(b[0]));
    if (candidateIds.length === 0) {
      exceptions.push(freeze({ code: "NO_ACTIVE_GROUP_MEMBER", source_key: demand.source_key, material_id: null, message: "No active member was supplied for this group pool." }));
      rows.push(rowFor(demand, null, 0, remainingNeed, true, "NO_ACTIVE_GROUP_MEMBER"));
      continue;
    }
    if (candidates.length === 0) {
      exceptions.push(freeze({ code: "GROUP_MEMBER_UOM_MISMATCH", source_key: demand.source_key, material_id: null, message: "No active group member has compatible, unblocked base-UOM stock." }));
      rows.push(rowFor(demand, null, 0, remainingNeed, false, "GROUP_MEMBER_UNAVAILABLE"));
      continue;
    }
    for (const [materialId, material] of candidates) {
      if (remainingNeed <= EPSILON) break;
      const allocated = Math.min(remainingNeed, material.remaining);
      if (allocated <= EPSILON) continue;
      material.remaining = roundQty(material.remaining - allocated);
      remainingNeed = roundQty(remainingNeed - allocated);
      rows.push(rowFor(demand, materialId, allocated, 0, false, null));
    }
    if (remainingNeed > EPSILON) {
      // Crucial contract: no member is fabricated for the uncovered residue.
      rows.push(rowFor(demand, null, 0, remainingNeed, false, "GROUP_POOL_UNCOVERED"));
    }
  }

  const balances: OptimizerMaterialBalance[] = [...states.entries()].map(([material_id, item]) => freeze({
    material_id, base_uom_code: item.base_uom_code, posted_eligible_qty_base: item.posted,
    reservation_qty_base: item.reserved, executable_opening_qty_base: item.opening,
    executable_allocated_qty_base: roundQty(item.opening - item.remaining), executable_closing_qty_base: item.remaining,
    executable_stock_blocked: item.blocked,
  })).sort((a, b) => a.material_id.localeCompare(b.material_id));
  const projected: OptimizerProjectedInbound[] = snapshot.inbound
    .filter((row) => row.projected_supply_eligible && row.qty_base !== null && row.base_uom_code !== null && row.eta_to_plant !== null)
    .map((row) => freeze({ source_key: row.source_key, material_id: row.material_id, qty_base: row.qty_base!, base_uom_code: row.base_uom_code!, eta_to_plant: row.eta_to_plant!, executable: false as const }))
    .sort((a, b) => a.eta_to_plant.localeCompare(b.eta_to_plant) || a.source_key.localeCompare(b.source_key));
  return freeze({ company_id: snapshot.company_id, as_of: snapshot.as_of, source_fingerprint: snapshot.source_fingerprint,
    rows: rows.sort((a, b) => {
      const byDemand = a.demand_source_key.localeCompare(b.demand_source_key);
      if (byDemand) return byDemand;
      // Keep a material-null residual after real allocations for its pool.
      if (a.material_id === null || b.material_id === null) return a.material_id === b.material_id ? 0 : a.material_id === null ? 1 : -1;
      return a.material_id.localeCompare(b.material_id);
    }),
    material_balances: balances, projected_inbound: projected,
    exceptions: exceptions.sort((a, b) => `${a.source_key}|${a.code}`.localeCompare(`${b.source_key}|${b.code}`)),
  });
}
