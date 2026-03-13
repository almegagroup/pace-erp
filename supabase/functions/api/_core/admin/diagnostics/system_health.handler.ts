/*
 * File-ID: 9.16A
 * File-Path: supabase/functions/api/_core/admin/diagnostics/system_health.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: OBSERVABILITY
 * Purpose: Diagnostics panel / system health endpoint
 * Authority: Backend
 */

import { okResponse, errorResponse } from "../../response.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import { SYSTEM_VERSION } from "../../system/version.ts";

import type { ContextResolution } from "../../../_pipeline/context.ts";

interface DiagnosticsCtx {
  context: ContextResolution;
  request_id: string;
}

export async function systemHealthHandler(
  _req: Request,
  ctx: DiagnosticsCtx
): Promise<Response> {

  if (ctx.context.status !== "RESOLVED") {
    return errorResponse(
      "CONTEXT_UNRESOLVED",
      "Diagnostics context unresolved",
      ctx.request_id,
      "NONE",
      403
    );
  }

  const db = getServiceRoleClientWithContext(ctx.context);

  /* --------------------------------------
   * 1️⃣ Database health
   * -------------------------------------- */

  const { error: dbError } = await db
    .schema("erp_core").from("sessions")
    .select("session_id")
    .limit(1);

  const db_status = dbError ? "DOWN" : "UP";

  /* --------------------------------------
   * 2️⃣ ACL snapshot health
   * -------------------------------------- */

  const { error: aclError } = await db
    .schema("acl").from("precomputed_acl_view")
    .select("snapshot_id")
    .limit(1);

  const acl_snapshot_status = aclError ? "UNAVAILABLE" : "READY";

  /* --------------------------------------
   * 3️⃣ Menu snapshot health
   * -------------------------------------- */

  const { error: menuError } = await db
    .schema("erp_menu").from("menu_snapshot")
    .select("menu_code")
    .limit(1);

  const menu_snapshot_status = menuError ? "UNAVAILABLE" : "READY";

  return okResponse(
    {
      system_version: SYSTEM_VERSION,
      db_status,
      acl_snapshot_status,
      menu_snapshot_status
    },
    ctx.request_id
  );
}