/*
 * File-ID: 14.5
 * File-Path: supabase/functions/api/_core/om/customer.handlers.ts
 * Gate: 14
 * Phase: 14
 * Domain: MASTER
 * Purpose: Implement customer master CRUD, status, and company mapping handlers.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { OmHandlerContext } from "./shared.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { resolveGstProfileWithSource } from "../../_shared/gst_resolver.ts";
import { deriveCompanyFieldsFromGstProfile } from "../../_shared/gst_company_fields.ts";
import { INDIAN_STATE_NAMES } from "../../_shared/indianStates.ts";

type JsonRecord = Record<string, unknown>;

const ALLOWED_CUSTOMER_TYPES = new Set(["DOMESTIC", "EXPORT"]);
const ALLOWED_GST_CATEGORIES = new Set(["REGISTERED", "UNREGISTERED", "COMPOSITION", "EXPORT"]);
// §83.18-REVISED (2026-07-23): separate from customer_type above (unrelated
// DOMESTIC/EXPORT commercial classification) -- this filters the Plan Feed (FO) Party
// dropdown by PO Type. Optional/nullable: RM/PM Sales customers never set it.
const ALLOWED_FO_CUSTOMER_TYPES = new Set(["MTO_HPS", "ZTEST", "MTS"]);
const CUSTOMER_STATUSES = new Set(["DRAFT", "PENDING_APPROVAL", "ACTIVE", "INACTIVE", "BLOCKED"]);
const CUSTOMER_TRANSITIONS = new Map<string, Set<string>>([
  ["DRAFT", new Set(["ACTIVE", "INACTIVE", "PENDING_APPROVAL"])],
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

function customerErrorResponse(
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

async function getCustomerById(id: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("customer_master")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error("OM_CUSTOMER_LOOKUP_FAILED");
  }

  return (data as Record<string, unknown> | null) ?? null;
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

async function ensureParentCustomerExists(parentCustomerId: string): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("parent_customer_master")
    .select("id")
    .eq("id", parentCustomerId)
    .maybeSingle();

  return !error && Boolean(data?.id);
}

// Vendor-linked customer rows derive display name + GST live from
// vendor_master at read time (no copy stored), so editing the vendor record
// keeps the customer view in sync automatically. Contact/phone/email stay
// customer-specific (sales contact can differ from the procurement contact,
// and vendor's own contacts live in a separate multi-row table).
async function enrichCustomerRows(rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return rows;

  const vendorIds = [...new Set(rows.map((r) => r.vendor_id as string).filter(Boolean))];
  const parentIds = [...new Set(rows.map((r) => r.parent_customer_id as string).filter(Boolean))];

  const [vendorResult, parentResult] = await Promise.all([
    vendorIds.length
      ? serviceRoleClient.schema("erp_master").from("vendor_master").select("id, vendor_code, vendor_name, gst_number").in("id", vendorIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    parentIds.length
      ? serviceRoleClient.schema("erp_master").from("parent_customer_master").select("id, parent_customer_code, parent_customer_name").in("id", parentIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const vendorMap = new Map<string, Record<string, unknown>>();
  for (const v of (vendorResult.data ?? []) as Record<string, unknown>[]) {
    vendorMap.set(v.id as string, v);
  }
  const parentMap = new Map<string, Record<string, unknown>>();
  for (const p of (parentResult.data ?? []) as Record<string, unknown>[]) {
    parentMap.set(p.id as string, p);
  }

  return rows.map((row) => {
    const vendor = row.vendor_id ? vendorMap.get(row.vendor_id as string) : null;
    const parent = row.parent_customer_id ? parentMap.get(row.parent_customer_id as string) : null;
    return {
      ...row,
      customer_name: vendor ? vendor.vendor_name : row.customer_name,
      gst_number: vendor ? vendor.gst_number : row.gst_number,
      vendor_code: vendor?.vendor_code ?? null,
      parent_customer_code: parent?.parent_customer_code ?? null,
      parent_customer_name: parent?.parent_customer_name ?? null,
    };
  });
}

export async function createCustomerHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

    const body = await parseBody(req);
    const vendorId = toTrimmedString(body.vendor_id);
    const parentCustomerId = toTrimmedString(body.parent_customer_id);
    const customerName = toTrimmedString(body.customer_name);
    const customerType = toTrimmedString(body.customer_type).toUpperCase();
    const deliveryAddress = toTrimmedString(body.delivery_address);
    const billingState = toTrimmedString(body.billing_state);
    const foCustomerTypeRaw = toTrimmedString(body.fo_customer_type).toUpperCase();
    const gstCategory = toTrimmedString(body.gst_category).toUpperCase();
    // §113.6 — a customer created with no company mapping produces an
    // unscoped row every other company can see; mandatory at create time.
    const companyId = toTrimmedString(body.company_id);

    if ((!customerName && !vendorId) || !deliveryAddress || !ALLOWED_CUSTOMER_TYPES.has(customerType)) {
      return customerErrorResponse(req, ctx, "OM_INVALID_CUSTOMER_TYPE", 400, "Invalid customer type");
    }
    // §113 GST design session, 2026-07-30 — place of supply must come from
    // the customer's own state, not their GSTIN (unregistered customers
    // have none). Mandatory regardless of gst_category.
    if (!billingState) {
      return customerErrorResponse(req, ctx, "OM_CUSTOMER_BILLING_STATE_REQUIRED", 400, "Billing state is required");
    }
    // DOMESTIC-only: the frontend dropdown only offers Indian states (EXPORT
    // customers keep free text for their own country's state/province).
    if (customerType === "DOMESTIC" && !INDIAN_STATE_NAMES.has(billingState)) {
      return customerErrorResponse(req, ctx, "OM_INVALID_BILLING_STATE", 400, "Invalid billing state");
    }
    if (!companyId) {
      return customerErrorResponse(req, ctx, "OM_CUSTOMER_COMPANY_REQUIRED", 400, "company_id is required");
    }
    if (gstCategory && !ALLOWED_GST_CATEGORIES.has(gstCategory)) {
      return customerErrorResponse(req, ctx, "OM_INVALID_GST_CATEGORY", 400, "Invalid GST category");
    }
    if (foCustomerTypeRaw && !ALLOWED_FO_CUSTOMER_TYPES.has(foCustomerTypeRaw)) {
      return customerErrorResponse(req, ctx, "OM_INVALID_FO_CUSTOMER_TYPE", 400, "Invalid FO customer type");
    }
    if (vendorId && !(await ensureVendorExists(vendorId))) {
      return customerErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");
    }
    if (parentCustomerId && !(await ensureParentCustomerExists(parentCustomerId))) {
      return customerErrorResponse(req, ctx, "OM_PARENT_CUSTOMER_NOT_FOUND", 404, "Parent customer not found");
    }
    if (!(await ensureCompanyExists(companyId))) {
      return customerErrorResponse(req, ctx, "OM_COMPANY_NOT_FOUND", 404, "Company not found");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return customerErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const { data: customerCode, error: codeError } = await serviceRoleClient.rpc("generate_customer_code");
    if (codeError || !customerCode) {
      console.error("[createCustomerHandler] generate_customer_code RPC failed:", JSON.stringify(codeError));
      throw new Error("OM_CUSTOMER_CREATE_FAILED");
    }

    const insertPayload = {
      customer_code: String(customerCode),
      vendor_id: vendorId || null,
      parent_customer_id: parentCustomerId || null,
      // Vendor-linked: name/GST resolve live from vendor_master (see enrichCustomerRows) — not stored here.
      customer_name: vendorId ? null : customerName,
      customer_type: customerType,
      fo_customer_type: foCustomerTypeRaw || null,
      delivery_address: deliveryAddress,
      billing_address: toTrimmedString(body.billing_address) || null,
      billing_state: billingState,
      gst_number: vendorId ? null : toTrimmedString(body.gst_number) || null,
      gst_category: gstCategory || null,
      pan_number: toTrimmedString(body.pan_number) || null,
      primary_contact_person: toTrimmedString(body.primary_contact_person) || null,
      phone: toTrimmedString(body.phone) || null,
      primary_email: toTrimmedString(body.primary_email) || null,
      currency_code: toTrimmedString(body.currency_code).toUpperCase() || "BDT",
      status: "ACTIVE",
      approved_by: ctx.auth_user_id,
      approved_at: new Date().toISOString(),
      created_by: ctx.auth_user_id,
    };
    console.log("[createCustomerHandler] insert payload:", JSON.stringify(insertPayload));

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("customer_master")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error || !data) {
      console.error("[createCustomerHandler] insert failed:", JSON.stringify(error));
      throw new Error("OM_CUSTOMER_CREATE_FAILED");
    }

    // Atomic with create — a customer row must never exist unmapped (§113.6).
    const { error: mapError } = await serviceRoleClient
      .schema("erp_master")
      .from("customer_company_map")
      .insert({ customer_id: data.id, company_id: companyId, active: true });

    if (mapError) {
      console.error("[createCustomerHandler] company map insert failed:", JSON.stringify(mapError));
      // Roll back the orphaned customer row rather than leaving an unmapped one behind.
      await serviceRoleClient.schema("erp_master").from("customer_master").delete().eq("id", data.id);
      throw new Error("OM_CUSTOMER_COMPANY_MAP_FAILED");
    }

    const [enriched] = await enrichCustomerRows([data as Record<string, unknown>]);
    return okResponse({ data: enriched }, ctx.request_id, req);
  } catch (err) {
    console.error("[createCustomerHandler] caught error:", err);
    const code = (err as Error).message || "OM_CUSTOMER_CREATE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("INVALID") || code.includes("REQUIRED") ? 400 : 500;
    return customerErrorResponse(req, ctx, code, status, "Customer create failed");
  }
}

export async function lookupCustomerGstProfileHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    const gstNumber = toTrimmedString(new URL(req.url).searchParams.get("gst_number")).toUpperCase();
    if (!gstNumber) {
      return customerErrorResponse(req, ctx, "OM_GST_NUMBER_REQUIRED", 400, "gst_number is required");
    }

    const resolved = await resolveGstProfileWithSource(gstNumber);
    const fields = deriveCompanyFieldsFromGstProfile(resolved.profile);

    return okResponse(
      {
        data: {
          gst_number: resolved.profile.gst_number,
          legal_name: resolved.profile.legal_name,
          source: resolved.source,
          state_name: fields.state_name,
          full_address: fields.full_address,
          pin_code: fields.pin_code,
        },
      },
      ctx.request_id,
      req,
    );
  } catch (err) {
    const code = (err as Error).message || "OM_GST_LOOKUP_FAILED";
    return customerErrorResponse(req, ctx, code, code.includes("REQUIRED") ? 400 : 500, "GST lookup failed");
  }
}

export async function listCustomersHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

    const url = new URL(req.url);
    const customerType = toTrimmedString(url.searchParams.get("customer_type")).toUpperCase();
    const foCustomerType = toTrimmedString(url.searchParams.get("fo_customer_type")).toUpperCase();
    const statusFilter = toTrimmedString(url.searchParams.get("status")).toUpperCase();
    const search = normalizeSearch(toTrimmedString(url.searchParams.get("search")));
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);
    const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);

    // §113.6 — without this, a Customer dropdown scoped to one company
    // showed every customer in the system, mapped or not.
    let scopedCustomerIds: string[] | null = null;
    if (companyId) {
      const { data: mapRows, error: mapError } = await serviceRoleClient
        .schema("erp_master")
        .from("customer_company_map")
        .select("customer_id")
        .eq("company_id", companyId)
        .eq("active", true);
      if (mapError) {
        throw new Error("OM_CUSTOMER_LIST_FAILED");
      }
      scopedCustomerIds = (mapRows ?? []).map((row: Record<string, unknown>) => String(row.customer_id));
      if (scopedCustomerIds!.length === 0) {
        return okResponse({ data: [], total: 0 }, ctx.request_id, req);
      }
    }

    let query = serviceRoleClient
      .schema("erp_master")
      .from("customer_master")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (scopedCustomerIds) {
      query = query.in("id", scopedCustomerIds);
    }
    if (customerType) {
      query = query.eq("customer_type", customerType);
    }
    if (foCustomerType) {
      query = query.eq("fo_customer_type", foCustomerType);
    }
    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }
    if (search) {
      query = query.or(`customer_code.ilike.%${search}%,customer_name.ilike.%${search}%`);
    }

    const { data, error, count } = await query;
    if (error) {
      throw new Error("OM_CUSTOMER_LIST_FAILED");
    }

    const enriched = await enrichCustomerRows((data ?? []) as Record<string, unknown>[]);
    return okResponse({ data: enriched, total: count ?? 0 }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_CUSTOMER_LIST_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : 500;
    return customerErrorResponse(req, ctx, code, status, "Customer list failed");
  }
}

export async function getCustomerHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

    const id = toTrimmedString(new URL(req.url).searchParams.get("id"));
    if (!id) {
      return customerErrorResponse(req, ctx, "OM_CUSTOMER_NOT_FOUND", 404, "Customer not found");
    }

    const customer = await getCustomerById(id);
    if (!customer) {
      return customerErrorResponse(req, ctx, "OM_CUSTOMER_NOT_FOUND", 404, "Customer not found");
    }

    const [enriched] = await enrichCustomerRows([customer]);
    return okResponse({ data: enriched }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_CUSTOMER_LOOKUP_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return customerErrorResponse(req, ctx, code, status, "Customer lookup failed");
  }
}

export async function updateCustomerHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    if (!id) {
      return customerErrorResponse(req, ctx, "OM_CUSTOMER_NOT_FOUND", 404, "Customer not found");
    }

    const existing = await getCustomerById(id);
    if (!existing) {
      return customerErrorResponse(req, ctx, "OM_CUSTOMER_NOT_FOUND", 404, "Customer not found");
    }

    const isVendorLinked = Boolean(existing.vendor_id);

    const updates: JsonRecord = {};
    const mutableFields = [
      // customer_name/gst_number stay live-derived from the vendor when linked
      // (see enrichCustomerRows) — editing them here would have no effect.
      ...(isVendorLinked ? [] : ["customer_name", "gst_number"]),
      "delivery_address",
      "billing_address",
      "billing_state",
      "pan_number",
      "primary_contact_person",
      "phone",
      "primary_email",
      "currency_code",
    ];

    for (const field of mutableFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    // Same DOMESTIC-only allowlist as create -- customer_type itself isn't
    // editable here, so the existing row's own type is authoritative.
    if (toTrimmedString(existing.customer_type).toUpperCase() === "DOMESTIC" && updates.billing_state !== undefined) {
      const billingState = toTrimmedString(updates.billing_state);
      if (billingState && !INDIAN_STATE_NAMES.has(billingState)) {
        return customerErrorResponse(req, ctx, "OM_INVALID_BILLING_STATE", 400, "Invalid billing state");
      }
    }

    if (body.gst_category !== undefined) {
      const gstCategory = toTrimmedString(body.gst_category).toUpperCase();
      if (gstCategory && !ALLOWED_GST_CATEGORIES.has(gstCategory)) {
        return customerErrorResponse(req, ctx, "OM_INVALID_GST_CATEGORY", 400, "Invalid GST category");
      }
      updates.gst_category = gstCategory || null;
    }

    if (body.fo_customer_type !== undefined) {
      const foCustomerType = toTrimmedString(body.fo_customer_type).toUpperCase();
      if (foCustomerType && !ALLOWED_FO_CUSTOMER_TYPES.has(foCustomerType)) {
        return customerErrorResponse(req, ctx, "OM_INVALID_FO_CUSTOMER_TYPE", 400, "Invalid FO customer type");
      }
      updates.fo_customer_type = foCustomerType || null;
    }

    if (body.parent_customer_id !== undefined) {
      const parentCustomerId = toTrimmedString(body.parent_customer_id);
      if (parentCustomerId && !(await ensureParentCustomerExists(parentCustomerId))) {
        return customerErrorResponse(req, ctx, "OM_PARENT_CUSTOMER_NOT_FOUND", 404, "Parent customer not found");
      }
      updates.parent_customer_id = parentCustomerId || null;
    }

    if (Object.keys(updates).length === 0) {
      return customerErrorResponse(req, ctx, "OM_CUSTOMER_NO_CHANGES", 400, "No changes provided");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("customer_master")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_CUSTOMER_UPDATE_FAILED");
    }

    const [enriched] = await enrichCustomerRows([data as Record<string, unknown>]);
    return okResponse({ data: enriched }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_CUSTOMER_UPDATE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("LOCKED") ? 422 : code.includes("NO_CHANGES") ? 400 : 500;
    return customerErrorResponse(req, ctx, code, status, "Customer update failed");
  }
}

export async function changeCustomerStatusHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    const newStatus = toTrimmedString(body.new_status).toUpperCase();

    if (!id) {
      return customerErrorResponse(req, ctx, "OM_CUSTOMER_NOT_FOUND", 404, "Customer not found");
    }
    if (!CUSTOMER_STATUSES.has(newStatus)) {
      return customerErrorResponse(req, ctx, "OM_INVALID_STATUS_TRANSITION", 422, "Status transition not allowed");
    }

    const existing = await getCustomerById(id);
    if (!existing) {
      return customerErrorResponse(req, ctx, "OM_CUSTOMER_NOT_FOUND", 404, "Customer not found");
    }

    const currentStatus = String(existing.status ?? "");
    const allowed = CUSTOMER_TRANSITIONS.get(currentStatus);
    if (!allowed?.has(newStatus)) {
      return customerErrorResponse(req, ctx, "OM_INVALID_STATUS_TRANSITION", 422, "Status transition not allowed");
    }

    const updates: JsonRecord = { status: newStatus };
    if (newStatus === "ACTIVE") {
      updates.approved_by = ctx.auth_user_id;
      updates.approved_at = new Date().toISOString();
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("customer_master")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_CUSTOMER_STATUS_UPDATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_CUSTOMER_STATUS_UPDATE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("TRANSITION") ? 422 : 500;
    return customerErrorResponse(req, ctx, code, status, "Customer status update failed");
  }
}

export async function mapCustomerToCompanyHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

    const body = await parseBody(req);
    const customerId = toTrimmedString(body.customer_id);
    const companyId = toTrimmedString(body.company_id);

    if (!(await getCustomerById(customerId))) {
      return customerErrorResponse(req, ctx, "OM_CUSTOMER_NOT_FOUND", 404, "Customer not found");
    }
    if (!(await ensureCompanyExists(companyId))) {
      return customerErrorResponse(req, ctx, "OM_COMPANY_NOT_FOUND", 404, "Company not found");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return customerErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("customer_company_map")
      .upsert({
        customer_id: customerId,
        company_id: companyId,
        active: body.active !== false,
      }, { onConflict: "customer_id,company_id" })
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_CUSTOMER_COMPANY_MAP_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_CUSTOMER_COMPANY_MAP_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return customerErrorResponse(req, ctx, code, status, "Customer company map failed");
  }
}

export async function listCustomerCompanyMapsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    const customerId = toTrimmedString(new URL(req.url).searchParams.get("customer_id"));
    if (!customerId) {
      return customerErrorResponse(req, ctx, "OM_CUSTOMER_NOT_FOUND", 400, "customer_id required");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("customer_company_map")
      .select("*, companies:company_id(id, company_code, company_name)")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error("OM_CUSTOMER_COMPANY_MAP_LIST_FAILED");
    }

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_CUSTOMER_COMPANY_MAP_LIST_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : 500;
    return customerErrorResponse(req, ctx, code, status, "Customer company map list failed");
  }
}
