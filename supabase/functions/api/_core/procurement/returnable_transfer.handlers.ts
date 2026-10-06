/*
 * File-Path: supabase/functions/api/_core/procurement/returnable_transfer.handlers.ts
 * Domain: PROCUREMENT
 * Purpose: PO12 Tab 2 — Returnable Material Transfer (Transfer Group master + Transfer/
 *          Receive/Report). Final design locked 2026-10-05, PROCUREMENT-DESIGN-DOC.md.
 *          Stock postings go through erp_inventory.post_document() (CLAUDE.md 8D), never
 *          post_stock_movement() directly — see migration
 *          20261006110000_po12_tab2_returnable_transfer.sql for the completion function.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { todayIsoInKolkata } from "../../_shared/dateUtils.ts";
import { generateMaterialDocNumber } from "../../_shared/materialDocument.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { hasPhysicalInventoryBlock } from "../../_shared/physicalInventoryBlock.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
// §Company-scope-write-ACL-guard (2026-10-06 run): assertCompanyScope only proves
// company MEMBERSHIP, not that the caller's ACL grant at the body's target company is
// actually WRITE/EDIT -- same gap already fixed for Tab 1 via requireCrcpWriteAccess(),
// which already checks the exact resourceCode Tab 2 reuses (PROC_PLANT_TRANSFER_LIST),
// so Tab 2's own write handlers call that same helper rather than duplicating it.
import { requireCrcpWriteAccess } from "./crcp_discrepancy.handlers.ts";

type JsonRecord = Record<string, unknown>;
type HandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function todayIsoDate(): string {
  return todayIsoInKolkata();
}

function nowIsoString(): string {
  return new Date().toISOString();
}

function rtErrorResponse(req: Request, ctx: HandlerContext, code: string, status: number, message?: string): Response {
  return errorResponse(code, message ?? code, ctx.request_id, "NONE", status, {}, req);
}

function getIdFromPath(req: Request, pattern: RegExp): string {
  const match = new URL(req.url).pathname.match(pattern);
  return match?.[1] ?? "";
}

function uniqueTrimmedStrings(values: unknown[]): string[] {
  return [...new Set(values.map((value) => toTrimmedString(value)).filter(Boolean))];
}

async function resolveCompanyLabels(companyIds: string[]): Promise<Map<string, string>> {
  if (companyIds.length === 0) return new Map();
  const rows = await fetchInChunks<JsonRecord>(companyIds, (chunk) =>
    serviceRoleClient.schema("erp_master").from("companies").select("id, company_code, company_name").in("id", chunk));
  return new Map(rows.map((row) => [toTrimmedString(row.id), toTrimmedString(row.company_name) || toTrimmedString(row.company_code)]));
}

async function resolveMaterialLabels(materialIds: string[]): Promise<Map<string, { label: string; external_code: string }>> {
  if (materialIds.length === 0) return new Map();
  const rows = await fetchInChunks<JsonRecord>(materialIds, (chunk) =>
    serviceRoleClient.schema("erp_master").from("material_master").select("id, pace_code, material_name, external_code").in("id", chunk));
  return new Map(rows.map((row) => [
    toTrimmedString(row.id),
    { label: `${toTrimmedString(row.pace_code)} - ${toTrimmedString(row.material_name)}`.trim(), external_code: toTrimmedString(row.external_code) },
  ]));
}

async function resolveStorageLocationLabels(slocIds: string[]): Promise<Map<string, string>> {
  if (slocIds.length === 0) return new Map();
  const rows = await fetchInChunks<JsonRecord>(slocIds, (chunk) =>
    serviceRoleClient.schema("erp_inventory").from("storage_location_master").select("id, code, name").in("id", chunk));
  return new Map(rows.map((row) => [toTrimmedString(row.id), `${toTrimmedString(row.code)} - ${toTrimmedString(row.name)}`.trim()]));
}

// ============================================================================
// Transfer Group — SA "PTO Company" master (allow-list for Tab 2)
// ============================================================================

export async function listTransferGroupsHandler(req: Request, ctx: HandlerContext): Promise<Response> {
  try {
    const { data: groups, error } = await serviceRoleClient
      .schema("erp_procurement").from("transfer_group")
      .select("id, group_name, is_active, created_at")
      .order("created_at", { ascending: false });
    if (error) return rtErrorResponse(req, ctx, "TRANSFER_GROUP_LIST_FAILED", 500, error.message);

    const groupRows = (groups as JsonRecord[] | null) ?? [];
    const groupIds = groupRows.map((row) => toTrimmedString(row.id));
    const { data: members, error: memberError } = groupIds.length > 0
      ? await serviceRoleClient.schema("erp_procurement").from("transfer_group_member")
        .select("group_id, company_id").in("group_id", groupIds)
      : { data: [], error: null };
    if (memberError) return rtErrorResponse(req, ctx, "TRANSFER_GROUP_MEMBER_LIST_FAILED", 500, memberError.message);

    const memberRows = (members as JsonRecord[] | null) ?? [];
    const companyLabelById = await resolveCompanyLabels(uniqueTrimmedStrings(memberRows.map((row) => row.company_id)));

    const membersByGroup = new Map<string, Array<{ id: string; label: string }>>();
    for (const row of memberRows) {
      const groupId = toTrimmedString(row.group_id);
      const companyId = toTrimmedString(row.company_id);
      const list = membersByGroup.get(groupId) ?? [];
      list.push({ id: companyId, label: companyLabelById.get(companyId) || companyId });
      membersByGroup.set(groupId, list);
    }

    const result = groupRows.map((row) => ({
      ...row,
      members: membersByGroup.get(toTrimmedString(row.id)) ?? [],
    }));
    return okResponse(result, ctx.request_id, req);
  } catch (error) {
    return rtErrorResponse(req, ctx, "TRANSFER_GROUP_LIST_FAILED", 500, error instanceof Error ? error.message : undefined);
  }
}

export async function upsertTransferGroupHandler(req: Request, ctx: HandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const groupId = toTrimmedString(body.group_id) || null;
    const groupName = toTrimmedString(body.group_name);
    const companyIds = Array.isArray(body.company_ids) ? body.company_ids.map((value) => toTrimmedString(value)).filter(Boolean) : [];

    const { data: resolvedId, error: headerError } = await serviceRoleClient
      .schema("erp_procurement")
      .rpc("_resolve_transfer_group_header", {
        p_group_id: groupId,
        p_group_name: groupName,
        p_company_ids: companyIds,
        p_actor: ctx.auth_user_id,
      });
    if (headerError) {
      const message = headerError.message || "";
      const code = message.includes("TRANSFER_GROUP_MIN_MEMBERS") ? "TRANSFER_GROUP_MIN_MEMBERS"
        : message.includes("TRANSFER_GROUP_NAME_REQUIRED") ? "TRANSFER_GROUP_NAME_REQUIRED"
        : message.includes("TRANSFER_GROUP_DUPLICATE_MEMBERS") ? "TRANSFER_GROUP_DUPLICATE_MEMBERS"
        : message.includes("TRANSFER_GROUP_NOT_FOUND") ? "TRANSFER_GROUP_NOT_FOUND"
        : "TRANSFER_GROUP_SAVE_FAILED";
      const status = code === "TRANSFER_GROUP_NOT_FOUND" ? 404 : 400;
      return rtErrorResponse(req, ctx, code, status, message);
    }

    const { error: syncError } = await serviceRoleClient
      .schema("erp_procurement")
      .rpc("_sync_transfer_group_members", { p_group_id: resolvedId, p_company_ids: companyIds });
    if (syncError) return rtErrorResponse(req, ctx, "TRANSFER_GROUP_MEMBER_SYNC_FAILED", 500, syncError.message);

    return okResponse({ id: resolvedId }, ctx.request_id, req);
  } catch (error) {
    return rtErrorResponse(req, ctx, "TRANSFER_GROUP_SAVE_FAILED", 500, error instanceof Error ? error.message : undefined);
  }
}

export async function toggleTransferGroupHandler(req: Request, ctx: HandlerContext): Promise<Response> {
  try {
    const groupId = getIdFromPath(req, /^\/api\/procurement\/transfer-groups\/([^/]+)\/toggle$/);
    const body = await parseBody(req);
    const isActive = Boolean(body.is_active);
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement").from("transfer_group")
      .update({ is_active: isActive, last_updated_by: ctx.auth_user_id, last_updated_at: nowIsoString() })
      .eq("id", groupId).select("id, is_active").maybeSingle();
    if (error) return rtErrorResponse(req, ctx, "TRANSFER_GROUP_TOGGLE_FAILED", 500, error.message);
    if (!data) return rtErrorResponse(req, ctx, "TRANSFER_GROUP_NOT_FOUND", 404);
    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    return rtErrorResponse(req, ctx, "TRANSFER_GROUP_TOGGLE_FAILED", 500, error instanceof Error ? error.message : undefined);
  }
}

// Shared by the Transfer page's "To Company" dropdown and the create-handler's own access
// check: do these two companies share at least one common ACTIVE Transfer Group?
async function companiesShareActiveGroup(companyA: string, companyB: string): Promise<boolean> {
  const { data: groupsA, error } = await serviceRoleClient
    .schema("erp_procurement").from("transfer_group_member")
    .select("group_id, transfer_group!inner(is_active)")
    .eq("company_id", companyA).eq("transfer_group.is_active", true);
  if (error) throw new Error("TRANSFER_GROUP_LOOKUP_FAILED");
  const groupIdsA = new Set(((groupsA as JsonRecord[] | null) ?? []).map((row) => toTrimmedString(row.group_id)));
  if (groupIdsA.size === 0) return false;

  const { data: groupsB, error: errorB } = await serviceRoleClient
    .schema("erp_procurement").from("transfer_group_member")
    .select("group_id").eq("company_id", companyB).in("group_id", [...groupIdsA]);
  if (errorB) throw new Error("TRANSFER_GROUP_LOOKUP_FAILED");
  return ((groupsB as JsonRecord[] | null) ?? []).length > 0;
}

export async function listTransferGroupPartnersHandler(req: Request, ctx: HandlerContext): Promise<Response> {
  try {
    const companyId = toTrimmedString(new URL(req.url).searchParams.get("company_id"));
    if (!companyId) return rtErrorResponse(req, ctx, "COMPANY_ID_REQUIRED", 400);

    const { data: ownGroups, error } = await serviceRoleClient
      .schema("erp_procurement").from("transfer_group_member")
      .select("group_id, transfer_group!inner(is_active)")
      .eq("company_id", companyId).eq("transfer_group.is_active", true);
    if (error) return rtErrorResponse(req, ctx, "TRANSFER_GROUP_PARTNER_LOOKUP_FAILED", 500, error.message);
    const groupIds = uniqueTrimmedStrings(((ownGroups as JsonRecord[] | null) ?? []).map((row) => row.group_id));
    if (groupIds.length === 0) return okResponse([], ctx.request_id, req);

    const { data: partnerRows, error: partnerError } = await serviceRoleClient
      .schema("erp_procurement").from("transfer_group_member")
      .select("company_id").in("group_id", groupIds).neq("company_id", companyId);
    if (partnerError) return rtErrorResponse(req, ctx, "TRANSFER_GROUP_PARTNER_LOOKUP_FAILED", 500, partnerError.message);

    const partnerIds = uniqueTrimmedStrings(((partnerRows as JsonRecord[] | null) ?? []).map((row) => row.company_id));
    const labelById = await resolveCompanyLabels(partnerIds);
    const result = partnerIds.map((id) => ({ value: id, label: labelById.get(id) || id }));
    return okResponse(result, ctx.request_id, req);
  } catch (error) {
    return rtErrorResponse(req, ctx, "TRANSFER_GROUP_PARTNER_LOOKUP_FAILED", 500, error instanceof Error ? error.message : undefined);
  }
}

// ============================================================================
// Returnable Transfer — Transfer (Create) / Receive / Report / Balance helper
// ============================================================================

type TransferLineInput = {
  material_id: string;
  material_type: string | null;
  source_storage_location_id: string;
  quantity: number;
  uom_code: string;
};

async function fetchUnrestrictedSnapshot(companyId: string, slocId: string, materialId: string): Promise<{ quantity: number; valuation_rate: number } | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory").from("stock_snapshot")
    .select("quantity, valuation_rate")
    .eq("company_id", companyId).eq("storage_location_id", slocId).eq("material_id", materialId)
    .eq("stock_type_code", "UNRESTRICTED").is("batch_id", null).maybeSingle();
  if (error) throw new Error("RETURNABLE_TRANSFER_SNAPSHOT_FAILED");
  if (!data) return null;
  const row = data as JsonRecord;
  return { quantity: Number(row.quantity ?? 0), valuation_rate: Number(row.valuation_rate ?? 0) };
}

export async function createReturnableTransferHandler(req: Request, ctx: HandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const fromCompanyId = toTrimmedString(body.from_company_id);
    const toCompanyId = toTrimmedString(body.to_company_id);
    const isReturn = Boolean(body.is_return);
    const remarks = toTrimmedString(body.remarks) || null;
    const rawLines = Array.isArray(body.lines) ? body.lines as JsonRecord[] : [];

    if (!fromCompanyId || !toCompanyId || fromCompanyId === toCompanyId) {
      return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_INVALID_COMPANIES", 400);
    }
    if (rawLines.length === 0) {
      return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_NO_LINES", 400);
    }
    try {
      await assertCompanyScope(ctx, fromCompanyId);
    } catch {
      return rtErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403);
    }
    const aclDenied = await requireCrcpWriteAccess(req, ctx, fromCompanyId, "WRITE", "PROC_RETURNABLE_TRANSFER");
    if (aclDenied) return aclDenied;

    const sharesGroup = await companiesShareActiveGroup(fromCompanyId, toCompanyId);
    if (!sharesGroup) {
      return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_GROUP_REQUIRED", 403, "These two companies are not in a common active Transfer Group.");
    }

    const lines: TransferLineInput[] = [];
    for (const raw of rawLines) {
      const materialId = toTrimmedString(raw.material_id);
      const slocId = toTrimmedString(raw.source_storage_location_id);
      const qty = parsePositiveNumber(raw.quantity);
      const uomCode = toTrimmedString(raw.uom_code);
      if (!materialId || !slocId || !qty || !uomCode) {
        return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_LINE_INVALID", 400);
      }
      lines.push({ material_id: materialId, material_type: toTrimmedString(raw.material_type) || null, source_storage_location_id: slocId, quantity: qty, uom_code: uomCode });
    }

    // Availability + PID-block check, every line, before any posting.
    const linesWithRate: Array<TransferLineInput & { valuation_rate: number }> = [];
    for (const line of lines) {
      const snapshot = await fetchUnrestrictedSnapshot(fromCompanyId, line.source_storage_location_id, line.material_id);
      if (!snapshot || snapshot.quantity < line.quantity) {
        return rtErrorResponse(req, ctx, "INSUFFICIENT_STOCK", 400, `Insufficient unrestricted stock for one of the lines.`);
      }
      if (await hasPhysicalInventoryBlock(fromCompanyId, line.material_id, line.source_storage_location_id, "UNRESTRICTED")) {
        return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_PI_BLOCKED", 409, "Source is under an active Physical Inventory count.");
      }
      linesWithRate.push({ ...line, valuation_rate: snapshot.valuation_rate });
    }

    const { data: transferNumberData, error: numberError } = await serviceRoleClient
      .schema("erp_procurement").rpc("generate_doc_number", { p_doc_type: "RMT" });
    if (numberError || !transferNumberData) return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_NUMBER_FAILED", 500);
    const transferNumber = String(transferNumberData);

    const transferId = crypto.randomUUID();
    const matDoc = await generateMaterialDocNumber(fromCompanyId);
    const postingDate = todayIsoDate();

    const movements: JsonRecord[] = [];
    linesWithRate.forEach((line, index) => {
      const lineNumber = index + 1;
      movements.push({
        line_ref: `${lineNumber}_out`,
        document_number: transferNumber, document_date: postingDate, posting_date: postingDate,
        movement_type_code: "P303", company_id: fromCompanyId, storage_location_id: line.source_storage_location_id,
        material_id: line.material_id, quantity: line.quantity, base_uom_code: line.uom_code,
        unit_value: line.valuation_rate, stock_type_code: "UNRESTRICTED", direction: "OUT",
        material_doc_number: matDoc.docNumber, material_doc_year: matDoc.docYear, reference_document_number: transferNumber,
      });
      movements.push({
        line_ref: `${lineNumber}_transitin`,
        document_number: transferNumber, document_date: postingDate, posting_date: postingDate,
        movement_type_code: "P303", company_id: fromCompanyId, storage_location_id: line.source_storage_location_id,
        material_id: line.material_id, quantity: line.quantity, base_uom_code: line.uom_code,
        unit_value: line.valuation_rate, stock_type_code: "IN_TRANSIT", direction: "IN",
        material_doc_number: matDoc.docNumber, material_doc_year: matDoc.docYear, reference_document_number: transferNumber,
      });
    });

    const context = {
      action: "CREATE",
      header: {
        transfer_number: transferNumber, from_company_id: fromCompanyId, to_company_id: toCompanyId,
        is_return: isReturn, transfer_date: postingDate, remarks, created_by: ctx.auth_user_id,
      },
      lines: linesWithRate.map((line, index) => ({
        line_number: index + 1, material_id: line.material_id, material_type: line.material_type,
        source_storage_location_id: line.source_storage_location_id, quantity: line.quantity,
        uom_code: line.uom_code, valuation_rate: line.valuation_rate,
      })),
    };

    const { error: postError } = await serviceRoleClient
      .schema("erp_inventory").rpc("post_document", {
        p_reference_document_type: "RETURNABLE_TRANSFER",
        p_reference_document_id: transferId,
        p_movements: movements,
        p_posted_by: ctx.auth_user_id,
        p_context: context,
      });
    if (postError) return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_POST_FAILED", 500, postError.message);

    return okResponse({ id: transferId, transfer_number: transferNumber }, ctx.request_id, req);
  } catch (error) {
    return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_CREATE_FAILED", 500, error instanceof Error ? error.message : undefined);
  }
}

async function enrichTransferRows(rows: JsonRecord[]): Promise<JsonRecord[]> {
  if (rows.length === 0) return rows;
  const companyIds = uniqueTrimmedStrings([...rows.map((row) => row.from_company_id), ...rows.map((row) => row.to_company_id)]);
  const labelById = await resolveCompanyLabels(companyIds);
  return rows.map((row) => ({
    ...row,
    from_company_label: labelById.get(toTrimmedString(row.from_company_id)) || toTrimmedString(row.from_company_id),
    to_company_label: labelById.get(toTrimmedString(row.to_company_id)) || toTrimmedString(row.to_company_id),
  }));
}

export async function listPendingReturnableTransfersHandler(req: Request, ctx: HandlerContext): Promise<Response> {
  try {
    const companyId = toTrimmedString(new URL(req.url).searchParams.get("company_id"));
    if (!companyId) return rtErrorResponse(req, ctx, "COMPANY_ID_REQUIRED", 400);
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return rtErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403);
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement").from("returnable_transfer")
      .select("id, transfer_number, from_company_id, to_company_id, is_return, status, transfer_date, remarks, created_at")
      .eq("to_company_id", companyId).eq("status", "TRANSFERRED")
      .order("transfer_date", { ascending: true });
    if (error) return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_PENDING_LIST_FAILED", 500, error.message);

    // Deliberately a bare array, not {data, pending_count} -- procurementApi.js's
    // fetchProcurement unwraps any {data:[...]} payload that lacks total/next_cursor
    // one level further (CLAUDE.md bug pattern #15), which would silently drop
    // pending_count. Caller derives the red-dot count from rows.length instead.
    const rows = await enrichTransferRows((data as JsonRecord[] | null) ?? []);
    return okResponse(rows, ctx.request_id, req);
  } catch (error) {
    return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_PENDING_LIST_FAILED", 500, error instanceof Error ? error.message : undefined);
  }
}

export async function getReturnableTransferHandler(req: Request, ctx: HandlerContext): Promise<Response> {
  try {
    const id = getIdFromPath(req, /^\/api\/procurement\/returnable-transfers\/([^/]+)$/);
    const { data: header, error } = await serviceRoleClient
      .schema("erp_procurement").from("returnable_transfer").select("*").eq("id", id).maybeSingle();
    if (error) return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_FETCH_FAILED", 500, error.message);
    if (!header) return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_NOT_FOUND", 404);

    const { data: lines, error: linesError } = await serviceRoleClient
      .schema("erp_procurement").from("returnable_transfer_line")
      .select("*").eq("transfer_id", id).order("line_number", { ascending: true });
    if (linesError) return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_LINES_FAILED", 500, linesError.message);

    const lineRows = (lines as JsonRecord[] | null) ?? [];
    const materialLabelById = await resolveMaterialLabels(uniqueTrimmedStrings(lineRows.map((row) => row.material_id)));
    const slocLabelById = await resolveStorageLocationLabels(uniqueTrimmedStrings([
      ...lineRows.map((row) => row.source_storage_location_id),
      ...lineRows.map((row) => row.target_storage_location_id),
    ]));
    const [enrichedHeader] = await enrichTransferRows([header as JsonRecord]);

    const enrichedLines = lineRows.map((row) => ({
      ...row,
      material_label: materialLabelById.get(toTrimmedString(row.material_id))?.label || toTrimmedString(row.material_id),
      external_code: materialLabelById.get(toTrimmedString(row.material_id))?.external_code || "",
      source_storage_location_label: slocLabelById.get(toTrimmedString(row.source_storage_location_id)) || toTrimmedString(row.source_storage_location_id),
      target_storage_location_label: row.target_storage_location_id
        ? (slocLabelById.get(toTrimmedString(row.target_storage_location_id)) || toTrimmedString(row.target_storage_location_id))
        : null,
    }));

    return okResponse({ ...enrichedHeader, lines: enrichedLines }, ctx.request_id, req);
  } catch (error) {
    return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_FETCH_FAILED", 500, error instanceof Error ? error.message : undefined);
  }
}

export async function receiveReturnableTransferHandler(req: Request, ctx: HandlerContext): Promise<Response> {
  try {
    const id = getIdFromPath(req, /^\/api\/procurement\/returnable-transfers\/([^/]+)\/receive$/);
    const body = await parseBody(req);
    const lineUpdates = Array.isArray(body.lines) ? body.lines as JsonRecord[] : [];
    if (lineUpdates.length === 0) return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_RECEIVE_NO_LINES", 400);

    const { data: header, error: headerError } = await serviceRoleClient
      .schema("erp_procurement").from("returnable_transfer").select("*").eq("id", id).maybeSingle();
    if (headerError) return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_FETCH_FAILED", 500, headerError.message);
    if (!header) return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_NOT_FOUND", 404);
    const headerRow = header as JsonRecord;
    if (toTrimmedString(headerRow.status) !== "TRANSFERRED") {
      return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_INVALID_STATUS", 400, "Only a TRANSFERRED document can be received.");
    }
    try {
      await assertCompanyScope(ctx, toTrimmedString(headerRow.to_company_id));
    } catch {
      return rtErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403);
    }
    // Real gap found 2026-10-06: this handler only ever proved company
    // MEMBERSHIP above, never the caller's WRITE-tier ACL grant at that
    // specific company -- same shape already fixed for create/settlement
    // (see crcp_discrepancy.handlers.ts's own header comment).
    const receiveAclDenied = await requireCrcpWriteAccess(
      req, ctx, toTrimmedString(headerRow.to_company_id), "WRITE", "PROC_RETURNABLE_TRANSFER",
    );
    if (receiveAclDenied) return receiveAclDenied;

    const { data: lines, error: linesError } = await serviceRoleClient
      .schema("erp_procurement").from("returnable_transfer_line").select("*").eq("transfer_id", id);
    if (linesError) return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_LINES_FAILED", 500, linesError.message);
    const lineRows = (lines as JsonRecord[] | null) ?? [];
    const lineById = new Map(lineRows.map((row) => [toTrimmedString(row.id), row]));

    const toCompanyId = toTrimmedString(headerRow.to_company_id);
    const fromCompanyId = toTrimmedString(headerRow.from_company_id);
    const resolvedUpdates: Array<{ lineId: string; targetSlocId: string; materialId: string; quantity: number; uomCode: string; valuationRate: number }> = [];
    for (const update of lineUpdates) {
      const lineId = toTrimmedString(update.line_id);
      const targetSlocId = toTrimmedString(update.target_storage_location_id);
      const line = lineById.get(lineId);
      if (!line || !targetSlocId) return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_RECEIVE_LINE_INVALID", 400);
      if (await hasPhysicalInventoryBlock(toCompanyId, toTrimmedString(line.material_id), targetSlocId, "UNRESTRICTED")) {
        return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_PI_BLOCKED", 409, "Target is under an active Physical Inventory count.");
      }
      resolvedUpdates.push({
        lineId, targetSlocId,
        materialId: toTrimmedString(line.material_id),
        quantity: Number(line.quantity ?? 0),
        uomCode: toTrimmedString(line.uom_code),
        valuationRate: Number(line.valuation_rate ?? 0),
      });
    }

    const matDoc = await generateMaterialDocNumber(fromCompanyId);
    const postingDate = todayIsoDate();
    const transferNumber = toTrimmedString(headerRow.transfer_number);
    const lineNumberById = new Map(lineRows.map((row) => [toTrimmedString(row.id), Number(row.line_number)]));

    const movements: JsonRecord[] = [];
    resolvedUpdates.forEach((update) => {
      const lineNumber = lineNumberById.get(update.lineId);
      movements.push({
        line_ref: `${lineNumber}_transitout`,
        document_number: transferNumber, document_date: postingDate, posting_date: postingDate,
        movement_type_code: "P305", company_id: fromCompanyId, storage_location_id: lineById.get(update.lineId)?.source_storage_location_id,
        material_id: update.materialId, quantity: update.quantity, base_uom_code: update.uomCode,
        unit_value: update.valuationRate, stock_type_code: "IN_TRANSIT", direction: "OUT",
        material_doc_number: matDoc.docNumber, material_doc_year: matDoc.docYear, reference_document_number: transferNumber,
      });
      movements.push({
        line_ref: `${lineNumber}_in`,
        document_number: transferNumber, document_date: postingDate, posting_date: postingDate,
        movement_type_code: "P305", company_id: toCompanyId, storage_location_id: update.targetSlocId,
        material_id: update.materialId, quantity: update.quantity, base_uom_code: update.uomCode,
        unit_value: update.valuationRate, stock_type_code: "UNRESTRICTED", direction: "IN",
        material_doc_number: matDoc.docNumber, material_doc_year: matDoc.docYear, reference_document_number: transferNumber,
      });
    });

    const context = {
      action: "RECEIVE",
      received_by: ctx.auth_user_id,
      lines: resolvedUpdates.map((update) => ({
        line_id: update.lineId, line_number: lineNumberById.get(update.lineId), target_storage_location_id: update.targetSlocId,
      })),
    };

    const { error: postError } = await serviceRoleClient
      .schema("erp_inventory").rpc("post_document", {
        p_reference_document_type: "RETURNABLE_TRANSFER",
        p_reference_document_id: id,
        p_movements: movements,
        p_posted_by: ctx.auth_user_id,
        p_context: context,
      });
    if (postError) return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_RECEIVE_FAILED", 500, postError.message);

    return okResponse({ id, status: "RECEIVED" }, ctx.request_id, req);
  } catch (error) {
    return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_RECEIVE_FAILED", 500, error instanceof Error ? error.message : undefined);
  }
}

// Report tab — transaction-level ledger (not a balance summary; see design lock).
export async function listReturnableTransferLedgerHandler(req: Request, ctx: HandlerContext): Promise<Response> {
  try {
    const params = new URL(req.url).searchParams;
    const companyId = toTrimmedString(params.get("company_id"));
    const dateFrom = toTrimmedString(params.get("date_from"));
    const dateTo = toTrimmedString(params.get("date_to"));
    const search = toTrimmedString(params.get("search")).toLowerCase();

    let query = serviceRoleClient
      .schema("erp_procurement").from("returnable_transfer_line")
      .select("id, transfer_id, material_id, quantity, uom_code, returnable_transfer!inner(transfer_number, from_company_id, to_company_id, is_return, status, transfer_date)")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (dateFrom) query = query.gte("returnable_transfer.transfer_date", dateFrom);
    if (dateTo) query = query.lte("returnable_transfer.transfer_date", dateTo);
    if (companyId) query = query.or(`from_company_id.eq.${companyId},to_company_id.eq.${companyId}`, { referencedTable: "returnable_transfer" });

    const { data, error } = await query;
    if (error) return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_LEDGER_FAILED", 500, error.message);

    const rows = (data as JsonRecord[] | null) ?? [];
    const companyIds = uniqueTrimmedStrings(rows.flatMap((row) => {
      const header = row.returnable_transfer as JsonRecord;
      return [header?.from_company_id, header?.to_company_id];
    }));
    const materialIds = uniqueTrimmedStrings(rows.map((row) => row.material_id));
    const [companyLabelById, materialLabelById] = await Promise.all([
      resolveCompanyLabels(companyIds),
      resolveMaterialLabels(materialIds),
    ]);

    let result = rows.map((row) => {
      const header = row.returnable_transfer as JsonRecord;
      const fromLabel = companyLabelById.get(toTrimmedString(header?.from_company_id)) || toTrimmedString(header?.from_company_id);
      const toLabel = companyLabelById.get(toTrimmedString(header?.to_company_id)) || toTrimmedString(header?.to_company_id);
      const materialInfo = materialLabelById.get(toTrimmedString(row.material_id));
      return {
        transfer_date: header?.transfer_date,
        transfer_number: header?.transfer_number,
        material_label: materialInfo?.label || toTrimmedString(row.material_id),
        external_code: materialInfo?.external_code || "",
        from_company_label: fromLabel,
        to_company_label: toLabel,
        quantity: row.quantity,
        uom_code: row.uom_code,
        is_return: header?.is_return,
        status: header?.status,
      };
    });

    if (search) {
      result = result.filter((row) => JSON.stringify(row).toLowerCase().includes(search));
    }
    return okResponse(result, ctx.request_id, req);
  } catch (error) {
    return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_LEDGER_FAILED", 500, error instanceof Error ? error.message : undefined);
  }
}

// Material recode (design edge case #1/#3): a return against an old transfer may use the
// successor/alternate material code, not the exact one originally sent. Resolve every
// material in the SAME erp_master.material_category_group as materialId (plus itself) so
// the balance nets correctly regardless of which group member each side used.
async function resolveEquivalentMaterialIds(materialId: string): Promise<string[]> {
  const { data: memberships, error: membershipError } = await serviceRoleClient
    .schema("erp_master").from("material_category_group_member")
    .select("group_id").eq("material_id", materialId).eq("active", true);
  if (membershipError) throw new Error("RETURNABLE_BALANCE_GROUP_LOOKUP_FAILED");
  const groupIds = uniqueTrimmedStrings(((memberships as JsonRecord[] | null) ?? []).map((row) => row.group_id));
  if (groupIds.length === 0) return [materialId];

  const { data: members, error: memberError } = await serviceRoleClient
    .schema("erp_master").from("material_category_group_member")
    .select("material_id").in("group_id", groupIds).eq("active", true);
  if (memberError) throw new Error("RETURNABLE_BALANCE_GROUP_LOOKUP_FAILED");
  return uniqueTrimmedStrings([materialId, ...((members as JsonRecord[] | null) ?? []).map((row) => row.material_id)]);
}

// Live Outstanding Returnable Balance helper for the Transfer page's "Return" checkbox —
// deliberately NOT a materialized/summary table (design lock point 3): net = how much
// company_b still owes back to company_a for this material (or any recode-equivalent
// material, same group), computed on the fly. Also nets out "Settle via Sale" rows
// (design edge case #5) -- those share this exact same pool, no physical movement.
export async function getOutstandingReturnableBalanceHandler(req: Request, ctx: HandlerContext): Promise<Response> {
  try {
    const params = new URL(req.url).searchParams;
    const companyA = toTrimmedString(params.get("company_a"));
    const companyB = toTrimmedString(params.get("company_b"));
    const materialId = toTrimmedString(params.get("material_id"));
    if (!companyA || !companyB || !materialId) return rtErrorResponse(req, ctx, "RETURNABLE_BALANCE_PARAMS_REQUIRED", 400);

    const equivalentMaterialIds = await resolveEquivalentMaterialIds(materialId);

    const { data: forwardRows, error: forwardError } = await serviceRoleClient
      .schema("erp_procurement").from("returnable_transfer_line")
      .select("quantity, returnable_transfer!inner(from_company_id, to_company_id, is_return, status)")
      .in("material_id", equivalentMaterialIds)
      .eq("returnable_transfer.from_company_id", companyA)
      .eq("returnable_transfer.to_company_id", companyB)
      .eq("returnable_transfer.is_return", false)
      .eq("returnable_transfer.status", "RECEIVED");
    if (forwardError) return rtErrorResponse(req, ctx, "RETURNABLE_BALANCE_FAILED", 500, forwardError.message);

    const { data: returnRows, error: returnError } = await serviceRoleClient
      .schema("erp_procurement").from("returnable_transfer_line")
      .select("quantity, returnable_transfer!inner(from_company_id, to_company_id, is_return, status)")
      .in("material_id", equivalentMaterialIds)
      .eq("returnable_transfer.from_company_id", companyB)
      .eq("returnable_transfer.to_company_id", companyA)
      .eq("returnable_transfer.is_return", true)
      .eq("returnable_transfer.status", "RECEIVED");
    if (returnError) return rtErrorResponse(req, ctx, "RETURNABLE_BALANCE_FAILED", 500, returnError.message);

    const { data: settlementRows, error: settlementError } = await serviceRoleClient
      .schema("erp_procurement").from("returnable_transfer_settlement")
      .select("quantity")
      .in("material_id", equivalentMaterialIds)
      .eq("from_company_id", companyB).eq("to_company_id", companyA);
    if (settlementError) return rtErrorResponse(req, ctx, "RETURNABLE_BALANCE_FAILED", 500, settlementError.message);

    const forwardTotal = ((forwardRows as JsonRecord[] | null) ?? []).reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
    const returnTotal = ((returnRows as JsonRecord[] | null) ?? []).reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
    const settledTotal = ((settlementRows as JsonRecord[] | null) ?? []).reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
    const outstanding = Number((forwardTotal - returnTotal - settledTotal).toFixed(6));
    return okResponse({
      outstanding_qty: outstanding, forward_qty: forwardTotal, returned_qty: returnTotal, settled_qty: settledTotal,
    }, ctx.request_id, req);
  } catch (error) {
    return rtErrorResponse(req, ctx, "RETURNABLE_BALANCE_FAILED", 500, error instanceof Error ? error.message : undefined);
  }
}

// "Settle via Sale" (design edge case #5) -- a receiving company decides to pay for what
// it holds instead of physically returning it. Pure bookkeeping row, no stock_ledger/
// stock_document posting at all (that already happened at Receive time and is correct as
// physical stock); this only adjusts the Outstanding Returnable Balance pool.
export async function createReturnableSettlementHandler(req: Request, ctx: HandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const fromCompanyId = toTrimmedString(body.from_company_id);
    const toCompanyId = toTrimmedString(body.to_company_id);
    const materialId = toTrimmedString(body.material_id);
    const quantity = parsePositiveNumber(body.quantity);
    const settlementReference = toTrimmedString(body.settlement_reference) || null;
    const remarks = toTrimmedString(body.remarks) || null;

    if (!fromCompanyId || !toCompanyId || fromCompanyId === toCompanyId || !materialId || !quantity) {
      return rtErrorResponse(req, ctx, "RETURNABLE_SETTLEMENT_INVALID", 400);
    }
    try {
      await assertCompanyScope(ctx, fromCompanyId);
    } catch {
      return rtErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403);
    }
    const aclDenied = await requireCrcpWriteAccess(req, ctx, fromCompanyId, "WRITE", "PROC_RETURNABLE_TRANSFER");
    if (aclDenied) return aclDenied;

    const sharesGroup = await companiesShareActiveGroup(fromCompanyId, toCompanyId);
    if (!sharesGroup) {
      return rtErrorResponse(req, ctx, "RETURNABLE_TRANSFER_GROUP_REQUIRED", 403, "These two companies are not in a common active Transfer Group.");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement").from("returnable_transfer_settlement")
      .insert({
        from_company_id: fromCompanyId, to_company_id: toCompanyId, material_id: materialId,
        quantity, settlement_reference: settlementReference, remarks, created_by: ctx.auth_user_id,
      })
      .select("id").single();
    if (error || !data) return rtErrorResponse(req, ctx, "RETURNABLE_SETTLEMENT_FAILED", 500, error?.message);

    return okResponse({ id: (data as JsonRecord).id }, ctx.request_id, req);
  } catch (error) {
    return rtErrorResponse(req, ctx, "RETURNABLE_SETTLEMENT_FAILED", 500, error instanceof Error ? error.message : undefined);
  }
}

export async function listReturnableSettlementsHandler(req: Request, ctx: HandlerContext): Promise<Response> {
  try {
    const companyId = toTrimmedString(new URL(req.url).searchParams.get("company_id"));
    if (!companyId) return rtErrorResponse(req, ctx, "COMPANY_ID_REQUIRED", 400);

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement").from("returnable_transfer_settlement")
      .select("id, from_company_id, to_company_id, material_id, quantity, settlement_reference, remarks, created_at")
      .or(`from_company_id.eq.${companyId},to_company_id.eq.${companyId}`)
      .order("created_at", { ascending: false }).limit(500);
    if (error) return rtErrorResponse(req, ctx, "RETURNABLE_SETTLEMENT_LIST_FAILED", 500, error.message);

    const rows = (data as JsonRecord[] | null) ?? [];
    const [companyLabelById, materialLabelById] = await Promise.all([
      resolveCompanyLabels(uniqueTrimmedStrings([...rows.map((row) => row.from_company_id), ...rows.map((row) => row.to_company_id)])),
      resolveMaterialLabels(uniqueTrimmedStrings(rows.map((row) => row.material_id))),
    ]);
    const result = rows.map((row) => ({
      ...row,
      from_company_label: companyLabelById.get(toTrimmedString(row.from_company_id)) || toTrimmedString(row.from_company_id),
      to_company_label: companyLabelById.get(toTrimmedString(row.to_company_id)) || toTrimmedString(row.to_company_id),
      material_label: materialLabelById.get(toTrimmedString(row.material_id))?.label || toTrimmedString(row.material_id),
    }));
    return okResponse(result, ctx.request_id, req);
  } catch (error) {
    return rtErrorResponse(req, ctx, "RETURNABLE_SETTLEMENT_LIST_FAILED", 500, error instanceof Error ? error.message : undefined);
  }
}
