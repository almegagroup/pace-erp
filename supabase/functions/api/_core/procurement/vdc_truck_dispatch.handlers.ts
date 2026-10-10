/*
 * VDC Truck + Dispatch Date Upload (SO03). This is deliberately separate
 * from the live DO edit/PGI handlers: it operates only on Invoice-only VDC
 * Bulk DOs, then invokes the new VDC PGI-only endpoint for the physical leg.
 */
import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { todayIsoInKolkata } from "../../_shared/dateUtils.ts";
import { errorResponse, okResponse } from "../response.ts";
import { canMaintainSalesInvoice, computeInvoiceGroups } from "./do_unified.handlers.ts";
import { completeVdcPgiOnlyHandler } from "./vdc_invoice.handlers.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = { context: Extract<ContextResolution, { status: "RESOLVED" }>; request_id: string; auth_user_id: string; roleCode: string; };
const text = (value: unknown) => String(value ?? "").trim();
const upper = (value: unknown) => text(value).toUpperCase();
const body = (req: Request) => req.json().catch(() => ({} as JsonRecord));
function fail(req: Request, ctx: ProcurementHandlerContext, code: string, status: number, message: string) { return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req); }
async function assertAccess(req: Request, ctx: ProcurementHandlerContext, companyId: string, action: "VIEW" | "WRITE") {
  try { await assertCompanyScope(ctx, companyId); } catch { return fail(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company."); }
  if (!(await canMaintainSalesInvoice(ctx, companyId, action))) return fail(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, `You do not have Invoice/PGI ${action === "VIEW" ? "view" : "create"} access at this company.`);
  return null;
}
function validIsoDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); }
function validDispatchDate(lrDate: string, dispatchDate: string) {
  if (!validIsoDate(lrDate) || !validIsoDate(dispatchDate)) return false;
  const today = todayIsoInKolkata();
  if (dispatchDate < lrDate || dispatchDate > today) return false;
  if (today >= "2026-10-14") {
    const floor = new Date(`${today}T00:00:00Z`); floor.setUTCDate(floor.getUTCDate() - 2);
    return dispatchDate >= floor.toISOString().slice(0, 10);
  }
  return true;
}

/** Prefilled pending-only export/review data. One row per SKU/DO line. */
export async function listVdcTruckDispatchPendingHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const companyId = text(new URL(req.url).searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "COMPANY_ID_REQUIRED", 400, "company_id is required.");
    const denied = await assertAccess(req, ctx, companyId, "VIEW"); if (denied) return denied;
    const { data: invoices, error: invoiceError } = await serviceRoleClient.schema("erp_procurement").from("sales_invoice")
      .select("id, dc_id, invoice_number").eq("company_id", companyId).eq("status", "DRAFT");
    if (invoiceError) return fail(req, ctx, "VDC_UPLOAD_INVOICE_FETCH_FAILED", 500, "Unable to load pending VDC invoices.");
    const invoiceRows = (invoices ?? []) as JsonRecord[];
    const dcIds = [...new Set(invoiceRows.map((row) => text(row.dc_id)).filter(Boolean))];
    const { data: docs, error: docError } = dcIds.length ? await serviceRoleClient.schema("erp_procurement").from("delivery_challan")
      .select("id, dc_number, lr_date, vehicle_number, dispatch_date, pgi_deferred, is_bulk_uploaded, status").in("id", dcIds)
      : { data: [] as JsonRecord[], error: null };
    if (docError) return fail(req, ctx, "VDC_UPLOAD_DO_FETCH_FAILED", 500, "Unable to load pending VDC delivery orders.");
    const docById = new Map(((docs ?? []) as JsonRecord[])
      .filter((row) => row.pgi_deferred === true && row.is_bulk_uploaded === true && upper(row.status) === "INVOICED")
      .map((row) => [text(row.id), row]));
    const { data: dcLines, error: dcLineError } = docById.size ? await serviceRoleClient.schema("erp_procurement").from("delivery_challan_line")
      .select("id, so_map_allocation_id").in("dc_id", [...docById.keys()])
      : { data: [] as JsonRecord[], error: null };
    if (dcLineError) return fail(req, ctx, "VDC_UPLOAD_DO_LINE_FETCH_FAILED", 500, "Unable to load VDC delivery-order lines.");
    const allocationIds = [...new Set(((dcLines ?? []) as JsonRecord[]).map((line) => text(line.so_map_allocation_id)).filter(Boolean))];
    const { data: allocations, error: allocationError } = allocationIds.length ? await serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation")
      .select("id, map_group_id").in("id", allocationIds)
      : { data: [] as JsonRecord[], error: null };
    if (allocationError) return fail(req, ctx, "VDC_UPLOAD_MAP_FETCH_FAILED", 500, "Unable to load VDC FO references.");
    const allocationById = new Map(((allocations ?? []) as JsonRecord[]).map((row) => [text(row.id), row]));
    const groupIds = [...new Set(((allocations ?? []) as JsonRecord[]).map((row) => text(row.map_group_id)).filter(Boolean))];
    const { data: mapGroups, error: mapGroupError } = groupIds.length ? await serviceRoleClient.schema("erp_procurement").from("sales_order_map_group")
      .select("id, external_fo_number, revised_external_fo_number").in("id", groupIds)
      : { data: [] as JsonRecord[], error: null };
    if (mapGroupError) return fail(req, ctx, "VDC_UPLOAD_FO_FETCH_FAILED", 500, "Unable to load VDC FO numbers.");
    const mapGroupById = new Map(((mapGroups ?? []) as JsonRecord[]).map((row) => [text(row.id), row]));
    const externalFoByDcLine = new Map(((dcLines ?? []) as JsonRecord[]).map((line) => {
      const allocation = allocationById.get(text(line.so_map_allocation_id));
      const mapGroup = allocation ? mapGroupById.get(text(allocation.map_group_id)) : undefined;
      return [text(line.id), text(mapGroup?.revised_external_fo_number) || text(mapGroup?.external_fo_number) || null];
    }));
    const rows: JsonRecord[] = [];
    for (const invoice of invoiceRows) {
      const dcId = text(invoice.dc_id); const dc = docById.get(dcId); if (!dc) continue;
      const { groups } = await computeInvoiceGroups(dcId);
      for (const group of groups) for (const line of group.lines) rows.push({
        invoice_id: invoice.id, invoice_number: invoice.invoice_number, dc_id: dcId, dc_number: dc.dc_number,
        so_number: group.document_number, fo_number: externalFoByDcLine.get(text(line.dc_line_id)) || group.fo_number || null,
        ship_to: group.ship_to.name, sku: line.document_name || line.material_display || line.material_id,
        storage_location_id: line.storage_location_id, lr_date: dc.lr_date || null,
        truck_number: dc.vehicle_number || null, dispatch_date: dc.dispatch_date || null,
      });
    }
    const storageLocationIds = [...new Set(rows.map((row) => text(row.storage_location_id)).filter(Boolean))];
    const { data: storageLocations, error: storageLocationError } = storageLocationIds.length
      ? await serviceRoleClient.schema("erp_inventory").from("storage_location_master").select("id, code, name").in("id", storageLocationIds)
      : { data: [] as JsonRecord[], error: null };
    if (storageLocationError) return fail(req, ctx, "VDC_UPLOAD_STORAGE_LOCATION_FETCH_FAILED", 500, "Unable to load Storage Locations.");
    const storageById = new Map(((storageLocations ?? []) as JsonRecord[]).map((row) => [text(row.id), row]));
    for (const row of rows) {
      const storage = storageById.get(text(row.storage_location_id));
      row.storage_location = storage ? [text(storage.code), text(storage.name)].filter(Boolean).join(" — ") : null;
    }
    return okResponse({ items: rows }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "VDC_UPLOAD_PENDING_FAILED"; return fail(req, ctx, code, 500, code); }
}

/**
 * Save truck/date per VDC DO then post every DRAFT invoice for those DOs.
 * The UI propagates an FO edit to its whole group; the server still validates
 * each DO independently and returns line-safe partial failures, so an
 * insufficient-stock row remains pending and never rolls back a clean row.
 */
export async function postVdcTruckDispatchUploadHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const payload = await body(req);
    const requested = Array.isArray(payload.rows) ? payload.rows as JsonRecord[] : [];
    const byDcId = new Map<string, JsonRecord>();
    for (const row of requested) { const dcId = text(row.dc_id); if (dcId) byDcId.set(dcId, row); }
    if (!byDcId.size) return fail(req, ctx, "VDC_UPLOAD_ROWS_REQUIRED", 400, "At least one completed Truck and Dispatch Date row is required.");
    const dcIds = [...byDcId.keys()];
    const { data: docs, error: docError } = await serviceRoleClient.schema("erp_procurement").from("delivery_challan")
      .select("id, selling_company_id, status, pgi_deferred, is_bulk_uploaded, lr_date").in("id", dcIds);
    if (docError || (docs ?? []).length !== dcIds.length) return fail(req, ctx, "VDC_UPLOAD_DO_NOT_FOUND", 404, "One or more pending VDC delivery orders no longer exist.");

    const results: JsonRecord[] = [];
    for (const dc of (docs ?? []) as JsonRecord[]) {
      const dcId = text(dc.id); const row = byDcId.get(dcId)!; const companyId = text(dc.selling_company_id);
      const denied = await assertAccess(req, ctx, companyId, "WRITE"); if (denied) return denied;
      const truckNumber = text(row.truck_number); const dispatchDate = text(row.dispatch_date);
      if (dc.pgi_deferred !== true || dc.is_bulk_uploaded !== true || upper(dc.status) !== "INVOICED") {
        results.push({ dc_id: dcId, ok: false, code: "VDC_UPLOAD_DO_NOT_PENDING", message: "Delivery order is not a pending VDC Invoice-only row." }); continue;
      }
      if (truckNumber.length < 4) { results.push({ dc_id: dcId, ok: false, code: "VDC_UPLOAD_TRUCK_INVALID", message: "Truck Number must contain at least 4 characters." }); continue; }
      if (!validDispatchDate(text(dc.lr_date), dispatchDate)) { results.push({ dc_id: dcId, ok: false, code: "VDC_UPLOAD_DISPATCH_DATE_INVALID", message: "Dispatch Date must be on/after LR Date and within the allowed posting window." }); continue; }
      const { error: updateError } = await serviceRoleClient.schema("erp_procurement").from("delivery_challan")
        .update({ vehicle_number: truckNumber, dispatch_date: dispatchDate }).eq("id", dcId).eq("status", "INVOICED");
      if (updateError) { results.push({ dc_id: dcId, ok: false, code: "VDC_UPLOAD_SAVE_FAILED", message: "Unable to save Truck and Dispatch Date." }); continue; }
      const { data: invoices, error: invoiceError } = await serviceRoleClient.schema("erp_procurement").from("sales_invoice")
        .select("id").eq("dc_id", dcId).eq("status", "DRAFT");
      if (invoiceError || !(invoices ?? []).length) { results.push({ dc_id: dcId, ok: false, code: "VDC_UPLOAD_INVOICE_NOT_FOUND", message: "No draft VDC invoice was found after saving the row." }); continue; }
      let failed: JsonRecord | null = null;
      for (const invoice of (invoices ?? []) as JsonRecord[]) {
        const internal = new Request(`http://internal/api/procurement/sales-invoices/${text(invoice.id)}/vdc-pgi-only`, { method: "POST" });
        const response = await completeVdcPgiOnlyHandler(internal, ctx);
        if (!response.ok) { failed = (await response.json().catch(() => ({}))) as JsonRecord; break; }
      }
      results.push(failed
        ? { dc_id: dcId, ok: false, code: text(failed.code) || "VDC_UPLOAD_PGI_FAILED", message: text(failed.message) || "PGI could not be posted; the row remains pending." }
        : { dc_id: dcId, ok: true });
    }
    return okResponse({ results }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "VDC_UPLOAD_POST_FAILED"; return fail(req, ctx, code, 500, code); }
}
