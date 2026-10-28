import {
  arrivalPlanningCoverage,
  arrivalStatus,
  companySpare,
  locationTransfers,
  optimizeArrivalDate,
  poNumberOfReference,
  optimizeArrivalSet,
  rescheduleAdvice,
  buildForecastPlanLines,
  familyClosure,
  familyDayGrid,
  estimateBeyondPlanDays,
  forecastSkuMonth,
  forwardCoverDays,
  activeDemandCoverDays,
  prorataMaxDays,
  referenceMonths,
  type ForecastInputs,
} from "./mts_item_plan.logic.ts";
import { applyInboundReschedules, buildCalendar, type GroupMember, type InboundEvent } from "./mts_requirement.logic.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEqual(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`);
}
const near = (actual: number | null, expected: number, message: string) => {
  if (actual === null || Math.abs(actual - expected) > 0.01) throw new Error(`${message}: expected ${expected}, got ${actual}`);
};
const m = (material_id: string, group_id: string, active = true): GroupMember => ({ material_id, group_id, active });

Deno.test("familyClosure: material → its groups → all members → their other groups (owner 2026-10-20)", () => {
  const groups = new Map<string, GroupMember[]>([
    ["MHEC", [m("GABROSA", "MHEC"), m("TS", "MHEC"), m("COMBI", "MHEC")]],
    ["MHEC_PLC", [m("COMBI", "MHEC_PLC"), m("PLC2", "MHEC_PLC")]],
    ["RDP", [m("VAE", "RDP"), m("DA", "RDP")]],
    ["OLD", [m("GABROSA", "OLD", false), m("X", "OLD", false)]],
  ]);
  const family = familyClosure("GABROSA", groups);
  assertEqual(family.member_ids, ["COMBI", "GABROSA", "PLC2", "TS"], "transitive members; inactive membership ignored");
  assertEqual(family.group_ids, ["MHEC", "MHEC_PLC"], "groups reached");
  assert(family.is_family, "grouped item is a family");
  const solo = familyClosure("PULMIX", groups);
  assertEqual([solo.member_ids, solo.is_family], [["PULMIX"], false], "non-group item = itself, no family part");
});

Deno.test("forecast: ½ seasonal × trend + ½ last-3 plan; trend capped; uncovered month is no data", () => {
  const covered = new Set(["2025-02-01", "2025-07-01", "2025-08-01", "2025-09-01", "2026-07-01", "2026-08-01", "2026-09-01"]);
  const dispatch = new Map([
    ["S|2025-02-01", 10000],
    ["S|2025-07-01", 1000], ["S|2025-08-01", 1000], ["S|2025-09-01", 1000],
    ["S|2026-07-01", 1100], ["S|2026-08-01", 1100], ["S|2026-09-01", 1100],
  ]);
  const inputs: ForecastInputs = {
    dispatchKg: dispatch, coveredMonths: covered,
    planKg: new Map([["S|2026-07-01", 9000], ["S|2026-08-01", 9000], ["S|2026-09-01", 9000]]),
    plannedMonths: new Set(["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"]),
  };
  assertEqual(referenceMonths("2026-10-01"), ["2026-07-01", "2026-08-01", "2026-09-01"], "last 3 complete months");
  const f = forecastSkuMonth("S", "2026-02-01".replace("2026", "2026"), "2026-10-01", inputs);
  // Feb-2026 target month uses Feb-2025 (10000) × trend 1.1 = 11000; ½ 11000 + ½ 9000 = 10000.
  assert(f !== null, "forecast exists");
  near(f!.trend, 1.1, "trend = 1100 / 1000");
  near(f!.qty_kg, 10000, "owner example: (11000 + 9000) / 2");
  assertEqual(f!.basis, "SEASONAL_AND_PLAN", "basis");
  const capped = forecastSkuMonth("S", "2026-02-01", "2026-10-01", { ...inputs, dispatchKg: new Map([...dispatch, ["S|2026-07-01", 5000], ["S|2026-08-01", 5000], ["S|2026-09-01", 5000]]) });
  near(capped!.trend, 1.3, "trend capped at 1.3");
  const none = forecastSkuMonth("NEW", "2027-02-01", "2026-10-01", { ...inputs, coveredMonths: new Set(), plannedMonths: new Set() });
  assert(none === null, "no plan and no covered actuals → no forecast (never invented)");
  const notPlanned = forecastSkuMonth("NEW", "2027-02-01", "2026-10-01", { ...inputs, coveredMonths: new Set() });
  near(notPlanned!.qty_kg, 0, "company planned the reference months without this SKU → 0");
});

Deno.test("buildForecastPlanLines: a missing PO21 month is zero demand, never an implicit forecast or buy", () => {
  const inputs: ForecastInputs = {
    dispatchKg: new Map(), coveredMonths: new Set(),
    planKg: new Map([["S|2026-07-01", 300], ["S|2026-08-01", 300], ["S|2026-09-01", 300]]),
    plannedMonths: new Set(["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"]),
  };
  const result = buildForecastPlanLines(["S"], ["2026-10-01", "2026-11-01", "2026-12-01"], "2026-10-01", inputs, () => 20);
  assertEqual([result.forecastMonths, result.forecasts, result.lines], [[], [], []], "a missing PO21 month contributes zero demand");
});

Deno.test("forwardCoverDays: walks the coming days' use (owner example 60,000 → 23 days)", () => {
  const uses = [...Array(10).fill(2000), ...Array(30).fill(3000)];
  near(forwardCoverDays(60000, uses, 0), 23.33, "10 days at 2,000 + 13.33 at 3,000");
  assert(forwardCoverDays(100, [0, 0], 0) === null, "no use → null");
  near(forwardCoverDays(0, uses, 0), 0, "nothing → 0");
});

Deno.test("forwardCoverDays: exact depletion does not count later zero-demand calendar days", () => {
  near(forwardCoverDays(7, [1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1], 0), 7, "seven units cover exactly seven consuming days");
  near(forwardCoverDays(2, [1, 1, 0, 0, 1], 0), 2, "depleted stock stops before an idle stretch");
});

Deno.test("activeDemandCoverDays: a standalone grid does not turn a no-PO21 month into free coverage", () => {
  const uses = [10, 10, 10, 0, 0, 0, 0];
  near(activeDemandCoverDays(90, uses, 1), 9, "two remaining planned days plus seven days at the latest approved rate");
  const rows = uses.map((demand_qty_base, index) => ({
    material_id: "TOT", day: `D${index + 1}`, opening_qty_base: index === 0 ? 100 : 0,
    confirmed_arrival_qty_base: 0, planned_lot_qty_base: 0, demand_qty_base, group_draw_qty_base: 0, closing_qty_base: 0,
  }));
  const grid = familyDayGrid(uses.map((_, index) => `D${index + 1}`), rows, new Map(), { activeDemandCoverage: true });
  assertEqual([grid[0].max_days, grid[0].min_days], [9, 9], "PO22 table and Excel use active demand, not zero-demand calendar days");
  assertEqual(grid[0].prorata_max_days, 9, "the side audit column is closing divided by this row's pro-rata");
  assertEqual([grid[3].carry_forward_days, grid[3].next_demand_day], [4, null], "the no-demand carry-forward is shown separately, through the horizon");
});

Deno.test("activeDemandCoverDays: surplus after known NM demand uses the final approved rate", () => {
  // CMP005 shape: CM is 4/day and already-approved NM is 16/day.  After the
  // two NM rows, surplus must remain 16/day coverage, never return to 4/day.
  near(activeDemandCoverDays(40, [4, 4, 16, 16], 2), 2.5, "future approved rate controls surplus coverage");
});

Deno.test("Prorata Max Days is deliberately separate from forward Max Days", () => {
  // 600 KG after today's 6.871 KG pro-rata looks like 87 days locally.  A
  // higher approved rate in the following month makes the engine's forward
  // coverage shorter; both values should remain visible rather than conflated.
  assertEqual(prorataMaxDays(600, 6.871), 87, "local pro-rata audit value");
  near(forwardCoverDays(600, [...Array(8).fill(6.871), ...Array(40).fill(15.543)], 0), 43.07, "forward value follows the next month's approved pro-rata");
  assertEqual(prorataMaxDays(600, 0), null, "no pro-rata means no local-day denominator");
});

Deno.test("familyDayGrid: sums members, adds unmet group demand to use and carries it", () => {
  const rows = [
    { material_id: "A", day: "D1", opening_qty_base: 100, confirmed_arrival_qty_base: 0, planned_lot_qty_base: 0, demand_qty_base: 10, group_draw_qty_base: 0, closing_qty_base: 90 },
    { material_id: "B", day: "D1", opening_qty_base: 50, confirmed_arrival_qty_base: 20, planned_lot_qty_base: 0, demand_qty_base: 5, group_draw_qty_base: 5, closing_qty_base: 65 },
    { material_id: "A", day: "D2", opening_qty_base: 90, confirmed_arrival_qty_base: 0, planned_lot_qty_base: 0, demand_qty_base: 10, group_draw_qty_base: 0, closing_qty_base: 80 },
    { material_id: "B", day: "D2", opening_qty_base: 65, confirmed_arrival_qty_base: 0, planned_lot_qty_base: 0, demand_qty_base: 5, group_draw_qty_base: 0, closing_qty_base: 60 },
  ];
  const grid = familyDayGrid(["D1", "D2"], rows, new Map([["D1", 7]]));
  assertEqual(grid.map((g) => [g.opening, g.arrivals, g.use, g.closing, g.min_stock]), [[150, 20, 22, 148, 128], [148, 0, 15, 133, 133]], "family = Σ members − carried unmet group demand");
});

Deno.test("applyInboundReschedules: only keyed (not-shipped) pieces move; cleared = source date", () => {
  const events: InboundEvent[] = [
    { material_id: "A", qty: 5, date: "2026-11-10", kind: "PO_REMAINDER", date_source: "CSN_ETA_TO_PLANT", reference: "x", reschedule_key: "CSN|c1" },
    { material_id: "A", qty: 5, date: "2026-11-01", kind: "IN_TRANSIT", date_source: "CSN_ETA_TO_PLANT", reference: "y", csn_id: "c2" },
  ];
  const moved = applyInboundReschedules(events, new Map([["CSN|c1", "2026-11-05"], ["CSN|c2", "2026-10-25"]]));
  assertEqual(moved.map((e) => [e.date, e.original_date ?? null, e.date_source]), [["2026-11-05", "2026-11-10", "PLANNING_RESCHEDULE"], ["2026-11-01", null, "CSN_ETA_TO_PLANT"]], "in-transit never moves");
  assertEqual(applyInboundReschedules(events, new Map([["CSN|c1", null]]))[0].date, "2026-11-10", "cleared");
});

Deno.test("buildCalendar extra months: default unchanged, 6-month horizon when asked", () => {
  const base = buildCalendar("2026-10-01", "2026-10-20")!;
  assertEqual([base.months, base.horizonEnd], [["2026-10-01", "2026-11-01"], "2026-11-30"], "default CM + NM");
  const six = buildCalendar("2026-10-01", "2026-10-20", 4)!;
  assertEqual([six.months.length, six.horizonEnd, six.nmEnd], [6, "2027-03-31", "2026-11-30"], "CM + NM + 4");
  assertEqual(arrivalStatus("PO_REMAINDER", "BULK_CALL_OFF"), "BULK", "bulk label");
  assertEqual(arrivalStatus("POSTED_GR", "GRN_POSTED_ON_CC_DATE"), "ACTUAL_GR", "same-day posted GR is clearly marked as an actual plant arrival");
  assertEqual(
    [
      arrivalPlanningCoverage("PO_REMAINDER", "2026-10-31", "2026-10-26").state,
      arrivalPlanningCoverage("IN_TRANSIT", "2026-10-31", "2026-10-26").state,
      arrivalPlanningCoverage("PO_REMAINDER", null, "2026-10-26").state,
    ],
    ["COVERAGE", "COVERAGE", "RISK_ONLY"],
    "a dated ORD and TRN both cover planning; only ETA-less ORD is risk-only",
  );
});

Deno.test("P2 rescheduleAdvice: advance when needed earlier, postpone when not needed, quiet when on time", () => {
  const days = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse("2026-11-01T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10));
  // 100 stock, use 10/day, Target 3 days; arrival 100 on day 20.
  const mk = (eta: string) => {
    let bal = 100;
    return days(40).map((day) => { if (day === eta) bal += 100; bal -= 10; return { day, closing: bal, use: 10, target_days: 3 }; });
  };
  const late = rescheduleAdvice(mk("2026-11-20"), "2026-11-20", 100)!;
  assert(late.shift_days < 0, `should advance, got ${JSON.stringify(late)}`);
  assertEqual(late.suggested_eta, "2026-11-07", "cover without it falls to 3 days on day 7");
  const early = rescheduleAdvice(mk("2026-11-02"), "2026-11-02", 100)!;
  assert(early.shift_days > 0, "should postpone");
  assert(rescheduleAdvice(mk("2026-11-07"), "2026-11-07", 100) === null, "on time → no advice");
});

Deno.test("P ↔ P transfers (owner 2026-10-22): packing locations balance among themselves, never with R", () => {
  assertEqual(locationTransfers([
    { location: "P001", need: 0, stock: 300 }, { location: "P002", need: 200, stock: 0 }, { location: "R001", need: 0, stock: 1000 },
  ]), [{ from: "P001", to: "P002", qty: 200 }], "P002 filled from P001, not from R001");
});

Deno.test("P2 locationTransfers: shop floor S00n counts with R00n; short store filled from spare store, both ways", () => {
  const t = locationTransfers([
    { location: "R001", need: 100, stock: 400 }, { location: "S001", need: 50, stock: 0 },
    { location: "R002", need: 300, stock: 100 }, { location: "S002", need: 0, stock: 20 },
    { location: "F001", need: 0, stock: 999 },
  ]);
  assertEqual(t, [{ from: "R001", to: "R002", qty: 180 }], "R002 short 180, R001 spare 250");
  assertEqual(locationTransfers([{ location: "R001", need: 500, stock: 0 }, { location: "R002", need: 0, stock: 200 }]), [{ from: "R002", to: "R001", qty: 200 }], "other direction, capped by spare");
});

Deno.test("P2 companySpare: never takes the sender below its own Target", () => {
  const rows = [{ closing: 1000, use: 10, target_days: 30 }, { closing: 800, use: 10, target_days: 30 }];
  assertEqual(companySpare(rows), 500, "min closing 800 − 30 days × 10");
  assertEqual(companySpare([{ closing: 100, use: 10, target_days: 30 }]), 0, "no spare");
});

Deno.test("Arrival optimizer: tries every day — advance when it removes risk, postpone when safe, keep when best", () => {
  const days = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse("2026-11-01T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10));
  // 100 stock, use 10/day, Target 3 / Critical 1 days; one arrival of 100.
  const mk = (eta: string) => {
    let bal = 100;
    return days(40).map((day) => { if (day === eta) bal += 100; bal -= 10; return { day, closing: bal, use: 10, target_days: 3, critical_days: 1 }; });
  };
  const late = optimizeArrivalDate(mk("2026-11-20"), "2026-11-20", 100)!;
  assert(late.shift_days < 0, `should prepone, got ${JSON.stringify(late)}`);
  assert(late.current.shortage_days > 0 && late.best.shortage_days < late.current.shortage_days, "fewer stock-out days");
  assert(late.best.days_below_target <= late.current.days_below_target, "not more days below Target");
  assert(late.reason.startsWith("Prepone"), late.reason);
  const early = optimizeArrivalDate(mk("2026-11-02"), "2026-11-02", 100)!;
  assert(early.shift_days > 0, `should postpone, got ${JSON.stringify(early)}`);
  assertEqual([early.best.shortage_days, early.best.days_below_critical], [early.current.shortage_days, early.current.days_below_critical], "postpone never adds risk");
  const best = optimizeArrivalDate(mk(late.best.eta), late.best.eta, 100)!;
  assertEqual(best.shift_days, 0, "already optimal → stays");
  assert(optimizeArrivalDate([], "2026-11-01", 100) === null && optimizeArrivalDate(mk("2026-11-05"), null, 100) === null, "no data → null");
  // Min / Max days on the arrival day = cover without / with the piece.
  assert(late.best.max_days! > late.best.min_days!, "max > min on arrival day");
});

Deno.test("Arrival optimizer: a piece beyond the horizon is not preponed without a gain; two pieces never fix the same gap", () => {
  const days = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse("2026-11-01T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10));
  let bal = 1000;
  const safe = days(30).map((day) => { bal -= 10; return { day, closing: bal, use: 10, target_days: 3, critical_days: 1 }; });
  assertEqual(optimizeArrivalDate(safe, "2027-02-01", 100)!.shift_days, 0, "no gain → stays");
  // 100 stock, two pieces of 100 both on day 25: the first goes to the first gap, the second later.
  const mk = () => { let b = 100; return days(40).map((day) => { if (day === "2026-11-25") b += 200; b -= 10; return { day, closing: b, use: 10, target_days: 3, critical_days: 1 }; }); };
  const set = optimizeArrivalSet(mk(), [{ key: "A", eta: "2026-11-25", qty: 100 }, { key: "B", eta: "2026-11-25", qty: 100 }]);
  const a = set.get("A")!; const b = set.get("B")!;
  assert(a.best.eta !== b.best.eta, `different dates, got ${a.best.eta} / ${b.best.eta}`);
  assert(b.best.eta > a.best.eta, "second piece covers the later gap");
  assertEqual(b.current.eta, "2026-11-25", "current = today's date");
});

Deno.test("poNumberOfReference: PO numbers with slashes, line, CSN suffix; none for STO", () => {
  assertEqual(poNumberOfReference("PO ASC/PO112/2026-27/1 · CSN 3000000225 (TRN)"), "ASC/PO112/2026-27", "slashed number");
  assertEqual(poNumberOfReference("PO ASC/PO207/2026-27/1"), "ASC/PO207/2026-27", "no suffix");
  assertEqual(poNumberOfReference("PO 9300000123/2 (BULK)"), "9300000123", "bulk");
  assertEqual(poNumberOfReference("STO 123 · CSN 9"), null, "not a PO");
});

Deno.test("owner 2026-10-28: stock that outlasts a PO21 plan which ended early is 'beyond plan' (null), not hundreds of days", () => {
  // 100 days of horizon; demand 10/day for the first 60 days only, none in the last 40.
  const uses = Array.from({ length: 100 }, (_, i) => (i < 60 ? 10 : 0));
  assert(forwardCoverDays(1000, uses, 0) === null, "1,000 outlasts the 600 planned: beyond plan");
  near(forwardCoverDays(300, uses, 0), 30, "300 covers 30 planned days and runs out inside the plan");
  assert(activeDemandCoverDays(1000, uses, 0) === null, "standalone grid: beyond plan too");
  // A plan that runs to the horizon end keeps the old extrapolation.
  const running = Array.from({ length: 100 }, () => 10);
  near(forwardCoverDays(1500, running, 0) as number, 150, "plan to the end: extrapolated at the average");
});

Deno.test("owner 2026-10-28: stock that outlasts the plan gets an estimate at the plan's average use, with no zero-demand days counted", () => {
  const uses = Array.from({ length: 100 }, (_, i) => (i < 60 ? 10 : 0));
  near(estimateBeyondPlanDays(1000, uses, 0) as number, 100, "600 planned days-worth (60 d) + 400 at 10/day = 100 d");
  assert(estimateBeyondPlanDays(0, uses, 0) === null, "no stock, no estimate");
  const grid = familyDayGrid(["D1", "D2", "D3"], [], new Map());
  assert(grid.every((g) => g.max_days_est === null), "nothing outlasts an empty plan");
});
