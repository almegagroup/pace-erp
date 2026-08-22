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
import { assertCompanyScope, isCompanyScopeAdminBypass } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { resolveGstProfileWithSource } from "../../_shared/gst_resolver.ts";
import { deriveCompanyFieldsFromGstProfile } from "../../_shared/gst_company_fields.ts";
import { INDIAN_STATE_NAMES } from "../../_shared/indianStates.ts";
import { gstStateCodeFromGstNumber, gstStateCodeFromState } from "../../_shared/gstStateCodes.ts";

type JsonRecord = Record<string, unknown>;

const ALLOWED_CUSTOMER_TYPES = new Set(["DOMESTIC", "EXPORT"]);
const ALLOWED_GST_CATEGORIES = new Set(["REGISTERED", "UNREGISTERED", "COMPOSITION", "EXPORT"]);
// §83.18-REVISED (2026-07-23): separate from customer_type above (unrelated
// DOMESTIC/EXPORT commercial classification) -- this filters the Plan Feed (FO) Party
// dropdown by PO Type. Optional/nullable: RM/PM Sales customers never set it.
const ALLOWED_FO_CUSTOMER_TYPES = new Set(["MTO_HPS", "MTEST", "MTS"]);
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

function normalizeFoCustomerType(value: unknown): string {
  const normalized = toTrimmedString(value).toUpperCase();
  return normalized === "ZTEST" ? "MTEST" : normalized;
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

// Vendor-linked customer rows derive display name + GST live from
// vendor_master at read time (no copy stored), so editing the vendor record
// keeps the customer view in sync automatically. Contact/phone/email stay
// customer-specific (sales contact can differ from the procurement contact,
// and vendor's own contacts live in a separate multi-row table).
async function enrichCustomerRows(rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return rows;

  const vendorIds = [...new Set(rows.map((r) => r.vendor_id as string).filter(Boolean))];
  const parentIds = [...new Set(rows.map((r) => r.parent_customer_id as string).filter(Boolean))];
  const customerIds = [...new Set(rows.map((r) => r.id as string).filter(Boolean))];

  const [vendorResult, parentResult, companyMapResult] = await Promise.all([
    vendorIds.length
      ? serviceRoleClient.schema("erp_master").from("vendor_master").select("id, vendor_code, vendor_name, gst_number").in("id", vendorIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    parentIds.length
      ? serviceRoleClient.schema("erp_master").from("parent_customer_master").select("id, parent_customer_code, parent_customer_name").in("id", parentIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    // §MM04-list-redesign-2026-08-20 — list page shows which company(ies) each
    // customer is mapped to; bounded by the caller's own page size (LIMIT 50),
    // so a single .in() is safe here (see §8E — this is the small/bounded case).
    customerIds.length
      ? serviceRoleClient.schema("erp_master").from("customer_company_map")
          .select("customer_id, companies:company_id(company_code)")
          .in("customer_id", customerIds)
          .eq("active", true)
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
  const companyCodesByCustomer = new Map<string, string[]>();
  for (const m of (companyMapResult.data ?? []) as Record<string, unknown>[]) {
    const customerId = String(m.customer_id ?? "");
    const code = (m.companies as Record<string, unknown> | null)?.company_code as string | undefined;
    if (!customerId || !code) continue;
    const list = companyCodesByCustomer.get(customerId) ?? [];
    list.push(code);
    companyCodesByCustomer.set(customerId, list);
  }

  return rows.map((row) => {
    const vendor = row.vendor_id ? vendorMap.get(row.vendor_id as string) : null;
    const parent = row.parent_customer_id ? parentMap.get(row.parent_customer_id as string) : null;
    const resolvedName = vendor ? (vendor.vendor_name as string) : (row.customer_name as string | null);
    const resolvedGst = vendor ? (vendor.gst_number as string | null) : (row.gst_number as string | null);
    // §129.4 — display label is "{gst_state_code} - {name}"; GST's own first 2
    // digits win when set, else fall back to the customer's own state. This is
    // the only place this label is computed — frontend must never recompute it.
    const gstStateCode = gstStateCodeFromGstNumber(resolvedGst) ?? gstStateCodeFromState(row.billing_state as string | null);
    return {
      ...row,
      customer_name: resolvedName,
      gst_number: resolvedGst,
      vendor_code: vendor?.vendor_code ?? null,
      parent_customer_code: parent?.parent_customer_code ?? null,
      parent_customer_name: parent?.parent_customer_name ?? null,
      company_codes: companyCodesByCustomer.get(row.id as string) ?? [],
      gst_state_code: gstStateCode,
      display_code: gstStateCode && resolvedName ? `${gstStateCode} - ${resolvedName}` : resolvedName,
    };
  });
}

// §MM04-company-scope-2026-08-21 -- customer_master has no single company_id
// column (many-to-many via customer_company_map), so the generic
// assertCompanyScope() (single company_id) doesn't directly apply to
// read/edit-an-existing-customer paths. These two helpers are the
// customer_company_map-aware equivalent, used the same way: list/get/update/
// status-change must all validate scope, not just create (11-bug #2).
async function getCallerCompanyIds(ctx: OmHandlerContext): Promise<string[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", ctx.auth_user_id);
  if (error) throw new Error("OM_CUSTOMER_LIST_FAILED");
  return (data ?? []).map((row: Record<string, unknown>) => String(row.company_id));
}

// Membership alone (company scope guard #2) isn't enough for a WRITE --
// route-level stepAcl only checked the caller's SESSION company, not
// necessarily one of this specific customer's mapped companies (11-bug: the
// write-ACL-gap sibling check, company-scope-write-acl-guard.mjs). For each
// of the customer's companies the caller also belongs to, verify the
// caller's actual ACL decision (canMaintainCompanyResource) for the
// resource:action this route requires, not just that they're a member.
export async function assertCustomerCompanyScope(
  ctx: OmHandlerContext,
  customerId: string,
  resourceCode: string,
  actionCode: string,
): Promise<void> {
  if (isCompanyScopeAdminBypass(ctx)) return;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("customer_company_map")
    .select("company_id")
    .eq("customer_id", customerId)
    .eq("active", true);
  if (error) throw new Error("COMPANY_SCOPE_VIOLATION");
  const rawCompanyIds: string[] = (data ?? []).map((row: Record<string, unknown>) => String(row.company_id));
  const customerCompanyIds = [...new Set(rawCompanyIds)];
  if (customerCompanyIds.length === 0) throw new Error("COMPANY_SCOPE_VIOLATION");
  const callerCompanyIds = await getCallerCompanyIds(ctx);
  const candidateCompanyIds = customerCompanyIds.filter((id) => callerCompanyIds.includes(id));
  if (candidateCompanyIds.length === 0) throw new Error("COMPANY_SCOPE_VIOLATION");
  const decisions = await Promise.all(
    candidateCompanyIds.map((companyId) => canMaintainCompanyResource(ctx, companyId, resourceCode, actionCode)),
  );
  if (!decisions.some(Boolean)) throw new Error("COMPANY_SCOPE_VIOLATION");
}

export async function createCustomerHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {

    const body = await parseBody(req);
    const vendorId = toTrimmedString(body.vendor_id);
    // §129.1/§129.9 — parent_customer_id (parent_customer_master) is a dead
    // field: 0 rows, 0 links across all 64 prod customers, retired from the
    // UI in favor of the Address -> VDC -> fg_parent_company chain (§129.6).
    // No longer read from the request body.
    const customerName = toTrimmedString(body.customer_name);
    const customerType = toTrimmedString(body.customer_type).toUpperCase();
    const deliveryAddress = toTrimmedString(body.delivery_address);
    const billingState = toTrimmedString(body.billing_state);
    const foCustomerTypeRaw = normalizeFoCustomerType(body.fo_customer_type);
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
      // parent_customer_id intentionally omitted — dead field, §129.9.
      // Vendor-linked: name/GST resolve live from vendor_master (see enrichCustomerRows) — not stored here.
      customer_name: vendorId ? null : customerName,
      customer_type: customerType,
      fo_customer_type: foCustomerTypeRaw || null,
      delivery_address: deliveryAddress,
      billing_address: toTrimmedString(body.billing_address) || null,
      billing_state: billingState,
      town: toTrimmedString(body.town) || null,
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
    const foCustomerType = normalizeFoCustomerType(url.searchParams.get("fo_customer_type"));
    const statusFilter = toTrimmedString(url.searchParams.get("status")).toUpperCase();
    const search = normalizeSearch(toTrimmedString(url.searchParams.get("search")));
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);
    const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);

    // §113.6 — without this, a Customer dropdown scoped to one company
    // showed every customer in the system, mapped or not.
    // §MM04-company-scope-2026-08-21 — this alone wasn't enough: a request
    // with NO company_id (the page's own default state) fell through with
    // zero scoping at all, showing every customer from every company to
    // any VIEW-holder (Stores/Logistics/Production/Accounts alike). Now:
    // SA/GA/ACL-MASTER always see everything (unchanged); everyone else is
    // scoped to their own companies whether or not they picked one in the
    // filter — an explicit company_id must additionally be one of their own.
    let scopedCustomerIds: string[] | null = null;
    const adminBypass = isCompanyScopeAdminBypass(ctx);
    let scopeCompanyIds: string[] | null = null;
    if (companyId) {
      if (!adminBypass) {
        try {
          await assertCompanyScope(ctx, companyId);
        } catch {
          return customerErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
        }
      }
      scopeCompanyIds = [companyId];
    } else if (!adminBypass) {
      scopeCompanyIds = await getCallerCompanyIds(ctx);
      if (scopeCompanyIds.length === 0) {
        return okResponse({ data: [], total: 0 }, ctx.request_id, req);
      }
    }
    if (scopeCompanyIds) {
      const { data: mapRows, error: mapError } = await serviceRoleClient
        .schema("erp_master")
        .from("customer_company_map")
        .select("customer_id")
        .in("company_id", scopeCompanyIds)
        .eq("active", true);
      if (mapError) {
        throw new Error("OM_CUSTOMER_LIST_FAILED");
      }
      const mappedIds: string[] = (mapRows ?? []).map((row: Record<string, unknown>) => String(row.customer_id));
      scopedCustomerIds = [...new Set(mappedIds)];
      if (scopedCustomerIds.length === 0) {
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
      query = foCustomerType === "MTEST"
        ? query.in("fo_customer_type", ["MTEST", "ZTEST"])
        : query.eq("fo_customer_type", foCustomerType);
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
    try {
      await assertCustomerCompanyScope(ctx, id, "OM_CUSTOMER_LIST", "VIEW");
    } catch {
      return customerErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this customer.");
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
    try {
      await assertCustomerCompanyScope(ctx, id, "OM_CUSTOMER_CREATE", "EDIT");
    } catch {
      return customerErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this customer.");
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
      "town",
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
      const foCustomerType = normalizeFoCustomerType(body.fo_customer_type);
      if (foCustomerType && !ALLOWED_FO_CUSTOMER_TYPES.has(foCustomerType)) {
        return customerErrorResponse(req, ctx, "OM_INVALID_FO_CUSTOMER_TYPE", 400, "Invalid FO customer type");
      }
      updates.fo_customer_type = foCustomerType || null;
    }

    // parent_customer_id no longer accepted here — dead field, §129.9.

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
    try {
      await assertCustomerCompanyScope(ctx, id, "OM_CUSTOMER_CREATE", "EDIT");
    } catch {
      return customerErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this customer.");
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
    try {
      await assertCustomerCompanyScope(ctx, customerId, "OM_CUSTOMER_LIST", "VIEW");
    } catch {
      return customerErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this customer.");
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
