/*
 * File-ID: 27.104.9
 * File-Path: supabase/functions/api/_core/production/opening_genealogy.handlers.ts
 * Gate: 27.104.9
 * Domain: PRODUCTION / COSTING (opening-stock genealogy)
 * Purpose: PR22 "Old Process PO" + PR23 "Old Packing PO" (§104.9). At go-live, pre-existing
 *          MTO/HPS SFG (S003) and FG (F003) batches have real stock (posted by IN05 Opening Stock,
 *          P561 with batch_number + rate) but no genealogy — so PR19 / Reco / Return can't work on
 *          them. These pages attach synthetic, VERIFIED/FINAL "Old" orders shaped exactly like
 *          produced ones so every downstream consumer works unchanged.
 *
 *          ⛔ CRITICAL GUARD (§104.9): the synthetic PO's RM/PM/SFG lines must NEVER call
 *          post_stock_movement() — they are genealogy + costing records only (stock_ledger_id stays
 *          NULL). The RM was consumed OUTSIDE this system; it must not move our stock. Only the
 *          SFG/FG's own P561 opening posting (IN05) is a real stock event.
 *
 *          Reconciliation guard (§104.9.1): save is blocked unless the batch_number already exists
 *          as a posted opening P561 line for that company — a typo would silently orphan the batch.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import { generateRecoDocNumber } from "../../_shared/materialDocument.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import {
  assertProdReadRole,
  parseBody,
  toTrimmedString,
  toUpperTrimmedString,
  parsePositiveNumber,
} from "./production.shared.ts";
import { generateGlobalDocNumber } from "./production.utils.ts";

type JsonRecord = Record<string, unknown>;

const QTY_TOL = 0.01; // reconciliation tolerance (KG)
// po_type → segment_code (MTO=Admix, HPS=Hypershot). §104.9 is MTO/HPS only.
const SEGMENT_BY_PO_TYPE: Record<string, string> = { MTO: "ADMIX", HPS: "HPS" };

function genErr(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}
function createdOk(data: unknown, requestId: string, req?: Request): Response {
  const r = okResponse(data, requestId, req);
  return new Response(r.body, { status: 201, headers: r.headers });
}

// Sum of posted opening (P561 IN) quantity for a (company, material, batch) — the physical
// balance IN05 loaded. Returns 0 when nothing was posted for that key.
async function sumOpeningQty(companyId: string, materialId: string, batchNumber: string): Promise<number> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory").from("stock_ledger")
    .select("quantity")
    .eq("company_id", companyId)
    .eq("material_id", materialId)
    .eq("batch_number", batchNumber)
    .eq("movement_type_code", "P561")
    .eq("direction", "IN");
  if (error) {
    console.error("[opening_genealogy.sumOpeningQty] query failed:", JSON.stringify(error));
    throw new Error("PROD_OLD_OPENING_LOOKUP_FAILED");
  }
  return ((data ?? []) as JsonRecord[]).reduce((s, r) => s + Number(r.quantity ?? 0), 0);
}

// §83.14 "balance barrel": one SFG/FG opening batch can legitimately split across several
// Packing POs at different fill sizes (e.g. 23 barrels @230kg + 1 @200kg from the same batch),
// exactly like live production already allows. Sums actual_qty_kg from every NON-REVERSED
// synthetic Packing PO already created for this (company, SKU, batch) — the running total
// already allocated, so a new PR23 entry only needs to fit in what's left.
async function sumAllocatedPackingQty(companyId: string, skuMaterialId: string, batchNumber: string): Promise<number> {
  const { data, error } = await serviceRoleClient
    .schema("erp_production").from("packing_order")
    .select("actual_qty_kg")
    .eq("company_id", companyId)
    .eq("material_id", skuMaterialId)
    .eq("batch_number", batchNumber)
    .neq("status", "REVERSED");
  if (error) {
    console.error("[opening_genealogy.sumAllocatedPackingQty] query failed:", JSON.stringify(error));
    throw new Error("PROD_OLD_OPENING_LOOKUP_FAILED");
  }
  return ((data ?? []) as JsonRecord[]).reduce((s, r) => s + Number(r.actual_qty_kg ?? 0), 0);
}

// Does ANY posted opening (P561 IN) line exist for this (company, batch)? Anti-typo guard.
async function openingBatchExists(companyId: string, batchNumber: string): Promise<boolean> {
  const { count, error } = await serviceRoleClient
    .schema("erp_inventory").from("stock_ledger")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("batch_number", batchNumber)
    .eq("movement_type_code", "P561")
    .eq("direction", "IN") as { count?: number; error?: unknown };
  if (error) {
    console.error("[opening_genealogy.openingBatchExists] query failed:", JSON.stringify(error));
    throw new Error("PROD_OLD_OPENING_LOOKUP_FAILED");
  }
  return (count ?? 0) > 0;
}

// POST /api/production/old-process-po  (PR22)
// Creates a synthetic VERIFIED Process PO + RM/INT lines + OPENING reco rows for an opening
// MTO/HPS SFG batch (or the parent batch of an opening FG). NO stock movement.
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
    if (poType !== "MTO" && poType !== "HPS") {
      return genErr(req, ctx, "PROD_OLD_PROCESS_PO_TYPE_INVALID", 400, "Old Process PO is MTO/HPS only (§104.9)");
    }
    if (lines.length === 0) {
      return genErr(req, ctx, "PROD_OLD_PROCESS_PO_NO_LINES", 400, "At least one RM/INT line is required");
    }

    // Duplicate genealogy guard — one synthetic PO per (company, batch).
    const { data: dup } = await serviceRoleClient
      .schema("erp_production").from("process_order")
      .select("id").eq("company_id", companyId).eq("batch_number", batchNumber).maybeSingle();
    if (dup) {
      return genErr(req, ctx, "PROD_OLD_PROCESS_PO_BATCH_EXISTS", 409, `A Process PO already exists for batch ${batchNumber}`);
    }

    // §104.9.1 reconciliation guard: the batch must exist in Opening Stock (anti-typo), and where
    // an opening SFG line exists for this prodshade the qty must reconcile. For an FG-parent batch
    // no SFG opening exists (SFG was already packed pre-go-live) — batch existence alone suffices;
    // PR23 reconciles the FG qty.
    if (!(await openingBatchExists(companyId, batchNumber))) {
      return genErr(req, ctx, "PROD_OLD_OPENING_BATCH_NOT_FOUND", 422,
        `Batch ${batchNumber} has no posted Opening Stock (IN05) for this company. Load opening stock first.`);
    }
    const openingSfgQty = await sumOpeningQty(companyId, materialId, batchNumber);
    if (openingSfgQty > 0 && Math.abs(openingSfgQty - actualQty) > QTY_TOL) {
      return genErr(req, ctx, "PROD_OLD_OPENING_QTY_MISMATCH", 422,
        `Actual Output (${actualQty}) does not match the opening SFG stock for batch ${batchNumber} (${openingSfgQty}).`);
    }

    const segmentCode = toUpperTrimmedString(body.segment_code) || SEGMENT_BY_PO_TYPE[poType] || null;
    const strokeNumber = await (async () => {
      if (!strokeId) return null;
      const { data } = await serviceRoleClient.schema("erp_production").from("stroke_master")
        .select("stroke_number").eq("id", strokeId).maybeSingle();
      return (data as JsonRecord | null)?.stroke_number ?? null;
    })();

    const poNumber = await generateGlobalDocNumber("PROC_PO");
    const now = new Date().toISOString();

    const { data: insertedPo, error: poInsErr } = await serviceRoleClient
      .schema("erp_production").from("process_order")
      .insert({
        company_id: companyId, po_number: poNumber, po_type: poType, segment_code: segmentCode,
        material_id: materialId, stroke_master_id: strokeId, machine_id: machineId,
        planned_qty: actualQty, actual_qty: actualQty,
        batch_number: batchNumber, status: "VERIFIED",
        notes: "Opening genealogy (PR22) — no stock movement", // §104.9 paper order
        created_by: ctx.auth_user_id, created_at: now,
        verified_by: ctx.auth_user_id, verified_at: now,
        last_updated_at: now, last_updated_by: ctx.auth_user_id,
      })
      .select("id").single();
    if (poInsErr) {
      console.error("[opening_genealogy.createOldProcessPo] PO insert failed:", JSON.stringify(poInsErr));
      throw new Error("PROD_OLD_PROCESS_PO_CREATE_FAILED");
    }
    const poId = String((insertedPo as JsonRecord).id);

    // RM/INT lines — genealogy only, stock_ledger_id stays NULL (⛔ no movement).
    const lineRows = lines.map((ln, idx) => {
      const lineActual = Number(parsePositiveNumber(ln.actual_qty) ?? 0);
      return {
        process_order_id: poId,
        material_id: toTrimmedString(ln.material_id),
        actual_material_id: toTrimmedString(ln.actual_material_id) || null,
        planned_qty: Number(parsePositiveNumber(ln.standard_qty ?? ln.planned_qty) ?? lineActual),
        actual_qty: lineActual,
        issue_sloc_id: toTrimmedString(ln.issue_sloc_id) || null,
        display_order: Number(ln.display_order ?? idx + 1),
        is_rm: String(ln.line_material_type ?? "RM") !== "INT",
        uom_code: toTrimmedString(ln.uom_code) || "KG",
        stock_ledger_id: null,
        dosage_pct: ln.dosage_pct != null ? Number(ln.dosage_pct) : null,
        is_formulation_line: ln.is_formulation_line !== false,
        approved_status: toUpperTrimmedString(ln.approved_status) || "YES",
        ap_approved_qty: Number(parsePositiveNumber(ln.ap_approved_qty) ?? lineActual),
        variance_qty: Number(ln.variance_qty ?? 0),
      };
    });
    const { data: insertedLines, error: lineInsErr } = await serviceRoleClient
      .schema("erp_production").from("process_order_line")
      .insert(lineRows).select("id, material_id, actual_material_id, issue_sloc_id, planned_qty, actual_qty, dosage_pct, approved_status, ap_approved_qty, variance_qty, is_formulation_line, is_rm");
    if (lineInsErr) {
      console.error("[opening_genealogy.createOldProcessPo] line insert failed:", JSON.stringify(lineInsErr));
      throw new Error("PROD_OLD_PROCESS_PO_CREATE_FAILED");
    }

    // OPENING reco rows — mirror the Verify shape exactly (§104.9), tagged source_txn_type='OPENING'.
    const recoDoc = await generateRecoDocNumber(companyId);
    const materialTypeMap = await fetchMaterialTypes(((insertedLines ?? []) as JsonRecord[]).map((l) => String(l.material_id)));
    const recoRows = ((insertedLines ?? []) as JsonRecord[]).map((line) => ({
      company_id: companyId, po_number: poNumber, batch_number: batchNumber, po_type: poType,
      prodshade_material_id: materialId, stroke_number: strokeNumber, machine_id: machineId,
      segment_code: segmentCode, batch_started_at: null, verified_at: now,
      process_order_id: poId, process_order_line_id: line.id, material_id: line.material_id,
      line_material_type: materialTypeMap.get(String(line.material_id)) === "INT" ? "INT" : "RM",
      dosage_pct: line.dosage_pct ?? null, actual_material_id: line.actual_material_id ?? null,
      storage_location_id: line.issue_sloc_id ?? null,
      standard_qty: line.planned_qty ?? null, actual_qty: Number(line.actual_qty ?? 0),
      approved_status: line.approved_status ?? "YES",
      ap_approved_qty: Number(line.ap_approved_qty ?? line.actual_qty ?? 0),
      variance_qty: Number(line.variance_qty ?? 0),
      is_formulation_line: line.is_formulation_line !== false, is_voided: false,
      reco_document_number: recoDoc.docNumber, reco_document_year: recoDoc.docYear,
      source_txn_type: "OPENING",
      reference_document_number: poNumber, reference_document_type: "PROC_PO",
      last_updated_at: now, last_updated_by: ctx.auth_user_id,
    }));
    if (recoRows.length > 0) {
      const { error: recoErr } = await serviceRoleClient
        .schema("erp_production").from("process_order_line_reco").insert(recoRows);
      if (recoErr) {
        console.error("[opening_genealogy.createOldProcessPo] reco insert failed:", JSON.stringify(recoErr));
        throw new Error("PROD_OLD_PROCESS_PO_CREATE_FAILED");
      }
    }

    return createdOk({ id: poId, po_number: poNumber, batch_number: batchNumber, status: "VERIFIED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_OLD_PROCESS_PO_CREATE_FAILED";
    const status = code.endsWith("_INVALID") || code.endsWith("_NO_LINES") ? 400
      : code.endsWith("_EXISTS") ? 409
      : code.includes("OPENING") || code.endsWith("_MISMATCH") ? 422 : 500;
    return genErr(req, ctx, code, status, "Old Process PO create failed");
  }
}

async function fetchMaterialTypes(materialIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(materialIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master").from("material_master")
    .select("id, material_type").in("id", ids);
  if (error) {
    console.error("[opening_genealogy.fetchMaterialTypes] query failed:", JSON.stringify(error));
    throw new Error("PROD_OLD_PROCESS_PO_CREATE_FAILED");
  }
  for (const r of (data ?? []) as JsonRecord[]) map.set(String(r.id), String(r.material_type ?? ""));
  return map;
}

// GET /api/production/old-process-po/batches?company_id=  (PR23 parent dropdown)
// Lists opening-origin Process POs (those with OPENING reco rows) for the company.
export async function listOldProcessPoBatchesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    if (!companyId) return okResponse({ data: [] }, ctx.request_id, req);

    const { data: recoPoIds, error: recoErr } = await serviceRoleClient
      .schema("erp_production").from("process_order_line_reco")
      .select("process_order_id").eq("company_id", companyId).eq("source_txn_type", "OPENING");
    if (recoErr) throw new Error("PROD_OLD_PROCESS_PO_LIST_FAILED");
    const poIds = [...new Set(((recoPoIds ?? []) as JsonRecord[]).map((r) => String(r.process_order_id)).filter(Boolean))];
    if (poIds.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    const { data: pos, error: poErr } = await serviceRoleClient
      .schema("erp_production").from("process_order")
      .select("id, po_number, po_type, batch_number, material_id, actual_qty")
      .in("id", poIds).order("created_at", { ascending: false });
    if (poErr) throw new Error("PROD_OLD_PROCESS_PO_LIST_FAILED");
    const rows = (pos ?? []) as JsonRecord[];

    const matMap = await fetchMaterialLabels(rows.map((r) => String(r.material_id)));
    return okResponse({
      data: rows.map((r) => ({
        ...r,
        prodshade: matMap.get(String(r.material_id)) ?? null,
      })),
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_OLD_PROCESS_PO_LIST_FAILED";
    return genErr(req, ctx, code, 500, "Old Process PO batch list failed");
  }
}

async function fetchMaterialLabels(materialIds: string[]): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(materialIds.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master").from("material_master")
    .select("id, pace_code, material_name, shade_code").in("id", ids);
  if (error) throw new Error("PROD_OLD_PROCESS_PO_LIST_FAILED");
  for (const r of (data ?? []) as JsonRecord[]) map.set(String(r.id), r);
  return map;
}

// POST /api/production/old-packing-po  (PR23)
// Creates a synthetic FINAL Packing PO + FG/SFG/PM lines for an opening FG batch, linked to its
// parent Old Process PO (PR22). NO stock movement — the real FG balance came from IN05's P561.
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
    if (!fgSlocId) {
      return genErr(req, ctx, "PROD_OLD_PACKING_PO_FG_SLOC_REQUIRED", 400, "FG storage location required");
    }

    // Parent Old Process PO must exist, belong to this company, and be opening-origin.
    const { data: parentPo, error: parentErr } = await serviceRoleClient
      .schema("erp_production").from("process_order")
      .select("id, company_id, batch_number, po_type, material_id, segment_code")
      .eq("id", processOrderId).maybeSingle();
    if (parentErr) throw new Error("PROD_OLD_PACKING_PO_CREATE_FAILED");
    const parent = parentPo as JsonRecord | null;
    if (!parent || String(parent.company_id) !== companyId) {
      return genErr(req, ctx, "PROD_OLD_PACKING_PO_PARENT_NOT_FOUND", 404, "Parent Old Process PO not found for this company");
    }
    const batchNumber = toTrimmedString(parent.batch_number);
    const { count: openingCount, error: openCntErr } = await serviceRoleClient
      .schema("erp_production").from("process_order_line_reco")
      .select("id", { count: "exact", head: true })
      .eq("process_order_id", processOrderId).eq("source_txn_type", "OPENING") as { count?: number; error?: unknown };
    if (openCntErr) throw new Error("PROD_OLD_PACKING_PO_CREATE_FAILED");
    if ((openingCount ?? 0) === 0) {
      return genErr(req, ctx, "PROD_OLD_PACKING_PO_PARENT_NOT_OPENING", 422, "Parent Process PO is not an opening-genealogy order");
    }

    // §104.9.1 reconciliation: the FG (SKU) opening line must exist for this batch and reconcile.
    if (!(await openingBatchExists(companyId, batchNumber))) {
      return genErr(req, ctx, "PROD_OLD_OPENING_BATCH_NOT_FOUND", 422,
        `Batch ${batchNumber} has no posted Opening Stock (IN05) for this company.`);
    }
    // §83.14 "balance barrel": several Packing POs (different fill sizes) can legitimately
    // share one SFG/FG opening batch — so this checks the RUNNING remainder, not a strict
    // one-shot equality. A duplicate/typo re-entry of the same qty is still caught because
    // it would push the running total past the IN05 total.
    const openingFgQty = await sumOpeningQty(companyId, skuMaterialId, batchNumber);
    const alreadyAllocatedQty = await sumAllocatedPackingQty(companyId, skuMaterialId, batchNumber);
    const remainingFgQty = openingFgQty - alreadyAllocatedQty;
    if (openingFgQty > 0 && actualQtyKg > remainingFgQty + QTY_TOL) {
      return genErr(req, ctx, "PROD_OLD_OPENING_QTY_MISMATCH", 422,
        `Actual Qty KG (${actualQtyKg}) exceeds the remaining opening FG stock for batch ${batchNumber} (${remainingFgQty} left of ${openingFgQty}).`);
    }

    const segmentCode = toUpperTrimmedString(parent.segment_code as string) || null;
    const poNumber = await generateGlobalDocNumber("PACK_PO");
    const now = new Date().toISOString();

    const { data: insertedPo, error: poInsErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order")
      .insert({
        company_id: companyId, po_number: poNumber, po_type: poType || null,
        process_order_id: processOrderId, material_id: skuMaterialId, pack_code_id: packCodeId,
        fill_qty_per_pack: fillQtyPerPack ?? null, num_packs: numPacks ?? null,
        planned_qty_kg: actualQtyKg, actual_qty_kg: actualQtyKg, total_qty_kg: actualQtyKg,
        status: "FINAL", segment_code: segmentCode, batch_number: batchNumber,
        created_by: ctx.auth_user_id, created_at: now,
        finalized_by: ctx.auth_user_id, finalized_at: now,
        last_updated_at: now, last_updated_by: ctx.auth_user_id,
      })
      .select("id").single();
    if (poInsErr) {
      console.error("[opening_genealogy.createOldPackingPo] PO insert failed:", JSON.stringify(poInsErr));
      throw new Error("PROD_OLD_PACKING_PO_CREATE_FAILED");
    }
    const poId = String((insertedPo as JsonRecord).id);

    // FG (OUTPUT) + SFG (INPUT) + PM lines — genealogy only, stock_ledger_id NULL (⛔ no movement).
    const lineRows: JsonRecord[] = [];
    lineRows.push({
      packing_order_id: poId, line_type: "FG", material_id: skuMaterialId, batch_number: batchNumber,
      qty_per_pack: fillQtyPerPack ?? null, total_qty: actualQtyKg, actual_qty: actualQtyKg,
      issue_sloc_id: fgSlocId, display_order: 1, stock_ledger_id: null, uom_code: "KG",
      movement_type_code: "P101",
    });
    if (sfgMaterialId) {
      lineRows.push({
        packing_order_id: poId, line_type: "SFG", material_id: sfgMaterialId, batch_number: batchNumber,
        qty_per_pack: null, total_qty: actualQtyKg, actual_qty: actualQtyKg,
        issue_sloc_id: sfgSlocId, display_order: 2, stock_ledger_id: null, uom_code: "KG",
        movement_type_code: "P261",
      });
    }
    // §83.4.1-addendum: PM lines get the same Approved/AP-Approved/Variance treatment
    // as a real Final — no deviation was ever recorded for opening genealogy, so
    // Approved="YES" (auto-match, actual == total) for every PM line, matching the
    // live computePmApprovalFields() rule.
    pmLines.forEach((ln, idx) => {
      const qty = Number(parsePositiveNumber(ln.actual_qty ?? ln.total_qty) ?? 0);
      lineRows.push({
        packing_order_id: poId, line_type: "PM",
        material_id: toTrimmedString(ln.material_id),
        actual_material_id: toTrimmedString(ln.actual_material_id) || null,
        batch_number: null, qty_per_pack: ln.qty_per_pack != null ? Number(ln.qty_per_pack) : null,
        total_qty: qty, actual_qty: qty, issue_sloc_id: toTrimmedString(ln.issue_sloc_id) || null,
        display_order: 3 + idx, stock_ledger_id: null, uom_code: toTrimmedString(ln.uom_code) || "EA",
        movement_type_code: "P261",
        approved_status: "YES", ap_approved_qty: qty, variance_qty: 0,
      });
    });
    const { data: insertedLines, error: lineInsErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order_line").insert(lineRows)
      .select("id, line_type, material_id, total_qty, actual_qty, approved_status, ap_approved_qty, variance_qty");
    if (lineInsErr) {
      console.error("[opening_genealogy.createOldPackingPo] line insert failed:", JSON.stringify(lineInsErr));
      throw new Error("PROD_OLD_PACKING_PO_CREATE_FAILED");
    }

    // §83.4.1-addendum: PM Reco/Costing layer, one row per PM line — mirrors PR22's
    // own process_order_line_reco write for RM/INT, same source_txn_type='OPENING'.
    const pmInsertedLines = ((insertedLines ?? []) as JsonRecord[]).filter((l) => l.line_type === "PM");
    if (pmInsertedLines.length > 0) {
      const recoDoc = await generateRecoDocNumber(companyId);
      const pmRecoRows = pmInsertedLines.map((line) => ({
        company_id: companyId, po_number: poNumber, sku_material_id: skuMaterialId,
        batch_number: batchNumber, po_type: poType || null, finalized_at: now,
        packing_order_id: poId, packing_order_line_id: line.id,
        material_id: line.material_id, formulation_material_id: line.material_id,
        standard_qty: line.total_qty, actual_qty: line.actual_qty,
        approved_status: line.approved_status, ap_approved_qty: line.ap_approved_qty,
        variance_qty: line.variance_qty, is_voided: false,
        last_updated_at: now, last_updated_by: ctx.auth_user_id,
        reco_document_number: recoDoc.docNumber, reco_document_year: recoDoc.docYear,
        source_txn_type: "OPENING",
        reference_document_number: poNumber, reference_document_type: "PACK_PO",
      }));
      const { error: recoErr } = await serviceRoleClient
        .schema("erp_production").from("packing_order_line_reco").insert(pmRecoRows);
      if (recoErr) {
        console.error("[opening_genealogy.createOldPackingPo] reco insert failed:", JSON.stringify(recoErr));
        throw new Error("PROD_OLD_PACKING_PO_CREATE_FAILED");
      }
    }

    return createdOk({ id: poId, po_number: poNumber, batch_number: batchNumber, status: "FINAL" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_OLD_PACKING_PO_CREATE_FAILED";
    const status = code.endsWith("_INVALID") || code.endsWith("_REQUIRED") ? 400
      : code.endsWith("_NOT_FOUND") ? 404
      : code.endsWith("_EXISTS") ? 409
      : code.includes("OPENING") || code.endsWith("_MISMATCH") || code.endsWith("_NOT_OPENING") ? 422 : 500;
    return genErr(req, ctx, code, status, "Old Packing PO create failed");
  }
}
