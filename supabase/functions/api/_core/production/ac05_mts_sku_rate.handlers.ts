/*
 * Gate 27.29 / AC05 MTS SKU Costing (§142).
 * Manual rate fields are the sole commercial authority. `verification` is
 * computed at read time only and is deliberately never accepted by a writer.
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { errorResponse, okResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import { parseBody, toTrimmedString } from "./production.shared.ts";
import { materialMap, packCodeRow, resolvePmComposition } from "./ac07_costing.handlers.ts";
import {
  getEligibleProdshadeIdsForVendorCode,
  isPrimaryVendorCodeForCompany,
  listCompanyVendorCodesForSalesOrderHandler,
  resolveStrokeForProdshadeAndVendorCode,
  resolveVendorCodeForStroke,
} from "./vendor_code.handlers.ts";

type Row = Record<string, unknown>;
const RESOURCE = "ACC_AC05_MTS_SKU_COSTING";

function ids(values: unknown): string[] {
  return [...new Set((Array.isArray(values) ? values : []).map(toTrimmedString).filter(Boolean))];
}

function ac05Error(req: Request, ctx: ProdHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

async function companyScope(ctx: ProdHandlerContext, requested?: string | null): Promise<string> {
  const companyId = toTrimmedString(requested) || toTrimmedString(ctx.context.companyId);
  if (companyId) await assertCompanyScope(ctx, companyId);
  return companyId;
}

async function requireAc05Action(req: Request, ctx: ProdHandlerContext, companyId: string, action: "VIEW" | "WRITE"): Promise<Response | null> {
  return await canMaintainCompanyResource(ctx, companyId, RESOURCE, action)
    ? null
    : ac05Error(req, ctx, "AC05_FORBIDDEN", 403, "You do not have MTS SKU Costing access for the selected company.");
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function dateMonth(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.slice(0, 7)}-01` : "";
}

function pathId(req: Request, segment: string): string {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const index = parts.indexOf(segment);
  return index >= 0 ? toTrimmedString(parts[index + 1]) : "";
}

async function vendorCodesForCompany(req: Request, ctx: ProdHandlerContext): Promise<Row[]> {
  // Reuse AC11/SO01's established Primary-first mapping query; AC05 must not
  // grow a second vendor-code resolution path.
  const response = await listCompanyVendorCodesForSalesOrderHandler(req, ctx);
  const body = await response.clone().json().catch(() => null) as { ok?: boolean; data?: { data?: Row[] } } | null;
  if (!response.ok || !body?.ok) throw new Error("AC05_VENDOR_CODE_LIST_FAILED");
  return Array.isArray(body.data?.data) ? body.data.data : [];
}

async function mappedVendorCode(companyId: string, vendorCodeId: string): Promise<Row | null> {
  const { data, error } = await serviceRoleClient.schema("erp_production").from("company_vendor_code_map")
    .select("id, vendor_code_id, is_primary").eq("company_id", companyId).eq("vendor_code_id", vendorCodeId).eq("active", true).maybeSingle();
  if (error) throw new Error("AC05_VENDOR_CODE_LOOKUP_FAILED");
  return (data as Row) ?? null;
}

async function getSku(companyId: string, skuMaterialId: string): Promise<Row | null> {
  const { data: sku, error: skuError } = await serviceRoleClient.schema("erp_master").from("material_master")
    .select("id, pace_code, material_name, external_code, document_name, material_type, status, shade_code, pack_code, base_uom_code, material_category")
    .eq("id", skuMaterialId).maybeSingle();
  if (skuError) throw new Error("AC05_SKU_LOOKUP_FAILED");
  if (!sku || toTrimmedString(sku.material_type).toUpperCase() !== "FG" || toTrimmedString(sku.status).toUpperCase() !== "ACTIVE") return null;
  const { data: extension, error: extensionError } = await serviceRoleClient.schema("erp_master").from("material_company_ext")
    .select("material_id").eq("company_id", companyId).eq("material_id", skuMaterialId).eq("status", "ACTIVE").maybeSingle();
  if (extensionError) throw new Error("AC05_SKU_LOOKUP_FAILED");
  return extension ? sku as Row : null;
}

async function hasInnerPack(skuMaterialId: string, sku: Row): Promise<boolean> {
  const composition = await resolvePmComposition(skuMaterialId, sku);
  return composition.lines.some((line) => Boolean(line.is_primary_container));
}

// SKU <-> Prodshade identity is external_code based: a SKU's own
// external_code (or material_name when external_code is unset) is always
// "<Prodshade's external_code><Pack Code>" (e.g. "56750000" + "120" =
// "56750000120"), the exact convention sales_order.handlers.ts's
// listSalesOrderFgSkuOptionsHandler (§141) already relies on. shade_code is
// NOT usable for this -- verified live against Prod (2026-09-24): the IWC
// Prodshade "56750000" (SFG-00063) carries the generic placeholder
// shade_code '0000', which 18 unrelated FG SKUs and 9 unrelated SFG
// materials also carry, so a shade_code-only match (this file's first cut,
// and ac07_costing.handlers.ts's own resolveProdshade()) silently pulls in
// every one of them. Do not go back to shade_code matching here.
async function deriveProdshadeForSku(sku: Row): Promise<Row | null> {
  const key = toTrimmedString(sku.external_code) || toTrimmedString(sku.material_name);
  const pack = toTrimmedString(sku.pack_code);
  if (!key || !pack || !key.endsWith(pack)) return null;
  const prefix = key.slice(0, key.length - pack.length);
  if (!prefix) return null;
  const db = serviceRoleClient.schema("erp_master");
  const [byExternalCode, byName] = await Promise.all([
    db.from("material_master").select("id, pace_code, material_name, external_code")
      .in("material_type", ["SFG", "INT"]).eq("external_code", prefix).maybeSingle(),
    db.from("material_master").select("id, pace_code, material_name, external_code")
      .in("material_type", ["SFG", "INT"]).eq("material_name", prefix).maybeSingle(),
  ]);
  if (byExternalCode.error) throw new Error("AC05_PRODSHADE_LOOKUP_FAILED");
  if (byExternalCode.data) return byExternalCode.data as Row;
  if (byName.error) throw new Error("AC05_PRODSHADE_LOOKUP_FAILED");
  return (byName.data as Row) ?? null;
}

// The reverse of deriveProdshadeForSku, batched: given Prodshade material_ids
// and this company's real prodshade_pack_config rows, construct each expected
// SKU code (Prodshade code + Pack Code) and look up the matching,
// company-mapped, ACTIVE FG SKU. Returns a Map keyed by prodshade_material_id.
async function findSkusForProdshades(prodshadeIds: string[], companyId: string): Promise<Map<string, Row[]>> {
  const result = new Map<string, Row[]>();
  if (!prodshadeIds.length) return result;
  const db = serviceRoleClient.schema("erp_production");
  const configRows = await fetchInChunks<Row>(prodshadeIds, (chunk) => db.from("prodshade_pack_config")
    .select("material_id, pack_code_id").eq("active", true).in("material_id", chunk));
  if (!configRows.length) return result;
  const packCodeIds = ids(configRows.map((row) => row.pack_code_id));
  const packCodeRows = await fetchInChunks<Row>(packCodeIds, (chunk) => db.from("pack_code_master").select("id, pack_code").in("id", chunk));
  const packCodeById = new Map(packCodeRows.map((row) => [toTrimmedString(row.id), toTrimmedString(row.pack_code)]));
  const prodshades = await materialMap(prodshadeIds);
  const codeToProdshadeId = new Map<string, string>();
  for (const config of configRows) {
    const prodshadeId = toTrimmedString(config.material_id);
    const prodshade = prodshades.get(prodshadeId);
    const prodshadeCode = toTrimmedString(prodshade?.external_code) || toTrimmedString(prodshade?.material_name);
    const packCode = packCodeById.get(toTrimmedString(config.pack_code_id));
    if (!prodshadeCode || !packCode) continue;
    codeToProdshadeId.set(`${prodshadeCode}${packCode}`, prodshadeId);
  }
  const codes = [...codeToProdshadeId.keys()];
  if (!codes.length) return result;
  const skuSelect = "id, pace_code, material_name, external_code, document_name, base_uom_code, pack_code, material_category";
  const [extensions, byExternalCode, byName] = await Promise.all([
    serviceRoleClient.schema("erp_master").from("material_company_ext").select("material_id").eq("company_id", companyId).eq("status", "ACTIVE"),
    fetchInChunks<Row>(codes, (chunk) => serviceRoleClient.schema("erp_master").from("material_master")
      .select(skuSelect).eq("material_type", "FG").eq("status", "ACTIVE").in("external_code", chunk)),
    fetchInChunks<Row>(codes, (chunk) => serviceRoleClient.schema("erp_master").from("material_master")
      .select(skuSelect).eq("material_type", "FG").eq("status", "ACTIVE").in("material_name", chunk)),
  ]);
  if (extensions.error) throw new Error("AC05_SKU_LOOKUP_FAILED");
  const activeIds = new Set(ids(((extensions.data ?? []) as Row[]).map((row) => row.material_id)));
  const skuByCode = new Map<string, Row>();
  for (const row of [...byExternalCode, ...byName]) {
    if (!activeIds.has(toTrimmedString(row.id))) continue;
    const code = toTrimmedString(row.external_code) || toTrimmedString(row.material_name);
    if (code) skuByCode.set(code, row);
  }
  for (const [code, prodshadeId] of codeToProdshadeId) {
    const sku = skuByCode.get(code);
    if (!sku) continue;
    result.set(prodshadeId, [...(result.get(prodshadeId) ?? []), sku]);
  }
  return result;
}

// A Stroke's MTS eligibility is decided by stroke_po_type_applicability
// (target_po_type='MTS', is_active) -- never stroke_master.po_type directly.
// The 2026-08-31 Stroke Share redesign lets one APPROVED Stroke serve
// multiple PO Types; stroke_master.po_type only ever reflects its own
// original type. Same source of truth sales_order.handlers.ts's
// listSalesOrderFgSkuOptionsHandler (§141) already established for the
// identical question -- do not reintroduce a raw po_type='MTS' filter.
async function mtsEligibleStrokesForCompany(companyId: string): Promise<Row[]> {
  const db = serviceRoleClient.schema("erp_production");
  const { data: strokes, error: strokeError } = await db.from("stroke_master")
    .select("id, prodshade_material_id").eq("company_id", companyId).eq("status", "APPROVED");
  if (strokeError) throw new Error("AC05_STROKE_LOOKUP_FAILED");
  const rows = (strokes ?? []) as Row[];
  if (!rows.length) return [];
  const strokeIds = ids(rows.map((row) => row.id));
  const applicable = await fetchInChunks<Row>(strokeIds, (chunk) => db.from("stroke_po_type_applicability")
    .select("stroke_master_id").eq("target_po_type", "MTS").eq("is_active", true).in("stroke_master_id", chunk));
  const applicableIds = new Set(applicable.map((row) => toTrimmedString(row.stroke_master_id)));
  return rows.filter((row) => applicableIds.has(toTrimmedString(row.id)));
}

function validateRateFields(input: Row, innerRequired: boolean): { values: Row } | { code: string; message: string } {
  const base = numeric(input.rate_per_base_uom);
  const inner = numeric(input.rate_per_inner_pack);
  const outer = numeric(input.rate_per_outer_uom);
  const rmWastage = numeric(input.rm_wastage_pct);
  const packWastage = numeric(input.pack_wastage_pct);
  if (base === null || base < 0 || outer === null || outer < 0) return { code: "AC05_RATE_REQUIRED", message: "Rate per Base UOM and Rate per Outer UOM are required numbers." };
  if (innerRequired && (inner === null || inner < 0)) return { code: "AC05_INNER_RATE_REQUIRED", message: "Rate per Inner Pack is required for this SKU." };
  if ((inner !== null && inner < 0) || (rmWastage !== null && rmWastage < 0) || (packWastage !== null && packWastage < 0)) {
    return { code: "AC05_RATE_INVALID", message: "Rates and wastage percentages cannot be negative." };
  }
  return { values: { rate_per_base_uom: base, rate_per_inner_pack: innerRequired ? inner : null, rate_per_outer_uom: outer, rm_wastage_pct: rmWastage, pack_wastage_pct: packWastage } };
}

async function verificationForRate(row: Row, sku: Row, companyId: string): Promise<Row> {
  const strokeId = toTrimmedString(row.resolved_stroke_master_id);
  const effectiveDate = toTrimmedString(row.effective_date);
  const unavailable: Row = { rmc: null, pmc: null, conversion_cost: null, per_kg: null, per_inner_pack: null, per_outer_uom: null };
  if (!strokeId || !effectiveDate) return unavailable;
  const [strokeLinesResult, pm, prodshade, packCode] = await Promise.all([
    serviceRoleClient.schema("erp_production").from("stroke_line").select("material_id, dosage_pct, line_material_type")
      .eq("stroke_master_id", strokeId).in("line_material_type", ["RM", "INT"]),
    resolvePmComposition(toTrimmedString(sku.id), sku),
    deriveProdshadeForSku(sku),
    packCodeRow(toTrimmedString(sku.pack_code)),
  ]);
  if (strokeLinesResult.error) throw new Error("AC05_VERIFICATION_STROKE_LOOKUP_FAILED");
  const strokeLines = (strokeLinesResult.data ?? []) as Row[];
  const rmMaterialIds = ids(strokeLines.map((line) => line.material_id));
  const pmMaterialIds = ids(pm.lines.map((line) => line.material_id));
  const allMaterialIds = ids([...rmMaterialIds, ...pmMaterialIds]);
  const month = dateMonth(effectiveDate)
    ? await serviceRoleClient.schema("erp_production").from("ac06_month").select("id, rate_month, status")
      .eq("company_id", companyId).eq("rate_month", dateMonth(effectiveDate)).maybeSingle()
    : { data: null, error: null };
  if (month.error) throw new Error("AC05_VERIFICATION_AC06_MONTH_FAILED");
  const [{ data: conversion, error: conversionError }, rates] = await Promise.all([
    prodshade?.id
      ? serviceRoleClient.schema("erp_production").from("conversion_cost_config")
        .select("conversion_rate_per_kg, margin_cost_per_kg, transportation_cost_per_kg")
        .eq("company_id", companyId).eq("prodshade_material_id", toTrimmedString(prodshade.id))
        .lte("valid_from", effectiveDate).order("valid_from", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    month.data?.id && allMaterialIds.length
      // Dynamic import intentionally avoids a static module cycle: AC06 imports
      // this file only for its post-insert cascade hook.
      ? import("./ac06_workspace.handlers.ts").then(({ resolveAc06RatesAsOf }) => resolveAc06RatesAsOf({ id: toTrimmedString(month.data.id), rate_month: toTrimmedString(month.data.rate_month), status: toTrimmedString(month.data.status) }, allMaterialIds, effectiveDate))
      : Promise.resolve(new Map()),
  ]);
  if (conversionError) throw new Error("AC05_VERIFICATION_CONVERSION_FAILED");
  const rmRatesComplete = rmMaterialIds.every((id) => rates.get(id)?.rate !== null && rates.get(id)?.rate !== undefined);
  const pmRatesComplete = pm.perPackQtyFixed !== null && pm.perPackQtyFixed > 0 && pmMaterialIds.every((id) => rates.get(id)?.rate !== null && rates.get(id)?.rate !== undefined);
  const rmc = rmRatesComplete ? strokeLines.reduce((sum, line) => sum + (Number(line.dosage_pct ?? 0) / 100) * Number(rates.get(toTrimmedString(line.material_id))?.rate), 0) : null;
  const pmc = pmRatesComplete ? pm.lines.reduce((sum, line) => sum + Number(line.qty ?? 0) * Number(rates.get(toTrimmedString(line.material_id))?.rate), 0) / Number(pm.perPackQtyFixed) : null;
  const conversionCost = conversion
    ? Number(conversion.conversion_rate_per_kg ?? 0) + Number(conversion.margin_cost_per_kg ?? 0) + Number(conversion.transportation_cost_per_kg ?? 0)
    : null;
  const perKg = rmc === null || pmc === null || conversionCost === null ? null
    : rmc * (1 + Number(row.rm_wastage_pct ?? 0) / 100) + pmc * (1 + Number(row.pack_wastage_pct ?? 0) / 100) + conversionCost;
  if (perKg === null || pm.perPackQtyFixed === null || !packCode?.bom_required) {
    return { rmc, pmc, conversion_cost: conversionCost, per_kg: perKg, per_inner_pack: null, per_outer_uom: null };
  }
  const outerUom = toTrimmedString(packCode.outer_uom_code);
  const baseUom = toTrimmedString(sku.base_uom_code);
  const { data: conversions, error: conversionFactorError } = await serviceRoleClient.schema("erp_master").from("material_uom_conversion")
    .select("from_uom_code, to_uom_code, conversion_factor").eq("material_id", toTrimmedString(sku.id)).eq("active", true);
  if (conversionFactorError) throw new Error("AC05_VERIFICATION_UOM_FAILED");
  const outerFactor = outerUom === baseUom ? 1 : Number(((conversions ?? []) as Row[]).find((item) => toTrimmedString(item.from_uom_code) === outerUom && toTrimmedString(item.to_uom_code) === baseUom)?.conversion_factor ?? NaN);
  return {
    rmc, pmc, conversion_cost: conversionCost, per_kg: perKg,
    per_inner_pack: perKg * Number(pm.perPackQtyFixed),
    per_outer_uom: Number.isFinite(outerFactor) ? perKg * outerFactor : null,
  };
}

export async function listAc05VendorCodesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const companyId = await companyScope(ctx, new URL(req.url).searchParams.get("company_id"));
    if (!companyId) return ac05Error(req, ctx, "AC05_COMPANY_REQUIRED", 400, "company_id is required.");
    const access = await requireAc05Action(req, ctx, companyId, "VIEW"); if (access) return access;
    return okResponse({ data: await vendorCodesForCompany(req, ctx) }, ctx.request_id, req);
  } catch (error) { return ac05Error(req, ctx, error instanceof Error ? error.message : "AC05_VENDOR_CODE_LIST_FAILED", 500, "Unable to load company vendor codes."); }
}

export async function listAc05RatesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const companyId = await companyScope(ctx, new URL(req.url).searchParams.get("company_id"));
    if (!companyId) return ac05Error(req, ctx, "AC05_COMPANY_REQUIRED", 400, "company_id is required.");
    const access = await requireAc05Action(req, ctx, companyId, "VIEW"); if (access) return access;
    const db = serviceRoleClient.schema("erp_production");
    const { data: storedRows, error } = await db.from("ac05_mts_sku_rate").select("*").eq("company_id", companyId).order("effective_date", { ascending: false });
    if (error) throw new Error("AC05_LIST_FAILED");
    const rows = (storedRows ?? []) as Row[];
    const skuById = await materialMap(ids(rows.map((row) => row.sku_material_id)));
    const mapIds = ids(rows.map((row) => row.company_vendor_code_map_id));
    const maps = mapIds.length ? await fetchInChunks<Row>(mapIds, (chunk) => db.from("company_vendor_code_map").select("id, vendor_code_id").in("id", chunk)) : [];
    const vendorCodes = ids(maps.map((map) => map.vendor_code_id));
    const codeRows = vendorCodes.length ? await fetchInChunks<Row>(vendorCodes, (chunk) => db.from("vendor_code_master").select("id, vendor_code").in("id", chunk)) : [];
    const mapById = new Map(maps.map((map) => [toTrimmedString(map.id), map]));
    const codeById = new Map(codeRows.map((code) => [toTrimmedString(code.id), code]));
    const verification = await Promise.all(rows.map(async (row) => verificationForRate(row, skuById.get(toTrimmedString(row.sku_material_id)) ?? {}, companyId)));
    const data = rows.map((row, index) => {
      const sku = skuById.get(toTrimmedString(row.sku_material_id));
      const mapping = mapById.get(toTrimmedString(row.company_vendor_code_map_id));
      const code = mapping ? codeById.get(toTrimmedString(mapping.vendor_code_id)) : null;
      return {
        id: row.id, vendor_code_id: mapping?.vendor_code_id ?? null, vendor_code: code?.vendor_code ?? null,
        sku: { pace_code: sku?.pace_code ?? null, material_name: sku?.material_name ?? null, document_name: sku?.document_name ?? null },
        rate_per_base_uom: row.rate_per_base_uom, rate_per_inner_pack: row.rate_per_inner_pack, rate_per_outer_uom: row.rate_per_outer_uom,
        rm_wastage_pct: row.rm_wastage_pct, pack_wastage_pct: row.pack_wastage_pct, effective_date: row.effective_date,
        status: row.status, source: row.source, verification: verification[index],
      };
    });
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) { return ac05Error(req, ctx, error instanceof Error ? error.message : "AC05_LIST_FAILED", 500, "Unable to load MTS SKU costing rows."); }
}

export async function listAc05EligibleSkusHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url); const companyId = await companyScope(ctx, url.searchParams.get("company_id")); const vendorCodeId = toTrimmedString(url.searchParams.get("vendor_code_id"));
    if (!companyId || !vendorCodeId) return ac05Error(req, ctx, "AC05_ELIGIBLE_SKU_INVALID", 400, "company_id and vendor_code_id are required.");
    const access = await requireAc05Action(req, ctx, companyId, "VIEW"); if (access) return access;
    const mapping = await mappedVendorCode(companyId, vendorCodeId); if (!mapping) return ac05Error(req, ctx, "AC05_VENDOR_CODE_INVALID", 422, "Vendor Code is not active for this company.");
    const [mtsStrokes, primary] = await Promise.all([
      mtsEligibleStrokesForCompany(companyId),
      isPrimaryVendorCodeForCompany(companyId, vendorCodeId),
    ]);
    const allProdshadeIds = ids(mtsStrokes.map((stroke) => stroke.prodshade_material_id));
    const eligibleProdshadeIds = primary ? new Set(allProdshadeIds) : await getEligibleProdshadeIdsForVendorCode(companyId, vendorCodeId);
    const targetProdshadeIds = allProdshadeIds.filter((id) => eligibleProdshadeIds.has(id));
    const skusByProdshade = await findSkusForProdshades(targetProdshadeIds, companyId);
    const seen = new Set<string>();
    const skus: Row[] = [];
    for (const rows of skusByProdshade.values()) for (const sku of rows) {
      const id = toTrimmedString(sku.id);
      if (!seen.has(id)) { seen.add(id); skus.push(sku); }
    }
    const data = await Promise.all(skus.map(async (sku) => ({
      material_id: sku.id, pace_code: sku.pace_code, material_name: sku.material_name, document_name: sku.document_name,
      has_inner_pack: await hasInnerPack(toTrimmedString(sku.id), sku),
    })));
    data.sort((a, b) => toTrimmedString(a.pace_code).localeCompare(toTrimmedString(b.pace_code)));
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) { return ac05Error(req, ctx, error instanceof Error ? error.message : "AC05_ELIGIBLE_SKU_FAILED", 500, "Unable to load eligible MTS SKUs."); }
}

export async function createAc05RateRowHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req); const companyId = await companyScope(ctx, toTrimmedString(body.company_id)); const vendorCodeId = toTrimmedString(body.vendor_code_id); const skuId = toTrimmedString(body.sku_material_id); const effectiveDate = toTrimmedString(body.effective_date);
    if (!companyId || !vendorCodeId || !skuId || !dateMonth(effectiveDate)) return ac05Error(req, ctx, "AC05_CREATE_INVALID", 400, "Company, Vendor Code, SKU, and Effective Date are required.");
    const access = await requireAc05Action(req, ctx, companyId, "WRITE"); if (access) return access;
    const [mapping, sku] = await Promise.all([mappedVendorCode(companyId, vendorCodeId), getSku(companyId, skuId)]);
    if (!mapping) return ac05Error(req, ctx, "AC05_VENDOR_CODE_INVALID", 422, "Vendor Code is not active for this company.");
    if (!sku) return ac05Error(req, ctx, "AC05_SKU_INVALID", 422, "SKU is not an active company-mapped FG SKU.");
    const [prodshade, inner] = await Promise.all([deriveProdshadeForSku(sku), hasInnerPack(skuId, sku)]);
    if (!prodshade) return ac05Error(req, ctx, "AC05_PRODSHADE_NOT_FOUND", 422, "No Prodshade could be resolved for this SKU.");
    const stroke = await resolveStrokeForProdshadeAndVendorCode(companyId, toTrimmedString(prodshade.id), toTrimmedString(mapping.id));
    if (!stroke) return ac05Error(req, ctx, "AC05_STROKE_NOT_FOUND", 422, "No approved MTS Stroke found for this Prodshade + Vendor Code combination.");
    const validation = validateRateFields(body, inner); if ("code" in validation) return ac05Error(req, ctx, validation.code, 422, validation.message);
    const { data, error } = await serviceRoleClient.schema("erp_production").from("ac05_mts_sku_rate").insert({
      company_id: companyId, company_vendor_code_map_id: mapping.id, sku_material_id: skuId, resolved_stroke_master_id: stroke.stroke_master_id,
      ...validation.values, effective_date: effectiveDate, status: "RATED", source: "MANUAL", created_by: ctx.auth_user_id,
    }).select("id, status, effective_date, rate_per_outer_uom").single();
    if (error) return ac05Error(req, ctx, error.code === "23505" ? "AC05_EFFECTIVE_DATE_EXISTS" : "AC05_CREATE_FAILED", error.code === "23505" ? 409 : 500, error.code === "23505" ? "A rate row already exists for this Vendor Code, SKU, and Effective Date." : "Unable to create MTS SKU rate.");
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) { return ac05Error(req, ctx, error instanceof Error ? error.message : "AC05_CREATE_FAILED", 500, "Unable to create MTS SKU rate."); }
}

export async function updateAc05PendingRowHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req); const id = pathId(req, "ac05-mts-sku-rates"); const companyId = await companyScope(ctx, toTrimmedString(body.company_id));
    if (!id || !companyId) return ac05Error(req, ctx, "AC05_UPDATE_INVALID", 400, "Rate row id and company_id are required.");
    const access = await requireAc05Action(req, ctx, companyId, "WRITE"); if (access) return access;
    const db = serviceRoleClient.schema("erp_production"); const { data: row, error: rowError } = await db.from("ac05_mts_sku_rate").select("id, sku_material_id, status").eq("id", id).eq("company_id", companyId).maybeSingle();
    if (rowError) throw new Error("AC05_UPDATE_FAILED"); if (!row) return ac05Error(req, ctx, "AC05_NOT_FOUND", 404, "Rate row not found for this company.");
    if (row.status === "RATED") return ac05Error(req, ctx, "AC05_RATED_IMMUTABLE", 409, "A rated row is immutable; create a new effective-dated row for a correction.");
    const sku = await getSku(companyId, toTrimmedString(row.sku_material_id)); if (!sku) return ac05Error(req, ctx, "AC05_SKU_INVALID", 422, "The pending row's SKU is no longer valid for this company.");
    const validation = validateRateFields(body, await hasInnerPack(toTrimmedString(row.sku_material_id), sku)); if ("code" in validation) return ac05Error(req, ctx, validation.code, 422, validation.message);
    const { data, error } = await db.from("ac05_mts_sku_rate").update({ ...validation.values, status: "RATED", last_updated_by: ctx.auth_user_id, last_updated_at: new Date().toISOString() }).eq("id", id).eq("status", "PENDING").select("id, status, effective_date, rate_per_outer_uom").maybeSingle();
    if (error) throw new Error("AC05_UPDATE_FAILED"); if (!data) return ac05Error(req, ctx, "AC05_RATED_IMMUTABLE", 409, "A rated row is immutable; create a new effective-dated row for a correction.");
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) { return ac05Error(req, ctx, error instanceof Error ? error.message : "AC05_UPDATE_FAILED", 500, "Unable to fill the pending MTS SKU rate."); }
}

export async function deleteAc05PendingRowHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req); const id = pathId(req, "ac05-mts-sku-rates"); const companyId = await companyScope(ctx, toTrimmedString(body.company_id));
    if (!id || !companyId) return ac05Error(req, ctx, "AC05_DELETE_INVALID", 400, "Rate row id and company_id are required.");
    const access = await requireAc05Action(req, ctx, companyId, "WRITE"); if (access) return access;
    const { data: deleted, error } = await serviceRoleClient.schema("erp_production").from("ac05_mts_sku_rate").delete().eq("id", id).eq("company_id", companyId).eq("status", "PENDING").select("id").maybeSingle();
    if (error) throw new Error("AC05_DELETE_FAILED"); if (!deleted) return ac05Error(req, ctx, "AC05_RATED_IMMUTABLE", 409, "Only pending rows may be removed.");
    return okResponse({ data: { id, deleted: true } }, ctx.request_id, req);
  } catch (error) { return ac05Error(req, ctx, error instanceof Error ? error.message : "AC05_DELETE_FAILED", 500, "Unable to remove the pending MTS SKU rate."); }
}

export async function getAc05PendingCountHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const companyId = await companyScope(ctx, new URL(req.url).searchParams.get("company_id")); if (!companyId) return ac05Error(req, ctx, "AC05_COMPANY_REQUIRED", 400, "company_id is required.");
    const access = await requireAc05Action(req, ctx, companyId, "VIEW"); if (access) return access;
    const { count, error } = await serviceRoleClient.schema("erp_production").from("ac05_mts_sku_rate").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "PENDING");
    if (error) throw new Error("AC05_PENDING_COUNT_FAILED"); return okResponse({ data: { pending_count: count ?? 0 } }, ctx.request_id, req);
  } catch (error) { return ac05Error(req, ctx, error instanceof Error ? error.message : "AC05_PENDING_COUNT_FAILED", 500, "Unable to count pending MTS SKU rates."); }
}

export async function resolveAc05RateForSoHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url); const companyId = await companyScope(ctx, url.searchParams.get("company_id")); const vendorCodeId = toTrimmedString(url.searchParams.get("vendor_code_id")); const skuId = toTrimmedString(url.searchParams.get("sku_material_id")); const asOfDate = toTrimmedString(url.searchParams.get("as_of_date"));
    if (!companyId || !vendorCodeId || !skuId || !dateMonth(asOfDate)) return ac05Error(req, ctx, "AC05_RESOLVE_INVALID", 400, "company_id, vendor_code_id, sku_material_id, and as_of_date are required.");
    const access = await requireAc05Action(req, ctx, companyId, "VIEW"); if (access) return access;
    const mapping = await mappedVendorCode(companyId, vendorCodeId); if (!mapping) return ac05Error(req, ctx, "AC05_VENDOR_CODE_INVALID", 404, "Vendor Code is not active for this company.");
    const { data, error } = await serviceRoleClient.schema("erp_production").from("ac05_mts_sku_rate").select("rate_per_outer_uom, effective_date")
      .eq("company_id", companyId).eq("company_vendor_code_map_id", mapping.id).eq("sku_material_id", skuId).eq("status", "RATED").lte("effective_date", asOfDate).order("effective_date", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error("AC05_RESOLVE_FAILED"); if (!data) return ac05Error(req, ctx, "AC05_RATE_NOT_FOUND", 404, "No rated MTS SKU rate applies on the supplied SO date.");
    return okResponse({ data: { rate_per_outer_uom: data.rate_per_outer_uom, effective_date: data.effective_date } }, ctx.request_id, req);
  } catch (error) { return ac05Error(req, ctx, error instanceof Error ? error.message : "AC05_RESOLVE_FAILED", 500, "Unable to resolve the MTS SKU rate."); }
}

// Called after AC06 has successfully inserted a split. This function may throw;
// its AC06 caller catches it so downstream bookkeeping cannot block the split.
export async function cascadeAc05RowsFromAc06Split(companyId: string, materialId: string, slocGroupId: string, effectiveDate: string, actorUserId: string): Promise<void> {
  const db = serviceRoleClient.schema("erp_production");
  const { data: members, error: memberError } = await db.from("ac06_sloc_group_member").select("storage_location_id").eq("company_id", companyId).eq("sloc_group_id", slocGroupId).eq("active", true);
  if (memberError) throw new Error("AC05_CASCADE_MEMBER_LOOKUP_FAILED");
  const slocIds = ids((members ?? []).map((member: Row) => member.storage_location_id)); if (!slocIds.length) return;
  const lines = await fetchInChunks<Row>(slocIds, (chunk) => db.from("stroke_line").select("stroke_master_id").eq("material_id", materialId).in("default_storage_location_id", chunk));
  const strokeIds = ids(lines.map((line) => line.stroke_master_id)); if (!strokeIds.length) return;
  const [strokesResult, applicableRows] = await Promise.all([
    fetchInChunks<Row>(strokeIds, (chunk) => db.from("stroke_master").select("id, prodshade_material_id").eq("company_id", companyId).eq("status", "APPROVED").in("id", chunk)),
    // MTS eligibility via stroke_po_type_applicability, not stroke_master.po_type
    // -- see mtsEligibleStrokesForCompany's own comment for why.
    fetchInChunks<Row>(strokeIds, (chunk) => db.from("stroke_po_type_applicability").select("stroke_master_id").eq("target_po_type", "MTS").eq("is_active", true).in("stroke_master_id", chunk)),
  ]);
  const applicableIds = new Set(applicableRows.map((row) => toTrimmedString(row.stroke_master_id)));
  const strokes = strokesResult.filter((stroke) => applicableIds.has(toTrimmedString(stroke.id)));
  if (!strokes.length) return;
  const skusByProdshade = await findSkusForProdshades(ids(strokes.map((stroke) => stroke.prodshade_material_id)), companyId);
  const strokeVendorPairs = await Promise.all(strokes.map(async (stroke) => ({ stroke, vendor: await resolveVendorCodeForStroke(companyId, toTrimmedString(stroke.id)) })));
  const vendorIds = ids(strokeVendorPairs.map(({ vendor }) => vendor?.vendor_code_id));
  const maps = vendorIds.length ? await fetchInChunks<Row>(vendorIds, (chunk) => db.from("company_vendor_code_map").select("id, vendor_code_id").eq("company_id", companyId).eq("active", true).in("vendor_code_id", chunk)) : [];
  const mapByVendorId = new Map(maps.map((map) => [toTrimmedString(map.vendor_code_id), map]));
  const candidates = strokeVendorPairs.flatMap(({ stroke, vendor }) => {
    const mapping = vendor ? mapByVendorId.get(vendor.vendor_code_id) : null;
    const skus = skusByProdshade.get(toTrimmedString(stroke.prodshade_material_id)) ?? [];
    return mapping ? skus.map((sku) => ({ stroke, mapping, sku })) : [];
  });
  if (!candidates.length) return;
  const { data: allCompanyRows, error: priorError } = await db.from("ac05_mts_sku_rate").select("company_vendor_code_map_id, sku_material_id, rm_wastage_pct, pack_wastage_pct, effective_date").eq("company_id", companyId).order("effective_date", { ascending: false });
  if (priorError) throw new Error("AC05_CASCADE_PRIOR_LOOKUP_FAILED");
  const priorByPair = new Map<string, Row>(); for (const prior of ((allCompanyRows ?? []) as Row[]).filter((row) => toTrimmedString(row.effective_date) < effectiveDate)) { const key = `${prior.company_vendor_code_map_id}:${prior.sku_material_id}`; if (!priorByPair.has(key)) priorByPair.set(key, prior); }
  const inserts = candidates.map(({ stroke, mapping, sku }) => { const prior = priorByPair.get(`${mapping.id}:${sku.id}`); return { company_id: companyId, company_vendor_code_map_id: mapping.id, sku_material_id: sku.id, resolved_stroke_master_id: stroke.id, effective_date: effectiveDate, status: "PENDING", source: "AC06_SPLIT_CASCADE", rm_wastage_pct: prior?.rm_wastage_pct ?? null, pack_wastage_pct: prior?.pack_wastage_pct ?? null, created_by: actorUserId }; });
  const { error: insertError } = await db.from("ac05_mts_sku_rate").upsert(inserts, { onConflict: "company_vendor_code_map_id,sku_material_id,effective_date", ignoreDuplicates: true });
  if (insertError) throw new Error("AC05_CASCADE_INSERT_FAILED");
}
