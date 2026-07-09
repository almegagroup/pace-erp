/*
 * File-ID: 27.1
 * File-Path: supabase/functions/api/_core/production/stroke_master.handlers.ts
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Stroke Master CRUD, approve, deactivate and reject handlers.
 *          QA/Operator creates (DRAFT), Manager/Auditor approves (APPROVED) or
 *          rejects (hard delete). APPROVED strokes can be deactivated (terminal,
 *          hidden from Process PO dropdown) or reverted to DRAFT for correction.
 *          See feasibility doc Section 83.3 (revised 2026-06-30).
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
  toUpperTrimmedString,
  getIdFromPath,
} from "./production.shared.ts";

type JsonRecord = Record<string, unknown>;

const MATERIAL_TYPES = new Set(["SFG", "INT"]);
const PO_TYPES_BY_MATERIAL_TYPE: Record<string, Set<string>> = {
  SFG: new Set(["MTO", "HPS", "MTS", "MTEST"]),
  INT: new Set(["INT"]),
};
const LINE_MATERIAL_TYPES = new Set(["RM", "INT"]);

function strokeError(
  req: Request,
  ctx: ProdHandlerContext,
  code: string,
  status: number,
  msg: string,
): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

async function getStrokeMaster(id: string): Promise<JsonRecord | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("stroke_master")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("PROD_STROKE_LOOKUP_FAILED");
  return (data as JsonRecord | null) ?? null;
}

function validateLines(lines: JsonRecord[]): string | null {
  if (lines.length === 0) return null;
  for (const l of lines) {
    const lineType = toUpperTrimmedString(l.line_material_type || "RM");
    if (!LINE_MATERIAL_TYPES.has(lineType)) return "PROD_STROKE_LINE_TYPE_INVALID";
    if (!toTrimmedString(l.material_id)) return "PROD_STROKE_LINE_MATERIAL_REQUIRED";
  }
  const totalDosage = lines.reduce((sum, l) => sum + (Number(l.dosage_pct) || 0), 0);
  if (Math.abs(totalDosage - 100) > 0.01) return "PROD_STROKE_DOSAGE_SUM";
  return null;
}

function buildLineRows(strokeMasterId: string, lines: JsonRecord[]) {
  return lines.map((l, idx) => ({
    stroke_master_id: strokeMasterId,
    material_id: toTrimmedString(l.material_id),
    line_material_type: toUpperTrimmedString(l.line_material_type || "RM"),
    material_group_id: toTrimmedString(l.material_group_id) || null,
    dosage_pct: Number(l.dosage_pct),
    display_order: idx,
  }));
}

// GET /api/production/stroke-masters
export async function listStrokeMastersHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const materialId = toTrimmedString(url.searchParams.get("material_id") ?? "");
    const status = toUpperTrimmedString(url.searchParams.get("status") ?? "");

    let query = serviceRoleClient
      .schema("erp_production")
      .from("stroke_master")
      .select(`
        id, company_id, prodshade_material_id, stroke_number, description,
        material_type, po_type, base_uom_code, conversion_uom_code, conversion_factor,
        status, created_by, created_at, approved_by, approved_at,
        deactivated_by, deactivated_at, last_updated_at, last_updated_by,
        material:erp_master.material_master!prodshade_material_id(
          id, pace_code, material_name, shade_code, pack_code
        )
      `)
      .order("created_at", { ascending: false });

    if (companyId) query = query.eq("company_id", companyId);
    if (materialId) query = query.eq("prodshade_material_id", materialId);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw new Error("PROD_STROKE_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_STROKE_LIST_FAILED";
    return strokeError(req, ctx, code, 500, "Stroke master list failed");
  }
}

// GET /api/production/stroke-masters/:id
export async function getStrokeMasterHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return strokeError(req, ctx, "PROD_STROKE_ID_MISSING", 400, "Stroke master ID required");

    const { data, error } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_master")
      .select(`
        id, company_id, prodshade_material_id, stroke_number, description,
        material_type, po_type, base_uom_code, conversion_uom_code, conversion_factor,
        status, created_by, created_at, approved_by, approved_at,
        deactivated_by, deactivated_at,
        material:erp_master.material_master!prodshade_material_id(
          id, pace_code, material_name, shade_code, pack_code
        ),
        lines:stroke_line(
          id, material_id, line_material_type, material_group_id, dosage_pct, display_order,
          material:erp_master.material_master!material_id(id, pace_code, material_name, base_uom_code),
          material_group:erp_master.material_category_group!material_group_id(id, group_code, group_name)
        )
      `)
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error("PROD_STROKE_FETCH_FAILED");
    if (!data) return strokeError(req, ctx, "PROD_STROKE_NOT_FOUND", 404, "Stroke master not found");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_STROKE_FETCH_FAILED";
    return strokeError(req, ctx, code, 500, "Stroke master fetch failed");
  }
}

// POST /api/production/stroke-masters
// Creates header + all lines in one call. Lines replace all existing lines.
export async function createStrokeMasterHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertProdReadRole(ctx); // Any user can create (QA role creates)
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const materialId = toTrimmedString(body.prodshade_material_id);
    const strokeNumber = toTrimmedString(body.stroke_number);
    const description = toTrimmedString(body.description);
    const materialType = toUpperTrimmedString(body.material_type || "SFG");
    const poType = toUpperTrimmedString(body.po_type);
    const baseUomCode = toTrimmedString(body.base_uom_code);
    const conversionUomCode = toTrimmedString(body.conversion_uom_code);
    const conversionFactor = body.conversion_factor === "" || body.conversion_factor == null
      ? null
      : Number(body.conversion_factor);
    const lines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];

    if (!companyId || !materialId || !strokeNumber) {
      return strokeError(req, ctx, "PROD_STROKE_INVALID", 400, "company_id, prodshade_material_id, stroke_number required");
    }
    if (!/^\d+$/.test(strokeNumber)) {
      return strokeError(req, ctx, "PROD_STROKE_NUMBER_NUMERIC", 400, "Stroke number must be numeric");
    }
    if (!MATERIAL_TYPES.has(materialType)) {
      return strokeError(req, ctx, "PROD_STROKE_MATERIAL_TYPE_INVALID", 400, "material_type must be SFG or INT");
    }
    if (!poType || !PO_TYPES_BY_MATERIAL_TYPE[materialType].has(poType)) {
      return strokeError(req, ctx, "PROD_STROKE_PO_TYPE_INVALID", 400, `po_type must be one of ${[...PO_TYPES_BY_MATERIAL_TYPE[materialType]].join(", ")} for material_type ${materialType}`);
    }
    if (!baseUomCode) {
      return strokeError(req, ctx, "PROD_STROKE_BASE_UOM_REQUIRED", 400, "base_uom_code required");
    }
    if (conversionFactor != null && !(conversionFactor > 0)) {
      return strokeError(req, ctx, "PROD_STROKE_CONVERSION_FACTOR_INVALID", 400, "conversion_factor must be > 0 when provided");
    }

    const lineErrorCode = validateLines(lines);
    if (lineErrorCode) {
      return strokeError(req, ctx, lineErrorCode, 400, "Stroke lines are invalid");
    }

    const { data: sm, error: smErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_master")
      .insert({
        company_id: companyId,
        prodshade_material_id: materialId,
        stroke_number: strokeNumber,
        description: description || null,
        material_type: materialType,
        po_type: poType,
        base_uom_code: baseUomCode,
        conversion_uom_code: conversionUomCode || null,
        conversion_factor: conversionFactor,
        status: "DRAFT",
        created_by: ctx.auth_user_id,
      })
      .select("id")
      .single();

    if (smErr) {
      if (smErr.code === "23505") {
        return strokeError(req, ctx, "PROD_STROKE_EXISTS", 409, "Stroke number already exists for this prodshade");
      }
      throw smErr;
    }

    if (lines.length > 0) {
      const { error: lErr } = await serviceRoleClient
        .schema("erp_production")
        .from("stroke_line")
        .insert(buildLineRows(sm.id as string, lines));
      if (lErr) throw new Error("PROD_STROKE_LINE_INSERT_FAILED");
    }

    return okResponse({ id: sm.id }, ctx.request_id, req, 201);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_STROKE_CREATE_FAILED";
    return strokeError(req, ctx, code, 500, "Stroke master create failed");
  }
}

// PATCH /api/production/stroke-masters/:id
// Update header + replace all lines. Only allowed while DRAFT (Manager edits
// here before Approve; Material Type / PO Type are immutable once created).
export async function updateStrokeMasterHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return strokeError(req, ctx, "PROD_STROKE_ID_MISSING", 400, "ID required");

    const existing = await getStrokeMaster(id);
    if (!existing) return strokeError(req, ctx, "PROD_STROKE_NOT_FOUND", 404, "Stroke master not found");
    if (existing.status !== "DRAFT") {
      return strokeError(req, ctx, "PROD_STROKE_APPROVED_LOCKED", 422, "Only DRAFT strokes can be edited");
    }

    const body = await parseBody(req);
    const description = toTrimmedString(body.description);
    const baseUomCode = toTrimmedString(body.base_uom_code) || (existing.base_uom_code as string);
    const conversionUomCode = toTrimmedString(body.conversion_uom_code);
    const conversionFactor = body.conversion_factor === "" || body.conversion_factor == null
      ? null
      : Number(body.conversion_factor);
    const lines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];

    if (conversionFactor != null && !(conversionFactor > 0)) {
      return strokeError(req, ctx, "PROD_STROKE_CONVERSION_FACTOR_INVALID", 400, "conversion_factor must be > 0 when provided");
    }
    const lineErrorCode = validateLines(lines);
    if (lineErrorCode) {
      return strokeError(req, ctx, lineErrorCode, 400, "Stroke lines are invalid");
    }

    await serviceRoleClient.schema("erp_production").from("stroke_master")
      .update({
        description: description || null,
        base_uom_code: baseUomCode || null,
        conversion_uom_code: conversionUomCode || null,
        conversion_factor: conversionFactor,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id);

    // Replace all lines
    await serviceRoleClient.schema("erp_production").from("stroke_line").delete().eq("stroke_master_id", id);
    if (lines.length > 0) {
      const { error: lErr } = await serviceRoleClient.schema("erp_production").from("stroke_line")
        .insert(buildLineRows(id, lines));
      if (lErr) throw new Error("PROD_STROKE_LINE_UPDATE_FAILED");
    }

    return okResponse({ id }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_STROKE_UPDATE_FAILED";
    return strokeError(req, ctx, code, 500, "Stroke master update failed");
  }
}

// POST /api/production/stroke-masters/:id/approve
// Manager/Auditor saves → status = APPROVED (= ACTIVE per 83.3 — visible in Process PO dropdown).
export async function approveStrokeMasterHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return strokeError(req, ctx, "PROD_STROKE_ID_MISSING", 400, "ID required");

    const existing = await getStrokeMaster(id);
    if (!existing) return strokeError(req, ctx, "PROD_STROKE_NOT_FOUND", 404, "Stroke master not found");
    if (existing.status !== "DRAFT") {
      return strokeError(req, ctx, "PROD_STROKE_ALREADY_APPROVED", 409, "Only DRAFT strokes can be approved");
    }

    // Check lines exist and dosage sums to 100
    const { data: lines } = await serviceRoleClient
      .schema("erp_production").from("stroke_line")
      .select("dosage_pct").eq("stroke_master_id", id);
    if (!lines || lines.length === 0) {
      return strokeError(req, ctx, "PROD_STROKE_NO_LINES", 422, "Cannot approve stroke with no RM lines");
    }
    const total = (lines as JsonRecord[]).reduce((s, l) => s + Number(l.dosage_pct), 0);
    if (Math.abs(total - 100) > 0.01) {
      return strokeError(req, ctx, "PROD_STROKE_DOSAGE_SUM", 422, `Dosage sum must be 100 (currently ${total.toFixed(2)})`);
    }

    const now = new Date().toISOString();
    const { error } = await serviceRoleClient.schema("erp_production").from("stroke_master")
      .update({ status: "APPROVED", approved_by: ctx.auth_user_id, approved_at: now, last_updated_at: now, last_updated_by: ctx.auth_user_id })
      .eq("id", id);
    if (error) throw new Error("PROD_STROKE_APPROVE_FAILED");

    return okResponse({ id, status: "APPROVED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_STROKE_APPROVE_FAILED";
    return strokeError(req, ctx, code, 500, "Stroke approve failed");
  }
}

// POST /api/production/stroke-masters/:id/reject
// Manager rejects a DRAFT stroke — hard delete (never reached ACTIVE, no PRUNE trail needed).
export async function rejectStrokeMasterHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return strokeError(req, ctx, "PROD_STROKE_ID_MISSING", 400, "ID required");

    const existing = await getStrokeMaster(id);
    if (!existing) return strokeError(req, ctx, "PROD_STROKE_NOT_FOUND", 404, "Not found");
    if (existing.status !== "DRAFT") {
      return strokeError(req, ctx, "PROD_STROKE_NOT_DRAFT", 422, "Only DRAFT strokes can be rejected");
    }

    await serviceRoleClient.schema("erp_production").from("stroke_line").delete().eq("stroke_master_id", id);
    const { error } = await serviceRoleClient.schema("erp_production").from("stroke_master").delete().eq("id", id);
    if (error) throw new Error("PROD_STROKE_REJECT_FAILED");

    return okResponse({ id, deleted: true }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_STROKE_REJECT_FAILED";
    return strokeError(req, ctx, code, 500, "Stroke reject failed");
  }
}

// POST /api/production/stroke-masters/:id/deactivate
// QA or Manager deactivates an APPROVED stroke — terminal, hidden from Process PO
// dropdown, existing Process Orders referencing it are unaffected.
export async function deactivateStrokeMasterHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return strokeError(req, ctx, "PROD_STROKE_ID_MISSING", 400, "ID required");

    const existing = await getStrokeMaster(id);
    if (!existing) return strokeError(req, ctx, "PROD_STROKE_NOT_FOUND", 404, "Not found");
    if (existing.status !== "APPROVED") {
      return strokeError(req, ctx, "PROD_STROKE_NOT_APPROVED", 422, "Only APPROVED strokes can be deactivated");
    }

    const now = new Date().toISOString();
    const { error } = await serviceRoleClient.schema("erp_production").from("stroke_master")
      .update({ status: "DEACTIVATED", deactivated_by: ctx.auth_user_id, deactivated_at: now, last_updated_at: now, last_updated_by: ctx.auth_user_id })
      .eq("id", id);
    if (error) throw new Error("PROD_STROKE_DEACTIVATE_FAILED");

    return okResponse({ id, status: "DEACTIVATED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_STROKE_DEACTIVATE_FAILED";
    return strokeError(req, ctx, code, 500, "Stroke deactivate failed");
  }
}

// POST /api/production/stroke-masters/:id/revert
// Manager can revert APPROVED → DRAFT for corrections.
export async function revertStrokeMasterHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return strokeError(req, ctx, "PROD_STROKE_ID_MISSING", 400, "ID required");

    const existing = await getStrokeMaster(id);
    if (!existing) return strokeError(req, ctx, "PROD_STROKE_NOT_FOUND", 404, "Not found");
    if (existing.status !== "APPROVED") {
      return strokeError(req, ctx, "PROD_STROKE_NOT_APPROVED", 422, "Only APPROVED strokes can be reverted");
    }

    // Cannot revert if any Process Orders reference this stroke
    const { count } = await serviceRoleClient.schema("erp_production").from("process_order")
      .select("id", { count: "exact", head: true }).eq("stroke_master_id", id)
      .not("status", "eq", "REVERSED");
    if ((count ?? 0) > 0) {
      return strokeError(req, ctx, "PROD_STROKE_IN_USE", 409, "Cannot revert — active Process Orders reference this stroke");
    }

    await serviceRoleClient.schema("erp_production").from("stroke_master")
      .update({ status: "DRAFT", approved_by: null, approved_at: null, last_updated_at: new Date().toISOString(), last_updated_by: ctx.auth_user_id })
      .eq("id", id);

    return okResponse({ id, status: "DRAFT" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_STROKE_REVERT_FAILED";
    return strokeError(req, ctx, code, 500, "Stroke revert failed");
  }
}
