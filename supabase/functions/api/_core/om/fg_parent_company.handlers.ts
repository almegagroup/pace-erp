/*
 * File-ID: 27.27-BE / 132-G
 * File-Path: supabase/functions/api/_core/om/fg_parent_company.handlers.ts
 * Gate: 27.27, feasibility §129/§132
 * Domain: OM MASTERS
 * Purpose: Parent Company + Virtual/Depot Code (VDC/DC) CRUD -- shared by
 *          MM04's Customer Master (§129 Address -> VDC -> Parent Company
 *          Bill-To/Ship-To chain, and §132's polymorphic Ship-To resolution,
 *          not yet built). Originally lived in fg_dispatch_customer.handlers.ts
 *          alongside the (now-retired) MM05 Dispatch Customer CRUD -- split
 *          out and renamed 2026-08-27 when MM05 was fully retired (§132.5
 *          point 6), since this Parent-Company/VDC code stays live and was
 *          never part of what got retired.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { INDIAN_STATE_NAMES } from "../../_shared/indianStates.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { OmHandlerContext } from "./shared.ts";
import { assertOmReadContext } from "./shared.ts";

type JsonRecord = Record<string, unknown>;

const DISPATCH_TYPES = new Set(["DIRECT", "DEPOT"]);

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
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

function mapMutationError(req: Request, ctx: OmHandlerContext, code: string, fallbackMessage: string): Response {
  switch (code) {
    case "COMPANY_SCOPE_VIOLATION":
      return mm05Error(req, ctx, code, 403, "You do not have access to this company.");
    case "MM05_PARENT_COMPANY_NOT_FOUND":
    case "MM05_DEPOT_CODE_NOT_FOUND":
      return mm05Error(req, ctx, code, 404, fallbackMessage);
    case "MM05_INVALID_STATE":
    case "MM05_INVALID_INPUT":
    case "MM05_DEPOT_ADDRESS_REQUIRED":
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

// Parent Company is a global master (feasibility §129, corrected 2026-08-27
// per business owner: no per-company mapping -- a Parent Company/VDC/DC
// exists once and is usable from every company). This search-by-GST lookup
// lets the create form warn "this already exists, use it" instead of
// letting a typo create a second row for the same real-world GST.
export async function findFgParentCompanyByGstHandler(req: Request, ctx: OmHandlerContext): Promise<Response> {
  try {
    assertOmReadContext(ctx);
    const gstNumber = toTrimmedString(new URL(req.url).searchParams.get("gst_number")).toUpperCase();
    if (!gstNumber) {
      return mm05Error(req, ctx, "MM05_INVALID_INPUT", 400, "gst_number is required.");
    }
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("fg_parent_company")
      .select("id, company_name, state, gst_number, full_address, pin_code, status")
      .eq("gst_number", gstNumber)
      .eq("status", "ACTIVE");
    if (error) throw new Error("MM05_PARENT_COMPANY_LOOKUP_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    return mapMutationError(req, ctx, error instanceof Error ? error.message : "MM05_PARENT_COMPANY_LOOKUP_FAILED", "Parent company GST lookup failed.");
  }
}

// Global master list -- every ACTIVE Parent Company, optionally filtered by
// state. No company scoping: Parent Company/VDC/DC are not per-company
// records (feasibility §129, corrected 2026-08-27).
export async function listParentCompaniesHandler(req: Request, ctx: OmHandlerContext): Promise<Response> {
  try {
    assertOmReadContext(ctx);
    const url = new URL(req.url);
    const state = toTrimmedString(url.searchParams.get("state"));

    let query = serviceRoleClient
      .schema("erp_master")
      .from("fg_parent_company")
      .select("id, company_id, company_name, gst_number, state, full_address, pin_code, status, created_at")
      .eq("status", "ACTIVE")
      .order("company_name", { ascending: true })
      .order("state", { ascending: true });
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
    if (!(await getParentCompanyById(parentCompanyId))) {
      return mm05Error(req, ctx, "MM05_PARENT_COMPANY_NOT_FOUND", 404, "Parent company not found.");
    }
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
        // §133.20 (2026-09-01): VDC (DIRECT) now carries its own address too,
        // same as DC (DEPOT) -- the trigger enforces both mandatory + state-
        // must-match-parent uniformly, no more type-branching here.
        address_line: toTrimmedString(body.address_line) || null,
        state: stateValue || null,
        pin_code: toTrimmedString(body.pin_code) || null,
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
        return mm05Error(req, ctx, "MM05_DEPOT_ADDRESS_REQUIRED", 400, "VDC/DC code requires address and state.");
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

// Global master list -- every ACTIVE VDC/DC, optionally filtered by its
// Parent Company or dispatch type. No company scoping: a VDC/DC belongs to
// exactly one Parent Company (never many), and Parent Company itself is a
// global master, not per-company (feasibility §129, corrected 2026-08-27).
export async function listDepotCodesHandler(req: Request, ctx: OmHandlerContext): Promise<Response> {
  try {
    assertOmReadContext(ctx);
    const url = new URL(req.url);
    const parentCompanyId = toTrimmedString(url.searchParams.get("parent_company_id"));
    const dispatchType = toUpperTrimmedString(url.searchParams.get("dispatch_type"));

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
    if (!(await getParentCompanyById(id))) {
      return mm05Error(req, ctx, "MM05_PARENT_COMPANY_NOT_FOUND", 404, "Parent company not found.");
    }

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

    const updates: JsonRecord = {};
    if (body.parent_company_id !== undefined) {
      const newParentCompanyId = toTrimmedString(body.parent_company_id);
      if (!newParentCompanyId) return mm05Error(req, ctx, "MM05_INVALID_INPUT", 400, "parent_company_id cannot be empty.");
      if (!(await getParentCompanyById(newParentCompanyId))) {
        return mm05Error(req, ctx, "MM05_PARENT_COMPANY_NOT_FOUND", 404, "Parent company not found.");
      }
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
      // Same trigger-message handling as createOrGetDepotCodeHandler -- this
      // handler previously fell straight to the generic 500 below for these.
      const message = String((error as { message?: unknown })?.message ?? "");
      if (message.includes("MM05_DEPOT_ADDRESS_REQUIRED")) {
        return mm05Error(req, ctx, "MM05_DEPOT_ADDRESS_REQUIRED", 400, "VDC/DC code requires address and state.");
      }
      if (message.includes("MM05_STATE_MISMATCH")) {
        return mm05Error(req, ctx, "MM05_STATE_MISMATCH", 400, "Depot address state must match the selected parent company's state.");
      }
      console.error("[mm05.updateDepotCode] update failed:", JSON.stringify(error));
      throw new Error("MM05_DEPOT_CODE_UPDATE_FAILED");
    }
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    return mapMutationError(req, ctx, error instanceof Error ? error.message : "MM05_DEPOT_CODE_UPDATE_FAILED", "Depot code update failed.");
  }
}
