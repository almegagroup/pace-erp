/*
 * File-ID: 27.104.9
 * File-Path: supabase/functions/api/_core/production/opening_genealogy.handlers.ts
 * Gate: 27.104.9
 * Domain: PRODUCTION / COSTING (opening-stock genealogy)
 * Purpose: PR22 Old Process PO + PR23 Old Packing PO for pre-go-live genealogy only.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { generateRecoDocNumber } from "../../_shared/materialDocument.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { errorResponse, okResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import {
  assertProdReadRole,
  parseBody,
  parseNonNegativeNumber,
  parsePositiveNumber,
  toTrimmedString,
  toUpperTrimmedString,
} from "./production.shared.ts";
import { generateGlobalDocNumber } from "./production.utils.ts";

type JsonRecord = Record<string, unknown>;

const SEGMENT_BY_PO_TYPE: Record<string, string> = { MTO: "ADMIX", HPS: "HPS" };

function genErr(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

function createdOk(data: unknown, requestId: string, req?: Request): Response {
  const result = okResponse(data, requestId, req);
  return new Response(result.body, { status: 201, headers: result.headers });
}

async function fetchMaterialTypes(materialIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(materialIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, material_type")
    .in("id", ids);
  if (error) {
    console.error("[opening_genealogy.fetchMaterialTypes] query failed:", JSON.stringify(error));
    throw new Error("PROD_OLD_PROCESS_PO_CREATE_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) {
    map.set(String(row.id), String(row.material_type ?? ""));
  }
  return map;
}

async function fetchMaterialLabels(materialIds: string[]): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(materialIds.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, pace_code, material_name, shade_code")
    .in("id", ids);
  if (error) throw new Error("PROD_OLD_PROCESS_PO_LIST_FAILED");
  for (const row of (data ?? []) as JsonRecord[]) {
    map.set(String(row.id), row);
  }
  return map;
}

async function fetchStrokeNumbers(strokeIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(strokeIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("stroke_master")
    .select("id, stroke_number")
    .in("id", ids);
  if (error) throw new Error("PROD_OLD_PROCESS_PO_LIST_FAILED");
  for (const row of (data ?? []) as JsonRecord[]) {
    map.set(String(row.id), toTrimmedString(row.stroke_number));
  }
  return map;
}

async function fetchUnrestrictedRates(
  companyId: string,
  keys: Array<{ materialId: string; slocId: string }>,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const pairs = keys.filter((key) => key.materialId && key.slocId);
  if (pairs.length === 0) return map;
  const materialIds = [...new Set(pairs.map((pair) => pair.materialId))];
  const slocIds = [...new Set(pairs.map((pair) => pair.slocId))];
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_snapshot")
    .select("material_id, storage_location_id, valuation_rate")
    .eq("company_id", companyId)
    .eq("stock_type_code", "UNRESTRICTED")
    .is("batch_id", null)
    .in("material_id", materialIds)
    .in("storage_location_id", slocIds);
  if (error) {
    console.error("[opening_genealogy.fetchUnrestrictedRates] query failed:", JSON.stringify(error));
    throw new Error("PROD_OLD_PACKING_PO_LIST_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) {
    map.set(`${String(row.material_id)}|${String(row.storage_location_id)}`, Number(row.valuation_rate ?? 0));
  }
  return map;
}

async function enrichOldPackingRows(companyId: string, rows: JsonRecord[]): Promise<JsonRecord[]> {
  if (rows.length === 0) return rows;

  const poIds = rows.map((row) => String(row.id ?? "")).filter(Boolean);
  const packCodeIds = [...new Set(rows.map((row) => toTrimmedString(row.pack_code_id)).filter(Boolean))];

  const [{ data: lineRows, error: lineErr }, { data: packCodes, error: packCodeErr }] = await Promise.all([
    serviceRoleClient
      .schema("erp_production")
      .from("packing_order_line")
      .select("packing_order_id, line_type, material_id, actual_material_id, total_qty, actual_qty, issue_sloc_id")
      .in("packing_order_id", poIds),
    packCodeIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : serviceRoleClient
        .schema("erp_production")
        .from("pack_code_master")
        .select("id, pack_code")
        .in("id", packCodeIds),
  ]);
  if (lineErr) {
    console.error("[opening_genealogy.enrichOldPackingRows] line query failed:", JSON.stringify(lineErr));
    throw new Error("PROD_OLD_PACKING_PO_LIST_FAILED");
  }
  if (packCodeErr) {
    console.error("[opening_genealogy.enrichOldPackingRows] pack code query failed:", JSON.stringify(packCodeErr));
    throw new Error("PROD_OLD_PACKING_PO_LIST_FAILED");
  }

  const linesByPoId = new Map<string, JsonRecord[]>();
  for (const row of (lineRows ?? []) as JsonRecord[]) {
    const poId = String(row.packing_order_id ?? "");
    if (!poId) continue;
    const current = linesByPoId.get(poId) ?? [];
    current.push(row);
    linesByPoId.set(poId, current);
  }

  const packCodeById = new Map<string, string>();
  for (const row of (packCodes ?? []) as JsonRecord[]) {
    packCodeById.set(String(row.id ?? ""), toTrimmedString(row.pack_code));
  }

  const inputRateKeys = rows.flatMap((row) => {
    const poLines = linesByPoId.get(String(row.id ?? "")) ?? [];
    return poLines
      .filter((line) => String(line.line_type ?? "") !== "FG" && Number(line.actual_qty ?? line.total_qty ?? 0) > 0)
      .map((line) => ({
        materialId: toTrimmedString(line.actual_material_id) || String(line.material_id ?? ""),
        slocId: toTrimmedString(line.issue_sloc_id),
      }))
      .filter((key) => key.materialId && key.slocId);
  });
  const rateMap = await fetchUnrestrictedRates(companyId, inputRateKeys);

  return rows.map((row) => {
    const poId = String(row.id ?? "");
    const poLines = linesByPoId.get(poId) ?? [];
    const fgQty = Number(row.actual_qty_kg ?? 0);
    const packCode = packCodeById.get(toTrimmedString(row.pack_code_id)) ?? "";

    let totalInputValue = 0;
    let incomplete = false;
    for (const line of poLines) {
      if (String(line.line_type ?? "") === "FG") continue;
      const qty = Number(line.actual_qty ?? line.total_qty ?? 0);
      const materialId = toTrimmedString(line.actual_material_id) || String(line.material_id ?? "");
      const slocId = toTrimmedString(line.issue_sloc_id);
      if (!qty || !materialId || !slocId) continue;
      const lineRate = rateMap.get(`${materialId}|${slocId}`) ?? 0;
      if (lineRate <= 0) incomplete = true;
      totalInputValue += qty * lineRate;
    }

    const derivedRatePerKg = fgQty > 0 ? totalInputValue / fgQty : 0;
    const usePackRate = packCode !== "000" && Number(row.fill_qty_per_pack ?? 0) > 0;
    const derivedRateEntryValue = usePackRate
      ? derivedRatePerKg * Number(row.fill_qty_per_pack ?? 0)
      : derivedRatePerKg;

    return {
      ...row,
      pack_code: packCode || null,
      derived_rate_per_kg: derivedRatePerKg,
      derived_rate_entry_value: derivedRateEntryValue,
      derived_rate_entry_mode: usePackRate ? "PACK" : "KG",
      derived_rate_incomplete: incomplete,
    };
  });
}

export async function createOldProcessPoHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const poType = toUpperTrimmedString(body.po_type);
    const materialId = toTrimmedString(body.material_id || body.prodshade_material_id);
    const batchNumber = toTrimmedString(body.batch_number);
    const strokeId = toTrimmedString(body.stroke_master_id) || null;
    const machineId = toTrimmedString(body.machine_id) || null;
    const actualQty = parsePositiveNumber(body.actual_qty ?? body.actual_output_qty);
    const lines = Array.isArray(body.lines) ? body.lines as JsonRecord[] : [];

    if (!companyId || !materialId || !batchNumber || !actualQty) {
      return genErr(req, ctx, "PROD_OLD_PROCESS_PO_INVALID", 400, "company_id, material_id, batch_number, actual_qty required");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return genErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (poType !== "MTO" && poType !== "HPS") {
      return genErr(req, ctx, "PROD_OLD_PROCESS_PO_TYPE_INVALID", 400, "Old Process PO is MTO/HPS only (§104.9)");
    }
    if (lines.length === 0) {
      return genErr(req, ctx, "PROD_OLD_PROCESS_PO_NO_LINES", 400, "At least one RM/INT line is required");
    }
    // A line's actual_qty being exactly 0 is a valid, meaningful genealogy
    // entry (e.g. this RM/INT was part of the formulation but zero actually
    // used in this old batch) -- it must not be rejected the same way a
    // truly missing value would be. parsePositiveNumber rejects 0 (returns
    // null), so used with `!actualQty` it made 0 indistinguishable from
    // "not provided". Switched to parseNonNegativeNumber (0 allowed) and an
    // explicit `=== null` check (0 is falsy in JS, so `!actualQty` alone
    // would still have rejected a real 0 even with the non-negative parser).
    const hasInvalidLine = lines.some((line) => {
      const materialId = toTrimmedString(line.material_id);
      const actualQty = parseNonNegativeNumber(line.actual_qty);
      const issueSlocId = toTrimmedString(line.issue_sloc_id);
      return !materialId || actualQty === null || !issueSlocId;
    });
    if (hasInvalidLine) {
      return genErr(req, ctx, "PROD_OLD_PROCESS_PO_LINE_INVALID", 400, "Every PR22 line needs material, actual qty (0 or more), and storage location");
    }

    const { data: dup } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .select("id")
      .eq("company_id", companyId)
      .eq("batch_number", batchNumber)
      .maybeSingle();
    if (dup) {
      return genErr(req, ctx, "PROD_OLD_PROCESS_PO_BATCH_EXISTS", 409, `A Process PO already exists for batch ${batchNumber}`);
    }

    const segmentCode = toUpperTrimmedString(body.segment_code) || SEGMENT_BY_PO_TYPE[poType] || null;
    const strokeNumber = await (async () => {
      if (!strokeId) return null;
      const { data } = await serviceRoleClient
        .schema("erp_production")
        .from("stroke_master")
        .select("stroke_number")
        .eq("id", strokeId)
        .maybeSingle();
      return (data as JsonRecord | null)?.stroke_number ?? null;
    })();

    const poNumber = await generateGlobalDocNumber("PROC_PO");
    const now = new Date().toISOString();

    const { data: insertedPo, error: poInsErr } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .insert({
        company_id: companyId,
        po_number: poNumber,
        po_type: poType,
        segment_code: segmentCode,
        material_id: materialId,
        stroke_master_id: strokeId,
        machine_id: machineId,
        planned_qty: actualQty,
        actual_qty: actualQty,
        batch_number: batchNumber,
        status: "VERIFIED",
        notes: "Opening genealogy (PR22) - no stock movement",
        created_by: ctx.auth_user_id,
        created_at: now,
        verified_by: ctx.auth_user_id,
        verified_at: now,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .select("id")
      .single();
    if (poInsErr) {
      console.error("[opening_genealogy.createOldProcessPo] PO insert failed:", JSON.stringify(poInsErr));
      throw new Error("PROD_OLD_PROCESS_PO_CREATE_FAILED");
    }
    const poId = String((insertedPo as JsonRecord).id);

    const lineRows = lines.map((line, index) => {
      const lineActual = Number(parsePositiveNumber(line.actual_qty) ?? 0);
      return {
        process_order_id: poId,
        material_id: toTrimmedString(line.material_id),
        actual_material_id: toTrimmedString(line.actual_material_id) || null,
        planned_qty: Number(parsePositiveNumber(line.standard_qty ?? line.planned_qty) ?? lineActual),
        actual_qty: lineActual,
        issue_sloc_id: toTrimmedString(line.issue_sloc_id) || null,
        display_order: Number(line.display_order ?? index + 1),
        is_rm: String(line.line_material_type ?? "RM") !== "INT",
        uom_code: toTrimmedString(line.uom_code) || "KG",
        stock_ledger_id: null,
        dosage_pct: line.dosage_pct != null ? Number(line.dosage_pct) : null,
        is_formulation_line: line.is_formulation_line !== false,
        approved_status: toUpperTrimmedString(line.approved_status) || "YES",
        ap_approved_qty: Number(parsePositiveNumber(line.ap_approved_qty) ?? lineActual),
        variance_qty: Number(line.variance_qty ?? 0),
      };
    });
    const { data: insertedLines, error: lineInsErr } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order_line")
      .insert(lineRows)
      .select("id, material_id, actual_material_id, issue_sloc_id, planned_qty, actual_qty, dosage_pct, approved_status, ap_approved_qty, variance_qty, is_formulation_line, is_rm");
    if (lineInsErr) {
      console.error("[opening_genealogy.createOldProcessPo] line insert failed:", JSON.stringify(lineInsErr));
      throw new Error("PROD_OLD_PROCESS_PO_CREATE_FAILED");
    }

    const recoDoc = await generateRecoDocNumber(companyId);
    const materialTypeMap = await fetchMaterialTypes(((insertedLines ?? []) as JsonRecord[]).map((line) => String(line.material_id)));
    const recoRows = ((insertedLines ?? []) as JsonRecord[]).map((line) => ({
      company_id: companyId,
      po_number: poNumber,
      batch_number: batchNumber,
      po_type: poType,
      prodshade_material_id: materialId,
      stroke_number: strokeNumber,
      machine_id: machineId,
      segment_code: segmentCode,
      batch_started_at: null,
      verified_at: now,
      process_order_id: poId,
      process_order_line_id: line.id,
      material_id: line.material_id,
      line_material_type: materialTypeMap.get(String(line.material_id)) === "INT" ? "INT" : "RM",
      dosage_pct: line.dosage_pct ?? null,
      actual_material_id: line.actual_material_id ?? null,
      storage_location_id: line.issue_sloc_id ?? null,
      standard_qty: line.planned_qty ?? null,
      actual_qty: Number(line.actual_qty ?? 0),
      approved_status: line.approved_status ?? "YES",
      ap_approved_qty: Number(line.ap_approved_qty ?? line.actual_qty ?? 0),
      variance_qty: Number(line.variance_qty ?? 0),
      is_formulation_line: line.is_formulation_line !== false,
      is_voided: false,
      reco_document_number: recoDoc.docNumber,
      reco_document_year: recoDoc.docYear,
      source_txn_type: "OPENING",
      reference_document_number: poNumber,
      reference_document_type: "PROC_PO",
      last_updated_at: now,
      last_updated_by: ctx.auth_user_id,
    }));
    if (recoRows.length > 0) {
      const { error: recoErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order_line_reco")
        .insert(recoRows);
      if (recoErr) {
        console.error("[opening_genealogy.createOldProcessPo] reco insert failed:", JSON.stringify(recoErr));
        throw new Error("PROD_OLD_PROCESS_PO_CREATE_FAILED");
      }
    }

    return createdOk({ id: poId, po_number: poNumber, batch_number: batchNumber, status: "VERIFIED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_OLD_PROCESS_PO_CREATE_FAILED";
    const status = code.endsWith("_INVALID") || code.endsWith("_NO_LINES")
      ? 400
      : code.endsWith("_EXISTS")
      ? 409
      : 500;
    return genErr(req, ctx, code, status, "Old Process PO create failed");
  }
}

export async function listOldProcessPoBatchesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const materialId = toTrimmedString(url.searchParams.get("material_id") ?? "");
    if (!companyId) return okResponse({ data: [] }, ctx.request_id, req);
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return genErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const { data: recoPoIds, error: recoErr } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order_line_reco")
      .select("process_order_id")
      .eq("company_id", companyId)
      .eq("source_txn_type", "OPENING");
    if (recoErr) throw new Error("PROD_OLD_PROCESS_PO_LIST_FAILED");

    const poIds = [...new Set(((recoPoIds ?? []) as JsonRecord[]).map((row) => String(row.process_order_id)).filter(Boolean))];
    if (poIds.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    const { data: pos, error: poErr } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .select("id, po_number, po_type, batch_number, material_id, actual_qty, stroke_master_id")
      .in("id", poIds)
      .order("created_at", { ascending: false });
    if (poErr) throw new Error("PROD_OLD_PROCESS_PO_LIST_FAILED");

    const rows = ((pos ?? []) as JsonRecord[]).filter((row) => !materialId || toTrimmedString(row.material_id) === materialId);
    const matMap = await fetchMaterialLabels(rows.map((row) => String(row.material_id)));
    const strokeMap = await fetchStrokeNumbers(rows.map((row) => toTrimmedString(row.stroke_master_id)));

    return okResponse({
      data: rows.map((row) => ({
        ...row,
        prodshade: matMap.get(String(row.material_id)) ?? null,
        stroke_number: strokeMap.get(toTrimmedString(row.stroke_master_id)) ?? null,
      })),
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_OLD_PROCESS_PO_LIST_FAILED";
    return genErr(req, ctx, code, 500, "Old Process PO batch list failed");
  }
}

export async function createOldPackingPoHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const poType = toUpperTrimmedString(body.po_type);
    const processOrderId = toTrimmedString(body.process_order_id);
    const skuMaterialId = toTrimmedString(body.material_id || body.sku_material_id);
    const packCodeId = toTrimmedString(body.pack_code_id) || null;
    const numPacks = parsePositiveNumber(body.num_packs);
    const fillQtyPerPack = parsePositiveNumber(body.fill_qty_per_pack);
    const actualQtyKg = parsePositiveNumber(body.actual_qty_kg);
    const fgSlocId = toTrimmedString(body.fg_sloc_id) || null;
    const sfgMaterialId = toTrimmedString(body.sfg_material_id) || null;
    const sfgSlocId = toTrimmedString(body.sfg_sloc_id) || null;
    const pmLines = Array.isArray(body.lines) ? body.lines as JsonRecord[] : [];

    if (!companyId || !processOrderId || !skuMaterialId || !actualQtyKg) {
      return genErr(req, ctx, "PROD_OLD_PACKING_PO_INVALID", 400, "company_id, process_order_id, material_id, actual_qty_kg required");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return genErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!fgSlocId) {
      return genErr(req, ctx, "PROD_OLD_PACKING_PO_FG_SLOC_REQUIRED", 400, "FG storage location required");
    }
    if (sfgMaterialId && !sfgSlocId) {
      return genErr(req, ctx, "PROD_OLD_PACKING_PO_SFG_SLOC_REQUIRED", 400, "SFG storage location required");
    }
    const hasInvalidPmLine = pmLines.some((line) => {
      const qty = parsePositiveNumber(line.actual_qty ?? line.total_qty);
      if (!qty) return false;
      const materialId = toTrimmedString(line.material_id);
      const issueSlocId = toTrimmedString(line.issue_sloc_id);
      return !materialId || !issueSlocId;
    });
    if (hasInvalidPmLine) {
      return genErr(req, ctx, "PROD_OLD_PACKING_PO_PM_LINE_INVALID", 400, "Every PM line with quantity needs material and storage location");
    }

    const { data: parentPo, error: parentErr } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .select("id, company_id, batch_number, po_type, material_id, segment_code")
      .eq("id", processOrderId)
      .maybeSingle();
    if (parentErr) throw new Error("PROD_OLD_PACKING_PO_CREATE_FAILED");
    const parent = parentPo as JsonRecord | null;
    if (!parent || String(parent.company_id) !== companyId) {
      return genErr(req, ctx, "PROD_OLD_PACKING_PO_PARENT_NOT_FOUND", 404, "Parent Old Process PO not found for this company");
    }

    const { count: openingCount, error: openCountErr } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order_line_reco")
      .select("id", { count: "exact", head: true })
      .eq("process_order_id", processOrderId)
      .eq("source_txn_type", "OPENING") as { count?: number; error?: unknown };
    if (openCountErr) throw new Error("PROD_OLD_PACKING_PO_CREATE_FAILED");
    if ((openingCount ?? 0) === 0) {
      return genErr(req, ctx, "PROD_OLD_PACKING_PO_PARENT_NOT_OPENING", 422, "Parent Process PO is not an opening-genealogy order");
    }

    const batchNumber = toTrimmedString(parent.batch_number);
    const segmentCode = toUpperTrimmedString(parent.segment_code as string) || null;
    const poNumber = await generateGlobalDocNumber("PACK_PO");
    const now = new Date().toISOString();

    const { data: insertedPo, error: poInsErr } = await serviceRoleClient
      .schema("erp_production")
      .from("packing_order")
      .insert({
        company_id: companyId,
        po_number: poNumber,
        po_type: poType || null,
        source_po_type: toUpperTrimmedString(parent.po_type),
        process_order_id: processOrderId,
        material_id: skuMaterialId,
        pack_code_id: packCodeId,
        fill_qty_per_pack: fillQtyPerPack ?? null,
        num_packs: numPacks ?? null,
        planned_qty_kg: actualQtyKg,
        actual_qty_kg: actualQtyKg,
        total_qty_kg: actualQtyKg,
        status: "FINAL",
        segment_code: segmentCode,
        batch_number: batchNumber,
        created_by: ctx.auth_user_id,
        created_at: now,
        finalized_by: ctx.auth_user_id,
        finalized_at: now,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .select("id")
      .single();
    if (poInsErr) {
      console.error("[opening_genealogy.createOldPackingPo] PO insert failed:", JSON.stringify(poInsErr));
      throw new Error("PROD_OLD_PACKING_PO_CREATE_FAILED");
    }
    const poId = String((insertedPo as JsonRecord).id);

    const lineRows: JsonRecord[] = [{
      packing_order_id: poId,
      line_type: "FG",
      material_id: skuMaterialId,
      batch_number: batchNumber,
      qty_per_pack: fillQtyPerPack ?? null,
      total_qty: actualQtyKg,
      actual_qty: actualQtyKg,
      issue_sloc_id: fgSlocId,
      display_order: 1,
      stock_ledger_id: null,
      uom_code: "KG",
      movement_type_code: "P101",
    }];
    if (sfgMaterialId) {
      lineRows.push({
        packing_order_id: poId,
        line_type: "SFG",
        material_id: sfgMaterialId,
        batch_number: batchNumber,
        qty_per_pack: null,
        total_qty: actualQtyKg,
        actual_qty: actualQtyKg,
        issue_sloc_id: sfgSlocId,
        display_order: 2,
        stock_ledger_id: null,
        uom_code: "KG",
        movement_type_code: "P261",
      });
    }
    pmLines.forEach((line, index) => {
      const qty = Number(parsePositiveNumber(line.actual_qty ?? line.total_qty) ?? 0);
      lineRows.push({
        packing_order_id: poId,
        line_type: "PM",
        material_id: toTrimmedString(line.material_id),
        actual_material_id: toTrimmedString(line.actual_material_id) || null,
        batch_number: null,
        qty_per_pack: line.qty_per_pack != null ? Number(line.qty_per_pack) : null,
        total_qty: qty,
        actual_qty: qty,
        issue_sloc_id: toTrimmedString(line.issue_sloc_id) || null,
        display_order: 3 + index,
        stock_ledger_id: null,
        uom_code: toTrimmedString(line.uom_code) || "EA",
        movement_type_code: "P261",
        approved_status: "YES",
        ap_approved_qty: qty,
        variance_qty: 0,
      });
    });

    const { data: insertedLines, error: lineInsErr } = await serviceRoleClient
      .schema("erp_production")
      .from("packing_order_line")
      .insert(lineRows)
      .select("id, line_type, material_id, total_qty, actual_qty, approved_status, ap_approved_qty, variance_qty");
    if (lineInsErr) {
      console.error("[opening_genealogy.createOldPackingPo] line insert failed:", JSON.stringify(lineInsErr));
      throw new Error("PROD_OLD_PACKING_PO_CREATE_FAILED");
    }

    const pmInsertedLines = ((insertedLines ?? []) as JsonRecord[]).filter((line) => line.line_type === "PM");
    if (pmInsertedLines.length > 0) {
      const recoDoc = await generateRecoDocNumber(companyId);
      const pmRecoRows = pmInsertedLines.map((line) => ({
        company_id: companyId,
        po_number: poNumber,
        sku_material_id: skuMaterialId,
        batch_number: batchNumber,
        po_type: poType || null,
        finalized_at: now,
        packing_order_id: poId,
        packing_order_line_id: line.id,
        material_id: line.material_id,
        formulation_material_id: line.material_id,
        standard_qty: line.total_qty,
        actual_qty: line.actual_qty,
        approved_status: line.approved_status,
        ap_approved_qty: line.ap_approved_qty,
        variance_qty: line.variance_qty,
        is_voided: false,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
        reco_document_number: recoDoc.docNumber,
        reco_document_year: recoDoc.docYear,
        source_txn_type: "OPENING",
        reference_document_number: poNumber,
        reference_document_type: "PACK_PO",
      }));
      const { error: recoErr } = await serviceRoleClient
        .schema("erp_production")
        .from("packing_order_line_reco")
        .insert(pmRecoRows);
      if (recoErr) {
        console.error("[opening_genealogy.createOldPackingPo] reco insert failed:", JSON.stringify(recoErr));
        throw new Error("PROD_OLD_PACKING_PO_CREATE_FAILED");
      }
    }

    return createdOk({ id: poId, po_number: poNumber, batch_number: batchNumber, status: "FINAL" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_OLD_PACKING_PO_CREATE_FAILED";
    const status = code.endsWith("_INVALID") || code.endsWith("_REQUIRED")
      ? 400
      : code.endsWith("_NOT_FOUND")
      ? 404
      : code.endsWith("_EXISTS")
      ? 409
      : code.endsWith("_NOT_OPENING")
      ? 422
      : 500;
    return genErr(req, ctx, code, status, "Old Packing PO create failed");
  }
}

export async function listOldPackingPoBatchesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const materialId = toTrimmedString(url.searchParams.get("material_id") ?? "");
    if (!companyId) return okResponse({ data: [] }, ctx.request_id, req);
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return genErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const { data: openingProcessPoIds, error: recoErr } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order_line_reco")
      .select("process_order_id")
      .eq("company_id", companyId)
      .eq("source_txn_type", "OPENING");
    if (recoErr) throw new Error("PROD_OLD_PACKING_PO_LIST_FAILED");

    const processOrderIds = [...new Set(((openingProcessPoIds ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.process_order_id)).filter(Boolean))];
    if (processOrderIds.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    let query = serviceRoleClient
      .schema("erp_production")
      .from("packing_order")
      .select("id, po_number, po_type, source_po_type, batch_number, material_id, pack_code_id, actual_qty_kg, fill_qty_per_pack, num_packs")
      .in("process_order_id", processOrderIds)
      .eq("status", "FINAL")
      .order("created_at", { ascending: false });
    if (materialId) {
      query = query.eq("material_id", materialId);
    }

    const { data: pos, error: poErr } = await query;
    if (poErr) throw new Error("PROD_OLD_PACKING_PO_LIST_FAILED");
    const rows = (pos ?? []) as JsonRecord[];
    const matMap = await fetchMaterialLabels(rows.map((row) => toTrimmedString(row.material_id)));
    const enrichedRows = await enrichOldPackingRows(companyId, rows);

    return okResponse({
      data: enrichedRows.map((row) => ({
        ...row,
        sku: matMap.get(toTrimmedString(row.material_id)) ?? null,
      })),
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_OLD_PACKING_PO_LIST_FAILED";
    return genErr(req, ctx, code, 500, "Old Packing PO batch list failed");
  }
}
