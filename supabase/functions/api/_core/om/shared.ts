/*
 * File-ID: 14.1
 * File-Path: supabase/functions/api/_core/om/shared.ts
 * Gate: 14
 * Phase: 14
 * Domain: MASTER
 * Purpose: Define OM handler context and access guard functions.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";

export type OmHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

export function assertOmSaContext(ctx: OmHandlerContext): void {
  if (ctx.roleCode !== "SA") {
    throw new Error("OM_SA_REQUIRED");
  }
}

export function assertOmAdminContext(ctx: OmHandlerContext): void {
  if (ctx.roleCode !== "SA" && ctx.roleCode !== "ADMIN") {
    throw new Error("OM_ADMIN_REQUIRED");
  }
}
