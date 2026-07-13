/*
 * File-ID: 27.7
 * File-Path: supabase/functions/api/_core/production/packing_order.handlers.ts
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Packing Order lifecycle — STANDARD → FINAL | REVERSED.
 *          PM consumption (P261) fires at FINAL.
 * Authority: Backend
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
import { generateGlobalDocNumber } from "./production.utils.ts";

type JsonRecord = Record<string, unknown>;

const VALID_PACK_PO_TYPES = new Set(["PMTO","PHPS","PMTS","PTEST"]);
const RESERVATION_OPEN_STATUSES = ["OPEN", "PARTIAL"];
const PACK_SHORTAGE_ERROR_CODES = new Set([
  "PROD_PACK_SFG_BATCH_SHORTAGE",
  "PROD_PACK_PM_SHORTAGE",
  "PROD_PACK_SFG_BATCH_REQUIRED",
  "PROD_PACK_RESERVATION_SLOC_REQUIRED",
]);

type PackingSfgNeed = {
  materialId: string;
  storageLocationId: string;
  batchNumber: string;
  qty: number;
};

type PackingPmNeed = {
  materialId: string;
  storageLocationId: string;
  qty: number;
};

function todayIso(): string { return new Date().toISOString().slice(0, 10); }

function buildAvailabilityKey(materialId: string, storageLocationId: string): string {
  return `${materialId}::${storageLocationId}`;
}

function buildBatchAvailabilityKey(materialId: string, storageLocationId: string, batchNumber: string): string {
  return `${materialId}::${storageLocationId}::${batchNumber}`;
}

function packErr(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
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

async function getCompanyMapByIds(ids: string[]): Promise<Map<string, JsonRecord>> {
  const companyIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (companyIds.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("companies")
    .select("id, company_code, company_name")
    .in("id", companyIds);
  if (error) throw new Error("PROD_PACK_COMPANY_LOOKUP_FAILED");
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

async function getStorageLocationMapByIds(ids: string[]): Promise<Map<string, JsonRecord>> {
  const slocIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (slocIds.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_master")
    .select("id, code, name")
    .in("id", slocIds);
  if (error) throw new Error("PROD_PACK_SLOC_LOOKUP_FAILED");
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

async function assertPackingSfgBatchAvailability(companyId: string, need: PackingSfgNeed): Promise<void> {
  if (!need.materialId || !need.storageLocationId || need.qty <= 0) return;
  if (!need.batchNumber) throw new Error("PROD_PACK_SFG_BATCH_REQUIRED");

  const rows = await computePackingAvailability(companyId, need, []);
  const row = rows.sfg.get(buildBatchAvailabilityKey(need.materialId, need.storageLocationId, need.batchNumber));
  if (row && row.short > 0) throw new Error("PROD_PACK_SFG_BATCH_SHORTAGE");
}

async function assertPackingCreateAvailability(companyId: string, sfgNeed: PackingSfgNeed, pmNeeds: PackingPmNeed[]): Promise<void> {
  if (!sfgNeed.batchNumber) throw new Error("PROD_PACK_SFG_BATCH_REQUIRED");
  if (!sfgNeed.storageLocationId || pmNeeds.some((need) => !need.storageLocationId)) {
    throw new Error("PROD_PACK_RESERVATION_SLOC_REQUIRED");
  }

  const rows = await computePackingAvailability(companyId, sfgNeed, pmNeeds);
  const sfgRow = rows.sfg.get(buildBatchAvailabilityKey(sfgNeed.materialId, sfgNeed.storageLocationId, sfgNeed.batchNumber));
  if (sfgRow && sfgRow.short > 0) throw new Error("PROD_PACK_SFG_BATCH_SHORTAGE");

  for (const row of rows.pm.values()) {
    if (row.short > 0) throw new Error("PROD_PACK_PM_SHORTAGE");
  }
}

async function computePackingAvailability(
  companyId: string,
  sfgNeed: PackingSfgNeed | null,
  pmNeeds: PackingPmNeed[],
): Promise<{
  sfg: Map<string, { needed_qty: number; available_qty: number; short: number }>;
  pm: Map<string, { needed_qty: number; available_qty: number; short: number }>;
}> {
  const cleanPmNeeds = pmNeeds.filter((need) => need.materialId && need.storageLocationId && need.qty > 0);
  const cleanSfgNeed = sfgNeed && sfgNeed.materialId && sfgNeed.storageLocationId && sfgNeed.batchNumber && sfgNeed.qty > 0
    ? sfgNeed
    : null;
  if (!cleanSfgNeed && cleanPmNeeds.length === 0) {
    return { sfg: new Map(), pm: new Map() };
  }

  const materialIds = [...new Set([
    ...(cleanSfgNeed ? [cleanSfgNeed.materialId] : []),
    ...cleanPmNeeds.map((need) => need.materialId),
  ])];
  const locationIds = [...new Set([
    ...(cleanSfgNeed ? [cleanSfgNeed.storageLocationId] : []),
    ...cleanPmNeeds.map((need) => need.storageLocationId),
  ])];

  const [ledgerResult, reservationResult] = await Promise.all([
    serviceRoleClient
      .schema("erp_inventory")
      .from("stock_ledger")
      .select("material_id, storage_location_id, batch_number, direction, quantity")
      .eq("company_id", companyId)
      .eq("stock_type_code", "UNRESTRICTED")
      .in("material_id", materialIds)
      .in("storage_location_id", locationIds),
    serviceRoleClient
      .schema("erp_production")
      .from("reservation_document")
      .select("material_id, storage_location_id, batch_number, balance_qty")
      .eq("company_id", companyId)
      .in("material_id", materialIds)
      .in("storage_location_id", locationIds)
      .in("status", RESERVATION_OPEN_STATUSES),
  ]);
  if (ledgerResult.error) {
    console.error("[packing_order.computePackingAvailability] ledger query failed:", JSON.stringify(ledgerResult.error));
    throw new Error("PROD_PACK_STOCK_CHECK_FAILED");
  }
  if (reservationResult.error) {
    console.error("[packing_order.computePackingAvailability] reservation query failed:", JSON.stringify(reservationResult.error));
    throw new Error("PROD_PACK_STOCK_CHECK_FAILED");
  }

  const sfgAvailable = new Map<string, number>();
  const pmAvailable = new Map<string, number>();
  const sfgKey = cleanSfgNeed
    ? buildBatchAvailabilityKey(cleanSfgNeed.materialId, cleanSfgNeed.storageLocationId, cleanSfgNeed.batchNumber)
    : "";

  for (const row of (ledgerResult.data ?? []) as JsonRecord[]) {
    const qty = Number(row.quantity ?? 0);
    const signedQty = String(row.direction) === "IN" ? qty : -qty;
    const genericKey = buildAvailabilityKey(String(row.material_id), String(row.storage_location_id));
    pmAvailable.set(genericKey, (pmAvailable.get(genericKey) ?? 0) + signedQty);

    if (cleanSfgNeed) {
      const rowBatch = toTrimmedString(row.batch_number);
      const rowSfgKey = buildBatchAvailabilityKey(String(row.material_id), String(row.storage_location_id), rowBatch);
      if (rowSfgKey === sfgKey) {
        sfgAvailable.set(rowSfgKey, (sfgAvailable.get(rowSfgKey) ?? 0) + signedQty);
      }
    }
  }

  for (const row of (reservationResult.data ?? []) as JsonRecord[]) {
    const qty = Number(row.balance_qty ?? 0);
    const genericKey = buildAvailabilityKey(String(row.material_id), String(row.storage_location_id));
    pmAvailable.set(genericKey, (pmAvailable.get(genericKey) ?? 0) - qty);

    if (cleanSfgNeed) {
      const rowBatch = toTrimmedString(row.batch_number);
      const rowSfgKey = buildBatchAvailabilityKey(String(row.material_id), String(row.storage_location_id), rowBatch);
      if (rowSfgKey === sfgKey) {
        sfgAvailable.set(rowSfgKey, (sfgAvailable.get(rowSfgKey) ?? 0) - qty);
      }
    }
  }

  const sfgRows = new Map<string, { needed_qty: number; available_qty: number; short: number }>();
  if (cleanSfgNeed) {
    const availableQty = sfgAvailable.get(sfgKey) ?? 0;
    sfgRows.set(sfgKey, {
      needed_qty: cleanSfgNeed.qty,
      available_qty: availableQty,
      short: Math.max(0, cleanSfgNeed.qty - availableQty),
    });
  }

  const pmTotals = new Map<string, PackingPmNeed>();
  for (const need of cleanPmNeeds) {
    const key = buildAvailabilityKey(need.materialId, need.storageLocationId);
    const existing = pmTotals.get(key);
    pmTotals.set(key, {
      materialId: need.materialId,
      storageLocationId: need.storageLocationId,
      qty: (existing?.qty ?? 0) + need.qty,
    });
  }

  const pmRows = new Map<string, { needed_qty: number; available_qty: number; short: number }>();
  for (const [key, need] of pmTotals.entries()) {
    const availableQty = pmAvailable.get(key) ?? 0;
    pmRows.set(key, {
      needed_qty: need.qty,
      available_qty: availableQty,
      short: Math.max(0, need.qty - availableQty),
    });
  }

  return { sfg: sfgRows, pm: pmRows };
}

async function postStockMovement(params: {
  documentNumber: string; documentDate: string; postingDate: string;
  movementTypeCode: string; companyId: unknown; storageLocationId: unknown;
  materialId: unknown; quantity: number; baseUomCode: string; unitValue: number;
  stockTypeCode: string; direction: "IN" | "OUT"; postedBy: string; reversalOfId?: string | null;
  batchNumber?: string | null;
}): Promise<{ stock_document_id: string; stock_ledger_id: string }> {
  const { data, error } = await serviceRoleClient.schema("erp_inventory").rpc("post_stock_movement", {
    p_document_number: params.documentNumber, p_document_date: params.documentDate,
    p_posting_date: params.postingDate, p_movement_type_code: params.movementTypeCode,
    p_company_id: params.companyId, p_storage_location_id: params.storageLocationId,
    p_material_id: params.materialId, p_quantity: params.quantity,
    p_base_uom_code: params.baseUomCode, p_unit_value: params.unitValue,
    p_stock_type_code: params.stockTypeCode, p_direction: params.direction,
    p_posted_by: params.postedBy, p_reversal_of_id: params.reversalOfId ?? null,
    p_batch_number: params.batchNumber ?? null,
  });
  if (error || !Array.isArray(data) || data.length === 0) {
    throw new Error(`PROD_PACK_STOCK_POST_FAILED: ${params.movementTypeCode}`);
  }
  return data[0] as { stock_document_id: string; stock_ledger_id: string };
}

// GET /api/production/fg-stock-breakdown?material_id=&company_id=
export async function fgStockBreakdownHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const materialId = toTrimmedString(url.searchParams.get("material_id"));
    const companyId = toTrimmedString(url.searchParams.get("company_id")) || toTrimmedString(ctx.context.companyId);
    if (!materialId || !companyId) {
      return packErr(req, ctx, "PROD_FG_STOCK_BREAKDOWN_INVALID", 400, "material_id and company_id required");
    }

    const { data: ledgerRows, error: ledgerErr } = await serviceRoleClient
      .schema("erp_inventory")
      .from("stock_ledger")
      .select("id, stock_document_id, company_id, material_id, batch_number, quantity, movement_type_code, direction")
      .eq("company_id", companyId)
      .eq("material_id", materialId)
      .eq("movement_type_code", "P101")
      .eq("direction", "IN");
    if (ledgerErr) throw new Error("PROD_FG_STOCK_BREAKDOWN_FAILED");

    const ledgers = (ledgerRows ?? []) as JsonRecord[];
    const docIds = [...new Set(ledgers.map((row) => String(row.stock_document_id ?? "")).filter(Boolean))];
    const { data: docRows, error: docErr } = docIds.length
      ? await serviceRoleClient
          .schema("erp_inventory")
          .from("stock_document")
          .select("id, document_number, posting_date")
          .in("id", docIds)
      : { data: [], error: null };
    if (docErr) throw new Error("PROD_FG_STOCK_BREAKDOWN_FAILED");
    const docMap = new Map(((docRows ?? []) as JsonRecord[]).map((doc) => [String(doc.id), doc]));
    const poNumbers = [...new Set([...docMap.values()].map((doc) => String(doc.document_number ?? "")).filter(Boolean))];
    const { data: poRows, error: poErr } = poNumbers.length
      ? await serviceRoleClient
          .schema("erp_production")
          .from("packing_order")
          .select("id, po_number, num_packs, fill_qty_per_pack, actual_qty_kg, process_order_id")
          .in("po_number", poNumbers)
      : { data: [], error: null };
    if (poErr) throw new Error("PROD_FG_STOCK_BREAKDOWN_FAILED");
    const poMap = new Map(((poRows ?? []) as JsonRecord[]).map((po) => [String(po.po_number), po]));
    const [materialMap, companyMap] = await Promise.all([
      getMaterialMapByIds([materialId], "[packing_order.fgStockBreakdown]", "PROD_FG_STOCK_BREAKDOWN_FAILED", "id, pace_code, material_name, external_code"),
      getCompanyMapByIds([companyId]),
    ]);

    const batchMap = new Map<string, JsonRecord[]>();
    for (const ledger of ledgers) {
      const doc = docMap.get(String(ledger.stock_document_id ?? ""));
      const po = poMap.get(String(doc?.document_number ?? ""));
      if (!po) continue;
      const batchNumber = toTrimmedString(ledger.batch_number) || "UNBATCHED";
      if (!batchMap.has(batchNumber)) batchMap.set(batchNumber, []);
      batchMap.get(batchNumber)?.push({
        po_number: po.po_number,
        num_packs: po.num_packs,
        fill_qty_per_pack: po.fill_qty_per_pack,
        quantity: ledger.quantity,
        posting_date: doc?.posting_date ?? null,
      });
    }

    return okResponse({
      material: materialMap.get(materialId) ?? null,
      company: companyMap.get(companyId) ?? null,
      batches: [...batchMap.entries()].map(([batch_number, rows]) => ({
        batch_number,
        quantity: rows.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0),
        packing_orders: rows,
      })),
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_FG_STOCK_BREAKDOWN_FAILED";
    return packErr(req, ctx, code, 500, "FG stock breakdown failed");
  }
}

// GET /api/production/packing-orders?company_id=&process_order_id=&status=&page=&per_page=
export async function listPackingOrdersHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const processOrderId = toTrimmedString(url.searchParams.get("process_order_id") ?? "");
    const planFeedId = toTrimmedString(url.searchParams.get("plan_feed_id") ?? "");
    const status = toUpperTrimmedString(url.searchParams.get("status") ?? "");
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const perPage = Math.min(100, Math.max(10, parseInt(url.searchParams.get("per_page") ?? "20", 10)));

    let query = serviceRoleClient
      .schema("erp_production").from("packing_order")
      .select(`
        id, company_id, po_number, po_type, process_order_id, material_id,
        pack_code_id, fill_qty_per_pack, num_packs, planned_qty_kg, actual_qty_kg,
        status, plan_feed_id, segment_code, created_by, created_at,
        finalized_at, last_updated_at,
        pack_code:pack_code_master!pack_code_id(id, pack_code, pack_name, pack_type),
        process_order:process_order!process_order_id(po_number, batch_number, status)
      `, { count: "exact" })
      .order("created_at", { ascending: false });

    if (companyId) query = query.eq("company_id", companyId);
    if (processOrderId) query = query.eq("process_order_id", processOrderId);
    if (planFeedId) query = query.eq("plan_feed_id", planFeedId);
    if (status) query = query.eq("status", status);

    const { data, error, count } = await ((query as typeof query & {
      range: (from: number, to: number) => typeof query;
    }).range((page - 1) * perPage, page * perPage - 1)) as {
      data: unknown;
      error: unknown;
      count?: number;
    };
    if (error) {
      console.error("[packing_order.listPackingOrders] query failed:", JSON.stringify(error));
      throw new Error("PROD_PACK_LIST_FAILED");
    }

    const rows = (data ?? []) as JsonRecord[];
    const materialMap = await getMaterialMapByIds(
      rows.map((row) => String(row.material_id ?? "")),
      "[packing_order.listPackingOrders]",
      "PROD_PACK_LIST_FAILED",
      "id, pace_code, material_name, shade_code",
    );

    return okResponse({
      data: rows.map((row) => ({
        ...row,
        material: materialMap.get(String(row.material_id ?? "")) ?? null,
      })),
      pagination: { page, per_page: perPage, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / perPage) },
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_LIST_FAILED";
    return packErr(req, ctx, code, 500, "Packing order list failed");
  }
}

// GET /api/production/packing-orders/:id
export async function getPackingOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return packErr(req, ctx, "PROD_PACK_ID_MISSING", 400, "Packing order ID required");

    const { data: po, error } = await serviceRoleClient
      .schema("erp_production").from("packing_order")
      .select(`
        *,
        pack_code:pack_code_master!pack_code_id(id, pack_code, pack_name, pack_type, billing_uom),
        process_order:process_order!process_order_id(id, po_number, batch_number, status, segment_code)
      `)
      .eq("id", id).maybeSingle();

    if (error) {
      console.error("[packing_order.getPackingOrder] query failed:", JSON.stringify(error));
      throw new Error("PROD_PACK_FETCH_FAILED");
    }
    if (!po) return packErr(req, ctx, "PROD_PACK_NOT_FOUND", 404, "Packing order not found");

    const { data: lines, error: lineErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order_line")
      .select(`
        id, line_type, material_id, batch_number, qty_per_pack, total_qty,
        actual_qty, issue_sloc_id, display_order
      `)
      .eq("packing_order_id", id)
      .order("line_type")
      .order("display_order");
    if (lineErr) {
      console.error("[packing_order.getPackingOrder] line query failed:", JSON.stringify(lineErr));
      throw new Error("PROD_PACK_FETCH_FAILED");
    }

    const poRow = po as JsonRecord;
    const lineRows = (lines ?? []) as JsonRecord[];
    const [poMaterialMap, lineMaterialMap, slocMap] = await Promise.all([
      getMaterialMapByIds(
        [String(poRow.material_id ?? "")],
        "[packing_order.getPackingOrder]",
        "PROD_PACK_FETCH_FAILED",
        "id, pace_code, material_name, shade_code",
      ),
      getMaterialMapByIds(
        lineRows.map((line) => String(line.material_id ?? "")),
        "[packing_order.getPackingOrder]",
        "PROD_PACK_FETCH_FAILED",
        "id, pace_code, material_name, base_uom_code",
      ),
      getStorageLocationMapByIds(lineRows.map((line) => String(line.issue_sloc_id ?? ""))),
    ]);

    return okResponse({
      data: {
        ...poRow,
        material: poMaterialMap.get(String(poRow.material_id ?? "")) ?? null,
        lines: lineRows.map((line) => ({
          ...line,
          material: lineMaterialMap.get(String(line.material_id ?? "")) ?? null,
          storage_location: slocMap.get(String(line.issue_sloc_id ?? "")) ?? null,
        })),
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_FETCH_FAILED";
    return packErr(req, ctx, code, 500, "Packing order fetch failed");
  }
}

// POST /api/production/packing-orders
// Creates at STANDARD. Auto-adds SFG line from linked Process Order batch.
export async function createPackingOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const body = await parseBody(req);

    const companyId = toTrimmedString(body.company_id);
    const poType = toUpperTrimmedString(body.po_type);
    const processOrderId = toTrimmedString(body.process_order_id);
    const materialId = toTrimmedString(body.material_id);
    const packCodeId = toTrimmedString(body.pack_code_id);
    const fillQtyPerPack = parsePositiveNumber(body.fill_qty_per_pack);
    const numPacks = parsePositiveInt(body.num_packs);
    const planFeedId = toTrimmedString(body.plan_feed_id) || null;

    if (!companyId || !VALID_PACK_PO_TYPES.has(poType) || !processOrderId || !materialId || !packCodeId) {
      return packErr(req, ctx, "PROD_PACK_INVALID", 400,
        "company_id, po_type, process_order_id, material_id, pack_code_id required");
    }

    // Verify process order exists and is BATCH_STARTED or later
    const { data: procOrder } = await serviceRoleClient
      .schema("erp_production").from("process_order")
      .select("id, status, batch_number, segment_code, material_id, company_id")
      .eq("id", processOrderId).maybeSingle();

    if (!procOrder) return packErr(req, ctx, "PROD_PACK_PROC_ORDER_NOT_FOUND", 404, "Process order not found");
    const procStatus = (procOrder as JsonRecord).status as string;
    if (!["BATCH_STARTED","FINAL","VERIFIED"].includes(procStatus)) {
      return packErr(req, ctx, "PROD_PACK_PROC_ORDER_NOT_READY", 422,
        "Process order must be BATCH_STARTED or later to create Packing Order");
    }

    // Calculate planned qty
    const plannedQtyKg = fillQtyPerPack && numPacks
      ? fillQtyPerPack * numPacks
      : parsePositiveNumber(body.planned_qty_kg) ?? null;
    if (!plannedQtyKg) {
      return packErr(req, ctx, "PROD_PACK_PLANNED_QTY_REQUIRED", 400, "planned_qty_kg or fill_qty_per_pack and num_packs required");
    }

    const { data: bom, error: bomErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom")
      .select(`
        id, company_id, sku_material_id, status,
        lines:pack_bom_line(
          id, line_type, material_id, qty, uom_code, storage_location_id, movement_type_code, is_primary_container, display_order
        )
      `)
      .eq("company_id", companyId)
      .eq("sku_material_id", materialId)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (bomErr) {
      console.error("[packing_order.createPackingOrder] BOM query failed:", JSON.stringify(bomErr));
      throw new Error("PROD_PACK_BOM_LOOKUP_FAILED");
    }
    if (!bom) {
      return packErr(req, ctx, "PROD_PACK_NO_ACTIVE_BOM", 422, "Active Pack BOM is required before creating a Packing PO");
    }
    const bomLines = ((bom as JsonRecord).lines ?? []) as JsonRecord[];
    const outputLine = bomLines.find((line) => String(line.line_type) === "OUTPUT");
    const sfgBomLine = bomLines.find((line) => String(line.line_type) === "SFG");
    const pmBomLines = bomLines.filter((line) => String(line.line_type) === "INPUT");
    if (!outputLine || !sfgBomLine) {
      return packErr(req, ctx, "PROD_PACK_BOM_INCOMPLETE", 422, "Pack BOM must have OUTPUT and SFG lines");
    }

    const { data: packCodeRow } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_code_master")
      .select("id, bom_required")
      .eq("id", packCodeId)
      .maybeSingle();
    const bomRequired = (packCodeRow as JsonRecord | null)?.bom_required !== false;

    const batchNumber = toTrimmedString((procOrder as JsonRecord).batch_number);
    const sfgTotalQty = bomRequired ? (Number(sfgBomLine.qty ?? 0) * (numPacks ?? 1)) : plannedQtyKg;
    const pmReservationNeeds = pmBomLines.map((line) => ({
      materialId: String(line.material_id ?? ""),
      storageLocationId: toTrimmedString(line.storage_location_id),
      qty: bomRequired ? (Number(line.qty ?? 0) * (numPacks ?? 1)) : 0,
    }));
    await assertPackingCreateAvailability(companyId, {
      materialId: String(sfgBomLine.material_id ?? ""),
      storageLocationId: toTrimmedString(sfgBomLine.storage_location_id),
      batchNumber,
      qty: sfgTotalQty,
    }, pmReservationNeeds);

    const poNumber = await generateGlobalDocNumber("PACK_PO");
    const now = new Date().toISOString();

    const { data: packPo, error: insertErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order")
      .insert({
        company_id: companyId,
        po_number: poNumber,
        po_type: poType,
        process_order_id: processOrderId,
        material_id: materialId,
        pack_code_id: packCodeId,
        fill_qty_per_pack: fillQtyPerPack,
        num_packs: numPacks,
        planned_qty_kg: plannedQtyKg,
        status: "STANDARD",
        plan_feed_id: planFeedId,
        segment_code: (procOrder as JsonRecord).segment_code,
        created_by: ctx.auth_user_id,
        created_at: now,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .select("id").single();

    if (insertErr) throw new Error("PROD_PACK_CREATE_FAILED");
    const packPoId = (packPo as JsonRecord).id as string;

    const lineRows = [
      {
        packing_order_id: packPoId,
        line_type: "SFG",
        material_id: sfgBomLine.material_id,
        batch_number: batchNumber,
        qty_per_pack: bomRequired ? parsePositiveNumber(sfgBomLine.qty) : fillQtyPerPack,
        total_qty: sfgTotalQty,
        actual_qty: null,
        issue_sloc_id: sfgBomLine.storage_location_id ?? null,
        display_order: 0,
      },
      {
        packing_order_id: packPoId,
        line_type: "FG",
        material_id: outputLine.material_id,
        batch_number: batchNumber,
        qty_per_pack: bomRequired ? parsePositiveNumber(outputLine.qty) : 1,
        total_qty: plannedQtyKg,
        actual_qty: null,
        issue_sloc_id: outputLine.storage_location_id ?? null,
        display_order: 1,
      },
      ...pmBomLines.map((line, idx) => ({
        packing_order_id: packPoId,
        line_type: "PM",
        material_id: line.material_id,
        batch_number: batchNumber,
        qty_per_pack: parsePositiveNumber(line.qty),
        total_qty: bomRequired ? (Number(line.qty ?? 0) * (numPacks ?? 1)) : 0,
        actual_qty: null,
        issue_sloc_id: line.storage_location_id ?? null,
        display_order: 10 + idx,
      })),
    ];
    const { data: insertedLines, error: lineErr } = await serviceRoleClient
      .schema("erp_production")
      .from("packing_order_line")
      .insert(lineRows)
      .select("id, line_type, material_id, batch_number, total_qty, issue_sloc_id, display_order");
    if (lineErr) throw new Error("PROD_PACK_LINES_CREATE_FAILED");

    const insertedLineRows = (insertedLines ?? []) as JsonRecord[];
    const sfgInsertedLine = insertedLineRows.find((line) => String(line.line_type) === "SFG");
    const pmInsertedLines = insertedLineRows.filter((line) => String(line.line_type) === "PM");
    if (!sfgInsertedLine) throw new Error("PROD_PACK_RESERVATION_CREATE_FAILED");

    const pmBomLineByOrder = new Map(pmBomLines.map((line, idx) => [String(10 + idx), line]));
    const reservationRows: JsonRecord[] = [
      {
        source_type: "PACKING_PO",
        source_id: packPoId,
        source_line_id: sfgInsertedLine.id,
        company_id: companyId,
        material_id: sfgInsertedLine.material_id,
        storage_location_id: toTrimmedString(sfgInsertedLine.issue_sloc_id) || null,
        required_qty: Number(sfgInsertedLine.total_qty ?? 0),
        uom_code: toTrimmedString(sfgBomLine.uom_code) || "KG",
        issued_qty: 0,
        status: "OPEN",
        batch_number: batchNumber,
        created_by: ctx.auth_user_id,
        created_at: now,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: now,
      },
      ...pmInsertedLines.map((line) => {
        const sourceBomLine = pmBomLineByOrder.get(String(line.display_order ?? ""));
        return {
          source_type: "PACKING_PO",
          source_id: packPoId,
          source_line_id: line.id,
          company_id: companyId,
          material_id: line.material_id,
          storage_location_id: toTrimmedString(line.issue_sloc_id) || null,
          required_qty: Number(line.total_qty ?? 0),
          uom_code: toTrimmedString(sourceBomLine?.uom_code) || "KG",
          issued_qty: 0,
          status: "OPEN",
          created_by: ctx.auth_user_id,
          created_at: now,
          last_updated_by: ctx.auth_user_id,
          last_updated_at: now,
        };
      }),
    ];
    const reservationResults = await Promise.all(reservationRows.map((row) =>
      serviceRoleClient
        .schema("erp_production")
        .from("reservation_document")
        .insert(row)
    ));
    const reservationError = reservationResults.find((result) => result.error)?.error;
    if (reservationError) {
      console.error("[packing_order.createPackingOrder] reservation insert failed:", JSON.stringify(reservationError));
      throw new Error("PROD_PACK_RESERVATION_CREATE_FAILED");
    }

    return createdOkResponse({ id: packPoId, po_number: poNumber }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_CREATE_FAILED";
    return packErr(req, ctx, code, PACK_SHORTAGE_ERROR_CODES.has(code) ? 422 : 500, `Packing order create failed: ${err instanceof Error ? err.message : ""}`);
  }
}

// PATCH /api/production/packing-orders/:id/lines
// Update PM lines at STANDARD status.
export async function updatePackingOrderLinesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return packErr(req, ctx, "PROD_PACK_ID_MISSING", 400, "ID required");

    const { data: po } = await serviceRoleClient.schema("erp_production").from("packing_order")
      .select("id, status").eq("id", id).maybeSingle();
    if (!po) return packErr(req, ctx, "PROD_PACK_NOT_FOUND", 404, "Not found");
    if ((po as JsonRecord).status !== "STANDARD") {
      return packErr(req, ctx, "PROD_PACK_STATUS_LOCKED", 422, "Lines editable only at STANDARD status");
    }

    const body = await parseBody(req);
    const pmLines = Array.isArray(body.pm_lines) ? body.pm_lines : [];

    // Remove existing PM lines, keep SFG lines
    await serviceRoleClient.schema("erp_production").from("packing_order_line")
      .delete().eq("packing_order_id", id).eq("line_type", "PM");

    if (pmLines.length > 0) {
      const pmRows = (pmLines as JsonRecord[]).map((l, idx) => ({
        packing_order_id: id,
        line_type: "PM",
        material_id: toTrimmedString(l.material_id),
        batch_number: null,
        qty_per_pack: parsePositiveNumber(l.qty_per_pack),
        total_qty: parsePositiveNumber(l.total_qty) ?? 0,
        actual_qty: null,
        issue_sloc_id: toTrimmedString(l.issue_sloc_id) || null,
        display_order: 10 + idx,
      }));
      const { error } = await serviceRoleClient.schema("erp_production").from("packing_order_line").insert(pmRows);
      if (error) throw new Error("PROD_PACK_LINE_UPDATE_FAILED");
    }

    // Update header if qty changed
    if (body.planned_qty_kg || body.num_packs || body.fill_qty_per_pack) {
      const upd: JsonRecord = { last_updated_at: new Date().toISOString(), last_updated_by: ctx.auth_user_id };
      if (body.planned_qty_kg) upd.planned_qty_kg = parsePositiveNumber(body.planned_qty_kg);
      if (body.num_packs) upd.num_packs = parsePositiveInt(body.num_packs);
      if (body.fill_qty_per_pack) upd.fill_qty_per_pack = parsePositiveNumber(body.fill_qty_per_pack);
      await serviceRoleClient.schema("erp_production").from("packing_order").update(upd).eq("id", id);
    }

    return okResponse({ id }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_LINE_UPDATE_FAILED";
    return packErr(req, ctx, code, 500, "Packing order lines update failed");
  }
}

// POST /api/production/packing-orders/:id/link-fo
// Link or delink a Firm Order to this packing order.
export async function linkFoHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return packErr(req, ctx, "PROD_PACK_ID_MISSING", 400, "ID required");

    const { data: po } = await serviceRoleClient.schema("erp_production").from("packing_order")
      .select("id, status").eq("id", id).maybeSingle();
    if (!po) return packErr(req, ctx, "PROD_PACK_NOT_FOUND", 404, "Not found");
    if ((po as JsonRecord).status === "REVERSED") {
      return packErr(req, ctx, "PROD_PACK_REVERSED", 422, "Cannot modify reversed packing order");
    }

    const body = await parseBody(req);
    const planFeedId = toTrimmedString(body.plan_feed_id) || null;

    if (planFeedId) {
      // Verify FO exists and is ACTIVE
      const { data: fo } = await serviceRoleClient.schema("erp_production").from("plan_feed")
        .select("id, status").eq("id", planFeedId).maybeSingle();
      if (!fo || (fo as JsonRecord).status !== "ACTIVE") {
        return packErr(req, ctx, "PROD_PACK_FO_INVALID", 422, "FO not found or not ACTIVE");
      }
    }

    const { error } = await serviceRoleClient.schema("erp_production").from("packing_order")
      .update({ plan_feed_id: planFeedId, last_updated_at: new Date().toISOString(), last_updated_by: ctx.auth_user_id })
      .eq("id", id);
    if (error) throw new Error("PROD_PACK_LINK_FO_FAILED");

    return okResponse({ id, plan_feed_id: planFeedId }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_LINK_FO_FAILED";
    return packErr(req, ctx, code, 500, "Link FO failed");
  }
}

// POST /api/production/packing-orders/:id/finalize
// Enter actual qty, post PM consumption (P261).
export async function finalizePackingOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return packErr(req, ctx, "PROD_PACK_ID_MISSING", 400, "ID required");

    const { data: po } = await serviceRoleClient.schema("erp_production").from("packing_order")
      .select("*").eq("id", id).maybeSingle();
    if (!po) return packErr(req, ctx, "PROD_PACK_NOT_FOUND", 404, "Not found");
    if ((po as JsonRecord).status !== "STANDARD") {
      return packErr(req, ctx, "PROD_PACK_STATUS_INVALID", 422, "Must be STANDARD to finalize");
    }

    const body = await parseBody(req);
    const actualQtyKg = parsePositiveNumber(body.actual_qty_kg);
    if (!actualQtyKg) {
      return packErr(req, ctx, "PROD_PACK_ACTUAL_QTY_REQUIRED", 400, "actual_qty_kg required");
    }

    // Update actual_qty on each line
    const lineUpdates = Array.isArray(body.lines) ? body.lines : [];
    for (const lu of lineUpdates as JsonRecord[]) {
      const lineId = toTrimmedString(lu.id);
      if (lineId) {
        await serviceRoleClient.schema("erp_production").from("packing_order_line")
          .update({ actual_qty: parsePositiveNumber(lu.actual_qty) ?? 0 })
          .eq("id", lineId).eq("packing_order_id", id);
      }
    }

    const { data: stockLines, error: lineErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order_line")
      .select(`
        id, line_type, material_id, batch_number, actual_qty, total_qty, issue_sloc_id
      `)
      .eq("packing_order_id", id);
    if (lineErr) {
      console.error("[packing_order.finalizePackingOrder] line query failed:", JSON.stringify(lineErr));
      throw new Error("PROD_PACK_FINALIZE_FAILED");
    }

    const poData = po as JsonRecord;
    const today = todayIso();
    const docNumber = poData.po_number as string;

    const { data: segConfig } = await serviceRoleClient
      .schema("erp_production").from("production_segment_location_config")
      .select("pm_sloc_id")
      .eq("company_id", poData.company_id as string)
      .eq("segment_code", poData.segment_code as string)
      .maybeSingle();

    const defaultPmSlocId = (segConfig as JsonRecord | null)?.pm_sloc_id as string | null;
    const lineRows = (stockLines ?? []) as JsonRecord[];
    const materialMap = await getMaterialMapByIds(
      lineRows.map((line) => String(line.material_id ?? "")),
      "[packing_order.finalizePackingOrder]",
      "PROD_PACK_FINALIZE_FAILED",
      "id, base_uom_code",
    );

    const postings = lineRows.map(async (line) => {
      const lineType = String(line.line_type ?? "");
      const qty = Number(line.actual_qty ?? line.total_qty ?? 0);
      if (qty <= 0) return null;
      const slocId = (line.issue_sloc_id || (lineType === "PM" ? defaultPmSlocId : null)) as string | null;
      if (!slocId) throw new Error("PROD_PACK_LINE_SLOC_REQUIRED");
      const mat = materialMap.get(String(line.material_id ?? "")) ?? null;
      const baseUom = (mat?.base_uom_code ?? "KG") as string;
      const movementTypeCode = lineType === "FG" ? "P101" : "P261";
      const direction = lineType === "FG" ? "IN" : "OUT";
      const posting = await postStockMovement({
        documentNumber: docNumber, documentDate: today, postingDate: today,
        movementTypeCode, companyId: poData.company_id,
        storageLocationId: slocId, materialId: line.material_id,
        quantity: qty, baseUomCode: baseUom, unitValue: 0,
        stockTypeCode: "UNRESTRICTED", direction: direction as "IN" | "OUT", postedBy: ctx.auth_user_id,
        batchNumber: (line.batch_number as string | null) ?? null,
      });

      await serviceRoleClient.schema("erp_production").from("packing_order_line")
        .update({ stock_ledger_id: posting.stock_ledger_id })
        .eq("id", line.id as string);
      if (lineType !== "FG") {
        const { error: reservationErr } = await serviceRoleClient
          .schema("erp_production")
          .from("reservation_document")
          .update({
            issued_qty: Number(line.total_qty ?? 0),
            status: "FULLY_ISSUED",
            last_updated_at: new Date().toISOString(),
            last_updated_by: ctx.auth_user_id,
          })
          .eq("source_type", "PACKING_PO")
          .eq("source_id", id)
          .eq("source_line_id", line.id as string);
        if (reservationErr) {
          console.error("[packing_order.finalizePackingOrder] reservation release failed:", JSON.stringify(reservationErr));
          throw new Error("PROD_PACK_RESERVATION_RELEASE_FAILED");
        }
      }
      return { line_id: line.id, movement_type_code: movementTypeCode, stock_ledger_id: posting.stock_ledger_id };
    });
    await Promise.all(postings);

    const now = new Date().toISOString();
    await serviceRoleClient.schema("erp_production").from("packing_order")
      .update({ status: "FINAL", actual_qty_kg: actualQtyKg, total_qty_kg: actualQtyKg, finalized_at: now, finalized_by: ctx.auth_user_id, last_updated_at: now, last_updated_by: ctx.auth_user_id })
      .eq("id", id);

    return okResponse({ id, status: "FINAL", actual_qty_kg: actualQtyKg }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_FINALIZE_FAILED";
    return packErr(req, ctx, code, 500, `Finalize failed: ${err instanceof Error ? err.message : ""}`);
  }
}

// POST /api/production/packing-orders/:id/reverse
export async function reversePackingOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return packErr(req, ctx, "PROD_PACK_ID_MISSING", 400, "ID required");

    const { data: po } = await serviceRoleClient.schema("erp_production").from("packing_order")
      .select("*").eq("id", id).maybeSingle();
    if (!po) return packErr(req, ctx, "PROD_PACK_NOT_FOUND", 404, "Not found");
    const poData = po as JsonRecord;
    if (poData.status === "REVERSED") {
      return packErr(req, ctx, "PROD_PACK_ALREADY_REVERSED", 409, "Already reversed");
    }

    const reverseNow = new Date().toISOString();
    const { error: cancelReservationErr } = await serviceRoleClient
      .schema("erp_production")
      .from("reservation_document")
      .update({
        status: "CANCELLED",
        last_updated_at: reverseNow,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("source_type", "PACKING_PO")
      .eq("source_id", id)
      .in("status", RESERVATION_OPEN_STATUSES);
    if (cancelReservationErr) {
      console.error("[packing_order.reversePackingOrder] reservation cancel failed:", JSON.stringify(cancelReservationErr));
      throw new Error("PROD_PACK_RESERVATION_CANCEL_FAILED");
    }

    if (poData.status === "FINAL") {
      const { data: stockLines, error: lineErr } = await serviceRoleClient
        .schema("erp_production").from("packing_order_line")
        .select(`
          id, line_type, material_id, batch_number, actual_qty, total_qty, issue_sloc_id, stock_ledger_id
        `)
        .eq("packing_order_id", id);
      if (lineErr) {
        console.error("[packing_order.reversePackingOrder] line query failed:", JSON.stringify(lineErr));
        throw new Error("PROD_PACK_REVERSE_FAILED");
      }

      const { data: segConfig } = await serviceRoleClient
        .schema("erp_production").from("production_segment_location_config")
        .select("pm_sloc_id")
        .eq("company_id", poData.company_id as string)
        .eq("segment_code", poData.segment_code as string)
        .maybeSingle();

      const defaultPmSlocId = (segConfig as JsonRecord | null)?.pm_sloc_id as string | null;
      const today = todayIso();
      const revDocNum = `${poData.po_number as string}-REV`;
      const lineRows = (stockLines ?? []) as JsonRecord[];
      const materialMap = await getMaterialMapByIds(
        lineRows.map((line) => String(line.material_id ?? "")),
        "[packing_order.reversePackingOrder]",
        "PROD_PACK_REVERSE_FAILED",
        "id, base_uom_code",
      );

      await Promise.all(lineRows.map(async (line) => {
        if (!line.stock_ledger_id) return null;
        const lineType = String(line.line_type ?? "");
        const qty = Number(line.actual_qty ?? line.total_qty ?? 0);
        if (qty <= 0) return null;
        const slocId = (line.issue_sloc_id || (lineType === "PM" ? defaultPmSlocId : null)) as string | null;
        if (!slocId) throw new Error("PROD_PACK_LINE_SLOC_REQUIRED");
        const mat = materialMap.get(String(line.material_id ?? "")) ?? null;
        const baseUom = (mat?.base_uom_code ?? "KG") as string;
        const movementTypeCode = lineType === "FG" ? "P102" : "P262";
        const direction = lineType === "FG" ? "OUT" : "IN";

        await postStockMovement({
          documentNumber: revDocNum, documentDate: today, postingDate: today,
          movementTypeCode, companyId: poData.company_id,
          storageLocationId: slocId, materialId: line.material_id,
          quantity: qty, baseUomCode: baseUom, unitValue: 0,
          stockTypeCode: "UNRESTRICTED", direction: direction as "IN" | "OUT",
          postedBy: ctx.auth_user_id,
          reversalOfId: (line.stock_ledger_id as string | null) ?? null,
          batchNumber: (line.batch_number as string | null) ?? null,
        });
        return null;
      }));
    }

    await serviceRoleClient.schema("erp_production").from("packing_order")
      .update({
        status: "REVERSED",
        plan_feed_id: null,
        reversed_by: ctx.auth_user_id,
        reversed_at: reverseNow,
        last_updated_at: reverseNow,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id);

    return okResponse({ id, status: "REVERSED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_REVERSE_FAILED";
    return packErr(req, ctx, code, 500, "Reverse failed");
  }
}

// POST /api/production/packing-orders/:id/correct
// Minimal COR6-style append-only correction shape because no Process PO COR6 handler exists to mirror.
export async function correctPackingOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return packErr(req, ctx, "PROD_PACK_ID_MISSING", 400, "ID required");

    const body = await parseBody(req);
    const corrections = Array.isArray(body.lines) ? body.lines as JsonRecord[] : [];
    if (corrections.length === 0) return packErr(req, ctx, "PROD_PACK_CORRECTION_INVALID", 400, "lines required");

    const { data: po } = await serviceRoleClient.schema("erp_production").from("packing_order")
      .select("*").eq("id", id).maybeSingle();
    if (!po) return packErr(req, ctx, "PROD_PACK_NOT_FOUND", 404, "Not found");
    const poData = po as JsonRecord;
    if (poData.status !== "FINAL") {
      return packErr(req, ctx, "PROD_PACK_CORRECTION_STATUS_INVALID", 422, "Packing PO must be FINAL to correct");
    }

    const lineIds = corrections.map((line) => toTrimmedString(line.id)).filter(Boolean);
    const { data: dbLines, error: lineErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order_line")
      .select("id, line_type, material_id, batch_number, actual_qty, total_qty, issue_sloc_id, stock_ledger_id")
      .eq("packing_order_id", id)
      .in("id", lineIds);
    if (lineErr) throw new Error("PROD_PACK_CORRECTION_FAILED");
    const lineMap = new Map(((dbLines ?? []) as JsonRecord[]).map((line) => [String(line.id), line]));

    const { data: segConfig } = await serviceRoleClient
      .schema("erp_production").from("production_segment_location_config")
      .select("pm_sloc_id")
      .eq("company_id", poData.company_id as string)
      .eq("segment_code", poData.segment_code as string)
      .maybeSingle();
    const defaultPmSlocId = (segConfig as JsonRecord | null)?.pm_sloc_id as string | null;
    const materialMap = await getMaterialMapByIds(
      [...lineMap.values()].map((line) => String(line.material_id ?? "")),
      "[packing_order.correctPackingOrder]",
      "PROD_PACK_CORRECTION_FAILED",
      "id, base_uom_code",
    );
    const sfgIncreaseNeeds = new Map<string, PackingSfgNeed>();
    for (const correction of corrections) {
      const line = lineMap.get(toTrimmedString(correction.id));
      if (!line || String(line.line_type ?? "") !== "SFG") continue;
      const newActual = parsePositiveNumber(correction.actual_qty);
      if (!newActual) continue;
      const oldActual = Number(line.actual_qty ?? line.total_qty ?? 0);
      const delta = newActual - oldActual;
      if (delta <= 0) continue;
      const slocId = toTrimmedString(line.issue_sloc_id);
      if (!slocId) throw new Error("PROD_PACK_LINE_SLOC_REQUIRED");
      const batchNumber = toTrimmedString(line.batch_number);
      if (!batchNumber) throw new Error("PROD_PACK_SFG_BATCH_REQUIRED");
      const key = buildBatchAvailabilityKey(String(line.material_id), slocId, batchNumber);
      const existing = sfgIncreaseNeeds.get(key);
      sfgIncreaseNeeds.set(key, {
        materialId: String(line.material_id),
        storageLocationId: slocId,
        batchNumber,
        qty: (existing?.qty ?? 0) + delta,
      });
    }
    await Promise.all([...sfgIncreaseNeeds.values()].map((need) =>
      assertPackingSfgBatchAvailability(String(poData.company_id), need)
    ));

    const today = todayIso();
    const postings = await Promise.all(corrections.map(async (correction) => {
      const line = lineMap.get(toTrimmedString(correction.id));
      if (!line) throw new Error("PROD_PACK_LINE_NOT_FOUND");
      const newActual = parsePositiveNumber(correction.actual_qty);
      if (!newActual) throw new Error("PROD_PACK_CORRECTION_INVALID");
      const oldActual = Number(line.actual_qty ?? line.total_qty ?? 0);
      const delta = newActual - oldActual;
      if (delta === 0) return null;
      const lineType = String(line.line_type ?? "");
      const slocId = (line.issue_sloc_id || (lineType === "PM" ? defaultPmSlocId : null)) as string | null;
      if (!slocId) throw new Error("PROD_PACK_LINE_SLOC_REQUIRED");
      const material = materialMap.get(String(line.material_id ?? "")) ?? {};
      const baseUom = (material.base_uom_code ?? "KG") as string;
      const isIncrease = delta > 0;
      const movementTypeCode = lineType === "FG"
        ? (isIncrease ? "P101" : "P102")
        : (isIncrease ? "P261" : "P262");
      const direction = lineType === "FG"
        ? (isIncrease ? "IN" : "OUT")
        : (isIncrease ? "OUT" : "IN");
      const posting = await postStockMovement({
        documentNumber: poData.po_number as string,
        documentDate: today,
        postingDate: today,
        movementTypeCode,
        companyId: poData.company_id,
        storageLocationId: slocId,
        materialId: line.material_id,
        quantity: Math.abs(delta),
        baseUomCode: baseUom,
        unitValue: 0,
        stockTypeCode: "UNRESTRICTED",
        direction: direction as "IN" | "OUT",
        postedBy: ctx.auth_user_id,
        reversalOfId: !isIncrease ? (line.stock_ledger_id as string | null) ?? null : null,
        batchNumber: (line.batch_number as string | null) ?? null,
      });
      await serviceRoleClient.schema("erp_production").from("packing_order_line")
        .update({ actual_qty: newActual })
        .eq("id", line.id as string);
      return { line_id: line.id, movement_type_code: movementTypeCode, stock_ledger_id: posting.stock_ledger_id };
    }));

    return okResponse({ id, corrections: postings.filter(Boolean) }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_CORRECTION_FAILED";
    return packErr(req, ctx, code, PACK_SHORTAGE_ERROR_CODES.has(code) ? 422 : 500, "Packing order correction failed");
  }
}
