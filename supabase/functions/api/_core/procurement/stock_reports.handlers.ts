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
  plant_id: string;
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

export async function getStockLedgerReportHandler(
  req: Request,
  ctx: StockReportHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const url = new URL(req.url);
    const materialId = toTrimmedString(url.searchParams.get("material_id"));
    const plantId = toTrimmedString(url.searchParams.get("plant_id"));
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
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

    let query = serviceRoleClient
      .schema("erp_inventory")
      .from("stock_ledger")
      .select("*", { count: "exact" })
      .eq("material_id", materialId)
      .order("ledger_seq", { ascending: true })
      .range(offset, offset + limit - 1);

    if (plantId) {
      query = query.eq("plant_id", plantId);
    }
    if (companyId) {
      query = query.eq("company_id", companyId);
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
    return reportErrorResponse(req, ctx, code, 500, "Unable to fetch stock ledger report.");
  }
}

export async function getCurrentStockHandler(
  req: Request,
  ctx: StockReportHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const url = new URL(req.url);
    const plantId = toTrimmedString(url.searchParams.get("plant_id"));
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const materialId = toTrimmedString(url.searchParams.get("material_id"));
    const stockTypeCode = normalizeStockTypeFilter(
      toTrimmedString(url.searchParams.get("stock_type_code")),
    );
    const showZero = toTrimmedString(url.searchParams.get("show_zero")).toLowerCase() === "true";

    let query = serviceRoleClient
      .schema("erp_inventory")
      .from("stock_snapshot")
      .select("*")
      .order("material_id", { ascending: true })
      .order("plant_id", { ascending: true });

    if (plantId) {
      query = query.eq("plant_id", plantId);
    }
    if (companyId) {
      query = query.eq("company_id", companyId);
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
    return okResponse(
      {
        data: rows,
        total: rows.length,
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "CURRENT_STOCK_FETCH_FAILED";
    return reportErrorResponse(req, ctx, code, 500, "Unable to fetch current stock.");
  }
}

export async function getStockValuationHandler(
  req: Request,
  ctx: StockReportHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const url = new URL(req.url);
    const plantId = toTrimmedString(url.searchParams.get("plant_id"));
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const materialId = toTrimmedString(url.searchParams.get("material_id"));

    let query = serviceRoleClient
      .schema("erp_inventory")
      .from("stock_snapshot")
      .select("material_id, plant_id, company_id, base_uom_code, quantity, value")
      .gt("quantity", 0);

    if (plantId) {
      query = query.eq("plant_id", plantId);
    }
    if (companyId) {
      query = query.eq("company_id", companyId);
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
      const rowPlantId = String(row.plant_id);
      const key = `${rowMaterialId}__${rowPlantId}`;
      if (!aggMap.has(key)) {
        aggMap.set(key, {
          material_id: rowMaterialId,
          plant_id: rowPlantId,
          company_id: String(row.company_id),
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
        || left.plant_id.localeCompare(right.plant_id),
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
    return reportErrorResponse(req, ctx, code, 500, "Unable to fetch stock valuation.");
  }
}
