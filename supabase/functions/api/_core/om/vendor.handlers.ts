/*
 * File-ID: 14.3
 * File-Path: supabase/functions/api/_core/om/vendor.handlers.ts
 * Gate: 14
 * Phase: 14
 * Domain: MASTER
 * Purpose: Implement vendor master, company mapping, and append-only payment terms handlers.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { OmHandlerContext } from "./shared.ts";
import { assertOmAdminContext } from "./shared.ts";

type JsonRecord = Record<string, unknown>;

const ALLOWED_VENDOR_TYPES = new Set(["DOMESTIC", "IMPORT"]);
const VENDOR_STATUSES = new Set(["DRAFT", "PENDING_APPROVAL", "ACTIVE", "INACTIVE", "BLOCKED"]);
const MUTABLE_VENDOR_STATUSES = new Set(["DRAFT", "PENDING_APPROVAL"]);
const VENDOR_TRANSITIONS = new Map<string, Set<string>>([
  ["DRAFT", new Set(["PENDING_APPROVAL"])],
  ["PENDING_APPROVAL", new Set(["ACTIVE", "DRAFT"])],
  ["ACTIVE", new Set(["INACTIVE", "BLOCKED"])],
  ["INACTIVE", new Set(["ACTIVE"])],
  ["BLOCKED", new Set(["ACTIVE"])],
]);

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

function normalizeSearch(value: string): string {
  return value.replace(/[%_]/g, "").trim();
}

function vendorErrorResponse(
  req: Request,
  ctx: OmHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
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

async function getVendorById(id: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("vendor_master")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error("OM_VENDOR_LOOKUP_FAILED");
  }

  return (data as Record<string, unknown> | null) ?? null;
}

function normalizeCcEmailList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  return [];
}

export async function createVendorHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const body = await parseBody(req);
    const vendorName = toTrimmedString(body.vendor_name);
    const vendorType = toTrimmedString(body.vendor_type).toUpperCase();

    if (!vendorName || !ALLOWED_VENDOR_TYPES.has(vendorType)) {
      return vendorErrorResponse(req, ctx, "OM_INVALID_VENDOR_TYPE", 400, "Invalid vendor type");
    }

    const { data: vendorCode, error: codeError } = await serviceRoleClient.rpc("generate_vendor_code");
    if (codeError || !vendorCode) {
      throw new Error("OM_VENDOR_CREATE_FAILED");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_master")
      .insert({
        vendor_code: String(vendorCode),
        vendor_name: vendorName,
        vendor_type: vendorType,
        bin_number: toTrimmedString(body.bin_number) || null,
        tin_number: toTrimmedString(body.tin_number) || null,
        trade_license: toTrimmedString(body.trade_license) || null,
        gst_number: toTrimmedString(body.gst_number) || null,
        gst_category: toTrimmedString(body.gst_category) || null,
        iec_code: toTrimmedString(body.iec_code) || null,
        import_license: toTrimmedString(body.import_license) || null,
        registered_address: toTrimmedString(body.registered_address) || null,
        correspondence_address: toTrimmedString(body.correspondence_address) || null,
        primary_contact_person: toTrimmedString(body.primary_contact_person) || null,
        phone: toTrimmedString(body.phone) || null,
        primary_email: toTrimmedString(body.primary_email) || null,
        cc_email_list: normalizeCcEmailList(body.cc_email_list),
        bank_name: toTrimmedString(body.bank_name) || null,
        bank_branch: toTrimmedString(body.bank_branch) || null,
        bank_account_number: toTrimmedString(body.bank_account_number) || null,
        bank_routing_number: toTrimmedString(body.bank_routing_number) || null,
        currency_code: toTrimmedString(body.currency_code).toUpperCase() || "BDT",
        status: "DRAFT",
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_VENDOR_CREATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_CREATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("INVALID") ? 400 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor create failed");
  }
}

export async function listVendorsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const url = new URL(req.url);
    const vendorType = toTrimmedString(url.searchParams.get("vendor_type")).toUpperCase();
    const statusFilter = toTrimmedString(url.searchParams.get("status")).toUpperCase();
    const search = normalizeSearch(toTrimmedString(url.searchParams.get("search")));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);
    const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);

    let query = serviceRoleClient
      .schema("erp_master")
      .from("vendor_master")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (vendorType) {
      query = query.eq("vendor_type", vendorType);
    }
    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }
    if (search) {
      query = query.or(`vendor_code.ilike.%${search}%,vendor_name.ilike.%${search}%`);
    }

    const { data, error, count } = await query;
    if (error) {
      throw new Error("OM_VENDOR_LIST_FAILED");
    }

    return okResponse({ data: data ?? [], total: count ?? 0 }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_LIST_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor list failed");
  }
}

export async function getVendorHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const id = toTrimmedString(new URL(req.url).searchParams.get("id"));
    if (!id) {
      return vendorErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");
    }

    const vendor = await getVendorById(id);
    if (!vendor) {
      return vendorErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");
    }

    const { data: latestPaymentTerms, error: termsError } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_payment_terms_log")
      .select("*")
      .eq("vendor_id", id)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (termsError) {
      throw new Error("OM_VENDOR_LOOKUP_FAILED");
    }

    return okResponse({ data: { ...vendor, latest_payment_terms: latestPaymentTerms ?? null } }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_LOOKUP_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor lookup failed");
  }
}

export async function updateVendorHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    if (!id) {
      return vendorErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");
    }

    const existing = await getVendorById(id);
    if (!existing) {
      return vendorErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");
    }

    const currentStatus = String(existing.status ?? "");
    if (!MUTABLE_VENDOR_STATUSES.has(currentStatus)) {
      return vendorErrorResponse(req, ctx, "OM_VENDOR_LOCKED", 422, "Vendor is locked");
    }

    const updates: JsonRecord = {
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    };

    const mutableFields = [
      "vendor_name",
      "bin_number",
      "tin_number",
      "trade_license",
      "gst_number",
      "gst_category",
      "iec_code",
      "import_license",
      "registered_address",
      "correspondence_address",
      "primary_contact_person",
      "phone",
      "primary_email",
      "bank_name",
      "bank_branch",
      "bank_account_number",
      "bank_routing_number",
      "currency_code",
    ];

    for (const field of mutableFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (body.cc_email_list !== undefined) {
      updates.cc_email_list = normalizeCcEmailList(body.cc_email_list);
    }

    if (Object.keys(updates).length === 2) {
      return vendorErrorResponse(req, ctx, "OM_VENDOR_NO_CHANGES", 400, "No changes provided");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_master")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_VENDOR_UPDATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_UPDATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("LOCKED") ? 422 : code.includes("NO_CHANGES") ? 400 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor update failed");
  }
}

export async function changeVendorStatusHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    const newStatus = toTrimmedString(body.new_status).toUpperCase();

    if (!id) {
      return vendorErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");
    }
    if (!VENDOR_STATUSES.has(newStatus)) {
      return vendorErrorResponse(req, ctx, "OM_INVALID_STATUS_TRANSITION", 422, "Status transition not allowed");
    }

    const existing = await getVendorById(id);
    if (!existing) {
      return vendorErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");
    }

    const currentStatus = String(existing.status ?? "");
    const allowed = VENDOR_TRANSITIONS.get(currentStatus);
    if (!allowed?.has(newStatus)) {
      return vendorErrorResponse(req, ctx, "OM_INVALID_STATUS_TRANSITION", 422, "Status transition not allowed");
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
      .from("vendor_master")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_VENDOR_STATUS_UPDATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_STATUS_UPDATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("TRANSITION") ? 422 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor status update failed");
  }
}

export async function mapVendorToCompanyHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const body = await parseBody(req);
    const vendorId = toTrimmedString(body.vendor_id);
    const companyId = toTrimmedString(body.company_id);

    if (!(await getVendorById(vendorId))) {
      return vendorErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");
    }
    if (!(await ensureCompanyExists(companyId))) {
      return vendorErrorResponse(req, ctx, "OM_COMPANY_NOT_FOUND", 404, "Company not found");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_company_map")
      .upsert({
        vendor_id: vendorId,
        company_id: companyId,
        active: body.active !== false,
        created_by: ctx.auth_user_id,
      }, { onConflict: "vendor_id,company_id" })
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_VENDOR_COMPANY_MAP_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_COMPANY_MAP_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor company map failed");
  }
}

export async function addVendorPaymentTermsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const body = await parseBody(req);
    const vendorId = toTrimmedString(body.vendor_id);
    const companyId = toTrimmedString(body.company_id);
    const paymentDays = Number(body.payment_days ?? body.payment_terms_days);

    if (!(await getVendorById(vendorId))) {
      return vendorErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");
    }
    if (!(await ensureCompanyExists(companyId))) {
      return vendorErrorResponse(req, ctx, "OM_COMPANY_NOT_FOUND", 404, "Company not found");
    }
    if (!Number.isFinite(paymentDays) || paymentDays < 0) {
      return vendorErrorResponse(req, ctx, "OM_INVALID_PAYMENT_TERMS", 400, "Invalid payment terms");
    }

    const notesParts = [
      toTrimmedString(body.notes),
      body.discount_days != null ? `discount_days=${body.discount_days}` : "",
      body.discount_percent != null ? `discount_percent=${body.discount_percent}` : "",
    ].filter(Boolean);

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_payment_terms_log")
      .insert({
        vendor_id: vendorId,
        company_id: companyId,
        payment_terms_days: paymentDays,
        payment_method: toTrimmedString(body.payment_method) || null,
        terms_notes: notesParts.length > 0 ? notesParts.join("; ") : null,
        reference_po_id: toTrimmedString(body.reference_po_id) || null,
        recorded_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_PAYMENT_TERMS_CREATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_PAYMENT_TERMS_CREATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("INVALID") ? 400 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor payment terms create failed");
  }
}

export async function getVendorPaymentTermsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const url = new URL(req.url);
    const vendorId = toTrimmedString(url.searchParams.get("vendor_id"));
    const companyId = toTrimmedString(url.searchParams.get("company_id"));

    let query = serviceRoleClient
      .schema("erp_master")
      .from("vendor_payment_terms_log")
      .select("*")
      .order("recorded_at", { ascending: false })
      .limit(10);

    if (vendorId) {
      query = query.eq("vendor_id", vendorId);
    }
    if (companyId) {
      query = query.eq("company_id", companyId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error("OM_PAYMENT_TERMS_LOOKUP_FAILED");
    }

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_PAYMENT_TERMS_LOOKUP_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor payment terms lookup failed");
  }
}
