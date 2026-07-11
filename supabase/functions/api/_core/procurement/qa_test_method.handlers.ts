/*
 * File-Path: supabase/functions/api/_core/procurement/qa_test_method.handlers.ts
 * Domain: PROCUREMENT (Inward QA redesign)
 * Purpose: Test Method Master (erp_master.qa_test_method — global method pool per company +
 *          test group) and Category Test Config (erp_master.qa_category_test_config — per
 *          company + material category + method, LSL/USL). See docs/Operation Management/
 *          implementation-specs/OM-GATE-InwardQA-Redesign-Spec.md Section 4.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type QATestMethodHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

// Kept identical to inward_qa.handlers.ts role sets — Test Method Config creation is
// available to any QA-capable role; edit/delete requires manager-level (incl. DIRECTOR).
const QA_ALLOWED_ROLES = ["SA", "DIRECTOR", "PROCUREMENT_HEAD", "QA_OFFICER", "STORE_MANAGER"];
const QA_MANAGER_ROLES = ["SA", "DIRECTOR", "PROCUREMENT_HEAD", "STORE_MANAGER"];
// Gate-27.17: widened to include CT (Concrete Trial) for SFG Result Recording. This handler
// is shared with Procurement's Inward QA page, which never renders a CT section, so no
// behavior changes there — this only unblocks the SFG page's own Concrete Trial group.
const TEST_GROUPS = new Set(["MCT", "OTHR", "CT"]);

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Logs the real Supabase/Postgres error server-side so root causes aren't lost behind a generic message. */
function logDbError(context: string, error: unknown): void {
  console.error(`[QA_TEST_METHOD_DB_ERROR] ${context}:`, JSON.stringify(error));
}

function assertQARole(ctx: QATestMethodHandlerContext): void {
  if (!QA_ALLOWED_ROLES.includes(ctx.roleCode)) {
    throw new ApiError(403, "QA access required");
  }
}

function assertQAManagerRole(ctx: QATestMethodHandlerContext): void {
  if (!QA_MANAGER_ROLES.includes(ctx.roleCode)) {
    throw new ApiError(403, "QA manager access required");
  }
}

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}

function parseNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function qaErrorResponse(
  req: Request,
  ctx: QATestMethodHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  console.warn(`[QA_TEST_METHOD_ERROR] ${req.method} ${new URL(req.url).pathname} -> ${status} ${code}: ${message}`);
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function getPathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}

function getIdFromPath(req: Request): string {
  return getPathSegments(req)[3] ?? "";
}

export async function listTestMethodsHandler(
  req: Request,
  ctx: QATestMethodHandlerContext,
): Promise<Response> {
  try {
    assertQARole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const testGroup = toUpperTrimmedString(url.searchParams.get("test_group"));
    if (!companyId) {
      throw new ApiError(400, "company_id is required");
    }

    let query = serviceRoleClient
      .schema("erp_master")
      .from("qa_test_method")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("method_name", { ascending: true });

    if (testGroup) {
      if (!TEST_GROUPS.has(testGroup)) {
        throw new ApiError(400, "test_group must be MCT, OTHR, or CT");
      }
      query = query.eq("test_group", testGroup);
    }

    const { data, error } = await query;
    if (error) {
      logDbError("listTestMethodsHandler query", error);
      throw new ApiError(500, error.message || "Unable to list QA test methods");
    }

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list QA test methods";
    const status = error instanceof ApiError ? error.status : 500;
    return qaErrorResponse(req, ctx, "QA_TEST_METHOD_LIST_FAILED", status, message);
  }
}

/**
 * Find-or-create: if a method with this (company, test_group, method_name) already exists,
 * returns the existing row instead of erroring. Lets the frontend dropdown "pick existing or
 * type a new one" flow use a single call either way.
 */
export async function createTestMethodHandler(
  req: Request,
  ctx: QATestMethodHandlerContext,
): Promise<Response> {
  try {
    assertQARole(ctx);
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const testGroup = toUpperTrimmedString(body.test_group);
    const methodName = toTrimmedString(body.method_name);

    if (!companyId) throw new ApiError(400, "company_id is required");
    if (!TEST_GROUPS.has(testGroup)) throw new ApiError(400, "test_group must be MCT, OTHR, or CT");
    if (!methodName) throw new ApiError(400, "method_name is required");

    const { data: existing, error: existingError } = await serviceRoleClient
      .schema("erp_master")
      .from("qa_test_method")
      .select("*")
      .eq("company_id", companyId)
      .eq("test_group", testGroup)
      .ilike("method_name", methodName)
      .maybeSingle();

    if (existingError) {
      logDbError("createTestMethodHandler existing-lookup", existingError);
      throw new ApiError(500, existingError.message || "Unable to check existing QA test methods");
    }
    if (existing) {
      return okResponse({ data: existing }, ctx.request_id, req);
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("qa_test_method")
      .insert({
        company_id: companyId,
        test_group: testGroup,
        method_name: methodName,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error || !data) {
      if (error?.code === "23505") {
        throw new ApiError(409, "Test method already exists for this company and group");
      }
      logDbError("createTestMethodHandler insert", error);
      throw new ApiError(500, error?.message || "Unable to create QA test method");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create QA test method";
    const status = error instanceof ApiError ? error.status : 500;
    return qaErrorResponse(req, ctx, "QA_TEST_METHOD_CREATE_FAILED", status, message);
  }
}

export async function listCategoryTestConfigHandler(
  req: Request,
  ctx: QATestMethodHandlerContext,
): Promise<Response> {
  try {
    assertQARole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const materialCategory = toTrimmedString(url.searchParams.get("material_category"));

    if (!companyId) throw new ApiError(400, "company_id is required");
    if (!materialCategory) throw new ApiError(400, "material_category is required");

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("qa_category_test_config")
      .select("*, qa_test_method(*)")
      .eq("company_id", companyId)
      .eq("material_category", materialCategory)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (error) {
      logDbError("listCategoryTestConfigHandler query", error);
      throw new ApiError(500, error.message || "Unable to list category test config");
    }

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list category test config";
    const status = error instanceof ApiError ? error.status : 500;
    return qaErrorResponse(req, ctx, "QA_CATEGORY_CONFIG_LIST_FAILED", status, message);
  }
}

/**
 * Attaches a test method (existing or newly created via createTestMethodHandler) to a
 * material category with its LSL/USL. QA_OFFICER+ (any QA-capable role) may create.
 */
export async function createCategoryTestConfigHandler(
  req: Request,
  ctx: QATestMethodHandlerContext,
): Promise<Response> {
  try {
    assertQARole(ctx);
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const materialCategory = toTrimmedString(body.material_category);
    const testMethodId = toTrimmedString(body.test_method_id);
    const lsl = parseNullableNumber(body.lsl);
    const usl = parseNullableNumber(body.usl);

    if (!companyId) throw new ApiError(400, "company_id is required");
    if (!materialCategory) throw new ApiError(400, "material_category is required");
    if (!testMethodId) throw new ApiError(400, "test_method_id is required");

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("qa_category_test_config")
      .insert({
        company_id: companyId,
        material_category: materialCategory,
        test_method_id: testMethodId,
        lsl,
        usl,
        created_by: ctx.auth_user_id,
      })
      .select("*, qa_test_method(*)")
      .single();

    if (error || !data) {
      if (error?.code === "23505") {
        throw new ApiError(409, "This method is already configured for this category");
      }
      logDbError("createCategoryTestConfigHandler insert", error);
      throw new ApiError(500, error?.message || "Unable to create category test config");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create category test config";
    const status = error instanceof ApiError ? error.status : 500;
    return qaErrorResponse(req, ctx, "QA_CATEGORY_CONFIG_CREATE_FAILED", status, message);
  }
}

/** Edit LSL/USL on an existing category test config row. QA_MANAGER/DIRECTOR/SA only. */
export async function updateCategoryTestConfigHandler(
  req: Request,
  ctx: QATestMethodHandlerContext,
): Promise<Response> {
  try {
    assertQAManagerRole(ctx);
    const configId = getIdFromPath(req);
    if (!configId) throw new ApiError(400, "Config id is required");

    const body = await parseBody(req);
    const patch: JsonRecord = {
      last_updated_by: ctx.auth_user_id,
      last_updated_at: new Date().toISOString(),
    };
    if (body.lsl !== undefined) patch.lsl = parseNullableNumber(body.lsl);
    if (body.usl !== undefined) patch.usl = parseNullableNumber(body.usl);

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("qa_category_test_config")
      .update(patch)
      .eq("id", configId)
      .select("*, qa_test_method(*)")
      .single();

    if (error || !data) {
      logDbError("updateCategoryTestConfigHandler update", error);
      throw new ApiError(404, error?.message || "Category test config not found");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update category test config";
    const status = error instanceof ApiError ? error.status : 500;
    return qaErrorResponse(req, ctx, "QA_CATEGORY_CONFIG_UPDATE_FAILED", status, message);
  }
}

/**
 * Removes a method from a category config. QA_MANAGER/DIRECTOR/SA only, and only when
 * test_group = MCT and no result has ever been recorded for this (category, method) pair.
 */
export async function deleteCategoryTestConfigHandler(
  req: Request,
  ctx: QATestMethodHandlerContext,
): Promise<Response> {
  try {
    assertQAManagerRole(ctx);
    const configId = getIdFromPath(req);
    if (!configId) throw new ApiError(400, "Config id is required");

    const { data: config, error: configError } = await serviceRoleClient
      .schema("erp_master")
      .from("qa_category_test_config")
      .select("*, qa_test_method(*)")
      .eq("id", configId)
      .single();

    if (configError || !config) {
      logDbError("deleteCategoryTestConfigHandler config-lookup", configError);
      throw new ApiError(404, configError?.message || "Category test config not found");
    }

    const testGroup = String((config.qa_test_method as JsonRecord | null)?.test_group ?? "");
    if (testGroup !== "MCT") {
      throw new ApiError(409, "Only MCT methods can be deleted from a category config");
    }

    // Untested guard: any test line using this method, whose QA document's material is in
    // this same category, with a recorded result, blocks deletion.
    const { data: methodTestLines, error: testLineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("inward_qa_test_line")
      .select("qa_document_id, test_result")
      .eq("test_method_id", config.test_method_id)
      .not("test_result", "is", null);

    if (testLineError) {
      logDbError("deleteCategoryTestConfigHandler test-line lookup", testLineError);
      throw new ApiError(500, testLineError.message || "Unable to verify prior test usage");
    }

    const candidateDocIds = Array.from(
      new Set((methodTestLines ?? []).map((row) => String(row.qa_document_id))),
    );

    if (candidateDocIds.length > 0) {
      const { data: docs, error: docsError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("inward_qa_document")
        .select("id, material_id")
        .in("id", candidateDocIds);

      if (docsError) {
        logDbError("deleteCategoryTestConfigHandler docs lookup", docsError);
        throw new ApiError(500, docsError.message || "Unable to verify prior test usage");
      }

      const materialIds = Array.from(new Set((docs ?? []).map((row) => String(row.material_id))));
      if (materialIds.length > 0) {
        const { data: materials, error: materialsError } = await serviceRoleClient
          .schema("erp_master")
          .from("material_master")
          .select("id, material_category")
          .in("id", materialIds);

        if (materialsError) {
          logDbError("deleteCategoryTestConfigHandler materials lookup", materialsError);
          throw new ApiError(500, materialsError.message || "Unable to verify prior test usage");
        }

        const hasResultInThisCategory = (materials ?? []).some(
          (row) => String(row.material_category) === String(config.material_category),
        );
        if (hasResultInThisCategory) {
          throw new ApiError(409, "Cannot delete — this method already has a recorded test result in this category");
        }
      }
    }

    const { error: deleteError } = await serviceRoleClient
      .schema("erp_master")
      .from("qa_category_test_config")
      .delete()
      .eq("id", configId);

    if (deleteError) {
      logDbError("deleteCategoryTestConfigHandler delete", deleteError);
      throw new ApiError(500, deleteError.message || "Unable to delete category test config");
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete category test config";
    const status = error instanceof ApiError ? error.status : 500;
    return qaErrorResponse(req, ctx, "QA_CATEGORY_CONFIG_DELETE_FAILED", status, message);
  }
}
