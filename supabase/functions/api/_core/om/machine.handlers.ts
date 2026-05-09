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
import { assertOmAdminContext, assertOmSaContext } from "./shared.ts";

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
    const plantId = toTrimmedString(body.plant_id);
    const machineCode = toTrimmedString(body.machine_code).toUpperCase();
    const machineName = toTrimmedString(body.machine_name);
    const machineType = toTrimmedString(body.machine_type).toUpperCase();
    const capacityPerBatch = body.capacity_per_batch != null && body.capacity_per_batch !== ""
      ? Number(body.capacity_per_batch)
      : null;

    if (!plantId || !machineCode || !machineName || !MACHINE_TYPES.has(machineType)) {
      return machineErrorResponse(req, ctx, "OM_MACHINE_CREATE_FAILED", 400, "Invalid machine input");
    }
    if (capacityPerBatch != null && (!Number.isFinite(capacityPerBatch) || capacityPerBatch <= 0)) {
      return machineErrorResponse(req, ctx, "OM_MACHINE_CREATE_FAILED", 400, "Invalid machine capacity");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("machine_master")
      .insert({
        plant_id: plantId,
        machine_code: machineCode,
        machine_name: machineName,
        machine_type: machineType,
        capacity_per_batch: capacityPerBatch,
        capacity_uom_code: toTrimmedString(body.capacity_uom_code).toUpperCase() || null,
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
    assertOmAdminContext(ctx);

    const url = new URL(req.url);
    const plantId = toTrimmedString(url.searchParams.get("plant_id"));
    const machineType = toTrimmedString(url.searchParams.get("machine_type")).toUpperCase();
    const active = url.searchParams.get("active");

    let query = serviceRoleClient
      .schema("erp_master")
      .from("machine_master")
      .select("*")
      .order("machine_code", { ascending: true });

    if (plantId) {
      query = query.eq("plant_id", plantId);
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
