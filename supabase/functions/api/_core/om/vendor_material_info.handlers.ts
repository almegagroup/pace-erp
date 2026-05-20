/*
 * File-ID: 14.4
 * File-Path: supabase/functions/api/_core/om/vendor_material_info.handlers.ts
 * Gate: 14
 * Phase: 14
 * Domain: MASTER
 * Purpose: Implement vendor material info and approved source list handlers.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { OmHandlerContext } from "./shared.ts";
import { assertOmAdminContext } from "./shared.ts";

type JsonRecord = Record<string, unknown>;

const VMI_STATUSES = new Set(["ACTIVE", "INACTIVE"]);

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

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

function vmiErrorResponse(
  req: Request,
  ctx: OmHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

async function ensureVendorExists(vendorId: string): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("vendor_master")
    .select("id")
    .eq("id", vendorId)
    .maybeSingle();

  return !error && Boolean(data?.id);
}

async function getMaterialRow(materialId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, base_uom_code")
    .eq("id", materialId)
    .maybeSingle();

  if (error) {
    throw new Error("OM_MATERIAL_LOOKUP_FAILED");
  }

  return (data as Record<string, unknown> | null) ?? null;
}

async function ensureUomExists(code: string): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("uom_master")
    .select("code")
    .eq("code", code)
    .maybeSingle();

  return !error && Boolean(data?.code);
}

async function getVmiRow(
  id: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("vendor_material_info")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error("OM_VMI_LOOKUP_FAILED");
  }

  return (data as Record<string, unknown> | null) ?? null;
}

export async function createVendorMaterialInfoHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const body = await parseBody(req);
    const vendorId = toTrimmedString(body.vendor_id);
    const materialId = toTrimmedString(body.material_id);

    if (!(await ensureVendorExists(vendorId))) {
      return vmiErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");
    }

    const material = await getMaterialRow(materialId);
    if (!material) {
      return vmiErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");
    }

    const poUomCode = toTrimmedString(body.po_uom_code || body.base_uom_code || material.base_uom_code).toUpperCase();
    if (!poUomCode || !(await ensureUomExists(poUomCode))) {
      return vmiErrorResponse(req, ctx, "OM_INVALID_UOM", 400, "Invalid UOM");
    }

    const conversionFactor = Number(body.conversion_factor ?? 1);
    if (!Number.isFinite(conversionFactor) || conversionFactor <= 0) {
      return vmiErrorResponse(req, ctx, "OM_INVALID_CONVERSION_FACTOR", 400, "Invalid conversion factor");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_material_info")
      .insert({
        vendor_id: vendorId,
        material_id: materialId,
        vendor_material_code: toTrimmedString(body.vendor_material_code) || null,
        vendor_material_description: toTrimmedString(body.vendor_material_description) || null,
        pack_size_description: toTrimmedString(body.pack_size_description) || "Standard",
        po_uom_code: poUomCode,
        conversion_factor: conversionFactor,
        variable_conversion: body.variable_conversion === true,
        lead_time_days: body.lead_time_days != null ? Number(body.lead_time_days) : null,
        last_purchase_price: body.price_per_base_uom != null ? Number(body.price_per_base_uom) : null,
        last_purchase_currency: toTrimmedString(body.currency_code) || null,
        status: "ACTIVE",
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return vmiErrorResponse(req, ctx, "OM_VMI_EXISTS", 409, "Vendor-material pair already exists");
      }
      throw new Error("OM_VMI_CREATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VMI_CREATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("EXISTS") ? 409 : code.includes("INVALID") ? 400 : 500;
    return vmiErrorResponse(req, ctx, code, status, "Vendor material info create failed");
  }
}

export async function listVendorMaterialInfosHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const url = new URL(req.url);
    const vendorId = toTrimmedString(url.searchParams.get("vendor_id"));
    const materialId = toTrimmedString(url.searchParams.get("material_id"));
    const statusFilter = toTrimmedString(url.searchParams.get("status")).toUpperCase();
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);
    const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);

    let query = serviceRoleClient
      .schema("erp_master")
      .from("vendor_material_info")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (vendorId) {
      query = query.eq("vendor_id", vendorId);
    }
    if (materialId) {
      query = query.eq("material_id", materialId);
    }
    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const { data, error, count } = await query;
    if (error) {
      throw new Error("OM_VMI_LIST_FAILED");
    }

    return okResponse({ data: data ?? [], total: count ?? 0 }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VMI_LIST_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return vmiErrorResponse(req, ctx, code, status, "Vendor material info list failed");
  }
}

export async function getVendorMaterialInfoHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const url = new URL(req.url);
    const id = toTrimmedString(url.searchParams.get("id"));
    const vendorId = toTrimmedString(url.searchParams.get("vendor_id"));
    const materialId = toTrimmedString(url.searchParams.get("material_id"));

    let data: Record<string, unknown> | null = null;

    if (id) {
      data = await getVmiRow(id);
    } else if (vendorId && materialId) {
      const result = await serviceRoleClient
        .schema("erp_master")
        .from("vendor_material_info")
        .select("*")
        .eq("vendor_id", vendorId)
        .eq("material_id", materialId)
        .maybeSingle();

      if (result.error) {
        throw new Error("OM_VMI_LOOKUP_FAILED");
      }
      data = (result.data as Record<string, unknown> | null) ?? null;
    }

    if (!data) {
      return vmiErrorResponse(req, ctx, "OM_VMI_NOT_FOUND", 404, "Vendor material info not found");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VMI_LOOKUP_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return vmiErrorResponse(req, ctx, code, status, "Vendor material info lookup failed");
  }
}

export async function updateVendorMaterialInfoHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    if (!id) {
      return vmiErrorResponse(req, ctx, "OM_VMI_NOT_FOUND", 404, "Vendor material info not found");
    }

    const existing = await getVmiRow(id);
    if (!existing) {
      return vmiErrorResponse(req, ctx, "OM_VMI_NOT_FOUND", 404, "Vendor material info not found");
    }

    const updates: JsonRecord = {
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    };

    const mutableFields = [
      "vendor_material_code",
      "vendor_material_description",
      "pack_size_description",
      "lead_time_days",
      "last_purchase_price",
      "last_purchase_currency",
      "last_grn_date",
    ];

    for (const field of mutableFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (body.price_per_base_uom !== undefined) {
      updates.last_purchase_price = body.price_per_base_uom;
    }
    if (body.currency_code !== undefined) {
      updates.last_purchase_currency = body.currency_code;
    }
    if (body.po_uom_code !== undefined) {
      const poUomCode = toTrimmedString(body.po_uom_code).toUpperCase();
      if (!poUomCode || !(await ensureUomExists(poUomCode))) {
        return vmiErrorResponse(req, ctx, "OM_INVALID_UOM", 400, "Invalid UOM");
      }
      updates.po_uom_code = poUomCode;
    }
    if (body.conversion_factor !== undefined) {
      const factor = Number(body.conversion_factor);
      if (!Number.isFinite(factor) || factor <= 0) {
        return vmiErrorResponse(req, ctx, "OM_INVALID_CONVERSION_FACTOR", 400, "Invalid conversion factor");
      }
      updates.conversion_factor = factor;
    }
    if (body.variable_conversion !== undefined) {
      updates.variable_conversion = body.variable_conversion === true;
    }

    if (Object.keys(updates).length === 2) {
      return vmiErrorResponse(req, ctx, "OM_VMI_NO_CHANGES", 400, "No changes provided");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_material_info")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_VMI_UPDATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VMI_UPDATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("INVALID") ? 400 : 500;
    return vmiErrorResponse(req, ctx, code, status, "Vendor material info update failed");
  }
}

export async function changeVendorMaterialInfoStatusHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    const newStatus = toTrimmedString(body.new_status).toUpperCase();

    if (!id) {
      return vmiErrorResponse(req, ctx, "OM_VMI_NOT_FOUND", 404, "Vendor material info not found");
    }
    if (!VMI_STATUSES.has(newStatus)) {
      return vmiErrorResponse(req, ctx, "OM_INVALID_STATUS", 400, "Invalid status");
    }

    const existing = await getVmiRow(id);
    if (!existing) {
      return vmiErrorResponse(req, ctx, "OM_VMI_NOT_FOUND", 404, "Vendor material info not found");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_material_info")
      .update({
        status: newStatus,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_VMI_STATUS_UPDATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VMI_STATUS_UPDATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("INVALID") ? 400 : 500;
    return vmiErrorResponse(req, ctx, code, status, "Vendor material info status update failed");
  }
}
