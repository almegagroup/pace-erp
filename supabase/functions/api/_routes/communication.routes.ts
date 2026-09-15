import type { ContextResolution } from "../_pipeline/context.ts";
import type { SessionResolution } from "../_pipeline/session.ts";
import { getCommunicationActionVisibilityHandler } from "../_core/communication/runtime_visibility.handlers.ts";
import {
  activateCommunicationRuleHandler,
  deactivateCommunicationRuleHandler,
  getCommunicationConfigurationBootstrapHandler,
  getCommunicationRuleHandler,
  saveCommunicationRuleDraftHandler,
} from "../_core/communication/rule_configuration.handlers.ts";

export async function dispatchCommunicationRoutes(
  routeKey: string,
  req: Request,
  requestId: string,
  session: Extract<SessionResolution, { status: "ACTIVE" }>,
  context: Extract<ContextResolution, { status: "RESOLVED" }>,
): Promise<Response | null> {
  switch (routeKey) {
    case "GET:/api/communication/action-visibility":
      return getCommunicationActionVisibilityHandler(req, {
        context,
        request_id: requestId,
        auth_user_id: session.authUserId,
        roleCode: session.roleCode,
      });
    case "GET:/api/communication/configuration":
      return getCommunicationConfigurationBootstrapHandler(req, {
        context, request_id: requestId, auth_user_id: session.authUserId, roleCode: session.roleCode,
      });
    case "GET:/api/communication/rules":
      return getCommunicationRuleHandler(req, {
        context, request_id: requestId, auth_user_id: session.authUserId, roleCode: session.roleCode,
      });
    case "POST:/api/communication/rules/save-draft":
      return saveCommunicationRuleDraftHandler(req, {
        context, request_id: requestId, auth_user_id: session.authUserId, roleCode: session.roleCode,
      });
    case "POST:/api/communication/rules/activate":
      return activateCommunicationRuleHandler(req, {
        context, request_id: requestId, auth_user_id: session.authUserId, roleCode: session.roleCode,
      });
    case "POST:/api/communication/rules/deactivate":
      return deactivateCommunicationRuleHandler(req, {
        context, request_id: requestId, auth_user_id: session.authUserId, roleCode: session.roleCode,
      });
    default:
      return null;
  }
}
