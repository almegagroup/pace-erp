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
import { todayIsoInKolkata } from "../../_shared/dateUtils.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { generateMaterialDocNumber } from "../../_shared/materialDocument.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import {
  computeLineValues,
  deriveSalesInvoiceGstType,
  getSnapshotForIssue,
  hasPhysicalInventoryBlock,
  type PackagingCostInput,
} from "./sales_order.handlers.ts";

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
  return todayIsoInKolkata();
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
    const search = toTrimmedString(url.searchParams.get("search"));
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
      // §113 picker's flat .limit(100)/created_at-desc had no search — an
      // older-but-still-open SO simply vanished once 100+ others were
      // touched more recently (found live 2026-09-03: SO 9000000006, ranked
      // #143 by created_at, never appeared no matter how the drawer was
      // scrolled). A blank search still returns the 100 most recent (same
      // as before); a real search filters server-side by so_number/PO
      // number first, so an old-but-open SO is reachable by typing it in.
      let query = serviceRoleClient
        .schema("erp_procurement")
        .from("sales_order")
        .select("id, so_number, so_date, customer_id, customer_po_number, company_id, status")
        .in("status", ["CREATED", "ISSUED"])
        .order("created_at", { ascending: false })
        .limit(100);
      if (companyId) query = query.eq("company_id", companyId);
      if (search) query = query.or(`so_number.ilike.%${search}%,customer_po_number.ilike.%${search}%`);
      const { data, error } = await query;
      if (error) return doErrorResponse(req, ctx, "DO_SOURCE_LIST_FAILED", 500, "Unable to list source sales orders.");

      // Real gap fixed (2026-09-01, business owner) — this handler's own
      // docstring always said "still have at least one unlocked line", but
      // the actual query only ever filtered by status. A SO whose every
      // line is already fully drawn into non-cancelled DOs stays status
      // CREATED/ISSUED (only an explicit SO Close, §133.10, moves it to
      // CLOSED) -- so it kept showing up here with nothing left to add,
      // wasting a click. Every dc_line carries so_line_id regardless of
      // source path (direct or via so_map_allocation_id -- see
      // do_unified.handlers.ts's soLineId derivation), so a single
      // so_line_id-keyed drawn-qty check covers every dispatch type.
      const soRows = (data ?? []) as JsonRecord[];
      const { data: candidateLines, error: linesError } = soRows.length
        ? await serviceRoleClient.schema("erp_procurement").from("sales_order_line")
            .select("id, so_id, base_qty, quantity").in("so_id", soRows.map((row) => String(row.id)))
        : { data: [] as JsonRecord[], error: null };
      if (linesError) return doErrorResponse(req, ctx, "DO_SOURCE_LIST_FAILED", 500, "Unable to list source sales orders.");
      const lineRows = (candidateLines ?? []) as JsonRecord[];
      const lineIds = lineRows.map((row) => String(row.id));
      const drawnByLine = new Map<string, number>();
      if (lineIds.length) {
        const drawnRows = await fetchInChunks<JsonRecord>(lineIds, (chunk) =>
          serviceRoleClient.schema("erp_procurement").from("delivery_challan_line")
            .select("so_line_id, quantity, delivery_challan!inner(status)")
            .in("so_line_id", chunk).neq("delivery_challan.status", "CANCELLED"));
        for (const row of drawnRows) {
          const key = toTrimmedString(row.so_line_id);
          if (!key) continue;
          drawnByLine.set(key, (drawnByLine.get(key) ?? 0) + Number(row.quantity ?? 0));
        }
      }
      const soHasRemaining = new Set<string>();
      for (const line of lineRows) {
        const total = Number(line.base_qty ?? line.quantity ?? 0);
        const drawn = drawnByLine.get(String(line.id)) ?? 0;
        if (total - drawn > 0.0001) soHasRemaining.add(toTrimmedString(line.so_id));
      }
      const rows = soRows.filter((row) => soHasRemaining.has(toTrimmedString(row.id)));

      const customerIds = [...new Set(rows.map((row) => toTrimmedString(row.customer_id)).filter(Boolean))];
      const { data: customers } = customerIds.length
        ? await serviceRoleClient.schema("erp_master").from("customer_master").select("id, customer_code, customer_name").in("id", customerIds)
        : { data: [] as JsonRecord[] };
      const customerMap = new Map(((customers ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));

      return okResponse({
        items: rows.map((row) => {
          const customer = customerMap.get(toTrimmedString(row.customer_id));
          return {
            id: row.id,
            document_number: row.so_number,
            document_date: row.so_date,
            status: row.status,
            reference_display: row.customer_po_number ? `Customer PO ${row.customer_po_number}` : null,
            counterparty_display: customer ? `${customer.customer_code ?? ""} — ${customer.customer_name ?? ""}`.trim() : null,
          };
        }),
      }, ctx.request_id, req);
    }

    // STO — §113.10 fix: bare receiving-company name gave almost no context
    // to pick from (no sending company, no type, no status).
    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .select("id, sto_number, sto_date, receiving_company_id, sending_company_id, sto_type, status")
      .in("status", ["CREATED", "DISPATCHED"])
      .order("created_at", { ascending: false })
      .limit(100);
    if (companyId) query = query.eq("sending_company_id", companyId);
    if (search) query = query.ilike("sto_number", `%${search}%`);
    const { data, error } = await query;
    if (error) return doErrorResponse(req, ctx, "DO_SOURCE_LIST_FAILED", 500, "Unable to list source STOs.");

    const rows = (data ?? []) as JsonRecord[];
    const companyIds = [...new Set([
      ...rows.map((row) => toTrimmedString(row.sending_company_id)),
      ...rows.map((row) => toTrimmedString(row.receiving_company_id)),
    ].filter(Boolean))];
    const { data: companies } = companyIds.length
      ? await serviceRoleClient.schema("erp_master").from("companies").select("id, company_name, company_code").in("id", companyIds)
      : { data: [] as JsonRecord[] };
    const companyMap = new Map(((companies ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));

    return okResponse({
      items: rows.map((row) => {
        const sending = companyMap.get(toTrimmedString(row.sending_company_id));
        const receiving = companyMap.get(toTrimmedString(row.receiving_company_id));
        return {
          id: row.id,
          document_number: row.sto_number,
          document_date: row.sto_date,
          status: row.status,
          reference_display: row.sto_type,
          counterparty_display: [
            sending ? `From ${sending.company_code ?? sending.company_name}` : null,
            receiving ? `To ${receiving.company_code ?? receiving.company_name}` : null,
          ].filter(Boolean).join(" — ") || null,
        };
      }),
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_SOURCE_LIST_FAILED";
    return doErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, code);
  }
}

// §113.5 — lines already referenced by a delivery_challan_line are locked;
// only truly-open lines are offered in the DO line picker.
// A line stays locked only while the DO referencing it is still live --
// cancelling a DO (delivery_challan.status = CANCELLED) must free its
// source line back up for a new DO, so a CANCELLED parent is excluded here
// rather than only checking delivery_challan_line's own existence.
async function fetchLockedLineIds(column: "so_line_id" | "sto_line_id", lineIds: string[]): Promise<Set<string>> {
  if (lineIds.length === 0) return new Set();
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("delivery_challan_line")
    .select(`${column}, delivery_challan!inner(status)`)
    .in(column, lineIds)
    .neq("delivery_challan.status", "CANCELLED");
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
    // storage_location_master's real columns are "code"/"name" — the
    // earlier "location_code"/"location_name" query silently failed
    // (error was never checked) and left every option blank.
    const { data: locations, error: locationError } = locationIds.length
      ? await serviceRoleClient.schema("erp_inventory").from("storage_location_master").select("id, code, name").in("id", locationIds)
      : { data: [] as JsonRecord[], error: null };
    if (locationError) return doErrorResponse(req, ctx, "DO_LOCATION_LOOKUP_FAILED", 500, "Unable to resolve storage location names.");
    const locationMap = new Map(((locations ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));

    return okResponse({
      items: rows.map((row) => {
        const location = locationMap.get(toTrimmedString(row.storage_location_id));
        return {
          storage_location_id: row.storage_location_id,
          location_display: location ? `${location.code ?? ""} — ${location.name ?? ""}`.trim() : null,
          on_hand_qty: row.quantity,
        };
      }),
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_LOCATION_LOOKUP_FAILED";
    return doErrorResponse(req, ctx, code, 500, code);
  }
}

// Exported so delivery_order_map.handlers.ts's §133.12 Page 2 consolidation
// preview can reuse the same Unrestricted-minus-open-reservation formula
// instead of duplicating it.
export async function getAvailableQty(companyId: string, storageLocationId: string, materialId: string): Promise<number> {
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

// §133.12 -- shared by cancelDeliveryOrderHandler and do_unified.handlers.ts's
// updateDeliveryOrderUnifiedHandler (Edit tears down its own old lines
// before re-validating a fresh set, exactly like a cancel would). Resolved
// PER LINE via sto_line_id -> its own sto_id, not a DO header's sto_id (a
// §133.12 multi-source/MIXED DO never populates that column) -- works
// identically for old and new-style DOs since every STO line still carries
// its own sto_line_id regardless of how many other sources the same DO also
// drew from. Throws Error(code) -- caller's own catch block maps it.
export async function undoCsnDispatchForLines(lineRows: JsonRecord[], actionedBy: string, nowIso: string): Promise<void> {
  const stoLineIds = [...new Set(lineRows.map((row) => toTrimmedString(row.sto_line_id)).filter(Boolean))];
  if (stoLineIds.length === 0) return;

  const { data: stoLineRows, error: stoLineLookupError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("stock_transfer_order_line")
    .select("id, sto_id")
    .in("id", stoLineIds);
  if (stoLineLookupError) throw new Error("DO_STO_LINE_LOOKUP_FAILED");
  const stoIdByLineId = new Map(((stoLineRows ?? []) as JsonRecord[]).map((row) => [String(row.id), toTrimmedString(row.sto_id)]));

  for (const row of lineRows) {
    const stoLineId = toTrimmedString(row.sto_line_id);
    if (!stoLineId) continue;
    const stoId = stoIdByLineId.get(stoLineId);
    const materialId = toTrimmedString(row.material_id);
    const quantity = Number(row.quantity ?? 0);
    if (!stoId || !materialId || quantity <= 0) continue;
    const { data: csn, error: csnError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select("id, total_dispatch_qty")
      .eq("sto_id", stoId)
      .eq("material_id", materialId)
      .in("status", ["ORD", "TRN", "GED"])
      .maybeSingle();
    if (csnError) throw new Error("DO_CSN_LOOKUP_FAILED");
    if (!csn) continue;
    const nextTotal = Math.max(0, Number(csn.total_dispatch_qty ?? 0) - quantity);
    const { error: csnUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .update({ total_dispatch_qty: Number(nextTotal.toFixed(6)), last_updated_by: actionedBy, last_updated_at: nowIso })
      .eq("id", String(csn.id));
    if (csnUpdateError) throw new Error("DO_CSN_DISPATCH_UNDO_FAILED");
  }
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

    // §113.13 — DO carries a full commercial snapshot (rate/GST/packaging
    // cost/rebate) copied from the source line, recomputed at the DO's own
    // (possibly partial-dispatch) quantity rather than copying the source
    // line's full-quantity totals verbatim. Safe to do once, at create time,
    // because a line with a DO against it freezes (§113.5) -- the source
    // commercial fields can't change out from under this snapshot afterward.
    // STO has no packaging-cost mechanism (§113.9 was SO-only), so it always
    // computes with an empty PackagingCostInput.
    const commercialByLine = preparedLines.map(({ sourceLine, quantity }) => {
      const rate = Number((isSalesOrder ? sourceLine.net_rate : sourceLine.transfer_price) ?? 0);
      const packaging: PackagingCostInput = isSalesOrder
        ? {
            basis: (sourceLine.packaging_cost_basis as string | null) ?? null,
            rate: sourceLine.packaging_cost_rate != null ? Number(sourceLine.packaging_cost_rate) : null,
            gstTreatment: (sourceLine.packaging_gst_treatment as string | null) ?? null,
            customGstRate: sourceLine.packaging_gst_rate != null ? Number(sourceLine.packaging_gst_rate) : null,
          }
        : { basis: null, rate: null, gstTreatment: null, customGstRate: null };
      return computeLineValues({
        rate,
        discountPct: isSalesOrder ? Number(sourceLine.discount_pct ?? 0) : 0,
        quantity,
        materialGstRate: sourceLine.gst_rate != null ? Number(sourceLine.gst_rate) : null,
        packaging,
      });
    });

    // Real gap caught live 2026-07-30: total_value was never written anywhere
    // in this handler, so DOListPage always showed 0.00. Computed here (not
    // as a follow-up UPDATE) since every line's rate is already known before
    // the header insert -- one round trip, not two.
    const totalValue = Number(commercialByLine.reduce((sum, c) => sum + c.totalValue, 0).toFixed(4));

    // freight_term/payment_term_id are per-line on both sales_order_line and
    // stock_transfer_order_line (payment_term_id is header-level on SO,
    // per-line on STO) -- DO stores them once at header level, same
    // simplification already made for cost_center_id. Taken from the first
    // prepared line; a DO's lines all come from one source document, so in
    // practice these don't vary within a single DO.
    const firstSourceLine = preparedLines[0]?.sourceLine;
    const headerFreightTerm = toTrimmedString(firstSourceLine?.freight_term) || null;
    const headerPaymentTermId = isSalesOrder
      ? toTrimmedString(source.payment_term_id) || null
      : toTrimmedString(firstSourceLine?.payment_term_id) || null;

    // DOCreatePage.jsx never collects delivery_address (no such field on the
    // form), so body.delivery_address is always absent -- auto-resolve it
    // instead: SO already carries its own delivery_address (typed at SO
    // create); STO has no such concept, so it falls back to the receiving
    // company's own address from Company Master (§113 bug report, 2026-07-31
    // -- was landing as blank for every STO-sourced DO).
    let resolvedDeliveryAddress = toTrimmedString(body.delivery_address) || null;
    if (!resolvedDeliveryAddress) {
      if (isSalesOrder) {
        resolvedDeliveryAddress = toTrimmedString(source.delivery_address) || null;
      } else {
        const receivingCompanyId = toTrimmedString(source.receiving_company_id);
        if (receivingCompanyId) {
          const { data: receivingCompany, error: receivingCompanyError } = await serviceRoleClient
            .schema("erp_master")
            .from("companies")
            .select("full_address")
            .eq("id", receivingCompanyId)
            .maybeSingle();
          if (receivingCompanyError) {
            return doErrorResponse(req, ctx, "DO_RECEIVING_COMPANY_LOOKUP_FAILED", 500, "Unable to load the receiving company's address.");
          }
          resolvedDeliveryAddress = toTrimmedString(receivingCompany?.full_address) || null;
        }
      }
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
        freight_term: headerFreightTerm,
        payment_term_id: headerPaymentTermId,
        delivery_address: resolvedDeliveryAddress,
        // §113.16 -- Ship-To snapshot, frozen at DO-create time (same
        // pattern as the §113.13 commercial snapshot). SO-only: STO's
        // ship-to is inherently the receiving company, already correctly
        // resolved from erp_master.companies at PGI time, no snapshot needed.
        ship_to_state: isSalesOrder ? (toTrimmedString(source.ship_to_state) || null) : null,
        ship_to_name: isSalesOrder ? (toTrimmedString(source.ship_to_name) || null) : null,
        ship_to_address: isSalesOrder ? (toTrimmedString(source.ship_to_address) || null) : null,
        ship_to_gst_number: isSalesOrder ? (toTrimmedString(source.ship_to_gst_number) || null) : null,
        transporter_id: toTrimmedString(body.transporter_id) || null,
        transporter_name_freetext: toTrimmedString(body.transporter_name_freetext) || null,
        vehicle_number: toTrimmedString(body.vehicle_number) || null,
        lr_number: toTrimmedString(body.lr_number) || null,
        driver_name: toTrimmedString(body.driver_name) || null,
        status: "CREATED",
        total_value: totalValue,
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
      const commercial = commercialByLine[index];

      const { data: dcLine, error: dcLineError } = await serviceRoleClient
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
          line_total: commercial.totalValue,
          storage_location_id: storageLocationId,
          gst_rate: sourceLine.gst_rate != null ? Number(sourceLine.gst_rate) : null,
          gst_amount: commercial.gstAmount,
          packaging_cost_basis: isSalesOrder ? (sourceLine.packaging_cost_basis as string | null) ?? null : null,
          packaging_cost_rate: isSalesOrder && sourceLine.packaging_cost_rate != null ? Number(sourceLine.packaging_cost_rate) : null,
          packaging_cost_amount: commercial.packagingCostAmount,
          packaging_gst_treatment: isSalesOrder ? (sourceLine.packaging_gst_treatment as string | null) ?? null : null,
          packaging_gst_rate: isSalesOrder && sourceLine.packaging_gst_rate != null ? Number(sourceLine.packaging_gst_rate) : null,
          has_rebate: sourceLine.has_rebate === true,
          rebate_rate: sourceLine.has_rebate === true && sourceLine.rebate_rate != null ? Number(sourceLine.rebate_rate) : null,
          rebate_rate_uom_basis: sourceLine.has_rebate === true ? (sourceLine.rebate_rate_uom_basis as string | null) ?? null : null,
          rebate_remarks: sourceLine.has_rebate === true ? (sourceLine.rebate_remarks as string | null) ?? null : null,
        })
        .select("id")
        .single();
      if (dcLineError || !dcLine) {
        return doErrorResponse(req, ctx, "DO_LINE_CREATE_FAILED", 500, "Unable to create delivery order line.");
      }

      const { error: reservationError } = await serviceRoleClient
        .schema("erp_production")
        .from("reservation_document")
        .insert({
          dc_line_id: dcLine.id,
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

// §113.15 -- pre-PGI DO reversal, deliberately a SEPARATE handler/route/ACL
// action from createDeliveryOrderHandler (business owner requirement: cancel
// authority must be grantable to a different role than create authority,
// later, without touching this handler). Whole-DO only, not per-line --
// matches PO/STO's own whole-document cancel shape. Only valid pre-PGI
// (status CREATED); once DISPATCHED, the reverse path is Invoice reversal
// instead (reverseSalesInvoiceHandler), which also unwinds the DO.
export async function cancelDeliveryOrderHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const dcId = getIdFromPath(req);
    if (!dcId) return doErrorResponse(req, ctx, "DO_ID_REQUIRED", 400, "Delivery order id is required.");
    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason);
    if (!reason) return doErrorResponse(req, ctx, "DO_CANCEL_REASON_REQUIRED", 400, "Cancellation reason is required.");

    const { data: dc, error: dcError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("delivery_challan")
      .select("*")
      .eq("id", dcId)
      .single();
    if (dcError || !dc) return doErrorResponse(req, ctx, "DO_NOT_FOUND", 404, "Delivery order not found.");
    try {
      await assertCompanyScope(ctx, toTrimmedString(dc.selling_company_id));
    } catch {
      return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (toUpperTrimmedString(dc.status) !== "CREATED") {
      return doErrorResponse(req, ctx, "DO_CANCEL_BLOCKED", 400, "Only a DO that has not yet been PGI'd/invoiced can be cancelled directly -- reverse the Invoice instead.");
    }

    const { data: dcLines, error: dcLinesError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("delivery_challan_line")
      .select("id, so_line_id, sto_line_id, material_id, quantity")
      .eq("dc_id", dcId);
    if (dcLinesError) return doErrorResponse(req, ctx, "DO_LINE_FETCH_FAILED", 500, "Unable to load delivery order lines.");
    const lineRows = (dcLines ?? []) as JsonRecord[];

    const nowIso = new Date().toISOString();
    // Found live 2026-09-03 (business owner, CMP006 DO 9100000048): this used
    // to be two separate, non-transactional Supabase calls (delivery_challan
    // status update, then reservation_document release) -- if the second
    // ever failed after the first committed, the DO was left CANCELLED with
    // its reservation permanently stuck OPEN, silently blocking Available
    // for that material/location on the next DO. One RPC call now, same
    // §133.12 dc_line_id-first / source_line_id-fallback release logic,
    // both in one transaction (§8D).
    const { error: cancelRpcError } = await serviceRoleClient
      .schema("erp_procurement")
      .rpc("cancel_delivery_order_atomic", { p_dc_id: dcId, p_reason: reason, p_actor: ctx.auth_user_id });
    if (cancelRpcError) {
      const message = String(cancelRpcError.message ?? "");
      if (message.includes("DO_CANCEL_BLOCKED")) {
        return doErrorResponse(req, ctx, "DO_CANCEL_BLOCKED", 400, "Only a DO that has not yet been PGI'd/invoiced can be cancelled directly -- reverse the Invoice instead.");
      }
      return doErrorResponse(req, ctx, "DO_CANCEL_FAILED", 500, "Unable to cancel delivery order.");
    }

    await undoCsnDispatchForLines(lineRows, ctx.auth_user_id, nowIso);

    // Legacy hydrator -- fine for old single-source DOs; for a §133.12
    // multi-source DO this just shows blank customer/ship-to fields (no
    // crash, since sourceResp/customerResp are conditional on dc.sales_
    // order_id/dc.sto_id being set). The frontend re-fetches via the
    // unified GET (getDeliveryOrderUnifiedHandler) for the real detail view.
    return okResponse(await hydrateDeliveryOrder(dcId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_CANCEL_FAILED";
    const status = code === "DO_NOT_FOUND" ? 404 : code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") || code.includes("BLOCKED") ? 400 : 500;
    return doErrorResponse(req, ctx, code, status, code);
  }
}

// §8A R-00/R-03 — DO detail (and the invoice stage this feeds later) must
// never carry raw FK ids; every reference is bulk-resolved here in one
// round each, not per-row. This was a stub (`{...dc, lines}` verbatim) left
// over from the initial Task E build — caught live 2026-07-30 showing raw
// UUIDs for material/storage location and nothing at all for
// customer/company/source-document/transporter/cost-center.
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
  const lineRows = (lines ?? []) as JsonRecord[];

  const isSalesOrder = toUpperTrimmedString(dc.dc_type) === "SALES";
  const companyIds = [...new Set([dc.selling_company_id, dc.receiving_company_id].map((v) => toTrimmedString(v)).filter(Boolean))];
  const materialIds = [...new Set(lineRows.map((row) => toTrimmedString(row.material_id)).filter(Boolean))];
  const locationIds = [...new Set(lineRows.map((row) => toTrimmedString(row.storage_location_id)).filter(Boolean))];

  const [companiesResp, customerResp, sourceResp, transporterResp, costCenterResp, materialsResp, locationsResp, paymentTermResp, invoiceResp] = await Promise.all([
    companyIds.length
      ? serviceRoleClient.schema("erp_master").from("companies").select("id, company_code, company_name, state_name, full_address, gst_number").in("id", companyIds)
      : Promise.resolve({ data: [] as JsonRecord[], error: null }),
    dc.customer_id
      ? serviceRoleClient.schema("erp_master").from("customer_master").select("id, customer_code, customer_name, billing_state, billing_address, delivery_address, gst_number").eq("id", dc.customer_id).maybeSingle()
      : Promise.resolve({ data: null as JsonRecord | null, error: null }),
    isSalesOrder
      ? (dc.sales_order_id
          ? serviceRoleClient.schema("erp_procurement").from("sales_order").select("id, so_number, so_date, customer_po_number").eq("id", dc.sales_order_id).maybeSingle()
          : Promise.resolve({ data: null as JsonRecord | null, error: null }))
      : (dc.sto_id
          ? serviceRoleClient.schema("erp_procurement").from("stock_transfer_order").select("id, sto_number, sto_date, sto_type").eq("id", dc.sto_id).maybeSingle()
          : Promise.resolve({ data: null as JsonRecord | null, error: null })),
    dc.transporter_id
      ? serviceRoleClient.schema("erp_master").from("transporter_master").select("id, transporter_code, transporter_name").eq("id", dc.transporter_id).maybeSingle()
      : Promise.resolve({ data: null as JsonRecord | null, error: null }),
    dc.cost_center_id
      ? serviceRoleClient.schema("erp_master").from("cost_center_master").select("id, cost_center_code, cost_center_name").eq("id", dc.cost_center_id).maybeSingle()
      : Promise.resolve({ data: null as JsonRecord | null, error: null }),
    materialIds.length
      ? serviceRoleClient.schema("erp_master").from("material_master").select("id, pace_code, material_name").in("id", materialIds)
      : Promise.resolve({ data: [] as JsonRecord[], error: null }),
    locationIds.length
      ? serviceRoleClient.schema("erp_inventory").from("storage_location_master").select("id, code, name").in("id", locationIds)
      : Promise.resolve({ data: [] as JsonRecord[], error: null }),
    dc.payment_term_id
      ? serviceRoleClient.schema("erp_master").from("payment_terms_master").select("id, code, name").eq("id", dc.payment_term_id).maybeSingle()
      : Promise.resolve({ data: null as JsonRecord | null, error: null }),
    // §113.15 -- the DO detail page never showed the resulting invoice at
    // all (real gap flagged live 2026-07-31 after the first PGI test):
    // most recent invoice against this DO, any status, so a CANCELLED one
    // still shows for history even after the DO reopens to CREATED.
    serviceRoleClient
      .schema("erp_procurement")
      .from("sales_invoice")
      .select("id, invoice_number, invoice_date, status, tally_invoice_number, tally_invoice_date")
      .eq("dc_id", dcId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (companiesResp.error) throw new Error("DO_COMPANY_LOOKUP_FAILED");
  if (customerResp.error) throw new Error("DO_CUSTOMER_LOOKUP_FAILED");
  if (sourceResp.error) throw new Error("DO_SOURCE_LOOKUP_FAILED");
  if (transporterResp.error) throw new Error("DO_TRANSPORTER_LOOKUP_FAILED");
  if (costCenterResp.error) throw new Error("DO_COST_CENTER_LOOKUP_FAILED");
  if (materialsResp.error) throw new Error("DO_MATERIAL_LOOKUP_FAILED");
  if (locationsResp.error) throw new Error("DO_LOCATION_LOOKUP_FAILED");
  if (paymentTermResp.error) throw new Error("DO_PAYMENT_TERM_LOOKUP_FAILED");
  if (invoiceResp.error) throw new Error("DO_INVOICE_LOOKUP_FAILED");
  const invoice = invoiceResp.data as JsonRecord | null;

  const companyMap = new Map(((companiesResp.data ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
  const materialMap = new Map(((materialsResp.data ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
  const locationMap = new Map(((locationsResp.data ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
  const customer = customerResp.data as JsonRecord | null;
  const source = sourceResp.data as JsonRecord | null;
  const transporter = transporterResp.data as JsonRecord | null;
  const costCenter = costCenterResp.data as JsonRecord | null;
  const paymentTerm = paymentTermResp.data as JsonRecord | null;
  const sellingCompany = companyMap.get(toTrimmedString(dc.selling_company_id));
  const receivingCompany = companyMap.get(toTrimmedString(dc.receiving_company_id));
  // §113.16 -- same pair createPgiInvoiceHandler compares for GST type, shown
  // here purely as a preview so the PGI+Invoice form can display it before
  // submit (nothing here is authoritative -- the handler recomputes it
  // fresh). SO branch now reads the frozen dc.ship_to_state snapshot, same
  // as the real handler -- was customer.billing_state, which is the wrong
  // field for place-of-supply (§113.16).
  const counterpartyStateName = isSalesOrder
    ? (toTrimmedString(dc.ship_to_state) || null)
    : (toTrimmedString(receivingCompany?.state_name) || null);

  const hydratedLines = lineRows.map((row) => {
    const material = materialMap.get(toTrimmedString(row.material_id));
    const location = locationMap.get(toTrimmedString(row.storage_location_id));
    return {
      ...row,
      material_display: material ? `${material.pace_code ?? ""} ${material.material_name ?? ""}`.trim() : null,
      storage_location_display: location ? `${location.code ?? ""} — ${location.name ?? ""}`.trim() : null,
    };
  });

  return {
    ...dc,
    selling_company_display: sellingCompany ? `${sellingCompany.company_code ?? ""} — ${sellingCompany.company_name ?? ""}`.trim() : null,
    receiving_company_display: receivingCompany ? `${receivingCompany.company_code ?? ""} — ${receivingCompany.company_name ?? ""}`.trim() : null,
    customer_display: customer
      ? (customer.customer_name ? `${customer.customer_code ?? ""} — ${customer.customer_name}`.trim() : String(customer.customer_code ?? ""))
      : null,
    source_document_number: isSalesOrder ? (source?.so_number ?? null) : (source?.sto_number ?? null),
    source_document_date: isSalesOrder ? (source?.so_date ?? null) : (source?.sto_date ?? null),
    source_reference_display: isSalesOrder ? (source?.customer_po_number ? `Customer PO ${source.customer_po_number}` : null) : (source?.sto_type ?? null),
    transporter_display: transporter ? `${transporter.transporter_code ?? ""} — ${transporter.transporter_name ?? ""}`.trim() : (dc.transporter_name_freetext ?? null),
    cost_center_display: costCenter ? `${costCenter.cost_center_code ?? ""} | ${costCenter.cost_center_name ?? ""}`.trim() : null,
    payment_term_display: paymentTerm ? `${paymentTerm.code ?? ""} | ${paymentTerm.name ?? ""}`.trim() : null,
    selling_company_state_name: toTrimmedString(sellingCompany?.state_name) || null,
    counterparty_state_name: counterpartyStateName,
    // §113.16-addendum -- preview of the Bill-To/Ship-To pair the PGI+Invoice
    // form will actually freeze onto the invoice (createPgiInvoiceHandler
    // resolves the same way) -- "nothing here is authoritative" applies here
    // too, same as counterparty_state_name above. STO has no separate
    // customer, so Bill-To and Ship-To both preview as the receiving
    // company; dc.ship_to_* (raw spread above) already carries the real
    // frozen snapshot for SO, these overrides only kick in for STO.
    bill_to_name: isSalesOrder
      ? (toTrimmedString(customer?.customer_name) || null)
      : (receivingCompany ? `${receivingCompany.company_code ?? ""} — ${receivingCompany.company_name ?? ""}`.trim() : null),
    bill_to_address: isSalesOrder
      ? (toTrimmedString(customer?.billing_address) || toTrimmedString(customer?.delivery_address) || null)
      : (toTrimmedString(receivingCompany?.full_address) || null),
    bill_to_state: isSalesOrder ? (toTrimmedString(customer?.billing_state) || null) : (toTrimmedString(receivingCompany?.state_name) || null),
    bill_to_gst_number: isSalesOrder ? (toTrimmedString(customer?.gst_number) || null) : (toTrimmedString(receivingCompany?.gst_number) || null),
    ...(isSalesOrder ? {} : {
      ship_to_name: receivingCompany ? `${receivingCompany.company_code ?? ""} — ${receivingCompany.company_name ?? ""}`.trim() : null,
      ship_to_address: toTrimmedString(receivingCompany?.full_address) || null,
      ship_to_state: toTrimmedString(receivingCompany?.state_name) || null,
      ship_to_gst_number: toTrimmedString(receivingCompany?.gst_number) || null,
    }),
    invoice_id: invoice?.id ?? null,
    invoice_number: invoice?.invoice_number ?? null,
    invoice_date: invoice?.invoice_date ?? null,
    invoice_status: invoice?.status ?? null,
    tally_invoice_number: invoice?.tally_invoice_number ?? null,
    tally_invoice_date: invoice?.tally_invoice_date ?? null,
    lines: hydratedLines,
  };
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
    const dcIds = rows.map((row) => String(row.id));
    const [{ data: sourceLinks, error: sourceLinksError }, { data: dispatchLines, error: dispatchLinesError }] = await Promise.all([
      dcIds.length ? serviceRoleClient.schema("erp_procurement").from("delivery_challan_source").select("dc_id, source_type, source_id").in("dc_id", dcIds) : Promise.resolve({ data: [] as JsonRecord[], error: null }),
      dcIds.length ? serviceRoleClient.schema("erp_procurement").from("delivery_challan_line").select("dc_id, ship_to_name, ship_to_address, ship_to_state, line_total").in("dc_id", dcIds) : Promise.resolve({ data: [] as JsonRecord[], error: null }),
    ]);
    if (sourceLinksError) return doErrorResponse(req, ctx, "DO_SOURCE_FETCH_FAILED", 500, "Unable to load delivery order sources.");
    if (dispatchLinesError) return doErrorResponse(req, ctx, "DO_LINE_FETCH_FAILED", 500, "Unable to load delivery order lines.");
    const sourceByDc = new Map<string, JsonRecord[]>();
    for (const link of (sourceLinks ?? []) as JsonRecord[]) sourceByDc.set(toTrimmedString(link.dc_id), [...(sourceByDc.get(toTrimmedString(link.dc_id)) ?? []), link]);
    const linesByDc = new Map<string, JsonRecord[]>();
    for (const line of (dispatchLines ?? []) as JsonRecord[]) linesByDc.set(toTrimmedString(line.dc_id), [...(linesByDc.get(toTrimmedString(line.dc_id)) ?? []), line]);
    const customerIds = [...new Set(rows.map((row) => toTrimmedString(row.customer_id)).filter(Boolean))];
    // STO-sourced DO rows have no customer_id at all (customer_id is only
    // ever set for dc_type SALES, per createDeliveryOrderHandler) -- the
    // "Customer" column was showing a bare "—" for every STO row instead of
    // the counterparty that's actually relevant there, the receiving company.
    const receivingCompanyIds = [...new Set(rows.map((row) => toTrimmedString(row.receiving_company_id)).filter(Boolean))];
    const [{ data: customers }, { data: receivingCompanies }] = await Promise.all([
      customerIds.length
        ? serviceRoleClient.schema("erp_master").from("customer_master").select("id, customer_code, customer_name").in("id", customerIds)
        : Promise.resolve({ data: [] as JsonRecord[] }),
      receivingCompanyIds.length
        ? serviceRoleClient.schema("erp_master").from("companies").select("id, company_code, company_name").in("id", receivingCompanyIds)
        : Promise.resolve({ data: [] as JsonRecord[] }),
    ]);
    const customerMap = new Map(((customers ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
    const receivingCompanyMap = new Map(((receivingCompanies ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));

    // List page was missing source doc number, transporter, vehicle/LR --
    // vehicle_number/lr_number are already raw columns on delivery_challan
    // (select("*") already carries them through untouched), but the source
    // document's own number and the transporter's name both need a join.
    const soIds = [...new Set([...rows.map((row) => toTrimmedString(row.sales_order_id)), ...(sourceLinks ?? []).filter((link: JsonRecord) => link.source_type === "SALES_ORDER").map((link: JsonRecord) => toTrimmedString(link.source_id))].filter(Boolean))];
    const stoIds = [...new Set([...rows.map((row) => toTrimmedString(row.sto_id)), ...(sourceLinks ?? []).filter((link: JsonRecord) => link.source_type === "STO").map((link: JsonRecord) => toTrimmedString(link.source_id))].filter(Boolean))];
    const transporterIds = [...new Set(rows.map((row) => toTrimmedString(row.transporter_id)).filter(Boolean))];
    const [{ data: sos }, { data: stos }, { data: transporters }] = await Promise.all([
      soIds.length
        ? serviceRoleClient.schema("erp_procurement").from("sales_order").select("id, so_number, customer_po_number, bill_to_name, bill_to_address, bill_to_parent_company_id, bill_to_vdc_id, ibn_required").in("id", soIds)
        : Promise.resolve({ data: [] as JsonRecord[] }),
      stoIds.length
        ? serviceRoleClient.schema("erp_procurement").from("stock_transfer_order").select("id, sto_number").in("id", stoIds)
        : Promise.resolve({ data: [] as JsonRecord[] }),
      transporterIds.length
        ? serviceRoleClient.schema("erp_master").from("transporter_master").select("id, transporter_code, transporter_name").in("id", transporterIds)
        : Promise.resolve({ data: [] as JsonRecord[] }),
    ]);
    const soMap = new Map(((sos ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
    const stoMap = new Map(((stos ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
    const transporterMap = new Map(((transporters ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));

    // §113.15 -- the queue never showed the resulting invoice number/date
    // once a DO went DISPATCHED (real gap flagged live 2026-07-31). One
    // dc_id can have more than one invoice row over time (reversal + a
    // fresh retry), so this keeps only the most recent per dc_id --
    // ordering desc then only setting on first-seen does that in one pass.
    const { data: invoices, error: invoicesError } = dcIds.length
      ? await serviceRoleClient
          .schema("erp_procurement")
          .from("sales_invoice")
          .select("id, dc_id, invoice_number, invoice_date, status, tally_invoice_number, tally_invoice_date, inbound_number")
          .in("dc_id", dcIds)
          .order("created_at", { ascending: false })
      : { data: [] as JsonRecord[], error: null };
    if (invoicesError) return doErrorResponse(req, ctx, "DO_INVOICE_LOOKUP_FAILED", 500, "Unable to load invoice references.");
    const invoiceMap = new Map<string, JsonRecord>();
    for (const row of (invoices ?? []) as JsonRecord[]) {
      const key = toTrimmedString(row.dc_id);
      if (key && !invoiceMap.has(key)) invoiceMap.set(key, row);
    }

    const items = rows.map((row) => {
      const customer = customerMap.get(toTrimmedString(row.customer_id));
      const receivingCompany = receivingCompanyMap.get(toTrimmedString(row.receiving_company_id));
      const customerDisplay = customer
        ? (customer.customer_name ? `${customer.customer_code ?? ""} — ${customer.customer_name}`.trim() : String(customer.customer_code ?? ""))
        : receivingCompany
          ? `To: ${receivingCompany.company_code ?? receivingCompany.company_name ?? ""}`.trim()
          : null;
      const links = sourceByDc.get(String(row.id)) ?? [];
      const sourceSos = links.filter((link) => link.source_type === "SALES_ORDER").map((link) => soMap.get(toTrimmedString(link.source_id))).filter(Boolean) as JsonRecord[];
      const sourceStos = links.filter((link) => link.source_type === "STO").map((link) => stoMap.get(toTrimmedString(link.source_id))).filter(Boolean) as JsonRecord[];
      const so = soMap.get(toTrimmedString(row.sales_order_id));
      const sto = stoMap.get(toTrimmedString(row.sto_id));
      const effectiveSos = sourceSos.length ? sourceSos : (so ? [so] : []);
      const effectiveStos = sourceStos.length ? sourceStos : (sto ? [sto] : []);
      // SO01 stores the user-entered external SO number as customer_po_number.
      // In operational dispatch lists that is the business-facing SO number;
      // internal PACE so_number remains available in the source record.
      const sourceDocuments = [
        ...effectiveSos.map((entry) => String(entry.customer_po_number ?? entry.so_number ?? "")),
        ...effectiveStos.map((entry) => String(entry.sto_number ?? "")),
      ].filter(Boolean);
      const sourceTypes = [...new Set([...effectiveSos.map(() => "SALES_ORDER"), ...effectiveStos.map(() => "STO")])];
      const billTo = [...new Set(effectiveSos.map((entry) => [entry.bill_to_name, entry.bill_to_address].filter(Boolean).join(" — ")).filter(Boolean))].join(" | ") || null;
      const lineSnapshots = linesByDc.get(String(row.id)) ?? [];
      const shipTo = [...new Set(lineSnapshots.map((line) => [line.ship_to_name, line.ship_to_address, line.ship_to_state].filter(Boolean).join(" — ")).filter(Boolean))].join(" | ") || null;
      const transporter = transporterMap.get(toTrimmedString(row.transporter_id));
      const invoice = invoiceMap.get(String(row.id));
      return {
        ...row,
        source_display: sourceTypes.join(" + ") || (row.sales_order_id ? "SALES_ORDER" : row.sto_id ? "STO" : null),
        source_document_number: sourceDocuments.join(" | ") || null,
        customer_display: customerDisplay || billTo,
        bill_to_display: billTo,
        ship_to_display: shipTo,
        ibn_required: effectiveSos.some((entry) => Boolean(entry.ibn_required)),
        transporter_display: transporter
          ? `${transporter.transporter_code ?? ""} — ${transporter.transporter_name ?? ""}`.trim()
          : (toTrimmedString(row.transporter_name_freetext) || null),
        invoice_id: invoice?.id ?? null,
        invoice_number: invoice?.invoice_number ?? null,
        invoice_date: invoice?.invoice_date ?? null,
        invoice_status: invoice?.status ?? null,
        tally_invoice_number: invoice?.tally_invoice_number ?? null,
        tally_invoice_date: invoice?.tally_invoice_date ?? null,
        inbound_number: invoice?.inbound_number ?? null,
        total_value: row.total_value ?? lineSnapshots.reduce((sum, line) => sum + Number(line.line_total ?? 0), 0),
      };
    });

    return okResponse({ items, total: count ?? items.length }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_LIST_FAILED";
    return doErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, code);
  }
}

const EXCLUSIVE_FREIGHT_TERMS = new Set(["FREIGHT_SEPARATE", "FREIGHT_AT_ACTUALS", "EX_TRANSPORTER_GODOWN"]);

// post_document/complete_pgi_invoice_action wrote the invoice+lines inside
// the transaction, so this is a plain read-back for the response -- not
// part of the write path.
async function hydrateSalesInvoiceForDo(invoiceId: string): Promise<JsonRecord> {
  const { data: invoice, error: invoiceError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("sales_invoice")
    .select("*")
    .eq("id", invoiceId)
    .single();
  if (invoiceError || !invoice) throw new Error("PGI_INVOICE_READBACK_FAILED");
  const { data: invoiceLines, error: linesError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("sales_invoice_line")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("line_number", { ascending: true });
  if (linesError) throw new Error("PGI_INVOICE_LINE_READBACK_FAILED");
  return { ...invoice, lines: invoiceLines ?? [] };
}

// §113.15 -- the combined PGI + Invoice action (Accounts). Deliberately a
// NEW additive route/handler, not a rewrite of the legacy
// createSalesInvoiceHandler/postSalesInvoiceHandler pair (still wired,
// unused by the new frontend flow -- left as a follow-up cleanup rather
// than risk touching call sites not fully traced in this pass). One click:
// generates the Invoice number, requires the Tally reference (this ERP's
// own invoice is tracking-only, no IRN/e-invoice link -- the real legal
// document is created in Tally separately), computes GST (customer
// billing_state for SO, sending-vs-receiving company state_name for STO,
// both via the same deriveSalesInvoiceGstType), and posts stock movement
// P601 "GI for Dispatch (Delivery)" per DO line, all in one request. DO
// itself is never touched again after create except by this handler (sets
// DISPATCHED) and the reversal handler (sets back to CREATED).
export async function createPgiInvoiceHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const dcId = toTrimmedString(body.dc_id);
    const tallyInvoiceNumber = toTrimmedString(body.tally_invoice_number);
    const tallyInvoiceDate = toTrimmedString(body.tally_invoice_date);
    if (!dcId || !tallyInvoiceNumber || !tallyInvoiceDate) {
      return doErrorResponse(req, ctx, "PGI_INVOICE_INVALID", 400, "dc_id, tally_invoice_number, and tally_invoice_date are required.");
    }

    const { data: dc, error: dcError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("delivery_challan")
      .select("*")
      .eq("id", dcId)
      .single();
    if (dcError || !dc) return doErrorResponse(req, ctx, "DO_NOT_FOUND", 404, "Delivery order not found.");
    try {
      await assertCompanyScope(ctx, toTrimmedString(dc.selling_company_id));
    } catch {
      return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (toUpperTrimmedString(dc.status) !== "CREATED") {
      return doErrorResponse(req, ctx, "DO_NOT_READY_FOR_PGI", 400, "Only a CREATED delivery order (not yet PGI'd, not cancelled) can be invoiced.");
    }

    // §113.15 lock: 1 DO = 1 Invoice. Enforced here (not a DB unique
    // constraint on dc_id) so a CANCELLED invoice's dc_id can be reused by
    // a fresh attempt -- see reverseSalesInvoiceHandler.
    const { data: existingInvoice, error: existingInvoiceError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("sales_invoice")
      .select("id")
      .eq("dc_id", dcId)
      .in("status", ["DRAFT", "POSTED"])
      .maybeSingle();
    if (existingInvoiceError) return doErrorResponse(req, ctx, "PGI_INVOICE_LOOKUP_FAILED", 500, "Unable to check for an existing invoice.");
    if (existingInvoice) return doErrorResponse(req, ctx, "DO_ALREADY_INVOICED", 409, "This delivery order already has an active invoice.");

    const { data: dcLines, error: dcLinesError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("delivery_challan_line")
      .select("*")
      .eq("dc_id", dcId)
      .order("line_number", { ascending: true });
    if (dcLinesError) return doErrorResponse(req, ctx, "DO_LINE_FETCH_FAILED", 500, "Unable to load delivery order lines.");
    const lines = (dcLines ?? []) as JsonRecord[];
    if (lines.length === 0) return doErrorResponse(req, ctx, "DO_EMPTY", 400, "Delivery order has no lines.");

    const isSalesOrder = toUpperTrimmedString(dc.dc_type) === "SALES";
    const companyId = toTrimmedString(dc.selling_company_id);

    // GST type: same function either way, just a different pair of states.
    let companyStateName: string | null = null;
    let counterpartyStateName: string | null = null;
    // §113.16-addendum -- a GST invoice legally needs BOTH Bill-To (the
    // customer's own registered identity) and Ship-To (the delivery
    // destination) printed, not just whichever one happens to drive the
    // CGST+SGST-vs-IGST math. Frozen onto the invoice itself at create time
    // (not just left on the DO) so the invoice stays self-contained even if
    // the DO/customer record changes later.
    type PartyDetail = { name: string | null; address: string | null; state: string | null; gstNumber: string | null };
    let billTo: PartyDetail;
    let shipTo: PartyDetail;
    const { data: sellingCompany, error: sellingCompanyError } = await serviceRoleClient
      .schema("erp_master").from("companies").select("state_name").eq("id", companyId).maybeSingle();
    if (sellingCompanyError) return doErrorResponse(req, ctx, "PGI_INVOICE_TAX_CONTEXT_FAILED", 500, "Unable to load company tax context.");
    companyStateName = toTrimmedString(sellingCompany?.state_name) || null;

    if (isSalesOrder) {
      const customerId = toTrimmedString(dc.customer_id);
      if (!customerId) return doErrorResponse(req, ctx, "PGI_INVOICE_CUSTOMER_REQUIRED", 400, "Delivery order has no customer.");
      // §113.16 -- place of supply is the Ship-To location, not the
      // customer's registered/billing state; those can legitimately differ.
      // dc.ship_to_state is already the frozen, resolved snapshot copied
      // from the SO at DO-create time (§113.16) -- no live customer_master
      // query needed here anymore (was the source of the earlier silent-
      // IGST gap found live 2026-07-31, now structurally impossible for any
      // DO created after this fix since ship_to_state is mandatory at SO save).
      counterpartyStateName = toTrimmedString(dc.ship_to_state) || null;
      if (!counterpartyStateName) {
        return doErrorResponse(req, ctx, "DO_SHIP_TO_STATE_MISSING", 400, "This Delivery Order has no Ship-To State recorded (likely created before the Ship-To mechanism existed) -- reverse it and re-create the DO so it picks up the SO's current Ship-To.");
      }
      const { data: customer, error: customerError } = await serviceRoleClient
        .schema("erp_master")
        .from("customer_master")
        .select("customer_name, billing_address, delivery_address, billing_state, gst_number")
        .eq("id", customerId)
        .maybeSingle();
      if (customerError || !customer) return doErrorResponse(req, ctx, "PGI_INVOICE_CUSTOMER_LOOKUP_FAILED", 500, "Unable to load customer for Bill-To.");
      billTo = {
        name: toTrimmedString(customer.customer_name) || null,
        address: toTrimmedString(customer.billing_address) || toTrimmedString(customer.delivery_address) || null,
        state: toTrimmedString(customer.billing_state) || null,
        gstNumber: toTrimmedString(customer.gst_number) || null,
      };
      shipTo = {
        name: toTrimmedString(dc.ship_to_name) || null,
        address: toTrimmedString(dc.ship_to_address) || null,
        state: counterpartyStateName,
        gstNumber: toTrimmedString(dc.ship_to_gst_number) || null,
      };
    } else {
      const receivingCompanyId = toTrimmedString(dc.receiving_company_id);
      if (!receivingCompanyId) return doErrorResponse(req, ctx, "PGI_INVOICE_RECEIVING_COMPANY_REQUIRED", 400, "Delivery order has no receiving company.");
      const { data: receivingCompany, error: receivingCompanyError } = await serviceRoleClient
        .schema("erp_master")
        .from("companies")
        .select("company_code, company_name, state_name, full_address, gst_number")
        .eq("id", receivingCompanyId)
        .maybeSingle();
      if (receivingCompanyError) return doErrorResponse(req, ctx, "PGI_INVOICE_TAX_CONTEXT_FAILED", 500, "Unable to load receiving company tax context.");
      counterpartyStateName = toTrimmedString(receivingCompany?.state_name) || null;
      if (!counterpartyStateName) {
        return doErrorResponse(req, ctx, "PGI_INVOICE_RECEIVING_COMPANY_STATE_MISSING", 400, "Receiving company has no State set -- fix it on Company Master before PGI (needed to determine CGST+SGST vs IGST).");
      }
      // STO has no separate customer -- Bill-To and Ship-To are both the
      // receiving company itself.
      const receivingCompanyDetail: PartyDetail = {
        name: receivingCompany?.company_name ? `${receivingCompany.company_code ?? ""} — ${receivingCompany.company_name}`.trim() : null,
        address: toTrimmedString(receivingCompany?.full_address) || null,
        state: counterpartyStateName,
        gstNumber: toTrimmedString(receivingCompany?.gst_number) || null,
      };
      billTo = receivingCompanyDetail;
      shipTo = receivingCompanyDetail;
    }
    if (!companyStateName) {
      return doErrorResponse(req, ctx, "PGI_INVOICE_SELLING_COMPANY_STATE_MISSING", 400, "Selling company has no State set -- fix it on Company Master before PGI (needed to determine CGST+SGST vs IGST).");
    }
    const gstType = deriveSalesInvoiceGstType(companyStateName, counterpartyStateName);

    // Freight: only meaningful when the DO's own freight_term is an
    // "exclusive" kind (FOR = inclusive, nothing to enter). Normalized
    // defensively here even though the frontend only shows the Yes/No
    // toggle for exclusive freight_term in the first place.
    const freightTerm = toUpperTrimmedString(dc.freight_term);
    const freightEligible = EXCLUSIVE_FREIGHT_TERMS.has(freightTerm);
    const freightIncluded = freightEligible && body.freight_included === true;
    const freightAmount = freightIncluded ? parsePositiveNumber(body.freight_amount) : null;
    if (freightIncluded && !freightAmount) {
      return doErrorResponse(req, ctx, "PGI_INVOICE_FREIGHT_AMOUNT_REQUIRED", 400, "Freight amount is required when freight is included.");
    }

    // Per-line GST split (cgst+sgst vs igst) off the DO line's own
    // already-snapshotted gst_amount (§113.13) -- the total doesn't change
    // with the split, only how it's divided.
    const lineComputations = lines.map((line) => {
      const quantity = Number(line.quantity ?? 0);
      const rate = Number(line.unit_value ?? 0);
      const taxableValue = Number((quantity * rate).toFixed(4));
      const gstAmount = Number(line.gst_amount ?? 0);
      const cgstAmount = gstType === "CGST_SGST" ? Number((gstAmount / 2).toFixed(4)) : null;
      const sgstAmount = gstType === "CGST_SGST" ? Number((gstAmount / 2).toFixed(4)) : null;
      const igstAmount = gstType === "IGST" ? gstAmount : null;
      // Reuse the DO line's own already-correct line_total rather than
      // recomputing taxableValue+gstAmount here -- computeLineValues folds
      // packaging cost into the total differently across its three
      // GST-treatment branches (§113.9), and DO already ran that formula
      // once at create time (§113.13). Recomputing a simplified version
      // here would silently drop packaging cost for the NO_GST branch.
      const lineTotal = Number(line.line_total ?? (taxableValue + gstAmount));
      return { line, quantity, rate, taxableValue, gstAmount, cgstAmount, sgstAmount, igstAmount, lineTotal };
    });

    let totalTaxableValue = 0;
    let totalCgstAmount = 0;
    let totalSgstAmount = 0;
    let totalIgstAmount = 0;
    for (const c of lineComputations) {
      totalTaxableValue += c.taxableValue;
      totalCgstAmount += c.cgstAmount ?? 0;
      totalSgstAmount += c.sgstAmount ?? 0;
      totalIgstAmount += c.igstAmount ?? 0;
    }
    const totalGstAmount = Number((totalCgstAmount + totalSgstAmount + totalIgstAmount).toFixed(4));
    const totalInvoiceValue = Number((totalTaxableValue + totalGstAmount + (freightAmount ?? 0)).toFixed(4));

    const invoiceNumber = await generateProcurementDocNumber("SALES_INVOICE");
    const invoiceId = crypto.randomUUID();
    const invoiceDate = todayIsoDate();

    // §8D step 4 -- CI's stock-posting-guard forbids calling
    // post_stock_movement directly from a new file/handler: an interrupted
    // request used to be able to leave stock posted with no invoice row (or
    // vice versa). All checks below stay in TypeScript (§107.8's own rule --
    // only the WRITE moves into the transaction, not the calculations);
    // movements + the invoice/lines/reservation/DO writes all land in one
    // erp_inventory.post_document() call, handled by
    // erp_procurement.complete_pgi_invoice_action() in the same transaction.
    const movements: JsonRecord[] = [];
    for (const c of lineComputations) {
      const materialId = toTrimmedString(c.line.material_id);
      const storageLocationId = toTrimmedString(c.line.storage_location_id);
      const postingBlocked = await hasPhysicalInventoryBlock(materialId, storageLocationId, "UNRESTRICTED");
      if (postingBlocked) {
        return doErrorResponse(req, ctx, "MATERIAL_POSTING_BLOCKED", 409, "Material has an active physical inventory count in progress.");
      }
      let snapshot: JsonRecord;
      try {
        snapshot = await getSnapshotForIssue(companyId, storageLocationId, materialId);
      } catch {
        return doErrorResponse(req, ctx, "INSUFFICIENT_STOCK", 400, `No unrestricted stock found for line ${c.line.line_number}.`);
      }
      if (Number(snapshot.quantity ?? 0) < c.quantity) {
        return doErrorResponse(req, ctx, "INSUFFICIENT_STOCK", 400, `Insufficient stock for line ${c.line.line_number}.`);
      }
      movements.push({
        document_number: invoiceNumber,
        document_date: invoiceDate,
        posting_date: todayIsoDate(),
        movement_type_code: "P601",
        company_id: companyId,
        storage_location_id: storageLocationId,
        material_id: materialId,
        quantity: c.quantity,
        base_uom_code: c.line.uom_code,
        unit_value: Number(snapshot.valuation_rate ?? 0),
        stock_type_code: "UNRESTRICTED",
        direction: "OUT",
        reference_document_number: invoiceNumber,
        line_ref: String(c.line.id),
      });
    }

    // §106: one Material Document for the whole PGI event; the invoice
    // number becomes the reference (this is the invoice's own physical
    // goods-issue event, not the DO's -- DO itself never posts stock).
    const matDoc = await generateMaterialDocNumber(companyId);
    for (const m of movements) {
      m.material_doc_number = matDoc.docNumber;
      m.material_doc_year = matDoc.docYear;
    }

    const invoiceLinesPayload = lineComputations.map((c, index) => ({
      line_number: index + 1,
      so_line_id: isSalesOrder ? c.line.so_line_id : null,
      dc_line_id: c.line.id,
      material_id: c.line.material_id,
      quantity: c.quantity,
      uom_code: c.line.uom_code,
      rate: c.rate,
      taxable_value: c.taxableValue,
      gst_rate: c.line.gst_rate != null ? Number(c.line.gst_rate) : null,
      cgst_amount: c.cgstAmount,
      sgst_amount: c.sgstAmount,
      igst_amount: c.igstAmount,
      line_total: c.lineTotal,
    }));

    const reservationsPayload = lineComputations
      .map((c) => ({
        source_line_id: toTrimmedString(isSalesOrder ? c.line.so_line_id : c.line.sto_line_id),
        issued_qty: c.quantity,
      }))
      .filter((r) => r.source_line_id);

    const context = {
      action: "CREATE",
      dc_id: dcId,
      invoice: {
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        company_id: companyId,
        customer_id: isSalesOrder ? toTrimmedString(dc.customer_id) : null,
        sto_id: isSalesOrder ? null : toTrimmedString(dc.sto_id),
        dc_id: dcId,
        so_id: isSalesOrder ? toTrimmedString(dc.sales_order_id) : null,
        payment_term_id: toTrimmedString(dc.payment_term_id) || null,
        gst_type: gstType,
        bill_to_name: billTo.name,
        bill_to_address: billTo.address,
        bill_to_state: billTo.state,
        bill_to_gst_number: billTo.gstNumber,
        ship_to_name: shipTo.name,
        ship_to_address: shipTo.address,
        ship_to_state: shipTo.state,
        ship_to_gst_number: shipTo.gstNumber,
        tally_invoice_number: tallyInvoiceNumber,
        tally_invoice_date: tallyInvoiceDate,
        freight_included: freightIncluded,
        freight_amount: freightAmount,
        total_taxable_value: Number(totalTaxableValue.toFixed(4)),
        total_cgst_amount: Number(totalCgstAmount.toFixed(4)),
        total_sgst_amount: Number(totalSgstAmount.toFixed(4)),
        total_igst_amount: Number(totalIgstAmount.toFixed(4)),
        total_gst_amount: totalGstAmount,
        total_invoice_value: totalInvoiceValue,
        posted_by: ctx.auth_user_id,
        remarks: toTrimmedString(body.remarks) || null,
        created_by: ctx.auth_user_id,
      },
      lines: invoiceLinesPayload,
      reservations: reservationsPayload,
    };

    const { error: postDocumentError } = await serviceRoleClient
      .schema("erp_inventory")
      .rpc("post_document", {
        p_reference_document_type: "SALES_INVOICE",
        p_reference_document_id: invoiceId,
        p_movements: movements,
        p_posted_by: ctx.auth_user_id,
        p_context: context,
      });
    if (postDocumentError) return doErrorResponse(req, ctx, "PGI_POST_FAILED", 500, postDocumentError.message || "Unable to post PGI and invoice.");

    return okResponse(await hydrateSalesInvoiceForDo(invoiceId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PGI_INVOICE_CREATE_FAILED";
    const status = code === "DO_NOT_FOUND" ? 404
      : code === "COMPANY_SCOPE_VIOLATION" ? 403
      : code === "DO_ALREADY_INVOICED" ? 409
      : code.includes("REQUIRED") || code.includes("INVALID") || code.includes("NOT_READY") || code === "INSUFFICIENT_STOCK" ? 400
      : 500;
    return doErrorResponse(req, ctx, code, status, code);
  }
}

// §113.15 -- post-PGI Invoice reversal, deliberately a SEPARATE handler
// from createPgiInvoiceHandler (same separation-of-duties requirement as
// cancelDeliveryOrderHandler). Cancels the invoice, reverses stock via
// P602, and releases the DO back to CREATED so a fresh PGI+Invoice attempt
// can be made against it -- Tally number/date reuse on the retry is fine
// (business owner's own call, no uniqueness enforced).
export async function reverseSalesInvoiceHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const invoiceId = getIdFromPath(req);
    if (!invoiceId) return doErrorResponse(req, ctx, "PGI_INVOICE_ID_REQUIRED", 400, "Invoice id is required.");
    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason);
    if (!reason) return doErrorResponse(req, ctx, "PGI_INVOICE_REVERSE_REASON_REQUIRED", 400, "Reversal reason is required.");

    const { data: invoice, error: invoiceError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("sales_invoice")
      .select("*")
      .eq("id", invoiceId)
      .single();
    if (invoiceError || !invoice) return doErrorResponse(req, ctx, "PGI_INVOICE_NOT_FOUND", 404, "Invoice not found.");
    try {
      await assertCompanyScope(ctx, toTrimmedString(invoice.company_id));
    } catch {
      return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (toUpperTrimmedString(invoice.status) !== "POSTED") {
      return doErrorResponse(req, ctx, "PGI_INVOICE_REVERSE_BLOCKED", 400, "Only a POSTED invoice can be reversed.");
    }

    const dcId = toTrimmedString(invoice.dc_id);
    const companyId = toTrimmedString(invoice.company_id);

    // Original P601 legs for this invoice. reference_document_type/id and
    // p_reversal_of_id's target both live on stock_document (the per-leg
    // header post_stock_movement() writes one row of per document+item),
    // not stock_ledger -- stock_ledger carries no reference/reversal
    // columns of its own at all.
    const { data: originalDocRows, error: docLookupError } = await serviceRoleClient
      .schema("erp_inventory")
      .from("stock_document")
      .select("id, material_id, source_location_id, quantity, base_uom_code, valuation_rate, reversal_document_id")
      .eq("reference_document_type", "SALES_INVOICE")
      .eq("reference_document_id", invoiceId)
      .eq("movement_type_code", "P601");
    if (docLookupError) return doErrorResponse(req, ctx, "PGI_INVOICE_LEDGER_LOOKUP_FAILED", 500, "Unable to load the original stock postings.");
    const originalLegs = ((originalDocRows ?? []) as JsonRecord[]).filter((row) => !row.reversal_document_id);
    if (originalLegs.length === 0) return doErrorResponse(req, ctx, "PGI_INVOICE_NO_POSTINGS_FOUND", 500, "No reversible stock postings found for this invoice.");

    const matDoc = await generateMaterialDocNumber(companyId);
    const nowIso = new Date().toISOString();

    // §8D step 4 -- same move as createPgiInvoiceHandler: all reversal legs
    // + the invoice CANCELLED + DO reopened land in one erp_inventory.
    // post_document() call, handled by complete_pgi_invoice_action()
    // (action: 'REVERSE') in the same transaction.
    const movements = originalLegs.map((leg) => ({
      document_number: String(invoice.invoice_number),
      document_date: String(invoice.invoice_date),
      posting_date: todayIsoDate(),
      movement_type_code: "P602",
      company_id: companyId,
      storage_location_id: leg.source_location_id,
      material_id: leg.material_id,
      quantity: Number(leg.quantity ?? 0),
      base_uom_code: leg.base_uom_code,
      // Reverse at the ORIGINAL leg's own rate, not a fresh snapshot read --
      // reversing at a stale/zero rate would dilute the restored material's
      // own weighted-average (§104-4's own rule, applied here the same way).
      unit_value: Number(leg.valuation_rate ?? 0),
      stock_type_code: "UNRESTRICTED",
      direction: "IN",
      reversal_of_id: leg.id,
      material_doc_number: matDoc.docNumber,
      material_doc_year: matDoc.docYear,
      reference_document_number: String(invoice.invoice_number),
      line_ref: String(leg.id),
    }));

    const context = {
      action: "REVERSE",
      dc_id: dcId || null,
      cancel: {
        cancelled_by: ctx.auth_user_id,
        cancelled_at: nowIso,
        cancellation_reason: reason,
      },
    };

    const { error: postDocumentError } = await serviceRoleClient
      .schema("erp_inventory")
      .rpc("post_document", {
        p_reference_document_type: "SALES_INVOICE",
        p_reference_document_id: invoiceId,
        p_movements: movements,
        p_posted_by: ctx.auth_user_id,
        p_context: context,
      });
    if (postDocumentError) return doErrorResponse(req, ctx, "PGI_REVERSAL_POST_FAILED", 500, postDocumentError.message || "Unable to reverse GI and invoice.");

    return okResponse({ ...invoice, status: "CANCELLED", cancellation_reason: reason }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PGI_INVOICE_REVERSE_FAILED";
    const status = code === "PGI_INVOICE_NOT_FOUND" ? 404 : code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") || code.includes("BLOCKED") ? 400 : 500;
    return doErrorResponse(req, ctx, code, status, code);
  }
}
