/*
 * File-ID: 27.5
 * File-Path: supabase/functions/api/_core/production/plan_feed.handlers.ts
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: FO (Firm Order / Plan Feed) handlers — create, list, get, update, cancel,
 *          quantity-level allocation to Packing PO(s), unmapped-stock helper, ordered-
 *          stroke existence check, and the Total Table summary.
 *          §83.18-REVISED (LOCKED 2026-07-23) — replaces the old single-FK
 *          packing_order.plan_feed_id design with a many-to-many allocation table.
 * Authority: Backend
 * DB columns: fo_number, party_id, party_name, sku (text), material_id (FK),
 *             ordered_qty_kg, pack_qty, order_date, scheduled_delivery_date, status,
 *             ordered_stroke_number
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import {
  assertManagerOrSARole,
  assertProdReadRole,
  parseBody,
  toTrimmedString,
  toUpperTrimmedString,
  parsePositiveNumber,
  parsePositiveInt,
  getIdFromPath,
} from "./production.shared.ts";

type JsonRecord = Record<string, unknown>;

const QTY_TOL = 0.0005;

function foErr(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

function createdOkResponse(data: unknown, requestId: string, req?: Request): Response {
  const response = okResponse(data, requestId, req);
  return new Response(response.body, { status: 201, headers: response.headers });
}

async function getMaterialMapByIds(materialIds: string[]): Promise<Map<string, JsonRecord>> {
  const matIds = [...new Set(materialIds.filter(Boolean))];
  const matMap = new Map<string, JsonRecord>();
  if (matIds.length === 0) return matMap;

  const { data: mats, error: matErr } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, pace_code, material_name, shade_code, pack_code")
    .in("id", matIds);
  if (matErr) {
    console.error("[plan_feed.getMaterialMapByIds] material query failed:", JSON.stringify(matErr));
    throw new Error("PROD_PLAN_FEED_MATERIAL_LOOKUP_FAILED");
  }
  for (const mat of (mats ?? []) as JsonRecord[]) {
    matMap.set(String(mat.id), mat);
  }
  return matMap;
}

async function getCustomerMapByIds(customerIds: string[]): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(customerIds.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("customer_master")
    .select("id, customer_code, customer_name, delivery_address, billing_address, fo_customer_type")
    .in("id", ids);
  if (error) {
    console.error("[plan_feed.getCustomerMapByIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_PLAN_FEED_PARTY_LOOKUP_FAILED");
  }
  for (const c of (data ?? []) as JsonRecord[]) map.set(String(c.id), c);
  return map;
}

// §83.15's SKU->Prodshade derivation (same mechanism Pack BOM uses), duplicated locally
// per this codebase's existing per-domain-file convention rather than cross-importing
// from pack_bom.handlers.ts.
async function resolveProdshadeForSku(sku: JsonRecord): Promise<JsonRecord | null> {
  const shadeCode = toTrimmedString(sku.shade_code);
  const packCode = toTrimmedString(sku.pack_code);
  if (!shadeCode || !packCode) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("prodshade_pack_config")
    .select(`
      id, material_id, pack_code_id, active,
      pack_code:pack_code_master!pack_code_id(id, pack_code)
    `)
    .eq("active", true);
  if (error) {
    console.error("[plan_feed.resolveProdshadeForSku] query failed:", JSON.stringify(error));
    throw new Error("PROD_PLAN_FEED_PRODSHADE_LOOKUP_FAILED");
  }
  const rows = (data ?? []) as JsonRecord[];
  const prodshadeMap = await getMaterialMapByIds(rows.map((row) => String(row.material_id ?? "")));
  const match = rows.find((row) => {
    const pack = (row.pack_code ?? {}) as JsonRecord;
    const prod = prodshadeMap.get(String(row.material_id ?? "")) ?? {};
    return toTrimmedString(pack.pack_code) === packCode && toTrimmedString(prod.shade_code) === shadeCode;
  }) ?? null;
  if (!match) return null;
  return prodshadeMap.get(String(match.material_id ?? "")) ?? null;
}

// GET /api/production/plan-feed?company_id=&status=&party_id=&page=&per_page=
export async function listPlanFeedHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const status = toUpperTrimmedString(url.searchParams.get("status") ?? "");
    const partyId = toTrimmedString(url.searchParams.get("party_id") ?? "");
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const perPage = Math.min(100, Math.max(10, parseInt(url.searchParams.get("per_page") ?? "20", 10)));

    let query = serviceRoleClient
      .schema("erp_production").from("plan_feed")
      .select(`
        id, company_id, fo_number, party_id, party_name, sku, material_id,
        description, ordered_qty_kg, pack_qty, order_date,
        scheduled_delivery_date, status, ordered_stroke_number, cancelled_at,
        created_by, created_at, last_updated_at
      `, { count: "exact" })
      .order("order_date", { ascending: false })
      .order("scheduled_delivery_date");

    if (companyId) query = query.eq("company_id", companyId);
    if (status) query = query.eq("status", status);
    if (partyId) query = query.eq("party_id", partyId);

    const { data, error, count } = await ((query as typeof query & {
      range: (from: number, to: number) => typeof query;
    }).range((page - 1) * perPage, page * perPage - 1)) as {
      data: unknown;
      error: unknown;
      count?: number;
    };
    if (error) {
      console.error("[plan_feed.listPlanFeed] query failed:", JSON.stringify(error));
      throw new Error("PROD_PLAN_FEED_LIST_FAILED");
    }

    const rows = (data ?? []) as JsonRecord[];
    const materialMap = await getMaterialMapByIds(rows.map((row) => String(row.material_id ?? "")));

    return okResponse({
      data: rows.map((row) => ({
        ...row,
        material: materialMap.get(String(row.material_id ?? "")) ?? null,
      })),
      pagination: { page, per_page: perPage, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / perPage) },
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_LIST_FAILED";
    return foErr(req, ctx, code, 500, "Plan feed list failed");
  }
}

async function fetchAllocationsForFo(planFeedId: string): Promise<JsonRecord[]> {
  const { data: allocations, error } = await serviceRoleClient
    .schema("erp_production").from("plan_feed_packing_order_allocation")
    .select("id, plan_feed_id, packing_order_id, allocated_qty_kg, created_at, last_updated_at")
    .eq("plan_feed_id", planFeedId);
  if (error) {
    console.error("[plan_feed.fetchAllocationsForFo] query failed:", JSON.stringify(error));
    throw new Error("PROD_PLAN_FEED_ALLOCATION_FETCH_FAILED");
  }
  const rows = (allocations ?? []) as JsonRecord[];
  if (rows.length === 0) return [];

  const poIds = [...new Set(rows.map((r) => String(r.packing_order_id)))];
  const { data: pos, error: poErr } = await serviceRoleClient
    .schema("erp_production").from("packing_order")
    .select("id, po_number, material_id, status, planned_qty_kg, actual_qty_kg, process_order_id, num_packs, fill_qty_per_pack")
    .in("id", poIds);
  if (poErr) {
    console.error("[plan_feed.fetchAllocationsForFo] packing_order query failed:", JSON.stringify(poErr));
    throw new Error("PROD_PLAN_FEED_ALLOCATION_FETCH_FAILED");
  }
  const poMap = new Map(((pos ?? []) as JsonRecord[]).map((p) => [String(p.id), p]));

  const processOrderIds = [...new Set(((pos ?? []) as JsonRecord[]).map((p) => String(p.process_order_id ?? "")).filter(Boolean))];
  const strokeByProcessOrder = new Map<string, JsonRecord>();
  if (processOrderIds.length > 0) {
    const { data: procOrders } = await serviceRoleClient
      .schema("erp_production").from("process_order")
      .select("id, batch_number, stroke_master_id")
      .in("id", processOrderIds);
    const strokeIds = [...new Set(((procOrders ?? []) as JsonRecord[]).map((p) => String(p.stroke_master_id ?? "")).filter(Boolean))];
    let strokeMap = new Map<string, JsonRecord>();
    if (strokeIds.length > 0) {
      const { data: strokes } = await serviceRoleClient
        .schema("erp_production").from("stroke_master")
        .select("id, stroke_number")
        .in("id", strokeIds);
      strokeMap = new Map(((strokes ?? []) as JsonRecord[]).map((s) => [String(s.id), s]));
    }
    for (const po of (procOrders ?? []) as JsonRecord[]) {
      strokeByProcessOrder.set(String(po.id), {
        batch_number: po.batch_number ?? null,
        stroke: strokeMap.get(String(po.stroke_master_id ?? "")) ?? null,
      });
    }
  }

  const materialMap = await getMaterialMapByIds(((pos ?? []) as JsonRecord[]).map((p) => String(p.material_id ?? "")));

  // Room to increase each row: total across every FO for that Packing PO, minus what's
  // allocated to OTHER FOs (this row's own qty is excluded so the UI can show "you can
  // raise this up to X more" rather than a number that already double-counts itself).
  const { data: allOtherAllocs, error: otherAllocErr } = await serviceRoleClient
    .schema("erp_production").from("plan_feed_packing_order_allocation")
    .select("plan_feed_id, packing_order_id, allocated_qty_kg")
    .in("packing_order_id", poIds);
  if (otherAllocErr) {
    console.error("[plan_feed.fetchAllocationsForFo] other-allocations query failed:", JSON.stringify(otherAllocErr));
    throw new Error("PROD_PLAN_FEED_ALLOCATION_FETCH_FAILED");
  }
  const otherAllocatedByPo = new Map<string, number>();
  for (const a of (allOtherAllocs ?? []) as JsonRecord[]) {
    if (String(a.plan_feed_id) === planFeedId) continue;
    const key = String(a.packing_order_id);
    otherAllocatedByPo.set(key, (otherAllocatedByPo.get(key) ?? 0) + (Number(a.allocated_qty_kg) || 0));
  }

  return rows.map((row) => {
    const po = poMap.get(String(row.packing_order_id)) ?? null;
    const procInfo = po ? strokeByProcessOrder.get(String((po as JsonRecord).process_order_id ?? "")) ?? null : null;
    const totalQty = po ? (Number((po as JsonRecord).actual_qty_kg) || Number((po as JsonRecord).planned_qty_kg) || 0) : 0;
    const otherAllocated = otherAllocatedByPo.get(String(row.packing_order_id)) ?? 0;
    return {
      ...row,
      packing_order: po ? {
        ...(po as JsonRecord),
        material: materialMap.get(String((po as JsonRecord).material_id ?? "")) ?? null,
        batch_number: procInfo?.batch_number ?? null,
        actual_stroke: procInfo?.stroke ?? null,
        available_qty_kg_excl_this_fo: Math.max(0, totalQty - otherAllocated),
      } : null,
    };
  });
}

// GET /api/production/plan-feed/:id
export async function getPlanFeedHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return foErr(req, ctx, "PROD_PLAN_FEED_ID_MISSING", 400, "FO ID required");

    const { data, error } = await serviceRoleClient
      .schema("erp_production").from("plan_feed")
      .select(`*`)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[plan_feed.getPlanFeed] query failed:", JSON.stringify(error));
      throw new Error("PROD_PLAN_FEED_FETCH_FAILED");
    }
    if (!data) return foErr(req, ctx, "PROD_PLAN_FEED_NOT_FOUND", 404, "FO not found");

    const row = data as JsonRecord;
    const [materialMap, customerMap, allocations] = await Promise.all([
      getMaterialMapByIds([String(row.material_id ?? "")]),
      getCustomerMapByIds([String(row.party_id ?? "")]),
      fetchAllocationsForFo(id),
    ]);

    // Actual Stroke(s) -- one line per distinct Stroke actually used across allocated
    // Packing POs (never blended), so a formulation deviation from the Ordered Stroke
    // is visible at a glance.
    const actualStrokeNumbers = [...new Set(
      allocations
        .map((a) => (a.packing_order as JsonRecord | null)?.actual_stroke as JsonRecord | null)
        .filter(Boolean)
        .map((s) => (s as JsonRecord).stroke_number as string),
    )];

    return okResponse({
      data: {
        ...row,
        material: materialMap.get(String(row.material_id ?? "")) ?? null,
        party: customerMap.get(String(row.party_id ?? "")) ?? null,
        allocations,
        actual_stroke_numbers: actualStrokeNumbers,
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_FETCH_FAILED";
    return foErr(req, ctx, code, 500, "Plan feed fetch failed");
  }
}

// POST /api/production/plan-feed
export async function createPlanFeedHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);

    const companyId = toTrimmedString(body.company_id);
    const foNumber = toTrimmedString(body.fo_number);
    const partyId = toTrimmedString(body.party_id) || null;
    const partyName = toTrimmedString(body.party_name);
    const sku = toTrimmedString(body.sku);
    const materialId = toTrimmedString(body.material_id) || null;
    const description = toTrimmedString(body.description);
    const orderedQtyKg = parsePositiveNumber(body.ordered_qty_kg);
    const packQty = parsePositiveInt(body.pack_qty);
    const orderDate = toTrimmedString(body.order_date);
    const scheduledDeliveryDate = toTrimmedString(body.scheduled_delivery_date) || null;
    const orderedStrokeNumber = toTrimmedString(body.ordered_stroke_number) || null;

    if (!companyId || !foNumber || !partyName || (!sku && !materialId) || !orderedQtyKg || !orderDate) {
      return foErr(req, ctx, "PROD_PLAN_FEED_INVALID", 400,
        "company_id, fo_number, party_name, sku or material_id, ordered_qty_kg, order_date required");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_production").from("plan_feed")
      .insert({
        company_id: companyId,
        fo_number: foNumber,
        party_id: partyId,
        party_name: partyName,
        sku: sku || null,
        material_id: materialId || null,
        description: description || null,
        ordered_qty_kg: orderedQtyKg,
        pack_qty: packQty ?? null,
        order_date: orderDate,
        scheduled_delivery_date: scheduledDeliveryDate,
        ordered_stroke_number: orderedStrokeNumber,
        status: "ACTIVE",
        created_by: ctx.auth_user_id,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .select("id").single();

    if (error) {
      if (error.code === "23505") {
        return foErr(req, ctx, "PROD_PLAN_FEED_FO_EXISTS", 409, "FO number already exists for this company");
      }
      throw error;
    }
    return createdOkResponse({ id: (data as JsonRecord).id }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_CREATE_FAILED";
    return foErr(req, ctx, code, 500, "Plan feed create failed");
  }
}

// PATCH /api/production/plan-feed/:id
// §83.18-REVISED field-level lock (replaces the old "any Packing PO exists -> whole
// FO frozen" rule): FO Number is never editable (never accepted here, unchanged).
// SKU/material/Description lock only once >=1 allocation exists. Everything else
// (Party, Ordered Qty, Pack Qty, dates, Ordered Stroke) is always editable.
export async function updatePlanFeedHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return foErr(req, ctx, "PROD_PLAN_FEED_ID_MISSING", 400, "FO ID required");

    const { data: existing, error: fetchErr } = await serviceRoleClient
      .schema("erp_production").from("plan_feed")
      .select("id, status").eq("id", id).maybeSingle();

    if (fetchErr) throw new Error("PROD_PLAN_FEED_FETCH_FAILED");
    if (!existing) return foErr(req, ctx, "PROD_PLAN_FEED_NOT_FOUND", 404, "FO not found");
    if ((existing as JsonRecord).status === "CANCELLED") {
      return foErr(req, ctx, "PROD_PLAN_FEED_CANCELLED", 422, "Cancelled FO cannot be edited");
    }

    const body = await parseBody(req);
    const touchesSkuFields = body.sku !== undefined || body.material_id !== undefined || body.description !== undefined;

    if (touchesSkuFields) {
      const { count } = await serviceRoleClient
        .schema("erp_production").from("plan_feed_packing_order_allocation")
        .select("id", { count: "exact", head: true })
        .eq("plan_feed_id", id) as { count?: number };
      if ((count ?? 0) > 0) {
        return foErr(req, ctx, "PROD_PLAN_FEED_SKU_LOCKED", 422,
          "SKU/Description locked — Packing PO(s) already allocated to this FO");
      }
    }

    const updates: JsonRecord = { last_updated_at: new Date().toISOString(), last_updated_by: ctx.auth_user_id };

    if (body.party_id !== undefined) updates.party_id = toTrimmedString(body.party_id) || null;
    if (body.party_name !== undefined) updates.party_name = toTrimmedString(body.party_name);
    if (body.sku !== undefined) updates.sku = toTrimmedString(body.sku) || null;
    if (body.material_id !== undefined) updates.material_id = toTrimmedString(body.material_id) || null;
    if (body.description !== undefined) updates.description = toTrimmedString(body.description) || null;
    if (body.ordered_qty_kg !== undefined) updates.ordered_qty_kg = parsePositiveNumber(body.ordered_qty_kg);
    if (body.pack_qty !== undefined) updates.pack_qty = parsePositiveInt(body.pack_qty);
    if (body.order_date !== undefined) updates.order_date = toTrimmedString(body.order_date);
    if (body.scheduled_delivery_date !== undefined) {
      updates.scheduled_delivery_date = toTrimmedString(body.scheduled_delivery_date) || null;
    }
    if (body.ordered_stroke_number !== undefined) {
      updates.ordered_stroke_number = toTrimmedString(body.ordered_stroke_number) || null;
    }

    const { error } = await serviceRoleClient.schema("erp_production").from("plan_feed")
      .update(updates).eq("id", id);
    if (error) throw new Error("PROD_PLAN_FEED_UPDATE_FAILED");
    return okResponse({ id }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_UPDATE_FAILED";
    return foErr(req, ctx, code, 500, "Plan feed update failed");
  }
}

// POST /api/production/plan-feed/:id/cancel
// §83.18-REVISED: cancel deletes every allocation row for this FO (Packing POs become
// free/unallocated again, never themselves cancelled or altered) then marks the FO
// CANCELLED. No more "delink manually first" block.
export async function cancelPlanFeedHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return foErr(req, ctx, "PROD_PLAN_FEED_ID_MISSING", 400, "FO ID required");

    const { data: existing } = await serviceRoleClient
      .schema("erp_production").from("plan_feed")
      .select("id, status").eq("id", id).maybeSingle();
    if (!existing) return foErr(req, ctx, "PROD_PLAN_FEED_NOT_FOUND", 404, "FO not found");
    if ((existing as JsonRecord).status === "CANCELLED") {
      return foErr(req, ctx, "PROD_PLAN_FEED_ALREADY_CANCELLED", 409, "Already cancelled");
    }

    const { error: deleteAllocError } = await serviceRoleClient
      .schema("erp_production").from("plan_feed_packing_order_allocation")
      .delete().eq("plan_feed_id", id);
    if (deleteAllocError) {
      console.error("[plan_feed.cancelPlanFeed] allocation delete failed:", JSON.stringify(deleteAllocError));
      throw new Error("PROD_PLAN_FEED_CANCEL_FAILED");
    }

    const now = new Date().toISOString();
    const { error } = await serviceRoleClient.schema("erp_production").from("plan_feed")
      .update({ status: "CANCELLED", cancelled_by: ctx.auth_user_id, cancelled_at: now, last_updated_at: now, last_updated_by: ctx.auth_user_id })
      .eq("id", id);
    if (error) throw new Error("PROD_PLAN_FEED_CANCEL_FAILED");
    return okResponse({ id, status: "CANCELLED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_CANCEL_FAILED";
    return foErr(req, ctx, code, 500, "Plan feed cancel failed");
  }
}

// GET /api/production/plan-feed/:id/allocations
export async function listFoAllocationsHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return foErr(req, ctx, "PROD_PLAN_FEED_ID_MISSING", 400, "FO ID required");
    const allocations = await fetchAllocationsForFo(id);
    return okResponse({ data: allocations }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_ALLOCATION_FETCH_FAILED";
    return foErr(req, ctx, code, 500, "Allocation list failed");
  }
}

// POST /api/production/plan-feed/:id/allocations
// body: { packing_order_id, allocated_qty_kg, confirm_mismatch? }
// allocated_qty_kg <= 0 deletes the row (full unmap). Otherwise upserts it (covers
// full map, partial map, and increase/decrease of an existing allocation).
// Material mismatch (Packing PO's material != FO's SKU) is a soft warning, not a hard
// block: unconfirmed mismatch returns 409 without writing; confirm_mismatch=true writes
// anyway. The only hard rule: sum of allocations against one Packing PO (across every
// FO) can never exceed that Packing PO's own qty.
export async function upsertFoAllocationHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const planFeedId = getIdFromPath(req);
    if (!planFeedId) return foErr(req, ctx, "PROD_PLAN_FEED_ID_MISSING", 400, "FO ID required");

    const body = await parseBody(req);
    const packingOrderId = toTrimmedString(body.packing_order_id);
    const requestedQty = Number(body.allocated_qty_kg);
    const confirmMismatch = body.confirm_mismatch === true;
    if (!packingOrderId || !Number.isFinite(requestedQty)) {
      return foErr(req, ctx, "PROD_PLAN_FEED_ALLOCATION_INVALID", 400, "packing_order_id and allocated_qty_kg required");
    }

    const { data: fo, error: foErrRes } = await serviceRoleClient
      .schema("erp_production").from("plan_feed")
      .select("id, status, material_id").eq("id", planFeedId).maybeSingle();
    if (foErrRes || !fo) return foErr(req, ctx, "PROD_PLAN_FEED_NOT_FOUND", 404, "FO not found");
    if ((fo as JsonRecord).status !== "ACTIVE") {
      return foErr(req, ctx, "PROD_PLAN_FEED_NOT_ACTIVE", 422, "FO is not ACTIVE");
    }

    const { data: po, error: poErrRes } = await serviceRoleClient
      .schema("erp_production").from("packing_order")
      .select("id, status, material_id, actual_qty_kg, planned_qty_kg")
      .eq("id", packingOrderId).maybeSingle();
    if (poErrRes || !po) return foErr(req, ctx, "PROD_PACK_NOT_FOUND", 404, "Packing PO not found");
    if (["REVERSED", "CANCELLED"].includes(toUpperTrimmedString((po as JsonRecord).status))) {
      return foErr(req, ctx, "PROD_PACK_REVERSED", 422, "Cannot allocate a reversed/cancelled Packing PO");
    }

    // Full/partial unmap: qty <= 0 just deletes the row.
    if (requestedQty <= 0) {
      const { error: delError } = await serviceRoleClient
        .schema("erp_production").from("plan_feed_packing_order_allocation")
        .delete().eq("plan_feed_id", planFeedId).eq("packing_order_id", packingOrderId);
      if (delError) throw new Error("PROD_PLAN_FEED_ALLOCATION_UPDATE_FAILED");
      return okResponse({ plan_feed_id: planFeedId, packing_order_id: packingOrderId, allocated_qty_kg: 0 }, ctx.request_id, req);
    }

    const materialMismatch = toTrimmedString((po as JsonRecord).material_id) !== toTrimmedString((fo as JsonRecord).material_id);
    if (materialMismatch && !confirmMismatch) {
      return foErr(req, ctx, "PROD_PLAN_FEED_MATERIAL_MISMATCH", 409,
        "Packing PO material differs from this FO's SKU — confirm to allocate anyway");
    }

    const availableQty = Number((po as JsonRecord).actual_qty_kg) || Number((po as JsonRecord).planned_qty_kg) || 0;

    const { data: otherAllocs, error: otherErr } = await serviceRoleClient
      .schema("erp_production").from("plan_feed_packing_order_allocation")
      .select("plan_feed_id, allocated_qty_kg")
      .eq("packing_order_id", packingOrderId);
    if (otherErr) throw new Error("PROD_PLAN_FEED_ALLOCATION_FETCH_FAILED");
    const otherSum = ((otherAllocs ?? []) as JsonRecord[])
      .filter((a) => String(a.plan_feed_id) !== planFeedId)
      .reduce((sum, a) => sum + (Number(a.allocated_qty_kg) || 0), 0);

    if (otherSum + requestedQty > availableQty + QTY_TOL) {
      return foErr(req, ctx, "PROD_PLAN_FEED_ALLOCATION_EXCEEDS_STOCK", 422,
        `Allocation exceeds this Packing PO's available qty (${availableQty}, already allocated elsewhere: ${otherSum})`);
    }

    const now = new Date().toISOString();
    const { error: upsertErr } = await serviceRoleClient
      .schema("erp_production").from("plan_feed_packing_order_allocation")
      .upsert({
        plan_feed_id: planFeedId,
        packing_order_id: packingOrderId,
        allocated_qty_kg: requestedQty,
        created_by: ctx.auth_user_id,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: now,
      }, { onConflict: "plan_feed_id,packing_order_id" });
    if (upsertErr) {
      console.error("[plan_feed.upsertFoAllocation] upsert failed:", JSON.stringify(upsertErr));
      throw new Error("PROD_PLAN_FEED_ALLOCATION_UPDATE_FAILED");
    }

    return okResponse({ plan_feed_id: planFeedId, packing_order_id: packingOrderId, allocated_qty_kg: requestedQty }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_ALLOCATION_UPDATE_FAILED";
    return foErr(req, ctx, code, 500, "Allocation update failed");
  }
}

// GET /api/production/plan-feed/unmapped-stock?company_id=&material_id=
// "Already made but free" helper for the Create tab: sums each FINAL Packing PO's own
// qty minus whatever is already allocated to any FO, for the given material. Live
// query, not cached -- an unmap/cancel elsewhere makes qty reappear here automatically.
export async function listUnmappedStockHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const materialId = toTrimmedString(url.searchParams.get("material_id") ?? "");
    if (!companyId || !materialId) {
      return foErr(req, ctx, "PROD_PLAN_FEED_UNMAPPED_INVALID", 400, "company_id and material_id required");
    }

    const { data: pos, error: poErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order")
      .select("id, po_number, actual_qty_kg")
      .eq("company_id", companyId)
      .eq("material_id", materialId)
      .eq("status", "FINAL");
    if (poErr) throw new Error("PROD_PLAN_FEED_UNMAPPED_FAILED");
    const poRows = (pos ?? []) as JsonRecord[];
    if (poRows.length === 0) return okResponse({ data: { total_free_qty_kg: 0, lines: [] } }, ctx.request_id, req);

    const poIds = poRows.map((p) => String(p.id));
    const { data: allocs, error: allocErr } = await serviceRoleClient
      .schema("erp_production").from("plan_feed_packing_order_allocation")
      .select("packing_order_id, allocated_qty_kg")
      .in("packing_order_id", poIds);
    if (allocErr) throw new Error("PROD_PLAN_FEED_UNMAPPED_FAILED");

    const allocatedByPo = new Map<string, number>();
    for (const a of (allocs ?? []) as JsonRecord[]) {
      const key = String(a.packing_order_id);
      allocatedByPo.set(key, (allocatedByPo.get(key) ?? 0) + (Number(a.allocated_qty_kg) || 0));
    }

    const lines = poRows.map((p) => {
      const actualQty = Number(p.actual_qty_kg) || 0;
      const allocated = allocatedByPo.get(String(p.id)) ?? 0;
      const freeQty = Math.max(0, actualQty - allocated);
      return { packing_order_id: p.id, po_number: p.po_number, actual_qty_kg: actualQty, allocated_qty_kg: allocated, free_qty_kg: freeQty };
    }).filter((l) => l.free_qty_kg > QTY_TOL);

    const totalFreeQty = lines.reduce((sum, l) => sum + l.free_qty_kg, 0);
    return okResponse({ data: { total_free_qty_kg: totalFreeQty, lines } }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_UNMAPPED_FAILED";
    return foErr(req, ctx, code, 500, "Unmapped stock lookup failed");
  }
}

// GET /api/production/plan-feed/check-stroke?company_id=&material_id=&stroke_number=
// Ordered Stroke live existence-check: derives the FO's SKU -> Prodshade (same
// mechanism Pack BOM uses, §83.15) then looks up stroke_master by (company, prodshade,
// stroke_number). Pure lookup, never creates anything.
export async function checkOrderedStrokeHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const materialId = toTrimmedString(url.searchParams.get("material_id") ?? "");
    const strokeNumber = toTrimmedString(url.searchParams.get("stroke_number") ?? "");
    if (!companyId || !materialId || !strokeNumber) {
      return foErr(req, ctx, "PROD_PLAN_FEED_STROKE_CHECK_INVALID", 400, "company_id, material_id, stroke_number required");
    }

    const materialMap = await getMaterialMapByIds([materialId]);
    const sku = materialMap.get(materialId);
    if (!sku) return foErr(req, ctx, "PROD_PLAN_FEED_MATERIAL_NOT_FOUND", 404, "Material not found");

    const prodshade = await resolveProdshadeForSku(sku);
    if (!prodshade) {
      return okResponse({ data: { exists: false, reason: "NO_PRODSHADE_CONFIG_FOR_SKU" } }, ctx.request_id, req);
    }

    const { data: stroke, error } = await serviceRoleClient
      .schema("erp_production").from("stroke_master")
      .select("id, stroke_number, status")
      .eq("company_id", companyId)
      .eq("prodshade_material_id", String((prodshade as JsonRecord).id))
      .eq("stroke_number", strokeNumber)
      .maybeSingle();
    if (error) {
      console.error("[plan_feed.checkOrderedStroke] stroke query failed:", JSON.stringify(error));
      throw new Error("PROD_PLAN_FEED_STROKE_CHECK_FAILED");
    }

    if (!stroke) return okResponse({ data: { exists: false, reason: "NOT_FOUND" } }, ctx.request_id, req);
    return okResponse({ data: { exists: true, id: (stroke as JsonRecord).id, status: (stroke as JsonRecord).status } }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_STROKE_CHECK_FAILED";
    return foErr(req, ctx, code, 500, "Ordered stroke check failed");
  }
}

// GET /api/production/plan-feed/stroke-options?company_id=&material_id=
// Lists every stroke_master row (any status) for the SKU's derived Prodshade, so the
// Ordered Stroke field can suggest existing strokes -- the same free-text-or-pick
// pattern as the SKU field. An empty list is normal (no config yet / no strokes yet),
// never an error.
export async function listStrokeOptionsHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const materialId = toTrimmedString(url.searchParams.get("material_id") ?? "");
    if (!companyId || !materialId) {
      return foErr(req, ctx, "PROD_PLAN_FEED_STROKE_OPTIONS_INVALID", 400, "company_id and material_id required");
    }

    const materialMap = await getMaterialMapByIds([materialId]);
    const sku = materialMap.get(materialId);
    if (!sku) return okResponse({ data: [] }, ctx.request_id, req);

    const prodshade = await resolveProdshadeForSku(sku);
    if (!prodshade) return okResponse({ data: [] }, ctx.request_id, req);

    const { data, error } = await serviceRoleClient
      .schema("erp_production").from("stroke_master")
      .select("id, stroke_number, status")
      .eq("company_id", companyId)
      .eq("prodshade_material_id", String((prodshade as JsonRecord).id))
      .order("stroke_number");
    if (error) {
      console.error("[plan_feed.listStrokeOptions] query failed:", JSON.stringify(error));
      throw new Error("PROD_PLAN_FEED_STROKE_OPTIONS_FAILED");
    }
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_STROKE_OPTIONS_FAILED";
    return foErr(req, ctx, code, 500, "Stroke options lookup failed");
  }
}

// Batched SKU -> Prodshade resolution for the Total Table's "ordered stroke missing"
// check -- one prodshade_pack_config fetch for the whole page instead of one per row.
async function resolveProdshadeMapForMaterials(materialIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(materialIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (ids.length === 0) return map;

  const materialMap = await getMaterialMapByIds(ids);
  const { data: configs, error } = await serviceRoleClient
    .schema("erp_production").from("prodshade_pack_config")
    .select(`
      id, material_id, pack_code_id, active,
      pack_code:pack_code_master!pack_code_id(id, pack_code)
    `)
    .eq("active", true);
  if (error) {
    console.error("[plan_feed.resolveProdshadeMapForMaterials] query failed:", JSON.stringify(error));
    throw new Error("PROD_PLAN_FEED_PRODSHADE_LOOKUP_FAILED");
  }
  const configRows = (configs ?? []) as JsonRecord[];
  const prodshadeMap = await getMaterialMapByIds(configRows.map((row) => String(row.material_id ?? "")));

  for (const materialId of ids) {
    const sku = materialMap.get(materialId);
    if (!sku) continue;
    const shadeCode = toTrimmedString(sku.shade_code);
    const packCode = toTrimmedString(sku.pack_code);
    if (!shadeCode || !packCode) continue;
    const match = configRows.find((row) => {
      const pack = (row.pack_code ?? {}) as JsonRecord;
      const prod = prodshadeMap.get(String(row.material_id ?? "")) ?? {};
      return toTrimmedString(pack.pack_code) === packCode && toTrimmedString(prod.shade_code) === shadeCode;
    });
    if (match) map.set(materialId, String(match.material_id));
  }
  return map;
}

function computeProductionStatus(orderedQtyKg: number, allocatedQtyKg: number): string {
  if (allocatedQtyKg <= QTY_TOL) return "UNMAPPED";
  if (allocatedQtyKg >= orderedQtyKg - QTY_TOL) return "FULLY_MAPPED";
  return "PARTIALLY_MAPPED";
}

// GET /api/production/plan-feed/summary?company_id=
export async function planFeedSummaryHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");

    let foQuery = serviceRoleClient
      .schema("erp_production").from("plan_feed")
      .select(`
        id, company_id, fo_number, party_name, sku, description, material_id,
        ordered_qty_kg, pack_qty, order_date, scheduled_delivery_date, status,
        ordered_stroke_number
      `)
      .neq("status", "CANCELLED");
    if (companyId) foQuery = foQuery.eq("company_id", companyId);

    const { data: fos, error: foFetchErr } = await foQuery;
    if (foFetchErr) throw new Error("PROD_PLAN_FEED_SUMMARY_FAILED");
    if (!fos || fos.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    const foIds = (fos as JsonRecord[]).map(f => f.id as string);

    // §83.18-REVISED: flag rows whose Ordered Stroke isn't (yet) in Stroke Master --
    // live check, so the flag clears itself the moment someone creates that Stroke,
    // no manual update needed here.
    const materialIdsWithStroke = (fos as JsonRecord[])
      .filter((f) => toTrimmedString(f.ordered_stroke_number))
      .map((f) => String(f.material_id ?? ""));
    const prodshadeMap = await resolveProdshadeMapForMaterials(materialIdsWithStroke);
    const prodshadeIds = [...new Set([...prodshadeMap.values()])];
    const existingStrokePairs = new Set<string>();
    if (prodshadeIds.length > 0) {
      const { data: strokeRows, error: strokeErr } = await serviceRoleClient
        .schema("erp_production").from("stroke_master")
        .select("company_id, prodshade_material_id, stroke_number")
        .in("prodshade_material_id", prodshadeIds);
      if (strokeErr) throw new Error("PROD_PLAN_FEED_SUMMARY_FAILED");
      for (const s of (strokeRows ?? []) as JsonRecord[]) {
        existingStrokePairs.add(`${s.company_id}|${s.prodshade_material_id}|${s.stroke_number}`);
      }
    }

    const { data: allocs, error: allocErr } = await serviceRoleClient
      .schema("erp_production").from("plan_feed_packing_order_allocation")
      .select("plan_feed_id, packing_order_id, allocated_qty_kg")
      .in("plan_feed_id", foIds);
    if (allocErr) throw new Error("PROD_PLAN_FEED_SUMMARY_FAILED");

    const allocByFo: Record<string, JsonRecord[]> = {};
    for (const a of (allocs ?? []) as JsonRecord[]) {
      const foId = String(a.plan_feed_id);
      if (!allocByFo[foId]) allocByFo[foId] = [];
      allocByFo[foId].push(a);
    }

    // Dispatch (L5) does not exist yet -- dispatched_qty_kg/dispatch dates are
    // placeholders until that module lands (§83.18-REVISED note). Never inferred from
    // Packing PO FINAL status; that would misreport "produced" as "shipped."
    const summaryRows = (fos as JsonRecord[]).map(fo => {
      const foId = fo.id as string;
      const foAllocs = allocByFo[foId] ?? [];
      const allocatedKg = foAllocs.reduce((s, a) => s + (Number(a.allocated_qty_kg) || 0), 0);
      const orderedKg = Number(fo.ordered_qty_kg) || 0;
      const dispatchedKg = 0;
      const strokeNumber = toTrimmedString(fo.ordered_stroke_number);
      const prodshadeId = prodshadeMap.get(String(fo.material_id ?? ""));
      const orderedStrokeMissing = Boolean(strokeNumber) &&
        !existingStrokePairs.has(`${fo.company_id}|${prodshadeId}|${strokeNumber}`);
      return {
        id: foId,
        fo_number: fo.fo_number,
        party_name: fo.party_name,
        sku: fo.sku,
        description: fo.description,
        ordered_qty_kg: orderedKg,
        pack_qty: fo.pack_qty,
        order_date: fo.order_date,
        scheduled_delivery_date: fo.scheduled_delivery_date,
        status: fo.status,
        ordered_stroke_number: strokeNumber || null,
        ordered_stroke_missing: orderedStrokeMissing,
        allocated_qty_kg: allocatedKg,
        packing_po_count: foAllocs.length,
        production_status: computeProductionStatus(orderedKg, allocatedKg),
        dispatched_qty_kg: dispatchedKg,
        dispatch_status: "UNDISPATCHED",
        dispatch_dates: [] as string[],
        pending_dispatch_kg: Math.max(0, orderedKg - dispatchedKg),
      };
    });

    // Sort: rows still needing action (not FULLY_MAPPED) float to the top, ordered by
    // nearest Scheduled Delivery Date; FULLY_MAPPED rows sink to the bottom. Dispatch-
    // based grouping/sort (per §83.18-REVISED) layers on once Dispatch/L5 exists -- for
    // now FULLY_MAPPED rows sort by Order Date descending (most recent activity first)
    // as the closest available stand-in for "most-recent-dispatch-date-first."
    summaryRows.sort((a, b) => {
      const aDone = a.production_status === "FULLY_MAPPED";
      const bDone = b.production_status === "FULLY_MAPPED";
      if (aDone !== bDone) return aDone ? 1 : -1;
      if (!aDone) {
        const aDate = a.scheduled_delivery_date ? String(a.scheduled_delivery_date) : "9999-12-31";
        const bDate = b.scheduled_delivery_date ? String(b.scheduled_delivery_date) : "9999-12-31";
        return aDate.localeCompare(bDate);
      }
      return String(b.order_date ?? "").localeCompare(String(a.order_date ?? ""));
    });

    return okResponse({ data: summaryRows }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_SUMMARY_FAILED";
    return foErr(req, ctx, code, 500, "Plan feed summary failed");
  }
}
