/*
 * File-Path: supabase/functions/api/_core/procurement/delivery_order.handlers.ts
 * Domain: PROCUREMENT / Sales
 * Purpose: §113 Stage 2 — Delivery Order (DO). Shared by SO (RM/PM/INT) and
 *          STO, extends the existing delivery_challan/_line tables (not a
 *          new parallel table, §113.3). Cost Center is header-level,
 *          Storage Location is per-line (§113.8 — neither exists on SO/STO
 *          Stage 1 anymore). Saving a DO: (1) reserves stock via the
 *          existing erp_production.reservation_document mechanism (already
 *          designed for SALES_ORDER/STO source types, never wired up until
 *          now), (2) locks the source SO/STO line (derived — §113.5, no
 *          new column), (3) for STO-sourced lines, auto-syncs the linked
 *          CSN's dispatch_qty via upsertCsnDispatch(), mirroring
 *          gate_entry.handlers.ts's upsertCsnArrival() on the receiving
 *          side.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const DO_SOURCE_TYPES = new Set(["SALES_ORDER", "STO"]);
const RESERVATION_OPEN_STATUSES = ["OPEN", "PARTIAL"];

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getPathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}

function getIdFromPath(req: Request): string {
  return getPathSegments(req)[3] ?? "";
}

function doErrorResponse(req: Request, ctx: ProcurementHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function assertProcurementReadRole(_ctx: ProcurementHandlerContext): void {
  // Protected by upstream pipeline/ACL layer — same convention as sales_order.handlers.ts.
}

async function generateProcurementDocNumber(docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient.schema("erp_procurement").rpc("generate_doc_number", { p_doc_type: docType });
  if (error || !data) throw new Error("PROCUREMENT_DOC_NUMBER_FAILED");
  return String(data);
}

// §113 picker drawer — open SO documents (company-scoped) that still have
// at least one unlocked line. "Unlocked" = no delivery_challan_line
// references it yet (§113.5 derivation, same as sales_order.handlers.ts).
export async function listDOSourceDocumentsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const sourceType = toUpperTrimmedString(url.searchParams.get("source_type"));
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    if (!DO_SOURCE_TYPES.has(sourceType)) {
      return doErrorResponse(req, ctx, "DO_SOURCE_TYPE_INVALID", 400, "source_type must be SALES_ORDER or STO.");
    }
    if (companyId) {
      try {
        await assertCompanyScope(ctx, companyId);
      } catch {
        return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
      }
    }

    if (sourceType === "SALES_ORDER") {
      let query = serviceRoleClient
        .schema("erp_procurement")
        .from("sales_order")
        .select("id, so_number, so_date, customer_id, company_id, status")
        .in("status", ["CREATED", "ISSUED"])
        .order("created_at", { ascending: false })
        .limit(100);
      if (companyId) query = query.eq("company_id", companyId);
      const { data, error } = await query;
      if (error) return doErrorResponse(req, ctx, "DO_SOURCE_LIST_FAILED", 500, "Unable to list source sales orders.");

      const rows = (data ?? []) as JsonRecord[];
      const customerIds = [...new Set(rows.map((row) => toTrimmedString(row.customer_id)).filter(Boolean))];
      const { data: customers } = customerIds.length
        ? await serviceRoleClient.schema("erp_master").from("customer_master").select("id, customer_code, customer_name").in("id", customerIds)
        : { data: [] as JsonRecord[] };
      const customerMap = new Map(((customers ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));

      return okResponse({
        items: rows.map((row) => ({
          id: row.id,
          document_number: row.so_number,
          document_date: row.so_date,
          counterparty_display: (() => {
            const customer = customerMap.get(toTrimmedString(row.customer_id));
            return customer ? `${customer.customer_code ?? ""} — ${customer.customer_name ?? ""}`.trim() : null;
          })(),
        })),
      }, ctx.request_id, req);
    }

    // STO
    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .select("id, sto_number, sto_date, receiving_company_id, sending_company_id, status")
      .in("status", ["CREATED", "DISPATCHED"])
      .order("created_at", { ascending: false })
      .limit(100);
    if (companyId) query = query.eq("sending_company_id", companyId);
    const { data, error } = await query;
    if (error) return doErrorResponse(req, ctx, "DO_SOURCE_LIST_FAILED", 500, "Unable to list source STOs.");

    const rows = (data ?? []) as JsonRecord[];
    const companyIds = [...new Set(rows.map((row) => toTrimmedString(row.receiving_company_id)).filter(Boolean))];
    const { data: companies } = companyIds.length
      ? await serviceRoleClient.schema("erp_master").from("companies").select("id, company_name, company_code").in("id", companyIds)
      : { data: [] as JsonRecord[] };
    const companyMap = new Map(((companies ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));

    return okResponse({
      items: rows.map((row) => ({
        id: row.id,
        document_number: row.sto_number,
        document_date: row.sto_date,
        counterparty_display: (() => {
          const company = companyMap.get(toTrimmedString(row.receiving_company_id));
          return company ? String(company.company_name ?? company.company_code ?? "") : null;
        })(),
      })),
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_SOURCE_LIST_FAILED";
    return doErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, code);
  }
}

// §113.5 — lines already referenced by a delivery_challan_line are locked;
// only truly-open lines are offered in the DO line picker.
async function fetchLockedLineIds(column: "so_line_id" | "sto_line_id", lineIds: string[]): Promise<Set<string>> {
  if (lineIds.length === 0) return new Set();
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("delivery_challan_line")
    .select(column)
    .in(column, lineIds);
  if (error) throw new Error("DO_LOCK_LOOKUP_FAILED");
  return new Set(((data ?? []) as JsonRecord[]).map((row) => toTrimmedString(row[column])).filter(Boolean));
}

export async function listDOSourceLinesHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const sourceType = toUpperTrimmedString(url.searchParams.get("source_type"));
    const sourceId = toTrimmedString(url.searchParams.get("source_id"));
    if (!DO_SOURCE_TYPES.has(sourceType) || !sourceId) {
      return doErrorResponse(req, ctx, "DO_SOURCE_INVALID", 400, "source_type and source_id are required.");
    }

    if (sourceType === "SALES_ORDER") {
      const { data, error } = await serviceRoleClient
        .schema("erp_procurement")
        .from("sales_order_line")
        .select("id, material_id, quantity, balance_qty, uom_code, line_status")
        .eq("so_id", sourceId)
        .order("line_number", { ascending: true });
      if (error) return doErrorResponse(req, ctx, "DO_SOURCE_LINES_FAILED", 500, "Unable to list SO lines.");
      const rows = (data ?? []) as JsonRecord[];
      const locked = await fetchLockedLineIds("so_line_id", rows.map((row) => String(row.id)));
      const open = rows.filter((row) => !locked.has(String(row.id)) && !["KNOCKED_OFF", "CANCELLED"].includes(toUpperTrimmedString(row.line_status)) && (parsePositiveNumber(row.balance_qty) ?? 0) > 0);
      return okResponse({ items: await attachMaterialDisplay(open) }, ctx.request_id, req);
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order_line")
      .select("id, material_id, quantity, balance_qty, uom_code, line_status")
      .eq("sto_id", sourceId)
      .order("line_number", { ascending: true });
    if (error) return doErrorResponse(req, ctx, "DO_SOURCE_LINES_FAILED", 500, "Unable to list STO lines.");
    const rows = (data ?? []) as JsonRecord[];
    const locked = await fetchLockedLineIds("sto_line_id", rows.map((row) => String(row.id)));
    const open = rows.filter((row) => !locked.has(String(row.id)) && toUpperTrimmedString(row.line_status) !== "KNOCKED_OFF" && (parsePositiveNumber(row.balance_qty) ?? 0) > 0);
    return okResponse({ items: await attachMaterialDisplay(open) }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_SOURCE_LINES_FAILED";
    return doErrorResponse(req, ctx, code, 500, code);
  }
}

async function attachMaterialDisplay(rows: JsonRecord[]): Promise<JsonRecord[]> {
  const materialIds = [...new Set(rows.map((row) => toTrimmedString(row.material_id)).filter(Boolean))];
  const { data } = materialIds.length
    ? await serviceRoleClient.schema("erp_master").from("material_master").select("id, pace_code, material_name").in("id", materialIds)
    : { data: [] as JsonRecord[] };
  const map = new Map(((data ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
  return rows.map((row) => {
    const material = map.get(toTrimmedString(row.material_id));
    return { ...row, material_display: material ? `${material.pace_code ?? ""} ${material.material_name ?? ""}`.trim() : null };
  });
}

// Storage locations that actually carry stock for this material — never a
// free-text field (§113.10 bug list item 8/9's lesson applied here too).
export async function listDOStorageLocationOptionsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const materialId = toTrimmedString(url.searchParams.get("material_id"));
    if (!companyId || !materialId) {
      return doErrorResponse(req, ctx, "DO_LOCATION_FILTERS_REQUIRED", 400, "company_id and material_id are required.");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_inventory")
      .from("stock_snapshot")
      .select("storage_location_id, quantity")
      .eq("company_id", companyId)
      .eq("material_id", materialId)
      .eq("stock_type_code", "UNRESTRICTED")
      .is("batch_id", null)
      .gt("quantity", 0);
    if (error) return doErrorResponse(req, ctx, "DO_LOCATION_LOOKUP_FAILED", 500, "Unable to look up storage locations.");

    const rows = (data ?? []) as JsonRecord[];
    const locationIds = [...new Set(rows.map((row) => toTrimmedString(row.storage_location_id)).filter(Boolean))];
    const { data: locations } = locationIds.length
      ? await serviceRoleClient.schema("erp_inventory").from("storage_location_master").select("id, location_code, location_name").in("id", locationIds)
      : { data: [] as JsonRecord[] };
    const locationMap = new Map(((locations ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));

    return okResponse({
      items: rows.map((row) => {
        const location = locationMap.get(toTrimmedString(row.storage_location_id));
        return {
          storage_location_id: row.storage_location_id,
          location_display: location ? `${location.location_code ?? ""} — ${location.location_name ?? ""}`.trim() : null,
          on_hand_qty: row.quantity,
        };
      }),
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_LOCATION_LOOKUP_FAILED";
    return doErrorResponse(req, ctx, code, 500, code);
  }
}

async function getAvailableQty(companyId: string, storageLocationId: string, materialId: string): Promise<number> {
  const [snapshotResp, reservationResp] = await Promise.all([
    serviceRoleClient
      .schema("erp_inventory")
      .from("stock_snapshot")
      .select("quantity")
      .eq("company_id", companyId)
      .eq("storage_location_id", storageLocationId)
      .eq("material_id", materialId)
      .eq("stock_type_code", "UNRESTRICTED")
      .is("batch_id", null)
      .maybeSingle(),
    serviceRoleClient
      .schema("erp_production")
      .from("reservation_document")
      .select("balance_qty")
      .eq("company_id", companyId)
      .eq("storage_location_id", storageLocationId)
      .eq("material_id", materialId)
      .in("status", RESERVATION_OPEN_STATUSES),
  ]);
  if (snapshotResp.error || reservationResp.error) throw new Error("DO_AVAILABILITY_CHECK_FAILED");
  const onHand = Number(snapshotResp.data?.quantity ?? 0);
  const reserved = ((reservationResp.data ?? []) as JsonRecord[]).reduce((sum, row) => sum + Number(row.balance_qty ?? 0), 0);
  return Number((onHand - reserved).toFixed(6));
}

// §113 CSN sync — mirrors gate_entry.handlers.ts's upsertCsnArrival() on the
// receiving side. Only STO-sourced lines can be CSN-linked (CSN tracks
// vendor/inter-plant inbound, never SO/customer sales). Business judgment on
// any remainder (new balance CSN vs knock-off) stays manual in CSN Tracker
// (§ design lock) — this only captures the accurate dispatched qty.
async function upsertCsnDispatch(stoId: string, materialId: string, dispatchQty: number, actionedBy: string): Promise<void> {
  const { data: csn, error: csnError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .select("id, status, total_dispatch_qty")
    .eq("sto_id", stoId)
    .eq("material_id", materialId)
    .in("status", ["ORD", "TRN", "GED"])
    .maybeSingle();
  if (csnError) throw new Error("DO_CSN_LOOKUP_FAILED");
  if (!csn) return; // Not every STO line is CSN-linked — nothing to sync.

  const currentStatus = toUpperTrimmedString(csn.status);
  const nextStatus = currentStatus === "ORD" ? "TRN" : currentStatus;
  const totalDispatchQty = Number(csn.total_dispatch_qty ?? 0);

  const { error: updateError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .update({
      status: nextStatus,
      dispatch_qty: dispatchQty,
      total_dispatch_qty: Number((totalDispatchQty + dispatchQty).toFixed(6)),
      last_updated_at: new Date().toISOString(),
      last_updated_by: actionedBy,
    })
    .eq("id", String(csn.id));
  if (updateError) throw new Error("DO_CSN_DISPATCH_SYNC_FAILED");
}

export async function createDeliveryOrderHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const sourceType = toUpperTrimmedString(body.source_type);
    const sourceId = toTrimmedString(body.source_id);
    const costCenterId = toTrimmedString(body.cost_center_id);
    const lines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];

    if (!DO_SOURCE_TYPES.has(sourceType) || !sourceId || !costCenterId || lines.length === 0) {
      return doErrorResponse(req, ctx, "DO_CREATE_INVALID", 400, "source_type, source_id, cost_center_id, and at least one line are required.");
    }

    const isSalesOrder = sourceType === "SALES_ORDER";
    const sourceTable = isSalesOrder ? "sales_order" : "stock_transfer_order";
    const { data: source, error: sourceError } = await serviceRoleClient
      .schema("erp_procurement")
      .from(sourceTable)
      .select("*")
      .eq("id", sourceId)
      .single();
    if (sourceError || !source) {
      return doErrorResponse(req, ctx, "DO_SOURCE_NOT_FOUND", 404, "Source document not found.");
    }

    const companyId = isSalesOrder ? toTrimmedString(source.company_id) : toTrimmedString(source.sending_company_id);
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const lineIdColumn = isSalesOrder ? "so_line_id" : "sto_line_id";
    const sourceLineTable = isSalesOrder ? "sales_order_line" : "stock_transfer_order_line";
    const lineIds = lines.map((line) => toTrimmedString(line.source_line_id)).filter(Boolean);
    const locked = await fetchLockedLineIds(lineIdColumn as "so_line_id" | "sto_line_id", lineIds);

    const { data: sourceLines, error: sourceLinesError } = await serviceRoleClient
      .schema("erp_procurement")
      .from(sourceLineTable)
      .select("*")
      .in("id", lineIds);
    if (sourceLinesError) {
      return doErrorResponse(req, ctx, "DO_SOURCE_LINE_FETCH_FAILED", 500, "Unable to load source lines.");
    }
    const sourceLineMap = new Map(((sourceLines ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));

    const preparedLines: Array<{ sourceLine: JsonRecord; quantity: number; storageLocationId: string }> = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const sourceLineId = toTrimmedString(line.source_line_id);
      const quantity = parsePositiveNumber(line.quantity);
      const storageLocationId = toTrimmedString(line.storage_location_id);

      if (!sourceLineId || !quantity || !storageLocationId) {
        return doErrorResponse(req, ctx, "DO_LINE_INVALID", 400, `source_line_id, quantity, and storage_location_id are required for line ${index + 1}.`);
      }
      if (locked.has(sourceLineId)) {
        return doErrorResponse(req, ctx, "DO_LINE_LOCKED", 409, `Line ${index + 1} is already locked by another DO.`);
      }
      const sourceLine = sourceLineMap.get(sourceLineId);
      if (!sourceLine) {
        return doErrorResponse(req, ctx, "DO_SOURCE_LINE_NOT_FOUND", 404, `Source line ${sourceLineId} not found.`);
      }
      const balanceQty = parsePositiveNumber(sourceLine.balance_qty) ?? 0;
      if (quantity > balanceQty) {
        return doErrorResponse(req, ctx, "DO_QTY_EXCEEDS_BALANCE", 400, `Quantity exceeds the source line's balance for line ${index + 1}.`);
      }

      const available = await getAvailableQty(companyId, storageLocationId, String(sourceLine.material_id));
      if (quantity > available) {
        return doErrorResponse(req, ctx, "INSUFFICIENT_STOCK", 400, `Only ${available} available (after existing reservations) for line ${index + 1}.`);
      }

      preparedLines.push({ sourceLine, quantity, storageLocationId });
    }

    const dcNumber = await generateProcurementDocNumber("DC");
    const { data: dc, error: dcError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("delivery_challan")
      .insert({
        dc_number: dcNumber,
        dc_date: todayIsoDate(),
        dc_type: isSalesOrder ? "SALES" : "STO",
        selling_company_id: companyId,
        receiving_company_id: isSalesOrder ? null : toTrimmedString(source.receiving_company_id),
        customer_id: isSalesOrder ? toTrimmedString(source.customer_id) : null,
        sto_id: isSalesOrder ? null : sourceId,
        sales_order_id: isSalesOrder ? sourceId : null,
        cost_center_id: costCenterId,
        delivery_address: toTrimmedString(body.delivery_address) || null,
        transporter_id: toTrimmedString(body.transporter_id) || null,
        transporter_name_freetext: toTrimmedString(body.transporter_name_freetext) || null,
        vehicle_number: toTrimmedString(body.vehicle_number) || null,
        lr_number: toTrimmedString(body.lr_number) || null,
        driver_name: toTrimmedString(body.driver_name) || null,
        status: "CREATED",
        remarks: toTrimmedString(body.remarks) || null,
      })
      .select("*")
      .single();
    if (dcError || !dc) {
      return doErrorResponse(req, ctx, "DO_CREATE_FAILED", 500, "Unable to create delivery order.");
    }

    const nowIso = new Date().toISOString();
    // DEPENDENT: each line's reservation_document insert and the source-line
    // lock it produces must land before the next iteration's availability
    // check (getAvailableQty already ran pre-loop above using pre-DO state,
    // so within-this-request double-booking across lines sharing the same
    // material+location is still possible without doing this sequentially).
    for (let index = 0; index < preparedLines.length; index += 1) {
      const { sourceLine, quantity, storageLocationId } = preparedLines[index];

      const { error: dcLineError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("delivery_challan_line")
        .insert({
          dc_id: dc.id,
          line_number: index + 1,
          material_id: sourceLine.material_id,
          so_line_id: isSalesOrder ? sourceLine.id : null,
          sto_line_id: isSalesOrder ? null : sourceLine.id,
          quantity,
          uom_code: sourceLine.uom_code,
          unit_value: isSalesOrder ? sourceLine.net_rate : sourceLine.transfer_price,
          line_total: Number((quantity * Number(isSalesOrder ? sourceLine.net_rate : sourceLine.transfer_price ?? 0)).toFixed(4)),
          storage_location_id: storageLocationId,
        });
      if (dcLineError) {
        return doErrorResponse(req, ctx, "DO_LINE_CREATE_FAILED", 500, "Unable to create delivery order line.");
      }

      const { error: reservationError } = await serviceRoleClient
        .schema("erp_production")
        .from("reservation_document")
        .insert({
          source_type: sourceType,
          source_id: sourceId,
          source_line_id: sourceLine.id,
          company_id: companyId,
          material_id: sourceLine.material_id,
          storage_location_id: storageLocationId,
          required_qty: quantity,
          uom_code: sourceLine.uom_code,
          issued_qty: 0,
          status: "OPEN",
          created_by: ctx.auth_user_id,
          created_at: nowIso,
          last_updated_by: ctx.auth_user_id,
          last_updated_at: nowIso,
        });
      if (reservationError) {
        return doErrorResponse(req, ctx, "DO_RESERVATION_CREATE_FAILED", 500, "Unable to reserve stock for delivery order line.");
      }

      if (!isSalesOrder) {
        await upsertCsnDispatch(sourceId, String(sourceLine.material_id), quantity, ctx.auth_user_id);
      }
    }

    return okResponse(await hydrateDeliveryOrder(String(dc.id)), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_CREATE_FAILED";
    const status = code === "DO_SOURCE_NOT_FOUND" ? 404
      : code === "COMPANY_SCOPE_VIOLATION" ? 403
      : code === "DO_LINE_LOCKED" ? 409
      : ["DO_QTY_EXCEEDS_BALANCE", "INSUFFICIENT_STOCK", "DO_CREATE_INVALID", "DO_LINE_INVALID"].includes(code) ? 400
      : 500;
    return doErrorResponse(req, ctx, code, status, code);
  }
}

async function hydrateDeliveryOrder(dcId: string): Promise<JsonRecord> {
  const { data: dc, error: dcError } = await serviceRoleClient.schema("erp_procurement").from("delivery_challan").select("*").eq("id", dcId).single();
  if (dcError || !dc) throw new Error("DO_NOT_FOUND");
  const { data: lines, error: linesError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("delivery_challan_line")
    .select("*")
    .eq("dc_id", dcId)
    .order("line_number", { ascending: true });
  if (linesError) throw new Error("DO_LINE_FETCH_FAILED");
  return { ...dc, lines: lines ?? [] };
}

export async function getDeliveryOrderHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const dcId = getIdFromPath(req);
    if (!dcId) return doErrorResponse(req, ctx, "DO_ID_REQUIRED", 400, "Delivery order id is required.");
    return okResponse(await hydrateDeliveryOrder(dcId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_FETCH_FAILED";
    return doErrorResponse(req, ctx, code, code === "DO_NOT_FOUND" ? 404 : 500, code);
  }
}

export async function listDeliveryOrdersHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const status = toTrimmedString(url.searchParams.get("status")).toUpperCase();
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
    const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

    if (companyId) {
      try {
        await assertCompanyScope(ctx, companyId);
      } catch {
        return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
      }
    }

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("delivery_challan")
      .select("*", { count: "exact" })
      .in("dc_type", ["SALES", "STO"])
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (companyId) query = query.eq("selling_company_id", companyId);
    if (status) query = query.eq("status", status);

    const { data, error, count } = await query;
    if (error) return doErrorResponse(req, ctx, "DO_LIST_FAILED", 500, "Unable to list delivery orders.");

    const rows = (data ?? []) as JsonRecord[];
    const customerIds = [...new Set(rows.map((row) => toTrimmedString(row.customer_id)).filter(Boolean))];
    const { data: customers } = customerIds.length
      ? await serviceRoleClient.schema("erp_master").from("customer_master").select("id, customer_code, customer_name").in("id", customerIds)
      : { data: [] as JsonRecord[] };
    const customerMap = new Map(((customers ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));

    const items = rows.map((row) => {
      const customer = customerMap.get(toTrimmedString(row.customer_id));
      return {
        ...row,
        source_display: row.sales_order_id ? "SALES_ORDER" : row.sto_id ? "STO" : null,
        customer_display: customer ? `${customer.customer_code ?? ""} — ${customer.customer_name ?? ""}`.trim() : null,
      };
    });

    return okResponse({ items, total: count ?? items.length }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_LIST_FAILED";
    return doErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, code);
  }
}
