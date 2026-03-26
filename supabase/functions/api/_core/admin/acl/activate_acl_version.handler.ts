/*
 * File-ID: ID-9.11B
 * File-Path: supabase/functions/api/_core/admin/acl/activate_acl_version.handler.ts
 * gate_id:9
 * Phase: 9
 * Domain: ACL
 * Purpose: Activate an ACL version and regenerate snapshot.
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

type ActivateInput = {
  acl_version_id: string;
};

type AdminContext = {
  context: ContextResolution;
};

function assertAdmin(ctx: AdminContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function activateAclVersionHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {

  const requestId = generateRequestId();

  try {

    assertAdmin(ctx);

    

    const body = (await req.json()) as Partial<ActivateInput>;

    if (!body.acl_version_id) {
  return errorResponse(
    "ACL_VERSION_ID_REQUIRED",
    "acl_version_id required",
    requestId
  );
}

    

    const db = getServiceRoleClientWithContext(ctx.context);

    if (ctx.context.status !== "RESOLVED") {
  return errorResponse(
    "CONTEXT_UNRESOLVED",
    "Context unresolved",
    requestId
  );
}

const companyId = ctx.context.companyId;

    /* -------------------------------------------------- */
    /* Deactivate current active version                  */
    /* -------------------------------------------------- */

    await db
      .schema("acl").from("acl_versions")
      .update({ is_active: false })
      .eq("company_id", companyId)
      .eq("is_active", true);

    /* -------------------------------------------------- */
    /* Activate selected version                          */
    /* -------------------------------------------------- */

    const { error: activateError } = await db
      .schema("acl").from("acl_versions")
      .update({ is_active: true })
      .eq("acl_version_id", body.acl_version_id)
      .eq("company_id", companyId);

    if (activateError) {
      return errorResponse(
        "ACL_VERSION_ACTIVATE_FAILED",
        "Failed to activate ACL version",
        requestId
      );
    }

    /* -------------------------------------------------- */
    /* Generate deterministic ACL snapshot                */
    /* -------------------------------------------------- */

    const { error: snapshotError } = await db
  .schema("acl")
  .rpc(
  "generate_acl_snapshot",
  {
    p_acl_version_id: body.acl_version_id,
    p_company_id: companyId,
  }
);

if (snapshotError) {
  return errorResponse(
    "ACL_SNAPSHOT_GENERATION_FAILED",
    snapshotError.message,
    requestId
  );
}

    log({
      level: "SECURITY",
      request_id: requestId,
      gate_id:"9.11",
      event: "ACL_VERSION_ACTIVATED",
      meta: {
        company_id: companyId,
        acl_version_id: body.acl_version_id,
      },
    });

    return okResponse(
      {
        acl_version_id: body.acl_version_id,
        status: "ACTIVE",
      },
      requestId
    );

  } catch (err) {

    log({
      level: "ERROR",
      request_id: requestId,
      gate_id:"9.11",
      event: "ACL_VERSION_ACTIVATE_EXCEPTION",
      meta: { error: String(err) },
    });

    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId
    );
  }
}
