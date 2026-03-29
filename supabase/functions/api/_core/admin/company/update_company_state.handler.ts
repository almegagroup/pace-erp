/*
 * File-ID: ID-6.2A
 * File-Path: supabase/functions/api/_core/admin/company/update_company_state.handler.ts
 * Gate: 6
 * Phase: 6
 * Domain: MASTER
 * Purpose: Change company state (ACTIVE / INACTIVE) in a controlled, SA-only manner
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../../_core/response.ts";
import { log } from "../../../_lib/logger.ts";
import {
  ensureCompanyOperationalWorkContexts,
  setSystemWorkContextsActiveState,
} from "../../../_shared/work_context_governance.ts";

type RequestPayload = {
  company_id: string;
  next_status: "ACTIVE" | "INACTIVE";
};

type HandlerContext = {
  context: ContextResolution;
  request_id: string;
};

function assertAdmin(
  ctx: HandlerContext,
): asserts ctx is {
  context: Extract<ContextResolution, { status: "RESOLVED" }> & { isAdmin: true };
  request_id: string;
} {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function updateCompanyStateHandler(
  req: Request,
  ctx: HandlerContext,
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const body = (await req.json()) as Partial<RequestPayload>;

    if (!body.company_id || !body.next_status) {
      log({
        level: "SECURITY",
        request_id: ctx.request_id,
        gate_id: "6.2A",
        event: "COMPANY_STATE_INVALID_INPUT",
        meta: body,
      });

      return errorResponse(
        "INVALID_INPUT",
        "Invalid request",
        ctx.request_id,
      );
    }

    if (!["ACTIVE", "INACTIVE"].includes(body.next_status)) {
      return errorResponse(
        "INVALID_COMPANY_STATE",
        "Invalid state",
        ctx.request_id,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: company, error: fetchError } = await db
      .schema("erp_master")
      .from("companies")
      .select("id, status")
      .eq("id", body.company_id)
      .single();

    if (fetchError || !company) {
      return errorResponse(
        "COMPANY_NOT_FOUND",
        "Company not found",
        ctx.request_id,
      );
    }

    if (company.status === body.next_status) {
      return okResponse(
        { status: "NO_CHANGE" },
        ctx.request_id,
      );
    }

    const { error: updateError } = await db
      .schema("erp_master")
      .from("companies")
      .update({ status: body.next_status })
      .eq("id", body.company_id);

    if (updateError) {
      log({
        level: "ERROR",
        request_id: ctx.request_id,
        gate_id: "6.2A",
        event: "COMPANY_STATE_UPDATE_FAILED",
        meta: { error: updateError.message },
      });

      return errorResponse(
        "COMPANY_STATE_UPDATE_FAILED",
        "Update failed",
        ctx.request_id,
      );
    }

    if (body.next_status === "ACTIVE") {
      await ensureCompanyOperationalWorkContexts(db, body.company_id);
    }

    await setSystemWorkContextsActiveState(
      db,
      body.company_id,
      body.next_status === "ACTIVE",
    );

    log({
      level: "SECURITY",
      request_id: ctx.request_id,
      gate_id: "6.2A",
      event: "COMPANY_STATE_CHANGED",
      meta: {
        company_id: body.company_id,
        new_status: body.next_status,
      },
    });

    return okResponse(
      {
        company_id: body.company_id,
        new_status: body.next_status,
      },
      ctx.request_id,
    );
  } catch (err) {
    log({
      level: "ERROR",
      request_id: ctx.request_id,
      gate_id: "6.2A",
      event: "COMPANY_STATE_HANDLER_EXCEPTION",
      meta: { error: String(err) },
    });

    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      ctx.request_id,
    );
  }
}
