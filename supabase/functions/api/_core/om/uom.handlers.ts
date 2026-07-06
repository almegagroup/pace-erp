/*
 * File-ID: 14.6
 * File-Path: supabase/functions/api/_core/om/uom.handlers.ts
 * Gate: 14
 * Phase: 14
 * Domain: MASTER
 * Purpose: Implement UOM list and SA-only create handlers.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { OmHandlerContext } from "./shared.ts";
import { assertManagerOrSARole, assertOmSaContext } from "./shared.ts";

type JsonRecord = Record<string, unknown>;

const UOM_TYPE_MAP: Record<string, string> = {
  MASS: "WEIGHT",
  WEIGHT: "WEIGHT",
  VOLUME: "VOLUME",
  LENGTH: "LENGTH",
  COUNT: "COUNT",
  EACH: "COUNT",
  PACKING: "PACKING",
};

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function uomErrorResponse(
  req: Request,
  ctx: OmHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

export async function listUomHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);

    const isActive = new URL(req.url).searchParams.get("is_active");
    let query = serviceRoleClient
      .schema("erp_master")
      .from("uom_master")
      .select("*")
      .order("code", { ascending: true });

    if (isActive === "true") {
      query = query.eq("active", true);
    } else if (isActive === "false") {
      query = query.eq("active", false);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error("OM_UOM_LIST_FAILED");
    }

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_UOM_LIST_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : 500;
    return uomErrorResponse(req, ctx, code, status, "UOM list failed");
  }
}

export async function createUomHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmSaContext(ctx);

    const body = await parseBody(req);
    const uomCode = toTrimmedString(body.uom_code || body.code).toUpperCase();
    const uomName = toTrimmedString(body.uom_name || body.name);
    const rawType = toTrimmedString(body.uom_type).toUpperCase();
    const mappedType = UOM_TYPE_MAP[rawType] ?? "";

    if (!uomCode || !/^[A-Z0-9_]{1,10}$/.test(uomCode)) {
      return uomErrorResponse(req, ctx, "OM_INVALID_UOM_CODE", 400, "Invalid UOM code");
    }
    if (!uomName || !mappedType) {
      return uomErrorResponse(req, ctx, "OM_INVALID_UOM_TYPE", 400, "Invalid UOM type");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("uom_master")
      .insert({
        code: uomCode,
        name: uomName,
        uom_type: mappedType,
        active: true,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return uomErrorResponse(req, ctx, "OM_UOM_EXISTS", 409, "UOM already exists");
      }
      throw new Error("OM_UOM_CREATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_UOM_CREATE_FAILED";
    const status = code === "OM_SA_REQUIRED" ? 403 : code.includes("EXISTS") ? 409 : code.includes("INVALID") ? 400 : 500;
    return uomErrorResponse(req, ctx, code, status, "UOM create failed");
  }
}

export async function updateUomHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmSaContext(ctx);

    const body = await parseBody(req);
    const uomCode = toTrimmedString(body.code).toUpperCase();
    const uomName = toTrimmedString(body.name);
    const rawType = toTrimmedString(body.uom_type).toUpperCase();
    const mappedType = rawType ? (UOM_TYPE_MAP[rawType] ?? "") : "";

    if (!uomCode) {
      return uomErrorResponse(req, ctx, "OM_INVALID_UOM_CODE", 400, "UOM code required");
    }
    if (!uomName) {
      return uomErrorResponse(req, ctx, "OM_INVALID_UOM_NAME", 400, "UOM name required");
    }
    if (rawType && !mappedType) {
      return uomErrorResponse(req, ctx, "OM_INVALID_UOM_TYPE", 400, "Invalid UOM type");
    }

    const updates: Record<string, unknown> = {};
    if (uomName) updates.name = uomName;
    if (mappedType) updates.uom_type = mappedType;

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("uom_master")
      .update(updates)
      .eq("code", uomCode)
      .select("*")
      .single();

    if (error || !data) {
      return uomErrorResponse(req, ctx, "OM_UOM_NOT_FOUND", 404, "UOM not found");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_UOM_UPDATE_FAILED";
    const status = code === "OM_SA_REQUIRED" ? 403 : 500;
    return uomErrorResponse(req, ctx, code, status, "UOM update failed");
  }
}

export async function toggleUomHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmSaContext(ctx);

    const body = await parseBody(req);
    const uomCode = toTrimmedString(body.code).toUpperCase();
    const active = body.active === true || body.active === "true";

    if (!uomCode) {
      return uomErrorResponse(req, ctx, "OM_INVALID_UOM_CODE", 400, "UOM code required");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("uom_master")
      .update({ active })
      .eq("code", uomCode)
      .select("*")
      .single();

    if (error || !data) {
      return uomErrorResponse(req, ctx, "OM_UOM_NOT_FOUND", 404, "UOM not found");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_UOM_TOGGLE_FAILED";
    const status = code === "OM_SA_REQUIRED" ? 403 : 500;
    return uomErrorResponse(req, ctx, code, status, "UOM toggle failed");
  }
}
