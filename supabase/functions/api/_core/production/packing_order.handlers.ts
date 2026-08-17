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
import { generateMaterialDocNumber, generateRecoDocNumber } from "../../_shared/materialDocument.ts";
import type { MaterialDocumentRef } from "../../_shared/materialDocument.ts";
import { isGlobalAdmin, isSuperAdmin } from "../../_shared/role_ladder.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { okResponse, errorResponse } from "../response.ts";
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
  "PROD_PACK_SCOPE_VIOLATION",
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
  prodshade: JsonRecord | null;
  stroke_number: string | null;
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
  if (normalized === "PTEST") return "MTEST";
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

// PTEST (MTEST/AP-test-batch) Packing POs draw SFG generically (material+location
// only) — no batch is ever selected/required at Final, FG/SFG lines' batch_number
// columns stay null (locked 2026-07-14).
// §108.2 item 8 (2026-07-24, business owner correction): PMTS was wrongly lumped in
// here — "pack size is always Fixed BOM" (true, §83.14) does not imply "batch choice
// is also removed" (false) — those are two independent decisions. PMTS now behaves
// exactly like PMTO/PHPS: user picks which Process PO batch to draw SFG from.
function isBatchBlindPackingType(poType: string): boolean {
  return false;
}

async function getMaterialGroupMemberIdsByGroupIds(groupIds: string[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(groupIds.filter(Boolean))];
  const memberMap = new Map<string, string[]>();
  if (ids.length === 0) return memberMap;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_category_group_member")
    .select("group_id, material_id")
    .in("group_id", ids);
  if (error) {
    console.error("[packing_order.getMaterialGroupMemberIdsByGroupIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_PACK_GROUP_LOOKUP_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) {
    const groupId = String(row.group_id ?? "");
    const materialId = toTrimmedString(row.material_id);
    if (!groupId || !materialId) continue;
    const existing = memberMap.get(groupId) ?? [];
    existing.push(materialId);
    memberMap.set(groupId, existing);
  }
  return memberMap;
}

// Pack BOM PM lines only ever carry a material_group_id (no direct
// alternate_material_id column like stroke_line has), so the allowed set is
// group-membership only — same end result as Process PO's own alternate
// resolution, just a narrower source.
async function buildAllowedAlternateIdsByPackBomLines(pmBomLines: JsonRecord[]): Promise<Map<string, string[]>> {
  const groupMemberMap = await getMaterialGroupMemberIdsByGroupIds(
    pmBomLines.map((line) => String(line.material_group_id ?? "")),
  );
  const allowedMap = new Map<string, string[]>();
  for (const line of pmBomLines) {
    const formulationMaterialId = String(line.material_id ?? "");
    if (!formulationMaterialId) continue;
    const groupId = String(line.material_group_id ?? "");
    const allowedIds = (groupMemberMap.get(groupId) ?? []).filter((id) => id && id !== formulationMaterialId);
    allowedMap.set(formulationMaterialId, allowedIds);
  }
  return allowedMap;
}

function isAdminBypass(ctx: ProdHandlerContext): boolean {
  return ctx.context.isAdmin === true || isSuperAdmin(ctx.roleCode) || isGlobalAdmin(ctx.roleCode);
}

async function assertPackingCompanyScope(ctx: ProdHandlerContext, companyId: string): Promise<void> {
  if (isAdminBypass(ctx)) return;
  const normalizedCompanyId = toTrimmedString(companyId);
  if (!normalizedCompanyId) throw new Error("PROD_PACK_SCOPE_VIOLATION");
  const { data, error } = await serviceRoleClient
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", ctx.auth_user_id)
    .eq("company_id", normalizedCompanyId)
    .maybeSingle();
  if (error || !data) throw new Error("PROD_PACK_SCOPE_VIOLATION");
}

// Any active storage location mapped to this company — used to validate the
// user-picked PM issue location (dropdown, same pattern as Process PO's own
// RM/PM line location picker). Not F-filtered like Pack BOM's OUTPUT lookup —
// PM can issue from any of the company's active locations.
async function getCompanyStorageLocationIds(companyId: string): Promise<Set<string>> {
  const normalizedCompanyId = toTrimmedString(companyId);
  if (!normalizedCompanyId) return new Set();
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_plant_map")
    .select("storage_location_id")
    .eq("company_id", normalizedCompanyId)
    .eq("active", true);
  if (error) {
    console.error("[packing_order.getCompanyStorageLocationIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_PACK_SLOC_LOOKUP_FAILED");
  }
  return new Set(((data ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.storage_location_id)).filter(Boolean));
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
  excludeSourceId: string | null = null,
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
      .select("material_id, storage_location_id, batch_number, balance_qty, source_id")
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
    if (excludeSourceId && String(row.source_id ?? "") === excludeSourceId) continue;
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
        .select("id, po_number, batch_number, status, machine_id, material_id, stroke_master_id")
        .eq("material_id", materialId)
        .in("id", processOrderIds)
    : { data: [], error: null };
  if (processErr) {
    console.error("[packing_order.resolvePackingSfgBatchOptions] process order query failed:", JSON.stringify(processErr));
    throw new Error("PROD_PACK_SFG_BATCH_LOOKUP_FAILED");
  }

  const machineIds = [...new Set(((processRows ?? []) as JsonRecord[])
    .map((row) => toTrimmedString(row.machine_id))
    .filter(Boolean))];
  const prodshadeIds = [...new Set(((processRows ?? []) as JsonRecord[])
    .map((row) => toTrimmedString(row.material_id))
    .filter(Boolean))];
  const strokeIds = [...new Set(((processRows ?? []) as JsonRecord[])
    .map((row) => toTrimmedString(row.stroke_master_id))
    .filter(Boolean))];
  const [machineLookup, prodshadeLookup, strokeLookup] = await Promise.all([
    machineIds.length
      ? serviceRoleClient
          .schema("erp_master")
          .from("machine_master")
          .select("id, machine_code, machine_name")
          .in("id", machineIds)
      : Promise.resolve({ data: [], error: null }),
    prodshadeIds.length
      ? serviceRoleClient
          .schema("erp_master")
          .from("material_master")
          .select("id, pace_code, material_name, document_name, shade_code")
          .in("id", prodshadeIds)
      : Promise.resolve({ data: [], error: null }),
    strokeIds.length
      ? serviceRoleClient
          .schema("erp_production")
          .from("stroke_master")
          .select("id, stroke_number")
          .in("id", strokeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const { data: machineRows, error: machineErr } = machineLookup;
  if (machineErr) {
    console.error("[packing_order.resolvePackingSfgBatchOptions] machine query failed:", JSON.stringify(machineErr));
    throw new Error("PROD_PACK_SFG_BATCH_LOOKUP_FAILED");
  }
  const { data: prodshadeRows, error: prodshadeErr } = prodshadeLookup;
  if (prodshadeErr) {
    console.error("[packing_order.resolvePackingSfgBatchOptions] prodshade query failed:", JSON.stringify(prodshadeErr));
    throw new Error("PROD_PACK_SFG_BATCH_LOOKUP_FAILED");
  }
  const { data: strokeRows, error: strokeErr } = strokeLookup;
  if (strokeErr) {
    console.error("[packing_order.resolvePackingSfgBatchOptions] stroke query failed:", JSON.stringify(strokeErr));
    throw new Error("PROD_PACK_SFG_BATCH_LOOKUP_FAILED");
  }

  const batchMap = new Map(((batchRows ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.batch_number), row]));
  const processMap = new Map(((processRows ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
  const machineMap = new Map(((machineRows ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
  const prodshadeMap = new Map(((prodshadeRows ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
  const strokeMap = new Map(((strokeRows ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));

  return batchNumbers.map((batchNumber) => {
    const batch = batchMap.get(batchNumber);
    const processOrderId = toTrimmedString(batch?.source_process_order_id) || null;
    const processOrder = processOrderId ? processMap.get(processOrderId) ?? null : null;
    const machineId = toTrimmedString(processOrder?.machine_id);
    const prodshadeId = toTrimmedString(processOrder?.material_id);
    const strokeId = toTrimmedString(processOrder?.stroke_master_id);
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
      prodshade: prodshadeId ? prodshadeMap.get(prodshadeId) ?? null : null,
      stroke_number: strokeId ? toTrimmedString(strokeMap.get(strokeId)?.stroke_number) || null : null,
      machine: machineId ? machineMap.get(machineId) ?? null : null,
    };
  }).filter((row) => row.available_qty > 0 && row.process_order_id)
    .sort((a, b) => b.available_qty - a.available_qty || a.batch_number.localeCompare(b.batch_number));
}

/*
 * Batch-BLIND SFG availability for Create (feasibility §83.4.1 hygiene check).
 *
 * At Create the SFG batch is not chosen yet, so this cannot check a specific
 * batch (that is Final's job). But asking for more than the material's total
 * FREE SFG is always wrong regardless of batch, so we block it here to stop a
 * pile of impossible Packing POs being created.
 *
 * free = total UNRESTRICTED across all batches − every open SFG reservation
 *        (the reservations of the STANDARD POs already created against it).
 * Returns { free, short } where short > 0 means the new PO overdraws.
 */
async function computeSfgTotalFree(
  companyId: string,
  sfgMaterialId: string,
  neededQty: number,
): Promise<{ free: number; short: number }> {
  const [ledgerResult, reservationResult] = await Promise.all([
    serviceRoleClient.schema("erp_inventory").from("stock_ledger")
      .select("direction, quantity")
      .eq("company_id", companyId)
      .eq("material_id", sfgMaterialId)
      .eq("stock_type_code", "UNRESTRICTED"),
    serviceRoleClient.schema("erp_production").from("reservation_document")
      .select("balance_qty")
      .eq("company_id", companyId)
      .eq("material_id", sfgMaterialId)
      .in("status", RESERVATION_OPEN_STATUSES),
  ]);
  if (ledgerResult.error || reservationResult.error) {
    console.error("[packing_order.computeSfgTotalFree] query failed:",
      JSON.stringify(ledgerResult.error ?? reservationResult.error));
    throw new Error("PROD_PACK_SFG_AVAILABILITY_FAILED");
  }
  let onHand = 0;
  for (const row of (ledgerResult.data ?? []) as JsonRecord[]) {
    onHand += String(row.direction) === "IN" ? Number(row.quantity ?? 0) : -Number(row.quantity ?? 0);
  }
  let reserved = 0;
  for (const row of (reservationResult.data ?? []) as JsonRecord[]) {
    reserved += Number(row.balance_qty ?? 0);
  }
  const free = onHand - reserved;
  return { free, short: Math.max(0, neededQty - free) };
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
  // §106: Material Document identity (MBLNR+MJAHR) for the posting event; the Packing PO
  // number (documentNumber) is carried as the reference.
  matDoc?: MaterialDocumentRef;
  referenceDocumentId?: string | null;
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
    p_material_doc_number: params.matDoc?.docNumber ?? null,
    p_material_doc_year: params.matDoc?.docYear ?? null,
    p_reference_document_number: params.matDoc ? params.documentNumber : null,
    p_reference_document_type: params.matDoc ? "PACK_PO" : null,
    p_reference_document_id: params.referenceDocumentId ?? null,
  });
  if (error || !Array.isArray(data) || data.length === 0) {
    // Found live 2026-08-12: this used to discard the real reason entirely — a
    // material with genuinely zero stock for this company (e.g. never GRN'd,
    // even though a sister company holds stock at the same shared storage
    // location) surfaced only as an opaque "PROD_PACK_STOCK_POST_FAILED: P261"
    // with nothing in the response the user could act on. post_stock_movement()
    // raises a plain message (e.g. "INSUFFICIENT_STOCK") on failure — surface it.
    const dbReason = toTrimmedString((error as { message?: string } | null)?.message);
    console.error("[packing_order.postStockMovement] post_stock_movement RPC failed:", JSON.stringify({
      error, movementTypeCode: params.movementTypeCode, materialId: params.materialId, storageLocationId: params.storageLocationId,
    }));
    const reason = dbReason === "INSUFFICIENT_STOCK"
      ? `insufficient UNRESTRICTED stock for this material/location/company`
      : dbReason || "unknown error";
    throw new Error(`PROD_PACK_STOCK_POST_FAILED: ${params.movementTypeCode} (${reason})`);
  }
  return data[0] as { stock_document_id: string; stock_ledger_id: string };
}

// post_stock_movement()'s p_reversal_of_id references stock_document.id (FK
// stock_document_reversal_document_id_fkey), NOT stock_ledger.id — but every
// *_stock_ledger_id column on process_order/process_order_line/
// packing_order_line stores the RPC's own stock_ledger_id return value.
// Passing that raw value as p_reversal_of_id violates the FK. Resolve first.
//
// §104.8: also returns each original leg's own posted valuation_rate. A reversal
// must restore/remove the EXACT value the original leg posted at — post_stock_movement()
// does nothing special for p_reversal_of_id valuation-wise: an IN reversal (P262/P102-in)
// recomputes the weighted average from p_unit_value, so posting a reversal at 0 would
// dilute the material's rate toward zero. Reverse at the original rate instead.
type StockLedgerRef = { docId: string; rate: number };
async function resolveStockLedgerRefsByLedgerIds(ledgerIds: string[]): Promise<Map<string, StockLedgerRef>> {
  const ids = [...new Set(ledgerIds.filter(Boolean))];
  const map = new Map<string, StockLedgerRef>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_ledger")
    .select("id, stock_document_id, valuation_rate")
    .in("id", ids);
  if (error) {
    console.error("[packing_order.resolveStockLedgerRefsByLedgerIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_PACK_LEDGER_LOOKUP_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) {
    const ledgerId = String(row.id ?? "");
    const docId = toTrimmedString(row.stock_document_id);
    if (ledgerId && docId) map.set(ledgerId, { docId, rate: Number(row.valuation_rate ?? 0) });
  }
  return map;
}

// §104: current UNRESTRICTED valuation rate for (material, storage_location) pairs, so the
// SFG and PM issues post at their real cost (not 0) and roll up into the FG cost. Batched
// read; keyed `${materialId}|${slocId}`; 0 when not yet valued. (Moving-average costing: the
// snapshot rate is the blended current rate, which is the correct issue cost — not batch-split.)
async function fetchUnrestrictedRates(
  companyId: string,
  keys: Array<{ materialId: string; slocId: string }>,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const pairs = keys.filter((k) => k.materialId && k.slocId);
  if (pairs.length === 0) return map;
  const materialIds = [...new Set(pairs.map((p) => p.materialId))];
  const slocIds = [...new Set(pairs.map((p) => p.slocId))];
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
    console.error("[packing_order.fetchUnrestrictedRates] query failed:", JSON.stringify(error));
    throw new Error("PROD_PACK_RATE_LOOKUP_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) {
    map.set(`${String(row.material_id)}|${String(row.storage_location_id)}`, Number(row.valuation_rate ?? 0));
  }
  return map;
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
    try {
      await assertPackingCompanyScope(ctx, companyId);
    } catch {
      return packErr(req, ctx, "PROD_PACK_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    // PERF: these two lookups key off URL params only — they do not depend on the
    // ledger -> stock_document -> packing_order chain below (which is a genuine dependency chain
    // and must stay sequential). Start them now, await after, saving one round trip.
    const lookupsPromise = Promise.all([
      getMaterialMapByIds([materialId], "[packing_order.fgStockBreakdown]", "PROD_FG_STOCK_BREAKDOWN_FAILED", "id, pace_code, material_name, external_code"),
      getCompanyMapByIds([companyId]),
    ]);
    // Mark as handled so a failure in the chain below can't surface this as an unhandled
    // rejection; the original rejection is still delivered at the `await` further down.
    lookupsPromise.catch(() => {});

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
          .select("id, document_number, posting_date, source_lot_ref, reference_document_type, reference_document_number")
          .in("id", docIds)
      : { data: [], error: null };
    if (docErr) throw new Error("PROD_FG_STOCK_BREAKDOWN_FAILED");
    const docMap = new Map(((docRows ?? []) as JsonRecord[]).map((doc) => [String(doc.id), doc]));

    /*
     * Which Packing PO produced this FG — has moved twice, so read it in that order.
     *
     *   source_lot_ref            the lot, set by the derive trigger (current)
     *   reference_document_number where §106 Phase 2 moved the business number to
     *   document_number           where it lived before §106 (legacy rows only)
     *
     * §83.15 originally specified document_number, and this handler still read only
     * that — but §106 repurposed document_number for the Material Document number,
     * so every Packing PO finalised after 17 Jul would have matched nothing here and
     * silently lost its barrel count. It had not broken yet only because no Packing
     * PO has been finalised since that change landed.
     */
    const resolveLotRef = (doc: JsonRecord | undefined): string => {
      if (!doc) return "";
      const lot = toTrimmedString(doc.source_lot_ref);
      if (lot) return lot;
      if (toTrimmedString(doc.reference_document_type) === "PACK_PO") {
        const ref = toTrimmedString(doc.reference_document_number);
        if (ref) return ref;
      }
      return toTrimmedString(doc.document_number);
    };

    const poNumbers = [...new Set([...docMap.values()].map((doc) => resolveLotRef(doc as JsonRecord)).filter(Boolean))];
    const { data: poRows, error: poErr } = poNumbers.length
      ? await serviceRoleClient
          .schema("erp_production")
          .from("packing_order")
          .select("id, po_number, po_type, source_po_type, num_packs, fill_qty_per_pack, actual_qty_kg, process_order_id")
          .in("po_number", poNumbers)
      : { data: [], error: null };
    if (poErr) throw new Error("PROD_FG_STOCK_BREAKDOWN_FAILED");
    const poMap = new Map(((poRows ?? []) as JsonRecord[]).map((po) => [String(po.po_number), po]));

    // §104.9: PR23 "Old Packing PO" (opening genealogy) never posts a P101 — its real FG stock
    // came from IN05's own P561, and its lines carry stock_ledger_id=NULL by design. So it can
    // never be found via the ledger->stock_document->po_number chain above, and would otherwise
    // silently vanish from this report. Separately fetch every non-REVERSED Packing PO for this
    // material+company and fold in any not already covered by a real P101 posting, using the
    // header's own batch_number/actual_qty_kg (all it has, since it was never really posted).
    const { data: allPoRows, error: allPoErr } = await serviceRoleClient
      .schema("erp_production")
      .from("packing_order")
      .select("po_number, po_type, source_po_type, num_packs, fill_qty_per_pack, actual_qty_kg, batch_number, finalized_at")
      .eq("company_id", companyId)
      .eq("material_id", materialId)
      .neq("status", "REVERSED");
    if (allPoErr) throw new Error("PROD_FG_STOCK_BREAKDOWN_FAILED");
    const [materialMap, companyMap] = await lookupsPromise;

    const batchMap = new Map<string, JsonRecord[]>();
    const coveredPoNumbers = new Set<string>();
    for (const ledger of ledgers) {
      const doc = docMap.get(String(ledger.stock_document_id ?? ""));
      // Same resolution as the lookup above — both sides must agree, or every row
      // silently drops out on the `if (!po) continue` below.
      const po = poMap.get(resolveLotRef(doc as JsonRecord | undefined));
      if (!po) continue;
      coveredPoNumbers.add(String(po.po_number));
      const batchNumber = toTrimmedString(ledger.batch_number) || "UNBATCHED";
      if (!batchMap.has(batchNumber)) batchMap.set(batchNumber, []);
      batchMap.get(batchNumber)?.push({
        po_number: po.po_number,
        po_type: po.po_type,
        source_po_type: po.source_po_type,
        num_packs: po.num_packs,
        fill_qty_per_pack: po.fill_qty_per_pack,
        quantity: ledger.quantity,
        posting_date: doc?.posting_date ?? null,
      });
    }
    for (const po of (allPoRows ?? []) as JsonRecord[]) {
      const poNumber = String(po.po_number ?? "");
      if (!poNumber || coveredPoNumbers.has(poNumber)) continue;
      const batchNumber = toTrimmedString(po.batch_number) || "UNBATCHED";
      if (!batchMap.has(batchNumber)) batchMap.set(batchNumber, []);
      batchMap.get(batchNumber)?.push({
        po_number: po.po_number,
        po_type: po.po_type,
        source_po_type: po.source_po_type,
        num_packs: po.num_packs,
        fill_qty_per_pack: po.fill_qty_per_pack,
        quantity: po.actual_qty_kg,
        posting_date: po.finalized_at ?? null,
        is_opening_origin: true,
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
    try {
      await assertPackingCompanyScope(ctx, companyId);
    } catch {
      return packErr(req, ctx, "PROD_PACK_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

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
    const excludeSourceId = toTrimmedString(url.searchParams.get("exclude_source_id") ?? "") || null;
    if (!companyId || !materialId || !storageLocationId) {
      return packErr(req, ctx, "PROD_PACK_INVALID", 400, "company_id, material_id and storage_location_id required");
    }
    try {
      await assertPackingCompanyScope(ctx, companyId);
    } catch {
      return packErr(req, ctx, "PROD_PACK_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const options = await resolvePackingSfgBatchOptions(companyId, materialId, storageLocationId, excludeSourceId);
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
    const poNumber = toTrimmedString(url.searchParams.get("po_number") ?? "");
    const processOrderId = toTrimmedString(url.searchParams.get("process_order_id") ?? "");
    const status = toUpperTrimmedString(url.searchParams.get("status") ?? "");
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const perPage = Math.min(100, Math.max(10, parseInt(url.searchParams.get("per_page") ?? "20", 10)));

    // Same rationale as process_order.listProcessOrders (§112) — scope to the
    // caller's own companies unless SA/GA, so an empty Company filter never
    // leaks every company's Packing POs.
    let allowedCompanyIds: string[] | null = null;
    if (!isAdminBypass(ctx)) {
      const { data: userCompanies, error: userCompaniesError } = await serviceRoleClient
        .schema("erp_map")
        .from("user_companies")
        .select("company_id")
        .eq("auth_user_id", ctx.auth_user_id);
      if (userCompaniesError) {
        console.error("[packing_order.listPackingOrders] user_companies query failed:", JSON.stringify(userCompaniesError));
        throw new Error("PROD_PACK_LIST_FAILED");
      }
      const resolvedCompanyIds = ((userCompanies ?? []) as JsonRecord[]).map((row) => String(row.company_id ?? ""));
      allowedCompanyIds = resolvedCompanyIds;
      if (companyId && !resolvedCompanyIds.includes(companyId)) {
        return packErr(req, ctx, "PROD_PACK_SCOPE_VIOLATION", 403, "You do not have access to this company.");
      }
    }

    let query = serviceRoleClient
      .schema("erp_production").from("packing_order")
      .select(`
        id, company_id, po_number, po_type, source_po_type, process_order_id, material_id,
        pack_code_id, fill_qty_per_pack, num_packs, sku_qty, fg_conversion_qty, sfg_conversion_qty, planned_qty_kg, actual_qty_kg,
        status, segment_code, created_by, created_at,
        finalized_at, last_updated_at,
        pack_code:pack_code_master!pack_code_id(id, pack_code, pack_name, pack_type),
        process_order:process_order!process_order_id(po_number, batch_number, status)
      `, { count: "exact" })
      .order("created_at", { ascending: false });

    if (companyId) query = query.eq("company_id", companyId);
    else if (allowedCompanyIds) query = query.in("company_id", allowedCompanyIds);
    if (poNumber) query = query.eq("po_number", poNumber);
    if (processOrderId) query = query.eq("process_order_id", processOrderId);
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

    // §83.18-REVISED: surface FO-allocation room directly on this list so the Plan
    // Feed "find Packing PO to allocate" flow can show Total/Allocated/Available
    // before the user commits a qty, instead of only failing at submit time.
    const poIds = rows.map((row) => String(row.id));
    const allocatedByPo = new Map<string, number>();
    if (poIds.length > 0) {
      const { data: allocs, error: allocErr } = await serviceRoleClient
        .schema("erp_production").from("plan_feed_packing_order_allocation")
        .select("packing_order_id, allocated_qty_kg")
        .in("packing_order_id", poIds);
      if (allocErr) {
        console.error("[packing_order.listPackingOrders] allocation query failed:", JSON.stringify(allocErr));
        throw new Error("PROD_PACK_LIST_FAILED");
      }
      for (const a of (allocs ?? []) as JsonRecord[]) {
        const key = String(a.packing_order_id);
        allocatedByPo.set(key, (allocatedByPo.get(key) ?? 0) + (Number(a.allocated_qty_kg) || 0));
      }
    }

    return okResponse({
      data: rows.map((row) => {
        const totalQty = Number(row.actual_qty_kg) || Number(row.planned_qty_kg) || 0;
        const allocatedQty = allocatedByPo.get(String(row.id)) ?? 0;
        return {
          ...row,
          material: materialMap.get(String(row.material_id ?? "")) ?? null,
          fo_allocated_qty_kg: allocatedQty,
          fo_available_qty_kg: Math.max(0, totalQty - allocatedQty),
        };
      }),
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
        pack_code:pack_code_master!pack_code_id(id, pack_code, pack_name, pack_type, billing_uom, outer_uom_code, bom_required),
        process_order:process_order!process_order_id(id, po_number, batch_number, status, segment_code)
      `)
      .eq("id", id).maybeSingle();

    if (error) {
      console.error("[packing_order.getPackingOrder] query failed:", JSON.stringify(error));
      throw new Error("PROD_PACK_FETCH_FAILED");
    }
    if (!po) return packErr(req, ctx, "PROD_PACK_NOT_FOUND", 404, "Packing order not found");
    try {
      await assertPackingCompanyScope(ctx, String((po as JsonRecord).company_id ?? ""));
    } catch {
      return packErr(req, ctx, "PROD_PACK_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const { data: lines, error: lineErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order_line")
      .select(`
        id, line_type, material_id, actual_material_id, batch_number, qty_per_pack, total_qty,
        actual_qty, issue_sloc_id, uom_code, movement_type_code, has_alternate, material_group_id, display_order,
        approved_status, ap_approved_qty, variance_qty
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
    // Registered alternate members per PM line's group — feeds the PR10 edit
    // page's PM Actual-Material picker (§83.4.1). Resolved from material_group_id,
    // same source create validates a substitute against.
    const groupMemberMap = await getMaterialGroupMemberIdsByGroupIds(
      lineRows.filter((line) => String(line.line_type) === "PM")
        .map((line) => String(line.material_group_id ?? "")),
    );
    const alternateMemberIds = [...new Set(
      [...groupMemberMap.values()].flat().filter(Boolean),
    )];
    const [poMaterialMap, lineMaterialMap, slocMap, machineMap] = await Promise.all([
      getMaterialMapByIds(
        [String(poRow.material_id ?? "")],
        "[packing_order.getPackingOrder]",
        "PROD_PACK_FETCH_FAILED",
        "id, pace_code, material_name, shade_code",
      ),
      getMaterialMapByIds(
        [
          ...lineRows.map((line) => String(line.material_id ?? "")),
          ...lineRows.map((line) => String(line.actual_material_id ?? "")),
          ...alternateMemberIds,
        ],
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
          actual_material: lineMaterialMap.get(String(line.actual_material_id ?? "")) ?? null,
          storage_location: slocMap.get(String(line.issue_sloc_id ?? "")) ?? null,
          // PM alternate members (excluding the formulation material itself) so
          // the PR10 edit page can offer a substitute picker (§83.4.1).
          allowed_alternate_materials: String(line.line_type) === "PM"
            ? (groupMemberMap.get(String(line.material_group_id ?? "")) ?? [])
                .filter((memberId) => memberId && memberId !== String(line.material_id ?? ""))
                .map((memberId) => lineMaterialMap.get(memberId))
                .filter(Boolean)
            : [],
        })),
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_FETCH_FAILED";
    return packErr(req, ctx, code, 500, "Packing order fetch failed");
  }
}

// POST /api/production/packing-orders
// Creates at STANDARD from Company + Type + FG SKU + num_packs. FG/SFG lines
// (material, qty, storage location) are fully derived from the SKU's ACTIVE
// Pack BOM — never re-entered. PM lines take material+qty from Pack BOM too;
// only the PM issue storage location is user-picked per line (dropdown of the
// company's active locations, same pattern as Process PO's RM/PM lines) since
// Pack BOM never stores a PM storage location (§83.15) and the segment-based
// default table has no data in Dev. SFG batch is NOT chosen here — that
// happens at Final (see finalizePackingOrderHandler) per locked design.
export async function createPackingOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const body = await parseBody(req);

    const companyId = toTrimmedString(body.company_id);
    const requestedSourcePoType = toUpperTrimmedString(body.source_po_type || mapPackingTypeToSourceType(toTrimmedString(body.po_type)));
    const canonicalSourcePoType = requestedSourcePoType === "ZTEST" ? "MTEST" : requestedSourcePoType;
    const poType = toUpperTrimmedString(body.po_type) || mapSourceTypeToPackingType(canonicalSourcePoType);
    const materialId = toTrimmedString(body.material_id);
    const numPacks = parsePositiveInt(body.num_packs);
    const fillQtyPerPack = numberOrNull(body.fill_qty_per_pack);
    const pmLocationInputs = Array.isArray(body.pm_lines) ? body.pm_lines as JsonRecord[] : [];

    if (!companyId || !VALID_PACK_PO_TYPES.has(poType) || !["MTO", "HPS", "MTS", "MTEST"].includes(canonicalSourcePoType) || !materialId || !numPacks) {
      return packErr(req, ctx, "PROD_PACK_INVALID", 400, "company_id, po_type, material_id and num_packs required");
    }
    await assertPackingCompanyScope(ctx, companyId);
    if (!(await canMaintainCompanyResource(ctx, companyId, "PROD_PO_CREATE", "WRITE"))) {
      return packErr(req, ctx, "PROD_PACK_COMPANY_ACCESS_DENIED", 403, "You do not have edit access to Packing PO for this company.");
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
      .select("id, pack_code, bom_required, outer_uom_code")
      .eq("pack_code", toTrimmedString((sku as JsonRecord).pack_code))
      .maybeSingle();
    if (packCodeErr) throw new Error("PROD_PACK_CODE_LOOKUP_FAILED");
    if (!packCodeRow) return packErr(req, ctx, "PROD_PACK_CODE_NOT_FOUND", 422, "FG SKU pack code is not configured");
    const packCodeId = String((packCodeRow as JsonRecord).id ?? "");
    const bomRequired = (packCodeRow as JsonRecord).bom_required !== false;

    if (!bomRequired && !fillQtyPerPack) {
      return packErr(req, ctx, "PROD_PACK_FILL_QTY_REQUIRED", 400, "fill_qty_per_pack is required for this pack code");
    }

    const { data: bom, error: bomErr } = await serviceRoleClient
      .schema("erp_production")
      .from("pack_bom")
      .select(`
        id, company_id, sku_material_id, status,
        lines:pack_bom_line(
          id, line_type, material_id, qty, uom_code, storage_location_id, movement_type_code,
          has_alternate, material_group_id, display_order
        )
      `)
      .eq("company_id", companyId)
      .eq("sku_material_id", materialId)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (bomErr) throw new Error("PROD_PACK_BOM_LOOKUP_FAILED");
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
    if (!toTrimmedString(outputLine.storage_location_id) || !toTrimmedString(sfgBomLine.storage_location_id)) {
      return packErr(req, ctx, "PROD_PACK_BOM_SLOC_MISSING", 422, "Pack BOM OUTPUT/SFG storage locations are not set");
    }

    const sfgQtyPerPack = bomRequired ? (parsePositiveNumber(sfgBomLine.qty) ?? 0) : (fillQtyPerPack ?? 0);
    const plannedQtyKg = sfgQtyPerPack * numPacks;
    if (!plannedQtyKg) {
      return packErr(req, ctx, "PROD_PACK_QTY_INVALID", 400, "Could not derive a valid planned quantity from the Pack BOM");
    }

    // PM lines source differs by pack type:
    // - Fixed Pack BOM (bomRequired=true): material/dosage/alternate/group come
    //   from the Pack BOM, never re-entered — only the issue storage location
    //   (and an optional validated substitute) is user-picked per line, since
    //   Pack BOM never stores a location (§83.15) and the segment-default
    //   table has no Dev data.
    // - 599/000/001 (bomRequired=false): these pack codes carry NO PM lines on
    //   the Pack BOM at all (OUTPUT+SFG only, PM "optional/zero" per §83.15) —
    //   there is nothing to derive from. The user adds PM lines fresh at
    //   Standard, exactly like Process PO's own RM/PM manual-entry pattern:
    //   material, dosage-per-pack, storage location, and alternate/group are
    //   all caller-supplied every time.
    type NormalizedPmLine = {
      materialId: string; actualMaterialId: string | null; effectiveMaterialId: string;
      qty: number; uomCode: string; storageLocationId: string | null;
      hasAlternate: boolean; materialGroupId: string | null; displayOrder: number;
    };
    let normalizedPmLines: NormalizedPmLine[];
    if (bomRequired) {
      const pmLocationByMaterialId = new Map(
        pmLocationInputs
          .map((line) => [toTrimmedString(line.material_id), toTrimmedString(line.storage_location_id)] as const)
          .filter(([materialIdKey, slocId]) => materialIdKey && slocId),
      );
      const pmActualMaterialByMaterialId = new Map(
        pmLocationInputs
          .map((line) => [toTrimmedString(line.material_id), toTrimmedString(line.actual_material_id)] as const)
          .filter(([materialIdKey, actualId]) => materialIdKey && actualId),
      );
      const allowedAlternateMap = await buildAllowedAlternateIdsByPackBomLines(pmBomLines);
      for (const line of pmBomLines) {
        const formulationMaterialId = String(line.material_id ?? "");
        const requestedActualId = pmActualMaterialByMaterialId.get(formulationMaterialId);
        if (!requestedActualId) continue;
        const allowedIds = allowedAlternateMap.get(formulationMaterialId) ?? [];
        if (!allowedIds.includes(requestedActualId)) {
          return packErr(req, ctx, "PROD_PACK_SUBSTITUTE_NOT_REGISTERED", 422, "actual_material_id must match a registered Pack BOM alternate group member");
        }
      }
      normalizedPmLines = pmBomLines.map((line, idx) => {
        const formulationMaterialId = String(line.material_id ?? "");
        const requestedActualId = pmActualMaterialByMaterialId.get(formulationMaterialId) || null;
        const allowedIds = allowedAlternateMap.get(formulationMaterialId) ?? [];
        const actualMaterialId = requestedActualId && allowedIds.includes(requestedActualId) ? requestedActualId : null;
        return {
          materialId: formulationMaterialId,
          actualMaterialId,
          effectiveMaterialId: actualMaterialId || formulationMaterialId,
          qty: (parsePositiveNumber(line.qty) ?? 0) * numPacks,
          uomCode: toTrimmedString(line.uom_code),
          storageLocationId: pmLocationByMaterialId.get(formulationMaterialId) ?? null,
          hasAlternate: Boolean(line.has_alternate),
          materialGroupId: toTrimmedString(line.material_group_id) || null,
          displayOrder: Number(line.display_order ?? idx) + 10,
        };
      }).filter((line) => line.materialId && line.qty > 0);
    } else {
      normalizedPmLines = pmLocationInputs.map((line, idx) => {
        const matId = toTrimmedString(line.material_id);
        const dosagePerPack = parsePositiveNumber(line.dosage_per_pack ?? line.dosage_per_sku) ?? 0;
        const hasAlternate = Boolean(line.has_alternate);
        return {
          materialId: matId,
          actualMaterialId: null,
          effectiveMaterialId: matId,
          qty: dosagePerPack * numPacks,
          uomCode: toTrimmedString(line.uom_code),
          storageLocationId: toTrimmedString(line.storage_location_id) || null,
          hasAlternate,
          materialGroupId: hasAlternate ? (toTrimmedString(line.material_group_id) || null) : null,
          displayOrder: idx + 10,
        };
      }).filter((line) => line.materialId && line.qty > 0);
      if (normalizedPmLines.length > 0) {
        const pmMaterialTypeMap = await getMaterialMapByIds(
          normalizedPmLines.map((line) => line.materialId),
          "[packing_order.createPackingOrder]",
          "PROD_PACK_MATERIAL_LOOKUP_FAILED",
          "id, material_type",
        );
        if (normalizedPmLines.some((line) => String(pmMaterialTypeMap.get(line.materialId)?.material_type) !== "PM")) {
          return packErr(req, ctx, "PROD_PACK_PM_ONLY", 422, "Only PM materials are allowed in PM lines");
        }
      }
    }
    if (normalizedPmLines.some((line) => !line.storageLocationId)) {
      return packErr(req, ctx, "PROD_PACK_PM_SLOC_REQUIRED", 400, "Select an issue storage location for every PM line");
    }

    if (normalizedPmLines.length > 0) {
      const companyLocationIds = await getCompanyStorageLocationIds(companyId);
      if (normalizedPmLines.some((line) => !companyLocationIds.has(String(line.storageLocationId)))) {
        return packErr(req, ctx, "PROD_PACK_PM_SLOC_INVALID", 422, "PM storage location must be active and mapped to the selected company");
      }
    }

    const materialMap = await getMaterialMapByIds(
      [
        String(sfgBomLine.material_id ?? ""),
        materialId,
        ...normalizedPmLines.map((line) => line.materialId),
        ...normalizedPmLines.map((line) => line.effectiveMaterialId),
      ],
      "[packing_order.createPackingOrder]",
      "PROD_PACK_MATERIAL_LOOKUP_FAILED",
      "id, material_type, base_uom_code",
    );

    // SFG batch selection remains a Final-only step. Create should not block on
    // batch-blind total SFG availability; the exact batch/stock validation still
    // happens at Final before posting.

    // PM availability is checked against the effective (actual/substitute if
    // given, else formulation) material — that's what will really be drawn.
    const pmNeeds: PackingPmNeed[] = normalizedPmLines.map((line) => ({
      materialId: line.effectiveMaterialId,
      storageLocationId: String(line.storageLocationId),
      qty: line.qty,
    }));
    if (pmNeeds.length > 0) {
      const availabilityRows = await computePackingAvailability(companyId, null, pmNeeds);
      for (const row of availabilityRows.pm.values()) {
        if (row.short > 0) throw new Error("PROD_PACK_PM_SHORTAGE");
      }
    }

    const poNumber = await generateGlobalDocNumber("PACK_PO");
    const now = new Date().toISOString();

    const { data: packPo, error: insertErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order")
      .insert({
        company_id: companyId,
        po_number: poNumber,
        po_type: poType,
        source_po_type: canonicalSourcePoType,
        process_order_id: null,
        machine_id: null,
        batch_number: null,
        material_id: materialId,
        pack_code_id: packCodeId,
        fill_qty_per_pack: sfgQtyPerPack,
        num_packs: numPacks,
        sku_qty: numPacks,
        fg_conversion_qty: 1,
        sfg_conversion_qty: sfgQtyPerPack,
        planned_qty_kg: plannedQtyKg,
        total_qty_kg: plannedQtyKg,
        status: "STANDARD",
        segment_code: canonicalSourcePoType,
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
        // FG stock always posts in KG (base UOM, locked design) — total_qty
        // must match plannedQtyKg, never numPacks (a raw pack count would post
        // e.g. "2" instead of "460 KG" to stock_ledger). num_packs is already
        // tracked at the header for "how many containers" purposes.
        packing_order_id: packPoId,
        line_type: "FG",
        material_id: materialId,
        batch_number: null,
        qty_per_pack: sfgQtyPerPack,
        total_qty: plannedQtyKg,
        actual_qty: null,
        issue_sloc_id: toTrimmedString(outputLine.storage_location_id),
        uom_code: toTrimmedString((sku as JsonRecord).base_uom_code) || "KG",
        movement_type_code: toTrimmedString(outputLine.movement_type_code) || "P101",
        has_alternate: false,
        material_group_id: null,
        display_order: 1,
      },
      {
        packing_order_id: packPoId,
        line_type: "SFG",
        material_id: sfgBomLine.material_id,
        batch_number: null, // chosen at Final
        qty_per_pack: sfgQtyPerPack,
        total_qty: plannedQtyKg,
        actual_qty: null,
        issue_sloc_id: toTrimmedString(sfgBomLine.storage_location_id),
        uom_code: "KG",
        movement_type_code: toTrimmedString(sfgBomLine.movement_type_code) || "P261",
        has_alternate: false,
        material_group_id: null,
        display_order: 2,
      },
      ...normalizedPmLines.map((line) => ({
        packing_order_id: packPoId,
        line_type: "PM",
        // material_id always stays the Pack BOM formulation material;
        // actual_material_id (nullable) carries the validated substitute —
        // same split as process_order_line, so stock draws against the
        // effective material while costing/Reco can still see the original.
        material_id: line.materialId,
        actual_material_id: line.actualMaterialId,
        batch_number: null,
        qty_per_pack: line.qty / numPacks,
        total_qty: line.qty,
        actual_qty: null,
        issue_sloc_id: line.storageLocationId,
        uom_code: line.uomCode || toTrimmedString(materialMap.get(line.effectiveMaterialId)?.base_uom_code) || "KG",
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
      .select("id, line_type, material_id, actual_material_id, batch_number, total_qty, issue_sloc_id, display_order, uom_code");
    if (lineErr) {
      console.error("[packing_order.createPackingOrder] line insert failed:", JSON.stringify(lineErr));
      await cleanupPackingOrderAfterCreateFailure(packPoId, "line insert failure");
      throw new Error("PROD_PACK_LINES_CREATE_FAILED");
    }

    // SFG and PM reservations both open at Create (§83.5-addendum). SFG's
    // batch_number stays NULL until Final assigns one — see
    // finalizePackingOrderHandler, which upgrades this same reservation row.
    const reservationRows: JsonRecord[] = ((insertedLines ?? []) as JsonRecord[])
      .filter((line) => String(line.line_type) !== "FG")
      .map((line) => ({
        source_type: "PACKING_PO",
        source_id: packPoId,
        source_line_id: line.id,
        company_id: companyId,
        // Reserve against the effective (actual/substitute if set) material —
        // that's what will really be drawn from stock, matching pmNeeds above.
        material_id: toTrimmedString(line.actual_material_id) || line.material_id,
        storage_location_id: toTrimmedString(line.issue_sloc_id) || null,
        required_qty: Number(line.total_qty ?? 0),
        uom_code: toTrimmedString(line.uom_code) || "KG",
        issued_qty: 0,
        status: "OPEN",
        batch_number: null,
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

// PATCH /api/production/packing-orders/:id/edit  (PR10 — feasibility §83.4.1)
//
// Proper Packing PO edit at STANDARD. Unlike the legacy lines-only update, this
// keeps the SFG + PM reservations in sync when num_packs / fill change — the gap
// that made the old edit unsafe (num_packs changed, reservation left stale).
//
// Scaling mirrors Process PO's RM-dosage scaling: every line's total = its stored
// qty_per_pack × new num_packs, so the recipe stays proportional with no float
// drift. For bomRequired=false pack codes, fill is a real lever and drives the
// FG/SFG per-pack; for bomRequired=true the SFG per-pack is BOM-fixed, so fill is
// ignored there.
export async function editPackingOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const id = getIdFromPath(req);
    if (!id) return packErr(req, ctx, "PROD_PACK_INVALID", 400, "Packing PO id required");
    const body = (await req.json().catch(() => ({}))) as JsonRecord;

    const { data: poRow, error: poErr2 } = await serviceRoleClient
      .schema("erp_production").from("packing_order")
      .select("id, company_id, status, num_packs, fill_qty_per_pack, pack_code_id, po_type")
      .eq("id", id).maybeSingle();
    if (poErr2) throw new Error("PROD_PACK_EDIT_FAILED");
    if (!poRow) return packErr(req, ctx, "PROD_PACK_NOT_FOUND", 404, "Packing PO not found");
    const po = poRow as JsonRecord;
    try {
      await assertPackingCompanyScope(ctx, String(po.company_id ?? ""));
    } catch {
      return packErr(req, ctx, "PROD_PACK_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainCompanyResource(ctx, String(po.company_id ?? ""), "PROD_PO_EDIT", "EDIT"))) {
      return packErr(req, ctx, "PROD_PACK_COMPANY_ACCESS_DENIED", 403, "You do not have edit access to Packing PO for this company.");
    }
    if (String(po.status) !== "STANDARD") {
      return packErr(req, ctx, "PROD_PACK_STATUS_LOCKED", 422, "Packing PO is editable only at STANDARD status.");
    }

    // bomRequired decides whether fill is a user lever (§83.4.1).
    let bomRequired = true;
    if (po.pack_code_id) {
      const { data: pc } = await serviceRoleClient
        .schema("erp_production").from("pack_code_master")
        .select("bom_required").eq("id", po.pack_code_id as string).maybeSingle();
      bomRequired = (pc as JsonRecord | null)?.bom_required !== false;
    }

    const oldNumPacks = parsePositiveInt(po.num_packs) ?? 0;
    const newNumPacks = Object.prototype.hasOwnProperty.call(body, "num_packs")
      ? parsePositiveInt(body.num_packs) : oldNumPacks;
    if (!newNumPacks || newNumPacks <= 0) {
      return packErr(req, ctx, "PROD_PACK_INVALID", 400, "num_packs must be a positive integer");
    }
    // fill only editable for bomRequired=false; ignored otherwise.
    const oldFill = parsePositiveNumber(po.fill_qty_per_pack) ?? 0;
    const newFill = (!bomRequired && Object.prototype.hasOwnProperty.call(body, "fill_qty_per_pack"))
      ? (parsePositiveNumber(body.fill_qty_per_pack) ?? oldFill) : oldFill;
    if (!bomRequired && (!newFill || newFill <= 0)) {
      return packErr(req, ctx, "PROD_PACK_FILL_QTY_REQUIRED", 400, "fill_qty_per_pack must be positive for this pack code");
    }

    const now = new Date().toISOString();

    const { data: lineRows, error: lineErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order_line")
      .select("id, line_type, material_id, actual_material_id, qty_per_pack, total_qty, issue_sloc_id, has_alternate, material_group_id")
      .eq("packing_order_id", id);
    if (lineErr) throw new Error("PROD_PACK_EDIT_FAILED");
    const lines = (lineRows ?? []) as JsonRecord[];

    // Optional per-line edits (sloc + alternate), keyed by line id — same shape as create's pm_lines.
    const pmEdits = new Map<string, JsonRecord>();
    if (Array.isArray(body.pm_lines)) {
      for (const pl of body.pm_lines as JsonRecord[]) {
        const lid = toTrimmedString(pl.id);
        if (lid) pmEdits.set(lid, pl);
      }
    }

    // ── recompute every line ─────────────────────────────────────────────────
    // total = qty_per_pack × new num_packs. For bomRequired=false the FG/SFG
    // per-pack IS the fill, so update those two lines' qty_per_pack first.
    type LineUpdate = {
      id: string; line_type: string; qty_per_pack: number; total_qty: number;
      issue_sloc_id?: string; actual_material_id?: string | null;
      // effectiveMaterialId / effectiveSlocId = the values the reservation must
      // mirror AFTER this edit (actual/substitute if set, else formulation).
      effectiveMaterialId: string; effectiveSlocId: string | null;
    };
    const lineUpdates: LineUpdate[] = [];
    for (const line of lines) {
      const lt = String(line.line_type ?? "");
      let perPack = parsePositiveNumber(line.qty_per_pack) ?? 0;
      if (!bomRequired && (lt === "FG" || lt === "SFG")) perPack = newFill;
      const total = perPack * newNumPacks;

      let nextActual = toTrimmedString(line.actual_material_id) || null;
      let nextSloc = toTrimmedString(line.issue_sloc_id) || null;

      const edit = pmEdits.get(String(line.id));
      if (lt === "PM" && edit) {
        const sloc = toTrimmedString(edit.issue_sloc_id);
        if (sloc) nextSloc = sloc;
        if (Object.prototype.hasOwnProperty.call(edit, "actual_material_id")) {
          const alt = toTrimmedString(edit.actual_material_id) || null;
          if (alt && line.has_alternate !== true) {
            return packErr(req, ctx, "PROD_PACK_SUBSTITUTE_NOT_REGISTERED", 422, "actual_material_id requires a registered alternate on this line");
          }
          nextActual = alt;
        }
      }

      const upd: LineUpdate = {
        id: String(line.id), line_type: lt, qty_per_pack: perPack, total_qty: total,
        effectiveMaterialId: nextActual || String(line.material_id),
        effectiveSlocId: nextSloc,
      };
      if (lt === "PM" && edit) {
        if (nextSloc && nextSloc !== (toTrimmedString(line.issue_sloc_id) || null)) upd.issue_sloc_id = nextSloc;
        if (Object.prototype.hasOwnProperty.call(edit, "actual_material_id")) upd.actual_material_id = nextActual;
      }
      lineUpdates.push(upd);
    }

    // ── PM availability re-check (SFG batch not chosen until Final) ───────────
    // Checks the POST-edit effective material + location — the new values, so a
    // material/location swap is validated against the stock it will really draw.
    const pmNeeds: PackingPmNeed[] = [];
    for (const u of lineUpdates) {
      if (u.line_type !== "PM") continue;
      if (u.effectiveMaterialId && u.effectiveSlocId) {
        pmNeeds.push({ materialId: u.effectiveMaterialId, storageLocationId: u.effectiveSlocId, qty: u.total_qty });
      }
    }
    if (pmNeeds.length > 0) {
      const avail = await computePackingAvailability(String(po.company_id), null, pmNeeds);
      const short: string[] = [];
      for (const [mat, row] of avail.pm.entries()) if (row.short > 0) short.push(mat);
      if (short.length > 0) {
        return packErr(req, ctx, "PROD_PACK_PM_SHORTAGE", 422, `Insufficient PM stock for ${short.length} material(s) at the new quantity`);
      }
    }

    // ── apply: lines, then header, then reservations ─────────────────────────
    // INDEPENDENT (§8B): each line update touches a different row.
    //
    // packing_order_line has NO last_updated_at/last_updated_by columns (unlike
    // packing_order and reservation_document) — confirmed against live schema.
    // Including them here previously made every one of these updates fail with
    // 42703, silently: the Supabase client resolves {data, error} rather than
    // throwing, and this call ignored .error, so Promise.all resolved "clean"
    // while every line update actually failed. Header + reservations (checked
    // below) still succeeded, so the PO looked edited while its lines were
    // untouched — exactly the mismatch reported (num_packs changed, line
    // total_qty did not). Fixed by dropping the nonexistent columns AND
    // checking .error on every result, so a schema mismatch fails loudly.
    const lineUpdateResults = await Promise.all(lineUpdates.map((u) => {
      const patch: JsonRecord = { qty_per_pack: u.qty_per_pack, total_qty: u.total_qty };
      if (u.issue_sloc_id) patch.issue_sloc_id = u.issue_sloc_id;
      if (Object.prototype.hasOwnProperty.call(u, "actual_material_id")) patch.actual_material_id = u.actual_material_id;
      return serviceRoleClient.schema("erp_production").from("packing_order_line").update(patch).eq("id", u.id);
    }));
    const lineUpdateErr = lineUpdateResults.find((r) => r.error)?.error;
    if (lineUpdateErr) {
      console.error("[packing_order.editPackingOrder] line update failed:", JSON.stringify(lineUpdateErr));
      throw new Error("PROD_PACK_EDIT_FAILED");
    }

    const sfgLine = lineUpdates.find((u) => String(lines.find((l) => String(l.id) === u.id)?.line_type) === "SFG");
    const headerQty = sfgLine ? sfgLine.total_qty : (oldFill * newNumPacks);
    // packing_order carries planned_qty_kg AND total_qty_kg as separate columns
    // (create writes both — see createPackingOrderHandler). Order List reads
    // planned_qty_kg; missing it here left the list showing the pre-edit qty
    // even though total_qty_kg (and every line) was correctly recalculated.
    const { error: hdrErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order")
      .update({ num_packs: newNumPacks, fill_qty_per_pack: newFill, total_qty_kg: headerQty, planned_qty_kg: headerQty, last_updated_at: now, last_updated_by: ctx.auth_user_id })
      .eq("id", id);
    if (hdrErr) throw new Error("PROD_PACK_EDIT_FAILED");

    // Reservations must stay aligned with their line on ALL of: material,
    // storage location, and quantity — not just quantity. Matched by
    // source_line_id (create sets it per line), so a PM material/location swap
    // is followed correctly rather than left blocking the old material/location.
    // balance_qty is generated (required_qty − issued_qty) — never written.
    const { data: resRows } = await serviceRoleClient
      .schema("erp_production").from("reservation_document")
      .select("id, source_line_id, status")
      .eq("source_id", id).in("status", RESERVATION_OPEN_STATUSES);
    for (const res of (resRows ?? []) as JsonRecord[]) {
      // DEPENDENT: each reservation mirrors exactly one line, keyed by source_line_id.
      const u = lineUpdates.find((x) => x.id === String(res.source_line_id));
      if (!u) continue;
      const patch: JsonRecord = {
        required_qty: u.total_qty,
        material_id: u.effectiveMaterialId,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      };
      // SFG reservation carries no storage location at STANDARD (batch/location
      // resolved at Final); only set it where the line actually has one.
      if (u.effectiveSlocId) patch.storage_location_id = u.effectiveSlocId;
      const { error: resErr } = await serviceRoleClient
        .schema("erp_production").from("reservation_document")
        .update(patch).eq("id", res.id as string);
      if (resErr) throw new Error("PROD_PACK_EDIT_FAILED");
    }

    return okResponse({ id, num_packs: newNumPacks, fill_qty_per_pack: newFill, total_qty_kg: headerQty }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_EDIT_FAILED";
    return packErr(req, ctx, code, code.includes("SHORTAGE") ? 422 : 500, `Packing PO edit failed: ${err instanceof Error ? err.message : ""}`);
  }
}

// POST /api/production/packing-orders/:id/cancel  (PR10 — feasibility §83.4.1)
// Cancel a STANDARD Packing PO: release SFG + PM reservations, set CANCELLED.
// No stock has moved at STANDARD, so there is nothing to reverse — only
// reservations to release. Reason is mandatory (business owner, 2026-07-19).
export async function cancelPackingOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const id = getIdFromPath(req);
    if (!id) return packErr(req, ctx, "PROD_PACK_INVALID", 400, "Packing PO id required");
    const body = (await req.json().catch(() => ({}))) as JsonRecord;
    const reason = toTrimmedString(body.reason);
    if (!reason) return packErr(req, ctx, "PROD_PACK_CANCEL_REASON_REQUIRED", 400, "A reason is required to cancel a Packing PO.");

    const { data: poRow, error: poErr2 } = await serviceRoleClient
      .schema("erp_production").from("packing_order")
      .select("id, status, company_id").eq("id", id).maybeSingle();
    if (poErr2) throw new Error("PROD_PACK_CANCEL_FAILED");
    if (!poRow) return packErr(req, ctx, "PROD_PACK_NOT_FOUND", 404, "Packing PO not found");
    try {
      await assertPackingCompanyScope(ctx, String((poRow as JsonRecord).company_id ?? ""));
    } catch {
      return packErr(req, ctx, "PROD_PACK_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainCompanyResource(ctx, String((poRow as JsonRecord).company_id ?? ""), "PROD_PO_EDIT", "EDIT"))) {
      return packErr(req, ctx, "PROD_PACK_COMPANY_ACCESS_DENIED", 403, "You do not have edit access to Packing PO for this company.");
    }
    if (String((poRow as JsonRecord).status) !== "STANDARD") {
      return packErr(req, ctx, "PROD_PACK_STATUS_LOCKED", 422, "Only a STANDARD Packing PO can be cancelled here. A finalised PO must be reversed.");
    }

    const now = new Date().toISOString();

    // Release every open reservation for this PO.
    const { error: resErr } = await serviceRoleClient
      .schema("erp_production").from("reservation_document")
      .update({ status: "CANCELLED", last_updated_at: now, last_updated_by: ctx.auth_user_id })
      .eq("source_id", id).in("status", RESERVATION_OPEN_STATUSES);
    if (resErr) throw new Error("PROD_PACK_CANCEL_FAILED");

    const { error: hdrErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order")
      .update({ status: "CANCELLED", cancel_reason: reason, last_updated_at: now, last_updated_by: ctx.auth_user_id })
      .eq("id", id);
    if (hdrErr) throw new Error("PROD_PACK_CANCEL_FAILED");

    return okResponse({ id, status: "CANCELLED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_CANCEL_FAILED";
    return packErr(req, ctx, code, 500, `Packing PO cancel failed: ${err instanceof Error ? err.message : ""}`);
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
      .select("id, status, company_id").eq("id", id).maybeSingle();
    if (!po) return packErr(req, ctx, "PROD_PACK_NOT_FOUND", 404, "Not found");
    try {
      await assertPackingCompanyScope(ctx, String((po as JsonRecord).company_id ?? ""));
    } catch {
      return packErr(req, ctx, "PROD_PACK_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainCompanyResource(ctx, String((po as JsonRecord).company_id ?? ""), "PROD_PO_EDIT", "EDIT"))) {
      return packErr(req, ctx, "PROD_PACK_COMPANY_ACCESS_DENIED", 403, "You do not have edit access to Packing PO for this company.");
    }
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

// §83.18-REVISED (2026-07-23): FO<->Packing PO linking moved to the quantity-level
// allocation endpoints in plan_feed.handlers.ts (upsertFoAllocationHandler /
// listFoAllocationsHandler) -- the old whole-record link-fo action (single FK,
// packing_order.plan_feed_id, now dropped) could not express partial/multi-FO
// allocation. Removed here, not replaced in this file.

// §83.4.1 addendum (2026-07-21): PM-line AP Reco. Mirrors the exact rule the
// frontend's computeRowValues() already applies for Process PO RM/INT lines
// (ProductionPOVerifyPage.jsx / ProductionPOFinalPage.jsx) — NOT the older,
// stale feasibility-doc table ("No→0, Yes→Std"), which the live code
// contradicts. Recomputed server-side, never trusted from the client.
// A brand-new ad-hoc PM line (added at Final) has standardQty=0, so it can
// never auto-match — the caller must always pick an Approved status for it.
function computePmApprovalFields(
  standardQty: number,
  actualQty: number,
  approvedInput: string | null,
  apApprovedInput: number | null,
): { approved: string; apApproved: number; variance: number } {
  const autoYes = Math.abs(actualQty - standardQty) < 0.0001;
  if (autoYes) return { approved: "YES", apApproved: actualQty, variance: 0 };
  const approved = toUpperTrimmedString(approvedInput ?? "") || "YES";
  if (approved === "NO") return { approved, apApproved: standardQty, variance: actualQty - standardQty };
  if (approved === "PARTIAL") {
    const apApproved = apApprovedInput ?? 0;
    return { approved, apApproved, variance: actualQty - apApproved };
  }
  return { approved: "YES", apApproved: actualQty, variance: 0 };
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
    try {
      await assertPackingCompanyScope(ctx, String((po as JsonRecord).company_id ?? ""));
    } catch {
      return packErr(req, ctx, "PROD_PACK_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainCompanyResource(ctx, String((po as JsonRecord).company_id ?? ""), "PROD_PO_FINAL", "WRITE"))) {
      return packErr(req, ctx, "PROD_PACK_COMPANY_ACCESS_DENIED", 403, "You do not have Final posting access for this company.");
    }
    if ((po as JsonRecord).status !== "STANDARD") {
      return packErr(req, ctx, "PROD_PACK_STATUS_INVALID", 422, "Must be STANDARD to finalize");
    }

    const body = await parseBody(req);
    const requestedActualQtyKg = parsePositiveNumber(body.actual_qty_kg);
    const requestedSfgBatchNumber = toTrimmedString(body.sfg_batch_number);

    // §83.4.1 addendum (2026-07-21): PM lines only get Approved/AP-Approved/
    // Variance (mirrors Process PO's computeRowValues rule, recomputed
    // server-side, never trusted from the client) — SFG/FG never deviate in
    // a way requiring approval. A brand-new ad-hoc PM line (no id, extra
    // consumable not in the Pack BOM) is inserted here too; its Std is 0, so
    // it can never auto-match and the caller must always supply an approved
    // status for it.
    const { data: existingLineRows, error: existingLineErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order_line")
      .select("id, line_type, material_id, total_qty, has_alternate, display_order")
      .eq("packing_order_id", id);
    if (existingLineErr) {
      console.error("[packing_order.finalizePackingOrder] existing line query failed:", JSON.stringify(existingLineErr));
      throw new Error("PROD_PACK_FINALIZE_FAILED");
    }
    const existingLineList = (existingLineRows ?? []) as JsonRecord[];
    const existingLineMap = new Map(existingLineList.map((l) => [String(l.id), l]));
    let nextDisplayOrder = existingLineList.reduce((max, l) => Math.max(max, Number(l.display_order ?? 0)), 0) + 1;

    const lineUpdates = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];
    const pmLineIdsForReco: string[] = [];
    for (const lu of lineUpdates) {
      const lineId = toTrimmedString(lu.id);
      const actualQty = parsePositiveNumber(lu.actual_qty) ?? 0;

      if (lineId) {
        const existing = existingLineMap.get(lineId);
        if (!existing) continue;
        const patch: JsonRecord = { actual_qty: actualQty };
        if (String(existing.line_type ?? "") === "PM") {
          if (Object.prototype.hasOwnProperty.call(lu, "actual_material_id")) {
            const alt = toTrimmedString(lu.actual_material_id) || null;
            if (alt && existing.has_alternate !== true) {
              return packErr(req, ctx, "PROD_PACK_SUBSTITUTE_NOT_REGISTERED", 422, "actual_material_id requires a registered alternate on this line");
            }
            patch.actual_material_id = alt;
          }
          const standardQty = Number(existing.total_qty ?? 0);
          const fields = computePmApprovalFields(
            standardQty, actualQty, toTrimmedString(lu.approved_status) || null, parsePositiveNumber(lu.ap_approved_qty),
          );
          patch.approved_status = fields.approved;
          patch.ap_approved_qty = fields.apApproved;
          patch.variance_qty = fields.variance;
          pmLineIdsForReco.push(lineId);
        }
        await serviceRoleClient.schema("erp_production").from("packing_order_line")
          .update(patch).eq("id", lineId).eq("packing_order_id", id);
        continue;
      }

      // Brand-new ad-hoc PM line.
      const materialId = toTrimmedString(lu.material_id);
      if (!materialId || actualQty <= 0) continue;
      const newMaterialMap = await getMaterialMapByIds(
        [materialId], "[packing_order.finalizePackingOrder]", "PROD_PACK_FINALIZE_FAILED", "id, base_uom_code",
      );
      const fields = computePmApprovalFields(
        0, actualQty, toTrimmedString(lu.approved_status) || null, parsePositiveNumber(lu.ap_approved_qty),
      );
      const { data: inserted, error: insertErr } = await serviceRoleClient
        .schema("erp_production").from("packing_order_line")
        .insert({
          packing_order_id: id, line_type: "PM", material_id: materialId,
          qty_per_pack: 0, total_qty: 0, actual_qty: actualQty,
          issue_sloc_id: toTrimmedString(lu.issue_sloc_id) || null,
          display_order: nextDisplayOrder, movement_type_code: "P261",
          uom_code: (newMaterialMap.get(materialId)?.base_uom_code as string | undefined) ?? "KG",
          approved_status: fields.approved, ap_approved_qty: fields.apApproved, variance_qty: fields.variance,
        })
        .select("id").single();
      if (insertErr || !inserted) {
        console.error("[packing_order.finalizePackingOrder] new PM line insert failed:", JSON.stringify(insertErr));
        throw new Error("PROD_PACK_FINALIZE_FAILED");
      }
      nextDisplayOrder += 1;
      pmLineIdsForReco.push(String((inserted as JsonRecord).id));
    }

    const { data: stockLines, error: lineErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order_line")
      .select(`
        id, line_type, material_id, actual_material_id, batch_number, actual_qty, total_qty, issue_sloc_id, uom_code, movement_type_code, stock_ledger_id, approved_status, ap_approved_qty, variance_qty
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
    const sfgLine = lineRows.find((line) => String(line.line_type ?? "") === "SFG") ?? null;
    const fgLine = lineRows.find((line) => String(line.line_type ?? "") === "FG") ?? null;
    const batchBlind = isBatchBlindPackingType(String(poData.po_type ?? ""));
    const effectiveSfgBatchNumber = batchBlind
      ? ""
      : (requestedSfgBatchNumber || toTrimmedString(sfgLine?.batch_number));
    if (!batchBlind && sfgLine && !effectiveSfgBatchNumber) {
      return packErr(req, ctx, "PROD_PACK_SFG_BATCH_REQUIRED", 422, "SFG batch number is required before final posting");
    }
    if (!batchBlind && sfgLine && effectiveSfgBatchNumber) {
      const sfgQty = Number(sfgLine.actual_qty ?? sfgLine.total_qty ?? 0);
      const sfgStorageLocationId = toTrimmedString(sfgLine.issue_sloc_id);
      const sfgMaterialId = toTrimmedString(sfgLine.material_id);
      const sfgBatchOptions = await resolvePackingSfgBatchOptions(
        String(poData.company_id ?? ""),
        sfgMaterialId,
        sfgStorageLocationId,
        id,
      );
      const selectedSfgBatch = sfgBatchOptions.find((batch) => batch.batch_number === effectiveSfgBatchNumber) ?? null;
      if (!selectedSfgBatch) {
        return packErr(req, ctx, "PROD_PACK_SFG_BATCH_REQUIRED", 422, "Selected SFG batch is not available at this storage location");
      }
      if (selectedSfgBatch.available_qty < sfgQty) {
        return packErr(req, ctx, "PROD_PACK_SFG_BATCH_SHORTAGE", 422, "Selected SFG batch does not have enough unrestricted stock");
      }

      const now = new Date().toISOString();
      const updates = [
        serviceRoleClient
          .schema("erp_production")
          .from("packing_order")
          .update({
            batch_number: effectiveSfgBatchNumber,
            process_order_id: selectedSfgBatch.process_order_id,
            machine_id: toTrimmedString(selectedSfgBatch.machine?.id) || null,
            last_updated_at: now,
            last_updated_by: ctx.auth_user_id,
          })
          .eq("id", id),
        serviceRoleClient
          .schema("erp_production")
          .from("packing_order_line")
          .update({ batch_number: effectiveSfgBatchNumber })
          .eq("id", String(sfgLine.id ?? "")),
        serviceRoleClient
          .schema("erp_production")
          .from("reservation_document")
          .update({
            batch_number: effectiveSfgBatchNumber,
            last_updated_at: now,
            last_updated_by: ctx.auth_user_id,
          })
          .eq("source_type", "PACKING_PO")
          .eq("source_id", id)
          .eq("source_line_id", String(sfgLine.id ?? "")),
      ];
      // FG (SKU) receipt carries the same batch identity as its parent Process
      // PO batch (§83.7 FG batch/lot identity) — without this, FG stock and the
      // FG Stock Breakdown report can never trace back to the producing batch.
      if (fgLine) {
        updates.push(
          serviceRoleClient
            .schema("erp_production")
            .from("packing_order_line")
            .update({ batch_number: effectiveSfgBatchNumber })
            .eq("id", String(fgLine.id ?? "")),
        );
      }
      const [poBatchUpdate, sfgLineBatchUpdate, reservationBatchUpdate, fgLineBatchUpdate] = await Promise.all(updates);
      const batchUpdateError = poBatchUpdate.error || sfgLineBatchUpdate.error || reservationBatchUpdate.error || fgLineBatchUpdate?.error;
      if (batchUpdateError) {
        console.error("[packing_order.finalizePackingOrder] SFG batch link update failed:", JSON.stringify(batchUpdateError));
        throw new Error("PROD_PACK_SFG_BATCH_LINK_FAILED");
      }
      sfgLine.batch_number = effectiveSfgBatchNumber;
      if (fgLine) fgLine.batch_number = effectiveSfgBatchNumber;
      // PM lines have no batch identity of their own, but they were consumed FOR this
      // specific SFG batch — without this, PM issue rows in the Stock Ledger show no
      // Batch Number at all (same bug class as Process PO's RM issue, found live
      // 2026-08-11). Stamp it here so the posting loop below picks it up uniformly.
      for (const line of lineRows) {
        if (String(line.line_type ?? "") === "PM") {
          line.batch_number = effectiveSfgBatchNumber;
        }
      }
      poData.batch_number = effectiveSfgBatchNumber;
      poData.process_order_id = selectedSfgBatch.process_order_id;
      poData.machine_id = toTrimmedString(selectedSfgBatch.machine?.id) || null;
    }
    const materialMap = await getMaterialMapByIds(
      lineRows.map((line) => toTrimmedString(line.actual_material_id) || String(line.material_id ?? "")),
      "[packing_order.finalizePackingOrder]",
      "PROD_PACK_FINALIZE_FAILED",
      "id, base_uom_code",
    );

    // §106: one Material Document for the whole Final event — the SFG issue, every PM
    // issue and the FG receipt are items under it; the Packing PO number is the reference.
    const finalMatDoc = await generateMaterialDocNumber(String(poData.company_id));

    // §104.8: FG value/KG = (SFG value + Σ PM value) ÷ FG qty. Resolve every input (SFG + PM)
    // line's current UNRESTRICTED rate up front, sum the input value, and derive the FG cost.
    // The SFG rate is the SFG cost set by Process PO Verify (RMC + Conversion); PM rates come
    // from GRN/opening stock. Helper to compute a line's effective (material, sloc) key:
    const lineKey = (line: JsonRecord): { materialId: string; slocId: string } => ({
      materialId: toTrimmedString(line.actual_material_id) || String(line.material_id ?? ""),
      slocId: String((line.issue_sloc_id || (String(line.line_type ?? "") === "PM" ? defaultPmSlocId : null)) ?? ""),
    });
    const inputLines = lineRows.filter(
      (line) => String(line.line_type ?? "") !== "FG" && Number(line.actual_qty ?? line.total_qty ?? 0) > 0,
    );
    const rateMap = await fetchUnrestrictedRates(String(poData.company_id), inputLines.map(lineKey));
    let totalInputValue = 0;
    for (const line of inputLines) {
      const k = lineKey(line);
      totalInputValue += Number(line.actual_qty ?? line.total_qty ?? 0) * (rateMap.get(`${k.materialId}|${k.slocId}`) ?? 0);
    }
    const fgLineForCost = lineRows.find((line) => String(line.line_type ?? "") === "FG");
    const fgQtyForCost = Number(fgLineForCost?.actual_qty ?? fgLineForCost?.total_qty ?? 0);
    const fgCostPerKg = fgQtyForCost > 0 ? totalInputValue / fgQtyForCost : 0;

    // DEPENDENT: all lines share the same brand-new Material Document number (never
    // posted before). post_stock_movement()'s item_number assignment locks existing
    // stock_document rows FOR UPDATE to serialize concurrent callers — but on the very
    // first insert for a document_number there's nothing to lock yet, so parallel calls
    // race and all compute the same item_number, hitting the
    // (document_number, document_year, item_number) unique constraint. Must post one at a time.
    for (const line of lineRows) {
      const lineType = String(line.line_type ?? "");
      const qty = Number(line.actual_qty ?? line.total_qty ?? 0);
      if (qty <= 0) continue;

      // IDEMPOTENCY (CLAUDE.md 8D): this line already posted in an earlier attempt that died
      // before the handler finished. A retry would re-post the same movement and overwrite
      // stock_ledger_id, orphaning the first posting so the reverse handler could never undo
      // it — and would double-count the reservation issue below.
      //
      // Safe against a legitimate re-run: Final only accepts status STANDARD, and reverse
      // ends at REVERSED (never back to STANDARD). Unlike Process PO Verify there is no
      // in-loop accumulator to preserve here — totalInputValue/fgCostPerKg are both computed
      // before the loop — so skipping early is correct.
      //
      // NOTE: stock_ledger_id had to be added to the select above; without it this guard
      // would read undefined on every line and silently never fire.
      if (toTrimmedString(line.stock_ledger_id)) continue;

      const slocId = (line.issue_sloc_id || (lineType === "PM" ? defaultPmSlocId : null)) as string | null;
      if (!slocId) throw new Error("PROD_PACK_LINE_SLOC_REQUIRED");
      // Post against the effective (actual/substitute if set) material — the
      // formulation material_id column is preserved on the line for costing.
      const effectiveMaterialId = toTrimmedString(line.actual_material_id) || String(line.material_id ?? "");
      const mat = materialMap.get(effectiveMaterialId) ?? null;
      const baseUom = (mat?.base_uom_code ?? "KG") as string;
      const movementTypeCode = toTrimmedString(line.movement_type_code) || (lineType === "FG" ? "P101" : "P261");
      const direction = lineType === "FG" ? "IN" : "OUT";
      // §104.8: FG (receipt) enters at the rolled-up FG cost; SFG/PM (issues) leave at their
      // own current rate — which is what feeds totalInputValue above.
      const unitValue = lineType === "FG" ? fgCostPerKg : (rateMap.get(`${effectiveMaterialId}|${slocId}`) ?? 0);
      const posting = await postStockMovement({
        documentNumber: docNumber, documentDate: today, postingDate: today,
        movementTypeCode, companyId: poData.company_id,
        storageLocationId: slocId, materialId: effectiveMaterialId,
        quantity: qty, baseUomCode: toTrimmedString(line.uom_code) || baseUom, unitValue,
        stockTypeCode: "UNRESTRICTED", direction: direction as "IN" | "OUT", postedBy: ctx.auth_user_id,
        batchNumber: (line.batch_number as string | null) ?? null,
        matDoc: finalMatDoc,
        referenceDocumentId: String(poData.id),
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
    }

    const now = new Date().toISOString();
    const actualQtyKg = requestedActualQtyKg ?? Number(poData.planned_qty_kg ?? poData.total_qty_kg ?? 0);
    await serviceRoleClient.schema("erp_production").from("packing_order")
      .update({ status: "FINAL", actual_qty_kg: actualQtyKg, total_qty_kg: actualQtyKg, finalized_at: now, finalized_by: ctx.auth_user_id, last_updated_at: now, last_updated_by: ctx.auth_user_id })
      .eq("id", id);

    // §83.4.1 addendum: commit the PM Reco/Costing layer, one row per PM line
    // (every PM line, not just deviated ones — mirrors Process PO Verify's
    // recoRows.map() over every line). Written only after Final's postings
    // above have all succeeded.
    // §108.2 item 6 — PMTS has no Approved/AP-Approved reco workflow (same reason as
    // Process PO Verify's MTS skip, feasibility §108.4): its real costing is
    // dispatch-triggered/formulation-based/quarterly, so a production-time reco row
    // here would be dead data. Skip the reco doc number too.
    const pmLinesForReco = String(poData.po_type ?? "") === "PMTS" ? [] : lineRows.filter((line) => String(line.line_type ?? "") === "PM");
    if (pmLinesForReco.length > 0) {
      const recoDoc = await generateRecoDocNumber(String(poData.company_id));
      const recoRows = pmLinesForReco.map((line) => {
        const standardQty = Number(line.total_qty ?? 0);
        const actualQty = Number(line.actual_qty ?? line.total_qty ?? 0);
        const fields = computePmApprovalFields(
          standardQty, actualQty,
          toTrimmedString(line.approved_status) || null,
          line.ap_approved_qty != null ? Number(line.ap_approved_qty) : null,
        );
        return {
          company_id: poData.company_id,
          po_number: poData.po_number,
          sku_material_id: poData.material_id,
          batch_number: effectiveSfgBatchNumber || toTrimmedString(poData.batch_number) || null,
          po_type: poData.po_type,
          finalized_at: now,
          packing_order_id: id,
          packing_order_line_id: line.id,
          material_id: toTrimmedString(line.actual_material_id) || String(line.material_id ?? ""),
          formulation_material_id: line.material_id ?? null,
          standard_qty: standardQty,
          actual_qty: actualQty,
          approved_status: fields.approved,
          ap_approved_qty: fields.apApproved,
          variance_qty: fields.variance,
          is_voided: false,
          last_updated_at: now,
          last_updated_by: ctx.auth_user_id,
          reco_document_number: recoDoc.docNumber,
          reco_document_year: recoDoc.docYear,
          source_txn_type: "PRODUCTION",
          reference_document_number: String(poData.po_number),
          reference_document_type: "PACK_PO",
        };
      });
      const { error: recoErr } = await serviceRoleClient
        .schema("erp_production").from("packing_order_line_reco").insert(recoRows);
      if (recoErr) {
        console.error("[packing_order.finalizePackingOrder] reco insert failed:", JSON.stringify(recoErr));
        throw new Error("PROD_PACK_RECO_WRITE_FAILED");
      }
    }

    return okResponse({ id, status: "FINAL", actual_qty_kg: actualQtyKg }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_FINALIZE_FAILED";
    return packErr(req, ctx, code, 500, `Finalize failed: ${err instanceof Error ? err.message : ""}`);
  }
}

// POST /api/production/packing-orders/:id/reverse
export async function reversePackingOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    // ACL-gated via route-acl-registry (PROD_REVERSAL:APPROVE) — no longer a
    // blanket Manager/SA rank check; department grants are actually enforced.
    const id = getIdFromPath(req);
    if (!id) return packErr(req, ctx, "PROD_PACK_ID_MISSING", 400, "ID required");

    const { data: po } = await serviceRoleClient.schema("erp_production").from("packing_order")
      .select("*").eq("id", id).maybeSingle();
    if (!po) return packErr(req, ctx, "PROD_PACK_NOT_FOUND", 404, "Not found");
    const poData = po as JsonRecord;
    try {
      await assertPackingCompanyScope(ctx, String(poData.company_id ?? ""));
    } catch {
      return packErr(req, ctx, "PROD_PACK_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainCompanyResource(ctx, String(poData.company_id ?? ""), "PROD_REVERSAL", "APPROVE"))) {
      return packErr(req, ctx, "PROD_PACK_COMPANY_ACCESS_DENIED", 403, "You do not have reversal access for this company.");
    }
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
          id, line_type, material_id, actual_material_id, batch_number, actual_qty, total_qty, issue_sloc_id, stock_ledger_id
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
      // §106: the reversal is its own Material Document event (no more "-REV" suffix hack);
      // the Packing PO number is the reference and reversal_of_id links each item back to
      // the original posting.
      const revMatDoc = await generateMaterialDocNumber(String(poData.company_id));
      const revDocNum = String(poData.po_number);
      const lineRows = (stockLines ?? []) as JsonRecord[];
      const materialMap = await getMaterialMapByIds(
        lineRows.map((line) => toTrimmedString(line.actual_material_id) || String(line.material_id ?? "")),
        "[packing_order.reversePackingOrder]",
        "PROD_PACK_REVERSE_FAILED",
        "id, base_uom_code",
      );
      const ledgerRefByLedgerId = await resolveStockLedgerRefsByLedgerIds(
        lineRows.map((line) => toTrimmedString(line.stock_ledger_id)),
      );

      // DEPENDENT: same reasoning as finalizePackingOrderHandler — revDocNum is
      // a brand-new document_number (first reversal for this PO), so
      // post_stock_movement()'s FOR UPDATE item_number lock has nothing to
      // lock yet and concurrent calls would race. Post sequentially.
      for (const line of lineRows) {
        if (!line.stock_ledger_id) continue;
        const lineType = String(line.line_type ?? "");
        const qty = Number(line.actual_qty ?? line.total_qty ?? 0);
        if (qty <= 0) continue;
        const slocId = (line.issue_sloc_id || (lineType === "PM" ? defaultPmSlocId : null)) as string | null;
        if (!slocId) throw new Error("PROD_PACK_LINE_SLOC_REQUIRED");
        const effectiveMaterialId = toTrimmedString(line.actual_material_id) || String(line.material_id ?? "");
        const mat = materialMap.get(effectiveMaterialId) ?? null;
        const baseUom = (mat?.base_uom_code ?? "KG") as string;
        const movementTypeCode = lineType === "FG" ? "P102" : "P262";
        const direction = lineType === "FG" ? "OUT" : "IN";
        const ledgerRef = ledgerRefByLedgerId.get(toTrimmedString(line.stock_ledger_id)) ?? null;
        if (!ledgerRef) throw new Error("PROD_PACK_REVERSAL_SOURCE_NOT_FOUND");

        await postStockMovement({
          documentNumber: revDocNum, documentDate: today, postingDate: today,
          movementTypeCode, companyId: poData.company_id,
          storageLocationId: slocId, materialId: effectiveMaterialId,
          // §104.8: reverse at the original leg's own rate for exact value symmetry
          // (an IN reversal at 0 would dilute the restored material's weighted average).
          quantity: qty, baseUomCode: baseUom, unitValue: ledgerRef.rate,
          stockTypeCode: "UNRESTRICTED", direction: direction as "IN" | "OUT",
          postedBy: ctx.auth_user_id,
          reversalOfId: ledgerRef.docId,
          batchNumber: (line.batch_number as string | null) ?? null,
          matDoc: revMatDoc,
          referenceDocumentId: String(poData.id),
        });
      }

      // §83.4.1-addendum: mirrors process_order.reverse's own reco-void step
      // (§104's "CORS behavior = append, not reset-in-place") — a fully
      // reversed Packing PO's PM AP-Reco must stop counting toward billing
      // just like its stock did, or a SUM() over packing_order_line_reco
      // would still recognize PM cost for a PO that no longer exists.
      const { error: recoVoidErr } = await serviceRoleClient
        .schema("erp_production")
        .from("packing_order_line_reco")
        .update({
          is_voided: true,
          voided_at: reverseNow,
          last_updated_at: reverseNow,
          last_updated_by: ctx.auth_user_id,
        })
        .eq("packing_order_id", id)
        .eq("is_voided", false);
      if (recoVoidErr) {
        console.error("[packing_order.reversePackingOrder] reco void failed:", JSON.stringify(recoVoidErr));
        throw new Error("PROD_PACK_REVERSE_FAILED");
      }
    }

    // §83.18-REVISED: a REVERSED Packing PO's qty no longer exists, so any FO
    // allocation against it is stale -- drop those allocation rows too (the FO itself
    // is untouched, exactly like FO Cancel only ever removes the link, never the FO).
    const { error: allocDeleteErr } = await serviceRoleClient
      .schema("erp_production").from("plan_feed_packing_order_allocation")
      .delete().eq("packing_order_id", id);
    if (allocDeleteErr) {
      console.error("[packing_order.reversePackingOrder] allocation cleanup failed:", JSON.stringify(allocDeleteErr));
      throw new Error("PROD_PACK_REVERSE_FAILED");
    }

    await serviceRoleClient.schema("erp_production").from("packing_order")
      .update({
        status: "REVERSED",
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

const PACK_FG_CORRECTION_MOVEMENT_TYPES = new Set(["P101", "P102"]);
const PACK_ISSUE_CORRECTION_MOVEMENT_TYPES = new Set(["P261", "P262"]);

// POST /api/production/packing-orders/:id/correct
// COR6-style append-only correction (locked 2026-08-12, corrected same day — business
// owner overrode the original sign-decides-direction design): the caller sends a
// positive QUANTITY plus an explicit `movement_type` the user picked from a dropdown
// (P101/P102 for the FG line, P261/P262 for SFG/PM lines) — never inferred from a
// number's sign. A brand-new line (missed item) is always PM and must use P261 — there
// is nothing to reverse for a line that didn't exist before.
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
    try {
      await assertPackingCompanyScope(ctx, String(poData.company_id ?? ""));
    } catch {
      return packErr(req, ctx, "PROD_PACK_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainCompanyResource(ctx, String(poData.company_id ?? ""), "PROD_PO_FINAL", "WRITE"))) {
      return packErr(req, ctx, "PROD_PACK_COMPANY_ACCESS_DENIED", 403, "You do not have correction access for this company.");
    }
    if (poData.status !== "FINAL") {
      return packErr(req, ctx, "PROD_PACK_CORRECTION_STATUS_INVALID", 422, "Packing PO must be FINAL to correct");
    }

    const lineIds = corrections.map((line) => toTrimmedString(line.id)).filter(Boolean);
    const { data: dbLines, error: lineErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order_line")
      .select("id, line_type, material_id, actual_material_id, batch_number, actual_qty, total_qty, issue_sloc_id, stock_ledger_id, has_alternate")
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
      [...lineMap.values()].map((line) => toTrimmedString(line.actual_material_id) || String(line.material_id ?? "")),
      "[packing_order.correctPackingOrder]",
      "PROD_PACK_CORRECTION_FAILED",
      "id, base_uom_code",
    );
    const batchBlind = isBatchBlindPackingType(String(poData.po_type ?? ""));
    const sfgIncreaseNeeds = new Map<string, PackingSfgNeed>();
    for (const correction of corrections) {
      const line = lineMap.get(toTrimmedString(correction.id));
      if (!line || String(line.line_type ?? "") !== "SFG" || batchBlind) continue;
      // Locked 2026-08-12, corrected same day (business owner override): caller sends a
      // positive quantity + an explicit movement_type the user picked — P261 = draw more
      // SFG from the batch (needs an availability check), P262 = return SFG (doesn't).
      if (toTrimmedString(correction.movement_type) !== "P261") continue;
      const delta = Math.abs(Number(correction.delta_qty ?? 0));
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

    const ledgerRefByLedgerId = await resolveStockLedgerRefsByLedgerIds(
      [...lineMap.values()].map((line) => toTrimmedString(line.stock_ledger_id)),
    );

    const today = todayIso();
    // §106: this COR6 correction is its own Material Document event; the Packing PO number
    // is the reference.
    const correctionMatDoc = await generateMaterialDocNumber(String(poData.company_id));

    // DEPENDENT: these postings previously ran in parallel safely because they reused the
    // PO's already-existing document_number (so post_stock_movement()'s FOR UPDATE
    // item_number lock had rows to lock). Under §106 they share a BRAND-NEW Material
    // Document number, where the first insert has nothing to lock — parallel calls would
    // race and collide on (document_number, document_year, item_number). Must be sequential.
    const postings: Array<JsonRecord | null> = [];
    // §83.4.1 addendum: PM-line deltas get their own Reco/Costing row (§106 Phase 3
    // append pattern — matches PR19's credit rows, never edits/voids the PRODUCTION
    // row from Final). A correction delta has no Std of its own (it IS the deviation),
    // so approval is always mandatory here, never auto-YES.
    const pmRecoRows: JsonRecord[] = [];
    let newPmLineOffset = 0;
    for (const correction of corrections) {
      const isNewLine = !toTrimmedString(correction.id);
      let line = isNewLine ? null : (lineMap.get(toTrimmedString(correction.id)) ?? null);
      if (!isNewLine && !line) throw new Error("PROD_PACK_LINE_NOT_FOUND");

      // Locked 2026-08-12, corrected same day (business owner override): caller sends a
      // positive quantity + an explicit movement_type the user picked from a dropdown —
      // P101/P102 for FG lines, P261/P262 for SFG/PM lines — never inferred from a sign.
      // A brand-new line (missed item, never on the PO before) is always PM and always a
      // positive addition (movement_type P261) — there is nothing to decrease.
      const lineType = isNewLine ? "PM" : String(line?.line_type ?? "");
      const magnitude = Math.abs(Number(correction.delta_qty ?? 0));
      const movementType = toTrimmedString(correction.movement_type);
      const allowedMovementTypes = lineType === "FG" ? PACK_FG_CORRECTION_MOVEMENT_TYPES : PACK_ISSUE_CORRECTION_MOVEMENT_TYPES;

      let effectiveMaterialId = isNewLine
        ? toTrimmedString(correction.material_id)
        : toTrimmedString(line?.actual_material_id) || String(line?.material_id ?? "");
      const linePatch: JsonRecord = {};
      if (!isNewLine && lineType === "PM" && Object.prototype.hasOwnProperty.call(correction, "actual_material_id")) {
        const alt = toTrimmedString(correction.actual_material_id) || null;
        if (alt && line?.has_alternate !== true) {
          return packErr(req, ctx, "PROD_PACK_SUBSTITUTE_NOT_REGISTERED", 422, "actual_material_id requires a registered alternate on this line");
        }
        linePatch.actual_material_id = alt;
        effectiveMaterialId = alt || String(line?.material_id ?? "");
      }

      if (magnitude === 0) {
        if (!isNewLine && linePatch.actual_material_id !== undefined && line) {
          await serviceRoleClient.schema("erp_production").from("packing_order_line")
            .update(linePatch).eq("id", line.id as string);
        }
        postings.push(null);
        continue;
      }
      if (!allowedMovementTypes.has(movementType)) {
        return packErr(req, ctx, "PROD_PACK_CORRECTION_MOVEMENT_TYPE_INVALID", 400,
          `movement_type must be ${lineType === "FG" ? "P101 or P102" : "P261 or P262"} for line ${toTrimmedString(correction.id) || "new"}`);
      }
      const isIncrease = lineType === "FG" ? movementType === "P101" : movementType === "P261";
      const delta = isIncrease ? magnitude : -magnitude;
      if (isNewLine && !isIncrease) throw new Error("PROD_PACK_CORRECTION_INVALID");
      if (isNewLine && !effectiveMaterialId) throw new Error("PROD_PACK_CORRECTION_MATERIAL_REQUIRED");

      const slocId = isNewLine
        ? (toTrimmedString(correction.storage_location_id) || defaultPmSlocId)
        : ((line?.issue_sloc_id || (lineType === "PM" ? defaultPmSlocId : null)) as string | null);
      if (!slocId) throw new Error("PROD_PACK_LINE_SLOC_REQUIRED");
      const material = materialMap.get(effectiveMaterialId) ?? {};
      const baseUom = (material.base_uom_code ?? "KG") as string;
      const movementTypeCode = movementType;
      const direction = lineType === "FG"
        ? (isIncrease ? "IN" : "OUT")
        : (isIncrease ? "OUT" : "IN");
      // §104.8: every COR6 correction leg posts at the ORIGINAL line's own rate — a decrease
      // reverses the exact value it removed (an IN reversal at 0 would dilute the material's
      // weighted average), and an increase adds/issues at the same per-KG cost the batch was
      // booked at (FG increase = same batch cost; SFG/PM increase records the original issue
      // rate, harmless to the snapshot which consumes OUT at the current rate regardless). A
      // brand-new line has no original posting, so it rates at the CURRENT UNRESTRICTED rate.
      const ledgerRef = isNewLine ? null : (ledgerRefByLedgerId.get(toTrimmedString(line?.stock_ledger_id)) ?? null);
      let reversalOfId: string | null = null;
      if (!isIncrease) {
        reversalOfId = ledgerRef?.docId ?? null;
        if (!reversalOfId) throw new Error("PROD_PACK_REVERSAL_SOURCE_NOT_FOUND");
      }
      let newLineRate = 0;
      if (isNewLine) {
        const rateRows = await fetchUnrestrictedRates(String(poData.company_id), [{ materialId: effectiveMaterialId, slocId }]);
        newLineRate = rateRows.get(`${effectiveMaterialId}|${slocId}`) ?? 0;
      }
      const posting = await postStockMovement({
        documentNumber: poData.po_number as string,
        documentDate: today,
        postingDate: today,
        movementTypeCode,
        companyId: poData.company_id,
        storageLocationId: slocId,
        materialId: effectiveMaterialId,
        quantity: Math.abs(delta),
        baseUomCode: baseUom,
        unitValue: isNewLine ? newLineRate : (ledgerRef?.rate ?? 0),
        stockTypeCode: "UNRESTRICTED",
        direction: direction as "IN" | "OUT",
        postedBy: ctx.auth_user_id,
        reversalOfId,
        batchNumber: isNewLine ? null : ((line?.batch_number as string | null) ?? null),
        matDoc: correctionMatDoc,
        referenceDocumentId: String(poData.id),
      });

      if (isNewLine) {
        const { data: insertedLine, error: insertErr } = await serviceRoleClient
          .schema("erp_production").from("packing_order_line")
          .insert({
            packing_order_id: id,
            line_type: "PM",
            material_id: effectiveMaterialId,
            actual_material_id: null,
            batch_number: null,
            qty_per_pack: Number(poData.num_packs) > 0 ? delta / Number(poData.num_packs) : delta,
            total_qty: delta,
            actual_qty: delta,
            issue_sloc_id: slocId,
            uom_code: baseUom,
            movement_type_code: "P261",
            has_alternate: false,
            material_group_id: null,
            display_order: 1000 + lineMap.size + newPmLineOffset++,
            stock_ledger_id: posting.stock_ledger_id,
          })
          .select("id").single();
        if (insertErr) {
          console.error("[packing_order.correctPackingOrder] new line insert failed:", JSON.stringify(insertErr));
          throw new Error("PROD_PACK_CORRECTION_FAILED");
        }
        line = { id: (insertedLine as JsonRecord).id, line_type: "PM", material_id: effectiveMaterialId };
      } else if (line) {
        // Deliberately does NOT touch stock_ledger_id here (it identifies the line's
        // ORIGINAL Final-time posting, which any future correction's rate/reversal
        // lookup still needs) — only actual_qty (+ any material swap) advances.
        linePatch.actual_qty = Number(line.actual_qty ?? line.total_qty ?? 0) + delta;
        await serviceRoleClient.schema("erp_production").from("packing_order_line")
          .update(linePatch).eq("id", line.id as string);
      }
      postings.push({ line_id: line?.id, movement_type_code: movementTypeCode, stock_ledger_id: posting.stock_ledger_id });

      // §108.2 item 6 — same PMTS reco skip as Final, applied to COR6 correction rows too.
      if (lineType === "PM" && String(poData.po_type ?? "") !== "PMTS") {
        const approvedInput = toTrimmedString(correction.approved_status) || null;
        const apApprovedInput = parsePositiveNumber(correction.ap_approved_qty);
        const fields = computePmApprovalFields(0, delta, approvedInput, apApprovedInput);
        pmRecoRows.push({
          company_id: poData.company_id,
          po_number: poData.po_number,
          sku_material_id: poData.material_id,
          batch_number: toTrimmedString(poData.batch_number) || null,
          po_type: poData.po_type,
          finalized_at: null,
          packing_order_id: id,
          packing_order_line_id: line?.id,
          material_id: effectiveMaterialId,
          formulation_material_id: isNewLine ? effectiveMaterialId : (line?.material_id ?? null),
          standard_qty: 0,
          actual_qty: delta,
          approved_status: fields.approved,
          ap_approved_qty: fields.apApproved,
          variance_qty: fields.variance,
          is_voided: false,
          last_updated_at: new Date().toISOString(),
          last_updated_by: ctx.auth_user_id,
          reco_document_number: null,
          reco_document_year: "",
          source_txn_type: "COR6_CORRECTION",
          reference_document_number: String(poData.po_number),
          reference_document_type: "PACK_PO",
        });
      }
    }

    if (pmRecoRows.length > 0) {
      const recoDoc = await generateRecoDocNumber(String(poData.company_id));
      for (const row of pmRecoRows) {
        row.reco_document_number = recoDoc.docNumber;
        row.reco_document_year = recoDoc.docYear;
      }
      const { error: recoErr } = await serviceRoleClient
        .schema("erp_production").from("packing_order_line_reco").insert(pmRecoRows);
      if (recoErr) {
        console.error("[packing_order.correctPackingOrder] reco insert failed:", JSON.stringify(recoErr));
        throw new Error("PROD_PACK_RECO_WRITE_FAILED");
      }
    }

    return okResponse({ id, corrections: postings.filter(Boolean) }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_CORRECTION_FAILED";
    return packErr(req, ctx, code, PACK_SHORTAGE_ERROR_CODES.has(code) ? 422 : 500, "Packing order correction failed");
  }
}
