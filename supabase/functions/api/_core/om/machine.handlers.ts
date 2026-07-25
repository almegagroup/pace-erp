/*
 * File-ID: 12B.4
 * File-Path: supabase/functions/api/_core/om/machine.handlers.ts
 * Gate: 12B
 * Phase: 12B
 * Domain: MASTER
 * Purpose: Machine/mixer master CRUD handlers (SA-governed).
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { OmHandlerContext } from "./shared.ts";
import { assertOmReadContext, assertOmSaContext } from "./shared.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";

type JsonRecord = Record<string, unknown>;

const MACHINE_TYPES = new Set(["MIXER", "FILLING", "PACKAGING", "REACTOR", "OTHER"]);

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function machineErrorResponse(
  req: Request,
  ctx: OmHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

export async function createMachineHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmSaContext(ctx);

    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const machineCode = toTrimmedString(body.machine_code).toUpperCase();
    const machineName = toTrimmedString(body.machine_name);
    const machineType = toTrimmedString(body.machine_type).toUpperCase();
    const capacityPerBatch = body.capacity_per_batch != null && body.capacity_per_batch !== ""
      ? Number(body.capacity_per_batch)
      : null;

    if (!companyId || !machineCode || !machineName || !MACHINE_TYPES.has(machineType)) {
      return machineErrorResponse(req, ctx, "OM_MACHINE_CREATE_FAILED", 400, "Invalid machine input");
    }
    if (capacityPerBatch != null && (!Number.isFinite(capacityPerBatch) || capacityPerBatch <= 0)) {
      return machineErrorResponse(req, ctx, "OM_MACHINE_CREATE_FAILED", 400, "Invalid machine capacity");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return machineErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("machine_master")
      .insert({
        company_id: companyId,
        machine_code: machineCode,
        machine_name: machineName,
        machine_type: machineType,
        capacity_per_batch: capacityPerBatch,
        capacity_uom_code: toTrimmedString(body.capacity_uom_code).toUpperCase() || null,
        cost_center_id: toTrimmedString(body.cost_center_id) || null,
        description: toTrimmedString(body.description) || null,
        active: true,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return machineErrorResponse(req, ctx, "OM_MACHINE_EXISTS", 409, "Machine already exists");
      }
      throw new Error("OM_MACHINE_CREATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MACHINE_CREATE_FAILED";
    const status = code === "OM_SA_REQUIRED" ? 403 : code.includes("EXISTS") ? 409 : code.includes("FAILED") ? 400 : 500;
    return machineErrorResponse(req, ctx, code, status, "Machine create failed");
  }
}

export async function listMachinesHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmReadContext(ctx);

    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const machineType = toTrimmedString(url.searchParams.get("machine_type")).toUpperCase();
    const active = url.searchParams.get("active");

    let query = serviceRoleClient
      .schema("erp_master")
      .from("machine_master")
      .select("*, cost_center:cost_center_id(id, cost_center_code, cost_center_name)")
      .order("machine_code", { ascending: true });

    if (companyId) {
      query = query.eq("company_id", companyId);
    }
    if (machineType) {
      query = query.eq("machine_type", machineType);
    }
    if (active === "true") {
      query = query.eq("active", true);
    } else if (active === "false") {
      query = query.eq("active", false);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error("OM_MACHINE_LIST_FAILED");
    }

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MACHINE_LIST_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return machineErrorResponse(req, ctx, code, status, "Machine list failed");
  }
}

export async function updateMachineHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmSaContext(ctx);

    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    const machineName = toTrimmedString(body.machine_name);
    const machineType = toTrimmedString(body.machine_type).toUpperCase();
    const capacityPerBatch = body.capacity_per_batch != null && body.capacity_per_batch !== ""
      ? Number(body.capacity_per_batch)
      : null;

    if (!id || !machineName || !MACHINE_TYPES.has(machineType)) {
      return machineErrorResponse(req, ctx, "OM_MACHINE_UPDATE_FAILED", 400, "Invalid update input");
    }
    if (capacityPerBatch != null && (!Number.isFinite(capacityPerBatch) || capacityPerBatch <= 0)) {
      return machineErrorResponse(req, ctx, "OM_MACHINE_UPDATE_FAILED", 400, "Invalid machine capacity");
    }

    const { error } = await serviceRoleClient
      .schema("erp_master")
      .from("machine_master")
      .update({
        machine_name: machineName,
        machine_type: machineType,
        capacity_per_batch: capacityPerBatch,
        capacity_uom_code: toTrimmedString(body.capacity_uom_code).toUpperCase() || null,
        cost_center_id: toTrimmedString(body.cost_center_id) || null,
        description: toTrimmedString(body.description) || null,
      })
      .eq("id", id);

    if (error) throw new Error("OM_MACHINE_UPDATE_FAILED");

    return okResponse({ ok: true }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MACHINE_UPDATE_FAILED";
    const status = code === "OM_SA_REQUIRED" ? 403 : 400;
    return machineErrorResponse(req, ctx, code, status, "Machine update failed");
  }
}

export async function toggleMachineHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmSaContext(ctx);

    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    const active = body.active === true || body.active === "true";

    if (!id) {
      return machineErrorResponse(req, ctx, "OM_MACHINE_TOGGLE_FAILED", 400, "Machine ID required");
    }

    const { error } = await serviceRoleClient
      .schema("erp_master")
      .from("machine_master")
      .update({ active })
      .eq("id", id);

    if (error) throw new Error("OM_MACHINE_TOGGLE_FAILED");

    return okResponse({ ok: true }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MACHINE_TOGGLE_FAILED";
    const status = code === "OM_SA_REQUIRED" ? 403 : 400;
    return machineErrorResponse(req, ctx, code, status, "Machine toggle failed");
  }
}
