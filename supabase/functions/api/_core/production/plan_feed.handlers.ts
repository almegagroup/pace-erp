/*
 * File-ID: 27.5
 * File-Path: supabase/functions/api/_core/production/plan_feed.handlers.ts
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: FO (Firm Order / Plan Feed) handlers — create, list, get, update, cancel.
 *          Includes summary handler for Total Table tab.
 * Authority: Backend
 * DB columns: fo_number, party_id, party_name, sku (text), material_id (nullable FK),
 *             ordered_qty_kg, pack_qty, order_date, scheduled_delivery_date, status
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

function foErr(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
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
        scheduled_delivery_date, status, cancelled_at, created_by, created_at, last_updated_at,
        material:erp_master.material_master!material_id(id, pace_code, material_name)
      `, { count: "exact" })
      .order("order_date", { ascending: false })
      .order("scheduled_delivery_date")
      .range((page - 1) * perPage, page * perPage - 1);

    if (companyId) query = query.eq("company_id", companyId);
    if (status) query = query.eq("status", status);
    if (partyId) query = query.eq("party_id", partyId);

    const { data, error, count } = await query;
    if (error) throw new Error("PROD_PLAN_FEED_LIST_FAILED");

    return okResponse({
      data: data ?? [],
      pagination: { page, per_page: perPage, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / perPage) },
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_LIST_FAILED";
    return foErr(req, ctx, code, 500, "Plan feed list failed");
  }
}

// GET /api/production/plan-feed/:id
export async function getPlanFeedHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return foErr(req, ctx, "PROD_PLAN_FEED_ID_MISSING", 400, "FO ID required");

    const { data, error } = await serviceRoleClient
      .schema("erp_production").from("plan_feed")
      .select(`
        *,
        material:erp_master.material_master!material_id(id, pace_code, material_name)
      `)
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error("PROD_PLAN_FEED_FETCH_FAILED");
    if (!data) return foErr(req, ctx, "PROD_PLAN_FEED_NOT_FOUND", 404, "FO not found");

    const { data: packingOrders } = await serviceRoleClient
      .schema("erp_production").from("packing_order")
      .select(`
        id, po_number, process_order_id, status, planned_qty_kg, actual_qty_kg,
        process_order:process_order!process_order_id(po_number, batch_number, status)
      `)
      .eq("plan_feed_id", id)
      .neq("status", "REVERSED");

    return okResponse({ data: { ...(data as JsonRecord), packing_orders: packingOrders ?? [] } }, ctx.request_id, req);
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
    return okResponse({ id: (data as JsonRecord).id }, ctx.request_id, req, 201);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_CREATE_FAILED";
    return foErr(req, ctx, code, 500, "Plan feed create failed");
  }
}

// PATCH /api/production/plan-feed/:id
// Edit-locked once any Packing PO (non-REVERSED) is linked.
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

    const { count } = await serviceRoleClient
      .schema("erp_production").from("packing_order")
      .select("id", { count: "exact", head: true })
      .eq("plan_feed_id", id).neq("status", "REVERSED");
    if ((count ?? 0) > 0) {
      return foErr(req, ctx, "PROD_PLAN_FEED_LOCKED", 422, "FO is edit-locked — Packing Orders exist");
    }

    const body = await parseBody(req);
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

    const { count } = await serviceRoleClient.schema("erp_production").from("packing_order")
      .select("id", { count: "exact", head: true })
      .eq("plan_feed_id", id).neq("status", "REVERSED");
    if ((count ?? 0) > 0) {
      return foErr(req, ctx, "PROD_PLAN_FEED_HAS_PACKING_ORDERS", 422,
        "Cannot cancel — delink all Packing Orders first");
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

// GET /api/production/plan-feed/summary?company_id=
export async function planFeedSummaryHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");

    let foQuery = serviceRoleClient
      .schema("erp_production").from("plan_feed")
      .select(`
        id, fo_number, party_name, sku, description,
        ordered_qty_kg, pack_qty, order_date, scheduled_delivery_date, status
      `)
      .neq("status", "CANCELLED")
      .order("order_date")
      .order("scheduled_delivery_date");
    if (companyId) foQuery = foQuery.eq("company_id", companyId);

    const { data: fos, error: foFetchErr } = await foQuery;
    if (foFetchErr) throw new Error("PROD_PLAN_FEED_SUMMARY_FAILED");
    if (!fos || fos.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    const foIds = (fos as JsonRecord[]).map(f => f.id as string);

    const { data: packOrders } = await serviceRoleClient
      .schema("erp_production").from("packing_order")
      .select("plan_feed_id, id, po_number, process_order_id, status, planned_qty_kg, actual_qty_kg")
      .in("plan_feed_id", foIds)
      .neq("status", "REVERSED");

    const packByFo: Record<string, JsonRecord[]> = {};
    for (const po of (packOrders ?? []) as JsonRecord[]) {
      const foId = po.plan_feed_id as string;
      if (!packByFo[foId]) packByFo[foId] = [];
      packByFo[foId].push(po);
    }

    const summaryRows = (fos as JsonRecord[]).map(fo => {
      const foId = fo.id as string;
      const pos = packByFo[foId] ?? [];
      const linkedKg = pos.reduce((s, p) => s + (Number(p.planned_qty_kg) || 0), 0);
      const dispatchedKg = pos.filter(p => p.status === "FINAL")
        .reduce((s, p) => s + (Number(p.actual_qty_kg) || 0), 0);
      return {
        fo_number: fo.fo_number,
        party_name: fo.party_name,
        sku: fo.sku,
        description: fo.description,
        ordered_qty_kg: fo.ordered_qty_kg,
        pack_qty: fo.pack_qty,
        order_date: fo.order_date,
        scheduled_delivery_date: fo.scheduled_delivery_date,
        status: fo.status,
        kg_linked_to_packing_pos: linkedKg,
        packing_po_count: pos.length,
        dispatched_qty_kg: dispatchedKg,
        pending_dispatch_kg: Math.max(0, (fo.ordered_qty_kg as number) - dispatchedKg),
        packing_orders: pos.map(p => ({
          id: p.id,
          po_number: p.po_number,
          process_order_id: p.process_order_id,
          status: p.status,
          planned_qty_kg: p.planned_qty_kg,
          actual_qty_kg: p.actual_qty_kg,
        })),
      };
    });

    return okResponse({ data: summaryRows }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_SUMMARY_FAILED";
    return foErr(req, ctx, code, 500, "Plan feed summary failed");
  }
}
