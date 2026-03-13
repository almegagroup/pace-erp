/*
 * File-ID: 9.3-H2
 * File-Path: supabase/functions/api/_core/admin/group/update_group_state.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: Activate / Inactivate Group (SA-only)
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../../_core/response.ts";

// --------------------------------------------------
// Admin guard
// --------------------------------------------------
function assertAdmin(ctx: { context: ContextResolution }): void {
  if (
    ctx.context.status !== "RESOLVED" ||
    ctx.context.isAdmin !== true
  ) {
    throw new Error("ADMIN_ONLY");
  }
}

// --------------------------------------------------
// Input contract
// --------------------------------------------------
type UpdateGroupStateInput = {
  group_id?: number;
 next_status?: "ACTIVE" | "INACTIVE";
};

// --------------------------------------------------
// Handler
// --------------------------------------------------
export async function updateGroupStateHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string }
): Promise<Response> {
  try {
    // 1️⃣ Admin guard
    assertAdmin(ctx);

    // 2️⃣ Parse + validate input
    const body = (await req.json()) as UpdateGroupStateInput;

    if (
      !body.group_id ||
      !body.next_status ||
  !["ACTIVE", "INACTIVE"].includes(body.next_status)
    ) {
      return errorResponse(
        "INVALID_INPUT",
        "invalid group state input",
        ctx.request_id
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    // 3️⃣ Fetch current group
    const { data: group, error: fetchError } = await db
      .schema("erp_master").from("groups")
      .select("id, state")
      .eq("id", body.group_id)
      .single();

    if (fetchError || !group) {
      return errorResponse(
        "GROUP_NOT_FOUND",
        "group not found",
        ctx.request_id
      );
    }

    // 4️⃣ No-op guard
    if (group.state === body.next_status) {
      return okResponse(
        {
          group_id: group.id,
          state: group.state,
          status: "NO_CHANGE",
        },
        ctx.request_id
      );
    }

    // 5️⃣ Update state
    const { error: updateError } = await db
      .schema("erp_master").from("groups")
      .update({ state: body.next_status })
      .eq("id", body.group_id);

    if (updateError) {
      return errorResponse(
        "GROUP_STATE_UPDATE_FAILED",
        "group state update failed",
        ctx.request_id
      );
    }

    // 6️⃣ Success
    return okResponse(
      {
        group_id: body.group_id,
        state: body.next_status,
      },
      ctx.request_id
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "GROUP_STATE_UPDATE_EXCEPTION",
      "group state update exception",
      ctx.request_id
    );
  }
}
