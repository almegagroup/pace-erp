/*
 * File-ID: ID-6.3.5
 * File-Path: supabase/functions/api/_core/admin/company/create_company.handler.ts
 * Gate: 6
 * Phase: 6
 * Domain: MASTER
 * Purpose: Create company with optional GST autofill (cache-first, cost-safe)
 * Authority: Backend (SA / GA only)
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { resolveGstProfile } from "../../../_shared/gst_resolver.ts";
import { okResponse, errorResponse } from "../../../_core/response.ts";
import { deriveCompanyFieldsFromGstProfile } from "../../../_shared/gst_company_fields.ts";
import { log } from "../../../_lib/logger.ts";
import { ensureCompanyOperationalWorkContexts } from "../../../_shared/work_context_governance.ts";

// ------------------------------------------------------------------
// Minimal admin context (Gate-6 contract)
// ------------------------------------------------------------------
type AdminContext = {
  context: ContextResolution;
  request_id: string;
};

function assertAdmin(ctx: AdminContext): void {
  if (
    ctx.context.status !== "RESOLVED" ||
    ctx.context.isAdmin !== true
  ) {
    throw new Error("ADMIN_ONLY");
  }
}

function resolveCreateCompanyErrorStatus(code: string): number {
  if (code === "COMPANY_NAME_REQUIRED") {
    return 400;
  }

  if (code === "APPLYFLOW_ENV_NOT_CONFIGURED") {
    return 500;
  }

  if (
    code.startsWith("APPLYFLOW_HTTP_") ||
    code === "APPLYFLOW_INVALID_RESPONSE"
  ) {
    return 502;
  }

  return 500;
}

// ------------------------------------------------------------------
// Input contract
// ------------------------------------------------------------------
type CreateCompanyInput = {
  company_name?: string;
  gst_number?: string;
};

function shapeCompanyPayload(data: Record<string, unknown>) {
  return {
    id: data.id as string,
    company_code: data.company_code as string,
    company_name: data.company_name as string,
    gst_number: (data.gst_number as string | null) ?? null,
    state_name: (data.state_name as string | null) ?? null,
    full_address: (data.full_address as string | null) ?? null,
    pin_code: (data.pin_code as string | null) ?? null,
  };
}

// ------------------------------------------------------------------
// Leave type seed helper — 5 defaults for every new company
// Matches the Phase 1-A migration seed exactly.
// ------------------------------------------------------------------
async function seedDefaultLeaveTypes(
  db: ReturnType<typeof getServiceRoleClientWithContext>,
  companyId: string,
): Promise<void> {
  const defaults = [
    { type_code: "GEN", type_name: "General Leave",  is_paid: true,  requires_document: false, carry_forward_allowed: false, sort_order: 0 },
    { type_code: "CL",  type_name: "Casual Leave",   is_paid: true,  requires_document: false, carry_forward_allowed: false, sort_order: 1 },
    { type_code: "SL",  type_name: "Sick Leave",      is_paid: true,  requires_document: true,  carry_forward_allowed: false, sort_order: 2 },
    { type_code: "EL",  type_name: "Earned Leave",    is_paid: true,  requires_document: false, carry_forward_allowed: true,  sort_order: 3 },
    { type_code: "LOP", type_name: "Loss of Pay",     is_paid: false, requires_document: false, carry_forward_allowed: false, sort_order: 4 },
  ];

  await db
    .schema("erp_hr")
    .from("leave_types")
    .upsert(
      defaults.map((t) => ({ ...t, company_id: companyId })),
      { onConflict: "company_id,type_code", ignoreDuplicates: true },
    );
}

// ------------------------------------------------------------------
// Handler
// ------------------------------------------------------------------
export async function createCompanyHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {
  try {
    // 1️⃣ Admin guard
    assertAdmin(ctx);

    // 2️⃣ Parse input
    const body = (await req.json()) as CreateCompanyInput;

    const gst = body.gst_number
      ? body.gst_number.trim().toUpperCase()
      : null;

    const db = getServiceRoleClientWithContext(ctx.context);

    if (gst) {
      const { data: existingCompanyByGst } = await db
        .schema("erp_master").from("companies")
        .select("id, company_code, company_name, gst_number, state_name, full_address, pin_code")
        .eq("gst_number", gst)
        .maybeSingle();

      if (existingCompanyByGst) {
        return okResponse(
          {
            company: shapeCompanyPayload(existingCompanyByGst as Record<string, unknown>),
            already_exists: true,
          },
          ctx.request_id
        );
      }
    }

    // 3️⃣ Resolve GST (cache → Applyflow → cache)
    const gstProfile = gst
      ? await resolveGstProfile(gst)
      : null;

    // 4️⃣ Determine company name (GST autofill preferred)
    const companyName =
      gstProfile?.legal_name ??
      body.company_name?.trim();

    const derivedFields = gstProfile
      ? deriveCompanyFieldsFromGstProfile(gstProfile)
      : {
        company_name: companyName ?? "",
        state_name: null,
        full_address: null,
        pin_code: null,
      };

    if (!companyName) {
      return errorResponse(
        "COMPANY_NAME_REQUIRED",
        "company name required",
        ctx.request_id
      );
    }

    // 5️⃣ Insert company (company_code auto-generated by DB)
    const { data, error } = await db
      .schema("erp_master").from("companies")
      .insert({
        company_name: companyName,
        gst_number: gst,
        state_name: derivedFields.state_name,
        full_address: derivedFields.full_address,
        pin_code: derivedFields.pin_code,
        company_kind: "BUSINESS",
      })
      .select()
      .single();

    if (error) {
      if (gst) {
        const { data: existingCompanyAfterConflict } = await db
          .schema("erp_master").from("companies")
          .select("id, company_code, company_name, gst_number, state_name, full_address, pin_code")
          .eq("gst_number", gst)
          .maybeSingle();

        if (existingCompanyAfterConflict) {
          return okResponse(
            {
              company: shapeCompanyPayload(existingCompanyAfterConflict as Record<string, unknown>),
              already_exists: true,
            },
            ctx.request_id
          );
        }
      }

      return errorResponse(
        "COMPANY_CREATE_FAILED",
        "company create failed",
        ctx.request_id
      );
    }

    // 6️⃣ Ensure operational work contexts
    await ensureCompanyOperationalWorkContexts(db, data.id);

    // 7️⃣ Seed default leave types for the new company
    await seedDefaultLeaveTypes(db, data.id);

    return okResponse(
      {
        company: {
          ...shapeCompanyPayload(data as Record<string, unknown>),
        },
        already_exists: false,
      },
      ctx.request_id
    );
  } catch (err) {
    const errorCode = (err as Error).message || "COMPANY_CREATE_EXCEPTION";

    log({
      level: "ERROR",
      request_id: ctx.request_id,
      gate_id: "9.2",
      route_key: "POST:/api/admin/company",
      event: "COMPANY_CREATE_FAILED",
      meta: {
        error_code: errorCode,
      },
    });

    return errorResponse(
      errorCode,
      "company create exception",
      ctx.request_id,
      "NONE",
      resolveCreateCompanyErrorStatus(errorCode),
    );
  }
}
