/*
 * File-ID: 27.4
 * File-Path: supabase/functions/api/_core/production/pack_bom.handlers.ts
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Pack BOM and Pack BOM Change Request handlers (PR05–PR08).
 *          Manages packing material BOMs for FG SKUs.
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
  parsePositiveNumber,
  getIdFromPath,
} from "./production.shared.ts";

type JsonRecord = Record<string, unknown>;

function bomError(
  req: Request,
  ctx: ProdHandlerContext,
  code: string,
  status: number,
  msg: string,
): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

// ── PACK BOM ──────────────────────────────────────────────────────────────────

// GET /api/production/pack-boms
export async function listPackBomsHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const status = toTrimmedString(url.searchParams.get("status") ?? "");
    const skuMaterialId = toTrimmedString(url.searchParams.get("sku_material_id") ?? "");

    let query = serviceRoleClient
      .schema("erp_production")
      .from("pack_bom")
      .select(`
        id, sku_material_id, status, created_by, created_at, approved_by, approved_at,
        sku:erp_master.material_master!sku_material_id(
          id, pace_code, material_name, material_type, pack_code, shade_code
        )
      `)
      .order("created_at", { ascending: false });

    if (status) query = query.eq("status", status);
    if (skuMaterialId) query = query.eq("sku_material_id", skuMaterialId);

    const { data, error } = await query;
    if (error) throw new Error("PROD_BOM_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BOM_LIST_FAILED";
    return bomError(req, ctx, code, 500, "Pack BOM list failed");
  }
}

// GET /api/production/pack-boms/:id
export async function getPackBomHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return bomError(req, ctx, "PROD_BOM_ID_MISSING", 400, "Pack BOM ID required");

    const { data, error } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom")
      .select(`
        id, sku_material_id, status, created_by, created_at, approved_by, approved_at, reject_reason,
        sku:erp_master.material_master!sku_material_id(
          id, pace_code, material_name, material_type, pack_code, shade_code
        ),
        lines:pack_bom_line(
          id, pack_bom_id, line_type, material_id, qty, uom_code, has_alternate, material_group_id, display_order,
          material:erp_master.material_master!material_id(id, pace_code, material_name, base_uom_code)
        )
      `)
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error("PROD_BOM_FETCH_FAILED");
    if (!data) return bomError(req, ctx, "PROD_BOM_NOT_FOUND", 404, "Pack BOM not found");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BOM_FETCH_FAILED";
    return bomError(req, ctx, code, 500, "Pack BOM fetch failed");
  }
}

// POST /api/production/pack-boms
export async function createPackBomHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const skuMaterialId = toTrimmedString(body.sku_material_id);
    const lines = Array.isArray(body.lines) ? body.lines : [];

    if (!skuMaterialId) {
      return bomError(req, ctx, "PROD_BOM_INVALID", 400, "sku_material_id required");
    }

    // Validate SKU exists and is type FG
    const { data: sku, error: skuErr } = await serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .select("id, material_type, pack_code")
      .eq("id", skuMaterialId)
      .maybeSingle();

    if (skuErr) throw new Error("PROD_BOM_SKU_LOOKUP_FAILED");
    if (!sku) return bomError(req, ctx, "PROD_BOM_SKU_NOT_FOUND", 404, "FG SKU material not found");
    if ((sku as JsonRecord).material_type !== "FG") {
      return bomError(req, ctx, "PROD_BOM_NOT_FG", 422, "Pack BOM can only be created for FG materials");
    }

    // Check no existing DRAFT or ACTIVE BOM for this SKU
    const { count: existingCount } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom")
      .select("id", { count: "exact", head: true })
      .eq("sku_material_id", skuMaterialId)
      .in("status", ["DRAFT", "ACTIVE"]);

    if ((existingCount ?? 0) > 0) {
      return bomError(req, ctx, "PROD_BOM_ALREADY_EXISTS", 409, "A DRAFT or ACTIVE Pack BOM already exists for this SKU");
    }

    // Determine if BOM required based on pack_code_master
    const packCode = toTrimmedString((sku as JsonRecord).pack_code);
    let bomRequired = true;
    if (packCode) {
      const { data: pcm } = await serviceRoleClient
        .schema("erp_production")
        .from("pack_code_master")
        .select("bom_required")
        .eq("pack_code", packCode)
        .maybeSingle();
      if (pcm) bomRequired = Boolean((pcm as JsonRecord).bom_required);
    }

    // Auto-approve if bom_required = false (599, 000, 001)
    const initialStatus = bomRequired ? "DRAFT" : "ACTIVE";
    const now = new Date().toISOString();

    const insertRow: JsonRecord = {
      sku_material_id: skuMaterialId,
      status: initialStatus,
      created_by: ctx.auth_user_id,
    };
    if (!bomRequired) {
      insertRow.approved_by = ctx.auth_user_id;
      insertRow.approved_at = now;
    }

    const { data: bom, error: bomErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom")
      .insert(insertRow)
      .select("id")
      .single();

    if (bomErr) throw new Error("PROD_BOM_CREATE_FAILED");
    const bomId = (bom as JsonRecord).id as string;

    // Insert lines
    if (lines.length > 0) {
      const lineRows = lines.map((l: JsonRecord, idx: number) => ({
        pack_bom_id: bomId,
        line_type: toTrimmedString(l.line_type) || "INPUT",
        material_id: toTrimmedString(l.material_id) || null,
        qty: parsePositiveNumber(l.qty) ?? 0,
        uom_code: toTrimmedString(l.uom_code) || null,
        has_alternate: l.has_alternate === true || l.has_alternate === "true",
        material_group_id: toTrimmedString(l.material_group_id) || null,
        display_order: idx,
      }));

      const { error: lErr } = await serviceRoleClient
        .schema("erp_production")
        .from("pack_bom_line")
        .insert(lineRows);

      if (lErr) throw new Error("PROD_BOM_LINES_INSERT_FAILED");
    }

    return okResponse(
      { id: bomId, status: initialStatus, auto_approved: !bomRequired },
      ctx.request_id,
      req,
      201,
    );
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BOM_CREATE_FAILED";
    return bomError(req, ctx, code, 500, "Pack BOM create failed");
  }
}

// POST /api/production/pack-boms/:id/approve
export async function approvePackBomHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return bomError(req, ctx, "PROD_BOM_ID_MISSING", 400, "ID required");

    const body = await parseBody(req);
    const editedLines: JsonRecord[] = Array.isArray(body.lines) ? body.lines : [];

    const { data: bom, error: bomFetchErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom")
      .select("id, status, sku_material_id")
      .eq("id", id)
      .maybeSingle();

    if (bomFetchErr) throw new Error("PROD_BOM_FETCH_FAILED");
    if (!bom) return bomError(req, ctx, "PROD_BOM_NOT_FOUND", 404, "Pack BOM not found");
    if ((bom as JsonRecord).status !== "DRAFT") {
      return bomError(req, ctx, "PROD_BOM_NOT_DRAFT", 422, "Only DRAFT Pack BOMs can be approved");
    }

    // If reviewer provided edited lines, replace existing lines
    if (editedLines.length > 0) {
      await serviceRoleClient
        .schema("erp_production")
        .from("pack_bom_line")
        .delete()
        .eq("pack_bom_id", id);

      const lineRows = editedLines.map((l: JsonRecord, idx: number) => ({
        pack_bom_id: id,
        line_type: toTrimmedString(l.line_type) || "INPUT",
        material_id: toTrimmedString(l.material_id) || null,
        qty: parsePositiveNumber(l.qty) ?? 0,
        uom_code: toTrimmedString(l.uom_code) || null,
        has_alternate: l.has_alternate === true || l.has_alternate === "true",
        material_group_id: toTrimmedString(l.material_group_id) || null,
        display_order: idx,
      }));

      const { error: lErr } = await serviceRoleClient
        .schema("erp_production")
        .from("pack_bom_line")
        .insert(lineRows);

      if (lErr) throw new Error("PROD_BOM_LINES_UPDATE_FAILED");
    }

    const now = new Date().toISOString();
    const { error: updateErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom")
      .update({ status: "ACTIVE", approved_by: ctx.auth_user_id, approved_at: now })
      .eq("id", id);

    if (updateErr) throw new Error("PROD_BOM_APPROVE_FAILED");

    return okResponse({ id, status: "ACTIVE" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BOM_APPROVE_FAILED";
    return bomError(req, ctx, code, 500, "Pack BOM approve failed");
  }
}

// POST /api/production/pack-boms/:id/reject
export async function rejectPackBomHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return bomError(req, ctx, "PROD_BOM_ID_MISSING", 400, "ID required");

    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason);
    if (!reason) {
      return bomError(req, ctx, "PROD_BOM_REASON_REQUIRED", 400, "Reject reason is required");
    }

    const { data: bom, error: bomFetchErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();

    if (bomFetchErr) throw new Error("PROD_BOM_FETCH_FAILED");
    if (!bom) return bomError(req, ctx, "PROD_BOM_NOT_FOUND", 404, "Pack BOM not found");
    if ((bom as JsonRecord).status !== "DRAFT") {
      return bomError(req, ctx, "PROD_BOM_NOT_DRAFT", 422, "Only DRAFT Pack BOMs can be rejected");
    }

    // Reject → stay DRAFT (for revision), record reason
    const { error: updateErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom")
      .update({ reject_reason: reason })
      .eq("id", id);

    if (updateErr) throw new Error("PROD_BOM_REJECT_FAILED");

    return okResponse({ id, status: "DRAFT", reject_reason: reason }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BOM_REJECT_FAILED";
    return bomError(req, ctx, code, 500, "Pack BOM reject failed");
  }
}

// ── PACK BOM CHANGE REQUESTS ───────────────────────────────────────────────

// POST /api/production/pack-boms/:id/change-request
export async function createPackBomChangeRequestHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return bomError(req, ctx, "PROD_BOM_ID_MISSING", 400, "Pack BOM ID required");

    const body = await parseBody(req);
    const changes: JsonRecord[] = Array.isArray(body.changes) ? body.changes : [];

    if (changes.length === 0) {
      return bomError(req, ctx, "PROD_BCR_NO_CHANGES", 400, "At least one change required");
    }

    // Validate BOM is ACTIVE
    const { data: bom, error: bomFetchErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();

    if (bomFetchErr) throw new Error("PROD_BOM_FETCH_FAILED");
    if (!bom) return bomError(req, ctx, "PROD_BOM_NOT_FOUND", 404, "Pack BOM not found");
    if ((bom as JsonRecord).status !== "ACTIVE") {
      return bomError(req, ctx, "PROD_BCR_BOM_NOT_ACTIVE", 422, "Change requests can only be created for ACTIVE Pack BOMs");
    }

    // Check no existing DRAFT change request for this BOM
    const { count: draftCount } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom_change_request")
      .select("id", { count: "exact", head: true })
      .eq("pack_bom_id", id)
      .eq("status", "DRAFT");

    if ((draftCount ?? 0) > 0) {
      return bomError(req, ctx, "PROD_BCR_ALREADY_PENDING", 409, "A pending change request already exists for this BOM");
    }

    // Insert change request
    const { data: cr, error: crErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom_change_request")
      .insert({ pack_bom_id: id, status: "DRAFT", created_by: ctx.auth_user_id })
      .select("id")
      .single();

    if (crErr) throw new Error("PROD_BCR_CREATE_FAILED");
    const crId = (cr as JsonRecord).id as string;

    // Insert change lines
    const lineRows = changes.map((c: JsonRecord, idx: number) => ({
      change_request_id: crId,
      action: toTrimmedString(c.action) || "EDIT",
      bom_line_id: toTrimmedString(c.bom_line_id) || null,
      material_id: toTrimmedString(c.material_id) || null,
      qty: c.qty != null ? (parsePositiveNumber(c.qty) ?? 0) : null,
      uom_code: toTrimmedString(c.uom_code) || null,
      has_alternate: c.has_alternate === true || c.has_alternate === "true",
      material_group_id: toTrimmedString(c.material_group_id) || null,
      display_order: idx,
    }));

    const { error: lErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom_change_request_line")
      .insert(lineRows);

    if (lErr) throw new Error("PROD_BCR_LINES_INSERT_FAILED");

    return okResponse({ id: crId }, ctx.request_id, req, 201);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BCR_CREATE_FAILED";
    return bomError(req, ctx, code, 500, "Pack BOM change request create failed");
  }
}

// GET /api/production/pack-bom-change-requests
export async function listPackBomChangeRequestsHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const status = toTrimmedString(url.searchParams.get("status") ?? "");
    const packBomId = toTrimmedString(url.searchParams.get("pack_bom_id") ?? "");

    let query = serviceRoleClient
      .schema("erp_production")
      .from("pack_bom_change_request")
      .select(`
        id, pack_bom_id, status, created_by, created_at, approved_by, approved_at, reject_reason,
        bom:pack_bom!pack_bom_id(
          id, sku_material_id, status,
          sku:erp_master.material_master!sku_material_id(id, pace_code, material_name, pack_code)
        )
      `)
      .order("created_at", { ascending: false });

    if (status) query = query.eq("status", status);
    if (packBomId) query = query.eq("pack_bom_id", packBomId);

    const { data, error } = await query;
    if (error) throw new Error("PROD_BCR_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BCR_LIST_FAILED";
    return bomError(req, ctx, code, 500, "Pack BOM change request list failed");
  }
}

// POST /api/production/pack-bom-change-requests/:id/approve
export async function approvePackBomChangeRequestHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return bomError(req, ctx, "PROD_BCR_ID_MISSING", 400, "ID required");

    const body = await parseBody(req);
    const editedChanges: JsonRecord[] = Array.isArray(body.changes) ? body.changes : [];

    // Fetch change request
    const { data: cr, error: crFetchErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom_change_request")
      .select("id, status, pack_bom_id")
      .eq("id", id)
      .maybeSingle();

    if (crFetchErr) throw new Error("PROD_BCR_FETCH_FAILED");
    if (!cr) return bomError(req, ctx, "PROD_BCR_NOT_FOUND", 404, "Change request not found");
    if ((cr as JsonRecord).status !== "DRAFT") {
      return bomError(req, ctx, "PROD_BCR_NOT_DRAFT", 422, "Only DRAFT change requests can be approved");
    }

    const packBomId = (cr as JsonRecord).pack_bom_id as string;

    // Determine changes to apply
    let changesToApply: JsonRecord[] = editedChanges;
    if (changesToApply.length === 0) {
      const { data: dbLines } = await serviceRoleClient
        .schema("erp_production")
        .from("pack_bom_change_request_line")
        .select("action, bom_line_id, material_id, qty, uom_code, has_alternate, material_group_id, display_order")
        .eq("change_request_id", id)
        .order("display_order");
      changesToApply = (dbLines ?? []) as JsonRecord[];
    }

    // ADD/REMOVE/EDIT each target a distinct bom_line_id (ADD creates a new
    // row nothing else in this batch references), so each is independent —
    // but dedupe EDITs by bom_line_id first (keep last, matching the original
    // sequential last-write-wins) in case the same line appears twice, then
    // batch REMOVE as one delete and run ADD/EDIT writes in parallel.
    const adds = changesToApply.filter((change) => toTrimmedString(change.action) === "ADD");
    const removeIds = [...new Set(
      changesToApply
        .filter((change) => toTrimmedString(change.action) === "REMOVE")
        .map((change) => toTrimmedString(change.bom_line_id))
        .filter(Boolean),
    )];
    const editByBomLineId = new Map<string, JsonRecord>();
    for (const change of changesToApply) {
      if (toTrimmedString(change.action) !== "EDIT") continue;
      const bomLineId = toTrimmedString(change.bom_line_id);
      if (!bomLineId) continue;
      const update: JsonRecord = {};
      if (change.material_id != null) update.material_id = toTrimmedString(change.material_id) || null;
      if (change.qty != null) update.qty = parsePositiveNumber(change.qty) ?? 0;
      if (change.uom_code != null) update.uom_code = toTrimmedString(change.uom_code) || null;
      if (change.has_alternate != null) update.has_alternate = change.has_alternate === true || change.has_alternate === "true";
      if (change.material_group_id != null) update.material_group_id = toTrimmedString(change.material_group_id) || null;
      if (Object.keys(update).length > 0) {
        editByBomLineId.set(bomLineId, update);
      }
    }

    await Promise.all([
      ...adds.map((change) =>
        serviceRoleClient
          .schema("erp_production")
          .from("pack_bom_line")
          .insert({
            pack_bom_id: packBomId,
            line_type: "INPUT",
            material_id: toTrimmedString(change.material_id) || null,
            qty: parsePositiveNumber(change.qty) ?? 0,
            uom_code: toTrimmedString(change.uom_code) || null,
            has_alternate: change.has_alternate === true || change.has_alternate === "true",
            material_group_id: toTrimmedString(change.material_group_id) || null,
            display_order: Number(change.display_order) || 999,
          })
      ),
      removeIds.length > 0
        ? serviceRoleClient.schema("erp_production").from("pack_bom_line").delete().in("id", removeIds)
        : Promise.resolve(),
      ...[...editByBomLineId.entries()].map(([bomLineId, update]) =>
        serviceRoleClient
          .schema("erp_production")
          .from("pack_bom_line")
          .update(update)
          .eq("id", bomLineId)
      ),
    ]);

    const now = new Date().toISOString();
    const { error: updateErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom_change_request")
      .update({ status: "APPROVED", approved_by: ctx.auth_user_id, approved_at: now })
      .eq("id", id);

    if (updateErr) throw new Error("PROD_BCR_APPROVE_FAILED");

    return okResponse({ id, status: "APPROVED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BCR_APPROVE_FAILED";
    return bomError(req, ctx, code, 500, "Pack BOM change request approve failed");
  }
}

// POST /api/production/pack-bom-change-requests/:id/reject
export async function rejectPackBomChangeRequestHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return bomError(req, ctx, "PROD_BCR_ID_MISSING", 400, "ID required");

    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason);
    if (!reason) {
      return bomError(req, ctx, "PROD_BCR_REASON_REQUIRED", 400, "Reject reason is required");
    }

    const { data: cr, error: crFetchErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom_change_request")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();

    if (crFetchErr) throw new Error("PROD_BCR_FETCH_FAILED");
    if (!cr) return bomError(req, ctx, "PROD_BCR_NOT_FOUND", 404, "Change request not found");
    if ((cr as JsonRecord).status !== "DRAFT") {
      return bomError(req, ctx, "PROD_BCR_NOT_DRAFT", 422, "Only DRAFT change requests can be rejected");
    }

    const { error: updateErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom_change_request")
      .update({ status: "REJECTED", reject_reason: reason })
      .eq("id", id);

    if (updateErr) throw new Error("PROD_BCR_REJECT_FAILED");

    return okResponse({ id, status: "REJECTED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BCR_REJECT_FAILED";
    return bomError(req, ctx, code, 500, "Pack BOM change request reject failed");
  }
}
