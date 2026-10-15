/*
 * Historical Operations Data Foundation — pure validation and aggregation rules.
 * Historical records are reporting-only.  No function in this file posts stock.
 */

export const HISTORY_CUTOVER = "2026-10-01";
export const HISTORY_LAST_DATE = "2026-09-30";
export const MAX_IMPORT_ROWS = 2000;

export type HistoricalRecordKind = "PRODUCTION" | "FG_DISPATCH";

export type HistoricalRowIssue = {
  code: string;
  message: string;
};

export function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeHistoricalDate(value: unknown): string | null {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) return null;
  return raw <= HISTORY_LAST_DATE ? raw : null;
}

/**
 * Input spreadsheets must send SKU as a string.  A number may already have
 * lost leading zeroes and is therefore unsafe to map.
 */
export function normalizeExternalSku(value: unknown): { sku: string | null; issue?: HistoricalRowIssue } {
  if (typeof value !== "string") {
    return { sku: null, issue: { code: "HISTORY_SKU_MUST_BE_TEXT", message: "External SKU must be supplied as text so leading zeroes are preserved." } };
  }
  const sku = value.trim();
  if (!sku) return { sku: null, issue: { code: "HISTORY_SKU_REQUIRED", message: "External SKU is required." } };
  if (sku === "00000000000") {
    return { sku, issue: { code: "HISTORY_UNKNOWN_SKU", message: "SKU 00000000000 must be mapped manually and cannot be assigned automatically." } };
  }
  return { sku };
}

export function normalizeNonNegativeQuantity(value: unknown): number | null {
  if (value === null || value === undefined || text(value) === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1_000_000) / 1_000_000 : null;
}

export function normalizeUom(value: unknown): string | null {
  const unit = text(value).toUpperCase();
  return unit || null;
}

export function normalizeSourceRowNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function stableSourceRowKey(rowNumber: number, sourceLineKey: unknown): string {
  return `${rowNumber}|${text(sourceLineKey)}`;
}

export function duplicateSourceRowKeys(rows: Array<Record<string, unknown>>): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    const rowNumber = normalizeSourceRowNumber(row.source_row_number);
    if (!rowNumber) continue;
    const key = stableSourceRowKey(rowNumber, row.source_line_key);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return duplicates;
}

/** Only explicit cancellation evidence is honoured; CROSS CHECK is ignored. */
export function isExplicitlyCancelled(row: Record<string, unknown>): boolean {
  if (row.cancellation_flag === true || row.is_cancelled === true) return true;
  const status = text(row.original_dispatch_status ?? row.dispatch_status).toUpperCase();
  return status === "CANCELLED" || status === "CANCELED";
}

export function kgFactorForUom(
  uom: string | null,
  materialConversionFactor: number | null,
): number | null {
  if (uom === "KG") return 1;
  // This is the ERP's fixed, documented standard conversion, also used by
  // MTS plan entry.  Every other factor must come from material master.
  if (uom === "MT") return 1000;
  return materialConversionFactor && materialConversionFactor > 0 ? materialConversionFactor : null;
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export type ActualAggregationInput = {
  month: string;
  identity_key: string;
  identity_level: "SKU" | "PRODSHADE" | "UNMAPPED";
  material_id: string | null;
  external_sku: string | null;
  material_label: string;
  prodshade: string | null;
  source_classification: "HISTORICAL" | "ERP_LIVE";
  production_kg?: number;
  dispatch_kg?: number;
  has_production?: boolean;
  has_dispatch?: boolean;
};

export function aggregateActuals(rows: ActualAggregationInput[]): ActualAggregationInput[] {
  const grouped = new Map<string, ActualAggregationInput>();
  for (const row of rows) {
    const key = `${row.month}|${row.identity_key}|${row.source_classification}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.production_kg = Number(existing.production_kg ?? 0) + Number(row.production_kg ?? 0);
      existing.dispatch_kg = Number(existing.dispatch_kg ?? 0) + Number(row.dispatch_kg ?? 0);
      existing.has_production = existing.has_production || row.production_kg !== undefined || row.has_production === true;
      existing.has_dispatch = existing.has_dispatch || row.dispatch_kg !== undefined || row.has_dispatch === true;
    } else {
      grouped.set(key, {
        ...row,
        production_kg: Number(row.production_kg ?? 0), dispatch_kg: Number(row.dispatch_kg ?? 0),
        has_production: row.production_kg !== undefined || row.has_production === true,
        has_dispatch: row.dispatch_kg !== undefined || row.has_dispatch === true,
      });
    }
  }
  return [...grouped.values()].map((row) => ({
    ...row,
    production_kg: row.has_production ? Math.round(Number(row.production_kg ?? 0) * 1_000_000) / 1_000_000 : undefined,
    dispatch_kg: row.has_dispatch ? Math.round(Number(row.dispatch_kg ?? 0) * 1_000_000) / 1_000_000 : undefined,
  })).sort((a, b) => `${a.month}|${a.material_label}`.localeCompare(`${b.month}|${b.material_label}`));
}
