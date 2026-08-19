/*
 * File-Path: supabase/functions/api/_core/procurement/stock_status_change.handlers.ts
 * Domain: PROCUREMENT / INVENTORY (Quality Assurance ACL group)
 * Purpose: IN13 Stock Status Change — SAP MB1B-equivalent generic Unrestricted/
 *   QI/Blocked transfer posting for any already-at-rest material (RM/PM/INT/
 *   SFG/FG). See feasibility doc Section 126.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { todayIsoInKolkata } from "../../_shared/dateUtils.ts";
import { assertCompanyScope, isCompanyScopeAdminBypass } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { generateMaterialDocNumber } from "../../_shared/materialDocument.ts";
import { hasBlanketApprovalOverride } from "../../_shared/approval_override.ts";
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type SscHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const RESOURCE = "PROD_STOCK_STATUS_CHANGE";
const STOCK_TYPES = new Set(["UNRESTRICTED", "QUALITY_INSPECTION", "BLOCKED"]);
const EPSILON = 0.000001;

// §126.3 — the only 6 valid transitions, their movement type, and whether the
// Blocked->Unrestricted one needs a maker-checker approval before it posts.
const TRANSITIONS: Record<string, { movementTypeCode: string; requiresApproval: boolean }> = {
  "UNRESTRICTED->QUALITY_INSPECTION": { movementTypeCode: "P322", requiresApproval: false },
  "UNRESTRICTED->BLOCKED": { movementTypeCode: "P344", requiresApproval: false },
  "QUALITY_INSPECTION->BLOCKED": { movementTypeCode: "P323", requiresApproval: false },
  "BLOCKED->QUALITY_INSPECTION": { movementTypeCode: "P349", requiresApproval: false },
  "QUALITY_INSPECTION->UNRESTRICTED": { movementTypeCode: "P321", requiresApproval: false },
  "BLOCKED->UNRESTRICTED": { movementTypeCode: "P343", requiresApproval: true },
};

// Reversal pairing (movement_type_master.reversed_by, confirmed live 2026-08-19).
const REVERSAL_MOVEMENT: Record<string, string> = {
  P321: "P322",
  P322: "P321",
  P323: "P349",
  P349: "P323",
  P344: "P343",
  P343: "P344",
};

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function todayIsoDate(): string {
  return todayIsoInKolkata();
}

function getIdFromPath(req: Request): string {
  // /api/procurement/stock-status-change/postings/:id/(approve|reverse)
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("postings");
  return idx >= 0 ? (parts[idx + 1] ?? "") : "";
}

function sscError(
  req: Request,
  ctx: SscHandlerContext,
  code: string,
  status: number,
  message: string,
  extra?: JsonRecord,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, extra ?? {}, req);
}

async function assertScopedCompanyAccess(
  ctx: SscHandlerContext,
  companyId: string,
  action: "VIEW" | "WRITE" | "APPROVE",
): Promise<void> {
  try {
    await assertCompanyScope(ctx, companyId);
  } catch {
    throw new Error("SSC_SCOPE_VIOLATION");
  }
  if (isCompanyScopeAdminBypass(ctx)) return;
  const allowed = await canMaintainCompanyResource(ctx, companyId, RESOURCE, action);
  if (!allowed) throw new Error("SSC_SCOPE_VIOLATION");
}

async function generateSscDocNumber(): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("generate_doc_number", { p_doc_type: "SSC" });
  if (error || !data) throw new Error("SSC_DOC_NUMBER_FAILED");
  return String(data);
}

// §126.7 — the source stock-type's current valuation_rate for this exact
// (material, location, batch) combination, same resolution Location Transfer
// already uses (last posted rate for that scope) — preserves value 1:1.
async function getStockTypeBalances(params: {
  companyId: string;
  storageLocationId: string;
  materialId: string;
  batchNumber?: string | null;
}): Promise<Record<string, { quantity: number; valuationRate: number }>> {
  let query = serviceRoleClient
    .schema("erp_inventory")
    .from("stock_ledger")
    .select("stock_type_code, direction, quantity, valuation_rate")
    .eq("company_id", params.companyId)
    .eq("storage_location_id", params.storageLocationId)
    .eq("material_id", params.materialId);
  const batchNumber = toTrimmedString(params.batchNumber);
  query = batchNumber ? query.eq("batch_number", batchNumber) : query.is("batch_number", null);

  const { data, error } = await query;
  if (error) throw new Error("SSC_STOCK_LOOKUP_FAILED");

  const result: Record<string, { quantity: number; valuationRate: number }> = {
    UNRESTRICTED: { quantity: 0, valuationRate: 0 },
    QUALITY_INSPECTION: { quantity: 0, valuationRate: 0 },
    BLOCKED: { quantity: 0, valuationRate: 0 },
  };
  for (const row of (data ?? []) as JsonRecord[]) {
    const stockType = toUpperTrimmedString(row.stock_type_code);
    if (!STOCK_TYPES.has(stockType)) continue;
    const sign = toUpperTrimmedString(row.direction) === "OUT" ? -1 : 1;
    const qty = Number(row.quantity ?? 0) * sign;
    result[stockType].quantity = Number((result[stockType].quantity + qty).toFixed(6));
    const rate = Number(row.valuation_rate ?? 0);
    if (rate > 0) result[stockType].valuationRate = rate;
  }
  return result;
}

// GET /api/procurement/stock-status-change/balance?company_id=&material_id=&storage_location_id=&batch_number=
export async function getStockStatusChangeBalanceHandler(req: Request, ctx: SscHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const materialId = toTrimmedString(url.searchParams.get("material_id"));
    const storageLocationId = toTrimmedString(url.searchParams.get("storage_location_id"));
    const batchNumber = toTrimmedString(url.searchParams.get("batch_number")) || null;
    if (!companyId || !materialId || !storageLocationId) {
      return sscError(req, ctx, "SSC_BALANCE_PARAMS_REQUIRED", 400, "company_id, material_id and storage_location_id are required.");
    }
    await assertScopedCompanyAccess(ctx, companyId, "VIEW");

    const balances = await getStockTypeBalances({ companyId, storageLocationId, materialId, batchNumber });
    return okResponse({ data: balances }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SSC_BALANCE_FETCH_FAILED";
    return sscError(req, ctx, code, code === "SSC_SCOPE_VIOLATION" ? 403 : 500, "Unable to fetch stock status balance.");
  }
}

type PostLineInput = {
  materialId: string;
  storageLocationId: string;
  batchNumber?: string | null;
  packingPoNumber?: string | null;
  fromStockType: string;
  toStockType: string;
  enteredQuantity: number;
  reason: string;
};

// POST /api/procurement/stock-status-change/postings
// Body: { company_id, lines: PostLineInput[] }
// §126.1 — multi-line; each line independently checked (§126.2) and posted.
// §126.3 — 5 transitions post immediately, Blocked->Unrestricted stops at
// PENDING_APPROVAL (no stock movement yet).
export async function postStockStatusChangeHandler(req: Request, ctx: SscHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    if (!companyId) return sscError(req, ctx, "SSC_COMPANY_ID_REQUIRED", 400, "company_id is required.");
    await assertScopedCompanyAccess(ctx, companyId, "WRITE");

    const rawLines = Array.isArray(body.lines) ? body.lines : [];
    if (rawLines.length === 0) return sscError(req, ctx, "SSC_LINES_REQUIRED", 400, "At least one line is required.");

    const lines: PostLineInput[] = rawLines.map((raw: JsonRecord) => ({
      materialId: toTrimmedString(raw.material_id),
      storageLocationId: toTrimmedString(raw.storage_location_id),
      batchNumber: toTrimmedString(raw.batch_number) || null,
      packingPoNumber: toTrimmedString(raw.packing_po_number) || null,
      fromStockType: toUpperTrimmedString(raw.from_stock_type),
      toStockType: toUpperTrimmedString(raw.to_stock_type),
      enteredQuantity: Number(raw.quantity),
      reason: toTrimmedString(raw.reason),
    }));

    for (const [index, line] of lines.entries()) {
      if (!line.materialId || !line.storageLocationId) {
        return sscError(req, ctx, "SSC_LINE_LOCATION_REQUIRED", 400, `Line ${index + 1}: material and storage location are required.`);
      }
      if (!STOCK_TYPES.has(line.fromStockType) || !STOCK_TYPES.has(line.toStockType)) {
        return sscError(req, ctx, "SSC_LINE_STOCK_TYPE_INVALID", 400, `Line ${index + 1}: invalid stock type.`);
      }
      const transitionKey = `${line.fromStockType}->${line.toStockType}`;
      if (!(transitionKey in TRANSITIONS)) {
        return sscError(req, ctx, "SSC_LINE_TRANSITION_INVALID", 400, `Line ${index + 1}: ${line.fromStockType} to ${line.toStockType} is not a supported transition.`);
      }
      if (!parsePositiveNumber(line.enteredQuantity)) {
        return sscError(req, ctx, "SSC_LINE_QTY_INVALID", 400, `Line ${index + 1}: quantity must be greater than zero.`);
      }
      if (!line.reason) {
        return sscError(req, ctx, "SSC_LINE_REASON_REQUIRED", 400, `Line ${index + 1}: reason is required.`);
      }
    }

    // §8A — material/UOM resolution, bulk (INDEPENDENT loop, §8B).
    const materialIds = [...new Set(lines.map((l) => l.materialId))];
    let materialRows: JsonRecord[];
    try {
      materialRows = await fetchInChunks<JsonRecord>(materialIds, (idChunk) =>
        serviceRoleClient.schema("erp_master").from("material_master")
          .select("id, base_uom_code, material_type").in("id", idChunk));
    } catch {
      return sscError(req, ctx, "SSC_MATERIAL_LOOKUP_FAILED", 500, "Unable to resolve materials.");
    }
    const materialMap = new Map(materialRows.map((row) => [toTrimmedString(row.id), row]));

    const packingPoNumbers = [...new Set(lines.map((l) => l.packingPoNumber).filter(Boolean) as string[])];
    let packingPoMap = new Map<string, JsonRecord>();
    if (packingPoNumbers.length > 0) {
      let packingRows: JsonRecord[];
      try {
        packingRows = await fetchInChunks<JsonRecord>(packingPoNumbers, (idChunk) =>
          serviceRoleClient.schema("erp_production").from("packing_order")
            .select("po_number, fill_qty_per_pack").in("po_number", idChunk));
      } catch {
        return sscError(req, ctx, "SSC_PACKING_PO_LOOKUP_FAILED", 500, "Unable to resolve packing PO numbers.");
      }
      packingPoMap = new Map(packingRows.map((row) => [toTrimmedString(row.po_number), row]));
    }

    const matDoc = await generateMaterialDocNumber(companyId);
    const postedAt = todayIsoDate();
    const results: JsonRecord[] = [];

    // DEPENDENT: each line's own balance check + post must see the effect of
    // the previous line if they happen to touch the same (material, location,
    // batch, stock type) — kept sequential (§8B).
    for (const [index, line] of lines.entries()) {
      const material = materialMap.get(line.materialId);
      if (!material) {
        return sscError(req, ctx, "SSC_LINE_MATERIAL_NOT_FOUND", 400, `Line ${index + 1}: material not found.`);
      }
      const materialType = toUpperTrimmedString(material.material_type);
      const isFg = materialType === "FG";
      if (isFg && !line.packingPoNumber) {
        return sscError(req, ctx, "SSC_LINE_PACKING_PO_REQUIRED", 400, `Line ${index + 1}: Packing PO is required for FG.`);
      }
      let baseQuantity = line.enteredQuantity;
      if (isFg) {
        const packingPo = packingPoMap.get(line.packingPoNumber ?? "");
        const fillQtyPerPack = Number(packingPo?.fill_qty_per_pack ?? 0);
        if (!packingPo || fillQtyPerPack <= 0) {
          return sscError(req, ctx, "SSC_LINE_PACKING_PO_INVALID", 400, `Line ${index + 1}: Packing PO not found or has no fill quantity.`);
        }
        baseQuantity = Number((line.enteredQuantity * fillQtyPerPack).toFixed(6));
      }

      const balances = await getStockTypeBalances({
        companyId, storageLocationId: line.storageLocationId, materialId: line.materialId, batchNumber: line.batchNumber,
      });
      const sourceBalance = balances[line.fromStockType];
      if (sourceBalance.quantity + EPSILON < baseQuantity) {
        return sscError(req, ctx, "SSC_LINE_INSUFFICIENT_BALANCE", 409,
          `Line ${index + 1}: only ${sourceBalance.quantity} available in ${line.fromStockType}, requested ${baseQuantity}.`);
      }

      const transition = TRANSITIONS[`${line.fromStockType}->${line.toStockType}`];
      const documentNumber = await generateSscDocNumber();
      const unitValue = sourceBalance.valuationRate;

      const insertPayload: JsonRecord = {
        document_number: documentNumber,
        company_id: companyId,
        material_id: line.materialId,
        storage_location_id: line.storageLocationId,
        batch_number: line.batchNumber,
        packing_po_number: line.packingPoNumber,
        from_stock_type: line.fromStockType,
        to_stock_type: line.toStockType,
        movement_type_code: transition.movementTypeCode,
        quantity: baseQuantity,
        entered_quantity: line.enteredQuantity,
        uom_code: material.base_uom_code,
        reason: line.reason,
        requires_approval: transition.requiresApproval,
        status: transition.requiresApproval ? "PENDING_APPROVAL" : "DRAFT",
        created_by: ctx.auth_user_id,
      };
      const { data: insertedRow, error: insertError } = await serviceRoleClient
        .schema("erp_inventory")
        .from("stock_status_change_posting")
        .insert(insertPayload)
        .select("id")
        .single();
      if (insertError || !insertedRow) {
        return sscError(req, ctx, "SSC_LINE_INSERT_FAILED", 500, `Line ${index + 1}: unable to record the posting.`);
      }
      const postingId = toTrimmedString(insertedRow.id);

      if (transition.requiresApproval) {
        results.push({ id: postingId, document_number: documentNumber, status: "PENDING_APPROVAL" });
        continue;
      }

      const movements = [
        {
          line_ref: "out",
          document_number: documentNumber,
          document_date: postedAt,
          posting_date: postedAt,
          movement_type_code: transition.movementTypeCode,
          company_id: companyId,
          storage_location_id: line.storageLocationId,
          material_id: line.materialId,
          quantity: baseQuantity,
          base_uom_code: material.base_uom_code,
          unit_value: unitValue,
          stock_type_code: line.fromStockType,
          direction: "OUT",
          batch_number: line.batchNumber,
          material_doc_number: matDoc.docNumber,
          material_doc_year: matDoc.docYear,
        },
        {
          line_ref: "in",
          document_number: documentNumber,
          document_date: postedAt,
          posting_date: postedAt,
          movement_type_code: transition.movementTypeCode,
          company_id: companyId,
          storage_location_id: line.storageLocationId,
          material_id: line.materialId,
          quantity: baseQuantity,
          base_uom_code: material.base_uom_code,
          unit_value: unitValue,
          stock_type_code: line.toStockType,
          direction: "IN",
          batch_number: line.batchNumber,
          material_doc_number: matDoc.docNumber,
          material_doc_year: matDoc.docYear,
        },
      ];

      const { error: postError } = await serviceRoleClient
        .schema("erp_inventory")
        .rpc("post_document", {
          p_reference_document_type: "STOCK_STATUS_CHANGE",
          p_reference_document_id: postingId,
          p_movements: movements,
          p_posted_by: ctx.auth_user_id,
          p_context: { action: "POST", posted_by: ctx.auth_user_id },
        });
      if (postError) {
        return sscError(req, ctx, "SSC_LINE_POST_FAILED", 500, `Line ${index + 1}: ${postError.message || "posting failed"}.`);
      }
      results.push({ id: postingId, document_number: documentNumber, status: "POSTED" });
    }

    return okResponse({ data: results }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SSC_POST_FAILED";
    return sscError(req, ctx, code, code === "SSC_SCOPE_VIOLATION" ? 403 : 500, "Unable to post stock status change.");
  }
}

async function fetchPostingRow(postingId: string): Promise<JsonRecord> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_status_change_posting")
    .select("*")
    .eq("id", postingId)
    .single();
  if (error || !data) throw new Error("SSC_POSTING_NOT_FOUND");
  return data as JsonRecord;
}

// POST /api/procurement/stock-status-change/postings/:id/approve
// §126.3/§126.6 — only the pending Blocked->Unrestricted row reaches here;
// role gate (CAP_QA_TIER_L3MGR/CAP_QA_PLANTHEAD APPROVE) is what makes the
// button active in the first place, checked again server-side here.
export async function approveStockStatusChangePostingHandler(req: Request, ctx: SscHandlerContext): Promise<Response> {
  try {
    const postingId = getIdFromPath(req);
    if (!postingId) return sscError(req, ctx, "SSC_POSTING_ID_REQUIRED", 400, "Posting id is required.");
    const row = await fetchPostingRow(postingId);
    const companyId = toTrimmedString(row.company_id);
    await assertScopedCompanyAccess(ctx, companyId, "APPROVE");

    if (toUpperTrimmedString(row.status) !== "PENDING_APPROVAL") {
      return sscError(req, ctx, "SSC_APPROVE_NOT_PENDING", 409, "This posting is not pending approval.");
    }
    // SA/GA/DIRECTOR/ACL-MASTER retain blanket approval authority regardless
    // of who proposed the line — same override every other maker-checker in
    // this codebase honours (_shared/approval_override.ts).
    if (toTrimmedString(row.created_by) === ctx.auth_user_id && !hasBlanketApprovalOverride(ctx)) {
      return sscError(req, ctx, "SSC_APPROVE_SELF_FORBIDDEN", 403, "You cannot approve your own proposed status change.");
    }

    const materialId = toTrimmedString(row.material_id);
    const { data: material, error: materialError } = await serviceRoleClient
      .schema("erp_master").from("material_master").select("base_uom_code").eq("id", materialId).single();
    if (materialError || !material) return sscError(req, ctx, "SSC_APPROVE_MATERIAL_NOT_FOUND", 400, "Material not found.");

    const matDoc = await generateMaterialDocNumber(companyId);
    const postedAt = todayIsoDate();
    const movementTypeCode = toTrimmedString(row.movement_type_code);
    const quantity = Number(row.quantity);
    const balances = await getStockTypeBalances({
      companyId, storageLocationId: toTrimmedString(row.storage_location_id), materialId,
      batchNumber: toTrimmedString(row.batch_number) || null,
    });
    const sourceStockType = toUpperTrimmedString(row.from_stock_type);
    const unitValue = balances[sourceStockType]?.valuationRate ?? 0;
    if ((balances[sourceStockType]?.quantity ?? 0) + EPSILON < quantity) {
      return sscError(req, ctx, "SSC_APPROVE_INSUFFICIENT_BALANCE", 409, "Balance has changed and is no longer sufficient to approve this line.");
    }

    const movements = [
      {
        line_ref: "out", document_number: row.document_number, document_date: postedAt, posting_date: postedAt,
        movement_type_code: movementTypeCode, company_id: companyId, storage_location_id: row.storage_location_id,
        material_id: materialId, quantity, base_uom_code: material.base_uom_code, unit_value: unitValue,
        stock_type_code: row.from_stock_type, direction: "OUT", batch_number: row.batch_number,
        material_doc_number: matDoc.docNumber, material_doc_year: matDoc.docYear,
      },
      {
        line_ref: "in", document_number: row.document_number, document_date: postedAt, posting_date: postedAt,
        movement_type_code: movementTypeCode, company_id: companyId, storage_location_id: row.storage_location_id,
        material_id: materialId, quantity, base_uom_code: material.base_uom_code, unit_value: unitValue,
        stock_type_code: row.to_stock_type, direction: "IN", batch_number: row.batch_number,
        material_doc_number: matDoc.docNumber, material_doc_year: matDoc.docYear,
      },
    ];

    const { error: postError } = await serviceRoleClient
      .schema("erp_inventory")
      .rpc("post_document", {
        p_reference_document_type: "STOCK_STATUS_CHANGE",
        p_reference_document_id: postingId,
        p_movements: movements,
        p_posted_by: ctx.auth_user_id,
        p_context: { action: "POST", posted_by: ctx.auth_user_id },
      });
    if (postError) return sscError(req, ctx, "SSC_APPROVE_POST_FAILED", 500, postError.message || "Approval posting failed.");

    return okResponse({ data: { id: postingId, status: "POSTED" } }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SSC_APPROVE_FAILED";
    const status = code === "SSC_SCOPE_VIOLATION" ? 403 : code === "SSC_POSTING_NOT_FOUND" ? 404 : 500;
    return sscError(req, ctx, code, status, "Unable to approve stock status change.");
  }
}

// POST /api/procurement/stock-status-change/postings/:id/reverse
export async function reverseStockStatusChangePostingHandler(req: Request, ctx: SscHandlerContext): Promise<Response> {
  try {
    const postingId = getIdFromPath(req);
    if (!postingId) return sscError(req, ctx, "SSC_POSTING_ID_REQUIRED", 400, "Posting id is required.");
    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason) || `Reversal of stock status change`;

    const row = await fetchPostingRow(postingId);
    const companyId = toTrimmedString(row.company_id);
    await assertScopedCompanyAccess(ctx, companyId, "WRITE");

    if (toUpperTrimmedString(row.status) !== "POSTED") {
      return sscError(req, ctx, "SSC_REVERSE_NOT_POSTED", 409, "Only a posted line can be reversed.");
    }
    const originalMovementType = toTrimmedString(row.movement_type_code);
    const reversalMovementType = REVERSAL_MOVEMENT[originalMovementType];
    if (!reversalMovementType) {
      return sscError(req, ctx, "SSC_REVERSE_MOVEMENT_TYPE_UNKNOWN", 500, "No reversal movement type is registered for this posting.");
    }

    const materialId = toTrimmedString(row.material_id);
    const { data: material, error: materialError } = await serviceRoleClient
      .schema("erp_master").from("material_master").select("base_uom_code").eq("id", materialId).single();
    if (materialError || !material) return sscError(req, ctx, "SSC_REVERSE_MATERIAL_NOT_FOUND", 400, "Material not found.");

    const matDoc = await generateMaterialDocNumber(companyId);
    const postedAt = todayIsoDate();
    const quantity = Number(row.quantity);
    // Reversal posts at the ORIGINAL leg's own rate (not a fresh lookup) —
    // consistent with §104-4's reversal-valuation rule across the codebase.
    const { data: originalOutLeg } = await serviceRoleClient
      .schema("erp_inventory").from("stock_ledger")
      .select("valuation_rate").eq("stock_document_id", row.stock_document_id_out).eq("direction", "OUT").maybeSingle();
    const unitValue = Number(originalOutLeg?.valuation_rate ?? 0);

    const reversalDocumentNumber = await generateSscDocNumber();
    const movements = [
      {
        line_ref: "out", document_number: reversalDocumentNumber, document_date: postedAt, posting_date: postedAt,
        movement_type_code: reversalMovementType, company_id: companyId, storage_location_id: row.storage_location_id,
        material_id: materialId, quantity, base_uom_code: material.base_uom_code, unit_value: unitValue,
        stock_type_code: row.to_stock_type, direction: "OUT", batch_number: row.batch_number,
        material_doc_number: matDoc.docNumber, material_doc_year: matDoc.docYear,
        reversal_of_id: row.stock_document_id_in,
      },
      {
        line_ref: "in", document_number: reversalDocumentNumber, document_date: postedAt, posting_date: postedAt,
        movement_type_code: reversalMovementType, company_id: companyId, storage_location_id: row.storage_location_id,
        material_id: materialId, quantity, base_uom_code: material.base_uom_code, unit_value: unitValue,
        stock_type_code: row.from_stock_type, direction: "IN", batch_number: row.batch_number,
        material_doc_number: matDoc.docNumber, material_doc_year: matDoc.docYear,
        reversal_of_id: row.stock_document_id_out,
      },
    ];

    const { error: postError } = await serviceRoleClient
      .schema("erp_inventory")
      .rpc("post_document", {
        p_reference_document_type: "STOCK_STATUS_CHANGE",
        p_reference_document_id: postingId,
        p_movements: movements,
        p_posted_by: ctx.auth_user_id,
        p_context: {
          action: "REVERSE",
          posted_by: ctx.auth_user_id,
          reversal_document_number: reversalDocumentNumber,
          reversal_movement_type_code: reversalMovementType,
          reversal_reason: reason,
        },
      });
    if (postError) return sscError(req, ctx, "SSC_REVERSE_POST_FAILED", 500, postError.message || "Reversal posting failed.");

    return okResponse({ data: { id: postingId, status: "REVERSED" } }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SSC_REVERSE_FAILED";
    const status = code === "SSC_SCOPE_VIOLATION" ? 403 : code === "SSC_POSTING_NOT_FOUND" ? 404 : 500;
    return sscError(req, ctx, code, status, "Unable to reverse stock status change.");
  }
}

// GET /api/procurement/stock-status-change/postings?company_id=&limit=
export async function listStockStatusChangePostingsHandler(req: Request, ctx: SscHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    if (!companyId) return sscError(req, ctx, "SSC_COMPANY_ID_REQUIRED", 400, "company_id is required.");
    await assertScopedCompanyAccess(ctx, companyId, "VIEW");
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));

    const { data, error } = await serviceRoleClient
      .schema("erp_inventory")
      .from("stock_status_change_posting")
      .select("id, document_number, material_id, storage_location_id, batch_number, packing_po_number, from_stock_type, to_stock_type, movement_type_code, quantity, entered_quantity, uom_code, reason, requires_approval, status, created_by, created_at, approved_by, approved_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return sscError(req, ctx, "SSC_LIST_FETCH_FAILED", 500, "Unable to fetch recent postings.");

    const rows = (data ?? []) as JsonRecord[];
    const materialIds = [...new Set(rows.map((r) => toTrimmedString(r.material_id)).filter(Boolean))];
    const userIds = [...new Set(rows.map((r) => toTrimmedString(r.created_by)).filter(Boolean))];
    let materialRows: JsonRecord[];
    let userDisplayMap: Map<string, string>;
    try {
      [materialRows, userDisplayMap] = await Promise.all([
        fetchInChunks<JsonRecord>(materialIds, (idChunk) =>
          serviceRoleClient.schema("erp_master").from("material_master")
            .select("id, material_name, document_name").in("id", idChunk)),
        resolveUserDisplayNames(userIds),
      ]);
    } catch {
      return sscError(req, ctx, "SSC_LIST_FETCH_FAILED", 500, "Unable to fetch recent postings.");
    }
    const materialMap = new Map(materialRows.map((row) => [toTrimmedString(row.id), row]));

    const items = rows.map((row) => {
      const material = materialMap.get(toTrimmedString(row.material_id));
      return {
        id: row.id,
        document_number: row.document_number,
        material: toTrimmedString(material?.document_name) || toTrimmedString(material?.material_name) || "—",
        batch_number: row.batch_number || "—",
        packing_po_number: row.packing_po_number || "—",
        from_stock_type: row.from_stock_type,
        to_stock_type: row.to_stock_type,
        movement_type_code: row.movement_type_code,
        quantity: row.entered_quantity,
        uom_code: row.uom_code,
        reason: row.reason,
        requires_approval: row.requires_approval,
        status: row.status,
        created_by: userDisplayMap.get(toTrimmedString(row.created_by)) || "—",
        created_at: row.created_at,
      };
    });

    return okResponse({ data: items }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SSC_LIST_FETCH_FAILED";
    return sscError(req, ctx, code, code === "SSC_SCOPE_VIOLATION" ? 403 : 500, "Unable to fetch recent postings.");
  }
}
