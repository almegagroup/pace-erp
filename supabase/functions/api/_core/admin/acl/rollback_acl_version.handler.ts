/*
 * File-ID: ID-9.11C
 * File-Path: supabase/functions/api/_core/admin/acl/rollback_acl_version.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: Roll back to a previously materialized ACL version without recomputing away historical snapshot truth
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

type RollbackInput = {
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

export async function rollbackAclVersionHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    assertAdmin(ctx);

    const body = (await req.json()) as Partial<RollbackInput>;

    if (!body.acl_version_id || !body.company_id) {
      return errorResponse(
        "ACL_VERSION_INPUT_REQUIRED",
        "acl_version_id and company_id required",
        requestId
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: existingSnapshot, error: snapshotReadError } = await db
      .schema("acl")
      .from("precomputed_acl_view")
      .select("snapshot_id")
      .eq("acl_version_id", body.acl_version_id)
      .eq("company_id", body.company_id)
      .limit(1)
      .maybeSingle();

    if (snapshotReadError) {
      return errorResponse(
        "ACL_SNAPSHOT_LOOKUP_FAILED",
        snapshotReadError.message,
        requestId
      );
    }

    if (!existingSnapshot) {
      const { error: rebuildError } = await db
        .schema("acl")
        .rpc("generate_acl_snapshot", {
          p_acl_version_id: body.acl_version_id,
          p_company_id: body.company_id,
        });

      if (rebuildError) {
        return errorResponse(
          "ACL_SNAPSHOT_GENERATION_FAILED",
          rebuildError.message,
          requestId
        );
      }
    }

    await db
      .schema("acl")
      .from("acl_versions")
      .update({ is_active: false })
      .eq("company_id", body.company_id)
      .eq("is_active", true);

    const { error: activateError } = await db
      .schema("acl")
      .from("acl_versions")
      .update({ is_active: true })
      .eq("acl_version_id", body.acl_version_id)
      .eq("company_id", body.company_id);

    if (activateError) {
      return errorResponse(
        "ACL_VERSION_ROLLBACK_FAILED",
        activateError.message,
        requestId
      );
    }

    log({
      level: "SECURITY",
      request_id: requestId,
      gate_id: "9.11",
      event: "ACL_VERSION_ROLLED_BACK",
      meta: {
        company_id: body.company_id,
        acl_version_id: body.acl_version_id,
        reused_existing_snapshot: Boolean(existingSnapshot),
      },
    });

    return okResponse(
      {
        acl_version_id: body.acl_version_id,
        company_id: body.company_id,
        status: "ACTIVE",
        reused_existing_snapshot: Boolean(existingSnapshot),
      },
      requestId
    );
  } catch (err) {
    log({
      level: "ERROR",
      request_id: requestId,
      gate_id: "9.11",
      event: "ACL_VERSION_ROLLBACK_EXCEPTION",
      meta: { error: String(err) },
    });

    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId
    );
  }
}
