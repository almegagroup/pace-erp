/*
 * File-Path: supabase/functions/api/_core/om/parent_customer.handlers.ts
 * Domain: MASTER
 * Purpose: Implement Parent Customer master handlers — groups several
 *          RM/PM Sales Customer rows under one business entity.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { OmHandlerContext } from "./shared.ts";
import { assertManagerOrSARole } from "./shared.ts";

type JsonRecord = Record<string, unknown>;

const PARENT_CUSTOMER_STATUSES = new Set(["ACTIVE", "INACTIVE"]);

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function parentCustomerErrorResponse(
  req: Request,
  ctx: OmHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

export async function createParentCustomerHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);

    const body = await parseBody(req);
    const name = toTrimmedString(body.parent_customer_name);
    if (!name) {
      return parentCustomerErrorResponse(req, ctx, "OM_INVALID_PARENT_CUSTOMER", 400, "Parent customer name is required");
    }

    const { data: code, error: codeError } = await serviceRoleClient.rpc("generate_parent_customer_code");
    if (codeError || !code) {
      console.error("[createParentCustomerHandler] generate_parent_customer_code RPC failed:", JSON.stringify(codeError));
      throw new Error("OM_PARENT_CUSTOMER_CREATE_FAILED");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("parent_customer_master")
      .insert({
        parent_customer_code: code,
        parent_customer_name: name,
        gst_number: toTrimmedString(body.gst_number) || null,
        address: toTrimmedString(body.address) || null,
        status: "ACTIVE",
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error || !data) {
      console.error("[createParentCustomerHandler] insert failed:", JSON.stringify(error));
      throw new Error("OM_PARENT_CUSTOMER_CREATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    console.error("[createParentCustomerHandler] caught error:", err);
    const code = (err as Error).message || "OM_PARENT_CUSTOMER_CREATE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("INVALID") ? 400 : 500;
    return parentCustomerErrorResponse(req, ctx, code, status, "Parent customer create failed");
  }
}

export async function listParentCustomersHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);

    const url = new URL(req.url);
    const status = toTrimmedString(url.searchParams.get("status")).toUpperCase();

    let query = serviceRoleClient
      .schema("erp_master")
      .from("parent_customer_master")
      .select("*")
      .order("parent_customer_name", { ascending: true });

    if (status) {
      query = query.eq("status", status);
    } else {
      query = query.eq("status", "ACTIVE");
    }

    const { data, error } = await query;
    if (error) {
      throw new Error("OM_PARENT_CUSTOMER_LIST_FAILED");
    }

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_PARENT_CUSTOMER_LIST_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : 500;
    return parentCustomerErrorResponse(req, ctx, code, status, "Parent customer list failed");
  }
}

export async function updateParentCustomerHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);

    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    if (!id) {
      return parentCustomerErrorResponse(req, ctx, "OM_PARENT_CUSTOMER_NOT_FOUND", 404, "Parent customer not found");
    }

    const updates: JsonRecord = {
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    };

    if (body.parent_customer_name !== undefined) {
      const name = toTrimmedString(body.parent_customer_name);
      if (!name) {
        return parentCustomerErrorResponse(req, ctx, "OM_INVALID_PARENT_CUSTOMER", 400, "Parent customer name is required");
      }
      updates.parent_customer_name = name;
    }
    if (body.gst_number !== undefined) {
      updates.gst_number = toTrimmedString(body.gst_number) || null;
    }
    if (body.address !== undefined) {
      updates.address = toTrimmedString(body.address) || null;
    }
    if (body.status !== undefined) {
      const status = toTrimmedString(body.status).toUpperCase();
      if (!PARENT_CUSTOMER_STATUSES.has(status)) {
        return parentCustomerErrorResponse(req, ctx, "OM_INVALID_STATUS", 400, "Invalid status");
      }
      updates.status = status;
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("parent_customer_master")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_PARENT_CUSTOMER_UPDATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_PARENT_CUSTOMER_UPDATE_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("INVALID") ? 400 : 500;
    return parentCustomerErrorResponse(req, ctx, code, status, "Parent customer update failed");
  }
}
