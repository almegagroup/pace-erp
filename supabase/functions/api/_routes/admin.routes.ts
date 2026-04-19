/*
 * Admin Route Dispatcher
 */
import { meHandler } from "../_core/auth/me.handler.ts";
import {
  meContextHandler,
  updateMeContextHandler,
} from "../_core/auth/me_context.handler.ts";
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
import { deleteGroupHandler } from "../_core/admin/group/delete_group.handler.ts";
import { updateGroupStateHandler } from "../_core/admin/group/update_group_state.handler.ts";
import { updateGroupHandler } from "../_core/admin/group/update_group.handler.ts";
import { mapCompanyToGroupHandler } from "../_core/admin/group/map_company_to_group.handler.ts";
import { unmapCompanyFromGroupHandler } from "../_core/admin/group/unmap_company_group.handler.ts";
import { listGroupsHandler } from "../_core/admin/group/list_groups.handler.ts";

import { createProjectHandler } from "../_core/admin/project/create_project.handler.ts";
import { listProjectsHandler } from "../_core/admin/project/list_projects.handler.ts";
import { updateProjectStateHandler } from "../_core/admin/project/update_project_state.handler.ts";
import { listProjectCompanyMapHandler } from "../_core/admin/project/list_project_company_map.handler.ts";
import { mapCompanyToProjectHandler } from "../_core/admin/project/map_company_to_project.handler.ts";
import { unmapCompanyProjectHandler } from "../_core/admin/project/unmap_company_project.handler.ts";
import { createModuleHandler } from "../_core/admin/module/create_module.handler.ts";
import { listModulesHandler } from "../_core/admin/module/list_modules.handler.ts";
import { listModuleResourceMapHandler } from "../_core/admin/module/list_module_resource_map.handler.ts";
import { removeModuleResourceMapHandler } from "../_core/admin/module/remove_module_resource_map.handler.ts";
import { updateModuleStateHandler } from "../_core/admin/module/update_module_state.handler.ts";
import { updateModuleHandler } from "../_core/admin/module/update_module.handler.ts";
import { upsertModuleResourceMapHandler } from "../_core/admin/module/upsert_module_resource_map.handler.ts";

import { createDepartmentHandler } from "../_core/admin/department/create_department.handler.ts";
import { listDepartmentsHandler } from "../_core/admin/department/list_departments.handler.ts";
import { updateDepartmentStateHandler } from "../_core/admin/department/update_department_state.handler.ts";
import { listApproverRulesHandler } from "../_core/admin/approval/list_approver_rules.handler.ts";
import { upsertApproverRuleHandler } from "../_core/admin/approval/upsert_approver_rule.handler.ts";
import { deleteApproverRuleHandler } from "../_core/admin/approval/delete_approver_rule.handler.ts";
import { listApprovalWorkspaceHandler } from "../_core/admin/approval/approval_workspace.handler.ts";
import { listReportVisibilityWorkspaceHandler } from "../_core/admin/approval/report_visibility_workspace.handler.ts";
import { listReportViewerRulesHandler } from "../_core/admin/approval/list_report_viewer_rules.handler.ts";
import { upsertReportViewerRuleHandler } from "../_core/admin/approval/upsert_report_viewer_rule.handler.ts";
import { deleteReportViewerRuleHandler } from "../_core/admin/approval/delete_report_viewer_rule.handler.ts";
import { listResourceApprovalPolicyHandler } from "../_core/admin/approval/list_resource_approval_policy.handler.ts";
import { upsertResourceApprovalPolicyHandler } from "../_core/admin/approval/upsert_resource_approval_policy.handler.ts";

import { listUsersHandler } from "../_core/admin/user/list_users.handler.ts";
import { listUserScopeReportHandler } from "../_core/admin/user/list_user_scope_report.handler.ts";
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
import { listCapabilitiesHandler } from "../_core/admin/acl/list_capabilities.handler.ts";
import { upsertCapabilityHandler } from "../_core/admin/acl/upsert_capability.handler.ts";
import { listCapabilityActionsHandler } from "../_core/admin/acl/list_capability_actions.handler.ts";
import { upsertCapabilityActionHandler } from "../_core/admin/acl/upsert_capability_action.handler.ts";
import { disableCapabilityActionHandler } from "../_core/admin/acl/disable_capability_action.handler.ts";
import { listWorkContextsHandler } from "../_core/admin/acl/list_work_contexts.handler.ts";
import { upsertWorkContextHandler } from "../_core/admin/acl/upsert_work_context.handler.ts";
import { listWorkContextCapabilitiesHandler } from "../_core/admin/acl/list_work_context_capabilities.handler.ts";
import { assignWorkContextCapabilityHandler } from "../_core/admin/acl/assign_work_context_capability.handler.ts";
import { unassignWorkContextCapabilityHandler } from "../_core/admin/acl/unassign_work_context_capability.handler.ts";
import { listWorkContextProjectsHandler } from "../_core/admin/acl/list_work_context_projects.handler.ts";
import { syncWorkContextProjectsHandler } from "../_core/admin/acl/sync_work_context_projects.handler.ts";
import { listGovernanceSummaryReportHandler } from "../_core/admin/acl/list_governance_summary_report.handler.ts";
import { listAclVersionsHandler } from "../_core/admin/acl/list_acl_versions.handler.ts";
import { listAclVersionCenterStatusHandler } from "../_core/admin/acl/list_acl_version_center_status.handler.ts";
import { createAclVersionHandler } from "../_core/admin/acl/create_acl_version.handler.ts";
import { activateAclVersionHandler } from "../_core/admin/acl/activate_acl_version.handler.ts";
import { deleteAclVersionHandler } from "../_core/admin/acl/delete_acl_version.handler.ts";

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

    case "GET:/api/me/context":
      response = await meContextHandler({
        session,
        requestId,
        req,
      });
      break;

    case "POST:/api/me/context":
      response = await updateMeContextHandler({
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

    case "PATCH:/api/admin/group":
      response = await updateGroupHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "DELETE:/api/admin/group":
      response = await deleteGroupHandler(req, {
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

    case "GET:/api/admin/project/company-map":
      response = await listProjectCompanyMapHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "POST:/api/admin/project/map-company":
      response = await mapCompanyToProjectHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "POST:/api/admin/project/unmap-company":
      response = await unmapCompanyProjectHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "POST:/api/admin/module":
      response = await createModuleHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "POST:/api/admin/module/update":
      response = await updateModuleHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "GET:/api/admin/modules":
      response = await listModulesHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "GET:/api/admin/module-resource-map":
      response = await listModuleResourceMapHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "POST:/api/admin/module-resource-map":
      response = await upsertModuleResourceMapHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "POST:/api/admin/module-resource-map/remove":
      response = await removeModuleResourceMapHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "POST:/api/admin/module/state":
      response = await updateModuleStateHandler(req, {
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

    case "POST:/api/admin/department/state":
      response = await updateDepartmentStateHandler(req, {
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

    case "GET:/api/admin/approval/workspace":
      response = await listApprovalWorkspaceHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "GET:/api/admin/report-visibility/workspace":
      response = await listReportVisibilityWorkspaceHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "GET:/api/admin/approval/resource-policy":
      response = await listResourceApprovalPolicyHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "POST:/api/admin/approval/resource-policy":
      response = await upsertResourceApprovalPolicyHandler(req, {
        context,
        request_id: requestId,
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

    case "GET:/api/admin/approval/viewers":
      response = await listReportViewerRulesHandler(req, {
        context,
        session: {
          authUserId: session.authUserId,
          roleCode: context.roleCode,
        },
      });
      break;

    case "POST:/api/admin/approval/viewers":
      response = await upsertReportViewerRuleHandler(req, {
        context,
        session: {
          authUserId: session.authUserId,
          roleCode: context.roleCode,
        },
      });
      break;

    case "POST:/api/admin/approval/viewers/delete":
      response = await deleteReportViewerRuleHandler(req, {
        context,
        session: {
          authUserId: session.authUserId,
          roleCode: context.roleCode,
        },
      });
      break;

    case "GET:/api/admin/acl/capabilities":
      response = await listCapabilitiesHandler(req, {
        context,
      });
      break;

    case "POST:/api/admin/acl/capabilities":
      response = await upsertCapabilityHandler(req, {
        context,
      });
      break;

    case "GET:/api/admin/acl/capability-actions":
      response = await listCapabilityActionsHandler(req, {
        context,
      });
      break;

    case "POST:/api/admin/acl/capability-actions":
      response = await upsertCapabilityActionHandler(req, {
        context,
      });
      break;

    case "POST:/api/admin/acl/capability-actions/disable":
      response = await disableCapabilityActionHandler(req, {
        context,
      });
      break;

    case "GET:/api/admin/acl/work-contexts":
      response = await listWorkContextsHandler(req, {
        context,
      });
      break;

    case "POST:/api/admin/acl/work-contexts":
      response = await upsertWorkContextHandler(req, {
        context,
      });
      break;

    case "GET:/api/admin/acl/work-context-capabilities":
      response = await listWorkContextCapabilitiesHandler(req, {
        context,
      });
      break;

    case "POST:/api/admin/acl/work-context-capabilities/assign":
      response = await assignWorkContextCapabilityHandler(req, {
        context,
      });
      break;

    case "POST:/api/admin/acl/work-context-capabilities/unassign":
      response = await unassignWorkContextCapabilityHandler(req, {
        context,
      });
      break;

    case "GET:/api/admin/acl/work-context-projects":
      response = await listWorkContextProjectsHandler(req, {
        context,
      });
      break;

    case "POST:/api/admin/acl/work-context-projects":
      response = await syncWorkContextProjectsHandler(req, {
        context,
      });
      break;

    case "GET:/api/admin/acl/governance-summary-report":
      response = await listGovernanceSummaryReportHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "GET:/api/admin/acl/versions":
      response = await listAclVersionsHandler(req, {
        context,
      });
      break;

    case "GET:/api/admin/acl/version-center":
      response = await listAclVersionCenterStatusHandler(req, {
        context,
      });
      break;

    case "POST:/api/admin/acl/versions":
      response = await createAclVersionHandler(req, {
        context,
        auth_user_id: session.authUserId,
      });
      break;

    case "POST:/api/admin/acl/versions/activate":
      response = await activateAclVersionHandler(req, {
        context,
      });
      break;

    case "POST:/api/admin/acl/versions/delete":
      response = await deleteAclVersionHandler(req, {
        context,
      });
      break;

    case "GET:/api/admin/users":
      response = await listUsersHandler(req, {
        context,
        request_id: requestId,
      });
      break;

    case "GET:/api/admin/users/report":
      response = await listUserScopeReportHandler(req, {
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
