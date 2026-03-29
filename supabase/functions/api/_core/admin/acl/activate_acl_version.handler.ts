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
  company_id: string;
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

    if (!body.acl_version_id || !body.company_id) {
  return errorResponse(
    "ACL_VERSION_INPUT_REQUIRED",
    "acl_version_id and company_id required",
    requestId
  );
}

    

    const db = getServiceRoleClientWithContext(ctx.context);

const companyId = body.company_id;

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
    /* Generate deterministic ACL snapshot only when this */
    /* version has not been materialized before           */
    /* -------------------------------------------------- */

    const { data: existingSnapshot, error: snapshotLookupError } = await db
      .schema("acl")
      .from("precomputed_acl_view")
      .select("snapshot_id")
      .eq("acl_version_id", body.acl_version_id)
      .eq("company_id", companyId)
      .limit(1)
      .maybeSingle();

    if (snapshotLookupError) {
      return errorResponse(
        "ACL_SNAPSHOT_LOOKUP_FAILED",
        snapshotLookupError.message,
        requestId
      );
    }

    if (!existingSnapshot) {
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
    }

    log({
      level: "SECURITY",
      request_id: requestId,
      gate_id:"9.11",
      event: "ACL_VERSION_ACTIVATED",
      meta: {
        company_id: companyId,
        acl_version_id: body.acl_version_id,
        reused_existing_snapshot: Boolean(existingSnapshot),
      },
    });

    return okResponse(
      {
        acl_version_id: body.acl_version_id,
        status: "ACTIVE",
        reused_existing_snapshot: Boolean(existingSnapshot),
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
