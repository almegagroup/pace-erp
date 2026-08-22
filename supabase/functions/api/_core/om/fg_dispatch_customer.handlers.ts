/*
 * File-ID: 27.27-BE
 * File-Path: supabase/functions/api/_core/om/fg_dispatch_customer.handlers.ts
 * Gate: 27.27
 * Domain: OM MASTERS
 * Purpose: MM05 FG Dispatch Customer master - parent company, depot code,
 *          dispatch customer, address CRUD, and GST-upgrade flow.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertCompanyScope, isCompanyScopeAdminBypass } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { INDIAN_STATE_NAMES } from "../../_shared/indianStates.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { OmHandlerContext } from "./shared.ts";
import { assertOmReadContext } from "./shared.ts";

type JsonRecord = Record<string, unknown>;

const CUSTOMER_STATUSES = new Set(["ACTIVE", "INACTIVE"]);
const DISPATCH_TYPES = new Set(["DIRECT", "DEPOT"]);
const REGISTRATION_TYPES = new Set(["REGISTERED", "UNREGISTERED"]);
const FO_TYPES = new Set(["MTO_HPS", "MTEST", "MTS"]);

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}

function normalizeFoCustomerType(value: unknown): string {
  const normalized = toUpperTrimmedString(value);
  return normalized === "ZTEST" ? "MTEST" : normalized;
}

function mm05Error(req: Request, ctx: OmHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

async function getCompanyScope(ctx: OmHandlerContext, requestedCompanyId?: string): Promise<string> {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  const companyId = toTrimmedString(requestedCompanyId) || scopedCompanyId;
  if (companyId) await assertCompanyScope(ctx, companyId);
  return companyId;
}

function isConstraint(error: unknown, constraintName: string): boolean {
  return typeof error === "object"
    && error !== null
    && "constraint" in error
    && String((error as { constraint?: unknown }).constraint ?? "") === constraintName;
}

function parsePath(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}

function getCustomerIdFromPath(req: Request): string {
  const parts = parsePath(req);
  const customerIndex = parts.indexOf("fg-dispatch-customers");
  return customerIndex >= 0 ? toTrimmedString(parts[customerIndex + 1]) : "";
}

function getAddressIdFromPath(req: Request): string {
  const parts = parsePath(req);
  const addressIndex = parts.indexOf("fg-dispatch-addresses");
  return addressIndex >= 0 ? toTrimmedString(parts[addressIndex + 1]) : "";
}


function requireIndianState(req: Request, ctx: OmHandlerContext, rawState: unknown): string | Response {
  const state = toTrimmedString(rawState);
  if (!state || !INDIAN_STATE_NAMES.has(state)) {
    return mm05Error(req, ctx, "MM05_INVALID_STATE", 400, "State must be a valid Indian state.");
  }
  return state;
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

async function getParentCompanyById(id: string): Promise<JsonRecord | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("fg_parent_company")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("MM05_PARENT_COMPANY_LOOKUP_FAILED");
  return (data as JsonRecord | null) ?? null;
}

async function getDepotCodeById(id: string): Promise<JsonRecord | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("fg_depot_code")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("MM05_DEPOT_CODE_LOOKUP_FAILED");
  return (data as JsonRecord | null) ?? null;
}

async function getDispatchCustomerById(id: string): Promise<JsonRecord | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("fg_dispatch_customer")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("MM05_CUSTOMER_LOOKUP_FAILED");
  return (data as JsonRecord | null) ?? null;
}

async function getAddressById(id: string): Promise<JsonRecord | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("fg_dispatch_customer_address")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("MM05_ADDRESS_LOOKUP_FAILED");
  return (data as JsonRecord | null) ?? null;
}

async function getCompanyIdForDepotCode(depotCodeId: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("fg_depot_code")
    .select("id, parent_company:fg_parent_company!inner(company_id)")
    .eq("id", depotCodeId)
    .maybeSingle();
  if (error || !data) throw new Error("MM05_DEPOT_CODE_NOT_FOUND");
  return toTrimmedString(((data as JsonRecord).parent_company as JsonRecord)?.company_id);
}

async function getCompanyIdForAddress(addressId: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("fg_dispatch_customer_address")
    .select("id, depot_code:fg_depot_code!inner(parent_company:fg_parent_company!inner(company_id))")
    .eq("id", addressId)
    .maybeSingle();
  if (error || !data) throw new Error("MM05_ADDRESS_NOT_FOUND");
  const depotCode = (data as JsonRecord).depot_code as JsonRecord;
  return toTrimmedString((depotCode.parent_company as JsonRecord)?.company_id);
}

// company-scope-write-acl-guard.mjs (2026-08-11 PO11 Planning precedent) --
// assertCompanyScope() alone only proves company MEMBERSHIP, not that the
// caller's ACL grant at this specific company is actually the tier this
// write needs. Same real-ACL-tier pattern as customer.handlers.ts's own
// assertCustomerCompanyScope() (2026-08-21) -- reused here rather than
// re-derived, since both ultimately check the same MM04 resource family.
async function assertParentCompanyScope(
  ctx: OmHandlerContext,
  parentCompanyId: string,
  resourceCode: string,
  actionCode: string,
): Promise<void> {
  const parent = await getParentCompanyById(parentCompanyId);
  if (!parent) throw new Error("MM05_PARENT_COMPANY_NOT_FOUND");
  const companyId = toTrimmedString(parent.company_id);
  if (isCompanyScopeAdminBypass(ctx)) return;
  await assertCompanyScope(ctx, companyId);
  const allowed = await canMaintainCompanyResource(ctx, companyId, resourceCode, actionCode);
  if (!allowed) throw new Error("COMPANY_SCOPE_VIOLATION");
}

function mapMutationError(req: Request, ctx: OmHandlerContext, code: string, fallbackMessage: string): Response {
  switch (code) {
    case "COMPANY_SCOPE_VIOLATION":
      return mm05Error(req, ctx, code, 403, "You do not have access to this company.");
    case "MM05_PARENT_COMPANY_NOT_FOUND":
    case "MM05_DEPOT_CODE_NOT_FOUND":
    case "MM05_CUSTOMER_NOT_FOUND":
    case "MM05_ADDRESS_NOT_FOUND":
      return mm05Error(req, ctx, code, 404, fallbackMessage);
    case "MM05_INVALID_STATE":
    case "MM05_INVALID_INPUT":
    case "MM05_DEPOT_ADDRESS_REQUIRED":
    case "MM05_DIRECT_DEPOT_INLINE_ADDRESS_FORBIDDEN":
    case "MM05_ADDRESS_REQUIRES_DIRECT_DEPOT":
    case "MM05_REGISTRATION_ALREADY_REGISTERED":
    case "MM05_REPLACE_ADDRESS_REQUIRED":
    case "MM05_UPGRADE_ADDRESS_REQUIRED":
      return mm05Error(req, ctx, code, 400, fallbackMessage);
    case "MM05_STATE_MISMATCH":
      return mm05Error(req, ctx, code, 400, "Address state must match the linked parent company's state.");
    case "MM05_DUPLICATE_PARENT_COMPANY":
    case "MM05_DUPLICATE_DEPOT_CODE":
      return mm05Error(req, ctx, code, 409, fallbackMessage);
    default:
      return mm05Error(req, ctx, code, 500, fallbackMessage);
  }
}

export async function createParentCompanyHandler(req: Request, ctx: OmHandlerContext): Promise<Response> {
  try {
    assertOmReadContext(ctx);
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    const companyName = toTrimmedString(body.company_name);
    const state = requireIndianState(req, ctx, body.state);
    if (state instanceof Response) return state;
    if (!companyId || !companyName) {
      return mm05Error(req, ctx, "MM05_INVALID_INPUT", 400, "company_id, company_name, and state are required.");
    }
    if (!(await ensureCompanyExists(companyId))) {
      return mm05Error(req, ctx, "OM_COMPANY_NOT_FOUND", 404, "Company not found.");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("fg_parent_company")
      .insert({
        company_id: companyId,
        company_name: companyName,
        gst_number: toTrimmedString(body.gst_number) || null,
        state,
        full_address: toTrimmedString(body.full_address) || null,
        pin_code: toTrimmedString(body.pin_code) || null,
        status: "ACTIVE",
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();
    if (error || !data) {
      if (isConstraint(error, "fg_parent_company_company_id_company_name_state_key")) {
        return mm05Error(req, ctx, "MM05_DUPLICATE_PARENT_COMPANY", 409, "A parent company row for this company, name, and state already exists.");
      }
      console.error("[mm05.createParentCompany] insert failed:", JSON.stringify(error));
      throw new Error("MM05_PARENT_COMPANY_CREATE_FAILED");
    }
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    return mapMutationError(req, ctx, error instanceof Error ? error.message : "MM05_PARENT_COMPANY_CREATE_FAILED", "Parent company create failed.");
  }
}

export async function listParentCompaniesHandler(req: Request, ctx: OmHandlerContext): Promise<Response> {
  try {
    assertOmReadContext(ctx);
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const state = toTrimmedString(url.searchParams.get("state"));
    let query = serviceRoleClient
      .schema("erp_master")
      .from("fg_parent_company")
      .select("id, company_id, company_name, gst_number, state, full_address, pin_code, status, created_at")
      .eq("status", "ACTIVE")
      .order("company_name", { ascending: true })
      .order("state", { ascending: true });
    if (companyId) query = query.eq("company_id", companyId);
    if (state) query = query.eq("state", state);
    const { data, error } = await query;
    if (error) throw new Error("MM05_PARENT_COMPANY_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    return mapMutationError(req, ctx, error instanceof Error ? error.message : "MM05_PARENT_COMPANY_LIST_FAILED", "Parent company list failed.");
  }
}

export async function createOrGetDepotCodeHandler(req: Request, ctx: OmHandlerContext): Promise<Response> {
  try {
    assertOmReadContext(ctx);
    const body = await parseBody(req);
    const parentCompanyId = toTrimmedString(body.parent_company_id);
    const dispatchType = toUpperTrimmedString(body.dispatch_type);
    const code = toTrimmedString(body.code);
    if (!parentCompanyId || !DISPATCH_TYPES.has(dispatchType) || !code) {
      return mm05Error(req, ctx, "MM05_INVALID_INPUT", 400, "parent_company_id, dispatch_type, and code are required.");
    }
    await assertParentCompanyScope(ctx, parentCompanyId, "OM_CUSTOMER_CREATE", "WRITE");
    const stateValue = toTrimmedString(body.state);
    if (stateValue && !INDIAN_STATE_NAMES.has(stateValue)) {
      return mm05Error(req, ctx, "MM05_INVALID_STATE", 400, "State must be a valid Indian state.");
    }

    const { data: existing, error: existingError } = await serviceRoleClient
      .schema("erp_master")
      .from("fg_depot_code")
      .select("*")
      .eq("parent_company_id", parentCompanyId)
      .eq("code", code)
      .maybeSingle();
    if (existingError) {
      console.error("[mm05.createOrGetDepotCode] existing lookup failed:", JSON.stringify(existingError));
      throw new Error("MM05_DEPOT_CODE_CREATE_FAILED");
    }
    if (existing) return okResponse({ data: existing }, ctx.request_id, req);

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("fg_depot_code")
      .insert({
        parent_company_id: parentCompanyId,
        dispatch_type: dispatchType,
        code,
        description: toTrimmedString(body.description) || null,
        address_line: dispatchType === "DEPOT" ? (toTrimmedString(body.address_line) || null) : null,
        state: dispatchType === "DEPOT" ? (stateValue || null) : null,
        pin_code: dispatchType === "DEPOT" ? (toTrimmedString(body.pin_code) || null) : null,
        // §129.5 — VDC's own optional GST, checked via the same generic
        // lookupCustomerGstProfileHandler endpoint the frontend already uses
        // for Customer/Parent Company; this handler just stores whatever the
        // caller sends (auto-overwrite happens client-side, no server choice).
        gst_number: toTrimmedString(body.gst_number) || null,
        status: "ACTIVE",
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();
    if (error || !data) {
      if (isConstraint(error, "fg_depot_code_parent_company_id_code_key")) {
        return mm05Error(req, ctx, "MM05_DUPLICATE_DEPOT_CODE", 409, "This depot code already exists under the selected parent company.");
      }
      if (String((error as { message?: unknown })?.message ?? "").includes("MM05_DEPOT_ADDRESS_REQUIRED")) {
        return mm05Error(req, ctx, "MM05_DEPOT_ADDRESS_REQUIRED", 400, "Depot-type code requires address and state.");
      }
      if (String((error as { message?: unknown })?.message ?? "").includes("MM05_DIRECT_DEPOT_INLINE_ADDRESS_FORBIDDEN")) {
        return mm05Error(req, ctx, "MM05_DIRECT_DEPOT_INLINE_ADDRESS_FORBIDDEN", 400, "Direct-type depot code cannot store inline address fields.");
      }
      if (String((error as { message?: unknown })?.message ?? "").includes("MM05_STATE_MISMATCH")) {
        return mm05Error(req, ctx, "MM05_STATE_MISMATCH", 400, "Depot address state must match the selected parent company's state.");
      }
      console.error("[mm05.createOrGetDepotCode] insert failed:", JSON.stringify(error));
      throw new Error("MM05_DEPOT_CODE_CREATE_FAILED");
    }
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    return mapMutationError(req, ctx, error instanceof Error ? error.message : "MM05_DEPOT_CODE_CREATE_FAILED", "Depot code create failed.");
  }
}

export async function listDepotCodesHandler(req: Request, ctx: OmHandlerContext): Promise<Response> {
  try {
    assertOmReadContext(ctx);
    const url = new URL(req.url);
    const parentCompanyId = toTrimmedString(url.searchParams.get("parent_company_id"));
    const dispatchType = toUpperTrimmedString(url.searchParams.get("dispatch_type"));
    if (parentCompanyId) await assertParentCompanyScope(ctx, parentCompanyId, "OM_CUSTOMER_LIST", "VIEW");
    let query = serviceRoleClient
      .schema("erp_master")
      .from("fg_depot_code")
      .select("id, parent_company_id, dispatch_type, code, description, address_line, state, pin_code, gst_number, status, created_at")
      .eq("status", "ACTIVE")
      .order("code", { ascending: true });
    if (parentCompanyId) query = query.eq("parent_company_id", parentCompanyId);
    if (dispatchType) query = query.eq("dispatch_type", dispatchType);
    const { data, error } = await query;
    if (error) throw new Error("MM05_DEPOT_CODE_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    return mapMutationError(req, ctx, error instanceof Error ? error.message : "MM05_DEPOT_CODE_LIST_FAILED", "Depot code list failed.");
  }
}

// §129.5 — GST-overwrite semantics: this handler stores exactly what the
// caller sends for name/state/gst_number/full_address/pin_code, no
// Keep-vs-Overwrite choice server-side — the frontend already auto-fills
// these fields from Check GST before Save is ever pressed.
export async function updateParentCompanyHandler(req: Request, ctx: OmHandlerContext): Promise<Response> {
  try {
    assertOmReadContext(ctx);
    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    if (!id) return mm05Error(req, ctx, "MM05_INVALID_INPUT", 400, "Parent company id is required.");
    await assertParentCompanyScope(ctx, id, "OM_CUSTOMER_CREATE", "EDIT");

    const updates: JsonRecord = {};
    if (body.company_name !== undefined) {
      const companyName = toTrimmedString(body.company_name);
      if (!companyName) return mm05Error(req, ctx, "MM05_INVALID_INPUT", 400, "company_name cannot be empty.");
      updates.company_name = companyName;
    }
    if (body.state !== undefined) {
      const state = requireIndianState(req, ctx, body.state);
      if (state instanceof Response) return state;
      updates.state = state;
    }
    if (body.gst_number !== undefined) updates.gst_number = toTrimmedString(body.gst_number) || null;
    if (body.full_address !== undefined) updates.full_address = toTrimmedString(body.full_address) || null;
    if (body.pin_code !== undefined) updates.pin_code = toTrimmedString(body.pin_code) || null;
    if (Object.keys(updates).length === 0) {
      return mm05Error(req, ctx, "MM05_NO_CHANGES", 400, "No changes provided.");
    }
    updates.last_updated_by = ctx.auth_user_id;
    updates.last_updated_at = new Date().toISOString();

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("fg_parent_company")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) {
      if (isConstraint(error, "fg_parent_company_company_id_company_name_state_key")) {
        return mm05Error(req, ctx, "MM05_DUPLICATE_PARENT_COMPANY", 409, "A parent company row for this company, name, and state already exists.");
      }
      console.error("[mm05.updateParentCompany] update failed:", JSON.stringify(error));
      throw new Error("MM05_PARENT_COMPANY_UPDATE_FAILED");
    }
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    return mapMutationError(req, ctx, error instanceof Error ? error.message : "MM05_PARENT_COMPANY_UPDATE_FAILED", "Parent company update failed.");
  }
}

// §129.8 Step 7 — this is the "Change" action on a VDC's Parent Company link
// (re-pointing parent_company_id), plus the same editable field set as create.
export async function updateDepotCodeHandler(req: Request, ctx: OmHandlerContext): Promise<Response> {
  try {
    assertOmReadContext(ctx);
    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    if (!id) return mm05Error(req, ctx, "MM05_INVALID_INPUT", 400, "Depot code id is required.");

    const existing = await getDepotCodeById(id);
    if (!existing) return mm05Error(req, ctx, "MM05_DEPOT_CODE_NOT_FOUND", 404, "Depot code not found.");
    // Caller must have access to BOTH the depot code's current parent company
    // and (if re-pointing) the new one — check current first.
    await assertParentCompanyScope(ctx, toTrimmedString(existing.parent_company_id), "OM_CUSTOMER_CREATE", "EDIT");

    const updates: JsonRecord = {};
    if (body.parent_company_id !== undefined) {
      const newParentCompanyId = toTrimmedString(body.parent_company_id);
      if (!newParentCompanyId) return mm05Error(req, ctx, "MM05_INVALID_INPUT", 400, "parent_company_id cannot be empty.");
      await assertParentCompanyScope(ctx, newParentCompanyId, "OM_CUSTOMER_CREATE", "EDIT");
      updates.parent_company_id = newParentCompanyId;
    }
    if (body.code !== undefined) {
      const code = toTrimmedString(body.code);
      if (!code) return mm05Error(req, ctx, "MM05_INVALID_INPUT", 400, "code cannot be empty.");
      updates.code = code;
    }
    if (body.description !== undefined) updates.description = toTrimmedString(body.description) || null;
    if (body.address_line !== undefined) updates.address_line = toTrimmedString(body.address_line) || null;
    if (body.state !== undefined) {
      const stateValue = toTrimmedString(body.state);
      if (stateValue && !INDIAN_STATE_NAMES.has(stateValue)) {
        return mm05Error(req, ctx, "MM05_INVALID_STATE", 400, "State must be a valid Indian state.");
      }
      updates.state = stateValue || null;
    }
    if (body.pin_code !== undefined) updates.pin_code = toTrimmedString(body.pin_code) || null;
    if (body.gst_number !== undefined) updates.gst_number = toTrimmedString(body.gst_number) || null;
    if (Object.keys(updates).length === 0) {
      return mm05Error(req, ctx, "MM05_NO_CHANGES", 400, "No changes provided.");
    }
    updates.last_updated_by = ctx.auth_user_id;
    updates.last_updated_at = new Date().toISOString();

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("fg_depot_code")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) {
      if (isConstraint(error, "fg_depot_code_parent_company_id_code_key")) {
        return mm05Error(req, ctx, "MM05_DUPLICATE_DEPOT_CODE", 409, "This depot code already exists under the selected parent company.");
      }
      console.error("[mm05.updateDepotCode] update failed:", JSON.stringify(error));
      throw new Error("MM05_DEPOT_CODE_UPDATE_FAILED");
    }
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    return mapMutationError(req, ctx, error instanceof Error ? error.message : "MM05_DEPOT_CODE_UPDATE_FAILED", "Depot code update failed.");
  }
}

export async function createDispatchCustomerHandler(req: Request, ctx: OmHandlerContext): Promise<Response> {
  try {
    assertOmReadContext(ctx);
    const body = await parseBody(req);
    const name = toTrimmedString(body.name);
    const registrationType = toUpperTrimmedString(body.registration_type);
    const foCustomerType = normalizeFoCustomerType(body.fo_customer_type);
    const state = requireIndianState(req, ctx, body.state);
    if (state instanceof Response) return state;
    const fullAddress = toTrimmedString(body.full_address);
    if (!name || !REGISTRATION_TYPES.has(registrationType)) {
      return mm05Error(req, ctx, "MM05_INVALID_INPUT", 400, "name and registration_type are required.");
    }
    if (foCustomerType && !FO_TYPES.has(foCustomerType)) {
      return mm05Error(req, ctx, "OM_INVALID_FO_CUSTOMER_TYPE", 400, "Invalid FO customer type.");
    }
    if (!fullAddress) {
      return mm05Error(req, ctx, "MM05_INVALID_INPUT", 400, "full_address and state are required.");
    }
    const gstNumber = registrationType === "REGISTERED" ? (toTrimmedString(body.gst_number) || null) : null;
    if (registrationType === "REGISTERED" && !gstNumber) {
      return mm05Error(req, ctx, "MM05_INVALID_INPUT", 400, "gst_number is required for a registered dispatch customer.");
    }
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("fg_dispatch_customer")
      .insert({
        name,
        registration_type: registrationType,
        gst_number: gstNumber,
        fo_customer_type: foCustomerType || null,
        state,
        full_address: fullAddress,
        pin_code: toTrimmedString(body.pin_code) || null,
        status: "ACTIVE",
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();
    if (error || !data) {
      console.error("[mm05.createDispatchCustomer] insert failed:", JSON.stringify(error));
      throw new Error("MM05_CUSTOMER_CREATE_FAILED");
    }
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    return mapMutationError(req, ctx, error instanceof Error ? error.message : "MM05_CUSTOMER_CREATE_FAILED", "Dispatch customer create failed.");
  }
}

export async function upgradeDispatchCustomerToRegisteredHandler(req: Request, ctx: OmHandlerContext): Promise<Response> {
  try {
    assertOmReadContext(ctx);
    const customerId = getCustomerIdFromPath(req);
    const customer = customerId ? await getDispatchCustomerById(customerId) : null;
    if (!customer) return mm05Error(req, ctx, "MM05_CUSTOMER_NOT_FOUND", 404, "Dispatch customer not found.");
    const body = await parseBody(req);
    if (toUpperTrimmedString(customer.registration_type) === "REGISTERED") {
      return mm05Error(req, ctx, "MM05_REGISTRATION_ALREADY_REGISTERED", 409, "Customer is already registered.");
    }
    const gstNumber = toTrimmedString(body.gst_number);
    const overwriteFields = ((body.overwrite_fields ?? {}) as JsonRecord);
    const nextName = toTrimmedString(overwriteFields.name) || toTrimmedString(customer.name);
    const nextFoType = normalizeFoCustomerType(overwriteFields.fo_customer_type) || normalizeFoCustomerType(customer.fo_customer_type);
    if (nextFoType && !FO_TYPES.has(nextFoType)) {
      return mm05Error(req, ctx, "OM_INVALID_FO_CUSTOMER_TYPE", 400, "Invalid FO customer type.");
    }
    if (!gstNumber || !nextName) {
      return mm05Error(req, ctx, "MM05_INVALID_INPUT", 400, "gst_number and overwrite_fields.name are required for upgrade.");
    }

    const addressAction = toUpperTrimmedString(body.address_action);
    const targetAddressId = toTrimmedString(body.target_address_id);
    const depotCodeId = toTrimmedString(overwriteFields.depot_code_id);
    const addressLine = toTrimmedString(overwriteFields.address_line);
    const pinCode = toTrimmedString(overwriteFields.pin_code) || null;
    const state = requireIndianState(req, ctx, overwriteFields.state);
    if (state instanceof Response) return state;
    if (!DISPATCH_TYPES.has("DIRECT")) {
      throw new Error("MM05_INVALID_INPUT");
    }
    if (!["REPLACE", "ADD_NEW"].includes(addressAction) || !depotCodeId || !addressLine) {
      return mm05Error(req, ctx, "MM05_UPGRADE_ADDRESS_REQUIRED", 400, "Upgrade requires address_action plus depot, address, and state.");
    }
    const companyId = await getCompanyIdForDepotCode(depotCodeId);
    await assertCompanyScope(ctx, companyId);
    if (addressAction === "REPLACE" && !targetAddressId) {
      return mm05Error(req, ctx, "MM05_REPLACE_ADDRESS_REQUIRED", 400, "target_address_id is required when replacing an address.");
    }

    const updatedAt = new Date().toISOString();
    const { data: updatedCustomer, error: customerUpdateError } = await serviceRoleClient
      .schema("erp_master")
      .from("fg_dispatch_customer")
      .update({
        name: nextName,
        registration_type: "REGISTERED",
        gst_number: gstNumber,
        fo_customer_type: nextFoType || null,
        state,
        full_address: addressLine,
        pin_code: pinCode,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: updatedAt,
      })
      .eq("id", customerId)
      .select("*")
      .single();
    if (customerUpdateError || !updatedCustomer) {
      console.error("[mm05.upgradeDispatchCustomer.customerUpdate] update failed:", JSON.stringify(customerUpdateError));
      throw new Error("MM05_CUSTOMER_UPGRADE_FAILED");
    }

    if (addressAction === "REPLACE") {
      const address = await getAddressById(targetAddressId);
      if (!address || toTrimmedString(address.customer_id) !== customerId) {
        return mm05Error(req, ctx, "MM05_ADDRESS_NOT_FOUND", 404, "Selected address was not found for this customer.");
      }
      const { error: updateError } = await serviceRoleClient
        .schema("erp_master")
        .from("fg_dispatch_customer_address")
        .update({
          depot_code_id: depotCodeId,
          address_line: addressLine,
          state,
          pin_code: pinCode,
          last_updated_by: ctx.auth_user_id,
          last_updated_at: updatedAt,
        })
        .eq("id", targetAddressId);
      if (updateError) {
        const message = String((updateError as { message?: unknown }).message ?? "");
        if (message.includes("MM05_ADDRESS_REQUIRES_DIRECT_DEPOT")) {
          return mm05Error(req, ctx, "MM05_ADDRESS_REQUIRES_DIRECT_DEPOT", 400, "Customer addresses must point to a DIRECT-type depot code.");
        }
        if (message.includes("MM05_STATE_MISMATCH")) {
          return mm05Error(req, ctx, "MM05_STATE_MISMATCH", 400, "Address state must match the linked parent company's state.");
        }
        console.error("[mm05.upgradeDispatchCustomer.addressUpdate] update failed:", JSON.stringify(updateError));
        throw new Error("MM05_CUSTOMER_UPGRADE_FAILED");
      }
    } else {
      const { error: insertError } = await serviceRoleClient
        .schema("erp_master")
        .from("fg_dispatch_customer_address")
        .insert({
          customer_id: customerId,
          depot_code_id: depotCodeId,
          address_line: addressLine,
          state,
          pin_code: pinCode,
          created_by: ctx.auth_user_id,
        });
      if (insertError) {
        const message = String((insertError as { message?: unknown }).message ?? "");
        if (message.includes("MM05_ADDRESS_REQUIRES_DIRECT_DEPOT")) {
          return mm05Error(req, ctx, "MM05_ADDRESS_REQUIRES_DIRECT_DEPOT", 400, "Customer addresses must point to a DIRECT-type depot code.");
        }
        if (message.includes("MM05_STATE_MISMATCH")) {
          return mm05Error(req, ctx, "MM05_STATE_MISMATCH", 400, "Address state must match the linked parent company's state.");
        }
        console.error("[mm05.upgradeDispatchCustomer.addressInsert] insert failed:", JSON.stringify(insertError));
        throw new Error("MM05_CUSTOMER_UPGRADE_FAILED");
      }
    }

    return okResponse({ data: updatedCustomer }, ctx.request_id, req);
  } catch (error) {
    return mapMutationError(req, ctx, error instanceof Error ? error.message : "MM05_CUSTOMER_UPGRADE_FAILED", "Customer GST upgrade failed.");
  }
}

export async function addDispatchCustomerAddressHandler(req: Request, ctx: OmHandlerContext): Promise<Response> {
  try {
    assertOmReadContext(ctx);
    const customerId = getCustomerIdFromPath(req);
    const customer = customerId ? await getDispatchCustomerById(customerId) : null;
    if (!customer) return mm05Error(req, ctx, "MM05_CUSTOMER_NOT_FOUND", 404, "Dispatch customer not found.");
    const body = await parseBody(req);
    const depotCodeId = toTrimmedString(body.depot_code_id);
    const addressLine = toTrimmedString(body.address_line);
    const state = requireIndianState(req, ctx, body.state);
    if (state instanceof Response) return state;
    if (!depotCodeId || !addressLine) {
      return mm05Error(req, ctx, "MM05_INVALID_INPUT", 400, "depot_code_id, address_line, and state are required.");
    }
    const companyId = await getCompanyIdForDepotCode(depotCodeId);
    await assertCompanyScope(ctx, companyId);
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("fg_dispatch_customer_address")
      .insert({
        customer_id: customerId,
        depot_code_id: depotCodeId,
        address_line: addressLine,
        state,
        pin_code: toTrimmedString(body.pin_code) || null,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();
    if (error || !data) {
      const message = String((error as { message?: unknown })?.message ?? "");
      if (message.includes("MM05_ADDRESS_REQUIRES_DIRECT_DEPOT")) {
        return mm05Error(req, ctx, "MM05_ADDRESS_REQUIRES_DIRECT_DEPOT", 400, "Customer addresses must point to a DIRECT-type depot code.");
      }
      if (message.includes("MM05_STATE_MISMATCH")) {
        return mm05Error(req, ctx, "MM05_STATE_MISMATCH", 400, "Address state must match the linked parent company's state.");
      }
      console.error("[mm05.addDispatchCustomerAddress] insert failed:", JSON.stringify(error));
      throw new Error("MM05_ADDRESS_CREATE_FAILED");
    }
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    return mapMutationError(req, ctx, error instanceof Error ? error.message : "MM05_ADDRESS_CREATE_FAILED", "Dispatch customer address create failed.");
  }
}

export async function updateDispatchCustomerAddressHandler(req: Request, ctx: OmHandlerContext): Promise<Response> {
  try {
    assertOmReadContext(ctx);
    const addressId = getAddressIdFromPath(req);
    const existing = addressId ? await getAddressById(addressId) : null;
    if (!existing) return mm05Error(req, ctx, "MM05_ADDRESS_NOT_FOUND", 404, "Address not found.");
    const companyId = await getCompanyIdForAddress(addressId);
    await assertCompanyScope(ctx, companyId);
    const body = await parseBody(req);
    const depotCodeId = toTrimmedString(body.depot_code_id) || toTrimmedString(existing.depot_code_id);
    const state = body.state === undefined
      ? toTrimmedString(existing.state)
      : requireIndianState(req, ctx, body.state);
    if (state instanceof Response) return state;
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("fg_dispatch_customer_address")
      .update({
        depot_code_id: depotCodeId,
        address_line: body.address_line === undefined ? toTrimmedString(existing.address_line) : toTrimmedString(body.address_line),
        state,
        pin_code: body.pin_code === undefined ? (toTrimmedString(existing.pin_code) || null) : (toTrimmedString(body.pin_code) || null),
        last_updated_by: ctx.auth_user_id,
        last_updated_at: new Date().toISOString(),
      })
      .eq("id", addressId)
      .select("*")
      .single();
    if (error || !data) {
      const message = String((error as { message?: unknown })?.message ?? "");
      if (message.includes("MM05_ADDRESS_REQUIRES_DIRECT_DEPOT")) {
        return mm05Error(req, ctx, "MM05_ADDRESS_REQUIRES_DIRECT_DEPOT", 400, "Customer addresses must point to a DIRECT-type depot code.");
      }
      if (message.includes("MM05_STATE_MISMATCH")) {
        return mm05Error(req, ctx, "MM05_STATE_MISMATCH", 400, "Address state must match the linked parent company's state.");
      }
      console.error("[mm05.updateDispatchCustomerAddress] update failed:", JSON.stringify(error));
      throw new Error("MM05_ADDRESS_UPDATE_FAILED");
    }
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    return mapMutationError(req, ctx, error instanceof Error ? error.message : "MM05_ADDRESS_UPDATE_FAILED", "Dispatch customer address update failed.");
  }
}

export async function listDispatchCustomerAddressesHandler(req: Request, ctx: OmHandlerContext): Promise<Response> {
  try {
    assertOmReadContext(ctx);
    const customerId = getCustomerIdFromPath(req);
    const customer = customerId ? await getDispatchCustomerById(customerId) : null;
    if (!customer) return mm05Error(req, ctx, "MM05_CUSTOMER_NOT_FOUND", 404, "Dispatch customer not found.");
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("fg_dispatch_customer_address")
      .select("id, customer_id, depot_code_id, address_line, state, pin_code, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: true });
    if (error) throw new Error("MM05_ADDRESS_LIST_FAILED");
    const rows = (data ?? []) as JsonRecord[];
    const depotIds = [...new Set(rows.map((row) => toTrimmedString(row.depot_code_id)).filter(Boolean))];
    const { data: depotRows, error: depotError } = depotIds.length
      ? await serviceRoleClient
        .schema("erp_master")
        .from("fg_depot_code")
        .select("id, code, description, parent_company_id")
        .in("id", depotIds)
      : { data: [], error: null };
    if (depotError) throw new Error("MM05_ADDRESS_LIST_FAILED");
    const depotMap = new Map<string, JsonRecord>();
    for (const row of ((depotRows ?? []) as JsonRecord[])) depotMap.set(toTrimmedString(row.id), row);
    const parentIds = [...new Set(((depotRows ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.parent_company_id)).filter(Boolean))];
    const { data: parentRows, error: parentError } = parentIds.length
      ? await serviceRoleClient
        .schema("erp_master")
        .from("fg_parent_company")
        .select("id, company_name, state")
        .in("id", parentIds)
      : { data: [], error: null };
    if (parentError) throw new Error("MM05_ADDRESS_LIST_FAILED");
    const parentMap = new Map<string, JsonRecord>();
    for (const row of ((parentRows ?? []) as JsonRecord[])) parentMap.set(toTrimmedString(row.id), row);

    const firstDepot = depotIds[0];
    if (firstDepot) {
      const firstCompanyId = await getCompanyIdForDepotCode(firstDepot);
      await assertCompanyScope(ctx, firstCompanyId);
    }

    return okResponse({
      data: rows.map((row) => {
        const depot = depotMap.get(toTrimmedString(row.depot_code_id));
        const parent = depot ? parentMap.get(toTrimmedString(depot.parent_company_id)) : null;
        return {
          ...row,
          parent_company_id: parent ? toTrimmedString(parent.id) : null,
          depot_code: depot ? toTrimmedString(depot.code) : null,
          depot_description: depot ? toTrimmedString(depot.description) || null : null,
          parent_company_name: parent ? toTrimmedString(parent.company_name) : null,
          parent_company_state: parent ? toTrimmedString(parent.state) : null,
        };
      }),
    }, ctx.request_id, req);
  } catch (error) {
    return mapMutationError(req, ctx, error instanceof Error ? error.message : "MM05_ADDRESS_LIST_FAILED", "Dispatch customer address list failed.");
  }
}
