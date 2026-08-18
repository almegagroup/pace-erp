/*
 * File-ID: 27.26-BE
 * File-Path: supabase/functions/api/_core/production/costing_group.handlers.ts
 * Gate: 27.26
 * Domain: PRODUCTION / COSTING (Accounts ACL)
 * Purpose: AC06 storage-location-group browse-based costing group + month-wise draft/approve rate chart.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { loadApproverWorkContextIds, matchesApprover, pickScopedApproverRules } from "../../_shared/workflow_scope.ts";
import { hasBlanketApprovalOverride } from "../../_shared/approval_override.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import {
  assertProdReadRole,
  parseBody,
  parseNonNegativeNumber,
  toTrimmedString,
} from "./production.shared.ts";

type JsonRecord = Record<string, unknown>;

function costingError(req: Request, ctx: ProdHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

async function getCompanyScope(ctx: ProdHandlerContext, requestedCompanyId?: string): Promise<string> {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  const companyId = toTrimmedString(requestedCompanyId) || scopedCompanyId;
  if (companyId) await assertCompanyScope(ctx, companyId);
  return companyId;
}

function normalizeRateMonth(raw: unknown): string | null {
  const value = toTrimmedString(raw);
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(value)) return null;
  const dateValue = value.length === 7 ? `${value}-01` : value;
  const date = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function getPathId(req: Request, segment: string): string {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = parts.indexOf(segment);
  return idx >= 0 ? toTrimmedString(parts[idx + 1]) : "";
}

interface ApproverMapRow {
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
}

async function loadCostingRateApproverRules(companyId: string): Promise<ApproverMapRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("acl")
    .from("approver_map")
    .select(
      "approver_user_id, approver_role_code, approver_work_context_id, resource_code, action_code, scope_type, subject_user_id, subject_work_context_id, subject_role_code, approval_stage",
    )
    .eq("resource_code", "ACC_SLOC_COSTING_GROUP")
    .eq("action_code", "APPROVE")
    .eq("company_id", companyId);
  if (error) throw new Error("PROD_COST_RATE_APPROVER_LOOKUP_FAILED");
  return (data as ApproverMapRow[] | null) ?? [];
}

async function getCostingRateUserRoleCodes(userIds: string[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (userIds.length === 0) return result;
  const { data, error } = await serviceRoleClient
    .schema("erp_acl")
    .from("user_roles")
    .select("auth_user_id, role_code")
    .in("auth_user_id", userIds);
  if (error) return result;
  for (const row of (data as Record<string, unknown>[] | null) ?? []) {
    result.set(String(row.auth_user_id ?? ""), String(row.role_code ?? "") || null);
  }
  return result;
}

// Batch approval can cover DRAFT rows saved by different creators — every distinct creator
// present in the batch must independently clear the approver-role + self-approval check.
async function assertCostingRateApproverRole(
  ctx: ProdHandlerContext,
  companyId: string,
  creatorIds: Array<string | null | undefined>,
): Promise<void> {
  if (hasBlanketApprovalOverride(ctx)) {
    // SA/GA/DIRECTOR always retain override authority, regardless of approver_map
    // config — DIRECTOR is deliberately a blanket bypass here, not a per-subject-role
    // approver_map row (business owner, 2026-08-03): it must approve every creator's
    // draft directly, and approver_map has a hard max-5-approvers-per-scope limit
    // that a "DIRECTOR always also approves" row on every subject_role would eat into.
    return;
  }
  const rules = await loadCostingRateApproverRules(companyId);
  const distinctCreatorIds = [...new Set(creatorIds.map((id) => toTrimmedString(id)).filter(Boolean))];
  // INDEPENDENT: each creator's role lookup doesn't depend on any other's, so batch
  // fetch once instead of a sequential await-per-creator loop (CLAUDE.md §8B).
  const creatorRoleCodes = rules.length === 0
    ? new Map<string, string | null>()
    : await getCostingRateUserRoleCodes(distinctCreatorIds);
  // INDEPENDENT of the per-creator loop below — the approver's own department
  // membership doesn't depend on which creator is being checked, so resolve once.
  const approverWorkContextIds = rules.length === 0
    ? new Set<string>()
    : await loadApproverWorkContextIds(serviceRoleClient, ctx.auth_user_id, companyId);
  for (const createdBy of distinctCreatorIds) {
    let isConfiguredApprover: boolean;
    if (rules.length === 0) {
      isConfiguredApprover = hasBlanketApprovalOverride(ctx); // no approver_map row configured yet, and caller is not a blanket-override approver.
    } else {
      const creatorRoleCode = creatorRoleCodes.get(createdBy) ?? null;
      const scopedRules = pickScopedApproverRules(
        {
          resource_code: "ACC_SLOC_COSTING_GROUP",
          action_code: "APPROVE",
          requester_auth_user_id: createdBy,
          requester_role_code: creatorRoleCode,
        },
        rules,
      );
      isConfiguredApprover = scopedRules.length > 0
        ? matchesApprover(scopedRules, { auth_user_id: ctx.auth_user_id, roleCode: ctx.roleCode, approverWorkContextIds })
        : hasBlanketApprovalOverride(ctx);
    }
    if (!isConfiguredApprover) throw new Error("PROD_COST_RATE_APPROVER_ROLE_REQUIRED");
    // DIRECTOR already returned above, so this can never fire for DIRECTOR.
    if (createdBy === ctx.auth_user_id && !hasBlanketApprovalOverride(ctx)) {
      throw new Error("PROD_COST_RATE_SELF_APPROVAL_FORBIDDEN");
    }
  }
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map((value) => toTrimmedString(value)).filter(Boolean))];
}

async function getGroupById(groupId: string): Promise<JsonRecord | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("costing_group")
    .select("id, company_id, name")
    .eq("id", groupId)
    .maybeSingle();
  if (error) throw new Error("PROD_COST_GROUP_LOOKUP_FAILED");
  return (data as JsonRecord | null) ?? null;
}

async function getSlocGroupById(groupId: string): Promise<JsonRecord | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("sloc_group")
    .select("id, company_id, name")
    .eq("id", groupId)
    .maybeSingle();
  if (error) throw new Error("PROD_SLOC_GROUP_LOOKUP_FAILED");
  return (data as JsonRecord | null) ?? null;
}

async function getMaterialMap(materialIds: string[]): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(materialIds.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (ids.length === 0) return map;
  let rows: JsonRecord[];
  try {
    rows = await fetchInChunks<JsonRecord>(ids, (idChunk) =>
      serviceRoleClient
        .schema("erp_master")
        .from("material_master")
        .select("id, pace_code, material_name, base_uom_code")
        .in("id", idChunk));
  } catch {
    throw new Error("PROD_COST_RATE_LIST_FAILED");
  }
  for (const row of rows) {
    map.set(toTrimmedString(row.id), row);
  }
  return map;
}

async function getStorageLocationMap(locationIds: string[]): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(locationIds.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (ids.length === 0) return map;
  let rows: JsonRecord[];
  try {
    rows = await fetchInChunks<JsonRecord>(ids, (idChunk) =>
      serviceRoleClient
        .schema("erp_inventory")
        .from("storage_location_master")
        .select("id, storage_location_code, storage_location_name")
        .in("id", idChunk));
  } catch {
    throw new Error("PROD_COST_RATE_LIST_FAILED");
  }
  for (const row of rows) {
    map.set(toTrimmedString(row.id), row);
  }
  return map;
}

async function getCostingGroupNameMap(groupIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(groupIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("costing_group")
    .select("id, name")
    .in("id", ids);
  if (error) throw new Error("PROD_COST_RATE_LIST_FAILED");
  for (const row of ((data ?? []) as JsonRecord[])) {
    map.set(toTrimmedString(row.id), toTrimmedString(row.name));
  }
  return map;
}

function sortMaterialRows<T extends JsonRecord>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const groupCmp = String(a.group_name ?? "").localeCompare(String(b.group_name ?? ""));
    if (groupCmp !== 0) return groupCmp;
    const codeCmp = String(a.pace_code ?? "").localeCompare(String(b.pace_code ?? ""));
    if (codeCmp !== 0) return codeCmp;
    return String(a.material_name ?? "").localeCompare(String(b.material_name ?? ""));
  });
}

export async function createSlocGroupHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    const name = toTrimmedString(body.name);
    const storageLocationIds = Array.isArray(body.storage_location_ids) ? uniqueStrings(body.storage_location_ids) : [];
    if (!companyId || !name || storageLocationIds.length === 0) {
      return costingError(req, ctx, "PROD_SLOC_GROUP_INVALID", 400, "company_id, name, and storage_location_ids are required.");
    }
    const { data: group, error: groupError } = await serviceRoleClient
      .schema("erp_production")
      .from("sloc_group")
      .insert({
        company_id: companyId,
        name,
        created_by: ctx.auth_user_id,
      })
      .select("id, company_id, name, created_at")
      .single();
    if (groupError) {
      if (groupError.code === "23505") {
        return costingError(req, ctx, "PROD_SLOC_GROUP_EXISTS", 409, "An SLoc Group with this name already exists for the company.");
      }
      throw new Error("PROD_SLOC_GROUP_CREATE_FAILED");
    }
    const { error: memberError } = await serviceRoleClient
      .schema("erp_production")
      .from("sloc_group_member")
      .insert(storageLocationIds.map((storage_location_id) => ({
        sloc_group_id: toTrimmedString(group.id),
        storage_location_id,
        added_by: ctx.auth_user_id,
      })));
    if (memberError) throw new Error("PROD_SLOC_GROUP_CREATE_FAILED");
    return okResponse({ data: group }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROD_SLOC_GROUP_CREATE_FAILED";
    return costingError(req, ctx, code, 500, "SLoc Group create failed.");
  }
}

export async function listSlocGroupsHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    if (!companyId) {
      return costingError(req, ctx, "PROD_SLOC_GROUP_COMPANY_REQUIRED", 400, "company_id is required.");
    }
    const { data: groups, error: groupError } = await serviceRoleClient
      .schema("erp_production")
      .from("sloc_group")
      .select("id, company_id, name, created_at")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (groupError) throw new Error("PROD_SLOC_GROUP_LIST_FAILED");
    const groupIds = uniqueStrings(((groups ?? []) as JsonRecord[]).map((row) => row.id));
    const { data: members, error: memberError } = groupIds.length > 0
      ? await serviceRoleClient
        .schema("erp_production")
        .from("sloc_group_member")
        .select("id, sloc_group_id, storage_location_id, added_at")
        .in("sloc_group_id", groupIds)
      : { data: [], error: null };
    if (memberError) throw new Error("PROD_SLOC_GROUP_LIST_FAILED");
    const locationMap = await getStorageLocationMap(uniqueStrings(((members ?? []) as JsonRecord[]).map((row) => row.storage_location_id)));
    const membersByGroup = new Map<string, JsonRecord[]>();
    for (const member of ((members ?? []) as JsonRecord[])) {
      const groupId = toTrimmedString(member.sloc_group_id);
      const location = locationMap.get(toTrimmedString(member.storage_location_id));
      const list = membersByGroup.get(groupId) ?? [];
      list.push({
        ...member,
        storage_location_code: location ? toTrimmedString(location.storage_location_code) : null,
        storage_location_name: location ? toTrimmedString(location.storage_location_name) : null,
      });
      membersByGroup.set(groupId, list);
    }
    return okResponse({
      data: ((groups ?? []) as JsonRecord[]).map((group) => ({
        ...group,
        member_count: (membersByGroup.get(toTrimmedString(group.id)) ?? []).length,
        members: (membersByGroup.get(toTrimmedString(group.id)) ?? []).sort((a, b) =>
          String(a.storage_location_code ?? "").localeCompare(String(b.storage_location_code ?? ""))
        ),
      })),
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROD_SLOC_GROUP_LIST_FAILED";
    return costingError(req, ctx, code, 500, "SLoc Group list failed.");
  }
}

export async function addSlocGroupMemberHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const groupId = getPathId(req, "sloc-groups");
    const group = groupId ? await getSlocGroupById(groupId) : null;
    if (!group) return costingError(req, ctx, "PROD_SLOC_GROUP_NOT_FOUND", 404, "SLoc Group not found.");
    await assertCompanyScope(ctx, toTrimmedString(group.company_id));
    const body = await parseBody(req);
    const storageLocationIds = Array.isArray(body.storage_location_ids) ? uniqueStrings(body.storage_location_ids) : [];
    if (storageLocationIds.length === 0) {
      return costingError(req, ctx, "PROD_SLOC_GROUP_MEMBER_INVALID", 400, "At least one storage location is required.");
    }
    const { data: existing, error: existingError } = await serviceRoleClient
      .schema("erp_production")
      .from("sloc_group_member")
      .select("storage_location_id")
      .eq("sloc_group_id", groupId)
      .in("storage_location_id", storageLocationIds);
    if (existingError) throw new Error("PROD_SLOC_GROUP_MEMBER_ADD_FAILED");
    const existingIds = new Set(uniqueStrings(((existing ?? []) as JsonRecord[]).map((row) => row.storage_location_id)));
    const inserts = storageLocationIds
      .filter((storageLocationId) => !existingIds.has(storageLocationId))
      .map((storage_location_id) => ({
        sloc_group_id: groupId,
        storage_location_id,
        added_by: ctx.auth_user_id,
      }));
    if (inserts.length > 0) {
      const { error: insertError } = await serviceRoleClient
        .schema("erp_production")
        .from("sloc_group_member")
        .insert(inserts);
      if (insertError) throw new Error("PROD_SLOC_GROUP_MEMBER_ADD_FAILED");
    }
    return okResponse({
      data: {
        sloc_group_id: groupId,
        inserted_count: inserts.length,
        skipped_count: storageLocationIds.length - inserts.length,
      },
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROD_SLOC_GROUP_MEMBER_ADD_FAILED";
    return costingError(req, ctx, code, 500, "SLoc Group member add failed.");
  }
}

export async function removeSlocGroupMemberHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const groupId = getPathId(req, "sloc-groups");
    const memberId = getPathId(req, "members");
    const group = groupId ? await getSlocGroupById(groupId) : null;
    if (!group) return costingError(req, ctx, "PROD_SLOC_GROUP_NOT_FOUND", 404, "SLoc Group not found.");
    await assertCompanyScope(ctx, toTrimmedString(group.company_id));
    const { data: existing, error: existingError } = await serviceRoleClient
      .schema("erp_production")
      .from("sloc_group_member")
      .select("id")
      .eq("id", memberId)
      .eq("sloc_group_id", groupId)
      .maybeSingle();
    if (existingError) throw new Error("PROD_SLOC_GROUP_MEMBER_REMOVE_FAILED");
    if (!existing) {
      return costingError(req, ctx, "PROD_SLOC_GROUP_MEMBER_NOT_FOUND", 404, "SLoc Group member not found.");
    }
    const { error: deleteError } = await serviceRoleClient
      .schema("erp_production")
      .from("sloc_group_member")
      .delete()
      .eq("id", memberId)
      .eq("sloc_group_id", groupId);
    if (deleteError) throw new Error("PROD_SLOC_GROUP_MEMBER_REMOVE_FAILED");
    return okResponse({ data: { id: memberId } }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROD_SLOC_GROUP_MEMBER_REMOVE_FAILED";
    return costingError(req, ctx, code, 500, "SLoc Group member remove failed.");
  }
}

export async function createCostingGroupHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    const name = toTrimmedString(body.name);
    if (!companyId || !name) {
      return costingError(req, ctx, "PROD_COST_GROUP_INVALID", 400, "company_id and name are required.");
    }
    const { data, error } = await serviceRoleClient
      .schema("erp_production")
      .from("costing_group")
      .insert({
        company_id: companyId,
        name,
        created_by: ctx.auth_user_id,
      })
      .select("id, company_id, name")
      .single();
    if (error) {
      if (error.code === "23505") {
        return costingError(req, ctx, "PROD_COST_GROUP_EXISTS", 409, "A costing group with this name already exists for the company.");
      }
      throw new Error("PROD_COST_GROUP_CREATE_FAILED");
    }
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROD_COST_GROUP_CREATE_FAILED";
    return costingError(req, ctx, code, 500, "Costing group create failed.");
  }
}

export async function listCostingGroupsHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    if (!companyId) {
      return costingError(req, ctx, "PROD_COST_GROUP_COMPANY_REQUIRED", 400, "company_id is required.");
    }
    const { data: groups, error } = await serviceRoleClient
      .schema("erp_production")
      .from("costing_group")
      .select("id, company_id, name, created_at")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (error) throw new Error("PROD_COST_GROUP_LIST_FAILED");
    const groupIds = uniqueStrings(((groups ?? []) as JsonRecord[]).map((row) => row.id));
    const { data: members, error: memberError } = groupIds.length > 0
      ? await serviceRoleClient
        .schema("erp_production")
        .from("costing_group_member")
        .select("id, group_id, material_id, added_from_storage_location_id, added_at")
        .in("group_id", groupIds)
      : { data: [], error: null };
    if (memberError) throw new Error("PROD_COST_GROUP_LIST_FAILED");
    const materialMap = await getMaterialMap(uniqueStrings(((members ?? []) as JsonRecord[]).map((row) => row.material_id)));
    const membersByGroup = new Map<string, JsonRecord[]>();
    for (const member of ((members ?? []) as JsonRecord[])) {
      const groupId = toTrimmedString(member.group_id);
      const material = materialMap.get(toTrimmedString(member.material_id));
      const list = membersByGroup.get(groupId) ?? [];
      list.push({
        ...member,
        pace_code: material ? toTrimmedString(material.pace_code) : null,
        material_name: material ? toTrimmedString(material.material_name) : null,
      });
      membersByGroup.set(groupId, list);
    }
    return okResponse({
      data: ((groups ?? []) as JsonRecord[]).map((group) => ({
        ...group,
        member_count: (membersByGroup.get(toTrimmedString(group.id)) ?? []).length,
        members: sortMaterialRows(membersByGroup.get(toTrimmedString(group.id)) ?? []),
      })),
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROD_COST_GROUP_LIST_FAILED";
    return costingError(req, ctx, code, 500, "Costing group list failed.");
  }
}

export async function addCostingGroupMemberHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const groupId = getPathId(req, "costing-groups");
    const group = groupId ? await getGroupById(groupId) : null;
    if (!group) return costingError(req, ctx, "PROD_COST_GROUP_NOT_FOUND", 404, "Costing group not found.");
    await assertCompanyScope(ctx, toTrimmedString(group.company_id));
    const body = await parseBody(req);
    const materialIds = Array.isArray(body.material_ids) ? uniqueStrings(body.material_ids) : [];
    if (materialIds.length === 0) {
      return costingError(req, ctx, "PROD_COST_GROUP_MEMBER_INVALID", 400, "At least one material is required.");
    }
    const { data: existing, error } = await serviceRoleClient
      .schema("erp_production")
      .from("costing_group_member")
      .select("id, group_id, material_id, group:costing_group!inner(name)")
      .in("material_id", materialIds);
    if (error) throw new Error("PROD_COST_GROUP_MEMBER_ADD_FAILED");
    const conflicts = ((existing ?? []) as JsonRecord[]).filter((row) => toTrimmedString(row.group_id) !== groupId);
    if (conflicts.length > 0) {
      const first = conflicts[0];
      return costingError(
        req,
        ctx,
        "PROD_COST_GROUP_MEMBER_CONFLICT",
        409,
        `Material already belongs to group ${toTrimmedString((first.group as JsonRecord)?.name)}. Unmap it first.`,
      );
    }
    const existingInSameGroup = new Set(
      ((existing ?? []) as JsonRecord[])
        .filter((row) => toTrimmedString(row.group_id) === groupId)
        .map((row) => toTrimmedString(row.material_id)),
    );
    const inserts = materialIds
      .filter((materialId) => !existingInSameGroup.has(materialId))
      .map((material_id) => ({
        group_id: groupId,
        material_id,
        added_from_storage_location_id: null,
        added_by: ctx.auth_user_id,
      }));
    if (inserts.length > 0) {
      const { error: insertError } = await serviceRoleClient
        .schema("erp_production")
        .from("costing_group_member")
        .insert(inserts);
      if (insertError) throw new Error("PROD_COST_GROUP_MEMBER_ADD_FAILED");
    }
    return okResponse({
      data: {
        group_id: groupId,
        inserted_count: inserts.length,
        skipped_count: materialIds.length - inserts.length,
      },
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROD_COST_GROUP_MEMBER_ADD_FAILED";
    return costingError(req, ctx, code, 500, "Costing group member add failed.");
  }
}

export async function removeCostingGroupMemberHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const groupId = getPathId(req, "costing-groups");
    const memberId = getPathId(req, "members");
    const group = groupId ? await getGroupById(groupId) : null;
    if (!group) return costingError(req, ctx, "PROD_COST_GROUP_NOT_FOUND", 404, "Costing group not found.");
    await assertCompanyScope(ctx, toTrimmedString(group.company_id));
    const { data: existing, error } = await serviceRoleClient
      .schema("erp_production")
      .from("costing_group_member")
      .select("id")
      .eq("id", memberId)
      .eq("group_id", groupId)
      .maybeSingle();
    if (error) throw new Error("PROD_COST_GROUP_MEMBER_REMOVE_FAILED");
    if (!existing) {
      return costingError(req, ctx, "PROD_COST_GROUP_MEMBER_NOT_FOUND", 404, "Costing group member not found.");
    }
    const { error: deleteError } = await serviceRoleClient
      .schema("erp_production")
      .from("costing_group_member")
      .delete()
      .eq("id", memberId)
      .eq("group_id", groupId);
    if (deleteError) throw new Error("PROD_COST_GROUP_MEMBER_REMOVE_FAILED");
    return okResponse({ data: { id: memberId } }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROD_COST_GROUP_MEMBER_REMOVE_FAILED";
    return costingError(req, ctx, code, 500, "Costing group member remove failed.");
  }
}

export async function listCostingRateMaterialsHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const slocGroupId = toTrimmedString(url.searchParams.get("sloc_group_id"));
    const rateMonth = normalizeRateMonth(url.searchParams.get("rate_month"));
    if (!companyId || !slocGroupId) {
      return costingError(req, ctx, "PROD_COST_RATE_FILTER_INVALID", 400, "company_id and sloc_group_id are required.");
    }
    if (url.searchParams.has("rate_month") && !rateMonth) {
      return costingError(req, ctx, "PROD_COST_RATE_MONTH_INVALID", 400, "rate_month must be YYYY-MM or YYYY-MM-DD.");
    }
    const slocGroup = await getSlocGroupById(slocGroupId);
    if (!slocGroup) {
      return costingError(req, ctx, "PROD_SLOC_GROUP_NOT_FOUND", 404, "SLoc Group not found.");
    }
    if (toTrimmedString(slocGroup.company_id) !== companyId) {
      return costingError(req, ctx, "PROD_SLOC_GROUP_SCOPE_INVALID", 409, "SLoc Group does not belong to the selected company.");
    }
    const { data: slocMembers, error: slocMemberError } = await serviceRoleClient
      .schema("erp_production")
      .from("sloc_group_member")
      .select("storage_location_id")
      .eq("sloc_group_id", slocGroupId);
    if (slocMemberError) throw new Error("PROD_COST_RATE_LIST_FAILED");
    const storageLocationIds = uniqueStrings(((slocMembers ?? []) as JsonRecord[]).map((row) => row.storage_location_id));
    if (storageLocationIds.length === 0) {
      return okResponse({ data: [] }, ctx.request_id, req);
    }
    let snapshotRows: JsonRecord[];
    try {
      snapshotRows = await fetchInChunks<JsonRecord>(storageLocationIds, (idChunk) =>
        serviceRoleClient
          .schema("erp_inventory")
          .from("stock_snapshot")
          .select("material_id")
          .eq("company_id", companyId)
          .in("storage_location_id", idChunk));
    } catch {
      throw new Error("PROD_COST_RATE_LIST_FAILED");
    }
    const materialIds = uniqueStrings(snapshotRows.map((row) => row.material_id));
    if (materialIds.length === 0) {
      return okResponse({ data: [] }, ctx.request_id, req);
    }
    let membershipRows: JsonRecord[];
    let rateRows: JsonRecord[];
    let materialMap: Map<string, JsonRecord>;
    try {
      [materialMap, membershipRows, rateRows] = await Promise.all([
        getMaterialMap(materialIds),
        fetchInChunks<JsonRecord>(materialIds, (idChunk) =>
          serviceRoleClient
            .schema("erp_production")
            .from("costing_group_member")
            .select("id, material_id, group_id, group:costing_group!inner(name)")
            .in("material_id", idChunk)),
        rateMonth
          ? fetchInChunks<JsonRecord>(materialIds, (idChunk) =>
            serviceRoleClient
              .schema("erp_production")
              .from("costing_rate_line")
              .select("id, material_id, rate, status, group_id")
              .eq("company_id", companyId)
              .eq("rate_month", rateMonth)
              .in("material_id", idChunk))
          : Promise.resolve([]),
      ]);
    } catch {
      throw new Error("PROD_COST_RATE_LIST_FAILED");
    }
    const membershipMap = new Map<string, JsonRecord>(
      membershipRows.map((row) => [toTrimmedString(row.material_id), row]),
    );
    const rateMap = new Map<string, JsonRecord>(
      rateRows.map((row) => [toTrimmedString(row.material_id), row]),
    );
    const rows = materialIds.map((materialId) => {
      const material = materialMap.get(materialId);
      const membership = membershipMap.get(materialId);
      const rateRow = rateMap.get(materialId);
      return {
        material_id: materialId,
        row_id: rateRow ? toTrimmedString(rateRow.id) : null,
        pace_code: material ? toTrimmedString(material.pace_code) : null,
        material_name: material ? toTrimmedString(material.material_name) : null,
        base_uom_code: material ? toTrimmedString(material.base_uom_code) || null : null,
        group_member_id: membership ? toTrimmedString(membership.id) : null,
        group_id: membership ? toTrimmedString(membership.group_id) : null,
        group_name: membership ? toTrimmedString((membership.group as JsonRecord)?.name) : null,
        rate: rateRow ? Number(rateRow.rate ?? 0) : null,
        status: rateRow ? toTrimmedString(rateRow.status) : null,
      };
    });
    return okResponse({ data: sortMaterialRows(rows) }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROD_COST_RATE_LIST_FAILED";
    return costingError(req, ctx, code, 500, "Costing rate material list failed.");
  }
}

export async function saveCostingRateDraftHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    const rateMonth = normalizeRateMonth(body.rate_month);
    const lines = Array.isArray(body.lines)
      ? body.lines
        .map((row) => ({
          material_id: toTrimmedString((row as JsonRecord).material_id),
          rate: parseNonNegativeNumber((row as JsonRecord).rate),
        }))
        .filter((row) => row.material_id && row.rate !== null)
      : [];
    if (!companyId || !rateMonth || lines.length === 0) {
      return costingError(req, ctx, "PROD_COST_RATE_DRAFT_INVALID", 400, "company_id, rate_month, and at least one line are required.");
    }
    const materialIds = uniqueStrings(lines.map((row) => row.material_id));
    const { data: existingRows, error: existingError } = await serviceRoleClient
      .schema("erp_production")
      .from("costing_rate_line")
      .select("material_id, status")
      .eq("company_id", companyId)
      .eq("rate_month", rateMonth)
      .in("material_id", materialIds);
    if (existingError) throw new Error("PROD_COST_RATE_DRAFT_SAVE_FAILED");
    const approvedHit = ((existingRows ?? []) as JsonRecord[]).find((row) => toTrimmedString(row.status) === "APPROVED");
    if (approvedHit) {
      return costingError(req, ctx, "PROD_COST_RATE_MONTH_APPROVED", 409, "Approved monthly costing rates cannot be changed.");
    }
    const { data: memberships, error: membershipError } = await serviceRoleClient
      .schema("erp_production")
      .from("costing_group_member")
      .select("material_id, group_id")
      .in("material_id", materialIds);
    if (membershipError) throw new Error("PROD_COST_RATE_DRAFT_SAVE_FAILED");
    const membershipMap = new Map<string, JsonRecord>(
      ((memberships ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.material_id), row]),
    );
    const now = new Date().toISOString();
    const payload = lines.map((line) => ({
      company_id: companyId,
      material_id: line.material_id,
      rate_month: rateMonth,
      rate: line.rate,
      group_id: membershipMap.get(line.material_id)?.group_id ?? null,
      status: "DRAFT",
      created_by: ctx.auth_user_id,
      last_updated_by: ctx.auth_user_id,
      last_updated_at: now,
    }));
    const { error: upsertError } = await serviceRoleClient
      .schema("erp_production")
      .from("costing_rate_line")
      .upsert(payload, { onConflict: "company_id,material_id,rate_month" });
    if (upsertError) throw new Error("PROD_COST_RATE_DRAFT_SAVE_FAILED");
    return okResponse({ data: { company_id: companyId, rate_month: rateMonth, line_count: payload.length } }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROD_COST_RATE_DRAFT_SAVE_FAILED";
    return costingError(req, ctx, code, 500, "Costing rate draft save failed.");
  }
}

export async function listPendingCostingDraftsHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    if (!companyId) {
      return costingError(req, ctx, "PROD_COST_GROUP_COMPANY_REQUIRED", 400, "company_id is required.");
    }
    const { data, error } = await serviceRoleClient
      .schema("erp_production")
      .from("costing_rate_line")
      .select("rate_month, rate")
      .eq("company_id", companyId)
      .eq("status", "DRAFT")
      .order("rate_month", { ascending: false });
    if (error) throw new Error("PROD_COST_RATE_DRAFT_LIST_FAILED");
    const grouped = new Map<string, { rate_month: string; line_count: number; filled_count: number }>();
    for (const row of ((data ?? []) as JsonRecord[])) {
      const key = toTrimmedString(row.rate_month);
      const entry = grouped.get(key) ?? { rate_month: key, line_count: 0, filled_count: 0 };
      entry.line_count += 1;
      if (Number(row.rate ?? 0) > 0) entry.filled_count += 1;
      grouped.set(key, entry);
    }
    return okResponse({ data: [...grouped.values()] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROD_COST_RATE_DRAFT_LIST_FAILED";
    return costingError(req, ctx, code, 500, "Pending costing drafts list failed.");
  }
}

export async function listDraftCostingRateDetailHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const rateMonth = normalizeRateMonth(url.searchParams.get("rate_month"));
    if (!companyId || !rateMonth) {
      return costingError(req, ctx, "PROD_COST_RATE_DETAIL_INVALID", 400, "company_id and rate_month are required.");
    }
    const { data: draftRows, error: draftError } = await serviceRoleClient
      .schema("erp_production")
      .from("costing_rate_line")
      .select("id, material_id, rate, status, group_id")
      .eq("company_id", companyId)
      .eq("rate_month", rateMonth)
      .order("material_id", { ascending: true });
    if (draftError) throw new Error("PROD_COST_RATE_DETAIL_FAILED");
    const rows = (draftRows ?? []) as JsonRecord[];
    if (rows.length === 0) {
      return okResponse({ data: [] }, ctx.request_id, req);
    }
    const materialIds = uniqueStrings(rows.map((row) => row.material_id));
    const [materialMap, currentMembershipResult, snapshotGroupNameMap] = await Promise.all([
      getMaterialMap(materialIds),
      serviceRoleClient
        .schema("erp_production")
        .from("costing_group_member")
        .select("id, material_id, group_id, group:costing_group!inner(name)")
        .in("material_id", materialIds),
      getCostingGroupNameMap(uniqueStrings(rows.map((row) => row.group_id))),
    ]);
    if (currentMembershipResult.error) throw new Error("PROD_COST_RATE_DETAIL_FAILED");
    const currentMembershipMap = new Map<string, JsonRecord>(
      ((currentMembershipResult.data ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.material_id), row]),
    );
    const detailRows = rows.map((row) => {
      const materialId = toTrimmedString(row.material_id);
      const material = materialMap.get(materialId);
      const currentMembership = currentMembershipMap.get(materialId);
      const snapshotGroupId = toTrimmedString(row.group_id);
      return {
        id: toTrimmedString(row.id),
        material_id: materialId,
        pace_code: material ? toTrimmedString(material.pace_code) : null,
        material_name: material ? toTrimmedString(material.material_name) : null,
        base_uom_code: material ? toTrimmedString(material.base_uom_code) || null : null,
        group_id: snapshotGroupId || null,
        group_name: snapshotGroupId ? snapshotGroupNameMap.get(snapshotGroupId) ?? null : null,
        current_group_member_id: currentMembership ? toTrimmedString(currentMembership.id) : null,
        current_group_id: currentMembership ? toTrimmedString(currentMembership.group_id) : null,
        current_group_name: currentMembership ? toTrimmedString((currentMembership.group as JsonRecord)?.name) : null,
        rate: Number(row.rate ?? 0),
        status: toTrimmedString(row.status),
      };
    });
    return okResponse({ data: sortMaterialRows(detailRows) }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROD_COST_RATE_DETAIL_FAILED";
    return costingError(req, ctx, code, 500, "Costing rate draft detail failed.");
  }
}

export async function approveCostingRateHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    const rateMonth = normalizeRateMonth(body.rate_month);
    if (!companyId || !rateMonth) {
      return costingError(req, ctx, "PROD_COST_RATE_APPROVE_INVALID", 400, "company_id and rate_month are required.");
    }
    const { data: draftRows, error } = await serviceRoleClient
      .schema("erp_production")
      .from("costing_rate_line")
      .select("id, rate, created_by")
      .eq("company_id", companyId)
      .eq("rate_month", rateMonth)
      .eq("status", "DRAFT");
    if (error) throw new Error("PROD_COST_RATE_APPROVE_FAILED");
    const rows = (draftRows ?? []) as JsonRecord[];
    if (rows.length === 0) {
      return costingError(req, ctx, "PROD_COST_RATE_DRAFT_EMPTY", 409, "No draft costing rows exist for this company and month.");
    }
    if (rows.some((row) => Number(row.rate ?? 0) <= 0)) {
      return costingError(req, ctx, "PROD_COST_RATE_APPROVE_INCOMPLETE", 409, "Every drafted material must have a rate greater than zero before approval.");
    }
    await assertCostingRateApproverRole(
      ctx,
      companyId,
      rows.map((row) => row.created_by as string | null | undefined),
    );
    const approvedAt = new Date().toISOString();
    const { error: updateError } = await serviceRoleClient
      .schema("erp_production")
      .from("costing_rate_line")
      .update({
        status: "APPROVED",
        approved_by: ctx.auth_user_id,
        approved_at: approvedAt,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: approvedAt,
      })
      .eq("company_id", companyId)
      .eq("rate_month", rateMonth)
      .eq("status", "DRAFT");
    if (updateError) throw new Error("PROD_COST_RATE_APPROVE_FAILED");
    return okResponse({ data: { company_id: companyId, rate_month: rateMonth, approved_count: rows.length } }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROD_COST_RATE_APPROVE_FAILED";
    const status = code === "PROD_COST_RATE_APPROVER_ROLE_REQUIRED" || code === "PROD_COST_RATE_SELF_APPROVAL_FORBIDDEN"
      ? 403
      : 500;
    return costingError(req, ctx, code, status, "Costing rate approve failed.");
  }
}
