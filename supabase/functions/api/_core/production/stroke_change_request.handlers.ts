/*
 * File-ID: 27.3
 * File-Path: supabase/functions/api/_core/production/stroke_change_request.handlers.ts
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Stroke Change Request handlers — create, list, get, approve, reject.
 *          Used when an ACTIVE stroke needs material substitution (PR03/PR04).
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import {
  assertProdReadRole,
  assertManagerOrSARole,
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

async function getMaterialMapByIds(
  materialIds: string[],
  logPrefix: string,
  errorCode: string,
): Promise<Map<string, JsonRecord>> {
  const matIds = [...new Set(materialIds.filter(Boolean))];
  const matMap = new Map<string, JsonRecord>();
  if (matIds.length === 0) return matMap;

  const { data: mats, error: matErr } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, pace_code, material_name")
    .in("id", matIds);
  if (matErr) {
    console.error(`${logPrefix} material query failed:`, JSON.stringify(matErr));
    throw new Error(errorCode);
  }

  for (const mat of (mats ?? []) as JsonRecord[]) {
    matMap.set(String(mat.id), mat);
  }
  return matMap;
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
      .select(`
        id, stroke_master_id, company_id, status, created_by, created_at,
        approved_by, approved_at, reject_reason,
        stroke:stroke_master!stroke_master_id(
          prodshade_material_id, stroke_number, description
        )
      `)
      .order("created_at", { ascending: false });

    if (companyId) query = query.eq("company_id", companyId);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw new Error("PROD_SCR_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_SCR_LIST_FAILED";
    return crError(req, ctx, code, 500, "Stroke change request list failed");
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
      .select(`
        id, stroke_master_id, company_id, status, created_by, created_at,
        approved_by, approved_at, reject_reason,
        stroke:stroke_master!stroke_master_id(
          prodshade_material_id, stroke_number, description,
          lines:stroke_line(
            id, material_id, alternate_material_id, dosage_pct, display_order
          )
        )
      `)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[stroke_change_request.getStrokeChangeRequest] query failed:", JSON.stringify(error));
      throw new Error("PROD_SCR_FETCH_FAILED");
    }
    if (!data) return crError(req, ctx, "PROD_SCR_NOT_FOUND", 404, "Change request not found");

    // Fetch change request lines with old/new material details
    const { data: lines, error: lErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_change_request_line")
      .select(`
        id, change_request_id, stroke_line_id, display_order,
        old_material_id, new_material_id,
        old_has_alternate, new_has_alternate,
        old_group_id, new_group_id
      `)
      .eq("change_request_id", id)
      .order("display_order");

    if (lErr) {
      console.error("[stroke_change_request.getStrokeChangeRequest] change line query failed:", JSON.stringify(lErr));
      throw new Error("PROD_SCR_LINES_FAILED");
    }

    const row = data as JsonRecord;
    const stroke = (row.stroke ?? null) as JsonRecord | null;
    const strokeLines = ((stroke?.lines ?? []) as JsonRecord[]);
    const changeLines = (lines ?? []) as JsonRecord[];
    const materialMap = await getMaterialMapByIds(
      [
        ...strokeLines.map((line) => String(line.material_id ?? "")),
        ...changeLines.map((line) => String(line.old_material_id ?? "")),
        ...changeLines.map((line) => String(line.new_material_id ?? "")),
      ],
      "[stroke_change_request.getStrokeChangeRequest]",
      "PROD_SCR_FETCH_FAILED",
    );

    return okResponse({
      data: {
        ...row,
        stroke: stroke ? {
          ...stroke,
          lines: strokeLines.map((line) => ({
            ...line,
            material: materialMap.get(String(line.material_id ?? "")) ?? null,
          })),
        } : null,
        change_lines: changeLines.map((line) => ({
          ...line,
          old_material: materialMap.get(String(line.old_material_id ?? "")) ?? null,
          new_material: materialMap.get(String(line.new_material_id ?? "")) ?? null,
        })),
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_SCR_FETCH_FAILED";
    return crError(req, ctx, code, 500, "Stroke change request fetch failed");
  }
}

// POST /api/production/stroke-change-requests
export async function createStrokeChangeRequestHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const strokeMasterId = toTrimmedString(body.stroke_master_id);
    const companyId = toTrimmedString(body.company_id);
    const lines = Array.isArray(body.lines) ? body.lines : [];

    if (!strokeMasterId || !companyId) {
      return crError(req, ctx, "PROD_SCR_INVALID", 400, "stroke_master_id and company_id required");
    }
    if (lines.length === 0) {
      return crError(req, ctx, "PROD_SCR_NO_LINES", 400, "At least one line change required");
    }

    // Validate stroke exists and is APPROVED (ACTIVE)
    const { data: stroke, error: sErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_master")
      .select("id, status, stroke_line(id, material_id, alternate_material_id, dosage_pct, display_order)")
      .eq("id", strokeMasterId)
      .maybeSingle();

    if (sErr) throw new Error("PROD_SCR_STROKE_LOOKUP_FAILED");
    if (!stroke) return crError(req, ctx, "PROD_SCR_STROKE_NOT_FOUND", 404, "Stroke master not found");
    if ((stroke as JsonRecord).status !== "APPROVED") {
      return crError(req, ctx, "PROD_SCR_STROKE_NOT_ACTIVE", 422, "Stroke must be APPROVED (active) to create a change request");
    }

    // Build a map of stroke lines by id
    const strokeLinesMap = new Map<string, JsonRecord>();
    for (const sl of ((stroke as JsonRecord).stroke_line as JsonRecord[]) ?? []) {
      strokeLinesMap.set(String(sl.id), sl);
    }

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

    if (crErr) throw new Error("PROD_SCR_CREATE_FAILED");

    // Insert change request lines (populate old_* from current stroke lines)
    const lineRows = lines.map((l: JsonRecord, idx: number) => {
      const strokeLineId = toTrimmedString(l.stroke_line_id);
      const currentLine = strokeLinesMap.get(strokeLineId);
      return {
        change_request_id: (cr as JsonRecord).id,
        stroke_line_id: strokeLineId || null,
        old_material_id: currentLine ? currentLine.material_id : null,
        new_material_id: toTrimmedString(l.new_material_id) || null,
        old_has_alternate: currentLine ? Boolean(currentLine.alternate_material_id) : false,
        new_has_alternate: l.new_has_alternate === true || l.new_has_alternate === "true",
        old_group_id: currentLine ? (currentLine.group_id ?? null) : null,
        new_group_id: toTrimmedString(l.new_group_id) || null,
        display_order: idx,
      };
    });

    const { error: lErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_change_request_line")
      .insert(lineRows);

    if (lErr) throw new Error("PROD_SCR_LINES_INSERT_FAILED");

    return createdOkResponse({ id: (cr as JsonRecord).id }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_SCR_CREATE_FAILED";
    return crError(req, ctx, code, 500, "Stroke change request create failed");
  }
}

// POST /api/production/stroke-change-requests/:id/approve
export async function approveStrokeChangeRequestHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return crError(req, ctx, "PROD_SCR_ID_MISSING", 400, "ID required");

    const body = await parseBody(req);
    const editedLines: JsonRecord[] = Array.isArray(body.lines) ? body.lines : [];

    // Fetch change request
    const { data: cr, error: crFetchErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_change_request")
      .select("id, status, stroke_master_id")
      .eq("id", id)
      .maybeSingle();

    if (crFetchErr) throw new Error("PROD_SCR_FETCH_FAILED");
    if (!cr) return crError(req, ctx, "PROD_SCR_NOT_FOUND", 404, "Change request not found");
    if ((cr as JsonRecord).status !== "DRAFT") {
      return crError(req, ctx, "PROD_SCR_NOT_DRAFT", 422, "Only DRAFT change requests can be approved");
    }

    // Determine lines to apply — use edited lines if provided, otherwise read from DB
    let linesToApply: JsonRecord[] = editedLines;
    if (linesToApply.length === 0) {
      const { data: dbLines } = await serviceRoleClient
        .schema("erp_production")
        .from("stroke_change_request_line")
        .select("stroke_line_id, new_material_id, new_has_alternate, new_group_id")
        .eq("change_request_id", id);
      linesToApply = (dbLines ?? []) as JsonRecord[];
    }

    // Apply changes to stroke_line rows. Each target stroke_line_id is
    // independent, so the actual writes can run in parallel — but if the same
    // stroke_line_id appeared twice in linesToApply, the original sequential
    // loop would apply the LAST one; dedupe here first to preserve that.
    const updateByStrokeLineId = new Map<string, JsonRecord>();
    for (const line of linesToApply) {
      const strokeLineId = toTrimmedString(line.stroke_line_id);
      if (!strokeLineId) continue;
      const update: JsonRecord = {};
      if (line.new_material_id != null) update.material_id = toTrimmedString(line.new_material_id) || null;
      if (line.new_has_alternate != null) {
        update.alternate_material_id = (line.new_has_alternate === true || line.new_has_alternate === "true") ? line.alt_material_id ?? null : null;
      }
      if (Object.keys(update).length > 0) {
        updateByStrokeLineId.set(strokeLineId, update);
      }
    }

    await Promise.all(
      [...updateByStrokeLineId.entries()].map(([strokeLineId, update]) =>
        serviceRoleClient
          .schema("erp_production")
          .from("stroke_line")
          .update(update)
          .eq("id", strokeLineId)
      ),
    );

    // Update change request status
    const now = new Date().toISOString();
    const { error: updateErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_change_request")
      .update({ status: "APPROVED", approved_by: ctx.auth_user_id, approved_at: now })
      .eq("id", id);

    if (updateErr) throw new Error("PROD_SCR_APPROVE_FAILED");

    return okResponse({ id, status: "APPROVED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_SCR_APPROVE_FAILED";
    return crError(req, ctx, code, 500, "Stroke change request approve failed");
  }
}

// POST /api/production/stroke-change-requests/:id/reject
export async function rejectStrokeChangeRequestHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return crError(req, ctx, "PROD_SCR_ID_MISSING", 400, "ID required");

    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason);
    if (!reason) {
      return crError(req, ctx, "PROD_SCR_REASON_REQUIRED", 400, "Reject reason is required");
    }

    // Fetch change request
    const { data: cr, error: crFetchErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_change_request")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();

    if (crFetchErr) throw new Error("PROD_SCR_FETCH_FAILED");
    if (!cr) return crError(req, ctx, "PROD_SCR_NOT_FOUND", 404, "Change request not found");
    if ((cr as JsonRecord).status !== "DRAFT") {
      return crError(req, ctx, "PROD_SCR_NOT_DRAFT", 422, "Only DRAFT change requests can be rejected");
    }

    const { error: updateErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_change_request")
      .update({ status: "REJECTED", reject_reason: reason })
      .eq("id", id);

    if (updateErr) throw new Error("PROD_SCR_REJECT_FAILED");

    return okResponse({ id, status: "REJECTED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_SCR_REJECT_FAILED";
    return crError(req, ctx, code, 500, "Stroke change request reject failed");
  }
}
