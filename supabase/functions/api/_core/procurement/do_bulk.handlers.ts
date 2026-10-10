/*
 * File-Path: supabase/functions/api/_core/procurement/do_bulk.handlers.ts
 * Domain: PROCUREMENT / Sales
 * Purpose: "Bulk DO Upload" (SO03 additive button) — resolves a bulk Excel
 *          upload (FO/SO Number, DO Date, Transporter, LR Number, LR Date,
 *          SKU, Pack Qty, Storage Location, Tally Invoice Number/Date,
 *          Inbound Number, Truck Number, Dispatch Date) into Delivery Order
 *          line sets, per FG-STO-MTS-DISPATCH-DESIGN-DOC.md §6 points 14-15.
 *          One template row-group = one FO (VDC/Dependent Direct) or one SO
 *          (DC/Dependent Depot) = one Delivery Order.
 *
 *          Strictly additive, per the business owner's explicit guardrail
 *          (§6 point 20, 2026-10-09): `do_unified.handlers.ts`'s
 *          `createDeliveryOrderUnifiedHandler` is NEVER modified — this file
 *          drives it exactly as the gate_entry.handlers.ts "replace lines"
 *          pattern already does (construct a synthetic in-process Request,
 *          call the existing exported handler, read its JSON envelope).
 *          For a VDC row, if the FO's own Fixed-Depot/address allocation
 *          doesn't exist yet it is created via the EXISTING, unmodified
 *          `saveSoMapGroupHandler` the exact same way — never a new
 *          allocation-write code path. The only genuinely new writes this
 *          file performs are: (a) a follow-up UPDATE on the just-created
 *          `delivery_challan` row to stamp the new, additive-only columns
 *          `dc_date`/`is_bulk_uploaded`/`pgi_deferred`/`dispatch_date`/
 *          `pre_invoice_tally_invoice_number`/`_date`/`_inbound_number`
 *          (createDeliveryOrderUnifiedHandler's own RPC payload has no slot
 *          for any of these — `dc_date` is hardcoded to today, the rest
 *          don't exist on its header at all), and (b) the DC-only
 *          auto-depot-mapping bootstrap described above.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { readAclSnapshotDecisionAny } from "../../_shared/acl_snapshot.ts";
import { todayIsoInKolkata } from "../../_shared/dateUtils.ts";
import { isManualDocumentDateWithinWindow, MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE } from "../../_shared/manualDocumentDateWindow.ts";
import { createDeferredVdcBulkDeliveryOrder, createDeliveryOrderUnifiedHandler } from "./do_unified.handlers.ts";
import { saveSoMapGroupHandler } from "./so_map.handlers.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const QTY_TOL = 0.0001;

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}
function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}
function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}
function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}
// Browser upload normally normalizes dates, but validation must remain safe
// for raw DD/MM/YYYY uploads and restored drafts too. Excel serial values are
// accepted only in a plausible date range, never for document identifiers.
function normalizeInputDate(value: unknown): string {
  const text = toTrimmedString(value);
  if (!text || isIsoDate(text)) return text;
  // Some source workbooks lose the second display separator (`03/102026`
  // for `03/10/2026`). Treat only this constrained day/month/year shape as
  // a date, then validate its calendar value before accepting it.
  const displayMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
    || text.match(/^(\d{1,2})[/-](\d{1,2})(\d{4})$/);
  if (displayMatch) {
    const [, day, month, year] = displayMatch;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (parsed.getUTCFullYear() === Number(year) && parsed.getUTCMonth() === Number(month) - 1 && parsed.getUTCDate() === Number(day)) {
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
    return text;
  }
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 0 && serial < 100000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
  }
  return text;
}
function doBulkErrorResponse(req: Request, ctx: ProcurementHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

async function getCompanyScope(ctx: ProcurementHandlerContext, requestedCompanyId?: string): Promise<string> {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  const companyId = toTrimmedString(requestedCompanyId) || scopedCompanyId;
  if (companyId) await assertCompanyScope(ctx, companyId);
  return companyId;
}

// do_unified.handlers.ts's own canMaintainDoCreate() is not exported (file
// header note there: "small enough to duplicate rather than widen that
// file's export surface for one Set") — same call here, same reasoning.
async function canMaintainDoBulkAccess(
  ctx: ProcurementHandlerContext,
  companyId: string,
  actionCode: "VIEW" | "WRITE" | "EDIT",
): Promise<boolean> {
  if (ctx.context.isAdmin) return true;
  if (!companyId) return false;
  let workContextIds: string[];
  if (companyId === ctx.context.companyId) {
    workContextIds = ctx.context.workContextIds && ctx.context.workContextIds.length > 0
      ? ctx.context.workContextIds
      : ctx.context.workContextId ? [ctx.context.workContextId] : [];
  } else {
    const { data: workContextRows, error: workContextError } = await serviceRoleClient
      .schema("erp_acl").from("user_work_contexts")
      .select("work_context:work_context_id!inner(work_context_id, is_active)")
      .eq("auth_user_id", ctx.auth_user_id).eq("company_id", companyId);
    if (workContextError) return false;
    workContextIds = ((workContextRows ?? []) as Array<{ work_context: unknown }>)
      .map((row) => {
        const wc = Array.isArray(row.work_context) ? row.work_context[0] : row.work_context;
        return wc as { work_context_id?: string; is_active?: boolean } | null;
      })
      .filter((wc) => wc?.is_active)
      .map((wc) => toTrimmedString(wc?.work_context_id))
      .filter(Boolean);
  }
  if (workContextIds.length === 0) return false;
  const { data: versionRow, error: versionError } = await serviceRoleClient
    .schema("acl").from("acl_versions").select("acl_version_id")
    .eq("company_id", companyId).eq("is_active", true).single();
  if (versionError || !versionRow?.acl_version_id) return false;
  const { data, error } = await readAclSnapshotDecisionAny({
    db: serviceRoleClient,
    aclVersionId: versionRow.acl_version_id as string,
    authUserId: ctx.auth_user_id,
    companyId,
    workContextIds,
    resourceCode: "PROC_DO_CREATE",
    actionCode,
  });
  if (error || !data) return false;
  return data.decision === "ALLOW";
}

type RawUploadRow = {
  row_index: number;
  fo_or_so_number: string;
  do_date?: string;
  transporter_name?: string;
  lr_number?: string;
  lr_date?: string;
  sku: string;
  pack_qty: number;
  storage_location_code?: string;
  tally_invoice_number?: string;
  tally_invoice_date?: string;
  inbound_number?: string;
  truck_number?: string;
  dispatch_date?: string;
};

// Transporter resolve — simple ILIKE similarity against transporter_master
// (global, not company-scoped — l2_masters.handlers.ts's listTransportersHandler
// already treats it this way). Exact case-insensitive match wins outright;
// otherwise every substring match becomes a Choose-from-N candidate, same
// shape as so_map_bulk.handlers.ts's Customer resolution.
async function resolveTransporterByName(name: string): Promise<{
  status: "MATCHED" | "AMBIGUOUS" | "NOT_FOUND";
  transporter_id?: string;
  candidates?: JsonRecord[];
}> {
  const target = toTrimmedString(name);
  if (!target) return { status: "NOT_FOUND" };
  const { data, error } = await serviceRoleClient
    .schema("erp_master").from("transporter_master")
    .select("id, transporter_code, transporter_name")
    .ilike("transporter_name", `%${target}%`).eq("active", true).limit(10);
  if (error) return { status: "NOT_FOUND" };
  const rows = (data ?? []) as JsonRecord[];
  if (rows.length === 0) return { status: "NOT_FOUND" };
  const exact = rows.find((row) => toUpperTrimmedString(row.transporter_name) === toUpperTrimmedString(target));
  if (exact) return { status: "MATCHED", transporter_id: toTrimmedString(exact.id) };
  if (rows.length === 1) return { status: "MATCHED", transporter_id: toTrimmedString(rows[0].id) };
  return { status: "AMBIGUOUS", candidates: rows };
}

async function resolveStorageLocationByCode(code: string): Promise<JsonRecord | null> {
  const target = toTrimmedString(code);
  if (!target) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory").from("storage_location_master")
    // Storage locations are global master data in this schema (they do not
    // carry a company_id).  Bulk DD dispatch is deliberately limited to the
    // Finished-Goods (F*) locations from the design, not any arbitrary
    // warehouse/shop-floor/RM location.
    .select("id, code, name").ilike("code", target).ilike("code", "F%").eq("active", true).maybeSingle();
  if (error) return null;
  return (data as JsonRecord | null) ?? null;
}

async function listFinishedGoodsStorageLocations(): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory").from("storage_location_master")
    .select("id, code, name").ilike("code", "F%").eq("active", true).order("code");
  return error ? [] : (data ?? []) as JsonRecord[];
}

// §6 point 14 — one template column takes either an FO Number (VDC/Dependent
// Direct, resolved through the original or revised Sales/Dispatch FO Number — §6
// point 1/T1) or a plain SO Number (DC/Dependent Depot, resolved directly
// against sales_order.so_number). A value that resolves to the WRONG type
// is a type-mismatch error, not a silent fallback.
async function resolveFoOrSo(value: string, companyId: string): Promise<{
  status: "VDC" | "DC" | "VDC_WRONG_FIELD" | "DC_WRONG_FIELD" | "NOT_FOUND";
  so_id?: string;
  so_number?: string;
  map_group_id?: string;
}> {
  const [originalResult, revisedResult] = await Promise.all([
    serviceRoleClient.schema("erp_procurement").from("sales_order_map_group")
      .select("id, so_id, status, so:so_id(company_id, so_number)")
      .eq("external_fo_number", value).eq("status", "ACTIVE").maybeSingle(),
    serviceRoleClient.schema("erp_procurement").from("sales_order_map_group")
      .select("id, so_id, status, so:so_id(company_id, so_number)")
      .eq("revised_external_fo_number", value).eq("status", "ACTIVE").maybeSingle(),
  ]);
  const groupRow = originalResult.data ?? revisedResult.data;
  const groupError = originalResult.error ?? revisedResult.error;
  if (!groupError && groupRow) {
    const so = (groupRow as JsonRecord).so as JsonRecord | null;
    if (so && toUpperTrimmedString(so.company_id) === toUpperTrimmedString(companyId)) {
      return { status: "VDC", so_id: toTrimmedString((groupRow as JsonRecord).so_id), so_number: toTrimmedString(so.so_number), map_group_id: toTrimmedString((groupRow as JsonRecord).id) };
    }
  }
  const { data: soRow, error: soError } = await serviceRoleClient
    .schema("erp_procurement").from("sales_order")
    .select("id, so_number, company_id, dispatch_type")
    .eq("so_number", value).maybeSingle();
  if (!soError && soRow) {
    const so = soRow as JsonRecord;
    if (toUpperTrimmedString(so.company_id) !== toUpperTrimmedString(companyId)) return { status: "NOT_FOUND" };
    const dispatchType = toUpperTrimmedString(so.dispatch_type);
    if (dispatchType === "DEPENDENT_DEPOT") return { status: "DC", so_id: toTrimmedString(so.id), so_number: toTrimmedString(so.so_number) };
    if (dispatchType === "DEPENDENT_DIRECT") return { status: "VDC_WRONG_FIELD" };
    return { status: "DC_WRONG_FIELD" };
  }
  return { status: "NOT_FOUND" };
}

// Preview/resolve — read-only, mirrors so_map_bulk.handlers.ts's
// previewSoMapBulkUploadHandler exactly (same style, same guarantees: never
// writes a customer/address/allocation/DO itself).
export async function previewDoBulkUploadHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    if (!companyId) return doBulkErrorResponse(req, ctx, "DO_BULK_COMPANY_REQUIRED", 400, "company_id is required.");
    if (!(await canMaintainDoBulkAccess(ctx, companyId, "VIEW"))) {
      return doBulkErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Create-DO access at this company.");
    }
    const rows = Array.isArray(body.rows) ? (body.rows as RawUploadRow[]) : [];
    if (rows.length === 0) return doBulkErrorResponse(req, ctx, "DO_BULK_ROWS_REQUIRED", 400, "At least one row is required.");

    const finishedGoodsLocations = await listFinishedGoodsStorageLocations();

    const results: JsonRecord[] = [];
    // Row-by-row resolution — each row's identifier is independently looked
    // up (not batched) because the lookup itself spans two different tables
    // (map_group vs sales_order) and the row count on a real Bulk DO Upload
    // sheet is small (one FO/SO + a handful of SKU lines), unlike the
    // bulk-material/customer sweeps elsewhere that justify a prefetch round.
    for (const row of rows) {
      const identifier = toTrimmedString(row.fo_or_so_number);
      if (!identifier) { results.push({ row_index: row.row_index, status: "ERROR", error_code: "FO_SO_NUMBER_REQUIRED" }); continue; }
      const resolved = await resolveFoOrSo(identifier, companyId);
      if (resolved.status === "NOT_FOUND") { results.push({ row_index: row.row_index, status: "ERROR", error_code: "FO_SO_NOT_FOUND" }); continue; }
      if (resolved.status === "VDC_WRONG_FIELD") { results.push({ row_index: row.row_index, status: "ERROR", error_code: "DO_BULK_VDC_MUST_USE_FO_NUMBER" }); continue; }
      if (resolved.status === "DC_WRONG_FIELD") { results.push({ row_index: row.row_index, status: "ERROR", error_code: "DO_BULK_SO_WRONG_DISPATCH_TYPE" }); continue; }
      const ddFlag = resolved.status === "VDC";
      const soId = toTrimmedString(resolved.so_id);

      // SKU candidates — VDC resolves against this FO's own already-mapped
      // allocations (point 15: "FO Number আগে SO Map-এ resolve/mapped হয়ে
      // থাকতেই হবে, না থাকলে error"); DC resolves straight against the SO's
      // own lines (no SO Map step required for Depot per point 10's
      // correction).
      let skuCandidates: JsonRecord[] = [];
      let matchedAllocationId: string | null = null;
      let matchedSoLineId: string | null = null;
      let matchedMaterialId: string | null = null;
      let lineRemaining = 0;
      let perPackQty: number | null = null;

      if (ddFlag) {
        if (!resolved.map_group_id) { results.push({ row_index: row.row_index, status: "ERROR", error_code: "DO_BULK_FO_NOT_MAPPED" }); continue; }
        const { data: allocRows, error: allocError } = await serviceRoleClient
          .schema("erp_procurement").from("sales_order_map_allocation")
          .select("id, so_line_id, allocated_qty").eq("map_group_id", resolved.map_group_id).eq("status", "ACTIVE");
        if (allocError) { results.push({ row_index: row.row_index, status: "ERROR", error_code: "DO_BULK_ALLOCATION_LOOKUP_FAILED" }); continue; }
        const allocations = (allocRows ?? []) as JsonRecord[];
        const soLineIds = [...new Set(allocations.map((a) => toTrimmedString(a.so_line_id)).filter(Boolean))];
        const { data: lineRows } = soLineIds.length
          ? await serviceRoleClient.schema("erp_procurement").from("sales_order_line").select("id, material_id, per_pack_qty").in("id", soLineIds)
          : { data: [] as JsonRecord[] };
        const lineById = new Map(((lineRows ?? []) as JsonRecord[]).map((l) => [toTrimmedString(l.id), l]));
        const materialIds = [...new Set(((lineRows ?? []) as JsonRecord[]).map((l) => toTrimmedString(l.material_id)).filter(Boolean))];
        const { data: materialRows } = materialIds.length
          ? await serviceRoleClient.schema("erp_master").from("material_master").select("id, pace_code, external_code, material_name").in("id", materialIds)
          : { data: [] as JsonRecord[] };
        const materialById = new Map(((materialRows ?? []) as JsonRecord[]).map((m) => [toTrimmedString(m.id), m]));
        const drawnByAllocation = await computeDrawnQtyByAllocation(allocations.map((a) => toTrimmedString(a.id)));
        const skuTarget = toUpperTrimmedString(row.sku);
        for (const alloc of allocations) {
          const line = lineById.get(toTrimmedString(alloc.so_line_id));
          const material = line ? materialById.get(toTrimmedString(line.material_id)) : undefined;
          const display = material ? `${toTrimmedString(material.pace_code)} — ${toTrimmedString(material.material_name)}` : toTrimmedString(alloc.so_line_id);
          skuCandidates.push({ allocation_id: alloc.id, so_line_id: alloc.so_line_id, material_id: line?.material_id, display });
          if (material && [material.pace_code, material.external_code, material.material_name].some((f) => toUpperTrimmedString(f) === skuTarget)) {
            matchedAllocationId = toTrimmedString(alloc.id);
            matchedSoLineId = toTrimmedString(alloc.so_line_id);
            matchedMaterialId = toTrimmedString(line?.material_id);
            perPackQty = Number(line?.per_pack_qty) || null;
            lineRemaining = Number(alloc.allocated_qty ?? 0) - (drawnByAllocation.get(toTrimmedString(alloc.id)) ?? 0);
          }
        }
      } else {
        const { data: lineRows, error: lineError } = await serviceRoleClient
          .schema("erp_procurement").from("sales_order_line")
          .select("id, material_id, base_qty, quantity, per_pack_qty").eq("so_id", soId);
        if (lineError) { results.push({ row_index: row.row_index, status: "ERROR", error_code: "DO_BULK_SO_LINE_LOOKUP_FAILED" }); continue; }
        const lines = (lineRows ?? []) as JsonRecord[];
        const materialIds = [...new Set(lines.map((l) => toTrimmedString(l.material_id)).filter(Boolean))];
        const { data: materialRows } = materialIds.length
          ? await serviceRoleClient.schema("erp_master").from("material_master").select("id, pace_code, external_code, material_name").in("id", materialIds)
          : { data: [] as JsonRecord[] };
        const materialById = new Map(((materialRows ?? []) as JsonRecord[]).map((m) => [toTrimmedString(m.id), m]));
        const drawnByLine = await computeDrawnQtyByLine(lines.map((l) => toTrimmedString(l.id)));
        const skuTarget = toUpperTrimmedString(row.sku);
        for (const line of lines) {
          const material = materialById.get(toTrimmedString(line.material_id));
          const display = material ? `${toTrimmedString(material.pace_code)} — ${toTrimmedString(material.material_name)}` : toTrimmedString(line.id);
          skuCandidates.push({ so_line_id: line.id, material_id: line.material_id, display });
          if (material && [material.pace_code, material.external_code, material.material_name].some((f) => toUpperTrimmedString(f) === skuTarget)) {
            matchedSoLineId = toTrimmedString(line.id);
            matchedMaterialId = toTrimmedString(line.material_id);
            perPackQty = Number(line.per_pack_qty) || null;
            lineRemaining = Number(line.base_qty ?? line.quantity ?? 0) - (drawnByLine.get(toTrimmedString(line.id)) ?? 0);
          }
        }
      }

      const skuResolution = matchedSoLineId
        ? { status: "MATCHED", so_line_id: matchedSoLineId, so_map_allocation_id: matchedAllocationId, material_id: matchedMaterialId }
        : { status: "NOT_FOUND", candidates: skuCandidates };

      const packQty = Number(row.pack_qty ?? 0);
      const baseQty = perPackQty ? packQty * perPackQty : packQty;
      const qtyStatus = matchedSoLineId && baseQty > lineRemaining + QTY_TOL ? "EXCEEDS_BALANCE" : "OK";

      const transporterResolution = await resolveTransporterByName(toTrimmedString(row.transporter_name));
      const storageLocation = await resolveStorageLocationByCode(toTrimmedString(row.storage_location_code));

      const truckNumber = toTrimmedString(row.truck_number);
      const dispatchDate = normalizeInputDate(row.dispatch_date);
      const doDate = normalizeInputDate(row.do_date);
      const lrNumber = toTrimmedString(row.lr_number);
      const lrDate = normalizeInputDate(row.lr_date);
      const missingRequired: string[] = [];
      const formatErrors: string[] = [];
      if (!doDate) missingRequired.push("do_date");
      else if (!isIsoDate(doDate)) formatErrors.push("DO Date is invalid");
      if (!lrNumber) missingRequired.push("lr_number");
      if (!lrDate) missingRequired.push("lr_date");
      else if (!isIsoDate(lrDate)) formatErrors.push("LR Date is invalid");
      if (transporterResolution.status === "NOT_FOUND") missingRequired.push("transporter");
      if (!Number.isFinite(packQty) || packQty <= 0) formatErrors.push("Pack Qty must be positive");
      if (normalizeInputDate(row.tally_invoice_date) && !isIsoDate(normalizeInputDate(row.tally_invoice_date))) formatErrors.push("Tally Invoice Date is invalid");
      if (dispatchDate && !isIsoDate(dispatchDate)) formatErrors.push("Dispatch Date is invalid");
      // §6 point 14/15 — DC row: Truck Number + Dispatch Date mandatory at
      // upload time (DO never created without them); VDC row: optional
      // (filled later by the Truck+Dispatch Date Upload page, §6 point 19).
      if (!ddFlag) {
        if (!truckNumber) missingRequired.push("truck_number");
        if (!dispatchDate) missingRequired.push("dispatch_date");
      }

      results.push({
        row_index: row.row_index,
        status: "RESOLVED",
        dd_flag: ddFlag,
        so_id: soId,
        so_number: resolved.so_number,
        fo_or_so_number: identifier,
        map_group_id: resolved.map_group_id ?? null,
        sku_resolution: skuResolution,
        qty_status: qtyStatus,
        base_qty: matchedSoLineId ? baseQty : null,
        transporter_resolution: transporterResolution,
        storage_location: storageLocation,
        storage_location_candidates: finishedGoodsLocations,
        missing_required_fields: missingRequired,
        format_errors: formatErrors,
      });
    }

    return okResponse({ data: results }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_BULK_PREVIEW_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") ? 400 : 500;
    return doBulkErrorResponse(req, ctx, code, status, code);
  }
}

async function computeDrawnQtyByAllocation(allocationIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (allocationIds.length === 0) return map;
  const rows = await fetchInChunks<JsonRecord>(allocationIds, (chunk) =>
    serviceRoleClient.schema("erp_procurement").from("delivery_challan_line")
      .select("so_map_allocation_id, quantity, delivery_challan!inner(status)")
      .in("so_map_allocation_id", chunk).neq("delivery_challan.status", "CANCELLED"));
  for (const row of rows) {
    const key = toTrimmedString(row.so_map_allocation_id);
    map.set(key, (map.get(key) ?? 0) + Number(row.quantity ?? 0));
  }
  return map;
}

async function computeDrawnQtyByLine(soLineIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (soLineIds.length === 0) return map;
  const rows = await fetchInChunks<JsonRecord>(soLineIds, (chunk) =>
    serviceRoleClient.schema("erp_procurement").from("delivery_challan_line")
      .select("so_line_id, quantity, delivery_challan!inner(status)")
      .in("so_line_id", chunk).neq("delivery_challan.status", "CANCELLED"));
  for (const row of rows) {
    const key = toTrimmedString(row.so_line_id);
    map.set(key, (map.get(key) ?? 0) + Number(row.quantity ?? 0));
  }
  return map;
}

type SaveGroupInput = {
  fo_or_so_number: string;
  dd_flag: boolean;
  so_id: string;
  map_group_id?: string | null;
  do_date?: string;
  transporter_id: string;
  lr_number: string;
  lr_date: string;
  truck_number?: string;
  dispatch_date?: string;
  tally_invoice_number?: string;
  tally_invoice_date?: string;
  inbound_number?: string;
  rows: Array<{
    so_line_id: string;
    so_map_allocation_id?: string | null;
    base_qty: number;
    storage_location_id: string;
  }>;
};

// DC-only: a Depot destination needs no customer/address choice at all (the
// depot company itself is always the Ship-To), so when a matched SO line
// has no existing ACTIVE allocation yet, this auto-creates exactly one via
// the EXISTING, unmodified saveSoMapGroupHandler(source:"depot") — the same
// call the business owner's manual "map to Fixed Depot" button in
// SO01MapPage.jsx's MapDrawer already makes. Never invents new allocation
// logic; always re-queries afterward for the real row id/qty the atomic RPC
// actually wrote.
async function ensureDepotAllocation(req: Request, ctx: ProcurementHandlerContext, soId: string, soLineId: string, baseQty: number): Promise<{ allocation_id: string } | { error_code: string }> {
  const { data: existing, error: existingError } = await serviceRoleClient
    .schema("erp_procurement").from("sales_order_map_allocation")
    .select("id, allocated_qty").eq("so_line_id", soLineId).eq("status", "ACTIVE");
  if (existingError) return { error_code: "DO_BULK_ALLOCATION_LOOKUP_FAILED" };
  const existingRows = (existing ?? []) as JsonRecord[];
  const alreadyAllocated = existingRows.reduce((sum, row) => sum + Number(row.allocated_qty ?? 0), 0);
  if (existingRows.length > 0 && alreadyAllocated + QTY_TOL >= baseQty) {
    // Reuse the first ACTIVE allocation for this line — createDeliveryOrderUnifiedHandler's
    // own balance check (allocated_qty − already drawn) governs exactly how
    // much of it this DO line may actually draw.
    return { allocation_id: toTrimmedString(existingRows[0].id) };
  }
  const groupReq = new Request(req.url, {
    method: "POST",
    body: JSON.stringify({ so_id: soId, source: "depot", items: [{ so_line_id: soLineId, allocated_qty: baseQty }] }),
    headers: req.headers,
  });
  const groupResp = await saveSoMapGroupHandler(groupReq, ctx);
  const groupJson = await groupResp.json().catch(() => null) as { ok?: boolean; data?: JsonRecord; error?: JsonRecord } | null;
  if (!groupResp.ok || !groupJson?.ok || !groupJson.data?.group_id) {
    return { error_code: toTrimmedString(groupJson?.error && (groupJson.error as JsonRecord).code) || "DO_BULK_DEPOT_MAP_FAILED" };
  }
  const { data: createdAlloc, error: createdError } = await serviceRoleClient
    .schema("erp_procurement").from("sales_order_map_allocation")
    .select("id").eq("map_group_id", toTrimmedString(groupJson.data.group_id)).eq("so_line_id", soLineId).eq("status", "ACTIVE").maybeSingle();
  if (createdError || !createdAlloc) return { error_code: "DO_BULK_DEPOT_MAP_LOOKUP_FAILED" };
  return { allocation_id: toTrimmedString((createdAlloc as JsonRecord).id) };
}

// Save — one Delivery Order per resolved FO/SO group, driving the EXISTING
// createDeliveryOrderUnifiedHandler exactly as-is (gate_entry.handlers.ts's
// synthetic-Request pattern), then a single additive follow-up UPDATE for
// the columns that handler's own RPC payload has no slot for at all.
export async function saveDoBulkUploadHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    if (!companyId) return doBulkErrorResponse(req, ctx, "DO_BULK_COMPANY_REQUIRED", 400, "company_id is required.");
    if (!(await canMaintainDoBulkAccess(ctx, companyId, "WRITE"))) {
      return doBulkErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Create-DO access at this company.");
    }
    const groups = Array.isArray(body.groups) ? (body.groups as SaveGroupInput[]) : [];
    if (groups.length === 0) return doBulkErrorResponse(req, ctx, "DO_BULK_GROUPS_REQUIRED", 400, "At least one group is required.");

    const results: JsonRecord[] = [];
    for (const group of groups) {
      try {
        const doDate = normalizeInputDate(group.do_date);
        const lrDate = normalizeInputDate(group.lr_date);
        const dispatchDate = normalizeInputDate(group.dispatch_date);
        const tallyInvoiceDate = normalizeInputDate(group.tally_invoice_date);
        if (!isIsoDate(doDate)) throw new Error("DO_BULK_DO_DATE_REQUIRED_OR_INVALID");
        if (!toTrimmedString(group.lr_number) || !isIsoDate(lrDate)) throw new Error("DO_BULK_LR_FIELDS_REQUIRED_OR_INVALID");
        if (dispatchDate && !isIsoDate(dispatchDate)) throw new Error("DO_BULK_DISPATCH_DATE_INVALID");
        if (tallyInvoiceDate && !isIsoDate(tallyInvoiceDate)) throw new Error("DO_BULK_TALLY_INVOICE_DATE_INVALID");
        if (!toTrimmedString(group.transporter_id)) throw new Error("DO_BULK_TRANSPORTER_REQUIRED");
        if (!Array.isArray(group.rows) || group.rows.length === 0 || group.rows.some((row) => !Number.isFinite(Number(row.base_qty)) || Number(row.base_qty) <= 0)) {
          throw new Error("DO_BULK_LINE_QTY_INVALID");
        }
        const { data: transporter, error: transporterError } = await serviceRoleClient
          .schema("erp_master").from("transporter_master")
          .select("id").eq("id", toTrimmedString(group.transporter_id)).eq("active", true).maybeSingle();
        if (transporterError || !transporter) throw new Error("DO_BULK_TRANSPORTER_INVALID");
        // Never trust the spreadsheet's DD flag to choose a reservation
        // policy. Resolve the underlying SO type again at commit time.
        const { data: sourceSo, error: sourceSoError } = await serviceRoleClient
          .schema("erp_procurement").from("sales_order").select("dispatch_type")
          .eq("id", toTrimmedString(group.so_id)).maybeSingle();
        if (sourceSoError || !sourceSo) throw new Error("DO_BULK_SOURCE_SO_NOT_FOUND");
        const actualDispatchType = toUpperTrimmedString((sourceSo as JsonRecord).dispatch_type);
        const isVdc = actualDispatchType === "DEPENDENT_DIRECT";
        const isDc = actualDispatchType === "DEPENDENT_DEPOT";
        if ((group.dd_flag && !isVdc) || (!group.dd_flag && !isDc)) {
          throw new Error("DO_BULK_DD_FLAG_SOURCE_MISMATCH");
        }
        const sourceReference = await resolveFoOrSo(toTrimmedString(group.fo_or_so_number), companyId);
        if ((isVdc && (sourceReference.status !== "VDC" || sourceReference.so_id !== group.so_id))
          || (isDc && (sourceReference.status !== "DC" || sourceReference.so_id !== group.so_id))) {
          throw new Error("DO_BULK_SOURCE_REFERENCE_INVALID");
        }
        if (!group.dd_flag) {
          if (!toTrimmedString(group.truck_number) || !dispatchDate) {
            throw new Error("DO_BULK_DC_TRUCK_DISPATCH_REQUIRED");
          }
        }
        const lines: JsonRecord[] = [];
        for (const row of group.rows) {
          const { data: soLine, error: soLineError } = await serviceRoleClient
            .schema("erp_procurement").from("sales_order_line")
            .select("id, so_id").eq("id", toTrimmedString(row.so_line_id)).maybeSingle();
          if (soLineError || !soLine || toTrimmedString((soLine as JsonRecord).so_id) !== toTrimmedString(group.so_id)) {
            throw new Error("DO_BULK_SO_LINE_SOURCE_INVALID");
          }
          const { data: storageLocation, error: storageLocationError } = await serviceRoleClient
            .schema("erp_inventory").from("storage_location_master")
            .select("id, code, active").eq("id", toTrimmedString(row.storage_location_id)).maybeSingle();
          if (storageLocationError || !storageLocation || (storageLocation as JsonRecord).active !== true || !toUpperTrimmedString((storageLocation as JsonRecord).code).startsWith("F")) {
            throw new Error("DO_BULK_FG_STORAGE_LOCATION_REQUIRED");
          }
          let allocationId = toTrimmedString(row.so_map_allocation_id);
          if (isVdc) {
            const { data: allocation, error: allocationError } = await serviceRoleClient
              .schema("erp_procurement").from("sales_order_map_allocation")
              .select("id, map_group_id, so_line_id, status")
              .eq("id", allocationId).maybeSingle();
            if (allocationError || !allocation
              || toUpperTrimmedString((allocation as JsonRecord).status) !== "ACTIVE"
              || toTrimmedString((allocation as JsonRecord).map_group_id) !== toTrimmedString(sourceReference.map_group_id)
              || toTrimmedString((allocation as JsonRecord).so_line_id) !== toTrimmedString(row.so_line_id)) {
              throw new Error("DO_BULK_VDC_ALLOCATION_INVALID");
            }
          }
          if (!allocationId && !group.dd_flag) {
            const ensured = await ensureDepotAllocation(req, ctx, group.so_id, row.so_line_id, row.base_qty);
            if ("error_code" in ensured) throw new Error(ensured.error_code);
            allocationId = ensured.allocation_id;
          }
          if (!allocationId) throw new Error("DO_BULK_LINE_ALLOCATION_MISSING");
          lines.push({
            so_map_allocation_id: allocationId,
            quantity: row.base_qty,
            storage_location_id: row.storage_location_id,
          });
        }

        const createPayload: JsonRecord = {
          company_id: companyId,
          lines,
          transporter_id: group.transporter_id,
          lr_number: group.lr_number,
          lr_date: lrDate,
          vehicle_number: toTrimmedString(group.truck_number) || undefined,
        };
        const deferVdcReservation = isVdc && (!toTrimmedString(group.truck_number) || !dispatchDate);
        const createReq = new Request(req.url, {
          method: "POST",
          body: JSON.stringify(createPayload),
          headers: req.headers,
        });
        const createResp = deferVdcReservation
          ? await createDeferredVdcBulkDeliveryOrder(req, ctx, createPayload)
          : await createDeliveryOrderUnifiedHandler(createReq, ctx);
        const createJson = await createResp.json().catch(() => null) as { ok?: boolean; data?: JsonRecord; error?: JsonRecord } | null;
        if (!createResp.ok || !createJson?.ok || !createJson.data?.id) {
          throw new Error(toTrimmedString(createJson?.error && (createJson.error as JsonRecord).code) || "DO_BULK_CREATE_FAILED");
        }
        const dcId = toTrimmedString(createJson.data.id);

        const patch: JsonRecord = {
          is_bulk_uploaded: true,
          pgi_deferred: Boolean(group.dd_flag),
        };
        if (doDate) patch.dc_date = doDate;
        if (dispatchDate) patch.dispatch_date = dispatchDate;
        if (toTrimmedString(group.tally_invoice_number)) patch.pre_invoice_tally_invoice_number = toTrimmedString(group.tally_invoice_number);
        if (tallyInvoiceDate) patch.pre_invoice_tally_invoice_date = tallyInvoiceDate;
        if (toTrimmedString(group.inbound_number)) patch.pre_invoice_inbound_number = toTrimmedString(group.inbound_number);
        const { error: patchError } = await serviceRoleClient
          .schema("erp_procurement").from("delivery_challan").update(patch).eq("id", dcId);
        if (patchError) throw new Error("DO_BULK_PATCH_FAILED");

        results.push({ fo_or_so_number: group.fo_or_so_number, status: "CREATED", dc_id: dcId });
      } catch (groupError) {
        const code = groupError instanceof Error ? groupError.message : "DO_BULK_GROUP_FAILED";
        results.push({ fo_or_so_number: group.fo_or_so_number, status: "ERROR", error_code: code });
      }
    }

    return okResponse({ data: results }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_BULK_SAVE_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") ? 400 : 500;
    return doBulkErrorResponse(req, ctx, code, status, code);
  }
}

// §6 points 13/16 — the Bulk SO03 editor is FO-keyed because the business
// owner operates from the Sales/Dispatch FO Number, not an internal DO id.
// It remains available after VDC PGI as well: the business rule explicitly
// permits header corrections after DO create, invoice post, and PGI post.
// This additive endpoint never changes a line, reservation, or stock event.
const BULK_DISPATCH_HEADER_EDITABLE_STATUSES = new Set(["CREATED", "INVOICED", "DISPATCHED"]);

export async function findDoByFoNumberHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, toTrimmedString(url.searchParams.get("company_id")));
    if (!companyId) return doBulkErrorResponse(req, ctx, "DO_BULK_COMPANY_REQUIRED", 400, "company_id is required.");
    if (!(await canMaintainDoBulkAccess(ctx, companyId, "VIEW"))) {
      return doBulkErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Create-DO access at this company.");
    }
    const foNumber = toTrimmedString(url.searchParams.get("fo_number"));
    if (!foNumber) return doBulkErrorResponse(req, ctx, "DO_BULK_FO_NUMBER_REQUIRED", 400, "fo_number is required.");

    const [originalResult, revisedResult] = await Promise.all([
      serviceRoleClient.schema("erp_procurement").from("sales_order_map_group")
        .select("id, so:so_id(company_id)").eq("external_fo_number", foNumber).eq("status", "ACTIVE").maybeSingle(),
      serviceRoleClient.schema("erp_procurement").from("sales_order_map_group")
        .select("id, so:so_id(company_id)").eq("revised_external_fo_number", foNumber).eq("status", "ACTIVE").maybeSingle(),
    ]);
    const groupRow = originalResult.data ?? revisedResult.data;
    const groupError = originalResult.error ?? revisedResult.error;
    if (groupError) return doBulkErrorResponse(req, ctx, "DO_BULK_FO_LOOKUP_FAILED", 500, "Unable to look up this FO Number.");
    if (!groupRow) return doBulkErrorResponse(req, ctx, "DO_BULK_FO_NOT_FOUND", 404, "This FO Number is not mapped yet.");
    const so = (groupRow as JsonRecord).so as JsonRecord | null;
    if (!so || toUpperTrimmedString(so.company_id) !== toUpperTrimmedString(companyId)) {
      return doBulkErrorResponse(req, ctx, "DO_BULK_FO_NOT_FOUND", 404, "This FO Number is not mapped in this company.");
    }

    const { data: allocRows, error: allocError } = await serviceRoleClient
      .schema("erp_procurement").from("sales_order_map_allocation")
      .select("id").eq("map_group_id", toTrimmedString((groupRow as JsonRecord).id));
    if (allocError) return doBulkErrorResponse(req, ctx, "DO_BULK_ALLOCATION_LOOKUP_FAILED", 500, "Unable to look up this FO's allocations.");
    const allocationIds = ((allocRows ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.id));
    if (allocationIds.length === 0) return doBulkErrorResponse(req, ctx, "DO_BULK_FO_NOT_DISPATCHED", 404, "This FO has no Delivery Order yet.");

    const { data: lineRows, error: lineError } = await serviceRoleClient
      .schema("erp_procurement").from("delivery_challan_line")
      .select("dc_id").in("so_map_allocation_id", allocationIds);
    if (lineError) return doBulkErrorResponse(req, ctx, "DO_BULK_LINE_LOOKUP_FAILED", 500, "Unable to look up this FO's Delivery Order.");
    const dcIds = [...new Set(((lineRows ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.dc_id)).filter(Boolean))];
    if (dcIds.length === 0) return doBulkErrorResponse(req, ctx, "DO_BULK_FO_NOT_DISPATCHED", 404, "This FO has no Delivery Order yet.");

    const { data: dcRows, error: dcError } = await serviceRoleClient
      .schema("erp_procurement").from("delivery_challan")
      .select("id, dc_number, status, transporter_id, transporter_name_freetext, lr_number, lr_date, vehicle_number, dispatch_date, pgi_deferred")
      .in("id", dcIds).neq("status", "CANCELLED").order("dc_date", { ascending: false });
    if (dcError) return doBulkErrorResponse(req, ctx, "DO_BULK_DO_LOOKUP_FAILED", 500, "Unable to load this FO's Delivery Order.");
    const dcRow = ((dcRows ?? []) as JsonRecord[])[0];
    if (!dcRow) return doBulkErrorResponse(req, ctx, "DO_BULK_FO_NOT_DISPATCHED", 404, "This FO has no active Delivery Order.");
    if (!BULK_DISPATCH_HEADER_EDITABLE_STATUSES.has(toUpperTrimmedString(dcRow.status))) {
      return doBulkErrorResponse(req, ctx, "DO_BULK_EDIT_WINDOW_CLOSED", 400, "This Delivery Order is cancelled and cannot be edited.");
    }

    let transporterDisplay: string | null = toTrimmedString(dcRow.transporter_name_freetext) || null;
    if (dcRow.transporter_id) {
      const { data: transporter } = await serviceRoleClient
        .schema("erp_master").from("transporter_master").select("transporter_code, transporter_name").eq("id", toTrimmedString(dcRow.transporter_id)).maybeSingle();
      if (transporter) transporterDisplay = `${toTrimmedString((transporter as JsonRecord).transporter_code)} — ${toTrimmedString((transporter as JsonRecord).transporter_name)}`;
    }

    return okResponse({
      dc_id: dcRow.id,
      dc_number: dcRow.dc_number,
      status: dcRow.status,
      transporter_id: dcRow.transporter_id,
      transporter_display: transporterDisplay,
      lr_number: dcRow.lr_number,
      lr_date: dcRow.lr_date,
      truck_number: dcRow.vehicle_number,
      dispatch_date: dcRow.dispatch_date,
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_BULK_FO_LOOKUP_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") ? 400 : code.includes("NOT_FOUND") || code.includes("NOT_DISPATCHED") ? 404 : 500;
    return doBulkErrorResponse(req, ctx, code, status, code);
  }
}

// §6 point 16 — this page only updates data; it never triggers PGI (that
// happens separately via the Truck+Dispatch Date Upload page's Post action,
// §6 point 19/Phase 5). A direct, additive UPDATE on delivery_challan's own
// header columns — never routed through updateDeliveryOrderUnifiedHandler,
// since that handler mandatorily replaces the whole line set and this edit
// never touches lines at all.
export async function editTransporterDetailsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const dcId = toTrimmedString(body.dc_id);
    if (!dcId) return doBulkErrorResponse(req, ctx, "DO_BULK_DC_ID_REQUIRED", 400, "dc_id is required.");
    const lrDate = toTrimmedString(body.lr_date);
    if (lrDate && !isManualDocumentDateWithinWindow(lrDate)) {
      return doBulkErrorResponse(req, ctx, "DO_MANUAL_DATE_OUTSIDE_ALLOWED_WINDOW", 400, MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE);
    }

    const { data: dc, error: dcError } = await serviceRoleClient
      .schema("erp_procurement").from("delivery_challan").select("id, status, selling_company_id, lr_date").eq("id", dcId).maybeSingle();
    if (dcError || !dc) return doBulkErrorResponse(req, ctx, "DO_BULK_DO_NOT_FOUND", 404, "Delivery order not found.");
    const companyId = toTrimmedString((dc as JsonRecord).selling_company_id);
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return doBulkErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainDoBulkAccess(ctx, companyId, "EDIT"))) {
      return doBulkErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Edit-DO access at this company.");
    }
    if (!BULK_DISPATCH_HEADER_EDITABLE_STATUSES.has(toUpperTrimmedString((dc as JsonRecord).status))) {
      return doBulkErrorResponse(req, ctx, "DO_BULK_EDIT_WINDOW_CLOSED", 400, "This Delivery Order is cancelled and cannot be edited.");
    }

    const truckNumber = toTrimmedString(body.truck_number);
    if (truckNumber && truckNumber.length < 4) {
      return doBulkErrorResponse(req, ctx, "DO_BULK_TRUCK_INVALID", 400, "Truck Number must contain at least 4 characters.");
    }
    const dispatchDate = toTrimmedString(body.dispatch_date);
    if (dispatchDate) {
      const effectiveLrDate = lrDate || toTrimmedString((dc as JsonRecord).lr_date);
      if (!isIsoDate(dispatchDate) || !isIsoDate(effectiveLrDate) || dispatchDate < effectiveLrDate || dispatchDate > todayIsoInKolkata()) {
        return doBulkErrorResponse(req, ctx, "DO_BULK_DISPATCH_DATE_INVALID", 400, "Dispatch Date must be on/after LR Date and cannot be in the future.");
      }
    }

    const patch: JsonRecord = {};
    if (toTrimmedString(body.transporter_id)) patch.transporter_id = toTrimmedString(body.transporter_id);
    if (toTrimmedString(body.lr_number)) patch.lr_number = toTrimmedString(body.lr_number);
    if (lrDate) patch.lr_date = lrDate;
    if (truckNumber) patch.vehicle_number = truckNumber;
    if (dispatchDate) patch.dispatch_date = dispatchDate;
    if (Object.keys(patch).length === 0) return doBulkErrorResponse(req, ctx, "DO_BULK_EDIT_NO_FIELDS", 400, "At least one field is required.");

    const { error: patchError } = await serviceRoleClient
      .schema("erp_procurement").from("delivery_challan").update(patch).eq("id", dcId);
    if (patchError) return doBulkErrorResponse(req, ctx, "DO_BULK_EDIT_FAILED", 500, "Unable to update dispatch details.");

    return okResponse({ dc_id: dcId, updated: true }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_BULK_EDIT_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") ? 400 : code.includes("NOT_FOUND") ? 404 : 500;
    return doBulkErrorResponse(req, ctx, code, status, code);
  }
}
