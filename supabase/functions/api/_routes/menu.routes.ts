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
  previewUserHandler
} from "../_core/auth/menu.handler.ts";

import type { SessionResolution } from "../_pipeline/session.ts";
import type { ContextResolution } from "../_pipeline/context.ts";

export async function dispatchMenuRoutes(
  routeKey: string,
  req: Request,
  requestId: string,
  session: Extract<SessionResolution, { status: "ACTIVE" }>,
  context: Extract<ContextResolution, { status: "RESOLVED" }>
): Promise<Response | null> {

  switch (routeKey) {

  case "GET:/api/me/menu":
    return await meMenuHandler(req, {
  context,
  auth_user_id: session.authUserId,
  session_id: session.sessionId,   // 🔥 CRITICAL FIX
  request_id: requestId,
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
