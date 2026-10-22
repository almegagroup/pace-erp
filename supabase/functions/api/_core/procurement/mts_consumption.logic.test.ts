import { allocateDynamicConsumption, rankConsumptionCandidates, type ConsumptionCandidate } from "./mts_consumption.logic.ts";

const equal = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
};
const ok = (value: unknown, message: string): asserts value => { if (!value) throw new Error(message); };
const c = (material_id: string, free_physical_qty: number, extra: Partial<ConsumptionCandidate> = {}): ConsumptionCandidate => ({ material_id, free_physical_qty, protected_qty: 0, eligible: true, ...extra });
const allocations = (rows: ConsumptionCandidate[], qty: number) => allocateDynamicConsumption(rows, qty).choices.map((x) => [x.material_id, x.allocation_qty, x.dynamic_ratio]);

// These numeric cases are the owner-requested PO22 acceptance set.  They test
// the evidence helper; the existing requirement/projection suites separately
// prove company scope, narrow-group ordering, MOQ, arrivals and Store lineage.
Deno.test("1 two interchangeable members with unequal stock: actual ratio follows free stock", () => {
  equal(allocations([c("A", 80), c("B", 20)], 100), [["A", 80, 0.8], ["B", 20, 0.2]], "80:20 consumption");
});
Deno.test("2 high stock versus low stock: never draws more than physical stock", () => {
  equal(allocations([c("A", 100), c("B", 5)], 60), [["A", 60, 1], ["B", 0, 0]], "high free stock covers demand");
});
Deno.test("3 exclusive coverage is hard-protected before any group ratio", () => {
  const result = allocateDynamicConsumption([c("A", 100, { protected_qty: 70 })], 50);
  equal([result.choices[0].executable_free_qty, result.choices[0].allocation_qty, result.uncovered_qty], [30, 30, 20], "protected 70 remains untouched");
});
Deno.test("4 narrow-group candidates can be supplied alone without broad-member leakage", () => {
  equal(allocations([c("VINNAPAS", 30), c("VAE", 20)], 50), [["VINNAPAS", 30, 0.6], ["VAE", 20, 0.4]], "only narrow candidates are considered");
});
Deno.test("5 a new RP-4099 confirmed arrival changes the deterministic preference", () => {
  const before = rankConsumptionCandidates([c("RP-4099", 30, { replenishment_state: "UNAVAILABLE" }), c("ELOTEX", 30, { replenishment_state: "CONFIRMED" })]);
  const after = rankConsumptionCandidates([c("RP-4099", 30, { replenishment_state: "CONFIRMED", confirmed_future_qty: 50 }), c("ELOTEX", 30, { replenishment_state: "UNAVAILABLE" })]);
  equal([before[0].material_id, after[0].material_id], ["ELOTEX", "RP-4099"], "arrival changes preference");
});
Deno.test("6 RP-4099 future supply unavailable: preserve non-excess stock", () => {
  equal(rankConsumptionCandidates([c("RP-4099", 50, { replenishment_state: "UNAVAILABLE" }), c("ELOTEX", 50, { replenishment_state: "CONFIRMED" })])[0].material_id, "ELOTEX", "replenishable material first");
});
Deno.test("7 uncertain supplier ETA remains UNKNOWN, never an arrival guarantee", () => {
  const row = rankConsumptionCandidates([c("A", 20, { replenishment_state: "UNKNOWN", unknown_eta_qty: 100 })])[0];
  equal([row.future_supply_state, row.unknowns.includes("future ETA")], ["UNKNOWN", true], "unknown ETA disclosed");
});
Deno.test("8 paid versus unpaid inventory is labelled without a sunk-cost fallacy", () => {
  const rows = rankConsumptionCandidates([c("PAID", 10, { cash_state: "PAID" }), c("PAYABLE", 10, { cash_state: "PAYABLE" })]);
  ok(rows.find((x) => x.material_id === "PAID")!.reasons.some((x) => x.includes("sunk cash")), "paid reason");
  ok(rows.find((x) => x.material_id === "PAYABLE")!.reasons.some((x) => x.includes("current commitment")), "payable reason");
});
Deno.test("9 shorter vendor credit creates only a bounded cash-avoidance preference", () => {
  const rows = rankConsumptionCandidates([c("SHORT", 20, { vendor_credit_days: 0 }), c("LONG", 20, { vendor_credit_days: 60 })]);
  equal(rows[0].material_id, "SHORT", "short-credit replenishment deferred first");
});
Deno.test("10 working-capital valuation is a tiebreaker, not a safety override", () => {
  const rows = rankConsumptionCandidates([c("HIGH", 10, { unit_value_inr: 90_000 }), c("LOW", 10, { unit_value_inr: 100 })]);
  equal(rows[0].material_id, "HIGH", "higher eligible value rotates first");
});
Deno.test("11 high-cost material with little free stock cannot be over-consumed", () => {
  equal(allocateDynamicConsumption([c("HIGH", 2, { unit_value_inr: 90_000 }), c("LOW", 100)], 20).choices.find((x) => x.material_id === "HIGH")!.allocation_qty, 2, "only two physical units");
});
Deno.test("12 slow-moving genuine excess receives a rotation preference", () => {
  equal(rankConsumptionCandidates([c("IDLE", 50, { slow_moving_excess_qty: 40, inventory_age_days: 365 }), c("FRESH", 50, { replenishment_state: "CONFIRMED" })])[0].material_id, "IDLE", "old excess first within feasibility");
});
Deno.test("13 future arrivals are projected evidence, not executable current stock", () => {
  const result = allocateDynamicConsumption([c("A", 10, { confirmed_future_qty: 90, replenishment_state: "CONFIRMED" })], 50);
  equal([result.choices[0].allocation_qty, result.uncovered_qty], [10, 40], "future 90 is not drawn now");
});
Deno.test("14 a small first lot leaves an explicit later gap", () => {
  const result = allocateDynamicConsumption([c("A", 25)], 100);
  equal(result.uncovered_qty, 75, "short first lot cannot hide future shortage");
});
Deno.test("15 MOQ/lot constraints remain outside consumption and do not invent stock", () => {
  equal(allocateDynamicConsumption([c("A", 0, { confirmed_future_qty: 500 })], 30).uncovered_qty, 30, "proposed MOQ is not physical stock");
});
Deno.test("16 under-target emergency becomes an explicit uncovered exception", () => {
  equal(allocateDynamicConsumption([c("A", 5, { protected_qty: 5 })], 5).uncovered_qty, 5, "protected-only stock is not silently borrowed");
});
Deno.test("17 no group purchase signal while eligible physical surplus covers the demand", () => {
  equal(allocateDynamicConsumption([c("A", 40), c("B", 20)], 55).uncovered_qty, 0, "surplus covers before buy");
});
Deno.test("18 overdue inbound is not double counted as current physical stock", () => {
  const result = allocateDynamicConsumption([c("A", 15, { confirmed_future_qty: 15, replenishment_state: "CONFIRMED" })], 25);
  equal([result.choices[0].allocation_qty, result.uncovered_qty], [15, 10], "same 15 remains projected only");
});
Deno.test("19 P-location/non-eligible stock is excluded from executable consumption", () => {
  const result = allocateDynamicConsumption([c("P001", 100, { eligible: false }), c("R001", 10)], 20);
  equal([result.choices.find((x) => x.material_id === "P001")!.allocation_qty, result.uncovered_qty], [0, 10], "no location-policy bypass");
});
Deno.test("20 Store-style same-run consumption equals the reported ratio quantities", () => {
  const result = allocateDynamicConsumption([c("A", 30), c("B", 10)], 40);
  equal(result.choices.reduce((sum, row) => sum + row.allocation_qty, 0), 40, "same-run allocation conserves demand");
  equal(result.choices.reduce((sum, row) => sum + row.dynamic_ratio, 0), 1, "ratios sum to one");
});
