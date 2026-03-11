// supabase/functions/api/_pipeline/protected_routes.dispatch.ts



import type { SessionResolution } from "./session.ts";
import type { ContextResolution } from "./context.ts";
import { dispatchAdminRoutes } from "../_routes/admin.routes.ts";
import { dispatchAclRoutes } from "../_routes/acl.routes.ts";
import { dispatchWorkflowRoutes } from "../_routes/workflow.routes.ts";
import { dispatchMenuRoutes } from "../_routes/menu.routes.ts";

/**
 * Protected route dispatcher (non-public routes only).
 * ZERO behavior change: switch cases copied 1:1 from runner.ts.
 */
export async function dispatchProtectedRoute(
  routeKey: string,
  req: Request,
  requestId: string,
  sessionResult: Extract<SessionResolution, { status: "ACTIVE" }>,
contextResult: Extract<ContextResolution, { status: "RESOLVED" }>
): Promise<Response> {

     const admin = await dispatchAdminRoutes(
  routeKey,
  req,
  requestId,
  sessionResult,
  contextResult
);

  if (admin) return admin;

  const acl = await dispatchAclRoutes(
  routeKey,
  req,
  contextResult
);
if (acl) return acl;

const workflow = await dispatchWorkflowRoutes(
  routeKey,
  req,
  requestId,
  sessionResult,
  contextResult
);
if (workflow) return workflow;
const menu = await dispatchMenuRoutes(
  routeKey,
  req,
  requestId,
  sessionResult,
  contextResult
);
if (menu) return menu;

    switch (routeKey) {
    default:
      return new Response(
        JSON.stringify({
          status: "blocked",
          reason: "no_handler_matched",
          request_id: requestId,
        }),
        { status: 403 }
      );
  }
}