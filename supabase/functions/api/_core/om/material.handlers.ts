/*
 * File-ID: 14.2
 * File-Path: supabase/functions/api/_core/om/material.handlers.ts
 * Gate: 14
 * Phase: 14
 * Domain: MASTER
 * Purpose: Material master CRUD, bulk save, CSV import, company mapping, UOM conversion, category group.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { OmHandlerContext } from "./shared.ts";
import { assertManagerOrSARole } from "./shared.ts";

type JsonRecord = Record<string, unknown>;

const ALLOWED_MATERIAL_TYPES = new Set(["RM", "PM", "INT", "FG", "TRA", "CONS"]);
const MUTABLE_MATERIAL_STATUSES = new Set(["DRAFT", "PENDING_APPROVAL"]);
const MATERIAL_DB_STATUSES = new Set(["DRAFT", "PENDING_APPROVAL", "ACTIVE", "INACTIVE", "BLOCKED"]);
const MATERIAL_TRANSITIONS = new Map<string, Set<string>>([
  ["DRAFT", new Set(["PENDING_APPROVAL", "ACTIVE", "INACTIVE"])],
  ["PENDING_APPROVAL", new Set(["ACTIVE", "DRAFT"])],
  ["ACTIVE", new Set(["INACTIVE", "BLOCKED"])],
  ["INACTIVE", new Set(["ACTIVE"])],
  ["BLOCKED", new Set(["ACTIVE"])],
]);

function mapMaterialStatusInput(value: unknown): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "DISCONTINUED") return "BLOCKED";
  return normalized;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeSearch(value: string): string {
  return value.replace(/[%_]/g, "").trim();
}

async function ensureUomExists(code: string): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("uom_master")
    .select("code")
    .eq("code", code)
    .maybeSingle();
  return !error && Boolean(data?.code);
}

async function ensureCompanyExists(companyId: string): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .maybeSingle();
  return !error && Boolean(data?.id);
}

async function getMaterialById(id: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("OM_MATERIAL_LOOKUP_FAILED");
  return (data as Record<string, unknown> | null) ?? null;
}

function materialErrorResponse(
  req: Request,
  ctx: OmHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function deriveShortName(materialName: string, provided: unknown): string {
  const candidate = toTrimmedString(provided);
  return candidate || materialName;
}

function deriveConversionFactor(body: JsonRecord): number | null {
  if (body.conversion_factor !== undefined) {
    const factor = Number(body.conversion_factor);
    return Number.isFinite(factor) && factor > 0 ? factor : null;
  }
  const numerator = Number(body.numerator);
  const denominator = Number(body.denominator);
  if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
    return numerator / denominator;
  }
  return null;
}

// ── Single Create ─────────────────────────────────────────────────────────────

export async function createMaterialHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const materialType = toTrimmedString(body.material_type).toUpperCase();
    const materialName = toTrimmedString(body.material_name);
    const baseUomCode = toTrimmedString(body.base_uom_code).toUpperCase();
    const purchaseUomCode = toTrimmedString(body.purchase_uom_code).toUpperCase() || null;
    const issueUomCode = toTrimmedString(body.issue_uom_code).toUpperCase() || null;

    if (!ALLOWED_MATERIAL_TYPES.has(materialType)) {
      return materialErrorResponse(req, ctx, "OM_INVALID_MATERIAL_TYPE", 400, "Invalid material type");
    }
    if (!materialName || !baseUomCode) {
      return materialErrorResponse(req, ctx, "OM_INVALID_MATERIAL_INPUT", 400, "Material name and base UOM are required");
    }
    if (!(await ensureUomExists(baseUomCode)) ||
      !(await ensureUomExists(purchaseUomCode)) ||
      !(await ensureUomExists(issueUomCode))) {
      return materialErrorResponse(req, ctx, "OM_INVALID_BASE_UOM", 400, "Invalid base UOM");
    }

    const { data: materialCode, error: codeError } = await serviceRoleClient
      .rpc("generate_material_pace_code", { p_material_type: materialType });
    if (codeError || !materialCode) throw new Error("OM_MATERIAL_CREATE_FAILED");

    const payload = {
      pace_code: String(materialCode),
      external_code: toTrimmedString(body.external_code) || null,
      material_name: materialName,
      document_name: toTrimmedString(body.document_name) || null,
      short_name: deriveShortName(materialName, body.short_name),
      material_type: materialType,
      material_category: toTrimmedString(body.material_category) || null,
      description: toTrimmedString(body.description) || null,
      specification: toTrimmedString(body.specification) || null,
      base_uom_code: baseUomCode,
      purchase_uom_code: purchaseUomCode,
      issue_uom_code: issueUomCode,
      shade_code: toTrimmedString(body.shade_code) || null,
      pack_code: toTrimmedString(body.pack_code) || null,
      external_sku: toTrimmedString(body.external_sku) || null,
      hsn_code: toTrimmedString(body.hsn_code) || null,
      procurement_type: toTrimmedString(body.procurement_type).toUpperCase() || "EXTERNAL",
      import_domestic_flag: toTrimmedString(body.import_domestic_flag).toUpperCase() || "DOMESTIC",
      batch_tracking_required: body.batch_tracking_required === true || body.is_batch_managed === true,
      fifo_tracking_enabled: body.fifo_tracking_enabled === true,
      expiry_tracking_enabled: body.expiry_tracking_enabled === true,
      shelf_life_days: body.shelf_life_days != null ? Number(body.shelf_life_days) : null,
      min_shelf_life_at_grn_days: body.min_shelf_life_at_grn_days != null ? Number(body.min_shelf_life_at_grn_days) : null,
      qa_required_on_inward: body.qa_required_on_inward !== false,
      qa_required_on_fg: body.qa_required_on_fg === true,
      valuation_method: toTrimmedString(body.valuation_method).toUpperCase() || "WEIGHTED_AVERAGE",
      valuation_class: toTrimmedString(body.valuation_class) || null,
      production_mode: toTrimmedString(body.production_mode).toUpperCase() || null,
      bom_exists: body.bom_exists === true,
      delivery_tolerance_enabled: body.delivery_tolerance_enabled === true,
      under_delivery_tolerance_pct: body.under_delivery_tolerance_pct != null ? Number(body.under_delivery_tolerance_pct) : null,
      over_delivery_tolerance_pct: body.over_delivery_tolerance_pct != null ? Number(body.over_delivery_tolerance_pct) : null,
      status: "DRAFT",
      created_by: ctx.auth_user_id,
    };

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .insert(payload)
      .select("*")
      .single();

    if (error || !data) throw new Error("OM_MATERIAL_CREATE_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_CREATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material create failed");
  }
}

// ── Bulk Save (create + update in one call) ───────────────────────────────────

export async function bulkSaveMaterialsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const creates: JsonRecord[] = Array.isArray(body.creates) ? body.creates : [];
    const updates: JsonRecord[] = Array.isArray(body.updates) ? body.updates : [];

    const created: unknown[] = [];
    const updated: unknown[] = [];
    const errors: { index: number; context: string; error: string }[] = [];

    // Process creates
    for (let i = 0; i < creates.length; i++) {
      const row = creates[i];
      try {
        const materialType = toTrimmedString(row.material_type).toUpperCase();
        const materialName = toTrimmedString(row.material_name);
        const baseUomCode = toTrimmedString(row.base_uom_code).toUpperCase();

        if (!ALLOWED_MATERIAL_TYPES.has(materialType)) {
          errors.push({ index: i, context: "create", error: "OM_INVALID_MATERIAL_TYPE" });
          continue;
        }
        if (!materialName || !baseUomCode) {
          errors.push({ index: i, context: "create", error: "OM_INVALID_MATERIAL_INPUT" });
          continue;
        }

        // Check duplicate name
        const { count } = await serviceRoleClient
          .schema("erp_master")
          .from("material_master")
          .select("id", { count: "exact", head: true })
          .ilike("material_name", materialName);
        if ((count ?? 0) > 0) {
          errors.push({ index: i, context: "create", error: "OM_MATERIAL_NAME_DUPLICATE" });
          continue;
        }

        const { data: materialCode, error: codeError } = await serviceRoleClient
          .rpc("generate_material_pace_code", { p_material_type: materialType });
        if (codeError || !materialCode) {
          errors.push({ index: i, context: "create", error: "OM_PACE_CODE_FAILED" });
          continue;
        }

        const purchaseUomCode = toTrimmedString(row.purchase_uom_code).toUpperCase() || null;
        const issueUomCode = toTrimmedString(row.issue_uom_code).toUpperCase() || null;

        const { data, error } = await serviceRoleClient
          .schema("erp_master")
          .from("material_master")
          .insert({
            pace_code: String(materialCode),
            external_code: toTrimmedString(row.external_code) || null,
            material_name: materialName,
            document_name: toTrimmedString(row.document_name) || null,
            short_name: deriveShortName(materialName, row.short_name),
            material_type: materialType,
            material_category: toTrimmedString(row.material_category) || null,
            description: toTrimmedString(row.description) || null,
            specification: toTrimmedString(row.specification) || null,
            base_uom_code: baseUomCode,
            purchase_uom_code: purchaseUomCode,
            issue_uom_code: issueUomCode,
            hsn_code: toTrimmedString(row.hsn_code) || null,
            qa_required_on_inward: row.qa_required_on_inward !== false,
            valuation_method: toTrimmedString(row.valuation_method).toUpperCase() || "WEIGHTED_AVERAGE",
            status: "ACTIVE",
            approved_by: ctx.auth_user_id,
            approved_at: new Date().toISOString(),
            created_by: ctx.auth_user_id,
          })
          .select("*")
          .single();

        if (error || !data) {
          errors.push({ index: i, context: "create", error: "OM_MATERIAL_CREATE_FAILED" });
        } else {
          created.push(data);
        }
      } catch {
        errors.push({ index: i, context: "create", error: "OM_MATERIAL_CREATE_FAILED" });
      }
    }

    // Process updates
    for (let i = 0; i < updates.length; i++) {
      const row = updates[i];
      try {
        const id = toTrimmedString(row.id);
        if (!id) {
          errors.push({ index: i, context: "update", error: "OM_MATERIAL_ID_MISSING" });
          continue;
        }

        const existing = await getMaterialById(id);
        if (!existing) {
          errors.push({ index: i, context: "update", error: "OM_MATERIAL_NOT_FOUND" });
          continue;
        }

        const patch: JsonRecord = {
          last_updated_at: new Date().toISOString(),
          last_updated_by: ctx.auth_user_id,
        };

        const mutableFields = [
          "material_name", "document_name", "short_name", "material_category",
          "external_code", "hsn_code", "description", "specification",
          "shade_code", "pack_code", "external_sku",
          "procurement_type", "import_domestic_flag",
          "batch_tracking_required", "fifo_tracking_enabled", "expiry_tracking_enabled",
          "shelf_life_days", "min_shelf_life_at_grn_days",
          "qa_required_on_inward", "qa_required_on_fg",
          "valuation_method", "valuation_class", "production_mode",
          "bom_exists", "delivery_tolerance_enabled",
          "under_delivery_tolerance_pct", "over_delivery_tolerance_pct",
        ];

        for (const field of mutableFields) {
          if (row[field] !== undefined) patch[field] = row[field];
        }

        // Check duplicate name if name is changing
        if (row.material_name !== undefined) {
          const newName = toTrimmedString(row.material_name);
          if (newName !== String(existing.material_name ?? "")) {
            const { count } = await serviceRoleClient
              .schema("erp_master")
              .from("material_master")
              .select("id", { count: "exact", head: true })
              .ilike("material_name", newName)
              .neq("id", id);
            if ((count ?? 0) > 0) {
              errors.push({ index: i, context: "update", error: "OM_MATERIAL_NAME_DUPLICATE" });
              continue;
            }
          }
        }

        const { data, error } = await serviceRoleClient
          .schema("erp_master")
          .from("material_master")
          .update(patch)
          .eq("id", id)
          .select("*")
          .single();

        if (error || !data) {
          errors.push({ index: i, context: "update", error: "OM_MATERIAL_UPDATE_FAILED" });
        } else {
          updated.push(data);
        }
      } catch {
        errors.push({ index: i, context: "update", error: "OM_MATERIAL_UPDATE_FAILED" });
      }
    }

    return okResponse({ created, updated, errors }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_BULK_SAVE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "Bulk save failed");
  }
}

// ── CSV Import ────────────────────────────────────────────────────────────────

export async function importMaterialsCsvHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const csvText = toTrimmedString(body.csv_text);
    if (!csvText) {
      return materialErrorResponse(req, ctx, "OM_CSV_EMPTY", 400, "CSV text is empty");
    }

    const lines = csvText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      return materialErrorResponse(req, ctx, "OM_CSV_NO_DATA", 400, "CSV has no data rows");
    }

    // Parse header
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/["\s]/g, ""));
    const results: { row: number; material_name: string; pace_code: string | null; status: string; error: string | null }[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = cols[idx] ?? ""; });

      const materialName = (row["material_name"] ?? "").trim();
      const materialType = (row["material_type"] ?? "RM").trim().toUpperCase();
      const baseUomCode = (row["base_uom_code"] ?? "").trim().toUpperCase();

      if (!materialName) {
        results.push({ row: i, material_name: "", pace_code: null, status: "SKIPPED", error: "material_name is empty" });
        continue;
      }
      if (!ALLOWED_MATERIAL_TYPES.has(materialType)) {
        results.push({ row: i, material_name: materialName, pace_code: null, status: "ERROR", error: `Invalid material_type: ${materialType}` });
        continue;
      }
      if (!baseUomCode) {
        results.push({ row: i, material_name: materialName, pace_code: null, status: "ERROR", error: "base_uom_code is required" });
        continue;
      }

      // Check duplicate
      const { count } = await serviceRoleClient
        .schema("erp_master")
        .from("material_master")
        .select("id", { count: "exact", head: true })
        .ilike("material_name", materialName);
      if ((count ?? 0) > 0) {
        results.push({ row: i, material_name: materialName, pace_code: null, status: "DUPLICATE", error: "Material name already exists" });
        continue;
      }

      const { data: materialCode, error: codeError } = await serviceRoleClient
        .rpc("generate_material_pace_code", { p_material_type: materialType });
      if (codeError || !materialCode) {
        results.push({ row: i, material_name: materialName, pace_code: null, status: "ERROR", error: "Failed to generate PACE code" });
        continue;
      }

      const { data, error } = await serviceRoleClient
        .schema("erp_master")
        .from("material_master")
        .insert({
          pace_code: String(materialCode),
          material_name: materialName,
          document_name: (row["document_name"] ?? "").trim() || null,
          short_name: materialName,
          material_type: materialType,
          material_category: (row["material_category"] ?? "").trim() || null,
          external_code: (row["external_code"] ?? "").trim() || null,
          base_uom_code: baseUomCode,
          purchase_uom_code: (row["purchase_uom_code"] ?? "").trim().toUpperCase() || null,
          issue_uom_code: (row["issue_uom_code"] ?? "").trim().toUpperCase() || null,
          hsn_code: (row["hsn_code"] ?? "").trim() || null,
          qa_required_on_inward: true,
          valuation_method: "WEIGHTED_AVERAGE",
          status: "ACTIVE",
          approved_by: ctx.auth_user_id,
          approved_at: new Date().toISOString(),
          created_by: ctx.auth_user_id,
        })
        .select("pace_code")
        .single();

      if (error || !data) {
        results.push({ row: i, material_name: materialName, pace_code: null, status: "ERROR", error: "Insert failed" });
      } else {
        results.push({ row: i, material_name: materialName, pace_code: String((data as Record<string, unknown>).pace_code ?? ""), status: "CREATED", error: null });
      }
    }

    return okResponse({ results }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_CSV_IMPORT_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "CSV import failed");
  }
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listMaterialsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const url = new URL(req.url);
    const materialType = toTrimmedString(url.searchParams.get("material_type")).toUpperCase();
    const statusFilter = mapMaterialStatusInput(url.searchParams.get("status"));
    const search = normalizeSearch(toTrimmedString(url.searchParams.get("search")));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 1000);
    const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);

    let query = serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .select("id,pace_code,external_code,material_name,document_name,short_name,material_type,material_category,base_uom_code,purchase_uom_code,issue_uom_code,hsn_code,status,created_at", { count: "exact" })
      .order("material_type", { ascending: true })
      .order("material_name", { ascending: true })
      .range(offset, offset + limit - 1);

    if (materialType) query = query.eq("material_type", materialType);
    if (statusFilter) query = query.eq("status", statusFilter);
    if (search) query = query.or(`pace_code.ilike.%${search}%,material_name.ilike.%${search}%,external_code.ilike.%${search}%`);

    const { data, error, count } = await query;
    if (error) throw new Error("OM_MATERIAL_LIST_FAILED");
    return okResponse({ data: data ?? [], total: count ?? 0 }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_LIST_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material list failed");
  }
}

export async function getMaterialHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = toTrimmedString(new URL(req.url).searchParams.get("id"));
    if (!id) return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");
    const material = await getMaterialById(id);
    if (!material) return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");
    return okResponse({ data: material }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_LOOKUP_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material lookup failed");
  }
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateMaterialHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    if (!id) return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");

    const existing = await getMaterialById(id);
    if (!existing) return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");

    const currentStatus = String(existing.status ?? "");
    if (!MUTABLE_MATERIAL_STATUSES.has(currentStatus)) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_LOCKED", 422, "Material is locked");
    }

    const updates: JsonRecord = {
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    };

    const mutableFields = [
      "material_name", "document_name", "short_name", "material_category",
      "description", "specification",
      "shade_code", "pack_code", "external_sku", "hsn_code",
      "procurement_type", "import_domestic_flag",
      "batch_tracking_required", "fifo_tracking_enabled", "expiry_tracking_enabled",
      "shelf_life_days", "min_shelf_life_at_grn_days",
      "qa_required_on_inward", "qa_required_on_fg",
      "valuation_method", "valuation_class", "production_mode",
      "bom_exists", "delivery_tolerance_enabled",
      "under_delivery_tolerance_pct", "over_delivery_tolerance_pct",
      "external_code",
    ];

    for (const field of mutableFields) {
      if (body[field] !== undefined) updates[field] = body[field];
    }
    if (body.is_batch_managed !== undefined) {
      updates.batch_tracking_required = body.is_batch_managed === true;
    }

    if (Object.keys(updates).length === 2) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_NO_CHANGES", 400, "No changes provided");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) throw new Error("OM_MATERIAL_UPDATE_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_UPDATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("LOCKED") ? 422 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material update failed");
  }
}

// ── Status Change ─────────────────────────────────────────────────────────────

export async function changeMaterialStatusHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    const newStatus = mapMaterialStatusInput(body.new_status);

    if (!id) return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");
    if (!MATERIAL_DB_STATUSES.has(newStatus)) {
      return materialErrorResponse(req, ctx, "OM_INVALID_STATUS_TRANSITION", 422, "Status transition not allowed");
    }

    const existing = await getMaterialById(id);
    if (!existing) return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");

    const currentStatus = String(existing.status ?? "");
    const allowed = MATERIAL_TRANSITIONS.get(currentStatus);
    if (!allowed?.has(newStatus)) {
      return materialErrorResponse(req, ctx, "OM_INVALID_STATUS_TRANSITION", 422, "Status transition not allowed");
    }

    const updates: JsonRecord = {
      status: newStatus,
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    };
    if (newStatus === "ACTIVE") {
      updates.approved_by = ctx.auth_user_id;
      updates.approved_at = new Date().toISOString();
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) throw new Error("OM_MATERIAL_STATUS_UPDATE_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_STATUS_UPDATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("TRANSITION") ? 422 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material status update failed");
  }
}

// ── Bulk Delete ───────────────────────────────────────────────────────────────

export async function deleteMaterialsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const ids: string[] = Array.isArray(body.ids)
      ? body.ids.map((id: unknown) => toTrimmedString(id)).filter(Boolean)
      : [];

    if (ids.length === 0) {
      return materialErrorResponse(req, ctx, "OM_NO_MATERIALS", 400, "No material IDs provided");
    }

    const deleted: string[] = [];
    const errors: { id: string; error: string }[] = [];

    for (const id of ids) {
      // .select() after delete so we can tell "deleted a row" apart from
      // "matched zero rows" — without it, deleting a non-matching id returns
      // no error at all and was being reported as a successful delete.
      const { data, error } = await serviceRoleClient
        .schema("erp_master")
        .from("material_master")
        .delete()
        .eq("id", id)
        .select("id");

      if (error) {
        // FK violation = has transactions/extensions
        const userFriendly = error.code === "23503"
          ? "OM_MATERIAL_HAS_DEPENDENCIES"
          : "OM_MATERIAL_DELETE_FAILED";
        errors.push({ id, error: userFriendly });
      } else if (!data || data.length === 0) {
        errors.push({ id, error: "OM_MATERIAL_NOT_FOUND" });
      } else {
        deleted.push(id);
      }
    }

    return okResponse({ deleted, errors }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_DELETE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material delete failed");
  }
}

// ── Company Mapping ───────────────────────────────────────────────────────────

export async function listCompanyMappingHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const search = normalizeSearch(toTrimmedString(url.searchParams.get("search")));

    if (!companyId) {
      return materialErrorResponse(req, ctx, "OM_COMPANY_NOT_FOUND", 400, "company_id required");
    }

    // All materials
    let matQuery = serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .select("id,pace_code,material_name,material_type,base_uom_code,status")
      .order("material_type", { ascending: true })
      .order("material_name", { ascending: true });

    if (search) {
      matQuery = matQuery.or(`material_name.ilike.%${search}%,pace_code.ilike.%${search}%`);
    }

    const { data: allMaterials, error: matError } = await matQuery;
    if (matError) throw new Error("OM_MATERIAL_LIST_FAILED");

    // Mapped material IDs for this company
    const { data: mapped, error: mapError } = await serviceRoleClient
      .schema("erp_master")
      .from("material_company_ext")
      .select("material_id,status")
      .eq("company_id", companyId);

    if (mapError) throw new Error("OM_COMPANY_MAPPING_FETCH_FAILED");

    const mappedSet = new Set((mapped ?? []).map((m: Record<string, unknown>) => String(m.material_id)));

    const enriched = (allMaterials ?? []).map((m: Record<string, unknown>) => ({
      ...m,
      is_mapped: mappedSet.has(String(m.id)),
    }));

    return okResponse({ data: enriched }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_COMPANY_MAPPING_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "Company mapping list failed");
  }
}

export async function bulkMapMaterialsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const materialIds: string[] = Array.isArray(body.material_ids)
      ? body.material_ids.map((id: unknown) => toTrimmedString(id)).filter(Boolean)
      : [];

    if (!companyId) return materialErrorResponse(req, ctx, "OM_COMPANY_NOT_FOUND", 400, "company_id required");
    if (materialIds.length === 0) return materialErrorResponse(req, ctx, "OM_NO_MATERIALS", 400, "No material IDs provided");
    if (!(await ensureCompanyExists(companyId))) {
      return materialErrorResponse(req, ctx, "OM_COMPANY_NOT_FOUND", 404, "Company not found");
    }

    const rows = materialIds.map((materialId) => ({
      material_id: materialId,
      company_id: companyId,
      procurement_allowed: true,
      status: "ACTIVE",
      created_by: ctx.auth_user_id,
    }));

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_company_ext")
      .upsert(rows, { onConflict: "material_id,company_id", ignoreDuplicates: true })
      .select("material_id");

    if (error) throw new Error("OM_MATERIAL_MAP_FAILED");
    return okResponse({ mapped: (data ?? []).length, total: materialIds.length }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_MAP_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "Bulk map failed");
  }
}

export async function bulkUnmapMaterialsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const materialIds: string[] = Array.isArray(body.material_ids)
      ? body.material_ids.map((id: unknown) => toTrimmedString(id)).filter(Boolean)
      : [];

    if (!companyId) return materialErrorResponse(req, ctx, "OM_COMPANY_NOT_FOUND", 400, "company_id required");
    if (materialIds.length === 0) return materialErrorResponse(req, ctx, "OM_NO_MATERIALS", 400, "No material IDs provided");

    const { error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_company_ext")
      .delete()
      .eq("company_id", companyId)
      .in("material_id", materialIds);

    if (error) throw new Error("OM_MATERIAL_UNMAP_FAILED");
    return okResponse({ unmapped: materialIds.length }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_UNMAP_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "Bulk unmap failed");
  }
}

export async function importCompanyMappingHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const csvText = toTrimmedString(body.csv_text);
    if (!csvText) return materialErrorResponse(req, ctx, "OM_CSV_EMPTY", 400, "CSV text is empty");

    const lines = csvText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return materialErrorResponse(req, ctx, "OM_CSV_NO_DATA", 400, "CSV has no data rows");

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/["\s]/g, ""));
    const results: {
      row: number;
      material_name: string;
      company_code: string;
      company_name: string | null;
      status: string;
      error: string | null;
    }[] = [];

    // Pre-load all companies for lookup
    const { data: companies } = await serviceRoleClient
      .schema("erp_master")
      .from("companies")
      .select("id,company_code,company_name");

    const companyByCode = new Map(
      (companies ?? []).map((c: Record<string, unknown>) => [
        String(c.company_code ?? "").toUpperCase(),
        c,
      ])
    );

    // Pre-load all materials for lookup by name
    const { data: materials } = await serviceRoleClient
      .schema("erp_master")
      .from("material_master")
      .select("id,material_name");

    const materialByName = new Map(
      (materials ?? []).map((m: Record<string, unknown>) => [
        String(m.material_name ?? "").toLowerCase(),
        m,
      ])
    );

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = cols[idx] ?? ""; });

      const materialName = (row["material_name"] ?? "").trim();
      const companyCode = (row["company_code"] ?? "").trim().toUpperCase();

      if (!materialName || !companyCode) {
        results.push({ row: i, material_name: materialName, company_code: companyCode, company_name: null, status: "SKIPPED", error: "material_name or company_code is empty" });
        continue;
      }

      const company = companyByCode.get(companyCode) as Record<string, unknown> | undefined;
      if (!company) {
        results.push({ row: i, material_name: materialName, company_code: companyCode, company_name: null, status: "ERROR", error: `Company not found: ${companyCode}` });
        continue;
      }

      const material = materialByName.get(materialName.toLowerCase()) as Record<string, unknown> | undefined;
      if (!material) {
        results.push({ row: i, material_name: materialName, company_code: companyCode, company_name: String(company.company_name ?? ""), status: "ERROR", error: `Material not found: ${materialName}` });
        continue;
      }

      const { error } = await serviceRoleClient
        .schema("erp_master")
        .from("material_company_ext")
        .upsert({
          material_id: String(material.id),
          company_id: String(company.id),
          procurement_allowed: true,
          status: "ACTIVE",
          created_by: ctx.auth_user_id,
        }, { onConflict: "material_id,company_id", ignoreDuplicates: true });

      if (error) {
        results.push({ row: i, material_name: materialName, company_code: companyCode, company_name: String(company.company_name ?? ""), status: "ERROR", error: "Insert failed" });
      } else {
        results.push({ row: i, material_name: materialName, company_code: companyCode, company_name: String(company.company_name ?? ""), status: "MAPPED", error: null });
      }
    }

    return okResponse({ results }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MAPPING_IMPORT_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "Company mapping import failed");
  }
}

// ── Company/Plant Extension ───────────────────────────────────────────────────

export async function extendMaterialToCompanyHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const materialId = toTrimmedString(body.material_id);
    const companyId = toTrimmedString(body.company_id);

    if (!(await getMaterialById(materialId))) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");
    }
    if (!(await ensureCompanyExists(companyId))) {
      return materialErrorResponse(req, ctx, "OM_COMPANY_NOT_FOUND", 404, "Company not found");
    }

    const payload = {
      material_id: materialId,
      company_id: companyId,
      valuation_method_override: toTrimmedString(body.valuation_method_override || body.costing_method).toUpperCase() || null,
      hsn_code_override: toTrimmedString(body.hsn_code_override) || null,
      procurement_allowed: body.procurement_allowed !== false,
      status: toTrimmedString(body.status).toUpperCase() || "ACTIVE",
      created_by: ctx.auth_user_id,
      approved_by: body.approved_by ? toTrimmedString(body.approved_by) : null,
      approved_at: body.approved_at ? toTrimmedString(body.approved_at) : null,
    };

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_company_ext")
      .upsert(payload, { onConflict: "material_id,company_id" })
      .select("*")
      .single();

    if (error || !data) throw new Error("OM_MATERIAL_EXTEND_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_EXTEND_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material company extension failed");
  }
}

export async function extendMaterialToPlantHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const materialId = toTrimmedString(body.material_id);
    const companyId = toTrimmedString(body.company_id);

    if (!(await getMaterialById(materialId))) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");
    }
    if (!(await ensureCompanyExists(companyId))) {
      return materialErrorResponse(req, ctx, "OM_COMPANY_NOT_FOUND", 404, "Company not found");
    }

    const payload = {
      material_id: materialId,
      company_id: companyId,
      default_storage_location_id: toTrimmedString(body.default_storage_location_id) || null,
      qa_required_on_inward_override: body.qa_required_on_inward_override ?? null,
      safety_stock_qty: body.safety_stock ?? body.safety_stock_qty ?? null,
      reorder_point_qty: body.reorder_point ?? body.reorder_point_qty ?? null,
      min_order_qty: body.min_order_qty ?? null,
      lead_time_days: body.lead_time_days ?? null,
      status: toTrimmedString(body.status).toUpperCase() || "ACTIVE",
      created_by: ctx.auth_user_id,
      approved_by: body.approved_by ? toTrimmedString(body.approved_by) : null,
      approved_at: body.approved_at ? toTrimmedString(body.approved_at) : null,
    };

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_plant_ext")
      .upsert(payload, { onConflict: "material_id,company_id" })
      .select("*")
      .single();

    if (error || !data) throw new Error("OM_MATERIAL_EXTEND_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_EXTEND_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material plant extension failed");
  }
}

// ── UOM Conversion ────────────────────────────────────────────────────────────

export async function createMaterialUomConversionHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const materialId = toTrimmedString(body.material_id);
    const fromUomCode = toTrimmedString(body.from_uom_code).toUpperCase();
    const toUomCode = toTrimmedString(body.to_uom_code).toUpperCase();
    const conversionFactor = deriveConversionFactor(body);

    if (!(await getMaterialById(materialId))) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");
    }
    if (!fromUomCode || !toUomCode || !(await ensureUomExists(fromUomCode)) || !(await ensureUomExists(toUomCode))) {
      return materialErrorResponse(req, ctx, "OM_INVALID_UOM", 400, "Invalid UOM");
    }
    if (!conversionFactor) {
      return materialErrorResponse(req, ctx, "OM_INVALID_UOM_CONVERSION", 400, "Invalid conversion factor");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_uom_conversion")
      .insert({
        material_id: materialId,
        from_uom_code: fromUomCode,
        to_uom_code: toUomCode,
        conversion_factor: conversionFactor,
        variable_conversion: body.variable_conversion === true,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return materialErrorResponse(req, ctx, "OM_UOM_CONVERSION_EXISTS", 409, "UOM conversion already exists");
      }
      throw new Error("OM_UOM_CONVERSION_CREATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_UOM_CONVERSION_CREATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("EXISTS") ? 409 : code.includes("INVALID") ? 400 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material UOM conversion create failed");
  }
}

export async function listMaterialUomConversionsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const params = new URL(req.url).searchParams;
    const materialId = toTrimmedString(params.get("material_id"));

    let query = serviceRoleClient
      .schema("erp_master")
      .from("material_uom_conversion")
      .select("*")
      .order("created_at", { ascending: false });

    if (materialId) query = query.eq("material_id", materialId);

    const { data, error } = await query;
    if (error) throw new Error("OM_UOM_CONVERSION_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_UOM_CONVERSION_LIST_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material UOM conversion list failed");
  }
}

export async function updateMaterialUomConversionHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    const conversionFactor = deriveConversionFactor(body);

    if (!id) return materialErrorResponse(req, ctx, "OM_UOM_CONVERSION_NOT_FOUND", 400, "Missing id");
    if (!conversionFactor) return materialErrorResponse(req, ctx, "OM_INVALID_UOM_CONVERSION", 400, "Invalid conversion factor");

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_uom_conversion")
      .update({ conversion_factor: conversionFactor })
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) throw new Error("OM_UOM_CONVERSION_UPDATE_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_UOM_CONVERSION_UPDATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material UOM conversion update failed");
  }
}

// ── Category Group ────────────────────────────────────────────────────────────

export async function createMaterialCategoryGroupHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const groupName = toTrimmedString(body.group_name);
    const groupCode = (
      toTrimmedString(body.group_code) ||
      groupName.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50)
    );

    if (!groupName || !groupCode) {
      return materialErrorResponse(req, ctx, "OM_INVALID_CATEGORY_GROUP", 400, "Invalid category group");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_category_group")
      .insert({
        group_name: groupName,
        group_code: groupCode,
        description: toTrimmedString(body.description) || null,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return materialErrorResponse(req, ctx, "OM_CATEGORY_GROUP_EXISTS", 409, "Category group already exists");
      }
      throw new Error("OM_CATEGORY_GROUP_CREATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_CATEGORY_GROUP_CREATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("EXISTS") ? 409 : code.includes("INVALID") ? 400 : 500;
    return materialErrorResponse(req, ctx, code, status, "Category group create failed");
  }
}

export async function listMaterialCategoryGroupsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_category_group")
      .select("*, members:material_category_group_member(id, material_id, is_primary)")
      .order("group_name", { ascending: true });

    if (error) throw new Error("OM_CATEGORY_GROUP_LIST_FAILED");

    const enriched = (data ?? []).map((g: Record<string, unknown>) => ({
      ...g,
      member_count: Array.isArray(g.members) ? (g.members as unknown[]).length : 0,
    }));

    return okResponse({ data: enriched }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_CATEGORY_GROUP_LIST_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "Category group list failed");
  }
}

export async function addMaterialCategoryMemberHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const groupId = toTrimmedString(body.group_id);
    const materialId = toTrimmedString(body.material_id);
    const isPrimary = body.is_primary === true;

    const { data: groupRow, error: groupError } = await serviceRoleClient
      .schema("erp_master")
      .from("material_category_group")
      .select("id")
      .eq("id", groupId)
      .maybeSingle();

    if (groupError || !groupRow?.id) {
      return materialErrorResponse(req, ctx, "OM_GROUP_NOT_FOUND", 404, "Group not found");
    }
    if (!(await getMaterialById(materialId))) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");
    }

    if (isPrimary) {
      await serviceRoleClient
        .schema("erp_master")
        .from("material_category_group_member")
        .update({ is_primary: false })
        .eq("group_id", groupId)
        .eq("is_primary", true);
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_category_group_member")
      .insert({
        group_id: groupId,
        material_id: materialId,
        is_primary: isPrimary,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return materialErrorResponse(req, ctx, "OM_MEMBER_EXISTS", 409, "Category member already exists");
      }
      throw new Error("OM_CATEGORY_MEMBER_CREATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_CATEGORY_MEMBER_CREATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("EXISTS") ? 409 : 500;
    return materialErrorResponse(req, ctx, code, status, "Category member create failed");
  }
}

export async function removeMaterialCategoryMemberHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const memberId = toTrimmedString(body.member_id);
    if (!memberId) {
      return materialErrorResponse(req, ctx, "OM_MEMBER_REMOVE_FAILED", 400, "Member ID required");
    }

    const { error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_category_group_member")
      .delete()
      .eq("id", memberId);

    if (error) throw new Error("OM_MEMBER_REMOVE_FAILED");
    return okResponse({ removed: true }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MEMBER_REMOVE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 400;
    return materialErrorResponse(req, ctx, code, status, "Category member remove failed");
  }
}

export async function updateMaterialCategoryGroupHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    if (!id) return materialErrorResponse(req, ctx, "OM_MCG_UPDATE_FAILED", 400, "Group ID missing");

    const patch: Record<string, unknown> = {};
    if (body.group_name !== undefined) patch.group_name = toTrimmedString(body.group_name);
    if (body.description !== undefined) patch.description = toTrimmedString(body.description) || null;

    if (Object.keys(patch).length === 0) {
      return materialErrorResponse(req, ctx, "OM_MCG_UPDATE_FAILED", 400, "No fields to update");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_category_group")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw new Error("OM_MCG_UPDATE_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MCG_UPDATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 400;
    return materialErrorResponse(req, ctx, code, status, "Category group update failed");
  }
}

export async function deleteMaterialCategoryGroupHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    if (!id) return materialErrorResponse(req, ctx, "OM_MCG_DELETE_FAILED", 400, "Group ID missing");

    const { count, error: countError } = await serviceRoleClient
      .schema("erp_master")
      .from("material_category_group_member")
      .select("id", { count: "exact", head: true })
      .eq("group_id", id);

    if (countError) throw new Error("OM_MCG_DELETE_FAILED");
    if ((count ?? 0) > 0) {
      return materialErrorResponse(req, ctx, "OM_MCG_HAS_MEMBERS", 409, "Remove all members before deleting the group");
    }

    const { error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_category_group")
      .delete()
      .eq("id", id);

    if (error) throw new Error("OM_MCG_DELETE_FAILED");
    return okResponse({ deleted: true }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MCG_DELETE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code === "OM_MCG_HAS_MEMBERS" ? 409 : 400;
    return materialErrorResponse(req, ctx, code, status, "Category group delete failed");
  }
}

// ── Extension List Handlers ───────────────────────────────────────────────────

export async function listMaterialCompanyExtensionsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const materialId = toTrimmedString(new URL(req.url).searchParams.get("material_id"));
    if (!materialId) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 400, "material_id required");
    }
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_company_ext")
      .select("*, companies:company_id(id, company_code, company_name)")
      .eq("material_id", materialId)
      .order("created_at", { ascending: true });
    if (error) throw new Error("OM_MATERIAL_COMPANY_EXT_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_COMPANY_EXT_LIST_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material company extension list failed");
  }
}

export async function listMaterialPlantExtensionsHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const materialId = toTrimmedString(new URL(req.url).searchParams.get("material_id"));
    if (!materialId) {
      return materialErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 400, "material_id required");
    }
    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("material_plant_ext")
      .select("*, companies:company_id(id, company_code, company_name)")
      .eq("material_id", materialId)
      .order("created_at", { ascending: true });
    if (error) throw new Error("OM_MATERIAL_PLANT_EXT_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_MATERIAL_PLANT_EXT_LIST_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return materialErrorResponse(req, ctx, code, status, "Material plant extension list failed");
  }
}
