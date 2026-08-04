/*
 * File-ID: 27.3
 * File-Path: supabase/functions/api/_core/production/stroke_change_request.handlers.ts
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Stroke Change Request handlers — create, list, get, approve, reject.
 *          Used when an ACTIVE stroke needs material substitution (PR03/PR04).
 *          Per feasibility doc 83.3 PR03/PR04 (LOCKED 2026-06-30): only Item,
 *          Has Alternate and Material Group can change — Dosage% is locked.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
import { okResponse, errorResponse } from "../response.ts";
import { assertCompanyScope, isCompanyScopeAdminBypass } from "../../_shared/companyScope.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import {
  assertProdReadRole,
  parseBody,
  toTrimmedString,
  getIdFromPath,
} from "./production.shared.ts";

type JsonRecord = Record<string, unknown>;

function crError(
  req: Request,
  ctx: ProdHandlerContext,
  code: string,
  status: number,
  msg: string,
): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

function createdOkResponse(data: unknown, requestId: string, req?: Request): Response {
  const response = okResponse(data, requestId, req);
  return new Response(response.body, { status: 201, headers: response.headers });
}

// PostgREST's select parser does not support the alias:schema.table!fk(...)
// cross-schema embed syntax (PGRST100) — batch-fetch by id and merge in JS.
async function getMaterialMapByIds(ids: string[]): Promise<Map<string, JsonRecord>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (uniqueIds.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, pace_code, material_name")
    .in("id", uniqueIds);
  if (error) {
    console.error("[stroke_change_request.getMaterialMapByIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_SCR_MATERIAL_BATCH_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

async function getGroupMapByIds(ids: string[]): Promise<Map<string, JsonRecord>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (uniqueIds.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_category_group")
    .select("id, group_code, group_name")
    .in("id", uniqueIds);
  if (error) {
    console.error("[stroke_change_request.getGroupMapByIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_SCR_GROUP_BATCH_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

async function getStrokeMasterMapByIds(ids: string[]): Promise<Map<string, JsonRecord>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (uniqueIds.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("stroke_master")
    .select("id, prodshade_material_id, stroke_number, description")
    .in("id", uniqueIds);
  if (error) {
    console.error("[stroke_change_request.getStrokeMasterMapByIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_SCR_STROKE_BATCH_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

async function listStrokeChangeRequestScopedCompanyIds(ctx: ProdHandlerContext): Promise<string[] | null> {
  if (isCompanyScopeAdminBypass(ctx)) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", ctx.auth_user_id);
  if (error) throw new Error("PROD_SCR_SCOPE_LOOKUP_FAILED");
  return [...new Set(((data ?? []) as JsonRecord[]).map((row) => String(row.company_id ?? "")).filter(Boolean))];
}

// GET /api/production/stroke-change-requests
export async function listStrokeChangeRequestsHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const status = toTrimmedString(url.searchParams.get("status") ?? "");

    let query = serviceRoleClient
      .schema("erp_production")
      .from("stroke_change_request")
      .select("id, stroke_master_id, company_id, status, created_by, created_at, approved_by, approved_at, reject_reason")
      .order("created_at", { ascending: false });

    if (companyId) {
      await assertCompanyScope(ctx, companyId);
      query = query.eq("company_id", companyId);
    } else {
      const scopedCompanyIds = await listStrokeChangeRequestScopedCompanyIds(ctx);
      if (scopedCompanyIds && scopedCompanyIds.length === 0) {
        return okResponse({ data: [] }, ctx.request_id, req);
      }
      if (scopedCompanyIds) {
        query = query.in("company_id", scopedCompanyIds);
      }
    }
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) {
      console.error("[stroke_change_request.listStrokeChangeRequests] query failed:", JSON.stringify(error));
      throw new Error("PROD_SCR_LIST_FAILED");
    }

    const rows = (data ?? []) as JsonRecord[];
    const strokeMap = await getStrokeMasterMapByIds(rows.map((r) => String(r.stroke_master_id ?? "")));
    const materialMap = await getMaterialMapByIds(
      [...strokeMap.values()].map((s) => String(s.prodshade_material_id ?? "")),
    );
    const userDisplayMap = await resolveUserDisplayNames(rows.flatMap((r) => [
      String(r.created_by ?? ""), String(r.approved_by ?? ""),
    ]));

    return okResponse({
      data: rows.map((row) => {
        const stroke = strokeMap.get(String(row.stroke_master_id ?? "")) ?? null;
        return {
          ...row,
          stroke: stroke ? {
            ...stroke,
            material: materialMap.get(String(stroke.prodshade_material_id ?? "")) ?? null,
          } : null,
          created_by_display: userDisplayMap.get(String(row.created_by ?? "")) ?? null,
          approved_by_display: userDisplayMap.get(String(row.approved_by ?? "")) ?? null,
        };
      }),
    }, ctx.request_id, req);
  } catch (err) {
    console.error("[stroke_change_request.listStrokeChangeRequestsHandler] request_id:", ctx.request_id, "error:", err);
    const code = err instanceof Error ? err.message : "PROD_SCR_LIST_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500;
    return crError(req, ctx, code, status, "Stroke change request list failed");
  }
}

// GET /api/production/stroke-change-requests/:id
export async function getStrokeChangeRequestHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return crError(req, ctx, "PROD_SCR_ID_MISSING", 400, "Change request ID required");

    const { data, error } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_change_request")
      .select("id, stroke_master_id, company_id, status, created_by, created_at, approved_by, approved_at, reject_reason")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[stroke_change_request.getStrokeChangeRequest] query failed:", JSON.stringify(error));
      throw new Error("PROD_SCR_FETCH_FAILED");
    }
    if (!data) return crError(req, ctx, "PROD_SCR_NOT_FOUND", 404, "Change request not found");
    const row = data as JsonRecord;
    await assertCompanyScope(ctx, String(row.company_id ?? ""));
    const strokeMasterId = String(row.stroke_master_id ?? "");

    const [strokeRes, lineRes, changeLineRes] = await Promise.all([
      serviceRoleClient.schema("erp_production").from("stroke_master")
        .select("id, prodshade_material_id, stroke_number, description")
        .eq("id", strokeMasterId).maybeSingle(),
      serviceRoleClient.schema("erp_production").from("stroke_line")
        .select("id, material_id, line_material_type, material_group_id, dosage_pct, display_order")
        .eq("stroke_master_id", strokeMasterId).order("display_order"),
      serviceRoleClient.schema("erp_production").from("stroke_change_request_line")
        .select("id, change_request_id, stroke_line_id, display_order, old_material_id, new_material_id, old_has_alternate, new_has_alternate, old_group_id, new_group_id")
        .eq("change_request_id", id).order("display_order"),
    ]);

    if (strokeRes.error) {
      console.error("[stroke_change_request.getStrokeChangeRequest] stroke query failed:", JSON.stringify(strokeRes.error));
      throw new Error("PROD_SCR_FETCH_FAILED");
    }
    if (lineRes.error) {
      console.error("[stroke_change_request.getStrokeChangeRequest] stroke line query failed:", JSON.stringify(lineRes.error));
      throw new Error("PROD_SCR_FETCH_FAILED");
    }
    if (changeLineRes.error) {
      console.error("[stroke_change_request.getStrokeChangeRequest] change line query failed:", JSON.stringify(changeLineRes.error));
      throw new Error("PROD_SCR_LINES_FAILED");
    }

    const stroke = strokeRes.data as JsonRecord | null;
    const strokeLines = (lineRes.data ?? []) as JsonRecord[];
    const changeLines = (changeLineRes.data ?? []) as JsonRecord[];

    const [materialMap, groupMap, userDisplayMap] = await Promise.all([
      getMaterialMapByIds([
        String(stroke?.prodshade_material_id ?? ""),
        ...strokeLines.map((l) => String(l.material_id ?? "")),
        ...changeLines.map((l) => String(l.old_material_id ?? "")),
        ...changeLines.map((l) => String(l.new_material_id ?? "")),
      ]),
      getGroupMapByIds([
        ...strokeLines.map((l) => String(l.material_group_id ?? "")),
        ...changeLines.map((l) => String(l.old_group_id ?? "")),
        ...changeLines.map((l) => String(l.new_group_id ?? "")),
      ]),
      resolveUserDisplayNames([String(row.created_by ?? ""), String(row.approved_by ?? "")]),
    ]);

    return okResponse({
      data: {
        ...row,
        created_by_display: userDisplayMap.get(String(row.created_by ?? "")) ?? null,
        approved_by_display: userDisplayMap.get(String(row.approved_by ?? "")) ?? null,
        stroke: stroke ? {
          ...stroke,
          material: materialMap.get(String(stroke.prodshade_material_id ?? "")) ?? null,
          lines: strokeLines.map((line) => ({
            ...line,
            material: materialMap.get(String(line.material_id ?? "")) ?? null,
            material_group: groupMap.get(String(line.material_group_id ?? "")) ?? null,
          })),
        } : null,
        change_lines: changeLines.map((line) => ({
          ...line,
          old_material: materialMap.get(String(line.old_material_id ?? "")) ?? null,
          new_material: materialMap.get(String(line.new_material_id ?? "")) ?? null,
          old_group: groupMap.get(String(line.old_group_id ?? "")) ?? null,
          new_group: groupMap.get(String(line.new_group_id ?? "")) ?? null,
        })),
      },
    }, ctx.request_id, req);
  } catch (err) {
    console.error("[stroke_change_request.getStrokeChangeRequestHandler] request_id:", ctx.request_id, "error:", err);
    const code = err instanceof Error ? err.message : "PROD_SCR_FETCH_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500;
    return crError(req, ctx, code, status, "Stroke change request fetch failed");
  }
}

// POST /api/production/stroke-change-requests
export async function createStrokeChangeRequestHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    // ACL-gated via route-acl-registry (PROD_CHANGE_BOM_ITEM:WRITE) — no longer a
    // blanket Manager/SA rank check; department grants are actually enforced.
    const body = await parseBody(req);
    const strokeMasterId = toTrimmedString(body.stroke_master_id);
    const companyId = toTrimmedString(body.company_id);
    const lines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];

    if (!strokeMasterId || !companyId) {
      return crError(req, ctx, "PROD_SCR_INVALID", 400, "stroke_master_id and company_id required");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return crError(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (lines.length === 0) {
      return crError(req, ctx, "PROD_SCR_NO_LINES", 400, "At least one line change required");
    }

    // Validate stroke exists and is APPROVED (ACTIVE)
    const { data: stroke, error: sErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_master")
      .select("id, status")
      .eq("id", strokeMasterId)
      .maybeSingle();

    if (sErr) {
      console.error("[stroke_change_request.createStrokeChangeRequest] stroke lookup failed:", JSON.stringify(sErr));
      throw new Error("PROD_SCR_STROKE_LOOKUP_FAILED");
    }
    if (!stroke) return crError(req, ctx, "PROD_SCR_STROKE_NOT_FOUND", 404, "Stroke master not found");
    if ((stroke as JsonRecord).status !== "APPROVED") {
      return crError(req, ctx, "PROD_SCR_STROKE_NOT_ACTIVE", 422, "Stroke must be APPROVED (active) to create a change request");
    }

    const { data: strokeLineRows, error: slErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_line")
      .select("id, material_id, material_group_id")
      .eq("stroke_master_id", strokeMasterId);
    if (slErr) {
      console.error("[stroke_change_request.createStrokeChangeRequest] stroke line lookup failed:", JSON.stringify(slErr));
      throw new Error("PROD_SCR_STROKE_LOOKUP_FAILED");
    }
    const strokeLinesMap = new Map<string, JsonRecord>();
    for (const sl of (strokeLineRows ?? []) as JsonRecord[]) strokeLinesMap.set(String(sl.id), sl);

    // Check no existing DRAFT change request for same stroke
    const { count: draftCount } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_change_request")
      .select("id", { count: "exact", head: true })
      .eq("stroke_master_id", strokeMasterId)
      .eq("status", "DRAFT") as { count?: number };

    if ((draftCount ?? 0) > 0) {
      return crError(req, ctx, "PROD_SCR_ALREADY_PENDING", 409, "A pending change request already exists for this stroke");
    }

    // Insert change request
    const { data: cr, error: crErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_change_request")
      .insert({
        stroke_master_id: strokeMasterId,
        company_id: companyId,
        status: "DRAFT",
        created_by: ctx.auth_user_id,
      })
      .select("id")
      .single();

    if (crErr) {
      console.error("[stroke_change_request.createStrokeChangeRequest] insert failed:", JSON.stringify(crErr));
      throw new Error("PROD_SCR_CREATE_FAILED");
    }

    // Insert change request lines (populate old_* from current stroke lines)
    const lineRows = lines.map((l: JsonRecord, idx: number) => {
      const strokeLineId = toTrimmedString(l.stroke_line_id);
      const currentLine = strokeLinesMap.get(strokeLineId);
      return {
        change_request_id: (cr as JsonRecord).id,
        stroke_line_id: strokeLineId || null,
        old_material_id: currentLine ? currentLine.material_id : null,
        new_material_id: toTrimmedString(l.new_material_id) || null,
        old_has_alternate: currentLine ? Boolean(currentLine.material_group_id) : false,
        new_has_alternate: l.new_has_alternate === true || l.new_has_alternate === "true",
        old_group_id: currentLine ? (currentLine.material_group_id ?? null) : null,
        new_group_id: toTrimmedString(l.new_group_id) || null,
        display_order: idx,
      };
    });

    const { error: lErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_change_request_line")
      .insert(lineRows);

    if (lErr) {
      console.error("[stroke_change_request.createStrokeChangeRequest] line insert failed:", JSON.stringify(lErr));
      throw new Error("PROD_SCR_LINES_INSERT_FAILED");
    }

    return createdOkResponse({ id: (cr as JsonRecord).id }, ctx.request_id, req);
  } catch (err) {
    console.error("[stroke_change_request.createStrokeChangeRequestHandler] request_id:", ctx.request_id, "error:", err);
    const code = err instanceof Error ? err.message : "PROD_SCR_CREATE_FAILED";
    return crError(req, ctx, code, 500, "Stroke change request create failed");
  }
}

// POST /api/production/stroke-change-requests/:id/approve
// L3 Manager can edit the proposed lines before approving (per 83.3 PR04) — the
// edited `lines` payload, if present, overrides what was originally proposed.
export async function approveStrokeChangeRequestHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    // ACL-gated via route-acl-registry (PROD_CHANGE_BOM_ITEM_APPROVAL:APPROVE) — no longer a
    // blanket Manager/SA rank check; department grants are actually enforced.
    const id = getIdFromPath(req);
    if (!id) return crError(req, ctx, "PROD_SCR_ID_MISSING", 400, "ID required");

    const body = await parseBody(req);
    const editedLines: JsonRecord[] = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];

    const { data: cr, error: crFetchErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_change_request")
      .select("id, status, stroke_master_id, company_id")
      .eq("id", id)
      .maybeSingle();

    if (crFetchErr) {
      console.error("[stroke_change_request.approveStrokeChangeRequest] fetch failed:", JSON.stringify(crFetchErr));
      throw new Error("PROD_SCR_FETCH_FAILED");
    }
    if (!cr) return crError(req, ctx, "PROD_SCR_NOT_FOUND", 404, "Change request not found");
    await assertCompanyScope(ctx, String((cr as JsonRecord).company_id ?? ""));
    if ((cr as JsonRecord).status !== "DRAFT") {
      return crError(req, ctx, "PROD_SCR_NOT_DRAFT", 422, "Only DRAFT change requests can be approved");
    }

    let linesToApply: JsonRecord[] = editedLines;
    if (linesToApply.length === 0) {
      const { data: dbLines, error: dbLinesErr } = await serviceRoleClient
        .schema("erp_production")
        .from("stroke_change_request_line")
        .select("stroke_line_id, new_material_id, new_has_alternate, new_group_id")
        .eq("change_request_id", id);
      if (dbLinesErr) {
        console.error("[stroke_change_request.approveStrokeChangeRequest] line fetch failed:", JSON.stringify(dbLinesErr));
        throw new Error("PROD_SCR_FETCH_FAILED");
      }
      linesToApply = (dbLines ?? []) as JsonRecord[];
    } else {
      // L3 Manager edited the proposal — persist their edits onto the change
      // request lines too, so the audit trail reflects what was actually approved.
      await Promise.all(linesToApply.map((line) => {
        const strokeLineId = toTrimmedString(line.stroke_line_id);
        if (!strokeLineId) return Promise.resolve();
        return serviceRoleClient.schema("erp_production").from("stroke_change_request_line")
          .update({
            new_material_id: toTrimmedString(line.new_material_id) || null,
            new_has_alternate: line.new_has_alternate === true || line.new_has_alternate === "true",
            new_group_id: toTrimmedString(line.new_group_id) || null,
          })
          .eq("change_request_id", id)
          .eq("stroke_line_id", strokeLineId);
      }));
    }

    // Each target stroke_line_id is independent — safe to write in parallel.
    // De-dupe first (last entry per stroke_line_id wins) to match prior
    // sequential-loop behaviour if the same id appears twice.
    const updateByStrokeLineId = new Map<string, JsonRecord>();
    for (const line of linesToApply) {
      const strokeLineId = toTrimmedString(line.stroke_line_id);
      if (!strokeLineId) continue;
      const hasAlternate = line.new_has_alternate === true || line.new_has_alternate === "true";
      const update: JsonRecord = {
        material_id: toTrimmedString(line.new_material_id) || null,
        material_group_id: hasAlternate ? (toTrimmedString(line.new_group_id) || null) : null,
      };
      updateByStrokeLineId.set(strokeLineId, update);
    }

    const updateResults = await Promise.all(
      [...updateByStrokeLineId.entries()].map(([strokeLineId, update]) =>
        serviceRoleClient
          .schema("erp_production")
          .from("stroke_line")
          .update(update)
          .eq("id", strokeLineId)
      ),
    );
    const failedUpdate = updateResults.find((r) => r.error);
    if (failedUpdate) {
      console.error("[stroke_change_request.approveStrokeChangeRequest] stroke_line update failed:", JSON.stringify(failedUpdate.error));
      throw new Error("PROD_SCR_APPLY_FAILED");
    }

    const now = new Date().toISOString();
    const { error: updateErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_change_request")
      .update({ status: "APPROVED", approved_by: ctx.auth_user_id, approved_at: now })
      .eq("id", id);

    if (updateErr) {
      console.error("[stroke_change_request.approveStrokeChangeRequest] status update failed:", JSON.stringify(updateErr));
      throw new Error("PROD_SCR_APPROVE_FAILED");
    }

    return okResponse({ id, status: "APPROVED" }, ctx.request_id, req);
  } catch (err) {
    console.error("[stroke_change_request.approveStrokeChangeRequestHandler] request_id:", ctx.request_id, "error:", err);
    const code = err instanceof Error ? err.message : "PROD_SCR_APPROVE_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500;
    return crError(req, ctx, code, status, "Stroke change request approve failed");
  }
}

// POST /api/production/stroke-change-requests/:id/reject
// Soft cancel (not hard delete) — the Stroke is a committed ACTIVE document,
// so the Change Request record is preserved as REJECTED for audit (per 83.3 PR04).
export async function rejectStrokeChangeRequestHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    // ACL-gated via route-acl-registry (PROD_CHANGE_BOM_ITEM_APPROVAL:APPROVE) — no longer a
    // blanket Manager/SA rank check; department grants are actually enforced.
    const id = getIdFromPath(req);
    if (!id) return crError(req, ctx, "PROD_SCR_ID_MISSING", 400, "ID required");

    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason);
    if (!reason) {
      return crError(req, ctx, "PROD_SCR_REASON_REQUIRED", 400, "Reject reason is required");
    }

    const { data: cr, error: crFetchErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_change_request")
      .select("id, status, company_id")
      .eq("id", id)
      .maybeSingle();

    if (crFetchErr) {
      console.error("[stroke_change_request.rejectStrokeChangeRequest] fetch failed:", JSON.stringify(crFetchErr));
      throw new Error("PROD_SCR_FETCH_FAILED");
    }
    if (!cr) return crError(req, ctx, "PROD_SCR_NOT_FOUND", 404, "Change request not found");
    await assertCompanyScope(ctx, String((cr as JsonRecord).company_id ?? ""));
    if ((cr as JsonRecord).status !== "DRAFT") {
      return crError(req, ctx, "PROD_SCR_NOT_DRAFT", 422, "Only DRAFT change requests can be rejected");
    }

    const { error: updateErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_change_request")
      .update({ status: "REJECTED", reject_reason: reason })
      .eq("id", id);

    if (updateErr) {
      console.error("[stroke_change_request.rejectStrokeChangeRequest] update failed:", JSON.stringify(updateErr));
      throw new Error("PROD_SCR_REJECT_FAILED");
    }

    return okResponse({ id, status: "REJECTED" }, ctx.request_id, req);
  } catch (err) {
    console.error("[stroke_change_request.rejectStrokeChangeRequestHandler] request_id:", ctx.request_id, "error:", err);
    const code = err instanceof Error ? err.message : "PROD_SCR_REJECT_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500;
    return crError(req, ctx, code, status, "Stroke change request reject failed");
  }
}
