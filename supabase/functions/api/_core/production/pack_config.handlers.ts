/*
 * File-ID: 27.2
 * File-Path: supabase/functions/api/_core/production/pack_config.handlers.ts
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Pack Code Master (SA) and Prodshade Pack Config (Manager) handlers.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import {
  assertSARole,
  assertManagerOrSARole,
  assertProdReadRole,
  parseBody,
  toTrimmedString,
  toUpperTrimmedString,
  parsePositiveNumber,
  getIdFromPath,
} from "./production.shared.ts";

type JsonRecord = Record<string, unknown>;

function packError(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

// ── PACK CODE MASTER (SA only) ─────────────────────────────────────────────

// GET /api/production/pack-codes
export async function listPackCodesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const { data, error } = await serviceRoleClient
      .schema("erp_production").from("pack_code_master")
      .select("*").order("pack_code");
    if (error) throw new Error("PROD_PACK_CODE_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_CODE_LIST_FAILED";
    return packError(req, ctx, code, 500, "Pack code list failed");
  }
}

// POST /api/production/pack-codes/toggle
export async function togglePackCodeHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    const active = body.active === true || body.active === "true";
    if (!id) return packError(req, ctx, "PROD_PACK_CODE_ID_MISSING", 400, "ID required");

    const { error } = await serviceRoleClient
      .schema("erp_production").from("pack_code_master")
      .update({ active }).eq("id", id);
    if (error) throw new Error("PROD_PACK_CODE_TOGGLE_FAILED");
    return okResponse({ id, active }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_CODE_TOGGLE_FAILED";
    return packError(req, ctx, code, 500, "Pack code toggle failed");
  }
}

// ── PRODSHADE PACK CONFIG (Manager/SA) ────────────────────────────────────

// GET /api/production/pack-configs?company_id=&material_id=
export async function listPackConfigsHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const materialId = toTrimmedString(url.searchParams.get("material_id") ?? "");

    let query = serviceRoleClient
      .schema("erp_production").from("prodshade_pack_config")
      .select(`
        id, company_id, material_id, fill_qty, active, created_at,
        pack_code:pack_code_master!pack_code_id(id, pack_code, pack_name, pack_type, billing_uom),
        material:erp_master.material_master!material_id(id, pace_code, material_name, shade_code)
      `)
      .order("created_at");

    if (companyId) query = query.eq("company_id", companyId);
    if (materialId) query = query.eq("material_id", materialId);

    const { data, error } = await query;
    if (error) throw new Error("PROD_PACK_CONFIG_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_CONFIG_LIST_FAILED";
    return packError(req, ctx, code, 500, "Pack config list failed");
  }
}

// POST /api/production/pack-configs
export async function upsertPackConfigHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const materialId = toTrimmedString(body.material_id);
    const packCodeId = toTrimmedString(body.pack_code_id);
    const fillQty = body.fill_qty != null ? parsePositiveNumber(body.fill_qty) : null;

    if (!companyId || !materialId || !packCodeId) {
      return packError(req, ctx, "PROD_PACK_CONFIG_INVALID", 400, "company_id, material_id, pack_code_id required");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_production").from("prodshade_pack_config")
      .upsert(
        { company_id: companyId, material_id: materialId, pack_code_id: packCodeId, fill_qty: fillQty, active: true, created_by: ctx.auth_user_id },
        { onConflict: "company_id,material_id,pack_code_id" }
      )
      .select("id").single();

    if (error) throw new Error("PROD_PACK_CONFIG_UPSERT_FAILED");
    return okResponse({ id: (data as JsonRecord).id }, ctx.request_id, req, 200);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_CONFIG_UPSERT_FAILED";
    return packError(req, ctx, code, 500, "Pack config upsert failed");
  }
}

// DELETE /api/production/pack-configs/:id
export async function deletePackConfigHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return packError(req, ctx, "PROD_PACK_CONFIG_ID_MISSING", 400, "ID required");

    const { error } = await serviceRoleClient
      .schema("erp_production").from("prodshade_pack_config").delete().eq("id", id);
    if (error) throw new Error("PROD_PACK_CONFIG_DELETE_FAILED");
    return okResponse({ id }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_CONFIG_DELETE_FAILED";
    return packError(req, ctx, code, 500, "Pack config delete failed");
  }
}
