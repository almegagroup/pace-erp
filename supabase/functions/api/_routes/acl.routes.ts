/*
 * ACL Route Dispatcher
 */

import { enableCompanyModuleHandler } from "../_core/admin/acl/enable_company_module.handler.ts";
import { disableCompanyModuleHandler } from "../_core/admin/acl/disable_company_module.handler.ts";
import { listCompanyModulesHandler } from "../_core/admin/acl/list_company_modules.handler.ts";

import { listRolePermissionsHandler } from "../_core/admin/acl/list_role_permissions.handler.ts";
import { upsertRolePermissionHandler } from "../_core/admin/acl/upsert_role_permission.handler.ts";
import { disableRolePermissionHandler } from "../_core/admin/acl/disable_role_permission.handler.ts";

import type { ContextResolution } from "../_pipeline/context.ts";

export async function dispatchAclRoutes(
  routeKey: string,
  req: Request,
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

    default:
      return null;
  }
}