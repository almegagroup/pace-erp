/*
 * File-Path: supabase/functions/api/_core/production/vendor_code.handlers.ts
 * Gate: 27.27
 * Purpose: Asian-Paints-assigned "Vendor Code" (feasibility §140). SA creates
 *          the global vendor_code_master list; the Accounts ACL "Company
 *          Vendor Code" page (AC11) lets each company pick which of those
 *          apply to it, choose exactly one Primary, and override specific
 *          Prodshade+Stroke combinations onto a non-primary vendor code.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import { assertSARole, parseBody, toTrimmedString } from "./production.shared.ts";

type Row = Record<string, unknown>;

function vcError(req: Request, ctx: ProdHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

async function requireVendorCodeAction(req: Request, ctx: ProdHandlerContext, companyId: string, action: "VIEW" | "WRITE"): Promise<Response | null> {
  const allowed = await canMaintainCompanyResource(ctx, companyId, "ACC_COMPANY_VENDOR_CODE", action);
  return allowed ? null : vcError(req, ctx, "VENDOR_CODE_COMPANY_ACTION_FORBIDDEN", 403, "You do not have this Company Vendor Code action for the selected company.");
}

function ids(input: unknown): string[] {
  return [...new Set((Array.isArray(input) ? input : []).map(toTrimmedString).filter(Boolean))];
}

// ---------------------------------------------------------------------------
// SA -- global vendor_code_master CRUD. Every ACL company later picks from
// this same list; the code itself is never company-scoped, since Asian
// Paints can assign the identical code to more than one PACE company.
// ---------------------------------------------------------------------------

export async function listVendorCodesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const { data, error } = await serviceRoleClient.schema("erp_production")
      .from("vendor_code_master").select("*").order("vendor_code");
    if (error) throw new Error("VENDOR_CODE_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "VENDOR_CODE_LIST_FAILED";
    return vcError(req, ctx, code, code === "PROD_SA_REQUIRED" ? 403 : 500, "Unable to load vendor codes.");
  }
}

export async function createVendorCodeHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const body = await parseBody(req);
    const vendorCode = toTrimmedString(body.vendor_code).toUpperCase();
    const description = toTrimmedString(body.description) || null;
    if (!vendorCode) return vcError(req, ctx, "VENDOR_CODE_INVALID", 400, "vendor_code is required.");
    const { data, error } = await serviceRoleClient.schema("erp_production").from("vendor_code_master")
      .insert({ vendor_code: vendorCode, description, created_by: ctx.auth_user_id }).select("*").single();
    if (error) return vcError(req, ctx, error.code === "23505" ? "VENDOR_CODE_EXISTS" : "VENDOR_CODE_CREATE_FAILED", error.code === "23505" ? 409 : 500, "Unable to create vendor code.");
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "VENDOR_CODE_CREATE_FAILED";
    return vcError(req, ctx, code, code === "PROD_SA_REQUIRED" ? 403 : 500, "Unable to create vendor code.");
  }
}

function pathId(req: Request, segment: string): string {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const index = parts.indexOf(segment);
  return index >= 0 ? toTrimmedString(parts[index + 1]) : "";
}

export async function updateVendorCodeHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const vendorCodeId = pathId(req, "vendor-codes");
    if (!vendorCodeId) return vcError(req, ctx, "VENDOR_CODE_INVALID", 400, "Vendor code id is required.");
    const body = await parseBody(req);
    const updates: Row = { last_updated_by: ctx.auth_user_id, last_updated_at: new Date().toISOString() };
    if (body.description !== undefined) updates.description = toTrimmedString(body.description) || null;
    if (typeof body.active === "boolean") updates.active = body.active;
    const { data, error } = await serviceRoleClient.schema("erp_production").from("vendor_code_master")
      .update(updates).eq("id", vendorCodeId).select("*").maybeSingle();
    if (error || !data) return vcError(req, ctx, "VENDOR_CODE_NOT_FOUND", 404, "Vendor code not found.");
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "VENDOR_CODE_UPDATE_FAILED";
    return vcError(req, ctx, code, code === "PROD_SA_REQUIRED" ? 403 : 500, "Unable to update vendor code.");
  }
}

// ---------------------------------------------------------------------------
// ACL (Accounts, AC11 "Company Vendor Code") -- company-scoped workspace:
// which global vendor codes this company has mapped, which one is Primary,
// which are still available to add, and every Prodshade+Stroke override.
// ---------------------------------------------------------------------------

async function companyScope(ctx: ProdHandlerContext, requested?: string): Promise<string> {
  const companyId = toTrimmedString(requested) || toTrimmedString(ctx.context.companyId);
  if (companyId) await assertCompanyScope(ctx, companyId);
  return companyId;
}

export async function getCompanyVendorCodeWorkspaceHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await companyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    if (!companyId) return vcError(req, ctx, "VENDOR_CODE_COMPANY_REQUIRED", 400, "company_id is required.");
    const accessError = await requireVendorCodeAction(req, ctx, companyId, "VIEW"); if (accessError) return accessError;

    const db = serviceRoleClient.schema("erp_production");
    const [{ data: allCodes, error: codesError }, { data: maps, error: mapsError }] = await Promise.all([
      db.from("vendor_code_master").select("*").eq("active", true).order("vendor_code"),
      db.from("company_vendor_code_map").select("*").eq("company_id", companyId).eq("active", true),
    ]);
    if (codesError || mapsError) throw new Error("VENDOR_CODE_WORKSPACE_LOAD_FAILED");

    const codeById = new Map(((allCodes ?? []) as Row[]).map((row) => [toTrimmedString(row.id), row]));
    const mappedRows = (maps ?? []) as Row[];
    const mappedCodeIds = new Set(mappedRows.map((row) => toTrimmedString(row.vendor_code_id)));

    const mapIds = ids(mappedRows.map((row) => row.id));
    const { data: overrides, error: overridesError } = mapIds.length
      ? await db.from("vendor_code_stroke_override").select("*").eq("company_id", companyId).eq("active", true).in("company_vendor_code_map_id", mapIds)
      : { data: [], error: null };
    if (overridesError) throw new Error("VENDOR_CODE_WORKSPACE_LOAD_FAILED");

    const strokeIds = ids((overrides ?? []).map((row: Row) => row.stroke_master_id));
    const strokeRows = strokeIds.length
      ? await fetchInChunks<Row>(strokeIds, (chunk) => db.from("stroke_master").select("id, stroke_number, prodshade_material_id").in("id", chunk))
      : [];
    const strokeById = new Map(strokeRows.map((row) => [toTrimmedString(row.id), row]));
    const prodshadeIds = ids(strokeRows.map((row) => row.prodshade_material_id));
    const prodshades = prodshadeIds.length
      ? await fetchInChunks<Row>(prodshadeIds, (chunk) => serviceRoleClient.schema("erp_master").from("material_master").select("id, pace_code, material_name").in("id", chunk))
      : [];
    const prodshadeById = new Map(prodshades.map((row) => [toTrimmedString(row.id), row]));

    const mapped = mappedRows.map((row) => {
      const vendorCode = codeById.get(toTrimmedString(row.vendor_code_id));
      return {
        map_id: row.id, vendor_code_id: row.vendor_code_id,
        vendor_code: vendorCode?.vendor_code ?? null, description: vendorCode?.description ?? null,
        is_primary: Boolean(row.is_primary),
      };
    });
    const available = ((allCodes ?? []) as Row[]).filter((row) => !mappedCodeIds.has(toTrimmedString(row.id)));
    const mapLabelById = new Map(mapped.map((row) => [toTrimmedString(row.map_id), row]));
    const overrideRows = ((overrides ?? []) as Row[]).map((row) => {
      const stroke = strokeById.get(toTrimmedString(row.stroke_master_id));
      const prodshade = stroke ? prodshadeById.get(toTrimmedString(stroke.prodshade_material_id)) : undefined;
      const map = mapLabelById.get(toTrimmedString(row.company_vendor_code_map_id));
      return {
        id: row.id, company_vendor_code_map_id: row.company_vendor_code_map_id,
        vendor_code: map?.vendor_code ?? null,
        stroke_master_id: row.stroke_master_id, stroke_number: stroke?.stroke_number ?? null,
        prodshade_material_id: stroke?.prodshade_material_id ?? null,
        prodshade_name: prodshade ? `${prodshade.pace_code ?? "-"} — ${prodshade.material_name ?? ""}`.trim() : null,
      };
    });

    return okResponse({ data: { mapped, available, overrides: overrideRows } }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "VENDOR_CODE_WORKSPACE_LOAD_FAILED";
    return vcError(req, ctx, code, 500, "Unable to load Company Vendor Code workspace.");
  }
}

export async function mapCompanyVendorCodeHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await companyScope(ctx, toTrimmedString(body.company_id));
    const vendorCodeId = toTrimmedString(body.vendor_code_id);
    if (!companyId || !vendorCodeId) return vcError(req, ctx, "VENDOR_CODE_MAP_INVALID", 400, "company_id and vendor_code_id are required.");
    const accessError = await requireVendorCodeAction(req, ctx, companyId, "WRITE"); if (accessError) return accessError;

    const db = serviceRoleClient.schema("erp_production");
    // The company's first-ever mapped vendor code becomes Primary
    // automatically -- a company can never be left with zero Primary just
    // because nobody explicitly picked one yet.
    const { count: existingCount, error: countError } = await db.from("company_vendor_code_map")
      .select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("active", true);
    if (countError) throw new Error("VENDOR_CODE_MAP_FAILED");
    const { data, error } = await db.from("company_vendor_code_map").insert({
      company_id: companyId, vendor_code_id: vendorCodeId, is_primary: (existingCount ?? 0) === 0,
      created_by: ctx.auth_user_id,
    }).select("*").single();
    if (error) return vcError(req, ctx, error.code === "23505" ? "VENDOR_CODE_ALREADY_MAPPED" : "VENDOR_CODE_MAP_FAILED", error.code === "23505" ? 409 : 500, "Unable to map vendor code to this company.");
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "VENDOR_CODE_MAP_FAILED";
    return vcError(req, ctx, code, 500, "Unable to map vendor code to this company.");
  }
}

export async function setCompanyVendorCodePrimaryHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await companyScope(ctx, toTrimmedString(body.company_id));
    const mapId = toTrimmedString(body.map_id);
    if (!companyId || !mapId) return vcError(req, ctx, "VENDOR_CODE_PRIMARY_INVALID", 400, "company_id and map_id are required.");
    const accessError = await requireVendorCodeAction(req, ctx, companyId, "WRITE"); if (accessError) return accessError;

    const db = serviceRoleClient.schema("erp_production");
    const { data: target, error: targetError } = await db.from("company_vendor_code_map")
      .select("id").eq("id", mapId).eq("company_id", companyId).eq("active", true).maybeSingle();
    if (targetError) throw new Error("VENDOR_CODE_PRIMARY_FAILED");
    if (!target) return vcError(req, ctx, "VENDOR_CODE_MAP_NOT_FOUND", 404, "This vendor code is not mapped to the selected company.");
    // Clear the old primary first -- the partial unique index only allows one
    // active is_primary row per company, so these two updates must not
    // overlap (the clear commits before the set, avoiding a spurious conflict).
    const { error: clearError } = await db.from("company_vendor_code_map")
      .update({ is_primary: false, last_updated_by: ctx.auth_user_id, last_updated_at: new Date().toISOString() })
      .eq("company_id", companyId).eq("is_primary", true);
    if (clearError) throw new Error("VENDOR_CODE_PRIMARY_FAILED");
    const { data, error } = await db.from("company_vendor_code_map")
      .update({ is_primary: true, last_updated_by: ctx.auth_user_id, last_updated_at: new Date().toISOString() })
      .eq("id", mapId).select("*").single();
    if (error) throw new Error("VENDOR_CODE_PRIMARY_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "VENDOR_CODE_PRIMARY_FAILED";
    return vcError(req, ctx, code, 500, "Unable to set this vendor code as Primary.");
  }
}

export async function unmapCompanyVendorCodeHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await companyScope(ctx, toTrimmedString(body.company_id));
    const mapId = toTrimmedString(body.map_id);
    if (!companyId || !mapId) return vcError(req, ctx, "VENDOR_CODE_UNMAP_INVALID", 400, "company_id and map_id are required.");
    const accessError = await requireVendorCodeAction(req, ctx, companyId, "WRITE"); if (accessError) return accessError;

    const db = serviceRoleClient.schema("erp_production");
    const { data: target, error: targetError } = await db.from("company_vendor_code_map")
      .select("id, is_primary").eq("id", mapId).eq("company_id", companyId).maybeSingle();
    if (targetError) throw new Error("VENDOR_CODE_UNMAP_FAILED");
    if (!target) return vcError(req, ctx, "VENDOR_CODE_MAP_NOT_FOUND", 404, "This vendor code is not mapped to the selected company.");
    if (target.is_primary) return vcError(req, ctx, "VENDOR_CODE_PRIMARY_REQUIRED", 409, "Set a different vendor code as Primary before removing this one.");
    // ON DELETE CASCADE on vendor_code_stroke_override.company_vendor_code_map_id
    // removes any override that pointed at this mapping in the same statement.
    const { error } = await db.from("company_vendor_code_map").delete().eq("id", mapId);
    if (error) throw new Error("VENDOR_CODE_UNMAP_FAILED");
    return okResponse({ data: { id: mapId, unmapped: true } }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "VENDOR_CODE_UNMAP_FAILED";
    return vcError(req, ctx, code, 500, "Unable to remove this vendor code from the company.");
  }
}

export async function createVendorCodeOverrideHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await companyScope(ctx, toTrimmedString(body.company_id));
    const mapId = toTrimmedString(body.company_vendor_code_map_id);
    const strokeId = toTrimmedString(body.stroke_master_id);
    if (!companyId || !mapId || !strokeId) return vcError(req, ctx, "VENDOR_CODE_OVERRIDE_INVALID", 400, "company_id, company_vendor_code_map_id, and stroke_master_id are required.");
    const accessError = await requireVendorCodeAction(req, ctx, companyId, "WRITE"); if (accessError) return accessError;

    const db = serviceRoleClient.schema("erp_production");
    const { data: map, error: mapError } = await db.from("company_vendor_code_map")
      .select("id, is_primary").eq("id", mapId).eq("company_id", companyId).eq("active", true).maybeSingle();
    if (mapError) throw new Error("VENDOR_CODE_OVERRIDE_FAILED");
    if (!map) return vcError(req, ctx, "VENDOR_CODE_MAP_NOT_FOUND", 404, "This vendor code is not mapped to the selected company.");
    // Overriding onto the Primary is a no-op by definition -- Primary already
    // applies to every Stroke that has no override. Only a non-primary
    // vendor code needs an explicit override row.
    if (map.is_primary) return vcError(req, ctx, "VENDOR_CODE_OVERRIDE_ON_PRIMARY", 409, "Choose a non-primary vendor code -- the Primary already applies by default.");
    const { data: stroke, error: strokeError } = await serviceRoleClient.schema("erp_production")
      .from("stroke_master").select("id, company_id").eq("id", strokeId).maybeSingle();
    if (strokeError) throw new Error("VENDOR_CODE_OVERRIDE_FAILED");
    if (!stroke || toTrimmedString(stroke.company_id) !== companyId) return vcError(req, ctx, "VENDOR_CODE_STROKE_SCOPE_INVALID", 409, "The selected Stroke does not belong to this company.");

    // A Stroke can only be overridden onto one vendor code at a time -- a
    // second override for the same Stroke replaces the first, it never adds.
    const { data, error } = await db.from("vendor_code_stroke_override").upsert({
      company_id: companyId, company_vendor_code_map_id: mapId, stroke_master_id: strokeId,
      active: true, created_by: ctx.auth_user_id, last_updated_by: ctx.auth_user_id, last_updated_at: new Date().toISOString(),
    }, { onConflict: "company_id,stroke_master_id" }).select("*").single();
    if (error) throw new Error("VENDOR_CODE_OVERRIDE_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "VENDOR_CODE_OVERRIDE_FAILED";
    return vcError(req, ctx, code, 500, "Unable to save this Stroke override.");
  }
}

export async function deleteVendorCodeOverrideHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await companyScope(ctx, toTrimmedString(body.company_id));
    const overrideId = toTrimmedString(body.id);
    if (!companyId || !overrideId) return vcError(req, ctx, "VENDOR_CODE_OVERRIDE_DELETE_INVALID", 400, "company_id and id are required.");
    const accessError = await requireVendorCodeAction(req, ctx, companyId, "WRITE"); if (accessError) return accessError;

    const { data, error } = await serviceRoleClient.schema("erp_production").from("vendor_code_stroke_override")
      .delete().eq("id", overrideId).eq("company_id", companyId).select("id").maybeSingle();
    if (error) throw new Error("VENDOR_CODE_OVERRIDE_DELETE_FAILED");
    if (!data) return vcError(req, ctx, "VENDOR_CODE_OVERRIDE_NOT_FOUND", 404, "Override not found for this company.");
    return okResponse({ data: { id: overrideId, deleted: true } }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "VENDOR_CODE_OVERRIDE_DELETE_FAILED";
    return vcError(req, ctx, code, 500, "Unable to delete this Stroke override.");
  }
}

// ---------------------------------------------------------------------------
// SO01 (§141) -- read-only, cross-module. Sales users creating an SO are
// never granted ACC_COMPANY_VENDOR_CODE (that's Accounts-only), so this does
// NOT call requireVendorCodeAction -- access is gated at the route level to
// PROC_SO_CREATE:WRITE instead, the same pattern this file's sibling
// sales_order.handlers.ts already uses to expose AC06 approved months to
// SO01 without granting Accounts' own ACL resource.
// ---------------------------------------------------------------------------

export async function listCompanyVendorCodesForSalesOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const companyId = await companyScope(ctx, new URL(req.url).searchParams.get("company_id") ?? undefined);
    if (!companyId) return vcError(req, ctx, "VENDOR_CODE_COMPANY_REQUIRED", 400, "company_id is required.");
    const db = serviceRoleClient.schema("erp_production");
    const { data: maps, error: mapsError } = await db.from("company_vendor_code_map")
      .select("vendor_code_id, is_primary").eq("company_id", companyId).eq("active", true);
    if (mapsError) throw new Error("VENDOR_CODE_LIST_FAILED");
    const mappedRows = (maps ?? []) as Row[];
    const codeIds = ids(mappedRows.map((row) => row.vendor_code_id));
    const { data: codes, error: codesError } = codeIds.length
      ? await db.from("vendor_code_master").select("id, vendor_code, description").in("id", codeIds)
      : { data: [], error: null };
    if (codesError) throw new Error("VENDOR_CODE_LIST_FAILED");
    const codeById = new Map(((codes ?? []) as Row[]).map((row) => [toTrimmedString(row.id), row]));
    const data = mappedRows.map((row) => {
      const code = codeById.get(toTrimmedString(row.vendor_code_id));
      return {
        vendor_code_id: row.vendor_code_id,
        vendor_code: code?.vendor_code ?? null,
        description: code?.description ?? null,
        is_primary: Boolean(row.is_primary),
      };
    }).sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || String(a.vendor_code ?? "").localeCompare(String(b.vendor_code ?? "")));
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "VENDOR_CODE_LIST_FAILED";
    return vcError(req, ctx, code, 500, "Unable to load vendor codes for this company.");
  }
}

// Non-primary vendor code -> the set of Prodshade material_ids eligible for
// it (via its Stroke overrides). Empty set = no override exists yet for this
// vendor code, so no FG/SFG item is eligible (caller must not fall back to
// "show everything" -- that would silently mean the Primary's scope).
export async function getEligibleProdshadeIdsForVendorCode(companyId: string, vendorCodeId: string): Promise<Set<string>> {
  const db = serviceRoleClient.schema("erp_production");
  const { data: map, error: mapError } = await db.from("company_vendor_code_map")
    .select("id").eq("company_id", companyId).eq("vendor_code_id", vendorCodeId).eq("active", true).maybeSingle();
  if (mapError) throw new Error("VENDOR_CODE_ELIGIBILITY_LOOKUP_FAILED");
  if (!map) return new Set();
  const { data: overrides, error: overridesError } = await db.from("vendor_code_stroke_override")
    .select("stroke_master_id").eq("company_id", companyId).eq("active", true).eq("company_vendor_code_map_id", toTrimmedString(map.id));
  if (overridesError) throw new Error("VENDOR_CODE_ELIGIBILITY_LOOKUP_FAILED");
  const strokeIds = ids((overrides ?? []).map((row: Row) => row.stroke_master_id));
  if (strokeIds.length === 0) return new Set();
  const strokes = await fetchInChunks<Row>(strokeIds, (chunk) =>
    db.from("stroke_master").select("prodshade_material_id").in("id", chunk));
  return new Set(strokes.map((row) => toTrimmedString(row.prodshade_material_id)).filter(Boolean));
}

// Is the given vendor_code_id this company's own Primary? SO01 skips the
// eligibility filter entirely when it is (Primary applies to everything that
// has no override, same as the Accounts workspace's own default rule).
export async function isPrimaryVendorCodeForCompany(companyId: string, vendorCodeId: string): Promise<boolean> {
  const { data, error } = await serviceRoleClient.schema("erp_production").from("company_vendor_code_map")
    .select("is_primary").eq("company_id", companyId).eq("vendor_code_id", vendorCodeId).eq("active", true).maybeSingle();
  if (error) throw new Error("VENDOR_CODE_ELIGIBILITY_LOOKUP_FAILED");
  return Boolean(data?.is_primary);
}

// AC05's rate-entry save freezes the currently applicable MTS Stroke onto the
// new effective-dated rate row. This deliberately resolves a data-hygiene tie
// deterministically rather than making a manual rate entry impossible.
export async function resolveStrokeForProdshadeAndVendorCode(
  companyId: string,
  prodshadeMaterialId: string,
  companyVendorCodeMapId: string,
): Promise<{ stroke_master_id: string } | null> {
  const db = serviceRoleClient.schema("erp_production");
  const { data: mapping, error: mappingError } = await db.from("company_vendor_code_map")
    .select("id, vendor_code_id").eq("id", companyVendorCodeMapId).eq("company_id", companyId).eq("active", true).maybeSingle();
  if (mappingError) throw new Error("VENDOR_CODE_STROKE_RESOLVE_FAILED");
  if (!mapping) return null;
  const isPrimary = await isPrimaryVendorCodeForCompany(companyId, toTrimmedString(mapping.vendor_code_id));
  const { data: rawStrokes, error: strokesError } = await db.from("stroke_master")
    .select("id, approved_at").eq("company_id", companyId).eq("prodshade_material_id", prodshadeMaterialId)
    .eq("status", "APPROVED").order("approved_at", { ascending: false, nullsFirst: false });
  if (strokesError) throw new Error("VENDOR_CODE_STROKE_RESOLVE_FAILED");
  const rawCandidates = (rawStrokes ?? []) as Row[];
  if (!rawCandidates.length) return null;
  // MTS eligibility is decided by stroke_po_type_applicability (target_po_type
  // 'MTS', is_active), not stroke_master.po_type -- a Stroke created under a
  // different PO Type can still be shared to MTS (2026-08-31 Stroke Share
  // redesign). Same source of truth sales_order.handlers.ts's
  // listSalesOrderFgSkuOptionsHandler (§141) already uses for this question.
  const rawStrokeIds = ids(rawCandidates.map((row) => row.id));
  const applicableRows = await fetchInChunks<Row>(rawStrokeIds, (chunk) => db.from("stroke_po_type_applicability")
    .select("stroke_master_id").eq("target_po_type", "MTS").eq("is_active", true).in("stroke_master_id", chunk));
  const applicableIds = new Set(applicableRows.map((row) => toTrimmedString(row.stroke_master_id)));
  const candidates = rawCandidates.filter((row) => applicableIds.has(toTrimmedString(row.id)));
  if (!candidates.length) return null;
  const strokeIds = ids(candidates.map((row) => row.id));
  const overrideRows = await fetchInChunks<Row>(strokeIds, (chunk) => db.from("vendor_code_stroke_override")
    .select("stroke_master_id, company_vendor_code_map_id").eq("company_id", companyId).eq("active", true).in("stroke_master_id", chunk));
  const overrideMapByStroke = new Map(overrideRows.map((row) => [toTrimmedString(row.stroke_master_id), toTrimmedString(row.company_vendor_code_map_id)]));
  const match = candidates.find((stroke) => isPrimary
    ? !overrideMapByStroke.has(toTrimmedString(stroke.id))
    : overrideMapByStroke.get(toTrimmedString(stroke.id)) === companyVendorCodeMapId);
  return match ? { stroke_master_id: toTrimmedString(match.id) } : null;
}

// ---------------------------------------------------------------------------
// Shared resolver -- for AC05/dispatch (future consumers): which vendor code
// applies to a given company+Stroke -- the Stroke's own override if one
// exists, else the company's Primary vendor code.
// ---------------------------------------------------------------------------
export async function resolveVendorCodeForStroke(companyId: string, strokeMasterId: string): Promise<{ vendor_code_id: string; vendor_code: string; source: "OVERRIDE" | "PRIMARY" } | null> {
  const db = serviceRoleClient.schema("erp_production");
  const { data: override, error: overrideError } = await db.from("vendor_code_stroke_override")
    .select("company_vendor_code_map_id").eq("company_id", companyId).eq("stroke_master_id", strokeMasterId).eq("active", true).maybeSingle();
  if (overrideError) throw new Error("VENDOR_CODE_RESOLVE_FAILED");
  const targetMapId = override?.company_vendor_code_map_id
    ? toTrimmedString(override.company_vendor_code_map_id)
    : null;
  const { data: map, error: mapError } = targetMapId
    ? await db.from("company_vendor_code_map").select("vendor_code_id").eq("id", targetMapId).maybeSingle()
    : await db.from("company_vendor_code_map").select("vendor_code_id").eq("company_id", companyId).eq("is_primary", true).eq("active", true).maybeSingle();
  if (mapError) throw new Error("VENDOR_CODE_RESOLVE_FAILED");
  if (!map) return null;
  const { data: vendorCode, error: vendorCodeError } = await db.from("vendor_code_master")
    .select("id, vendor_code").eq("id", toTrimmedString(map.vendor_code_id)).maybeSingle();
  if (vendorCodeError) throw new Error("VENDOR_CODE_RESOLVE_FAILED");
  if (!vendorCode) return null;
  return { vendor_code_id: toTrimmedString(vendorCode.id), vendor_code: toTrimmedString(vendorCode.vendor_code), source: targetMapId ? "OVERRIDE" : "PRIMARY" };
}
