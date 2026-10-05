/*
 * File-Path: supabase/functions/api/_core/procurement/settlement.handlers.ts
 * Domain: PROCUREMENT / PO12 (Plant Transfer Order, PTO)
 * Purpose: Settlement (CRCP Leg 2 Invoice) — Pending/Settled tabs. Design:
 *          docs/PROCUREMENT-DESIGN-DOC.md "Settlement (Leg 2 Invoice)"
 *          section, locked 2026-10-04.
 *
 * Zero stock_ledger movement -- create/reverse are each a single atomic
 * RPC call into erp_procurement.create_settlement_invoice() /
 * reverse_settlement_invoice() (CLAUDE.md §8D: not post_document(), a pure
 * business-table write). No approval workflow anywhere, on either action.
 *
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { fetchCrcpDiscrepancyRows, requireCrcpWriteAccess } from "./crcp_discrepancy.handlers.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

// Nullable UUIDs must be removed before a PostgREST `.in()` lookup. Casting
// null with String() produces the literal value "null", which fails UUID
// parsing in Postgres (22P02) when a selected GRN uses the other document leg.
function collectIds(rows: JsonRecord[], field: string): string[] {
  return [...new Set(rows.map((row) => toTrimmedString(row[field])).filter(Boolean))];
}

function settlementErrorResponse(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

const RPC_ERROR_STATUS: Record<string, number> = {
  SETTLEMENT_NO_GRN_SELECTED: 400,
  SETTLEMENT_GRN_ALREADY_SETTLED: 409,
  SETTLEMENT_MIXED_BILL_TO_COMPANY: 400,
  SETTLEMENT_MIXED_ACTUAL_RECEIVER_COMPANY: 400,
  SETTLEMENT_COMPANY_RESOLUTION_FAILED: 400,
  SETTLEMENT_NOT_A_DISCREPANCY: 400,
  SETTLEMENT_QUANTITY_MISMATCH: 409,
  SETTLEMENT_NOT_FOUND: 404,
  SETTLEMENT_NOT_REVERSIBLE: 409,
};

// Resolves and validates the Bill-To company shared by every GRN id in the
// request -- same join shape as crcp_discrepancy.handlers.ts's own
// resolveBillTo, duplicated narrowly here rather than imported since this
// only ever needs one pass over a small, caller-supplied id list (never the
// bounded-window scan the full discrepancy list does).
async function resolveSharedBillTo(grnIds: string[]): Promise<{ billTo: string | null; actualReceiver: string | null }> {
  const { data: grns } = await serviceRoleClient
    .schema("erp_procurement").from("goods_receipt")
    .select("id, company_id, po_id, sto_id").in("id", grnIds);
  const rows = (grns ?? []) as JsonRecord[];
  const poIds = collectIds(rows, "po_id");
  const stoIds = collectIds(rows, "sto_id");
  const [poRows, stoRows] = await Promise.all([
    fetchInChunks<JsonRecord>(poIds, (chunk) =>
      serviceRoleClient.schema("erp_procurement").from("purchase_order").select("id, company_id").in("id", chunk)),
    fetchInChunks<JsonRecord>(stoIds, (chunk) =>
      serviceRoleClient.schema("erp_procurement").from("stock_transfer_order")
        .select("id, receiving_company_id").in("id", chunk)),
  ]);
  const poMap = new Map(poRows.map((row) => [String(row.id), row]));
  const stoMap = new Map(stoRows.map((row) => [String(row.id), row]));
  const billToSet = new Set<string>();
  const actualReceiverSet = new Set<string>();
  for (const row of rows) {
    const billTo = row.po_id
      ? toTrimmedString(poMap.get(String(row.po_id))?.company_id)
      : toTrimmedString(stoMap.get(String(row.sto_id))?.receiving_company_id);
    if (billTo) billToSet.add(billTo);
    const actualReceiver = toTrimmedString(row.company_id);
    if (actualReceiver) actualReceiverSet.add(actualReceiver);
  }
  return {
    billTo: billToSet.size === 1 ? [...billToSet][0] : null,
    actualReceiver: actualReceiverSet.size === 1 ? [...actualReceiverSet][0] : null,
  };
}

export async function listSettlementPendingHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id")) || toTrimmedString(ctx.context.companyId);
    if (!companyId) {
      return settlementErrorResponse(req, ctx, "SETTLEMENT_COMPANY_REQUIRED", 400, "company_id is required.");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return settlementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    const items = await fetchCrcpDiscrepancyRows(companyId, { settlementStatus: "PENDING" });
    return okResponse({ items, total: items.length }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SETTLEMENT_PENDING_LIST_FAILED";
    return settlementErrorResponse(req, ctx, code, 500, code);
  }
}

export async function createSettlementInvoiceHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const body = await parseBody(req);
    const grnIds = Array.isArray(body.grn_ids) ? body.grn_ids.map((id) => toTrimmedString(id)).filter(Boolean) : [];
    if (grnIds.length === 0) {
      return settlementErrorResponse(req, ctx, "SETTLEMENT_NO_GRN_SELECTED", 400, "At least one GRN must be selected.");
    }

    const { billTo, actualReceiver } = await resolveSharedBillTo(grnIds);
    if (!billTo || !actualReceiver) {
      return settlementErrorResponse(req, ctx, "SETTLEMENT_MIXED_BILL_TO_COMPANY", 400, "Selected rows must share one Bill-To and one Actual Receiver company.");
    }

    // Only the Bill-To company may create the Leg 2 invoice against itself
    // (it is the one claiming ITC / issuing the invoice) -- real
    // PROC_PLANT_TRANSFER_LIST:WRITE at that specific company, not just
    // membership (company-scope-write-acl-guard.mjs's own pattern; see
    // crcp_discrepancy.handlers.ts's canWriteCrcp() for why assertCompanyScope
    // alone is insufficient here).
    try {
      await assertCompanyScope(ctx, billTo);
    } catch {
      return settlementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    const forbidden = await requireCrcpWriteAccess(req, ctx, billTo, "WRITE");
    if (forbidden) return forbidden;

    const invoiceQuantity = Number(body.invoice_quantity);
    const ratePerUom = Number(body.rate_per_uom);
    if (!Number.isFinite(invoiceQuantity) || invoiceQuantity <= 0 || !Number.isFinite(ratePerUom)) {
      return settlementErrorResponse(req, ctx, "SETTLEMENT_INVALID_AMOUNTS", 400, "Invoice Quantity and Rate per UOM are required.");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .rpc("create_settlement_invoice", {
        p_grn_ids: grnIds,
        p_tally_invoice_number: toTrimmedString(body.tally_invoice_number),
        p_tally_invoice_date: toTrimmedString(body.tally_invoice_date),
        p_posting_date: toTrimmedString(body.posting_date) || toTrimmedString(body.tally_invoice_date),
        p_invoice_quantity: invoiceQuantity,
        p_rate_per_uom: ratePerUom,
        p_currency_code: toTrimmedString(body.currency_code) || "INR",
        p_freight_term: toTrimmedString(body.freight_term) || null,
        p_payment_term_id: toTrimmedString(body.payment_term_id) || null,
        p_gst_rate: body.gst_rate != null ? Number(body.gst_rate) : null,
        p_gst_treatment: toTrimmedString(body.gst_treatment) || null,
        p_gst_type: toTrimmedString(body.gst_type) || null,
        p_gst_amount: body.gst_amount != null ? Number(body.gst_amount) : null,
        p_sending_cost_center_id: toTrimmedString(body.sending_cost_center_id) || null,
        p_receiving_cost_center_id: toTrimmedString(body.receiving_cost_center_id) || null,
        p_has_rebate: body.has_rebate === true,
        p_rebate_rate: body.rebate_rate != null ? Number(body.rebate_rate) : null,
        p_rebate_rate_uom_basis: toTrimmedString(body.rebate_rate_uom_basis) || null,
        p_rebate_remarks: toTrimmedString(body.rebate_remarks) || null,
        p_remarks: toTrimmedString(body.remarks) || null,
        p_actor: ctx.auth_user_id,
      });

    if (error) {
      const code = toTrimmedString(error.message).split(":")[0] || "SETTLEMENT_CREATE_FAILED";
      return settlementErrorResponse(req, ctx, code, RPC_ERROR_STATUS[code] ?? 500, error.message ?? "Unable to create Settlement Invoice.");
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SETTLEMENT_CREATE_FAILED";
    return settlementErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, code);
  }
}

// "Settled" tab lookup -- types the Settlement Invoice's own Tally Invoice
// Number + Date (the primary user-facing identifier, same field the
// header itself is keyed on), returns the header + every GRN it covers,
// read-only.
export async function getSettlementByTallyInvoiceHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const tallyInvoiceNumber = toTrimmedString(url.searchParams.get("tally_invoice_number"));
    const tallyInvoiceDate = toTrimmedString(url.searchParams.get("tally_invoice_date"));
    if (!tallyInvoiceNumber || !tallyInvoiceDate) {
      return settlementErrorResponse(req, ctx, "SETTLEMENT_LOOKUP_INVALID", 400, "tally_invoice_number and tally_invoice_date are required.");
    }

    const { data: invoice, error: invoiceError } = await serviceRoleClient
      .schema("erp_procurement").from("settlement_invoice")
      .select("*")
      .eq("tally_invoice_number", tallyInvoiceNumber)
      .eq("tally_invoice_date", tallyInvoiceDate)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (invoiceError || !invoice) {
      return settlementErrorResponse(req, ctx, "SETTLEMENT_NOT_FOUND", 404, "No Settlement Invoice found for that Tally Invoice Number + Date.");
    }

    try {
      await assertCompanyScope(ctx, String(invoice.bill_to_company_id));
    } catch {
      return settlementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const { data: coveredGrns } = await serviceRoleClient
      .schema("erp_procurement").from("goods_receipt")
      .select("id, grn_number, grn_date, received_qty, material_id, invoice_number, invoice_date")
      .eq("settlement_invoice_id", invoice.id);

    return okResponse({ invoice, covered_grns: coveredGrns ?? [] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SETTLEMENT_LOOKUP_FAILED";
    return settlementErrorResponse(req, ctx, code, 500, code);
  }
}

export async function reverseSettlementInvoiceHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const body = await parseBody(req);
    const settlementInvoiceId = toTrimmedString(body.settlement_invoice_id);
    if (!settlementInvoiceId) {
      return settlementErrorResponse(req, ctx, "SETTLEMENT_REVERSE_ID_REQUIRED", 400, "settlement_invoice_id is required.");
    }

    const { data: invoice, error: invoiceError } = await serviceRoleClient
      .schema("erp_procurement").from("settlement_invoice")
      .select("id, bill_to_company_id, status").eq("id", settlementInvoiceId).single();
    if (invoiceError || !invoice) {
      return settlementErrorResponse(req, ctx, "SETTLEMENT_NOT_FOUND", 404, "Settlement Invoice not found.");
    }
    try {
      await assertCompanyScope(ctx, String(invoice.bill_to_company_id));
    } catch {
      return settlementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    const forbidden = await requireCrcpWriteAccess(req, ctx, String(invoice.bill_to_company_id), "EDIT");
    if (forbidden) return forbidden;

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .rpc("reverse_settlement_invoice", {
        p_settlement_invoice_id: settlementInvoiceId,
        p_actor: ctx.auth_user_id,
        p_reason: toTrimmedString(body.reason) || null,
      });

    if (error) {
      const code = toTrimmedString(error.message).split(":")[0] || "SETTLEMENT_REVERSE_FAILED";
      return settlementErrorResponse(req, ctx, code, RPC_ERROR_STATUS[code] ?? 500, error.message ?? "Unable to reverse Settlement Invoice.");
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SETTLEMENT_REVERSE_FAILED";
    return settlementErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, code);
  }
}

// AC01 "Settlement Invoice" column -> View/Print (locked 2026-10-04) --
// reuses SalesInvoicePrintPage.jsx's own InvoiceCopy component as-is;
// this handler only shapes Settlement data into the exact same prop shape
// that component already expects, with the "Delivery Note" slot carrying
// the internal Settlement Document Number + Date (origin-reference audit
// trail) rather than a real Delivery Challan. "Invoice No." stays the
// Tally Invoice Number (invoice.tally_invoice_number, already preferred by
// InvoiceCopy with no change needed there).
export async function getSettlementPrintDataHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const settlementInvoiceId = new URL(req.url).pathname.split("/").filter(Boolean)[4] ?? "";
    if (!settlementInvoiceId) {
      return settlementErrorResponse(req, ctx, "SETTLEMENT_PRINT_ID_REQUIRED", 400, "settlement_invoice_id is required.");
    }

    const { data: invoice, error: invoiceError } = await serviceRoleClient
      .schema("erp_procurement").from("settlement_invoice")
      .select("*").eq("id", settlementInvoiceId).single();
    if (invoiceError || !invoice) {
      return settlementErrorResponse(req, ctx, "SETTLEMENT_NOT_FOUND", 404, "Settlement Invoice not found.");
    }

    try {
      await assertCompanyScope(ctx, String(invoice.bill_to_company_id));
    } catch {
      try {
        await assertCompanyScope(ctx, String(invoice.actual_receiver_company_id));
      } catch {
        return settlementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
      }
    }

    const [{ data: sellerCompany }, { data: buyerCompany }, { data: coveredGrns }, { data: paymentTerm }] = await Promise.all([
      serviceRoleClient.schema("erp_master").from("companies")
        .select("company_code, company_name, full_address, gst_number, state_name")
        .eq("id", String(invoice.bill_to_company_id)).maybeSingle(),
      serviceRoleClient.schema("erp_master").from("companies")
        .select("company_code, company_name, full_address, gst_number, state_name")
        .eq("id", String(invoice.actual_receiver_company_id)).maybeSingle(),
      serviceRoleClient.schema("erp_procurement").from("goods_receipt")
        .select("id, grn_number, material_id, received_qty, uom_code, hsn_code, batch_lot_number")
        .eq("settlement_invoice_id", settlementInvoiceId),
      invoice.payment_term_id
        ? serviceRoleClient.schema("erp_master").from("payment_terms_master")
          .select("name").eq("id", String(invoice.payment_term_id)).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const grnRows = (coveredGrns ?? []) as JsonRecord[];
    const materialIds = collectIds(grnRows, "material_id");
    const materials = materialIds.length > 0
      ? await fetchInChunks<JsonRecord>(materialIds, (chunk) =>
        serviceRoleClient.schema("erp_master").from("material_master")
          .select("id, material_name, base_uom_code").in("id", chunk))
      : [];
    const materialMap = new Map(materials.map((row) => [String(row.id), row]));

    const gstRate = invoice.gst_rate != null ? Number(invoice.gst_rate) : 0;
    const gstType = invoice.gst_type === "IGST" ? "IGST" : "CGST_SGST";
    const rate = Number(invoice.rate_per_uom ?? 0);
    const lines = grnRows.map((row) => {
      const material = materialMap.get(String(row.material_id));
      const quantity = Number(row.received_qty ?? 0);
      const taxableValue = quantity * rate;
      const gstAmount = taxableValue * (gstRate / 100);
      return {
        id: row.id,
        document_name: material?.material_name ?? null,
        material_name: material?.material_name ?? null,
        batch_number: row.batch_lot_number ?? null,
        hsn_code: row.hsn_code ?? null,
        quantity,
        rate,
        uom_code: row.uom_code ?? material?.base_uom_code ?? null,
        taxable_value: taxableValue,
        gst_rate: gstRate,
        cgst_amount: gstType === "CGST_SGST" ? gstAmount / 2 : 0,
        sgst_amount: gstType === "CGST_SGST" ? gstAmount / 2 : 0,
        igst_amount: gstType === "IGST" ? gstAmount : 0,
      };
    });
    const totalGstAmount = lines.reduce((sum, line) => sum + line.cgst_amount + line.sgst_amount + line.igst_amount, 0);
    const totalInvoiceValue = lines.reduce((sum, line) => sum + line.taxable_value, 0) + totalGstAmount;

    return okResponse({
      tally_invoice_number: invoice.tally_invoice_number,
      tally_invoice_date: invoice.tally_invoice_date,
      gst_type: gstType,
      payment_term_name: (paymentTerm as JsonRecord | null)?.name ?? null,
      seller: sellerCompany ? {
        company_name: sellerCompany.company_name,
        full_address: sellerCompany.full_address,
        gst_number: sellerCompany.gst_number,
        state_name: sellerCompany.state_name,
      } : null,
      bill_to_name: buyerCompany?.company_name ?? null,
      bill_to_address: buyerCompany?.full_address ?? null,
      bill_to_state: buyerCompany?.state_name ?? null,
      bill_to_gst_number: buyerCompany?.gst_number ?? null,
      ship_to_name: buyerCompany?.company_name ?? null,
      ship_to_address: buyerCompany?.full_address ?? null,
      ship_to_state: buyerCompany?.state_name ?? null,
      ship_to_gst_number: buyerCompany?.gst_number ?? null,
      // "Delivery Note" slot -- Settlement Document Number + Date (internal
      // SETTLEMENT series), the origin-reference audit trail for a
      // Settlement-origin invoice, never shown as the invoice's own primary
      // identity (that stays tally_invoice_number above, throughout).
      delivery_challan: {
        dc_number: invoice.settlement_number,
        dc_date: invoice.posting_date,
      },
      lines,
      total_gst_amount: totalGstAmount,
      total_invoice_value: totalInvoiceValue,
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SETTLEMENT_PRINT_DATA_FAILED";
    return settlementErrorResponse(req, ctx, code, 500, code);
  }
}
