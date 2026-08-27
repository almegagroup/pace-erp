/*
 * File-Path: supabase/functions/api/_core/om/customer_address.handlers.ts
 * Purpose: CRUD for erp_master.customer_address (feasibility doc Section 129).
 *          One customer can have multiple addresses/sites; each address can
 *          later be mapped (Stage 2, optional) to a Virtual Depot Code
 *          (fg_depot_code -> fg_parent_company). GST lives on the customer,
 *          not the address (§129.4) — this file never touches GST.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { OmHandlerContext } from "./shared.ts";
import { assertCustomerCompanyScope } from "./customer.handlers.ts";
import { INDIAN_STATE_NAMES } from "../../_shared/indianStates.ts";

type JsonRecord = Record<string, unknown>;

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function addressErrorResponse(
  req: Request,
  ctx: OmHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

async function getCustomerStateById(customerId: string): Promise<string | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("customer_master")
    .select("billing_state")
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw new Error("OM_CUSTOMER_LOOKUP_FAILED");
  return (data?.billing_state as string | null) ?? null;
}

// feasibility §132.5/132.9 — customer_master.is_dependent is derived, never
// user-set: TRUE when ANY of the customer's addresses is VDC-mapped. Must be
// recomputed every time an address's depot_code_id changes (single or bulk).
async function recomputeCustomerIsDependent(customerId: string): Promise<void> {
  const { data: mappedRows, error: lookupError } = await serviceRoleClient
    .schema("erp_master")
    .from("customer_address")
    .select("id")
    .eq("customer_id", customerId)
    .not("depot_code_id", "is", null)
    .limit(1);
  if (lookupError) throw new Error("OM_ADDRESS_DEPENDENT_RECOMPUTE_FAILED");

  const { error: updateError } = await serviceRoleClient
    .schema("erp_master")
    .from("customer_master")
    .update({ is_dependent: (mappedRows ?? []).length > 0 })
    .eq("id", customerId);
  if (updateError) throw new Error("OM_ADDRESS_DEPENDENT_RECOMPUTE_FAILED");
}

async function getAddressById(id: string): Promise<JsonRecord | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("customer_address")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("OM_ADDRESS_LOOKUP_FAILED");
  return (data as JsonRecord | null) ?? null;
}

// §8A — bulk-resolve VDC + Parent Company in one batch, never per-row.
async function enrichAddressRows(rows: JsonRecord[]): Promise<JsonRecord[]> {
  if (rows.length === 0) return rows;
  const depotCodeIds = [...new Set(rows.map((r) => r.depot_code_id as string).filter(Boolean))];
  const { data: depotCodes, error: depotError } = depotCodeIds.length
    ? await serviceRoleClient
        .schema("erp_master")
        .from("fg_depot_code")
        .select("id, code, dispatch_type, parent_company_id, parent_company:parent_company_id(id, company_name)")
        .in("id", depotCodeIds)
    : { data: [] as JsonRecord[], error: null };
  if (depotError) throw new Error("OM_ADDRESS_DEPOT_CODE_LOOKUP_FAILED");

  const depotMap = new Map<string, JsonRecord>();
  for (const d of (depotCodes ?? []) as JsonRecord[]) {
    depotMap.set(d.id as string, d);
  }

  return rows.map((row) => {
    const depot = row.depot_code_id ? depotMap.get(row.depot_code_id as string) : null;
    const parentCompany = depot?.parent_company as JsonRecord | null | undefined;
    return {
      ...row,
      depot_code: depot?.code ?? null,
      depot_dispatch_type: depot?.dispatch_type ?? null,
      parent_company_id: parentCompany?.id ?? null,
      parent_company_name: parentCompany?.company_name ?? null,
    };
  });
}

export async function listCustomerAddressesHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    const customerId = toTrimmedString(new URL(req.url).searchParams.get("customer_id"));
    if (!customerId) {
      return addressErrorResponse(req, ctx, "OM_ADDRESS_CUSTOMER_ID_REQUIRED", 400, "customer_id is required");
    }
    await assertCustomerCompanyScope(ctx, customerId, "OM_CUSTOMER_LIST", "VIEW");

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("customer_address")
      .select("*")
      .eq("customer_id", customerId)
      .eq("status", "ACTIVE")
      .order("created_at", { ascending: true });
    if (error) throw new Error("OM_ADDRESS_LIST_FAILED");

    const enriched = await enrichAddressRows((data ?? []) as JsonRecord[]);
    return okResponse({ data: enriched }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_ADDRESS_LIST_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") ? 400 : 500;
    return addressErrorResponse(req, ctx, code, status, "Address list failed");
  }
}

export async function createCustomerAddressHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    const body = await parseBody(req);
    const customerId = toTrimmedString(body.customer_id);
    const siteName = toTrimmedString(body.site_name);
    const addressLine = toTrimmedString(body.address_line);
    const town = toTrimmedString(body.town);
    let state = toTrimmedString(body.state);

    if (!customerId) {
      return addressErrorResponse(req, ctx, "OM_ADDRESS_CUSTOMER_ID_REQUIRED", 400, "customer_id is required");
    }
    await assertCustomerCompanyScope(ctx, customerId, "OM_CUSTOMER_CREATE", "WRITE");

    // §129.3/§129.7 — Stage 1 mandatory: Site Name, Address, Town, State.
    if (!siteName || !addressLine || !town) {
      return addressErrorResponse(req, ctx, "OM_ADDRESS_INVALID_INPUT", 400, "site_name, address_line, and town are required");
    }
    // §129.4 — an address's state always matches its customer's own state
    // (GST/state is a customer-level fact); default from the customer when
    // the caller doesn't send one, and reject a mismatch rather than silently
    // overwriting the caller's explicit value.
    const customerState = await getCustomerStateById(customerId);
    if (!state) {
      state = customerState ?? "";
    }
    if (!state) {
      return addressErrorResponse(req, ctx, "OM_ADDRESS_STATE_REQUIRED", 400, "state is required");
    }
    if (!INDIAN_STATE_NAMES.has(state)) {
      return addressErrorResponse(req, ctx, "OM_ADDRESS_INVALID_STATE", 400, "Invalid state");
    }
    if (customerState && state !== customerState) {
      return addressErrorResponse(req, ctx, "OM_ADDRESS_STATE_MISMATCH", 400, "Address state must match the customer's own state");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("customer_address")
      .insert({
        customer_id: customerId,
        site_name: siteName,
        address_line: addressLine,
        town,
        state,
        pin_code: toTrimmedString(body.pin_code) || null,
        status: "ACTIVE",
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();
    if (error || !data) {
      console.error("[createCustomerAddressHandler] insert failed:", JSON.stringify(error));
      throw new Error("OM_ADDRESS_CREATE_FAILED");
    }

    const [enriched] = await enrichAddressRows([data as JsonRecord]);
    return okResponse({ data: enriched }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_ADDRESS_CREATE_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") || code.includes("INVALID") || code.includes("MISMATCH") ? 400 : 500;
    return addressErrorResponse(req, ctx, code, status, "Address create failed");
  }
}

export async function updateCustomerAddressHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    const body = await parseBody(req);
    const id = toTrimmedString(body.id);
    if (!id) {
      return addressErrorResponse(req, ctx, "OM_ADDRESS_NOT_FOUND", 404, "Address not found");
    }
    const existing = await getAddressById(id);
    if (!existing) {
      return addressErrorResponse(req, ctx, "OM_ADDRESS_NOT_FOUND", 404, "Address not found");
    }
    await assertCustomerCompanyScope(ctx, existing.customer_id as string, "OM_CUSTOMER_CREATE", "EDIT");

    const updates: JsonRecord = {};
    for (const field of ["site_name", "address_line", "town", "pin_code", "status"]) {
      if (body[field] !== undefined) updates[field] = toTrimmedString(body[field]) || null;
    }
    // depot_code_id: this is the "Map this address to a VDC" action (§129.3
    // Step 5 / §129.8) — explicit key check so a caller can also send
    // depot_code_id: null to unmap.
    if (Object.prototype.hasOwnProperty.call(body, "depot_code_id")) {
      const depotCodeId = toTrimmedString(body.depot_code_id);
      if (depotCodeId) {
        const { data: depot, error: depotError } = await serviceRoleClient
          .schema("erp_master")
          .from("fg_depot_code")
          .select("id")
          .eq("id", depotCodeId)
          .maybeSingle();
        if (depotError || !depot) {
          return addressErrorResponse(req, ctx, "OM_ADDRESS_DEPOT_CODE_NOT_FOUND", 404, "Depot code not found");
        }
      }
      updates.depot_code_id = depotCodeId || null;
    }

    if (Object.keys(updates).length === 0) {
      return addressErrorResponse(req, ctx, "OM_ADDRESS_NO_CHANGES", 400, "No changes provided");
    }
    updates.last_updated_by = ctx.auth_user_id;
    updates.last_updated_at = new Date().toISOString();

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("customer_address")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) throw new Error("OM_ADDRESS_UPDATE_FAILED");

    if (Object.prototype.hasOwnProperty.call(updates, "depot_code_id")) {
      await recomputeCustomerIsDependent(existing.customer_id as string);
    }

    const [enriched] = await enrichAddressRows([data as JsonRecord]);
    return okResponse({ data: enriched }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_ADDRESS_UPDATE_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("NO_CHANGES") ? 400 : 500;
    return addressErrorResponse(req, ctx, code, status, "Address update failed");
  }
}

// 2026-08-22 — dedicated Address<->VDC mapping page: business owner's
// explicit ask is multi-select (several addresses under one customer, all
// belonging to the same VDC, mapped in one action) instead of the existing
// per-address picker inside CustomerEditForm.jsx. §8B: these are INDEPENDENT
// row writes (each address row doesn't depend on another's result), so this
// is one batch UPDATE, not a per-address loop. address_ids is bounded to one
// customer's own address list (small, no §8E chunking need).
export async function bulkMapCustomerAddressesHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    const body = await parseBody(req);
    const addressIds = Array.isArray(body.address_ids)
      ? [...new Set((body.address_ids as unknown[]).map((v) => toTrimmedString(v)).filter(Boolean))]
      : [];
    const depotCodeId = Object.prototype.hasOwnProperty.call(body, "depot_code_id")
      ? toTrimmedString(body.depot_code_id)
      : "";
    if (addressIds.length === 0) {
      return addressErrorResponse(req, ctx, "OM_ADDRESS_IDS_REQUIRED", 400, "address_ids is required");
    }

    const { data: rows, error: rowsError } = await serviceRoleClient
      .schema("erp_master")
      .from("customer_address")
      .select("id, customer_id")
      .in("id", addressIds);
    if (rowsError) throw new Error("OM_ADDRESS_LOOKUP_FAILED");
    if (!rows || rows.length !== addressIds.length) {
      return addressErrorResponse(req, ctx, "OM_ADDRESS_NOT_FOUND", 404, "One or more addresses were not found");
    }
    const customerIds = [...new Set((rows as JsonRecord[]).map((r) => String(r.customer_id)))];
    if (customerIds.length !== 1) {
      return addressErrorResponse(req, ctx, "OM_ADDRESS_MIXED_CUSTOMERS", 400, "All selected addresses must belong to the same customer");
    }
    await assertCustomerCompanyScope(ctx, customerIds[0], "OM_CUSTOMER_CREATE", "EDIT");

    if (depotCodeId) {
      const { data: depot, error: depotError } = await serviceRoleClient
        .schema("erp_master")
        .from("fg_depot_code")
        .select("id")
        .eq("id", depotCodeId)
        .maybeSingle();
      if (depotError || !depot) {
        return addressErrorResponse(req, ctx, "OM_ADDRESS_DEPOT_CODE_NOT_FOUND", 404, "Depot code not found");
      }
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("customer_address")
      .update({
        depot_code_id: depotCodeId || null,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: new Date().toISOString(),
      })
      .in("id", addressIds)
      .select("*");
    if (error) {
      console.error("[bulkMapCustomerAddressesHandler] update failed:", JSON.stringify(error));
      throw new Error("OM_ADDRESS_BULK_MAP_FAILED");
    }

    await recomputeCustomerIsDependent(customerIds[0]);

    const enriched = await enrichAddressRows((data ?? []) as JsonRecord[]);
    return okResponse({ data: enriched }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_ADDRESS_BULK_MAP_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403
      : code.includes("NOT_FOUND") ? 404
      : code.includes("REQUIRED") || code.includes("MIXED_CUSTOMERS") ? 400
      : 500;
    return addressErrorResponse(req, ctx, code, status, "Address bulk mapping failed");
  }
}
