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
import { assertOmAdminContext } from "./shared.ts";

type JsonRecord = Record<string, unknown>;

const ALLOWED_CUSTOMER_TYPES = new Set(["DOMESTIC", "EXPORT"]);
const CUSTOMER_STATUSES = new Set(["DRAFT", "PENDING_APPROVAL", "ACTIVE", "INACTIVE", "BLOCKED"]);
const MUTABLE_CUSTOMER_STATUSES = new Set(["DRAFT", "PENDING_APPROVAL"]);
const CUSTOMER_TRANSITIONS = new Map<string, Set<string>>([
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

export async function createCustomerHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const body = await parseBody(req);
    const customerName = toTrimmedString(body.customer_name);
    const customerType = toTrimmedString(body.customer_type).toUpperCase();
    const deliveryAddress = toTrimmedString(body.delivery_address);

    if (!customerName || !deliveryAddress || !ALLOWED_CUSTOMER_TYPES.has(customerType)) {
      return customerErrorResponse(req, ctx, "OM_INVALID_CUSTOMER_TYPE", 400, "Invalid customer type");
    }

    const { data: customerCode, error: codeError } = await serviceRoleClient.rpc("generate_customer_code");
    if (codeError || !customerCode) {
      throw new Error("OM_CUSTOMER_CREATE_FAILED");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("customer_master")
      .insert({
        customer_code: String(customerCode),
        customer_name: customerName,
        customer_type: customerType,
        delivery_address: deliveryAddress,
        billing_address: toTrimmedString(body.billing_address) || null,
        gst_number: toTrimmedString(body.gst_number) || null,
        pan_number: toTrimmedString(body.pan_number) || null,
        primary_contact_person: toTrimmedString(body.primary_contact_person) || null,
        phone: toTrimmedString(body.phone) || null,
        primary_email: toTrimmedString(body.primary_email) || null,
        currency_code: toTrimmedString(body.currency_code).toUpperCase() || "BDT",
        status: "DRAFT",
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_CUSTOMER_CREATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_CUSTOMER_CREATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("INVALID") ? 400 : 500;
    return customerErrorResponse(req, ctx, code, status, "Customer create failed");
  }
}

export async function listCustomersHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const url = new URL(req.url);
    const customerType = toTrimmedString(url.searchParams.get("customer_type")).toUpperCase();
    const statusFilter = toTrimmedString(url.searchParams.get("status")).toUpperCase();
    const search = normalizeSearch(toTrimmedString(url.searchParams.get("search")));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);
    const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);

    let query = serviceRoleClient
      .schema("erp_master")
      .from("customer_master")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (customerType) {
      query = query.eq("customer_type", customerType);
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

    return okResponse({ data: data ?? [], total: count ?? 0 }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_CUSTOMER_LIST_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return customerErrorResponse(req, ctx, code, status, "Customer list failed");
  }
}

export async function getCustomerHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const id = toTrimmedString(new URL(req.url).searchParams.get("id"));
    if (!id) {
      return customerErrorResponse(req, ctx, "OM_CUSTOMER_NOT_FOUND", 404, "Customer not found");
    }

    const customer = await getCustomerById(id);
    if (!customer) {
      return customerErrorResponse(req, ctx, "OM_CUSTOMER_NOT_FOUND", 404, "Customer not found");
    }

    return okResponse({ data: customer }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_CUSTOMER_LOOKUP_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return customerErrorResponse(req, ctx, code, status, "Customer lookup failed");
  }
}

export async function updateCustomerHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    if (!id) {
      return customerErrorResponse(req, ctx, "OM_CUSTOMER_NOT_FOUND", 404, "Customer not found");
    }

    const existing = await getCustomerById(id);
    if (!existing) {
      return customerErrorResponse(req, ctx, "OM_CUSTOMER_NOT_FOUND", 404, "Customer not found");
    }

    const currentStatus = String(existing.status ?? "");
    if (!MUTABLE_CUSTOMER_STATUSES.has(currentStatus)) {
      return customerErrorResponse(req, ctx, "OM_CUSTOMER_LOCKED", 422, "Customer is locked");
    }

    const updates: JsonRecord = {};
    const mutableFields = [
      "customer_name",
      "delivery_address",
      "billing_address",
      "gst_number",
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

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_CUSTOMER_UPDATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("LOCKED") ? 422 : code.includes("NO_CHANGES") ? 400 : 500;
    return customerErrorResponse(req, ctx, code, status, "Customer update failed");
  }
}

export async function changeCustomerStatusHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

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
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("TRANSITION") ? 422 : 500;
    return customerErrorResponse(req, ctx, code, status, "Customer status update failed");
  }
}

export async function mapCustomerToCompanyHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const body = await parseBody(req);
    const customerId = toTrimmedString(body.customer_id);
    const companyId = toTrimmedString(body.company_id);

    if (!(await getCustomerById(customerId))) {
      return customerErrorResponse(req, ctx, "OM_CUSTOMER_NOT_FOUND", 404, "Customer not found");
    }
    if (!(await ensureCompanyExists(companyId))) {
      return customerErrorResponse(req, ctx, "OM_COMPANY_NOT_FOUND", 404, "Company not found");
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
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return customerErrorResponse(req, ctx, code, status, "Customer company map failed");
  }
}
