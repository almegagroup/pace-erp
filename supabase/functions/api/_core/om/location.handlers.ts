/*
 * File-ID: 14.7
 * File-Path: supabase/functions/api/_core/om/location.handlers.ts
 * Gate: 14
 * Phase: 14
 * Domain: MASTER
 * Purpose: Implement storage location create, list, and plant-map handlers.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { OmHandlerContext } from "./shared.ts";
import { assertManagerOrSARole, assertOmAdminContext, assertOmSaContext } from "./shared.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";

type JsonRecord = Record<string, unknown>;

const VALID_LOCATION_TYPES = new Set([
  "PHYSICAL", "LOGICAL", "TRANSIT", "WAREHOUSE", "SHOP_FLOOR", "SCRAP", "EXTERNAL",
]);

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function locationErrorResponse(
  req: Request,
  ctx: OmHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

async function ensurePlantExists(plantId: string): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("projects")
    .select("id")
    .eq("id", plantId)
    .maybeSingle();

  return !error && Boolean(data?.id);
}

async function getLocationById(locationId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_master")
    .select("*")
    .eq("id", locationId)
    .maybeSingle();

  if (error) {
    throw new Error("OM_LOCATION_LOOKUP_FAILED");
  }

  return (data as Record<string, unknown> | null) ?? null;
}

export async function createStorageLocationHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmSaContext(ctx);

    const body = await parseBody(req);
    const locationCode = toTrimmedString(body.location_code || body.code).toUpperCase();
    const locationName = toTrimmedString(body.location_name || body.name);
    const locationType = toTrimmedString(body.location_type).toUpperCase();

    if (!locationCode || !locationName || !VALID_LOCATION_TYPES.has(locationType)) {
      return locationErrorResponse(req, ctx, "OM_LOCATION_CREATE_FAILED", 400, "Invalid storage location input");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_inventory")
      .from("storage_location_master")
      .insert({
        code: locationCode,
        name: locationName,
        location_type: locationType,
        is_transit_location: locationType === "TRANSIT",
        dispatch_allowed: body.dispatch_allowed === true,
        qa_hold_flag: body.qa_hold_flag === true,
        active: true,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return locationErrorResponse(req, ctx, "OM_LOCATION_EXISTS", 409, "Storage location already exists");
      }
      throw new Error("OM_LOCATION_CREATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_LOCATION_CREATE_FAILED";
    const status = code === "OM_SA_REQUIRED" ? 403 : code.includes("EXISTS") ? 409 : code.includes("FAILED") ? 400 : 500;
    return locationErrorResponse(req, ctx, code, status, "Storage location create failed");
  }
}

export async function listStorageLocationsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);

    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const locationType = toTrimmedString(url.searchParams.get("location_type")).toUpperCase();
    const isActive = url.searchParams.get("is_active");

    if (companyId) {
      let mapQuery = serviceRoleClient
        .schema("erp_inventory")
        .from("storage_location_plant_map")
        .select("storage_location_id, company_id, is_default_grn_location, allowed_stock_types, active")
        .eq("company_id", companyId);

      if (isActive === "true") {
        mapQuery = mapQuery.eq("active", true);
      } else if (isActive === "false") {
        mapQuery = mapQuery.eq("active", false);
      }

      const { data: maps, error: mapError } = await mapQuery;
      if (mapError) {
        throw new Error("OM_LOCATION_LIST_FAILED");
      }

      const locationIds = [...new Set((maps ?? []).map((row) => row.storage_location_id).filter(Boolean))];
      if (locationIds.length === 0) {
        return okResponse({ data: [] }, ctx.request_id, req);
      }

      let locationQuery = serviceRoleClient
        .schema("erp_inventory")
        .from("storage_location_master")
        .select("*")
        .in("id", locationIds)
        .order("code", { ascending: true });

      if (locationType) {
        locationQuery = locationQuery.eq("location_type", locationType);
      }
      if (isActive === "true") {
        locationQuery = locationQuery.eq("active", true);
      } else if (isActive === "false") {
        locationQuery = locationQuery.eq("active", false);
      }

      const { data: locations, error: locationError } = await locationQuery;
      if (locationError) {
        throw new Error("OM_LOCATION_LIST_FAILED");
      }

      const mapByLocationId = new Map((maps ?? []).map((row) => [row.storage_location_id, row]));
      const merged = (locations ?? []).map((row) => ({
        ...row,
        company_map: mapByLocationId.get(row.id) ?? null,
      }));

      return okResponse({ data: merged }, ctx.request_id, req);
    }

    let query = serviceRoleClient
      .schema("erp_inventory")
      .from("storage_location_master")
      .select("*")
      .order("code", { ascending: true });

    if (locationType) {
      query = query.eq("location_type", locationType);
    }
    if (isActive === "true") {
      query = query.eq("active", true);
    } else if (isActive === "false") {
      query = query.eq("active", false);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error("OM_LOCATION_LIST_FAILED");
    }

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_LOCATION_LIST_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : 500;
    return locationErrorResponse(req, ctx, code, status, "Storage location list failed");
  }
}

export async function updateStorageLocationHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmSaContext(ctx);
    const body = await parseBody(req);
    const locationId = toTrimmedString(body.id);
    const locationName = toTrimmedString(body.location_name || body.name);
    const locationType = toTrimmedString(body.location_type).toUpperCase();

    if (!locationId || !locationName || !VALID_LOCATION_TYPES.has(locationType)) {
      return locationErrorResponse(req, ctx, "OM_LOCATION_UPDATE_FAILED", 400, "Invalid input");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_inventory")
      .from("storage_location_master")
      .update({ name: locationName, location_type: locationType, is_transit_location: locationType === "TRANSIT" })
      .eq("id", locationId)
      .select("*")
      .single();

    if (error || !data) throw new Error("OM_LOCATION_UPDATE_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_LOCATION_UPDATE_FAILED";
    return locationErrorResponse(req, ctx, code, 400, "Storage location update failed");
  }
}

export async function toggleStorageLocationHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmSaContext(ctx);
    const body = await parseBody(req);
    const locationId = toTrimmedString(body.id);
    const active = body.active === true;

    if (!locationId) {
      return locationErrorResponse(req, ctx, "OM_LOCATION_TOGGLE_FAILED", 400, "Missing id");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_inventory")
      .from("storage_location_master")
      .update({ active })
      .eq("id", locationId)
      .select("*")
      .single();

    if (error || !data) throw new Error("OM_LOCATION_TOGGLE_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_LOCATION_TOGGLE_FAILED";
    return locationErrorResponse(req, ctx, code, 400, "Storage location toggle failed");
  }
}

export async function listPlantAssignmentsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));

    if (!companyId) {
      return locationErrorResponse(req, ctx, "OM_LOCATION_LIST_FAILED", 400, "company_id required");
    }

    const { data: maps, error: mapError } = await serviceRoleClient
      .schema("erp_inventory")
      .from("storage_location_plant_map")
      .select("storage_location_id, company_id, active, is_default_grn_location, allowed_stock_types")
      .eq("company_id", companyId);

    if (mapError) throw new Error("OM_LOCATION_LIST_FAILED");

    const locationIds = (maps ?? []).map((r) => r.storage_location_id).filter(Boolean);
    if (locationIds.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    const { data: locs, error: locError } = await serviceRoleClient
      .schema("erp_inventory")
      .from("storage_location_master")
      .select("id, code, name, location_type, active")
      .in("id", locationIds)
      .order("code");

    if (locError) throw new Error("OM_LOCATION_LIST_FAILED");

    const mapById = new Map((maps ?? []).map((r) => [r.storage_location_id, r]));
    const merged = (locs ?? []).map((loc) => ({ ...loc, plant_map: mapById.get(loc.id) ?? null }));
    return okResponse({ data: merged }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_LOCATION_LIST_FAILED";
    return locationErrorResponse(req, ctx, code, 500, "Plant assignment list failed");
  }
}

export async function unmapStorageLocationFromPlantHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmSaContext(ctx);
    const body = await parseBody(req);
    const storageLocationIds: string[] = Array.isArray(body.storage_location_ids)
      ? body.storage_location_ids.map((v) => toTrimmedString(v)).filter(Boolean)
      : [toTrimmedString(body.storage_location_id)].filter(Boolean);
    const companyId = toTrimmedString(body.company_id);

    if (storageLocationIds.length === 0 || !companyId) {
      return locationErrorResponse(req, ctx, "OM_LOCATION_UNMAP_FAILED", 400, "Missing required fields");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return locationErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const { error } = await serviceRoleClient
      .schema("erp_inventory")
      .from("storage_location_plant_map")
      .delete()
      .in("storage_location_id", storageLocationIds)
      .eq("company_id", companyId);

    if (error) throw new Error("OM_LOCATION_UNMAP_FAILED");
    return okResponse({ removed: storageLocationIds.length }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_LOCATION_UNMAP_FAILED";
    return locationErrorResponse(req, ctx, code, 400, "Storage location unmap failed");
  }
}

export async function mapStorageLocationToPlantHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmSaContext(ctx);

    const body = await parseBody(req);
    const storageLocationId = toTrimmedString(body.storage_location_id);
    const companyId = toTrimmedString(body.company_id);

    if (!(await getLocationById(storageLocationId))) {
      return locationErrorResponse(req, ctx, "OM_LOCATION_NOT_FOUND", 404, "Storage location not found");
    }
    if (!companyId) {
      return locationErrorResponse(req, ctx, "OM_COMPANY_NOT_FOUND", 404, "Company not found");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return locationErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_inventory")
      .from("storage_location_plant_map")
      .upsert({
        storage_location_id: storageLocationId,
        company_id: companyId,
        is_default_grn_location: body.is_default_grn_location === true,
        allowed_stock_types: Array.isArray(body.allowed_stock_types)
          ? body.allowed_stock_types.map((entry) => String(entry).trim()).filter(Boolean)
          : ["UNRESTRICTED"],
        active: body.is_active !== false && body.active !== false,
        created_by: ctx.auth_user_id,
      }, { onConflict: "storage_location_id,company_id" })
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_LOCATION_MAP_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_LOCATION_MAP_FAILED";
    const status = code === "OM_SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return locationErrorResponse(req, ctx, code, status, "Storage location plant map failed");
  }
}
