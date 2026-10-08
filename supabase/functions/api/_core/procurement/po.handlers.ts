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
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { todayIsoInKolkata } from "../../_shared/dateUtils.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { readAclSnapshotDecisionAny } from "../../_shared/acl_snapshot.ts";
import { loadApproverWorkContextIds, matchesApprover, pickScopedApproverRules } from "../../_shared/workflow_scope.ts";
import { hasBlanketApprovalOverride } from "../../_shared/approval_override.ts";
import { listPagination, parseListSearchPage } from "../../_shared/list_pagination.ts";
import { gstStateCodeFromGstNumber, gstStateCodeFromState } from "../../_shared/gstStateCodes.ts";
import { recalculateAndBuildUpdates } from "./csn.handlers.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";

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
const FREIGHT_TERMS = new Set(["FOR", "FREIGHT_SEPARATE", "FREIGHT_AT_ACTUALS", "EX_TRANSPORTER_GODOWN"]);
const GST_TERMS = new Set(["INCLUSIVE", "EXCLUSIVE"]);
const REBATE_RATE_UOM_BASIS = new Set(["BASE_UOM", "PO_UOM"]);
const SHIPMENT_MODES = new Set(["FCL", "LCL", "AIR", "COURIER"]);
const IMPORT_TRADE_TYPES = new Set(["DIRECT_IMPORT", "HIGH_SEA_SALE", "BONDED_WAREHOUSE", "EPCG_ADVANCE_AUTH"]);
const CUSTOMS_MOVEMENT_TYPES = new Set(["DPD", "CFS", "ICD"]);
const MUTABLE_AMENDMENT_FIELDS = new Set([
  "ordered_qty",
  "unit_rate",
  "expected_delivery_date",
  "incoterm",
  "payment_term_id",
  "delivery_type",
  "freight_term",
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

function uniqueTrimmedStrings(values: unknown[]): string[] {
  return [...new Set(values.map((value) => toTrimmedString(value)).filter(Boolean))];
}

function formatCodeNameDisplay(code: unknown, name: unknown): string {
  const normalizedCode = toTrimmedString(code);
  const normalizedName = toTrimmedString(name);
  if (normalizedCode && normalizedName) {
    return `${normalizedCode} | ${normalizedName}`;
  }
  return normalizedCode || normalizedName;
}

async function enrichPoReferenceDisplays(input: {
  po?: PurchaseOrderRow | null;
  pos?: PurchaseOrderRow[];
  lines?: PurchaseOrderLineRow[];
}): Promise<{
  po?: PurchaseOrderRow | null;
  pos?: PurchaseOrderRow[];
  lines?: PurchaseOrderLineRow[];
}> {
  const poRows = input.pos ?? (input.po ? [input.po] : []);
  const lineRows = input.lines ?? [];
  const defaultPaymentTermId = input.po ? toTrimmedString(input.po.payment_term_id) : "";

  const companyIds = uniqueTrimmedStrings(poRows.map((row) => row.company_id));
  const materialIds = uniqueTrimmedStrings(lineRows.map((row) => row.material_id));
  const costCenterIds = uniqueTrimmedStrings(lineRows.map((row) => row.cost_center_id));
  const paymentTermIds = uniqueTrimmedStrings([
    defaultPaymentTermId,
    ...lineRows.map((row) => row.payment_term_id),
  ]);

  const [
    { data: companyRows, error: companyError },
    { data: materialRows, error: materialError },
    { data: costCenterRows, error: costCenterError },
    { data: paymentTermRows, error: paymentTermError },
  ] = await Promise.all([
    companyIds.length > 0
      ? serviceRoleClient
        .schema("erp_master")
        .from("companies")
        .select("id, company_code, company_name")
        .in("id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    materialIds.length > 0
      ? serviceRoleClient
        .schema("erp_master")
        .from("material_master")
        .select("id, pace_code, material_name")
        .in("id", materialIds)
      : Promise.resolve({ data: [], error: null }),
    costCenterIds.length > 0
      ? serviceRoleClient
        .schema("erp_master")
        .from("cost_center_master")
        .select("id, cost_center_code, cost_center_name")
        .in("id", costCenterIds)
      : Promise.resolve({ data: [], error: null }),
    paymentTermIds.length > 0
      ? serviceRoleClient
        .schema("erp_master")
        .from("payment_terms_master")
        .select("id, code, name")
        .in("id", paymentTermIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (companyError || materialError || costCenterError || paymentTermError) {
    throw new Error("PROCUREMENT_PO_REFERENCE_LOOKUP_FAILED");
  }

  const companyNameById = new Map<string, string>(
    ((companyRows ?? []) as Array<{ id: string; company_code: string | null; company_name: string | null }>)
      .map((row) => {
        const id = toTrimmedString(row.id);
        const companyName = toTrimmedString(row.company_name) || toTrimmedString(row.company_code);
        return [id, companyName];
      }),
  );
  const materialDisplayById = new Map<string, string>(
    ((materialRows ?? []) as Array<{ id: string; pace_code: string | null; material_name: string | null }>)
      .map((row) => [toTrimmedString(row.id), formatCodeNameDisplay(row.pace_code, row.material_name)]),
  );
  const costCenterDisplayById = new Map<string, string>(
    ((costCenterRows ?? []) as Array<{ id: string; cost_center_code: string | null; cost_center_name: string | null }>)
      .map((row) => [toTrimmedString(row.id), formatCodeNameDisplay(row.cost_center_code, row.cost_center_name)]),
  );
  const paymentTermDisplayById = new Map<string, string>(
    ((paymentTermRows ?? []) as Array<{ id: string; code: string | null; name: string | null }>)
      .map((row) => [toTrimmedString(row.id), formatCodeNameDisplay(row.code, row.name)]),
  );

  const enrichedPos = input.pos
    ? input.pos.map((row) => {
      const companyId = toTrimmedString(row.company_id);
      return {
        ...row,
        company_name: companyNameById.get(companyId) ?? companyId ?? null,
      };
    })
    : undefined;
  const enrichedPo = input.po
    ? {
      ...input.po,
      company_name: companyNameById.get(toTrimmedString(input.po.company_id))
        ?? toTrimmedString(input.po.company_id)
        ?? null,
    }
    : undefined;
  const enrichedLines = input.lines
    ? input.lines.map((row) => {
      const materialId = toTrimmedString(row.material_id);
      const costCenterId = toTrimmedString(row.cost_center_id);
      const paymentTermId = toTrimmedString(row.payment_term_id) || defaultPaymentTermId;
      return {
        ...row,
        material_display: materialDisplayById.get(materialId) ?? materialId ?? null,
        cost_center_display: costCenterDisplayById.get(costCenterId) ?? costCenterId ?? null,
        payment_term_display: paymentTermDisplayById.get(paymentTermId) ?? paymentTermId ?? null,
      };
    })
    : undefined;

  return {
    po: enrichedPo,
    pos: enrichedPos,
    lines: enrichedLines,
  };
}

// PO01 (list) needs each row's own item names shown inline -- §8A "list
// endpoint must have accurate display data, no per-row detail call". Bulk
// fetch every visible PO's lines + material names in two round trips (page
// size is capped at 50, so a plain .in() is safely bounded -- §8E's own
// small-list exception, no fetchInChunks needed).
async function attachPoItemsSummary(pos: PurchaseOrderRow[]): Promise<PurchaseOrderRow[]> {
  const poIds = uniqueTrimmedStrings(pos.map((row) => row.id));
  if (poIds.length === 0) return pos;

  const { data: lineRows, error: lineError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order_line")
    .select("po_id, material_id, line_number")
    .in("po_id", poIds)
    .order("line_number", { ascending: true });
  if (lineError) throw new Error("PROCUREMENT_PO_LIST_ITEMS_LOOKUP_FAILED");

  const materialIds = uniqueTrimmedStrings(((lineRows ?? []) as PurchaseOrderLineRow[]).map((row) => row.material_id));
  const { data: materialRows, error: materialError } = materialIds.length > 0
    ? await serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .select("id, pace_code, material_name")
      .in("id", materialIds)
    : { data: [] as JsonRecord[], error: null };
  if (materialError) throw new Error("PROCUREMENT_PO_LIST_ITEMS_LOOKUP_FAILED");

  const materialNameById = new Map<string, string>(
    ((materialRows ?? []) as Array<{ id: string; pace_code: string | null; material_name: string | null }>)
      .map((row) => [toTrimmedString(row.id), toTrimmedString(row.material_name) || toTrimmedString(row.pace_code)]),
  );

  const itemNamesByPoId = new Map<string, string[]>();
  for (const line of (lineRows ?? []) as PurchaseOrderLineRow[]) {
    const poId = toTrimmedString(line.po_id);
    const materialName = materialNameById.get(toTrimmedString(line.material_id));
    if (!poId || !materialName) continue;
    if (!itemNamesByPoId.has(poId)) itemNamesByPoId.set(poId, []);
    itemNamesByPoId.get(poId)!.push(materialName);
  }

  return pos.map((row) => {
    const items = itemNamesByPoId.get(toTrimmedString(row.id)) ?? [];
    return {
      ...row,
      items_display: items.join(", "),
      items_count: items.length,
    };
  });
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

// Bookkeeping key note: acl.approver_map rows must reference a resource_code
// already registered in acl.module_resource_map (DB trigger-enforced), and
// PROC_PO_CREATE is a route-only companion resource that deliberately has no
// erp_menu.menu_master row (same pattern as OM_VENDOR_CREATE) — so it can
// never satisfy that requirement. PROC_PO_ORDER_APPROVALS (PO13's own
// resource) is already registered and is the natural sibling — approving a
// PO is the same action whether triggered from PO01's own page or PO13's
// queue (both call this same function). This key is purely internal to this
// lookup; it does NOT change the route-level ACL gate, which stays
// PROC_PO_CREATE:APPROVE per route-acl-registry.ts, unchanged.
async function loadPoApproverRules(companyId: string): Promise<ApproverMapRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("acl")
    .from("approver_map")
    .select("approver_user_id, approver_role_code, approver_work_context_id, resource_code, action_code, scope_type, subject_user_id, subject_work_context_id, subject_role_code, approval_stage")
    .eq("resource_code", "PROC_PO_ORDER_APPROVALS")
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

// Creator-specific approval chains (e.g. "if X submits, Y or Z approves") use
// the same scope_type/subject_user_id columns HR's workflow engine already
// relies on (see _shared/workflow_scope.ts) — pickScopedApproverRules narrows
// the raw approver_map rows down to the ones that actually apply to this PO's
// creator (USER_EXCEPTION rows take priority) before the flat matchesApprover
// check runs. A company that has configured rows but none scoped to this
// particular creator falls back to DIRECTOR, same as the fully-unconfigured
// case — so a plain company-wide/DIRECTOR-only setup keeps working untouched.
// Shared by assertProcurementHeadRole (throws) and canActAsProcurementHead
// (boolean query, used to decide whether to show a PENDING_APPROVAL PO's
// Edit action to a specific viewer without leaking a 403 to non-approvers).
async function resolveProcurementHeadEligibility(
  ctx: ProcurementHandlerContext,
  companyId: string,
  createdBy?: string | null,
): Promise<{ isConfiguredApprover: boolean; selfApprovalBlocked: boolean }> {
  const rules = await loadPoApproverRules(companyId);
  let isConfiguredApprover: boolean;

  if (rules.length === 0) {
    isConfiguredApprover = false; // no approver_map row configured yet, and blanket-override already handled by the caller.
  } else {
    const creatorRoleCode = createdBy ? await getUserRoleCode(createdBy) : null;
    const scopedRules = pickScopedApproverRules(
      {
        resource_code: "PROC_PO_ORDER_APPROVALS",
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
      : false; // configured rows exist, but none scoped to this creator, and blanket-override already handled by the caller.
  }

  return {
    isConfiguredApprover,
    selfApprovalBlocked: Boolean(createdBy) && createdBy === ctx.auth_user_id,
  };
}

async function assertProcurementHeadRole(
  ctx: ProcurementHandlerContext,
  companyId: string,
  createdBy?: string | null,
): Promise<void> {
  if (hasBlanketApprovalOverride(ctx)) {
    return; // SA/GA always retain override authority, regardless of approver_map config.
  }

  const { isConfiguredApprover, selfApprovalBlocked } = await resolveProcurementHeadEligibility(ctx, companyId, createdBy);

  if (!isConfiguredApprover) {
    throw new Error("PROCUREMENT_HEAD_REQUIRED");
  }

  if (selfApprovalBlocked) {
    throw new Error("PROCUREMENT_SELF_APPROVAL_FORBIDDEN");
  }
}

// Non-throwing counterpart of assertProcurementHeadRole — same authority
// rule, used purely to decide UI visibility (e.g. whether this viewer should
// see an Edit action on a PENDING_APPROVAL PO). The write path always
// re-checks via assertProcurementHeadRole; this never substitutes for it.
async function canActAsProcurementHead(
  ctx: ProcurementHandlerContext,
  companyId: string,
  createdBy?: string | null,
): Promise<boolean> {
  if (hasBlanketApprovalOverride(ctx)) {
    return true;
  }
  const { isConfiguredApprover, selfApprovalBlocked } = await resolveProcurementHeadEligibility(ctx, companyId, createdBy);
  return isConfiguredApprover && !selfApprovalBlocked;
}

// §112 — must validate, not just resolve a fallback: an explicitly-requested
// companyId that is NOT one of the caller's own erp_map.user_companies rows
// throws COMPANY_SCOPE_VIOLATION rather than being silently honoured.
async function getCompanyScope(
  ctx: ProcurementHandlerContext,
  requestedCompanyId?: string,
): Promise<string> {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  const companyId = toTrimmedString(requestedCompanyId) || scopedCompanyId;
  if (companyId) await assertCompanyScope(ctx, companyId);
  return companyId;
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

// ── Section 145 — Bulk "Order in LOT" ──────────────────────────────────────
// Lots (never REJECTED ones) for a set of POs, each with its live balance
// (lot_qty − posted GRNs − Gate Entries not yet GRN'd), keyed by po_id.
async function loadLotsByPoId(poIds: string[]): Promise<Map<string, JsonRecord[]>> {
  const ids = uniqueTrimmedStrings(poIds);
  const result = new Map<string, JsonRecord[]>();
  if (ids.length === 0) return result;

  let lots: JsonRecord[];
  try {
    lots = await fetchInChunks<JsonRecord>(ids, (idChunk) =>
      serviceRoleClient
        .schema("erp_procurement")
        .from("purchase_order_lot")
        .select("id, po_id, po_line_id, lot_number, lot_qty, delivery_date, status, amendment_number")
        .in("po_id", idChunk)
        .neq("status", "REJECTED"));
  } catch {
    throw new Error("PROCUREMENT_LOT_LOOKUP_FAILED");
  }
  if (lots.length === 0) return result;

  const lineIds = uniqueTrimmedStrings(lots.map((lot) => lot.po_line_id));
  const balanceByLotId = new Map<string, JsonRecord>();
  const chunks: string[][] = [];
  for (let i = 0; i < lineIds.length; i += 100) chunks.push(lineIds.slice(i, i + 100));
  const responses = await Promise.all(chunks.map((chunk) =>
    serviceRoleClient.schema("erp_procurement").rpc("po_lot_balances", { p_po_line_ids: chunk })));
  for (const response of responses) {
    if (response.error) throw new Error("PROCUREMENT_LOT_BALANCE_LOOKUP_FAILED");
    for (const row of ((response.data as JsonRecord[] | null) ?? [])) {
      balanceByLotId.set(toTrimmedString(row.lot_id), row);
    }
  }

  for (const lot of lots) {
    const balance = balanceByLotId.get(toTrimmedString(lot.id));
    const poId = toTrimmedString(lot.po_id);
    const list = result.get(poId) ?? [];
    list.push({
      ...lot,
      received_qty: Number(balance?.received_qty ?? 0),
      reserved_qty: Number(balance?.reserved_qty ?? 0),
      balance_qty: Number(balance?.balance_qty ?? 0),
    });
    result.set(poId, list);
  }
  for (const list of result.values()) {
    list.sort((a, b) => toTrimmedString(a.lot_number).localeCompare(toTrimmedString(b.lot_number)));
  }
  return result;
}

// Approval paths call this for the POs they approve. A PO with no PENDING lot is a no-op.
async function activatePendingPoLots(poIds: string[], actorId: string): Promise<void> {
  const ids = uniqueTrimmedStrings(poIds);
  if (ids.length === 0) return;
  const { error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("activate_pending_po_lots", { p_po_ids: ids, p_actor: actorId });
  if (error) {
    console.error("PO_LOT_ACTIVATE_ERROR", JSON.stringify(error));
    throw new Error("PROCUREMENT_LOT_ACTIVATE_FAILED");
  }
}

// Rejection paths call this first. Returns the POs that had a pending lot-amend: those go back
// to CONFIRMED (a live Bulk PO must stay live), every other PO keeps the normal DRAFT rejection.
async function rejectPendingPoLots(poIds: string[], actorId: string, remarks: string): Promise<Set<string>> {
  const ids = uniqueTrimmedStrings(poIds);
  if (ids.length === 0) return new Set();
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("reject_pending_po_lots", { p_po_ids: ids, p_actor: actorId, p_remarks: remarks });
  if (error) {
    console.error("PO_LOT_REJECT_ERROR", JSON.stringify(error));
    throw new Error("PROCUREMENT_LOT_REJECT_FAILED");
  }
  return new Set(uniqueTrimmedStrings((data as unknown[] | null) ?? []));
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
  const vendorType = toUpperTrimmedString(po.vendor_type);
  return vendorType === "IMPORT" ? "IMPORT" : "DOMESTIC";
}

async function getPrimaryMaterialCategoryId(materialId: string): Promise<string | null> {
  if (!materialId) {
    return null;
  }

  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_category_group_member")
    .select("group_id")
    .eq("material_id", materialId)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("PO_MATERIAL_CATEGORY_LOOKUP_FAILED", JSON.stringify(error));
    throw new Error(`PROCUREMENT_MATERIAL_CATEGORY_LOOKUP_FAILED: ${error.message}`);
  }

  return toTrimmedString(data?.group_id) || null;
}

async function getPrimaryMaterialCategoryIds(
  materialIds: string[],
): Promise<Map<string, string | null>> {
  const uniqueMaterialIds = uniqueTrimmedStrings(materialIds);
  const categoryByMaterialId = new Map<string, string | null>();

  for (const materialId of uniqueMaterialIds) {
    categoryByMaterialId.set(materialId, null);
  }

  if (uniqueMaterialIds.length === 0) {
    return categoryByMaterialId;
  }

  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_category_group_member")
    .select("material_id, group_id, is_primary")
    .in("material_id", uniqueMaterialIds)
    .order("material_id", { ascending: true })
    .order("is_primary", { ascending: false });

  if (error) {
    console.error("PO_MATERIAL_CATEGORY_LOOKUP_FAILED", JSON.stringify(error));
    throw new Error(`PROCUREMENT_MATERIAL_CATEGORY_LOOKUP_FAILED: ${error.message}`);
  }

  for (const row of ((data as Array<Record<string, unknown>> | null) ?? [])) {
    const materialId = toTrimmedString(row.material_id);
    if (!materialId || categoryByMaterialId.get(materialId)) {
      continue;
    }
    categoryByMaterialId.set(materialId, toTrimmedString(row.group_id) || null);
  }

  return categoryByMaterialId;
}

async function getCostCenterIdsById(
  costCenterIds: string[],
): Promise<Set<string>> {
  const uniqueIds = uniqueTrimmedStrings(costCenterIds);
  if (uniqueIds.length === 0) {
    return new Set();
  }

  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("cost_center_master")
    .select("id")
    .in("id", uniqueIds);

  if (error) {
    throw new Error("PROCUREMENT_COST_CENTER_LOOKUP_FAILED");
  }

  return new Set(
    (((data as Array<Record<string, unknown>> | null) ?? []).map((row) =>
      toTrimmedString(row.id)
    )).filter(Boolean),
  );
}

async function getApprovedAslRowsByMaterialIds(
  vendorId: string,
  materialIds: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const uniqueMaterialIds = uniqueTrimmedStrings(materialIds);
  if (!vendorId || uniqueMaterialIds.length === 0) {
    return new Map();
  }

  const { data: aslRows, error: aslError } = await serviceRoleClient
    .schema("erp_master")
    .from("vendor_material_info")
    .select("*")
    .eq("vendor_id", vendorId)
    .in("material_id", uniqueMaterialIds);

  if (aslError) {
    throw new Error("PROCUREMENT_ASL_LOOKUP_FAILED");
  }

  const activeRows = ((aslRows as Record<string, unknown>[] | null) ?? []).filter((row) => {
    const status = toUpperTrimmedString(row.status);
    return status === "ACTIVE" || status === "APPROVED";
  });

  const vmiIds = uniqueTrimmedStrings(activeRows.map((row) => row.id));
  const uomByVmiId = new Map<string, Array<{ uom_code: string; conversion_factor: number; is_default: boolean }>>();

  if (vmiIds.length > 0) {
    const { data: uomRows, error: uomError } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_material_uom")
      .select("vmi_id, uom_code, conversion_factor, is_default")
      .in("vmi_id", vmiIds);

    if (uomError) {
      throw new Error("PROCUREMENT_ASL_LOOKUP_FAILED");
    }

    for (const row of ((uomRows as Array<Record<string, unknown>> | null) ?? [])) {
      const vmiId = toTrimmedString(row.vmi_id);
      if (!vmiId) {
        continue;
      }
      const list = uomByVmiId.get(vmiId) ?? [];
      list.push({
        uom_code: toTrimmedString(row.uom_code),
        conversion_factor: Number(row.conversion_factor ?? 0),
        is_default: row.is_default === true,
      });
      uomByVmiId.set(vmiId, list);
    }
  }

  const aslByMaterialId = new Map<string, Record<string, unknown>>();
  for (const row of activeRows) {
    const materialId = toTrimmedString(row.material_id);
    const vmiId = toTrimmedString(row.id);
    if (!materialId || aslByMaterialId.has(materialId)) {
      continue;
    }
    aslByMaterialId.set(materialId, {
      ...row,
      uoms: uomByVmiId.get(vmiId) ?? [],
    });
  }

  return aslByMaterialId;
}

async function getPaymentTermRowsByIds(
  paymentTermIds: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const uniqueIds = uniqueTrimmedStrings(paymentTermIds);
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("payment_terms_master")
    .select("*")
    .in("id", uniqueIds);

  if (error) {
    throw new Error("PROCUREMENT_PAYMENT_TERM_LOOKUP_FAILED");
  }

  return new Map(
    (((data as Array<Record<string, unknown>> | null) ?? [])
      .map((row): [string, Record<string, unknown>] => [
        toTrimmedString(row.id),
        row,
      ])
      .filter(([id]) => Boolean(id))),
  );
}

async function createCsnsForPo(
  po: PurchaseOrderRow,
  poLines: PurchaseOrderLineRow[],
  createdBy: string,
): Promise<void> {
  if (toUpperTrimmedString(po.delivery_type) === "BULK") {
    return;
  }

  const lineIds = uniqueTrimmedStrings(poLines.map((line) => line.id));
  // NOTE (updated 2026-09-16): this function now only ever runs at a PO's own
  // first-ever confirm/approve (no prior amendment pending) -- see
  // approvePOHandler/approvePOOrderGroupHandler/approveAmendmentHandler,
  // which route any amendment-approval to createCsnsForQtyIncreaseAmendments
  // instead. It used to also be re-run on every amendment re-approval as a
  // generic "gap fill", but that was found live 2026-09-01 (PO ACPL/AD94/
  // 2026-27) to duplicate CSNs: this gap calc sums dispatch_qty across active
  // sibling CSNs, and a freshly-created-but-not-yet-dispatched sibling reads
  // as "nothing accounted for", so any later re-approval (even a unit_rate-
  // only amendment that never touched qty) created another full-balance CSN
  // on top of the still-undispatched one. Left as-is for the first-approval
  // case it still serves, where there are no siblings yet and the formula
  // degenerates to "full ordered_qty gets one CSN". Sums dispatch_qty, not
  // po_qty -- po_qty on a CSN row is a snapshot of the line's ordered_qty *at
  // that CSN's own creation time*, not that CSN's own share of it (every
  // sibling CSN for one line carries the same po_qty value, so summing po_qty
  // across siblings wildly overcounts). This is the exact same
  // orderedQty - knockedOffQty - sum(dispatch_qty) formula computeDispatchQtyPreview already
  // uses for the "Create CSN for Balance" manual flow -- reused here instead of invented fresh,
  // for consistency and because it's the one already proven against real CSN data.
  const { data: existingRows, error: existingError } = lineIds.length > 0
    ? await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select("po_line_id, dispatch_qty, status")
      .in("po_line_id", lineIds)
    : { data: [], error: null };

  if (existingError) {
    throw new Error("PROCUREMENT_CSN_LOOKUP_FAILED");
  }

  const accountedQtyByLineId = new Map<string, number>();
  for (const row of ((existingRows as JsonRecord[] | null) ?? [])) {
    const poLineId = toTrimmedString(row.po_line_id);
    if (!poLineId) continue;
    const status = toUpperTrimmedString(row.status);
    if (status === "CAN" || status === "KOF") continue;
    accountedQtyByLineId.set(poLineId, (accountedQtyByLineId.get(poLineId) ?? 0) + Number(row.dispatch_qty ?? 0));
  }
  const materialCategoryByMaterialId = await getPrimaryMaterialCategoryIds(
    poLines.map((line) => toTrimmedString(line.material_id)),
  );

  await Promise.all(
    poLines
      .map((line) => {
        const orderedQty = Number(line.ordered_qty ?? 0);
        const knockedOffQty = Number(line.knocked_off_qty ?? 0);
        const accountedQty = accountedQtyByLineId.get(toTrimmedString(line.id)) ?? 0;
        return { line, deltaQty: Number((orderedQty - knockedOffQty - accountedQty).toFixed(6)) };
      })
      .filter(({ deltaQty }) => deltaQty > 0.000001)
      .map(({ line, deltaQty }) =>
        insertCsnRowForLine(po, line, deltaQty, materialCategoryByMaterialId.get(toTrimmedString(line.material_id)) ?? null, createdBy)
      ),
  );
}

// Shared by createCsnsForPo's own confirm/approve-time gap-fill above and by
// createCsnsForQtyIncreaseAmendments below (amendment-approval flow) -- one
// insert shape, two different callers deciding the qty to book.
async function insertCsnRowForLine(
  po: PurchaseOrderRow,
  line: PurchaseOrderLineRow,
  qty: number,
  materialCategoryId: string | null,
  createdBy: string,
): Promise<void> {
  const csnNumber = await generateProcurementDocNumber("CSN");
  const csnType = deriveCsnType(po);
  const portOfDischargeId = toTrimmedString(po.destination_port_id) || null;

  // Seed the same ETD/ETA-to-plant cascade the CSN would otherwise only
  // get on its first later edit -- see recalculateAndBuildUpdates's own
  // comment in csn.handlers.ts for why this was blank until TRN before.
  const etaUpdates = await recalculateAndBuildUpdates(
    {
      csn_type: csnType,
      po_id: po.id,
      vendor_id: po.vendor_id,
      material_category_id: materialCategoryId,
      company_id: po.company_id,
      consignee_company_id: po.company_id,
    },
    portOfDischargeId ? { port_of_discharge_id: portOfDischargeId } : {},
  );

  const { error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .insert({
      csn_number: csnNumber,
      csn_type: csnType,
      status: "ORD",
      company_id: po.company_id,
      vendor_id: po.vendor_id,
      material_id: line.material_id,
      material_category_id: materialCategoryId,
      po_id: po.id,
      po_line_id: line.id,
      po_qty: qty,
      po_uom_code: line.po_uom_code,
      payment_term_id: po.payment_term_id,
      lc_required: po.lc_required === true,
      delivery_type: po.delivery_type ?? "STANDARD",
      has_rebate: po.has_rebate === true,
      rebate_remarks: po.rebate_remarks ?? null,
      indent_required: po.indent_required === true,
      port_of_discharge_id: portOfDischargeId,
      ...etaUpdates,
      created_by: createdBy,
    });

  if (error) {
    throw new Error("PROCUREMENT_CSN_CREATE_FAILED");
  }
}

// Amendment-approval CSN creation (LOCKED 2026-09-16, business owner decision):
// unlike createCsnsForPo's gap-fill (used only at a PO's own first-ever
// confirm/approve), an amendment approval must NEVER auto-create a CSN --
// found live that createCsnsForPo's gap formula (sum of sibling dispatch_qty)
// treats a freshly-created-but-not-yet-dispatched sibling CSN as "nothing
// accounted for", so *any* amendment re-approval (even a unit_rate-only one
// that never touched ordered_qty) re-triggered a brand new duplicate CSN for
// the whole outstanding balance. Now: only an ordered_qty INCREASE amendment
// can ever create a CSN, and only when the approver explicitly opts in
// (create_csn_for_qty_increase: true in the approve request body) -- "No"
// just leaves the PO's ordered_qty higher with no new CSN. The qty booked is
// taken directly from that amendment's own recorded old_value/new_value
// delta -- not recomputed via the ambiguous sibling-sum gap heuristic -- so
// it is exactly the "extra quantity", nothing more.
async function createCsnsForQtyIncreaseAmendments(
  po: PurchaseOrderRow,
  poLines: PurchaseOrderLineRow[],
  qtyIncreaseRows: PoAmendmentLogRow[],
  createdBy: string,
): Promise<void> {
  if (toUpperTrimmedString(po.delivery_type) === "BULK" || qtyIncreaseRows.length === 0) {
    return;
  }

  const lineById = new Map(poLines.map((line) => [toTrimmedString(line.id), line]));
  const materialCategoryByMaterialId = await getPrimaryMaterialCategoryIds(
    poLines.map((line) => toTrimmedString(line.material_id)),
  );

  await Promise.all(
    qtyIncreaseRows.map((row) => {
      const line = lineById.get(toTrimmedString(row.po_line_id));
      if (!line) {
        return Promise.resolve();
      }
      const deltaQty = Number((Number(row.new_value ?? 0) - Number(row.old_value ?? 0)).toFixed(6));
      if (deltaQty <= 0.000001) {
        return Promise.resolve();
      }
      const materialCategoryId = materialCategoryByMaterialId.get(toTrimmedString(line.material_id)) ?? null;
      return insertCsnRowForLine(po, line, deltaQty, materialCategoryId, createdBy);
    }),
  );
}

type PoAmendmentLogRow = {
  id: string;
  po_id: string;
  po_line_id: string | null;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
};

// Every requires_approval=true amendment row still sitting at PENDING for
// these POs -- both ordered_qty/unit_rate amendments land here the moment
// amendPOHandler logs them, and nothing else ever moved them out of PENDING
// (approveAmendmentHandler's own log update was dead code, never called by
// the frontend -- the real approval path is approvePOHandler/
// approvePOOrderGroupHandler, which never touched this table at all before
// this fix). Callers must mark whatever they act on APPROVED via
// markAmendmentRowsApproved so a later, unrelated approval never re-reads
// these same rows again.
async function getPendingAmendmentRows(poIds: string[]): Promise<PoAmendmentLogRow[]> {
  const ids = uniqueTrimmedStrings(poIds);
  if (ids.length === 0) {
    return [];
  }
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("po_amendment_log")
    .select("id, po_id, po_line_id, field_changed, old_value, new_value")
    .in("po_id", ids)
    .eq("requires_approval", true)
    .eq("approval_status", "PENDING");

  if (error) {
    throw new Error("PROCUREMENT_PO_AMEND_LOOKUP_FAILED");
  }
  return (data as PoAmendmentLogRow[] | null) ?? [];
}

function isQtyIncreaseAmendment(row: PoAmendmentLogRow): boolean {
  if (row.field_changed !== "ordered_qty") {
    return false;
  }
  const oldQty = Number(row.old_value ?? 0);
  const newQty = Number(row.new_value ?? 0);
  return Number.isFinite(oldQty) && Number.isFinite(newQty) && newQty > oldQty;
}

async function markAmendmentRowsApproved(rowIds: string[], actorId: string): Promise<void> {
  const ids = uniqueTrimmedStrings(rowIds);
  if (ids.length === 0) {
    return;
  }
  const { error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("po_amendment_log")
    .update({
      approval_status: "APPROVED",
      approved_by: actorId,
      approved_at: new Date().toISOString(),
    })
    .in("id", ids);

  if (error) {
    throw new Error("PROCUREMENT_PO_AMEND_APPROVE_FAILED");
  }
}

async function inactivateCsnsForPo(input: {
  poId?: string;
  poLineId?: string;
  reasonCode: "CAN" | "KOF";
  reason: string;
  actionedBy: string;
  eligibleStatuses?: string[];
}): Promise<void> {
  let query = serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .select("id, status")
    .in("status", input.eligibleStatuses ?? ["ORD", "TRN", "GED"]);

  if (input.poId) {
    query = query.eq("po_id", input.poId);
  }
  if (input.poLineId) {
    query = query.eq("po_line_id", input.poLineId);
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
        last_updated_at: nowIso,
        last_updated_by: input.actionedBy,
      })
      .eq("id", csnId);

    if (updateError) {
      throw new Error("PROCUREMENT_CSN_UPDATE_FAILED");
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
  const lineRecords = rawLines.map((line) => ((line ?? {}) as JsonRecord));
  const [validCostCenterIds, aslByMaterialId] = await Promise.all([
    getCostCenterIdsById(lineRecords.map((line) => toTrimmedString(line.cost_center_id))),
    getApprovedAslRowsByMaterialIds(
      vendorId,
      lineRecords.map((line) => toTrimmedString(line.material_id)),
    ),
  ]);

  for (let index = 0; index < rawLines.length; index += 1) {
    const rawLine = lineRecords[index];
    const materialId = toTrimmedString(rawLine.material_id);
    const costCenterId = toTrimmedString(rawLine.cost_center_id);

    if (!materialId) {
      throw new Error("PROCUREMENT_MATERIAL_REQUIRED");
    }
    if (!costCenterId) {
      throw new Error("PROCUREMENT_COST_CENTER_REQUIRED");
    }
    if (!validCostCenterIds.has(costCenterId)) {
      throw new Error("PROCUREMENT_COST_CENTER_NOT_FOUND");
    }

    const aslRow = aslByMaterialId.get(materialId);
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
      currency_code: toUpperTrimmedString(rawLine.currency_code || "INR") || "INR",
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
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    if (companyId) {
      try {
        await assertCompanyScope(ctx, companyId);
      } catch {
        return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
      }
    }
    const vendorId = toTrimmedString(body.vendor_id);
    const vendorType = toUpperTrimmedString(body.vendor_type);
    const deliveryType = toUpperTrimmedString(body.delivery_type || "STANDARD");
    const poDate = toTrimmedString(body.po_date) || todayIsoInKolkata();
    const isOpeningPo = body.is_opening_po === true;
    const openingPoNumber = toTrimmedString(body.po_number);
    const costCenterId = toTrimmedString(body.cost_center_id);
    const extraFields = parseStringArray(body.extra_fields);
    // Section 145 -- Bulk "Order in LOT": set at create only, BULK only. The PO's first lot
    // (0001) is created below with the ordered qty and delivery date entered here.
    const orderInLot = body.order_in_lot === true;

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
    if (orderInLot && deliveryType !== "BULK") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_LOT_ORDER_BULK_ONLY", 400, "Order in LOT is available for Bulk delivery type only.");
    }
    // §3.7 "Bulk PO/STO — Effective Date + Cutoff mechanism" — mandatory only for BULK.
    // Vendor Challan/Invoice dates at GE are validated against this PO's window (see
    // resolveBulkEffectiveWindow in gate_entry.handlers.ts), replacing knock-off as the
    // authority that gates whether a document can post against this PO.
    const effectiveStartDate = toTrimmedString(body.effective_start_date) || null;
    if (deliveryType === "BULK" && !effectiveStartDate) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_EFFECTIVE_DATE_REQUIRED", 400, "Effective Start Date is required for Bulk delivery type.");
    }
    const incoterm = toTrimmedString(body.incoterm) || await getLastUsedIncoterm(vendorId) || null;
    if (vendorType === "IMPORT" && !incoterm) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INCOTERM_REQUIRED", 400, "Incoterm required for import PO");
    }
    const destinationPortId = toTrimmedString(body.destination_port_id) || null;
    if (vendorType === "IMPORT" && !destinationPortId) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_DESTINATION_PORT_REQUIRED", 400, "Destination port required for import PO");
    }
    const shipmentMode = toUpperTrimmedString(body.shipment_mode) || null;
    const importTradeType = toUpperTrimmedString(body.import_trade_type) || null;
    const customsMovementType = toUpperTrimmedString(body.customs_movement_type) || null;
    if (vendorType === "IMPORT") {
      if (!shipmentMode || !SHIPMENT_MODES.has(shipmentMode)) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_SHIPMENT_MODE_REQUIRED", 400, "Valid shipment mode required for import PO");
      }
      if (!importTradeType || !IMPORT_TRADE_TYPES.has(importTradeType)) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_IMPORT_TRADE_TYPE_REQUIRED", 400, "Valid import trade type required for import PO");
      }
      if (!customsMovementType || !CUSTOMS_MOVEMENT_TYPES.has(customsMovementType)) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_CUSTOMS_MOVEMENT_TYPE_REQUIRED", 400, "Valid customs movement type required for import PO");
      }
    }

    // Found live 2026-09-01 (CSN Tracker date-cascade audit, business owner): a CSN's ETD/ETA
    // cascade is computed once at creation time and frozen -- if the vendor's Lead Time Master
    // (Import: vendor + destination port; Domestic: vendor + company) doesn't exist yet, the
    // cascade silently computes with sail_time/clearance_days/transit_days = 0 and never
    // self-corrects even after someone adds the real config later (nothing re-triggers the
    // calculation just because the master data changed). Hard-blocking here, before the PO or
    // its CSNs can ever be created, is cheaper and safer than trying to catch every stale CSN
    // after the fact. Skipped for opening POs -- those record already-completed historical
    // transactions, not a live shipment whose ETA needs forward tracking.
    const leadTimeQuery = isOpeningPo ? null : vendorType === "IMPORT"
      ? serviceRoleClient
        .schema("erp_master")
        .from("lead_time_master_import")
        .select("id")
        .eq("vendor_id", vendorId)
        .eq("port_of_discharge_id", destinationPortId)
        .eq("active", true)
        .limit(1)
        .maybeSingle()
      : serviceRoleClient
        .schema("erp_master")
        .from("lead_time_master_domestic")
        .select("id")
        .eq("vendor_id", vendorId)
        .eq("company_id", companyId)
        .eq("active", true)
        .limit(1)
        .maybeSingle();
    if (leadTimeQuery) {
      const { data: leadTimeRow, error: leadTimeError } = await leadTimeQuery;
      if (leadTimeError) {
        throw new Error("PROCUREMENT_LEAD_TIME_LOOKUP_FAILED");
      }
      if (!leadTimeRow) {
        return procurementErrorResponse(
          req, ctx, "PROCUREMENT_LEAD_TIME_MASTER_MISSING", 422,
          vendorType === "IMPORT"
            ? "Import Lead Time Master is not set up for this vendor and destination port. Configure it before creating this PO."
            : "Domestic Lead Time Master is not set up for this vendor and company. Configure it before creating this PO.",
        );
      }
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
    if (isOpeningPo && !openingPoNumber) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_OPENING_PO_NUMBER_REQUIRED", 400, "Opening PO number is required");
    }
    if (!(await getCostCenterRow(costCenterId))) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_COST_CENTER_NOT_FOUND", 404, "Cost center not found");
    }

    const groupNumber = await generatePrintGroupNumber();
    const { data: groupData, error: groupError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("po_order_group")
      .insert({
        company_id: companyId,
        vendor_id: vendorId,
        status: "DRAFT",
        remarks: toTrimmedString(body.remarks) || null,
        extra_fields: extraFields,
        group_number: groupNumber,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (groupError || !groupData) {
      console.error("PO_ORDER_GROUP_INSERT_ERROR", JSON.stringify(groupError));
      throw new Error("PROCUREMENT_PO_ORDER_GROUP_CREATE_FAILED");
    }

    const orderGroupId = toTrimmedString(groupData.id);
    const materialRecords = rawMaterials.map((rawMaterial) => ({
      ...((rawMaterial ?? {}) as JsonRecord),
      cost_center_id: costCenterId,
    })) as JsonRecord[];
    const preparedLines = await buildPoLinesForInsert(ctx, vendorId, materialRecords);
    const paymentTermById = await getPaymentTermRowsByIds(
      materialRecords.map((materialRecord) => toTrimmedString(materialRecord.payment_term_id)),
    );

    // Validate every material up front, before any PO/line write starts, so a bad
    // material can never leave earlier/later materials in the same batch half-created.
    const validatedMaterials = materialRecords.map((materialRecord, index) => {
      const paymentTermId = toTrimmedString(materialRecord.payment_term_id);
      const freightTerm = toUpperTrimmedString(materialRecord.freight_term);
      const gstTerms = toUpperTrimmedString(materialRecord.gst_terms);
      const rebateRateUomBasis = toUpperTrimmedString(materialRecord.rebate_rate_uom_basis);
      const paymentTerm = paymentTermById.get(paymentTermId);

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
      // Lot 0001 carries the material's delivery date, so it cannot be blank on an LOT order.
      if (orderInLot && !toTrimmedString(materialRecord.delivery_date || materialRecord.expected_delivery_date)) {
        throw new Error("PROCUREMENT_LOT_DELIVERY_DATE_REQUIRED");
      }

      return {
        materialRecord,
        preparedLine: preparedLines[index],
        freightTerm,
        gstTerms,
        rebateRateUomBasis,
        lcRequired: toUpperTrimmedString(paymentTerm.payment_method) === "LC",
        paymentTermId: paymentTerm.id,
      };
    });

    const purchaseOrders = await Promise.all(
      validatedMaterials.map(async ({ materialRecord, preparedLine, freightTerm, gstTerms, rebateRateUomBasis, lcRequired, paymentTermId }) => {
        const poNumber = isOpeningPo
          ? openingPoNumber as string
          : await generateCompanyDocNumber(companyId, "PO");

        const { data: poData, error: poError } = await serviceRoleClient
          .schema("erp_procurement")
          .from("purchase_order")
          .insert({
            po_number: poNumber,
            is_opening_po: isOpeningPo,
            po_date: poDate,
            company_id: companyId,
            vendor_id: vendorId,
            vendor_type: vendorType,
            incoterm,
            destination_port_id: destinationPortId,
            shipment_mode: shipmentMode,
            import_trade_type: importTradeType,
            customs_movement_type: customsMovementType,
            freight_term: freightTerm,
            payment_term_id: paymentTermId,
            lc_required: lcRequired,
            delivery_type: deliveryType,
            order_in_lot: orderInLot,
            effective_start_date: effectiveStartDate,
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

        if (orderInLot) {
          const { error: lotError } = await serviceRoleClient
            .schema("erp_procurement")
            .from("purchase_order_lot")
            .insert({
              po_id: poId,
              po_line_id: toTrimmedString(lineData.id),
              lot_number: "0001",
              lot_qty: Number(lineData.ordered_qty),
              delivery_date: toTrimmedString(poData.expected_delivery_date),
              status: "ACTIVE",
              created_by: ctx.auth_user_id,
              approved_by: ctx.auth_user_id,
              approved_at: new Date().toISOString(),
            });
          if (lotError) {
            console.error("PO_LOT_ONE_INSERT_ERROR", JSON.stringify(lotError));
            throw new Error("PROCUREMENT_LOT_CREATE_FAILED");
          }
        }

        return { ...poData, lines: [lineData] };
      }),
    );

    const enrichedData = await enrichProcurementUserDisplays({
      order_group: groupData,
      purchase_orders: purchaseOrders,
      // Backward-compatible single-PO shape for callers that only raised one material.
      ...(purchaseOrders.length === 1 ? purchaseOrders[0] : {}),
    });

    return okResponse({ data: enrichedData }, ctx.request_id, req);
  } catch (err) {
    console.error("PO_CREATE_HANDLER_ERROR", err);
    const code = (err as Error).message || "PROCUREMENT_PO_CREATE_FAILED";
    const status =
      code === "PROCUREMENT_VENDOR_NOT_FOUND" || code === "PROCUREMENT_PAYMENT_TERM_NOT_FOUND"
        ? 404
        : code === "COMPANY_SCOPE_VIOLATION"
          ? 403
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

    // A constrained set that intersected down to zero real IDs must short-circuit
    // to an empty result WITHOUT querying — passing an empty/placeholder array to
    // .in() on a uuid column either matches everything (empty array) or throws
    // 22P02 (invalid placeholder like "__none__"). Only a non-empty ID list, or no
    // constraint at all (null = don't filter), is safe to hand to .in()/the query.
    const companyEmpty = companyIds !== null && companyIds.length === 0;
    const vendorEmpty = vendorIds !== null && vendorIds.length === 0;
    const materialEmpty = materialIds !== null && materialIds.length === 0;

    let companyQuery = serviceRoleClient.schema("erp_master").from("companies")
      .select("id, company_code, company_name, state_name")
      .eq("company_kind", "BUSINESS")
      .eq("status", "ACTIVE")
      .order("company_name", { ascending: true });
    if (companyIds !== null && companyIds.length > 0) companyQuery = companyQuery.in("id", companyIds);

    let vendorQuery = serviceRoleClient.schema("erp_master").from("vendor_master")
      .select("id, vendor_code, vendor_name, vendor_type, indent_number_required, gst_number, reg_address_state")
      .eq("status", "ACTIVE")
      .order("vendor_name", { ascending: true });
    if (vendorIds !== null && vendorIds.length > 0) vendorQuery = vendorQuery.in("id", vendorIds);

    let materialQuery = serviceRoleClient.schema("erp_master").from("material_master")
      .select("id, pace_code, material_name, material_type")
      .in("material_type", ["RM", "PM"])
      .order("material_name", { ascending: true });
    if (materialIds !== null && materialIds.length > 0) materialQuery = materialQuery.in("id", materialIds);

    const [companiesResult, vendorsResult, materialsResult] = await Promise.all([
      companyEmpty ? Promise.resolve({ data: [] as unknown[], error: null }) : companyQuery,
      vendorEmpty ? Promise.resolve({ data: [] as unknown[], error: null }) : vendorQuery,
      materialEmpty ? Promise.resolve({ data: [] as unknown[], error: null }) : materialQuery,
    ]);

    if (companiesResult.error || vendorsResult.error || materialsResult.error) {
      console.error("PO_FILTER_OPTIONS query errors", {
        companyError: companiesResult.error,
        vendorError: vendorsResult.error,
        materialError: materialsResult.error,
      });
      throw new Error("PROCUREMENT_PO_FILTER_OPTIONS_FAILED");
    }

    // Same vendor legal entity can carry separate vendor_master rows per state
    // (separate GSTIN each) -- prefix the label with the GST state code so the
    // right one is picked at PO creation (state code = GSTIN's own first 2
    // digits, falling back to the registered address state; same resolution
    // order as Customer Master's display_code, see gstStateCodes.ts).
    const vendorsWithDisplayCode = ((vendorsResult.data ?? []) as JsonRecord[]).map((row) => {
      const gstStateCode =
        gstStateCodeFromGstNumber(row.gst_number as string | null) ??
        gstStateCodeFromState(row.reg_address_state as string | null);
      return {
        ...row,
        gst_state_code: gstStateCode,
        display_code: gstStateCode
          ? `${gstStateCode} - ${row.vendor_name as string}`
          : (row.vendor_name as string),
      };
    });

    return okResponse({
      companies: companiesResult.data ?? [],
      vendors: vendorsWithDisplayCode,
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
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? "");
    const statusFilter = toUpperTrimmedString(url.searchParams.get("status"));
    const vendorId = toTrimmedString(url.searchParams.get("vendor_id"));
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const { page, perPage: limit, offset, search } = parseListSearchPage(url);

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
    if (search) {
      // The page's own placeholder promises "Search PO number or vendor" --
      // po_number lives on this table directly, but vendor_name/vendor_code
      // don't, so a plain .ilike() can't reach them. Resolve matching vendor
      // ids first (small, bounded lookup) and fold them into the same .or().
      const { data: matchedVendors, error: vendorSearchError } = await serviceRoleClient
        .schema("erp_master")
        .from("vendor_master")
        .select("id")
        .or(`vendor_name.ilike.%${search}%,vendor_code.ilike.%${search}%`);
      if (vendorSearchError) {
        throw new Error("PROCUREMENT_PO_LIST_FAILED");
      }
      const matchedVendorIds = ((matchedVendors ?? []) as { id: string }[]).map((row) => row.id);
      const orParts = [`po_number.ilike.%${search}%`];
      if (matchedVendorIds.length > 0) {
        orParts.push(`vendor_id.in.(${matchedVendorIds.join(",")})`);
      }
      query = query.or(orParts.join(","));
    }

    const { data, error, count } = await query;
    if (error) {
      throw new Error("PROCUREMENT_PO_LIST_FAILED");
    }

    const enrichedList = await enrichPoReferenceDisplays({ pos: (data as PurchaseOrderRow[] | null) ?? [] });
    const posWithItems = await attachPoItemsSummary(enrichedList.pos ?? []);
    const posWithCrcp = await attachPoCrcpCompanyCodes(posWithItems);

    return okResponse({
      data: await enrichProcurementUserDisplays(posWithCrcp),
      total: count ?? 0,
      pagination: listPagination(page, limit, count ?? 0),
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, "Purchase order list failed");
  }
}

// CRCP (Cross Company) — PROCUREMENT-DESIGN-DOC.md §3.7 Point 3.2.2. Bulk-
// resolves each PO's shared-company codes for the two new List page columns
// (CRCP flag + shared company codes); pos with crcp_enabled=false get an
// empty array without a wasted lookup.
async function attachPoCrcpCompanyCodes<T extends { id: unknown; crcp_enabled?: unknown }>(pos: T[]): Promise<T[]> {
  const crcpPoIds = uniqueTrimmedStrings(pos.filter((po) => po.crcp_enabled === true).map((po) => po.id));
  if (crcpPoIds.length === 0) {
    return pos.map((po) => ({ ...po, crcp_company_codes: [] }));
  }
  const { data: rows } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order_crcp_company")
    .select("po_id, company_id")
    .in("po_id", crcpPoIds);
  const companyIds = uniqueTrimmedStrings((rows ?? []).map((row) => (row as JsonRecord).company_id));
  const { data: companies } = companyIds.length > 0
    ? await serviceRoleClient.schema("erp_master").from("companies").select("id, company_code").in("id", companyIds)
    : { data: [] as JsonRecord[] };
  const codeByCompanyId = new Map((companies ?? []).map((row) => [String((row as JsonRecord).id), String((row as JsonRecord).company_code ?? "")]));
  const codesByPoId = new Map<string, string[]>();
  for (const row of rows ?? []) {
    const poId = String((row as JsonRecord).po_id);
    const code = codeByCompanyId.get(String((row as JsonRecord).company_id)) || "";
    if (!code) continue;
    codesByPoId.set(poId, [...(codesByPoId.get(poId) ?? []), code]);
  }
  return pos.map((po) => ({ ...po, crcp_company_codes: codesByPoId.get(String(po.id)) ?? [] }));
}

export async function getPOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const poId = getPoIdFromPath(req);
    const po = await getPOById(poId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    try {
      await assertCompanyScope(ctx, toTrimmedString(po.company_id));
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
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

    const enrichedDetail = await enrichPoReferenceDisplays({ po, lines });

    // Only relevant while PENDING_APPROVAL -- lets the frontend show the Edit
    // action to this PO's actual approver without ever showing it (and then
    // 403ing) to every other viewer who can merely open this detail page.
    const canEditPendingApproval = toUpperTrimmedString(po.status) === "PENDING_APPROVAL"
      ? await canActAsProcurementHead(ctx, toTrimmedString(po.company_id), toTrimmedString(po.created_by))
      : false;

    // CRCP (Cross Company) — §3.7 Point 3.2.2. Raw company_ids for the Detail
    // page's edit multi-select (resolved to Code/State/Name client-side from
    // the same company-options list the page already loads).
    const { data: crcpRows } = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order_crcp_company")
      .select("company_id")
      .eq("po_id", poId);
    const crcpCompanyIds = uniqueTrimmedStrings((crcpRows ?? []).map((row) => (row as JsonRecord).company_id));

    // Section 145 -- lots (PENDING ones included, REJECTED never) with live balances.
    const lots = po.order_in_lot === true ? ((await loadLotsByPoId([poId])).get(poId) ?? []) : [];

    return okResponse({
      data: await enrichProcurementUserDisplays({
        ...(enrichedDetail.po ?? po),
        lines: enrichedDetail.lines ?? lines,
        approval_log: approvalLogResult.data ?? [],
        amendment_log: amendmentLogResult.data ?? [],
        can_edit_pending_approval: canEditPendingApproval,
        crcp_company_ids: crcpCompanyIds,
        lots,
      }),
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_DETAIL_FAILED";
    const status = code === "PROCUREMENT_PO_NOT_FOUND" ? 404 : code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500;
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
    const po = await getPOById(poId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    try {
      await assertCompanyScope(ctx, toTrimmedString(po.company_id));
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    const currentStatus = toUpperTrimmedString(po.status);
    if (currentStatus !== "DRAFT" && currentStatus !== "PENDING_APPROVAL") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_DRAFT", 422, "Only DRAFT or PENDING_APPROVAL PO can be updated");
    }
    // Section 145 -- this handler deletes and re-creates the PO line, which would take every lot
    // with it. A PO whose lot-amend is awaiting approval is therefore not editable here at all
    // (approve or reject it); a not-yet-approved original is re-created with a fresh lot 0001 below.
    const poOrderInLot = po.order_in_lot === true;
    let previousLotOneDate = "";
    if (poOrderInLot) {
      const existingLots = (await loadLotsByPoId([poId])).get(poId) ?? [];
      if (existingLots.some((lot) => toUpperTrimmedString(lot.status) === "PENDING")) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_LOT_EDIT_BLOCKED", 422, "This PO has a lot waiting for approval. Approve or reject it instead of editing.");
      }
      if (existingLots.some((lot) => toUpperTrimmedString(lot.status) === "ACTIVE" && toTrimmedString(lot.lot_number) !== "0001")) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_LOT_EDIT_BLOCKED", 422, "This PO already has additional lots and cannot be edited.");
      }
      previousLotOneDate = toTrimmedString(existingLots[0]?.delivery_date);
    }
    if (currentStatus === "PENDING_APPROVAL") {
      // While pending approval, editing is restricted to this PO's own
      // approver (same authority as approvePOHandler/rejectPOHandler) --
      // otherwise the creator or any other viewer could freely rewrite a PO
      // that's sitting in someone else's approval queue.
      await assertProcurementHeadRole(ctx, toTrimmedString(po.company_id), toTrimmedString(po.created_by));
    }

    const vendorId = toTrimmedString(body.vendor_id || po.vendor_id);
    const paymentTermId = toTrimmedString(body.payment_term_id || po.payment_term_id);
    const vendorType = toUpperTrimmedString(body.vendor_type || po.vendor_type);
    const deliveryType = toUpperTrimmedString(body.delivery_type || po.delivery_type);
    const freightTerm = toUpperTrimmedString(body.freight_term || po.freight_term);
    const gstTerms = toUpperTrimmedString(body.gst_terms ?? po.gst_terms);
    const rebateRateUomBasis = toUpperTrimmedString(
      body.rebate_rate_uom_basis ?? po.rebate_rate_uom_basis,
    );
    const incoterm = toTrimmedString(body.incoterm ?? po.incoterm);
    const hasRebate = body.has_rebate === true;
    const rebateRate = hasRebate
      ? parseNullableNumber(body.rebate_rate ?? po.rebate_rate)
      : null;
    const costCenterId = toTrimmedString(body.cost_center_id);

    if (!DELIVERY_TYPES.has(deliveryType) || !PO_VENDOR_TYPES.has(vendorType) || !FREIGHT_TERMS.has(freightTerm)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_PO_VALUES", 400, "Invalid PO header values");
    }
    if (poOrderInLot && deliveryType !== "BULK") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_LOT_ORDER_BULK_ONLY", 400, "An Order in LOT PO must stay Bulk.");
    }
    if (vendorType === "IMPORT" && !incoterm) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INCOTERM_REQUIRED", 400, "Incoterm required for import PO");
    }
    if (gstTerms && !GST_TERMS.has(gstTerms)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_GST_TERMS", 400, "Invalid GST terms");
    }
    if (rebateRateUomBasis && !REBATE_RATE_UOM_BASIS.has(rebateRateUomBasis)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_REBATE_RATE_UOM_BASIS", 400, "Invalid rebate rate basis");
    }

    const paymentTerm = await getPaymentTermRow(paymentTermId);
    if (!paymentTerm) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PAYMENT_TERM_NOT_FOUND", 404, "Payment term not found");
    }

    const rawLines = Array.isArray(body.lines)
      ? body.lines.map((line) => ({
        ...((line ?? {}) as JsonRecord),
        cost_center_id: costCenterId || toTrimmedString((line as JsonRecord | undefined)?.cost_center_id),
      }))
      : body.lines;
    const preparedLines = await buildPoLinesForInsert(ctx, vendorId, rawLines);

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
        gst_terms: gstTerms || null,
        has_rebate: hasRebate,
        rebate_remarks: toTrimmedString(body.rebate_remarks) || null,
        rebate_rate: rebateRate,
        rebate_rate_uom_basis: hasRebate ? rebateRateUomBasis || null : null,
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

    if (poOrderInLot) {
      // The line (and its lots, by cascade) was just re-created: put lot 0001 back on it.
      const lotOneDate = toTrimmedString((updatedPo as JsonRecord).expected_delivery_date) || previousLotOneDate;
      if (!lotOneDate) {
        throw new Error("PROCUREMENT_LOT_DELIVERY_DATE_REQUIRED");
      }
      const { error: lotError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("purchase_order_lot")
        .insert((lineData ?? []).map((line: JsonRecord) => ({
          po_id: poId,
          po_line_id: toTrimmedString(line.id),
          lot_number: "0001",
          lot_qty: Number(line.ordered_qty),
          delivery_date: lotOneDate,
          status: "ACTIVE",
          created_by: ctx.auth_user_id,
          approved_by: ctx.auth_user_id,
          approved_at: new Date().toISOString(),
        })));
      if (lotError) {
        console.error("PO_LOT_ONE_REINSERT_ERROR", JSON.stringify(lotError));
        throw new Error("PROCUREMENT_LOT_CREATE_FAILED");
      }
    }

    return okResponse({
      data: await enrichProcurementUserDisplays({
        ...updatedPo,
        lines: lineData ?? [],
      }),
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_UPDATE_FAILED";
    const status =
      code === "PROCUREMENT_PO_NOT_FOUND" || code === "PROCUREMENT_PAYMENT_TERM_NOT_FOUND"
        ? 404
        : code === "COMPANY_SCOPE_VIOLATION" || code === "PROCUREMENT_HEAD_REQUIRED" || code === "PROCUREMENT_SELF_APPROVAL_FORBIDDEN"
          ? 403
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
    const po = await getPOById(poId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    try {
      await assertCompanyScope(ctx, toTrimmedString(po.company_id));
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
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
    const status = code === "PROCUREMENT_PO_NOT_FOUND" ? 404 : code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("NOT_DRAFT") ? 422 : code.includes("BLOCKED") ? 400 : 500;
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
    // Look up by ID alone first, then scope-check against the PO's own
    // company_id — guessing the company from body.company_id/session (as
    // this used to) 404s whenever they don't match the PO's real company,
    // e.g. the Opening/Legacy PO confirm flow (POCreateOpeningPage.jsx)
    // sends an empty body, so the old code fell back to the caller's
    // session company even when the PO was created under a different one.
    const po = await getPOById(poId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    try {
      await assertCompanyScope(ctx, toTrimmedString(po.company_id));
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
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

    const orderGroupId = toTrimmedString((updatedPo as PurchaseOrderRow).order_group_id);
    if (orderGroupId) {
      await syncOrderGroupStatus(orderGroupId, ctx.auth_user_id);
    }

    return okResponse({
      data: await enrichProcurementUserDisplays(updatedPo),
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_CONFIRM_FAILED";
    const status = code === "PROCUREMENT_PO_NOT_FOUND" ? 404 : code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("BLOCKED") ? 422 : 500;
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
    const po = await getPOById(poId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    try {
      await assertCompanyScope(ctx, toTrimmedString(po.company_id));
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    await assertProcurementHeadRole(ctx, toTrimmedString(po.company_id), toTrimmedString(po.created_by));
    if (toUpperTrimmedString(po.status) !== "PENDING_APPROVAL") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_APPROVAL_STATE_INVALID", 422, "PO is not pending approval");
    }

    // A PO lands back at PENDING_APPROVAL two different ways: its very first
    // confirm (no amendment involved -- always needs the initial full-qty
    // CSN, no decision to ask), or an amendPOHandler-driven re-approval of an
    // already-CONFIRMED PO. Only the latter must ever prompt for a CSN, and
    // only when it actually raised ordered_qty -- see
    // createCsnsForQtyIncreaseAmendments's own comment for why this replaced
    // the old unconditional createCsnsForPo call on every approval.
    const pendingAmendmentRows = await getPendingAmendmentRows([poId]);
    const qtyIncreaseRows = pendingAmendmentRows.filter(isQtyIncreaseAmendment);
    if (qtyIncreaseRows.length > 0 && typeof body.create_csn_for_qty_increase !== "boolean") {
      return procurementErrorResponse(
        req,
        ctx,
        "PROCUREMENT_CSN_DECISION_REQUIRED",
        400,
        "Specify whether to create a CSN for the increased quantity",
      );
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

    // Section 145 -- a pending Lot Amend becomes real only now.
    await activatePendingPoLots([poId], ctx.auth_user_id);

    if (pendingAmendmentRows.length > 0) {
      await markAmendmentRowsApproved(pendingAmendmentRows.map((row) => row.id), ctx.auth_user_id);
      if (qtyIncreaseRows.length > 0 && body.create_csn_for_qty_increase === true) {
        await createCsnsForQtyIncreaseAmendments(updatedPo as PurchaseOrderRow, await getPOLines(poId), qtyIncreaseRows, ctx.auth_user_id);
      }
    } else {
      await createCsnsForPo(updatedPo as PurchaseOrderRow, await getPOLines(poId), ctx.auth_user_id);
    }

    const orderGroupId = toTrimmedString((updatedPo as PurchaseOrderRow).order_group_id);
    if (orderGroupId) {
      await syncOrderGroupStatus(orderGroupId, ctx.auth_user_id);
    }

    return okResponse({
      data: await enrichProcurementUserDisplays(updatedPo),
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_APPROVE_FAILED";
    const status =
      code === "PROCUREMENT_PO_NOT_FOUND" ? 404
        : code === "PROCUREMENT_HEAD_REQUIRED" || code === "PROCUREMENT_SELF_APPROVAL_FORBIDDEN" || code === "COMPANY_SCOPE_VIOLATION" ? 403
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

    const po = await getPOById(poId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    try {
      await assertCompanyScope(ctx, toTrimmedString(po.company_id));
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    await assertProcurementHeadRole(ctx, toTrimmedString(po.company_id), toTrimmedString(po.created_by));
    if (toUpperTrimmedString(po.status) !== "PENDING_APPROVAL") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_APPROVAL_STATE_INVALID", 422, "PO is not pending approval");
    }

    // Section 145 -- rejecting a Lot Amend drops the pending lot and leaves a live PO CONFIRMED
    // (the normal rejection below would send it to DRAFT, i.e. stop receiving against it).
    if ((await rejectPendingPoLots([poId], ctx.auth_user_id, remarks)).has(poId)) {
      const restoredPo = await getPOById(poId);
      const restoredGroupId = toTrimmedString((restoredPo as PurchaseOrderRow | null)?.order_group_id);
      if (restoredGroupId) {
        await syncOrderGroupStatus(restoredGroupId, ctx.auth_user_id);
      }
      return okResponse({
        data: await enrichProcurementUserDisplays(restoredPo ?? po),
      }, ctx.request_id, req);
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

    const orderGroupId = toTrimmedString((updatedPo as PurchaseOrderRow).order_group_id);
    if (orderGroupId) {
      await syncOrderGroupStatus(orderGroupId, ctx.auth_user_id);
    }

    return okResponse({
      data: await enrichProcurementUserDisplays(updatedPo),
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_REJECT_FAILED";
    const status =
      code === "PROCUREMENT_PO_NOT_FOUND" ? 404
        : code === "PROCUREMENT_HEAD_REQUIRED" || code === "PROCUREMENT_SELF_APPROVAL_FORBIDDEN" || code === "COMPANY_SCOPE_VIOLATION" ? 403
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
  let debugPoId = "";
  let debugBody: JsonRecord | null = null;
  let debugCurrentStatus = "";
  let debugTargetLine: PurchaseOrderLineRow | null = null;
  let debugHeaderUpdates: JsonRecord = {};
  let debugLineUpdates: JsonRecord = {};
  let debugAmendmentEntries: JsonRecord[] = [];
  let debugOrderGroupId = "";
  try {
    assertProcurementReadRole(ctx);

    const poId = getPoIdFromPath(req);
    const body = await parseBody(req);
    debugPoId = poId;
    debugBody = body;
    const po = await getPOById(poId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    try {
      await assertCompanyScope(ctx, toTrimmedString(po.company_id));
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const currentStatus = toUpperTrimmedString(po.status);
    debugCurrentStatus = currentStatus;
    if (currentStatus !== "CONFIRMED" && currentStatus !== "PENDING_APPROVAL") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_AMEND_BLOCKED", 422, "PO cannot be amended in current state");
    }

    const poLineId = toTrimmedString(body.po_line_id);
    const existingLines = await getPOLines(poId);
    // Section 145 -- on an Order in LOT PO the ordered qty only ever grows through Lot Amend. Only a
    // real change is refused: the Amend form re-sends the unchanged qty/type with every save.
    if (po.order_in_lot === true) {
      const qtyLine = existingLines.find((line) => toTrimmedString(line.id) === poLineId) ?? null;
      const qtyChanged = body.ordered_qty !== undefined
        && Number(body.ordered_qty) !== Number(qtyLine?.ordered_qty ?? Number.NaN);
      const typeChanged = body.delivery_type !== undefined
        && toUpperTrimmedString(body.delivery_type) !== toUpperTrimmedString(po.delivery_type);
      if (qtyChanged || typeChanged) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_LOT_QTY_VIA_LOT_AMEND", 422, "This PO is ordered in lots. Add a lot with Lot Amend instead of changing the quantity or delivery type.");
      }
    }
    const targetLine = poLineId
      ? existingLines.find((line) => toTrimmedString(line.id) === poLineId) ?? null
      : null;
    debugTargetLine = targetLine;

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
    debugHeaderUpdates = headerUpdates;
    debugLineUpdates = lineUpdates;

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
      delivery_type: body.delivery_type,
      freight_term: body.freight_term,
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
        const nextOpenQty = Number(Math.max(orderedQty - alreadyReceivedQty, 0).toFixed(6));
        lineUpdates.ordered_qty = orderedQty;
        lineUpdates.open_qty = nextOpenQty;
        lineUpdates.total_value = Number((orderedQty * Number(targetLine?.unit_rate ?? 0)).toFixed(4));
        // Found live 2026-09-01 (PO ACPL/AD94/2026-27, business owner): open_qty was already
        // being recomputed correctly above, but line_status was left untouched, so an ordered_qty
        // increase after the line had already reached FULLY_RECEIVED left it permanently stuck
        // showing FULLY_RECEIVED even though a real balance had reopened. Same OPEN/
        // PARTIALLY_RECEIVED/FULLY_RECEIVED derivation grn.handlers.ts already uses from its own
        // nextOpenQty. Left alone for a line already at a terminal KNOCKED_OFF/CANCELLED status --
        // that's a different, deliberate state this amendment path doesn't attempt to reopen.
        const currentLineStatus = toUpperTrimmedString(targetLine?.line_status);
        if (currentLineStatus !== "KNOCKED_OFF" && currentLineStatus !== "CANCELLED") {
          lineUpdates.line_status = nextOpenQty <= 0
            ? "FULLY_RECEIVED"
            : nextOpenQty < orderedQty
            ? "PARTIALLY_RECEIVED"
            : "OPEN";
        }
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
      } else if (fieldName === "delivery_type") {
        const deliveryType = toUpperTrimmedString(normalizedValue);
        if (!DELIVERY_TYPES.has(deliveryType)) {
          return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_DELIVERY_TYPE", 400, "Invalid delivery type");
        }
        headerUpdates.delivery_type = deliveryType;
      } else if (fieldName === "freight_term") {
        const freightTerm = toUpperTrimmedString(normalizedValue);
        if (!FREIGHT_TERMS.has(freightTerm)) {
          return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_FREIGHT_TERM", 400, "Invalid freight term");
        }
        headerUpdates.freight_term = freightTerm;
      } else {
        headerUpdates[fieldName] = normalizedValue || null;
      }
    }

    if (amendmentEntries.length === 0) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_NO_AMENDMENT_CHANGES", 400, "No amendment changes provided");
    }
    debugAmendmentEntries = amendmentEntries;

    const effectivePendingStatus = requiresApproval ? "PENDING_APPROVAL" : currentStatus;
    console.log("PO_AMEND_ATTEMPT", JSON.stringify({
      request_id: ctx.request_id,
      auth_user_id: ctx.auth_user_id,
      po_id: poId,
      po_number: po.po_number,
      company_id: po.company_id,
      current_status: currentStatus,
      effective_pending_status: effectivePendingStatus,
      po_line_id: poLineId || null,
      target_line_number: targetLine?.line_number ?? null,
      target_line_open_qty: targetLine?.open_qty ?? null,
      changed_fields: amendmentEntries.map((entry) => ({
        field_changed: entry.field_changed,
        old_value: entry.old_value,
        new_value: entry.new_value,
        requires_approval: entry.requires_approval,
      })),
      header_updates: headerUpdates,
      line_updates: lineUpdates,
    }));

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
      console.error("PO_AMEND_HEADER_UPDATE_ERROR", JSON.stringify({
        request_id: ctx.request_id,
        po_id: poId,
        po_line_id: poLineId || null,
        effective_pending_status: effectivePendingStatus,
        header_updates: headerUpdates,
        error: poUpdateError,
      }));
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
        console.error("PO_AMEND_LINE_UPDATE_ERROR", JSON.stringify({
          request_id: ctx.request_id,
          po_id: poId,
          po_line_id: targetLine.id,
          line_number: targetLine.line_number,
          line_updates: lineUpdates,
          error: lineUpdateResult.error,
        }));
        throw new Error("PROCUREMENT_PO_LINE_AMEND_FAILED");
      }
    }

    const amendmentInsert = await serviceRoleClient
      .schema("erp_procurement")
      .from("po_amendment_log")
      .insert(amendmentEntries);

    if (amendmentInsert.error) {
      console.error("PO_AMEND_LOG_INSERT_ERROR", JSON.stringify({
        request_id: ctx.request_id,
        po_id: poId,
        po_line_id: poLineId || null,
        amendment_entries: amendmentEntries,
        error: amendmentInsert.error,
      }));
      throw new Error("PROCUREMENT_PO_AMEND_LOG_FAILED");
    }

    const orderGroupId = toTrimmedString((updatedPo as PurchaseOrderRow).order_group_id);
    debugOrderGroupId = orderGroupId;
    if (orderGroupId) {
      await syncOrderGroupStatus(orderGroupId, ctx.auth_user_id);
    }

    return okResponse({
      data: await enrichProcurementUserDisplays({
        ...updatedPo,
        requires_approval: requiresApproval,
        workflow_status: requiresApproval ? "PENDING_AMENDMENT" : updatedPo.status,
      }),
    }, ctx.request_id, req);
  } catch (err) {
    console.error("PO_AMEND_HANDLER_ERROR", JSON.stringify({
      request_id: ctx.request_id,
      auth_user_id: ctx.auth_user_id,
      po_id: debugPoId || null,
      po_line_id: toTrimmedString(debugBody?.po_line_id) || debugTargetLine?.id || null,
      current_status: debugCurrentStatus || null,
      order_group_id: debugOrderGroupId || null,
      body: debugBody,
      target_line: debugTargetLine
        ? {
            id: debugTargetLine.id,
            line_number: debugTargetLine.line_number,
            ordered_qty: debugTargetLine.ordered_qty,
            open_qty: debugTargetLine.open_qty,
            unit_rate: debugTargetLine.unit_rate,
          }
        : null,
      header_updates: debugHeaderUpdates,
      line_updates: debugLineUpdates,
      amendment_entries: debugAmendmentEntries,
      error_message: err instanceof Error ? err.message : "UNKNOWN_ERROR",
      error_stack: err instanceof Error ? err.stack : String(err),
    }));
    const code = (err as Error).message || "PROCUREMENT_PO_AMEND_FAILED";
    const status =
      code === "PROCUREMENT_PO_NOT_FOUND" || code === "PROCUREMENT_PO_LINE_NOT_FOUND" || code === "PROCUREMENT_COST_CENTER_NOT_FOUND"
        ? 404
        : code === "COMPANY_SCOPE_VIOLATION"
          ? 403
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
    const po = await getPOById(poId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    try {
      await assertCompanyScope(ctx, toTrimmedString(po.company_id));
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    await assertProcurementHeadRole(ctx, toTrimmedString(po.company_id), toTrimmedString(po.created_by));

    const pendingLogs = await getPendingAmendmentRows([poId]);
    if (pendingLogs.length === 0) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_NO_PENDING_AMENDMENT", 422, "No pending amendment found");
    }

    // See createCsnsForQtyIncreaseAmendments's own comment: only an
    // ordered_qty INCREASE ever creates a CSN here, and only when the
    // approver explicitly opts in via create_csn_for_qty_increase.
    const qtyIncreaseRows = pendingLogs.filter(isQtyIncreaseAmendment);
    if (qtyIncreaseRows.length > 0 && typeof body.create_csn_for_qty_increase !== "boolean") {
      return procurementErrorResponse(
        req,
        ctx,
        "PROCUREMENT_CSN_DECISION_REQUIRED",
        400,
        "Specify whether to create a CSN for the increased quantity",
      );
    }

    const nowIso = new Date().toISOString();
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

    // Section 145 -- a pending Lot Amend becomes real only now.
    await activatePendingPoLots([poId], ctx.auth_user_id);

    await markAmendmentRowsApproved(pendingLogs.map((row) => row.id), ctx.auth_user_id);
    if (qtyIncreaseRows.length > 0 && body.create_csn_for_qty_increase === true) {
      await createCsnsForQtyIncreaseAmendments(updatedPo as PurchaseOrderRow, await getPOLines(poId), qtyIncreaseRows, ctx.auth_user_id);
    }

    const orderGroupId = toTrimmedString((updatedPo as PurchaseOrderRow).order_group_id);
    if (orderGroupId) {
      await syncOrderGroupStatus(orderGroupId, ctx.auth_user_id);
    }

    return okResponse({
      data: await enrichProcurementUserDisplays(updatedPo),
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_AMEND_APPROVE_FAILED";
    const status =
      code === "PROCUREMENT_PO_NOT_FOUND" ? 404
        : code === "PROCUREMENT_HEAD_REQUIRED" || code === "PROCUREMENT_SELF_APPROVAL_FORBIDDEN" || code === "COMPANY_SCOPE_VIOLATION" ? 403
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

    const po = await getPOById(poId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    try {
      await assertCompanyScope(ctx, toTrimmedString(po.company_id));
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
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

    try {
      await inactivateCsnsForPo({
        poId,
        reasonCode: "CAN",
        reason,
        actionedBy: ctx.auth_user_id,
      });
    } catch (csnError) {
      console.error("PO_CANCEL_CSN_UPDATE_ERROR", csnError);
      throw new Error("PROCUREMENT_PO_CANCEL_FAILED");
    }

    const orderGroupId = toTrimmedString((updatedPo as PurchaseOrderRow).order_group_id);
    if (orderGroupId) {
      await syncOrderGroupStatus(orderGroupId, ctx.auth_user_id);
    }

    return okResponse({
      data: await enrichProcurementUserDisplays(updatedPo),
    }, ctx.request_id, req);
  } catch (err) {
    console.error("PO_CANCEL_HANDLER_ERROR", err);
    const code = (err as Error).message || "PROCUREMENT_PO_CANCEL_FAILED";
    const status =
      code === "PROCUREMENT_PO_NOT_FOUND" ? 404
        : code === "COMPANY_SCOPE_VIOLATION" ? 403
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

    const po = await getPOById(poId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    try {
      await assertCompanyScope(ctx, toTrimmedString(po.company_id));
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const lines = await getPOLines(poId);
    const targetLine = lines.find((line) => toTrimmedString(line.id) === lineId);
    if (!targetLine) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_LINE_NOT_FOUND", 404, "PO line not found");
    }

    // §3.7 "Bulk PO/STO — Effective Date + Cutoff mechanism" — a Bulk PO with no
    // successor must not knock off unbounded; require a cutoff_date here instead.
    const cutoffError = await resolveBulkCutoffRequirement(
      poId, toTrimmedString(po.company_id), toTrimmedString(po.vendor_id),
      toTrimmedString(targetLine.material_id), toUpperTrimmedString(po.delivery_type),
      toTrimmedString(body.cutoff_date),
    );
    if (cutoffError) {
      return procurementErrorResponse(req, ctx, cutoffError, 400, "A cutoff date is required to knock off this Bulk PO line -- no successor PO exists yet.");
    }

    const nowIso = new Date().toISOString();
    const { data: updatedLine, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order_line")
      .update({
        line_status: "KNOCKED_OFF",
        knocked_off_qty: Number(targetLine.open_qty ?? targetLine.ordered_qty ?? 0),
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

    try {
      await inactivateCsnsForPo({
        poLineId: lineId,
        reasonCode: "KOF",
        reason,
        actionedBy: ctx.auth_user_id,
        eligibleStatuses: ["ORD"],
      });
    } catch (csnError) {
      console.error("PO_LINE_KNOCK_OFF_CSN_UPDATE_ERROR", csnError);
      throw new Error("PROCUREMENT_PO_LINE_KNOCK_OFF_FAILED");
    }

    const orderGroupId = toTrimmedString(po.order_group_id);
    if (orderGroupId) {
      await syncOrderGroupStatus(orderGroupId, ctx.auth_user_id);
    }

    return okResponse({
      data: await enrichProcurementUserDisplays(updatedLine),
    }, ctx.request_id, req);
  } catch (err) {
    console.error("PO_LINE_KNOCK_OFF_HANDLER_ERROR", err);
    const code = (err as Error).message || "PROCUREMENT_PO_LINE_KNOCK_OFF_FAILED";
    const status = code === "PROCUREMENT_PO_NOT_FOUND" || code === "PROCUREMENT_PO_LINE_NOT_FOUND" ? 404 : code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") ? 400 : 500;
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

    const po = await getPOById(poId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    try {
      await assertCompanyScope(ctx, toTrimmedString(po.company_id));
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const lines = await getPOLines(poId);

    // §3.7 "Bulk PO/STO — Effective Date + Cutoff mechanism" — Bulk PO has exactly one
    // material line, so that line's material_id is the grouping key.
    if (lines.length > 0) {
      const cutoffError = await resolveBulkCutoffRequirement(
        poId, toTrimmedString(po.company_id), toTrimmedString(po.vendor_id),
        toTrimmedString(lines[0].material_id), toUpperTrimmedString(po.delivery_type),
        toTrimmedString(body.cutoff_date),
      );
      if (cutoffError) {
        return procurementErrorResponse(req, ctx, cutoffError, 400, "A cutoff date is required to knock off this Bulk PO -- no successor PO exists yet.");
      }
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

    for (const line of lines) {
      const lineId = toTrimmedString(line.id);
      if (!lineId) {
        continue;
      }
      const knockedOffQty = Number(line.open_qty ?? line.ordered_qty ?? 0);
      const { error: linePatchError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("purchase_order_line")
        .update({
          knocked_off_qty: knockedOffQty,
        })
        .eq("id", lineId);

      if (linePatchError) {
        console.error("PO_KNOCK_OFF_LINE_QTY_UPDATE_ERROR", JSON.stringify(linePatchError));
        throw new Error("PROCUREMENT_PO_KNOCK_OFF_FAILED");
      }
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

    try {
      await inactivateCsnsForPo({
        poId,
        reasonCode: "KOF",
        reason,
        actionedBy: ctx.auth_user_id,
        eligibleStatuses: ["ORD"],
      });
    } catch (csnError) {
      console.error("PO_KNOCK_OFF_CSN_UPDATE_ERROR", csnError);
      throw new Error("PROCUREMENT_PO_KNOCK_OFF_FAILED");
    }

    const orderGroupId = toTrimmedString((updatedPo as PurchaseOrderRow).order_group_id);
    if (orderGroupId) {
      await syncOrderGroupStatus(orderGroupId, ctx.auth_user_id);
    }

    return okResponse({
      data: await enrichProcurementUserDisplays(updatedPo),
    }, ctx.request_id, req);
  } catch (err) {
    console.error("PO_KNOCK_OFF_HANDLER_ERROR", err);
    const code = (err as Error).message || "PROCUREMENT_PO_KNOCK_OFF_FAILED";
    const status = code === "PROCUREMENT_PO_NOT_FOUND" ? 404 : code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order knock-off failed");
  }
}

// ───────────────────────────────────────────────────────────────────────
// CRCP (Cross Company) — Phase A, PROCUREMENT-DESIGN-DOC.md §3.7 Points
// 3.2.1/3.2.2/3.2.9. A lightweight, non-amendment action: editable at any PO
// status except CANCELLED/CLOSED, by anyone holding ordinary PROC_PO_CREATE
// access (route-registry gates the exact action, no separate CRCP role).
// The allow-list holds only ADDITIONAL companies -- the PO's own company is
// always implicitly allowed and is never itself a row, so there is nothing
// to "protect from removal" here.
// ───────────────────────────────────────────────────────────────────────

// CRCP write ACL — setPoCrcpHandler resolves companyId from the PO's own row
// (not necessarily ctx.context.companyId, for a multi-company user acting on
// a PO whose company differs from their session's active company).
// assertCompanyScope alone only proves company MEMBERSHIP
// (erp_map.user_companies), not that the caller's ACL grant at THAT company
// is actually EDIT on PROC_PO_CREATE — same root-cause shape already fixed
// in planning.handlers.ts's canMaintainPlanning/requirePlanningEditAccess
// (found live 2026-08-11), caught here by company-scope-write-acl-guard.mjs
// on 2026-09-28 during Phase B's full-guard verification pass.
async function canMaintainPoCrcp(ctx: ProcurementHandlerContext, companyId: string): Promise<boolean> {
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
    resourceCode: "PROC_PO_CREATE",
    actionCode: "EDIT",
  });
  if (error || !data) return false;
  return data.decision === "ALLOW";
}

export async function setPoCrcpHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const poId = getPoIdFromPath(req);
    const body = await parseBody(req);
    const crcpEnabled = body.crcp_enabled === true;
    const rawCompanyIds = Array.isArray(body.company_ids) ? body.company_ids : [];
    const companyIds = uniqueTrimmedStrings(rawCompanyIds.map((entry) => toTrimmedString(entry)));

    const po = await getPOById(poId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    try {
      await assertCompanyScope(ctx, toTrimmedString(po.company_id));
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    const canEditCrcp = await canMaintainPoCrcp(ctx, toTrimmedString(po.company_id));
    if (!canEditCrcp) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_CRCP_FORBIDDEN", 403, "You do not have edit access to this purchase order's company.");
    }

    const status = toUpperTrimmedString(po.status);
    if (status === "CANCELLED" || status === "CLOSED") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_CRCP_STATUS_LOCKED", 400, "CRCP cannot be changed on a Cancelled or Closed PO.");
    }

    const ownCompanyId = toTrimmedString(po.company_id);
    const shareCompanyIds = companyIds.filter((id) => id !== ownCompanyId);

    const { error: headerError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order")
      .update({ crcp_enabled: crcpEnabled, last_updated_at: new Date().toISOString() })
      .eq("id", poId);
    if (headerError) {
      throw new Error("PROCUREMENT_PO_CRCP_UPDATE_FAILED");
    }

    const { error: deleteError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order_crcp_company")
      .delete()
      .eq("po_id", poId);
    if (deleteError) {
      throw new Error("PROCUREMENT_PO_CRCP_UPDATE_FAILED");
    }

    if (crcpEnabled && shareCompanyIds.length > 0) {
      const { error: insertError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("purchase_order_crcp_company")
        .insert(shareCompanyIds.map((companyId) => ({
          po_id: poId,
          company_id: companyId,
          created_by: ctx.auth_user_id,
        })));
      if (insertError) {
        throw new Error("PROCUREMENT_PO_CRCP_UPDATE_FAILED");
      }
    }

    return okResponse({
      data: { id: poId, crcp_enabled: crcpEnabled, crcp_company_ids: crcpEnabled ? shareCompanyIds : [] },
    }, ctx.request_id, req);
  } catch (err) {
    console.error("PO_SET_CRCP_HANDLER_ERROR", err);
    const code = (err as Error).message || "PROCUREMENT_PO_CRCP_UPDATE_FAILED";
    const status = code === "PROCUREMENT_PO_NOT_FOUND" ? 404 : code === "COMPANY_SCOPE_VIOLATION" ? 403 : code === "PROCUREMENT_PO_CRCP_STATUS_LOCKED" ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order CRCP update failed");
  }
}

export async function setPoEffectiveDateHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const poId = getPoIdFromPath(req);
    const body = await parseBody(req);
    const effectiveStartDate = toTrimmedString(body.effective_start_date);
    if (!effectiveStartDate) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_EFFECTIVE_DATE_REQUIRED", 400, "Effective Start Date is required.");
    }

    const po = await getPOById(poId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    if (toUpperTrimmedString(po.delivery_type) !== "BULK") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_EFFECTIVE_DATE_BULK_ONLY", 400, "Effective Start Date only applies to Bulk delivery type.");
    }
    try {
      await assertCompanyScope(ctx, toTrimmedString(po.company_id));
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    const canEdit = await canMaintainPoCrcp(ctx, toTrimmedString(po.company_id));
    if (!canEdit) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_EFFECTIVE_DATE_FORBIDDEN", 403, "You do not have edit access to this purchase order's company.");
    }
    const status = toUpperTrimmedString(po.status);
    if (status === "CANCELLED" || status === "CLOSED") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_EFFECTIVE_DATE_STATUS_LOCKED", 400, "Effective Start Date cannot be changed on a Cancelled or Closed PO.");
    }

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order")
      .update({ effective_start_date: effectiveStartDate, last_updated_at: new Date().toISOString() })
      .eq("id", poId);
    if (error) {
      throw new Error("PROCUREMENT_EFFECTIVE_DATE_UPDATE_FAILED");
    }

    return okResponse({ data: { id: poId, effective_start_date: effectiveStartDate } }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_EFFECTIVE_DATE_UPDATE_FAILED";
    const status = code === "PROCUREMENT_PO_NOT_FOUND" ? 404
      : (code === "COMPANY_SCOPE_VIOLATION" || code === "PROCUREMENT_EFFECTIVE_DATE_FORBIDDEN") ? 403
      : (code.includes("REQUIRED") || code.includes("BULK_ONLY") || code.includes("STATUS_LOCKED")) ? 400
      : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order effective date update failed");
  }
}

// §3.7 "Bulk PO/STO — Effective Date + Cutoff mechanism" — a Bulk PO/STO with no
// successor (same vendor+company+material, later effective_start_date) must not
// knock off unbounded; the caller must supply a cutoff_date at that moment instead.
// Returns an error-code string to bubble up, or null if the cutoff requirement is
// satisfied (either not applicable, a successor already exists, or cutoff_date was
// supplied and persisted).
async function resolveBulkCutoffRequirement(
  poId: string,
  companyId: string,
  vendorId: string,
  materialId: string,
  deliveryType: string,
  cutoffDateInput: string,
): Promise<string | null> {
  if (deliveryType !== "BULK") return null;

  const { data: successor } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order")
    .select("id, purchase_order_line!inner(material_id), effective_start_date")
    .eq("company_id", companyId)
    .eq("vendor_id", vendorId)
    .eq("purchase_order_line.material_id", materialId)
    .neq("id", poId)
    .not("effective_start_date", "is", null)
    .order("effective_start_date", { ascending: true })
    .limit(50);

  const currentPo = await getPOById(poId);
  const currentEffectiveDate = toTrimmedString(currentPo?.effective_start_date);
  const hasSuccessor = (successor ?? []).some(
    (row: JsonRecord) => currentEffectiveDate && String(row.effective_start_date) > currentEffectiveDate,
  );
  if (hasSuccessor) return null;

  if (!cutoffDateInput) {
    return "PROCUREMENT_BULK_CUTOFF_DATE_REQUIRED";
  }

  const { error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order")
    .update({ cutoff_date: cutoffDateInput })
    .eq("id", poId);
  if (error) {
    return "PROCUREMENT_BULK_CUTOFF_DATE_UPDATE_FAILED";
  }
  return null;
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

async function syncOrderGroupStatus(groupId: string, actionedBy: string): Promise<void> {
  if (!groupId) {
    return;
  }

  const group = await getOrderGroupById(groupId);
  if (!group) {
    return;
  }

  const pos = await getOrderGroupPOs(groupId);
  if (pos.length === 0) {
    return;
  }

  const statuses = pos.map((po) => toUpperTrimmedString(po.status));
  const allCancelled = statuses.every((status) => status === "CANCELLED");
  const allTerminal = statuses.every((status) => status === "CONFIRMED" || status === "CANCELLED" || status === "CLOSED");
  const hasConfirmedLike = statuses.some((status) => status === "CONFIRMED" || status === "CLOSED");
  const hasPendingApproval = statuses.some((status) => status === "PENDING_APPROVAL");

  const nextStatus = allCancelled
    ? "CANCELLED"
    : allTerminal && hasConfirmedLike
      ? "CONFIRMED"
      : hasPendingApproval
        ? "PENDING_APPROVAL"
        : "DRAFT";

  if (toUpperTrimmedString(group.status) === nextStatus) {
    return;
  }

  const { error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("po_order_group")
    .update({
      status: nextStatus,
      last_updated_at: new Date().toISOString(),
      last_updated_by: actionedBy,
    })
    .eq("id", groupId);

  if (error) {
    throw new Error("PROCUREMENT_PO_ORDER_GROUP_SYNC_FAILED");
  }
}

export async function listPOOrderGroupsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? "");
    const statusFilter = toUpperTrimmedString(url.searchParams.get("status"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);
    const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("po_order_group")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (companyId) {
      query = query.eq("company_id", companyId);
    }
    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query;
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

    const enrichedGroups = groups.map((group) => ({
      ...group,
      doc_type: "PO",
      purchase_orders: poByGroup.get(toTrimmedString(group.id)) ?? [],
    }));

    let stoQuery = serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .select("id, sto_number, status, sending_company_id, receiving_company_id, created_at, created_by")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (companyId) {
      stoQuery = stoQuery.or(`sending_company_id.eq.${companyId},receiving_company_id.eq.${companyId}`);
    }
    if (statusFilter) {
      stoQuery = stoQuery.eq("status", statusFilter);
    }

    const { data: stoRows, error: stoError } = await stoQuery;
    if (stoError) {
      throw new Error("PROCUREMENT_PO_ORDER_GROUP_LIST_FAILED");
    }

    const stos = (stoRows as Array<Record<string, unknown>> | null) ?? [];
    const companyIds = uniqueTrimmedStrings([
      ...stos.map((row) => row.sending_company_id),
      ...stos.map((row) => row.receiving_company_id),
    ]);
    const { data: companyRows, error: companyError } = companyIds.length > 0
      ? await serviceRoleClient
        .schema("erp_master")
        .from("companies")
        .select("id, company_code, company_name")
        .in("id", companyIds)
      : { data: [], error: null };

    if (companyError) {
      throw new Error("PROCUREMENT_PO_ORDER_GROUP_LIST_FAILED");
    }

    const companyLabelById = new Map<string, string>(
      (((companyRows as Array<Record<string, unknown>> | null) ?? []).map((row) => [
        toTrimmedString(row.id),
        toTrimmedString(row.company_name) || toTrimmedString(row.company_code) || toTrimmedString(row.id),
      ])),
    );

    const enrichedStos = stos.map((sto) => {
      const sendingCompanyId = toTrimmedString(sto.sending_company_id);
      const receivingCompanyId = toTrimmedString(sto.receiving_company_id);
      const sendingLabel = companyLabelById.get(sendingCompanyId) ?? sendingCompanyId;
      const receivingLabel = companyLabelById.get(receivingCompanyId) ?? receivingCompanyId;
      return {
        ...sto,
        doc_type: "STO",
        company_id: sendingCompanyId,
        vendor_id: `${sendingLabel} -> ${receivingLabel}`,
        purchase_orders: [{ id: sto.id, po_number: sto.sto_number, status: sto.status }],
      };
    });

    const merged = [...enrichedGroups, ...enrichedStos]
      .sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")));
    const paged = merged.slice(offset, offset + limit);

    return okResponse({
      data: await enrichProcurementUserDisplays(paged),
      total: merged.length,
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_ORDER_GROUP_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, "Purchase order group list failed");
  }
}

export async function getPOOrderGroupHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const groupId = getOrderGroupIdFromPath(req);
    const group = await getOrderGroupById(groupId);
    if (!group) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_ORDER_GROUP_NOT_FOUND", 404, "Order group not found");
    }
    try {
      await assertCompanyScope(ctx, toTrimmedString(group.company_id));
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const pos = await getOrderGroupPOs(groupId);
    const posWithLines = await Promise.all(
      pos.map(async (po) => ({ ...po, lines: await getPOLines(toTrimmedString(po.id)) })),
    );

    // Bulk-resolve material/cost-center/payment-term display names across
    // every line in every PO in this group — never show raw UUIDs.
    const allLines = posWithLines.flatMap((po) => po.lines);
    const { lines: enrichedLines } = await enrichPoReferenceDisplays({ lines: allLines });
    const enrichedLineById = new Map(
      (enrichedLines ?? []).map((line) => [toTrimmedString(line.id), line]),
    );
    // Section 145 -- lots per PO, so the approver sees exactly which lot is awaiting approval.
    const lotsByPoId = await loadLotsByPoId(
      (posWithLines as unknown as JsonRecord[]).filter((po) => po.order_in_lot === true).map((po) => toTrimmedString(po.id)),
    );
    const posWithEnrichedLines = posWithLines.map((po) => ({
      ...po,
      lines: po.lines.map((line) => enrichedLineById.get(toTrimmedString(line.id)) ?? line),
      lots: lotsByPoId.get(toTrimmedString((po as unknown as JsonRecord).id)) ?? [],
    }));

    const groupVendorId = toTrimmedString(group.vendor_id);
    const { data: vendorRow } = groupVendorId
      ? await serviceRoleClient
        .schema("erp_master")
        .from("vendor_master")
        .select("vendor_code, vendor_name")
        .eq("id", groupVendorId)
        .maybeSingle()
      : { data: null };
    const vendorDisplay = vendorRow ? formatCodeNameDisplay(vendorRow.vendor_code, vendorRow.vendor_name) : null;

    // Lets the "Approve Order" screen ask for a CSN decision (Yes/No) before
    // calling approve, instead of the approve call failing first with
    // PROCUREMENT_CSN_DECISION_REQUIRED -- see approvePOOrderGroupHandler's
    // own comment for why only an ordered_qty increase is ever relevant here.
    const pendingPoIds = posWithEnrichedLines
      .filter((po) => toUpperTrimmedString(po.status) === "PENDING_APPROVAL")
      .map((po) => toTrimmedString(po.id));
    const pendingAmendmentRows = await getPendingAmendmentRows(pendingPoIds);
    const poNumberById = new Map(posWithEnrichedLines.map((po) => [toTrimmedString(po.id), toTrimmedString(po.po_number)]));
    const lineDisplayById = new Map(
      posWithEnrichedLines.flatMap((po) => po.lines).map((line) => [toTrimmedString(line.id), toTrimmedString(line.material_display)]),
    );
    const pendingQtyIncreaseAmendments = pendingAmendmentRows
      .filter(isQtyIncreaseAmendment)
      .map((row) => ({
        po_id: row.po_id,
        po_number: poNumberById.get(row.po_id) ?? null,
        po_line_id: row.po_line_id,
        material_display: lineDisplayById.get(toTrimmedString(row.po_line_id)) ?? null,
        old_value: row.old_value,
        new_value: row.new_value,
        delta_qty: Number((Number(row.new_value ?? 0) - Number(row.old_value ?? 0)).toFixed(6)),
      }));

    const pendingLotAmendments = (posWithEnrichedLines as unknown as JsonRecord[]).flatMap((po) =>
      (po.lots as JsonRecord[])
        .filter((lot) => toUpperTrimmedString(lot.status) === "PENDING")
        .map((lot) => ({
          po_id: toTrimmedString(po.id),
          po_number: toTrimmedString(po.po_number),
          material_display: lineDisplayById.get(toTrimmedString(lot.po_line_id)) ?? null,
          lot_number: lot.lot_number,
          lot_qty: lot.lot_qty,
          delivery_date: lot.delivery_date,
        })));

    return okResponse({
      data: await enrichProcurementUserDisplays({
        ...group,
        vendor_display: vendorDisplay,
        purchase_orders: posWithEnrichedLines,
        pending_qty_increase_amendments: pendingQtyIncreaseAmendments,
        pending_lot_amendments: pendingLotAmendments,
      }),
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_ORDER_GROUP_DETAIL_FAILED";
    const status = code === "PROCUREMENT_PO_ORDER_GROUP_NOT_FOUND" ? 404 : code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500;
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
    const group = await getOrderGroupById(groupId);
    if (!group) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_ORDER_GROUP_NOT_FOUND", 404, "Order group not found");
    }
    try {
      await assertCompanyScope(ctx, toTrimmedString(group.company_id));
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
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

    return okResponse({
      data: await enrichProcurementUserDisplays({
        ...updatedGroup,
        purchase_orders: await getOrderGroupPOs(groupId),
      }),
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_ORDER_GROUP_CONFIRM_FAILED";
    const status = code === "PROCUREMENT_PO_ORDER_GROUP_NOT_FOUND" ? 404 : code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("BLOCKED") ? 422 : 500;
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
    const group = await getOrderGroupById(groupId);
    if (!group) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_ORDER_GROUP_NOT_FOUND", 404, "Order group not found");
    }
    try {
      await assertCompanyScope(ctx, toTrimmedString(group.company_id));
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
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

    // Same amendment-vs-first-approval split as approvePOHandler -- see
    // createCsnsForQtyIncreaseAmendments's comment. A single group approve
    // can bundle a PO's first-ever confirm together with another PO's
    // amendment re-approval, so this is worked out per PO below, but the
    // create_csn_for_qty_increase decision itself is one Yes/No for the
    // whole batch (matches the single confirm-order action the approver
    // is taking).
    const pendingPoIds = pendingPos.map((po) => toTrimmedString(po.id));
    const pendingAmendmentRows = await getPendingAmendmentRows(pendingPoIds);
    const qtyIncreaseRows = pendingAmendmentRows.filter(isQtyIncreaseAmendment);
    if (qtyIncreaseRows.length > 0 && typeof body.create_csn_for_qty_increase !== "boolean") {
      return procurementErrorResponse(
        req,
        ctx,
        "PROCUREMENT_CSN_DECISION_REQUIRED",
        400,
        "Specify whether to create a CSN for the increased quantity",
      );
    }
    const amendmentRowsByPoId = new Map<string, PoAmendmentLogRow[]>();
    for (const row of pendingAmendmentRows) {
      const key = toTrimmedString(row.po_id);
      const list = amendmentRowsByPoId.get(key) ?? [];
      list.push(row);
      amendmentRowsByPoId.set(key, list);
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

      // Section 145 -- a pending Lot Amend becomes real only now.
      await activatePendingPoLots([poId], ctx.auth_user_id);

      const poAmendmentRows = amendmentRowsByPoId.get(poId) ?? [];
      if (poAmendmentRows.length > 0) {
        await markAmendmentRowsApproved(poAmendmentRows.map((row) => row.id), ctx.auth_user_id);
        const poQtyIncreaseRows = poAmendmentRows.filter(isQtyIncreaseAmendment);
        if (poQtyIncreaseRows.length > 0 && body.create_csn_for_qty_increase === true) {
          await createCsnsForQtyIncreaseAmendments(updatedPo as PurchaseOrderRow, await getPOLines(poId), poQtyIncreaseRows, ctx.auth_user_id);
        }
      } else {
        await createCsnsForPo(updatedPo as PurchaseOrderRow, await getPOLines(poId), ctx.auth_user_id);
      }
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

    return okResponse({
      data: await enrichProcurementUserDisplays({
        ...updatedGroup,
        purchase_orders: await getOrderGroupPOs(groupId),
      }),
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_ORDER_GROUP_APPROVE_FAILED";
    const status =
      code === "PROCUREMENT_PO_ORDER_GROUP_NOT_FOUND" ? 404
        : code === "PROCUREMENT_HEAD_REQUIRED" || code === "PROCUREMENT_SELF_APPROVAL_FORBIDDEN" || code === "COMPANY_SCOPE_VIOLATION" ? 403
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

    const group = await getOrderGroupById(groupId);
    if (!group) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_ORDER_GROUP_NOT_FOUND", 404, "Order group not found");
    }
    try {
      await assertCompanyScope(ctx, toTrimmedString(group.company_id));
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    await assertProcurementHeadRole(ctx, toTrimmedString(group.company_id), toTrimmedString(group.created_by));
    if (toUpperTrimmedString(group.status) !== "PENDING_APPROVAL") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_ORDER_GROUP_APPROVAL_STATE_INVALID", 422, "Order group is not pending approval");
    }

    const pos = await getOrderGroupPOs(groupId);
    const pendingPos = pos.filter((po) => toUpperTrimmedString(po.status) === "PENDING_APPROVAL");
    const nowIso = new Date().toISOString();

    // Section 145 -- a PO whose pending item is a Lot Amend returns to CONFIRMED, not DRAFT.
    const lotRejectedPoIds = await rejectPendingPoLots(
      pendingPos.map((po) => toTrimmedString(po.id)),
      ctx.auth_user_id,
      remarks,
    );

    for (const po of pendingPos) {
      const poId = toTrimmedString(po.id);
      if (lotRejectedPoIds.has(poId)) continue;
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

    if (lotRejectedPoIds.size > 0) {
      await syncOrderGroupStatus(groupId, ctx.auth_user_id);
      return okResponse({
        data: await enrichProcurementUserDisplays({
          ...((await getOrderGroupById(groupId)) ?? group),
          purchase_orders: await getOrderGroupPOs(groupId),
        }),
      }, ctx.request_id, req);
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

    return okResponse({
      data: await enrichProcurementUserDisplays({
        ...updatedGroup,
        purchase_orders: await getOrderGroupPOs(groupId),
      }),
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_ORDER_GROUP_REJECT_FAILED";
    const status =
      code === "PROCUREMENT_PO_ORDER_GROUP_NOT_FOUND" ? 404
        : code === "PROCUREMENT_HEAD_REQUIRED" || code === "PROCUREMENT_SELF_APPROVAL_FORBIDDEN" || code === "COMPANY_SCOPE_VIOLATION" ? 403
        : code.includes("REQUIRED") ? 400
        : code.includes("INVALID") ? 422
        : 500;
    return procurementErrorResponse(req, ctx, code, status, "Purchase order group rejection failed");
  }
}

// ── Section 145 — Lot Amend ──────────────────────────────────────────────────
// POST /api/procurement/purchase-orders/:id/lots
// Body: { lots: [{ po_line_id?, qty, delivery_date }], remarks? }  (po_line_id optional when the PO has one line)
// Adds PENDING lots and sends the PO for approval in one transaction (erp_procurement.add_po_lots).
// Nothing about the PO line changes until approval (activate_pending_po_lots).
const LOT_AMEND_ERROR_STATUS: Record<string, number> = {
  PROCUREMENT_PO_NOT_FOUND: 404,
  PROCUREMENT_PO_LINE_NOT_FOUND: 404,
  PROCUREMENT_PO_NOT_LOT_ORDER: 422,
  PROCUREMENT_PO_LOT_AMEND_BLOCKED: 422,
  PROCUREMENT_LOT_AMEND_PENDING: 422,
  PROCUREMENT_LOT_NUMBER_EXHAUSTED: 422,
  PROCUREMENT_LOT_REQUIRED: 400,
  PROCUREMENT_LOT_QTY_INVALID: 400,
  PROCUREMENT_LOT_DELIVERY_DATE_REQUIRED: 400,
  COMPANY_SCOPE_VIOLATION: 403,
};

export async function addPoLotsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const poId = getPoIdFromPath(req);
    const body = await parseBody(req);
    const po = await getPOById(poId);
    if (!po) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_FOUND", 404, "Purchase order not found");
    }
    try {
      await assertCompanyScope(ctx, toTrimmedString(po.company_id));
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const rawLots = Array.isArray(body.lots) ? (body.lots as JsonRecord[]) : [];
    if (rawLots.length === 0) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_LOT_REQUIRED", 400, "Add at least one lot.");
    }
    const lines = await getPOLines(poId);
    const lots: JsonRecord[] = [];
    for (const raw of rawLots) {
      const poLineId = toTrimmedString(raw.po_line_id) || (lines.length === 1 ? toTrimmedString(lines[0].id) : "");
      const qty = parsePositiveNumber(raw.qty);
      const deliveryDate = toTrimmedString(raw.delivery_date);
      if (!poLineId) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_LINE_NOT_FOUND", 404, "PO line is required for a lot.");
      }
      if (!qty) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_LOT_QTY_INVALID", 400, "Every lot needs a quantity greater than zero.");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_LOT_DELIVERY_DATE_REQUIRED", 400, "Every lot needs a delivery date.");
      }
      lots.push({ po_line_id: poLineId, qty, delivery_date: deliveryDate });
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .rpc("add_po_lots", {
        p_po_id: poId,
        p_actor: ctx.auth_user_id,
        p_lots: lots,
        p_remarks: toTrimmedString(body.remarks) || null,
      });
    if (error) {
      const code = toTrimmedString(error.message);
      if (code in LOT_AMEND_ERROR_STATUS) {
        return procurementErrorResponse(req, ctx, code, LOT_AMEND_ERROR_STATUS[code], "Lot amend failed");
      }
      console.error("PO_LOT_ADD_ERROR", JSON.stringify(error));
      throw new Error("PROCUREMENT_LOT_ADD_FAILED");
    }

    const orderGroupId = toTrimmedString(po.order_group_id);
    if (orderGroupId) {
      await syncOrderGroupStatus(orderGroupId, ctx.auth_user_id);
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_LOT_ADD_FAILED";
    const status = code in LOT_AMEND_ERROR_STATUS ? LOT_AMEND_ERROR_STATUS[code] : 500;
    return procurementErrorResponse(req, ctx, code, status, "Lot amend failed");
  }
}

// GET /api/procurement/po-lot-orders?company_id=&is_opening=true|false
// The Lot Amend list: every Order in LOT PO of the company that is live (CONFIRMED, or waiting for
// approval) and not knocked off / cancelled. is_opening splits PO from Legacy PO (is_opening_po).
// Response has NO pagination key (bug pattern #15): fetchProcurement hands the caller the bare array.
export async function listLotOrdersHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);

    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, toTrimmedString(url.searchParams.get("company_id")));
    if (!companyId) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_COMPANY_REQUIRED", 400, "Company is required");
    }
    const isOpening = toTrimmedString(url.searchParams.get("is_opening")).toLowerCase();

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order")
      .select("id, po_number, po_date, status, vendor_id, is_opening_po, order_group_id, effective_start_date, cutoff_date")
      .eq("company_id", companyId)
      .eq("order_in_lot", true)
      .in("status", ["CONFIRMED", "PENDING_APPROVAL"])
      .order("po_date", { ascending: false })
      .limit(1000);
    if (isOpening === "true" || isOpening === "false") {
      query = query.eq("is_opening_po", isOpening === "true");
    }
    const { data: poData, error: poError } = await query;
    if (poError) {
      throw new Error("PROCUREMENT_LOT_ORDER_LIST_FAILED");
    }
    const pos = (poData as JsonRecord[] | null) ?? [];
    const poIds = pos.map((po) => toTrimmedString(po.id));
    if (poIds.length === 0) {
      return okResponse({ data: [] }, ctx.request_id, req);
    }

    let lineRows: JsonRecord[];
    let vendorRows: JsonRecord[];
    try {
      lineRows = await fetchInChunks<JsonRecord>(poIds, (idChunk) =>
        serviceRoleClient
          .schema("erp_procurement")
          .from("purchase_order_line")
          .select("id, po_id, material_id, po_uom_code, unit_rate, ordered_qty, open_qty, line_status")
          .in("po_id", idChunk));
      vendorRows = await fetchInChunks<JsonRecord>(
        uniqueTrimmedStrings(pos.map((po) => po.vendor_id)),
        (idChunk) =>
          serviceRoleClient
            .schema("erp_master")
            .from("vendor_master")
            .select("id, vendor_code, vendor_name")
            .in("id", idChunk));
    } catch {
      throw new Error("PROCUREMENT_LOT_ORDER_LIST_FAILED");
    }
    const { lines: displayLines } = await enrichPoReferenceDisplays({ lines: lineRows });
    const lineByPoId = new Map<string, JsonRecord>();
    for (const line of (displayLines ?? lineRows)) {
      const status = toUpperTrimmedString(line.line_status);
      if (status === "KNOCKED_OFF" || status === "CANCELLED") continue;
      lineByPoId.set(toTrimmedString(line.po_id), line);
    }
    const vendorById = new Map(vendorRows.map((row) => [toTrimmedString(row.id), row]));
    const lotsByPoId = await loadLotsByPoId(poIds);

    const rows = pos
      .filter((po) => lineByPoId.has(toTrimmedString(po.id)))
      .map((po) => {
        const poId = toTrimmedString(po.id);
        const line = lineByPoId.get(poId) as JsonRecord;
        const lots = lotsByPoId.get(poId) ?? [];
        const activeLots = lots.filter((lot) => toUpperTrimmedString(lot.status) === "ACTIVE");
        const vendor = vendorById.get(toTrimmedString(po.vendor_id));
        const orderedQty = Number(line.ordered_qty ?? 0);
        const openQty = Number(line.open_qty ?? 0);
        return {
          id: poId,
          po_number: po.po_number,
          po_date: po.po_date,
          status: po.status,
          is_opening_po: po.is_opening_po === true,
          order_group_id: po.order_group_id,
          vendor_display: vendor ? formatCodeNameDisplay(vendor.vendor_code, vendor.vendor_name) : null,
          material_display: line.material_display ?? null,
          po_uom_code: line.po_uom_code,
          unit_rate: line.unit_rate,
          ordered_qty: orderedQty,
          received_qty: Number(Math.max(orderedQty - openQty, 0).toFixed(6)),
          balance_qty: openQty,
          line_status: line.line_status,
          lot_count: activeLots.length,
          last_lot_number: activeLots.length > 0 ? activeLots[activeLots.length - 1].lot_number : null,
          has_pending_lot: lots.some((lot) => toUpperTrimmedString(lot.status) === "PENDING"),
          effective_start_date: po.effective_start_date,
          cutoff_date: po.cutoff_date,
        };
      });

    return okResponse({ data: rows }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_LOT_ORDER_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, "Lot order list failed");
  }
}

// §110 — reusable "UoM Quantity Picker" data source (GRN/PO line entry, Phase A/B).
// Deliberately NOT reusing OM's listMaterialUomConversionsHandler
// (assertManagerOrSARole) — L1/L2 procurement staff create GRN/PO, not just
// managers, so a manager-only gate here would 403 the exact users this is for.
export async function listMaterialUomConversionsForProcurementHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const materialId = (url.searchParams.get("material_id") ?? "").trim();
    if (!materialId) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_UOM_CONVERSION_MATERIAL_REQUIRED", 400, "material_id is required.");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_uom_conversion")
      .select("from_uom_code, to_uom_code, conversion_factor, variable_conversion")
      .eq("material_id", materialId)
      .eq("active", true);
    if (error) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_UOM_CONVERSION_LOOKUP_FAILED", 500, error.message);
    }

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_UOM_CONVERSION_LOOKUP_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "UOM conversion lookup failed");
  }
}
