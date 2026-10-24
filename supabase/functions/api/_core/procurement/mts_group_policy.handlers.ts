/* PO22 Family Waterfall F1 — effective-dated group Target/Critical/Desired Max. */
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse } from "../response.ts";
import { loadCompanyGroups } from "./mts_group_usage_order.handlers.ts";
import {
  defaultCriticalDays,
  effectiveGroupCoveragePolicies,
  type GroupCoveragePolicyVersion,
} from "./mts_group_policy.logic.ts";
import {
  fail,
  handleError,
  requireRequirementPolicyAccess,
  requireRequirementViewAccess,
  todayInIndia,
  type ReqHandlerContext,
} from "./mts_requirement.handlers.ts";
import { isIsoDate } from "./mts_requirement.logic.ts";

type JsonRecord = Record<string, unknown>;
const text = (value: unknown) => String(value ?? "").trim();
const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const MAX_ROWS_PER_SAVE = 500;

async function loadRows(companyId: string): Promise<GroupCoveragePolicyVersion[]> {
  const { data, error } = await serviceRoleClient.schema("erp_planning").from("material_group_coverage_policy")
    .select("material_group_id, effective_from, target_cov_days, critical_cov_days, desired_max_days_override")
    .eq("company_id", companyId).eq("is_current", true).order("effective_from");
  if (error) throw new Error("MTS_GROUP_POLICY_LOAD_FAILED");
  return ((data ?? []) as JsonRecord[]).map((row) => ({
    material_group_id: text(row.material_group_id), effective_from: text(row.effective_from),
    target_days: Number(row.target_cov_days), critical_days: Number(row.critical_cov_days),
    desired_max_days_override: asNumber(row.desired_max_days_override),
  }));
}

export async function getMtsGroupPolicyHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = text(url.searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    const asOf = text(url.searchParams.get("as_of")) || todayInIndia();
    if (!isIsoDate(asOf)) return fail(req, ctx, "MTS_REQ_INVALID_AS_OF", 400, "as_of must be YYYY-MM-DD.");
    const [groups, rows] = await Promise.all([loadCompanyGroups(companyId), loadRows(companyId)]);
    const effective = effectiveGroupCoveragePolicies(rows, asOf);
    return okResponse({
      company_id: companyId, as_of: asOf, default_target_days: 30,
      rows: [...groups.keys()].sort().map((material_group_id) => {
        const current = effective.get(material_group_id) ?? null;
        return {
          material_group_id,
          policy: current ? {
            effective_from: current.effective_from, target_days: current.target_days, critical_days: current.critical_days,
            desired_max_days_override: current.desired_max_days_override,
          } : {
            effective_from: null, target_days: 30, critical_days: defaultCriticalDays(30), desired_max_days_override: null,
          },
          future_policies: rows.filter((row) => row.material_group_id === material_group_id && row.effective_from > asOf).map((row) => ({
            effective_from: row.effective_from, target_days: row.target_days, critical_days: row.critical_days,
            desired_max_days_override: row.desired_max_days_override,
          })),
        };
      }),
    }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_GROUP_POLICY_LIST_FAILED", "Could not load Group Coverage Policy.");
  }
}

export async function saveMtsGroupPolicyHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({} as JsonRecord)) as JsonRecord;
    const companyId = text(body.company_id);
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementPolicyAccess(req, ctx, companyId);
    if (denied) return denied;
    const raw = Array.isArray(body.rows) ? body.rows as JsonRecord[] : [];
    if (raw.length === 0) return fail(req, ctx, "MTS_GROUP_POLICY_NO_ROWS", 400, "Nothing to save.");
    if (raw.length > MAX_ROWS_PER_SAVE) return fail(req, ctx, "MTS_GROUP_POLICY_TOO_MANY_ROWS", 400, `At most ${MAX_ROWS_PER_SAVE} rows per save.`);
    const companyGroups = await loadCompanyGroups(companyId);
    const seen = new Set<string>();
    const rows = raw.map((row) => {
      const material_group_id = text(row.material_group_id);
      const effective_from = text(row.effective_from);
      const target_cov_days = asNumber(row.target_cov_days);
      const critical_cov_days = asNumber(row.critical_cov_days);
      const desired_max_days_override = asNumber(row.desired_max_days_override);
      if (!companyGroups.has(material_group_id)) throw new Error("MTS_GROUP_POLICY_GROUP_NOT_IN_COMPANY");
      if (!isIsoDate(effective_from)) throw new Error("MTS_GROUP_POLICY_INVALID_INPUT");
      if ([target_cov_days, critical_cov_days, desired_max_days_override].some((value) => value !== null && value < 0)) throw new Error("MTS_GROUP_POLICY_NEGATIVE");
      const target = target_cov_days ?? 30;
      const critical = critical_cov_days ?? defaultCriticalDays(target);
      if (critical > target) throw new Error("MTS_GROUP_POLICY_CRITICAL_GT_TARGET");
      const key = `${material_group_id}|${effective_from}`;
      if (seen.has(key)) throw new Error("MTS_GROUP_POLICY_DUPLICATE_ROW");
      seen.add(key);
      return { material_group_id, effective_from, target_cov_days: target, critical_cov_days: critical, desired_max_days_override, remarks: text(row.remarks) || null };
    });
    const { data, error } = await serviceRoleClient.schema("erp_planning").rpc("save_material_group_coverage_policies", {
      p_company_id: companyId, p_actor: ctx.auth_user_id, p_rows: rows,
    });
    if (error) {
      const code = /MTS_GROUP_POLICY_[A-Z_]+|PLANNING_APPEND_ONLY/.exec(String(error.message))?.[0] ?? null;
      if (code) return fail(req, ctx, code, 400, String(error.message).replace(/^.*?(MTS_GROUP_POLICY_[A-Z_]+|PLANNING_APPEND_ONLY):\s*/, ""));
      throw new Error("MTS_GROUP_POLICY_SAVE_FAILED");
    }
    return okResponse({ result: data }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code.startsWith("MTS_GROUP_POLICY_")) return fail(req, ctx, code, 400, code.replaceAll("_", " ").toLowerCase());
    return handleError(req, ctx, error, "MTS_GROUP_POLICY_SAVE_FAILED", "Could not save Group Coverage Policy.");
  }
}
