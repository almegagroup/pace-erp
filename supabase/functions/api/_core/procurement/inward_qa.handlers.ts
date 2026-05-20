/*
 * File-ID: 16.5.1
 * File-Path: supabase/functions/api/_core/procurement/inward_qa.handlers.ts
 * Gate: 16.5
 * Phase: 16
 * Domain: PROCUREMENT
 * Purpose: Inward QA lifecycle — test entry, usage decision, stock reclassification.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type QAHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};
type QaDocumentRow = Record<string, unknown>;
type QaDecisionLineInput = {
  quantity: number;
  usage_decision: string;
  storage_location_id: string;
  remarks?: string;
};

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const QA_ALLOWED_ROLES = ["SA", "PROCUREMENT_HEAD", "QA_OFFICER", "STORE_MANAGER"];
const QA_MANAGER_ROLES = ["SA", "PROCUREMENT_HEAD", "STORE_MANAGER"];
const QA_DOC_MUTABLE_STATUSES = new Set(["PENDING", "IN_PROGRESS"]);
const QA_PUBLIC_STATUS_MAP: Record<string, string> = {
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  DECIDED: "DECISION_MADE",
};
const QA_DECISION_MOVEMENT_MAP: Record<string, { dbDecision: string; movementType: string; targetStockType: string | null }> = {
  RELEASE: { dbDecision: "RELEASE", movementType: "P321", targetStockType: "UNRESTRICTED" },
  BLOCK: { dbDecision: "BLOCK", movementType: "P344", targetStockType: "BLOCKED" },
  REJECT: { dbDecision: "REJECT", movementType: "P344", targetStockType: "BLOCKED" },
  SCRAP: { dbDecision: "SCRAP", movementType: "P553", targetStockType: null },
  FOR_REPROCESS: { dbDecision: "FOR_REPROCESS", movementType: "P905", targetStockType: "FOR_REPROCESS" },
};

function assertQARole(ctx: QAHandlerContext): void {
  if (!QA_ALLOWED_ROLES.includes(ctx.roleCode)) {
    throw new ApiError(403, "QA access required");
  }
}

function assertQAManagerRole(ctx: QAHandlerContext): void {
  if (!QA_MANAGER_ROLES.includes(ctx.roleCode)) {
    throw new ApiError(403, "QA manager access required");
  }
}

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

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function qaErrorResponse(
  req: Request,
  ctx: QAHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function getPathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}

function getQaIdFromPath(req: Request): string {
  return getPathSegments(req)[3] ?? "";
}

function getTestLineIdFromPath(req: Request): string {
  return getPathSegments(req)[5] ?? "";
}

function getCompanyScope(ctx: QAHandlerContext): string {
  return toTrimmedString(ctx.context.companyId);
}

function mapQaStatusForResponse(rawStatus: unknown): string {
  const status = toUpperTrimmedString(rawStatus);
  return QA_PUBLIC_STATUS_MAP[status] ?? status;
}

async function fetchQaDocument(qaDocumentId: string): Promise<QaDocumentRow> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("inward_qa_document")
    .select("*")
    .eq("id", qaDocumentId)
    .single();

  if (error || !data) {
    throw new ApiError(404, "QA document not found");
  }

  return data as QaDocumentRow;
}

function assertQaCompanyScope(ctx: QAHandlerContext, qaDocument: QaDocumentRow): void {
  const scopedCompanyId = getCompanyScope(ctx);
  if (scopedCompanyId && String(qaDocument.company_id) !== scopedCompanyId) {
    throw new ApiError(403, "QA document is outside company scope");
  }
}

async function fetchQaDocumentDetails(qaDocumentId: string, ctx: QAHandlerContext): Promise<JsonRecord> {
  const qaDocument = await fetchQaDocument(qaDocumentId);
  assertQaCompanyScope(ctx, qaDocument);

  const [testLinesResp, decisionLinesResp] = await Promise.all([
    serviceRoleClient
      .schema("erp_procurement")
      .from("inward_qa_test_line")
      .select("*")
      .eq("qa_document_id", qaDocumentId)
      .order("line_number", { ascending: true }),
    serviceRoleClient
      .schema("erp_procurement")
      .from("inward_qa_decision_line")
      .select("*")
      .eq("qa_document_id", qaDocumentId)
      .order("decision_line_number", { ascending: true }),
  ]);

  if (testLinesResp.error) {
    throw new ApiError(500, "Unable to fetch QA test lines");
  }
  if (decisionLinesResp.error) {
    throw new ApiError(500, "Unable to fetch QA decision lines");
  }

  return {
    ...qaDocument,
    qa_doc_number: qaDocument.qa_number,
    total_qty: qaDocument.qa_stock_qty,
    created_at: qaDocument.qa_created_at,
    public_status: mapQaStatusForResponse(qaDocument.status),
    test_lines: testLinesResp.data ?? [],
    decision_lines: decisionLinesResp.data ?? [],
  };
}

async function fetchGrnContextForQa(qaDocument: QaDocumentRow): Promise<{ grn: Record<string, unknown>; grnLine: Record<string, unknown> }> {
  const [grnResp, grnLineResp] = await Promise.all([
    serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt")
      .select("*")
      .eq("id", String(qaDocument.grn_id))
      .single(),
    serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt_line")
      .select("*")
      .eq("id", String(qaDocument.grn_line_id))
      .single(),
  ]);

  if (grnResp.error || !grnResp.data) {
    throw new ApiError(500, "Unable to fetch linked GRN");
  }
  if (grnLineResp.error || !grnLineResp.data) {
    throw new ApiError(500, "Unable to fetch linked GRN line");
  }

  return { grn: grnResp.data, grnLine: grnLineResp.data };
}

async function getNextTestLineNumber(qaDocumentId: string): Promise<number> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("inward_qa_test_line")
    .select("line_number")
    .eq("qa_document_id", qaDocumentId)
    .order("line_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new ApiError(500, "Unable to determine QA test line number");
  }

  return (Number(data?.line_number) || 0) + 1;
}

async function getNextDecisionLineNumber(qaDocumentId: string): Promise<number> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("inward_qa_decision_line")
    .select("decision_line_number")
    .eq("qa_document_id", qaDocumentId)
    .order("decision_line_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new ApiError(500, "Unable to determine QA decision line number");
  }

  return (Number(data?.decision_line_number) || 0) + 1;
}

async function postStockMovement(args: {
  documentNumber: string;
  movementTypeCode: string;
  companyId: string;
  plantId: string | null;
  storageLocationId: string;
  materialId: string;
  quantity: number;
  uomCode: string;
  unitValue: number;
  stockTypeCode: string;
  direction: "IN" | "OUT";
  postedBy: string;
}): Promise<{ stock_document_id: string; stock_ledger_id: string }> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .rpc("post_stock_movement", {
      p_document_number: args.documentNumber,
      p_document_date: todayIsoDate(),
      p_posting_date: todayIsoDate(),
      p_movement_type_code: args.movementTypeCode,
      p_company_id: args.companyId,
      p_plant_id: args.plantId,
      p_storage_location_id: args.storageLocationId,
      p_material_id: args.materialId,
      p_quantity: args.quantity,
      p_base_uom_code: args.uomCode,
      p_unit_value: args.unitValue,
      p_stock_type_code: args.stockTypeCode,
      p_direction: args.direction,
      p_posted_by: args.postedBy,
      p_reversal_of_id: null,
    });

  if (error || !Array.isArray(data) || data.length === 0) {
    throw new ApiError(500, "QA stock movement posting failed");
  }

  return {
    stock_document_id: String(data[0].stock_document_id),
    stock_ledger_id: String(data[0].stock_ledger_id),
  };
}

function parseDecisionLines(body: JsonRecord): QaDecisionLineInput[] {
  const lines = Array.isArray(body.decision_lines) ? body.decision_lines : [];
  return lines.map((line) => ({
    quantity: Number((line as JsonRecord).quantity),
    usage_decision: toUpperTrimmedString((line as JsonRecord).usage_decision),
    storage_location_id: toTrimmedString((line as JsonRecord).storage_location_id),
    remarks: toTrimmedString((line as JsonRecord).remarks) || undefined,
  }));
}

export async function listQADocumentsHandler(
  req: Request,
  ctx: QAHandlerContext,
): Promise<Response> {
  try {
    assertQARole(ctx);
    const url = new URL(req.url);
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const grnId = toTrimmedString(url.searchParams.get("grn_id"));
    const companyId = toTrimmedString(url.searchParams.get("company_id")) || getCompanyScope(ctx);
    const limit = parsePositiveInt(url.searchParams.get("limit"), 100);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("inward_qa_document")
      .select("id, qa_number, grn_id, material_id, vendor_id, status, qa_created_at, company_id")
      .order("qa_created_at", { ascending: false })
      .limit(limit);

    if (companyId) {
      query = query.eq("company_id", companyId);
    }
    if (status) {
      if (status === "DECISION_MADE") {
        query = query.eq("status", "DECIDED");
      } else {
        query = query.eq("status", status);
      }
    }
    if (grnId) {
      query = query.eq("grn_id", grnId);
    }

    const { data, error } = await query;
    if (error) {
      throw new ApiError(500, "Unable to list QA documents");
    }

    const items = (data ?? []).map((row) => ({
      ...row,
      qa_doc_number: row.qa_number,
      created_at: row.qa_created_at,
      public_status: mapQaStatusForResponse(row.status),
    }));

    return okResponse(items, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list QA documents";
    const status = error instanceof ApiError ? error.status : 500;
    return qaErrorResponse(req, ctx, "QA_LIST_FAILED", status, message);
  }
}

export async function getQADocumentHandler(
  req: Request,
  ctx: QAHandlerContext,
): Promise<Response> {
  try {
    assertQARole(ctx);
    const qaDocumentId = getQaIdFromPath(req);
    if (!qaDocumentId) {
      throw new ApiError(400, "QA document id is required");
    }

    return okResponse(await fetchQaDocumentDetails(qaDocumentId, ctx), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to fetch QA document";
    const status = error instanceof ApiError ? error.status : 500;
    return qaErrorResponse(req, ctx, "QA_FETCH_FAILED", status, message);
  }
}

export async function assignQAOfficerHandler(
  req: Request,
  ctx: QAHandlerContext,
): Promise<Response> {
  try {
    assertQARole(ctx);
    const qaDocumentId = getQaIdFromPath(req);
    if (!qaDocumentId) {
      throw new ApiError(400, "QA document id is required");
    }

    const qaDocument = await fetchQaDocument(qaDocumentId);
    assertQaCompanyScope(ctx, qaDocument);
    if (!QA_DOC_MUTABLE_STATUSES.has(toUpperTrimmedString(qaDocument.status))) {
      throw new ApiError(409, "QA document is not assignable");
    }

    const body = await parseBody(req);
    const assignedTo = toTrimmedString(body.assigned_to);
    if (!assignedTo) {
      throw new ApiError(400, "assigned_to is required");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("inward_qa_document")
      .update({
        assigned_to: assignedTo,
        status: "IN_PROGRESS",
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", qaDocumentId)
      .select("*")
      .single();

    if (error || !data) {
      throw new ApiError(500, "Unable to assign QA officer");
    }

    return okResponse(
      {
        ...data,
        qa_doc_number: data.qa_number,
        total_qty: data.qa_stock_qty,
        public_status: mapQaStatusForResponse(data.status),
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to assign QA officer";
    const status = error instanceof ApiError ? error.status : 500;
    return qaErrorResponse(req, ctx, "QA_ASSIGN_FAILED", status, message);
  }
}

export async function addTestLineHandler(
  req: Request,
  ctx: QAHandlerContext,
): Promise<Response> {
  try {
    assertQARole(ctx);
    const qaDocumentId = getQaIdFromPath(req);
    if (!qaDocumentId) {
      throw new ApiError(400, "QA document id is required");
    }

    const qaDocument = await fetchQaDocument(qaDocumentId);
    assertQaCompanyScope(ctx, qaDocument);
    if (!QA_DOC_MUTABLE_STATUSES.has(toUpperTrimmedString(qaDocument.status))) {
      throw new ApiError(409, "QA document is read-only");
    }

    const body = await parseBody(req);
    const testType = toUpperTrimmedString(body.test_type) || "OTHER";
    const testParameter = toTrimmedString(body.test_parameter);
    const resultValue = toTrimmedString(body.result_value);
    const passFail = toUpperTrimmedString(body.pass_fail) || "PENDING";
    const remarks = toTrimmedString(body.remarks) || null;

    if (!["VISUAL", "MCT", "LAB", "OTHER"].includes(testType) || !testParameter) {
      throw new ApiError(400, "test_type and test_parameter are required");
    }
    if (!["PASS", "FAIL", "PENDING"].includes(passFail)) {
      throw new ApiError(400, "pass_fail is invalid");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("inward_qa_test_line")
      .insert({
        qa_document_id: qaDocumentId,
        line_number: await getNextTestLineNumber(qaDocumentId),
        test_type: testType,
        test_parameter: testParameter,
        test_result: resultValue || null,
        pass_fail: passFail,
        remarks,
        tested_by: ctx.auth_user_id,
        test_date: todayIsoDate(),
      })
      .select("*")
      .single();

    if (error || !data) {
      throw new ApiError(500, "Unable to add QA test line");
    }

    if (toUpperTrimmedString(qaDocument.status) === "PENDING") {
      await serviceRoleClient
        .schema("erp_procurement")
        .from("inward_qa_document")
        .update({
          status: "IN_PROGRESS",
          last_updated_at: new Date().toISOString(),
          last_updated_by: ctx.auth_user_id,
        })
        .eq("id", qaDocumentId);
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to add QA test line";
    const status = error instanceof ApiError ? error.status : 500;
    return qaErrorResponse(req, ctx, "QA_TESTLINE_CREATE_FAILED", status, message);
  }
}

export async function updateTestLineHandler(
  req: Request,
  ctx: QAHandlerContext,
): Promise<Response> {
  try {
    assertQARole(ctx);
    const qaDocumentId = getQaIdFromPath(req);
    const lineId = getTestLineIdFromPath(req);
    if (!qaDocumentId || !lineId) {
      throw new ApiError(400, "QA document id and test line id are required");
    }

    const qaDocument = await fetchQaDocument(qaDocumentId);
    assertQaCompanyScope(ctx, qaDocument);
    if (!QA_DOC_MUTABLE_STATUSES.has(toUpperTrimmedString(qaDocument.status))) {
      throw new ApiError(409, "QA document is read-only");
    }

    const body = await parseBody(req);
    const patch: JsonRecord = {
      tested_by: ctx.auth_user_id,
      test_date: todayIsoDate(),
    };

    if (body.result_value !== undefined) {
      patch.test_result = toTrimmedString(body.result_value) || null;
    }
    if (body.pass_fail !== undefined) {
      const passFail = toUpperTrimmedString(body.pass_fail);
      if (!["PASS", "FAIL", "PENDING"].includes(passFail)) {
        throw new ApiError(400, "pass_fail is invalid");
      }
      patch.pass_fail = passFail;
    }
    if (body.remarks !== undefined) {
      patch.remarks = toTrimmedString(body.remarks) || null;
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("inward_qa_test_line")
      .update(patch)
      .eq("id", lineId)
      .eq("qa_document_id", qaDocumentId)
      .select("*")
      .single();

    if (error || !data) {
      throw new ApiError(404, "QA test line not found");
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update QA test line";
    const status = error instanceof ApiError ? error.status : 500;
    return qaErrorResponse(req, ctx, "QA_TESTLINE_UPDATE_FAILED", status, message);
  }
}

export async function deleteTestLineHandler(
  req: Request,
  ctx: QAHandlerContext,
): Promise<Response> {
  try {
    assertQARole(ctx);
    const qaDocumentId = getQaIdFromPath(req);
    const lineId = getTestLineIdFromPath(req);
    if (!qaDocumentId || !lineId) {
      throw new ApiError(400, "QA document id and test line id are required");
    }

    const qaDocument = await fetchQaDocument(qaDocumentId);
    assertQaCompanyScope(ctx, qaDocument);
    if (!QA_DOC_MUTABLE_STATUSES.has(toUpperTrimmedString(qaDocument.status))) {
      throw new ApiError(409, "Cannot delete test line after decision is made");
    }

    const { data: decisionLines, error: decisionLinesError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("inward_qa_decision_line")
      .select("id")
      .eq("qa_document_id", qaDocumentId);

    if (decisionLinesError) {
      throw new ApiError(500, "Unable to validate QA decision state");
    }
    if ((decisionLines ?? []).length > 0) {
      throw new ApiError(409, "Cannot delete test line after decision is made");
    }

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("inward_qa_test_line")
      .delete()
      .eq("id", lineId)
      .eq("qa_document_id", qaDocumentId);

    if (error) {
      throw new ApiError(500, "Unable to delete QA test line");
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete QA test line";
    const status = error instanceof ApiError ? error.status : 500;
    return qaErrorResponse(req, ctx, "QA_TESTLINE_DELETE_FAILED", status, message);
  }
}

export async function submitUsageDecisionHandler(
  req: Request,
  ctx: QAHandlerContext,
): Promise<Response> {
  try {
    assertQARole(ctx);
    const qaDocumentId = getQaIdFromPath(req);
    if (!qaDocumentId) {
      throw new ApiError(400, "QA document id is required");
    }

    const qaDocument = await fetchQaDocument(qaDocumentId);
    assertQaCompanyScope(ctx, qaDocument);
    if (!QA_DOC_MUTABLE_STATUSES.has(toUpperTrimmedString(qaDocument.status))) {
      throw new ApiError(400, "QA document is not eligible for decision");
    }

    const { data: existingDecisionLines, error: existingDecisionError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("inward_qa_decision_line")
      .select("id")
      .eq("qa_document_id", qaDocumentId);

    if (existingDecisionError) {
      throw new ApiError(500, "Unable to validate existing QA decisions");
    }
    if ((existingDecisionLines ?? []).length > 0) {
      throw new ApiError(409, "QA decision already submitted");
    }

    const body = await parseBody(req);
    const decisionLines = parseDecisionLines(body);
    if (decisionLines.length === 0) {
      throw new ApiError(400, "decision_lines is required");
    }

    const totalQty = parsePositiveNumber(qaDocument.qa_stock_qty) ?? 0;
    const sumQty = Number(decisionLines.reduce((sum, line) => sum + (Number.isFinite(line.quantity) ? line.quantity : 0), 0).toFixed(6));
    if (Number(sumQty.toFixed(6)) !== Number(totalQty.toFixed(6))) {
      throw new ApiError(400, "Sum of decision line quantities must equal QA total quantity");
    }

    const { grnLine } = await fetchGrnContextForQa(qaDocument);
    const baseUom = toTrimmedString(qaDocument.uom_code || grnLine.uom_code);
    const unitValue = Number(grnLine.grn_rate ?? 0);
    const companyId = String(qaDocument.company_id);
    const plantId = toTrimmedString(qaDocument.plant_id) || null;
    let nextLineNumber = await getNextDecisionLineNumber(qaDocumentId);
    const createdDecisionLines: JsonRecord[] = [];
    let hasReject = false;

    for (const decisionLine of decisionLines) {
      const config = QA_DECISION_MOVEMENT_MAP[decisionLine.usage_decision];
      if (!config) {
        throw new ApiError(400, `Invalid usage_decision: ${decisionLine.usage_decision}`);
      }
      if (!decisionLine.storage_location_id) {
        throw new ApiError(400, "storage_location_id is required on every decision line");
      }
      if (!Number.isFinite(decisionLine.quantity) || decisionLine.quantity <= 0) {
        throw new ApiError(400, "decision_lines.quantity must be greater than zero");
      }
      if (decisionLine.usage_decision === "FOR_REPROCESS") {
        assertQAManagerRole(ctx);
      }

      const outPosting = await postStockMovement({
        documentNumber: String(qaDocument.qa_number),
        movementTypeCode: config.movementType,
        companyId,
        plantId,
        storageLocationId: decisionLine.storage_location_id,
        materialId: String(qaDocument.material_id),
        quantity: decisionLine.quantity,
        uomCode: baseUom,
        unitValue,
        stockTypeCode: "QUALITY_INSPECTION",
        direction: "OUT",
        postedBy: ctx.auth_user_id,
      });

      let finalPosting = outPosting;
      if (config.targetStockType) {
        finalPosting = await postStockMovement({
          documentNumber: String(qaDocument.qa_number),
          movementTypeCode: config.movementType,
          companyId,
          plantId,
          storageLocationId: decisionLine.storage_location_id,
          materialId: String(qaDocument.material_id),
          quantity: decisionLine.quantity,
          uomCode: baseUom,
          unitValue,
          stockTypeCode: config.targetStockType,
          direction: "IN",
          postedBy: ctx.auth_user_id,
        });
      }

      const { data: insertedDecision, error: insertError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("inward_qa_decision_line")
        .insert({
          qa_document_id: qaDocumentId,
          decision_line_number: nextLineNumber,
          usage_decision: config.dbDecision,
          decision_qty: decisionLine.quantity,
          movement_type_code: config.dbDecision === "FOR_REPROCESS" ? "FOR_REPROCESS" : config.movementType,
          posting_status: "POSTED",
          stock_document_id: finalPosting.stock_document_id,
          stock_ledger_id: finalPosting.stock_ledger_id,
          decided_by: ctx.auth_user_id,
          decided_at: new Date().toISOString(),
          remarks: decisionLine.remarks ?? null,
        })
        .select("*")
        .single();

      if (insertError || !insertedDecision) {
        throw new ApiError(500, "Unable to create QA decision line");
      }

      createdDecisionLines.push(insertedDecision);
      nextLineNumber += 1;
      if (decisionLine.usage_decision === "REJECT") {
        hasReject = true;
      }
    }

    const currentRemarks = toTrimmedString(qaDocument.remarks);
    const nextRemarks = hasReject
      ? [currentRemarks, "RTV_PENDING"].filter(Boolean).join(" | ")
      : currentRemarks || null;

    const { data: updatedQaDocument, error: updateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("inward_qa_document")
      .update({
        status: "DECIDED",
        remarks: nextRemarks,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", qaDocumentId)
      .select("*")
      .single();

    if (updateError || !updatedQaDocument) {
      throw new ApiError(500, "Unable to update QA document status");
    }

    return okResponse(
      {
        qa_document: {
          ...updatedQaDocument,
          total_qty: updatedQaDocument.qa_stock_qty,
          public_status: "DECISION_MADE",
        },
        decision_lines: createdDecisionLines,
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit QA decision";
    const status = error instanceof ApiError ? error.status : 500;
    return qaErrorResponse(req, ctx, "QA_DECISION_FAILED", status, message);
  }
}
