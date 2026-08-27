/*
 * File-ID: 27.26-v3-BE
 * Purpose: AC06 PO11-parity monthly costing-rate workspace.
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { errorResponse, okResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import { assertProdReadRole, parseBody, toTrimmedString } from "./production.shared.ts";

type Row = Record<string, unknown>;
const AC06_FIRST_MONTH = "2026-05-01";

const ac06Error = (req: Request, ctx: ProdHandlerContext, code: string, status: number, message: string) =>
  errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);

// getMonth() throwing AC06_MONTH_SEQUENCE_REQUIRED is a real, user-actionable
// validation (open the previous month first), not a system failure -- every
// catch block whose try-body calls getMonth() routes through this instead of
// duplicating the check, so it never gets flattened into the generic 500 the
// rest of this file's fallback errors use.
function ac06ErrorFromCaught(req: Request, ctx: ProdHandlerContext, error: unknown, fallbackCode: string, fallbackMessage: string): Response {
  const code = error instanceof Error ? error.message : fallbackCode;
  if (code === "AC06_MONTH_SEQUENCE_REQUIRED") {
    return ac06Error(req, ctx, code, 409, "Open the previous month first — months must be opened in order so carry-forward always reflects the true prior month's setup.");
  }
  return ac06Error(req, ctx, code, 500, fallbackMessage);
}

function monthStart(raw: unknown): string | null {
  const value = toTrimmedString(raw);
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(value)) return null;
  const normalized = value.length === 7 ? `${value}-01` : value;
  return /^\d{4}-\d{2}-01$/.test(normalized) && normalized >= AC06_FIRST_MONTH ? normalized : null;
}

function previousMonthOf(rateMonth: string): string {
  const [year, month] = rateMonth.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCMonth(date.getUTCMonth() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function ids(input: unknown): string[] {
  return [...new Set((Array.isArray(input) ? input : []).map(toTrimmedString).filter(Boolean))];
}

function rateValue(value: unknown): string | null {
  const text = toTrimmedString(value);
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) ? text : null;
}

async function companyScope(ctx: ProdHandlerContext, requested?: string): Promise<string> {
  const companyId = toTrimmedString(requested) || toTrimmedString(ctx.context.companyId);
  if (companyId) await assertCompanyScope(ctx, companyId);
  return companyId;
}

type Ac06Permissions = {
  can_view: boolean;
  can_setup: boolean;
  can_rate: boolean;
  can_verify: boolean;
  can_close: boolean;
};

async function getAc06Permissions(ctx: ProdHandlerContext, companyId: string): Promise<Ac06Permissions> {
  const [can_view, can_setup, can_rate, can_verify, can_close] = await Promise.all([
    canMaintainCompanyResource(ctx, companyId, "ACC_SLOC_COSTING_GROUP", "VIEW"),
    canMaintainCompanyResource(ctx, companyId, "ACC_SLOC_COSTING_SETUP", "WRITE"),
    canMaintainCompanyResource(ctx, companyId, "ACC_SLOC_COSTING_RATE", "WRITE"),
    canMaintainCompanyResource(ctx, companyId, "ACC_SLOC_COSTING_VERIFY", "WRITE"),
    canMaintainCompanyResource(ctx, companyId, "ACC_SLOC_COSTING_CLOSE", "WRITE"),
  ]);
  return { can_view, can_setup, can_rate, can_verify, can_close };
}

async function requireAc06Action(
  req: Request,
  ctx: ProdHandlerContext,
  companyId: string,
  resourceCode: string,
  actionCode: string,
): Promise<Response | null> {
  const allowed = await canMaintainCompanyResource(ctx, companyId, resourceCode, actionCode);
  return allowed ? null : ac06Error(req, ctx, "AC06_COMPANY_ACTION_FORBIDDEN", 403, "You do not have this AC06 action for the selected company.");
}

async function validateAc06Locations(companyId: string, locationIds: string[]): Promise<boolean> {
  const { data, error } = await serviceRoleClient.schema("erp_inventory").from("storage_location_plant_map")
    .select("storage_location_id").eq("company_id", companyId).eq("active", true).in("storage_location_id", locationIds);
  if (error) throw new Error("AC06_SLOC_LOCATION_LOOKUP_FAILED");
  return ids((data ?? []).map((row: Row) => row.storage_location_id)).length === locationIds.length;
}

async function getMonth(ctx: ProdHandlerContext, companyId: string, rateMonth: string): Promise<Row> {
  const db = serviceRoleClient.schema("erp_production");
  const { data: found, error: foundError } = await db.from("ac06_month").select("*").eq("company_id", companyId).eq("rate_month", rateMonth).maybeSingle();
  if (foundError) throw new Error("AC06_MONTH_LOOKUP_FAILED");
  if (found) return found as Row;

  // Carry-forward must always source from the TRUE immediately-preceding
  // calendar month, never from "whichever older month happens to already
  // exist" -- otherwise jumping straight to a future month (e.g. opening
  // August before June/July ever existed) permanently stamps that month
  // with a stale ancestor's data, and it never re-syncs even after the
  // skipped months get created later (found live 2026-08-27: a company did
  // exactly this, August carried forward from May while June/July had
  // already evolved their own, different group membership). Requiring the
  // immediately-preceding month to exist first (or this being the very
  // first month) makes that permanently impossible.
  if (rateMonth !== AC06_FIRST_MONTH) {
    const previousMonth = previousMonthOf(rateMonth);
    const { data: previousRow, error: previousError } = await db.from("ac06_month")
      .select("id").eq("company_id", companyId).eq("rate_month", previousMonth).maybeSingle();
    if (previousError) throw new Error("AC06_MONTH_LOOKUP_FAILED");
    if (!previousRow) throw new Error("AC06_MONTH_SEQUENCE_REQUIRED");
  }

  const { data: priorCandidates, error: priorError } = await db.from("ac06_month").select("*").eq("company_id", companyId).order("rate_month", { ascending: false });
  if (priorError) throw new Error("AC06_MONTH_LOOKUP_FAILED");
  const prior = ((priorCandidates ?? []) as Row[]).find((candidate) => toTrimmedString(candidate.rate_month) < rateMonth) ?? null;
  const now = new Date().toISOString();
  const { data: created, error: createError } = await db.from("ac06_month").insert({
    company_id: companyId, rate_month: rateMonth, carry_forward_from_month_id: prior?.id ?? null,
    created_by: ctx.auth_user_id, last_updated_by: ctx.auth_user_id, last_updated_at: now,
  }).select("*").single();
  if (createError || !created) throw new Error("AC06_MONTH_CREATE_FAILED");

  // Carry-forward copies structure/rates, but never carries verification into a new month.
  if (prior?.id) {
    const [{ data: priorLines, error: linesError }, { data: priorConfigs, error: configsError }] = await Promise.all([
      db.from("ac06_month_line").select("source_sloc_group_id, material_id, costing_group_id, costing_group_name_snapshot, rate, excluded_from_rate_input, display_order").eq("month_id", prior.id),
      db.from("ac06_month_group_config").select("source_sloc_group_id, costing_group_id, material_id, source_sloc_group_name_snapshot, costing_group_name_snapshot").eq("month_id", prior.id),
    ]);
    if (linesError || configsError) throw new Error("AC06_CARRY_FORWARD_READ_FAILED");
    if ((priorLines ?? []).length) {
      const { error } = await db.from("ac06_month_line").insert((priorLines as Row[]).map((line) => ({
        ...line, month_id: created.id, company_id: companyId, verification_status: "PENDING", rate_changed_at: now,
        rate_changed_by: ctx.auth_user_id, created_by: ctx.auth_user_id, last_updated_by: ctx.auth_user_id, last_updated_at: now,
      })));
      if (error) throw new Error("AC06_CARRY_FORWARD_WRITE_FAILED");
    }
    if ((priorConfigs ?? []).length) {
      const { error } = await db.from("ac06_month_group_config").insert((priorConfigs as Row[]).map((config) => ({
        ...config, month_id: created.id, company_id: companyId, created_by: ctx.auth_user_id,
        last_updated_by: ctx.auth_user_id, last_updated_at: now,
      })));
      if (error) throw new Error("AC06_CARRY_FORWARD_WRITE_FAILED");
    }
  }
  return created as Row;
}

async function getGroups(companyId: string): Promise<{ slocGroups: Row[]; costingGroups: Row[] }> {
  const db = serviceRoleClient.schema("erp_production");
  const [{ data: slocGroups, error: slocError }, { data: costingGroups, error: costingError }] = await Promise.all([
    db.from("ac06_sloc_group").select("id, company_id, group_name, active").eq("company_id", companyId).eq("active", true).order("group_name"),
    db.from("ac06_costing_group").select("id, company_id, sloc_group_id, group_name, active").eq("company_id", companyId).eq("active", true).order("group_name"),
  ]);
  if (slocError || costingError) throw new Error("AC06_GROUP_LIST_FAILED");
  const groupIds = ids((slocGroups ?? []).map((group: Row) => group.id));
  const { data: members, error: memberError } = groupIds.length
    ? await db.from("ac06_sloc_group_member").select("sloc_group_id, storage_location_id").eq("company_id", companyId).eq("active", true).in("sloc_group_id", groupIds)
    : { data: [], error: null };
  if (memberError) throw new Error("AC06_GROUP_LIST_FAILED");
  const memberIdsByGroup = new Map<string, string[]>();
  for (const member of (members ?? []) as Row[]) {
    const groupId = toTrimmedString(member.sloc_group_id);
    memberIdsByGroup.set(groupId, [...(memberIdsByGroup.get(groupId) ?? []), toTrimmedString(member.storage_location_id)]);
  }
  return { slocGroups: (slocGroups ?? []).map((group: Row) => ({ ...group, storage_location_ids: memberIdsByGroup.get(toTrimmedString(group.id)) ?? [] })) as Row[], costingGroups: (costingGroups ?? []) as Row[] };
}

async function eligibleMaterialIds(companyId: string, slocGroupId: string): Promise<string[]> {
  const db = serviceRoleClient.schema("erp_production");
  const { data: members, error: memberError } = await db.from("ac06_sloc_group_member")
    .select("storage_location_id").eq("sloc_group_id", slocGroupId).eq("company_id", companyId).eq("active", true);
  if (memberError) throw new Error("AC06_ELIGIBILITY_LOOKUP_FAILED");
  const locationIds = ids((members ?? []).map((row: Row) => row.storage_location_id));
  if (!locationIds.length) return [];
  const snapshots = await fetchInChunks<Row>(locationIds, (chunk) => serviceRoleClient.schema("erp_inventory").from("stock_snapshot")
    .select("material_id").eq("company_id", companyId).in("storage_location_id", chunk));
  return ids(snapshots.map((row) => row.material_id));
}

async function materialMap(materialIds: string[]): Promise<Map<string, Row>> {
  const result = new Map<string, Row>();
  if (!materialIds.length) return result;
  const rows = await fetchInChunks<Row>(materialIds, (chunk) => serviceRoleClient.schema("erp_master").from("material_master")
    .select("id, pace_code, external_code, material_name, base_uom_code, material_type").in("id", chunk));
  for (const row of rows) result.set(toTrimmedString(row.id), row);
  return result;
}

async function ensureScopeRows(ctx: ProdHandlerContext, month: Row, slocGroup: Row): Promise<void> {
  const companyId = toTrimmedString(month.company_id);
  const slocGroupId = toTrimmedString(slocGroup.id);
  const materialIds = await eligibleMaterialIds(companyId, slocGroupId);
  if (!materialIds.length) return;
  const db = serviceRoleClient.schema("erp_production");
  const { data: existing, error } = await db.from("ac06_month_line").select("material_id")
    .eq("month_id", month.id).eq("source_sloc_group_id", slocGroupId).in("material_id", materialIds);
  if (error) throw new Error("AC06_SCOPE_SYNC_FAILED");
  const existingIds = new Set(ids((existing ?? []).map((row: Row) => row.material_id)));
  const missing = materialIds.filter((id) => !existingIds.has(id));
  if (!missing.length) return;
  const now = new Date().toISOString();
  const inserts = missing.map((material_id, index) => ({
    month_id: month.id, company_id: companyId, source_sloc_group_id: slocGroupId, material_id,
    rate: 0, verification_status: "PENDING", rate_changed_at: now, rate_changed_by: ctx.auth_user_id,
    display_order: index, created_by: ctx.auth_user_id, last_updated_by: ctx.auth_user_id, last_updated_at: now,
  }));
  const { error: insertError } = await db.from("ac06_month_line").insert(inserts);
  if (insertError) throw new Error("AC06_SCOPE_SYNC_FAILED");
  const { error: configError } = await db.from("ac06_month_group_config").upsert(missing.map((material_id) => ({
    month_id: month.id, company_id: companyId, source_sloc_group_id: slocGroupId, material_id,
    source_sloc_group_name_snapshot: toTrimmedString(slocGroup.group_name), created_by: ctx.auth_user_id,
    last_updated_by: ctx.auth_user_id, last_updated_at: now,
  })), { onConflict: "month_id,source_sloc_group_id,material_id" });
  if (configError) throw new Error("AC06_SCOPE_SYNC_FAILED");
}

// PO11-parity display order (feasibility §35.12/§35.18, carried into AC06 by
// §114.23's "follows PO11's ... workspace pattern"): standalone rows and
// Costing Groups sort together as ONE merged alphabetical list by Material
// Name, never "all groups first, then standalone". A group's position is
// decided by its alphabetically-first member's name. This is purely a
// *display* order -- it must not affect which member is the editable
// "group lead" (that identity stays keyed on display_order/insertion order,
// unrelated to name sorting, since saveAc06RatesHandler/verify_ac06_rate_scopes
// already resolve the leader that way).
function rowsForDisplay(lines: Row[], materials: Map<string, Row>, groups: Map<string, Row>): Row[] {
  const byGroup = new Map<string, Row[]>();
  for (const line of lines) {
    const key = toTrimmedString(line.costing_group_id);
    const list = byGroup.get(key) ?? []; list.push(line); byGroup.set(key, list);
  }
  const decorated: Row[] = lines.map((line): Row => {
    const groupId = toTrimmedString(line.costing_group_id);
    const siblings = (byGroup.get(groupId) ?? []).sort((a, b) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0));
    const material = materials.get(toTrimmedString(line.material_id));
    return {
      ...line, pace_code: material?.pace_code ?? null, material_external_code: material?.external_code ?? null,
      material_name: material?.material_name ?? null, material_type: material?.material_type ?? null,
      base_uom_code: material?.base_uom_code ?? null, costing_group_name: groupId ? groups.get(groupId)?.group_name ?? line.costing_group_name_snapshot ?? null : null,
      is_group_lead: Boolean(groupId) && toTrimmedString(siblings[0]?.id) === toTrimmedString(line.id),
      is_standalone: !groupId,
      is_excluded: Boolean(line.excluded_from_rate_input),
    };
  });
  const units = new Map<string, Row[]>();
  for (const row of decorated) {
    const key = toTrimmedString(row.costing_group_id) || `standalone-${toTrimmedString(row.id)}`;
    units.set(key, [...(units.get(key) ?? []), row]);
  }
  return [...units.values()]
    .map((members) => [...members].sort((a, b) => String(a.material_name ?? "").localeCompare(String(b.material_name ?? ""))))
    .sort((a, b) => String(a[0]?.material_name ?? "").localeCompare(String(b[0]?.material_name ?? "")))
    .flat();
}

export async function getAc06WorkspaceHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url); const companyId = await companyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const rateMonth = monthStart(url.searchParams.get("rate_month"));
    if (!companyId || !rateMonth) return ac06Error(req, ctx, "AC06_FILTER_INVALID", 400, "company_id and rate_month are required.");
    const permissions = await getAc06Permissions(ctx, companyId);
    if (!permissions.can_view) return ac06Error(req, ctx, "AC06_COMPANY_ACTION_FORBIDDEN", 403, "You do not have AC06 access for the selected company.");
    // Historical entry months remain open until an authorized user explicitly closes them.
    // The retained auto-close RPC is for an explicit scheduled job, never a workspace read.
    const month = await getMonth(ctx, companyId, rateMonth); const { slocGroups, costingGroups } = await getGroups(companyId);
    await Promise.all(slocGroups.map((group) => ensureScopeRows(ctx, month, group)));
    const { data: lines, error } = await serviceRoleClient.schema("erp_production").from("ac06_month_line").select("*").eq("month_id", month.id);
    if (error) throw new Error("AC06_WORKSPACE_LOAD_FAILED");
    const allLines = (lines ?? []) as Row[]; const materials = await materialMap(ids(allLines.map((line) => line.material_id)));
    const groupMap = new Map(costingGroups.map((group) => [toTrimmedString(group.id), group]));
    const rows = rowsForDisplay(allLines, materials, groupMap);
    const selectedSlocGroupId = toTrimmedString(url.searchParams.get("sloc_group_id"));
    const scopedRows = selectedSlocGroupId ? rows.filter((row) => toTrimmedString(row.source_sloc_group_id) === selectedSlocGroupId) : rows;
    const activeRows = scopedRows.filter((row) => !row.is_excluded);
    return okResponse({ data: { month, rows: scopedRows, sloc_groups: slocGroups, costing_groups: costingGroups, permissions,
      summary: { rows: activeRows.length, excluded: scopedRows.length - activeRows.length, verified: activeRows.filter((row) => row.verification_status === "VERIFIED").length,
        pending: activeRows.filter((row) => row.verification_status === "PENDING").length,
        standalone: activeRows.filter((row) => row.is_standalone).length } } }, ctx.request_id, req);
  } catch (error) { return ac06ErrorFromCaught(req, ctx, error, "AC06_WORKSPACE_LOAD_FAILED", "Unable to load AC06 workspace."); }
}

export async function saveAc06RatesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req); const companyId = await companyScope(ctx, toTrimmedString(body.company_id));
    const rateMonth = monthStart(body.rate_month); const updates = Array.isArray(body.updates) ? body.updates as Row[] : [];
    if (!companyId || !rateMonth || !updates.length) return ac06Error(req, ctx, "AC06_RATE_SAVE_INVALID", 400, "company_id, rate_month, and updates are required.");
    const accessError = await requireAc06Action(req, ctx, companyId, "ACC_SLOC_COSTING_RATE", "WRITE"); if (accessError) return accessError;
    const month = await getMonth(ctx, companyId, rateMonth); if (month.status === "CLOSED") return ac06Error(req, ctx, "AC06_MONTH_CLOSED", 409, "Closed month cannot be changed.");
    const lineIds = ids(updates.map((row) => row.line_id)); const { data: lines, error } = await serviceRoleClient.schema("erp_production").from("ac06_month_line").select("*").eq("month_id", month.id).in("id", lineIds);
    if (error || (lines ?? []).length !== lineIds.length) return ac06Error(req, ctx, "AC06_RATE_LINE_INVALID", 409, "One or more rate rows are invalid for this month.");
    if ((lines ?? []).some((line: Row) => line.excluded_from_rate_input)) return ac06Error(req, ctx, "AC06_RATE_EXCLUDED", 409, "Excluded items must be included before their rate can be changed.");
    // Business owner correction (2026-08-24): who saves a rate decides whether
    // it lands PENDING or auto-verifies -- not a separate step. An actor who
    // also holds ACC_SLOC_COSTING_VERIFY:WRITE (Auditor, or ACL-MASTER) has
    // their save write VERIFIED directly, same as if they had entered the
    // rate and then immediately used the bulk Verify action themselves. A
    // plain Accounts actor (no verify authority) still lands PENDING,
    // unchanged, and needs a later Auditor Verify pass.
    const canVerifyOwnSave = await canMaintainCompanyResource(ctx, companyId, "ACC_SLOC_COSTING_VERIFY", "WRITE");
    const byId = new Map((lines as Row[]).map((line) => [toTrimmedString(line.id), line])); const db = serviceRoleClient.schema("erp_production"); const now = new Date().toISOString();
    for (const update of updates) {
      const line = byId.get(toTrimmedString(update.line_id)); const rate = rateValue(update.rate);
      if (!line || rate === null) return ac06Error(req, ctx, "AC06_RATE_VALUE_INVALID", 400, "Rate must be a non-negative decimal.");
      const groupId = toTrimmedString(line.costing_group_id);
      const statusFields = canVerifyOwnSave
        ? { verification_status: "VERIFIED", verified_at: now, verified_by: ctx.auth_user_id }
        : { verification_status: "PENDING", verified_at: null, verified_by: null };
      const targetQuery = db.from("ac06_month_line").update({ rate, ...statusFields, rate_changed_at: now, rate_changed_by: ctx.auth_user_id, last_updated_at: now, last_updated_by: ctx.auth_user_id }).eq("month_id", month.id);
      const { error: updateError } = groupId ? await targetQuery.eq("costing_group_id", groupId) : await targetQuery.eq("id", line.id);
      if (updateError) throw new Error("AC06_RATE_SAVE_FAILED");
    }
    return okResponse({ data: { saved: lineIds.length } }, ctx.request_id, req);
  } catch (error) { return ac06ErrorFromCaught(req, ctx, error, "AC06_RATE_SAVE_FAILED", "Unable to save monthly costing rates."); }
}

export async function verifyAc06RatesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req); const companyId = await companyScope(ctx, toTrimmedString(body.company_id)); const rateMonth = monthStart(body.rate_month); const lineIds = ids(body.line_ids);
    if (!companyId || !rateMonth || !lineIds.length) return ac06Error(req, ctx, "AC06_VERIFY_INVALID", 400, "company_id, rate_month, and selected line_ids are required.");
    const accessError = await requireAc06Action(req, ctx, companyId, "ACC_SLOC_COSTING_VERIFY", "WRITE"); if (accessError) return accessError;
    const month = await getMonth(ctx, companyId, rateMonth); if (month.status === "CLOSED") return ac06Error(req, ctx, "AC06_MONTH_CLOSED", 409, "Closed month cannot be verified.");
    const { data: selectedLines, error: selectionError } = await serviceRoleClient.schema("erp_production").from("ac06_month_line").select("id, excluded_from_rate_input").eq("month_id", month.id).in("id", lineIds);
    if (selectionError || (selectedLines ?? []).length !== lineIds.length || (selectedLines ?? []).some((line: Row) => line.excluded_from_rate_input)) return ac06Error(req, ctx, "AC06_VERIFY_SELECTION_INVALID", 409, "Select only included pending standalone items or the first item of a pending Costing Group.");
    const { data: verified, error } = await serviceRoleClient.schema("erp_production").rpc("verify_ac06_rate_scopes", {
      p_month_id: month.id, p_line_ids: lineIds, p_verified_by: ctx.auth_user_id,
    });
    if (error) return ac06Error(req, ctx, "AC06_VERIFY_SELECTION_INVALID", 409, "Select only pending standalone items or the first item of a pending Costing Group.");
    return okResponse({ data: { verified: Number(verified ?? 0) } }, ctx.request_id, req);
  } catch (error) { return ac06ErrorFromCaught(req, ctx, error, "AC06_VERIFY_FAILED", "Unable to verify selected costing rates."); }
}

export async function createAc06SlocGroupHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req); const companyId = await companyScope(ctx, toTrimmedString(body.company_id)); const groupName = toTrimmedString(body.group_name); const locationIds = ids(body.storage_location_ids);
    if (!companyId || !groupName || !locationIds.length) return ac06Error(req, ctx, "AC06_SLOC_GROUP_INVALID", 400, "company_id, group_name, and storage locations are required.");
    const accessError = await requireAc06Action(req, ctx, companyId, "ACC_SLOC_COSTING_SETUP", "WRITE"); if (accessError) return accessError;
    if (!await validateAc06Locations(companyId, locationIds)) return ac06Error(req, ctx, "AC06_SLOC_LOCATION_INVALID", 422, "Each selected storage location must be active in the selected company.");
    const db = serviceRoleClient.schema("erp_production"); const { data: group, error } = await db.from("ac06_sloc_group").insert({ company_id: companyId, group_name: groupName, created_by: ctx.auth_user_id }).select("*").single();
    if (error || !group) return ac06Error(req, ctx, error?.code === "23505" ? "AC06_SLOC_GROUP_EXISTS" : "AC06_SLOC_GROUP_CREATE_FAILED", 409, "Unable to create SLOC Group.");
    const { error: memberError } = await db.from("ac06_sloc_group_member").insert(locationIds.map((storage_location_id) => ({ company_id: companyId, sloc_group_id: group.id, storage_location_id, added_by: ctx.auth_user_id })));
    if (memberError) throw new Error("AC06_SLOC_GROUP_CREATE_FAILED"); return okResponse({ data: group }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "AC06_SLOC_GROUP_CREATE_FAILED"; return ac06Error(req, ctx, code, 500, "Unable to create SLOC Group."); }
}

export async function createAc06CostingGroupHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req); const companyId = await companyScope(ctx, toTrimmedString(body.company_id)); const slocGroupId = toTrimmedString(body.sloc_group_id); const groupName = toTrimmedString(body.group_name);
    if (!companyId || !slocGroupId || !groupName) return ac06Error(req, ctx, "AC06_COSTING_GROUP_INVALID", 400, "company_id, parent SLOC Group, and Costing Group name are required.");
    const accessError = await requireAc06Action(req, ctx, companyId, "ACC_SLOC_COSTING_SETUP", "WRITE"); if (accessError) return accessError;
    const db = serviceRoleClient.schema("erp_production"); const { data: parent } = await db.from("ac06_sloc_group").select("id").eq("id", slocGroupId).eq("company_id", companyId).eq("active", true).maybeSingle();
    if (!parent) return ac06Error(req, ctx, "AC06_COSTING_GROUP_SCOPE_INVALID", 409, "Parent SLOC Group is not in the selected company.");
    const { data, error } = await db.from("ac06_costing_group").insert({ company_id: companyId, sloc_group_id: slocGroupId, group_name: groupName, created_by: ctx.auth_user_id }).select("*").single();
    if (error || !data) return ac06Error(req, ctx, error?.code === "23505" ? "AC06_COSTING_GROUP_EXISTS" : "AC06_COSTING_GROUP_CREATE_FAILED", 409, "Unable to create Costing Group.");
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "AC06_COSTING_GROUP_CREATE_FAILED"; return ac06Error(req, ctx, code, 500, "Unable to create Costing Group."); }
}

export async function assignAc06CostingGroupHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req); const companyId = await companyScope(ctx, toTrimmedString(body.company_id)); const rateMonth = monthStart(body.rate_month); const groupId = toTrimmedString(body.costing_group_id); const materialIds = ids(body.material_ids);
    if (!companyId || !rateMonth || !groupId || !materialIds.length) return ac06Error(req, ctx, "AC06_ASSIGN_INVALID", 400, "company_id, rate_month, costing_group_id, and material_ids are required.");
    const accessError = await requireAc06Action(req, ctx, companyId, "ACC_SLOC_COSTING_SETUP", "WRITE"); if (accessError) return accessError;
    const month = await getMonth(ctx, companyId, rateMonth); if (month.status === "CLOSED") return ac06Error(req, ctx, "AC06_MONTH_CLOSED", 409, "Closed month cannot be changed.");
    const db = serviceRoleClient.schema("erp_production"); const { data: group } = await db.from("ac06_costing_group").select("*").eq("id", groupId).eq("company_id", companyId).eq("active", true).maybeSingle();
    if (!group) return ac06Error(req, ctx, "AC06_ASSIGN_SCOPE_INVALID", 409, "Costing Group is not active in the selected company.");
    await ensureScopeRows(ctx, month, { id: group.sloc_group_id, company_id: companyId, group_name: "" });
    const { data: scopeRows, error } = await db.from("ac06_month_line").select("id, material_id, rate, display_order, excluded_from_rate_input").eq("month_id", month.id).eq("source_sloc_group_id", group.sloc_group_id).in("material_id", materialIds);
    if (error || (scopeRows ?? []).length !== materialIds.length) return ac06Error(req, ctx, "AC06_ASSIGN_SCOPE_INVALID", 409, "Every item must be eligible in the parent SLOC Group.");
    if ((scopeRows ?? []).some((row: Row) => row.excluded_from_rate_input)) return ac06Error(req, ctx, "AC06_ASSIGN_EXCLUDED", 409, "Include excluded items before assigning them to a Costing Group.");
    const { data: existingGroupRows, error: existingGroupError } = await db.from("ac06_month_line").select("id, rate, display_order").eq("month_id", month.id).eq("source_sloc_group_id", group.sloc_group_id).eq("costing_group_id", group.id);
    if (existingGroupError) throw new Error("AC06_ASSIGN_FAILED");
    const linesById = new Map<string, Row>();
    for (const line of [...(existingGroupRows ?? []), ...(scopeRows ?? [])] as Row[]) linesById.set(toTrimmedString(line.id), line);
    const groupLeader = [...linesById.values()].sort((left, right) => Number(left.display_order ?? 0) - Number(right.display_order ?? 0) || toTrimmedString(left.id).localeCompare(toTrimmedString(right.id)))[0];
    const groupRate = rateValue(groupLeader?.rate) ?? "0";
    const now = new Date().toISOString();
    const commonUpdate = { rate: groupRate, verification_status: "PENDING", rate_changed_at: now, rate_changed_by: ctx.auth_user_id, last_updated_at: now, last_updated_by: ctx.auth_user_id };
    const { error: existingUpdateError } = await db.from("ac06_month_line").update(commonUpdate).eq("month_id", month.id).eq("source_sloc_group_id", group.sloc_group_id).eq("costing_group_id", group.id);
    if (existingUpdateError) throw new Error("AC06_ASSIGN_FAILED");
    const { error: updateError } = await db.from("ac06_month_line").update({ ...commonUpdate, costing_group_id: group.id, costing_group_name_snapshot: group.group_name }).eq("month_id", month.id).eq("source_sloc_group_id", group.sloc_group_id).in("material_id", materialIds);
    if (updateError) throw new Error("AC06_ASSIGN_FAILED");
    const { data: parent } = await db.from("ac06_sloc_group").select("group_name").eq("id", group.sloc_group_id).single();
    await db.from("ac06_month_group_config").upsert(materialIds.map((material_id) => ({ month_id: month.id, company_id: companyId, source_sloc_group_id: group.sloc_group_id, costing_group_id: group.id, material_id, source_sloc_group_name_snapshot: parent?.group_name ?? "", costing_group_name_snapshot: group.group_name, last_updated_at: now, last_updated_by: ctx.auth_user_id })), { onConflict: "month_id,source_sloc_group_id,material_id" });
    return okResponse({ data: { assigned: materialIds.length } }, ctx.request_id, req);
  } catch (error) { return ac06ErrorFromCaught(req, ctx, error, "AC06_ASSIGN_FAILED", "Unable to assign Costing Group members."); }
}

export async function setAc06MaterialInclusionHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await companyScope(ctx, toTrimmedString(body.company_id));
    const rateMonth = monthStart(body.rate_month);
    const lineIds = ids(body.line_ids);
    const included = body.included === true;
    if (!companyId || !rateMonth || !lineIds.length || typeof body.included !== "boolean") {
      return ac06Error(req, ctx, "AC06_MATERIAL_INCLUSION_INVALID", 400, "company_id, rate_month, line_ids, and included are required.");
    }
    const accessError = await requireAc06Action(req, ctx, companyId, "ACC_SLOC_COSTING_SETUP", "WRITE");
    if (accessError) return accessError;
    const month = await getMonth(ctx, companyId, rateMonth);
    if (month.status === "CLOSED") return ac06Error(req, ctx, "AC06_MONTH_CLOSED", 409, "Closed month cannot be changed.");
    const db = serviceRoleClient.schema("erp_production");
    const { data: lines, error: lineError } = await db.from("ac06_month_line")
      .select("id, source_sloc_group_id, material_id")
      .eq("month_id", month.id).eq("company_id", companyId).in("id", lineIds);
    if (lineError || (lines ?? []).length !== lineIds.length) {
      return ac06Error(req, ctx, "AC06_MATERIAL_INCLUSION_SCOPE_INVALID", 409, "Every selected item must belong to the current company and month.");
    }
    const now = new Date().toISOString();
    const lineUpdate = included
      ? { excluded_from_rate_input: false, verification_status: "PENDING", rate_changed_at: now, rate_changed_by: ctx.auth_user_id, last_updated_at: now, last_updated_by: ctx.auth_user_id }
      : { excluded_from_rate_input: true, costing_group_id: null, costing_group_name_snapshot: null, verification_status: "PENDING", rate_changed_at: now, rate_changed_by: ctx.auth_user_id, last_updated_at: now, last_updated_by: ctx.auth_user_id };
    const { error: updateError } = await db.from("ac06_month_line").update(lineUpdate).eq("month_id", month.id).eq("company_id", companyId).in("id", lineIds);
    if (updateError) throw new Error("AC06_MATERIAL_INCLUSION_FAILED");
    if (!included) {
      for (const line of lines as Row[]) {
        const { error: configError } = await db.from("ac06_month_group_config").delete()
          .eq("month_id", month.id).eq("source_sloc_group_id", line.source_sloc_group_id).eq("material_id", line.material_id);
        if (configError) throw new Error("AC06_MATERIAL_INCLUSION_FAILED");
      }
    }
    return okResponse({ data: { included, changed: lineIds.length } }, ctx.request_id, req);
  } catch (error) {
    return ac06ErrorFromCaught(req, ctx, error, "AC06_MATERIAL_INCLUSION_FAILED", "Unable to update material inclusion.");
  }
}

export async function getAc06ReportHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url); const companyId = await companyScope(ctx, url.searchParams.get("company_id") ?? undefined); const slocGroupId = toTrimmedString(url.searchParams.get("sloc_group_id"));
    const months = ids(url.searchParams.get("months")?.split(",")).map(monthStart).filter((value): value is string => Boolean(value));
    if (!companyId || !slocGroupId || !months.length) return ac06Error(req, ctx, "AC06_REPORT_FILTER_INVALID", 400, "company_id, SLOC Group, and at least one month are required.");
    const accessError = await requireAc06Action(req, ctx, companyId, "ACC_SLOC_COSTING_GROUP", "VIEW"); if (accessError) return accessError;
    const db = serviceRoleClient.schema("erp_production"); const { data: monthRows, error } = await db.from("ac06_month").select("id, rate_month, status").eq("company_id", companyId).in("rate_month", months);
    if (error) throw new Error("AC06_REPORT_FAILED");
    const byId = new Map((monthRows ?? []).map((row: Row) => [toTrimmedString(row.id), row]));
    const openMonthIds = (monthRows ?? []).filter((row: Row) => row.status !== "CLOSED").map((row: Row) => row.id);
    const closedMonthIds = (monthRows ?? []).filter((row: Row) => row.status === "CLOSED").map((row: Row) => row.id);
    const [{ data: liveLines, error: liveLineError }, { data: archives, error: archiveError }] = await Promise.all([
      openMonthIds.length ? db.from("ac06_month_line").select("*").in("month_id", openMonthIds).eq("source_sloc_group_id", slocGroupId).eq("excluded_from_rate_input", false) : Promise.resolve({ data: [], error: null }),
      closedMonthIds.length ? db.from("ac06_month_archive").select("id, source_month_id").in("source_month_id", closedMonthIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (liveLineError || archiveError) throw new Error("AC06_REPORT_FAILED");
    const archiveById = new Map((archives ?? []).map((archive: Row) => [toTrimmedString(archive.id), archive]));
    const archiveIds = ids((archives ?? []).map((archive: Row) => archive.id));
    const { data: archiveLines, error: archiveLineError } = archiveIds.length
      ? await db.from("ac06_month_archive_line").select("*").in("archive_id", archiveIds).eq("source_sloc_group_id_snapshot", slocGroupId).eq("excluded_from_rate_input", false)
      : { data: [], error: null };
    if (archiveLineError) throw new Error("AC06_REPORT_FAILED");
    const materials = await materialMap(ids((liveLines ?? []).map((row: Row) => row.material_id)));
    const liveRows = (liveLines ?? []).map((line: Row) => {
      const reportMonth = byId.get(toTrimmedString(line.month_id)) as Row | undefined;
      const material = materials.get(toTrimmedString(line.material_id));
      return { ...line, rate_month: reportMonth?.rate_month ?? null, month_status: reportMonth?.status ?? null, pace_code: material?.pace_code ?? null, material_external_code: material?.external_code ?? null, material_name: material?.material_name ?? null };
    });
    const archiveRows = (archiveLines ?? []).map((line: Row) => {
      const archive = archiveById.get(toTrimmedString(line.archive_id)) as Row | undefined;
      const reportMonth = archive ? byId.get(toTrimmedString(archive.source_month_id)) as Row | undefined : undefined;
      return { ...line, id: `archive-${line.id}`, rate_month: reportMonth?.rate_month ?? null, month_status: "CLOSED", source_sloc_group_id: line.source_sloc_group_id_snapshot, costing_group_name_snapshot: line.costing_group_name_snapshot, pace_code: line.material_code_snapshot, material_external_code: line.material_external_code_snapshot ?? null, material_name: line.material_name_snapshot };
    });
    // PO11-parity merged-alphabetical order (§35.12/§35.18, same rule as the
    // live workspace's rowsForDisplay): group by (costing group, else the
    // material itself) so the same Costing Group's rows across every month
    // stay adjacent, sorted by that unit's own material name, then by month.
    const units = new Map<string, Row[]>();
    for (const row of [...liveRows, ...archiveRows]) {
      const key = toTrimmedString(row.costing_group_id) || toTrimmedString(row.costing_group_id_snapshot) || `standalone-${toTrimmedString(row.material_id)}`;
      units.set(key, [...(units.get(key) ?? []), row]);
    }
    const rows = [...units.values()]
      .map((members) => [...members].sort((a, b) =>
        String(a.material_name ?? "").localeCompare(String(b.material_name ?? "")) ||
        String(a.rate_month ?? "").localeCompare(String(b.rate_month ?? ""))))
      .sort((a, b) => String(a[0]?.material_name ?? "").localeCompare(String(b[0]?.material_name ?? "")))
      .flat();
    return okResponse({ data: { rows, months: monthRows ?? [] } }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "AC06_REPORT_FAILED"; return ac06Error(req, ctx, code, 500, "Unable to load AC06 rate report."); }
}

function pathId(req: Request, segment: string): string {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const index = parts.indexOf(segment);
  return index >= 0 ? toTrimmedString(parts[index + 1]) : "";
}

export async function updateAc06SlocGroupHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const groupId = pathId(req, "sloc-groups"); const body = await parseBody(req);
    const companyId = await companyScope(ctx, toTrimmedString(body.company_id)); const groupName = toTrimmedString(body.group_name); const locationIds = Array.isArray(body.storage_location_ids) ? ids(body.storage_location_ids) : null;
    if (!companyId || !groupId || !groupName) return ac06Error(req, ctx, "AC06_SLOC_GROUP_INVALID", 400, "company_id, group, and group_name are required.");
    const accessError = await requireAc06Action(req, ctx, companyId, "ACC_SLOC_COSTING_SETUP", "WRITE"); if (accessError) return accessError;
    if (locationIds !== null && !locationIds.length) return ac06Error(req, ctx, "AC06_SLOC_GROUP_INVALID", 400, "At least one storage location must remain in a SLOC Group.");
    if (locationIds !== null && !await validateAc06Locations(companyId, locationIds)) return ac06Error(req, ctx, "AC06_SLOC_LOCATION_INVALID", 422, "Each selected storage location must be active in the selected company.");
    const db = serviceRoleClient.schema("erp_production"); const now = new Date().toISOString();
    if (locationIds !== null) {
      const { data: claimedLocations, error: claimedLocationsError } = await db.from("ac06_sloc_group_member").select("storage_location_id, sloc_group_id").eq("company_id", companyId).eq("active", true).in("storage_location_id", locationIds).neq("sloc_group_id", groupId);
      if (claimedLocationsError) throw new Error("AC06_SLOC_GROUP_UPDATE_FAILED");
      if ((claimedLocations ?? []).length) return ac06Error(req, ctx, "AC06_SLOC_ALREADY_GROUPED", 409, "A selected storage location already belongs to another active SLOC Group.");
    }
    const { data, error } = await db.from("ac06_sloc_group")
      .update({ group_name: groupName, last_updated_by: ctx.auth_user_id, last_updated_at: new Date().toISOString() })
      .eq("id", groupId).eq("company_id", companyId).eq("active", true).select("*").maybeSingle();
    if (error || !data) return ac06Error(req, ctx, "AC06_SLOC_GROUP_NOT_FOUND", 404, "SLOC Group was not found in the selected company.");
    if (locationIds !== null) {
      const { data: activeMembers, error: memberLoadError } = await db.from("ac06_sloc_group_member").select("storage_location_id").eq("company_id", companyId).eq("sloc_group_id", groupId).eq("active", true);
      if (memberLoadError) throw new Error("AC06_SLOC_GROUP_UPDATE_FAILED");
      const existingIds = new Set(ids((activeMembers ?? []).map((row: Row) => row.storage_location_id)));
      const selectedIds = new Set(locationIds);
      const removedIds = [...existingIds].filter((id) => !selectedIds.has(id));
      const addedIds = locationIds.filter((id) => !existingIds.has(id));
      for (const storageLocationId of addedIds) {
        const { data: otherMember, error: otherMemberError } = await db.from("ac06_sloc_group_member").select("sloc_group_id").eq("company_id", companyId).eq("storage_location_id", storageLocationId).eq("active", true).neq("sloc_group_id", groupId).maybeSingle();
        if (otherMemberError) throw new Error("AC06_SLOC_GROUP_UPDATE_FAILED");
        if (otherMember) return ac06Error(req, ctx, "AC06_SLOC_ALREADY_GROUPED", 409, "A selected storage location already belongs to another active SLOC Group.");
      }
      if (removedIds.length) {
        const { error: removeError } = await db.from("ac06_sloc_group_member").update({ active: false, removed_at: now, removed_by: ctx.auth_user_id }).eq("company_id", companyId).eq("sloc_group_id", groupId).eq("active", true).in("storage_location_id", removedIds);
        if (removeError) throw new Error("AC06_SLOC_GROUP_UPDATE_FAILED");
      }
      for (const storageLocationId of addedIds) {
        const { data: inactiveMember, error: inactiveMemberError } = await db.from("ac06_sloc_group_member").select("id").eq("company_id", companyId).eq("sloc_group_id", groupId).eq("storage_location_id", storageLocationId).eq("active", false).maybeSingle();
        if (inactiveMemberError) throw new Error("AC06_SLOC_GROUP_UPDATE_FAILED");
        const memberResult = inactiveMember
          ? await db.from("ac06_sloc_group_member").update({ active: true, added_by: ctx.auth_user_id, added_at: now, removed_by: null, removed_at: null }).eq("id", inactiveMember.id)
          : await db.from("ac06_sloc_group_member").insert({ company_id: companyId, sloc_group_id: groupId, storage_location_id: storageLocationId, added_by: ctx.auth_user_id, added_at: now });
        if (memberResult.error) throw new Error("AC06_SLOC_GROUP_UPDATE_FAILED");
      }
    }
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "AC06_SLOC_GROUP_UPDATE_FAILED"; return ac06Error(req, ctx, code, 500, "Unable to update SLOC Group."); }
}

export async function updateAc06CostingGroupHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const groupId = pathId(req, "costing-groups"); const body = await parseBody(req);
    const companyId = await companyScope(ctx, toTrimmedString(body.company_id)); const groupName = toTrimmedString(body.group_name);
    if (!companyId || !groupId || !groupName) return ac06Error(req, ctx, "AC06_COSTING_GROUP_INVALID", 400, "company_id, group, and group_name are required.");
    const accessError = await requireAc06Action(req, ctx, companyId, "ACC_SLOC_COSTING_SETUP", "WRITE"); if (accessError) return accessError;
    const { data, error } = await serviceRoleClient.schema("erp_production").from("ac06_costing_group")
      .update({ group_name: groupName, last_updated_by: ctx.auth_user_id, last_updated_at: new Date().toISOString() })
      .eq("id", groupId).eq("company_id", companyId).eq("active", true).select("*").maybeSingle();
    if (error || !data) return ac06Error(req, ctx, "AC06_COSTING_GROUP_NOT_FOUND", 404, "Costing Group was not found in the selected company.");
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "AC06_COSTING_GROUP_UPDATE_FAILED"; return ac06Error(req, ctx, code, 500, "Unable to update Costing Group."); }
}

export async function deleteAc06SlocGroupHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const groupId = pathId(req, "sloc-groups"); const body = await parseBody(req);
    const companyId = await companyScope(ctx, toTrimmedString(body.company_id));
    if (!companyId || !groupId) return ac06Error(req, ctx, "AC06_SLOC_GROUP_INVALID", 400, "company_id and group are required.");
    const accessError = await requireAc06Action(req, ctx, companyId, "ACC_SLOC_COSTING_SETUP", "DELETE"); if (accessError) return accessError;
    const db = serviceRoleClient.schema("erp_production");
    const childResult = await db.from("ac06_costing_group").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("sloc_group_id", groupId).eq("active", true);
    if (childResult.error) throw new Error("AC06_SLOC_GROUP_DELETE_FAILED");
    if (((childResult as { count?: number | null }).count ?? 0) > 0) return ac06Error(req, ctx, "AC06_SLOC_GROUP_HAS_COSTING_GROUPS", 409, "Remove or delete the dependent Costing Groups before deleting this SLOC Group.");
    const now = new Date().toISOString();
    const { error: memberError } = await db.from("ac06_sloc_group_member").update({ active: false, removed_at: now, removed_by: ctx.auth_user_id }).eq("company_id", companyId).eq("sloc_group_id", groupId).eq("active", true);
    if (memberError) throw new Error("AC06_SLOC_GROUP_DELETE_FAILED");
    const { data, error } = await db.from("ac06_sloc_group").update({ active: false, last_updated_by: ctx.auth_user_id, last_updated_at: now }).eq("id", groupId).eq("company_id", companyId).eq("active", true).select("id").maybeSingle();
    if (error || !data) return ac06Error(req, ctx, "AC06_SLOC_GROUP_NOT_FOUND", 404, "SLOC Group was not found in the selected company.");
    return okResponse({ data: { id: groupId, deleted: true } }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "AC06_SLOC_GROUP_DELETE_FAILED"; return ac06Error(req, ctx, code, 500, "Unable to delete SLOC Group."); }
}

export async function deleteAc06CostingGroupHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const groupId = pathId(req, "costing-groups"); const body = await parseBody(req);
    const companyId = await companyScope(ctx, toTrimmedString(body.company_id));
    if (!companyId || !groupId) return ac06Error(req, ctx, "AC06_COSTING_GROUP_INVALID", 400, "company_id and group are required.");
    const accessError = await requireAc06Action(req, ctx, companyId, "ACC_SLOC_COSTING_SETUP", "DELETE"); if (accessError) return accessError;
    const db = serviceRoleClient.schema("erp_production"); const { data: group, error: lookupError } = await db.from("ac06_costing_group").select("id").eq("id", groupId).eq("company_id", companyId).eq("active", true).maybeSingle();
    if (lookupError || !group) return ac06Error(req, ctx, "AC06_COSTING_GROUP_NOT_FOUND", 404, "Costing Group was not found in the selected company.");
    const now = new Date().toISOString();
    const { data: openMonths, error: monthError } = await db.from("ac06_month").select("id").eq("company_id", companyId).eq("status", "OPEN");
    if (monthError) throw new Error("AC06_COSTING_GROUP_DELETE_FAILED");
    const openMonthIds = ids((openMonths ?? []).map((month: Row) => month.id));
    if (openMonthIds.length) {
      const { error: lineError } = await db.from("ac06_month_line").update({ costing_group_id: null, costing_group_name_snapshot: null, verification_status: "PENDING", rate_changed_at: now, rate_changed_by: ctx.auth_user_id, last_updated_at: now, last_updated_by: ctx.auth_user_id }).in("month_id", openMonthIds).eq("costing_group_id", groupId);
      if (lineError) throw new Error("AC06_COSTING_GROUP_DELETE_FAILED");
      const { error: configError } = await db.from("ac06_month_group_config").update({ costing_group_id: null, costing_group_name_snapshot: null, last_updated_at: now, last_updated_by: ctx.auth_user_id }).in("month_id", openMonthIds).eq("costing_group_id", groupId);
      if (configError) throw new Error("AC06_COSTING_GROUP_DELETE_FAILED");
    }
    const { error } = await db.from("ac06_costing_group").update({ active: false, last_updated_by: ctx.auth_user_id, last_updated_at: now }).eq("id", groupId).eq("company_id", companyId);
    if (error) throw new Error("AC06_COSTING_GROUP_DELETE_FAILED");
    return okResponse({ data: { id: groupId, deleted: true } }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "AC06_COSTING_GROUP_DELETE_FAILED"; return ac06Error(req, ctx, code, 500, "Unable to delete Costing Group."); }
}

export async function unassignAc06CostingGroupHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req); const companyId = await companyScope(ctx, toTrimmedString(body.company_id));
    const rateMonth = monthStart(body.rate_month); const lineIds = ids(body.line_ids);
    if (!companyId || !rateMonth || !lineIds.length) return ac06Error(req, ctx, "AC06_UNASSIGN_INVALID", 400, "company_id, rate_month, and line_ids are required.");
    const accessError = await requireAc06Action(req, ctx, companyId, "ACC_SLOC_COSTING_SETUP", "WRITE"); if (accessError) return accessError;
    const month = await getMonth(ctx, companyId, rateMonth); if (month.status === "CLOSED") return ac06Error(req, ctx, "AC06_MONTH_CLOSED", 409, "Closed month cannot be changed.");
    const db = serviceRoleClient.schema("erp_production"); const { data: rows, error } = await db.from("ac06_month_line").select("id, source_sloc_group_id, material_id").eq("month_id", month.id).in("id", lineIds);
    if (error || (rows ?? []).length !== lineIds.length) return ac06Error(req, ctx, "AC06_UNASSIGN_INVALID", 409, "Selected row is outside this monthly scope.");
    const now = new Date().toISOString(); const { error: updateError } = await db.from("ac06_month_line").update({ costing_group_id: null, costing_group_name_snapshot: null, verification_status: "PENDING", rate_changed_at: now, rate_changed_by: ctx.auth_user_id, last_updated_at: now, last_updated_by: ctx.auth_user_id }).eq("month_id", month.id).in("id", lineIds);
    if (updateError) throw new Error("AC06_UNASSIGN_FAILED");
    for (const row of (rows ?? []) as Row[]) await db.from("ac06_month_group_config").update({ costing_group_id: null, costing_group_name_snapshot: null, last_updated_at: now, last_updated_by: ctx.auth_user_id }).eq("month_id", month.id).eq("source_sloc_group_id", row.source_sloc_group_id).eq("material_id", row.material_id);
    return okResponse({ data: { unassigned: lineIds.length } }, ctx.request_id, req);
  } catch (error) { return ac06ErrorFromCaught(req, ctx, error, "AC06_UNASSIGN_FAILED", "Unable to make selected items standalone."); }
}

export async function closeAc06MonthHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req); const companyId = await companyScope(ctx, toTrimmedString(body.company_id)); const rateMonth = monthStart(body.rate_month);
    if (!companyId || !rateMonth) return ac06Error(req, ctx, "AC06_CLOSE_INVALID", 400, "company_id and rate_month are required.");
    const accessError = await requireAc06Action(req, ctx, companyId, "ACC_SLOC_COSTING_CLOSE", "WRITE"); if (accessError) return accessError;
    const month = await getMonth(ctx, companyId, rateMonth); if (month.status === "CLOSED") return ac06Error(req, ctx, "AC06_MONTH_CLOSED", 409, "Month is already closed.");
    const { data: archiveId, error } = await serviceRoleClient.schema("erp_production").rpc("close_ac06_month", { p_month_id: month.id, p_closed_by: ctx.auth_user_id });
    if (error || !archiveId) throw new Error("AC06_CLOSE_FAILED");
    return okResponse({ data: { archive_id: archiveId, status: "CLOSED" } }, ctx.request_id, req);
  } catch (error) { return ac06ErrorFromCaught(req, ctx, error, "AC06_CLOSE_FAILED", "Unable to close monthly costing rates."); }
}

export async function getAc06HistoryHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url); const companyId = await companyScope(ctx, url.searchParams.get("company_id") ?? undefined); const rateMonth = monthStart(url.searchParams.get("rate_month"));
    if (!companyId || !rateMonth) return ac06Error(req, ctx, "AC06_HISTORY_FILTER_INVALID", 400, "company_id and rate_month are required.");
    const accessError = await requireAc06Action(req, ctx, companyId, "ACC_SLOC_COSTING_GROUP", "VIEW"); if (accessError) return accessError;
    const db = serviceRoleClient.schema("erp_production"); const { data: archive, error } = await db.from("ac06_month_archive").select("*").eq("company_id", companyId).eq("rate_month", rateMonth).maybeSingle();
    if (error) throw new Error("AC06_HISTORY_FAILED"); if (!archive) return okResponse({ data: { archive: null, rows: [] } }, ctx.request_id, req);
    const { data: rows, error: rowError } = await db.from("ac06_month_archive_line").select("*").eq("archive_id", archive.id).order("display_order");
    if (rowError) throw new Error("AC06_HISTORY_FAILED"); return okResponse({ data: { archive, rows: rows ?? [] } }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "AC06_HISTORY_FAILED"; return ac06Error(req, ctx, code, 500, "Unable to load closed-month history."); }
}
