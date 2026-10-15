/*
 * File-Path: supabase/functions/api/_core/procurement/historical_operations.handlers.ts
 * Domain: PROCUREMENT / MTS PLANNING
 * Purpose: controlled historical actuals import and unified planning read.
 *
 * This module is intentionally reporting-only.  It has no stock-posting call,
 * and reads live dispatch exclusively from the posted stock ledger.
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import {
  aggregateActuals,
  duplicateSourceRowKeys,
  HISTORY_CUTOVER,
  isExplicitlyCancelled,
  kgFactorForUom,
  MAX_IMPORT_ROWS,
  monthStart,
  normalizeExternalSku,
  normalizeHistoricalDate,
  normalizeNonNegativeQuantity,
  normalizeSourceRowNumber,
  normalizeUom,
  stableSourceRowKey,
  text,
  type ActualAggregationInput,
  type HistoricalRecordKind,
  type HistoricalRowIssue,
} from "./historical_operations.logic.ts";
import { parseMonthList } from "./mts_customer_plan.logic.ts";

type JsonRecord = Record<string, unknown>;
type HistoricalContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const RESOURCE_PAGE = "PROC_MTS_CUSTOMER_PLAN";
const RESOURCE_MAINTAIN = "PROC_MTS_CUSTOMER_PLAN_MAINTAIN";
const MAX_MONTHS = 60;
const WRITE_CHUNK_SIZE = 250;

function historyError(req: Request, ctx: HistoricalContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}
function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}
async function resolveCompany(ctx: HistoricalContext, value: unknown): Promise<string> {
  const companyId = text(value);
  if (!companyId) return "";
  await assertCompanyScope(ctx, companyId);
  return companyId;
}
async function requireHistoricalView(req: Request, ctx: HistoricalContext, companyId: string): Promise<Response | null> {
  const allowed = await canMaintainCompanyResource(ctx, companyId, RESOURCE_PAGE, "VIEW");
  return allowed ? null : historyError(req, ctx, "HISTORY_ACTUALS_FORBIDDEN", 403, "You do not have access to Planning Actuals for this company.");
}
async function requireHistoricalImport(req: Request, ctx: HistoricalContext, companyId: string): Promise<Response | null> {
  const allowed = await canMaintainCompanyResource(ctx, companyId, RESOURCE_MAINTAIN, "WRITE");
  return allowed ? null : historyError(req, ctx, "HISTORY_IMPORT_FORBIDDEN", 403, "You do not have permission to import historical actuals for this company.");
}
function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}
function chunks<T>(rows: T[], size = WRITE_CHUNK_SIZE): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size));
  return result;
}
function sha256(value: unknown): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))
    .then((buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
}
function materialLabel(row: JsonRecord | undefined, fallback: string): string {
  return text(row?.material_name) || fallback || "—";
}
function kindOf(value: unknown): HistoricalRecordKind | null {
  const kind = text(value).toUpperCase();
  return kind === "PRODUCTION" || kind === "FG_DISPATCH" ? kind : null;
}
function dispatchCategory(value: unknown): "DIRECT" | "DEPOT" | null {
  const category = text(value).toUpperCase();
  return category === "DIRECT" || category === "DEPOT" ? category : null;
}

type ImportRequest = {
  company_id: string;
  record_kind: HistoricalRecordKind;
  source_system: string;
  source_file_key: string;
  source_file_name: string | null;
  source_sheet_name: string;
  rows: JsonRecord[];
};

function parseImportRequest(body: JsonRecord): { request?: ImportRequest; error?: string } {
  const kind = kindOf(body.record_kind);
  const companyId = text(body.company_id);
  const fileKey = text(body.source_file_key);
  const sheet = text(body.source_sheet_name);
  const sourceSystem = text(body.source_system) || "HISTORICAL_FILE";
  const rawRows = Array.isArray(body.rows) ? body.rows.map(asRecord).filter((row): row is JsonRecord => Boolean(row)) : [];
  if (!companyId) return { error: "company_id is required." };
  if (!kind) return { error: "record_kind must be PRODUCTION or FG_DISPATCH." };
  if (!fileKey) return { error: "source_file_key is required and must remain stable for corrections." };
  if (!sheet) return { error: "source_sheet_name is required." };
  if (rawRows.length === 0) return { error: "At least one source row is required." };
  if (rawRows.length > MAX_IMPORT_ROWS) return { error: `At most ${MAX_IMPORT_ROWS} rows may be submitted at once.` };
  return { request: { company_id: companyId, record_kind: kind, source_system: sourceSystem, source_file_key: fileKey, source_file_name: text(body.source_file_name) || null, source_sheet_name: sheet, rows: rawRows } };
}

type MaterialMap = Map<string, JsonRecord | null>;
type ConversionMap = Map<string, number>;

async function loadMaterialMap(companyId: string, skus: string[]): Promise<{ materials: MaterialMap; conversions: ConversionMap }> {
  const uniqueSkus = [...new Set(skus.filter(Boolean))];
  if (uniqueSkus.length === 0) return { materials: new Map(), conversions: new Map() };
  const candidates = await fetchInChunks<JsonRecord>(uniqueSkus, (chunk) => serviceRoleClient.schema("erp_master")
    .from("material_master").select("id, external_code, material_name, base_uom_code, material_type")
    .in("external_code", chunk));
  const bySku = new Map<string, JsonRecord[]>();
  for (const row of candidates) {
    const sku = text(row.external_code);
    bySku.set(sku, [...(bySku.get(sku) ?? []), row]);
  }
  const candidateIds = [...new Set(candidates.map((row) => text(row.id)).filter(Boolean))];
  const extensions = candidateIds.length === 0 ? [] : await fetchInChunks<JsonRecord>(candidateIds, (chunk) => serviceRoleClient.schema("erp_master")
    .from("material_company_ext").select("material_id, status").eq("company_id", companyId).in("material_id", chunk));
  const activeCompanyMaterialIds = new Set(extensions.filter((row) => text(row.status).toUpperCase() === "ACTIVE").map((row) => text(row.material_id)));
  const materials: MaterialMap = new Map();
  for (const sku of uniqueSkus) {
    const matches = (bySku.get(sku) ?? []).filter((row) => activeCompanyMaterialIds.has(text(row.id)));
    materials.set(sku, matches.length === 1 ? matches[0] : null);
  }
  const mappedIds = [...new Set([...materials.values()].filter((row): row is JsonRecord => Boolean(row)).map((row) => text(row.id)))];
  const conversionRows = mappedIds.length === 0 ? [] : await fetchInChunks<JsonRecord>(mappedIds, (chunk) => serviceRoleClient.schema("erp_master")
    .from("material_uom_conversion")
    .select("material_id, from_uom_code, to_uom_code, conversion_factor, variable_conversion, active")
    .eq("to_uom_code", "KG").eq("active", true).eq("variable_conversion", false).in("material_id", chunk));
  const conversions: ConversionMap = new Map();
  for (const row of conversionRows) {
    const factor = Number(row.conversion_factor);
    if (Number.isFinite(factor) && factor > 0) conversions.set(`${text(row.material_id)}|${text(row.from_uom_code).toUpperCase()}`, factor);
  }
  return { materials, conversions };
}

type PreparedRow = {
  row: JsonRecord;
  row_number: number | null;
  line_key: string;
  sku: string | null;
  material: JsonRecord | null;
  source_date: string | null;
  date: string | null;
  quantity: number | null;
  uom: string | null;
  normalized_kg: number | null;
  cancelled: boolean;
  validation_status: "VALIDATED" | "UNMAPPED" | "QUARANTINED";
  issues: HistoricalRowIssue[];
};

function dateField(kind: HistoricalRecordKind): string {
  return kind === "PRODUCTION" ? "production_date" : "dispatch_date";
}

function prepareRows(request: ImportRequest, materials: MaterialMap, conversions: ConversionMap): PreparedRow[] {
  const duplicates = duplicateSourceRowKeys(request.rows);
  return request.rows.map((row) => {
    const rowNumber = normalizeSourceRowNumber(row.source_row_number);
    const lineKey = text(row.source_line_key);
    const issues: HistoricalRowIssue[] = [];
    if (!rowNumber) issues.push({ code: "HISTORY_SOURCE_ROW_REQUIRED", message: "source_row_number must be a positive integer." });
    if (rowNumber && duplicates.has(stableSourceRowKey(rowNumber, lineKey))) {
      issues.push({ code: "HISTORY_DUPLICATE_SOURCE_ROW", message: "The same source row identity appears more than once in this submission." });
    }
    const skuResult = normalizeExternalSku(row.external_sku);
    if (skuResult.issue) issues.push(skuResult.issue);
    const sourceDate = text(row[dateField(request.record_kind)]) || null;
    const date = normalizeHistoricalDate(sourceDate);
    if (!date) issues.push({ code: "HISTORY_DATE_INVALID", message: `Historical ${dateField(request.record_kind)} must be a valid date through 2026-09-30.` });
    const quantity = normalizeNonNegativeQuantity(row.original_quantity ?? row.quantity);
    if (quantity === null) issues.push({ code: "HISTORY_QUANTITY_INVALID", message: "Original quantity must be a non-negative number." });
    const uom = normalizeUom(row.original_uom ?? row.uom);
    if (!uom) issues.push({ code: "HISTORY_UOM_REQUIRED", message: "Original UOM is required." });
    const material = skuResult.sku && !skuResult.issue ? materials.get(skuResult.sku) ?? null : null;
    const cancelled = request.record_kind === "FG_DISPATCH" && isExplicitlyCancelled(row);
    let status: PreparedRow["validation_status"] = "VALIDATED";
    let normalizedKg: number | null = null;
    if (!material && skuResult.sku && skuResult.sku !== "00000000000") {
      status = "UNMAPPED";
      issues.push({ code: "HISTORY_SKU_UNMAPPED", message: "External SKU has no unique active material mapping for this company." });
    }
    if (material && quantity !== null && uom) {
      const factor = kgFactorForUom(uom, conversions.get(`${text(material.id)}|${uom}`) ?? null);
      if (factor === null) {
        issues.push({ code: "HISTORY_UOM_CONVERSION_MISSING", message: `No verified fixed conversion from ${uom} to KG exists for the mapped material.` });
      } else {
        normalizedKg = Math.round(quantity * factor * 1_000_000) / 1_000_000;
      }
    }
    const fatal = issues.some((issue) => ["HISTORY_SOURCE_ROW_REQUIRED", "HISTORY_DUPLICATE_SOURCE_ROW", "HISTORY_SKU_REQUIRED", "HISTORY_SKU_MUST_BE_TEXT", "HISTORY_DATE_INVALID", "HISTORY_QUANTITY_INVALID", "HISTORY_UOM_REQUIRED", "HISTORY_UOM_CONVERSION_MISSING", "HISTORY_UNKNOWN_SKU"].includes(issue.code));
    if (fatal) status = "QUARANTINED";
    return { row, row_number: rowNumber, line_key: lineKey, sku: skuResult.sku, material, source_date: sourceDate, date, quantity, uom, normalized_kg: normalizedKg, cancelled, validation_status: status, issues };
  });
}

function exceptionPayload(request: ImportRequest, batchId: string, prepared: PreparedRow): JsonRecord[] {
  return prepared.issues.map((issue) => ({
    import_batch_id: batchId, company_id: request.company_id, record_kind: request.record_kind,
    source_file_key: request.source_file_key, source_sheet_name: request.source_sheet_name,
    source_row_number: prepared.row_number, source_line_key: prepared.line_key,
    exception_code: issue.code, exception_message: issue.message,
    source_payload: prepared.row, validation_metadata: { validation_status: prepared.validation_status },
  }));
}

function tablePayload(request: ImportRequest, batchId: string, prepared: PreparedRow): JsonRecord | null {
  if (!prepared.row_number || !prepared.sku) return null;
  const common = {
    company_id: request.company_id, first_import_batch_id: batchId, last_import_batch_id: batchId,
    source_system: request.source_system, source_file_key: request.source_file_key,
    source_sheet_name: request.source_sheet_name, source_row_number: prepared.row_number, source_line_key: prepared.line_key,
    external_sku: prepared.sku, material_id: prepared.material ? text(prepared.material.id) : null,
    original_quantity: prepared.quantity, original_uom: prepared.uom, validation_status: prepared.validation_status,
    source_payload: prepared.row, validation_metadata: { issues: prepared.issues.map((issue) => issue.code) },
  };
  if (request.record_kind === "PRODUCTION") return {
    ...common, source_production_date: prepared.source_date, production_date: prepared.date,
    plant_source_id: text(prepared.row.plant_id ?? prepared.row.plant) || null,
    prodshade: text(prepared.row.prodshade) || null, product_description: text(prepared.row.product_description) || null,
    shift: text(prepared.row.shift) || null, machine: text(prepared.row.machine) || null,
    stroke_reference: text(prepared.row.stroke ?? prepared.row.stroke_reference) || null,
    process_order_reference: text(prepared.row.process_order_reference ?? prepared.row.po_reference) || null,
    normalized_kg: prepared.normalized_kg,
  };
  return {
    ...common, source_dispatch_date: prepared.source_date, dispatch_date: prepared.date,
    product_description: text(prepared.row.product_description) || null,
    dispatch_category: dispatchCategory(prepared.row.dispatch_category), mdn: text(prepared.row.mdn) || null,
    invoice_number: text(prepared.row.invoice_number) || null, order_reference: text(prepared.row.order_reference) || null,
    consignee: text(prepared.row.consignee) || null, depot_code: text(prepared.row.depot_code) || null,
    normalized_dispatched_kg: prepared.normalized_kg, original_dispatch_status: text(prepared.row.original_dispatch_status ?? prepared.row.dispatch_status) || null,
    cancellation_flag: prepared.cancelled,
    stock_posting_status: ["POSTED", "NOT_POSTED"].includes(text(prepared.row.stock_posting_status).toUpperCase()) ? text(prepared.row.stock_posting_status).toUpperCase() : "UNKNOWN",
    stock_posting_evidence: asRecord(prepared.row.stock_posting_evidence) ?? {},
  };
}

async function validateImport(request: ImportRequest): Promise<PreparedRow[]> {
  const provisionalSkus = request.rows.map((row) => typeof row.external_sku === "string" ? text(row.external_sku) : "").filter(Boolean);
  const { materials, conversions } = await loadMaterialMap(request.company_id, provisionalSkus);
  return prepareRows(request, materials, conversions);
}

function importSummary(prepared: PreparedRow[]) {
  const imported = prepared.filter((row) => Boolean(row.row_number && row.sku));
  const exceptions = prepared.flatMap((row) => row.issues);
  const validKg = imported.filter((row) => row.validation_status === "VALIDATED" && !row.cancelled)
    .reduce((sum, row) => sum + Number(row.normalized_kg ?? 0), 0);
  return {
    submitted_row_count: prepared.length,
    importable_row_count: imported.length,
    exception_count: exceptions.length,
    validated_kg_total: Math.round(validKg * 1_000_000) / 1_000_000,
    cancelled_row_count: imported.filter((row) => row.cancelled).length,
    quarantined_row_count: imported.filter((row) => row.validation_status === "QUARANTINED").length,
    unmapped_row_count: imported.filter((row) => row.validation_status === "UNMAPPED").length,
  };
}

// POST /api/procurement/mts-plan/historical-import/dry-run
export async function dryRunHistoricalImportHandler(req: Request, ctx: HistoricalContext): Promise<Response> {
  try {
    const parsed = parseImportRequest(await parseBody(req));
    if (!parsed.request) return historyError(req, ctx, "HISTORY_IMPORT_INVALID", 400, parsed.error ?? "Invalid import request.");
    const companyId = await resolveCompany(ctx, parsed.request.company_id);
    if (!companyId) return historyError(req, ctx, "HISTORY_IMPORT_COMPANY_REQUIRED", 400, "company_id is required.");
    const accessError = await requireHistoricalImport(req, ctx, companyId);
    if (accessError) return accessError;
    const prepared = await validateImport(parsed.request);
    return okResponse({ dry_run: true, summary: importSummary(prepared), rows: prepared.map((row) => ({ source_row_number: row.row_number, source_line_key: row.line_key, external_sku: row.sku, validation_status: row.validation_status, normalized_kg: row.normalized_kg, cancelled: row.cancelled, issues: row.issues })) }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "HISTORY_IMPORT_DRY_RUN_FAILED";
    if (code === "COMPANY_SCOPE_VIOLATION") return historyError(req, ctx, code, 403, "Company is outside your scope.");
    return historyError(req, ctx, "HISTORY_IMPORT_DRY_RUN_FAILED", 500, "Could not validate the historical import.");
  }
}

// POST /api/procurement/mts-plan/historical-import/commit
export async function commitHistoricalImportHandler(req: Request, ctx: HistoricalContext): Promise<Response> {
  try {
    const parsed = parseImportRequest(await parseBody(req));
    if (!parsed.request) return historyError(req, ctx, "HISTORY_IMPORT_INVALID", 400, parsed.error ?? "Invalid import request.");
    const companyId = await resolveCompany(ctx, parsed.request.company_id);
    if (!companyId) return historyError(req, ctx, "HISTORY_IMPORT_COMPANY_REQUIRED", 400, "company_id is required.");
    const accessError = await requireHistoricalImport(req, ctx, companyId);
    if (accessError) return accessError;
    const prepared = await validateImport(parsed.request);
    const summary = importSummary(prepared);
    const checksum = await sha256({ request: { ...parsed.request, rows: undefined }, rows: parsed.request.rows });
    const { data: batch, error: batchError } = await serviceRoleClient.schema("erp_history").from("import_batch").insert({
      company_id: companyId, record_kind: parsed.request.record_kind, source_system: parsed.request.source_system,
      source_file_key: parsed.request.source_file_key, source_file_name: parsed.request.source_file_name,
      source_sheet_name: parsed.request.source_sheet_name, source_checksum: checksum, submitted_row_count: summary.submitted_row_count,
      created_by: ctx.auth_user_id, reconciliation: summary, validation_metadata: { dry_run_revalidated: true },
    }).select("id").single();
    if (batchError || !batch?.id) throw new Error("HISTORY_IMPORT_BATCH_CREATE_FAILED");
    const batchId = text(batch.id);
    try {
      const records = prepared.map((row) => tablePayload(parsed.request!, batchId, row)).filter((row): row is JsonRecord => Boolean(row));
      const exceptions = prepared.flatMap((row) => exceptionPayload(parsed.request!, batchId, row));
      const target = parsed.request.record_kind === "PRODUCTION" ? "production_actual" : "fg_dispatch_actual";
      const recordWrites = await Promise.all(chunks(records).map((chunk) => serviceRoleClient.schema("erp_history").from(target).upsert(chunk, {
        onConflict: "company_id,source_system,source_file_key,source_sheet_name,source_row_number,source_line_key",
      })));
      if (recordWrites.some((result) => result.error)) throw new Error("HISTORY_IMPORT_UPSERT_FAILED");
      const exceptionWrites = await Promise.all(chunks(exceptions).map((chunk) => serviceRoleClient.schema("erp_history").from("import_exception").insert(chunk)));
      if (exceptionWrites.some((result) => result.error)) throw new Error("HISTORY_IMPORT_EXCEPTION_WRITE_FAILED");
      const status = summary.exception_count > 0 ? "COMMITTED_WITH_EXCEPTIONS" : "COMMITTED";
      const { error: finishError } = await serviceRoleClient.schema("erp_history").from("import_batch").update({
        status, imported_row_count: records.length, exception_row_count: exceptions.length,
        normalized_kg_total: summary.validated_kg_total, committed_at: new Date().toISOString(),
      }).eq("id", batchId);
      if (finishError) throw new Error("HISTORY_IMPORT_BATCH_FINISH_FAILED");
      return okResponse({ batch_id: batchId, status, summary }, ctx.request_id, req);
    } catch (error) {
      await serviceRoleClient.schema("erp_history").from("import_batch").update({ status: "FAILED", validation_metadata: { failure: error instanceof Error ? error.message : "unknown" } }).eq("id", batchId);
      throw error;
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "HISTORY_IMPORT_COMMIT_FAILED";
    if (code === "COMPANY_SCOPE_VIOLATION") return historyError(req, ctx, code, 403, "Company is outside your scope.");
    return historyError(req, ctx, "HISTORY_IMPORT_COMMIT_FAILED", 500, "Could not commit the historical import.");
  }
}

async function loadMaterials(ids: string[]): Promise<Map<string, JsonRecord>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await fetchInChunks<JsonRecord>(unique, (chunk) => serviceRoleClient.schema("erp_master").from("material_master")
    .select("id, external_sku, material_name, base_uom_code, material_type").in("id", chunk));
  return new Map(rows.map((row) => [text(row.id), row]));
}

function selectedMonths(months: string[]): Set<string> {
  return new Set(months);
}

async function loadHistoricalActuals(companyId: string, fromDate: string, toExclusive: string, monthSet: Set<string>): Promise<{ rows: ActualAggregationInput[]; warnings: JsonRecord[] }> {
  const [productionResult, dispatchResult, batchesResult] = await Promise.all([
    serviceRoleClient.schema("erp_history").from("production_actual")
      .select("production_date, external_sku, material_id, prodshade, normalized_kg")
      .eq("company_id", companyId).eq("validation_status", "VALIDATED").gte("production_date", fromDate).lt("production_date", toExclusive),
    serviceRoleClient.schema("erp_history").from("fg_dispatch_actual")
      .select("dispatch_date, external_sku, material_id, normalized_dispatched_kg")
      .eq("company_id", companyId).eq("validation_status", "VALIDATED").eq("cancellation_flag", false).gte("dispatch_date", fromDate).lt("dispatch_date", toExclusive),
    serviceRoleClient.schema("erp_history").from("import_batch")
      .select("record_kind").eq("company_id", companyId).in("record_kind", ["PRODUCTION", "FG_DISPATCH"]).in("status", ["COMMITTED", "COMMITTED_WITH_EXCEPTIONS"]),
  ]);
  if (productionResult.error || dispatchResult.error || batchesResult.error) throw new Error("HISTORY_ACTUALS_READ_FAILED");
  const production = (productionResult.data ?? []) as JsonRecord[];
  const dispatch = (dispatchResult.data ?? []) as JsonRecord[];
  const materialById = await loadMaterials([...production, ...dispatch].map((row) => text(row.material_id)).filter(Boolean));
  const rows: ActualAggregationInput[] = [];
  for (const row of production) {
    const date = text(row.production_date); const month = monthStart(date); if (!monthSet.has(month)) continue;
    const material = materialById.get(text(row.material_id)); const sku = text(row.external_sku);
    rows.push({ month, identity_key: text(row.material_id) || `SKU:${sku}`, identity_level: "SKU", material_id: text(row.material_id) || null, external_sku: sku || null, material_label: materialLabel(material, sku), prodshade: text(row.prodshade) || null, source_classification: "HISTORICAL", production_kg: Number(row.normalized_kg ?? 0) });
  }
  for (const row of dispatch) {
    const date = text(row.dispatch_date); const month = monthStart(date); if (!monthSet.has(month)) continue;
    const material = materialById.get(text(row.material_id)); const sku = text(row.external_sku);
    rows.push({ month, identity_key: text(row.material_id) || `SKU:${sku}`, identity_level: "SKU", material_id: text(row.material_id) || null, external_sku: sku || null, material_label: materialLabel(material, sku), prodshade: null, source_classification: "HISTORICAL", dispatch_kg: Number(row.normalized_dispatched_kg ?? 0) });
  }
  const { count: incompleteCount } = await serviceRoleClient.schema("erp_history").from("import_exception")
    .select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("resolved_at", null);
  const importedKinds = new Set((batchesResult.data ?? []).map((row: unknown) => text((row as JsonRecord).record_kind)));
  const warnings: JsonRecord[] = [];
  if (!importedKinds.has("PRODUCTION")) warnings.push({ code: "HISTORY_PRODUCTION_COVERAGE_MISSING", count: 1, message: "No committed historical Production import covers this historical period; blank is not zero." });
  if (!importedKinds.has("FG_DISPATCH")) warnings.push({ code: "HISTORY_DISPATCH_COVERAGE_MISSING", count: 1, message: "No committed historical FG Dispatch import covers this historical period; blank is not zero." });
  if (incompleteCount) warnings.push({ code: "HISTORY_DATA_QUALITY", count: incompleteCount, message: `${incompleteCount} unresolved historical import exception(s) are excluded from actual totals.` });
  return { rows, warnings };
}

async function loadLiveProductionActuals(companyId: string, fromDate: string, toExclusive: string, monthSet: Set<string>): Promise<{ rows: ActualAggregationInput[]; warnings: JsonRecord[] }> {
  const { data, error } = await serviceRoleClient.schema("erp_production").from("process_order")
    .select("material_id, production_date, actual_qty").eq("company_id", companyId).eq("po_type", "MTS").eq("status", "VERIFIED")
    .gte("production_date", fromDate).lt("production_date", toExclusive);
  if (error) throw new Error("LIVE_PRODUCTION_ACTUALS_READ_FAILED");
  const orders = (data ?? []) as JsonRecord[];
  const materialById = await loadMaterials(orders.map((row) => text(row.material_id)));
  const rows: ActualAggregationInput[] = [];
  const skipped = new Set<string>();
  for (const row of orders) {
    const date = text(row.production_date); const month = monthStart(date); if (!monthSet.has(month)) continue;
    const materialId = text(row.material_id); const material = materialById.get(materialId);
    if (text(material?.base_uom_code).toUpperCase() !== "KG") { skipped.add(materialId); continue; }
    rows.push({ month, identity_key: materialId, identity_level: "PRODSHADE", material_id: materialId, external_sku: text(material?.external_sku) || null, material_label: materialLabel(material, "—"), prodshade: materialLabel(material, "—"), source_classification: "ERP_LIVE", production_kg: Number(row.actual_qty ?? 0) });
  }
  return { rows, warnings: skipped.size ? [{ code: "LIVE_PRODUCTION_UOM_NOT_KG", count: skipped.size, message: "Verified process orders with a non-KG material base UOM were excluded." }] : [] };
}

async function loadMtsInvoiceMaterialKeys(invoiceIds: string[]): Promise<Set<string>> {
  if (invoiceIds.length === 0) return new Set();
  const invoiceLines = await fetchInChunks<JsonRecord>(invoiceIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_invoice_line")
    .select("invoice_id, material_id, so_line_id").in("invoice_id", chunk));
  const soLineIds = [...new Set(invoiceLines.map((row) => text(row.so_line_id)).filter(Boolean))];
  const soLines = soLineIds.length === 0 ? [] : await fetchInChunks<JsonRecord>(soLineIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order_line")
    .select("id, fg_type").in("id", chunk));
  const mtsSoLineIds = new Set(soLines.filter((row) => text(row.fg_type).toUpperCase() === "MTS").map((row) => text(row.id)));
  return new Set(invoiceLines.filter((row) => mtsSoLineIds.has(text(row.so_line_id))).map((row) => `${text(row.invoice_id)}|${text(row.material_id)}`));
}

async function loadLiveDispatchActuals(companyId: string, fromDate: string, toExclusive: string, monthSet: Set<string>): Promise<{ rows: ActualAggregationInput[]; warnings: JsonRecord[] }> {
  const { data: ledgers, error: ledgerError } = await serviceRoleClient.schema("erp_inventory").from("stock_ledger")
    .select("stock_document_id, material_id, posting_date, movement_type_code, direction, quantity, base_uom_code")
    .eq("company_id", companyId).in("movement_type_code", ["P601", "P602"]).gte("posting_date", fromDate).lt("posting_date", toExclusive);
  if (ledgerError) throw new Error("LIVE_DISPATCH_LEDGER_READ_FAILED");
  const ledgerRows = (ledgers ?? []) as JsonRecord[];
  const documentIds = [...new Set(ledgerRows.map((row) => text(row.stock_document_id)).filter(Boolean))];
  const docs = documentIds.length === 0 ? [] : await fetchInChunks<JsonRecord>(documentIds, (chunk) => serviceRoleClient.schema("erp_inventory").from("stock_document")
    .select("id, reference_document_type, reference_document_id").in("id", chunk));
  const docById = new Map(docs.map((row) => [text(row.id), row]));
  const invoiceIds = [...new Set(docs.filter((row) => ["SALES_INVOICE", "VDC_SALES_INVOICE"].includes(text(row.reference_document_type).toUpperCase())).map((row) => text(row.reference_document_id)).filter(Boolean))];
  const mtsInvoiceMaterial = await loadMtsInvoiceMaterialKeys(invoiceIds);
  const materialById = await loadMaterials(ledgerRows.map((row) => text(row.material_id)));
  const rows: ActualAggregationInput[] = [];
  let unclassified = 0;
  for (const ledger of ledgerRows) {
    const doc = docById.get(text(ledger.stock_document_id));
    const invoiceId = text(doc?.reference_document_id); const materialId = text(ledger.material_id);
    if (!invoiceId || !mtsInvoiceMaterial.has(`${invoiceId}|${materialId}`)) { unclassified += 1; continue; }
    const date = text(ledger.posting_date); const month = monthStart(date); if (!monthSet.has(month)) continue;
    if (text(ledger.base_uom_code).toUpperCase() !== "KG") { unclassified += 1; continue; }
    const material = materialById.get(materialId);
    const sign = text(ledger.movement_type_code).toUpperCase() === "P602" || text(ledger.direction).toUpperCase() === "IN" ? -1 : 1;
    rows.push({ month, identity_key: materialId, identity_level: "SKU", material_id: materialId, external_sku: text(material?.external_sku) || null, material_label: materialLabel(material, "—"), prodshade: null, source_classification: "ERP_LIVE", dispatch_kg: sign * Number(ledger.quantity ?? 0) });
  }
  return { rows, warnings: unclassified ? [{ code: "LIVE_DISPATCH_UNCLASSIFIED", count: unclassified, message: "Posted P601/P602 ledger event(s) without a resolvable MTS invoice line were excluded." }] : [] };
}

// GET /api/procurement/mts-plan/actuals
export async function getMtsPlanningActualsHandler(req: Request, ctx: HistoricalContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await resolveCompany(ctx, url.searchParams.get("company_id"));
    if (!companyId) return historyError(req, ctx, "HISTORY_ACTUALS_COMPANY_REQUIRED", 400, "company_id is required.");
    const accessError = await requireHistoricalView(req, ctx, companyId);
    if (accessError) return accessError;
    const { months, invalid } = parseMonthList(url.searchParams.get("months"));
    if (invalid.length || months.length === 0 || months.length > MAX_MONTHS) return historyError(req, ctx, "HISTORY_ACTUALS_MONTHS_INVALID", 400, "Select between 1 and 60 valid months.");
    const fromDate = months[0];
    const last = months[months.length - 1];
    const toExclusive = `${Number(last.slice(0, 4)) + (last.slice(5, 7) === "12" ? 1 : 0)}-${String(last.slice(5, 7) === "12" ? 1 : Number(last.slice(5, 7)) + 1).padStart(2, "0")}-01`;
    const monthSet = selectedMonths(months);
    const historicalEnd = fromDate < HISTORY_CUTOVER ? (toExclusive < HISTORY_CUTOVER ? toExclusive : HISTORY_CUTOVER) : fromDate;
    const liveStart = toExclusive > HISTORY_CUTOVER ? (fromDate > HISTORY_CUTOVER ? fromDate : HISTORY_CUTOVER) : toExclusive;
    const [historical, liveProduction, liveDispatch] = await Promise.all([
      fromDate < HISTORY_CUTOVER ? loadHistoricalActuals(companyId, fromDate, historicalEnd, monthSet) : Promise.resolve({ rows: [], warnings: [] as JsonRecord[] }),
      toExclusive > HISTORY_CUTOVER ? loadLiveProductionActuals(companyId, liveStart, toExclusive, monthSet) : Promise.resolve({ rows: [], warnings: [] as JsonRecord[] }),
      toExclusive > HISTORY_CUTOVER ? loadLiveDispatchActuals(companyId, liveStart, toExclusive, monthSet) : Promise.resolve({ rows: [], warnings: [] as JsonRecord[] }),
    ]);
    return okResponse({ company_id: companyId, months, cutover: HISTORY_CUTOVER, rows: aggregateActuals([...historical.rows, ...liveProduction.rows, ...liveDispatch.rows]), warnings: [...historical.warnings, ...liveProduction.warnings, ...liveDispatch.warnings] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "HISTORY_ACTUALS_FAILED";
    if (code === "COMPANY_SCOPE_VIOLATION") return historyError(req, ctx, code, 403, "Company is outside your scope.");
    return historyError(req, ctx, "HISTORY_ACTUALS_FAILED", 500, "Could not load unified Planning Actuals.");
  }
}
