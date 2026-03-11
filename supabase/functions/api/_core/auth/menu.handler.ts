/*
 * File-ID: 7.4
 * File-Path: supabase/functions/api/_core/auth/menu.handler.ts
 * Gate: 7
 * Phase: 7
 * Domain: API
 * Purpose: Serve snapshot-based menu (ONLY source of UI truth)
 * Authority: Backend
 */

import { okResponse, errorResponse } from "../response.ts";
import { getServiceRoleClientWithContext } from "../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../_pipeline/context.ts";

/* =========================================================
 * Types
 * ========================================================= */

interface MenuHandlerCtx {
  context: ContextResolution;   // Gate-5 resolved context (NO authUserId here by design)
  auth_user_id: string;         // Gate-2 session truth (explicit, mandatory)
  request_id: string;
}

/* =========================================================
 * Handler
 * ========================================================= */

export async function meMenuHandler(
  _req: Request,
  ctx: MenuHandlerCtx
): Promise<Response> {
  const { context, auth_user_id, request_id } = ctx;

  // --------------------------------------------------
  // 1️⃣ Hard invariant: context must be RESOLVED
  // --------------------------------------------------
  if (context.status !== "RESOLVED") {
    return errorResponse(
      "CONTEXT_UNRESOLVED",
      "Menu context unresolved",
      request_id,
      "NONE",
      403
    );
  }

  // --------------------------------------------------
  // 2️⃣ Determine universe (ID-7.4A)
  // --------------------------------------------------
  const universe = context.isAdmin === true ? "SA" : "ACL";

  // --------------------------------------------------
  // 3️⃣ Snapshot is the ONLY data source
  // --------------------------------------------------
  const db = getServiceRoleClientWithContext(context);

  const { data, error } = await db
    .from("erp_menu.menu_snapshot")
    .select(`
  menu_code,
  title,
  route_path,
  menu_type,
  parent_menu_code,
  display_order,
  snapshot_version
`)
    .eq("user_id", auth_user_id)        // ✅ session truth (Gate-2)
    .eq("company_id", context.companyId)
    .eq("universe", universe)
    .eq("is_visible", true)
    .order("display_order", { ascending: true });

  if (error) {
  return errorResponse(
    "MENU_SNAPSHOT_READ_FAILED",
    error.message,
    request_id,
    "NONE",
    500
  );
}

/* --------------------------------------------------
 * 7️⃣.9️⃣ G9 — Snapshot Observability
 * Purpose: Log snapshot version + context for audit traceability
 * -------------------------------------------------- */
if (data && data.length > 0) {
  console.info("MENU_SNAPSHOT_SERVED", {
    request_id,
    auth_user_id,
    company_id: context.companyId,
    universe,
    snapshot_version: data[0].snapshot_version ?? null,
    menu_count: data.length,
  });
}

// --------------------------------------------------
// 3️⃣.5️⃣ G5 — Visibility Hard-Deny
// Snapshot absence ⇒ invisible (explicit fail-closed)
// --------------------------------------------------
if (!data || data.length === 0) {
  return okResponse(
    {
      universe,
      menu: [],
      meta: {
        hard_deny: true,
        reason: "SNAPSHOT_ABSENT"
      }
    },
    request_id
  );
}

// --------------------------------------------------
// 4️⃣ Return snapshot verbatim (NO mutation, NO inference)
// --------------------------------------------------
return okResponse(
  {
    universe,
    menu: data,
  },
  request_id
);

}

/* =========================================================
 * Gate-9 — Menu Admin Handlers (ID-9.12)
 * ========================================================= */

interface MenuAdminCtx {
  context: ContextResolution;
  auth_user_id: string;
  request_id: string;
}

export async function createMenuHandler(
  req: Request,
  ctx: MenuAdminCtx
): Promise<Response> {

  const body = await req.json();

  const db = getServiceRoleClientWithContext(ctx.context);

  const { error } = await db
    .from("erp_menu.menu_master")
    .insert({
      menu_code: body.menu_code,
      resource_code: body.resource_code,
      title: body.title,
      route_path: body.route_path ?? null,
      menu_type: body.menu_type,
      universe: body.universe,
      display_order: body.display_order ?? 0,
      created_by: ctx.auth_user_id
    });

  if (error) {
    return errorResponse(
      "MENU_CREATE_FAILED",
      error.message,
      ctx.request_id,
      "NONE",
      500
    );
  }

  return okResponse({ created: true }, ctx.request_id);
}

export async function updateMenuHandler(
  req: Request,
  ctx: MenuAdminCtx
): Promise<Response> {

  const body = await req.json();

  const db = getServiceRoleClientWithContext(ctx.context);

  const { error } = await db
    .from("erp_menu.menu_master")
    .update({
      title: body.title,
      route_path: body.route_path ?? null,
      display_order: body.display_order ?? 0,
      updated_at: new Date().toISOString(),
      updated_by: ctx.auth_user_id
    })
    .eq("menu_code", body.menu_code);

  if (error) {
    return errorResponse(
      "MENU_UPDATE_FAILED",
      error.message,
      ctx.request_id,
      "NONE",
      500
    );
  }

  return okResponse({ updated: true }, ctx.request_id);
}

export async function updateMenuTreeHandler(
  req: Request,
  ctx: MenuAdminCtx
): Promise<Response> {

  const body = await req.json();

  const db = getServiceRoleClientWithContext(ctx.context);

  const { error } = await db
    .from("erp_menu.menu_tree")
    .update({
      parent_menu_id: body.parent_menu_id,
      display_order: body.display_order ?? 0
    })
    .eq("child_menu_id", body.child_menu_id);

  if (error) {
    return errorResponse(
      "MENU_TREE_UPDATE_FAILED",
      error.message,
      ctx.request_id,
      "NONE",
      500
    );
  }

  return okResponse({ updated: true }, ctx.request_id);
}

export async function updateMenuStateHandler(
  req: Request,
  ctx: MenuAdminCtx
): Promise<Response> {

  const body = await req.json();

  const db = getServiceRoleClientWithContext(ctx.context);

  const { error } = await db
    .from("erp_menu.menu_master")
    .update({
      is_active: body.is_active,
      updated_at: new Date().toISOString(),
      updated_by: ctx.auth_user_id
    })
    .eq("menu_code", body.menu_code);

  if (error) {
    return errorResponse(
      "MENU_STATE_UPDATE_FAILED",
      error.message,
      ctx.request_id,
      "NONE",
      500
    );
  }

  return okResponse({ updated: true }, ctx.request_id);
}

/* =========================================================
 * Gate-9 — Preview-as-User (ID-9.13)
 * ========================================================= */

export async function previewUserHandler(
  req: Request,
  ctx: MenuAdminCtx
): Promise<Response> {

  const body = await req.json();
  const targetUserId = body.target_user_id;

  const db = getServiceRoleClientWithContext(ctx.context);

  /* --------------------------------------------------
   * 1️⃣ Resolve company of target user
   * -------------------------------------------------- */

  const { data: companyId } = await db.rpc(
    "erp_map.get_primary_company",
    { p_auth_user_id: targetUserId }
  );

  if (!companyId) {
    return errorResponse(
      "PREVIEW_USER_NOT_FOUND",
      "Target user has no company binding",
      ctx.request_id,
      "NONE",
      404
    );
  }

  /* --------------------------------------------------
 * 2️⃣ Resolve role of target user
 * -------------------------------------------------- */

const { data: roleRow } = await db
  .from("erp_map.user_company_roles")
  .select("role_code")
  .eq("auth_user_id", targetUserId)
  .eq("company_id", companyId)
  .single();

if (!roleRow?.role_code) {
  return errorResponse(
    "PREVIEW_ROLE_NOT_FOUND",
    "Target user role not found",
    ctx.request_id,
    "NONE",
    404
  );
}

const roleCode = roleRow.role_code;

/* --------------------------------------------------
 * 3️⃣ Determine universe from role
 * -------------------------------------------------- */

let universe = "ACL";

if (roleCode === "SA" || roleCode === "GA") {
  universe = "SA";
}

/* --------------------------------------------------
 * 4️⃣ Generate menu snapshot
 * -------------------------------------------------- */

await db.rpc(
  "erp_menu.generate_menu_snapshot",
  {
    p_user_id: targetUserId,
    p_company_id: companyId,
    p_universe: universe
  }
);

  /* --------------------------------------------------
   * 5️⃣ Read snapshot
   * -------------------------------------------------- */

  const { data, error } = await db
    .from("erp_menu.menu_snapshot")
    .select(`
      menu_code,
      title,
      route_path,
      menu_type,
      parent_menu_code,
      display_order
    `)
    .eq("user_id", targetUserId)
    .eq("company_id", companyId)
    .eq("universe", universe)
    .eq("is_visible", true)
    .order("display_order");

  if (error) {
    return errorResponse(
      "PREVIEW_MENU_FAILED",
      error.message,
      ctx.request_id,
      "NONE",
      500
    );
  }

  return okResponse(
    {
      preview_user: targetUserId,
      universe,
      menu: data
    },
    ctx.request_id
  );
}

