/*
 * File-ID: 27.1
 * File-Path: supabase/functions/api/_core/production/stroke_master.handlers.ts
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Stroke Master CRUD, approve, deactivate and reject handlers.
 *          QA/Operator creates (DRAFT), Manager/Auditor approves (APPROVED) or
 *          rejects (hard delete). APPROVED strokes can be deactivated (terminal,
 *          hidden from Process PO dropdown) or reverted to DRAFT for correction.
 *          See feasibility doc Section 83.3 (revised 2026-06-30).
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
import { okResponse, errorResponse } from "../response.ts";
import { hasBlanketApprovalOverride } from "../../_shared/approval_override.ts";
import { assertCompanyScope, isCompanyScopeAdminBypass } from "../../_shared/companyScope.ts";
import { pickScopedApproverRules } from "../../_shared/workflow_scope.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import {
  assertProdReadRole,
  parseBody,
  toTrimmedString,
  toUpperTrimmedString,
  getIdFromPath,
} from "./production.shared.ts";

type JsonRecord = Record<string, unknown>;

const MATERIAL_TYPES = new Set(["SFG", "INT"]);
const PO_TYPES_BY_MATERIAL_TYPE: Record<string, Set<string>> = {
  SFG: new Set(["MTO", "HPS", "MTS", "MTEST"]),
  INT: new Set(["INT"]),
};
const LINE_MATERIAL_TYPES = new Set(["RM", "INT"]);

function strokeError(
  req: Request,
  ctx: ProdHandlerContext,
  code: string,
  status: number,
  msg: string,
): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

// PostgREST's select parser does not support the alias:schema.table!fk(...)
// cross-schema embed syntax (PGRST100 "failed to parse select parameter") —
// batch-fetch related rows by id and merge in JS instead.
async function getMaterialMapByIds(ids: string[]): Promise<Map<string, JsonRecord>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (uniqueIds.length === 0) return map;

  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, pace_code, material_name, shade_code, pack_code, base_uom_code")
    .in("id", uniqueIds);
  if (error) {
    console.error("[stroke_master.getMaterialMapByIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_STROKE_MATERIAL_BATCH_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

async function getMaterialGroupMapByIds(ids: string[]): Promise<Map<string, JsonRecord>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (uniqueIds.length === 0) return map;

  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_category_group")
    .select("id, group_code, group_name")
    .in("id", uniqueIds);
  if (error) {
    console.error("[stroke_master.getMaterialGroupMapByIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_STROKE_GROUP_BATCH_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

async function getMaterialGroupMembersByGroupIds(groupIds: string[]): Promise<Map<string, JsonRecord[]>> {
  const uniqueIds = [...new Set(groupIds.filter(Boolean))];
  const map = new Map<string, JsonRecord[]>();
  if (uniqueIds.length === 0) return map;

  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_category_group_member")
    .select("id, group_id, material_id, is_primary")
    .in("group_id", uniqueIds);
  if (error) {
    console.error("[stroke_master.getMaterialGroupMembersByGroupIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_STROKE_GROUP_BATCH_FAILED");
  }

  for (const row of (data ?? []) as JsonRecord[]) {
    const groupId = String(row.group_id ?? "");
    if (!groupId) continue;
    const existing = map.get(groupId) ?? [];
    existing.push(row);
    map.set(groupId, existing);
  }
  return map;
}

async function getStorageLocationMapByIds(ids: string[]): Promise<Map<string, JsonRecord>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (uniqueIds.length === 0) return map;

  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_master")
    .select("id, code, name")
    .in("id", uniqueIds);
  if (error) {
    console.error("[stroke_master.getStorageLocationMapByIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_STROKE_SLOC_BATCH_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

async function listStrokeScopedCompanyIds(ctx: ProdHandlerContext): Promise<string[] | null> {
  if (isCompanyScopeAdminBypass(ctx)) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", ctx.auth_user_id);
  if (error) throw new Error("PROD_STROKE_SCOPE_LOOKUP_FAILED");
  return [...new Set(((data ?? []) as JsonRecord[]).map((row) => String(row.company_id ?? "")).filter(Boolean))];
}

async function getStrokeMaster(id: string): Promise<JsonRecord | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("stroke_master")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[stroke_master.getStrokeMaster] lookup failed:", JSON.stringify(error));
    throw new Error("PROD_STROKE_LOOKUP_FAILED");
  }
  return (data as JsonRecord | null) ?? null;
}

interface ApproverMapRow {
  approver_user_id: string | null;
  approver_role_code: string | null;
  resource_code: string | null;
  action_code: string | null;
  scope_type: string | null;
  subject_user_id: string | null;
  subject_work_context_id: string | null;
  subject_role_code: string | null;
  approval_stage: number;
}

async function loadStrokeApproverRules(companyId: string): Promise<ApproverMapRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("acl")
    .from("approver_map")
    .select(
      "approver_user_id, approver_role_code, resource_code, action_code, scope_type, subject_user_id, subject_work_context_id, subject_role_code, approval_stage",
    )
    .eq("resource_code", "PROD_STROKE_APPROVAL")
    .eq("action_code", "APPROVE")
    .eq("company_id", companyId);
  if (error) throw new Error("PROD_STROKE_APPROVER_LOOKUP_FAILED");
  return (data as ApproverMapRow[] | null) ?? [];
}

async function getStrokeUserRoleCode(userId: string): Promise<string | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_acl")
    .from("user_roles")
    .select("role_code")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return String((data as Record<string, unknown>).role_code ?? "") || null;
}

function matchesStrokeApprover(rows: ApproverMapRow[], ctx: ProdHandlerContext): boolean {
  return rows.some((row) => {
    if (row.approver_user_id) return row.approver_user_id === ctx.auth_user_id;
    if (row.approver_role_code) return row.approver_role_code === ctx.roleCode;
    return false;
  });
}

// QA/Operator (L1-L4 User) creates a Stroke DRAFT; Manager/Auditor-tier approves.
// DIRECTOR is a blanket bypass, not a per-subject-role approver_map row (business
// owner, 2026-08-03) — see the identical note in opening_stock.handlers.ts /
// mts_sku_rate.handlers.ts / costing_group.handlers.ts.
async function assertStrokeApproverRole(
  ctx: ProdHandlerContext,
  companyId: string,
  createdBy?: string | null,
): Promise<void> {
  if (hasBlanketApprovalOverride(ctx)) {
    return;
  }
  const rules = await loadStrokeApproverRules(companyId);
  let isConfiguredApprover: boolean;
  if (rules.length === 0) {
    isConfiguredApprover = false; // no approver_map row configured yet, and caller is not SA/GA/DIRECTOR.
  } else {
    const creatorRoleCode = createdBy ? await getStrokeUserRoleCode(createdBy) : null;
    const scopedRules = pickScopedApproverRules(
      {
        resource_code: "PROD_STROKE_APPROVAL",
        action_code: "APPROVE",
        requester_auth_user_id: createdBy ?? null,
        requester_role_code: creatorRoleCode,
      },
      rules,
    );
    isConfiguredApprover = scopedRules.length > 0 ? matchesStrokeApprover(scopedRules, ctx) : false;
  }
  if (!isConfiguredApprover) throw new Error("PROD_STROKE_APPROVER_ROLE_REQUIRED");
  // DIRECTOR already returned above, so this can never fire for DIRECTOR.
  if (createdBy && createdBy === ctx.auth_user_id && !hasBlanketApprovalOverride(ctx)) {
    throw new Error("PROD_STROKE_SELF_APPROVAL_FORBIDDEN");
  }
}

function validateLines(lines: JsonRecord[]): string | null {
  if (lines.length === 0) return null;
  for (const l of lines) {
    const lineType = toUpperTrimmedString(l.line_material_type || "RM");
    if (!LINE_MATERIAL_TYPES.has(lineType)) return "PROD_STROKE_LINE_TYPE_INVALID";
    if (!toTrimmedString(l.material_id)) return "PROD_STROKE_LINE_MATERIAL_REQUIRED";
  }
  const totalDosage = lines.reduce((sum, l) => sum + (Number(l.dosage_pct) || 0), 0);
  if (Math.abs(totalDosage - 100) > 0.01) return "PROD_STROKE_DOSAGE_SUM";
  return null;
}

function buildLineRows(strokeMasterId: string, lines: JsonRecord[]) {
  return lines.map((l, idx) => ({
    stroke_master_id: strokeMasterId,
    material_id: toTrimmedString(l.material_id),
    line_material_type: toUpperTrimmedString(l.line_material_type || "RM"),
    material_group_id: toTrimmedString(l.material_group_id) || null,
    default_storage_location_id: toTrimmedString(l.default_storage_location_id) || null,
    dosage_pct: Number(l.dosage_pct),
    display_order: idx,
  }));
}

// Find-or-create the SFG/INT Material Master for a Prod+Shade combo.
// Per 83.3: one Material Master per Prodshade, global across companies —
// only the plant/company extension is created per-company. Triggered at
// PR02 Approve (never at DRAFT create) so rejected Strokes leave no stale
// Material Master behind.
async function ensureProdshadeMaterial(params: {
  materialType: string;
  prodCode: string;
  shadeCode: string;
  baseUomCode: string;
  description: string;
  companyId: string;
  authUserId: string;
}): Promise<string> {
  const externalCode = `${params.prodCode}${params.shadeCode}`;

  const { data: existing, error: lookupErr } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id")
    .eq("material_type", params.materialType)
    .eq("external_code", externalCode)
    .maybeSingle();
  if (lookupErr) {
    console.error("[stroke_master.ensureProdshadeMaterial] lookup failed:", JSON.stringify(lookupErr));
    throw new Error("PROD_PRODSHADE_MATERIAL_LOOKUP_FAILED");
  }

  let materialId: string;
  if (existing) {
    materialId = String((existing as JsonRecord).id);
  } else {
    const { data: paceCode, error: paceErr } = await serviceRoleClient.rpc(
      "generate_material_pace_code",
      { p_material_type: params.materialType },
    );
    if (paceErr || !paceCode) {
      console.error("[stroke_master.ensureProdshadeMaterial] pace code rpc failed:", JSON.stringify(paceErr));
      throw new Error("PROD_PRODSHADE_PACE_CODE_FAILED");
    }

    const shortName = externalCode.length > 50 ? externalCode.slice(0, 50) : externalCode;
    const { data: newMat, error: insertErr } = await serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .insert({
        pace_code: paceCode,
        external_code: externalCode,
        material_name: externalCode,
        short_name: shortName,
        material_type: params.materialType,
        shade_code: params.shadeCode,
        base_uom_code: params.baseUomCode,
        document_name: params.description || null,
        procurement_type: "IN_HOUSE",
        import_domestic_flag: "DOMESTIC",
        batch_tracking_required: true,
        fifo_tracking_enabled: true,
        expiry_tracking_enabled: false,
        qa_required_on_inward: false,
        qa_required_on_fg: true,
        valuation_method: "WEIGHTED_AVERAGE",
        bom_exists: true,
        delivery_tolerance_enabled: false,
        status: "ACTIVE",
        created_by: params.authUserId,
      })
      .select("id")
      .single();
    if (insertErr || !newMat) {
      console.error("[stroke_master.ensureProdshadeMaterial] material insert failed:", JSON.stringify(insertErr));
      throw new Error("PROD_PRODSHADE_MATERIAL_CREATE_FAILED");
    }
    materialId = String((newMat as JsonRecord).id);
  }

  const { data: ext } = await serviceRoleClient
    .schema("erp_master")
    .from("material_company_ext")
    .select("id")
    .eq("material_id", materialId)
    .eq("company_id", params.companyId)
    .maybeSingle();
  if (!ext) {
    await serviceRoleClient.schema("erp_master").from("material_company_ext").insert({
      material_id: materialId,
      company_id: params.companyId,
      procurement_allowed: false,
      status: "ACTIVE",
      created_by: params.authUserId,
    });
  }

  return materialId;
}

// GET /api/production/stroke-masters
export async function listStrokeMastersHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const materialId = toTrimmedString(url.searchParams.get("material_id") ?? "");
    const status = toUpperTrimmedString(url.searchParams.get("status") ?? "");

    let query = serviceRoleClient
      .schema("erp_production")
      .from("stroke_master")
      .select(`
        id, company_id, prodshade_material_id, prod_code, shade_code, stroke_number, description,
        material_type, po_type, base_uom_code, conversion_uom_code, conversion_factor,
        default_storage_location_id,
        status, created_by, created_at, approved_by, approved_at,
        deactivated_by, deactivated_at, last_updated_at, last_updated_by
      `)
      .order("created_at", { ascending: false });

    if (companyId) {
      await assertCompanyScope(ctx, companyId);
      query = query.eq("company_id", companyId);
    } else {
      const scopedCompanyIds = await listStrokeScopedCompanyIds(ctx);
      if (scopedCompanyIds && scopedCompanyIds.length === 0) {
        return okResponse({ data: [] }, ctx.request_id, req);
      }
      if (scopedCompanyIds) {
        query = query.in("company_id", scopedCompanyIds);
      }
    }
    if (materialId) query = query.eq("prodshade_material_id", materialId);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) {
      console.error("[stroke_master.listStrokeMasters] query failed:", JSON.stringify(error));
      throw new Error("PROD_STROKE_LIST_FAILED");
    }

    const rows = (data ?? []) as JsonRecord[];
    const [materialMap, slocMap, userDisplayMap] = await Promise.all([
      getMaterialMapByIds(rows.map((r) => String(r.prodshade_material_id ?? ""))),
      getStorageLocationMapByIds(rows.map((r) => String(r.default_storage_location_id ?? ""))),
      resolveUserDisplayNames(rows.flatMap((r) => [
        String(r.created_by ?? ""), String(r.approved_by ?? ""), String(r.deactivated_by ?? ""),
      ])),
    ]);

    return okResponse({
      data: rows.map((row) => ({
        ...row,
        material: materialMap.get(String(row.prodshade_material_id ?? "")) ?? null,
        default_storage_location: slocMap.get(String(row.default_storage_location_id ?? "")) ?? null,
        created_by_display: userDisplayMap.get(String(row.created_by ?? "")) ?? null,
        approved_by_display: userDisplayMap.get(String(row.approved_by ?? "")) ?? null,
        deactivated_by_display: userDisplayMap.get(String(row.deactivated_by ?? "")) ?? null,
      })),
    }, ctx.request_id, req);
  } catch (err) {
    console.error("[stroke_master.listStrokeMasters] request_id:", ctx.request_id, "error:", err);
    const code = err instanceof Error ? err.message : "PROD_STROKE_LIST_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500;
    return strokeError(req, ctx, code, status, "Stroke master list failed");
  }
}

// GET /api/production/stroke-masters/:id
export async function getStrokeMasterHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return strokeError(req, ctx, "PROD_STROKE_ID_MISSING", 400, "Stroke master ID required");

    const { data, error } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_master")
      .select(`
        id, company_id, prodshade_material_id, prod_code, shade_code, stroke_number, description,
        material_type, po_type, base_uom_code, conversion_uom_code, conversion_factor,
        default_storage_location_id,
        status, created_by, created_at, approved_by, approved_at,
        deactivated_by, deactivated_at
      `)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[stroke_master.getStrokeMaster] query failed:", JSON.stringify(error));
      throw new Error("PROD_STROKE_FETCH_FAILED");
    }
    if (!data) return strokeError(req, ctx, "PROD_STROKE_NOT_FOUND", 404, "Stroke master not found");
    const stroke = data as JsonRecord;
    await assertCompanyScope(ctx, String(stroke.company_id ?? ""));

    const { data: lineRows, error: linesErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_line")
      .select("id, material_id, alternate_material_id, line_material_type, material_group_id, default_storage_location_id, dosage_pct, display_order")
      .eq("stroke_master_id", id)
      .order("display_order");
    if (linesErr) {
      console.error("[stroke_master.getStrokeMaster] lines query failed:", JSON.stringify(linesErr));
      throw new Error("PROD_STROKE_LINES_FETCH_FAILED");
    }
    const lines = (lineRows ?? []) as JsonRecord[];

    const groupIds = lines.map((l) => String(l.material_group_id ?? "")).filter(Boolean);
    const groupMembersMap = await getMaterialGroupMembersByGroupIds(groupIds);
    const [materialMap, groupMap, slocMap, userDisplayMap] = await Promise.all([
      getMaterialMapByIds([
        String(stroke.prodshade_material_id ?? ""),
        ...lines.map((l) => String(l.material_id ?? "")),
        ...lines.map((l) => String(l.alternate_material_id ?? "")),
        ...Array.from(groupMembersMap.values()).flat().map((member) => String(member.material_id ?? "")),
      ]),
      getMaterialGroupMapByIds(groupIds),
      getStorageLocationMapByIds([
        String(stroke.default_storage_location_id ?? ""),
        ...lines.map((l) => String(l.default_storage_location_id ?? "")),
      ]),
      resolveUserDisplayNames([
        String(stroke.created_by ?? ""), String(stroke.approved_by ?? ""), String(stroke.deactivated_by ?? ""),
      ]),
    ]);

    return okResponse({
      data: {
        ...stroke,
        material: materialMap.get(String(stroke.prodshade_material_id ?? "")) ?? null,
        default_storage_location: slocMap.get(String(stroke.default_storage_location_id ?? "")) ?? null,
        created_by_display: userDisplayMap.get(String(stroke.created_by ?? "")) ?? null,
        approved_by_display: userDisplayMap.get(String(stroke.approved_by ?? "")) ?? null,
        deactivated_by_display: userDisplayMap.get(String(stroke.deactivated_by ?? "")) ?? null,
        lines: lines.map((l) => ({
          ...(() => {
            const materialGroupId = String(l.material_group_id ?? "");
            const materialGroup = groupMap.get(materialGroupId) ?? null;
            const groupMembers = (groupMembersMap.get(materialGroupId) ?? []).map((member) => ({
              ...member,
              material: materialMap.get(String(member.material_id ?? "")) ?? null,
            }));
            return {
              material_group: materialGroup
                ? {
                    ...materialGroup,
                    members: groupMembers,
                    member_count: groupMembers.length,
                  }
                : null,
            };
          })(),
          ...l,
          material: materialMap.get(String(l.material_id ?? "")) ?? null,
          alternate_material: l.alternate_material_id ? materialMap.get(String(l.alternate_material_id)) ?? null : null,
          default_storage_location: slocMap.get(String(l.default_storage_location_id ?? "")) ?? null,
        })),
      },
    }, ctx.request_id, req);
  } catch (err) {
    console.error("[stroke_master.getStrokeMasterHandler] request_id:", ctx.request_id, "error:", err);
    const code = err instanceof Error ? err.message : "PROD_STROKE_FETCH_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500;
    return strokeError(req, ctx, code, status, "Stroke master fetch failed");
  }
}

// POST /api/production/stroke-masters
// Creates header + all lines in one call. Lines replace all existing lines.
export async function createStrokeMasterHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertProdReadRole(ctx); // Any user can create (QA role creates)
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const materialId = toTrimmedString(body.prodshade_material_id) || null;
    const prodCode = toUpperTrimmedString(body.prod_code);
    const shadeCode = toUpperTrimmedString(body.shade_code);
    const strokeNumber = toTrimmedString(body.stroke_number);
    const description = toTrimmedString(body.description);
    const materialType = toUpperTrimmedString(body.material_type || "SFG");
    const poType = toUpperTrimmedString(body.po_type);
    const baseUomCode = toTrimmedString(body.base_uom_code);
    const conversionUomCode = toTrimmedString(body.conversion_uom_code);
    const conversionFactor = body.conversion_factor === "" || body.conversion_factor == null
      ? null
      : Number(body.conversion_factor);
    const defaultStorageLocationId = toTrimmedString(body.default_storage_location_id) || null;
    const lines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];

    if (!companyId || !strokeNumber) {
      return strokeError(req, ctx, "PROD_STROKE_INVALID", 400, "company_id, stroke_number required");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return strokeError(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!materialId && (!prodCode || !shadeCode)) {
      return strokeError(req, ctx, "PROD_STROKE_INVALID", 400, "prodshade_material_id required, or prod_code + shade_code for a new Prodshade");
    }
    if (!/^\d+$/.test(strokeNumber)) {
      return strokeError(req, ctx, "PROD_STROKE_NUMBER_NUMERIC", 400, "Stroke number must be numeric");
    }
    if (!MATERIAL_TYPES.has(materialType)) {
      return strokeError(req, ctx, "PROD_STROKE_MATERIAL_TYPE_INVALID", 400, "material_type must be SFG or INT");
    }
    if (!poType || !PO_TYPES_BY_MATERIAL_TYPE[materialType].has(poType)) {
      return strokeError(req, ctx, "PROD_STROKE_PO_TYPE_INVALID", 400, `po_type must be one of ${[...PO_TYPES_BY_MATERIAL_TYPE[materialType]].join(", ")} for material_type ${materialType}`);
    }
    if (!baseUomCode) {
      return strokeError(req, ctx, "PROD_STROKE_BASE_UOM_REQUIRED", 400, "base_uom_code required");
    }
    if (conversionFactor != null && !(conversionFactor > 0)) {
      return strokeError(req, ctx, "PROD_STROKE_CONVERSION_FACTOR_INVALID", 400, "conversion_factor must be > 0 when provided");
    }
    if (!defaultStorageLocationId) {
      return strokeError(req, ctx, "PROD_STROKE_STORAGE_LOCATION_REQUIRED", 400, "default_storage_location_id required");
    }

    const lineErrorCode = validateLines(lines);
    if (lineErrorCode) {
      return strokeError(req, ctx, lineErrorCode, 400, "Stroke lines are invalid");
    }

    // New-Prodshade strokes have prodshade_material_id = NULL until Approve, so the
    // (company_id, prodshade_material_id, stroke_number) UNIQUE constraint can't catch
    // duplicates here — check Prod+Shade+Stroke Number directly.
    if (!materialId) {
      const { data: dupe } = await serviceRoleClient
        .schema("erp_production")
        .from("stroke_master")
        .select("id")
        .eq("company_id", companyId)
        .eq("prod_code", prodCode)
        .eq("shade_code", shadeCode)
        .eq("stroke_number", strokeNumber)
        .maybeSingle();
      if (dupe) {
        return strokeError(req, ctx, "PROD_STROKE_EXISTS", 409, "Stroke number already exists for this prodshade");
      }
    }

    const { data: sm, error: smErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_master")
      .insert({
        company_id: companyId,
        prodshade_material_id: materialId,
        prod_code: prodCode,
        shade_code: shadeCode,
        stroke_number: strokeNumber,
        description: description || null,
        material_type: materialType,
        po_type: poType,
        base_uom_code: baseUomCode,
        conversion_uom_code: conversionUomCode || null,
        conversion_factor: conversionFactor,
        default_storage_location_id: defaultStorageLocationId,
        status: "DRAFT",
        created_by: ctx.auth_user_id,
      })
      .select("id")
      .single();

    if (smErr) {
      if (smErr.code === "23505") {
        return strokeError(req, ctx, "PROD_STROKE_EXISTS", 409, "Stroke number already exists for this prodshade");
      }
      console.error("[stroke_master.createStrokeMaster] insert failed:", JSON.stringify(smErr));
      throw smErr;
    }

    if (lines.length > 0) {
      const { error: lErr } = await serviceRoleClient
        .schema("erp_production")
        .from("stroke_line")
        .insert(buildLineRows(sm.id as string, lines));
      if (lErr) {
        console.error("[stroke_master.createStrokeMaster] line insert failed:", JSON.stringify(lErr));
        throw new Error("PROD_STROKE_LINE_INSERT_FAILED");
      }
    }

    return okResponse({ id: sm.id }, ctx.request_id, req);
  } catch (err) {
    console.error("[stroke_master.createStrokeMasterHandler] request_id:", ctx.request_id, "error:", err);
    const code = err instanceof Error ? err.message : "PROD_STROKE_CREATE_FAILED";
    return strokeError(req, ctx, code, 500, "Stroke master create failed");
  }
}

// PATCH /api/production/stroke-masters/:id
// Update header + replace all lines. Only allowed while DRAFT (Manager edits
// here before Approve; Material Type / PO Type are immutable once created).
export async function updateStrokeMasterHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return strokeError(req, ctx, "PROD_STROKE_ID_MISSING", 400, "ID required");

    const existing = await getStrokeMaster(id);
    if (!existing) return strokeError(req, ctx, "PROD_STROKE_NOT_FOUND", 404, "Stroke master not found");
    await assertCompanyScope(ctx, String(existing.company_id ?? ""));
    if (existing.status !== "DRAFT") {
      return strokeError(req, ctx, "PROD_STROKE_APPROVED_LOCKED", 422, "Only DRAFT strokes can be edited");
    }

    const body = await parseBody(req);
    const description = toTrimmedString(body.description);
    const baseUomCode = toTrimmedString(body.base_uom_code) || (existing.base_uom_code as string);
    const conversionUomCode = toTrimmedString(body.conversion_uom_code);
    const conversionFactor = body.conversion_factor === "" || body.conversion_factor == null
      ? null
      : Number(body.conversion_factor);
    const lines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];

    if (conversionFactor != null && !(conversionFactor > 0)) {
      return strokeError(req, ctx, "PROD_STROKE_CONVERSION_FACTOR_INVALID", 400, "conversion_factor must be > 0 when provided");
    }
    const lineErrorCode = validateLines(lines);
    if (lineErrorCode) {
      return strokeError(req, ctx, lineErrorCode, 400, "Stroke lines are invalid");
    }

    const patch: JsonRecord = {
      description: description || null,
      base_uom_code: baseUomCode || null,
      conversion_uom_code: conversionUomCode || null,
      conversion_factor: conversionFactor,
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    };
    const effectiveStorageLocationId = body.default_storage_location_id !== undefined
      ? toTrimmedString(body.default_storage_location_id) || null
      : (existing.default_storage_location_id as string | null);
    if (!effectiveStorageLocationId) {
      return strokeError(req, ctx, "PROD_STROKE_STORAGE_LOCATION_REQUIRED", 400, "default_storage_location_id required");
    }
    if (body.default_storage_location_id !== undefined) {
      patch.default_storage_location_id = effectiveStorageLocationId;
    }
    // PO Type is editable up to Approve (only Material Type / Prodshade / Stroke
    // Number are locked once a Stroke exists).
    if (body.po_type !== undefined) {
      const poType = toUpperTrimmedString(body.po_type);
      const materialType = existing.material_type as string;
      if (!poType || !PO_TYPES_BY_MATERIAL_TYPE[materialType].has(poType)) {
        return strokeError(req, ctx, "PROD_STROKE_PO_TYPE_INVALID", 400, `po_type must be one of ${[...PO_TYPES_BY_MATERIAL_TYPE[materialType]].join(", ")} for material_type ${materialType}`);
      }
      patch.po_type = poType;
    }
    // Prod/Shade code can still be corrected while the Material Master hasn't
    // been created yet (new-Prodshade strokes, prodshade_material_id still null).
    if (!existing.prodshade_material_id) {
      if (body.prod_code !== undefined) patch.prod_code = toUpperTrimmedString(body.prod_code) || null;
      if (body.shade_code !== undefined) patch.shade_code = toUpperTrimmedString(body.shade_code) || null;
    }

    const { error: updateErr } = await serviceRoleClient.schema("erp_production").from("stroke_master")
      .update(patch)
      .eq("id", id);
    if (updateErr) {
      console.error("[stroke_master.updateStrokeMaster] header update failed:", JSON.stringify(updateErr));
      throw new Error("PROD_STROKE_UPDATE_FAILED");
    }

    // Replace all lines
    await serviceRoleClient.schema("erp_production").from("stroke_line").delete().eq("stroke_master_id", id);
    if (lines.length > 0) {
      const { error: lErr } = await serviceRoleClient.schema("erp_production").from("stroke_line")
        .insert(buildLineRows(id, lines));
      if (lErr) {
        console.error("[stroke_master.updateStrokeMaster] line insert failed:", JSON.stringify(lErr));
        throw new Error("PROD_STROKE_LINE_UPDATE_FAILED");
      }
    }

    return okResponse({ id }, ctx.request_id, req);
  } catch (err) {
    console.error("[stroke_master.updateStrokeMasterHandler] request_id:", ctx.request_id, "error:", err);
    const code = err instanceof Error ? err.message : "PROD_STROKE_UPDATE_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500;
    return strokeError(req, ctx, code, status, "Stroke master update failed");
  }
}

// POST /api/production/stroke-masters/:id/approve
// Manager/Auditor saves → status = APPROVED (= ACTIVE per 83.3 — visible in Process PO dropdown).
export async function approveStrokeMasterHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    // ACL-gated via route-acl-registry (PROD_STROKE_APPROVAL:APPROVE) — no longer a
    // blanket Manager/SA rank check; department grants are actually enforced.
    const id = getIdFromPath(req);
    if (!id) return strokeError(req, ctx, "PROD_STROKE_ID_MISSING", 400, "ID required");

    const existing = await getStrokeMaster(id);
    if (!existing) return strokeError(req, ctx, "PROD_STROKE_NOT_FOUND", 404, "Stroke master not found");
    await assertCompanyScope(ctx, String(existing.company_id ?? ""));
    if (existing.status !== "DRAFT") {
      return strokeError(req, ctx, "PROD_STROKE_ALREADY_APPROVED", 409, "Only DRAFT strokes can be approved");
    }
    await assertStrokeApproverRole(
      ctx,
      toTrimmedString(existing.company_id as string),
      existing.created_by as string | null | undefined,
    );

    // Check lines exist and dosage sums to 100
    const { data: lines } = await serviceRoleClient
      .schema("erp_production").from("stroke_line")
      .select("dosage_pct").eq("stroke_master_id", id);
    if (!lines || lines.length === 0) {
      return strokeError(req, ctx, "PROD_STROKE_NO_LINES", 422, "Cannot approve stroke with no RM lines");
    }
    const total = (lines as JsonRecord[]).reduce((s, l) => s + Number(l.dosage_pct), 0);
    if (Math.abs(total - 100) > 0.01) {
      return strokeError(req, ctx, "PROD_STROKE_DOSAGE_SUM", 422, `Dosage sum must be 100 (currently ${total.toFixed(2)})`);
    }

    // New-Prodshade strokes resolve/create their Material Master only now, on Approve —
    // rejected DRAFTs must never create a stale Material Master (per 83.3).
    let materialId = existing.prodshade_material_id as string | null;
    if (!materialId) {
      materialId = await ensureProdshadeMaterial({
        materialType: existing.material_type as string,
        prodCode: existing.prod_code as string,
        shadeCode: existing.shade_code as string,
        baseUomCode: existing.base_uom_code as string,
        description: (existing.description as string) ?? "",
        companyId: existing.company_id as string,
        authUserId: ctx.auth_user_id,
      });
    }

    const now = new Date().toISOString();
    const { error } = await serviceRoleClient.schema("erp_production").from("stroke_master")
      .update({
        status: "APPROVED",
        prodshade_material_id: materialId,
        approved_by: ctx.auth_user_id,
        approved_at: now,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id);
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return strokeError(req, ctx, "PROD_STROKE_EXISTS", 409, "Stroke number already exists for this prodshade");
      }
      console.error("[stroke_master.approveStrokeMaster] update failed:", JSON.stringify(error));
      throw new Error("PROD_STROKE_APPROVE_FAILED");
    }

    return okResponse({ id, status: "APPROVED", prodshade_material_id: materialId }, ctx.request_id, req);
  } catch (err) {
    console.error("[stroke_master.approveStrokeMasterHandler] request_id:", ctx.request_id, "error:", err);
    const code = err instanceof Error ? err.message : "PROD_STROKE_APPROVE_FAILED";
    const status = code === "PROD_STROKE_APPROVER_ROLE_REQUIRED" || code === "PROD_STROKE_SELF_APPROVAL_FORBIDDEN" || code === "COMPANY_SCOPE_VIOLATION"
      ? 403
      : 500;
    return strokeError(req, ctx, code, status, "Stroke approve failed");
  }
}

// POST /api/production/stroke-masters/:id/reject
// Manager rejects a DRAFT stroke — hard delete (never reached ACTIVE, no PRUNE trail needed).
export async function rejectStrokeMasterHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    // ACL-gated via route-acl-registry (PROD_STROKE_APPROVAL:APPROVE) — no longer a
    // blanket Manager/SA rank check; department grants are actually enforced.
    const id = getIdFromPath(req);
    if (!id) return strokeError(req, ctx, "PROD_STROKE_ID_MISSING", 400, "ID required");

    const existing = await getStrokeMaster(id);
    if (!existing) return strokeError(req, ctx, "PROD_STROKE_NOT_FOUND", 404, "Not found");
    await assertCompanyScope(ctx, String(existing.company_id ?? ""));
    if (existing.status !== "DRAFT") {
      return strokeError(req, ctx, "PROD_STROKE_NOT_DRAFT", 422, "Only DRAFT strokes can be rejected");
    }
    await assertStrokeApproverRole(
      ctx,
      toTrimmedString(existing.company_id as string),
      existing.created_by as string | null | undefined,
    );

    await serviceRoleClient.schema("erp_production").from("stroke_line").delete().eq("stroke_master_id", id);
    const { error } = await serviceRoleClient.schema("erp_production").from("stroke_master").delete().eq("id", id);
    if (error) {
      console.error("[stroke_master.rejectStrokeMaster] delete failed:", JSON.stringify(error));
      throw new Error("PROD_STROKE_REJECT_FAILED");
    }

    return okResponse({ id, deleted: true }, ctx.request_id, req);
  } catch (err) {
    console.error("[stroke_master.rejectStrokeMasterHandler] request_id:", ctx.request_id, "error:", err);
    const code = err instanceof Error ? err.message : "PROD_STROKE_REJECT_FAILED";
    const status = code === "PROD_STROKE_APPROVER_ROLE_REQUIRED" || code === "PROD_STROKE_SELF_APPROVAL_FORBIDDEN" || code === "COMPANY_SCOPE_VIOLATION"
      ? 403
      : 500;
    return strokeError(req, ctx, code, status, "Stroke reject failed");
  }
}

// POST /api/production/stroke-masters/:id/deactivate
// QA or Manager deactivates an APPROVED stroke — terminal, hidden from Process PO
// dropdown, existing Process Orders referencing it are unaffected.
export async function deactivateStrokeMasterHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return strokeError(req, ctx, "PROD_STROKE_ID_MISSING", 400, "ID required");

    const existing = await getStrokeMaster(id);
    if (!existing) return strokeError(req, ctx, "PROD_STROKE_NOT_FOUND", 404, "Not found");
    await assertCompanyScope(ctx, String(existing.company_id ?? ""));
    if (existing.status !== "APPROVED") {
      return strokeError(req, ctx, "PROD_STROKE_NOT_APPROVED", 422, "Only APPROVED strokes can be deactivated");
    }

    const now = new Date().toISOString();
    const { error } = await serviceRoleClient.schema("erp_production").from("stroke_master")
      .update({ status: "DEACTIVATED", deactivated_by: ctx.auth_user_id, deactivated_at: now, last_updated_at: now, last_updated_by: ctx.auth_user_id })
      .eq("id", id);
    if (error) {
      console.error("[stroke_master.deactivateStrokeMaster] update failed:", JSON.stringify(error));
      throw new Error("PROD_STROKE_DEACTIVATE_FAILED");
    }

    return okResponse({ id, status: "DEACTIVATED" }, ctx.request_id, req);
  } catch (err) {
    console.error("[stroke_master.deactivateStrokeMasterHandler] request_id:", ctx.request_id, "error:", err);
    const code = err instanceof Error ? err.message : "PROD_STROKE_DEACTIVATE_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500;
    return strokeError(req, ctx, code, status, "Stroke deactivate failed");
  }
}

// POST /api/production/stroke-masters/:id/revert
// Manager can revert APPROVED → DRAFT for corrections.
export async function revertStrokeMasterHandler(
  req: Request,
  ctx: ProdHandlerContext,
): Promise<Response> {
  try {
    // ACL-gated via route-acl-registry (PROD_STROKE_APPROVAL:APPROVE) — no longer a
    // blanket Manager/SA rank check; department grants are actually enforced.
    const id = getIdFromPath(req);
    if (!id) return strokeError(req, ctx, "PROD_STROKE_ID_MISSING", 400, "ID required");

    const existing = await getStrokeMaster(id);
    if (!existing) return strokeError(req, ctx, "PROD_STROKE_NOT_FOUND", 404, "Not found");
    await assertCompanyScope(ctx, String(existing.company_id ?? ""));
    if (existing.status !== "APPROVED") {
      return strokeError(req, ctx, "PROD_STROKE_NOT_APPROVED", 422, "Only APPROVED strokes can be reverted");
    }

    // Cannot revert if any Process Orders reference this stroke
    const { count } = await serviceRoleClient.schema("erp_production").from("process_order")
      .select("id", { count: "exact", head: true }).eq("stroke_master_id", id)
      .not("status", "eq", "REVERSED") as { count?: number };
    if ((count ?? 0) > 0) {
      return strokeError(req, ctx, "PROD_STROKE_IN_USE", 409, "Cannot revert — active Process Orders reference this stroke");
    }

    const { error: revertErr } = await serviceRoleClient.schema("erp_production").from("stroke_master")
      .update({ status: "DRAFT", approved_by: null, approved_at: null, last_updated_at: new Date().toISOString(), last_updated_by: ctx.auth_user_id })
      .eq("id", id);
    if (revertErr) {
      console.error("[stroke_master.revertStrokeMaster] update failed:", JSON.stringify(revertErr));
      throw new Error("PROD_STROKE_REVERT_FAILED");
    }

    return okResponse({ id, status: "DRAFT" }, ctx.request_id, req);
  } catch (err) {
    console.error("[stroke_master.revertStrokeMasterHandler] request_id:", ctx.request_id, "error:", err);
    const code = err instanceof Error ? err.message : "PROD_STROKE_REVERT_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500;
    return strokeError(req, ctx, code, status, "Stroke revert failed");
  }
}
