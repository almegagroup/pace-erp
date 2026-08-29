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
import { todayIsoInKolkata } from "../../_shared/dateUtils.ts";
import { generateMaterialDocNumber } from "../../_shared/materialDocument.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { INDIAN_STATE_NAMES } from "../../_shared/indianStates.ts";
import { readAclSnapshotDecisionAny } from "../../_shared/acl_snapshot.ts";

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
const SALES_INVOICE_STATUSES = new Set(["DRAFT", "POSTED", "CANCELLED"]);
const GST_TYPES = new Set(["CGST_SGST", "IGST"]);
const REBATE_BASIS_VALUES = new Set(["BASE_UOM", "PO_UOM"]);
const PACKAGING_BASIS_VALUES = new Set(["FLAT", "PER_KG"]);
const PACKAGING_GST_TREATMENTS = new Set(["NO_GST", "SAME_AS_MATERIAL", "CUSTOM"]);
const SHIP_TO_TYPES = new Set(["REGISTERED", "UNREGISTERED"]);

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
  return todayIsoInKolkata();
}

type ResolvedShipTo = {
  ship_to_same_as_customer: boolean;
  ship_to_type: string | null;
  ship_to_gst_number: string | null;
  ship_to_name: string | null;
  ship_to_address: string | null;
  ship_to_state: string | null;
  delivery_address: string | null;
};

// §113.16 — GST place-of-supply is the Ship-To location, not the customer's
// registered/billing address -- those can legitimately differ. Resolves to
// an EFFECTIVE value either way (copies the customer's own data when
// same_as_customer, or takes the caller's manual entry otherwise) so no
// downstream code (DO create, PGI GST-type derivation) ever needs to branch
// on same_as_customer or re-query customer_master.
function resolveShipTo(body: JsonRecord, customer: JsonRecord): ResolvedShipTo {
  const sameAsCustomer = body.ship_to_same_as_customer === undefined ? true : Boolean(body.ship_to_same_as_customer);
  if (sameAsCustomer) {
    const address = toTrimmedString(customer.delivery_address) || toTrimmedString(customer.billing_address) || null;
    return {
      ship_to_same_as_customer: true,
      ship_to_type: null,
      ship_to_gst_number: null,
      ship_to_name: toTrimmedString(customer.customer_name) || null,
      ship_to_address: address,
      ship_to_state: toTrimmedString(customer.billing_state) || null,
      delivery_address: address,
    };
  }
  const shipToType = toUpperTrimmedString(body.ship_to_type) || null;
  const shipToState = toTrimmedString(body.ship_to_state) || null;
  const shipToName = toTrimmedString(body.ship_to_name) || null;
  const shipToAddress = toTrimmedString(body.ship_to_address) || null;
  const shipToGstNumber = shipToType === "REGISTERED" ? (toTrimmedString(body.ship_to_gst_number) || null) : null;
  return {
    ship_to_same_as_customer: false,
    ship_to_type: shipToType,
    ship_to_gst_number: shipToGstNumber,
    ship_to_name: shipToName,
    ship_to_address: shipToAddress,
    ship_to_state: shipToState,
    delivery_address: shipToAddress,
  };
}

function validateResolvedShipTo(resolved: ResolvedShipTo): string | null {
  if (!resolved.ship_to_state) return "SO_SHIP_TO_STATE_REQUIRED";
  if (!resolved.ship_to_same_as_customer) {
    if (!resolved.ship_to_name) return "SO_SHIP_TO_NAME_REQUIRED";
    if (!resolved.ship_to_address) return "SO_SHIP_TO_ADDRESS_REQUIRED";
    if (!resolved.ship_to_type || !SHIP_TO_TYPES.has(resolved.ship_to_type)) return "SO_SHIP_TO_TYPE_INVALID";
    if (resolved.ship_to_type === "REGISTERED" && !resolved.ship_to_gst_number) return "SO_SHIP_TO_GST_NUMBER_REQUIRED";
    // Manual Ship-To entry -- frontend dropdown only offers Indian states.
    // same_as_customer's state isn't re-checked here since it's just a copy
    // of the customer's own (already-validated-elsewhere, possibly foreign
    // for an EXPORT customer) billing_state.
    if (!INDIAN_STATE_NAMES.has(resolved.ship_to_state)) return "SO_SHIP_TO_STATE_INVALID";
  }
  return null;
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

// §112 — must validate, not just resolve a fallback: an explicitly-requested
// companyId that is NOT one of the caller's own erp_map.user_companies rows
// throws COMPANY_SCOPE_VIOLATION rather than being silently honoured.
async function getCompanyScope(ctx: ProcurementHandlerContext, requestedCompanyId?: string): Promise<string> {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  const companyId = toTrimmedString(requestedCompanyId) || scopedCompanyId;
  if (companyId) await assertCompanyScope(ctx, companyId);
  return companyId;
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
  // §113.1 — SO01 phase-1 scope is RM/PM/INT; FG dispatch is a separate future module.
  if (!["RM", "PM", "INT"].includes(materialType)) {
    throw new Error("ONLY_RM_PM_ALLOWED");
  }
  return material;
}

// §113.6 — a customer must be mapped to the SO's own company, not just
// exist anywhere in the system. customer_company_map is the source of truth
// (see om/customer.handlers.ts's mapCustomerToCompanyHandler).
async function assertCustomerMappedToCompany(customerId: string, companyId: string): Promise<void> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("customer_company_map")
    .select("customer_id")
    .eq("customer_id", customerId)
    .eq("company_id", companyId)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw new Error("SO_CUSTOMER_COMPANY_MAP_LOOKUP_FAILED");
  }
  if (!data) {
    throw new Error("CUSTOMER_NOT_MAPPED_TO_COMPANY");
  }
}

export type PackagingCostInput = {
  basis: string | null;
  rate: number | null;
  gstTreatment: string | null;
  customGstRate: number | null;
};

function computePackagingCost(input: PackagingCostInput, quantity: number): number {
  if (!input.basis || input.rate === null) {
    return 0;
  }
  return input.basis === "PER_KG" ? input.rate * quantity : input.rate;
}

// §113.9 — packaging cost formula, three GST-treatment branches.
// Exported so delivery_order.handlers.ts's DO create can recompute the same
// values at the DO's own (possibly partial-dispatch) quantity, not just
// copy the source line's full-quantity totals verbatim (§113.13).
export function computeLineValues(params: {
  rate: number;
  discountPct: number;
  quantity: number;
  materialGstRate: number | null;
  packaging: PackagingCostInput;
}): {
  netRate: number;
  packagingCostAmount: number;
  taxableValue: number;
  gstAmount: number;
  totalValue: number;
} {
  const { rate, discountPct, quantity, materialGstRate, packaging } = params;
  const netRate = Number((rate * (1 - discountPct / 100)).toFixed(4));
  const baseValue = Number((netRate * quantity).toFixed(4));
  const packagingCostAmount = Number(computePackagingCost(packaging, quantity).toFixed(4));
  const gstRate = materialGstRate ?? 0;

  if (packagingCostAmount <= 0 || packaging.gstTreatment === "NO_GST" || !packaging.gstTreatment) {
    const taxableValue = baseValue;
    const gstAmount = Number((taxableValue * gstRate / 100).toFixed(4));
    return {
      netRate,
      packagingCostAmount,
      taxableValue,
      gstAmount,
      totalValue: Number((taxableValue + gstAmount + packagingCostAmount).toFixed(4)),
    };
  }

  if (packaging.gstTreatment === "SAME_AS_MATERIAL") {
    const taxableValue = Number((baseValue + packagingCostAmount).toFixed(4));
    const gstAmount = Number((taxableValue * gstRate / 100).toFixed(4));
    return { netRate, packagingCostAmount, taxableValue, gstAmount, totalValue: Number((taxableValue + gstAmount).toFixed(4)) };
  }

  // CUSTOM
  const packagingGstRate = packaging.customGstRate ?? 0;
  const baseGstAmount = Number((baseValue * gstRate / 100).toFixed(4));
  const packagingGstAmount = Number((packagingCostAmount * packagingGstRate / 100).toFixed(4));
  const taxableValue = Number((baseValue + packagingCostAmount).toFixed(4));
  const gstAmount = Number((baseGstAmount + packagingGstAmount).toFixed(4));
  return {
    netRate,
    packagingCostAmount,
    taxableValue,
    gstAmount,
    totalValue: Number((baseValue + packagingCostAmount + baseGstAmount + packagingGstAmount).toFixed(4)),
  };
}

// §113.5 — line-level lock: a line is frozen once any DO (delivery_challan_line)
// references it. Derived, not stored — no sync-drift risk.
// §113.15 -- a cancelled DO (delivery_challan.status = CANCELLED, the new
// pre-PGI DO reversal) must release the SO line it was locking, otherwise
// "reverse the DO to edit header fields" (the error message below) would be
// false -- the line would stay locked forever even after the DO is gone.
async function fetchLockedSoLineIds(soId: string): Promise<Set<string>> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("delivery_challan_line")
    .select("so_line_id, delivery_challan!inner(sales_order_id, status)")
    .eq("delivery_challan.sales_order_id", soId)
    .neq("delivery_challan.status", "CANCELLED");

  if (error) {
    throw new Error("SO_DO_LOCK_LOOKUP_FAILED");
  }

  return new Set(
    ((data ?? []) as JsonRecord[])
      .map((row) => toTrimmedString(row.so_line_id))
      .filter(Boolean),
  );
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

async function assertSoVisibleToContext(ctx: ProcurementHandlerContext, so: SoRow): Promise<void> {
  // An ACL-MASTER can hold active access to several companies. The old
  // comparison only accepted the currently selected company, even though the
  // shared scope guard correctly accepts every assigned company.
  await assertCompanyScope(ctx, toTrimmedString(so.company_id));
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
    await assertSoVisibleToContext(ctx, so);
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
      // gate_exit_outbound's real FK column is sales_order_id — "so_id" was
      // never a real column, so this query 500'd on every SO create/fetch.
      .eq("sales_order_id", soId)
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

// Exported so delivery_order.handlers.ts's PGI+Invoice handler can reuse
// the same pre-posting checks the legacy atomic SO/STO issue handlers
// already use, instead of duplicating them.
export async function hasPhysicalInventoryBlock(
  materialId: string,
  storageLocationId: string,
  stockType: string,
): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("physical_inventory_block")
    .select("id")
    .eq("material_id", materialId)
    .eq("storage_location_id", storageLocationId)
    .eq("stock_type", stockType)
    .maybeSingle();

  if (error) {
    throw new Error("MATERIAL_POSTING_BLOCK_LOOKUP_FAILED");
  }

  return Boolean(data?.id);
}

export async function getSnapshotForIssue(
  companyId: string,
  storageLocationId: string,
  materialId: string,
): Promise<JsonRecord> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_snapshot")
    .select("*")
    .eq("company_id", companyId)
    .eq("storage_location_id", storageLocationId)
    .eq("material_id", materialId)
    .eq("stock_type_code", "UNRESTRICTED")
    .is("batch_id", null)
    .maybeSingle();

  if (error || !data) {
    throw new Error("INSUFFICIENT_STOCK");
  }

  return data;
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
  // §133.13 -- additional cost lines live in their own table (a variable-
  // length list, unlike the header's single freight_* set of columns).
  const { data: additionalCostLines, error: additionalCostLinesError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("sales_invoice_additional_cost_line")
    .select("id, category_id, amount, gst_included, gst_treatment, gst_rate, gst_amount, line_total, additional_cost_category:category_id(category_name)")
    .eq("invoice_id", invoiceId);
  if (additionalCostLinesError) throw new Error("SALES_INVOICE_ADDITIONAL_COST_FETCH_FAILED");
  const additionalCostLineRows = ((additionalCostLines ?? []) as JsonRecord[]).map((row) => ({
    ...row,
    category_name: (row.additional_cost_category as JsonRecord | null)?.category_name ?? null,
    additional_cost_category: undefined,
  }));
  return { ...invoice, lines, additional_cost_lines: additionalCostLineRows };
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
  customerBillingState: string | null;
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
      .select("gst_number, billing_state")
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
    customerBillingState: toTrimmedString(customerResp.data?.billing_state) || null,
  };
}

// §113 GST design session, 2026-07-30 — was GSTIN state-code-prefix
// comparison, which always fell through to IGST for an unregistered
// customer (no GSTIN, so the code side was always empty). Place of supply
// is the customer's own registered state, independent of registration
// status -- compare state names directly, same as vendor_master's own
// reg_address_state pattern on the purchase side.
// Exported -- already source-agnostic (just compares two state-name
// strings), so delivery_order.handlers.ts's PGI+Invoice handler reuses it
// as-is for STO (sending vs receiving company state), not just SO
// (company vs customer billing state).
export function deriveSalesInvoiceGstType(companyStateName: string | null, customerBillingState: string | null): "CGST_SGST" | "IGST" {
  const company = companyStateName?.trim().toLowerCase() ?? "";
  const customer = customerBillingState?.trim().toLowerCase() ?? "";
  if (company && customer && company === customer) {
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
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    const customerId = toTrimmedString(body.customer_id);
    const customerPoNumber = toTrimmedString(body.customer_po_number);
    const lines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];

    if (!companyId || !customerId || !customerPoNumber || lines.length === 0) {
      return salesErrorResponse(req, ctx, "SO_CREATE_INVALID", 400, "company_id, customer_id, customer_po_number, and at least one line are required.");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return salesErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    await assertCustomerMappedToCompany(customerId, companyId);

    // §113.16 -- Ship-To resolves to an effective value at save time (either
    // copied from the customer, or the caller's manual entry), never a live
    // lookup downstream.
    const { data: customer, error: customerError } = await serviceRoleClient
      .schema("erp_master")
      .from("customer_master")
      .select("customer_name, delivery_address, billing_address, billing_state")
      .eq("id", customerId)
      .maybeSingle();
    if (customerError || !customer) {
      return salesErrorResponse(req, ctx, "SO_CUSTOMER_LOOKUP_FAILED", 500, "Unable to load customer for Ship-To resolution.");
    }
    const shipTo = resolveShipTo(body, customer as JsonRecord);
    const shipToValidationError = validateResolvedShipTo(shipTo);
    if (shipToValidationError) {
      return salesErrorResponse(req, ctx, shipToValidationError, 400, "Ship-To details are incomplete (State is mandatory -- fix it on Customer Master, or uncheck 'Same as Customer' and enter it manually).");
    }

    const linePayload: JsonRecord[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const materialId = toTrimmedString(line.material_id);
      const quantity = parsePositiveNumber(line.quantity);
      const rate = parsePositiveNumber(line.rate);
      const discountPct = parseNullableNumber(line.discount_pct) ?? 0;
      const gstRate = parseNullableNumber(line.gst_rate);
      const freightTerm = toTrimmedString(line.freight_term) || null;
      const remarks = toTrimmedString(line.remarks) || null;
      const hasRebate = Boolean(line.has_rebate);
      const rebateRate = hasRebate ? parseNullableNumber(line.rebate_rate) : null;
      const rebateBasis = hasRebate ? toTrimmedString(line.rebate_rate_uom_basis).toUpperCase() || null : null;
      const rebateRemarks = hasRebate ? toTrimmedString(line.rebate_remarks) || null : null;
      const packagingBasis = toTrimmedString(line.packaging_cost_basis).toUpperCase() || null;
      const packagingRate = parseNullableNumber(line.packaging_cost_rate);
      const packagingGstTreatment = toTrimmedString(line.packaging_gst_treatment).toUpperCase() || null;
      const packagingCustomGstRate = parseNullableNumber(line.packaging_gst_rate);

      if (!materialId || !quantity || !rate) {
        return salesErrorResponse(req, ctx, "SO_LINE_INVALID", 400, `material_id, quantity, and rate are required for line ${index + 1}.`);
      }
      if (discountPct < 0 || discountPct > 100) {
        return salesErrorResponse(req, ctx, "SO_DISCOUNT_INVALID", 400, `discount_pct must be between 0 and 100 for line ${index + 1}.`);
      }
      if (hasRebate && rebateBasis && !REBATE_BASIS_VALUES.has(rebateBasis)) {
        return salesErrorResponse(req, ctx, "SO_REBATE_BASIS_INVALID", 400, `Invalid rebate basis for line ${index + 1}.`);
      }
      if (packagingBasis && !PACKAGING_BASIS_VALUES.has(packagingBasis)) {
        return salesErrorResponse(req, ctx, "SO_PACKAGING_BASIS_INVALID", 400, `Invalid packaging cost basis for line ${index + 1}.`);
      }
      if (packagingGstTreatment && !PACKAGING_GST_TREATMENTS.has(packagingGstTreatment)) {
        return salesErrorResponse(req, ctx, "SO_PACKAGING_GST_TREATMENT_INVALID", 400, `Invalid packaging GST treatment for line ${index + 1}.`);
      }
      if (packagingGstTreatment === "CUSTOM" && packagingCustomGstRate === null) {
        return salesErrorResponse(req, ctx, "SO_PACKAGING_GST_RATE_REQUIRED", 400, `Custom packaging GST rate is required for line ${index + 1}.`);
      }

      const material = await assertSalesMaterial(materialId);
      const computed = computeLineValues({
        rate,
        discountPct,
        quantity,
        materialGstRate: gstRate,
        packaging: { basis: packagingBasis, rate: packagingRate, gstTreatment: packagingGstTreatment, customGstRate: packagingCustomGstRate },
      });

      linePayload.push({
        line_number: index + 1,
        material_id: materialId,
        quantity,
        uom_code: toTrimmedString(line.uom_code) || toTrimmedString(material.base_uom_code),
        rate,
        discount_pct: discountPct,
        net_rate: computed.netRate,
        gst_rate: gstRate,
        gst_amount: computed.gstAmount,
        total_value: computed.totalValue,
        balance_qty: quantity,
        freight_term: freightTerm,
        remarks,
        has_rebate: hasRebate,
        rebate_rate: rebateRate,
        rebate_rate_uom_basis: rebateBasis,
        rebate_remarks: rebateRemarks,
        packaging_cost_basis: packagingBasis,
        packaging_cost_rate: packagingRate,
        packaging_cost_amount: computed.packagingCostAmount || null,
        packaging_gst_treatment: packagingGstTreatment,
        packaging_gst_rate: packagingGstTreatment === "CUSTOM" ? packagingCustomGstRate : null,
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
        delivery_address: shipTo.delivery_address,
        payment_term_id: toTrimmedString(body.payment_term_id) || null,
        remarks: toTrimmedString(body.remarks) || null,
        ship_to_same_as_customer: shipTo.ship_to_same_as_customer,
        ship_to_type: shipTo.ship_to_type,
        ship_to_gst_number: shipTo.ship_to_gst_number,
        ship_to_name: shipTo.ship_to_name,
        ship_to_address: shipTo.ship_to_address,
        ship_to_state: shipTo.ship_to_state,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (soError || !so) {
      console.error("[createSalesOrderHandler] sales order insert failed", {
        request_id: ctx.request_id,
        error: soError,
      });
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
    const message = code === "ONLY_RM_PM_ALLOWED" ? "Only RM/PM/INT materials allowed in Sales Order" : code;
    const status = code === "MATERIAL_NOT_FOUND" ? 404
      : code === "ONLY_RM_PM_ALLOWED" ? 400
      : code === "COMPANY_SCOPE_VIOLATION" ? 403
      : code === "CUSTOMER_NOT_MAPPED_TO_COMPANY" ? 422
      : 500;
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
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const customerId = toTrimmedString(url.searchParams.get("customer_id"));
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const search = toTrimmedString(url.searchParams.get("search")).replace(/[%_]/g, "");
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);
    const offset = parseNullableNumber(url.searchParams.get("offset")) ?? 0;

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("sales_order")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (companyId) query = query.eq("company_id", companyId);
    if (customerId) query = query.eq("customer_id", customerId);
    if (status && SO_STATUSES.has(status)) query = query.eq("status", status);
    if (dateFrom) query = query.gte("so_date", dateFrom);
    if (dateTo) query = query.lte("so_date", dateTo);
    // R-01/R-03: server-side search over the full dataset, not just the current page.
    if (search) query = query.or(`so_number.ilike.%${search}%,customer_po_number.ilike.%${search}%`);

    const { data, error, count } = await query;
    if (error) {
      return salesErrorResponse(req, ctx, "SO_LIST_FAILED", 500, "Unable to list sales orders.");
    }

    const rows = (data ?? []) as JsonRecord[];
    const soIds = rows.map((row) => toTrimmedString(row.id)).filter(Boolean);
    const headerCustomerIds = rows.map((row) => toTrimmedString(row.customer_id)).filter(Boolean);
    const companyIds = [...new Set(rows.map((row) => toTrimmedString(row.company_id)).filter(Boolean))];
    const parentCompanyIds = [...new Set(rows.map((row) => toTrimmedString(row.bill_to_parent_company_id)).filter(Boolean))];
    const depotCodeIds = [...new Set(rows.flatMap((row) => [
      toTrimmedString(row.bill_to_vdc_id),
      toTrimmedString(row.bill_to_depot_code_id),
    ]).filter(Boolean))];

    // Direct SOs acquire their consignee only when SO Map is completed. Read
    // both manual map addresses and FO-selected MM04 addresses so the register
    // always shows the latest resolved customer and Ship-To address.
    const { data: allocationData, error: allocationError } = soIds.length
      ? await serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation")
        .select("so_id, customer_address_id, fo_id").in("so_id", soIds).eq("status", "ACTIVE")
      : { data: [], error: null };
    // Mapping is display enrichment only. A temporarily unavailable map read
    // must never hide an otherwise valid SO register or block its detail page.
    if (allocationError) {
      console.error("[listSOsHandler] SO Map display enrichment unavailable", {
        request_id: ctx.request_id,
        error: allocationError,
      });
    }
    const allocationRows = allocationError ? [] as JsonRecord[] : (allocationData ?? []) as JsonRecord[];

    const foIds = [...new Set(allocationRows.map((row) => toTrimmedString(row.fo_id)).filter(Boolean))];
    const { data: foRows, error: foError } = foIds.length
      ? await serviceRoleClient.schema("erp_production").from("plan_feed").select("id, customer_address_id").in("id", foIds)
      : { data: [], error: null };
    if (foError) return salesErrorResponse(req, ctx, "SO_LIST_FO_LOOKUP_FAILED", 500, "Unable to load SO mapping details.");
    const foAddressById = new Map(((foRows ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.id), toTrimmedString(row.customer_address_id)]));

    const mappedAddressIds = allocationRows.map((row) =>
      toTrimmedString(row.customer_address_id) || foAddressById.get(toTrimmedString(row.fo_id)) || "",
    ).filter(Boolean);
    const addressIds = [...new Set(mappedAddressIds)];

    const [addressResp, companyResp, parentResp, depotResp] = await Promise.all([
      addressIds.length
        ? serviceRoleClient.schema("erp_master").from("customer_address")
          .select("id, customer_id, site_name, address_line, town, state, pin_code").in("id", addressIds)
        : Promise.resolve({ data: [] as JsonRecord[], error: null }),
      companyIds.length
        ? serviceRoleClient.schema("erp_master").from("companies").select("id, company_code, company_name").in("id", companyIds)
        : Promise.resolve({ data: [] as JsonRecord[], error: null }),
      parentCompanyIds.length
        ? serviceRoleClient.schema("erp_master").from("fg_parent_company").select("id, company_name").in("id", parentCompanyIds)
        : Promise.resolve({ data: [] as JsonRecord[], error: null }),
      depotCodeIds.length
        ? serviceRoleClient.schema("erp_master").from("fg_depot_code").select("id, code, description, dispatch_type").in("id", depotCodeIds)
        : Promise.resolve({ data: [] as JsonRecord[], error: null }),
    ]);
    if (addressResp.error || companyResp.error || parentResp.error || depotResp.error) {
      return salesErrorResponse(req, ctx, "SO_LIST_DISPLAY_LOOKUP_FAILED", 500, "Unable to load SO register details.");
    }

    const addressRows = (addressResp.data ?? []) as JsonRecord[];
    const customerIds = [...new Set([...headerCustomerIds, ...addressRows.map((row) => toTrimmedString(row.customer_id)).filter(Boolean)])];
    const { data: customerRows, error: customerError } = customerIds.length
      ? await serviceRoleClient.schema("erp_master").from("customer_master").select("id, customer_code, customer_name").in("id", customerIds)
      : { data: [], error: null };
    if (customerError) return salesErrorResponse(req, ctx, "SO_LIST_CUSTOMER_LOOKUP_FAILED", 500, "Unable to load SO customer details.");

    const customerMap = new Map(((customerRows ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.id), row]));
    const companyMap = new Map(((companyResp.data ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.id), row]));
    const parentMap = new Map(((parentResp.data ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.id), row]));
    const depotMap = new Map(((depotResp.data ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.id), row]));
    const addressMap = new Map(addressRows.map((row) => [toTrimmedString(row.id), row]));
    const mappedAddressesBySoId = new Map<string, JsonRecord[]>();
    for (const allocation of allocationRows) {
      const addressId = toTrimmedString(allocation.customer_address_id) || foAddressById.get(toTrimmedString(allocation.fo_id)) || "";
      const address = addressMap.get(addressId);
      const soId = toTrimmedString(allocation.so_id);
      if (address && soId) mappedAddressesBySoId.set(soId, [...(mappedAddressesBySoId.get(soId) ?? []), address]);
    }

    const formatAddress = (address: JsonRecord): string => [
      toTrimmedString(address.site_name), toTrimmedString(address.address_line), toTrimmedString(address.town),
      toTrimmedString(address.state), toTrimmedString(address.pin_code),
    ].filter(Boolean).join(", ");
    const formatCustomer = (customer: JsonRecord | undefined): string => customer
      ? `${toTrimmedString(customer.customer_code)}${customer.customer_code ? " - " : ""}${toTrimmedString(customer.customer_name)}`.trim()
      : "";

    const items = rows.map((row) => {
      const customer = customerMap.get(toTrimmedString(row.customer_id));
      const company = companyMap.get(toTrimmedString(row.company_id));
      const mappedAddresses = mappedAddressesBySoId.get(toTrimmedString(row.id)) ?? [];
      const mappedConsignees = [...new Set(mappedAddresses.map((address) => {
        const mappedCustomer = customerMap.get(toTrimmedString(address.customer_id));
        return [formatCustomer(mappedCustomer), formatAddress(address)].filter(Boolean).join(" | ");
      }).filter(Boolean))];
      const headerShipTo = [toTrimmedString(row.ship_to_name), toTrimmedString(row.ship_to_address)].filter(Boolean).join(" | ");
      const parent = parentMap.get(toTrimmedString(row.bill_to_parent_company_id));
      const depot = depotMap.get(toTrimmedString(row.bill_to_vdc_id)) ?? depotMap.get(toTrimmedString(row.bill_to_depot_code_id));
      return {
        ...row,
        customer_display: formatCustomer(customer) || (mappedConsignees.length === 1 ? mappedConsignees[0].split(" | ")[0] : null),
        ship_to_display: headerShipTo || mappedConsignees.join("; ") || null,
        company_display: company ? String(company.company_name ?? company.company_code ?? "") : null,
        parent_company_display: toTrimmedString(parent?.company_name) || toTrimmedString(row.bill_to_name) || null,
        depot_code_display: depot ? [toTrimmedString(depot.code), toTrimmedString(depot.description)].filter(Boolean).join(" - ") : null,
      };
    });

    return okResponse({ items, total: count ?? items.length }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_LIST_FAILED";
    return salesErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, code);
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

    if (!["CREATED", "ISSUED"].includes(toUpperTrimmedString(so.status))) {
      return salesErrorResponse(req, ctx, "SO_UPDATE_BLOCKED", 400, "Cancelled/closed sales orders cannot be updated.");
    }

    // §113.5 — header fields are a single all-or-nothing lock: the moment
    // ANY line has a DO against it, Customer/PO Number/Payment Term/Delivery
    // Address freeze together (unlike line fields, which lock individually).
    const lockedLineIds = await fetchLockedSoLineIds(soId);
    if (lockedLineIds.size > 0) {
      return salesErrorResponse(req, ctx, "SO_HEADER_LOCKED", 409, "Header is locked — a Delivery Order already exists against this SO. Reverse the DO to edit header fields.");
    }

    const patch: JsonRecord = {};
    const customerId = toTrimmedString(body.customer_id);
    const customerPoNumber = toTrimmedString(body.customer_po_number);
    const customerPoDate = toTrimmedString(body.customer_po_date);
    const deliveryAddress = body.delivery_address === null ? null : toTrimmedString(body.delivery_address);
    const paymentTermId = body.payment_term_id === null ? null : toTrimmedString(body.payment_term_id);
    const remarks = body.remarks === null ? null : toTrimmedString(body.remarks);

    const customerChanged = Boolean(customerId) && customerId !== toTrimmedString(so.customer_id);
    if (customerChanged) {
      await assertCustomerMappedToCompany(customerId, toTrimmedString(so.company_id));
      patch.customer_id = customerId;
    }
    if (customerPoNumber) patch.customer_po_number = customerPoNumber;
    if (customerPoDate) patch.customer_po_date = customerPoDate;
    if (body.payment_term_id !== undefined) patch.payment_term_id = paymentTermId || null;
    if (body.remarks !== undefined) patch.remarks = remarks || null;

    // §113.16 -- recompute Ship-To only when the caller actually touches it
    // (or the customer itself changed, which invalidates any prior
    // same-as-customer resolution) -- otherwise a plain header PATCH that
    // only sends delivery_address keeps the old raw-override behavior
    // (no dedicated Ship-To edit UI exists yet, this stays backward-compatible).
    const shipToKeysPresent = [
      "ship_to_same_as_customer", "ship_to_type", "ship_to_gst_number",
      "ship_to_name", "ship_to_address", "ship_to_state",
    ].some((key) => body[key] !== undefined);
    if (customerChanged || shipToKeysPresent) {
      const effectiveCustomerId = customerId || toTrimmedString(so.customer_id);
      const { data: customer, error: customerError } = await serviceRoleClient
        .schema("erp_master")
        .from("customer_master")
        .select("customer_name, delivery_address, billing_address, billing_state")
        .eq("id", effectiveCustomerId)
        .maybeSingle();
      if (customerError || !customer) {
        return salesErrorResponse(req, ctx, "SO_CUSTOMER_LOOKUP_FAILED", 500, "Unable to load customer for Ship-To resolution.");
      }
      const shipTo = resolveShipTo(body, customer as JsonRecord);
      const shipToValidationError = validateResolvedShipTo(shipTo);
      if (shipToValidationError) {
        return salesErrorResponse(req, ctx, shipToValidationError, 400, "Ship-To details are incomplete (State is mandatory -- fix it on Customer Master, or uncheck 'Same as Customer' and enter it manually).");
      }
      patch.delivery_address = shipTo.delivery_address;
      patch.ship_to_same_as_customer = shipTo.ship_to_same_as_customer;
      patch.ship_to_type = shipTo.ship_to_type;
      patch.ship_to_gst_number = shipTo.ship_to_gst_number;
      patch.ship_to_name = shipTo.ship_to_name;
      patch.ship_to_address = shipTo.ship_to_address;
      patch.ship_to_state = shipTo.ship_to_state;
    } else if (body.delivery_address !== undefined) {
      patch.delivery_address = deliveryAddress || null;
    }
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
    const status = code === "SO_NOT_FOUND" ? 404
      : code === "SO_SCOPE_VIOLATION" ? 403
      : code === "CUSTOMER_NOT_MAPPED_TO_COMPANY" ? 422
      : code === "SO_HEADER_LOCKED" ? 409
      : 500;
    return salesErrorResponse(req, ctx, code, status, code);
  }
}

// §113.5/§113.8 — Stage-1 line editing. Each request line is either an
// existing line (upsert/delete, blocked if locked by a DO) or a brand-new
// line (always allowed — a new line can never be locked). No line ever
// existed for SO before this redesign; header-only PATCH could not touch
// material/qty/rate at all.
export async function updateSOLinesHandler(
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
      return salesErrorResponse(req, ctx, "SO_UPDATE_BLOCKED", 400, "Cancelled/closed sales orders cannot be updated.");
    }

    const requestLines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];
    if (requestLines.length === 0) {
      return salesErrorResponse(req, ctx, "SO_LINES_REQUIRED", 400, "At least one line operation is required.");
    }

    const existingLines = await fetchSoLines(soId);
    const existingLineMap = new Map(existingLines.map((line) => [String(line.id), line]));
    const lockedLineIds = await fetchLockedSoLineIds(soId);
    let nextLineNumber = existingLines.reduce((max, line) => Math.max(max, parsePositiveNumber(line.line_number) ?? 0), 0) + 1;

    // DEPENDENT: line_number allocation for new lines must be sequential within this request.
    for (const reqLine of requestLines) {
      const lineId = toTrimmedString(reqLine.id);
      const action = toTrimmedString(reqLine._action).toUpperCase() || "UPSERT";

      if (lineId) {
        if (!existingLineMap.has(lineId)) {
          return salesErrorResponse(req, ctx, "SO_LINE_NOT_FOUND", 404, `Line ${lineId} not found on this SO.`);
        }
        if (lockedLineIds.has(lineId)) {
          return salesErrorResponse(req, ctx, "SO_LINE_LOCKED", 409, `Line is locked by an existing Delivery Order — reverse the DO to edit or remove it.`);
        }
      } else if (action === "DELETE") {
        return salesErrorResponse(req, ctx, "SO_LINE_ID_REQUIRED", 400, "id is required to delete a line.");
      }

      if (action === "DELETE") {
        const { error: deleteError } = await serviceRoleClient
          .schema("erp_procurement")
          .from("sales_order_line")
          .delete()
          .eq("id", lineId)
          .eq("so_id", soId);
        if (deleteError) {
          return salesErrorResponse(req, ctx, "SO_LINE_DELETE_FAILED", 500, "Unable to delete sales order line.");
        }
        continue;
      }

      const materialId = toTrimmedString(reqLine.material_id);
      const quantity = parsePositiveNumber(reqLine.quantity);
      const rate = parsePositiveNumber(reqLine.rate);
      const discountPct = parseNullableNumber(reqLine.discount_pct) ?? 0;
      const gstRate = parseNullableNumber(reqLine.gst_rate);
      const freightTerm = toTrimmedString(reqLine.freight_term) || null;
      const remarks = toTrimmedString(reqLine.remarks) || null;
      const hasRebate = Boolean(reqLine.has_rebate);
      const rebateRate = hasRebate ? parseNullableNumber(reqLine.rebate_rate) : null;
      const rebateBasis = hasRebate ? toTrimmedString(reqLine.rebate_rate_uom_basis).toUpperCase() || null : null;
      const rebateRemarks = hasRebate ? toTrimmedString(reqLine.rebate_remarks) || null : null;
      const packagingBasis = toTrimmedString(reqLine.packaging_cost_basis).toUpperCase() || null;
      const packagingRate = parseNullableNumber(reqLine.packaging_cost_rate);
      const packagingGstTreatment = toTrimmedString(reqLine.packaging_gst_treatment).toUpperCase() || null;
      const packagingCustomGstRate = parseNullableNumber(reqLine.packaging_gst_rate);

      if (!materialId || !quantity || !rate) {
        return salesErrorResponse(req, ctx, "SO_LINE_INVALID", 400, "material_id, quantity, and rate are required.");
      }
      if (discountPct < 0 || discountPct > 100) {
        return salesErrorResponse(req, ctx, "SO_DISCOUNT_INVALID", 400, "discount_pct must be between 0 and 100.");
      }
      if (hasRebate && rebateBasis && !REBATE_BASIS_VALUES.has(rebateBasis)) {
        return salesErrorResponse(req, ctx, "SO_REBATE_BASIS_INVALID", 400, "Invalid rebate basis.");
      }
      if (packagingBasis && !PACKAGING_BASIS_VALUES.has(packagingBasis)) {
        return salesErrorResponse(req, ctx, "SO_PACKAGING_BASIS_INVALID", 400, "Invalid packaging cost basis.");
      }
      if (packagingGstTreatment && !PACKAGING_GST_TREATMENTS.has(packagingGstTreatment)) {
        return salesErrorResponse(req, ctx, "SO_PACKAGING_GST_TREATMENT_INVALID", 400, "Invalid packaging GST treatment.");
      }
      if (packagingGstTreatment === "CUSTOM" && packagingCustomGstRate === null) {
        return salesErrorResponse(req, ctx, "SO_PACKAGING_GST_RATE_REQUIRED", 400, "Custom packaging GST rate is required.");
      }

      const material = await assertSalesMaterial(materialId);
      const computed = computeLineValues({
        rate,
        discountPct,
        quantity,
        materialGstRate: gstRate,
        packaging: { basis: packagingBasis, rate: packagingRate, gstTreatment: packagingGstTreatment, customGstRate: packagingCustomGstRate },
      });

      const linePayload = {
        material_id: materialId,
        quantity,
        uom_code: toTrimmedString(reqLine.uom_code) || toTrimmedString(material.base_uom_code),
        rate,
        discount_pct: discountPct,
        net_rate: computed.netRate,
        gst_rate: gstRate,
        gst_amount: computed.gstAmount,
        total_value: computed.totalValue,
        balance_qty: quantity,
        freight_term: freightTerm,
        remarks,
        has_rebate: hasRebate,
        rebate_rate: rebateRate,
        rebate_rate_uom_basis: rebateBasis,
        rebate_remarks: rebateRemarks,
        packaging_cost_basis: packagingBasis,
        packaging_cost_rate: packagingRate,
        packaging_cost_amount: computed.packagingCostAmount || null,
        packaging_gst_treatment: packagingGstTreatment,
        packaging_gst_rate: packagingGstTreatment === "CUSTOM" ? packagingCustomGstRate : null,
        last_updated_at: new Date().toISOString(),
      };

      if (lineId) {
        const { error: updateError } = await serviceRoleClient
          .schema("erp_procurement")
          .from("sales_order_line")
          .update(linePayload)
          .eq("id", lineId)
          .eq("so_id", soId);
        if (updateError) {
          return salesErrorResponse(req, ctx, "SO_LINE_UPDATE_FAILED", 500, "Unable to update sales order line.");
        }
      } else {
        const { error: insertError } = await serviceRoleClient
          .schema("erp_procurement")
          .from("sales_order_line")
          .insert({ ...linePayload, so_id: soId, line_number: nextLineNumber, line_status: "OPEN", issued_qty: 0 });
        if (insertError) {
          return salesErrorResponse(req, ctx, "SO_LINE_CREATE_FAILED", 500, "Unable to create sales order line.");
        }
        nextLineNumber += 1;
      }
    }

    return okResponse(await hydrateSo(soId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_LINES_UPDATE_FAILED";
    const message = code === "ONLY_RM_PM_ALLOWED" ? "Only RM/PM/INT materials allowed in Sales Order" : code;
    const status = ["SO_NOT_FOUND", "MATERIAL_NOT_FOUND", "SO_LINE_NOT_FOUND"].includes(code) ? 404
      : code === "SO_SCOPE_VIOLATION" ? 403
      : code === "SO_LINE_LOCKED" ? 409
      : ["ONLY_RM_PM_ALLOWED"].includes(code) ? 400
      : 500;
    return salesErrorResponse(req, ctx, code, status, message);
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
    const dispatchResults: Array<{ soLine: SoLineRow; issueQty: number; stockDocumentId: string; netRate: number }> = [];
    let totalDispatchQty = 0;

    // §106: one Material Document (MBLNR+MJAHR) for this whole SO issue event; the SO
    // business number becomes the reference. Shared by every issued line.
    const soMatDoc = await generateMaterialDocNumber(String(so.company_id));

    // DEPENDENT: each issue line posts stock and updates remaining SO balances, so later lines must see the committed prior reductions.
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
        storageLocationId,
        "UNRESTRICTED",
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
          p_storage_location_id: storageLocationId,
          p_material_id: soLine.material_id,
          p_quantity: issueQty,
          p_base_uom_code: soLine.uom_code,
          p_unit_value: parseNullableNumber(snapshot.valuation_rate) ?? 0,
          p_stock_type_code: "UNRESTRICTED",
          p_direction: "OUT",
          p_posted_by: ctx.auth_user_id,
          p_reversal_of_id: null,
          p_material_doc_number: soMatDoc.docNumber,
          p_material_doc_year: soMatDoc.docYear,
          p_reference_document_number: String(so.so_number),
          p_reference_document_type: "SO",
          p_reference_document_id: so.id ?? null,
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
        netRate: parseNullableNumber(soLine.net_rate) ?? 0,
      });
      totalDispatchQty += issueQty;
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

    const companyId = await getCompanyScope(ctx, String(dc.selling_company_id));
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
    const gstType = deriveSalesInvoiceGstType(taxContext.companyStateName, taxContext.customerBillingState);
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

    const soLineIds = Array.from(new Set(dcLines.map((dcLine) => toTrimmedString(dcLine.so_line_id)).filter(Boolean)));
    const { data: soLineRows, error: soLineError } = soLineIds.length > 0
      ? await serviceRoleClient
        .schema("erp_procurement")
        .from("sales_order_line")
        .select("*")
        .in("id", soLineIds)
      : { data: [], error: null };
    if (soLineError) {
      return salesErrorResponse(req, ctx, "SALES_INVOICE_CREATE_FAILED", 500, "Unable to load source sales order lines.");
    }
    const soLineMap = new Map(
      ((soLineRows ?? []) as JsonRecord[]).map((row) => [String(row.id), row]),
    );

    const linePayload: JsonRecord[] = [];
    for (const dcLine of dcLines) {
      const soLine = dcLine.so_line_id ? soLineMap.get(String(dcLine.so_line_id)) ?? null : null;
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
    const status = ["DC_NOT_FOUND"].includes(code) ? 404 : ["SALES_INVOICE_SCOPE_VIOLATION", "COMPANY_SCOPE_VIOLATION"].includes(code) ? 403 : 500;
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
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const customerId = toTrimmedString(url.searchParams.get("customer_id"));
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);
    const offset = parseNullableNumber(url.searchParams.get("offset")) ?? 0;

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("sales_invoice")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (companyId) query = query.eq("company_id", companyId);
    if (customerId) query = query.eq("customer_id", customerId);
    if (status && SALES_INVOICE_STATUSES.has(status)) query = query.eq("status", status);
    if (dateFrom) query = query.gte("invoice_date", dateFrom);
    if (dateTo) query = query.lte("invoice_date", dateTo);

    const { data, error, count } = await query;
    if (error) {
      return salesErrorResponse(req, ctx, "SALES_INVOICE_LIST_FAILED", 500, "Unable to list sales invoices.");
    }

    return okResponse({ items: data ?? [], total: count ?? (data ?? []).length }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SALES_INVOICE_LIST_FAILED";
    return salesErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, code);
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

    // Per-line recompute is independent (each line's totals only depend on its own
    // quantity/rate/gst_rate, already fetched) — compute all lines synchronously
    // first, then fire the per-line updates in parallel, then sum in-memory
    // (addition is order-independent, unlike a DB-read running balance).
    const lineComputations = lines.map((line) => {
      const quantity = parsePositiveNumber(line.quantity) ?? 0;
      const rate = parsePositiveNumber(line.rate) ?? 0;
      const taxableValue = Number((quantity * rate).toFixed(4));
      const gstRate = parseNullableNumber(line.gst_rate) ?? 0;
      const gstAmount = Number((taxableValue * gstRate / 100).toFixed(4));
      const cgstAmount = toUpperTrimmedString(invoice.gst_type) === "CGST_SGST" ? Number((gstAmount / 2).toFixed(4)) : null;
      const sgstAmount = toUpperTrimmedString(invoice.gst_type) === "CGST_SGST" ? Number((gstAmount / 2).toFixed(4)) : null;
      const igstAmount = toUpperTrimmedString(invoice.gst_type) === "IGST" ? gstAmount : null;
      const lineTotal = Number((taxableValue + gstAmount).toFixed(4));
      return { line, taxableValue, cgstAmount, sgstAmount, igstAmount, lineTotal };
    });

    const lineUpdateErrors = await Promise.all(
      lineComputations.map(async ({ line, taxableValue, cgstAmount, sgstAmount, igstAmount, lineTotal }) => {
        const { error } = await serviceRoleClient
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
        return error;
      }),
    );

    if (lineUpdateErrors.some(Boolean)) {
      return salesErrorResponse(req, ctx, "SALES_INVOICE_LINE_UPDATE_FAILED", 500, "Unable to recompute sales invoice line totals.");
    }

    let totalTaxableValue = 0;
    let totalCgstAmount = 0;
    let totalSgstAmount = 0;
    let totalIgstAmount = 0;

    for (const { taxableValue, cgstAmount, sgstAmount, igstAmount } of lineComputations) {
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

// ─── SO01 unified RM/PM/INT/SFG/FG redesign (feasibility §133.7-§133.11) ────
// Replaces createSOHandler for new Sales Orders — that legacy handler stays
// in place unmodified (still relied on for existing rows / other callers).

const DISPATCH_TYPES = new Set([
  "DEPENDENT_DIRECT", "DEPENDENT_DEPOT", "INDEPENDENT_PARTY",
  "INDEPENDENT_PARTY_ASIAN_BILLED", "DEPENDENT_NO_INBOUND",
]);
const NO_INBOUND_SUB_TYPES = new Set(["DIRECT", "DEPOT"]);
const LINE_MATERIAL_TYPES = new Set(["RM", "PM", "INT", "SFG", "FG"]);
const FG_TYPES = new Set(["MTO", "HPS", "MTEST", "MTS"]);
const RATE_BASES = new Set(["PACK_UOM", "BASE_UOM", "FIXED"]);
const GST_TREATMENTS = new Set(["INCLUSIVE", "EXCLUSIVE"]);

// §133.7 — IBN Required is hardcoded per dispatch_type for 4 of 5 types;
// INDEPENDENT_PARTY_ASIAN_BILLED is the sole exception (caller supplies it).
function resolveIbnRequired(dispatchType: string, bodyIbnRequired: unknown): boolean {
  if (dispatchType === "INDEPENDENT_PARTY_ASIAN_BILLED") {
    return Boolean(bodyIbnRequired);
  }
  if (dispatchType === "DEPENDENT_NO_INBOUND") {
    return false;
  }
  return dispatchType === "DEPENDENT_DIRECT" || dispatchType === "DEPENDENT_DEPOT";
}

// §133.14 — compositional Dispatch Category: which of F(G)/S(FG) are present,
// RPS as the RM/PM/INT base. FG present always outranks SFG-only in naming
// (FRPS vs SRPS vs FSRPS when both present).
function deriveDispatchCategory(materialTypes: string[]): string {
  const hasFg = materialTypes.includes("FG");
  const hasSfg = materialTypes.includes("SFG");
  if (hasFg && hasSfg) return "FSRPS";
  if (hasFg) return "FRPS";
  if (hasSfg) return "SRPS";
  return "RPS";
}

type ResolvedBillToShipTo = {
  billToType: string | null;
  billToParentCompanyId: string | null;
  billToDepotCodeId: string | null;
  billToVdcId: string | null;
  billToName: string | null;
  billToAddress: string | null;
  billToState: string | null;
  billToGstNumber: string | null;
  billingToDepot: boolean | null;
  customerId: string | null;
  shipTo: ResolvedShipTo | null; // null = deferred to the SO Map / separate-page flow (§133.5)
};

async function fetchParentCompany(id: string): Promise<JsonRecord> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master").from("fg_parent_company")
    .select("id, company_name, state, gst_number, full_address, pin_code, status")
    .eq("id", id).maybeSingle();
  if (error || !data) throw new Error("SO_PARENT_COMPANY_NOT_FOUND");
  return data as JsonRecord;
}

async function fetchDepotCode(id: string): Promise<JsonRecord> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master").from("fg_depot_code")
    .select("id, parent_company_id, dispatch_type, code, description, address_line, state, pin_code, gst_number, status")
    .eq("id", id).maybeSingle();
  if (error || !data) throw new Error("SO_DEPOT_CODE_NOT_FOUND");
  return data as JsonRecord;
}

// §133.8-B — Bill-To/Ship-To resolution, one branch per Dispatch Type.
// DEPENDENT_NO_INBOUND delegates to the DIRECT/DEPOT branch matching its
// sub_type (§133.9's "Direct sub-case / Depot sub-case" lock).
async function resolveBillToShipTo(body: JsonRecord, dispatchType: string): Promise<ResolvedBillToShipTo> {
  const effectiveType = dispatchType === "DEPENDENT_NO_INBOUND"
    ? (() => {
        const subType = toUpperTrimmedString(body.no_inbound_sub_type);
        if (!NO_INBOUND_SUB_TYPES.has(subType)) throw new Error("SO_NO_INBOUND_SUB_TYPE_INVALID");
        return subType === "DIRECT" ? "DEPENDENT_DIRECT" : "DEPENDENT_DEPOT";
      })()
    : dispatchType;

  if (effectiveType === "DEPENDENT_DIRECT") {
    const parentCompanyId = toTrimmedString(body.parent_company_id);
    const vdcId = toTrimmedString(body.vdc_id);
    if (!parentCompanyId || !vdcId) throw new Error("SO_PARENT_COMPANY_AND_VDC_REQUIRED");
    const parent = await fetchParentCompany(parentCompanyId);
    const vdc = await fetchDepotCode(vdcId);
    if (toUpperTrimmedString(vdc.dispatch_type) !== "DIRECT") throw new Error("SO_VDC_TYPE_INVALID");
    if (toTrimmedString(vdc.parent_company_id) !== parentCompanyId) throw new Error("SO_VDC_PARENT_COMPANY_MISMATCH");
    return {
      billToType: "PARENT_COMPANY", billToParentCompanyId: parentCompanyId, billToDepotCodeId: null,
      billToVdcId: vdcId, billToName: toTrimmedString(parent.company_name) || null,
      billToAddress: toTrimmedString(parent.full_address) || null, billToState: toTrimmedString(parent.state) || null,
      billToGstNumber: toTrimmedString(parent.gst_number) || null, billingToDepot: null, customerId: null,
      // Direct's final customer/address remains a SO Map decision. The VDC is
      // under this Parent Company, so the Parent state is sufficient for GST.
      shipTo: null,
    };
  }

  if (effectiveType === "DEPENDENT_DEPOT") {
    const parentCompanyId = toTrimmedString(body.parent_company_id);
    const depotCodeId = toTrimmedString(body.depot_code_id);
    if (!parentCompanyId || !depotCodeId) throw new Error("SO_PARENT_COMPANY_AND_DEPOT_REQUIRED");
    const depot = await fetchDepotCode(depotCodeId);
    if (toUpperTrimmedString(depot.dispatch_type) !== "DEPOT") throw new Error("SO_DEPOT_TYPE_INVALID");
    if (toTrimmedString(depot.parent_company_id) !== parentCompanyId) throw new Error("SO_DEPOT_PARENT_COMPANY_MISMATCH");
    const depotAddress: ResolvedShipTo = {
      ship_to_same_as_customer: false, ship_to_type: null, ship_to_gst_number: toTrimmedString(depot.gst_number) || null,
      ship_to_name: toTrimmedString(depot.description) || null, ship_to_address: toTrimmedString(depot.address_line) || null,
      ship_to_state: toTrimmedString(depot.state) || null, delivery_address: toTrimmedString(depot.address_line) || null,
    };
    return {
      billToType: "DEPOT", billToParentCompanyId: parentCompanyId, billToDepotCodeId: depotCodeId, billToVdcId: null,
      billToName: depotAddress.ship_to_name, billToAddress: depotAddress.ship_to_address, billToState: depotAddress.ship_to_state,
      billToGstNumber: depotAddress.ship_to_gst_number, billingToDepot: null, customerId: null,
      shipTo: depotAddress, // Bill-To = Ship-To, both the Depot's own address
    };
  }

  if (effectiveType === "INDEPENDENT_PARTY") {
    const customerId = toTrimmedString(body.customer_id);
    if (!customerId) throw new Error("SO_CUSTOMER_REQUIRED");
    const shipTo = await fetchResolvedCustomerAddress(toTrimmedString(body.ship_to_customer_address_id));
    if (shipTo.customerId !== customerId) throw new Error("SO_ADDRESS_CUSTOMER_MISMATCH");
    return {
      billToType: "CUSTOMER", billToParentCompanyId: null, billToDepotCodeId: null, billToVdcId: null,
      billToName: shipTo.ship_to_name, billToAddress: shipTo.ship_to_address, billToState: shipTo.ship_to_state,
      billToGstNumber: shipTo.ship_to_gst_number,
      billingToDepot: null, customerId, shipTo,
    };
  }

  if (effectiveType === "INDEPENDENT_PARTY_ASIAN_BILLED") {
    const customerId = toTrimmedString(body.customer_id);
    const parentCompanyId = toTrimmedString(body.parent_company_id);
    if (!customerId || !parentCompanyId) throw new Error("SO_CUSTOMER_AND_PARENT_COMPANY_REQUIRED");
    const shipTo = await fetchResolvedCustomerAddress(toTrimmedString(body.ship_to_customer_address_id));
    if (shipTo.customerId !== customerId) throw new Error("SO_ADDRESS_CUSTOMER_MISMATCH");
    const billTo = await fetchResolvedCustomerAddress(toTrimmedString(body.bill_to_customer_address_id));
    const billToVdc = billTo.depotCodeId ? await fetchDepotCode(billTo.depotCodeId) : null;
    if (!billToVdc || toTrimmedString(billToVdc.parent_company_id) !== parentCompanyId) throw new Error("SO_BILL_TO_ADDRESS_PARENT_COMPANY_MISMATCH");

    return {
      billToType: "PARENT_COMPANY",
      billToParentCompanyId: parentCompanyId, billToDepotCodeId: null, billToVdcId: billTo.depotCodeId,
      billToName: billTo.ship_to_name, billToAddress: billTo.ship_to_address, billToState: billTo.ship_to_state,
      billToGstNumber: billTo.ship_to_gst_number, billingToDepot: null, customerId, shipTo,
    };
  }

  throw new Error("SO_DISPATCH_TYPE_INVALID");
}

async function assertUnifiedSalesMaterial(materialId: string): Promise<JsonRecord> {
  return fetchMaterial(materialId);
}

// company-scope-write-acl-guard.mjs pattern (see planning.handlers.ts's
// canMaintainPlanning for the original template) — getCompanyScope/
// assertCompanyScope only prove company MEMBERSHIP, not that the caller's
// ACL grant at this SPECIFIC target company is WRITE for PROC_SO_CREATE
// (SO01's real resource_code — confirmed 2026-08-28, not a new SO01_CREATE
// code). A multi-company Accounts user with WRITE at their session's
// company but only membership (or a lesser grant) at the body's target
// company must not be able to write there.
async function canMaintainSo01Create(
  ctx: ProcurementHandlerContext,
  companyId: string,
  actionCode: "WRITE" | "EDIT" = "WRITE",
): Promise<boolean> {
  if (ctx.context.isAdmin) return true;
  if (!companyId) return false;

  let workContextIds: string[];
  if (companyId === ctx.context.companyId) {
    workContextIds =
      ctx.context.workContextIds && ctx.context.workContextIds.length > 0
        ? ctx.context.workContextIds
        : ctx.context.workContextId
          ? [ctx.context.workContextId]
          : [];
  } else {
    const { data: workContextRows, error: workContextError } = await serviceRoleClient
      .schema("erp_acl")
      .from("user_work_contexts")
      .select("work_context:work_context_id!inner(work_context_id, is_active)")
      .eq("auth_user_id", ctx.auth_user_id)
      .eq("company_id", companyId);
    if (workContextError) return false;
    workContextIds = ((workContextRows ?? []) as Array<{ work_context: unknown }>)
      .map((row) => {
        const wc = Array.isArray(row.work_context) ? row.work_context[0] : row.work_context;
        return wc && typeof wc === "object" ? (wc as { work_context_id: string; is_active: boolean }) : null;
      })
      .filter((wc): wc is { work_context_id: string; is_active: boolean } => Boolean(wc && wc.is_active === true))
      .map((wc) => wc.work_context_id);
  }
  if (workContextIds.length === 0) return false;

  const { data: versionRow, error: versionError } = await serviceRoleClient
    .schema("acl")
    .from("acl_versions")
    .select("acl_version_id")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .single();
  if (versionError || !versionRow?.acl_version_id) return false;

  const { data, error } = await readAclSnapshotDecisionAny({
    db: serviceRoleClient,
    aclVersionId: versionRow.acl_version_id as string,
    authUserId: ctx.auth_user_id,
    companyId,
    workContextIds,
    resourceCode: "PROC_SO_CREATE",
    actionCode,
  });
  if (error || !data) return false;
  return data.decision === "ALLOW";
}

// Shared by Create and Edit (Edit's "add a new line" path, §133.10) — throws
// Error(code) on any validation failure, matching this file's other shared-
// prep functions (e.g. do_unified.handlers.ts's prepareAndValidateDoLines).
// Returns the line payload (minus so_id, added by the caller) plus an
// optional HSN write-back entry.
async function prepareUnifiedSoLine(
  line: JsonRecord,
  index: number,
  materialTypes: string[],
  companyStateName: string | null,
  resolvedShipToOrBillState: string | null,
): Promise<{ payload: JsonRecord; hsnWriteBack: { materialId: string; hsnCode: string } | null }> {
  const lineMaterialType = toUpperTrimmedString(line.line_material_type);
  const materialId = toTrimmedString(line.material_id);
  const manualSkuName = lineMaterialType === "FG" && !materialId ? toTrimmedString(line.manual_sku_name) : "";
  if (!LINE_MATERIAL_TYPES.has(lineMaterialType) || !materialTypes.includes(lineMaterialType)) {
    throw new Error("SO_LINE_MATERIAL_TYPE_INVALID");
  }
  if (!materialId && !manualSkuName) throw new Error("SO_LINE_MATERIAL_REQUIRED");

  const rate = parsePositiveNumber(line.rate);
  if (!rate) throw new Error("SO_LINE_RATE_REQUIRED");
  const gstTreatment = toUpperTrimmedString(line.gst_treatment) || "EXCLUSIVE";
  if (!GST_TREATMENTS.has(gstTreatment)) throw new Error("SO_LINE_GST_TREATMENT_INVALID");
  const gstRate = parseNullableNumber(line.gst_rate) ?? 0;
  const currencyCode = toTrimmedString(line.currency_code) || "INR";
  const hsnCode = toTrimmedString(line.hsn_code) || null;
  const remarks = toTrimmedString(line.remarks) || null;

  let baseQty: number | null = null;
  let packUomCode: string | null = null;
  let packQty: number | null = null;
  let perPackQty: number | null = null;
  let rateBasis: string | null = null;
  let fgType: string | null = null;
  let batchNumber: string | null = null;
  let expiryDate: string | null = null;
  let costingRateMonth: string | null = null;
  let packingOrderId: string | null = null;

  if (lineMaterialType === "RM" || lineMaterialType === "PM" || lineMaterialType === "INT") {
    baseQty = parsePositiveNumber(line.quantity);
    if (!baseQty) throw new Error("SO_LINE_QTY_REQUIRED");
    batchNumber = toTrimmedString(line.batch_number) || null;
    expiryDate = toTrimmedString(line.expiry_date) || null;
  } else if (lineMaterialType === "SFG") {
    baseQty = parsePositiveNumber(line.quantity);
    if (!baseQty) throw new Error("SO_LINE_QTY_REQUIRED");
    batchNumber = toTrimmedString(line.batch_number) || null;
    fgType = toUpperTrimmedString(line.fg_type) || null;
    if (fgType && !FG_TYPES.has(fgType)) throw new Error("SO_LINE_FG_TYPE_INVALID");
    costingRateMonth = toTrimmedString(line.costing_rate_month) || null;
    packingOrderId = toTrimmedString(line.packing_order_id) || null;
  } else if (lineMaterialType === "FG") {
    fgType = toUpperTrimmedString(line.fg_type);
    if (!FG_TYPES.has(fgType)) throw new Error("SO_LINE_FG_TYPE_REQUIRED");
    rateBasis = toUpperTrimmedString(line.rate_basis) || (fgType === "MTEST" ? "FIXED" : "BASE_UOM");
    if (!RATE_BASES.has(rateBasis)) throw new Error("SO_LINE_RATE_BASIS_INVALID");
    if (fgType === "MTEST") {
      baseQty = parsePositiveNumber(line.base_qty);
      if (!baseQty) throw new Error("SO_LINE_BASE_QTY_REQUIRED");
      perPackQty = parsePositiveNumber(line.per_pack_qty);
      packQty = perPackQty ? Number((baseQty / perPackQty).toFixed(6)) : null;
      packUomCode = toTrimmedString(line.pack_uom_code) || "BBL";
      costingRateMonth = null;
    } else {
      packQty = parsePositiveNumber(line.pack_qty);
      perPackQty = parsePositiveNumber(line.per_pack_qty);
      if (!packQty || !perPackQty) throw new Error("SO_LINE_PACK_QTY_REQUIRED");
      baseQty = Number((packQty * perPackQty).toFixed(6));
      packUomCode = toTrimmedString(line.pack_uom_code) || null;
      costingRateMonth = toTrimmedString(line.costing_rate_month) || null;
    }
    batchNumber = toTrimmedString(line.batch_number) || null;
    packingOrderId = toTrimmedString(line.packing_order_id) || null;
  }

  let hsnWriteBack: { materialId: string; hsnCode: string } | null = null;
  if (materialId) {
    const materialForHsn = await assertUnifiedSalesMaterial(materialId);
    if (hsnCode && !toTrimmedString(materialForHsn.hsn_code)) {
      hsnWriteBack = { materialId, hsnCode };
    }
  }

  const qtyForAmount = rateBasis === "PACK_UOM" ? (packQty ?? 0) : (baseQty ?? 0);
  const taxableValue = rateBasis === "FIXED" ? rate : Number((rate * qtyForAmount).toFixed(4));
  const gstAmount = Number((taxableValue * gstRate / 100).toFixed(4));
  const gstType = deriveSalesInvoiceGstType(companyStateName, resolvedShipToOrBillState);
  const cgstAmount = gstType === "CGST_SGST" ? Number((gstAmount / 2).toFixed(4)) : 0;
  const sgstAmount = gstType === "CGST_SGST" ? Number((gstAmount / 2).toFixed(4)) : 0;
  const igstAmount = gstType === "IGST" ? gstAmount : 0;
  const totalValue = Number((taxableValue + gstAmount).toFixed(4));

  return {
    payload: {
      line_number: index + 1,
      line_material_type: lineMaterialType,
      material_id: materialId || null,
      manual_sku_name: manualSkuName || null,
      fg_type: fgType,
      quantity: baseQty,
      base_qty: baseQty,
      pack_uom_code: packUomCode,
      pack_qty: packQty,
      per_pack_qty: perPackQty,
      rate_basis: rateBasis,
      uom_code: toTrimmedString(line.uom_code) || null,
      rate,
      // The legacy SO-line schema still requires net_rate. Unified SO01 has
      // no line discount input, so its net rate is the entered rate.
      net_rate: rate,
      currency_code: currencyCode,
      gst_treatment: gstTreatment,
      gst_rate: gstRate,
      gst_amount: gstAmount,
      cgst_amount: cgstAmount,
      sgst_amount: sgstAmount,
      igst_amount: igstAmount,
      total_value: totalValue,
      balance_qty: baseQty,
      hsn_code: hsnCode,
      batch_number: batchNumber,
      expiry_date: expiryDate,
      costing_rate_month: costingRateMonth,
      packing_order_id: packingOrderId,
      remarks,
    },
    hsnWriteBack,
  };
}

type ResolvedCustomerAddress = ResolvedShipTo & { customerId: string; depotCodeId: string | null };

// MM04 is the source of truth for every customer-facing address used by SO01.
// The address is reloaded here rather than trusting a browser-sent snapshot.
async function fetchResolvedCustomerAddress(addressId: string): Promise<ResolvedCustomerAddress> {
  const { data: address, error: addressError } = await serviceRoleClient
    .schema("erp_master").from("customer_address")
    .select("id, customer_id, depot_code_id, site_name, address_line, town, state, pin_code, status")
    .eq("id", addressId).eq("status", "ACTIVE").maybeSingle();
  if (addressError || !address) throw new Error("SO_CUSTOMER_ADDRESS_NOT_FOUND");

  const customerId = toTrimmedString(address.customer_id);
  const { data: customer, error: customerError } = await serviceRoleClient
    .schema("erp_master").from("customer_master")
    .select("customer_name, gst_number").eq("id", customerId).maybeSingle();
  if (customerError || !customer) throw new Error("SO_CUSTOMER_LOOKUP_FAILED");

  const addressText = [toTrimmedString(address.address_line), toTrimmedString(address.town), toTrimmedString(address.pin_code)]
    .filter(Boolean).join(", ") || null;
  return {
    customerId,
    depotCodeId: toTrimmedString(address.depot_code_id) || null,
    ship_to_same_as_customer: true,
    ship_to_type: null,
    ship_to_gst_number: toTrimmedString(customer.gst_number) || null,
    ship_to_name: toTrimmedString(customer.customer_name) || toTrimmedString(address.site_name) || null,
    ship_to_address: addressText,
    ship_to_state: toTrimmedString(address.state) || null,
    delivery_address: addressText,
  };
}

// SO01 cannot use the generic Material Master picker for FG rows: SKU eligibility
// is defined by the approved stroke's PO type, while the pack UOM/conversion live
// in production masters. Keep this read model server-side so the UI never guesses.
export async function listSalesOrderAddressOptionsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? "");
    const customerId = toTrimmedString(url.searchParams.get("customer_id"));
    const vdcId = toTrimmedString(url.searchParams.get("vdc_id"));
    const parentCompanyId = toTrimmedString(url.searchParams.get("parent_company_id"));
    if (!companyId) return salesErrorResponse(req, ctx, "SO_CREATE_INVALID", 400, "company_id is required.");
    if (!customerId && !vdcId && !parentCompanyId) {
      return salesErrorResponse(req, ctx, "SO_ADDRESS_SCOPE_REQUIRED", 400, "An address scope is required.");
    }

    let vdcIds: string[] = vdcId ? [vdcId] : [];
    if (parentCompanyId) {
      const { data: vdcs, error: vdcError } = await serviceRoleClient
        .schema("erp_master").from("fg_depot_code")
        .select("id").eq("parent_company_id", parentCompanyId).eq("dispatch_type", "DIRECT").eq("status", "ACTIVE");
      if (vdcError) throw new Error("SO_ADDRESS_VDC_LOOKUP_FAILED");
      vdcIds = ((vdcs ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.id)).filter(Boolean);
      if (vdcIds.length === 0) return okResponse({ data: [] }, ctx.request_id, req);
    }

    let query = serviceRoleClient.schema("erp_master").from("customer_address")
      .select("id, customer_id, depot_code_id, site_name, address_line, town, state, pin_code")
      .eq("status", "ACTIVE");
    if (customerId) query = query.eq("customer_id", customerId);
    if (vdcIds.length > 0) query = query.in("depot_code_id", vdcIds);
    const { data: addresses, error: addressError } = await query.order("created_at", { ascending: true });
    if (addressError) throw new Error("SO_ADDRESS_LIST_FAILED");

    const customerIds = [...new Set(((addresses ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.customer_id)).filter(Boolean))];
    const { data: customers, error: customerError } = customerIds.length > 0
      ? await serviceRoleClient.schema("erp_master").from("customer_master").select("id, customer_code, customer_name").in("id", customerIds)
      : { data: [], error: null };
    if (customerError) throw new Error("SO_ADDRESS_CUSTOMER_LOOKUP_FAILED");
    const customerById = new Map(((customers ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.id), row]));
    return okResponse({ data: ((addresses ?? []) as JsonRecord[]).map((address) => ({
      ...address,
      customer: customerById.get(toTrimmedString(address.customer_id)) ?? null,
    })) }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "SO_ADDRESS_LIST_FAILED";
    return salesErrorResponse(req, ctx, code, 500, "SO address options could not be resolved.");
  }
}

export async function listSalesOrderFgSkuOptionsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const companyId = await getCompanyScope(ctx, new URL(req.url).searchParams.get("company_id") ?? "");
    if (!companyId) return salesErrorResponse(req, ctx, "SO_CREATE_INVALID", 400, "company_id is required.");

    const { data: companyMaps, error: companyMapError } = await serviceRoleClient
      .schema("erp_master").from("material_company_ext")
      .select("material_id, company_id").eq("status", "ACTIVE");
    if (companyMapError) throw new Error("SO_FG_SKU_COMPANY_LOOKUP_FAILED");
    const mapRows = (companyMaps ?? []) as JsonRecord[];
    const materialIds = [...new Set(mapRows.map((row) => toTrimmedString(row.material_id)).filter(Boolean))];
    if (materialIds.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    // Do not pass the mapping's UUID list through a PostgREST `in(...)` filter.
    // This endpoint is called at screen load and the generated list can make the
    // lookup fail before eligibility is evaluated. Fetch the small active FG set
    // and apply the same active-mapping scope in memory instead.
    const mappedMaterialIds = new Set(materialIds);
    const { data: materials, error: materialsError } = await serviceRoleClient
      .schema("erp_master").from("material_master")
      .select("id, pace_code, external_code, material_name, document_name, hsn_code, base_uom_code, pack_code")
      .eq("material_type", "FG").eq("status", "ACTIVE");
    if (materialsError) throw new Error("SO_FG_SKU_LOOKUP_FAILED");
    const skuRows = ((materials ?? []) as JsonRecord[])
      .filter((material) => mappedMaterialIds.has(toTrimmedString(material.id)));
    const packCodes = [...new Set(skuRows.map((row) => toTrimmedString(row.pack_code)).filter(Boolean))];
    if (packCodes.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    const { data: packs, error: packsError } = await serviceRoleClient
      .schema("erp_production").from("pack_code_master")
      .select("id, pack_code, pack_type, outer_uom_code").in("pack_code", packCodes).eq("active", true);
    if (packsError) throw new Error("SO_FG_PACK_CODE_LOOKUP_FAILED");
    const packByCode = new Map(((packs ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.pack_code), row]));

    const { data: configs, error: configsError } = await serviceRoleClient
      .schema("erp_production").from("prodshade_pack_config")
      .select("material_id, pack_code_id, variant, pack_code:pack_code_master!pack_code_id(pack_code)")
      .eq("active", true);
    if (configsError) throw new Error("SO_FG_PRODSHADE_LOOKUP_FAILED");
    const configRows = (configs ?? []) as JsonRecord[];
    const prodshadeIds = [...new Set(configRows.map((row) => toTrimmedString(row.material_id)).filter(Boolean))];
    const { data: prodshades, error: prodshadesError } = prodshadeIds.length > 0
      ? await serviceRoleClient.schema("erp_master").from("material_master")
        .select("id, external_code").in("id", prodshadeIds)
      : { data: [], error: null };
    if (prodshadesError) throw new Error("SO_FG_PRODSHADE_LOOKUP_FAILED");
    const prodshadeById = new Map(((prodshades ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.id), row]));
    const prodshadeBySkuKey = new Map<string, string>();
    for (const config of configRows) {
      const pack = (config.pack_code ?? {}) as JsonRecord;
      const prodshade = prodshadeById.get(toTrimmedString(config.material_id));
      const key = toUpperTrimmedString(`${toTrimmedString(prodshade?.external_code)}${toTrimmedString(pack.pack_code)}${toTrimmedString(config.variant)}`);
      if (key) prodshadeBySkuKey.set(key, toTrimmedString(config.material_id));
    }

    const { data: strokes, error: strokesError } = await serviceRoleClient
      .schema("erp_production").from("stroke_master")
      .select("prodshade_material_id, po_type").eq("company_id", companyId).eq("status", "APPROVED")
      .in("po_type", [...FG_TYPES]);
    if (strokesError) throw new Error("SO_FG_STROKE_LOOKUP_FAILED");
    const validStrokeKeys = new Set(((strokes ?? []) as JsonRecord[]).map((row) =>
      `${toTrimmedString(row.prodshade_material_id)}|${toUpperTrimmedString(row.po_type)}`,
    ));

    const { data: conversions, error: conversionsError } = await serviceRoleClient
      .schema("erp_master").from("material_uom_conversion")
      .select("material_id, from_uom_code, conversion_factor, variable_conversion")
      .in("material_id", skuRows.map((row) => toTrimmedString(row.id)))
      .eq("to_uom_code", "KG").eq("active", true);
    if (conversionsError) throw new Error("SO_FG_CONVERSION_LOOKUP_FAILED");
    const conversionsBySku = new Map<string, JsonRecord[]>();
    for (const conversion of (conversions ?? []) as JsonRecord[]) {
      const id = toTrimmedString(conversion.material_id);
      conversionsBySku.set(id, [...(conversionsBySku.get(id) ?? []), conversion]);
    }

    const ownMaterialIds = new Set(mapRows.filter((row) => toTrimmedString(row.company_id) === companyId).map((row) => toTrimmedString(row.material_id)));
    const output: JsonRecord[] = [];
    for (const sku of skuRows) {
      const pack = packByCode.get(toTrimmedString(sku.pack_code));
      if (!pack) continue;
      const isMtest = toUpperTrimmedString(pack.pack_type) === "MTEST";
      const skuKey = toUpperTrimmedString(sku.external_code ?? sku.material_name);
      const prodshadeId = prodshadeBySkuKey.get(skuKey) ?? "";
      const requestedTypes = isMtest ? ["MTEST"] : [...FG_TYPES].filter((type) => type !== "MTEST");
      for (const fgType of requestedTypes) {
        if (!isMtest && !validStrokeKeys.has(`${prodshadeId}|${fgType}`)) continue;
        const packUomCode = fgType === "MTEST" ? "BBL" : toTrimmedString(pack.outer_uom_code);
        const candidates = conversionsBySku.get(toTrimmedString(sku.id)) ?? [];
        const conversion = candidates.find((row) => toUpperTrimmedString(row.from_uom_code) === toUpperTrimmedString(packUomCode))
          ?? (fgType === "MTEST" ? candidates.find((row) => toUpperTrimmedString(row.from_uom_code) === "PKT") : undefined)
          ?? candidates[0];
        output.push({
          ...sku,
          fg_type: fgType,
          pack_uom_code: packUomCode,
          base_uom_code: "KG",
          per_pack_qty: conversion?.conversion_factor ?? null,
          variable_conversion: Boolean(conversion?.variable_conversion),
          own_company_mapping: ownMaterialIds.has(toTrimmedString(sku.id)),
        });
      }
    }
    output.sort((left, right) => Number(right.own_company_mapping) - Number(left.own_company_mapping)
      || toTrimmedString(left.pace_code).localeCompare(toTrimmedString(right.pace_code)));
    return okResponse({ data: output }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "SO_FG_SKU_OPTIONS_FAILED";
    return salesErrorResponse(req, ctx, code, 500, "FG SKU options could not be resolved.");
  }
}

export async function createSalesOrderUnifiedHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    const dispatchType = toUpperTrimmedString(body.dispatch_type);
    const customerPoNumber = toTrimmedString(body.customer_po_number);
    const materialTypes = Array.isArray(body.material_types)
      ? Array.from(new Set((body.material_types as unknown[]).map((v) => toUpperTrimmedString(v))))
      : [];
    const lines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];

    if (!companyId) return salesErrorResponse(req, ctx, "SO_CREATE_INVALID", 400, "company_id is required.");
    if (!customerPoNumber) return salesErrorResponse(req, ctx, "SO_CUSTOMER_PO_REQUIRED", 400, "External SO Number is required.");
    if (!DISPATCH_TYPES.has(dispatchType)) return salesErrorResponse(req, ctx, "SO_DISPATCH_TYPE_INVALID", 400, "A valid dispatch_type is required.");
    if (materialTypes.length === 0 || materialTypes.some((t) => !LINE_MATERIAL_TYPES.has(t))) {
      return salesErrorResponse(req, ctx, "SO_MATERIAL_TYPES_INVALID", 400, "At least one valid Material Type must be selected.");
    }
    if (lines.length === 0) return salesErrorResponse(req, ctx, "SO_LINES_REQUIRED", 400, "At least one item line is required.");

    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return salesErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainSo01Create(ctx, companyId))) {
      return salesErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Create-SO access at this company.");
    }

    const { data: company, error: companyError } = await serviceRoleClient
      .schema("erp_master").from("companies").select("state_name").eq("id", companyId).maybeSingle();
    if (companyError || !company) return salesErrorResponse(req, ctx, "SO_COMPANY_LOOKUP_FAILED", 500, "Unable to load company for GST derivation.");
    const companyStateName = toTrimmedString((company as JsonRecord).state_name) || null;

    if (dispatchType === "INDEPENDENT_PARTY" || dispatchType === "INDEPENDENT_PARTY_ASIAN_BILLED") {
      const customerId = toTrimmedString(body.customer_id);
      if (customerId) await assertCustomerMappedToCompany(customerId, companyId);
    }

    let resolved: ResolvedBillToShipTo;
    try {
      resolved = await resolveBillToShipTo(body, dispatchType);
    } catch (resolveError) {
      const code = resolveError instanceof Error ? resolveError.message : "SO_BILL_TO_RESOLUTION_FAILED";
      return salesErrorResponse(req, ctx, code, 400, code);
    }

    if (resolved.shipTo) {
      const shipToValidationError = validateResolvedShipTo(resolved.shipTo);
      if (shipToValidationError) {
        return salesErrorResponse(req, ctx, shipToValidationError, 400, "Ship-To details are incomplete.");
      }
    }

    const ibnRequired = resolveIbnRequired(dispatchType, body.ibn_required);
    const dispatchCategory = deriveDispatchCategory(materialTypes);
    const freightTerm = toUpperTrimmedString(body.freight_term) || null;
    const parsedRoundOffAmount = parseNullableNumber(body.round_off_amount);
    if (body.round_off_amount !== undefined && body.round_off_amount !== "" && parsedRoundOffAmount === null) {
      return salesErrorResponse(req, ctx, "SO_ROUND_OFF_INVALID", 400, "Round Off must be a valid number.");
    }
    const roundOffAmount = parsedRoundOffAmount ?? 0;

    const resolvedShipToOrBillState = resolved.shipTo?.ship_to_state ?? resolved.billToState ?? null;
    const linePayload: JsonRecord[] = [];
    const hsnWriteBacks: Array<{ materialId: string; hsnCode: string }> = [];
    for (let index = 0; index < lines.length; index += 1) {
      let prepared: Awaited<ReturnType<typeof prepareUnifiedSoLine>>;
      try {
        prepared = await prepareUnifiedSoLine(lines[index], index, materialTypes, companyStateName, resolvedShipToOrBillState);
      } catch (lineError) {
        const code = lineError instanceof Error ? lineError.message : "SO_LINE_INVALID";
        return salesErrorResponse(req, ctx, code, 400, `${code} (line ${index + 1}).`);
      }
      linePayload.push(prepared.payload);
      if (prepared.hsnWriteBack) hsnWriteBacks.push(prepared.hsnWriteBack);
    }

    const soNumber = await generateProcurementDocNumber("SO");
    const { data: so, error: soError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("sales_order")
      .insert({
        so_number: soNumber,
        so_date: toTrimmedString(body.so_date) || todayIsoDate(),
        company_id: companyId,
        customer_id: resolved.customerId,
        customer_po_number: customerPoNumber,
        dispatch_type: dispatchType,
        ibn_required: ibnRequired,
        dispatch_category: dispatchCategory,
        material_types: materialTypes,
        freight_term: freightTerm,
        round_off_amount: roundOffAmount,
        payment_term_id: toTrimmedString(body.payment_term_id) || null,
        bill_to_type: resolved.billToType,
        bill_to_parent_company_id: resolved.billToParentCompanyId,
        bill_to_depot_code_id: resolved.billToDepotCodeId,
        bill_to_vdc_id: resolved.billToVdcId,
        bill_to_name: resolved.billToName,
        bill_to_address: resolved.billToAddress,
        bill_to_state: resolved.billToState,
        bill_to_gst_number: resolved.billToGstNumber,
        billing_to_depot: resolved.billingToDepot,
        // Direct SOs resolve their final customer/Ship-To on SO Map. Until
        // then they are explicitly not the same as a header customer.
        ship_to_same_as_customer: resolved.shipTo?.ship_to_same_as_customer ?? false,
        ship_to_type: resolved.shipTo?.ship_to_type ?? null,
        ship_to_gst_number: resolved.shipTo?.ship_to_gst_number ?? null,
        ship_to_name: resolved.shipTo?.ship_to_name ?? null,
        ship_to_address: resolved.shipTo?.ship_to_address ?? null,
        ship_to_state: resolved.shipTo?.ship_to_state ?? null,
        delivery_address: resolved.shipTo?.delivery_address ?? null,
        remarks: toTrimmedString(body.remarks) || null,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (soError || !so) {
      console.error("[createSalesOrderUnifiedHandler] sales order insert failed", {
        request_id: ctx.request_id,
        error: soError,
      });
      return salesErrorResponse(req, ctx, "SO_CREATE_FAILED", 500, "Unable to create sales order.");
    }

    const lineInsertPayload = linePayload.map((line) => ({ ...line, so_id: so.id }));
    const { error: lineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("sales_order_line")
      .insert(lineInsertPayload);

    if (lineError) {
      console.error("[createSalesOrderUnifiedHandler] sales order line insert failed", {
        request_id: ctx.request_id,
        error: lineError,
      });
      return salesErrorResponse(req, ctx, "SO_LINE_CREATE_FAILED", 500, "Unable to create sales order lines.");
    }

    // §133.8-F — best-effort HSN write-back; never fails the SO create itself.
    for (const writeBack of hsnWriteBacks) {
      await serviceRoleClient
        .schema("erp_master").from("material_master")
        .update({ hsn_code: writeBack.hsnCode })
        .eq("id", writeBack.materialId)
        .is("hsn_code", null);
    }

    return okResponse(await hydrateSo(String(so.id), ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_CREATE_FAILED";
    const status = code === "MATERIAL_NOT_FOUND" ? 404
      : code === "COMPANY_SCOPE_VIOLATION" ? 403
      : code === "CUSTOMER_NOT_MAPPED_TO_COMPANY" ? 422
      : code.startsWith("SO_") ? 400
      : 500;
    return salesErrorResponse(req, ctx, code, status, code);
  }
}

// ─── §133.10 — Edit / Cancel / Close SO (unified redesign) ─────────────────

async function fetchUnifiedSoWithLines(soId: string): Promise<{ so: JsonRecord; lines: JsonRecord[] }> {
  const { data: so, error: soError } = await serviceRoleClient
    .schema("erp_procurement").from("sales_order").select("*").eq("id", soId).maybeSingle();
  if (soError || !so) throw new Error("SO_NOT_FOUND");
  const { data: lines, error: lineError } = await serviceRoleClient
    .schema("erp_procurement").from("sales_order_line").select("*").eq("so_id", soId);
  if (lineError) throw new Error("SO_LINE_FETCH_FAILED");
  return { so: so as JsonRecord, lines: (lines ?? []) as JsonRecord[] };
}

async function fetchActiveMapAllocationsForSo(soId: string): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement").from("sales_order_map_allocation")
    .select("*").eq("so_id", soId).eq("status", "ACTIVE");
  if (error) throw new Error("SO_MAP_ALLOCATION_FETCH_FAILED");
  return (data ?? []) as JsonRecord[];
}

// §133.10 — top-to-bottom editable except Bill-To/Ship-To identity (never
// read from body here — dispatch_type/bill_to_*/ship_to_* changes must go
// through Cancel + a new SO). Per-line: Mapped qty can't be reduced below
// its already-mapped amount, and a Mapped line can't be removed outright.
// DO/Invoice-level locks will extend this once those stages exist for the
// unified flow (today only the SO-Map allocation table exists to check).
export async function updateSalesOrderUnifiedHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const soId = getIdFromPath(req);
    if (!soId) return salesErrorResponse(req, ctx, "SO_ID_MISSING", 400, "SO id required.");
    const body = await parseBody(req);
    const { so, lines } = await fetchUnifiedSoWithLines(soId);
    const soCompanyId = toTrimmedString(so.company_id);
    try {
      await assertCompanyScope(ctx, soCompanyId);
    } catch {
      return salesErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainSo01Create(ctx, soCompanyId, "EDIT"))) {
      return salesErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Edit-SO access at this company.");
    }
    if (["CANCELLED", "CLOSED"].includes(toUpperTrimmedString(so.status))) {
      return salesErrorResponse(req, ctx, "SO_EDIT_BLOCKED_TERMINAL_STATUS", 400, "This SO is Cancelled/Closed and cannot be edited.");
    }

    const allocations = await fetchActiveMapAllocationsForSo(soId);
    const mappedByLine = new Map<string, number>();
    for (const alloc of allocations) {
      const lineId = toTrimmedString(alloc.so_line_id);
      mappedByLine.set(lineId, (mappedByLine.get(lineId) ?? 0) + Number(alloc.allocated_qty ?? 0));
    }

    const submittedLines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];
    const submittedIds = new Set(submittedLines.map((line) => toTrimmedString(line.id)).filter(Boolean));

    // A Mapped line missing from the submitted set = an attempted removal.
    for (const line of lines) {
      const lineId = toTrimmedString(line.id);
      const mappedQty = mappedByLine.get(lineId) ?? 0;
      if (mappedQty > QTY_TOL_SO_EDIT && !submittedIds.has(lineId)) {
        return salesErrorResponse(req, ctx, "SO_EDIT_MAPPED_LINE_REMOVAL_BLOCKED", 422,
          `Line is already Mapped (qty ${mappedQty}) — unmap it in SO Map first before removing it.`);
      }
    }

    for (const submitted of submittedLines) {
      const lineId = toTrimmedString(submitted.id);
      if (!lineId) continue;
      const mappedQty = mappedByLine.get(lineId) ?? 0;
      const newQty = Number(submitted.base_qty ?? submitted.quantity);
      if (mappedQty > QTY_TOL_SO_EDIT && Number.isFinite(newQty) && newQty < mappedQty - QTY_TOL_SO_EDIT) {
        return salesErrorResponse(req, ctx, "SO_EDIT_QTY_BELOW_MAPPED", 422,
          `Line's new qty (${newQty}) is below what is already Mapped (${mappedQty}) — unmap the excess in SO Map first.`);
      }
      const { error: updateError } = await serviceRoleClient
        .schema("erp_procurement").from("sales_order_line")
        .update({
          rate: submitted.rate !== undefined ? Number(submitted.rate) : undefined,
          base_qty: submitted.base_qty !== undefined ? Number(submitted.base_qty) : undefined,
          quantity: submitted.base_qty !== undefined ? Number(submitted.base_qty) : undefined,
          gst_rate: submitted.gst_rate !== undefined ? Number(submitted.gst_rate) : undefined,
          hsn_code: submitted.hsn_code !== undefined ? toTrimmedString(submitted.hsn_code) || null : undefined,
          batch_number: submitted.batch_number !== undefined ? toTrimmedString(submitted.batch_number) || null : undefined,
          expiry_date: submitted.expiry_date !== undefined ? toTrimmedString(submitted.expiry_date) || null : undefined,
          remarks: submitted.remarks !== undefined ? toTrimmedString(submitted.remarks) || null : undefined,
          last_updated_at: new Date().toISOString(),
        })
        .eq("id", lineId).eq("so_id", soId);
      if (updateError) return salesErrorResponse(req, ctx, "SO_EDIT_LINE_UPDATE_FAILED", 500, "Unable to update SO line.");
    }

    // §133.10 real gap closed (2026-08-28) — Edit previously only ever
    // touched lines that already had an id; a kept-but-unmapped line
    // omitted from submittedLines was never actually deleted (only
    // MAPPED-line removal was blocked, nothing enforced the delete for the
    // legitimate case), and a line with no id (newly added in the wizard)
    // was silently ignored entirely. Both fixed here: unmapped lines
    // missing from the submitted set are deleted; id-less submitted lines
    // are validated via the same prepareUnifiedSoLine() Create uses and
    // inserted, numbered to continue after the highest existing line_number
    // (existing kept lines' own line_number is never touched).
    const removableLineIds = lines
      .map((line) => toTrimmedString(line.id))
      .filter((lineId) => lineId && !submittedIds.has(lineId) && (mappedByLine.get(lineId) ?? 0) <= QTY_TOL_SO_EDIT);
    if (removableLineIds.length > 0) {
      const { error: deleteError } = await serviceRoleClient
        .schema("erp_procurement").from("sales_order_line")
        .delete().eq("so_id", soId).in("id", removableLineIds);
      if (deleteError) return salesErrorResponse(req, ctx, "SO_EDIT_LINE_DELETE_FAILED", 500, "Unable to remove SO line.");
    }

    const newLines = submittedLines.filter((submitted) => !toTrimmedString(submitted.id));
    if (newLines.length > 0) {
      const { data: company, error: companyError } = await serviceRoleClient
        .schema("erp_master").from("companies").select("state_name").eq("id", soCompanyId).maybeSingle();
      if (companyError || !company) return salesErrorResponse(req, ctx, "SO_COMPANY_LOOKUP_FAILED", 500, "Unable to load company for GST derivation.");
      const companyStateName = toTrimmedString((company as JsonRecord).state_name) || null;
      const resolvedShipToOrBillState = toTrimmedString(so.ship_to_state) || toTrimmedString(so.bill_to_state) || null;
      const materialTypes = Array.isArray(so.material_types) ? (so.material_types as string[]) : [];
      const maxLineNumber = lines.reduce((max, line) => Math.max(max, Number(line.line_number ?? 0)), 0);

      const newLinePayload: JsonRecord[] = [];
      const hsnWriteBacks: Array<{ materialId: string; hsnCode: string }> = [];
      for (let i = 0; i < newLines.length; i += 1) {
        let prepared: Awaited<ReturnType<typeof prepareUnifiedSoLine>>;
        try {
          prepared = await prepareUnifiedSoLine(newLines[i], maxLineNumber + i, materialTypes, companyStateName, resolvedShipToOrBillState);
        } catch (lineError) {
          const code = lineError instanceof Error ? lineError.message : "SO_LINE_INVALID";
          return salesErrorResponse(req, ctx, code, 400, `${code} (new line ${i + 1}).`);
        }
        newLinePayload.push({ ...prepared.payload, so_id: soId });
        if (prepared.hsnWriteBack) hsnWriteBacks.push(prepared.hsnWriteBack);
      }
      const { error: insertError } = await serviceRoleClient
        .schema("erp_procurement").from("sales_order_line").insert(newLinePayload);
      if (insertError) return salesErrorResponse(req, ctx, "SO_EDIT_LINE_CREATE_FAILED", 500, "Unable to add new SO line.");
      for (const writeBack of hsnWriteBacks) {
        await serviceRoleClient
          .schema("erp_master").from("material_master")
          .update({ hsn_code: writeBack.hsnCode })
          .eq("id", writeBack.materialId)
          .is("hsn_code", null);
      }
    }

    // Header fields — never dispatch_type/bill_to_*/ship_to_*/vdc (§133.10 identity lock).
    const headerUpdate: JsonRecord = { last_updated_at: new Date().toISOString(), last_updated_by: ctx.auth_user_id };
    if (body.so_date !== undefined) headerUpdate.so_date = toTrimmedString(body.so_date);
    if (body.payment_term_id !== undefined) headerUpdate.payment_term_id = toTrimmedString(body.payment_term_id) || null;
    if (body.freight_term !== undefined) headerUpdate.freight_term = toUpperTrimmedString(body.freight_term) || null;
    if (body.round_off_amount !== undefined) {
      const roundOffAmount = parseNullableNumber(body.round_off_amount);
      if (roundOffAmount === null) return salesErrorResponse(req, ctx, "SO_ROUND_OFF_INVALID", 400, "Round Off must be a valid number.");
      headerUpdate.round_off_amount = roundOffAmount;
    }
    const { error: headerError } = await serviceRoleClient
      .schema("erp_procurement").from("sales_order").update(headerUpdate).eq("id", soId);
    if (headerError) return salesErrorResponse(req, ctx, "SO_EDIT_HEADER_UPDATE_FAILED", 500, "Unable to update SO header.");

    return okResponse(await hydrateSo(soId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_EDIT_FAILED";
    const status = code === "SO_NOT_FOUND" ? 404 : code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.startsWith("SO_") ? 422 : 500;
    return salesErrorResponse(req, ctx, code, status, code);
  }
}

const QTY_TOL_SO_EDIT = 0.0001;

// §133.10 — Cancel cascades: release every ACTIVE SO-Map allocation, then
// set status=CANCELLED. Once DO exists for the unified flow, an open
// (non-invoiced) DO must be cancelled first — that check will extend here.
export async function cancelSalesOrderUnifiedHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const soId = getIdFromPath(req);
    if (!soId) return salesErrorResponse(req, ctx, "SO_ID_MISSING", 400, "SO id required.");
    const body = await parseBody(req);
    const { so } = await fetchUnifiedSoWithLines(soId);
    const soCompanyId = toTrimmedString(so.company_id);
    try {
      await assertCompanyScope(ctx, soCompanyId);
    } catch {
      return salesErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainSo01Create(ctx, soCompanyId, "EDIT"))) {
      return salesErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Edit-SO access at this company.");
    }
    if (["CANCELLED", "CLOSED"].includes(toUpperTrimmedString(so.status))) {
      return salesErrorResponse(req, ctx, "SO_ALREADY_TERMINAL", 400, "This SO is already Cancelled/Closed.");
    }

    const { error: releaseError } = await serviceRoleClient
      .schema("erp_procurement").from("sales_order_map_allocation")
      .update({ status: "RELEASED", last_updated_by: ctx.auth_user_id, last_updated_at: new Date().toISOString() })
      .eq("so_id", soId).eq("status", "ACTIVE");
    if (releaseError) return salesErrorResponse(req, ctx, "SO_CANCEL_RELEASE_FAILED", 500, "Unable to release SO Map allocations.");

    const { error: cancelError } = await serviceRoleClient
      .schema("erp_procurement").from("sales_order")
      .update({
        status: "CANCELLED",
        cancellation_reason: toTrimmedString(body.reason) || null,
        cancelled_by: ctx.auth_user_id,
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", soId);
    if (cancelError) return salesErrorResponse(req, ctx, "SO_CANCEL_FAILED", 500, "Unable to cancel SO.");

    return okResponse(await hydrateSo(soId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_CANCEL_FAILED";
    const status = code === "SO_NOT_FOUND" ? 404 : code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.startsWith("SO_") ? 422 : 500;
    return salesErrorResponse(req, ctx, code, status, code);
  }
}

// §133.10 — Close: whatever balance is unmapped/undispatched is written off;
// existing ACTIVE allocations (real commitments) are left untouched. Reason
// is mandatory — this is a deliberate terminal action on the remainder.
export async function closeSalesOrderUnifiedHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const soId = getIdFromPath(req);
    if (!soId) return salesErrorResponse(req, ctx, "SO_ID_MISSING", 400, "SO id required.");
    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason);
    if (!reason) return salesErrorResponse(req, ctx, "SO_CLOSE_REASON_REQUIRED", 400, "A reason is required to Close an SO.");
    const { so } = await fetchUnifiedSoWithLines(soId);
    const soCompanyId = toTrimmedString(so.company_id);
    try {
      await assertCompanyScope(ctx, soCompanyId);
    } catch {
      return salesErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainSo01Create(ctx, soCompanyId, "EDIT"))) {
      return salesErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Edit-SO access at this company.");
    }
    if (["CANCELLED", "CLOSED"].includes(toUpperTrimmedString(so.status))) {
      return salesErrorResponse(req, ctx, "SO_ALREADY_TERMINAL", 400, "This SO is already Cancelled/Closed.");
    }

    const { error: closeError } = await serviceRoleClient
      .schema("erp_procurement").from("sales_order")
      .update({ status: "CLOSED", closed_reason: reason, closed_by: ctx.auth_user_id, closed_at: new Date().toISOString() })
      .eq("id", soId);
    if (closeError) return salesErrorResponse(req, ctx, "SO_CLOSE_FAILED", 500, "Unable to close SO.");

    return okResponse(await hydrateSo(soId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_CLOSE_FAILED";
    const status = code === "SO_NOT_FOUND" ? 404 : code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.startsWith("SO_") ? 422 : 500;
    return salesErrorResponse(req, ctx, code, status, code);
  }
}
