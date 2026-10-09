/*
 * File-Path: supabase/functions/api/_core/procurement/vdc_invoice.handlers.ts
 * Domain: PROCUREMENT / Sales
 * Purpose: Additive VDC Invoice-now / PGI-later split for Bulk DOs. Existing
 *          atomic DC/RM/PM/INT posting remains in do_unified.handlers.ts.
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { todayIsoInKolkata } from "../../_shared/dateUtils.ts";
import { generateMaterialDocNumber } from "../../_shared/materialDocument.ts";
import { hasPhysicalInventoryBlock, hasPhysicalInventoryBlockForBatch } from "../../_shared/physicalInventoryBlock.ts";
import { errorResponse, okResponse } from "../response.ts";
import { getSnapshotForIssue } from "./sales_order.handlers.ts";
import {
  canMaintainSalesInvoice,
  computeDispatchRecoRows,
  computeInvoiceGroups,
} from "./do_unified.handlers.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

function text(value: unknown): string { return String(value ?? "").trim(); }
function upper(value: unknown): string { return text(value).toUpperCase(); }
function idFromPath(req: Request): string { return new URL(req.url).pathname.split("/").filter(Boolean)[3] ?? ""; }
function fail(req: Request, ctx: ProcurementHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

/**
 * Posts commercial invoice records only. No stock movement or reservation is
 * created here: VDC physical dispatch is confirmed by the later PGI-only
 * action after Truck Number and Dispatch Date have been supplied.
 */
export async function createVdcInvoiceOnlyHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const dcId = idFromPath(req);
    if (!dcId) return fail(req, ctx, "DO_ID_REQUIRED", 400, "Delivery order id is required.");
    const { dc, groups } = await computeInvoiceGroups(dcId);
    const companyId = text(dc.selling_company_id);
    try { await assertCompanyScope(ctx, companyId); } catch { return fail(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company."); }
    if (!(await canMaintainSalesInvoice(ctx, companyId, "WRITE"))) return fail(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Invoice/PGI create access at this company.");
    if (dc.pgi_deferred !== true || dc.is_bulk_uploaded !== true) return fail(req, ctx, "VDC_INVOICE_ONLY_NOT_BULK_VDC", 400, "Invoice-only posting is available only for VDC Bulk DOs.");
    if (upper(dc.status) !== "CREATED") return fail(req, ctx, "VDC_INVOICE_ONLY_DO_NOT_READY", 400, "Only a CREATED VDC delivery order can be invoiced.");

    const tallyInvoiceNumber = text(dc.pre_invoice_tally_invoice_number);
    const tallyInvoiceDate = text(dc.pre_invoice_tally_invoice_date);
    const inboundNumber = text(dc.pre_invoice_inbound_number);
    if (!tallyInvoiceNumber || !tallyInvoiceDate) return fail(req, ctx, "VDC_INVOICE_TALLY_FIELDS_REQUIRED", 400, "Tally Invoice Number and Date are required before Bulk Post.");

    const payloadGroups: JsonRecord[] = [];
    for (const group of groups) {
      if (group.source_type !== "SALES_ORDER") return fail(req, ctx, "VDC_INVOICE_SOURCE_INVALID", 400, "VDC Invoice-only posting supports Sales Order groups only.");
      if (group.ibn_required && !inboundNumber) return fail(req, ctx, "VDC_INVOICE_IBN_REQUIRED", 400, `Inbound Number (IBN) is required for ${group.document_number}.`);
      const lines = group.lines.map((line, index) => {
        const taxableValue = Number((line.quantity * line.unit_value).toFixed(4));
        const cgstAmount = group.gst_type === "CGST_SGST" ? Number((line.gst_amount / 2).toFixed(4)) : null;
        const sgstAmount = group.gst_type === "CGST_SGST" ? Number((line.gst_amount / 2).toFixed(4)) : null;
        return {
          line_number: index + 1, so_line_id: line.so_line_id, dc_line_id: line.dc_line_id,
          material_id: line.material_id, quantity: line.quantity, uom_code: line.uom_code,
          rate: line.unit_value, display_rate_basis: line.display_rate_basis,
          display_rate: line.display_rate, display_uom_code: line.display_uom_code,
          pack_qty: line.pack_qty, pack_uom_code: line.pack_uom_code,
          taxable_value: taxableValue, gst_rate: line.gst_rate,
          cgst_amount: cgstAmount, sgst_amount: sgstAmount,
          igst_amount: group.gst_type === "IGST" ? line.gst_amount : null,
          line_total: line.line_total,
        };
      });
      const recoRows = await computeDispatchRecoRows(group);
      payloadGroups.push({
        invoice: {
          invoice_date: todayIsoInKolkata(), company_id: companyId,
          customer_id: group.customer_id, dc_id: dcId, so_id: group.so_id,
          payment_term_id: group.payment_term_id, gst_type: group.gst_type,
          bill_to_name: group.bill_to.name, bill_to_address: group.bill_to.address,
          bill_to_state: group.bill_to.state, bill_to_gst_number: group.bill_to.gst_number,
          ship_to_name: group.ship_to.name, ship_to_address: group.ship_to.address,
          ship_to_state: group.ship_to.state, ship_to_gst_number: group.ship_to.gst_number,
          tally_invoice_number: tallyInvoiceNumber, tally_invoice_date: tallyInvoiceDate,
          inbound_number: inboundNumber || null, fo_id: group.fo_id, fo_number: group.fo_number,
          fo_date: group.fo_date, total_taxable_value: group.total_taxable_value,
          total_cgst_amount: group.total_cgst_amount, total_sgst_amount: group.total_sgst_amount,
          total_igst_amount: group.total_igst_amount, total_gst_amount: group.total_gst_amount,
          total_invoice_value: Number((group.total_taxable_value + group.total_gst_amount + group.so_round_off_amount).toFixed(2)),
          round_off_amount: group.so_round_off_amount, created_by: ctx.auth_user_id,
        },
        lines,
        dispatch_reco_lines: recoRows.map((row) => ({ ...row, dc_number: text(dc.dc_number) || null, tally_invoice_number: tallyInvoiceNumber, tally_invoice_date: tallyInvoiceDate, inbound_number: inboundNumber || null })),
      });
    }
    const { data, error } = await serviceRoleClient.schema("erp_procurement").rpc("create_vdc_invoice_only_atomic", { p_groups: payloadGroups });
    if (error) return fail(req, ctx, "VDC_INVOICE_ONLY_POST_FAILED", 500, error.message || "Unable to create the VDC invoice.");
    return okResponse({ dc_id: dcId, invoices: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "VDC_INVOICE_ONLY_FAILED";
    const status = code === "DO_NOT_FOUND" ? 404 : code.includes("REQUIRED") || code.includes("NOT_") || code.includes("EMPTY") ? 400 : 500;
    return fail(req, ctx, code, status, code);
  }
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function isValidDeferredDispatchDate(lrDate: string, dispatchDate: string): boolean {
  if (!isIsoDate(lrDate) || !isIsoDate(dispatchDate)) return false;
  const today = todayIsoInKolkata();
  if (dispatchDate < lrDate || dispatchDate > today) return false;
  // The design's narrower Today-2 window starts on 14 October 2026. Keeping
  // the decision date explicit makes the temporary backlog rule auditable.
  if (today >= "2026-10-14") {
    const floor = new Date(`${today}T00:00:00Z`);
    floor.setUTCDate(floor.getUTCDate() - 2);
    return dispatchDate >= floor.toISOString().slice(0, 10);
  }
  return true;
}

/**
 * Posts the physical half of a VDC invoice only after the invoice-only step
 * has completed. The database completion branch changes that existing DRAFT
 * invoice to POSTED in the same transaction as P601, reservation issuance and
 * the DO status change; this handler never writes those business tables on
 * its own.
 */
export async function completeVdcPgiOnlyHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const invoiceId = idFromPath(req);
    if (!invoiceId) return fail(req, ctx, "INVOICE_ID_REQUIRED", 400, "Invoice id is required.");

    const { data: invoiceData, error: invoiceError } = await serviceRoleClient
      .schema("erp_procurement").from("sales_invoice")
      .select("id, invoice_number, invoice_date, company_id, dc_id, status")
      .eq("id", invoiceId).maybeSingle();
    if (invoiceError) return fail(req, ctx, "VDC_PGI_ONLY_INVOICE_FETCH_FAILED", 500, "Unable to load the invoice.");
    const invoice = (invoiceData ?? null) as JsonRecord | null;
    if (!invoice) return fail(req, ctx, "VDC_PGI_ONLY_INVOICE_NOT_FOUND", 404, "Invoice was not found.");

    const companyId = text(invoice.company_id);
    try { await assertCompanyScope(ctx, companyId); } catch { return fail(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company."); }
    if (!(await canMaintainSalesInvoice(ctx, companyId, "WRITE"))) return fail(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Invoice/PGI create access at this company.");
    if (upper(invoice.status) !== "DRAFT") return fail(req, ctx, "VDC_PGI_ONLY_INVOICE_NOT_DRAFT", 409, "Only a draft VDC Invoice-only invoice can be posted.");

    const dcId = text(invoice.dc_id);
    const { data: dcData, error: dcError } = await serviceRoleClient
      .schema("erp_procurement").from("delivery_challan")
      .select("id, status, pgi_deferred, is_bulk_uploaded, transporter_id, transporter_name_freetext, lr_number, lr_date, vehicle_number, dispatch_date")
      .eq("id", dcId).maybeSingle();
    if (dcError) return fail(req, ctx, "VDC_PGI_ONLY_DO_FETCH_FAILED", 500, "Unable to load the delivery order.");
    const dc = (dcData ?? null) as JsonRecord | null;
    if (!dc) return fail(req, ctx, "VDC_PGI_ONLY_DO_NOT_FOUND", 404, "Delivery order was not found.");
    if (dc.pgi_deferred !== true || dc.is_bulk_uploaded !== true || upper(dc.status) !== "INVOICED") {
      return fail(req, ctx, "VDC_PGI_ONLY_DO_NOT_INVOICED", 400, "This delivery order is not in the Invoice-only state.");
    }

    const missing: string[] = [];
    if (!dc.transporter_id && !text(dc.transporter_name_freetext)) missing.push("Transporter");
    if (!text(dc.lr_number)) missing.push("LR Number");
    if (!text(dc.lr_date)) missing.push("LR Date");
    if (!text(dc.vehicle_number)) missing.push("Truck Number");
    if (!text(dc.dispatch_date)) missing.push("Dispatch Date");
    if (missing.length) return fail(req, ctx, "VDC_PGI_ONLY_FIELDS_INCOMPLETE", 400, `Missing before PGI can post: ${missing.join(", ")}.`);
    const dispatchDate = text(dc.dispatch_date);
    if (!isValidDeferredDispatchDate(text(dc.lr_date), dispatchDate)) {
      return fail(req, ctx, "VDC_PGI_ONLY_DISPATCH_DATE_INVALID", 400, "Dispatch Date must be on/after LR Date and within the allowed posting window.");
    }

    const { data: lineData, error: lineError } = await serviceRoleClient
      .schema("erp_procurement").from("sales_invoice_line")
      .select("id, dc_line_id, material_id, quantity, uom_code, line_number")
      .eq("invoice_id", invoiceId).order("line_number", { ascending: true });
    if (lineError) return fail(req, ctx, "VDC_PGI_ONLY_LINE_FETCH_FAILED", 500, "Unable to load invoice lines.");
    const invoiceLines = (lineData ?? []) as JsonRecord[];
    if (!invoiceLines.length) return fail(req, ctx, "VDC_PGI_ONLY_INVOICE_EMPTY", 400, "Invoice has no lines.");
    const dcLineIds = [...new Set(invoiceLines.map((line) => text(line.dc_line_id)).filter(Boolean))];
    const { data: dcLineData, error: dcLineError } = await serviceRoleClient
      .schema("erp_procurement").from("delivery_challan_line")
      .select("id, material_id, storage_location_id, batch_number, line_material_type")
      .in("id", dcLineIds);
    if (dcLineError) return fail(req, ctx, "VDC_PGI_ONLY_DO_LINE_FETCH_FAILED", 500, "Unable to load delivery-order lines.");
    const dcLines = new Map(((dcLineData ?? []) as JsonRecord[]).map((line) => [text(line.id), line]));

    const matDoc = await generateMaterialDocNumber(companyId);
    const movements: JsonRecord[] = [];
    const claimedQty = new Map<string, number>();
    for (const invoiceLine of invoiceLines) {
      const dcLine = dcLines.get(text(invoiceLine.dc_line_id));
      if (!dcLine) return fail(req, ctx, "VDC_PGI_ONLY_DO_LINE_MISSING", 500, "A delivery-order line behind this invoice is missing.");
      const materialId = text(dcLine.material_id);
      const storageLocationId = text(dcLine.storage_location_id);
      const quantity = Number(invoiceLine.quantity ?? 0);
      if (!materialId || !storageLocationId || !Number.isFinite(quantity) || quantity <= 0) {
        return fail(req, ctx, "VDC_PGI_ONLY_LINE_INVALID", 400, "Invoice contains an invalid delivery-order line.");
      }
      const batchNumber = text(dcLine.batch_number) || null;
      const isBatchTracked = ["FG", "SFG"].includes(upper(dcLine.line_material_type));
      const physicalBlock = isBatchTracked
        ? await hasPhysicalInventoryBlockForBatch(companyId, materialId, storageLocationId, "UNRESTRICTED", batchNumber)
        : await hasPhysicalInventoryBlock(companyId, materialId, storageLocationId, "UNRESTRICTED");
      if (physicalBlock) return fail(req, ctx, "MATERIAL_POSTING_BLOCKED", 409, "Material has an active physical inventory count in progress.");
      let snapshot: JsonRecord;
      try { snapshot = await getSnapshotForIssue(companyId, storageLocationId, materialId); }
      catch { return fail(req, ctx, "INSUFFICIENT_STOCK", 400, "No unrestricted stock found for an invoice line."); }
      const stockKey = `${storageLocationId}:${materialId}:${batchNumber ?? ""}`;
      const available = Number(snapshot.quantity ?? 0) - (claimedQty.get(stockKey) ?? 0);
      if (available < quantity) return fail(req, ctx, "INSUFFICIENT_STOCK", 400, "Insufficient stock for an invoice line.");
      claimedQty.set(stockKey, (claimedQty.get(stockKey) ?? 0) + quantity);
      movements.push({
        document_number: text(invoice.invoice_number), document_date: text(invoice.invoice_date), posting_date: dispatchDate,
        movement_type_code: "P601", company_id: companyId, storage_location_id: storageLocationId, material_id: materialId,
        quantity, base_uom_code: text(invoiceLine.uom_code), unit_value: Number(snapshot.valuation_rate ?? 0),
        stock_type_code: "UNRESTRICTED", direction: "OUT", batch_number: batchNumber,
        material_doc_number: matDoc.docNumber, material_doc_year: matDoc.docYear, reference_document_number: text(invoice.invoice_number),
        line_ref: text(invoiceLine.dc_line_id),
      });
    }

    const { error: postError } = await serviceRoleClient.schema("erp_inventory").rpc("post_document", {
      // A dedicated registry source reaches the VDC-only completion function
      // without altering the live SALES_INVOICE CREATE/REVERSE chain.
      p_reference_document_type: "VDC_SALES_INVOICE", p_reference_document_id: invoiceId,
      p_movements: movements, p_posted_by: ctx.auth_user_id,
      p_context: { action: "PGI_ONLY", dc_id: dcId, invoice: { posted_by: ctx.auth_user_id } },
    });
    if (postError) return fail(req, ctx, "VDC_PGI_ONLY_POST_FAILED", 500, postError.message || "Unable to post deferred PGI.");
    return okResponse({ invoice_id: invoiceId, dc_id: dcId, material_document_number: matDoc.docNumber, material_document_year: matDoc.docYear }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "VDC_PGI_ONLY_FAILED";
    const status = code.includes("NOT_FOUND") ? 404 : code.includes("REQUIRED") || code.includes("INVALID") || code.includes("INCOMPLETE") || code.includes("INSUFFICIENT") || code.includes("NOT_") ? 400 : 500;
    return fail(req, ctx, code, status, code);
  }
}

async function reversePostedVdcInvoice(req: Request, ctx: ProcurementHandlerContext, invoice: JsonRecord, reason: string): Promise<Response> {
  const invoiceId = text(invoice.id);
  const companyId = text(invoice.company_id);
  const dcId = text(invoice.dc_id);
  const { data: originalRows, error: originalError } = await serviceRoleClient.schema("erp_inventory").from("stock_document")
    .select("id, material_id, source_location_id, quantity, base_uom_code, valuation_rate, reversal_document_id")
    .eq("reference_document_type", "VDC_SALES_INVOICE").eq("reference_document_id", invoiceId).eq("movement_type_code", "P601");
  if (originalError) return fail(req, ctx, "VDC_PGI_REVERSE_LEDGER_LOOKUP_FAILED", 500, "Unable to load the VDC PGI posting.");
  const originalLegs = ((originalRows ?? []) as JsonRecord[]).filter((row) => !row.reversal_document_id);
  if (!originalLegs.length) return fail(req, ctx, "VDC_PGI_REVERSE_NO_POSTINGS_FOUND", 409, "No reversible VDC PGI posting was found.");
  const matDoc = await generateMaterialDocNumber(companyId);
  const movements = originalLegs.map((leg) => ({
    document_number: text(invoice.invoice_number), document_date: text(invoice.invoice_date), posting_date: todayIsoInKolkata(),
    movement_type_code: "P602", company_id: companyId, storage_location_id: leg.source_location_id,
    material_id: leg.material_id, quantity: Number(leg.quantity ?? 0), base_uom_code: leg.base_uom_code,
    unit_value: Number(leg.valuation_rate ?? 0), stock_type_code: "UNRESTRICTED", direction: "IN",
    reversal_of_id: leg.id, material_doc_number: matDoc.docNumber, material_doc_year: matDoc.docYear,
    reference_document_number: text(invoice.invoice_number), line_ref: text(leg.id),
  }));
  const { error } = await serviceRoleClient.schema("erp_inventory").rpc("post_document", {
    p_reference_document_type: "VDC_SALES_INVOICE", p_reference_document_id: invoiceId,
    p_movements: movements, p_posted_by: ctx.auth_user_id,
    p_context: { action: "REVERSE", dc_id: dcId, cancel: { cancelled_by: ctx.auth_user_id, cancelled_at: new Date().toISOString(), cancellation_reason: reason } },
  });
  if (error) return fail(req, ctx, "VDC_PGI_REVERSE_POST_FAILED", 500, error.message || "Unable to reverse VDC PGI and invoice.");
  return okResponse({ invoice_id: invoiceId, status: "CANCELLED" }, ctx.request_id, req);
}

/**
 * VDC-only cancellation cascade. DRAFT invoices are cancelled together with
 * the DO/reservation in one database transaction. Fully posted VDC invoices
 * are reversed through the dedicated VDC posting source, so P602 and the
 * final DO cancellation remain coupled to their respective posting events.
 */
export async function cancelVdcDeliveryOrderHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const dcId = idFromPath(req);
    const payload = await req.json().catch(() => ({} as JsonRecord));
    const reason = text(payload.reason);
    if (!dcId) return fail(req, ctx, "DO_ID_REQUIRED", 400, "Delivery order id is required.");
    if (!reason) return fail(req, ctx, "VDC_CANCEL_REASON_REQUIRED", 400, "Cancellation reason is required.");
    const { data: dcData, error: dcError } = await serviceRoleClient.schema("erp_procurement").from("delivery_challan")
      .select("id, selling_company_id, status, pgi_deferred, is_bulk_uploaded").eq("id", dcId).maybeSingle();
    if (dcError) return fail(req, ctx, "VDC_CANCEL_DO_FETCH_FAILED", 500, "Unable to load the delivery order.");
    const dc = (dcData ?? null) as JsonRecord | null;
    if (!dc) return fail(req, ctx, "DO_NOT_FOUND", 404, "Delivery order was not found.");
    const companyId = text(dc.selling_company_id);
    try { await assertCompanyScope(ctx, companyId); } catch { return fail(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company."); }
    if (!(await canMaintainSalesInvoice(ctx, companyId, "WRITE"))) return fail(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Invoice/PGI create access at this company.");
    if (dc.pgi_deferred !== true || dc.is_bulk_uploaded !== true || !["CREATED", "INVOICED", "DISPATCHED"].includes(upper(dc.status))) {
      return fail(req, ctx, "VDC_CANCEL_BLOCKED", 409, "Only an active VDC Bulk DO can be cancelled here.");
    }
    if (upper(dc.status) === "CREATED") {
      const { error } = await serviceRoleClient.schema("erp_procurement").rpc("cancel_vdc_created_delivery_order_atomic", {
        p_dc_id: dcId, p_reason: reason, p_actor: ctx.auth_user_id,
      });
      if (error) return fail(req, ctx, "VDC_CANCEL_FAILED", 500, error.message || "Unable to cancel the VDC delivery order.");
      return okResponse({ dc_id: dcId, status: "CANCELLED", invoice_count: 0 }, ctx.request_id, req);
    }
    const { data: invoiceRows, error: invoiceError } = await serviceRoleClient.schema("erp_procurement").from("sales_invoice")
      .select("id, invoice_number, invoice_date, company_id, dc_id, status").eq("dc_id", dcId).in("status", ["DRAFT", "POSTED"]);
    if (invoiceError) return fail(req, ctx, "VDC_CANCEL_INVOICE_FETCH_FAILED", 500, "Unable to load VDC invoices.");
    const invoices = (invoiceRows ?? []) as JsonRecord[];
    if (!invoices.length) return fail(req, ctx, "VDC_CANCEL_INVOICE_NOT_FOUND", 409, "No active VDC invoice was found.");
    const statuses = new Set(invoices.map((invoice) => upper(invoice.status)));
    if (statuses.has("DRAFT")) {
      const functionName = statuses.size === 1 ? "cancel_vdc_invoice_only_atomic" : "cancel_vdc_draft_invoices_for_cascade";
      const { error } = await serviceRoleClient.schema("erp_procurement").rpc(functionName, { p_dc_id: dcId, p_reason: reason, p_actor: ctx.auth_user_id });
      if (error) return fail(req, ctx, "VDC_CANCEL_FAILED", 500, error.message || "Unable to cancel the VDC Invoice-only delivery order.");
      if (statuses.size === 1) return okResponse({ dc_id: dcId, status: "CANCELLED", invoice_count: invoices.length }, ctx.request_id, req);
    }
    for (const invoice of invoices.filter((row) => upper(row.status) === "POSTED")) {
      const response = await reversePostedVdcInvoice(req, ctx, invoice, reason);
      if (!response.ok) return response;
    }
    return okResponse({ dc_id: dcId, status: "CANCELLED", invoice_count: invoices.length }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "VDC_CANCEL_FAILED";
    return fail(req, ctx, code, code.includes("REQUIRED") ? 400 : 500, code);
  }
}
