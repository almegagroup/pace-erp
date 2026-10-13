/*
 * File-Path: supabase/functions/api/_core/procurement/so_map_bulk.handlers.ts
 * Domain: PROCUREMENT / Sales
 * Purpose: "Bulk DD SO Map" (SO01 Tab 2 additive button) — resolves a bulk
 *          Excel upload (External SO Number, FO Number, Customer GST/Name/
 *          Address/Town, Has Site, Site Name/Address/Town, SKU, Pack Qty)
 *          into Customer+Site Address
 *          allocations, per FG-STO-MTS-DISPATCH-DESIGN-DOC.md §6 points 8-12.
 *          VDC (Dependent Direct) only — DC never uses this (§6 point 10).
 *          Preview remains read-only. A separate batch action creates missing
 *          GST customers by invoking the existing MM04 customer/address
 *          handlers in-process, never one browser request per spreadsheet
 *          row. It never writes an allocation itself (the existing
 *          saveSoMapGroupHandler, extended additively with
 *          external_fo_number, does that). so_map.handlers.ts and every
 *          other existing handler in this codebase are untouched.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { resolveGstProfileWithSource } from "../../_shared/gst_resolver.ts";
import { deriveCompanyFieldsFromGstProfile } from "../../_shared/gst_company_fields.ts";
import { createCustomerHandler } from "../om/customer.handlers.ts";
import { createCustomerAddressHandler } from "../om/customer_address.handlers.ts";
import { saveSoMapGroupHandler } from "./so_map.handlers.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const QTY_TOL = 0.0001;
const NAME_SIMILARITY_THRESHOLD = 0.35;
const NAME_SIMILARITY_LIMIT = 5;

type RawUploadRow = {
  row_index: number;
  external_so_number: string;
  fo_number: string;
  customer_gst?: string;
  customer_name?: string;
  customer_address?: string;
  town?: string;
  site_address?: string;
  site_name?: string;
  site_town?: string;
  has_site: boolean;
  has_site_valid?: boolean;
  sku: string;
  pack_qty: number;
};

type PreviewRow = JsonRecord & {
  row_index?: number;
  status?: string;
  vdc_id?: string;
  customer_resolution?: JsonRecord;
};

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}
function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}
function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}
function canonicalExternalSoNumber(value: unknown): string {
  const normalized = toUpperTrimmedString(value);
  return /^\d+$/.test(normalized) ? normalized.replace(/^0+(?=\d)/, "") : normalized;
}
function externalSoLookupValues(value: unknown): string[] {
  const normalized = toTrimmedString(value);
  if (!/^\d+$/.test(normalized)) return normalized ? [normalized] : [];
  // Excel frequently converts 0011419951 to the number 11419951. The live
  // customer PO convention is ten digits, so look up that lossless padding
  // variant as well while keeping non-numeric keys exact.
  const paddedTenDigit = normalized.padStart(10, "0");
  return [...new Set([normalized, paddedTenDigit])];
}
function soMapBulkErrorResponse(req: Request, ctx: ProcurementHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function makeInternalJsonRequest(source: Request, body: JsonRecord): Request {
  return new Request(source.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function unwrapInternalHandlerResponse(response: Response): Promise<JsonRecord> {
  const payload = await response.json().catch(() => ({} as JsonRecord)) as JsonRecord;
  if (!response.ok || payload.ok !== true) {
    throw new Error(toTrimmedString(payload.code) || "SO_MAP_GST_CUSTOMER_CREATE_FAILED");
  }
  const envelope = payload.data as JsonRecord | undefined;
  const data = envelope?.data;
  if (!data || typeof data !== "object") {
    throw new Error("SO_MAP_GST_CUSTOMER_CREATE_FAILED");
  }
  return data as JsonRecord;
}

async function runWithConcurrency<T>(items: T[], maxConcurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, items.length) }, worker));
}

async function getCompanyScope(ctx: ProcurementHandlerContext, requestedCompanyId?: string): Promise<string> {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  const companyId = toTrimmedString(requestedCompanyId) || scopedCompanyId;
  if (companyId) await assertCompanyScope(ctx, companyId);
  return companyId;
}

// §6 point 9 — GST resolve is VDC-scoped: a customer with this GST mapped to
// a DIFFERENT VDC is a distinct, named error state ("GST matched but in
// Different VDC"), not treated as "not found".
async function resolveCustomerByGst(gstNumber: string, vdcId: string): Promise<{
  status: "FOUND" | "FOUND_DIFFERENT_VDC" | "NOT_FOUND";
  customer_id?: string;
  customer_address_id?: string;
  customer_name?: string;
  matched_vdc_id?: string;
}> {
  const { data: customerRowsRaw, error } = await serviceRoleClient
    .schema("erp_master").from("customer_master")
    .select("id, customer_name").eq("gst_number", gstNumber);
  const customerRows = (customerRowsRaw ?? []) as JsonRecord[];
  if (error || customerRows.length === 0) return { status: "NOT_FOUND" };
  const customerIds = customerRows.map((row) => String(row.id));
  const { data: addressRows, error: addressError } = await serviceRoleClient
    .schema("erp_master").from("customer_address")
    .select("id, customer_id, depot_code_id").in("customer_id", customerIds).eq("status", "ACTIVE")
    .not("depot_code_id", "is", null);
  if (addressError) return { status: "NOT_FOUND" };
  const matchInVdc = (addressRows as JsonRecord[]).find((row) => toTrimmedString(row.depot_code_id) === vdcId);
  if (matchInVdc) {
    const customer = (customerRows as JsonRecord[]).find((row) => toTrimmedString(row.id) === toTrimmedString(matchInVdc.customer_id));
    return {
      status: "FOUND", customer_id: toTrimmedString(matchInVdc.customer_id),
      customer_address_id: toTrimmedString(matchInVdc.id), customer_name: toTrimmedString(customer?.customer_name),
    };
  }
  const matchElsewhere = (addressRows as JsonRecord[])[0];
  if (matchElsewhere) return { status: "FOUND_DIFFERENT_VDC", matched_vdc_id: toTrimmedString(matchElsewhere.depot_code_id) };
  return { status: "NOT_FOUND" };
}

// §6 point 9 — name-match is VDC-scoped from the start (§6 point 6's real
// data-quality finding: true duplicates and coincidental name-collisions
// both exist, so an un-scoped name search is unsafe).
async function resolveCustomerByName(customerName: string, vdcId: string): Promise<{
  status: "MATCHED" | "AMBIGUOUS" | "NOT_FOUND";
  customer_id?: string;
  customer_name?: string;
  customer_address_id?: string;
  candidates?: JsonRecord[];
}> {
  const { data, error } = await serviceRoleClient.schema("erp_master").rpc("find_similar_customer_names_in_vdc", {
    p_name: customerName, p_depot_code_id: vdcId, p_threshold: NAME_SIMILARITY_THRESHOLD, p_limit: NAME_SIMILARITY_LIMIT,
  });
  if (error) return { status: "NOT_FOUND" };
  const rows = (data ?? []) as JsonRecord[];
  if (rows.length === 0) return { status: "NOT_FOUND" };
  const distinctCustomerIds = [...new Set(rows.map((row) => toTrimmedString(row.customer_id)))];
  if (distinctCustomerIds.length === 1) {
    const candidate = rows[0];
    return {
      status: "MATCHED", customer_id: distinctCustomerIds[0],
      customer_name: toTrimmedString(candidate.customer_name),
      customer_address_id: toTrimmedString(candidate.customer_address_id),
    };
  }
  return { status: "AMBIGUOUS", candidates: rows };
}

// Site Address resolve — count of this customer's ACTIVE addresses already
// mapped to the SO's own VDC (§6 point 9's Site Address resolution block).
async function resolveSiteAddresses(customerId: string, vdcId: string): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master").from("customer_address")
    .select("id, site_name, address_line, town, state")
    .eq("customer_id", customerId).eq("depot_code_id", vdcId).eq("status", "ACTIVE");
  if (error) return [];
  return (data ?? []) as JsonRecord[];
}

function normalizeSiteAddress(value: unknown): string {
  return toTrimmedString(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function buildSiteResolution(
  addresses: JsonRecord[],
  uploadedSiteName: unknown,
  uploadedSiteAddress: unknown,
  uploadedSiteTown: unknown,
): JsonRecord {
  const normalizedUploadedName = normalizeSiteAddress(uploadedSiteName);
  const normalizedUploadedAddress = normalizeSiteAddress(uploadedSiteAddress);
  const normalizedUploadedTown = normalizeSiteAddress(uploadedSiteTown);
  // Address alone is not a reliable site identity: large customers often
  // reuse a generic address label across towns/sites. Every supplied site
  // attribute is therefore part of the exact-match key.
  const exactMatches = addresses.filter((address) => (
    (!normalizedUploadedName || normalizeSiteAddress(address.site_name) === normalizedUploadedName)
    && (!normalizedUploadedAddress || normalizeSiteAddress(address.address_line) === normalizedUploadedAddress)
    && (!normalizedUploadedTown || normalizeSiteAddress(address.town) === normalizedUploadedTown)
  ));
  if (exactMatches.length === 1) {
    return { count: addresses.length, status: "MATCHED", candidates: exactMatches, all_candidates: addresses };
  }
  return {
    count: addresses.length,
    status: addresses.length === 0 ? "NONE" : addresses.length === 1 ? "SINGLE" : "CHOOSE",
    candidates: addresses,
  };
}

export async function previewSoMapBulkUploadHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    if (!companyId) return soMapBulkErrorResponse(req, ctx, "SO_MAP_BULK_COMPANY_REQUIRED", 400, "company_id is required.");
    const rows = Array.isArray(body.rows) ? (body.rows as RawUploadRow[]) : [];
    if (rows.length === 0) return soMapBulkErrorResponse(req, ctx, "SO_MAP_BULK_ROWS_REQUIRED", 400, "At least one row is required.");
    // The same (External SO, FO, SKU) repeated in one workbook is a pasted
    // duplicate. The FIRST occurrence stays a normal row; only later copies
    // are marked, so removing them leaves a usable row behind. If the copies
    // disagree on Pack Qty, the intended quantity is unknowable — then every
    // copy is a conflict the user must resolve in the Excel.
    const firstRowByUploadKey = new Map<string, RawUploadRow>();
    const conflictingUploadKeys = new Set<string>();
    const laterDuplicateRowIndexes = new Map<number, number>();
    for (const row of rows) {
      const key = [row.external_so_number, row.fo_number, row.sku].map(toUpperTrimmedString).join("::");
      const first = firstRowByUploadKey.get(key);
      if (!first) { firstRowByUploadKey.set(key, row); continue; }
      laterDuplicateRowIndexes.set(Number(row.row_index), Number(first.row_index));
      if (Math.abs(Number(first.pack_qty ?? 0) - Number(row.pack_qty ?? 0)) > QTY_TOL) conflictingUploadKeys.add(key);
    }
    const uploadKeyOf = (row: RawUploadRow) => [row.external_so_number, row.fo_number, row.sku].map(toUpperTrimmedString).join("::");

    // Bulk-resolve every distinct External SO Number in one round (§8B/§8E).
    // The Excel value is the customer's external SO/PO reference, not PACE's
    // internally generated so_number. Preserve the latter on the resolved row
    // for display and downstream allocation.
    const soNumbers = [...new Set(rows.flatMap((row) => externalSoLookupValues(row.external_so_number)))];
    const { data: soRows, error: soError } = soNumbers.length
      ? await serviceRoleClient.schema("erp_procurement").from("sales_order")
          .select("id, so_number, customer_po_number, company_id, dispatch_type, is_dd_dispatch, bill_to_vdc_id, bill_to_state, status")
          .in("customer_po_number", soNumbers)
      : { data: [] as JsonRecord[], error: null };
    if (soError) return soMapBulkErrorResponse(req, ctx, "SO_MAP_BULK_SO_LOOKUP_FAILED", 500, "Unable to resolve External SO Numbers.");
    const soByNumber = new Map<string, JsonRecord>();
    for (const soRow of (soRows ?? []) as JsonRecord[]) {
      soByNumber.set(toUpperTrimmedString(soRow.customer_po_number), soRow);
      soByNumber.set(canonicalExternalSoNumber(soRow.customer_po_number), soRow);
    }
    const resolveExternalSo = (value: unknown): JsonRecord | undefined => (
      soByNumber.get(toUpperTrimmedString(value)) ?? soByNumber.get(canonicalExternalSoNumber(value))
    );

    const soIds = [...new Set(((soRows ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.id)))];
    const [lineRowsResult, existingGroupsResult, existingAllocationsResult] = await Promise.all([
      soIds.length
        ? fetchInChunks<JsonRecord>(soIds, (chunk) =>
            serviceRoleClient.schema("erp_procurement").from("sales_order_line")
              .select("id, so_id, material_id, base_qty, quantity, per_pack_qty").in("so_id", chunk))
        : Promise.resolve([] as JsonRecord[]),
      soIds.length
        ? fetchInChunks<JsonRecord>(soIds, (chunk) =>
            serviceRoleClient.schema("erp_procurement").from("sales_order_map_group")
              .select("id, so_id, external_fo_number, revised_external_fo_number").in("so_id", chunk).eq("status", "ACTIVE").not("external_fo_number", "is", null))
        : Promise.resolve([] as JsonRecord[]),
      soIds.length
        ? fetchInChunks<JsonRecord>(soIds, (chunk) =>
            serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation")
              .select("so_id, so_line_id, map_group_id, allocated_qty").in("so_id", chunk).eq("status", "ACTIVE"))
        : Promise.resolve([] as JsonRecord[]),
    ]);
    const lineRows = lineRowsResult as JsonRecord[];
    // The upload may arrive with either the immutable original FO or a later
    // corrected FO. Both names intentionally resolve to the one map group so
    // a re-upload replaces the existing allocation instead of consuming the
    // SO balance a second time.
    const existingGroupByKey = new Map<string, JsonRecord>();
    for (const row of existingGroupsResult as JsonRecord[]) {
      const soId = toTrimmedString(row.so_id);
      for (const foNumber of [toTrimmedString(row.external_fo_number), toTrimmedString(row.revised_external_fo_number)]) {
        if (soId && foNumber) existingGroupByKey.set(`${soId}::${foNumber}`, row);
      }
    }
    const allocatedByLine = new Map<string, number>();
    // §6 point 12 — the duplicate-vs-changed-qty compare is per (group, SO
    // line): the same FO can carry several SKUs, each with its own
    // previously-allocated qty to compare the re-upload against.
    const allocatedQtyByGroupAndLine = new Map<string, number>();
    for (const alloc of existingAllocationsResult as JsonRecord[]) {
      const lineId = toTrimmedString(alloc.so_line_id);
      allocatedByLine.set(lineId, (allocatedByLine.get(lineId) ?? 0) + Number(alloc.allocated_qty ?? 0));
      const groupId = toTrimmedString(alloc.map_group_id);
      if (groupId) {
        const key = `${groupId}::${lineId}`;
        allocatedQtyByGroupAndLine.set(key, (allocatedQtyByGroupAndLine.get(key) ?? 0) + Number(alloc.allocated_qty ?? 0));
      }
    }

    const materialIds = [...new Set(lineRows.map((row) => toTrimmedString(row.material_id)).filter(Boolean))];
    const { data: materialRows, error: materialError } = materialIds.length
      ? await serviceRoleClient.schema("erp_master").from("material_master").select("id, pace_code, external_code, material_name").in("id", materialIds)
      : { data: [] as JsonRecord[], error: null };
    if (materialError) return soMapBulkErrorResponse(req, ctx, "SO_MAP_BULK_MATERIAL_LOOKUP_FAILED", 500, "Unable to load SO item details.");
    const materialById = new Map(((materialRows ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.id), row]));
    const linesBySoId = new Map<string, JsonRecord[]>();
    for (const line of lineRows) {
      const soId = toTrimmedString(line.so_id);
      if (!linesBySoId.has(soId)) linesBySoId.set(soId, []);
      linesBySoId.get(soId)!.push(line);
    }

    // A balance check has to consider the whole uploaded batch, not merely
    // each row in isolation. Existing allocations represented by a row being
    // re-uploaded are replaced by its new quantity; every other allocation
    // remains consumed.
    const batchRequestedByLine = new Map<string, number>();
    const batchReplacingByLine = new Map<string, number>();
    for (const row of rows) {
      // A pasted duplicate must not consume the SO balance a second time.
      if (laterDuplicateRowIndexes.has(Number(row.row_index)) || conflictingUploadKeys.has(uploadKeyOf(row))) continue;
      const so = resolveExternalSo(row.external_so_number);
      if (!so || toUpperTrimmedString(so.company_id) !== toUpperTrimmedString(companyId)
        || toUpperTrimmedString(so.dispatch_type) !== "DEPENDENT_DIRECT" || so.is_dd_dispatch !== true) continue;
      const soId = toTrimmedString(so.id);
      const skuTarget = toUpperTrimmedString(row.sku);
      const matchedLine = (linesBySoId.get(soId) ?? []).find((line) => {
        const material = materialById.get(toTrimmedString(line.material_id));
        return material && [material.pace_code, material.external_code, material.material_name]
          .some((field) => toUpperTrimmedString(field) === skuTarget);
      });
      if (!matchedLine) continue;
      const lineId = toTrimmedString(matchedLine.id);
      const perPackQty = Number(matchedLine.per_pack_qty ?? 0);
      const requestedBaseQty = Number(row.pack_qty ?? 0) * (perPackQty > 0 ? perPackQty : 1);
      batchRequestedByLine.set(lineId, (batchRequestedByLine.get(lineId) ?? 0) + requestedBaseQty);
      const group = existingGroupByKey.get(`${soId}::${toTrimmedString(row.fo_number)}`);
      const previous = group
        ? allocatedQtyByGroupAndLine.get(`${toTrimmedString(group.id)}::${lineId}`) ?? 0
        : 0;
      batchReplacingByLine.set(lineId, (batchReplacingByLine.get(lineId) ?? 0) + previous);
    }

    const results: JsonRecord[] = [];
    // Preview is one HTTP request per upload. Reuse repeated VDC-scoped
    // resolver inputs so rows sharing a customer/site do not issue the same
    // database/API lookup again and again.
    const gstResolutionCache = new Map<string, Promise<JsonRecord>>();
    const nameResolutionCache = new Map<string, Promise<JsonRecord>>();
    const siteAddressCache = new Map<string, Promise<JsonRecord[]>>();
    const resolveCached = <T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> => {
      const existing = cache.get(key);
      if (existing) return existing;
      const pending = load();
      cache.set(key, pending);
      return pending;
    };
    for (const row of rows) {
      // Keep malformed spreadsheet rows visible in the review grid, rather
      // than silently treating them as "not found" business data.
      if (!toTrimmedString(row.external_so_number) || !toTrimmedString(row.fo_number)
        || !toTrimmedString(row.customer_name) || !toTrimmedString(row.customer_address)
        || !toTrimmedString(row.sku) || !Number.isFinite(Number(row.pack_qty)) || Number(row.pack_qty) <= 0
        || typeof row.has_site !== "boolean" || row.has_site_valid === false) {
        results.push({ row_index: row.row_index, status: "ERROR", error_code: "INVALID_UPLOAD_ROW" });
        continue;
      }
      if (!toTrimmedString(row.town)) {
        results.push({ row_index: row.row_index, status: "ERROR", error_code: "CUSTOMER_TOWN_REQUIRED" });
        continue;
      }
      if (row.has_site && (!toTrimmedString(row.site_name) || !toTrimmedString(row.site_address) || !toTrimmedString(row.site_town))) {
        results.push({ row_index: row.row_index, status: "ERROR", error_code: "SITE_DETAILS_REQUIRED" });
        continue;
      }
      if (conflictingUploadKeys.has(uploadKeyOf(row))) {
        results.push({ row_index: row.row_index, status: "ERROR", error_code: "DUPLICATE_UPLOAD_ROW_QTY_CONFLICT" });
        continue;
      }
      const duplicateOf = laterDuplicateRowIndexes.get(Number(row.row_index));
      if (duplicateOf != null) {
        results.push({ row_index: row.row_index, status: "ERROR", error_code: "DUPLICATE_UPLOAD_ROW", duplicate_of_row_index: duplicateOf });
        continue;
      }
      const soNumber = toTrimmedString(row.external_so_number);
      const so = resolveExternalSo(soNumber);
      if (!so) {
        results.push({ row_index: row.row_index, status: "ERROR", error_code: "SO_NOT_FOUND" });
        continue;
      }
      if (toUpperTrimmedString(so.company_id) !== toUpperTrimmedString(companyId)) {
        results.push({ row_index: row.row_index, status: "ERROR", error_code: "SO_COMPANY_MISMATCH" });
        continue;
      }
      if (toUpperTrimmedString(so.dispatch_type) !== "DEPENDENT_DIRECT" || so.is_dd_dispatch !== true) {
        results.push({ row_index: row.row_index, status: "ERROR", error_code: "SO_NOT_VDC_DD" });
        continue;
      }
      const vdcId = toTrimmedString(so.bill_to_vdc_id);
      if (!vdcId) {
        results.push({ row_index: row.row_index, status: "ERROR", error_code: "SO_NO_VDC" });
        continue;
      }

      const soId = toTrimmedString(so.id);
      const foNumber = toTrimmedString(row.fo_number);
      const existingGroup = foNumber ? existingGroupByKey.get(`${soId}::${foNumber}`) : undefined;

      // SKU resolve — exact match against this SO's own lines only (§6
      // point 12: out-of-SO SKU must highlight + auto-suggest, never a
      // company-wide catalog search).
      const skuTarget = toUpperTrimmedString(row.sku);
      const soLines = linesBySoId.get(soId) ?? [];
      const matchedLine = soLines.find((line) => {
        const material = materialById.get(toTrimmedString(line.material_id));
        if (!material) return false;
        return [material.pace_code, material.external_code, material.material_name]
          .some((field) => toUpperTrimmedString(field) === skuTarget);
      });
      const skuCandidates = soLines.map((line) => {
        const material = materialById.get(toTrimmedString(line.material_id));
        const lineId = toTrimmedString(line.id);
        const groupQty = existingGroup
          ? allocatedQtyByGroupAndLine.get(`${toTrimmedString(existingGroup.id)}::${lineId}`) ?? 0
          : 0;
        return {
          so_line_id: line.id, material_id: line.material_id,
          document_name: toTrimmedString(material?.material_name),
          display: material ? `${toTrimmedString(material.pace_code)} — ${toTrimmedString(material.material_name)}` : toTrimmedString(line.material_id),
          line_total_qty: Number(line.base_qty ?? line.quantity ?? 0),
          per_pack_qty: Number(line.per_pack_qty ?? 0) || null,
          existing_allocated_qty: allocatedByLine.get(lineId) ?? 0,
          existing_group_qty: groupQty,
        };
      });

      // §6 point 12 duplicate/changed-qty compare — only meaningful when
      // this exact (FO group, SO line/SKU) combination was already
      // allocated before; a new SKU added to an already-existing FO group
      // is not a duplicate at all, just another line under that same FO.
      let duplicateStatus: "NONE" | "UNCHANGED" | "CHANGED_QTY" = "NONE";
      let previousQty: number | null = null;
      let qtyStatus: "OK" | "EXCEEDS_BALANCE" = "OK";
      const matchedLinePerPackQty = Number(matchedLine?.per_pack_qty ?? 0);
      if (matchedLine) {
        const lineTotal = Number(matchedLine.base_qty ?? matchedLine.quantity ?? 0);
        const lineId = toTrimmedString(matchedLine.id);
        const perPackQty = Number(matchedLine.per_pack_qty ?? 0);
        const requestedBaseQty = Number(row.pack_qty ?? 0) * (perPackQty > 0 ? perPackQty : 1);
        const totalAlreadyAllocated = allocatedByLine.get(lineId) ?? 0;
        const existingSameGroupQty = existingGroup
          ? allocatedQtyByGroupAndLine.get(`${toTrimmedString(existingGroup.id)}::${lineId}`) ?? 0
          : 0;
        if (existingSameGroupQty > 0) {
          previousQty = existingSameGroupQty;
          duplicateStatus = Math.abs(existingSameGroupQty - requestedBaseQty) <= QTY_TOL ? "UNCHANGED" : "CHANGED_QTY";
        }
        // Balance check excludes this row's own prior allocation (if any) so
        // a same-qty or corrected re-upload of the SAME group+line is never
        // compared against itself.
        const retainedAllocation = totalAlreadyAllocated - (batchReplacingByLine.get(lineId) ?? 0);
        if (retainedAllocation + (batchRequestedByLine.get(lineId) ?? 0) > lineTotal + QTY_TOL) qtyStatus = "EXCEEDS_BALANCE";
      }

      // Customer resolve.
      const gst = toUpperTrimmedString(row.customer_gst);
      let customerResolution: JsonRecord;
      if (gst) {
        const gstResult = await resolveCached(gstResolutionCache, `${vdcId}::${gst}`, () => resolveCustomerByGst(gst, vdcId));
        customerResolution = { mode: "GST", ...gstResult };
      } else {
        const customerName = toTrimmedString(row.customer_name);
        const nameResult = await resolveCached(nameResolutionCache, `${vdcId}::${toUpperTrimmedString(customerName)}`, () => resolveCustomerByName(customerName, vdcId));
        customerResolution = { mode: "NAME", ...nameResult };
      }

      // Site Address resolve — only when Has Site = Yes and a customer is
      // already uniquely resolved (§6 point 9's Site Address block).
      let siteResolution: JsonRecord | null = null;
      if (row.has_site) {
        const resolvedCustomerId = toTrimmedString((customerResolution as JsonRecord).customer_id);
        if (resolvedCustomerId) {
          const addresses = await resolveCached(siteAddressCache, `${vdcId}::${resolvedCustomerId}`, () => resolveSiteAddresses(resolvedCustomerId, vdcId));
          siteResolution = buildSiteResolution(addresses, row.site_name, row.site_address, row.site_town);
        } else {
          siteResolution = { count: 0, status: "PENDING_CUSTOMER", candidates: [] };
        }
      }

      results.push({
        row_index: row.row_index,
        status: "RESOLVED",
        so_id: soId,
        // External SO is the lookup key; the grid must display PACE's own SO
        // number so a reviewer sees the actual mapping target.
        so_number: toTrimmedString(so.so_number),
        vdc_id: vdcId,
        vdc_state: toTrimmedString(so.bill_to_state),
        has_site: row.has_site === true,
        dd_flagged: true,
        existing_group_id: existingGroup ? toTrimmedString(existingGroup.id) : null,
        duplicate_status: duplicateStatus,
        previous_qty: previousQty,
        previous_pack_qty: previousQty == null ? null : previousQty / (matchedLinePerPackQty > 0 ? matchedLinePerPackQty : 1),
        sku_resolution: matchedLine
          ? {
              status: "MATCHED", so_line_id: matchedLine.id, material_id: matchedLine.material_id,
              document_name: toTrimmedString(materialById.get(toTrimmedString(matchedLine.material_id))?.material_name),
              line_total_qty: Number(matchedLine.base_qty ?? matchedLine.quantity ?? 0),
              per_pack_qty: Number(matchedLine.per_pack_qty ?? 0) || null,
              existing_allocated_qty: allocatedByLine.get(toTrimmedString(matchedLine.id)) ?? 0,
              existing_group_qty: previousQty ?? 0,
            }
          : { status: "NOT_FOUND", candidates: skuCandidates },
        qty_status: qtyStatus,
        customer_resolution: customerResolution,
        site_resolution: siteResolution,
      });
    }

    return okResponse({ data: results }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_MAP_BULK_PREVIEW_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") ? 400 : 500;
    return soMapBulkErrorResponse(req, ctx, code, status, code);
  }
}

// A large upload may contain hundreds of customers. The old frontend loop
// made an HTTP call to MM04 for each row, which triggered the ERP action
// blocker over and over again. Resolve candidates server-side first, then use
// the existing MM04 handlers inside this one request. This preserves the
// customer/company/address validation and audit fields exactly as manual MM04
// creation does, while making the browser perform one bulk action.
export async function createMissingGstCustomersForSoMapHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    if (!companyId) return soMapBulkErrorResponse(req, ctx, "SO_MAP_BULK_COMPANY_REQUIRED", 400, "company_id is required.");
    const rows = Array.isArray(body.rows) ? (body.rows as RawUploadRow[]) : [];
    if (rows.length === 0) return soMapBulkErrorResponse(req, ctx, "SO_MAP_BULK_ROWS_REQUIRED", 400, "At least one row is required.");

    // Never trust VDC/customer resolution supplied by the browser. Reuse the
    // authoritative preview resolver to establish which exact rows are both
    // valid and GST-NOT_FOUND before writing anything.
    const previewResponse = await previewSoMapBulkUploadHandler(
      makeInternalJsonRequest(req, { company_id: companyId, rows }),
      ctx,
    );
    const previewPayload = await previewResponse.json().catch(() => ({} as JsonRecord)) as JsonRecord;
    if (!previewResponse.ok || previewPayload.ok !== true) {
      const code = toTrimmedString(previewPayload.code) || "SO_MAP_BULK_PREVIEW_FAILED";
      return soMapBulkErrorResponse(req, ctx, code, previewResponse.status || 500, code);
    }
    const previewEnvelope = previewPayload.data as JsonRecord | undefined;
    const previewRows = Array.isArray(previewEnvelope?.data) ? previewEnvelope!.data as PreviewRow[] : [];
    const rawByIndex = new Map(rows.map((row) => [Number(row.row_index), row]));

    type CandidateGroup = {
      vdcId: string;
      gstNumber: string;
      seed: RawUploadRow;
      rowIndexes: number[];
      siteRows: RawUploadRow[];
    };
    const groupsByKey = new Map<string, CandidateGroup>();
    for (const previewRow of previewRows) {
      const rowIndex = Number(previewRow.row_index);
      const raw = rawByIndex.get(rowIndex);
      const customerResolution = previewRow.customer_resolution as JsonRecord | undefined;
      const gstNumber = toUpperTrimmedString(raw?.customer_gst);
      const vdcId = toTrimmedString(previewRow.vdc_id);
      if (!raw || previewRow.status !== "RESOLVED" || !gstNumber || !vdcId || customerResolution?.status !== "NOT_FOUND") continue;

      const key = `${vdcId}::${gstNumber}`;
      let group = groupsByKey.get(key);
      if (!group) {
        group = { vdcId, gstNumber, seed: raw, rowIndexes: [], siteRows: [] };
        groupsByKey.set(key, group);
      }
      group.rowIndexes.push(rowIndex);
      if (raw.has_site) group.siteRows.push(raw);
    }

    const failed: JsonRecord[] = [];
    let createdGroups = 0;
    // The GST provider is an external dependency. Six workers gives large
    // workbooks practical throughput without an unbounded burst against it.
    await runWithConcurrency([...groupsByKey.values()], 6, async (group) => {
      try {
        const resolved = await resolveGstProfileWithSource(group.gstNumber);
        const profile = deriveCompanyFieldsFromGstProfile(resolved.profile);
        if (!profile.full_address || !profile.state_name) throw new Error("SO_MAP_GST_PROFILE_REQUIRED");

        const createdCustomer = await unwrapInternalHandlerResponse(await createCustomerHandler(
          makeInternalJsonRequest(req, {
            company_id: companyId,
            customer_name: group.seed.customer_name,
            customer_type: "DOMESTIC",
            currency_code: "INR",
            // GST legal names are often proprietor names. The consignee name
            // from the Excel row is the customer identity; GST supplies only
            // address/state/pin details.
            delivery_address: profile.full_address,
            billing_state: profile.state_name,
            town: group.seed.town,
            site_name: group.seed.customer_name,
            gst_number: group.gstNumber,
            gst_category: "REGISTERED",
            pin_code: profile.pin_code || undefined,
            depot_code_id: group.vdcId,
          }),
          ctx,
        ));
        const customerId = toTrimmedString(createdCustomer.id);
        if (!customerId) throw new Error("SO_MAP_GST_CUSTOMER_CREATE_FAILED");

        // One GST/VDC group can carry several physical sites. Create each
        // distinct uploaded site once, and rely on the refreshed preview for
        // normal exact-match resolution/counts afterwards.
        const uniqueSites = new Map<string, RawUploadRow>();
        for (const siteRow of group.siteRows) {
          const siteKey = [siteRow.site_name, siteRow.site_address, siteRow.site_town]
            .map(normalizeSiteAddress).join("::");
          if (!uniqueSites.has(siteKey)) uniqueSites.set(siteKey, siteRow);
        }
        for (const siteRow of uniqueSites.values()) {
          await unwrapInternalHandlerResponse(await createCustomerAddressHandler(
            makeInternalJsonRequest(req, {
              customer_id: customerId,
              site_name: siteRow.site_name,
              address_line: siteRow.site_address,
              town: siteRow.site_town,
              depot_code_id: group.vdcId,
            }),
            ctx,
          ));
        }
        createdGroups += 1;
      } catch (error) {
        failed.push({
          gst_number: group.gstNumber,
          vdc_id: group.vdcId,
          row_indexes: group.rowIndexes,
          error_code: error instanceof Error ? error.message : "SO_MAP_GST_CUSTOMER_CREATE_FAILED",
        });
      }
    });

    return okResponse({
      data: {
        created_groups: createdGroups,
        skipped_groups: 0,
        failed,
      },
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_MAP_GST_CUSTOMER_CREATE_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") ? 400 : 500;
    return soMapBulkErrorResponse(req, ctx, code, status, code);
  }
}

// Saving 500 mapped FO groups from the browser used to issue 500 sequential
// /save-group requests, making the action blocker appear stuck for minutes.
// Keep the established group-level validation + atomic RPC as the sole write
// path, but execute it inside one authenticated server operation. Bounded
// concurrency is deliberately used rather than an unbounded Promise.all so a
// large workbook cannot exhaust PostgREST/database connections.
export async function saveSoMapBulkGroupsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const groups = Array.isArray(body.groups) ? body.groups.filter((group): group is JsonRecord => Boolean(group) && typeof group === "object") : [];
    if (groups.length === 0) return soMapBulkErrorResponse(req, ctx, "SO_MAP_BULK_GROUPS_REQUIRED", 400, "At least one mapping group is required.");
    if (groups.length > 1000) return soMapBulkErrorResponse(req, ctx, "SO_MAP_BULK_GROUP_LIMIT", 400, "A single bulk save can contain at most 1000 mapping groups.");

    const saved: JsonRecord[] = [];
    const failed: JsonRecord[] = [];
    await runWithConcurrency(groups.map((group, index) => ({ group, index })), 12, async ({ group, index }) => {
      const response = await saveSoMapGroupHandler(makeInternalJsonRequest(req, group), ctx);
      const payload = await response.json().catch(() => ({} as JsonRecord)) as JsonRecord;
      if (!response.ok || payload.ok !== true) {
        failed.push({
          group_index: index,
          external_fo_number: toTrimmedString(group.external_fo_number) || null,
          row_indexes: Array.isArray(group.row_indexes) ? group.row_indexes : [],
          error_code: toTrimmedString(payload.code) || "SO_MAP_GROUP_SAVE_FAILED",
        });
        return;
      }
      saved.push({
        group_index: index,
        external_fo_number: toTrimmedString(group.external_fo_number) || null,
        row_indexes: Array.isArray(group.row_indexes) ? group.row_indexes : [],
      });
    });

    return okResponse({
      data: {
        saved_groups: saved.length,
        saved_rows: saved.reduce((total, group) => total + (Array.isArray(group.row_indexes) ? group.row_indexes.length : 0), 0),
        failed,
      },
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_MAP_BULK_SAVE_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") || code.includes("LIMIT") ? 400 : 500;
    return soMapBulkErrorResponse(req, ctx, code, status, code);
  }
}
