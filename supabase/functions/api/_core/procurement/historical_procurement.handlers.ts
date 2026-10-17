/*
 * Historical procurement import + lead-time analytics (erp_history only).
 * Never reads into or writes live PO / CSN / GRN / stock / GL records.
 *
 * Import: one RPC call = one PostgreSQL transaction. Validation, master
 * resolution (vendor_code / material_code -> company-active ids) and PO
 * header -> line -> movement linkage all happen inside
 * public.import_historical_procurement, so dry-run and commit can never
 * disagree and a failed commit leaves nothing behind. Lines and movements
 * may reference headers/lines committed in an EARLIER batch of the same
 * source_system (deterministic cross-batch linkage; import order:
 * headers -> lines -> movements).
 */
import type { ContextResolution } from "../../_pipeline/context.ts";
import { log } from "../../_lib/logger.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { aggregateLeadTimes, type HistoricalLeadTimeInput } from "./historical_procurement.logic.ts";
import { mapHistoryRpcError, requestChecksum, type HistoryRpcError } from "./historical_import.rpc.ts";

type JsonRecord = Record<string, unknown>;
type HistoricalContext = { context: Extract<ContextResolution, { status: "RESOLVED" }>; request_id: string; auth_user_id: string; roleCode: string };
const RESOURCE_PAGE = "PROC_MTS_CUSTOMER_PLAN";
// POTMP is deliberately its own import authority.  Historical procurement is
// not a PO21 planning-maintenance action and must never inherit that access.
const RESOURCE_IMPORT = "PROC_HISTORICAL_OPERATIONS_IMPORT";
const text = (value: unknown) => String(value ?? "").trim();
const asRows = (value: unknown): JsonRecord[] => Array.isArray(value) ? value as JsonRecord[] : [];

function fail(req: Request, ctx: HistoricalContext, code: string, status: number, message: string) {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

// POST /api/procurement/historical-procurement-import/dry-run
// POST /api/procurement/historical-procurement-import/commit
export async function historicalProcurementImportHandler(req: Request, ctx: HistoricalContext, commit: boolean): Promise<Response> {
  let companyId = "";
  let recordCount = 0;
  let checksum = "";
  try {
    const body = await req.json().catch(() => null) as JsonRecord | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail(req, ctx, "HISTORY_IMPORT_INVALID", 400, "A JSON object request body is required.");
    companyId = text(body.company_id);
    if (!companyId) return fail(req, ctx, "HISTORY_IMPORT_INVALID", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    if (!await canMaintainCompanyResource(ctx, companyId, RESOURCE_IMPORT, "WRITE")) {
      return fail(req, ctx, "HISTORY_PROCUREMENT_IMPORT_FORBIDDEN", 403, "You do not have Historical Import access for this company.");
    }
    const request = {
      company_id: companyId,
      source_system: body.source_system, source_file_key: body.source_file_key, source_file_name: body.source_file_name,
      source_sheet_name: body.source_sheet_name, source_extracted_at: body.source_extracted_at,
      purchase_orders: body.purchase_orders ?? [], purchase_order_lines: body.purchase_order_lines ?? [],
      consignment_movements: body.consignment_movements ?? [],
      product_reference_snapshots: body.product_reference_snapshots ?? [],
    };
    const requestArrays: unknown[] = [request.purchase_orders, request.purchase_order_lines, request.consignment_movements, request.product_reference_snapshots];
    recordCount = requestArrays.reduce<number>((count, rows) => count + (Array.isArray(rows) ? rows.length : 0), 0);
    checksum = await requestChecksum(request);
    const { data, error } = await serviceRoleClient.rpc("import_historical_procurement", {
      p_request: { ...request, checksum }, p_actor: ctx.auth_user_id, p_dry_run: !commit,
    });
    if (error) {
      const rpcError = error as HistoryRpcError;
      log({
        level: "ERROR", request_id: ctx.request_id, route_key: RESOURCE_IMPORT,
        event: "HISTORY_PROCUREMENT_IMPORT_RPC_FAILED", actor: ctx.auth_user_id,
        meta: {
          company_id: companyId, mode: commit ? "commit" : "dry_run", record_count: recordCount, checksum,
          rpc_error: { code: rpcError.code ?? null, message: rpcError.message ?? null, details: rpcError.details ?? null, hint: rpcError.hint ?? null },
        },
      });
      const mapped = mapHistoryRpcError(rpcError);
      return fail(req, ctx, mapped.code, mapped.status, mapped.message);
    }
    const result = (data ?? {}) as JsonRecord;
    if (commit && result.committed !== true) {
      return fail(req, ctx, "HISTORY_IMPORT_REVIEW_REQUIRED", 409, `Import blocked: ${Number((result.summary as JsonRecord | undefined)?.error_count ?? 0)} ERROR issue(s). Run dry-run, fix them, then commit again.`);
    }
    return okResponse({ ...result, checksum }, ctx.request_id, req);
  } catch (error) {
    if (error instanceof Error && error.message === "COMPANY_SCOPE_VIOLATION") return fail(req, ctx, error.message, 403, "Company is outside your scope.");
    log({
      level: "ERROR", request_id: ctx.request_id, route_key: RESOURCE_IMPORT,
      event: "HISTORY_PROCUREMENT_IMPORT_HANDLER_FAILED", actor: ctx.auth_user_id,
      meta: {
        company_id: companyId || null, mode: commit ? "commit" : "dry_run", record_count: recordCount, checksum: checksum || null,
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack ?? null } : String(error),
      },
    });
    return fail(req, ctx, "HISTORY_PROCUREMENT_IMPORT_FAILED", 500, "Could not import historical procurement data.");
  }
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

    // One jsonb result: no PostgREST 1,000-row truncation. The function
    // already keeps only VALIDATED, non-cancelled movements of non-cancelled POs.
    const { data, error } = await serviceRoleClient.rpc("history_lead_time_samples", { p_company_id: companyId });
    if (error) throw new Error("HISTORY_LEAD_TIME_READ_FAILED");
    const samples = asRows(data);
    const input: HistoricalLeadTimeInput[] = samples.map((row) => ({
      company_id: companyId, vendor_id: text(row.vendor_id) || null, material_id: text(row.material_id) || null,
      supply_type: text(row.supply_type) || null, order_date: text(row.order_date) || null,
      dispatch_date: text(row.dispatch_date) || null, etd_date: text(row.etd_date) || null, atd_date: text(row.atd_date) || null,
      ata_port_date: text(row.ata_port_date) || null, boe_date: text(row.boe_date) || null, lr_date: text(row.lr_date) || null,
      inward_date: text(row.inward_date) || null, cancellation_flag: false, validation_status: "VALIDATED",
    }));
    const rows = aggregateLeadTimes(input, groupBy as "COMPANY" | "VENDOR" | "MATERIAL");

    // R-01: resolve every group dimension to a readable label, never a raw id.
    const dimensionIds = [...new Set(rows.map((row) => row.group_key.split("|")[0]).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
    const labels = new Map<string, string>();
    if (dimensionIds.length && groupBy === "VENDOR") {
      const vendors = await fetchInChunks<JsonRecord>(dimensionIds, (chunk) => serviceRoleClient.schema("erp_master").from("vendor_master").select("id, vendor_code, vendor_name").in("id", chunk));
      for (const v of vendors) labels.set(text(v.id), [text(v.vendor_code), text(v.vendor_name)].filter(Boolean).join(" — "));
    } else if (dimensionIds.length && groupBy === "MATERIAL") {
      const materials = await fetchInChunks<JsonRecord>(dimensionIds, (chunk) => serviceRoleClient.schema("erp_master").from("material_master").select("id, pace_code, material_name").in("id", chunk));
      for (const m of materials) labels.set(text(m.id), [text(m.pace_code), text(m.material_name)].filter(Boolean).join(" — "));
    } else if (groupBy === "COMPANY") {
      const { data: company } = await serviceRoleClient.schema("erp_master").from("companies").select("id, company_code, company_name").eq("id", companyId).maybeSingle();
      if (company) labels.set(companyId, [text(company.company_code), text(company.company_name)].filter(Boolean).join(" — "));
    }
    const labelled = rows.map((row) => {
      const [dimension] = row.group_key.split("|");
      const label = dimension === "UNMAPPED_VENDOR" ? "Unmapped vendor" : dimension === "UNMAPPED_MATERIAL" ? "Unmapped material" : (labels.get(dimension) || "—");
      return { group_key: row.group_key, group_label: label, supply_type: row.supply_type, metrics: row.metrics };
    });
    return okResponse({ company_id: companyId, group_by: groupBy, sample_count: samples.length, rows: labelled,
      warning: "Historical lead-time analytics are reporting-only and never update ERP lead-time masters." }, ctx.request_id, req);
  } catch (error) {
    if (error instanceof Error && error.message === "COMPANY_SCOPE_VIOLATION") return fail(req, ctx, error.message, 403, "Company is outside your scope.");
    return fail(req, ctx, "HISTORY_LEAD_TIME_FAILED", 500, "Could not calculate historical lead times.");
  }
}

// GET /api/procurement/historical/procurement-evidence?company_id=&vendor_id=&material_id=
// A read-only planning reader.  It shows live ERP activity beside historical
// observations and Product_Data_Base defaults, without ever treating history
// as open supply, in-transit stock or a current commitment.
export async function getHistoricalProcurementEvidenceHandler(req: Request, ctx: HistoricalContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = text(url.searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "HISTORY_EVIDENCE_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    if (!await canMaintainCompanyResource(ctx, companyId, RESOURCE_PAGE, "VIEW")) return fail(req, ctx, "HISTORY_EVIDENCE_FORBIDDEN", 403, "You do not have Planning access for this company.");
    const vendorId = text(url.searchParams.get("vendor_id"));
    const materialId = text(url.searchParams.get("material_id"));

    let historyQuery = serviceRoleClient.schema("erp_history").from("purchase_order")
      .select("id, external_po_number, order_date, supplier_name, vendor_code, vendor_id, supply_type, payment_terms, payment_days, original_status, cancellation_flag, validation_status, analytical_window_included, dependency_outside_window")
      .eq("company_id", companyId).order("order_date", { ascending: false }).limit(500);
    if (vendorId) historyQuery = historyQuery.eq("vendor_id", vendorId);
    const { data: historyRows, error: historyError } = await historyQuery;
    if (historyError) throw historyError;
    const histories = (historyRows ?? []) as JsonRecord[];
    const historyIds = histories.map((row) => text(row.id)).filter(Boolean);
    const lineRows = historyIds.length ? await fetchInChunks<JsonRecord>(historyIds, (chunk) => serviceRoleClient.schema("erp_history").from("purchase_order_line")
      .select("purchase_order_id, material_id, material_code, item_description, original_quantity, original_uom, normalized_kg, validation_status, analytical_window_included, dependency_outside_window")
      .in("purchase_order_id", chunk)) : [];
    const lines = materialId ? lineRows.filter((row) => text(row.material_id) === materialId) : lineRows;
    const historyPoIds = new Set(lines.map((row) => text(row.purchase_order_id)).filter(Boolean));
    const filteredHistories = materialId ? histories.filter((row) => historyPoIds.has(text(row.id))) : histories;

    const poNumbers = [...new Set(filteredHistories.map((row) => text(row.external_po_number)).filter(Boolean))];
    const livePos = poNumbers.length ? await fetchInChunks<JsonRecord>(poNumbers, (chunk) => serviceRoleClient.schema("erp_procurement").from("purchase_order")
      .select("id, po_number, po_date, status, vendor_id, payment_term_id, expected_delivery_date")
      .eq("company_id", companyId).in("po_number", chunk)) : [];
    const livePoByNumber = new Map(livePos.map((row) => [text(row.po_number), row]));
    const livePoIds = livePos.map((row) => text(row.id)).filter(Boolean);
    const paymentTermIds = [...new Set(livePos.map((row) => text(row.payment_term_id)).filter(Boolean))];
    const paymentTerms = paymentTermIds.length ? await fetchInChunks<JsonRecord>(paymentTermIds, (chunk) => serviceRoleClient.schema("erp_master").from("payment_terms_master")
      .select("id, code, name, payment_method, reference_date, credit_days, usance_days").in("id", chunk)) : [];
    const paymentTermById = new Map(paymentTerms.map((row) => [text(row.id), row]));
    const liveVendorIds = [...new Set(livePos.map((row) => text(row.vendor_id)).filter(Boolean))];
    const vendorPaymentLogs = liveVendorIds.length ? await fetchInChunks<JsonRecord>(liveVendorIds, (chunk) => serviceRoleClient.schema("erp_master").from("vendor_payment_terms_log")
      .select("vendor_id, payment_terms_days, payment_method, terms_notes, recorded_at").eq("company_id", companyId).in("vendor_id", chunk).order("recorded_at", { ascending: false })) : [];
    const currentVendorTerms = new Map<string, JsonRecord>();
    for (const row of vendorPaymentLogs) if (!currentVendorTerms.has(text(row.vendor_id))) currentVendorTerms.set(text(row.vendor_id), row);
    const domesticLeadTimes = liveVendorIds.length ? await fetchInChunks<JsonRecord>(liveVendorIds, (chunk) => serviceRoleClient.schema("erp_master").from("lead_time_master_domestic")
      .select("vendor_id, transit_days, effective_from, effective_to").eq("company_id", companyId).eq("active", true).in("vendor_id", chunk)) : [];
    const importLeadTimes = liveVendorIds.length ? await fetchInChunks<JsonRecord>(liveVendorIds, (chunk) => serviceRoleClient.schema("erp_master").from("lead_time_master_import")
      .select("vendor_id, material_category_id, sail_time_days, clearance_days, effective_from, effective_to").eq("active", true).in("vendor_id", chunk)) : [];
    const liveCsns = livePoIds.length ? await fetchInChunks<JsonRecord>(livePoIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("consignment_note")
      .select("id, po_id, status, dispatch_qty, total_received_qty, invoice_number, bl_number, boe_number, lr_number, etd, ata_at_port, boe_date, lr_date, grn_date")
      .in("po_id", chunk)) : [];
    const csnByPo = new Map<string, JsonRecord[]>();
    for (const row of liveCsns) {
      const key = text(row.po_id); csnByPo.set(key, [...(csnByPo.get(key) ?? []), row]);
    }
    const references = await serviceRoleClient.schema("erp_history").from("product_reference_snapshot")
      .select("id, source_extracted_at, snapshot_kind, supplier_name, vendor_code, vendor_id, item_name, item_category, item_type, material_code, material_id, source_uom, supply_type, source_prefix, source_lead_time_defaults, validation_status")
      .eq("company_id", companyId).order("source_extracted_at", { ascending: false }).limit(500);
    if (references.error) throw references.error;
    const referenceRows = ((references.data ?? []) as JsonRecord[]).filter((row) =>
      (!vendorId || text(row.vendor_id) === vendorId) && (!materialId || text(row.material_id) === materialId));

    const rows = filteredHistories.map((history) => {
      const live = livePoByNumber.get(text(history.external_po_number));
      return {
        source: live ? "ERP_LIVE" : "HISTORICAL",
        historical_source: "HISTORICAL",
        external_po_number: history.external_po_number,
        order_date: history.order_date,
        supplier_name: history.supplier_name,
        vendor_code: history.vendor_code,
        historical_payment_terms: history.payment_terms,
        historical_payment_days: history.payment_days,
        supply_type: history.supply_type,
        validation_status: history.validation_status,
        analytical_window_included: history.analytical_window_included,
        dependency_outside_window: history.dependency_outside_window,
        live_po: live ? {
          source: "ERP_LIVE", po_number: live.po_number, po_date: live.po_date, status: live.status, expected_delivery_date: live.expected_delivery_date,
          payment_terms: paymentTermById.get(text(live.payment_term_id)) ?? null,
          current_vendor_payment_terms: currentVendorTerms.get(text(live.vendor_id)) ?? null,
          csn_count: (csnByPo.get(text(live.id)) ?? []).length,
        } : null,
        reconciliation: live ? "LIVE_PREFERRED_EXACT_PO_MATCH" : "HISTORICAL_ONLY",
      };
    });
    const overlapCount = rows.filter((row) => row.reconciliation === "LIVE_PREFERRED_EXACT_PO_MATCH").length;
    return okResponse({
      company_id: companyId,
      filters: { vendor_id: vendorId || null, material_id: materialId || null },
      rows,
      reference_defaults: referenceRows.map((row) => ({ ...row, source: "REFERENCE_DEFAULT", usage: "DEFAULT_ONLY_NOT_HISTORICAL_PROOF" })),
      configured_lead_times: {
        source: "ERP_LIVE",
        domestic: domesticLeadTimes,
        import: importLeadTimes,
        note: "Configured current master values are shown as current settings only; historical observations never overwrite them.",
      },
      reconciliation: {
        live_preferred_exact_po_matches: overlapCount,
        historical_only_observations: rows.length - overlapCount,
        live_supply_affected: false,
        rule: "Historical quantities are analytical evidence only and are excluded from current stock, open PO, in-transit and commitments.",
      },
      truncated: histories.length === 500 || referenceRows.length === 500,
    }, ctx.request_id, req);
  } catch (error) {
    if (error instanceof Error && error.message === "COMPANY_SCOPE_VIOLATION") return fail(req, ctx, error.message, 403, "Company is outside your scope.");
    return fail(req, ctx, "HISTORY_EVIDENCE_FAILED", 500, "Could not load historical procurement planning evidence.");
  }
}
