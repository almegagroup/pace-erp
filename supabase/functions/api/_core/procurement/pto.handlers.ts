/*
 * File-ID: 23.3
 * File-Path: supabase/functions/api/_core/procurement/pto.handlers.ts
 * Gate: 23
 * Phase: 23
 * Domain: PROCUREMENT
 * Purpose: Plant Transfer Order - ONE_STEP (P301) and TWO_STEP (P303/P305) handlers + SLOC transfer (P311).
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { generateMaterialDocNumber } from "../../_shared/materialDocument.ts";
import type { MaterialDocumentRef } from "../../_shared/materialDocument.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { pickScopedApproverRules } from "../../_shared/workflow_scope.ts";
import { hasBlanketApprovalOverride } from "../../_shared/approval_override.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};
type PtoRow = Record<string, unknown>;

const PTO_TRANSFER_TYPES = new Set(["ONE_STEP", "TWO_STEP"]);
const PTO_STATUSES = new Set(["DRAFT", "APPROVED", "ISSUED", "IN_TRANSIT", "CLOSED", "CANCELLED"]);
const PTO_TRANSFER_PRICE_TYPES = new Set(["AT_COST", "AT_AGREED_PRICE"]);

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

function parseOptionalBoolean(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = toUpperTrimmedString(value);
  if (normalized === "TRUE") return true;
  if (normalized === "FALSE") return false;
  return fallback;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowIsoString(): string {
  return new Date().toISOString();
}

function ptoErrorResponse(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function assertProcurementReadRole(_ctx: ProcurementHandlerContext): void {
  // Protected by upstream pipeline.
}

// Previously missing entirely: nothing checked that the approver's active
// company context actually matched the PTO's OWN source company, so anyone
// active in ANY company (with plain ACL approve access) could approve a PTO
// belonging to a different company's transfer. Mirrors sto.handlers.ts's
// assertStoVisibleToContext — same rationale, source/target instead of
// sending/receiving.
function assertPtoVisibleToContext(ctx: ProcurementHandlerContext, pto: PtoRow): void {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  if (
    scopedCompanyId
    && scopedCompanyId !== toTrimmedString(pto.source_company_id)
    && scopedCompanyId !== toTrimmedString(pto.target_company_id)
  ) {
    throw new Error("PTO_SCOPE_VIOLATION");
  }
}

type PtoApproverMapRow = {
  approver_user_id: string | null;
  approver_role_code: string | null;
  resource_code: string | null;
  action_code: string | null;
  scope_type: string | null;
  subject_user_id: string | null;
  subject_work_context_id: string | null;
  subject_role_code: string | null;
  approval_stage: number;
};

async function loadPtoApproverRules(companyId: string): Promise<PtoApproverMapRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("acl")
    .from("approver_map")
    .select("approver_user_id, approver_role_code, resource_code, action_code, scope_type, subject_user_id, subject_work_context_id, subject_role_code, approval_stage")
    .eq("resource_code", "PROC_PLANT_TRANSFER_LIST")
    .eq("action_code", "APPROVE")
    .eq("company_id", companyId);

  if (error) {
    throw new Error("PTO_APPROVER_LOOKUP_FAILED");
  }
  return (data as PtoApproverMapRow[] | null) ?? [];
}

function matchesPtoApprover(rows: PtoApproverMapRow[], ctx: ProcurementHandlerContext): boolean {
  return rows.some((row) => {
    if (row.approver_user_id) return row.approver_user_id === ctx.auth_user_id;
    if (row.approver_role_code) return row.approver_role_code === ctx.roleCode;
    return false;
  });
}

// Business rule: the SENDING company's L2/L3 Manager approves a Plant
// Transfer — configured as company-wide, role-based (not named-person)
// approver_map rows for PROC_PLANT_TRANSFER_LIST:APPROVE, keyed to
// pto.source_company_id (never the caller's own active company, which may
// legitimately be the target/receiving side). Same scoped-matching engine as
// po.handlers.ts's assertProcurementHeadRole; see that function's comment
// for the full rationale. Unconfigured falls back to DIRECTOR only.
async function assertPtoApproverRole(
  ctx: ProcurementHandlerContext,
  companyId: string,
  createdBy?: string | null,
): Promise<void> {
  if (hasBlanketApprovalOverride(ctx)) {
    return;
  }

  const rules = await loadPtoApproverRules(companyId);
  let isConfiguredApprover: boolean;

  if (rules.length === 0) {
    isConfiguredApprover = hasBlanketApprovalOverride(ctx);
  } else {
    const scopedRules = pickScopedApproverRules(
      { resource_code: "PROC_PLANT_TRANSFER_LIST", action_code: "APPROVE", requester_auth_user_id: createdBy ?? null },
      rules,
    );
    isConfiguredApprover = scopedRules.length > 0
      ? matchesPtoApprover(scopedRules, ctx)
      : hasBlanketApprovalOverride(ctx);
  }

  if (!isConfiguredApprover) {
    throw new Error("PTO_APPROVER_REQUIRED");
  }

  if (createdBy && createdBy === ctx.auth_user_id && !hasBlanketApprovalOverride(ctx)) {
    throw new Error("PTO_SELF_APPROVAL_FORBIDDEN");
  }
}

function getIdFromPath(req: Request): string {
  const pathname = new URL(req.url).pathname;
  const match = pathname.match(/^\/api\/procurement\/ptos\/([^/]+)$/);
  return match?.[1] ?? "";
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

async function postStockMovement(params: {
  documentNumber: string;
  movementTypeCode: string;
  companyId: string;
  storageLocationId: string;
  materialId: string;
  quantity: number;
  uomCode: string;
  unitValue: number;
  stockTypeCode: string;
  direction: "IN" | "OUT";
  postedBy: string;
  reversalOfId?: string;
  // §106: Material Document identity (MBLNR+MJAHR) for the posting event; the PT/transfer
  // business number (documentNumber) is carried as the reference.
  matDoc?: MaterialDocumentRef;
  referenceDocumentType?: string;
  referenceDocumentId?: string | null;
}): Promise<{ stockDocumentId: string; stockLedgerId: string }> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .rpc("post_stock_movement", {
      p_document_number: params.documentNumber,
      p_document_date: todayIsoDate(),
      p_posting_date: todayIsoDate(),
      p_movement_type_code: params.movementTypeCode,
      p_company_id: params.companyId,
      p_storage_location_id: params.storageLocationId,
      p_material_id: params.materialId,
      p_quantity: params.quantity,
      p_base_uom_code: params.uomCode,
      p_unit_value: params.unitValue,
      p_stock_type_code: params.stockTypeCode,
      p_direction: params.direction,
      p_posted_by: params.postedBy,
      p_reversal_of_id: params.reversalOfId ?? null,
      p_material_doc_number: params.matDoc?.docNumber ?? null,
      p_material_doc_year: params.matDoc?.docYear ?? null,
      p_reference_document_number: params.matDoc ? params.documentNumber : null,
      p_reference_document_type: params.matDoc ? (params.referenceDocumentType ?? "PT") : null,
      p_reference_document_id: params.referenceDocumentId ?? null,
    });
  if (error || !Array.isArray(data) || data.length === 0) {
    throw new Error("PTO_STOCK_POSTING_FAILED");
  }
  return {
    stockDocumentId: String((data[0] as Record<string, unknown>).stock_document_id),
    stockLedgerId: String((data[0] as Record<string, unknown>).stock_ledger_id),
  };
}

async function fetchSnapshot(
  companyId: string,
  slocId: string,
  materialId: string,
  stockTypeCode: string,
): Promise<{ quantity: number; valuation_rate: number } | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_snapshot")
    .select("quantity, valuation_rate")
    .eq("company_id", companyId)
    .eq("storage_location_id", slocId)
    .eq("material_id", materialId)
    .eq("stock_type_code", stockTypeCode)
    .is("batch_id", null)
    .maybeSingle();
  if (error) {
    throw new Error("PTO_SNAPSHOT_FETCH_FAILED");
  }
  if (!data) return null;
  return {
    quantity: Number((data as Record<string, unknown>).quantity ?? 0),
    valuation_rate: Number((data as Record<string, unknown>).valuation_rate ?? 0),
  };
}

function uniqueTrimmedStrings(values: unknown[]): string[] {
  return [...new Set(values.map((value) => toTrimmedString(value)).filter(Boolean))];
}

async function enrichPtoRows(rows: PtoRow[]): Promise<PtoRow[]> {
  if (rows.length === 0) return rows;

  const materialIds = uniqueTrimmedStrings(rows.map((row) => row.material_id));
  const companyIds = uniqueTrimmedStrings([
    ...rows.map((row) => row.source_company_id),
    ...rows.map((row) => row.target_company_id),
  ]);
  const slocIds = uniqueTrimmedStrings([
    ...rows.map((row) => row.source_sloc_id),
    ...rows.map((row) => row.target_sloc_id),
  ]);

  const [materialsResult, companiesResult, slocsResult] = await Promise.all([
    materialIds.length > 0
      ? serviceRoleClient.schema("erp_master").from("material_master").select("id, pace_code, material_name").in("id", materialIds)
      : Promise.resolve({ data: [], error: null }),
    companyIds.length > 0
      ? serviceRoleClient.schema("erp_master").from("companies").select("id, company_code, company_name").in("id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    slocIds.length > 0
      ? serviceRoleClient.schema("erp_inventory").from("storage_location_master").select("id, code, name").in("id", slocIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const materialLabelById = new Map<string, string>(
    ((materialsResult.data as Array<Record<string, unknown>> | null) ?? []).map((row) => [
      toTrimmedString(row.id),
      `${toTrimmedString(row.pace_code)} - ${toTrimmedString(row.material_name)}`.trim(),
    ]),
  );
  const companyLabelById = new Map<string, string>(
    ((companiesResult.data as Array<Record<string, unknown>> | null) ?? []).map((row) => [
      toTrimmedString(row.id),
      toTrimmedString(row.company_name) || toTrimmedString(row.company_code),
    ]),
  );
  const slocLabelById = new Map<string, string>(
    ((slocsResult.data as Array<Record<string, unknown>> | null) ?? []).map((row) => [
      toTrimmedString(row.id),
      `${toTrimmedString(row.code)} - ${toTrimmedString(row.name)}`.trim(),
    ]),
  );

  return rows.map((row) => ({
    ...row,
    material_display: materialLabelById.get(toTrimmedString(row.material_id)) || toTrimmedString(row.material_id),
    source_company_display: companyLabelById.get(toTrimmedString(row.source_company_id)) || toTrimmedString(row.source_company_id),
    target_company_display: companyLabelById.get(toTrimmedString(row.target_company_id)) || toTrimmedString(row.target_company_id),
    source_sloc_display: slocLabelById.get(toTrimmedString(row.source_sloc_id)) || toTrimmedString(row.source_sloc_id),
    target_sloc_display: slocLabelById.get(toTrimmedString(row.target_sloc_id)) || toTrimmedString(row.target_sloc_id),
  }));
}

async function fetchPto(ptoId: string): Promise<PtoRow> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("plant_transfer_order")
    .select("*")
    .eq("id", ptoId)
    .maybeSingle();

  if (error) {
    throw new Error("PTO_FETCH_FAILED");
  }
  if (!data) {
    throw new Error("PTO_NOT_FOUND");
  }
  const [enriched] = await enrichPtoRows([data as PtoRow]);
  return enriched;
}

async function updatePto(ptoId: string, patch: JsonRecord): Promise<PtoRow> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("plant_transfer_order")
    .update(patch)
    .eq("id", ptoId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error("PTO_UPDATE_FAILED");
  }
  return data as PtoRow;
}

function normalizeTransferValue(quantity: number, valuationRate: number): number {
  return Number((quantity * valuationRate).toFixed(6));
}

export async function createPTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const transferType = toUpperTrimmedString(body.transfer_type);
    const sourceCompanyId = toTrimmedString(body.source_company_id);
    const sourceSlocId = toTrimmedString(body.source_sloc_id);
    const targetCompanyId = toTrimmedString(body.target_company_id);
    const targetSlocId = toTrimmedString(body.target_sloc_id);
    const materialId = toTrimmedString(body.material_id);
    const transferQty = parsePositiveNumber(body.transfer_qty);
    const uomCode = toTrimmedString(body.uom_code);
    const transferPriceType = toUpperTrimmedString(body.transfer_price_type) || "AT_COST";

    if (
      !PTO_TRANSFER_TYPES.has(transferType)
      || !sourceCompanyId
      || !sourceSlocId
      || !targetCompanyId
      || !targetSlocId
      || !materialId
      || !transferQty
      || !uomCode
      || !PTO_TRANSFER_PRICE_TYPES.has(transferPriceType)
    ) {
      return ptoErrorResponse(req, ctx, "PTO_CREATE_INVALID", 400, "Missing or invalid PTO fields.");
    }

    const ptoNumber = await generateProcurementDocNumber("PT");
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("plant_transfer_order")
      .insert({
        pto_number: ptoNumber,
        transfer_type: transferType,
        status: "DRAFT",
        source_company_id: sourceCompanyId,
        source_sloc_id: sourceSlocId,
        target_company_id: targetCompanyId,
        target_sloc_id: targetSlocId,
        source_gstin: toTrimmedString(body.source_gstin) || null,
        target_gstin: toTrimmedString(body.target_gstin) || null,
        gst_applicable: parseOptionalBoolean(body.gst_applicable, false),
        tax_document_required: parseOptionalBoolean(body.tax_document_required, false),
        material_id: materialId,
        transfer_qty: transferQty,
        uom_code: uomCode,
        transfer_price_type: transferPriceType,
        transport_required: parseOptionalBoolean(body.transport_required, false),
        vehicle_number: toTrimmedString(body.vehicle_number) || null,
        transporter_name: toTrimmedString(body.transporter_name) || null,
        lr_number: toTrimmedString(body.lr_number) || null,
        expected_dispatch_date: toTrimmedString(body.expected_dispatch_date) || null,
        expected_receipt_date: toTrimmedString(body.expected_receipt_date) || null,
        eway_bill_reference: toTrimmedString(body.eway_bill_reference) || null,
        gst_invoice_reference: toTrimmedString(body.gst_invoice_reference) || null,
        remarks: toTrimmedString(body.remarks) || null,
        created_by: ctx.auth_user_id,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: nowIsoString(),
      })
      .select("*")
      .single();

    if (error || !data) {
      return ptoErrorResponse(req, ctx, "PTO_CREATE_FAILED", 500, "Unable to create PTO.");
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PTO_CREATE_FAILED";
    return ptoErrorResponse(req, ctx, code, 500, code);
  }
}

export async function listPTOsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const transferType = toUpperTrimmedString(url.searchParams.get("transfer_type"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 100);
    const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("plant_transfer_order")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (companyId) {
      query = query.or(`source_company_id.eq.${companyId},target_company_id.eq.${companyId}`);
    }
    if (status && PTO_STATUSES.has(status)) {
      query = query.eq("status", status);
    }
    if (transferType && PTO_TRANSFER_TYPES.has(transferType)) {
      query = query.eq("transfer_type", transferType);
    }

    const { data, error, count } = await query;
    if (error) {
      return ptoErrorResponse(req, ctx, "PTO_LIST_FAILED", 500, "Unable to list PTOs.");
    }

    const enriched = await enrichPtoRows((data as PtoRow[] | null) ?? []);
    return okResponse(
      { data: enriched, total: count ?? 0, items: enriched },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "PTO_LIST_FAILED";
    return ptoErrorResponse(req, ctx, code, 500, code);
  }
}

export async function getPTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const ptoId = getIdFromPath(req);
    if (!ptoId) {
      return ptoErrorResponse(req, ctx, "PTO_ID_REQUIRED", 400, "PTO id is required.");
    }
    return okResponse(await fetchPto(ptoId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PTO_FETCH_FAILED";
    const status = code === "PTO_NOT_FOUND" ? 404 : 500;
    return ptoErrorResponse(req, ctx, code, status, code);
  }
}

export async function approvePTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const ptoId = new URL(req.url).pathname.split("/")[4] ?? "";
    const pto = await fetchPto(ptoId);
    assertPtoVisibleToContext(ctx, pto);
    await assertPtoApproverRole(ctx, toTrimmedString(pto.source_company_id), toTrimmedString(pto.created_by));
    if (toUpperTrimmedString(pto.status) !== "DRAFT") {
      return ptoErrorResponse(req, ctx, "PTO_INVALID_STATUS", 400, "Only DRAFT PTO can be approved.");
    }

    const updated = await updatePto(ptoId, {
      status: "APPROVED",
      approved_by: ctx.auth_user_id,
      approved_at: nowIsoString(),
      last_updated_by: ctx.auth_user_id,
      last_updated_at: nowIsoString(),
    });
    return okResponse(updated, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PTO_APPROVE_FAILED";
    const status = code === "PTO_NOT_FOUND" ? 404
      : code === "PTO_SCOPE_VIOLATION" || code === "PTO_APPROVER_REQUIRED" || code === "PTO_SELF_APPROVAL_FORBIDDEN" ? 403
      : 500;
    return ptoErrorResponse(req, ctx, code, status, code);
  }
}

export async function oneStepTransferHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const ptoId = new URL(req.url).pathname.split("/")[4] ?? "";
    const pto = await fetchPto(ptoId);
    if (toUpperTrimmedString(pto.status) !== "APPROVED") {
      return ptoErrorResponse(req, ctx, "PTO_INVALID_STATUS", 400, "Only APPROVED PTO can be executed.");
    }
    if (toUpperTrimmedString(pto.transfer_type) !== "ONE_STEP") {
      return ptoErrorResponse(req, ctx, "PTO_WRONG_TRANSFER_TYPE", 400, "PTO is not ONE_STEP.");
    }

    const quantity = Number(pto.transfer_qty ?? 0);
    const snapshot = await fetchSnapshot(
      String(pto.source_company_id),
      String(pto.source_sloc_id),
      String(pto.material_id),
      "UNRESTRICTED",
    );
    if (!snapshot || snapshot.quantity < quantity) {
      return ptoErrorResponse(req, ctx, "INSUFFICIENT_STOCK", 400, "Insufficient unrestricted stock.");
    }

    const valuationRate = Number(snapshot.valuation_rate ?? 0);
    // §106: one Material Document for the whole one-step transfer event, minted from the
    // SOURCE company's series and shared by both legs — matching SAP, where a cross-company
    // stock transfer produces ONE material document spanning both plants (separate
    // accounting documents per company code are a Layer-3 concern, not this one).
    const ptoMatDoc = await generateMaterialDocNumber(String(pto.source_company_id));
    const issuePosting = await postStockMovement({
      documentNumber: String(pto.pto_number),
      movementTypeCode: "P301",
      companyId: String(pto.source_company_id),
      storageLocationId: String(pto.source_sloc_id),
      materialId: String(pto.material_id),
      quantity,
      uomCode: String(pto.uom_code),
      unitValue: valuationRate,
      stockTypeCode: "UNRESTRICTED",
      direction: "OUT",
      postedBy: ctx.auth_user_id,
      matDoc: ptoMatDoc,
      referenceDocumentId: ptoId,
    });
    const receiptPosting = await postStockMovement({
      documentNumber: String(pto.pto_number),
      movementTypeCode: "P301",
      companyId: String(pto.target_company_id),
      storageLocationId: String(pto.target_sloc_id),
      materialId: String(pto.material_id),
      quantity,
      uomCode: String(pto.uom_code),
      unitValue: valuationRate,
      stockTypeCode: "UNRESTRICTED",
      direction: "IN",
      postedBy: ctx.auth_user_id,
      matDoc: ptoMatDoc,
      referenceDocumentId: ptoId,
    });

    const updated = await updatePto(ptoId, {
      status: "CLOSED",
      issued_by: ctx.auth_user_id,
      issued_at: nowIsoString(),
      valuation_rate: valuationRate,
      transfer_value: normalizeTransferValue(quantity, valuationRate),
      issue_stock_document_id: issuePosting.stockDocumentId,
      receipt_stock_document_id: receiptPosting.stockDocumentId,
      last_updated_by: ctx.auth_user_id,
      last_updated_at: nowIsoString(),
    });
    return okResponse(updated, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PTO_ONE_STEP_FAILED";
    const status =
      code === "PTO_NOT_FOUND" ? 404 : code === "INSUFFICIENT_STOCK" || code === "PTO_WRONG_TRANSFER_TYPE" ? 400 : 500;
    return ptoErrorResponse(req, ctx, code, status, code);
  }
}

export async function issueTransferHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const ptoId = new URL(req.url).pathname.split("/")[4] ?? "";
    const pto = await fetchPto(ptoId);
    if (toUpperTrimmedString(pto.status) !== "APPROVED") {
      return ptoErrorResponse(req, ctx, "PTO_INVALID_STATUS", 400, "Only APPROVED PTO can be issued.");
    }
    if (toUpperTrimmedString(pto.transfer_type) !== "TWO_STEP") {
      return ptoErrorResponse(req, ctx, "PTO_WRONG_TRANSFER_TYPE", 400, "PTO is not TWO_STEP.");
    }

    const quantity = Number(pto.transfer_qty ?? 0);
    const snapshot = await fetchSnapshot(
      String(pto.source_company_id),
      String(pto.source_sloc_id),
      String(pto.material_id),
      "UNRESTRICTED",
    );
    if (!snapshot || snapshot.quantity < quantity) {
      return ptoErrorResponse(req, ctx, "INSUFFICIENT_STOCK", 400, "Insufficient unrestricted stock.");
    }

    const valuationRate = Number(snapshot.valuation_rate ?? 0);
    // §106: one Material Document for this issue-to-transit event (both legs).
    const issueMatDoc = await generateMaterialDocNumber(String(pto.source_company_id));
    const unrestrictedPosting = await postStockMovement({
      documentNumber: String(pto.pto_number),
      movementTypeCode: "P303",
      companyId: String(pto.source_company_id),
      storageLocationId: String(pto.source_sloc_id),
      materialId: String(pto.material_id),
      quantity,
      uomCode: String(pto.uom_code),
      unitValue: valuationRate,
      stockTypeCode: "UNRESTRICTED",
      direction: "OUT",
      postedBy: ctx.auth_user_id,
      matDoc: issueMatDoc,
      referenceDocumentId: ptoId,
    });
    await postStockMovement({
      documentNumber: String(pto.pto_number),
      movementTypeCode: "P303",
      companyId: String(pto.source_company_id),
      storageLocationId: String(pto.source_sloc_id),
      materialId: String(pto.material_id),
      quantity,
      uomCode: String(pto.uom_code),
      unitValue: valuationRate,
      stockTypeCode: "IN_TRANSIT",
      direction: "IN",
      postedBy: ctx.auth_user_id,
      matDoc: issueMatDoc,
      referenceDocumentId: ptoId,
    });

    const updated = await updatePto(ptoId, {
      status: "IN_TRANSIT",
      issued_by: ctx.auth_user_id,
      issued_at: nowIsoString(),
      valuation_rate: valuationRate,
      transfer_value: normalizeTransferValue(quantity, valuationRate),
      issue_stock_document_id: unrestrictedPosting.stockDocumentId,
      last_updated_by: ctx.auth_user_id,
      last_updated_at: nowIsoString(),
    });
    return okResponse(updated, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PTO_ISSUE_FAILED";
    const status =
      code === "PTO_NOT_FOUND" ? 404 : code === "INSUFFICIENT_STOCK" || code === "PTO_WRONG_TRANSFER_TYPE" ? 400 : 500;
    return ptoErrorResponse(req, ctx, code, status, code);
  }
}

export async function receiveTransferHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const ptoId = new URL(req.url).pathname.split("/")[4] ?? "";
    const body = await parseBody(req);
    const pto = await fetchPto(ptoId);
    if (toUpperTrimmedString(pto.status) !== "IN_TRANSIT") {
      return ptoErrorResponse(req, ctx, "PTO_INVALID_STATUS", 400, "Only IN_TRANSIT PTO can be received.");
    }

    const quantity = Number(pto.transfer_qty ?? 0);
    const valuationRate = Number(pto.valuation_rate ?? 0);
    // §106: one Material Document for this transit-receipt event (both legs), minted from
    // the source company's series — see oneStepTransferHandler for the cross-company note.
    const receiveMatDoc = await generateMaterialDocNumber(String(pto.source_company_id));
    await postStockMovement({
      documentNumber: String(pto.pto_number),
      movementTypeCode: "P305",
      companyId: String(pto.source_company_id),
      storageLocationId: String(pto.source_sloc_id),
      materialId: String(pto.material_id),
      quantity,
      uomCode: String(pto.uom_code),
      unitValue: valuationRate,
      stockTypeCode: "IN_TRANSIT",
      direction: "OUT",
      postedBy: ctx.auth_user_id,
      matDoc: receiveMatDoc,
      referenceDocumentId: ptoId,
    });
    const receiptPosting = await postStockMovement({
      documentNumber: String(pto.pto_number),
      movementTypeCode: "P305",
      companyId: String(pto.target_company_id),
      storageLocationId: String(pto.target_sloc_id),
      materialId: String(pto.material_id),
      quantity,
      uomCode: String(pto.uom_code),
      unitValue: valuationRate,
      stockTypeCode: "UNRESTRICTED",
      direction: "IN",
      postedBy: ctx.auth_user_id,
      matDoc: receiveMatDoc,
      referenceDocumentId: ptoId,
    });

    const updated = await updatePto(ptoId, {
      status: "CLOSED",
      received_by: ctx.auth_user_id,
      received_at: nowIsoString(),
      actual_receipt_date: toTrimmedString(body.actual_receipt_date) || todayIsoDate(),
      receipt_stock_document_id: receiptPosting.stockDocumentId,
      last_updated_by: ctx.auth_user_id,
      last_updated_at: nowIsoString(),
    });
    return okResponse(updated, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PTO_RECEIVE_FAILED";
    const status = code === "PTO_NOT_FOUND" ? 404 : 500;
    return ptoErrorResponse(req, ctx, code, status, code);
  }
}

export async function cancelPTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const ptoId = new URL(req.url).pathname.split("/")[4] ?? "";
    const body = await parseBody(req);
    const pto = await fetchPto(ptoId);
    const status = toUpperTrimmedString(pto.status);
    if (status !== "DRAFT" && status !== "APPROVED") {
      return ptoErrorResponse(req, ctx, "PTO_CANNOT_CANCEL", 400, "Only DRAFT or APPROVED PTO can be cancelled.");
    }

    const updated = await updatePto(ptoId, {
      status: "CANCELLED",
      cancellation_reason: toTrimmedString(body.cancellation_reason) || null,
      last_updated_by: ctx.auth_user_id,
      last_updated_at: nowIsoString(),
    });
    return okResponse(updated, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PTO_CANCEL_FAILED";
    const status = code === "PTO_NOT_FOUND" ? 404 : 500;
    return ptoErrorResponse(req, ctx, code, status, code);
  }
}

export async function storageLocationTransferHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const sourceSlocId = toTrimmedString(body.source_sloc_id);
    const targetSlocId = toTrimmedString(body.target_sloc_id);
    const materialId = toTrimmedString(body.material_id);
    const transferQty = parsePositiveNumber(body.transfer_qty);
    const uomCode = toTrimmedString(body.uom_code);

    if (!companyId || !sourceSlocId || !targetSlocId || !materialId || !transferQty || !uomCode) {
      return ptoErrorResponse(req, ctx, "PTO_SLOC_TRANSFER_INVALID", 400, "Missing required SLOC transfer fields.");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return ptoErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (sourceSlocId === targetSlocId) {
      return ptoErrorResponse(req, ctx, "PTO_SAME_SLOC", 400, "Source and target storage locations must differ.");
    }

    const snapshot = await fetchSnapshot(
      companyId,
      sourceSlocId,
      materialId,
      "UNRESTRICTED",
    );
    if (!snapshot || snapshot.quantity < transferQty) {
      return ptoErrorResponse(req, ctx, "INSUFFICIENT_STOCK", 400, "Insufficient unrestricted stock.");
    }

    const valuationRate = Number(snapshot.valuation_rate ?? 0);
    const documentNumber = await generateProcurementDocNumber("PT");
    // §106: one Material Document for this storage-location transfer event (both legs);
    // the PT business number becomes the reference.
    const slocMatDoc = await generateMaterialDocNumber(companyId);
    const sourcePosting = await postStockMovement({
      documentNumber,
      movementTypeCode: "P311",
      companyId,
      storageLocationId: sourceSlocId,
      materialId,
      quantity: transferQty,
      uomCode,
      unitValue: valuationRate,
      stockTypeCode: "UNRESTRICTED",
      direction: "OUT",
      postedBy: ctx.auth_user_id,
      matDoc: slocMatDoc,
    });
    const targetPosting = await postStockMovement({
      documentNumber,
      movementTypeCode: "P311",
      companyId,
      storageLocationId: targetSlocId,
      materialId,
      quantity: transferQty,
      uomCode,
      unitValue: valuationRate,
      stockTypeCode: "UNRESTRICTED",
      direction: "IN",
      postedBy: ctx.auth_user_id,
      matDoc: slocMatDoc,
    });

    return okResponse(
      {
        ok: true,
        source_stock_document_id: sourcePosting.stockDocumentId,
        target_stock_document_id: targetPosting.stockDocumentId,
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "PTO_SLOC_TRANSFER_FAILED";
    const status = code === "INSUFFICIENT_STOCK" || code === "PTO_SAME_SLOC" ? 400 : 500;
    return ptoErrorResponse(req, ctx, code, status, code);
  }
}
