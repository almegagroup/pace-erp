/*
 * PO22 column layouts (owner 2026-10-28): a user hides the columns of a PO22 report, saves the choice under a name, picks it again later, and the
 * Excel follows the same layout. Storage and rules are the shared report-layout handlers (personal layout for anyone with VIEW, Global for SA / GA).
 * These thin routes exist so PO22 users need the PO22 Requirement VIEW right, not the Stock Ledger one; they accept only report codes that start
 * with PO22 and forward to the shared handlers unchanged.
 */
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse } from "../response.ts";
import {
  createReportLayoutHandler,
  deleteReportLayoutHandler,
  listReportLayoutsHandler,
  setDefaultReportLayoutHandler,
  updateReportLayoutHandler,
} from "./report_layout.handlers.ts";

type LayoutCtx = Parameters<typeof listReportLayoutsHandler>[1];

const SHARED_BASE = "/api/procurement/report-layouts";
export const isMtsReportCode = (code: unknown): boolean => /^PO22(_[A-Z0-9_]+)?$/.test(String(code ?? "").trim().toUpperCase());

function deny(req: Request, ctx: LayoutCtx, message: string): Response {
  return errorResponse("REPORT_LAYOUT_REPORT_CODE_INVALID", message, ctx.request_id, "NONE", 400, {}, req);
}

function sharedUrl(req: Request, suffix: string): URL {
  const url = new URL(req.url);
  url.pathname = `${SHARED_BASE}${suffix}`;
  return url;
}

/** …/mts-requirement/layouts/<id>[/set-default] → the layout id. */
function layoutIdOf(req: Request): string {
  return new URL(req.url).pathname.split("/").filter(Boolean)[4] ?? "";
}

async function layoutIsPo22(layoutId: string): Promise<boolean> {
  if (!layoutId) return false;
  const { data } = await serviceRoleClient.schema("erp_inventory").from("report_column_layout").select("report_code").eq("id", layoutId).maybeSingle();
  return isMtsReportCode((data as { report_code?: unknown } | null)?.report_code);
}

export async function listMtsReportLayoutsHandler(req: Request, ctx: LayoutCtx): Promise<Response> {
  const code = new URL(req.url).searchParams.get("report_code");
  if (!isMtsReportCode(code)) return deny(req, ctx, "Only PO22 report layouts can be listed here.");
  const url = sharedUrl(req, "");
  return await listReportLayoutsHandler(new Request(url, { method: "GET", headers: req.headers }), ctx);
}

export async function createMtsReportLayoutHandler(req: Request, ctx: LayoutCtx): Promise<Response> {
  const body = await req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
  if (!isMtsReportCode(body.report_code)) return deny(req, ctx, "Only PO22 report layouts can be saved here.");
  return await createReportLayoutHandler(new Request(sharedUrl(req, ""), { method: "POST", headers: req.headers, body: JSON.stringify(body) }), ctx);
}

export async function updateMtsReportLayoutHandler(req: Request, ctx: LayoutCtx): Promise<Response> {
  const id = layoutIdOf(req);
  if (!(await layoutIsPo22(id))) return deny(req, ctx, "Not a PO22 report layout.");
  const body = await req.text();
  return await updateReportLayoutHandler(new Request(sharedUrl(req, `/${encodeURIComponent(id)}`), { method: "PATCH", headers: req.headers, body }), ctx);
}

export async function deleteMtsReportLayoutHandler(req: Request, ctx: LayoutCtx): Promise<Response> {
  const id = layoutIdOf(req);
  if (!(await layoutIsPo22(id))) return deny(req, ctx, "Not a PO22 report layout.");
  return await deleteReportLayoutHandler(new Request(sharedUrl(req, `/${encodeURIComponent(id)}`), { method: "DELETE", headers: req.headers }), ctx);
}

export async function setDefaultMtsReportLayoutHandler(req: Request, ctx: LayoutCtx): Promise<Response> {
  const id = layoutIdOf(req);
  if (!(await layoutIsPo22(id))) return deny(req, ctx, "Not a PO22 report layout.");
  return await setDefaultReportLayoutHandler(new Request(sharedUrl(req, `/${encodeURIComponent(id)}/set-default`), { method: "POST", headers: req.headers }), ctx);
}
