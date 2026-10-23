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

Deno.test("family planner: a delivery lot is one PO, never a queued multi-lot purchase", () => {
  const input = rdpFamily();
  const policies = input.policies.map((p) => p.material_id === "EL"
    ? { ...p, vendor_options: (p.vendor_options ?? []).map((o) => ({ ...o, moq_qty_base: 24000, order_multiple_qty_base: 24000, delivery_lot_qty_base: 24000 })) }
    : p);
  const elBuys = planFamily({ ...input, policies }).advisory_buys.filter((buy) => buy.material_id === "EL");
  assert(elBuys.length > 0, "ELOTEX gets a recommendation");
  assert(elBuys.every((buy) => buy.recommended_po_qty_base === 24000 && buy.lots.length === 1 && buy.lots[0].qty_base === 24000), `ELOTEX must be one 24 MT purchase per recommendation: ${JSON.stringify(elBuys)}`);
});

Deno.test("family planner: reaching Target again after an engine lot creates the next projection", () => {
  // This mirrors the TOT White shape: the first 25-day trigger is not a one-time
  // alert.  Its 10-day order cycle restores cover to 35 days, then a new lot is
  // required each time cover returns to 25 days.
  const asOf = "2026-11-20";
  const horizonEnd = "2027-01-10";
  const days: string[] = [];
  for (let day = asOf; day <= horizonEnd; day = addDays(day, 1)) days.push(day);
  const use = 256.452;
  const totPolicy = policy("TOT", 25, 13, [{ vendor: "TOT_VENDOR", lead: 0, cost: 1 }]);
  totPolicy.cycle_days = 10;
  totPolicy.vendor_options = (totPolicy.vendor_options ?? []).map((option) => ({ ...option, cycle_days: 10 }));
  const result = planFamily({
    as_of: asOf, horizon_end: horizonEnd,
    opening_qty_by_material: { TOT: 33 * use },
    own_demand: days.map((required_by) => ({ material_id: "TOT", required_by, qty_base: use })),
    group_demand: [], confirmed_arrivals: [], policies: [totPolicy],
  });
  const lots = result.advisory_buys.filter((buy) => buy.material_id === "TOT").map((buy) => buy.estimated_plant_eta);
  assert(JSON.stringify(lots.slice(0, 2)) === JSON.stringify(["2026-11-27", "2026-12-07"]), `the second Target trigger must be a second projection, got ${JSON.stringify(lots)}`);
});

Deno.test("family planner: a standalone Target remains physical safety stock across a zero-demand gap", () => {
  // Tot White shape: December has approved PO21 use; January has none.  The
  // lack of January use must not turn a 25-day Target into zero stock or a
  // hidden epsilon lot.  This deliberately does not apply to group members.
  const asOf = "2026-12-01";
  const horizonEnd = "2027-01-31";
  const days: string[] = [];
  for (let day = asOf; day <= horizonEnd; day = addDays(day, 1)) days.push(day);
  const daily = 100;
  const totPolicy = policy("TOT", 25, 13, [{ vendor: "TOT_VENDOR", lead: 0, cost: 1 }]);
  totPolicy.cycle_days = 10;
  totPolicy.vendor_options = (totPolicy.vendor_options ?? []).map((option) => ({ ...option, cycle_days: 10 }));
  const result = planFamily({
    as_of: asOf, horizon_end: horizonEnd,
    // Day one closes at exactly 25 days, so the first refill must be 10 days.
    opening_qty_by_material: { TOT: 26 * daily },
    own_demand: days.map((required_by) => ({ material_id: "TOT", required_by, qty_base: required_by < "2027-01-01" ? daily : 0 })),
    group_demand: [], confirmed_arrivals: [], policies: [totPolicy],
  });
  const buys = result.advisory_buys.filter((buy) => buy.material_id === "TOT");
  assert(buys[0]?.estimated_plant_eta === "2026-12-01", `Target trigger must project immediately: ${JSON.stringify(buys)}`);
  assert(buys[0]?.recommended_po_qty_base === 10 * daily, `first safety refill must be 10 days, got ${JSON.stringify(buys[0])}`);
  assert(buys.every((buy) => (buy.recommended_po_qty_base ?? 0) > 0.001), `no epsilon/zero safety lot is allowed: ${JSON.stringify(buys)}`);
  const january = result.rows.find((row) => row.material_id === "TOT" && row.day === "2027-01-15");
  assert(january?.closing_qty_base === 35 * daily, `zero-demand January must retain the physical safety reserve, got ${JSON.stringify(january)}`);
  assert(january?.max_cover_days === 35 && january.min_cover_days === 35, `zero-demand January must retain 35 active-use days, not count calendar days: ${JSON.stringify(january)}`);
  assert(result.rows.filter((row) => row.material_id === "TOT").every((row) => (row.max_cover_days ?? 0) <= 35), "a zero-demand month must not inflate standalone coverage days");
});

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

Deno.test("family planner: an unchecked member is never bought for its own use or a group", () => {
  const days = daysTo("2026-10-31");
  const input: FamilyPlannerInput = {
    as_of: AS_OF, horizon_end: "2026-10-31",
    opening_qty_by_material: { WACKER: 0, CELE: 0 },
    own_demand: days.map((d) => ({ material_id: "WACKER", required_by: d, qty_base: 10 })),
    group_demand: days.map((d) => ({ group_id: "RDP", candidates: ["WACKER", "CELE"], required_by: d, qty_base: 20 })),
    confirmed_arrivals: [],
    policies: [
      policy("WACKER", 1, 0, [{ vendor: "WACKER", lead: 0, cost: 10 }]),
      policy("CELE", 1, 0, [{ vendor: "CELANESE", lead: 0, cost: 12 }]),
    ],
    selections: new Map([["2026-10-01", new Set(["CELE"])]]),
    selection_controlled_members: new Set(["WACKER", "CELE"]),
  };
  const buys = planFamily(input).advisory_buys.filter((b) => b.status === "ADVISORY" || b.status === "ADVISORY_LATE");
  assert(!buys.some((b) => b.material_id === "WACKER"), `unchecked Wacker must not be bought: ${JSON.stringify(buys)}`);
  assert(buys.some((b) => b.material_id === "CELE" && b.covers.includes("RDP")), "selected Celanese covers the RDP need");
});

Deno.test("family arrival optimizer: a piece is not pushed months away while the family needs it", () => {
  const input = { ...rdpFamily(), confirmed_arrivals: [{ source_key: "RP-PO", material_id: "RP", eta_to_plant: "2026-11-01", qty_base: 25000 }] };
  const optimum = optimizeFamilyArrival(input, "RP-PO");
  assert(optimum !== null, "optimum computed");
  assert(optimum.best.eta <= "2026-12-31", `best date ${optimum.best.eta} is too far`);
});

Deno.test("smart consumption ratio: every member with free stock serves the group, none piles up", () => {
  const result = planFamily({ ...rdpFamily(), plan_buys: false });
  const first = result.group_mix.find((g) => g.group_id === "RDP" && g.day === AS_OF);
  assert(first, "RDP mix on day one");
  const used = Object.keys(first.draws).filter((id) => first.draws[id] > 0);
  assert(used.includes("EL") && used.includes("RP"), `both ELOTEX and RP-4099 rotate: ${JSON.stringify(first.draws)}`);
});
