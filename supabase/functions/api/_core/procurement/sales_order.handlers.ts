/*
 * File-ID: 16.9.1
 * File-Path: supabase/functions/api/_core/procurement/sales_order.handlers.ts
 * Gate: 16.9
 * Phase: 16
 * Domain: PROCUREMENT
 * Purpose: Sales order issue lifecycle plus sales invoice creation and posting.
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
type SoRow = Record<string, unknown>;
type SoLineRow = Record<string, unknown>;
type SalesInvoiceRow = Record<string, unknown>;
type SalesInvoiceLineRow = Record<string, unknown>;

const SO_STATUSES = new Set(["CREATED", "ISSUED", "INVOICED", "CLOSED", "CANCELLED"]);
const SO_LINE_STATUSES = new Set(["OPEN", "PARTIALLY_ISSUED", "FULLY_ISSUED", "KNOCKED_OFF", "CANCELLED"]);
const SALES_INVOICE_STATUSES = new Set(["DRAFT", "POSTED"]);
const GST_TYPES = new Set(["CGST_SGST", "IGST"]);

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

function salesErrorResponse(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function assertProcurementReadRole(_ctx: ProcurementHandlerContext): void {
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

async function fetchMaterial(materialId: string): Promise<JsonRecord> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("*")
    .eq("id", materialId)
    .single();

  if (error || !data) {
    throw new Error("MATERIAL_NOT_FOUND");
  }

  return data as JsonRecord;
}

async function assertSalesMaterial(materialId: string): Promise<JsonRecord> {
  const material = await fetchMaterial(materialId);
  const materialType = toUpperTrimmedString(material.material_type);
  if (!["RM", "PM"].includes(materialType)) {
    throw new Error("ONLY_RM_PM_ALLOWED");
  }
  return material;
}

async function fetchSo(soId: string): Promise<SoRow> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("sales_order")
    .select("*")
    .eq("id", soId)
    .single();

  if (error || !data) {
    throw new Error("SO_NOT_FOUND");
  }

  return data as SoRow;
}

function assertSoVisibleToContext(ctx: ProcurementHandlerContext, so: SoRow): void {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  if (scopedCompanyId && scopedCompanyId !== toTrimmedString(so.company_id)) {
    throw new Error("SO_SCOPE_VIOLATION");
  }
}

async function fetchSoLines(soId: string): Promise<SoLineRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("sales_order_line")
    .select("*")
    .eq("so_id", soId)
    .order("line_number", { ascending: true });

  if (error) {
    throw new Error("SO_LINE_FETCH_FAILED");
  }

  return (data ?? []) as SoLineRow[];
}

async function hydrateSo(soId: string, ctx?: ProcurementHandlerContext): Promise<JsonRecord> {
  const so = await fetchSo(soId);
  if (ctx) {
    assertSoVisibleToContext(ctx, so);
  }

  const [linesResp, dcResp, gxoResp] = await Promise.all([
    serviceRoleClient
      .schema("erp_procurement")
      .from("sales_order_line")
      .select("*")
      .eq("so_id", soId)
      .order("line_number", { ascending: true }),
    serviceRoleClient
      .schema("erp_procurement")
      .from("delivery_challan")
      .select("*")
      .eq("sales_order_id", soId)
      .order("created_at", { ascending: false }),
    serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_outbound")
      .select("*")
      .eq("so_id", soId)
      .order("created_at", { ascending: false }),
  ]);

  if (linesResp.error) throw new Error("SO_LINE_FETCH_FAILED");
  if (dcResp.error) throw new Error("SO_DC_FETCH_FAILED");
  if (gxoResp.error) throw new Error("SO_GXO_FETCH_FAILED");

  return {
    ...so,
    lines: linesResp.data ?? [],
    delivery_challans: dcResp.data ?? [],
    gate_exit_outbound: gxoResp.data ?? [],
  };
}

async function getPlantForLocation(companyId: string, storageLocationId: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_plant_map")
    .select("plant_id")
    .eq("company_id", companyId)
    .eq("storage_location_id", storageLocationId)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data?.plant_id) {
    throw new Error("SO_PLANT_MAP_NOT_FOUND");
  }

  return String(data.plant_id);
}

async function hasPhysicalInventoryBlock(
  materialId: string,
  plantId: string,
  storageLocationId: string,
): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("physical_inventory_block")
    .select("id")
    .eq("material_id", materialId)
    .eq("plant_id", plantId)
    .eq("storage_location_id", storageLocationId)
    .maybeSingle();

  if (error) {
    throw new Error("MATERIAL_POSTING_BLOCK_LOOKUP_FAILED");
  }

  return Boolean(data?.id);
}

async function getSnapshotForIssue(
  companyId: string,
  storageLocationId: string,
  materialId: string,
): Promise<JsonRecord> {
  const plantId = await getPlantForLocation(companyId, storageLocationId);
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_snapshot")
    .select("*")
    .eq("company_id", companyId)
    .eq("plant_id", plantId)
    .eq("storage_location_id", storageLocationId)
    .eq("material_id", materialId)
    .eq("stock_type_code", "UNRESTRICTED")
    .is("batch_id", null)
    .maybeSingle();

  if (error || !data) {
    throw new Error("INSUFFICIENT_STOCK");
  }

  return { ...data, plant_id: plantId };
}

async function fetchSalesInvoice(invoiceId: string): Promise<SalesInvoiceRow> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("sales_invoice")
    .select("*")
    .eq("id", invoiceId)
    .single();

  if (error || !data) {
    throw new Error("SALES_INVOICE_NOT_FOUND");
  }

  return data as SalesInvoiceRow;
}

function assertInvoiceVisibleToContext(ctx: ProcurementHandlerContext, invoice: SalesInvoiceRow): void {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  if (scopedCompanyId && scopedCompanyId !== toTrimmedString(invoice.company_id)) {
    throw new Error("SALES_INVOICE_SCOPE_VIOLATION");
  }
}

async function fetchSalesInvoiceLines(invoiceId: string): Promise<SalesInvoiceLineRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("sales_invoice_line")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("line_number", { ascending: true });

  if (error) {
    throw new Error("SALES_INVOICE_LINE_FETCH_FAILED");
  }

  return (data ?? []) as SalesInvoiceLineRow[];
}

async function hydrateSalesInvoice(
  invoiceId: string,
  ctx?: ProcurementHandlerContext,
): Promise<JsonRecord> {
  const invoice = await fetchSalesInvoice(invoiceId);
  if (ctx) {
    assertInvoiceVisibleToContext(ctx, invoice);
  }
  const lines = await fetchSalesInvoiceLines(invoiceId);
  return { ...invoice, lines };
}

async function fetchDeliveryChallan(dcId: string): Promise<JsonRecord> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("delivery_challan")
    .select("*")
    .eq("id", dcId)
    .single();

  if (error || !data) {
    throw new Error("DC_NOT_FOUND");
  }

  return data as JsonRecord;
}

async function fetchDeliveryChallanLines(dcId: string): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("delivery_challan_line")
    .select("*")
    .eq("dc_id", dcId)
    .order("line_number", { ascending: true });

  if (error) {
    throw new Error("DC_LINE_FETCH_FAILED");
  }

  return (data ?? []) as JsonRecord[];
}

async function getCompanyAndCustomerTaxContext(companyId: string, customerId: string): Promise<{
  companyGstNumber: string | null;
  companyStateName: string | null;
  customerGstNumber: string | null;
}> {
  const [companyResp, customerResp] = await Promise.all([
    serviceRoleClient
      .schema("erp_master")
      .from("companies")
      .select("gst_number, state_name")
      .eq("id", companyId)
      .maybeSingle(),
    serviceRoleClient
      .schema("erp_master")
      .from("customer_master")
      .select("gst_number")
      .eq("id", customerId)
      .maybeSingle(),
  ]);

  if (companyResp.error || customerResp.error) {
    throw new Error("SALES_TAX_CONTEXT_FETCH_FAILED");
  }

  return {
    companyGstNumber: toTrimmedString(companyResp.data?.gst_number) || null,
    companyStateName: toTrimmedString(companyResp.data?.state_name) || null,
    customerGstNumber: toTrimmedString(customerResp.data?.gst_number) || null,
  };
}

function deriveSalesInvoiceGstType(companyGstNumber: string | null, customerGstNumber: string | null): "CGST_SGST" | "IGST" {
  const companyStateCode = companyGstNumber?.slice(0, 2) ?? "";
  const customerStateCode = customerGstNumber?.slice(0, 2) ?? "";
  if (companyStateCode && customerStateCode && companyStateCode === customerStateCode) {
    return "CGST_SGST";
  }
  return "IGST";
}

async function updateSoStatusFromInvoices(soId: string): Promise<void> {
  const lines = await fetchSoLines(soId);
  if (lines.length === 0) {
    return;
  }

  const lineIds = lines.map((line) => String(line.id));
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("sales_invoice_line")
    .select("quantity, so_line_id, sales_invoice!inner(status)")
    .in("so_line_id", lineIds)
    .eq("sales_invoice.status", "POSTED");

  if (error) {
    throw new Error("SO_INVOICE_ROLLUP_FAILED");
  }

  const postedQtyByLine = new Map<string, number>();
  for (const row of (data ?? []) as JsonRecord[]) {
    const lineId = toTrimmedString(row.so_line_id);
    const nextQty = (postedQtyByLine.get(lineId) ?? 0) + (parsePositiveNumber(row.quantity) ?? 0);
    postedQtyByLine.set(lineId, Number(nextQty.toFixed(6)));
  }

  const allIssuedQtyInvoiced = lines.every((line) => {
    const issuedQty = parseNullableNumber(line.issued_qty) ?? 0;
    const postedQty = postedQtyByLine.get(String(line.id)) ?? 0;
    return issuedQty <= 0 || postedQty >= issuedQty;
  });

  if (!allIssuedQtyInvoiced) {
    return;
  }

  await serviceRoleClient
    .schema("erp_procurement")
    .from("sales_order")
    .update({
      status: "INVOICED",
      last_updated_at: new Date().toISOString(),
    })
    .eq("id", soId)
    .in("status", ["CREATED", "ISSUED"]);
}

export async function createSOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const customerId = toTrimmedString(body.customer_id);
    const customerPoNumber = toTrimmedString(body.customer_po_number);
    const lines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];

    if (!companyId || !customerId || !customerPoNumber || lines.length === 0) {
      return salesErrorResponse(req, ctx, "SO_CREATE_INVALID", 400, "company_id, customer_id, customer_po_number, and at least one line are required.");
    }

    const linePayload: JsonRecord[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const materialId = toTrimmedString(line.material_id);
      const quantity = parsePositiveNumber(line.quantity);
      const rate = parsePositiveNumber(line.rate);
      const discountPct = parseNullableNumber(line.discount_pct) ?? 0;
      const gstRate = parseNullableNumber(line.gst_rate);
      const issueStorageLocationId = toTrimmedString(line.issue_storage_location_id) || null;

      if (!materialId || !quantity || !rate) {
        return salesErrorResponse(req, ctx, "SO_LINE_INVALID", 400, `material_id, quantity, and rate are required for line ${index + 1}.`);
      }

      if (discountPct < 0 || discountPct > 100) {
        return salesErrorResponse(req, ctx, "SO_DISCOUNT_INVALID", 400, `discount_pct must be between 0 and 100 for line ${index + 1}.`);
      }

      const material = await assertSalesMaterial(materialId);
      const netRate = Number((rate * (1 - discountPct / 100)).toFixed(4));
      const taxableValue = Number((netRate * quantity).toFixed(4));
      const gstAmount = gstRate !== null ? Number((taxableValue * gstRate / 100).toFixed(4)) : null;
      const totalValue = Number((taxableValue + (gstAmount ?? 0)).toFixed(4));

      linePayload.push({
        line_number: index + 1,
        material_id: materialId,
        issue_storage_location_id: issueStorageLocationId,
        quantity,
        uom_code: toTrimmedString(line.uom_code) || toTrimmedString(material.base_uom_code),
        rate,
        discount_pct: discountPct,
        net_rate: netRate,
        gst_rate: gstRate,
        gst_amount: gstAmount,
        total_value: totalValue,
        balance_qty: quantity,
      });
    }

    const soNumber = await generateProcurementDocNumber("SO");
    const { data: so, error: soError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("sales_order")
      .insert({
        so_number: soNumber,
        so_date: toTrimmedString(body.so_date) || todayIsoDate(),
        company_id: companyId,
        customer_id: customerId,
        customer_po_number: customerPoNumber,
        customer_po_date: toTrimmedString(body.customer_po_date) || null,
        delivery_address: toTrimmedString(body.delivery_address) || null,
        payment_term_id: toTrimmedString(body.payment_term_id) || null,
        remarks: toTrimmedString(body.remarks) || null,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (soError || !so) {
      return salesErrorResponse(req, ctx, "SO_CREATE_FAILED", 500, "Unable to create sales order.");
    }

    const lineInsertPayload = linePayload.map((line) => ({ ...line, so_id: so.id }));
    const { error: lineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("sales_order_line")
      .insert(lineInsertPayload);

    if (lineError) {
      return salesErrorResponse(req, ctx, "SO_LINE_CREATE_FAILED", 500, "Unable to create sales order lines.");
    }

    return okResponse(await hydrateSo(String(so.id), ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_CREATE_FAILED";
    const message = code === "ONLY_RM_PM_ALLOWED" ? "Only RM/PM materials allowed in Sales Order" : code;
    const status = code === "MATERIAL_NOT_FOUND" ? 404 : code === "ONLY_RM_PM_ALLOWED" ? 400 : 500;
    return salesErrorResponse(req, ctx, code, status, message);
  }
}

export async function listSOsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const customerId = toTrimmedString(url.searchParams.get("customer_id"));
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("sales_order")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (companyId) query = query.eq("company_id", companyId);
    if (customerId) query = query.eq("customer_id", customerId);
    if (status && SO_STATUSES.has(status)) query = query.eq("status", status);
    if (dateFrom) query = query.gte("so_date", dateFrom);
    if (dateTo) query = query.lte("so_date", dateTo);

    const { data, error } = await query;
    if (error) {
      return salesErrorResponse(req, ctx, "SO_LIST_FAILED", 500, "Unable to list sales orders.");
    }

    return okResponse({ items: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_LIST_FAILED";
    return salesErrorResponse(req, ctx, code, 500, code);
  }
}

export async function getSOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const soId = getIdFromPath(req);
    if (!soId) {
      return salesErrorResponse(req, ctx, "SO_ID_REQUIRED", 400, "Sales order id is required.");
    }
    return okResponse(await hydrateSo(soId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_FETCH_FAILED";
    const status = code === "SO_NOT_FOUND" ? 404 : code === "SO_SCOPE_VIOLATION" ? 403 : 500;
    return salesErrorResponse(req, ctx, code, status, code);
  }
}

export async function updateSOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const soId = getIdFromPath(req);
    const body = await parseBody(req);
    const so = await fetchSo(soId);
    assertSoVisibleToContext(ctx, so);

    if (toUpperTrimmedString(so.status) !== "CREATED") {
      return salesErrorResponse(req, ctx, "SO_UPDATE_BLOCKED", 400, "Only CREATED sales orders can be updated.");
    }

    const patch: JsonRecord = {};
    const customerPoNumber = toTrimmedString(body.customer_po_number);
    const customerPoDate = toTrimmedString(body.customer_po_date);
    const deliveryAddress = body.delivery_address === null ? null : toTrimmedString(body.delivery_address);
    const paymentTermId = body.payment_term_id === null ? null : toTrimmedString(body.payment_term_id);
    const remarks = body.remarks === null ? null : toTrimmedString(body.remarks);

    if (customerPoNumber) patch.customer_po_number = customerPoNumber;
    if (customerPoDate) patch.customer_po_date = customerPoDate;
    if (body.delivery_address !== undefined) patch.delivery_address = deliveryAddress || null;
    if (body.payment_term_id !== undefined) patch.payment_term_id = paymentTermId || null;
    if (body.remarks !== undefined) patch.remarks = remarks || null;
    patch.last_updated_at = new Date().toISOString();
    patch.last_updated_by = ctx.auth_user_id;

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("sales_order")
      .update(patch)
      .eq("id", soId);

    if (error) {
      return salesErrorResponse(req, ctx, "SO_UPDATE_FAILED", 500, "Unable to update sales order.");
    }

    return okResponse(await hydrateSo(soId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_UPDATE_FAILED";
    const status = code === "SO_NOT_FOUND" ? 404 : code === "SO_SCOPE_VIOLATION" ? 403 : 500;
    return salesErrorResponse(req, ctx, code, status, code);
  }
}

export async function cancelSOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const soId = getIdFromPath(req);
    const body = await parseBody(req);
    const so = await fetchSo(soId);
    assertSoVisibleToContext(ctx, so);

    if (!["CREATED", "ISSUED"].includes(toUpperTrimmedString(so.status))) {
      return salesErrorResponse(req, ctx, "SO_CANCEL_BLOCKED", 400, "Only CREATED or ISSUED sales orders can be cancelled.");
    }

    const cancellationReason = toTrimmedString(body.reason) || toTrimmedString(body.cancellation_reason);
    if (!cancellationReason) {
      return salesErrorResponse(req, ctx, "SO_CANCEL_REASON_REQUIRED", 400, "Cancellation reason is required.");
    }

    const lines = await fetchSoLines(soId);
    const hasIssuedQty = lines.some((line) => (parseNullableNumber(line.issued_qty) ?? 0) > 0);
    if (hasIssuedQty) {
      return salesErrorResponse(req, ctx, "SO_CANCEL_ISSUED_BLOCKED", 400, "Cannot cancel SO after stock has been issued.");
    }

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("sales_order")
      .update({
        status: "CANCELLED",
        cancellation_reason: cancellationReason,
        cancelled_at: new Date().toISOString(),
        cancelled_by: ctx.auth_user_id,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", soId);

    if (error) {
      return salesErrorResponse(req, ctx, "SO_CANCEL_FAILED", 500, "Unable to cancel sales order.");
    }

    return okResponse(await hydrateSo(soId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_CANCEL_FAILED";
    const status = code === "SO_NOT_FOUND" ? 404 : code === "SO_SCOPE_VIOLATION" ? 403 : 500;
    return salesErrorResponse(req, ctx, code, status, code);
  }
}

export async function issueSOStockHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const soId = getIdFromPath(req);
    const body = await parseBody(req);
    const so = await fetchSo(soId);
    assertSoVisibleToContext(ctx, so);

    if (!["CREATED", "ISSUED"].includes(toUpperTrimmedString(so.status))) {
      return salesErrorResponse(req, ctx, "SO_ISSUE_BLOCKED", 400, "Only CREATED or ISSUED sales orders can issue stock.");
    }

    const requestedLines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];
    if (requestedLines.length === 0) {
      return salesErrorResponse(req, ctx, "SO_ISSUE_LINES_REQUIRED", 400, "At least one issue line is required.");
    }

    const soLines = await fetchSoLines(soId);
    const soLineMap = new Map(soLines.map((line) => [String(line.id), line]));
    const dispatchResults: Array<{ soLine: SoLineRow; issueQty: number; stockDocumentId: string; plantId: string; netRate: number }> = [];
    let totalDispatchQty = 0;
    let firstPlantId: string | null = null;

    for (const requestLine of requestedLines) {
      const soLineId = toTrimmedString(requestLine.so_line_id);
      const issueQty = parsePositiveNumber(requestLine.qty ?? requestLine.quantity);
      const issueStorageLocationId = toTrimmedString(requestLine.issue_storage_location_id);
      const soLine = soLineMap.get(soLineId);

      if (!soLine || !issueQty) {
        return salesErrorResponse(req, ctx, "SO_ISSUE_LINE_INVALID", 400, "Each issue line requires valid so_line_id and qty.");
      }

      if (toUpperTrimmedString(soLine.line_status) === "KNOCKED_OFF") {
        return salesErrorResponse(req, ctx, "SO_LINE_KNOCKED_OFF", 400, `SO line ${soLine.line_number} is already knocked off.`);
      }

      await assertSalesMaterial(String(soLine.material_id));
      const remainingQty = parseNullableNumber(soLine.balance_qty) ?? 0;
      if (issueQty > remainingQty) {
        return salesErrorResponse(req, ctx, "SO_ISSUE_QTY_EXCEEDS_BALANCE", 400, `Issue qty exceeds balance for SO line ${soLine.line_number}.`);
      }

      const storageLocationId = issueStorageLocationId || toTrimmedString(soLine.issue_storage_location_id);
      if (!storageLocationId) {
        return salesErrorResponse(req, ctx, "SO_ISSUE_LOCATION_REQUIRED", 400, `issue_storage_location_id is required for SO line ${soLine.line_number}.`);
      }

      const snapshot = await getSnapshotForIssue(String(so.company_id), storageLocationId, String(soLine.material_id));
      const availableQty = parseNullableNumber(snapshot.quantity) ?? 0;
      if (availableQty < issueQty) {
        return salesErrorResponse(req, ctx, "INSUFFICIENT_STOCK", 400, `Insufficient stock for SO line ${soLine.line_number}.`);
      }

      const postingBlocked = await hasPhysicalInventoryBlock(
        String(soLine.material_id),
        String(snapshot.plant_id),
        storageLocationId,
      );
      if (postingBlocked) {
        return salesErrorResponse(
          req,
          ctx,
          "MATERIAL_POSTING_BLOCKED",
          409,
          "Material has an active physical inventory count in progress.",
        );
      }

      const posting = await serviceRoleClient
        .schema("erp_inventory")
        .rpc("post_stock_movement", {
          p_document_number: String(so.so_number),
          p_document_date: String(so.so_date),
          p_posting_date: todayIsoDate(),
          p_movement_type_code: "SALES_ISSUE",
          p_company_id: so.company_id,
          p_plant_id: snapshot.plant_id,
          p_storage_location_id: storageLocationId,
          p_material_id: soLine.material_id,
          p_quantity: issueQty,
          p_base_uom_code: soLine.uom_code,
          p_unit_value: parseNullableNumber(snapshot.valuation_rate) ?? 0,
          p_stock_type_code: "UNRESTRICTED",
          p_direction: "OUT",
          p_posted_by: ctx.auth_user_id,
          p_reversal_of_id: null,
        });

      if (posting.error || !Array.isArray(posting.data) || posting.data.length === 0) {
        return salesErrorResponse(req, ctx, "SO_ISSUE_POST_FAILED", 500, "Unable to post sales issue stock movement.");
      }

      const stockDocumentId = String(posting.data[0].stock_document_id);
      const stockLedgerId = String(posting.data[0].stock_ledger_id);
      const currentIssuedQty = parseNullableNumber(soLine.issued_qty) ?? 0;
      const newIssuedQty = Number((currentIssuedQty + issueQty).toFixed(6));
      const newBalanceQty = Number(((parsePositiveNumber(soLine.quantity) ?? 0) - newIssuedQty).toFixed(6));
      const lineStatus = newBalanceQty <= 0 ? "FULLY_ISSUED" : newIssuedQty > 0 ? "PARTIALLY_ISSUED" : "OPEN";

      const { error: lineUpdateError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("sales_order_line")
        .update({
          issue_storage_location_id: storageLocationId,
          issued_qty: newIssuedQty,
          balance_qty: newBalanceQty,
          line_status: lineStatus,
          stock_document_id: stockDocumentId,
          stock_ledger_id: stockLedgerId,
          last_updated_at: new Date().toISOString(),
        })
        .eq("id", soLineId);

      if (lineUpdateError) {
        return salesErrorResponse(req, ctx, "SO_LINE_ISSUE_UPDATE_FAILED", 500, "Unable to update SO line issue state.");
      }

      dispatchResults.push({
        soLine: { ...soLine, issue_storage_location_id: storageLocationId },
        issueQty,
        stockDocumentId,
        plantId: String(snapshot.plant_id),
        netRate: parseNullableNumber(soLine.net_rate) ?? 0,
      });
      totalDispatchQty += issueQty;
      if (!firstPlantId) {
        firstPlantId = String(snapshot.plant_id);
      }
    }

    const dcNumber = await generateProcurementDocNumber("DC");
    const { data: dc, error: dcError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("delivery_challan")
      .insert({
        dc_number: dcNumber,
        dc_date: todayIsoDate(),
        dc_type: "SALES",
        selling_company_id: so.company_id,
        receiving_company_id: null,
        customer_id: so.customer_id,
        sto_id: null,
        sales_order_id: soId,
        delivery_address: toTrimmedString(body.delivery_address) || toTrimmedString(so.delivery_address) || null,
        transporter_id: toTrimmedString(body.transporter_id) || null,
        transporter_name_freetext: toTrimmedString(body.transporter_name_freetext) || null,
        vehicle_number: toTrimmedString(body.vehicle_number) || null,
        lr_number: toTrimmedString(body.lr_number) || null,
        driver_name: toTrimmedString(body.driver_name) || null,
        status: "AUTO_GENERATED",
        total_value: Number(dispatchResults.reduce((sum, item) => sum + (item.netRate * item.issueQty), 0).toFixed(4)),
        remarks: toTrimmedString(body.remarks) || null,
      })
      .select("*")
      .single();

    if (dcError || !dc) {
      return salesErrorResponse(req, ctx, "SO_DC_CREATE_FAILED", 500, "Unable to create delivery challan.");
    }

    const dcLinePayload = dispatchResults.map((item, index) => ({
      dc_id: dc.id,
      line_number: index + 1,
      material_id: item.soLine.material_id,
      sto_line_id: null,
      so_line_id: item.soLine.id,
      quantity: item.issueQty,
      uom_code: item.soLine.uom_code,
      unit_value: item.netRate,
      line_total: Number((item.netRate * item.issueQty).toFixed(4)),
      stock_document_id: item.stockDocumentId,
    }));

    const { error: dcLineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("delivery_challan_line")
      .insert(dcLinePayload);

    if (dcLineError) {
      return salesErrorResponse(req, ctx, "SO_DC_LINE_CREATE_FAILED", 500, "Unable to create delivery challan lines.");
    }

    const gxoNumber = await generateProcurementDocNumber("GXO");
    const { error: gateExitError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_outbound")
      .insert({
        exit_number: gxoNumber,
        exit_date: todayIsoDate(),
        exit_time: toTrimmedString(body.exit_time) || null,
        exit_type: "SALES",
        company_id: so.company_id,
        plant_id: firstPlantId,
        sto_id: null,
        sales_order_id: soId,
        dc_id: dc.id,
        rtv_id: null,
        vehicle_number: toTrimmedString(body.vehicle_number) || "SALES-VEHICLE",
        driver_name: toTrimmedString(body.driver_name) || null,
        gate_staff_id: ctx.auth_user_id,
        transporter_id: toTrimmedString(body.transporter_id) || null,
        transporter_freetext: toTrimmedString(body.transporter_name_freetext) || null,
        lr_number: toTrimmedString(body.lr_number) || null,
        rst_number: toTrimmedString(body.rst_number) || null,
        gross_weight: parseNullableNumber(body.gross_weight),
        tare_weight: parseNullableNumber(body.tare_weight),
        net_weight: parseNullableNumber(body.gross_weight) !== null && parseNullableNumber(body.tare_weight) !== null
          ? Number(((parseNullableNumber(body.gross_weight) ?? 0) - (parseNullableNumber(body.tare_weight) ?? 0)).toFixed(6))
          : null,
        dispatch_qty: totalDispatchQty,
        remarks: toTrimmedString(body.remarks) || null,
      });

    if (gateExitError) {
      return salesErrorResponse(req, ctx, "SO_GXO_CREATE_FAILED", 500, "Unable to create outbound gate exit.");
    }

    const { error: soUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("sales_order")
      .update({
        status: "ISSUED",
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", soId);

    if (soUpdateError) {
      return salesErrorResponse(req, ctx, "SO_HEADER_ISSUE_UPDATE_FAILED", 500, "Unable to update sales order status.");
    }

    return okResponse(await hydrateSo(soId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_ISSUE_FAILED";
    const message = code === "ONLY_RM_PM_ALLOWED" ? "Only RM/PM materials allowed in Sales Order" : code;
    const status = ["SO_NOT_FOUND", "MATERIAL_NOT_FOUND"].includes(code)
      ? 404
      : code === "SO_SCOPE_VIOLATION"
      ? 403
      : ["ONLY_RM_PM_ALLOWED", "INSUFFICIENT_STOCK"].includes(code)
      ? 400
      : 500;
    return salesErrorResponse(req, ctx, code, status, message);
  }
}

export async function knockOffSOLineHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const soId = getIdFromPath(req);
    const lineId = getLineIdFromPath(req);
    const body = await parseBody(req);
    const so = await fetchSo(soId);
    assertSoVisibleToContext(ctx, so);

    const reason = toTrimmedString(body.reason) || toTrimmedString(body.knock_off_reason);
    if (!reason) {
      return salesErrorResponse(req, ctx, "SO_KNOCK_OFF_REASON_REQUIRED", 400, "Knock-off reason is required.");
    }

    const lines = await fetchSoLines(soId);
    const targetLine = lines.find((line) => String(line.id) === lineId);
    if (!targetLine) {
      return salesErrorResponse(req, ctx, "SO_LINE_NOT_FOUND", 404, "Sales order line not found.");
    }

    const { error: lineUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("sales_order_line")
      .update({
        balance_qty: 0,
        line_status: "KNOCKED_OFF",
        knock_off_reason: reason,
        knocked_off_by: ctx.auth_user_id,
        knocked_off_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
      })
      .eq("id", lineId)
      .eq("so_id", soId);

    if (lineUpdateError) {
      return salesErrorResponse(req, ctx, "SO_LINE_KNOCK_OFF_FAILED", 500, "Unable to knock off sales order line.");
    }

    const refreshedLines = await fetchSoLines(soId);
    const allClosed = refreshedLines.every((line) => ["KNOCKED_OFF", "FULLY_ISSUED"].includes(toUpperTrimmedString(line.line_status)));
    if (allClosed) {
      await serviceRoleClient
        .schema("erp_procurement")
        .from("sales_order")
        .update({
          status: "CLOSED",
          last_updated_at: new Date().toISOString(),
          last_updated_by: ctx.auth_user_id,
        })
        .eq("id", soId);
    }

    return okResponse(await hydrateSo(soId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_LINE_KNOCK_OFF_FAILED";
    const status = code === "SO_NOT_FOUND" || code === "SO_LINE_NOT_FOUND" ? 404 : code === "SO_SCOPE_VIOLATION" ? 403 : 500;
    return salesErrorResponse(req, ctx, code, status, code);
  }
}

export async function createSalesInvoiceHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const dcId = toTrimmedString(body.dc_id);
    if (!dcId) {
      return salesErrorResponse(req, ctx, "SALES_INVOICE_DC_REQUIRED", 400, "dc_id is required.");
    }

    const dc = await fetchDeliveryChallan(dcId);
    if (toUpperTrimmedString(dc.dc_type) !== "SALES") {
      return salesErrorResponse(req, ctx, "SALES_INVOICE_DC_TYPE_INVALID", 400, "Only SALES delivery challans can create sales invoices.");
    }

    const companyId = getCompanyScope(ctx, String(dc.selling_company_id));
    if (companyId && companyId !== toTrimmedString(dc.selling_company_id)) {
      return salesErrorResponse(req, ctx, "SALES_INVOICE_SCOPE_VIOLATION", 403, "Delivery challan is outside current company scope.");
    }

    const customerId = toTrimmedString(dc.customer_id);
    if (!customerId) {
      return salesErrorResponse(req, ctx, "SALES_INVOICE_CUSTOMER_REQUIRED", 400, "Delivery challan customer is required.");
    }

    const dcLines = await fetchDeliveryChallanLines(dcId);
    if (dcLines.length === 0) {
      return salesErrorResponse(req, ctx, "SALES_INVOICE_DC_EMPTY", 400, "Delivery challan has no lines.");
    }

    const taxContext = await getCompanyAndCustomerTaxContext(companyId, customerId);
    const gstType = deriveSalesInvoiceGstType(taxContext.companyGstNumber, taxContext.customerGstNumber);
    if (!GST_TYPES.has(gstType)) {
      return salesErrorResponse(req, ctx, "SALES_INVOICE_GST_TYPE_INVALID", 400, "Invalid sales invoice GST type.");
    }

    const invoiceNumber = await generateProcurementDocNumber("SALES_INVOICE");
    const { data: invoice, error: invoiceError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("sales_invoice")
      .insert({
        invoice_number: invoiceNumber,
        invoice_date: toTrimmedString(body.invoice_date) || todayIsoDate(),
        company_id: companyId,
        customer_id: customerId,
        dc_id: dcId,
        so_id: dc.sales_order_id ?? null,
        payment_term_id: toTrimmedString(body.payment_term_id) || null,
        gst_type: gstType,
        status: "DRAFT",
        remarks: toTrimmedString(body.remarks) || null,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (invoiceError || !invoice) {
      return salesErrorResponse(req, ctx, "SALES_INVOICE_CREATE_FAILED", 500, "Unable to create sales invoice.");
    }

    const linePayload: JsonRecord[] = [];
    for (const dcLine of dcLines) {
      const soLine = dcLine.so_line_id
        ? (await serviceRoleClient
            .schema("erp_procurement")
            .from("sales_order_line")
            .select("*")
            .eq("id", String(dcLine.so_line_id))
            .maybeSingle()).data ?? null
        : null;
      const rate = parseNullableNumber(soLine?.net_rate) ?? parseNullableNumber(dcLine.unit_value) ?? 0;
      const quantity = parsePositiveNumber(dcLine.quantity) ?? 0;
      const taxableValue = Number((quantity * rate).toFixed(4));
      const gstRate = parseNullableNumber(soLine?.gst_rate);
      const gstAmount = gstRate !== null ? Number((taxableValue * gstRate / 100).toFixed(4)) : 0;
      const cgstAmount = gstType === "CGST_SGST" ? Number((gstAmount / 2).toFixed(4)) : null;
      const sgstAmount = gstType === "CGST_SGST" ? Number((gstAmount / 2).toFixed(4)) : null;
      const igstAmount = gstType === "IGST" ? gstAmount : null;

      linePayload.push({
        invoice_id: invoice.id,
        line_number: linePayload.length + 1,
        so_line_id: dcLine.so_line_id ?? null,
        dc_line_id: dcLine.id,
        material_id: dcLine.material_id,
        quantity,
        uom_code: dcLine.uom_code,
        rate,
        taxable_value: taxableValue,
        gst_rate: gstRate,
        cgst_amount: cgstAmount,
        sgst_amount: sgstAmount,
        igst_amount: igstAmount,
        line_total: Number((taxableValue + gstAmount).toFixed(4)),
      });
    }

    const { error: lineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("sales_invoice_line")
      .insert(linePayload);

    if (lineError) {
      return salesErrorResponse(req, ctx, "SALES_INVOICE_LINE_CREATE_FAILED", 500, "Unable to create sales invoice lines.");
    }

    return okResponse(await hydrateSalesInvoice(String(invoice.id), ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SALES_INVOICE_CREATE_FAILED";
    const status = ["DC_NOT_FOUND"].includes(code) ? 404 : ["SALES_INVOICE_SCOPE_VIOLATION"].includes(code) ? 403 : 500;
    return salesErrorResponse(req, ctx, code, status, code);
  }
}

export async function listSalesInvoicesHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const customerId = toTrimmedString(url.searchParams.get("customer_id"));
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("sales_invoice")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (companyId) query = query.eq("company_id", companyId);
    if (customerId) query = query.eq("customer_id", customerId);
    if (status && SALES_INVOICE_STATUSES.has(status)) query = query.eq("status", status);
    if (dateFrom) query = query.gte("invoice_date", dateFrom);
    if (dateTo) query = query.lte("invoice_date", dateTo);

    const { data, error } = await query;
    if (error) {
      return salesErrorResponse(req, ctx, "SALES_INVOICE_LIST_FAILED", 500, "Unable to list sales invoices.");
    }

    return okResponse({ items: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SALES_INVOICE_LIST_FAILED";
    return salesErrorResponse(req, ctx, code, 500, code);
  }
}

export async function getSalesInvoiceHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const invoiceId = getIdFromPath(req);
    if (!invoiceId) {
      return salesErrorResponse(req, ctx, "SALES_INVOICE_ID_REQUIRED", 400, "Sales invoice id is required.");
    }

    return okResponse(await hydrateSalesInvoice(invoiceId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SALES_INVOICE_FETCH_FAILED";
    const status = code === "SALES_INVOICE_NOT_FOUND" ? 404 : code === "SALES_INVOICE_SCOPE_VIOLATION" ? 403 : 500;
    return salesErrorResponse(req, ctx, code, status, code);
  }
}

export async function postSalesInvoiceHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const invoiceId = getIdFromPath(req);
    const invoice = await fetchSalesInvoice(invoiceId);
    assertInvoiceVisibleToContext(ctx, invoice);

    if (toUpperTrimmedString(invoice.status) !== "DRAFT") {
      return salesErrorResponse(req, ctx, "SALES_INVOICE_POST_BLOCKED", 400, "Only DRAFT sales invoices can be posted.");
    }

    const lines = await fetchSalesInvoiceLines(invoiceId);
    if (lines.length === 0) {
      return salesErrorResponse(req, ctx, "SALES_INVOICE_EMPTY", 400, "Sales invoice has no lines.");
    }

    let totalTaxableValue = 0;
    let totalCgstAmount = 0;
    let totalSgstAmount = 0;
    let totalIgstAmount = 0;

    for (const line of lines) {
      const quantity = parsePositiveNumber(line.quantity) ?? 0;
      const rate = parsePositiveNumber(line.rate) ?? 0;
      const taxableValue = Number((quantity * rate).toFixed(4));
      const gstRate = parseNullableNumber(line.gst_rate) ?? 0;
      const gstAmount = Number((taxableValue * gstRate / 100).toFixed(4));
      const cgstAmount = toUpperTrimmedString(invoice.gst_type) === "CGST_SGST" ? Number((gstAmount / 2).toFixed(4)) : null;
      const sgstAmount = toUpperTrimmedString(invoice.gst_type) === "CGST_SGST" ? Number((gstAmount / 2).toFixed(4)) : null;
      const igstAmount = toUpperTrimmedString(invoice.gst_type) === "IGST" ? gstAmount : null;
      const lineTotal = Number((taxableValue + gstAmount).toFixed(4));

      const { error: lineUpdateError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("sales_invoice_line")
        .update({
          taxable_value: taxableValue,
          cgst_amount: cgstAmount,
          sgst_amount: sgstAmount,
          igst_amount: igstAmount,
          line_total: lineTotal,
        })
        .eq("id", String(line.id));

      if (lineUpdateError) {
        return salesErrorResponse(req, ctx, "SALES_INVOICE_LINE_UPDATE_FAILED", 500, "Unable to recompute sales invoice line totals.");
      }

      totalTaxableValue += taxableValue;
      totalCgstAmount += cgstAmount ?? 0;
      totalSgstAmount += sgstAmount ?? 0;
      totalIgstAmount += igstAmount ?? 0;
    }

    const totalGstAmount = Number((totalCgstAmount + totalSgstAmount + totalIgstAmount).toFixed(4));
    const totalInvoiceValue = Number((totalTaxableValue + totalGstAmount).toFixed(4));

    const { error: invoiceUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("sales_invoice")
      .update({
        total_taxable_value: Number(totalTaxableValue.toFixed(4)),
        total_cgst_amount: Number(totalCgstAmount.toFixed(4)),
        total_sgst_amount: Number(totalSgstAmount.toFixed(4)),
        total_igst_amount: Number(totalIgstAmount.toFixed(4)),
        total_gst_amount: totalGstAmount,
        total_invoice_value: totalInvoiceValue,
        status: "POSTED",
        posted_by: ctx.auth_user_id,
        posted_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
      })
      .eq("id", invoiceId);

    if (invoiceUpdateError) {
      return salesErrorResponse(req, ctx, "SALES_INVOICE_POST_FAILED", 500, "Unable to post sales invoice.");
    }

    const soId = toTrimmedString(invoice.so_id);
    if (soId) {
      await updateSoStatusFromInvoices(soId);
    }

    return okResponse(await hydrateSalesInvoice(invoiceId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SALES_INVOICE_POST_FAILED";
    const status = code === "SALES_INVOICE_NOT_FOUND" ? 404 : code === "SALES_INVOICE_SCOPE_VIOLATION" ? 403 : 500;
    return salesErrorResponse(req, ctx, code, status, code);
  }
}
