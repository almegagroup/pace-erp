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
  context: ContextResolution;
  auth_user_id: string;
  session_id: string;  
  request_id: string;
}

/* =========================================================
 * Handler
 * ========================================================= */

export async function meMenuHandler(
  _req: Request,
  ctx: MenuHandlerCtx
): Promise<Response> {

  const { context, auth_user_id, session_id, request_id } = ctx;
  const reqStart = performance.now();

  // --------------------------------------------------
  // 1️⃣ Context validation
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

  const resolvedContext = context;

  

  const universe = resolvedContext.isAdmin === true ? "SA" : "ACL";

  console.log("MENU_CONTEXT", {
  request_id,
  session_id,
  auth_user_id,
  universe,
  company_id: resolvedContext.companyId ?? null
});

  const db = getServiceRoleClientWithContext(resolvedContext);

  // --------------------------------------------------
  // 🔥 SESSION SNAPSHOT FETCH
  // --------------------------------------------------

  let data: any[] = [];

  try {
    const t0 = performance.now();

    let query = db
      .schema("erp_cache")
      .from("session_menu_snapshot")
      .select("menu_json, snapshot_version, company_id")
      .eq("session_id", session_id)
      .eq("universe", universe);

    // ACL → company বাধ্যতামূলক
    if (!resolvedContext.isAdmin) {
      if (!resolvedContext.companyId) {
        return errorResponse(
          "INVALID_CONTEXT",
          "companyId missing for non-admin",
          request_id,
          "NONE",
          500
        );
      }

     

      query = query.eq("company_id", resolvedContext.companyId);
    }

    const { data: row, error } = await query.maybeSingle();

    const duration =
      Math.round((performance.now() - t0) * 100) / 100;

    console.log("SNAPSHOT_FETCH", {
      request_id,
      session_id,
      duration_ms: duration
    });

  if (error) {
  return errorResponse(
    "SESSION_SNAPSHOT_READ_FAILED",
    error.message,
    request_id,
    "NONE",
    500
  );
}

if (!row) {
  return errorResponse(
    "SESSION_SNAPSHOT_MISSING",
    "Snapshot not found",
    request_id,
    "NONE",
    500
  );
}

    data = row.menu_json ?? [];

    console.log("SNAPSHOT_USED", {
  request_id,
  count: data.length,
  version: row.snapshot_version
});

  } catch (e) {
    console.error("SNAPSHOT_CRASH", e);

    return errorResponse(
      "SNAPSHOT_CRASH",
      String(e),
      request_id,
      "NONE",
      500
    );
  }

  // --------------------------------------------------
  // Observability
  // --------------------------------------------------
  if (data.length > 0) {
    console.info("MENU_SNAPSHOT_SERVED", {
      request_id,
      auth_user_id,
      company_id: resolvedContext.companyId,
      universe,
      menu_count: data.length,
    });
  }

  // --------------------------------------------------
  // Hard deny (no snapshot)
  // --------------------------------------------------
  if (data.length === 0) {

    console.warn("SNAPSHOT_ABSENT", {
      auth_user_id,
      universe,
      company_id: resolvedContext.companyId
    });

    const totalMs =
      Math.round((performance.now() - reqStart) * 100) / 100;

    console.log("MENU_REQ_END", {
      request_id,
      total_ms: totalMs,
      universe,
      case: "SNAPSHOT_ABSENT"
    });

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
  // Final response
  // --------------------------------------------------
  const totalMs =
    Math.round((performance.now() - reqStart) * 100) / 100;

  console.log("MENU_REQ_END", {
    request_id,
    total_ms: totalMs,
    universe
  });

  return okResponse(
    {
      universe,
      menu: data,
    },
    request_id
  );
}

/* =========================================================
 * 🔽 EVERYTHING BELOW IS UNCHANGED (NO TOUCH)
 * ========================================================= */

interface MenuAdminCtx {
  context: ContextResolution;
  auth_user_id: string;
  request_id: string;
}

/* =========================================================
 * Gate-9 — Menu Admin Handlers (ID-9.12)
 * ========================================================= */



export async function createMenuHandler(
  req: Request,
  ctx: MenuAdminCtx
): Promise<Response> {

  const body = await req.json();

  const db = getServiceRoleClientWithContext(ctx.context);

  const { error } = await db
    .schema("erp_menu").from("menu_master")
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
    .schema("erp_menu").from("menu_master")
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
    .schema("erp_menu").from("menu_tree")
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
    .schema("erp_menu").from("menu_master")
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

  const { data: companyIdRaw } = await db
  .schema("erp_map")
  .rpc("get_primary_company", {
    p_auth_user_id: targetUserId
  });

const companyId = companyIdRaw as string | null;
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
  .schema("erp_map").from("user_company_roles")
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

console.log("🟡 PREVIEW_SNAPSHOT_CALL", {
  targetUserId,
  companyId,
  universe
});

const { error: snapshotError } = await db
  .schema("erp_menu")
  .rpc("generate_menu_snapshot", {
    p_user_id: targetUserId,
    p_company_id: companyId,
    p_universe: universe
  });


  
if (snapshotError) {
  
  
  return errorResponse(
    "SNAPSHOT_GENERATION_FAILED",
    snapshotError.message,
    ctx.request_id,
    "NONE",
    500
  );
}

  /* --------------------------------------------------
   * 5️⃣ Read snapshot
   * -------------------------------------------------- */

  const { data, error } = await db
    .schema("erp_menu").from("menu_snapshot")
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

