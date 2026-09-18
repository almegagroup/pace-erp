/*
 * File-Path: supabase/functions/api/_core/production/mts_packing_plan.handlers.ts
 * Domain: PRODUCTION
 * Purpose: §138.16 Page 5 -- MTS Packing PO batch-range -> pack-size planning
 *          grid. Persists to erp_production.mts_packing_plan_row (staging,
 *          not real Packing POs yet -- Page 6 converts these).
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import { assertProdReadRole, parseBody, toTrimmedString, getIdFromPath, parsePositiveNumber } from "./production.shared.ts";

type JsonRecord = Record<string, unknown>;
const EPSILON = 0.0001;

function planErr(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}
function createdOkResponse(data: unknown, requestId: string, req?: Request): Response {
  const response = okResponse(data, requestId, req);
  return new Response(response.body, { status: 201, headers: response.headers });
}

// Batch numbers share one alpha prefix per series but the numeric tail is
// the only thing that actually increments -- sorting the raw string would
// break the moment a range crosses a digit-width boundary (e.g. "...998" <
// "...1000" lexicographically is false). Parse the numeric tail and sort on
// that instead; this is the same convention batch_number_instance itself
// has no dedicated sequence column for, so every caller must derive it.
export function numericTail(batchNumber: string): number {
  const match = String(batchNumber).match(/(\d+)\s*$/);
  return match ? parseInt(match[1], 10) : 0;
}

export async function loadProcessOrderAndAuth(
  req: Request,
  ctx: ProdHandlerContext,
  action: "VIEW" | "WRITE",
): Promise<{ po: JsonRecord } | { errorResponse: Response }> {
  const id = getIdFromPath(req);
  if (!id) return { errorResponse: planErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required") };
  const { data: po, error } = await serviceRoleClient
    .schema("erp_production").from("process_order").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error("[mts_packing_plan.load] process_order query failed:", JSON.stringify(error));
    throw new Error("PROD_PO_MTS_PACKING_PLAN_FAILED");
  }
  if (!po) return { errorResponse: planErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found") };
  const poRecord = po as JsonRecord;
  try {
    await assertCompanyScope(ctx, String(poRecord.company_id ?? ""));
  } catch {
    return { errorResponse: planErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.") };
  }
  if (poRecord.po_type !== "MTS") {
    return { errorResponse: planErr(req, ctx, "PROD_PO_MTS_PACKING_PLAN_WRONG_TYPE", 422, "Packing plan is only for MTS Process Orders") };
  }
  if (!(await canMaintainCompanyResource(ctx, String(poRecord.company_id ?? ""), "PROD_PO_CREATE", action))) {
    return { errorResponse: planErr(req, ctx, "PROD_PO_COMPANY_ACCESS_DENIED", 403, "You do not have access for this company.") };
  }
  if (poRecord.status !== "STANDARD") {
    return { errorResponse: planErr(req, ctx, "PROD_PO_STATUS_INVALID", 422, "Packing plan can only be reviewed/saved while the Process PO is at STANDARD") };
  }
  return { po: poRecord };
}

// F-location options for the FG/SKU side: every active F-prefixed location
// mapped to this company via storage_location_plant_map (NOT
// material_plant_ext, which holds only one default per material+company,
// never a multi-option list). Sorted + defaulted so the F-location whose
// numeric suffix matches the SFG's own S-location suffix comes first.
async function fetchFLocationOptions(companyId: string, sfgLocationCode: string | null): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_plant_map")
    .select("storage_location_id, active, storage_location_master!inner(id, code, name, active)")
    .eq("company_id", companyId)
    .eq("active", true)
    .ilike("storage_location_master.code", "F%")
    .eq("storage_location_master.active", true);
  if (error) {
    console.error("[mts_packing_plan.fetchFLocationOptions] query failed:", JSON.stringify(error));
    throw new Error("PROD_PO_MTS_PACKING_PLAN_FAILED");
  }
  const sfgSuffix = sfgLocationCode ? numericTail(sfgLocationCode) : null;
  const rows = ((data ?? []) as JsonRecord[]).map((row) => {
    const loc = row.storage_location_master as JsonRecord;
    return { id: String(loc.id), code: String(loc.code), name: String(loc.name) };
  });
  const seen = new Set<string>();
  const unique = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  unique.sort((a, b) => {
    const aMatch = sfgSuffix !== null && numericTail(a.code) === sfgSuffix ? 0 : 1;
    const bMatch = sfgSuffix !== null && numericTail(b.code) === sfgSuffix ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
    return a.code.localeCompare(b.code);
  });
  return unique;
}

export async function fetchPackSizeOptions(materialId: string): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("prodshade_pack_config")
    .select("pack_code_id, fill_qty, pack_code_master!inner(id, pack_code, description, outer_uom_code, inner_uom_code, active)")
    .eq("material_id", materialId)
    .eq("active", true)
    .eq("pack_code_master.active", true);
  if (error) {
    console.error("[mts_packing_plan.fetchPackSizeOptions] query failed:", JSON.stringify(error));
    throw new Error("PROD_PO_MTS_PACKING_PLAN_FAILED");
  }
  return ((data ?? []) as JsonRecord[]).map((row) => {
    const pc = row.pack_code_master as JsonRecord;
    return {
      pack_code_id: String(pc.id),
      pack_code: String(pc.pack_code),
      description: String(pc.description ?? pc.pack_code),
      outer_uom_code: toTrimmedString(pc.outer_uom_code) || "NOS",
      inner_uom_code: toTrimmedString(pc.inner_uom_code) || null,
      fill_qty: Number(row.fill_qty ?? 0),
    };
  });
}

export async function fetchOrderedBatchNumbers(processOrderId: string): Promise<string[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("batch_number_instance")
    .select("batch_number")
    .eq("source_process_order_id", processOrderId)
    .eq("status", "ACTIVE");
  if (error) {
    console.error("[mts_packing_plan.fetchOrderedBatchNumbers] query failed:", JSON.stringify(error));
    throw new Error("PROD_PO_MTS_PACKING_PLAN_FAILED");
  }
  return ((data ?? []) as JsonRecord[])
    .map((row) => String(row.batch_number))
    .sort((a, b) => numericTail(a) - numericTail(b));
}

async function resolveSfgLocationCode(po: JsonRecord): Promise<string | null> {
  const strokeMasterId = toTrimmedString(po.stroke_master_id);
  if (!strokeMasterId) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_production").from("stroke_master")
    .select("default_storage_location_id").eq("id", strokeMasterId).maybeSingle();
  if (error) throw new Error("PROD_PO_MTS_PACKING_PLAN_FAILED");
  const slocId = toTrimmedString((data as JsonRecord | null)?.default_storage_location_id);
  if (!slocId) return null;
  const { data: locRow } = await serviceRoleClient
    .schema("erp_inventory").from("storage_location_master").select("code").eq("id", slocId).maybeSingle();
  return toTrimmedString((locRow as JsonRecord | null)?.code) || null;
}

export async function getMtsPackingPlanHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const auth = await loadProcessOrderAndAuth(req, ctx, "VIEW");
    if ("errorResponse" in auth) return auth.errorResponse;
    const po = auth.po;
    const id = String(po.id);

    const [sfgLocationCode, packSizeOptions, batchNumbers] = await Promise.all([
      resolveSfgLocationCode(po),
      fetchPackSizeOptions(String(po.material_id)),
      fetchOrderedBatchNumbers(id),
    ]);
    const storageLocationOptions = await fetchFLocationOptions(String(po.company_id), sfgLocationCode);

    const { data: existingRows, error: rowsErr } = await serviceRoleClient
      .schema("erp_production").from("mts_packing_plan_row")
      .select("id, batch_number_from, batch_number_to, pack_code_id, outer_unit_per_batch, storage_location_id, display_order")
      .eq("process_order_id", id).eq("status", "PLANNED").order("display_order");
    if (rowsErr) {
      console.error("[mts_packing_plan.get] rows query failed:", JSON.stringify(rowsErr));
      throw new Error("PROD_PO_MTS_PACKING_PLAN_FAILED");
    }

    return okResponse({
      header: {
        po_number: po.po_number,
        status: po.status,
        total_qty: Number(po.planned_qty ?? 0),
        number_of_batches: Number(po.number_of_batches ?? 0),
        batch_number_from: po.batch_number_from ?? null,
        batch_number_to: po.batch_number_to ?? null,
      },
      pack_size_options: packSizeOptions,
      storage_location_options: storageLocationOptions,
      batch_numbers: batchNumbers,
      rows: existingRows ?? [],
      planned_loss_qty: po.planned_loss_qty ?? null,
      planned_loss_reason: po.planned_loss_reason ?? null,
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_MTS_PACKING_PLAN_FAILED";
    return planErr(req, ctx, code, code === "PROD_PO_NOT_FOUND" ? 404 : 500, "Failed to load packing plan");
  }
}

export async function saveMtsPackingPlanHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const auth = await loadProcessOrderAndAuth(req, ctx, "WRITE");
    if ("errorResponse" in auth) return auth.errorResponse;
    const po = auth.po;
    const id = String(po.id);
    const totalQty = Number(po.planned_qty ?? 0);

    const body = await parseBody(req);
    const bodyRows = Array.isArray(body.rows) ? (body.rows as JsonRecord[]) : [];
    if (bodyRows.length === 0 && !(parsePositiveNumber(body.planned_loss_qty))) {
      return planErr(req, ctx, "PROD_PO_MTS_PACKING_PLAN_EMPTY", 400, "At least one row or a Consider-Loss quantity is required");
    }

    const batchNumbers = await fetchOrderedBatchNumbers(id);
    const batchIndex = new Map(batchNumbers.map((bn, i) => [bn, i]));
    const packSizeOptions = await fetchPackSizeOptions(String(po.material_id));
    const packSizeById = new Map(packSizeOptions.map((p) => [p.pack_code_id, p]));

    const claimed = new Array<boolean>(batchNumbers.length).fill(false);
    const preparedRows: Array<{
      batch_number_from: string; batch_number_to: string; pack_code_id: string;
      outer_unit_per_batch: number; storage_location_id: string; volume: number; display_order: number;
    }> = [];
    let runningVolume = 0;

    for (const [index, row] of bodyRows.entries()) {
      const fromBatch = toTrimmedString(row.batch_number_from);
      const toBatch = toTrimmedString(row.batch_number_to);
      const packCodeId = toTrimmedString(row.pack_code_id);
      const outerUnitPerBatch = parsePositiveNumber(row.outer_unit_per_batch);
      const storageLocationId = toTrimmedString(row.storage_location_id);
      if (!fromBatch || !toBatch || !packCodeId || !outerUnitPerBatch || !storageLocationId) {
        return planErr(req, ctx, "PROD_PO_MTS_PACKING_PLAN_ROW_INVALID", 400, `Row ${index + 1}: all fields are required`);
      }
      const fromIdx = batchIndex.get(fromBatch);
      const toIdx = batchIndex.get(toBatch);
      if (fromIdx === undefined || toIdx === undefined || fromIdx > toIdx) {
        return planErr(req, ctx, "PROD_PO_MTS_PACKING_PLAN_BATCH_RANGE_INVALID", 422, `Row ${index + 1}: batch range must be within this Process PO's own declared batches, From before or equal to To`);
      }
      for (let i = fromIdx; i <= toIdx; i++) {
        if (claimed[i]) {
          return planErr(req, ctx, "PROD_PO_MTS_PACKING_PLAN_BATCH_ALREADY_CLAIMED", 422, `Row ${index + 1}: batch ${batchNumbers[i]} is already claimed by another row`);
        }
        claimed[i] = true;
      }
      const pack = packSizeById.get(packCodeId);
      if (!pack) {
        return planErr(req, ctx, "PROD_PO_MTS_PACKING_PLAN_PACK_SIZE_INVALID", 422, `Row ${index + 1}: pack size is not configured for this Prodshade`);
      }
      const numberOfBatches = toIdx - fromIdx + 1;
      const volume = Number((numberOfBatches * outerUnitPerBatch * Number(pack.fill_qty)).toFixed(6));
      runningVolume = Number((runningVolume + volume).toFixed(6));
      preparedRows.push({
        batch_number_from: fromBatch, batch_number_to: toBatch, pack_code_id: packCodeId,
        outer_unit_per_batch: outerUnitPerBatch, storage_location_id: storageLocationId,
        volume, display_order: index,
      });
    }

    if (runningVolume > totalQty + EPSILON) {
      return planErr(req, ctx, "PROD_PO_MTS_PACKING_PLAN_OVER_ALLOCATED", 422, `Planned rows total ${runningVolume} KG, exceeding this Process PO's Total Qty of ${totalQty} KG`);
    }
    const shortfall = Number((totalQty - runningVolume).toFixed(6));
    let plannedLossQty: number | null = null;
    let plannedLossReason: string | null = null;
    if (shortfall > EPSILON) {
      const submittedLoss = parsePositiveNumber(body.planned_loss_qty);
      if (!submittedLoss || Math.abs(submittedLoss - shortfall) > EPSILON) {
        return planErr(req, ctx, "PROD_PO_MTS_PACKING_PLAN_SHORTFALL_NOT_CONFIRMED", 422, `${shortfall} KG of SFG output is not covered by any row. Confirm Consider Loss to proceed.`);
      }
      plannedLossQty = submittedLoss;
      plannedLossReason = toTrimmedString(body.planned_loss_reason) || null;
    }

    // Re-save is safe: PLANNED rows have not become real Packing POs yet
    // (that only happens on Page 6's own Save, which flips status to
    // CONVERTED) -- replace the whole PLANNED set atomically-enough for a
    // single-user planning page (delete then insert, same shape Page 4's
    // own save already accepts for this pre-conversion stage).
    const { error: deleteErr } = await serviceRoleClient
      .schema("erp_production").from("mts_packing_plan_row")
      .delete().eq("process_order_id", id).eq("status", "PLANNED");
    if (deleteErr) {
      console.error("[mts_packing_plan.save] delete failed:", JSON.stringify(deleteErr));
      throw new Error("PROD_PO_MTS_PACKING_PLAN_SAVE_FAILED");
    }

    const now = new Date().toISOString();
    if (preparedRows.length > 0) {
      const { error: insertErr } = await serviceRoleClient
        .schema("erp_production").from("mts_packing_plan_row")
        .insert(preparedRows.map((r) => ({
          process_order_id: id,
          batch_number_from: r.batch_number_from,
          batch_number_to: r.batch_number_to,
          pack_code_id: r.pack_code_id,
          outer_unit_per_batch: r.outer_unit_per_batch,
          storage_location_id: r.storage_location_id,
          display_order: r.display_order,
          status: "PLANNED",
          created_by: ctx.auth_user_id,
          created_at: now,
          last_updated_by: ctx.auth_user_id,
          last_updated_at: now,
        })));
      if (insertErr) {
        console.error("[mts_packing_plan.save] insert failed:", JSON.stringify(insertErr));
        throw new Error("PROD_PO_MTS_PACKING_PLAN_SAVE_FAILED");
      }
    }

    const { error: poUpdateErr } = await serviceRoleClient
      .schema("erp_production").from("process_order")
      .update({ planned_loss_qty: plannedLossQty, planned_loss_reason: plannedLossReason, last_updated_at: now, last_updated_by: ctx.auth_user_id })
      .eq("id", id);
    if (poUpdateErr) {
      console.error("[mts_packing_plan.save] process_order update failed:", JSON.stringify(poUpdateErr));
      throw new Error("PROD_PO_MTS_PACKING_PLAN_SAVE_FAILED");
    }

    return createdOkResponse({ id, rows_saved: preparedRows.length, planned_loss_qty: plannedLossQty }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_MTS_PACKING_PLAN_SAVE_FAILED";
    return planErr(req, ctx, code, code === "PROD_PO_NOT_FOUND" ? 404 : 500, "Failed to save packing plan");
  }
}
