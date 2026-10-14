import {
  buildEntryUomOptions,
  normalizeIsoDate,
  normalizePlanLine,
  normalizePlanMonth,
  parseMonthList,
  pivotPlanReport,
  rpcErrorCode,
  toBaseQty,
} from "./mts_customer_plan.logic.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEqual(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected: ${e}\n  actual:   ${a}`);
}

Deno.test("plan month normalisation", () => {
  assertEqual(normalizePlanMonth("2026-11"), "2026-11-01", "YYYY-MM");
  assertEqual(normalizePlanMonth("2026-11-17"), "2026-11-01", "any day maps to month start");
  assertEqual(normalizePlanMonth("2026-13"), null, "invalid month");
  assertEqual(normalizePlanMonth("2026-02-30"), null, "invalid day");
  assertEqual(normalizePlanMonth(""), null, "empty");
});

Deno.test("month list: unique, sorted, non-contiguous, invalid reported", () => {
  const { months, invalid } = parseMonthList("2026-02,2025-11,2026-10,2025-12,2026-01,2026-02,bad");
  assertEqual(months, ["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01", "2026-10-01"], "chronological unique");
  assertEqual(invalid, ["bad"], "invalid kept for error");
});

Deno.test("ISO dates are strict", () => {
  assertEqual(normalizeIsoDate("2026-11-05"), "2026-11-05", "valid");
  assertEqual(normalizeIsoDate("2026-11-31"), null, "impossible date");
  assertEqual(normalizeIsoDate("05-11-2026"), null, "wrong format");
});

Deno.test("entry units never invent a factor", () => {
  const options = buildEntryUomOptions("KG", [
    { from_uom_code: "BAG", to_uom_code: "KG", conversion_factor: 20, variable_conversion: false, active: true },
    { from_uom_code: "DRUM", to_uom_code: "KG", conversion_factor: null, variable_conversion: true, active: true },
    { from_uom_code: "CTN", to_uom_code: "KG", conversion_factor: 10, variable_conversion: false, active: false },
    { from_uom_code: "BOX", to_uom_code: "L", conversion_factor: 5, variable_conversion: false, active: true },
  ]);
  assertEqual(options.map((o) => o.uom_code), ["KG", "MT", "BAG"], "base + MT + fixed active conversion to base only");
  assertEqual(toBaseQty(2.5, "MT", options), 2500, "MT = 1000 KG");
  assertEqual(toBaseQty(3, "BAG", options), 60, "BAG factor");
  assertEqual(toBaseQty(3, "DRUM", options), null, "variable conversion not allowed");
  assertEqual(toBaseQty(-1, "KG", options), null, "negative rejected");
  const litre = buildEntryUomOptions("L", []);
  assertEqual(litre.map((o) => o.uom_code), ["L"], "no MT for a litre-based SKU");
});

Deno.test("plan line validation", () => {
  assertEqual(normalizePlanLine("ROLLING", { sku_material_id: "s", entered_qty: "" }).error, "MTS_PLAN_QTY_REQUIRED", "blank is not 0");
  assertEqual(normalizePlanLine("ROLLING", { sku_material_id: "s", entered_qty: 0 }).line?.entered_qty, 0, "0 is a real plan");
  assertEqual(normalizePlanLine("FINAL", { sku_material_id: "s", entered_qty: 5, entry_id: "x" }).line?.entry_id, null, "base types are keyed by SKU, not entry");
  assertEqual(normalizePlanLine("URGENT", { sku_material_id: "s", entered_qty: 5, urgent_mode: "EXTRA" }).error, "MTS_PLAN_URGENT_PERIOD_REQUIRED", "urgent needs a period");
  assertEqual(
    normalizePlanLine("URGENT", { sku_material_id: "s", entered_qty: 5, urgent_mode: "FROM_PLAN", urgent_from_date: "2026-11-10", urgent_to_date: "2026-11-02" }).error,
    "MTS_PLAN_URGENT_PERIOD_INVALID",
    "from after to",
  );
  const ok = normalizePlanLine("URGENT", { sku_material_id: "s", entered_qty: 5, urgent_mode: "from_plan", urgent_from_date: "2026-11-01", urgent_to_date: "2026-11-02" });
  assertEqual(ok.line?.urgent_mode, "FROM_PLAN", "mode normalised");
  assertEqual(normalizePlanLine("ADDITIONAL", { sku_material_id: "s", cancel: true }).error, "MTS_PLAN_ENTRY_REQUIRED_FOR_CANCEL", "add-on cancel needs entry");
  assert(normalizePlanLine("ROLLING", { sku_material_id: "s", cancel: true }).line?.cancel === true, "rolling cancel by SKU key");
});

Deno.test("report pivot keeps blank distinct from zero", () => {
  const pivot = pivotPlanReport(
    ["a", "b"],
    ["2026-10-01", "2026-11-01"],
    [
      { plan_month: "2026-10-01", sku_material_id: "a", effective_qty: 0, base_source: "FINAL", has_legacy_source: true },
      { plan_month: "2026-11-01", sku_material_id: "a", effective_qty: 12.3456789, base_source: "ROLLING", has_legacy_source: false },
    ],
  );
  assertEqual(pivot.get("a")?.["2026-10-01"], { qty: 0, base_source: "FINAL", legacy: true }, "entered zero");
  assertEqual(pivot.get("a")?.["2026-11-01"]?.qty, 12.345679, "rounded to 6 dp");
  assertEqual(pivot.get("b")?.["2026-10-01"], { qty: null, base_source: null, legacy: false }, "no plan = null");
});

Deno.test("rpc error codes are extracted", () => {
  assertEqual(rpcErrorCode("MTS_PLAN_URGENT_FROM_PLAN_EXCEEDS: SKU x"), "MTS_PLAN_URGENT_FROM_PLAN_EXCEEDS", "prefix code");
  assertEqual(rpcErrorCode("something else"), null, "unknown");
});
