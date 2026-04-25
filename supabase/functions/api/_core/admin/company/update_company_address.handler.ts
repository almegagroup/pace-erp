/*
 * File-ID: 9.2F
 * File-Path: supabase/functions/api/_core/admin/company/update_company_address.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: Update editable company address fields in a strict SA-only manner
 * Authority: Backend
 */

import type { ContextResolution } from "../../../_pipeline/context.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../../../_core/response.ts";
import { log } from "../../../_lib/logger.ts";
import { isSuperAdmin } from "../../../_shared/role_ladder.ts";

type HandlerContext = {
  context: ContextResolution;
  request_id: string;
};

type UpdateCompanyAddressInput = {
  company_id?: string;
  state_name?: string | null;
  pin_code?: string | null;
  full_address?: string | null;
};

function assertSuperAdmin(
  ctx: HandlerContext,
): asserts ctx is {
  context: Extract<ContextResolution, { status: "RESOLVED" }> & { isAdmin: true };
  request_id: string;
} {
  if (
    ctx.context.status !== "RESOLVED" ||
    ctx.context.isAdmin !== true ||
    !isSuperAdmin(ctx.context.roleCode)
  ) {
    throw new Error("SA_ONLY");
  }
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePinCode(value: unknown): string | null {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  const digitsOnly = normalized.replace(/\D+/g, "");
  return digitsOnly.length > 0 ? digitsOnly : null;
}

function shapeCompanyPayload(data: Record<string, unknown>) {
  return {
    id: data.id as string,
    company_code: data.company_code as string,
    company_name: data.company_name as string,
    gst_number: (data.gst_number as string | null) ?? null,
    state_name: (data.state_name as string | null) ?? null,
    full_address: (data.full_address as string | null) ?? null,
    pin_code: (data.pin_code as string | null) ?? null,
    status: (data.status as string | null) ?? null,
  };
}

export async function updateCompanyAddressHandler(
  req: Request,
  ctx: HandlerContext,
): Promise<Response> {
  try {
    assertSuperAdmin(ctx);

    const body = (await req.json()) as UpdateCompanyAddressInput;
    const companyId = normalizeText(body.company_id);

    if (!companyId) {
      return errorResponse(
        "COMPANY_ID_REQUIRED",
        "company_id required",
        ctx.request_id,
      );
    }

    const normalizedStateName = normalizeText(body.state_name);
    const normalizedFullAddress = normalizeText(body.full_address);
    const normalizedPinCode = normalizePinCode(body.pin_code);

    if (normalizedPinCode && normalizedPinCode.length !== 6) {
      return errorResponse(
        "PIN_CODE_INVALID",
        "pin code must be exactly 6 digits",
        ctx.request_id,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: company, error: companyError } = await db
      .schema("erp_master")
      .from("companies")
      .select("id, company_code, company_name, gst_number, state_name, full_address, pin_code, status")
      .eq("id", companyId)
      .maybeSingle();

    if (companyError || !company) {
      return errorResponse(
        "COMPANY_NOT_FOUND",
        "company not found",
        ctx.request_id,
      );
    }

    const { data: updatedCompany, error: updateError } = await db
      .schema("erp_master")
      .from("companies")
      .update({
        state_name: normalizedStateName,
        full_address: normalizedFullAddress,
        pin_code: normalizedPinCode,
      })
      .eq("id", companyId)
      .select("id, company_code, company_name, gst_number, state_name, full_address, pin_code, status")
      .single();

    if (updateError || !updatedCompany) {
      log({
        level: "ERROR",
        request_id: ctx.request_id,
        gate_id: "9.2F",
        route_key: "PATCH:/api/admin/company/address",
        event: "COMPANY_ADDRESS_UPDATE_FAILED",
        meta: {
          company_id: companyId,
          error: updateError?.message ?? null,
        },
      });

      return errorResponse(
        "COMPANY_ADDRESS_UPDATE_FAILED",
        "company address update failed",
        ctx.request_id,
      );
    }

    log({
      level: "SECURITY",
      request_id: ctx.request_id,
      gate_id: "9.2F",
      route_key: "PATCH:/api/admin/company/address",
      event: "COMPANY_ADDRESS_UPDATED",
      meta: {
        company_id: companyId,
      },
    });

    return okResponse(
      {
        company: shapeCompanyPayload(updatedCompany as Record<string, unknown>),
      },
      ctx.request_id,
    );
  } catch (err) {
    const errorCode = (err as Error).message || "COMPANY_ADDRESS_UPDATE_EXCEPTION";

    return errorResponse(
      errorCode,
      "company address update exception",
      ctx.request_id,
      "NONE",
      errorCode === "SA_ONLY" ? 403 : 500,
    );
  }
}
