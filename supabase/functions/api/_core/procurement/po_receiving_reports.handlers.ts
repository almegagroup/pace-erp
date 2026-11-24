/*
 * File-Path: supabase/functions/api/_core/procurement/po_receiving_reports.handlers.ts
 * Purpose: PO24 "PO Status" (Procurement menu: per vendor / PO / material line -- PO qty, delivered, in-transit, open, knocked off,
 *          QA blocked) and PO23 "GRN Receiving Report" (Receiving menu: per gate entry PO line and per GRN -- PO qty, PO rate, GRN
 *          qty, QA blocked, balance after that GRN). Read-only; live documents only (the SQL functions skip reversed / cancelled
 *          GRNs and pruned gate entries). Every requested company is checked against the caller's own company scope.
 * Authority: Backend
 */
import type { ContextResolution } from "../../_pipeline/context.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";

type Ctx = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const text = (value: unknown): string => String(value ?? "").trim();
const MAX_RANGE_DAYS = 800;

function fail(req: Request, ctx: Ctx, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function isoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function resolveParams(req: Request, ctx: Ctx): Promise<
  { error: Response } | { companyIds: string[]; from: string; to: string; openOnly: boolean }
> {
  const url = new URL(req.url);
  const companyIds = [...new Set(url.searchParams.getAll("company_ids").flatMap((v) => v.split(",")).map(text).filter(Boolean))];
  const from = text(url.searchParams.get("date_from"));
  const to = text(url.searchParams.get("date_to"));
  if (companyIds.length === 0) return { error: fail(req, ctx, "REPORT_COMPANY_REQUIRED", 400, "Select at least one company.") };
  const fromDate = isoDate(from);
  const toDate = isoDate(to);
  if (!fromDate || !toDate) return { error: fail(req, ctx, "REPORT_DATE_RANGE_REQUIRED", 400, "A valid date range is required.") };
  if (toDate < fromDate) return { error: fail(req, ctx, "REPORT_DATE_RANGE_INVALID", 400, "Date To cannot be before Date From.") };
  if ((toDate.getTime() - fromDate.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
    return { error: fail(req, ctx, "REPORT_DATE_RANGE_TOO_LONG", 400, "The date range is too long.") };
  }
  for (const companyId of companyIds) {
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return { error: fail(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.") };
    }
  }
  return { companyIds, from, to, openOnly: text(url.searchParams.get("open_only")) === "true" };
}

export async function getPoStatusReportHandler(req: Request, ctx: Ctx): Promise<Response> {
  const params = await resolveParams(req, ctx);
  if ("error" in params) return params.error;
  const { data, error } = await serviceRoleClient.schema("erp_procurement").rpc("po_status_report", {
    p_company_ids: params.companyIds, p_from: params.from, p_to: params.to, p_open_only: params.openOnly,
  });
  if (error) {
    console.error("[po_status_report] failed:", JSON.stringify(error));
    return fail(req, ctx, "PO_STATUS_REPORT_FAILED", 500, "Unable to load the PO status report.");
  }
  return okResponse({ rows: data ?? [] }, ctx.request_id, req);
}

export async function getGrnReceivingReportHandler(req: Request, ctx: Ctx): Promise<Response> {
  const params = await resolveParams(req, ctx);
  if ("error" in params) return params.error;
  const { data, error } = await serviceRoleClient.schema("erp_procurement").rpc("grn_receiving_report", {
    p_company_ids: params.companyIds, p_from: params.from, p_to: params.to,
  });
  if (error) {
    console.error("[grn_receiving_report] failed:", JSON.stringify(error));
    return fail(req, ctx, "GRN_RECEIVING_REPORT_FAILED", 500, "Unable to load the GRN receiving report.");
  }
  return okResponse({ rows: data ?? [] }, ctx.request_id, req);
}
