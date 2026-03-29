/*
 * Admin Route Dispatcher
 */
import { meHandler } from "../_core/auth/me.handler.ts";
import { meProfileHandler } from "../_core/auth/me_profile.handler.ts";
import { unlockHandler } from "../_core/auth/unlock.handler.ts";
import { listPendingSignupHandler } from "../_core/admin/signup/list_pending.handler.ts";
import { approveSignupHandler } from "../_core/admin/signup/approve.handler.ts";
import { rejectSignupHandler } from "../_core/admin/signup/reject.handler.ts";

import { createCompanyHandler } from "../_core/admin/company/create_company.handler.ts";
import { getCompanyGstProfileHandler } from "../_core/admin/company/get_company_gst_profile.handler.ts";
import { listCompaniesHandler } from "../_core/admin/company/list_companies.handler.ts";
import { updateCompanyStateHandler } from "../_core/admin/company/update_company_state.handler.ts";

import { createGroupHandler } from "../_core/admin/group/create_group.handler.ts";
import { updateGroupStateHandler } from "../_core/admin/group/update_group_state.handler.ts";
import { mapCompanyToGroupHandler } from "../_core/admin/group/map_company_to_group.handler.ts";
import { unmapCompanyFromGroupHandler } from "../_core/admin/group/unmap_company_group.handler.ts";
import { listGroupsHandler } from "../_core/admin/group/list_groups.handler.ts";

import { createProjectHandler } from "../_core/admin/project/create_project.handler.ts";
import { listProjectsHandler } from "../_core/admin/project/list_projects.handler.ts";
import { updateProjectStateHandler } from "../_core/admin/project/update_project_state.handler.ts";

import { createDepartmentHandler } from "../_core/admin/department/create_department.handler.ts";
import { listDepartmentsHandler } from "../_core/admin/department/list_departments.handler.ts";
import { listApproverRulesHandler } from "../_core/admin/approval/list_approver_rules.handler.ts";
import { upsertApproverRuleHandler } from "../_core/admin/approval/upsert_approver_rule.handler.ts";
import { deleteApproverRuleHandler } from "../_core/admin/approval/delete_approver_rule.handler.ts";

import { listUsersHandler } from "../_core/admin/user/list_users.handler.ts";
import { getUserScopeHandler } from "../_core/admin/user/get_user_scope.handler.ts";
import { updateUserScopeHandler } from "../_core/admin/user/update_user_scope.handler.ts";
import { updateUserStateHandler } from "../_core/admin/user/update_user_state.handler.ts";
import { updateUserRoleHandler } from "../_core/admin/user/update_user_role.handler.ts";

import { listAuditLogsHandler } from "../_core/admin/audit/list_audit_logs.handler.ts";
import { logAdminAction } from "../_core/audit/log_admin_action.ts";
import { listSessionsHandler } from "../_core/admin/session/list_sessions.handler.ts";
import { revokeSessionHandler } from "../_core/admin/session/revoke_session.handler.ts";
import { systemHealthHandler } from "../_core/admin/diagnostics/system_health.handler.ts";
import { controlPanelHandler } from "../_core/admin/diagnostics/control_panel.handler.ts";

import type { SessionResolution } from "../_pipeline/session.ts";
import type { ContextResolution } from "../_pipeline/context.ts";

export async function dispatchAdminRoutes(
  routeKey: string,
  req: Request,
  requestId: string,
  session: Extract<SessionResolution, { status: "ACTIVE" }>,
  context: Extract<ContextResolution, { status: "RESOLVED" }>
): Promise<Response | null> {

  let response: Response | null = null;

  switch (routeKey) {

    case "GET:/api/me":
  response = meHandler({
    session,
    requestId,
    req,
  });
  break;

    case "GET:/api/me/profile":
      response = await meProfileHandler({
        session,
        requestId,
        req,
      });
      break;

    case "POST:/api/unlock":
      response = await unlockHandler({
        session,
        requestId,
        req,
        body: await req.json(),
      });
      break;
  
    case "GET:/api/admin/signup-requests":
      response = await listPendingSignupHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "POST:/api/admin/signup-requests/approve":
      response = await approveSignupHandler(req, {
        context,
        request_id: requestId,
        auth_user_id: session.authUserId,
      });
      break;

    case "POST:/api/admin/signup-requests/reject":
      response = await rejectSignupHandler(req, {
        context,
        request_id: requestId,
        auth_user_id: session.authUserId,
      });
      break;

    case "POST:/api/admin/company":
      response = await createCompanyHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "GET:/api/admin/companies":
      response = await listCompaniesHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "GET:/api/admin/company/gst-profile":
      response = await getCompanyGstProfileHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "POST:/api/admin/company/state":
      response = await updateCompanyStateHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "POST:/api/admin/group":
      response = await createGroupHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "GET:/api/admin/groups":
      response = await listGroupsHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "POST:/api/admin/group/state":
      response = await updateGroupStateHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "POST:/api/admin/group/map-company":
      response = await mapCompanyToGroupHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "POST:/api/admin/company-group/unmap":
      response = await unmapCompanyFromGroupHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "POST:/api/admin/project":
      response = await createProjectHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "GET:/api/admin/projects":
      response = await listProjectsHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "POST:/api/admin/project/state":
      response = await updateProjectStateHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "POST:/api/admin/department":
      response = await createDepartmentHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "GET:/api/admin/departments":
      response = await listDepartmentsHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "GET:/api/admin/approval/approvers":
      response = await listApproverRulesHandler(req, {
        context,
        session: {
          authUserId: session.authUserId,
          roleCode: context.roleCode,
        },
      });
      break;

    case "POST:/api/admin/approval/approvers":
      response = await upsertApproverRuleHandler(req, {
        context,
        session: {
          authUserId: session.authUserId,
          roleCode: context.roleCode,
        },
      });
      break;

    case "POST:/api/admin/approval/approvers/delete":
      response = await deleteApproverRuleHandler(req, {
        context,
        session: {
          authUserId: session.authUserId,
          roleCode: context.roleCode,
        },
      });
      break;

    case "GET:/api/admin/users":
      response = await listUsersHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "GET:/api/admin/users/scope":
      response = await getUserScopeHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "POST:/api/admin/users/scope":
      response = await updateUserScopeHandler(req, {
        context,
        request_id: requestId,
        auth_user_id: session.authUserId,
      });
      break;

    case "POST:/api/admin/users/state":
      response = await updateUserStateHandler(req, {
        context,
        request_id: requestId,
        auth_user_id: session.authUserId,
        roleCode: context.roleCode,
      });
      break;

    case "POST:/api/admin/users/role":
      response = await updateUserRoleHandler(req, {
        context,
        request_id: requestId,
        auth_user_id: session.authUserId,
        roleCode: context.roleCode,
      });
      break;

    case "GET:/api/admin/audit":
      response = await listAuditLogsHandler(req, {
        context,
        request_id: requestId,
      });
      break;
    
    case "GET:/api/admin/sessions":
  response = await listSessionsHandler(req, {
    context,
    request_id: requestId,
  });
  break;

case "POST:/api/admin/sessions/revoke":
  response = await revokeSessionHandler(req, {
    context,
    request_id: requestId,
  });
  break;

case "GET:/api/admin/system-health":
  response = await systemHealthHandler(req, {
    context,
    request_id: requestId,
  });
  break;

case "GET:/api/admin/control-panel":
  response = await controlPanelHandler(req, {
    context,
    request_id: requestId,
  });
  break;

    default:
      return null;
  }

  if (!response) {
    return null;
  }

  /* ------------------------------------------
   * Admin Audit Logging (ID-9.14)
   * ------------------------------------------ */

  await logAdminAction(
    {
      context,
      request_id: requestId,
      auth_user_id: session.authUserId
    },
    routeKey,
    "ADMIN_ROUTE",
    null,
    response.status < 400 ? "SUCCESS" : "FAILED",
    { route: routeKey }
  );

  return response;
}
