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

type ProjectRow = {
  id: string;
  project_code: string;
  project_name: string;
  status: string | null;
};

type ModuleRow = {
  module_id: string;
  module_code: string;
  module_name: string;
  project_id: string;
  is_active: boolean;
};

type ResourceRow = {
  menu_code: string;
  resource_code: string;
  title: string;
  route_path: string | null;
  description: string | null;
  parent_menu_code: string | null;
  display_order: number | null;
  tree_display_order: number | null;
  is_active: boolean | null;
};

type OwnershipRow = {
  module_code: string;
  resource_code: string;
};

export async function listModuleResourceMapHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const url = new URL(req.url);
    const universe = url.searchParams.get("universe")?.trim().toUpperCase() || "SA";

    const db = getServiceRoleClientWithContext(ctx.context);

    const [
      { data: modules, error: moduleError },
      { data: projects, error: projectError },
      { data: resources, error: resourceError },
      { data: ownershipRows, error: ownershipError },
    ] = await Promise.all([
      db
        .schema("acl")
        .from("module_registry")
        .select("module_id, module_code, module_name, project_id, is_active")
        .order("module_code", { ascending: true }),
      db
        .schema("erp_master")
        .from("projects")
        .select("id, project_code, project_name, status"),
      db
        .schema("erp_menu")
        .from("menu_master")
        .select(
          "menu_code, resource_code, title, route_path, description, parent_menu_code, display_order, tree_display_order, is_active",
        )
        .eq("menu_type", "PAGE")
        .eq("universe", universe)
        .order("title", { ascending: true }),
      db
        .schema("acl")
        .from("module_resource_map")
        .select("module_code, resource_code"),
    ]);

    if (moduleError) {
      return errorResponse("MODULE_LIST_FAILED", moduleError.message, ctx.request_id);
    }

    if (projectError) {
      return errorResponse("PROJECT_LIST_FAILED", projectError.message, ctx.request_id);
    }

    if (resourceError) {
      return errorResponse("RESOURCE_LIST_FAILED", resourceError.message, ctx.request_id);
    }

    if (ownershipError) {
      return errorResponse("MODULE_RESOURCE_MAP_LIST_FAILED", ownershipError.message, ctx.request_id);
    }

    const projectMap = new Map(
      ((projects ?? []) as ProjectRow[]).map((row) => [row.id, row]),
    );
    const moduleMap = new Map(
      ((modules ?? []) as ModuleRow[]).map((row) => [row.module_code, row]),
    );
    const ownershipMap = new Map(
      ((ownershipRows ?? []) as OwnershipRow[]).map((row) => [row.resource_code, row.module_code]),
    );

    const modulePayload = ((modules ?? []) as ModuleRow[]).map((row) => {
      const project = projectMap.get(row.project_id) ?? null;

      return {
        module_id: row.module_id,
        module_code: row.module_code,
        module_name: row.module_name,
        module_active: row.is_active === true,
        project_id: row.project_id,
        project_code: project?.project_code ?? "",
        project_name: project?.project_name ?? "",
        project_status: project?.status ?? null,
      };
    });

    const resourcePayload = ((resources ?? []) as ResourceRow[]).map((row) => {
      const ownerModuleCode = ownershipMap.get(row.resource_code) ?? null;
      const ownerModule = ownerModuleCode ? moduleMap.get(ownerModuleCode) ?? null : null;
      const ownerProject = ownerModule ? projectMap.get(ownerModule.project_id) ?? null : null;

      return {
        menu_code: row.menu_code,
        resource_code: row.resource_code,
        title: row.title,
        route_path: row.route_path ?? "",
        description: row.description ?? null,
        parent_menu_code: row.parent_menu_code ?? "",
        display_order: row.tree_display_order ?? row.display_order ?? null,
        page_active: row.is_active === true,
        owner_module_code: ownerModule?.module_code ?? null,
        owner_module_name: ownerModule?.module_name ?? null,
        owner_module_active: ownerModule?.is_active === true,
        owner_project_code: ownerProject?.project_code ?? null,
        owner_project_name: ownerProject?.project_name ?? null,
      };
    });

    return okResponse(
      {
        universe,
        modules: modulePayload,
        resources: resourcePayload,
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "MODULE_RESOURCE_MAP_LIST_EXCEPTION",
      "module resource map list exception",
      ctx.request_id,
    );
  }
}
