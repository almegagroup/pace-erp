/*
 * File-Path: supabase/functions/api/_core/procurement/manual_costing_rate.handlers.ts
 * Purpose: AC08 Manual Costing Rate Entry (Accounts). A Sales Order line whose
 *          Costing Rate Month is "MANUAL" (SO01CreatePage.jsx's costingMonthCell)
 *          has no AC06 month to draw RM/INT/PM rates from at all. This page lists
 *          exactly those dispatched MTO/HPS lines and lets Accounts hand-enter a
 *          rate per material (RM/INT from BOTH the SO's own declared stroke and
 *          the stroke actually used in production, unioned like AC07 does; PM
 *          lines too when the SKU's pack code is 599/Barrel), saved case-by-case
 *          into erp_procurement.manual_costing_rate_entry (never a shared
 *          company+material rate -- business owner, explicit, 2026-09-07).
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { fetchAllRows } from "../../_shared/fetchAllRows.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { materialMap, resolvePmComposition } from "../production/ac07_costing.handlers.ts";

type JsonRecord = Record<string, unknown>;
type ManualCostingHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const RESOURCE = "ACC_MANUAL_COSTING_RATE";
const FG_TYPES = ["MTO", "HPS"];

function textValue(value: unknown): string {
  return String(value ?? "").trim();
}
function uniqueValues(values: unknown[]): string[] {
  return [...new Set(values.map(textValue).filter(Boolean))];
}
function getPathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}
function getIdFromPath(req: Request): string {
  return getPathSegments(req)[3] ?? "";
}
function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function mcrError(req: Request, ctx: ManualCostingHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

async function requireView(req: Request, ctx: ManualCostingHandlerContext, companyId: string): Promise<Response | null> {
  const allowed = await canMaintainCompanyResource(ctx, companyId, RESOURCE, "VIEW");
  return allowed ? null : mcrError(req, ctx, "MCR_FORBIDDEN", 403, "You do not have Manual Costing Rate access for this company.");
}
async function requireWrite(req: Request, ctx: ManualCostingHandlerContext, companyId: string): Promise<Response | null> {
  const allowed = await canMaintainCompanyResource(ctx, companyId, RESOURCE, "WRITE");
  return allowed ? null : mcrError(req, ctx, "MCR_FORBIDDEN", 403, "You do not have Manual Costing Rate write access for this company.");
}

type Candidate = {
  soLine: JsonRecord;
  soNumber: string;
  material: JsonRecord;
  dcLine: JsonRecord;
  packingOrder: JsonRecord | null;
  processOrder: JsonRecord | null;
  actualStrokeMaster: JsonRecord | null;
  prodshadeMaterialId: string | null;
};

// Shared by both the list and detail handlers -- resolves every MANUAL-month
// MTO/HPS SO line that has at least one real dispatch (so a Production/Actual
// Stroke genuinely exists to compare against). A line dispatched more than
// once picks its first dc line's own Packing PO/stroke -- partial dispatches
// against DIFFERENT actual strokes for the same SO line are a real edge case
// this deliberately doesn't split into multiple rows (business owner: this
// whole scenario is rare enough that case-by-case simplicity wins).
async function resolveCandidates(companyId: string, onlySoLineId?: string): Promise<Candidate[]> {
  const soLines = onlySoLineId
    ? await (async () => {
      const { data, error } = await serviceRoleClient.schema("erp_procurement").from("sales_order_line")
        .select("id, so_id, material_id, fg_type, declared_stroke_number, costing_rate_month")
        .eq("costing_rate_month", "MANUAL").in("fg_type", FG_TYPES).eq("id", onlySoLineId);
      if (error) throw new Error("MCR_SO_LINE_LOOKUP_FAILED");
      return (data ?? []) as JsonRecord[];
    })()
    : await fetchAllRows<JsonRecord>((from, to) => serviceRoleClient.schema("erp_procurement").from("sales_order_line")
      .select("id, so_id, material_id, fg_type, declared_stroke_number, costing_rate_month")
      .eq("costing_rate_month", "MANUAL").in("fg_type", FG_TYPES)
      .order("id", { ascending: true }).range(from, to))
      .catch(() => { throw new Error("MCR_SO_LINE_LOOKUP_FAILED"); });
  if (soLines.length === 0) return [];

  const soIds = uniqueValues(soLines.map((row) => row.so_id));
  const { data: soRows, error: soErr } = await serviceRoleClient.schema("erp_procurement").from("sales_order")
    .select("id, so_number, company_id").in("id", soIds).eq("company_id", companyId);
  if (soErr) throw new Error("MCR_SO_LOOKUP_FAILED");
  const soById = new Map(((soRows ?? []) as JsonRecord[]).map((row) => [textValue(row.id), row]));

  const scopedLines = soLines.filter((row) => soById.has(textValue(row.so_id)));
  if (scopedLines.length === 0) return [];

  const soLineIds = scopedLines.map((row) => textValue(row.id));
  const dcLines = await fetchInChunks<JsonRecord>(soLineIds, (chunk) => serviceRoleClient
    .schema("erp_procurement").from("delivery_challan_line")
    .select("id, so_line_id, packing_order_id, batch_number, created_at")
    .in("so_line_id", chunk).order("created_at", { ascending: true }));
  const firstDcLineBySoLine = new Map<string, JsonRecord>();
  for (const row of dcLines) {
    const key = textValue(row.so_line_id);
    if (!firstDcLineBySoLine.has(key)) firstDcLineBySoLine.set(key, row);
  }

  const dispatchedLines = scopedLines.filter((row) => firstDcLineBySoLine.has(textValue(row.id)));
  if (dispatchedLines.length === 0) return [];

  const packingOrderIds = uniqueValues([...firstDcLineBySoLine.values()].map((row) => row.packing_order_id));
  const packingOrders = await fetchInChunks<JsonRecord>(packingOrderIds, (chunk) => serviceRoleClient
    .schema("erp_production").from("packing_order")
    .select("id, po_number, process_order_id").in("id", chunk));
  const packingById = new Map(packingOrders.map((row) => [textValue(row.id), row]));

  const processOrderIds = uniqueValues(packingOrders.map((row) => row.process_order_id));
  const processOrders = await fetchInChunks<JsonRecord>(processOrderIds, (chunk) => serviceRoleClient
    .schema("erp_production").from("process_order")
    .select("id, stroke_master_id").in("id", chunk));
  const processById = new Map(processOrders.map((row) => [textValue(row.id), row]));

  const actualStrokeMasterIds = uniqueValues(processOrders.map((row) => row.stroke_master_id));
  const actualStrokeMasters = await fetchInChunks<JsonRecord>(actualStrokeMasterIds, (chunk) => serviceRoleClient
    .schema("erp_production").from("stroke_master")
    .select("id, stroke_number, prodshade_material_id").in("id", chunk));
  const strokeMasterById = new Map(actualStrokeMasters.map((row) => [textValue(row.id), row]));

  const materialIds = uniqueValues(dispatchedLines.map((row) => row.material_id));
  const materials = await materialMap(materialIds);

  const candidates: Candidate[] = [];
  for (const soLine of dispatchedLines) {
    const dcLine = firstDcLineBySoLine.get(textValue(soLine.id))!;
    const packingOrder = packingById.get(textValue(dcLine.packing_order_id)) ?? null;
    const processOrder = packingOrder ? processById.get(textValue(packingOrder.process_order_id)) ?? null : null;
    const actualStrokeMaster = processOrder ? strokeMasterById.get(textValue(processOrder.stroke_master_id)) ?? null : null;
    const material = materials.get(textValue(soLine.material_id)) ?? {};
    candidates.push({
      soLine,
      soNumber: textValue(soById.get(textValue(soLine.so_id))?.so_number),
      material,
      dcLine,
      packingOrder,
      processOrder,
      actualStrokeMaster,
      prodshadeMaterialId: actualStrokeMaster ? textValue(actualStrokeMaster.prodshade_material_id) || null : null,
    });
  }
  return candidates;
}

// GET /api/procurement/manual-costing-rows
export async function listManualCostingRowsHandler(req: Request, ctx: ManualCostingHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = textValue(url.searchParams.get("company_id"));
    if (!companyId) return mcrError(req, ctx, "MCR_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    const accessError = await requireView(req, ctx, companyId);
    if (accessError) return accessError;

    const candidates = await resolveCandidates(companyId);
    if (candidates.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    const soLineIds = candidates.map((c) => textValue(c.soLine.id));
    const savedRows = await fetchInChunks<JsonRecord>(soLineIds, (chunk) => serviceRoleClient
      .schema("erp_procurement").from("manual_costing_rate_entry")
      .select("sales_order_line_id, material_id").in("sales_order_line_id", chunk));
    const savedCountBySoLine = new Map<string, number>();
    for (const row of savedRows) {
      const key = textValue(row.sales_order_line_id);
      savedCountBySoLine.set(key, (savedCountBySoLine.get(key) ?? 0) + 1);
    }

    const data = candidates.map((c) => ({
      so_line_id: c.soLine.id,
      so_number: c.soNumber,
      item: [textValue(c.material.pace_code), textValue(c.material.material_name)].filter(Boolean).join(" — "),
      document_name: textValue(c.material.document_name),
      external_code: textValue(c.material.external_code),
      batch_number: textValue(c.dcLine.batch_number),
      packing_po_number: textValue(c.packingOrder?.po_number),
      so_stroke: textValue(c.soLine.declared_stroke_number) || null,
      actual_stroke: textValue(c.actualStrokeMaster?.stroke_number) || null,
      rate_status: (savedCountBySoLine.get(textValue(c.soLine.id)) ?? 0) > 0 ? "STARTED" : "PENDING",
    }));
    data.sort((a, b) => textValue(a.so_number).localeCompare(textValue(b.so_number), undefined, { numeric: true }));
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    console.error("MANUAL_COSTING_LIST_FAILED", err);
    const code = err instanceof Error ? err.message : "MANUAL_COSTING_LIST_FAILED";
    return mcrError(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, "Unable to load Manual Costing rows.");
  }
}

// GET /api/procurement/manual-costing-rows/:so_line_id
export async function getManualCostingRowHandler(req: Request, ctx: ManualCostingHandlerContext): Promise<Response> {
  try {
    const soLineId = getIdFromPath(req);
    if (!soLineId) return mcrError(req, ctx, "MCR_ID_REQUIRED", 400, "so_line_id is required.");
    const url = new URL(req.url);
    const companyId = textValue(url.searchParams.get("company_id"));
    if (!companyId) return mcrError(req, ctx, "MCR_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    const accessError = await requireView(req, ctx, companyId);
    if (accessError) return accessError;

    const candidates = await resolveCandidates(companyId, soLineId);
    const candidate = candidates[0];
    if (!candidate) return mcrError(req, ctx, "MCR_ROW_NOT_FOUND", 404, "This Manual-costing row was not found for the selected company.");

    // SO Stroke's own stroke_master row -- same prodshade as the Actual
    // Stroke's, matched by stroke_number. Blank when the declared number was
    // never actually set up in Stroke Master (business owner's own callout,
    // 2026-09-07) -- that side's dosage then stays blank for every material
    // until someone creates that stroke revision.
    let soStrokeMaster: JsonRecord | null = null;
    const declaredStroke = textValue(candidate.soLine.declared_stroke_number);
    if (declaredStroke && candidate.prodshadeMaterialId) {
      const { data, error } = await serviceRoleClient.schema("erp_production").from("stroke_master")
        .select("id, stroke_number").eq("company_id", companyId)
        .eq("prodshade_material_id", candidate.prodshadeMaterialId).eq("stroke_number", declaredStroke)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error("MCR_SO_STROKE_LOOKUP_FAILED");
      soStrokeMaster = (data as JsonRecord) ?? null;
    }

    const actualStrokeId = candidate.actualStrokeMaster ? textValue(candidate.actualStrokeMaster.id) : "";
    const soStrokeId = soStrokeMaster ? textValue(soStrokeMaster.id) : "";
    const strokeIds = uniqueValues([soStrokeId, actualStrokeId]);
    const { data: strokeLineRows, error: lineErr } = strokeIds.length
      ? await serviceRoleClient.schema("erp_production").from("stroke_line")
        .select("stroke_master_id, material_id, dosage_pct").in("stroke_master_id", strokeIds)
      : { data: [] as JsonRecord[], error: null };
    if (lineErr) throw new Error("MCR_STROKE_LINE_LOOKUP_FAILED");
    const strokeLines = (strokeLineRows ?? []) as JsonRecord[];

    const rmIntMaterialIds = uniqueValues(strokeLines.map((row) => row.material_id));
    const rmIntMaterials = await materialMap(rmIntMaterialIds);

    // A material can appear MORE THAN ONCE in the same stroke's own RM lines
    // (primary + alternate-group entries, per StrokeMasterPage.jsx) -- their
    // dosage_pct must be SUMMED to get that material's real total dosage, not
    // just the first row found. Verified against real prod data (SO
    // 9000000222 / stroke 1): two materials each carry 3 and 2 separate rows
    // respectively, and only the summed total reconciles to 100%.
    function summedDosagePct(strokeMasterId: string, materialId: string): number | null {
      const matches = strokeLines.filter((row) => textValue(row.stroke_master_id) === strokeMasterId && textValue(row.material_id) === materialId);
      if (matches.length === 0) return null;
      return matches.reduce((sum, row) => sum + Number(row.dosage_pct ?? 0), 0);
    }

    // 599/Barrel only, per business owner's explicit scoping (2026-09-07) --
    // reuses AC07's own own-BOM/packing-history/category-fallback chain
    // unchanged so this never drifts from AC07's PM sourcing.
    const packCode = textValue(candidate.material.pack_code);
    const includePm = packCode === "599";
    let pmComposition: { lines: JsonRecord[] } = { lines: [] };
    if (includePm) {
      pmComposition = await resolvePmComposition(textValue(candidate.soLine.material_id), candidate.material);
    }
    const pmMaterialIds = uniqueValues(pmComposition.lines.map((row) => row.material_id));
    const pmMaterials = await materialMap(pmMaterialIds);

    const { data: existingRateRows, error: rateErr } = await serviceRoleClient
      .schema("erp_procurement").from("manual_costing_rate_entry")
      .select("material_id, rate").eq("sales_order_line_id", soLineId);
    if (rateErr) throw new Error("MCR_EXISTING_RATE_LOOKUP_FAILED");
    const existingRateByMaterial = new Map(((existingRateRows ?? []) as JsonRecord[]).map((row) => [textValue(row.material_id), Number(row.rate)]));

    const rmIntRows = rmIntMaterialIds.map((materialId) => {
      const material = rmIntMaterials.get(materialId);
      return {
        material_id: materialId,
        material_name: material?.material_name ?? null,
        external_code: material?.external_code ?? null,
        material_type: material?.material_type ?? null,
        so_dosage_pct: summedDosagePct(soStrokeId, materialId),
        actual_dosage_pct: summedDosagePct(actualStrokeId, materialId),
        rate: existingRateByMaterial.get(materialId) ?? null,
      };
    });
    const pmRows = pmComposition.lines.map((line) => {
      const materialId = textValue(line.material_id);
      const material = pmMaterials.get(materialId);
      return {
        material_id: materialId,
        material_name: material?.material_name ?? null,
        external_code: material?.external_code ?? null,
        qty_per_pack: Number(line.qty ?? line.qty_per_pack ?? 0),
        rate: existingRateByMaterial.get(materialId) ?? null,
      };
    });

    return okResponse({
      data: {
        so_line_id: soLineId,
        so_number: candidate.soNumber,
        item: [textValue(candidate.material.pace_code), textValue(candidate.material.material_name)].filter(Boolean).join(" — "),
        pack_code: packCode,
        include_pm: includePm,
        batch_number: textValue(candidate.dcLine.batch_number),
        packing_po_number: textValue(candidate.packingOrder?.po_number),
        so_stroke_number: declaredStroke || null,
        so_stroke_found: Boolean(soStrokeMaster),
        actual_stroke_number: textValue(candidate.actualStrokeMaster?.stroke_number) || null,
        rm_int_rows: rmIntRows,
        pm_rows: pmRows,
      },
    }, ctx.request_id, req);
  } catch (err) {
    console.error("MANUAL_COSTING_DETAIL_FAILED", err);
    const code = err instanceof Error ? err.message : "MANUAL_COSTING_DETAIL_FAILED";
    return mcrError(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : code === "MCR_ROW_NOT_FOUND" ? 404 : 500, "Unable to load Manual Costing detail.");
  }
}

// POST /api/procurement/manual-costing-rows/:so_line_id/rates
export async function saveManualCostingRatesHandler(req: Request, ctx: ManualCostingHandlerContext): Promise<Response> {
  try {
    const soLineId = getIdFromPath(req);
    if (!soLineId) return mcrError(req, ctx, "MCR_ID_REQUIRED", 400, "so_line_id is required.");
    const body = await parseBody(req);
    const companyId = textValue(body.company_id);
    if (!companyId) return mcrError(req, ctx, "MCR_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    const accessError = await requireWrite(req, ctx, companyId);
    if (accessError) return accessError;

    const entries = Array.isArray(body.entries) ? (body.entries as JsonRecord[]) : [];
    const rows = entries
      .map((entry) => ({ material_id: textValue(entry.material_id), rate: Number(entry.rate) }))
      .filter((entry) => entry.material_id && Number.isFinite(entry.rate) && entry.rate >= 0);
    if (rows.length === 0) return mcrError(req, ctx, "MCR_NO_RATES", 400, "At least one valid material rate is required.");

    // Confirm this so_line actually belongs to a MANUAL-month MTO/HPS line
    // in this company before writing anything against it.
    const candidates = await resolveCandidates(companyId, soLineId);
    if (!candidates[0]) return mcrError(req, ctx, "MCR_ROW_NOT_FOUND", 404, "This Manual-costing row was not found for the selected company.");

    const now = new Date().toISOString();
    const { error } = await serviceRoleClient.schema("erp_procurement").from("manual_costing_rate_entry")
      .upsert(
        rows.map((row) => ({
          sales_order_line_id: soLineId,
          material_id: row.material_id,
          rate: row.rate,
          created_by: ctx.auth_user_id,
          last_updated_by: ctx.auth_user_id,
          last_updated_at: now,
        })),
        { onConflict: "sales_order_line_id,material_id" },
      );
    if (error) throw new Error("MCR_SAVE_FAILED");

    return okResponse({ saved: rows.length }, ctx.request_id, req);
  } catch (err) {
    console.error("MANUAL_COSTING_SAVE_FAILED", err);
    const code = err instanceof Error ? err.message : "MANUAL_COSTING_SAVE_FAILED";
    return mcrError(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : code === "MCR_ROW_NOT_FOUND" ? 404 : 500, "Unable to save Manual Costing rates.");
  }
}
