/*
 * File-Path: supabase/functions/api/_core/procurement/mts_customer_plan.handlers.ts
 * Domain: PROCUREMENT / MTS PLANNING
 * Purpose: MTS Customer Plan page (one Procurement page, three tabs).
 *   Tab 1 Plan Entry   — company × month × SKU Rolling / Final / Additional /
 *                        Urgent (FROM_PLAN re-phasing vs EXTRA demand), versioned.
 *   Tab 2 Stroke setup — planning-only stroke periods + RM-group Use Primary.
 *   Tab 3 Plan Report  — effective PLAN per SKU across selected year-months.
 *
 * Owner decisions: docs/mts-planning/DECISION-REGISTER.md (agent/chatgpt
 * 31dbfee, a718f34). Schema: migrations/20261014150000_erp_planning_mts_customer_plan.sql.
 *
 * ACL (no role checks in code — CLAUDE.md bug patterns #1/#12):
 *   PROC_MTS_CUSTOMER_PLAN           VIEW  = every read on this page
 *                                    WRITE = Additional / Urgent entries
 *   PROC_MTS_CUSTOMER_PLAN_MAINTAIN  WRITE = Rolling / Final entries + Tab 2
 *   PROC_MTS_PLAN_GROUP_MAINTAIN     WRITE = Product Group (Mother / Child
 *                                    group of Prodshades) layout
 *   Two resources because they are two different actions (pattern #6): the
 *   owner gives Stores / Logistics / Plant Head add-on entry only, while SCM,
 *   Director and ACL-MASTER also maintain the base plan.
 *   Every handler re-checks the TARGET company's grant (canMaintainCompanyResource),
 *   since the route gate only checks the session company (company-scope-write-acl-guard).
 *
 * Production / Dispatch actuals are NOT integrated (owner has not designed the
 * sources yet); the report says so explicitly instead of showing zeros.
 * Planning never writes to PO / CSN / GRN / stock / production / dispatch.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import {
  ADDON_PLAN_TYPES,
  BASE_PLAN_TYPES,
  buildEntryUomOptions,
  type EffectiveRow,
  type EntryUomOption,
  isPlanType,
  MAX_REPORT_MONTHS,
  normalizePlanLine,
  normalizePlanMonth,
  parseMonthList,
  pivotPlanReport,
  type PlanType,
  rpcErrorCode,
  toBaseQty,
  type UomConversionRow,
} from "./mts_customer_plan.logic.ts";

type JsonRecord = Record<string, unknown>;
type MtsPlanHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const RESOURCE_PAGE = "PROC_MTS_CUSTOMER_PLAN";
const RESOURCE_MAINTAIN = "PROC_MTS_CUSTOMER_PLAN_MAINTAIN";
const RESOURCE_GROUP = "PROC_MTS_PLAN_GROUP_MAINTAIN";
const MAX_LINES_PER_SAVE = 1000;

function textValue(value: unknown): string {
  return String(value ?? "").trim();
}
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}
function planError(req: Request, ctx: MtsPlanHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}
function materialLabel(row: JsonRecord | undefined): string {
  if (!row) return "—";
  // Owner 2026-10-15: no Pace Code on this page — material name only.
  return textValue(row.material_name) || "—";
}

// Named require*Access so company-scope-write-acl-guard.mjs recognises the
// target-company check inside each handler body.
async function requirePlanViewAccess(req: Request, ctx: MtsPlanHandlerContext, companyId: string): Promise<Response | null> {
  const allowed = await canMaintainCompanyResource(ctx, companyId, RESOURCE_PAGE, "VIEW");
  return allowed ? null : planError(req, ctx, "MTS_PLAN_FORBIDDEN", 403, "You do not have access to the MTS Customer Plan for this company.");
}
async function requirePlanAddonAccess(req: Request, ctx: MtsPlanHandlerContext, companyId: string): Promise<Response | null> {
  const allowed = await canMaintainCompanyResource(ctx, companyId, RESOURCE_PAGE, "WRITE");
  return allowed ? null : planError(req, ctx, "MTS_PLAN_FORBIDDEN", 403, "You cannot enter Additional / Urgent plans for this company.");
}
async function requirePlanMaintainAccess(req: Request, ctx: MtsPlanHandlerContext, companyId: string): Promise<Response | null> {
  const allowed = await canMaintainCompanyResource(ctx, companyId, RESOURCE_MAINTAIN, "WRITE");
  return allowed ? null : planError(req, ctx, "MTS_PLAN_FORBIDDEN", 403, "You cannot maintain the Rolling / Final plan or stroke setup for this company.");
}

async function requirePlanGroupAccess(req: Request, ctx: MtsPlanHandlerContext, companyId: string): Promise<Response | null> {
  const allowed = await canMaintainCompanyResource(ctx, companyId, RESOURCE_GROUP, "WRITE");
  return allowed ? null : planError(req, ctx, "MTS_PLAN_FORBIDDEN", 403, "You cannot maintain Product Groups for this company.");
}

/** company_id from query/body, membership-checked; returns "" if missing. */
async function resolveCompany(ctx: MtsPlanHandlerContext, raw: unknown): Promise<string> {
  const companyId = textValue(raw);
  if (!companyId) return "";
  await assertCompanyScope(ctx, companyId);
  return companyId;
}

type CompanySku = {
  sku_material_id: string;
  prodshade_material_id: string;
  pack_code: string;
};

async function loadCompanySkus(companyId: string): Promise<{ skus: CompanySku[]; ambiguous: CompanySku[] }> {
  const { data, error } = await serviceRoleClient.schema("erp_planning")
    .rpc("mts_company_skus", { p_company_id: companyId });
  if (error) throw new Error("MTS_PLAN_SKU_LOOKUP_FAILED");
  const skus: CompanySku[] = [];
  const ambiguous: CompanySku[] = [];
  const seen = new Set<string>();
  for (const row of (data ?? []) as JsonRecord[]) {
    const entry = {
      sku_material_id: textValue(row.sku_material_id),
      prodshade_material_id: textValue(row.prodshade_material_id),
      pack_code: textValue(row.pack_code),
    };
    if (Number(row.match_count) === 1) {
      if (!seen.has(entry.sku_material_id)) skus.push(entry);
      seen.add(entry.sku_material_id);
    } else {
      ambiguous.push(entry);
    }
  }
  return { skus, ambiguous };
}

async function loadMaterials(ids: string[]): Promise<Map<string, JsonRecord>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await fetchInChunks<JsonRecord>(unique, (chunk) => serviceRoleClient
    .schema("erp_master").from("material_master")
    .select("id, pace_code, material_name, external_code, document_name, base_uom_code, material_type")
    .in("id", chunk));
  return new Map(rows.map((row) => [textValue(row.id), row]));
}

type ProdshadeGroup = {
  mother_group_id: string | null;
  mother_group_name: string | null;
  child_group_id: string | null;
  child_group_name: string | null;
};
type GroupLayout = {
  mothers: JsonRecord[];
  children: JsonRecord[];
  byProdshade: Map<string, ProdshadeGroup>;
};
const NO_GROUP: ProdshadeGroup = { mother_group_id: null, mother_group_name: null, child_group_id: null, child_group_name: null };

async function loadGroupLayout(companyId: string): Promise<GroupLayout> {
  const [mothersRes, childrenRes, membersRes] = await Promise.all([
    serviceRoleClient.schema("erp_planning").from("prodshade_mother_group")
      .select("id, group_name").eq("company_id", companyId),
    serviceRoleClient.schema("erp_planning").from("prodshade_child_group")
      .select("id, group_name, mother_group_id").eq("company_id", companyId),
    serviceRoleClient.schema("erp_planning").from("prodshade_group_member")
      .select("prodshade_material_id, child_group_id").eq("company_id", companyId),
  ]);
  if (mothersRes.error || childrenRes.error || membersRes.error) throw new Error("MTS_PLAN_GROUP_LOOKUP_FAILED");
  const mothers = (mothersRes.data ?? []) as JsonRecord[];
  const children = (childrenRes.data ?? []) as JsonRecord[];
  const motherById = new Map(mothers.map((m) => [textValue(m.id), m]));
  const childById = new Map(children.map((c) => [textValue(c.id), c]));
  const byProdshade = new Map<string, ProdshadeGroup>();
  for (const member of (membersRes.data ?? []) as JsonRecord[]) {
    const child = childById.get(textValue(member.child_group_id));
    if (!child) continue;
    const mother = motherById.get(textValue(child.mother_group_id));
    byProdshade.set(textValue(member.prodshade_material_id), {
      mother_group_id: mother ? textValue(mother.id) : null,
      mother_group_name: mother ? textValue(mother.group_name) : null,
      child_group_id: textValue(child.id),
      child_group_name: textValue(child.group_name),
    });
  }
  return { mothers, children, byProdshade };
}

async function loadEntryUomOptions(materials: Map<string, JsonRecord>): Promise<Map<string, EntryUomOption[]>> {
  const ids = [...materials.keys()];
  const conversions = ids.length === 0 ? [] : await fetchInChunks<JsonRecord>(ids, (chunk) => serviceRoleClient
    .schema("erp_master").from("material_uom_conversion")
    .select("material_id, from_uom_code, to_uom_code, conversion_factor, variable_conversion, active")
    .in("material_id", chunk));
  const byMaterial = new Map<string, UomConversionRow[]>();
  for (const row of conversions) {
    const key = textValue(row.material_id);
    byMaterial.set(key, [...(byMaterial.get(key) ?? []), row as unknown as UomConversionRow]);
  }
  const result = new Map<string, EntryUomOption[]>();
  for (const [id, material] of materials) {
    result.set(id, buildEntryUomOptions(textValue(material.base_uom_code), byMaterial.get(id) ?? []));
  }
  return result;
}

async function loadEffective(companyId: string, months: string[]): Promise<EffectiveRow[]> {
  if (months.length === 0) return [];
  const { data, error } = await serviceRoleClient.schema("erp_planning")
    .rpc("customer_plan_effective", { p_company_id: companyId, p_months: months });
  if (error) throw new Error("MTS_PLAN_EFFECTIVE_FAILED");
  return ((data ?? []) as JsonRecord[]).map((row) => ({
    plan_month: textValue(row.plan_month).slice(0, 10),
    sku_material_id: textValue(row.sku_material_id),
    effective_qty: numberOrNull(row.effective_qty),
    base_source: textValue(row.base_source) || null,
    has_legacy_source: row.has_legacy_source === true,
    rolling_qty: numberOrNull(row.rolling_qty),
    final_qty: numberOrNull(row.final_qty),
    additional_qty: numberOrNull(row.additional_qty),
    urgent_extra_qty: numberOrNull(row.urgent_extra_qty),
    urgent_from_plan_qty: numberOrNull(row.urgent_from_plan_qty),
  } as EffectiveRow & JsonRecord));
}

// ── GET /api/procurement/mts-plan/access ────────────────────────────────────
// UI hint only (which plan types / buttons to enable). Every write handler
// enforces the same decision server-side.
export async function getMtsPlanAccessHandler(req: Request, ctx: MtsPlanHandlerContext): Promise<Response> {
  try {
    const companyId = await resolveCompany(ctx, new URL(req.url).searchParams.get("company_id"));
    if (!companyId) return planError(req, ctx, "MTS_PLAN_COMPANY_REQUIRED", 400, "company_id is required.");
    const viewDenied = await requirePlanViewAccess(req, ctx, companyId);
    if (viewDenied) return viewDenied;
    const [canAddon, canMaintain, canManageGroups] = await Promise.all([
      canMaintainCompanyResource(ctx, companyId, RESOURCE_PAGE, "WRITE"),
      canMaintainCompanyResource(ctx, companyId, RESOURCE_MAINTAIN, "WRITE"),
      canMaintainCompanyResource(ctx, companyId, RESOURCE_GROUP, "WRITE"),
    ]);
    const allowedPlanTypes: PlanType[] = [
      ...(canMaintain ? BASE_PLAN_TYPES : []),
      ...(canAddon || canMaintain ? ADDON_PLAN_TYPES : []),
    ];
    return okResponse({
      company_id: companyId,
      can_view: true,
      can_enter_addon: canAddon || canMaintain,
      can_maintain: canMaintain,
      can_manage_groups: canManageGroups,
      allowed_plan_types: allowedPlanTypes,
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTS_PLAN_ACCESS_FAILED";
    if (code === "COMPANY_SCOPE_VIOLATION") return planError(req, ctx, code, 403, "Company is outside your scope.");
    return planError(req, ctx, "MTS_PLAN_ACCESS_FAILED", 500, "Could not resolve MTS plan access.");
  }
}

// ── GET /api/procurement/mts-plan/entry-grid ────────────────────────────────
export async function getMtsPlanEntryGridHandler(req: Request, ctx: MtsPlanHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await resolveCompany(ctx, url.searchParams.get("company_id"));
    if (!companyId) return planError(req, ctx, "MTS_PLAN_COMPANY_REQUIRED", 400, "company_id is required.");
    const accessError = await requirePlanViewAccess(req, ctx, companyId);
    if (accessError) return accessError;
    const planMonth = normalizePlanMonth(url.searchParams.get("plan_month"));
    if (!planMonth) return planError(req, ctx, "MTS_PLAN_INVALID_MONTH", 400, "plan_month must be YYYY-MM.");
    const planType = textValue(url.searchParams.get("plan_type")).toUpperCase();
    if (!isPlanType(planType)) return planError(req, ctx, "MTS_PLAN_INVALID_TYPE", 400, "plan_type is invalid.");

    const { skus, ambiguous } = await loadCompanySkus(companyId);
    const [linesResult, effectiveRows, groups] = await Promise.all([
      serviceRoleClient.schema("erp_planning").from("customer_plan_line")
        .select("id, entry_id, version_no, sku_material_id, entered_qty, entered_uom_code, base_qty, base_uom_code, urgent_mode, urgent_from_date, urgent_to_date, remarks, source_system, created_by, created_at")
        .eq("company_id", companyId).eq("plan_month", planMonth).eq("plan_type", planType)
        .eq("is_current", true).eq("is_cancelled", false)
        .order("created_at", { ascending: true }),
      loadEffective(companyId, [planMonth]),
      loadGroupLayout(companyId),
    ]);
    if (linesResult.error) throw new Error("MTS_PLAN_LINES_FAILED");
    const lines = (linesResult.data ?? []) as JsonRecord[];

    // A SKU that has plan rows but no longer resolves (e.g. renamed) still
    // shows, so nothing entered is hidden.
    const skuIds = [...new Set([...skus.map((s) => s.sku_material_id), ...lines.map((l) => textValue(l.sku_material_id))])];
    const prodshadeIds = [...skus, ...ambiguous].map((s) => s.prodshade_material_id);
    const [materials, userNames] = await Promise.all([
      loadMaterials([...skuIds, ...prodshadeIds, ...ambiguous.map((a) => a.sku_material_id)]),
      resolveUserDisplayNames(lines.map((l) => textValue(l.created_by))),
    ]);
    const skuMaterials = new Map(skuIds.map((id) => [id, materials.get(id) ?? {}] as [string, JsonRecord]));
    const uomOptions = await loadEntryUomOptions(skuMaterials);
    const skuMeta = new Map(skus.map((s) => [s.sku_material_id, s]));
    const effectiveBySku = new Map(effectiveRows.map((row) => [row.sku_material_id, row as EffectiveRow & JsonRecord]));

    const linesBySku = new Map<string, JsonRecord[]>();
    for (const line of lines) {
      const key = textValue(line.sku_material_id);
      linesBySku.set(key, [...(linesBySku.get(key) ?? []), {
        entry_id: line.entry_id,
        version_no: line.version_no,
        entered_qty: numberOrNull(line.entered_qty),
        entered_uom_code: line.entered_uom_code,
        base_qty: numberOrNull(line.base_qty),
        base_uom_code: line.base_uom_code,
        urgent_mode: line.urgent_mode ?? null,
        urgent_from_date: line.urgent_from_date ?? null,
        urgent_to_date: line.urgent_to_date ?? null,
        remarks: line.remarks ?? null,
        source_system: line.source_system,
        entered_by: userNames.get(textValue(line.created_by)) ?? "—",
        entered_at: line.created_at,
      }]);
    }

    const rows = skuIds.map((skuId) => {
      const material = materials.get(skuId);
      const meta = skuMeta.get(skuId);
      const effective = effectiveBySku.get(skuId);
      return {
        sku_material_id: skuId,
        sku_label: materialLabel(material),
        sku_external_code: textValue(material?.external_code) || null,
        sku_document_name: textValue(material?.document_name) || null,
        base_uom_code: textValue(material?.base_uom_code) || null,
        prodshade_material_id: meta?.prodshade_material_id ?? null,
        prodshade_label: meta ? materialLabel(materials.get(meta.prodshade_material_id)) : "—",
        ...(meta ? groups.byProdshade.get(meta.prodshade_material_id) ?? NO_GROUP : NO_GROUP),
        pack_code: meta?.pack_code ?? null,
        is_current_mts_sku: Boolean(meta),
        entry_uom_options: uomOptions.get(skuId) ?? [],
        entries: linesBySku.get(skuId) ?? [],
        effective: effective ? {
          rolling_qty: effective.rolling_qty,
          final_qty: effective.final_qty,
          additional_qty: effective.additional_qty,
          urgent_extra_qty: effective.urgent_extra_qty,
          urgent_from_plan_qty: effective.urgent_from_plan_qty,
          base_source: effective.base_source,
          effective_qty: effective.effective_qty,
        } : null,
      };
    }).sort((a, b) => a.sku_label.localeCompare(b.sku_label));

    return okResponse({
      company_id: companyId,
      plan_month: planMonth,
      plan_type: planType,
      rows,
      ambiguous_skus: ambiguous.map((a) => ({
        prodshade_label: materialLabel(materials.get(a.prodshade_material_id)),
        pack_code: a.pack_code,
        sku_label: materialLabel(materials.get(a.sku_material_id)),
      })),
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTS_PLAN_GRID_FAILED";
    if (code === "COMPANY_SCOPE_VIOLATION") return planError(req, ctx, code, 403, "Company is outside your scope.");
    return planError(req, ctx, "MTS_PLAN_GRID_FAILED", 500, "Could not load the plan grid.");
  }
}

// ── GET /api/procurement/mts-plan/history ───────────────────────────────────
export async function getMtsPlanHistoryHandler(req: Request, ctx: MtsPlanHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await resolveCompany(ctx, url.searchParams.get("company_id"));
    if (!companyId) return planError(req, ctx, "MTS_PLAN_COMPANY_REQUIRED", 400, "company_id is required.");
    const accessError = await requirePlanViewAccess(req, ctx, companyId);
    if (accessError) return accessError;
    const planMonth = normalizePlanMonth(url.searchParams.get("plan_month"));
    const skuId = textValue(url.searchParams.get("sku_material_id"));
    if (!planMonth || !skuId) return planError(req, ctx, "MTS_PLAN_INVALID_INPUT", 400, "plan_month and sku_material_id are required.");

    const { data, error } = await serviceRoleClient.schema("erp_planning").from("customer_plan_line")
      .select("id, entry_id, version_no, is_current, plan_type, urgent_mode, urgent_from_date, urgent_to_date, entered_qty, entered_uom_code, base_qty, base_uom_code, is_cancelled, remarks, source_system, created_by, created_at")
      .eq("company_id", companyId).eq("plan_month", planMonth).eq("sku_material_id", skuId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error("MTS_PLAN_HISTORY_FAILED");
    const rows = (data ?? []) as JsonRecord[];
    const userNames = await resolveUserDisplayNames(rows.map((r) => textValue(r.created_by)));
    return okResponse({
      rows: rows.map((r) => ({
        id: r.id,
        entry_id: r.entry_id,
        version_no: r.version_no,
        is_current: r.is_current,
        plan_type: r.plan_type,
        urgent_mode: r.urgent_mode ?? null,
        urgent_from_date: r.urgent_from_date ?? null,
        urgent_to_date: r.urgent_to_date ?? null,
        entered_qty: numberOrNull(r.entered_qty),
        entered_uom_code: r.entered_uom_code,
        base_qty: numberOrNull(r.base_qty),
        base_uom_code: r.base_uom_code,
        is_cancelled: r.is_cancelled,
        remarks: r.remarks ?? null,
        source_system: r.source_system,
        entered_by: userNames.get(textValue(r.created_by)) ?? "—",
        entered_at: r.created_at,
      })),
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTS_PLAN_HISTORY_FAILED";
    if (code === "COMPANY_SCOPE_VIOLATION") return planError(req, ctx, code, 403, "Company is outside your scope.");
    return planError(req, ctx, "MTS_PLAN_HISTORY_FAILED", 500, "Could not load plan history.");
  }
}

// Shared by both save routes. `allowedTypes` decides which route may save
// which plan types; each route's own access check runs before this.
async function saveMtsPlanLines(
  req: Request,
  ctx: MtsPlanHandlerContext,
  body: JsonRecord,
  companyId: string,
  allowedTypes: PlanType[],
): Promise<Response> {
  const planMonth = normalizePlanMonth(body.plan_month);
  if (!planMonth) return planError(req, ctx, "MTS_PLAN_INVALID_MONTH", 400, "plan_month must be YYYY-MM.");
  const planType = textValue(body.plan_type).toUpperCase();
  if (!isPlanType(planType) || !allowedTypes.includes(planType)) {
    return planError(req, ctx, "MTS_PLAN_INVALID_TYPE", 400, `This action can only save ${allowedTypes.join(" / ")} plans.`);
  }
  const entryUom = textValue(body.entry_uom_code).toUpperCase();
  const rawLines = Array.isArray(body.lines) ? body.lines as JsonRecord[] : [];
  if (rawLines.length === 0) return planError(req, ctx, "MTS_PLAN_NO_LINES", 400, "Nothing to save.");
  if (rawLines.length > MAX_LINES_PER_SAVE) return planError(req, ctx, "MTS_PLAN_TOO_MANY_LINES", 400, `At most ${MAX_LINES_PER_SAVE} lines per save.`);

  const normalized = [];
  for (const raw of rawLines) {
    const { line, error } = normalizePlanLine(planType, raw);
    if (error || !line) return planError(req, ctx, error ?? "MTS_PLAN_INVALID_INPUT", 400, `Invalid line: ${error}`);
    normalized.push(line);
  }

  const materials = await loadMaterials(normalized.map((l) => l.sku_material_id));
  const uomOptions = await loadEntryUomOptions(materials);
  const payload = [];
  for (const line of normalized) {
    const material = materials.get(line.sku_material_id);
    if (!material) return planError(req, ctx, "MTS_PLAN_SKU_NOT_FOUND", 400, "A SKU on this save does not exist.");
    if (line.cancel) {
      payload.push({ entry_id: line.entry_id, sku_material_id: line.sku_material_id, cancel: true });
      continue;
    }
    if (!entryUom) return planError(req, ctx, "MTS_PLAN_UOM_REQUIRED", 400, "entry_uom_code is required.");
    const baseQty = toBaseQty(line.entered_qty ?? -1, entryUom, uomOptions.get(line.sku_material_id) ?? []);
    if (baseQty === null) {
      return planError(req, ctx, "MTS_PLAN_UOM_NOT_AVAILABLE", 400,
        `${materialLabel(material)} cannot be entered in ${entryUom}: no verified conversion to its base unit.`);
    }
    payload.push({
      entry_id: line.entry_id,
      sku_material_id: line.sku_material_id,
      entered_qty: line.entered_qty,
      entered_uom_code: entryUom,
      base_qty: baseQty,
      base_uom_code: textValue(material.base_uom_code),
      urgent_mode: line.urgent_mode,
      urgent_from_date: line.urgent_from_date,
      urgent_to_date: line.urgent_to_date,
      remarks: line.remarks,
    });
  }

  const { data, error } = await serviceRoleClient.schema("erp_planning").rpc("save_customer_plan_lines", {
    p_company_id: companyId,
    p_plan_month: planMonth,
    p_plan_type: planType,
    p_actor: ctx.auth_user_id,
    p_lines: payload,
  });
  if (error) {
    const code = rpcErrorCode(error.message);
    if (code) return planError(req, ctx, code, 400, String(error.message).replace(/^.*?(MTS_PLAN_[A-Z_]+|PLANNING_APPEND_ONLY):\s*/, ""));
    throw new Error("MTS_PLAN_SAVE_FAILED");
  }
  return okResponse({ result: data, plan_month: planMonth, plan_type: planType }, ctx.request_id, req);
}

// ── POST /api/procurement/mts-plan/base-lines  (Rolling / Final) ────────────
export async function saveMtsPlanBaseLinesHandler(req: Request, ctx: MtsPlanHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await resolveCompany(ctx, body.company_id);
    if (!companyId) return planError(req, ctx, "MTS_PLAN_COMPANY_REQUIRED", 400, "company_id is required.");
    const accessError = await requirePlanMaintainAccess(req, ctx, companyId);
    if (accessError) return accessError;
    return await saveMtsPlanLines(req, ctx, body, companyId, BASE_PLAN_TYPES);
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTS_PLAN_SAVE_FAILED";
    if (code === "COMPANY_SCOPE_VIOLATION") return planError(req, ctx, code, 403, "Company is outside your scope.");
    return planError(req, ctx, "MTS_PLAN_SAVE_FAILED", 500, "Could not save the plan.");
  }
}

// ── POST /api/procurement/mts-plan/addon-lines  (Additional / Urgent) ───────
export async function saveMtsPlanAddonLinesHandler(req: Request, ctx: MtsPlanHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await resolveCompany(ctx, body.company_id);
    if (!companyId) return planError(req, ctx, "MTS_PLAN_COMPANY_REQUIRED", 400, "company_id is required.");
    const accessError = await requirePlanAddonAccess(req, ctx, companyId);
    if (accessError) return accessError;
    return await saveMtsPlanLines(req, ctx, body, companyId, ADDON_PLAN_TYPES);
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTS_PLAN_SAVE_FAILED";
    if (code === "COMPANY_SCOPE_VIOLATION") return planError(req, ctx, code, 403, "Company is outside your scope.");
    return planError(req, ctx, "MTS_PLAN_SAVE_FAILED", 500, "Could not save the plan.");
  }
}

// ── GET /api/procurement/mts-plan/stroke-settings ───────────────────────────
export async function getMtsPlanStrokeSettingsHandler(req: Request, ctx: MtsPlanHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await resolveCompany(ctx, url.searchParams.get("company_id"));
    if (!companyId) return planError(req, ctx, "MTS_PLAN_COMPANY_REQUIRED", 400, "company_id is required.");
    const accessError = await requirePlanViewAccess(req, ctx, companyId);
    if (accessError) return accessError;
    const planMonth = normalizePlanMonth(url.searchParams.get("plan_month"));
    if (!planMonth) return planError(req, ctx, "MTS_PLAN_INVALID_MONTH", 400, "plan_month must be YYYY-MM.");

    const { skus } = await loadCompanySkus(companyId);
    const prodshadeIds = [...new Set(skus.map((s) => s.prodshade_material_id))];
    if (prodshadeIds.length === 0) return okResponse({ plan_month: planMonth, prodshades: [] }, ctx.request_id, req);

    const [strokeRows, currentRows, settingRows, decisionRows, productGroups] = await Promise.all([
      fetchInChunks<JsonRecord>(prodshadeIds, (chunk) => serviceRoleClient.schema("erp_production").from("stroke_master")
        .select("id, prodshade_material_id, stroke_number, revision_no, description")
        .eq("company_id", companyId).eq("po_type", "MTS").eq("status", "APPROVED")
        .in("prodshade_material_id", chunk)),
      fetchInChunks<JsonRecord>(prodshadeIds, (chunk) => serviceRoleClient.schema("erp_production").from("mts_current_stroke")
        .select("prodshade_material_id, stroke_number")
        .eq("company_id", companyId).in("prodshade_material_id", chunk)),
      fetchInChunks<JsonRecord>(prodshadeIds, (chunk) => serviceRoleClient.schema("erp_planning").from("stroke_plan_setting")
        .select("id, prodshade_material_id, version_no, remarks, created_by, created_at")
        .eq("company_id", companyId).eq("plan_month", planMonth).eq("is_current", true)
        .in("prodshade_material_id", chunk)),
      // Use Primary carries forward (owner 2026-10-15): every current decision
      // effective on or before this month; the latest one per key wins below.
      fetchInChunks<JsonRecord>(prodshadeIds, (chunk) => serviceRoleClient.schema("erp_planning").from("stroke_group_primary_decision")
        .select("stroke_master_id, material_group_id, effective_month, use_primary")
        .eq("company_id", companyId).eq("is_current", true).lte("effective_month", planMonth)
        .in("prodshade_material_id", chunk)),
      loadGroupLayout(companyId),
    ]);

    const strokeIds = strokeRows.map((s) => textValue(s.id));
    const settingIds = settingRows.map((s) => textValue(s.id));
    const [strokeLines, periodRows] = await Promise.all([
      strokeIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(strokeIds, (chunk) => serviceRoleClient
        .schema("erp_production").from("stroke_line")
        .select("stroke_master_id, material_id, material_group_id, display_order")
        .in("stroke_master_id", chunk).not("material_group_id", "is", null)),
      settingIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(settingIds, (chunk) => serviceRoleClient
        .schema("erp_planning").from("stroke_plan_period")
        .select("setting_id, stroke_master_id, period_from, period_to, planned_base_qty, display_order")
        .in("setting_id", chunk)),
    ]);
    const decisionByKey = new Map<string, { use_primary: boolean; effective_month: string }>();
    for (const d of decisionRows) {
      const key = `${textValue(d.stroke_master_id)}|${textValue(d.material_group_id)}`;
      const month = textValue(d.effective_month);
      const seen = decisionByKey.get(key);
      if (!seen || month > seen.effective_month) decisionByKey.set(key, { use_primary: d.use_primary === true, effective_month: month });
    }

    const groupIds = [...new Set(strokeLines.map((l) => textValue(l.material_group_id)))];
    const [groups, members] = await Promise.all([
      groupIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(groupIds, (chunk) => serviceRoleClient
        .schema("erp_master").from("material_category_group").select("id, group_code, group_name").in("id", chunk)),
      groupIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(groupIds, (chunk) => serviceRoleClient
        .schema("erp_master").from("material_category_group_member").select("group_id, material_id, active").in("group_id", chunk)),
    ]);
    const materials = await loadMaterials([
      ...prodshadeIds,
      ...strokeLines.map((l) => textValue(l.material_id)),
      ...members.map((m) => textValue(m.material_id)),
    ]);
    const userNames = await resolveUserDisplayNames(settingRows.map((s) => textValue(s.created_by)));

    const groupById = new Map(groups.map((g) => [textValue(g.id), g]));
    const membersByGroup = new Map<string, string[]>();
    for (const m of members) {
      if (m.active === false) continue;
      const key = textValue(m.group_id);
      membersByGroup.set(key, [...(membersByGroup.get(key) ?? []), textValue(m.material_id)]);
    }
    const settingByProdshade = new Map(settingRows.map((s) => [textValue(s.prodshade_material_id), s]));
    const currentByProdshade = new Map(currentRows.map((c) => [textValue(c.prodshade_material_id), textValue(c.stroke_number)]));

    const prodshades = prodshadeIds.map((pid) => {
      const strokes = strokeRows.filter((s) => textValue(s.prodshade_material_id) === pid)
        .sort((a, b) => textValue(a.stroke_number).localeCompare(textValue(b.stroke_number)));
      const currentNumber = currentByProdshade.get(pid) ?? "";
      const currentStroke = strokes.find((s) => textValue(s.stroke_number) === currentNumber) ?? null;
      const setting = settingByProdshade.get(pid);
      const settingId = setting ? textValue(setting.id) : "";
      const periods = setting
        ? periodRows.filter((p) => textValue(p.setting_id) === settingId)
          .sort((a, b) => Number(a.display_order) - Number(b.display_order))
          .map((p) => ({
            stroke_master_id: p.stroke_master_id,
            period_from: p.period_from,
            period_to: p.period_to,
            planned_base_qty: numberOrNull(p.planned_base_qty),
          }))
        : null;

      return {
        prodshade_material_id: pid,
        prodshade_label: materialLabel(materials.get(pid)),
        prodshade_document_name: textValue(materials.get(pid)?.document_name) || null,
        ...(productGroups.byProdshade.get(pid) ?? NO_GROUP),
        current_stroke_master_id: currentStroke ? currentStroke.id : null,
        current_stroke_number: currentNumber || null,
        strokes: strokes.map((s) => {
          const sid = textValue(s.id);
          const rmGroups = strokeLines.filter((l) => textValue(l.stroke_master_id) === sid)
            .sort((a, b) => Number(a.display_order) - Number(b.display_order))
            .map((l) => {
              const gid = textValue(l.material_group_id);
              const group = groupById.get(gid);
              const key = `${sid}|${gid}`;
              return {
                material_group_id: gid,
                group_label: group ? [textValue(group.group_code), textValue(group.group_name)].filter(Boolean).join(" — ") : "—",
                primary_material_label: materialLabel(materials.get(textValue(l.material_id))),
                member_labels: (membersByGroup.get(gid) ?? [])
                  .filter((id) => id !== textValue(l.material_id))
                  .map((id) => materialLabel(materials.get(id))),
                // No decision on or before this month = default Yes.
                use_primary: decisionByKey.get(key)?.use_primary ?? true,
                primary_set_month: decisionByKey.get(key)?.effective_month ?? null,
              };
            });
          return {
            stroke_master_id: sid,
            stroke_number: s.stroke_number,
            revision_no: s.revision_no ?? null,
            description: s.description ?? null,
            rm_groups: rmGroups,
          };
        }),
        setting: setting ? {
          version_no: setting.version_no,
          remarks: setting.remarks ?? null,
          saved_by: userNames.get(textValue(setting.created_by)) ?? "—",
          saved_at: setting.created_at,
          periods,
        } : null,
      };
    }).sort((a, b) => a.prodshade_label.localeCompare(b.prodshade_label));

    return okResponse({ plan_month: planMonth, prodshades }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTS_PLAN_STROKE_FAILED";
    if (code === "COMPANY_SCOPE_VIOLATION") return planError(req, ctx, code, 403, "Company is outside your scope.");
    return planError(req, ctx, "MTS_PLAN_STROKE_FAILED", 500, "Could not load stroke settings.");
  }
}

// ── POST /api/procurement/mts-plan/stroke-settings ──────────────────────────
export async function saveMtsPlanStrokeSettingHandler(req: Request, ctx: MtsPlanHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await resolveCompany(ctx, body.company_id);
    if (!companyId) return planError(req, ctx, "MTS_PLAN_COMPANY_REQUIRED", 400, "company_id is required.");
    const accessError = await requirePlanMaintainAccess(req, ctx, companyId);
    if (accessError) return accessError;
    const planMonth = normalizePlanMonth(body.plan_month);
    if (!planMonth) return planError(req, ctx, "MTS_PLAN_INVALID_MONTH", 400, "plan_month must be YYYY-MM.");
    const prodshadeId = textValue(body.prodshade_material_id);
    if (!prodshadeId) return planError(req, ctx, "MTS_PLAN_INVALID_INPUT", 400, "prodshade_material_id is required.");
    const periods = Array.isArray(body.periods) ? body.periods as JsonRecord[] : [];
    const primaries = Array.isArray(body.primaries) ? body.primaries as JsonRecord[] : [];

    const { data, error } = await serviceRoleClient.schema("erp_planning").rpc("save_stroke_plan_setting", {
      p_company_id: companyId,
      p_plan_month: planMonth,
      p_prodshade_material_id: prodshadeId,
      p_actor: ctx.auth_user_id,
      p_periods: periods.map((p) => ({
        stroke_master_id: textValue(p.stroke_master_id),
        period_from: textValue(p.period_from),
        period_to: textValue(p.period_to),
        planned_base_qty: numberOrNull(p.planned_base_qty),
      })),
      p_primaries: primaries.map((p) => ({
        stroke_master_id: textValue(p.stroke_master_id),
        material_group_id: textValue(p.material_group_id),
        use_primary: p.use_primary === true,
      })),
      p_remarks: textValue(body.remarks) || null,
    });
    if (error) {
      const code = rpcErrorCode(error.message);
      if (code) return planError(req, ctx, code, 400, String(error.message).replace(/^.*?(MTS_PLAN_[A-Z_]+|PLANNING_APPEND_ONLY):\s*/, ""));
      throw new Error("MTS_PLAN_STROKE_SAVE_FAILED");
    }
    return okResponse({ result: data, plan_month: planMonth }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTS_PLAN_STROKE_SAVE_FAILED";
    if (code === "COMPANY_SCOPE_VIOLATION") return planError(req, ctx, code, 403, "Company is outside your scope.");
    return planError(req, ctx, "MTS_PLAN_STROKE_SAVE_FAILED", 500, "Could not save stroke settings.");
  }
}

// ── GET /api/procurement/mts-plan/product-groups ────────────────────────────
// Every MTS Prodshade of the company with its Document Name and current group.
export async function getMtsPlanProductGroupsHandler(req: Request, ctx: MtsPlanHandlerContext): Promise<Response> {
  try {
    const companyId = await resolveCompany(ctx, new URL(req.url).searchParams.get("company_id"));
    if (!companyId) return planError(req, ctx, "MTS_PLAN_COMPANY_REQUIRED", 400, "company_id is required.");
    const accessError = await requirePlanViewAccess(req, ctx, companyId);
    if (accessError) return accessError;
    const [{ skus, ambiguous }, groups, canManage] = await Promise.all([
      loadCompanySkus(companyId),
      loadGroupLayout(companyId),
      canMaintainCompanyResource(ctx, companyId, RESOURCE_GROUP, "WRITE"),
    ]);
    const prodshadeIds = [...new Set([...skus, ...ambiguous].map((s) => s.prodshade_material_id).concat([...groups.byProdshade.keys()]))];
    const materials = await loadMaterials(prodshadeIds);
    const prodshades = prodshadeIds.map((pid) => ({
      prodshade_material_id: pid,
      prodshade_label: materialLabel(materials.get(pid)),
      prodshade_document_name: textValue(materials.get(pid)?.document_name) || null,
      ...(groups.byProdshade.get(pid) ?? NO_GROUP),
    })).sort((a, b) => a.prodshade_label.localeCompare(b.prodshade_label, undefined, { numeric: true }));
    return okResponse({
      company_id: companyId,
      can_manage: canManage,
      mother_groups: groups.mothers.map((m) => ({ id: m.id, name: m.group_name })),
      child_groups: groups.children.map((c) => ({ id: c.id, name: c.group_name, mother_group_id: c.mother_group_id })),
      prodshades,
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTS_PLAN_GROUP_FAILED";
    if (code === "COMPANY_SCOPE_VIOLATION") return planError(req, ctx, code, 403, "Company is outside your scope.");
    return planError(req, ctx, "MTS_PLAN_GROUP_FAILED", 500, "Could not load Product Groups.");
  }
}

// ── POST /api/procurement/mts-plan/product-groups ───────────────────────────
// Saves the whole Mother / Child / member layout of one company atomically.
export async function saveMtsPlanProductGroupsHandler(req: Request, ctx: MtsPlanHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await resolveCompany(ctx, body.company_id);
    if (!companyId) return planError(req, ctx, "MTS_PLAN_COMPANY_REQUIRED", 400, "company_id is required.");
    const accessError = await requirePlanGroupAccess(req, ctx, companyId);
    if (accessError) return accessError;
    const list = (value: unknown) => (Array.isArray(value) ? value as JsonRecord[] : []);
    const layout = {
      mothers: list(body.mother_groups).map((m) => ({ key: textValue(m.key), id: textValue(m.id) || null, name: textValue(m.name) })),
      children: list(body.child_groups).map((c) => ({
        key: textValue(c.key), id: textValue(c.id) || null, name: textValue(c.name), mother_key: textValue(c.mother_key),
      })),
      members: list(body.members).map((m) => ({ prodshade_material_id: textValue(m.prodshade_material_id), child_key: textValue(m.child_key) })),
    };
    if (layout.members.length > 5000 || layout.children.length > 1000 || layout.mothers.length > 500) {
      return planError(req, ctx, "MTS_PLAN_GROUP_TOO_LARGE", 400, "Too many groups or members in one save.");
    }
    const { data, error } = await serviceRoleClient.schema("erp_planning").rpc("save_prodshade_groups", {
      p_company_id: companyId,
      p_actor: ctx.auth_user_id,
      p_layout: layout,
    });
    if (error) {
      const code = rpcErrorCode(error.message);
      if (code) return planError(req, ctx, code, 400, String(error.message).replace(/^.*?(MTS_PLAN_[A-Z_]+):\s*/, ""));
      throw new Error("MTS_PLAN_GROUP_SAVE_FAILED");
    }
    return okResponse({ result: data }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTS_PLAN_GROUP_SAVE_FAILED";
    if (code === "COMPANY_SCOPE_VIOLATION") return planError(req, ctx, code, 403, "Company is outside your scope.");
    return planError(req, ctx, "MTS_PLAN_GROUP_SAVE_FAILED", 500, "Could not save Product Groups.");
  }
}

// ── GET /api/procurement/mts-plan/report ────────────────────────────────────
export async function getMtsPlanReportHandler(req: Request, ctx: MtsPlanHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await resolveCompany(ctx, url.searchParams.get("company_id"));
    if (!companyId) return planError(req, ctx, "MTS_PLAN_COMPANY_REQUIRED", 400, "company_id is required.");
    const accessError = await requirePlanViewAccess(req, ctx, companyId);
    if (accessError) return accessError;
    const { months, invalid } = parseMonthList(url.searchParams.get("months"));
    if (invalid.length > 0) return planError(req, ctx, "MTS_PLAN_INVALID_MONTH", 400, `Invalid month(s): ${invalid.join(", ")}`);
    if (months.length === 0) return planError(req, ctx, "MTS_PLAN_MONTHS_REQUIRED", 400, "Select at least one month.");
    if (months.length > MAX_REPORT_MONTHS) return planError(req, ctx, "MTS_PLAN_TOO_MANY_MONTHS", 400, `Select at most ${MAX_REPORT_MONTHS} months.`);

    const [{ skus }, effectiveRows, groups] = await Promise.all([
      loadCompanySkus(companyId), loadEffective(companyId, months), loadGroupLayout(companyId),
    ]);
    const skuIds = [...new Set([...skus.map((s) => s.sku_material_id), ...effectiveRows.map((r) => r.sku_material_id)])];
    const skuMeta = new Map(skus.map((s) => [s.sku_material_id, s]));
    const materials = await loadMaterials([...skuIds, ...skus.map((s) => s.prodshade_material_id)]);
    const pivot = pivotPlanReport(skuIds, months, effectiveRows);

    const rows = skuIds.map((skuId) => {
      const material = materials.get(skuId);
      const meta = skuMeta.get(skuId);
      return {
        sku_material_id: skuId,
        sku_label: materialLabel(material),
        sku_external_code: textValue(material?.external_code) || null,
        sku_document_name: textValue(material?.document_name) || null,
        base_uom_code: textValue(material?.base_uom_code) || null,
        prodshade_material_id: meta?.prodshade_material_id ?? null,
        prodshade_label: meta ? materialLabel(materials.get(meta.prodshade_material_id)) : "—",
        ...(meta ? groups.byProdshade.get(meta.prodshade_material_id) ?? NO_GROUP : NO_GROUP),
        pack_code: meta?.pack_code ?? null,
        is_current_mts_sku: Boolean(meta),
        plan: pivot.get(skuId) ?? {},
      };
    }).sort((a, b) => a.sku_label.localeCompare(b.sku_label));

    return okResponse({
      company_id: companyId,
      months,
      rows,
      // Owner has not designed Production / Dispatch sources yet — say so
      // instead of showing invented zeros.
      production: { available: false, reason: "Production source not yet designed by owner." },
      dispatch: { available: false, reason: "Dispatch source not yet designed by owner." },
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTS_PLAN_REPORT_FAILED";
    if (code === "COMPANY_SCOPE_VIOLATION") return planError(req, ctx, code, 403, "Company is outside your scope.");
    return planError(req, ctx, "MTS_PLAN_REPORT_FAILED", 500, "Could not load the plan report.");
  }
}
