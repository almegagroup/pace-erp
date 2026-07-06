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

// GET /api/production/pack-configs?material_id=
export async function listPackConfigsHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const materialId = toTrimmedString(url.searchParams.get("material_id") ?? "");

    let query = serviceRoleClient
      .schema("erp_production").from("prodshade_pack_config")
      .select(`
        id, material_id, pack_code_id, fill_qty, variant, active, created_at,
        pack_code:pack_code_master!pack_code_id(id, pack_code, pack_type, billing_uom, bom_required)
      `)
      .order("created_at");

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
    const materialId = toTrimmedString(body.material_id);
    const packCodeId = toTrimmedString(body.pack_code_id);
    const variant = toTrimmedString(body.variant ?? "");
    const fillQty = body.fill_qty != null ? parsePositiveNumber(body.fill_qty) : null;

    if (!materialId || !packCodeId) {
      return packError(req, ctx, "PROD_PACK_CONFIG_INVALID", 400, "material_id and pack_code_id required");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_production").from("prodshade_pack_config")
      .upsert(
        { material_id: materialId, pack_code_id: packCodeId, variant: variant || null, fill_qty: fillQty, active: true, created_by: ctx.auth_user_id },
        { onConflict: "material_id,pack_code_id" }
      )
      .select("id").single();

    if (error) throw new Error("PROD_PACK_CONFIG_UPSERT_FAILED");

    const configId = (data as JsonRecord).id as string;

    // ── FG Material Auto-Create ────────────────────────────────────────────────
    // After successful pack config upsert, ensure an FG material exists for this SKU combination.
    let fgMaterialId: string | null = null;
    let fgPaceCode: string | null = null;

    try {
      // 1. Get prodshade material details
      const { data: prodshade } = await serviceRoleClient
        .schema("erp_master").from("material_master")
        .select("shade_code, material_name, production_mode")
        .eq("id", materialId)
        .maybeSingle();

      // 2. Get pack code details
      const { data: packCodeRow } = await serviceRoleClient
        .schema("erp_production").from("pack_code_master")
        .select("pack_code, description")
        .eq("id", packCodeId)
        .maybeSingle();

      if (prodshade && packCodeRow) {
        const shadeCode = toTrimmedString((prodshade as JsonRecord).shade_code);
        const packCode = toTrimmedString((packCodeRow as JsonRecord).pack_code);
        const prodMode = toTrimmedString((prodshade as JsonRecord).production_mode ?? "");

        // 3. Build SKU string: shade_code + '-' + pack_code + (variant ? '-' + variant : '')
        const skuString = [shadeCode, packCode, variant || ""].filter(Boolean).join("-");

        // 4. Check if FG already exists
        const { data: existingFg } = await serviceRoleClient
          .schema("erp_master").from("material_master")
          .select("id, pace_code")
          .eq("material_type", "FG")
          .eq("external_code", skuString)
          .maybeSingle();

        if (existingFg) {
          fgMaterialId = String((existingFg as JsonRecord).id);
          fgPaceCode = String((existingFg as JsonRecord).pace_code);
        } else {
          // 5. Generate pace_code by counting existing FG materials
          const { count: fgCount } = await serviceRoleClient
            .schema("erp_master").from("material_master")
            .select("id", { count: "exact", head: true })
            .eq("material_type", "FG");

          const nextNum = (fgCount ?? 0) + 1;
          const newPaceCode = `FG-${String(nextNum).padStart(5, "0")}`;

          // Determine naming based on production_mode
          const isMtoOrHps = prodMode === "LIQUID_ADMIX" || prodMode === "LIQUID_HPS";
          const packCodeDesc = toTrimmedString((packCodeRow as JsonRecord).description ?? packCode);
          const materialName = (prodshade as JsonRecord).material_name as string ?? skuString;

          const humanName = isMtoOrHps ? skuString : packCodeDesc || skuString;
          const docName = isMtoOrHps ? (packCodeDesc || skuString) : skuString;

          const shortName = skuString.length > 50 ? skuString.slice(0, 50) : skuString;

          // 6. Insert new FG material
          const { data: newFg, error: fgInsertErr } = await serviceRoleClient
            .schema("erp_master").from("material_master")
            .insert({
              pace_code: newPaceCode,
              external_code: skuString,
              material_name: humanName || materialName,
              short_name: shortName,
              material_type: "FG",
              base_uom_code: "KG",
              shade_code: shadeCode || null,
              pack_code: packCode || null,
              procurement_type: "IN_HOUSE",
              import_domestic_flag: "DOMESTIC",
              status: "ACTIVE",
              valuation_method: "WEIGHTED_AVERAGE",
              batch_tracking_required: true,
              fifo_tracking_enabled: true,
              expiry_tracking_enabled: false,
              qa_required_on_inward: false,
              qa_required_on_fg: true,
              bom_exists: false,
              delivery_tolerance_enabled: false,
              document_name: docName || null,
              created_by: ctx.auth_user_id,
            })
            .select("id, pace_code")
            .single();

          if (!fgInsertErr && newFg) {
            fgMaterialId = String((newFg as JsonRecord).id);
            fgPaceCode = String((newFg as JsonRecord).pace_code);
          }
        }
      }
    } catch {
      // FG auto-create is best-effort; pack config success is the primary result
    }

    return okResponse(
      { id: configId, fg_material_id: fgMaterialId, fg_pace_code: fgPaceCode },
      ctx.request_id,
      req,
      200,
    );
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
