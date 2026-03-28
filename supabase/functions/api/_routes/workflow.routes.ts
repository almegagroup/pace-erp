/*
 * Workflow Route Dispatcher
 */

import { processDecisionHandler } from "../_core/workflow/process_decision.handler.ts";
import { errorResponse } from "../_core/response.ts";

import type { SessionResolution } from "../_pipeline/session.ts";
import type { ContextResolution } from "../_pipeline/context.ts";

export async function dispatchWorkflowRoutes(
  routeKey: string,
  req: Request,
  requestId: string,
  session: Extract<SessionResolution, { status: "ACTIVE" }>,
  context: Extract<ContextResolution, { status: "RESOLVED" }>
): Promise<Response | null> {

  switch (routeKey) {

    case "POST:/api/workflow/decision":
      if (!context.companyId) {
        return errorResponse(
          "INVALID_CONTEXT",
          "Workflow company context missing",
          requestId,
          "NONE",
          403
        );
      }

      return await processDecisionHandler(req, {
        auth_user_id: session.authUserId,
        roleCode: context.roleCode,
        companyId: context.companyId,
        request_id: requestId,
      });

    default:
      return null;
  }
}
