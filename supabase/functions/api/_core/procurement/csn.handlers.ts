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
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
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

const CSN_STATUS = {
  ORDERED: "ORD",
  IN_TRANSIT: "TRN",
  GATE_ENTRY_DONE: "GED",
  GRN_DONE: "GRD",
  CANCELLED: "CAN",
  KNOCKED_OFF: "KOF",
} as const;
const EDITABLE_CSN_STATUSES = new Set<string>([CSN_STATUS.ORDERED, CSN_STATUS.IN_TRANSIT]);
const READONLY_CSN_STATUSES = new Set<string>([CSN_STATUS.GATE_ENTRY_DONE, CSN_STATUS.GRN_DONE]);
const DATE_FIELDS = new Set([
  "scheduled_eta_to_port",
  "etd",
  "bl_date",
  "invoice_date",
  "boe_date",
  "eta_at_port",
  "ata_at_port",
  "post_clearance_lr_date",
  "lr_date",
  "gate_entry_date",
  "grn_date",
  "lc_opened_date",
  "courier_dispatch_date",
  "courier_received_date",
  "courier_date_to_cha",
  "courier_cha_receive_date",
]);
const TRACKER_INLINE_FIELDS = new Set([
  "lr_number",
  "lr_number_port_to_plant",
  "transporter_id",
  "domestic_transporter_id",
  "cha_id",
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
  "port_of_loading_id",
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
const BOOLEAN_FIELDS = new Set([
  "indent_required",
  "has_rebate",
  "soft_copy_received",
  "hard_copy_received",
  "etd_is_manual_override",
  "eta_at_port_is_manual_override",
]);
const NUMERIC_FIELDS = new Set([
  "dispatch_qty",
  "rebate_rate",
  "received_qty",
  "transit_days_snapshot",
]);
const MANUAL_EDITABLE_FIELDS = [
  "dispatch_qty",
  "material_category_id",
  "indent_required",
  "has_rebate",
  "rebate_rate",
  "rebate_remarks",
  "vendor_indent_number",
  "etd",
  "etd_is_manual_override",
  "bl_number",
  "bl_date",
  "invoice_number",
  "invoice_date",
  "boe_number",
  "boe_date",
  "eta_at_port",
  "eta_at_port_is_manual_override",
  "ata_at_port",
  "transporter_id",
  "transporter_name_freetext",
  "cha_id",
  "cha_name_freetext",
  "lr_date",
  "lr_number",
  "gate_entry_id",
  "gate_entry_date",
  "grn_id",
  "grn_date",
  "lc_number",
  "lc_opened_date",
  "port_of_discharge_id",
  "scheduled_eta_to_port",
  "vessel_name",
  "voyage_number",
  "post_clearance_lr_date",
  "lr_number_port_to_plant",
  "vehicle_number_port_to_plant",
  "vehicle_number",
  "domestic_transporter_id",
  "domestic_transporter_freetext",
  "remarks",
  "received_qty",
  "soft_copy_received",
  "hard_copy_received",
  "hard_copy_courier_number",
  "courier_dispatch_date",
  "courier_received_date",
  "courier_date_to_cha",
  "courier_cha_receive_date",
  "cha_docket_number",
  "consignee_company_id",
  "transit_days_snapshot",
];
const HISTORY_TRACKED_FIELDS = new Set(MANUAL_EDITABLE_FIELDS);

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

function parseNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBooleanish(value: unknown): boolean | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = toUpperTrimmedString(value);
  if (["TRUE", "YES", "Y", "1"].includes(normalized)) {
    return true;
  }
  if (["FALSE", "NO", "N", "0"].includes(normalized)) {
    return false;
  }
  return null;
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

function getTrackerLayoutIdFromPath(req: Request): string {
  return getPathSegments(req)[4] ?? "";
}

function collectAuthUserIds(value: unknown, ids: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectAuthUserIds(entry, ids);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (key.endsWith("_by")) {
      const authUserId = toTrimmedString(entryValue);
      if (authUserId) {
        ids.add(authUserId);
      }
      continue;
    }

    collectAuthUserIds(entryValue, ids);
  }
}

function attachUserDisplayFields<T>(
  value: T,
  displayNameMap: Map<string, string>,
): T {
  if (Array.isArray(value)) {
    return value.map((entry) => attachUserDisplayFields(entry, displayNameMap)) as T;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const enriched: Record<string, unknown> = {};

  for (const [key, entryValue] of Object.entries(record)) {
    if (Array.isArray(entryValue) || (entryValue && typeof entryValue === "object")) {
      enriched[key] = attachUserDisplayFields(entryValue, displayNameMap);
    } else {
      enriched[key] = entryValue;
    }

    if (key.endsWith("_by")) {
      const authUserId = toTrimmedString(entryValue);
      if (authUserId) {
        enriched[`${key}_display`] = displayNameMap.get(authUserId) ?? authUserId;
      }
    }
  }

  return enriched as T;
}

async function enrichCsnUserDisplays<T>(payload: T): Promise<T> {
  const authUserIds = new Set<string>();
  collectAuthUserIds(payload, authUserIds);
  const displayNameMap = await resolveUserDisplayNames([...authUserIds]);
  return attachUserDisplayFields(payload, displayNameMap);
}

function normalizeUpdateValue(field: string, value: unknown): unknown {
  if (BOOLEAN_FIELDS.has(field)) {
    return parseBooleanish(value);
  }
  if (NUMERIC_FIELDS.has(field)) {
    return parseNullableNumber(value);
  }
  return value === "" ? null : value;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (left == null && right == null) {
    return true;
  }
  if (typeof left === "number" || typeof right === "number") {
    return parseNullableNumber(left) === parseNullableNumber(right);
  }
  if (typeof left === "boolean" || typeof right === "boolean") {
    return parseBooleanish(left) === parseBooleanish(right);
  }
  return String(left ?? "") === String(right ?? "");
}

function historyValueToText(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? "YES" : "NO";
  }
  return String(value);
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
  let query: any = serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .select("*")
    .eq("id", id);

  if (companyId) {
    query = query.or(`company_id.eq.${companyId},consignee_company_id.eq.${companyId}`);
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

async function getAccessibleCompanyIds(ctx: ProcurementHandlerContext): Promise<string[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", ctx.auth_user_id);

  if (error) {
    throw new Error("PROCUREMENT_COMPANY_SCOPE_FAILED");
  }

  return [...new Set(((data as Record<string, unknown>[] | null) ?? [])
    .map((row) => toTrimmedString(row.company_id))
    .filter(Boolean))];
}

async function resolveScopedCompanyIds(
  ctx: ProcurementHandlerContext,
  requestedCompanyId?: string,
): Promise<string[]> {
  const explicitCompanyId = toTrimmedString(requestedCompanyId);
  if (explicitCompanyId) {
    const scopedCompanyId = await getCompanyScopedCompanyId(ctx, explicitCompanyId);
    return scopedCompanyId ? [scopedCompanyId] : [];
  }
  return await getAccessibleCompanyIds(ctx);
}

function buildCompanyScopeOrFilter(companyIds: string[]): string {
  const normalized = [...new Set(companyIds.map((value) => toTrimmedString(value)).filter(Boolean))];
  if (normalized.length === 0) {
    return "";
  }
  if (normalized.length === 1) {
    const companyId = normalized[0];
    return `company_id.eq.${companyId},consignee_company_id.eq.${companyId}`;
  }
  const joined = normalized.join(",");
  return `company_id.in.(${joined}),consignee_company_id.in.(${joined})`;
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
  const companyId = toTrimmedString(csn.consignee_company_id) || toTrimmedString(csn.company_id);
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

async function getPoExpectedDeliveryDate(poId: string): Promise<string | null> {
  if (!poId) {
    return null;
  }

  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order")
    .select("expected_delivery_date")
    .eq("id", poId)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_PO_LOOKUP_FAILED");
  }

  return toTrimmedString((data as Record<string, unknown> | null)?.expected_delivery_date) || null;
}

async function getPoLineSnapshot(poLineId: string): Promise<Record<string, unknown> | null> {
  if (!poLineId) {
    return null;
  }

  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order_line")
    .select("id, ordered_qty, knocked_off_qty, line_status")
    .eq("id", poLineId)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_PO_LINE_LOOKUP_FAILED");
  }

  return (data as Record<string, unknown> | null) ?? null;
}

async function getCsnsForPoLine(poLineId: string): Promise<CsnRow[]> {
  if (!poLineId) {
    return [];
  }

  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .select("*")
    .eq("po_line_id", poLineId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error("PROCUREMENT_CSN_SIBLING_LOOKUP_FAILED");
  }

  return (data as CsnRow[] | null) ?? [];
}

async function getMaterialGroupOptionsByMaterialIds(materialIds: string[]): Promise<Map<string, Array<Record<string, unknown>>>> {
  const normalized = [...new Set(materialIds.map((value) => toTrimmedString(value)).filter(Boolean))];
  if (normalized.length === 0) {
    return new Map();
  }

  const { data: memberRows, error: memberError } = await serviceRoleClient
    .schema("erp_master")
    .from("material_category_group_member")
    .select("material_id, group_id, is_primary")
    .in("material_id", normalized);

  if (memberError) {
    console.error("CSN_MATERIAL_GROUP_MEMBER_LOOKUP_FAILED", JSON.stringify(memberError));
    throw new Error(`PROCUREMENT_MATERIAL_GROUP_LOOKUP_FAILED: ${memberError.message}`);
  }

  const members = (memberRows as Record<string, unknown>[] | null) ?? [];
  const groupIds = [...new Set(members.map((row) => toTrimmedString(row.group_id)).filter(Boolean))];

  const { data: groupRows, error: groupError } = groupIds.length > 0
    ? await serviceRoleClient
      .schema("erp_master")
      .from("material_category_group")
      .select("id, group_name")
      .in("id", groupIds)
    : { data: [], error: null };

  if (groupError) {
    console.error("CSN_MATERIAL_GROUP_NAME_LOOKUP_FAILED", JSON.stringify(groupError));
    throw new Error(`PROCUREMENT_MATERIAL_GROUP_LOOKUP_FAILED: ${groupError.message}`);
  }

  const groupNameById = new Map(
    ((groupRows as Record<string, unknown>[] | null) ?? []).map((row) => [toTrimmedString(row.id), toTrimmedString(row.group_name)]),
  );

  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const row of members) {
    const materialId = toTrimmedString(row.material_id);
    const groupId = toTrimmedString(row.group_id);
    if (!materialId || !groupId) {
      continue;
    }
    const current = grouped.get(materialId) ?? [];
    current.push({
      id: groupId,
      group_name: groupNameById.get(groupId) ?? "",
      is_primary: row.is_primary === true,
    });
    grouped.set(materialId, current);
  }

  for (const [materialId, options] of grouped.entries()) {
    options.sort((left, right) => {
      if (left.is_primary === right.is_primary) {
        return String(left.group_name ?? "").localeCompare(String(right.group_name ?? ""));
      }
      return left.is_primary ? -1 : 1;
    });
    grouped.set(materialId, options);
  }

  return grouped;
}

async function cloneBalanceCsnFromSource(
  sourceCsn: CsnRow,
  quantity: number,
  createdBy: string,
): Promise<CsnRow> {
  const csnNumber = await generateProcurementDocNumber("CSN");
  const nowIso = new Date().toISOString();
  const payload: JsonRecord = {
    ...sourceCsn,
    id: undefined,
    csn_number: csnNumber,
    po_qty: sourceCsn.po_qty ?? null,
    dispatch_qty: quantity,
    total_received_qty: 0,
    gate_entry_id: null,
    gate_entry_date: null,
    grn_id: null,
    grn_date: null,
    received_qty: null,
    inactive_reason_code: null,
    inactive_from_status: null,
    inactive_at: null,
    inactive_by: null,
    created_at: undefined,
    created_by: createdBy,
    last_updated_at: nowIso,
    last_updated_by: createdBy,
  };

  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .insert(payload)
    .select("*")
    .single();

  if (error || !data) {
    console.error("CSN_BALANCE_CLONE_FAILED", JSON.stringify(error));
    throw new Error("PROCUREMENT_CSN_BALANCE_CREATE_FAILED");
  }

  return data as CsnRow;
}

function calculateETACascade(
  csn: CsnRow,
  importLeadTime: Record<string, unknown> | null,
  domesticLeadTime: Record<string, unknown> | null,
  portPlantTransit: Record<string, unknown> | null,
  poLineExpectedDeliveryDate?: string | null,
): Partial<CsnRow> {
  const updates: Partial<CsnRow> = {};
  const csnType = toUpperTrimmedString(csn.csn_type);

  if (csnType === "IMPORT") {
    const sailTime = Number(importLeadTime?.sail_time_days ?? 0);
    const clearanceDays = Number(importLeadTime?.clearance_days ?? 0);
    // Use snapshot if set (frozen at port-assignment time); fall back to live master for old/unset CSNs
    const portTransitDays = csn.transit_days_snapshot != null
      ? Number(csn.transit_days_snapshot)
      : Number(portPlantTransit?.transit_days ?? 0);
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

    const effectiveEtd = toTrimmedString(updates.etd) || etd;
    const portSourceDate = blDate || effectiveEtd;
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

    if (effectiveEtd) {
      updates.lc_due_date = subtractDays(effectiveEtd, 10);
    }
  } else if (csnType === "DOMESTIC") {
    const transitDays = Number(domesticLeadTime?.transit_days ?? 0);
    const gateEntryDate = toTrimmedString(csn.gate_entry_date);
    const atdDate = toTrimmedString(csn.lr_date);
    const manualEtd = toTrimmedString(csn.etd);
    const baselineEtd = toTrimmedString(poLineExpectedDeliveryDate);

    if (!toTrimmedString(csn.etd) && baselineEtd) {
      updates.etd = baselineEtd;
    }

    if (gateEntryDate) {
      updates.eta_to_plant_calculated = gateEntryDate;
    } else if (atdDate) {
      updates.eta_to_plant_calculated = addDays(atdDate, transitDays);
    } else {
      const effectiveEtd = manualEtd || toTrimmedString(updates.etd) || baselineEtd;
      if (effectiveEtd) {
        updates.eta_to_plant_calculated = addDays(effectiveEtd, transitDays);
      }
    }
  } else {
    const gateEntryDate = toTrimmedString(csn.gate_entry_date);
    if (gateEntryDate) {
      updates.eta_to_plant_calculated = gateEntryDate;
    }
  }

  return updates;
}

async function recalculateAndBuildUpdates(
  csn: CsnRow,
  inputUpdates: JsonRecord,
): Promise<JsonRecord> {
  const merged = { ...csn, ...inputUpdates };
  const expectedDeliveryDate = await getPoExpectedDeliveryDate(toTrimmedString(merged.po_id));
  const importLeadTime = await getImportLeadTime(merged);
  const domesticLeadTime = await getDomesticLeadTime(merged);
  const portPlantTransit = await getPortPlantTransit(merged);

  // Auto-snapshot: when port_of_discharge_id is being set and no snapshot exists yet,
  // capture current master value so future master changes don't affect this CSN.
  const autoSnapshot: JsonRecord = {};
  if (
    inputUpdates.port_of_discharge_id != null &&
    merged.transit_days_snapshot == null &&
    inputUpdates.transit_days_snapshot == null &&
    portPlantTransit?.transit_days != null
  ) {
    autoSnapshot.transit_days_snapshot = Number(portPlantTransit.transit_days);
    merged.transit_days_snapshot = autoSnapshot.transit_days_snapshot;
  }

  const cascade = calculateETACascade(
    merged,
    importLeadTime,
    domesticLeadTime,
    portPlantTransit,
    expectedDeliveryDate,
  );
  return { ...inputUpdates, ...autoSnapshot, ...cascade };
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
  const stoIds = [...new Set(rows.map((row) => toTrimmedString(row.sto_id)).filter(Boolean))];
  const motherIds = [...new Set(rows.map((row) => toTrimmedString(row.mother_csn_id)).filter(Boolean))];
  const vendorIds = [...new Set(rows.map((row) => toTrimmedString(row.vendor_id)).filter(Boolean))];
  const materialIds = [...new Set(rows.map((row) => toTrimmedString(row.material_id)).filter(Boolean))];
  const paymentTermIds = [...new Set(rows.map((row) => toTrimmedString(row.payment_term_id)).filter(Boolean))];
  const portIds = [...new Set([
    ...rows.map((row) => toTrimmedString(row.port_of_discharge_id)),
    ...rows.map((row) => toTrimmedString(row.port_of_loading_id)),
  ].filter(Boolean))];
  const poLineIds = [...new Set(rows.map((row) => toTrimmedString(row.po_line_id)).filter(Boolean))];
  const gateEntryIds = [...new Set(rows.map((row) => toTrimmedString(row.gate_entry_id)).filter(Boolean))];
  const grnIds = [...new Set(rows.map((row) => toTrimmedString(row.grn_id)).filter(Boolean))];
  const transporterIds = [...new Set([
    ...rows.map((row) => toTrimmedString(row.transporter_id)),
    ...rows.map((row) => toTrimmedString(row.domestic_transporter_id)),
  ].filter(Boolean))];
  const chaIds = [...new Set(rows.map((row) => toTrimmedString(row.cha_id)).filter(Boolean))];
  const companyIds = [...new Set([
    ...rows.map((row) => toTrimmedString(row.company_id)),
    ...rows.map((row) => toTrimmedString(row.consignee_company_id)),
  ].filter(Boolean))];

  const [poResult, stoResult, motherResult, vendorResult, materialResult, transporterResult, chaResult, paymentTermResult, portResult, companyResult, poLineResult, stoLineResult, poLineCsnResult, gateEntryResult, grnResult, materialGroupOptions] = await Promise.all([
    poIds.length
      ? serviceRoleClient.schema("erp_procurement").from("purchase_order").select("id, po_number, po_date, expected_delivery_date, delivery_type").in("id", poIds)
      : Promise.resolve({ data: [], error: null }),
    stoIds.length
      ? serviceRoleClient.schema("erp_procurement").from("stock_transfer_order").select("id, sto_number, sto_date").in("id", stoIds)
      : Promise.resolve({ data: [], error: null }),
    motherIds.length
      ? serviceRoleClient.schema("erp_procurement").from("consignment_note").select("id, csn_number, mother_csn_id, sto_id").in("id", motherIds)
      : Promise.resolve({ data: [], error: null }),
    vendorIds.length
      ? serviceRoleClient.schema("erp_master").from("vendor_master").select("id, vendor_name").in("id", vendorIds)
      : Promise.resolve({ data: [], error: null }),
    materialIds.length
      ? serviceRoleClient.schema("erp_master").from("material_master").select("id, material_name, pace_code, base_uom_code").in("id", materialIds)
      : Promise.resolve({ data: [], error: null }),
    transporterIds.length
      ? serviceRoleClient.schema("erp_master").from("transporter_master").select("id, transporter_name").in("id", transporterIds)
      : Promise.resolve({ data: [], error: null }),
    chaIds.length
      ? serviceRoleClient.schema("erp_master").from("cha_master").select("id, cha_name").in("id", chaIds)
      : Promise.resolve({ data: [], error: null }),
    paymentTermIds.length
      ? serviceRoleClient
        .schema("erp_master")
        .from("payment_terms_master")
        .select("id, name, credit_days, reference_date_type:reference_date_type_id(id, code, label)")
        .in("id", paymentTermIds)
      : Promise.resolve({ data: [], error: null }),
    portIds.length
      ? serviceRoleClient.schema("erp_master").from("port_master").select("id, port_code, port_name").in("id", portIds)
      : Promise.resolve({ data: [], error: null }),
    companyIds.length
      ? serviceRoleClient.schema("erp_master").from("companies").select("id, company_code, company_name").in("id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    poLineIds.length
      ? serviceRoleClient
        .schema("erp_procurement")
        .from("purchase_order_line")
        .select("id, ordered_qty, knocked_off_qty, line_status, unit_rate, currency_code")
        .in("id", poLineIds)
      : Promise.resolve({ data: [], error: null }),
    stoIds.length
      ? serviceRoleClient
        .schema("erp_procurement")
        .from("stock_transfer_order_line")
        .select("id, sto_id, material_id, quantity, uom_code, payment_term_id, transfer_price, transfer_price_currency, currency_code")
        .in("sto_id", stoIds)
      : Promise.resolve({ data: [], error: null }),
    poLineIds.length
      ? serviceRoleClient
        .schema("erp_procurement")
        .from("consignment_note")
        .select("po_line_id, dispatch_qty, status")
        .in("po_line_id", poLineIds)
      : Promise.resolve({ data: [], error: null }),
    gateEntryIds.length
      ? serviceRoleClient.schema("erp_procurement").from("gate_entry").select("id, ge_number").in("id", gateEntryIds)
      : Promise.resolve({ data: [], error: null }),
    grnIds.length
      ? serviceRoleClient.schema("erp_procurement").from("goods_receipt").select("id, grn_number").in("id", grnIds)
      : Promise.resolve({ data: [], error: null }),
    getMaterialGroupOptionsByMaterialIds(materialIds),
  ]);

  if (
    poResult.error || stoResult.error || motherResult.error || vendorResult.error || materialResult.error || transporterResult.error
    || chaResult.error
    || paymentTermResult.error || portResult.error || companyResult.error
    || poLineResult.error || stoLineResult.error || poLineCsnResult.error || gateEntryResult.error || grnResult.error
  ) {
    console.error("CSN_TRACKER_ENRICH_FAILED", JSON.stringify({
      po: poResult.error, sto: stoResult.error, mother: motherResult.error, vendor: vendorResult.error, material: materialResult.error,
      transporter: transporterResult.error, cha: chaResult.error, paymentTerm: paymentTermResult.error, port: portResult.error,
      company: companyResult.error, poLine: poLineResult.error, stoLine: stoLineResult.error, poLineCsns: poLineCsnResult.error,
      gateEntry: gateEntryResult.error, grn: grnResult.error,
    }));
    throw new Error("PROCUREMENT_TRACKER_ENRICH_FAILED");
  }

  const poMap = new Map((poResult.data ?? []).map((row: Record<string, unknown>) => [toTrimmedString(row.id), row]));
  const stoMap = new Map((stoResult.data ?? []).map((row: Record<string, unknown>) => [toTrimmedString(row.id), row]));
  const motherMap = new Map((motherResult.data ?? []).map((row: Record<string, unknown>) => [toTrimmedString(row.id), row]));
  const vendorMap = new Map((vendorResult.data ?? []).map((row: Record<string, unknown>) => [toTrimmedString(row.id), row]));
  const materialMap = new Map((materialResult.data ?? []).map((row: Record<string, unknown>) => [toTrimmedString(row.id), row]));
  const transporterMap = new Map((transporterResult.data ?? []).map((row: Record<string, unknown>) => [toTrimmedString(row.id), row]));
  const chaMap = new Map((chaResult.data ?? []).map((row: Record<string, unknown>) => [toTrimmedString(row.id), row]));
  const paymentTermMap = new Map((paymentTermResult.data ?? []).map((row: Record<string, unknown>) => [toTrimmedString(row.id), row]));
  const portMap = new Map((portResult.data ?? []).map((row: Record<string, unknown>) => [toTrimmedString(row.id), row]));
  const companyMap = new Map((companyResult.data ?? []).map((row: Record<string, unknown>) => [toTrimmedString(row.id), row]));
  const poLineMap = new Map((poLineResult.data ?? []).map((row: Record<string, unknown>) => [toTrimmedString(row.id), row]));
  const stoLineMap = new Map(
    ((stoLineResult.data ?? []) as Record<string, unknown>[]).map((row) => {
      const key = [
        toTrimmedString(row.sto_id),
        toTrimmedString(row.material_id),
        toTrimmedString(row.uom_code),
        String(parseNullableNumber(row.quantity) ?? ""),
      ].join("|");
      return [key, row];
    }),
  );
  const gateEntryMap = new Map((gateEntryResult.data ?? []).map((row: Record<string, unknown>) => [toTrimmedString(row.id), row]));
  const grnMap = new Map((grnResult.data ?? []).map((row: Record<string, unknown>) => [toTrimmedString(row.id), row]));
  const poLineBalanceMap = new Map<string, number>();
  for (const row of (poLineCsnResult.data ?? []) as Record<string, unknown>[]) {
    const poLineId = toTrimmedString(row.po_line_id);
    if (!poLineId || toUpperTrimmedString(row.status) === CSN_STATUS.KNOCKED_OFF) {
      continue;
    }
    const nextValue = Number(poLineBalanceMap.get(poLineId) ?? 0) + Number(row.dispatch_qty ?? 0);
    poLineBalanceMap.set(poLineId, Number(nextValue.toFixed(6)));
  }

  const enriched = rows.map((row) => {
    const po = poMap.get(toTrimmedString(row.po_id)) as Record<string, unknown> | undefined;
    const sto = stoMap.get(toTrimmedString(row.sto_id)) as Record<string, unknown> | undefined;
    const mother = motherMap.get(toTrimmedString(row.mother_csn_id)) as Record<string, unknown> | undefined;
    const vendor = vendorMap.get(toTrimmedString(row.vendor_id)) as Record<string, unknown> | undefined;
    const material = materialMap.get(toTrimmedString(row.material_id)) as Record<string, unknown> | undefined;
    const transporter = transporterMap.get(
      toTrimmedString(row.transporter_id) || toTrimmedString(row.domestic_transporter_id),
    ) as Record<string, unknown> | undefined;
    const cha = chaMap.get(toTrimmedString(row.cha_id)) as Record<string, unknown> | undefined;
    const paymentTerm = paymentTermMap.get(toTrimmedString(row.payment_term_id)) as Record<string, unknown> | undefined;
    const referenceType = paymentTerm?.reference_date_type as Record<string, unknown> | undefined;
    const dischargePort = portMap.get(toTrimmedString(row.port_of_discharge_id)) as Record<string, unknown> | undefined;
    const loadingPort = portMap.get(toTrimmedString(row.port_of_loading_id)) as Record<string, unknown> | undefined;
    const consigneeCompany = companyMap.get(toTrimmedString(row.consignee_company_id)) as Record<string, unknown> | undefined;
    const owningCompany = companyMap.get(toTrimmedString(row.company_id)) as Record<string, unknown> | undefined;
    const poLine = poLineMap.get(toTrimmedString(row.po_line_id)) as Record<string, unknown> | undefined;
    const stoLine = stoLineMap.get([
      toTrimmedString(row.sto_id),
      toTrimmedString(row.material_id),
      toTrimmedString(row.po_uom_code),
      String(parseNullableNumber(row.po_qty) ?? ""),
    ].join("|")) as Record<string, unknown> | undefined;
    const gateEntry = gateEntryMap.get(toTrimmedString(row.gate_entry_id)) as Record<string, unknown> | undefined;
    const grn = grnMap.get(toTrimmedString(row.grn_id)) as Record<string, unknown> | undefined;
    const materialGroups = materialGroupOptions.get(toTrimmedString(row.material_id)) ?? [];
    const selectedMaterialGroup = materialGroups.find((entry) => toTrimmedString(entry.id) === toTrimmedString(row.material_category_id)) ?? null;
    const isDetachedSubCsn = Boolean(row.mother_csn_id) && !toTrimmedString(row.sto_id);
    const csnNumber = toTrimmedString(row.csn_number);
    const actualPaymentDate = (() => {
      const referenceCode = toUpperTrimmedString(referenceType?.code);
      const creditDays = Number(paymentTerm?.credit_days ?? 0);
      if (!referenceCode || referenceCode === "N_A") {
        return null;
      }
      const anchor = (() => {
        switch (referenceCode) {
          case "BL_DATE":
          case "SHIPMENT_DATE":
            return toTrimmedString(row.bl_date) || toTrimmedString(row.lr_date);
          case "GRN_DATE":
            return toTrimmedString(row.grn_date);
          case "INVOICE_DATE":
            return toTrimmedString(row.invoice_date);
          default:
            return "";
        }
      })();
      return anchor ? addDays(anchor, creditDays) : null;
    })();
    const vendorCompany = companyMap.get(toTrimmedString(row.vendor_id)) as Record<string, unknown> | undefined;
    const orderedQty = Number(poLine?.ordered_qty ?? row.po_qty ?? 0);
    const activeDispatchQty = Number(poLineBalanceMap.get(toTrimmedString(row.po_line_id)) ?? 0);
    const balanceQty = row.po_line_id
      ? Number(Math.max(0, orderedQty - Number((poLine as Record<string, unknown> | undefined)?.knocked_off_qty ?? 0) - activeDispatchQty).toFixed(6))
      : null;

    return {
      ...row,
      po_number: po?.po_number ?? null,
      po_date: po?.po_date ?? null,
      sto_number: sto?.sto_number ?? null,
      sto_date: sto?.sto_date ?? null,
      display_reference_number: sto?.sto_number ?? po?.po_number ?? null,
      delivery_type: row.delivery_type ?? po?.delivery_type ?? null,
      csn_display_number: csnNumber
        ? `${isDetachedSubCsn ? "Sub-CSN" : "CSN"}-${csnNumber}`
        : null,
      vendor_name: vendor?.vendor_name ?? vendor?.name ?? (vendorCompany
        ? `${toTrimmedString(vendorCompany.company_code)} | ${toTrimmedString(vendorCompany.company_name)}`
        : null),
      material_name: material?.material_name ?? null,
      material_code: material?.pace_code ?? null,
      base_uom_code: material?.base_uom_code ?? null,
      po_rate: poLine?.unit_rate ?? stoLine?.transfer_price ?? row.transfer_price ?? null,
      currency_code: toTrimmedString(poLine?.currency_code) || toTrimmedString(stoLine?.currency_code) || toTrimmedString(stoLine?.transfer_price_currency) || null,
      balance_qty: balanceQty,
      transporter_name: transporter?.transporter_name ?? row.transporter_name_freetext ?? row.domestic_transporter_freetext ?? null,
      transporter_code: transporter?.transporter_code ?? null,
      cha_name: cha?.cha_name ?? row.cha_name_freetext ?? null,
      payment_term_name: paymentTerm?.name ?? null,
      payment_term_reference_type_code: referenceType?.code ?? null,
      payment_term_credit_days: paymentTerm?.credit_days ?? null,
      actual_payment_date: actualPaymentDate,
      port_of_discharge_label: dischargePort
        ? `${toTrimmedString(dischargePort.port_code)} | ${toTrimmedString(dischargePort.port_name)}`
        : null,
      port_of_loading_label: loadingPort
        ? `${toTrimmedString(loadingPort.port_code)} | ${toTrimmedString(loadingPort.port_name)}`
        : null,
      consignee_company_label: consigneeCompany
        ? `${toTrimmedString(consigneeCompany.company_code)} | ${toTrimmedString(consigneeCompany.company_name)}`
        : null,
      company_label: owningCompany
        ? `${toTrimmedString(owningCompany.company_code)} | ${toTrimmedString(owningCompany.company_name)}`
        : null,
      material_group_name: selectedMaterialGroup?.group_name ?? null,
      material_group_options: materialGroups,
      mother_csn_display_number: mother?.csn_number
        ? `${mother?.mother_csn_id && !mother?.sto_id ? "Sub-CSN" : "CSN"}-${toTrimmedString(mother.csn_number)}`
        : null,
      expected_delivery_date: po?.expected_delivery_date ?? null,
      ge_number: gateEntry?.ge_number ?? null,
      grn_number: grn?.grn_number ?? null,
      actual_arrival_date: row.gate_entry_date ?? row.ata_at_port ?? null,
      eta_plant: row.eta_to_plant_calculated ?? null,
    } as CsnRow;
  });

  const withLeadMeta = await Promise.all(enriched.map(async (row: CsnRow) => {
    try {
      const [importLeadTime, domesticLeadTime] = await Promise.all([
        toUpperTrimmedString(row.csn_type) === "IMPORT" ? getImportLeadTime(row) : Promise.resolve(null),
        toUpperTrimmedString(row.csn_type) === "DOMESTIC" ? getDomesticLeadTime(row) : Promise.resolve(null),
      ]);
      return {
        ...row,
        import_sail_time_days: importLeadTime?.sail_time_days ?? null,
        import_clearance_days: importLeadTime?.clearance_days ?? null,
        domestic_transit_days: domesticLeadTime?.transit_days ?? null,
      } as CsnRow;
    } catch {
      return row;
    }
  }));

  return await enrichCsnUserDisplays(withLeadMeta);
}

async function writeCsnFieldHistory(
  csnId: string,
  before: CsnRow,
  after: CsnRow,
  changedBy: string,
  candidateFields: Iterable<string>,
): Promise<void> {
  const entries: Array<Record<string, unknown>> = [];

  for (const field of candidateFields) {
    if (!HISTORY_TRACKED_FIELDS.has(field)) {
      continue;
    }
    const oldValue = before[field];
    const newValue = after[field];
    if (valuesEqual(oldValue, newValue)) {
      continue;
    }
    entries.push({
      csn_id: csnId,
      field_name: field,
      old_value: historyValueToText(oldValue),
      new_value: historyValueToText(newValue),
      changed_by: changedBy,
    });
  }

  if (entries.length === 0) {
    return;
  }

  const { error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("csn_field_history")
    .insert(entries);

  if (error) {
    console.error("CSN_FIELD_HISTORY_WRITE_FAILED", JSON.stringify(error));
    throw new Error("PROCUREMENT_CSN_HISTORY_WRITE_FAILED");
  }
}

async function computeDispatchQtyPreview(
  csn: CsnRow,
  newDispatchQty: number,
): Promise<Record<string, unknown>> {
  const poLineId = toTrimmedString(csn.po_line_id);
  if (!poLineId) {
    throw new Error("PROCUREMENT_CSN_PO_LINE_REQUIRED");
  }

  const [poLine, siblingCsns] = await Promise.all([
    getPoLineSnapshot(poLineId),
    getCsnsForPoLine(poLineId),
  ]);

  if (!poLine) {
    throw new Error("PROCUREMENT_PO_LINE_NOT_FOUND");
  }

  const targetId = toTrimmedString(csn.id);
  const activeCsns = siblingCsns.filter((row) => toUpperTrimmedString(row.status) !== CSN_STATUS.KNOCKED_OFF);
  const orderedQty = Number(poLine.ordered_qty ?? 0);
  const knockedOffQty = Number(poLine.knocked_off_qty ?? 0);
  const accountedAfterEdit = activeCsns.reduce((sum, row) => {
    const isTarget = toTrimmedString(row.id) === targetId;
    return sum + Number(isTarget ? newDispatchQty : row.dispatch_qty ?? 0);
  }, 0);
  const remainder = Number(Math.max(0, orderedQty - knockedOffQty - accountedAfterEdit).toFixed(6));
  const siblingRows = activeCsns.filter((row) => toTrimmedString(row.id) !== targetId);

  const suggestedAllocations = activeCsns.map((row) => ({
    id: toTrimmedString(row.id),
    csn_number: row.csn_number,
    status: row.status,
    current_qty: Number(toTrimmedString(row.id) === targetId ? newDispatchQty : row.dispatch_qty ?? 0),
    suggested_qty: Number(toTrimmedString(row.id) === targetId ? newDispatchQty : row.dispatch_qty ?? 0),
  }));

  return {
    csn_id: targetId,
    po_line_id: poLineId,
    ordered_qty: orderedQty,
    knocked_off_qty: knockedOffQty,
    new_dispatch_qty: newDispatchQty,
    remainder,
    can_reconcile: siblingRows.length > 0,
    requires_reconciliation: false,
    requires_prompt: remainder > 0,
    sibling_count: siblingRows.length,
    csns: suggestedAllocations,
  };
}

export async function listCSNsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyIds = await resolveScopedCompanyIds(ctx, url.searchParams.get("company_id") ?? "");
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const csnType = toUpperTrimmedString(url.searchParams.get("csn_type"));
    const poId = toTrimmedString(url.searchParams.get("po_id"));
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);
    const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);

    let query: any = serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });
    query = query.range(offset, offset + limit - 1);

    const companyScopeFilter = buildCompanyScopeOrFilter(companyIds);
    if (companyScopeFilter) {
      query = query.or(companyScopeFilter);
    }

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

    const gateEntryIds = [...new Set(((gateEntryLineResult.data ?? []) as Record<string, unknown>[])
      .map((row: Record<string, unknown>) => toTrimmedString(row.gate_entry_id))
      .filter(Boolean))];
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

    const [enriched] = await enrichTrackerRows([csn]);

    return okResponse({
      data: {
        ...(enriched ?? csn),
        gate_entry_lines: gateEntryLineResult.data ?? [],
        gate_entries: gateEntryResult.data ?? [],
        grn: grnResult.data ?? null,
      },
    }, ctx.request_id, req);
  } catch (err) {
    console.error("CSN_DETAIL_HANDLER_ERROR", err instanceof Error ? err.stack || err.message : JSON.stringify(err));
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
    let shouldRecalculate = false;
    for (const field of MANUAL_EDITABLE_FIELDS) {
      if (body[field] !== undefined) {
        updates[field] = normalizeUpdateValue(field, body[field]);
        if (
          DATE_FIELDS.has(field)
          || field === "transit_days_snapshot"
          || field === "port_of_discharge_id"
          || field === "material_category_id"
          || field === "dispatch_qty"
        ) {
          shouldRecalculate = true;
        }
      }
    }

    if (shouldRecalculate) {
      Object.assign(updates, await recalculateAndBuildUpdates(csn, updates));
    }

    // Auto ORD→TRN: when the ATD field transitions from empty to set, bump status.
    const merged = { ...csn, ...updates };
    const csnType = toUpperTrimmedString(merged.csn_type);
    const atdField = csnType === "IMPORT" ? "bl_date" : "lr_date";
    const prevAtd = toTrimmedString(csn[atdField as keyof CsnRow] as string);
    const newAtd = toTrimmedString(updates[atdField] as string);
    if (!prevAtd && newAtd && toUpperTrimmedString(csn.status) === CSN_STATUS.ORDERED) {
      updates.status = CSN_STATUS.IN_TRANSIT;
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

    await writeCsnFieldHistory(id, csn, data as CsnRow, ctx.auth_user_id, Object.keys(updates));

    return okResponse({ data: await enrichCsnUserDisplays(data) }, ctx.request_id, req);
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
    const insertPayload: JsonRecord = {
      ...mother,
      id: undefined,
      csn_number: csnNumber,
      mother_csn_id: id,
      is_mother_csn: false,
      consignee_company_id: toTrimmedString(body.consignee_company_id) || null,
      status: CSN_STATUS.ORDERED,
      dispatch_qty: 0,
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

    const motherUpdateResult = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .update({
        is_mother_csn: true,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id);

    if (motherUpdateResult.error) {
      throw new Error("PROCUREMENT_SUB_CSN_CREATE_FAILED");
    }

    return okResponse({ data: subCsn }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_SUB_CSN_CREATE_FAILED";
    const status = code === "PROCUREMENT_CSN_NOT_FOUND" ? 404 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Sub CSN create failed");
  }
}

export async function listAvailableSubCsnsForStoHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const sendingCompanyId = toTrimmedString(url.searchParams.get("sending_company_id"));
    const receivingCompanyId = toTrimmedString(url.searchParams.get("receiving_company_id"));
    const materialId = toTrimmedString(url.searchParams.get("material_id"));

    if (!sendingCompanyId || !receivingCompanyId || !materialId) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_STO_SUB_CSN_FILTERS_REQUIRED", 400, "sending_company_id, receiving_company_id, and material_id are required");
    }

    const { data: subCsns, error: subCsnError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select("id, csn_number, status, mother_csn_id, company_id, consignee_company_id, material_id, po_id, po_line_id, dispatch_qty, po_qty, po_uom_code, bl_number, boe_number, sto_id")
      .in("status", [CSN_STATUS.ORDERED, CSN_STATUS.IN_TRANSIT])
      .eq("material_id", materialId)
      .eq("consignee_company_id", receivingCompanyId)
      .is("sto_id", null)
      .not("mother_csn_id", "is", null)
      .order("created_at", { ascending: false });

    if (subCsnError) {
      throw new Error("PROCUREMENT_SUB_CSN_LIST_FAILED");
    }

    const rows = (subCsns as JsonRecord[] | null) ?? [];
    const motherIds = [...new Set(rows.map((row) => toTrimmedString(row.mother_csn_id)).filter(Boolean))];
    const poIds = [...new Set(rows.map((row) => toTrimmedString(row.po_id)).filter(Boolean))];
    const poLineIds = [...new Set(rows.map((row) => toTrimmedString(row.po_line_id)).filter(Boolean))];

    const [
      { data: motherRows, error: motherError },
      { data: poRows, error: poError },
      { data: poLineRows, error: poLineError },
    ] = await Promise.all([
      motherIds.length > 0
        ? serviceRoleClient
          .schema("erp_procurement")
          .from("consignment_note")
          .select("id, company_id")
          .in("id", motherIds)
        : Promise.resolve({ data: [], error: null }),
      poIds.length > 0
        ? serviceRoleClient
          .schema("erp_procurement")
          .from("purchase_order")
          .select("id, po_number, status, payment_term_id, freight_term, gst_terms, expected_delivery_date, has_rebate, rebate_rate, rebate_rate_uom_basis, rebate_remarks")
          .in("id", poIds)
        : Promise.resolve({ data: [], error: null }),
      poLineIds.length > 0
        ? serviceRoleClient
          .schema("erp_procurement")
          .from("purchase_order_line")
          .select("id, line_status, unit_rate")
          .in("id", poLineIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (motherError || poError || poLineError) {
      throw new Error("PROCUREMENT_SUB_CSN_LIST_FAILED");
    }

    const motherCompanyById = new Map(
      ((motherRows as JsonRecord[] | null) ?? []).map((row) => [toTrimmedString(row.id), toTrimmedString(row.company_id)]),
    );
    const poById = new Map(
      ((poRows as JsonRecord[] | null) ?? []).map((row) => [toTrimmedString(row.id), row]),
    );
    const poLineById = new Map(
      ((poLineRows as JsonRecord[] | null) ?? []).map((row) => [toTrimmedString(row.id), row]),
    );

    const filtered = rows
      .filter((row) => motherCompanyById.get(toTrimmedString(row.mother_csn_id)) === sendingCompanyId)
      .filter((row) => toUpperTrimmedString(poById.get(toTrimmedString(row.po_id))?.status) !== "CANCELLED")
      .filter((row) => toUpperTrimmedString(poLineById.get(toTrimmedString(row.po_line_id))?.line_status) !== "KNOCKED_OFF")
      .map((row) => {
        const po = poById.get(toTrimmedString(row.po_id));
        const poLine = poLineById.get(toTrimmedString(row.po_line_id));
        return {
          ...row,
          mother_po_number: po?.po_number ?? null,
          invoice_or_boe_reference: toTrimmedString(row.bl_number) || toTrimmedString(row.boe_number) || null,
          dispatch_qty: row.dispatch_qty ?? row.po_qty ?? null,
          transfer_price: poLine?.unit_rate ?? null,
          payment_term_id: po?.payment_term_id ?? null,
          freight_term: po?.freight_term ?? null,
          gst_terms: po?.gst_terms ?? null,
          expected_delivery_date: po?.expected_delivery_date ?? null,
          has_rebate: po?.has_rebate === true,
          rebate_rate: po?.rebate_rate ?? null,
          rebate_rate_uom_basis: po?.rebate_rate_uom_basis ?? null,
          rebate_remarks: po?.rebate_remarks ?? null,
        };
      });

    return okResponse({ data: filtered }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_SUB_CSN_LIST_FAILED";
    const status = code.includes("REQUIRED") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Available sub CSN lookup failed");
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

    if (toUpperTrimmedString(subCsn.status) !== CSN_STATUS.ORDERED) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_SUB_CSN_DELETE_BLOCKED", 400, "Only ORD sub CSN can be deleted");
    }
    if (toTrimmedString(subCsn.sto_id)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_SUB_CSN_DELETE_BLOCKED", 400, "Sub CSN already linked to an STO");
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


export async function getLCAlertCountHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const companyIds = await resolveScopedCompanyIds(ctx, new URL(req.url).searchParams.get("company_id") ?? "");
    const threshold = addDays(todayIsoDate(), 3);
    let query: any = serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select("id", { count: "exact", head: true })
      .eq("lc_required", true)
      .is("lc_opened_date", null);
    query = query.lte("eta_at_port", threshold).not("status", "in", '("GRD","CAN","KOF")');
    const companyScopeFilter = buildCompanyScopeOrFilter(companyIds);
    if (companyScopeFilter) {
      query = query.or(companyScopeFilter);
    }
    const { count, error } = await query;
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
    const companyIds = await resolveScopedCompanyIds(ctx, new URL(req.url).searchParams.get("company_id") ?? "");
    const threshold = addDays(todayIsoDate(), 3);
    let query: any = serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select("*")
      .eq("lc_required", true)
      .is("lc_opened_date", null);
    query = query
      .lte("eta_at_port", threshold)
      .not("status", "in", '("GRD","CAN","KOF")')
      .order("eta_at_port", { ascending: true });
    const companyScopeFilter = buildCompanyScopeOrFilter(companyIds);
    if (companyScopeFilter) {
      query = query.or(companyScopeFilter);
    }
    const { data, error } = await query;
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
    const companyIds = await resolveScopedCompanyIds(ctx, new URL(req.url).searchParams.get("company_id") ?? "");
    const threshold = subtractDays(todayIsoDate(), 3);
    let query: any = serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select("*")
      .eq("csn_type", "IMPORT")
      .is("vessel_booking_confirmed_date", null)
      .not("status", "in", '("GED","GRD","CAN","KOF")');
    const companyScopeFilter = buildCompanyScopeOrFilter(companyIds);
    if (companyScopeFilter) {
      query = query.or(companyScopeFilter);
    }
    const { data, error } = await query;

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
    const companyIds = await resolveScopedCompanyIds(ctx, new URL(req.url).searchParams.get("company_id") ?? "");
    const threshold = subtractDays(todayIsoDate(), 3);
    let query: any = serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select("*")
      .eq("csn_type", "IMPORT")
      .is("vessel_booking_confirmed_date", null)
      .not("status", "in", '("GED","GRD","CAN","KOF")');
    const companyScopeFilter = buildCompanyScopeOrFilter(companyIds);
    if (companyScopeFilter) {
      query = query.or(companyScopeFilter);
    }
    const { data, error } = await query;

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
    const companyIds = await resolveScopedCompanyIds(ctx, new URL(req.url).searchParams.get("company_id") ?? "");
    const [lcCount, vesselAlertCount] = await Promise.all([
      (async () => {
        const threshold = addDays(todayIsoDate(), 3);
        let query: any = serviceRoleClient
          .schema("erp_procurement")
          .from("consignment_note")
          .select("id", { count: "exact", head: true })
          .eq("lc_required", true)
          .is("lc_opened_date", null);
        query = query.lte("eta_at_port", threshold).not("status", "in", '("GRD","CAN","KOF")');
        const companyScopeFilter = buildCompanyScopeOrFilter(companyIds);
        if (companyScopeFilter) {
          query = query.or(companyScopeFilter);
        }
        const { count, error } = await query;
        if (error) throw new Error("PROCUREMENT_LC_ALERT_COUNT_FAILED");
        return count ?? 0;
      })(),
      (async () => {
        const threshold = subtractDays(todayIsoDate(), 3);
        let query: any = serviceRoleClient
          .schema("erp_procurement")
          .from("consignment_note")
          .select("*")
          .eq("csn_type", "IMPORT")
          .is("vessel_booking_confirmed_date", null)
          .not("status", "in", '("GED","GRD","CAN","KOF")');
        const companyScopeFilter = buildCompanyScopeOrFilter(companyIds);
        if (companyScopeFilter) {
          query = query.or(companyScopeFilter);
        }
        const { data, error } = await query;
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
    const companyIds = await resolveScopedCompanyIds(ctx, url.searchParams.get("company_id") ?? "");
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

    let query: any = serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select("*", { count: "exact" })
      .order(sortBy, { ascending: sortDirection });
    query = query.range(offset, offset + limit - 1);

    const companyScopeFilter = buildCompanyScopeOrFilter(companyIds);
    if (companyScopeFilter) {
      query = query.or(companyScopeFilter);
    }

    if (status) query = query.eq("status", status);
    if (csnType) query = query.eq("csn_type", csnType);
    if (vendorId) query = query.eq("vendor_id", vendorId);
    if (materialCategoryId) query = query.eq("material_category_id", materialCategoryId);
    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);

    const { data, error, count } = await query;
    if (error) {
      console.error("CSN_TRACKER_LIST_QUERY_FAILED", JSON.stringify(error));
      throw new Error(`PROCUREMENT_TRACKER_LIST_FAILED: ${error.message}`);
    }

    const enriched = await enrichTrackerRows((data as CsnRow[] | null) ?? []);
    return okResponse({ data: enriched, total: count ?? 0 }, ctx.request_id, req);
  } catch (err) {
    console.error("CSN_TRACKER_LIST_HANDLER_ERROR", err);
    const code = (err as Error).message || "PROCUREMENT_TRACKER_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "Tracker list failed");
  }
}

export async function listCsnFieldHistoryHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const id = getIdFromPath(req);
    const fieldName = toTrimmedString(new URL(req.url).searchParams.get("field_name"));
    if (!fieldName) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_HISTORY_FIELD_REQUIRED", 400, "field_name is required");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("csn_field_history")
      .select("*")
      .eq("csn_id", id)
      .eq("field_name", fieldName)
      .order("changed_at", { ascending: false });

    if (error) {
      console.error("CSN_FIELD_HISTORY_LIST_FAILED", JSON.stringify(error));
      throw new Error("PROCUREMENT_CSN_HISTORY_LIST_FAILED");
    }

    return okResponse({ data: await enrichCsnUserDisplays((data as CsnRow[] | null) ?? []) }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CSN_HISTORY_LIST_FAILED";
    const status = code.includes("REQUIRED") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CSN field history lookup failed");
  }
}

export async function listTrackerLayoutsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    let query: any = serviceRoleClient
      .schema("erp_procurement")
      .from("csn_tracker_layout")
      .select("*");
    query = query
      .or(`scope.eq.GLOBAL,and(scope.eq.USER,created_by.eq.${ctx.auth_user_id})`)
      .order("created_at", { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error("CSN_LAYOUT_LIST_FAILED", JSON.stringify(error));
      throw new Error("PROCUREMENT_CSN_LAYOUT_LIST_FAILED");
    }

    return okResponse({ data: await enrichCsnUserDisplays((data as CsnRow[] | null) ?? []) }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CSN_LAYOUT_LIST_FAILED";
    return procurementErrorResponse(req, ctx, code, 500, "CSN tracker layout list failed");
  }
}

export async function createTrackerLayoutHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const name = toTrimmedString(body.name);
    const scope = toUpperTrimmedString(body.scope || "USER");
    const visibleColumns = Array.isArray(body.visible_columns)
      ? body.visible_columns.map((value) => toTrimmedString(value)).filter(Boolean)
      : [];

    if (!name) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_LAYOUT_NAME_REQUIRED", 400, "Layout name is required");
    }
    if (!["GLOBAL", "USER"].includes(scope)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_LAYOUT_SCOPE_INVALID", 400, "Layout scope must be GLOBAL or USER");
    }
    if (visibleColumns.length === 0) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_LAYOUT_COLUMNS_REQUIRED", 400, "At least one visible column is required");
    }
    if (scope === "GLOBAL" && !["SA", "GA", "DIRECTOR"].includes(ctx.roleCode)) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_HEAD_REQUIRED", 403, "Global layouts require head-level access");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("csn_tracker_layout")
      .insert({
        name,
        scope,
        created_by: ctx.auth_user_id,
        visible_columns: visibleColumns,
      })
      .select("*")
      .single();

    if (error || !data) {
      console.error("CSN_LAYOUT_CREATE_FAILED", JSON.stringify(error));
      throw new Error("PROCUREMENT_CSN_LAYOUT_CREATE_FAILED");
    }

    return okResponse({ data: await enrichCsnUserDisplays(data) }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CSN_LAYOUT_CREATE_FAILED";
    const status = code.includes("REQUIRED") || code.includes("INVALID") ? 400 : code === "PROCUREMENT_HEAD_REQUIRED" ? 403 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CSN tracker layout create failed");
  }
}

export async function deleteTrackerLayoutHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const id = getTrackerLayoutIdFromPath(req);
    const { data: layout, error: lookupError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("csn_tracker_layout")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (lookupError) {
      console.error("CSN_LAYOUT_DELETE_LOOKUP_FAILED", JSON.stringify(lookupError));
      throw new Error("PROCUREMENT_CSN_LAYOUT_DELETE_FAILED");
    }
    if (!layout) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_LAYOUT_NOT_FOUND", 404, "Layout not found");
    }

    const createdBy = toTrimmedString(layout.created_by);
    const scope = toUpperTrimmedString(layout.scope);
    const canDelete = createdBy === ctx.auth_user_id
      || (scope === "GLOBAL" && ["SA", "GA", "DIRECTOR"].includes(ctx.roleCode));

    if (!canDelete) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_LAYOUT_DELETE_FORBIDDEN", 403, "You cannot delete this layout");
    }

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("csn_tracker_layout")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("CSN_LAYOUT_DELETE_FAILED", JSON.stringify(error));
      throw new Error("PROCUREMENT_CSN_LAYOUT_DELETE_FAILED");
    }

    return okResponse({ data: { id, deleted: true } }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CSN_LAYOUT_DELETE_FAILED";
    const status = code === "PROCUREMENT_CSN_LAYOUT_NOT_FOUND" ? 404 : code.includes("FORBIDDEN") ? 403 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CSN tracker layout delete failed");
  }
}

export async function previewDispatchQtyAdjustmentHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const id = getIdFromPath(req);
    const body = await parseBody(req);
    const companyId = await getCompanyScopedCompanyId(ctx, toTrimmedString(body.company_id));
    const newDispatchQty = parseNullableNumber(body.value ?? body.dispatch_qty);
    if (newDispatchQty == null || newDispatchQty < 0) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_DISPATCH_QTY_REQUIRED", 400, "dispatch_qty must be zero or greater");
    }

    const csn = await getCsnById(id, companyId);
    if (!csn) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_NOT_FOUND", 404, "CSN not found");
    }

    const preview = await computeDispatchQtyPreview(csn, newDispatchQty);
    return okResponse({ data: preview }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CSN_DISPATCH_PREVIEW_FAILED";
    const status = code === "PROCUREMENT_CSN_NOT_FOUND" ? 404 : code.includes("REQUIRED") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "CSN dispatch preview failed");
  }
}

export async function confirmDispatchQtyAdjustmentHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const id = getIdFromPath(req);
    const body = await parseBody(req);
    const companyId = await getCompanyScopedCompanyId(ctx, toTrimmedString(body.company_id));
    const action = toUpperTrimmedString(body.action || "SAVE_ONLY");
    const newDispatchQty = parseNullableNumber(body.value ?? body.dispatch_qty);
    const knockOffQty = parseNullableNumber(body.knock_off_qty) ?? 0;
    const reason = toTrimmedString(body.reason || body.knock_off_reason);
    if (newDispatchQty == null || newDispatchQty < 0) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_DISPATCH_QTY_REQUIRED", 400, "dispatch_qty must be zero or greater");
    }

    const csn = await getCsnById(id, companyId);
    if (!csn) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_NOT_FOUND", 404, "CSN not found");
    }

    const preview = await computeDispatchQtyPreview(csn, newDispatchQty);
    const poLine = await getPoLineSnapshot(toTrimmedString(csn.po_line_id));
    if (!poLine) {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_PO_LINE_NOT_FOUND", 404, "PO line not found");
    }

    const nowIso = new Date().toISOString();
    const changedRows: CsnRow[] = [];

    const updateCsnQty = async (rowId: string, quantity: number): Promise<CsnRow> => {
      const before = await getCsnById(rowId, companyId);
      if (!before) {
        throw new Error("PROCUREMENT_CSN_NOT_FOUND");
      }
      const updates = {
        dispatch_qty: quantity,
        last_updated_at: nowIso,
        last_updated_by: ctx.auth_user_id,
      };
      const { data, error } = await serviceRoleClient
        .schema("erp_procurement")
        .from("consignment_note")
        .update(updates)
        .eq("id", rowId)
        .select("*")
        .single();
      if (error || !data) {
        console.error("CSN_DISPATCH_QTY_UPDATE_FAILED", JSON.stringify(error));
        throw new Error("PROCUREMENT_CSN_DISPATCH_CONFIRM_FAILED");
      }
      await writeCsnFieldHistory(rowId, before, data as CsnRow, ctx.auth_user_id, ["dispatch_qty"]);
      return data as CsnRow;
    };

    if (action === "SAVE_ONLY") {
      changedRows.push(await updateCsnQty(id, newDispatchQty));
    } else if (action === "CREATE_CSN") {
      if (Number(preview.remainder ?? 0) <= 0) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_DISPATCH_ACTION_INVALID", 400, "Nothing remains to create as a new CSN");
      }
      changedRows.push(await updateCsnQty(id, newDispatchQty));
      changedRows.push(await cloneBalanceCsnFromSource(csn, Number(preview.remainder ?? 0), ctx.auth_user_id));
    } else if (action === "KNOCK_OFF") {
      if (Number(preview.remainder ?? 0) <= 0) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_DISPATCH_ACTION_INVALID", 400, "Nothing remains to knock off");
      }
      changedRows.push(await updateCsnQty(id, newDispatchQty));
      const nextKnockedOffQty = Number(poLine.knocked_off_qty ?? 0) + Number(preview.remainder ?? 0);
      const { error: lineError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("purchase_order_line")
        .update({
          knocked_off_qty: nextKnockedOffQty,
          knock_off_reason: reason || null,
          line_status: nextKnockedOffQty >= Number(poLine.ordered_qty ?? 0) ? "KNOCKED_OFF" : poLine.line_status,
          last_updated_at: nowIso,
        })
        .eq("id", toTrimmedString(csn.po_line_id));
      if (lineError) {
        console.error("CSN_DISPATCH_KNOCK_OFF_FAILED", JSON.stringify(lineError));
        throw new Error("PROCUREMENT_CSN_DISPATCH_CONFIRM_FAILED");
      }
    } else if (action === "RECONCILE") {
      const allocations = Array.isArray(body.allocations) ? body.allocations : [];
      const normalized = allocations.map((entry) => ({
        id: toTrimmedString((entry as Record<string, unknown>).id),
        qty: parseNullableNumber((entry as Record<string, unknown>).qty) ?? 0,
      })).filter((entry) => entry.id);
      const totalAllocated = normalized.reduce((sum, entry) => sum + Number(entry.qty ?? 0), 0);
      const targetTotal = Number(poLine.ordered_qty ?? 0) - Number(poLine.knocked_off_qty ?? 0);
      if (Number((totalAllocated + knockOffQty).toFixed(6)) !== Number(targetTotal.toFixed(6))) {
        return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_RECONCILE_TOTAL_INVALID", 400, "Reconciled quantities plus knock-off must match the line balance");
      }
      for (const entry of normalized) {
        changedRows.push(await updateCsnQty(entry.id, Number(entry.qty ?? 0)));
      }
      if (knockOffQty > 0) {
        const { error: lineError } = await serviceRoleClient
          .schema("erp_procurement")
          .from("purchase_order_line")
          .update({
            knocked_off_qty: Number(poLine.knocked_off_qty ?? 0) + knockOffQty,
            knock_off_reason: reason || null,
            last_updated_at: nowIso,
          })
          .eq("id", toTrimmedString(csn.po_line_id));
        if (lineError) {
          console.error("CSN_RECONCILE_KNOCK_OFF_FAILED", JSON.stringify(lineError));
          throw new Error("PROCUREMENT_CSN_DISPATCH_CONFIRM_FAILED");
        }
      }
    } else {
      return procurementErrorResponse(req, ctx, "PROCUREMENT_CSN_DISPATCH_ACTION_INVALID", 400, "Unknown dispatch reconciliation action");
    }

    return okResponse({ data: await enrichTrackerRows(changedRows) }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_CSN_DISPATCH_CONFIRM_FAILED";
    const status = code === "PROCUREMENT_CSN_NOT_FOUND" || code === "PROCUREMENT_PO_LINE_NOT_FOUND"
      ? 404
      : code.includes("INVALID") || code.includes("REQUIRED")
        ? 400
        : 500;
    return procurementErrorResponse(req, ctx, code, status, "CSN dispatch reconciliation failed");
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

    await writeCsnFieldHistory(id, csn, data as CsnRow, ctx.auth_user_id, [field]);

    return okResponse({ data: await enrichCsnUserDisplays(data) }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PROCUREMENT_TRACKER_INLINE_UPDATE_FAILED";
    const status = code === "PROCUREMENT_CSN_NOT_FOUND" ? 404 : code.includes("INVALID") || code.includes("READ_ONLY") ? 400 : 500;
    return procurementErrorResponse(req, ctx, code, status, "Tracker inline update failed");
  }
}
