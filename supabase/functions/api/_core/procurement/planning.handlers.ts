/*
 * File-ID: 22.1
 * File-Path: supabase/functions/api/_core/procurement/planning.handlers.ts
 * Gate: 22
 * Phase: 22
 * Domain: PROCUREMENT
 * Purpose: Cross-plant procurement planning view - aggregates stock snapshot, open POs, in-transit CSNs, and safety stock.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

type PlanningRow = {
  material_id: string;
  material_code: string;
  material_name: string;
  base_uom_code: string;
  company_id: string;
  unrestricted_qty: number;
  qa_qty: number;
  blocked_qty: number;
  open_po_qty: number;
  in_transit_qty: number;
  reserved_qty: number;
  scheduled_dispatch_qty: number;
  planned_production_req_qty: number;
  safety_stock_qty: number;
  net_available: number;
  last_gr_date: string | null;
  suggested_pr_qty: number;
  reorder_point_qty: number;
  min_order_qty: number;
  lead_time_days: number;
};

type SafetyMeta = {
  safety_stock_qty: number;
  reorder_point_qty: number;
  min_order_qty: number;
  lead_time_days: number;
};

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeQty(value: unknown): number {
  const parsed = Number(value ?? 0);
  const safeValue = Number.isFinite(parsed) ? parsed : 0;
  return Number(safeValue.toFixed(6));
}

// §112 — must validate, not just resolve a fallback: an explicitly-requested
// companyId that is NOT one of the caller's own erp_map.user_companies rows
// throws COMPANY_SCOPE_VIOLATION rather than being silently honoured.
async function getCompanyScope(
  ctx: ProcurementHandlerContext,
  requestedCompanyId?: string,
): Promise<string> {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  const companyId = toTrimmedString(requestedCompanyId) || scopedCompanyId;
  if (companyId) await assertCompanyScope(ctx, companyId);
  return companyId;
}

function planningErrorResponse(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function assertProcurementReadRole(_ctx: ProcurementHandlerContext): void {
  // Protected by upstream pipeline/ACL layer.
}

function buildKey(companyId: string, materialId: string): string {
  return `${companyId}::${materialId}`;
}

function getNestedRow(
  value: unknown,
): JsonRecord | null {
  if (Array.isArray(value)) {
    return (value[0] as JsonRecord | undefined) ?? null;
  }
  if (value && typeof value === "object") {
    return value as JsonRecord;
  }
  return null;
}

export async function getProcurementPlanningHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? "");
    const materialIdFilter = toTrimmedString(url.searchParams.get("material_id") ?? "");
    const shortageOnly = url.searchParams.get("shortage_only") === "true";
    const limit = parsePositiveInt(url.searchParams.get("limit"), 200);

    const [
      snapshotResp,
      poResp,
      csnResp,
      safetyResp,
      lastGrResp,
    ] = await Promise.all([
      (async () => {
        let query = serviceRoleClient
          .schema("erp_inventory")
          .from("stock_snapshot")
          .select("company_id, material_id, stock_type_code, quantity");

        if (companyId) {
          query = query.eq("company_id", companyId);
        }

        const { data, error } = await query;
        if (error) {
          throw new Error("PROCUREMENT_PLANNING_STOCK_SNAPSHOT_FAILED");
        }
        return (data ?? []) as JsonRecord[];
      })(),
      (async () => {
        let query = serviceRoleClient
          .schema("erp_procurement")
          .from("purchase_order_line")
          .select("material_id, open_qty, line_status, purchase_order!inner(company_id, status)")
          .in("line_status", ["OPEN", "PARTIALLY_RECEIVED"])
          .in("purchase_order.status", ["APPROVED", "CONFIRMED"]);

        if (companyId) {
          query = query.eq("purchase_order.company_id", companyId);
        }

        const { data, error } = await query;
        if (error) {
          throw new Error("PROCUREMENT_PLANNING_OPEN_PO_FAILED");
        }
        return (data ?? []) as JsonRecord[];
      })(),
      (async () => {
        let query = serviceRoleClient
          .schema("erp_procurement")
          .from("consignment_note")
          .select("material_id, dispatch_qty, status, purchase_order!inner(company_id)")
          .eq("status", "TRN");

        if (companyId) {
          query = query.eq("purchase_order.company_id", companyId);
        }

        const { data, error } = await query;
        if (error) {
          throw new Error("PROCUREMENT_PLANNING_IN_TRANSIT_FAILED");
        }
        return (data ?? []) as JsonRecord[];
      })(),
      (async () => {
        let query = serviceRoleClient
          .schema("erp_master")
          .from("material_plant_ext")
          .select("company_id, material_id, safety_stock_qty, reorder_point_qty, min_order_qty, lead_time_days, status")
          .eq("status", "ACTIVE");

        if (companyId) {
          query = query.eq("company_id", companyId);
        }

        const { data, error } = await query;
        if (error) {
          throw new Error("PROCUREMENT_PLANNING_SAFETY_STOCK_FAILED");
        }
        return (data ?? []) as JsonRecord[];
      })(),
      (async () => {
        let query = serviceRoleClient
          .schema("erp_inventory")
          .from("stock_ledger")
          .select("material_id, posting_date, direction, movement_type_code")
          .eq("direction", "IN")
          .in("movement_type_code", ["P101", "P561", "P563", "P565"]);

        const { data, error } = await query;
        if (error) {
          throw new Error("PROCUREMENT_PLANNING_LAST_GR_FAILED");
        }
        return (data ?? []) as JsonRecord[];
      })(),
    ]);

    const keySet = new Set<string>();
    const materialIdSet = new Set<string>();
    const snapshotMap = new Map<string, Record<string, number>>();
    const poMap = new Map<string, number>();
    const csnMap = new Map<string, number>();
    const safetyMap = new Map<string, SafetyMeta>();
    const lastGrMap = new Map<string, string>();

    for (const row of snapshotResp) {
      const companyIdValue = toTrimmedString(row.company_id);
      const materialIdValue = toTrimmedString(row.material_id);
      if (!companyIdValue || !materialIdValue) {
        continue;
      }
      const key = buildKey(companyIdValue, materialIdValue);
      const stockTypeCode = toUpperTrimmedString(row.stock_type_code);
      const stockTypeMap = snapshotMap.get(key) ?? {};
      stockTypeMap[stockTypeCode] = normalizeQty(
        (stockTypeMap[stockTypeCode] ?? 0) + (parseNullableNumber(row.quantity) ?? 0),
      );
      snapshotMap.set(key, stockTypeMap);
      keySet.add(key);
      materialIdSet.add(materialIdValue);
    }

    for (const row of poResp) {
      const purchaseOrder = getNestedRow(row.purchase_order);
      const companyIdValue = toTrimmedString(purchaseOrder?.company_id);
      const materialIdValue = toTrimmedString(row.material_id);
      if (!companyIdValue || !materialIdValue) {
        continue;
      }
      const key = buildKey(companyIdValue, materialIdValue);
      poMap.set(
        key,
        normalizeQty((poMap.get(key) ?? 0) + (parseNullableNumber(row.open_qty) ?? 0)),
      );
      keySet.add(key);
      materialIdSet.add(materialIdValue);
    }

    for (const row of csnResp) {
      const purchaseOrder = getNestedRow(row.purchase_order);
      const companyIdValue = toTrimmedString(purchaseOrder?.company_id);
      const materialIdValue = toTrimmedString(row.material_id);
      if (!companyIdValue || !materialIdValue) {
        continue;
      }
      const key = buildKey(companyIdValue, materialIdValue);
      csnMap.set(
        key,
        normalizeQty((csnMap.get(key) ?? 0) + (parseNullableNumber(row.dispatch_qty) ?? 0)),
      );
      keySet.add(key);
      materialIdSet.add(materialIdValue);
    }

    for (const row of safetyResp) {
      const companyIdValue = toTrimmedString(row.company_id);
      const materialIdValue = toTrimmedString(row.material_id);
      if (!companyIdValue || !materialIdValue) {
        continue;
      }
      const key = buildKey(companyIdValue, materialIdValue);
      safetyMap.set(key, {
        safety_stock_qty: normalizeQty(row.safety_stock_qty),
        reorder_point_qty: normalizeQty(row.reorder_point_qty),
        min_order_qty: normalizeQty(row.min_order_qty),
        lead_time_days: Math.max(0, Math.floor(Number(row.lead_time_days ?? 0) || 0)),
      });
      keySet.add(key);
      materialIdSet.add(materialIdValue);
    }

    for (const row of lastGrResp) {
      const materialIdValue = toTrimmedString(row.material_id);
      const postingDate = toTrimmedString(row.posting_date);
      if (!materialIdValue || !postingDate) {
        continue;
      }
      const existingDate = lastGrMap.get(materialIdValue) ?? "";
      if (!existingDate || postingDate > existingDate) {
        lastGrMap.set(materialIdValue, postingDate);
      }
    }

    const materialIds = Array.from(materialIdSet);
    let materialRows: JsonRecord[] = [];
    if (materialIds.length > 0) {
      const { data, error } = await serviceRoleClient
        .schema("erp_master")
        .from("material_master")
        .select("id, pace_code, material_name, base_uom_code")
        .in("id", materialIds);

      if (error) {
        throw new Error("PROCUREMENT_PLANNING_MATERIAL_FETCH_FAILED");
      }
      materialRows = (data ?? []) as JsonRecord[];
    }

    const materialMap = new Map<string, JsonRecord>();
    for (const row of materialRows) {
      const materialIdValue = toTrimmedString(row.id);
      if (materialIdValue) {
        materialMap.set(materialIdValue, row);
      }
    }

    let items = Array.from(keySet).map((key): PlanningRow | null => {
      const [rowCompanyId, rowMaterialId] = key.split("::");
      if (!rowCompanyId || !rowMaterialId) {
        return null;
      }

      const stockByType = snapshotMap.get(key) ?? {};
      const unrestrictedQty = normalizeQty(stockByType.UNRESTRICTED ?? 0);
      const qaQty = normalizeQty(stockByType.QUALITY_INSPECTION ?? 0);
      const blockedQty = normalizeQty(stockByType.BLOCKED ?? 0);
      const openPoQty = normalizeQty(poMap.get(key) ?? 0);
      const inTransitQty = normalizeQty(csnMap.get(key) ?? 0);
      const safetyMeta = safetyMap.get(key) ?? {
        safety_stock_qty: 0,
        reorder_point_qty: 0,
        min_order_qty: 0,
        lead_time_days: 0,
      };
      const safetyStockQty = normalizeQty(safetyMeta.safety_stock_qty);
      const netAvailable = normalizeQty(
        unrestrictedQty + qaQty + openPoQty + inTransitQty - safetyStockQty,
      );
      const suggestedPrQty = netAvailable < 0 ? normalizeQty(Math.abs(netAvailable)) : 0;
      const material = materialMap.get(rowMaterialId);

      return {
        material_id: rowMaterialId,
        material_code: toTrimmedString(material?.pace_code),
        material_name: toTrimmedString(material?.material_name),
        base_uom_code: toTrimmedString(material?.base_uom_code),
        company_id: rowCompanyId,
        unrestricted_qty: unrestrictedQty,
        qa_qty: qaQty,
        blocked_qty: blockedQty,
        open_po_qty: openPoQty,
        in_transit_qty: inTransitQty,
        reserved_qty: 0,
        scheduled_dispatch_qty: 0,
        planned_production_req_qty: 0,
        safety_stock_qty: safetyStockQty,
        net_available: netAvailable,
        last_gr_date: lastGrMap.get(rowMaterialId) ?? null,
        suggested_pr_qty: suggestedPrQty,
        reorder_point_qty: normalizeQty(safetyMeta.reorder_point_qty),
        min_order_qty: normalizeQty(safetyMeta.min_order_qty),
        lead_time_days: safetyMeta.lead_time_days,
      };
    }).filter((row): row is PlanningRow => row !== null);

    if (materialIdFilter) {
      items = items.filter((row) => row.material_id === materialIdFilter);
    }

    if (shortageOnly) {
      items = items.filter((row) => row.net_available < 0);
    }

    items.sort((left, right) => {
      if (left.net_available !== right.net_available) {
        return left.net_available - right.net_available;
      }
      return `${left.material_code} ${left.material_name}`.localeCompare(
        `${right.material_code} ${right.material_name}`,
      );
    });

    const total = items.length;
    const limitedItems = items.slice(0, limit);

    return okResponse({ items: limitedItems, total }, ctx.request_id, req);
  } catch (error) {
    const code =
      error instanceof Error
        ? error.message
        : "PROCUREMENT_PLANNING_FETCH_FAILED";
    return planningErrorResponse(
      req,
      ctx,
      code,
      code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500,
      "Procurement planning fetch failed",
    );
  }
}
