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
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { isSameOrHigher } from "../../_shared/role_ladder.ts";

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

const GE_HEADER_STATUSES = new Set(["OPEN", "GRN_POSTED", "CANCELLED", "PRUNED"]);
const GE_TYPES = new Set(["INBOUND_PO", "INBOUND_STO"]);
const OPEN_CSN_STATUSES = ["ORD", "TRN", "GED"];
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

// §112 — must validate, not just resolve a fallback: an explicitly-requested
// companyId that is NOT one of the caller's own erp_map.user_companies rows
// throws COMPANY_SCOPE_VIOLATION rather than being silently honoured.
async function getCompanyScope(ctx: ProcurementHandlerContext, requestedCompanyId?: string): Promise<string> {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  const companyId = toTrimmedString(requestedCompanyId) || scopedCompanyId;
  if (companyId) await assertCompanyScope(ctx, companyId);
  return companyId;
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const diff = Math.abs(new Date(b).getTime() - new Date(a).getTime());
  return Math.round(diff / (1000 * 60 * 60 * 24));
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

async function fetchGateEntryBundle(ctx: ProcurementHandlerContext, gateEntryId: string): Promise<{
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

  await assertCompanyScope(ctx, String((gateEntry as GateEntryRow).company_id));

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

async function hydrateGateEntry(ctx: ProcurementHandlerContext, gateEntryId: string): Promise<JsonRecord> {
  const { gateEntry, lines } = await fetchGateEntryBundle(ctx, gateEntryId);

  const csnIds = Array.from(new Set(lines.map((l) => toTrimmedString(l.csn_id)).filter(Boolean)));
  const matIds = Array.from(new Set(lines.map((l) => toTrimmedString(l.material_id)).filter(Boolean)));

  const [csns, mats, gateExitResp, grnsResp] = await Promise.all([
    csnIds.length > 0
      ? serviceRoleClient.schema("erp_procurement").from("consignment_note")
          .select("id, csn_number, status, grn_id, gate_entry_id, gate_entry_date, received_qty")
          .in("id", csnIds)
      : Promise.resolve({ data: [], error: null }),
    matIds.length > 0
      ? serviceRoleClient.schema("erp_master").from("material_master")
          .select("id, pace_code, material_name")
          .in("id", matIds)
      : Promise.resolve({ data: [], error: null }),
    serviceRoleClient.schema("erp_procurement").from("gate_exit_inbound")
      .select("*").eq("gate_entry_id", gateEntryId).maybeSingle(),
    serviceRoleClient.schema("erp_procurement").from("goods_receipt")
      .select("id, grn_number, status").eq("gate_entry_id", gateEntryId),
  ]);

  if (csns.error) throw new Error("CSN_FETCH_FAILED");
  if (mats.error) throw new Error("MATERIAL_FETCH_FAILED");
  if (gateExitResp.error) throw new Error("GATE_EXIT_FETCH_FAILED");

  const matMap = new Map<string, JsonRecord>();
  for (const m of (mats.data ?? []) as JsonRecord[]) matMap.set(String(m.id), m);

  const linkedGrns = (grnsResp.data ?? []) as JsonRecord[];

  return {
    ...gateEntry,
    lines: lines.map((line) => {
      const mat = matMap.get(String(line.material_id));
      return {
        ...line,
        material_name: mat ? `${mat.pace_code} — ${mat.material_name}` : null,
        linked_csn: (csns.data ?? []).find((csn: JsonRecord) => String(csn.id) === String(line.csn_id)) ?? null,
      };
    }),
    gate_exit_inbound: gateExitResp.data ?? null,
    linked_grns: linkedGrns,
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
  const nextStatus = currentStatus === "TRN" || currentStatus === "ORD"
    ? "GED"
    : currentStatus;
  const totalReceivedQty = parseNullableNumber(csn.total_received_qty) ?? 0;

  const { error: updateError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .update({
      status: nextStatus,
      pre_ge_status: currentStatus,
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
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    const geDate = toTrimmedString(body.entry_date ?? body.ge_date) || todayIsoDate();
    const vehicleNumber = toTrimmedString(body.vehicle_number);
    const gateStaffId = toTrimmedString(body.gate_staff_id) || ctx.auth_user_id;
    const lines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];

    if (!companyId || !vehicleNumber || !gateStaffId || lines.length === 0) {
      return procurementErrorResponse(req, ctx, "GE_CREATE_INVALID", 400, "Company, vehicle, gate staff, and lines are required.");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
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

    // A vehicle cannot open a new gate entry while an earlier gate entry for
    // the same vehicle is still on-site (i.e. has not been gate-exited yet).
    const { data: vehicleGEs, error: vehicleGEsError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry")
      .select("id, ge_number")
      .eq("vehicle_number", vehicleNumber)
      .not("status", "in", '("PRUNED","CANCELLED")');

    if (vehicleGEsError) {
      return procurementErrorResponse(req, ctx, "GE_VEHICLE_CHECK_FAILED", 500, "Unable to validate vehicle gate status.");
    }

    if ((vehicleGEs ?? []).length > 0) {
      const geIds = vehicleGEs.map((g) => String((g as JsonRecord).id));
      const { data: exits, error: exitsError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("gate_exit_inbound")
        .select("gate_entry_id")
        .in("gate_entry_id", geIds);

      if (exitsError) {
        return procurementErrorResponse(req, ctx, "GE_VEHICLE_CHECK_FAILED", 500, "Unable to validate vehicle gate status.");
      }

      const exitedIds = new Set((exits ?? []).map((e) => String((e as JsonRecord).gate_entry_id)));
      const pendingGE = (vehicleGEs as JsonRecord[]).find((g) => !exitedIds.has(String(g.id)));

      if (pendingGE) {
        return procurementErrorResponse(
          req, ctx, "GE_VEHICLE_NOT_EXITED", 400,
          `Vehicle ${vehicleNumber} already has an open gate entry (${pendingGE.ge_number}) that has not been gate-exited yet.`,
        );
      }
    }

    const geNumber = await generateProcurementDocNumber("GE");
    const { data: gateEntry, error: gateEntryError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry")
      .insert({
        ge_number: geNumber,
        ge_date: geDate,
        company_id: companyId,
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

    return okResponse(await hydrateGateEntry(ctx, String(gateEntry.id)), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GE_CREATE_FAILED";
    const status = message.includes("NOT_FOUND") ? 404 : message === "COMPANY_SCOPE_VIOLATION" ? 403 : message.includes("REQUIRED") || message.includes("INVALID") ? 400 : 500;
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
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);
    const offset = parsePositiveInt(url.searchParams.get("offset"), 0);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry")
      .select("*", { count: "exact" })
      .order("ge_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (companyId) query = query.eq("company_id", companyId);
    if (status && GE_HEADER_STATUSES.has(status)) query = query.eq("status", status);
    if (dateFrom) query = query.gte("ge_date", dateFrom);
    if (dateTo) query = query.lte("ge_date", dateTo);

    const { data, error, count } = await query;
    if (error) {
      return procurementErrorResponse(req, ctx, "GE_LIST_FAILED", 500, "Unable to list gate entries.");
    }

    const rows = data ?? [];
    let items = rows as JsonRecord[];

    if (rows.length > 0) {
      const geIds = rows.map((r) => String((r as JsonRecord).id));
      const { data: lineAgg } = await serviceRoleClient
        .schema("erp_procurement")
        .from("gate_entry_line")
        .select("gate_entry_id, ge_qty")
        .in("gate_entry_id", geIds);

      const aggMap = new Map<string, { num_lines: number; total_qty: number }>();
      for (const line of (lineAgg ?? []) as JsonRecord[]) {
        const geid = String(line.gate_entry_id);
        const existing = aggMap.get(geid) ?? { num_lines: 0, total_qty: 0 };
        existing.num_lines += 1;
        existing.total_qty += Number(line.ge_qty ?? 0);
        aggMap.set(geid, existing);
      }

      items = rows.map((r) => {
        const agg = aggMap.get(String((r as JsonRecord).id)) ?? { num_lines: 0, total_qty: 0 };
        return { ...(r as JsonRecord), num_lines: agg.num_lines, total_qty: Number(agg.total_qty.toFixed(6)) };
      });
    }

    return okResponse({ items, total: count ?? items.length, limit, offset }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GE_LIST_FAILED";
    return procurementErrorResponse(req, ctx, message, message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, message);
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
    return okResponse(await hydrateGateEntry(ctx, gateEntryId), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GE_FETCH_FAILED";
    const status = message.includes("NOT_FOUND") ? 404 : message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500;
    return procurementErrorResponse(req, ctx, message, status, message);
  }
}

export async function getGateEntryByNumberHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const geNumber = toTrimmedString(url.searchParams.get("ge_number"));
    if (!geNumber) {
      return procurementErrorResponse(req, ctx, "GE_NUMBER_REQUIRED", 400, "ge_number is required.");
    }

    const { data: gateEntry, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry")
      .select("id")
      .eq("ge_number", geNumber)
      .maybeSingle();

    if (error || !gateEntry) {
      return procurementErrorResponse(req, ctx, "GE_NOT_FOUND", 404, "Gate entry not found.");
    }

    return okResponse(await hydrateGateEntry(ctx, String(gateEntry.id)), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GE_FETCH_FAILED";
    const status = message.includes("NOT_FOUND") ? 404 : message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500;
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
    const { gateEntry } = await fetchGateEntryBundle(ctx, gateEntryId);

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

    return okResponse(await hydrateGateEntry(ctx, gateEntryId), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GE_UPDATE_FAILED";
    const status = message.includes("NOT_FOUND") ? 404 : message === "COMPANY_SCOPE_VIOLATION" ? 403 : message.includes("OPEN") ? 400 : 500;
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
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select(
        "id, csn_number, csn_type, status, company_id, po_id, po_line_id, sto_id, " +
        "material_id, vendor_id, dispatch_qty, po_qty, po_uom_code, " +
        "invoice_number, boe_number, bl_date, lr_date, lr_number, delivery_type"
      )
      .eq("company_id", companyId)
      .in("status", OPEN_CSN_STATUSES)
      .order("created_at", { ascending: false });

    if (error) {
      return procurementErrorResponse(req, ctx, "CSN_OPEN_LIST_FAILED", 500, "Unable to list open CSNs.");
    }

    const csns = data ?? [];
    const matIds = [...new Set(csns.map((c) => c.material_id).filter(Boolean))] as string[];
    const matMap = new Map<string, string>();
    if (matIds.length > 0) {
      const { data: mats } = await serviceRoleClient
        .schema("erp_master")
        .from("material_master")
        .select("id, material_name")
        .in("id", matIds);
      for (const m of mats ?? []) matMap.set(String(m.id), String(m.material_name ?? ""));
    }
    const items = csns.map((c) => ({ ...c, material_name: matMap.get(String(c.material_id)) ?? null }));

    return okResponse({ items }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "CSN_OPEN_LIST_FAILED";
    return procurementErrorResponse(req, ctx, message, message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, message);
  }
}

export async function listOpenPOsForGEHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);

    const { data: pos, error: posError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order")
      .select("id, po_number, delivery_type, vendor_id, status, company_id")
      .eq("company_id", companyId)
      .in("status", ["CONFIRMED", "PARTIALLY_RECEIVED"])
      .order("created_at", { ascending: false });

    if (posError) {
      return procurementErrorResponse(req, ctx, "PO_OPEN_LIST_FAILED", 500, "Unable to list open POs.");
    }

    const poIds = (pos ?? []).map((p) => String(p.id));
    let lines: JsonRecord[] = [];
    if (poIds.length > 0) {
      const { data: lineData, error: lineError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("purchase_order_line")
        .select("id, po_id, material_id, po_uom_code, line_status")
        .in("po_id", poIds)
        .in("line_status", ["OPEN", "PARTIALLY_RECEIVED"]);

      if (!lineError) {
        lines = (lineData ?? []) as JsonRecord[];
      }
    }

    const lineMatIds = [...new Set(lines.map((l) => l.material_id).filter(Boolean))] as string[];
    const lineMatMap = new Map<string, string>();
    if (lineMatIds.length > 0) {
      const { data: mats } = await serviceRoleClient
        .schema("erp_master")
        .from("material_master")
        .select("id, material_name")
        .in("id", lineMatIds);
      for (const m of mats ?? []) lineMatMap.set(String(m.id), String(m.material_name ?? ""));
    }

    const linesMap = new Map<string, JsonRecord[]>();
    for (const line of lines) {
      const poId = String(line.po_id);
      if (!linesMap.has(poId)) linesMap.set(poId, []);
      linesMap.get(poId)!.push({ ...line, material_name: lineMatMap.get(String(line.material_id)) ?? null });
    }

    const result = (pos ?? []).map((po) => ({
      ...po,
      lines: linesMap.get(String(po.id)) ?? [],
    }));

    return okResponse({ items: result }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "PO_OPEN_LIST_FAILED";
    return procurementErrorResponse(req, ctx, message, message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, message);
  }
}

// §111 (2026-07-25) — mirrors listOpenPOsForGEHandler exactly, but for
// INTER_PLANT STOs: Gate Entry today could only search by PO number, so an
// STO-originated shipment (no po_id at all) had no way to be found at the
// gate. GE happens at the RECEIVING company, so this filters on
// receiving_company_id (not sending_company_id).
export async function listOpenSTOsForGEHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);

    const { data: stos, error: stosError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .select("id, sto_number, sto_type, sending_company_id, receiving_company_id, status")
      .eq("receiving_company_id", companyId)
      .in("status", ["CREATED", "DISPATCHED"])
      .order("created_at", { ascending: false });

    if (stosError) {
      return procurementErrorResponse(req, ctx, "STO_OPEN_LIST_FAILED", 500, "Unable to list open STOs.");
    }

    const stoIds = (stos ?? []).map((s) => String(s.id));
    let lines: JsonRecord[] = [];
    if (stoIds.length > 0) {
      const { data: lineData, error: lineError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("stock_transfer_order_line")
        .select("id, sto_id, material_id, uom_code, line_status")
        .in("sto_id", stoIds)
        .eq("line_status", "OPEN");

      if (!lineError) {
        lines = (lineData ?? []) as JsonRecord[];
      }
    }

    const lineMatIds = [...new Set(lines.map((l) => l.material_id).filter(Boolean))] as string[];
    const lineMatMap = new Map<string, string>();
    if (lineMatIds.length > 0) {
      const { data: mats } = await serviceRoleClient
        .schema("erp_master")
        .from("material_master")
        .select("id, material_name")
        .in("id", lineMatIds);
      for (const m of mats ?? []) lineMatMap.set(String(m.id), String(m.material_name ?? ""));
    }

    const linesMap = new Map<string, JsonRecord[]>();
    for (const line of lines) {
      const stoId = String(line.sto_id);
      if (!linesMap.has(stoId)) linesMap.set(stoId, []);
      linesMap.get(stoId)!.push({ ...line, material_name: lineMatMap.get(String(line.material_id)) ?? null });
    }

    const result = (stos ?? []).map((sto) => ({
      ...sto,
      lines: linesMap.get(String(sto.id)) ?? [],
    }));

    return okResponse({ items: result }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "STO_OPEN_LIST_FAILED";
    return procurementErrorResponse(req, ctx, message, message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, message);
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

    const { gateEntry, lines } = await fetchGateEntryBundle(ctx, gateEntryId);
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
      const lineUpdateErrors = await Promise.all(
        distributedLines.map(async (line) => {
          const { error: lineUpdateError } = await serviceRoleClient
            .schema("erp_procurement")
            .from("gate_entry_line")
            .update({
              net_weight: line.net_weight,
              net_weight_is_manual: true,
            })
            .eq("id", String(line.id));
          return lineUpdateError;
        }),
      );
      if (lineUpdateErrors.some(Boolean)) {
        return procurementErrorResponse(req, ctx, "GEX_LINE_UPDATE_FAILED", 500, "Unable to write back net weight to gate entry lines.");
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
    const status = message.includes("REQUIRED") ? 400 : message.includes("NOT_FOUND") ? 404 : message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500;
    return procurementErrorResponse(req, ctx, message, status, message);
  }
}

export async function pruneGateEntryHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    // Prune shares its ACL action (PROC_GRN_LIST:WRITE) with plain GRN
    // creation, which every Stores rank needs — so the L3_USER+ ceiling for
    // Prune specifically can't be expressed at the ACL layer and is
    // enforced here instead. isSameOrHigher naturally lets SA/GA/DIRECTOR/
    // Managers through too; ACL's own department gate (Stores-only) already
    // keeps this from reaching unrelated departments.
    if (!isSameOrHigher(ctx.roleCode, "L3_USER")) {
      return procurementErrorResponse(req, ctx, "GE_PRUNE_RANK_REQUIRED", 403, "L3_USER rank or higher is required to prune a gate entry.");
    }
    const gateEntryId = getPathSegments(req)[3] ?? "";
    if (!gateEntryId) {
      return procurementErrorResponse(req, ctx, "GE_ID_REQUIRED", 400, "Gate entry id is required.");
    }

    const { gateEntry, lines } = await fetchGateEntryBundle(ctx, gateEntryId);
    const geStatus = toUpperTrimmedString(gateEntry.status);

    if (geStatus === "PRUNED") {
      return procurementErrorResponse(req, ctx, "GE_ALREADY_PRUNED", 400, "Gate entry is already pruned.");
    }
    if (geStatus === "CANCELLED") {
      return procurementErrorResponse(req, ctx, "GE_CANCELLED", 400, "Cannot prune a cancelled gate entry.");
    }

    // Check all linked GRNs are reversed
    const { data: grns, error: grnError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt")
      .select("id, grn_number, status")
      .eq("gate_entry_id", gateEntryId);

    if (grnError) {
      return procurementErrorResponse(req, ctx, "GE_PRUNE_GRN_CHECK_FAILED", 500, "Unable to check linked GRNs.");
    }

    const blockedGrns = (grns ?? []).filter((g) => toUpperTrimmedString((g as JsonRecord).status) !== "REVERSED");
    if (blockedGrns.length > 0) {
      const nums = blockedGrns.map((g) => (g as JsonRecord).grn_number).join(", ");
      return procurementErrorResponse(
        req, ctx, "GE_PRUNE_BLOCKED_BY_GRN", 400,
        `Reverse all GRNs before pruning. Pending: ${nums}`
      );
    }

    // Release linked CSNs back to open
    const csnIds = Array.from(new Set(lines.map((l) => toTrimmedString(l.csn_id)).filter(Boolean)));
    if (csnIds.length > 0) {
      const { data: csnRows, error: csnLookupError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("consignment_note")
        .select("id, pre_ge_status")
        .in("id", csnIds);
      if (csnLookupError) {
        return procurementErrorResponse(req, ctx, "GE_PRUNE_FAILED", 500, "Unable to restore linked CSN status.");
      }

      const nowIso = new Date().toISOString();
      const csnIdsByStatus = new Map<string, string[]>();
      for (const csn of (csnRows ?? []) as JsonRecord[]) {
        const restoreStatus = toUpperTrimmedString(csn.pre_ge_status) || "ORD";
        const groupedIds = csnIdsByStatus.get(restoreStatus) ?? [];
        groupedIds.push(String(csn.id));
        csnIdsByStatus.set(restoreStatus, groupedIds);
      }
      const restoreErrors = await Promise.all(
        Array.from(csnIdsByStatus.entries()).map(async ([restoreStatus, groupedIds]) => {
          const { error: restoreError } = await serviceRoleClient
            .schema("erp_procurement")
            .from("consignment_note")
            .update({
              status: restoreStatus,
              pre_ge_status: null,
              gate_entry_id: null,
              gate_entry_date: null,
              last_updated_at: nowIso,
            })
            .in("id", groupedIds);
          return restoreError;
        }),
      );
      if (restoreErrors.some(Boolean)) {
        return procurementErrorResponse(req, ctx, "GE_PRUNE_FAILED", 500, "Unable to restore linked CSN status.");
      }
    }

    // Mark GE as PRUNED
    const { error: pruneError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry")
      .update({ status: "PRUNED", last_updated_at: new Date().toISOString() })
      .eq("id", gateEntryId);

    if (pruneError) {
      return procurementErrorResponse(req, ctx, "GE_PRUNE_FAILED", 500, "Unable to prune gate entry.");
    }

    return okResponse(await hydrateGateEntry(ctx, gateEntryId), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GE_PRUNE_FAILED";
    return procurementErrorResponse(req, ctx, message, message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, message);
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
    return procurementErrorResponse(req, ctx, message, message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, message);
  }
}

export async function gateReportHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const geType = toUpperTrimmedString(url.searchParams.get("ge_type"));
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const vendorId = toTrimmedString(url.searchParams.get("vendor_id"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 200);
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));

    // 1. Gate entry lines with GE header
    let lineQuery = serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry_line")
      .select("id, gate_entry_id, line_number, material_id, ge_qty, uom_code, gross_weight, net_weight, csn_id, po_id")
      .range(offset, offset + limit - 1);

    // Subfilter via gate_entry using inner join approach
    // We'll fetch gate_entries first, then filter lines
    let geQuery = serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry")
      .select("id, ge_number, ge_date, company_id, ge_type, status, remarks, vehicle_number")
      .order("ge_date", { ascending: false });

    if (companyId) geQuery = geQuery.eq("company_id", companyId);
    if (dateFrom) geQuery = geQuery.gte("ge_date", dateFrom);
    if (dateTo) geQuery = geQuery.lte("ge_date", dateTo);
    if (geType) geQuery = geQuery.eq("ge_type", geType);
    if (status) geQuery = geQuery.eq("status", status);

    const { data: geRows, error: geError } = await geQuery;
    if (geError) return procurementErrorResponse(req, ctx, "GATE_REPORT_GE_FAILED", 500, "Unable to fetch gate entries.");

    const geList = (geRows ?? []) as JsonRecord[];
    if (geList.length === 0) return okResponse({ items: [], total: 0 }, ctx.request_id, req);

    const geIds = geList.map((g) => String(g.id));
    const geMap = new Map(geList.map((g) => [String(g.id), g]));

    // 2. Lines for these GEs
    const { data: lineRows, error: lineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry_line")
      .select("id, gate_entry_id, line_number, material_id, ge_qty, uom_code, gross_weight, net_weight")
      .in("gate_entry_id", geIds);

    if (lineError) return procurementErrorResponse(req, ctx, "GATE_REPORT_LINE_FAILED", 500, "Unable to fetch gate entry lines.");
    const lines = (lineRows ?? []) as JsonRecord[];
    const lineIds = lines.map((l) => String(l.id));

    // 3. Gate exits (one per GE)
    const { data: gexRows } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_inbound")
      .select("id, gate_entry_id, exit_number, exit_date, tare_weight, net_weight_calculated, remarks")
      .in("gate_entry_id", geIds);
    const gexMap = new Map(
      ((gexRows ?? []) as JsonRecord[]).map((g) => [String(g.gate_entry_id), g])
    );

    // 4. GRNs per line
    const { data: grnRows } = lineIds.length > 0
      ? await serviceRoleClient
          .schema("erp_procurement")
          .from("goods_receipt")
          .select("id, gate_entry_line_id, grn_number, grn_date, vendor_id, invoice_number")
          .in("gate_entry_line_id", lineIds)
      : { data: [] };
    const grnByLineMap = new Map(
      ((grnRows ?? []) as JsonRecord[]).map((g) => [String(g.gate_entry_line_id), g])
    );

    // 5. Bulk resolve
    const materialIds = [...new Set(lines.map((l) => String(l.material_id ?? "")).filter(Boolean))];
    const vendorIds = [...new Set(((grnRows ?? []) as JsonRecord[]).map((g) => String(g.vendor_id ?? "")).filter(Boolean))];
    const companyIds = [...new Set(geList.map((g) => String(g.company_id ?? "")).filter(Boolean))];

    const [matResp, vendorResp, companyResp] = await Promise.all([
      materialIds.length > 0
        ? serviceRoleClient.schema("erp_master").from("material_master")
            .select("id, pace_code, material_name").in("id", materialIds)
        : { data: [] },
      vendorIds.length > 0
        ? serviceRoleClient.schema("erp_master").from("vendor_master")
            .select("id, vendor_code, vendor_name").in("id", vendorIds)
        : { data: [] },
      companyIds.length > 0
        ? serviceRoleClient.schema("erp_master").from("companies")
            .select("id, company_code, company_name").in("id", companyIds)
        : { data: [] },
    ]);

    const matMap = new Map(((matResp.data ?? []) as JsonRecord[]).map((m) => [String(m.id), m]));
    const vendorMap = new Map(((vendorResp.data ?? []) as JsonRecord[]).map((v) => [String(v.id), v]));
    const companyMap = new Map(((companyResp.data ?? []) as JsonRecord[]).map((c) => [String(c.id), c]));

    // 6. Vendor filter (post-resolve, since vendor comes from GRN)
    const items: JsonRecord[] = [];
    for (const line of lines) {
      const ge = geMap.get(String(line.gate_entry_id));
      if (!ge) continue;
      const gex = gexMap.get(String(line.gate_entry_id)) ?? null;
      const grn = grnByLineMap.get(String(line.id)) ?? null;
      const mat = matMap.get(String(line.material_id));
      const vendor = grn ? vendorMap.get(String((grn as JsonRecord).vendor_id)) : null;
      const company = companyMap.get(String(ge.company_id));

      if (vendorId && String((grn as JsonRecord | null)?.vendor_id) !== vendorId) continue;

      const geDate = String(ge.ge_date ?? "");
      const grnDate = grn ? String((grn as JsonRecord).grn_date ?? "") : null;
      const gexDate = gex ? String((gex as JsonRecord).exit_date ?? "") : null;

      items.push({
        ge_number: ge.ge_number,
        company_code: company?.company_code ?? null,
        ge_date: geDate,
        ge_type: ge.ge_type,
        ge_status: ge.status,
        ge_remarks: ge.remarks ?? null,
        vehicle_number: ge.vehicle_number ?? null,
        line_number: line.line_number,
        material_code: mat?.pace_code ?? null,
        material_name: mat?.material_name ?? null,
        ge_qty: line.ge_qty,
        uom_code: line.uom_code,
        gross_weight: line.gross_weight ?? null,
        net_weight: line.net_weight ?? null,
        vendor_code: vendor?.vendor_code ?? null,
        vendor_name: vendor?.vendor_name ?? null,
        grn_number: grn ? (grn as JsonRecord).grn_number : null,
        grn_date: grnDate,
        invoice_number: grn ? (grn as JsonRecord).invoice_number ?? null : null,
        gex_number: gex ? (gex as JsonRecord).exit_number : null,
        gex_date: gexDate,
        tare_weight: gex ? (gex as JsonRecord).tare_weight : null,
        net_weight_calculated: gex ? (gex as JsonRecord).net_weight_calculated : null,
        gex_remarks: gex ? (gex as JsonRecord).remarks : null,
        days_ge_to_gex: daysBetween(geDate, gexDate),
        days_ge_to_grn: daysBetween(geDate, grnDate),
      });
    }

    return okResponse({ items, total: items.length }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GATE_REPORT_FAILED";
    return procurementErrorResponse(req, ctx, message, message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, message);
  }
}
