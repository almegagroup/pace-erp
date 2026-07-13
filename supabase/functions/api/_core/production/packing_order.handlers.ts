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
  "PROD_PACK_STOCK_SHORTAGE",
  "PROD_PACK_SFG_BATCH_REQUIRED",
  "PROD_PACK_RESERVATION_SLOC_REQUIRED",
  "PROD_PACK_SFG_BATCH_LOOKUP_FAILED",
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

type PackingAvailabilityPreviewRow = {
  material_id: string;
  storage_location_id: string;
  needed_qty: number;
  available_qty: number;
  short: number;
};

type PackingSfgBatchOption = {
  batch_number: string;
  ledger_qty: number;
  reserved_qty: number;
  available_qty: number;
  process_order_id: string | null;
  source_po_number: string | null;
  source_po_status: string | null;
  machine: JsonRecord | null;
};

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function mapPackingTypeToSourceType(poType: string): string {
  const normalized = toUpperTrimmedString(poType);
  if (normalized === "PMTO") return "MTO";
  if (normalized === "PHPS") return "HPS";
  if (normalized === "PMTS") return "MTS";
  if (normalized === "PTEST") return "ZTEST";
  return "";
}

function mapSourceTypeToPackingType(sourceType: string): string {
  const normalized = toUpperTrimmedString(sourceType);
  if (normalized === "MTO") return "PMTO";
  if (normalized === "HPS") return "PHPS";
  if (normalized === "MTS") return "PMTS";
  if (normalized === "ZTEST" || normalized === "MTEST") return "PTEST";
  return "";
}

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

function parsePackingAvailabilityNeeds(raw: string): PackingPmNeed[] {
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(raw || "[]");
  } catch {
    throw new Error("PROD_PACK_INVALID");
  }
  if (!Array.isArray(parsed)) throw new Error("PROD_PACK_INVALID");
  return (parsed as JsonRecord[]).map((entry) => ({
    materialId: toTrimmedString(entry.material_id),
    storageLocationId: toTrimmedString(entry.storage_location_id),
    qty: Number(entry.qty ?? 0),
  })).filter((entry) => entry.materialId && entry.storageLocationId && Number.isFinite(entry.qty) && entry.qty > 0);
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

async function getMachineMapByIds(ids: string[]): Promise<Map<string, JsonRecord>> {
  const machineIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (machineIds.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("machine_master")
    .select("id, machine_code, machine_name")
    .in("id", machineIds);
  if (error) throw new Error("PROD_PACK_MACHINE_LOOKUP_FAILED");
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

async function resolvePackingSfgBatchOptions(
  companyId: string,
  materialId: string,
  storageLocationId: string,
): Promise<PackingSfgBatchOption[]> {
  if (!companyId || !materialId || !storageLocationId) return [];

  const [ledgerResult, reservationResult] = await Promise.all([
    serviceRoleClient
      .schema("erp_inventory")
      .from("stock_ledger")
      .select("material_id, storage_location_id, batch_number, direction, quantity")
      .eq("company_id", companyId)
      .eq("stock_type_code", "UNRESTRICTED")
      .eq("material_id", materialId)
      .eq("storage_location_id", storageLocationId),
    serviceRoleClient
      .schema("erp_production")
      .from("reservation_document")
      .select("material_id, storage_location_id, batch_number, balance_qty")
      .eq("company_id", companyId)
      .eq("material_id", materialId)
      .eq("storage_location_id", storageLocationId)
      .in("status", RESERVATION_OPEN_STATUSES),
  ]);
  if (ledgerResult.error) {
    console.error("[packing_order.resolvePackingSfgBatchOptions] ledger query failed:", JSON.stringify(ledgerResult.error));
    throw new Error("PROD_PACK_SFG_BATCH_LOOKUP_FAILED");
  }
  if (reservationResult.error) {
    console.error("[packing_order.resolvePackingSfgBatchOptions] reservation query failed:", JSON.stringify(reservationResult.error));
    throw new Error("PROD_PACK_SFG_BATCH_LOOKUP_FAILED");
  }

  const ledgerByBatch = new Map<string, number>();
  for (const row of (ledgerResult.data ?? []) as JsonRecord[]) {
    const batchNumber = toTrimmedString(row.batch_number);
    if (!batchNumber) continue;
    const qty = Number(row.quantity ?? 0);
    const signedQty = String(row.direction) === "IN" ? qty : -qty;
    ledgerByBatch.set(batchNumber, (ledgerByBatch.get(batchNumber) ?? 0) + signedQty);
  }

  const reservedByBatch = new Map<string, number>();
  for (const row of (reservationResult.data ?? []) as JsonRecord[]) {
    const batchNumber = toTrimmedString(row.batch_number);
    if (!batchNumber) continue;
    reservedByBatch.set(batchNumber, (reservedByBatch.get(batchNumber) ?? 0) + Number(row.balance_qty ?? 0));
  }

  const batchNumbers = [...ledgerByBatch.keys()];
  if (batchNumbers.length === 0) return [];

  const { data: batchRows, error: batchErr } = await serviceRoleClient
    .schema("erp_production")
    .from("batch_number_instance")
    .select("batch_number, source_process_order_id")
    .eq("company_id", companyId)
    .eq("prodshade_material_id", materialId)
    .in("batch_number", batchNumbers);
  if (batchErr) {
    console.error("[packing_order.resolvePackingSfgBatchOptions] batch instance query failed:", JSON.stringify(batchErr));
    throw new Error("PROD_PACK_SFG_BATCH_LOOKUP_FAILED");
  }

  const processOrderIds = [...new Set(((batchRows ?? []) as JsonRecord[])
    .map((row) => toTrimmedString(row.source_process_order_id))
    .filter(Boolean))];
  const { data: processRows, error: processErr } = processOrderIds.length
    ? await serviceRoleClient
        .schema("erp_production")
        .from("process_order")
        .select("id, po_number, batch_number, status, machine_id")
        .in("id", processOrderIds)
    : { data: [], error: null };
  if (processErr) {
    console.error("[packing_order.resolvePackingSfgBatchOptions] process order query failed:", JSON.stringify(processErr));
    throw new Error("PROD_PACK_SFG_BATCH_LOOKUP_FAILED");
  }

  const machineIds = [...new Set(((processRows ?? []) as JsonRecord[])
    .map((row) => toTrimmedString(row.machine_id))
    .filter(Boolean))];
  const { data: machineRows, error: machineErr } = machineIds.length
    ? await serviceRoleClient
        .schema("erp_master")
        .from("machine_master")
        .select("id, machine_code, machine_name")
        .in("id", machineIds)
    : { data: [], error: null };
  if (machineErr) {
    console.error("[packing_order.resolvePackingSfgBatchOptions] machine query failed:", JSON.stringify(machineErr));
    throw new Error("PROD_PACK_SFG_BATCH_LOOKUP_FAILED");
  }

  const batchMap = new Map(((batchRows ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.batch_number), row]));
  const processMap = new Map(((processRows ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
  const machineMap = new Map(((machineRows ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));

  return batchNumbers.map((batchNumber) => {
    const batch = batchMap.get(batchNumber);
    const processOrderId = toTrimmedString(batch?.source_process_order_id) || null;
    const processOrder = processOrderId ? processMap.get(processOrderId) ?? null : null;
    const machineId = toTrimmedString(processOrder?.machine_id);
    const ledgerQty = ledgerByBatch.get(batchNumber) ?? 0;
    const reservedQty = reservedByBatch.get(batchNumber) ?? 0;
    return {
      batch_number: batchNumber,
      ledger_qty: ledgerQty,
      reserved_qty: reservedQty,
      available_qty: ledgerQty - reservedQty,
      process_order_id: processOrderId,
      source_po_number: processOrder ? toTrimmedString(processOrder.po_number) || null : null,
      source_po_status: processOrder ? toTrimmedString(processOrder.status) || null : null,
      machine: machineId ? machineMap.get(machineId) ?? null : null,
    };
  }).filter((row) => row.available_qty > 0)
    .sort((a, b) => b.available_qty - a.available_qty || a.batch_number.localeCompare(b.batch_number));
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

async function cleanupPackingOrderAfterCreateFailure(packPoId: string, label: string): Promise<void> {
  if (!packPoId) return;
  const { error } = await serviceRoleClient
    .schema("erp_production")
    .from("packing_order")
    .delete()
    .eq("id", packPoId);
  if (error) {
    console.error(`[packing_order.createPackingOrder] cleanup failed after ${label}:`, JSON.stringify(error));
  }
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

// GET /api/production/packing-orders/availability-preview?company_id=&needs=[]
export async function availabilityPreviewPackingOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    if (!companyId) return packErr(req, ctx, "PROD_PACK_INVALID", 400, "company_id required");

    const needs = parsePackingAvailabilityNeeds(url.searchParams.get("needs") ?? "[]");
    if (needs.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    const availability = await computePackingAvailability(companyId, null, needs);
    const rows: PackingAvailabilityPreviewRow[] = needs.map((need) => {
      const key = buildAvailabilityKey(need.materialId, need.storageLocationId);
      const row = availability.pm.get(key);
      return {
        material_id: need.materialId,
        storage_location_id: need.storageLocationId,
        needed_qty: row?.needed_qty ?? need.qty,
        available_qty: row?.available_qty ?? 0,
        short: row?.short ?? need.qty,
      };
    });
    return okResponse({ data: rows }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_STOCK_CHECK_FAILED";
    return packErr(req, ctx, code, code === "PROD_PACK_INVALID" ? 400 : 500, "Packing availability preview failed");
  }
}

// GET /api/production/packing-orders/sfg-batches?company_id=&material_id=&storage_location_id=
export async function listPackingSfgBatchOptionsHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const materialId = toTrimmedString(url.searchParams.get("material_id") ?? "");
    const storageLocationId = toTrimmedString(url.searchParams.get("storage_location_id") ?? "");
    if (!companyId || !materialId || !storageLocationId) {
      return packErr(req, ctx, "PROD_PACK_INVALID", 400, "company_id, material_id and storage_location_id required");
    }

    const options = await resolvePackingSfgBatchOptions(companyId, materialId, storageLocationId);
    return okResponse({ data: options }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_SFG_BATCH_LOOKUP_FAILED";
    return packErr(req, ctx, code, 500, "SFG batch lookup failed");
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
        id, company_id, po_number, po_type, source_po_type, process_order_id, material_id,
        pack_code_id, fill_qty_per_pack, num_packs, sku_qty, fg_conversion_qty, sfg_conversion_qty, planned_qty_kg, actual_qty_kg,
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
        pack_code:pack_code_master!pack_code_id(id, pack_code, pack_name, pack_type, billing_uom, outer_uom_code),
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
        actual_qty, issue_sloc_id, uom_code, movement_type_code, has_alternate, material_group_id, display_order
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
    const [poMaterialMap, lineMaterialMap, slocMap, machineMap] = await Promise.all([
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
      getMachineMapByIds([String(poRow.machine_id ?? "")]),
    ]);

    return okResponse({
      data: {
        ...poRow,
        material: poMaterialMap.get(String(poRow.material_id ?? "")) ?? null,
        machine: machineMap.get(String(poRow.machine_id ?? "")) ?? null,
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
// Creates at STANDARD directly from Company + Type + FG SKU. Packing PO has no QA/Verify step.
export async function createPackingOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const body = await parseBody(req);

    const companyId = toTrimmedString(body.company_id);
    const sourcePoType = toUpperTrimmedString(body.source_po_type || mapPackingTypeToSourceType(toTrimmedString(body.po_type)));
    const normalizedSourcePoType = sourcePoType === "MTEST" ? "ZTEST" : sourcePoType;
    const poType = toUpperTrimmedString(body.po_type) || mapSourceTypeToPackingType(normalizedSourcePoType);
    let processOrderId = toTrimmedString(body.process_order_id) || null;
    const materialId = toTrimmedString(body.material_id);
    const sfgMaterialId = toTrimmedString(body.sfg_material_id);
    const sfgBatchNumber = toTrimmedString(body.sfg_batch_number);
    const skuQty = numberOrNull(body.sku_qty ?? body.num_packs);
    const fgConversionQty = numberOrNull(body.fg_conversion_qty) ?? 1;
    const sfgConversionQty = numberOrNull(body.sfg_conversion_qty);
    const fgStorageLocationId = toTrimmedString(body.fg_storage_location_id);
    const sfgStorageLocationId = toTrimmedString(body.sfg_storage_location_id);
    const planFeedId = toTrimmedString(body.plan_feed_id) || null;
    const pmLines = Array.isArray(body.pm_lines) ? body.pm_lines as JsonRecord[] : [];

    if (!companyId || !VALID_PACK_PO_TYPES.has(poType) || !["MTO", "HPS", "MTS", "ZTEST"].includes(normalizedSourcePoType) || !materialId) {
      return packErr(req, ctx, "PROD_PACK_INVALID", 400, "company_id, source_po_type, po_type and material_id required");
    }
    if (!skuQty || !sfgMaterialId || !sfgConversionQty || !fgStorageLocationId || !sfgStorageLocationId) {
      return packErr(req, ctx, "PROD_PACK_QTY_CONVERSION_REQUIRED", 400, "sku_qty, sfg material, conversion and storage locations required");
    }
    if (!sfgBatchNumber) {
      return packErr(req, ctx, "PROD_PACK_SFG_BATCH_REQUIRED", 422, "SFG batch number is required for Packing PO");
    }

    const { data: sku, error: skuErr } = await serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .select("id, material_type, pack_code, base_uom_code")
      .eq("id", materialId)
      .maybeSingle();
    if (skuErr) throw new Error("PROD_PACK_SKU_LOOKUP_FAILED");
    if (!sku || String((sku as JsonRecord).material_type) !== "FG") {
      return packErr(req, ctx, "PROD_PACK_SKU_INVALID", 422, "Packing PO material must be an FG SKU");
    }

    const { data: packCodeRow, error: packCodeErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_code_master")
      .select("id, pack_code, outer_uom_code")
      .eq("pack_code", toTrimmedString((sku as JsonRecord).pack_code))
      .maybeSingle();
    if (packCodeErr) throw new Error("PROD_PACK_CODE_LOOKUP_FAILED");
    if (!packCodeRow) return packErr(req, ctx, "PROD_PACK_CODE_NOT_FOUND", 422, "FG SKU pack code is not configured");
    const packCodeId = String((packCodeRow as JsonRecord).id ?? "");

    const { data: activeBom, error: bomErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom")
      .select("id")
      .eq("company_id", companyId)
      .eq("sku_material_id", materialId)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (bomErr) throw new Error("PROD_PACK_BOM_LOOKUP_FAILED");
    if (!activeBom) {
      return packErr(req, ctx, "PROD_PACK_NO_ACTIVE_BOM", 422, "Active Pack BOM is required before creating a Packing PO");
    }

    const sfgTotalQty = (skuQty / fgConversionQty) * sfgConversionQty;
    const normalizedPmLines = pmLines.map((line, idx) => {
      const pmMaterialId = toTrimmedString(line.material_id);
      const dosageQty = numberOrNull(line.dosage_per_sku ?? line.qty_per_pack ?? line.qty);
      const storageLocationId = toTrimmedString(line.storage_location_id ?? line.issue_sloc_id);
      return {
        materialId: pmMaterialId,
        dosageQty,
        storageLocationId,
        hasAlternate: line.has_alternate === true || line.has_alternate === "true",
        materialGroupId: toTrimmedString(line.material_group_id) || null,
        displayOrder: 10 + idx,
      };
    }).filter((line) => line.materialId);
    if (normalizedPmLines.some((line) => !line.dosageQty || !line.storageLocationId)) {
      return packErr(req, ctx, "PROD_PACK_PM_LINE_INVALID", 400, "Every PM line requires material, dosage and storage location");
    }

    const materialMap = await getMaterialMapByIds(
      [sfgMaterialId, materialId, ...normalizedPmLines.map((line) => line.materialId)],
      "[packing_order.createPackingOrder]",
      "PROD_PACK_MATERIAL_LOOKUP_FAILED",
      "id, material_type, base_uom_code",
    );
    for (const line of normalizedPmLines) {
      if (String(materialMap.get(line.materialId)?.material_type ?? "") !== "PM") {
        return packErr(req, ctx, "PROD_PACK_PM_ONLY", 422, "Packing PM lines can only use PM materials");
      }
    }

    const sfgBatchOptions = await resolvePackingSfgBatchOptions(companyId, sfgMaterialId, sfgStorageLocationId);
    const selectedSfgBatch = sfgBatchOptions.find((batch) => batch.batch_number === sfgBatchNumber) ?? null;
    if (!selectedSfgBatch) {
      return packErr(req, ctx, "PROD_PACK_SFG_BATCH_REQUIRED", 422, "Selected SFG batch is not available at this storage location");
    }
    if (selectedSfgBatch.available_qty < sfgTotalQty) {
      return packErr(req, ctx, "PROD_PACK_SFG_BATCH_SHORTAGE", 422, "Selected SFG batch does not have enough available stock");
    }
    processOrderId = processOrderId || selectedSfgBatch.process_order_id;

    const pmNeeds: PackingPmNeed[] = normalizedPmLines.map((line) => ({
        materialId: line.materialId,
        storageLocationId: line.storageLocationId,
        qty: skuQty * Number(line.dosageQty ?? 0),
      }));
    await assertPackingCreateAvailability(
      companyId,
      { materialId: sfgMaterialId, storageLocationId: sfgStorageLocationId, batchNumber: sfgBatchNumber, qty: sfgTotalQty },
      pmNeeds,
    );

    const poNumber = await generateGlobalDocNumber("PACK_PO");
    const now = new Date().toISOString();

    const { data: packPo, error: insertErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order")
      .insert({
        company_id: companyId,
        po_number: poNumber,
        po_type: poType,
        source_po_type: normalizedSourcePoType,
        process_order_id: processOrderId,
        machine_id: toTrimmedString(selectedSfgBatch.machine?.id) || null,
        batch_number: sfgBatchNumber,
        material_id: materialId,
        pack_code_id: packCodeId,
        fill_qty_per_pack: sfgConversionQty,
        num_packs: Math.round(skuQty),
        sku_qty: skuQty,
        fg_conversion_qty: fgConversionQty,
        sfg_conversion_qty: sfgConversionQty,
        planned_qty_kg: sfgTotalQty,
        total_qty_kg: sfgTotalQty,
        status: "STANDARD",
        plan_feed_id: planFeedId,
        segment_code: normalizedSourcePoType,
        created_by: ctx.auth_user_id,
        created_at: now,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .select("id").single();

    if (insertErr) throw new Error("PROD_PACK_CREATE_FAILED");
    const packPoId = (packPo as JsonRecord).id as string;

    const lineRows: JsonRecord[] = [
      {
        packing_order_id: packPoId,
        line_type: "FG",
        material_id: materialId,
        batch_number: null,
        qty_per_pack: fgConversionQty,
        total_qty: skuQty,
        actual_qty: null,
        issue_sloc_id: fgStorageLocationId,
        uom_code: toTrimmedString((packCodeRow as JsonRecord).outer_uom_code) || toTrimmedString((sku as JsonRecord).base_uom_code) || "KG",
        movement_type_code: "P101",
        display_order: 1,
      },
      {
        packing_order_id: packPoId,
        line_type: "SFG",
        material_id: sfgMaterialId,
        batch_number: sfgBatchNumber,
        qty_per_pack: sfgConversionQty,
        total_qty: sfgTotalQty,
        actual_qty: null,
        issue_sloc_id: sfgStorageLocationId,
        uom_code: toTrimmedString(materialMap.get(sfgMaterialId)?.base_uom_code) || "KG",
        movement_type_code: "P261",
        display_order: 2,
      },
      ...normalizedPmLines.map((line) => ({
        packing_order_id: packPoId,
        line_type: "PM",
        material_id: line.materialId,
        batch_number: null,
        qty_per_pack: line.dosageQty,
        total_qty: skuQty * Number(line.dosageQty ?? 0),
        actual_qty: null,
        issue_sloc_id: line.storageLocationId,
        uom_code: toTrimmedString(materialMap.get(line.materialId)?.base_uom_code) || "KG",
        movement_type_code: "P261",
        has_alternate: line.hasAlternate,
        material_group_id: line.hasAlternate ? line.materialGroupId : null,
        display_order: line.displayOrder,
      })),
    ];
    const { data: insertedLines, error: lineErr } = await serviceRoleClient
      .schema("erp_production")
      .from("packing_order_line")
      .insert(lineRows)
      .select("id, line_type, material_id, batch_number, total_qty, issue_sloc_id, display_order, uom_code");
    if (lineErr) {
      console.error("[packing_order.createPackingOrder] line insert failed:", JSON.stringify(lineErr));
      await cleanupPackingOrderAfterCreateFailure(packPoId, "line insert failure");
      throw new Error("PROD_PACK_LINES_CREATE_FAILED");
    }

    const reservationRows: JsonRecord[] = ((insertedLines ?? []) as JsonRecord[])
      .filter((line) => String(line.line_type) !== "FG")
      .map((line) => ({
        source_type: "PACKING_PO",
        source_id: packPoId,
        source_line_id: line.id,
        company_id: companyId,
        material_id: line.material_id,
        storage_location_id: toTrimmedString(line.issue_sloc_id) || null,
        required_qty: Number(line.total_qty ?? 0),
        uom_code: toTrimmedString(line.uom_code) || "KG",
        issued_qty: 0,
        status: "OPEN",
        batch_number: String(line.line_type) === "SFG" ? sfgBatchNumber : null,
        created_by: ctx.auth_user_id,
        created_at: now,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: now,
      }));
    const reservationResults = await Promise.all(reservationRows.map((row) =>
      serviceRoleClient
        .schema("erp_production")
        .from("reservation_document")
        .insert(row)
    ));
    const reservationError = reservationResults.find((result) => result.error)?.error;
    if (reservationError) {
      console.error("[packing_order.createPackingOrder] reservation insert failed:", JSON.stringify(reservationError));
      await cleanupPackingOrderAfterCreateFailure(packPoId, "reservation insert failure");
      throw new Error("PROD_PACK_RESERVATION_CREATE_FAILED");
    }

    return createdOkResponse({ id: packPoId, po_number: poNumber, status: "STANDARD" }, ctx.request_id, req);
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
    const requestedActualQtyKg = parsePositiveNumber(body.actual_qty_kg);

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
        id, line_type, material_id, batch_number, actual_qty, total_qty, issue_sloc_id, uom_code, movement_type_code
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
    const missingSfgBatch = lineRows.some((line) => String(line.line_type ?? "") === "SFG" && !toTrimmedString(line.batch_number));
    if (missingSfgBatch) {
      return packErr(req, ctx, "PROD_PACK_SFG_BATCH_REQUIRED", 422, "SFG batch number is required before final posting");
    }
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
      const movementTypeCode = toTrimmedString(line.movement_type_code) || (lineType === "FG" ? "P101" : "P261");
      const direction = lineType === "FG" ? "IN" : "OUT";
      const posting = await postStockMovement({
        documentNumber: docNumber, documentDate: today, postingDate: today,
        movementTypeCode, companyId: poData.company_id,
        storageLocationId: slocId, materialId: line.material_id,
        quantity: qty, baseUomCode: toTrimmedString(line.uom_code) || baseUom, unitValue: 0,
        stockTypeCode: "UNRESTRICTED", direction: direction as "IN" | "OUT", postedBy: ctx.auth_user_id,
        batchNumber: (line.batch_number as string | null) ?? null,
      });

      await serviceRoleClient.schema("erp_production").from("packing_order_line")
        .update({ stock_ledger_id: posting.stock_ledger_id, actual_qty: qty })
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
    const actualQtyKg = requestedActualQtyKg ?? Number(poData.planned_qty_kg ?? poData.total_qty_kg ?? 0);
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
