/*
 * File-Path: supabase/functions/api/_core/procurement/inward_qa.handlers.ts
 * Domain: PROCUREMENT
 * Purpose: Inward QA lifecycle — test entry, usage decision, stock reclassification.
 *          Redesigned 2026-07-08: partial usage decisions, auto-inherited storage location,
 *          DIRECTOR full authority. See docs/Operation Management/implementation-specs/
 *          OM-GATE-InwardQA-Redesign-Spec.md
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { generateMaterialDocNumber } from "../../_shared/materialDocument.ts";
import type { MaterialDocumentRef } from "../../_shared/materialDocument.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
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
  remarks?: string;
};

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Logs the real Supabase/Postgres error server-side so root causes aren't lost behind a generic message. */
function logDbError(context: string, error: unknown): void {
  console.error(`[INWARD_QA_DB_ERROR] ${context}:`, JSON.stringify(error));
}

const QA_ALLOWED_ROLES = ["SA", "DIRECTOR", "PROCUREMENT_HEAD", "QA_OFFICER", "STORE_MANAGER"];
const QA_MANAGER_ROLES = ["SA", "DIRECTOR", "PROCUREMENT_HEAD", "STORE_MANAGER"];
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
// Tolerance for float qty comparisons (matches numeric(20,6) column precision).
const QTY_EPSILON = 0.000001;

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

function roundQty(value: number): number {
  return Number(value.toFixed(6));
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
  console.warn(`[QA_ERROR] ${req.method} ${new URL(req.url).pathname} -> ${status} ${code}: ${message}`);
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
    if (error) logDbError("fetchQaDocument", error);
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

async function fetchDecisionLines(qaDocumentId: string): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("inward_qa_decision_line")
    .select("*")
    .eq("qa_document_id", qaDocumentId)
    .order("decision_line_number", { ascending: true });

  if (error) {
    logDbError("fetchDecisionLines", error);
    throw new ApiError(500, error.message || "Unable to fetch QA decision lines");
  }

  return data ?? [];
}

function sumDecidedQty(decisionLines: JsonRecord[]): number {
  return roundQty(decisionLines.reduce((sum, line) => sum + (Number(line.decision_qty) || 0), 0));
}

async function fetchQaDocumentDetails(qaDocumentId: string, ctx: QAHandlerContext): Promise<JsonRecord> {
  const qaDocument = await fetchQaDocument(qaDocumentId);
  assertQaCompanyScope(ctx, qaDocument);

  const [testLinesResp, decisionLines] = await Promise.all([
    serviceRoleClient
      .schema("erp_procurement")
      .from("inward_qa_test_line")
      .select("*")
      .eq("qa_document_id", qaDocumentId)
      .order("line_number", { ascending: true }),
    fetchDecisionLines(qaDocumentId),
  ]);

  if (testLinesResp.error) {
    logDbError("fetchQaDocumentDetails test-lines", testLinesResp.error);
    throw new ApiError(500, testLinesResp.error.message || "Unable to fetch QA test lines");
  }

  const totalQty = roundQty(Number(qaDocument.qa_stock_qty) || 0);
  const decidedQty = sumDecidedQty(decisionLines);

  return {
    ...qaDocument,
    qa_doc_number: qaDocument.qa_number,
    total_qty: totalQty,
    decided_qty: decidedQty,
    remaining_qty: roundQty(totalQty - decidedQty),
    created_at: qaDocument.qa_created_at,
    public_status: mapQaStatusForResponse(qaDocument.status),
    test_lines: testLinesResp.data ?? [],
    decision_lines: decisionLines,
  };
}

// goods_receipt is a flat one-row-per-line table (material_id, uom_code, grn_rate,
// storage_location_id all live on the header row itself) — there is no separate
// goods_receipt_line row to join against for GRNs created via the from-line flow, so
// inward_qa_document.grn_line_id is legitimately NULL for those. Read everything QA needs
// straight off goods_receipt instead of depending on a line record that may not exist.
async function fetchGrnContextForQa(qaDocument: QaDocumentRow): Promise<{ grn: Record<string, unknown> }> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("goods_receipt")
    .select("*")
    .eq("id", String(qaDocument.grn_id))
    .single();

  if (error || !data) {
    logDbError("fetchGrnContextForQa grn", error);
    throw new ApiError(500, error?.message || "Unable to fetch linked GRN");
  }

  return { grn: data };
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
    logDbError("getNextTestLineNumber", error);
    throw new ApiError(500, error.message || "Unable to determine QA test line number");
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
    logDbError("getNextDecisionLineNumber", error);
    throw new ApiError(500, error.message || "Unable to determine QA decision line number");
  }

  return (Number(data?.decision_line_number) || 0) + 1;
}

async function postStockMovement(args: {
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
  // §106: Material Document identity for the posting event (MBLNR+MJAHR). The QA
  // business number (documentNumber) is carried as the reference.
  matDoc?: MaterialDocumentRef;
  referenceDocumentId?: string | null;
}): Promise<{ stock_document_id: string; stock_ledger_id: string }> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .rpc("post_stock_movement", {
      p_document_number: args.documentNumber,
      p_document_date: todayIsoDate(),
      p_posting_date: todayIsoDate(),
      p_movement_type_code: args.movementTypeCode,
      p_company_id: args.companyId,
      p_storage_location_id: args.storageLocationId,
      p_material_id: args.materialId,
      p_quantity: args.quantity,
      p_base_uom_code: args.uomCode,
      p_unit_value: args.unitValue,
      p_stock_type_code: args.stockTypeCode,
      p_direction: args.direction,
      p_posted_by: args.postedBy,
      p_reversal_of_id: null,
      p_material_doc_number: args.matDoc?.docNumber ?? null,
      p_material_doc_year: args.matDoc?.docYear ?? null,
      p_reference_document_number: args.matDoc ? args.documentNumber : null,
      p_reference_document_type: args.matDoc ? "QA" : null,
      p_reference_document_id: args.referenceDocumentId ?? null,
    });

  if (error || !Array.isArray(data) || data.length === 0) {
    logDbError("postStockMovement rpc", error ?? { note: "empty/invalid data returned", data });
    throw new ApiError(500, error?.message || "QA stock movement posting failed");
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
    const requestedCompanyId = toTrimmedString(url.searchParams.get("company_id"));
    if (requestedCompanyId) {
      try {
        await assertCompanyScope(ctx, requestedCompanyId);
      } catch {
        return qaErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
      }
    }
    const companyId = requestedCompanyId || getCompanyScope(ctx);
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 200);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("inward_qa_document")
      .select(
        "id, qa_number, grn_id, grn_line_id, material_id, vendor_id, qa_stock_qty, uom_code, status, qa_created_at, company_id",
      )
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
    if (dateFrom) {
      query = query.gte("qa_created_at", dateFrom);
    }
    if (dateTo) {
      query = query.lte("qa_created_at", `${dateTo}T23:59:59.999Z`);
    }

    const { data, error } = await query;
    if (error) {
      logDbError("listQADocumentsHandler query", error);
      throw new ApiError(500, error.message || "Unable to list QA documents");
    }

    const rows = data ?? [];
    const docIds = rows.map((row) => row.id);

    // Bulk-fetch decision lines for all listed docs in one query (no per-row N+1)
    // so the queue can show an accurate "remaining qty" without a detail fetch per row.
    let decidedByDoc = new Map<string, number>();
    if (docIds.length > 0) {
      const { data: decisionRows, error: decisionError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("inward_qa_decision_line")
        .select("qa_document_id, decision_qty")
        .in("qa_document_id", docIds);

      if (decisionError) {
        logDbError("listQADocumentsHandler decision totals", decisionError);
        throw new ApiError(500, decisionError.message || "Unable to resolve QA decision totals");
      }

      decidedByDoc = (decisionRows ?? []).reduce((map, row) => {
        const key = String(row.qa_document_id);
        map.set(key, roundQty((map.get(key) ?? 0) + (Number(row.decision_qty) || 0)));
        return map;
      }, new Map<string, number>());
    }

    const items = rows.map((row) => {
      const totalQty = roundQty(Number(row.qa_stock_qty) || 0);
      const decidedQty = decidedByDoc.get(String(row.id)) ?? 0;
      return {
        ...row,
        qa_doc_number: row.qa_number,
        created_at: row.qa_created_at,
        total_qty: totalQty,
        decided_qty: decidedQty,
        remaining_qty: roundQty(totalQty - decidedQty),
        public_status: mapQaStatusForResponse(row.status),
      };
    });

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
    const remarks = toTrimmedString(body.remarks) || null;
    const testMethodId = toTrimmedString(body.test_method_id) || null;
    const lsl = body.lsl !== undefined && body.lsl !== null && body.lsl !== "" ? Number(body.lsl) : null;
    const usl = body.usl !== undefined && body.usl !== null && body.usl !== "" ? Number(body.usl) : null;

    if (!["VISUAL", "MCT", "LAB", "OTHER"].includes(testType) || !testParameter) {
      throw new ApiError(400, "test_type and test_parameter are required");
    }

    // Auto pass/fail from LSL/USL when both the result and limits are numeric.
    // OTHR (test_type OTHER) results are optional and default to PENDING when blank.
    let passFail = toUpperTrimmedString(body.pass_fail) || "PENDING";
    const numericResult = Number(resultValue);
    if (resultValue && Number.isFinite(numericResult) && (lsl !== null || usl !== null)) {
      const belowLsl = lsl !== null && numericResult < lsl;
      const aboveUsl = usl !== null && numericResult > usl;
      passFail = belowLsl || aboveUsl ? "FAIL" : "PASS";
    } else if (!resultValue) {
      passFail = "PENDING";
    }
    if (!["PASS", "FAIL", "PENDING"].includes(passFail)) {
      throw new ApiError(400, "pass_fail is invalid");
    }
    // MCT rows may be saved without a result (PENDING placeholder) — the mandatory
    // check happens at Usage Decision submit time, not at test-line save time.

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
        test_method_id: testMethodId,
        lsl,
        usl,
        tested_by: ctx.auth_user_id,
        test_date: todayIsoDate(),
      })
      .select("*")
      .single();

    if (error || !data) {
      logDbError("addTestLineHandler insert", error);
      throw new ApiError(500, error?.message || "Unable to add QA test line");
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

    let nextResult: string | null | undefined;
    if (body.result_value !== undefined) {
      nextResult = toTrimmedString(body.result_value) || null;
      patch.test_result = nextResult;
    }

    if (body.pass_fail !== undefined) {
      const passFail = toUpperTrimmedString(body.pass_fail);
      if (!["PASS", "FAIL", "PENDING"].includes(passFail)) {
        throw new ApiError(400, "pass_fail is invalid");
      }
      patch.pass_fail = passFail;
    } else if (nextResult !== undefined) {
      // Re-derive pass/fail from stored LSL/USL when only the result changed.
      const { data: existingLine } = await serviceRoleClient
        .schema("erp_procurement")
        .from("inward_qa_test_line")
        .select("lsl, usl")
        .eq("id", lineId)
        .eq("qa_document_id", qaDocumentId)
        .maybeSingle();

      const lsl = existingLine?.lsl !== null && existingLine?.lsl !== undefined ? Number(existingLine.lsl) : null;
      const usl = existingLine?.usl !== null && existingLine?.usl !== undefined ? Number(existingLine.usl) : null;
      const numericResult = Number(nextResult);
      if (nextResult && Number.isFinite(numericResult) && (lsl !== null || usl !== null)) {
        const belowLsl = lsl !== null && numericResult < lsl;
        const aboveUsl = usl !== null && numericResult > usl;
        patch.pass_fail = belowLsl || aboveUsl ? "FAIL" : "PASS";
      } else if (!nextResult) {
        patch.pass_fail = "PENDING";
      }
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
      if (error) logDbError("updateTestLineHandler update", error);
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

    const decisionLines = await fetchDecisionLines(qaDocumentId);
    if (decisionLines.length > 0) {
      throw new ApiError(409, "Cannot delete test line after a decision has been posted");
    }

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("inward_qa_test_line")
      .delete()
      .eq("id", lineId)
      .eq("qa_document_id", qaDocumentId);

    if (error) {
      logDbError("deleteTestLineHandler delete", error);
      throw new ApiError(500, error.message || "Unable to delete QA test line");
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete QA test line";
    const status = error instanceof ApiError ? error.status : 500;
    return qaErrorResponse(req, ctx, "QA_TESTLINE_DELETE_FAILED", status, message);
  }
}

/**
 * Submits a batch of usage decisions for a QA document. Partial decisions are allowed —
 * the batch only needs to cover <= the remaining (undecided) quantity. Storage location is
 * never taken from the client; it is always the GRN line's storage location (QA only
 * reclassifies stock type, it never moves material to a different physical location).
 * Document status becomes DECIDED only once the full qa_stock_qty has been decided across
 * all batches; otherwise it stays IN_PROGRESS and the row remains open in the queue.
 */
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

    const existingDecisionLines = await fetchDecisionLines(qaDocumentId);
    const totalQty = roundQty(Number(qaDocument.qa_stock_qty) || 0);
    const alreadyDecidedQty = sumDecidedQty(existingDecisionLines);
    const remainingBeforeSubmit = roundQty(totalQty - alreadyDecidedQty);

    if (remainingBeforeSubmit <= QTY_EPSILON) {
      throw new ApiError(409, "QA document has already been fully decided");
    }

    const body = await parseBody(req);
    const decisionLines = parseDecisionLines(body);
    if (decisionLines.length === 0) {
      throw new ApiError(400, "decision_lines is required");
    }

    const sumQty = roundQty(
      decisionLines.reduce((sum, line) => sum + (Number.isFinite(line.quantity) ? line.quantity : 0), 0),
    );
    if (sumQty <= QTY_EPSILON) {
      throw new ApiError(400, "Sum of decision line quantities must be greater than zero");
    }
    if (sumQty - remainingBeforeSubmit > QTY_EPSILON) {
      throw new ApiError(
        400,
        `Sum of decision line quantities (${sumQty}) exceeds remaining undecided quantity (${remainingBeforeSubmit})`,
      );
    }

    const { grn } = await fetchGrnContextForQa(qaDocument);
    const storageLocationId = toTrimmedString(grn.storage_location_id);
    if (!storageLocationId) {
      throw new ApiError(500, "GRN has no storage location — cannot post QA decision");
    }

    const baseUom = toTrimmedString(qaDocument.uom_code || grn.uom_code);
    const unitValue = Number(grn.grn_rate ?? 0);
    const companyId = String(qaDocument.company_id);
    let nextLineNumber = await getNextDecisionLineNumber(qaDocumentId);
    const createdDecisionLines: JsonRecord[] = [];
    let hasReject = false;

    // §106: one Material Document (MBLNR+MJAHR) for this whole usage-decision event; the
    // qa_number becomes the reference. Every OUT/IN pair below is an item under it.
    const qaMatDoc = await generateMaterialDocNumber(companyId);

    // DEPENDENT: each usage decision posts stock movements whose sequence must stay ordered to avoid ledger/state drift.
    for (const decisionLine of decisionLines) {
      const config = QA_DECISION_MOVEMENT_MAP[decisionLine.usage_decision];
      if (!config) {
        throw new ApiError(400, `Invalid usage_decision: ${decisionLine.usage_decision}`);
      }
      if (!Number.isFinite(decisionLine.quantity) || decisionLine.quantity <= 0) {
        throw new ApiError(400, "decision_lines.quantity must be greater than zero");
      }
      if (decisionLine.usage_decision === "FOR_REPROCESS") {
        assertQAManagerRole(ctx);
      }

      // post_stock_movement() auto-assigns item_number (SAP MKPF/MSEG style) per
      // (document_number, document_year), so every call under the same Material Document
      // gets its own item — no client-side suffixing needed.
      const outPosting = await postStockMovement({
        documentNumber: String(qaDocument.qa_number),
        movementTypeCode: config.movementType,
        companyId,
        storageLocationId,
        materialId: String(qaDocument.material_id),
        quantity: decisionLine.quantity,
        uomCode: baseUom,
        unitValue,
        stockTypeCode: "QUALITY_INSPECTION",
        direction: "OUT",
        postedBy: ctx.auth_user_id,
        matDoc: qaMatDoc,
        referenceDocumentId: qaDocumentId,
      });

      let finalPosting = outPosting;
      if (config.targetStockType) {
        finalPosting = await postStockMovement({
          documentNumber: String(qaDocument.qa_number),
          movementTypeCode: config.movementType,
          companyId,
          storageLocationId,
          materialId: String(qaDocument.material_id),
          quantity: decisionLine.quantity,
          uomCode: baseUom,
          unitValue,
          stockTypeCode: config.targetStockType,
          direction: "IN",
          postedBy: ctx.auth_user_id,
          matDoc: qaMatDoc,
          referenceDocumentId: qaDocumentId,
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
          storage_location_id: storageLocationId,
          stock_document_id: finalPosting.stock_document_id,
          stock_ledger_id: finalPosting.stock_ledger_id,
          decided_by: ctx.auth_user_id,
          decided_at: new Date().toISOString(),
          remarks: decisionLine.remarks ?? null,
        })
        .select("*")
        .single();

      if (insertError || !insertedDecision) {
        logDbError("submitUsageDecisionHandler decision-line insert", insertError);
        throw new ApiError(500, insertError?.message || "Unable to create QA decision line");
      }

      createdDecisionLines.push(insertedDecision);
      nextLineNumber += 1;
      if (decisionLine.usage_decision === "REJECT") {
        hasReject = true;
      }
    }

    const remainingAfterSubmit = roundQty(remainingBeforeSubmit - sumQty);
    const nextStatus = remainingAfterSubmit <= QTY_EPSILON ? "DECIDED" : "IN_PROGRESS";

    const currentRemarks = toTrimmedString(qaDocument.remarks);
    const nextRemarks = hasReject
      ? [currentRemarks, "RTV_PENDING"].filter(Boolean).join(" | ")
      : currentRemarks || null;

    const { data: updatedQaDocument, error: updateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("inward_qa_document")
      .update({
        status: nextStatus,
        remarks: nextRemarks,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", qaDocumentId)
      .select("*")
      .single();

    if (updateError || !updatedQaDocument) {
      logDbError("submitUsageDecisionHandler qa-document status update", updateError);
      throw new ApiError(500, updateError?.message || "Unable to update QA document status");
    }

    return okResponse(
      {
        qa_document: {
          ...updatedQaDocument,
          total_qty: totalQty,
          decided_qty: roundQty(alreadyDecidedQty + sumQty),
          remaining_qty: remainingAfterSubmit,
          public_status: mapQaStatusForResponse(nextStatus),
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
