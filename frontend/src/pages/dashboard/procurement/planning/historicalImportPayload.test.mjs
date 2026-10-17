import assert from "node:assert/strict";
import test from "node:test";
import { importSummary, prepareHistoricalImport } from "./historicalImportPayload.js";

const common = {
  companyId: "company-uuid",
  sourceSystem: "GOOGLE_SHEETS",
  sourceFileKey: "sheet-file-id",
  sourceFileName: "source.xlsx",
  sourceSheetName: "PO_SHEET",
};

test("production keeps its existing 2,000-row ceiling", () => {
  const result = prepareHistoricalImport({ ...common, recordKind: "PRODUCTION", rowsText: JSON.stringify(Array.from({ length: 2001 }, () => ({}))) });
  assert.match(result.error, /2,000/);
  assert.equal(result.api, null);
});

test("procurement headers use the procurement contract and 500 combined limit", () => {
  const result = prepareHistoricalImport({ ...common, recordKind: "PURCHASE_ORDER", rowsText: JSON.stringify([{ source_row_number: 2, external_po_number: "PO-1" }]) });
  assert.equal(result.error, "");
  assert.equal(result.api, "procurement");
  assert.equal(result.payload.purchase_orders.length, 1);
  assert.deepEqual(result.payload.purchase_order_lines, []);
  assert.deepEqual(result.payload.consignment_movements, []);
  assert.deepEqual(result.payload.product_reference_snapshots, []);

  const overflow = prepareHistoricalImport({ ...common, recordKind: "PURCHASE_ORDER", rowsText: JSON.stringify(Array.from({ length: 501 }, () => ({}))) });
  assert.match(overflow.error, /500 combined/);
});

test("Product Database is timestamped reference data, not an operations payload", () => {
  const snapshotRow = JSON.stringify([{ source_row_number: 2, source_record_key: "Product_Data_Base:2" }]);
  const missingTimestamp = prepareHistoricalImport({ ...common, recordKind: "PRODUCT_REFERENCE_SNAPSHOT", rowsText: snapshotRow });
  assert.match(missingTimestamp.error, /extraction timestamp/);
  const valid = prepareHistoricalImport({
    ...common, recordKind: "PRODUCT_REFERENCE_SNAPSHOT", sourceSheetName: "Product_Data_Base",
    sourceExtractedAt: "2026-10-16T10:30", rowsText: snapshotRow,
  });
  assert.equal(valid.api, "procurement");
  assert.match(valid.payload.source_extracted_at, /^2026-10-16T/);
  assert.equal(valid.payload.product_reference_snapshots.length, 1);
});

test("response summary keeps stored and analytically valid counts separate", () => {
  assert.deepEqual(importSummary({ summary: {
    submitted_count: 4, stored_count: 4, validated_count: 2, unmapped_count: 1, quarantined_count: 1,
    warning_count: 2, error_count: 0, quantities_by_uom: { KG: 12.5 },
  } }), {
    submitted: "4", stored: "4", validated: "2", unmapped: "1", quarantined: "1", warnings: "2", errors: "0", quantitiesByUom: { KG: 12.5 },
  });
});

test("existing Production/FG Dispatch response fields no longer render as dashes", () => {
  assert.deepEqual(importSummary({ summary: {
    submitted_row_count: 4, storable_row_count: 3, validated_row_count: 1,
    unmapped_row_count: 1, quarantined_row_count: 1, exception_count: 2, error_count: 0,
  } }), {
    submitted: "4", stored: "3", validated: "1", unmapped: "1", quarantined: "1", warnings: "2", errors: "0", quantitiesByUom: {},
  });
});
