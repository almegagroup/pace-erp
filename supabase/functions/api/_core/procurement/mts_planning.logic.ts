/*
 * PO22 Planning (sheet PLANNING equivalent) — pure assembly from the Requirement result
 * into the Phase 3D projection input. No database access.
 *
 * Owner decisions (common:docs/po22-common/OWNER-DECISIONS-2026-10-19-REQUIREMENT-AND-GROUPS.md):
 *   D3  group shortage is bought through the member the user selected for new buy in that month
 *       (six-month selection); several selected → cheapest last purchase price. Nothing selected
 *       → (owner 2026-10-20, replaces "stays a group risk") the engine picks the member itself,
 *       labelled AUTO_SELECTED; only when no member has a vendor does it stay a group risk.
 *   Method C rule 6 (owner 2026-10-20): before that buy, the projection meets the group demand
 *       from the members' free stock — MOQ excess, arrivals — above their own Target days.
 *   D4  MOQ / order multiple / delivery lot come from the vendor-material master.
 *   D6  lead time = Booking Time (blank = 0) + route lead time of that vendor.
 */
import { monthStart, rToRTransferRoute, type GroupRequirementRow, type PlanningCalendar, type PolicyRow, type RequirementRow } from "./mts_requirement.logic.ts";
import type { OptimizerConfirmedArrival, OptimizerDailyDemand, OptimizerMaterialPlanningPolicy, OptimizerProjectionInput, OptimizerVendorOption } from "./mts_optimizer_phase3d.types.ts";

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
  /** MM03 Supply UoM of this vendor-material (Order UoM for this vendor's lines). */
  supply_uom_code?: string | null;
  /** Default payment term of this vendor-material: credit days; advance = paid before receipt. */
  credit_days?: number | null;
  advance?: boolean;
};

export type GroupAssignment = {
  group_id: string;
  month: string;
  assigned_material_id: string | null;
  /** AUTO_SELECTED: nothing selected, engine picked (owner 2026-10-20); NONE_SELECTED: no member has a vendor. */
  reason: "SINGLE_SELECTED" | "CHEAPEST_SELECTED" | "AUTO_SELECTED" | "NONE_SELECTED";
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

/** Cost of buying `qty` of a member by `needDay` through its best vendor (null = no vendor). */
export type MemberCost = { feasible: boolean; total_cost: number | null; lead_time_days: number | null };

/**
 * Owner 2026-10-20: when nothing is selected for a month the engine picks the member itself —
 * among members whose vendor can arrive by the need date, the lowest total cost (price + landed
 * cost + Rate + interest); if none can arrive in time, the fastest. No vendor at all → null.
 */
export function autoPickGroupMember(memberIds: readonly string[], costOf: (materialId: string) => MemberCost | null): string | null {
  const options = [...memberIds].sort().map((id) => ({ id, cost: costOf(id) })).filter((o): o is { id: string; cost: MemberCost } => !!o.cost);
  const inTime = options.filter((o) => o.cost.feasible);
  if (inTime.length > 0) {
    return inTime.sort((a, b) => (a.cost.total_cost ?? Number.POSITIVE_INFINITY) - (b.cost.total_cost ?? Number.POSITIVE_INFINITY)
      || (a.cost.lead_time_days ?? Number.POSITIVE_INFINITY) - (b.cost.lead_time_days ?? Number.POSITIVE_INFINITY) || a.id.localeCompare(b.id))[0].id;
  }
  const withLead = options.filter((o) => o.cost.lead_time_days !== null);
  return withLead.sort((a, b) => a.cost.lead_time_days! - b.cost.lead_time_days!
    || (a.cost.total_cost ?? Number.POSITIVE_INFINITY) - (b.cost.total_cost ?? Number.POSITIVE_INFINITY) || a.id.localeCompare(b.id))[0]?.id ?? null;
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
  /** Cost-ranked vendor per material (pass 2); absent = fastest feasible vendor. */
  vendorOverride?: ReadonlyMap<string, string>;
  /** Full cost of a member buy (handler); absent = last price + lead-time feasibility. */
  memberCost?: (materialId: string, qty: number, needDay: string) => MemberCost | null;
  /** P2: every vendor of a material with comparable cost and best cycle; each lot picks one. */
  vendorOptions?: ReadonlyMap<string, readonly OptimizerVendorOption[]>;
  /** P2: material order cycle when no vendor option gives one (Max days = Target + cycle). */
  cycleDays?: ReadonlyMap<string, number | null>;
}): PlanningAssembly {
  const { calendar } = args;
  const inHorizon = (day: string) => day >= calendar.asOf && day <= (calendar.horizonEnd ?? calendar.nmEnd);
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
    const terms = args.vendorTerms.get(id) ?? [];
    const override = args.vendorOverride?.get(id);
    const vendor = (override ? terms.find((t) => t.vendor_id === override) : undefined) ?? chooseVendor(terms);
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
      ...(args.cycleDays?.has(id) ? { cycle_days: args.cycleDays.get(id) ?? null } : {}),
      // A fixed policy MOQ (no vendor MOQ) still applies to every vendor option.
      ...(args.vendorOptions?.get(id)?.length ? {
        vendor_options: args.vendorOptions.get(id)!.map((o) => (o.moq_qty_base === null && policyMoq !== null ? { ...o, moq_qty_base: policyMoq } : o)),
      } : {}),
    });
  }

  const leadOf = (t: VendorTerm | null) => (!t || t.route_days === null ? null : (t.booking_days ?? 0) + t.route_days);
  const fallbackCost = (id: string, _qty: number, needDay: string): MemberCost | null => {
    const vendor = chooseVendor(args.vendorTerms.get(id) ?? []);
    if (!vendor) return null;
    const lead = leadOf(vendor);
    const arrive = lead === null ? null : new Date(Date.parse(`${calendar.asOf}T00:00:00Z`) + lead * 86_400_000).toISOString().slice(0, 10);
    return { feasible: arrive !== null && arrive <= needDay, total_cost: vendor.last_price, lead_time_days: lead };
  };
  const costOf = args.memberCost ?? fallbackCost;
  // First uncovered day and total uncovered qty per group × month (the basis of an auto pick).
  const monthNeed = new Map<string, { first: string; qty: number }>();
  for (const group of args.groups) {
    for (const [day, qty] of group.uncovered_by_day) {
      if (!inHorizon(day) || qty <= EPSILON) continue;
      const k = `${group.group_id}|${monthStart(day)}`;
      const seen = monthNeed.get(k) ?? { first: day, qty: 0 };
      monthNeed.set(k, { first: day < seen.first ? day : seen.first, qty: seen.qty + qty });
    }
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
        let pick = selectGroupMember(group.member_ids, args.selections.get(month) ?? new Set(), priceOf);
        if (pick.reason === "NONE_SELECTED") {
          const need = monthNeed.get(key)!;
          const auto = autoPickGroupMember(group.member_ids, (id) => costOf(id, need.qty, need.first));
          if (auto) pick = { material_id: auto, reason: "AUTO_SELECTED" };
        }
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
    input: {
      as_of: calendar.asOf, horizon_end: calendar.horizonEnd ?? calendar.nmEnd, opening_qty_by_material: opening, daily_demand: demand, confirmed_arrivals: arrivals, policies,
      // Method C rule 6: members' free stock (incl. MOQ excess and arrivals) covers the group first.
      groups: args.groups.map((group) => ({ group_id: group.group_id, member_ids: group.member_ids })),
    },
    chosen_vendor: chosen,
    group_assignments: assignments.map((a) => ({ ...a, uncovered_qty: Math.round(a.uncovered_qty * 1e6) / 1e6 })),
  };
}

// ── Store usage schedule helpers (owner 2026-10-19) ─────────────────────────────────────────
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (isoDay: string) => `${MONTH_NAMES[Number(isoDay.slice(5, 7)) - 1]} ${isoDay.slice(0, 4)}`;

/** Owner: show the month name when the period is a whole month; a partial CM shows its start day. */
export function storePeriodLabel(period: "CM" | "NM", calendar: PlanningCalendar): string {
  if (period === "NM") return monthName(calendar.nmStart);
  return calendar.asOf === calendar.cmStart ? monthName(calendar.cmStart) : `${monthName(calendar.cmStart)} (from ${Number(calendar.asOf.slice(8, 10))})`;
}

/**
 * Transfer instruction per material: stock sitting in a transfer-source location (e.g. R003) that
 * the schedule needs because counted stock does not back it. Qty = min(that stock, not-backed qty).
 * R→R advisory only (rToRTransferRoute); never posts anything.
 */
export function storeTransferHints(
  rows: readonly RequirementRow[],
  notBackedByMaterial: ReadonlyMap<string, number>,
  locationLabel: (id: string) => string,
  uomOf: (id: string) => string | null,
): Map<string, string> {
  const hints = new Map<string, string>();
  for (const row of rows) {
    const short = notBackedByMaterial.get(row.material_id) ?? 0;
    const available = row.stock.other_sloc_unrestricted;
    if (short <= EPSILON || available <= EPSILON) continue;
    const route = rToRTransferRoute(
      row.stock.other_locations.map(locationLabel),
      [...row.stock.required_locations, ...row.pools.map((p) => p.storage_location_id).filter((x): x is string => !!x)].map(locationLabel),
    );
    if (!route) continue; // R→R only — stock outside R stores is never a transfer instruction
    const qty = Math.round(Math.min(short, available) * 1000) / 1000;
    hints.set(row.material_id, `Transfer ${qty} ${uomOf(row.material_id) ?? ""} from ${route.from} to ${route.to}`.replace(/\s+/g, " ").trim());
  }
  return hints;
}
