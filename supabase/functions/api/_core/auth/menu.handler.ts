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
  const reqStart = performance.now();

  

  // --------------------------------------------------
  // 1️⃣ Hard invariant: context must be RESOLVED
  // --------------------------------------------------
  // 🔥 HARD NARROWING
if (context.status !== "RESOLVED") {
  return errorResponse(
    "CONTEXT_UNRESOLVED",
    "Menu context unresolved",
    request_id,
    "NONE",
    403
  );
}

// ✅ এখন new variable use করবো
const resolvedContext = context;

console.log("DEBUG_CONTEXT", {
  isAdmin: resolvedContext.isAdmin,
  companyId: resolvedContext.companyId,
  roleCode: resolvedContext.roleCode,
  auth_user_id
});

console.log("🔵 SERVICE_ROLE_CONTEXT", {
  isAdmin: resolvedContext.isAdmin,
  companyId: resolvedContext.companyId,
  roleCode: resolvedContext.roleCode
});

const universe = resolvedContext.isAdmin === true ? "SA" : "ACL";

  // --------------------------------------------------
  // 3️⃣ Snapshot is the ONLY data source
  // --------------------------------------------------

  

const db = getServiceRoleClientWithContext(resolvedContext);

// --------------------------------------------------
// 🔥 ENSURE SNAPSHOT EXISTS (CRITICAL FIX)
// --------------------------------------------------
console.log("🟡 SNAPSHOT_CALL", {
  user: auth_user_id,
  company: resolvedContext.companyId,
  universe
});
const tSnapshot0 = performance.now();
const { error: snapshotError } = await db
  .schema("erp_menu")
  .rpc("generate_menu_snapshot", {
    p_user_id: auth_user_id,
    p_company_id: resolvedContext.isAdmin
      ? null
      : resolvedContext.companyId,
    p_universe: universe
  });
  const snapshotMs = Math.round((performance.now() - tSnapshot0) * 100) / 100;

console.log("MENU_STAGE_SNAPSHOT_END", {
  request_id,
  user: auth_user_id,
  universe,
  duration_ms: snapshotMs
});

if (snapshotError) {
  console.error("🔥 SNAPSHOT_GENERATION_FAILED", {
    error: snapshotError.message
  });

  const totalMs = Math.round((performance.now() - reqStart) * 100) / 100;

  console.log("MENU_REQ_END", {
    request_id,
    path: "/api/me/menu",
    total_ms: totalMs,
    error: "SNAPSHOT_GENERATION_FAILED",
    user: auth_user_id,
    universe
  });

  return errorResponse(
    "SNAPSHOT_GENERATION_FAILED",
    snapshotError.message,
    request_id,
    "NONE",
    500
  );
}

console.log("🟢 SNAPSHOT_GENERATED", {
  user: auth_user_id,
  universe
});

  let query = db
  .schema("erp_menu").from("menu_snapshot")
  .select(`
menu_code,
title,
route_path,
menu_type,
parent_menu_code,
display_order,
snapshot_version
`)
  .eq("user_id", auth_user_id)
  .eq("universe", universe)
  .eq("is_visible", true);

/* 🔥 FIX: Admin হলে company filter লাগবে না */
if (resolvedContext.isAdmin !== true) {
  if (!resolvedContext.companyId) {
    console.error("❌ COMPANY_ID_MISSING", {
      resolvedContext
    });

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

console.log("🟡 MENU_QUERY_BUILD", {
  auth_user_id,
  universe,
  isAdmin: resolvedContext.isAdmin,
  companyId: resolvedContext.companyId
});

// 🔥 SAFE EXECUTION WRAP
let data, error;

try {
  const tBuild0 = performance.now();
  const result = await query.order("display_order", { ascending: true });
  const buildMs = Math.round((performance.now() - tBuild0) * 100) / 100;
  data = result.data;
  error = result.error;

  console.log("MENU_STAGE_BUILD_END", {
  request_id,
  user: auth_user_id,
  universe,
  duration_ms: buildMs,
  data_length: data?.length ?? 0,
  error: error?.message ?? null
});

// --------------------------------------------------
// ❗ HARD ERROR HANDLING (NEW)
// --------------------------------------------------
if (error) {
  return errorResponse(
    "MENU_READ_FAILED",
    error.message,
    request_id,
    "NONE",
    500
  );
}

} catch (e) {
  console.error("🔥 QUERY_CRASH", {
    error: e
  });

  return errorResponse(
    "QUERY_CRASH",
    String(e),
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
    company_id: resolvedContext.companyId,
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

  console.warn("⚠️ SNAPSHOT_ABSENT", {
    auth_user_id,
    universe,
    company_id: resolvedContext.companyId
  });
const totalMs = Math.round((performance.now() - reqStart) * 100) / 100;

console.log("MENU_REQ_END", {
  request_id,
  path: "/api/me/menu",
  total_ms: totalMs,
  user: auth_user_id,
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
// 4️⃣ Return snapshot verbatim (NO mutation, NO inference)
// --------------------------------------------------
const totalMs = Math.round((performance.now() - reqStart) * 100) / 100;

console.log("MENU_REQ_END", {
  request_id,
  path: "/api/me/menu",
  total_ms: totalMs,
  user: auth_user_id,
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

