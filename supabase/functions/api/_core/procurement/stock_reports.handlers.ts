/*
 * File-ID: 24.1
 * File-Path: supabase/functions/api/_core/procurement/stock_reports.handlers.ts
 * Gate: 24
 * Phase: 24
 * Domain: PROCUREMENT
 * Purpose: Core stock reports - stock ledger, current stock snapshot, and stock valuation.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type StockReportHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

type ValuationRow = {
  material_id: string;
  company_id: string;
  base_uom_code: string;
  total_qty: number;
  total_value: number;
  weighted_avg_rate: number;
};

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function normalizeNumber(value: unknown, decimals = 6): number {
  const parsed = Number(value ?? 0);
  const safeValue = Number.isFinite(parsed) ? parsed : 0;
  return Number(safeValue.toFixed(decimals));
}

function reportErrorResponse(
  req: Request,
  ctx: StockReportHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function assertProcurementReadRole(_ctx: StockReportHandlerContext): void {
  // Protected by upstream pipeline/ACL layer.
}

function normalizeStockTypeFilter(value: string): string {
  return value.toUpperCase() === "QA" ? "QUALITY_INSPECTION" : value;
}

// §112 (Shape 3 — plain read) — these report handlers take company_id from a
// GET query string with zero validation before this fix: an empty company_id
// returned every company's stock, and an explicit foreign company_id returned
// that company's stock unchecked. Mirrors the allowedCompanyIds pattern
// already used in process_order/packing_order listXHandler: SA/GA/admin see
// everything; everyone else gets scoped to their own erp_map.user_companies,
// and an explicit out-of-scope company_id throws COMPANY_SCOPE_VIOLATION.
async function resolveCompanyScope(
  ctx: StockReportHandlerContext,
  requestedCompanyId: string,
): Promise<{ companyId: string; allowedCompanyIds: string[] | null }> {
  const companyId = toTrimmedString(requestedCompanyId);
  if (companyId) {
    await assertCompanyScope(ctx, companyId);
    return { companyId, allowedCompanyIds: null };
  }
  if (ctx.context.isAdmin === true || ctx.roleCode === "SA" || ctx.roleCode === "GA") {
    return { companyId, allowedCompanyIds: null };
  }
  const { data: userCompanies, error } = await serviceRoleClient
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", ctx.auth_user_id);
  if (error) {
    throw new Error("COMPANY_SCOPE_LOOKUP_FAILED");
  }
  const allowedCompanyIds = ((userCompanies ?? []) as JsonRecord[]).map((row) => String(row.company_id ?? ""));
  return { companyId, allowedCompanyIds };
}

export async function getStockLedgerReportHandler(
  req: Request,
  ctx: StockReportHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const url = new URL(req.url);
    const materialId = toTrimmedString(url.searchParams.get("material_id"));
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const limit = Math.min(parsePositiveInt(url.searchParams.get("limit"), 200), 500);
    const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);

    if (!materialId) {
      return reportErrorResponse(
        req,
        ctx,
        "STOCK_LEDGER_MATERIAL_REQUIRED",
        400,
        "material_id is required.",
      );
    }

    const { companyId, allowedCompanyIds } = await resolveCompanyScope(
      ctx,
      url.searchParams.get("company_id") ?? "",
    );

    let query = serviceRoleClient
      .schema("erp_inventory")
      .from("stock_ledger")
      .select("*", { count: "exact" })
      .eq("material_id", materialId)
      .order("ledger_seq", { ascending: true })
      .range(offset, offset + limit - 1);

    if (companyId) {
      query = query.eq("company_id", companyId);
    } else if (allowedCompanyIds) {
      query = query.in("company_id", allowedCompanyIds);
    }
    if (dateFrom) {
      query = query.gte("posting_date", dateFrom);
    }
    if (dateTo) {
      query = query.lte("posting_date", dateTo);
    }

    const { data, error, count } = await query;
    if (error) {
      return reportErrorResponse(
        req,
        ctx,
        "STOCK_LEDGER_FETCH_FAILED",
        500,
        "Unable to fetch stock ledger report.",
      );
    }

    const rowsWithSignedQty = (data ?? []).map((row: JsonRecord) => ({
      ...row,
      signed_qty: row.direction === "IN"
        ? Number(row.quantity)
        : -Number(row.quantity),
    }));

    return okResponse(
      {
        data: rowsWithSignedQty,
        total: count ?? 0,
        offset,
        limit,
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "STOCK_LEDGER_FETCH_FAILED";
    return reportErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, "Unable to fetch stock ledger report.");
  }
}

export async function getCurrentStockHandler(
  req: Request,
  ctx: StockReportHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const url = new URL(req.url);
    const materialId = toTrimmedString(url.searchParams.get("material_id"));
    const stockTypeCode = normalizeStockTypeFilter(
      toTrimmedString(url.searchParams.get("stock_type_code")),
    );
    const showZero = toTrimmedString(url.searchParams.get("show_zero")).toLowerCase() === "true";

    const { companyId, allowedCompanyIds } = await resolveCompanyScope(
      ctx,
      url.searchParams.get("company_id") ?? "",
    );

    let query = serviceRoleClient
      .schema("erp_inventory")
      .from("stock_snapshot")
      .select("*")
      .order("material_id", { ascending: true })
      .order("company_id", { ascending: true });

    if (companyId) {
      query = query.eq("company_id", companyId);
    } else if (allowedCompanyIds) {
      query = query.in("company_id", allowedCompanyIds);
    }
    if (materialId) {
      query = query.eq("material_id", materialId);
    }
    if (stockTypeCode) {
      query = query.eq("stock_type_code", stockTypeCode);
    }
    if (!showZero) {
      query = query.gt("quantity", 0);
    }

    const { data, error } = await query;
    if (error) {
      return reportErrorResponse(
        req,
        ctx,
        "CURRENT_STOCK_FETCH_FAILED",
        500,
        "Unable to fetch current stock.",
      );
    }

    const rows = (data ?? []) as JsonRecord[];

    // §8A: never show raw material_id/storage_location_id — resolve both in bulk.
    // §110 Phase C: also attach each material's own alternate-UoM conversion (if
    // any) so the row can show e.g. "23 BAG" alongside the base-UoM quantity —
    // same material_uom_conversion source the entry-side picker (§110 Phase A/B)
    // already reads, just resolved server-side here for a read-only report.
    const materialIds = [...new Set(rows.map((row) => String(row.material_id ?? "")).filter(Boolean))];
    const slocIds = [...new Set(rows.map((row) => String(row.storage_location_id ?? "")).filter(Boolean))];

    const [materialResp, slocResp, convResp] = await Promise.all([
      materialIds.length
        ? serviceRoleClient
            .schema("erp_master")
            .from("material_master")
            .select("id, pace_code, material_name, purchase_uom_code")
            .in("id", materialIds)
        : Promise.resolve({ data: [], error: null }),
      slocIds.length
        ? serviceRoleClient
            .schema("erp_inventory")
            .from("storage_location_master")
            .select("id, code, name")
            .in("id", slocIds)
        : Promise.resolve({ data: [], error: null }),
      materialIds.length
        ? serviceRoleClient
            .schema("erp_master")
            .from("material_uom_conversion")
            .select("material_id, from_uom_code, to_uom_code, conversion_factor, variable_conversion")
            .in("material_id", materialIds)
            .eq("active", true)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (materialResp.error || slocResp.error || convResp.error) {
      return reportErrorResponse(
        req,
        ctx,
        "CURRENT_STOCK_FETCH_FAILED",
        500,
        "Unable to fetch current stock.",
      );
    }

    const materialMap = new Map(
      ((materialResp.data ?? []) as JsonRecord[]).map((m) => [String(m.id), m]),
    );
    const slocMap = new Map(
      ((slocResp.data ?? []) as JsonRecord[]).map((s) => [String(s.id), s]),
    );
    const convByMaterial = new Map<string, JsonRecord[]>();
    for (const conv of (convResp.data ?? []) as JsonRecord[]) {
      const key = String(conv.material_id);
      if (!convByMaterial.has(key)) convByMaterial.set(key, []);
      convByMaterial.get(key)?.push(conv);
    }

    const enrichedRows = rows.map((row) => {
      const material = materialMap.get(String(row.material_id));
      const sloc = slocMap.get(String(row.storage_location_id));
      const baseUomCode = toTrimmedString(row.base_uom_code);
      const conversions = convByMaterial.get(String(row.material_id)) ?? [];
      // Prefer the material's own designated purchase unit when it has a fixed
      // (non-variable) conversion row to base UoM; otherwise fall back to the
      // first fixed conversion available. Variable-conversion rows (599/000/001
      // pack types, §83.15) have no single factor, so they never drive this.
      const purchaseUom = toTrimmedString(material?.purchase_uom_code);
      const altConversion =
        conversions.find((c) => !c.variable_conversion && toTrimmedString(c.from_uom_code) === purchaseUom && toTrimmedString(c.to_uom_code) === baseUomCode) ??
        conversions.find((c) => !c.variable_conversion && toTrimmedString(c.to_uom_code) === baseUomCode) ??
        null;
      const altFactor = altConversion ? Number(altConversion.conversion_factor) : null;
      const quantity = Number(row.quantity ?? 0);

      return {
        ...row,
        material_code: material?.pace_code ?? null,
        material_name: material?.material_name ?? null,
        location_code: sloc?.code ?? null,
        location_name: sloc?.name ?? null,
        alt_uom_code: altConversion ? toTrimmedString(altConversion.from_uom_code) : null,
        alt_quantity: altFactor && altFactor > 0 ? Number((quantity / altFactor).toFixed(3)) : null,
      };
    });

    return okResponse(
      {
        data: enrichedRows,
        total: enrichedRows.length,
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "CURRENT_STOCK_FETCH_FAILED";
    return reportErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, "Unable to fetch current stock.");
  }
}

export async function getStockValuationHandler(
  req: Request,
  ctx: StockReportHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const url = new URL(req.url);
    const materialId = toTrimmedString(url.searchParams.get("material_id"));

    const { companyId, allowedCompanyIds } = await resolveCompanyScope(
      ctx,
      url.searchParams.get("company_id") ?? "",
    );

    let query = serviceRoleClient
      .schema("erp_inventory")
      .from("stock_snapshot")
      .select("material_id, company_id, base_uom_code, quantity, value")
      .gt("quantity", 0);

    if (companyId) {
      query = query.eq("company_id", companyId);
    } else if (allowedCompanyIds) {
      query = query.in("company_id", allowedCompanyIds);
    }
    if (materialId) {
      query = query.eq("material_id", materialId);
    }

    const { data, error } = await query;
    if (error) {
      return reportErrorResponse(
        req,
        ctx,
        "STOCK_VALUATION_FETCH_FAILED",
        500,
        "Unable to fetch stock valuation.",
      );
    }

    const aggMap = new Map<string, ValuationRow>();
    for (const rawRow of data ?? []) {
      const row = rawRow as JsonRecord;
      const rowMaterialId = String(row.material_id);
      const rowCompanyId = String(row.company_id);
      const key = `${rowMaterialId}__${rowCompanyId}`;
      if (!aggMap.has(key)) {
        aggMap.set(key, {
          material_id: rowMaterialId,
          company_id: rowCompanyId,
          base_uom_code: String(row.base_uom_code),
          total_qty: 0,
          total_value: 0,
          weighted_avg_rate: 0,
        });
      }
      const agg = aggMap.get(key);
      if (!agg) continue;
      agg.total_qty += Number(row.quantity);
      agg.total_value += Number(row.value);
    }

    const result: ValuationRow[] = [];
    for (const agg of aggMap.values()) {
      agg.total_qty = normalizeNumber(agg.total_qty);
      agg.total_value = normalizeNumber(agg.total_value, 2);
      agg.weighted_avg_rate = agg.total_qty > 0
        ? normalizeNumber(agg.total_value / agg.total_qty)
        : 0;
      result.push(agg);
    }

    result.sort(
      (left, right) =>
        left.material_id.localeCompare(right.material_id)
        || left.company_id.localeCompare(right.company_id),
    );

    const grandTotalValue = Math.round(
      result.reduce((sum, row) => sum + Number(row.total_value), 0) * 100,
    ) / 100;

    return okResponse(
      {
        data: result,
        total: result.length,
        grand_total_value: grandTotalValue,
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "STOCK_VALUATION_FETCH_FAILED";
    return reportErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, "Unable to fetch stock valuation.");
  }
}
