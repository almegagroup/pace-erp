import { applyOrderConstraints, projectDailyCoverage, splitIntoLots, totalLeadTimeDays } from "./mts_optimizer_phase3d.logic.ts";
import type { OptimizerMaterialPlanningPolicy, OptimizerProjectionInput } from "./mts_optimizer_phase3d.types.ts";

function equal(actual: unknown, expected: unknown, message: string) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
function policy(overrides: Partial<OptimizerMaterialPlanningPolicy> = {}): OptimizerMaterialPlanningPolicy {
  return { material_id: "M1", target_days: 5, critical_days: 2, vendor_moq_qty_base: null, order_multiple_qty_base: null, configured_lead_time_days: null, route_lead_time_days: 3, booking_time_days: null, ...overrides };
}
function daily(qty: number, from = "2026-10-01", to = "2026-10-31", materialId: string | null = "M1") {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d = new Date(d.getTime() + 86_400_000)) {
    const day = d.toISOString().slice(0, 10);
    out.push({ source_key: `${materialId}:${day}`, material_id: materialId, required_by: day, qty_base: qty });
  }
  return out;
}
function input(overrides: Partial<OptimizerProjectionInput> = {}): OptimizerProjectionInput {
  return { as_of: "2026-10-01", horizon_end: "2026-10-31", opening_qty_by_material: { M1: 10 }, daily_demand: daily(1), confirmed_arrivals: [], policies: [policy()], ...overrides };
}
const row = (result: ReturnType<typeof projectDailyCoverage>, day: string, id = "M1") => result.rows.find((r) => r.material_id === id && r.day === day)!;

Deno.test("MOQ and order multiple are distinct: 28 at a 25 multiple recommends 50", () => {
  equal(applyOrderConstraints(28, policy({ vendor_moq_qty_base: 20, order_multiple_qty_base: 25 })), 50, "round to enforceable multiple after MOQ");
  equal(applyOrderConstraints(1, policy({ vendor_moq_qty_base: 20, order_multiple_qty_base: 25 })), 25, "MOQ 20 is then rounded to 25 multiple");
  equal(splitIntoLots(50, 25), [25, 25], "50 = 25 + 25 lots");
  equal(splitIntoLots(60, 25), [25, 25, 10], "remainder lot");
});

Deno.test("D6: total lead time = Booking Time (blank = 0) + route; else configured total", () => {
  equal(totalLeadTimeDays(policy({ booking_time_days: 20, route_lead_time_days: 35 })), 55, "booking + route");
  equal(totalLeadTimeDays(policy({ booking_time_days: null, route_lead_time_days: 35 })), 35, "blank booking = 0");
  equal(totalLeadTimeDays(policy({ route_lead_time_days: null, configured_lead_time_days: 40 })), 40, "configured total");
  equal(totalLeadTimeDays(policy({ route_lead_time_days: null, configured_lead_time_days: null })), null, "unknown");
});

Deno.test("confirmed ETA is projected on its plant date but is never executable Store stock", () => {
  const result = projectDailyCoverage(input({ policies: [policy({ target_days: 1, critical_days: 0 })], confirmed_arrivals: [{ source_key: "csn", material_id: "M1", eta_to_plant: "2026-10-03", qty_base: 12, lifecycle_kind: "IN_TRANSIT" }] }));
  const day = row(result, "2026-10-03");
  equal([day.opening_qty_base, day.confirmed_arrival_qty_base, day.closing_qty_base, day.min_stock_qty_base, day.executable_arrival], [8, 12, 19, 7, false], "arrival affects projection only on ETA; min stock excludes it");
});

Deno.test("D5: passed or missing CSN ETA is assumed today, flagged, never dropped", () => {
  const result = projectDailyCoverage(input({ confirmed_arrivals: [
    { source_key: "late", material_id: "M1", eta_to_plant: "2026-09-25", qty_base: 7, lifecycle_kind: "IN_TRANSIT" },
    { source_key: "none", material_id: "M1", eta_to_plant: null, qty_base: 3, lifecycle_kind: "IN_TRANSIT" },
  ] }));
  equal(row(result, "2026-10-01").confirmed_arrival_qty_base, 10, "both counted on as_of");
  equal(result.arrival_flags.map((f) => [f.source_key, f.reason, f.assumed_eta]), [["late", "ETA_PASSED", "2026-10-01"], ["none", "ETA_MISSING", "2026-10-01"]], "user is told to update CSN Tracker");
});

Deno.test("group-pool demand is reported per group and not copied onto any material", () => {
  const result = projectDailyCoverage(input({
    opening_qty_by_material: { M1: 10, M2: 10 },
    daily_demand: [{ source_key: "pool", material_id: null, group_id: "G1", required_by: "2026-10-02", qty_base: 9 }, { source_key: "pool2", material_id: null, group_id: "G2", required_by: "2026-10-03", qty_base: 4 }],
    policies: [policy(), policy({ material_id: "M2" })],
  }));
  equal(result.group_pool_risks.map((g) => [g.group_id, g.unresolved_qty_base, g.first_day]), [["G1", 9, "2026-10-02"], ["G2", 4, "2026-10-03"]], "per group");
  equal([row(result, "2026-10-31", "M1").closing_qty_base, row(result, "2026-10-31", "M2").closing_qty_base], [10, 10], "pool not assigned to members");
  equal(Object.keys(result.risks[0]).includes("unresolved_group_pool_qty_base"), false, "no company-wide pool copy on material risk");
});

Deno.test("D2: lot triggers when cover falls to Target (inclusive); MOQ excess carries forward", () => {
  const result = projectDailyCoverage(input({ policies: [policy({ vendor_moq_qty_base: 10 })] }));
  const buys = result.advisory_buys.filter((b) => b.status === "ADVISORY");
  equal(buys.map((b) => [b.sequence, b.estimated_plant_eta, b.recommended_po_by, b.recommended_po_qty_base]), [[1, "2026-10-05", "2026-10-02", 10], [2, "2026-10-15", "2026-10-12", 10], [3, "2026-10-25", "2026-10-22", 10]], "cover 5 = Target triggers; next order only after the 10 is used");
  equal([row(result, "2026-10-05").planned_lot_qty_base, row(result, "2026-10-05").closing_qty_base, row(result, "2026-10-05").max_cover_days], [10, 15, 15], "lot lands on its ETA");
  equal(result.risks[0].first_shortage_day, null, "no stock-out");
});

Deno.test("PO-by already passed is ADVISORY_LATE: earliest arrival = today + lead time, gap stays visible", () => {
  const result = projectDailyCoverage(input({ opening_qty_by_material: { M1: 3 }, policies: [policy({ vendor_moq_qty_base: 10, route_lead_time_days: 10 })] }));
  const first = result.advisory_buys[0];
  equal([first.status, first.recommended_po_by, first.estimated_plant_eta, first.lots[0].plant_eta], ["ADVISORY_LATE", "2026-10-01", "2026-10-11", "2026-10-11"], "late order flagged");
  equal(result.risks[0].first_shortage_day, "2026-10-04", "shortage before the late lot is visible");
  equal(row(result, "2026-10-11").planned_lot_qty_base, 10, "lot on earliest feasible day");
});

Deno.test("one 50 order arrives as dated 25 + 25 lots; the second lot is not a new PO", () => {
  const result = projectDailyCoverage(input({ opening_qty_by_material: { M1: 40 }, daily_demand: daily(4), policies: [policy({ order_multiple_qty_base: 50, delivery_lot_qty_base: 25 })] }));
  const first = result.advisory_buys[0];
  equal([first.sequence, first.recommended_po_qty_base, first.lots.map((l) => [l.plant_eta, l.qty_base])], [1, 50, [["2026-10-05", 25], ["2026-10-11", 25]]], "lots dated by need");
  equal(row(result, "2026-10-11").planned_lot_qty_base, 25, "second lot on its own date");
});

Deno.test("D3: Target/Critical are effective-dated per material", () => {
  const result = projectDailyCoverage(input({ opening_qty_by_material: { M1: 100 }, policies: [policy({ coverage_versions: [{ effective_from: "2026-10-15", target_days: 10, critical_days: 4 }] })] }));
  equal([row(result, "2026-10-14").target_days, row(result, "2026-10-15").target_days, row(result, "2026-10-15").critical_days], [5, 10, 4], "version applies from its date");
});

Deno.test("missing Target/Critical policy stays UNKNOWN even when current stock is positive", () => {
  equal(projectDailyCoverage(input({ policies: [] })).advisory_buys[0].status, "UNKNOWN_POLICY", "policy absence cannot become no-buy");
});

Deno.test("missing lead time gives one UNKNOWN_LEAD_TIME recommendation, no fabricated PO-by", () => {
  const result = projectDailyCoverage(input({ policies: [policy({ route_lead_time_days: null, configured_lead_time_days: null })] }));
  equal(result.advisory_buys.map((b) => [b.status, b.recommended_po_by]), [["UNKNOWN_LEAD_TIME", null]], "single unknown");
});

// ── Owner Method C rule 6 (2026-10-20): members' free stock — MOQ excess, arrivals — covers a group first ──
function groupInput(withGroups: boolean, extra: Partial<OptimizerProjectionInput> = {}): OptimizerProjectionInput {
  const groupRows = daily(2, "2026-10-12", "2026-10-21", "B").map((row) => ({ ...row, source_key: `G|${row.required_by}`, group_id: "G" }));
  return input({
    opening_qty_by_material: { A: 10, B: 0 },
    daily_demand: [...daily(1, "2026-10-01", "2026-10-31", "A"), ...groupRows],
    policies: [policy({ material_id: "A", vendor_moq_qty_base: 60 }), policy({ material_id: "B" })],
    groups: withGroups ? [{ group_id: "G", member_ids: ["A", "B"] }] : undefined,
    ...extra,
  });
}

Deno.test("Rule 6: another member's MOQ excess covers the group before the assigned member is bought", () => {
  const without = projectDailyCoverage(groupInput(false));
  equal(without.advisory_buys.filter((b) => b.material_id === "B" && b.status === "ADVISORY").length > 0, true, "old: group shortage always bought through B");
  const withRule = projectDailyCoverage(groupInput(true));
  const drawnFromA = withRule.rows.filter((r) => r.material_id === "A").reduce((s, r) => s + r.group_draw_qty_base, 0);
  equal(drawnFromA, 20, "A's 60 MOQ lot leaves excess above its Target; the whole group need (20) comes from it");
  equal(withRule.advisory_buys.filter((b) => b.material_id === "B").map((b) => b.status), ["NO_BUY"], "nothing bought through B");
  equal(withRule.risks.find((r) => r.material_id === "A")!.first_shortage_day, null, "A never runs short for its own use");
});

Deno.test("Rule 6: a member's free stock is only what is above Target days of its own demand", () => {
  // A has 12 on hand, own use 1/day, Target 5 → only what is above ~6 days of its own use is free.
  const result = projectDailyCoverage(groupInput(true, { opening_qty_by_material: { A: 12, B: 0 }, policies: [policy({ material_id: "A", route_lead_time_days: null, configured_lead_time_days: null }), policy({ material_id: "B" })] }));
  const firstGroupDay = result.rows.find((r) => r.material_id === "A" && r.day === "2026-10-12")!;
  equal(firstGroupDay.group_draw_qty_base, 0, "by Oct 12 A has only its protected stock left; group not served from it");
  equal(result.advisory_buys.some((b) => b.material_id === "B" && b.status === "ADVISORY"), true, "the rest is bought through B");
});

Deno.test("Rule 6: a confirmed arrival of a member can serve the group", () => {
  const result = projectDailyCoverage(groupInput(true, {
    policies: [policy({ material_id: "A" }), policy({ material_id: "B" })],
    confirmed_arrivals: [{ source_key: "csn", material_id: "A", eta_to_plant: "2026-10-05", qty_base: 50, lifecycle_kind: "IN_TRANSIT" }],
  }));
  equal(result.rows.filter((r) => r.material_id === "A").reduce((s, r) => s + r.group_draw_qty_base, 0), 20, "arrival on A covers the group");
  equal(result.advisory_buys.filter((b) => b.material_id === "B").map((b) => b.status), ["NO_BUY"], "no buy through B");
});

Deno.test("Rule 6: an evidence preference rotates only already-free stock", () => {
  const result = projectDailyCoverage(input({
    horizon_end: "2026-10-01", opening_qty_by_material: { A: 100, B: 100 },
    daily_demand: [{ source_key: "group", material_id: "B", group_id: "G", required_by: "2026-10-01", qty_base: 20 }],
    policies: [policy({ material_id: "A", target_days: 0, critical_days: 0 }), policy({ material_id: "B", target_days: 0, critical_days: 0 })],
    groups: [{ group_id: "G", member_ids: ["A", "B"], consumption_preference_by_material: { A: 1.2, B: 1 } }],
  }));
  equal([row(result, "2026-10-01", "A").group_draw_qty_base, row(result, "2026-10-01", "B").group_draw_qty_base], [20, 0], "economic preference selects A only after both balances are free");
});

Deno.test("P2: lot sized to Max days = Target + cycle, not just back to Target (no tiny daily lots)", () => {
  const result = projectDailyCoverage(input({ horizon_end: "2026-12-31", daily_demand: daily(1, "2026-10-01", "2026-12-31"), policies: [policy({ cycle_days: 20 })] }));
  const buys = result.advisory_buys.filter((b) => b.status === "ADVISORY" || b.status === "ADVISORY_LATE");
  // Target 5 + cycle 20 = 25 days of 1/day per lot → about one lot every 20 days, not one per day.
  if (buys.length > 5) throw new Error(`expected few lots, got ${buys.length}`);
  equal(buys[0].max_cover_days, 25, "max cover days carried on the buy");
  if (!(buys[0].recommended_po_qty_base! >= 20)) throw new Error(`lot should cover the cycle, got ${buys[0].recommended_po_qty_base}`);
});

Deno.test("P2: cheapest vendor in time is used; when it is too late a faster vendor bridges and is flagged", () => {
  const options = [
    { vendor_id: "IMPORT", lead_time_days: 40, moq_qty_base: null, order_multiple_qty_base: null, unit_cost: 100, cycle_days: 20 },
    { vendor_id: "DOMESTIC", lead_time_days: 3, moq_qty_base: null, order_multiple_qty_base: null, unit_cost: 130, cycle_days: 10 },
  ];
  const result = projectDailyCoverage(input({ horizon_end: "2027-01-31", daily_demand: daily(1, "2026-10-01", "2027-01-31"), policies: [policy({ vendor_options: options })] }));
  const buys = result.advisory_buys.filter((b) => b.status === "ADVISORY" || b.status === "ADVISORY_LATE");
  equal([buys[0].vendor_id, buys[0].bridge, buys[0].cheapest_vendor_id], ["DOMESTIC", true, "IMPORT"], "first need is too early for import → domestic bridge");
  const later = buys.find((b) => b.vendor_id === "IMPORT");
  if (!later) throw new Error("later lots must come from the cheaper import vendor once it can arrive in time");
  equal(later.bridge, false, "import lot is not a bridge");
});

Deno.test("P2: a fixed vendor MOQ is never broken — need 10, MOQ 25 → 25, and the next lot moves later", () => {
  const options = [{ vendor_id: "V", lead_time_days: 3, moq_qty_base: 25, order_multiple_qty_base: null, unit_cost: 10, cycle_days: 5 }];
  const result = projectDailyCoverage(input({ horizon_end: "2026-12-31", daily_demand: daily(1, "2026-10-01", "2026-12-31"), policies: [policy({ vendor_options: options })] }));
  const buys = result.advisory_buys.filter((b) => b.status === "ADVISORY" || b.status === "ADVISORY_LATE");
  for (const b of buys) if (b.recommended_po_qty_base! < 25) throw new Error(`lot below MOQ: ${b.recommended_po_qty_base}`);
  const gap = (Date.parse(`${buys[1].need_date}T00:00:00Z`) - Date.parse(`${buys[0].need_date}T00:00:00Z`)) / 86_400_000;
  if (gap < 20) throw new Error(`MOQ excess should push the next lot ~25 days later, got ${gap}`);
});

Deno.test("P4: a user-fixed lot is planned on its date and the engine only buys what is still needed", () => {
  const base = projectDailyCoverage(input({ horizon_end: "2026-11-30", daily_demand: daily(1, "2026-10-01", "2026-11-30"), policies: [policy({ cycle_days: 10 })] }));
  const withUser = projectDailyCoverage(input({ horizon_end: "2026-11-30", daily_demand: daily(1, "2026-10-01", "2026-11-30"), policies: [policy({ cycle_days: 10 })],
    manual_lots: [{ material_id: "M1", plant_eta: "2026-10-03", qty_base: 40 }] }));
  equal(row(withUser, "2026-10-03").planned_lot_qty_base, 40, "user lot sits on its date");
  const count = (r: ReturnType<typeof projectDailyCoverage>) => r.advisory_buys.filter((b) => b.status === "ADVISORY" || b.status === "ADVISORY_LATE").length;
  if (!(count(withUser) < count(base))) throw new Error(`engine should buy less after a user lot: ${count(withUser)} vs ${count(base)}`);
});
