/*
 * File-ID: 24.4
 * File-Path: supabase/functions/api/_core/procurement/report_layout.handlers.ts
 * Gate: 24
 * Phase: 24
 * Domain: PROCUREMENT
 * Purpose: Shared report column layout CRUD/default handlers for inventory reports.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type ReportLayoutHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const ALLOWED_SCOPES = new Set(["GLOBAL", "USER"]);

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function getPathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}

function getLayoutIdFromPath(req: Request): string {
  return getPathSegments(req)[3] ?? "";
}

function reportLayoutError(
  req: Request,
  ctx: ReportLayoutHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function normalizeVisibleColumns(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((entry) => toTrimmedString(entry)).filter(Boolean))];
}

function normalizeScope(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}

async function fetchLayoutById(layoutId: string) {
  return await serviceRoleClient
    .schema("erp_inventory")
    .from("report_column_layout")
    .select("id, report_code, scope, owner_user_id, layout_name, visible_columns, created_by, created_at")
    .eq("id", layoutId)
    .maybeSingle();
}

export async function listReportLayoutsHandler(
  req: Request,
  ctx: ReportLayoutHandlerContext,
): Promise<Response> {
  try {
    const reportCode = toTrimmedString(new URL(req.url).searchParams.get("report_code")).toUpperCase();
    if (!reportCode) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_REPORT_CODE_REQUIRED", 400, "report_code is required");
    }

    const [globalResp, userResp, defaultResp] = await Promise.all([
      serviceRoleClient
        .schema("erp_inventory")
        .from("report_column_layout")
        .select("id, report_code, scope, owner_user_id, layout_name, visible_columns, created_by, created_at")
        .eq("report_code", reportCode)
        .eq("scope", "GLOBAL")
        .order("layout_name", { ascending: true }),
      serviceRoleClient
        .schema("erp_inventory")
        .from("report_column_layout")
        .select("id, report_code, scope, owner_user_id, layout_name, visible_columns, created_by, created_at")
        .eq("report_code", reportCode)
        .eq("scope", "USER")
        .eq("owner_user_id", ctx.auth_user_id)
        .order("layout_name", { ascending: true }),
      serviceRoleClient
        .schema("erp_inventory")
        .from("report_layout_default")
        .select("layout_id")
        .eq("auth_user_id", ctx.auth_user_id)
        .eq("report_code", reportCode)
        .maybeSingle(),
    ]);

    if (globalResp.error || userResp.error || defaultResp.error) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_LIST_FAILED", 500, "Unable to fetch report layouts.");
    }

    const rows = [
      ...((globalResp.data ?? []) as JsonRecord[]),
      ...((userResp.data ?? []) as JsonRecord[]),
    ];

    return okResponse(
      {
        data: rows,
        default_layout_id: toTrimmedString(defaultResp.data?.layout_id) || null,
      },
      ctx.request_id,
      req,
    );
  } catch {
    return reportLayoutError(req, ctx, "REPORT_LAYOUT_LIST_FAILED", 500, "Unable to fetch report layouts.");
  }
}

export async function createReportLayoutHandler(
  req: Request,
  ctx: ReportLayoutHandlerContext,
): Promise<Response> {
  try {
    const body = await parseBody(req);
    const reportCode = toTrimmedString(body.report_code).toUpperCase();
    const scope = normalizeScope(body.scope || "USER");
    const layoutName = toTrimmedString(body.layout_name);
    const visibleColumns = normalizeVisibleColumns(body.visible_columns);

    if (!reportCode || !ALLOWED_SCOPES.has(scope) || !layoutName || visibleColumns.length === 0) {
      return reportLayoutError(
        req,
        ctx,
        "REPORT_LAYOUT_INVALID",
        400,
        "report_code, scope, layout_name, and visible_columns are required",
      );
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_inventory")
      .from("report_column_layout")
      .insert({
        report_code: reportCode,
        scope,
        owner_user_id: scope === "USER" ? ctx.auth_user_id : null,
        layout_name: layoutName,
        visible_columns: visibleColumns,
        created_by: ctx.auth_user_id,
      })
      .select("id, report_code, scope, owner_user_id, layout_name, visible_columns, created_by, created_at")
      .single();

    if (error) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_CREATE_FAILED", 500, "Unable to create report layout.");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch {
    return reportLayoutError(req, ctx, "REPORT_LAYOUT_CREATE_FAILED", 500, "Unable to create report layout.");
  }
}

export async function updateReportLayoutHandler(
  req: Request,
  ctx: ReportLayoutHandlerContext,
): Promise<Response> {
  try {
    const layoutId = toTrimmedString(getLayoutIdFromPath(req));
    if (!layoutId) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_NOT_FOUND", 404, "Layout not found.");
    }

    const existingResp = await fetchLayoutById(layoutId);
    if (existingResp.error) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_UPDATE_FAILED", 500, "Unable to update report layout.");
    }
    const existing = existingResp.data as JsonRecord | null;
    if (!existing) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_NOT_FOUND", 404, "Layout not found.");
    }

    const scope = normalizeScope(existing.scope);
    if (scope !== "GLOBAL" && toTrimmedString(existing.owner_user_id) !== ctx.auth_user_id) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_SCOPE_FORBIDDEN", 403, "You can edit only your own report layouts.");
    }

    const body = await parseBody(req);
    const updates: JsonRecord = {};
    if (body.layout_name !== undefined) {
      const layoutName = toTrimmedString(body.layout_name);
      if (!layoutName) {
        return reportLayoutError(req, ctx, "REPORT_LAYOUT_INVALID", 400, "layout_name cannot be empty");
      }
      updates.layout_name = layoutName;
    }
    if (body.visible_columns !== undefined) {
      const visibleColumns = normalizeVisibleColumns(body.visible_columns);
      if (visibleColumns.length === 0) {
        return reportLayoutError(req, ctx, "REPORT_LAYOUT_INVALID", 400, "visible_columns cannot be empty");
      }
      updates.visible_columns = visibleColumns;
    }
    if (Object.keys(updates).length === 0) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_INVALID", 400, "No changes provided");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_inventory")
      .from("report_column_layout")
      .update(updates)
      .eq("id", layoutId)
      .select("id, report_code, scope, owner_user_id, layout_name, visible_columns, created_by, created_at")
      .single();

    if (error) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_UPDATE_FAILED", 500, "Unable to update report layout.");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch {
    return reportLayoutError(req, ctx, "REPORT_LAYOUT_UPDATE_FAILED", 500, "Unable to update report layout.");
  }
}

export async function deleteReportLayoutHandler(
  req: Request,
  ctx: ReportLayoutHandlerContext,
): Promise<Response> {
  try {
    const layoutId = toTrimmedString(getLayoutIdFromPath(req));
    if (!layoutId) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_NOT_FOUND", 404, "Layout not found.");
    }

    const existingResp = await fetchLayoutById(layoutId);
    if (existingResp.error) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_DELETE_FAILED", 500, "Unable to delete report layout.");
    }
    const existing = existingResp.data as JsonRecord | null;
    if (!existing) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_NOT_FOUND", 404, "Layout not found.");
    }

    const scope = normalizeScope(existing.scope);
    if (scope !== "GLOBAL" && toTrimmedString(existing.owner_user_id) !== ctx.auth_user_id) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_SCOPE_FORBIDDEN", 403, "You can delete only your own report layouts.");
    }

    const defaultDeleteResp = await serviceRoleClient
      .schema("erp_inventory")
      .from("report_layout_default")
      .delete()
      .eq("layout_id", layoutId);
    if (defaultDeleteResp.error) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_DELETE_FAILED", 500, "Unable to delete report layout.");
    }

    const layoutDeleteResp = await serviceRoleClient
      .schema("erp_inventory")
      .from("report_column_layout")
      .delete()
      .eq("id", layoutId);
    if (layoutDeleteResp.error) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_DELETE_FAILED", 500, "Unable to delete report layout.");
    }

    return okResponse({ deleted: true, id: layoutId }, ctx.request_id, req);
  } catch {
    return reportLayoutError(req, ctx, "REPORT_LAYOUT_DELETE_FAILED", 500, "Unable to delete report layout.");
  }
}

export async function setDefaultReportLayoutHandler(
  req: Request,
  ctx: ReportLayoutHandlerContext,
): Promise<Response> {
  try {
    const layoutId = toTrimmedString(getLayoutIdFromPath(req));
    if (!layoutId) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_NOT_FOUND", 404, "Layout not found.");
    }

    const existingResp = await fetchLayoutById(layoutId);
    if (existingResp.error) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_DEFAULT_SET_FAILED", 500, "Unable to set default report layout.");
    }
    const existing = existingResp.data as JsonRecord | null;
    if (!existing) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_NOT_FOUND", 404, "Layout not found.");
    }

    const scope = normalizeScope(existing.scope);
    if (scope === "USER" && toTrimmedString(existing.owner_user_id) !== ctx.auth_user_id) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_SCOPE_FORBIDDEN", 403, "You can set default only to a visible report layout.");
    }

    const reportCode = toTrimmedString(existing.report_code).toUpperCase();
    const { data, error } = await serviceRoleClient
      .schema("erp_inventory")
      .from("report_layout_default")
      .upsert(
        {
          auth_user_id: ctx.auth_user_id,
          report_code: reportCode,
          layout_id: layoutId,
        },
        { onConflict: "auth_user_id,report_code" },
      )
      .select("auth_user_id, report_code, layout_id")
      .single();

    if (error) {
      return reportLayoutError(req, ctx, "REPORT_LAYOUT_DEFAULT_SET_FAILED", 500, "Unable to set default report layout.");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch {
    return reportLayoutError(req, ctx, "REPORT_LAYOUT_DEFAULT_SET_FAILED", 500, "Unable to set default report layout.");
  }
}
