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

Deno.test("family planner: known higher NM demand controls CM forward cover and MOQ projection", () => {
  // Production CMP005 Calcium Formate shape on 23-Oct: 58.88 opening, a
  // same-day 600 KG GR, 35.22 KG left in CM, then 466.30 KG in November.
  const asOf = "2026-10-23";
  const horizonEnd = "2026-11-30";
  const dates: string[] = [];
  for (let day = asOf; day <= horizonEnd; day = addDays(day, 1)) dates.push(day);
  const result = planFamily({
    as_of: asOf, horizon_end: horizonEnd,
    opening_qty_by_material: { CALCIUM: 58.88 },
    own_demand: dates.map((required_by) => ({ material_id: "CALCIUM", required_by, qty_base: required_by < "2026-11-01" ? 35.22 / 9 : 466.3 / 30 })),
    group_demand: [],
    confirmed_arrivals: [{ source_key: "GRN 2000000697", material_id: "CALCIUM", eta_to_plant: asOf, qty_base: 600 }],
    policies: [{ material_id: "CALCIUM", target_days: 30, critical_days: 15, vendor_moq_qty_base: 500, order_multiple_qty_base: null, delivery_lot_qty_base: null, configured_lead_time_days: 7, cycle_days: 30 }],
  });
  const first = result.rows.find((row) => row.material_id === "CALCIUM" && row.day === asOf);
  assert(first?.max_cover_days === 48 && first.min_cover_days === 9, `23-Oct must be 48/9 days, got ${JSON.stringify(first)}`);
  const buy = result.advisory_buys.find((row) => row.material_id === "CALCIUM");
  assert(buy?.need_date === "2026-11-10" && buy.recommended_po_qty_base === 500 && buy.recommended_po_by === "2026-11-03", `Target/lead/MOQ projection incorrect: ${JSON.stringify(buy)}`);
});

Deno.test("family planner: no stock-out and no member below Critical once lots can arrive", () => {
  const result = planFamily(rdpFamily());
  const shortDays = result.rows.filter((r) => r.closing_qty_base < -1e-6);
  assert(shortDays.length === 0, `stock-out on ${shortDays.slice(0, 3).map((r) => `${r.material_id} ${r.day}`).join(", ")}`);
  assert(result.group_unmet.length === 0, `group unmet on ${result.group_unmet.slice(0, 3).map((u) => `${u.group_id} ${u.day}`).join(", ")}`);
});

Deno.test("W3: every family member conserves opening, arrivals, lots, allocations, expiry and carry", () => {
  const result = planFamily({ ...rdpFamily(), confirmed_arrivals: [{ source_key: "DA-ETA", material_id: "DA", eta_to_plant: "2026-10-25", qty_base: 2500 }] });
  assert(result.allocation_reconciliation.length === 4, "each family member must have a reconciliation row");
  assert(result.allocation_reconciliation.every((row) => row.variance_qty_base === 0), `source-to-destination reconciliation failed: ${JSON.stringify(result.allocation_reconciliation)}`);
  const da = result.allocation_reconciliation.find((row) => row.material_id === "DA");
  assert((da?.confirmed_arrival_qty_base ?? 0) === 2500 && (da?.group_allocated_qty_base ?? 0) > 0, "dated inbound must join the same conserved waterfall as group allocations");
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

Deno.test("family planner: a missing ETA is visible as risk but never credited as CC-date stock", () => {
  const result = planFamily({
    as_of: "2026-10-24", horizon_end: "2026-10-25", opening_qty_by_material: { M: 0 },
    own_demand: [{ material_id: "M", required_by: "2026-10-24", qty_base: 10 }], group_demand: [],
    confirmed_arrivals: [{ source_key: "PO-without-ETA", material_id: "M", eta_to_plant: null, qty_base: 100 }],
    policies: [{ material_id: "M", target_days: 5, critical_days: 2, vendor_moq_qty_base: null, order_multiple_qty_base: null, delivery_lot_qty_base: null, configured_lead_time_days: null }],
    plan_buys: false,
  });
  assert(result.rows.find((row) => row.material_id === "M" && row.day === "2026-10-24")?.confirmed_arrival_qty_base === 0, "no ETA must not inflate CC-date balance");
  assert(JSON.stringify(result.arrival_flags.map((flag) => [flag.source_key, flag.assumed_eta])) === JSON.stringify([["PO-without-ETA", null]]), "ETA risk remains explainable");
});

Deno.test("W2: a confirmed ETA after the horizon stays visible but cannot create current cover", () => {
  const result = planFamily({
    as_of: "2026-10-24", horizon_end: "2026-10-25", opening_qty_by_material: { M: 0 },
    own_demand: [{ material_id: "M", required_by: "2026-10-24", qty_base: 10 }], group_demand: [],
    confirmed_arrivals: [{ source_key: "PO-after-horizon", material_id: "M", eta_to_plant: "2026-11-01", qty_base: 100 }],
    policies: [{ material_id: "M", target_days: 5, critical_days: 2, vendor_moq_qty_base: null, order_multiple_qty_base: null, delivery_lot_qty_base: null, configured_lead_time_days: null }],
    plan_buys: false,
  });
  assert(result.rows.every((row) => row.confirmed_arrival_qty_base === 0), "after-horizon receipt must not inflate this run's balance");
  assert(JSON.stringify(result.arrival_flags.map((flag) => [flag.source_key, flag.reason, flag.eta_to_plant])) === JSON.stringify([["PO-after-horizon", "ETA_AFTER_HORIZON", "2026-11-01"]]), "after-horizon confirmed receipt must remain visible evidence");
});

Deno.test("smart consumption ratio: every member with free stock serves the group, none piles up", () => {
  const result = planFamily({ ...rdpFamily(), plan_buys: false });
  const first = result.group_mix.find((g) => g.group_id === "RDP" && g.day === AS_OF);
  assert(first, "RDP mix on day one");
  const used = Object.keys(first.draws).filter((id) => first.draws[id] > 0);
  assert(used.includes("EL") && used.includes("RP"), `both ELOTEX and RP-4099 rotate: ${JSON.stringify(first.draws)}`);
});

Deno.test("family waterfall: exclusive Desired-Max reserve is never double-allocated to a shared group", () => {
  const result = planFamily({
    as_of: "2026-10-01", horizon_end: "2026-11-30", opening_qty_by_material: { EXCLUSIVE: 50, ALT: 100 },
    own_demand: Array.from({ length: 61 }, (_, i) => ({ material_id: "EXCLUSIVE", required_by: addDays("2026-10-01", i), qty_base: 1 })),
    group_demand: [{ group_id: "G", candidates: ["EXCLUSIVE", "ALT"], required_by: "2026-10-01", qty_base: 10 }],
    confirmed_arrivals: [],
    policies: [
      { material_id: "EXCLUSIVE", target_days: 20, critical_days: 10, cycle_days: 30, vendor_moq_qty_base: null, order_multiple_qty_base: null, delivery_lot_qty_base: null, configured_lead_time_days: null },
      { material_id: "ALT", target_days: 30, critical_days: 15, cycle_days: 30, vendor_moq_qty_base: null, order_multiple_qty_base: null, delivery_lot_qty_base: null, configured_lead_time_days: null },
    ], plan_buys: false,
  });
  const mix = result.group_mix.find((row) => row.group_id === "G" && row.day === "2026-10-01");
  assert(mix?.draws.EXCLUSIVE === undefined, `exclusive reserve was incorrectly used by group: ${JSON.stringify(mix)}`);
  assert(mix?.draws.ALT === 10, `eligible alternate should serve group: ${JSON.stringify(mix)}`);
  const allocation = result.allocation_rows.filter((row) => row.day === "2026-10-01");
  assert(allocation.some((row) => row.material_id === "ALT" && row.destination_kind === "GROUP" && row.group_id === "G" && row.qty_base === 10 && row.rule === "GROUP_WATERFALL"), `server allocation evidence must contain the actual group draw: ${JSON.stringify(allocation)}`);
  assert(!allocation.some((row) => row.material_id === "EXCLUSIVE" && row.destination_kind === "GROUP"), `server allocation evidence must not pretend reserved exclusive stock served a group: ${JSON.stringify(allocation)}`);
});

Deno.test("family waterfall: group buy sizes to derived Desired Max but individual RP guard still triggers at 20", () => {
  const base = {
    as_of: "2026-10-01", horizon_end: "2026-11-15", opening_qty_by_material: { RP: 21, ALT: 1_000 },
    own_demand: Array.from({ length: 46 }, (_, i) => ({ material_id: "RP", required_by: addDays("2026-10-01", i), qty_base: 1 })),
    group_demand: Array.from({ length: 46 }, (_, i) => ({ group_id: "RDP", candidates: ["RP", "ALT"], required_by: addDays("2026-10-01", i), qty_base: 1 })),
    confirmed_arrivals: [], selections: new Map([["2026-10-01", new Set(["RP"])], ["2026-11-01", new Set(["RP"])]]), selection_controlled_members: new Set(["RP", "ALT"]),
    policies: [
      policy("RP", 20, 10, [{ vendor: "LOCAL", lead: 0, cost: 100 }]),
      policy("ALT", 30, 15, [{ vendor: "ALT", lead: 0, cost: 100 }]),
    ],
  } satisfies FamilyPlannerInput;
  const result = planFamily(base);
  const ownRp = result.advisory_buys.find((buy) => buy.material_id === "RP" && buy.need_kind === "OWN" && buy.status !== "NO_BUY");
  assert(ownRp?.need_date === "2026-10-01", `RP should connect at its individual 20-day guard: ${JSON.stringify(ownRp)}`);
  const group = planFamily({ ...base, opening_qty_by_material: { RP: 0, ALT: 0 }, own_demand: [], group_demand: [{ group_id: "RDP", candidates: ["RP", "ALT"], required_by: "2026-10-01", qty_base: 10 }] })
    .advisory_buys.find((buy) => buy.need_kind === "GROUP" && buy.status !== "NO_BUY");
  assert(group?.max_cover_days === 60, `group Desired Max should be rounded-up member max 60: ${JSON.stringify(group)}`);
});

Deno.test("family waterfall: a group-only RP member still projects at its individual 20-day guard", () => {
  const days = Array.from({ length: 46 }, (_, i) => addDays("2026-10-01", i));
  const result = planFamily({
    as_of: "2026-10-01", horizon_end: "2026-11-15",
    // The fixed group order makes RP's actual eligible-group consumption
    // visible. It has no exclusive/own BOM demand at all.
    opening_qty_by_material: { RP: 210, ALT: 5_000 }, own_demand: [],
    group_demand: days.map((required_by) => ({ group_id: "RDP", candidates: ["RP", "ALT"], required_by, qty_base: 10 })),
    group_coverage_policies: [{ group_id: "RDP", effective_from: "2026-10-01", target_days: 30, critical_days: 15, desired_max_days_override: null }],
    confirmed_arrivals: [],
    policies: [
      policy("RP", 20, 10, [{ vendor: "LOCAL", lead: 0, cost: 100 }]),
      policy("ALT", 30, 15, [{ vendor: "ALT", lead: 0, cost: 100 }]),
    ],
    group_orders: new Map([["RDP", { mode: "FIXED_ORDER", member_order: ["RP", "ALT"] }]]),
    selections: new Map([["2026-10-01", new Set(["RP"])], ["2026-11-01", new Set(["RP"])]]),
    selection_controlled_members: new Set(["RP", "ALT"]),
  });
  const rp = result.advisory_buys.find((buy) => buy.material_id === "RP" && buy.need_kind === "OWN" && buy.status !== "NO_BUY");
  assert(rp?.need_date === "2026-10-01", `RP must connect at its own 20-day guard, not wait for group Target 30: ${JSON.stringify(rp)}`);
  assert(rp?.reason.includes("Member guard"), `the reason must identify the group-only individual guard: ${JSON.stringify(rp)}`);
});

Deno.test("family waterfall: an individual Desired-Max override changes family member lot sizing", () => {
  const days = Array.from({ length: 50 }, (_, i) => addDays("2026-10-01", i));
  const base = {
    as_of: "2026-10-01", horizon_end: "2026-11-19", opening_qty_by_material: { M: 21 },
    own_demand: days.map((required_by) => ({ material_id: "M", required_by, qty_base: 1 })), group_demand: [], confirmed_arrivals: [],
    policies: [{ ...policy("M", 20, 10, [{ vendor: "V", lead: 0, cost: 1 }]), desired_max_days_override: 25 }],
  } satisfies FamilyPlannerInput;
  const buy = planFamily(base).advisory_buys.find((row) => row.material_id === "M" && row.status !== "NO_BUY");
  assert(buy?.max_cover_days === 25 && buy.recommended_po_qty_base === 5, `family lot must refill to saved Desired Max 25, got ${JSON.stringify(buy)}`);
});

Deno.test("family consumption: an eligible unselected member runs down before a replenishable alternative", () => {
  const result = planFamily({
    as_of: "2026-10-01", horizon_end: "2026-10-02", opening_qty_by_material: { RUN_DOWN: 100, BUYABLE: 100 },
    own_demand: [], group_demand: [{ group_id: "G", candidates: ["RUN_DOWN", "BUYABLE"], required_by: "2026-10-01", qty_base: 10 }], confirmed_arrivals: [],
    policies: [
      { material_id: "RUN_DOWN", target_days: 0, critical_days: 0, vendor_moq_qty_base: null, order_multiple_qty_base: null, delivery_lot_qty_base: null, configured_lead_time_days: null },
      { material_id: "BUYABLE", target_days: 0, critical_days: 0, vendor_moq_qty_base: null, order_multiple_qty_base: null, delivery_lot_qty_base: null, configured_lead_time_days: null },
    ],
    selections: new Map([["2026-10-01", new Set(["BUYABLE"])]]), selection_controlled_members: new Set(["RUN_DOWN", "BUYABLE"]), plan_buys: false,
  });
  const mix = result.group_mix.find((row) => row.group_id === "G" && row.day === "2026-10-01");
  assert(mix?.draws.RUN_DOWN === 10 && mix.draws.BUYABLE === undefined, `unselected stock should run down first: ${JSON.stringify(mix)}`);
});

Deno.test("short-life receipt overrides saved group order only until Store should consume it", () => {
  const result = planFamily({
    as_of: "2026-10-01", horizon_end: "2026-10-02",
    opening_qty_by_material: { FIRST: 100, EXPIRING: 100 },
    opening_receipts: [
      { material_id: "FIRST", qty_base: 100, valid_until: "2027-01-29", reference: "Opening stock OS-1", expiry_priority: false },
      { material_id: "EXPIRING", qty_base: 100, valid_until: "2026-10-03", reference: "GRN 101", expiry_priority: true },
    ],
    own_demand: [],
    group_demand: [{ group_id: "G", candidates: ["FIRST", "EXPIRING"], required_by: "2026-10-01", qty_base: 25 }],
    confirmed_arrivals: [],
    policies: [
      { material_id: "FIRST", target_days: 0, critical_days: 0, vendor_moq_qty_base: null, order_multiple_qty_base: null, configured_lead_time_days: null },
      { material_id: "EXPIRING", target_days: 0, critical_days: 0, vendor_moq_qty_base: null, order_multiple_qty_base: null, configured_lead_time_days: null },
    ],
    group_orders: new Map([["G", { mode: "FIXED_ORDER", member_order: ["FIRST", "EXPIRING"] }]]),
    plan_buys: false,
  });
  const first = result.group_mix.find((row) => row.group_id === "G" && row.day === "2026-10-01");
  assert(first?.draws.EXPIRING === 25 && !first.draws.FIRST, `expiring GRN must win locally: ${JSON.stringify(first)}`);
});

Deno.test("expired virtual receipt is not counted as cover", () => {
  const result = planFamily({
    as_of: "2026-10-01", horizon_end: "2026-10-01",
    opening_qty_by_material: { M: 20 },
    opening_receipts: [{ material_id: "M", qty_base: 20, valid_until: "2026-09-30", reference: "GRN expired", expiry_priority: true }],
    own_demand: [], group_demand: [], confirmed_arrivals: [],
    policies: [{ material_id: "M", target_days: null, critical_days: null, vendor_moq_qty_base: null, order_multiple_qty_base: null, configured_lead_time_days: null }],
    plan_buys: false,
  });
  assert(result.rows.find((row) => row.material_id === "M" && row.day === "2026-10-01")?.closing_qty_base === 0, "expired stock must not cover planning");
});
