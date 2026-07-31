/*
 * File-ID: 27.26-BE
 * File-Path: supabase/functions/api/_core/production/costing_group.handlers.ts
 * Gate: 27.26
 * Domain: PRODUCTION / COSTING (Accounts ACL)
 * Purpose: AC06 storage-location browse-based costing group + month-wise draft/approve rate chart.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
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

function getGroupIdFromPath(req: Request): string {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("costing-groups");
  return idx >= 0 ? toTrimmedString(parts[idx + 1]) : "";
}

function getMemberIdFromPath(req: Request): string {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("members");
  return idx >= 0 ? toTrimmedString(parts[idx + 1]) : "";
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

async function getMaterialMap(materialIds: string[]): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(materialIds.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, pace_code, material_name, base_uom_code")
    .in("id", ids);
  if (error) throw new Error("PROD_COST_RATE_LIST_FAILED");
  for (const row of ((data ?? []) as JsonRecord[])) map.set(toTrimmedString(row.id), row);
  return map;
}

async function getStorageLocationMap(locationIds: string[]): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(locationIds.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_master")
    .select("id, storage_location_code, storage_location_name")
    .in("id", ids);
  if (error) throw new Error("PROD_COST_RATE_LIST_FAILED");
  for (const row of ((data ?? []) as JsonRecord[])) map.set(toTrimmedString(row.id), row);
  return map;
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
    const groupIds = ((groups ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.id)).filter(Boolean);
    const { data: members, error: memberError } = groupIds.length
      ? await serviceRoleClient
        .schema("erp_production")
        .from("costing_group_member")
        .select("id, group_id, material_id, added_from_storage_location_id, added_at")
        .in("group_id", groupIds)
      : { data: [], error: null };
    if (memberError) throw new Error("PROD_COST_GROUP_LIST_FAILED");
    const materialMap = await getMaterialMap(((members ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.material_id)));
    const locationMap = await getStorageLocationMap(((members ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.added_from_storage_location_id)));
    const membersByGroup = new Map<string, JsonRecord[]>();
    for (const row of ((members ?? []) as JsonRecord[])) {
      const key = toTrimmedString(row.group_id);
      const list = membersByGroup.get(key) ?? [];
      const material = materialMap.get(toTrimmedString(row.material_id));
      const location = locationMap.get(toTrimmedString(row.added_from_storage_location_id));
      list.push({
        ...row,
        pace_code: material ? toTrimmedString(material.pace_code) : null,
        material_name: material ? toTrimmedString(material.material_name) : null,
        storage_location_code: location ? toTrimmedString(location.storage_location_code) : null,
        storage_location_name: location ? toTrimmedString(location.storage_location_name) : null,
      });
      membersByGroup.set(key, list);
    }
    return okResponse({
      data: ((groups ?? []) as JsonRecord[]).map((row) => ({
        ...row,
        member_count: (membersByGroup.get(toTrimmedString(row.id)) ?? []).length,
        members: membersByGroup.get(toTrimmedString(row.id)) ?? [],
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
    const groupId = getGroupIdFromPath(req);
    const group = groupId ? await getGroupById(groupId) : null;
    if (!group) return costingError(req, ctx, "PROD_COST_GROUP_NOT_FOUND", 404, "Costing group not found.");
    await assertCompanyScope(ctx, toTrimmedString(group.company_id));
    const body = await parseBody(req);
    const materialIds = Array.isArray(body.material_ids)
      ? [...new Set(body.material_ids.map((value) => toTrimmedString(value)).filter(Boolean))]
      : [];
    const storageLocationId = toTrimmedString(body.storage_location_id) || null;
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
      ((existing ?? []) as JsonRecord[]).filter((row) => toTrimmedString(row.group_id) === groupId).map((row) => toTrimmedString(row.material_id)),
    );
    const inserts = materialIds
      .filter((materialId) => !existingInSameGroup.has(materialId))
      .map((material_id) => ({
        group_id: groupId,
        material_id,
        added_from_storage_location_id: storageLocationId,
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
    const groupId = getGroupIdFromPath(req);
    const memberId = getMemberIdFromPath(req);
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
    const storageLocationId = toTrimmedString(url.searchParams.get("storage_location_id"));
    const rateMonth = normalizeRateMonth(url.searchParams.get("rate_month"));
    if (!companyId || !storageLocationId) {
      return costingError(req, ctx, "PROD_COST_RATE_FILTER_INVALID", 400, "company_id and storage_location_id are required.");
    }
    if (url.searchParams.has("rate_month") && !rateMonth) {
      return costingError(req, ctx, "PROD_COST_RATE_MONTH_INVALID", 400, "rate_month must be YYYY-MM or YYYY-MM-DD.");
    }
    const { data: snapshotRows, error: snapshotError } = await serviceRoleClient
      .schema("erp_inventory")
      .from("stock_snapshot")
      .select("material_id")
      .eq("company_id", companyId)
      .eq("storage_location_id", storageLocationId);
    if (snapshotError) throw new Error("PROD_COST_RATE_LIST_FAILED");
    const materialIds = [...new Set(((snapshotRows ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.material_id)).filter(Boolean))];
    if (materialIds.length === 0) {
      return okResponse({ data: [] }, ctx.request_id, req);
    }
    const [materialMap, membershipResult, rateResult] = await Promise.all([
      getMaterialMap(materialIds),
      serviceRoleClient
        .schema("erp_production")
        .from("costing_group_member")
        .select("material_id, group_id, group:costing_group!inner(name)")
        .in("material_id", materialIds),
      rateMonth
        ? serviceRoleClient
          .schema("erp_production")
          .from("costing_rate_line")
          .select("material_id, rate, status, group_id")
          .eq("company_id", companyId)
          .eq("rate_month", rateMonth)
          .in("material_id", materialIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (membershipResult.error || rateResult.error) throw new Error("PROD_COST_RATE_LIST_FAILED");
    const membershipMap = new Map<string, JsonRecord>(((membershipResult.data ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.material_id), row]));
    const rateMap = new Map<string, JsonRecord>(((rateResult.data ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.material_id), row]));
    return okResponse({
      data: materialIds.map((materialId) => {
        const material = materialMap.get(materialId);
        const membership = membershipMap.get(materialId);
        const rateRow = rateMap.get(materialId);
        return {
          material_id: materialId,
          pace_code: material ? toTrimmedString(material.pace_code) : null,
          material_name: material ? toTrimmedString(material.material_name) : null,
          base_uom_code: material ? toTrimmedString(material.base_uom_code) || null : null,
          group_id: membership ? toTrimmedString(membership.group_id) : null,
          group_name: membership ? toTrimmedString((membership.group as JsonRecord)?.name) : null,
          rate: rateRow ? Number(rateRow.rate ?? 0) : null,
          status: rateRow ? toTrimmedString(rateRow.status) : null,
        };
      }).sort((a, b) => {
        const codeCmp = String(a.pace_code ?? "").localeCompare(String(b.pace_code ?? ""));
        return codeCmp !== 0 ? codeCmp : String(a.material_name ?? "").localeCompare(String(b.material_name ?? ""));
      }),
    }, ctx.request_id, req);
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
      ? body.lines.map((row) => ({
          material_id: toTrimmedString((row as JsonRecord).material_id),
          rate: parseNonNegativeNumber((row as JsonRecord).rate),
        })).filter((row) => row.material_id && row.rate !== null)
      : [];
    if (!companyId || !rateMonth || lines.length === 0) {
      return costingError(req, ctx, "PROD_COST_RATE_DRAFT_INVALID", 400, "company_id, rate_month, and at least one line are required.");
    }
    const materialIds = [...new Set(lines.map((row) => row.material_id))];
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
    const membershipMap = new Map<string, JsonRecord>(((memberships ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.material_id), row]));
    const payload = lines.map((line) => ({
      company_id: companyId,
      material_id: line.material_id,
      rate_month: rateMonth,
      rate: line.rate,
      group_id: membershipMap.get(line.material_id)?.group_id ?? null,
      status: "DRAFT",
      created_by: ctx.auth_user_id,
      last_updated_by: ctx.auth_user_id,
      last_updated_at: new Date().toISOString(),
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
      .select("id, rate")
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
    return costingError(req, ctx, code, 500, "Costing rate approve failed.");
  }
}
