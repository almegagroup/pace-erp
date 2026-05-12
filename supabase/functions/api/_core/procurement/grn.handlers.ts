/*
 * File-ID: 16.4.2
 * File-Path: supabase/functions/api/_core/procurement/grn.handlers.ts
 * Gate: 16.4
 * Phase: 16
 * Domain: PROCUREMENT
 * Purpose: Implement GRN draft, posting, reversal, and listing handlers.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};
type GrnRow = Record<string, unknown>;
type GrnLineRow = Record<string, unknown>;
type GateEntryRow = Record<string, unknown>;
type GateEntryLineRow = Record<string, unknown>;
type PurchaseOrderRow = Record<string, unknown>;
type PurchaseOrderLineRow = Record<string, unknown>;
type MaterialRow = Record<string, unknown>;
type CsnRow = Record<string, unknown>;

const GRN_STATUSES = new Set(["DRAFT", "POSTED", "REVERSED"]);
const STOCK_TYPES = new Set(["UNRESTRICTED", "QA_STOCK", "BLOCKED"]);

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function procurementErrorResponse(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function assertProcurementReadRole(_ctx: ProcurementHandlerContext): void {
  // Protected by upstream pipeline.
}

function getCompanyScope(ctx: ProcurementHandlerContext, requestedCompanyId?: string): string {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  const companyId = toTrimmedString(requestedCompanyId);
  return companyId || scopedCompanyId;
}

async function generateProcurementDocNumber(docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("generate_doc_number", { p_doc_type: docType });

  if (error || !data) {
    throw new Error("PROCUREMENT_DOC_NUMBER_FAILED");
  }

  return String(data);
}

async function fetchGateEntryBundle(gateEntryId: string): Promise<{
  gateEntry: GateEntryRow;
  lines: GateEntryLineRow[];
}> {
  const { data: gateEntry, error: gateEntryError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("gate_entry")
    .select("*")
    .eq("id", gateEntryId)
    .single();

  if (gateEntryError || !gateEntry) {
    throw new Error("GATE_ENTRY_NOT_FOUND");
  }

  const { data: lines, error: linesError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("gate_entry_line")
    .select("*")
    .eq("gate_entry_id", gateEntryId)
    .order("line_number", { ascending: true });

  if (linesError) {
    throw new Error("GATE_ENTRY_LINE_FETCH_FAILED");
  }

  return { gateEntry, lines: (lines ?? []) as GateEntryLineRow[] };
}

async function fetchPoLineBundle(poLineId: string): Promise<{
  poLine: PurchaseOrderLineRow;
  po: PurchaseOrderRow;
}> {
  const { data: poLine, error: poLineError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order_line")
    .select("*")
    .eq("id", poLineId)
    .single();

  if (poLineError || !poLine) {
    throw new Error("PO_LINE_NOT_FOUND");
  }

  const { data: po, error: poError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order")
    .select("*")
    .eq("id", String(poLine.po_id))
    .single();

  if (poError || !po) {
    throw new Error("PO_NOT_FOUND");
  }

  return { poLine, po };
}

async function fetchMaterial(materialId: string): Promise<MaterialRow> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, base_uom_code, qa_required_on_inward, batch_tracking_required, fifo_tracking_enabled, expiry_tracking_enabled")
    .eq("id", materialId)
    .single();

  if (error || !data) {
    throw new Error("MATERIAL_NOT_FOUND");
  }

  return data as MaterialRow;
}

async function getPlantForLocation(companyId: string, storageLocationId: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_plant_map")
    .select("plant_id")
    .eq("company_id", companyId)
    .eq("storage_location_id", storageLocationId)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data?.plant_id) {
    throw new Error("GRN_PLANT_MAP_NOT_FOUND");
  }

  return String(data.plant_id);
}

async function hasPhysicalInventoryBlock(
  materialId: string,
  plantId: string,
  storageLocationId: string,
): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("physical_inventory_block")
    .select("id")
    .eq("material_id", materialId)
    .eq("plant_id", plantId)
    .eq("storage_location_id", storageLocationId)
    .maybeSingle();

  if (error) {
    throw new Error("MATERIAL_POSTING_BLOCK_LOOKUP_FAILED");
  }

  return Boolean(data?.id);
}

async function fetchGateExit(gateEntryId: string): Promise<JsonRecord> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("gate_exit_inbound")
    .select("*")
    .eq("gate_entry_id", gateEntryId)
    .maybeSingle();

  if (error) {
    throw new Error("GATE_EXIT_FETCH_FAILED");
  }
  if (!data) {
    throw new Error("GATE_EXIT_REQUIRED");
  }
  return data as JsonRecord;
}

function effectiveNetWeight(exitRow: JsonRecord): number | null {
  const override = parseNullableNumber(exitRow.net_weight_override);
  if (override !== null) return override;
  return parseNullableNumber(exitRow.net_weight_calculated);
}

async function hydrateGrn(grnId: string): Promise<JsonRecord> {
  const { data: grn, error: grnError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("goods_receipt")
    .select("*")
    .eq("id", grnId)
    .single();

  if (grnError || !grn) {
    throw new Error("GRN_NOT_FOUND");
  }

  const { data: lines, error: linesError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("goods_receipt_line")
    .select("*")
    .eq("grn_id", grnId)
    .order("line_number", { ascending: true });

  if (linesError) {
    throw new Error("GRN_LINE_FETCH_FAILED");
  }

  const gateEntryResp = await serviceRoleClient
    .schema("erp_procurement")
    .from("gate_entry")
    .select("*")
    .eq("id", String(grn.gate_entry_id))
    .maybeSingle();

  if (gateEntryResp.error) {
    throw new Error("GRN_GATE_ENTRY_FETCH_FAILED");
  }

  return {
    ...grn,
    lines: lines ?? [],
    gate_entry: gateEntryResp.data ?? null,
  };
}

async function inferGrnLineDefaults(
  gateEntry: GateEntryRow,
  geLine: GateEntryLineRow,
  gateExit: JsonRecord,
): Promise<JsonRecord> {
  const material = await fetchMaterial(String(geLine.material_id));
  const netWeight = parseNullableNumber(geLine.net_weight) ?? effectiveNetWeight(gateExit);
  const defaultReceivedQty = netWeight ?? (parsePositiveNumber(geLine.ge_qty) ?? 0);
  const { poLine } = geLine.po_line_id
    ? await fetchPoLineBundle(String(geLine.po_line_id))
    : { poLine: null as PurchaseOrderLineRow | null, po: null as PurchaseOrderRow | null };

  return {
    gate_entry_line_id: geLine.id,
    po_line_id: geLine.po_line_id ?? null,
    sto_line_id: geLine.sto_line_id ?? null,
    material_id: geLine.material_id,
    storage_location_id: poLine?.receiving_location_id ?? null,
    ge_qty: geLine.ge_qty,
    net_weight_from_weighbridge: netWeight,
    received_qty: Number(defaultReceivedQty.toFixed(6)),
    uom_code: geLine.uom_code ?? material.base_uom_code,
    discrepancy_qty: Number(((parsePositiveNumber(geLine.ge_qty) ?? 0) - defaultReceivedQty).toFixed(6)),
    target_stock_type: material.qa_required_on_inward ? "QA_STOCK" : "UNRESTRICTED",
    batch_lot_number: null,
    expiry_date: null,
    invoice_number: geLine.challan_or_invoice_no ?? null,
    grn_rate: poLine ? parseNullableNumber(poLine.unit_rate) : null,
  };
}

async function createQaDocumentForLine(
  ctx: ProcurementHandlerContext,
  grn: GrnRow,
  line: GrnLineRow,
): Promise<void> {
  const qaNumber = await generateProcurementDocNumber("QA");
  const { error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("inward_qa_document")
    .insert({
      qa_number: qaNumber,
      company_id: grn.company_id,
      plant_id: null,
      grn_id: grn.id,
      grn_line_id: line.id,
      po_id: line.po_line_id ? grn.po_id : null,
      material_id: line.material_id,
      vendor_id: grn.vendor_id,
      batch_lot_number: line.batch_lot_number,
      qa_stock_qty: line.received_qty,
      uom_code: line.uom_code,
      status: "PENDING",
      remarks: "Auto-created from GRN posting",
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    });

  if (error) {
    throw new Error("QA_CREATE_FAILED");
  }
}

async function updatePoLineReceipt(poLineId: string, deltaQty: number): Promise<void> {
  const { poLine } = await fetchPoLineBundle(poLineId);
  const orderedQty = parsePositiveNumber(poLine.ordered_qty) ?? 0;
  const currentOpenQty = parseNullableNumber(poLine.open_qty) ?? orderedQty;
  const nextOpenQty = Number(Math.max(0, currentOpenQty - deltaQty).toFixed(6));
  const lineStatus = nextOpenQty <= 0
    ? "FULLY_RECEIVED"
    : nextOpenQty < orderedQty
    ? "PARTIALLY_RECEIVED"
    : "OPEN";

  const { error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order_line")
    .update({
      open_qty: nextOpenQty,
      line_status: lineStatus,
      last_updated_at: new Date().toISOString(),
    })
    .eq("id", poLineId);

  if (error) {
    throw new Error("PO_LINE_RECEIPT_UPDATE_FAILED");
  }
}

async function reversePoLineReceipt(poLineId: string, deltaQty: number): Promise<void> {
  const { poLine } = await fetchPoLineBundle(poLineId);
  const orderedQty = parsePositiveNumber(poLine.ordered_qty) ?? 0;
  const currentOpenQty = parseNullableNumber(poLine.open_qty) ?? 0;
  const nextOpenQty = Number(Math.min(orderedQty, currentOpenQty + deltaQty).toFixed(6));
  const lineStatus = nextOpenQty >= orderedQty
    ? "OPEN"
    : nextOpenQty > 0
    ? "PARTIALLY_RECEIVED"
    : "FULLY_RECEIVED";

  const { error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order_line")
    .update({
      open_qty: nextOpenQty,
      line_status: lineStatus,
      last_updated_at: new Date().toISOString(),
    })
    .eq("id", poLineId);

  if (error) {
    throw new Error("PO_LINE_RECEIPT_REVERSE_FAILED");
  }
}

export async function createGRNDraftHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const gateEntryId = toTrimmedString(body.gate_entry_id);
    if (!gateEntryId) {
      return procurementErrorResponse(req, ctx, "GRN_GATE_ENTRY_REQUIRED", 400, "gate_entry_id is required.");
    }

    const { gateEntry, lines } = await fetchGateEntryBundle(gateEntryId);
    await fetchGateExit(gateEntryId);

    const existingResp = await serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt")
      .select("id")
      .eq("gate_entry_id", gateEntryId)
      .maybeSingle();

    if (existingResp.error) {
      return procurementErrorResponse(req, ctx, "GRN_EXISTING_CHECK_FAILED", 500, "Unable to validate existing GRN.");
    }
    if (existingResp.data) {
      return procurementErrorResponse(req, ctx, "GRN_ALREADY_EXISTS", 400, "A GRN already exists for this gate entry.");
    }

    const gateExit = await fetchGateExit(gateEntryId);
    let poId: string | null = null;
    let vendorId: string | null = null;
    let stoId: string | null = null;
    let movementTypeCode = "P101";

    if (lines.length > 0 && lines[0].po_line_id) {
      const { po } = await fetchPoLineBundle(String(lines[0].po_line_id));
      poId = String(po.id);
      vendorId = toTrimmedString(po.vendor_id) || null;
    }
    if (lines.length > 0 && lines[0].sto_id) {
      stoId = toTrimmedString(lines[0].sto_id) || null;
      movementTypeCode = "STO_RECEIPT";
    }

    const grnNumber = await generateProcurementDocNumber("GRN");
    const grnDate = toTrimmedString(body.grn_date) || todayIsoDate();
    const postingDate = toTrimmedString(body.posting_date) || grnDate;
    const { data: grn, error: grnError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt")
      .insert({
        grn_number: grnNumber,
        grn_date: grnDate,
        posting_date: postingDate,
        company_id: gateEntry.company_id,
        vendor_id: vendorId,
        gate_entry_id: gateEntryId,
        po_id: poId,
        sto_id: stoId,
        movement_type_code: movementTypeCode,
        status: "DRAFT",
        remarks: toTrimmedString(body.remarks) || null,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (grnError || !grn) {
      return procurementErrorResponse(req, ctx, "GRN_CREATE_FAILED", 500, "Unable to create GRN draft.");
    }

    const linePayload: JsonRecord[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      linePayload.push({
        grn_id: grn.id,
        line_number: index + 1,
        ...(await inferGrnLineDefaults(gateEntry, lines[index], gateExit)),
      });
    }

    if (linePayload.length > 0) {
      const { error: lineError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("goods_receipt_line")
        .insert(linePayload);
      if (lineError) {
        return procurementErrorResponse(req, ctx, "GRN_LINE_CREATE_FAILED", 500, "Unable to create GRN lines.");
      }
    }

    return okResponse(await hydrateGrn(String(grn.id)), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GRN_CREATE_FAILED";
    const status = message.includes("REQUIRED") ? 400 : message.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, message, status, message);
  }
}

export async function listGRNsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const vendorId = toTrimmedString(url.searchParams.get("vendor_id"));
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt")
      .select("*")
      .order("grn_date", { ascending: false })
      .limit(limit);

    if (companyId) query = query.eq("company_id", companyId);
    if (status && GRN_STATUSES.has(status)) query = query.eq("status", status);
    if (vendorId) query = query.eq("vendor_id", vendorId);
    if (dateFrom) query = query.gte("grn_date", dateFrom);
    if (dateTo) query = query.lte("grn_date", dateTo);

    const { data, error } = await query;
    if (error) {
      return procurementErrorResponse(req, ctx, "GRN_LIST_FAILED", 500, "Unable to list GRNs.");
    }

    return okResponse({ items: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GRN_LIST_FAILED";
    return procurementErrorResponse(req, ctx, message, 500, message);
  }
}

export async function getGRNHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const grnId = getIdFromPath(req);
    if (!grnId) {
      return procurementErrorResponse(req, ctx, "GRN_ID_REQUIRED", 400, "GRN id is required.");
    }
    return okResponse(await hydrateGrn(grnId), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GRN_FETCH_FAILED";
    const status = message.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, message, status, message);
  }
}

export async function updateGRNDraftHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const grnId = getIdFromPath(req);
    const body = await parseBody(req);
    const { data: grn, error: grnError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt")
      .select("*")
      .eq("id", grnId)
      .single();

    if (grnError || !grn) {
      return procurementErrorResponse(req, ctx, "GRN_NOT_FOUND", 404, "GRN not found.");
    }
    if (toUpperTrimmedString(grn.status) !== "DRAFT") {
      return procurementErrorResponse(req, ctx, "GRN_NOT_DRAFT", 400, "Only DRAFT GRNs can be updated.");
    }

    if (Array.isArray(body.lines)) {
      for (const line of body.lines as JsonRecord[]) {
        const lineId = toTrimmedString(line.id);
        if (!lineId) continue;
        const targetStockType = toUpperTrimmedString(line.target_stock_type);
        if (targetStockType && !STOCK_TYPES.has(targetStockType)) {
          return procurementErrorResponse(req, ctx, "GRN_STOCK_TYPE_INVALID", 400, "Invalid target stock type.");
        }
        const patch = {
          received_qty: parsePositiveNumber(line.received_qty),
          storage_location_id: toTrimmedString(line.storage_location_id) || null,
          batch_lot_number: toTrimmedString(line.batch_lot_number) || null,
          expiry_date: toTrimmedString(line.expiry_date) || null,
          target_stock_type: targetStockType || undefined,
          discrepancy_qty: parseNullableNumber(line.ge_qty) !== null && parsePositiveNumber(line.received_qty) !== null
            ? Number(((parseNullableNumber(line.ge_qty) ?? 0) - (parsePositiveNumber(line.received_qty) ?? 0)).toFixed(6))
            : undefined,
        };

        const { error: lineError } = await serviceRoleClient
          .schema("erp_procurement")
          .from("goods_receipt_line")
          .update(patch)
          .eq("id", lineId)
          .eq("grn_id", grnId);

        if (lineError) {
          return procurementErrorResponse(req, ctx, "GRN_LINE_UPDATE_FAILED", 500, "Unable to update GRN line.");
        }
      }
    }

    const headerPatch: JsonRecord = {
      last_updated_at: new Date().toISOString(),
    };
    const grnDate = toTrimmedString(body.grn_date);
    const postingDate = toTrimmedString(body.posting_date);
    const remarks = toTrimmedString(body.remarks);
    if (grnDate) headerPatch.grn_date = grnDate;
    if (postingDate) headerPatch.posting_date = postingDate;
    if (remarks || body.remarks === null) headerPatch.remarks = remarks || null;

    const { error: headerError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt")
      .update(headerPatch)
      .eq("id", grnId);

    if (headerError) {
      return procurementErrorResponse(req, ctx, "GRN_UPDATE_FAILED", 500, "Unable to update GRN.");
    }

    return okResponse(await hydrateGrn(grnId), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GRN_UPDATE_FAILED";
    const status = message.includes("DRAFT") ? 400 : message.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, message, status, message);
  }
}

export async function postGRNHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const grnId = getIdFromPath(req);
    const { data: grn, error: grnError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt")
      .select("*")
      .eq("id", grnId)
      .single();

    if (grnError || !grn) {
      return procurementErrorResponse(req, ctx, "GRN_NOT_FOUND", 404, "GRN not found.");
    }
    if (toUpperTrimmedString(grn.status) !== "DRAFT") {
      return procurementErrorResponse(req, ctx, "GRN_NOT_DRAFT", 400, "Only DRAFT GRNs can be posted.");
    }

    const { data: lines, error: linesError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt_line")
      .select("*")
      .eq("grn_id", grnId)
      .order("line_number", { ascending: true });

    if (linesError) {
      return procurementErrorResponse(req, ctx, "GRN_LINE_FETCH_FAILED", 500, "Unable to fetch GRN lines.");
    }

    const typedLines = (lines ?? []) as GrnLineRow[];
    for (const line of typedLines) {
      if (!toTrimmedString(line.storage_location_id)) {
        return procurementErrorResponse(req, ctx, "GRN_STORAGE_REQUIRED", 400, "Every GRN line must have storage_location_id before posting.");
      }

      const plantId = await getPlantForLocation(String(grn.company_id), String(line.storage_location_id));
      const postingBlocked = await hasPhysicalInventoryBlock(
        String(line.material_id),
        plantId,
        String(line.storage_location_id),
      );
      if (postingBlocked) {
        return procurementErrorResponse(
          req,
          ctx,
          "MATERIAL_POSTING_BLOCKED",
          409,
          "Material has an active physical inventory count in progress.",
        );
      }

      const material = await fetchMaterial(String(line.material_id));
      const movementTypeCode = toTrimmedString(grn.sto_id) ? "STO_RECEIPT" : "P101";
      const unitValue = parseNullableNumber(line.grn_rate) ?? 0;
      const receivedQty = parsePositiveNumber(line.received_qty) ?? 0;
      const stockTypeCode = toUpperTrimmedString(line.target_stock_type) || (material.qa_required_on_inward ? "QA_STOCK" : "UNRESTRICTED");
      const postingResp = await serviceRoleClient
        .schema("erp_inventory")
        .rpc("post_stock_movement", {
          p_document_number: grn.grn_number,
          p_document_date: grn.grn_date,
          p_posting_date: grn.posting_date,
          p_movement_type_code: movementTypeCode,
          p_company_id: grn.company_id,
          p_plant_id: plantId,
          p_storage_location_id: line.storage_location_id,
          p_material_id: line.material_id,
          p_quantity: receivedQty,
          p_base_uom_code: material.base_uom_code ?? line.uom_code,
          p_unit_value: unitValue,
          p_stock_type_code: stockTypeCode,
          p_direction: "IN",
          p_posted_by: ctx.auth_user_id,
          p_reversal_of_id: null,
        });

      if (postingResp.error || !Array.isArray(postingResp.data) || postingResp.data.length === 0) {
        return procurementErrorResponse(req, ctx, "GRN_POST_RPC_FAILED", 500, "Stock posting RPC failed.");
      }

      const postingRow = postingResp.data[0] as JsonRecord;
      const discrepancyQty = Number(((parseNullableNumber(line.ge_qty) ?? 0) - receivedQty).toFixed(6));
      const { error: lineUpdateError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("goods_receipt_line")
        .update({
          stock_document_id: postingRow.stock_document_id ?? null,
          stock_ledger_id: postingRow.stock_ledger_id ?? null,
          discrepancy_qty: discrepancyQty,
          target_stock_type: stockTypeCode,
        })
        .eq("id", String(line.id));

      if (lineUpdateError) {
        return procurementErrorResponse(req, ctx, "GRN_LINE_POST_UPDATE_FAILED", 500, "Unable to update posted GRN line.");
      }

      const { error: geLineUpdateError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("gate_entry_line")
        .update({
          grn_posted: true,
        })
        .eq("id", String(line.gate_entry_line_id));

      if (geLineUpdateError) {
        return procurementErrorResponse(req, ctx, "GRN_GATE_ENTRY_LINE_UPDATE_FAILED", 500, "Unable to update gate entry line posting state.");
      }

      if (line.po_line_id) {
        await updatePoLineReceipt(String(line.po_line_id), receivedQty);
        const { poLine } = await fetchPoLineBundle(String(line.po_line_id));
        const { error: vmiError } = await serviceRoleClient
          .schema("erp_master")
          .from("vendor_material_info")
          .update({
            last_purchase_price: unitValue,
            last_grn_date: grn.grn_date,
          })
          .eq("id", String(poLine.vendor_material_info_id));
        if (vmiError) {
          return procurementErrorResponse(req, ctx, "GRN_VENDOR_PRICE_UPDATE_FAILED", 500, "Unable to update vendor material info.");
        }
      }

      const materialQaRequired = Boolean(material.qa_required_on_inward);
      if (materialQaRequired || stockTypeCode === "QA_STOCK") {
        await createQaDocumentForLine(ctx, grn as GrnRow, {
          ...line,
          target_stock_type: stockTypeCode,
          received_qty: receivedQty,
        });
      }

      const geLineResp = await serviceRoleClient
        .schema("erp_procurement")
        .from("gate_entry_line")
        .select("csn_id")
        .eq("id", String(line.gate_entry_line_id))
        .maybeSingle();
      if (geLineResp.error) {
        return procurementErrorResponse(req, ctx, "GRN_CSN_LINK_FETCH_FAILED", 500, "Unable to fetch CSN link.");
      }
      const csnId = toTrimmedString(geLineResp.data?.csn_id);
      if (csnId) {
        const { data: csn, error: csnFetchError } = await serviceRoleClient
          .schema("erp_procurement")
          .from("consignment_note")
          .select("id, total_received_qty")
          .eq("id", csnId)
          .single();
        if (csnFetchError || !csn) {
          return procurementErrorResponse(req, ctx, "GRN_CSN_FETCH_FAILED", 500, "Unable to fetch CSN.");
        }
        const totalReceivedQty = parseNullableNumber(csn.total_received_qty) ?? 0;
        const { error: csnUpdateError } = await serviceRoleClient
          .schema("erp_procurement")
          .from("consignment_note")
          .update({
            status: "GRN_DONE",
            grn_id: grnId,
            grn_date: grn.grn_date,
            received_qty: receivedQty,
            total_received_qty: Number((totalReceivedQty + receivedQty).toFixed(6)),
            last_updated_at: new Date().toISOString(),
          })
          .eq("id", csnId);
        if (csnUpdateError) {
          return procurementErrorResponse(req, ctx, "GRN_CSN_UPDATE_FAILED", 500, "Unable to update CSN.");
        }
      }
    }

    const { error: headerUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt")
      .update({
        status: "POSTED",
        posted_by: ctx.auth_user_id,
        posted_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
      })
      .eq("id", grnId);

    if (headerUpdateError) {
      return procurementErrorResponse(req, ctx, "GRN_HEADER_POST_FAILED", 500, "Unable to update GRN posting status.");
    }

    await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry")
      .update({
        status: "GRN_POSTED",
        last_updated_at: new Date().toISOString(),
      })
      .eq("id", String(grn.gate_entry_id));

    return okResponse(await hydrateGrn(grnId), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GRN_POST_FAILED";
    const status = message.includes("REQUIRED") ? 400 : message.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, message, status, message);
  }
}

export async function reverseGRNHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const grnId = getIdFromPath(req);
    const body = await parseBody(req);
    const reversalReason = toTrimmedString(body.reversal_reason);

    if (!reversalReason) {
      return procurementErrorResponse(req, ctx, "GRN_REVERSAL_REASON_REQUIRED", 400, "reversal_reason is required.");
    }

    const { data: grn, error: grnError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt")
      .select("*")
      .eq("id", grnId)
      .single();

    if (grnError || !grn) {
      return procurementErrorResponse(req, ctx, "GRN_NOT_FOUND", 404, "GRN not found.");
    }
    if (toUpperTrimmedString(grn.status) !== "POSTED") {
      return procurementErrorResponse(req, ctx, "GRN_NOT_POSTED", 400, "Only POSTED GRNs can be reversed.");
    }

    const { data: lines, error: linesError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt_line")
      .select("*")
      .eq("grn_id", grnId)
      .order("line_number", { ascending: true });

    if (linesError) {
      return procurementErrorResponse(req, ctx, "GRN_LINE_FETCH_FAILED", 500, "Unable to fetch GRN lines.");
    }

    for (const line of (lines ?? []) as GrnLineRow[]) {
      const material = await fetchMaterial(String(line.material_id));
      const receivedQty = parsePositiveNumber(line.received_qty) ?? 0;
      const stockTypeCode = toUpperTrimmedString(line.target_stock_type) || "UNRESTRICTED";
      const reversalResp = await serviceRoleClient
        .schema("erp_inventory")
        .rpc("post_stock_movement", {
          p_document_number: `${grn.grn_number}-REV`,
          p_document_date: todayIsoDate(),
          p_posting_date: todayIsoDate(),
          p_movement_type_code: "P102",
          p_company_id: grn.company_id,
          p_plant_id: null,
          p_storage_location_id: line.storage_location_id,
          p_material_id: line.material_id,
          p_quantity: receivedQty,
          p_base_uom_code: material.base_uom_code ?? line.uom_code,
          p_unit_value: parseNullableNumber(line.grn_rate) ?? 0,
          p_stock_type_code: stockTypeCode,
          p_direction: "OUT",
          p_posted_by: ctx.auth_user_id,
          p_reversal_of_id: line.stock_document_id,
        });

      if (reversalResp.error) {
        return procurementErrorResponse(req, ctx, "GRN_REVERSE_RPC_FAILED", 500, "Stock reversal RPC failed.");
      }

      if (line.po_line_id) {
        await reversePoLineReceipt(String(line.po_line_id), receivedQty);
      }

      const { error: geLineError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("gate_entry_line")
        .update({
          grn_posted: false,
        })
        .eq("id", String(line.gate_entry_line_id));
      if (geLineError) {
        return procurementErrorResponse(req, ctx, "GRN_REVERSE_GATE_LINE_FAILED", 500, "Unable to reset gate entry line.");
      }

      const geLineResp = await serviceRoleClient
        .schema("erp_procurement")
        .from("gate_entry_line")
        .select("csn_id")
        .eq("id", String(line.gate_entry_line_id))
        .maybeSingle();
      if (geLineResp.error) {
        return procurementErrorResponse(req, ctx, "GRN_REVERSE_CSN_LINK_FAILED", 500, "Unable to fetch CSN link for reversal.");
      }
      const csnId = toTrimmedString(geLineResp.data?.csn_id);
      if (csnId) {
        const { error: csnUpdateError } = await serviceRoleClient
          .schema("erp_procurement")
          .from("consignment_note")
          .update({
            status: "ARRIVED",
            grn_id: null,
            grn_date: null,
            received_qty: null,
            last_updated_at: new Date().toISOString(),
          })
          .eq("id", csnId);
        if (csnUpdateError) {
          return procurementErrorResponse(req, ctx, "GRN_REVERSE_CSN_UPDATE_FAILED", 500, "Unable to reset CSN.");
        }
      }

      const { error: qaDeleteError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("inward_qa_document")
        .delete()
        .eq("grn_id", grnId)
        .eq("grn_line_id", String(line.id));
      if (qaDeleteError) {
        return procurementErrorResponse(req, ctx, "GRN_REVERSE_QA_VOID_FAILED", 500, "Unable to void QA documents.");
      }
    }

    const { error: headerUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt")
      .update({
        status: "REVERSED",
        movement_type_code: "P102",
        reversal_grn_id: grnId,
        reversal_approved_by: ctx.auth_user_id,
        reversal_approved_at: new Date().toISOString(),
        reversal_reason: reversalReason,
        last_updated_at: new Date().toISOString(),
      })
      .eq("id", grnId);

    if (headerUpdateError) {
      return procurementErrorResponse(req, ctx, "GRN_REVERSE_UPDATE_FAILED", 500, "Unable to update GRN reversal status.");
    }

    await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry")
      .update({
        status: "OPEN",
        last_updated_at: new Date().toISOString(),
      })
      .eq("id", String(grn.gate_entry_id));

    return okResponse(await hydrateGrn(grnId), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GRN_REVERSE_FAILED";
    const status = message.includes("REQUIRED") ? 400 : message.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, message, status, message);
  }
}
