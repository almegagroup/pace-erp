/*
 * File-ID: ID-9.11E
 * File-Path: supabase/functions/api/_core/admin/acl/delete_acl_version.handler.ts
 * gate_id:9
 * Phase: 9
 * Domain: ACL
 * Purpose: Remove an inactive ACL version that was captured by mistake.
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

type DeleteInput = {
  acl_version_id?: string;
  company_id?: string;
};

type AdminContext = {
  context: ContextResolution;
};

function assertAdmin(ctx: AdminContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function deleteAclVersionHandler(
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    assertAdmin(ctx);

    const body = (await req.json()) as DeleteInput;
    const aclVersionId = body.acl_version_id?.trim() ?? "";
    const companyId = body.company_id?.trim() ?? "";

    if (!aclVersionId || !companyId) {
      return errorResponse(
        "ACL_VERSION_INPUT_REQUIRED",
        "acl_version_id and company_id required",
        requestId,
        "NONE",
        403,
        { gateId: "9.11", routeKey: "POST:/api/admin/acl/versions/delete", decisionTrace: "INPUT_REQUIRED" },
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: versionRow, error: versionReadError } = await db
      .schema("acl")
      .from("acl_versions")
      .select("acl_version_id, company_id, is_active, version_number, description")
      .eq("acl_version_id", aclVersionId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (versionReadError) {
      return errorResponse(
        "ACL_VERSION_READ_FAILED",
        versionReadError.message,
        requestId,
        "NONE",
        403,
        { gateId: "9.11", routeKey: "POST:/api/admin/acl/versions/delete", decisionTrace: "READ_FAILED" },
      );
    }

    if (!versionRow) {
      return errorResponse(
        "ACL_VERSION_NOT_FOUND",
        "ACL version not found",
        requestId,
        "NONE",
        403,
        { gateId: "9.11", routeKey: "POST:/api/admin/acl/versions/delete", decisionTrace: "NOT_FOUND" },
      );
    }

    if (versionRow.is_active) {
      return errorResponse(
        "ACL_ACTIVE_VERSION_DELETE_BLOCKED",
        "Active ACL version cannot be deleted",
        requestId,
        "NONE",
        403,
        { gateId: "9.11", routeKey: "POST:/api/admin/acl/versions/delete", decisionTrace: "ACTIVE_VERSION_BLOCKED" },
      );
    }

    const { error: deleteError } = await db
      .schema("acl")
      .from("acl_versions")
      .delete()
      .eq("acl_version_id", aclVersionId)
      .eq("company_id", companyId);

    if (deleteError) {
      return errorResponse(
        "ACL_VERSION_DELETE_FAILED",
        deleteError.message,
        requestId,
        "NONE",
        403,
        { gateId: "9.11", routeKey: "POST:/api/admin/acl/versions/delete", decisionTrace: "DELETE_FAILED" },
      );
    }

    log({
      level: "SECURITY",
      request_id: requestId,
      gate_id: "9.11",
      route_key: "POST:/api/admin/acl/versions/delete",
      event: "ACL_VERSION_DELETED",
      meta: {
        company_id: companyId,
        acl_version_id: aclVersionId,
        version_number: versionRow.version_number,
        description: versionRow.description,
      },
    });

    return okResponse(
      {
        acl_version_id: aclVersionId,
        company_id: companyId,
        status: "DELETED",
      },
      requestId,
    );
  } catch (err) {
    log({
      level: "ERROR",
      request_id: requestId,
      gate_id: "9.11",
      route_key: "POST:/api/admin/acl/versions/delete",
      event: "ACL_VERSION_DELETE_EXCEPTION",
      meta: { error: String(err) },
    });

    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId,
      "NONE",
      403,
      { gateId: "9.11", routeKey: "POST:/api/admin/acl/versions/delete", decisionTrace: "EXCEPTION" },
    );
  }
}
