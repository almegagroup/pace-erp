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
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
import { isGlobalAdmin, isSuperAdmin } from "../../_shared/role_ladder.ts";
import { hasBlanketApprovalOverride } from "../../_shared/approval_override.ts";
import { loadApproverWorkContextIds, matchesApprover, pickScopedApproverRules } from "../../_shared/workflow_scope.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import {
  assertProdReadRole,
  parseBody,
  toTrimmedString,
  toUpperTrimmedString,
  parsePositiveNumber,
  getIdFromPath,
} from "./production.shared.ts";

type JsonRecord = Record<string, unknown>;

const BOM_OPEN_STATUSES = ["DRAFT", "ACTIVE"];
const PACK_PO_TYPES = new Set(["MTO", "HPS", "MTS", "MTEST"]);
const PM_LINE_TYPE = "INPUT";
const OUTPUT_LINE_TYPE = "OUTPUT";
const SFG_LINE_TYPE = "SFG";

function bomError(
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
  selectColumns: string,
): Promise<Map<string, JsonRecord>> {
  const matIds = [...new Set(materialIds.filter(Boolean))];
  const matMap = new Map<string, JsonRecord>();
  if (matIds.length === 0) return matMap;

  const { data: mats, error: matErr } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select(selectColumns)
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

// PostgREST's select parser does not support the alias:schema.table!fk(...)
// cross-schema embed syntax (PGRST100) — batch-fetch by id and merge in JS.
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
    console.error("[pack_bom.getGroupMapByIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_BOM_GROUP_BATCH_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

async function getCompanyMapByIds(ids: string[]): Promise<Map<string, JsonRecord>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (uniqueIds.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("companies")
    .select("id, company_code, company_name")
    .in("id", uniqueIds);
  if (error) {
    console.error("[pack_bom.getCompanyMapByIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_BOM_COMPANY_BATCH_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

async function getStorageLocationMapByIds(ids: string[]): Promise<Map<string, JsonRecord>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (uniqueIds.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_master")
    .select("id, code, name")
    .in("id", uniqueIds);
  if (error) {
    console.error("[pack_bom.getStorageLocationMapByIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_BOM_SLOC_BATCH_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

async function getPackCodeByCode(packCode: string): Promise<JsonRecord | null> {
  if (!packCode) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("pack_code_master")
    .select("id, pack_code, pack_name, pack_type, billing_uom, bom_required, outer_uom_code, active")
    .eq("pack_code", packCode)
    .maybeSingle();
  if (error) {
    console.error("[pack_bom.getPackCodeByCode] query failed:", JSON.stringify(error));
    throw new Error("PROD_BOM_PACK_CODE_LOOKUP_FAILED");
  }
  return (data as JsonRecord | null) ?? null;
}

async function getPackCodeMapByCodes(packCodes: string[]): Promise<Map<string, JsonRecord>> {
  const uniqueCodes = [...new Set(packCodes.map((code) => toTrimmedString(code)).filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (uniqueCodes.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("pack_code_master")
    .select("id, pack_code, pack_name, pack_type, billing_uom, bom_required, outer_uom_code, active")
    .in("pack_code", uniqueCodes);
  if (error) {
    console.error("[pack_bom.getPackCodeMapByCodes] query failed:", JSON.stringify(error));
    throw new Error("PROD_BOM_PACK_CODE_LOOKUP_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) {
    const code = toTrimmedString(row.pack_code);
    if (code) map.set(code, row);
  }
  return map;
}

async function resolveProdshadeForSku(sku: JsonRecord): Promise<JsonRecord | null> {
  const skuIdentity = toUpperTrimmedString(sku.external_code ?? sku.material_name);
  const packCode = toTrimmedString(sku.pack_code);
  if (!skuIdentity || !packCode) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("prodshade_pack_config")
    .select(`
      id, material_id, pack_code_id, fill_qty, variant, active,
      pack_code:pack_code_master!pack_code_id(id, pack_code, pack_name, bom_required, outer_uom_code)
    `)
    .eq("active", true);
  if (error) {
    console.error("[pack_bom.resolveProdshadeForSku] query failed:", JSON.stringify(error));
    throw new Error("PROD_BOM_PRODSHADE_LOOKUP_FAILED");
  }
  const rows = (data ?? []) as JsonRecord[];
  const prodshadeMap = await getMaterialMapByIds(
    rows.map((row) => String(row.material_id ?? "")),
    "[pack_bom.resolveProdshadeForSku]",
    "PROD_BOM_PRODSHADE_LOOKUP_FAILED",
    "id, pace_code, external_code, material_name, document_name, shade_code, base_uom_code",
  );
  const matches = rows.filter((row) => {
    const pack = (row.pack_code ?? {}) as JsonRecord;
    const prod = prodshadeMap.get(String(row.material_id ?? "")) ?? {};
    return toTrimmedString(pack.pack_code) === packCode
      && buildSkuProdshadeKey(
        toTrimmedString(prod.external_code),
        toTrimmedString(pack.pack_code),
      ) === skuIdentity;
  });
  if (matches.length !== 1) return null;
  const match = matches[0];
  return { ...match, prodshade: prodshadeMap.get(String(match.material_id ?? "")) ?? null };
}

async function getCompanyFStorageLocations(companyId: string): Promise<JsonRecord[]> {
  const normalizedCompanyId = toTrimmedString(companyId);
  if (!normalizedCompanyId) return [];
  const { data: maps, error: mapError } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_plant_map")
    .select("storage_location_id")
    .eq("company_id", normalizedCompanyId)
    .eq("active", true);
  if (mapError) {
    console.error("[pack_bom.getCompanyFStorageLocations] map query failed:", JSON.stringify(mapError));
    throw new Error("PROD_BOM_SLOC_LOOKUP_FAILED");
  }

  const locationIds = [...new Set(((maps ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.storage_location_id)).filter(Boolean))];
  if (locationIds.length === 0) return [];

  const { data: locations, error: locationError } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_master")
    .select("id, code, name, active")
    .in("id", locationIds)
    .eq("active", true);
  if (locationError) {
    console.error("[pack_bom.getCompanyFStorageLocations] location query failed:", JSON.stringify(locationError));
    throw new Error("PROD_BOM_SLOC_LOOKUP_FAILED");
  }

  return ((locations ?? []) as JsonRecord[])
    .filter((location) => toTrimmedString(location.code).startsWith("F"));
}

async function resolveApprovedStroke(prodshadeMaterialId: string, companyId: string, poType: string): Promise<JsonRecord | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("stroke_master")
    .select("id, company_id, prodshade_material_id, stroke_number, default_storage_location_id, status")
    .eq("company_id", companyId)
    .eq("prodshade_material_id", prodshadeMaterialId)
    .eq("po_type", poType)
    .eq("status", "APPROVED")
    .order("stroke_number", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[pack_bom.resolveApprovedStroke] query failed:", JSON.stringify(error));
    throw new Error("PROD_BOM_STROKE_LOOKUP_FAILED");
  }
  const stroke = (data as JsonRecord | null) ?? null;
  if (!stroke) return null;
  const slocMap = await getStorageLocationMapByIds([String(stroke.default_storage_location_id ?? "")]);
  return {
    ...stroke,
    default_storage_location: slocMap.get(String(stroke.default_storage_location_id ?? "")) ?? null,
  };
}

function buildSkuProdshadeKey(prodshadeCode: string, packCode: string): string {
  return toUpperTrimmedString(`${toTrimmedString(prodshadeCode)}${toTrimmedString(packCode)}`);
}

function normalizeLine(line: JsonRecord, idx: number): JsonRecord {
  return {
    material_id: toTrimmedString(line.material_id),
    qty: parsePositiveNumber(line.qty),
    uom_code: toTrimmedString(line.uom_code),
    has_alternate: line.has_alternate === true || line.has_alternate === "true",
    material_group_id: toTrimmedString(line.material_group_id),
    is_primary_container: line.is_primary_container === true || line.is_primary_container === "true",
    display_order: Number.isFinite(Number(line.display_order)) ? Number(line.display_order) : idx,
  };
}

async function syncPackBomConversions(packBomId: string, createdBy: string): Promise<void> {
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("pack_bom")
    .select(`
      id, sku_material_id, company_id,
      lines:pack_bom_line(id, line_type, material_id, qty, uom_code, is_primary_container)
    `)
    .eq("id", packBomId)
    .maybeSingle();
  if (error || !data) {
    console.error("[pack_bom.syncPackBomConversions] BOM query failed:", JSON.stringify(error));
    throw new Error("PROD_BOM_CONVERSION_SYNC_FAILED");
  }
  const bom = data as JsonRecord;
  const lines = (bom.lines ?? []) as JsonRecord[];
  const skuMap = await getMaterialMapByIds(
    [String(bom.sku_material_id ?? "")],
    "[pack_bom.syncPackBomConversions]",
    "PROD_BOM_CONVERSION_SYNC_FAILED",
    "id, pack_code",
  );
  const sku = skuMap.get(String(bom.sku_material_id ?? "")) ?? {};
  const packCode = await getPackCodeByCode(toTrimmedString(sku.pack_code));
  if (!packCode) throw new Error("PROD_BOM_PACK_CODE_NOT_FOUND");

  const sfgLine = lines.find((line) => toTrimmedString(line.line_type) === SFG_LINE_TYPE);
  const sfgQty = parsePositiveNumber(sfgLine?.qty);
  if (Boolean(packCode.bom_required) && !sfgQty) {
    throw new Error("PROD_BOM_SFG_QTY_REQUIRED");
  }

  const rows: JsonRecord[] = [];
  if (Boolean(packCode.bom_required) && sfgQty) {
    rows.push({
      material_id: bom.sku_material_id,
      from_uom_code: toTrimmedString(packCode.outer_uom_code) || "KG",
      to_uom_code: "KG",
      conversion_factor: sfgQty,
      variable_conversion: false,
      active: true,
      created_by: createdBy,
    });
    for (const pmLine of lines.filter((line) => Boolean(line.is_primary_container))) {
      const pmQty = parsePositiveNumber(pmLine.qty);
      const pmUom = toTrimmedString(pmLine.uom_code);
      if (!pmQty || !pmUom) continue;
      rows.push({
        material_id: bom.sku_material_id,
        from_uom_code: pmUom,
        to_uom_code: "KG",
        conversion_factor: sfgQty / pmQty,
        variable_conversion: false,
        active: true,
        created_by: createdBy,
      });
    }
  } else if (!Boolean(packCode.bom_required)) {
    rows.push({
      material_id: bom.sku_material_id,
      from_uom_code: toTrimmedString(packCode.outer_uom_code) || "KG",
      to_uom_code: "KG",
      conversion_factor: null,
      variable_conversion: true,
      active: true,
      created_by: createdBy,
    });
  }

  if (rows.length === 0) return;
  const { error: upsertErr } = await serviceRoleClient
    .schema("erp_master")
    .from("material_uom_conversion")
    .upsert(rows, { onConflict: "material_id,from_uom_code,to_uom_code" });
  if (upsertErr) {
    console.error("[pack_bom.syncPackBomConversions] upsert failed:", JSON.stringify(upsertErr));
    throw new Error("PROD_BOM_CONVERSION_SYNC_FAILED");
  }
}

// ── PACK BOM ──────────────────────────────────────────────────────────────────

// GET /api/production/pack-boms/eligible-skus?company_id&po_type
export async function listPackBomEligibleSkusHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id")) || toTrimmedString(ctx.context.companyId);
    const poType = toUpperTrimmedString(url.searchParams.get("po_type"));
    if (!companyId || !PACK_PO_TYPES.has(poType)) {
      return bomError(req, ctx, "PROD_BOM_ELIGIBLE_INVALID", 400, "company_id and valid po_type required");
    }

    const { data: companyRows, error: companyErr } = await serviceRoleClient
      .schema("erp_master")
      .from("material_company_ext")
      .select("material_id, company_id, status")
      .eq("company_id", companyId)
      .eq("status", "ACTIVE");
    if (companyErr) throw new Error("PROD_BOM_ELIGIBLE_LOOKUP_FAILED");

    const skuIds = [...new Set(((companyRows ?? []) as JsonRecord[]).map((row) => String(row.material_id ?? "")).filter(Boolean))];
    if (skuIds.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    const { data: existingBoms, error: existingErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom")
      .select("sku_material_id")
      .eq("company_id", companyId)
      .in("status", BOM_OPEN_STATUSES);
    if (existingErr) throw new Error("PROD_BOM_ELIGIBLE_LOOKUP_FAILED");

    const existingSkuIds = new Set(((existingBoms ?? []) as JsonRecord[])
      .map((row) => toTrimmedString(row.sku_material_id))
      .filter(Boolean));
    const availableSkuIds = skuIds.filter((id) => !existingSkuIds.has(id));
    if (availableSkuIds.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    const { data: skuRows, error: skuErr } = await serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .select("id, pace_code, external_code, material_name, document_name, material_type, base_uom_code, shade_code, pack_code, status")
      .in("id", availableSkuIds)
      .eq("material_type", "FG")
      .eq("status", "ACTIVE");
    if (skuErr) throw new Error("PROD_BOM_ELIGIBLE_SKU_FAILED");

    const skuList = (skuRows ?? []) as JsonRecord[];
    if (skuList.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    const packCodeMap = await getPackCodeMapByCodes(
      skuList.map((sku) => toTrimmedString(sku.pack_code)),
    );
    // §131.4 item #10 (2026-08-26): MTEST sample SKUs need no Prodshade/Stroke match at
    // all — split them out BEFORE any of the prodshade-matching logic below, since that
    // logic's own early-returns (packCodeIds/configRows/matchedProdshadeIds all empty)
    // would otherwise return [] and silently drop these SKUs whenever no OTHER SKU in
    // this company/po_type happens to have a resolvable Prodshade. Mirrors
    // createPackBomHandler's own pack_type=MTEST bypass.
    //
    // ⚠️ Also gated on poType === "MTEST" (caught live, 2026-08-26): pack_type alone
    // would surface these 5 SKUs regardless of which PO Type the caller asked for —
    // selecting MTO/HPS/MTS would still show "Admix sample 1kg" etc., which is wrong.
    // These SKUs only make sense as MTEST results.
    const mtestSkus = poType === "MTEST"
      ? skuList.filter(
          (sku) => toUpperTrimmedString(packCodeMap.get(toTrimmedString(sku.pack_code))?.pack_type) === "MTEST",
        )
      : [];
    const nonMtestSkus = skuList.filter(
      (sku) => toUpperTrimmedString(packCodeMap.get(toTrimmedString(sku.pack_code))?.pack_type) !== "MTEST",
    );
    const mtestOutput: JsonRecord[] = mtestSkus.map((sku) => ({
      ...sku,
      company_id: companyId,
      po_type: poType,
      prodshade_material_id: null,
      prodshade: null,
      pack_code_row: packCodeMap.get(toTrimmedString(sku.pack_code)) ?? null,
      stroke_master: null,
    }));

    const packCodeIds = [...new Set(
      [...packCodeMap.values()].map((packCode) => toTrimmedString(packCode.id)).filter(Boolean),
    )];
    if (packCodeIds.length === 0) return okResponse({ data: mtestOutput }, ctx.request_id, req);

    const { data: prodshadeConfigs, error: prodshadeConfigErr } = await serviceRoleClient
      .schema("erp_production")
      .from("prodshade_pack_config")
      .select(`
        id, material_id, pack_code_id, fill_qty, variant, active,
        pack_code:pack_code_master!pack_code_id(id, pack_code, pack_name, bom_required, outer_uom_code)
      `)
      .eq("active", true)
      .in("pack_code_id", packCodeIds);
    if (prodshadeConfigErr) {
      console.error("[pack_bom.listPackBomEligibleSkus] prodshade config query failed:", JSON.stringify(prodshadeConfigErr));
      throw new Error("PROD_BOM_PRODSHADE_LOOKUP_FAILED");
    }

    const configRows = (prodshadeConfigs ?? []) as JsonRecord[];
    if (configRows.length === 0) return okResponse({ data: mtestOutput }, ctx.request_id, req);

    const prodshadeMap = await getMaterialMapByIds(
      configRows.map((row) => String(row.material_id ?? "")),
      "[pack_bom.listPackBomEligibleSkus]",
      "PROD_BOM_PRODSHADE_LOOKUP_FAILED",
      "id, pace_code, external_code, material_name, document_name, shade_code, base_uom_code",
    );

    const prodshadeBySkuKey = new Map<string, JsonRecord | null>();
    for (const row of configRows) {
      const pack = (row.pack_code ?? {}) as JsonRecord;
      const prodshade = prodshadeMap.get(String(row.material_id ?? ""));
      const packCode = toTrimmedString(pack.pack_code);
      const prodshadeCode = toTrimmedString(prodshade?.external_code);
      if (!packCode || !prodshadeCode) continue;
      const key = buildSkuProdshadeKey(prodshadeCode, packCode);
      // An exact SKU must resolve to one Prodshade config only. A duplicate is
      // deliberately treated as unusable instead of silently choosing first.
      prodshadeBySkuKey.set(
        key,
        prodshadeBySkuKey.has(key) ? null : { ...row, prodshade },
      );
    }

    const matchedProdshadeIds = [...new Set(
      nonMtestSkus
        .map((sku) => {
          const key = toUpperTrimmedString(sku.external_code ?? sku.material_name);
          const match = prodshadeBySkuKey.get(key);
          return toTrimmedString(match?.prodshade?.id);
        })
        .filter(Boolean),
    )];
    if (matchedProdshadeIds.length === 0) return okResponse({ data: mtestOutput }, ctx.request_id, req);

    const { data: strokeRows, error: strokeErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_master")
      .select("id, company_id, prodshade_material_id, stroke_number, default_storage_location_id, status")
      .eq("company_id", companyId)
      .eq("po_type", poType)
      .eq("status", "APPROVED")
      .in("prodshade_material_id", matchedProdshadeIds)
      .order("stroke_number", { ascending: true });
    if (strokeErr) {
      console.error("[pack_bom.listPackBomEligibleSkus] stroke query failed:", JSON.stringify(strokeErr));
      throw new Error("PROD_BOM_STROKE_LOOKUP_FAILED");
    }

    const strokeList = (strokeRows ?? []) as JsonRecord[];
    const strokeByProdshadeId = new Map<string, JsonRecord>();
    for (const stroke of strokeList) {
      const prodshadeMaterialId = toTrimmedString(stroke.prodshade_material_id);
      if (!prodshadeMaterialId || strokeByProdshadeId.has(prodshadeMaterialId)) continue;
      strokeByProdshadeId.set(prodshadeMaterialId, stroke);
    }
    const slocMap = await getStorageLocationMapByIds(
      strokeList.map((stroke) => String(stroke.default_storage_location_id ?? "")),
    );

    const output: JsonRecord[] = [];
    for (const sku of nonMtestSkus) {
      const packCode = packCodeMap.get(toTrimmedString(sku.pack_code));
      if (!packCode) continue;
      const key = toUpperTrimmedString(sku.external_code ?? sku.material_name);
      const prodshadeConfig = prodshadeBySkuKey.get(key);
      const prodshade = (prodshadeConfig?.prodshade ?? null) as JsonRecord | null;
      if (!prodshade) continue;
      const stroke = strokeByProdshadeId.get(String(prodshade.id));
      if (!stroke) continue;
      output.push({
        ...sku,
        company_id: companyId,
        po_type: poType,
        prodshade_material_id: prodshade.id,
        prodshade,
        pack_code_row: packCode,
        stroke_master: {
          ...stroke,
          default_storage_location: slocMap.get(String(stroke.default_storage_location_id ?? "")) ?? null,
        },
      });
    }

    // §131.4 item #10: MTEST sample SKUs (collected earlier, before any of the
    // prodshade-matching short-circuits above could drop them) are always included.
    return okResponse({ data: [...mtestOutput, ...output] }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BOM_ELIGIBLE_FAILED";
    return bomError(req, ctx, code, 500, "Eligible SKU list failed");
  }
}

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
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");

    let query = serviceRoleClient
      .schema("erp_production")
      .from("pack_bom")
      .select(`
        id, company_id, sku_material_id, status, created_by, created_at, approved_by, approved_at
      `)
      .order("created_at", { ascending: false });

    if (status) query = query.eq("status", status);
    if (skuMaterialId) query = query.eq("sku_material_id", skuMaterialId);
    if (companyId) query = query.eq("company_id", companyId);

    const { data, error } = await query;
    if (error) {
      console.error("[pack_bom.listPackBoms] query failed:", JSON.stringify(error));
      throw new Error("PROD_BOM_LIST_FAILED");
    }

    const rows = (data ?? []) as JsonRecord[];
    const skuMap = await getMaterialMapByIds(
      rows.map((row) => String(row.sku_material_id ?? "")),
      "[pack_bom.listPackBoms]",
      "PROD_BOM_LIST_FAILED",
      "id, pace_code, material_name, material_type, pack_code, shade_code",
    );
    const [companyMap, userDisplayMap] = await Promise.all([
      getCompanyMapByIds(rows.map((row) => String(row.company_id ?? ""))),
      resolveUserDisplayNames(rows.flatMap((r) => [
        String(r.created_by ?? ""), String(r.approved_by ?? ""),
      ])),
    ]);
    return okResponse({
      data: rows.map((row) => ({
        ...row,
        company: companyMap.get(String(row.company_id ?? "")) ?? null,
        sku: skuMap.get(String(row.sku_material_id ?? "")) ?? null,
        created_by_display: userDisplayMap.get(String(row.created_by ?? "")) ?? null,
        approved_by_display: userDisplayMap.get(String(row.approved_by ?? "")) ?? null,
      })),
    }, ctx.request_id, req);
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
        id, company_id, sku_material_id, status, created_by, created_at, approved_by, approved_at, reject_reason,
        lines:pack_bom_line(
          id, pack_bom_id, line_type, material_id, qty, uom_code, has_alternate, material_group_id,
          storage_location_id, movement_type_code, is_primary_container, display_order
        )
      `)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[pack_bom.getPackBom] query failed:", JSON.stringify(error));
      throw new Error("PROD_BOM_FETCH_FAILED");
    }
    if (!data) return bomError(req, ctx, "PROD_BOM_NOT_FOUND", 404, "Pack BOM not found");

    const bom = data as JsonRecord;
    const lines = ((bom.lines ?? []) as JsonRecord[]);
    const [companyMap, skuMap, lineMaterialMap, groupMap, slocMap, userDisplayMap] = await Promise.all([
      getCompanyMapByIds([String(bom.company_id ?? "")]),
      getMaterialMapByIds(
        [String(bom.sku_material_id ?? "")],
        "[pack_bom.getPackBom]",
        "PROD_BOM_FETCH_FAILED",
        "id, pace_code, material_name, material_type, pack_code, shade_code",
      ),
      getMaterialMapByIds(
        lines.map((line) => String(line.material_id ?? "")),
        "[pack_bom.getPackBom]",
        "PROD_BOM_FETCH_FAILED",
        "id, pace_code, material_name, base_uom_code",
      ),
      getGroupMapByIds(lines.map((line) => String(line.material_group_id ?? ""))),
      getStorageLocationMapByIds(lines.map((line) => String(line.storage_location_id ?? ""))),
      resolveUserDisplayNames([String(bom.created_by ?? ""), String(bom.approved_by ?? "")]),
    ]);

    return okResponse({
      data: {
        ...bom,
        company: companyMap.get(String(bom.company_id ?? "")) ?? null,
        sku: skuMap.get(String(bom.sku_material_id ?? "")) ?? null,
        created_by_display: userDisplayMap.get(String(bom.created_by ?? "")) ?? null,
        approved_by_display: userDisplayMap.get(String(bom.approved_by ?? "")) ?? null,
        lines: lines.map((line) => ({
          ...line,
          material: lineMaterialMap.get(String(line.material_id ?? "")) ?? null,
          material_group: groupMap.get(String(line.material_group_id ?? "")) ?? null,
          storage_location: slocMap.get(String(line.storage_location_id ?? "")) ?? null,
        })),
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BOM_FETCH_FAILED";
    return bomError(req, ctx, code, 500, "Pack BOM fetch failed");
  }
}

function isAdminBypass(ctx: ProdHandlerContext): boolean {
  return ctx.context.isAdmin === true || isSuperAdmin(ctx.roleCode) || isGlobalAdmin(ctx.roleCode);
}

async function assertPackBomCompanyScope(ctx: ProdHandlerContext, companyId: string): Promise<void> {
  if (isAdminBypass(ctx)) return;
  const normalizedCompanyId = toTrimmedString(companyId);
  if (!normalizedCompanyId) throw new Error("PROD_BOM_SCOPE_VIOLATION");
  const { data, error } = await serviceRoleClient
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", ctx.auth_user_id)
    .eq("company_id", normalizedCompanyId)
    .maybeSingle();
  if (error || !data) throw new Error("PROD_BOM_SCOPE_VIOLATION");
}

// POST /api/production/pack-boms
export async function createPackBomHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id) || toTrimmedString(ctx.context.companyId);
    const poType = toUpperTrimmedString(body.po_type);
    const skuMaterialId = toTrimmedString(body.sku_material_id);
    const outputStorageLocationId = toTrimmedString(body.output_storage_location_id);
    const sfgQty = parsePositiveNumber(body.sfg_qty);
    const pmLines = (Array.isArray(body.pm_lines) ? body.pm_lines : Array.isArray(body.lines) ? body.lines : [])
      .map((line, idx) => normalizeLine(line as JsonRecord, idx))
      .filter((line) => toTrimmedString(line.material_id));

    if (!companyId || !skuMaterialId || !PACK_PO_TYPES.has(poType)) {
      return bomError(req, ctx, "PROD_BOM_INVALID", 400, "company_id, po_type, sku_material_id required");
    }
    await assertPackBomCompanyScope(ctx, companyId);

    // Validate SKU exists and is type FG
    const { data: sku, error: skuErr } = await serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .select("id, pace_code, external_code, material_name, material_type, base_uom_code, pack_code, shade_code")
      .eq("id", skuMaterialId)
      .maybeSingle();

    if (skuErr) throw new Error("PROD_BOM_SKU_LOOKUP_FAILED");
    if (!sku) return bomError(req, ctx, "PROD_BOM_SKU_NOT_FOUND", 404, "FG SKU material not found");
    if ((sku as JsonRecord).material_type !== "FG") {
      return bomError(req, ctx, "PROD_BOM_NOT_FG", 422, "Pack BOM can only be created for FG materials");
    }

    const companyFLocations = await getCompanyFStorageLocations(companyId);
    if (!outputStorageLocationId || !companyFLocations.some((location) => toTrimmedString(location.id) === outputStorageLocationId)) {
      return bomError(req, ctx, "PROD_BOM_OUTPUT_SLOC_INVALID", 422, "Output storage location must be an active F-location for the selected company");
    }

    const packCode = toTrimmedString((sku as JsonRecord).pack_code);
    const packCodeRow = await getPackCodeByCode(packCode);
    if (!packCodeRow) return bomError(req, ctx, "PROD_BOM_PACK_CODE_NOT_FOUND", 422, "Pack code not found for selected SKU");
    const bomRequired = Boolean(packCodeRow.bom_required);
    // §131.4 item #10 (2026-08-26): pack_type=MTEST (pack_code 001 today) is the generic
    // AP-sample SKU family — never tied to one specific Prodshade (§131.3), so
    // resolveProdshadeForSku()'s "exactly one match" lookup structurally cannot succeed
    // and must not even be attempted. These BOMs get OUTPUT only; SFG material resolves
    // later, per Packing PO, from the new Standard-time Prodshade+Stroke picker instead
    // (item #11) — never from the Pack BOM. Every other pack_type (including other
    // bom_required=false codes like 599/000, which DO map to one real Prodshade) is
    // completely untouched by this branch.
    const isMtestSampleSku = toUpperTrimmedString(packCodeRow.pack_type) === "MTEST";

    let sfgMaterialId: string | null = null;
    let sfgStorageLocationId: string | null = null;
    if (!isMtestSampleSku) {
      const prodshadeConfig = await resolveProdshadeForSku(sku as JsonRecord);
      const prodshade = (prodshadeConfig?.prodshade ?? null) as JsonRecord | null;
      if (!prodshade) {
        return bomError(req, ctx, "PROD_BOM_PRODSHADE_NOT_FOUND", 422, "FG SKU prodshade link not found");
      }
      const stroke = await resolveApprovedStroke(String(prodshade.id), companyId, poType);
      if (!stroke) {
        return bomError(req, ctx, "PROD_BOM_STROKE_NOT_FOUND", 422, "Approved stroke not found for company, PO type and prodshade");
      }
      sfgStorageLocationId = toTrimmedString(stroke.default_storage_location_id);
      if (!sfgStorageLocationId) {
        return bomError(req, ctx, "PROD_BOM_SFG_SLOC_REQUIRED", 422, "Stroke default storage location is required");
      }
      sfgMaterialId = String(prodshade.id);
    }

    // Check no existing DRAFT or ACTIVE BOM for this company + SKU
    const { count: existingCount } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("sku_material_id", skuMaterialId)
      .in("status", BOM_OPEN_STATUSES) as { count?: number };

    if ((existingCount ?? 0) > 0) {
      return bomError(req, ctx, "PROD_BOM_ALREADY_EXISTS", 409, "A DRAFT or ACTIVE Pack BOM already exists for this company and SKU");
    }

    if (bomRequired && !sfgQty) {
      return bomError(req, ctx, "PROD_BOM_SFG_QTY_REQUIRED", 422, "SFG input qty must be positive when BOM is required");
    }

    // Auto-approve if bom_required = false (599, 000, 001)
    const initialStatus = bomRequired ? "DRAFT" : "ACTIVE";
    const now = new Date().toISOString();

    const insertRow: JsonRecord = {
      company_id: companyId,
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

    const lineRows = [
      {
        pack_bom_id: bomId,
        line_type: OUTPUT_LINE_TYPE,
        material_id: skuMaterialId,
        qty: bomRequired ? 1 : null,
        uom_code: toTrimmedString(packCodeRow.outer_uom_code) || "KG",
        storage_location_id: outputStorageLocationId,
        movement_type_code: "P101",
        has_alternate: false,
        material_group_id: null,
        is_primary_container: false,
        display_order: 0,
      },
      // §131.4 item #10: MTEST sample SKUs get NO SFG row at all — there is no single
      // Prodshade to point it at (sfgMaterialId/sfgStorageLocationId are both null here,
      // by construction above). Packing PO's own create handler is updated separately
      // to not require an SFG bom-line for pack_type=MTEST.
      ...(isMtestSampleSku ? [] : [{
        pack_bom_id: bomId,
        line_type: SFG_LINE_TYPE,
        material_id: sfgMaterialId,
        qty: bomRequired ? sfgQty : null,
        uom_code: "KG",
        storage_location_id: sfgStorageLocationId,
        movement_type_code: "P261",
        has_alternate: false,
        material_group_id: null,
        is_primary_container: false,
        display_order: 1,
      }]),
      // §131.3: MTEST sample SKUs never carry PM lines on the Pack BOM itself (ad-hoc
      // at Packing PO Standard instead) — ignore whatever the caller sent, defensively.
      ...(isMtestSampleSku ? [] : pmLines).map((line, idx) => ({
        pack_bom_id: bomId,
        line_type: PM_LINE_TYPE,
        material_id: toTrimmedString(line.material_id),
        qty: bomRequired ? parsePositiveNumber(line.qty) : null,
        uom_code: toTrimmedString(line.uom_code) || null,
        storage_location_id: null,
        movement_type_code: "P261",
        has_alternate: Boolean(line.has_alternate),
        material_group_id: toTrimmedString(line.material_group_id) || null,
        is_primary_container: Boolean(line.is_primary_container),
        display_order: idx + 2,
      })),
    ];

    const { error: lErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom_line")
      .insert(lineRows);

    if (lErr) throw new Error("PROD_BOM_LINES_INSERT_FAILED");

    // §131.4 item #1: MTEST sample SKUs already carry their own FIXED PKT->KG
    // conversion (set directly at material-creation time — variable_conversion=false,
    // one exact factor per SKU). Never let the auto-sync touch it: with no SFG line to
    // derive a qty from, and this SKU family not being genuinely variable-fill like
    // 599/000, syncPackBomConversions() would either write nothing useful or, via its
    // upsert onConflict(material_id,from_uom_code,to_uom_code), clobber the real fixed
    // factor with a variable_conversion=true/NULL-factor row.
    if (!bomRequired && !isMtestSampleSku) {
      await syncPackBomConversions(bomId, ctx.auth_user_id);
    }

    return createdOkResponse(
      { id: bomId, status: initialStatus, auto_approved: !bomRequired },
      ctx.request_id,
      req,
    );
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BOM_CREATE_FAILED";
    return bomError(req, ctx, code, 500, "Pack BOM create failed");
  }
}

// POST /api/production/pack-boms/:id/approve
// Rank-escalation Approve chain for PR06/PR08 -- reuses the exact same
// engine + chain shape already locked for PO/STO (Group 3): L2_USER's
// creation is approved by L3_USER or L1_MANAGER; L3_USER's by L1_MANAGER;
// L1_MANAGER's by DIRECTOR. See po.handlers.ts's assertProcurementHeadRole
// for the full rationale; this mirrors that shape for Pack BOM/Change
// Pack BOM instead of PO/STO.
interface PackBomApproverMapRow {
  approver_user_id: string | null;
  approver_role_code: string | null;
  approver_work_context_id: string | null;
  resource_code: string | null;
  action_code: string | null;
  scope_type: string | null;
  subject_user_id: string | null;
  subject_work_context_id: string | null;
  subject_role_code: string | null;
  approval_stage: number;
}

async function loadPackBomApproverRules(
  resourceCode: string,
  companyId: string,
): Promise<PackBomApproverMapRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("acl")
    .from("approver_map")
    .select("approver_user_id, approver_role_code, approver_work_context_id, resource_code, action_code, scope_type, subject_user_id, subject_work_context_id, subject_role_code, approval_stage")
    .eq("resource_code", resourceCode)
    .eq("action_code", "APPROVE")
    .eq("company_id", companyId);

  if (error) {
    throw new Error("PROD_BOM_APPROVER_LOOKUP_FAILED");
  }
  return (data as PackBomApproverMapRow[] | null) ?? [];
}

async function getPackBomUserRoleCode(userId: string): Promise<string | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_acl")
    .from("user_roles")
    .select("role_code")
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return String((data as Record<string, unknown>).role_code ?? "") || null;
}

// Configured-but-unscoped and fully-unconfigured both fall back to
// DIRECTOR-only (via hasBlanketApprovalOverride), so a plain company-wide
// setup keeps working untouched -- same fallback shape as PO/STO/PTO.
async function assertPackBomApproverRole(
  ctx: ProdHandlerContext,
  resourceCode: string,
  companyId: string,
  createdBy?: string | null,
): Promise<void> {
  if (hasBlanketApprovalOverride(ctx)) {
    return;
  }

  const rules = await loadPackBomApproverRules(resourceCode, companyId);
  let isConfiguredApprover: boolean;

  if (rules.length === 0) {
    isConfiguredApprover = hasBlanketApprovalOverride(ctx);
  } else {
    const creatorRoleCode = createdBy ? await getPackBomUserRoleCode(createdBy) : null;
    const scopedRules = pickScopedApproverRules(
      {
        resource_code: resourceCode,
        action_code: "APPROVE",
        requester_auth_user_id: createdBy ?? null,
        requester_role_code: creatorRoleCode,
      },
      rules,
    );
    isConfiguredApprover = scopedRules.length > 0
      ? matchesApprover(scopedRules, {
        auth_user_id: ctx.auth_user_id,
        roleCode: ctx.roleCode,
        approverWorkContextIds: await loadApproverWorkContextIds(serviceRoleClient, ctx.auth_user_id, companyId),
      })
      : hasBlanketApprovalOverride(ctx);
  }

  if (!isConfiguredApprover) {
    throw new Error("PROD_BOM_APPROVER_ROLE_REQUIRED");
  }

  if (createdBy && createdBy === ctx.auth_user_id && !hasBlanketApprovalOverride(ctx)) {
    throw new Error("PROD_BOM_SELF_APPROVAL_FORBIDDEN");
  }
}

export async function approvePackBomHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    const id = getIdFromPath(req);
    if (!id) return bomError(req, ctx, "PROD_BOM_ID_MISSING", 400, "ID required");

    const body = await parseBody(req);
    const editedLines: JsonRecord[] = Array.isArray(body.lines) ? body.lines : [];

    const { data: bom, error: bomFetchErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom")
      .select("id, status, sku_material_id, company_id, created_by")
      .eq("id", id)
      .maybeSingle();

    if (bomFetchErr) throw new Error("PROD_BOM_FETCH_FAILED");
    if (!bom) return bomError(req, ctx, "PROD_BOM_NOT_FOUND", 404, "Pack BOM not found");
    await assertPackBomCompanyScope(ctx, (bom as JsonRecord).company_id as string);
    await assertPackBomApproverRole(
      ctx,
      "PROD_PACK_BOM_APPROVAL",
      (bom as JsonRecord).company_id as string,
      (bom as JsonRecord).created_by as string | null,
    );
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
        qty: l.qty == null || l.qty === "" ? null : (parsePositiveNumber(l.qty) ?? 0),
        uom_code: toTrimmedString(l.uom_code) || null,
        storage_location_id: toTrimmedString(l.storage_location_id) || null,
        movement_type_code: toTrimmedString(l.movement_type_code) || null,
        has_alternate: l.has_alternate === true || l.has_alternate === "true",
        material_group_id: toTrimmedString(l.material_group_id) || null,
        is_primary_container: l.is_primary_container === true || l.is_primary_container === "true",
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
    await syncPackBomConversions(id, ctx.auth_user_id);

    return okResponse({ id, status: "ACTIVE" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BOM_APPROVE_FAILED";
    const status = ["PROD_BOM_SCOPE_VIOLATION", "PROD_BOM_APPROVER_ROLE_REQUIRED", "PROD_BOM_SELF_APPROVAL_FORBIDDEN"].includes(code) ? 403 : 500;
    return bomError(req, ctx, code, status, "Pack BOM approve failed");
  }
}

// POST /api/production/pack-boms/:id/reject
export async function rejectPackBomHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
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
      .select("id, status, company_id, created_by")
      .eq("id", id)
      .maybeSingle();

    if (bomFetchErr) throw new Error("PROD_BOM_FETCH_FAILED");
    if (!bom) return bomError(req, ctx, "PROD_BOM_NOT_FOUND", 404, "Pack BOM not found");
    await assertPackBomCompanyScope(ctx, (bom as JsonRecord).company_id as string);
    await assertPackBomApproverRole(
      ctx,
      "PROD_PACK_BOM_APPROVAL",
      (bom as JsonRecord).company_id as string,
      (bom as JsonRecord).created_by as string | null,
    );
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
    const status = ["PROD_BOM_SCOPE_VIOLATION", "PROD_BOM_APPROVER_ROLE_REQUIRED", "PROD_BOM_SELF_APPROVAL_FORBIDDEN"].includes(code) ? 403 : 500;
    return bomError(req, ctx, code, status, "Pack BOM reject failed");
  }
}

// ── PACK BOM CHANGE REQUESTS ───────────────────────────────────────────────

// ADD/REMOVE/EDIT each target a distinct bom_line_id (ADD creates a new row
// nothing else in this batch references), so each is independent — but dedupe
// EDITs by bom_line_id first (keep last, matching the original sequential
// last-write-wins) in case the same line appears twice, then batch REMOVE as
// one delete and run ADD/EDIT writes in parallel. Shared by both the
// bom_required=false auto-apply path and PR08's own approve path.
async function applyPackBomLineChanges(packBomId: string, changesToApply: JsonRecord[]): Promise<void> {
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
    if (change.is_primary_container != null) update.is_primary_container = change.is_primary_container === true || change.is_primary_container === "true";
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
          is_primary_container: change.is_primary_container === true || change.is_primary_container === "true",
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
}

// POST /api/production/pack-boms/:id/change-request
// Non-fixed pack codes (599/000/001, bom_required=false) never need PR08
// approval for changes either — same "auto-ACTIVE" logic as create (§83.15,
// "599 / 000 / 001 post-ACTIVE edits: Procurement can edit directly"). The
// change request row is still written (append-only audit trail, same
// principle used elsewhere in this codebase — e.g. PR19), but it's inserted
// already APPROVED and the line changes are applied immediately, instead of
// sitting in DRAFT waiting for PR08.
export async function createPackBomChangeRequestHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
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
      .select("id, status, sku_material_id, company_id")
      .eq("id", id)
      .maybeSingle();

    if (bomFetchErr) throw new Error("PROD_BOM_FETCH_FAILED");
    if (!bom) return bomError(req, ctx, "PROD_BOM_NOT_FOUND", 404, "Pack BOM not found");
    await assertPackBomCompanyScope(ctx, (bom as JsonRecord).company_id as string);
    if ((bom as JsonRecord).status !== "ACTIVE") {
      return bomError(req, ctx, "PROD_BCR_BOM_NOT_ACTIVE", 422, "Change requests can only be created for ACTIVE Pack BOMs");
    }

    // Check no existing DRAFT change request for this BOM
    const { count: draftCount } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom_change_request")
      .select("id", { count: "exact", head: true })
      .eq("pack_bom_id", id)
      .eq("status", "DRAFT") as { count?: number };

    if ((draftCount ?? 0) > 0) {
      return bomError(req, ctx, "PROD_BCR_ALREADY_PENDING", 409, "A pending change request already exists for this BOM");
    }

    // bom_required drives whether this change needs PR08 approval at all
    const skuMap = await getMaterialMapByIds(
      [String((bom as JsonRecord).sku_material_id ?? "")],
      "[pack_bom.createPackBomChangeRequest]",
      "PROD_BCR_CREATE_FAILED",
      "id, pack_code",
    );
    const sku = skuMap.get(String((bom as JsonRecord).sku_material_id ?? "")) ?? {};
    const packCode = await getPackCodeByCode(toTrimmedString(sku.pack_code));
    const bomRequired = Boolean(packCode?.bom_required);
    const now = new Date().toISOString();

    // Insert change request — auto-approved immediately for bom_required=false
    const { data: cr, error: crErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom_change_request")
      .insert({
        pack_bom_id: id,
        status: bomRequired ? "DRAFT" : "APPROVED",
        created_by: ctx.auth_user_id,
        ...(bomRequired ? {} : { approved_by: ctx.auth_user_id, approved_at: now }),
      })
      .select("id")
      .single();

    if (crErr) throw new Error("PROD_BCR_CREATE_FAILED");
    const crId = (cr as JsonRecord).id as string;

    // Insert change lines (audit trail either way)
    const lineRows = changes.map((c: JsonRecord, idx: number) => ({
      change_request_id: crId,
      action: toTrimmedString(c.action) || "EDIT",
      bom_line_id: toTrimmedString(c.bom_line_id) || null,
      material_id: toTrimmedString(c.material_id) || null,
      qty: c.qty != null ? (parsePositiveNumber(c.qty) ?? 0) : null,
      uom_code: toTrimmedString(c.uom_code) || null,
      has_alternate: c.has_alternate === true || c.has_alternate === "true",
      material_group_id: toTrimmedString(c.material_group_id) || null,
      is_primary_container: c.is_primary_container === true || c.is_primary_container === "true",
      display_order: idx,
    }));

    const { error: lErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom_change_request_line")
      .insert(lineRows);

    if (lErr) throw new Error("PROD_BCR_LINES_INSERT_FAILED");

    if (!bomRequired) {
      await applyPackBomLineChanges(id, changes);
      await syncPackBomConversions(id, ctx.auth_user_id);
      return createdOkResponse({ id: crId, status: "APPROVED", auto_approved: true }, ctx.request_id, req);
    }

    return createdOkResponse({ id: crId, status: "DRAFT", auto_approved: false }, ctx.request_id, req);
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
          id, company_id, sku_material_id, status
        )
      `)
      .order("created_at", { ascending: false });

    if (status) query = query.eq("status", status);
    if (packBomId) query = query.eq("pack_bom_id", packBomId);

    const { data, error } = await query;
    if (error) {
      console.error("[pack_bom.listPackBomChangeRequests] query failed:", JSON.stringify(error));
      throw new Error("PROD_BCR_LIST_FAILED");
    }

    const rows = (data ?? []) as JsonRecord[];
    const skuMap = await getMaterialMapByIds(
      rows.map((row) => String(((row.bom as JsonRecord | null)?.sku_material_id) ?? "")),
      "[pack_bom.listPackBomChangeRequests]",
      "PROD_BCR_LIST_FAILED",
      "id, pace_code, material_name, pack_code",
    );
    const [companyMap, userDisplayMap] = await Promise.all([
      getCompanyMapByIds(rows.map((row) => String(((row.bom as JsonRecord | null)?.company_id) ?? ""))),
      resolveUserDisplayNames(rows.flatMap((r) => [
        String(r.created_by ?? ""), String(r.approved_by ?? ""),
      ])),
    ]);
    return okResponse({
      data: rows.map((row) => {
        const bom = ((row.bom ?? null) as JsonRecord | null);
        return {
          ...row,
          bom: bom ? {
            ...bom,
            company: companyMap.get(String(bom.company_id ?? "")) ?? null,
            sku: skuMap.get(String(bom.sku_material_id ?? "")) ?? null,
          } : null,
          created_by_display: userDisplayMap.get(String(row.created_by ?? "")) ?? null,
          approved_by_display: userDisplayMap.get(String(row.approved_by ?? "")) ?? null,
        };
      }),
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BCR_LIST_FAILED";
    return bomError(req, ctx, code, 500, "Pack BOM change request list failed");
  }
}

// GET /api/production/pack-bom-change-requests/:id
// Was missing entirely — PR08 previously approved with no visibility into the
// actual proposed ADD/REMOVE/EDIT lines (drawer just showed the change_request
// id). Mirrors getStrokeChangeRequestHandler's Current-vs-Proposed shape.
export async function getPackBomChangeRequestHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return bomError(req, ctx, "PROD_BCR_ID_MISSING", 400, "Change request ID required");

    const { data, error } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom_change_request")
      .select("id, pack_bom_id, status, created_by, created_at, approved_by, approved_at, reject_reason")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[pack_bom.getPackBomChangeRequest] query failed:", JSON.stringify(error));
      throw new Error("PROD_BCR_FETCH_FAILED");
    }
    if (!data) return bomError(req, ctx, "PROD_BCR_NOT_FOUND", 404, "Change request not found");
    const row = data as JsonRecord;
    const packBomId = String(row.pack_bom_id ?? "");

    const [bomRes, lineRes, changeLineRes] = await Promise.all([
      serviceRoleClient.schema("erp_production").from("pack_bom")
        .select("id, company_id, sku_material_id, status")
        .eq("id", packBomId).maybeSingle(),
      serviceRoleClient.schema("erp_production").from("pack_bom_line")
        .select("id, line_type, material_id, qty, uom_code, has_alternate, material_group_id, is_primary_container, display_order")
        .eq("pack_bom_id", packBomId).order("display_order"),
      serviceRoleClient.schema("erp_production").from("pack_bom_change_request_line")
        .select("id, change_request_id, action, bom_line_id, material_id, qty, uom_code, has_alternate, material_group_id, is_primary_container, display_order")
        .eq("change_request_id", id).order("display_order"),
    ]);

    if (bomRes.error) {
      console.error("[pack_bom.getPackBomChangeRequest] bom query failed:", JSON.stringify(bomRes.error));
      throw new Error("PROD_BCR_FETCH_FAILED");
    }
    if (lineRes.error) {
      console.error("[pack_bom.getPackBomChangeRequest] bom line query failed:", JSON.stringify(lineRes.error));
      throw new Error("PROD_BCR_FETCH_FAILED");
    }
    if (changeLineRes.error) {
      console.error("[pack_bom.getPackBomChangeRequest] change line query failed:", JSON.stringify(changeLineRes.error));
      throw new Error("PROD_BCR_LINES_FAILED");
    }

    const bom = bomRes.data as JsonRecord | null;
    const bomLines = ((lineRes.data ?? []) as JsonRecord[]).filter((l) => l.line_type === "INPUT");
    const changeLines = (changeLineRes.data ?? []) as JsonRecord[];
    const bomLineMap = new Map(bomLines.map((l) => [String(l.id), l]));

    const [companyMap, skuMap, materialMap, groupMap, userDisplayMap] = await Promise.all([
      getCompanyMapByIds([String(bom?.company_id ?? "")]),
      getMaterialMapByIds(
        [String(bom?.sku_material_id ?? "")],
        "[pack_bom.getPackBomChangeRequest]",
        "PROD_BCR_FETCH_FAILED",
        "id, pace_code, material_name, pack_code",
      ),
      getMaterialMapByIds(
        [
          ...bomLines.map((l) => String(l.material_id ?? "")),
          ...changeLines.map((l) => String(l.material_id ?? "")),
        ],
        "[pack_bom.getPackBomChangeRequest]",
        "PROD_BCR_FETCH_FAILED",
        "id, pace_code, material_name, base_uom_code",
      ),
      getGroupMapByIds([
        ...bomLines.map((l) => String(l.material_group_id ?? "")),
        ...changeLines.map((l) => String(l.material_group_id ?? "")),
      ]),
      resolveUserDisplayNames([String(row.created_by ?? ""), String(row.approved_by ?? "")]),
    ]);

    return okResponse({
      data: {
        ...row,
        created_by_display: userDisplayMap.get(String(row.created_by ?? "")) ?? null,
        approved_by_display: userDisplayMap.get(String(row.approved_by ?? "")) ?? null,
        bom: bom ? {
          ...bom,
          company: companyMap.get(String(bom.company_id ?? "")) ?? null,
          sku: skuMap.get(String(bom.sku_material_id ?? "")) ?? null,
        } : null,
        change_lines: changeLines.map((line) => {
          const currentLine = bomLineMap.get(String(line.bom_line_id ?? ""));
          return {
            ...line,
            material: materialMap.get(String(line.material_id ?? "")) ?? null,
            material_group: groupMap.get(String(line.material_group_id ?? "")) ?? null,
            old_material_id: currentLine ? currentLine.material_id ?? null : null,
            old_material: currentLine ? materialMap.get(String(currentLine.material_id ?? "")) ?? null : null,
            old_qty: currentLine ? currentLine.qty ?? null : null,
            old_uom_code: currentLine ? currentLine.uom_code ?? null : null,
            old_has_alternate: currentLine ? Boolean(currentLine.material_group_id) : false,
            old_is_primary_container: currentLine ? Boolean(currentLine.is_primary_container) : false,
            old_group_id: currentLine ? currentLine.material_group_id ?? null : null,
            old_group: currentLine ? groupMap.get(String(currentLine.material_group_id ?? "")) ?? null : null,
          };
        }),
      },
    }, ctx.request_id, req);
  } catch (err) {
    console.error("[pack_bom.getPackBomChangeRequestHandler] request_id:", ctx.request_id, "error:", err);
    const code = err instanceof Error ? err.message : "PROD_BCR_FETCH_FAILED";
    return bomError(req, ctx, code, 500, "Pack BOM change request fetch failed");
  }
}

// POST /api/production/pack-bom-change-requests/:id/approve
export async function approvePackBomChangeRequestHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    const id = getIdFromPath(req);
    if (!id) return bomError(req, ctx, "PROD_BCR_ID_MISSING", 400, "ID required");

    const body = await parseBody(req);
    const editedChanges: JsonRecord[] = Array.isArray(body.changes) ? body.changes : [];

    // Fetch change request
    const { data: cr, error: crFetchErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom_change_request")
      .select("id, status, pack_bom_id, created_by, bom:pack_bom!pack_bom_id(company_id)")
      .eq("id", id)
      .maybeSingle();

    if (crFetchErr) throw new Error("PROD_BCR_FETCH_FAILED");
    if (!cr) return bomError(req, ctx, "PROD_BCR_NOT_FOUND", 404, "Change request not found");
    const crCompanyId = ((cr as JsonRecord).bom as JsonRecord | null)?.company_id as string;
    await assertPackBomCompanyScope(ctx, crCompanyId);
    await assertPackBomApproverRole(
      ctx,
      "PROD_CHANGE_PACK_BOM_APPROVAL",
      crCompanyId,
      (cr as JsonRecord).created_by as string | null,
    );
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
        .select("action, bom_line_id, material_id, qty, uom_code, has_alternate, material_group_id, is_primary_container, display_order")
        .eq("change_request_id", id)
        .order("display_order");
      changesToApply = (dbLines ?? []) as JsonRecord[];
    }

    await applyPackBomLineChanges(packBomId, changesToApply);

    const now = new Date().toISOString();
    const { error: updateErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom_change_request")
      .update({ status: "APPROVED", approved_by: ctx.auth_user_id, approved_at: now })
      .eq("id", id);

    if (updateErr) throw new Error("PROD_BCR_APPROVE_FAILED");
    await syncPackBomConversions(packBomId, ctx.auth_user_id);

    return okResponse({ id, status: "APPROVED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BCR_APPROVE_FAILED";
    const status = ["PROD_BOM_SCOPE_VIOLATION", "PROD_BOM_APPROVER_ROLE_REQUIRED", "PROD_BOM_SELF_APPROVAL_FORBIDDEN"].includes(code) ? 403 : 500;
    return bomError(req, ctx, code, status, "Pack BOM change request approve failed");
  }
}

// POST /api/production/pack-bom-change-requests/:id/reject
export async function rejectPackBomChangeRequestHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
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
      .select("id, status, created_by, bom:pack_bom!pack_bom_id(company_id)")
      .eq("id", id)
      .maybeSingle();

    if (crFetchErr) throw new Error("PROD_BCR_FETCH_FAILED");
    if (!cr) return bomError(req, ctx, "PROD_BCR_NOT_FOUND", 404, "Change request not found");
    const crCompanyId = ((cr as JsonRecord).bom as JsonRecord | null)?.company_id as string;
    await assertPackBomCompanyScope(ctx, crCompanyId);
    await assertPackBomApproverRole(
      ctx,
      "PROD_CHANGE_PACK_BOM_APPROVAL",
      crCompanyId,
      (cr as JsonRecord).created_by as string | null,
    );
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
    const status = ["PROD_BOM_SCOPE_VIOLATION", "PROD_BOM_APPROVER_ROLE_REQUIRED", "PROD_BOM_SELF_APPROVAL_FORBIDDEN"].includes(code) ? 403 : 500;
    return bomError(req, ctx, code, status, "Pack BOM change request reject failed");
  }
}
