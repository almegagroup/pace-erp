/*
 * File-ID: 5.7
 * File-Path: supabase/functions/api/_shared/context_headers.ts
 * Gate: 5
 * Phase: 5
 * Domain: CONTEXT
 * Purpose: Build deterministic request headers for DB RLS context alignment
 * Authority: Backend
 */

import type { ContextResolution } from "../_pipeline/context.ts";

export function buildRlsContextHeaders(ctx: ContextResolution): Record<string, string> {
  // If unresolved, do not send any context headers.
  if (ctx.status !== "RESOLVED") return {};

  // Admin bypass is carried as an explicit header.
  const isAdmin = ctx.isAdmin === true;

  return {
    "x-erp-is-admin": isAdmin ? "true" : "false",
    ...(ctx.companyId ? { "x-erp-company-id": String(ctx.companyId) } : {}),
    ...(ctx.workContextId ? { "x-erp-work-context-id": String(ctx.workContextId) } : {}),
    ...(ctx.projectId ? { "x-erp-project-id": String(ctx.projectId) } : {}),
    ...(ctx.departmentId ? { "x-erp-department-id": String(ctx.departmentId) } : {}),
  };
}
