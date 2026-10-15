/*
 * VDC Truck + Dispatch Date Upload (SO03). This is deliberately separate
 * from the live DO edit/PGI handlers: it operates only on Invoice-only VDC
 * DD Direct invoice-only DOs, then invokes the new PGI-only endpoint for the
 * physical leg.  Bulk and normal SO03 creation share this lifecycle.
 */
import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { todayIsoInKolkata } from "../../_shared/dateUtils.ts";
import { errorResponse, okResponse } from "../response.ts";
import { computeInvoiceGroups } from "./do_unified.handlers.ts";
import { canMaintainDoBulkAccess } from "./do_bulk.handlers.ts";
import { completeVdcPgiOnlyHandler } from "./vdc_invoice.handlers.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = { context: Extract<ContextResolution, { status: "RESOLVED" }>; request_id: string; auth_user_id: string; roleCode: string; };
const text = (value: unknown) => String(value ?? "").trim();
const upper = (value: unknown) => text(value).toUpperCase();
const body = (req: Request) => req.json().catch(() => ({} as JsonRecord));
function fail(req: Request, ctx: ProcurementHandlerContext, code: string, status: number, message: string) { return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req); }
// Truck + Dispatch Date entry is the physical-dispatch step of a DO (the
// invoice already exists), so it belongs to Stores / Logistics: gated on the
// DO resource (PROC_DO_CREATE), not on Invoice/PGI access.
async function assertAccess(req: Request, ctx: ProcurementHandlerContext, companyId: string, action: "VIEW" | "EDIT") {
  try { await assertCompanyScope(ctx, companyId); } catch { return fail(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company."); }
  if (!(await canMaintainDoBulkAccess(ctx, companyId, action))) return fail(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, `You do not have Delivery Order ${action === "VIEW" ? "view" : "edit"} access at this company.`);
  return null;
}
function validIsoDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); }
function validDispatchDate(lrDate: string, dispatchDate: string) {
  if (!validIsoDate(lrDate) || !validIsoDate(dispatchDate)) return false;
  const today = todayIsoInKolkata();
  if (dispatchDate < lrDate || dispatchDate > today) return false;
  if (today >= "2026-10-31") {
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
    // Paged: PostgREST caps one response at 1000 rows.
    const invoiceRows: JsonRecord[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await serviceRoleClient.schema("erp_procurement").from("sales_invoice")
        .select("id, dc_id, invoice_number").eq("company_id", companyId).eq("status", "DRAFT").order("id").range(from, from + 999);
      if (error) return fail(req, ctx, "VDC_UPLOAD_INVOICE_FETCH_FAILED", 500, "Unable to load pending VDC invoices.");
      invoiceRows.push(...((data ?? []) as JsonRecord[]));
      if ((data ?? []).length < 1000) break;
    }
    const dcIds = [...new Set(invoiceRows.map((row) => text(row.dc_id)).filter(Boolean))];
    let docs: JsonRecord[];
    try {
      docs = await fetchInChunks<JsonRecord>(dcIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan")
        .select("id, dc_number, lr_date, vehicle_number, dispatch_date, pgi_deferred, is_bulk_uploaded, status").in("id", chunk));
    } catch { return fail(req, ctx, "VDC_UPLOAD_DO_FETCH_FAILED", 500, "Unable to load pending VDC delivery orders."); }
    // DD (VDC) only: a normal DO never reaches this deferred-PGI state.
    const docById = new Map(docs
      .filter((row) => row.pgi_deferred === true && upper(row.status) === "INVOICED")
      .map((row) => [text(row.id), row]));
    let dcLines: JsonRecord[];
    try {
      dcLines = await fetchInChunks<JsonRecord>([...docById.keys()], (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan_line")
        .select("id, so_map_allocation_id").in("dc_id", chunk));
    } catch { return fail(req, ctx, "VDC_UPLOAD_DO_LINE_FETCH_FAILED", 500, "Unable to load VDC delivery-order lines."); }
    const allocationIds = [...new Set(dcLines.map((line) => text(line.so_map_allocation_id)).filter(Boolean))];
    let allocations: JsonRecord[];
    try {
      allocations = await fetchInChunks<JsonRecord>(allocationIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation")
        .select("id, map_group_id").in("id", chunk));
    } catch { return fail(req, ctx, "VDC_UPLOAD_MAP_FETCH_FAILED", 500, "Unable to load VDC FO references."); }
    const allocationById = new Map(allocations.map((row) => [text(row.id), row]));
    const groupIds = [...new Set(allocations.map((row) => text(row.map_group_id)).filter(Boolean))];
    let mapGroups: JsonRecord[];
    try {
      mapGroups = await fetchInChunks<JsonRecord>(groupIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order_map_group")
        .select("id, external_fo_number, revised_external_fo_number").in("id", chunk));
    } catch { return fail(req, ctx, "VDC_UPLOAD_FO_FETCH_FAILED", 500, "Unable to load VDC FO numbers."); }
    const mapGroupById = new Map(mapGroups.map((row) => [text(row.id), row]));
    const externalFoByDcLine = new Map(dcLines.map((line) => {
      const allocation = allocationById.get(text(line.so_map_allocation_id));
      const mapGroup = allocation ? mapGroupById.get(text(allocation.map_group_id)) : undefined;
      return [text(line.id), text(mapGroup?.revised_external_fo_number) || text(mapGroup?.external_fo_number) || null];
    }));
    const pendingInvoices = invoiceRows.filter((invoice) => docById.has(text(invoice.dc_id)));
    // INDEPENDENT read-only grouping per DO; 10 at a time keeps a few hundred
    // pending DOs well inside the request budget.
    const groupsByInvoice = new Map<string, Awaited<ReturnType<typeof computeInvoiceGroups>>["groups"]>();
    for (let index = 0; index < pendingInvoices.length; index += 10) {
      const slice = pendingInvoices.slice(index, index + 10);
      const computed = await Promise.all(slice.map((invoice) => computeInvoiceGroups(text(invoice.dc_id))));
      slice.forEach((invoice, offset) => groupsByInvoice.set(text(invoice.id), computed[offset].groups));
    }
    const rows: JsonRecord[] = [];
    for (const invoice of pendingInvoices) {
      const dcId = text(invoice.dc_id); const dc = docById.get(dcId)!;
      for (const group of groupsByInvoice.get(text(invoice.id)) ?? []) for (const line of group.lines) rows.push({
        invoice_id: invoice.id, invoice_number: invoice.invoice_number, dc_id: dcId, dc_number: dc.dc_number,
        so_number: group.document_number, fo_number: externalFoByDcLine.get(text(line.dc_line_id)) || group.fo_number || null,
        ship_to: group.ship_to.name, sku: line.document_name || line.material_display || line.material_id,
        storage_location_id: line.storage_location_id, lr_date: dc.lr_date || null,
        truck_number: dc.vehicle_number || null, dispatch_date: dc.dispatch_date || null,
      });
    }
    const storageLocationIds = [...new Set(rows.map((row) => text(row.storage_location_id)).filter(Boolean))];
    let storageLocations: JsonRecord[];
    try {
      storageLocations = await fetchInChunks<JsonRecord>(storageLocationIds, (chunk) => serviceRoleClient.schema("erp_inventory").from("storage_location_master")
        .select("id, code, name").in("id", chunk));
    } catch { return fail(req, ctx, "VDC_UPLOAD_STORAGE_LOCATION_FETCH_FAILED", 500, "Unable to load Storage Locations."); }
    const storageById = new Map(storageLocations.map((row) => [text(row.id), row]));
    for (const row of rows) {
      const storage = storageById.get(text(row.storage_location_id));
      row.storage_location = storage ? [text(storage.code), text(storage.name)].filter(Boolean).join(" — ") : null;
    }
    return okResponse({ items: rows }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "VDC_UPLOAD_PENDING_FAILED"; return fail(req, ctx, code, 500, code); }
}

/**
 * Upload guard: for every FO / DO Number in the uploaded sheet, return the
 * Delivery Orders it resolves to and their state, so the drawer can tell the
 * user exactly why a row was not loaded (already dispatched, invoice not made
 * yet, not a DD DO, cancelled, not found) instead of silently ignoring it.
 */
export async function checkVdcTruckDispatchUploadHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const payload = await body(req);
    const companyId = text(payload.company_id);
    if (!companyId) return fail(req, ctx, "COMPANY_ID_REQUIRED", 400, "company_id is required.");
    const denied = await assertAccess(req, ctx, companyId, "VIEW"); if (denied) return denied;
    const foNumbers: string[] = [...new Set((Array.isArray(payload.fo_numbers) ? payload.fo_numbers as unknown[] : []).map((value) => text(value)).filter(Boolean))];
    const dcNumbers: string[] = [...new Set((Array.isArray(payload.dc_numbers) ? payload.dc_numbers as unknown[] : []).map((value) => text(value)).filter(Boolean))];

    const groupSelect = "id, external_fo_number, revised_external_fo_number, so:so_id(company_id)";
    const [byOriginal, byRevised, directDocs] = await Promise.all([
      fetchInChunks<JsonRecord>(foNumbers, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order_map_group")
        .select(groupSelect).eq("status", "ACTIVE").in("external_fo_number", chunk)),
      fetchInChunks<JsonRecord>(foNumbers, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order_map_group")
        .select(groupSelect).eq("status", "ACTIVE").in("revised_external_fo_number", chunk)),
      fetchInChunks<JsonRecord>(dcNumbers, (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan")
        .select("id, dc_number").eq("selling_company_id", companyId).in("dc_number", chunk)),
    ]);
    const groups = new Map<string, JsonRecord>();
    for (const group of [...byOriginal, ...byRevised]) {
      if (text((group.so as JsonRecord | null)?.company_id) === companyId) groups.set(text(group.id), group);
    }
    const allocations = await fetchInChunks<JsonRecord>([...groups.keys()], (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation")
      .select("id, map_group_id").in("map_group_id", chunk));
    const groupByAllocation = new Map(allocations.map((row) => [text(row.id), text(row.map_group_id)]));
    const lines = await fetchInChunks<JsonRecord>([...groupByAllocation.keys()], (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan_line")
      .select("dc_id, so_map_allocation_id").in("so_map_allocation_id", chunk));
    const dcIds = [...new Set([...lines.map((line) => text(line.dc_id)), ...directDocs.map((doc) => text(doc.id))].filter(Boolean))];
    const docs = await fetchInChunks<JsonRecord>(dcIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan")
      .select("id, dc_number, status, pgi_deferred, vehicle_number, dispatch_date, selling_company_id").in("id", chunk));
    const docById = new Map(docs.filter((doc) => text(doc.selling_company_id) === companyId).map((doc) => [text(doc.id), doc]));
    const view = (doc: JsonRecord) => ({
      dc_id: text(doc.id), dc_number: text(doc.dc_number), status: upper(doc.status), dd_flag: doc.pgi_deferred === true,
      truck_number: text(doc.vehicle_number) || null, dispatch_date: text(doc.dispatch_date) || null,
    });

    const foDocs = new Map<string, Map<string, JsonRecord>>();
    for (const line of lines) {
      const group = groups.get(groupByAllocation.get(text(line.so_map_allocation_id)) ?? "");
      const doc = docById.get(text(line.dc_id));
      if (!group || !doc) continue;
      for (const fo of [text(group.external_fo_number), text(group.revised_external_fo_number)].filter(Boolean)) {
        const bucket = foDocs.get(fo.toUpperCase()) ?? new Map<string, JsonRecord>();
        bucket.set(text(doc.id), view(doc));
        foDocs.set(fo.toUpperCase(), bucket);
      }
    }
    const fo_results = foNumbers.map((fo) => ({ fo_number: fo, delivery_orders: [...(foDocs.get(fo.toUpperCase())?.values() ?? [])] }));
    const do_results = dcNumbers.map((dcNumber) => {
      const doc = directDocs.find((row) => text(row.dc_number) === dcNumber);
      const full = doc ? docById.get(text(doc.id)) : undefined;
      return { dc_number: dcNumber, delivery_orders: full ? [view(full)] : [] };
    });
    return okResponse({ fo_results, do_results }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "VDC_UPLOAD_CHECK_FAILED"; return fail(req, ctx, code, 500, code); }
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
    let docs: JsonRecord[];
    try {
      docs = await fetchInChunks<JsonRecord>(dcIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan")
        .select("id, selling_company_id, status, pgi_deferred, is_bulk_uploaded, lr_date, dispatch_date").in("id", chunk));
    } catch { return fail(req, ctx, "VDC_UPLOAD_DO_NOT_FOUND", 404, "One or more pending VDC delivery orders no longer exist."); }
    if (docs.length !== dcIds.length) return fail(req, ctx, "VDC_UPLOAD_DO_NOT_FOUND", 404, "One or more pending VDC delivery orders no longer exist.");

    const results: JsonRecord[] = [];
    // DEPENDENT: each DO's PGI stock check must see the previous DO's issue.
    for (const dc of docs) {
      const dcId = text(dc.id); const row = byDcId.get(dcId)!; const companyId = text(dc.selling_company_id);
      const denied = await assertAccess(req, ctx, companyId, "EDIT"); if (denied) return denied;
      const truckNumber = text(row.truck_number); const dispatchDate = text(row.dispatch_date);
      if (dc.pgi_deferred !== true) {
        results.push({ dc_id: dcId, ok: false, code: "VDC_UPLOAD_NOT_DD", message: "Truck & Dispatch upload is only for DD delivery orders." }); continue;
      }
      if (upper(dc.status) === "DISPATCHED") {
        results.push({ dc_id: dcId, ok: false, code: "VDC_UPLOAD_ALREADY_DISPATCHED", message: `Already dispatched on ${text(dc.dispatch_date) || "an earlier date"}; the posted Dispatch Date cannot change.` }); continue;
      }
      if (upper(dc.status) !== "INVOICED") {
        results.push({ dc_id: dcId, ok: false, code: "VDC_UPLOAD_DO_NOT_PENDING", message: "Invoice is not made yet for this DO — post it in SO02 first." }); continue;
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
      let reused = false;
      for (const invoice of (invoices ?? []) as JsonRecord[]) {
        const internal = new Request(`http://internal/api/procurement/sales-invoices/${text(invoice.id)}/vdc-pgi-only`, { method: "POST" });
        const response = await completeVdcPgiOnlyHandler(internal, ctx, { doAccessChecked: true });
        if (!response.ok) { failed = (await response.json().catch(() => ({}))) as JsonRecord; break; }
      }
      // `complete_vdc_pgi_only_action` atomically changes DRAFT -> POSTED in
      // the same transaction as P601/reservation/DO completion. A concurrent
      // uploader can therefore lose that conditional transition even though
      // the first request completed safely. Reconcile against the durable
      // invoice states before reporting a failure; never re-run PGI here.
      if (failed && text(failed.code) === "VDC_PGI_ONLY_INVOICE_NOT_DRAFT") {
        const { data: currentInvoices, error: currentInvoiceError } = await serviceRoleClient
          .schema("erp_procurement").from("sales_invoice")
          .select("status").eq("dc_id", dcId);
        const allPosted = !currentInvoiceError
          && (currentInvoices ?? []).length > 0
          && ((currentInvoices ?? []) as JsonRecord[]).every((currentInvoice: JsonRecord) => upper(currentInvoice.status) === "POSTED");
        if (allPosted) {
          failed = null;
          reused = true;
        }
      }
      results.push(failed
        ? { dc_id: dcId, ok: false, code: text(failed.code) || "VDC_UPLOAD_PGI_FAILED", message: text(failed.message) || "PGI could not be posted; the row remains pending." }
        : { dc_id: dcId, ok: true, reused });
    }
    return okResponse({ results }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "VDC_UPLOAD_POST_FAILED"; return fail(req, ctx, code, 500, code); }
}
