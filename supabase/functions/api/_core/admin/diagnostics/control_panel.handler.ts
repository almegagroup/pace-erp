/*
 * File-ID: 9.17A
 * File-Path: supabase/functions/api/_core/admin/diagnostics/control_panel.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ADMIN
 * Purpose: Admin control panel bootstrap data
 * Authority: Backend
 */

import { okResponse, errorResponse } from "../../response.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import { SYSTEM_VERSION } from "../../system/version.ts";

import type { ContextResolution } from "../../../_pipeline/context.ts";

interface ControlPanelCtx {
  context: ContextResolution;
  request_id: string;
}

export async function controlPanelHandler(
  _req: Request,
  ctx: ControlPanelCtx
): Promise<Response> {

  if (ctx.context.status !== "RESOLVED") {
    return errorResponse(
      "CONTEXT_UNRESOLVED",
      "Admin control panel context unresolved",
      ctx.request_id,
      "NONE",
      403
    );
  }

  const db = getServiceRoleClientWithContext(ctx.context);

  /* -----------------------------
   * DB health
   * ----------------------------- */

  const { error: dbError } = await db
    .schema("erp_core").from("sessions")
    .select("session_id")
    .limit(1);

  const db_status = dbError ? "DOWN" : "UP";

  /* -----------------------------
   * user count
   * ----------------------------- */

  const { count: userCount } = await db
    .schema("erp_map").from("user_company_roles")
    .select("*", { count: "exact", head: true });

  /* -----------------------------
   * active sessions
   * ----------------------------- */

  const { data: sessions } = await db
    .schema("erp_core").from("sessions")
    .select(`
      session_id,
      auth_user_id,
      status,
      created_at,
      last_seen_at
    `)
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false })
    .limit(10);

  /* -----------------------------
   * audit logs
   * ----------------------------- */

  const { data: audit } = await db
    .schema("erp_audit").from("admin_action_audit")
    .select(`
      audit_id,
      action_code,
      admin_user_id,
      performed_at,
      status
    `)
    .order("performed_at", { ascending: false })
    .limit(10);

  return okResponse(
    {
      system: SYSTEM_VERSION,
      db_status,
      user_count: userCount ?? 0,
      recent_sessions: sessions ?? [],
      recent_audit: audit ?? []
    },
    ctx.request_id
  );
}