/*
 * File-ID: ID-9.2D
 * File-Path: supabase/functions/api/_core/admin/company/get_company_gst_profile.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: Resolve GST-backed company profile for SA create-company autofill
 * Authority: Backend
 */

import { errorResponse, okResponse } from "../../../_core/response.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { deriveCompanyFieldsFromGstProfile } from "../../../_shared/gst_company_fields.ts";
import { resolveGstProfileWithSource } from "../../../_shared/gst_resolver.ts";

type HandlerContext = {
  context: ContextResolution;
  request_id: string;
};

function assertAdmin(ctx: HandlerContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function getCompanyGstProfileHandler(
  req: Request,
  ctx: HandlerContext,
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const url = new URL(req.url);
    const gstNumber = url.searchParams.get("gst_number")?.trim().toUpperCase();

    if (!gstNumber) {
      return errorResponse(
        "GST_NUMBER_REQUIRED",
        "gst_number required",
        ctx.request_id,
      );
    }

    const resolved = await resolveGstProfileWithSource(gstNumber);
    const companyFields = deriveCompanyFieldsFromGstProfile(resolved.profile);

    return okResponse(
      {
        gst_profile: {
          gst_number: resolved.profile.gst_number,
          legal_name: resolved.profile.legal_name,
          trade_name: resolved.profile.trade_name ?? null,
          status: resolved.profile.status,
          source: resolved.source,
          fetched_at: resolved.profile.fetched_at,
          state_name: companyFields.state_name,
          full_address: companyFields.full_address,
          pin_code: companyFields.pin_code,
        },
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "COMPANY_GST_PROFILE_EXCEPTION",
      "company gst profile exception",
      ctx.request_id,
    );
  }
}
