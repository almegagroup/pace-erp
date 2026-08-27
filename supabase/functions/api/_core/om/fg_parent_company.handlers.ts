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
import { assertCompanyScope, isCompanyScopeAdminBypass } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { INDIAN_STATE_NAMES } from "../../_shared/indianStates.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { OmHandlerContext } from "./shared.ts";
import { assertOmReadContext } from "./shared.ts";
import { getCallerCompanyIds } from "./customer.handlers.ts";

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
  if (isCompanyScopeAdminBypass(ctx)) return;
  // §129 correction (2026-08-22) -- scope now comes from
  // fg_parent_company_company_map (many-to-many), not the single
  // fg_parent_company.company_id column, so a Parent Company shared across
  // companies grants access via ANY of its mapped companies the caller also
  // belongs to -- same intersection pattern as assertCustomerCompanyScope.
  const mappedCompanyIds = await getParentCompanyMappedCompanyIds(parentCompanyId);
  if (mappedCompanyIds.length === 0) throw new Error("COMPANY_SCOPE_VIOLATION");
  const callerCompanyIds = await getCallerCompanyIds(ctx);
  const candidateCompanyIds = mappedCompanyIds.filter((id) => callerCompanyIds.includes(id));
  if (candidateCompanyIds.length === 0) throw new Error("COMPANY_SCOPE_VIOLATION");
  const decisions = await Promise.all(
    candidateCompanyIds.map((companyId) => canMaintainCompanyResource(ctx, companyId, resourceCode, actionCode)),
  );
  if (!decisions.some(Boolean)) throw new Error("COMPANY_SCOPE_VIOLATION");
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
    case "MM05_DIRECT_DEPOT_INLINE_ADDRESS_FORBIDDEN":
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

// §129 correction (2026-08-22) -- a real-world Bill-To entity must be
// shareable across PACE companies without duplicating the row, or every
// company that later needs the same Parent Company would have to recreate
// it. Mirrors customer_master's own customer_company_map pattern exactly.
async function getParentCompanyMappedCompanyIds(parentCompanyId: string): Promise<string[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("fg_parent_company_company_map")
    .select("company_id")
    .eq("parent_company_id", parentCompanyId)
    .eq("active", true);
  if (error) throw new Error("MM05_PARENT_COMPANY_LOOKUP_FAILED");
  return [...new Set<string>((data ?? []).map((row: JsonRecord) => String(row.company_id)))];
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

    // Seed this Parent Company's first company mapping -- the creating
    // company is always mapped, other companies join later via
    // mapFgParentCompanyToCompanyHandler (reuse, not duplication).
    const { error: mapError } = await serviceRoleClient
      .schema("erp_master")
      .from("fg_parent_company_company_map")
      .insert({ parent_company_id: data.id, company_id: companyId, active: true });
    if (mapError) {
      console.error("[mm05.createParentCompany] company map insert failed:", JSON.stringify(mapError));
      await serviceRoleClient.schema("erp_master").from("fg_parent_company").delete().eq("id", data.id);
      throw new Error("MM05_PARENT_COMPANY_COMPANY_MAP_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    return mapMutationError(req, ctx, error instanceof Error ? error.message : "MM05_PARENT_COMPANY_CREATE_FAILED", "Parent company create failed.");
  }
}

// §129 correction (2026-08-22) -- lets a company search for an EXISTING
// Parent Company (by GST, across every company) before creating a
// duplicate. Deliberately bypasses the caller's own company-scope filter --
// finding a cross-company match is the entire point, and the result only
// exposes business master data (name/state/GST), not anything sensitive.
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
    const rows = (data ?? []) as JsonRecord[];
    if (rows.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    // §8A/§8E — bulk-resolve which companies each match is already mapped to.
    const parentIds = rows.map((r) => String(r.id));
    const { data: maps, error: mapErr } = await serviceRoleClient
      .schema("erp_master")
      .from("fg_parent_company_company_map")
      .select("parent_company_id, companies:company_id(company_code, company_name)")
      .in("parent_company_id", parentIds)
      .eq("active", true);
    if (mapErr) throw new Error("MM05_PARENT_COMPANY_LOOKUP_FAILED");
    const companiesByParent = new Map<string, JsonRecord[]>();
    for (const m of (maps ?? []) as JsonRecord[]) {
      const key = String(m.parent_company_id);
      const list = companiesByParent.get(key) ?? [];
      list.push(m.companies as JsonRecord);
      companiesByParent.set(key, list);
    }
    const enriched = rows.map((row) => ({ ...row, mapped_companies: companiesByParent.get(String(row.id)) ?? [] }));
    return okResponse({ data: enriched }, ctx.request_id, req);
  } catch (error) {
    return mapMutationError(req, ctx, error instanceof Error ? error.message : "MM05_PARENT_COMPANY_LOOKUP_FAILED", "Parent company GST lookup failed.");
  }
}

// §129 correction (2026-08-22) -- adds the CALLER's own company to an
// EXISTING Parent Company's mapping instead of creating a duplicate row.
// Authorization is deliberately NOT via assertParentCompanyScope (that
// checks the parent's EXISTING mapped companies, which by definition
// doesn't yet include the caller) -- it's a plain WRITE-tier check at the
// company being newly added, same shape as mapCustomerToCompanyHandler.
export async function mapFgParentCompanyToCompanyHandler(req: Request, ctx: OmHandlerContext): Promise<Response> {
  try {
    assertOmReadContext(ctx);
    const body = await parseBody(req);
    const parentCompanyId = toTrimmedString(body.parent_company_id);
    const companyId = toTrimmedString(body.company_id);
    if (!parentCompanyId || !companyId) {
      return mm05Error(req, ctx, "MM05_INVALID_INPUT", 400, "parent_company_id and company_id are required.");
    }
    if (!(await getParentCompanyById(parentCompanyId))) {
      return mm05Error(req, ctx, "MM05_PARENT_COMPANY_NOT_FOUND", 404, "Parent company not found.");
    }
    if (!(await ensureCompanyExists(companyId))) {
      return mm05Error(req, ctx, "OM_COMPANY_NOT_FOUND", 404, "Company not found.");
    }
    if (!isCompanyScopeAdminBypass(ctx)) {
      await assertCompanyScope(ctx, companyId);
      const allowed = await canMaintainCompanyResource(ctx, companyId, "OM_CUSTOMER_CREATE", "WRITE");
      if (!allowed) throw new Error("COMPANY_SCOPE_VIOLATION");
    }
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("fg_parent_company_company_map")
      .upsert({ parent_company_id: parentCompanyId, company_id: companyId, active: true }, { onConflict: "parent_company_id,company_id" })
      .select("*")
      .single();
    if (error || !data) {
      console.error("[mm05.mapFgParentCompanyToCompany] upsert failed:", JSON.stringify(error));
      throw new Error("MM05_PARENT_COMPANY_COMPANY_MAP_FAILED");
    }
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    return mapMutationError(req, ctx, error instanceof Error ? error.message : "MM05_PARENT_COMPANY_COMPANY_MAP_FAILED", "Parent company mapping failed.");
  }
}

export async function listParentCompaniesHandler(req: Request, ctx: OmHandlerContext): Promise<Response> {
  try {
    assertOmReadContext(ctx);
    const url = new URL(req.url);
    const state = toTrimmedString(url.searchParams.get("state"));

    // §129 default: only Parent Companies mapped to one of the CALLER's own
    // companies -- never a blended cross-company list (business owner's own
    // explicit worry, 2026-08-22). Cross-company discovery goes through
    // findFgParentCompanyByGstHandler instead, not this default list.
    const requestedCompanyId = toTrimmedString(url.searchParams.get("company_id"));
    let scopedParentIds: string[] | null = null;
    if (requestedCompanyId) {
      await getCompanyScope(ctx, requestedCompanyId);
      const { data: maps, error: mapErr } = await serviceRoleClient
        .schema("erp_master")
        .from("fg_parent_company_company_map")
        .select("parent_company_id")
        .eq("company_id", requestedCompanyId)
        .eq("active", true);
      if (mapErr) throw new Error("MM05_PARENT_COMPANY_LIST_FAILED");
      scopedParentIds = [...new Set<string>((maps ?? []).map((row: JsonRecord) => String(row.parent_company_id)))];
    } else if (!isCompanyScopeAdminBypass(ctx)) {
      const callerCompanyIds = await getCallerCompanyIds(ctx);
      if (callerCompanyIds.length === 0) return okResponse({ data: [] }, ctx.request_id, req);
      const { data: maps, error: mapErr } = await serviceRoleClient
        .schema("erp_master")
        .from("fg_parent_company_company_map")
        .select("parent_company_id")
        .in("company_id", callerCompanyIds)
        .eq("active", true);
      if (mapErr) throw new Error("MM05_PARENT_COMPANY_LIST_FAILED");
      scopedParentIds = [...new Set<string>((maps ?? []).map((row: JsonRecord) => String(row.parent_company_id)))];
    }
    if (scopedParentIds !== null && scopedParentIds.length === 0) {
      return okResponse({ data: [] }, ctx.request_id, req);
    }

    if (scopedParentIds === null) {
      // Admin bypass with no explicit company_id filter -- sees everything.
      const { data, error } = await serviceRoleClient
        .schema("erp_master")
        .from("fg_parent_company")
        .select("id, company_id, company_name, gst_number, state, full_address, pin_code, status, created_at")
        .eq("status", "ACTIVE")
        .order("company_name", { ascending: true })
        .order("state", { ascending: true });
      if (error) throw new Error("MM05_PARENT_COMPANY_LIST_FAILED");
      const rows = (state ? (data ?? []).filter((r: JsonRecord) => r.state === state) : data) ?? [];
      return okResponse({ data: rows }, ctx.request_id, req);
    }

    // §8E — scopedParentIds comes from a live mapping query, not a bounded
    // constant, so it must be chunked rather than a single raw .in().
    let rows: JsonRecord[];
    try {
      rows = await fetchInChunks<JsonRecord>(scopedParentIds, (idChunk) => {
        let chunkQuery = serviceRoleClient
          .schema("erp_master")
          .from("fg_parent_company")
          .select("id, company_id, company_name, gst_number, state, full_address, pin_code, status, created_at")
          .eq("status", "ACTIVE")
          .in("id", idChunk);
        if (state) chunkQuery = chunkQuery.eq("state", state);
        return chunkQuery;
      });
    } catch {
      throw new Error("MM05_PARENT_COMPANY_LIST_FAILED");
    }
    rows.sort((a, b) => String(a.company_name).localeCompare(String(b.company_name)) || String(a.state).localeCompare(String(b.state)));
    return okResponse({ data: rows }, ctx.request_id, req);
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

    // §132-VDC-list-scope fix (2026-08-27) -- without an explicit
    // parent_company_id filter this previously returned EVERY company's
    // VDC/DC rows unscoped (bug pattern #2). A caller in one company could
    // see (but never edit -- assertParentCompanyScope on the write side
    // correctly blocks it) another company's VDC, including one whose Parent
    // Company duplicate-named row isn't in their own scoped Parent Company
    // list at all (shows up as a blank "Parent Company" column client-side).
    // Mirrors listParentCompaniesHandler's own scoping exactly.
    let scopedParentIds: string[] | null = null;
    if (!parentCompanyId && !isCompanyScopeAdminBypass(ctx)) {
      const callerCompanyIds = await getCallerCompanyIds(ctx);
      if (callerCompanyIds.length === 0) return okResponse({ data: [] }, ctx.request_id, req);
      const { data: maps, error: mapErr } = await serviceRoleClient
        .schema("erp_master")
        .from("fg_parent_company_company_map")
        .select("parent_company_id")
        .in("company_id", callerCompanyIds)
        .eq("active", true);
      if (mapErr) throw new Error("MM05_DEPOT_CODE_LIST_FAILED");
      scopedParentIds = [...new Set<string>((maps ?? []).map((row: JsonRecord) => String(row.parent_company_id)))];
      if (scopedParentIds.length === 0) return okResponse({ data: [] }, ctx.request_id, req);
    }

    const baseSelect = "id, parent_company_id, dispatch_type, code, description, address_line, state, pin_code, gst_number, status, created_at";
    let rows: JsonRecord[];
    if (scopedParentIds !== null) {
      // §8E — scopedParentIds comes from a live mapping query, not a bounded
      // constant, so it must be chunked rather than a single raw .in().
      try {
        rows = await fetchInChunks<JsonRecord>(scopedParentIds, (idChunk) => {
          let chunkQuery = serviceRoleClient
            .schema("erp_master")
            .from("fg_depot_code")
            .select(baseSelect)
            .eq("status", "ACTIVE")
            .in("parent_company_id", idChunk);
          if (dispatchType) chunkQuery = chunkQuery.eq("dispatch_type", dispatchType);
          return chunkQuery;
        });
      } catch {
        throw new Error("MM05_DEPOT_CODE_LIST_FAILED");
      }
    } else {
      // Explicit parent_company_id filter (already scope-checked above) or
      // admin bypass with no filter -- both are a single, bounded query.
      let query = serviceRoleClient
        .schema("erp_master")
        .from("fg_depot_code")
        .select(baseSelect)
        .eq("status", "ACTIVE");
      if (parentCompanyId) query = query.eq("parent_company_id", parentCompanyId);
      if (dispatchType) query = query.eq("dispatch_type", dispatchType);
      const { data, error } = await query;
      if (error) throw new Error("MM05_DEPOT_CODE_LIST_FAILED");
      rows = (data ?? []) as JsonRecord[];
    }
    rows.sort((a, b) => String(a.code ?? "").localeCompare(String(b.code ?? "")));
    return okResponse({ data: rows }, ctx.request_id, req);
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

    // 2026-08-22 fix — validate_fg_depot_code_row (DB trigger) hard-requires
    // DIRECT (VDC) rows to carry NULL address_line/state/pin_code; the create
    // path (createOrGetDepotCodeHandler) already forces this, but this update
    // path never did, so editing a VDC with any of these set (even a stale
    // value carried over from the form) hit the trigger's raised exception
    // unhandled below and surfaced as a bare 500. dispatch_type itself is
    // immutable via this handler, so the EXISTING row's type is authoritative.
    const effectiveDispatchType = toUpperTrimmedString(existing.dispatch_type);
    if (effectiveDispatchType === "DIRECT") {
      if (updates.address_line !== undefined) updates.address_line = null;
      if (updates.state !== undefined) updates.state = null;
      if (updates.pin_code !== undefined) updates.pin_code = null;
    }

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
        return mm05Error(req, ctx, "MM05_DEPOT_ADDRESS_REQUIRED", 400, "Depot-type code requires address and state.");
      }
      if (message.includes("MM05_DIRECT_DEPOT_INLINE_ADDRESS_FORBIDDEN")) {
        return mm05Error(req, ctx, "MM05_DIRECT_DEPOT_INLINE_ADDRESS_FORBIDDEN", 400, "Direct-type depot code cannot store inline address fields.");
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
