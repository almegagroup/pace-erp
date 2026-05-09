/*
 * File-ID: 14.2
 * File-Path: supabase/functions/api/_core/om/material.handlers.ts
 * Gate: 14
 * Phase: 14
 * Domain: MASTER
 * Purpose: Implement material master CRUD, extension, UOM conversion, and category group handlers.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { OmHandlerContext } from "./shared.ts";
import { assertOmAdminContext } from "./shared.ts";

type JsonRecord = Record<string, unknown>;

const ALLOWED_MATERIAL_TYPES = new Set(["RM", "PM", "INT", "FG", "TRA", "CONS"]);
const MUTABLE_MATERIAL_STATUSES = new Set(["DRAFT", "PENDING_APPROVAL"]);
const MATERIAL_DB_STATUSES = new Set(["DRAFT", "PENDING_APPROVAL", "ACTIVE", "INACTIVE", "BLOCKED"]);
const MATERIAL_TRANSITIONS = new Map<string, Set<string>>([
  ["DRAFT", new Set(["PENDING_APPROVAL"])],
  ["PENDING_APPROVAL", new Set(["ACTIVE", "DRAFT"])],
  ["ACTIVE", new Set(["INACTIVE", "BLOCKED"])],
  ["INACTIVE", new Set(["ACTIVE"])],
  ["BLOCKED", new Set(["ACTIVE"])],
]);

function mapMaterialStatusInput(value: unknown): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "DISCONTINUED") {
    return "BLOCKED";
  }
  return normalized;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeSearch(value: string): string {
  return value.replace(/[%_]/g, "").trim();
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

async function ensureCompanyExists(companyId: string): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .maybeSingle();

  return !error && Boolean(data?.id);
}

async function ensurePlantExists(plantId: string): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("projects")
    .select("id")
    .eq("id", plantId)
    .maybeSingle();

  return !error && Boolean(data?.id);
}

async function getMaterialById(id: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error("OM_MATERIAL_LOOKUP_FAILED");
  }

  return (data as Record<string, unknown> | null) ?? null;
}

function materialErrorResponse(
  req: Request,
  ctx: OmHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function deriveShortName(materialName: string, provided: unknown): string {
  const candidate = toTrimmedString(provided);
  return candidate || materialName;
}

function deriveConversionFactor(body: JsonRecord): number | null {
  if (body.conversion_factor !== undefined) {
    const factor = Number(body.conversion_factor);
    return Number.isFinite(factor) && factor > 0 ? factor : null;
  }

  const numerator = Number(body.numerator);
  const denominator = Number(body.denominator);
  if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
    return numerator / denominator;
  }

  return null;
}

export async function createMaterialHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const body = await parseBody(req);
    const materialType = toTrimmedString(body.material_type).toUpperCase();
    const materialName = toTrimmedString(body.material_name);
    const baseUomCode = toTrimmedString(body.base_uom_code).toUpperCase();
    const purchaseUomCode = toTrimmedString(body.purchase_uom_code || body.base_uom_code).toUpperCase();
    const issueUomCode = toTrimmedString(body.issue_uom_code || body.base_uom_code).toUpperCase();

    if (!ALLOWED_MATERIAL_TYPES.has(materialType)) {
      return materialErrorResponse(req, ctx, "OM_INVALID_MATERIAL_TYPE", 400, "Invalid material type");
    }

    if (!materialName || !baseUomCode) {
      return materialErrorResponse(req, ctx, "OM_INVALID_MATERIAL_INPUT", 400, "Material name and base UOM are required");
    }

    if (!(await ensureUomExists(baseUomCode)) ||
      !(await ensureUomExists(purchaseUomCode)) ||
      !(await ensureUomExists(issueUomCode))) {
      return materialErrorResponse(req, ctx, "OM_INVALID_BASE_UOM", 400, "Invalid base UOM");
    }

    const { data: materialCode, error: codeError } = await serviceRoleClient
      .rpc("generate_material_pace_code", { p_material_type: materialType });

    if (codeError || !materialCode) {
      throw new Error("OM_MATERIAL_CREATE_FAILED");
    }

    const payload = {
      pace_code: String(materialCode),
      external_code: toTrimmedString(body.external_code) || null,
      material_name: materialName,
      short_name: deriveShortName(materialName, body.short_name),
      material_type: materialType,
      material_group: toTrimmedString(body.material_group) || null,
      description: toTrimmedString(body.description) || null,
      specification: toTrimmedString(body.specification) || null,
      base_uom_code: baseUomCode,
      purchase_uom_code: purchaseUomCode,
      issue_uom_code: issueUomCode,
      shade_code: toTrimmedString(body.shade_code) || null,
      pack_code: toTrimmedString(body.pack_code) || null,
      external_sku: toTrimmedString(body.external_sku) || null,
      hsn_code: toTrimmedString(body.hsn_code) || null,
      procurement_type: toTrimmedString(body.procurement_type).toUpperCase() || "EXTERNAL",
      import_domestic_flag: toTrimmedString(body.import_domestic_flag).toUpperCase() || "DOMESTIC",
      batch_tracking_required: body.batch_tracking_required === true || body.is_batch_managed === true,
      fifo_tracking_enabled: body.fifo_tracking_enabled === true,
      expiry_tracking_enabled: body.expiry_tracking_enabled === true,
      shelf_life_days: body.shelf_life_days != null ? Number(body.shelf_life_days) : null,
      min_shelf_life_at_grn_days: body.min_shelf_life_at_grn_days != null ? Number(body.min_shelf_life_at_grn_days) : null,
      qa_required_on_inward: body.qa_required_on_inward !== false,
      qa_required_on_fg: body.qa_required_on_fg === true,
      valuation_method: toTrimmedString(body.valuation_method).toUpperCase() || "WEIGHTED_AVERAGE",
      valuation_class: toTrimmedString(body.valuation_class) || null,
      production_mode: toTrimmedString(body.production_mode).toUpperCase() || null,
      bom_exists: body.bom_exists === true,
      delivery_tolerance_enabled: body.delivery_tolerance_enabled === true,
      under_delivery_tolerance_pct: body.under_delivery_tolerance_pct != null ? Number(body.under_delivery_tolerance_pct) : null,
      over_delivery_tolerance_pct: body.over_delivery_tolerance_pct != null ? Number(body.over_delivery_tolerance_pct) : null,
      status: "DRAFT",
      created_by: ctx.auth_user_id,
    };

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .insert(payload)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_MATERIAL_CREATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_CREATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material create failed");
  }
}

export async function listMaterialsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const url = new URL(req.url);
    const materialType = toTrimmedString(url.searchParams.get("material_type")).toUpperCase();
    const statusFilter = mapMaterialStatusInput(url.searchParams.get("status"));
    const search = normalizeSearch(toTrimmedString(url.searchParams.get("search")));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);
    const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);

    let query = serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (materialType) {
      query = query.eq("material_type", materialType);
    }
    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }
    if (search) {
      query = query.or(`pace_code.ilike.%${search}%,material_name.ilike.%${search}%`);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new Error("OM_MATERIAL_LIST_FAILED");
    }

    return okResponse({ data: data ?? [], total: count ?? 0 }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_LIST_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material list failed");
  }
}

export async function getMaterialHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const id = toTrimmedString(new URL(req.url).searchParams.get("id"));
    if (!id) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");
    }

    const material = await getMaterialById(id);
    if (!material) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");
    }

    return okResponse({ data: material }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_LOOKUP_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material lookup failed");
  }
}

export async function updateMaterialHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    if (!id) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");
    }

    const existing = await getMaterialById(id);
    if (!existing) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");
    }

    const currentStatus = String(existing.status ?? "");
    if (!MUTABLE_MATERIAL_STATUSES.has(currentStatus)) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_LOCKED", 422, "Material is locked");
    }

    const updates: JsonRecord = {
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    };

    const mutableFields = [
      "material_name",
      "short_name",
      "material_group",
      "description",
      "specification",
      "shade_code",
      "pack_code",
      "external_sku",
      "hsn_code",
      "procurement_type",
      "import_domestic_flag",
      "batch_tracking_required",
      "fifo_tracking_enabled",
      "expiry_tracking_enabled",
      "shelf_life_days",
      "min_shelf_life_at_grn_days",
      "qa_required_on_inward",
      "qa_required_on_fg",
      "valuation_method",
      "valuation_class",
      "production_mode",
      "bom_exists",
      "delivery_tolerance_enabled",
      "under_delivery_tolerance_pct",
      "over_delivery_tolerance_pct",
      "external_code",
    ];

    for (const field of mutableFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (body.is_batch_managed !== undefined) {
      updates.batch_tracking_required = body.is_batch_managed === true;
    }

    if (Object.keys(updates).length === 2) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_NO_CHANGES", 400, "No changes provided");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_MATERIAL_UPDATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_UPDATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("LOCKED") ? 422 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material update failed");
  }
}

export async function changeMaterialStatusHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    const newStatus = mapMaterialStatusInput(body.new_status);

    if (!id) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");
    }
    if (!MATERIAL_DB_STATUSES.has(newStatus)) {
      return materialErrorResponse(req, ctx, "OM_INVALID_STATUS_TRANSITION", 422, "Status transition not allowed");
    }

    const existing = await getMaterialById(id);
    if (!existing) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");
    }

    const currentStatus = String(existing.status ?? "");
    const allowed = MATERIAL_TRANSITIONS.get(currentStatus);
    if (!allowed?.has(newStatus)) {
      return materialErrorResponse(req, ctx, "OM_INVALID_STATUS_TRANSITION", 422, "Status transition not allowed");
    }

    const updates: JsonRecord = {
      status: newStatus,
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    };

    if (newStatus === "ACTIVE") {
      updates.approved_by = ctx.auth_user_id;
      updates.approved_at = new Date().toISOString();
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_MATERIAL_STATUS_UPDATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_STATUS_UPDATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("TRANSITION") ? 422 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material status update failed");
  }
}

export async function extendMaterialToCompanyHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const body = await parseBody(req);
    const materialId = toTrimmedString(body.material_id);
    const companyId = toTrimmedString(body.company_id);

    if (!(await getMaterialById(materialId))) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");
    }
    if (!(await ensureCompanyExists(companyId))) {
      return materialErrorResponse(req, ctx, "OM_COMPANY_NOT_FOUND", 404, "Company not found");
    }

    const payload = {
      material_id: materialId,
      company_id: companyId,
      valuation_method_override: toTrimmedString(body.valuation_method_override || body.costing_method).toUpperCase() || null,
      hsn_code_override: toTrimmedString(body.hsn_code_override) || null,
      procurement_allowed: body.procurement_allowed !== false,
      status: toTrimmedString(body.status).toUpperCase() || "ACTIVE",
      created_by: ctx.auth_user_id,
      approved_by: body.approved_by ? toTrimmedString(body.approved_by) : null,
      approved_at: body.approved_at ? toTrimmedString(body.approved_at) : null,
    };

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_company_ext")
      .upsert(payload, { onConflict: "material_id,company_id" })
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_MATERIAL_EXTEND_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_EXTEND_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material company extension failed");
  }
}

export async function extendMaterialToPlantHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const body = await parseBody(req);
    const materialId = toTrimmedString(body.material_id);
    const companyId = toTrimmedString(body.company_id);
    const plantId = toTrimmedString(body.plant_id);

    if (!(await getMaterialById(materialId))) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");
    }
    if (!(await ensureCompanyExists(companyId))) {
      return materialErrorResponse(req, ctx, "OM_COMPANY_NOT_FOUND", 404, "Company not found");
    }
    if (!(await ensurePlantExists(plantId))) {
      return materialErrorResponse(req, ctx, "OM_PLANT_NOT_FOUND", 404, "Plant not found");
    }

    const payload = {
      material_id: materialId,
      company_id: companyId,
      plant_id: plantId,
      default_storage_location_id: toTrimmedString(body.default_storage_location_id) || null,
      qa_required_on_inward_override: body.qa_required_on_inward_override ?? null,
      safety_stock_qty: body.safety_stock ?? body.safety_stock_qty ?? null,
      reorder_point_qty: body.reorder_point ?? body.reorder_point_qty ?? null,
      min_order_qty: body.min_order_qty ?? null,
      lead_time_days: body.lead_time_days ?? null,
      status: toTrimmedString(body.status).toUpperCase() || "ACTIVE",
      created_by: ctx.auth_user_id,
      approved_by: body.approved_by ? toTrimmedString(body.approved_by) : null,
      approved_at: body.approved_at ? toTrimmedString(body.approved_at) : null,
    };

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_plant_ext")
      .upsert(payload, { onConflict: "material_id,company_id,plant_id" })
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_MATERIAL_EXTEND_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_EXTEND_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material plant extension failed");
  }
}

export async function createMaterialUomConversionHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const body = await parseBody(req);
    const materialId = toTrimmedString(body.material_id);
    const fromUomCode = toTrimmedString(body.from_uom_code).toUpperCase();
    const toUomCode = toTrimmedString(body.to_uom_code).toUpperCase();
    const conversionFactor = deriveConversionFactor(body);

    if (!(await getMaterialById(materialId))) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");
    }
    if (!fromUomCode || !toUomCode || !(await ensureUomExists(fromUomCode)) || !(await ensureUomExists(toUomCode))) {
      return materialErrorResponse(req, ctx, "OM_INVALID_UOM", 400, "Invalid UOM");
    }
    if (!conversionFactor) {
      return materialErrorResponse(req, ctx, "OM_INVALID_UOM_CONVERSION", 400, "Invalid conversion factor");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_uom_conversion")
      .insert({
        material_id: materialId,
        from_uom_code: fromUomCode,
        to_uom_code: toUomCode,
        conversion_factor: conversionFactor,
        variable_conversion: body.variable_conversion === true,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return materialErrorResponse(req, ctx, "OM_UOM_CONVERSION_EXISTS", 409, "UOM conversion already exists");
      }
      throw new Error("OM_UOM_CONVERSION_CREATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_UOM_CONVERSION_CREATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("EXISTS") ? 409 : code.includes("INVALID") ? 400 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material UOM conversion create failed");
  }
}

export async function listMaterialUomConversionsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const materialId = toTrimmedString(new URL(req.url).searchParams.get("material_id"));
    if (!materialId) {
      return okResponse({ data: [] }, ctx.request_id, req);
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_uom_conversion")
      .select("*")
      .eq("material_id", materialId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error("OM_UOM_CONVERSION_LIST_FAILED");
    }

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_UOM_CONVERSION_LIST_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material UOM conversion list failed");
  }
}

export async function createMaterialCategoryGroupHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const body = await parseBody(req);
    const groupName = toTrimmedString(body.group_name);
    const groupCode = (
      toTrimmedString(body.group_code) ||
      groupName.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50)
    );

    if (!groupName || !groupCode) {
      return materialErrorResponse(req, ctx, "OM_INVALID_CATEGORY_GROUP", 400, "Invalid category group");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_category_group")
      .insert({
        group_name: groupName,
        group_code: groupCode,
        description: toTrimmedString(body.description) || null,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return materialErrorResponse(req, ctx, "OM_CATEGORY_GROUP_EXISTS", 409, "Category group already exists");
      }
      throw new Error("OM_CATEGORY_GROUP_CREATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_CATEGORY_GROUP_CREATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("EXISTS") ? 409 : code.includes("INVALID") ? 400 : 500;
    return materialErrorResponse(req, ctx, code, status, "Category group create failed");
  }
}

export async function listMaterialCategoryGroupsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_category_group")
      .select("*")
      .order("group_name", { ascending: true });

    if (error) {
      throw new Error("OM_CATEGORY_GROUP_LIST_FAILED");
    }

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_CATEGORY_GROUP_LIST_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "Category group list failed");
  }
}

export async function addMaterialCategoryMemberHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const body = await parseBody(req);
    const groupId = toTrimmedString(body.group_id);
    const materialId = toTrimmedString(body.material_id);
    const isPrimary = body.is_primary === true;

    const { data: groupRow, error: groupError } = await serviceRoleClient
      .schema("erp_master")
      .from("material_category_group")
      .select("id")
      .eq("id", groupId)
      .maybeSingle();

    if (groupError || !groupRow?.id) {
      return materialErrorResponse(req, ctx, "OM_GROUP_NOT_FOUND", 404, "Group not found");
    }

    if (!(await getMaterialById(materialId))) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");
    }

    if (isPrimary) {
      await serviceRoleClient
        .schema("erp_master")
        .from("material_category_group_member")
        .update({ is_primary: false })
        .eq("group_id", groupId)
        .eq("is_primary", true);
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_category_group_member")
      .insert({
        group_id: groupId,
        material_id: materialId,
        is_primary: isPrimary,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return materialErrorResponse(req, ctx, "OM_MEMBER_EXISTS", 409, "Category member already exists");
      }
      throw new Error("OM_CATEGORY_MEMBER_CREATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_CATEGORY_MEMBER_CREATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("EXISTS") ? 409 : 500;
    return materialErrorResponse(req, ctx, code, status, "Category member create failed");
  }
}
