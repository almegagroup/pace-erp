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
// Only the Process PO types that actually require a machine assignment
// (process_order.handlers.ts's own REQUIRED_MACHINE_TYPES) -- MTEST never
// shows a Machine field on Process PO Create at all, so it has no map entry.
const MACHINE_PO_TYPES = new Set(["MTO", "HPS", "MTS", "INT"]);

function parsePoTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const v of value) {
    const t = toTrimmedString(v).toUpperCase();
    if (MACHINE_PO_TYPES.has(t)) out.add(t);
  }
  return [...out];
}

async function getPoTypesMapByMachineIds(machineIds: string[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(machineIds.filter(Boolean))];
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("machine_po_type_map")
    .select("machine_id, po_type")
    .in("machine_id", ids);
  if (error) {
    console.error("[machine.getPoTypesMap] query failed:", JSON.stringify(error));
    throw new Error("OM_MACHINE_LIST_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) {
    const machineId = String(row.machine_id ?? "");
    const list = map.get(machineId) ?? [];
    list.push(String(row.po_type ?? ""));
    map.set(machineId, list);
  }
  return map;
}

async function assertLocationInCompany(companyId: string, storageLocationId: string): Promise<void> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_plant_map")
    .select("id")
    .eq("company_id", companyId)
    .eq("storage_location_id", storageLocationId)
    .limit(1);
  if (error) throw new Error("OM_MACHINE_STORAGE_LOCATION_INVALID");
  if (!data || data.length === 0) throw new Error("OM_MACHINE_STORAGE_LOCATION_INVALID");
}

async function replaceMachinePoTypes(machineId: string, poTypes: string[]): Promise<void> {
  const { error: delErr } = await serviceRoleClient
    .schema("erp_master")
    .from("machine_po_type_map")
    .delete()
    .eq("machine_id", machineId);
  if (delErr) throw new Error("OM_MACHINE_PO_TYPE_SAVE_FAILED");
  if (poTypes.length === 0) return;
  const { error: insErr } = await serviceRoleClient
    .schema("erp_master")
    .from("machine_po_type_map")
    .insert(poTypes.map((po_type) => ({ machine_id: machineId, po_type })));
  if (insErr) throw new Error("OM_MACHINE_PO_TYPE_SAVE_FAILED");
}

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

    const storageLocationId = toTrimmedString(body.storage_location_id) || null;
    if (storageLocationId) {
      try {
        await assertLocationInCompany(companyId, storageLocationId);
      } catch {
        return machineErrorResponse(req, ctx, "OM_MACHINE_STORAGE_LOCATION_INVALID", 400, "Storage location does not belong to this company");
      }
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
        storage_location_id: storageLocationId,
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

    const poTypes = parsePoTypes(body.po_types);
    if (poTypes.length > 0) {
      await replaceMachinePoTypes(String((data as JsonRecord).id), poTypes);
    }
    (data as JsonRecord).po_types = poTypes;

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
    const poType = toTrimmedString(url.searchParams.get("po_type")).toUpperCase();
    const storageLocationId = toTrimmedString(url.searchParams.get("storage_location_id"));

    let query = serviceRoleClient
      .schema("erp_master")
      .from("machine_master")
      .select(
        "*, cost_center:cost_center_id(id, cost_center_code, cost_center_name), storage_location:storage_location_id(id, code, name)",
      )
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
    // Location filter is fail-open (§138.1/§138.2): a machine with NO
    // storage_location_id mapped yet still shows up for every location
    // filter -- same discipline as the po_type fail-open rule below, so
    // existing machines don't vanish from Process PO Create the moment a
    // Stroke-location filter is wired in, before SA has mapped them.
    // UUID-shape validated before interpolating into the .or() filter string.
    if (storageLocationId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storageLocationId)) {
      query = query.or(`storage_location_id.eq.${storageLocationId},storage_location_id.is.null`);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[machine.listMachines] query failed:", JSON.stringify(error));
      throw new Error("OM_MACHINE_LIST_FAILED");
    }

    const rows = (data ?? []) as JsonRecord[];
    const poTypesMap = await getPoTypesMapByMachineIds(rows.map((row) => String(row.id ?? "")));
    // A machine with NO po_types configured yet is fail-open (shows for every
    // po_type filter) -- existing machines predate this feature and would
    // otherwise vanish from every Process PO Create dropdown the moment this
    // shipped, blocking production until SA visits all of them. Once SA
    // assigns at least one po_type, the filter becomes real for that machine.
    const withPoTypes = rows.map((row) => ({ ...row, po_types: poTypesMap.get(String(row.id ?? "")) ?? [] }));
    const filtered = poType
      ? withPoTypes.filter((row) => row.po_types.length === 0 || row.po_types.includes(poType))
      : withPoTypes;

    return okResponse({ data: filtered }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MACHINE_LIST_FAILED";
    // OM_MACHINE_LIST_FAILED is already logged with detail at its two throw sites
    // above; anything else reaching here is unexpected (e.g. a bug in this
    // handler itself), so log it too instead of only surfacing the public code.
    if (code !== "OM_ADMIN_REQUIRED" && code !== "OM_MACHINE_LIST_FAILED") {
      console.error(
        "[machine.listMachines] unhandled:",
        err instanceof Error ? (err.stack ?? err.message) : String(err),
      );
    }
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

    const patch: JsonRecord = {
      machine_name: machineName,
      machine_type: machineType,
      capacity_per_batch: capacityPerBatch,
      capacity_uom_code: toTrimmedString(body.capacity_uom_code).toUpperCase() || null,
      cost_center_id: toTrimmedString(body.cost_center_id) || null,
      description: toTrimmedString(body.description) || null,
    };

    if (Object.prototype.hasOwnProperty.call(body, "storage_location_id")) {
      const storageLocationId = toTrimmedString(body.storage_location_id) || null;
      if (storageLocationId) {
        const { data: existing, error: fetchErr } = await serviceRoleClient
          .schema("erp_master")
          .from("machine_master")
          .select("company_id")
          .eq("id", id)
          .single();
        if (fetchErr || !existing) throw new Error("OM_MACHINE_UPDATE_FAILED");
        try {
          await assertLocationInCompany(String((existing as JsonRecord).company_id), storageLocationId);
        } catch {
          return machineErrorResponse(req, ctx, "OM_MACHINE_STORAGE_LOCATION_INVALID", 400, "Storage location does not belong to this company");
        }
      }
      patch.storage_location_id = storageLocationId;
    }

    const { error } = await serviceRoleClient
      .schema("erp_master")
      .from("machine_master")
      .update(patch)
      .eq("id", id);

    if (error) throw new Error("OM_MACHINE_UPDATE_FAILED");

    if (Object.prototype.hasOwnProperty.call(body, "po_types")) {
      await replaceMachinePoTypes(id, parsePoTypes(body.po_types));
    }

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
