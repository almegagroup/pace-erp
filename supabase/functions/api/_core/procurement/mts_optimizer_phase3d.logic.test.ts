import { applyOrderConstraints, projectDailyCoverage } from "./mts_optimizer_phase3d.logic.ts";
import type { OptimizerProjectionInput } from "./mts_optimizer_phase3d.types.ts";

function equal(actual: unknown, expected: unknown, message: string) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
const policy = (id = "M1") => ({ material_id: id, target_days: 4, critical_days: 2, vendor_moq_qty_base: 20, order_multiple_qty_base: 25, configured_lead_time_days: 3 });
function input(overrides: Partial<OptimizerProjectionInput> = {}): OptimizerProjectionInput { return { as_of: "2026-10-19", horizon_end: "2026-10-24", opening_qty_by_material: { M1: 10 }, daily_demand: [{ source_key: "d1", material_id: "M1", required_by: "2026-10-19", qty_base: 5 }, { source_key: "d2", material_id: "M1", required_by: "2026-10-20", qty_base: 6 }], confirmed_arrivals: [], policies: [policy()], ...overrides }; }

Deno.test("MOQ and order multiple are distinct: 28 at a 25 multiple recommends 50", () => {
  equal(applyOrderConstraints(28, policy()), 50, "round to enforceable multiple after MOQ");
  equal(applyOrderConstraints(1, policy()), 25, "MOQ 20 is then rounded to 25 multiple");
});

Deno.test("confirmed ETA is projected on its plant date but is never executable Store stock", () => {
  const result = projectDailyCoverage(input({ confirmed_arrivals: [{ source_key: "csn", material_id: "M1", eta_to_plant: "2026-10-20", qty_base: 12, lifecycle_kind: "IN_TRANSIT" }] }));
  const day = result.rows.find((row) => row.material_id === "M1" && row.day === "2026-10-20")!;
  equal([day.opening_qty_base, day.confirmed_arrival_qty_base, day.closing_qty_base, day.executable_arrival], [5, 12, 11, false], "arrival affects projection only on ETA");
});

Deno.test("unknown ETA and material-null group demand cannot manufacture material supply", () => {
  const result = projectDailyCoverage(input({
    daily_demand: [{ source_key: "pool", material_id: null, required_by: "2026-10-19", qty_base: 9 }],
    confirmed_arrivals: [{ source_key: "unknown", material_id: "M1", eta_to_plant: null, qty_base: 100, lifecycle_kind: "IN_TRANSIT" }],
  }));
  equal(result.rows.find((row) => row.day === "2026-10-19")!.closing_qty_base, 10, "unassigned group demand and unknown ETA are not assigned to M1");
  equal(result.risks[0].unresolved_group_pool_qty_base, 9, "pool shortage remains explicit");
});

Deno.test("lead time determines advisory PO-by date without adding processing twice", () => {
  const result = projectDailyCoverage(input());
  const buy = result.advisory_buys[0];
  equal([buy.status, buy.estimated_plant_eta, buy.recommended_po_by, buy.recommended_po_qty_base], ["ADVISORY", "2026-10-20", "2026-10-17", 25], "configured lead time is used once");
});

Deno.test("arrival target is the first Critical/Target coverage breach, not first negative stock", () => {
  const result = projectDailyCoverage(input({
    opening_qty_by_material: { M1: 10 },
    horizon_end: "2026-10-23",
    daily_demand: [
      { source_key: "d1", material_id: "M1", required_by: "2026-10-19", qty_base: 3 },
      { source_key: "d2", material_id: "M1", required_by: "2026-10-20", qty_base: 3 },
      { source_key: "d3", material_id: "M1", required_by: "2026-10-21", qty_base: 3 },
      { source_key: "d4", material_id: "M1", required_by: "2026-10-22", qty_base: 3 },
    ],
    policies: [{ ...policy(), target_days: 2, critical_days: 1, configured_lead_time_days: 2 }],
  }));
  const risk = result.risks[0];
  const buy = result.advisory_buys[0];
  equal([risk.first_below_target_day, risk.first_below_critical_day, risk.first_shortage_day], ["2026-10-20", "2026-10-21", "2026-10-22"], "policy risks are distinct");
  equal([buy.estimated_plant_eta, buy.recommended_po_by], ["2026-10-21", "2026-10-19"], "critical coverage breach drives the arrival target");
});

Deno.test("missing Target/Critical policy stays UNKNOWN even when current stock is positive", () => {
  const result = projectDailyCoverage(input({ policies: [] }));
  equal(result.advisory_buys[0].status, "UNKNOWN_POLICY", "policy absence cannot silently become a no-buy decision");
});
