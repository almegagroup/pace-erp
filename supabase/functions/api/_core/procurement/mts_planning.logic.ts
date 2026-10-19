/*
 * PO22 Planning (sheet PLANNING equivalent) — pure assembly from the Requirement result
 * into the Phase 3D projection input. No database access.
 *
 * Owner decisions (common:docs/po22-common/OWNER-DECISIONS-2026-10-19-REQUIREMENT-AND-GROUPS.md):
 *   D3  group shortage is bought through the member the user selected for new buy in that month
 *       (six-month selection); several selected → cheapest last purchase price; none → stays a
 *       group risk ("select a member"), never charged to a member automatically.
 *   D4  MOQ / order multiple / delivery lot come from the vendor-material master.
 *   D6  lead time = Booking Time (blank = 0) + route lead time of that vendor.
 */
import { monthStart, type GroupRequirementRow, type PlanningCalendar, type PolicyRow, type RequirementRow } from "./mts_requirement.logic.ts";
import type { OptimizerConfirmedArrival, OptimizerDailyDemand, OptimizerMaterialPlanningPolicy, OptimizerProjectionInput } from "./mts_optimizer_phase3d.types.ts";

export type VendorTerm = {
  vendor_id: string;
  vendor_label: string;
  material_id: string;
  moq_base: number | null;
  multiple_base: number | null;
  lot_base: number | null;
  booking_days: number | null;
  /** Largest configured route for this vendor (transit only); null = route not configured. */
  route_days: number | null;
  last_price: number | null;
  currency: string | null;
};

export type GroupAssignment = {
  group_id: string;
  month: string;
  assigned_material_id: string | null;
  reason: "SINGLE_SELECTED" | "CHEAPEST_SELECTED" | "NONE_SELECTED";
  uncovered_qty: number;
};

export type PlanningAssembly = {
  input: OptimizerProjectionInput;
  chosen_vendor: Map<string, VendorTerm | null>;
  group_assignments: GroupAssignment[];
};

const EPSILON = 0.0000001;

/** Vendor with a known route and the shortest total lead time; ties → smaller MOQ → label. */
export function chooseVendor(terms: readonly VendorTerm[]): VendorTerm | null {
  const total = (t: VendorTerm) => (t.route_days === null ? Number.POSITIVE_INFINITY : (t.booking_days ?? 0) + t.route_days);
  return [...terms].sort((a, b) => total(a) - total(b) || (a.moq_base ?? 0) - (b.moq_base ?? 0) || a.vendor_label.localeCompare(b.vendor_label))[0] ?? null;
}

/** D3 member for a group's new buy in a month. */
export function selectGroupMember(
  memberIds: readonly string[],
  selectedInMonth: ReadonlySet<string>,
  priceOf: (materialId: string) => number | null,
): { material_id: string | null; reason: GroupAssignment["reason"] } {
  const selected = memberIds.filter((id) => selectedInMonth.has(id)).sort();
  if (selected.length === 0) return { material_id: null, reason: "NONE_SELECTED" };
  if (selected.length === 1) return { material_id: selected[0], reason: "SINGLE_SELECTED" };
  const priced = [...selected].sort((a, b) => (priceOf(a) ?? Number.POSITIVE_INFINITY) - (priceOf(b) ?? Number.POSITIVE_INFINITY) || a.localeCompare(b));
  return { material_id: priced[0], reason: "CHEAPEST_SELECTED" };
}

export function assemblePlanningInput(args: {
  calendar: PlanningCalendar;
  rows: readonly RequirementRow[];
  groups: readonly GroupRequirementRow[];
  policies: readonly PolicyRow[];
  vendorTerms: ReadonlyMap<string, readonly VendorTerm[]>;
  /** month (YYYY-MM-01) → materials selected for new buy. */
  selections: ReadonlyMap<string, ReadonlySet<string>>;
  /** policy MOQ in base unit (fallback when no vendor MOQ). */
  policyMoqBase: ReadonlyMap<string, number | null>;
}): PlanningAssembly {
  const { calendar } = args;
  const inHorizon = (day: string) => day >= calendar.asOf && day <= calendar.nmEnd;
  const chosen = new Map<string, VendorTerm | null>();
  const opening: Record<string, number> = {};
  const demand: OptimizerDailyDemand[] = [];
  const arrivals: OptimizerConfirmedArrival[] = [];
  const policies: OptimizerMaterialPlanningPolicy[] = [];
  const priceOf = (id: string) => chooseVendor(args.vendorTerms.get(id) ?? [])?.last_price ?? null;

  for (const row of args.rows) {
    if (row.kind !== "RM" && row.kind !== "PM") continue;
    const id = row.material_id;
    opening[id] = Math.max(0, row.stock.usable_at_required);
    for (const [day, qty] of row.daily_demand) {
      if (inHorizon(day) && qty > EPSILON) demand.push({ source_key: `M|${id}|${day}`, material_id: id, required_by: day, qty_base: qty });
    }
    for (const [index, event] of row.inbound_events.entries()) {
      arrivals.push({ source_key: `A|${id}|${index}|${event.reference}`, material_id: id, eta_to_plant: event.date, qty_base: event.qty, lifecycle_kind: event.kind });
    }
    const vendor = chooseVendor(args.vendorTerms.get(id) ?? []);
    chosen.set(id, vendor);
    const versions = args.policies.filter((p) => p.material_id === id)
      .map((p) => ({ effective_from: p.effective_from, target_days: p.target_cov_days, critical_days: p.critical_cov_days }));
    const policy = row.policy;
    const policyMoq = policy?.moq_active ? args.policyMoqBase.get(id) ?? null : null;
    policies.push({
      material_id: id,
      target_days: policy?.target_cov_days ?? null,
      critical_days: policy?.critical_cov_days ?? null,
      coverage_versions: versions,
      vendor_moq_qty_base: vendor?.moq_base ?? policyMoq,
      order_multiple_qty_base: vendor?.multiple_base ?? null,
      delivery_lot_qty_base: vendor?.lot_base ?? null,
      configured_lead_time_days: row.lead_time?.effective ?? null,
      booking_time_days: vendor?.booking_days ?? null,
      route_lead_time_days: vendor?.route_days ?? null,
    });
  }

  const assignments: GroupAssignment[] = [];
  const assignedByKey = new Map<string, GroupAssignment>();
  for (const group of args.groups) {
    for (const [day, qty] of group.uncovered_by_day) {
      if (!inHorizon(day) || qty <= EPSILON) continue;
      const month = monthStart(day);
      const key = `${group.group_id}|${month}`;
      let assignment = assignedByKey.get(key);
      if (!assignment) {
        const pick = selectGroupMember(group.member_ids, args.selections.get(month) ?? new Set(), priceOf);
        assignment = { group_id: group.group_id, month, assigned_material_id: pick.material_id, reason: pick.reason, uncovered_qty: 0 };
        assignedByKey.set(key, assignment);
        assignments.push(assignment);
      }
      assignment.uncovered_qty += qty;
      demand.push({
        source_key: `G|${group.group_id}|${day}`,
        material_id: assignment.assigned_material_id,
        group_id: group.group_id,
        required_by: day,
        qty_base: qty,
      });
    }
  }
  return {
    input: { as_of: calendar.asOf, horizon_end: calendar.nmEnd, opening_qty_by_material: opening, daily_demand: demand, confirmed_arrivals: arrivals, policies },
    chosen_vendor: chosen,
    group_assignments: assignments.map((a) => ({ ...a, uncovered_qty: Math.round(a.uncovered_qty * 1e6) / 1e6 })),
  };
}
