import type { SessionResolution } from "../_pipeline/session.ts";
import type { ContextResolution } from "../_pipeline/context.ts";
import {
  cancelLeaveRequestHandler,
  createLeaveRequestHandler,
  listLeaveApprovalInboxHandler,
  listLeaveApprovalScopeHistoryHandler,
  listLeaveRegisterHandler,
  listMyLeaveRequestsHandler,
  updateLeaveRequestHandler,
} from "../_core/hr/leave.handlers.ts";
import {
  cancelOutWorkRequestHandler,
  createOutWorkDestinationHandler,
  createOutWorkRequestHandler,
  listMyOutWorkRequestsHandler,
  listOutWorkApprovalInboxHandler,
  listOutWorkApprovalScopeHistoryHandler,
  listOutWorkDestinationsHandler,
  listOutWorkRegisterHandler,
  updateOutWorkRequestHandler,
} from "../_core/hr/out_work.handlers.ts";

export async function dispatchHrRoutes(
  routeKey: string,
  req: Request,
  requestId: string,
  session: Extract<SessionResolution, { status: "ACTIVE" }>,
  context: Extract<ContextResolution, { status: "RESOLVED" }>,
): Promise<Response | null> {
  const ctx = {
    context,
    request_id: requestId,
    auth_user_id: session.authUserId,
    roleCode: context.roleCode,
  };

  switch (routeKey) {
    case "POST:/api/hr/leave/request":
      return await createLeaveRequestHandler(req, ctx);

    case "GET:/api/hr/leave/my-requests":
      return await listMyLeaveRequestsHandler(req, ctx);

    case "POST:/api/hr/leave/cancel":
      return await cancelLeaveRequestHandler(req, ctx);

    case "POST:/api/hr/leave/update":
      return await updateLeaveRequestHandler(req, ctx);

    case "GET:/api/hr/leave/approval-inbox":
      return await listLeaveApprovalInboxHandler(req, ctx);

    case "GET:/api/hr/leave/approval-history":
      return await listLeaveApprovalScopeHistoryHandler(req, ctx);

    case "GET:/api/hr/leave/register":
      return await listLeaveRegisterHandler(req, ctx);

    case "GET:/api/hr/out-work/destinations":
      return await listOutWorkDestinationsHandler(req, ctx);

    case "POST:/api/hr/out-work/destination":
      return await createOutWorkDestinationHandler(req, ctx);

    case "POST:/api/hr/out-work/request":
      return await createOutWorkRequestHandler(req, ctx);

    case "GET:/api/hr/out-work/my-requests":
      return await listMyOutWorkRequestsHandler(req, ctx);

    case "POST:/api/hr/out-work/cancel":
      return await cancelOutWorkRequestHandler(req, ctx);

    case "POST:/api/hr/out-work/update":
      return await updateOutWorkRequestHandler(req, ctx);

    case "GET:/api/hr/out-work/approval-inbox":
      return await listOutWorkApprovalInboxHandler(req, ctx);

    case "GET:/api/hr/out-work/approval-history":
      return await listOutWorkApprovalScopeHistoryHandler(req, ctx);

    case "GET:/api/hr/out-work/register":
      return await listOutWorkRegisterHandler(req, ctx);

    default:
      return null;
  }
}
