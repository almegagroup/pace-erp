/*
 * File-Path: supabase/functions/api/_core/procurement/so_map_bulk.handlers.ts
 * Domain: PROCUREMENT / Sales
 * Purpose: "Bulk DD SO Map" (SO01 Tab 2 additive button) — resolves a bulk
 *          Excel upload (External SO Number, FO Number, Customer GST/Name/
 *          Address, Has Site, SKU, Pack Qty) into Customer+Site Address
 *          allocations, per FG-STO-MTS-DISPATCH-DESIGN-DOC.md §6 points 8-12.
 *          VDC (Dependent Direct) only — DC never uses this (§6 point 10).
 *          This is a bulk-resolve/preview layer: it never writes a new
 *          customer/address itself (the existing createCustomerHandler/
 *          createCustomerAddressHandler already do that, called directly by
 *          the frontend's Create-New drawer) and never writes an allocation
 *          itself (the existing saveSoMapGroupHandler, extended additively
 *          with external_fo_number, does that). so_map.handlers.ts and
 *          every other existing handler in this codebase are untouched.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";

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
  has_site: boolean;
  has_site_valid?: boolean;
  sku: string;
  pack_qty: number;
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
function soMapBulkErrorResponse(req: Request, ctx: ProcurementHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
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

export async function previewSoMapBulkUploadHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    if (!companyId) return soMapBulkErrorResponse(req, ctx, "SO_MAP_BULK_COMPANY_REQUIRED", 400, "company_id is required.");
    const rows = Array.isArray(body.rows) ? (body.rows as RawUploadRow[]) : [];
    if (rows.length === 0) return soMapBulkErrorResponse(req, ctx, "SO_MAP_BULK_ROWS_REQUIRED", 400, "At least one row is required.");
    const uploadKeyCounts = new Map<string, number>();
    for (const row of rows) {
      const key = [row.external_so_number, row.fo_number, row.sku].map(toUpperTrimmedString).join("::");
      uploadKeyCounts.set(key, (uploadKeyCounts.get(key) ?? 0) + 1);
    }

    // Bulk-resolve every distinct External SO Number in one round (§8B/§8E).
    // The Excel value is the customer's external SO/PO reference, not PACE's
    // internally generated so_number. Preserve the latter on the resolved row
    // for display and downstream allocation.
    const soNumbers = [...new Set(rows.map((row) => toTrimmedString(row.external_so_number)).filter(Boolean))];
    const { data: soRows, error: soError } = soNumbers.length
      ? await serviceRoleClient.schema("erp_procurement").from("sales_order")
          .select("id, so_number, customer_po_number, company_id, dispatch_type, is_dd_dispatch, bill_to_vdc_id, bill_to_state, status")
          .in("customer_po_number", soNumbers)
      : { data: [] as JsonRecord[], error: null };
    if (soError) return soMapBulkErrorResponse(req, ctx, "SO_MAP_BULK_SO_LOOKUP_FAILED", 500, "Unable to resolve External SO Numbers.");
    const soByNumber = new Map(((soRows ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.customer_po_number), row]));

    const soIds = [...new Set(((soRows ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.id)))];
    const [lineRowsResult, existingGroupsResult, existingAllocationsResult] = await Promise.all([
      soIds.length
        ? fetchInChunks<JsonRecord>(soIds, (chunk) =>
            serviceRoleClient.schema("erp_procurement").from("sales_order_line")
              .select("id, so_id, material_id, base_qty, quantity").in("so_id", chunk))
        : Promise.resolve([] as JsonRecord[]),
      soIds.length
        ? fetchInChunks<JsonRecord>(soIds, (chunk) =>
            serviceRoleClient.schema("erp_procurement").from("sales_order_map_group")
              .select("id, so_id, external_fo_number").in("so_id", chunk).eq("status", "ACTIVE").not("external_fo_number", "is", null))
        : Promise.resolve([] as JsonRecord[]),
      soIds.length
        ? fetchInChunks<JsonRecord>(soIds, (chunk) =>
            serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation")
              .select("so_id, so_line_id, map_group_id, allocated_qty").in("so_id", chunk).eq("status", "ACTIVE"))
        : Promise.resolve([] as JsonRecord[]),
    ]);
    const lineRows = lineRowsResult as JsonRecord[];
    const existingGroupByKey = new Map<string, JsonRecord>(
      (existingGroupsResult as JsonRecord[]).map((row) => [`${toTrimmedString(row.so_id)}::${toTrimmedString(row.external_fo_number)}`, row]),
    );
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
      const so = soByNumber.get(toTrimmedString(row.external_so_number)) as JsonRecord | undefined;
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
      batchRequestedByLine.set(lineId, (batchRequestedByLine.get(lineId) ?? 0) + Number(row.pack_qty ?? 0));
      const group = existingGroupByKey.get(`${soId}::${toTrimmedString(row.fo_number)}`);
      const previous = group
        ? allocatedQtyByGroupAndLine.get(`${toTrimmedString(group.id)}::${lineId}`) ?? 0
        : 0;
      batchReplacingByLine.set(lineId, (batchReplacingByLine.get(lineId) ?? 0) + previous);
    }

    const results: JsonRecord[] = [];
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
      const uploadKey = [row.external_so_number, row.fo_number, row.sku].map(toUpperTrimmedString).join("::");
      if ((uploadKeyCounts.get(uploadKey) ?? 0) > 1) {
        results.push({ row_index: row.row_index, status: "ERROR", error_code: "DUPLICATE_UPLOAD_ROW" });
        continue;
      }
      const soNumber = toTrimmedString(row.external_so_number);
      const so = soByNumber.get(soNumber) as JsonRecord | undefined;
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
      if (matchedLine) {
        const lineTotal = Number(matchedLine.base_qty ?? matchedLine.quantity ?? 0);
        const lineId = toTrimmedString(matchedLine.id);
        const totalAlreadyAllocated = allocatedByLine.get(lineId) ?? 0;
        const existingSameGroupQty = existingGroup
          ? allocatedQtyByGroupAndLine.get(`${toTrimmedString(existingGroup.id)}::${lineId}`) ?? 0
          : 0;
        if (existingSameGroupQty > 0) {
          previousQty = existingSameGroupQty;
          duplicateStatus = Math.abs(existingSameGroupQty - Number(row.pack_qty ?? 0)) <= QTY_TOL ? "UNCHANGED" : "CHANGED_QTY";
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
        const gstResult = await resolveCustomerByGst(gst, vdcId);
        customerResolution = { mode: "GST", ...gstResult };
      } else {
        const nameResult = await resolveCustomerByName(toTrimmedString(row.customer_name), vdcId);
        customerResolution = { mode: "NAME", ...nameResult };
      }

      // Site Address resolve — only when Has Site = Yes and a customer is
      // already uniquely resolved (§6 point 9's Site Address block).
      let siteResolution: JsonRecord | null = null;
      if (row.has_site) {
        const resolvedCustomerId = toTrimmedString((customerResolution as JsonRecord).customer_id);
        if (resolvedCustomerId) {
          const addresses = await resolveSiteAddresses(resolvedCustomerId, vdcId);
          siteResolution = {
            count: addresses.length,
            status: addresses.length === 0 ? "NONE" : addresses.length === 1 ? "SINGLE" : "CHOOSE",
            candidates: addresses,
          };
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
        sku_resolution: matchedLine
          ? {
              status: "MATCHED", so_line_id: matchedLine.id, material_id: matchedLine.material_id,
              document_name: toTrimmedString(materialById.get(toTrimmedString(matchedLine.material_id))?.material_name),
              line_total_qty: Number(matchedLine.base_qty ?? matchedLine.quantity ?? 0),
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
