/*
 * File-ID: 16.2.1
 * File-Path: supabase/functions/api/_core/procurement/po.handlers.ts
 * Gate: 16.2
 * Phase: 16
 * Domain: PROCUREMENT
 * Purpose: Implement purchase order lifecycle handlers with CSN auto-creation.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type PurchaseOrderRow = Record<string, unknown>;
type PurchaseOrderLineRow = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const PO_HEADER_STATUSES = new Set([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "CONFIRMED",
  "CLOSED",
  "CANCELLED",
]);
const PO_LINE_STATUSES = new Set([
  "OPEN",
  "PARTIALLY_RECEIVED",
  "FULLY_RECEIVED",
  "KNOCKED_OFF",
  "CANCELLED",
]);
const DELIVERY_TYPES = new Set(["STANDARD", "BULK", "TANKER"]);
const PO_VENDOR_TYPES = new Set(["DOMESTIC", "IMPORT"]);
const FREIGHT_TERMS = new Set(["FOR", "FREIGHT_SEPARATE"]);
const MUTABLE_AMENDMENT_FIELDS = new Set([
  "ordered_qty",
  "unit_rate",
  "expected_delivery_date",
  "incoterm",
  "payment_term_id",
  "cost_center_id",
  "remarks",
]);

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

function parseNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
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

function procurementErrorResponse(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function assertProcurementReadRole(_ctx: ProcurementHandlerContext): void {
  // Procurement APIs are protected by the upstream pipeline/ACL layer.
}

function assertProcurementHeadRole(ctx: ProcurementHandlerContext): void {
  if (ctx.roleCode !== "PROC_HEAD" && ctx.roleCode !== "SA") {
    throw new Error("PROCUREMENT_HEAD_REQUIRED");
  }
}

function getCompanyScope(
  ctx: ProcurementHandlerContext,
  requestedCompanyId?: string,
): string {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  const companyId = toTrimmedString(requestedCompanyId);
  return companyId || scopedCompanyId;
}

function getPathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}

function getPoIdFromPath(req: Request): string {
  return getPathSegments(req)[3] ?? "";
}

function getLineIdFromPath(req: Request): string {
  return getPathSegments(req)[5] ?? "";
}

async function getVendorRow(vendorId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("vendor_master")
    .select("id, vendor_type, indent_number_required, status")
    .eq("id", vendorId)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_VENDOR_LOOKUP_FAILED");
  }

  return (data as Record<string, unknown> | null) ?? null;
}

async function getPaymentTermRow(paymentTermId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("payment_terms_master")
    .select("*")
    .eq("id", paymentTermId)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_PAYMENT_TERM_LOOKUP_FAILED");
  }

  return (data as Record<string, unknown> | null) ?? null;
}

async function getCostCenterRow(costCenterId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("cost_center_master")
    .select("id")
    .eq("id", costCenterId)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_COST_CENTER_LOOKUP_FAILED");
  }

  return (data as Record<string, unknown> | null) ?? null;
}

async function getApprovedAslRow(
  vendorId: string,
  materialId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("vendor_material_info")
    .select("*")
    .eq("vendor_id", vendorId)
    .eq("material_id", materialId)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_ASL_LOOKUP_FAILED");
  }

  const row = (data as Record<string, unknown> | null) ?? null;
  if (!row) {
    return null;
  }

  const status = toUpperTrimmedString(row.status);
  return status === "ACTIVE" || status === "APPROVED" ? row : null;
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

async function generateCompanyDocNumber(companyId: string, docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("generate_company_doc_number", {
      p_company_id: companyId,
      p_doc_type: docType,
    });

  if (error || !data) {
    throw new Error("PROCUREMENT_DOC_NUMBER_FAILED");
  }

  return String(data);
}

async function getPOById(
  poId: string,
  companyId?: string,
): Promise<PurchaseOrderRow | null> {
  let query = serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order")
    .select("*")
    .eq("id", poId);

  if (companyId) {
    query = query.eq("company_id", companyId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error("PROCUREMENT_PO_LOOKUP_FAILED");
  }

  return (data as PurchaseOrderRow | null) ?? null;
}

async function getPOLines(poId: string): Promise<PurchaseOrderLineRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order_line")
    .select("*")
    .eq("po_id", poId)
    .order("line_number", { ascending: true });

  if (error) {
    throw new Error("PROCUREMENT_PO_LINES_LOOKUP_FAILED");
  }

  return (data as PurchaseOrderLineRow[] | null) ?? [];
}

async function getNextAmendmentNumber(poId: string): Promise<number> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("po_amendment_log")
    .select("amendment_number")
    .eq("po_id", poId)
    .order("amendment_number", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error("PROCUREMENT_AMENDMENT_SEQUENCE_FAILED");
  }

  const latest = Array.isArray(data) && data.length > 0
    ? Number(data[0]?.amendment_number ?? 0)
    : 0;
  return latest + 1;
}

function deriveCsnType(po: PurchaseOrderRow): string {
  const deliveryType = toUpperTrimmedString(po.delivery_type);
  const vendorType = toUpperTrimmedString(po.vendor_type);

  if (deliveryType === "BULK" || deliveryType === "TANKER") {
    return "BULK";
  }

  return vendorType === "IMPORT" ? "IMPORT" : "DOMESTIC";
}

async function createCsnsForPo(
  po: PurchaseOrderRow,
  poLines: PurchaseOrderLineRow[],
  createdBy: string,
): Promise<void> {
  for (const line of poLines) {
    const lineId = toTrimmedString(line.id);

    const { data: existing } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select("id")
      .eq("po_line_id", lineId)
      .maybeSingle();

    if (existing?.id) {
      continue;
    }

    const csnNumber = await generateProcurementDocNumber("CSN");
    const orderedQty = Number(line.ordered_qty ?? 0);

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .insert({
        csn_number: csnNumber,
        csn_type: deriveCsnType(po),
        status: "ORDERED",
        company_id: po.company_id,
        vendor_id: po.vendor_id,
        material_id: line.material_id,
        po_id: po.id,
        po_line_id: line.id,
        po_qty: orderedQty,
        po_uom_code: line.po_uom_code,
        payment_term_id: po.payment_term_id,
        lc_required: po.lc_required === true,
        has_rebate: po.has_rebate === true,
        rebate_remarks: po.rebate_remarks ?? null,
        indent_required: po.indent_required === true,
        created_by: createdBy,
      });

    if (error) {
      throw new Error("PROCUREMENT_CSN_CREATE_FAILED");
    }
  }
}

async function insertPoApprovalLog(input: {
  poId: string;
  action: "APPROVED" | "REJECTED" | "ESCALATED";
  fromStatus: string;
  toStatus: string;
  remarks?: string | null;
  actionedBy: string;
}): Promise<void> {
  const { error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("po_approval_log")
    .insert({
      po_id: input.poId,
      action: input.action,
      from_status: input.fromStatus,
      to_status: input.toStatus,
      remarks: input.remarks ?? null,
      actioned_by: input.actionedBy,
    });

  if (error) {
    throw new Error("PROCUREMENT_APPROVAL_LOG_FAILED");
  }
}

function lineHasReceipt(line: PurchaseOrderLineRow): boolean {
  const orderedQty = Number(line.ordered_qty ?? 0);
  const openQty = Number(line.open_qty ?? orderedQty);
  return openQty < orderedQty;
}

async function getLastUsedIncoterm(vendorId: string): Promise<string | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order")
    .select("incoterm")
    .eq("vendor_id", vendorId)
    .in("status", ["CONFIRMED", "CLOSED"])
    .order("approved_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_LAST_USED_INCOTERM_FAILED");
  }

  const incoterm = toTrimmedString(data?.incoterm);
  return incoterm || null;
}

async function getLastUsedPaymentTerm(vendorId: string): Promise<string | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order")
    .select("payment_term_id")
    .eq("vendor_id", vendorId)
    .in("status", ["CONFIRMED", "CLOSED"])
    .order("approved_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_LAST_USED_PAYMENT_TERM_FAILED");
  }

  const paymentTermId = toTrimmedString(data?.payment_term_id);
  return paymentTermId || null;
}

async function buildPoLinesForInsert(
  ctx: ProcurementHandlerContext,
  vendorId: string,
  rawLines: unknown,
): Promise<JsonRecord[]> {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new Error("PROCUREMENT_PO_LINES_REQUIRED");
  }

  const prepared: JsonRecord[] = [];

  for (let index = 0; index < rawLines.length; index += 1) {
    const rawLine = (rawLines[index] ?? {}) as JsonRecord;
    const materialId = toTrimmedString(rawLine.material_id);
    const costCenterId = toTrimmedString(rawLine.cost_center_id);

    if (!materialId) {
      throw new Error("PROCUREMENT_MATERIAL_REQUIRED");
    }
    if (!costCenterId) {
      throw new Error("PROCUREMENT_COST_CENTER_REQUIRED");
    }
    if (!(await getCostCenterRow(costCenterId))) {
      throw new Error("PROCUREMENT_COST_CENTER_NOT_FOUND");
    }

    const aslRow = await getApprovedAslRow(vendorId, materialId);
    if (!aslRow) {
      throw new Error("PROCUREMENT_ASL_REQUIRED");
    }

    const orderedQty = parsePositiveNumber(rawLine.ordered_qty);
    const unitRate = parsePositiveNumber(rawLine.unit_rate);
    if (!orderedQty || !unitRate) {
      throw new Error("PROCUREMENT_INVALID_LINE_VALUES");
    }

    const conversionFactor = parseNullableNumber(aslRow.conversion_factor) ?? 1;
    const variableConversion = aslRow.variable_conversion === true;
    const poUomCode = toTrimmedString(aslRow.po_uom_code);

    prepared.push({
      line_number: index + 1,
      material_id: materialId,
      cost_center_id: costCenterId,
      receiving_location_id: toTrimmedString(rawLine.receiving_location_id) || null,
      vendor_material_info_id: aslRow.id,
      ordered_qty: orderedQty,
      po_uom_code: poUomCode,
      ordered_qty_base_uom: variableConversion ? null : Number((orderedQty * conversionFactor).toFixed(6)),
      unit_rate: Number(unitRate.toFixed(4)),
      total_value: Number((orderedQty * unitRate).toFixed(4)),
      open_qty: Number(orderedQty.toFixed(6)),
      line_status: "OPEN",
      remarks: toTrimmedString(rawLine.remarks) || null,
      created_at: new Date().toISOString(),
      last_updated_at: null,
    });
  }

  return prepared;
}

export async function createPOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const body = await parseBody(req);
    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const vendorId = toTrimmedString(body.vendor_id);
    const paymentTermId = toTrimmedString(body.payment_term_id);
    const vendorType = toUpperTrimmedString(body.vendor_type);
    const deliveryType = toUpperTrimmedString(body.delivery_type || "STANDARD");
    const freightTerm = toUpperTrimmedString(body.freight_term);
    const poDate = toTrimmedString(body.po_date) || new Date().toISOString().slice(0, 10);

    if (!companyId) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_COMPANY_REQUIRED", 400, "Company is required");
    }

    const vendor = await getVendorRow(vendorId);
    if (!vendor) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_VENDOR_NOT_FOUND", 404, "Vendor not found");
    }

    if (!PO_VENDOR_TYPES.has(vendorType)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_VENDOR_TYPE", 400, "Invalid vendor type");
    }
    if (!DELIVERY_TYPES.has(deliveryType)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_DELIVERY_TYPE", 400, "Invalid delivery type");
    }
    if (!FREIGHT_TERMS.has(freightTerm)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_FREIGHT_TERM", 400, "Invalid freight term");
    }

    const incoterm = toTrimmedString(body.incoterm) || await getLastUsedIncoterm(vendorId) || null;
    if (vendorType === "IMPORT" && !incoterm) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INCOTERM_REQUIRED", 400, "Incoterm required for import PO");
    }

    const paymentTerm = await getPaymentTermRow(
      paymentTermId || await getLastUsedPaymentTerm(vendorId) || "",
    );
    if (!paymentTerm?.id) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PAYMENT_TERM_NOT_FOUND", 404, "Payment term not found");
    }

    const preparedLines = await buildPoLinesForInsert(ctx, vendorId, body.lines);
    const poNumber = await generateCompanyDocNumber(companyId, "PO");
    const lcRequired = toUpperTrimmedString(paymentTerm.payment_method) === "LC";
    const indentRequired = body.indent_required === true || vendor.indent_number_required === true;

    const { data: poData, error: poError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order")
      .insert({
        po_number: poNumber,
        po_date: poDate,
        company_id: companyId,
        plant_id: toTrimmedString(body.plant_id) || null,
        vendor_id: vendorId,
        vendor_type: vendorType,
        incoterm,
        freight_term: freightTerm,
        payment_term_id: paymentTerm.id,
        lc_required: lcRequired,
        delivery_type: deliveryType,
        has_rebate: body.has_rebate === true,
        rebate_remarks: toTrimmedString(body.rebate_remarks) || null,
        indent_required: indentRequired,
        expected_delivery_date: toTrimmedString(body.expected_delivery_date) || null,
        status: "DRAFT",
        remarks: toTrimmedString(body.remarks) || null,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (poError || !poData) {
      throw new Error("PROCUREMENT_PO_CREATE_FAILED");
    }

    const poId = toTrimmedString(poData.id);
    const linePayload = preparedLines.map((line) => ({ ...line, po_id: poId }));

    const { data: lineData, error: lineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order_line")
      .insert(linePayload)
      .select("*");

    if (lineError) {
      throw new Error("PROCUREMENT_PO_LINES_CREATE_FAILED");
    }

    return okResponse({
      data: {
        ...poData,
        lines: lineData ?? [],
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_CREATE_FAILED";
    const status =
      code === "PROCUREMENT_VENDOR_NOT_FOUND" || code === "PROCUREMENT_PAYMENT_TERM_NOT_FOUND"
        ? 404
        : code.includes("REQUIRED") || code.includes("INVALID")
          ? 400
          : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order create failed");
  }
}

export async function listPOsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const url = new URL(req.url);
    const companyId = getCompanyScope(ctx, url.searchParams.get("company_id") ?? "");
    const statusFilter = toUpperTrimmedString(url.searchParams.get("status"));
    const vendorId = toTrimmedString(url.searchParams.get("vendor_id"));
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);
    const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (companyId) {
      query = query.eq("company_id", companyId);
    }
    if (statusFilter && PO_HEADER_STATUSES.has(statusFilter)) {
      query = query.eq("status", statusFilter);
    }
    if (vendorId) {
      query = query.eq("vendor_id", vendorId);
    }
    if (dateFrom) {
      query = query.gte("po_date", dateFrom);
    }
    if (dateTo) {
      query = query.lte("po_date", dateTo);
    }

    const { data, error, count } = await query;
    if (error) {
      throw new Error("PROCUREMENT_PO_LIST_FAILED");
    }

    return okResponse({ data: data ?? [], total: count ?? 0 }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "Purchase order list failed");
  }
}

export async function getPOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const poId = getPoIdFromPath(req);
    const companyId = getCompanyScope(ctx);
    const po = await getPOById(poId, companyId);

    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }

    const [lines, approvalLogResult, amendmentLogResult] = await Promise.all([
      getPOLines(poId),
      serviceRoleClient
        .schema("erp_procurement")
        .from("po_approval_log")
        .select("*")
        .eq("po_id", poId)
        .order("actioned_at", { ascending: false }),
      serviceRoleClient
        .schema("erp_procurement")
        .from("po_amendment_log")
        .select("*")
        .eq("po_id", poId)
        .order("amended_at", { ascending: false }),
    ]);

    if (approvalLogResult.error || amendmentLogResult.error) {
      throw new Error("PROCUREMENT_PO_DETAIL_FAILED");
    }

    return okResponse({
      data: {
        ...po,
        lines,
        approval_log: approvalLogResult.data ?? [],
        amendment_log: amendmentLogResult.data ?? [],
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_DETAIL_FAILED";
    const status = code === "PROCUREMENT_PO_NOT_FOUND" ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order detail failed");
  }
}

export async function updatePOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const poId = getPoIdFromPath(req);
    const body = await parseBody(req);
    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const po = await getPOById(poId, companyId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    if (toUpperTrimmedString(po.status) !== "DRAFT") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_DRAFT", 422, "Only DRAFT PO can be updated");
    }

    const vendorId = toTrimmedString(body.vendor_id || po.vendor_id);
    const paymentTermId = toTrimmedString(body.payment_term_id || po.payment_term_id);
    const vendorType = toUpperTrimmedString(body.vendor_type || po.vendor_type);
    const deliveryType = toUpperTrimmedString(body.delivery_type || po.delivery_type);
    const freightTerm = toUpperTrimmedString(body.freight_term || po.freight_term);
    const incoterm = toTrimmedString(body.incoterm ?? po.incoterm);

    if (!DELIVERY_TYPES.has(deliveryType) || !PO_VENDOR_TYPES.has(vendorType) || !FREIGHT_TERMS.has(freightTerm)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_PO_VALUES", 400, "Invalid PO header values");
    }
    if (vendorType === "IMPORT" && !incoterm) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INCOTERM_REQUIRED", 400, "Incoterm required for import PO");
    }

    const paymentTerm = await getPaymentTermRow(paymentTermId);
    if (!paymentTerm) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PAYMENT_TERM_NOT_FOUND", 404, "Payment term not found");
    }

    const preparedLines = await buildPoLinesForInsert(ctx, vendorId, body.lines);

    const { data: updatedPo, error: poError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order")
      .update({
        po_date: toTrimmedString(body.po_date) || po.po_date,
        plant_id: toTrimmedString(body.plant_id) || po.plant_id || null,
        vendor_id: vendorId,
        vendor_type: vendorType,
        incoterm: incoterm || null,
        freight_term: freightTerm,
        payment_term_id: paymentTerm.id,
        lc_required: toUpperTrimmedString(paymentTerm.payment_method) === "LC",
        delivery_type: deliveryType,
        has_rebate: body.has_rebate === true,
        rebate_remarks: toTrimmedString(body.rebate_remarks) || null,
        indent_required: body.indent_required === true || po.indent_required === true,
        expected_delivery_date: toTrimmedString(body.expected_delivery_date) || null,
        remarks: toTrimmedString(body.remarks) || null,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", poId)
      .select("*")
      .single();

    if (poError || !updatedPo) {
      throw new Error("PROCUREMENT_PO_UPDATE_FAILED");
    }

    const deleteResult = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order_line")
      .delete()
      .eq("po_id", poId);

    if (deleteResult.error) {
      throw new Error("PROCUREMENT_PO_LINES_DELETE_FAILED");
    }

    const { data: lineData, error: lineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order_line")
      .insert(preparedLines.map((line) => ({ ...line, po_id: poId })))
      .select("*");

    if (lineError) {
      throw new Error("PROCUREMENT_PO_LINES_CREATE_FAILED");
    }

    return okResponse({
      data: {
        ...updatedPo,
        lines: lineData ?? [],
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_UPDATE_FAILED";
    const status =
      code === "PROCUREMENT_PO_NOT_FOUND" || code === "PROCUREMENT_PAYMENT_TERM_NOT_FOUND"
        ? 404
        : code.includes("NOT_DRAFT")
          ? 422
          : code.includes("REQUIRED") || code.includes("INVALID")
            ? 400
            : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order update failed");
  }
}

export async function deletePOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const poId = getPoIdFromPath(req);
    const companyId = getCompanyScope(ctx);
    const po = await getPOById(poId, companyId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    if (toUpperTrimmedString(po.status) !== "DRAFT") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_DRAFT", 422, "Only DRAFT PO can be deleted");
    }

    const lines = await getPOLines(poId);
    if (lines.some(lineHasReceipt)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_DELETE_BLOCKED", 400, "PO cannot be deleted after receipt activity");
    }

    const lineDelete = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order_line")
      .delete()
      .eq("po_id", poId);

    if (lineDelete.error) {
      throw new Error("PROCUREMENT_PO_LINES_DELETE_FAILED");
    }

    const poDelete = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order")
      .delete()
      .eq("id", poId);

    if (poDelete.error) {
      throw new Error("PROCUREMENT_PO_DELETE_FAILED");
    }

    return okResponse({ data: { id: poId, deleted: true } }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_DELETE_FAILED";
    const status = code === "PROCUREMENT_PO_NOT_FOUND" ? 404 : code.includes("NOT_DRAFT") ? 422 : code.includes("BLOCKED") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order delete failed");
  }
}

export async function confirmPOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const poId = getPoIdFromPath(req);
    const body = await parseBody(req);
    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const po = await getPOById(poId, companyId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    if (toUpperTrimmedString(po.status) !== "DRAFT") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_CONFIRM_BLOCKED", 422, "Only DRAFT PO can be confirmed");
    }

    const requiresApproval = body.approval_required === true;
    const nextStatus = requiresApproval ? "PENDING_APPROVAL" : "CONFIRMED";

    const { data: updatedPo, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order")
      .update({
        status: nextStatus,
        approved_at: nextStatus === "CONFIRMED" ? new Date().toISOString() : null,
        approved_by: nextStatus === "CONFIRMED" ? ctx.auth_user_id : null,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", poId)
      .select("*")
      .single();

    if (error || !updatedPo) {
      throw new Error("PROCUREMENT_PO_CONFIRM_FAILED");
    }

    if (nextStatus === "PENDING_APPROVAL") {
      await insertPoApprovalLog({
        poId,
        action: "ESCALATED",
        fromStatus: "DRAFT",
        toStatus: "PENDING_APPROVAL",
        remarks: toTrimmedString(body.remarks) || null,
        actionedBy: ctx.auth_user_id,
      });
    } else {
      await createCsnsForPo(updatedPo as PurchaseOrderRow, await getPOLines(poId), ctx.auth_user_id);
    }

    return okResponse({ data: updatedPo }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_CONFIRM_FAILED";
    const status = code === "PROCUREMENT_PO_NOT_FOUND" ? 404 : code.includes("BLOCKED") ? 422 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order confirm failed");
  }
}

export async function approvePOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementHeadRole(ctx);

    const poId = getPoIdFromPath(req);
    const body = await parseBody(req);
    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const po = await getPOById(poId, companyId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    if (toUpperTrimmedString(po.status) !== "PENDING_APPROVAL") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_APPROVAL_STATE_INVALID", 422, "PO is not pending approval");
    }

    const { data: updatedPo, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order")
      .update({
        status: "CONFIRMED",
        approved_by: ctx.auth_user_id,
        approved_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", poId)
      .select("*")
      .single();

    if (error || !updatedPo) {
      throw new Error("PROCUREMENT_PO_APPROVE_FAILED");
    }

    await insertPoApprovalLog({
      poId,
      action: "APPROVED",
      fromStatus: "PENDING_APPROVAL",
      toStatus: "CONFIRMED",
      remarks: toTrimmedString(body.remarks) || null,
      actionedBy: ctx.auth_user_id,
    });
    await createCsnsForPo(updatedPo as PurchaseOrderRow, await getPOLines(poId), ctx.auth_user_id);

    return okResponse({ data: updatedPo }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_APPROVE_FAILED";
    const status =
      code === "PROCUREMENT_PO_NOT_FOUND" ? 404
        : code === "PROCUREMENT_HEAD_REQUIRED" ? 403
        : code.includes("INVALID") ? 422
        : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order approval failed");
  }
}

export async function rejectPOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementHeadRole(ctx);

    const poId = getPoIdFromPath(req);
    const body = await parseBody(req);
    const remarks = toTrimmedString(body.remarks);
    if (!remarks) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_REMARKS_REQUIRED", 400, "Remarks are required");
    }

    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const po = await getPOById(poId, companyId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    if (toUpperTrimmedString(po.status) !== "PENDING_APPROVAL") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_APPROVAL_STATE_INVALID", 422, "PO is not pending approval");
    }

    const { data: updatedPo, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order")
      .update({
        status: "DRAFT",
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", poId)
      .select("*")
      .single();

    if (error || !updatedPo) {
      throw new Error("PROCUREMENT_PO_REJECT_FAILED");
    }

    await insertPoApprovalLog({
      poId,
      action: "REJECTED",
      fromStatus: "PENDING_APPROVAL",
      toStatus: "DRAFT",
      remarks,
      actionedBy: ctx.auth_user_id,
    });

    return okResponse({ data: updatedPo }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_REJECT_FAILED";
    const status =
      code === "PROCUREMENT_PO_NOT_FOUND" ? 404
        : code === "PROCUREMENT_HEAD_REQUIRED" ? 403
        : code.includes("REQUIRED") ? 400
        : code.includes("INVALID") ? 422
        : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order rejection failed");
  }
}

export async function amendPOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const poId = getPoIdFromPath(req);
    const body = await parseBody(req);
    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const po = await getPOById(poId, companyId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }

    const currentStatus = toUpperTrimmedString(po.status);
    if (currentStatus !== "CONFIRMED" && currentStatus !== "PENDING_APPROVAL") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_AMEND_BLOCKED", 422, "PO cannot be amended in current state");
    }

    const poLineId = toTrimmedString(body.po_line_id);
    const existingLines = await getPOLines(poId);
    const targetLine = poLineId
      ? existingLines.find((line) => toTrimmedString(line.id) === poLineId) ?? null
      : null;

    if (poLineId && !targetLine) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_LINE_NOT_FOUND", 404, "PO line not found");
    }

    const amendmentNumber = await getNextAmendmentNumber(poId);
    const amendmentEntries: JsonRecord[] = [];
    let requiresApproval = false;
    const headerUpdates: JsonRecord = {
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    };
    const lineUpdates: JsonRecord = {
      last_updated_at: new Date().toISOString(),
    };

    const pushAmendment = (
      fieldName: string,
      oldValue: unknown,
      newValue: unknown,
      targetLineId?: string | null,
    ): void => {
      amendmentEntries.push({
        po_id: poId,
        po_line_id: targetLineId || null,
        amendment_number: amendmentNumber,
        field_changed: fieldName,
        old_value: oldValue == null ? null : String(oldValue),
        new_value: newValue == null ? null : String(newValue),
        requires_approval: fieldName === "ordered_qty" || fieldName === "unit_rate",
        approval_status: fieldName === "ordered_qty" || fieldName === "unit_rate" ? "PENDING" : "APPROVED",
        approved_by: fieldName === "ordered_qty" || fieldName === "unit_rate" ? null : ctx.auth_user_id,
        approved_at: fieldName === "ordered_qty" || fieldName === "unit_rate" ? null : new Date().toISOString(),
        amended_by: ctx.auth_user_id,
      });
    };

    const candidateFields: Record<string, unknown> = {
      ordered_qty: body.ordered_qty,
      unit_rate: body.unit_rate,
      expected_delivery_date: body.delivery_date ?? body.expected_delivery_date,
      incoterm: body.incoterm,
      payment_term_id: body.payment_term_id,
      cost_center_id: body.cost_center_id,
      remarks: body.remarks,
    };

    for (const [fieldName, rawValue] of Object.entries(candidateFields)) {
      if (rawValue === undefined || !MUTABLE_AMENDMENT_FIELDS.has(fieldName)) {
        continue;
      }

      if (fieldName === "ordered_qty" || fieldName === "unit_rate" || fieldName === "cost_center_id") {
        if (!targetLine) {
          return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_LINE_REQUIRED", 400, "PO line id is required for line amendment");
        }
      }

      const normalizedValue = typeof rawValue === "string" ? rawValue.trim() : rawValue;
      let oldValue: unknown;
      if (fieldName === "ordered_qty" || fieldName === "unit_rate" || fieldName === "cost_center_id") {
        oldValue = targetLine?.[fieldName];
      } else {
        oldValue = po[fieldName];
      }

      if (String(oldValue ?? "") === String(normalizedValue ?? "")) {
        continue;
      }

      if (fieldName === "ordered_qty" || fieldName === "unit_rate") {
        requiresApproval = true;
      }

      pushAmendment(fieldName, oldValue, normalizedValue, targetLine ? toTrimmedString(targetLine.id) : null);

      if (fieldName === "ordered_qty") {
        const orderedQty = parsePositiveNumber(normalizedValue);
        if (!orderedQty) {
          return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_LINE_VALUES", 400, "Invalid ordered quantity");
        }
        const previousOrderedQty = Number(targetLine?.ordered_qty ?? 0);
        const openQty = Number(targetLine?.open_qty ?? previousOrderedQty);
        const alreadyReceivedQty = Math.max(previousOrderedQty - openQty, 0);
        lineUpdates.ordered_qty = orderedQty;
        lineUpdates.open_qty = Number(Math.max(orderedQty - alreadyReceivedQty, 0).toFixed(6));
        lineUpdates.total_value = Number((orderedQty * Number(targetLine?.unit_rate ?? 0)).toFixed(4));
      } else if (fieldName === "unit_rate") {
        const unitRate = parsePositiveNumber(normalizedValue);
        if (!unitRate) {
          return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_LINE_VALUES", 400, "Invalid unit rate");
        }
        lineUpdates.unit_rate = Number(unitRate.toFixed(4));
        lineUpdates.total_value = Number((Number(targetLine?.ordered_qty ?? 0) * unitRate).toFixed(4));
      } else if (fieldName === "cost_center_id") {
        const costCenterId = toTrimmedString(normalizedValue);
        if (!(await getCostCenterRow(costCenterId))) {
          return procurementErrorResponse(req, ctx, "PROCUREMENT_COST_CENTER_NOT_FOUND", 404, "Cost center not found");
        }
        lineUpdates.cost_center_id = costCenterId;
      } else {
        headerUpdates[fieldName] = normalizedValue || null;
      }
    }

    if (amendmentEntries.length === 0) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_NO_AMENDMENT_CHANGES", 400, "No amendment changes provided");
    }

    const effectivePendingStatus = requiresApproval ? "PENDING_APPROVAL" : currentStatus;

    const { data: updatedPo, error: poUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order")
      .update({
        ...headerUpdates,
        status: effectivePendingStatus,
      })
      .eq("id", poId)
      .select("*")
      .single();

    if (poUpdateError || !updatedPo) {
      throw new Error("PROCUREMENT_PO_AMEND_FAILED");
    }

    if (targetLine && Object.keys(lineUpdates).length > 1) {
      const lineUpdateResult = await serviceRoleClient
        .schema("erp_procurement")
        .from("purchase_order_line")
        .update(lineUpdates)
        .eq("id", targetLine.id)
        .select("*")
        .single();

      if (lineUpdateResult.error) {
        throw new Error("PROCUREMENT_PO_LINE_AMEND_FAILED");
      }
    }

    const amendmentInsert = await serviceRoleClient
      .schema("erp_procurement")
      .from("po_amendment_log")
      .insert(amendmentEntries);

    if (amendmentInsert.error) {
      throw new Error("PROCUREMENT_PO_AMEND_LOG_FAILED");
    }

    return okResponse({
      data: {
        ...updatedPo,
        requires_approval: requiresApproval,
        workflow_status: requiresApproval ? "PENDING_AMENDMENT" : updatedPo.status,
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_AMEND_FAILED";
    const status =
      code === "PROCUREMENT_PO_NOT_FOUND" || code === "PROCUREMENT_PO_LINE_NOT_FOUND" || code === "PROCUREMENT_COST_CENTER_NOT_FOUND"
        ? 404
        : code.includes("BLOCKED") || code.includes("INVALID")
          ? 422
          : code.includes("REQUIRED") || code.includes("NO_AMENDMENT")
            ? 400
            : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order amendment failed");
  }
}

export async function approveAmendmentHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementHeadRole(ctx);

    const poId = getPoIdFromPath(req);
    const body = await parseBody(req);
    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const po = await getPOById(poId, companyId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }

    const { data: pendingLogs, error: logError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("po_amendment_log")
      .select("*")
      .eq("po_id", poId)
      .eq("requires_approval", true)
      .eq("approval_status", "PENDING");

    if (logError) {
      throw new Error("PROCUREMENT_PO_AMEND_LOOKUP_FAILED");
    }
    if (!pendingLogs || pendingLogs.length === 0) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_NO_PENDING_AMENDMENT", 422, "No pending amendment found");
    }

    const nowIso = new Date().toISOString();
    const logUpdate = await serviceRoleClient
      .schema("erp_procurement")
      .from("po_amendment_log")
      .update({
        approval_status: "APPROVED",
        approved_by: ctx.auth_user_id,
        approved_at: nowIso,
        rejection_reason: null,
      })
      .eq("po_id", poId)
      .eq("requires_approval", true)
      .eq("approval_status", "PENDING");

    if (logUpdate.error) {
      throw new Error("PROCUREMENT_PO_AMEND_APPROVE_FAILED");
    }

    const { data: updatedPo, error: poUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order")
      .update({
        status: "CONFIRMED",
        last_updated_at: nowIso,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", poId)
      .select("*")
      .single();

    if (poUpdateError || !updatedPo) {
      throw new Error("PROCUREMENT_PO_AMEND_APPROVE_FAILED");
    }

    await insertPoApprovalLog({
      poId,
      action: "APPROVED",
      fromStatus: "PENDING_AMENDMENT",
      toStatus: "CONFIRMED",
      remarks: toTrimmedString(body.remarks) || null,
      actionedBy: ctx.auth_user_id,
    });

    return okResponse({ data: updatedPo }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_AMEND_APPROVE_FAILED";
    const status =
      code === "PROCUREMENT_PO_NOT_FOUND" ? 404
        : code === "PROCUREMENT_HEAD_REQUIRED" ? 403
        : code.includes("NO_PENDING") ? 422
        : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order amendment approval failed");
  }
}

export async function cancelPOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const poId = getPoIdFromPath(req);
    const body = await parseBody(req);
    const reason = toTrimmedString(body.cancellation_reason || body.reason);
    if (!reason) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CANCELLATION_REASON_REQUIRED", 400, "Cancellation reason is required");
    }

    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const po = await getPOById(poId, companyId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }

    const lines = await getPOLines(poId);
    if (lines.some(lineHasReceipt)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_CANCEL_BLOCKED", 400, "PO cannot be cancelled after GRN receipt");
    }

    const nowIso = new Date().toISOString();
    const { data: updatedPo, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order")
      .update({
        status: "CANCELLED",
        cancellation_reason: reason,
        cancelled_at: nowIso,
        cancelled_by: ctx.auth_user_id,
        last_updated_at: nowIso,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", poId)
      .select("*")
      .single();

    if (error || !updatedPo) {
      throw new Error("PROCUREMENT_PO_CANCEL_FAILED");
    }

    const lineCancelResult = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order_line")
      .update({
        line_status: "CANCELLED",
        remarks: reason,
        last_updated_at: nowIso,
      })
      .eq("po_id", poId)
      .in("line_status", ["OPEN", "PARTIALLY_RECEIVED"]);

    if (lineCancelResult.error) {
      throw new Error("PROCUREMENT_PO_CANCEL_FAILED");
    }

    const csnCancelResult = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .update({
        status: "CLOSED",
        remarks: reason,
        last_updated_at: nowIso,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("po_id", poId)
      .eq("status", "ORDERED");

    if (csnCancelResult.error) {
      throw new Error("PROCUREMENT_PO_CANCEL_FAILED");
    }

    return okResponse({ data: updatedPo }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_CANCEL_FAILED";
    const status =
      code === "PROCUREMENT_PO_NOT_FOUND" ? 404
        : code.includes("REQUIRED") || code.includes("BLOCKED")
          ? 400
          : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order cancellation failed");
  }
}

export async function knockOffPOLineHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const poId = getPoIdFromPath(req);
    const lineId = getLineIdFromPath(req);
    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason || body.knock_off_reason);
    if (!reason) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_KNOCK_OFF_REASON_REQUIRED", 400, "Knock-off reason is required");
    }

    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const po = await getPOById(poId, companyId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }

    const lines = await getPOLines(poId);
    const targetLine = lines.find((line) => toTrimmedString(line.id) === lineId);
    if (!targetLine) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_LINE_NOT_FOUND", 404, "PO line not found");
    }

    const nowIso = new Date().toISOString();
    const { data: updatedLine, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order_line")
      .update({
        line_status: "KNOCKED_OFF",
        knock_off_reason: reason,
        knocked_off_at: nowIso,
        knocked_off_by: ctx.auth_user_id,
        remarks: reason,
        last_updated_at: nowIso,
      })
      .eq("id", lineId)
      .select("*")
      .single();

    if (error || !updatedLine) {
      throw new Error("PROCUREMENT_PO_LINE_KNOCK_OFF_FAILED");
    }

    const remainingLines = lines.map((line) =>
      toTrimmedString(line.id) === lineId ? { ...line, line_status: "KNOCKED_OFF" } : line
    );

    if (remainingLines.every((line) => {
      const status = toUpperTrimmedString(line.line_status);
      return status === "KNOCKED_OFF" || status === "FULLY_RECEIVED" || status === "CANCELLED";
    })) {
      await serviceRoleClient
        .schema("erp_procurement")
        .from("purchase_order")
        .update({
          status: "CLOSED",
          last_updated_at: nowIso,
          last_updated_by: ctx.auth_user_id,
        })
        .eq("id", poId);
    }

    return okResponse({ data: updatedLine }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_LINE_KNOCK_OFF_FAILED";
    const status = code === "PROCUREMENT_PO_NOT_FOUND" || code === "PROCUREMENT_PO_LINE_NOT_FOUND" ? 404 : code.includes("REQUIRED") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order line knock-off failed");
  }
}

export async function knockOffPOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const poId = getPoIdFromPath(req);
    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason || body.knock_off_reason);
    if (!reason) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_KNOCK_OFF_REASON_REQUIRED", 400, "Knock-off reason is required");
    }

    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const po = await getPOById(poId, companyId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }

    const nowIso = new Date().toISOString();
    const lineUpdateResult = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order_line")
      .update({
        line_status: "KNOCKED_OFF",
        knock_off_reason: reason,
        knocked_off_at: nowIso,
        knocked_off_by: ctx.auth_user_id,
        remarks: reason,
        last_updated_at: nowIso,
      })
      .eq("po_id", poId)
      .in("line_status", ["OPEN", "PARTIALLY_RECEIVED"]);

    if (lineUpdateResult.error) {
      throw new Error("PROCUREMENT_PO_KNOCK_OFF_FAILED");
    }

    const { data: updatedPo, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order")
      .update({
        status: "CLOSED",
        remarks: reason,
        last_updated_at: nowIso,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", poId)
      .select("*")
      .single();

    if (error || !updatedPo) {
      throw new Error("PROCUREMENT_PO_KNOCK_OFF_FAILED");
    }

    return okResponse({ data: updatedPo }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_KNOCK_OFF_FAILED";
    const status = code === "PROCUREMENT_PO_NOT_FOUND" ? 404 : code.includes("REQUIRED") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order knock-off failed");
  }
}
