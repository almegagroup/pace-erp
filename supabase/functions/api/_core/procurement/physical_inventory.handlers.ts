/*
 * File-ID: 20.2.1
 * File-Path: supabase/functions/api/_core/procurement/physical_inventory.handlers.ts
 * Gate: 20
 * Phase: 20
 * Domain: PROCUREMENT
 * Purpose: Physical inventory document lifecycle, count entry, and partial difference posting.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};
type PidRow = Record<string, unknown>;
type PiItemRow = Record<string, unknown>;

const PID_MODES = new Set(["LOCATION_WISE", "ITEM_WISE"]);
const PID_STATUSES = new Set(["OPEN", "COUNTED", "POSTED"]);
const STOCK_TYPES = new Set(["UNRESTRICTED", "QUALITY_INSPECTION", "BLOCKED"]);
const PI_MATERIAL_TYPES = new Set(["RM", "PM", "INT"]);

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNonNegativeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function getPathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}

function getDocumentIdFromPath(req: Request): string {
  return getPathSegments(req)[3] ?? "";
}

function getItemIdFromPath(req: Request): string {
  return getPathSegments(req)[5] ?? "";
}

function piErrorResponse(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function assertProcurementReadRole(_ctx: ProcurementHandlerContext): void {
  // Protected by upstream pipeline / ACL layer.
}

function derivePIMovementType(stockType: string, difference: number): string {
  const isSurplus = difference > 0;
  switch (toUpperTrimmedString(stockType)) {
    case "QUALITY_INSPECTION":
      return isSurplus ? "P703" : "P704";
    case "BLOCKED":
      return isSurplus ? "P705" : "P706";
    default:
      return isSurplus ? "P701" : "P702";
  }
}

async function generateProcurementDocNumber(docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("generate_doc_number", { p_doc_type: docType });

  if (error || !data) {
    throw new Error("PROCUREMENT_DOC_NUMBER_FAILED");
  }

  return String(data);
}

async function fetchPID(documentId: string): Promise<PidRow> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("physical_inventory_document")
    .select("*")
    .eq("id", documentId)
    .single();

  if (error || !data) {
    throw new Error("PI_DOCUMENT_NOT_FOUND");
  }

  return data as PidRow;
}

async function fetchPIItems(documentId: string): Promise<PiItemRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("physical_inventory_item")
    .select("*")
    .eq("document_id", documentId)
    .order("line_number", { ascending: true });

  if (error) {
    throw new Error("PI_ITEM_FETCH_FAILED");
  }

  return (data ?? []) as PiItemRow[];
}

async function hydratePID(documentId: string): Promise<JsonRecord> {
  const [document, items] = await Promise.all([fetchPID(documentId), fetchPIItems(documentId)]);
  return {
    ...document,
    items,
  };
}

async function getStorageLocationScope(storageLocationId: string, plantId?: string): Promise<{ company_id: string; plant_id: string }> {
  let query = serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_plant_map")
    .select("company_id, plant_id")
    .eq("storage_location_id", storageLocationId)
    .eq("active", true)
    .limit(1);

  if (plantId) {
    query = query.eq("plant_id", plantId);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data?.company_id || !data?.plant_id) {
    throw new Error("PI_STORAGE_LOCATION_SCOPE_NOT_FOUND");
  }

  return {
    company_id: String(data.company_id),
    plant_id: String(data.plant_id),
  };
}

async function getMaterialInfo(materialIds: string[]): Promise<Map<string, JsonRecord>> {
  if (materialIds.length === 0) {
    return new Map();
  }

  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, material_type, base_uom_code, material_name, pace_code")
    .in("id", materialIds);

  if (error) {
    throw new Error("PI_MATERIAL_LOOKUP_FAILED");
  }

  return new Map((data ?? []).map((row) => [String(row.id), row as JsonRecord]));
}

async function getBookSnapshots(
  plantId: string,
  storageLocationId: string,
  targetItems?: Array<{ material_id: string; stock_type: string }>,
): Promise<Array<{ material_id: string; stock_type: string; book_qty: number; base_uom_code: string }>> {
  const { company_id } = await getStorageLocationScope(storageLocationId, plantId);
  let query = serviceRoleClient
    .schema("erp_inventory")
    .from("stock_ledger")
    .select("material_id, stock_type_code, base_uom_code, direction, quantity")
    .eq("company_id", company_id)
    .eq("plant_id", plantId)
    .eq("storage_location_id", storageLocationId);

  const targetMaterialIds = targetItems?.map((item) => item.material_id).filter(Boolean) ?? [];
  if (targetMaterialIds.length > 0) {
    query = query.in("material_id", targetMaterialIds);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error("PI_STOCK_LEDGER_LOOKUP_FAILED");
  }

  const aggregates = new Map<string, { material_id: string; stock_type: string; qty: number; base_uom_code: string }>();
  for (const row of data ?? []) {
    const stockType = toUpperTrimmedString((row as JsonRecord).stock_type_code);
    if (!STOCK_TYPES.has(stockType)) {
      continue;
    }
    const materialId = String((row as JsonRecord).material_id);
    const key = `${materialId}::${stockType}`;
    const sign = toUpperTrimmedString((row as JsonRecord).direction) === "OUT" ? -1 : 1;
    const qty = Number((parseNullableNumber((row as JsonRecord).quantity) ?? 0) * sign);
    const current = aggregates.get(key) ?? {
      material_id: materialId,
      stock_type: stockType,
      qty: 0,
      base_uom_code: toTrimmedString((row as JsonRecord).base_uom_code),
    };
    current.qty = Number((current.qty + qty).toFixed(4));
    if (!current.base_uom_code) {
      current.base_uom_code = toTrimmedString((row as JsonRecord).base_uom_code);
    }
    aggregates.set(key, current);
  }

  const materialInfo = await getMaterialInfo([...new Set([...aggregates.values()].map((entry) => entry.material_id))]);
  const snapshotRows = [...aggregates.values()]
    .filter((entry) => entry.qty > 0)
    .filter((entry) => PI_MATERIAL_TYPES.has(toUpperTrimmedString(materialInfo.get(entry.material_id)?.material_type)))
    .map((entry) => ({
      material_id: entry.material_id,
      stock_type: entry.stock_type,
      book_qty: Number(entry.qty.toFixed(4)),
      base_uom_code: entry.base_uom_code || toTrimmedString(materialInfo.get(entry.material_id)?.base_uom_code),
    }));

  if (!targetItems || targetItems.length === 0) {
    return snapshotRows;
  }

  const byKey = new Map(snapshotRows.map((entry) => [`${entry.material_id}::${entry.stock_type}`, entry]));
  return targetItems
    .filter((item) => PI_MATERIAL_TYPES.has(toUpperTrimmedString(materialInfo.get(item.material_id)?.material_type)))
    .map((item) => {
      const key = `${item.material_id}::${toUpperTrimmedString(item.stock_type)}`;
      const snapshot = byKey.get(key);
      return {
        material_id: item.material_id,
        stock_type: toUpperTrimmedString(item.stock_type),
        book_qty: Number((snapshot?.book_qty ?? 0).toFixed(4)),
        base_uom_code:
          snapshot?.base_uom_code ||
          toTrimmedString(materialInfo.get(item.material_id)?.base_uom_code),
      };
    });
}

async function getItemCandidates(
  mode: string,
  plantId: string,
  storageLocationId: string,
  rawItems: JsonRecord[],
): Promise<Array<{ material_id: string; stock_type: string; book_qty: number; base_uom_code: string }>> {
  if (mode === "LOCATION_WISE") {
    return getBookSnapshots(plantId, storageLocationId);
  }

  const targetItems = rawItems
    .map((entry) => ({
      material_id: toTrimmedString(entry.material_id),
      stock_type: toUpperTrimmedString(entry.stock_type),
    }))
    .filter((entry) => entry.material_id && STOCK_TYPES.has(entry.stock_type));

  if (targetItems.length === 0) {
    return [];
  }

  return getBookSnapshots(plantId, storageLocationId, targetItems);
}

async function checkPostingBlock(materialId: string, plantId: string, storageLocationId: string): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("physical_inventory_block")
    .select("id")
    .eq("material_id", materialId)
    .eq("plant_id", plantId)
    .eq("storage_location_id", storageLocationId)
    .maybeSingle();

  if (error) {
    throw new Error("PI_BLOCK_LOOKUP_FAILED");
  }

  return Boolean(data?.id);
}

async function countNullPhysicalQty(documentId: string): Promise<number> {
  const { count, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("physical_inventory_item")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId)
    .is("physical_qty", null);

  if (error) {
    throw new Error("PI_ITEM_COUNT_LOOKUP_FAILED");
  }

  return Number(count ?? 0);
}

function isItemFullyProcessed(item: PiItemRow): boolean {
  const physicalQty = parseNullableNumber(item.physical_qty);
  const differenceQty = parseNullableNumber(item.difference_qty) ?? 0;
  return physicalQty !== null && (differenceQty === 0 || Boolean(item.posted_stock_document_id));
}

export async function createPIDHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const plantId = toTrimmedString(body.plant_id);
    const storageLocationId = toTrimmedString(body.storage_location_id);
    const countDate = toTrimmedString(body.count_date);
    const postingDate = toTrimmedString(body.posting_date) || countDate;
    const mode = toUpperTrimmedString(body.mode);
    const notes = toTrimmedString(body.notes);
    const rawItems = Array.isArray(body.items) ? (body.items as JsonRecord[]) : [];

    if (!plantId || !storageLocationId || !countDate || !postingDate || !PID_MODES.has(mode)) {
      return piErrorResponse(req, ctx, "PI_CREATE_INVALID", 400, "plant_id, storage_location_id, count_date, posting_date, and valid mode are required.");
    }

    const candidates = await getItemCandidates(mode, plantId, storageLocationId, rawItems);
    for (const candidate of candidates) {
      const blocked = await checkPostingBlock(candidate.material_id, plantId, storageLocationId);
      if (blocked) {
        return piErrorResponse(req, ctx, "MATERIAL_POSTING_BLOCKED", 409, "Material has an active physical inventory count in progress.");
      }
    }

    const documentNumber = await generateProcurementDocNumber("PI");
    const { data: document, error: documentError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("physical_inventory_document")
      .insert({
        document_number: documentNumber,
        plant_id: plantId,
        storage_location_id: storageLocationId,
        count_date: countDate,
        posting_date: postingDate,
        mode,
        status: "OPEN",
        notes: notes || null,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (documentError || !document) {
      return piErrorResponse(req, ctx, "PI_CREATE_FAILED", 500, "Unable to create physical inventory document.");
    }

    if (candidates.length > 0) {
      const itemPayload = candidates.map((candidate, index) => ({
        document_id: document.id,
        line_number: index + 1,
        material_id: candidate.material_id,
        stock_type: candidate.stock_type,
        book_qty: candidate.book_qty,
        base_uom_code: candidate.base_uom_code,
      }));

      const { error: itemError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("physical_inventory_item")
        .insert(itemPayload);

      if (itemError) {
        return piErrorResponse(req, ctx, "PI_ITEM_CREATE_FAILED", 500, "Unable to create physical inventory items.");
      }

      const blockPayload = candidates.map((candidate) => ({
        material_id: candidate.material_id,
        plant_id: plantId,
        storage_location_id: storageLocationId,
        pi_document_id: document.id,
      }));
      const { error: blockError } = await serviceRoleClient
        .schema("erp_inventory")
        .from("physical_inventory_block")
        .insert(blockPayload);

      if (blockError) {
        const status = String(blockError.code || "").startsWith("23") ? 409 : 500;
        return piErrorResponse(
          req,
          ctx,
          status === 409 ? "MATERIAL_POSTING_BLOCKED" : "PI_BLOCK_CREATE_FAILED",
          status,
          status === 409 ? "Material has an active physical inventory count in progress." : "Unable to create physical inventory posting blocks.",
        );
      }
    }

    return okResponse(await hydratePID(String(document.id)), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_CREATE_FAILED";
    const status = code === "MATERIAL_POSTING_BLOCKED" ? 409 : 500;
    return piErrorResponse(req, ctx, code, status, code);
  }
}

export async function listPIDsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const plantId = toTrimmedString(url.searchParams.get("plant_id"));
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 100);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("physical_inventory_document")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (plantId) {
      query = query.eq("plant_id", plantId);
    }
    if (status && PID_STATUSES.has(status)) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      return piErrorResponse(req, ctx, "PI_LIST_FAILED", 500, "Unable to list physical inventory documents.");
    }

    const rows = (data ?? []) as PidRow[];
    const documentIds = rows.map((row) => String(row.id)).filter(Boolean);
    const counts = new Map<string, { item_count: number; counted_count: number }>();

    if (documentIds.length > 0) {
      const { data: items, error: itemError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("physical_inventory_item")
        .select("document_id, physical_qty")
        .in("document_id", documentIds);

      if (itemError) {
        return piErrorResponse(req, ctx, "PI_LIST_COUNTS_FAILED", 500, "Unable to load item counts.");
      }

      for (const item of items ?? []) {
        const documentId = String(item.document_id ?? "");
        if (!documentId) continue;
        const current = counts.get(documentId) ?? { item_count: 0, counted_count: 0 };
        current.item_count += 1;
        if (item.physical_qty !== null && item.physical_qty !== undefined) {
          current.counted_count += 1;
        }
        counts.set(documentId, current);
      }
    }

    return okResponse(
      {
        items: rows.map((row) => ({
          ...row,
          item_count: counts.get(String(row.id))?.item_count ?? 0,
          counted_count: counts.get(String(row.id))?.counted_count ?? 0,
        })),
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_LIST_FAILED";
    return piErrorResponse(req, ctx, code, 500, code);
  }
}

export async function getPIDHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const documentId = getDocumentIdFromPath(req);
    if (!documentId) {
      return piErrorResponse(req, ctx, "PI_ID_REQUIRED", 400, "Physical inventory document id is required.");
    }

    return okResponse(await hydratePID(documentId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_FETCH_FAILED";
    const status = code === "PI_DOCUMENT_NOT_FOUND" ? 404 : 500;
    return piErrorResponse(req, ctx, code, status, code);
  }
}

export async function addPIItemHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const body = await parseBody(req);
    const materialId = toTrimmedString(body.material_id);
    const stockType = toUpperTrimmedString(body.stock_type);

    if (!documentId || !materialId || !STOCK_TYPES.has(stockType)) {
      return piErrorResponse(req, ctx, "PI_ITEM_ADD_INVALID", 400, "document id, material_id, and valid stock_type are required.");
    }

    const document = await fetchPID(documentId);
    if (toUpperTrimmedString(document.status) !== "OPEN") {
      return piErrorResponse(req, ctx, "PI_ITEM_ADD_BLOCKED", 409, "Items can only be added while PI document is OPEN.");
    }

    const materialInfo = await getMaterialInfo([materialId]);
    const material = materialInfo.get(materialId);
    if (!material || !PI_MATERIAL_TYPES.has(toUpperTrimmedString(material.material_type))) {
      return piErrorResponse(req, ctx, "PI_ITEM_MATERIAL_INVALID", 400, "Only RM, PM, and Intermediate materials are allowed.");
    }

    const blocked = await checkPostingBlock(materialId, String(document.plant_id), String(document.storage_location_id));
    if (blocked) {
      return piErrorResponse(req, ctx, "MATERIAL_POSTING_BLOCKED", 409, "Material has an active physical inventory count in progress.");
    }

    const [snapshot] = await getBookSnapshots(
      String(document.plant_id),
      String(document.storage_location_id),
      [{ material_id: materialId, stock_type: stockType }],
    );

    const { data: existing, error: existingError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("physical_inventory_item")
      .select("id")
      .eq("document_id", documentId)
      .eq("material_id", materialId)
      .eq("stock_type", stockType)
      .maybeSingle();

    if (existingError) {
      return piErrorResponse(req, ctx, "PI_ITEM_DUPLICATE_CHECK_FAILED", 500, "Unable to validate existing PI item.");
    }
    if (existing?.id) {
      return piErrorResponse(req, ctx, "PI_ITEM_ALREADY_EXISTS", 409, "PI item already exists for this material and stock type.");
    }

    const existingItems = await fetchPIItems(documentId);
    const { data: item, error: itemError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("physical_inventory_item")
      .insert({
        document_id: documentId,
        line_number: existingItems.length + 1,
        material_id: materialId,
        stock_type: stockType,
        book_qty: Number((snapshot?.book_qty ?? 0).toFixed(4)),
        base_uom_code: snapshot?.base_uom_code || toTrimmedString(material.base_uom_code),
      })
      .select("*")
      .single();

    if (itemError || !item) {
      const status = String(itemError?.code || "").startsWith("23") ? 409 : 500;
      return piErrorResponse(req, ctx, status === 409 ? "PI_ITEM_ALREADY_EXISTS" : "PI_ITEM_ADD_FAILED", status, status === 409 ? "PI item already exists for this material and stock type." : "Unable to add PI item.");
    }

    const { error: blockError } = await serviceRoleClient
      .schema("erp_inventory")
      .from("physical_inventory_block")
      .insert({
        material_id: materialId,
        plant_id: document.plant_id,
        storage_location_id: document.storage_location_id,
        pi_document_id: documentId,
      });

    if (blockError) {
      const status = String(blockError.code || "").startsWith("23") ? 409 : 500;
      return piErrorResponse(
        req,
        ctx,
        status === 409 ? "MATERIAL_POSTING_BLOCKED" : "PI_BLOCK_CREATE_FAILED",
        status,
        status === 409 ? "Material has an active physical inventory count in progress." : "Unable to create physical inventory posting block.",
      );
    }

    return okResponse(item, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_ITEM_ADD_FAILED";
    const status = code === "MATERIAL_POSTING_BLOCKED" ? 409 : code === "PI_DOCUMENT_NOT_FOUND" ? 404 : 500;
    return piErrorResponse(req, ctx, code, status, code);
  }
}

export async function enterCountHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const itemId = getItemIdFromPath(req);
    const body = await parseBody(req);
    const physicalQty = parseNonNegativeNumber(body.physical_qty);

    if (!documentId || !itemId || physicalQty === null) {
      return piErrorResponse(req, ctx, "PI_COUNT_INVALID", 400, "Valid physical_qty >= 0 is required.");
    }

    const document = await fetchPID(documentId);
    const status = toUpperTrimmedString(document.status);
    if (!["OPEN", "COUNTED"].includes(status)) {
      return piErrorResponse(req, ctx, "PI_COUNT_BLOCKED", 409, "Counts can only be entered while PI document is OPEN or COUNTED.");
    }

    const { data: item, error: itemError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("physical_inventory_item")
      .update({
        physical_qty: physicalQty,
        counted_by: ctx.auth_user_id,
        counted_at: new Date().toISOString(),
        is_recount_requested: false,
      })
      .eq("id", itemId)
      .eq("document_id", documentId)
      .is("posted_stock_document_id", null)
      .select("*")
      .single();

    if (itemError || !item) {
      return piErrorResponse(req, ctx, "PI_COUNT_SAVE_FAILED", 500, "Unable to save physical count.");
    }

    const nullCount = await countNullPhysicalQty(documentId);
    if (nullCount === 0) {
      const { error: documentError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("physical_inventory_document")
        .update({ status: "COUNTED" })
        .eq("id", documentId)
        .neq("status", "POSTED");

      if (documentError) {
        return piErrorResponse(req, ctx, "PI_COUNT_STATUS_UPDATE_FAILED", 500, "Unable to update PI document status.");
      }
    }

    return okResponse(await hydratePID(documentId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_COUNT_SAVE_FAILED";
    const status = code === "PI_DOCUMENT_NOT_FOUND" ? 404 : 500;
    return piErrorResponse(req, ctx, code, status, code);
  }
}

export async function requestRecountHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const itemId = getItemIdFromPath(req);
    const document = await fetchPID(documentId);

    if (toUpperTrimmedString(document.status) === "POSTED") {
      return piErrorResponse(req, ctx, "PI_RECOUNT_BLOCKED", 409, "Posted PI documents cannot request recount.");
    }

    const { data: item, error: itemError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("physical_inventory_item")
      .update({
        physical_qty: null,
        counted_by: null,
        counted_at: null,
        is_recount_requested: true,
      })
      .eq("id", itemId)
      .eq("document_id", documentId)
      .is("posted_stock_document_id", null)
      .select("*")
      .single();

    if (itemError || !item) {
      return piErrorResponse(req, ctx, "PI_RECOUNT_FAILED", 500, "Unable to request recount.");
    }

    if (toUpperTrimmedString(document.status) === "COUNTED") {
      const { error: documentError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("physical_inventory_document")
        .update({ status: "OPEN" })
        .eq("id", documentId);

      if (documentError) {
        return piErrorResponse(req, ctx, "PI_RECOUNT_STATUS_UPDATE_FAILED", 500, "Unable to reopen PI document.");
      }
    }

    return okResponse(await hydratePID(documentId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_RECOUNT_FAILED";
    const status = code === "PI_DOCUMENT_NOT_FOUND" ? 404 : 500;
    return piErrorResponse(req, ctx, code, status, code);
  }
}

export async function postDifferencesHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const document = await fetchPID(documentId);
    const status = toUpperTrimmedString(document.status);
    if (!["OPEN", "COUNTED"].includes(status)) {
      return piErrorResponse(req, ctx, "PI_POST_BLOCKED", 409, "PI document must be OPEN or COUNTED before posting differences.");
    }

    const items = await fetchPIItems(documentId);
    const locationScope = await getStorageLocationScope(String(document.storage_location_id), String(document.plant_id));

    for (const item of items) {
      const physicalQty = parseNullableNumber(item.physical_qty);
      if (physicalQty === null) {
        continue;
      }
      if (item.posted_stock_document_id) {
        continue;
      }

      const differenceQty = parseNullableNumber(item.difference_qty) ?? 0;
      if (differenceQty !== 0) {
        const movementType = derivePIMovementType(String(item.stock_type), differenceQty);
        const posting = await serviceRoleClient
          .schema("erp_inventory")
          .rpc("post_stock_movement", {
            p_document_number: document.document_number,
            p_document_date: document.count_date,
            p_posting_date: document.posting_date,
            p_movement_type_code: movementType,
            p_company_id: locationScope.company_id,
            p_plant_id: document.plant_id,
            p_storage_location_id: document.storage_location_id,
            p_material_id: item.material_id,
            p_quantity: Math.abs(differenceQty),
            p_base_uom_code: item.base_uom_code,
            p_unit_value: 0,
            p_stock_type_code: item.stock_type,
            p_direction: differenceQty > 0 ? "IN" : "OUT",
            p_posted_by: ctx.auth_user_id,
            p_reversal_of_id: null,
          });

        if (posting.error || !Array.isArray(posting.data) || posting.data.length === 0) {
          return piErrorResponse(req, ctx, "PI_POST_RPC_FAILED", 500, "Unable to post physical inventory difference.");
        }

        const postingRow = posting.data[0] as JsonRecord;
        const { error: itemUpdateError } = await serviceRoleClient
          .schema("erp_procurement")
          .from("physical_inventory_item")
          .update({
            posted_stock_document_id: postingRow.stock_document_id ?? null,
          })
          .eq("id", String(item.id));

        if (itemUpdateError) {
          return piErrorResponse(req, ctx, "PI_ITEM_POST_UPDATE_FAILED", 500, "Unable to update PI item posting reference.");
        }
      }

      const { error: blockDeleteError } = await serviceRoleClient
        .schema("erp_inventory")
        .from("physical_inventory_block")
        .delete()
        .eq("pi_document_id", documentId)
        .eq("material_id", String(item.material_id))
        .eq("plant_id", String(document.plant_id))
        .eq("storage_location_id", String(document.storage_location_id));

      if (blockDeleteError) {
        return piErrorResponse(req, ctx, "PI_BLOCK_RELEASE_FAILED", 500, "Unable to release physical inventory posting block.");
      }
    }

    const refreshed = await fetchPIItems(documentId);
    const allProcessed = refreshed.every((item) => isItemFullyProcessed(item));
    if (allProcessed) {
      const { error: documentUpdateError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("physical_inventory_document")
        .update({
          status: "POSTED",
          posted_by: ctx.auth_user_id,
          posted_at: new Date().toISOString(),
        })
        .eq("id", documentId);

      if (documentUpdateError) {
        return piErrorResponse(req, ctx, "PI_POST_STATUS_UPDATE_FAILED", 500, "Unable to mark PI document as POSTED.");
      }
    }

    return okResponse(await hydratePID(documentId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_POST_FAILED";
    const status = code === "PI_DOCUMENT_NOT_FOUND" ? 404 : 500;
    return piErrorResponse(req, ctx, code, status, code);
  }
}
