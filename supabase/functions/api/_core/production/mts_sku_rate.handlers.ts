/*
 * File-ID: 27.25-BE
 * File-Path: supabase/functions/api/_core/production/mts_sku_rate.handlers.ts
 * Gate: 27.25
 * Domain: PRODUCTION / COSTING (Accounts ACL)
 * Purpose: AC05 MTS SKU monthly sale-rate master. Company-scoped FG SKU list with
 *          draft-save, separate approve action, and approved-month lookup for future SO use.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
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
  toUpperTrimmedString,
} from "./production.shared.ts";

type JsonRecord = Record<string, unknown>;

type ScopedSkuRow = {
  material_id: string;
  pace_code: string;
  material_name: string;
  base_uom_code: string | null;
  dispatch_uom_options?: Array<{ uom_code: string; label: string; factor_to_kg: number }>;
};

type MaterialUomConversionRow = {
  material_id: string;
  from_uom_code: string | null;
  to_uom_code: string | null;
  conversion_factor: number | null;
  variable_conversion: boolean | null;
};

function rateError(req: Request, ctx: ProdHandlerContext, code: string, status: number, message: string): Response {
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

function normalizeUomCode(raw: unknown): string {
  return toUpperTrimmedString(raw);
}

function dedupeOptions(options: Array<{ uom_code: string; label: string; factor_to_kg: number }>) {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = `${option.uom_code}|||${option.factor_to_kg}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getMaterialKgConversionMap(materialIds: string[]): Promise<Map<string, Array<{ uom_code: string; label: string; factor_to_kg: number }>>> {
  if (materialIds.length === 0) return new Map();
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_uom_conversion")
    .select("material_id, from_uom_code, to_uom_code, conversion_factor, variable_conversion")
    .in("material_id", materialIds);
  if (error) {
    console.error("[mts_sku_rate.getMaterialKgConversionMap] query failed:", JSON.stringify(error));
    throw new Error("PROD_MTS_RATE_LIST_FAILED");
  }

  const map = new Map<string, Array<{ uom_code: string; label: string; factor_to_kg: number }>>();
  for (const row of ((data ?? []) as MaterialUomConversionRow[])) {
    if (row.variable_conversion === true) continue;
    const materialId = toTrimmedString(row.material_id);
    const fromUom = normalizeUomCode(row.from_uom_code);
    const toUom = normalizeUomCode(row.to_uom_code);
    const factor = Number(row.conversion_factor ?? 0);
    if (!materialId || !fromUom || !toUom || !Number.isFinite(factor) || factor <= 0) continue;
    const bucket = map.get(materialId) ?? [];
    if (fromUom === "KG") {
      bucket.push({ uom_code: "KG", label: "KG", factor_to_kg: 1 });
      bucket.push({ uom_code: toUom, label: toUom, factor_to_kg: 1 / factor });
    } else if (toUom === "KG") {
      bucket.push({ uom_code: "KG", label: "KG", factor_to_kg: 1 });
      bucket.push({ uom_code: fromUom, label: fromUom, factor_to_kg: factor });
    }
    map.set(materialId, dedupeOptions(bucket).sort((a, b) => a.uom_code.localeCompare(b.uom_code)));
  }
  return map;
}

function resolveRatePerKg(
  dispatchUomCode: string,
  rate: number,
  options: Array<{ uom_code: string; label: string; factor_to_kg: number }>,
): number | null {
  const selected = options.find((option) => option.uom_code === dispatchUomCode);
  if (!selected || !Number.isFinite(selected.factor_to_kg) || selected.factor_to_kg <= 0) return null;
  return Number((rate / selected.factor_to_kg).toFixed(6));
}

async function loadMtsRateApprovalRequired(): Promise<boolean> {
  const { data } = await serviceRoleClient
    .schema("acl")
    .from("resource_approval_policy")
    .select("approval_required")
    .eq("resource_code", "ACC_MTS_SKU_MONTHLY_RATE")
    .eq("action_code", "WRITE")
    .maybeSingle();
  return data?.approval_required === true;
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

async function loadMtsRateApproverRules(companyId: string): Promise<ApproverMapRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("acl")
    .from("approver_map")
    .select(
      "approver_user_id, approver_role_code, approver_work_context_id, resource_code, action_code, scope_type, subject_user_id, subject_work_context_id, subject_role_code, approval_stage",
    )
    .eq("resource_code", "ACC_MTS_SKU_MONTHLY_RATE")
    .eq("action_code", "APPROVE")
    .eq("company_id", companyId);
  if (error) throw new Error("PROD_MTS_RATE_APPROVER_LOOKUP_FAILED");
  return (data as ApproverMapRow[] | null) ?? [];
}

async function getMtsRateUserRoleCodes(userIds: string[]): Promise<Map<string, string | null>> {
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

// Batch approval can cover DRAFT rows saved by different creators (e.g. multiple Accounts
// users saving lines for the same company+rate_month across separate calls) — every distinct
// creator present in the batch must independently clear the approver-role + self-approval check.
async function assertMtsRateApproverRole(
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
  const rules = await loadMtsRateApproverRules(companyId);
  const distinctCreatorIds = [...new Set(creatorIds.map((id) => toTrimmedString(id)).filter(Boolean))];
  // INDEPENDENT: each creator's role lookup doesn't depend on any other's, so batch
  // fetch once instead of a sequential await-per-creator loop (CLAUDE.md §8B).
  const creatorRoleCodes = rules.length === 0
    ? new Map<string, string | null>()
    : await getMtsRateUserRoleCodes(distinctCreatorIds);
  // INDEPENDENT of the per-creator loop below — resolve once (CLAUDE.md §8B).
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
          resource_code: "ACC_MTS_SKU_MONTHLY_RATE",
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
    if (!isConfiguredApprover) throw new Error("PROD_MTS_RATE_APPROVER_ROLE_REQUIRED");
    // DIRECTOR already returned above, so this can never fire for DIRECTOR.
    if (createdBy === ctx.auth_user_id && !hasBlanketApprovalOverride(ctx)) {
      throw new Error("PROD_MTS_RATE_SELF_APPROVAL_FORBIDDEN");
    }
  }
}

async function getScopedMtsSkuRows(companyId: string): Promise<ScopedSkuRow[]> {
  const { data: skuRows, error: skuError } = await serviceRoleClient
    .schema("erp_master")
    .from("material_plant_ext")
    .select("material_id")
    .eq("company_id", companyId);
  if (skuError) {
    console.error("[mts_sku_rate.getScopedMtsSkuRows.materialPlantExt] query failed:", JSON.stringify(skuError));
    throw new Error("PROD_MTS_RATE_LIST_FAILED");
  }

  const materialIds = [...new Set(((skuRows ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.material_id)).filter(Boolean))];
  if (materialIds.length === 0) return [];

  const { data: skuMaterials, error: materialError } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, pace_code, material_name, base_uom_code, shade_code, pack_code")
    .in("id", materialIds);
  if (materialError) {
    console.error("[mts_sku_rate.getScopedMtsSkuRows.materialMaster] query failed:", JSON.stringify(materialError));
    throw new Error("PROD_MTS_RATE_LIST_FAILED");
  }

  const { data: prodshadeConfigs, error: configError } = await serviceRoleClient
    .schema("erp_production")
    .from("prodshade_pack_config")
    .select(`
      material_id,
      active,
      pack_code:pack_code_master!pack_code_id(pack_code)
    `)
    .eq("active", true);
  if (configError) {
    console.error("[mts_sku_rate.getScopedMtsSkuRows.prodshadePackConfig] query failed:", JSON.stringify(configError));
    throw new Error("PROD_MTS_RATE_LIST_FAILED");
  }

  const prodshadeIds = [...new Set(((prodshadeConfigs ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.material_id)).filter(Boolean))];
  if (prodshadeIds.length === 0) return [];

  const [prodshadesResult, strokeResult] = await Promise.all([
    serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .select("id, shade_code")
      .in("id", prodshadeIds),
    serviceRoleClient
      .schema("erp_production")
      .from("stroke_master")
      .select("prodshade_material_id")
      .eq("company_id", companyId)
      .eq("po_type", "MTS")
      .eq("status", "APPROVED"),
  ]);

  if (prodshadesResult.error) {
    console.error("[mts_sku_rate.getScopedMtsSkuRows.prodshadeMaterials] query failed:", JSON.stringify(prodshadesResult.error));
    throw new Error("PROD_MTS_RATE_LIST_FAILED");
  }
  if (strokeResult.error) {
    console.error("[mts_sku_rate.getScopedMtsSkuRows.strokeMaster] query failed:", JSON.stringify(strokeResult.error));
    throw new Error("PROD_MTS_RATE_LIST_FAILED");
  }

  const prodshadeMaterialMap = new Map<string, JsonRecord>();
  for (const row of ((prodshadesResult.data ?? []) as JsonRecord[])) {
    prodshadeMaterialMap.set(toTrimmedString(row.id), row);
  }

  const approvedProdshadeIds = new Set(
    ((strokeResult.data ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.prodshade_material_id)).filter(Boolean),
  );
  const activeMatchKeys = new Set<string>();
  for (const row of ((prodshadeConfigs ?? []) as JsonRecord[])) {
    const prodshadeId = toTrimmedString(row.material_id);
    if (!approvedProdshadeIds.has(prodshadeId)) continue;
    const prodshade = prodshadeMaterialMap.get(prodshadeId);
    const packCode = toTrimmedString(((row.pack_code ?? {}) as JsonRecord).pack_code);
    const shadeCode = toTrimmedString(prodshade?.shade_code);
    if (!shadeCode || !packCode) continue;
    activeMatchKeys.add(`${shadeCode}|||${packCode}`);
  }

  const conversionMap = await getMaterialKgConversionMap(materialIds);
  const scopedRows = ((skuMaterials ?? []) as JsonRecord[])
    .filter((row) => activeMatchKeys.has(`${toTrimmedString(row.shade_code)}|||${toTrimmedString(row.pack_code)}`))
    .map((row) => ({
      material_id: toTrimmedString(row.id),
      pace_code: toTrimmedString(row.pace_code),
      material_name: toTrimmedString(row.material_name),
      base_uom_code: toTrimmedString(row.base_uom_code) || null,
      dispatch_uom_options: dedupeOptions([
        ...(normalizeUomCode(row.base_uom_code) === "KG" ? [{ uom_code: "KG", label: "KG", factor_to_kg: 1 }] : []),
        ...(conversionMap.get(toTrimmedString(row.id)) ?? []),
      ]),
    }))
    .filter((row) => (row.dispatch_uom_options ?? []).length > 0)
    .sort((a, b) => {
      const codeCmp = a.pace_code.localeCompare(b.pace_code);
      return codeCmp !== 0 ? codeCmp : a.material_name.localeCompare(b.material_name);
    });

  return scopedRows;
}

function parseDraftLines(input: unknown): Array<{ material_id: string; rate: number; dispatch_uom_code: string }> {
  if (!Array.isArray(input)) return [];
  const parsed: Array<{ material_id: string; rate: number; dispatch_uom_code: string }> = [];
  for (const row of input) {
    const line = (row ?? {}) as JsonRecord;
    const materialId = toTrimmedString(line.material_id);
    const rate = parseNonNegativeNumber(line.rate);
    const dispatchUomCode = normalizeUomCode(line.dispatch_uom_code);
    if (!materialId || rate === null || !dispatchUomCode) continue;
    parsed.push({ material_id: materialId, rate, dispatch_uom_code: dispatchUomCode });
  }
  return parsed;
}

export async function listMtsSkuRateHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    if (!companyId) {
      return rateError(req, ctx, "PROD_MTS_RATE_COMPANY_REQUIRED", 400, "company_id is required.");
    }
    const rateMonth = normalizeRateMonth(url.searchParams.get("rate_month"));
    if (url.searchParams.has("rate_month") && !rateMonth) {
      return rateError(req, ctx, "PROD_MTS_RATE_MONTH_INVALID", 400, "rate_month must be YYYY-MM or YYYY-MM-DD.");
    }

    const scopedRows = await getScopedMtsSkuRows(companyId);
    let rateMap = new Map<string, JsonRecord>();
    if (rateMonth && scopedRows.length > 0) {
      const { data, error } = await serviceRoleClient
        .schema("erp_production")
        .from("mts_sku_monthly_rate")
        .select("material_id, rate, status, dispatch_uom_code, rate_per_kg")
        .eq("company_id", companyId)
        .eq("rate_month", rateMonth)
        .in("material_id", scopedRows.map((row) => row.material_id));
      if (error) {
        console.error("[mts_sku_rate.listMtsSkuRateHandler] query failed:", JSON.stringify(error));
        throw new Error("PROD_MTS_RATE_LIST_FAILED");
      }
      rateMap = new Map(((data ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.material_id), row]));
    }

    return okResponse({
      data: scopedRows.map((row) => {
        const rateRow = rateMap.get(row.material_id);
        return {
          ...row,
          rate: rateRow ? Number(rateRow.rate ?? 0) : null,
          dispatch_uom_code: rateRow ? normalizeUomCode(rateRow.dispatch_uom_code) : null,
          rate_per_kg: rateRow ? Number(rateRow.rate_per_kg ?? 0) : null,
          status: rateRow ? toTrimmedString(rateRow.status) : null,
          has_rate: Boolean(rateRow),
        };
      }),
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROD_MTS_RATE_LIST_FAILED";
    return rateError(req, ctx, code, 500, "MTS SKU rate list failed.");
  }
}

export async function saveMtsSkuRateDraftHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    const rateMonth = normalizeRateMonth(body.rate_month);
    const lines = parseDraftLines(body.lines);
    if (!companyId || !rateMonth || lines.length === 0) {
      return rateError(req, ctx, "PROD_MTS_RATE_DRAFT_INVALID", 400, "company_id, rate_month, and at least one line are required.");
    }

    const scopedRows = await getScopedMtsSkuRows(companyId);
    const scopedMaterialIds = new Set(scopedRows.map((row) => row.material_id));
    const requestedMaterialIds = [...new Set(lines.map((line) => line.material_id))];
    if (requestedMaterialIds.some((id) => !scopedMaterialIds.has(id))) {
      return rateError(req, ctx, "PROD_MTS_RATE_SKU_SCOPE_INVALID", 422, "One or more selected SKUs are not MTS-scoped for this company.");
    }

    const { data: existingRows, error: existingError } = await serviceRoleClient
      .schema("erp_production")
      .from("mts_sku_monthly_rate")
      .select("id, material_id, status")
      .eq("company_id", companyId)
      .eq("rate_month", rateMonth)
      .in("material_id", requestedMaterialIds);
    if (existingError) {
      console.error("[mts_sku_rate.saveDraft.existing] query failed:", JSON.stringify(existingError));
      throw new Error("PROD_MTS_RATE_DRAFT_SAVE_FAILED");
    }

    const approvedHit = ((existingRows ?? []) as JsonRecord[]).find((row) => toTrimmedString(row.status) === "APPROVED");
    if (approvedHit) {
      return rateError(req, ctx, "PROD_MTS_RATE_MONTH_APPROVED", 409, "Approved monthly rates cannot be changed.");
    }

    const scopedByMaterial = new Map(scopedRows.map((row) => [row.material_id, row]));
    const approvalRequired = await loadMtsRateApprovalRequired();
    const savedAt = new Date().toISOString();
    const payload = lines.map((line) => {
      const scopedRow = scopedByMaterial.get(line.material_id);
      const options = scopedRow?.dispatch_uom_options ?? [];
      const ratePerKg = resolveRatePerKg(line.dispatch_uom_code, line.rate, options);
      if (ratePerKg === null) {
        throw new Error("PROD_MTS_RATE_DISPATCH_UOM_INVALID");
      }
      return {
      company_id: companyId,
      material_id: line.material_id,
      rate_month: rateMonth,
      rate: line.rate,
      dispatch_uom_code: line.dispatch_uom_code,
      rate_per_kg: ratePerKg,
      status: approvalRequired ? "DRAFT" : "APPROVED",
      created_by: ctx.auth_user_id,
      last_updated_by: ctx.auth_user_id,
      last_updated_at: savedAt,
      approved_by: approvalRequired ? null : ctx.auth_user_id,
      approved_at: approvalRequired ? null : savedAt,
    };
    });
    const { error: upsertError } = await serviceRoleClient
      .schema("erp_production")
      .from("mts_sku_monthly_rate")
      .upsert(payload, { onConflict: "company_id,material_id,rate_month" });
    if (upsertError) {
      console.error("[mts_sku_rate.saveDraft.upsert] query failed:", JSON.stringify(upsertError));
      throw new Error("PROD_MTS_RATE_DRAFT_SAVE_FAILED");
    }

    return okResponse({
      data: {
        company_id: companyId,
        rate_month: rateMonth,
        line_count: payload.length,
        status: approvalRequired ? "DRAFT" : "APPROVED",
      },
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROD_MTS_RATE_DRAFT_SAVE_FAILED";
    return rateError(req, ctx, code, 500, "MTS SKU rate draft save failed.");
  }
}

export async function listDraftMtsSkuRatesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    if (!companyId) {
      return rateError(req, ctx, "PROD_MTS_RATE_COMPANY_REQUIRED", 400, "company_id is required.");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_production")
      .from("mts_sku_monthly_rate")
      .select("rate_month, rate, rate_per_kg")
      .eq("company_id", companyId)
      .eq("status", "DRAFT")
      .order("rate_month", { ascending: false });
    if (error) {
      console.error("[mts_sku_rate.listDrafts] query failed:", JSON.stringify(error));
      throw new Error("PROD_MTS_RATE_DRAFT_LIST_FAILED");
    }

    const groups = new Map<string, { rate_month: string; line_count: number; filled_count: number }>();
    for (const row of ((data ?? []) as JsonRecord[])) {
      const rateMonth = toTrimmedString(row.rate_month);
      const entry = groups.get(rateMonth) ?? { rate_month: rateMonth, line_count: 0, filled_count: 0 };
      entry.line_count += 1;
      if (Number(row.rate ?? 0) > 0) entry.filled_count += 1;
      groups.set(rateMonth, entry);
    }

    return okResponse({ data: [...groups.values()] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROD_MTS_RATE_DRAFT_LIST_FAILED";
    return rateError(req, ctx, code, 500, "Pending MTS SKU drafts list failed.");
  }
}

export async function approveMtsSkuRateHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    const rateMonth = normalizeRateMonth(body.rate_month);
    if (!companyId || !rateMonth) {
      return rateError(req, ctx, "PROD_MTS_RATE_APPROVE_INVALID", 400, "company_id and rate_month are required.");
    }

    const scopedRows = await getScopedMtsSkuRows(companyId);
    if (scopedRows.length === 0) {
      return rateError(req, ctx, "PROD_MTS_RATE_SCOPE_EMPTY", 422, "No MTS-scoped SKUs exist for this company.");
    }
    const materialIds = scopedRows.map((row) => row.material_id);
    const { data: rateRows, error: rateErrorResult } = await serviceRoleClient
      .schema("erp_production")
      .from("mts_sku_monthly_rate")
      .select("material_id, rate, status, created_by")
      .eq("company_id", companyId)
      .eq("rate_month", rateMonth)
      .in("material_id", materialIds);
    if (rateErrorResult) {
      console.error("[mts_sku_rate.approve.list] query failed:", JSON.stringify(rateErrorResult));
      throw new Error("PROD_MTS_RATE_APPROVE_FAILED");
    }

    const rowMap = new Map(((rateRows ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.material_id), row]));
    const missingRows = scopedRows.filter((row) => !rowMap.has(row.material_id));
    if (missingRows.length > 0) {
      return rateError(req, ctx, "PROD_MTS_RATE_APPROVE_INCOMPLETE", 409, "All MTS SKUs must have a saved rate before approval.");
    }

    const incompleteRow = scopedRows.find((row) => {
      const rateRow = rowMap.get(row.material_id);
      return !rateRow || Number(rateRow.rate ?? 0) <= 0 || toTrimmedString(rateRow.status) !== "DRAFT";
    });
    if (incompleteRow) {
      return rateError(req, ctx, "PROD_MTS_RATE_APPROVE_INCOMPLETE", 409, "All MTS SKU rates must be greater than zero and still in Draft before approval.");
    }

    await assertMtsRateApproverRole(
      ctx,
      companyId,
      ((rateRows ?? []) as JsonRecord[]).map((row) => row.created_by as string | null | undefined),
    );

    const approvedAt = new Date().toISOString();
    const { error: updateError } = await serviceRoleClient
      .schema("erp_production")
      .from("mts_sku_monthly_rate")
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
    if (updateError) {
      console.error("[mts_sku_rate.approve.update] query failed:", JSON.stringify(updateError));
      throw new Error("PROD_MTS_RATE_APPROVE_FAILED");
    }

    return okResponse({ data: { company_id: companyId, rate_month: rateMonth, approved_count: materialIds.length } }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROD_MTS_RATE_APPROVE_FAILED";
    const status = code === "PROD_MTS_RATE_APPROVER_ROLE_REQUIRED" || code === "PROD_MTS_RATE_SELF_APPROVAL_FORBIDDEN"
      ? 403
      : 500;
    return rateError(req, ctx, code, status, "MTS SKU rate approval failed.");
  }
}

export async function listApprovedMonthsForSkuHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const materialId = toTrimmedString(url.searchParams.get("material_id"));
    if (!companyId || !materialId) {
      return rateError(req, ctx, "PROD_MTS_RATE_AVAILABLE_MONTHS_INVALID", 400, "company_id and material_id are required.");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_production")
      .from("mts_sku_monthly_rate")
      .select("rate_month, rate")
      .eq("company_id", companyId)
      .eq("material_id", materialId)
      .eq("status", "APPROVED")
      .order("rate_month", { ascending: false });
    if (error) {
      console.error("[mts_sku_rate.availableMonths] query failed:", JSON.stringify(error));
      throw new Error("PROD_MTS_RATE_AVAILABLE_MONTHS_FAILED");
    }

    return okResponse({
      data: ((data ?? []) as JsonRecord[]).map((row) => ({
        rate_month: toTrimmedString(row.rate_month),
        rate: Number(row.rate ?? 0),
        rate_per_kg: Number(row.rate_per_kg ?? 0),
      })),
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROD_MTS_RATE_AVAILABLE_MONTHS_FAILED";
    return rateError(req, ctx, code, 500, "Approved MTS months lookup failed.");
  }
}
