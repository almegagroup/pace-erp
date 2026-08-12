/*
 * File-Path: supabase/functions/api/_shared/companyResourceAccess.ts
 * Domain: ACL
 * Purpose: Company-scope write ACL guard fix (Phase 2, started 2026-08-12) — generic
 *   EDIT-level ACL check for a write handler's TARGET company, not the session's active
 *   company. See scripts/company-scope-write-acl-guard.mjs for the full problem
 *   statement and CLAUDE.md §8A's "Bug-Pattern Guard Playbook".
 *
 *   route-registry's stepAcl() gate only checks ctx.context.companyId (the session's
 *   active company). A handler that resolves a DIFFERENT company_id from the request
 *   body/query/a fetched row and then mutates using THAT company_id is validated by
 *   stepAcl against the wrong company — assertCompanyScope() only proves the caller is
 *   a MEMBER of the target company, not that their ACL grant there is EDIT-level for
 *   the specific resource:action this write performs. Call canMaintainCompanyResource()
 *   right after resolving that target company_id, for the resource_code:action the
 *   route itself already requires at the session company (look it up in
 *   route-acl-registry.ts) — same rule, now enforced at the TARGET company too.
 *
 *   Extracted from the working reference implementation
 *   (procurement/planning.handlers.ts's canMaintainPlanning(), built for the PO11
 *   Planning fix, 2026-08-11) — same logic, generalized so every module can reuse ONE
 *   copy instead of re-deriving it per file.
 * Authority: Backend
 */

import { serviceRoleClient } from "./serviceRoleClient.ts";
import { readAclSnapshotDecisionAny } from "./acl_snapshot.ts";

export type CompanyResourceAccessCtx = {
  auth_user_id: string;
  context: {
    isAdmin?: boolean;
    companyId?: string;
    workContextId?: string;
    workContextIds?: string[];
  };
};

/**
 * true if the caller has ALLOW for resourceCode:actionCode at the SPECIFIC companyId
 * given — not just membership. When companyId equals the session's own active
 * company, reuses the already-resolved session work contexts (no extra round trip);
 * otherwise resolves that company's own active work contexts + ACL version fresh.
 */
export async function canMaintainCompanyResource(
  ctx: CompanyResourceAccessCtx,
  companyId: string,
  resourceCode: string,
  actionCode: string,
): Promise<boolean> {
  if (ctx.context.isAdmin) return true;
  if (!companyId) return false;

  let workContextIds: string[];
  if (companyId === ctx.context.companyId) {
    workContextIds =
      ctx.context.workContextIds && ctx.context.workContextIds.length > 0
        ? ctx.context.workContextIds
        : ctx.context.workContextId
          ? [ctx.context.workContextId]
          : [];
  } else {
    const { data: workContextRows, error: workContextError } = await serviceRoleClient
      .schema("erp_acl")
      .from("user_work_contexts")
      .select("work_context:work_context_id!inner(work_context_id, is_active)")
      .eq("auth_user_id", ctx.auth_user_id)
      .eq("company_id", companyId);
    if (workContextError) return false;
    workContextIds = ((workContextRows ?? []) as Array<{ work_context: unknown }>)
      .map((row) => {
        const wc = Array.isArray(row.work_context) ? row.work_context[0] : row.work_context;
        return wc && typeof wc === "object" ? (wc as { work_context_id: string; is_active: boolean }) : null;
      })
      .filter((wc): wc is { work_context_id: string; is_active: boolean } => Boolean(wc && wc.is_active === true))
      .map((wc) => wc.work_context_id);
  }
  if (workContextIds.length === 0) return false;

  const { data: versionRow, error: versionError } = await serviceRoleClient
    .schema("acl")
    .from("acl_versions")
    .select("acl_version_id")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .single();
  if (versionError || !versionRow?.acl_version_id) return false;

  const { data, error } = await readAclSnapshotDecisionAny({
    db: serviceRoleClient,
    aclVersionId: versionRow.acl_version_id as string,
    authUserId: ctx.auth_user_id,
    companyId,
    workContextIds,
    resourceCode,
    actionCode,
  });
  if (error || !data) return false;
  return data.decision === "ALLOW";
}
