/*
 * Menu Route Dispatcher
 */

import {
  meMenuHandler,
  listMenuRegistryHandler,
  createMenuHandler,
  updateMenuHandler,
  updateMenuTreeHandler,
  updateMenuStateHandler,
  deleteMenuHandler,
  previewUserHandler
} from "../_core/auth/menu.handler.ts";

import {
  createColumnLayoutHandler,
  deleteColumnLayoutHandler,
  listColumnLayoutsHandler,
  setDefaultColumnLayoutHandler,
  updateColumnLayoutHandler,
} from "../_core/common/column_layout.handlers.ts";
import type { SessionResolution } from "../_pipeline/session.ts";
import type { ContextResolution } from "../_pipeline/context.ts";

export async function dispatchMenuRoutes(
  routeKey: string,
  req: Request,
  requestId: string,
  session: Extract<SessionResolution, { status: "ACTIVE" }>,
  context: Extract<ContextResolution, { status: "RESOLVED" }>
): Promise<Response | null> {

  // Common column-picker layouts (session-only personal UI preferences, see column_layout.handlers.ts).
  {
    const pathname = new URL(req.url).pathname;
    if (pathname === "/api/me/column-layouts" || pathname.startsWith("/api/me/column-layouts/")) {
      const layoutCtx = {
        context,
        request_id: requestId,
        auth_user_id: session.authUserId,
        roleCode: context.roleCode,
      };
      if (pathname === "/api/me/column-layouts") {
        if (req.method === "GET") return await listColumnLayoutsHandler(req, layoutCtx);
        if (req.method === "POST") return await createColumnLayoutHandler(req, layoutCtx);
      } else if (/^\/api\/me\/column-layouts\/[^/]+\/set-default$/.test(pathname)) {
        if (req.method === "POST") return await setDefaultColumnLayoutHandler(req, layoutCtx);
      } else if (/^\/api\/me\/column-layouts\/[^/]+$/.test(pathname)) {
        if (req.method === "PATCH") return await updateColumnLayoutHandler(req, layoutCtx);
        if (req.method === "DELETE") return await deleteColumnLayoutHandler(req, layoutCtx);
      }
    }
  }

  switch (routeKey) {

  case "GET:/api/me/menu":
    return await meMenuHandler(req, {
      context,
      auth_user_id: session.authUserId,
      session_id: session.sessionId,
      request_id: requestId,
      workspace_mode: session.workspaceMode ?? null,
    });

  /* =========================================
   * ID-9.12 — Menu Admin Panel
   * ========================================= */

  case "GET:/api/admin/menu":

    if (!context.isAdmin) return null;

    return await listMenuRegistryHandler(req, {
      context,
      auth_user_id: session.authUserId,
      request_id: requestId,
      session_id: session.sessionId
    });

  case "POST:/api/admin/menu":

    if (!context.isAdmin) return null;

    return await createMenuHandler(req, {
      context,
      auth_user_id: session.authUserId,
      request_id: requestId,
      session_id: session.sessionId
    });

  case "PATCH:/api/admin/menu":

    if (!context.isAdmin) return null;

    return await updateMenuHandler(req, {
      context,
      auth_user_id: session.authUserId,
      request_id: requestId,
      session_id: session.sessionId
    });

  case "DELETE:/api/admin/menu":

    if (!context.isAdmin) return null;

    return await deleteMenuHandler(req, {
      context,
      auth_user_id: session.authUserId,
      request_id: requestId,
      session_id: session.sessionId
    });

  case "PATCH:/api/admin/menu/tree":

    if (!context.isAdmin) return null;

    return await updateMenuTreeHandler(req, {
      context,
      auth_user_id: session.authUserId,
      request_id: requestId,
      session_id: session.sessionId
    });

  case "PATCH:/api/admin/menu/state":

    if (!context.isAdmin) return null;

    return await updateMenuStateHandler(req, {
      context,
      auth_user_id: session.authUserId,
      request_id: requestId,
      session_id: session.sessionId
    });

    case "POST:/api/admin/preview-user":

  if (!context.isAdmin) return null;

  return await previewUserHandler(req, {
    context,
    auth_user_id: session.authUserId,
    request_id: requestId
  });

  default:
    return null;
}
}
