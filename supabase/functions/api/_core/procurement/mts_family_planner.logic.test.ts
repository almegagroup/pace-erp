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

Deno.test("family waterfall: same-material own and group needs on one arrival create one MOQ lot", () => {
  const days = daysTo("2026-10-31");
  const result = planFamily({
    as_of: AS_OF, horizon_end: "2026-10-31",
    opening_qty_by_material: { BETONE: 0 },
    own_demand: days.map((required_by) => ({ material_id: "BETONE", required_by, qty_base: 20 })),
    group_demand: days.map((required_by) => ({ group_id: "BETON", candidates: ["BETONE"], required_by, qty_base: 25 })),
    confirmed_arrivals: [],
    policies: [{ ...policy("BETONE", 1, 0, [{ vendor: "HIMADRI", lead: 0, cost: 1 }]), vendor_moq_qty_base: 2_000,
      vendor_options: [{ vendor_id: "HIMADRI", lead_time_days: 0, moq_qty_base: 2_000, order_multiple_qty_base: null, unit_cost: 1, cycle_days: 30 }] }],
    group_coverage_policies: [{ group_id: "BETON", effective_from: AS_OF, target_days: 1, critical_days: 0, desired_max_days_override: 31 }],
  });
  const buys = result.advisory_buys.filter((buy) => buy.material_id === "BETONE" && buy.status !== "NO_BUY");
  assert(buys.length === 1, `one same-day physical BETONE lot is required, got ${JSON.stringify(buys)}`);
  assert(buys[0].covers.includes("OWN") && buys[0].covers.includes("BETON"), `one lot must expose both purposes: ${JSON.stringify(buys[0])}`);
  assert(buys[0].recommended_po_qty_base !== null && buys[0].recommended_po_qty_base > 0, `one net lot must retain a quantity: ${JSON.stringify(buys[0])}`);
});

Deno.test("family waterfall: one BETONE receipt nets direct, narrow and broad same-day purposes", () => {
  const days = daysTo("2026-10-31");
  const betone = policy("BETONE", 1, 0, [{ vendor: "HIMADRI", lead: 0, cost: 1 }]);
  betone.cycle_days = 60;
  betone.vendor_moq_qty_base = 2_000;
  betone.vendor_options = [{ vendor_id: "HIMADRI", lead_time_days: 0, moq_qty_base: 2_000, order_multiple_qty_base: null, unit_cost: 1, cycle_days: 60 }];
  const result = planFamily({
    as_of: AS_OF, horizon_end: "2026-10-31", opening_qty_by_material: { BETONE: 0, SAPCOMER: 0, BENTONE: 0 },
    own_demand: days.map((required_by) => ({ material_id: "BETONE", required_by, qty_base: 20 })),
    group_demand: [
      ...days.map((required_by) => ({ group_id: "NARROW", candidates: ["BETONE", "SAPCOMER"], required_by, qty_base: 25 })),
      ...days.map((required_by) => ({ group_id: "BROAD", candidates: ["BETONE", "SAPCOMER", "BENTONE"], required_by, qty_base: 30 })),
    ], confirmed_arrivals: [],
    policies: [betone,
      { material_id: "SAPCOMER", target_days: null, critical_days: null, vendor_moq_qty_base: null, order_multiple_qty_base: null, delivery_lot_qty_base: null, configured_lead_time_days: null },
      { material_id: "BENTONE", target_days: null, critical_days: null, vendor_moq_qty_base: null, order_multiple_qty_base: null, delivery_lot_qty_base: null, configured_lead_time_days: null }],
    group_coverage_policies: [
      { material_group_id: "NARROW", effective_from: AS_OF, target_days: 1, critical_days: 0, desired_max_days_override: 60 },
      { material_group_id: "BROAD", effective_from: AS_OF, target_days: 1, critical_days: 0, desired_max_days_override: 60 },
    ], selections: new Map([["2026-10-01", new Set(["BETONE"])]]), selection_controlled_members: new Set(["BETONE", "SAPCOMER", "BENTONE"]),
  });
  const buys = result.advisory_buys.filter((buy) => buy.material_id === "BETONE" && buy.status !== "NO_BUY");
  assert(buys.length === 1 && buys[0].covers.includes("OWN") && buys[0].covers.includes("NARROW") && buys[0].covers.includes("BROAD"), JSON.stringify(buys));
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

Deno.test("family planner: a standalone Target is protected inside the PO21 plan and invents nothing after it (same rule as the waterfall)", () => {
  // Tot White shape: December has approved PO21 use; January has none.  Owner 2026-10-28: no plan after December means no
  // use and no order, exactly like a group member — the Target is protected only while the plan has demand.
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
  assert(january !== undefined && january.demand_qty_base === 0, "January has no demand");
  assert(january.max_cover_days === null, `stock that outlasts the plan is "beyond plan" (null), got ${january.max_cover_days}`);
  assert(buys.every((buy) => (buy.need_date ?? "") <= "2026-12-31"), `no order is planned for days after the plan: ${JSON.stringify(buys)}`);
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

Deno.test("W3c: each event day creates narrow-to-broad Desired-Max buckets before group consumption", () => {
  const result = planFamily({
    as_of: "2026-10-01", horizon_end: "2026-10-01",
    opening_qty_by_material: { VN: 30, RP: 100 }, own_demand: [],
    group_demand: [
      { group_id: "A", candidates: ["VN"], required_by: "2026-10-01", qty_base: 10 },
      { group_id: "C", candidates: ["VN", "RP"], required_by: "2026-10-01", qty_base: 10 },
    ],
    group_coverage_policies: [
      { material_group_id: "A", effective_from: "2026-10-01", target_days: 1, critical_days: 0, desired_max_days_override: 2 },
      { material_group_id: "C", effective_from: "2026-10-01", target_days: 1, critical_days: 0, desired_max_days_override: 2 },
    ],
    confirmed_arrivals: [], policies: [policy("VN", 0, 0, []), policy("RP", 0, 0, [])], plan_buys: false,
  });
  const bucket = (group: string, material: string) => result.group_bucket_reservations
    .find((row) => row.group_id === group && row.material_id === material && row.day === "2026-10-01")?.reserved_qty_base ?? 0;
  // A needs its 10 today plus two Desired-Max forward days, leaving no VN
  // available for C. C is still fully served, but from RP; it cannot silently
  // borrow A's protected family bucket.
  assert(bucket("A", "VN") === 30, `A must own the first 30 KG VN bucket: ${JSON.stringify(result.group_bucket_reservations)}`);
  assert(bucket("C", "VN") === 0 && bucket("C", "RP") === 30, `C must receive the next eligible stock, not A's VN bucket: ${JSON.stringify(result.group_bucket_reservations)}`);
  const cMix = result.group_mix.find((row) => row.group_id === "C" && row.day === "2026-10-01");
  assert(cMix?.draws.RP === 10 && cMix.draws.VN === undefined, `group draw must consume its own bucket: ${JSON.stringify(cMix)}`);
});

Deno.test("family waterfall: a MOQ group refill uses the actual free pool cover, not only one event-day bucket", () => {
  // Production BETON shape: BETONE is the only authorised future purchase;
  // SAPCOMER is an eligible group member but has neither stock nor a future buy.
  // A late MOQ refill must carry the group above Target.  It must not be
  // re-bought every following day merely because the event-day Desired-Max
  // bucket is refreshed and one day of that bucket is consumed.
  const asOf = "2026-10-25";
  const end = "2026-12-31";
  const days = Array.from({ length: 68 }, (_, i) => addDays(asOf, i));
  const betonePolicy = policy("BETONE", 25, 13, [{ vendor: "HIMADRI", lead: 16, cost: 1 }]);
  betonePolicy.vendor_moq_qty_base = 2_000;
  betonePolicy.vendor_options = (betonePolicy.vendor_options ?? []).map((option) => ({ ...option, moq_qty_base: 2_000 }));
  const result = planFamily({
    as_of: asOf, horizon_end: end,
    opening_qty_by_material: { BETONE: 700, SAPCOMER: 0 },
    own_demand: [],
    group_demand: days.map((required_by) => ({ group_id: "BETON", candidates: ["BETONE", "SAPCOMER"], required_by, qty_base: 45.533 })),
    confirmed_arrivals: [],
    policies: [
      betonePolicy,
      { material_id: "SAPCOMER", target_days: null, critical_days: null, vendor_moq_qty_base: null, order_multiple_qty_base: null, delivery_lot_qty_base: null, configured_lead_time_days: null },
    ],
    selections: new Map([["2026-10-01", new Set(["BETONE"])], ["2026-11-01", new Set(["BETONE"])], ["2026-12-01", new Set(["BETONE"])]]),
    selection_controlled_members: new Set(["BETONE", "SAPCOMER"]),
  });
  const groupBuys = result.advisory_buys.filter((buy) => buy.need_kind === "GROUP" && buy.material_id === "BETONE" && buy.status !== "NO_BUY");
  assert(groupBuys.length > 0, `BETONE must cover its eligible BETON group: ${JSON.stringify(result.advisory_buys)}`);
  const first = groupBuys[0];
  assert(first.recommended_po_qty_base !== null && first.recommended_po_qty_base >= 2_000, `MOQ must be respected: ${JSON.stringify(first)}`);
  const immediateRepeat = groupBuys.find((buy) => buy.estimated_plant_eta && first.estimated_plant_eta
    && buy.estimated_plant_eta > first.estimated_plant_eta
    && buy.estimated_plant_eta <= addDays(first.estimated_plant_eta, 1));
  assert(!immediateRepeat, `a BETON refill must not create another group buy on the next day: ${JSON.stringify(groupBuys)}`);
});

Deno.test("W3g: a live group purpose reserve carries until Target, then uses only genuine free stock", () => {
  // A daily virtual re-bucket would show 30 KG on every row.  The live
  // purpose balance starts at 30, carries down to 20 after the next draw, and
  // is restored only immediately before the following draw would take it
  // below its 1-day Target.  No receipt and no engine lot is invented.
  const days = ["2026-10-01", "2026-10-02", "2026-10-03"];
  const result = planFamily({
    as_of: days[0], horizon_end: days.at(-1)!,
    opening_qty_by_material: { BETONE: 50 },
    own_demand: [],
    group_demand: days.map((required_by) => ({
      group_id: "BETON", candidates: ["BETONE"], required_by, qty_base: 10,
    })),
    confirmed_arrivals: [],
    policies: [policy("BETONE", 20, 10, [{ vendor: "HIMADRI", lead: 0, cost: 1 }])],
    group_coverage_policies: [{
      material_group_id: "BETON", effective_from: days[0], target_days: 1,
      critical_days: 0, desired_max_days_override: 2,
    }],
    plan_buys: false,
  });
  const reserve = (day: string) => result.group_bucket_reservations
    .find((row) => row.group_id === "BETON" && row.day === day && row.material_id === "BETONE")
    ?.reserved_qty_base;
  assert(reserve(days[0]) === 30 && reserve(days[1]) === 20 && reserve(days[2]) === 30,
    `the group reserve must carry then refill at Target, not rebuild daily: ${JSON.stringify(result.group_bucket_reservations)}`);
  assert(result.advisory_buys.every((buy) => buy.status === "NO_BUY"), JSON.stringify(result.advisory_buys));
});

Deno.test("W3g-c: overlapping groups receive one global excess claim, then re-waterfall it at Target", () => {
  // Both groups can consume BETONE.  Four days need 80 KG in total; the
  // planner must retain exactly 20 KG, not let each group report the same
  // 20 KG residual as its own free coverage and postpone a necessary buy.
  const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];
  const result = planFamily({
    as_of: days[0], horizon_end: days.at(-1)!,
    opening_qty_by_material: { BETONE: 100 }, own_demand: [],
    group_demand: days.flatMap((required_by) => [
      { group_id: "NARROW", candidates: ["BETONE"], required_by, qty_base: 10 },
      { group_id: "BROAD", candidates: ["BETONE"], required_by, qty_base: 10 },
    ]),
    confirmed_arrivals: [], policies: [policy("BETONE", 1, 0, [{ vendor: "HIMADRI", lead: 0, cost: 1 }])],
    group_coverage_policies: [
      { material_group_id: "NARROW", effective_from: days[0], target_days: 1, critical_days: 0, desired_max_days_override: 2 },
      { material_group_id: "BROAD", effective_from: days[0], target_days: 1, critical_days: 0, desired_max_days_override: 2 },
    ],
    plan_buys: false,
  });
  const reconciliation = result.allocation_reconciliation.find((row) => row.material_id === "BETONE")!;
  assert(
    reconciliation.group_allocated_qty_base === 80 && reconciliation.closing_qty_base === 20 && reconciliation.variance_qty_base === 0,
    `one 100 KG opening must be consumed once across both purposes: ${JSON.stringify(reconciliation)}`,
  );
  assert(
    result.group_mix.filter((row) => row.day === days.at(-1)!).every((row) => row.draws.BETONE === 10),
    `both overlapping groups must remain serviceable from their real, separately claimed stock: ${JSON.stringify(result.group_mix)}`,
  );
});

Deno.test("W3g-c: a large excess uses bulk waterfall rounds instead of freezing the PO22 request", () => {
  // CMP003 has high-opening, low daily-use families.  The excess must still
  // rotate through every eligible group, but the implementation must not run
  // one tiny day-slice ten thousand times on every event day.
  const asOf = "2026-10-01";
  const days = Array.from({ length: 31 }, (_, i) => addDays(asOf, i));
  const started = Date.now();
  const result = planFamily({
    as_of: asOf, horizon_end: days.at(-1)!,
    opening_qty_by_material: { A: 120_000, B: 120_000, C: 120_000 },
    own_demand: [],
    group_demand: days.flatMap((required_by) => [
      { group_id: "NARROW", candidates: ["A", "B"], required_by, qty_base: 2 },
      { group_id: "MIDDLE", candidates: ["A", "B", "C"], required_by, qty_base: 2 },
      { group_id: "BROAD", candidates: ["A", "B", "C"], required_by, qty_base: 2 },
    ]),
    confirmed_arrivals: [],
    policies: [policy("A", 0, 0, []), policy("B", 0, 0, []), policy("C", 0, 0, [])],
    group_coverage_policies: [
      { group_id: "NARROW", effective_from: asOf, target_days: 1, critical_days: 0, desired_max_days_override: 2 },
      { group_id: "MIDDLE", effective_from: asOf, target_days: 1, critical_days: 0, desired_max_days_override: 2 },
      { group_id: "BROAD", effective_from: asOf, target_days: 1, critical_days: 0, desired_max_days_override: 2 },
    ],
    plan_buys: false,
  });
  assert(result.group_unmet.length === 0, `large excess must remain usable by every group: ${JSON.stringify(result.group_unmet)}`);
  assert(Date.now() - started < 1_500, "large excess waterfall must complete promptly for a PO22 request");
});

Deno.test("W3b: final family-reservation rotation batches excess instead of blocking unrelated PO22 saves", () => {
  // W3b runs after the daily simulation to explain where the physical closing
  // stock sits next. This deliberately has many pools and a large residual:
  // the former 100,000 literal-round loop produced hundreds of thousands of
  // report rows and blocked Node's shared request loop for minutes.
  const asOf = "2026-10-01";
  const members = Array.from({ length: 12 }, (_, i) => `M${i + 1}`);
  const groups = Array.from({ length: 18 }, (_, i) => `G${i + 1}`);
  const started = Date.now();
  const result = planFamily({
    as_of: asOf, horizon_end: asOf,
    opening_qty_by_material: Object.fromEntries(members.map((id) => [id, 100_000])),
    own_demand: [],
    group_demand: groups.map((group_id) => ({ group_id, candidates: members, required_by: asOf, qty_base: 1 })),
    confirmed_arrivals: [],
    policies: members.map((id) => policy(id, 0, 0, [])),
    group_coverage_policies: groups.map((group_id) => ({
      group_id, effective_from: asOf, target_days: 1, critical_days: 0, desired_max_days_override: 2,
    })),
    plan_buys: false,
  });
  const elapsed = Date.now() - started;
  const reserved = result.waterfall_reservations.reduce((sum, row) => sum + row.qty_base, 0);
  const calculatedClosing = result.allocation_reconciliation.reduce((sum, row) => sum + row.closing_qty_base, 0);
  assert(Math.abs(reserved - calculatedClosing) < 0.01, `all final stock must retain one explainable destination: ${JSON.stringify(result.waterfall_reservations.slice(-10))}`);
  assert(result.waterfall_reservations.length < 1_000, `bulk rotation must not emit a row per tiny day-slice: ${result.waterfall_reservations.length}`);
  assert(elapsed < 1_500, `final reservation waterfall must complete promptly, took ${elapsed}ms`);
});
Deno.test("family waterfall: an unconfigured zero-stock member does not collapse a group's derived Desired Max to Target", () => {
  // Production BETON shape: SAPCOMER remains an eligible existing-stock
  // alternative, but it has zero stock, no future buy selection and no
  // individual Target/Max policy.  Its missing policy must not turn BETONE's
  // 20 + 30 = 50-day derived Max into the 30-day group Target; that was the
  // source of an immediate next-day MOQ projection after a late receipt.
  const asOf = "2026-10-25";
  const days = Array.from({ length: 20 }, (_, i) => addDays(asOf, i));
  const betone = policy("BETONE", 20, 10, [{ vendor: "HIMADRI", lead: 16, cost: 1 }]);
  betone.vendor_moq_qty_base = 2_000;
  betone.vendor_options = (betone.vendor_options ?? []).map((option) => ({ ...option, moq_qty_base: 2_000 }));
  const result = planFamily({
    as_of: asOf, horizon_end: days.at(-1)!,
    opening_qty_by_material: { BETONE: 700, SAPCOMER: 0 },
    own_demand: days.map((required_by) => ({ material_id: "BETONE", required_by, qty_base: 20 })),
    group_demand: days.map((required_by) => ({ group_id: "BETON", candidates: ["BETONE", "SAPCOMER"], required_by, qty_base: 45.533 })),
    confirmed_arrivals: [],
    policies: [
      betone,
      { material_id: "SAPCOMER", target_days: null, critical_days: null, vendor_moq_qty_base: null, order_multiple_qty_base: null, delivery_lot_qty_base: null, configured_lead_time_days: null },
    ],
    group_coverage_policies: [{ material_group_id: "BETON", effective_from: asOf, target_days: 30, critical_days: 15, desired_max_days_override: null }],
    selections: new Map([["2026-10-01", new Set(["BETONE"])], ["2026-11-01", new Set(["BETONE"])]]),
    selection_controlled_members: new Set(["BETONE", "SAPCOMER"]),
  });
  const groupBuys = result.advisory_buys.filter((buy) => buy.material_id === "BETONE" && buy.need_kind === "GROUP" && buy.status !== "NO_BUY");
  assert(groupBuys[0]?.max_cover_days === 50, `BETONE's configured Desired Max must govern the group, got ${JSON.stringify(groupBuys)}`);
  assert(!groupBuys.some((buy, index) => index > 0 && buy.estimated_plant_eta === addDays(groupBuys[0].estimated_plant_eta!, 1)),
    `a late receipt must not produce a next-day group MOQ buy: ${JSON.stringify(groupBuys)}`);
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

Deno.test("family waterfall: a group-only member has no individual guard; the group's own Target decides the buy", () => {
  const days = Array.from({ length: 46 }, (_, i) => addDays("2026-10-01", i));
  const base = {
    as_of: "2026-10-01", horizon_end: "2026-11-15",
    // The fixed group order makes RP's actual eligible-group consumption
    // visible. It has no exclusive/own BOM demand at all.
    own_demand: [],
    group_demand: days.map((required_by) => ({ group_id: "RDP", candidates: ["RP", "ALT"], required_by, qty_base: 10 })),
    group_coverage_policies: [{ group_id: "RDP", effective_from: "2026-10-01", target_days: 30, critical_days: 15, desired_max_days_override: null }],
    confirmed_arrivals: [],
    policies: [
      policy("RP", 20, 10, [{ vendor: "LOCAL", lead: 0, cost: 100 }]),
      policy("ALT", 30, 15, [{ vendor: "ALT", lead: 0, cost: 100 }]),
    ],
    group_orders: new Map([["RDP", { mode: "FIXED_ORDER" as const, member_order: ["RP", "ALT"] }]]),
    selections: new Map([["2026-10-01", new Set(["RP"])], ["2026-11-01", new Set(["RP"])]]),
    selection_controlled_members: new Set(["RP", "ALT"]),
  } satisfies Omit<FamilyPlannerInput, "opening_qty_by_material">;
  // RP is used first and runs out, but ALT carries the whole group: nothing to buy.
  const carried = planFamily({ ...base, opening_qty_by_material: { RP: 210, ALT: 5_000 } });
  const carriedBuys = carried.advisory_buys.filter((buy) => buy.status !== "NO_BUY");
  assert(carriedBuys.length === 0, `a group-only member running out must not buy while the group is covered by ALT: ${JSON.stringify(carriedBuys)}`);
  assert(!carried.advisory_buys.some((buy) => buy.reason.includes("Member guard")), "no member guard exists for a group-only member");
  // When the group itself falls to its Target, the buy is attributed to the group.
  const short = planFamily({ ...base, opening_qty_by_material: { RP: 210, ALT: 150 } });
  const shortBuy = short.advisory_buys.find((buy) => buy.status !== "NO_BUY");
  assert(shortBuy?.need_kind === "GROUP" && shortBuy.reason.includes("Group RDP"), `a short group buys at the group guard: ${JSON.stringify(shortBuy)}`);
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

Deno.test("family waterfall: a group below Critical returns the ordered action chain", () => {
  const result = planFamily({
    as_of: "2026-10-01", horizon_end: "2026-10-02", opening_qty_by_material: { A: 0 }, own_demand: [],
    group_demand: [{ group_id: "G", candidates: ["A"], required_by: "2026-10-01", qty_base: 10 }], confirmed_arrivals: [],
    group_coverage_policies: [{ group_id: "G", effective_from: "2026-10-01", target_days: 5, critical_days: 2, desired_max_days_override: null }],
    policies: [policy("A", 5, 2, [])], plan_buys: false,
  });
  const action = result.group_actions.find((row) => row.group_id === "G");
  assert(action?.first_below_critical_day === "2026-10-01" && action.first_shortage_day === "2026-10-01", `group Critical/shortage must be explicit: ${JSON.stringify(action)}`);
  assert(action?.ordered_actions[0].startsWith("Bridge") && action.ordered_actions.at(-1)?.startsWith("Escalate"), `action chain order is incorrect: ${JSON.stringify(action)}`);
});

Deno.test("W4: a confirmed future arrival joins group allocation only from its ETA", () => {
  const days = Array.from({ length: 5 }, (_, i) => addDays("2026-10-01", i));
  const result = planFamily({
    as_of: "2026-10-01", horizon_end: "2026-10-05", opening_qty_by_material: { BRIDGE: 20, INBOUND: 0 }, own_demand: [],
    group_demand: days.map((required_by) => ({ group_id: "G", candidates: ["BRIDGE", "INBOUND"], required_by, qty_base: 10 })),
    confirmed_arrivals: [{ source_key: "INBOUND-ETA", material_id: "INBOUND", eta_to_plant: "2026-10-03", qty_base: 100 }],
    policies: [policy("BRIDGE", 0, 0, []), policy("INBOUND", 0, 0, [])], plan_buys: false,
  });
  const before = result.group_mix.find((row) => row.group_id === "G" && row.day === "2026-10-02");
  const onEta = result.group_mix.find((row) => row.group_id === "G" && row.day === "2026-10-03");
  assert(before?.draws.INBOUND === undefined, `future receipt was used before ETA: ${JSON.stringify(before)}`);
  assert((onEta?.draws.INBOUND ?? 0) > 0, `future receipt must re-enter the same group waterfall on ETA: ${JSON.stringify(onEta)}`);
});

Deno.test("W3i: allocation trace preserves the physical planning source", () => {
  const result = planFamily({
    as_of: "2026-10-24", horizon_end: "2026-10-24",
    opening_qty_by_material: { BETONE: 0 },
    own_demand: [{ material_id: "BETONE", required_by: "2026-10-24", qty_base: 10 }],
    group_demand: [],
    confirmed_arrivals: [{
      source_key: "PO ASC/P2026/0271 · CSN 3000000223",
      material_id: "BETONE", eta_to_plant: "2026-10-24", qty_base: 10,
    }],
    policies: [policy("BETONE", 20, 10, [])],
    plan_buys: false,
  });
  const row = result.allocation_rows.find((item) => item.destination_kind === "OWN");
  assert(row?.source_kind === "CONFIRMED_ETA" && row.source_reference.includes("CSN 3000000223"),
    `the trace must expose the receipt that supplied the planning draw: ${JSON.stringify(result.allocation_rows)}`);
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

Deno.test("W3b: ending carry follows direct reserve, narrow-group Desired Max, then second rotation", () => {
  const result = planFamily({
    as_of: "2026-10-01", horizon_end: "2026-10-01",
    opening_qty_by_material: { DIRECT: 100, A: 100, B: 100 },
    own_demand: [{ material_id: "DIRECT", required_by: "2026-10-01", qty_base: 10 }],
    group_demand: [
      { group_id: "SMALL", candidates: ["A"], required_by: "2026-10-01", qty_base: 10 },
      { group_id: "LARGE", candidates: ["A", "B"], required_by: "2026-10-01", qty_base: 10 },
    ],
    group_coverage_policies: [
      { material_group_id: "SMALL", effective_from: "2026-10-01", target_days: 1, critical_days: 0, desired_max_days_override: 2 },
      { material_group_id: "LARGE", effective_from: "2026-10-01", target_days: 1, critical_days: 0, desired_max_days_override: 2 },
    ],
    confirmed_arrivals: [],
    policies: [policy("DIRECT", 1, 0, []), policy("A", 0, 0, []), policy("B", 0, 0, [])],
    plan_buys: false,
  });
  const reservations = result.waterfall_reservations;
  assert(reservations.some((row) => row.material_id === "DIRECT" && row.stage === "DIRECT_DESIRED_MAX"), `direct reserve missing: ${JSON.stringify(reservations)}`);
  assert(reservations.some((row) => row.group_id === "SMALL" && row.stage === "GROUP_DESIRED_MAX"), `small group Desired-Max pass missing: ${JSON.stringify(reservations)}`);
  assert(reservations.some((row) => row.group_id === "LARGE" && row.stage === "GROUP_DESIRED_MAX"), `next eligible group Desired-Max pass missing: ${JSON.stringify(reservations)}`);
  assert(reservations.some((row) => row.stage === "SECOND_ROTATION"), `genuine excess must make a second rotation: ${JSON.stringify(reservations)}`);
  for (const id of ["DIRECT", "A", "B"]) {
    const finalClosing = result.rows.find((row) => row.material_id === id && row.day === "2026-10-01")?.closing_qty_base ?? 0;
    const reserved = reservations.filter((row) => row.material_id === id).reduce((sum, row) => sum + row.qty_base, 0);
    assert(Math.abs(finalClosing - reserved) < 0.00001, `${id} final carry is not fully accounted for: closing=${finalClosing}, reserved=${reserved}`);
  }
});

/** The same RDP family under prefixed ids, so one company input can hold many independent families. */
function prefixedFamily(prefix: string): FamilyPlannerInput {
  const f = rdpFamily();
  const id = (m: string) => `${prefix}${m}`;
  return {
    ...f,
    opening_qty_by_material: Object.fromEntries(Object.entries(f.opening_qty_by_material).map(([m, q]) => [id(m), q])),
    own_demand: f.own_demand.map((d) => ({ ...d, material_id: id(d.material_id) })),
    group_demand: f.group_demand.map((g) => ({ ...g, group_id: id(g.group_id), candidates: g.candidates.map(id) })),
    policies: f.policies.map((p) => ({ ...p, material_id: id(p.material_id) })),
  };
}

Deno.test("company scale: each family plans independently, fast, and never hits the lot cap", () => {
  const families = Array.from({ length: 30 }, (_, k) => prefixedFamily(`F${k}_`));
  const company: FamilyPlannerInput = {
    as_of: AS_OF, horizon_end: END,
    opening_qty_by_material: Object.assign({}, ...families.map((f) => f.opening_qty_by_material)),
    own_demand: families.flatMap((f) => f.own_demand),
    group_demand: families.flatMap((f) => f.group_demand),
    // An arrival of an unrelated family must not re-allocate this one.
    confirmed_arrivals: [{ source_key: "F1-ETA", material_id: "F1_DA", eta_to_plant: "2026-11-05", qty_base: 20000 }],
    policies: families.flatMap((f) => f.policies),
  };
  const started = performance.now();
  const result = planFamily(company);
  const elapsed = performance.now() - started;
  assert(elapsed < 20_000, `company plan took ${Math.round(elapsed)} ms`);

  const alone = planFamily(prefixedFamily("F0_"));
  const pick = <T extends { material_id: string }>(rows: T[]) => JSON.stringify(rows.filter((r) => r.material_id.startsWith("F0_")));
  assert(pick(result.advisory_buys) === pick(alone.advisory_buys), "F0 buys change when other families are planned alongside");
  assert(pick(result.rows) === pick(alone.rows), "F0 projection changes when other families are planned alongside");
  const lots = (r: typeof result) => r.advisory_buys.filter((b) => b.status === "ADVISORY" || b.status === "ADVISORY_LATE").length;
  const perFamily = lots(alone);
  assert(lots(result) >= perFamily * 29, `company lots ${lots(result)} < 29 × ${perFamily}: the lot cap truncated the plan`);
});

Deno.test("smart consumption ratio: equal stock and price, the longer-credit member is used more; unknown credit is neutral", () => {
  const days = daysTo("2026-11-30");
  const member = (id: string, credit: number | null): OptimizerMaterialPlanningPolicy => ({
    material_id: id, target_days: 20, critical_days: 10, vendor_moq_qty_base: null, order_multiple_qty_base: null, configured_lead_time_days: null, cycle_days: 30,
    vendor_options: [{ vendor_id: `V${id}`, lead_time_days: 10, moq_qty_base: null, order_multiple_qty_base: null, unit_cost: 100, cycle_days: 30, credit_days: credit }],
  });
  const input: FamilyPlannerInput = {
    as_of: AS_OF, horizon_end: "2026-11-30", plan_buys: false,
    opening_qty_by_material: { ADV: 30000, C30: 30000, C90: 30000, UNK: 30000 },
    own_demand: [],
    group_demand: days.map((d) => ({ group_id: "G", candidates: ["ADV", "C30", "C90", "UNK"], required_by: d, qty_base: 1000 })),
    confirmed_arrivals: [],
    policies: [member("ADV", 0), member("C30", 30), member("C90", 90), member("UNK", null)],
  };
  const first = planFamily(input).group_mix.find((g) => g.group_id === "G" && g.day === AS_OF);
  assert(first, "group mix on day one");
  const d = first.draws;
  assert(d.C90 > d.C30 && d.C30 > d.ADV, `longer credit is used more: ${JSON.stringify(d)}`);
  assert(d.ADV > 0, `advance stock still rotates: ${JSON.stringify(d)}`);
  // Company average credit = 40 days → unknown sits between 30 and 90 days, i.e. neutral.
  assert(d.UNK > d.C30 && d.UNK < d.C90, `unknown credit is neutral: ${JSON.stringify(d)}`);
});

Deno.test("owner 2026-10-28 D1: a receipt does not refill a group that is above its own Min; the group refills when it falls below Min", () => {
  const days = Array.from({ length: 40 }, (_, i) => addDays("2026-10-01", i));
  const result = planFamily({
    as_of: "2026-10-01", horizon_end: addDays("2026-10-01", 39), opening_qty_by_material: { A: 800, B: 0 }, own_demand: [],
    group_demand: days.map((required_by) => ({ group_id: "G", candidates: ["A", "B"], required_by, qty_base: 10 })),
    confirmed_arrivals: [{ source_key: "B-ETA", material_id: "B", eta_to_plant: "2026-10-06", qty_base: 500 }],
    group_coverage_policies: [{ material_group_id: "G", effective_from: "2026-01-01", target_days: 10, critical_days: 5, desired_max_days_override: 20 }],
    policies: [policy("A", 10, 5, []), policy("B", 10, 5, [])].map((p) => ({ ...p, cycle_days: 10 })), plan_buys: false,
  });
  const reserve = (day: string) => result.group_bucket_reservations.filter((row) => row.group_id === "G" && row.day === day).reduce((s, row) => s + row.reserved_qty_base, 0);
  // Target 10 + cycle 10 -> Max 20 days = 200 after today's use; the receipt on 10-06 must not top it up.
  assert(reserve("2026-10-06") < reserve("2026-10-05"), `receipt day must not refill a group above Min: ${reserve("2026-10-05")} -> ${reserve("2026-10-06")}`);
  // Below Min (10 days = 100 after use) the group claims again up to Max.
  const refills = days.filter((day, i) => i > 0 && reserve(day) > reserve(days[i - 1]) + 1);
  assert(refills.length >= 1, "the group must refill once it falls below its Min");
  assert(reserve(refills[0]) >= 199, `refill goes to Max (200): ${reserve(refills[0])}`);
});

Deno.test("owner 2026-10-28 D2: FEFO across lots — the member holding the older stock is used first, the newer lot last", () => {
  const days = Array.from({ length: 8 }, (_, i) => addDays("2026-10-01", i));
  const result = planFamily({
    as_of: "2026-10-01", horizon_end: addDays("2026-10-01", 7), opening_qty_by_material: { OLD: 40, NEW: 0 }, own_demand: [],
    group_demand: days.map((required_by) => ({ group_id: "G", candidates: ["NEW", "OLD"], required_by, qty_base: 10 })),
    confirmed_arrivals: [{ source_key: "NEW-ETA", material_id: "NEW", eta_to_plant: "2026-10-02", qty_base: 100 }],
    policies: [policy("OLD", 0, 0, []), policy("NEW", 0, 0, [])], plan_buys: false,
  });
  const draw = (day: string, id: string) => result.group_mix.find((row) => row.group_id === "G" && row.day === day)?.draws[id] ?? 0;
  for (const day of ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]) assert(draw(day, "NEW") === 0 && draw(day, "OLD") > 0, `${day}: the older stock goes first`);
  assert(draw("2026-10-05", "NEW") > 0, "the newer lot is used once the older stock is gone");
});

Deno.test("owner 2026-10-28 D3: Exclusive use is protected like a level — the shared pool can never leave it short", () => {
  const days = Array.from({ length: 60 }, (_, i) => addDays("2026-10-01", i));
  const result = planFamily({
    as_of: "2026-10-01", horizon_end: addDays("2026-10-01", 59), opening_qty_by_material: { X: 700, Y: 300 },
    own_demand: days.map((required_by) => ({ material_id: "X", required_by, qty_base: 5 })),
    group_demand: days.map((required_by) => ({ group_id: "G", candidates: ["X", "Y"], required_by, qty_base: 10 })),
    confirmed_arrivals: [], policies: [policy("X", 10, 5, []), policy("Y", 10, 5, [])].map((p) => ({ ...p, cycle_days: 10 })), plan_buys: false,
  });
  const x = result.rows.filter((row) => row.material_id === "X");
  assert(x.every((row) => row.closing_qty_base >= -1e-6), "X never goes negative");
  // 700 + 300 = 1000 against (5 + 10) * 60 = 900: the exclusive use of X is fully met while the group draws the rest.
  assert(result.group_unmet.length === 0, `no group shortage: ${JSON.stringify(result.group_unmet.slice(0, 2))}`);
  const exclusiveDays = x.filter((row) => row.demand_qty_base > 0).length;
  assert(exclusiveDays === 60, "all 60 days of the exclusive use are served");
});

Deno.test("owner 2026-10-28 D7: the waterfall is logged as events and a Material × Level matrix that always adds up", () => {
  const days = Array.from({ length: 40 }, (_, i) => addDays("2026-10-01", i));
  const result = planFamily({
    as_of: "2026-10-01", horizon_end: addDays("2026-10-01", 39), opening_qty_by_material: { A: 800, B: 0, X: 300 },
    own_demand: days.map((required_by) => ({ material_id: "X", required_by, qty_base: 5 })),
    group_demand: days.map((required_by) => ({ group_id: "G", candidates: ["A", "B", "X"], required_by, qty_base: 10 })),
    confirmed_arrivals: [{ source_key: "B-ETA", material_id: "B", eta_to_plant: "2026-10-06", qty_base: 500 }],
    group_coverage_policies: [{ material_group_id: "G", effective_from: "2026-01-01", target_days: 10, critical_days: 5, desired_max_days_override: 20 }],
    policies: [policy("A", 10, 5, []), policy("B", 10, 5, []), policy("X", 10, 5, [])].map((p) => ({ ...p, cycle_days: 10 })), plan_buys: false,
  });
  const opening = result.level_events.filter((event) => event.kind === "OPENING_RESERVE");
  assert(opening.some((event) => event.level_kind === "OWN" && event.level_id === "X") && opening.some((event) => event.level_kind === "GROUP" && event.level_id === "G"), "day 0: Exclusive and the group reserve to their Max");
  const receipt = result.level_events.find((event) => event.kind === "RECEIPT");
  assert(receipt?.day === "2026-10-06" && receipt.material_id === "B" && receipt.qty === 500 && receipt.references.includes("B-ETA"), `the receipt is an event with its document: ${JSON.stringify(receipt)}`);
  const topUps = result.level_events.filter((event) => event.kind === "TOP_UP" && event.level_kind === "GROUP");
  assert(topUps.length >= 1 && topUps.every((event) => event.day > "2026-10-06" || event.qty > 0), "a group top-up is an event with the KG it took");
  assert(topUps.every((event) => event.pool_after <= event.pool_before + 1e-6), "a top-up never increases the pool");
  assert(result.level_matrix.length >= 3, "a snapshot on the event days");
  for (const snapshot of result.level_matrix) {
    for (const material of Object.keys(snapshot.closing)) {
      const held = snapshot.levels.reduce((sum, level) => sum + (level.by_material[material] ?? 0), 0) + (snapshot.pool[material] ?? 0);
      assert(Math.abs(held - snapshot.closing[material]) < 0.01, `${snapshot.day} ${material}: levels + pool ${held} must equal stock ${snapshot.closing[material]}`);
    }
  }
});

Deno.test("owner 2026-10-28: a waiting level is logged once, not every day it keeps waiting", () => {
  const days = Array.from({ length: 30 }, (_, i) => addDays("2026-10-01", i));
  const result = planFamily({
    as_of: "2026-10-01", horizon_end: addDays("2026-10-01", 29), opening_qty_by_material: { A: 120 }, own_demand: [],
    group_demand: days.map((required_by) => ({ group_id: "G", candidates: ["A"], required_by, qty_base: 10 })),
    confirmed_arrivals: [], group_coverage_policies: [{ material_group_id: "G", effective_from: "2026-01-01", target_days: 5, critical_days: 2, desired_max_days_override: 15 }],
    policies: [policy("A", 5, 2, [])].map((p) => ({ ...p, cycle_days: 10 })), plan_buys: false,
  });
  const levelRows = result.level_events.filter((event) => event.level_id === "G");
  assert(levelRows[0].kind === "OPENING_RESERVE" && levelRows[0].shortfall > 0, "the level starts short: 120 of the 150 it wants");
  assert(levelRows.length <= 3, `a level that keeps waiting is not logged every day: ${levelRows.map((event) => `${event.day}:${event.kind}`).join(",")}`);
});

Deno.test("owner 2026-10-28 D10: a member that has to be bought is connected at its OWN Min, not the group's", () => {
  const days = Array.from({ length: 150 }, (_, i) => addDays("2026-10-01", i));
  const run = (gabrosaTarget: number) => planFamily({
    as_of: "2026-10-01", horizon_end: days[149], opening_qty_by_material: { GAB: 4500, TS: 0 }, own_demand: [],
    group_demand: days.map((required_by) => ({ group_id: "G", candidates: ["GAB", "TS"], required_by, qty_base: 100 })),
    confirmed_arrivals: [], group_coverage_policies: [{ material_group_id: "G", effective_from: "2026-01-01", target_days: 30, critical_days: 15, desired_max_days_override: null }],
    policies: [policy("GAB", gabrosaTarget, 5, [{ vendor: "VG", lead: 6, cost: 100 }]), policy("TS", 30, 5, [])], plan_buys: true,
  }).advisory_buys.find((buy) => buy.status === "ADVISORY" || buy.status === "ADVISORY_LATE");
  const atGroupMin = run(30);
  const atOwnMin = run(20);
  assert(atGroupMin?.need_date === "2026-10-15", `Target 30 -> 30 days left on 15 Oct: ${atGroupMin?.need_date}`);
  assert(atOwnMin?.need_date === "2026-10-25", `Gabrosa's own 20 days -> 25 Oct: ${atOwnMin?.need_date}`);
  assert(atOwnMin.recommended_po_by === "2026-10-19", `order date = need date - lead time 6: ${atOwnMin.recommended_po_by}`);
});

Deno.test("owner 2026-10-28 Store keep: a checkpoint day always carries a Material × Level snapshot (the quantity to keep at the end of a period)", () => {
  const days = Array.from({ length: 40 }, (_, i) => addDays("2026-10-01", i));
  const result = planFamily({
    as_of: "2026-10-01", horizon_end: addDays("2026-10-01", 39), opening_qty_by_material: { A: 800, X: 300 },
    own_demand: days.map((required_by) => ({ material_id: "X", required_by, qty_base: 5 })),
    group_demand: days.map((required_by) => ({ group_id: "G", candidates: ["A", "X"], required_by, qty_base: 10 })),
    confirmed_arrivals: [], checkpoints: ["2026-10-20", "2026-10-31"],
    group_coverage_policies: [{ material_group_id: "G", effective_from: "2026-01-01", target_days: 10, critical_days: 5, desired_max_days_override: 20 }],
    policies: [policy("A", 10, 5, []), policy("X", 10, 5, [])].map((p) => ({ ...p, cycle_days: 10 })), plan_buys: false,
  });
  for (const day of ["2026-10-20", "2026-10-31"]) {
    const snapshot = result.level_matrix.find((snap) => snap.day === day);
    assert(snapshot, `${day} has a snapshot`);
    const group = snapshot.levels.find((level) => level.level_kind === "GROUP" && level.level_id === "G");
    assert(group && Object.values(group.by_material).reduce((s, q) => s + q, 0) > 0, `${day}: the group's reserve is reported`);
  }
});

Deno.test("owner 2026-10-28: a PO21 plan that ends before the horizon end invents no group demand and no buy after it", () => {
  const planEnd = "2027-01-31";
  const days = daysTo(planEnd);
  const result = planFamily({
    as_of: AS_OF, horizon_end: END, opening_qty_by_material: { X: 60_000, Y: 50_000 },
    own_demand: [],
    // 110,000 KG covers the whole plan (102 days x 1,000) with 8,000 left — below Target only if March demand were invented.
    group_demand: days.map((required_by) => ({ group_id: "G", candidates: ["X", "Y"], required_by, qty_base: 1000 })),
    confirmed_arrivals: [],
    policies: [policy("X", 30, 15, [{ vendor: "V", lead: 10, cost: 1 }]), policy("Y", 30, 15, [{ vendor: "V2", lead: 10, cost: 1 }])],
    group_coverage_policies: [{ group_id: "G", effective_from: AS_OF, target_days: 30, critical_days: 15, desired_max_days_override: 60 }],
  });
  const lateBuys = result.advisory_buys.filter((b) => b.status !== "NO_BUY" && (b.need_date ?? "") > planEnd);
  assert(lateBuys.length === 0, `no buy may be planned for days after the PO21 plan: ${JSON.stringify(lateBuys)}`);
  assert(result.rows.every((r) => r.closing_qty_base >= -1e-6), "no stock-out inside the plan");
});

Deno.test("owner 2026-10-28: a group lot reports the cover that triggered it and the member's own Min (D10)", () => {
  const days = daysTo("2027-01-31");
  const result = planFamily({
    as_of: AS_OF, horizon_end: "2027-01-31", opening_qty_by_material: { X: 30_000, Y: 20_000 },
    own_demand: [], group_demand: days.map((required_by) => ({ group_id: "G", candidates: ["X", "Y"], required_by, qty_base: 1000 })),
    confirmed_arrivals: [],
    policies: [policy("X", 20, 10, [{ vendor: "V", lead: 5, cost: 1 }]), { ...policy("Y", 30, 15, []), vendor_options: [] }],
    group_coverage_policies: [{ group_id: "G", effective_from: AS_OF, target_days: 30, critical_days: 15, desired_max_days_override: 60 }],
  });
  const buy = result.advisory_buys.find((b) => b.material_id === "X" && b.status !== "NO_BUY");
  assert(buy, "X is bought for the group");
  assert(buy.need_kind === "GROUP" && buy.trigger_min_days === 20, `connected at the member's own Min 20, not the group's 30: ${JSON.stringify(buy)}`);
  assert(buy.trigger_cover_days !== null && buy.trigger_cover_days !== undefined && buy.trigger_cover_days <= 20, `group cover at the trigger is at or below 20: ${buy.trigger_cover_days}`);
});

Deno.test("owner 2026-10-28: the 120-day rule is only a FEFO rank; stock with no real expiry is never removed from the plan", () => {
  const days = daysTo("2026-12-31");
  const base = (receipt: { valid_until: string; no_expiry?: boolean }): FamilyPlannerInput => ({
    as_of: AS_OF, horizon_end: "2026-12-31", opening_qty_by_material: { X: 1000 },
    own_demand: days.map((required_by) => ({ material_id: "X", required_by, qty_base: 1 })),
    group_demand: [], confirmed_arrivals: [],
    opening_receipts: [{ material_id: "X", qty_base: 1000, reference: "Opening stock", expiry_priority: false, ...receipt }],
    policies: [{ ...policy("X", 10, 5, []), vendor_options: [] }],
  });
  const noExpiry = planFamily(base({ valid_until: addDays(AS_OF, 30), no_expiry: true }));
  const lastNoExpiry = noExpiry.rows.filter((r) => r.material_id === "X").at(-1)!;
  assert(lastNoExpiry.closing_qty_base > 900, `no real expiry: the stock stays (closing ${lastNoExpiry.closing_qty_base})`);
  const dated = planFamily(base({ valid_until: addDays(AS_OF, 30) }));
  const lastDated = dated.rows.filter((r) => r.material_id === "X").at(-1)!;
  assert(lastDated.closing_qty_base < 1, `a real expiry date still removes the stock (closing ${lastDated.closing_qty_base})`);
});

Deno.test("owner 2026-10-28: CMP005 RDP — a late need already cured by a lot arriving the same day gets no second lot (one Dairen lot, not two)", () => {
  // Real CMP005 shape (28 Oct 2026): Dairen (DA) lead 53 d, lot 24,750; RP-4099 domestic, lead 15 d, lot 25,000; PO21 plan ends 31 Jan.
  const asOf = "2026-10-28";
  const planDays: string[] = [];
  for (let day = asOf; day <= "2027-01-31"; day = addDays(day, 1)) planDays.push(day);
  const rate = (day: string, a: number, b: number, c: number, d: number) => (day < "2026-11-01" ? a : day < "2026-12-01" ? b : day < "2027-01-01" ? c : d);
  const lot = (id: string, lead: number, cost: number, size: number) => ({
    ...policy(id, id === "RP" ? 25 : 30, id === "RP" ? 13 : 15, [{ vendor: `V${id}`, lead, cost }]),
    vendor_options: [{ vendor_id: `V${id}`, lead_time_days: lead, moq_qty_base: size, order_multiple_qty_base: size, delivery_lot_qty_base: size, unit_cost: cost, cycle_days: 30 }],
  });
  const result = planFamily({
    as_of: asOf, horizon_end: "2027-03-31",
    opening_qty_by_material: { DA: 28_968, RP: 3_355, EL: 24_000, VN: 8_658 },
    own_demand: [],
    group_demand: [
      ...planDays.map((required_by) => ({ group_id: "RDP_TLA", candidates: ["DA", "VN"], required_by, qty_base: rate(required_by, 50.4, 62, 60, 60) })),
      ...planDays.map((required_by) => ({ group_id: "RDP", candidates: ["DA", "EL", "RP", "VN"], required_by, qty_base: rate(required_by, 1889.4, 1921.2, 2001.7, 1818.2) })),
    ],
    confirmed_arrivals: [
      { source_key: "A|DA", material_id: "DA", eta_to_plant: "2026-10-28", qty_base: 24_750 },
      { source_key: "A|RP", material_id: "RP", eta_to_plant: "2026-11-01", qty_base: 25_000 },
    ],
    policies: [lot("DA", 53, 105, 24_750), lot("RP", 15, 118, 25_000), lot("EL", 73, 95, 24_000),
      { material_id: "VN", target_days: 30, critical_days: 15, vendor_moq_qty_base: null, order_multiple_qty_base: null, configured_lead_time_days: null }],
    group_coverage_policies: [
      { group_id: "RDP_TLA", effective_from: asOf, target_days: 30, critical_days: 15, desired_max_days_override: 60 },
      { group_id: "RDP", effective_from: asOf, target_days: 30, critical_days: 15, desired_max_days_override: 60 },
    ],
  });
  const dairen = result.advisory_buys.filter((b) => b.material_id === "DA" && b.status !== "NO_BUY");
  assert(dairen.length === 1, `one Dairen lot on 20 Dec, got ${dairen.map((b) => `${b.estimated_plant_eta} ${b.recommended_po_qty_base}`).join(" | ")}`);
  assert(dairen[0].estimated_plant_eta === "2026-12-20", `earliest arrival is today + 53 days: ${dairen[0].estimated_plant_eta}`);
});

Deno.test("owner 2026-10-28: a late own-use need cured by a PO landing two days later gets no 'Order today' (PM-00060 shape)", () => {
  const asOf = "2026-10-28";
  const planDays: string[] = [];
  for (let day = asOf; day <= "2027-01-31"; day = addDays(day, 1)) planDays.push(day);
  const rate = (day: string) => (day < "2026-11-01" ? 737.5 : day < "2026-12-01" ? 350 : day < "2027-01-01" ? 330.6 : 74.2);
  const rishi = {
    ...policy("PM", 25, 13, [{ vendor: "RISHI", lead: 27, cost: 22.5 }]),
    cycle_days: 30,
  };
  const result = planFamily({
    as_of: asOf, horizon_end: "2027-03-31", opening_qty_by_material: { PM: 15_596 },
    own_demand: planDays.map((required_by) => ({ material_id: "PM", required_by, qty_base: rate(required_by) })),
    group_demand: [],
    confirmed_arrivals: [{ source_key: "A|PM", material_id: "PM", eta_to_plant: "2026-11-13", qty_base: 10_000 }],
    policies: [rishi],
  });
  const late = result.advisory_buys.filter((b) => b.material_id === "PM" && b.status === "ADVISORY_LATE");
  assert(late.length === 0, `no 'Order today' while a PO lands on 13 Nov: ${JSON.stringify(late)}`);
  assert(result.rows.filter((r) => r.material_id === "PM").every((r) => r.closing_qty_base >= -1e-6), "no stock-out");
});

Deno.test("owner 2026-10-28: a group's Max is never below its own Min", () => {
  const days = daysTo("2026-12-31");
  const result = planFamily({
    as_of: AS_OF, horizon_end: "2026-12-31", opening_qty_by_material: { X: 5_000, Y: 5_000 },
    own_demand: [], group_demand: days.map((required_by) => ({ group_id: "G", candidates: ["X", "Y"], required_by, qty_base: 100 })),
    confirmed_arrivals: [],
    policies: [{ ...policy("X", 5, 3, [{ vendor: "V", lead: 5, cost: 1 }]), cycle_days: 10 }, { ...policy("Y", 5, 3, [{ vendor: "V2", lead: 5, cost: 1 }]), cycle_days: 10 }],
    group_coverage_policies: [{ group_id: "G", effective_from: AS_OF, target_days: 30, critical_days: 15 }],
  });
  const pol = result.level_policies.find((l) => l.level_id === "G");
  assert(pol && pol.desired_days !== null && pol.desired_days >= 30, `group Max (${pol?.desired_days}) must not be below its Min 30`);
});
