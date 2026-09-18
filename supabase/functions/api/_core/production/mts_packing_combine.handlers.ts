/*
 * File-Path: supabase/functions/api/_core/production/mts_packing_combine.handlers.ts
 * Domain: PRODUCTION
 * Purpose: §138.16 Page 6 -- combined PM auto-derive across every Page-5
 *          pack-size row, then N-way Save that converts each PLANNED
 *          erp_production.mts_packing_plan_row into a real packing_order
 *          (+lines +reservations), mirroring packing_order.handlers.ts's own
 *          createPackingOrderHandler shape for a single MTO/HPS Packing PO,
 *          just fanned out across every Page-5 row and combined for display.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import { generateGlobalDocNumber } from "./production.utils.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import { assertProdReadRole, parseBody, toTrimmedString, toUpperTrimmedString, parseNonNegativeNumber } from "./production.shared.ts";
import { computeMtsAutoDeriveRowsForGroup } from "./process_order.handlers.ts";
import {
  loadProcessOrderAndAuth,
  fetchOrderedBatchNumbers,
  fetchPackSizeOptions,
} from "./mts_packing_plan.handlers.ts";

type JsonRecord = Record<string, unknown>;
const EPSILON = 0.0001;
const RESERVATION_OPEN_STATUSES = ["OPEN", "PARTIAL"];

function combineErr(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}
function createdOkResponse(data: unknown, requestId: string, req?: Request): Response {
  const response = okResponse(data, requestId, req);
  return new Response(response.body, { status: 201, headers: response.headers });
}

async function getMaterialMapByIds(ids: string[]): Promise<Map<string, JsonRecord>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (uniqueIds.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master").from("material_master")
    .select("id, pace_code, external_code, material_name, base_uom_code, material_type")
    .in("id", uniqueIds);
  if (error) {
    console.error("[mts_packing_combine.getMaterialMapByIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_PACK_COMBINE_MATERIAL_LOOKUP_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

async function getStorageLocationMapByIds(ids: string[]): Promise<Map<string, JsonRecord>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (uniqueIds.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory").from("storage_location_master")
    .select("id, code, name").in("id", uniqueIds);
  if (error) {
    console.error("[mts_packing_combine.getStorageLocationMapByIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_PACK_COMBINE_SLOC_LOOKUP_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

// Same shape as pack_bom.handlers.ts's own buildSkuProdshadeKey -- an FG SKU's
// external_code/material_name is conventionally "<prodshade external_code><pack_code>"
// (e.g. Prodshade "00790908" + pack "320" -> SKU "00790908320"). Duplicated here
// (file-local, same convention every *.handlers.ts in this domain follows) rather
// than importing across handler files.
function buildSkuProdshadeKey(prodshadeCode: string, packCode: string): string {
  return toUpperTrimmedString(`${toTrimmedString(prodshadeCode)}${toTrimmedString(packCode)}`);
}

async function resolveSkuMaterialForPackCode(prodshadeExternalCode: string, prodshadeName: string, packCode: string): Promise<JsonRecord | null> {
  const keyByCode = prodshadeExternalCode ? buildSkuProdshadeKey(prodshadeExternalCode, packCode) : "";
  const keyByName = prodshadeName ? buildSkuProdshadeKey(prodshadeName, packCode) : "";
  const candidateKeys = [...new Set([keyByCode, keyByName].filter(Boolean))];
  if (candidateKeys.length === 0) return null;
  const orFilter = candidateKeys
    .flatMap((key) => [`external_code.ilike.${key}`, `material_name.ilike.${key}`])
    .join(",");
  const { data, error } = await serviceRoleClient
    .schema("erp_master").from("material_master")
    .select("id, pace_code, external_code, material_name, base_uom_code, material_type")
    .eq("material_type", "FG")
    .or(orFilter);
  if (error) {
    console.error("[mts_packing_combine.resolveSkuMaterialForPackCode] query failed:", JSON.stringify(error));
    throw new Error("PROD_PACK_COMBINE_SKU_LOOKUP_FAILED");
  }
  const rows = (data ?? []) as JsonRecord[];
  return rows.length === 1 ? rows[0] : null;
}

async function fetchActivePackBomWithLines(companyId: string, skuMaterialId: string): Promise<{ bom: JsonRecord; lines: JsonRecord[] } | null> {
  const { data: bom, error: bomErr } = await serviceRoleClient
    .schema("erp_production").from("pack_bom")
    .select("id, company_id, sku_material_id, status")
    .eq("company_id", companyId).eq("sku_material_id", skuMaterialId).eq("status", "ACTIVE")
    .maybeSingle();
  if (bomErr) {
    console.error("[mts_packing_combine.fetchActivePackBomWithLines] bom query failed:", JSON.stringify(bomErr));
    throw new Error("PROD_PACK_COMBINE_BOM_LOOKUP_FAILED");
  }
  if (!bom) return null;
  const { data: lines, error: lineErr } = await serviceRoleClient
    .schema("erp_production").from("pack_bom_line")
    .select("id, line_type, material_id, qty, uom_code, storage_location_id, movement_type_code, has_alternate, material_group_id, is_primary_container, display_order")
    .eq("pack_bom_id", (bom as JsonRecord).id as string);
  if (lineErr) {
    console.error("[mts_packing_combine.fetchActivePackBomWithLines] line query failed:", JSON.stringify(lineErr));
    throw new Error("PROD_PACK_COMBINE_BOM_LOOKUP_FAILED");
  }
  return { bom: bom as JsonRecord, lines: (lines ?? []) as JsonRecord[] };
}

async function getMaterialGroupMemberIdsByGroupIds(groupIds: string[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(groupIds.filter(Boolean))];
  const memberMap = new Map<string, string[]>();
  if (ids.length === 0) return memberMap;
  const { data, error } = await serviceRoleClient
    .schema("erp_master").from("material_category_group_member")
    .select("group_id, material_id").in("group_id", ids);
  if (error) {
    console.error("[mts_packing_combine.getMaterialGroupMemberIdsByGroupIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_PACK_COMBINE_GROUP_LOOKUP_FAILED");
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

// Same idea as process_order.handlers.ts's fetchMachineBucketBalances, but for
// Page 6's PM groups -- these are plain location stock, never a machine
// bucket (§138.16: "NO machine-bucket concept" for Packing PO PM lines).
async function fetchLocationBalances(companyId: string, storageLocationId: string, materialIds: string[]): Promise<Map<string, number>> {
  const balances = new Map<string, number>();
  const ids = [...new Set(materialIds.filter(Boolean))];
  if (!storageLocationId || ids.length === 0) return balances;
  const { data: snapshotRows, error: snapshotErr } = await serviceRoleClient
    .schema("erp_inventory").from("stock_snapshot")
    .select("material_id, quantity")
    .eq("company_id", companyId).eq("storage_location_id", storageLocationId)
    .eq("stock_type_code", "UNRESTRICTED").in("material_id", ids);
  if (snapshotErr) {
    console.error("[mts_packing_combine.fetchLocationBalances] snapshot query failed:", JSON.stringify(snapshotErr));
    throw new Error("PROD_PACK_COMBINE_STOCK_CHECK_FAILED");
  }
  for (const row of (snapshotRows ?? []) as JsonRecord[]) {
    const materialId = String(row.material_id);
    balances.set(materialId, (balances.get(materialId) ?? 0) + Number(row.quantity ?? 0));
  }
  const { data: reservationRows, error: reservationErr } = await serviceRoleClient
    .schema("erp_production").from("reservation_document")
    .select("material_id, balance_qty")
    .eq("company_id", companyId).eq("storage_location_id", storageLocationId)
    .in("material_id", ids).in("status", RESERVATION_OPEN_STATUSES);
  if (reservationErr) {
    console.error("[mts_packing_combine.fetchLocationBalances] reservation query failed:", JSON.stringify(reservationErr));
    throw new Error("PROD_PACK_COMBINE_STOCK_CHECK_FAILED");
  }
  for (const row of (reservationRows ?? []) as JsonRecord[]) {
    const materialId = String(row.material_id);
    balances.set(materialId, (balances.get(materialId) ?? 0) - Number(row.balance_qty ?? 0));
  }
  return balances;
}

async function resolveDefaultPmStorageLocationId(companyId: string, segmentCode: string): Promise<string | null> {
  if (!segmentCode) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_production").from("production_segment_location_config")
    .select("pm_sloc_id").eq("company_id", companyId).eq("segment_code", segmentCode).maybeSingle();
  if (error) {
    console.error("[mts_packing_combine.resolveDefaultPmStorageLocationId] query failed:", JSON.stringify(error));
    throw new Error("PROD_PACK_COMBINE_SEGMENT_CONFIG_FAILED");
  }
  return toTrimmedString((data as JsonRecord | null)?.pm_sloc_id) || null;
}

type ResolvedPage5Row = {
  id: string;
  batchNumberFrom: string;
  batchNumberTo: string;
  packCode: string;
  packCodeId: string;
  fillQty: number;
  numberOfBatches: number;
  totalOuterUnit: number;
  volume: number; // KG -- also the FG receipt qty and the SFG issue qty for this row
  fgStorageLocationId: string;
  skuMaterialId: string;
  skuBaseUom: string;
  bomId: string;
  outputLine: JsonRecord;
  sfgLine: JsonRecord;
  pmLines: JsonRecord[];
  packSizeLabel: string;
};

// Loads every PLANNED Page-5 row and resolves each one down to its own FG SKU
// + active Pack BOM + lines. Server-recomputed every time (never trusts any
// client-cached total), same discipline as buildMtsMaterialPlanGroupsForOrder.
async function resolvePage5Rows(po: JsonRecord): Promise<ResolvedPage5Row[] | { errorCode: string; detail: string }> {
  const id = String(po.id);
  const { data: planRows, error: planErr } = await serviceRoleClient
    .schema("erp_production").from("mts_packing_plan_row")
    .select("id, batch_number_from, batch_number_to, pack_code_id, outer_unit_per_batch, storage_location_id, display_order")
    .eq("process_order_id", id).eq("status", "PLANNED").order("display_order");
  if (planErr) {
    console.error("[mts_packing_combine.resolvePage5Rows] plan-row query failed:", JSON.stringify(planErr));
    throw new Error("PROD_PACK_COMBINE_FAILED");
  }
  const rows = (planRows ?? []) as JsonRecord[];
  if (rows.length === 0) {
    return { errorCode: "PROD_PACK_COMBINE_NO_PLAN", detail: "Complete Page 5 (Batch to Pack-Size Planning) before Page 6" };
  }

  const batchNumbers = await fetchOrderedBatchNumbers(id);
  const batchIndex = new Map(batchNumbers.map((bn, i) => [bn, i]));
  const packSizeOptions = await fetchPackSizeOptions(String(po.material_id));
  const packById = new Map(packSizeOptions.map((p) => [p.pack_code_id, p]));

  const { data: prodshadeRow, error: prodshadeErr } = await serviceRoleClient
    .schema("erp_master").from("material_master")
    .select("id, external_code, material_name").eq("id", String(po.material_id)).maybeSingle();
  if (prodshadeErr) {
    console.error("[mts_packing_combine.resolvePage5Rows] prodshade query failed:", JSON.stringify(prodshadeErr));
    throw new Error("PROD_PACK_COMBINE_FAILED");
  }
  const prodshade = (prodshadeRow as JsonRecord | null) ?? {};

  const resolved: ResolvedPage5Row[] = [];
  for (const row of rows) {
    const pack = packById.get(toTrimmedString(row.pack_code_id));
    if (!pack) return { errorCode: "PROD_PACK_COMBINE_PACK_SIZE_INVALID", detail: `Page 5 row uses a pack size no longer configured for this Prodshade` };
    const fromIdx = batchIndex.get(toTrimmedString(row.batch_number_from)) ?? -1;
    const toIdx = batchIndex.get(toTrimmedString(row.batch_number_to)) ?? -1;
    const numberOfBatches = fromIdx >= 0 && toIdx >= fromIdx ? toIdx - fromIdx + 1 : 0;
    const outerUnitPerBatch = Number(row.outer_unit_per_batch ?? 0);
    const totalOuterUnit = numberOfBatches * outerUnitPerBatch;
    const fillQty = Number(pack.fill_qty ?? 0);
    const volume = Number((totalOuterUnit * fillQty).toFixed(6));

    const sku = await resolveSkuMaterialForPackCode(
      toTrimmedString(prodshade.external_code), toTrimmedString(prodshade.material_name), String(pack.pack_code),
    );
    if (!sku) {
      return { errorCode: "PROD_PACK_COMBINE_SKU_NOT_FOUND", detail: `No FG SKU found for pack size "${pack.description}" -- check Prodshade Pack Config / Material Master` };
    }
    const bomResult = await fetchActivePackBomWithLines(String(po.company_id), String(sku.id));
    if (!bomResult) {
      return { errorCode: "PROD_PACK_COMBINE_BOM_MISSING", detail: `No ACTIVE Pack BOM found for SKU "${sku.pace_code ?? sku.material_name}" (pack size "${pack.description}")` };
    }
    const outputLine = bomResult.lines.find((l) => toTrimmedString(l.line_type) === "OUTPUT");
    const sfgLine = bomResult.lines.find((l) => toTrimmedString(l.line_type) === "SFG");
    const pmLines = bomResult.lines.filter((l) => toTrimmedString(l.line_type) === "INPUT");
    if (!outputLine || !sfgLine) {
      return { errorCode: "PROD_PACK_COMBINE_BOM_INCOMPLETE", detail: `Pack BOM for SKU "${sku.pace_code ?? sku.material_name}" is missing its OUTPUT or SFG row` };
    }

    resolved.push({
      id: String(row.id),
      batchNumberFrom: toTrimmedString(row.batch_number_from),
      batchNumberTo: toTrimmedString(row.batch_number_to),
      packCode: String(pack.pack_code),
      packCodeId: String(pack.pack_code_id),
      fillQty,
      numberOfBatches,
      totalOuterUnit,
      volume,
      fgStorageLocationId: toTrimmedString(row.storage_location_id),
      skuMaterialId: String(sku.id),
      skuBaseUom: toTrimmedString(sku.base_uom_code) || "KG",
      bomId: String(bomResult.bom.id),
      outputLine,
      sfgLine,
      pmLines,
      packSizeLabel: String(pack.description ?? pack.pack_code),
    });
  }
  return resolved;
}

type CombinedPmGroup = {
  material_id: string;
  uom_code: string;
  has_alternate: boolean;
  material_group_id: string | null;
  storage_location_id: string;
  standard_qty: number;
  group_member_ids: string[];
  contributing: Array<{ row_id: string; pack_size_label: string; qty: number }>;
};

function buildCombinedPmGroups(rows: ResolvedPage5Row[]): CombinedPmGroup[] {
  const byMaterial = new Map<string, CombinedPmGroup>();
  for (const row of rows) {
    for (const line of row.pmLines) {
      const materialId = toTrimmedString(line.material_id);
      if (!materialId) continue;
      const perUnitQty = Number(line.qty ?? 0);
      const requiredQty = Number((perUnitQty * row.totalOuterUnit).toFixed(6));
      if (requiredQty <= 0) continue;
      const existing = byMaterial.get(materialId);
      if (existing) {
        existing.standard_qty = Number((existing.standard_qty + requiredQty).toFixed(6));
        existing.contributing.push({ row_id: row.id, pack_size_label: row.packSizeLabel, qty: requiredQty });
      } else {
        byMaterial.set(materialId, {
          material_id: materialId,
          uom_code: toTrimmedString(line.uom_code) || "KG",
          has_alternate: Boolean(line.has_alternate),
          material_group_id: toTrimmedString(line.material_group_id) || null,
          storage_location_id: "", // resolved by caller (segment default, user-editable)
          standard_qty: requiredQty,
          group_member_ids: [materialId],
          contributing: [{ row_id: row.id, pack_size_label: row.packSizeLabel, qty: requiredQty }],
        });
      }
    }
  }
  return [...byMaterial.values()];
}

export async function getMtsPackingCombineHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const auth = await loadProcessOrderAndAuth(req, ctx, "VIEW");
    if ("errorResponse" in auth) return auth.errorResponse;
    const po = auth.po;

    const resolvedOrError = await resolvePage5Rows(po);
    if ("errorCode" in resolvedOrError) {
      return combineErr(req, ctx, resolvedOrError.errorCode, 422, resolvedOrError.detail);
    }
    const rows = resolvedOrError;

    const defaultPmSlocId = await resolveDefaultPmStorageLocationId(String(po.company_id), String(po.segment_code ?? ""));
    const groups = buildCombinedPmGroups(rows);

    const groupMemberMap = await getMaterialGroupMemberIdsByGroupIds(groups.map((g) => g.material_group_id ?? "").filter(Boolean) as string[]);
    for (const group of groups) {
      group.storage_location_id = defaultPmSlocId ?? "";
      if (group.has_alternate && group.material_group_id) {
        const members = (groupMemberMap.get(group.material_group_id) ?? []).filter((m) => m !== group.material_id);
        group.group_member_ids = [group.material_id, ...members];
      }
    }

    const candidateMaterialIds = [...new Set(groups.flatMap((g) => g.group_member_ids))];
    const balances = defaultPmSlocId
      ? await fetchLocationBalances(String(po.company_id), defaultPmSlocId, candidateMaterialIds)
      : new Map<string, number>();

    const derivedGroups = groups.map((group) => {
      const { rows: derivedRows, short, shortfallQty } = computeMtsAutoDeriveRowsForGroup({
        formulationMaterialId: group.material_id,
        dosagePct: null,
        standardQty: group.standard_qty,
        alternateMaterialIds: group.group_member_ids.filter((m) => m !== group.material_id),
        bucketBalances: balances,
      });
      return {
        material_id: group.material_id,
        uom_code: group.uom_code,
        auto_derive_applicable: true,
        storage_location_id: group.storage_location_id,
        standard_qty: group.standard_qty,
        rows: derivedRows,
        group_member_ids: group.group_member_ids,
        short,
        shortfall_qty: shortfallQty,
        contributing: group.contributing,
      };
    });

    const materialIds = new Set<string>();
    for (const group of derivedGroups) {
      materialIds.add(group.material_id);
      for (const row of group.rows) materialIds.add(row.actual_material_id);
      for (const memberId of group.group_member_ids) materialIds.add(memberId);
    }
    for (const row of rows) materialIds.add(row.skuMaterialId);
    const materialMap = await getMaterialMapByIds([...materialIds]);

    const slocIds = new Set<string>();
    for (const group of derivedGroups) if (group.storage_location_id) slocIds.add(group.storage_location_id);
    for (const row of rows) slocIds.add(row.fgStorageLocationId);
    const slocMap = await getStorageLocationMapByIds([...slocIds]);

    // Company F-locations (for the PM group's own storage-location dropdown too,
    // in case a company has more than one PM storage location -- same list Page 5
    // used for FG, reused here since PM issue can also come from any active
    // location mapped to the company, not only the segment default).
    const { data: slocPlantMaps, error: slocPlantErr } = await serviceRoleClient
      .schema("erp_inventory").from("storage_location_plant_map")
      .select("storage_location_id, storage_location_master!inner(id, code, name, active)")
      .eq("company_id", String(po.company_id)).eq("active", true).eq("storage_location_master.active", true);
    if (slocPlantErr) {
      console.error("[mts_packing_combine.get] sloc plant map query failed:", JSON.stringify(slocPlantErr));
      throw new Error("PROD_PACK_COMBINE_FAILED");
    }
    const pmStorageLocationOptions = ((slocPlantMaps ?? []) as JsonRecord[]).map((row) => {
      const loc = row.storage_location_master as JsonRecord;
      return { id: String(loc.id), code: String(loc.code), name: String(loc.name) };
    });

    return okResponse({
      header: {
        po_number: po.po_number,
        status: po.status,
        segment_code: po.segment_code,
        batch_number_from: po.batch_number_from ?? null,
        batch_number_to: po.batch_number_to ?? null,
      },
      rows_summary: rows.map((r) => ({
        row_id: r.id,
        pack_size_label: r.packSizeLabel,
        batch_number_from: r.batchNumberFrom,
        batch_number_to: r.batchNumberTo,
        number_of_batches: r.numberOfBatches,
        total_outer_unit: r.totalOuterUnit,
        volume: r.volume,
        sku_material_id: r.skuMaterialId,
        fg_storage_location_id: r.fgStorageLocationId,
      })),
      groups: derivedGroups,
      pm_storage_location_options: pmStorageLocationOptions,
      materials: Object.fromEntries(materialMap.entries()),
      storage_locations: Object.fromEntries(slocMap.entries()),
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_COMBINE_FAILED";
    return combineErr(req, ctx, code, code === "PROD_PO_NOT_FOUND" ? 404 : 500, "Failed to load combined PM plan");
  }
}

export async function saveMtsPackingCombineHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const auth = await loadProcessOrderAndAuth(req, ctx, "WRITE");
    if ("errorResponse" in auth) return auth.errorResponse;
    const po = auth.po;
    const companyId = String(po.company_id);

    const resolvedOrError = await resolvePage5Rows(po);
    if ("errorCode" in resolvedOrError) {
      return combineErr(req, ctx, resolvedOrError.errorCode, 422, resolvedOrError.detail);
    }
    const rows = resolvedOrError;

    const defaultPmSlocId = await resolveDefaultPmStorageLocationId(companyId, String(po.segment_code ?? ""));
    const serverGroups = buildCombinedPmGroups(rows);
    const groupMemberMap = await getMaterialGroupMemberIdsByGroupIds(
      serverGroups.map((g) => g.material_group_id ?? "").filter(Boolean) as string[],
    );
    for (const group of serverGroups) {
      if (group.has_alternate && group.material_group_id) {
        const members = (groupMemberMap.get(group.material_group_id) ?? []).filter((m) => m !== group.material_id);
        group.group_member_ids = [group.material_id, ...members];
      }
    }
    const serverGroupByMaterial = new Map(serverGroups.map((g) => [g.material_id, g]));

    const body = await parseBody(req);
    const bodyGroups = Array.isArray(body.groups) ? (body.groups as JsonRecord[]) : [];
    const bodyGroupByMaterial = new Map(bodyGroups.map((g) => [toTrimmedString(g.material_id), g]));

    // per-row PM qty accumulator: rowId -> Map<actualMaterialId, qty>
    const perRowPmQty = new Map<string, Map<string, number>>();
    for (const row of rows) perRowPmQty.set(row.id, new Map());
    // group storage location chosen (rowId doesn't matter -- PM issue location is
    // per combined-group, shared across every row that draws from that group).
    const groupStorageLocationById = new Map<string, string>();

    for (const group of serverGroups) {
      const bodyGroup = bodyGroupByMaterial.get(group.material_id);
      const storageLocationId = toTrimmedString(bodyGroup?.storage_location_id) || defaultPmSlocId || "";
      if (!storageLocationId) {
        return combineErr(req, ctx, "PROD_PACK_COMBINE_PM_SLOC_REQUIRED", 400, `A Storage Location is required for PM group ${group.material_id}`);
      }
      groupStorageLocationById.set(group.material_id, storageLocationId);

      const bodyRows = Array.isArray(bodyGroup?.rows) ? (bodyGroup!.rows as JsonRecord[]) : [];
      const allowedIds = new Set(group.group_member_ids);
      let finalRows: Array<{ actual_material_id: string; actual_qty: number }>;
      if (bodyRows.length > 0) {
        const seen = new Set<string>();
        let sumQty = 0;
        finalRows = [];
        for (const r of bodyRows) {
          const actualMaterialId = toTrimmedString(r.actual_material_id);
          if (!actualMaterialId || !allowedIds.has(actualMaterialId)) {
            return combineErr(req, ctx, "PROD_PACK_COMBINE_MATERIAL_NOT_IN_GROUP", 422, "actual_material_id must be the formulation item or a registered Pack BOM alternate");
          }
          if (seen.has(actualMaterialId)) {
            return combineErr(req, ctx, "PROD_PACK_COMBINE_DUPLICATE_MATERIAL", 422, "The same material cannot be selected twice within one PM group");
          }
          seen.add(actualMaterialId);
          const qty = Number(parseNonNegativeNumber(r.actual_qty) ?? 0);
          sumQty = Number((sumQty + qty).toFixed(6));
          finalRows.push({ actual_material_id: actualMaterialId, actual_qty: qty });
        }
        if (sumQty > group.standard_qty + EPSILON) {
          return combineErr(req, ctx, "PROD_PACK_COMBINE_QTY_MISMATCH", 422, `Row quantities for PM group ${group.material_id} exceed the Standard Qty`);
        }
        if (sumQty < group.standard_qty - EPSILON && bodyGroup?.confirmed_shortfall !== true) {
          return combineErr(req, ctx, "PROD_PACK_COMBINE_SHORTFALL_NOT_CONFIRMED", 422, `Row quantities for PM group ${group.material_id} are below the Standard Qty and have not been confirmed`);
        }
      } else {
        // No override supplied -- fall back to the server's own auto-derive default.
        const balances = await fetchLocationBalances(companyId, storageLocationId, group.group_member_ids);
        const { rows: derivedRows } = computeMtsAutoDeriveRowsForGroup({
          formulationMaterialId: group.material_id,
          dosagePct: null,
          standardQty: group.standard_qty,
          alternateMaterialIds: group.group_member_ids.filter((m) => m !== group.material_id),
          bucketBalances: balances,
        });
        finalRows = derivedRows.map((r) => ({ actual_material_id: r.actual_material_id, actual_qty: r.actual_qty }));
      }

      // Hard re-validate against FRESH location balances -- never trust the
      // client's own displayed "available", whether default or overridden.
      const perMaterialTotal = new Map<string, number>();
      for (const r of finalRows) perMaterialTotal.set(r.actual_material_id, (perMaterialTotal.get(r.actual_material_id) ?? 0) + r.actual_qty);
      const freshBalances = await fetchLocationBalances(companyId, storageLocationId, [...perMaterialTotal.keys()]);
      for (const [materialId, qty] of perMaterialTotal.entries()) {
        const available = Math.max(0, freshBalances.get(materialId) ?? 0);
        if (qty > available + EPSILON) {
          return combineErr(req, ctx, "PROD_PACK_COMBINE_PM_SHORTAGE", 422, `Insufficient stock for material ${materialId} at the selected PM storage location`);
        }
      }

      // Split each (actual_material_id, qty) proportionally back to every
      // contributing Page-5 row, by that row's own share of the group's
      // Standard Qty -- deterministic, not a new allocation decision
      // (§138.16 lock). Last contributing row absorbs rounding remainder.
      for (const finalRow of finalRows) {
        if (finalRow.actual_qty <= 0) continue;
        let allocated = 0;
        group.contributing.forEach((contrib, idx) => {
          const isLast = idx === group.contributing.length - 1;
          const share = group.standard_qty > EPSILON ? contrib.qty / group.standard_qty : 0;
          const qty = isLast
            ? Number((finalRow.actual_qty - allocated).toFixed(6))
            : Number((finalRow.actual_qty * share).toFixed(6));
          allocated = Number((allocated + qty).toFixed(6));
          if (qty <= 0) return;
          const rowMap = perRowPmQty.get(contrib.row_id)!;
          rowMap.set(finalRow.actual_material_id, Number(((rowMap.get(finalRow.actual_material_id) ?? 0) + qty).toFixed(6)));
        });
      }
    }

    // §8E: no unbounded id list here -- one packing_order per Page-5 row,
    // and MTS Packing PO row counts are always small (a handful of pack
    // sizes per batch range), so a plain sequential loop is fine; each
    // row's own DB writes are otherwise independent of the others (§8B).
    const now = new Date().toISOString();
    const createdIds: string[] = [];
    const createdPoNumbers: string[] = [];
    for (const row of rows) {
      const poNumber = await generateGlobalDocNumber("PACK_PO");
      const { data: packPo, error: insertErr } = await serviceRoleClient
        .schema("erp_production").from("packing_order")
        .insert({
          company_id: companyId,
          po_number: poNumber,
          po_type: "PMTS",
          source_po_type: "MTS",
          process_order_id: po.id,
          machine_id: null,
          material_id: row.skuMaterialId,
          pack_code_id: row.packCodeId,
          batch_number_from: row.batchNumberFrom || null,
          batch_number_to: row.batchNumberTo || null,
          fill_qty_per_pack: row.fillQty,
          num_packs: row.totalOuterUnit,
          sku_qty: row.totalOuterUnit,
          fg_conversion_qty: 1,
          sfg_conversion_qty: row.fillQty,
          planned_qty_kg: row.volume,
          total_qty_kg: row.volume,
          status: "STANDARD",
          segment_code: po.segment_code,
          created_by: ctx.auth_user_id,
          created_at: now,
          last_updated_at: now,
          last_updated_by: ctx.auth_user_id,
        })
        .select("id").single();
      if (insertErr) {
        console.error("[mts_packing_combine.save] packing_order insert failed:", JSON.stringify(insertErr));
        throw new Error("PROD_PACK_COMBINE_SAVE_FAILED");
      }
      const packPoId = (packPo as JsonRecord).id as string;

      const pmQtyForRow = perRowPmQty.get(row.id) ?? new Map<string, number>();
      const pmLineInserts: JsonRecord[] = [];
      let displayOrder = 10;
      for (const bomLine of row.pmLines) {
        const formulationMaterialId = toTrimmedString(bomLine.material_id);
        if (!formulationMaterialId) continue;
        const group = serverGroupByMaterial.get(formulationMaterialId);
        const storageLocationId = group ? groupStorageLocationById.get(formulationMaterialId) : null;
        // Every actual_material_id this formulation's group resolved to that
        // actually drew from THIS row's own share -- usually one, but can be
        // >1 when the group's own auto-derive split across the formulation
        // item + an alternate.
        const candidateIds = group ? group.group_member_ids : [formulationMaterialId];
        for (const actualMaterialId of candidateIds) {
          const qty = pmQtyForRow.get(actualMaterialId);
          if (!qty || qty <= 0) continue;
          // A given (formulation, actual) pair is only ever attributed to
          // ONE bomLine per row (Pack BOM never repeats the same formulation
          // material twice within one BOM) -- consume it so a formulation
          // material appearing in more than one bomLine row (shouldn't
          // happen) can't double count.
          pmQtyForRow.set(actualMaterialId, 0);
          pmLineInserts.push({
            packing_order_id: packPoId,
            line_type: "PM",
            material_id: formulationMaterialId,
            actual_material_id: actualMaterialId === formulationMaterialId ? null : actualMaterialId,
            batch_number: null,
            qty_per_pack: row.totalOuterUnit > 0 ? Number((qty / row.totalOuterUnit).toFixed(6)) : 0,
            total_qty: qty,
            actual_qty: null,
            issue_sloc_id: storageLocationId ?? null,
            uom_code: toTrimmedString(bomLine.uom_code) || "KG",
            movement_type_code: "P261",
            has_alternate: Boolean(bomLine.has_alternate),
            material_group_id: Boolean(bomLine.has_alternate) ? toTrimmedString(bomLine.material_group_id) || null : null,
            display_order: displayOrder++,
          });
        }
      }

      const lineRows: JsonRecord[] = [
        {
          packing_order_id: packPoId,
          line_type: "FG",
          material_id: row.skuMaterialId,
          batch_number: null,
          qty_per_pack: row.fillQty,
          total_qty: row.volume,
          actual_qty: null,
          issue_sloc_id: row.fgStorageLocationId,
          uom_code: row.skuBaseUom,
          movement_type_code: toTrimmedString(row.outputLine.movement_type_code) || "P101",
          has_alternate: false,
          material_group_id: null,
          display_order: 1,
        },
        {
          packing_order_id: packPoId,
          line_type: "SFG",
          material_id: toTrimmedString(row.sfgLine.material_id),
          batch_number: null, // chosen at Final, same convention as MTO/HPS
          qty_per_pack: row.fillQty,
          total_qty: row.volume,
          actual_qty: null,
          issue_sloc_id: toTrimmedString(row.sfgLine.storage_location_id),
          uom_code: "KG",
          movement_type_code: toTrimmedString(row.sfgLine.movement_type_code) || "P261",
          has_alternate: false,
          material_group_id: null,
          display_order: 2,
        },
        ...pmLineInserts,
      ];
      const { data: insertedLines, error: lineErr } = await serviceRoleClient
        .schema("erp_production").from("packing_order_line")
        .insert(lineRows)
        .select("id, line_type, material_id, actual_material_id, total_qty, issue_sloc_id, uom_code");
      if (lineErr) {
        console.error("[mts_packing_combine.save] line insert failed:", JSON.stringify(lineErr));
        throw new Error("PROD_PACK_COMBINE_SAVE_FAILED");
      }

      const reservationRows = ((insertedLines ?? []) as JsonRecord[])
        .filter((line) => String(line.line_type) !== "FG")
        .map((line) => ({
          source_type: "PACKING_PO",
          source_id: packPoId,
          source_line_id: line.id,
          company_id: companyId,
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
      if (reservationRows.length > 0) {
        const { error: reservationErr } = await serviceRoleClient
          .schema("erp_production").from("reservation_document").insert(reservationRows);
        if (reservationErr) {
          console.error("[mts_packing_combine.save] reservation insert failed:", JSON.stringify(reservationErr));
          throw new Error("PROD_PACK_COMBINE_SAVE_FAILED");
        }
      }

      const { error: convertErr } = await serviceRoleClient
        .schema("erp_production").from("mts_packing_plan_row")
        .update({ status: "CONVERTED", packing_order_id: packPoId, last_updated_by: ctx.auth_user_id, last_updated_at: now })
        .eq("id", row.id);
      if (convertErr) {
        console.error("[mts_packing_combine.save] plan-row convert failed:", JSON.stringify(convertErr));
        throw new Error("PROD_PACK_COMBINE_SAVE_FAILED");
      }

      createdIds.push(packPoId);
      createdPoNumbers.push(poNumber);
    }

    return createdOkResponse({ ids: createdIds, po_numbers: createdPoNumbers }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_COMBINE_SAVE_FAILED";
    return combineErr(req, ctx, code, code === "PROD_PO_NOT_FOUND" ? 404 : 500, "Failed to save combined packing plan");
  }
}
