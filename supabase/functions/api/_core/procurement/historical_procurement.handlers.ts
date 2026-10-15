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
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { aggregateLeadTimes, type HistoricalLeadTimeInput } from "./historical_procurement.logic.ts";
import { mapHistoryRpcError, requestChecksum } from "./historical_import.rpc.ts";

type JsonRecord = Record<string, unknown>;
type HistoricalContext = { context: Extract<ContextResolution, { status: "RESOLVED" }>; request_id: string; auth_user_id: string; roleCode: string };
const RESOURCE_PAGE = "PROC_MTS_CUSTOMER_PLAN";
const RESOURCE_MAINTAIN = "PROC_MTS_CUSTOMER_PLAN_MAINTAIN";
const text = (value: unknown) => String(value ?? "").trim();
const asRows = (value: unknown): JsonRecord[] => Array.isArray(value) ? value as JsonRecord[] : [];

function fail(req: Request, ctx: HistoricalContext, code: string, status: number, message: string) {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

// POST /api/procurement/historical-procurement-import/dry-run
// POST /api/procurement/historical-procurement-import/commit
export async function historicalProcurementImportHandler(req: Request, ctx: HistoricalContext, commit: boolean): Promise<Response> {
  try {
    const body = await req.json().catch(() => null) as JsonRecord | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail(req, ctx, "HISTORY_IMPORT_INVALID", 400, "A JSON object request body is required.");
    const companyId = text(body.company_id);
    if (!companyId) return fail(req, ctx, "HISTORY_IMPORT_INVALID", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    if (!await canMaintainCompanyResource(ctx, companyId, RESOURCE_MAINTAIN, "WRITE")) {
      return fail(req, ctx, "HISTORY_PROCUREMENT_IMPORT_FORBIDDEN", 403, "You do not have Historical Import access for this company.");
    }
    const request = {
      company_id: companyId,
      source_system: body.source_system, source_file_key: body.source_file_key, source_file_name: body.source_file_name,
      source_sheet_name: body.source_sheet_name,
      purchase_orders: body.purchase_orders ?? [], purchase_order_lines: body.purchase_order_lines ?? [],
      consignment_movements: body.consignment_movements ?? [],
    };
    const checksum = await requestChecksum(request);
    const { data, error } = await serviceRoleClient.rpc("import_historical_procurement", {
      p_request: { ...request, checksum }, p_actor: ctx.auth_user_id, p_dry_run: !commit,
    });
    if (error) {
      const mapped = mapHistoryRpcError(error.message);
      return fail(req, ctx, mapped.code, mapped.status, mapped.message);
    }
    const result = (data ?? {}) as JsonRecord;
    if (commit && result.committed !== true) {
      return fail(req, ctx, "HISTORY_IMPORT_REVIEW_REQUIRED", 409, `Import blocked: ${Number((result.summary as JsonRecord | undefined)?.error_count ?? 0)} ERROR issue(s). Run dry-run, fix them, then commit again.`);
    }
    return okResponse({ ...result, checksum }, ctx.request_id, req);
  } catch (error) {
    if (error instanceof Error && error.message === "COMPANY_SCOPE_VIOLATION") return fail(req, ctx, error.message, 403, "Company is outside your scope.");
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
