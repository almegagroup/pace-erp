/*
 * File-ID: 16.4.1
 * File-Path: supabase/functions/api/_core/procurement/gate_entry.handlers.ts
 * Gate: 16.4
 * Phase: 16
 * Domain: PROCUREMENT
 * Purpose: Implement Gate Entry and inbound Gate Exit handlers.
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
type GateEntryRow = Record<string, unknown>;
type GateEntryLineRow = Record<string, unknown>;
type PurchaseOrderRow = Record<string, unknown>;
type PurchaseOrderLineRow = Record<string, unknown>;
type CsnRow = Record<string, unknown>;

const GE_HEADER_STATUSES = new Set(["OPEN", "GRN_POSTED", "CANCELLED"]);
const GE_TYPES = new Set(["INBOUND_PO", "INBOUND_STO"]);
const OPEN_CSN_STATUSES = ["ORDERED", "IN_TRANSIT", "ARRIVED"];
const OPEN_PO_LINE_STATUSES = new Set(["OPEN", "PARTIALLY_RECEIVED"]);
const BULK_DELIVERY_TYPES = new Set(["BULK", "TANKER"]);

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

  const lineStatus = toUpperTrimmedString(poLine.line_status);
  if (!OPEN_PO_LINE_STATUSES.has(lineStatus)) {
    throw new Error("PO_LINE_NOT_OPEN");
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

function effectiveNetWeight(exitRow: Record<string, unknown>): number | null {
  const override = parseNullableNumber(exitRow.net_weight_override);
  if (override !== null) return override;
  return parseNullableNumber(exitRow.net_weight_calculated);
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

async function hydrateGateEntry(gateEntryId: string): Promise<JsonRecord> {
  const { gateEntry, lines } = await fetchGateEntryBundle(gateEntryId);
  const csnIds = Array.from(
    new Set(
      lines
        .map((line) => toTrimmedString(line.csn_id))
        .filter(Boolean),
    ),
  );

  let csns: CsnRow[] = [];
  if (csnIds.length > 0) {
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select("id, csn_number, status, grn_id, gate_entry_id, gate_entry_date, received_qty")
      .in("id", csnIds);

    if (error) {
      throw new Error("CSN_FETCH_FAILED");
    }
    csns = (data ?? []) as CsnRow[];
  }

  const gateExitResp = await serviceRoleClient
    .schema("erp_procurement")
    .from("gate_exit_inbound")
    .select("*")
    .eq("gate_entry_id", gateEntryId)
    .maybeSingle();

  if (gateExitResp.error) {
    throw new Error("GATE_EXIT_FETCH_FAILED");
  }

  return {
    ...gateEntry,
    lines: lines.map((line) => ({
      ...line,
      linked_csn: csns.find((csn) => String(csn.id) === String(line.csn_id)) ?? null,
    })),
    gate_exit_inbound: gateExitResp.data ?? null,
  };
}

async function upsertCsnArrival(
  csnId: string,
  geDate: string,
  gateEntryId: string,
  qty: number,
): Promise<void> {
  const { data: csn, error: csnError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .select("id, status, total_received_qty")
    .eq("id", csnId)
    .single();

  if (csnError || !csn) {
    throw new Error("CSN_NOT_FOUND");
  }

  const currentStatus = toUpperTrimmedString(csn.status);
  const nextStatus = currentStatus === "IN_TRANSIT" || currentStatus === "ORDERED"
    ? "ARRIVED"
    : currentStatus;
  const totalReceivedQty = parseNullableNumber(csn.total_received_qty) ?? 0;

  const { error: updateError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .update({
      status: nextStatus,
      gate_entry_date: geDate,
      gate_entry_id: gateEntryId,
      received_qty: qty,
      total_received_qty: totalReceivedQty + qty,
      last_updated_at: new Date().toISOString(),
      last_updated_by: null,
    })
    .eq("id", csnId);

  if (updateError) {
    throw new Error("CSN_ARRIVAL_UPDATE_FAILED");
  }
}

function distributeNetWeight(lines: GateEntryLineRow[], totalNetWeight: number): GateEntryLineRow[] {
  if (lines.length === 0) return [];

  const weightBasis = lines.map((line) => {
    const gross = parseNullableNumber(line.gross_weight);
    const qty = parsePositiveNumber(line.ge_qty) ?? 0;
    return gross !== null && gross > 0 ? gross : qty;
  });
  const basisTotal = weightBasis.reduce((sum, value) => sum + value, 0);

  if (basisTotal <= 0) {
    const perLine = totalNetWeight / lines.length;
    return lines.map((line) => ({
      ...line,
      net_weight: Number(perLine.toFixed(6)),
      net_weight_is_manual: true,
    }));
  }

  let allocated = 0;
  return lines.map((line, index) => {
    if (index === lines.length - 1) {
      const remaining = Number((totalNetWeight - allocated).toFixed(6));
      return {
        ...line,
        net_weight: remaining,
        net_weight_is_manual: true,
      };
    }
    const allocatedValue = Number(((totalNetWeight * weightBasis[index]) / basisTotal).toFixed(6));
    allocated += allocatedValue;
    return {
      ...line,
      net_weight: allocatedValue,
      net_weight_is_manual: true,
    };
  });
}

export async function createGateEntryHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const plantId = toTrimmedString(body.plant_id) || null;
    const geDate = toTrimmedString(body.entry_date ?? body.ge_date) || todayIsoDate();
    const vehicleNumber = toTrimmedString(body.vehicle_number);
    const gateStaffId = toTrimmedString(body.gate_staff_id) || ctx.auth_user_id;
    const lines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];

    if (!companyId || !vehicleNumber || !gateStaffId || lines.length === 0) {
      return procurementErrorResponse(req, ctx, "GE_CREATE_INVALID", 400, "Company, vehicle, gate staff, and lines are required.");
    }

    const preparedLines: JsonRecord[] = [];
    let geType = "INBOUND_PO";

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const poLineId = toTrimmedString(line.po_line_id);
      const stoId = toTrimmedString(line.sto_id);
      const stoLineId = toTrimmedString(line.sto_line_id);
      const geQty = parsePositiveNumber(line.ge_qty);
      const uomCode = toTrimmedString(line.uom_code);
      const materialId = toTrimmedString(line.material_id);

      if (!geQty || !uomCode || !materialId) {
        return procurementErrorResponse(req, ctx, "GE_LINE_INVALID", 400, `Line ${index + 1} is missing required quantity, UOM, or material.`);
      }

      if (!poLineId && !stoLineId) {
        return procurementErrorResponse(req, ctx, "GE_LINE_REF_MISSING", 400, `Line ${index + 1} must reference a PO line or STO line.`);
      }

      let poId: string | null = null;
      if (poLineId) {
        const { poLine, po } = await fetchPoLineBundle(poLineId);
        poId = String(poLine.po_id);
        if (String(po.company_id) !== companyId) {
          return procurementErrorResponse(req, ctx, "GE_COMPANY_SCOPE", 403, `PO line on line ${index + 1} is outside company scope.`);
        }
        const deliveryType = toUpperTrimmedString(po.delivery_type);
        if (BULK_DELIVERY_TYPES.has(deliveryType) && parseNullableNumber(line.gross_weight) === null) {
          return procurementErrorResponse(req, ctx, "GE_GROSS_WEIGHT_REQUIRED", 400, `Line ${index + 1} requires gross_weight for BULK/TANKER deliveries.`);
        }
      }

      if (stoId || stoLineId) {
        geType = "INBOUND_STO";
      }

      preparedLines.push({
        line_number: index + 1,
        po_id: poId,
        po_line_id: poLineId || null,
        sto_id: stoId || null,
        sto_line_id: stoLineId || null,
        csn_id: toTrimmedString(line.csn_id) || null,
        material_id: materialId,
        ge_qty: geQty,
        uom_code: uomCode,
        challan_or_invoice_no: toTrimmedString(line.challan_or_invoice_no) || null,
        rst_number: toTrimmedString(line.rst_number) || null,
        gross_weight: parseNullableNumber(line.gross_weight),
        tare_weight: parseNullableNumber(line.tare_weight),
        net_weight: parseNullableNumber(line.net_weight),
        net_weight_is_manual: Boolean(line.net_weight_is_manual),
      });
    }

    if (!GE_TYPES.has(geType)) {
      return procurementErrorResponse(req, ctx, "GE_TYPE_INVALID", 400, "Invalid gate entry type.");
    }

    const geNumber = await generateProcurementDocNumber("GE");
    const { data: gateEntry, error: gateEntryError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry")
      .insert({
        ge_number: geNumber,
        ge_date: geDate,
        company_id: companyId,
        plant_id: plantId,
        ge_type: geType,
        vehicle_number: vehicleNumber,
        driver_name: toTrimmedString(body.driver_name) || null,
        gate_staff_id: gateStaffId,
        status: "OPEN",
        remarks: toTrimmedString(body.remarks) || null,
      })
      .select("*")
      .single();

    if (gateEntryError || !gateEntry) {
      return procurementErrorResponse(req, ctx, "GE_CREATE_FAILED", 500, "Unable to create gate entry.");
    }

    const linePayload = preparedLines.map((line) => ({
      gate_entry_id: gateEntry.id,
      ...line,
    }));
    const { error: linesError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry_line")
      .insert(linePayload);

    if (linesError) {
      return procurementErrorResponse(req, ctx, "GE_LINE_CREATE_FAILED", 500, "Unable to create gate entry lines.");
    }

    for (const line of preparedLines) {
      const csnId = toTrimmedString(line.csn_id);
      if (csnId) {
        await upsertCsnArrival(csnId, geDate, String(gateEntry.id), Number(line.ge_qty));
      }
    }

    return okResponse(await hydrateGateEntry(String(gateEntry.id)), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GE_CREATE_FAILED";
    const status = message.includes("NOT_FOUND") ? 404 : message.includes("REQUIRED") || message.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, message, status, message);
  }
}

export async function listGateEntriesHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry")
      .select("*")
      .order("ge_date", { ascending: false })
      .limit(limit);

    if (companyId) query = query.eq("company_id", companyId);
    if (status && GE_HEADER_STATUSES.has(status)) query = query.eq("status", status);
    if (dateFrom) query = query.gte("ge_date", dateFrom);
    if (dateTo) query = query.lte("ge_date", dateTo);

    const { data, error } = await query;
    if (error) {
      return procurementErrorResponse(req, ctx, "GE_LIST_FAILED", 500, "Unable to list gate entries.");
    }

    return okResponse({ items: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GE_LIST_FAILED";
    return procurementErrorResponse(req, ctx, message, 500, message);
  }
}

export async function getGateEntryHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const gateEntryId = getIdFromPath(req);
    if (!gateEntryId) {
      return procurementErrorResponse(req, ctx, "GE_ID_REQUIRED", 400, "Gate entry id is required.");
    }
    return okResponse(await hydrateGateEntry(gateEntryId), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GE_FETCH_FAILED";
    const status = message.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, message, status, message);
  }
}

export async function updateGateEntryHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const gateEntryId = getIdFromPath(req);
    const body = await parseBody(req);
    const { gateEntry } = await fetchGateEntryBundle(gateEntryId);

    if (toUpperTrimmedString(gateEntry.status) !== "OPEN") {
      return procurementErrorResponse(req, ctx, "GE_NOT_OPEN", 400, "Only OPEN gate entries can be updated.");
    }

    const headerPatch: JsonRecord = {};
    const geDate = toTrimmedString(body.entry_date ?? body.ge_date);
    const vehicleNumber = toTrimmedString(body.vehicle_number);
    const driverName = toTrimmedString(body.driver_name);
    const remarks = toTrimmedString(body.remarks);
    if (geDate) headerPatch.ge_date = geDate;
    if (vehicleNumber) headerPatch.vehicle_number = vehicleNumber;
    if (driverName || body.driver_name === null) headerPatch.driver_name = driverName || null;
    if (remarks || body.remarks === null) headerPatch.remarks = remarks || null;
    headerPatch.last_updated_at = new Date().toISOString();

    const { error: headerError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry")
      .update(headerPatch)
      .eq("id", gateEntryId);

    if (headerError) {
      return procurementErrorResponse(req, ctx, "GE_UPDATE_FAILED", 500, "Unable to update gate entry.");
    }

    if (Array.isArray(body.lines)) {
      const deleteResp = await serviceRoleClient
        .schema("erp_procurement")
        .from("gate_entry_line")
        .delete()
        .eq("gate_entry_id", gateEntryId);
      if (deleteResp.error) {
        return procurementErrorResponse(req, ctx, "GE_LINE_REPLACE_FAILED", 500, "Unable to replace gate entry lines.");
      }

      const lineReq = new Request(req.url, {
        method: "POST",
        body: JSON.stringify({
          company_id: gateEntry.company_id,
          plant_id: gateEntry.plant_id,
          entry_date: geDate || gateEntry.ge_date,
          vehicle_number: vehicleNumber || gateEntry.vehicle_number,
          driver_name: driverName || gateEntry.driver_name,
          gate_staff_id: gateEntry.gate_staff_id,
          remarks: remarks || gateEntry.remarks,
          lines: body.lines,
        }),
        headers: req.headers,
      });

      const createResp = await createGateEntryHandler(lineReq, ctx);
      const createJson = await createResp.json();
      if (!createResp.ok || !createJson?.ok) {
        return procurementErrorResponse(req, ctx, "GE_LINE_REPLACE_FAILED", 500, "Unable to replace gate entry lines.");
      }

      await serviceRoleClient
        .schema("erp_procurement")
        .from("gate_entry")
        .delete()
        .eq("id", String(createJson.data.id));

      const { error: tempLineDeleteError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("gate_entry_line")
        .delete()
        .eq("gate_entry_id", String(createJson.data.id));
      if (tempLineDeleteError) {
        return procurementErrorResponse(req, ctx, "GE_LINE_REPLACE_FAILED", 500, "Unable to finalize gate entry line replacement.");
      }

      const recreatedLines = Array.isArray(createJson.data.lines) ? createJson.data.lines : [];
      if (recreatedLines.length > 0) {
        const { error: insertError } = await serviceRoleClient
          .schema("erp_procurement")
          .from("gate_entry_line")
          .insert(
            recreatedLines.map((line: JsonRecord) => ({
              gate_entry_id: gateEntryId,
              line_number: line.line_number,
              po_id: line.po_id,
              po_line_id: line.po_line_id,
              sto_id: line.sto_id,
              sto_line_id: line.sto_line_id,
              csn_id: line.csn_id,
              material_id: line.material_id,
              ge_qty: line.ge_qty,
              uom_code: line.uom_code,
              challan_or_invoice_no: line.challan_or_invoice_no,
              rst_number: line.rst_number,
              gross_weight: line.gross_weight,
              tare_weight: line.tare_weight,
              net_weight: line.net_weight,
              net_weight_is_manual: line.net_weight_is_manual,
            })),
          );
        if (insertError) {
          return procurementErrorResponse(req, ctx, "GE_LINE_REPLACE_FAILED", 500, "Unable to finalize gate entry line replacement.");
        }
      }
    }

    return okResponse(await hydrateGateEntry(gateEntryId), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GE_UPDATE_FAILED";
    const status = message.includes("NOT_FOUND") ? 404 : message.includes("OPEN") ? 400 : 500;
    return procurementErrorResponse(req, ctx, message, status, message);
  }
}

export async function listOpenCSNsForGEHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select("id, csn_number, status, company_id, po_id, po_line_id, material_id, vendor_id, dispatch_qty, po_qty, po_uom_code")
      .eq("company_id", companyId)
      .in("status", OPEN_CSN_STATUSES)
      .order("created_at", { ascending: false });

    if (error) {
      return procurementErrorResponse(req, ctx, "CSN_OPEN_LIST_FAILED", 500, "Unable to list open CSNs.");
    }

    return okResponse({ items: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "CSN_OPEN_LIST_FAILED";
    return procurementErrorResponse(req, ctx, message, 500, message);
  }
}

export async function createGateExitInboundHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const gateEntryId = toTrimmedString(body.gate_entry_id);
    if (!gateEntryId) {
      return procurementErrorResponse(req, ctx, "GEX_GATE_ENTRY_REQUIRED", 400, "gate_entry_id is required.");
    }

    const { gateEntry, lines } = await fetchGateEntryBundle(gateEntryId);
    const existingResp = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_inbound")
      .select("*")
      .eq("gate_entry_id", gateEntryId)
      .maybeSingle();

    if (existingResp.error) {
      return procurementErrorResponse(req, ctx, "GEX_FETCH_FAILED", 500, "Unable to validate existing gate exit.");
    }
    if (existingResp.data) {
      return procurementErrorResponse(req, ctx, "GEX_ALREADY_EXISTS", 400, "Inbound gate exit already exists for this gate entry.");
    }

    const grossWeightTotal = lines.reduce((sum, line) => sum + (parseNullableNumber(line.gross_weight) ?? 0), 0);
    const tareWeight = parseNullableNumber(body.tare_weight);
    const hasBulkLine = lines.some((line) => parseNullableNumber(line.gross_weight) !== null);
    if (hasBulkLine && tareWeight === null) {
      return procurementErrorResponse(req, ctx, "GEX_TARE_REQUIRED", 400, "tare_weight is required for weighed inbound gate exits.");
    }

    const netCalculated = tareWeight === null ? null : Number((grossWeightTotal - tareWeight).toFixed(6));
    const netOverride = parseNullableNumber(body.net_weight_override);
    const effectiveNet = netOverride ?? netCalculated;

    const exitNumber = await generateProcurementDocNumber("GEX");
    const { data: gateExit, error: gateExitError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_inbound")
      .insert({
        exit_number: exitNumber,
        exit_date: toTrimmedString(body.exit_date) || todayIsoDate(),
        exit_time: toTrimmedString(body.exit_time) || null,
        company_id: gateEntry.company_id,
        plant_id: gateEntry.plant_id,
        gate_entry_id: gateEntryId,
        vehicle_number: toTrimmedString(body.vehicle_number) || gateEntry.vehicle_number,
        driver_name: toTrimmedString(body.driver_name) || gateEntry.driver_name || null,
        gate_staff_id: toTrimmedString(body.gate_staff_id) || ctx.auth_user_id,
        rst_number_tare: toTrimmedString(body.rst_number_tare) || null,
        tare_weight: tareWeight,
        net_weight_calculated: netCalculated,
        net_weight_override: netOverride,
        remarks: toTrimmedString(body.remarks) || null,
      })
      .select("*")
      .single();

    if (gateExitError || !gateExit) {
      return procurementErrorResponse(req, ctx, "GEX_CREATE_FAILED", 500, "Unable to create inbound gate exit.");
    }

    if (effectiveNet !== null) {
      const distributedLines = distributeNetWeight(lines, effectiveNet);
      for (const line of distributedLines) {
        const { error: lineUpdateError } = await serviceRoleClient
          .schema("erp_procurement")
          .from("gate_entry_line")
          .update({
            net_weight: line.net_weight,
            net_weight_is_manual: true,
          })
          .eq("id", String(line.id));
        if (lineUpdateError) {
          return procurementErrorResponse(req, ctx, "GEX_LINE_UPDATE_FAILED", 500, "Unable to write back net weight to gate entry lines.");
        }
      }
    }

    return okResponse(
      {
        ...gateExit,
        effective_net_weight: effectiveNet,
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "GEX_CREATE_FAILED";
    const status = message.includes("REQUIRED") ? 400 : message.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, message, status, message);
  }
}

export async function getGateExitInboundHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const gateExitId = getPathSegments(req)[4] ?? "";
    if (!gateExitId) {
      return procurementErrorResponse(req, ctx, "GEX_ID_REQUIRED", 400, "Gate exit id is required.");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_inbound")
      .select("*")
      .eq("id", gateExitId)
      .single();

    if (error || !data) {
      return procurementErrorResponse(req, ctx, "GEX_NOT_FOUND", 404, "Inbound gate exit not found.");
    }

    return okResponse(
      {
        ...data,
        effective_net_weight: effectiveNetWeight(data),
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "GEX_FETCH_FAILED";
    return procurementErrorResponse(req, ctx, message, 500, message);
  }
}
