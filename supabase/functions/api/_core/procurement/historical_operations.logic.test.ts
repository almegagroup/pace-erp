import {
  aggregateActuals,
  duplicateSourceRowKeys,
  HISTORY_LAST_DATE,
  isExplicitlyCancelled,
  kgFactorForUom,
  normalizeExternalSku,
  normalizeHistoricalDate,
} from "./historical_operations.logic.ts";

function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: ${JSON.stringify(actual)}`);
}

Deno.test("historical date ends on September 30 and live starts October 1", () => {
  equal(normalizeHistoricalDate(HISTORY_LAST_DATE), "2026-09-30", "cutover last historical day accepted");
  equal(normalizeHistoricalDate("2026-10-01"), null, "October record cannot enter historical schema");
  equal(normalizeHistoricalDate("2026-09-31"), null, "invalid calendar date quarantined");
});

Deno.test("historical SKU keeps leading zeroes and rejects the unknown sentinel", () => {
  equal(normalizeExternalSku("000123").sku, "000123", "leading zeroes retained");
  equal(normalizeExternalSku(123).issue?.code, "HISTORY_SKU_MUST_BE_TEXT", "numeric SKU rejected");
  equal(normalizeExternalSku("00000000000").issue?.code, "HISTORY_UNKNOWN_SKU", "unknown SKU needs manual mapping");
});

Deno.test("source re-import identity detects duplicate source rows", () => {
  const duplicates = duplicateSourceRowKeys([
    { source_row_number: 7, source_line_key: "a" },
    { source_row_number: 7, source_line_key: "a" },
    { source_row_number: 7, source_line_key: "b" },
  ]);
  equal([...duplicates], ["7|a"], "only same stable row identity duplicates");
});

Deno.test("dispatch cancellation is explicit and never inferred from cross-check", () => {
  equal(isExplicitlyCancelled({ cross_check: 1 }), false, "cross check is not cancellation evidence");
  equal(isExplicitlyCancelled({ original_dispatch_status: "Cancelled" }), true, "cancelled status excluded");
});

Deno.test("KG conversion only uses verified factors", () => {
  equal(kgFactorForUom("MT", null), 1000, "standard MT to KG");
  equal(kgFactorForUom("BAG", 25), 25, "fixed material conversion");
  equal(kgFactorForUom("BAG", null), null, "missing conversion quarantines");
});

Deno.test("actual aggregation keeps history and ERP live separate", () => {
  const rows = aggregateActuals([
    { month: "2026-09-01", identity_key: "m1", identity_level: "SKU", material_id: "m1", external_sku: "001", material_label: "SKU", prodshade: null, source_classification: "HISTORICAL", dispatch_kg: 3 },
    { month: "2026-09-01", identity_key: "m1", identity_level: "SKU", material_id: "m1", external_sku: "001", material_label: "SKU", prodshade: null, source_classification: "HISTORICAL", dispatch_kg: 2 },
    { month: "2026-10-01", identity_key: "m1", identity_level: "SKU", material_id: "m1", external_sku: "001", material_label: "SKU", prodshade: null, source_classification: "ERP_LIVE", dispatch_kg: 4 },
  ]);
  equal(rows.map((row) => [row.month, row.source_classification, row.dispatch_kg, row.has_production, row.has_dispatch]), [["2026-09-01", "HISTORICAL", 5, false, true], ["2026-10-01", "ERP_LIVE", 4, false, true]], "no cross-cutover double count");
});
