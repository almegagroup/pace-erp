/*
 * File-Path: supabase/functions/api/_shared/companyScope.ts
 * Purpose: Generic caller-company-scope guard — Section 112 (feasibility doc).
 *          Verifies a company_id belongs to the caller's own erp_map.user_companies
 *          before any handler creates/mutates/reads a company-scoped resource.
 *          Reuses the exact pattern already proven correct in
 *          assertPackingCompanyScope / assertPartialReversalCompanyScope /
 *          assertOpeningStockCompanyScope — consolidated into one shared helper
 *          so every handler (present and future) calls the same code path,
 *          and the company-scope-guard.mjs CI check has one canonical call
 *          signature to look for.
 * Authority: Backend
 */

import { serviceRoleClient } from "./serviceRoleClient.ts";
import { isGlobalAdmin, isSuperAdmin } from "./role_ladder.ts";

export interface CompanyScopeCtx {
  auth_user_id: string;
  roleCode: string;
  context: { isAdmin?: boolean };
}

export function isCompanyScopeAdminBypass(ctx: CompanyScopeCtx): boolean {
  return ctx.context.isAdmin === true || isSuperAdmin(ctx.roleCode) || isGlobalAdmin(ctx.roleCode);
}

/**
 * Throws COMPANY_SCOPE_VIOLATION unless companyId is one of the caller's own
 * erp_map.user_companies rows (or the caller is SA/GA/admin-bypass).
 *
 * Call this:
 *  - Create handlers: with the company_id from the request body, before insert.
 *  - Act-on-existing handlers (finalize/verify/reverse/approve/release/etc.):
 *    with the FETCHED record's own company_id, after fetch, before mutating.
 *  - Read/detail handlers: with the fetched record's own company_id, before
 *    returning it to the caller.
 */
export async function assertCompanyScope(ctx: CompanyScopeCtx, companyId: string | null | undefined): Promise<void> {
  if (isCompanyScopeAdminBypass(ctx)) return;
  const normalizedCompanyId = String(companyId ?? "").trim();
  if (!normalizedCompanyId) throw new Error("COMPANY_SCOPE_VIOLATION");
  const { data, error } = await serviceRoleClient
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", ctx.auth_user_id)
    .eq("company_id", normalizedCompanyId)
    .maybeSingle();
  if (error || !data) throw new Error("COMPANY_SCOPE_VIOLATION");
}
