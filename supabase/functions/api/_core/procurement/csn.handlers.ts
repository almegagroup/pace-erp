/*
 * File-ID: 16.3.1
 * File-Path: supabase/functions/api/_core/procurement/csn.handlers.ts
 * Gate: 16.3
 * Phase: 16
 * Domain: PROCUREMENT
 * Purpose: Implement CSN CRUD, ETA cascade, alerts, and tracker handlers.
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
type CsnRow = Record<string, unknown>;

const EDITABLE_CSN_STATUSES = new Set(["ORDERED", "IN_TRANSIT"]);
const READONLY_CSN_STATUSES = new Set(["ARRIVED", "GRN_DONE"]);
const DATE_FIELDS = new Set([
  "scheduled_eta_to_port",
  "etd",
  "bl_date",
  "eta_at_port",
  "ata_at_port",
  "post_clearance_lr_date",
  "lr_date",
  "gate_entry_date",
]);
const TRACKER_INLINE_FIELDS = new Set([
  "lr_number",
  "lr_number_port_to_plant",
  "transporter_id",
  "domestic_transporter_id",
  "vessel_name",
  "voyage_number",
  "bl_number",
  "scheduled_eta_to_port",
  "etd",
  "bl_date",
  "eta_at_port",
  "ata_at_port",
  "post_clearance_lr_date",
  "lr_date",
  "gate_entry_date",
  "vessel_booking_confirmed_date",
  "lc_opened_date",
  "lc_number",
]);
const MOTHER_PROPAGATION_FIELDS = [
  "port_of_loading",
  "port_of_discharge_id",
  "vessel_name",
  "voyage_number",
  "bl_number",
  "scheduled_eta_to_port",
  "etd",
  "etd_is_manual_override",
  "bl_date",
  "eta_at_port",
  "eta_at_port_is_manual_override",
  "ata_at_port",
];

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

function parseNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function addDays(input: string, days: number): string {
  const date = new Date(`${input}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function subtractDays(input: string, days: number): string {
  return addDays(input, -days);
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

function getSubIdFromPath(req: Request): string {
  return getPathSegments(req)[5] ?? "";
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

async function generateProcurementDocNumber(docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("generate_doc_number", { p_doc_type: docType });

  if (error || !data) {
    throw new Error("PROCUREMENT_DOC_NUMBER_FAILED");
  }

  return String(data);
}

async function getCsnById(id: string, companyId?: string): Promise<CsnRow | null> {
  let query = serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .select("*")
    .eq("id", id);

  if (companyId) {
    query = query.eq("company_id", companyId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error("PROCUREMENT_CSN_LOOKUP_FAILED");
  }
  return (data as CsnRow | null) ?? null;
}

async function getCompanyScopedCompanyId(
  ctx: ProcurementHandlerContext,
  bodyOrQueryCompanyId?: string,
): Promise<string> {
  return toTrimmedString(bodyOrQueryCompanyId) || toTrimmedString(ctx.context.companyId);
}

async function getImportLeadTime(csn: CsnRow): Promise<Record<string, unknown> | null> {
  const vendorId = toTrimmedString(csn.vendor_id);
  const materialCategoryId = toTrimmedString(csn.material_category_id);
  const dischargePortId = toTrimmedString(csn.port_of_discharge_id);
  if (!vendorId || !materialCategoryId || !dischargePortId) {
    return null;
  }

  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("lead_time_master_import")
    .select("*")
    .eq("vendor_id", vendorId)
    .eq("material_category_id", materialCategoryId)
    .eq("port_of_discharge_id", dischargePortId)
    .eq("active", true)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_IMPORT_LEAD_TIME_LOOKUP_FAILED");
  }
  return (data as Record<string, unknown> | null) ?? null;
}

async function getDomesticLeadTime(csn: CsnRow): Promise<Record<string, unknown> | null> {
  const vendorId = toTrimmedString(csn.vendor_id);
  const companyId = toTrimmedString(csn.company_id);
  if (!vendorId || !companyId) {
    return null;
  }

  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("lead_time_master_domestic")
    .select("*")
    .eq("vendor_id", vendorId)
    .eq("company_id", companyId)
    .eq("active", true)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_DOMESTIC_LEAD_TIME_LOOKUP_FAILED");
  }
  return (data as Record<string, unknown> | null) ?? null;
}

async function getPortPlantTransit(csn: CsnRow): Promise<Record<string, unknown> | null> {
  const portId = toTrimmedString(csn.port_of_discharge_id);
  const companyId = toTrimmedString(csn.company_id);
  if (!portId || !companyId) {
    return null;
  }

  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("port_plant_transit_master")
    .select("*")
    .eq("port_id", portId)
    .eq("company_id", companyId)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_PORT_TRANSIT_LOOKUP_FAILED");
  }
  return (data as Record<string, unknown> | null) ?? null;
}

function calculateETACascade(
  csn: CsnRow,
  importLeadTime: Record<string, unknown> | null,
  domesticLeadTime: Record<string, unknown> | null,
  portPlantTransit: Record<string, unknown> | null,
  poDate?: string | null,
): Partial<CsnRow> {
  const updates: Partial<CsnRow> = {};
  const csnType = toUpperTrimmedString(csn.csn_type);

  if (csnType === "IMPORT") {
    const sailTime = Number(importLeadTime?.sail_time_days ?? 0);
    const clearanceDays = Number(importLeadTime?.clearance_days ?? 0);
    const portTransitDays = Number(portPlantTransit?.transit_days ?? 0);
    const etd = toTrimmedString(csn.etd);
    const blDate = toTrimmedString(csn.bl_date);
    const etaAtPortManual = csn.eta_at_port_is_manual_override === true;
    const etdManual = csn.etd_is_manual_override === true;
    const scheduledEtaToPort = toTrimmedString(csn.scheduled_eta_to_port);
    const ataAtPort = toTrimmedString(csn.ata_at_port);
    const postClearanceLrDate = toTrimmedString(csn.post_clearance_lr_date);
    const gateEntryDate = toTrimmedString(csn.gate_entry_date);

    if (!etdManual && scheduledEtaToPort && sailTime >= 0) {
      updates.etd = subtractDays(scheduledEtaToPort, sailTime);
    }

    const portSourceDate = blDate || etd || toTrimmedString(updates.etd);
    if (!etaAtPortManual && portSourceDate) {
      updates.eta_at_port = addDays(portSourceDate, sailTime);
    }

    const effectiveEtaAtPort = toTrimmedString(updates.eta_at_port) || toTrimmedString(csn.eta_at_port) || scheduledEtaToPort;
    let etaToPlant: string | null = null;

    if (gateEntryDate) {
      etaToPlant = gateEntryDate;
    } else if (postClearanceLrDate) {
      etaToPlant = addDays(postClearanceLrDate, portTransitDays);
    } else if (ataAtPort) {
      etaToPlant = addDays(ataAtPort, clearanceDays + portTransitDays);
    } else if (effectiveEtaAtPort) {
      etaToPlant = addDays(effectiveEtaAtPort, clearanceDays + portTransitDays);
    } else if (scheduledEtaToPort) {
      etaToPlant = addDays(scheduledEtaToPort, clearanceDays + portTransitDays);
    }

    if (etaToPlant) {
      updates.eta_to_plant_calculated = etaToPlant;
    }

    const effectiveEtd = toTrimmedString(updates.etd) || etd;
    if (effectiveEtd) {
      updates.lc_due_date = subtractDays(effectiveEtd, 10);
    }
  } else if (csnType === "DOMESTIC") {
    const transitDays = Number(domesticLeadTime?.transit_days ?? 0);
    const lrDate = toTrimmedString(csn.lr_date);
    const sourceDate = lrDate || toTrimmedString(poDate);
    if (sourceDate) {
      updates.eta_to_plant_calculated = addDays(sourceDate, transitDays);
    }
  } else {
    const gateEntryDate = toTrimmedString(csn.gate_entry_date);
    if (gateEntryDate) {
      updates.eta_to_plant_calculated = gateEntryDate;
    }
  }

  return updates;
}

async function getPoDate(poId: string): Promise<string | null> {
  if (!poId) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order")
    .select("po_date")
    .eq("id", poId)
    .maybeSingle();
  if (error) {
    throw new Error("PROCUREMENT_PO_LOOKUP_FAILED");
  }
  return toTrimmedString(data?.po_date) || null;
}

async function recalculateAndBuildUpdates(
  csn: CsnRow,
  inputUpdates: JsonRecord,
): Promise<JsonRecord> {
  const merged = { ...csn, ...inputUpdates };
  const poDate = await getPoDate(toTrimmedString(merged.po_id));
  const importLeadTime = await getImportLeadTime(merged);
  const domesticLeadTime = await getDomesticLeadTime(merged);
  const portPlantTransit = await getPortPlantTransit(merged);
  const cascade = calculateETACascade(merged, importLeadTime, domesticLeadTime, portPlantTransit, poDate);
  return { ...inputUpdates, ...cascade };
}

async function syncSubCsnsFromMother(motherId: string, updates: JsonRecord): Promise<void> {
  const subUpdates: JsonRecord = {};
  for (const field of MOTHER_PROPAGATION_FIELDS) {
    if (updates[field] !== undefined) {
      subUpdates[field] = updates[field];
    }
  }

  if (Object.keys(subUpdates).length === 0) {
    return;
  }

  subUpdates.last_updated_at = new Date().toISOString();

  const { error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .update(subUpdates)
    .eq("mother_csn_id", motherId);

  if (error) {
    throw new Error("PROCUREMENT_SUB_CSN_SYNC_FAILED");
  }
}

async function enrichTrackerRows(rows: CsnRow[]): Promise<CsnRow[]> {
  if (rows.length === 0) {
    return [];
  }

  const poIds = [...new Set(rows.map((row) => toTrimmedString(row.po_id)).filter(Boolean))];
  const vendorIds = [...new Set(rows.map((row) => toTrimmedString(row.vendor_id)).filter(Boolean))];
  const materialIds = [...new Set(rows.map((row) => toTrimmedString(row.material_id)).filter(Boolean))];
  const transporterIds = [...new Set([
    ...rows.map((row) => toTrimmedString(row.transporter_id)),
    ...rows.map((row) => toTrimmedString(row.domestic_transporter_id)),
  ].filter(Boolean))];

  const [poResult, vendorResult, materialResult, transporterResult] = await Promise.all([
    poIds.length
      ? serviceRoleClient.schema("erp_procurement").from("purchase_order").select("id, po_number, po_date").in("id", poIds)
      : Promise.resolve({ data: [], error: null }),
    vendorIds.length
      ? serviceRoleClient.schema("erp_master").from("vendor_master").select("id, vendor_name, name").in("id", vendorIds)
      : Promise.resolve({ data: [], error: null }),
    materialIds.length
      ? serviceRoleClient.schema("erp_master").from("material_master").select("id, material_name").in("id", materialIds)
      : Promise.resolve({ data: [], error: null }),
    transporterIds.length
      ? serviceRoleClient.schema("erp_master").from("transporter_master").select("id, transporter_name").in("id", transporterIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (poResult.error || vendorResult.error || materialResult.error || transporterResult.error) {
    throw new Error("PROCUREMENT_TRACKER_ENRICH_FAILED");
  }

  const poMap = new Map((poResult.data ?? []).map((row: Record<string, unknown>) => [toTrimmedString(row.id), row]));
  const vendorMap = new Map((vendorResult.data ?? []).map((row: Record<string, unknown>) => [toTrimmedString(row.id), row]));
  const materialMap = new Map((materialResult.data ?? []).map((row: Record<string, unknown>) => [toTrimmedString(row.id), row]));
  const transporterMap = new Map((transporterResult.data ?? []).map((row: Record<string, unknown>) => [toTrimmedString(row.id), row]));

  return rows.map((row) => {
    const po = poMap.get(toTrimmedString(row.po_id));
    const vendor = vendorMap.get(toTrimmedString(row.vendor_id));
    const material = materialMap.get(toTrimmedString(row.material_id));
    const transporter = transporterMap.get(
      toTrimmedString(row.transporter_id) || toTrimmedString(row.domestic_transporter_id),
    );
    return {
      ...row,
      po_number: po?.po_number ?? null,
      po_date: po?.po_date ?? null,
      vendor_name: vendor?.vendor_name ?? vendor?.name ?? null,
      material_name: material?.material_name ?? null,
      transporter_name: transporter?.transporter_name ?? row.transporter_name_freetext ?? row.domestic_transporter_freetext ?? null,
      actual_arrival_date: row.gate_entry_date ?? row.ata_at_port ?? null,
      eta_plant: row.eta_to_plant_calculated ?? null,
    };
  });
}

export async function listCSNsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await getCompanyScopedCompanyId(ctx, url.searchParams.get("company_id") ?? "");
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const csnType = toUpperTrimmedString(url.searchParams.get("csn_type"));
    const poId = toTrimmedString(url.searchParams.get("po_id"));
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);
    const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq("status", status);
    if (csnType) query = query.eq("csn_type", csnType);
    if (poId) query = query.eq("po_id", poId);
    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);

    const { data, error, count } = await query;
    if (error) {
      throw new Error("PROCUREMENT_CSN_LIST_FAILED");
    }

    return okResponse({ data: data ?? [], total: count ?? 0 }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CSN_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "CSN list failed");
  }
}

export async function getCSNHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const id = getIdFromPath(req);
    const companyId = await getCompanyScopedCompanyId(ctx);
    const csn = await getCsnById(id, companyId);
    if (!csn) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_NOT_FOUND", 404, "CSN not found");
    }

    const gateEntryLineResult = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry_line")
      .select("*")
      .eq("csn_id", id);

    if (gateEntryLineResult.error) {
      throw new Error("PROCUREMENT_CSN_DETAIL_FAILED");
    }

    const gateEntryIds = [...new Set((gateEntryLineResult.data ?? []).map((row) => toTrimmedString((row as Record<string, unknown>).gate_entry_id)).filter(Boolean))];
    const gateEntryResult = gateEntryIds.length
      ? await serviceRoleClient.schema("erp_procurement").from("gate_entry").select("*").in("id", gateEntryIds)
      : { data: [], error: null };
    if (gateEntryResult.error) {
      throw new Error("PROCUREMENT_CSN_DETAIL_FAILED");
    }

    const grnResult = toTrimmedString(csn.grn_id)
      ? await serviceRoleClient.schema("erp_procurement").from("goods_receipt").select("*").eq("id", toTrimmedString(csn.grn_id)).maybeSingle()
      : { data: null, error: null };
    if (grnResult.error) {
      throw new Error("PROCUREMENT_CSN_DETAIL_FAILED");
    }

    return okResponse({
      data: {
        ...csn,
        gate_entry_lines: gateEntryLineResult.data ?? [],
        gate_entries: gateEntryResult.data ?? [],
        grn: grnResult.data ?? null,
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CSN_DETAIL_FAILED";
    const status = code === "PROCUREMENT_CSN_NOT_FOUND" ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CSN detail failed");
  }
}

export async function updateCSNHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const id = getIdFromPath(req);
    const body = await parseBody(req);
    const companyId = await getCompanyScopedCompanyId(ctx, toTrimmedString(body.company_id));
    const csn = await getCsnById(id, companyId);
    if (!csn) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_NOT_FOUND", 404, "CSN not found");
    }

    const status = toUpperTrimmedString(csn.status);
    if (!EDITABLE_CSN_STATUSES.has(status)) {
      const code = READONLY_CSN_STATUSES.has(status)
        ? "PROCUREMENT_CSN_READ_ONLY"
        : "PROCUREMENT_CSN_EDIT_BLOCKED";
      return procurementErrorResponse(req, ctx, code, 400, "CSN is not editable in current status");
    }

    const updates: JsonRecord = {};
    const mutableFields = [
      "dispatch_qty",
      "port_of_loading",
      "port_of_discharge_id",
      "vessel_name",
      "voyage_number",
      "bl_number",
      "boe_number",
      "cha_id",
      "cha_name_freetext",
      "scheduled_eta_to_port",
      "etd",
      "etd_is_manual_override",
      "bl_date",
      "eta_at_port",
      "eta_at_port_is_manual_override",
      "ata_at_port",
      "post_clearance_lr_date",
      "transporter_id",
      "transporter_name_freetext",
      "lr_number_port_to_plant",
      "vehicle_number_port_to_plant",
      "lc_opened_date",
      "lc_number",
      "vessel_booking_confirmed_date",
      "lr_date",
      "lr_number",
      "vehicle_number",
      "domestic_transporter_id",
      "domestic_transporter_freetext",
      "vendor_indent_number",
      "gate_entry_date",
      "grn_date",
      "received_qty",
      "invoice_number",
      "remarks",
    ];

    let shouldRecalculate = false;
    for (const field of mutableFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field] === "" ? null : body[field];
        if (DATE_FIELDS.has(field)) {
          shouldRecalculate = true;
        }
      }
    }

    if (shouldRecalculate) {
      Object.assign(updates, await recalculateAndBuildUpdates(csn, updates));
    }

    updates.last_updated_at = new Date().toISOString();
    updates.last_updated_by = ctx.auth_user_id;

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("PROCUREMENT_CSN_UPDATE_FAILED");
    }

    if (data.is_mother_csn === true || (csn.is_mother_csn === true)) {
      await syncSubCsnsFromMother(id, updates);
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CSN_UPDATE_FAILED";
    const status = code === "PROCUREMENT_CSN_NOT_FOUND" ? 404 : code.includes("READ_ONLY") || code.includes("EDIT_BLOCKED") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CSN update failed");
  }
}

export async function createSubCSNHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const id = getIdFromPath(req);
    const body = await parseBody(req);
    const companyId = await getCompanyScopedCompanyId(ctx, toTrimmedString(body.company_id));
    const mother = await getCsnById(id, companyId);
    if (!mother) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_NOT_FOUND", 404, "Mother CSN not found");
    }

    const csnNumber = await generateProcurementDocNumber("CSN");
    const dispatchQty = body.dispatch_qty != null ? Number(body.dispatch_qty) : mother.dispatch_qty ?? mother.po_qty;
    const insertPayload: JsonRecord = {
      ...mother,
      id: undefined,
      csn_number: csnNumber,
      mother_csn_id: id,
      is_mother_csn: false,
      status: "ORDERED",
      dispatch_qty: dispatchQty,
      total_received_qty: 0,
      gate_entry_id: null,
      gate_entry_date: null,
      grn_id: null,
      grn_date: null,
      received_qty: null,
      sto_id: null,
      created_at: undefined,
      created_by: ctx.auth_user_id,
      last_updated_at: null,
      last_updated_by: null,
    };

    const { data: subCsn, error: subCsnError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .insert(insertPayload)
      .select("*")
      .single();

    if (subCsnError || !subCsn) {
      throw new Error("PROCUREMENT_SUB_CSN_CREATE_FAILED");
    }

    await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .update({
        is_mother_csn: true,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id);

    return okResponse({ data: subCsn }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_SUB_CSN_CREATE_FAILED";
    const status = code === "PROCUREMENT_CSN_NOT_FOUND" ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Sub CSN create failed");
  }
}

export async function deleteSubCSNHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const motherId = getIdFromPath(req);
    const subId = getSubIdFromPath(req);
    const companyId = await getCompanyScopedCompanyId(ctx);
    const subCsn = await getCsnById(subId, companyId);
    if (!subCsn || toTrimmedString(subCsn.mother_csn_id) !== motherId) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_SUB_CSN_NOT_FOUND", 404, "Sub CSN not found");
    }

    if (toUpperTrimmedString(subCsn.status) !== "ORDERED") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_SUB_CSN_DELETE_BLOCKED", 400, "Only ORDERED sub CSN can be deleted");
    }

    const gateEntryLink = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry_line")
      .select("id")
      .eq("csn_id", subId)
      .limit(1)
      .maybeSingle();

    if (gateEntryLink.error) {
      throw new Error("PROCUREMENT_SUB_CSN_DELETE_FAILED");
    }
    if (gateEntryLink.data?.id || toTrimmedString(subCsn.gate_entry_id)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_SUB_CSN_DELETE_BLOCKED", 400, "Sub CSN linked to gate entry");
    }

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .delete()
      .eq("id", subId);

    if (error) {
      throw new Error("PROCUREMENT_SUB_CSN_DELETE_FAILED");
    }

    return okResponse({ data: { id: subId, deleted: true } }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_SUB_CSN_DELETE_FAILED";
    const status = code === "PROCUREMENT_SUB_CSN_NOT_FOUND" ? 404 : code.includes("BLOCKED") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Sub CSN delete failed");
  }
}

export async function markCSNInTransitHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const id = getIdFromPath(req);
    const body = await parseBody(req);
    const companyId = await getCompanyScopedCompanyId(ctx, toTrimmedString(body.company_id));
    const csn = await getCsnById(id, companyId);
    if (!csn) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_NOT_FOUND", 404, "CSN not found");
    }
    if (toUpperTrimmedString(csn.status) !== "ORDERED") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_STATUS_INVALID", 400, "Only ORDERED CSN can be marked in transit");
    }

    const etdDate = toTrimmedString(body.actual_etd || body.etd || todayIsoDate());
    const updates: JsonRecord = {
      status: "IN_TRANSIT",
      etd: etdDate,
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    };
    Object.assign(updates, await recalculateAndBuildUpdates(csn, updates));

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("PROCUREMENT_CSN_MARK_IN_TRANSIT_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CSN_MARK_IN_TRANSIT_FAILED";
    const status = code === "PROCUREMENT_CSN_NOT_FOUND" ? 404 : code.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CSN mark in transit failed");
  }
}

export async function markCSNArrivedHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const id = getIdFromPath(req);
    const body = await parseBody(req);
    const companyId = await getCompanyScopedCompanyId(ctx, toTrimmedString(body.company_id));
    const csn = await getCsnById(id, companyId);
    if (!csn) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_NOT_FOUND", 404, "CSN not found");
    }
    if (toUpperTrimmedString(csn.status) !== "IN_TRANSIT") {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_STATUS_INVALID", 400, "Only IN_TRANSIT CSN can be marked arrived");
    }

    const actualArrivalDate = toTrimmedString(body.actual_arrival_date || todayIsoDate());
    const csnType = toUpperTrimmedString(csn.csn_type);
    const updates: JsonRecord = {
      status: "ARRIVED",
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    };

    if (csnType === "IMPORT") {
      updates.ata_at_port = actualArrivalDate;
    } else {
      updates.gate_entry_date = actualArrivalDate;
    }

    Object.assign(updates, await recalculateAndBuildUpdates(csn, updates));

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("PROCUREMENT_CSN_MARK_ARRIVED_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CSN_MARK_ARRIVED_FAILED";
    const status = code === "PROCUREMENT_CSN_NOT_FOUND" ? 404 : code.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CSN mark arrived failed");
  }
}

export async function getLCAlertCountHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const companyId = await getCompanyScopedCompanyId(ctx, new URL(req.url).searchParams.get("company_id") ?? "");
    const threshold = addDays(todayIsoDate(), 3);
    const { count, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("lc_required", true)
      .is("lc_opened_date", null)
      .lte("eta_at_port", threshold)
      .not("status", "in", '("GRN_DONE","CLOSED")');
    if (error) {
      throw new Error("PROCUREMENT_LC_ALERT_COUNT_FAILED");
    }
    return okResponse({ data: { lc_alert: count ?? 0 } }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_LC_ALERT_COUNT_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "LC alert count failed");
  }
}

export async function getLCAlertListHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const companyId = await getCompanyScopedCompanyId(ctx, new URL(req.url).searchParams.get("company_id") ?? "");
    const threshold = addDays(todayIsoDate(), 3);
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select("*")
      .eq("company_id", companyId)
      .eq("lc_required", true)
      .is("lc_opened_date", null)
      .lte("eta_at_port", threshold)
      .not("status", "in", '("GRN_DONE","CLOSED")')
      .order("eta_at_port", { ascending: true });
    if (error) {
      throw new Error("PROCUREMENT_LC_ALERT_LIST_FAILED");
    }
    return okResponse({ data: await enrichTrackerRows((data as CsnRow[] | null) ?? []) }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_LC_ALERT_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "LC alert list failed");
  }
}

export async function getVesselBookingAlertCountHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const companyId = await getCompanyScopedCompanyId(ctx, new URL(req.url).searchParams.get("company_id") ?? "");
    const threshold = subtractDays(todayIsoDate(), 3);
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select("*")
      .eq("company_id", companyId)
      .eq("csn_type", "IMPORT")
      .is("vessel_booking_confirmed_date", null)
      .not("status", "in", '("ARRIVED","GRN_DONE","CLOSED")');

    if (error) {
      throw new Error("PROCUREMENT_VESSEL_ALERT_COUNT_FAILED");
    }

    const enriched = await enrichTrackerRows((data as CsnRow[] | null) ?? []);
    const count = enriched.filter((row) => {
      const poDate = toTrimmedString(row.po_date);
      return poDate && poDate <= threshold;
    }).length;

    return okResponse({ data: { vessel_booking_alert: count } }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_VESSEL_ALERT_COUNT_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "Vessel booking alert count failed");
  }
}

export async function getVesselBookingAlertListHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const companyId = await getCompanyScopedCompanyId(ctx, new URL(req.url).searchParams.get("company_id") ?? "");
    const threshold = subtractDays(todayIsoDate(), 3);
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select("*")
      .eq("company_id", companyId)
      .eq("csn_type", "IMPORT")
      .is("vessel_booking_confirmed_date", null)
      .not("status", "in", '("ARRIVED","GRN_DONE","CLOSED")');

    if (error) {
      throw new Error("PROCUREMENT_VESSEL_ALERT_LIST_FAILED");
    }

    const enriched = await enrichTrackerRows((data as CsnRow[] | null) ?? []);
    const filtered = enriched
      .filter((row) => {
        const poDate = toTrimmedString(row.po_date);
        return poDate && poDate <= threshold;
      })
      .sort((a, b) => String(a.po_date ?? "").localeCompare(String(b.po_date ?? "")));

    return okResponse({ data: filtered }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_VESSEL_ALERT_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "Vessel booking alert list failed");
  }
}

export async function getAllAlertCountsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const companyId = await getCompanyScopedCompanyId(ctx, new URL(req.url).searchParams.get("company_id") ?? "");
    const [lcCount, vesselAlertCount] = await Promise.all([
      (async () => {
        const threshold = addDays(todayIsoDate(), 3);
        const { count, error } = await serviceRoleClient
          .schema("erp_procurement")
          .from("consignment_note")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("lc_required", true)
          .is("lc_opened_date", null)
          .lte("eta_at_port", threshold)
          .not("status", "in", '("GRN_DONE","CLOSED")');
        if (error) throw new Error("PROCUREMENT_LC_ALERT_COUNT_FAILED");
        return count ?? 0;
      })(),
      (async () => {
        const threshold = subtractDays(todayIsoDate(), 3);
        const { data, error } = await serviceRoleClient
          .schema("erp_procurement")
          .from("consignment_note")
          .select("*")
          .eq("company_id", companyId)
          .eq("csn_type", "IMPORT")
          .is("vessel_booking_confirmed_date", null)
          .not("status", "in", '("ARRIVED","GRN_DONE","CLOSED")');
        if (error) throw new Error("PROCUREMENT_VESSEL_ALERT_COUNT_FAILED");
        const enriched = await enrichTrackerRows((data as CsnRow[] | null) ?? []);
        return enriched.filter((row) => {
          const poDate = toTrimmedString(row.po_date);
          return poDate && poDate <= threshold;
        }).length;
      })(),
    ]);

    return okResponse({
      data: {
        lc_alert: lcCount,
        vessel_booking_alert: vesselAlertCount,
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_ALERT_COUNTS_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "Alert counts lookup failed");
  }
}

export async function getTrackerHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await getCompanyScopedCompanyId(ctx, url.searchParams.get("company_id") ?? "");
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const csnType = toUpperTrimmedString(url.searchParams.get("csn_type"));
    const vendorId = toTrimmedString(url.searchParams.get("vendor_id"));
    const materialCategoryId = toTrimmedString(url.searchParams.get("material_category_id"));
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);
    const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);
    const sortBy = toTrimmedString(url.searchParams.get("sort_by")) || "created_at";
    const sortDirection = toUpperTrimmedString(url.searchParams.get("sort_direction")) === "ASC";

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order(sortBy, { ascending: sortDirection })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq("status", status);
    if (csnType) query = query.eq("csn_type", csnType);
    if (vendorId) query = query.eq("vendor_id", vendorId);
    if (materialCategoryId) query = query.eq("material_category_id", materialCategoryId);
    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);

    const { data, error, count } = await query;
    if (error) {
      throw new Error("PROCUREMENT_TRACKER_LIST_FAILED");
    }

    const enriched = await enrichTrackerRows((data as CsnRow[] | null) ?? []);
    return okResponse({ data: enriched, total: count ?? 0 }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_TRACKER_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "Tracker list failed");
  }
}

export async function inlineUpdateCSNHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const id = getIdFromPath(req);
    const body = await parseBody(req);
    const companyId = await getCompanyScopedCompanyId(ctx, toTrimmedString(body.company_id));
    const csn = await getCsnById(id, companyId);
    if (!csn) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_NOT_FOUND", 404, "CSN not found");
    }

    const field = toTrimmedString(body.field);
    if (!TRACKER_INLINE_FIELDS.has(field)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_TRACKER_FIELD_INVALID", 400, "Invalid tracker update field");
    }

    const status = toUpperTrimmedString(csn.status);
    if (!EDITABLE_CSN_STATUSES.has(status)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_READ_ONLY", 400, "CSN is not editable in current status");
    }

    const rawValue = body.value === "" ? null : body.value;
    const updates: JsonRecord = {
      [field]: rawValue,
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    };

    if (DATE_FIELDS.has(field)) {
      Object.assign(updates, await recalculateAndBuildUpdates(csn, updates));
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error("PROCUREMENT_TRACKER_INLINE_UPDATE_FAILED");
    }

    if (data.is_mother_csn === true) {
      await syncSubCsnsFromMother(id, updates);
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_TRACKER_INLINE_UPDATE_FAILED";
    const status = code === "PROCUREMENT_CSN_NOT_FOUND" ? 404 : code.includes("INVALID") || code.includes("READ_ONLY") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Tracker inline update failed");
  }
}
