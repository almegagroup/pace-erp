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
  req: Request,
  ctx: MenuHandlerCtx
): Promise<Response> {

  const { context, auth_user_id, session_id, request_id } = ctx;
  if (!session_id) {
  return errorResponse(
    "SESSION_ID_MISSING",
    "Session ID not provided",
    request_id,
    "NONE",
    500
  );
}
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

  let data: unknown[] = [];

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

    data = Array.isArray(row.menu_json) ? row.menu_json : [];

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
      company_id: resolvedContext.companyId ?? null,
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
      company_id: resolvedContext.companyId ?? null
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
      request_id,
      req
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
    request_id,
    req
  );
}

/* =========================================================
 * 🔽 EVERYTHING BELOW IS UNCHANGED (NO TOUCH)
 * ========================================================= */

interface MenuAdminCtx {
  context: ContextResolution;
  auth_user_id: string;
  request_id: string;
  session_id?: string;
}

async function resolveMenuIdByCode(
  db: ReturnType<typeof getServiceRoleClientWithContext>,
  menuCode?: string | null
): Promise<string | null> {
  if (!menuCode) {
    return null;
  }

  const { data } = await db
    .schema("erp_menu")
    .from("menu_master")
    .select("id")
    .eq("menu_code", menuCode)
    .maybeSingle();

  return data?.id ?? null;
}

async function refreshAdminSessionMenuSnapshot(
  ctx: MenuAdminCtx
): Promise<{ ok: boolean; reason?: string }> {
  if (!ctx.session_id) {
    return { ok: false, reason: "SESSION_ID_MISSING" };
  }

  const db = getServiceRoleClientWithContext(ctx.context);

  const { error: snapshotError } = await db
    .schema("erp_menu")
    .rpc("generate_menu_snapshot", {
      p_user_id: ctx.auth_user_id,
      p_company_id: null,
      p_universe: "SA",
    });

  if (snapshotError) {
    console.error("ADMIN_MENU_SNAPSHOT_REBUILD_FAILED", snapshotError);
    return { ok: false, reason: "SNAPSHOT_REBUILD_FAILED" };
  }

  const { data: menuRows, error: menuReadError } = await db
    .schema("erp_menu")
    .from("menu_snapshot")
    .select("*")
    .eq("user_id", ctx.auth_user_id)
    .eq("universe", "SA")
    .eq("is_visible", true)
    .order("display_order", { ascending: true });

  if (menuReadError) {
    console.error("ADMIN_MENU_SNAPSHOT_READ_FAILED", menuReadError);
    return { ok: false, reason: "SNAPSHOT_READ_FAILED" };
  }

  if (!menuRows || menuRows.length === 0) {
    return { ok: false, reason: "SNAPSHOT_EMPTY" };
  }

  const { error: sessionSnapshotError } = await db
    .schema("erp_cache")
    .from("session_menu_snapshot")
    .upsert(
      {
        session_id: ctx.session_id,
        auth_user_id: ctx.auth_user_id,
        universe: "SA",
        company_id: null,
        snapshot_version: menuRows[0]?.snapshot_version ?? 0,
        menu_json: menuRows,
      },
      { onConflict: "session_id,universe,company_id" }
    );

  if (sessionSnapshotError) {
    console.error(
      "ADMIN_SESSION_MENU_SNAPSHOT_UPSERT_FAILED",
      sessionSnapshotError
    );
    return { ok: false, reason: "SESSION_SNAPSHOT_UPSERT_FAILED" };
  }

  return { ok: true };
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

  const parentMenuId =
    body.parent_menu_id ??
    (await resolveMenuIdByCode(db, body.parent_menu_code ?? null));

  const { data: createdMenu, error } = await db
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
    })
    .select(`
      id,
      menu_code,
      resource_code,
      title,
      route_path,
      menu_type,
      universe,
      display_order,
      is_active
    `)
    .single();

  if (error) {
    return errorResponse(
      "MENU_CREATE_FAILED",
      error.message,
      ctx.request_id,
      "NONE",
      500
    );
  }

  if (parentMenuId && createdMenu?.id) {
    const { error: treeError } = await db
      .schema("erp_menu")
      .from("menu_tree")
      .upsert(
        {
          parent_menu_id: parentMenuId,
          child_menu_id: createdMenu.id,
          display_order: body.tree_display_order ?? body.display_order ?? 0,
          created_by: ctx.auth_user_id,
        },
        { onConflict: "child_menu_id" }
      );

    if (treeError) {
      return errorResponse(
        "MENU_TREE_CREATE_FAILED",
        treeError.message,
        ctx.request_id,
        "NONE",
        500
      );
    }
  }

  const refresh = await refreshAdminSessionMenuSnapshot(ctx);

  return okResponse(
    {
      created: true,
      menu: createdMenu,
      snapshot_refreshed: refresh.ok,
      snapshot_refresh_reason: refresh.reason ?? null,
    },
    ctx.request_id,
    req
  );
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

  const refresh = await refreshAdminSessionMenuSnapshot(ctx);

  return okResponse(
    {
      updated: true,
      snapshot_refreshed: refresh.ok,
      snapshot_refresh_reason: refresh.reason ?? null,
    },
    ctx.request_id,
    req
  );
}

export async function updateMenuTreeHandler(
  req: Request,
  ctx: MenuAdminCtx
): Promise<Response> {

  const body = await req.json();

  const db = getServiceRoleClientWithContext(ctx.context);

  const childMenuId =
    body.child_menu_id ??
    (await resolveMenuIdByCode(db, body.child_menu_code ?? null));
  const parentMenuId =
    body.parent_menu_id ??
    (await resolveMenuIdByCode(db, body.parent_menu_code ?? null));

  if (!childMenuId) {
    return errorResponse(
      "MENU_TREE_CHILD_REQUIRED",
      "child_menu_id or child_menu_code is required",
      ctx.request_id,
      "NONE",
      400
    );
  }

  const { error } = await db
    .schema("erp_menu").from("menu_tree")
    .upsert(
      {
        parent_menu_id: parentMenuId,
        child_menu_id: childMenuId,
        display_order: body.display_order ?? 0,
        created_by: ctx.auth_user_id,
      },
      { onConflict: "child_menu_id" }
    );

  if (error) {
    return errorResponse(
      "MENU_TREE_UPDATE_FAILED",
      error.message,
      ctx.request_id,
      "NONE",
      500
    );
  }

  const refresh = await refreshAdminSessionMenuSnapshot(ctx);

  return okResponse(
    {
      updated: true,
      snapshot_refreshed: refresh.ok,
      snapshot_refresh_reason: refresh.reason ?? null,
    },
    ctx.request_id,
    req
  );
}

export async function listMenuRegistryHandler(
  req: Request,
  ctx: MenuAdminCtx
): Promise<Response> {
  const url = new URL(req.url);
  const universe = url.searchParams.get("universe");
  const db = getServiceRoleClientWithContext(ctx.context);

  let masterQuery = db
    .schema("erp_menu")
    .from("menu_master")
    .select(`
      id,
      menu_code,
      resource_code,
      title,
      description,
      route_path,
      menu_type,
      universe,
      is_system,
      display_order,
      is_active,
      created_at
    `)
    .order("universe")
    .order("display_order")
    .order("title");

  if (universe === "SA" || universe === "ACL") {
    masterQuery = masterQuery.eq("universe", universe);
  }

  const [{ data: menuRows, error: menuError }, { data: treeRows, error: treeError }] =
    await Promise.all([
      masterQuery,
      db
        .schema("erp_menu")
        .from("menu_tree")
        .select("parent_menu_id, child_menu_id, display_order"),
    ]);

  if (menuError) {
    return errorResponse(
      "MENU_REGISTRY_READ_FAILED",
      menuError.message,
      ctx.request_id,
      "NONE",
      500
    );
  }

  if (treeError) {
    return errorResponse(
      "MENU_TREE_READ_FAILED",
      treeError.message,
      ctx.request_id,
      "NONE",
      500
    );
  }

  const menuById = new Map((menuRows ?? []).map((row) => [row.id, row]));
  const treeByChildId = new Map(
    (treeRows ?? []).map((row) => [row.child_menu_id, row])
  );

  const payload = (menuRows ?? []).map((row) => {
    const tree = treeByChildId.get(row.id);
    const parent = tree?.parent_menu_id ? menuById.get(tree.parent_menu_id) : null;

    return {
      ...row,
      parent_menu_id: tree?.parent_menu_id ?? null,
      parent_menu_code: parent?.menu_code ?? null,
      parent_title: parent?.title ?? null,
      tree_display_order: tree?.display_order ?? null,
    };
  });

  return okResponse(
    {
      menus: payload,
    },
    ctx.request_id,
    req
  );
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

  const refresh = await refreshAdminSessionMenuSnapshot(ctx);

  return okResponse(
    {
      updated: true,
      snapshot_refreshed: refresh.ok,
      snapshot_refresh_reason: refresh.reason ?? null,
    },
    ctx.request_id,
    req
  );
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
      404,
       undefined,
  req
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
    ctx.request_id,
    req
  );
}

