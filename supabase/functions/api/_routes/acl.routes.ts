/*
 * ACL Route Dispatcher
 */

import { enableCompanyModuleHandler } from "../_core/admin/acl/enable_company_module.handler.ts";
import { disableCompanyModuleHandler } from "../_core/admin/acl/disable_company_module.handler.ts";
import { listCompanyModulesHandler } from "../_core/admin/acl/list_company_modules.handler.ts";

import { listRolePermissionsHandler } from "../_core/admin/acl/list_role_permissions.handler.ts";
import { upsertRolePermissionHandler } from "../_core/admin/acl/upsert_role_permission.handler.ts";
import { disableRolePermissionHandler } from "../_core/admin/acl/disable_role_permission.handler.ts";
import { listCapabilitiesHandler } from "../_core/admin/acl/list_capabilities.handler.ts";
import { upsertCapabilityHandler } from "../_core/admin/acl/upsert_capability.handler.ts";
import { listCapabilityActionsHandler } from "../_core/admin/acl/list_capability_actions.handler.ts";
import { upsertCapabilityActionHandler } from "../_core/admin/acl/upsert_capability_action.handler.ts";
import { disableCapabilityActionHandler } from "../_core/admin/acl/disable_capability_action.handler.ts";
import { listRoleCapabilitiesHandler } from "../_core/admin/acl/list_role_capabilities.handler.ts";
import { assignCapabilityToRoleHandler } from "../_core/admin/acl/assign_capability_to_role.handler.ts";
import { unassignCapabilityFromRoleHandler } from "../_core/admin/acl/unassign_capability_from_role.handler.ts";
import { listUserOverridesHandler } from "../_core/admin/acl/list_user_overrides.handler.ts";
import { upsertUserOverrideHandler } from "../_core/admin/acl/upsert_user_override.handler.ts";
import { revokeUserOverrideHandler } from "../_core/admin/acl/revoke_user_override.handler.ts";
import { listAclVersionsHandler } from "../_core/admin/acl/list_acl_versions.handler.ts";
import { createAclVersionHandler } from "../_core/admin/acl/create_acl_version.handler.ts";
import { activateAclVersionHandler } from "../_core/admin/acl/activate_acl_version.handler.ts";
import { rollbackAclVersionHandler } from "../_core/admin/acl/rollback_acl_version.handler.ts";
import { listWorkContextsHandler } from "../_core/admin/acl/list_work_contexts.handler.ts";
import { upsertWorkContextHandler } from "../_core/admin/acl/upsert_work_context.handler.ts";
import { listWorkContextCapabilitiesHandler } from "../_core/admin/acl/list_work_context_capabilities.handler.ts";
import { assignWorkContextCapabilityHandler } from "../_core/admin/acl/assign_work_context_capability.handler.ts";
import { unassignWorkContextCapabilityHandler } from "../_core/admin/acl/unassign_work_context_capability.handler.ts";

import type { ContextResolution } from "../_pipeline/context.ts";
import type { SessionResolution } from "../_pipeline/session.ts";

export async function dispatchAclRoutes(
  routeKey: string,
  req: Request,
  _requestId: string,
  session: Extract<SessionResolution, { status: "ACTIVE" }>,
  context: Extract<ContextResolution, { status: "RESOLVED" }>
): Promise<Response | null> {

  switch (routeKey) {

    case "POST:/api/admin/acl/company-module/enable":
      return await enableCompanyModuleHandler(req, {
        context,
      });

    case "POST:/api/admin/acl/company-module/disable":
      return await disableCompanyModuleHandler(req, {
        context,
      });

    case "GET:/api/admin/acl/company-modules":
      return await listCompanyModulesHandler(req, {
        context,
      });

    case "GET:/api/admin/acl/role-permissions":
      return await listRolePermissionsHandler(req, {
        context,
      });

    case "POST:/api/admin/acl/role-permissions":
      return await upsertRolePermissionHandler(req, {
        context,
      });

    case "POST:/api/admin/acl/role-permissions/disable":
      return await disableRolePermissionHandler(req, {
        context,
      });

    case "GET:/api/admin/acl/capabilities":
      return await listCapabilitiesHandler(req, {
        context,
      });

    case "POST:/api/admin/acl/capabilities":
      return await upsertCapabilityHandler(req, {
        context,
      });

    case "GET:/api/admin/acl/capability-actions":
      return await listCapabilityActionsHandler(req, {
        context,
      });

    case "POST:/api/admin/acl/capability-actions":
      return await upsertCapabilityActionHandler(req, {
        context,
      });

    case "POST:/api/admin/acl/capability-actions/disable":
      return await disableCapabilityActionHandler(req, {
        context,
      });

    case "GET:/api/admin/acl/role-capabilities":
      return await listRoleCapabilitiesHandler(req, {
        context,
      });

    case "POST:/api/admin/acl/role-capabilities/assign":
      return await assignCapabilityToRoleHandler(req, {
        context,
      });

    case "POST:/api/admin/acl/role-capabilities/unassign":
      return await unassignCapabilityFromRoleHandler(req, {
        context,
      });

    case "GET:/api/admin/acl/user-overrides":
      return await listUserOverridesHandler(req, {
        context,
      });

    case "POST:/api/admin/acl/user-overrides":
      return await upsertUserOverrideHandler(req, {
        context,
        auth_user_id: session.authUserId,
      });

    case "POST:/api/admin/acl/user-overrides/revoke":
      return await revokeUserOverrideHandler(req, {
        context,
        auth_user_id: session.authUserId,
      });

    case "GET:/api/admin/acl/versions":
      return await listAclVersionsHandler(req, {
        context,
      });

    case "POST:/api/admin/acl/versions":
      return await createAclVersionHandler(req, {
        context,
        auth_user_id: session.authUserId,
      });

    case "POST:/api/admin/acl/versions/activate":
      return await activateAclVersionHandler(req, {
        context,
      });

    case "POST:/api/admin/acl/versions/rollback":
      return await rollbackAclVersionHandler(req, {
        context,
      });

    case "GET:/api/admin/acl/work-contexts":
      return await listWorkContextsHandler(req, {
        context,
      });

    case "POST:/api/admin/acl/work-contexts":
      return await upsertWorkContextHandler(req, {
        context,
      });

    case "GET:/api/admin/acl/work-context-capabilities":
      return await listWorkContextCapabilitiesHandler(req, {
        context,
      });

    case "POST:/api/admin/acl/work-context-capabilities/assign":
      return await assignWorkContextCapabilityHandler(req, {
        context,
      });

    case "POST:/api/admin/acl/work-context-capabilities/unassign":
      return await unassignWorkContextCapabilityHandler(req, {
        context,
      });

    default:
      return null;
  }
}
