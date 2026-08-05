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
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { pickScopedApproverRules } from "../../_shared/workflow_scope.ts";
import { hasBlanketApprovalOverride } from "../../_shared/approval_override.ts";
import { recalculateAndBuildUpdates } from "./csn.handlers.ts";

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
    .select("approver_user_id, approver_role_code, resource_code, action_code, scope_type, subject_user_id, subject_work_context_id, subject_role_code, approval_stage")
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

function matchesApprover(rows: ApproverMapRow[], ctx: ProcurementHandlerContext): boolean {
  return rows.some((row) => {
    if (row.approver_user_id) return row.approver_user_id === ctx.auth_user_id;
    if (row.approver_role_code) return row.approver_role_code === ctx.roleCode;
    return false;
  });
}

// Creator-specific approval chains (e.g. "if X submits, Y or Z approves") use
// the same scope_type/subject_user_id columns HR's workflow engine already
// relies on (see _shared/workflow_scope.ts) — pickScopedApproverRules narrows
// the raw approver_map rows down to the ones that actually apply to this PO's
// creator (USER_EXCEPTION rows take priority) before the flat matchesApprover
// check runs. A company that has configured rows but none scoped to this
// particular creator falls back to DIRECTOR, same as the fully-unconfigured
// case — so a plain company-wide/DIRECTOR-only setup keeps working untouched.
async function assertProcurementHeadRole(
  ctx: ProcurementHandlerContext,
  companyId: string,
  createdBy?: string | null,
): Promise<void> {
  if (hasBlanketApprovalOverride(ctx)) {
    return; // SA/GA always retain override authority, regardless of approver_map config.
  }

  const rules = await loadPoApproverRules(companyId);
  let isConfiguredApprover: boolean;

  if (rules.length === 0) {
    isConfiguredApprover = hasBlanketApprovalOverride(ctx); // no approver_map row configured yet — fall back to blanket override approvers.
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
      ? matchesApprover(scopedRules, ctx)
      : hasBlanketApprovalOverride(ctx); // configured rows exist, but none scoped to this creator — fall back to blanket override approvers.
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
  const { data: existingRows, error: existingError } = lineIds.length > 0
    ? await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select("po_line_id")
      .in("po_line_id", lineIds)
    : { data: [], error: null };

  if (existingError) {
    throw new Error("PROCUREMENT_CSN_LOOKUP_FAILED");
  }

  const existingLineIds = new Set(
    (((existingRows as Array<Record<string, unknown>> | null) ?? []).map((row) =>
      toTrimmedString(row.po_line_id)
    )).filter(Boolean),
  );
  const materialCategoryByMaterialId = await getPrimaryMaterialCategoryIds(
    poLines.map((line) => toTrimmedString(line.material_id)),
  );

  await Promise.all(
    poLines
      .filter((line) => !existingLineIds.has(toTrimmedString(line.id)))
      .map(async (line) => {
        const csnNumber = await generateProcurementDocNumber("CSN");
        const orderedQty = Number(line.ordered_qty ?? 0);
        const materialId = toTrimmedString(line.material_id);
        const materialCategoryId = materialCategoryByMaterialId.get(materialId) ?? null;
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
            po_qty: orderedQty,
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
      }),
  );
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
    const poDate = toTrimmedString(body.po_date) || new Date().toISOString().slice(0, 10);
    const isOpeningPo = body.is_opening_po === true;
    const openingPoNumber = toTrimmedString(body.po_number);
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
      .select("id, company_code, company_name")
      .eq("company_kind", "BUSINESS")
      .eq("status", "ACTIVE")
      .order("company_name", { ascending: true });
    if (companyIds !== null && companyIds.length > 0) companyQuery = companyQuery.in("id", companyIds);

    let vendorQuery = serviceRoleClient.schema("erp_master").from("vendor_master")
      .select("id, vendor_code, vendor_name, vendor_type, indent_number_required")
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
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? "");
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

    const enrichedList = await enrichPoReferenceDisplays({ pos: (data as PurchaseOrderRow[] | null) ?? [] });

    return okResponse({
      data: await enrichProcurementUserDisplays(enrichedList.pos ?? []),
      total: count ?? 0,
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_PO_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, "Purchase order list failed");
  }
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

    return okResponse({
      data: await enrichProcurementUserDisplays({
        ...(enrichedDetail.po ?? po),
        lines: enrichedDetail.lines ?? lines,
        approval_log: approvalLogResult.data ?? [],
        amendment_log: amendmentLogResult.data ?? [],
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
    if (toUpperTrimmedString(po.status) !== "DRAFT") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_NOT_DRAFT", 422, "Only DRAFT PO can be updated");
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
      } else if (fieldName === "delivery_type") {
        const deliveryType = toUpperTrimmedString(normalizedValue);
        if (!DELIVERY_TYPES.has(deliveryType)) {
          return procurementErrorResponse(req, ctx, "PROCUREMENT_INVALID_DELIVERY_TYPE", 400, "Invalid delivery type");
        }
        headerUpdates.delivery_type = deliveryType;
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
    const posWithEnrichedLines = posWithLines.map((po) => ({
      ...po,
      lines: po.lines.map((line) => enrichedLineById.get(toTrimmedString(line.id)) ?? line),
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

    return okResponse({
      data: await enrichProcurementUserDisplays({
        ...group,
        vendor_display: vendorDisplay,
        purchase_orders: posWithEnrichedLines,
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
