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

function normalizeNullableString(value: unknown): string {
  return toTrimmedString(value ?? "");
}

function normalizeNullableNumber(value: unknown): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : "";
}

function buildFgSku(prodshadeCode: string, packCode: string, variant: string): string {
  return [
    normalizeNullableString(prodshadeCode),
    normalizeNullableString(packCode),
    normalizeNullableString(variant),
  ].join("");
}

async function resolvePackCodeRow(packCodeId: string): Promise<JsonRecord | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("pack_code_master")
    .select("id, pack_code, pack_name, pack_type, billing_uom, bom_required, description, active")
    .eq("id", packCodeId)
    .maybeSingle();
  if (error) {
    console.error("[pack_config.resolvePackCodeRow] lookup failed:", JSON.stringify(error));
    throw new Error("PROD_PACK_CODE_LOOKUP_FAILED");
  }
  return (data as JsonRecord | null) ?? null;
}

async function resolveProdshadeRow(materialId: string): Promise<JsonRecord | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, shade_code, material_name, document_name, production_mode, external_code")
    .eq("id", materialId)
    .maybeSingle();
  if (error) {
    console.error("[pack_config.resolveProdshadeRow] lookup failed:", JSON.stringify(error));
    throw new Error("PROD_PACK_CONFIG_MATERIAL_LOOKUP_FAILED");
  }
  return (data as JsonRecord | null) ?? null;
}

async function resolveFgMaterial(materialId: string, packCodeId: string, variant: string): Promise<{
  fgMaterialId: string | null;
  fgPaceCode: string | null;
  skuString: string | null;
  packCodeRow: JsonRecord | null;
  prodshade: JsonRecord | null;
}> {
  const [prodshade, packCodeRow] = await Promise.all([
    resolveProdshadeRow(materialId),
    resolvePackCodeRow(packCodeId),
  ]);

  if (!prodshade || !packCodeRow) {
    return { fgMaterialId: null, fgPaceCode: null, skuString: null, packCodeRow, prodshade };
  }

  const prodshadeCode = normalizeNullableString(prodshade.external_code);
  const packCode = normalizeNullableString(packCodeRow.pack_code);
  if (!prodshadeCode || !packCode) {
    return { fgMaterialId: null, fgPaceCode: null, skuString: null, packCodeRow, prodshade };
  }

  const skuString = buildFgSku(prodshadeCode, packCode, variant);
  const { data: existingFg, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, pace_code")
    .eq("material_type", "FG")
    .eq("external_code", skuString)
    .maybeSingle();

  if (error) {
    console.error("[pack_config.resolveFgMaterial] FG lookup failed:", JSON.stringify(error));
    throw new Error("PROD_PACK_CONFIG_FG_LOOKUP_FAILED");
  }

  return {
    fgMaterialId: existingFg ? String((existingFg as JsonRecord).id) : null,
    fgPaceCode: existingFg ? String((existingFg as JsonRecord).pace_code) : null,
    skuString,
    packCodeRow,
    prodshade,
  };
}

async function ensureFgMaterialForConfig(
  materialId: string,
  packCodeId: string,
  variant: string,
  ctx: ProdHandlerContext,
): Promise<{ fgMaterialId: string | null; fgPaceCode: string | null }> {
  const resolved = await resolveFgMaterial(materialId, packCodeId, variant);
  if (!resolved.prodshade || !resolved.packCodeRow || !resolved.skuString) {
    return { fgMaterialId: null, fgPaceCode: null };
  }
  const prodshadeDescription = normalizeNullableString(
    resolved.prodshade.document_name ?? resolved.prodshade.material_name ?? resolved.skuString,
  );
  const desiredDocName = prodshadeDescription || null;
  if (resolved.fgMaterialId) {
    await serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .update({
        external_code: resolved.skuString,
        material_name: resolved.skuString,
        short_name: resolved.skuString.length > 50 ? resolved.skuString.slice(0, 50) : resolved.skuString,
        document_name: desiredDocName,
      })
      .eq("id", resolved.fgMaterialId);
    return { fgMaterialId: resolved.fgMaterialId, fgPaceCode: resolved.fgPaceCode };
  }

  const prodshade = resolved.prodshade;
  const packCodeRow = resolved.packCodeRow;
  const skuString = resolved.skuString;
  const shadeCode = normalizeNullableString(prodshade.shade_code);
  const packCode = normalizeNullableString(packCodeRow.pack_code);

  const fgCountResult = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id", { count: "exact", head: true })
    .eq("material_type", "FG") as { count?: number };

  const nextNum = (fgCountResult.count ?? 0) + 1;
  const newPaceCode = `FG-${String(nextNum).padStart(5, "0")}`;
  const shortName = skuString.length > 50 ? skuString.slice(0, 50) : skuString;

  const { data: newFg, error: fgInsertErr } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .insert({
      pace_code: newPaceCode,
      external_code: skuString,
      material_name: skuString,
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
      document_name: desiredDocName,
      created_by: ctx.auth_user_id,
    })
    .select("id, pace_code")
    .single();

  if (fgInsertErr || !newFg) {
    return { fgMaterialId: null, fgPaceCode: null };
  }

  return {
    fgMaterialId: String((newFg as JsonRecord).id),
    fgPaceCode: String((newFg as JsonRecord).pace_code),
  };
}

// GET /api/production/pack-codes
export async function listPackCodesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const { data, error } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_code_master")
      .select("id, pack_code, pack_name, pack_type, billing_uom, bom_required, description, active, created_at")
      .order("pack_code");
    if (error) {
      console.error("[pack_config.listPackCodes] query failed:", JSON.stringify(error));
      throw new Error("PROD_PACK_CODE_LIST_FAILED");
    }
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_CODE_LIST_FAILED";
    console.error("[pack_config.listPackCodes] request_id:", ctx.request_id, "error:", err);
    return packError(req, ctx, code, 500, "Pack code list failed");
  }
}

// POST /api/production/pack-codes
export async function createPackCodeHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const body = await parseBody(req);
    const packCode = toUpperTrimmedString(body.pack_code);
    const packName = toTrimmedString(body.pack_name ?? body.description);
    const packType = toUpperTrimmedString(body.pack_type);
    const billingUom = toUpperTrimmedString(body.billing_uom);
    const description = toTrimmedString(body.description);
    const bomRequired = body.bom_required === true || body.bom_required === "true";

    if (!packCode || !packName || !packType || !billingUom) {
      return packError(req, ctx, "PROD_PACK_CODE_INVALID", 400, "pack_code, pack_name, pack_type, and billing_uom are required");
    }

    const { data: existing, error: existingErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_code_master")
      .select("id")
      .eq("pack_code", packCode)
      .maybeSingle();
    if (existingErr) throw new Error("PROD_PACK_CODE_LOOKUP_FAILED");
    if (existing) {
      return packError(req, ctx, "PROD_PACK_CODE_EXISTS", 409, "Pack code already exists");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_code_master")
      .insert({
        pack_code: packCode,
        pack_name: packName,
        pack_type: packType,
        billing_uom: billingUom,
        bom_required: bomRequired,
        description: description || null,
        active: true,
      })
      .select("id, pack_code, pack_name, pack_type, billing_uom, bom_required, description, active, created_at")
      .single();

    if (error) throw new Error("PROD_PACK_CODE_CREATE_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_CODE_CREATE_FAILED";
    console.error("[pack_config.createPackCode] request_id:", ctx.request_id, "error:", err);
    return packError(req, ctx, code, 500, "Pack code create failed");
  }
}

// PATCH /api/production/pack-codes/:id
export async function updatePackCodeHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return packError(req, ctx, "PROD_PACK_CODE_ID_MISSING", 400, "ID required");

    const body = await parseBody(req);
    const updates = {
      pack_name: toTrimmedString(body.pack_name ?? body.description) || null,
      pack_type: toUpperTrimmedString(body.pack_type) || null,
      billing_uom: toUpperTrimmedString(body.billing_uom) || null,
      bom_required: body.bom_required === true || body.bom_required === "true",
      description: toTrimmedString(body.description) || null,
    };

    if (!updates.pack_name || !updates.pack_type || !updates.billing_uom) {
      return packError(req, ctx, "PROD_PACK_CODE_INVALID", 400, "pack_name, pack_type, and billing_uom are required");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_code_master")
      .update(updates)
      .eq("id", id)
      .select("id, pack_code, pack_name, pack_type, billing_uom, bom_required, description, active, created_at")
      .maybeSingle();

    if (error) throw new Error("PROD_PACK_CODE_UPDATE_FAILED");
    if (!data) return packError(req, ctx, "PROD_PACK_CODE_NOT_FOUND", 404, "Pack code not found");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_CODE_UPDATE_FAILED";
    console.error("[pack_config.updatePackCode] request_id:", ctx.request_id, "error:", err);
    return packError(req, ctx, code, 500, "Pack code update failed");
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
      .schema("erp_production")
      .from("pack_code_master")
      .update({ active })
      .eq("id", id);
    if (error) throw new Error("PROD_PACK_CODE_TOGGLE_FAILED");
    return okResponse({ id, active }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_CODE_TOGGLE_FAILED";
    console.error("[pack_config.togglePackCode] request_id:", ctx.request_id, "error:", err);
    return packError(req, ctx, code, 500, "Pack code toggle failed");
  }
}

// GET /api/production/prodshades
export async function listApprovedProdshadesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    // PostgREST cannot embed across schemas — stroke_master is in erp_production,
    // material_master is in erp_master — so resolve in two queries + in-memory join.
    const { data: strokes, error } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_master")
      .select("prodshade_material_id")
      .in("status", ["ACTIVE", "APPROVED"]);
    if (error) {
      console.error("[pack_config.listApprovedProdshades] stroke query failed:", JSON.stringify(error));
      throw new Error("PROD_PRODSHADE_LIST_FAILED");
    }

    const materialIds = [...new Set(
      ((strokes ?? []) as JsonRecord[])
        .map((r) => String(r.prodshade_material_id ?? ""))
        .filter(Boolean),
    )];
    if (materialIds.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    const { data: materials, error: matErr } = await serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .select("id, shade_code, material_name, document_name, external_code")
      .in("id", materialIds);
    if (matErr) {
      console.error("[pack_config.listApprovedProdshades] material query failed:", JSON.stringify(matErr));
      throw new Error("PROD_PRODSHADE_LIST_FAILED");
    }

    const items = ((materials ?? []) as JsonRecord[])
      .map((m) => ({
        material_id: String(m.id),
        shade_code: normalizeNullableString(m.shade_code),
        material_name: normalizeNullableString(m.material_name),
        document_name: normalizeNullableString(m.document_name),
        external_code: normalizeNullableString(m.external_code),
      }))
      .sort((a, b) => a.external_code.localeCompare(b.external_code));

    return okResponse({ data: items }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PRODSHADE_LIST_FAILED";
    console.error("[pack_config.listApprovedProdshades] request_id:", ctx.request_id, "error:", err);
    return packError(req, ctx, code, 500, "Prodshade list failed");
  }
}

// GET /api/production/pack-configs?material_id=
export async function listPackConfigsHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const materialId = toTrimmedString(url.searchParams.get("material_id") ?? "");

    // pack_code_master is intra-schema (erp_production) so that embed is fine;
    // material_master is in erp_master (cross-schema) — PostgREST can't embed it,
    // so batch-fetch materials separately below.
    let query = serviceRoleClient
      .schema("erp_production")
      .from("prodshade_pack_config")
      .select(`
        id, material_id, pack_code_id, fill_qty, variant, active, created_at,
        pack_code:pack_code_master!pack_code_id(id, pack_code, pack_name, pack_type, billing_uom, bom_required, description)
      `)
      .order("created_at");

    if (materialId) query = query.eq("material_id", materialId);

    const { data, error } = await query;
    if (error) {
      console.error("[pack_config.listPackConfigs] query failed:", JSON.stringify(error));
      throw new Error("PROD_PACK_CONFIG_LIST_FAILED");
    }

    const rows = (data ?? []) as JsonRecord[];
    const matIds = [...new Set(rows.map((r) => String(r.material_id ?? "")).filter(Boolean))];
    const matMap = new Map<string, JsonRecord>();
    if (matIds.length > 0) {
      const { data: mats, error: matErr } = await serviceRoleClient
        .schema("erp_master")
        .from("material_master")
        .select("id, shade_code, material_name, document_name, external_code, production_mode")
        .in("id", matIds);
      if (matErr) {
        console.error("[pack_config.listPackConfigs] material query failed:", JSON.stringify(matErr));
        throw new Error("PROD_PACK_CONFIG_LIST_FAILED");
      }
      for (const m of (mats ?? []) as JsonRecord[]) matMap.set(String(m.id), m);
    }

    const items = rows.map((row) => {
      const material = (matMap.get(String(row.material_id ?? "")) ?? {}) as JsonRecord;
      const packCode = (row.pack_code ?? {}) as JsonRecord;
      const skuString = buildFgSku(
        normalizeNullableString(material.external_code),
        normalizeNullableString(packCode.pack_code),
        normalizeNullableString(row.variant),
      );
      return {
        ...row,
        prodshade_display: normalizeNullableString(material.external_code) || normalizeNullableString(material.shade_code) || null,
        fg_sku: skuString || null,
        fg_material_name: skuString || null,
      };
    });

    return okResponse({ data: items }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_CONFIG_LIST_FAILED";
    console.error("[pack_config.listPackConfigs] request_id:", ctx.request_id, "error:", err);
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
    const fillQty = body.fill_qty != null && body.fill_qty !== "" ? parsePositiveNumber(body.fill_qty) : null;

    if (!materialId || !packCodeId) {
      return packError(req, ctx, "PROD_PACK_CONFIG_INVALID", 400, "material_id and pack_code_id required");
    }

    const { data: existingRows, error: lookupErr } = await serviceRoleClient
      .schema("erp_production")
      .from("prodshade_pack_config")
      .select("id, variant, fill_qty")
      .eq("material_id", materialId)
      .eq("pack_code_id", packCodeId);

    if (lookupErr) throw new Error("PROD_PACK_CONFIG_LOOKUP_FAILED");

    const existing = ((existingRows ?? []) as JsonRecord[]).find((row) =>
      normalizeNullableString(row.variant) === normalizeNullableString(variant) &&
      normalizeNullableNumber(row.fill_qty) === normalizeNullableNumber(fillQty)
    );

    let configId = "";
    if (existing) {
      const { data: updated, error: updateErr } = await serviceRoleClient
        .schema("erp_production")
        .from("prodshade_pack_config")
        .update({ fill_qty: fillQty, active: true })
        .eq("id", String(existing.id))
        .select("id")
        .single();
      if (updateErr) throw new Error("PROD_PACK_CONFIG_UPSERT_FAILED");
      configId = String((updated as JsonRecord).id);
    } else {
      const { data: inserted, error: insertErr } = await serviceRoleClient
        .schema("erp_production")
        .from("prodshade_pack_config")
        .insert({
          material_id: materialId,
          pack_code_id: packCodeId,
          variant: variant || null,
          fill_qty: fillQty,
          active: true,
          created_by: ctx.auth_user_id,
        })
        .select("id")
        .single();
      if (insertErr) throw new Error("PROD_PACK_CONFIG_UPSERT_FAILED");
      configId = String((inserted as JsonRecord).id);
    }

    let fgMaterialId: string | null = null;
    let fgPaceCode: string | null = null;
    try {
      const fg = await ensureFgMaterialForConfig(materialId, packCodeId, variant, ctx);
      fgMaterialId = fg.fgMaterialId;
      fgPaceCode = fg.fgPaceCode;
    } catch {
      // FG auto-create is best-effort; pack config success is the primary result.
    }

    return okResponse({ id: configId, fg_material_id: fgMaterialId, fg_pace_code: fgPaceCode }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_CONFIG_UPSERT_FAILED";
    console.error("[pack_config.upsertPackConfig] request_id:", ctx.request_id, "error:", err);
    return packError(req, ctx, code, 500, "Pack config upsert failed");
  }
}

// DELETE /api/production/pack-configs/:id
export async function deletePackConfigHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return packError(req, ctx, "PROD_PACK_CONFIG_ID_MISSING", 400, "ID required");

    const { data: config, error: fetchErr } = await serviceRoleClient
      .schema("erp_production")
      .from("prodshade_pack_config")
      .select("id, material_id, pack_code_id, variant")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr) throw new Error("PROD_PACK_CONFIG_FETCH_FAILED");
    if (!config) return packError(req, ctx, "PROD_PACK_CONFIG_NOT_FOUND", 404, "Pack config not found");

    const resolved = await resolveFgMaterial(
      String((config as JsonRecord).material_id),
      String((config as JsonRecord).pack_code_id),
      normalizeNullableString((config as JsonRecord).variant),
    );

    if (resolved.fgMaterialId) {
      const [bomCountResult, poCountResult] = await Promise.all([
        serviceRoleClient
          .schema("erp_production")
          .from("pack_bom")
          .select("id", { count: "exact", head: true })
          .eq("sku_material_id", resolved.fgMaterialId),
        serviceRoleClient
          .schema("erp_production")
          .from("packing_order")
          .select("id", { count: "exact", head: true })
          .eq("material_id", resolved.fgMaterialId),
      ]);

      if ((bomCountResult.count ?? 0) > 0) {
        return packError(req, ctx, "PROD_PACK_CONFIG_DELETE_BLOCKED_BOM_EXISTS", 409, "Pack BOM exists for this FG SKU");
      }
      if ((poCountResult.count ?? 0) > 0) {
        return packError(req, ctx, "PROD_PACK_CONFIG_DELETE_BLOCKED_PO_EXISTS", 409, "Packing PO exists for this FG SKU");
      }
    }

    const { error } = await serviceRoleClient
      .schema("erp_production")
      .from("prodshade_pack_config")
      .delete()
      .eq("id", id);
    if (error) throw new Error("PROD_PACK_CONFIG_DELETE_FAILED");
    return okResponse({ id }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_CONFIG_DELETE_FAILED";
    console.error("[pack_config.deletePackConfig] request_id:", ctx.request_id, "error:", err);
    return packError(req, ctx, code, 500, "Pack config delete failed");
  }
}
