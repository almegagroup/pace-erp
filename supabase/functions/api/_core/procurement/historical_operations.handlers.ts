/*
 * File-Path: supabase/functions/api/_core/procurement/historical_operations.handlers.ts
 * Domain: PROCUREMENT / MTS PLANNING
 * Purpose: controlled historical Production / FG-Dispatch import and the
 *          unified PO21 actuals read.
 *
 * Reporting-only: no stock posting, no write to any live table.
 * - Import: one RPC call = one PostgreSQL transaction
 *   (public.import_historical_operations). Validation and SKU -> material
 *   resolution run inside the function, so dry-run and commit cannot disagree
 *   and a failed commit leaves no partial batch.
 * - Actuals: public.history_planning_actuals aggregates in SQL and returns one
 *   jsonb value (no PostgREST 1,000-row truncation):
 *     history  (validated, not cancelled)   dates  < 2026-10-01
 *     ERP live (posted FG stock ledger)     dates >= 2026-10-01
 *       production = P101 (+) / P102 (-) of MTS Process POs, SKU-wise
 *       dispatch   = P601 (+) / P602 (-) of MTS sales-invoice lines
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { aggregateActuals, HISTORY_CUTOVER, text, type ActualAggregationInput } from "./historical_operations.logic.ts";
import { parseMonthList } from "./mts_customer_plan.logic.ts";
import { mapHistoryRpcError, requestChecksum } from "./historical_import.rpc.ts";

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

function historyError(req: Request, ctx: HistoricalContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

async function runImport(req: Request, ctx: HistoricalContext, commit: boolean): Promise<Response> {
  try {
    const body = await req.json().catch(() => null) as JsonRecord | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return historyError(req, ctx, "HISTORY_IMPORT_INVALID", 400, "A JSON object request body is required.");
    const companyId = text(body.company_id);
    if (!companyId) return historyError(req, ctx, "HISTORY_IMPORT_INVALID", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    if (!await canMaintainCompanyResource(ctx, companyId, RESOURCE_MAINTAIN, "WRITE")) {
      return historyError(req, ctx, "HISTORY_IMPORT_FORBIDDEN", 403, "You do not have permission to import historical actuals for this company.");
    }
    const request = {
      company_id: companyId, record_kind: body.record_kind, source_system: body.source_system,
      source_file_key: body.source_file_key, source_file_name: body.source_file_name,
      source_sheet_name: body.source_sheet_name, rows: body.rows ?? [],
    };
    const checksum = await requestChecksum(request);
    const { data, error } = await serviceRoleClient.rpc("import_historical_operations", {
      p_request: { ...request, checksum }, p_actor: ctx.auth_user_id, p_dry_run: !commit,
    });
    if (error) {
      const mapped = mapHistoryRpcError(error.message);
      return historyError(req, ctx, mapped.code, mapped.status, mapped.message);
    }
    const result = (data ?? {}) as JsonRecord;
    if (commit && result.committed !== true) {
      return historyError(req, ctx, "HISTORY_IMPORT_REVIEW_REQUIRED", 409, `Import blocked: ${Number((result.summary as JsonRecord | undefined)?.error_count ?? 0)} ERROR issue(s). Run dry-run, fix them, then commit again.`);
    }
    return okResponse({ ...result, checksum }, ctx.request_id, req);
  } catch (error) {
    if (error instanceof Error && error.message === "COMPANY_SCOPE_VIOLATION") return historyError(req, ctx, error.message, 403, "Company is outside your scope.");
    return historyError(req, ctx, "HISTORY_IMPORT_FAILED", 500, "Could not process the historical import.");
  }
}

// POST /api/procurement/mts-plan/historical-import/dry-run
export function dryRunHistoricalImportHandler(req: Request, ctx: HistoricalContext): Promise<Response> {
  return runImport(req, ctx, false);
}

// POST /api/procurement/mts-plan/historical-import/commit
export function commitHistoricalImportHandler(req: Request, ctx: HistoricalContext): Promise<Response> {
  return runImport(req, ctx, true);
}

function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4)); const m = Number(month.slice(5, 7));
  return m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, "0")}-01`;
}

// GET /api/procurement/mts-plan/actuals?company_id=...&months=2026-08-01,...
export async function getMtsPlanningActualsHandler(req: Request, ctx: HistoricalContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = text(url.searchParams.get("company_id"));
    if (!companyId) return historyError(req, ctx, "HISTORY_ACTUALS_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    if (!await canMaintainCompanyResource(ctx, companyId, RESOURCE_PAGE, "VIEW")) {
      return historyError(req, ctx, "HISTORY_ACTUALS_FORBIDDEN", 403, "You do not have access to Planning Actuals for this company.");
    }
    const { months, invalid } = parseMonthList(url.searchParams.get("months"));
    if (invalid.length || months.length === 0 || months.length > MAX_MONTHS) return historyError(req, ctx, "HISTORY_ACTUALS_MONTHS_INVALID", 400, "Select between 1 and 60 valid months.");
    const monthSet = new Set(months);

    const { data, error } = await serviceRoleClient.rpc("history_planning_actuals", {
      p_company_id: companyId, p_from: months[0], p_to_exclusive: nextMonth(months[months.length - 1]),
    });
    if (error) throw new Error("HISTORY_ACTUALS_READ_FAILED");
    const result = (data ?? {}) as JsonRecord;
    const sourceRows = Array.isArray(result.rows) ? result.rows as JsonRecord[] : [];

    // R-01: labels, never raw ids.
    const materialIds = [...new Set(sourceRows.map((row) => text(row.material_id)).filter(Boolean))];
    const materials = materialIds.length ? await fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient.schema("erp_master")
      .from("material_master").select("id, external_code, material_name").in("id", chunk)) : [];
    const materialById = new Map(materials.map((row) => [text(row.id), row]));

    const inputs: ActualAggregationInput[] = [];
    for (const row of sourceRows) {
      const month = text(row.month).slice(0, 10);
      if (!monthSet.has(month)) continue;
      const materialId = text(row.material_id);
      const material = materialById.get(materialId);
      const level = text(row.material_type).toUpperCase() === "SFG" ? "PRODSHADE" : "SKU";
      const qty = Number(row.qty ?? 0);
      const isProduction = text(row.metric) === "PRODUCTION";
      inputs.push({
        month, identity_key: materialId, identity_level: level, material_id: materialId,
        external_sku: text(material?.external_code) || null, material_label: text(material?.material_name) || "—",
        prodshade: null, source_classification: text(row.source) === "ERP_LIVE" ? "ERP_LIVE" : "HISTORICAL",
        ...(isProduction ? { production_kg: qty } : { dispatch_kg: qty }),
      });
    }

    // Coverage: a covered month with no actual is a real 0; an uncovered month stays blank.
    const coverage = (result.coverage ?? {}) as Record<string, unknown>;
    const asMonths = (value: unknown) => (Array.isArray(value) ? value : []).map((m) => text(m).slice(0, 10)).filter((m) => monthSet.has(m));
    const live = asMonths(coverage.ERP_LIVE);
    const coveredProduction = [...new Set([...asMonths(coverage.PRODUCTION), ...live])].sort();
    const coveredDispatch = [...new Set([...asMonths(coverage.DISPATCH), ...live])].sort();

    const warnings: JsonRecord[] = [];
    const historicalMonths = months.filter((m) => m < HISTORY_CUTOVER);
    const missingProduction = historicalMonths.filter((m) => !coveredProduction.includes(m));
    const missingDispatch = historicalMonths.filter((m) => !coveredDispatch.includes(m));
    if (missingProduction.length) warnings.push({ code: "HISTORY_PRODUCTION_COVERAGE_MISSING", count: missingProduction.length, message: `${missingProduction.length} historical month(s) have no imported Production data; those cells are blank, not zero.` });
    if (missingDispatch.length) warnings.push({ code: "HISTORY_DISPATCH_COVERAGE_MISSING", count: missingDispatch.length, message: `${missingDispatch.length} historical month(s) have no imported FG Dispatch data; those cells are blank, not zero.` });
    const openExceptions = Number(result.open_history_exceptions ?? 0);
    if (openExceptions > 0) warnings.push({ code: "HISTORY_DATA_QUALITY", count: openExceptions, message: `${openExceptions} unresolved historical import exception(s) are excluded from actual totals.` });
    const nonKg = Number(result.live_non_kg_rows_excluded ?? 0);
    if (nonKg > 0) warnings.push({ code: "LIVE_ACTUALS_UOM_NOT_KG", count: nonKg, message: `${nonKg} posted FG ledger row(s) with a non-KG base unit were excluded (never converted by guess).` });

    return okResponse({
      company_id: companyId, months, cutover: HISTORY_CUTOVER,
      rows: aggregateActuals(inputs),
      coverage: { PRODUCTION: coveredProduction, DISPATCH: coveredDispatch },
      warnings,
    }, ctx.request_id, req);
  } catch (error) {
    if (error instanceof Error && error.message === "COMPANY_SCOPE_VIOLATION") return historyError(req, ctx, error.message, 403, "Company is outside your scope.");
    return historyError(req, ctx, "HISTORY_ACTUALS_FAILED", 500, "Could not load unified Planning Actuals.");
  }
}
