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
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { isManualDocumentDateWithinWindow, MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE } from "../../_shared/manualDocumentDateWindow.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import {
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

function isMtestParty(party: JsonRecord | undefined): boolean {
  const type = toUpperTrimmedString(party?.fo_customer_type);
  return type === "MTEST" || type === "ZTEST";
}

async function assertMtestPlanFeed(
  req: Request,
  ctx: ProdHandlerContext,
  fo: JsonRecord,
): Promise<Response | null> {
  const partyId = toTrimmedString(fo.party_id);
  const party = partyId ? (await getCustomerMapByIds([partyId])).get(partyId) : undefined;
  if (!isMtestParty(party)) {
    return foErr(req, ctx, "PROD_PLAN_FEED_MTEST_ONLY", 403, "QA can edit or map Packing POs only for MTEST FOs.");
  }
  const companyId = toTrimmedString(fo.company_id);
  if (!(await canMaintainCompanyResource(ctx, companyId, "PROD_MTEST_PLAN_FEED", "EDIT"))) {
    return foErr(req, ctx, "PROD_PLAN_FEED_MTEST_ACCESS_DENIED", 403, "You do not have MTEST Plan Feed edit access for this company.");
  }
  return null;
}

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
    .select("id, pace_code, external_code, material_name, shade_code, pack_code")
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

function resolveEffectiveSkuCode(material: JsonRecord | null | undefined, fallbackSku?: string | null): string {
  return toUpperTrimmedString(
    toTrimmedString(fallbackSku)
      || toTrimmedString(material?.external_code)
      || toTrimmedString(material?.pace_code),
  );
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
    const search = toTrimmedString(url.searchParams.get("search") ?? "");
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const perPage = Math.min(100, Math.max(10, parseInt(url.searchParams.get("per_page") ?? "20", 10)));

    let query = serviceRoleClient
      .schema("erp_production").from("plan_feed")
      .select(`
        id, company_id, fo_number, party_id, customer_address_id, party_name, sku, material_id,
        description, ordered_qty_kg, pack_qty, order_date,
        scheduled_delivery_date, status, ordered_stroke_number, cancelled_at,
        created_by, created_at, last_updated_at
      `, { count: "exact" })
      .order("order_date", { ascending: false })
      .order("scheduled_delivery_date");

    if (companyId) query = query.eq("company_id", companyId);
    if (status) query = query.eq("status", status);
    if (partyId) query = query.eq("party_id", partyId);
    // The "browse recent FOs" search box only searched within whatever page
    // was already fetched (per_page: 50 from the frontend) -- a real match
    // outside that page silently looked like "not found" (found live
    // 2026-08-27). Now filters server-side, across the whole company.
    if (search) query = (query as unknown as { or: (filters: string) => typeof query }).or(
      `fo_number.ilike.%${search}%,party_name.ilike.%${search}%,sku.ilike.%${search}%,description.ilike.%${search}%`,
    );

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

// GET /api/production/plan-feed/find?fo_number=&company_ids=id1,id2,...
// The Edit tab's primary lookup: exact FO Number match, scoped to whichever companies
// the caller passes (their own accessible company list, e.g. runtimeContext's
// availableCompanies) -- not a system-wide search. fo_number is only unique per
// company, so a multi-company user could in rare cases get more than one match; the
// caller decides (auto-load if exactly one, otherwise let the user disambiguate).
export async function findPlanFeedByNumberHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const foNumber = toTrimmedString(url.searchParams.get("fo_number") ?? "");
    const companyIds = toTrimmedString(url.searchParams.get("company_ids") ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    if (!foNumber || companyIds.length === 0) {
      return foErr(req, ctx, "PROD_PLAN_FEED_FIND_INVALID", 400, "fo_number and company_ids required");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_production").from("plan_feed")
      .select("id, company_id, fo_number, party_name, order_date, status")
      .eq("fo_number", foNumber)
      .in("company_id", companyIds);
    if (error) {
      console.error("[plan_feed.findPlanFeedByNumber] query failed:", JSON.stringify(error));
      throw new Error("PROD_PLAN_FEED_FIND_FAILED");
    }

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_FIND_FAILED";
    return foErr(req, ctx, code, 500, "FO lookup failed");
  }
}

async function fetchAllocationsForFo(planFeedId: string): Promise<JsonRecord[]> {
  const { data: allocations, error } = await serviceRoleClient
    .schema("erp_production").from("plan_feed_packing_order_allocation")
    .select("id, plan_feed_id, plan_feed_item_id, packing_order_id, allocated_qty_kg, created_at, last_updated_at")
    .eq("plan_feed_id", planFeedId);
  if (error) {
    console.error("[plan_feed.fetchAllocationsForFo] query failed:", JSON.stringify(error));
    throw new Error("PROD_PLAN_FEED_ALLOCATION_FETCH_FAILED");
  }
  const rows = (allocations ?? []) as JsonRecord[];
  if (rows.length === 0) return [];

  const itemIds = [...new Set(rows.map((row) => toTrimmedString(row.plan_feed_item_id)).filter(Boolean))];
  const { data: itemRows, error: itemError } = itemIds.length
    ? await serviceRoleClient.schema("erp_production").from("plan_feed_item")
      .select("id, material_id, sku, description, ordered_qty_kg, pack_qty").in("id", itemIds)
    : { data: [] as JsonRecord[], error: null };
  if (itemError) throw new Error("PROD_PLAN_FEED_ITEM_FETCH_FAILED");
  const itemById = new Map(((itemRows ?? []) as JsonRecord[]).map((item) => [toTrimmedString(item.id), item]));

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
        .select("id, stroke_number, prodshade_material_id")
        .in("id", strokeIds);
      // §131.5 item #3 (2026-08-26) -- an MTEST FO's allocated Packing POs can each draw
      // from a different Prodshade's batch (§131.4 item #11 picker, since the 5 generic
      // sample SKUs have no fixed Prodshade of their own) -- unlike a normal FO where
      // every allocated Packing PO shares the FO's own single SKU-derived Prodshade. The
      // Prodshade name travels alongside the Stroke here so the Edit page can disambiguate.
      const prodshadeMaterialIds = [...new Set(((strokes ?? []) as JsonRecord[]).map((s) => String(s.prodshade_material_id ?? "")).filter(Boolean))];
      const prodshadeMaterialMap = await getMaterialMapByIds(prodshadeMaterialIds);
      strokeMap = new Map(((strokes ?? []) as JsonRecord[]).map((s) => {
        const prod = prodshadeMaterialMap.get(String(s.prodshade_material_id ?? ""));
        return [String(s.id), {
          ...s,
          prodshade_name: prod ? (toTrimmedString(prod.material_name) || toTrimmedString(prod.document_name) || null) : null,
        }];
      }));
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
      plan_feed_item: itemById.get(toTrimmedString(row.plan_feed_item_id)) ?? null,
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

async function getMappedSalesOrderLineIds(planFeedId: string): Promise<string[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement").from("sales_order_line")
    .select("id")
    .eq("plan_feed_id", planFeedId);
  if (error) {
    console.error("[plan_feed.getMappedSalesOrderLineIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_PLAN_FEED_SO_LOOKUP_FAILED");
  }
  return ((data ?? []) as JsonRecord[]).map((row) => String(row.id ?? "")).filter(Boolean);
}

async function getBlockingDeliveryOrdersForSoLines(soLineIds: string[]): Promise<JsonRecord[]> {
  if (soLineIds.length === 0) return [];

  const { data: dcLines, error: dcLineErr } = await serviceRoleClient
    .schema("erp_procurement").from("delivery_challan_line")
    .select("dc_id, so_line_id")
    .in("so_line_id", soLineIds);
  if (dcLineErr) {
    console.error("[plan_feed.getBlockingDeliveryOrdersForSoLines] line query failed:", JSON.stringify(dcLineErr));
    throw new Error("PROD_PLAN_FEED_DO_LOOKUP_FAILED");
  }

  const dcIds = [...new Set(((dcLines ?? []) as JsonRecord[]).map((row) => String(row.dc_id ?? "")).filter(Boolean))];
  if (dcIds.length === 0) return [];

  const { data: dcs, error: dcErr } = await serviceRoleClient
    .schema("erp_procurement").from("delivery_challan")
    .select("id, dc_number, status")
    .in("id", dcIds);
  if (dcErr) {
    console.error("[plan_feed.getBlockingDeliveryOrdersForSoLines] dc query failed:", JSON.stringify(dcErr));
    throw new Error("PROD_PLAN_FEED_DO_LOOKUP_FAILED");
  }

  return ((dcs ?? []) as JsonRecord[]).filter((row) => toUpperTrimmedString(row.status) !== "CANCELLED");
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
    const [materialMap, customerMap, allocations, itemResult] = await Promise.all([
      getMaterialMapByIds([String(row.material_id ?? "")]),
      getCustomerMapByIds([String(row.party_id ?? "")]),
      fetchAllocationsForFo(id),
      serviceRoleClient.schema("erp_production").from("plan_feed_item")
        .select("id, material_id, sku, description, ordered_qty_kg, pack_qty, ordered_stroke_number")
        .eq("plan_feed_id", id).order("created_at"),
    ]);
    if (itemResult.error) throw new Error("PROD_PLAN_FEED_ITEM_FETCH_FAILED");

    // Actual Stroke(s) -- one line per distinct Stroke actually used across allocated
    // Packing POs (never blended), so a formulation deviation from the Ordered Stroke
    // is visible at a glance.
    const actualStrokeNumbers = [...new Set(
      allocations
        .map((a) => (a.packing_order as JsonRecord | null)?.actual_stroke as JsonRecord | null)
        .filter(Boolean)
        .map((s) => (s as JsonRecord).stroke_number as string),
    )];
    // §131.5 item #3 -- prodshade-qualified companion to actual_stroke_numbers above,
    // deduped by (prodshade, stroke) pair rather than stroke_number alone, since an
    // MTEST FO's allocations can span different Prodshades whose stroke numbers may
    // coincidentally collide. Non-MTEST FOs always resolve to one Prodshade, so this is
    // harmless there too -- the frontend only renders it for MTEST-typed FOs.
    const actualStrokeDetails = [...new Map(
      allocations
        .map((a) => (a.packing_order as JsonRecord | null)?.actual_stroke as JsonRecord | null)
        .filter(Boolean)
        .map((s) => {
          const stroke = s as JsonRecord;
          return [`${stroke.stroke_number}|${stroke.prodshade_name ?? ""}`, {
            stroke_number: stroke.stroke_number as string,
            prodshade_name: (stroke.prodshade_name as string | null) ?? null,
          }];
        }),
    ).values()];

    return okResponse({
      data: {
        ...row,
        material: materialMap.get(String(row.material_id ?? "")) ?? null,
        party: customerMap.get(String(row.party_id ?? "")) ?? null,
        items: itemResult.data ?? [],
        allocations,
        actual_stroke_numbers: actualStrokeNumbers,
        actual_stroke_details: actualStrokeDetails,
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_FETCH_FAILED";
    return foErr(req, ctx, code, 500, "Plan feed fetch failed");
  }
}

async function assertPlanFeedItemAccess(
  req: Request,
  ctx: ProdHandlerContext,
  fo: JsonRecord,
  mtestOnly: boolean,
): Promise<Response | null> {
  const companyId = toTrimmedString(fo.company_id);
  try {
    await assertCompanyScope(ctx, companyId);
  } catch {
    return foErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
  }
  if (mtestOnly) return await assertMtestPlanFeed(req, ctx, fo);
  if (!(await canMaintainCompanyResource(ctx, companyId, "PROD_PLAN_FEED", "EDIT"))) {
    return foErr(req, ctx, "PROD_PLAN_FEED_ACCESS_DENIED", 403, "You do not have Plan Feed edit access for this company.");
  }
  return null;
}

// Item endpoints are deliberately split by route so QA's MTEST-only grant cannot
// be used to mutate a normal FO through a direct API call.
async function addPlanFeedItem(req: Request, ctx: ProdHandlerContext, mtestOnly: boolean): Promise<Response> {
  try {
    const planFeedId = getIdFromPath(req);
    const body = await parseBody(req);
    const { data: fo, error: foError } = await serviceRoleClient.schema("erp_production").from("plan_feed")
      .select("id, company_id, party_id, status").eq("id", planFeedId).maybeSingle();
    if (foError || !fo) return foErr(req, ctx, "PROD_PLAN_FEED_NOT_FOUND", 404, "FO not found");
    const accessError = await assertPlanFeedItemAccess(req, ctx, fo as JsonRecord, mtestOnly);
    if (accessError) return accessError;
    if (toUpperTrimmedString((fo as JsonRecord).status) !== "ACTIVE") return foErr(req, ctx, "PROD_PLAN_FEED_NOT_ACTIVE", 422, "FO is not ACTIVE");
    const materialId = toTrimmedString(body.material_id) || null;
    const sku = toTrimmedString(body.sku);
    const qty = parsePositiveNumber(body.ordered_qty_kg);
    const description = toTrimmedString(body.description);
    const packQty = parsePositiveInt(body.pack_qty);
    if ((!materialId && !sku) || !description || !qty || !packQty) {
      return foErr(req, ctx, "PROD_PLAN_FEED_ITEM_INVALID", 400, "Complete every FO item field except ordered_stroke_number");
    }
    const { data, error } = await serviceRoleClient.schema("erp_production").from("plan_feed_item").insert({
      plan_feed_id: planFeedId, material_id: materialId, sku: sku || null, description,
      ordered_qty_kg: qty, pack_qty: packQty, ordered_stroke_number: toTrimmedString(body.ordered_stroke_number) || null,
      created_by: ctx.auth_user_id, last_updated_by: ctx.auth_user_id,
    }).select("*").single();
    if (error || !data) throw new Error("PROD_PLAN_FEED_ITEM_CREATE_FAILED");
    return createdOkResponse(data, ctx.request_id, req);
  } catch (err) { return foErr(req, ctx, err instanceof Error ? err.message : "PROD_PLAN_FEED_ITEM_CREATE_FAILED", 500, "Unable to add FO item"); }
}

async function mutatePlanFeedItem(req: Request, ctx: ProdHandlerContext, remove: boolean, mtestOnly: boolean): Promise<Response> {
  try {
    const parts = new URL(req.url).pathname.split("/").filter(Boolean);
    const planFeedId = parts[3] ?? "";
    const itemId = parts[5] ?? "";
    const { data: fo } = await serviceRoleClient.schema("erp_production").from("plan_feed").select("company_id, party_id, status").eq("id", planFeedId).maybeSingle();
    if (!fo) return foErr(req, ctx, "PROD_PLAN_FEED_NOT_FOUND", 404, "FO not found");
    const accessError = await assertPlanFeedItemAccess(req, ctx, fo as JsonRecord, mtestOnly);
    if (accessError) return accessError;
    if (toUpperTrimmedString((fo as JsonRecord).status) !== "ACTIVE") return foErr(req, ctx, "PROD_PLAN_FEED_NOT_ACTIVE", 422, "FO is not ACTIVE");
    const { data: item } = await serviceRoleClient.schema("erp_production").from("plan_feed_item").select("id").eq("id", itemId).eq("plan_feed_id", planFeedId).maybeSingle();
    if (!item) return foErr(req, ctx, "PROD_PLAN_FEED_ITEM_NOT_FOUND", 404, "FO item not found");
    if (remove) {
      const itemCountResult = await serviceRoleClient.schema("erp_production").from("plan_feed_item")
        .select("id", { count: "exact", head: true }).eq("plan_feed_id", planFeedId) as unknown as { count: number | null; error: unknown };
      const { count: itemCount, error: itemCountError } = itemCountResult;
      if (itemCountError) throw new Error("PROD_PLAN_FEED_ITEM_FETCH_FAILED");
      if ((itemCount ?? 0) <= 1) return foErr(req, ctx, "PROD_PLAN_FEED_ITEM_LAST_DELETE_BLOCKED", 422, "An FO must retain at least one item line.");
      const [poCountResult, mapCountResult] = await Promise.all([
        serviceRoleClient.schema("erp_production").from("plan_feed_packing_order_allocation").select("id", { count: "exact", head: true }).eq("plan_feed_item_id", itemId),
        serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation").select("id", { count: "exact", head: true }).eq("plan_feed_item_id", itemId).eq("status", "ACTIVE"),
      ]) as unknown as [{ count: number | null }, { count: number | null }];
      const poCount = poCountResult.count;
      const mapCount = mapCountResult.count;
      if ((poCount ?? 0) || (mapCount ?? 0)) return foErr(req, ctx, "PROD_PLAN_FEED_ITEM_IN_USE", 409, "Release Packing PO and SO Map allocations before deleting this FO item.");
      await serviceRoleClient.schema("erp_production").from("plan_feed_item").delete().eq("id", itemId);
      return okResponse({ id: itemId, deleted: true }, ctx.request_id, req);
    }
    const body = await parseBody(req);
    const qty = parsePositiveNumber(body.ordered_qty_kg);
    const description = toTrimmedString(body.description);
    const packQty = parsePositiveInt(body.pack_qty);
    if (!description || !qty || !packQty) {
      return foErr(req, ctx, "PROD_PLAN_FEED_ITEM_INVALID", 400, "Complete every FO item field except ordered_stroke_number");
    }
    const [{ data: soMapRows, error: soMapError }, { data: packingRows, error: packingError }] = await Promise.all([
      serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation")
        .select("allocated_qty").eq("plan_feed_item_id", itemId).eq("status", "ACTIVE"),
      serviceRoleClient.schema("erp_production").from("plan_feed_packing_order_allocation")
        .select("allocated_qty_kg").eq("plan_feed_item_id", itemId),
    ]);
    if (soMapError || packingError) throw new Error("PROD_PLAN_FEED_ITEM_USAGE_LOOKUP_FAILED");
    const committedQty = Math.max(
      ((soMapRows ?? []) as JsonRecord[]).reduce((sum, row) => sum + Number(row.allocated_qty ?? 0), 0),
      ((packingRows ?? []) as JsonRecord[]).reduce((sum, row) => sum + Number(row.allocated_qty_kg ?? 0), 0),
    );
    if (qty + QTY_TOL < committedQty) return foErr(req, ctx, "PROD_PLAN_FEED_ITEM_QTY_BELOW_COMMITTED", 422,
      `Item has ${committedQty} KG committed in Packing PO/SO Map and cannot be reduced below that.`);
    const { error } = await serviceRoleClient.schema("erp_production").from("plan_feed_item").update({
      description, ordered_qty_kg: qty, pack_qty: packQty,
      ordered_stroke_number: toTrimmedString(body.ordered_stroke_number) || null, last_updated_by: ctx.auth_user_id, last_updated_at: new Date().toISOString(),
    }).eq("id", itemId);
    if (error) throw new Error("PROD_PLAN_FEED_ITEM_UPDATE_FAILED");
    return okResponse({ id: itemId }, ctx.request_id, req);
  } catch (err) { return foErr(req, ctx, err instanceof Error ? err.message : "PROD_PLAN_FEED_ITEM_MUTATE_FAILED", 500, "Unable to update FO item"); }
}
export const addPlanFeedItemHandler = (req: Request, ctx: ProdHandlerContext) => addPlanFeedItem(req, ctx, false);
export const updatePlanFeedItemHandler = (req: Request, ctx: ProdHandlerContext) => mutatePlanFeedItem(req, ctx, false, false);
export const deletePlanFeedItemHandler = (req: Request, ctx: ProdHandlerContext) => mutatePlanFeedItem(req, ctx, true, false);
export const addMtestPlanFeedItemHandler = (req: Request, ctx: ProdHandlerContext) => addPlanFeedItem(req, ctx, true);
export const updateMtestPlanFeedItemHandler = (req: Request, ctx: ProdHandlerContext) => mutatePlanFeedItem(req, ctx, false, true);
export const deleteMtestPlanFeedItemHandler = (req: Request, ctx: ProdHandlerContext) => mutatePlanFeedItem(req, ctx, true, true);

// POST /api/production/plan-feed
export async function createPlanFeedHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);

    const companyId = toTrimmedString(body.company_id);
    const foNumber = toTrimmedString(body.fo_number);
    const partyId = toTrimmedString(body.party_id) || null;
    const customerAddressId = toTrimmedString(body.customer_address_id) || null;
    const partyName = toTrimmedString(body.party_name);
    const sku = toTrimmedString(body.sku);
    const materialId = toTrimmedString(body.material_id) || null;
    const description = toTrimmedString(body.description);
    const orderedQtyKg = parsePositiveNumber(body.ordered_qty_kg);
    const packQty = parsePositiveInt(body.pack_qty);
    const orderDate = toTrimmedString(body.order_date);
    const scheduledDeliveryDate = toTrimmedString(body.scheduled_delivery_date) || null;
    const orderedStrokeNumber = toTrimmedString(body.ordered_stroke_number) || null;

    if (!companyId || !foNumber || !partyId || !partyName || (!sku && !materialId) || !description
      || !orderedQtyKg || !packQty || !orderDate || !scheduledDeliveryDate) {
      return foErr(req, ctx, "PROD_PLAN_FEED_INVALID", 400,
        "Complete every FO field except ordered_stroke_number");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return foErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!isManualDocumentDateWithinWindow(orderDate) || (scheduledDeliveryDate && !isManualDocumentDateWithinWindow(scheduledDeliveryDate))) {
      return foErr(req, ctx, "PROD_PLAN_FEED_DATE_OUTSIDE_ALLOWED_WINDOW", 400, MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE);
    }
    if (!customerAddressId) {
      return foErr(req, ctx, "PROD_PLAN_FEED_SHIP_TO_REQUIRED", 422, "Select an active Ship-To address before creating this FO.");
    }
    const { data: address, error: addressError } = await serviceRoleClient
      .schema("erp_master").from("customer_address").select("customer_id").eq("id", customerAddressId).eq("status", "ACTIVE").maybeSingle();
    if (addressError || !address || toTrimmedString((address as JsonRecord).customer_id) !== partyId) {
      return foErr(req, ctx, "PROD_PLAN_FEED_ADDRESS_PARTY_MISMATCH", 422, "Selected address must be an active address of the selected party.");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_production").from("plan_feed")
      .insert({
        company_id: companyId,
        fo_number: foNumber,
        party_id: partyId,
        customer_address_id: customerAddressId,
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
    // Keep the legacy header fields and the new item-line model in lockstep.
    // A newly created FO always starts with its first item; later items are
    // added through the FO item-line flow.
    const { error: itemError } = await serviceRoleClient.schema("erp_production").from("plan_feed_item").insert({
      plan_feed_id: (data as JsonRecord).id,
      material_id: materialId,
      sku: sku || null,
      description: description || null,
      ordered_qty_kg: orderedQtyKg,
      pack_qty: packQty ?? null,
      ordered_stroke_number: orderedStrokeNumber,
      created_by: ctx.auth_user_id,
      last_updated_by: ctx.auth_user_id,
    });
    if (itemError) throw new Error("PROD_PLAN_FEED_ITEM_CREATE_FAILED");
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
async function updatePlanFeed(req: Request, ctx: ProdHandlerContext, mtestOnly: boolean): Promise<Response> {
  try {
    const id = getIdFromPath(req);
    if (!id) return foErr(req, ctx, "PROD_PLAN_FEED_ID_MISSING", 400, "FO ID required");

    const { data: existing, error: fetchErr } = await serviceRoleClient
      .schema("erp_production").from("plan_feed")
      .select("id, status, company_id, party_id, customer_address_id, sku, material_id, description, ordered_qty_kg, pack_qty, order_date, scheduled_delivery_date").eq("id", id).maybeSingle();

    if (fetchErr) throw new Error("PROD_PLAN_FEED_FETCH_FAILED");
    if (!existing) return foErr(req, ctx, "PROD_PLAN_FEED_NOT_FOUND", 404, "FO not found");
    try {
      await assertCompanyScope(ctx, (existing as JsonRecord).company_id as string);
    } catch {
      return foErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if ((existing as JsonRecord).status === "CANCELLED") {
      return foErr(req, ctx, "PROD_PLAN_FEED_CANCELLED", 422, "Cancelled FO cannot be edited");
    }

    if (mtestOnly) {
      const accessError = await assertMtestPlanFeed(req, ctx, existing as JsonRecord);
      if (accessError) return accessError;
    }

    const body = await parseBody(req);
    const current = existing as JsonRecord;
    const effectiveSku = body.sku !== undefined ? toTrimmedString(body.sku) : toTrimmedString(current.sku);
    const effectiveMaterialId = body.material_id !== undefined ? toTrimmedString(body.material_id) : toTrimmedString(current.material_id);
    const effectiveDescription = body.description !== undefined ? toTrimmedString(body.description) : toTrimmedString(current.description);
    const effectiveOrderedQty = body.ordered_qty_kg !== undefined ? parsePositiveNumber(body.ordered_qty_kg) : parsePositiveNumber(current.ordered_qty_kg);
    const effectivePackQty = body.pack_qty !== undefined ? parsePositiveInt(body.pack_qty) : parsePositiveInt(current.pack_qty);
    const effectiveOrderDate = body.order_date !== undefined ? toTrimmedString(body.order_date) : toTrimmedString(current.order_date);
    const effectiveDeliveryDate = body.scheduled_delivery_date !== undefined
      ? toTrimmedString(body.scheduled_delivery_date)
      : toTrimmedString(current.scheduled_delivery_date);
    if ((!effectiveSku && !effectiveMaterialId) || !effectiveDescription || !effectiveOrderedQty || !effectivePackQty
      || !effectiveOrderDate || !effectiveDeliveryDate) {
      return foErr(req, ctx, "PROD_PLAN_FEED_INVALID", 422, "Complete every FO field except ordered_stroke_number");
    }
    if (body.customer_address_id === undefined && (body.party_id !== undefined || !(existing as JsonRecord).customer_address_id)) {
      return foErr(req, ctx, "PROD_PLAN_FEED_SHIP_TO_REQUIRED", 422, "Select an active Ship-To address before saving this FO.");
    }
    // Found live 2026-08-31: this used to also fire on ordered_qty_kg/pack_qty,
    // contradicting the design comment above ("Party, Ordered Qty, Pack Qty,
    // dates, Ordered Stroke) is always editable") -- and the frontend's save
    // payload always includes both fields on every save regardless of what the
    // user actually changed, so ANY edit (even just Party/Ship-To) on an
    // allocated FO was silently blocked with PROD_PLAN_FEED_ITEM_LOCKED. Only
    // SKU/material/Description identify WHAT is being produced, which is the
    // only thing that can't change once Packing PO(s) are physically
    // allocated against it -- qty/dates/stroke are decoupled from that.
    const touchesItemFields = body.sku !== undefined || body.material_id !== undefined || body.description !== undefined;

    if (touchesItemFields) {
      const { count } = await serviceRoleClient
        .schema("erp_production").from("plan_feed_packing_order_allocation")
        .select("id", { count: "exact", head: true })
        .eq("plan_feed_id", id) as { count?: number };
      if ((count ?? 0) > 0) {
        return foErr(req, ctx, "PROD_PLAN_FEED_ITEM_LOCKED", 422,
          "SKU, description, ordered quantity and pack quantity are locked — Packing PO(s) already allocated to this FO");
      }
    }

    const updates: JsonRecord = { last_updated_at: new Date().toISOString(), last_updated_by: ctx.auth_user_id };

    // Found live 2026-08-19 (business owner, Total Table still showing the
    // OLD customer after Edit FO changed the party): party_name is a
    // denormalized display column on plan_feed, and this handler only ever
    // wrote it when the request body happened to include party_name
    // explicitly -- PlanFeedPage.jsx's Edit-FO save never sent it (only
    // party_id), so the column silently went stale the moment someone
    // switched the party on an existing FO. Resolving party_name here from
    // the real party_id whenever it changes makes this column impossible to
    // desync from party_id, regardless of what any future caller sends.
    if (body.party_id !== undefined) {
      const newPartyId = toTrimmedString(body.party_id) || null;
      if (mtestOnly) {
        const newParty = newPartyId ? (await getCustomerMapByIds([newPartyId])).get(newPartyId) : undefined;
        if (!isMtestParty(newParty)) {
          return foErr(req, ctx, "PROD_PLAN_FEED_MTEST_ONLY", 422, "An MTEST FO must remain assigned to an MTEST party.");
        }
      }
      updates.party_id = newPartyId;
      // An address belongs to exactly one party. Do not carry an old party's
      // destination forward when the FO party changes.
      if (body.customer_address_id === undefined) updates.customer_address_id = null;
      if (newPartyId) {
        const customerMap = await getCustomerMapByIds([newPartyId]);
        const resolvedName = toTrimmedString(customerMap.get(newPartyId)?.customer_name);
        if (resolvedName) updates.party_name = resolvedName;
      }
    }
    if (body.party_name !== undefined && updates.party_name === undefined) {
      updates.party_name = toTrimmedString(body.party_name);
    }
    if (body.customer_address_id !== undefined) {
      const customerAddressId = toTrimmedString(body.customer_address_id) || null;
      const effectivePartyId = toTrimmedString(updates.party_id ?? (existing as JsonRecord).party_id);
      if (!customerAddressId) {
        return foErr(req, ctx, "PROD_PLAN_FEED_SHIP_TO_REQUIRED", 422, "Select an active Ship-To address before saving this FO.");
      }
      const { data: address, error: addressError } = await serviceRoleClient
        .schema("erp_master").from("customer_address").select("customer_id").eq("id", customerAddressId).eq("status", "ACTIVE").maybeSingle();
      if (addressError || !address || toTrimmedString((address as JsonRecord).customer_id) !== effectivePartyId) {
        return foErr(req, ctx, "PROD_PLAN_FEED_ADDRESS_PARTY_MISMATCH", 422, "Selected address must be an active address of the selected party.");
      }
      updates.customer_address_id = customerAddressId;
    }
    if (body.sku !== undefined) updates.sku = toTrimmedString(body.sku) || null;
    if (body.material_id !== undefined) updates.material_id = toTrimmedString(body.material_id) || null;
    if (body.description !== undefined) updates.description = toTrimmedString(body.description) || null;
    if (body.ordered_qty_kg !== undefined) updates.ordered_qty_kg = parsePositiveNumber(body.ordered_qty_kg);
    if (body.pack_qty !== undefined) updates.pack_qty = parsePositiveInt(body.pack_qty);
    if (body.order_date !== undefined) {
      const orderDate = toTrimmedString(body.order_date);
      if (!isManualDocumentDateWithinWindow(orderDate)) {
        return foErr(req, ctx, "PROD_PLAN_FEED_DATE_OUTSIDE_ALLOWED_WINDOW", 400, MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE);
      }
      updates.order_date = orderDate;
    }
    if (body.scheduled_delivery_date !== undefined) {
      const scheduledDeliveryDate = toTrimmedString(body.scheduled_delivery_date);
      if (scheduledDeliveryDate && !isManualDocumentDateWithinWindow(scheduledDeliveryDate)) {
        return foErr(req, ctx, "PROD_PLAN_FEED_DATE_OUTSIDE_ALLOWED_WINDOW", 400, MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE);
      }
      updates.scheduled_delivery_date = scheduledDeliveryDate || null;
    }
    if (body.ordered_stroke_number !== undefined) {
      updates.ordered_stroke_number = toTrimmedString(body.ordered_stroke_number) || null;
    }

    const { error } = await serviceRoleClient.schema("erp_production").from("plan_feed")
      .update(updates).eq("id", id);
    if (error) throw new Error("PROD_PLAN_FEED_UPDATE_FAILED");

    // The original FO create form produces one header and one item line.
    // Keep that legacy single-line model aligned after Edit FO, while leaving
    // multi-line FOs to their dedicated item-line editor.
    const { data: foItems, error: foItemsError } = await serviceRoleClient
      .schema("erp_production").from("plan_feed_item")
      .select("id").eq("plan_feed_id", id).limit(2);
    if (foItemsError) throw new Error("PROD_PLAN_FEED_ITEM_FETCH_FAILED");
    if ((foItems ?? []).length === 1) {
      const itemUpdates: JsonRecord = {
        description: effectiveDescription,
        ordered_qty_kg: effectiveOrderedQty,
        pack_qty: effectivePackQty,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      };
      if (body.sku !== undefined) itemUpdates.sku = effectiveSku || null;
      if (body.material_id !== undefined) itemUpdates.material_id = effectiveMaterialId || null;
      if (body.ordered_stroke_number !== undefined) {
        itemUpdates.ordered_stroke_number = toTrimmedString(body.ordered_stroke_number) || null;
      }
      const { error: itemUpdateError } = await serviceRoleClient
        .schema("erp_production").from("plan_feed_item")
        .update(itemUpdates).eq("id", (foItems![0] as JsonRecord).id);
      if (itemUpdateError) throw new Error("PROD_PLAN_FEED_ITEM_UPDATE_FAILED");
    }
    return okResponse({ id }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_UPDATE_FAILED";
    return foErr(req, ctx, code, 500, "Plan feed update failed");
  }
}

export async function updatePlanFeedHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  return await updatePlanFeed(req, ctx, false);
}

// Dedicated route because the pipeline ACL gate is static and cannot inspect the FO's party type.
export async function updateMtestPlanFeedHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  return await updatePlanFeed(req, ctx, true);
}

// POST /api/production/plan-feed/:id/cancel
// §83.18-REVISED base rule still holds: cancel deletes every allocation row for this FO
// (Packing POs become free/unallocated again, never themselves cancelled or altered)
// then marks the FO CANCELLED. 2026-08-08 extension: if this FO is already mapped to
// Sales Order lines, those links are also cleared on cancel -- but ONLY if no active
// Delivery Order still exists against those SO lines. Once a DO exists, user must cancel
// that DO first; only then can the FO be cancelled and the SO unlinked.
export async function cancelPlanFeedHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const id = getIdFromPath(req);
    if (!id) return foErr(req, ctx, "PROD_PLAN_FEED_ID_MISSING", 400, "FO ID required");

    const { data: existing } = await serviceRoleClient
      .schema("erp_production").from("plan_feed")
      .select("id, status, company_id").eq("id", id).maybeSingle();
    if (!existing) return foErr(req, ctx, "PROD_PLAN_FEED_NOT_FOUND", 404, "FO not found");
    try {
      await assertCompanyScope(ctx, (existing as JsonRecord).company_id as string);
    } catch {
      return foErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if ((existing as JsonRecord).status === "CANCELLED") {
      return foErr(req, ctx, "PROD_PLAN_FEED_ALREADY_CANCELLED", 409, "Already cancelled");
    }

    const soLineIds = await getMappedSalesOrderLineIds(id);
    const blockingDcs = await getBlockingDeliveryOrdersForSoLines(soLineIds);
    if (blockingDcs.length > 0) {
      const dcNumbers = blockingDcs
        .map((row) => toTrimmedString(row.dc_number))
        .filter(Boolean)
        .slice(0, 5);
      const suffix = blockingDcs.length > 5 ? " ..." : "";
      return foErr(
        req,
        ctx,
        "PROD_PLAN_FEED_CANCEL_BLOCKED_BY_DO",
        422,
        `Cancel the linked Delivery Order first${dcNumbers.length ? ` (${dcNumbers.join(", ")}${suffix})` : ""}.`,
      );
    }

    const { error: deleteAllocError } = await serviceRoleClient
      .schema("erp_production").from("plan_feed_packing_order_allocation")
      .delete().eq("plan_feed_id", id);
    if (deleteAllocError) {
      console.error("[plan_feed.cancelPlanFeed] allocation delete failed:", JSON.stringify(deleteAllocError));
      throw new Error("PROD_PLAN_FEED_CANCEL_FAILED");
    }

    if (soLineIds.length > 0) {
      const { error: soUnmapError } = await serviceRoleClient
        .schema("erp_procurement").from("sales_order_line")
        .update({ plan_feed_id: null, last_updated_at: new Date().toISOString() })
        .in("id", soLineIds);
      if (soUnmapError) {
        console.error("[plan_feed.cancelPlanFeed] sales-order unlink failed:", JSON.stringify(soUnmapError));
        throw new Error("PROD_PLAN_FEED_CANCEL_FAILED");
      }
    }

    const now = new Date().toISOString();
    const { error } = await serviceRoleClient.schema("erp_production").from("plan_feed")
      .update({ status: "CANCELLED", cancelled_by: ctx.auth_user_id, cancelled_at: now, last_updated_at: now, last_updated_by: ctx.auth_user_id })
      .eq("id", id);
    if (error) throw new Error("PROD_PLAN_FEED_CANCEL_FAILED");
    return okResponse({ id, status: "CANCELLED", unmapped_sales_order_line_count: soLineIds.length }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_CANCEL_FAILED";
    return foErr(req, ctx, code, 500, "Plan feed cancel failed");
  }
}

// POST /api/production/plan-feed/:id/reactivate
// 2026-08-08 extension: cancelled FO can be restored to ACTIVE so it becomes
// serviceable again, but no allocations or SO links are auto-restored. User must map
// Packing PO(s) again manually afterwards.
export async function reactivatePlanFeedHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const id = getIdFromPath(req);
    if (!id) return foErr(req, ctx, "PROD_PLAN_FEED_ID_MISSING", 400, "FO ID required");

    const { data: existing } = await serviceRoleClient
      .schema("erp_production").from("plan_feed")
      .select("id, status, company_id").eq("id", id).maybeSingle();
    if (!existing) return foErr(req, ctx, "PROD_PLAN_FEED_NOT_FOUND", 404, "FO not found");
    try {
      await assertCompanyScope(ctx, (existing as JsonRecord).company_id as string);
    } catch {
      return foErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if ((existing as JsonRecord).status !== "CANCELLED") {
      return foErr(req, ctx, "PROD_PLAN_FEED_NOT_CANCELLED", 422, "Only CANCELLED FO can be reactivated");
    }

    const now = new Date().toISOString();
    const { error } = await serviceRoleClient
      .schema("erp_production").from("plan_feed")
      .update({
        status: "ACTIVE",
        cancelled_by: null,
        cancelled_at: null,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id);
    if (error) throw new Error("PROD_PLAN_FEED_REACTIVATE_FAILED");

    return okResponse({ id, status: "ACTIVE" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_REACTIVATE_FAILED";
    return foErr(req, ctx, code, 500, "Plan feed reactivate failed");
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
// §133.9 flagged gap (found 2026-08-28 while designing SO Map, fixed here
// while building it): this FO<->Packing-PO allocation is one of SO Map's
// two upstream sources (the other is the FO's own party/material). SO Map's
// `sales_order_map_allocation` (erp_procurement schema) can consume part of
// an FO's total Packing-PO-linked balance — unmapping or shrinking a
// specific (FO, Packing PO) row here must never let that FO's TOTAL
// Packing-PO-linked qty fall below what SO Map has already committed
// against it, or an already-mapped SO line would silently point at stock
// that no longer traces back to any Packing PO.
async function getFoSoMapConsumedQty(planFeedId: string): Promise<number> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("sales_order_map_allocation")
    .select("allocated_qty")
    .eq("fo_id", planFeedId)
    .eq("status", "ACTIVE");
  if (error) throw new Error("PROD_PLAN_FEED_SO_MAP_CONSUMED_LOOKUP_FAILED");
  return ((data ?? []) as JsonRecord[]).reduce((sum, row) => sum + (Number(row.allocated_qty) || 0), 0);
}

async function upsertFoAllocation(req: Request, ctx: ProdHandlerContext, mtestOnly: boolean): Promise<Response> {
  try {
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
      .select("id, status, material_id, company_id, party_id").eq("id", planFeedId).maybeSingle();
    if (foErrRes || !fo) return foErr(req, ctx, "PROD_PLAN_FEED_NOT_FOUND", 404, "FO not found");
    try {
      await assertCompanyScope(ctx, (fo as JsonRecord).company_id as string);
    } catch {
      return foErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if ((fo as JsonRecord).status !== "ACTIVE") {
      return foErr(req, ctx, "PROD_PLAN_FEED_NOT_ACTIVE", 422, "FO is not ACTIVE");
    }
    if (mtestOnly) {
      const accessError = await assertMtestPlanFeed(req, ctx, fo as JsonRecord);
      if (accessError) return accessError;
    } else if (!(await canMaintainCompanyResource(ctx, toTrimmedString((fo as JsonRecord).company_id), "PROD_PLAN_FEED", "EDIT"))) {
      return foErr(req, ctx, "PROD_PLAN_FEED_ACCESS_DENIED", 403, "You do not have Plan Feed edit access for this company.");
    }

    const { data: po, error: poErrRes } = await serviceRoleClient
      .schema("erp_production").from("packing_order")
      .select("id, company_id, status, material_id, actual_qty_kg, planned_qty_kg")
      .eq("id", packingOrderId).maybeSingle();
    if (poErrRes || !po) return foErr(req, ctx, "PROD_PACK_NOT_FOUND", 404, "Packing PO not found");
    if (toTrimmedString((po as JsonRecord).company_id) !== toTrimmedString((fo as JsonRecord).company_id)) {
      return foErr(req, ctx, "PROD_PLAN_FEED_PACKING_PO_COMPANY_MISMATCH", 422,
        "Packing PO must belong to the same company as this FO.");
    }
    const requestedItemId = toTrimmedString(body.plan_feed_item_id);
    if (!requestedItemId && requestedQty > 0) {
      return foErr(req, ctx, "PROD_PLAN_FEED_ITEM_REQUIRED", 400, "Select the FO item that this Packing PO fulfills.");
    }
    const { data: selectedItem, error: selectedItemError } = requestedItemId
      ? await serviceRoleClient.schema("erp_production").from("plan_feed_item")
        .select("id, material_id, sku, ordered_qty_kg").eq("id", requestedItemId).eq("plan_feed_id", planFeedId).maybeSingle()
      : { data: null, error: null };
    if (selectedItemError || (requestedItemId && !selectedItem)) {
      return foErr(req, ctx, "PROD_PLAN_FEED_ITEM_NOT_FOUND", 422, "Selected FO item does not belong to this FO.");
    }
    if (selectedItem && toTrimmedString((selectedItem as JsonRecord).material_id) !== toTrimmedString((po as JsonRecord).material_id) && !confirmMismatch) {
      return foErr(req, ctx, "PROD_PLAN_FEED_ITEM_MATERIAL_MISMATCH", 409,
        "Packing PO SKU differs from the selected FO item — confirm the mismatch to allocate.");
    }
    if (toUpperTrimmedString((po as JsonRecord).status) !== "FINAL") {
      return foErr(req, ctx, "PROD_PLAN_FEED_PACKING_PO_NOT_FINAL", 422,
        "Only a FINAL Packing PO can be allocated to an FO.");
    }

    if (selectedItem) {
      const { data: itemAllocations, error: itemAllocationError } = await serviceRoleClient
        .schema("erp_production").from("plan_feed_packing_order_allocation")
        .select("packing_order_id, allocated_qty_kg")
        .eq("plan_feed_item_id", requestedItemId);
      if (itemAllocationError) throw new Error("PROD_PLAN_FEED_ALLOCATION_FETCH_FAILED");
      const itemAllocatedElsewhere = ((itemAllocations ?? []) as JsonRecord[])
        .filter((row) => String(row.packing_order_id) !== packingOrderId)
        .reduce((sum, row) => sum + (Number(row.allocated_qty_kg) || 0), 0);
      const itemOrderedQty = Number((selectedItem as JsonRecord).ordered_qty_kg) || 0;
      if (itemAllocatedElsewhere + Math.max(0, requestedQty) > itemOrderedQty + QTY_TOL) {
        return foErr(req, ctx, "PROD_PLAN_FEED_ITEM_ALLOCATION_EXCEEDS_ORDERED", 422,
          `Allocation exceeds the selected FO item's ordered quantity (${itemOrderedQty} KG).`);
      }
    }

    // §133.9 floor check — this FO's total Packing-PO-linked qty (across
    // every packing_order_id it's allocated to, not just this one row) must
    // never drop below what SO Map has already committed against this FO.
    const [{ data: foAllocRows, error: foAllocErr }, soMapConsumedQty] = await Promise.all([
      serviceRoleClient
        .schema("erp_production").from("plan_feed_packing_order_allocation")
        .select("packing_order_id, allocated_qty_kg")
        .eq("plan_feed_id", planFeedId),
      getFoSoMapConsumedQty(planFeedId),
    ]);
    if (foAllocErr) throw new Error("PROD_PLAN_FEED_ALLOCATION_FETCH_FAILED");
    const currentTotalForFo = ((foAllocRows ?? []) as JsonRecord[])
      .reduce((sum, row) => sum + (Number(row.allocated_qty_kg) || 0), 0);
    const currentRowQty = ((foAllocRows ?? []) as JsonRecord[])
      .find((row) => String(row.packing_order_id) === packingOrderId)?.allocated_qty_kg ?? 0;
    const newTotalForFo = currentTotalForFo - Number(currentRowQty) + Math.max(0, requestedQty);
    if (newTotalForFo < soMapConsumedQty - QTY_TOL) {
      return foErr(req, ctx, "PROD_PLAN_FEED_ALLOCATION_BELOW_SO_MAP_CONSUMED", 422,
        `This FO already has ${soMapConsumedQty} allocated in SO Map — cannot reduce its total Packing PO allocation below that (would leave ${newTotalForFo}). Unmap the excess in SO Map first.`);
    }

    // Full/partial unmap: qty <= 0 just deletes the row.
    if (requestedQty <= 0) {
      const { error: delError } = await serviceRoleClient
        .schema("erp_production").from("plan_feed_packing_order_allocation")
        .delete().eq("plan_feed_id", planFeedId).eq("packing_order_id", packingOrderId);
      if (delError) throw new Error("PROD_PLAN_FEED_ALLOCATION_UPDATE_FAILED");
      return okResponse({ plan_feed_id: planFeedId, packing_order_id: packingOrderId, allocated_qty_kg: 0 }, ctx.request_id, req);
    }

    const foMaterialIdForSkuCheck = toTrimmedString((selectedItem as JsonRecord | null)?.material_id);
    const poMaterialIdForSkuCheck = toTrimmedString((po as JsonRecord).material_id);
    const [foMaterialMapForSkuCheck, poMaterialMapForSkuCheck] = await Promise.all([
      getMaterialMapByIds([foMaterialIdForSkuCheck]),
      getMaterialMapByIds([poMaterialIdForSkuCheck]),
    ]);
    const foMaterialForSkuCheck = foMaterialMapForSkuCheck.get(foMaterialIdForSkuCheck) ?? null;
    const poMaterialForSkuCheck = poMaterialMapForSkuCheck.get(poMaterialIdForSkuCheck) ?? null;
    const sameVisibleSkuForAllocation =
      resolveEffectiveSkuCode(foMaterialForSkuCheck, toTrimmedString((fo as JsonRecord).sku))
      === resolveEffectiveSkuCode(poMaterialForSkuCheck);
    if (sameVisibleSkuForAllocation && poMaterialIdForSkuCheck) {
      (fo as JsonRecord).material_id = poMaterialIdForSkuCheck;
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
        plan_feed_item_id: requestedItemId || null,
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

export async function upsertFoAllocationHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  return await upsertFoAllocation(req, ctx, false);
}

export async function upsertMtestFoAllocationHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  return await upsertFoAllocation(req, ctx, true);
}

// Read-only self-capability endpoint. The frontend uses this instead of a role/department-name check.
export async function getMtestPlanFeedCapabilityHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const companyId = toTrimmedString(new URL(req.url).searchParams.get("company_id") ?? "");
    if (!companyId) return foErr(req, ctx, "PROD_PLAN_FEED_MTEST_CAPABILITY_INVALID", 400, "company_id required");
    await assertCompanyScope(ctx, companyId);
    const [standard, mtest] = await Promise.all([
      canMaintainCompanyResource(ctx, companyId, "PROD_PLAN_FEED", "EDIT"),
      canMaintainCompanyResource(ctx, companyId, "PROD_MTEST_PLAN_FEED", "EDIT"),
    ]);
    return okResponse({ standard, mtest }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_MTEST_CAPABILITY_FAILED";
    return foErr(req, ctx, code, 500, "Plan Feed capability lookup failed");
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

// GET /api/production/plan-feed/mtest-skus?company_id=
// §131.5 item #1 (2026-08-26 Plan Feed changes, LOCKED) -- when an FO's PO Type is
// MTEST, the SKU field must be restricted to ONLY the 5 generic MTEST sample SKUs
// (§131.4 item #1) -- no ad-hoc/new SKU creation in that context, unlike MTO/HPS/MTS
// where SkuTypeaheadField's free-text path is intentional. Discriminated the same way
// as Pack BOM (§131.4 item #10) and Packing PO's Prodshade+Stroke picker (§131.4 item
// #11): pack_code_master.pack_type = 'MTEST', not bom_required (599/000 also have
// bom_required=false but have real, resolvable Prodshades).
export async function listMtestSkusHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    if (!companyId) return foErr(req, ctx, "PROD_PLAN_FEED_MTEST_SKUS_INVALID", 400, "company_id required");
    await assertCompanyScope(ctx, companyId);

    const { data: extRows, error: extErr } = await serviceRoleClient
      .schema("erp_master").from("material_company_ext")
      .select("material_id")
      .eq("company_id", companyId)
      .eq("status", "ACTIVE");
    if (extErr) {
      console.error("[plan_feed.listMtestSkus] company-ext query failed:", JSON.stringify(extErr));
      throw new Error("PROD_PLAN_FEED_MTEST_SKUS_FAILED");
    }
    const materialIds = [...new Set(((extRows ?? []) as JsonRecord[]).map((r) => String(r.material_id ?? "")).filter(Boolean))];
    if (materialIds.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    const skuRows = await fetchInChunks<JsonRecord>(materialIds, (idChunk) =>
      serviceRoleClient.schema("erp_master").from("material_master")
        .select("id, pace_code, external_code, material_name, document_name, pack_code, status")
        .in("id", idChunk)
        .eq("material_type", "FG")
        .eq("status", "ACTIVE"));
    if (skuRows.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    const packCodes = [...new Set(skuRows.map((s) => toTrimmedString(s.pack_code)).filter(Boolean))];
    const { data: packCodeRows, error: packErr } = await serviceRoleClient
      .schema("erp_production").from("pack_code_master")
      .select("pack_code, pack_type")
      .in("pack_code", packCodes);
    if (packErr) {
      console.error("[plan_feed.listMtestSkus] pack-code query failed:", JSON.stringify(packErr));
      throw new Error("PROD_PLAN_FEED_MTEST_SKUS_FAILED");
    }
    const packTypeByCode = new Map(((packCodeRows ?? []) as JsonRecord[]).map((p) => [toTrimmedString(p.pack_code), toUpperTrimmedString(p.pack_type)]));

    const mtestSkus = skuRows.filter((s) => packTypeByCode.get(toTrimmedString(s.pack_code)) === "MTEST");
    return okResponse({ data: mtestSkus }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PLAN_FEED_MTEST_SKUS_FAILED";
    return foErr(req, ctx, code, 500, "MTEST SKU lookup failed");
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

// Free-text SKU fallback (2026-08-06 fix): when a Plan Feed row's SKU has no Material
// Master row yet (material_id null), resolveProdshadeMapForMaterials above returns nothing
// for it -- but the FG naming convention itself still lets us derive the Prodshade. Verified
// against every existing FG SKU in prod: FG external_code = <Prodshade SFG external_code> +
// <3-char pack_code> (e.g. "6766SN80" + "000" = "6766SN80000"). Strip the last 3 characters
// and look that string up as an SFG material's own external_code. Without this, every
// not-yet-mastered SKU falsely reports "NOT IN STROKE MASTER" even when the exact Stroke
// already exists and is APPROVED for that Prodshade.
function deriveSfgCandidateCode(sku: string): string | null {
  const trimmed = sku.trim().toUpperCase();
  if (trimmed.length <= 3) return null;
  return trimmed.slice(0, -3);
}

async function resolveProdshadeIdsFromSkuText(skus: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const candidateCodes = [...new Set(skus.map(deriveSfgCandidateCode).filter((c): c is string => Boolean(c)))];
  if (candidateCodes.length === 0) return map;

  const { data, error } = await serviceRoleClient
    .schema("erp_master").from("material_master")
    .select("id, external_code")
    .eq("material_type", "SFG");
  if (error) {
    console.error("[plan_feed.resolveProdshadeIdsFromSkuText] query failed:", JSON.stringify(error));
    throw new Error("PROD_PLAN_FEED_PRODSHADE_LOOKUP_FAILED");
  }
  const byExternalCode = new Map<string, string>();
  for (const row of (data ?? []) as JsonRecord[]) {
    const code = toTrimmedString(row.external_code).toUpperCase();
    if (code) byExternalCode.set(code, String(row.id));
  }
  for (const sku of skus) {
    const candidate = deriveSfgCandidateCode(sku);
    const prodshadeId = candidate ? byExternalCode.get(candidate) : undefined;
    if (prodshadeId) map.set(sku, prodshadeId);
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
        id, company_id, fo_number, party_id, party_name, sku, description, material_id,
        ordered_qty_kg, pack_qty, order_date, scheduled_delivery_date, status,
        ordered_stroke_number
      `)
      .neq("status", "CANCELLED");
    if (companyId) foQuery = foQuery.eq("company_id", companyId);

    const { data: fos, error: foFetchErr } = await foQuery;
    if (foFetchErr) throw new Error("PROD_PLAN_FEED_SUMMARY_FAILED");
    if (!fos || fos.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    const foIds = (fos as JsonRecord[]).map(f => f.id as string);

    // Town lives on the party's own customer_master row, never on plan_feed
    // itself -- resolved live here (not denormalized) so editing a customer's
    // Town from MM04 or Plan Feed's own "Edit Customer" button shows up in
    // this table immediately, no extra sync step.
    const partyIds = [...new Set((fos as JsonRecord[]).map((f) => toTrimmedString(f.party_id)).filter(Boolean))];
    const townRows = await fetchInChunks<JsonRecord>(partyIds, (idChunk) =>
      serviceRoleClient.schema("erp_master").from("customer_master").select("id, town, fo_customer_type").in("id", idChunk));
    const townByPartyId = new Map<string, string | null>();
    // §131.5 item #4 -- the FO's PO Type isn't stored on plan_feed itself, it's always
    // derived from the party's own fo_customer_type (same convention the page's "PO Type
    // (for Party filter)" dropdown already uses) -- resolved here so the Total Table can
    // decide whether to show Prodshade alongside each mapped batch number below.
    const foTypeByPartyId = new Map<string, string | null>();
    for (const row of townRows) {
      townByPartyId.set(String(row.id), (row.town as string | null) ?? null);
      const rawType = toUpperTrimmedString(row.fo_customer_type as string | null);
      foTypeByPartyId.set(String(row.id), rawType === "ZTEST" ? "MTEST" : (rawType || null));
    }

    // §83.18-REVISED: flag rows whose Ordered Stroke isn't (yet) in Stroke Master --
    // live check, so the flag clears itself the moment someone creates that Stroke,
    // no manual update needed here.
    const rowsWithStroke = (fos as JsonRecord[]).filter((f) => toTrimmedString(f.ordered_stroke_number));
    const materialIdsWithStroke = rowsWithStroke.map((f) => String(f.material_id ?? ""));
    const skusWithStrokeNoMaterial = rowsWithStroke
      .filter((f) => !toTrimmedString(f.material_id) && toTrimmedString(f.sku))
      .map((f) => String(f.sku));
    const [prodshadeMap, skuProdshadeMap] = await Promise.all([
      resolveProdshadeMapForMaterials(materialIdsWithStroke),
      resolveProdshadeIdsFromSkuText(skusWithStrokeNoMaterial),
    ]);
    const prodshadeIds = [...new Set([...prodshadeMap.values(), ...skuProdshadeMap.values()])];
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

    // §133.18 -- real dispatched qty per FO, now that SO/DO/Invoice exist
    // (was a hardcoded 0 placeholder before -- §83.18-REVISED's own note).
    // Traced SO Map allocation -> DO line -> POSTED Invoice line, never via
    // Packing PO FINAL status (that would misreport "produced" as "shipped").
    const { data: foAllocationRows, error: foAllocationRowsErr } = await serviceRoleClient
      .schema("erp_procurement").from("sales_order_map_allocation")
      .select("id, fo_id")
      .in("fo_id", foIds);
    if (foAllocationRowsErr) throw new Error("PROD_PLAN_FEED_SUMMARY_FAILED");
    const foByAllocationId = new Map(((foAllocationRows ?? []) as JsonRecord[]).map((row) => [String(row.id), String(row.fo_id)]));
    const allocationIdsForDispatch = [...foByAllocationId.keys()];

    const dispatchedByFo = new Map<string, number>();
    const dispatchDatesByFo = new Map<string, Set<string>>();
    const tallyInvoiceNumbersByFo = new Map<string, Set<string>>();
    const deliveryOrdersByFo = new Map<string, Map<string, { dc_number: string; dc_date: string }>>();
    if (allocationIdsForDispatch.length > 0) {
      const dcLineRows = await fetchInChunks<JsonRecord>(allocationIdsForDispatch, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("delivery_challan_line")
          .select("id, dc_id, so_map_allocation_id").in("so_map_allocation_id", chunk));
      const foByDcLineId = new Map(dcLineRows.map((row) => [String(row.id), foByAllocationId.get(toTrimmedString(row.so_map_allocation_id)) ?? ""]));
      const dcIdByDcLineId = new Map(dcLineRows.map((row) => [String(row.id), toTrimmedString(row.dc_id)]));
      const dcLineIds = [...foByDcLineId.keys()];
      if (dcLineIds.length > 0) {
        const dcIds = [...new Set([...dcIdByDcLineId.values()].filter(Boolean))];
        const deliveryOrderById = new Map<string, JsonRecord>();
        if (dcIds.length > 0) {
          const deliveryOrders = await fetchInChunks<JsonRecord>(dcIds, (chunk) =>
            serviceRoleClient.schema("erp_procurement").from("delivery_challan")
              .select("id, dc_number, dc_date").in("id", chunk));
          for (const deliveryOrder of deliveryOrders) deliveryOrderById.set(String(deliveryOrder.id), deliveryOrder);
        }
        const invoiceLineRows = await fetchInChunks<JsonRecord>(dcLineIds, (chunk) =>
          serviceRoleClient.schema("erp_procurement").from("sales_invoice_line")
            .select("dc_line_id, quantity, sales_invoice:invoice_id(status, tally_invoice_number, tally_invoice_date)").in("dc_line_id", chunk));
        for (const row of invoiceLineRows) {
          const invoice = row.sales_invoice as JsonRecord | null;
          const invoiceStatus = toUpperTrimmedString(invoice?.status);
          if (invoiceStatus !== "POSTED") continue;
          const foId = foByDcLineId.get(toTrimmedString(row.dc_line_id));
          if (!foId) continue;
          dispatchedByFo.set(foId, (dispatchedByFo.get(foId) ?? 0) + Number(row.quantity ?? 0));
          const tallyInvoiceDate = toTrimmedString(invoice?.tally_invoice_date);
          if (tallyInvoiceDate) {
            if (!dispatchDatesByFo.has(foId)) dispatchDatesByFo.set(foId, new Set());
            dispatchDatesByFo.get(foId)?.add(tallyInvoiceDate);
          }
          const tallyInvoiceNumber = toTrimmedString(invoice?.tally_invoice_number);
          if (tallyInvoiceNumber) {
            if (!tallyInvoiceNumbersByFo.has(foId)) tallyInvoiceNumbersByFo.set(foId, new Set());
            tallyInvoiceNumbersByFo.get(foId)?.add(tallyInvoiceNumber);
          }
          const deliveryOrder = deliveryOrderById.get(dcIdByDcLineId.get(toTrimmedString(row.dc_line_id)) ?? "");
          const dcNumber = toTrimmedString(deliveryOrder?.dc_number);
          if (dcNumber) {
            if (!deliveryOrdersByFo.has(foId)) deliveryOrdersByFo.set(foId, new Map());
            deliveryOrdersByFo.get(foId)?.set(dcNumber, {
              dc_number: dcNumber,
              dc_date: toTrimmedString(deliveryOrder?.dc_date),
            });
          }
        }
      }
    }

    const poIds = [...new Set(((allocs ?? []) as JsonRecord[]).map((row) => String(row.packing_order_id ?? "")).filter(Boolean))];
    type BatchInfo = { batch_number: string; prodshade_name: string | null; stroke_number: string | null };
    const batchByPoId = new Map<string, BatchInfo>();
    if (poIds.length > 0) {
      const { data: packingOrders, error: poErr } = await serviceRoleClient
        .schema("erp_production").from("packing_order")
        .select("id, process_order_id")
        .in("id", poIds);
      if (poErr) throw new Error("PROD_PLAN_FEED_SUMMARY_FAILED");

      const processOrderIds = [...new Set(((packingOrders ?? []) as JsonRecord[]).map((row) => String(row.process_order_id ?? "")).filter(Boolean))];
      const batchByProcessOrderId = new Map<string, { batch_number: string; stroke_master_id: string | null }>();
      if (processOrderIds.length > 0) {
        const { data: processOrders, error: procErr } = await serviceRoleClient
          .schema("erp_production").from("process_order")
          .select("id, batch_number, stroke_master_id")
          .in("id", processOrderIds);
        if (procErr) throw new Error("PROD_PLAN_FEED_SUMMARY_FAILED");
        for (const row of (processOrders ?? []) as JsonRecord[]) {
          const batchNumber = toTrimmedString(row.batch_number);
          if (batchNumber) {
            batchByProcessOrderId.set(String(row.id), {
              batch_number: batchNumber,
              stroke_master_id: toTrimmedString(row.stroke_master_id) || null,
            });
          }
        }
      }

      // §131.5 item #4 -- resolve each batch's Prodshade + Stroke so the Total Table can
      // show both alongside the batch number for MTEST FOs (different mapped Packing POs
      // there can belong to entirely different Prodshades, unlike a regular FO's single
      // shared one).
      const strokeMasterIds = [...new Set(
        [...batchByProcessOrderId.values()].map((v) => v.stroke_master_id).filter(Boolean) as string[],
      )];
      const strokeInfoByStrokeId = new Map<string, { prodshade_name: string | null; stroke_number: string | null }>();
      if (strokeMasterIds.length > 0) {
        const { data: strokeRows, error: strokeErr } = await serviceRoleClient
          .schema("erp_production").from("stroke_master")
          .select("id, stroke_number, prodshade_material_id")
          .in("id", strokeMasterIds);
        if (strokeErr) throw new Error("PROD_PLAN_FEED_SUMMARY_FAILED");
        const prodshadeMaterialIds = [...new Set(((strokeRows ?? []) as JsonRecord[]).map((r) => toTrimmedString(r.prodshade_material_id)).filter(Boolean))];
        const prodshadeMaterialMap = await getMaterialMapByIds(prodshadeMaterialIds);
        for (const row of (strokeRows ?? []) as JsonRecord[]) {
          const prod = prodshadeMaterialMap.get(toTrimmedString(row.prodshade_material_id));
          strokeInfoByStrokeId.set(String(row.id), {
            prodshade_name: prod ? (toTrimmedString(prod.material_name) || toTrimmedString(prod.document_name) || null) : null,
            stroke_number: toTrimmedString(row.stroke_number) || null,
          });
        }
      }

      for (const row of (packingOrders ?? []) as JsonRecord[]) {
        const info = batchByProcessOrderId.get(String(row.process_order_id ?? ""));
        if (info) {
          const strokeInfo = info.stroke_master_id ? strokeInfoByStrokeId.get(info.stroke_master_id) : undefined;
          batchByPoId.set(String(row.id), {
            batch_number: info.batch_number,
            prodshade_name: strokeInfo?.prodshade_name ?? null,
            stroke_number: strokeInfo?.stroke_number ?? null,
          });
        }
      }
    }

    // §133.18 -- dispatchedKg/dispatch_status now come from the real chain
    // computed above (§83.18-REVISED's own placeholder note is now stale;
    // wired up once SO/DO/Invoice actually existed). Still never inferred
    // from Packing PO FINAL status -- that would misreport "produced" as
    // "shipped".
    const summaryRows = (fos as JsonRecord[]).map(fo => {
      const foId = fo.id as string;
      const foAllocs = allocByFo[foId] ?? [];
      const allocatedKg = foAllocs.reduce((s, a) => s + (Number(a.allocated_qty_kg) || 0), 0);
      const mappedBatchNumbers = [...new Set(
        foAllocs
          .map((a) => batchByPoId.get(String(a.packing_order_id ?? ""))?.batch_number ?? "")
          .map((batch) => batch.trim())
          .filter(Boolean),
      )];
      const mappedBatchDetails = mappedBatchNumbers.map((batchNumber) => {
        const info = foAllocs
          .map((a) => batchByPoId.get(String(a.packing_order_id ?? "")))
          .find((i) => i?.batch_number === batchNumber);
        return { batch_number: batchNumber, prodshade_name: info?.prodshade_name ?? null, stroke_number: info?.stroke_number ?? null };
      });
      const orderedKg = Number(fo.ordered_qty_kg) || 0;
      const dispatchedKg = Number((dispatchedByFo.get(foId) ?? 0).toFixed(6));
      const strokeNumber = toTrimmedString(fo.ordered_stroke_number);
      const materialId = toTrimmedString(fo.material_id);
      const prodshadeId = materialId
        ? prodshadeMap.get(materialId)
        : skuProdshadeMap.get(String(fo.sku ?? ""));
      const orderedStrokeMissing = Boolean(strokeNumber) &&
        !existingStrokePairs.has(`${fo.company_id}|${prodshadeId}|${strokeNumber}`);
      return {
        id: foId,
        fo_number: fo.fo_number,
        party_name: fo.party_name,
        party_town: fo.party_id ? (townByPartyId.get(toTrimmedString(fo.party_id)) ?? null) : null,
        fo_customer_type: fo.party_id ? (foTypeByPartyId.get(toTrimmedString(fo.party_id)) ?? null) : null,
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
        mapped_batch_numbers: mappedBatchNumbers,
        mapped_batch_details: mappedBatchDetails,
        production_status: computeProductionStatus(orderedKg, allocatedKg),
        dispatched_qty_kg: dispatchedKg,
        dispatch_status: dispatchedKg <= QTY_TOL ? "UNDISPATCHED" : dispatchedKg >= allocatedKg - QTY_TOL ? "FULLY_DISPATCHED" : "PARTIALLY_DISPATCHED",
        // Business rule: a posted invoice's Tally Invoice Date is the actual
        // dispatch date. An FO can be dispatched through multiple invoices.
        dispatch_dates: [...(dispatchDatesByFo.get(foId) ?? new Set<string>())].sort((a, b) => b.localeCompare(a)),
        tally_invoice_numbers: [...(tallyInvoiceNumbersByFo.get(foId) ?? new Set<string>())].sort(),
        delivery_orders: Array.from((deliveryOrdersByFo.get(foId) ?? new Map<string, { dc_number: string; dc_date: string }>()).values())
          .sort((a, b) => b.dc_date.localeCompare(a.dc_date)),
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
