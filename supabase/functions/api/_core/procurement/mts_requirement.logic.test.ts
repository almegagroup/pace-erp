/*
 * PO22 Requirement engine — unit tests (no database).
 * Brief test numbers are noted as [Tn]. Tests that belong to other layers:
 *   [T1]  company isolation          → handler (assertCompanyScope + per-company ACL) and
 *                                      supabase/tests/erp_planning_material_requirement_policy.test.sql P4
 *   [T18] policy edit + revision      → DB test P1–P3 (+ effectivePolicy below)
 *   [T20] per-company policies        → DB test P4
 *   [T22] Excel export parity         → frontend exports the grid's own filtered rows/columns
 */
import {
  addDays,
  allocateDemand,
  bucketInbound,
  buildCalendar,
  buildRequirementRows,
  buildToBaseFactors,
  canonicalJson,
  computeLeadTime,
  computeMaterialMetrics,
  consumptionFromConsBucket,
  coverageDays,
  effectivePlanAt,
  effectivePolicy,
  explodeDemand,
  type ExplosionInput,
  type MaterialInfo,
  moqInBase,
  nmRequiredDays,
  partitionPoLineInbound,
  type PlanLineVersion,
  type PolicyRow,
  type RequirementInput,
  resolveUsePrimary,
  type DemandRecord,
  skuDailyContributions,
  skuDailyDemand,
  toMaterialBase,
  type Warning,
} from "./mts_requirement.logic.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEqual(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected: ${e}\n  actual:   ${a}`);
}
function near(actual: number | null | undefined, expected: number, message: string, tolerance = 0.001) {
  if (actual === null || actual === undefined || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}
function sum(map: Map<string, number> | undefined, from = "0000", to = "9999"): number {
  let total = 0;
  for (const [day, qty] of map ?? []) if (day >= from && day <= to) total += qty;
  return total;
}

// ── fixture ───────────────────────────────────────────────────────────────
let seq = 0;
function line(partial: Partial<PlanLineVersion>): PlanLineVersion {
  seq += 1;
  return {
    source_id: partial.source_id,
    entry_id: partial.entry_id ?? `e${seq}`,
    version_no: partial.version_no ?? 1,
    plan_month: partial.plan_month ?? "2026-11-01",
    plan_type: partial.plan_type ?? "ROLLING",
    urgent_mode: partial.urgent_mode ?? null,
    urgent_from_date: partial.urgent_from_date ?? null,
    urgent_to_date: partial.urgent_to_date ?? null,
    sku_material_id: partial.sku_material_id ?? "SKU1",
    base_qty: partial.base_qty ?? 0,
    is_cancelled: partial.is_cancelled ?? false,
    created_at: partial.created_at ?? "2026-10-01T00:00:00Z",
  };
}
function material(id: string, type: string, base = "KG", conversions: Record<string, number> = {}): MaterialInfo {
  return { material_id: id, material_type: type, base_uom_code: base, status: "ACTIVE", to_base_factors: conversions };
}

/** Prodshade P1 (SKU1 20 KG bag), stroke S1 = RM-A 60% (fixed, R1) + RM group G1 40% (primary RM-B, member RM-C, R1). */
function baseInput(overrides: Partial<ExplosionInput> = {}): ExplosionInput {
  const calendar = buildCalendar("2026-11-01", "2026-11-01")!;
  return {
    calendar,
    effective: [],
    skus: new Map([["SKU1", { sku_material_id: "SKU1", prodshade_material_id: "P1", base_uom_code: "KG", kg_per_base_unit: 1 }]]),
    currentStrokeByProdshade: new Map([["P1", "S1"]]),
    strokes: new Map([
      ["S1", { stroke_master_id: "S1", stroke_number: "0001", prodshade_material_id: "P1", lines: [
        { stroke_line_id: "L1", material_id: "RM-A", dosage_pct: 60, material_group_id: null, storage_location_id: "R1", display_order: 1 },
        { stroke_line_id: "L2", material_id: "RM-B", dosage_pct: 40, material_group_id: "G1", storage_location_id: "R1", display_order: 2 },
      ] }],
      ["S2", { stroke_master_id: "S2", stroke_number: "0002", prodshade_material_id: "P1", lines: [
        { stroke_line_id: "L3", material_id: "RM-A", dosage_pct: 100, material_group_id: null, storage_location_id: "R1", display_order: 1 },
      ] }],
    ]),
    strokeSettings: new Map(),
    primaryDecisions: [],
    groupMembers: new Map([["G1", [{ material_id: "RM-B", active: true }, { material_id: "RM-C", active: true }]]]),
    packBoms: new Map([["SKU1", { pack_bom_id: "B1", sfg_qty: 20, output_qty: 1, output_uom_code: "BAG", inputs: [
      { material_id: "PM-BAG", qty: 1, uom_code: "NOS", storage_location_id: "P1LOC", material_group_id: null },
    ] }]]),
    materials: new Map([
      ["RM-A", material("RM-A", "RM")], ["RM-B", material("RM-B", "RM")], ["RM-C", material("RM-C", "RM")],
      ["PM-BAG", material("PM-BAG", "PM", "NOS")],
    ]),
    prodshadeLabels: new Map([["P1", "Prodshade One"]]),
    ...overrides,
  };
}
function effectiveFor(lines: PlanLineVersion[]) {
  return effectivePlanAt(lines, null);
}

// ── tests ─────────────────────────────────────────────────────────────────
Deno.test("calendar: CM days left inclusive, month end, year rollover [T16]", () => {
  const nov = buildCalendar("2026-11-01", "2026-11-17")!;
  assertEqual([nov.cmDaysInMonth, nov.cmDaysLeft, nov.cmDaysElapsed, nov.nmStart, nov.nmDaysInMonth], [30, 14, 16, "2026-12-01", 31], "mid-month");
  const dec = buildCalendar("2026-12-01", "2026-12-31")!;
  assertEqual([dec.cmDaysLeft, dec.nmStart, dec.nmEnd, dec.nmDaysInMonth], [1, "2027-01-01", "2027-01-31", 31], "last day + year rollover");
  const feb = buildCalendar("2028-01-01", "2028-01-31")!;
  assertEqual(feb.nmDaysInMonth, 29, "leap February as NM");
  assertEqual(buildCalendar("2026-11-01", "2026-12-01"), null, "as-of outside the plan month is rejected");
  assertEqual(addDays("2026-12-31", 1), "2027-01-01", "addDays rollover");
});

Deno.test("effective plan: Final replaces Rolling, Additional + Extra add, From Plan never adds; as-of version", () => {
  const lines = [
    line({ entry_id: "r", plan_type: "ROLLING", base_qty: 100, created_at: "2026-10-01T00:00:00Z" }),
    line({ entry_id: "f", plan_type: "FINAL", base_qty: 300, created_at: "2026-10-05T00:00:00Z" }),
    line({ entry_id: "f", version_no: 2, plan_type: "FINAL", base_qty: 310, created_at: "2026-10-06T00:00:00Z" }),
    line({ entry_id: "a", plan_type: "ADDITIONAL", base_qty: 20, created_at: "2026-10-07T00:00:00Z" }),
    line({ entry_id: "x", plan_type: "URGENT", urgent_mode: "EXTRA", urgent_from_date: "2026-11-03", urgent_to_date: "2026-11-04", base_qty: 10, created_at: "2026-10-08T00:00:00Z" }),
    line({ entry_id: "p", plan_type: "URGENT", urgent_mode: "FROM_PLAN", urgent_from_date: "2026-11-01", urgent_to_date: "2026-11-02", base_qty: 50, created_at: "2026-10-08T00:00:00Z" }),
    line({ entry_id: "c", plan_type: "ADDITIONAL", base_qty: 999, is_cancelled: true, created_at: "2026-10-09T00:00:00Z" }),
  ];
  const [now] = effectivePlanAt(lines, null);
  assertEqual([now.base_source, now.base_qty, now.additional_qty, now.effective_qty], ["FINAL", 310, 20, 340], "current plan");
  const [then] = effectivePlanAt(lines, "2026-10-02T00:00:00Z");
  assertEqual([then.base_source, then.effective_qty], ["ROLLING", 100], "plan as it stood on 2 Oct (version reproducibility)");
});

Deno.test("SKU day demand: pro-rata + Urgent windows, month total kept", () => {
  const [entry] = effectiveFor([
    line({ plan_type: "FINAL", base_qty: 300 }),
    line({ plan_type: "URGENT", urgent_mode: "FROM_PLAN", urgent_from_date: "2026-11-01", urgent_to_date: "2026-11-05", base_qty: 50 }),
    line({ plan_type: "URGENT", urgent_mode: "EXTRA", urgent_from_date: "2026-11-10", urgent_to_date: "2026-11-11", base_qty: 20 }),
  ]);
  const warnings: Warning[] = [];
  const daily = skuDailyDemand(entry, warnings);
  near(sum(daily), 320, "month total = Final + Extra (From Plan only re-phases)");
  near(daily.get("2026-11-01")!, 250 / 30 + 10, "From Plan window day");
  near(daily.get("2026-11-10")!, 250 / 30 + 10, "Extra window day");
  near(daily.get("2026-11-20")!, 250 / 30, "ordinary day");
  assertEqual(warnings.length, 0, "no warnings");
});

Deno.test("RM explosion: multiple stroke periods in one month [T2]", () => {
  const input = baseInput({
    effective: effectiveFor([line({ plan_type: "FINAL", base_qty: 3000 })]),
    strokeSettings: new Map([["2026-11-01|P1", [
      { stroke_master_id: "S1", period_from: "2026-11-01", period_to: "2026-11-10", planned_base_qty: null },
      { stroke_master_id: "S2", period_from: "2026-11-11", period_to: "2026-11-30", planned_base_qty: null },
    ]]]),
  });
  const result = explodeDemand(input);
  const rmA = result.records.filter((r) => r.candidates[0] === "RM-A");
  // 100 KG/day. Days 1–10 on S1 → 60 KG/day RM-A; days 11–30 on S2 → 100 KG/day RM-A.
  near(rmA.filter((r) => r.day <= "2026-11-10").reduce((s, r) => s + r.qty, 0), 600, "S1 period RM-A");
  near(rmA.filter((r) => r.day > "2026-11-10").reduce((s, r) => s + r.qty, 0), 2000, "S2 period RM-A");
  near(result.records.filter((r) => r.pool_key === "RM|L2").reduce((s, r) => s + r.qty, 0), 400, "group line only on S1 days");
});

Deno.test("Stroke period planned quantity overrides pro-rata, month total preserved", () => {
  const input = baseInput({
    effective: effectiveFor([line({ plan_type: "FINAL", base_qty: 3000 })]),
    strokeSettings: new Map([["2026-11-01|P1", [
      { stroke_master_id: "S1", period_from: "2026-11-01", period_to: "2026-11-10", planned_base_qty: 2000 },
      { stroke_master_id: "S2", period_from: "2026-11-11", period_to: "2026-11-30", planned_base_qty: null },
    ]]]),
  });
  const result = explodeDemand(input);
  near(sum(result.prodshadeDaily.get("P1")), 3000, "Prodshade month total unchanged");
  near(sum(result.prodshadeDaily.get("P1"), "2026-11-01", "2026-11-10"), 2000, "override period");
});

Deno.test("Use Primary Yes / No per Stroke × group, carried forward [T3]", () => {
  const decisions = [
    { stroke_master_id: "S1", material_group_id: "G1", effective_month: "2026-10-01", use_primary: false },
    { stroke_master_id: "S1", material_group_id: "G1", effective_month: "2026-12-01", use_primary: true },
    { stroke_master_id: "S9", material_group_id: "G1", effective_month: "2026-01-01", use_primary: false },
  ];
  assertEqual(resolveUsePrimary(decisions, "S1", "G1", "2026-11-01"), false, "Oct No carries into Nov");
  assertEqual(resolveUsePrimary(decisions, "S1", "G1", "2026-12-01"), true, "Dec Yes");
  assertEqual(resolveUsePrimary(decisions, "S2", "G1", "2026-11-01"), true, "other stroke defaults Yes");
  const noPrimary = explodeDemand(baseInput({ effective: effectiveFor([line({ plan_type: "FINAL", base_qty: 300 })]), primaryDecisions: decisions }));
  const pool = noPrimary.records.find((r) => r.pool_key === "RM|L2")!;
  assertEqual([pool.use_primary, pool.candidates], [false, ["RM-C"]], "No excludes the primary");
  const yesPrimary = explodeDemand(baseInput({ effective: effectiveFor([line({ plan_type: "FINAL", base_qty: 300 })]) }));
  assertEqual(yesPrimary.records.find((r) => r.pool_key === "RM|L2")!.candidates, ["RM-B", "RM-C"], "Yes = primary first, then members");
});

Deno.test("Group pool: demand allocated once, never copied to every member [T5]", () => {
  const input = baseInput({ effective: effectiveFor([line({ plan_type: "FINAL", base_qty: 3000 })]) });
  const exploded = explodeDemand(input);
  const alloc = allocateDemand(exploded.records, input.calendar, [
    { material_id: "RM-C", storage_location_id: "R1", stock_type_code: "UNRESTRICTED", qty: 500 },
  ], [], true);
  const b = sum(alloc.dailyByMaterial.get("RM-B"));
  const c = sum(alloc.dailyByMaterial.get("RM-C"));
  near(b + c, 1200, "B + C = the group's 40% of 3000, not 2 × 1200");
  near(c, 500, "member stock used first when the primary has none (production order)");
  near(b, 700, "shortfall attributed once to the procurement target (primary)");
});

Deno.test("One material in several Prodshades and lines: stock counted once [T4][T5]", () => {
  const input = baseInput({
    effective: effectiveFor([
      line({ plan_type: "FINAL", base_qty: 300, sku_material_id: "SKU1" }),
      line({ plan_type: "FINAL", base_qty: 300, sku_material_id: "SKU2" }),
    ]),
    skus: new Map([
      ["SKU1", { sku_material_id: "SKU1", prodshade_material_id: "P1", base_uom_code: "KG", kg_per_base_unit: 1 }],
      ["SKU2", { sku_material_id: "SKU2", prodshade_material_id: "P2", base_uom_code: "KG", kg_per_base_unit: 1 }],
    ]),
    currentStrokeByProdshade: new Map([["P1", "S1"], ["P2", "S2"]]),
    packBoms: new Map([
      ["SKU1", { pack_bom_id: "B1", sfg_qty: 20, output_qty: 1, output_uom_code: "BAG", inputs: [] }],
      ["SKU2", { pack_bom_id: "B2", sfg_qty: 20, output_qty: 1, output_uom_code: "BAG", inputs: [] }],
    ]),
  });
  const exploded = explodeDemand(input);
  const alloc = allocateDemand(exploded.records, input.calendar, [
    { material_id: "RM-A", storage_location_id: "R1", stock_type_code: "UNRESTRICTED", qty: 100 },
  ], [], true);
  near(sum(alloc.dailyByMaterial.get("RM-A")), 180 + 300, "RM-A demand from both Prodshades (60% of 300 + 100% of 300)");
  near(sum(alloc.fromStockByMaterial.get("RM-A")), 100, "the 100 KG of stock is used once, not per Prodshade");
});

Deno.test("Pack BOM: PM per outer unit; non-producing SKU w/o BOM is silent; producing SKU w/o BOM raises [T7][T8]", () => {
  const withBom = explodeDemand(baseInput({ effective: effectiveFor([line({ plan_type: "FINAL", base_qty: 400 })]) }));
  near(withBom.records.filter((r) => r.kind === "PM").reduce((s, r) => s + r.qty, 0), 20, "400 KG / 20 KG per bag = 20 bags");
  const pmRecords = withBom.records.filter((r) => r.kind === "PM");
  near(pmRecords.reduce((s, r) => s + Number(r.outer_qty ?? 0), 0), 20, "user-facing BAG quantity follows Pack BOM output");
  assertEqual([pmRecords[0].outer_uom_code, pmRecords[0].fill_qty_per_outer], ["BAG", 20], "pack display carries verified output unit and fill quantity");
  const noDemand = explodeDemand(baseInput({ effective: [], packBoms: new Map() }));
  assertEqual(noDemand.exceptions.length, 0, "no plan, no BOM → no false exception");
  const missing = explodeDemand(baseInput({ effective: effectiveFor([line({ plan_type: "FINAL", base_qty: 400 })]), packBoms: new Map() }));
  assertEqual(missing.exceptions.map((e) => e.code), ["MISSING_PACK_BOM"], "planned manufacture without BOM is a real exception");
});

Deno.test("Cross-company allocation has no source: unknown SKUs raise, never silently exploded [T6]", () => {
  const result = explodeDemand(baseInput({ effective: effectiveFor([line({ plan_type: "FINAL", base_qty: 100, sku_material_id: "OTHER_CO_SKU" })]) }));
  assertEqual(result.exceptions.map((e) => e.code), ["SKU_NOT_CURRENT_MTS_SKU"], "exception");
  assertEqual(result.records.length, 0, "no demand invented");
});

Deno.test("Unit conversions: KG/MT, litre SKU, PM pack units, PO ratio [T9]", () => {
  const factors = buildToBaseFactors("KG", [
    { from_uom_code: "BAG", to_uom_code: "KG", conversion_factor: 25, variable_conversion: false, active: true },
    { from_uom_code: "KG", to_uom_code: "DRUM", conversion_factor: 0.005, variable_conversion: false, active: true },
    { from_uom_code: "BBL", to_uom_code: "KG", conversion_factor: null, variable_conversion: true, active: true },
  ]);
  assertEqual(factors, { MT: 1000, BAG: 25, DRUM: 200 }, "fixed both-direction factors, variable ignored, MT standard");
  assertEqual(toMaterialBase(material("X", "RM", "KG", factors), 2, "MT"), 2000, "MT → KG");
  assertEqual(toMaterialBase(material("X", "PM", "NOS"), 3, "BOX"), null, "unknown unit is not guessed");
  const litre = explodeDemand(baseInput({
    effective: effectiveFor([line({ plan_type: "FINAL", base_qty: 100 })]),
    skus: new Map([["SKU1", { sku_material_id: "SKU1", prodshade_material_id: "P1", base_uom_code: "L", kg_per_base_unit: null }]]),
  }));
  assertEqual(litre.exceptions.map((e) => e.code), ["SKU_KG_CONVERSION_MISSING"], "litre SKU without KG conversion is flagged");
  const warnings: Warning[] = [];
  const events = partitionPoLineInbound({
    material_id: "RM-A", po_number: "930001", line_number: 1, open_qty: 2, base_per_po_unit: 1000,
    expected_delivery_date: "2026-11-20", at_gate: [], csns: [], lots: [],
  }, "2026-11-01", warnings);
  assertEqual(events.map((e) => e.qty), [2000], "2 MT open on the PO = 2000 KG");
});

Deno.test("Consumption nets reversals [T10]", () => {
  // CONS bucket = IN − OUT of P261/P262: issued 500 (OUT), reversed 120 (IN) → −380.
  assertEqual(consumptionFromConsBucket(-380), 380, "net consumption");
  assertEqual(consumptionFromConsBucket(null), 0, "no movements");
  const calendar = buildCalendar("2026-11-01", "2026-11-16")!;
  const metrics = computeMaterialMetrics({
    calendar, demandByDay: new Map([["2026-11-05", 300], ["2026-11-20", 600]]), consumption: 380, stock: 0,
    inbound: bucketInbound([], calendar), policy: null, moqBaseQty: null, leadTimeDays: null,
  });
  assertEqual([metrics.cm_req, metrics.cm_prorata, metrics.cm_cons, metrics.cm_balance_req], [900, 600, 380, 520], "CM figures");
});

Deno.test("Stock: required vs remote SLoc, QA / blocked excluded, reservations applied [T11][T12]", () => {
  const input = baseInput({ effective: effectiveFor([line({ plan_type: "FINAL", base_qty: 300 })]) });
  const exploded = explodeDemand(input);
  const alloc = allocateDemand(exploded.records, input.calendar, [
    { material_id: "RM-A", storage_location_id: "R1", stock_type_code: "UNRESTRICTED", qty: 50 },
    { material_id: "RM-A", storage_location_id: "S9", stock_type_code: "UNRESTRICTED", qty: 400 },
    { material_id: "RM-A", storage_location_id: "R1", stock_type_code: "QUALITY_INSPECTION", qty: 70 },
    { material_id: "RM-A", storage_location_id: "R1", stock_type_code: "BLOCKED", qty: 30 },
  ], [{ material_id: "RM-A", storage_location_id: "R1", qty: 20 }], true);
  const pos = alloc.stock.get("RM-A")!;
  assertEqual([pos.usable_at_required, pos.reserved_at_required, pos.other_sloc_unrestricted, pos.quality_inspection, pos.blocked], [30, 20, 400, 70, 30], "stock split");
  assertEqual(pos.other_locations, ["S9"], "remote location is a transfer candidate only");
  near(sum(alloc.fromStockByMaterial.get("RM-A")), 30, "only usable stock at R1 covers demand");
  const noRes = allocateDemand(exploded.records, input.calendar, [
    { material_id: "RM-A", storage_location_id: "R1", stock_type_code: "UNRESTRICTED", qty: 50 },
  ], [{ material_id: "RM-A", storage_location_id: "R1", qty: 20 }], false);
  assertEqual(noRes.stock.get("RM-A")!.usable_at_required, 50, "past as-of date: current reservations not applied");
});

Deno.test("Inbound: GE / CSN / lot / remainder never exceed the PO line; mother CSN skipped [T13]", () => {
  const warnings: Warning[] = [];
  const events = partitionPoLineInbound({
    material_id: "RM-A", po_number: "930010", line_number: 1, open_qty: 100, base_per_po_unit: 1,
    expected_delivery_date: "2026-12-15",
    at_gate: [{ qty_base: 10, reference: "GE 1000000001", date: "2026-10-31" }],
    csns: [
      { csn_number: "C1", status: "TRN", dispatch_qty: 40, received_qty: 15, eta: "2026-11-05", is_mother_with_children: false },
      { csn_number: "C2", status: "ORD", dispatch_qty: 50, received_qty: 0, eta: "2026-11-20", is_mother_with_children: false },
      { csn_number: "M", status: "TRN", dispatch_qty: 999, received_qty: 0, eta: "2026-11-02", is_mother_with_children: true },
      { csn_number: "C3", status: "GRD", dispatch_qty: 30, received_qty: 30, eta: "2026-10-01", is_mother_with_children: false },
    ],
    lots: [{ lot_number: "L1", balance_qty: 80, delivery_date: "2026-12-01" }],
  }, "2026-11-01", warnings);
  assertEqual(events.map((e) => [e.kind, e.qty, e.date]), [
    ["AT_GATE", 10, "2026-11-01"],
    ["IN_TRANSIT", 25, "2026-11-05"],
    ["IN_TRANSIT", 50, "2026-11-20"],
    ["SCHEDULED_LOT", 15, "2026-12-01"],
  ], "partition is capped at the 100 open; lot only gets what is left");
  near(events.reduce((s, e) => s + e.qty, 0), 100, "never more than the PO open quantity");
});

Deno.test("Inbound dates: overdue and missing ETA are not counted as on-time supply [T14]", () => {
  const calendar = buildCalendar("2026-11-01", "2026-11-10")!;
  const buckets = bucketInbound([
    { material_id: "X", qty: 5, date: "2026-11-02", kind: "IN_TRANSIT", date_source: "CSN_ETA_TO_PLANT", reference: "a" },
    { material_id: "X", qty: 7, date: "2026-11-12", kind: "IN_TRANSIT", date_source: "CSN_ETA_TO_PLANT", reference: "b" },
    { material_id: "X", qty: 11, date: "2026-12-03", kind: "SCHEDULED_LOT", date_source: "LOT_DELIVERY_DATE", reference: "c" },
    { material_id: "X", qty: 13, date: "2027-01-03", kind: "PO_REMAINDER", date_source: "PO_EXPECTED_DELIVERY", reference: "d" },
    { material_id: "X", qty: 17, date: null, kind: "PO_REMAINDER", date_source: "NONE", reference: "e" },
  ], calendar);
  assertEqual([buckets.overdue, buckets.cm, buckets.nm, buckets.later, buckets.unknown, buckets.total], [5, 7, 11, 13, 17, 53], "buckets");
  const remainder = partitionPoLineInbound({
    material_id: "X", po_number: "1", line_number: 1, open_qty: 9, base_per_po_unit: 1, expected_delivery_date: null,
    at_gate: [], csns: [], lots: [],
  }, "2026-11-10", []);
  assertEqual([remainder[0].date, remainder[0].date_source], [null, "NONE"], "missing ETA stays UNKNOWN, never immediate");
});

Deno.test("Coverage: zero demand, zero stock, date-wise with inbound [T15]", () => {
  const calendar = buildCalendar("2026-11-01", "2026-11-01")!;
  const none = coverageDays(100, calendar, new Map(), null, 0);
  assertEqual(none.days, null, "no demand = no finite cover (shown as NO_DEMAND)");
  const demand = new Map<string, number>();
  for (const day of calendar.horizon) demand.set(day, 10);
  const zero = coverageDays(0, calendar, demand, null, 10);
  assertEqual([zero.days, zero.stockout_date], [0, "2026-11-01"], "zero stock = zero cover");
  const half = coverageDays(25, calendar, demand, null, 10);
  assertEqual(half.days, 2.5, "fractional day");
  const withIn = coverageDays(25, calendar, demand, new Map([["2026-11-03", 100]]), 10);
  assertEqual(withIn.days, 12.5, "inbound on day 3 extends cover");
  const beyond = coverageDays(10000, calendar, demand, null, 10);
  assert(beyond.extrapolated && (beyond.days ?? 0) > 61, "extrapolated past NM end at NM rate");
});

Deno.test("NM REQ DAYS: ERP date-aware rule around the 15th [T17]", () => {
  // ERP: clamp(Target − CM days left, 0, NM days). Same rule for every company;
  // direct sheet inspection verified CMP003's 15th-day step differs, and the
  // reconciliation report records this deliberate smoothing correction.
  const target = 45;
  const d14 = buildCalendar("2026-11-01", "2026-11-14")!; // 17 days left
  const d15 = buildCalendar("2026-11-01", "2026-11-15")!; // 16 days left
  const d16 = buildCalendar("2026-11-01", "2026-11-16")!; // 15 days left
  assertEqual([nmRequiredDays(target, d14), nmRequiredDays(target, d15), nmRequiredDays(target, d16)], [28, 29, 30], "grows one day per calendar day, no step at the 15th");
  assertEqual(nmRequiredDays(10, d14), 0, "target inside CM → 0");
  assertEqual(nmRequiredDays(90, d16), 31, "capped at NM length");
  assertEqual(nmRequiredDays(null, d16), null, "no policy → unknown");
});

Deno.test("Policy by effective date + MOQ without fixed vendor minimum [T18][T19]", () => {
  const policies: PolicyRow[] = [
    { material_id: "RM-A", effective_from: "2026-10-01", target_cov_days: 40, critical_cov_days: 20, moq_qty: null, moq_uom_code: null, moq_source: "NONE", moq_active: false, version_no: 1 },
    { material_id: "RM-A", effective_from: "2026-11-15", target_cov_days: 60, critical_cov_days: 25, moq_qty: 2, moq_uom_code: "MT", moq_source: "COMPANY", moq_active: true, version_no: 3 },
  ];
  assertEqual(effectivePolicy(policies, "RM-A", "2026-11-14")!.target_cov_days, 40, "before the new effective date");
  assertEqual(effectivePolicy(policies, "RM-A", "2026-11-15")!.target_cov_days, 60, "from the new effective date");
  assertEqual(effectivePolicy(policies, "RM-B", "2026-11-15"), null, "other material unaffected");
  const kgMaterial = material("RM-A", "RM", "KG", { MT: 1000 });
  assertEqual(moqInBase(policies[1], kgMaterial), 2000, "2 MT company MOQ = 2000 KG");
  const calendar = buildCalendar("2026-11-01", "2026-11-20")!;
  const demand = new Map<string, number>();
  for (const day of calendar.horizon) demand.set(day, 10);
  const metrics = computeMaterialMetrics({
    calendar, demandByDay: demand, consumption: 0, stock: 0, inbound: bucketInbound([], calendar),
    policy: policies[1], moqBaseQty: 2000, leadTimeDays: 10,
  });
  // 11 days left → NM REQ DAYS 49 capped to 31 → NEXT MONTH REQ 310; TOTAL PRORATA 110 + 310 = 420.
  assertEqual([metrics.nm_req_days, metrics.next_month_req, metrics.total_prorata, metrics.net_req, metrics.net_req_moq], [31, 310, 420, 420, 2000], "net requirement raised to active MOQ");
  const noMoq = computeMaterialMetrics({
    calendar, demandByDay: demand, consumption: 0, stock: 0, inbound: bucketInbound([], calendar),
    policy: policies[0], moqBaseQty: null, leadTimeDays: null,
  });
  assertEqual(noMoq.net_req, noMoq.net_req_moq, "no fixed MOQ → net requirement unchanged");
  // D2 sheet meanings: H = 300 remaining (nothing consumed), AB = 31 × 10, AC = 610, AD = 610 / (11 + 31).
  assertEqual([metrics.sheet_current_req, metrics.sheet_next_month_req, metrics.sheet_total_req, metrics.total_prorata_daily], [300, 310, 610, 14.52381], "sheet H / AB / AC / AD");
  assertEqual([metrics.identifier, metrics.safety_day_stock, metrics.lead_time_stock, metrics.total_stock_level], ["CRITICAL", 871.428571, 145.238095, 1016.666667], "Safety = Target × AD, lead stock = lead × AD");
  assertEqual([metrics.reorder_flag, metrics.priority_score, metrics.current_balance_shortage], [true, 3, 300], "reorder flag, priority 0–3, + = shortage");
});

Deno.test("Lead time: legacy max+4 vs configured vs unknown", () => {
  const configured = [
    { vendor_label: "V1", route: "DOMESTIC" as const, days: 7, detail: "transit 7" },
    { vendor_label: "V2", route: "IMPORT" as const, days: 45, detail: "sail 30 + clearance 10 + inland 5" },
  ];
  const observed = computeLeadTime(configured, [10, 20, 30]);
  assertEqual([observed.observed_avg, observed.observed_max, observed.legacy_equivalent, observed.effective, observed.effective_source], [20, 30, 34, 45, "CONFIGURED_MAX"], "D2: configured (booking + route) wins; history max+4 is the fallback");
  const historyOnly = computeLeadTime([], [10, 20, 30]);
  assertEqual([historyOnly.effective, historyOnly.effective_source], [34, "LEGACY_MAX_PLUS_4"], "fallback to sheet rule");
  const configuredOnly = computeLeadTime(configured, []);
  assertEqual([configuredOnly.effective, configuredOnly.effective_source], [45, "CONFIGURED_MAX"], "largest configured route");
  const unknown = computeLeadTime([], []);
  assertEqual([unknown.effective, unknown.effective_source], [null, "UNKNOWN"], "never zero");
});

Deno.test("Whole pipeline: deterministic, and a source change changes the result [T21]", () => {
  const explosion = baseInput();
  const input: RequirementInput = {
    ...explosion,
    planLines: [line({ entry_id: "fixed1", plan_type: "FINAL", base_qty: 3000 }), line({ entry_id: "fixed2", plan_type: "FINAL", plan_month: "2026-12-01", base_qty: 3100 })],
    demandAt: null,
    stockRows: [{ material_id: "RM-A", storage_location_id: "R1", stock_type_code: "UNRESTRICTED", qty: 500 }],
    reservations: [],
    applyReservations: true,
    consumptionByMaterial: new Map(),
    inboundEvents: [{ material_id: "RM-A", qty: 1000, date: "2026-11-10", kind: "IN_TRANSIT", date_source: "CSN_ETA_TO_PLANT", reference: "x" }],
    policies: [{ material_id: "RM-A", effective_from: "2026-01-01", target_cov_days: 30, critical_cov_days: 15, moq_qty: null, moq_uom_code: null, moq_source: "NONE", moq_active: false, version_no: 1 }],
    leadTimes: new Map(),
    materialUniverse: ["RM-A", "RM-B", "RM-C", "PM-BAG"],
  };
  const first = buildRequirementRows(input);
  const second = buildRequirementRows(input);
  assertEqual(canonicalJson(first), canonicalJson(second), "same sources → identical output");
  const rmA = first.rows.find((row) => row.material_id === "RM-A")!;
  near(rmA.metrics.cm_req, 1800, "RM-A Nov = 60% of 3000");
  near(rmA.metrics.nm_req, 1860, "RM-A Dec = 60% of 3100");
  near(rmA.metrics.current_stk_days, 8.33, "stock-only cover (days rounded to 2 dp)");
  near(rmA.metrics.intransit_cm, 1000, "CSN in CM");
  assertEqual(first.rows.map((row) => row.material_id), ["PM-BAG", "RM-A", "RM-B", "RM-C"], "universe rows, including zero-demand RM-C");
  const changed = buildRequirementRows({ ...input, stockRows: [{ material_id: "RM-A", storage_location_id: "R1", stock_type_code: "UNRESTRICTED", qty: 600 }] });
  assert(canonicalJson(changed) !== canonicalJson(first), "stock change → different result");
});

// ── PO21 plan-line lineage (attribution only — numbers unchanged) ─────────
function addsTotal(record: DemandRecord): number {
  return record.plan_line_contributions.filter((row) => row.adds_qty).reduce((total, row) => total + row.qty, 0);
}
function bySource(records: DemandRecord[], adds = true): Record<string, number> {
  const out: Record<string, number> = {};
  for (const record of records) for (const row of record.plan_line_contributions) {
    if (row.adds_qty !== adds) continue;
    out[String(row.source_id)] = (out[String(row.source_id)] ?? 0) + row.qty;
  }
  for (const key of Object.keys(out)) out[key] = Math.round(out[key] * 1000) / 1000;
  return out;
}
function conserving(records: DemandRecord[], message: string) {
  assert(records.length > 0, `${message}: no records`);
  for (const record of records) near(addsTotal(record), record.qty, `${message}: ${record.day} ${record.pool_key} contributions = qty`, 1e-6);
}

Deno.test("lineage: only effective versions contribute — Final over Rolling, latest version, cancelled dropped", () => {
  const lines = [
    line({ source_id: "R1", entry_id: "r", plan_type: "ROLLING", base_qty: 100, created_at: "2026-10-01T00:00:00Z" }),
    line({ source_id: "F1v1", entry_id: "f", plan_type: "FINAL", base_qty: 300, created_at: "2026-10-05T00:00:00Z" }),
    line({ source_id: "F1v2", entry_id: "f", version_no: 2, plan_type: "FINAL", base_qty: 310, created_at: "2026-10-06T00:00:00Z" }),
    line({ source_id: "C1", entry_id: "c", plan_type: "ADDITIONAL", base_qty: 999, is_cancelled: true, created_at: "2026-10-09T00:00:00Z" }),
  ];
  const [now] = effectivePlanAt(lines, null);
  assertEqual(now.contributors?.map((ref) => [ref.source_id, ref.version_no, ref.role]), [["F1v2", 2, "BASE"]], "latest FINAL version only");
  const [then] = effectivePlanAt(lines, "2026-10-05T12:00:00Z");
  assertEqual(then.contributors?.map((ref) => ref.source_id), ["F1v1"], "as-of demand time gives the version effective then");
  const [early] = effectivePlanAt(lines, "2026-10-02T00:00:00Z");
  assertEqual(early.contributors?.map((ref) => [ref.source_id, ref.role]), [["R1", "BASE"]], "Rolling before any Final");
  const explosion = explodeDemand(baseInput({ effective: [now] }));
  conserving(explosion.records, "Final v2");
  const ids = new Set(explosion.records.flatMap((record) => record.plan_line_contributions.map((row) => row.source_id)));
  assertEqual([...ids], ["F1v2"], "no superseded, rolling or cancelled line reaches demand");
});

Deno.test("lineage: Additional + Urgent Extra + Urgent From-Plan per day, conserved against skuDailyDemand", () => {
  const [entry] = effectiveFor([
    line({ source_id: "F", plan_type: "FINAL", base_qty: 300 }),
    line({ source_id: "A", plan_type: "ADDITIONAL", base_qty: 60 }),
    line({ source_id: "P", plan_type: "URGENT", urgent_mode: "FROM_PLAN", urgent_from_date: "2026-11-01", urgent_to_date: "2026-11-05", base_qty: 50 }),
    line({ source_id: "X", plan_type: "URGENT", urgent_mode: "EXTRA", urgent_from_date: "2026-11-10", urgent_to_date: "2026-11-11", base_qty: 20 }),
  ]);
  const daily = skuDailyDemand(entry, []);
  const contributions = skuDailyContributions(entry);
  for (const [day, qty] of daily) {
    const list = contributions.get(day) ?? [];
    near(list.filter((row) => row.adds_qty).reduce((total, row) => total + row.qty, 0), qty, `${day} conserved`, 1e-9);
  }
  const totals: Record<string, number> = {};
  const timing: Record<string, number> = {};
  for (const list of contributions.values()) for (const row of list) {
    const target = row.adds_qty ? totals : timing;
    target[String(row.source_id)] = (target[String(row.source_id)] ?? 0) + row.qty;
  }
  near(totals.F, 300, "Final share of the month");
  near(totals.A, 60, "Additional share of the month");
  near(totals.X, 20, "Urgent Extra adds its own qty");
  assertEqual(totals.P, undefined, "Urgent From-Plan adds nothing");
  near(timing.P, 50, "Urgent From-Plan recorded as re-phasing of 50");
  const day1 = contributions.get("2026-11-01")!;
  near(day1.find((row) => row.source_id === "F")!.qty, (310 / 30 + 10) * (300 / 360), "From-Plan window day split Final:Additional 300:60");
  assertEqual(contributions.get("2026-11-20")!.some((row) => row.source_id === "P" || row.source_id === "X"), false, "ordinary day has no urgent line");
  assertEqual(contributions.get("2026-11-10")!.find((row) => row.source_id === "X")!.role, "URGENT_EXTRA", "Extra in its window");
});

Deno.test("lineage: multiple SKUs under one Prodshade → RM keeps each SKU's plan line; PM per SKU", () => {
  const input = baseInput({
    effective: effectiveFor([
      line({ source_id: "S1-F", plan_type: "FINAL", base_qty: 300, sku_material_id: "SKU1" }),
      line({ source_id: "S2-F", plan_type: "FINAL", base_qty: 600, sku_material_id: "SKU2" }),
    ]),
    skus: new Map([
      ["SKU1", { sku_material_id: "SKU1", prodshade_material_id: "P1", base_uom_code: "KG", kg_per_base_unit: 1 }],
      ["SKU2", { sku_material_id: "SKU2", prodshade_material_id: "P1", base_uom_code: "BAG", kg_per_base_unit: 20 }],
    ]),
  });
  const result = explodeDemand(input);
  const rm = result.records.filter((record) => record.kind === "RM");
  conserving(rm, "RM");
  const rmA = bySource(rm.filter((record) => record.pool_key === "RM|L1"));
  near(rmA["S1-F"], 0.6 * 300, "RM-A from SKU1 line (KG)");
  near(rmA["S2-F"], 0.6 * 600 * 20, "RM-A from SKU2 line (bags × 20 KG)");
  assertEqual(new Set(rm[0].plan_line_contributions.map((row) => row.sku_material_id)).size, 2, "RM record keeps both SKUs");
  const pm = result.records.filter((record) => record.kind === "PM");
  conserving(pm, "PM");
  assertEqual(Object.keys(bySource(pm)), ["S1-F"], "PM of SKU1 Pack BOM only from SKU1's line");
  near(bySource(pm)["S1-F"], 300 / 20, "15 bags");
});

Deno.test("lineage: Tab 2 period qty override keeps month shares and conserves per record", () => {
  const input = baseInput({
    effective: effectiveFor([
      line({ source_id: "F", plan_type: "FINAL", base_qty: 2400 }),
      line({ source_id: "A", plan_type: "ADDITIONAL", base_qty: 600 }),
    ]),
    strokeSettings: new Map([["2026-11-01|P1", [
      { stroke_master_id: "S1", period_from: "2026-11-01", period_to: "2026-11-10", planned_base_qty: 2000 },
      { stroke_master_id: "S2", period_from: "2026-11-11", period_to: "2026-11-30", planned_base_qty: null },
    ]]]),
  });
  const result = explodeDemand(input);
  const rm = result.records.filter((record) => record.kind === "RM");
  conserving(rm, "override month");
  const day3 = rm.find((record) => record.day === "2026-11-03" && record.pool_key === "RM|L1")!;
  near(day3.plan_line_contributions.find((row) => row.source_id === "F")!.qty / day3.qty, 0.8, "Final keeps its 80% month share");
});

Deno.test("lineage: explosion quantities unchanged by attribution", () => {
  const lines = [
    line({ source_id: "F", plan_type: "FINAL", base_qty: 3000 }),
    line({ source_id: "P", plan_type: "URGENT", urgent_mode: "FROM_PLAN", urgent_from_date: "2026-11-02", urgent_to_date: "2026-11-03", base_qty: 400 }),
  ];
  const withRefs = explodeDemand(baseInput({ effective: effectiveFor(lines) }));
  const withoutRefs = explodeDemand(baseInput({ effective: effectiveFor(lines).map(({ contributors: _c, ...entry }) => entry) }));
  assertEqual(withRefs.records.map((record) => [record.day, record.pool_key, record.qty]), withoutRefs.records.map((record) => [record.day, record.pool_key, record.qty]), "same day/pool/qty");
  assertEqual(withoutRefs.records.every((record) => record.plan_line_contributions.length === 0), true, "no contributors → no lineage (adapter fails closed)");
});

Deno.test("D5/D2: overdue and no-ETA inbound are assumed today; dispatched vs open PO split", () => {
  const calendar = buildCalendar("2026-11-01", "2026-11-10")!;
  const buckets = bucketInbound([
    { material_id: "X", qty: 5, date: "2026-11-02", kind: "IN_TRANSIT", date_source: "CSN_ETA_TO_PLANT", reference: "a" },
    { material_id: "X", qty: 17, date: null, kind: "PO_REMAINDER", date_source: "NONE", reference: "e" },
    { material_id: "X", qty: 3, date: "2026-11-15", kind: "SCHEDULED_LOT", date_source: "LOT_DELIVERY_DATE", reference: "f" },
  ], calendar);
  assertEqual([buckets.overdue, buckets.unknown, buckets.byDay.get("2026-11-10"), buckets.dispatched, buckets.open_po], [5, 17, 22, 5, 20], "assumed on as-of, still flagged");
});

Deno.test("D2: current req falls back to NM when CM is fully consumed; prorata is a daily rate", () => {
  const calendar = buildCalendar("2026-11-01", "2026-11-21")!; // 10 CM days left
  const demand = new Map<string, number>();
  for (const day of calendar.horizon) demand.set(day, 10);
  const policy: PolicyRow = { material_id: "M", effective_from: "2026-01-01", target_cov_days: 20, critical_cov_days: 10, moq_qty: null, moq_uom_code: null, moq_source: "NONE", moq_active: false, version_no: 1 };
  const consumed = computeMaterialMetrics({ calendar, demandByDay: demand, consumption: 300, stock: 1000, inbound: bucketInbound([], calendar), policy, moqBaseQty: null, leadTimeDays: 5 });
  assertEqual([consumed.sheet_current_req_basis, consumed.sheet_current_req, consumed.current_prorata_daily, consumed.nm_prorata_daily], ["NM", 310, 10, 10], "CM consumed → NM basis");
  const partial = computeMaterialMetrics({ calendar, demandByDay: demand, consumption: 150, stock: 1000, inbound: bucketInbound([], calendar), policy, moqBaseQty: null, leadTimeDays: 5 });
  assertEqual([partial.sheet_current_req_basis, partial.sheet_current_req, partial.current_prorata_daily], ["CM_REMAINING", 150, 15], "remaining 150 over 10 days");
  assertEqual([partial.reorder_flag, partial.priority_score], [false, null], "stock above reorder level → no priority");
});

// ── Owner D1/D3/D12: pooled counted stock, fixed first, group-owned shortage ───────
function rec(partial: Partial<DemandRecord>): DemandRecord {
  return {
    day: "2026-11-05", kind: "RM", pool_key: "P", candidates: ["M"], storage_location_id: "R001", qty: 0,
    prodshade_material_id: "PS", sku_material_id: null, stroke_master_id: "S", stroke_line_id: "L", pack_bom_id: null,
    pack_bom_line_id: null, outer_qty: null, outer_uom_code: null, fill_qty_per_outer: null, group_id: null,
    use_primary: null, sort_key: "x", plan_line_contributions: [], ...partial,
  };
}

Deno.test("D3/D12: fixed demand is met first; group shortage stays on the group; R003 shown not counted", () => {
  const calendar = buildCalendar("2026-11-01", "2026-11-01")!;
  const roles = new Map<string, "COUNTED" | "TRANSFER_SOURCE" | "EXCLUDED">([["R001", "COUNTED"], ["S001", "COUNTED"], ["R003", "TRANSFER_SOURCE"], ["OT01", "EXCLUDED"]]);
  const records = [
    // group demand dated BEFORE the fixed demand — fixed still wins (pass 1)
    rec({ day: "2026-11-03", pool_key: "G", group_id: "G1", use_primary: false, candidates: ["RM-B", "RM-C"], qty: 100 }),
    rec({ day: "2026-11-05", pool_key: "F", candidates: ["RM-B"], qty: 50, storage_location_id: "R001" }),
  ];
  const alloc = allocateDemand(records, calendar, [
    { material_id: "RM-B", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 40 },
    { material_id: "RM-B", storage_location_id: "S001", stock_type_code: "UNRESTRICTED", qty: 20 },
    { material_id: "RM-C", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 30 },
    { material_id: "RM-C", storage_location_id: "R003", stock_type_code: "UNRESTRICTED", qty: 40 },
    { material_id: "RM-C", storage_location_id: "OT01", stock_type_code: "UNRESTRICTED", qty: 5 },
  ], [], true, { locationRoles: roles });
  assertEqual(alloc.stock.get("RM-B")!.usable_at_required, 60, "R001 + S001 pooled");
  assertEqual([alloc.stock.get("RM-C")!.usable_at_required, alloc.stock.get("RM-C")!.other_sloc_unrestricted, alloc.stock.get("RM-C")!.excluded_unrestricted], [30, 40, 5], "R003 transfer source, OT01 excluded");
  assertEqual(alloc.fixedByMaterial.get("RM-B"), 50, "fixed met first");
  const group = alloc.groups.get("G1")!;
  assertEqual([group.drawnByMaterial.get("RM-B"), group.drawnByMaterial.get("RM-C"), group.uncoveredByDay.get("2026-11-03")], [10, 30, 60], "group uses leftovers; shortage stays on the group");
  assertEqual(sum(alloc.dailyByMaterial.get("RM-C")), 30, "no shortage pushed onto a member");
});

Deno.test("D3: reservations at counted locations are deducted once from the pooled stock", () => {
  const calendar = buildCalendar("2026-11-01", "2026-11-01")!;
  const roles = new Map<string, "COUNTED" | "TRANSFER_SOURCE" | "EXCLUDED">([["R001", "COUNTED"], ["P001", "COUNTED"]]);
  const alloc = allocateDemand([rec({ candidates: ["PM-1"], kind: "PM", qty: 10 })], calendar, [
    { material_id: "PM-1", storage_location_id: "P001", stock_type_code: "UNRESTRICTED", qty: 25 },
  ], [{ material_id: "PM-1", storage_location_id: "P001", qty: 20 }], true, { locationRoles: roles });
  assertEqual([alloc.stock.get("PM-1")!.usable_at_required, alloc.stock.get("PM-1")!.reserved_at_required, sum(alloc.fromStockByMaterial.get("PM-1"))], [5, 20, 5], "25 − 20 reserved = 5 usable");
});

Deno.test("Store report rows reconcile: executable + not backed = line demand; executable never exceeds stock", () => {
  const explosion = baseInput();
  const output = buildRequirementRows({
    ...explosion,
    planLines: [line({ entry_id: "s1", plan_type: "FINAL", base_qty: 3000 }), line({ entry_id: "s2", plan_type: "FINAL", plan_month: "2026-12-01", base_qty: 3100 })],
    demandAt: null,
    stockRows: [
      { material_id: "RM-A", storage_location_id: "R1", stock_type_code: "UNRESTRICTED", qty: 500 },
      { material_id: "RM-C", storage_location_id: "R1", stock_type_code: "UNRESTRICTED", qty: 300 },
    ],
    reservations: [], applyReservations: true, consumptionByMaterial: new Map(),
    inboundEvents: [{ material_id: "RM-A", qty: 1000, date: "2026-11-10", kind: "IN_TRANSIT", date_source: "CSN_ETA_TO_PLANT", reference: "x" }],
    policies: [], leadTimes: new Map(), materialUniverse: ["RM-A", "RM-B", "RM-C", "PM-BAG"],
    locationRoles: new Map([["R1", "COUNTED"], ["P1LOC", "COUNTED"]]),
  });
  const byLine = new Map<string, { demand: number; covered: number }>();
  for (const row of output.store_rows) {
    const key = `${row.pool_key}|${row.period}`;
    const seen = byLine.get(key) ?? { demand: row.demand_qty, covered: 0 };
    seen.covered += row.executable_qty + row.not_backed_qty;
    byLine.set(key, seen);
  }
  for (const [key, value] of byLine) near(value.covered, value.demand, `line ${key} reconciles`, 1e-6);
  const executableA = output.store_rows.filter((r) => r.material_id === "RM-A").reduce((s, r) => s + r.executable_qty, 0);
  near(executableA, 500, "RM-A executable = its 500 counted stock, never the 1000 in transit");
  assert(output.store_rows.every((r) => r.executable_qty === 0 || r.not_backed_qty === 0), "a row is either executable or not backed");
});

// ── Owner Method C (2026-10-20): exclusive protection, free stock, most-free-first ─────────
Deno.test("Method C: primary keeps Target days of its exclusive use; group runs on free stock, most free first", () => {
  const calendar = buildCalendar("2026-11-01", "2026-11-01")!; // horizon Nov 1 .. Dec 31 = 61 days
  const roles = new Map<string, "COUNTED" | "TRANSFER_SOURCE" | "EXCLUDED">([["R001", "COUNTED"]]);
  const records = [
    rec({ day: "2026-11-02", pool_key: "X", candidates: ["GAB"], qty: 610 }),                                       // exclusive: 10/day
    rec({ day: "2026-11-03", pool_key: "G", group_id: "MHEC", use_primary: true, candidates: ["GAB", "TS", "COMBI"], qty: 2000 }),
  ];
  const stockRows = [
    { material_id: "GAB", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 1500 },
    { material_id: "TS", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 400 },
    { material_id: "COMBI", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 5000 },
  ];
  const alloc = allocateDemand(records, calendar, stockRows, [], true, {
    locationRoles: roles, protectionDays: new Map([["GAB", { critical_days: 10, target_days: 30 }]]),
  });
  // GAB: 1500 − 610 exclusive = 890 left; protected 10/day × 30 = 300 → free 590 (primary first).
  assertEqual(alloc.stock.get("GAB")!.exclusive_protected, 300, "Target days of exclusive use protected");
  const group = alloc.groups.size === 0 ? null : alloc.groups.get("MHEC");
  assertEqual(group, null, "Use Primary = Yes is not a group-owned pool");
  assertEqual([alloc.groupShareByMaterial.get("GAB"), alloc.groupShareByMaterial.get("COMBI"), alloc.groupShareByMaterial.get("TS") ?? 0], [590, 1410, 0], "primary free stock, then most free (COMBI), TS untouched");
  assertEqual(alloc.stock.get("GAB")!.protection_used, 0, "no protected stock used");
});

Deno.test("Method C: Use Primary = No / group-owned pool draws the member with most free stock first", () => {
  const calendar = buildCalendar("2026-11-01", "2026-11-01")!;
  const roles = new Map<string, "COUNTED" | "TRANSFER_SOURCE" | "EXCLUDED">([["R001", "COUNTED"]]);
  const alloc = allocateDemand([rec({ pool_key: "G", group_id: "RDP", use_primary: false, candidates: ["A", "B", "C"], qty: 150 })], calendar, [
    { material_id: "A", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 100 },
    { material_id: "B", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 300 },
    { material_id: "C", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 200 },
  ], [], true, { locationRoles: roles });
  const drawn = alloc.groups.get("RDP")!.drawnByMaterial;
  assertEqual([drawn.get("A") ?? 0, drawn.get("B"), drawn.get("C") ?? 0], [0, 150, 0], "B (most free) covers it");
});

Deno.test("Method C fallback: group uses protected stock (Target part, then Critical) only when free stock runs out, and warns", () => {
  const calendar = buildCalendar("2026-11-01", "2026-11-01")!;
  const roles = new Map<string, "COUNTED" | "TRANSFER_SOURCE" | "EXCLUDED">([["R001", "COUNTED"]]);
  const records = [
    rec({ day: "2026-11-02", pool_key: "X", candidates: ["A"], qty: 610 }), // 10/day
    rec({ day: "2026-11-03", pool_key: "G", group_id: "G", use_primary: false, candidates: ["A", "B"], qty: 300 }),
  ];
  const alloc = allocateDemand(records, calendar, [
    { material_id: "A", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 1010 }, // 400 left: critical 100, target 300
    { material_id: "B", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 50 },
  ], [], true, { locationRoles: roles, protectionDays: new Map([["A", { critical_days: 10, target_days: 30 }]]) });
  const drawn = alloc.groups.get("G")!.drawnByMaterial;
  // free: A 100, B 50 → 150; then Target part of A (200) → 150 more; Critical part untouched.
  assertEqual([drawn.get("A"), drawn.get("B")], [250, 50], "free first, then protected Target part");
  assertEqual(alloc.stock.get("A")!.protection_used, 150, "protected stock used is recorded");
  assertEqual(sum(alloc.groups.get("G")!.uncoveredByDay), 0, "production does not stop");
});

Deno.test("Distribution mode: stock promised to another company by a Sub-CSN is not usable here", () => {
  const calendar = buildCalendar("2026-11-01", "2026-11-01")!;
  const roles = new Map<string, "COUNTED" | "TRANSFER_SOURCE" | "EXCLUDED">([["R001", "COUNTED"]]);
  const alloc = allocateDemand([rec({ candidates: ["MHEC"], qty: 20000 })], calendar, [
    { material_id: "MHEC", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 24000 },
  ], [], true, { locationRoles: roles, committedTransferOut: new Map([["MHEC", 15000]]) });
  assertEqual([alloc.stock.get("MHEC")!.usable_at_required, alloc.stock.get("MHEC")!.committed_transfer_out, sum(alloc.fromStockByMaterial.get("MHEC"))], [9000, 15000, 9000], "24 MT GR'd, 15 MT goes to other companies");
});

Deno.test("Distribution mode: Sub-CSN share of an open PO line is removed before the remainder", () => {
  const warnings: Warning[] = [];
  const events = partitionPoLineInbound({
    material_id: "MHEC", po_number: "PO125", line_number: 1, open_qty: 24000, base_per_po_unit: 1, expected_delivery_date: "2026-11-17",
    at_gate: [], csns: [{ csn_number: "M", status: "ORD", dispatch_qty: 0, received_qty: 0, eta: "2026-11-17", is_mother_with_children: true }], lots: [],
    committed_transfer_base: 24000,
  }, "2026-10-20", warnings);
  assertEqual(events.length, 0, "everything is for other companies → nothing inbound for the PO company");
  const partial = partitionPoLineInbound({
    material_id: "MHEC", po_number: "PO125", line_number: 1, open_qty: 24000, base_per_po_unit: 1, expected_delivery_date: "2026-11-17",
    at_gate: [], csns: [], lots: [], committed_transfer_base: 15000,
  }, "2026-10-20", warnings);
  assertEqual(partial.map((e) => [e.kind, e.qty]), [["PO_REMAINDER", 9000]], "own 9 MT remains");
});

Deno.test("Method C: a narrower group (fewer members) is served before a broader one sharing a member", () => {
  const calendar = buildCalendar("2026-11-01", "2026-11-01")!;
  const roles = new Map<string, "COUNTED" | "TRANSFER_SOURCE" | "EXCLUDED">([["R001", "COUNTED"]]);
  const alloc = allocateDemand([
    // broad RDP group is dated first, but the narrow RDP_TLA (only VIN/VAE) must still be secured
    rec({ day: "2026-11-02", pool_key: "B", group_id: "RDP", use_primary: false, candidates: ["VIN", "RP", "VAE"], qty: 150 }),
    rec({ day: "2026-11-10", pool_key: "N", group_id: "RDP_TLA", use_primary: false, candidates: ["VIN", "VAE"], qty: 80 }),
  ], calendar, [
    { material_id: "VIN", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 80 },
    { material_id: "RP", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 100 },
  ], [], true, { locationRoles: roles });
  assertEqual([alloc.groups.get("RDP_TLA")!.drawnByMaterial.get("VIN"), sum(alloc.groups.get("RDP_TLA")!.uncoveredByDay)], [80, 0], "RDP_TLA fully covered by VIN");
  assertEqual([alloc.groups.get("RDP")!.drawnByMaterial.get("RP"), sum(alloc.groups.get("RDP")!.uncoveredByDay)], [100, 50], "broad RDP runs on RP; its shortage is the one with alternatives to buy");
});
