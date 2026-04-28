/*
 * File-ID: 8.2-HR-CAL
 * File-Path: supabase/functions/api/_core/hr/calendar.handlers.ts
 * Gate: 8
 * Phase: 2-D
 * Domain: HR
 * Purpose: Per-company holiday calendar CRUD + week-off config management
 * Authority: Backend
 */

import { okResponse, errorResponse } from "../response.ts";
import { log } from "../../_lib/logger.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { getActiveAclVersionIdForCompany } from "../../_shared/acl_runtime.ts";
import { readAclSnapshotDecision } from "../../_shared/acl_snapshot.ts";
import {
  CALENDAR_RESOURCE_CODES,
  assertHrBusinessContext,
  normalizeIsoDate,
  type HrHandlerContext,
} from "./shared.ts";

// ---------------------------------------------------------------------------
// Permission guard — HR_CALENDAR_MANAGE
// ---------------------------------------------------------------------------

async function assertCalendarManagePermission(
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
    resourceCode: CALENDAR_RESOURCE_CODES.calendarManage,
    actionCode: "WRITE",
  });

  if (!aclDecision || aclDecision.decision !== "ALLOW") {
    return errorResponse(
      "CALENDAR_MANAGE_FORBIDDEN",
      "permission denied — HR_CALENDAR_MANAGE required",
      ctx.request_id,
      "NONE",
      403,
    );
  }

  return null; // null = permission granted
}

// ---------------------------------------------------------------------------
// Handler 1 — List holidays for the session company (any authenticated user)
// GET /api/hr/calendar/holidays
// Returns holidays sorted by date ascending.
// Optional query param: year (YYYY) to filter to a specific calendar year.
// ---------------------------------------------------------------------------

export async function listHolidaysHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);

    const url = new URL(req.url);
    const yearRaw = url.searchParams.get("year")?.trim() ?? "";
    const companyId = ctx.context.companyId;

    let query = serviceRoleClient
      .schema("erp_hr")
      .from("company_holiday_calendar")
      .select("holiday_id, holiday_date, holiday_name, created_at")
      .eq("company_id", companyId)
      .order("holiday_date", { ascending: true });

    if (yearRaw && /^\d{4}$/.test(yearRaw)) {
      query = query
        .gte("holiday_date", `${yearRaw}-01-01`)
        .lte("holiday_date", `${yearRaw}-12-31`);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error("HOLIDAY_LIST_FAILED");
    }

    return okResponse({ holidays: data ?? [] }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "HOLIDAY_LIST_EXCEPTION",
      "holiday list exception",
      ctx.request_id,
    );
  }
}

// ---------------------------------------------------------------------------
// Handler 2 — Create holiday (HR_CALENDAR_MANAGE)
// POST /api/hr/calendar/holidays
// Body: { holiday_date: "YYYY-MM-DD", holiday_name: string }
// ---------------------------------------------------------------------------

export async function createHolidayHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  const routeKey = "POST:/api/hr/calendar/holidays";

  try {
    assertHrBusinessContext(ctx);

    const denied = await assertCalendarManagePermission(
      ctx,
      ctx.context.companyId,
      ctx.context.workContextId,
    );
    if (denied) return denied;

    const body = await req.json().catch(() => ({}));
    const holidayDateRaw = String(body?.holiday_date ?? "").trim();
    const holidayName = String(body?.holiday_name ?? "").trim();

    if (!holidayDateRaw) {
      return errorResponse(
        "HOLIDAY_DATE_REQUIRED",
        "holiday_date required",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    const holidayDate = normalizeIsoDate(holidayDateRaw);

    if (!holidayName) {
      return errorResponse(
        "HOLIDAY_NAME_REQUIRED",
        "holiday_name required",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    if (holidayName.length > 100) {
      return errorResponse(
        "HOLIDAY_NAME_TOO_LONG",
        "holiday_name must be 100 characters or fewer",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_hr")
      .from("company_holiday_calendar")
      .insert({
        company_id: ctx.context.companyId,
        holiday_date: holidayDate,
        holiday_name: holidayName,
        created_by: ctx.auth_user_id,
      })
      .select("holiday_id, holiday_date, holiday_name, created_at")
      .single();

    if (error) {
      if (error.code === "23505" || error.message?.includes("unique")) {
        return errorResponse(
          "HOLIDAY_DATE_DUPLICATE",
          "a holiday already exists for this date",
          ctx.request_id,
          "NONE",
          409,
        );
      }
      throw new Error("HOLIDAY_CREATE_FAILED");
    }

    log({
      level: "INFO",
      request_id: ctx.request_id,
      gate_id: "HR.CALENDAR",
      route_key: routeKey,
      event: "HOLIDAY_CREATED",
      actor: ctx.auth_user_id,
      meta: { holiday_id: data.holiday_id, company_id: ctx.context.companyId, holiday_date: holidayDate },
    });

    return okResponse({ holiday: data }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "HOLIDAY_CREATE_EXCEPTION",
      "holiday create exception",
      ctx.request_id,
    );
  }
}

// ---------------------------------------------------------------------------
// Handler 3 — Update holiday (HR_CALENDAR_MANAGE)
// PATCH /api/hr/calendar/holidays
// Body: { holiday_id, holiday_date?, holiday_name? }
// ---------------------------------------------------------------------------

export async function updateHolidayHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  const routeKey = "PATCH:/api/hr/calendar/holidays";

  try {
    assertHrBusinessContext(ctx);

    const denied = await assertCalendarManagePermission(
      ctx,
      ctx.context.companyId,
      ctx.context.workContextId,
    );
    if (denied) return denied;

    const body = await req.json().catch(() => ({}));
    const holidayId = String(body?.holiday_id ?? "").trim();

    if (!holidayId) {
      return errorResponse(
        "HOLIDAY_ID_REQUIRED",
        "holiday_id required",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    // Load and verify company isolation
    const { data: existing, error: loadError } = await serviceRoleClient
      .schema("erp_hr")
      .from("company_holiday_calendar")
      .select("holiday_id, company_id")
      .eq("holiday_id", holidayId)
      .maybeSingle();

    if (loadError || !existing) {
      return errorResponse("HOLIDAY_NOT_FOUND", "holiday not found", ctx.request_id, "NONE", 404);
    }

    if (existing.company_id !== ctx.context.companyId) {
      return errorResponse(
        "HOLIDAY_FORBIDDEN",
        "cannot modify another company's holiday",
        ctx.request_id,
        "NONE",
        403,
      );
    }

    const updates: Record<string, unknown> = {};

    if (body?.holiday_date !== undefined) {
      updates.holiday_date = normalizeIsoDate(String(body.holiday_date).trim());
    }

    if (body?.holiday_name !== undefined) {
      const name = String(body.holiday_name).trim();
      if (!name) {
        return errorResponse(
          "HOLIDAY_NAME_REQUIRED",
          "holiday_name cannot be empty",
          ctx.request_id,
          "NONE",
          400,
        );
      }
      if (name.length > 100) {
        return errorResponse(
          "HOLIDAY_NAME_TOO_LONG",
          "holiday_name must be 100 characters or fewer",
          ctx.request_id,
          "NONE",
          400,
        );
      }
      updates.holiday_name = name;
    }

    if (Object.keys(updates).length === 0) {
      return errorResponse(
        "HOLIDAY_NO_CHANGES",
        "no updatable fields provided",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    const { data: updated, error: updateError } = await serviceRoleClient
      .schema("erp_hr")
      .from("company_holiday_calendar")
      .update(updates)
      .eq("holiday_id", holidayId)
      .select("holiday_id, holiday_date, holiday_name, created_at")
      .single();

    if (updateError) {
      if (updateError.code === "23505" || updateError.message?.includes("unique")) {
        return errorResponse(
          "HOLIDAY_DATE_DUPLICATE",
          "a holiday already exists for this date",
          ctx.request_id,
          "NONE",
          409,
        );
      }
      throw new Error("HOLIDAY_UPDATE_FAILED");
    }

    log({
      level: "INFO",
      request_id: ctx.request_id,
      gate_id: "HR.CALENDAR",
      route_key: routeKey,
      event: "HOLIDAY_UPDATED",
      actor: ctx.auth_user_id,
      meta: { holiday_id: holidayId, company_id: ctx.context.companyId, changes: Object.keys(updates) },
    });

    return okResponse({ holiday: updated }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "HOLIDAY_UPDATE_EXCEPTION",
      "holiday update exception",
      ctx.request_id,
    );
  }
}

// ---------------------------------------------------------------------------
// Handler 4 — Delete holiday (HR_CALENDAR_MANAGE)
// DELETE /api/hr/calendar/holidays
// Query param: holiday_id
// ---------------------------------------------------------------------------

export async function deleteHolidayHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  const routeKey = "DELETE:/api/hr/calendar/holidays";

  try {
    assertHrBusinessContext(ctx);

    const denied = await assertCalendarManagePermission(
      ctx,
      ctx.context.companyId,
      ctx.context.workContextId,
    );
    if (denied) return denied;

    const url = new URL(req.url);
    const holidayId = url.searchParams.get("holiday_id")?.trim() ?? "";

    if (!holidayId) {
      return errorResponse(
        "HOLIDAY_ID_REQUIRED",
        "holiday_id query param required",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    // Load and verify company isolation before delete
    const { data: existing, error: loadError } = await serviceRoleClient
      .schema("erp_hr")
      .from("company_holiday_calendar")
      .select("holiday_id, company_id, holiday_date")
      .eq("holiday_id", holidayId)
      .maybeSingle();

    if (loadError || !existing) {
      return errorResponse("HOLIDAY_NOT_FOUND", "holiday not found", ctx.request_id, "NONE", 404);
    }

    if (existing.company_id !== ctx.context.companyId) {
      return errorResponse(
        "HOLIDAY_FORBIDDEN",
        "cannot delete another company's holiday",
        ctx.request_id,
        "NONE",
        403,
      );
    }

    const { error: deleteError } = await serviceRoleClient
      .schema("erp_hr")
      .from("company_holiday_calendar")
      .delete()
      .eq("holiday_id", holidayId);

    if (deleteError) {
      throw new Error("HOLIDAY_DELETE_FAILED");
    }

    log({
      level: "INFO",
      request_id: ctx.request_id,
      gate_id: "HR.CALENDAR",
      route_key: routeKey,
      event: "HOLIDAY_DELETED",
      actor: ctx.auth_user_id,
      meta: { holiday_id: holidayId, company_id: ctx.context.companyId, holiday_date: existing.holiday_date },
    });

    return okResponse({ holiday_id: holidayId, deleted: true }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "HOLIDAY_DELETE_EXCEPTION",
      "holiday delete exception",
      ctx.request_id,
    );
  }
}

// ---------------------------------------------------------------------------
// Handler 5 — Get week-off config (any authenticated user)
// GET /api/hr/calendar/week-off
// Returns week_off_days array. If no config row exists, returns default [6, 7].
// ---------------------------------------------------------------------------

export async function getWeekOffConfigHandler(
  _req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);

    const { data } = await serviceRoleClient
      .schema("erp_hr")
      .from("company_week_off_config")
      .select("week_off_days, updated_at")
      .eq("company_id", ctx.context.companyId)
      .maybeSingle();

    const weekOffDays: number[] = (data as { week_off_days: number[] } | null)?.week_off_days ?? [6, 7];

    return okResponse(
      {
        week_off_days: weekOffDays,
        is_default: !data,
        updated_at: (data as { updated_at?: string } | null)?.updated_at ?? null,
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "WEEK_OFF_CONFIG_GET_EXCEPTION",
      "week-off config get exception",
      ctx.request_id,
    );
  }
}

// ---------------------------------------------------------------------------
// Handler 6 — Upsert week-off config (HR_CALENDAR_MANAGE)
// PUT /api/hr/calendar/week-off
// Body: { week_off_days: number[] }  — ISO weekday numbers (1=Mon...7=Sun)
// Validation: 1–6 values, all integers in [1,7], at least one working day remains
// ---------------------------------------------------------------------------

export async function upsertWeekOffConfigHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  const routeKey = "PUT:/api/hr/calendar/week-off";

  try {
    assertHrBusinessContext(ctx);

    const denied = await assertCalendarManagePermission(
      ctx,
      ctx.context.companyId,
      ctx.context.workContextId,
    );
    if (denied) return denied;

    const body = await req.json().catch(() => ({}));
    const rawDays = body?.week_off_days;

    if (!Array.isArray(rawDays)) {
      return errorResponse(
        "WEEK_OFF_DAYS_REQUIRED",
        "week_off_days must be an array of ISO weekday numbers (1–7)",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    if (rawDays.length === 0 || rawDays.length > 6) {
      return errorResponse(
        "WEEK_OFF_DAYS_INVALID_LENGTH",
        "week_off_days must have between 1 and 6 entries (at least one working day must remain)",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    const weekOffDays: number[] = rawDays.map(Number);

    if (weekOffDays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
      return errorResponse(
        "WEEK_OFF_DAYS_INVALID_VALUES",
        "all week_off_days values must be integers between 1 (Mon) and 7 (Sun)",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    // Deduplicate
    const uniqueDays = [...new Set(weekOffDays)];

    const { data, error } = await serviceRoleClient
      .schema("erp_hr")
      .from("company_week_off_config")
      .upsert(
        {
          company_id: ctx.context.companyId,
          week_off_days: uniqueDays,
          updated_at: new Date().toISOString(),
          updated_by: ctx.auth_user_id,
        },
        { onConflict: "company_id" },
      )
      .select("week_off_days, updated_at")
      .single();

    if (error) {
      throw new Error("WEEK_OFF_CONFIG_UPSERT_FAILED");
    }

    log({
      level: "INFO",
      request_id: ctx.request_id,
      gate_id: "HR.CALENDAR",
      route_key: routeKey,
      event: "WEEK_OFF_CONFIG_UPDATED",
      actor: ctx.auth_user_id,
      meta: { company_id: ctx.context.companyId, week_off_days: uniqueDays },
    });

    return okResponse({ week_off_days: data.week_off_days, updated_at: data.updated_at }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "WEEK_OFF_CONFIG_UPSERT_EXCEPTION",
      "week-off config upsert exception",
      ctx.request_id,
    );
  }
}
