/*
 * File-ID: ID-9.11A
 * File-Path: supabase/functions/api/_core/admin/acl/list_acl_versions.handler.ts
 * gate_id:9
 * Phase: 9
 * Domain: ACL
 * Purpose: List ACL versions for a company with active indicator.
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

type AdminContext = {
  context: ContextResolution;
};

function assertAdmin(ctx: AdminContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function listAclVersionsHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {

  const requestId = generateRequestId();

    // harmless read (avoids unused warning)
  req.headers;

  try {

    assertAdmin(ctx);

    const db = getServiceRoleClientWithContext(ctx.context);

    if (ctx.context.status !== "RESOLVED") {
  return errorResponse(
    "CONTEXT_UNRESOLVED",
    "Context unresolved",
    requestId
  );
}

const companyId = ctx.context.companyId;

    const { data, error } = await db
      .schema("acl").from("acl_versions")
      .select(`
        acl_version_id,
        version_number,
        description,
        is_active,
        created_at,
        created_by
      `)
      .eq("company_id", companyId)
      .order("version_number", { ascending: false });

    if (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id:"9.11",
        event: "ACL_VERSION_LIST_FAILED",
        meta: { error: error.message },
      });

      return errorResponse(
        "ACL_VERSION_LIST_FAILED",
        "Failed to list ACL versions",
        requestId
      );
    }

    return okResponse(
      { versions: data ?? [] },
      requestId
    );

  } catch (err) {

    log({
      level: "ERROR",
      request_id: requestId,
      gate_id:"9.11",
      event: "ACL_VERSION_LIST_EXCEPTION",
      meta: { error: String(err) },
    });

    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId
    );
  }
}