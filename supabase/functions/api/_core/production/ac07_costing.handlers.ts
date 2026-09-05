/*
 * File-Path: supabase/functions/api/_core/production/ac07_costing.handlers.ts
 * Purpose: AC07 Admixture Costing -- read-only report. Resolves a chosen FG
 * SKU's dosage-weighted RM/INT cost (Stroke Master, multi-stroke side by
 * side) + PM cost (own Pack BOM, or a same-category/same-pack-code
 * fallback drawn from real Packing PO history when the pack code has no
 * BOM at all, e.g. 599/000/001/510) against an AC06 costing month's rates
 * (or blank/manual entry). No data is written here -- FG cost arithmetic
 * (RMC + Conversion = SFG Cost, PM ÷ Per Pack Qty = PMC, SFG + PMC = FG
 * Cost) happens client-side so the "Manual month" / "Per Pack Qty" fields
 * can recalculate live without a round trip.
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { errorResponse, okResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import { assertProdReadRole, toTrimmedString, toUpperTrimmedString } from "./production.shared.ts";

type Row = Record<string, unknown>;

const AC07_RESOURCE = "ACC_AC07_ADMIX_COSTING";
// Same convention process_order.handlers.ts's own callers already use when
// creating a real Process PO -- MTO/MTEST land on the ADMIX conversion
// segment, HPS on its own. MTS/Powder is out of this report's scope.
const SEGMENT_BY_PO_TYPE: Record<string, string> = { MTO: "ADMIX", MTEST: "ADMIX", HPS: "HPS" };
// A Pack BOM/Packing-PO PM line matching one of these is the "outer
// container" whose own count tells us how many packs a historical batch
// actually made -- used only to derive a sensible Per Pack Qty suggestion
// when this pack code has no BOM to read qty_per_pack from directly.
const CONTAINER_NAME_PATTERN = /BARREL|DRUM|IBC|JAR|BOTTLE|BAG|CAN\b|TIN\b|PAIL|CARTON/i;

const ac07Error = (req: Request, ctx: ProdHandlerContext, code: string, status: number, message: string) =>
  errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);

function ids(input: unknown): string[] {
  return [...new Set((Array.isArray(input) ? input : []).map(toTrimmedString).filter(Boolean))];
}

async function companyScope(ctx: ProdHandlerContext, requested?: string | null): Promise<string> {
  const companyId = toTrimmedString(requested) || toTrimmedString(ctx.context.companyId);
  if (companyId) await assertCompanyScope(ctx, companyId);
  return companyId;
}

async function requireAc07View(req: Request, ctx: ProdHandlerContext, companyId: string): Promise<Response | null> {
  const allowed = await canMaintainCompanyResource(ctx, companyId, AC07_RESOURCE, "VIEW");
  return allowed ? null : ac07Error(req, ctx, "AC07_FORBIDDEN", 403, "You do not have Admixture Costing access for the selected company.");
}

async function materialMap(materialIds: string[]): Promise<Map<string, Row>> {
  const result = new Map<string, Row>();
  if (!materialIds.length) return result;
  const rows = await fetchInChunks<Row>(materialIds, (chunk) => serviceRoleClient.schema("erp_master").from("material_master")
    .select("id, pace_code, external_code, material_name, document_name, material_type, material_category, shade_code, pack_code").in("id", chunk));
  for (const row of rows) result.set(toTrimmedString(row.id), row);
  return result;
}

async function packCodeRow(packCode: string): Promise<Row | null> {
  if (!packCode) return null;
  const { data, error } = await serviceRoleClient.schema("erp_production").from("pack_code_master")
    .select("pack_code, pack_name, pack_type, billing_uom, bom_required, outer_uom_code")
    .eq("pack_code", packCode).maybeSingle();
  if (error) throw new Error("AC07_PACK_CODE_LOOKUP_FAILED");
  return (data as Row) ?? null;
}

async function resolveProdshade(sku: Row): Promise<Row | null> {
  const shadeCode = toTrimmedString(sku.shade_code);
  if (!shadeCode) return null;
  const { data, error } = await serviceRoleClient.schema("erp_master").from("material_master")
    .select("id, pace_code, material_name, material_category")
    .eq("shade_code", shadeCode).in("material_type", ["SFG", "INT"]).maybeSingle();
  if (error) throw new Error("AC07_PRODSHADE_LOOKUP_FAILED");
  return (data as Row) ?? null;
}

// Own Pack BOM first (Fixed-BOM pack codes always have one); if that has no
// PM lines (bom_required=false pack codes never do, by design -- §83.15),
// fall back to real Packing PO history: this exact SKU's own most recent
// batch first, and only if this SKU has never been packed, a different SKU
// sharing the same material_category + pack_code.
async function resolvePmComposition(skuMaterialId: string, sku: Row): Promise<{ source: string; sourceSkuPaceCode: string | null; lines: Row[]; perPackQtyFixed: number | null }> {
  const db = serviceRoleClient.schema("erp_production");

  const { data: ownBom, error: bomErr } = await db.from("pack_bom")
    .select("id").eq("sku_material_id", skuMaterialId).eq("status", "ACTIVE").maybeSingle();
  if (bomErr) throw new Error("AC07_PACK_BOM_LOOKUP_FAILED");
  if (ownBom?.id) {
    const { data: allLines, error: lineErr } = await db.from("pack_bom_line")
      .select("line_type, material_id, qty, uom_code, is_primary_container").eq("pack_bom_id", ownBom.id);
    if (lineErr) throw new Error("AC07_PACK_BOM_LINE_LOOKUP_FAILED");
    const rows = (allLines ?? []) as Row[];
    const pmLines = rows.filter((r) => r.line_type === "PM");
    // Fixed-BOM pack codes always carry the OUTPUT row's own qty -- that IS
    // the per-pack fill, so Per Pack Qty is read-only and comes from here,
    // never a user-typed default.
    const outputLine = rows.find((r) => r.line_type === "OUTPUT");
    if (pmLines.length) {
      return { source: "own_pack_bom", sourceSkuPaceCode: null, lines: pmLines, perPackQtyFixed: outputLine ? Number(outputLine.qty ?? 0) : null };
    }
  }

  const ownHistory = await mostRecentPackingPoPmLines(skuMaterialId);
  if (ownHistory) return { source: "own_packing_history", sourceSkuPaceCode: null, lines: ownHistory, perPackQtyFixed: null };

  const { data: candidates, error: candErr } = await serviceRoleClient.schema("erp_master").from("material_master")
    .select("id, pace_code").eq("material_category", toTrimmedString(sku.material_category)).eq("pack_code", toTrimmedString(sku.pack_code))
    .eq("material_type", "FG").neq("id", skuMaterialId);
  if (candErr) throw new Error("AC07_FALLBACK_SKU_LOOKUP_FAILED");
  for (const candidate of (candidates ?? []) as Row[]) {
    const candidateId = toTrimmedString(candidate.id);
    const lines = await mostRecentPackingPoPmLines(candidateId);
    if (lines) return { source: "category_fallback", sourceSkuPaceCode: toTrimmedString(candidate.pace_code), lines, perPackQtyFixed: null };
  }
  return { source: "none", sourceSkuPaceCode: null, lines: [], perPackQtyFixed: null };
}

async function mostRecentPackingPoPmLines(skuMaterialId: string): Promise<Row[] | null> {
  const db = serviceRoleClient.schema("erp_production");
  const { data: po, error: poErr } = await db.from("packing_order")
    .select("id, created_at, actual_qty_kg, num_packs").eq("material_id", skuMaterialId).eq("status", "FINAL")
    .order("finalized_at", { ascending: false }).limit(1).maybeSingle();
  if (poErr) throw new Error("AC07_PACKING_HISTORY_LOOKUP_FAILED");
  if (!po?.id) return null;

  const { data: allLines, error: lineErr } = await db.from("packing_order_line")
    .select("line_type, material_id, actual_material_id, qty_per_pack, total_qty, actual_qty").eq("packing_order_id", po.id);
  if (lineErr) throw new Error("AC07_PACKING_HISTORY_LINE_LOOKUP_FAILED");
  const rows = (allLines ?? []) as Row[];
  const fgLine = rows.find((r) => r.line_type === "FG");
  const pmLines = rows.filter((r) => r.line_type === "PM");
  if (!pmLines.length) return null;

  const fgQty = Number(po.actual_qty_kg ?? fgLine?.actual_qty ?? fgLine?.total_qty ?? 0);
  const packCount = Number(po.num_packs ?? 0);
  const effectiveMaterialIds = ids(pmLines.map((r) => r.actual_material_id || r.material_id));
  const materials = await materialMap(effectiveMaterialIds);
  return pmLines.map((line) => {
    const materialId = toTrimmedString(line.actual_material_id) || toTrimmedString(line.material_id);
    const actualQty = Number(line.actual_qty ?? line.total_qty ?? 0);
    const storedQtyPerPack = Number(line.qty_per_pack ?? 0);
    const material = materials.get(materialId);
    const isContainer = CONTAINER_NAME_PATTERN.test(toTrimmedString(material?.material_name));
    return {
      material_id: materialId,
      // Final actual consumption is authoritative. This preserves recipes such
      // as 2 labels/pack instead of flattening every positive PM line to 1.
      qty: packCount > 0 ? actualQty / packCount : storedQtyPerPack,
      is_primary_container: isContainer,
      _fg_qty: fgQty,
      _pack_count: packCount,
    };
  });
}

function suggestedPerPackQty(pmLines: Row[]): number | null {
  const container = pmLines.find((l) => Number(l._pack_count ?? 0) > 0 && Boolean(l.is_primary_container))
    ?? pmLines.find((l) => Number(l._pack_count ?? 0) > 0);
  if (!container) return null;
  const fgQty = Number(container._fg_qty ?? 0);
  const packCount = Number(container._pack_count ?? 0);
  return packCount > 0 ? Number((fgQty / packCount).toFixed(4)) : null;
}

export async function listAc07SkusHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await companyScope(ctx, url.searchParams.get("company_id"));
    if (!companyId) return ac07Error(req, ctx, "AC07_SKU_LIST_INVALID", 400, "company_id is required.");
    const accessError = await requireAc07View(req, ctx, companyId);
    if (accessError) return accessError;

    const { data: mapRows, error: mapErr } = await serviceRoleClient.schema("erp_master").from("material_company_ext")
      .select("material_id").eq("company_id", companyId).eq("status", "ACTIVE");
    if (mapErr) throw new Error("AC07_SKU_LIST_FAILED");
    const mappedIds = ids((mapRows ?? []).map((r: Row) => r.material_id));
    if (!mappedIds.length) return okResponse({ data: [] }, ctx.request_id, req);

    const rows = await fetchInChunks<Row>(mappedIds, (chunk) => serviceRoleClient.schema("erp_master").from("material_master")
      .select("id, pace_code, material_name, document_name, material_category, shade_code, pack_code, status")
      .in("id", chunk).eq("material_type", "FG").eq("status", "ACTIVE"));

    // Resolve each SKU's Prodshade in bulk (by shade_code) up front, so the
    // frontend can list that Prodshade's strokes as soon as a SKU is picked,
    // without a round trip that itself needs a Prodshade it doesn't have yet.
    const shadeCodes = [...new Set(rows.map((r) => toTrimmedString(r.shade_code)).filter(Boolean))];
    const prodshadeByShade = new Map<string, Row>();
    if (shadeCodes.length) {
      const prodshadeRows = await fetchInChunks<Row>(shadeCodes, (chunk) => serviceRoleClient.schema("erp_master")
        .from("material_master").select("id, pace_code, material_name, shade_code").in("shade_code", chunk).in("material_type", ["SFG", "INT"]));
      for (const row of prodshadeRows) prodshadeByShade.set(toTrimmedString(row.shade_code), row);
    }

    return okResponse({ data: rows.map((r) => {
      const prodshade = prodshadeByShade.get(toTrimmedString(r.shade_code));
      return {
        id: r.id, pace_code: r.pace_code, material_name: r.material_name,
        document_name: r.document_name, pack_code: r.pack_code,
        prodshade_material_id: prodshade?.id ?? null, prodshade_material_name: prodshade?.material_name ?? null,
      };
    }) }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "AC07_SKU_LIST_FAILED";
    return ac07Error(req, ctx, code, 500, "Unable to load SKU list.");
  }
}

export async function listAc07StrokesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await companyScope(ctx, url.searchParams.get("company_id"));
    const prodshadeMaterialId = toTrimmedString(url.searchParams.get("prodshade_material_id"));
    if (!companyId || !prodshadeMaterialId) return ac07Error(req, ctx, "AC07_STROKE_LIST_INVALID", 400, "company_id and prodshade_material_id are required.");
    const accessError = await requireAc07View(req, ctx, companyId);
    if (accessError) return accessError;

    const { data, error } = await serviceRoleClient.schema("erp_production").from("stroke_master")
      .select("id, stroke_number, status, po_type").eq("company_id", companyId).eq("prodshade_material_id", prodshadeMaterialId)
      .order("stroke_number");
    if (error) throw new Error("AC07_STROKE_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "AC07_STROKE_LIST_FAILED";
    return ac07Error(req, ctx, code, 500, "Unable to load strokes for this Prodshade.");
  }
}

export async function listAc07MonthsHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await companyScope(ctx, url.searchParams.get("company_id"));
    if (!companyId) return ac07Error(req, ctx, "AC07_MONTH_LIST_INVALID", 400, "company_id is required.");
    const accessError = await requireAc07View(req, ctx, companyId);
    if (accessError) return accessError;

    const { data, error } = await serviceRoleClient.schema("erp_production").from("ac06_month")
      .select("id, rate_month, status").eq("company_id", companyId).order("rate_month", { ascending: false });
    if (error) throw new Error("AC07_MONTH_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "AC07_MONTH_LIST_FAILED";
    return ac07Error(req, ctx, code, 500, "Unable to load costing months.");
  }
}

export async function getAc07CostingHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await companyScope(ctx, url.searchParams.get("company_id"));
    const skuMaterialId = toTrimmedString(url.searchParams.get("sku_material_id"));
    const strokeIds = ids(url.searchParams.get("stroke_ids")?.split(","));
    const ac06MonthId = toTrimmedString(url.searchParams.get("ac06_month_id")); // absent/empty => Manual

    if (!companyId || !skuMaterialId || !strokeIds.length) {
      return ac07Error(req, ctx, "AC07_COSTING_INVALID", 400, "company_id, sku_material_id and at least one stroke are required.");
    }
    const accessError = await requireAc07View(req, ctx, companyId);
    if (accessError) return accessError;

    const { data: skuRow, error: skuErr } = await serviceRoleClient.schema("erp_master").from("material_master")
      .select("id, pace_code, material_name, document_name, material_type, material_category, shade_code, pack_code, status")
      .eq("id", skuMaterialId).maybeSingle();
    if (skuErr) throw new Error("AC07_SKU_LOOKUP_FAILED");
    if (!skuRow) return ac07Error(req, ctx, "AC07_SKU_NOT_FOUND", 404, "SKU not found.");
    const sku = skuRow as Row;
    if (toUpperTrimmedString(sku.material_type) !== "FG" || toUpperTrimmedString(sku.status) !== "ACTIVE") {
      return ac07Error(req, ctx, "AC07_SKU_INVALID", 409, "The selected material is not an active FG SKU.");
    }
    const { data: companyMap, error: companyMapErr } = await serviceRoleClient.schema("erp_master").from("material_company_ext")
      .select("material_id").eq("company_id", companyId).eq("material_id", skuMaterialId).eq("status", "ACTIVE").maybeSingle();
    if (companyMapErr) throw new Error("AC07_SKU_COMPANY_LOOKUP_FAILED");
    if (!companyMap) return ac07Error(req, ctx, "AC07_SKU_COMPANY_INVALID", 409, "The selected SKU is not active for this company.");

    const prodshade = await resolveProdshade(sku);
    const [packCode, strokesRaw] = await Promise.all([
      packCodeRow(toTrimmedString(sku.pack_code)),
      serviceRoleClient.schema("erp_production").from("stroke_master")
        .select("id, stroke_number, status, po_type").eq("company_id", companyId)
        .eq("prodshade_material_id", toTrimmedString(prodshade?.id)).in("id", strokeIds),
    ]);
    if (strokesRaw.error) throw new Error("AC07_STROKE_LOOKUP_FAILED");
    const strokeMap = new Map(((strokesRaw.data ?? []) as Row[]).map((s) => [toTrimmedString(s.id), s]));
    const strokes = strokeIds.map((id) => strokeMap.get(id)).filter((s): s is Row => Boolean(s));
    if (strokes.length !== strokeIds.length) return ac07Error(req, ctx, "AC07_STROKE_NOT_FOUND", 404, "Every selected stroke must belong to this SKU's Prodshade and company.");

    const { data: strokeLineRows, error: lineErr } = await serviceRoleClient.schema("erp_production").from("stroke_line")
      .select("stroke_master_id, material_id, dosage_pct").in("stroke_master_id", strokeIds);
    if (lineErr) throw new Error("AC07_STROKE_LINE_LOOKUP_FAILED");
    const strokeLines = (strokeLineRows ?? []) as Row[];

    const rmIntMaterialIds = ids(strokeLines.map((l) => l.material_id));
    const pm = await resolvePmComposition(skuMaterialId, sku);
    const pmMaterialIds = ids(pm.lines.map((l) => l.material_id));

    const materials = await materialMap([...rmIntMaterialIds, ...pmMaterialIds]);

    // AC06 rates (skipped entirely in Manual mode -- frontend shows blank inputs)
    const rateByMaterial = new Map<string, { rate: number | null; wastage_other_pct: number; costing_group_name: string | null }>();
    if (ac06MonthId) {
      const { data: monthRow, error: monthErr } = await serviceRoleClient.schema("erp_production").from("ac06_month")
        .select("id, rate_month, status").eq("id", ac06MonthId).eq("company_id", companyId).maybeSingle();
      if (monthErr) throw new Error("AC07_MONTH_LOOKUP_FAILED");
      if (!monthRow) return ac07Error(req, ctx, "AC07_MONTH_NOT_FOUND", 404, "Costing month not found for this company.");
      const allMaterialIds = [...rmIntMaterialIds, ...pmMaterialIds];
      if (monthRow.status === "CLOSED") {
        const { data: archive, error: archErr } = await serviceRoleClient.schema("erp_production").from("ac06_month_archive")
          .select("id").eq("source_month_id", ac06MonthId).maybeSingle();
        if (archErr) throw new Error("AC07_ARCHIVE_LOOKUP_FAILED");
        if (archive?.id) {
          const rows = await fetchInChunks<Row>(allMaterialIds, (chunk) => serviceRoleClient.schema("erp_production")
            .from("ac06_month_archive_line").select("material_id, rate, wastage_other_pct, costing_group_name_snapshot")
            .eq("archive_id", archive.id).in("material_id", chunk));
          for (const row of rows) rateByMaterial.set(toTrimmedString(row.material_id), {
            rate: row.rate === null ? null : Number(row.rate),
            wastage_other_pct: Number(row.wastage_other_pct ?? 0),
            costing_group_name: (row.costing_group_name_snapshot as string) ?? null,
          });
        }
      } else {
        // ac06_month_line (live/open months) snapshots the group name as
        // costing_group_name_snapshot -- NOT source_sloc_group_name_snapshot,
        // which only exists on the archive table. Selecting the wrong column
        // name here 500'd every open-month selection (found live 2026-09-05).
        const rows = await fetchInChunks<Row>(allMaterialIds, (chunk) => serviceRoleClient.schema("erp_production")
          .from("ac06_month_line").select("material_id, rate, wastage_other_pct, costing_group_name_snapshot")
          .eq("month_id", ac06MonthId).in("material_id", chunk));
        for (const row of rows) rateByMaterial.set(toTrimmedString(row.material_id), {
          rate: row.rate === null ? null : Number(row.rate),
          wastage_other_pct: Number(row.wastage_other_pct ?? 0),
          costing_group_name: (row.costing_group_name_snapshot as string) ?? null,
        });
      }
    }

    const rmIntRows = rmIntMaterialIds.map((materialId) => {
      const material = materials.get(materialId);
      const rateInfo = rateByMaterial.get(materialId);
      return {
        material_id: materialId,
        material_name: material?.material_name ?? null,
        external_code: material?.external_code ?? null,
        material_type: material?.material_type ?? null,
        costing_group_name: rateInfo?.costing_group_name ?? null,
        rate: rateInfo?.rate ?? null,
        wastage_other_pct: rateInfo?.wastage_other_pct ?? null,
        wastage_other_mode: "PERCENT",
        dosage_by_stroke: Object.fromEntries(
          strokes.map((s) => [toTrimmedString(s.id), (
            strokeLines.find((l) => toTrimmedString(l.stroke_master_id) === toTrimmedString(s.id) && toTrimmedString(l.material_id) === materialId)?.dosage_pct ?? null
          )]),
        ),
      };
    });

    const pmRows = pm.lines.map((line) => {
      const materialId = toTrimmedString(line.material_id);
      const material = materials.get(materialId);
      const rateInfo = rateByMaterial.get(materialId);
      return {
        material_id: materialId,
        material_name: material?.material_name ?? null,
        external_code: material?.external_code ?? null,
        costing_group_name: rateInfo?.costing_group_name ?? null,
        rate: rateInfo?.rate ?? null,
        wastage_other_pct: rateInfo?.wastage_other_pct ?? null,
        // Despite the legacy column name, a Barrel's OTHER value is a flat
        // currency amount per unit; every non-Barrel row remains percentage.
        // Reference-only either way -- AC06's own rate already has this
        // baked in (confirmed 2026-09-05 against the real costing worksheet:
        // its "NET COST/KG" = D(base)+E(%wastage)+F(unloading) IS the stored
        // rate, nothing is re-applied downstream). Re-applying it here
        // double-counts, which is exactly what silently inflated FG Cost by
        // ~₹0.27/pack until this fix.
        wastage_other_mode: /BARREL/i.test(toTrimmedString(material?.material_name)) ? "FLAT_OTHER" : "PERCENT",
        qty_per_pack: Number(line.qty ?? line.qty_per_pack ?? 1),
      };
    });

    const segmentCodes = [...new Set(strokes.map((s) => SEGMENT_BY_PO_TYPE[toUpperTrimmedString(s.po_type)]).filter(Boolean))];
    const conversionRateBySegment = new Map<string, number | null>();
    await Promise.all(segmentCodes.map(async (segment) => {
      const { data: rate, error: convErr } = await serviceRoleClient.schema("erp_production").rpc("resolve_conversion_rate", {
        p_company_id: companyId, p_segment_code: segment, p_prodshade_material_id: prodshade?.id,
        p_posting_date: new Date().toISOString().slice(0, 10),
      });
      if (convErr) throw new Error("AC07_CONVERSION_RATE_LOOKUP_FAILED");
      conversionRateBySegment.set(segment, rate === null || rate === undefined ? null : Number(rate));
    }));
    const strokesWithCost = strokes.map((s) => {
      const strokeSegment = SEGMENT_BY_PO_TYPE[toUpperTrimmedString(s.po_type)] ?? null;
      return {
        id: s.id, stroke_number: s.stroke_number, status: s.status, po_type: s.po_type,
        segment_code: strokeSegment,
        conversion_rate: strokeSegment ? (conversionRateBySegment.get(strokeSegment) ?? null) : null,
      };
    });

    // Per Pack UOM Qty editability (business owner directive, 2026-09-05):
    // - Fixed-BOM pack codes (bom_required=true) -- read-only, from the Pack
    //   BOM's own OUTPUT row (per_pack_qty_fixed above).
    // - Pack code 000 (Tanker, billing PER_KG) -- basis is inherently 1 KG =
    //   1 KG, read-only, nothing to override.
    // - Everything else with bom_required=false (599 Barrel, 001 MTEST
    //   packet, 510 IBC) -- variable fill, manual editable, defaulted from
    //   whatever real historical fill this SKU (or its category+pack-code
    //   fallback) actually used.
    const isTankerPack = toTrimmedString(packCode?.pack_code) === "000";
    const perPackQtyEditable = !isTankerPack && packCode?.bom_required !== true;
    const perPackQtyDefault = isTankerPack ? 1 : (pm.perPackQtyFixed ?? suggestedPerPackQty(pm.lines));

    return okResponse({
      data: {
        sku: { id: sku.id, pace_code: sku.pace_code, material_name: sku.material_name, description: sku.document_name, pack_code: sku.pack_code },
        prodshade: prodshade ? { id: prodshade.id, pace_code: prodshade.pace_code, material_name: prodshade.material_name } : null,
        pack_code_info: packCode,
        strokes: strokesWithCost,
        rm_int_rows: rmIntRows,
        pm_rows: pmRows,
        pm_source: pm.source,
        pm_source_sku_pace_code: pm.sourceSkuPaceCode,
        per_pack_qty_editable: perPackQtyEditable,
        per_pack_qty_default: perPackQtyDefault,
        // Kept for older callers; the new UI uses each stroke's own values.
        conversion_rate: strokesWithCost[0]?.conversion_rate ?? null,
        segment_code: strokesWithCost[0]?.segment_code ?? null,
        is_manual_month: !ac06MonthId,
      },
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "AC07_COSTING_FAILED";
    return ac07Error(req, ctx, code, 500, "Unable to load Admixture Costing data.");
  }
}
