/*
 * MTS Pages 1-6 creation session.
 *
 * Nothing below Page 6 writes a production document.  The preview handlers
 * recompute live data from the header/session payload; only commit calls the
 * database RPC that owns all durable writes in one transaction.
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import { assertProdReadRole, parseBody, parseNonNegativeNumber, parsePositiveInt, parsePositiveNumber, toTrimmedString } from "./production.shared.ts";
import { resolveMtsBatchRangeNumbers } from "./batch_series.handlers.ts";
import { buildMtsMaterialPlanGroupsForOrder, computeMtsAutoDeriveRowsForGroup } from "./process_order.handlers.ts";
import { fetchPackSizeOptions } from "./mts_packing_plan.handlers.ts";

type JsonRecord = Record<string, unknown>;
const EPSILON = 0.0001;
const OPEN_RESERVATION_STATUSES = ["OPEN", "PARTIAL"];

function sessionError(req: Request, ctx: ProdHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function createdResponse(data: unknown, requestId: string, req: Request): Response {
  const response = okResponse(data, requestId, req);
  return new Response(response.body, { status: 201, headers: response.headers });
}

function errorCode(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function isKnownClientError(code: string): boolean {
  return code.startsWith("PROD_MTS_") || code.startsWith("PROD_BATCH_") || code.startsWith("COMPANY_");
}

type SessionHeader = {
  companyId: string;
  materialId: string;
  strokeMasterId: string;
  machineId: string;
  machineStorageLocationId: string;
  strokeShopFloorLocationId: string;
  segmentCode: string;
  productionDate: string;
  shiftId: string;
  batchSize: number;
  plannedQty: number;
  batchNumbers: string[];
  mtsUsedCurrentStroke: boolean;
  strokeNumber: string;
  machineLabel: string;
  prodshade: JsonRecord;
};

async function resolveSessionHeader(body: JsonRecord, ctx: ProdHandlerContext, action: "VIEW" | "WRITE"): Promise<SessionHeader> {
  const header = (body.header && typeof body.header === "object" && !Array.isArray(body.header))
    ? body.header as JsonRecord
    : body;
  const companyId = toTrimmedString(header.company_id);
  const materialId = toTrimmedString(header.material_id || header.prodshade_material_id);
  const strokeMasterId = toTrimmedString(header.stroke_master_id);
  const machineId = toTrimmedString(header.machine_id);
  const segmentCode = toTrimmedString(header.segment_code).toUpperCase();
  const productionDate = toTrimmedString(header.production_date);
  const shiftId = toTrimmedString(header.shift_id);
  const batchSize = parsePositiveNumber(header.batch_size ?? header.planned_qty_kg);
  const numberOfBatches = parsePositiveInt(header.number_of_batches);
  const batchStartSerial = parsePositiveInt(header.batch_start_serial);
  if (!companyId || !materialId || !strokeMasterId || !machineId || !segmentCode || !productionDate || !shiftId || !batchSize || !numberOfBatches || !batchStartSerial) {
    throw new Error("PROD_MTS_SESSION_HEADER_INVALID");
  }
  if (numberOfBatches > 500) throw new Error("PROD_BATCH_RANGE_INVALID");
  try {
    await assertCompanyScope(ctx, companyId);
  } catch {
    throw new Error("COMPANY_SCOPE_VIOLATION");
  }
  if (!(await canMaintainCompanyResource(ctx, companyId, "PROD_PO_CREATE", action))) {
    throw new Error("PROD_PO_COMPANY_ACCESS_DENIED");
  }

  const [{ data: stroke, error: strokeErr }, { data: machine, error: machineErr }, { data: shift, error: shiftErr }, { data: prodshade, error: prodshadeErr }] = await Promise.all([
    serviceRoleClient.schema("erp_production").from("stroke_master")
      .select("id, company_id, prodshade_material_id, status, stroke_number, default_storage_location_id")
      .eq("id", strokeMasterId).maybeSingle(),
    serviceRoleClient.schema("erp_master").from("machine_master")
      .select("id, company_id, active, machine_code, machine_name, storage_location_id")
      .eq("id", machineId).maybeSingle(),
    serviceRoleClient.schema("erp_production").from("shift_master")
      .select("id, company_id, active").eq("id", shiftId).maybeSingle(),
    serviceRoleClient.schema("erp_master").from("material_master")
      .select("id, pace_code, external_code, material_name, document_name")
      .eq("id", materialId).maybeSingle(),
  ]);
  if (strokeErr || machineErr || shiftErr || prodshadeErr) throw new Error("PROD_MTS_SESSION_LOOKUP_FAILED");
  const strokeRow = (stroke ?? {}) as JsonRecord;
  const machineRow = (machine ?? {}) as JsonRecord;
  const shiftRow = (shift ?? {}) as JsonRecord;
  if (!stroke || strokeRow.status !== "APPROVED" || String(strokeRow.company_id ?? "") !== companyId || String(strokeRow.prodshade_material_id ?? "") !== materialId) {
    throw new Error("PROD_PO_STROKE_MATERIAL_MISMATCH");
  }
  if (!machine || machineRow.active !== true || String(machineRow.company_id ?? "") !== companyId) throw new Error("PROD_PO_MACHINE_INVALID");
  if (!shift || shiftRow.active !== true || String(shiftRow.company_id ?? "") !== companyId) throw new Error("PROD_MTS_SHIFT_INVALID");
  if (!prodshade) throw new Error("PROD_MTS_PRODSHADE_INVALID");

  const range = await resolveMtsBatchRangeNumbers(companyId, materialId, batchStartSerial, numberOfBatches);
  if ("errorCode" in range) throw new Error(range.errorCode);
  const { data: currentStroke, error: currentStrokeErr } = await serviceRoleClient
    .schema("erp_production").from("mts_current_stroke")
    .select("stroke_number").eq("company_id", companyId).eq("prodshade_material_id", materialId).maybeSingle();
  if (currentStrokeErr) throw new Error("PROD_MTS_SESSION_LOOKUP_FAILED");
  const currentNumber = toTrimmedString((currentStroke as JsonRecord | null)?.stroke_number);
  const machineStorageLocationId = toTrimmedString(machineRow.storage_location_id);
  const strokeShopFloorLocationId = toTrimmedString(strokeRow.default_storage_location_id);
  if (!machineStorageLocationId || !strokeShopFloorLocationId) throw new Error("PROD_MTS_MACHINE_LOCATION_MISSING");

  return {
    companyId, materialId, strokeMasterId, machineId, machineStorageLocationId, strokeShopFloorLocationId,
    segmentCode, productionDate, shiftId, batchSize, plannedQty: Number((batchSize * numberOfBatches).toFixed(6)),
    batchNumbers: range.numbers,
    mtsUsedCurrentStroke: Boolean(currentNumber) && currentNumber === toTrimmedString(strokeRow.stroke_number),
    strokeNumber: toTrimmedString(strokeRow.stroke_number),
    machineLabel: [toTrimmedString(machineRow.machine_code), toTrimmedString(machineRow.machine_name)].filter(Boolean).join(" - "),
    prodshade: prodshade as JsonRecord,
  };
}

async function getStrokeLines(session: SessionHeader): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient.schema("erp_production").from("stroke_line")
    .select("id, material_id, alternate_material_id, material_group_id, dosage_pct, display_order, default_storage_location_id")
    .eq("stroke_master_id", session.strokeMasterId).order("display_order");
  if (error) throw new Error("PROD_MTS_SESSION_STROKE_LINES_FAILED");
  const rows = (data ?? []) as JsonRecord[];
  if (rows.length === 0) throw new Error("PROD_PO_MTS_PLAN_NO_STROKE_LINES");
  return rows;
}

async function getMaterialMap(ids: string[]): Promise<Map<string, JsonRecord>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data, error } = await serviceRoleClient.schema("erp_master").from("material_master")
    .select("id, pace_code, external_code, material_name, document_name, base_uom_code, material_type")
    .in("id", unique);
  if (error) throw new Error("PROD_MTS_SESSION_MATERIAL_LOOKUP_FAILED");
  return new Map(((data ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
}

async function getStorageLocationMap(ids: string[]): Promise<Map<string, JsonRecord>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data, error } = await serviceRoleClient.schema("erp_inventory").from("storage_location_master")
    .select("id, code, name").in("id", unique);
  if (error) throw new Error("PROD_MTS_SESSION_SLOC_LOOKUP_FAILED");
  return new Map(((data ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
}

function sessionHeaderView(session: SessionHeader): JsonRecord {
  return {
    po_number: "Created only after Page 6",
    status: session.mtsUsedCurrentStroke ? "FINAL on create" : "STANDARD on create",
    mts_used_current_stroke: session.mtsUsedCurrentStroke,
    prodshade_pace_code: toTrimmedString(session.prodshade.pace_code),
    prodshade_material_name: toTrimmedString(session.prodshade.material_name),
    prodshade_description: toTrimmedString(session.prodshade.document_name),
    stroke_number: session.strokeNumber,
    machine_label: session.machineLabel,
    batch_number_from: session.batchNumbers[0] ?? null,
    batch_number_to: session.batchNumbers[session.batchNumbers.length - 1] ?? null,
    number_of_batches: session.batchNumbers.length,
    batch_size: session.batchSize,
    total_qty: session.plannedQty,
  };
}

async function buildMaterialPlanPreview(session: SessionHeader): Promise<JsonRecord> {
  const strokeLines = await getStrokeLines(session);
  const groups = await buildMtsMaterialPlanGroupsForOrder(
    session.companyId, strokeLines, session.machineStorageLocationId, session.strokeShopFloorLocationId,
    session.machineId, session.plannedQty,
  );
  const materialIds = new Set<string>();
  const locationIds = new Set<string>();
  for (const group of groups) {
    materialIds.add(group.stroke_line_material_id);
    locationIds.add(group.storage_location_id);
    for (const row of group.rows) materialIds.add(row.actual_material_id);
    for (const id of group.group_member_ids) materialIds.add(id);
  }
  const [materials, storageLocations] = await Promise.all([getMaterialMap([...materialIds]), getStorageLocationMap([...locationIds])]);
  return {
    saved: false,
    header: sessionHeaderView(session),
    groups,
    materials: Object.fromEntries(materials.entries()),
    storage_locations: Object.fromEntries(storageLocations.entries()),
  };
}

async function fetchCompanyLocations(companyId: string, fOnly = false): Promise<JsonRecord[]> {
  let query = serviceRoleClient.schema("erp_inventory").from("storage_location_plant_map")
    .select("storage_location_id, storage_location_master!inner(id, code, name, active)")
    .eq("company_id", companyId).eq("active", true).eq("storage_location_master.active", true);
  if (fOnly) query = query.ilike("storage_location_master.code", "F%");
  const { data, error } = await query;
  if (error) throw new Error("PROD_MTS_SESSION_SLOC_LOOKUP_FAILED");
  const seen = new Set<string>();
  return ((data ?? []) as JsonRecord[]).map((row) => row.storage_location_master as JsonRecord)
    .filter((row) => row && !seen.has(String(row.id)) && (seen.add(String(row.id)), true));
}

async function buildPackingPlanPreview(session: SessionHeader): Promise<JsonRecord> {
  const [packSizeOptions, locations] = await Promise.all([fetchPackSizeOptions(session.materialId), fetchCompanyLocations(session.companyId, true)]);
  // Packing has no machine/shop-floor bucket rule.  A deterministic ordinary
  // F-location order avoids implying that one machine-specific source is
  // preferred for PM availability.
  const orderedLocations = [...locations].sort((a, b) => String(a.code).localeCompare(String(b.code)));
  return {
    header: {
      po_number: "Created only after Page 6",
      status: "CREATION SESSION",
      total_qty: session.plannedQty,
      number_of_batches: session.batchNumbers.length,
      batch_number_from: session.batchNumbers[0] ?? null,
      batch_number_to: session.batchNumbers[session.batchNumbers.length - 1] ?? null,
    },
    pack_size_options: packSizeOptions,
    storage_location_options: orderedLocations.map((row) => ({ id: String(row.id), code: String(row.code), name: String(row.name) })),
    batch_numbers: session.batchNumbers,
    rows: [],
  };
}

type ResolvedPackingRow = {
  id: string; plan: JsonRecord; packCodeId: string; packSizeLabel: string; fillQty: number;
  numberOfBatches: number; totalOuterUnit: number; volume: number; fgStorageLocationId: string;
  skuMaterialId: string; skuBaseUom: string; outputLine: JsonRecord; sfgLine: JsonRecord; pmLines: JsonRecord[];
};

async function resolveSkuMaterial(prodshade: JsonRecord, packCode: string): Promise<JsonRecord | null> {
  const keys = [...new Set([
    `${toTrimmedString(prodshade.external_code)}${packCode}`.toUpperCase(),
    `${toTrimmedString(prodshade.material_name)}${packCode}`.toUpperCase(),
  ].filter((key) => key !== packCode))];
  if (keys.length === 0) return null;
  const orFilter = keys.flatMap((key) => [`external_code.ilike.${key}`, `material_name.ilike.${key}`]).join(",");
  const { data, error } = await serviceRoleClient.schema("erp_master").from("material_master")
    .select("id, pace_code, external_code, material_name, base_uom_code, material_type")
    .eq("material_type", "FG").or(orFilter);
  if (error) throw new Error("PROD_MTS_SESSION_SKU_LOOKUP_FAILED");
  return (data ?? []).length === 1 ? ((data ?? [])[0] as JsonRecord) : null;
}

async function getActivePackBom(companyId: string, skuMaterialId: string): Promise<{ lines: JsonRecord[] } | null> {
  const { data: bom, error: bomError } = await serviceRoleClient.schema("erp_production").from("pack_bom")
    .select("id").eq("company_id", companyId).eq("sku_material_id", skuMaterialId).eq("status", "ACTIVE").maybeSingle();
  if (bomError) throw new Error("PROD_MTS_SESSION_BOM_LOOKUP_FAILED");
  if (!bom) return null;
  const { data: lines, error: lineError } = await serviceRoleClient.schema("erp_production").from("pack_bom_line")
    .select("line_type, material_id, qty, uom_code, storage_location_id, movement_type_code, has_alternate, material_group_id, display_order")
    .eq("pack_bom_id", String((bom as JsonRecord).id));
  if (lineError) throw new Error("PROD_MTS_SESSION_BOM_LOOKUP_FAILED");
  return { lines: (lines ?? []) as JsonRecord[] };
}

async function resolvePackingRows(session: SessionHeader, rawRows: unknown): Promise<ResolvedPackingRow[]> {
  const rows = Array.isArray(rawRows) ? rawRows as JsonRecord[] : [];
  if (rows.length === 0) throw new Error("PROD_MTS_PACKING_PLAN_EMPTY");
  const packOptions = await fetchPackSizeOptions(session.materialId);
  const packById = new Map(packOptions.map((row) => [String(row.pack_code_id), row]));
  const locationIds = new Set((await fetchCompanyLocations(session.companyId, true)).map((row) => String(row.id)));
  const batchIndex = new Map(session.batchNumbers.map((number, index) => [number, index]));
  const claimed = new Array<boolean>(session.batchNumbers.length).fill(false);
  const resolved: ResolvedPackingRow[] = [];
  for (const [index, row] of rows.entries()) {
    const from = toTrimmedString(row.batch_number_from);
    const to = toTrimmedString(row.batch_number_to);
    const packCodeId = toTrimmedString(row.pack_code_id);
    const outerPerBatch = parsePositiveNumber(row.outer_unit_per_batch);
    const locationId = toTrimmedString(row.storage_location_id);
    const fromIndex = batchIndex.get(from);
    const toIndex = batchIndex.get(to);
    if (!from || !to || !packCodeId || !outerPerBatch || !locationId || fromIndex === undefined || toIndex === undefined || fromIndex > toIndex) {
      throw new Error("PROD_MTS_PACKING_PLAN_ROW_INVALID");
    }
    if (!locationIds.has(locationId)) throw new Error("PROD_MTS_PACKING_PLAN_LOCATION_INVALID");
    for (let i = fromIndex; i <= toIndex; i += 1) {
      if (claimed[i]) throw new Error("PROD_MTS_PACKING_PLAN_BATCH_ALREADY_CLAIMED");
      claimed[i] = true;
    }
    const pack = packById.get(packCodeId);
    if (!pack) throw new Error("PROD_MTS_PACKING_PLAN_PACK_SIZE_INVALID");
    const numberOfBatches = toIndex - fromIndex + 1;
    const totalOuterUnit = Number((numberOfBatches * outerPerBatch).toFixed(6));
    const volume = Number((totalOuterUnit * Number(pack.fill_qty ?? 0)).toFixed(6));
    const sku = await resolveSkuMaterial(session.prodshade, String(pack.pack_code));
    if (!sku) throw new Error("PROD_MTS_PACKING_SKU_NOT_FOUND");
    const bom = await getActivePackBom(session.companyId, String(sku.id));
    if (!bom) throw new Error("PROD_MTS_PACKING_BOM_MISSING");
    const outputLine = bom.lines.find((line) => toTrimmedString(line.line_type) === "OUTPUT");
    const sfgLine = bom.lines.find((line) => toTrimmedString(line.line_type) === "SFG");
    if (!outputLine || !sfgLine || !toTrimmedString(sfgLine.storage_location_id)) throw new Error("PROD_MTS_PACKING_BOM_INCOMPLETE");
    resolved.push({
      id: toTrimmedString(row.client_row_id) || `row-${index + 1}`,
      plan: { batch_number_from: from, batch_number_to: to, pack_code_id: packCodeId, outer_unit_per_batch: outerPerBatch, storage_location_id: locationId, display_order: index },
      packCodeId, packSizeLabel: String(pack.description ?? pack.pack_code), fillQty: Number(pack.fill_qty ?? 0),
      numberOfBatches, totalOuterUnit, volume, fgStorageLocationId: locationId,
      skuMaterialId: String(sku.id), skuBaseUom: toTrimmedString(sku.base_uom_code) || "KG",
      outputLine, sfgLine, pmLines: bom.lines.filter((line) => toTrimmedString(line.line_type) === "INPUT"),
    });
  }
  // Page 5 declares the actual pack output.  It may be higher or lower than
  // the process plan; Page 6 must still have exactly one pack choice for each
  // physical batch so that its PM need and the persisted yield variance are
  // deterministic.  The atomic Page-6 database trigger records the variance.
  if (claimed.some((used) => !used)) {
    throw new Error("PROD_MTS_PACKING_PLAN_TOTAL_MISMATCH");
  }
  return resolved;
}

type PmGroup = {
  material_id: string; uom_code: string; material_group_id: string | null; has_alternate: boolean;
  storage_location_id: string; source_storage_location_ids: string[]; standard_qty: number;
  group_member_ids: string[]; contributing: Array<{ row_id: string; pack_size_label: string; qty: number }>;
};

async function getGroupMembers(groupIds: string[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(groupIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data, error } = await serviceRoleClient.schema("erp_master").from("material_category_group_member")
    .select("group_id, material_id").in("group_id", ids);
  if (error) throw new Error("PROD_MTS_SESSION_GROUP_LOOKUP_FAILED");
  const result = new Map<string, string[]>();
  for (const row of (data ?? []) as JsonRecord[]) {
    const groupId = toTrimmedString(row.group_id);
    const materialId = toTrimmedString(row.material_id);
    if (groupId && materialId) result.set(groupId, [...(result.get(groupId) ?? []), materialId]);
  }
  return result;
}

function buildPmGroups(rows: ResolvedPackingRow[]): PmGroup[] {
  const byMaterial = new Map<string, PmGroup>();
  for (const row of rows) for (const line of row.pmLines) {
    const materialId = toTrimmedString(line.material_id);
    const qty = Number((Number(line.qty ?? 0) * row.totalOuterUnit).toFixed(6));
    if (!materialId || qty <= 0) continue;
    const existing = byMaterial.get(materialId);
    if (existing) {
      existing.standard_qty = Number((existing.standard_qty + qty).toFixed(6));
      existing.contributing.push({ row_id: row.id, pack_size_label: row.packSizeLabel, qty });
      const locationId = toTrimmedString(line.storage_location_id);
      if (locationId && !existing.source_storage_location_ids.includes(locationId)) {
        existing.source_storage_location_ids.push(locationId);
        existing.storage_location_id = "";
      }
    } else {
      const locationId = toTrimmedString(line.storage_location_id);
      byMaterial.set(materialId, {
        material_id: materialId, uom_code: toTrimmedString(line.uom_code) || "KG",
        material_group_id: toTrimmedString(line.material_group_id) || null, has_alternate: Boolean(line.has_alternate),
        storage_location_id: locationId, source_storage_location_ids: locationId ? [locationId] : [],
        standard_qty: qty, group_member_ids: [materialId],
        contributing: [{ row_id: row.id, pack_size_label: row.packSizeLabel, qty }],
      });
    }
  }
  return [...byMaterial.values()];
}

async function fetchLocationNetAvailability(companyId: string, storageLocationId: string, materialIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(materialIds.filter(Boolean))];
  const balances = new Map<string, number>();
  if (!storageLocationId || ids.length === 0) return balances;
  const [{ data: snapshots, error: snapshotError }, { data: reservations, error: reservationError }] = await Promise.all([
    serviceRoleClient.schema("erp_inventory").from("stock_snapshot").select("material_id, quantity")
      .eq("company_id", companyId).eq("storage_location_id", storageLocationId).eq("stock_type_code", "UNRESTRICTED").in("material_id", ids),
    serviceRoleClient.schema("erp_production").from("reservation_document").select("material_id, balance_qty")
      .eq("company_id", companyId).eq("storage_location_id", storageLocationId).in("material_id", ids).in("status", OPEN_RESERVATION_STATUSES),
  ]);
  if (snapshotError || reservationError) throw new Error("PROD_MTS_SESSION_STOCK_CHECK_FAILED");
  for (const row of (snapshots ?? []) as JsonRecord[]) balances.set(String(row.material_id), Number(row.quantity ?? 0));
  for (const row of (reservations ?? []) as JsonRecord[]) balances.set(String(row.material_id), Number(((balances.get(String(row.material_id)) ?? 0) - Number(row.balance_qty ?? 0)).toFixed(6)));
  return balances;
}

async function defaultPmLocation(companyId: string, segmentCode: string): Promise<string> {
  const { data, error } = await serviceRoleClient.schema("erp_production").from("production_segment_location_config")
    .select("pm_sloc_id").eq("company_id", companyId).eq("segment_code", segmentCode).maybeSingle();
  if (error) throw new Error("PROD_MTS_SESSION_SEGMENT_CONFIG_FAILED");
  return toTrimmedString((data as JsonRecord | null)?.pm_sloc_id);
}

type PackingPreview = { rows: ResolvedPackingRow[]; groups: JsonRecord[]; response: JsonRecord };

async function buildPackingPreview(session: SessionHeader, rawRows: unknown, storageOverrides: Record<string, string> = {}): Promise<PackingPreview> {
  const rows = await resolvePackingRows(session, rawRows);
  const groups = buildPmGroups(rows);
  const [groupMembers, defaultLocation, locationOptions] = await Promise.all([
    getGroupMembers(groups.map((group) => group.material_group_id ?? "")),
    defaultPmLocation(session.companyId, session.segmentCode),
    fetchCompanyLocations(session.companyId),
  ]);
  for (const group of groups) {
    if (group.has_alternate && group.material_group_id) {
      group.group_member_ids = [group.material_id, ...(groupMembers.get(group.material_group_id) ?? []).filter((id) => id !== group.material_id)];
    }
    if (storageOverrides[group.material_id]) group.storage_location_id = storageOverrides[group.material_id];
    if (!group.storage_location_id && group.source_storage_location_ids.length === 0) group.storage_location_id = defaultLocation;
  }
  const validLocations = new Set(locationOptions.map((row) => String(row.id)));
  const remainingByLocation = new Map<string, Map<string, number>>();
  const derivedGroups: JsonRecord[] = [];
  for (const group of groups) {
    if (group.storage_location_id && !validLocations.has(group.storage_location_id)) throw new Error("PROD_MTS_PACKING_PLAN_LOCATION_INVALID");
    let balances = remainingByLocation.get(group.storage_location_id);
    if (!balances) {
      const candidates = groups.filter((entry) => entry.storage_location_id === group.storage_location_id).flatMap((entry) => entry.group_member_ids);
      balances = group.storage_location_id ? await fetchLocationNetAvailability(session.companyId, group.storage_location_id, candidates) : new Map();
      remainingByLocation.set(group.storage_location_id, balances);
    }
    const derived = computeMtsAutoDeriveRowsForGroup({
      formulationMaterialId: group.material_id, dosagePct: null, standardQty: group.standard_qty,
      alternateMaterialIds: group.group_member_ids.filter((id) => id !== group.material_id), bucketBalances: balances,
    });
    for (const row of derived.rows) if (row.actual_qty > EPSILON) balances.set(row.actual_material_id, Number(((balances.get(row.actual_material_id) ?? 0) - row.actual_qty).toFixed(6)));
    derivedGroups.push({ ...group, auto_derive_applicable: true, rows: derived.rows, short: derived.short, shortfall_qty: derived.shortfallQty });
  }
  const materialIds = new Set<string>(); const locationIds = new Set<string>();
  for (const group of derivedGroups) {
    materialIds.add(String(group.material_id));
    for (const id of (group.group_member_ids as string[])) materialIds.add(id);
    for (const row of (group.rows as JsonRecord[])) materialIds.add(String(row.actual_material_id));
    if (group.storage_location_id) locationIds.add(String(group.storage_location_id));
  }
  for (const row of rows) { materialIds.add(row.skuMaterialId); locationIds.add(row.fgStorageLocationId); }
  const [materials, locations] = await Promise.all([getMaterialMap([...materialIds]), getStorageLocationMap([...locationIds])]);
  return {
    rows, groups: derivedGroups,
    response: {
      header: { po_number: "Created only after Page 6", status: "CREATION SESSION", segment_code: session.segmentCode, batch_number_from: session.batchNumbers[0], batch_number_to: session.batchNumbers[session.batchNumbers.length - 1] },
      rows_summary: rows.map((row) => ({ row_id: row.id, pack_size_label: row.packSizeLabel, batch_number_from: row.plan.batch_number_from, batch_number_to: row.plan.batch_number_to, number_of_batches: row.numberOfBatches, total_outer_unit: row.totalOuterUnit, volume: row.volume, sku_material_id: row.skuMaterialId, fg_storage_location_id: row.fgStorageLocationId })),
      groups: derivedGroups,
      pm_storage_location_options: locationOptions.map((row) => ({ id: String(row.id), code: String(row.code), name: String(row.name) })),
      materials: Object.fromEntries(materials.entries()), storage_locations: Object.fromEntries(locations.entries()),
    },
  };
}

function bodyGroupsByKey(value: unknown, key: string): Map<string, JsonRecord> {
  const map = new Map<string, JsonRecord>();
  for (const row of (Array.isArray(value) ? value : []) as JsonRecord[]) {
    const id = toTrimmedString(row[key]); if (id) map.set(id, row);
  }
  return map;
}

async function prepareRmLines(session: SessionHeader, clientGroups: unknown): Promise<JsonRecord[]> {
  const preview = await buildMaterialPlanPreview(session);
  const groups = preview.groups as JsonRecord[];
  const supplied = bodyGroupsByKey(clientGroups, "stroke_line_id");
  const foreignMachine = session.machineStorageLocationId !== session.strokeShopFloorLocationId;
  const finalLines: JsonRecord[] = [];
  let displayOrder = 10;
  for (const group of groups) {
    const groupRows = Array.isArray(group.rows) ? group.rows as JsonRecord[] : [];
    const suppliedGroup = supplied.get(toTrimmedString(group.stroke_line_id));
    let choices: Array<{ actual_material_id: string; actual_qty: number }>;
    if (group.auto_derive_applicable === true) {
      const rows = Array.isArray(suppliedGroup?.rows) && suppliedGroup!.rows.length > 0 ? suppliedGroup!.rows as JsonRecord[] : groupRows;
      const allowed = new Set((group.group_member_ids as string[]).map(String));
      const seen = new Set<string>();
      choices = rows.map((row) => ({ actual_material_id: toTrimmedString(row.actual_material_id), actual_qty: Number(parseNonNegativeNumber(row.actual_qty) ?? 0) }));
      if (choices.some((row) => !row.actual_material_id || !allowed.has(row.actual_material_id) || seen.has(row.actual_material_id) || !seen.add(row.actual_material_id))) throw new Error("PROD_MTS_RM_MATERIAL_INVALID");
    } else {
      const selected = toTrimmedString(suppliedGroup?.actual_material_id);
      if (!selected || !(group.group_member_ids as string[]).includes(selected)) throw new Error("PROD_MTS_RM_MANUAL_PICK_REQUIRED");
      choices = [{ actual_material_id: selected, actual_qty: Number(group.standard_qty ?? 0) }];
    }
    const total = Number(choices.reduce((sum, row) => sum + row.actual_qty, 0).toFixed(6));
    if (Math.abs(total - Number(group.standard_qty ?? 0)) > EPSILON) throw new Error("PROD_MTS_RM_QTY_MISMATCH");
    const machineSource = group.auto_derive_applicable === true;
    for (const [index, row] of choices.entries()) if (row.actual_qty > 0) {
      finalLines.push({
        stroke_line_id: group.stroke_line_id, material_id: group.stroke_line_material_id,
        actual_material_id: row.actual_material_id, planned_qty: index === 0 ? group.standard_qty : 0,
        actual_qty: row.actual_qty, issue_sloc_id: group.storage_location_id, uom_code: "KG",
        dosage_pct: index === 0 ? group.dosage_pct : null, is_formulation_line: index === 0,
        variance_qty: 0, display_order: displayOrder++,
        bucket_source: machineSource ? (foreignMachine ? "UNASSIGNED" : "MACHINE") : "LOCATION",
        bucket_machine_id: machineSource && !foreignMachine ? session.machineId : null,
      });
    }
  }
  if (finalLines.length === 0) throw new Error("PROD_MTS_RM_QTY_MISMATCH");
  return finalLines;
}

function preparePmSelections(preview: PackingPreview, clientGroups: unknown): Map<string, { storageLocationId: string; rows: Array<{ actualMaterialId: string; actualQty: number }> }> {
  const supplied = bodyGroupsByKey(clientGroups, "material_id");
  const result = new Map<string, { storageLocationId: string; rows: Array<{ actualMaterialId: string; actualQty: number }> }>();
  for (const group of preview.groups) {
    const selection = supplied.get(String(group.material_id));
    const storageLocationId = toTrimmedString(selection?.storage_location_id) || toTrimmedString(group.storage_location_id);
    const rows = Array.isArray(selection?.rows) && selection!.rows.length > 0 ? selection!.rows as JsonRecord[] : group.rows as JsonRecord[];
    const allowed = new Set((group.group_member_ids as string[]).map(String)); const seen = new Set<string>();
    const finalRows = rows.map((row) => ({ actualMaterialId: toTrimmedString(row.actual_material_id), actualQty: Number(parseNonNegativeNumber(row.actual_qty) ?? 0) }));
    if (!storageLocationId || finalRows.some((row) => !row.actualMaterialId || !allowed.has(row.actualMaterialId) || seen.has(row.actualMaterialId) || !seen.add(row.actualMaterialId))) throw new Error("PROD_MTS_PM_SELECTION_INVALID");
    const total = Number(finalRows.reduce((sum, row) => sum + row.actualQty, 0).toFixed(6));
    if (Math.abs(total - Number(group.standard_qty ?? 0)) > EPSILON) throw new Error("PROD_MTS_PM_QTY_MISMATCH");
    result.set(String(group.material_id), { storageLocationId, rows: finalRows });
  }
  return result;
}

function buildAtomicPackingOrders(preview: PackingPreview, selections: Map<string, { storageLocationId: string; rows: Array<{ actualMaterialId: string; actualQty: number }> }>): JsonRecord[] {
  const perRow = new Map(preview.rows.map((row) => [row.id, new Map<string, number>()]));
  for (const group of preview.groups) {
    const selection = selections.get(String(group.material_id))!;
    for (const choice of selection.rows) {
      let allocated = 0;
      (group.contributing as Array<{ row_id: string; qty: number }>).forEach((contribution, index, all) => {
        const qty = index === all.length - 1
          ? Number((choice.actualQty - allocated).toFixed(6))
          : Number((choice.actualQty * contribution.qty / Number(group.standard_qty)).toFixed(6));
        allocated = Number((allocated + qty).toFixed(6));
        if (qty > 0) perRow.get(contribution.row_id)!.set(`${group.material_id}::${choice.actualMaterialId}`, qty);
      });
    }
  }
  return preview.rows.map((row) => {
    const pmLines: JsonRecord[] = []; let displayOrder = 10;
    const quantities = perRow.get(row.id)!;
    for (const bomLine of row.pmLines) {
      const formulation = toTrimmedString(bomLine.material_id); if (!formulation) continue;
      const group = preview.groups.find((entry) => String(entry.material_id) === formulation); if (!group) continue;
      const selection = selections.get(formulation)!;
      for (const choice of selection.rows) {
        const qty = quantities.get(`${formulation}::${choice.actualMaterialId}`) ?? 0;
        if (qty <= 0) continue;
        pmLines.push({ line_type: "PM", material_id: formulation, actual_material_id: choice.actualMaterialId === formulation ? null : choice.actualMaterialId, qty_per_pack: Number((qty / row.totalOuterUnit).toFixed(6)), total_qty: qty, issue_sloc_id: selection.storageLocationId, uom_code: toTrimmedString(bomLine.uom_code) || "KG", movement_type_code: "P261", has_alternate: Boolean(bomLine.has_alternate), material_group_id: bomLine.has_alternate ? toTrimmedString(bomLine.material_group_id) || null : null, display_order: displayOrder++ });
      }
    }
    return {
      plan: row.plan,
      header: { material_id: row.skuMaterialId, fill_qty_per_pack: row.fillQty, num_packs: row.totalOuterUnit, sku_qty: row.totalOuterUnit, fg_conversion_qty: 1, sfg_conversion_qty: row.fillQty, planned_qty_kg: row.volume, total_qty_kg: row.volume },
      lines: [
        { line_type: "FG", material_id: row.skuMaterialId, qty_per_pack: row.fillQty, total_qty: row.volume, issue_sloc_id: row.fgStorageLocationId, uom_code: row.skuBaseUom, movement_type_code: toTrimmedString(row.outputLine.movement_type_code) || "P101", has_alternate: false, display_order: 1 },
        { line_type: "SFG", material_id: toTrimmedString(row.sfgLine.material_id), qty_per_pack: row.fillQty, total_qty: row.volume, issue_sloc_id: toTrimmedString(row.sfgLine.storage_location_id), uom_code: "KG", movement_type_code: toTrimmedString(row.sfgLine.movement_type_code) || "P261", has_alternate: false, display_order: 2 },
        ...pmLines,
      ],
    };
  });
}

export async function previewMtsCreationMaterialPlanHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const session = await resolveSessionHeader(await parseBody(req), ctx, "VIEW");
    return okResponse(await buildMaterialPlanPreview(session), ctx.request_id, req);
  } catch (err) {
    const code = errorCode(err, "PROD_MTS_SESSION_MATERIAL_PREVIEW_FAILED");
    return sessionError(req, ctx, code, isKnownClientError(code) ? 422 : 500, "Failed to build MTS Page 4 material plan");
  }
}

export async function previewMtsCreationPackingPlanHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const session = await resolveSessionHeader(await parseBody(req), ctx, "VIEW");
    return okResponse(await buildPackingPlanPreview(session), ctx.request_id, req);
  } catch (err) {
    const code = errorCode(err, "PROD_MTS_SESSION_PACKING_PLAN_PREVIEW_FAILED");
    return sessionError(req, ctx, code, isKnownClientError(code) ? 422 : 500, "Failed to build MTS Page 5 packing plan");
  }
}

export async function previewMtsCreationPackingCombineHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const body = await parseBody(req); const session = await resolveSessionHeader(body, ctx, "VIEW");
    const rawOverrides = body.storage_overrides && typeof body.storage_overrides === "object" && !Array.isArray(body.storage_overrides) ? body.storage_overrides as JsonRecord : {};
    const overrides = Object.fromEntries(Object.entries(rawOverrides).map(([key, value]) => [key, toTrimmedString(value)]).filter(([, value]) => value));
    return okResponse((await buildPackingPreview(session, body.packing_rows, overrides)).response, ctx.request_id, req);
  } catch (err) {
    const code = errorCode(err, "PROD_MTS_SESSION_PACKING_COMBINE_PREVIEW_FAILED");
    return sessionError(req, ctx, code, isKnownClientError(code) ? 422 : 500, "Failed to build MTS Page 6 PM plan");
  }
}

export async function createMtsCreationDocumentsHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const body = await parseBody(req); const session = await resolveSessionHeader(body, ctx, "WRITE");
    const rmLines = await prepareRmLines(session, body.material_groups);
    const selectedPmLocations = Object.fromEntries((Array.isArray(body.pm_groups) ? body.pm_groups as JsonRecord[] : []).map((group) => [toTrimmedString(group.material_id), toTrimmedString(group.storage_location_id)]).filter(([materialId, locationId]) => materialId && locationId));
    const packingPreview = await buildPackingPreview(session, body.packing_rows, selectedPmLocations);
    const pmSelections = preparePmSelections(packingPreview, body.pm_groups);
    const packingOrders = buildAtomicPackingOrders(packingPreview, pmSelections);
    const { data, error } = await serviceRoleClient.schema("erp_production").rpc("create_mts_documents_atomic", {
      p_request: {
        header: {
          company_id: session.companyId, actor_id: ctx.auth_user_id, po_type: "MTS", material_id: session.materialId,
          stroke_master_id: session.strokeMasterId, machine_id: session.machineId, segment_code: session.segmentCode,
          production_date: session.productionDate, shift_id: session.shiftId, planned_qty: session.plannedQty,
          mts_used_current_stroke: session.mtsUsedCurrentStroke,
        },
        batch_numbers: session.batchNumbers,
        rm_lines: rmLines,
        packing_orders: packingOrders,
        snapshot: { page4_material_plan: body.material_groups ?? [], page5_packing_plan: body.packing_rows ?? [], page6_pm_plan: body.pm_groups ?? [] },
      },
    });
    if (error) {
      console.error("[mts_creation_session.create] atomic create failed:", JSON.stringify(error));
      const message = String((error as { message?: string }).message ?? "");
      if (message.includes("PROD_MTS_") || message.includes("PROD_BATCH_")) throw new Error(message.split(":")[0]);
      throw new Error("PROD_MTS_SESSION_CREATE_FAILED");
    }
    return createdResponse(data, ctx.request_id, req);
  } catch (err) {
    const code = errorCode(err, "PROD_MTS_SESSION_CREATE_FAILED");
    return sessionError(req, ctx, code, isKnownClientError(code) ? 422 : 500, "MTS documents were not created; no partial document or reservation was kept");
  }
}
