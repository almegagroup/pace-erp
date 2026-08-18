/*
 * File-ID: 24.1
 * File-Path: supabase/functions/api/_core/procurement/stock_reports.handlers.ts
 * Gate: 24
 * Phase: 24
 * Domain: PROCUREMENT
 * Purpose: Core stock reports - stock ledger, current stock snapshot, and stock valuation.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { formatDateTimeInKolkata } from "../../_shared/dateUtils.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type StockReportHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

type ValuationRow = {
  material_id: string;
  company_id: string;
  base_uom_code: string;
  total_qty: number;
  total_value: number;
  weighted_avg_rate: number;
};

type CurrentStockMaterialRow = {
  id: string;
  pace_code: string;
  external_code: string;
  material_name: string;
  document_name: string;
  material_type: string;
  base_uom_code: string;
  pack_code: string;
};

type CurrentStockDraftRow = {
  company_id: string;
  material_id: string;
  storage_location_id: string;
  batch_number: string | null;
  packing_po_number: string | null;
  unrestricted_qty: number;
  qi_qty: number;
  blocked_qty: number;
  base_uom_code: string;
  material_type: string;
  path_kind: "A" | "B" | "C";
  fill_qty_per_pack: number | null;
  num_packs: number | null;
};

type StockLedgerRow = {
  id: string;
  ledger_seq: number;
  stock_document_id: string;
  posting_date: string;
  company_id: string;
  storage_location_id: string;
  material_id: string;
  batch_number: string | null;
  movement_type_code: string;
  direction: string;
  quantity: number;
  posted_quantity: number;
  base_uom_code: string;
  value: number;
  posted_value: number;
  valuation_rate: number;
  created_at: string | null;
  created_by: string;
};

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function normalizeNumber(value: unknown, decimals = 6): number {
  const parsed = Number(value ?? 0);
  const safeValue = Number.isFinite(parsed) ? parsed : 0;
  return Number(safeValue.toFixed(decimals));
}

function reportErrorResponse(
  req: Request,
  ctx: StockReportHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function assertProcurementReadRole(_ctx: StockReportHandlerContext): void {
  // Protected by upstream pipeline/ACL layer.
}

function normalizeStockTypeFilter(value: string): string {
  return value.toUpperCase() === "QA" ? "QUALITY_INSPECTION" : value;
}

function parseBooleanFlag(value: unknown): boolean {
  const normalized = toTrimmedString(value).toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function validateRequiredDateRange(dateFrom: string, dateTo: string): "OK" | "MISSING" | "INVALID" | "TOO_WIDE" {
  if (!dateFrom || !dateTo) {
    return "MISSING";
  }
  const from = parseIsoDate(dateFrom);
  const to = parseIsoDate(dateTo);
  if (!from || !to || to.getTime() < from.getTime()) {
    return "INVALID";
  }
  const diffDays = Math.floor((to.getTime() - from.getTime()) / 86400000);
  return diffDays > 365 ? "TOO_WIDE" : "OK";
}

function resolveMaterialLabel(material: JsonRecord | undefined): string {
  return toTrimmedString(material?.document_name) || toTrimmedString(material?.material_name);
}

// Opening Stock (IN05) FG lines carry a real packing_order_id (the PR23
// genealogy record this opening balance represents), but the posting they
// produce is tagged reference_document_type='OS' (not 'PACK_PO'), and
// derive_source_lot_ref() (migration 20260719210000) only derives
// source_lot_ref for reference_document_type='PACK_PO' + P101 + IN --
// Opening Stock's P561/P565 postings never match that, so source_lot_ref
// stays NULL for them. Without this map, resolveLotRef() below falls all
// the way through to doc.document_number -- the MATERIAL document's own
// short year-scoped number (e.g. "00000019") -- which is what IN02/IN03
// were wrongly showing as "Packing PO Number" (found live 2026-08-11).
// Built once per report request from the already-fetched stock_document
// rows; keyed by (opening_stock_document_id, material_id, batch_number)
// since one Opening Stock document has many lines.
async function buildOpeningStockLotMap(docs: JsonRecord[]): Promise<Map<string, string>> {
  const openingDocIds = [...new Set(
    docs
      .filter((doc) => toTrimmedString(doc.reference_document_type) === "OS")
      .map((doc) => toTrimmedString(doc.reference_document_id))
      .filter(Boolean),
  )];
  if (openingDocIds.length === 0) return new Map();

  const { data: lines, error: linesError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("opening_stock_line")
    .select("document_id, material_id, batch_number, packing_order_id")
    .in("document_id", openingDocIds)
    .not("packing_order_id", "is", null);
  if (linesError || !lines) return new Map();

  const packingOrderIds = [...new Set(
    (lines as JsonRecord[]).map((line) => toTrimmedString(line.packing_order_id)).filter(Boolean),
  )];
  if (packingOrderIds.length === 0) return new Map();

  const { data: packingOrders } = await serviceRoleClient
    .schema("erp_production")
    .from("packing_order")
    .select("id, po_number")
    .in("id", packingOrderIds);
  const poNumberById = new Map(
    ((packingOrders ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.id), toTrimmedString(row.po_number)]),
  );

  const lotMap = new Map<string, string>();
  for (const line of lines as JsonRecord[]) {
    const poNumber = poNumberById.get(toTrimmedString(line.packing_order_id));
    if (!poNumber) continue;
    const key = `${toTrimmedString(line.document_id)}::${toTrimmedString(line.material_id)}::${toTrimmedString(line.batch_number)}`;
    lotMap.set(key, poNumber);
  }
  return lotMap;
}

// Shared by both IN02 (stock ledger) and IN03 (current stock) — same
// fallback chain as fgStockBreakdownHandler's resolveLotRef(). Kept as one
// function per the task brief's explicit "don't duplicate" instruction.
function resolveLotRef(
  doc: JsonRecord | undefined,
  materialId: string,
  batchNumber: string | null,
  openingLotMap: Map<string, string>,
): string {
  if (!doc) return "";
  const lot = toTrimmedString(doc.source_lot_ref);
  if (lot) return lot;
  if (toTrimmedString(doc.reference_document_type) === "PACK_PO") {
    const ref = toTrimmedString(doc.reference_document_number);
    if (ref) return ref;
  }
  if (toTrimmedString(doc.reference_document_type) === "OS") {
    const key = `${toTrimmedString(doc.reference_document_id)}::${materialId}::${toTrimmedString(batchNumber)}`;
    const openingPoNumber = openingLotMap.get(key);
    if (openingPoNumber) return openingPoNumber;
  }
  return toTrimmedString(doc.document_number);
}

function resolveAltUomConversion(material: JsonRecord | undefined, conversions: JsonRecord[]): JsonRecord | null {
  const baseUomCode = toTrimmedString(material?.base_uom_code);
  const purchaseUom = toTrimmedString(material?.purchase_uom_code);
  return conversions.find((conv) =>
    !conv.variable_conversion
    && toTrimmedString(conv.from_uom_code) === purchaseUom
    && toTrimmedString(conv.to_uom_code) === baseUomCode
  ) ?? conversions.find((conv) =>
    !conv.variable_conversion
    && toTrimmedString(conv.to_uom_code) === baseUomCode
  ) ?? null;
}

function formatDateTimeDisplay(value: string | null): string | null {
  return formatDateTimeInKolkata(value);
}

async function searchDistinctTextValues(params: {
  schema: string;
  table: string;
  column: string;
  q: string;
  companyScopeIds: string[] | null;
  req: Request;
  ctx: StockReportHandlerContext;
  failureCode: string;
  failureMessage: string;
}): Promise<Response> {
  const { schema, table, column, q, companyScopeIds, req, ctx, failureCode, failureMessage } = params;
  let query = serviceRoleClient
    .schema(schema)
    .from(table)
    .select(column)
    .not(column, "is", null)
    .order(column, { ascending: true })
    .limit(50);

  if (companyScopeIds) {
    query = query.in("company_id", companyScopeIds);
  }
  if (q) {
    query = (query as unknown as { ilike: (columnName: string, pattern: string) => typeof query })
      .ilike(column, `%${q}%`);
  }

  const { data, error } = await query;
  if (error) {
    return reportErrorResponse(req, ctx, failureCode, 500, failureMessage);
  }

  const values = [...new Set(((data ?? []) as JsonRecord[]).map((row) => toTrimmedString(row[column])).filter(Boolean))]
    .slice(0, 50)
    .map((value) => ({ value, label: value }));
  return okResponse({ data: values, total: values.length }, ctx.request_id, req);
}

function parseMultiValueParams(
  url: URL,
  pluralKey: string,
  singularKey?: string,
  transform?: (value: string) => string,
): string[] {
  const collected = [
    ...url.searchParams.getAll(pluralKey),
    singularKey ? url.searchParams.get(singularKey) ?? "" : "",
  ];
  const normalize = transform ?? ((value) => value);
  return [...new Set(
    collected
      .flatMap((entry) => String(entry ?? "").split(","))
      .map((entry) => normalize(toTrimmedString(entry)))
      .filter(Boolean),
  )];
}

async function loadAllowedCompanyIds(ctx: StockReportHandlerContext): Promise<string[] | null> {
  if (ctx.context.isAdmin === true || ctx.roleCode === "SA" || ctx.roleCode === "GA") {
    return null;
  }
  const { data: userCompanies, error } = await serviceRoleClient
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", ctx.auth_user_id);
  if (error) {
    throw new Error("COMPANY_SCOPE_LOOKUP_FAILED");
  }
  return [...new Set(((userCompanies ?? []) as JsonRecord[]).map((row) => String(row.company_id ?? "")).filter(Boolean))];
}

async function resolveCompanyScopeList(
  ctx: StockReportHandlerContext,
  requestedCompanyIds: string[],
): Promise<string[] | null> {
  const normalizedRequested = [...new Set(requestedCompanyIds.map((value) => toTrimmedString(value)).filter(Boolean))];
  const allowedCompanyIds = await loadAllowedCompanyIds(ctx);
  if (normalizedRequested.length === 0) {
    return allowedCompanyIds;
  }
  if (!allowedCompanyIds) {
    return normalizedRequested;
  }
  const denied = normalizedRequested.find((companyId) => !allowedCompanyIds.includes(companyId));
  if (denied) {
    throw new Error("COMPANY_SCOPE_VIOLATION");
  }
  return normalizedRequested;
}

// Business decision (2026-08-04): IN02/IN03 show exactly one company's data
// per request, never a blended cross-company view — a caller must pass
// exactly one company_id, and it must be in their own erp_map.user_companies
// (or SA/GA, who may still pass any single real company). The frontend
// already enforces "pick one" via TransactionCompanySelector, but that's not
// a substitute for a server-side check — a direct API call could otherwise
// omit company_id (falls back to "all my companies", a blend) or pass
// several. Reuses resolveCompanyScopeList's membership check, then adds the
// "must be exactly one" rule on top.
async function resolveMandatorySingleCompanyId(
  ctx: StockReportHandlerContext,
  requestedCompanyIds: string[],
): Promise<string> {
  const normalizedRequested = [...new Set(requestedCompanyIds.map((value) => toTrimmedString(value)).filter(Boolean))];
  if (normalizedRequested.length !== 1) {
    throw new Error("COMPANY_ID_REQUIRED_SINGLE");
  }
  const scoped = await resolveCompanyScopeList(ctx, normalizedRequested);
  // scoped is either the normalized single-entry array (non-admin, passed
  // membership check) or, for SA/GA/admin, resolveCompanyScopeList returns
  // normalizedRequested unchanged too (allowedCompanyIds is null for them) —
  // either way it's the one company_id the caller asked for.
  return scoped?.[0] ?? normalizedRequested[0];
}

function companyErrorStatus(code: string): number | null {
  if (code === "COMPANY_SCOPE_VIOLATION") return 403;
  if (code === "COMPANY_ID_REQUIRED_SINGLE") return 400;
  return null;
}

function initializeCurrentStockDraftRow(params: {
  company_id: string;
  material_id: string;
  storage_location_id: string;
  batch_number: string | null;
  packing_po_number: string | null;
  base_uom_code: string;
  material_type: string;
  path_kind: "A" | "B" | "C";
  fill_qty_per_pack?: number | null;
  num_packs?: number | null;
}): CurrentStockDraftRow {
  return {
    company_id: params.company_id,
    material_id: params.material_id,
    storage_location_id: params.storage_location_id,
    batch_number: params.batch_number,
    packing_po_number: params.packing_po_number,
    unrestricted_qty: 0,
    qi_qty: 0,
    blocked_qty: 0,
    base_uom_code: params.base_uom_code,
    material_type: params.material_type,
    path_kind: params.path_kind,
    fill_qty_per_pack: params.fill_qty_per_pack ?? null,
    num_packs: params.num_packs ?? null,
  };
}

function appendStockTypeQuantity(row: CurrentStockDraftRow, stockTypeCode: string, quantity: number): void {
  const normalized = normalizeStockTypeFilter(stockTypeCode);
  if (normalized === "UNRESTRICTED") {
    row.unrestricted_qty = normalizeNumber(row.unrestricted_qty + quantity);
  } else if (normalized === "QUALITY_INSPECTION") {
    row.qi_qty = normalizeNumber(row.qi_qty + quantity);
  } else if (normalized === "BLOCKED") {
    row.blocked_qty = normalizeNumber(row.blocked_qty + quantity);
  }
}

function isZeroBalanceRow(row: CurrentStockDraftRow): boolean {
  return (
    Math.abs(Number(row.unrestricted_qty ?? 0)) < 0.000001 &&
    Math.abs(Number(row.qi_qty ?? 0)) < 0.000001 &&
    Math.abs(Number(row.blocked_qty ?? 0)) < 0.000001
  );
}

function convertFgQtyToPrimary(quantityKg: number, fillQtyPerPack: number | null): number {
  const fillQty = Number(fillQtyPerPack ?? 0);
  if (!Number.isFinite(fillQty) || fillQty <= 0) {
    return normalizeNumber(quantityKg);
  }
  return normalizeNumber(quantityKg / fillQty);
}

// §112 (Shape 3 — plain read) — these report handlers take company_id from a
// GET query string with zero validation before this fix: an empty company_id
// returned every company's stock, and an explicit foreign company_id returned
// that company's stock unchecked. Mirrors the allowedCompanyIds pattern
// already used in process_order/packing_order listXHandler: SA/GA/admin see
// everything; everyone else gets scoped to their own erp_map.user_companies,
// and an explicit out-of-scope company_id throws COMPANY_SCOPE_VIOLATION.
async function resolveCompanyScope(
  ctx: StockReportHandlerContext,
  requestedCompanyId: string,
): Promise<{ companyId: string; allowedCompanyIds: string[] | null }> {
  const companyId = toTrimmedString(requestedCompanyId);
  if (companyId) {
    await assertCompanyScope(ctx, companyId);
    return { companyId, allowedCompanyIds: null };
  }
  if (ctx.context.isAdmin === true || ctx.roleCode === "SA" || ctx.roleCode === "GA") {
    return { companyId, allowedCompanyIds: null };
  }
  const { data: userCompanies, error } = await serviceRoleClient
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", ctx.auth_user_id);
  if (error) {
    throw new Error("COMPANY_SCOPE_LOOKUP_FAILED");
  }
  const allowedCompanyIds = ((userCompanies ?? []) as JsonRecord[]).map((row) => String(row.company_id ?? ""));
  return { companyId, allowedCompanyIds };
}

export async function getStockLedgerReportHandler(
  req: Request,
  ctx: StockReportHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const url = new URL(req.url);
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const dateRangeState = validateRequiredDateRange(dateFrom, dateTo);
    if (dateRangeState === "MISSING") {
      return reportErrorResponse(req, ctx, "STOCK_LEDGER_DATE_RANGE_REQUIRED", 400, "date_from and date_to are required.");
    }
    if (dateRangeState === "INVALID") {
      return reportErrorResponse(req, ctx, "STOCK_LEDGER_DATE_RANGE_INVALID", 400, "date_from/date_to are invalid.");
    }
    if (dateRangeState === "TOO_WIDE") {
      return reportErrorResponse(req, ctx, "STOCK_LEDGER_DATE_RANGE_TOO_WIDE", 400, "Date range cannot exceed 365 days.");
    }

    const companyIds = parseMultiValueParams(url, "company_ids", "company_id");
    const materialIds = parseMultiValueParams(url, "material_ids", "material_id");
    const storageLocationIds = parseMultiValueParams(url, "storage_location_ids", "storage_location_id");
    const batchNumbers = parseMultiValueParams(url, "batch_numbers", "batch_number");
    const packingPoNumbers = parseMultiValueParams(url, "packing_po_numbers", "packing_po_number");
    const movementTypeCodes = parseMultiValueParams(url, "movement_type_codes", "movement_type_code", (value) => value.toUpperCase());
    const companyId = await resolveMandatorySingleCompanyId(ctx, companyIds);

    let query = serviceRoleClient
      .schema("erp_inventory")
      .from("stock_ledger")
      .select("id, ledger_seq, stock_document_id, posting_date, company_id, storage_location_id, material_id, batch_number, movement_type_code, direction, quantity, posted_quantity, base_uom_code, value, posted_value, valuation_rate, created_at, created_by")
      .eq("company_id", companyId)
      .order("posting_date", { ascending: true })
      .order("ledger_seq", { ascending: true });
    query = (query as unknown as { gte: (column: string, value: string) => typeof query }).gte("posting_date", dateFrom);
    query = (query as unknown as { lte: (column: string, value: string) => typeof query }).lte("posting_date", dateTo);

    if (materialIds.length > 0) {
      query = query.in("material_id", materialIds);
    }
    if (storageLocationIds.length > 0) {
      query = query.in("storage_location_id", storageLocationIds);
    }
    if (batchNumbers.length > 0) {
      query = query.in("batch_number", batchNumbers);
    }
    if (movementTypeCodes.length > 0) {
      query = query.in("movement_type_code", movementTypeCodes);
    }

    const { data, error } = await query;
    if (error) {
      return reportErrorResponse(req, ctx, "STOCK_LEDGER_FETCH_FAILED", 500, "Unable to fetch stock ledger report.");
    }

    const ledgerRows = ((data ?? []) as JsonRecord[]).map((row) => ({
      id: toTrimmedString(row.id),
      ledger_seq: Number(row.ledger_seq ?? 0),
      stock_document_id: toTrimmedString(row.stock_document_id),
      posting_date: toTrimmedString(row.posting_date),
      company_id: toTrimmedString(row.company_id),
      storage_location_id: toTrimmedString(row.storage_location_id),
      material_id: toTrimmedString(row.material_id),
      batch_number: toTrimmedString(row.batch_number) || null,
      movement_type_code: toTrimmedString(row.movement_type_code).toUpperCase(),
      direction: toTrimmedString(row.direction).toUpperCase(),
      quantity: Number(row.quantity ?? 0),
      posted_quantity: Number(row.posted_quantity ?? 0),
      base_uom_code: toTrimmedString(row.base_uom_code),
      value: Number(row.value ?? 0),
      posted_value: Number(row.posted_value ?? 0),
      valuation_rate: Number(row.valuation_rate ?? 0),
      created_at: toTrimmedString(row.created_at) || null,
      created_by: toTrimmedString(row.created_by),
    } satisfies StockLedgerRow));

    const stockDocumentIds = [...new Set(ledgerRows.map((row) => row.stock_document_id).filter(Boolean))];
    const materialIdsForLookup = [...new Set(ledgerRows.map((row) => row.material_id).filter(Boolean))];
    const slocIdsForLookup = [...new Set(ledgerRows.map((row) => row.storage_location_id).filter(Boolean))];
    const companyIdsForLookup = [...new Set(ledgerRows.map((row) => row.company_id).filter(Boolean))];

    // stockDocumentIds/materialIdsForLookup scale 1:1 with the row count -- a wide date range
    // with no movement-type filter can put hundreds of distinct ids in a single .in() call,
    // which PostgREST sends as a GET request with the id list encoded in the URL. Found live
    // 2026-08-19: ~400 distinct stock_document_id values built a URL long enough to be
    // rejected before ever reaching Postgres/PostgREST (no server-side log trail either,
    // since the request never got that far) -- chunked via fetchInChunks to keep each request
    // small regardless of result-set size. See _shared/chunkedIn.ts.
    let stockDocRows: JsonRecord[];
    let materialRows: JsonRecord[];
    let slocRows: JsonRecord[];
    let companyRows: JsonRecord[];
    let conversionRows: JsonRecord[];
    try {
      [stockDocRows, materialRows, slocRows, companyRows, conversionRows] = await Promise.all([
        fetchInChunks<JsonRecord>(stockDocumentIds, (idChunk) =>
          serviceRoleClient
            .schema("erp_inventory")
            .from("stock_document")
            .select("id, document_number, item_number, document_year, reference_document_type, reference_document_number, reference_document_id, reversal_document_id, source_lot_ref, posted_by")
            .in("id", idChunk)),
        fetchInChunks<JsonRecord>(materialIdsForLookup, (idChunk) =>
          serviceRoleClient
            .schema("erp_master")
            .from("material_master")
            .select("id, pace_code, external_code, material_name, document_name, material_type, base_uom_code, purchase_uom_code, pack_code")
            .in("id", idChunk)),
        fetchInChunks<JsonRecord>(slocIdsForLookup, (idChunk) =>
          serviceRoleClient
            .schema("erp_inventory")
            .from("storage_location_master")
            .select("id, code")
            .in("id", idChunk)),
        fetchInChunks<JsonRecord>(companyIdsForLookup, (idChunk) =>
          serviceRoleClient
            .schema("erp_master")
            .from("companies")
            .select("id, company_code, company_name")
            .in("id", idChunk)),
        fetchInChunks<JsonRecord>(materialIdsForLookup, (idChunk) =>
          serviceRoleClient
            .schema("erp_master")
            .from("material_uom_conversion")
            .select("material_id, from_uom_code, to_uom_code, conversion_factor, variable_conversion")
            .in("material_id", idChunk)
            .eq("active", true)),
      ]);
    } catch {
      return reportErrorResponse(req, ctx, "STOCK_LEDGER_FETCH_FAILED", 500, "Unable to fetch stock ledger report.");
    }

    const docMap = new Map(stockDocRows.map((row) => [toTrimmedString(row.id), row]));
    const materialMap = new Map(materialRows.map((row) => [toTrimmedString(row.id), row]));
    const slocMap = new Map(slocRows.map((row) => [toTrimmedString(row.id), row]));
    const companyMap = new Map(companyRows.map((row) => [toTrimmedString(row.id), row]));
    const conversionsByMaterialId = new Map<string, JsonRecord[]>();
    for (const row of conversionRows) {
      const materialId = toTrimmedString(row.material_id);
      if (!materialId) continue;
      if (!conversionsByMaterialId.has(materialId)) {
        conversionsByMaterialId.set(materialId, []);
      }
      conversionsByMaterialId.get(materialId)?.push(row);
    }
    const openingLotMap = await buildOpeningStockLotMap(stockDocRows);

    const userIds = new Set<string>();
    const fgPoNumbers = new Set<string>();
    const packCodes = new Set<string>();
    for (const row of ledgerRows) {
      if (row.created_by) {
        userIds.add(row.created_by);
      }
      const doc = docMap.get(row.stock_document_id);
      const postedBy = toTrimmedString(doc?.posted_by);
      if (postedBy) {
        userIds.add(postedBy);
      }
      const material = materialMap.get(row.material_id);
      if (toTrimmedString(material?.material_type) === "FG") {
        const poNumber = resolveLotRef(doc, row.material_id, row.batch_number, openingLotMap);
        if (poNumber) fgPoNumbers.add(poNumber);
      }
      const packCode = toTrimmedString(material?.pack_code);
      if (packCode) {
        packCodes.add(packCode);
      }
    }

    const [userDisplayMap, packingOrderResp, packCodeResp] = await Promise.all([
      resolveUserDisplayNames([...userIds]),
      fgPoNumbers.size > 0
        ? serviceRoleClient.schema("erp_production").from("packing_order").select("po_number, fill_qty_per_pack").in("po_number", [...fgPoNumbers])
        : Promise.resolve({ data: [], error: null }),
      packCodes.size > 0
        ? serviceRoleClient.schema("erp_production").from("pack_code_master").select("pack_code, outer_uom_code").in("pack_code", [...packCodes])
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (packingOrderResp.error || packCodeResp.error) {
      return reportErrorResponse(req, ctx, "STOCK_LEDGER_FETCH_FAILED", 500, "Unable to fetch stock ledger report.");
    }

    const packingOrderMap = new Map(((packingOrderResp.data ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.po_number), row]));
    const packCodeMap = new Map(((packCodeResp.data ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.pack_code), toTrimmedString(row.outer_uom_code)]));

    const referenceIdsByType = new Map<string, Set<string>>();
    for (const row of ledgerRows) {
      const doc = docMap.get(row.stock_document_id);
      const refType = toTrimmedString(doc?.reference_document_type).toUpperCase();
      const refId = toTrimmedString(doc?.reference_document_id);
      if (!refType || !refId) continue;
      if (!referenceIdsByType.has(refType)) {
        referenceIdsByType.set(refType, new Set<string>());
      }
      referenceIdsByType.get(refType)?.add(refId);
    }

    const vendorCustomerLabelByRef = new Map<string, string | null>();
    const vendorCustomerFetches: Promise<void>[] = [];

    if ((referenceIdsByType.get("GRN")?.size ?? 0) > 0) {
      vendorCustomerFetches.push((async () => {
        const refIds = [...(referenceIdsByType.get("GRN") ?? new Set<string>())];
        const grnResp = await serviceRoleClient.schema("erp_procurement").from("goods_receipt").select("id, vendor_id").in("id", refIds);
        if (grnResp.error) throw new Error("STOCK_LEDGER_VENDOR_RESOLVE_FAILED");
        const vendorIds = [...new Set(((grnResp.data ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.vendor_id)).filter(Boolean))];
        const vendorResp = vendorIds.length > 0
          ? await serviceRoleClient.schema("erp_master").from("vendor_master").select("id, vendor_code, vendor_name").in("id", vendorIds)
          : { data: [], error: null };
        if (vendorResp.error) throw new Error("STOCK_LEDGER_VENDOR_RESOLVE_FAILED");
        const vendorMap = new Map(((vendorResp.data ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.id), row]));
        for (const row of (grnResp.data ?? []) as JsonRecord[]) {
          const vendor = vendorMap.get(toTrimmedString(row.vendor_id));
          vendorCustomerLabelByRef.set(
            `GRN:${toTrimmedString(row.id)}`,
            vendor ? `${toTrimmedString(vendor.vendor_code) || "—"} — ${toTrimmedString(vendor.vendor_name)}` : null,
          );
        }
      })());
    }

    if ((referenceIdsByType.get("RTV")?.size ?? 0) > 0) {
      vendorCustomerFetches.push((async () => {
        const refIds = [...(referenceIdsByType.get("RTV") ?? new Set<string>())];
        const rtvResp = await serviceRoleClient.schema("erp_procurement").from("return_to_vendor").select("id, vendor_id").in("id", refIds);
        if (rtvResp.error) throw new Error("STOCK_LEDGER_VENDOR_RESOLVE_FAILED");
        const vendorIds = [...new Set(((rtvResp.data ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.vendor_id)).filter(Boolean))];
        const vendorResp = vendorIds.length > 0
          ? await serviceRoleClient.schema("erp_master").from("vendor_master").select("id, vendor_code, vendor_name").in("id", vendorIds)
          : { data: [], error: null };
        if (vendorResp.error) throw new Error("STOCK_LEDGER_VENDOR_RESOLVE_FAILED");
        const vendorMap = new Map(((vendorResp.data ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.id), row]));
        for (const row of (rtvResp.data ?? []) as JsonRecord[]) {
          const vendor = vendorMap.get(toTrimmedString(row.vendor_id));
          vendorCustomerLabelByRef.set(
            `RTV:${toTrimmedString(row.id)}`,
            vendor ? `${toTrimmedString(vendor.vendor_code) || "—"} — ${toTrimmedString(vendor.vendor_name)}` : null,
          );
        }
      })());
    }

    if ((referenceIdsByType.get("SALES_INVOICE")?.size ?? 0) > 0) {
      vendorCustomerFetches.push((async () => {
        const refIds = [...(referenceIdsByType.get("SALES_INVOICE") ?? new Set<string>())];
        const invoiceResp = await serviceRoleClient.schema("erp_procurement").from("sales_invoice").select("id, customer_id").in("id", refIds);
        if (invoiceResp.error) throw new Error("STOCK_LEDGER_CUSTOMER_RESOLVE_FAILED");
        const customerIds = [...new Set(((invoiceResp.data ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.customer_id)).filter(Boolean))];
        const customerResp = customerIds.length > 0
          ? await serviceRoleClient.schema("erp_master").from("customer_master").select("id, customer_code, customer_name").in("id", customerIds)
          : { data: [], error: null };
        if (customerResp.error) throw new Error("STOCK_LEDGER_CUSTOMER_RESOLVE_FAILED");
        const customerMap = new Map(((customerResp.data ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.id), row]));
        for (const row of (invoiceResp.data ?? []) as JsonRecord[]) {
          const customer = customerMap.get(toTrimmedString(row.customer_id));
          vendorCustomerLabelByRef.set(
            `SALES_INVOICE:${toTrimmedString(row.id)}`,
            customer ? `${toTrimmedString(customer.customer_code) || "—"} — ${toTrimmedString(customer.customer_name)}` : null,
          );
        }
      })());
    }

    if (vendorCustomerFetches.length > 0) {
      await Promise.all(vendorCustomerFetches);
    }

    const rows = ledgerRows.map((row) => {
      const doc = docMap.get(row.stock_document_id);
      const material = materialMap.get(row.material_id);
      const sloc = slocMap.get(row.storage_location_id);
      const company = companyMap.get(row.company_id);
      const materialType = toTrimmedString(material?.material_type);
      const materialLabel = resolveMaterialLabel(material) || "—";
      const materialCode = toTrimmedString(material?.pace_code) || "—";
      const documentName = toTrimmedString(material?.document_name) || null;
      // Signed: negative for OUT, positive for IN (posted_quantity/posted_value are GENERATED
      // columns on stock_ledger -- see feasibility doc Section 124). pack_quantity below is a
      // straight division of baseQuantity, so it inherits the correct sign too.
      const baseQuantity = normalizeNumber(row.posted_quantity);
      const conversion = resolveAltUomConversion(material, conversionsByMaterialId.get(row.material_id) ?? []);
      const altFactor = Number(conversion?.conversion_factor ?? 0);
      const fgPoNumber = materialType === "FG" ? resolveLotRef(doc, row.material_id, row.batch_number, openingLotMap) : "";
      const fgPo = fgPoNumber ? packingOrderMap.get(fgPoNumber) : null;
      const packUomCode = packCodeMap.get(toTrimmedString(material?.pack_code)) || null;
      let packQuantity: number | null = null;
      let resolvedPackUomCode: string | null = null;

      if (materialType === "FG") {
        const fillQtyPerPack = Number(fgPo?.fill_qty_per_pack ?? 0);
        packQuantity = fillQtyPerPack > 0 ? normalizeNumber(baseQuantity / fillQtyPerPack) : null;
        resolvedPackUomCode = packUomCode;
      } else if (materialType !== "SFG" && conversion && altFactor > 0) {
        packQuantity = normalizeNumber(baseQuantity / altFactor);
        resolvedPackUomCode = toTrimmedString(conversion.from_uom_code) || null;
      }

      const refType = toTrimmedString(doc?.reference_document_type).toUpperCase();
      const refId = toTrimmedString(doc?.reference_document_id);
      const postedBy = toTrimmedString(doc?.posted_by);
      const resolvedUserId = postedBy || row.created_by;
      const rawUserLabel = userDisplayMap.get(resolvedUserId) ?? "";
      const userLabel = rawUserLabel && rawUserLabel !== resolvedUserId ? rawUserLabel : null;

      return {
        id: row.id,
        row_key: `${toTrimmedString(doc?.document_number)}__${toTrimmedString(doc?.item_number)}__${row.ledger_seq}`,
        material_document_number: toTrimmedString(doc?.document_number) || "—",
        material_document_item: toTrimmedString(doc?.item_number) || "—",
        material_document_year: toTrimmedString(doc?.document_year) || "—",
        posting_date: row.posting_date || "—",
        company: company ? toTrimmedString(company.company_code) || "—" : "—",
        material_type: materialType || "—",
        material: `${materialCode} — ${materialLabel}`,
        external_code: toTrimmedString(material?.external_code) || "—",
        document_name: documentName || "—",
        storage_location: toTrimmedString(sloc?.code) || "—",
        batch_number: row.batch_number || "—",
        movement_type: toTrimmedString(row.movement_type_code) || "—",
        base_quantity: baseQuantity,
        base_uom_code: row.base_uom_code || "—",
        pack_quantity: packQuantity,
        pack_uom_code: resolvedPackUomCode,
        value: normalizeNumber(row.posted_value, 4),
        direction: row.direction || "—",
        reference_document: toTrimmedString(doc?.reference_document_number) || "—",
        packing_po_number: fgPoNumber || "—",
        vendor_customer: vendorCustomerLabelByRef.get(`${refType}:${refId}`) || "—",
        user_display: userLabel || "—",
        entry_date_time: formatDateTimeDisplay(row.created_at) || "—",
      };
    });
    const filteredRows = packingPoNumbers.length > 0
      ? rows.filter((row) => packingPoNumbers.includes(toTrimmedString(row.packing_po_number)))
      : rows;

    return okResponse({ data: filteredRows, total: filteredRows.length }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STOCK_LEDGER_FETCH_FAILED";
    return reportErrorResponse(req, ctx, code, companyErrorStatus(code) ?? 500, "Unable to fetch stock ledger report.");
  }
}

export async function getCurrentStockHandler(
  req: Request,
  ctx: StockReportHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const url = new URL(req.url);
    const companyIds = parseMultiValueParams(url, "company_ids", "company_id");
    const materialIds = parseMultiValueParams(url, "material_ids", "material_id");
    const storageLocationIds = parseMultiValueParams(url, "storage_location_ids");
    const batchNumbers = parseMultiValueParams(url, "batch_numbers");
    const packingPoNumbers = parseMultiValueParams(url, "packing_po_numbers");
    const materialTypes = parseMultiValueParams(url, "material_types", undefined, (value) => value.toUpperCase());
    const stockTypes = parseMultiValueParams(
      url,
      "stock_types",
      "stock_type_code",
      (value) => normalizeStockTypeFilter(value.toUpperCase()),
    );
    const showZero = parseBooleanFlag(url.searchParams.get("show_zero"));

    const requestedMaterialTypes = materialTypes.length
      ? materialTypes.filter((value) => ["RM", "PM", "INT", "SFG", "FG"].includes(value))
      : ["RM", "PM", "INT", "SFG", "FG"];
    const requestedStockTypes = stockTypes.length
      ? stockTypes.filter((value) => ["UNRESTRICTED", "QUALITY_INSPECTION", "BLOCKED"].includes(value))
      : ["UNRESTRICTED", "QUALITY_INSPECTION", "BLOCKED"];
    const companyId = await resolveMandatorySingleCompanyId(ctx, companyIds);

    let materialQuery = serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .select("id, pace_code, external_code, material_name, document_name, material_type, base_uom_code, pack_code");
    if (requestedMaterialTypes.length > 0) {
      materialQuery = materialQuery.in("material_type", requestedMaterialTypes);
    }
    if (materialIds.length > 0) {
      materialQuery = materialQuery.in("id", materialIds);
    }
    const { data: materialRows, error: materialError } = await materialQuery;
    if (materialError) {
      return reportErrorResponse(req, ctx, "CURRENT_STOCK_FETCH_FAILED", 500, "Unable to fetch current stock.");
    }

    const scopedMaterials = (materialRows ?? []) as JsonRecord[];
    if (scopedMaterials.length === 0) {
      return okResponse({ data: [], total: 0 }, ctx.request_id, req);
    }

    const materialMap = new Map<string, CurrentStockMaterialRow>();
    const pathAMaterialIds: string[] = [];
    const ledgerMaterialIds: string[] = [];
    const packCodes = new Set<string>();
    for (const rawMaterial of scopedMaterials) {
      const material = rawMaterial as unknown as CurrentStockMaterialRow;
      materialMap.set(material.id, material);
      if (material.pack_code) {
        packCodes.add(material.pack_code);
      }
      if (["RM", "PM", "INT"].includes(material.material_type)) {
        pathAMaterialIds.push(material.id);
      }
      if (["SFG", "FG"].includes(material.material_type)) {
        ledgerMaterialIds.push(material.id);
      }
    }

    const draftRows = new Map<string, CurrentStockDraftRow>();
    const getOrCreateRow = (row: CurrentStockDraftRow) => {
      const key = [
        row.path_kind,
        row.company_id,
        row.material_id,
        row.storage_location_id,
        row.batch_number ?? "",
        row.packing_po_number ?? "",
      ].join("__");
      if (!draftRows.has(key)) {
        draftRows.set(key, row);
      }
      return draftRows.get(key)!;
    };

    if (pathAMaterialIds.length > 0 && batchNumbers.length === 0 && packingPoNumbers.length === 0) {
      let snapshotQuery = serviceRoleClient
        .schema("erp_inventory")
        .from("stock_snapshot")
        .select("company_id, material_id, storage_location_id, stock_type_code, quantity, base_uom_code")
        .in("material_id", pathAMaterialIds)
        .in("stock_type_code", requestedStockTypes)
        .eq("company_id", companyId);
      if (storageLocationIds.length > 0) {
        snapshotQuery = snapshotQuery.in("storage_location_id", storageLocationIds);
      }
      if (!showZero) {
        snapshotQuery = (snapshotQuery as unknown as { gt: (column: string, value: number) => typeof snapshotQuery })
          .gt("quantity", 0);
      }
      const { data: snapshotRows, error: snapshotError } = await snapshotQuery;
      if (snapshotError) {
        return reportErrorResponse(req, ctx, "CURRENT_STOCK_FETCH_FAILED", 500, "Unable to fetch current stock.");
      }
      for (const snapshot of (snapshotRows ?? []) as JsonRecord[]) {
        const materialId = toTrimmedString(snapshot.material_id);
        const material = materialMap.get(materialId);
        if (!material) continue;
        const row = getOrCreateRow(initializeCurrentStockDraftRow({
          company_id: toTrimmedString(snapshot.company_id),
          material_id: materialId,
          storage_location_id: toTrimmedString(snapshot.storage_location_id),
          batch_number: null,
          packing_po_number: null,
          base_uom_code: toTrimmedString(snapshot.base_uom_code) || material.base_uom_code || "",
          material_type: material.material_type,
          path_kind: "A",
        }));
        appendStockTypeQuantity(row, toTrimmedString(snapshot.stock_type_code), Number(snapshot.quantity ?? 0));
      }
    }

    if (ledgerMaterialIds.length > 0) {
      let ledgerQuery = serviceRoleClient
        .schema("erp_inventory")
        .from("stock_ledger")
        .select("company_id, material_id, storage_location_id, stock_type_code, batch_number, quantity, direction, stock_document_id")
        .in("material_id", ledgerMaterialIds)
        .in("stock_type_code", requestedStockTypes)
        .eq("company_id", companyId);
      if (storageLocationIds.length > 0) {
        ledgerQuery = ledgerQuery.in("storage_location_id", storageLocationIds);
      }
      if (batchNumbers.length > 0) {
        ledgerQuery = ledgerQuery.in("batch_number", batchNumbers);
      }
      const { data: ledgerRows, error: ledgerError } = await ledgerQuery;
      if (ledgerError) {
        return reportErrorResponse(req, ctx, "CURRENT_STOCK_FETCH_FAILED", 500, "Unable to fetch current stock.");
      }

      const typedLedgerRows = (ledgerRows ?? []) as JsonRecord[];
      const docIds = [...new Set(typedLedgerRows.map((row) => toTrimmedString(row.stock_document_id)).filter(Boolean))];
      const { data: docRows, error: docError } = docIds.length
        ? await serviceRoleClient
            .schema("erp_inventory")
            .from("stock_document")
            .select("id, document_number, source_lot_ref, reference_document_type, reference_document_number, reference_document_id")
            .in("id", docIds)
        : { data: [], error: null };
      if (docError) {
        return reportErrorResponse(req, ctx, "CURRENT_STOCK_FETCH_FAILED", 500, "Unable to fetch current stock.");
      }
      const docMap = new Map(((docRows ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.id), row]));
      const openingLotMap = await buildOpeningStockLotMap((docRows ?? []) as JsonRecord[]);
      const poNumbers = [...new Set(
        typedLedgerRows
          .map((row) => resolveLotRef(
            docMap.get(toTrimmedString(row.stock_document_id)),
            toTrimmedString(row.material_id),
            toTrimmedString(row.batch_number) || null,
            openingLotMap,
          ))
          .filter(Boolean),
      )];
      const { data: poRows, error: poError } = poNumbers.length
        ? await serviceRoleClient
            .schema("erp_production")
            .from("packing_order")
            .select("po_number, source_po_type, num_packs, fill_qty_per_pack")
            .in("po_number", poNumbers)
        : { data: [], error: null };
      if (poError) {
        return reportErrorResponse(req, ctx, "CURRENT_STOCK_FETCH_FAILED", 500, "Unable to fetch current stock.");
      }
      const poMap = new Map(((poRows ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.po_number), row]));

      for (const ledger of typedLedgerRows) {
        const materialId = toTrimmedString(ledger.material_id);
        const material = materialMap.get(materialId);
        if (!material) continue;
        const signedQty = toTrimmedString(ledger.direction).toUpperCase() === "IN"
          ? Number(ledger.quantity ?? 0)
          : -Number(ledger.quantity ?? 0);
        const batchNumber = toTrimmedString(ledger.batch_number) || null;
        const resolvedPoNumber = resolveLotRef(
          docMap.get(toTrimmedString(ledger.stock_document_id)),
          materialId,
          batchNumber,
          openingLotMap,
        ) || null;
        const packingOrder = resolvedPoNumber ? poMap.get(resolvedPoNumber) : undefined;
        const sourcePoType = toTrimmedString(packingOrder?.source_po_type).toUpperCase();

        if (material.material_type === "SFG") {
          if (packingPoNumbers.length > 0) continue;
          const row = getOrCreateRow(initializeCurrentStockDraftRow({
            company_id: toTrimmedString(ledger.company_id),
            material_id: materialId,
            storage_location_id: toTrimmedString(ledger.storage_location_id),
            batch_number: batchNumber,
            packing_po_number: null,
            base_uom_code: material.base_uom_code || "",
            material_type: material.material_type,
            path_kind: "B",
          }));
          appendStockTypeQuantity(row, toTrimmedString(ledger.stock_type_code), signedQty);
          continue;
        }

        if (sourcePoType === "MTS") {
          if (batchNumbers.length > 0) continue;
          if (packingPoNumbers.length > 0 && (!resolvedPoNumber || !packingPoNumbers.includes(resolvedPoNumber))) {
            continue;
          }
          const row = getOrCreateRow(initializeCurrentStockDraftRow({
            company_id: toTrimmedString(ledger.company_id),
            material_id: materialId,
            storage_location_id: toTrimmedString(ledger.storage_location_id),
            batch_number: null,
            packing_po_number: null,
            base_uom_code: material.base_uom_code || "",
            material_type: material.material_type,
            path_kind: "A",
          }));
          appendStockTypeQuantity(row, toTrimmedString(ledger.stock_type_code), signedQty);
          continue;
        }

        if (packingPoNumbers.length > 0 && (!resolvedPoNumber || !packingPoNumbers.includes(resolvedPoNumber))) {
          continue;
        }
        const row = getOrCreateRow(initializeCurrentStockDraftRow({
          company_id: toTrimmedString(ledger.company_id),
          material_id: materialId,
          storage_location_id: toTrimmedString(ledger.storage_location_id),
          batch_number: batchNumber,
          packing_po_number: resolvedPoNumber,
          base_uom_code: material.base_uom_code || "",
          material_type: material.material_type,
          path_kind: "C",
          fill_qty_per_pack: Number(packingOrder?.fill_qty_per_pack ?? 0) || null,
          num_packs: Number(packingOrder?.num_packs ?? 0) || null,
        }));
        appendStockTypeQuantity(row, toTrimmedString(ledger.stock_type_code), signedQty);
      }
    }

    let rows = [...draftRows.values()];
    if (!showZero) {
      rows = rows.filter((row) => !isZeroBalanceRow(row));
    }

    const companyIdsForLookup = [...new Set(rows.map((row) => row.company_id).filter(Boolean))];
    const slocIdsForLookup = [...new Set(rows.map((row) => row.storage_location_id).filter(Boolean))];
    const [companyResp, slocResp, packResp] = await Promise.all([
      companyIdsForLookup.length
        ? serviceRoleClient.schema("erp_master").from("companies").select("id, company_code").in("id", companyIdsForLookup)
        : Promise.resolve({ data: [], error: null }),
      slocIdsForLookup.length
        ? serviceRoleClient.schema("erp_inventory").from("storage_location_master").select("id, code").in("id", slocIdsForLookup)
        : Promise.resolve({ data: [], error: null }),
      packCodes.size > 0
        ? serviceRoleClient.schema("erp_production").from("pack_code_master").select("pack_code, outer_uom_code").in("pack_code", [...packCodes])
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (companyResp.error || slocResp.error || packResp.error) {
      return reportErrorResponse(req, ctx, "CURRENT_STOCK_FETCH_FAILED", 500, "Unable to fetch current stock.");
    }
    const companyMap = new Map(((companyResp.data ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.id), toTrimmedString(row.company_code)]));
    const slocMap = new Map(((slocResp.data ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.id), toTrimmedString(row.code)]));
    const packCodeMap = new Map(((packResp.data ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.pack_code), toTrimmedString(row.outer_uom_code)]));

    const pathAReservationMap = new Map<string, number>();
    const pathARows = rows.filter((row) => row.path_kind === "A");
    if (pathARows.length > 0) {
      let reservationQuery = serviceRoleClient
        .schema("erp_production")
        .from("reservation_document")
        .select("company_id, material_id, storage_location_id, balance_qty")
        .eq("status", "OPEN")
        .in("company_id", [...new Set(pathARows.map((row) => row.company_id))])
        .in("material_id", [...new Set(pathARows.map((row) => row.material_id))]);
      const pathASlocIds = [...new Set(pathARows.map((row) => row.storage_location_id).filter(Boolean))];
      if (pathASlocIds.length > 0) {
        reservationQuery = reservationQuery.in("storage_location_id", pathASlocIds);
      }
      const { data: reservationRows, error: reservationError } = await reservationQuery;
      if (reservationError) {
        return reportErrorResponse(req, ctx, "CURRENT_STOCK_FETCH_FAILED", 500, "Unable to fetch current stock.");
      }
      for (const reservation of (reservationRows ?? []) as JsonRecord[]) {
        const key = [
          toTrimmedString(reservation.company_id),
          toTrimmedString(reservation.material_id),
          toTrimmedString(reservation.storage_location_id),
        ].join("__");
        pathAReservationMap.set(key, normalizeNumber((pathAReservationMap.get(key) ?? 0) + Number(reservation.balance_qty ?? 0)));
      }
    }

    const pathBCReservationMap = new Map<string, number>();
    const pathBCRows = rows.filter((row) => row.path_kind !== "A");
    if (pathBCRows.length > 0) {
      let reservationQuery = serviceRoleClient
        .schema("erp_production")
        .from("reservation_document")
        .select("company_id, material_id, storage_location_id, batch_number, balance_qty")
        .eq("status", "OPEN")
        .in("company_id", [...new Set(pathBCRows.map((row) => row.company_id))])
        .in("material_id", [...new Set(pathBCRows.map((row) => row.material_id))]);
      const pathBCSlocIds = [...new Set(pathBCRows.map((row) => row.storage_location_id).filter(Boolean))];
      if (pathBCSlocIds.length > 0) {
        reservationQuery = reservationQuery.in("storage_location_id", pathBCSlocIds);
      }
      const pathBCBatches = [...new Set(pathBCRows.map((row) => row.batch_number).filter(Boolean))];
      if (pathBCBatches.length > 0) {
        reservationQuery = reservationQuery.in("batch_number", pathBCBatches as string[]);
      }
      const { data: reservationRows, error: reservationError } = await reservationQuery;
      if (reservationError) {
        return reportErrorResponse(req, ctx, "CURRENT_STOCK_FETCH_FAILED", 500, "Unable to fetch current stock.");
      }
      for (const reservation of (reservationRows ?? []) as JsonRecord[]) {
        const key = [
          toTrimmedString(reservation.company_id),
          toTrimmedString(reservation.material_id),
          toTrimmedString(reservation.storage_location_id),
          toTrimmedString(reservation.batch_number),
        ].join("__");
        pathBCReservationMap.set(key, normalizeNumber((pathBCReservationMap.get(key) ?? 0) + Number(reservation.balance_qty ?? 0)));
      }
    }

    const responseRows = rows.map((row) => {
      const material = materialMap.get(row.material_id);
      const companyCode = companyMap.get(row.company_id) ?? "";
      const slocCode = slocMap.get(row.storage_location_id) ?? "";
      const documentName = toTrimmedString(material?.document_name);
      const materialLabel = documentName || toTrimmedString(material?.material_name);
      const reservedBaseQty = row.path_kind === "A"
        ? pathAReservationMap.get([row.company_id, row.material_id, row.storage_location_id].join("__")) ?? 0
        : pathBCReservationMap.get([row.company_id, row.material_id, row.storage_location_id, row.batch_number ?? ""].join("__")) ?? 0;
      const uomCode = row.path_kind === "C"
        ? packCodeMap.get(toTrimmedString(material?.pack_code)) || row.base_uom_code
        : row.base_uom_code;
      const unrestrictedQty = row.path_kind === "C"
        ? convertFgQtyToPrimary(row.unrestricted_qty, row.fill_qty_per_pack)
        : normalizeNumber(row.unrestricted_qty);
      const qiQty = row.path_kind === "C"
        ? convertFgQtyToPrimary(row.qi_qty, row.fill_qty_per_pack)
        : normalizeNumber(row.qi_qty);
      const blockedQty = row.path_kind === "C"
        ? convertFgQtyToPrimary(row.blocked_qty, row.fill_qty_per_pack)
        : normalizeNumber(row.blocked_qty);
      const reservedQty = row.path_kind === "C"
        ? convertFgQtyToPrimary(reservedBaseQty, row.fill_qty_per_pack)
        : normalizeNumber(reservedBaseQty);

      return {
        row_key: [
          companyCode,
          material?.pace_code ?? row.material_id,
          slocCode,
          row.batch_number ?? "",
          row.packing_po_number ?? "",
          row.path_kind,
        ].join("__"),
        company_code: companyCode,
        material_type: material?.material_type ?? row.material_type,
        material_label: materialLabel,
        external_code: toTrimmedString(material?.external_code),
        document_name: documentName,
        uom_code: uomCode,
        storage_location_code: slocCode,
        batch_number: row.batch_number,
        packing_po_number: row.packing_po_number,
        unrestricted_qty: unrestrictedQty,
        reserved_qty: reservedQty,
        net_available_qty: normalizeNumber(unrestrictedQty - reservedQty),
        qi_qty: qiQty,
        blocked_qty: blockedQty,
      };
    }).sort((left, right) =>
      String(left.company_code).localeCompare(String(right.company_code))
      || String(left.material_type).localeCompare(String(right.material_type))
      || String(left.material_label).localeCompare(String(right.material_label))
      || String(left.storage_location_code).localeCompare(String(right.storage_location_code))
      || String(left.batch_number ?? "").localeCompare(String(right.batch_number ?? ""))
      || String(left.packing_po_number ?? "").localeCompare(String(right.packing_po_number ?? ""))
    );

    return okResponse(
      {
        data: responseRows,
        total: responseRows.length,
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "CURRENT_STOCK_FETCH_FAILED";
    return reportErrorResponse(req, ctx, code, companyErrorStatus(code) ?? 500, "Unable to fetch current stock.");
  }
}

export async function searchCurrentStockBatchNumbersHandler(
  req: Request,
  ctx: StockReportHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const q = toTrimmedString(url.searchParams.get("q"));
    const companyScopeIds = await resolveCompanyScopeList(ctx, parseMultiValueParams(url, "company_ids", "company_id"));

    let query = serviceRoleClient
      .schema("erp_inventory")
      .from("stock_ledger")
      .select("batch_number")
      .not("batch_number", "is", null)
      .order("batch_number", { ascending: true })
      .limit(50);
    if (companyScopeIds) {
      query = query.in("company_id", companyScopeIds);
    }
    if (q) {
      query = (query as unknown as { ilike: (column: string, value: string) => typeof query })
        .ilike("batch_number", `${q}%`);
    }
    const { data, error } = await query;
    if (error) {
      return reportErrorResponse(req, ctx, "CURRENT_STOCK_BATCH_SEARCH_FAILED", 500, "Unable to search batch numbers.");
    }
    const values = [...new Set(((data ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.batch_number)).filter(Boolean))]
      .slice(0, 50)
      .map((value) => ({ value, label: value }));
    return okResponse({ data: values, total: values.length }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "CURRENT_STOCK_BATCH_SEARCH_FAILED";
    return reportErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, "Unable to search batch numbers.");
  }
}

export async function searchCurrentStockPackingPoNumbersHandler(
  req: Request,
  ctx: StockReportHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const q = toTrimmedString(url.searchParams.get("q"));
    const companyScopeIds = await resolveCompanyScopeList(ctx, parseMultiValueParams(url, "company_ids", "company_id"));

    let query = serviceRoleClient
      .schema("erp_production")
      .from("packing_order")
      .select("po_number")
      .order("po_number", { ascending: true })
      .limit(50);
    if (companyScopeIds) {
      query = query.in("company_id", companyScopeIds);
    }
    if (q) {
      query = (query as unknown as { ilike: (column: string, value: string) => typeof query })
        .ilike("po_number", `${q}%`);
    }
    const { data, error } = await query;
    if (error) {
      return reportErrorResponse(req, ctx, "CURRENT_STOCK_PO_SEARCH_FAILED", 500, "Unable to search packing PO numbers.");
    }
    const values = [...new Set(((data ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.po_number)).filter(Boolean))]
      .slice(0, 50)
      .map((value) => ({ value, label: value }));
    return okResponse({ data: values, total: values.length }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "CURRENT_STOCK_PO_SEARCH_FAILED";
    return reportErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, "Unable to search packing PO numbers.");
  }
}

export async function searchStockLedgerBatchNumbersHandler(
  req: Request,
  ctx: StockReportHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const q = toTrimmedString(url.searchParams.get("q"));
    const companyScopeIds = await resolveCompanyScopeList(ctx, parseMultiValueParams(url, "company_ids", "company_id"));
    return await searchDistinctTextValues({
      schema: "erp_inventory",
      table: "stock_ledger",
      column: "batch_number",
      q,
      companyScopeIds,
      req,
      ctx,
      failureCode: "STOCK_LEDGER_BATCH_SEARCH_FAILED",
      failureMessage: "Unable to search batch numbers.",
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "STOCK_LEDGER_BATCH_SEARCH_FAILED";
    return reportErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, "Unable to search batch numbers.");
  }
}

export async function searchStockLedgerPackingPoNumbersHandler(
  req: Request,
  ctx: StockReportHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const q = toTrimmedString(url.searchParams.get("q"));
    const companyScopeIds = await resolveCompanyScopeList(ctx, parseMultiValueParams(url, "company_ids", "company_id"));
    return await searchDistinctTextValues({
      schema: "erp_production",
      table: "packing_order",
      column: "po_number",
      q,
      companyScopeIds,
      req,
      ctx,
      failureCode: "STOCK_LEDGER_PO_SEARCH_FAILED",
      failureMessage: "Unable to search packing PO numbers.",
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "STOCK_LEDGER_PO_SEARCH_FAILED";
    return reportErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, "Unable to search packing PO numbers.");
  }
}

export async function listStockLedgerMovementTypesHandler(
  req: Request,
  ctx: StockReportHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const { data, error } = await serviceRoleClient
      .schema("erp_inventory")
      .from("movement_type_master")
      .select("code, name")
      .eq("active", true)
      .order("code", { ascending: true });
    if (error) {
      return reportErrorResponse(req, ctx, "STOCK_LEDGER_MOVEMENT_TYPES_FAILED", 500, "Unable to fetch movement types.");
    }
    const rows = ((data ?? []) as JsonRecord[]).map((row) => {
      const code = toTrimmedString(row.code).toUpperCase();
      const name = toTrimmedString(row.name);
      return { value: code, label: name ? `${code} — ${name}` : code };
    });
    return okResponse({ data: rows, total: rows.length }, ctx.request_id, req);
  } catch {
    return reportErrorResponse(req, ctx, "STOCK_LEDGER_MOVEMENT_TYPES_FAILED", 500, "Unable to fetch movement types.");
  }
}

export async function getStockValuationHandler(
  req: Request,
  ctx: StockReportHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const url = new URL(req.url);
    const materialId = toTrimmedString(url.searchParams.get("material_id"));

    const { companyId, allowedCompanyIds } = await resolveCompanyScope(
      ctx,
      url.searchParams.get("company_id") ?? "",
    );

    let query = serviceRoleClient
      .schema("erp_inventory")
      .from("stock_snapshot")
      .select("material_id, company_id, base_uom_code, quantity, value")
      .gt("quantity", 0);

    if (companyId) {
      query = query.eq("company_id", companyId);
    } else if (allowedCompanyIds) {
      query = query.in("company_id", allowedCompanyIds);
    }
    if (materialId) {
      query = query.eq("material_id", materialId);
    }

    const { data, error } = await query;
    if (error) {
      return reportErrorResponse(
        req,
        ctx,
        "STOCK_VALUATION_FETCH_FAILED",
        500,
        "Unable to fetch stock valuation.",
      );
    }

    const aggMap = new Map<string, ValuationRow>();
    for (const rawRow of data ?? []) {
      const row = rawRow as JsonRecord;
      const rowMaterialId = String(row.material_id);
      const rowCompanyId = String(row.company_id);
      const key = `${rowMaterialId}__${rowCompanyId}`;
      if (!aggMap.has(key)) {
        aggMap.set(key, {
          material_id: rowMaterialId,
          company_id: rowCompanyId,
          base_uom_code: String(row.base_uom_code),
          total_qty: 0,
          total_value: 0,
          weighted_avg_rate: 0,
        });
      }
      const agg = aggMap.get(key);
      if (!agg) continue;
      agg.total_qty += Number(row.quantity);
      agg.total_value += Number(row.value);
    }

    const result: ValuationRow[] = [];
    for (const agg of aggMap.values()) {
      agg.total_qty = normalizeNumber(agg.total_qty);
      agg.total_value = normalizeNumber(agg.total_value, 2);
      agg.weighted_avg_rate = agg.total_qty > 0
        ? normalizeNumber(agg.total_value / agg.total_qty)
        : 0;
      result.push(agg);
    }

    result.sort(
      (left, right) =>
        left.material_id.localeCompare(right.material_id)
        || left.company_id.localeCompare(right.company_id),
    );

    const grandTotalValue = Math.round(
      result.reduce((sum, row) => sum + Number(row.total_value), 0) * 100,
    ) / 100;

    return okResponse(
      {
        data: result,
        total: result.length,
        grand_total_value: grandTotalValue,
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "STOCK_VALUATION_FETCH_FAILED";
    return reportErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, "Unable to fetch stock valuation.");
  }
}
