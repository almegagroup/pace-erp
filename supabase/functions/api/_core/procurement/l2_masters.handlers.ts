/*
 * File-ID: 16.1.2
 * File-Path: supabase/functions/api/_core/procurement/l2_masters.handlers.ts
 * Gate: 26
 * Phase: 26
 * Domain: PROCUREMENT
 * Purpose: Implement L2 procurement master data handlers. Gate-26: manager-or-SA access now applies to all write handlers to allow L2_MANAGER+ access.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { deriveCompanyFieldsFromGstProfile } from "../../_shared/gst_company_fields.ts";
import { resolveGstProfileWithSource } from "../../_shared/gst_resolver.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const PAYMENT_METHODS = new Set(["CREDIT", "ADVANCE"]);
const PAYMENT_TYPES  = new Set(["LC", "TT", "DA", "DP", "MIXED", "N_A"]);
const LC_TYPES = new Set(["AT_SIGHT", "USANCE", "N_A"]);
const PORT_TYPES = new Set(["SEA", "AIR", "LAND"]);
const PORT_ROLES = new Set(["DISCHARGE", "LOADING", "BOTH"]);
const TRANSIT_MODES = new Set(["ROAD", "RAIL", "MULTI-MODAL"]);
const TRANSPORTER_DIRECTIONS = new Set(["IMPORT", "DOMESTIC", "BOTH"]);
const TRANSPORTER_MODES = new Set(["ROAD", "RAIL", "COURIER", "MULTI-MODAL"]);
const MANAGER_OR_SA_ROLES = new Set([
  "SA",
  "GA",
  "DIRECTOR",
  "L4_MANAGER",
  "L3_MANAGER",
  "L2_AUDITOR",
  "L1_AUDITOR",
  "L2_MANAGER",
]);

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

function assertManagerOrSARole(ctx: ProcurementHandlerContext): void {
  if (!MANAGER_OR_SA_ROLES.has(ctx.roleCode)) {
    throw new Error("MANAGER_OR_SA_REQUIRED");
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

// getIdFromPath assumes a 4-segment path (.../resource/:id). Routes one
// level deeper — /api/procurement/lead-times/import/:id and .../domestic/:id
// — need the last segment instead, or it silently grabs "import"/"domestic".
function getLastPathSegment(req: Request): string {
  const segments = getPathSegments(req);
  return segments[segments.length - 1] ?? "";
}

async function generateCodeFromSequence(
  tableName: string,
  prefix: string,
  padLength: number,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: seq, error: readErr } = await serviceRoleClient
      .schema("erp_master")
      .from(tableName)
      .select("last_number")
      .single();
    if (readErr || !seq) throw new Error("PROCUREMENT_CODE_GENERATION_FAILED");
    const next = (seq.last_number as number) + 1;
    const { data: updated, error: updateErr } = await serviceRoleClient
      .schema("erp_master")
      .from(tableName)
      .update({ last_number: next })
      .eq("last_number", seq.last_number)
      .select("last_number");
    if (!updateErr && updated && updated.length > 0) {
      return `${prefix}${String(next).padStart(padLength, "0")}`;
    }
  }
  throw new Error("PROCUREMENT_CODE_GENERATION_FAILED");
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
      .select("*, reference_date_type:reference_date_type_id(id, code, label, source_document)", { count: "exact" })
      .order("name", { ascending: true })
      .range(offset, offset + limit - 1);

    if (activeParam === "all") {
      // no filter, show all (used by SA master page)
    } else if (activeParam === "true" || activeParam === "false") {
      query = query.eq("active", activeParam === "true");
    } else {
      query = query.eq("active", true);
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
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const name = toTrimmedString(body.name);
    const paymentMethod = toUpperTrimmedString(body.payment_method);
    const paymentType   = toUpperTrimmedString(body.payment_type || "N_A");
    const referenceDateTypeId = toTrimmedString(body.reference_date_type_id);
    const lcType = toUpperTrimmedString(body.lc_type || "N_A");

    if (!name || !PAYMENT_METHODS.has(paymentMethod) || !PAYMENT_TYPES.has(paymentType) || !referenceDateTypeId || !LC_TYPES.has(lcType)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_PAYMENT_TERMS", 400, "Invalid payment terms payload");
    }

    const code = await generateCodeFromSequence("payment_terms_code_sequence", "PT-", 3);
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("payment_terms_master")
      .insert({
        code,
        name,
        payment_method: paymentMethod,
        payment_type: paymentType,
        reference_date_type_id: referenceDateTypeId,
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
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("DUPLICATE") ? 409 : code.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Payment terms create failed");
  }
}

export async function updatePaymentTermsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
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
    if (body.payment_type !== undefined) {
      const value = toUpperTrimmedString(body.payment_type);
      if (!PAYMENT_TYPES.has(value)) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_PAYMENT_TERMS", 400, "Invalid payment type");
      }
      updates.payment_type = value;
    }
    if (body.reference_date_type_id !== undefined) {
      const value = toTrimmedString(body.reference_date_type_id);
      if (!value) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_PAYMENT_TERMS", 400, "Invalid reference date type");
      }
      updates.reference_date_type_id = value;
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
      code === "MANAGER_OR_SA_REQUIRED" ? 403
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

export async function deletePaymentTermsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_PAYMENT_TERMS", 400, "ID required");

    const openPoCount = await countOpenPosForPaymentTerm(id);
    if (openPoCount > 0) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PAYMENT_TERM_IN_USE", 409, "Cannot delete payment term referenced by open PO");
    }

    const { error } = await serviceRoleClient
      .schema("erp_master")
      .from("payment_terms_master")
      .delete()
      .eq("id", id);
    if (error) throw new Error("PROCUREMENT_PAYMENT_TERMS_DELETE_FAILED");
    return okResponse({ ok: true }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PAYMENT_TERMS_DELETE_FAILED";
    console.error("[PT_DELETE_FAIL]", code, String(err));
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("IN_USE") ? 409 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Payment terms delete failed");
  }
}

export async function togglePaymentTermsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    const active = body.active === true || body.active === "true";
    if (!id) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_PAYMENT_TERMS", 400, "ID required");

    if (!active) {
      const openPoCount = await countOpenPosForPaymentTerm(id);
      if (openPoCount > 0) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_PAYMENT_TERM_IN_USE", 409, "Cannot deactivate payment term referenced by open PO");
      }
    }

    const { error } = await serviceRoleClient
      .schema("erp_master")
      .from("payment_terms_master")
      .update({ active, last_updated_at: new Date().toISOString(), last_updated_by: ctx.auth_user_id })
      .eq("id", id);
    if (error) throw new Error("PROCUREMENT_PAYMENT_TERMS_TOGGLE_FAILED");
    return okResponse({ ok: true }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PAYMENT_TERMS_TOGGLE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("IN_USE") ? 409 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Payment terms toggle failed");
  }
}

export async function listReferenceDateTypesHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const activeOnly = url.searchParams.get("active") !== "false";
    let query = serviceRoleClient
      .schema("erp_master")
      .from("reference_date_types")
      .select("*")
      .order("label", { ascending: true });
    if (activeOnly) query = query.eq("is_active", true);
    const { data, error } = await query;
    if (error) throw new Error("PROCUREMENT_REF_DATE_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_REF_DATE_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "Reference date types list failed");
  }
}

export async function createReferenceDateTypeHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const code = toUpperTrimmedString(body.code);
    const label = toTrimmedString(body.label);
    const sourceDocument = toUpperTrimmedString(body.source_document);
    const sourceField = toTrimmedString(body.source_field) || null;

    if (!code || !label || !["CSN", "IV", "MANUAL"].includes(sourceDocument)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_REF_DATE_TYPE", 400, "Invalid reference date type payload");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("reference_date_types")
      .insert({ code, label, source_document: sourceDocument, source_field: sourceField, description: toTrimmedString(body.description) || null, created_by: ctx.auth_user_id })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") return procurementErrorResponse(req, ctx, "PROCUREMENT_REF_DATE_EXISTS", 409, "Reference date type code already exists");
      throw new Error("PROCUREMENT_REF_DATE_CREATE_FAILED");
    }
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_REF_DATE_CREATE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("EXISTS") ? 409 : code.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Reference date type create failed");
  }
}

export async function toggleReferenceDateTypeHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    const isActive = body.is_active === true || body.is_active === "true";
    if (!id) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_REF_DATE_TYPE", 400, "ID required");

    const { error } = await serviceRoleClient
      .schema("erp_master")
      .from("reference_date_types")
      .update({ is_active: isActive })
      .eq("id", id);
    if (error) throw new Error("PROCUREMENT_REF_DATE_TOGGLE_FAILED");
    return okResponse({ ok: true }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_REF_DATE_TOGGLE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Reference date type toggle failed");
  }
}

export async function listPortsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const country = toTrimmedString(url.searchParams.get("country"));
    const activeParam = url.searchParams.get("is_active");
    const portRole = toUpperTrimmedString(url.searchParams.get("port_role") ?? "");
    let query = serviceRoleClient
      .schema("erp_master")
      .from("port_master")
      .select("*")
      .order("port_name", { ascending: true });
    if (activeParam === "all") {
      // no filter
    } else if (activeParam === "true" || activeParam === "false") {
      query = query.eq("active", activeParam === "true");
    } else {
      query = query.eq("active", true);
    }
    if (country) query = query.ilike("country", country);
    if (portRole && PORT_ROLES.has(portRole)) query = query.eq("port_role", portRole);
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
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const portName = toTrimmedString(body.port_name);
    const portType = toUpperTrimmedString(body.port_type);
    if (!portName || !PORT_TYPES.has(portType)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_PORT", 400, "Invalid port payload");
    }
    const portRole = toUpperTrimmedString(body.port_role || "DISCHARGE");
    if (!PORT_ROLES.has(portRole)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_PORT", 400, "Invalid port role");
    }
    const portCode = await generateCodeFromSequence("port_code_sequence", "PORT-", 4);
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
        port_role: portRole,
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
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("DUPLICATE") ? 409 : code.includes("NOT_FOUND") ? 404 : code.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Port create failed");
  }
}

export async function updatePortHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
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
    if (body.port_role !== undefined) {
      const value = toUpperTrimmedString(body.port_role);
      if (!PORT_ROLES.has(value)) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_PORT", 400, "Invalid port role");
      }
      updates.port_role = value;
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
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Port update failed");
  }
}

async function countPortReferences(portId: string): Promise<number> {
  const [transit, leadTime, chaMap] = await Promise.all([
    serviceRoleClient.schema("erp_master").from("port_plant_transit_master").select("id").eq("port_id", portId),
    serviceRoleClient.schema("erp_master").from("lead_time_master_import").select("id").eq("port_of_discharge_id", portId),
    serviceRoleClient.schema("erp_master").from("cha_port_map").select("id").eq("port_id", portId),
  ]);
  if (transit.error || leadTime.error || chaMap.error) {
    throw new Error("PROCUREMENT_PORT_USAGE_LOOKUP_FAILED");
  }
  return (transit.data?.length ?? 0) + (leadTime.data?.length ?? 0) + (chaMap.data?.length ?? 0);
}

export async function deletePortHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_PORT", 400, "ID required");

    const refCount = await countPortReferences(id);
    if (refCount > 0) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PORT_IN_USE", 409, "Cannot delete port referenced by transit times, lead times, or CHA mapping");
    }

    const { error } = await serviceRoleClient
      .schema("erp_master")
      .from("port_master")
      .delete()
      .eq("id", id);
    if (error) throw new Error("PROCUREMENT_PORT_DELETE_FAILED");
    return okResponse({ ok: true }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PORT_DELETE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("IN_USE") ? 409 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Port delete failed");
  }
}

export async function togglePortHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    const active = body.active === true || body.active === "true";
    if (!id) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_PORT", 400, "ID required");

    if (!active) {
      const refCount = await countPortReferences(id);
      if (refCount > 0) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_PORT_IN_USE", 409, "Cannot deactivate port referenced by transit times, lead times, or CHA mapping");
      }
    }

    const { error } = await serviceRoleClient
      .schema("erp_master")
      .from("port_master")
      .update({ active })
      .eq("id", id);
    if (error) throw new Error("PROCUREMENT_PORT_TOGGLE_FAILED");
    return okResponse({ ok: true }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PORT_TOGGLE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("IN_USE") ? 409 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Port toggle failed");
  }
}

export async function listTransitTimesHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const portId = toTrimmedString(url.searchParams.get("port_id"));
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
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
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const portId = toTrimmedString(body.port_id);
    const companyId = toTrimmedString(body.company_id);
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
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Transit upsert failed");
  }
}

export async function listProcurementCompaniesHandler(_req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("companies")
      .select("id, company_code, company_name")
      .eq("company_kind", "BUSINESS")
      .order("company_code", { ascending: true });
    if (error) throw new Error("PROCUREMENT_COMPANY_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, _req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_COMPANY_LIST_FAILED";
    return procurementErrorResponse(_req, ctx, code, 500, "Company list failed");
  }
}

export async function deleteTransitTimeHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_TRANSIT", 400, "Transit id required");
    const { error } = await serviceRoleClient.schema("erp_master").from("port_plant_transit_master").delete().eq("id", id);
    if (error) throw new Error("PROCUREMENT_TRANSIT_DELETE_FAILED");
    return okResponse({ data: { id } }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_TRANSIT_DELETE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Transit delete failed");
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
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const categoryName = toTrimmedString(body.category_name);
    if (!categoryName) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_MATERIAL_CATEGORY", 400, "Category name is required");
    }
    const categoryCode = await generateCodeFromSequence("material_category_code_sequence", "MC-", 4);
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
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("DUPLICATE") ? 409 : code.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Material category create failed");
  }
}

export async function listImportLeadTimesHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const portId = toTrimmedString(url.searchParams.get("port_id"));
    const activeParam = url.searchParams.get("is_active");
    let query = serviceRoleClient
      .schema("erp_master")
      .from("lead_time_master_import")
      .select(`*, vendor:vendor_id(vendor_code, vendor_name), port:port_of_discharge_id(port_code, port_name)`)
      .order("effective_from", { ascending: false });
    if (activeParam === "all") {
      // no filter
    } else {
      query = query.eq("active", true);
    }
    if (portId) query = query.eq("port_of_discharge_id", portId);
    const { data, error } = await query;
    if (error) throw new Error("PROCUREMENT_IMPORT_LEAD_TIME_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_IMPORT_LEAD_TIME_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "Import lead time list failed");
  }
}

export async function deleteImportLeadTimeHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getLastPathSegment(req);
    const { error } = await serviceRoleClient
      .schema("erp_master")
      .from("lead_time_master_import")
      .delete()
      .eq("id", id);
    if (error) throw new Error("PROCUREMENT_IMPORT_LEAD_TIME_DELETE_FAILED");
    return okResponse({ ok: true }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_IMPORT_LEAD_TIME_DELETE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Import lead time delete failed");
  }
}

export async function updateImportLeadTimeHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getLastPathSegment(req);
    const body = await parseBody(req);

    const updates: Record<string, unknown> = {};
    if (body.vendor_id !== undefined) {
      const vendorId = toTrimmedString(body.vendor_id);
      if (!(await ensureVendorExists(vendorId))) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_VENDOR_NOT_FOUND", 404, "Vendor not found");
      }
      updates.vendor_id = vendorId;
    }
    if (body.port_of_discharge_id !== undefined || body.port_id !== undefined) {
      const portId = toTrimmedString(body.port_of_discharge_id || body.port_id);
      if (!(await ensurePortExists(portId))) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_PORT_NOT_FOUND", 404, "Port not found");
      }
      updates.port_of_discharge_id = portId;
    }
    if (body.sail_time_days !== undefined) updates.sail_time_days = parseNullableInt(body.sail_time_days) ?? 0;
    if (body.clearance_days !== undefined) updates.clearance_days = parseNullableInt(body.clearance_days) ?? 0;
    if (body.effective_from !== undefined) updates.effective_from = toTrimmedString(body.effective_from);
    if (body.effective_to !== undefined) updates.effective_to = toTrimmedString(body.effective_to) || null;
    if (body.active !== undefined) updates.active = body.active !== false;

    if (Object.keys(updates).length === 0) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_IMPORT_LEAD_TIME_NO_CHANGES", 400, "No changes provided");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("lead_time_master_import")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) throw new Error("PROCUREMENT_IMPORT_LEAD_TIME_UPDATE_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_IMPORT_LEAD_TIME_UPDATE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("NO_CHANGES") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Import lead time update failed");
  }
}

export async function upsertImportLeadTimeHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const vendorId = toTrimmedString(body.vendor_id);
    const portId = toTrimmedString(body.port_of_discharge_id || body.port_id);
    if (!(await ensureVendorExists(vendorId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_VENDOR_NOT_FOUND", 404, "Vendor not found");
    }
    if (!(await ensurePortExists(portId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PORT_NOT_FOUND", 404, "Port not found");
    }
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("lead_time_master_import")
      .insert({
        vendor_id: vendorId,
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
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Import lead time upsert failed");
  }
}

export async function listDomesticLeadTimesHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const activeParam = url.searchParams.get("is_active");
    let query = serviceRoleClient
      .schema("erp_master")
      .from("lead_time_master_domestic")
      .select(`*, vendor:vendor_id(vendor_code, vendor_name), company:company_id(company_code, company_name)`)
      .order("effective_from", { ascending: false });
    if (activeParam === "all") {
      // no filter
    } else {
      query = query.eq("active", true);
    }
    if (companyId) query = query.eq("company_id", companyId);
    const { data, error } = await query;
    if (error) throw new Error("PROCUREMENT_DOMESTIC_LEAD_TIME_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_DOMESTIC_LEAD_TIME_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "Domestic lead time list failed");
  }
}

export async function deleteDomesticLeadTimeHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getLastPathSegment(req);
    const { error } = await serviceRoleClient
      .schema("erp_master")
      .from("lead_time_master_domestic")
      .delete()
      .eq("id", id);
    if (error) throw new Error("PROCUREMENT_DOMESTIC_LEAD_TIME_DELETE_FAILED");
    return okResponse({ ok: true }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_DOMESTIC_LEAD_TIME_DELETE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Domestic lead time delete failed");
  }
}

export async function updateDomesticLeadTimeHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getLastPathSegment(req);
    const body = await parseBody(req);

    const updates: Record<string, unknown> = {};
    if (body.vendor_id !== undefined) {
      const vendorId = toTrimmedString(body.vendor_id);
      if (!(await ensureVendorExists(vendorId))) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_VENDOR_NOT_FOUND", 404, "Vendor not found");
      }
      updates.vendor_id = vendorId;
    }
    if (body.company_id !== undefined) {
      const companyId = toTrimmedString(body.company_id);
      if (!(await ensureCompanyExists(companyId))) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_COMPANY_NOT_FOUND", 404, "Company not found");
      }
      updates.company_id = companyId;
    }
    if (body.transit_days !== undefined) updates.transit_days = parseNullableInt(body.transit_days) ?? 0;
    if (body.effective_from !== undefined) updates.effective_from = toTrimmedString(body.effective_from);
    if (body.effective_to !== undefined) updates.effective_to = toTrimmedString(body.effective_to) || null;
    if (body.active !== undefined) updates.active = body.active !== false;

    if (Object.keys(updates).length === 0) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_DOMESTIC_LEAD_TIME_NO_CHANGES", 400, "No changes provided");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("lead_time_master_domestic")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) throw new Error("PROCUREMENT_DOMESTIC_LEAD_TIME_UPDATE_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_DOMESTIC_LEAD_TIME_UPDATE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("NO_CHANGES") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Domestic lead time update failed");
  }
}

export async function upsertDomesticLeadTimeHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const vendorId = toTrimmedString(body.vendor_id);
    const companyId = toTrimmedString(body.company_id);
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
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Domestic lead time upsert failed");
  }
}

export async function listTransportersHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const direction = toUpperTrimmedString(url.searchParams.get("direction"));
    const activeParam = url.searchParams.get("is_active");
    const search = toTrimmedString(url.searchParams.get("search"));
    let query = serviceRoleClient
      .schema("erp_master")
      .from("transporter_master")
      .select("id, transporter_code, transporter_name, usage_direction, gst_number, active")
      .order("transporter_name", { ascending: true });
    if (search) {
      query = query.ilike("transporter_name", `%${search}%`);
    }
    if (activeParam === "all") {
      // no filter
    } else if (activeParam === "false") {
      query = query.eq("active", false);
    } else {
      query = query.eq("active", true);
    }
    if (direction === "IMPORT") {
      query = query.in("usage_direction", ["IMPORT", "BOTH"]);
    } else if (direction === "DOMESTIC") {
      query = query.in("usage_direction", ["DOMESTIC", "BOTH"]);
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
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const transporterName = toTrimmedString(body.transporter_name);
    const usageDirection = toUpperTrimmedString(body.usage_direction);
    const mode = toUpperTrimmedString(body.mode || "ROAD");
    if (!transporterName || !TRANSPORTER_DIRECTIONS.has(usageDirection) || !TRANSPORTER_MODES.has(mode)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_TRANSPORTER", 400, "Invalid transporter payload");
    }
    const transporterCode = await generateCodeFromSequence("transporter_code_sequence", "TR-", 5);
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("transporter_master")
      .insert({
        transporter_code: transporterCode,
        transporter_name: transporterName,
        usage_direction: usageDirection,
        mode,
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
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("DUPLICATE") ? 409 : code.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Transporter create failed");
  }
}

export async function updateTransporterHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
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
    for (const field of ["pan_number", "gst_number", "address"] as const) {
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
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Transporter update failed");
  }
}

export async function deleteTransporterHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    const { error } = await serviceRoleClient
      .schema("erp_master")
      .from("transporter_master")
      .delete()
      .eq("id", id);
    if (error) {
      if (error.code === "23503") throw new Error("PROCUREMENT_TRANSPORTER_IN_USE");
      throw new Error("PROCUREMENT_TRANSPORTER_DELETE_FAILED");
    }
    return okResponse({ deleted: true }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_TRANSPORTER_DELETE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("IN_USE") ? 409 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Transporter delete failed");
  }
}

// Intentionally NOT gated to Manager/SA — this is a generic GST lookup
// utility meant to be reusable across masters (Transporter today, more
// later including L1_USER-level screens), so any authenticated ACL user
// can call it.
export async function getGstProfileLookupHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const gstNumber = toUpperTrimmedString(new URL(req.url).searchParams.get("gst_number"));
    if (!gstNumber) return procurementErrorResponse(req, ctx, "PROCUREMENT_GST_NUMBER_REQUIRED", 400, "gst_number required");
    const resolved = await resolveGstProfileWithSource(gstNumber);
    const fields = deriveCompanyFieldsFromGstProfile(resolved.profile);
    return okResponse({
      data: {
        gst_number: resolved.profile.gst_number,
        legal_name: resolved.profile.legal_name,
        trade_name: resolved.profile.trade_name ?? null,
        status: resolved.profile.status,
        source: resolved.source,
        fetched_at: resolved.profile.fetched_at,
        state_name: fields.state_name,
        full_address: fields.full_address,
        pin_code: fields.pin_code,
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_GST_LOOKUP_FAILED";
    const status = code === "PROCUREMENT_GST_NUMBER_REQUIRED" ? 400 : code.startsWith("APPLYFLOW_") ? 502 : 500;
    return procurementErrorResponse(req, ctx, code, status, "GST profile lookup failed");
  }
}

async function getTransporterById(id: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("transporter_master")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("PROCUREMENT_TRANSPORTER_LOOKUP_FAILED");
  return (data as Record<string, unknown> | null) ?? null;
}

export async function getTransporterContactsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const transporterId = toTrimmedString(new URL(req.url).searchParams.get("transporter_id"));
    if (!transporterId) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_REQUEST", 400, "transporter_id required");
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("transporter_contacts")
      .select("*")
      .eq("transporter_id", transporterId)
      .order("created_at", { ascending: true });
    if (error) throw new Error("PROCUREMENT_TRANSPORTER_CONTACTS_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_TRANSPORTER_CONTACTS_FAILED";
    return procurementErrorResponse(req, ctx, code, code === "MANAGER_OR_SA_REQUIRED" ? 403 : 500, "Transporter contacts fetch failed");
  }
}

export async function upsertTransporterContactsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const transporterId = toTrimmedString(body.transporter_id);
    const contacts = Array.isArray(body.contacts) ? body.contacts : [];
    if (!transporterId) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_REQUEST", 400, "transporter_id required");
    if (!(await getTransporterById(transporterId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_TRANSPORTER_NOT_FOUND", 404, "Transporter not found");
    }
    await serviceRoleClient.schema("erp_master").from("transporter_contacts").delete().eq("transporter_id", transporterId);
    if (contacts.length > 0) {
      const rows = contacts
        .filter((c: JsonRecord) => toTrimmedString(c.contact_name))
        .map((c: JsonRecord) => ({
          transporter_id: transporterId,
          contact_name: toTrimmedString(c.contact_name),
          phone: toTrimmedString(c.phone) || null,
          designation: toTrimmedString(c.designation) || null,
          is_primary: Boolean(c.is_primary),
          created_by: ctx.auth_user_id,
        }));
      if (rows.length > 0) {
        const { error } = await serviceRoleClient.schema("erp_master").from("transporter_contacts").insert(rows);
        if (error) throw new Error("PROCUREMENT_TRANSPORTER_CONTACTS_SAVE_FAILED");
      }
    }
    const { data } = await serviceRoleClient
      .schema("erp_master")
      .from("transporter_contacts")
      .select("*")
      .eq("transporter_id", transporterId)
      .order("created_at", { ascending: true });
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_TRANSPORTER_CONTACTS_SAVE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Transporter contacts save failed");
  }
}

export async function getTransporterEmailsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const transporterId = toTrimmedString(new URL(req.url).searchParams.get("transporter_id"));
    if (!transporterId) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_REQUEST", 400, "transporter_id required");
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("transporter_emails")
      .select("*")
      .eq("transporter_id", transporterId)
      .order("created_at", { ascending: true });
    if (error) throw new Error("PROCUREMENT_TRANSPORTER_EMAILS_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_TRANSPORTER_EMAILS_FAILED";
    return procurementErrorResponse(req, ctx, code, code === "MANAGER_OR_SA_REQUIRED" ? 403 : 500, "Transporter emails fetch failed");
  }
}

export async function upsertTransporterEmailsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const transporterId = toTrimmedString(body.transporter_id);
    const emails = Array.isArray(body.emails) ? body.emails : [];
    if (!transporterId) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_REQUEST", 400, "transporter_id required");
    if (!(await getTransporterById(transporterId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_TRANSPORTER_NOT_FOUND", 404, "Transporter not found");
    }
    await serviceRoleClient.schema("erp_master").from("transporter_emails").delete().eq("transporter_id", transporterId);
    if (emails.length > 0) {
      const rows = emails
        .filter((e: JsonRecord) => toTrimmedString(e.email))
        .map((e: JsonRecord) => ({
          transporter_id: transporterId,
          email: toTrimmedString(e.email),
          label: toTrimmedString(e.label) || null,
          is_primary: Boolean(e.is_primary),
          created_by: ctx.auth_user_id,
        }));
      if (rows.length > 0) {
        const { error } = await serviceRoleClient.schema("erp_master").from("transporter_emails").insert(rows);
        if (error) throw new Error("PROCUREMENT_TRANSPORTER_EMAILS_SAVE_FAILED");
      }
    }
    const { data } = await serviceRoleClient
      .schema("erp_master")
      .from("transporter_emails")
      .select("*")
      .eq("transporter_id", transporterId)
      .order("created_at", { ascending: true });
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_TRANSPORTER_EMAILS_SAVE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Transporter emails save failed");
  }
}

export async function listTransporterCompanyMapsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const transporterId = toTrimmedString(new URL(req.url).searchParams.get("transporter_id"));
    if (!transporterId) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_REQUEST", 400, "transporter_id required");
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("transporter_company_map")
      .select("*")
      .eq("transporter_id", transporterId)
      .order("created_at", { ascending: true });
    if (error) throw new Error("PROCUREMENT_TRANSPORTER_COMPANY_MAP_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_TRANSPORTER_COMPANY_MAP_FAILED";
    return procurementErrorResponse(req, ctx, code, code === "MANAGER_OR_SA_REQUIRED" ? 403 : 500, "Transporter company map fetch failed");
  }
}

export async function mapTransporterToCompanyHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const transporterId = toTrimmedString(body.transporter_id);
    const companyId = toTrimmedString(body.company_id);
    if (!(await getTransporterById(transporterId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_TRANSPORTER_NOT_FOUND", 404, "Transporter not found");
    }
    if (!(await ensureCompanyExists(companyId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_COMPANY_NOT_FOUND", 404, "Company not found");
    }
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("transporter_company_map")
      .upsert({
        transporter_id: transporterId,
        company_id: companyId,
        active: body.active !== false,
        created_by: ctx.auth_user_id,
      }, { onConflict: "transporter_id,company_id" })
      .select("*")
      .single();
    if (error || !data) throw new Error("PROCUREMENT_TRANSPORTER_COMPANY_MAP_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_TRANSPORTER_COMPANY_MAP_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Transporter company map failed");
  }
}

export async function listCHAsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const activeParam = url.searchParams.get("is_active");
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    let allowedChaIds: string[] | null = null;
    if (companyId) {
      const { data: companyMapData, error: companyMapError } = await serviceRoleClient
        .schema("erp_master")
        .from("cha_company_map")
        .select("cha_id")
        .eq("company_id", companyId)
        .eq("active", true);
      if (companyMapError) {
        throw new Error("PROCUREMENT_CHA_LIST_FAILED");
      }
      allowedChaIds = [...new Set(((companyMapData as Record<string, unknown>[] | null) ?? [])
        .map((row) => toTrimmedString(row.cha_id))
        .filter(Boolean))];
      if (allowedChaIds.length === 0) {
        return okResponse({ data: [] }, ctx.request_id, req);
      }
    }
    let query = serviceRoleClient.schema("erp_master").from("cha_master").select("*").order("cha_name", { ascending: true });
    if (activeParam === "all") { /* no filter */ }
    else if (activeParam === "false") query = query.eq("active", false);
    else query = query.eq("active", true);
    if (allowedChaIds) {
      query = query.in("id", allowedChaIds);
    }
    const { data, error } = await query;
    if (error) throw new Error("PROCUREMENT_CHA_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CHA_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "CHA list failed");
  }
}

export async function createCHAHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const chaName = toTrimmedString(body.cha_name);
    const gstNumber = toUpperTrimmedString(body.gst_number);
    if (!chaName) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_CHA", 400, "CHA name is required");
    }
    if (!gstNumber) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CHA_GST_REQUIRED", 400, "GST number is required for a CHA");
    }
    const licenseNumber = toTrimmedString(body.cha_license_number) || "";
    const chaCode = await generateCodeFromSequence("cha_code_sequence", "CHA-", 4);
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("cha_master")
      .insert({
        cha_code: chaCode,
        cha_name: chaName,
        cha_license_number: licenseNumber,
        gst_number: gstNumber,
        pan_number: toTrimmedString(body.pan_number) || null,
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
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("DUPLICATE") ? 409 : code.includes("INVALID") || code.includes("REQUIRED") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CHA create failed");
  }
}

export async function mapCHAToPortHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
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
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("REQUIRED") ? 400 : code.includes("DUPLICATE") ? 409 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CHA port mapping failed");
  }
}

export async function updateCHAHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const chaId = getIdFromPath(req);
    if (!(await ensureChaExists(chaId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CHA_NOT_FOUND", 404, "CHA not found");
    }
    const body = await parseBody(req);
    const updates: Record<string, unknown> = {};
    if (body.cha_name !== undefined) {
      const v = toTrimmedString(body.cha_name);
      if (!v) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_CHA", 400, "CHA name cannot be empty");
      updates.cha_name = v;
    }
    if (body.cha_license_number !== undefined) updates.cha_license_number = toTrimmedString(body.cha_license_number) || "";
    if (body.gst_number !== undefined) {
      const v = toUpperTrimmedString(body.gst_number);
      if (!v) return procurementErrorResponse(req, ctx, "PROCUREMENT_CHA_GST_REQUIRED", 400, "GST number cannot be empty");
      updates.gst_number = v;
    }
    if (body.pan_number !== undefined) updates.pan_number = toTrimmedString(body.pan_number) || null;
    if (body.address !== undefined) updates.address = toTrimmedString(body.address) || null;
    if (body.active !== undefined) updates.active = body.active === true;
    if (Object.keys(updates).length === 0) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_CHA", 400, "No fields to update");
    const { data, error } = await serviceRoleClient
      .schema("erp_master").from("cha_master").update(updates).eq("id", chaId).select("*").single();
    if (error) throw new Error("PROCUREMENT_CHA_UPDATE_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CHA_UPDATE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code === "PROCUREMENT_CHA_NOT_FOUND" ? 404 : code.includes("INVALID") || code.includes("REQUIRED") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CHA update failed");
  }
}

export async function toggleCHAHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const chaId = toTrimmedString(body.id);
    const active = Boolean(body.active);
    if (!chaId) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_CHA", 400, "CHA id required");
    if (!(await ensureChaExists(chaId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CHA_NOT_FOUND", 404, "CHA not found");
    }
    const { data, error } = await serviceRoleClient
      .schema("erp_master").from("cha_master").update({ active }).eq("id", chaId).select("*").single();
    if (error) throw new Error("PROCUREMENT_CHA_TOGGLE_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CHA_TOGGLE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code === "PROCUREMENT_CHA_NOT_FOUND" ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CHA toggle failed");
  }
}

export async function deleteCHAHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const chaId = getIdFromPath(req);
    if (!(await ensureChaExists(chaId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CHA_NOT_FOUND", 404, "CHA not found");
    }
    // Cascade: remove port mappings first
    await serviceRoleClient.schema("erp_master").from("cha_port_map").delete().eq("cha_id", chaId);
    const { error } = await serviceRoleClient.schema("erp_master").from("cha_master").delete().eq("id", chaId);
    if (error) throw new Error("PROCUREMENT_CHA_DELETE_FAILED");
    return okResponse({ data: { id: chaId } }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CHA_DELETE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code === "PROCUREMENT_CHA_NOT_FOUND" ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CHA delete failed");
  }
}

export async function getChaContactsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const chaId = toTrimmedString(new URL(req.url).searchParams.get("cha_id"));
    if (!chaId) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_REQUEST", 400, "cha_id required");
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("cha_contacts")
      .select("*")
      .eq("cha_id", chaId)
      .order("created_at", { ascending: true });
    if (error) throw new Error("PROCUREMENT_CHA_CONTACTS_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CHA_CONTACTS_FAILED";
    return procurementErrorResponse(req, ctx, code, code === "MANAGER_OR_SA_REQUIRED" ? 403 : 500, "CHA contacts fetch failed");
  }
}

export async function upsertChaContactsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const chaId = toTrimmedString(body.cha_id);
    const contacts = Array.isArray(body.contacts) ? body.contacts : [];
    if (!chaId) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_REQUEST", 400, "cha_id required");
    if (!(await ensureChaExists(chaId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CHA_NOT_FOUND", 404, "CHA not found");
    }
    await serviceRoleClient.schema("erp_master").from("cha_contacts").delete().eq("cha_id", chaId);
    if (contacts.length > 0) {
      const rows = contacts
        .filter((c: JsonRecord) => toTrimmedString(c.contact_name))
        .map((c: JsonRecord) => ({
          cha_id: chaId,
          contact_name: toTrimmedString(c.contact_name),
          phone: toTrimmedString(c.phone) || null,
          designation: toTrimmedString(c.designation) || null,
          is_primary: Boolean(c.is_primary),
          created_by: ctx.auth_user_id,
        }));
      if (rows.length > 0) {
        const { error } = await serviceRoleClient.schema("erp_master").from("cha_contacts").insert(rows);
        if (error) throw new Error("PROCUREMENT_CHA_CONTACTS_SAVE_FAILED");
      }
    }
    const { data } = await serviceRoleClient
      .schema("erp_master")
      .from("cha_contacts")
      .select("*")
      .eq("cha_id", chaId)
      .order("created_at", { ascending: true });
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CHA_CONTACTS_SAVE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CHA contacts save failed");
  }
}

export async function getChaEmailsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const chaId = toTrimmedString(new URL(req.url).searchParams.get("cha_id"));
    if (!chaId) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_REQUEST", 400, "cha_id required");
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("cha_emails")
      .select("*")
      .eq("cha_id", chaId)
      .order("created_at", { ascending: true });
    if (error) throw new Error("PROCUREMENT_CHA_EMAILS_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CHA_EMAILS_FAILED";
    return procurementErrorResponse(req, ctx, code, code === "MANAGER_OR_SA_REQUIRED" ? 403 : 500, "CHA emails fetch failed");
  }
}

export async function upsertChaEmailsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const chaId = toTrimmedString(body.cha_id);
    const emails = Array.isArray(body.emails) ? body.emails : [];
    if (!chaId) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_REQUEST", 400, "cha_id required");
    if (!(await ensureChaExists(chaId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CHA_NOT_FOUND", 404, "CHA not found");
    }
    await serviceRoleClient.schema("erp_master").from("cha_emails").delete().eq("cha_id", chaId);
    if (emails.length > 0) {
      const rows = emails
        .filter((e: JsonRecord) => toTrimmedString(e.email))
        .map((e: JsonRecord) => ({
          cha_id: chaId,
          email: toTrimmedString(e.email),
          label: toTrimmedString(e.label) || null,
          is_primary: Boolean(e.is_primary),
          created_by: ctx.auth_user_id,
        }));
      if (rows.length > 0) {
        const { error } = await serviceRoleClient.schema("erp_master").from("cha_emails").insert(rows);
        if (error) throw new Error("PROCUREMENT_CHA_EMAILS_SAVE_FAILED");
      }
    }
    const { data } = await serviceRoleClient
      .schema("erp_master")
      .from("cha_emails")
      .select("*")
      .eq("cha_id", chaId)
      .order("created_at", { ascending: true });
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CHA_EMAILS_SAVE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CHA emails save failed");
  }
}

export async function listChaCompanyMapsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const chaId = toTrimmedString(new URL(req.url).searchParams.get("cha_id"));
    if (!chaId) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_REQUEST", 400, "cha_id required");
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("cha_company_map")
      .select("*")
      .eq("cha_id", chaId)
      .order("created_at", { ascending: true });
    if (error) throw new Error("PROCUREMENT_CHA_COMPANY_MAP_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CHA_COMPANY_MAP_FAILED";
    return procurementErrorResponse(req, ctx, code, code === "MANAGER_OR_SA_REQUIRED" ? 403 : 500, "CHA company map fetch failed");
  }
}

export async function mapChaToCompanyHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const chaId = toTrimmedString(body.cha_id);
    const companyId = toTrimmedString(body.company_id);
    if (!(await ensureChaExists(chaId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CHA_NOT_FOUND", 404, "CHA not found");
    }
    if (!(await ensureCompanyExists(companyId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_COMPANY_NOT_FOUND", 404, "Company not found");
    }
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("cha_company_map")
      .upsert({
        cha_id: chaId,
        company_id: companyId,
        active: body.active !== false,
        created_by: ctx.auth_user_id,
      }, { onConflict: "cha_id,company_id" })
      .select("*")
      .single();
    if (error || !data) throw new Error("PROCUREMENT_CHA_COMPANY_MAP_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CHA_COMPANY_MAP_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CHA company map failed");
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
      .select("id, cha_id, port_id, created_at, port_master(port_code, port_name, port_type, country)")
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

export async function unmapCHAPortHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const parts = new URL(req.url).pathname.split("/");
    const chaId = parts[4];
    const portId = parts[6];
    if (!chaId || !portId) return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_CHA", 400, "CHA id and port id required");
    const { error } = await serviceRoleClient
      .schema("erp_master").from("cha_port_map").delete().eq("cha_id", chaId).eq("port_id", portId);
    if (error) throw new Error("PROCUREMENT_CHA_PORT_UNMAP_FAILED");
    return okResponse({ data: { cha_id: chaId, port_id: portId } }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CHA_PORT_UNMAP_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CHA port unmap failed");
  }
}
