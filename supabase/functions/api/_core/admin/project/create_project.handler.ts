/*

* File-ID: 9.4
* File-Path: supabase/functions/api/_core/admin/project/create_project.handler.ts
* Gate: 9
* Phase: 9
* Domain: MASTER
* Purpose: Create a project and map it to a company (Admin Universe only)
* Authority: Backend
  */

import type { ContextResolution } from "../../../_pipeline/context.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../../../_core/response.ts";

/* --------------------------------------------------

* Admin guard (canonical pattern)
* -------------------------------------------------- */
  function assertAdmin(
  ctx: { context: ContextResolution }
  ): asserts ctx is {
  context: Extract<ContextResolution, { status: "RESOLVED" }> & {
  isAdmin: true;
  };
  } {
  if (
  ctx.context.status !== "RESOLVED" ||
  ctx.context.isAdmin !== true
  ) {
  throw new Error("ADMIN_ONLY");
  }
  }

/* --------------------------------------------------

* Input contract
* -------------------------------------------------- */
  type CreateProjectInput = {
  project_name?: string;
  };

/* --------------------------------------------------

* Handler
* -------------------------------------------------- */
  export async function createProjectHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string }
  ): Promise<Response> {
  try {
  // 1️⃣ Admin-only
  assertAdmin(ctx);

  // 2️⃣ Parse input
  const body = (await req.json()) as CreateProjectInput;
  const projectName = body.project_name?.trim();

  if (!projectName || projectName.length < 3) {
  return errorResponse(
  "PROJECT_NAME_REQUIRED",
  "project name required",
  ctx.request_id
  );
  }

  // 3️⃣ Prepare DB client
  const db = getServiceRoleClientWithContext(ctx.context);

  // 4️⃣ Create global project
  const { data, error } = await db
  .from("erp_master.projects")
  .insert({
  project_name: projectName,
  status: "ACTIVE",
  })
  .select("id, project_code, project_name, status")
  .single();

  if (error || !data) {
  return errorResponse(
  "PROJECT_CREATE_FAILED",
  "project create failed",
  ctx.request_id
  );
  }

  // 5️⃣ Map project → company
  const { error: mapError } = await db
  .from("erp_map.company_projects")
  .insert({
  company_id: ctx.context.companyId,
  project_id: data.id,
  });

  if (mapError) {
  return errorResponse(
  "PROJECT_COMPANY_MAPPING_FAILED",
  "project company mapping failed",
  ctx.request_id
  );
  }

  // 6️⃣ Success
  return okResponse(
  {
  project: {
  id: data.id,
  project_code: data.project_code,
  project_name: data.project_name,
  status: data.status,
  },
  },
  ctx.request_id
  );
  } catch (err) {
  return errorResponse(
  (err as Error).message || "PROJECT_CREATE_EXCEPTION",
  "project create exception",
  ctx.request_id
  );
  }
  }
