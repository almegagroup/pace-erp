import { memberMattersForGaps, priceUnitCode, assemblePlanningInput, chooseVendor, familyArrivalEta, familyArrivalRisk, isFamilyAllocatableArrival, selectGroupMember, storeGroupPeriodShares, storePeriodLabel, storeTransferHints, type VendorTerm } from "./mts_planning.logic.ts";
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

Deno.test("family input: a dated receipt joins on its ETA; a passed or missing ETA is counted today and flagged", () => {
  const asOf = "2026-10-24";
  equal(familyArrivalEta("2026-11-15", asOf), "2026-11-15", "an ordered PO with delivery date joins on that date");
  equal(familyArrivalEta(asOf, asOf), asOf, "a posted GR on the CC date remains an actual arrival");
  equal(isFamilyAllocatableArrival("IN_TRANSIT", "2026-10-25", asOf), true, "a future ETA needs no flag");
  // Owner 2026-10-26 (CMP005 Silres / Excelcon A 850): a TRN CSN whose ETA passed is still coming.
  equal(familyArrivalEta("2026-10-19", asOf), asOf, "passed ETA is counted today, not dropped");
  equal(familyArrivalEta(null, asOf), asOf, "missing ETA is counted today, not dropped");
  equal(isFamilyAllocatableArrival("IN_TRANSIT", "2026-10-19", asOf), false, "a passed ETA is flagged");
  const flag = familyArrivalRisk({ source_key: "CSN-1", material_id: "M", eta_to_plant: "2026-10-19", qty_base: 25, lifecycle_kind: "IN_TRANSIT" }, asOf);
  equal(flag.assumed_eta, asOf, "the flag says which day it was counted on");
  equal(flag.reason, "ETA_PASSED", "passed ETA reason");
});

function row(id: string, stock: number, daily: Array<[string, number]>, target = 5): RequirementRow {
  return {
    material_id: id, kind: "RM",
    metrics: {} as RequirementRow["metrics"],
    stock: { usable_at_required: stock, unrestricted_at_required: stock, reserved_at_required: 0, other_sloc_unrestricted: 0, excluded_unrestricted: 0, quality_inspection: 0, blocked: 0, other_stock_types: 0, required_locations: [], other_locations: [], committed_transfer_out: 0, exclusive_protected: 0, protection_used: 0 },
    inbound: { overdue: 0, cm: 0, nm: 0, later: 0, unknown: 0, total: 0, dispatched: 0, open_po: 0 },
    inbound_events: [], pools: [], lead_time: null,
    policy: { material_id: id, effective_from: "2026-01-01", target_cov_days: target, critical_cov_days: 2, moq_qty: null, moq_uom_code: null, moq_source: "NONE", moq_active: false, version_no: 1 },
    from_stock_qty: 0, fixed_demand_qty: 0, group_share_qty: 0, daily_demand: new Map(daily),
  };
}

Deno.test("group shortage is planned through the selected member; nothing selected stays a group risk", () => {
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
  equal(assembly.group_assignments.map((a) => [a.month, a.assigned_material_id, a.reason, a.uncovered_qty]), [["2026-11-01", "B", "SINGLE_SELECTED", 30], ["2026-12-01", null, "NONE_SELECTED", 40]], "an unchecked month must not silently select B");
  const result = projectDailyCoverage(assembly.input);
  equal(result.group_pool_risks.map((g) => [g.group_id, g.unresolved_qty_base]), [["G1", 40]], "December stays visible until a member is selected");
  equal(result.advisory_buys.find((b) => b.material_id === "B" && b.status !== "NO_BUY")?.recommended_po_qty_base, 30, "November shortage (30 ≥ MOQ 25) bought as B");
});

Deno.test("store schedule: month name for a whole month, start day for a partial CM", () => {
  equal(storePeriodLabel("NM", buildCalendar("2026-10-01", "2026-10-20")!), "November 2026", "NM is always a whole month");
  equal(storePeriodLabel("CM", buildCalendar("2026-10-01", "2026-10-01")!), "October 2026", "CM from day 1");
  equal(storePeriodLabel("CM", buildCalendar("2026-10-01", "2026-10-20")!), "October 2026 (from 20)", "partial CM");
});

Deno.test("store schedule: group material ratio is the Family event-day draw ratio, not a second rule", () => {
  const result = storeGroupPeriodShares({
    group_id: "BETON", from: "2026-10-24", to: "2026-10-31",
    group_mix: [
      { group_id: "BETON", day: "2026-10-24", draws: { BETONE: 20, SAPCOMER: 5 } },
      { group_id: "BETON", day: "2026-10-25", draws: { BETONE: 10 } },
      { group_id: "OTHER", day: "2026-10-24", draws: { BENTONE: 99 } },
    ],
    group_unmet: [{ group_id: "BETON", day: "2026-10-26", qty_base: 15 }],
  });
  if (!result) throw new Error("expected a period share");
  equal([...result.shares.entries()].sort(), [["BETONE", 0.6], ["SAPCOMER", 0.1]], "only canonical BETON event-day draws contribute");
  equal(result.unmet_share, 0.3, "unmet share remains explicit rather than being assigned to a material");
});

Deno.test("store schedule: transfer hint only for what counted stock cannot back", () => {
  const r = { ...row("A", 0, []), stock: { ...row("A", 0, []).stock, other_sloc_unrestricted: 500, other_locations: ["L3"], required_locations: ["L1"] } };
  const hints = storeTransferHints([r], new Map([["A", 120]]), (id) => ({ L1: "R001", L3: "R003" } as Record<string, string>)[id] ?? id, () => "KG");
  equal(hints.get("A"), "Transfer 120 KG from R003 to R001", "only the 120 short");
  equal(storeTransferHints([r], new Map(), () => "x", () => "KG").size, 0, "nothing short → no transfer");
  const toShopFloor = { ...r, stock: { ...r.stock, required_locations: ["L1", "S1"] } };
  const labels = (id: string) => ({ L1: "R001", L3: "R003", S1: "S001", F1: "F001" } as Record<string, string>)[id] ?? id;
  equal(storeTransferHints([toShopFloor], new Map([["A", 120]]), labels, () => "KG").get("A"), "Transfer 120 KG from R003 to R001", "never R→S");
  const onlyShopFloor = { ...r, stock: { ...r.stock, required_locations: ["S1"] } };
  equal(storeTransferHints([onlyShopFloor], new Map([["A", 120]]), labels, () => "KG").get("A"), "Transfer 120 KG from R003 to R001", "shop floor S001 is fed from R001 (owner 2026-10-27)");
  const noLocation = { ...r, stock: { ...r.stock, required_locations: ["F1"] } };
  equal(storeTransferHints([noLocation], new Map([["A", 120]]), labels, () => "KG").get("A"), "Transfer 120 KG from R003 to an R store (destination UNKNOWN)", "no R / S destination → UNKNOWN, not fabricated");
  const fromFg = { ...r, stock: { ...r.stock, other_locations: ["F1"] } };
  equal(storeTransferHints([fromFg], new Map([["A", 120]]), labels, () => "KG").size, 0, "F/S stock is never an R→R transfer");
});

Deno.test("price unit: Supply UoM first, then the latest PO unit only for a GRN-written price, else base", () => {
  equal(priceUnitCode({ supply_uom_code: "MT", last_grn_date: null, latest_po_uom: "BAG", base_uom_code: "KG" }), "MT", "price unit");
  equal(priceUnitCode({ supply_uom_code: null, last_grn_date: "2026-10-26", latest_po_uom: "MT", base_uom_code: "KG" }), "MT", "price unit");
  equal(priceUnitCode({ supply_uom_code: null, last_grn_date: null, latest_po_uom: "MT", base_uom_code: "KG" }), "KG", "price unit");
  equal(priceUnitCode({ supply_uom_code: "", last_grn_date: "2026-10-26", latest_po_uom: null, base_uom_code: "KG" }), "KG", "price unit");
});

Deno.test("transfer hint counts the CSN quantity that lands in the transfer-source store", () => {
  const row = { material_id: "G", stock: { other_sloc_unrestricted: 2937, other_locations: ["R003"], required_locations: ["S001"] }, pools: [] } as unknown as RequirementRow;
  const hints = storeTransferHints([row], new Map([["G", 10000]]), (id) => id, () => "KG", new Map([["G", { qty: 42000, label: "ETA 2026-10-11, 2026-08-21" }]]));
  equal(hints.get("G")?.startsWith("Transfer 10000 KG from R003 to R001 (R003 on hand 2937 KG + arriving 42000 KG"), true, "hint text");
});

Deno.test("gap filter: a member with no stock, no demand and no purchase tick is not a planning gap", () => {
  equal(memberMattersForGaps({ opening_qty: 0, horizon_demand_qty: 0, selected_any_month: false }), false, "SAPCOMER D");
  equal(memberMattersForGaps({ opening_qty: 12, horizon_demand_qty: 0, selected_any_month: false }), true, "holds stock");
  equal(memberMattersForGaps({ opening_qty: 0, horizon_demand_qty: 5, selected_any_month: false }), true, "has demand");
  equal(memberMattersForGaps({ opening_qty: 0, horizon_demand_qty: 0, selected_any_month: true }), true, "ticked for a buy");
});
