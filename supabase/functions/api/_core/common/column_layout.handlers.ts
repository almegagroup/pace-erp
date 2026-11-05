/*
 * File-Path: supabase/functions/api/_core/common/column_layout.handlers.ts
 * Purpose: Common column-picker layouts for EVERY report/list page (business owner 2026-11-05): each user keeps at most
 *          MAX_USER_LAYOUTS personal layouts per page, names them, picks one from the picker's dropdown and may set one
 *          as their default. A layout is the ordered list of its visible column keys.
 *          Storage + CRUD/default rules are the shared report-layout handlers (erp_inventory.report_column_layout); these thin
 *          routes add what a page-agnostic endpoint needs: a safe page code, the per-user limit, and "Global layouts are
 *          created/edited by admins (SA/GA) only". They are personal UI preferences (no business data), so the routes are
 *          session-only -- no page ACL -- and every row is scoped to the caller (USER) or is a read-only Global.
 * Authority: Backend
 */
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse } from "../response.ts";
import {
  createReportLayoutHandler,
  deleteReportLayoutHandler,
  listReportLayoutsHandler,
  setDefaultReportLayoutHandler,
  updateReportLayoutHandler,
} from "../procurement/report_layout.handlers.ts";

type LayoutCtx = Parameters<typeof listReportLayoutsHandler>[1];

export const MAX_USER_LAYOUTS = 3;
const SHARED_CREATE_URL = "/api/procurement/report-layouts";
const PAGE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_.\-]{1,59}$/;

const normalizePageCode = (value: unknown): string => String(value ?? "").trim().toUpperCase();

function fail(req: Request, ctx: LayoutCtx, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

/** …/column-layouts/<id>[/set-default] → the layout id. */
function layoutIdOf(req: Request): string {
  return new URL(req.url).pathname.split("/").filter(Boolean)[3] ?? "";
}

async function loadLayout(layoutId: string): Promise<{ scope?: string; owner_user_id?: string } | null> {
  if (!layoutId) return null;
  const { data } = await serviceRoleClient.schema("erp_inventory").from("report_column_layout")
    .select("scope, owner_user_id").eq("id", layoutId).maybeSingle();
  return (data as { scope?: string; owner_user_id?: string } | null) ?? null;
}

export async function listColumnLayoutsHandler(req: Request, ctx: LayoutCtx): Promise<Response> {
  if (!PAGE_CODE_PATTERN.test(normalizePageCode(new URL(req.url).searchParams.get("report_code")))) {
    return fail(req, ctx, "REPORT_LAYOUT_REPORT_CODE_INVALID", 400, "A valid report_code is required.");
  }
  return await listReportLayoutsHandler(req, ctx);
}

export async function createColumnLayoutHandler(req: Request, ctx: LayoutCtx): Promise<Response> {
  const body = await req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
  const reportCode = normalizePageCode(body.report_code);
  if (!PAGE_CODE_PATTERN.test(reportCode)) {
    return fail(req, ctx, "REPORT_LAYOUT_REPORT_CODE_INVALID", 400, "A valid report_code is required.");
  }
  const scope = String(body.scope ?? "USER").toUpperCase();
  if (scope === "GLOBAL") {
    if (!ctx.context.isAdmin) {
      return fail(req, ctx, "REPORT_LAYOUT_SCOPE_FORBIDDEN", 403, "Only SA/GA can create a Global layout.");
    }
  } else {
    const { count, error } = await serviceRoleClient.schema("erp_inventory").from("report_column_layout")
      .select("id", { count: "exact", head: true })
      .eq("report_code", reportCode).eq("scope", "USER").eq("owner_user_id", ctx.auth_user_id);
    if (error) return fail(req, ctx, "REPORT_LAYOUT_CREATE_FAILED", 500, "Unable to create report layout.");
    if ((count ?? 0) >= MAX_USER_LAYOUTS) {
      return fail(
        req, ctx, "REPORT_LAYOUT_LIMIT_REACHED", 409,
        `You can keep at most ${MAX_USER_LAYOUTS} layouts for this page. Delete one, or use Save Changes to update an existing layout.`,
      );
    }
  }
  return await createReportLayoutHandler(
    new Request(new URL(SHARED_CREATE_URL, req.url), { method: "POST", headers: req.headers, body: JSON.stringify({ ...body, report_code: reportCode, scope }) }),
    ctx,
  );
}

async function guardedGlobal(req: Request, ctx: LayoutCtx): Promise<Response | null> {
  const layout = await loadLayout(layoutIdOf(req));
  if (!layout) return fail(req, ctx, "REPORT_LAYOUT_NOT_FOUND", 404, "Layout not found.");
  if (String(layout.scope).toUpperCase() === "GLOBAL" && !ctx.context.isAdmin) {
    return fail(req, ctx, "REPORT_LAYOUT_SCOPE_FORBIDDEN", 403, "Only SA/GA can change a Global layout.");
  }
  return null;
}

export async function updateColumnLayoutHandler(req: Request, ctx: LayoutCtx): Promise<Response> {
  return (await guardedGlobal(req, ctx)) ?? await updateReportLayoutHandler(req, ctx);
}

export async function deleteColumnLayoutHandler(req: Request, ctx: LayoutCtx): Promise<Response> {
  return (await guardedGlobal(req, ctx)) ?? await deleteReportLayoutHandler(req, ctx);
}

export async function setDefaultColumnLayoutHandler(req: Request, ctx: LayoutCtx): Promise<Response> {
  // Anyone may make a layout (their own, or a Global one) THEIR default; no Global guard.
  return await setDefaultReportLayoutHandler(req, ctx);
}
