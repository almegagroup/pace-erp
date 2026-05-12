/*
 * File-ID: 16.1.2
 * File-Path: supabase/functions/api/_core/procurement/l2_masters.handlers.ts
 * Gate: 16.1
 * Phase: 16
 * Domain: PROCUREMENT
 * Purpose: Implement L2 procurement master data handlers.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const PAYMENT_METHODS = new Set(["CREDIT", "ADVANCE", "LC", "TT", "DA", "DP", "MIXED"]);
const REFERENCE_DATES = new Set(["INVOICE_DATE", "GRN_DATE", "BL_DATE", "SHIPMENT_DATE", "N_A"]);
const LC_TYPES = new Set(["AT_SIGHT", "USANCE", "N_A"]);
const PORT_TYPES = new Set(["SEA", "AIR", "LAND"]);
const TRANSIT_MODES = new Set(["ROAD", "RAIL", "MULTI-MODAL"]);
const TRANSPORTER_DIRECTIONS = new Set(["INBOUND", "OUTBOUND", "BOTH"]);
const TRANSPORTER_MODES = new Set(["ROAD", "RAIL", "COURIER", "MULTI-MODAL"]);

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

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

function parseNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function parseNullableInt(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
}

function parseNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function assertSARole(ctx: ProcurementHandlerContext): void {
  if (ctx.roleCode !== "SA") {
    throw new Error("SA_REQUIRED");
  }
}

function procurementErrorResponse(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function getPathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}

function getIdFromPath(req: Request): string {
  return getPathSegments(req)[3] ?? "";
}

async function generateCode(rpcName: string): Promise<string> {
  const { data, error } = await serviceRoleClient.schema("erp_master").rpc(rpcName);
  if (error || !data) {
    throw new Error("PROCUREMENT_CODE_GENERATION_FAILED");
  }
  return String(data);
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

async function ensurePortExists(portId: string): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("port_master")
    .select("id")
    .eq("id", portId)
    .maybeSingle();
  return !error && Boolean(data?.id);
}

async function ensureCategoryExists(categoryId: string): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_category_master")
    .select("id")
    .eq("id", categoryId)
    .maybeSingle();
  return !error && Boolean(data?.id);
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

async function ensureChaExists(chaId: string): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("cha_master")
    .select("id")
    .eq("id", chaId)
    .maybeSingle();
  return !error && Boolean(data?.id);
}

async function countOpenPosForPaymentTerm(paymentTermId: string): Promise<number> {
  const { count, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order")
    .select("id", { count: "exact", head: true })
    .eq("payment_term_id", paymentTermId)
    .not("status", "in", '("CLOSED","CANCELLED")');
  if (error) {
    throw new Error("PROCUREMENT_PAYMENT_TERM_USAGE_LOOKUP_FAILED");
  }
  return count ?? 0;
}

export async function listPaymentTermsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const activeParam = url.searchParams.get("is_active");
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 100);
    const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);

    let query = serviceRoleClient
      .schema("erp_master")
      .from("payment_terms_master")
      .select("*", { count: "exact" })
      .order("name", { ascending: true })
      .range(offset, offset + limit - 1);

    if (activeParam == null || activeParam === "") {
      query = query.eq("active", true);
    } else {
      query = query.eq("active", activeParam === "true");
    }

    if (companyId && !(await ensureCompanyExists(companyId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_COMPANY_NOT_FOUND", 404, "Company not found");
    }

    const { data, error, count } = await query;
    if (error) throw new Error("PROCUREMENT_PAYMENT_TERMS_LIST_FAILED");
    return okResponse({ data: data ?? [], total: count ?? 0 }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PAYMENT_TERMS_LIST_FAILED";
    const status = code === "PROCUREMENT_COMPANY_NOT_FOUND" ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Payment terms list failed");
  }
}

export async function createPaymentTermsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const body = await parseBody(req);
    const name = toTrimmedString(body.name);
    const paymentMethod = toUpperTrimmedString(body.payment_method);
    const referenceDate = toUpperTrimmedString(body.reference_date || "INVOICE_DATE");
    const lcType = toUpperTrimmedString(body.lc_type || "N_A");

    if (!name || !PAYMENT_METHODS.has(paymentMethod) || !REFERENCE_DATES.has(referenceDate) || !LC_TYPES.has(lcType)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_PAYMENT_TERMS", 400, "Invalid payment terms payload");
    }

    const code = await generateCode("generate_payment_terms_code");
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("payment_terms_master")
      .insert({
        code,
        name,
        payment_method: paymentMethod,
        reference_date: referenceDate,
        credit_days: parseNullableInt(body.credit_days),
        advance_pct: parseNullableNumber(body.advance_pct),
        lc_type: lcType,
        usance_days: parseNullableInt(body.usance_days),
        description: toTrimmedString(body.description) || null,
        active: body.active !== false,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_DUPLICATE_CODE", 409, "Duplicate payment terms code");
      }
      throw new Error("PROCUREMENT_PAYMENT_TERMS_CREATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PAYMENT_TERMS_CREATE_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : code.includes("DUPLICATE") ? 409 : code.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Payment terms create failed");
  }
}

export async function updatePaymentTermsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const id = getIdFromPath(req);
    const body = await parseBody(req);
    const { data: existing, error: existingError } = await serviceRoleClient
      .schema("erp_master")
      .from("payment_terms_master")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (existingError) throw new Error("PROCUREMENT_PAYMENT_TERMS_LOOKUP_FAILED");
    if (!existing) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PAYMENT_TERMS_NOT_FOUND", 404, "Payment terms not found");
    }

    const updates: JsonRecord = {};
    if (body.name !== undefined) updates.name = toTrimmedString(body.name);
    if (body.payment_method !== undefined) {
      const value = toUpperTrimmedString(body.payment_method);
      if (!PAYMENT_METHODS.has(value)) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_PAYMENT_TERMS", 400, "Invalid payment method");
      }
      updates.payment_method = value;
    }
    if (body.reference_date !== undefined) {
      const value = toUpperTrimmedString(body.reference_date);
      if (!REFERENCE_DATES.has(value)) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_PAYMENT_TERMS", 400, "Invalid reference date");
      }
      updates.reference_date = value;
    }
    if (body.lc_type !== undefined) {
      const value = toUpperTrimmedString(body.lc_type);
      if (!LC_TYPES.has(value)) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_PAYMENT_TERMS", 400, "Invalid LC type");
      }
      updates.lc_type = value;
    }
    if (body.credit_days !== undefined) updates.credit_days = parseNullableInt(body.credit_days);
    if (body.advance_pct !== undefined) updates.advance_pct = parseNullableNumber(body.advance_pct);
    if (body.usance_days !== undefined) updates.usance_days = parseNullableInt(body.usance_days);
    if (body.description !== undefined) updates.description = toTrimmedString(body.description) || null;
    if (body.active !== undefined) updates.active = body.active === true;

    if (updates.active === false) {
      const openPoCount = await countOpenPosForPaymentTerm(id);
      if (openPoCount > 0) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_PAYMENT_TERM_IN_USE", 409, "Cannot deactivate payment term referenced by open PO");
      }
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("payment_terms_master")
      .update({
        ...updates,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) throw new Error("PROCUREMENT_PAYMENT_TERMS_UPDATE_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PAYMENT_TERMS_UPDATE_FAILED";
    const status =
      code === "SA_REQUIRED" ? 403
        : code === "PROCUREMENT_PAYMENT_TERMS_NOT_FOUND" ? 404
        : code.includes("IN_USE") ? 409
        : code.includes("INVALID") ? 400
        : 500;
    return procurementErrorResponse(req, ctx, code, status, "Payment terms update failed");
  }
}

export async function getPaymentTermsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const id = getIdFromPath(req);
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("payment_terms_master")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error("PROCUREMENT_PAYMENT_TERMS_LOOKUP_FAILED");
    if (!data) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PAYMENT_TERMS_NOT_FOUND", 404, "Payment terms not found");
    }
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PAYMENT_TERMS_LOOKUP_FAILED";
    const status = code === "PROCUREMENT_PAYMENT_TERMS_NOT_FOUND" ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Payment terms lookup failed");
  }
}

export async function listPortsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const country = toTrimmedString(url.searchParams.get("country"));
    const activeParam = url.searchParams.get("is_active");
    let query = serviceRoleClient
      .schema("erp_master")
      .from("port_master")
      .select("*")
      .order("port_name", { ascending: true });
    if (activeParam == null || activeParam === "") {
      query = query.eq("active", true);
    } else {
      query = query.eq("active", activeParam === "true");
    }
    if (country) query = query.ilike("country", country);
    const { data, error } = await query;
    if (error) throw new Error("PROCUREMENT_PORT_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PORT_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "Port list failed");
  }
}

export async function createPortHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const body = await parseBody(req);
    const portName = toTrimmedString(body.port_name);
    const portType = toUpperTrimmedString(body.port_type);
    if (!portName || !PORT_TYPES.has(portType)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_PORT", 400, "Invalid port payload");
    }
    const portCode = await generateCode("generate_port_code");
    const defaultChaId = toTrimmedString(body.default_cha_id);
    if (defaultChaId && !(await ensureChaExists(defaultChaId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CHA_NOT_FOUND", 404, "CHA not found");
    }
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("port_master")
      .insert({
        port_code: portCode,
        port_name: portName,
        port_type: portType,
        state: toTrimmedString(body.state) || null,
        country: toTrimmedString(body.country) || "India",
        default_cha_id: defaultChaId || null,
        active: body.active !== false,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_DUPLICATE_CODE", 409, "Duplicate port code");
      }
      throw new Error("PROCUREMENT_PORT_CREATE_FAILED");
    }
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PORT_CREATE_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : code.includes("DUPLICATE") ? 409 : code.includes("NOT_FOUND") ? 404 : code.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Port create failed");
  }
}

export async function updatePortHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const id = getIdFromPath(req);
    const body = await parseBody(req);
    const updates: JsonRecord = {};
    if (body.port_name !== undefined) updates.port_name = toTrimmedString(body.port_name);
    if (body.port_type !== undefined) {
      const value = toUpperTrimmedString(body.port_type);
      if (!PORT_TYPES.has(value)) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_PORT", 400, "Invalid port type");
      }
      updates.port_type = value;
    }
    if (body.state !== undefined) updates.state = toTrimmedString(body.state) || null;
    if (body.country !== undefined) updates.country = toTrimmedString(body.country) || "India";
    if (body.active !== undefined) updates.active = body.active === true;
    if (body.default_cha_id !== undefined) {
      const chaId = toTrimmedString(body.default_cha_id);
      if (chaId && !(await ensureChaExists(chaId))) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_CHA_NOT_FOUND", 404, "CHA not found");
      }
      updates.default_cha_id = chaId || null;
    }
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("port_master")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) throw new Error("PROCUREMENT_PORT_UPDATE_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PORT_UPDATE_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Port update failed");
  }
}

export async function listTransitTimesHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const portId = toTrimmedString(url.searchParams.get("port_id"));
    const companyId = toTrimmedString(url.searchParams.get("company_id") || url.searchParams.get("plant_id"));
    let query = serviceRoleClient
      .schema("erp_master")
      .from("port_plant_transit_master")
      .select("*")
      .order("created_at", { ascending: false });
    if (portId) query = query.eq("port_id", portId);
    if (companyId) query = query.eq("company_id", companyId);
    const { data, error } = await query;
    if (error) throw new Error("PROCUREMENT_TRANSIT_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_TRANSIT_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "Transit list failed");
  }
}

export async function upsertTransitTimeHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const body = await parseBody(req);
    const portId = toTrimmedString(body.port_id);
    const companyId = toTrimmedString(body.company_id || body.plant_id);
    const transitDays = parseNullableInt(body.transit_days);
    const mode = toUpperTrimmedString(body.mode || "ROAD");
    if (!portId || !companyId || transitDays == null || transitDays < 0 || !TRANSIT_MODES.has(mode)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_TRANSIT", 400, "Invalid transit payload");
    }
    if (!(await ensurePortExists(portId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PORT_NOT_FOUND", 404, "Port not found");
    }
    if (!(await ensureCompanyExists(companyId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_COMPANY_NOT_FOUND", 404, "Company not found");
    }
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("port_plant_transit_master")
      .upsert({
        port_id: portId,
        company_id: companyId,
        transit_days: transitDays,
        mode,
        remarks: toTrimmedString(body.remarks) || null,
        active: body.active !== false,
        created_by: ctx.auth_user_id,
      }, { onConflict: "port_id,company_id" })
      .select("*")
      .single();
    if (error) throw new Error("PROCUREMENT_TRANSIT_UPSERT_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_TRANSIT_UPSERT_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Transit upsert failed");
  }
}

export async function listMaterialCategoriesHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const companyId = toTrimmedString(new URL(req.url).searchParams.get("company_id"));
    if (companyId && !(await ensureCompanyExists(companyId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_COMPANY_NOT_FOUND", 404, "Company not found");
    }
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_category_master")
      .select("*")
      .eq("active", true)
      .order("category_name", { ascending: true });
    if (error) throw new Error("PROCUREMENT_MATERIAL_CATEGORY_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_MATERIAL_CATEGORY_LIST_FAILED";
    const status = code === "PROCUREMENT_COMPANY_NOT_FOUND" ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Material category list failed");
  }
}

export async function createMaterialCategoryHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const body = await parseBody(req);
    const categoryName = toTrimmedString(body.category_name);
    if (!categoryName) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_MATERIAL_CATEGORY", 400, "Category name is required");
    }
    const categoryCode = await generateCode("generate_material_category_code");
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_category_master")
      .insert({
        category_code: categoryCode,
        category_name: categoryName,
        description: toTrimmedString(body.description) || null,
        active: body.active !== false,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_DUPLICATE_CODE", 409, "Duplicate material category code");
      }
      throw new Error("PROCUREMENT_MATERIAL_CATEGORY_CREATE_FAILED");
    }
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_MATERIAL_CATEGORY_CREATE_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : code.includes("DUPLICATE") ? 409 : code.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Material category create failed");
  }
}

export async function listImportLeadTimesHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const portId = toTrimmedString(url.searchParams.get("port_id"));
    const categoryId = toTrimmedString(url.searchParams.get("material_category_id"));
    let query = serviceRoleClient
      .schema("erp_master")
      .from("lead_time_master_import")
      .select("*")
      .eq("active", true)
      .order("effective_from", { ascending: false });
    if (portId) query = query.eq("port_of_discharge_id", portId);
    if (categoryId) query = query.eq("material_category_id", categoryId);
    const { data, error } = await query;
    if (error) throw new Error("PROCUREMENT_IMPORT_LEAD_TIME_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_IMPORT_LEAD_TIME_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "Import lead time list failed");
  }
}

export async function upsertImportLeadTimeHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const body = await parseBody(req);
    const vendorId = toTrimmedString(body.vendor_id);
    const categoryId = toTrimmedString(body.material_category_id);
    const portId = toTrimmedString(body.port_of_discharge_id || body.port_id);
    if (!(await ensureVendorExists(vendorId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_VENDOR_NOT_FOUND", 404, "Vendor not found");
    }
    if (!(await ensureCategoryExists(categoryId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CATEGORY_NOT_FOUND", 404, "Material category not found");
    }
    if (!(await ensurePortExists(portId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PORT_NOT_FOUND", 404, "Port not found");
    }
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("lead_time_master_import")
      .insert({
        vendor_id: vendorId,
        material_category_id: categoryId,
        port_of_loading: toTrimmedString(body.port_of_loading),
        port_of_discharge_id: portId,
        sail_time_days: parseNullableInt(body.sail_time_days) ?? 0,
        clearance_days: parseNullableInt(body.clearance_days) ?? 0,
        effective_from: toTrimmedString(body.effective_from),
        effective_to: toTrimmedString(body.effective_to) || null,
        active: body.active !== false,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();
    if (error) throw new Error("PROCUREMENT_IMPORT_LEAD_TIME_UPSERT_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_IMPORT_LEAD_TIME_UPSERT_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Import lead time upsert failed");
  }
}

export async function listDomesticLeadTimesHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const companyId = toTrimmedString(new URL(req.url).searchParams.get("plant_id") || new URL(req.url).searchParams.get("company_id"));
    let query = serviceRoleClient
      .schema("erp_master")
      .from("lead_time_master_domestic")
      .select("*")
      .eq("active", true)
      .order("effective_from", { ascending: false });
    if (companyId) query = query.eq("company_id", companyId);
    const { data, error } = await query;
    if (error) throw new Error("PROCUREMENT_DOMESTIC_LEAD_TIME_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_DOMESTIC_LEAD_TIME_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "Domestic lead time list failed");
  }
}

export async function upsertDomesticLeadTimeHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const body = await parseBody(req);
    const vendorId = toTrimmedString(body.vendor_id);
    const companyId = toTrimmedString(body.company_id || body.plant_id);
    if (!(await ensureVendorExists(vendorId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_VENDOR_NOT_FOUND", 404, "Vendor not found");
    }
    if (!(await ensureCompanyExists(companyId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_COMPANY_NOT_FOUND", 404, "Company not found");
    }
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("lead_time_master_domestic")
      .insert({
        vendor_id: vendorId,
        company_id: companyId,
        transit_days: parseNullableInt(body.transit_days) ?? 0,
        effective_from: toTrimmedString(body.effective_from),
        effective_to: toTrimmedString(body.effective_to) || null,
        active: body.active !== false,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();
    if (error) throw new Error("PROCUREMENT_DOMESTIC_LEAD_TIME_UPSERT_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_DOMESTIC_LEAD_TIME_UPSERT_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Domestic lead time upsert failed");
  }
}

export async function listTransportersHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const direction = toUpperTrimmedString(new URL(req.url).searchParams.get("direction"));
    let query = serviceRoleClient
      .schema("erp_master")
      .from("transporter_master")
      .select("*")
      .eq("active", true)
      .order("transporter_name", { ascending: true });
    if (direction === "INBOUND") {
      query = query.in("usage_direction", ["INBOUND", "BOTH"]);
    } else if (direction === "OUTBOUND") {
      query = query.in("usage_direction", ["OUTBOUND", "BOTH"]);
    } else if (direction === "BOTH") {
      query = query.in("usage_direction", ["BOTH"]);
    }
    const { data, error } = await query;
    if (error) throw new Error("PROCUREMENT_TRANSPORTER_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_TRANSPORTER_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "Transporter list failed");
  }
}

export async function createTransporterHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const body = await parseBody(req);
    const transporterName = toTrimmedString(body.transporter_name);
    const usageDirection = toUpperTrimmedString(body.usage_direction);
    const mode = toUpperTrimmedString(body.mode || "ROAD");
    if (!transporterName || !TRANSPORTER_DIRECTIONS.has(usageDirection) || !TRANSPORTER_MODES.has(mode)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_TRANSPORTER", 400, "Invalid transporter payload");
    }
    const transporterCode = await generateCode("generate_transporter_code");
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("transporter_master")
      .insert({
        transporter_code: transporterCode,
        transporter_name: transporterName,
        usage_direction: usageDirection,
        mode,
        contact_person: toTrimmedString(body.contact_person) || null,
        phone: toTrimmedString(body.phone) || null,
        email: toTrimmedString(body.email) || null,
        pan_number: toTrimmedString(body.pan_number) || null,
        gst_number: toTrimmedString(body.gst_number) || null,
        address: toTrimmedString(body.address) || null,
        active: body.active !== false,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_DUPLICATE_CODE", 409, "Duplicate transporter code");
      }
      throw new Error("PROCUREMENT_TRANSPORTER_CREATE_FAILED");
    }
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_TRANSPORTER_CREATE_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : code.includes("DUPLICATE") ? 409 : code.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Transporter create failed");
  }
}

export async function updateTransporterHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const id = getIdFromPath(req);
    const body = await parseBody(req);
    const updates: JsonRecord = {};
    if (body.transporter_name !== undefined) updates.transporter_name = toTrimmedString(body.transporter_name);
    if (body.usage_direction !== undefined) {
      const value = toUpperTrimmedString(body.usage_direction);
      if (!TRANSPORTER_DIRECTIONS.has(value)) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_TRANSPORTER", 400, "Invalid transporter direction");
      }
      updates.usage_direction = value;
    }
    if (body.mode !== undefined) {
      const value = toUpperTrimmedString(body.mode);
      if (!TRANSPORTER_MODES.has(value)) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_TRANSPORTER", 400, "Invalid transporter mode");
      }
      updates.mode = value;
    }
    for (const field of ["contact_person", "phone", "email", "pan_number", "gst_number", "address"] as const) {
      if (body[field] !== undefined) updates[field] = toTrimmedString(body[field]) || null;
    }
    if (body.active !== undefined) updates.active = body.active === true;
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("transporter_master")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) throw new Error("PROCUREMENT_TRANSPORTER_UPDATE_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_TRANSPORTER_UPDATE_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : code.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Transporter update failed");
  }
}

export async function listCHAsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("cha_master")
      .select("*")
      .eq("active", true)
      .order("cha_name", { ascending: true });
    if (error) throw new Error("PROCUREMENT_CHA_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CHA_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "CHA list failed");
  }
}

export async function createCHAHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const body = await parseBody(req);
    const chaName = toTrimmedString(body.cha_name);
    const licenseNumber = toTrimmedString(body.cha_license_number);
    if (!chaName || !licenseNumber) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_CHA", 400, "CHA name and license number are required");
    }
    const chaCode = await generateCode("generate_cha_code");
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("cha_master")
      .insert({
        cha_code: chaCode,
        cha_name: chaName,
        cha_license_number: licenseNumber,
        gst_number: toTrimmedString(body.gst_number) || null,
        pan_number: toTrimmedString(body.pan_number) || null,
        contact_person: toTrimmedString(body.contact_person) || null,
        phone: toTrimmedString(body.phone) || null,
        email: toTrimmedString(body.email) || null,
        address: toTrimmedString(body.address) || null,
        active: body.active !== false,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_DUPLICATE_CODE", 409, "Duplicate CHA code");
      }
      throw new Error("PROCUREMENT_CHA_CREATE_FAILED");
    }
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CHA_CREATE_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : code.includes("DUPLICATE") ? 409 : code.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CHA create failed");
  }
}

export async function mapCHAToPortHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const chaId = getIdFromPath(req);
    const body = await parseBody(req);
    if (!(await ensureChaExists(chaId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CHA_NOT_FOUND", 404, "CHA not found");
    }
    const portIds = Array.isArray(body.port_ids)
      ? body.port_ids.map((value) => toTrimmedString(value)).filter(Boolean)
      : [toTrimmedString(body.port_id)].filter(Boolean);
    if (portIds.length === 0) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PORT_REQUIRED", 400, "At least one port is required");
    }
    for (const portId of portIds) {
      if (!(await ensurePortExists(portId))) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_PORT_NOT_FOUND", 404, "Port not found");
      }
    }
    const rows = portIds.map((portId) => ({ cha_id: chaId, port_id: portId }));
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("cha_port_map")
      .upsert(rows, { onConflict: "cha_id,port_id" })
      .select("*");
    if (error) {
      if (error.code === "23505") {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_DUPLICATE_CODE", 409, "Duplicate CHA-port mapping");
      }
      throw new Error("PROCUREMENT_CHA_PORT_MAP_FAILED");
    }
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CHA_PORT_MAP_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("REQUIRED") ? 400 : code.includes("DUPLICATE") ? 409 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CHA port mapping failed");
  }
}

export async function listCHAPortsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const chaId = getIdFromPath(req);
    if (!(await ensureChaExists(chaId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CHA_NOT_FOUND", 404, "CHA not found");
    }
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("cha_port_map")
      .select("*")
      .eq("cha_id", chaId)
      .order("created_at", { ascending: false });
    if (error) throw new Error("PROCUREMENT_CHA_PORT_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CHA_PORT_LIST_FAILED";
    const status = code === "PROCUREMENT_CHA_NOT_FOUND" ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CHA port list failed");
  }
}
