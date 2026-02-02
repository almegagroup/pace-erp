/*
 * File-ID: ID-6.2A
 * File-Path: supabase/functions/api/_core/admin/company/update_company_state.handler.ts
 * Gate: 6
 * Phase: 6
 * Domain: MASTER
 * Purpose: Change company state (ACTIVE / INACTIVE) in a controlled, SA-only manner
 * Authority: Backend
 */

import {
  getServiceRoleClientWithContext,
  assertServiceRole,
} from "../../../_shared/serviceRoleClient.ts";

import type { ContextResolution } from "../../../_pipeline/context.ts";

import {
  okResponse,
  errorResponse,
} from "../../response.ts";

import { log } from "../../../_lib/logger.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

type RequestPayload = {
  company_id: string;
  next_status: "ACTIVE" | "INACTIVE";
};

export async function handler(
  req: Request,
  ctx: { context: ContextResolution }
): Promise<Response> {
  // 🔒 No assumption about pipeline headers
  const requestId = generateRequestId();

  try {
    /* --------------------------------------------------
     * 1️⃣ Authority assertion (SA / service-role only)
     * -------------------------------------------------- */
    assertServiceRole();

    /* --------------------------------------------------
     * 2️⃣ Parse + validate payload
     * -------------------------------------------------- */
    const body = (await req.json()) as Partial<RequestPayload>;

    if (!body.company_id || !body.next_status) {
      log({
        level: "SECURITY",
        request_id: requestId,
        gate: "6.2A",
        event: "COMPANY_STATE_INVALID_INPUT",
        meta: body,
      });

      return errorResponse(
        "INVALID_INPUT",
        "Invalid request",
        requestId
      );
    }

    if (!["ACTIVE", "INACTIVE"].includes(body.next_status)) {
      return errorResponse(
        "INVALID_COMPANY_STATE",
        "Invalid state",
        requestId
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    /* --------------------------------------------------
     * 3️⃣ Fetch current company
     * -------------------------------------------------- */
    const { data: company, error: fetchError } = await db
      .from("erp_master.companies")
      .select("id, status")
      .eq("id", body.company_id)
      .single();

    if (fetchError || !company) {
      return errorResponse(
        "COMPANY_NOT_FOUND",
        "Company not found",
        requestId
      );
    }

    /* --------------------------------------------------
     * 4️⃣ No-op guard (idempotent)
     * -------------------------------------------------- */
    if (company.status === body.next_status) {
      return okResponse(
        { status: "NO_CHANGE" },
        requestId
      );
    }

    /* --------------------------------------------------
     * 5️⃣ Update state
     * -------------------------------------------------- */
    const { error: updateError } = await db
      .from("erp_master.companies")
      .update({ status: body.next_status })
      .eq("id", body.company_id);

    if (updateError) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate: "6.2A",
        event: "COMPANY_STATE_UPDATE_FAILED",
        meta: { error: updateError.message },
      });

      return errorResponse(
        "COMPANY_STATE_UPDATE_FAILED",
        "Update failed",
        requestId
      );
    }

    /* --------------------------------------------------
     * 6️⃣ Audit log + success
     * -------------------------------------------------- */
    log({
      level: "SECURITY",
      request_id: requestId,
      gate: "6.2A",
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
      requestId
    );
  } catch (err) {
    log({
      level: "ERROR",
      request_id: requestId,
      gate: "6.2A",
      event: "COMPANY_STATE_HANDLER_EXCEPTION",
      meta: { error: String(err) },
    });

    return errorResponse(
      "REQUEST_BLOCKED",
      "Unhandled error",
      requestId
    );
  }
}
