/*
 * File-ID: 9.4A
 * File-Path: supabase/functions/api/_core/admin/project/update_project_state.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: Controlled project state transitions (Admin Universe only)
 * Authority: Backend
 */

import type { ContextResolution } from "../../../_pipeline/context.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../../../_core/response.ts";

/* --------------------------------------------------
 * Admin guard (type-narrowing, canonical)
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
 * Allowed state transitions (LOCKED)
 * -------------------------------------------------- */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  ACTIVE: ["INACTIVE"],
  INACTIVE: ["ACTIVE"],
};

/* --------------------------------------------------
 * Input contract
 * -------------------------------------------------- */
type UpdateProjectStateInput = {
  project_id?: string;
  next_state?: "ACTIVE" | "INACTIVE";
};

/* --------------------------------------------------
 * Handler
 * -------------------------------------------------- */
export async function updateProjectStateHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string }
): Promise<Response> {
  try {
    // 1️⃣ Admin-only
    assertAdmin(ctx);

    // 2️⃣ Parse input
    const body = (await req.json()) as UpdateProjectStateInput;

    const projectId = body.project_id;
    const nextState = body.next_state;

    if (!projectId || !nextState) {
      return errorResponse(
        "PROJECT_STATE_INPUT_INVALID",
        "project state input invalid",
        ctx.request_id
      );
    }

    // 3️⃣ DB client
    const db = getServiceRoleClientWithContext(ctx.context);

    // 4️⃣ Verify project belongs to this company
    const { data: mapping, error: mapError } = await db
      .from("erp_map.company_projects")
      .select("project_id")
      .eq("project_id", projectId)
      .eq("company_id", ctx.context.companyId)
      .maybeSingle();

    if (mapError || !mapping) {
      return errorResponse(
        "PROJECT_NOT_FOUND",
        "project not found",
        ctx.request_id
      );
    }

    // 5️⃣ Load current project state
    const { data: project, error: fetchError } = await db
      .from("erp_master.projects")
      .select("status")
      .eq("id", projectId)
      .maybeSingle();

    if (fetchError || !project) {
      return errorResponse(
        "PROJECT_NOT_FOUND",
        "project not found",
        ctx.request_id
      );
    }

    const currentState = project.status;

    // 6️⃣ Validate transition
    const allowed = ALLOWED_TRANSITIONS[currentState] ?? [];
    if (!allowed.includes(nextState)) {
      return errorResponse(
        "PROJECT_STATE_TRANSITION_INVALID",
        "invalid project state transition",
        ctx.request_id
      );
    }

    // 7️⃣ Update state
    const { error: updateError } = await db
      .from("erp_master.projects")
      .update({ status: nextState })
      .eq("id", projectId);

    if (updateError) {
      return errorResponse(
        "PROJECT_STATE_UPDATE_FAILED",
        "project state update failed",
        ctx.request_id
      );
    }

    // 8️⃣ Success
    return okResponse(
      {
        project_id: projectId,
        previous_state: currentState,
        current_state: nextState,
      },
      ctx.request_id
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "PROJECT_STATE_UPDATE_EXCEPTION",
      "project state update exception",
      ctx.request_id
    );
  }
}