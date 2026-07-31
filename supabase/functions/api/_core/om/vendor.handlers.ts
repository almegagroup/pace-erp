/*
 * File-ID: 14.3
 * File-Path: supabase/functions/api/_core/om/vendor.handlers.ts
 * Gate: 14 (revised)
 * Phase: 14
 * Domain: MASTER
 * Purpose: Vendor master, contacts, emails, company mapping, and payment terms handlers.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { OmHandlerContext } from "./shared.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { INDIAN_STATE_NAMES } from "../../_shared/indianStates.ts";

type JsonRecord = Record<string, unknown>;

const ALLOWED_VENDOR_TYPES = new Set(["DOMESTIC", "IMPORT"]);
const VENDOR_STATUSES = new Set(["DRAFT", "PENDING_APPROVAL", "ACTIVE", "INACTIVE", "BLOCKED"]);
const VENDOR_TRANSITIONS = new Map<string, Set<string>>([
  ["DRAFT", new Set(["PENDING_APPROVAL", "ACTIVE", "INACTIVE"])],
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
  if (error) throw new Error("OM_VENDOR_LOOKUP_FAILED");
  return (data as Record<string, unknown> | null) ?? null;
}

/* ── Create ─────────────────────────────────────────────────────────────── */

export async function createVendorHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

    const body = await parseBody(req);
    const vendorName = toTrimmedString(body.vendor_name);
    const vendorType = toTrimmedString(body.vendor_type).toUpperCase();

    if (!vendorName) {
      return vendorErrorResponse(req, ctx, "OM_INVALID_VENDOR_NAME", 400, "Vendor name is required");
    }
    if (!ALLOWED_VENDOR_TYPES.has(vendorType)) {
      return vendorErrorResponse(req, ctx, "OM_INVALID_VENDOR_TYPE", 400, "Invalid vendor type");
    }
    // DOMESTIC-only: the frontend dropdown only offers Indian states (Import
    // vendors keep free text for their own country's state/province) --
    // enforced here too so a direct API call can't slip in a typo that
    // would silently break GST place-of-supply string matching.
    if (vendorType === "DOMESTIC") {
      const regState = toTrimmedString(body.reg_address_state);
      const corrState = toTrimmedString(body.corr_address_state);
      if (regState && !INDIAN_STATE_NAMES.has(regState)) {
        return vendorErrorResponse(req, ctx, "OM_INVALID_REG_ADDRESS_STATE", 400, "Invalid registered address state");
      }
      if (corrState && !INDIAN_STATE_NAMES.has(corrState)) {
        return vendorErrorResponse(req, ctx, "OM_INVALID_CORR_ADDRESS_STATE", 400, "Invalid correspondence address state");
      }
    }

    const { data: vendorCode, error: codeError } = await serviceRoleClient.rpc("generate_vendor_code");
    if (codeError || !vendorCode) {
      console.error("[vendor.create] generate_vendor_code RPC failed:", JSON.stringify(codeError));
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
        country_code: toTrimmedString(body.country_code) || null,
        currency_code: toTrimmedString(body.currency_code).toUpperCase() || "BDT",
        reg_address_line1:  toTrimmedString(body.reg_address_line1)  || null,
        reg_address_city:   toTrimmedString(body.reg_address_city)   || null,
        reg_address_state:  toTrimmedString(body.reg_address_state)  || null,
        reg_address_pin:    toTrimmedString(body.reg_address_pin)    || null,
        corr_address_line1: toTrimmedString(body.corr_address_line1) || null,
        corr_address_city:  toTrimmedString(body.corr_address_city)  || null,
        corr_address_state: toTrimmedString(body.corr_address_state) || null,
        corr_address_pin:   toTrimmedString(body.corr_address_pin)   || null,
        msme_registered: typeof body.msme_registered === "boolean" ? body.msme_registered : null,
        msme_certificate_number: toTrimmedString(body.msme_certificate_number) || null,
        status: "ACTIVE",
        approved_by: ctx.auth_user_id,
        approved_at: new Date().toISOString(),
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error || !data) {
      console.error("[vendor.create] INSERT failed:", JSON.stringify(error));
      throw new Error("OM_VENDOR_CREATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_CREATE_FAILED";
    console.error("[vendor.create] caught error:", code, (err as Error).stack ?? "");
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("INVALID") ? 400 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor create failed");
  }
}

/* ── List ────────────────────────────────────────────────────────────────── */

export async function listVendorsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

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

    if (vendorType) query = query.eq("vendor_type", vendorType);
    if (statusFilter) query = query.eq("status", statusFilter);
    if (search) query = query.or(`vendor_code.ilike.%${search}%,vendor_name.ilike.%${search}%`);

    const { data, error, count } = await query;
    if (error) throw new Error("OM_VENDOR_LIST_FAILED");

    return okResponse({ data: data ?? [], total: count ?? 0 }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_LIST_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor list failed");
  }
}

/* ── Get (with contacts + emails) ──────────────────────────────────────── */

export async function getVendorHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

    const id = toTrimmedString(new URL(req.url).searchParams.get("id"));
    if (!id) return vendorErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");

    const vendor = await getVendorById(id);
    if (!vendor) return vendorErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");

    const [{ data: contacts }, { data: emails }, { data: banks }, { data: latestPaymentTerms }] = await Promise.all([
      serviceRoleClient.schema("erp_master").from("vendor_contacts")
        .select("*").eq("vendor_id", id).order("created_at", { ascending: true }),
      serviceRoleClient.schema("erp_master").from("vendor_emails")
        .select("*").eq("vendor_id", id).order("created_at", { ascending: true }),
      serviceRoleClient.schema("erp_master").from("vendor_banks")
        .select("*").eq("vendor_id", id).order("created_at", { ascending: true }),
      serviceRoleClient.schema("erp_master").from("vendor_payment_terms_log")
        .select("*").eq("vendor_id", id).order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    return okResponse({
      data: {
        ...vendor,
        contacts: contacts ?? [],
        emails: emails ?? [],
        banks: banks ?? [],
        latest_payment_terms: latestPaymentTerms ?? null,
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_LOOKUP_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor lookup failed");
  }
}

/* ── Update ──────────────────────────────────────────────────────────────── */

export async function updateVendorHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    if (!id) return vendorErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");

    const existing = await getVendorById(id);
    if (!existing) return vendorErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");

    const updates: JsonRecord = {
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    };

    const mutableFields = [
      "vendor_name", "bin_number", "tin_number", "trade_license",
      "gst_number", "gst_category", "iec_code", "import_license",
      "country_code", "currency_code",
      "reg_address_line1", "reg_address_city", "reg_address_state", "reg_address_pin",
      "corr_address_line1", "corr_address_city", "corr_address_state", "corr_address_pin",
      "msme_certificate_number",
    ];

    for (const field of mutableFields) {
      if (body[field] !== undefined) {
        updates[field] = toTrimmedString(body[field]) || null;
      }
    }

    // Same DOMESTIC-only allowlist as create -- vendor_type itself isn't
    // editable here, so the existing row's own type is authoritative.
    if (toTrimmedString(existing.vendor_type).toUpperCase() === "DOMESTIC") {
      const regState = updates.reg_address_state as string | null | undefined;
      const corrState = updates.corr_address_state as string | null | undefined;
      if (regState && !INDIAN_STATE_NAMES.has(regState)) {
        return vendorErrorResponse(req, ctx, "OM_INVALID_REG_ADDRESS_STATE", 400, "Invalid registered address state");
      }
      if (corrState && !INDIAN_STATE_NAMES.has(corrState)) {
        return vendorErrorResponse(req, ctx, "OM_INVALID_CORR_ADDRESS_STATE", 400, "Invalid correspondence address state");
      }
    }

    // Optional, non-mandatory — can be filled in any time after creation.
    if (typeof body.msme_registered === "boolean") {
      updates.msme_registered = body.msme_registered;
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

    if (error || !data) throw new Error("OM_VENDOR_UPDATE_FAILED");

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_UPDATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("NO_CHANGES") ? 400 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor update failed");
  }
}

/* ── Status Change ───────────────────────────────────────────────────────── */

export async function changeVendorStatusHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    const newStatus = toTrimmedString(body.new_status).toUpperCase();

    if (!id) return vendorErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");
    if (!VENDOR_STATUSES.has(newStatus)) {
      return vendorErrorResponse(req, ctx, "OM_INVALID_STATUS_TRANSITION", 422, "Invalid status");
    }

    const existing = await getVendorById(id);
    if (!existing) return vendorErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");

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

    if (error || !data) throw new Error("OM_VENDOR_STATUS_UPDATE_FAILED");

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_STATUS_UPDATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("TRANSITION") ? 422 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor status update failed");
  }
}

/* ── Delete (bulk) ───────────────────────────────────────────────────────── */

export async function deleteVendorsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

    const body = await parseBody(req);
    const ids: string[] = Array.isArray(body.ids)
      ? body.ids.map(String).filter(Boolean)
      : [];

    if (ids.length === 0) {
      return vendorErrorResponse(req, ctx, "OM_INVALID_REQUEST", 400, "ids array required");
    }

    const outcomes = await Promise.all(ids.map(async (id) => {
      const { error } = await serviceRoleClient
        .schema("erp_master")
        .from("vendor_master")
        .delete()
        .eq("id", id);

      if (error) {
        const code = error.code === "23503" ? "OM_VENDOR_HAS_DEPENDENCIES" : "OM_VENDOR_DELETE_FAILED";
        return { id, deleted: false, error: code };
      }

      return { id, deleted: true };
    }));

    const deleted = outcomes.filter((outcome) => outcome.deleted).map((outcome) => outcome.id);
    const errors = outcomes.filter((outcome) => !outcome.deleted).map((outcome) => ({ id: outcome.id, error: outcome.error! }));

    return okResponse({ deleted, errors }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_DELETE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor delete failed");
  }
}

/* ── Contacts — Get ──────────────────────────────────────────────────────── */

export async function getVendorContactsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    const vendorId = toTrimmedString(new URL(req.url).searchParams.get("vendor_id"));
    if (!vendorId) return vendorErrorResponse(req, ctx, "OM_INVALID_REQUEST", 400, "vendor_id required");

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_contacts")
      .select("*")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: true });

    if (error) throw new Error("OM_VENDOR_CONTACTS_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_CONTACTS_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor contacts fetch failed");
  }
}

/* ── Contacts — Upsert (replace all) ────────────────────────────────────── */

export async function upsertVendorContactsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

    const body = await parseBody(req);
    const vendorId = toTrimmedString(body.vendor_id);
    const contacts = Array.isArray(body.contacts) ? body.contacts : [];

    if (!vendorId) return vendorErrorResponse(req, ctx, "OM_INVALID_REQUEST", 400, "vendor_id required");
    if (!(await getVendorById(vendorId))) {
      return vendorErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");
    }

    await serviceRoleClient.schema("erp_master").from("vendor_contacts").delete().eq("vendor_id", vendorId);

    if (contacts.length > 0) {
      const rows = contacts
        .filter((c: JsonRecord) => toTrimmedString(c.contact_name))
        .map((c: JsonRecord) => ({
          vendor_id: vendorId,
          contact_name: toTrimmedString(c.contact_name),
          phone: toTrimmedString(c.phone) || null,
          designation: toTrimmedString(c.designation) || null,
          is_primary: Boolean(c.is_primary),
          created_by: ctx.auth_user_id,
        }));

      if (rows.length > 0) {
        const { error } = await serviceRoleClient.schema("erp_master").from("vendor_contacts").insert(rows);
        if (error) throw new Error("OM_VENDOR_CONTACTS_SAVE_FAILED");
      }
    }

    const { data } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_contacts")
      .select("*")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: true });

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_CONTACTS_SAVE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor contacts save failed");
  }
}

/* ── Emails — Get ────────────────────────────────────────────────────────── */

export async function getVendorEmailsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    const vendorId = toTrimmedString(new URL(req.url).searchParams.get("vendor_id"));
    if (!vendorId) return vendorErrorResponse(req, ctx, "OM_INVALID_REQUEST", 400, "vendor_id required");

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_emails")
      .select("*")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: true });

    if (error) throw new Error("OM_VENDOR_EMAILS_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_EMAILS_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor emails fetch failed");
  }
}

/* ── Emails — Upsert (replace all) ──────────────────────────────────────── */

export async function upsertVendorEmailsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

    const body = await parseBody(req);
    const vendorId = toTrimmedString(body.vendor_id);
    const emails = Array.isArray(body.emails) ? body.emails : [];

    if (!vendorId) return vendorErrorResponse(req, ctx, "OM_INVALID_REQUEST", 400, "vendor_id required");
    if (!(await getVendorById(vendorId))) {
      return vendorErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");
    }

    await serviceRoleClient.schema("erp_master").from("vendor_emails").delete().eq("vendor_id", vendorId);

    if (emails.length > 0) {
      const rows = emails
        .filter((e: JsonRecord) => toTrimmedString(e.email))
        .map((e: JsonRecord) => ({
          vendor_id: vendorId,
          email: toTrimmedString(e.email),
          label: toTrimmedString(e.label) || null,
          is_primary: Boolean(e.is_primary),
          created_by: ctx.auth_user_id,
        }));

      if (rows.length > 0) {
        const { error } = await serviceRoleClient.schema("erp_master").from("vendor_emails").insert(rows);
        if (error) throw new Error("OM_VENDOR_EMAILS_SAVE_FAILED");
      }
    }

    const { data } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_emails")
      .select("*")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: true });

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_EMAILS_SAVE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor emails save failed");
  }
}

/* ── Company Mapping — List ──────────────────────────────────────────────── */

export async function listVendorCompanyMappingHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const search = normalizeSearch(toTrimmedString(url.searchParams.get("search")));
    const vendorType = toTrimmedString(url.searchParams.get("vendor_type")).toUpperCase();

    if (!companyId) {
      return vendorErrorResponse(req, ctx, "OM_INVALID_REQUEST", 400, "company_id required");
    }

    let query = serviceRoleClient
      .schema("erp_master")
      .from("vendor_master")
      .select("id, vendor_code, vendor_name, vendor_type, status");

    if (vendorType) query = query.eq("vendor_type", vendorType);
    if (search) query = query.or(`vendor_code.ilike.%${search}%,vendor_name.ilike.%${search}%`);

    const { data: allVendors, error: vendorErr } = await query.order("vendor_name");
    if (vendorErr) throw new Error("OM_VENDOR_LIST_FAILED");

    const { data: mappings, error: mapErr } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_company_map")
      .select("vendor_id")
      .eq("company_id", companyId)
      .eq("active", true);

    if (mapErr) throw new Error("OM_VENDOR_LIST_FAILED");

    const mappedIds = new Set((mappings ?? []).map((m: JsonRecord) => String(m.vendor_id)));
    const result = (allVendors ?? []).map((v: JsonRecord) => ({
      ...v,
      is_mapped: mappedIds.has(String(v.id)),
    }));

    return okResponse({ data: result }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_MAPPING_LIST_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor mapping list failed");
  }
}

/* ── Company Mapping — Bulk Map ──────────────────────────────────────────── */

export async function bulkMapVendorsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const vendorIds: string[] = Array.isArray(body.vendor_ids)
      ? body.vendor_ids.map(String).filter(Boolean)
      : [];

    if (!companyId || vendorIds.length === 0) {
      return vendorErrorResponse(req, ctx, "OM_INVALID_REQUEST", 400, "company_id and vendor_ids required");
    }
    if (!(await ensureCompanyExists(companyId))) {
      return vendorErrorResponse(req, ctx, "OM_COMPANY_NOT_FOUND", 404, "Company not found");
    }

    const rows = vendorIds.map((vendorId) => ({
      vendor_id: vendorId,
      company_id: companyId,
      active: true,
      created_by: ctx.auth_user_id,
    }));

    const { error } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_company_map")
      .upsert(rows, { onConflict: "vendor_id,company_id" });

    if (error) throw new Error("OM_VENDOR_COMPANY_MAP_FAILED");

    return okResponse({ mapped: vendorIds.length }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_COMPANY_MAP_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor bulk map failed");
  }
}

/* ── Company Mapping — Bulk Unmap ────────────────────────────────────────── */

export async function bulkUnmapVendorsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const vendorIds: string[] = Array.isArray(body.vendor_ids)
      ? body.vendor_ids.map(String).filter(Boolean)
      : [];

    if (!companyId || vendorIds.length === 0) {
      return vendorErrorResponse(req, ctx, "OM_INVALID_REQUEST", 400, "company_id and vendor_ids required");
    }

    const { error } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_company_map")
      .update({ active: false })
      .eq("company_id", companyId)
      .in("vendor_id", vendorIds);

    if (error) throw new Error("OM_VENDOR_COMPANY_UNMAP_FAILED");

    return okResponse({ unmapped: vendorIds.length }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_COMPANY_UNMAP_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor bulk unmap failed");
  }
}

/* ── Banks — Get ─────────────────────────────────────────────────────────── */

export async function getVendorBanksHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    const vendorId = toTrimmedString(new URL(req.url).searchParams.get("vendor_id"));
    if (!vendorId) return vendorErrorResponse(req, ctx, "OM_INVALID_REQUEST", 400, "vendor_id required");

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_banks")
      .select("*")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: true });

    if (error) throw new Error("OM_VENDOR_BANKS_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_BANKS_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor banks fetch failed");
  }
}

/* ── Banks — Upsert (replace all) ───────────────────────────────────────── */

export async function upsertVendorBanksHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

    const body = await parseBody(req);
    const vendorId = toTrimmedString(body.vendor_id);
    const banks = Array.isArray(body.banks) ? body.banks : [];

    if (!vendorId) return vendorErrorResponse(req, ctx, "OM_INVALID_REQUEST", 400, "vendor_id required");
    if (!(await getVendorById(vendorId))) {
      return vendorErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");
    }

    await serviceRoleClient.schema("erp_master").from("vendor_banks").delete().eq("vendor_id", vendorId);

    if (banks.length > 0) {
      const rows = banks
        .filter((b: JsonRecord) => toTrimmedString(b.bank_name))
        .map((b: JsonRecord) => ({
          vendor_id: vendorId,
          bank_name: toTrimmedString(b.bank_name),
          bank_branch: toTrimmedString(b.bank_branch) || null,
          bank_account_number: toTrimmedString(b.bank_account_number) || null,
          bank_routing_number: toTrimmedString(b.bank_routing_number) || null,
          is_primary: Boolean(b.is_primary),
          is_active: b.is_active !== false,
          created_by: ctx.auth_user_id,
        }));

      if (rows.length > 0) {
        const { error } = await serviceRoleClient.schema("erp_master").from("vendor_banks").insert(rows);
        if (error) throw new Error("OM_VENDOR_BANKS_SAVE_FAILED");
      }
    }

    const { data } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_banks")
      .select("*")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: true });

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_BANKS_SAVE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor banks save failed");
  }
}

/* ── Company Map (single) ────────────────────────────────────────────────── */

export async function mapVendorToCompanyHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

    const body = await parseBody(req);
    const vendorId = toTrimmedString(body.vendor_id);
    const companyId = toTrimmedString(body.company_id);

    if (!(await getVendorById(vendorId))) {
      return vendorErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");
    }
    if (!(await ensureCompanyExists(companyId))) {
      return vendorErrorResponse(req, ctx, "OM_COMPANY_NOT_FOUND", 404, "Company not found");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return vendorErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
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

    if (error || !data) throw new Error("OM_VENDOR_COMPANY_MAP_FAILED");

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_COMPANY_MAP_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor company map failed");
  }
}

/* ── List Company Maps (for vendor detail) ───────────────────────────────── */

export async function listVendorCompanyMapsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    const vendorId = toTrimmedString(new URL(req.url).searchParams.get("vendor_id"));
    if (!vendorId) return vendorErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 400, "vendor_id required");

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_company_map")
      .select("*, companies:company_id(id, company_code, company_name)")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: true });

    if (error) throw new Error("OM_VENDOR_COMPANY_MAP_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VENDOR_COMPANY_MAP_LIST_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor company map list failed");
  }
}

/* ── Payment Terms ───────────────────────────────────────────────────────── */

export async function addVendorPaymentTermsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

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

    if (error || !data) throw new Error("OM_PAYMENT_TERMS_CREATE_FAILED");

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

    const url = new URL(req.url);
    const vendorId = toTrimmedString(url.searchParams.get("vendor_id"));
    const companyId = toTrimmedString(url.searchParams.get("company_id"));

    let query = serviceRoleClient
      .schema("erp_master")
      .from("vendor_payment_terms_log")
      .select("*")
      .order("recorded_at", { ascending: false })
      .limit(10);

    if (vendorId) query = query.eq("vendor_id", vendorId);
    if (companyId) query = query.eq("company_id", companyId);

    const { data, error } = await query;
    if (error) throw new Error("OM_PAYMENT_TERMS_LOOKUP_FAILED");

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_PAYMENT_TERMS_LOOKUP_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return vendorErrorResponse(req, ctx, code, status, "Vendor payment terms lookup failed");
  }
}
