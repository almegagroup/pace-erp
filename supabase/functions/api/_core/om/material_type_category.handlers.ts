/*
 * File-ID: 15.17
 * File-Path: supabase/functions/api/_core/om/material_type_category.handlers.ts
 * Gate: 15
 * Phase: 15
 * Domain: MASTER
 * Purpose: Material type scoped category lookup CRUD handlers.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { OmHandlerContext } from "./shared.ts";
import { assertManagerOrSARole, assertOmSaContext } from "./shared.ts";

type JsonRecord = Record<string, unknown>;

const ALLOWED_MATERIAL_TYPES = new Set(["RM", "PM", "INT", "SFG", "FG", "TRA", "CONS"]);

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function materialTypeCategoryErrorResponse(
  req: Request,
  ctx: OmHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

async function findExistingCategory(materialType: string, categoryName: string) {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_type_category")
    .select("*")
    .eq("material_type", materialType)
    .ilike("category_name", categoryName)
    .limit(1);

  if (error) {
    throw new Error("OM_MATERIAL_TYPE_CATEGORY_LOOKUP_FAILED");
  }

  return Array.isArray(data) ? (data[0] ?? null) : null;
}

export async function listMaterialTypeCategoriesHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);

    const url = new URL(req.url);
    const materialType = toTrimmedString(url.searchParams.get("material_type")).toUpperCase();
    const isActive = toTrimmedString(url.searchParams.get("is_active")).toLowerCase();

    if (materialType && !ALLOWED_MATERIAL_TYPES.has(materialType)) {
      return materialTypeCategoryErrorResponse(
        req,
        ctx,
        "OM_INVALID_MATERIAL_TYPE",
        400,
        "Invalid material type",
      );
    }

    let query = serviceRoleClient
      .schema("erp_master")
      .from("material_type_category")
      .select("*")
      .order("category_name", { ascending: true });

    if (materialType) {
      query = query.eq("material_type", materialType);
    }

    if (isActive === "false") {
      query = query.eq("is_active", false);
    } else if (isActive !== "all") {
      query = query.eq("is_active", true);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error("OM_MATERIAL_TYPE_CATEGORY_LIST_FAILED");
    }

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_TYPE_CATEGORY_LIST_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED"
      ? 403
      : code === "OM_INVALID_MATERIAL_TYPE"
      ? 400
      : 500;
    return materialTypeCategoryErrorResponse(req, ctx, code, status, "Material type category list failed");
  }
}

export async function createMaterialTypeCategoryHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmSaContext(ctx);

    const body = await parseBody(req);
    const materialType = toTrimmedString(body.material_type).toUpperCase();
    const categoryName = toTrimmedString(body.category_name);

    if (!ALLOWED_MATERIAL_TYPES.has(materialType)) {
      return materialTypeCategoryErrorResponse(
        req,
        ctx,
        "OM_INVALID_MATERIAL_TYPE",
        400,
        "Invalid material type",
      );
    }

    if (!categoryName) {
      return materialTypeCategoryErrorResponse(
        req,
        ctx,
        "OM_INVALID_MATERIAL_TYPE_CATEGORY",
        400,
        "Category name is required",
      );
    }

    const existing = await findExistingCategory(materialType, categoryName);
    if (existing) {
      return okResponse({ data: existing }, ctx.request_id, req);
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_type_category")
      .insert({
        material_type: materialType,
        category_name: categoryName,
        is_active: true,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        const duplicate = await findExistingCategory(materialType, categoryName);
        if (duplicate) {
          return okResponse({ data: duplicate }, ctx.request_id, req);
        }
      }
      throw new Error("OM_MATERIAL_TYPE_CATEGORY_CREATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_TYPE_CATEGORY_CREATE_FAILED";
    const status = code === "OM_SA_REQUIRED"
      ? 403
      : code === "OM_INVALID_MATERIAL_TYPE" || code === "OM_INVALID_MATERIAL_TYPE_CATEGORY"
      ? 400
      : 500;
    return materialTypeCategoryErrorResponse(req, ctx, code, status, "Material type category create failed");
  }
}
