/*
 * File-Path: supabase/functions/api/_core/production/process_po_exclusion.handlers.ts
 * Domain: PRODUCTION / SA Operation Masters (OM13)
 * Purpose: SA "Process PO Exclusion" — per company, tick "Exclude from Process PO"
 *          on a Mother group, a Child group or single Prodshades of the MTS
 *          Product Group layout (erp_planning). An excluded Prodshade only
 *          disappears from Process PO creation; it still exists everywhere else
 *          for that company (plan, stock, reports). A Prodshade that is in no
 *          group is never excluded (owner, 2026-10-15).
 *          Schema: migrations/20261015130000_erp_planning_process_po_exclusion.sql
 * ACL: resource SA_PROD_PROCESS_PO_EXCLUSION (SA universe; SA / GA bypass).
 *      Each handler also re-checks the target company (canMaintainCompanyResource).
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type HandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const RESOURCE = "SA_PROD_PROCESS_PO_EXCLUSION";

function text(value: unknown): string {
  return String(value ?? "").trim();
}
function fail(req: Request, ctx: HandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}
function idList(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : [];
}

async function requireExclusionAccess(req: Request, ctx: HandlerContext, companyId: string, action: "VIEW" | "WRITE"): Promise<Response | null> {
  await assertCompanyScope(ctx, companyId);
  const allowed = await canMaintainCompanyResource(ctx, companyId, RESOURCE, action);
  return allowed ? null : fail(req, ctx, "PROC_PO_EXCLUSION_FORBIDDEN", 403, "Only SA can maintain Process PO exclusions.");
}

/** Every MTS Prodshade of the company (same source the planning page uses). */
async function loadCompanyProdshadeIds(companyId: string): Promise<string[]> {
  const { data, error } = await serviceRoleClient.schema("erp_planning")
    .rpc("mts_company_skus", { p_company_id: companyId });
  if (error) throw new Error("PROC_PO_EXCLUSION_SKU_LOOKUP_FAILED");
  return [...new Set(((data ?? []) as JsonRecord[]).map((row) => text(row.prodshade_material_id)).filter(Boolean))];
}

// ── GET /api/production/process-po-exclusion?company_id= ────────────────────
export async function getProcessPoExclusionHandler(req: Request, ctx: HandlerContext): Promise<Response> {
  try {
    const companyId = text(new URL(req.url).searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "PROC_PO_EXCLUSION_COMPANY_REQUIRED", 400, "company_id is required.");
    const denied = await requireExclusionAccess(req, ctx, companyId, "VIEW");
    if (denied) return denied;

    const [mothersRes, childrenRes, membersRes, exclusionsRes, companyProdshadeIds] = await Promise.all([
      serviceRoleClient.schema("erp_planning").from("prodshade_mother_group")
        .select("id, group_name").eq("company_id", companyId).eq("is_active", true),
      serviceRoleClient.schema("erp_planning").from("prodshade_child_group")
        .select("id, group_name, mother_group_id").eq("company_id", companyId).eq("is_active", true),
      serviceRoleClient.schema("erp_planning").from("prodshade_group_member")
        .select("prodshade_material_id, child_group_id").eq("company_id", companyId).eq("is_active", true),
      serviceRoleClient.schema("erp_planning").from("process_po_exclusion")
        .select("scope_type, scope_id").eq("company_id", companyId).eq("is_active", true),
      loadCompanyProdshadeIds(companyId),
    ]);
    if (mothersRes.error || childrenRes.error || membersRes.error || exclusionsRes.error) {
      throw new Error("PROC_PO_EXCLUSION_LOOKUP_FAILED");
    }
    const members = (membersRes.data ?? []) as JsonRecord[];
    const excluded = new Set(((exclusionsRes.data ?? []) as JsonRecord[]).map((x) => `${text(x.scope_type)}|${text(x.scope_id)}`));
    const groupedIds = new Set(members.map((m) => text(m.prodshade_material_id)));
    const materialIds = [...new Set([...groupedIds, ...companyProdshadeIds])];
    const materials = await fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient
      .schema("erp_master").from("material_master")
      .select("id, material_name, document_name").in("id", chunk));
    const materialById = new Map(materials.map((m) => [text(m.id), m]));
    const describe = (id: string) => ({
      prodshade_material_id: id,
      prodshade_label: text(materialById.get(id)?.material_name) || "—",
      prodshade_document_name: text(materialById.get(id)?.document_name) || null,
    });

    return okResponse({
      company_id: companyId,
      mother_groups: ((mothersRes.data ?? []) as JsonRecord[]).map((m) => ({
        id: m.id, name: m.group_name, excluded: excluded.has(`MOTHER|${text(m.id)}`),
      })),
      child_groups: ((childrenRes.data ?? []) as JsonRecord[]).map((c) => ({
        id: c.id, name: c.group_name, mother_group_id: c.mother_group_id, excluded: excluded.has(`CHILD|${text(c.id)}`),
      })),
      prodshades: members.map((m) => ({
        ...describe(text(m.prodshade_material_id)),
        child_group_id: m.child_group_id,
        excluded: excluded.has(`PRODSHADE|${text(m.prodshade_material_id)}`),
      })),
      // Not in any group = always offered on Process PO (cannot be excluded here).
      ungrouped_prodshades: companyProdshadeIds.filter((id) => !groupedIds.has(id)).map(describe),
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROC_PO_EXCLUSION_LOAD_FAILED";
    if (code === "COMPANY_SCOPE_VIOLATION") return fail(req, ctx, code, 403, "Company is outside your scope.");
    return fail(req, ctx, "PROC_PO_EXCLUSION_LOAD_FAILED", 500, "Could not load Process PO exclusions.");
  }
}

// ── POST /api/production/process-po-exclusion ───────────────────────────────
// Body: { company_id, mother_group_ids[], child_group_ids[], prodshade_material_ids[] }
// The lists are the complete set of ticks for that company.
export async function saveProcessPoExclusionHandler(req: Request, ctx: HandlerContext): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({} as JsonRecord)) as JsonRecord;
    const companyId = text(body.company_id);
    if (!companyId) return fail(req, ctx, "PROC_PO_EXCLUSION_COMPANY_REQUIRED", 400, "company_id is required.");
    const denied = await requireExclusionAccess(req, ctx, companyId, "WRITE");
    if (denied) return denied;

    const { data, error } = await serviceRoleClient.schema("erp_planning").rpc("save_process_po_exclusions", {
      p_company_id: companyId,
      p_actor: ctx.auth_user_id,
      p_mother_ids: idList(body.mother_group_ids),
      p_child_ids: idList(body.child_group_ids),
      p_prodshade_ids: idList(body.prodshade_material_ids),
    });
    if (error) {
      const match = /\b(PROC_PO_EXCLUSION_[A-Z_]+):\s*(.*)$/.exec(String(error.message ?? ""));
      if (match) return fail(req, ctx, match[1], 400, match[2] || match[1]);
      throw new Error("PROC_PO_EXCLUSION_SAVE_FAILED");
    }
    return okResponse({ result: data }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROC_PO_EXCLUSION_SAVE_FAILED";
    if (code === "COMPANY_SCOPE_VIOLATION") return fail(req, ctx, code, 403, "Company is outside your scope.");
    return fail(req, ctx, "PROC_PO_EXCLUSION_SAVE_FAILED", 500, "Could not save Process PO exclusions.");
  }
}
