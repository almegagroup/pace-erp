/*
 * File-Path: supabase/functions/api/_core/procurement/planning.handlers.ts
 * Purpose: PO11 monthly procurement planning workspace for ADMIX/HPS RM-PM planning.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

type PlanningWorkspaceRow = {
  material_id: string;
  material_code: string;
  material_name: string;
  material_type: string;
  base_uom_code: string;
  source_sloc_group_id: string | null;
  source_sloc_group_name: string | null;
  planning_item_group_id: string | null;
  planning_item_group_name: string | null;
  excluded_from_dashboard: boolean;
  monthly_requirement_qty: number;
  safety_days: number;
  processing_time_days: number;
  lead_time_days: number;
  replenishment_days: number;
  fixed_safety_stock_qty: number | null;
  fixed_replenishment_stock_qty: number | null;
  available_stock_qty: number;
  trn_stock_qty: number;
  ge_stock_qty: number;
  qa_stock_qty: number;
  total_stock_qty: number;
  derived_safety_stock_qty: number;
  derived_replenishment_stock_qty: number;
  effective_safety_stock_qty: number;
  effective_replenishment_stock_qty: number;
  status_tone: "NORMAL" | "WARNING" | "CRITICAL";
  display_order: number;
};

type SlocGroupSummary = {
  id: string;
  group_name: string;
  member_count: number;
  storage_locations: Array<{ id: string; code: string; name: string }>;
};

type ItemGroupSummary = {
  id: string;
  group_name: string;
  sloc_group_id: string | null;
  sloc_group_name: string | null;
};

type PlanningGroupConfig = {
  planning_item_group_id: string;
  planning_item_group_name: string;
  sloc_group_id: string | null;
  sloc_group_name: string | null;
  monthly_requirement_qty: number;
  safety_days: number;
  processing_time_days: number;
  lead_time_days: number;
  fixed_safety_stock_qty: number | null;
  fixed_replenishment_stock_qty: number | null;
};

type ArchiveGroupConfig = {
  planning_item_group_id: string | null;
  planning_item_group_name_snapshot: string;
  monthly_requirement_qty: number;
  safety_days: number;
  processing_time_days: number;
  lead_time_days: number;
  fixed_safety_stock_qty: number | null;
  fixed_replenishment_stock_qty: number | null;
};

type PlanHeader = {
  id: string;
  company_id: string;
  plan_month: string;
  status: string;
};

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}

function parseNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeQty(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number((Number.isFinite(parsed) ? parsed : 0).toFixed(6));
}

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function planningError(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

async function getCompanyScope(ctx: ProcurementHandlerContext, requestedCompanyId?: string): Promise<string> {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  const companyId = toTrimmedString(requestedCompanyId) || scopedCompanyId;
  if (companyId) await assertCompanyScope(ctx, companyId);
  return companyId;
}

function getPathId(req: Request, marker: string): string {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = parts.indexOf(marker);
  return idx >= 0 ? toTrimmedString(parts[idx + 1]) : "";
}

function normalizePlanMonth(raw: unknown): string | null {
  const value = toTrimmedString(raw);
  if (!value) return null;
  const exactMonth = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exactMonth)) return null;
  const date = new Date(`${exactMonth}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function getCurrentPlanMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function getMonthStart(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function addMonths(planMonth: string, delta: number): string {
  const date = getMonthStart(planMonth);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function getDaysInMonth(planMonth: string): number {
  const date = getMonthStart(planMonth);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

async function getPlanHeader(companyId: string, planMonth: string): Promise<PlanHeader | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("procurement_monthly_plan")
    .select("id, company_id, plan_month, status")
    .eq("company_id", companyId)
    .eq("plan_month", planMonth)
    .maybeSingle();
  if (error) throw new Error("PROCUREMENT_PLANNING_PLAN_LOOKUP_FAILED");
  return ((data as JsonRecord | null) ?? null) as PlanHeader | null;
}

async function getPreviousPlan(companyId: string, planMonth: string): Promise<PlanHeader | null> {
  const previousMonth = addMonths(planMonth, -1);
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("procurement_monthly_plan")
    .select("id, company_id, plan_month, status")
    .eq("company_id", companyId)
    .eq("plan_month", previousMonth)
    .maybeSingle();
  if (error) throw new Error("PROCUREMENT_PLANNING_PREVIOUS_PLAN_LOOKUP_FAILED");
  return ((data as JsonRecord | null) ?? null) as PlanHeader | null;
}

async function loadPlanLines(planId: string): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("procurement_monthly_plan_line")
    .select("*")
    .eq("plan_id", planId);
  if (error) throw new Error("PROCUREMENT_PLANNING_PLAN_LINES_FAILED");
  return (data ?? []) as JsonRecord[];
}

async function loadPlanGroupConfigRows(planId: string): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("procurement_monthly_plan_group_config")
    .select("*")
    .eq("plan_id", planId);
  if (error) throw new Error("PROCUREMENT_PLANNING_GROUP_CONFIG_FAILED");
  return (data ?? []) as JsonRecord[];
}

async function getMaterialDefaultLeadTimes(companyId: string, materialIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(materialIds.filter(Boolean))];
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_plant_ext")
    .select("material_id, lead_time_days, status")
    .eq("company_id", companyId)
    .eq("status", "ACTIVE")
    .in("material_id", ids);
  if (error) throw new Error("PROCUREMENT_PLANNING_LEADTIME_FAILED");
  for (const row of ((data ?? []) as JsonRecord[])) {
    const materialId = toTrimmedString(row.material_id);
    const lead = Math.max(0, Number(row.lead_time_days ?? 0) || 0);
    map.set(materialId, Math.max(map.get(materialId) ?? 0, lead));
  }
  return map;
}

async function ensurePlanExists(
  ctx: ProcurementHandlerContext,
  companyId: string,
  planMonth: string,
): Promise<PlanHeader> {
  const existing = await getPlanHeader(companyId, planMonth);
  if (existing) return existing;

  const previousPlan = await getPreviousPlan(companyId, planMonth);
  const { data: inserted, error: insertError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("procurement_monthly_plan")
    .insert({
      company_id: companyId,
      plan_month: planMonth,
      carry_forward_from_plan_id: previousPlan?.id ?? null,
      created_by: ctx.auth_user_id,
      last_updated_by: ctx.auth_user_id,
      last_updated_at: new Date().toISOString(),
    })
    .select("id, company_id, plan_month, status")
    .single();
  if (insertError) throw new Error("PROCUREMENT_PLANNING_PLAN_CREATE_FAILED");
  const created = inserted as PlanHeader;

  if (previousPlan?.id) {
    const [previousLines, previousGroupConfigs] = await Promise.all([
      loadPlanLines(previousPlan.id),
      loadPlanGroupConfigRows(previousPlan.id),
    ]);
    if (previousLines.length > 0) {
      const clonedLines = previousLines.map((row) => ({
        plan_id: created.id,
        company_id: companyId,
        material_id: row.material_id,
        source_sloc_group_id: row.source_sloc_group_id ?? null,
        planning_item_group_id: row.planning_item_group_id ?? null,
        excluded_from_dashboard: Boolean(row.excluded_from_dashboard),
        monthly_requirement_qty: normalizeQty(row.monthly_requirement_qty),
        safety_days: normalizeQty(row.safety_days),
        processing_time_days: normalizeQty(row.processing_time_days),
        lead_time_days: normalizeQty(row.lead_time_days),
        fixed_safety_stock_qty: parseNullableNumber(row.fixed_safety_stock_qty),
        fixed_replenishment_stock_qty: parseNullableNumber(row.fixed_replenishment_stock_qty),
        display_order: Number(row.display_order ?? 0) || 0,
        auto_included: Boolean(row.auto_included),
        created_by: ctx.auth_user_id,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: new Date().toISOString(),
      }));
      const { error: cloneError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("procurement_monthly_plan_line")
        .insert(clonedLines);
      if (cloneError) throw new Error("PROCUREMENT_PLANNING_CARRY_FORWARD_FAILED");
    }
    if (previousGroupConfigs.length > 0) {
      const clonedGroupConfigs = previousGroupConfigs.map((row) => ({
        plan_id: created.id,
        company_id: companyId,
        planning_item_group_id: row.planning_item_group_id,
        monthly_requirement_qty: normalizeQty(row.monthly_requirement_qty),
        safety_days: normalizeQty(row.safety_days),
        processing_time_days: normalizeQty(row.processing_time_days),
        lead_time_days: normalizeQty(row.lead_time_days),
        fixed_safety_stock_qty: parseNullableNumber(row.fixed_safety_stock_qty),
        fixed_replenishment_stock_qty: parseNullableNumber(row.fixed_replenishment_stock_qty),
        created_by: ctx.auth_user_id,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: new Date().toISOString(),
      }));
      const { error: configCloneError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("procurement_monthly_plan_group_config")
        .insert(clonedGroupConfigs);
      if (configCloneError) throw new Error("PROCUREMENT_PLANNING_GROUP_CONFIG_CARRY_FORWARD_FAILED");
    }
  }

  return created;
}

async function loadSlocGroups(companyId: string): Promise<JsonRecord[]> {
  const { data: groups, error: groupError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("planning_sloc_group")
    .select("id, company_id, group_name, active")
    .eq("company_id", companyId)
    .eq("active", true)
    .order("group_name", { ascending: true });
  if (groupError) throw new Error("PROCUREMENT_PLANNING_SLOC_GROUPS_FAILED");
  return (groups ?? []) as JsonRecord[];
}

async function loadSlocGroupMembersByIds(groupIds: string[]): Promise<JsonRecord[]> {
  if (groupIds.length === 0) return [];
  const { data: members, error: memberError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("planning_sloc_group_member")
    .select("id, sloc_group_id, storage_location_id, active")
    .in("sloc_group_id", groupIds)
    .eq("active", true)
    .order("added_at", { ascending: true });
  if (memberError) throw new Error("PROCUREMENT_PLANNING_SLOC_GROUPS_FAILED");
  return (members ?? []) as JsonRecord[];
}

async function loadStorageLocationLookup(
  locationIds: string[],
  options?: { activeOnly?: boolean },
): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(locationIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  let query = serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_master")
    .select("id, code, name, active")
    .in("id", ids);
  if (options?.activeOnly) {
    query = query.eq("active", true);
  }
  const { data: locations, error: locationError } = await query;
  if (locationError) throw new Error("PROCUREMENT_PLANNING_SLOC_GROUPS_FAILED");
  return new Map(((locations ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.id), row]));
}

async function loadSlocGroupMembers(companyId: string): Promise<JsonRecord[]> {
  const groupRows = await loadSlocGroups(companyId);
  const groupIds = groupRows.map((row) => toTrimmedString(row.id)).filter(Boolean);
  if (groupIds.length === 0) return [];

  const memberRows = await loadSlocGroupMembersByIds(groupIds);
  const locationIds = [...new Set(memberRows.map((row) => toTrimmedString(row.storage_location_id)).filter(Boolean))];
  const groupById = new Map(groupRows.map((row) => [toTrimmedString(row.id), row]));
  const locationById = await loadStorageLocationLookup(locationIds);

  return memberRows
    .map((row) => {
      const slocGroupId = toTrimmedString(row.sloc_group_id);
      const storageLocationId = toTrimmedString(row.storage_location_id);
      const group = groupById.get(slocGroupId) ?? null;
      const location = locationById.get(storageLocationId) ?? null;
      return {
        ...row,
        planning_sloc_group: group,
        storage_location_master: location,
      } as JsonRecord;
    })
    .filter((row) => row.planning_sloc_group);
}

async function loadItemGroups(companyId: string): Promise<ItemGroupSummary[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("planning_item_group")
    .select("id, group_name, sloc_group_id, planning_sloc_group:sloc_group_id(group_name)")
    .eq("company_id", companyId)
    .eq("active", true)
    .order("group_name", { ascending: true });
  if (error) throw new Error("PROCUREMENT_PLANNING_ITEM_GROUPS_FAILED");
  return ((data ?? []) as JsonRecord[]).map((row) => {
    const slocGroup = (row.planning_sloc_group as JsonRecord | null) ?? null;
    return {
      id: toTrimmedString(row.id),
      group_name: toTrimmedString(row.group_name),
      sloc_group_id: toTrimmedString(row.sloc_group_id) || null,
      sloc_group_name: toTrimmedString(slocGroup?.group_name) || null,
    };
  });
}

function buildPlanningGroupConfigs(
  configRows: JsonRecord[],
  itemGroups: ItemGroupSummary[],
): PlanningGroupConfig[] {
  const itemGroupById = new Map(itemGroups.map((group) => [group.id, group]));
  return configRows
    .map((row) => {
      const planningItemGroupId = toTrimmedString(row.planning_item_group_id);
      const itemGroup = itemGroupById.get(planningItemGroupId);
      if (!planningItemGroupId || !itemGroup) return null;
      return {
        planning_item_group_id: planningItemGroupId,
        planning_item_group_name: itemGroup.group_name,
        sloc_group_id: itemGroup.sloc_group_id,
        sloc_group_name: itemGroup.sloc_group_name,
        monthly_requirement_qty: normalizeQty(row.monthly_requirement_qty),
        safety_days: normalizeQty(row.safety_days),
        processing_time_days: normalizeQty(row.processing_time_days),
        lead_time_days: normalizeQty(row.lead_time_days),
        fixed_safety_stock_qty: parseNullableNumber(row.fixed_safety_stock_qty),
        fixed_replenishment_stock_qty: parseNullableNumber(row.fixed_replenishment_stock_qty),
      } satisfies PlanningGroupConfig;
    })
    .filter((row): row is PlanningGroupConfig => Boolean(row))
    .sort((left, right) => left.planning_item_group_name.localeCompare(right.planning_item_group_name));
}

function buildSlocGroupSummaries(groups: JsonRecord[], rows: JsonRecord[]): SlocGroupSummary[] {
  const map = new Map<string, SlocGroupSummary>(
    groups.map((group) => [
      toTrimmedString(group.id),
      {
        id: toTrimmedString(group.id),
        group_name: toTrimmedString(group.group_name),
        member_count: 0,
        storage_locations: [],
      },
    ]),
  );
  for (const row of rows) {
    const group = (row.planning_sloc_group as JsonRecord | null) ?? null;
    const location = (row.storage_location_master as JsonRecord | null) ?? null;
    const groupId = toTrimmedString(group?.id);
    if (!groupId || !map.has(groupId)) continue;
    const current = map.get(groupId)!;
    current.member_count += 1;
    if (location) {
      current.storage_locations.push({
        id: toTrimmedString(location.id),
        code: toTrimmedString(location.code),
        name: toTrimmedString(location.name),
      });
    }
  }
  return [...map.values()].sort((left, right) => left.group_name.localeCompare(right.group_name));
}

async function getEligibleMaterialRows(companyId: string): Promise<Array<{ material_id: string; source_sloc_group_id: string | null }>> {
  const slocRows = await loadSlocGroupMembers(companyId);
  const activeSlocIds = [...new Set(
    slocRows
      .filter((row) => ((row.storage_location_master as JsonRecord | null)?.active ?? false) === true)
      .map((row) => toTrimmedString(row.storage_location_id))
      .filter(Boolean),
  )];
  if (activeSlocIds.length === 0) return [];

  const slocGroupByLocationId = new Map<string, string>();
  for (const row of slocRows) {
    const locationId = toTrimmedString(row.storage_location_id);
    const group = (row.planning_sloc_group as JsonRecord | null) ?? null;
    const groupId = toTrimmedString(group?.id);
    if (locationId && groupId && !slocGroupByLocationId.has(locationId)) {
      slocGroupByLocationId.set(locationId, groupId);
    }
  }

  const { data: plantExtRows, error: plantExtError } = await serviceRoleClient
    .schema("erp_master")
    .from("material_plant_ext")
    .select("material_id, default_storage_location_id, status")
    .eq("company_id", companyId)
    .eq("status", "ACTIVE")
    .in("default_storage_location_id", activeSlocIds);
  if (plantExtError) throw new Error("PROCUREMENT_PLANNING_ELIGIBLE_PLANT_EXT_FAILED");

  const eligiblePlantRows = (plantExtRows ?? []) as JsonRecord[];
  const materialIds = [...new Set(eligiblePlantRows.map((row) => toTrimmedString(row.material_id)).filter(Boolean))];
  if (materialIds.length === 0) return [];

  const { data: materialRows, error: materialError } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, material_type")
    .in("id", materialIds)
    .in("material_type", ["RM", "PM"]);
  if (materialError) throw new Error("PROCUREMENT_PLANNING_ELIGIBLE_MATERIAL_FAILED");

  const allowedMaterialIds = new Set(((materialRows ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.id)).filter(Boolean));

  const { data: companyExtRows, error: companyExtError } = await serviceRoleClient
    .schema("erp_master")
    .from("material_company_ext")
    .select("material_id, procurement_allowed, status")
    .eq("company_id", companyId)
    .eq("status", "ACTIVE")
    .eq("procurement_allowed", true)
    .in("material_id", [...allowedMaterialIds]);
  if (companyExtError) throw new Error("PROCUREMENT_PLANNING_ELIGIBLE_COMPANY_EXT_FAILED");

  const companyAllowed = new Set(((companyExtRows ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.material_id)).filter(Boolean));
  const resultMap = new Map<string, { material_id: string; source_sloc_group_id: string | null }>();
  for (const row of eligiblePlantRows) {
    const materialId = toTrimmedString(row.material_id);
    const locationId = toTrimmedString(row.default_storage_location_id);
    if (!companyAllowed.has(materialId) || resultMap.has(materialId)) continue;
    resultMap.set(materialId, {
      material_id: materialId,
      source_sloc_group_id: slocGroupByLocationId.get(locationId) ?? null,
    });
  }
  return [...resultMap.values()];
}

async function ensureAutoIncludedPlanLines(
  ctx: ProcurementHandlerContext,
  companyId: string,
  planMonth: string,
  planId: string,
): Promise<void> {
  const [existingLines, eligibleRows, itemGroups] = await Promise.all([
    loadPlanLines(planId),
    getEligibleMaterialRows(companyId),
    loadItemGroups(companyId),
  ]);
  const existingMaterialIds = new Set(existingLines.map((row) => toTrimmedString(row.material_id)).filter(Boolean));
  const eligibleByMaterialId = new Map(eligibleRows.map((row) => [row.material_id, row]));
  const itemGroupScopeById = new Map(
    itemGroups.map((group) => [group.id, group.sloc_group_id || null]),
  );

  for (const row of existingLines) {
    const materialId = toTrimmedString(row.material_id);
    const eligible = eligibleByMaterialId.get(materialId);
    if (!eligible) continue;
    const currentSourceSlocGroupId = toTrimmedString(row.source_sloc_group_id) || null;
    const nextSourceSlocGroupId = eligible.source_sloc_group_id || null;
    const currentItemGroupId = toTrimmedString(row.planning_item_group_id) || null;
    const currentItemGroupScopeId = currentItemGroupId
      ? itemGroupScopeById.get(currentItemGroupId) || null
      : null;
    if (
      currentSourceSlocGroupId === nextSourceSlocGroupId &&
      (!currentItemGroupId || currentItemGroupScopeId === nextSourceSlocGroupId)
    ) {
      continue;
    }
    const updatePayload: JsonRecord = {
      source_sloc_group_id: nextSourceSlocGroupId,
      last_updated_by: ctx.auth_user_id,
      last_updated_at: new Date().toISOString(),
    };
    if (currentItemGroupId && currentItemGroupScopeId !== nextSourceSlocGroupId) {
      updatePayload.planning_item_group_id = null;
    }
    const { error: syncError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("procurement_monthly_plan_line")
      .update(updatePayload)
      .eq("id", toTrimmedString(row.id));
    if (syncError) throw new Error("PROCUREMENT_PLANNING_SCOPE_SYNC_FAILED");
  }

  const missingRows = eligibleRows.filter((row) => !existingMaterialIds.has(row.material_id));
  if (missingRows.length === 0) return;

  const leadTimeMap = await getMaterialDefaultLeadTimes(companyId, missingRows.map((row) => row.material_id));
  const priorPlan = await getPreviousPlan(companyId, planMonth);
  const priorLines = priorPlan?.id ? await loadPlanLines(priorPlan.id) : [];
  const priorByMaterialId = new Map(priorLines.map((row) => [toTrimmedString(row.material_id), row]));

  const inserts = missingRows.map((row, index) => {
    const prior = priorByMaterialId.get(row.material_id);
    const priorPlanningItemGroupId = toTrimmedString(prior?.planning_item_group_id) || null;
    const priorPlanningItemGroupScopeId = priorPlanningItemGroupId
      ? itemGroupScopeById.get(priorPlanningItemGroupId) || null
      : null;
    const carriedPlanningItemGroupId =
      priorPlanningItemGroupId && priorPlanningItemGroupScopeId === (row.source_sloc_group_id || null)
        ? priorPlanningItemGroupId
        : null;
    return {
      plan_id: planId,
      company_id: companyId,
      material_id: row.material_id,
      source_sloc_group_id: row.source_sloc_group_id,
      planning_item_group_id: carriedPlanningItemGroupId,
      excluded_from_dashboard: Boolean(prior?.excluded_from_dashboard),
      monthly_requirement_qty: normalizeQty(prior?.monthly_requirement_qty),
      safety_days: normalizeQty(prior?.safety_days),
      processing_time_days: normalizeQty(prior?.processing_time_days),
      lead_time_days: prior ? normalizeQty(prior.lead_time_days) : normalizeQty(leadTimeMap.get(row.material_id) ?? 0),
      fixed_safety_stock_qty: parseNullableNumber(prior?.fixed_safety_stock_qty),
      fixed_replenishment_stock_qty: parseNullableNumber(prior?.fixed_replenishment_stock_qty),
      display_order: Number(prior?.display_order ?? (1000 + index)) || (1000 + index),
      auto_included: true,
      created_by: ctx.auth_user_id,
      last_updated_by: ctx.auth_user_id,
      last_updated_at: new Date().toISOString(),
    };
  });

  const { error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("procurement_monthly_plan_line")
    .insert(inserts);
  if (error) throw new Error("PROCUREMENT_PLANNING_AUTO_INCLUDE_FAILED");
}

async function loadMaterialMap(materialIds: string[]): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(materialIds.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, pace_code, material_name, base_uom_code, material_type")
    .in("id", ids);
  if (error) throw new Error("PROCUREMENT_PLANNING_MATERIAL_MAP_FAILED");
  for (const row of ((data ?? []) as JsonRecord[])) {
    map.set(toTrimmedString(row.id), row);
  }
  return map;
}

async function loadWorkspaceRows(
  ctx: ProcurementHandlerContext,
  companyId: string,
  planMonth: string,
  planId: string,
): Promise<{
  rows: PlanningWorkspaceRow[];
  slocGroups: SlocGroupSummary[];
  itemGroups: ItemGroupSummary[];
  groupConfigs: PlanningGroupConfig[];
}> {
  await ensureAutoIncludedPlanLines(ctx, companyId, planMonth, planId);

  const [planLines, slocGroupsRaw, slocRows, itemGroups, groupConfigRows] = await Promise.all([
    loadPlanLines(planId),
    loadSlocGroups(companyId),
    loadSlocGroupMembers(companyId),
    loadItemGroups(companyId),
    loadPlanGroupConfigRows(planId),
  ]);

  const slocGroups = buildSlocGroupSummaries(slocGroupsRaw, slocRows);
  const groupConfigs = buildPlanningGroupConfigs(groupConfigRows, itemGroups);
  const slocGroupNameById = new Map(slocGroups.map((group) => [group.id, group.group_name]));
  const itemGroupNameById = new Map(itemGroups.map((group) => [group.id, group.group_name]));
  const activeSlocIds = [...new Set(slocRows.map((row) => toTrimmedString(row.storage_location_id)).filter(Boolean))];
  const materialIds = [...new Set(planLines.map((row) => toTrimmedString(row.material_id)).filter(Boolean))];

  const [materialMap, snapshotRows, trnRows, geRows] = await Promise.all([
    loadMaterialMap(materialIds),
    materialIds.length === 0 || activeSlocIds.length === 0
      ? Promise.resolve([] as JsonRecord[])
      : serviceRoleClient
        .schema("erp_inventory")
        .from("stock_snapshot")
        .select("material_id, stock_type_code, quantity, storage_location_id")
        .eq("company_id", companyId)
        .in("material_id", materialIds)
        .in("storage_location_id", activeSlocIds)
        .then(({ data, error }) => {
          if (error) throw new Error("PROCUREMENT_PLANNING_STOCK_FAILED");
          return (data ?? []) as JsonRecord[];
        }),
    materialIds.length === 0
      ? Promise.resolve([] as JsonRecord[])
      : serviceRoleClient
        .schema("erp_procurement")
        .from("consignment_note")
        .select("material_id, dispatch_qty, purchase_order!inner(company_id)")
        .eq("status", "TRN")
        .eq("purchase_order.company_id", companyId)
        .in("material_id", materialIds)
        .then(({ data, error }) => {
          if (error) throw new Error("PROCUREMENT_PLANNING_TRN_FAILED");
          return (data ?? []) as JsonRecord[];
        }),
    materialIds.length === 0
      ? Promise.resolve([] as JsonRecord[])
      : serviceRoleClient
        .schema("erp_procurement")
        .from("gate_entry_line")
        .select("material_id, ge_qty, grn_posted, gate_entry!inner(company_id, status)")
        .eq("gate_entry.company_id", companyId)
        .eq("gate_entry.status", "OPEN")
        .eq("grn_posted", false)
        .in("material_id", materialIds)
        .then(({ data, error }) => {
          if (error) throw new Error("PROCUREMENT_PLANNING_GE_FAILED");
          return (data ?? []) as JsonRecord[];
        }),
  ]);

  const availableMap = new Map<string, number>();
  const qaMap = new Map<string, number>();
  for (const row of snapshotRows) {
    const materialId = toTrimmedString(row.material_id);
    const stockType = toUpperTrimmedString(row.stock_type_code);
    const quantity = normalizeQty(row.quantity);
    if (stockType === "UNRESTRICTED") {
      availableMap.set(materialId, normalizeQty((availableMap.get(materialId) ?? 0) + quantity));
    } else if (stockType === "QUALITY_INSPECTION") {
      qaMap.set(materialId, normalizeQty((qaMap.get(materialId) ?? 0) + quantity));
    }
  }

  const trnMap = new Map<string, number>();
  for (const row of trnRows) {
    const materialId = toTrimmedString(row.material_id);
    trnMap.set(materialId, normalizeQty((trnMap.get(materialId) ?? 0) + normalizeQty(row.dispatch_qty)));
  }

  const geMap = new Map<string, number>();
  for (const row of geRows) {
    const materialId = toTrimmedString(row.material_id);
    geMap.set(materialId, normalizeQty((geMap.get(materialId) ?? 0) + normalizeQty(row.ge_qty)));
  }

  const daysInMonth = getDaysInMonth(planMonth);
  const rows: PlanningWorkspaceRow[] = planLines.map((row) => {
    const materialId = toTrimmedString(row.material_id);
    const material = materialMap.get(materialId) ?? {};
    const monthlyRequirementQty = normalizeQty(row.monthly_requirement_qty);
    const safetyDays = normalizeQty(row.safety_days);
    const processingTimeDays = normalizeQty(row.processing_time_days);
    const leadTimeDays = normalizeQty(row.lead_time_days);
    const replenishmentDays = normalizeQty(processingTimeDays + leadTimeDays);
    const dailyRequirement = daysInMonth > 0 ? monthlyRequirementQty / daysInMonth : 0;
    const derivedSafetyStockQty = normalizeQty(dailyRequirement * safetyDays);
    const derivedReplenishmentStockQty = normalizeQty(
      derivedSafetyStockQty + (dailyRequirement * replenishmentDays),
    );
    const fixedSafety = parseNullableNumber(row.fixed_safety_stock_qty);
    const fixedReplenishment = parseNullableNumber(row.fixed_replenishment_stock_qty);
    const effectiveSafetyStockQty = normalizeQty(fixedSafety ?? derivedSafetyStockQty);
    const effectiveReplenishmentStockQty = normalizeQty(fixedReplenishment ?? derivedReplenishmentStockQty);
    const availableStockQty = normalizeQty(availableMap.get(materialId) ?? 0);
    const trnStockQty = normalizeQty(trnMap.get(materialId) ?? 0);
    const geStockQty = normalizeQty(geMap.get(materialId) ?? 0);
    const qaStockQty = normalizeQty(qaMap.get(materialId) ?? 0);
    const totalStockQty = normalizeQty(availableStockQty + trnStockQty + geStockQty + qaStockQty);
    let statusTone: "NORMAL" | "WARNING" | "CRITICAL" = "NORMAL";
    if (totalStockQty <= effectiveSafetyStockQty) {
      statusTone = "CRITICAL";
    } else if (totalStockQty <= effectiveReplenishmentStockQty) {
      statusTone = "WARNING";
    }
    return {
      material_id: materialId,
      material_code: toTrimmedString(material.pace_code),
      material_name: toTrimmedString(material.material_name),
      material_type: toTrimmedString(material.material_type),
      base_uom_code: toTrimmedString(material.base_uom_code),
      source_sloc_group_id: toTrimmedString(row.source_sloc_group_id) || null,
      source_sloc_group_name: slocGroupNameById.get(toTrimmedString(row.source_sloc_group_id)) ?? null,
      planning_item_group_id: toTrimmedString(row.planning_item_group_id) || null,
      planning_item_group_name: itemGroupNameById.get(toTrimmedString(row.planning_item_group_id)) ?? null,
      excluded_from_dashboard: Boolean(row.excluded_from_dashboard),
      monthly_requirement_qty: monthlyRequirementQty,
      safety_days: safetyDays,
      processing_time_days: processingTimeDays,
      lead_time_days: leadTimeDays,
      replenishment_days: replenishmentDays,
      fixed_safety_stock_qty: fixedSafety,
      fixed_replenishment_stock_qty: fixedReplenishment,
      available_stock_qty: availableStockQty,
      trn_stock_qty: trnStockQty,
      ge_stock_qty: geStockQty,
      qa_stock_qty: qaStockQty,
      total_stock_qty: totalStockQty,
      derived_safety_stock_qty: derivedSafetyStockQty,
      derived_replenishment_stock_qty: derivedReplenishmentStockQty,
      effective_safety_stock_qty: effectiveSafetyStockQty,
      effective_replenishment_stock_qty: effectiveReplenishmentStockQty,
      status_tone: statusTone,
      display_order: Number(row.display_order ?? 0) || 0,
    };
  });

  rows.sort((left, right) => {
    const leftGroup = left.planning_item_group_name ?? "~";
    const rightGroup = right.planning_item_group_name ?? "~";
    const groupCmp = leftGroup.localeCompare(rightGroup);
    if (groupCmp !== 0) return groupCmp;
    const orderCmp = left.display_order - right.display_order;
    if (orderCmp !== 0) return orderCmp;
    const codeCmp = left.material_code.localeCompare(right.material_code);
    if (codeCmp !== 0) return codeCmp;
    return left.material_name.localeCompare(right.material_name);
  });

  return { rows, slocGroups, itemGroups, groupConfigs };
}

export async function getProcurementPlanningHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? "");
    if (!companyId) {
      return okResponse(req, { plan: null, rows: [], sloc_groups: [], item_groups: [], group_configs: [] }, ctx.request_id);
    }
    const planMonth = normalizePlanMonth(url.searchParams.get("plan_month")) ?? getCurrentPlanMonth();
    const plan = await ensurePlanExists(ctx, companyId, planMonth);
    const workspace = await loadWorkspaceRows(ctx, companyId, planMonth, plan.id);
    return okResponse(req, {
      plan,
      plan_month: planMonth,
      rows: workspace.rows,
      sloc_groups: workspace.slocGroups,
      item_groups: workspace.itemGroups,
      group_configs: workspace.groupConfigs,
    }, ctx.request_id);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROCUREMENT_PLANNING_WORKSPACE_FAILED";
    return planningError(req, ctx, code, 500, "Unable to load procurement planning workspace.");
  }
}

export async function upsertProcurementPlanningLinesHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, body.company_id);
    const planMonth = normalizePlanMonth(body.plan_month) ?? getCurrentPlanMonth();
    const lines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];
    const groupConfigs = Array.isArray(body.group_configs) ? (body.group_configs as JsonRecord[]) : [];
    if (!companyId || lines.length === 0) {
      return planningError(req, ctx, "PROCUREMENT_PLANNING_LINES_INVALID", 400, "company_id and lines are required.");
    }
    const plan = await ensurePlanExists(ctx, companyId, planMonth);
    if (plan.status === "CLOSED") {
      return planningError(req, ctx, "PROCUREMENT_PLANNING_PLAN_CLOSED", 409, "Closed month cannot be edited.");
    }
    await ensureAutoIncludedPlanLines(ctx, companyId, planMonth, plan.id);
    const existingLines = await loadPlanLines(plan.id);
    const existingByMaterialId = new Map(existingLines.map((row) => [toTrimmedString(row.material_id), row]));
    const itemGroups = await loadItemGroups(companyId);
    const allowedItemGroupIds = new Set(itemGroups.map((group) => group.id));
    const itemGroupScopeById = new Map(itemGroups.map((group) => [group.id, group.sloc_group_id || null]));
    const existingGroupConfigRows = await loadPlanGroupConfigRows(plan.id);
    const existingGroupConfigByGroupId = new Map(
      existingGroupConfigRows.map((row) => [toTrimmedString(row.planning_item_group_id), row]),
    );

    const materialIds = [...new Set(lines.map((line) => toTrimmedString(line.material_id)).filter(Boolean))];
    const leadTimeMap = await getMaterialDefaultLeadTimes(companyId, materialIds);
    const inserts: JsonRecord[] = [];
    for (const line of lines) {
      const materialId = toTrimmedString(line.material_id);
      if (!materialId) continue;
      const planningItemGroupId = toTrimmedString(line.planning_item_group_id) || null;
      if (planningItemGroupId && !allowedItemGroupIds.has(planningItemGroupId)) {
        return planningError(req, ctx, "PROCUREMENT_PLANNING_ITEM_GROUP_INVALID", 422, "Selected item group does not belong to the company.");
      }
      const sourceSlocGroupId =
        toTrimmedString(line.source_sloc_group_id) ||
        toTrimmedString(existingByMaterialId.get(materialId)?.source_sloc_group_id) ||
        null;
      if (
        planningItemGroupId &&
        sourceSlocGroupId &&
        itemGroupScopeById.get(planningItemGroupId) !== sourceSlocGroupId
      ) {
        return planningError(
          req,
          ctx,
          "PROCUREMENT_PLANNING_ITEM_GROUP_SCOPE_MISMATCH",
          422,
          "Selected item group does not belong to the material's SLOC group scope.",
        );
      }
      const payload = {
        planning_item_group_id: planningItemGroupId,
        excluded_from_dashboard: Boolean(line.excluded_from_dashboard),
        monthly_requirement_qty: normalizeQty(line.monthly_requirement_qty),
        safety_days: normalizeQty(line.safety_days),
        processing_time_days: normalizeQty(line.processing_time_days),
        lead_time_days: normalizeQty(line.lead_time_days ?? leadTimeMap.get(materialId) ?? 0),
        fixed_safety_stock_qty: parseNullableNumber(line.fixed_safety_stock_qty),
        fixed_replenishment_stock_qty: parseNullableNumber(line.fixed_replenishment_stock_qty),
        display_order: Number(line.display_order ?? existingByMaterialId.get(materialId)?.display_order ?? 0) || 0,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: new Date().toISOString(),
      };
      if (existingByMaterialId.has(materialId)) {
        const { error } = await serviceRoleClient
          .schema("erp_procurement")
          .from("procurement_monthly_plan_line")
          .update(payload)
          .eq("id", toTrimmedString(existingByMaterialId.get(materialId)?.id));
        if (error) throw new Error("PROCUREMENT_PLANNING_LINE_UPDATE_FAILED");
      } else {
        inserts.push({
          plan_id: plan.id,
          company_id: companyId,
          material_id: materialId,
          source_sloc_group_id: null,
          auto_included: false,
          created_by: ctx.auth_user_id,
          ...payload,
        });
      }
    }
    if (inserts.length > 0) {
      const { error } = await serviceRoleClient
        .schema("erp_procurement")
        .from("procurement_monthly_plan_line")
        .insert(inserts);
      if (error) throw new Error("PROCUREMENT_PLANNING_LINE_INSERT_FAILED");
    }
    for (const config of groupConfigs) {
      const planningItemGroupId = toTrimmedString(config.planning_item_group_id);
      if (!planningItemGroupId) continue;
      if (!allowedItemGroupIds.has(planningItemGroupId)) {
        return planningError(
          req,
          ctx,
          "PROCUREMENT_PLANNING_ITEM_GROUP_INVALID",
          422,
          "Selected item group does not belong to the company.",
        );
      }
      const payload = {
        monthly_requirement_qty: normalizeQty(config.monthly_requirement_qty),
        safety_days: normalizeQty(config.safety_days),
        processing_time_days: normalizeQty(config.processing_time_days),
        lead_time_days: normalizeQty(config.lead_time_days),
        fixed_safety_stock_qty: parseNullableNumber(config.fixed_safety_stock_qty),
        fixed_replenishment_stock_qty: parseNullableNumber(config.fixed_replenishment_stock_qty),
        last_updated_by: ctx.auth_user_id,
        last_updated_at: new Date().toISOString(),
      };
      const existingConfig = existingGroupConfigByGroupId.get(planningItemGroupId);
      if (existingConfig) {
        const { error } = await serviceRoleClient
          .schema("erp_procurement")
          .from("procurement_monthly_plan_group_config")
          .update(payload)
          .eq("id", toTrimmedString(existingConfig.id));
        if (error) throw new Error("PROCUREMENT_PLANNING_GROUP_CONFIG_UPDATE_FAILED");
      } else {
        const { error } = await serviceRoleClient
          .schema("erp_procurement")
          .from("procurement_monthly_plan_group_config")
          .insert({
            plan_id: plan.id,
            company_id: companyId,
            planning_item_group_id: planningItemGroupId,
            created_by: ctx.auth_user_id,
            ...payload,
          });
        if (error) throw new Error("PROCUREMENT_PLANNING_GROUP_CONFIG_INSERT_FAILED");
      }
    }
    const workspace = await loadWorkspaceRows(ctx, companyId, planMonth, plan.id);
    return okResponse(
      req,
      {
        plan,
        plan_month: planMonth,
        rows: workspace.rows,
        group_configs: workspace.groupConfigs,
      },
      ctx.request_id,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROCUREMENT_PLANNING_LINES_SAVE_FAILED";
    return planningError(req, ctx, code, 500, "Unable to save procurement planning lines.");
  }
}

export async function listPlanningSlocGroupsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const companyId = await getCompanyScope(ctx, new URL(req.url).searchParams.get("company_id") ?? "");
    if (!companyId) return okResponse(req, { items: [] }, ctx.request_id);
    const [groupRows, memberRows] = await Promise.all([
      loadSlocGroups(companyId),
      loadSlocGroupMembers(companyId),
    ]);
    const groups = buildSlocGroupSummaries(groupRows, memberRows);
    return okResponse(req, { items: groups }, ctx.request_id);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROCUREMENT_PLANNING_SLOC_GROUP_LIST_FAILED";
    return planningError(req, ctx, code, 500, "Unable to load planning storage-location groups.");
  }
}

export async function createPlanningSlocGroupHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, body.company_id);
    const groupName = toTrimmedString(body.group_name);
    const storageLocationIds = Array.isArray(body.storage_location_ids)
      ? [...new Set((body.storage_location_ids as unknown[]).map((value) => toTrimmedString(value)).filter(Boolean))]
      : [];
    if (!companyId || !groupName || storageLocationIds.length === 0) {
      return planningError(req, ctx, "PROCUREMENT_PLANNING_SLOC_GROUP_INVALID", 400, "company_id, group_name, and storage_location_ids are required.");
    }
    const { data: group, error: groupError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("planning_sloc_group")
      .insert({
        company_id: companyId,
        group_name: groupName,
        created_by: ctx.auth_user_id,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (groupError) {
      if (groupError.code === "23505") {
        return planningError(req, ctx, "PROCUREMENT_PLANNING_SLOC_GROUP_EXISTS", 409, "A planning storage-location group with this name already exists.");
      }
      throw new Error("PROCUREMENT_PLANNING_SLOC_GROUP_CREATE_FAILED");
    }
    const { error: memberError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("planning_sloc_group_member")
      .insert(storageLocationIds.map((storageLocationId) => ({
        sloc_group_id: toTrimmedString((group as JsonRecord).id),
        storage_location_id: storageLocationId,
        added_by: ctx.auth_user_id,
      })));
    if (memberError) throw new Error("PROCUREMENT_PLANNING_SLOC_GROUP_MEMBER_CREATE_FAILED");
    return await listPlanningSlocGroupsHandler(
      new Request(
        `${new URL(req.url).origin}/api/procurement/planning/sloc-groups?company_id=${encodeURIComponent(companyId)}`,
      ),
      ctx,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROCUREMENT_PLANNING_SLOC_GROUP_CREATE_FAILED";
    return planningError(req, ctx, code, 500, "Unable to create planning storage-location group.");
  }
}

export async function updatePlanningSlocGroupHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const groupId = getPathId(req, "sloc-groups");
    const { data: group, error: groupError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("planning_sloc_group")
      .select("id, company_id")
      .eq("id", groupId)
      .maybeSingle();
    if (groupError) throw new Error("PROCUREMENT_PLANNING_SLOC_GROUP_LOOKUP_FAILED");
    const companyId = await getCompanyScope(ctx, (group as JsonRecord | null)?.company_id);
    if (!groupId || !companyId) {
      return planningError(req, ctx, "PROCUREMENT_PLANNING_SLOC_GROUP_NOT_FOUND", 404, "Planning storage-location group not found.");
    }
    const groupName = toTrimmedString(body.group_name);
    const storageLocationIds = Array.isArray(body.storage_location_ids)
      ? [...new Set((body.storage_location_ids as unknown[]).map((value) => toTrimmedString(value)).filter(Boolean))]
      : [];
    if (!groupName || storageLocationIds.length === 0) {
      return planningError(req, ctx, "PROCUREMENT_PLANNING_SLOC_GROUP_INVALID", 400, "group_name and storage_location_ids are required.");
    }
    const { error: updateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("planning_sloc_group")
      .update({
        group_name: groupName,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: new Date().toISOString(),
      })
      .eq("id", groupId);
    if (updateError) throw new Error("PROCUREMENT_PLANNING_SLOC_GROUP_UPDATE_FAILED");
    const { error: deleteError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("planning_sloc_group_member")
      .delete()
      .eq("sloc_group_id", groupId);
    if (deleteError) throw new Error("PROCUREMENT_PLANNING_SLOC_GROUP_MEMBER_RESET_FAILED");
    const { error: memberError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("planning_sloc_group_member")
      .insert(storageLocationIds.map((storageLocationId) => ({
        sloc_group_id: groupId,
        storage_location_id: storageLocationId,
        added_by: ctx.auth_user_id,
      })));
    if (memberError) throw new Error("PROCUREMENT_PLANNING_SLOC_GROUP_MEMBER_CREATE_FAILED");
    return await listPlanningSlocGroupsHandler(
      new Request(
        `${new URL(req.url).origin}/api/procurement/planning/sloc-groups?company_id=${encodeURIComponent(companyId)}`,
      ),
      ctx,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROCUREMENT_PLANNING_SLOC_GROUP_UPDATE_FAILED";
    return planningError(req, ctx, code, 500, "Unable to update planning storage-location group.");
  }
}

export async function deletePlanningSlocGroupHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const groupId = getPathId(req, "sloc-groups");
    const { data: group, error: groupError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("planning_sloc_group")
      .select("id, company_id")
      .eq("id", groupId)
      .maybeSingle();
    if (groupError) throw new Error("PROCUREMENT_PLANNING_SLOC_GROUP_LOOKUP_FAILED");
    const companyId = await getCompanyScope(ctx, (group as JsonRecord | null)?.company_id);
    if (!groupId || !companyId) {
      return planningError(req, ctx, "PROCUREMENT_PLANNING_SLOC_GROUP_NOT_FOUND", 404, "Planning storage-location group not found.");
    }
    const { data: linkedItemGroups, error: linkedItemGroupsError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("planning_item_group")
      .select("id, group_name")
      .eq("company_id", companyId)
      .eq("sloc_group_id", groupId)
      .eq("active", true);
    if (linkedItemGroupsError) throw new Error("PROCUREMENT_PLANNING_SLOC_GROUP_LINKED_ITEM_GROUPS_FAILED");
    const activeLinkedGroups = (linkedItemGroups ?? []) as JsonRecord[];
    if (activeLinkedGroups.length > 0) {
      return planningError(
        req,
        ctx,
        "PROCUREMENT_PLANNING_SLOC_GROUP_IN_USE",
        409,
        "Delete or move the dependent item groups before deleting this SLOC group.",
      );
    }
    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("planning_sloc_group")
      .delete()
      .eq("id", groupId);
    if (error) throw new Error("PROCUREMENT_PLANNING_SLOC_GROUP_DELETE_FAILED");
    return await listPlanningSlocGroupsHandler(new Request(`${new URL(req.url).origin}/api/procurement/planning/sloc-groups?company_id=${encodeURIComponent(companyId)}`), ctx);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROCUREMENT_PLANNING_SLOC_GROUP_DELETE_FAILED";
    return planningError(req, ctx, code, 500, "Unable to delete planning storage-location group.");
  }
}

export async function listPlanningItemGroupsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const companyId = await getCompanyScope(ctx, new URL(req.url).searchParams.get("company_id") ?? "");
    if (!companyId) return okResponse(req, { items: [] }, ctx.request_id);
    return okResponse(req, { items: await loadItemGroups(companyId) }, ctx.request_id);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROCUREMENT_PLANNING_ITEM_GROUP_LIST_FAILED";
    return planningError(req, ctx, code, 500, "Unable to load planning item groups.");
  }
}

export async function createPlanningItemGroupHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, body.company_id);
    const groupName = toTrimmedString(body.group_name);
    const slocGroupId = toTrimmedString(body.sloc_group_id);
    if (!companyId || !groupName || !slocGroupId) {
      return planningError(req, ctx, "PROCUREMENT_PLANNING_ITEM_GROUP_INVALID", 400, "company_id, sloc_group_id, and group_name are required.");
    }
    const { data: slocGroup, error: slocGroupError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("planning_sloc_group")
      .select("id, company_id")
      .eq("id", slocGroupId)
      .eq("active", true)
      .maybeSingle();
    if (slocGroupError) throw new Error("PROCUREMENT_PLANNING_ITEM_GROUP_SLOC_LOOKUP_FAILED");
    if (toTrimmedString((slocGroup as JsonRecord | null)?.company_id) !== companyId) {
      return planningError(req, ctx, "PROCUREMENT_PLANNING_ITEM_GROUP_SLOC_INVALID", 422, "Selected planning SLOC group does not belong to the company.");
    }
    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("planning_item_group")
      .insert({
        company_id: companyId,
        sloc_group_id: slocGroupId,
        group_name: groupName,
        created_by: ctx.auth_user_id,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: new Date().toISOString(),
      });
    if (error) {
      if (error.code === "23505") {
        return planningError(req, ctx, "PROCUREMENT_PLANNING_ITEM_GROUP_EXISTS", 409, "A planning item group with this name already exists.");
      }
      throw new Error("PROCUREMENT_PLANNING_ITEM_GROUP_CREATE_FAILED");
    }
    return okResponse(req, { items: await loadItemGroups(companyId) }, ctx.request_id);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROCUREMENT_PLANNING_ITEM_GROUP_CREATE_FAILED";
    return planningError(req, ctx, code, 500, "Unable to create planning item group.");
  }
}

export async function updatePlanningItemGroupHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const groupId = getPathId(req, "item-groups");
    const { data: group, error: groupError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("planning_item_group")
      .select("id, company_id")
      .eq("id", groupId)
      .maybeSingle();
    if (groupError) throw new Error("PROCUREMENT_PLANNING_ITEM_GROUP_LOOKUP_FAILED");
    const companyId = await getCompanyScope(ctx, (group as JsonRecord | null)?.company_id);
    const groupName = toTrimmedString(body.group_name);
    const slocGroupId = toTrimmedString(body.sloc_group_id);
    if (!groupId || !companyId || !groupName || !slocGroupId) {
      return planningError(req, ctx, "PROCUREMENT_PLANNING_ITEM_GROUP_INVALID", 400, "Valid group_name and sloc_group_id are required.");
    }
    const { data: slocGroup, error: slocGroupError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("planning_sloc_group")
      .select("id, company_id")
      .eq("id", slocGroupId)
      .eq("active", true)
      .maybeSingle();
    if (slocGroupError) throw new Error("PROCUREMENT_PLANNING_ITEM_GROUP_SLOC_LOOKUP_FAILED");
    if (toTrimmedString((slocGroup as JsonRecord | null)?.company_id) !== companyId) {
      return planningError(req, ctx, "PROCUREMENT_PLANNING_ITEM_GROUP_SLOC_INVALID", 422, "Selected planning SLOC group does not belong to the company.");
    }
    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("planning_item_group")
      .update({
        sloc_group_id: slocGroupId,
        group_name: groupName,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: new Date().toISOString(),
      })
      .eq("id", groupId);
    if (error) throw new Error("PROCUREMENT_PLANNING_ITEM_GROUP_UPDATE_FAILED");
    return okResponse(req, { items: await loadItemGroups(companyId) }, ctx.request_id);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROCUREMENT_PLANNING_ITEM_GROUP_UPDATE_FAILED";
    return planningError(req, ctx, code, 500, "Unable to update planning item group.");
  }
}

export async function deletePlanningItemGroupHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const groupId = getPathId(req, "item-groups");
    const { data: group, error: groupError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("planning_item_group")
      .select("id, company_id")
      .eq("id", groupId)
      .maybeSingle();
    if (groupError) throw new Error("PROCUREMENT_PLANNING_ITEM_GROUP_LOOKUP_FAILED");
    const companyId = await getCompanyScope(ctx, (group as JsonRecord | null)?.company_id);
    if (!groupId || !companyId) {
      return planningError(req, ctx, "PROCUREMENT_PLANNING_ITEM_GROUP_NOT_FOUND", 404, "Planning item group not found.");
    }
    const { error: clearError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("procurement_monthly_plan_line")
      .update({ planning_item_group_id: null, last_updated_by: ctx.auth_user_id, last_updated_at: new Date().toISOString() })
      .eq("planning_item_group_id", groupId);
    if (clearError) throw new Error("PROCUREMENT_PLANNING_ITEM_GROUP_CLEAR_FAILED");
    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("planning_item_group")
      .delete()
      .eq("id", groupId);
    if (error) throw new Error("PROCUREMENT_PLANNING_ITEM_GROUP_DELETE_FAILED");
    return okResponse(req, { items: await loadItemGroups(companyId) }, ctx.request_id);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROCUREMENT_PLANNING_ITEM_GROUP_DELETE_FAILED";
    return planningError(req, ctx, code, 500, "Unable to delete planning item group.");
  }
}

export async function closeProcurementPlanningMonthHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, body.company_id);
    const planMonth = normalizePlanMonth(body.plan_month) ?? getCurrentPlanMonth();
    if (!companyId) {
      return planningError(req, ctx, "PROCUREMENT_PLANNING_CLOSE_INVALID", 400, "company_id is required.");
    }
    const plan = await ensurePlanExists(ctx, companyId, planMonth);
    if (plan.status === "CLOSED") {
      return planningError(req, ctx, "PROCUREMENT_PLANNING_PLAN_ALREADY_CLOSED", 409, "Month is already closed.");
    }
    const workspace = await loadWorkspaceRows(ctx, companyId, planMonth, plan.id);
    const { data: archive, error: archiveError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("procurement_monthly_plan_archive")
      .insert({
        source_plan_id: plan.id,
        company_id: companyId,
        plan_month: planMonth,
        archived_by: ctx.auth_user_id,
      })
      .select("id")
      .single();
    if (archiveError) throw new Error("PROCUREMENT_PLANNING_ARCHIVE_CREATE_FAILED");
    const archiveId = toTrimmedString((archive as JsonRecord).id);
    const archiveLines = workspace.rows.map((row) => ({
      archive_id: archiveId,
      material_id: row.material_id,
      material_code_snapshot: row.material_code,
      material_name_snapshot: row.material_name,
      base_uom_code_snapshot: row.base_uom_code,
      source_sloc_group_name_snapshot: row.source_sloc_group_name,
      planning_item_group_name_snapshot: row.planning_item_group_name,
      excluded_from_dashboard: row.excluded_from_dashboard,
      monthly_requirement_qty: row.monthly_requirement_qty,
      safety_days: row.safety_days,
      processing_time_days: row.processing_time_days,
      lead_time_days: row.lead_time_days,
      fixed_safety_stock_qty: row.fixed_safety_stock_qty,
      fixed_replenishment_stock_qty: row.fixed_replenishment_stock_qty,
      available_stock_qty: row.available_stock_qty,
      trn_stock_qty: row.trn_stock_qty,
      ge_stock_qty: row.ge_stock_qty,
      qa_stock_qty: row.qa_stock_qty,
      total_stock_qty: row.total_stock_qty,
      derived_safety_stock_qty: row.derived_safety_stock_qty,
      derived_replenishment_stock_qty: row.derived_replenishment_stock_qty,
      effective_safety_stock_qty: row.effective_safety_stock_qty,
      effective_replenishment_stock_qty: row.effective_replenishment_stock_qty,
      display_order: row.display_order,
    }));
    const archiveGroupConfigs = workspace.groupConfigs.map((config) => ({
      archive_id: archiveId,
      planning_item_group_id: config.planning_item_group_id,
      planning_item_group_name_snapshot: config.planning_item_group_name,
      monthly_requirement_qty: config.monthly_requirement_qty,
      safety_days: config.safety_days,
      processing_time_days: config.processing_time_days,
      lead_time_days: config.lead_time_days,
      fixed_safety_stock_qty: config.fixed_safety_stock_qty,
      fixed_replenishment_stock_qty: config.fixed_replenishment_stock_qty,
    }));
    if (archiveLines.length > 0) {
      const { error: lineError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("procurement_monthly_plan_archive_line")
        .insert(archiveLines);
      if (lineError) throw new Error("PROCUREMENT_PLANNING_ARCHIVE_LINE_CREATE_FAILED");
    }
    if (archiveGroupConfigs.length > 0) {
      const { error: groupConfigArchiveError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("procurement_monthly_plan_archive_group_config")
        .insert(archiveGroupConfigs);
      if (groupConfigArchiveError) {
        throw new Error("PROCUREMENT_PLANNING_ARCHIVE_GROUP_CONFIG_CREATE_FAILED");
      }
    }
    const { error: closeError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("procurement_monthly_plan")
      .update({
        status: "CLOSED",
        closed_at: new Date().toISOString(),
        closed_by: ctx.auth_user_id,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: new Date().toISOString(),
      })
      .eq("id", plan.id);
    if (closeError) throw new Error("PROCUREMENT_PLANNING_CLOSE_FAILED");
    return okResponse(req, { archive_id: archiveId, plan_month: planMonth, status: "CLOSED" }, ctx.request_id);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROCUREMENT_PLANNING_CLOSE_FAILED";
    return planningError(req, ctx, code, 500, "Unable to close procurement planning month.");
  }
}

export async function getProcurementPlanningHistoryHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? "");
    const planMonth = normalizePlanMonth(url.searchParams.get("plan_month")) ?? getCurrentPlanMonth();
    if (!companyId) return okResponse(req, { archive: null, rows: [], group_configs: [] }, ctx.request_id);
    const { data: archive, error: archiveError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("procurement_monthly_plan_archive")
      .select("id, source_plan_id, company_id, plan_month, archived_at")
      .eq("company_id", companyId)
      .eq("plan_month", planMonth)
      .maybeSingle();
    if (archiveError) throw new Error("PROCUREMENT_PLANNING_HISTORY_LOOKUP_FAILED");
    const archiveId = toTrimmedString((archive as JsonRecord | null)?.id);
    if (!archiveId) return okResponse(req, { archive: null, rows: [], group_configs: [] }, ctx.request_id);
    const { data: rows, error: rowsError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("procurement_monthly_plan_archive_line")
      .select("*")
      .eq("archive_id", archiveId)
      .order("display_order", { ascending: true });
    if (rowsError) throw new Error("PROCUREMENT_PLANNING_HISTORY_ROWS_FAILED");
    const { data: groupConfigs, error: groupConfigsError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("procurement_monthly_plan_archive_group_config")
      .select("*")
      .eq("archive_id", archiveId)
      .order("planning_item_group_name_snapshot", { ascending: true });
    if (groupConfigsError) throw new Error("PROCUREMENT_PLANNING_HISTORY_GROUP_CONFIG_FAILED");
    return okResponse(
      req,
      { archive, rows: (rows ?? []) as JsonRecord[], group_configs: (groupConfigs ?? []) as JsonRecord[] },
      ctx.request_id,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROCUREMENT_PLANNING_HISTORY_FAILED";
    return planningError(req, ctx, code, 500, "Unable to load procurement planning history.");
  }
}
