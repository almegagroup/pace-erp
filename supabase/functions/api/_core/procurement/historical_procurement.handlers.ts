/* Read-only historical procurement analytics. It never changes live PO/stock data. */
import type { ContextResolution } from "../../_pipeline/context.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { aggregateLeadTimes, type HistoricalLeadTimeInput } from "./historical_procurement.logic.ts";

type JsonRecord = Record<string, unknown>;
type HistoricalContext = { context: Extract<ContextResolution, { status: "RESOLVED" }>; request_id: string; auth_user_id: string; roleCode: string };
const RESOURCE_PAGE = "PROC_MTS_CUSTOMER_PLAN";
const RESOURCE_MAINTAIN = "PROC_MTS_CUSTOMER_PLAN_MAINTAIN";
const text = (value: unknown) => String(value ?? "").trim();
const asRows = (value: unknown): JsonRecord[] => Array.isArray(value) ? value as JsonRecord[] : [];
const historicalDate = (value: unknown) => {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date ? date : null;
};

function fail(req: Request, ctx: HistoricalContext, code: string, status: number, message: string) {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

type ProcurementImport = { company_id: string; source_system: string; source_file_key: string; source_file_name: string | null; source_sheet_name: string; purchase_orders: JsonRecord[]; purchase_order_lines: JsonRecord[]; consignment_movements: JsonRecord[] };
function importRequest(body: JsonRecord): ProcurementImport | null {
  const company_id = text(body.company_id); const source_file_key = text(body.source_file_key); const source_sheet_name = text(body.source_sheet_name);
  if (!company_id || !source_file_key || !source_sheet_name) return null;
  const purchase_orders = asRows(body.purchase_orders); const purchase_order_lines = asRows(body.purchase_order_lines); const consignment_movements = asRows(body.consignment_movements);
  return purchase_orders.length || purchase_order_lines.length || consignment_movements.length ? { company_id, source_system: text(body.source_system) || "GOOGLE_SHEETS", source_file_key, source_file_name: text(body.source_file_name) || null, source_sheet_name, purchase_orders, purchase_order_lines, consignment_movements } : null;
}
function sourceOk(row: JsonRecord) { return Number.isInteger(Number(row.source_row_number)) && Number(row.source_row_number) > 0; }
function procurementIssues(request: ProcurementImport) {
  const issues: Array<{ record_kind: string; source_row_number: number | null; exception_code: string; exception_message: string; source_payload: JsonRecord }> = [];
  for (const [kind, rows] of [["PURCHASE_ORDER", request.purchase_orders], ["PURCHASE_ORDER", request.purchase_order_lines], ["CONSIGNMENT_MOVEMENT", request.consignment_movements]] as const) for (const row of rows) {
    if (!sourceOk(row)) issues.push({ record_kind: kind, source_row_number: null, exception_code: "HISTORY_SOURCE_ROW_REQUIRED", exception_message: "A positive source_row_number is required.", source_payload: row });
    if (kind === "PURCHASE_ORDER" && !text(row.external_po_number)) issues.push({ record_kind: kind, source_row_number: Number(row.source_row_number) || null, exception_code: "HISTORY_PO_NUMBER_REQUIRED", exception_message: "external_po_number is required.", source_payload: row });
    for (const key of ["order_date", "dispatch_date", "etd_date", "atd_date", "eta_port_date", "ata_port_date", "boe_date", "lr_date", "inward_date"]) if (row[key] !== undefined && row[key] !== null && text(row[key]) && !historicalDate(row[key])) issues.push({ record_kind: kind, source_row_number: Number(row.source_row_number) || null, exception_code: "HISTORY_DATE_INVALID", exception_message: `${key} must be a valid ISO calendar date.`, source_payload: row });
  }
  for (const row of request.purchase_orders) if (text(row.supplier_name) && !text(row.vendor_id)) issues.push({ record_kind: "PURCHASE_ORDER", source_row_number: Number(row.source_row_number) || null, exception_code: "HISTORY_VENDOR_UNMAPPED", exception_message: "Supplier has no verified ERP vendor_id; it was not guessed.", source_payload: row });
  for (const row of request.purchase_order_lines) if (text(row.external_sku) && !text(row.material_id)) issues.push({ record_kind: "PURCHASE_ORDER", source_row_number: Number(row.source_row_number) || null, exception_code: "HISTORY_MATERIAL_UNMAPPED", exception_message: "Source SKU has no verified ERP material_id; it was not guessed.", source_payload: row });
  for (const row of request.consignment_movements) if (!text(row.purchase_order_line_id) && (!text(row.external_po_number) || !text(row.external_line_reference))) issues.push({ record_kind: "CONSIGNMENT_MOVEMENT", source_row_number: Number(row.source_row_number) || null, exception_code: "HISTORY_MOVEMENT_LINK_UNMAPPED", exception_message: "Movement cannot be linked to an imported PO line.", source_payload: row });
  return issues;
}

// POST /api/procurement/historical-procurement-import/dry-run
// POST /api/procurement/historical-procurement-import/commit
export async function historicalProcurementImportHandler(req: Request, ctx: HistoricalContext, commit: boolean): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({})) as JsonRecord; const parsed = importRequest(body);
    if (!parsed) return fail(req, ctx, "HISTORY_PROCUREMENT_IMPORT_INVALID", 400, "company, stable source identity and at least one source record are required.");
    await assertCompanyScope(ctx, parsed.company_id);
    if (!await canMaintainCompanyResource(ctx, parsed.company_id, RESOURCE_MAINTAIN, "WRITE")) return fail(req, ctx, "HISTORY_PROCUREMENT_IMPORT_FORBIDDEN", 403, "You do not have Historical Import access for this company.");
    const issues = procurementIssues(parsed);
    const summary = { purchase_orders: parsed.purchase_orders.length, purchase_order_lines: parsed.purchase_order_lines.length, consignment_movements: parsed.consignment_movements.length, exception_count: issues.length };
    // Source references must identify one and only one PO/line before any write.
    // The current import path is multi-request, not an atomic DB transaction:
    // fail closed on ambiguous or incomplete batches rather than silently
    // associating lines/shipments with the wrong purchase order.
    const headerCounts = new Map<string, number>();
    for (const row of parsed.purchase_orders) {
      const key = text(row.external_po_number);
      if (key) headerCounts.set(key, (headerCounts.get(key) ?? 0) + 1);
    }
    for (const row of parsed.purchase_orders) {
      if ((headerCounts.get(text(row.external_po_number)) ?? 0) > 1) {
        issues.push({ record_kind: "PURCHASE_ORDER", source_row_number: Number(row.source_row_number) || null, exception_code: "HISTORY_PO_AMBIGUOUS", exception_message: "Multiple source headers use this PO number; reconcile to one authoritative header before importing.", source_payload: row });
      }
    }
    const lineCounts = new Map<string, number>();
    for (const row of parsed.purchase_order_lines) {
      const key = `${text(row.external_po_number)}|${text(row.external_line_reference)}`;
      lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1);
      if (headerCounts.get(text(row.external_po_number)) !== 1) {
        issues.push({ record_kind: "PURCHASE_ORDER", source_row_number: Number(row.source_row_number) || null, exception_code: "HISTORY_PO_HEADER_UNRESOLVED", exception_message: "PO line has no unique header in this batch.", source_payload: row });
      }
    }
    for (const row of parsed.consignment_movements) {
      const key = `${text(row.external_po_number)}|${text(row.external_line_reference)}`;
      if (lineCounts.get(key) !== 1) {
        issues.push({ record_kind: "CONSIGNMENT_MOVEMENT", source_row_number: Number(row.source_row_number) || null, exception_code: "HISTORY_PO_LINE_UNRESOLVED", exception_message: "Movement has no unique PO line in this batch.", source_payload: row });
      }
    }
    summary.exception_count = issues.length;
    if (!commit) return okResponse({ dry_run: true, summary, issues }, ctx.request_id, req);
    if (issues.length) return fail(req, ctx, "HISTORY_PROCUREMENT_REVIEW_REQUIRED", 409, "Import blocked: resolve dry-run exceptions before committing a procurement batch.");
    const { data: batch, error: batchError } = await serviceRoleClient.schema("erp_history").from("import_batch").insert({ company_id: parsed.company_id, record_kind: "PURCHASE_ORDER", source_system: parsed.source_system, source_file_key: parsed.source_file_key, source_file_name: parsed.source_file_name, source_sheet_name: parsed.source_sheet_name, submitted_row_count: summary.purchase_orders + summary.purchase_order_lines + summary.consignment_movements, created_by: ctx.auth_user_id, reconciliation: summary }).select("id").single();
    if (batchError || !batch?.id) throw new Error("HISTORY_PROCUREMENT_BATCH_FAILED");
    const batchId = text(batch.id); const invalidRows = new Set(issues.map((issue) => `${issue.record_kind}|${issue.source_row_number}`));
    const headerPayload = parsed.purchase_orders.filter(sourceOk).map((row) => ({ company_id: parsed.company_id, first_import_batch_id: batchId, last_import_batch_id: batchId, source_system: parsed.source_system, source_file_key: parsed.source_file_key, source_sheet_name: parsed.source_sheet_name, source_row_number: Number(row.source_row_number), source_line_key: text(row.source_line_key), external_po_number: text(row.external_po_number), revised_po_number: text(row.revised_po_number) || null, order_date: historicalDate(row.order_date), supplier_name: text(row.supplier_name) || null, vendor_id: text(row.vendor_id) || null, supply_type: ["LOCAL", "IMPORT"].includes(text(row.supply_type).toUpperCase()) ? text(row.supply_type).toUpperCase() : null, payment_terms: text(row.payment_terms) || null, payment_days: Number.isFinite(Number(row.payment_days)) ? Number(row.payment_days) : null, currency_code: text(row.currency_code) || null, original_status: text(row.original_status) || null, cancellation_flag: row.cancellation_flag === true, validation_status: invalidRows.has(`PURCHASE_ORDER|${Number(row.source_row_number)}`) ? "QUARANTINED" : "VALIDATED", source_payload: row, validation_metadata: {} }));
    const headerWrite = await serviceRoleClient.schema("erp_history").from("purchase_order").upsert(headerPayload, { onConflict: "company_id,source_system,source_file_key,source_sheet_name,source_row_number,source_line_key" }).select("id, external_po_number");
    if (headerWrite.error) throw new Error("HISTORY_PROCUREMENT_HEADER_WRITE_FAILED");
    const headerByNumber = new Map(asRows(headerWrite.data).map((row) => [text(row.external_po_number), text(row.id)]));
    const linePayload = parsed.purchase_order_lines.filter(sourceOk).flatMap((row) => { const purchase_order_id = headerByNumber.get(text(row.external_po_number)); if (!purchase_order_id) return []; return [{ purchase_order_id, company_id: parsed.company_id, first_import_batch_id: batchId, last_import_batch_id: batchId, source_system: parsed.source_system, source_file_key: parsed.source_file_key, source_sheet_name: parsed.source_sheet_name, source_row_number: Number(row.source_row_number), source_line_key: text(row.source_line_key), external_line_reference: text(row.external_line_reference) || null, external_sku: text(row.external_sku) || null, material_id: text(row.material_id) || null, item_description: text(row.item_description) || null, original_quantity: Number.isFinite(Number(row.original_quantity)) ? Number(row.original_quantity) : null, original_uom: text(row.original_uom) || null, normalized_kg: Number.isFinite(Number(row.normalized_kg)) ? Number(row.normalized_kg) : null, unit_rate: Number.isFinite(Number(row.unit_rate)) ? Number(row.unit_rate) : null, validation_status: text(row.material_id) || !text(row.external_sku) ? "VALIDATED" : "UNMAPPED", source_payload: row, validation_metadata: {} }]; });
    let importedLines: JsonRecord[] = [];
    if (linePayload.length) { const write = await serviceRoleClient.schema("erp_history").from("purchase_order_line").upsert(linePayload, { onConflict: "company_id,source_system,source_file_key,source_sheet_name,source_row_number,source_line_key" }).select("id, purchase_order_id, external_line_reference"); if (write.error) throw new Error("HISTORY_PROCUREMENT_LINE_WRITE_FAILED"); importedLines = asRows(write.data); }
    const poNumberById = new Map(asRows(headerWrite.data).map((row) => [text(row.id), text(row.external_po_number)]));
    const lineByExternalKey = new Map(importedLines.map((row) => [`${poNumberById.get(text(row.purchase_order_id)) ?? ""}|${text(row.external_line_reference)}`, text(row.id)]));
    const movementPayload = parsed.consignment_movements.filter(sourceOk).map((row) => ({ purchase_order_line_id: text(row.purchase_order_line_id) || lineByExternalKey.get(`${text(row.external_po_number)}|${text(row.external_line_reference)}`) || null, company_id: parsed.company_id, first_import_batch_id: batchId, last_import_batch_id: batchId, source_system: parsed.source_system, source_file_key: parsed.source_file_key, source_sheet_name: parsed.source_sheet_name, source_row_number: Number(row.source_row_number), source_line_key: text(row.source_line_key), external_po_number: text(row.external_po_number) || null, external_line_reference: text(row.external_line_reference) || null, consignment_reference: text(row.consignment_reference) || null, invoice_number: text(row.invoice_number) || null, bl_number: text(row.bl_number) || null, mdn_number: text(row.mdn_number) || null, supply_type: ["LOCAL", "IMPORT"].includes(text(row.supply_type).toUpperCase()) ? text(row.supply_type).toUpperCase() : null, dispatch_date: historicalDate(row.dispatch_date), etd_date: historicalDate(row.etd_date), atd_date: historicalDate(row.atd_date), eta_port_date: historicalDate(row.eta_port_date), ata_port_date: historicalDate(row.ata_port_date), boe_date: historicalDate(row.boe_date), lr_date: historicalDate(row.lr_date), inward_date: historicalDate(row.inward_date), original_quantity: Number.isFinite(Number(row.original_quantity)) ? Number(row.original_quantity) : null, original_uom: text(row.original_uom) || null, normalized_kg: Number.isFinite(Number(row.normalized_kg)) ? Number(row.normalized_kg) : null, cancellation_flag: row.cancellation_flag === true, validation_status: invalidRows.has(`CONSIGNMENT_MOVEMENT|${Number(row.source_row_number)}`) ? "QUARANTINED" : text(row.purchase_order_line_id) || lineByExternalKey.has(`${text(row.external_po_number)}|${text(row.external_line_reference)}`) ? "VALIDATED" : "UNMAPPED", source_payload: row, validation_metadata: {} }));
    if (movementPayload.length) { const write = await serviceRoleClient.schema("erp_history").from("consignment_movement").upsert(movementPayload, { onConflict: "company_id,source_system,source_file_key,source_sheet_name,source_row_number,source_line_key" }); if (write.error) throw new Error("HISTORY_PROCUREMENT_MOVEMENT_WRITE_FAILED"); }
    const exceptionRows = issues.map((issue) => ({ import_batch_id: batchId, company_id: parsed.company_id, record_kind: issue.record_kind, source_file_key: parsed.source_file_key, source_sheet_name: parsed.source_sheet_name, source_row_number: issue.source_row_number, exception_code: issue.exception_code, exception_message: issue.exception_message, source_payload: issue.source_payload, validation_metadata: {} }));
    if (exceptionRows.length) { const write = await serviceRoleClient.schema("erp_history").from("import_exception").insert(exceptionRows); if (write.error) throw new Error("HISTORY_PROCUREMENT_EXCEPTION_WRITE_FAILED"); }
    const { error: finishError } = await serviceRoleClient.schema("erp_history").from("import_batch").update({ status: issues.length ? "COMMITTED_WITH_EXCEPTIONS" : "COMMITTED", imported_row_count: headerPayload.length + linePayload.length + movementPayload.length, exception_row_count: issues.length, committed_at: new Date().toISOString() }).eq("id", batchId);
    if (finishError) throw new Error("HISTORY_PROCUREMENT_BATCH_FINISH_FAILED");
    return okResponse({ batch_id: batchId, summary, issues }, ctx.request_id, req);
  } catch (error) { if (error instanceof Error && error.message === "COMPANY_SCOPE_VIOLATION") return fail(req, ctx, error.message, 403, "Company is outside your scope."); return fail(req, ctx, "HISTORY_PROCUREMENT_IMPORT_FAILED", 500, "Could not import historical procurement data."); }
}

// GET /api/procurement/historical/lead-times?company_id=...&group_by=COMPANY|VENDOR|MATERIAL
export async function getHistoricalLeadTimesHandler(req: Request, ctx: HistoricalContext): Promise<Response> {
  try {
    const url = new URL(req.url); const companyId = text(url.searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "HISTORY_LEAD_TIME_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    if (!await canMaintainCompanyResource(ctx, companyId, RESOURCE_PAGE, "VIEW")) return fail(req, ctx, "HISTORY_LEAD_TIME_FORBIDDEN", 403, "You do not have Planning access for this company.");
    const groupBy = text(url.searchParams.get("group_by")).toUpperCase() || "COMPANY";
    if (!["COMPANY", "VENDOR", "MATERIAL"].includes(groupBy)) return fail(req, ctx, "HISTORY_LEAD_TIME_GROUP_INVALID", 400, "group_by must be COMPANY, VENDOR or MATERIAL.");

    const { data: movements, error: movementError } = await serviceRoleClient.schema("erp_history").from("consignment_movement")
      .select("purchase_order_line_id, supply_type, dispatch_date, etd_date, atd_date, ata_port_date, boe_date, lr_date, inward_date, cancellation_flag, validation_status")
      .eq("company_id", companyId).eq("validation_status", "VALIDATED").eq("cancellation_flag", false);
    if (movementError) throw new Error("HISTORY_LEAD_TIME_MOVEMENT_READ_FAILED");
    const lineIds = [...new Set(asRows(movements).map((row) => text(row.purchase_order_line_id)).filter(Boolean))];
    const lines = lineIds.length ? await fetchInChunks<JsonRecord>(lineIds, (chunk) => serviceRoleClient.schema("erp_history").from("purchase_order_line").select("id, purchase_order_id, material_id").in("id", chunk)) : [];
    const lineById = new Map(lines.map((row) => [text(row.id), row]));
    const poIds = [...new Set(lines.map((row) => text(row.purchase_order_id)).filter(Boolean))];
    const orders = poIds.length ? await fetchInChunks<JsonRecord>(poIds, (chunk) => serviceRoleClient.schema("erp_history").from("purchase_order").select("id, vendor_id, order_date, supply_type, cancellation_flag, validation_status").in("id", chunk)) : [];
    const orderById = new Map(orders.map((row) => [text(row.id), row]));
    const input: HistoricalLeadTimeInput[] = asRows(movements).flatMap((movement) => {
      const line = lineById.get(text(movement.purchase_order_line_id)); const order = line ? orderById.get(text(line.purchase_order_id)) : null;
      if (!line || !order) return [];
      return [{ company_id: companyId, vendor_id: text(order.vendor_id) || null, material_id: text(line.material_id) || null,
        supply_type: text(movement.supply_type) || text(order.supply_type) || null, order_date: text(order.order_date) || null,
        dispatch_date: text(movement.dispatch_date) || null, etd_date: text(movement.etd_date) || null, atd_date: text(movement.atd_date) || null,
        ata_port_date: text(movement.ata_port_date) || null, boe_date: text(movement.boe_date) || null, lr_date: text(movement.lr_date) || null,
        inward_date: text(movement.inward_date) || null, cancellation_flag: Boolean(movement.cancellation_flag) || Boolean(order.cancellation_flag),
        validation_status: text(movement.validation_status) === "VALIDATED" && text(order.validation_status) === "VALIDATED" ? "VALIDATED" : "QUARANTINED" }];
    });
    return okResponse({ company_id: companyId, group_by: groupBy, rows: aggregateLeadTimes(input, groupBy as "COMPANY" | "VENDOR" | "MATERIAL"), warning: "Historical lead-time analytics are reporting-only and never update ERP lead-time masters." }, ctx.request_id, req);
  } catch (error) {
    if (error instanceof Error && error.message === "COMPANY_SCOPE_VIOLATION") return fail(req, ctx, error.message, 403, "Company is outside your scope.");
    return fail(req, ctx, "HISTORY_LEAD_TIME_FAILED", 500, "Could not calculate historical lead times.");
  }
}
