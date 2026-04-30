/*
 * File-ID: 8.1-HR-LT
 * File-Path: supabase/functions/api/_core/hr/leave_types.handlers.ts
 * Gate: 8
 * Phase: 1
 * Domain: HR
 * Purpose: Per-company leave type catalogue — list (public), list-all, create, update
 * Authority: Backend
 */

import { okResponse, errorResponse } from "../response.ts";
import { log } from "../../_lib/logger.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { getActiveAclVersionIdForCompany } from "../../_shared/acl_runtime.ts";
import { readAclSnapshotDecision } from "../../_shared/acl_snapshot.ts";
import {
  LEAVE_RESOURCE_CODES,
  assertHrBusinessContext,
  type HrHandlerContext,
} from "./shared.ts";

// ---------------------------------------------------------------------------
// Permission guard — HR_LEAVE_TYPE_MANAGE
// ---------------------------------------------------------------------------

async function assertLeaveTypeManagePermission(
  ctx: HrHandlerContext,
  companyId: string,
  workContextId: string,
): Promise<Response | null> {
  const aclVersionId = await getActiveAclVersionIdForCompany(
    serviceRoleClient,
    companyId,
  );

  const { data: aclDecision } = await readAclSnapshotDecision({
    db: serviceRoleClient,
    aclVersionId,
    authUserId: ctx.auth_user_id,
    companyId,
    workContextId,
    resourceCode: LEAVE_RESOURCE_CODES.typeManage,
    actionCode: "WRITE",
  });

  if (!aclDecision || aclDecision.decision !== "ALLOW") {
    return errorResponse(
      "LEAVE_TYPE_MANAGE_FORBIDDEN",
      "permission denied — HR_LEAVE_TYPE_MANAGE required",
      ctx.request_id,
      "NONE",
      403,
    );
  }

  return null; // null = permission granted
}

// ---------------------------------------------------------------------------
// Handler 1 — List active leave types (any authenticated HR user)
// ---------------------------------------------------------------------------

export async function listLeaveTypesHandler(
  _req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);

    const { data, error } = await serviceRoleClient
      .schema("erp_hr")
      .from("leave_types")
      .select(
        "leave_type_id, type_code, type_name, is_paid, requires_document, max_days_per_year, carry_forward_allowed",
      )
      .eq("company_id", ctx.context.companyId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) {
      throw new Error("LEAVE_TYPES_LIST_FAILED");
    }

    return okResponse({ leave_types: data ?? [] }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "LEAVE_TYPES_LIST_EXCEPTION",
      "leave types list exception",
      ctx.request_id,
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helper — resolve target company from x-company-id header or session
// ---------------------------------------------------------------------------

function resolveTargetCompanyId(req: Request, ctx: HrHandlerContext): string {
  const headerCompanyId = req.headers.get("x-company-id")?.trim();
  return (headerCompanyId && headerCompanyId.length > 0)
    ? headerCompanyId
    : ctx.context.companyId;
}

// ---------------------------------------------------------------------------
// Handler 2 — List ALL leave types inc. inactive (HR_LEAVE_TYPE_MANAGE)
// ---------------------------------------------------------------------------

export async function listAllLeaveTypesHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);

    const targetCompanyId = resolveTargetCompanyId(req, ctx);

    const denied = await assertLeaveTypeManagePermission(
      ctx,
      targetCompanyId,
      ctx.context.workContextId,
    );
    if (denied) return denied;

    const { data, error } = await serviceRoleClient
      .schema("erp_hr")
      .from("leave_types")
      .select(
        "leave_type_id, type_code, type_name, is_paid, requires_document, max_days_per_year, carry_forward_allowed, is_active, sort_order, created_at",
      )
      .eq("company_id", targetCompanyId)
      .order("sort_order", { ascending: true });

    if (error) {
      throw new Error("LEAVE_TYPES_LIST_ALL_FAILED");
    }

    return okResponse({ leave_types: data ?? [] }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "LEAVE_TYPES_LIST_ALL_EXCEPTION",
      "leave types list all exception",
      ctx.request_id,
    );
  }
}

// ---------------------------------------------------------------------------
// Handler 3 — Create leave type (HR_LEAVE_TYPE_MANAGE)
// ---------------------------------------------------------------------------

export async function createLeaveTypeHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  const routeKey = "POST:/api/hr/leave/types";

  try {
    assertHrBusinessContext(ctx);

    const targetCompanyId = resolveTargetCompanyId(req, ctx);

    const denied = await assertLeaveTypeManagePermission(
      ctx,
      targetCompanyId,
      ctx.context.workContextId,
    );
    if (denied) return denied;

    const body = await req.json().catch(() => ({}));
    const typeCode = String(body?.type_code ?? "").trim().toUpperCase();
    const typeName = String(body?.type_name ?? "").trim();
    const isPaid = body?.is_paid !== false;
    const requiresDocument = body?.requires_document === true;
    const carryForwardAllowed = body?.carry_forward_allowed === true;
    const sortOrder = body?.sort_order != null ? Number(body.sort_order) : 0;
    const maxDaysPerYear =
      body?.max_days_per_year != null ? Number(body.max_days_per_year) : null;

    if (!typeCode) {
      return errorResponse(
        "LEAVE_TYPE_CODE_REQUIRED",
        "type_code required",
        ctx.request_id,
        "NONE",
        400,
      );
    }
    if (!/^[A-Z0-9_]{1,20}$/.test(typeCode)) {
      return errorResponse(
        "LEAVE_TYPE_CODE_INVALID",
        "type_code must be 1–20 uppercase letters, digits, or underscores",
        ctx.request_id,
        "NONE",
        400,
      );
    }
    if (!typeName) {
      return errorResponse(
        "LEAVE_TYPE_NAME_REQUIRED",
        "type_name required",
        ctx.request_id,
        "NONE",
        400,
      );
    }
    if (maxDaysPerYear !== null && (isNaN(maxDaysPerYear) || maxDaysPerYear < 1)) {
      return errorResponse(
        "LEAVE_TYPE_MAX_DAYS_INVALID",
        "max_days_per_year must be a positive integer",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_hr")
      .from("leave_types")
      .insert({
        company_id: targetCompanyId,
        type_code: typeCode,
        type_name: typeName,
        is_paid: isPaid,
        requires_document: requiresDocument,
        max_days_per_year: maxDaysPerYear,
        carry_forward_allowed: carryForwardAllowed,
        sort_order: sortOrder,
        created_by: ctx.auth_user_id,
      })
      .select(
        "leave_type_id, type_code, type_name, is_paid, requires_document, max_days_per_year, carry_forward_allowed, is_active, sort_order, created_at",
      )
      .single();

    if (error) {
      // Postgres unique violation
      if (error.code === "23505" || error.message?.includes("unique")) {
        return errorResponse(
          "LEAVE_TYPE_CODE_DUPLICATE",
          "a leave type with this code already exists for this company",
          ctx.request_id,
          "NONE",
          409,
        );
      }
      throw new Error("LEAVE_TYPE_CREATE_FAILED");
    }

    log({
      level: "INFO",
      request_id: ctx.request_id,
      gate_id: "HR.LEAVE_TYPES",
      route_key: routeKey,
      event: "LEAVE_TYPE_CREATED",
      actor: ctx.auth_user_id,
      meta: {
        leave_type_id: data.leave_type_id,
        company_id: ctx.context.companyId,
        type_code: typeCode,
      },
    });

    return okResponse({ leave_type: data }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "LEAVE_TYPE_CREATE_EXCEPTION",
      "leave type create exception",
      ctx.request_id,
    );
  }
}

// ---------------------------------------------------------------------------
// Handler 4 — Update leave type (HR_LEAVE_TYPE_MANAGE)
// type_code is immutable after creation — never updated here
// ---------------------------------------------------------------------------

export async function updateLeaveTypeHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  const routeKey = "PATCH:/api/hr/leave/types";

  try {
    assertHrBusinessContext(ctx);

    const targetCompanyId = resolveTargetCompanyId(req, ctx);

    const denied = await assertLeaveTypeManagePermission(
      ctx,
      targetCompanyId,
      ctx.context.workContextId,
    );
    if (denied) return denied;

    const body = await req.json().catch(() => ({}));
    const leaveTypeId = String(body?.leave_type_id ?? "").trim();

    if (!leaveTypeId) {
      return errorResponse(
        "LEAVE_TYPE_ID_REQUIRED",
        "leave_type_id required",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    // Load existing row — enforce company isolation
    const { data: existing, error: loadError } = await serviceRoleClient
      .schema("erp_hr")
      .from("leave_types")
      .select("leave_type_id, company_id, type_code")
      .eq("leave_type_id", leaveTypeId)
      .maybeSingle();

    if (loadError || !existing) {
      return errorResponse(
        "LEAVE_TYPE_NOT_FOUND",
        "leave type not found",
        ctx.request_id,
        "NONE",
        404,
      );
    }

    if (existing.company_id !== targetCompanyId) {
      return errorResponse(
        "LEAVE_TYPE_FORBIDDEN",
        "cannot modify another company's leave type",
        ctx.request_id,
        "NONE",
        403,
      );
    }

    // Build update payload — type_code is NEVER updatable
    const updates: Record<string, unknown> = {};

    if (body?.type_name !== undefined) {
      const typeName = String(body.type_name).trim();
      if (!typeName) {
        return errorResponse(
          "LEAVE_TYPE_NAME_REQUIRED",
          "type_name cannot be empty",
          ctx.request_id,
          "NONE",
          400,
        );
      }
      updates.type_name = typeName;
    }
    if (body?.is_paid !== undefined) {
      updates.is_paid = body.is_paid === true;
    }
    if (body?.requires_document !== undefined) {
      updates.requires_document = body.requires_document === true;
    }
    if (body?.carry_forward_allowed !== undefined) {
      updates.carry_forward_allowed = body.carry_forward_allowed === true;
    }
    if (body?.is_active !== undefined) {
      updates.is_active = body.is_active === true;
    }
    if (body?.sort_order !== undefined) {
      updates.sort_order = Number(body.sort_order);
    }
    if (body?.max_days_per_year !== undefined) {
      const maxDays =
        body.max_days_per_year === null ? null : Number(body.max_days_per_year);
      if (maxDays !== null && (isNaN(maxDays) || maxDays < 1)) {
        return errorResponse(
          "LEAVE_TYPE_MAX_DAYS_INVALID",
          "max_days_per_year must be a positive integer or null",
          ctx.request_id,
          "NONE",
          400,
        );
      }
      updates.max_days_per_year = maxDays;
    }

    if (Object.keys(updates).length === 0) {
      return errorResponse(
        "LEAVE_TYPE_NO_CHANGES",
        "no updatable fields provided",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    const { data: updated, error: updateError } = await serviceRoleClient
      .schema("erp_hr")
      .from("leave_types")
      .update(updates)
      .eq("leave_type_id", leaveTypeId)
      .select(
        "leave_type_id, type_code, type_name, is_paid, requires_document, max_days_per_year, carry_forward_allowed, is_active, sort_order, created_at",
      )
      .single();

    if (updateError || !updated) {
      throw new Error("LEAVE_TYPE_UPDATE_FAILED");
    }

    log({
      level: "INFO",
      request_id: ctx.request_id,
      gate_id: "HR.LEAVE_TYPES",
      route_key: routeKey,
      event: "LEAVE_TYPE_UPDATED",
      actor: ctx.auth_user_id,
      meta: {
        leave_type_id: leaveTypeId,
        company_id: ctx.context.companyId,
        changes: Object.keys(updates),
      },
    });

    return okResponse({ leave_type: updated }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "LEAVE_TYPE_UPDATE_EXCEPTION",
      "leave type update exception",
      ctx.request_id,
    );
  }
}
