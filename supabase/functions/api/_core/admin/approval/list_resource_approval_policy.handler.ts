import type { ContextResolution } from "../../../_pipeline/context.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../../../_core/response.ts";

function assertAdmin(
  ctx: { context: ContextResolution },
): asserts ctx is {
  context: Extract<ContextResolution, { status: "RESOLVED" }> & {
    isAdmin: true;
  };
} {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

const DEFAULT_ACTIONS = Object.freeze(["VIEW", "WRITE", "EDIT", "DELETE", "APPROVE", "EXPORT"]);

function deriveAvailableActions(resourceCode: string) {
  if (resourceCode.endsWith("_APPLY")) {
    return ["VIEW", "WRITE"];
  }
  if (resourceCode.includes("_MY_REQUESTS")) {
    return ["VIEW", "EDIT"];
  }
  if (resourceCode.includes("_APPROVAL_INBOX")) {
    return ["VIEW", "APPROVE"];
  }
  if (resourceCode.includes("_APPROVAL_SCOPE_HISTORY")) {
    return ["VIEW"];
  }
  if (resourceCode.endsWith("_REGISTER")) {
    return ["VIEW", "EXPORT"];
  }

  return [...DEFAULT_ACTIONS];
}

type ResourceMapRow = {
  resource_code: string;
  module_code: string;
};

type ModuleRow = {
  module_code: string;
  module_name: string;
  project_id: string;
  is_active: boolean;
};

type ProjectRow = {
  id: string;
  project_code: string;
  project_name: string;
};

type MenuRow = {
  menu_code: string;
  title: string;
  resource_code: string;
  route_path: string | null;
  is_active: boolean;
};

type PolicyRow = {
  resource_code: string;
  action_code: string;
  approval_required: boolean;
  approval_type: string | null;
  min_approvers: number;
  max_approvers: number;
};

export async function listResourceApprovalPolicyHandler(
  _req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const db = getServiceRoleClientWithContext(ctx.context);

    const [
      { data: resourceMapRows, error: resourceMapError },
      { data: moduleRows, error: moduleError },
      { data: projectRows, error: projectError },
    ] = await Promise.all([
      db
        .schema("acl")
        .from("module_resource_map")
        .select("resource_code, module_code"),
      db
        .schema("acl")
        .from("module_registry")
        .select("module_code, module_name, project_id, is_active"),
      db
        .schema("erp_master")
        .from("projects")
        .select("id, project_code, project_name"),
    ]);

    if (resourceMapError) {
      return errorResponse("RESOURCE_MAP_LIST_FAILED", resourceMapError.message, ctx.request_id);
    }
    if (moduleError) {
      return errorResponse("MODULE_LIST_FAILED", moduleError.message, ctx.request_id);
    }
    if (projectError) {
      return errorResponse("PROJECT_LIST_FAILED", projectError.message, ctx.request_id);
    }

    const resourceCodes = [...new Set(((resourceMapRows ?? []) as ResourceMapRow[]).map((row) => row.resource_code))];

    if (resourceCodes.length === 0) {
      return okResponse({ resources: [] }, ctx.request_id);
    }

    const [{ data: menuRows, error: menuError }, { data: policyRows, error: policyError }] =
      await Promise.all([
        db
          .schema("erp_menu")
          .from("menu_master")
          .select("menu_code, title, resource_code, route_path, is_active")
          .in("resource_code", resourceCodes),
        db
          .schema("acl")
          .from("resource_approval_policy")
          .select("resource_code, action_code, approval_required, approval_type, min_approvers, max_approvers")
          .in("resource_code", resourceCodes),
      ]);

    if (menuError) {
      return errorResponse("MENU_RESOURCE_LIST_FAILED", menuError.message, ctx.request_id);
    }
    if (policyError) {
      return errorResponse("RESOURCE_POLICY_LIST_FAILED", policyError.message, ctx.request_id);
    }

    const moduleMap = new Map(((moduleRows ?? []) as ModuleRow[]).map((row) => [row.module_code, row]));
    const projectMap = new Map(((projectRows ?? []) as ProjectRow[]).map((row) => [row.id, row]));
    const menuMap = new Map(((menuRows ?? []) as MenuRow[]).map((row) => [row.resource_code, row]));
    const policyMap = new Map<string, PolicyRow[]>();

    for (const row of (policyRows ?? []) as PolicyRow[]) {
      const current = policyMap.get(row.resource_code) ?? [];
      current.push(row);
      policyMap.set(row.resource_code, current);
    }

    const resources = ((resourceMapRows ?? []) as ResourceMapRow[])
      .map((row) => {
        const moduleRow = moduleMap.get(row.module_code) ?? null;
        const projectRow = moduleRow ? projectMap.get(moduleRow.project_id) ?? null : null;
        const menuRow = menuMap.get(row.resource_code) ?? null;

        return {
          resource_code: row.resource_code,
          title: menuRow?.title ?? row.resource_code,
          route_path: menuRow?.route_path ?? null,
          menu_code: menuRow?.menu_code ?? null,
          menu_active: menuRow?.is_active ?? false,
          module_code: row.module_code,
          module_name: moduleRow?.module_name ?? row.module_code,
          module_active: moduleRow?.is_active ?? false,
          project_code: projectRow?.project_code ?? null,
          project_name: projectRow?.project_name ?? null,
          available_actions: deriveAvailableActions(row.resource_code),
          policies: (policyMap.get(row.resource_code) ?? []).sort((left, right) =>
            left.action_code.localeCompare(right.action_code, "en", { sensitivity: "base" })),
        };
      })
      .sort((left, right) =>
        `${left.project_code ?? ""} ${left.module_code} ${left.title}`.localeCompare(
          `${right.project_code ?? ""} ${right.module_code} ${right.title}`,
          "en",
          { numeric: true, sensitivity: "base" },
        ));

    return okResponse({ resources }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "RESOURCE_POLICY_LIST_EXCEPTION",
      "resource approval policy list exception",
      ctx.request_id,
    );
  }
}
