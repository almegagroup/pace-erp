/*
 * File-Path: supabase/functions/api/_core/procurement/mts_group_usage_order.handlers.ts
 * Purpose: PO22 Material Settings — "Group Settings" (owner 2026-10-22): per company and
 *          material group, which member is used first (most stock / least stock / fixed
 *          order). Read by PO22 planning and the MTS production auto-derive. No setting =
 *          default (planning Method C, production §138.12).
 *
 *   GET  /api/procurement/mts-requirement/group-usage-order?company_id&as_of
 *   POST /api/procurement/mts-requirement/group-usage-order  { company_id, rows: [...] }
 */
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { GROUP_USAGE_ORDER_MODES, effectiveGroupUsageOrders } from "../../_shared/groupUsageOrder.logic.ts";
import { loadGroupUsageOrderRows } from "../../_shared/groupUsageOrder.ts";
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse } from "../response.ts";
import {
  fail,
  handleError,
  loadFormulationMasters,
  loadMaterialRows,
  requireRequirementPolicyAccess,
  requireRequirementViewAccess,
  todayInIndia,
  type ReqHandlerContext,
} from "./mts_requirement.handlers.ts";
import { isIsoDate } from "./mts_requirement.logic.ts";

type JsonRecord = Record<string, unknown>;

const text = (value: unknown) => String(value ?? "").trim();
const MAX_ROWS_PER_SAVE = 500;

/** Groups used by this company's MTS strokes (RM) / Pack BOMs (PM), with every member. */
async function loadCompanyGroups(companyId: string) {
  const masters = await loadFormulationMasters(companyId, []);
  const groups = new Map<string, { kinds: Set<"RM" | "PM">; members: Set<string> }>();
  const touch = (groupId: string | null, kind: "RM" | "PM", lineMaterial: string) => {
    if (!groupId) return;
    const entry = groups.get(groupId) ?? { kinds: new Set(), members: new Set() };
    entry.kinds.add(kind);
    if (lineMaterial) entry.members.add(lineMaterial);
    groups.set(groupId, entry);
  };
  for (const stroke of masters.strokes.values()) for (const line of stroke.lines) touch(line.material_group_id, "RM", line.material_id);
  for (const bom of masters.packBoms.values()) for (const line of bom.inputs) touch(line.material_group_id ?? null, "PM", line.material_id);
  for (const [groupId, entry] of groups) {
    for (const member of masters.groupMembers.get(groupId) ?? []) if (member.active !== false) entry.members.add(member.material_id);
  }
  return groups;
}

export async function getMtsGroupUsageOrderHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = text(url.searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    const asOf = text(url.searchParams.get("as_of")) || todayInIndia();
    if (!isIsoDate(asOf)) return fail(req, ctx, "MTS_REQ_INVALID_AS_OF", 400, "as_of must be YYYY-MM-DD.");

    const [groups, settingRows, canEdit] = await Promise.all([
      loadCompanyGroups(companyId),
      loadGroupUsageOrderRows(companyId),
      canMaintainCompanyResource(ctx, companyId, "PROC_MTS_REQUIREMENT_POLICY", "WRITE"),
    ]);
    const groupIds = [...groups.keys()];
    const memberIds = [...new Set([...groups.values()].flatMap((g) => [...g.members]))];
    const [groupRows, materialRows, stockRows, users] = await Promise.all([
      groupIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(groupIds, (chunk) => serviceRoleClient
        .schema("erp_master").from("material_category_group").select("id, group_code, group_name").in("id", chunk)),
      loadMaterialRows(memberIds),
      // Display only: unrestricted stock of each member over every location of the company.
      memberIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(memberIds, (chunk) => serviceRoleClient
        .schema("erp_inventory").from("stock_snapshot").select("material_id, quantity")
        .eq("company_id", companyId).eq("stock_type_code", "UNRESTRICTED").in("material_id", chunk)),
      resolveUserDisplayNames(settingRows.map((r) => r.created_by)),
    ]);
    const groupById = new Map(groupRows.map((g) => [text(g.id), g]));
    const stockBy = new Map<string, number>();
    for (const row of stockRows) stockBy.set(text(row.material_id), (stockBy.get(text(row.material_id)) ?? 0) + Number(row.quantity ?? 0));
    const effective = effectiveGroupUsageOrders(settingRows, asOf);

    const rows = groupIds.map((groupId) => {
      const entry = groups.get(groupId)!;
      const group = groupById.get(groupId);
      const current = settingRows
        .filter((r) => r.material_group_id === groupId && r.effective_from <= asOf)
        .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
      const future = settingRows.filter((r) => r.material_group_id === groupId && r.effective_from > asOf);
      return {
        material_group_id: groupId,
        group_code: text(group?.group_code) || null,
        group_name: text(group?.group_name) || "—",
        kind: [...entry.kinds].sort().join(" / "),
        members: [...entry.members].map((id) => {
          const m = materialRows.get(id);
          return {
            material_id: id,
            material_code: text(m?.pace_code) || null,
            material_name: text(m?.material_name) || "—",
            base_uom_code: text(m?.base_uom_code) || null,
            unrestricted_stock: Math.round((stockBy.get(id) ?? 0) * 1000) / 1000,
          };
        }).sort((a, b) => a.material_name.localeCompare(b.material_name)),
        setting: current && effective.has(groupId) ? {
          effective_from: current.effective_from,
          version_no: current.version_no,
          order_mode: current.order_mode,
          member_order: current.member_order,
          remarks: current.remarks,
          updated_by: users.get(current.created_by) ?? "—",
          updated_at: current.created_at,
        } : null,
        future_settings: future.map((f) => ({ effective_from: f.effective_from, order_mode: f.order_mode, member_order: f.member_order })),
      };
    }).sort((a, b) => a.kind.localeCompare(b.kind) || a.group_name.localeCompare(b.group_name));
    return okResponse({ company_id: companyId, as_of: asOf, can_edit: canEdit, rows }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_REQ_GROUP_ORDER_LIST_FAILED", "Could not load Group Settings.");
  }
}

export async function saveMtsGroupUsageOrderHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({} as JsonRecord)) as JsonRecord;
    const companyId = text(body.company_id);
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementPolicyAccess(req, ctx, companyId);
    if (denied) return denied;
    const raw = Array.isArray(body.rows) ? body.rows as JsonRecord[] : [];
    if (raw.length === 0) return fail(req, ctx, "MTS_REQ_GROUP_ORDER_NO_ROWS", 400, "Nothing to save.");
    if (raw.length > MAX_ROWS_PER_SAVE) return fail(req, ctx, "MTS_REQ_GROUP_ORDER_TOO_MANY_ROWS", 400, `At most ${MAX_ROWS_PER_SAVE} rows per save.`);

    // Only a group this company's MTS strokes / Pack BOMs actually use, and only its own members.
    const groups = await loadCompanyGroups(companyId);
    const rows = [];
    for (const row of raw) {
      const groupId = text(row.material_group_id);
      const group = groups.get(groupId);
      if (!group) return fail(req, ctx, "MTS_REQ_GROUP_ORDER_GROUP_NOT_IN_COMPANY", 400, "A group on this save is not used by this company's MTS Strokes / Pack BOMs.");
      const effectiveFrom = text(row.effective_from);
      if (!isIsoDate(effectiveFrom)) return fail(req, ctx, "MTS_REQ_GROUP_ORDER_INVALID_INPUT", 400, "Every row needs a valid Effective From date (YYYY-MM-DD).");
      const mode = text(row.order_mode).toUpperCase();
      if (!(GROUP_USAGE_ORDER_MODES as readonly string[]).includes(mode)) return fail(req, ctx, "MTS_REQ_GROUP_ORDER_INVALID_INPUT", 400, "Order must be Most stock first, Least stock first or Fixed order.");
      const memberOrder = Array.isArray(row.member_order) ? (row.member_order as unknown[]).map(text).filter(Boolean) : [];
      if (mode === "FIXED_ORDER") {
        if (memberOrder.length === 0) return fail(req, ctx, "MTS_REQ_GROUP_ORDER_INVALID_INPUT", 400, "Fixed order needs the member list in order.");
        if (new Set(memberOrder).size !== memberOrder.length || memberOrder.some((id) => !group.members.has(id))) {
          return fail(req, ctx, "MTS_REQ_GROUP_ORDER_INVALID_INPUT", 400, "Fixed order may list each member of this group once, and only its own members.");
        }
      }
      rows.push({
        material_group_id: groupId,
        effective_from: effectiveFrom,
        order_mode: mode,
        member_order: mode === "FIXED_ORDER" ? memberOrder : [],
        remarks: text(row.remarks) || null,
      });
    }
    const { data, error } = await serviceRoleClient.schema("erp_planning").rpc("save_material_group_usage_orders", {
      p_company_id: companyId,
      p_actor: ctx.auth_user_id,
      p_rows: rows,
    });
    if (error) {
      const code = /MTS_REQ_GROUP_ORDER_[A-Z_]+|PLANNING_APPEND_ONLY/.exec(String(error.message))?.[0] ?? null;
      if (code) return fail(req, ctx, code, 400, String(error.message).replace(/^.*?(MTS_REQ_GROUP_ORDER_[A-Z_]+|PLANNING_APPEND_ONLY):\s*/, ""));
      throw new Error("MTS_REQ_GROUP_ORDER_SAVE_FAILED");
    }
    return okResponse({ result: data }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_REQ_GROUP_ORDER_SAVE_FAILED", "Could not save Group Settings.");
  }
}
