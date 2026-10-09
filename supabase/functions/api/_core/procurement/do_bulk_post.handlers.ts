/* Additive SO02 Bulk Posting queue for Bulk-DO-Upload records only. */
import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { errorResponse, okResponse } from "../response.ts";
import { canMaintainSalesInvoice, computeInvoiceGroups, postPgiInvoiceGroupsHandler } from "./do_unified.handlers.ts";
import { createVdcInvoiceOnlyHandler } from "./vdc_invoice.handlers.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = { context: Extract<ContextResolution, { status: "RESOLVED" }>; request_id: string; auth_user_id: string; roleCode: string; };
const text = (value: unknown) => String(value ?? "").trim();
const upper = (value: unknown) => text(value).toUpperCase();
const body = (req: Request) => req.json().catch(() => ({} as JsonRecord));
function fail(req: Request, ctx: ProcurementHandlerContext, code: string, status: number, message: string) { return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req); }
async function assertInvoiceAccess(req: Request, ctx: ProcurementHandlerContext, companyId: string, action: "VIEW" | "WRITE") {
  try { await assertCompanyScope(ctx, companyId); } catch { return fail(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company."); }
  if (!(await canMaintainSalesInvoice(ctx, companyId, action))) return fail(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, `You do not have Invoice/PGI ${action === "VIEW" ? "view" : "create"} access at this company.`);
  return null;
}

export async function listBulkPostingQueueHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const companyId = text(new URL(req.url).searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "COMPANY_ID_REQUIRED", 400, "company_id is required.");
    const denied = await assertInvoiceAccess(req, ctx, companyId, "VIEW"); if (denied) return denied;
    const { data: docs, error } = await serviceRoleClient.schema("erp_procurement").from("delivery_challan")
      .select("id, dc_number, dc_date, pgi_deferred, pre_invoice_tally_invoice_number, pre_invoice_tally_invoice_date, pre_invoice_inbound_number, transporter_id, transporter_name_freetext, lr_number, lr_date, vehicle_number, dispatch_date")
      .eq("selling_company_id", companyId).eq("is_bulk_uploaded", true).eq("status", "CREATED").order("dc_date", { ascending: true });
    if (error) return fail(req, ctx, "BULK_POST_QUEUE_FETCH_FAILED", 500, error.message || "Unable to load the Bulk Posting queue.");
    const rows = (docs ?? []) as JsonRecord[];
    const ids = rows.map((row) => text(row.id)).filter(Boolean);
    const { data: lines, error: lineError } = ids.length ? await serviceRoleClient.schema("erp_procurement").from("delivery_challan_line")
      .select("id, dc_id, line_number, material_id, quantity, pack_qty, pack_uom_code, uom_code, unit_value, display_rate, display_rate_basis, display_uom_code, gst_rate, gst_amount, line_total, so_line_id, so_map_allocation_id")
      .in("dc_id", ids).order("line_number") : { data: [], error: null };
    if (lineError) return fail(req, ctx, "BULK_POST_QUEUE_LINES_FETCH_FAILED", 500, "Unable to load Bulk Posting lines.");
    const lineRows = (lines ?? []) as JsonRecord[];

    // The SO02 grid is commercial data, not merely a DO-line dump. Reuse the
    // same fresh grouping calculation that posting uses, so party/GST/rate
    // display can never drift from the eventual Invoice/PGI document.
    const groupsByDcLine = new Map<string, { group: Awaited<ReturnType<typeof computeInvoiceGroups>>["groups"][number]; line: Awaited<ReturnType<typeof computeInvoiceGroups>>["groups"][number]["lines"][number] }>();
    for (const doc of rows) {
      const { groups } = await computeInvoiceGroups(text(doc.id));
      for (const group of groups) for (const groupLine of group.lines) {
        groupsByDcLine.set(text(groupLine.dc_line_id), { group, line: groupLine });
      }
    }

    const allocationIds = [...new Set(lineRows.map((line) => text(line.so_map_allocation_id)).filter(Boolean))];
    const { data: allocationRows, error: allocationError } = allocationIds.length
      ? await serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation").select("id, map_group_id").in("id", allocationIds)
      : { data: [] as JsonRecord[], error: null };
    if (allocationError) return fail(req, ctx, "BULK_POST_QUEUE_MAP_FETCH_FAILED", 500, "Unable to load SO Map references.");
    const allocationById = new Map(((allocationRows ?? []) as JsonRecord[]).map((row) => [text(row.id), row]));
    const mapGroupIds = [...new Set(((allocationRows ?? []) as JsonRecord[]).map((row) => text(row.map_group_id)).filter(Boolean))];
    const { data: mapGroups, error: mapGroupError } = mapGroupIds.length
      ? await serviceRoleClient.schema("erp_procurement").from("sales_order_map_group").select("id, external_fo_number").in("id", mapGroupIds)
      : { data: [] as JsonRecord[], error: null };
    if (mapGroupError) return fail(req, ctx, "BULK_POST_QUEUE_FO_FETCH_FAILED", 500, "Unable to load External FO numbers.");
    const mapGroupById = new Map(((mapGroups ?? []) as JsonRecord[]).map((row) => [text(row.id), row]));

    const soIds = [...new Set([...groupsByDcLine.values()].map(({ group }) => text(group.so_id)).filter(Boolean))];
    const { data: soRows, error: soError } = soIds.length
      ? await serviceRoleClient.schema("erp_procurement").from("sales_order").select("id, vendor_code_id").in("id", soIds)
      : { data: [] as JsonRecord[], error: null };
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
      return {
        ...doc,
        ...rawLine,
        dd_flag: doc.pgi_deferred === true,
        so_number: group?.document_number ?? null,
        fo_number: text(mapGroup?.external_fo_number) || group?.fo_number || null,
        external_so_number: group?.customer_po_number ?? null,
        company_code: companyCode,
        vendor_code: vendor ? [text(vendor.vendor_code), text(vendor.description)].filter(Boolean).join(" — ") : null,
        sku: line?.document_name || line?.material_display || null,
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
        ship_to: group?.ship_to?.name ?? null,
        transporter: transporter ? [text(transporter.transporter_code), text(transporter.transporter_name)].filter(Boolean).join(" — ") : text(doc.transporter_name_freetext) || null,
      };
    });
    return okResponse({ items }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "BULK_POST_QUEUE_FAILED"; return fail(req, ctx, code, 500, code); }
}

export async function bulkPostDeliveryOrdersHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const payload = await body(req);
    const ids = [...new Set((Array.isArray(payload.dc_ids) ? payload.dc_ids : []).map(text).filter(Boolean))];
    if (!ids.length) return fail(req, ctx, "BULK_POST_SELECTION_REQUIRED", 400, "Select at least one delivery order.");
    const { data: docs, error } = await serviceRoleClient.schema("erp_procurement").from("delivery_challan")
      .select("id, selling_company_id, pgi_deferred, is_bulk_uploaded, status, pre_invoice_tally_invoice_number, pre_invoice_tally_invoice_date, pre_invoice_inbound_number")
      .in("id", ids);
    if (error || (docs ?? []).length !== ids.length) return fail(req, ctx, "BULK_POST_DO_NOT_FOUND", 404, "One or more selected delivery orders no longer exist.");
    const results: JsonRecord[] = [];
    for (const doc of (docs ?? []) as JsonRecord[]) {
      const dcId = text(doc.id); const companyId = text(doc.selling_company_id);
      const denied = await assertInvoiceAccess(req, ctx, companyId, "WRITE"); if (denied) return denied;
      if (doc.is_bulk_uploaded !== true || upper(doc.status) !== "CREATED") return fail(req, ctx, "BULK_POST_DO_NOT_READY", 400, "Every selected row must be a CREATED Bulk DO.");
      if (doc.pgi_deferred === true) {
        const inner = new Request(`http://internal/api/procurement/delivery-orders-v2/${dcId}/vdc-invoice-only`, { method: "POST" });
        const response = await createVdcInvoiceOnlyHandler(inner, ctx);
        if (!response.ok) return response;
        results.push({ dc_id: dcId, mode: "VDC_INVOICE_ONLY", ...(await response.json()) });
      } else {
        const { groups } = await computeInvoiceGroups(dcId);
        const tallyNumber = text(doc.pre_invoice_tally_invoice_number); const tallyDate = text(doc.pre_invoice_tally_invoice_date);
        if (!tallyNumber || !tallyDate) return fail(req, ctx, "BULK_POST_TALLY_FIELDS_REQUIRED", 400, "Tally Invoice Number and Date are required for every selected DO.");
        const inner = new Request(`http://internal/api/procurement/delivery-orders-v2/${dcId}/pgi-invoice-groups`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groups: groups.map((group) => ({ group_key: group.group_key, tally_invoice_number: tallyNumber, tally_invoice_date: tallyDate, inbound_number: text(doc.pre_invoice_inbound_number) || undefined, round_off_amount: group.so_round_off_amount })) }) });
        const response = await postPgiInvoiceGroupsHandler(inner, ctx);
        if (!response.ok) return response;
        results.push({ dc_id: dcId, mode: "DC_ATOMIC_PGI_INVOICE", ...(await response.json()) });
      }
    }
    return okResponse({ results }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "BULK_POST_FAILED"; return fail(req, ctx, code, 500, code); }
}
