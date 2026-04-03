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

    const { data: targetVersion, error: targetVersionError } = await db
      .schema("acl")
      .from("acl_versions")
      .select("acl_version_id, company_id, is_active, version_number, description")
      .eq("acl_version_id", body.acl_version_id)
      .eq("company_id", companyId)
      .maybeSingle();

    if (targetVersionError) {
      return errorResponse(
        "ACL_VERSION_READ_FAILED",
        targetVersionError.message,
        requestId,
        "NONE",
        403,
        {
          gateId: "9.11",
          routeKey: "POST:/api/admin/acl/versions/activate",
          decisionTrace: "TARGET_VERSION_READ_FAILED",
        },
      );
    }

    if (!targetVersion) {
      return errorResponse(
        "ACL_VERSION_NOT_FOUND",
        "ACL version not found for this company",
        requestId,
        "NONE",
        403,
        {
          gateId: "9.11",
          routeKey: "POST:/api/admin/acl/versions/activate",
          decisionTrace: "TARGET_VERSION_NOT_FOUND",
        },
      );
    }

    if (targetVersion.is_active) {
      return okResponse(
        {
          acl_version_id: body.acl_version_id,
          status: "ACTIVE",
          reused_existing_snapshot: true,
        },
        requestId,
      );
    }

    /* -------------------------------------------------- */
    /* Deactivate current active version                  */
    /* -------------------------------------------------- */

    const { error: deactivateError } = await db
      .schema("acl").from("acl_versions")
      .update({ is_active: false })
      .eq("company_id", companyId)
      .eq("is_active", true);

    if (deactivateError) {
      return errorResponse(
        "ACL_VERSION_DEACTIVATE_FAILED",
        deactivateError.message,
        requestId,
        "NONE",
        403,
        {
          gateId: "9.11",
          routeKey: "POST:/api/admin/acl/versions/activate",
          decisionTrace: "DEACTIVATE_FAILED",
        },
      );
    }

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
        activateError.message,
        requestId,
        "NONE",
        403,
        {
          gateId: "9.11",
          routeKey: "POST:/api/admin/acl/versions/activate",
          decisionTrace: "ACTIVATE_FAILED",
        },
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
        requestId,
        "NONE",
        403,
        {
          gateId: "9.11",
          routeKey: "POST:/api/admin/acl/versions/activate",
          decisionTrace: "SNAPSHOT_LOOKUP_FAILED",
        },
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
          requestId,
          "NONE",
          403,
          {
            gateId: "9.11",
            routeKey: "POST:/api/admin/acl/versions/activate",
            decisionTrace: "SNAPSHOT_GENERATION_FAILED",
          },
        );
      }
    }

    log({
      level: "SECURITY",
      request_id: requestId,
      gate_id:"9.11",
      route_key: "POST:/api/admin/acl/versions/activate",
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
      route_key: "POST:/api/admin/acl/versions/activate",
      event: "ACL_VERSION_ACTIVATE_EXCEPTION",
      meta: { error: String(err) },
    });

    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId,
      "NONE",
      403,
      {
        gateId: "9.11",
        routeKey: "POST:/api/admin/acl/versions/activate",
        decisionTrace: "EXCEPTION",
      },
    );
  }
}
