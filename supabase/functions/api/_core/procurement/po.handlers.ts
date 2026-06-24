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
const FREIGHT_TERMS = new Set(["FOR", "FREIGHT_SEPARATE", "FREIGHT_AT_ACTUALS"]);
const GST_TERMS = new Set(["INCLUSIVE", "EXCLUSIVE"]);
const REBATE_RATE_UOM_BASIS = new Set(["BASE_UOM", "PO_UOM"]);
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

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => toTrimmedString(entry))
    .filter(Boolean);
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

// "PROC_HEAD" was never a real configured role in erp_acl.user_roles (the
// actual roles are SA/GA/DIRECTOR/L1-L4 USER/MANAGER/AUDITOR) — this check
// silently meant only SA could ever approve a PO. PACE already has a real
// generic approver registry (acl.approver_map + acl.resource_approval_policy,
// approval_type=ANYONE) seeded for PROC_PO_CREATE — this now reads from that
// instead of a hardcoded role Set, matching how PACE's approval hierarchy
// actually works (same matching semantics as hr/shared.ts's isApproverMatch).
// Self-approval is blocked unless the approver is DIRECTOR — DIRECTOR may
// create and approve their own PO; everyone else needs a different approver.
type ApproverMapRow = { approver_user_id: string | null; approver_role_code: string | null };

async function loadPoApproverRules(companyId: string): Promise<ApproverMapRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("acl")
    .from("approver_map")
    .select("approver_user_id, approver_role_code")
    .eq("resource_code", "PROC_PO_CREATE")
    .eq("action_code", "WRITE")
    .eq("company_id", companyId);

  if (error) {
    throw new Error("PROCUREMENT_APPROVER_LOOKUP_FAILED");
  }
  return (data as ApproverMapRow[] | null) ?? [];
}

function matchesApprover(rows: ApproverMapRow[], ctx: ProcurementHandlerContext): boolean {
  return rows.some((row) => {
    if (row.approver_user_id) return row.approver_user_id === ctx.auth_user_id;
    if (row.approver_role_code) return row.approver_role_code === ctx.roleCode;
    return false;
  });
}

async function assertProcurementHeadRole(
  ctx: ProcurementHandlerContext,
  companyId: string,
  createdBy?: string | null,
): Promise<void> {
  if (ctx.roleCode === "SA" || ctx.roleCode === "GA") {
    return; // SA/GA always retain override authority, regardless of approver_map config.
  }

  const rules = await loadPoApproverRules(companyId);
  const isConfiguredApprover = rules.length > 0
    ? matchesApprover(rules, ctx)
    : ctx.roleCode === "DIRECTOR"; // no approver_map row configured yet — fall back to DIRECTOR.

  if (!isConfiguredApprover) {
    throw new Error("PROCUREMENT_HEAD_REQUIRED");
  }

  if (createdBy && createdBy === ctx.auth_user_id && ctx.roleCode !== "DIRECTOR") {
    throw new Error("PROCUREMENT_SELF_APPROVAL_FORBIDDEN");
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
  if (status !== "ACTIVE" && status !== "APPROVED") {
    return null;
  }

  const { data: uomRows, error: uomError } = await serviceRoleClient
    .schema("erp_master")
    .from("vendor_material_uom")
    .select("uom_code, conversion_factor, is_default")
    .eq("vmi_id", row.id as string);

  if (uomError) {
    throw new Error("PROCUREMENT_ASL_LOOKUP_FAILED");
  }

  return { ...row, uoms: uomRows ?? [] };
}

// Vendor's valid delivery UOM list for this approved source — buyer picks
// one at PO creation (defaulting to the VMI's marked default), each carrying
// its own vendor-specific conversion factor to the material's base UOM.
function resolvePoLineUom(
  aslRow: Record<string, unknown>,
  requestedUomCode: string,
): { uomCode: string; conversionFactor: number } {
  const uoms = (aslRow.uoms as { uom_code: string; conversion_factor: number; is_default: boolean }[]) ?? [];
  if (uoms.length === 0) {
    throw new Error("PROCUREMENT_ASL_UOM_NOT_CONFIGURED");
  }

  const match = requestedUomCode
    ? uoms.find((row) => row.uom_code === requestedUomCode)
    : uoms.find((row) => row.is_default) ?? uoms[0];

  if (!match) {
    throw new Error("PROCUREMENT_INVALID_ASL_UOM");
  }

  return { uomCode: match.uom_code, conversionFactor: Number(match.conversion_factor) };
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

    const { uomCode: poUomCode, conversionFactor } = resolvePoLineUom(
      aslRow,
      toTrimmedString(rawLine.po_uom_code).toUpperCase(),
    );

    prepared.push({
      line_number: index + 1,
      material_id: materialId,
      cost_center_id: costCenterId,
      receiving_location_id: toTrimmedString(rawLine.receiving_location_id) || null,
      vendor_material_info_id: aslRow.id,
      ordered_qty: orderedQty,
      po_uom_code: poUomCode,
      ordered_qty_base_uom: Number((orderedQty * conversionFactor).toFixed(6)),
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

// Per feasibility doc 87.12A: a PO now carries exactly one material. Raising
// several materials together creates one single-material PO per material,
// all grouped under an internal po_order_group for batch approval — the
// group is never exposed to the vendor, each PO keeps its own normal number.
export async function createPOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const body = await parseBody(req);
    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const vendorId = toTrimmedString(body.vendor_id);
    const vendorType = toUpperTrimmedString(body.vendor_type);
    const deliveryType = toUpperTrimmedString(body.delivery_type || "STANDARD");
    const poDate = toTrimmedString(body.po_date) || new Date().toISOString().slice(0, 10);
    const costCenterId = toTrimmedString(body.cost_center_id);
    const extraFields = parseStringArray(body.extra_fields);

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
    const incoterm = toTrimmedString(body.incoterm) || await getLastUsedIncoterm(vendorId) || null;
    if (vendorType === "IMPORT" && !incoterm) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INCOTERM_REQUIRED", 400, "Incoterm required for import PO");
    }

    const rawMaterials: unknown[] = Array.isArray(body.materials)
      ? body.materials
      : Array.isArray(body.lines)
        ? body.lines
        : [];
    if (rawMaterials.length === 0) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_MATERIALS_REQUIRED", 400, "At least one material is required");
    }
    if (!costCenterId) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_COST_CENTER_REQUIRED", 400, "Cost center is required");
    }
    if (!(await getCostCenterRow(costCenterId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_COST_CENTER_NOT_FOUND", 404, "Cost center not found");
    }

    const { data: groupData, error: groupError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("po_order_group")
      .insert({
        company_id: companyId,
        vendor_id: vendorId,
        status: "DRAFT",
        remarks: toTrimmedString(body.remarks) || null,
        extra_fields: extraFields,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (groupError || !groupData) {
      console.error("PO_ORDER_GROUP_INSERT_ERROR", JSON.stringify(groupError));
      throw new Error("PROCUREMENT_PO_ORDER_GROUP_CREATE_FAILED");
    }

    const orderGroupId = toTrimmedString(groupData.id);
    const purchaseOrders: JsonRecord[] = [];

    for (const rawMaterial of rawMaterials) {
      const materialRecord = {
        ...((rawMaterial ?? {}) as JsonRecord),
        cost_center_id: costCenterId,
      } as JsonRecord;
      const [preparedLine] = await buildPoLinesForInsert(ctx, vendorId, [materialRecord]);
      const poNumber = await generateCompanyDocNumber(companyId, "PO");
      const paymentTermId = toTrimmedString(materialRecord.payment_term_id);
      const freightTerm = toUpperTrimmedString(materialRecord.freight_term);
      const gstTerms = toUpperTrimmedString(materialRecord.gst_terms);
      const rebateRateUomBasis = toUpperTrimmedString(materialRecord.rebate_rate_uom_basis);
      const paymentTerm = await getPaymentTermRow(paymentTermId);

      if (!paymentTermId) {
        throw new Error("PROCUREMENT_PAYMENT_TERM_REQUIRED");
      }
      if (!paymentTerm?.id) {
        throw new Error("PROCUREMENT_PAYMENT_TERM_NOT_FOUND");
      }
      if (!freightTerm) {
        throw new Error("PROCUREMENT_FREIGHT_TERM_REQUIRED");
      }
      if (!FREIGHT_TERMS.has(freightTerm)) {
        throw new Error("PROCUREMENT_INVALID_FREIGHT_TERM");
      }
      if (gstTerms && !GST_TERMS.has(gstTerms)) {
        throw new Error("PROCUREMENT_INVALID_GST_TERMS");
      }
      if (rebateRateUomBasis && !REBATE_RATE_UOM_BASIS.has(rebateRateUomBasis)) {
        throw new Error("PROCUREMENT_INVALID_REBATE_RATE_UOM_BASIS");
      }

      const lcRequired = toUpperTrimmedString(paymentTerm.payment_method) === "LC";

      const { data: poData, error: poError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("purchase_order")
        .insert({
          po_number: poNumber,
          po_date: poDate,
          company_id: companyId,
          vendor_id: vendorId,
          vendor_type: vendorType,
          incoterm,
          freight_term: freightTerm,
          payment_term_id: paymentTerm.id,
          lc_required: lcRequired,
          delivery_type: deliveryType,
          gst_terms: gstTerms || null,
          has_rebate: materialRecord.has_rebate === true,
          rebate_remarks: toTrimmedString(materialRecord.rebate_remarks) || null,
          rebate_rate: parseNullableNumber(materialRecord.rebate_rate),
          rebate_rate_uom_basis: rebateRateUomBasis || null,
          indent_required: false,
          expected_delivery_date:
            toTrimmedString(materialRecord.delivery_date || materialRecord.expected_delivery_date) ||
            null,
          status: "DRAFT",
          remarks: toTrimmedString(materialRecord.remarks) || null,
          order_group_id: orderGroupId,
          created_by: ctx.auth_user_id,
        })
        .select("*")
        .single();

      if (poError || !poData) {
        throw new Error("PROCUREMENT_PO_CREATE_FAILED");
      }

      const poId = toTrimmedString(poData.id);
      const { data: lineData, error: lineError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("purchase_order_line")
        .insert({ ...preparedLine, po_id: poId })
        .select("*")
        .single();

      if (lineError || !lineData) {
        throw new Error("PROCUREMENT_PO_LINES_CREATE_FAILED");
      }

      purchaseOrders.push({ ...poData, lines: [lineData] });
    }

    return okResponse({
      data: {
        order_group: groupData,
        purchase_orders: purchaseOrders,
        // Backward-compatible single-PO shape for callers that only raised one material.
        ...(purchaseOrders.length === 1 ? purchaseOrders[0] : {}),
      },
    }, ctx.request_id, req);
  } catch (err) {
    console.error("PO_CREATE_HANDLER_ERROR", err);
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

// `null` means "no constraint supplied" (show everything); an array (possibly
// empty) is the actual intersection of every constraint that WAS supplied.
function intersectIdSets(sets: string[][]): string[] | null {
  if (sets.length === 0) return null;
  let result = new Set(sets[0]);
  for (let i = 1; i < sets.length; i++) {
    const next = new Set(sets[i]);
    result = new Set([...result].filter((id) => next.has(id)));
  }
  return [...result];
}

// PO Create needs Company/Vendor/Material to cross-filter each other no
// matter which one is picked first (per user request 2026-06-24): picking
// Material alone should narrow Company + Vendor to ones with an approved
// link to that material, picking Company+Vendor should narrow Material, etc.
export async function getPoFilterOptionsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const vendorId = toTrimmedString(url.searchParams.get("vendor_id"));
    const materialId = toTrimmedString(url.searchParams.get("material_id"));

    const companyIdSets: string[][] = [];
    const vendorIdSets: string[][] = [];
    const materialIdSets: string[][] = [];

    if (vendorId) {
      const { data } = await serviceRoleClient.schema("erp_master").from("vendor_company_map")
        .select("company_id").eq("vendor_id", vendorId).eq("active", true);
      companyIdSets.push((data ?? []).map((row) => row.company_id as string));
    }
    if (materialId) {
      const { data } = await serviceRoleClient.schema("erp_master").from("material_company_ext")
        .select("company_id").eq("material_id", materialId).eq("status", "ACTIVE").eq("procurement_allowed", true);
      companyIdSets.push((data ?? []).map((row) => row.company_id as string));
    }
    if (companyId) {
      const { data } = await serviceRoleClient.schema("erp_master").from("vendor_company_map")
        .select("vendor_id").eq("company_id", companyId).eq("active", true);
      vendorIdSets.push((data ?? []).map((row) => row.vendor_id as string));
    }
    if (materialId) {
      const { data } = await serviceRoleClient.schema("erp_master").from("vendor_material_info")
        .select("vendor_id").eq("material_id", materialId).eq("status", "ACTIVE");
      vendorIdSets.push((data ?? []).map((row) => row.vendor_id as string));
    }
    if (companyId) {
      const { data } = await serviceRoleClient.schema("erp_master").from("material_company_ext")
        .select("material_id").eq("company_id", companyId).eq("status", "ACTIVE").eq("procurement_allowed", true);
      materialIdSets.push((data ?? []).map((row) => row.material_id as string));
    }
    if (vendorId) {
      const { data } = await serviceRoleClient.schema("erp_master").from("vendor_material_info")
        .select("material_id").eq("vendor_id", vendorId).eq("status", "ACTIVE");
      materialIdSets.push((data ?? []).map((row) => row.material_id as string));
    }

    const companyIds = intersectIdSets(companyIdSets);
    const vendorIds = intersectIdSets(vendorIdSets);
    const materialIds = intersectIdSets(materialIdSets);

    let companyQuery = serviceRoleClient.schema("erp_master").from("companies")
      .select("id, company_code, company_name")
      .eq("company_kind", "BUSINESS")
      .eq("status", "ACTIVE")
      .order("company_name", { ascending: true });
    if (companyIds !== null) companyQuery = companyQuery.in("id", companyIds.length ? companyIds : ["__none__"]);

    let vendorQuery = serviceRoleClient.schema("erp_master").from("vendor_master")
      .select("id, vendor_code, vendor_name, vendor_type, indent_number_required")
      .eq("status", "ACTIVE")
      .order("vendor_name", { ascending: true });
    if (vendorIds !== null) vendorQuery = vendorQuery.in("id", vendorIds.length ? vendorIds : ["__none__"]);

    let materialQuery = serviceRoleClient.schema("erp_master").from("material_master")
      .select("id, pace_code, material_name, material_type")
      .in("material_type", ["RM", "PM"])
      .order("material_name", { ascending: true });
    if (materialIds !== null) materialQuery = materialQuery.in("id", materialIds.length ? materialIds : ["__none__"]);

    const [companiesResult, vendorsResult, materialsResult] = await Promise.all([
      companyQuery,
      vendorQuery,
      materialQuery,
    ]);

    if (companiesResult.error || vendorsResult.error || materialsResult.error) {
      console.error("PO_FILTER_OPTIONS query errors", {
        companyError: companiesResult.error,
        vendorError: vendorsResult.error,
        materialError: materialsResult.error,
      });
      throw new Error("PROCUREMENT_PO_FILTER_OPTIONS_FAILED");
    }

    return okResponse({
      companies: companiesResult.data ?? [],
      vendors: vendorsResult.data ?? [],
      materials: materialsResult.data ?? [],
    }, ctx.request_id, req);
  } catch (err) {
    console.error("PO_FILTER_OPTIONS_HANDLER_ERROR", err);
    const code = (err as Error).message || "PROCUREMENT_PO_FILTER_OPTIONS_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "Failed to load PO filter options");
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
    const poId = getPoIdFromPath(req);
    const body = await parseBody(req);
    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const po = await getPOById(poId, companyId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    await assertProcurementHeadRole(ctx, toTrimmedString(po.company_id), toTrimmedString(po.created_by));
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
        : code === "PROCUREMENT_HEAD_REQUIRED" || code === "PROCUREMENT_SELF_APPROVAL_FORBIDDEN" ? 403
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
    await assertProcurementHeadRole(ctx, toTrimmedString(po.company_id), toTrimmedString(po.created_by));
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
        : code === "PROCUREMENT_HEAD_REQUIRED" || code === "PROCUREMENT_SELF_APPROVAL_FORBIDDEN" ? 403
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
      console.error("PO_AMEND_HEADER_UPDATE_ERROR", JSON.stringify(poUpdateError));
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
        console.error("PO_AMEND_LINE_UPDATE_ERROR", JSON.stringify(lineUpdateResult.error));
        throw new Error("PROCUREMENT_PO_LINE_AMEND_FAILED");
      }
    }

    const amendmentInsert = await serviceRoleClient
      .schema("erp_procurement")
      .from("po_amendment_log")
      .insert(amendmentEntries);

    if (amendmentInsert.error) {
      console.error("PO_AMEND_LOG_INSERT_ERROR", JSON.stringify(amendmentInsert.error));
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
    console.error("PO_AMEND_HANDLER_ERROR", err);
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
    const poId = getPoIdFromPath(req);
    const body = await parseBody(req);
    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const po = await getPOById(poId, companyId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    await assertProcurementHeadRole(ctx, toTrimmedString(po.company_id), toTrimmedString(po.created_by));

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
        : code === "PROCUREMENT_HEAD_REQUIRED" || code === "PROCUREMENT_SELF_APPROVAL_FORBIDDEN" ? 403
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
      console.error("PO_CANCEL_HEADER_UPDATE_ERROR", JSON.stringify(error));
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
      console.error("PO_CANCEL_LINE_UPDATE_ERROR", JSON.stringify(lineCancelResult.error));
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
      console.error("PO_CANCEL_CSN_UPDATE_ERROR", JSON.stringify(csnCancelResult.error));
      throw new Error("PROCUREMENT_PO_CANCEL_FAILED");
    }

    return okResponse({ data: updatedPo }, ctx.request_id, req);
  } catch (err) {
    console.error("PO_CANCEL_HANDLER_ERROR", err);
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
      console.error("PO_LINE_KNOCK_OFF_ERROR", JSON.stringify(error));
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
    console.error("PO_LINE_KNOCK_OFF_HANDLER_ERROR", err);
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
      console.error("PO_KNOCK_OFF_LINES_UPDATE_ERROR", JSON.stringify(lineUpdateResult.error));
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
      console.error("PO_KNOCK_OFF_HEADER_UPDATE_ERROR", JSON.stringify(error));
      throw new Error("PROCUREMENT_PO_KNOCK_OFF_FAILED");
    }

    return okResponse({ data: updatedPo }, ctx.request_id, req);
  } catch (err) {
    console.error("PO_KNOCK_OFF_HANDLER_ERROR", err);
    const code = (err as Error).message || "PROCUREMENT_PO_KNOCK_OFF_FAILED";
    const status = code === "PROCUREMENT_PO_NOT_FOUND" ? 404 : code.includes("REQUIRED") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order knock-off failed");
  }
}

// ───────────────────────────────────────────────────────────────────────
// PO Order Group — internal batch-approval wrapper around single-material
// POs raised together (feasibility doc 87.12A). Never exposed to the vendor.
// ───────────────────────────────────────────────────────────────────────

type PoOrderGroupRow = Record<string, unknown>;

function getOrderGroupIdFromPath(req: Request): string {
  return getPathSegments(req)[3] ?? "";
}

async function getOrderGroupById(groupId: string, companyId?: string): Promise<PoOrderGroupRow | null> {
  let query = serviceRoleClient
    .schema("erp_procurement")
    .from("po_order_group")
    .select("*")
    .eq("id", groupId);

  if (companyId) {
    query = query.eq("company_id", companyId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error("PROCUREMENT_PO_ORDER_GROUP_LOOKUP_FAILED");
  }
  return (data as PoOrderGroupRow | null) ?? null;
}

async function getOrderGroupPOs(groupId: string): Promise<PurchaseOrderRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order")
    .select("*")
    .eq("order_group_id", groupId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error("PROCUREMENT_PO_ORDER_GROUP_POS_LOOKUP_FAILED");
  }
  return (data as PurchaseOrderRow[] | null) ?? [];
}

export async function listPOOrderGroupsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const url = new URL(req.url);
    const companyId = getCompanyScope(ctx, url.searchParams.get("company_id") ?? "");
    const statusFilter = toUpperTrimmedString(url.searchParams.get("status"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);
    const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("po_order_group")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (companyId) {
      query = query.eq("company_id", companyId);
    }
    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const { data, error, count } = await query;
    if (error) {
      throw new Error("PROCUREMENT_PO_ORDER_GROUP_LIST_FAILED");
    }

    const groups = (data as PoOrderGroupRow[] | null) ?? [];
    const groupIds = groups.map((g) => toTrimmedString(g.id));
    const { data: poRows, error: poError } = groupIds.length > 0
      ? await serviceRoleClient
          .schema("erp_procurement")
          .from("purchase_order")
          .select("id, po_number, status, order_group_id")
          .in("order_group_id", groupIds)
      : { data: [], error: null };

    if (poError) {
      throw new Error("PROCUREMENT_PO_ORDER_GROUP_LIST_FAILED");
    }

    const poByGroup = new Map<string, PurchaseOrderRow[]>();
    for (const po of (poRows as PurchaseOrderRow[] | null) ?? []) {
      const key = toTrimmedString(po.order_group_id);
      const list = poByGroup.get(key) ?? [];
      list.push(po);
      poByGroup.set(key, list);
    }

    const enriched = groups.map((group) => ({
      ...group,
      purchase_orders: poByGroup.get(toTrimmedString(group.id)) ?? [],
    }));

    return okResponse({ data: enriched, total: count ?? 0 }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_ORDER_GROUP_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "Purchase order group list failed");
  }
}

export async function getPOOrderGroupHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const groupId = getOrderGroupIdFromPath(req);
    const companyId = getCompanyScope(ctx);
    const group = await getOrderGroupById(groupId, companyId);
    if (!group) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_ORDER_GROUP_NOT_FOUND", 404, "Order group not found");
    }

    const pos = await getOrderGroupPOs(groupId);
    const posWithLines = await Promise.all(
      pos.map(async (po) => ({ ...po, lines: await getPOLines(toTrimmedString(po.id)) })),
    );

    return okResponse({ data: { ...group, purchase_orders: posWithLines } }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_ORDER_GROUP_DETAIL_FAILED";
    const status = code === "PROCUREMENT_PO_ORDER_GROUP_NOT_FOUND" ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order group detail failed");
  }
}

export async function confirmPOOrderGroupHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const groupId = getOrderGroupIdFromPath(req);
    const body = await parseBody(req);
    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const group = await getOrderGroupById(groupId, companyId);
    if (!group) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_ORDER_GROUP_NOT_FOUND", 404, "Order group not found");
    }
    if (toUpperTrimmedString(group.status) !== "DRAFT") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_ORDER_GROUP_CONFIRM_BLOCKED", 422, "Only a DRAFT order group can be confirmed");
    }

    const pos = await getOrderGroupPOs(groupId);
    const draftPos = pos.filter((po) => toUpperTrimmedString(po.status) === "DRAFT");
    if (draftPos.length === 0) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_ORDER_GROUP_CONFIRM_BLOCKED", 422, "No DRAFT purchase orders in this group");
    }

    const requiresApproval = body.approval_required !== false; // default true, matching PO confirm
    const nextStatus = requiresApproval ? "PENDING_APPROVAL" : "CONFIRMED";
    const nowIso = new Date().toISOString();

    for (const po of draftPos) {
      const poId = toTrimmedString(po.id);
      const { data: updatedPo, error } = await serviceRoleClient
        .schema("erp_procurement")
        .from("purchase_order")
        .update({
          status: nextStatus,
          approved_at: nextStatus === "CONFIRMED" ? nowIso : null,
          approved_by: nextStatus === "CONFIRMED" ? ctx.auth_user_id : null,
          last_updated_at: nowIso,
          last_updated_by: ctx.auth_user_id,
        })
        .eq("id", poId)
        .select("*")
        .single();

      if (error || !updatedPo) {
        throw new Error("PROCUREMENT_PO_ORDER_GROUP_CONFIRM_FAILED");
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
    }

    const { data: updatedGroup, error: groupError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("po_order_group")
      .update({
        status: nextStatus === "CONFIRMED" ? "CONFIRMED" : "PENDING_APPROVAL",
        last_updated_at: nowIso,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", groupId)
      .select("*")
      .single();

    if (groupError || !updatedGroup) {
      throw new Error("PROCUREMENT_PO_ORDER_GROUP_CONFIRM_FAILED");
    }

    return okResponse({ data: { ...updatedGroup, purchase_orders: await getOrderGroupPOs(groupId) } }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_ORDER_GROUP_CONFIRM_FAILED";
    const status = code === "PROCUREMENT_PO_ORDER_GROUP_NOT_FOUND" ? 404 : code.includes("BLOCKED") ? 422 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order group confirm failed");
  }
}

export async function approvePOOrderGroupHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const groupId = getOrderGroupIdFromPath(req);
    const body = await parseBody(req);
    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const group = await getOrderGroupById(groupId, companyId);
    if (!group) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_ORDER_GROUP_NOT_FOUND", 404, "Order group not found");
    }
    await assertProcurementHeadRole(ctx, toTrimmedString(group.company_id), toTrimmedString(group.created_by));
    if (toUpperTrimmedString(group.status) !== "PENDING_APPROVAL") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_ORDER_GROUP_APPROVAL_STATE_INVALID", 422, "Order group is not pending approval");
    }

    const pos = await getOrderGroupPOs(groupId);
    const pendingPos = pos.filter((po) => toUpperTrimmedString(po.status) === "PENDING_APPROVAL");
    if (pendingPos.length === 0) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_ORDER_GROUP_APPROVAL_STATE_INVALID", 422, "No purchase orders pending approval in this group");
    }

    const nowIso = new Date().toISOString();
    for (const po of pendingPos) {
      const poId = toTrimmedString(po.id);
      const { data: updatedPo, error } = await serviceRoleClient
        .schema("erp_procurement")
        .from("purchase_order")
        .update({
          status: "CONFIRMED",
          approved_by: ctx.auth_user_id,
          approved_at: nowIso,
          last_updated_at: nowIso,
          last_updated_by: ctx.auth_user_id,
        })
        .eq("id", poId)
        .select("*")
        .single();

      if (error || !updatedPo) {
        throw new Error("PROCUREMENT_PO_ORDER_GROUP_APPROVE_FAILED");
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
    }

    const { data: updatedGroup, error: groupError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("po_order_group")
      .update({
        status: "CONFIRMED",
        approved_by: ctx.auth_user_id,
        approved_at: nowIso,
        last_updated_at: nowIso,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", groupId)
      .select("*")
      .single();

    if (groupError || !updatedGroup) {
      throw new Error("PROCUREMENT_PO_ORDER_GROUP_APPROVE_FAILED");
    }

    return okResponse({ data: { ...updatedGroup, purchase_orders: await getOrderGroupPOs(groupId) } }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_ORDER_GROUP_APPROVE_FAILED";
    const status =
      code === "PROCUREMENT_PO_ORDER_GROUP_NOT_FOUND" ? 404
        : code === "PROCUREMENT_HEAD_REQUIRED" || code === "PROCUREMENT_SELF_APPROVAL_FORBIDDEN" ? 403
        : code.includes("INVALID") ? 422
        : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order group approval failed");
  }
}

export async function rejectPOOrderGroupHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const groupId = getOrderGroupIdFromPath(req);
    const body = await parseBody(req);
    const remarks = toTrimmedString(body.remarks);
    if (!remarks) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_REMARKS_REQUIRED", 400, "Remarks are required");
    }

    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const group = await getOrderGroupById(groupId, companyId);
    if (!group) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_ORDER_GROUP_NOT_FOUND", 404, "Order group not found");
    }
    await assertProcurementHeadRole(ctx, toTrimmedString(group.company_id), toTrimmedString(group.created_by));
    if (toUpperTrimmedString(group.status) !== "PENDING_APPROVAL") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_ORDER_GROUP_APPROVAL_STATE_INVALID", 422, "Order group is not pending approval");
    }

    const pos = await getOrderGroupPOs(groupId);
    const pendingPos = pos.filter((po) => toUpperTrimmedString(po.status) === "PENDING_APPROVAL");
    const nowIso = new Date().toISOString();

    for (const po of pendingPos) {
      const poId = toTrimmedString(po.id);
      const { error } = await serviceRoleClient
        .schema("erp_procurement")
        .from("purchase_order")
        .update({
          status: "DRAFT",
          last_updated_at: nowIso,
          last_updated_by: ctx.auth_user_id,
        })
        .eq("id", poId);

      if (error) {
        throw new Error("PROCUREMENT_PO_ORDER_GROUP_REJECT_FAILED");
      }

      await insertPoApprovalLog({
        poId,
        action: "REJECTED",
        fromStatus: "PENDING_APPROVAL",
        toStatus: "DRAFT",
        remarks,
        actionedBy: ctx.auth_user_id,
      });
    }

    const { data: updatedGroup, error: groupError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("po_order_group")
      .update({
        status: "DRAFT",
        last_updated_at: nowIso,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", groupId)
      .select("*")
      .single();

    if (groupError || !updatedGroup) {
      throw new Error("PROCUREMENT_PO_ORDER_GROUP_REJECT_FAILED");
    }

    return okResponse({ data: { ...updatedGroup, purchase_orders: await getOrderGroupPOs(groupId) } }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_ORDER_GROUP_REJECT_FAILED";
    const status =
      code === "PROCUREMENT_PO_ORDER_GROUP_NOT_FOUND" ? 404
        : code === "PROCUREMENT_HEAD_REQUIRED" || code === "PROCUREMENT_SELF_APPROVAL_FORBIDDEN" ? 403
        : code.includes("REQUIRED") ? 400
        : code.includes("INVALID") ? 422
        : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order group rejection failed");
  }
}
