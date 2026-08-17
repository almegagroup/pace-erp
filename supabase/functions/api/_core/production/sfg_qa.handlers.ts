/*
 * File-Path: supabase/functions/api/_core/production/sfg_qa.handlers.ts
 * Domain: PRODUCTION
 * Purpose: SFG Result Recording lifecycle - test entry and result recording for
 *          verified Process PO batches, cloned from Procurement Inward QA.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { todayIsoInKolkata } from "../../_shared/dateUtils.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import {
  assertProdReadRole,
  parseBody,
  toTrimmedString,
  toUpperTrimmedString,
  getIdFromPath,
} from "./production.shared.ts";

type JsonRecord = Record<string, unknown>;
type QaDocumentRow = Record<string, unknown>;

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const QA_DOC_MUTABLE_STATUSES = new Set(["PENDING", "IN_PROGRESS"]);
const QA_PUBLIC_STATUS_MAP: Record<string, string> = {
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  DECIDED: "DECISION_MADE",
};
const ELIGIBLE_PO_TYPES = ["MTO", "HPS", "MTS"];
const QTY_EPSILON = 0.000001;

function logDbError(context: string, error: unknown): void {
  console.error(`[SFG_QA_DB_ERROR] ${context}:`, JSON.stringify(error));
}

function sfgQaErrorResponse(
  req: Request,
  ctx: ProdHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  console.warn(`[SFG_QA_ERROR] ${req.method} ${new URL(req.url).pathname} -> ${status} ${code}: ${message}`);
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function getCompanyScope(ctx: ProdHandlerContext): string {
  return toTrimmedString(ctx.context.companyId);
}

function todayIsoDate(): string {
  return todayIsoInKolkata();
}

function roundQty(value: number): number {
  return Number(value.toFixed(6));
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function mapQaStatusForResponse(rawStatus: unknown): string {
  const status = toUpperTrimmedString(rawStatus);
  return QA_PUBLIC_STATUS_MAP[status] ?? status;
}

async function generateProcurementDocNumber(docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("generate_doc_number", { p_doc_type: docType });
  if (error || !data) {
    logDbError("generateProcurementDocNumber", error);
    throw new ApiError(500, "Unable to generate SFG QA number");
  }
  return String(data);
}

async function getMaterialMapByIds(materialIds: string[]): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(materialIds.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, pace_code, material_name, shade_code, material_category, base_uom_code")
    .in("id", ids);
  if (error) {
    logDbError("getMaterialMapByIds", error);
    throw new ApiError(500, "Unable to resolve prodshade materials");
  }
  for (const row of (data ?? []) as JsonRecord[]) {
    map.set(String(row.id), row);
  }
  return map;
}

async function getStorageLocationMapByIds(storageLocationIds: string[]): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(storageLocationIds.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_master")
    .select("id, code, name")
    .in("id", ids);
  if (error) {
    logDbError("getStorageLocationMapByIds", error);
    throw new ApiError(500, "Unable to resolve storage locations");
  }
  for (const row of (data ?? []) as JsonRecord[]) {
    map.set(String(row.id), row);
  }
  return map;
}

async function getStrokeNumberMapByIds(strokeIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(strokeIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("stroke_master")
    .select("id, stroke_number")
    .in("id", ids);
  if (error) {
    logDbError("getStrokeNumberMapByIds", error);
    throw new ApiError(500, "Unable to resolve stroke numbers");
  }
  for (const row of (data ?? []) as JsonRecord[]) {
    map.set(String(row.id), String(row.stroke_number ?? ""));
  }
  return map;
}

async function resolveOutputStorageLocationId(strokeMasterId: string | null): Promise<string | null> {
  if (!strokeMasterId) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("stroke_master")
    .select("default_storage_location_id")
    .eq("id", strokeMasterId)
    .maybeSingle();
  if (error) {
    logDbError("resolveOutputStorageLocationId", error);
    throw new ApiError(500, "Unable to resolve output storage location");
  }
  return toTrimmedString((data as JsonRecord | null)?.default_storage_location_id) || null;
}

async function fetchQaDocument(qaDocumentId: string): Promise<QaDocumentRow> {
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("sfg_qa_document")
    .select("*")
    .eq("id", qaDocumentId)
    .single();
  if (error || !data) {
    if (error) logDbError("fetchQaDocument", error);
    throw new ApiError(404, "SFG QA document not found");
  }
  return data as QaDocumentRow;
}

function assertQaCompanyScope(ctx: ProdHandlerContext, qaDocument: QaDocumentRow): void {
  const scopedCompanyId = getCompanyScope(ctx);
  if (scopedCompanyId && String(qaDocument.company_id) !== scopedCompanyId) {
    throw new ApiError(403, "SFG QA document is outside company scope");
  }
}

async function fetchDecisionLines(qaDocumentId: string): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("sfg_qa_decision_line")
    .select("*")
    .eq("qa_document_id", qaDocumentId)
    .order("decision_line_number", { ascending: true });
  if (error) {
    logDbError("fetchDecisionLines", error);
    throw new ApiError(500, error.message || "Unable to fetch SFG QA decision lines");
  }
  return data ?? [];
}

function sumDecidedQty(decisionLines: JsonRecord[]): number {
  return roundQty(decisionLines.reduce((sum, line) => sum + (Number(line.decision_qty) || 0), 0));
}

async function listMandatoryMctConfigs(companyId: string, materialCategory: string): Promise<JsonRecord[]> {
  if (!companyId || !materialCategory) return [];
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("qa_category_test_config")
    .select(`
      id,
      company_id,
      material_category,
      test_method_id,
      lsl,
      usl,
      qa_test_method:test_method_id (
        id,
        test_group,
        method_name
      )
    `)
    .eq("company_id", companyId)
    .eq("material_category", materialCategory);
  if (error) {
    logDbError("listMandatoryMctConfigs", error);
    throw new ApiError(500, error.message || "Unable to resolve mandatory MCT methods");
  }
  return ((data ?? []) as JsonRecord[]).filter((row) =>
    toUpperTrimmedString((row.qa_test_method as JsonRecord | null)?.test_group) === "MCT"
  );
}

async function fetchProcessOrdersByIds(processOrderIds: string[]): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(processOrderIds.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (ids.length === 0) return map;

  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("process_order")
    .select(`
      id, company_id, po_number, po_type, material_id, stroke_master_id, batch_number,
      actual_qty, planned_qty, status, verified_at
    `)
    .in("id", ids);
  if (error) {
    logDbError("fetchProcessOrdersByIds", error);
    throw new ApiError(500, "Unable to resolve Process PO context");
  }

  for (const row of (data ?? []) as JsonRecord[]) {
    map.set(String(row.id), row);
  }
  return map;
}

async function fetchQaDocumentDetails(qaDocumentId: string, ctx: ProdHandlerContext): Promise<JsonRecord> {
  const qaDocument = await fetchQaDocument(qaDocumentId);
  assertQaCompanyScope(ctx, qaDocument);

  const processOrderMap = await fetchProcessOrdersByIds([String(qaDocument.process_order_id)]);
  const processOrder = processOrderMap.get(String(qaDocument.process_order_id));
  if (!processOrder) {
    throw new ApiError(500, "Linked Process PO not found");
  }

  const [testLinesResp, decisionLines] = await Promise.all([
    serviceRoleClient
      .schema("erp_production")
      .from("sfg_qa_test_line")
      .select("*")
      .eq("qa_document_id", qaDocumentId)
      .order("line_number", { ascending: true }),
    fetchDecisionLines(qaDocumentId),
  ]);

  if (testLinesResp.error) {
    logDbError("fetchQaDocumentDetails test-lines", testLinesResp.error);
    throw new ApiError(500, testLinesResp.error.message || "Unable to fetch SFG QA test lines");
  }

  const [materialMap, strokeNumberMap] = await Promise.all([
    getMaterialMapByIds([String(processOrder.material_id ?? "")]),
    getStrokeNumberMapByIds([String(processOrder.stroke_master_id ?? "")]),
  ]);
  const storageLocationId = await resolveOutputStorageLocationId(toTrimmedString(processOrder.stroke_master_id) || null);
  const storageLocationMap = await getStorageLocationMapByIds(storageLocationId ? [storageLocationId] : []);

  const totalQty = roundQty(Number(qaDocument.qa_stock_qty) || 0);
  const decidedQty = decisionLines.length > 0
    ? sumDecidedQty(decisionLines)
    : toUpperTrimmedString(qaDocument.status) === "DECIDED"
    ? totalQty
    : 0;
  const material = materialMap.get(String(processOrder.material_id ?? "")) ?? null;
  const storageLocation = storageLocationId ? storageLocationMap.get(storageLocationId) ?? null : null;

  return {
    ...qaDocument,
    qa_doc_number: qaDocument.sfg_qa_number,
    total_qty: totalQty,
    decided_qty: decidedQty,
    remaining_qty: roundQty(totalQty - decidedQty),
    created_at: qaDocument.qa_created_at,
    public_status: mapQaStatusForResponse(qaDocument.status),
    po_number: processOrder.po_number ?? null,
    po_type: processOrder.po_type ?? null,
    verified_at: processOrder.verified_at ?? null,
    stroke_number: strokeNumberMap.get(String(processOrder.stroke_master_id ?? "")) || null,
    material,
    storage_location_id: storageLocationId || null,
    storage_location: storageLocation,
    test_lines: testLinesResp.data ?? [],
    decision_lines: decisionLines,
  };
}

async function getNextTestLineNumber(qaDocumentId: string): Promise<number> {
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("sfg_qa_test_line")
    .select("line_number")
    .eq("qa_document_id", qaDocumentId)
    .order("line_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logDbError("getNextTestLineNumber", error);
    throw new ApiError(500, error.message || "Unable to determine SFG QA test line number");
  }
  return (Number(data?.line_number) || 0) + 1;
}

async function ensureQaDocumentsForProcessOrders(
  processOrders: JsonRecord[],
  authUserId: string,
  materialMap: Map<string, JsonRecord>,
): Promise<Map<string, JsonRecord>> {
  const processOrderIds = processOrders.map((row) => String(row.id));
  const result = new Map<string, JsonRecord>();
  if (processOrderIds.length === 0) return result;

  const { data: existingRows, error: existingError } = await serviceRoleClient
    .schema("erp_production")
    .from("sfg_qa_document")
    .select("*")
    .in("process_order_id", processOrderIds);
  if (existingError) {
    logDbError("ensureQaDocumentsForProcessOrders existing", existingError);
    throw new ApiError(500, "Unable to load SFG QA documents");
  }

  for (const row of (existingRows ?? []) as JsonRecord[]) {
    result.set(String(row.process_order_id), row);
  }

  for (const processOrder of processOrders) {
    const processOrderId = String(processOrder.id);
    if (result.has(processOrderId)) continue;

    const sfgQaNumber = await generateProcurementDocNumber("SFG_QA");
    const qaStockQty = roundQty(Number(processOrder.actual_qty ?? processOrder.planned_qty ?? 0));
    if (qaStockQty <= 0) continue;

    const material = materialMap.get(String(processOrder.material_id ?? ""));
    const { data: inserted, error: insertError } = await serviceRoleClient
      .schema("erp_production")
      .from("sfg_qa_document")
      .insert({
        sfg_qa_number: sfgQaNumber,
        company_id: processOrder.company_id,
        process_order_id: processOrder.id,
        material_id: processOrder.material_id,
        batch_number: processOrder.batch_number ?? null,
        qa_stock_qty: qaStockQty,
        uom_code: material?.base_uom_code ?? "KG",
        status: "PENDING",
        remarks: "Auto-created from Process PO Verify queue",
        last_updated_at: new Date().toISOString(),
        last_updated_by: authUserId,
      })
      .select("*")
      .single();
    if (insertError || !inserted) {
      logDbError("ensureQaDocumentsForProcessOrders insert", insertError);
      throw new ApiError(500, insertError?.message || "Unable to create SFG QA document");
    }
    result.set(processOrderId, inserted as JsonRecord);
  }

  return result;
}

export async function listSfgQaDocumentsHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const companyId = toTrimmedString(url.searchParams.get("company_id")) || getCompanyScope(ctx);
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 200);

    let query = serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .select("id, company_id, po_number, po_type, material_id, stroke_master_id, batch_number, actual_qty, planned_qty, status, verified_at")
      .eq("status", "VERIFIED")
      .in("po_type", ELIGIBLE_PO_TYPES)
      .order("verified_at", { ascending: false })
      .limit(limit);

    if (companyId) {
      query = query.eq("company_id", companyId);
    }
    if (dateFrom) {
      query = (query as typeof query & { gte: (column: string, value: string) => typeof query }).gte("verified_at", dateFrom);
    }
    if (dateTo) {
      query = (query as typeof query & { lte: (column: string, value: string) => typeof query }).lte("verified_at", `${dateTo}T23:59:59.999Z`);
    }

    const { data, error } = await query;
    if (error) {
      logDbError("listSfgQaDocumentsHandler process-order query", error);
      throw new ApiError(500, error.message || "Unable to list SFG QA source documents");
    }

    const processOrders = (data ?? []) as JsonRecord[];
    const [materialMap, strokeNumberMap] = await Promise.all([
      getMaterialMapByIds(processOrders.map((row) => String(row.material_id ?? ""))),
      getStrokeNumberMapByIds(processOrders.map((row) => String(row.stroke_master_id ?? ""))),
    ]);
    const docsByProcessOrderId = await ensureQaDocumentsForProcessOrders(processOrders, ctx.auth_user_id, materialMap);
    const qaDocs = Array.from(docsByProcessOrderId.values());
    const qaDocIds = qaDocs.map((row) => String(row.id));

    let decidedByDoc = new Map<string, number>();
    if (qaDocIds.length > 0) {
      const { data: decisionRows, error: decisionError } = await serviceRoleClient
        .schema("erp_production")
        .from("sfg_qa_decision_line")
        .select("qa_document_id, decision_qty")
        .in("qa_document_id", qaDocIds);
      if (decisionError) {
        logDbError("listSfgQaDocumentsHandler decision totals", decisionError);
        throw new ApiError(500, decisionError.message || "Unable to resolve SFG QA decision totals");
      }
      decidedByDoc = ((decisionRows ?? []) as JsonRecord[]).reduce((map: Map<string, number>, row: JsonRecord) => {
        const key = String(row.qa_document_id);
        map.set(key, roundQty((map.get(key) ?? 0) + (Number(row.decision_qty) || 0)));
        return map;
      }, new Map<string, number>());
    }
    const processOrderMap = new Map(processOrders.map((row) => [String(row.id), row]));

    const items = qaDocs
      .map((qaDoc) => {
        const processOrder = processOrderMap.get(String(qaDoc.process_order_id));
        if (!processOrder) return null;
        const totalQty = roundQty(Number(qaDoc.qa_stock_qty) || 0);
        const decidedQty = decidedByDoc.has(String(qaDoc.id))
          ? decidedByDoc.get(String(qaDoc.id)) ?? 0
          : toUpperTrimmedString(qaDoc.status) === "DECIDED"
          ? totalQty
          : 0;
        return {
          ...qaDoc,
          id: qaDoc.id,
          qa_doc_number: qaDoc.sfg_qa_number,
          created_at: qaDoc.qa_created_at,
          total_qty: totalQty,
          decided_qty: decidedQty,
          remaining_qty: roundQty(totalQty - decidedQty),
          public_status: mapQaStatusForResponse(qaDoc.status),
          process_order_id: processOrder.id,
          po_number: processOrder.po_number ?? null,
          po_type: processOrder.po_type ?? null,
          verified_at: processOrder.verified_at ?? null,
          batch_number: qaDoc.batch_number ?? processOrder.batch_number ?? null,
          material: materialMap.get(String(processOrder.material_id ?? "")) ?? null,
          material_id: processOrder.material_id,
          stroke_number: strokeNumberMap.get(String(processOrder.stroke_master_id ?? "")) || null,
          uom_code: qaDoc.uom_code ?? null,
        };
      })
      .filter(Boolean) as JsonRecord[];

    const filteredItems = status
      ? items.filter((row) => {
        if (status === "DECISION_MADE") return row.public_status === "DECISION_MADE";
        return String(row.public_status) === status;
      })
      : items;

    return okResponse(filteredItems, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list SFG QA documents";
    const status = error instanceof ApiError ? error.status : 500;
    return sfgQaErrorResponse(req, ctx, "SFG_QA_LIST_FAILED", status, message);
  }
}

export async function getSfgQaDocumentHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const qaDocumentId = getIdFromPath(req);
    if (!qaDocumentId) {
      throw new ApiError(400, "SFG QA document id is required");
    }
    return okResponse(await fetchQaDocumentDetails(qaDocumentId, ctx), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to fetch SFG QA document";
    const status = error instanceof ApiError ? error.status : 500;
    return sfgQaErrorResponse(req, ctx, "SFG_QA_FETCH_FAILED", status, message);
  }
}

export async function addSfgQaTestLineHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const qaDocumentId = getIdFromPath(req);
    if (!qaDocumentId) {
      throw new ApiError(400, "SFG QA document id is required");
    }

    const qaDocument = await fetchQaDocument(qaDocumentId);
    assertQaCompanyScope(ctx, qaDocument);
    if (!QA_DOC_MUTABLE_STATUSES.has(toUpperTrimmedString(qaDocument.status))) {
      throw new ApiError(409, "SFG QA document is read-only");
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

    const { data, error } = await serviceRoleClient
      .schema("erp_production")
      .from("sfg_qa_test_line")
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
      logDbError("addSfgQaTestLineHandler insert", error);
      throw new ApiError(500, error?.message || "Unable to add SFG QA test line");
    }

    if (toUpperTrimmedString(qaDocument.status) === "PENDING") {
      await serviceRoleClient
        .schema("erp_production")
        .from("sfg_qa_document")
        .update({
          status: "IN_PROGRESS",
          last_updated_at: new Date().toISOString(),
          last_updated_by: ctx.auth_user_id,
        })
        .eq("id", qaDocumentId);
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to add SFG QA test line";
    const status = error instanceof ApiError ? error.status : 500;
    return sfgQaErrorResponse(req, ctx, "SFG_QA_TESTLINE_CREATE_FAILED", status, message);
  }
}

export async function updateSfgQaTestLineHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const qaDocumentId = getIdFromPath(req);
    const lineId = getIdFromPath(req, 5);
    if (!qaDocumentId || !lineId) {
      throw new ApiError(400, "SFG QA document id and test line id are required");
    }

    const qaDocument = await fetchQaDocument(qaDocumentId);
    assertQaCompanyScope(ctx, qaDocument);
    if (!QA_DOC_MUTABLE_STATUSES.has(toUpperTrimmedString(qaDocument.status))) {
      throw new ApiError(409, "SFG QA document is read-only");
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
      const { data: existingLine } = await serviceRoleClient
        .schema("erp_production")
        .from("sfg_qa_test_line")
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
      .schema("erp_production")
      .from("sfg_qa_test_line")
      .update(patch)
      .eq("id", lineId)
      .eq("qa_document_id", qaDocumentId)
      .select("*")
      .single();
    if (error || !data) {
      if (error) logDbError("updateSfgQaTestLineHandler update", error);
      throw new ApiError(404, "SFG QA test line not found");
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update SFG QA test line";
    const status = error instanceof ApiError ? error.status : 500;
    return sfgQaErrorResponse(req, ctx, "SFG_QA_TESTLINE_UPDATE_FAILED", status, message);
  }
}

export async function submitSfgQaDecisionHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const qaDocumentId = getIdFromPath(req);
    if (!qaDocumentId) {
      throw new ApiError(400, "SFG QA document id is required");
    }

    const qaDocument = await fetchQaDocument(qaDocumentId);
    assertQaCompanyScope(ctx, qaDocument);
    if (!QA_DOC_MUTABLE_STATUSES.has(toUpperTrimmedString(qaDocument.status))) {
      throw new ApiError(400, "SFG QA document is not eligible for result recording");
    }

    const existingDecisionLines = await fetchDecisionLines(qaDocumentId);
    const totalQty = roundQty(Number(qaDocument.qa_stock_qty) || 0);
    const alreadyDecidedQty = sumDecidedQty(existingDecisionLines);
    const remainingBeforeSubmit = roundQty(totalQty - alreadyDecidedQty);
    if (remainingBeforeSubmit <= QTY_EPSILON) {
      throw new ApiError(409, "SFG QA document has already been fully recorded");
    }

    await parseBody(req);
    const processOrderMap = await fetchProcessOrdersByIds([String(qaDocument.process_order_id)]);
    const processOrder = processOrderMap.get(String(qaDocument.process_order_id));
    if (!processOrder) {
      throw new ApiError(500, "Linked Process PO not found");
    }
    const materialCategory = toTrimmedString(processOrder.material_id)
      ? toUpperTrimmedString((await getMaterialMapByIds([String(processOrder.material_id)])).get(String(processOrder.material_id))?.material_category)
      : "";
    const mandatoryMctConfigs = await listMandatoryMctConfigs(String(processOrder.company_id ?? qaDocument.company_id ?? ""), materialCategory);
    const { data: testLines, error: testLinesError } = await serviceRoleClient
      .schema("erp_production")
      .from("sfg_qa_test_line")
      .select("test_method_id, test_result")
      .eq("qa_document_id", qaDocumentId);
    if (testLinesError) {
      logDbError("submitSfgQaDecisionHandler test-lines", testLinesError);
      throw new ApiError(500, testLinesError.message || "Unable to validate SFG QA test results");
    }
    const testResultByMethod = new Map<string, string>();
    for (const line of (testLines ?? []) as JsonRecord[]) {
      const methodId = toTrimmedString(line.test_method_id);
      if (!methodId) continue;
      testResultByMethod.set(methodId, toTrimmedString(line.test_result));
    }
    const missingMandatoryMethods = mandatoryMctConfigs.filter((config) => {
      const methodId = toTrimmedString(config.test_method_id);
      return !methodId || !testResultByMethod.get(methodId);
    });
    if (missingMandatoryMethods.length > 0) {
      const methodNames = missingMandatoryMethods
        .map((config) => toTrimmedString((config.qa_test_method as JsonRecord | null)?.method_name))
        .filter(Boolean)
        .join(", ");
      throw new ApiError(400, `Mandatory MCT result missing for: ${methodNames}`);
    }

    const nextStatus = "DECIDED";
    const { data: updatedQaDocument, error: updateError } = await serviceRoleClient
      .schema("erp_production")
      .from("sfg_qa_document")
      .update({
        status: nextStatus,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", qaDocumentId)
      .select("*")
      .single();
    if (updateError || !updatedQaDocument) {
      logDbError("submitSfgQaDecisionHandler qa-document status update", updateError);
      throw new ApiError(500, updateError?.message || "Unable to update SFG QA document status");
    }

    return okResponse(
      {
        qa_document: {
          ...updatedQaDocument,
          total_qty: totalQty,
          decided_qty: totalQty,
          remaining_qty: 0,
          public_status: mapQaStatusForResponse(nextStatus),
        },
        decision_lines: existingDecisionLines,
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit SFG QA result";
    const status = error instanceof ApiError ? error.status : 500;
    return sfgQaErrorResponse(req, ctx, "SFG_QA_DECISION_FAILED", status, message);
  }
}
