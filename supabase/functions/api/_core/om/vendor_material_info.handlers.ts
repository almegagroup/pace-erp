/*
 * File-ID: 14.4
 * File-Path: supabase/functions/api/_core/om/vendor_material_info.handlers.ts
 * Gate: 14
 * Phase: 14
 * Domain: MASTER
 * Purpose: Implement vendor material info and approved source list handlers.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { OmHandlerContext } from "./shared.ts";
import { assertManagerOrSARole } from "./shared.ts";

type JsonRecord = Record<string, unknown>;

const VMI_STATUSES = new Set(["ACTIVE", "INACTIVE"]);

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function vmiErrorResponse(
  req: Request,
  ctx: OmHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

async function ensureVendorExists(vendorId: string): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("vendor_master")
    .select("id")
    .eq("id", vendorId)
    .maybeSingle();

  return !error && Boolean(data?.id);
}

async function getMaterialRow(materialId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, base_uom_code")
    .eq("id", materialId)
    .maybeSingle();

  if (error) {
    throw new Error("OM_MATERIAL_LOOKUP_FAILED");
  }

  return (data as Record<string, unknown> | null) ?? null;
}

async function loadExistingUomCodes(codes: string[]): Promise<Set<string>> {
  if (codes.length === 0) {
    return new Set();
  }

  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("uom_master")
    .select("code")
    .in("code", codes);

  if (error) {
    return new Set();
  }

  return new Set((data ?? []).map((row: Record<string, unknown>) => String(row.code ?? "").toUpperCase()).filter(Boolean));
}

async function getVmiRow(
  id: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("vendor_material_info")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error("OM_VMI_LOOKUP_FAILED");
  }

  return (data as Record<string, unknown> | null) ?? null;
}

async function fetchChildLists(
  vmiIds: string[],
): Promise<{
  uomMap: Map<string, Record<string, unknown>[]>;
  currencyMap: Map<string, Record<string, unknown>[]>;
  paymentTermMap: Map<string, Record<string, unknown>[]>;
}> {
  if (vmiIds.length === 0) {
    return { uomMap: new Map(), currencyMap: new Map(), paymentTermMap: new Map() };
  }

  const [uomResult, currencyResult, paymentTermResult] = await Promise.all([
    serviceRoleClient
      .schema("erp_master")
      .from("vendor_material_uom")
      .select("id, vmi_id, uom_code, conversion_factor, is_default")
      .in("vmi_id", vmiIds),
    serviceRoleClient
      .schema("erp_master")
      .from("vendor_material_currency")
      .select("id, vmi_id, currency_code, is_default")
      .in("vmi_id", vmiIds),
    serviceRoleClient
      .schema("erp_master")
      .from("vendor_material_payment_term")
      .select("id, vmi_id, payment_term_id, is_default, payment_terms_master:payment_term_id (code, name)")
      .in("vmi_id", vmiIds),
  ]);

  const uomMap = new Map<string, Record<string, unknown>[]>();
  for (const row of (uomResult.data ?? []) as Record<string, unknown>[]) {
    const list = uomMap.get(row.vmi_id as string) ?? [];
    list.push(row);
    uomMap.set(row.vmi_id as string, list);
  }

  const currencyMap = new Map<string, Record<string, unknown>[]>();
  for (const row of (currencyResult.data ?? []) as Record<string, unknown>[]) {
    const list = currencyMap.get(row.vmi_id as string) ?? [];
    list.push(row);
    currencyMap.set(row.vmi_id as string, list);
  }

  const paymentTermMap = new Map<string, Record<string, unknown>[]>();
  for (const row of (paymentTermResult.data ?? []) as Record<string, unknown>[]) {
    const term = row.payment_terms_master as Record<string, unknown> | null;
    const flat = {
      id: row.id,
      vmi_id: row.vmi_id,
      payment_term_id: row.payment_term_id,
      is_default: row.is_default,
      payment_term_code: term?.code ?? null,
      payment_term_name: term?.name ?? null,
    };
    const list = paymentTermMap.get(row.vmi_id as string) ?? [];
    list.push(flat);
    paymentTermMap.set(row.vmi_id as string, list);
  }

  return { uomMap, currencyMap, paymentTermMap };
}

async function enrichVmiRows(rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return rows;

  const vendorIds = [...new Set(rows.map((r) => r.vendor_id as string).filter(Boolean))];
  const materialIds = [...new Set(rows.map((r) => r.material_id as string).filter(Boolean))];
  const vmiIds = [...new Set(rows.map((r) => r.id as string).filter(Boolean))];

  const [vendorResult, materialResult, childLists] = await Promise.all([
    serviceRoleClient.schema("erp_master").from("vendor_master").select("id, vendor_code, vendor_name").in("id", vendorIds),
    serviceRoleClient.schema("erp_master").from("material_master").select("id, pace_code, material_name, base_uom_code").in("id", materialIds),
    fetchChildLists(vmiIds),
  ]);

  const vendorMap = new Map<string, Record<string, unknown>>();
  for (const v of (vendorResult.data ?? []) as Record<string, unknown>[]) {
    vendorMap.set(v.id as string, v);
  }
  const materialMap = new Map<string, Record<string, unknown>>();
  for (const m of (materialResult.data ?? []) as Record<string, unknown>[]) {
    materialMap.set(m.id as string, m);
  }

  return rows.map((row) => {
    const vendor = vendorMap.get(row.vendor_id as string) ?? {};
    const material = materialMap.get(row.material_id as string) ?? {};
    const uoms = childLists.uomMap.get(row.id as string) ?? [];
    const currencies = childLists.currencyMap.get(row.id as string) ?? [];
    const paymentTerms = childLists.paymentTermMap.get(row.id as string) ?? [];
    const defaultUom = uoms.find((u) => u.is_default) ?? null;
    const defaultCurrency = currencies.find((c) => c.is_default) ?? null;
    return {
      ...row,
      vendor_code: vendor.vendor_code ?? null,
      vendor_name: vendor.vendor_name ?? null,
      pace_code: material.pace_code ?? null,
      material_name: material.material_name ?? null,
      base_uom_code: material.base_uom_code ?? null,
      uoms,
      currencies,
      payment_terms: paymentTerms,
      default_uom_code: defaultUom?.uom_code ?? null,
      default_currency_code: defaultCurrency?.currency_code ?? null,
    };
  });
}

function normalizeUomList(input: unknown): { uom_code: string; conversion_factor: number; is_default: boolean }[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      const uomCode = toTrimmedString(row.uom_code).toUpperCase();
      const factor = Number(row.conversion_factor);
      return {
        uom_code: uomCode,
        conversion_factor: Number.isFinite(factor) && factor > 0 ? factor : NaN,
        is_default: row.is_default === true,
      };
    })
    .filter((row) => row.uom_code && Number.isFinite(row.conversion_factor));
}

function normalizeCurrencyList(input: unknown): { currency_code: string; is_default: boolean }[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        currency_code: toTrimmedString(row.currency_code).toUpperCase(),
        is_default: row.is_default === true,
      };
    })
    .filter((row) => row.currency_code);
}

function normalizePaymentTermList(input: unknown): { payment_term_id: string; is_default: boolean }[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        payment_term_id: toTrimmedString(row.payment_term_id),
        is_default: row.is_default === true,
      };
    })
    .filter((row) => row.payment_term_id);
}

function ensureExactlyOneDefault<T extends { is_default: boolean }>(rows: T[]): T[] {
  if (rows.length === 0) return rows;
  const hasDefault = rows.some((row) => row.is_default);
  if (hasDefault) {
    let seen = false;
    return rows.map((row) => {
      if (row.is_default && !seen) {
        seen = true;
        return row;
      }
      return { ...row, is_default: false };
    });
  }
  return rows.map((row, index) => (index === 0 ? { ...row, is_default: true } : row));
}

async function replaceVmiUoms(
  vmiId: string,
  list: { uom_code: string; conversion_factor: number; is_default: boolean }[],
  authUserId: string,
): Promise<void> {
  await serviceRoleClient.schema("erp_master").from("vendor_material_uom").delete().eq("vmi_id", vmiId);
  if (list.length === 0) return;
  const normalized = ensureExactlyOneDefault(list);
  const { error } = await serviceRoleClient
    .schema("erp_master")
    .from("vendor_material_uom")
    .insert(normalized.map((row) => ({ vmi_id: vmiId, ...row, created_by: authUserId })));
  if (error) {
    throw new Error("OM_INVALID_UOM");
  }
}

async function replaceVmiCurrencies(
  vmiId: string,
  list: { currency_code: string; is_default: boolean }[],
  authUserId: string,
): Promise<void> {
  await serviceRoleClient.schema("erp_master").from("vendor_material_currency").delete().eq("vmi_id", vmiId);
  if (list.length === 0) return;
  const normalized = ensureExactlyOneDefault(list);
  const { error } = await serviceRoleClient
    .schema("erp_master")
    .from("vendor_material_currency")
    .insert(normalized.map((row) => ({ vmi_id: vmiId, ...row, created_by: authUserId })));
  if (error) {
    throw new Error("OM_INVALID_CURRENCY");
  }
}

async function replaceVmiPaymentTerms(
  vmiId: string,
  list: { payment_term_id: string; is_default: boolean }[],
  authUserId: string,
): Promise<void> {
  await serviceRoleClient.schema("erp_master").from("vendor_material_payment_term").delete().eq("vmi_id", vmiId);
  if (list.length === 0) return;
  const normalized = ensureExactlyOneDefault(list);
  const { error } = await serviceRoleClient
    .schema("erp_master")
    .from("vendor_material_payment_term")
    .insert(normalized.map((row) => ({ vmi_id: vmiId, ...row, created_by: authUserId })));
  if (error) {
    throw new Error("OM_INVALID_PAYMENT_TERM");
  }
}

export async function createVendorMaterialInfoHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);

    const body = await parseBody(req);
    const vendorId = toTrimmedString(body.vendor_id);
    const materialId = toTrimmedString(body.material_id);

    if (!(await ensureVendorExists(vendorId))) {
      return vmiErrorResponse(req, ctx, "OM_VENDOR_NOT_FOUND", 404, "Vendor not found");
    }

    const material = await getMaterialRow(materialId);
    if (!material) {
      return vmiErrorResponse(req, ctx, "OM_MATERIAL_NOT_FOUND", 404, "Material not found");
    }

    const uomList = normalizeUomList(body.uoms);
    if (uomList.length === 0) {
      return vmiErrorResponse(req, ctx, "OM_INVALID_UOM", 400, "At least one UOM is required");
    }
    const existingUomCodes = await loadExistingUomCodes([...new Set(uomList.map((row) => row.uom_code))]);
    for (const row of uomList) {
      if (!existingUomCodes.has(row.uom_code)) {
        return vmiErrorResponse(req, ctx, "OM_INVALID_UOM", 400, `Invalid UOM: ${row.uom_code}`);
      }
    }

    const currencyList = normalizeCurrencyList(body.currencies);
    if (currencyList.length === 0) {
      return vmiErrorResponse(req, ctx, "OM_INVALID_CURRENCY", 400, "At least one currency is required");
    }

    const paymentTermList = normalizePaymentTermList(body.payment_terms);

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_material_info")
      .insert({
        vendor_id: vendorId,
        material_id: materialId,
        vendor_material_code: toTrimmedString(body.vendor_material_code) || null,
        vendor_material_description: toTrimmedString(body.vendor_material_description) || null,
        pack_size_description: toTrimmedString(body.pack_size_description) || "Standard",
        last_purchase_price: body.price_per_base_uom != null ? Number(body.price_per_base_uom) : null,
        last_purchase_currency: toTrimmedString(body.currency_code) || null,
        status: "ACTIVE",
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return vmiErrorResponse(req, ctx, "OM_VMI_EXISTS", 409, "Vendor-material pair already exists");
      }
      throw new Error("OM_VMI_CREATE_FAILED");
    }

    const vmiId = (data as Record<string, unknown>).id as string;
    await replaceVmiUoms(vmiId, uomList, ctx.auth_user_id);
    await replaceVmiCurrencies(vmiId, currencyList, ctx.auth_user_id);
    await replaceVmiPaymentTerms(vmiId, paymentTermList, ctx.auth_user_id);

    const [enriched] = await enrichVmiRows([data as Record<string, unknown>]);
    return okResponse({ data: enriched }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VMI_CREATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("EXISTS") ? 409 : code.includes("INVALID") ? 400 : 500;
    return vmiErrorResponse(req, ctx, code, status, "Vendor material info create failed");
  }
}

export async function listVendorMaterialInfosHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);

    const url = new URL(req.url);
    const vendorSearch = toTrimmedString(url.searchParams.get("vendor_search")).replace(/[%_]/g, "");
    const materialSearch = toTrimmedString(url.searchParams.get("material_search")).replace(/[%_]/g, "");
    const statusFilter = toTrimmedString(url.searchParams.get("status")).toUpperCase();
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);
    const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);

    // When searching by vendor name/code or material name/code, resolve IDs first
    let vendorIds: string[] | null = null;
    let materialIds: string[] | null = null;

    if (vendorSearch) {
      const { data: vendorRows } = await serviceRoleClient
        .schema("erp_master")
        .from("vendor_master")
        .select("id")
        .or(`vendor_code.ilike.%${vendorSearch}%,vendor_name.ilike.%${vendorSearch}%`)
        .limit(500);
      vendorIds = (vendorRows ?? []).map((v: Record<string, unknown>) => v.id as string);
      if (vendorIds.length === 0) {
        return okResponse({ data: [], total: 0 }, ctx.request_id, req);
      }
    }

    if (materialSearch) {
      const { data: materialRows } = await serviceRoleClient
        .schema("erp_master")
        .from("material_master")
        .select("id")
        .or(`pace_code.ilike.%${materialSearch}%,material_name.ilike.%${materialSearch}%`)
        .limit(500);
      materialIds = (materialRows ?? []).map((m: Record<string, unknown>) => m.id as string);
      if (materialIds.length === 0) {
        return okResponse({ data: [], total: 0 }, ctx.request_id, req);
      }
    }

    let query = serviceRoleClient
      .schema("erp_master")
      .from("vendor_material_info")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (vendorIds !== null) {
      query = query.in("vendor_id", vendorIds);
    }
    if (materialIds !== null) {
      query = query.in("material_id", materialIds);
    }
    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const { data, error, count } = await query;
    if (error) {
      throw new Error("OM_VMI_LIST_FAILED");
    }

    const enriched = await enrichVmiRows((data ?? []) as Record<string, unknown>[]);

    return okResponse({ data: enriched, total: count ?? 0 }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VMI_LIST_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return vmiErrorResponse(req, ctx, code, status, "Vendor material info list failed");
  }
}

export async function getVendorMaterialInfoHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);

    const url = new URL(req.url);
    const id = toTrimmedString(url.searchParams.get("id"));
    const vendorId = toTrimmedString(url.searchParams.get("vendor_id"));
    const materialId = toTrimmedString(url.searchParams.get("material_id"));

    let data: Record<string, unknown> | null = null;

    if (id) {
      data = await getVmiRow(id);
    } else if (vendorId && materialId) {
      const result = await serviceRoleClient
        .schema("erp_master")
        .from("vendor_material_info")
        .select("*")
        .eq("vendor_id", vendorId)
        .eq("material_id", materialId)
        .maybeSingle();

      if (result.error) {
        throw new Error("OM_VMI_LOOKUP_FAILED");
      }
      data = (result.data as Record<string, unknown> | null) ?? null;
    }

    if (!data) {
      return vmiErrorResponse(req, ctx, "OM_VMI_NOT_FOUND", 404, "Vendor material info not found");
    }

    const [enriched] = await enrichVmiRows([data]);
    return okResponse({ data: enriched }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VMI_LOOKUP_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return vmiErrorResponse(req, ctx, code, status, "Vendor material info lookup failed");
  }
}

export async function updateVendorMaterialInfoHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);

    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    if (!id) {
      return vmiErrorResponse(req, ctx, "OM_VMI_NOT_FOUND", 404, "Vendor material info not found");
    }

    const existing = await getVmiRow(id);
    if (!existing) {
      return vmiErrorResponse(req, ctx, "OM_VMI_NOT_FOUND", 404, "Vendor material info not found");
    }

    const updates: JsonRecord = {
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    };

    const mutableFields = [
      "vendor_material_code",
      "vendor_material_description",
      "pack_size_description",
      "last_purchase_price",
      "last_purchase_currency",
      "last_grn_date",
    ];

    for (const field of mutableFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (body.price_per_base_uom !== undefined) {
      updates.last_purchase_price = body.price_per_base_uom;
    }
    if (body.currency_code !== undefined) {
      updates.last_purchase_currency = body.currency_code;
    }

    let uomList: ReturnType<typeof normalizeUomList> | null = null;
    if (body.uoms !== undefined) {
      uomList = normalizeUomList(body.uoms);
      if (uomList.length === 0) {
        return vmiErrorResponse(req, ctx, "OM_INVALID_UOM", 400, "At least one UOM is required");
      }
      const existingUomCodes = await loadExistingUomCodes([...new Set(uomList.map((row) => row.uom_code))]);
      for (const row of uomList) {
        if (!existingUomCodes.has(row.uom_code)) {
          return vmiErrorResponse(req, ctx, "OM_INVALID_UOM", 400, `Invalid UOM: ${row.uom_code}`);
        }
      }
    }

    let currencyList: ReturnType<typeof normalizeCurrencyList> | null = null;
    if (body.currencies !== undefined) {
      currencyList = normalizeCurrencyList(body.currencies);
      if (currencyList.length === 0) {
        return vmiErrorResponse(req, ctx, "OM_INVALID_CURRENCY", 400, "At least one currency is required");
      }
    }

    let paymentTermList: ReturnType<typeof normalizePaymentTermList> | null = null;
    if (body.payment_terms !== undefined) {
      paymentTermList = normalizePaymentTermList(body.payment_terms);
    }

    if (Object.keys(updates).length === 2 && uomList === null && currencyList === null && paymentTermList === null) {
      return vmiErrorResponse(req, ctx, "OM_VMI_NO_CHANGES", 400, "No changes provided");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_material_info")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_VMI_UPDATE_FAILED");
    }

    if (uomList !== null) {
      await replaceVmiUoms(id, uomList, ctx.auth_user_id);
    }
    if (currencyList !== null) {
      await replaceVmiCurrencies(id, currencyList, ctx.auth_user_id);
    }
    if (paymentTermList !== null) {
      await replaceVmiPaymentTerms(id, paymentTermList, ctx.auth_user_id);
    }

    const [enriched] = await enrichVmiRows([data as Record<string, unknown>]);
    return okResponse({ data: enriched }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VMI_UPDATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("INVALID") ? 400 : 500;
    return vmiErrorResponse(req, ctx, code, status, "Vendor material info update failed");
  }
}

async function hasBlockingPoLines(vmiId: string): Promise<boolean> {
  const { count, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order_line")
    .select("id", { count: "exact", head: true })
    .eq("vendor_material_info_id", vmiId)
    .in("line_status", ["OPEN", "PARTIALLY_RECEIVED"]);

  if (error) {
    throw new Error("OM_VMI_PO_USAGE_LOOKUP_FAILED");
  }

  return (count ?? 0) > 0;
}

export async function unmapVendorMaterialInfoHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);

    const url = new URL(req.url);
    const id = toTrimmedString(url.searchParams.get("id"));
    if (!id) {
      return vmiErrorResponse(req, ctx, "OM_VMI_NOT_FOUND", 404, "Vendor material info not found");
    }

    const existing = await getVmiRow(id);
    if (!existing) {
      return vmiErrorResponse(req, ctx, "OM_VMI_NOT_FOUND", 404, "Vendor material info not found");
    }

    if (await hasBlockingPoLines(id)) {
      return vmiErrorResponse(
        req,
        ctx,
        "OM_VMI_HAS_OPEN_PO",
        409,
        "Cannot unmap — open or in-transit PO lines reference this vendor-material pair",
      );
    }

    // UOM/currency/payment-term rows cascade-delete with the parent VMI row.
    const { error } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_material_info")
      .delete()
      .eq("id", id);

    if (error) {
      throw new Error("OM_VMI_UNMAP_FAILED");
    }

    return okResponse({ data: { id } }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VMI_UNMAP_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("HAS_OPEN_PO") ? 409 : 500;
    return vmiErrorResponse(req, ctx, code, status, "Vendor material info unmap failed");
  }
}

export async function changeVendorMaterialInfoStatusHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);

    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    const newStatus = toTrimmedString(body.new_status).toUpperCase();

    if (!id) {
      return vmiErrorResponse(req, ctx, "OM_VMI_NOT_FOUND", 404, "Vendor material info not found");
    }
    if (!VMI_STATUSES.has(newStatus)) {
      return vmiErrorResponse(req, ctx, "OM_INVALID_STATUS", 400, "Invalid status");
    }

    const existing = await getVmiRow(id);
    if (!existing) {
      return vmiErrorResponse(req, ctx, "OM_VMI_NOT_FOUND", 404, "Vendor material info not found");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_material_info")
      .update({
        status: newStatus,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("OM_VMI_STATUS_UPDATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VMI_STATUS_UPDATE_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("INVALID") ? 400 : 500;
    return vmiErrorResponse(req, ctx, code, status, "Vendor material info status update failed");
  }
}

export async function listMappedMaterialIdsForVendorHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);

    const url = new URL(req.url);
    const vendorId = toTrimmedString(url.searchParams.get("vendor_id"));
    if (!vendorId) {
      return vmiErrorResponse(req, ctx, "OM_VENDOR_ID_REQUIRED", 400, "vendor_id is required");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("vendor_material_info")
      .select("material_id")
      .eq("vendor_id", vendorId);

    if (error) {
      throw new Error("OM_VMI_MAPPED_MATERIALS_LOOKUP_FAILED");
    }

    const materialIds = [...new Set((data ?? []).map((row: Record<string, unknown>) => row.material_id as string).filter(Boolean))];
    return okResponse({ data: materialIds }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_VMI_MAPPED_MATERIALS_LOOKUP_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : code.includes("REQUIRED") ? 400 : 500;
    return vmiErrorResponse(req, ctx, code, status, "Mapped materials lookup failed");
  }
}
