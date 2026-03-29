/*
 * File-ID: ID-9.11D
 * File-Path: supabase/functions/api/_core/admin/acl/create_acl_version.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: Freeze a new immutable ACL version from the current governed tables
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

type CreateAclVersionInput = {
  company_id?: string;
  description?: string;
  activate_now?: boolean;
};

type AdminContext = {
  context: ContextResolution;
  auth_user_id: string;
};

function assertAdmin(ctx: AdminContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function createAclVersionHandler(
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    assertAdmin(ctx);

    const body = (await req.json()) as CreateAclVersionInput;
    const companyId = body.company_id?.trim() ?? "";
    const description = body.description?.trim() ?? "";
    const activateNow = body.activate_now === true;

    if (!companyId || !description) {
      return errorResponse(
        "ACL_VERSION_INPUT_REQUIRED",
        "company_id and description required",
        requestId,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: latestVersion, error: latestVersionError } = await db
      .schema("acl")
      .from("acl_versions")
      .select("version_number")
      .eq("company_id", companyId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestVersionError) {
      return errorResponse(
        "ACL_VERSION_SEQUENCE_READ_FAILED",
        latestVersionError.message,
        requestId,
      );
    }

    const nextVersionNumber = (latestVersion?.version_number ?? 0) + 1;

    const { data: createdVersion, error: createError } = await db
      .schema("acl")
      .from("acl_versions")
      .insert({
        company_id: companyId,
        version_number: nextVersionNumber,
        description,
        is_active: false,
        created_by: ctx.auth_user_id,
      })
      .select(`
        acl_version_id,
        company_id,
        version_number,
        description,
        is_active,
        created_at,
        created_by,
        source_captured_at,
        source_captured_by
      `)
      .single();

    if (createError || !createdVersion?.acl_version_id) {
      return errorResponse(
        "ACL_VERSION_CREATE_FAILED",
        createError?.message ?? "ACL version create failed",
        requestId,
      );
    }

    const { error: captureError } = await db.schema("acl").rpc(
      "capture_acl_version_source",
      {
        p_acl_version_id: createdVersion.acl_version_id,
        p_company_id: companyId,
        p_actor: ctx.auth_user_id,
      },
    );

    if (captureError) {
      return errorResponse(
        "ACL_VERSION_CAPTURE_FAILED",
        captureError.message,
        requestId,
      );
    }

    const { error: snapshotError } = await db.schema("acl").rpc(
      "generate_acl_snapshot",
      {
        p_acl_version_id: createdVersion.acl_version_id,
        p_company_id: companyId,
      },
    );

    if (snapshotError) {
      return errorResponse(
        "ACL_SNAPSHOT_GENERATION_FAILED",
        snapshotError.message,
        requestId,
      );
    }

    if (activateNow) {
      await db
        .schema("acl")
        .from("acl_versions")
        .update({ is_active: false })
        .eq("company_id", companyId)
        .eq("is_active", true);

      const { error: activateError } = await db
        .schema("acl")
        .from("acl_versions")
        .update({ is_active: true })
        .eq("acl_version_id", createdVersion.acl_version_id)
        .eq("company_id", companyId);

      if (activateError) {
        return errorResponse(
          "ACL_VERSION_ACTIVATE_FAILED",
          activateError.message,
          requestId,
        );
      }
    }

    const { data: finalizedVersion, error: finalizedVersionError } = await db
      .schema("acl")
      .from("acl_versions")
      .select(`
        acl_version_id,
        company_id,
        version_number,
        description,
        is_active,
        created_at,
        created_by,
        source_captured_at,
        source_captured_by
      `)
      .eq("acl_version_id", createdVersion.acl_version_id)
      .single();

    if (finalizedVersionError || !finalizedVersion) {
      return errorResponse(
        "ACL_VERSION_FINAL_READ_FAILED",
        finalizedVersionError?.message ?? "ACL version final read failed",
        requestId,
      );
    }

    return okResponse(
      finalizedVersion,
      requestId,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId,
    );
  }
}
