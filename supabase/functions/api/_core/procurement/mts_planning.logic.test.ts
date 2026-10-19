import { assemblePlanningInput, chooseVendor, selectGroupMember, type VendorTerm } from "./mts_planning.logic.ts";
import { buildCalendar, type GroupRequirementRow, type RequirementRow } from "./mts_requirement.logic.ts";
import { projectDailyCoverage } from "./mts_optimizer_phase3d.logic.ts";

function equal(actual: unknown, expected: unknown, message: string) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
const term = (over: Partial<VendorTerm>): VendorTerm => ({ vendor_id: "V", vendor_label: "V", material_id: "M", moq_base: null, multiple_base: null, lot_base: null, booking_days: null, route_days: 10, last_price: null, currency: "INR", ...over });

Deno.test("vendor choice: known route, shortest booking + route", () => {
  equal(chooseVendor([term({ vendor_label: "IMP", route_days: 40 }), term({ vendor_label: "LOC", route_days: 5, booking_days: 10 }), term({ vendor_label: "NOROUTE", route_days: null })])?.vendor_label, "LOC", "15 days beats 40");
  equal(chooseVendor([]), null, "none");
});

Deno.test("D3 member selection: single, cheapest of several, none", () => {
  const price = (id: string) => ({ A: 150, B: 120 } as Record<string, number>)[id] ?? null;
  equal(selectGroupMember(["A", "B"], new Set(["A"]), price), { material_id: "A", reason: "SINGLE_SELECTED" }, "single");
  equal(selectGroupMember(["A", "B"], new Set(["A", "B"]), price), { material_id: "B", reason: "CHEAPEST_SELECTED" }, "cheapest");
  equal(selectGroupMember(["A", "B"], new Set(), price), { material_id: null, reason: "NONE_SELECTED" }, "none");
});

function row(id: string, stock: number, daily: Array<[string, number]>, target = 5): RequirementRow {
  return {
    material_id: id, kind: "RM",
    metrics: {} as RequirementRow["metrics"],
    stock: { usable_at_required: stock, unrestricted_at_required: stock, reserved_at_required: 0, other_sloc_unrestricted: 0, excluded_unrestricted: 0, quality_inspection: 0, blocked: 0, other_stock_types: 0, required_locations: [], other_locations: [] },
    inbound: { overdue: 0, cm: 0, nm: 0, later: 0, unknown: 0, total: 0, dispatched: 0, open_po: 0 },
    inbound_events: [], pools: [], lead_time: null,
    policy: { material_id: id, effective_from: "2026-01-01", target_cov_days: target, critical_cov_days: 2, moq_qty: null, moq_uom_code: null, moq_source: "NONE", moq_active: false, version_no: 1 },
    from_stock_qty: 0, fixed_demand_qty: 0, group_share_qty: 0, daily_demand: new Map(daily),
  };
}

Deno.test("group shortage is planned through the selected member; unselected stays a group risk", () => {
  const calendar = buildCalendar("2026-11-01", "2026-11-25")!;
  const group = (id: string): GroupRequirementRow => ({
    group_id: id, kind: "RM", member_ids: ["A", "B"], cm_demand: 0, nm_demand: 0, covered_from_stock: 0, uncovered_cm: 0, uncovered_nm: 0,
    first_uncovered_day: null, cover_days: null, members_inbound_total: 0, members: [], any_member_below_target: false, any_member_below_critical: false,
    uncovered_by_day: new Map([["2026-11-28", 30], ["2026-12-05", 40]]),
  });
  const assembly = assemblePlanningInput({
    calendar, rows: [row("A", 0, []), row("B", 0, [])], groups: [group("G1")], policies: [],
    vendorTerms: new Map([["B", [term({ material_id: "B", moq_base: 25, route_days: 3 })]]]),
    selections: new Map([["2026-11-01", new Set(["B"])]]), policyMoqBase: new Map(),
  });
  equal(assembly.group_assignments.map((a) => [a.month, a.assigned_material_id, a.reason, a.uncovered_qty]), [["2026-11-01", "B", "SINGLE_SELECTED", 30], ["2026-12-01", null, "NONE_SELECTED", 40]], "per month");
  const result = projectDailyCoverage(assembly.input);
  equal(result.group_pool_risks.map((g) => [g.group_id, g.unresolved_qty_base]), [["G1", 40]], "December shortage stays on the group");
  equal(result.advisory_buys.find((b) => b.material_id === "B" && b.status !== "NO_BUY")?.recommended_po_qty_base, 30, "November shortage (30 ≥ MOQ 25) bought as B");
});
