import { optimizeFamilyArrival, planFamily, type FamilyPlannerInput } from "./mts_family_planner.logic.ts";
import type { OptimizerMaterialPlanningPolicy } from "./mts_optimizer_phase3d.types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function addDays(day: string, n: number) { return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10); }

const AS_OF = "2026-10-22";
const END = "2027-03-31";
const daysTo = (end: string) => { const out: string[] = []; for (let d = AS_OF; d <= end; d = addDays(d, 1)) out.push(d); return out; };
const policy = (id: string, target: number, critical: number, options: Array<{ vendor: string; lead: number; cost: number | null; multiple?: number }>): OptimizerMaterialPlanningPolicy => ({
  material_id: id, target_days: target, critical_days: critical, vendor_moq_qty_base: null, order_multiple_qty_base: null, configured_lead_time_days: null,
  cycle_days: 30,
  vendor_options: options.map((o) => ({ vendor_id: o.vendor, lead_time_days: o.lead, moq_qty_base: null, order_multiple_qty_base: o.multiple ?? null, unit_cost: o.cost, cycle_days: 30 })),
});

/** RDP-like family: DA (own use + TLA + RDP), RP-4099 (fast domestic, RDP only), ELOTEX (cheap slow import), VINNAPAS (no vendor). */
function rdpFamily(): FamilyPlannerInput {
  const days = daysTo(END);
  return {
    as_of: AS_OF, horizon_end: END,
    opening_qty_by_material: { DA: 40000, RP: 20000, EL: 20000, VN: 30000 },
    own_demand: days.map((d) => ({ material_id: "DA", required_by: d, qty_base: 500 })),
    group_demand: [
      ...days.map((d) => ({ group_id: "RDP_TLA", candidates: ["DA", "VN"], required_by: d, qty_base: 1500 })),
      ...days.map((d) => ({ group_id: "RDP", candidates: ["DA", "EL", "RP", "VN"], required_by: d, qty_base: 1000 })),
    ],
    confirmed_arrivals: [],
    policies: [
      policy("DA", 30, 20, [{ vendor: "DAIREN", lead: 13, cost: 100, multiple: 20000 }]),
      policy("RP", 20, 10, [{ vendor: "CHEMEXIM", lead: 5, cost: 118 }]),
      policy("EL", 30, 20, [{ vendor: "CELANESE", lead: 35, cost: 90 }]),
      { material_id: "VN", target_days: 30, critical_days: 20, vendor_moq_qty_base: null, order_multiple_qty_base: null, configured_lead_time_days: null },
    ],
  };
}

Deno.test("family planner: no stock-out and no member below Critical once lots can arrive", () => {
  const result = planFamily(rdpFamily());
  const shortDays = result.rows.filter((r) => r.closing_qty_base < -1e-6);
  assert(shortDays.length === 0, `stock-out on ${shortDays.slice(0, 3).map((r) => `${r.material_id} ${r.day}`).join(", ")}`);
  assert(result.group_unmet.length === 0, `group unmet on ${result.group_unmet.slice(0, 3).map((u) => `${u.group_id} ${u.day}`).join(", ")}`);
});

Deno.test("family planner: RDP's early need is bridged by the fast domestic member, later ones by the cheapest that arrives in time", () => {
  const buys = planFamily(rdpFamily()).advisory_buys.filter((b) => b.status === "ADVISORY" || b.status === "ADVISORY_LATE");
  const rdp = buys.filter((b) => b.covers.includes("RDP")).sort((a, b) => String(a.estimated_plant_eta).localeCompare(String(b.estimated_plant_eta)));
  assert(rdp.length > 0, "RDP gets lots");
  const earlyLimit = addDays(AS_OF, 35);
  const early = rdp.filter((b) => String(b.estimated_plant_eta) < earlyLimit);
  assert(early.every((b) => b.material_id === "RP"), `before ELOTEX can arrive only RP-4099 is bought for RDP: ${early.map((b) => b.material_id).join(",")}`);
  // ELOTEX cannot meet its own 30-day Target in time at first, so RP-4099 (20 days, 5-day lead)
  // bridges once; every later RDP lot is the cheaper ELOTEX.
  assert(rdp[0].material_id === "RP", `first RDP lot is the fast RP-4099: ${rdp[0].material_id}`);
  assert(rdp.slice(1).every((b) => b.material_id === "EL"), `then the cheaper ELOTEX: ${rdp.map((b) => b.material_id).join(",")}`);
});

Deno.test("family planner: DA is bought for its own use and for TLA (VINNAPAS has no vendor); never two orders one day apart", () => {
  const buys = planFamily(rdpFamily()).advisory_buys.filter((b) => b.material_id === "DA" && (b.status === "ADVISORY" || b.status === "ADVISORY_LATE"));
  assert(buys.some((b) => b.covers.includes("RDP_TLA")), "TLA is covered through DA");
  const etas = buys.flatMap((b) => b.lots.map((l) => l.plant_eta)).sort();
  for (let i = 1; i < etas.length; i += 1) {
    const gap = (Date.parse(etas[i]) - Date.parse(etas[i - 1])) / 86_400_000;
    assert(gap >= 7, `DA lots ${etas[i - 1]} and ${etas[i]} only ${gap} day(s) apart`);
  }
  assert(buys.every((b) => (b.recommended_po_qty_base ?? 0) % 20000 === 0), "container multiple respected");
});

Deno.test("family arrival optimizer: a piece is not pushed months away while the family needs it", () => {
  const input = { ...rdpFamily(), confirmed_arrivals: [{ source_key: "RP-PO", material_id: "RP", eta_to_plant: "2026-11-01", qty_base: 25000 }] };
  const optimum = optimizeFamilyArrival(input, "RP-PO");
  assert(optimum !== null, "optimum computed");
  assert(optimum.best_eta <= "2026-12-31", `best date ${optimum.best_eta} is too far`);
});
