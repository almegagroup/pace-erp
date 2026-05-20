/*
 * File-ID: 16.8.1
 * File-Path: supabase/functions/api/_core/procurement/invoice_verification.handlers.ts
 * Gate: 16.8
 * Phase: 16
 * Domain: PROCUREMENT
 * Purpose: Invoice verification draft, 3-way match, GST verification, and posting handlers.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};
type IvRow = Record<string, unknown>;
type IvLineRow = Record<string, unknown>;

const IV_STATUSES = new Set(["DRAFT", "MATCHED", "POSTED", "BLOCKED"]);
const IV_LINE_MATCH_STATUSES = new Set(["MATCHED", "BLOCKED", "PENDING"]);
const GST_TYPES = new Set(["CGST_SGST", "IGST", "NONE"]);

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getPathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}

function getIdFromPath(req: Request): string {
  return getPathSegments(req)[3] ?? "";
}

function getLineIdFromPath(req: Request): string {
  return getPathSegments(req)[5] ?? "";
}

function ivErrorResponse(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function assertAccountsRole(_ctx: ProcurementHandlerContext): void {
  // Protected by upstream pipeline/ACL layer.
}

function getCompanyScope(ctx: ProcurementHandlerContext, requestedCompanyId?: string): string {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  const companyId = toTrimmedString(requestedCompanyId);
  return companyId || scopedCompanyId;
}

async function generateProcurementDocNumber(docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("generate_doc_number", { p_doc_type: docType });

  if (error || !data) {
    throw new Error("PROCUREMENT_DOC_NUMBER_FAILED");
  }

  return String(data);
}

async function fetchIv(ivId: string): Promise<IvRow> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("invoice_verification")
    .select("*")
    .eq("id", ivId)
    .single();

  if (error || !data) {
    throw new Error("IV_NOT_FOUND");
  }

  return data as IvRow;
}

function assertIvVisibleToContext(ctx: ProcurementHandlerContext, iv: IvRow): void {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  if (scopedCompanyId && scopedCompanyId !== toTrimmedString(iv.company_id)) {
    throw new Error("IV_SCOPE_VIOLATION");
  }
}

async function fetchIvLines(ivId: string): Promise<IvLineRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("invoice_verification_line")
    .select("*")
    .eq("iv_id", ivId)
    .order("line_number", { ascending: true });

  if (error) {
    throw new Error("IV_LINE_FETCH_FAILED");
  }

  return (data ?? []) as IvLineRow[];
}

async function hydrateIv(ivId: string, ctx?: ProcurementHandlerContext): Promise<JsonRecord> {
  const iv = await fetchIv(ivId);
  if (ctx) {
    assertIvVisibleToContext(ctx, iv);
  }
  const lines = await fetchIvLines(ivId);
  return { ...iv, lines };
}

async function fetchGrn(grnId: string): Promise<JsonRecord> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("goods_receipt")
    .select("*")
    .eq("id", grnId)
    .single();

  if (error || !data) {
    throw new Error("GRN_NOT_FOUND");
  }

  return data as JsonRecord;
}

async function fetchGrnLine(grnLineId: string): Promise<JsonRecord> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("goods_receipt_line")
    .select("*")
    .eq("id", grnLineId)
    .single();

  if (error || !data) {
    throw new Error("GRN_LINE_NOT_FOUND");
  }

  return data as JsonRecord;
}

async function getCompanyAndVendorGstContext(companyId: string, vendorId: string): Promise<{
  companyGstNumber: string | null;
  companyStateName: string | null;
  vendorGstNumber: string | null;
  vendorType: string | null;
}> {
  const [companyResp, vendorResp] = await Promise.all([
    serviceRoleClient
      .schema("erp_master")
      .from("companies")
      .select("gst_number, state_name")
      .eq("id", companyId)
      .maybeSingle(),
    serviceRoleClient
      .schema("erp_master")
      .from("vendor_master")
      .select("gst_number, vendor_type")
      .eq("id", vendorId)
      .maybeSingle(),
  ]);

  if (companyResp.error || vendorResp.error) {
    throw new Error("IV_GST_CONTEXT_FETCH_FAILED");
  }

  return {
    companyGstNumber: toTrimmedString(companyResp.data?.gst_number) || null,
    companyStateName: toTrimmedString(companyResp.data?.state_name) || null,
    vendorGstNumber: toTrimmedString(vendorResp.data?.gst_number) || null,
    vendorType: toUpperTrimmedString(vendorResp.data?.vendor_type) || null,
  };
}

function deriveGstType(companyGstNumber: string | null, vendorGstNumber: string | null, vendorType: string | null): "CGST_SGST" | "IGST" | "NONE" {
  if (vendorType === "IMPORT") {
    return "NONE";
  }

  const companyStateCode = companyGstNumber?.slice(0, 2) ?? "";
  const vendorStateCode = vendorGstNumber?.slice(0, 2) ?? "";
  if (!companyStateCode || !vendorStateCode) {
    return "NONE";
  }
  return companyStateCode === vendorStateCode ? "CGST_SGST" : "IGST";
}

async function getPostedInvoicedQtyForGrnLine(grnLineId: string): Promise<number> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("invoice_verification_line")
    .select("invoice_qty, invoice_verification!inner(status)")
    .eq("grn_line_id", grnLineId)
    .eq("invoice_verification.status", "POSTED");

  if (error) {
    throw new Error("IV_POSTED_QTY_LOOKUP_FAILED");
  }

  return Number(
    ((data ?? []) as JsonRecord[]).reduce((sum, row) => sum + (parsePositiveNumber(row.invoice_qty) ?? 0), 0).toFixed(6),
  );
}

async function hasPostedVendorInvoiceDuplicate(vendorId: string, vendorInvoiceNumber: string): Promise<boolean> {
  const { count, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("invoice_verification")
    .select("id", { count: "exact", head: true })
    .eq("vendor_id", vendorId)
    .eq("vendor_invoice_number", vendorInvoiceNumber)
    .eq("status", "POSTED");

  if (error) {
    throw new Error("IV_DUPLICATE_WARNING_LOOKUP_FAILED");
  }

  return Number(count ?? 0) > 0;
}

export async function createIVDraftHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertAccountsRole(ctx);
    const body = await parseBody(req);
    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const vendorId = toTrimmedString(body.vendor_id);
    const vendorInvoiceNumber = toTrimmedString(body.vendor_invoice_number);
    const vendorInvoiceDate = toTrimmedString(body.vendor_invoice_date);

    if (!companyId || !vendorId || !vendorInvoiceNumber || !vendorInvoiceDate) {
      return ivErrorResponse(req, ctx, "IV_CREATE_INVALID", 400, "company_id, vendor_id, vendor_invoice_number, and vendor_invoice_date are required.");
    }

    const hasDuplicatePostedVendorInvoice = await hasPostedVendorInvoiceDuplicate(vendorId, vendorInvoiceNumber);
    const ivNumber = await generateProcurementDocNumber("IV");
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("invoice_verification")
      .insert({
        iv_number: ivNumber,
        iv_date: toTrimmedString(body.iv_date) || todayIsoDate(),
        company_id: companyId,
        vendor_id: vendorId,
        po_id: toTrimmedString(body.po_id) || null,
        vendor_invoice_number: vendorInvoiceNumber,
        vendor_invoice_date: vendorInvoiceDate,
        status: "DRAFT",
        remarks: toTrimmedString(body.remarks) || null,
        created_by: ctx.auth_user_id,
        last_updated_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error || !data) {
      return ivErrorResponse(req, ctx, "IV_CREATE_FAILED", 500, "Unable to create invoice verification draft.");
    }

    const responsePayload = await hydrateIv(String(data.id), ctx);
    if (hasDuplicatePostedVendorInvoice) {
      responsePayload.warning = "vendor_invoice_number already exists in another POSTED IV for this vendor.";
    }

    return okResponse(responsePayload, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "IV_CREATE_FAILED";
    return ivErrorResponse(req, ctx, code, 500, code);
  }
}

export async function listIVsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertAccountsRole(ctx);
    const url = new URL(req.url);
    const companyId = getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const vendorId = toTrimmedString(url.searchParams.get("vendor_id"));
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("invoice_verification")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (companyId) query = query.eq("company_id", companyId);
    if (vendorId) query = query.eq("vendor_id", vendorId);
    if (status && IV_STATUSES.has(status)) query = query.eq("status", status);
    if (dateFrom) query = query.gte("iv_date", dateFrom);
    if (dateTo) query = query.lte("iv_date", dateTo);

    const { data, error } = await query;
    if (error) {
      return ivErrorResponse(req, ctx, "IV_LIST_FAILED", 500, "Unable to list invoice verifications.");
    }

    return okResponse({ items: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "IV_LIST_FAILED";
    return ivErrorResponse(req, ctx, code, 500, code);
  }
}

export async function getIVHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertAccountsRole(ctx);
    const ivId = getIdFromPath(req);
    if (!ivId) {
      return ivErrorResponse(req, ctx, "IV_ID_REQUIRED", 400, "IV id is required.");
    }
    return okResponse(await hydrateIv(ivId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "IV_FETCH_FAILED";
    const status = code === "IV_NOT_FOUND" ? 404 : code === "IV_SCOPE_VIOLATION" ? 403 : 500;
    return ivErrorResponse(req, ctx, code, status, code);
  }
}

export async function addIVLineHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertAccountsRole(ctx);
    const ivId = getIdFromPath(req);
    const body = await parseBody(req);
    const iv = await fetchIv(ivId);
    assertIvVisibleToContext(ctx, iv);

    if (toUpperTrimmedString(iv.status) !== "DRAFT") {
      return ivErrorResponse(req, ctx, "IV_NOT_EDITABLE", 400, "Only DRAFT IV can accept lines.");
    }

    const grnLineId = toTrimmedString(body.grn_line_id);
    const invoiceQty = parsePositiveNumber(body.invoice_qty);
    const invoiceRate = parsePositiveNumber(body.invoice_rate);
    if (!grnLineId || !invoiceQty || !invoiceRate) {
      return ivErrorResponse(req, ctx, "IV_LINE_INVALID", 400, "grn_line_id, invoice_qty, and invoice_rate are required.");
    }

    const grnLine = await fetchGrnLine(grnLineId);
    const grn = await fetchGrn(String(grnLine.grn_id));
    if (toUpperTrimmedString(grn.status) !== "POSTED") {
      return ivErrorResponse(req, ctx, "IV_GRN_NOT_POSTED", 400, "GRN must be POSTED to add to an IV.");
    }
    if (String(grn.vendor_id) !== String(iv.vendor_id)) {
      return ivErrorResponse(req, ctx, "IV_VENDOR_MISMATCH", 400, "All GRN lines in one IV must belong to the same vendor.");
    }

    const postedInvoicedQty = await getPostedInvoicedQtyForGrnLine(grnLineId);
    const grnQty = parsePositiveNumber(grnLine.received_qty) ?? 0;
    if (postedInvoicedQty >= grnQty) {
      return ivErrorResponse(req, ctx, "IV_GRN_LINE_ALREADY_INVOICED", 400, "GRN line is already fully invoiced in another POSTED IV.");
    }
    if (postedInvoicedQty + invoiceQty > grnQty) {
      return ivErrorResponse(req, ctx, "IV_QTY_EXCEEDS_GRN", 400, "invoice_qty exceeds remaining open GRN quantity.");
    }

    const existingLines = await fetchIvLines(ivId);
    const lineNumber = existingLines.length + 1;
    const gstRate = parseNullableNumber(body.gst_rate);
    const taxableValue = Number((invoiceQty * invoiceRate).toFixed(4));
    const invoiceGstAmount = parseNullableNumber(body.invoice_gst_amount) ?? 0;

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("invoice_verification_line")
      .insert({
        iv_id: ivId,
        line_number: lineNumber,
        grn_id: grnLine.grn_id,
        grn_line_id: grnLineId,
        material_id: grnLine.material_id,
        grn_qty: grnLine.received_qty,
        invoice_qty: invoiceQty,
        uom_code: grnLine.uom_code,
        po_rate: grnLine.grn_rate ?? 0,
        invoice_rate: invoiceRate,
        match_status: "PENDING",
        taxable_value: taxableValue,
        gst_type: "NONE",
        gst_rate: gstRate,
        invoice_gst_amount: invoiceGstAmount,
      })
      .select("*")
      .single();

    if (error || !data) {
      return ivErrorResponse(req, ctx, "IV_LINE_CREATE_FAILED", 500, "Unable to add IV line.");
    }

    if (!iv.po_id && grn.po_id) {
      await serviceRoleClient
        .schema("erp_procurement")
        .from("invoice_verification")
        .update({
          po_id: grn.po_id,
          last_updated_at: new Date().toISOString(),
          last_updated_by: ctx.auth_user_id,
        })
        .eq("id", ivId);
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "IV_LINE_CREATE_FAILED";
    const status = code === "IV_NOT_FOUND" || code === "GRN_NOT_FOUND" || code === "GRN_LINE_NOT_FOUND" ? 404 : code === "IV_SCOPE_VIOLATION" ? 403 : 500;
    return ivErrorResponse(req, ctx, code, status, code);
  }
}

export async function removeIVLineHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertAccountsRole(ctx);
    const ivId = getIdFromPath(req);
    const lineId = getLineIdFromPath(req);
    const iv = await fetchIv(ivId);
    assertIvVisibleToContext(ctx, iv);

    if (toUpperTrimmedString(iv.status) !== "DRAFT") {
      return ivErrorResponse(req, ctx, "IV_LINE_REMOVE_BLOCKED", 400, "Only DRAFT IV can remove lines.");
    }

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("invoice_verification_line")
      .delete()
      .eq("id", lineId)
      .eq("iv_id", ivId);

    if (error) {
      return ivErrorResponse(req, ctx, "IV_LINE_REMOVE_FAILED", 500, "Unable to remove IV line.");
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "IV_LINE_REMOVE_FAILED";
    const status = code === "IV_NOT_FOUND" ? 404 : code === "IV_SCOPE_VIOLATION" ? 403 : 500;
    return ivErrorResponse(req, ctx, code, status, code);
  }
}

export async function runMatchHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertAccountsRole(ctx);
    const ivId = getIdFromPath(req);
    const iv = await fetchIv(ivId);
    assertIvVisibleToContext(ctx, iv);

    const lines = await fetchIvLines(ivId);
    if (lines.length === 0) {
      return ivErrorResponse(req, ctx, "IV_NO_LINES", 400, "IV has no lines to match.");
    }

    const gstContext = await getCompanyAndVendorGstContext(String(iv.company_id), String(iv.vendor_id));
    let anyBlocked = false;
    let totalTaxableValue = 0;
    let totalGstAmount = 0;

    for (const line of lines) {
      const poRate = parsePositiveNumber(line.po_rate) ?? 0;
      const invoiceRate = parsePositiveNumber(line.invoice_rate) ?? 0;
      const invoiceQty = parsePositiveNumber(line.invoice_qty) ?? 0;
      const taxableValue = Number((invoiceRate * invoiceQty).toFixed(4));
      const rateVariancePct = poRate > 0
        ? Number((Math.abs(invoiceRate - poRate) / poRate * 100).toFixed(4))
        : 0;
      const gstType = deriveGstType(
        gstContext.companyGstNumber,
        gstContext.vendorGstNumber,
        gstContext.vendorType,
      );
      const gstRate = parseNullableNumber(line.gst_rate) ?? 0;
      const calculatedGst = Number((taxableValue * gstRate / 100).toFixed(4));
      let cgstAmount = 0;
      let sgstAmount = 0;
      let igstAmount = 0;
      if (gstType === "CGST_SGST") {
        cgstAmount = Number((calculatedGst / 2).toFixed(4));
        sgstAmount = Number((calculatedGst / 2).toFixed(4));
      } else if (gstType === "IGST") {
        igstAmount = calculatedGst;
      }
      const invoiceGstAmount = parseNullableNumber(line.invoice_gst_amount) ?? 0;
      const gstMatchFlag = Math.abs(calculatedGst - invoiceGstAmount) < 1.0;
      const matchStatus = rateVariancePct > 50 ? "BLOCKED" : "MATCHED";
      if (matchStatus === "BLOCKED") {
        anyBlocked = true;
      }

      const { error: lineUpdateError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("invoice_verification_line")
        .update({
          taxable_value: taxableValue,
          rate_variance_pct: rateVariancePct,
          match_status: matchStatus,
          gst_type: gstType,
          cgst_amount: cgstAmount,
          sgst_amount: sgstAmount,
          igst_amount: igstAmount,
          gst_match_flag: gstMatchFlag,
        })
        .eq("id", String(line.id));

      if (lineUpdateError) {
        return ivErrorResponse(req, ctx, "IV_MATCH_LINE_UPDATE_FAILED", 500, "Unable to update IV match results.");
      }

      totalTaxableValue += taxableValue;
      totalGstAmount += cgstAmount + sgstAmount + igstAmount;
    }

    const headerStatus = anyBlocked ? "BLOCKED" : "MATCHED";
    const totalInvoiceValue = Number((totalTaxableValue + totalGstAmount).toFixed(4));
    const { error: headerUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("invoice_verification")
      .update({
        status: headerStatus,
        total_taxable_value: Number(totalTaxableValue.toFixed(4)),
        total_gst_amount: Number(totalGstAmount.toFixed(4)),
        total_invoice_value: totalInvoiceValue,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", ivId);

    if (headerUpdateError) {
      return ivErrorResponse(req, ctx, "IV_MATCH_HEADER_UPDATE_FAILED", 500, "Unable to update IV header after match.");
    }

    return okResponse(await hydrateIv(ivId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "IV_MATCH_FAILED";
    const status = code === "IV_NOT_FOUND" ? 404 : code === "IV_SCOPE_VIOLATION" ? 403 : 500;
    return ivErrorResponse(req, ctx, code, status, code);
  }
}

export async function postIVHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertAccountsRole(ctx);
    const ivId = getIdFromPath(req);
    const iv = await fetchIv(ivId);
    assertIvVisibleToContext(ctx, iv);

    if (toUpperTrimmedString(iv.status) !== "MATCHED") {
      return ivErrorResponse(req, ctx, "IV_POST_BLOCKED", 400, "Only MATCHED IV can be posted.");
    }

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("invoice_verification")
      .update({
        status: "POSTED",
        posted_by: ctx.auth_user_id,
        posted_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", ivId);

    if (error) {
      return ivErrorResponse(req, ctx, "IV_POST_FAILED", 500, "Unable to post IV.");
    }

    return okResponse(await hydrateIv(ivId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "IV_POST_FAILED";
    const status = code === "IV_NOT_FOUND" ? 404 : code === "IV_SCOPE_VIOLATION" ? 403 : 500;
    return ivErrorResponse(req, ctx, code, status, code);
  }
}

export async function listBlockedIVsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertAccountsRole(ctx);
    const url = new URL(req.url);
    const companyId = getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("invoice_verification")
      .select("*")
      .eq("status", "BLOCKED")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (companyId) {
      query = query.eq("company_id", companyId);
    }

    const { data, error } = await query;
    if (error) {
      return ivErrorResponse(req, ctx, "IV_BLOCKED_LIST_FAILED", 500, "Unable to list blocked IVs.");
    }

    return okResponse({ items: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "IV_BLOCKED_LIST_FAILED";
    return ivErrorResponse(req, ctx, code, 500, code);
  }
}
