/* Additive SO02 Bulk Posting queue for Bulk-DO-Upload records only. */
import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { todayIsoInKolkata } from "../../_shared/dateUtils.ts";
import { isManualDocumentDateWithinWindow } from "../../_shared/manualDocumentDateWindow.ts";
import { errorResponse, okResponse } from "../response.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { canMaintainSalesInvoice, computeInvoiceGroups, postPgiInvoiceGroupsHandler } from "./do_unified.handlers.ts";
import { completeVdcPgiOnlyHandler, createVdcInvoiceOnlyHandler } from "./vdc_invoice.handlers.ts";
import { computeBulkPostChecks, type BulkPostCheck } from "./bulk_post_checks.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = { context: Extract<ContextResolution, { status: "RESOLVED" }>; request_id: string; auth_user_id: string; roleCode: string; };
const BULK_POST_MAX_DOS = 100;
const text = (value: unknown) => String(value ?? "").trim();
const upper = (value: unknown) => text(value).toUpperCase();
const body = (req: Request) => req.json().catch(() => ({} as JsonRecord));
function fail(req: Request, ctx: ProcurementHandlerContext, code: string, status: number, message: string) { return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req); }
async function assertInvoiceAccess(req: Request, ctx: ProcurementHandlerContext, companyId: string, action: "VIEW" | "WRITE") {
  try { await assertCompanyScope(ctx, companyId); } catch { return fail(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company."); }
  if (!(await canMaintainSalesInvoice(ctx, companyId, action))) return fail(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, `You do not have Invoice/PGI ${action === "VIEW" ? "view" : "create"} access at this company.`);
  return null;
}

async function postPendingVdcPgi(req: Request, ctx: ProcurementHandlerContext, dcId: string): Promise<{ ok: boolean; code?: string; message?: string; }> {
  const { data: invoices, error } = await serviceRoleClient.schema("erp_procurement").from("sales_invoice")
    .select("id").eq("dc_id", dcId).eq("status", "DRAFT");
  if (error || !(invoices ?? []).length) {
    return { ok: false, code: "VDC_PGI_ONLY_INVOICE_NOT_FOUND", message: "No draft VDC invoice is available for PGI." };
  }
  for (const invoice of (invoices ?? []) as JsonRecord[]) {
    const inner = new Request(`http://internal/api/procurement/sales-invoices/${text(invoice.id)}/vdc-pgi-only`, { method: "POST" });
    const response = await completeVdcPgiOnlyHandler(inner, ctx);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({} as JsonRecord)) as JsonRecord;
      return { ok: false, code: text(payload.code) || "VDC_PGI_ONLY_POST_FAILED", message: text(payload.message) || "VDC PGI posting failed." };
    }
  }
  return { ok: true };
}

export async function listBulkPostingQueueHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const companyId = text(new URL(req.url).searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "COMPANY_ID_REQUIRED", 400, "company_id is required.");
    const denied = await assertInvoiceAccess(req, ctx, companyId, "VIEW"); if (denied) return denied;
    // §8E — CMP003 alone queued 803 bulk DOs on 2026-10-13: every id list
    // below is chunked (a single .in() overflowed the GET URL) and the DO
    // read itself is paged past PostgREST's 1000-row cap.
    let docs: JsonRecord[];
    try {
      docs = await fetchInChunks<JsonRecord>([companyId], (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan")
        .select("id, dc_number, dc_date, status, pgi_deferred, pre_invoice_tally_invoice_number, pre_invoice_tally_invoice_date, pre_invoice_inbound_number, transporter_id, transporter_name_freetext, lr_number, lr_date, vehicle_number, dispatch_date")
        .in("selling_company_id", chunk).eq("is_bulk_uploaded", true).eq("status", "CREATED").order("dc_date", { ascending: true }).order("id"));
    } catch {
      return fail(req, ctx, "BULK_POST_QUEUE_FETCH_FAILED", 500, "Unable to load the Bulk Posting queue.");
    }
    const rows = docs;
    const ids = rows.map((row) => text(row.id)).filter(Boolean);
    let lineRows: JsonRecord[];
    try {
      lineRows = await fetchInChunks<JsonRecord>(ids, (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan_line")
        .select("id, dc_id, line_number, material_id, quantity, pack_qty, pack_uom_code, uom_code, unit_value, display_rate, display_rate_basis, display_uom_code, gst_rate, gst_amount, line_total, so_line_id, so_map_allocation_id, storage_location_id")
        .in("dc_id", chunk).order("line_number").order("id"));
    } catch {
      return fail(req, ctx, "BULK_POST_QUEUE_LINES_FETCH_FAILED", 500, "Unable to load Bulk Posting lines.");
    }

    // The SO02 grid is commercial data, not merely a DO-line dump. Reuse the
    // same fresh grouping calculation that posting uses, so party/GST/rate
    // display can never drift from the eventual Invoice/PGI document.
    const groupsByDcLine = new Map<string, { group: Awaited<ReturnType<typeof computeInvoiceGroups>>["groups"][number]; line: Awaited<ReturnType<typeof computeInvoiceGroups>>["groups"][number]["lines"][number] }>();
    // INDEPENDENT per DO (§8B) — bounded parallelism instead of one DO after
    // another, which took minutes for a full bulk upload.
    let nextDoc = 0;
    const groupWorker = async () => {
      while (nextDoc < rows.length) {
        const doc = rows[nextDoc];
        nextDoc += 1;
        const { groups } = await computeInvoiceGroups(text(doc.id));
        for (const group of groups) for (const groupLine of group.lines) {
          groupsByDcLine.set(text(groupLine.dc_line_id), { group, line: groupLine });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(10, rows.length) }, groupWorker));

    const allocationIds = [...new Set(lineRows.map((line) => text(line.so_map_allocation_id)).filter(Boolean))];
    const { data: allocationRows, error: allocationError } = await fetchInChunks<JsonRecord>(allocationIds, (chunk) =>
      serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation").select("id, map_group_id").in("id", chunk))
      .then((data) => ({ data, error: null as unknown }), (err) => ({ data: [] as JsonRecord[], error: err as unknown }));
    if (allocationError) return fail(req, ctx, "BULK_POST_QUEUE_MAP_FETCH_FAILED", 500, "Unable to load SO Map references.");
    const allocationById = new Map(((allocationRows ?? []) as JsonRecord[]).map((row) => [text(row.id), row]));
    const mapGroupIds = [...new Set(((allocationRows ?? []) as JsonRecord[]).map((row) => text(row.map_group_id)).filter(Boolean))];
    const { data: mapGroups, error: mapGroupError } = await fetchInChunks<JsonRecord>(mapGroupIds, (chunk) =>
      serviceRoleClient.schema("erp_procurement").from("sales_order_map_group").select("id, external_fo_number, revised_external_fo_number").in("id", chunk))
      .then((data) => ({ data, error: null as unknown }), (err) => ({ data: [] as JsonRecord[], error: err as unknown }));
    if (mapGroupError) return fail(req, ctx, "BULK_POST_QUEUE_FO_FETCH_FAILED", 500, "Unable to load External FO numbers.");
    const mapGroupById = new Map(((mapGroups ?? []) as JsonRecord[]).map((row) => [text(row.id), row]));

    const soIds = [...new Set([...groupsByDcLine.values()].map(({ group }) => text(group.so_id)).filter(Boolean))];
    const { data: soRows, error: soError } = await fetchInChunks<JsonRecord>(soIds, (chunk) =>
      serviceRoleClient.schema("erp_procurement").from("sales_order").select("id, vendor_code_id").in("id", chunk))
      .then((data) => ({ data, error: null as unknown }), (err) => ({ data: [] as JsonRecord[], error: err as unknown }));
    if (soError) return fail(req, ctx, "BULK_POST_QUEUE_SO_FETCH_FAILED", 500, "Unable to load Sales Order references.");
    const soById = new Map(((soRows ?? []) as JsonRecord[]).map((row) => [text(row.id), row]));
    const vendorCodeIds = [...new Set(((soRows ?? []) as JsonRecord[]).map((row) => text(row.vendor_code_id)).filter(Boolean))];
    const { data: vendorRows, error: vendorError } = vendorCodeIds.length
      ? await serviceRoleClient.schema("erp_production").from("vendor_code_master").select("id, vendor_code, description").in("id", vendorCodeIds)
      : { data: [] as JsonRecord[], error: null };
    if (vendorError) return fail(req, ctx, "BULK_POST_QUEUE_VENDOR_FETCH_FAILED", 500, "Unable to load Vendor Codes.");
    const vendorById = new Map(((vendorRows ?? []) as JsonRecord[]).map((row) => [text(row.id), row]));

    const transporterIds = [...new Set(rows.map((row) => text(row.transporter_id)).filter(Boolean))];
    const { data: transporterRows, error: transporterError } = transporterIds.length
      ? await serviceRoleClient.schema("erp_master").from("transporter_master").select("id, transporter_code, transporter_name").in("id", transporterIds)
      : { data: [] as JsonRecord[], error: null };
    if (transporterError) return fail(req, ctx, "BULK_POST_QUEUE_TRANSPORTER_FETCH_FAILED", 500, "Unable to load Transporter details.");
    const transporterById = new Map(((transporterRows ?? []) as JsonRecord[]).map((row) => [text(row.id), row]));
    // Cross-check fields: the upload sheet identifies the item by its SKU
    // (external) code and the location by its code, so show exactly those.
    const materialIds = [...new Set(lineRows.map((line) => text(line.material_id)).filter(Boolean))];
    const locationIds = [...new Set(lineRows.map((line) => text(line.storage_location_id)).filter(Boolean))];
    let materialById = new Map<string, JsonRecord>();
    let locationById = new Map<string, JsonRecord>();
    try {
      const [materialRows, locationRows] = await Promise.all([
        fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient.schema("erp_master").from("material_master")
          .select("id, pace_code, external_code, material_name, document_name").in("id", chunk)),
        fetchInChunks<JsonRecord>(locationIds, (chunk) => serviceRoleClient.schema("erp_inventory").from("storage_location_master")
          .select("id, code, name").in("id", chunk)),
      ]);
      materialById = new Map(materialRows.map((row) => [text(row.id), row]));
      locationById = new Map(locationRows.map((row) => [text(row.id), row]));
    } catch {
      return fail(req, ctx, "BULK_POST_QUEUE_MATERIAL_FETCH_FAILED", 500, "Unable to load SKU / storage location details.");
    }
    const { data: companyRow, error: companyError } = await serviceRoleClient.schema("erp_master").from("companies").select("company_code").eq("id", companyId).maybeSingle();
    if (companyError) return fail(req, ctx, "BULK_POST_QUEUE_COMPANY_FETCH_FAILED", 500, "Unable to load Company Code.");
    const companyCode = text(companyRow?.company_code) || null;

    const items = lineRows.map((rawLine) => {
      const doc = rows.find((row) => text(row.id) === text(rawLine.dc_id)) ?? {};
      const grouping = groupsByDcLine.get(text(rawLine.id));
      const group = grouping?.group;
      const line = grouping?.line;
      const allocation = allocationById.get(text(rawLine.so_map_allocation_id));
      const mapGroup = allocation ? mapGroupById.get(text(allocation.map_group_id)) : undefined;
      const vendor = group ? vendorById.get(text(soById.get(text(group.so_id))?.vendor_code_id)) : undefined;
      const transporter = transporterById.get(text(doc.transporter_id));
      const isVdc = doc.pgi_deferred === true;
      const hasTruckAndDispatch = Boolean(text(doc.vehicle_number) && text(doc.dispatch_date));
      const postingAction = !isVdc
        ? "PGI + Invoice"
        : (hasTruckAndDispatch ? "Invoice + PGI" : "Invoice only");
      return {
        ...doc,
        ...rawLine,
        // The line's own `id` must not replace the DO id: the page selects
        // and posts DOs by `id` (a line id here made Bulk Post 404).
        id: text(doc.id),
        line_id: text(rawLine.id),
        dd_flag: doc.pgi_deferred === true,
        posting_action: postingAction,
        postable: true,
        so_number: group?.document_number ?? null,
        fo_number: text(mapGroup?.revised_external_fo_number) || text(mapGroup?.external_fo_number) || group?.fo_number || null,
        external_so_number: group?.customer_po_number ?? null,
        company_code: companyCode,
        vendor_code: vendor ? [text(vendor.vendor_code), text(vendor.description)].filter(Boolean).join(" — ") : null,
        sku: line?.document_name || line?.material_display || null,
        sku_code: text(materialById.get(text(rawLine.material_id))?.external_code) || text(materialById.get(text(rawLine.material_id))?.material_name) || null,
        pace_code: text(materialById.get(text(rawLine.material_id))?.pace_code) || null,
        document_name: text(materialById.get(text(rawLine.material_id))?.document_name) || text(materialById.get(text(rawLine.material_id))?.material_name) || null,
        storage_location_code: text(locationById.get(text(rawLine.storage_location_id))?.code) || null,
        pack_qty: line?.pack_qty ?? rawLine.pack_qty ?? null,
        pack_uom_code: line?.pack_uom_code ?? rawLine.pack_uom_code ?? null,
        base_qty: line?.quantity ?? rawLine.quantity ?? null,
        rate: line?.display_rate ?? line?.unit_value ?? rawLine.display_rate ?? rawLine.unit_value ?? null,
        rate_basis: line?.display_rate_basis ?? rawLine.display_rate_basis ?? null,
        rate_uom_code: line?.display_uom_code ?? rawLine.display_uom_code ?? line?.uom_code ?? rawLine.uom_code ?? null,
        gst_split: group?.gst_type ?? null,
        gst_rate: line?.gst_rate ?? rawLine.gst_rate ?? null,
        value: line?.line_total ?? rawLine.line_total ?? null,
        round_off: group?.so_round_off_amount ?? null,
        parent_company: group?.parent_company_display ?? null,
        bill_to: group?.bill_to?.name ?? null,
        bill_to_address: group?.bill_to?.address ?? null,
        bill_to_gst_number: group?.bill_to?.gst_number ?? null,
        ship_to: group?.ship_to?.name ?? null,
        ship_to_address: group?.ship_to?.address ?? null,
        ship_to_state: group?.ship_to?.state ?? null,
        ship_to_gst_number: group?.ship_to?.gst_number ?? null,
        transporter: transporter ? [text(transporter.transporter_code), text(transporter.transporter_name)].filter(Boolean).join(" — ") : text(doc.transporter_name_freetext) || null,
      };
    });
    let checksByDc = new Map<string, BulkPostCheck[]>();
    try {
      const transporterLabelById = new Map([...transporterById.entries()].map(([id, row]) => [id, [text(row.transporter_code), text(row.transporter_name)].filter(Boolean).join(" — ")]));
      checksByDc = await computeBulkPostChecks(companyId,
        rows.map((doc) => ({ ...doc, transporter_label: transporterLabelById.get(text(doc.transporter_id)) ?? null })),
        items);
    } catch (checkError) {
      // The checks are advisory; a failure must not hide the queue itself.
      console.error("[bulk_post] suspicious-data checks failed", checkError);
    }
    const itemsWithChecks = items.map((item) => ({ ...item, checks: checksByDc.get(text(item.id)) ?? [] }));
    return okResponse({ items: itemsWithChecks }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "BULK_POST_QUEUE_FAILED"; return fail(req, ctx, code, 500, code); }
}

export async function bulkPostDeliveryOrdersHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const payload = await body(req);
    const ids: string[] = [...new Set((Array.isArray(payload.dc_ids) ? payload.dc_ids as unknown[] : []).map((value) => text(value)).filter(Boolean))];
    if (!ids.length) return fail(req, ctx, "BULK_POST_SELECTION_REQUIRED", 400, "Select at least one delivery order.");
    // Each DO posts atomically one after another (stock checks must see the
    // previous DO's issue), so one request must stay bounded or it outlives
    // the HTTP timeout part-way through. 100 DOs per click.
    if (ids.length > BULK_POST_MAX_DOS) return fail(req, ctx, "BULK_POST_LIMIT", 400, `Select at most ${BULK_POST_MAX_DOS} delivery orders per Bulk Post.`);
    const { data: docs, error } = await fetchInChunks<JsonRecord>(ids, (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan")
      .select("id, selling_company_id, pgi_deferred, is_bulk_uploaded, status, pre_invoice_tally_invoice_number, pre_invoice_tally_invoice_date, pre_invoice_inbound_number, vehicle_number, dispatch_date")
      .in("id", chunk))
      .then((data) => ({ data, error: null as unknown }), (err) => ({ data: [] as JsonRecord[], error: err as unknown }));
    if (error || (docs ?? []).length !== ids.length) return fail(req, ctx, "BULK_POST_DO_NOT_FOUND", 404, "One or more selected delivery orders no longer exist.");
    const results: JsonRecord[] = [];
    // DEPENDENT: each DO's PGI stock check must see the previous DO's issue.
    for (const doc of (docs ?? []) as JsonRecord[]) {
      const dcId = text(doc.id); const companyId = text(doc.selling_company_id);
      const denied = await assertInvoiceAccess(req, ctx, companyId, "WRITE"); if (denied) return denied;
      const isDeferredVdc = doc.pgi_deferred === true;
      if (doc.is_bulk_uploaded !== true || upper(doc.status) !== "CREATED") {
        results.push({ dc_id: dcId, ok: false, code: "BULK_POST_DO_NOT_READY", message: "Delivery order is not ready for this SO02 posting action." });
        continue;
      }
      if (isDeferredVdc) {
        const inner = new Request(`http://internal/api/procurement/delivery-orders-v2/${dcId}/vdc-invoice-only`, { method: "POST" });
        const response = await createVdcInvoiceOnlyHandler(inner, ctx);
        const payload = await response.json().catch(() => ({} as JsonRecord)) as JsonRecord;
        if (!response.ok) {
          results.push({ dc_id: dcId, ok: false, mode: "VDC_INVOICE_ONLY", code: text(payload.code) || "VDC_INVOICE_ONLY_POST_FAILED", message: text(payload.message) || "Invoice-only posting failed." });
          continue;
        }
        // DD/VDC DO creation never moves stock. When the source upload already
        // supplied both physical fields, SO02—not SO03—performs the follow-up
        // PGI immediately after the Invoice-only record exists.
        if (text(doc.vehicle_number) && text(doc.dispatch_date)) {
          const pgiResult = await postPendingVdcPgi(req, ctx, dcId);
          results.push(pgiResult.ok
            ? { dc_id: dcId, ok: true, mode: "VDC_INVOICE_PGI" }
            : { dc_id: dcId, ok: false, mode: "VDC_INVOICE_PGI", code: pgiResult.code, message: pgiResult.message || "Invoice was created, but PGI remains pending in SO02." });
        } else {
          results.push({ dc_id: dcId, ok: true, mode: "VDC_INVOICE_ONLY", ...payload });
        }
      } else {
        const { groups } = await computeInvoiceGroups(dcId);
        const tallyNumber = text(doc.pre_invoice_tally_invoice_number); const tallyDate = text(doc.pre_invoice_tally_invoice_date);
        if (!tallyNumber || !tallyDate) {
          results.push({ dc_id: dcId, ok: false, mode: "DC_ATOMIC_PGI_INVOICE", code: "BULK_POST_TALLY_FIELDS_REQUIRED", message: "Tally Invoice Number and Date are required." });
          continue;
        }
        const inner = new Request(`http://internal/api/procurement/delivery-orders-v2/${dcId}/pgi-invoice-groups`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groups: groups.map((group) => ({ group_key: group.group_key, tally_invoice_number: tallyNumber, tally_invoice_date: tallyDate, inbound_number: text(doc.pre_invoice_inbound_number) || undefined, round_off_amount: group.so_round_off_amount })) }) });
        const response = await postPgiInvoiceGroupsHandler(inner, ctx);
        const payload = await response.json().catch(() => ({} as JsonRecord)) as JsonRecord;
        results.push(response.ok
          ? { dc_id: dcId, ok: true, mode: "DC_ATOMIC_PGI_INVOICE", ...payload }
          : { dc_id: dcId, ok: false, mode: "DC_ATOMIC_PGI_INVOICE", code: text(payload.code) || "DC_ATOMIC_POST_FAILED", message: text(payload.message) || "Atomic PGI and Invoice posting failed." });
      }
    }
    return okResponse({ results }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "BULK_POST_FAILED"; return fail(req, ctx, code, 500, code); }
}


// ---------------------------------------------------------------------------
// Corrections. The user exports the queue, checks it against Tally, edits the
// sheet and uploads it back. Header details are corrected in place on the
// still-unposted DO; an item-level change (SKU, Pack Qty, Storage Location,
// FO/SO) is not edited here -- it changes stock, allocation and value, so that
// DO must be cancelled and uploaded again through SO03's Bulk DO Upload.
// ---------------------------------------------------------------------------
type CorrectionRow = {
  excel_row?: number;
  dc_number?: string;
  fo_or_so_number?: string;
  do_date?: string;
  transporter_name?: string;
  lr_number?: string;
  lr_date?: string;
  sku?: string;
  pack_qty?: number | string;
  storage_location_code?: string;
  tally_invoice_number?: string;
  tally_invoice_date?: string;
  inbound_number?: string;
  truck_number?: string;
  dispatch_date?: string;
};

const HEADER_FIELDS: Array<{ key: keyof CorrectionRow; column: string; label: string; kind?: "date" }> = [
  { key: "do_date", column: "dc_date", label: "DO Date", kind: "date" },
  { key: "lr_number", column: "lr_number", label: "LR Number" },
  { key: "lr_date", column: "lr_date", label: "LR Date", kind: "date" },
  { key: "tally_invoice_number", column: "pre_invoice_tally_invoice_number", label: "Tally Invoice Number" },
  { key: "tally_invoice_date", column: "pre_invoice_tally_invoice_date", label: "Tally Invoice Date", kind: "date" },
  { key: "inbound_number", column: "pre_invoice_inbound_number", label: "Inbound Number" },
  { key: "truck_number", column: "vehicle_number", label: "Truck Number" },
  { key: "dispatch_date", column: "dispatch_date", label: "Dispatch Date", kind: "date" },
];
const isIso = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const sameText = (a: unknown, b: unknown) => text(a).replace(/\s+/g, " ").toUpperCase() === text(b).replace(/\s+/g, " ").toUpperCase();

type PendingCorrection = { base: JsonRecord; doc: JsonRecord; patch: JsonRecord; changes: string[] };

async function findCorrectionDuplicates(companyId: string, pending: PendingCorrection[]): Promise<Map<string, { errors: string[]; warnings: string[] }>> {
  const out = new Map<string, { errors: string[]; warnings: string[] }>();
  const add = (id: string, kind: "errors" | "warnings", message: string) => {
    const entry = out.get(id) ?? { errors: [], warnings: [] };
    if (!entry[kind].includes(message)) entry[kind].push(message);
    out.set(id, entry);
  };
  const key = (value: unknown) => text(value).replace(/\s+/g, " ").toUpperCase();
  // Value each corrected DO will have after this upload (patch wins over current).
  const after = (entry: PendingCorrection, column: string) => key(column in entry.patch ? entry.patch[column] : entry.doc[column]);
  const pendingById = new Map(pending.map((entry) => [text(entry.doc.id), entry]));
  const changing = (column: string) => pending.filter((entry) => column in entry.patch && key(entry.patch[column]));
  const tallyChanges = changing("pre_invoice_tally_invoice_number");
  const inboundChanges = changing("pre_invoice_inbound_number");
  const lrChanges = pending.filter((entry) => ("lr_number" in entry.patch || "transporter_id" in entry.patch) && after(entry, "lr_number"));
  if (!tallyChanges.length && !inboundChanges.length && !lrChanges.length) return out;

  const rawValues = (list: PendingCorrection[], column: string) => [...new Set(list.map((entry) => text(column in entry.patch ? entry.patch[column] : entry.doc[column])).filter(Boolean))];
  const doSelect = "id, dc_number, status, transporter_id, lr_number, pre_invoice_tally_invoice_number, pre_invoice_inbound_number";
  const doQuery = (column: string) => (chunk: string[]) => serviceRoleClient.schema("erp_procurement").from("delivery_challan")
    .select(doSelect).eq("selling_company_id", companyId).neq("status", "CANCELLED").in(column, chunk);
  const invoiceQuery = (column: string) => (chunk: string[]) => serviceRoleClient.schema("erp_procurement").from("sales_invoice")
    .select(`id, dc_id, invoice_number, ${column}`).neq("status", "CANCELLED").in(column, chunk);
  const [doByTally, doByInbound, doByLr, invByTally, invByInbound] = await Promise.all([
    fetchInChunks<JsonRecord>(rawValues(tallyChanges, "pre_invoice_tally_invoice_number"), doQuery("pre_invoice_tally_invoice_number")),
    fetchInChunks<JsonRecord>(rawValues(inboundChanges, "pre_invoice_inbound_number"), doQuery("pre_invoice_inbound_number")),
    fetchInChunks<JsonRecord>(rawValues(lrChanges, "lr_number"), doQuery("lr_number")),
    fetchInChunks<JsonRecord>(rawValues(tallyChanges, "pre_invoice_tally_invoice_number"), invoiceQuery("tally_invoice_number")),
    fetchInChunks<JsonRecord>(rawValues(inboundChanges, "pre_invoice_inbound_number"), invoiceQuery("inbound_number")),
  ]);
  // Invoices can belong to another company — keep only this company's DOs.
  const invoiceDcIds = [...new Set([...invByTally, ...invByInbound].map((row) => text(row.dc_id)).filter(Boolean))];
  const invoiceDcs = await fetchInChunks<JsonRecord>(invoiceDcIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan")
    .select("id, dc_number, selling_company_id").in("id", chunk));
  const invoiceDcById = new Map(invoiceDcs.filter((row) => text(row.selling_company_id) === companyId).map((row) => [text(row.id), row]));

  const check = (list: PendingCorrection[], column: string, label: string, dbRows: JsonRecord[], invoices: JsonRecord[], invoiceColumn: string | null, kind: "errors" | "warnings", sameScope: (a: PendingCorrection, other: JsonRecord) => boolean) => {
    for (const entry of list) {
      const id = text(entry.doc.id);
      const value = after(entry, column);
      // Other DOs in this same file, using their corrected values.
      for (const other of pending) {
        if (text(other.doc.id) === id || after(other, column) !== value || !sameScope(entry, other.doc)) continue;
        add(id, kind, `${label} ${value} is also given to DO ${text(other.doc.dc_number)} in this file`);
      }
      // DOs already in the system (a DO in this file is judged by its corrected value instead).
      for (const row of dbRows) {
        if (text(row.id) === id || pendingById.has(text(row.id)) || key(row[column]) !== value || !sameScope(entry, row)) continue;
        add(id, kind, `${label} ${value} is already on DO ${text(row.dc_number)} (${text(row.status)})`);
      }
      if (!invoiceColumn) continue;
      for (const invoice of invoices) {
        const dc = invoiceDcById.get(text(invoice.dc_id));
        if (!dc || text(invoice.dc_id) === id || key(invoice[invoiceColumn]) !== value) continue;
        add(id, kind, `${label} ${value} is already on invoice ${text(invoice.invoice_number)} (DO ${text(dc.dc_number)})`);
      }
    }
  };
  const anyScope = () => true;
  const transporterOf = (entry: PendingCorrection) => text("transporter_id" in entry.patch ? entry.patch.transporter_id : entry.doc.transporter_id);
  const sameTransporter = (entry: PendingCorrection, other: JsonRecord) => {
    const otherPending = pendingById.get(text(other.id));
    return transporterOf(entry) === (otherPending ? transporterOf(otherPending) : text(other.transporter_id));
  };
  check(tallyChanges, "pre_invoice_tally_invoice_number", "Tally Invoice", doByTally, invByTally, "tally_invoice_number", "errors", anyScope);
  check(inboundChanges, "pre_invoice_inbound_number", "Inbound Number", doByInbound, invByInbound, "inbound_number", "errors", anyScope);
  check(lrChanges, "lr_number", "LR (same transporter)", doByLr, [], null, "warnings", sameTransporter);
  return out;
}

export async function bulkPostingCorrectionsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const payload = await body(req);
    const companyId = text(payload.company_id);
    const apply = payload.apply === true;
    if (!companyId) return fail(req, ctx, "COMPANY_ID_REQUIRED", 400, "company_id is required.");
    const denied = await assertInvoiceAccess(req, ctx, companyId, "WRITE"); if (denied) return denied;
    const rows = (Array.isArray(payload.rows) ? payload.rows : []) as CorrectionRow[];
    if (!rows.length) return fail(req, ctx, "BULK_CORRECTION_ROWS_REQUIRED", 400, "The correction file has no rows.");

    const dcNumbers = [...new Set(rows.map((row) => text(row.dc_number)).filter(Boolean))];
    const docs = await fetchInChunks<JsonRecord>(dcNumbers, (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan")
      .select("id, dc_number, status, is_bulk_uploaded, selling_company_id, dc_date, transporter_id, lr_number, lr_date, vehicle_number, dispatch_date, pre_invoice_tally_invoice_number, pre_invoice_tally_invoice_date, pre_invoice_inbound_number")
      .in("dc_number", chunk));
    const docByNumber = new Map(docs.filter((doc) => text(doc.selling_company_id) === companyId).map((doc) => [text(doc.dc_number), doc]));
    const dcIds = [...docByNumber.values()].map((doc) => text(doc.id));
    const lines = await fetchInChunks<JsonRecord>(dcIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan_line")
      .select("id, dc_id, material_id, pack_qty, storage_location_id, so_map_allocation_id").in("dc_id", chunk));
    const materialIds = [...new Set(lines.map((line) => text(line.material_id)).filter(Boolean))];
    const locationIds = [...new Set(lines.map((line) => text(line.storage_location_id)).filter(Boolean))];
    const allocationIds = [...new Set(lines.map((line) => text(line.so_map_allocation_id)).filter(Boolean))];
    const [materials, locations, allocations, transporters] = await Promise.all([
      fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient.schema("erp_master").from("material_master").select("id, external_code, material_name").in("id", chunk)),
      fetchInChunks<JsonRecord>(locationIds, (chunk) => serviceRoleClient.schema("erp_inventory").from("storage_location_master").select("id, code").in("id", chunk)),
      fetchInChunks<JsonRecord>(allocationIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation")
        .select("id, map_group:map_group_id(external_fo_number, revised_external_fo_number)").in("id", chunk)),
      serviceRoleClient.schema("erp_master").from("transporter_master").select("id, transporter_code, transporter_name").eq("active", true)
        .then(({ data }) => (data ?? []) as JsonRecord[]),
    ]);
    const skuByMaterial = new Map(materials.map((row) => [text(row.id), text(row.external_code) || text(row.material_name)]));
    const locationCodeById = new Map(locations.map((row) => [text(row.id), text(row.code)]));
    const foByAllocation = new Map(allocations.map((row) => {
      const group = (row.map_group ?? {}) as JsonRecord;
      return [text(row.id), [text(group.external_fo_number), text(group.revised_external_fo_number)].filter(Boolean)];
    }));
    const linesByDc = new Map<string, JsonRecord[]>();
    for (const line of lines) linesByDc.set(text(line.dc_id), [...(linesByDc.get(text(line.dc_id)) ?? []), line]);
    const transporterById = new Map(transporters.map((row) => [text(row.id), row]));
    const resolveTransporter = (name: string): JsonRecord | null | "AMBIGUOUS" => {
      const target = text(name).toUpperCase();
      if (!target) return null;
      const exact = transporters.filter((row) => text(row.transporter_code).toUpperCase() === target || text(row.transporter_name).toUpperCase() === target);
      if (exact.length === 1) return exact[0];
      const partial = transporters.filter((row) => text(row.transporter_name).toUpperCase().includes(target));
      if (partial.length === 1) return partial[0];
      return partial.length > 1 || exact.length > 1 ? "AMBIGUOUS" : null;
    };

    const rowsByDc = new Map<string, CorrectionRow[]>();
    for (const row of rows) {
      const key = text(row.dc_number);
      rowsByDc.set(key, [...(rowsByDc.get(key) ?? []), row]);
    }
    const results: JsonRecord[] = [];
    const pending: PendingCorrection[] = [];
    const today = todayIsoInKolkata();
    for (const [dcNumber, dcRows] of rowsByDc) {
      const excelRows = dcRows.map((row) => row.excel_row).filter((value) => value != null);
      const base = { dc_number: dcNumber || null, excel_rows: excelRows, fo_or_so_number: text(dcRows[0].fo_or_so_number) || null };
      const doc = docByNumber.get(dcNumber);
      if (!dcNumber || !doc) { results.push({ ...base, status: "NOT_FOUND", message: dcNumber ? "DO Number not found in this company." : "DO Number column is blank — keep the exported DO Number on every row." }); continue; }
      if (doc.is_bulk_uploaded !== true || upper(doc.status) !== "CREATED") {
        results.push({ ...base, status: "NOT_EDITABLE", message: `DO is ${text(doc.status)} — only an unposted Bulk-DO-Upload DO can be corrected here.` });
        continue;
      }
      const errors: string[] = [];
      // Item-level comparison: the sheet's lines must be exactly this DO's lines.
      const currentLines = (linesByDc.get(text(doc.id)) ?? []).map((line) => ({
        sku: skuByMaterial.get(text(line.material_id)) ?? "",
        pack_qty: Number(line.pack_qty ?? 0),
        location: locationCodeById.get(text(line.storage_location_id)) ?? "",
        fos: foByAllocation.get(text(line.so_map_allocation_id)) ?? [],
      }));
      const itemChanges: string[] = [];
      const unmatched = [...currentLines];
      // The same SKU twice for one DO: identical copies are ignored, differing copies are an error.
      const seenSku = new Map<string, string>();
      const uniqueRows: CorrectionRow[] = [];
      for (const row of dcRows) {
        const skuKey = text(row.sku).toUpperCase();
        const signature = JSON.stringify({ ...row, excel_row: null });
        if (seenSku.has(skuKey)) {
          if (seenSku.get(skuKey) !== signature) errors.push(`SKU ${text(row.sku)} appears more than once for this DO with different values (Excel row ${text(row.excel_row)})`);
          continue;
        }
        seenSku.set(skuKey, signature);
        uniqueRows.push(row);
      }
      for (const row of uniqueRows) {
        const index = unmatched.findIndex((line) => sameText(line.sku, row.sku));
        if (index < 0) { itemChanges.push(`SKU ${text(row.sku) || "(blank)"} is not on this DO`); continue; }
        const line = unmatched.splice(index, 1)[0];
        if (text(row.pack_qty) && Math.abs(line.pack_qty - (Number(row.pack_qty) || 0)) > 0.0001) itemChanges.push(`SKU ${line.sku}: Pack Qty ${line.pack_qty} → ${text(row.pack_qty)}`);
        if (text(row.storage_location_code) && !sameText(line.location, row.storage_location_code)) itemChanges.push(`SKU ${line.sku}: Storage Location ${line.location} → ${text(row.storage_location_code)}`);
        if (text(row.fo_or_so_number) && line.fos.length && !line.fos.some((fo) => sameText(fo, row.fo_or_so_number))) itemChanges.push(`SKU ${line.sku}: FO ${line.fos[0]} → ${text(row.fo_or_so_number)}`);
      }
      // Lines left out of the file are simply untouched — users may delete rows they do not need to correct.

      // Header fields: the filled-in rows of one DO must agree (a blank cell means "unchanged", never a conflict).
      const header = {} as CorrectionRow;
      for (const field of [...HEADER_FIELDS.map((entry) => entry.key), "transporter_name" as keyof CorrectionRow]) {
        const filled = dcRows.map((row) => text(row[field])).filter(Boolean);
        if (new Set(filled.map((value) => value.toUpperCase())).size > 1) errors.push(`Rows of this DO disagree on ${field.replace(/_/g, " ")}`);
        (header as Record<string, unknown>)[field] = filled[0] ?? "";
      }
      const patch: JsonRecord = {};
      const changes: string[] = [];
      for (const field of HEADER_FIELDS) {
        const next = text(header[field.key]);
        const current = text(doc[field.column]);
        if (!next) continue; // a blank cell never erases existing data
        if (field.kind === "date" && !isIso(next)) { errors.push(`${field.label} "${next}" is not a valid date`); continue; }
        if (field.kind === "date" ? next !== current.slice(0, 10) : !sameText(next, current)) {
          patch[field.column] = next;
          changes.push(`${field.label}: ${current || "—"} → ${next}`);
        }
      }
      const transporterName = text(header.transporter_name);
      if (transporterName) {
        const currentTransporter = transporterById.get(text(doc.transporter_id));
        const currentLabel = currentTransporter ? text(currentTransporter.transporter_name) : "";
        const sameAsCurrent = currentTransporter && (sameText(currentTransporter.transporter_code, transporterName) || text(currentTransporter.transporter_name).toUpperCase().includes(transporterName.toUpperCase()));
        if (!sameAsCurrent) {
          const resolved = resolveTransporter(transporterName);
          if (resolved === "AMBIGUOUS") errors.push(`Transporter "${transporterName}" matches more than one Transporter Master entry`);
          else if (!resolved) errors.push(`Transporter "${transporterName}" is not in Transporter Master`);
          else { patch.transporter_id = text(resolved.id); changes.push(`Transporter: ${currentLabel || "—"} → ${text(resolved.transporter_name)}`); }
        }
      }
      const effective = (column: string) => text(patch[column] ?? doc[column]).slice(0, 10);
      for (const column of ["dc_date", "lr_date", "pre_invoice_tally_invoice_date"]) {
        if (patch[column] && !isManualDocumentDateWithinWindow(text(patch[column]))) errors.push(`${column === "dc_date" ? "DO Date" : column === "lr_date" ? "LR Date" : "Tally Invoice Date"} must be within three months of today`);
      }
      if (effective("dispatch_date") && effective("lr_date") && effective("dispatch_date") < effective("lr_date")) errors.push("Dispatch Date is before LR Date");
      if (patch.dispatch_date && text(patch.dispatch_date) > today) errors.push("Dispatch Date is in the future");
      if (patch.vehicle_number && text(patch.vehicle_number).length < 4) errors.push("Truck Number must have at least 4 characters");

      if (itemChanges.length) {
        results.push({ ...base, status: "NEEDS_REUPLOAD", changes, message: `Item change — cancel this DO and upload it again in SO03: ${itemChanges.join("; ")}` });
        continue;
      }
      if (errors.length) { results.push({ ...base, status: "ERROR", changes, message: errors.join("; ") }); continue; }
      if (!changes.length) { results.push({ ...base, status: "UNCHANGED", changes: [], message: "No change" }); continue; }
      pending.push({ base, doc, patch, changes });
    }

    // Duplicate check on the values a correction would write: the same Tally
    // Invoice / Inbound Number on another DO or invoice blocks the correction
    // (1 DO = 1 invoice); the same LR of the same transporter is a warning.
    const duplicates = await findCorrectionDuplicates(companyId, pending);
    for (const entry of pending) {
      const found = duplicates.get(text(entry.doc.id)) ?? { errors: [], warnings: [] };
      if (found.errors.length) {
        results.push({ ...entry.base, status: "ERROR", changes: entry.changes, message: `Duplicate: ${found.errors.join("; ")}` });
        continue;
      }
      if (apply) {
        const { error } = await serviceRoleClient.schema("erp_procurement").from("delivery_challan")
          .update(entry.patch).eq("id", text(entry.doc.id)).eq("status", "CREATED");
        if (error) { results.push({ ...entry.base, status: "ERROR", changes: entry.changes, message: "Unable to save this DO's correction." }); continue; }
        results.push({ ...entry.base, status: "UPDATED", changes: entry.changes, warnings: found.warnings, message: entry.changes.join("; ") });
      } else {
        results.push({ ...entry.base, status: "WILL_UPDATE", changes: entry.changes, warnings: found.warnings, message: entry.changes.join("; ") });
      }
    }
    return okResponse({ results, applied: apply }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "BULK_CORRECTION_FAILED";
    return fail(req, ctx, code, 500, code);
  }
}
