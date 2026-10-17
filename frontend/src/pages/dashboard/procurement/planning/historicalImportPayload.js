export const OPERATION_RECORD_KINDS = new Set(["PRODUCTION", "FG_DISPATCH"]);

export const PROCUREMENT_IMPORT_CHOICES = {
  PURCHASE_ORDER: { field: "purchase_orders", label: "Historical Purchase Orders / headers" },
  PURCHASE_ORDER_LINE: { field: "purchase_order_lines", label: "Historical PO Lines" },
  CONSIGNMENT_MOVEMENT: { field: "consignment_movements", label: "Historical Consignment Movements" },
  PRODUCT_REFERENCE_SNAPSHOT: { field: "product_reference_snapshots", label: "Product Database Reference Snapshot" },
};

export function prepareHistoricalImport(input) {
  const companyId = String(input.companyId ?? "").trim();
  const sourceSystem = String(input.sourceSystem ?? "").trim();
  const sourceFileKey = String(input.sourceFileKey ?? "").trim();
  const sourceFileName = String(input.sourceFileName ?? "").trim();
  const sourceSheetName = String(input.sourceSheetName ?? "").trim();
  const recordKind = String(input.recordKind ?? "").trim();
  if (!companyId) return { error: "Select a company.", payload: null, api: null, rowCount: 0 };
  if (!sourceSystem || !sourceFileKey || !sourceSheetName) {
    return { error: "Source system, source file key and sheet name are required.", payload: null, api: null, rowCount: 0 };
  }
  let rows;
  try {
    rows = JSON.parse(String(input.rowsText ?? ""));
  } catch {
    return { error: "Rows contain invalid JSON.", payload: null, api: null, rowCount: 0 };
  }
  if (!Array.isArray(rows)) return { error: "Rows must be a JSON array.", payload: null, api: null, rowCount: 0 };
  if (OPERATION_RECORD_KINDS.has(recordKind)) {
    if (rows.length < 1 || rows.length > 2000) return { error: "Production / FG Dispatch requests allow 1 to 2,000 rows.", payload: null, api: null, rowCount: rows.length };
    return {
      error: "", api: "operations", rowCount: rows.length,
      payload: { company_id: companyId, record_kind: recordKind, source_system: sourceSystem, source_file_key: sourceFileKey, source_file_name: sourceFileName || null, source_sheet_name: sourceSheetName, rows },
    };
  }
  const choice = PROCUREMENT_IMPORT_CHOICES[recordKind];
  if (!choice) return { error: "Choose a supported historical import type.", payload: null, api: null, rowCount: rows.length };
  if (rows.length < 1 || rows.length > 500) return { error: "Historical procurement requests allow 1 to 500 combined records.", payload: null, api: null, rowCount: rows.length };
  const sourceExtractedAt = String(input.sourceExtractedAt ?? "").trim();
  if (recordKind === "PRODUCT_REFERENCE_SNAPSHOT" && !sourceExtractedAt) {
    return { error: "Product Database Reference Snapshot requires the source extraction timestamp.", payload: null, api: null, rowCount: rows.length };
  }
  const extractedAt = sourceExtractedAt ? new Date(sourceExtractedAt) : null;
  if (sourceExtractedAt && (!extractedAt || !Number.isFinite(extractedAt.getTime()))) {
    return { error: "Source extraction timestamp is invalid.", payload: null, api: null, rowCount: rows.length };
  }
  return {
    error: "", api: "procurement", rowCount: rows.length,
    payload: {
      company_id: companyId, source_system: sourceSystem, source_file_key: sourceFileKey, source_file_name: sourceFileName || null,
      source_sheet_name: sourceSheetName, source_extracted_at: extractedAt ? extractedAt.toISOString() : null,
      purchase_orders: recordKind === "PURCHASE_ORDER" ? rows : [],
      purchase_order_lines: recordKind === "PURCHASE_ORDER_LINE" ? rows : [],
      consignment_movements: recordKind === "CONSIGNMENT_MOVEMENT" ? rows : [],
      product_reference_snapshots: recordKind === "PRODUCT_REFERENCE_SNAPSHOT" ? rows : [],
    },
  };
}

export function importSummary(result) {
  const summary = result?.summary ?? {};
  const number = (key, fallback = "—") => Number.isFinite(Number(summary[key])) ? String(summary[key]) : fallback;
  return {
    submitted: number("submitted_count", number("submitted_row_count", number("received_count", number("row_count")))),
    stored: number("stored_count", number("storable_row_count")),
    validated: number("validated_count", number("validated_row_count", number("valid_count", number("importable_count")))),
    unmapped: number("unmapped_count", number("unmapped_row_count")),
    quarantined: number("quarantined_count", number("quarantined_row_count")),
    warnings: number("warning_count", number("exception_count", Array.isArray(result?.issues) ? String(result.issues.filter((row) => row?.severity === "WARNING").length) : "—")),
    errors: number("error_count", Array.isArray(result?.issues) ? String(result.issues.filter((row) => row?.severity === "ERROR").length) : "—"),
    quantitiesByUom: summary.quantities_by_uom && typeof summary.quantities_by_uom === "object" ? summary.quantities_by_uom : {},
  };
}
