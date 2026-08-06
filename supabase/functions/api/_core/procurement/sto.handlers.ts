/*
 * File-ID: 16.6.1
 * File-Path: supabase/functions/api/_core/procurement/sto.handlers.ts
 * Gate: 16.6
 * Phase: 16
 * Domain: PROCUREMENT
 * Purpose: STO lifecycle handlers including dispatch, receipt confirmation, and sub-CSN transform.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { generateMaterialDocNumber } from "../../_shared/materialDocument.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope, isCompanyScopeAdminBypass } from "../../_shared/companyScope.ts";
import { loadApproverWorkContextIds, matchesApprover, pickScopedApproverRules } from "../../_shared/workflow_scope.ts";
import { hasBlanketApprovalOverride } from "../../_shared/approval_override.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};
type StoRow = Record<string, unknown>;
type StoLineRow = Record<string, unknown>;
type ApproverMapRow = {
  approver_user_id: string | null;
  approver_role_code: string | null;
  approver_work_context_id: string | null;
  resource_code: string | null;
  action_code: string | null;
  scope_type: string | null;
  subject_user_id: string | null;
  subject_work_context_id: string | null;
  subject_role_code: string | null;
  approval_stage: number;
};
type PreparedStoLine = {
  material_id: string;
  quantity: number;
  uom_code: string;
  transfer_price: number;
  currency_code: string;
  payment_term_id: string;
  freight_term: string;
  gst_terms: string | null;
  gst_rate: number | null;
  remarks: string | null;
  has_rebate: boolean;
  rebate_rate: number | null;
  rebate_rate_uom_basis: string | null;
  rebate_remarks: string | null;
  expected_delivery_date: string | null;
  sending_storage_location_id?: string | null;
  receiving_storage_location_id?: string | null;
  source_csn_id?: string | null;
};

const STO_TYPES = new Set(["CONSIGNMENT_DISTRIBUTION", "INTER_PLANT"]);
const STO_STATUSES = new Set(["DRAFT", "PENDING_APPROVAL", "CREATED", "DISPATCHED", "RECEIVED", "CLOSED", "CANCELLED"]);
const STO_LINE_STATUSES = new Set(["OPEN", "RECEIVED", "KNOCKED_OFF"]);
const DELIVERY_TYPES = new Set(["STANDARD", "BULK", "TANKER"]);
const CURRENCY_CODES = new Set(["INR", "USD"]);
const MUTABLE_STO_AMENDMENT_FIELDS = new Set([
  "quantity",
  "transfer_price",
  "expected_delivery_date",
  "payment_term_id",
  "freight_term",
  "gst_terms",
  "remarks",
  "sending_cost_center_id",
  "receiving_cost_center_id",
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

function collectAuthUserIds(value: unknown, ids: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectAuthUserIds(entry, ids);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (key.endsWith("_by")) {
      const authUserId = toTrimmedString(entryValue);
      if (authUserId) {
        ids.add(authUserId);
      }
      continue;
    }

    collectAuthUserIds(entryValue, ids);
  }
}

function attachUserDisplayFields<T>(
  value: T,
  displayNameMap: Map<string, string>,
): T {
  if (Array.isArray(value)) {
    return value.map((entry) => attachUserDisplayFields(entry, displayNameMap)) as T;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const enriched: Record<string, unknown> = {};

  for (const [key, entryValue] of Object.entries(record)) {
    if (Array.isArray(entryValue) || (entryValue && typeof entryValue === "object")) {
      enriched[key] = attachUserDisplayFields(entryValue, displayNameMap);
    } else {
      enriched[key] = entryValue;
    }

    if (key.endsWith("_by")) {
      const authUserId = toTrimmedString(entryValue);
      if (authUserId) {
        enriched[`${key}_display`] = displayNameMap.get(authUserId) ?? authUserId;
      }
    }
  }

  return enriched as T;
}

async function enrichProcurementUserDisplays<T>(payload: T): Promise<T> {
  const authUserIds = new Set<string>();
  collectAuthUserIds(payload, authUserIds);
  const displayNameMap = await resolveUserDisplayNames([...authUserIds]);
  return attachUserDisplayFields(payload, displayNameMap);
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

function stoErrorResponse(
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

// Bookkeeping key note: acl.approver_map rows must reference a resource_code
// already registered in acl.module_resource_map (DB trigger-enforced), and
// PROC_STO_CREATE is a route-only companion resource with no
// erp_menu.menu_master row (same pattern as OM_VENDOR_CREATE) — so it can
// never satisfy that requirement. PROC_STO_LIST is already registered and is
// this resource's own sibling. This key is purely internal to this lookup;
// it does NOT change the route-level ACL gate, which stays
// PROC_STO_CREATE:APPROVE per route-acl-registry.ts, unchanged.
async function loadStoApproverRules(companyId: string): Promise<ApproverMapRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("acl")
    .from("approver_map")
    .select("approver_user_id, approver_role_code, approver_work_context_id, resource_code, action_code, scope_type, subject_user_id, subject_work_context_id, subject_role_code, approval_stage")
    .eq("resource_code", "PROC_STO_LIST")
    .eq("action_code", "APPROVE")
    .eq("company_id", companyId);

  if (error) {
    throw new Error("PROCUREMENT_APPROVER_LOOKUP_FAILED");
  }

  return (data as ApproverMapRow[] | null) ?? [];
}

// Rank-based escalation chains (SUBJECT_ROLE scope_type) key off the
// creator's own role, not their identity — need a lookup since callers only
// pass the creator's user id.
async function getUserRoleCode(userId: string): Promise<string | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_acl")
    .from("user_roles")
    .select("role_code")
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return String((data as Record<string, unknown>).role_code ?? "") || null;
}

// Same creator-scoped approval-chain mechanism as po.handlers.ts's
// assertProcurementHeadRole — see that function's comment for the full
// rationale. Configured-but-unscoped and fully-unconfigured both fall back
// to DIRECTOR, so a plain company-wide setup keeps working untouched.
async function assertStoApproverRole(
  ctx: ProcurementHandlerContext,
  companyId: string,
  createdBy?: string | null,
): Promise<void> {
  if (hasBlanketApprovalOverride(ctx)) {
    return;
  }

  const rules = await loadStoApproverRules(companyId);
  let isConfiguredApprover: boolean;

  if (rules.length === 0) {
    isConfiguredApprover = hasBlanketApprovalOverride(ctx);
  } else {
    const creatorRoleCode = createdBy ? await getUserRoleCode(createdBy) : null;
    const scopedRules = pickScopedApproverRules(
      {
        resource_code: "PROC_STO_LIST",
        action_code: "APPROVE",
        requester_auth_user_id: createdBy ?? null,
        requester_role_code: creatorRoleCode,
      },
      rules,
    );
    isConfiguredApprover = scopedRules.length > 0
      ? matchesApprover(scopedRules, {
        auth_user_id: ctx.auth_user_id,
        roleCode: ctx.roleCode,
        approverWorkContextIds: await loadApproverWorkContextIds(serviceRoleClient, ctx.auth_user_id, companyId),
      })
      : hasBlanketApprovalOverride(ctx);
  }

  if (!isConfiguredApprover) {
    throw new Error("PROCUREMENT_HEAD_REQUIRED");
  }

  if (createdBy && createdBy === ctx.auth_user_id && !hasBlanketApprovalOverride(ctx)) {
    throw new Error("PROCUREMENT_SELF_APPROVAL_FORBIDDEN");
  }
}

// §112 — must validate, not just resolve a fallback: an explicitly-requested
// companyId that is NOT one of the caller's own erp_map.user_companies rows
// throws COMPANY_SCOPE_VIOLATION rather than being silently honoured. Only
// used for the caller's OWN acting/sending company — never for a STO's
// receiving_company_id, which is legitimately a different counterparty.
async function getCompanyScope(ctx: ProcurementHandlerContext, requestedCompanyId?: string): Promise<string> {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  const companyId = toTrimmedString(requestedCompanyId) || scopedCompanyId;
  if (companyId) await assertCompanyScope(ctx, companyId);
  return companyId;
}

// listSTOsHandler fallback when neither a requested company_id nor
// ctx.context.companyId resolves to anything (e.g. a GLOBAL_ACL/MULTI-mode
// caller with no x-company-id header on this specific request) — without
// this, the list query's `if (companyId)` filter would be skipped entirely
// and return every company's STOs. Returns null for SA/GA (no restriction).
async function listStoScopedCompanyIds(ctx: ProcurementHandlerContext): Promise<string[] | null> {
  if (isCompanyScopeAdminBypass(ctx)) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", ctx.auth_user_id);
  if (error) throw new Error("COMPANY_SCOPE_VIOLATION");
  const rows = (data ?? []) as Array<{ company_id: string }>;
  return [...new Set(rows.map((row) => toTrimmedString(row.company_id)).filter(Boolean))];
}

async function generateProcurementDocNumber(docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("generate_doc_number", { p_doc_type: docType });

  if (error || !data) {
    console.error("STO_DOC_NUMBER_FAILED", JSON.stringify({ docType, error }));
    throw new Error(`PROCUREMENT_DOC_NUMBER_FAILED: ${error?.message ?? "no data returned"}`);
  }

  return String(data);
}

// Shared global series (§118.6) — one continuous counter for both PO groups
// and STOs, deliberately company-independent, so a Group Number resolves
// unambiguously to exactly one of the two tables.
async function generatePrintGroupNumber(): Promise<string> {
  return await generateProcurementDocNumber("PRINT_GROUP");
}

async function generateCompanyDocNumber(companyId: string, docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("generate_company_doc_number", {
      p_company_id: companyId,
      p_doc_type: docType,
    });

  if (error || !data) {
    console.error("STO_COMPANY_DOC_NUMBER_FAILED", JSON.stringify({ companyId, docType, error }));
    throw new Error(`PROCUREMENT_DOC_NUMBER_FAILED: ${error?.message ?? "no data returned"}`);
  }

  return String(data);
}

async function fetchSto(stoId: string): Promise<StoRow> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("stock_transfer_order")
    .select("*")
    .eq("id", stoId)
    .single();

  if (error || !data) {
    throw new Error("STO_NOT_FOUND");
  }

  return data as StoRow;
}

function assertStoVisibleToContext(ctx: ProcurementHandlerContext, sto: StoRow): void {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  if (
    scopedCompanyId
    && scopedCompanyId !== toTrimmedString(sto.sending_company_id)
    && scopedCompanyId !== toTrimmedString(sto.receiving_company_id)
  ) {
    throw new Error("STO_SCOPE_VIOLATION");
  }
}

async function fetchStoLines(stoId: string): Promise<StoLineRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("stock_transfer_order_line")
    .select("*")
    .eq("sto_id", stoId)
    .order("line_number", { ascending: true });

  if (error) {
    throw new Error("STO_LINE_FETCH_FAILED");
  }

  return (data ?? []) as StoLineRow[];
}

async function getStoApprovalLog(stoId: string): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("sto_approval_log")
    .select("*")
    .eq("sto_id", stoId)
    .order("actioned_at", { ascending: false });

  if (error) {
    console.error("STO_APPROVAL_LOG_FETCH_FAILED", JSON.stringify({ stoId, error }));
    throw new Error(`STO_APPROVAL_LOG_FETCH_FAILED: ${error.message}`);
  }

  return (data as JsonRecord[] | null) ?? [];
}

async function getStoAmendmentLog(stoId: string): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("sto_amendment_log")
    .select("*")
    .eq("sto_id", stoId)
    .order("amended_at", { ascending: false });

  if (error) {
    console.error("STO_AMENDMENT_LOG_FETCH_FAILED", JSON.stringify({ stoId, error }));
    throw new Error(`STO_AMENDMENT_LOG_FETCH_FAILED: ${error.message}`);
  }

  return (data as JsonRecord[] | null) ?? [];
}

async function hydrateSto(stoId: string, ctx?: ProcurementHandlerContext): Promise<JsonRecord> {
  const sto = await fetchSto(stoId);
  if (ctx) {
    assertStoVisibleToContext(ctx, sto);
  }
  const [lines, dcResp, gateExitResp, approvalLog, amendmentLog] = await Promise.all([
    fetchStoLines(stoId),
    serviceRoleClient
      .schema("erp_procurement")
      .from("delivery_challan")
      .select("*")
      .eq("sto_id", stoId)
      .order("created_at", { ascending: false }),
    serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_outbound")
      .select("*")
      .eq("sto_id", stoId)
      .order("created_at", { ascending: false }),
    getStoApprovalLog(stoId),
    getStoAmendmentLog(stoId),
  ]);

  if (dcResp.error) throw new Error("STO_DC_FETCH_FAILED");
  if (gateExitResp.error) throw new Error("STO_GXO_FETCH_FAILED");

  return await enrichProcurementUserDisplays({
    ...sto,
    lines,
    delivery_challans: dcResp.data ?? [],
    gate_exit_outbound: gateExitResp.data ?? [],
    approval_log: approvalLog,
    amendment_log: amendmentLog,
  });
}

async function hasPhysicalInventoryBlock(
  materialId: string,
  storageLocationId: string,
): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("physical_inventory_block")
    .select("id")
    .eq("material_id", materialId)
    .eq("storage_location_id", storageLocationId)
    .maybeSingle();

  if (error) {
    throw new Error("MATERIAL_POSTING_BLOCK_LOOKUP_FAILED");
  }

  return Boolean(data?.id);
}

async function getSnapshotForLine(companyId: string, line: StoLineRow): Promise<JsonRecord> {
  const sendingLocationId = toTrimmedString(line.sending_storage_location_id);
  if (!sendingLocationId) {
    throw new Error("STO_SENDING_LOCATION_REQUIRED");
  }

  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_snapshot")
    .select("*")
    .eq("company_id", companyId)
    .eq("storage_location_id", sendingLocationId)
    .eq("material_id", String(line.material_id))
    .eq("stock_type_code", "UNRESTRICTED")
    .is("batch_id", null)
    .maybeSingle();

  if (error || !data) {
    throw new Error("INSUFFICIENT_STOCK");
  }

  return data;
}

async function getSubCsnById(csnId: string, companyId: string): Promise<JsonRecord> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .select("*")
    .eq("id", csnId)
    .eq("company_id", companyId)
    .single();

  if (error || !data) {
    throw new Error("CSN_NOT_FOUND");
  }

  return data as JsonRecord;
}

async function getPurchaseOrderById(poId: string): Promise<JsonRecord | null> {
  if (!poId) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order")
    .select("id, po_number, status")
    .eq("id", poId)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_PO_LOOKUP_FAILED");
  }

  return (data as JsonRecord | null) ?? null;
}

async function getPurchaseOrderLineById(lineId: string): Promise<JsonRecord | null> {
  if (!lineId) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order_line")
    .select("id, line_status")
    .eq("id", lineId)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_PO_LINE_LOOKUP_FAILED");
  }

  return (data as JsonRecord | null) ?? null;
}

async function getPaymentTermRow(paymentTermId: string): Promise<JsonRecord | null> {
  if (!paymentTermId) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("payment_terms_master")
    .select("*")
    .eq("id", paymentTermId)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_PAYMENT_TERM_LOOKUP_FAILED");
  }

  return (data as JsonRecord | null) ?? null;
}

async function getPaymentTermRowsByIds(paymentTermIds: string[]): Promise<Map<string, JsonRecord>> {
  const uniqueIds = [...new Set(paymentTermIds.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (uniqueIds.length === 0) return map;

  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("payment_terms_master")
    .select("*")
    .in("id", uniqueIds);

  if (error) {
    throw new Error("PROCUREMENT_PAYMENT_TERM_LOOKUP_FAILED");
  }

  for (const row of ((data as JsonRecord[] | null) ?? [])) {
    map.set(toTrimmedString(row.id), row);
  }
  return map;
}

async function getCostCenterRow(costCenterId: string): Promise<JsonRecord | null> {
  if (!costCenterId) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("cost_center_master")
    .select("id")
    .eq("id", costCenterId)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_COST_CENTER_LOOKUP_FAILED");
  }

  return (data as JsonRecord | null) ?? null;
}

async function getCompanyRow(companyId: string): Promise<JsonRecord | null> {
  if (!companyId) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("companies")
    .select("id, gst_number")
    .eq("id", companyId)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_COMPANY_LOOKUP_FAILED");
  }

  return (data as JsonRecord | null) ?? null;
}

function parseStoLineInput(
  line: JsonRecord,
  index: number,
  options?: { fallbackQuantity?: number | null; fallbackUomCode?: string | null },
): PreparedStoLine {
  const materialId = toTrimmedString(line.material_id);
  const quantity = parsePositiveNumber(line.quantity) ?? options?.fallbackQuantity ?? null;
  const uomCode = toTrimmedString(line.uom_code) || toTrimmedString(options?.fallbackUomCode);
  const transferPrice = parsePositiveNumber(line.transfer_price);
  const paymentTermId = toTrimmedString(line.payment_term_id);
  const freightTerm = toTrimmedString(line.freight_term);
  const hasRebate = line.has_rebate === true;
  const rebateRate = parseNullableNumber(line.rebate_rate);
  const rebateBasis = toTrimmedString(line.rebate_rate_uom_basis) || null;

  if (!materialId || !quantity || !transferPrice || !paymentTermId || !freightTerm) {
    throw new Error(`Each STO line requires material, quantity, rate, payment term, and freight term. (line ${index + 1})`);
  }
  if (!uomCode) {
    throw new Error(`Each STO line requires a UOM code. (line ${index + 1})`);
  }
  if (hasRebate && (!rebateRate || !rebateBasis)) {
    throw new Error(`Each rebate-enabled STO line requires a rebate rate and basis. (line ${index + 1})`);
  }

  return {
    material_id: materialId,
    quantity,
    uom_code: uomCode,
    transfer_price: transferPrice,
    currency_code: (() => {
      const value = toUpperTrimmedString(line.currency_code || line.transfer_price_currency || "INR");
      return CURRENCY_CODES.has(value) ? value : "INR";
    })(),
    payment_term_id: paymentTermId,
    freight_term: freightTerm,
    gst_terms: toTrimmedString(line.gst_terms) || null,
    gst_rate: parseNullableNumber(line.gst_rate),
    remarks: toTrimmedString(line.remarks) || null,
    has_rebate: hasRebate,
    rebate_rate: hasRebate ? rebateRate : null,
    rebate_rate_uom_basis: hasRebate ? rebateBasis : null,
    rebate_remarks: hasRebate ? (toTrimmedString(line.rebate_remarks) || null) : null,
    expected_delivery_date: toTrimmedString(line.expected_delivery_date) || null,
    sending_storage_location_id: line.sending_storage_location_id !== undefined ? (toTrimmedString(line.sending_storage_location_id) || null) : undefined,
    receiving_storage_location_id: line.receiving_storage_location_id !== undefined ? (toTrimmedString(line.receiving_storage_location_id) || null) : undefined,
    source_csn_id: line.source_csn_id !== undefined ? (toTrimmedString(line.source_csn_id) || null) : undefined,
  };
}

async function getLastUsedPaymentTermForStoPair(
  sendingCompanyId: string,
  receivingCompanyId: string,
): Promise<string | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("stock_transfer_order")
    .select("id, created_at, lines:stock_transfer_order_line(payment_term_id)")
    .eq("sending_company_id", sendingCompanyId)
    .eq("receiving_company_id", receivingCompanyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("STO_LAST_PAYMENT_TERM_LOOKUP_FAILED");
  }

  const rows = Array.isArray(data?.lines) ? data.lines : [];
  const paymentTermId = toTrimmedString(rows[0]?.payment_term_id);
  return paymentTermId || null;
}

async function getNextStoAmendmentNumber(stoId: string): Promise<number> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("sto_amendment_log")
    .select("amendment_number")
    .eq("sto_id", stoId)
    .order("amendment_number", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error("STO_AMENDMENT_SEQUENCE_FAILED");
  }

  const latest = Array.isArray(data) && data.length > 0
    ? Number(data[0]?.amendment_number ?? 0)
    : 0;
  return latest + 1;
}

async function insertStoApprovalLog(input: {
  stoId: string;
  action: "APPROVED" | "REJECTED" | "ESCALATED";
  fromStatus: string;
  toStatus: string;
  remarks?: string | null;
  actionedBy: string;
}): Promise<void> {
  const { error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("sto_approval_log")
    .insert({
      sto_id: input.stoId,
      action: input.action,
      from_status: input.fromStatus,
      to_status: input.toStatus,
      remarks: input.remarks ?? null,
      actioned_by: input.actionedBy,
    });

  if (error) {
    throw new Error("STO_APPROVAL_LOG_INSERT_FAILED");
  }
}

function buildCsnForInterPlantStoLine(input: {
  sto: StoRow;
  line: StoLineRow;
  csnNumber: string;
  actionedBy: string;
  deliveryType: string;
  sendingCompanyHasGst: boolean;
  lcRequired: boolean;
}): JsonRecord {
  const paymentTermId = toTrimmedString(input.line.payment_term_id);
  return {
    csn_number: input.csnNumber,
    csn_type: input.sendingCompanyHasGst ? "DOMESTIC" : "IMPORT",
    delivery_type: DELIVERY_TYPES.has(input.deliveryType) ? input.deliveryType : "STANDARD",
    status: "ORD",
    company_id: input.sto.receiving_company_id,
    consignee_company_id: null,
    vendor_id: input.sto.sending_company_id,
    material_id: input.line.material_id,
    po_id: null,
    po_line_id: null,
    sto_id: input.sto.id,
    po_qty: Number(input.line.quantity ?? 0),
    dispatch_qty: 0,
    po_uom_code: input.line.uom_code,
    payment_term_id: paymentTermId || null,
    lc_required: input.lcRequired,
    has_rebate: input.line.has_rebate === true,
    rebate_remarks: input.line.rebate_remarks ?? null,
    created_by: input.actionedBy,
    is_mother_csn: false,
    mother_csn_id: null,
  };
}

async function createCsnForSto(
  sto: StoRow,
  stoLines: StoLineRow[],
  actionedBy: string,
  deliveryTypeInput?: string,
): Promise<void> {
  if (toUpperTrimmedString(sto.sto_type) !== "INTER_PLANT") {
    return;
  }

  const sendingCompany = await getCompanyRow(toTrimmedString(sto.sending_company_id));
  const sendingCompanyHasGst = Boolean(toTrimmedString(sendingCompany?.gst_number));
  const deliveryType = toUpperTrimmedString(deliveryTypeInput || sto.delivery_type || "STANDARD") || "STANDARD";
  const stoId = toTrimmedString(sto.id);
  const paymentTermById = await getPaymentTermRowsByIds(
    stoLines.map((line) => toTrimmedString(line.payment_term_id)),
  );
  const lineKeys = stoLines.map((line) => ({
    line,
    key: JSON.stringify([
      toTrimmedString(line.material_id),
      toTrimmedString(line.uom_code),
      Number(line.quantity ?? 0),
    ]),
  }));
  const { data: existingRows, error: existingError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .select("material_id, po_uom_code, po_qty")
    .eq("sto_id", stoId);
  if (existingError) {
    throw new Error("PROCUREMENT_CSN_LOOKUP_FAILED");
  }
  const existingKeys = new Set(
    ((existingRows as JsonRecord[] | null) ?? []).map((row) =>
      JSON.stringify([
        toTrimmedString(row.material_id),
        toTrimmedString(row.po_uom_code),
        Number(row.po_qty ?? 0),
      ])
    ),
  );

  await Promise.all(
    lineKeys
      .filter(({ key }) => !existingKeys.has(key))
      .map(async ({ line }) => {
        const paymentTermId = toTrimmedString(line.payment_term_id);
        const paymentTerm = paymentTermId ? paymentTermById.get(paymentTermId) ?? null : null;
        const payload = buildCsnForInterPlantStoLine({
          sto,
          line,
          csnNumber: await generateProcurementDocNumber("CSN"),
          actionedBy,
          deliveryType,
          sendingCompanyHasGst,
          lcRequired: toUpperTrimmedString(paymentTerm?.payment_method) === "LC",
        });

        const { error } = await serviceRoleClient
          .schema("erp_procurement")
          .from("consignment_note")
          .insert(payload);

        if (error) {
          throw new Error("PROCUREMENT_CSN_CREATE_FAILED");
        }
      }),
  );
}

async function inactivateLinkedCsnsForSto(input: {
  stoId: string;
  reasonCode: "CAN" | "KOF";
  reason: string;
  actionedBy: string;
  clearStoLink?: boolean;
  eligibleStatuses?: string[];
  // consignment_note has no sto_line_id column (unlike po_line_id for PO) --
  // one CSN per STO line, but linked only via sto_id + material_id. A
  // line-scoped knock-off must narrow by material to avoid touching a
  // sibling line's CSN for a different material on the same STO.
  materialId?: string;
}): Promise<void> {
  let query = serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .select("id, status")
    .eq("sto_id", input.stoId)
    .in("status", input.eligibleStatuses ?? ["ORD", "TRN", "GED"]);
  if (input.materialId) {
    query = query.eq("material_id", input.materialId);
  }
  const { data: rows, error: fetchError } = await query;

  if (fetchError) {
    throw new Error("PROCUREMENT_CSN_UPDATE_FAILED");
  }

  const nowIso = new Date().toISOString();
  for (const row of (rows as JsonRecord[] | null) ?? []) {
    const csnId = toTrimmedString(row.id);
    if (!csnId) {
      continue;
    }

    const { error: updateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .update({
        status: input.reasonCode,
        remarks: input.reason,
        inactive_reason_code: input.reasonCode,
        inactive_from_status: toUpperTrimmedString(row.status) || null,
        inactive_at: nowIso,
        inactive_by: input.actionedBy,
        sto_id: input.clearStoLink === true ? null : undefined,
        last_updated_at: nowIso,
        last_updated_by: input.actionedBy,
      })
      .eq("id", csnId);

    if (updateError) {
      throw new Error("PROCUREMENT_CSN_UPDATE_FAILED");
    }
  }
}

async function buildConsignmentStoFromSubCsns(input: {
  csnIds: string[];
  sendingCompanyId: string;
  receivingCompanyId: string;
  sendingCostCenterId: string;
  receivingCostCenterId: string;
  stoDate: string;
  remarks: string | null;
  lineConfigs: Map<string, JsonRecord>;
  actionedBy: string;
}): Promise<StoRow> {
  let sto: StoRow | null = null;
  let nextLineNumber = 1;

  // DEPENDENT: this transform incrementally creates one STO header and line ordering from prior CSN-linked state, so iteration order is significant.
  for (const csnId of input.csnIds) {
    const subCsn = await getSubCsnById(csnId, input.sendingCompanyId);
    const motherCsnId = toTrimmedString(subCsn.mother_csn_id);
    if (!motherCsnId) {
      throw new Error("SUB_CSN_REQUIRED");
    }
    if (toTrimmedString(subCsn.sto_id)) {
      throw new Error("CSN_ALREADY_LINKED_TO_STO");
    }
    const subStatus = toUpperTrimmedString(subCsn.status);
    if (subStatus !== "ORD" && subStatus !== "TRN") {
      throw new Error("CSN_STO_LINK_BLOCKED");
    }
    const consigneeCompanyId = toTrimmedString(subCsn.consignee_company_id);
    if (consigneeCompanyId && consigneeCompanyId !== input.receivingCompanyId) {
      throw new Error("CSN_CONSIGNEE_COMPANY_MISMATCH");
    }

    const mother = await getSubCsnById(motherCsnId, input.sendingCompanyId);
    if (toTrimmedString(mother.company_id) !== input.sendingCompanyId) {
      throw new Error("CSN_SOURCE_COMPANY_MISMATCH");
    }

    const po = await getPurchaseOrderById(toTrimmedString(subCsn.po_id));
    if (!po || toUpperTrimmedString(po.status) === "CANCELLED") {
      throw new Error("PROCUREMENT_PO_CANCELLED");
    }

    const poLine = await getPurchaseOrderLineById(toTrimmedString(subCsn.po_line_id));
    if (!poLine || toUpperTrimmedString(poLine.line_status) === "KNOCKED_OFF") {
      throw new Error("PROCUREMENT_PO_LINE_KNOCKED_OFF");
    }

    if (!sto) {
      const stoNumber = await generateCompanyDocNumber(input.receivingCompanyId, "STO");
      const stoGroupNumber = await generatePrintGroupNumber();
      const { data: createdSto, error: stoError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("stock_transfer_order")
        .insert({
          sto_number: stoNumber,
          sto_date: input.stoDate,
          sto_type: "CONSIGNMENT_DISTRIBUTION",
          sending_company_id: input.sendingCompanyId,
          receiving_company_id: input.receivingCompanyId,
          sending_cost_center_id: input.sendingCostCenterId,
          receiving_cost_center_id: input.receivingCostCenterId,
          related_csn_id: csnId,
          status: "CREATED",
          remarks: input.remarks || `Auto-created from sub CSN ${subCsn.csn_number ?? csnId}`,
          group_number: stoGroupNumber,
          created_by: input.actionedBy,
          last_updated_by: input.actionedBy,
        })
        .select("*")
        .single();

      if (stoError || !createdSto) {
        throw new Error("STO_TRANSFORM_CREATE_FAILED");
      }
      sto = createdSto as StoRow;
    }

    const lineConfig = input.lineConfigs.get(csnId) ?? {};
    const dispatchQty = parsePositiveNumber(subCsn.dispatch_qty) ?? parsePositiveNumber(subCsn.po_qty) ?? 0;
    if (!dispatchQty) {
      throw new Error("STO_LINE_INVALID");
    }

    const { error: lineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order_line")
      .insert({
        sto_id: sto.id,
        line_number: nextLineNumber,
        material_id: subCsn.material_id,
        sending_storage_location_id: lineConfig.sending_storage_location_id ?? null,
        receiving_storage_location_id: lineConfig.receiving_storage_location_id ?? null,
        quantity: dispatchQty,
        uom_code: lineConfig.uom_code || toTrimmedString(subCsn.po_uom_code),
        transfer_price: lineConfig.transfer_price,
        transfer_price_currency: lineConfig.currency_code,
        currency_code: lineConfig.currency_code,
        payment_term_id: lineConfig.payment_term_id,
        freight_term: lineConfig.freight_term,
        gst_terms: lineConfig.gst_terms,
        remarks: lineConfig.remarks,
        has_rebate: lineConfig.has_rebate,
        rebate_rate: lineConfig.rebate_rate,
        rebate_rate_uom_basis: lineConfig.rebate_rate_uom_basis,
        rebate_remarks: lineConfig.rebate_remarks,
        expected_delivery_date: lineConfig.expected_delivery_date,
        balance_qty: dispatchQty,
      });

    if (lineError) {
      throw new Error("STO_TRANSFORM_LINE_FAILED");
    }

    const { error: csnUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .update({
        sto_id: sto.id,
        company_id: input.receivingCompanyId,
        vendor_id: input.sendingCompanyId,
        consignee_company_id: null,
        last_updated_at: new Date().toISOString(),
        last_updated_by: input.actionedBy,
      })
      .eq("id", csnId);

    if (csnUpdateError) {
      throw new Error("CSN_STO_LINK_FAILED");
    }

    nextLineNumber += 1;
  }

  if (!sto) {
    throw new Error("STO_TRANSFORM_FAILED");
  }

  return sto;
}

export async function createSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const isOpeningSto = body.is_opening_sto === true;
    const stoType = toUpperTrimmedString(body.sto_type);
    const sendingCompanyId = await getCompanyScope(ctx, toTrimmedString(body.sending_company_id));
    const receivingCompanyId = toTrimmedString(body.receiving_company_id);
    const sendingCostCenterId = toTrimmedString(body.sending_cost_center_id);
    const receivingCostCenterId = toTrimmedString(body.receiving_cost_center_id);
    const stoDate = toTrimmedString(body.sto_date) || todayIsoDate();
    const deliveryType = toUpperTrimmedString(body.delivery_type || "STANDARD");
    const relatedCsnId = toTrimmedString(body.related_csn_id) || null;
    const lines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];

    if (!STO_TYPES.has(stoType) || !sendingCompanyId || !receivingCompanyId || lines.length === 0) {
      return stoErrorResponse(req, ctx, "STO_CREATE_INVALID", 400, "sto_type, sending_company_id, receiving_company_id, and lines are required.");
    }
    if (!DELIVERY_TYPES.has(deliveryType)) {
      return stoErrorResponse(req, ctx, "STO_DELIVERY_TYPE_INVALID", 400, "delivery_type must be STANDARD, BULK, or TANKER.");
    }
    if (!sendingCostCenterId || !receivingCostCenterId) {
      return stoErrorResponse(req, ctx, "STO_COST_CENTER_REQUIRED", 400, "Sending and receiving cost centers are required.");
    }
    if (!(await getCostCenterRow(sendingCostCenterId)) || !(await getCostCenterRow(receivingCostCenterId))) {
      return stoErrorResponse(req, ctx, "STO_COST_CENTER_INVALID", 400, "A selected STO cost center was not found.");
    }

    if (isOpeningSto && stoType !== "INTER_PLANT") {
      return stoErrorResponse(req, ctx, "STO_OPENING_REQUIRES_INTER_PLANT", 400, "Opening STOs must use INTER_PLANT sto_type.");
    }

    const preparedLines: PreparedStoLine[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      try {
        preparedLines.push(parseStoLineInput(line, index));
      } catch (lineError) {
        const code = lineError instanceof Error ? lineError.message : "STO_LINE_INVALID";
        return stoErrorResponse(req, ctx, "STO_LINE_INVALID", 400, code);
      }
    }

    if (stoType === "CONSIGNMENT_DISTRIBUTION") {
      const csnIds = preparedLines.map((line) => line.source_csn_id).filter(Boolean) as string[];
      if (csnIds.length === 0 || csnIds.length !== preparedLines.length) {
        return stoErrorResponse(req, ctx, "CSN_SELECTION_REQUIRED", 400, "Each consignment STO line requires a source sub-CSN.");
      }

      const lineConfigs = new Map<string, PreparedStoLine>();
      for (const line of preparedLines) {
        lineConfigs.set(toTrimmedString(line.source_csn_id), line);
      }

      const sto = await buildConsignmentStoFromSubCsns({
        csnIds,
        sendingCompanyId,
        receivingCompanyId,
        sendingCostCenterId,
        receivingCostCenterId,
        stoDate,
        remarks: toTrimmedString(body.remarks) || null,
        lineConfigs,
        actionedBy: ctx.auth_user_id,
      });

      return okResponse(await hydrateSto(String(sto.id), ctx), ctx.request_id, req);
    }

    const openingStoNumber = toTrimmedString(body.sto_number);
    if (isOpeningSto && !openingStoNumber) {
      return stoErrorResponse(req, ctx, "PROCUREMENT_OPENING_STO_NUMBER_REQUIRED", 400, "Opening STO number is required.");
    }

    const stoNumber = isOpeningSto
      ? openingStoNumber
      : await generateCompanyDocNumber(receivingCompanyId, "STO");
    const stoGroupNumber = await generatePrintGroupNumber();
    const { data: sto, error: stoError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .insert({
        sto_number: stoNumber,
        sto_date: stoDate,
        sto_type: stoType,
        sending_company_id: sendingCompanyId,
        receiving_company_id: receivingCompanyId,
        sending_cost_center_id: sendingCostCenterId,
        receiving_cost_center_id: receivingCostCenterId,
        related_csn_id: relatedCsnId,
        status: "DRAFT",
        is_opening_sto: isOpeningSto,
        remarks: toTrimmedString(body.remarks) || null,
        group_number: stoGroupNumber,
        created_by: ctx.auth_user_id,
        last_updated_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (stoError || !sto) {
      return stoErrorResponse(req, ctx, "STO_CREATE_FAILED", 500, "Unable to create STO.");
    }

    const linePayload = [];
    for (let index = 0; index < preparedLines.length; index += 1) {
      const line = preparedLines[index];
      linePayload.push({
        sto_id: sto.id,
        line_number: index + 1,
        material_id: line.material_id,
        sending_storage_location_id: line.sending_storage_location_id ?? null,
        receiving_storage_location_id: line.receiving_storage_location_id ?? null,
        quantity: line.quantity,
        uom_code: line.uom_code,
        transfer_price: line.transfer_price,
        transfer_price_currency: line.currency_code,
        currency_code: line.currency_code,
        payment_term_id: line.payment_term_id,
        freight_term: line.freight_term,
        gst_terms: line.gst_terms,
        gst_rate: line.gst_rate,
        gst_amount: line.gst_rate ? Number((line.quantity * line.transfer_price * line.gst_rate / 100).toFixed(4)) : null,
        remarks: line.remarks,
        has_rebate: line.has_rebate,
        rebate_rate: line.rebate_rate,
        rebate_rate_uom_basis: line.rebate_rate_uom_basis,
        rebate_remarks: line.rebate_remarks,
        expected_delivery_date: line.expected_delivery_date,
        balance_qty: line.quantity,
      });
    }

    const { error: lineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order_line")
      .insert(linePayload);

    if (lineError) {
      return stoErrorResponse(req, ctx, "STO_LINE_CREATE_FAILED", 500, "Unable to create STO lines.");
    }

    // CSN must not exist before the STO is actually approved -- matches
    // PO exactly (createCsnsForPo only runs from confirmPOHandler's
    // no-approval branch and approvePOHandler, never createPOHandler).
    // This used to fire right here at raw creation, which meant an
    // INTER_PLANT STO could have a live CSN while still sitting in DRAFT
    // -- caught 2026-07-30, business owner correction. confirmSTOHandler's
    // own no-approval-required branch and approveSTOHandler already call
    // createCsnForSto at the right time; this was the only premature call.

    return okResponse(await hydrateSto(String(sto.id), ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_CREATE_FAILED";
    console.error("STO_CREATE_HANDLER_ERROR", code, error);
    const status = code.includes("INVALID") ? 400 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

// STO carries no material-type restriction of its own (unlike Sales Order's RM/PM-only
// gate) -- it moves any material between companies. The "RM/PM Sale" combined page (SO +
// STO tabs) needs an RM/PM-only view of STOs for that presentation, so this filters the
// already-fetched header rows down to ones whose every line is one of the allowed types.
async function filterStosByMaterialTypes(stos: StoRow[], allowedTypes: string[]): Promise<StoRow[]> {
  const stoIds = stos.map((sto) => String(sto.id));
  if (stoIds.length === 0) return [];

  const { data: lineRows, error: lineError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("stock_transfer_order_line")
    .select("sto_id, material_id")
    .in("sto_id", stoIds);
  if (lineError) {
    throw new Error("STO_LINE_FETCH_FAILED");
  }
  const lines = (lineRows ?? []) as { sto_id: string; material_id: string }[];
  const materialIds = [...new Set(lines.map((l) => String(l.material_id)))];

  const materialTypeMap = new Map<string, string>();
  if (materialIds.length > 0) {
    const { data: materialRows, error: materialError } = await serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .select("id, material_type")
      .in("id", materialIds);
    if (materialError) {
      throw new Error("STO_MATERIAL_FETCH_FAILED");
    }
    for (const m of (materialRows ?? []) as { id: string; material_type: string | null }[]) {
      materialTypeMap.set(String(m.id), toUpperTrimmedString(m.material_type));
    }
  }

  const linesBySto = new Map<string, string[]>();
  for (const line of lines) {
    const key = String(line.sto_id);
    const arr = linesBySto.get(key) ?? [];
    arr.push(String(line.material_id));
    linesBySto.set(key, arr);
  }

  return stos.filter((sto) => {
    const lineMaterialIds = linesBySto.get(String(sto.id)) ?? [];
    if (lineMaterialIds.length === 0) return false;
    return lineMaterialIds.every((id) => allowedTypes.includes(materialTypeMap.get(id) ?? ""));
  });
}

export async function listSTOsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const stoType = toUpperTrimmedString(url.searchParams.get("sto_type"));
    const materialScope = toUpperTrimmedString(url.searchParams.get("material_scope"));
    // §113.10 fix: was fetch-200-then-filter-client-side, so any company with
    // more than 200 STOs silently truncated. OUTBOUND/INBOUND is now a real
    // server-side filter instead of the old .or() + client-side split.
    const direction = toUpperTrimmedString(url.searchParams.get("direction"));
    const search = toTrimmedString(url.searchParams.get("search")).replace(/[%_]/g, "");
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);
    const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (companyId) {
      if (direction === "INBOUND") {
        query = query.eq("receiving_company_id", companyId);
      } else if (direction === "OUTBOUND") {
        query = query.eq("sending_company_id", companyId);
      } else {
        query = query.or(`sending_company_id.eq.${companyId},receiving_company_id.eq.${companyId}`);
      }
    } else {
      // No single company resolved (see listStoScopedCompanyIds) — scope to
      // every company the caller belongs to instead of skipping the filter,
      // which would otherwise return every company's STOs unfiltered.
      const scopedCompanyIds = await listStoScopedCompanyIds(ctx);
      if (scopedCompanyIds) {
        if (scopedCompanyIds.length === 0) {
          return okResponse({ items: [], total: 0 }, ctx.request_id, req);
        }
        const orFilter = scopedCompanyIds
          .flatMap((id) => [`sending_company_id.eq.${id}`, `receiving_company_id.eq.${id}`])
          .join(",");
        query = query.or(orFilter);
      }
    }
    if (status && STO_STATUSES.has(status)) {
      query = query.eq("status", status);
    }
    if (stoType && STO_TYPES.has(stoType)) {
      query = query.eq("sto_type", stoType);
    }
    if (search) {
      query = query.ilike("sto_number", `%${search}%`);
    }

    const { data, error, count } = await query;
    if (error) {
      return stoErrorResponse(req, ctx, "STO_LIST_FAILED", 500, "Unable to list STOs.");
    }

    let items = (data ?? []) as StoRow[];
    if (materialScope === "RM_PM" && items.length > 0) {
      items = await filterStosByMaterialTypes(items, ["RM", "PM"]);
    }

    // R-01/R-03 fix: server-side bulk-resolve company display names instead
    // of the frontend falling back to a raw UUID when a client-side map missed.
    const companyIds = [...new Set(items.flatMap((row) => [toTrimmedString(row.sending_company_id), toTrimmedString(row.receiving_company_id)]).filter(Boolean))];
    const { data: companies } = companyIds.length
      ? await serviceRoleClient.schema("erp_master").from("companies").select("id, company_name, company_code").in("id", companyIds)
      : { data: [] as JsonRecord[] };
    const companyMap = new Map(((companies ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));

    const enrichedItems = items.map((row) => {
      const sending = companyMap.get(toTrimmedString(row.sending_company_id));
      const receiving = companyMap.get(toTrimmedString(row.receiving_company_id));
      return {
        ...row,
        sending_company_display: sending ? String(sending.company_name ?? sending.company_code ?? "") : null,
        receiving_company_display: receiving ? String(receiving.company_name ?? receiving.company_code ?? "") : null,
      };
    });

    return okResponse({ items: enrichedItems, total: count ?? enrichedItems.length }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_LIST_FAILED";
    return stoErrorResponse(req, ctx, code, 500, code);
  }
}

export async function getSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    if (!stoId) {
      return stoErrorResponse(req, ctx, "STO_ID_REQUIRED", 400, "STO id is required.");
    }
    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_FETCH_FAILED";
    const status = code === "STO_NOT_FOUND" ? 404 : code === "STO_SCOPE_VIOLATION" ? 403 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function getLastStoPaymentTermHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const sendingCompanyId = await getCompanyScope(ctx, url.searchParams.get("sending_company_id") ?? undefined);
    const receivingCompanyId = toTrimmedString(url.searchParams.get("receiving_company_id"));

    if (!sendingCompanyId || !receivingCompanyId) {
      return stoErrorResponse(req, ctx, "STO_LAST_PAYMENT_TERM_FILTERS_REQUIRED", 400, "sending_company_id and receiving_company_id are required.");
    }

    const paymentTermId = await getLastUsedPaymentTermForStoPair(sendingCompanyId, receivingCompanyId);
    return okResponse({ payment_term_id: paymentTermId }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_LAST_PAYMENT_TERM_LOOKUP_FAILED";
    return stoErrorResponse(req, ctx, code, 500, code);
  }
}

export async function updateSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const body = await parseBody(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);

    if (!["DRAFT", "CREATED"].includes(toUpperTrimmedString(sto.status))) {
      return stoErrorResponse(req, ctx, "STO_NOT_EDITABLE", 400, "Only DRAFT or CREATED STO can be updated.");
    }

    const patch: JsonRecord = {
      sto_date: toTrimmedString(body.sto_date) || sto.sto_date,
      sending_cost_center_id: body.sending_cost_center_id !== undefined
        ? (toTrimmedString(body.sending_cost_center_id) || null)
        : sto.sending_cost_center_id,
      receiving_cost_center_id: body.receiving_cost_center_id !== undefined
        ? (toTrimmedString(body.receiving_cost_center_id) || null)
        : sto.receiving_cost_center_id,
      remarks: body.remarks !== undefined ? (toTrimmedString(body.remarks) || null) : sto.remarks,
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    };

    const { error: headerError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update(patch)
      .eq("id", stoId);

    if (headerError) {
      return stoErrorResponse(req, ctx, "STO_UPDATE_FAILED", 500, "Unable to update STO.");
    }

    if (Array.isArray(body.lines)) {
      const lines = body.lines as JsonRecord[];
      const nowIso = new Date().toISOString();
      const lineUpdateErrors = await Promise.all(lines.map(async (line) => {
        const lineId = toTrimmedString(line.id);
        if (!lineId) return null;
        const quantity = parsePositiveNumber(line.quantity);
        const receivedQty = parseNullableNumber(line.received_qty) ?? 0;
        const balanceQty = quantity !== null ? Number((quantity - receivedQty).toFixed(6)) : undefined;
        const linePatch: JsonRecord = {
          sending_storage_location_id: line.sending_storage_location_id !== undefined ? (toTrimmedString(line.sending_storage_location_id) || null) : undefined,
          receiving_storage_location_id: line.receiving_storage_location_id !== undefined ? (toTrimmedString(line.receiving_storage_location_id) || null) : undefined,
          quantity: quantity ?? undefined,
          uom_code: line.uom_code !== undefined ? toTrimmedString(line.uom_code) : undefined,
          transfer_price: line.transfer_price !== undefined ? parseNullableNumber(line.transfer_price) : undefined,
          transfer_price_currency: line.currency_code !== undefined || line.transfer_price_currency !== undefined
            ? (() => {
              const value = toUpperTrimmedString(line.currency_code || line.transfer_price_currency || "INR");
              return CURRENCY_CODES.has(value) ? value : "INR";
            })()
            : undefined,
          currency_code: line.currency_code !== undefined || line.transfer_price_currency !== undefined
            ? (() => {
              const value = toUpperTrimmedString(line.currency_code || line.transfer_price_currency || "INR");
              return CURRENCY_CODES.has(value) ? value : "INR";
            })()
            : undefined,
          payment_term_id: line.payment_term_id !== undefined ? (toTrimmedString(line.payment_term_id) || null) : undefined,
          freight_term: line.freight_term !== undefined ? (toTrimmedString(line.freight_term) || null) : undefined,
          gst_terms: line.gst_terms !== undefined ? (toTrimmedString(line.gst_terms) || null) : undefined,
          gst_rate: line.gst_rate !== undefined ? parseNullableNumber(line.gst_rate) : undefined,
          // Edit forms always resubmit the whole line (qty/rate/payment_term/
          // freight_term are already required together per handleSubmitEdit),
          // so quantity/transfer_price are safely available here whenever
          // gst_rate is -- no separate fetch of the pre-existing row needed.
          gst_amount: line.gst_rate !== undefined
            ? (() => {
                const rate = parseNullableNumber(line.gst_rate);
                const qty = quantity ?? parseNullableNumber(line.quantity);
                const price = parseNullableNumber(line.transfer_price);
                return rate && qty && price ? Number((qty * price * rate / 100).toFixed(4)) : null;
              })()
            : undefined,
          remarks: line.remarks !== undefined ? (toTrimmedString(line.remarks) || null) : undefined,
          has_rebate: line.has_rebate !== undefined ? line.has_rebate === true : undefined,
          rebate_rate: line.rebate_rate !== undefined ? parseNullableNumber(line.rebate_rate) : undefined,
          rebate_rate_uom_basis: line.rebate_rate_uom_basis !== undefined ? (toTrimmedString(line.rebate_rate_uom_basis) || null) : undefined,
          rebate_remarks: line.rebate_remarks !== undefined ? (toTrimmedString(line.rebate_remarks) || null) : undefined,
          expected_delivery_date: line.expected_delivery_date !== undefined ? (toTrimmedString(line.expected_delivery_date) || null) : undefined,
          balance_qty: balanceQty,
          last_updated_at: nowIso,
        };
        const { error: lineError } = await serviceRoleClient
          .schema("erp_procurement")
          .from("stock_transfer_order_line")
          .update(linePatch)
          .eq("id", lineId)
          .eq("sto_id", stoId);
        return lineError;
      }));
      if (lineUpdateErrors.some(Boolean)) {
        return stoErrorResponse(req, ctx, "STO_LINE_UPDATE_FAILED", 500, "Unable to update STO line.");
      }
    }

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_UPDATE_FAILED";
    const status = code === "STO_NOT_FOUND" ? 404 : code === "STO_SCOPE_VIOLATION" ? 403 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function cancelSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const body = await parseBody(req);
    const reason = toTrimmedString(body.cancellation_reason);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);

    if (!reason) {
      return stoErrorResponse(req, ctx, "STO_CANCEL_REASON_REQUIRED", 400, "cancellation_reason is required.");
    }
    if (["RECEIVED", "CLOSED", "CANCELLED"].includes(toUpperTrimmedString(sto.status))) {
      return stoErrorResponse(req, ctx, "STO_CANCEL_BLOCKED", 400, "STO cannot be cancelled after receipt or final closure.");
    }

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: "CANCELLED",
        cancellation_reason: reason,
        cancelled_at: new Date().toISOString(),
        cancelled_by: ctx.auth_user_id,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId);

    if (error) {
      return stoErrorResponse(req, ctx, "STO_CANCEL_FAILED", 500, "Unable to cancel STO.");
    }

    try {
      await inactivateLinkedCsnsForSto({
        stoId,
        reasonCode: "CAN",
        reason,
        actionedBy: ctx.auth_user_id,
        clearStoLink: toUpperTrimmedString(sto.sto_type) === "CONSIGNMENT_DISTRIBUTION",
      });
    } catch (_csnError) {
      return stoErrorResponse(req, ctx, "STO_CANCEL_FAILED", 500, "Unable to inactivate linked CSNs for cancelled STO.");
    }

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_CANCEL_FAILED";
    const status = code === "STO_NOT_FOUND" ? 404 : code === "STO_SCOPE_VIOLATION" ? 403 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

// Per-line equivalent of PO's knockOffPOLineHandler -- STO is one multi-line
// document (not PO's one-doc-per-material split), so "remove one bad item"
// means knocking off a single stock_transfer_order_line, not the whole
// document. The line_status/knock_off_* columns already existed on this
// table (matching PO's shape) but nothing ever wrote KNOCKED_OFF to them --
// dispatchSTOHandler/closeSTOHandler were already written to treat
// KNOCKED_OFF lines as resolved, just never had anything setting it.
// CSN timing now matches PO exactly (createSTOHandler no longer creates one
// early -- see its own comment): at DRAFT/PENDING_APPROVAL no CSN exists
// yet, so knocking off a line there is a plain line removal, nothing to
// inactivate. Only once CREATED (post-approval) can a CSN exist for that
// material -- same restraint as PO's line knock-off: only inactivates it if
// still ORD; TRN/GED (already dispatched) is left untouched, never silently
// cancelled.
export async function knockOffSTOLineHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const lineId = getLineIdFromPath(req);
    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason || body.knock_off_reason);
    if (!reason) {
      return stoErrorResponse(req, ctx, "STO_LINE_KNOCK_OFF_REASON_REQUIRED", 400, "Knock-off reason is required.");
    }

    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);
    if (!["DRAFT", "PENDING_APPROVAL", "CREATED"].includes(toUpperTrimmedString(sto.status))) {
      return stoErrorResponse(req, ctx, "STO_LINE_KNOCK_OFF_BLOCKED", 400, "STO line can only be knocked off before dispatch.");
    }

    const lines = await fetchStoLines(stoId);
    const targetLine = lines.find((line) => toTrimmedString(line.id) === lineId);
    if (!targetLine) {
      return stoErrorResponse(req, ctx, "STO_LINE_NOT_FOUND", 404, "STO line not found.");
    }
    if (toUpperTrimmedString(targetLine.line_status) === "KNOCKED_OFF") {
      return stoErrorResponse(req, ctx, "STO_LINE_ALREADY_KNOCKED_OFF", 400, "This line is already knocked off.");
    }
    if (Number(targetLine.dispatched_qty ?? 0) > 0) {
      return stoErrorResponse(req, ctx, "STO_LINE_ALREADY_DISPATCHED", 400, "This line already has dispatched quantity and cannot be knocked off.");
    }

    const nowIso = new Date().toISOString();
    const { error: lineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order_line")
      .update({
        line_status: "KNOCKED_OFF",
        knock_off_reason: reason,
        knocked_off_by: ctx.auth_user_id,
        knocked_off_at: nowIso,
        last_updated_at: nowIso,
      })
      .eq("id", lineId);

    if (lineError) {
      return stoErrorResponse(req, ctx, "STO_LINE_KNOCK_OFF_FAILED", 500, "Unable to knock off STO line.");
    }

    try {
      await inactivateLinkedCsnsForSto({
        stoId,
        materialId: toTrimmedString(targetLine.material_id),
        reasonCode: "KOF",
        reason,
        actionedBy: ctx.auth_user_id,
        eligibleStatuses: ["ORD"],
      });
    } catch (_csnError) {
      return stoErrorResponse(req, ctx, "STO_LINE_KNOCK_OFF_FAILED", 500, "Unable to inactivate linked CSN for knocked-off line.");
    }

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_LINE_KNOCK_OFF_FAILED";
    const status = code === "STO_NOT_FOUND" ? 404 : code === "STO_LINE_NOT_FOUND" ? 404 : code === "STO_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") || code.includes("BLOCKED") || code.includes("ALREADY") ? 400 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function transformSubCSNToSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const csnId = getIdFromPath(req);
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return stoErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    const subCsn = await getSubCsnById(csnId, companyId);

    if (!toTrimmedString(subCsn.mother_csn_id)) {
      return stoErrorResponse(req, ctx, "SUB_CSN_REQUIRED", 400, "Only sub CSN can be transformed to STO.");
    }
    if (toTrimmedString(subCsn.sto_id)) {
      return stoErrorResponse(req, ctx, "CSN_ALREADY_LINKED_TO_STO", 400, "CSN is already linked to an STO.");
    }

    const sendingCompanyId = toTrimmedString(body.sending_company_id) || companyId;
    const receivingCompanyId = toTrimmedString(body.receiving_company_id) || toTrimmedString(subCsn.consignee_company_id) || companyId;
    const sendingCostCenterId = toTrimmedString(body.sending_cost_center_id);
    const receivingCostCenterId = toTrimmedString(body.receiving_cost_center_id);
    if (!sendingCostCenterId || !receivingCostCenterId) {
      return stoErrorResponse(req, ctx, "STO_COST_CENTERS_REQUIRED", 400, "sending_cost_center_id and receiving_cost_center_id are required.");
    }
    const sto = await buildConsignmentStoFromSubCsns({
      csnIds: [csnId],
      sendingCompanyId,
      receivingCompanyId,
      sendingCostCenterId,
      receivingCostCenterId,
      stoDate: todayIsoDate(),
      remarks: `Auto-created from sub CSN ${subCsn.csn_number ?? csnId}`,
      lineConfigs: new Map([[csnId, body]]),
      actionedBy: ctx.auth_user_id,
    });

    return okResponse(await hydrateSto(String(sto.id), ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_TRANSFORM_FAILED";
    const status = code === "CSN_NOT_FOUND" ? 404 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function confirmSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const body = await parseBody(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);

    if (toUpperTrimmedString(sto.status) !== "DRAFT") {
      return stoErrorResponse(req, ctx, "STO_CONFIRM_BLOCKED", 422, "Only DRAFT STO can be confirmed.");
    }

    const requiresApproval = body.approval_required === true;
    const nextStatus = requiresApproval ? "PENDING_APPROVAL" : "CREATED";
    const nowIso = new Date().toISOString();
    const { data: updatedSto, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: nextStatus,
        approved_by: nextStatus === "CREATED" ? ctx.auth_user_id : null,
        approved_at: nextStatus === "CREATED" ? nowIso : null,
        last_updated_at: nowIso,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId)
      .select("*")
      .single();

    if (error || !updatedSto) {
      throw new Error("STO_CONFIRM_FAILED");
    }

    if (nextStatus === "PENDING_APPROVAL") {
      await insertStoApprovalLog({
        stoId,
        action: "ESCALATED",
        fromStatus: "DRAFT",
        toStatus: "PENDING_APPROVAL",
        remarks: toTrimmedString(body.remarks) || null,
        actionedBy: ctx.auth_user_id,
      });
    } else {
      await createCsnForSto(updatedSto as StoRow, await fetchStoLines(stoId), ctx.auth_user_id);
    }

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_CONFIRM_FAILED";
    const status = code === "STO_NOT_FOUND" ? 404 : code.includes("BLOCKED") ? 422 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function approveSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const stoId = getIdFromPath(req);
    const body = await parseBody(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);
    await assertStoApproverRole(ctx, toTrimmedString(sto.sending_company_id), toTrimmedString(sto.created_by));

    if (toUpperTrimmedString(sto.status) !== "PENDING_APPROVAL") {
      return stoErrorResponse(req, ctx, "STO_APPROVAL_STATE_INVALID", 422, "STO is not pending approval.");
    }

    const nowIso = new Date().toISOString();
    const { data: updatedSto, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: "CREATED",
        approved_by: ctx.auth_user_id,
        approved_at: nowIso,
        last_updated_at: nowIso,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId)
      .select("*")
      .single();

    if (error || !updatedSto) {
      throw new Error("STO_APPROVE_FAILED");
    }

    await insertStoApprovalLog({
      stoId,
      action: "APPROVED",
      fromStatus: "PENDING_APPROVAL",
      toStatus: "CREATED",
      remarks: toTrimmedString(body.remarks) || null,
      actionedBy: ctx.auth_user_id,
    });
    await createCsnForSto(updatedSto as StoRow, await fetchStoLines(stoId), ctx.auth_user_id);
    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_APPROVE_FAILED";
    const status = code === "STO_NOT_FOUND"
      ? 404
      : code === "PROCUREMENT_HEAD_REQUIRED" || code === "PROCUREMENT_SELF_APPROVAL_FORBIDDEN"
      ? 403
      : code.includes("INVALID")
      ? 422
      : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function rejectSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const stoId = getIdFromPath(req);
    const body = await parseBody(req);
    const remarks = toTrimmedString(body.remarks);
    if (!remarks) {
      return stoErrorResponse(req, ctx, "PROCUREMENT_REMARKS_REQUIRED", 400, "Remarks are required.");
    }

    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);
    await assertStoApproverRole(ctx, toTrimmedString(sto.sending_company_id), toTrimmedString(sto.created_by));

    if (toUpperTrimmedString(sto.status) !== "PENDING_APPROVAL") {
      return stoErrorResponse(req, ctx, "STO_APPROVAL_STATE_INVALID", 422, "STO is not pending approval.");
    }

    const { data: updatedSto, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: "DRAFT",
        remarks,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId)
      .select("*")
      .single();

    if (error || !updatedSto) {
      throw new Error("STO_REJECT_FAILED");
    }

    await insertStoApprovalLog({
      stoId,
      action: "REJECTED",
      fromStatus: "PENDING_APPROVAL",
      toStatus: "DRAFT",
      remarks,
      actionedBy: ctx.auth_user_id,
    });

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_REJECT_FAILED";
    const status = code === "STO_NOT_FOUND"
      ? 404
      : code === "PROCUREMENT_HEAD_REQUIRED" || code === "PROCUREMENT_SELF_APPROVAL_FORBIDDEN"
      ? 403
      : code.includes("REQUIRED")
      ? 400
      : code.includes("INVALID")
      ? 422
      : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function amendSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const body = await parseBody(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);

    const currentStatus = toUpperTrimmedString(sto.status);
    if (currentStatus !== "CREATED" && currentStatus !== "PENDING_APPROVAL") {
      return stoErrorResponse(req, ctx, "STO_AMEND_BLOCKED", 422, "STO cannot be amended in current state.");
    }

    const stoLineId = toTrimmedString(body.sto_line_id);
    const existingLines = await fetchStoLines(stoId);
    const targetLine = stoLineId
      ? existingLines.find((line) => toTrimmedString(line.id) === stoLineId) ?? null
      : null;

    if (stoLineId && !targetLine) {
      return stoErrorResponse(req, ctx, "STO_LINE_NOT_FOUND", 404, "STO line not found.");
    }

    const amendmentNumber = await getNextStoAmendmentNumber(stoId);
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
    ) => {
      const approvalRequired = fieldName === "quantity" || fieldName === "transfer_price";
      amendmentEntries.push({
        sto_id: stoId,
        sto_line_id: targetLineId || null,
        amendment_number: amendmentNumber,
        field_changed: fieldName,
        old_value: oldValue == null ? null : String(oldValue),
        new_value: newValue == null ? null : String(newValue),
        requires_approval: approvalRequired,
        approval_status: approvalRequired ? "PENDING" : "APPROVED",
        approved_by: approvalRequired ? null : ctx.auth_user_id,
        approved_at: approvalRequired ? null : new Date().toISOString(),
        amended_by: ctx.auth_user_id,
      });
    };

    const candidateFields: Record<string, unknown> = {
      quantity: body.quantity,
      transfer_price: body.transfer_price,
      expected_delivery_date: body.expected_delivery_date,
      payment_term_id: body.payment_term_id,
      freight_term: body.freight_term,
      gst_terms: body.gst_terms,
      remarks: body.remarks,
      sending_cost_center_id: body.sending_cost_center_id,
      receiving_cost_center_id: body.receiving_cost_center_id,
    };

    for (const [fieldName, rawValue] of Object.entries(candidateFields)) {
      if (rawValue === undefined || !MUTABLE_STO_AMENDMENT_FIELDS.has(fieldName)) {
        continue;
      }
      const lineScoped = ["quantity", "transfer_price", "expected_delivery_date", "payment_term_id", "freight_term", "gst_terms"].includes(fieldName);
      if (lineScoped && !targetLine) {
        return stoErrorResponse(req, ctx, "STO_LINE_REQUIRED", 400, "STO line id is required for line amendment.");
      }

      const normalizedValue = typeof rawValue === "string" ? rawValue.trim() : rawValue;
      const oldValue = lineScoped ? targetLine?.[fieldName] : sto[fieldName];
      if (String(oldValue ?? "") === String(normalizedValue ?? "")) {
        continue;
      }

      if (fieldName === "quantity" || fieldName === "transfer_price") {
        requiresApproval = true;
      }

      pushAmendment(fieldName, oldValue, normalizedValue, targetLine ? toTrimmedString(targetLine.id) : null);

      if (fieldName === "quantity") {
        const quantity = parsePositiveNumber(normalizedValue);
        if (!quantity) {
          return stoErrorResponse(req, ctx, "STO_INVALID_LINE_VALUES", 400, "Invalid quantity.");
        }
        const receivedQty = Number(targetLine?.received_qty ?? 0);
        lineUpdates.quantity = quantity;
        lineUpdates.balance_qty = Number(Math.max(quantity - receivedQty, 0).toFixed(6));
      } else if (fieldName === "transfer_price") {
        const transferPrice = parsePositiveNumber(normalizedValue);
        if (!transferPrice) {
          return stoErrorResponse(req, ctx, "STO_INVALID_LINE_VALUES", 400, "Invalid transfer price.");
        }
        lineUpdates.transfer_price = Number(transferPrice.toFixed(4));
      } else if (fieldName === "payment_term_id") {
        const paymentTermId = toTrimmedString(normalizedValue);
        if (!(await getPaymentTermRow(paymentTermId))) {
          return stoErrorResponse(req, ctx, "PROCUREMENT_PAYMENT_TERM_NOT_FOUND", 404, "Payment term not found.");
        }
        lineUpdates.payment_term_id = paymentTermId;
      } else if (fieldName === "freight_term") {
        lineUpdates.freight_term = toTrimmedString(normalizedValue) || null;
      } else if (fieldName === "gst_terms") {
        lineUpdates.gst_terms = toTrimmedString(normalizedValue) || null;
      } else if (fieldName === "expected_delivery_date") {
        lineUpdates.expected_delivery_date = toTrimmedString(normalizedValue) || null;
      } else if (fieldName === "sending_cost_center_id" || fieldName === "receiving_cost_center_id") {
        const costCenterId = toTrimmedString(normalizedValue);
        if (!(await getCostCenterRow(costCenterId))) {
          return stoErrorResponse(req, ctx, "PROCUREMENT_COST_CENTER_NOT_FOUND", 404, "Cost center not found.");
        }
        headerUpdates[fieldName] = costCenterId;
      } else {
        headerUpdates[fieldName] = normalizedValue || null;
      }
    }

    if (amendmentEntries.length === 0) {
      return stoErrorResponse(req, ctx, "STO_NO_AMENDMENT_CHANGES", 400, "No amendment changes provided.");
    }

    const effectivePendingStatus = requiresApproval ? "PENDING_APPROVAL" : currentStatus;
    const { data: updatedSto, error: stoUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        ...headerUpdates,
        status: effectivePendingStatus,
      })
      .eq("id", stoId)
      .select("*")
      .single();

    if (stoUpdateError || !updatedSto) {
      throw new Error("STO_AMEND_FAILED");
    }

    if (targetLine && Object.keys(lineUpdates).length > 1) {
      const lineUpdateResult = await serviceRoleClient
        .schema("erp_procurement")
        .from("stock_transfer_order_line")
        .update(lineUpdates)
        .eq("id", targetLine.id)
        .select("*")
        .single();

      if (lineUpdateResult.error) {
        throw new Error("STO_LINE_AMEND_FAILED");
      }
    }

    const amendmentInsert = await serviceRoleClient
      .schema("erp_procurement")
      .from("sto_amendment_log")
      .insert(amendmentEntries);

    if (amendmentInsert.error) {
      throw new Error("STO_AMEND_LOG_FAILED");
    }

    return okResponse(
      await enrichProcurementUserDisplays({
        ...updatedSto,
        requires_approval: requiresApproval,
        workflow_status: requiresApproval ? "PENDING_AMENDMENT" : updatedSto.status,
      }),
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_AMEND_FAILED";
    const status =
      code === "STO_NOT_FOUND" || code === "STO_LINE_NOT_FOUND" || code === "PROCUREMENT_COST_CENTER_NOT_FOUND" || code === "PROCUREMENT_PAYMENT_TERM_NOT_FOUND"
        ? 404
        : code.includes("BLOCKED") || code.includes("INVALID")
          ? 422
          : code.includes("REQUIRED") || code.includes("NO_AMENDMENT")
            ? 400
            : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function approveSTOAmendmentHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const stoId = getIdFromPath(req);
    const body = await parseBody(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);
    await assertStoApproverRole(ctx, toTrimmedString(sto.sending_company_id), toTrimmedString(sto.created_by));

    const { data: pendingLogs, error: logError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("sto_amendment_log")
      .select("*")
      .eq("sto_id", stoId)
      .eq("requires_approval", true)
      .eq("approval_status", "PENDING");

    if (logError) {
      throw new Error("STO_AMEND_LOOKUP_FAILED");
    }
    if (!pendingLogs || pendingLogs.length === 0) {
      return stoErrorResponse(req, ctx, "STO_NO_PENDING_AMENDMENT", 422, "No pending amendment found.");
    }

    const nowIso = new Date().toISOString();
    const logUpdate = await serviceRoleClient
      .schema("erp_procurement")
      .from("sto_amendment_log")
      .update({
        approval_status: "APPROVED",
        approved_by: ctx.auth_user_id,
        approved_at: nowIso,
        rejection_reason: null,
      })
      .eq("sto_id", stoId)
      .eq("requires_approval", true)
      .eq("approval_status", "PENDING");

    if (logUpdate.error) {
      throw new Error("STO_AMEND_APPROVE_FAILED");
    }

    const { data: updatedSto, error: stoUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: "CREATED",
        last_updated_at: nowIso,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId)
      .select("*")
      .single();

    if (stoUpdateError || !updatedSto) {
      throw new Error("STO_AMEND_APPROVE_FAILED");
    }

    await insertStoApprovalLog({
      stoId,
      action: "APPROVED",
      fromStatus: "PENDING_AMENDMENT",
      toStatus: "CREATED",
      remarks: toTrimmedString(body.remarks) || null,
      actionedBy: ctx.auth_user_id,
    });

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_AMEND_APPROVE_FAILED";
    const status =
      code === "STO_NOT_FOUND" ? 404
        : code === "PROCUREMENT_HEAD_REQUIRED" || code === "PROCUREMENT_SELF_APPROVAL_FORBIDDEN" ? 403
        : code.includes("NO_PENDING") ? 422
        : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function dispatchSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const body = await parseBody(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);

    if (toUpperTrimmedString(sto.status) !== "CREATED") {
      return stoErrorResponse(req, ctx, "STO_DISPATCH_BLOCKED", 400, "Only CREATED STO can be dispatched.");
    }

    // KNOCKED_OFF lines (knockOffSTOLineHandler) must never reach dispatch --
    // matches closeSTOHandler's own existing KNOCKED_OFF-is-resolved
    // treatment on the other end of the lifecycle.
    const lines = (await fetchStoLines(stoId)).filter(
      (line) => toUpperTrimmedString(line.line_status) !== "KNOCKED_OFF",
    );
    if (lines.length === 0) {
      return stoErrorResponse(req, ctx, "STO_EMPTY", 400, "STO has no lines to dispatch (all lines knocked off).");
    }

    const dispatchedLineResults: Array<{ line: StoLineRow; stockDocumentId: string }> = [];
    let totalDispatchQty = 0;

    // §106: one Material Document (MBLNR+MJAHR) for the whole dispatch event; the STO
    // business number becomes the reference. Shared by every line's ledger item.
    const stoMatDoc = await generateMaterialDocNumber(String(sto.sending_company_id));

    // DEPENDENT: each STO dispatch line posts stock and updates dispatch totals that the following lines must observe in sequence.
    for (const line of lines) {
      const snapshot = await getSnapshotForLine(String(sto.sending_company_id), line);
      const requiredQty = parsePositiveNumber(line.quantity) ?? 0;
      const availableQty = parseNullableNumber(snapshot.quantity) ?? 0;
      if (availableQty < requiredQty) {
        return stoErrorResponse(req, ctx, "INSUFFICIENT_STOCK", 400, `Insufficient stock for STO line ${line.line_number}.`);
      }

      const postingBlocked = await hasPhysicalInventoryBlock(
        String(line.material_id),
        String(line.sending_storage_location_id),
      );
      if (postingBlocked) {
        return stoErrorResponse(
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
          p_document_number: sto.sto_number,
          p_document_date: sto.sto_date,
          p_posting_date: todayIsoDate(),
          p_movement_type_code: "STO_ISSUE",
          p_company_id: sto.sending_company_id,
          p_storage_location_id: line.sending_storage_location_id,
          p_material_id: line.material_id,
          p_quantity: requiredQty,
          p_base_uom_code: line.uom_code,
          p_unit_value: parseNullableNumber(snapshot.valuation_rate) ?? 0,
          p_stock_type_code: "UNRESTRICTED",
          p_direction: "OUT",
          p_posted_by: ctx.auth_user_id,
          p_reversal_of_id: null,
          p_material_doc_number: stoMatDoc.docNumber,
          p_material_doc_year: stoMatDoc.docYear,
          p_reference_document_number: sto.sto_number,
          p_reference_document_type: "STO",
          p_reference_document_id: sto.id ?? null,
        });

      if (posting.error || !Array.isArray(posting.data) || posting.data.length === 0) {
        return stoErrorResponse(req, ctx, "STO_DISPATCH_POST_FAILED", 500, "Unable to post STO issue movement.");
      }

      const stockDocumentId = String(posting.data[0].stock_document_id);
      const issuedQty = requiredQty;
      const balanceQty = Number(((parsePositiveNumber(line.quantity) ?? 0) - issuedQty).toFixed(6));
      const lineStatus = balanceQty <= 0 ? "RECEIVED" : "OPEN";

      const { error: lineUpdateError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("stock_transfer_order_line")
        .update({
          dispatched_qty: issuedQty,
          balance_qty: balanceQty,
          line_status: lineStatus,
          last_updated_at: new Date().toISOString(),
        })
        .eq("id", String(line.id));

      if (lineUpdateError) {
        return stoErrorResponse(req, ctx, "STO_LINE_DISPATCH_UPDATE_FAILED", 500, "Unable to update STO line dispatch state.");
      }

      dispatchedLineResults.push({ line, stockDocumentId });
      totalDispatchQty += issuedQty;
    }

    const dcNumber = await generateProcurementDocNumber("DC");
    const { data: dc, error: dcError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("delivery_challan")
      .insert({
        dc_number: dcNumber,
        dc_date: todayIsoDate(),
        dc_type: "STO",
        selling_company_id: sto.sending_company_id,
        receiving_company_id: sto.receiving_company_id,
        sto_id: stoId,
        delivery_address: toTrimmedString(body.delivery_address) || null,
        transporter_id: toTrimmedString(body.transporter_id) || null,
        transporter_name_freetext: toTrimmedString(body.transporter_name_freetext) || null,
        vehicle_number: toTrimmedString(body.vehicle_number) || null,
        lr_number: toTrimmedString(body.lr_number) || null,
        driver_name: toTrimmedString(body.driver_name) || null,
        status: "AUTO_GENERATED",
        total_value: dispatchedLineResults.reduce((sum, item) => sum + ((parseNullableNumber(item.line.transfer_price) ?? 0) * (parsePositiveNumber(item.line.quantity) ?? 0)), 0),
        remarks: toTrimmedString(body.remarks) || null,
      })
      .select("*")
      .single();

    if (dcError || !dc) {
      return stoErrorResponse(req, ctx, "STO_DC_CREATE_FAILED", 500, "Unable to create delivery challan.");
    }

    const dcLinePayload = dispatchedLineResults.map(({ line, stockDocumentId }, index) => ({
      dc_id: dc.id,
      line_number: index + 1,
      material_id: line.material_id,
      sto_line_id: line.id,
      quantity: line.quantity,
      uom_code: line.uom_code,
      unit_value: line.transfer_price,
      line_total: (parseNullableNumber(line.transfer_price) ?? 0) * (parsePositiveNumber(line.quantity) ?? 0),
      stock_document_id: stockDocumentId,
    }));

    const { error: dcLineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("delivery_challan_line")
      .insert(dcLinePayload);

    if (dcLineError) {
      return stoErrorResponse(req, ctx, "STO_DC_LINE_CREATE_FAILED", 500, "Unable to create delivery challan lines.");
    }

    const gxoNumber = await generateProcurementDocNumber("GXO");
    const { error: gateExitError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_outbound")
      .insert({
        exit_number: gxoNumber,
        exit_date: todayIsoDate(),
        exit_time: toTrimmedString(body.exit_time) || null,
        exit_type: "STO",
        company_id: sto.sending_company_id,
        sto_id: stoId,
        dc_id: dc.id,
        vehicle_number: toTrimmedString(body.vehicle_number) || "STO-VEHICLE",
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
      return stoErrorResponse(req, ctx, "STO_GXO_CREATE_FAILED", 500, "Unable to create outbound gate exit.");
    }

    const { error: stoUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: "DISPATCHED",
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId);

    if (stoUpdateError) {
      return stoErrorResponse(req, ctx, "STO_DISPATCH_STATUS_FAILED", 500, "Unable to update STO status.");
    }

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_DISPATCH_FAILED";
    const status = code === "INSUFFICIENT_STOCK" || code.includes("REQUIRED") ? 400 : code === "STO_NOT_FOUND" ? 404 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function updateGateExitOutboundWeightHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const gateExitId = getPathSegments(req)[4] ?? "";
    const body = await parseBody(req);
    const tareWeight = parsePositiveNumber(body.tare_weight);
    if (!gateExitId || !tareWeight) {
      return stoErrorResponse(req, ctx, "GXO_WEIGHT_INVALID", 400, "gate exit id and tare_weight are required.");
    }

    const { data: gateExit, error: fetchError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_outbound")
      .select("*")
      .eq("id", gateExitId)
      .single();

    if (fetchError || !gateExit) {
      return stoErrorResponse(req, ctx, "GXO_NOT_FOUND", 404, "Outbound gate exit not found.");
    }

    await assertCompanyScope(ctx, toTrimmedString(gateExit.company_id));

    const grossWeight = parseNullableNumber(gateExit.gross_weight);
    const netWeight = grossWeight !== null ? Number((grossWeight - tareWeight).toFixed(6)) : null;
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_outbound")
      .update({
        tare_weight: tareWeight,
        net_weight: netWeight,
      })
      .eq("id", gateExitId)
      .select("*")
      .single();

    if (error || !data) {
      return stoErrorResponse(req, ctx, "GXO_WEIGHT_UPDATE_FAILED", 500, "Unable to update gate exit outbound weight.");
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "GXO_WEIGHT_UPDATE_FAILED";
    const status = code === "GXO_NOT_FOUND" ? 404 : code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function confirmSTOReceiptHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);

    const { data: grn, error: grnError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt")
      .select("*")
      .eq("sto_id", stoId)
      .eq("status", "POSTED")
      .order("posted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (grnError) {
      return stoErrorResponse(req, ctx, "STO_RECEIPT_GRN_CHECK_FAILED", 500, "Unable to validate STO receipt GRN.");
    }
    if (!grn) {
      return stoErrorResponse(req, ctx, "STO_RECEIPT_GRN_MISSING", 400, "No POSTED GRN found for this STO.");
    }

    const { data: grnLines, error: grnLineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt_line")
      .select("*")
      .eq("grn_id", String(grn.id))
      .not("sto_line_id", "is", null);

    if (grnLineError) {
      return stoErrorResponse(req, ctx, "STO_RECEIPT_LINE_FETCH_FAILED", 500, "Unable to fetch STO GRN lines.");
    }

    // DEPENDENT: each linked GRN line rolls received quantity into STO balances, so later iterations must read prior committed totals.
    for (const grnLine of grnLines ?? []) {
      const stoLineId = toTrimmedString((grnLine as JsonRecord).sto_line_id);
      if (!stoLineId) continue;
      const stoLine = (await fetchStoLines(stoId)).find((line) => String(line.id) === stoLineId);
      if (!stoLine) continue;
      const receivedQty = parsePositiveNumber((grnLine as JsonRecord).received_qty) ?? 0;
      const totalReceivedQty = Number(((parseNullableNumber(stoLine.received_qty) ?? 0) + receivedQty).toFixed(6));
      const balanceQty = Number(((parsePositiveNumber(stoLine.quantity) ?? 0) - totalReceivedQty).toFixed(6));
      const lineStatus = balanceQty <= 0 ? "RECEIVED" : "OPEN";
      await serviceRoleClient
        .schema("erp_procurement")
        .from("stock_transfer_order_line")
        .update({
          received_qty: totalReceivedQty,
          balance_qty: balanceQty < 0 ? 0 : balanceQty,
          line_status: lineStatus,
          last_updated_at: new Date().toISOString(),
        })
        .eq("id", stoLineId);
    }

    const { error: updateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: "RECEIVED",
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId);

    if (updateError) {
      return stoErrorResponse(req, ctx, "STO_RECEIPT_CONFIRM_FAILED", 500, "Unable to confirm STO receipt.");
    }

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_RECEIPT_CONFIRM_FAILED";
    const status = code === "STO_NOT_FOUND" ? 404 : code === "STO_RECEIPT_GRN_MISSING" ? 400 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function closeSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);

    if (toUpperTrimmedString(sto.status) !== "RECEIVED") {
      return stoErrorResponse(req, ctx, "STO_CLOSE_BLOCKED", 400, "Only RECEIVED STO can be closed.");
    }

    const lines = await fetchStoLines(stoId);
    const hasOpenBalance = lines.some((line) => {
      const balanceQty = parseNullableNumber(line.balance_qty) ?? 0;
      const lineStatus = toUpperTrimmedString(line.line_status);
      return balanceQty > 0 && lineStatus !== "KNOCKED_OFF";
    });

    if (hasOpenBalance) {
      return stoErrorResponse(req, ctx, "STO_CLOSE_BALANCE_REMAINING", 400, "All STO lines must have zero balance or be knocked off before closing.");
    }

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: "CLOSED",
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId);

    if (error) {
      return stoErrorResponse(req, ctx, "STO_CLOSE_FAILED", 500, "Unable to close STO.");
    }

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_CLOSE_FAILED";
    const status = code === "STO_NOT_FOUND" ? 404 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}
