/*
 * File-ID: 16.4.2
 * File-Path: supabase/functions/api/_core/procurement/grn.handlers.ts
 * Gate: 16.4 / GRN-REDESIGN
 * Domain: PROCUREMENT
 * Purpose: GRN handlers — new design: 1 GE line → 1 GRN.
 *          All FK names resolved in backend. No UUIDs in API responses.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { generateMaterialDocNumber } from "../../_shared/materialDocument.ts";
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

const GRN_STATUSES = new Set(["DRAFT", "POSTED", "REVERSED"]);
const STOCK_TYPES = new Set(["UNRESTRICTED", "QUALITY_INSPECTION", "BLOCKED"]);
const EXPIRY_TYPES = new Set(["DATE", "SPAN", "N_A"]);

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

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
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
  console.warn(`[GRN_ERROR] ${req.method} ${new URL(req.url).pathname} → ${status} ${code}: ${message}`);
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
  if (error || !data) throw new Error("PROCUREMENT_DOC_NUMBER_FAILED");
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
  if (poLineError || !poLine) throw new Error("PO_LINE_NOT_FOUND");

  const { data: po, error: poError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order")
    .select("*")
    .eq("id", String(poLine.po_id))
    .single();
  if (poError || !po) throw new Error("PO_NOT_FOUND");

  return { poLine, po };
}

async function fetchMaterial(materialId: string): Promise<MaterialRow> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, pace_code, material_name, external_sku, base_uom_code, qa_required_on_inward, batch_tracking_required, expiry_tracking_enabled")
    .eq("id", materialId)
    .single();
  if (error || !data) throw new Error("MATERIAL_NOT_FOUND");
  return data as MaterialRow;
}

async function verifyLocationMapped(companyId: string, storageLocationId: string): Promise<void> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_plant_map")
    .select("storage_location_id")
    .eq("company_id", companyId)
    .eq("storage_location_id", storageLocationId)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error("GRN_LOCATION_MAP_NOT_FOUND");
}

async function hasPhysicalInventoryBlock(
  materialId: string,
  storageLocationId: string,
): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("physical_inventory_block")
    .select("id")
    .eq("material_id", materialId)
    .eq("storage_location_id", storageLocationId)
    .maybeSingle();
  if (error) throw new Error("MATERIAL_POSTING_BLOCK_LOOKUP_FAILED");
  return Boolean(data?.id);
}

async function createQaDocumentForGrn(
  ctx: ProcurementHandlerContext,
  grn: GrnRow,
  materialId: string,
  receivedQty: number,
  uomCode: string,
  stockTypeCode: string,
  batchLotNumber: string | null,
  poLineId: string | null,
  grnLineId: string | null,
): Promise<void> {
  const qaNumber = await generateProcurementDocNumber("QA");
  const { error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("inward_qa_document")
    .insert({
      qa_number: qaNumber,
      company_id: grn.company_id,
      grn_id: grn.id,
      grn_line_id: grnLineId,
      po_id: poLineId ? grn.po_id : null,
      material_id: materialId,
      vendor_id: grn.vendor_id,
      batch_lot_number: batchLotNumber,
      qa_stock_qty: receivedQty,
      uom_code: uomCode,
      status: "PENDING",
      remarks: "Auto-created from GRN posting",
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    });
  if (error) throw new Error("QA_CREATE_FAILED");
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
    .update({ open_qty: nextOpenQty, line_status: lineStatus, last_updated_at: new Date().toISOString() })
    .eq("id", poLineId);
  if (error) throw new Error("PO_LINE_RECEIPT_UPDATE_FAILED");
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
    .update({ open_qty: nextOpenQty, line_status: lineStatus, last_updated_at: new Date().toISOString() })
    .eq("id", poLineId);
  if (error) throw new Error("PO_LINE_RECEIPT_REVERSE_FAILED");
}

async function resolveVendorName(vendorId: string | null): Promise<{ vendor_code: string | null; vendor_name: string | null }> {
  if (!vendorId) return { vendor_code: null, vendor_name: null };
  const { data } = await serviceRoleClient
    .schema("erp_master").from("vendor_master")
    .select("vendor_code, vendor_name")
    .eq("id", vendorId).maybeSingle();
  return { vendor_code: data?.vendor_code ?? null, vendor_name: data?.vendor_name ?? null };
}

async function resolveStorageLocationName(slocId: string | null): Promise<{ location_code: string | null; location_name: string | null }> {
  if (!slocId) return { location_code: null, location_name: null };
  const { data } = await serviceRoleClient
    .schema("erp_inventory").from("storage_location_master")
    .select("code, name")
    .eq("id", slocId).maybeSingle();
  return { location_code: data?.code ?? null, location_name: data?.name ?? null };
}

async function resolveTransporterName(transporterId: string | null): Promise<string | null> {
  if (!transporterId) return null;
  const { data } = await serviceRoleClient
    .schema("erp_master").from("transporter_master")
    .select("transporter_name")
    .eq("id", transporterId).maybeSingle();
  return data?.transporter_name ?? null;
}

async function hydrateGrn(grnId: string): Promise<JsonRecord> {
  const { data: grn, error: grnError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("goods_receipt")
    .select("*")
    .eq("id", grnId)
    .single();
  if (grnError || !grn) throw new Error("GRN_NOT_FOUND");

  const isNewStyle = Boolean(grn.gate_entry_line_id);

  const [geResp, vendorResult, slocResult, transporterName] = await Promise.all([
    serviceRoleClient.schema("erp_procurement").from("gate_entry")
      .select("id, ge_number, ge_date, vehicle_number")
      .eq("id", String(grn.gate_entry_id)).maybeSingle(),
    resolveVendorName(toTrimmedString(grn.vendor_id) || null),
    resolveStorageLocationName(toTrimmedString(grn.storage_location_id) || null),
    resolveTransporterName(toTrimmedString(grn.transporter_id) || null),
  ]);

  if (geResp.error) throw new Error("GRN_GATE_ENTRY_FETCH_FAILED");

  let materialData: JsonRecord | null = null;
  if (isNewStyle && grn.material_id) {
    const { data } = await serviceRoleClient.schema("erp_master").from("material_master")
      .select("id, pace_code, material_name, external_sku, batch_tracking_required, expiry_tracking_enabled, qa_required_on_inward")
      .eq("id", String(grn.material_id)).maybeSingle();
    materialData = data;
  }

  // Old-style: resolve lines with names
  const { data: lines, error: linesError } = await serviceRoleClient
    .schema("erp_procurement").from("goods_receipt_line")
    .select("*").eq("grn_id", grnId).order("line_number", { ascending: true });
  if (linesError) throw new Error("GRN_LINE_FETCH_FAILED");

  const linesList = (lines ?? []) as GrnLineRow[];
  let resolvedLines: JsonRecord[] = linesList;

  if (linesList.length > 0) {
    const matIds = [...new Set(linesList.map((l) => String(l.material_id ?? "")).filter(Boolean))];
    const slocIds = [...new Set(linesList.map((l) => String(l.storage_location_id ?? "")).filter(Boolean))];
    const [matResp, slocResp] = await Promise.all([
      matIds.length > 0
        ? serviceRoleClient.schema("erp_master").from("material_master")
            .select("id, pace_code, material_name").in("id", matIds)
        : { data: [], error: null },
      slocIds.length > 0
        ? serviceRoleClient.schema("erp_inventory").from("storage_location_master")
            .select("id, code, name").in("id", slocIds)
        : { data: [], error: null },
    ]);
    const matMap = new Map((matResp.data ?? []).map((m: JsonRecord) => [m.id, m]));
    const slocMap = new Map((slocResp.data ?? []).map((s: JsonRecord) => [s.id, s]));
    resolvedLines = linesList.map((l) => {
      const mat = matMap.get(l.material_id as string);
      const sloc = slocMap.get(l.storage_location_id as string);
      return {
        ...l,
        pace_code: mat?.pace_code ?? null,
        material_name: mat?.material_name ?? null,
        location_code: sloc?.code ?? null,
        location_name: sloc?.name ?? null,
      };
    });
  }

  return {
    ...grn,
    vendor_code: vendorResult.vendor_code,
    vendor_name: vendorResult.vendor_name,
    pace_code: materialData?.pace_code ?? null,
    material_name: materialData?.material_name ?? null,
    external_sku: materialData?.external_sku ?? null,
    batch_tracking_required: materialData?.batch_tracking_required ?? false,
    expiry_tracking_enabled: materialData?.expiry_tracking_enabled ?? false,
    location_code: slocResult.location_code,
    location_name: slocResult.location_name,
    transporter_name: transporterName,
    ge_number: geResp.data?.ge_number ?? null,
    ge_date: geResp.data?.ge_date ?? null,
    lines: resolvedLines,
    gate_entry: geResp.data ?? null,
  };
}

// ── GET /api/procurement/grns/ge-lines?ge_number=GE-100051 ──────────────────
export async function getGELinesForGRNHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const geNumber = toTrimmedString(url.searchParams.get("ge_number"));
    if (!geNumber) {
      return procurementErrorResponse(req, ctx, "GRN_GATE_ENTRY_REQUIRED", 400, "ge_number is required.");
    }

    const { data: gateEntry, error: geError } = await serviceRoleClient
      .schema("erp_procurement").from("gate_entry")
      .select("*").eq("ge_number", geNumber).maybeSingle();
    if (geError || !gateEntry) {
      return procurementErrorResponse(req, ctx, "GE_NOT_FOUND", 404, "Gate entry not found.");
    }

    const { data: lines, error: linesError } = await serviceRoleClient
      .schema("erp_procurement").from("gate_entry_line")
      .select("*").eq("gate_entry_id", String(gateEntry.id))
      .order("line_number", { ascending: true });
    if (linesError) {
      return procurementErrorResponse(req, ctx, "GE_LINE_FETCH_FAILED", 500, "Unable to fetch GE lines.");
    }

    const linesList = (lines ?? []) as JsonRecord[];
    const matIds = [...new Set(linesList.map((l) => String(l.material_id ?? "")).filter(Boolean))];
    const poLineIds = [...new Set(linesList.map((l) => String(l.po_line_id ?? "")).filter(Boolean))];

    const [matResp, poLineResp, existingGrnResp] = await Promise.all([
      matIds.length > 0
        ? serviceRoleClient.schema("erp_master").from("material_master")
            .select("id, pace_code, material_name, external_sku, base_uom_code, qa_required_on_inward, batch_tracking_required, expiry_tracking_enabled")
            .in("id", matIds)
        : { data: [], error: null },
      poLineIds.length > 0
        ? serviceRoleClient.schema("erp_procurement").from("purchase_order_line")
            .select("id, po_id, ordered_qty, unit_rate, receiving_location_id")
            .in("id", poLineIds)
        : { data: [], error: null },
      serviceRoleClient.schema("erp_procurement").from("goods_receipt")
        .select("gate_entry_line_id, grn_number, status, id")
        .eq("gate_entry_id", String(gateEntry.id))
        .not("gate_entry_line_id", "is", null),
    ]);

    const poIds = [...new Set((poLineResp.data ?? []).map((pl: JsonRecord) => String(pl.po_id ?? "")).filter(Boolean))];
    const poResp = poIds.length > 0
      ? await serviceRoleClient.schema("erp_procurement").from("purchase_order")
          .select("id, po_number, vendor_id, vendor_type").in("id", poIds)
      : { data: [] };

    // Fetch CSN data for pre-filling (1 CSN per GE line)
    const csnIds = [...new Set(linesList.map((l) => String(l.csn_id ?? "")).filter(Boolean))];
    const csnResp = csnIds.length > 0
      ? await serviceRoleClient.schema("erp_procurement").from("consignment_note")
          .select("id, invoice_number, invoice_date, bl_number, domestic_transporter_id, transporter_id, lr_number, lr_date")
          .in("id", csnIds)
      : { data: [] };

    // Bulk-resolve the transporter name for whichever transporter the CSN carries,
    // so the GRN create form can show it pre-filled instead of an apparently-empty field.
    const csnTransporterIds = [...new Set(
      (csnResp.data ?? []).map((c: JsonRecord) => String(c.domestic_transporter_id ?? c.transporter_id ?? "")).filter(Boolean)
    )];
    const csnTransporterResp = csnTransporterIds.length > 0
      ? await serviceRoleClient.schema("erp_master").from("transporter_master")
          .select("id, transporter_code, transporter_name").in("id", csnTransporterIds)
      : { data: [] };
    const csnTransporterMap = new Map((csnTransporterResp.data ?? []).map((t: JsonRecord) => [t.id, t]));

    // Bulk fetch vendors via PO chain (gate_entry has no vendor_id column)
    const vendorIds = [...new Set((poResp.data ?? []).map((p: JsonRecord) => String(p.vendor_id ?? "")).filter(Boolean))];
    const vendorResp = vendorIds.length > 0
      ? await serviceRoleClient.schema("erp_master").from("vendor_master")
          .select("id, vendor_code, vendor_name, vendor_type, gst_number, reg_address_line1, reg_address_city, reg_address_state, reg_address_pin")
          .in("id", vendorIds)
      : { data: [] };

    const matMap = new Map((matResp.data ?? []).map((m: JsonRecord) => [m.id, m]));
    const poLineMap = new Map((poLineResp.data ?? []).map((pl: JsonRecord) => [pl.id, pl]));
    const poMap = new Map((poResp.data ?? []).map((p: JsonRecord) => [p.id, p]));
    const vendorMap = new Map((vendorResp.data ?? []).map((v: JsonRecord) => [v.id, v]));
    const csnMap = new Map((csnResp.data ?? []).map((c: JsonRecord) => [c.id, c]));
    const grnByLineId = new Map((existingGrnResp.data ?? []).map((g: JsonRecord) => [g.gate_entry_line_id, g]));

    // Bulk fetch UOM conversions for lines where PO UOM ≠ base UOM
    const uomMismatchMatIds = [...new Set(linesList
      .filter((l) => {
        const mat = matMap.get(String(l.material_id));
        return mat && mat.base_uom_code && l.uom_code && mat.base_uom_code !== l.uom_code;
      })
      .map((l) => String(l.material_id))
    )];
    const uomConvResp = uomMismatchMatIds.length > 0
      ? await serviceRoleClient.schema("erp_master").from("material_uom_conversion")
          .select("material_id, from_uom_code, to_uom_code, conversion_factor, variable_conversion")
          .in("material_id", uomMismatchMatIds)
          .eq("active", true)
      : { data: [] };
    // Key: `materialId|fromUom|toUom`
    const uomConvMap = new Map(
      (uomConvResp.data ?? []).map((c: JsonRecord) =>
        [`${c.material_id}|${c.from_uom_code}|${c.to_uom_code}`, c]
      )
    );

    const resolvedLines = linesList.map((l) => {
      const mat = matMap.get(String(l.material_id));
      const poLine = l.po_line_id ? poLineMap.get(String(l.po_line_id)) : null;
      const po = poLine ? poMap.get(String(poLine.po_id)) : null;
      const vendor = po ? vendorMap.get(String(po.vendor_id)) : null;
      const csn = l.csn_id ? csnMap.get(String(l.csn_id)) : null;
      const csnTransporterId = csn?.domestic_transporter_id ?? csn?.transporter_id ?? null;
      const csnTransporter = csnTransporterId ? csnTransporterMap.get(String(csnTransporterId)) : null;
      const existingGrn = grnByLineId.get(String(l.id));
      const lineGrnStatus = existingGrn && existingGrn.status === "POSTED"
        ? "DONE"
        : existingGrn && existingGrn.status === "DRAFT"
        ? "DRAFT"
        : "PENDING";
      const baseUomCode = mat?.base_uom_code ?? null;
      const poUomCode = toTrimmedString(l.uom_code) || null;
      const convKey = `${l.material_id}|${poUomCode}|${baseUomCode}`;
      const conv = (baseUomCode && poUomCode && baseUomCode !== poUomCode)
        ? uomConvMap.get(convKey) ?? null
        : null;
      return {
        ...l,
        material_name: mat?.material_name ?? null,
        external_sku: mat?.external_sku ?? null,
        base_uom_code: baseUomCode,
        qa_required_on_inward: mat?.qa_required_on_inward ?? false,
        batch_tracking_required: mat?.batch_tracking_required ?? false,
        expiry_tracking_enabled: mat?.expiry_tracking_enabled ?? false,
        po_number: po?.po_number ?? null,
        po_rate: poLine?.unit_rate ?? null,
        vendor_id: po?.vendor_id ?? null,
        vendor_type: po?.vendor_type ?? "DOMESTIC",
        csn_invoice_number: csn?.invoice_number ?? null,
        csn_invoice_date: csn?.invoice_date ?? null,
        csn_bl_number: csn?.bl_number ?? null,
        csn_transporter_id: csnTransporterId,
        csn_transporter_name: csnTransporter
          ? `${csnTransporter.transporter_code} — ${csnTransporter.transporter_name}`
          : null,
        csn_lr_number: csn?.lr_number ?? null,
        csn_lr_date: csn?.lr_date ?? null,
        line_grn_status: lineGrnStatus,
        existing_grn_number: existingGrn?.grn_number ?? null,
        existing_grn_id: existingGrn?.id ?? null,
        uom_conversion_factor: conv ? Number(conv.conversion_factor) : null,
        uom_variable_conversion: conv ? Boolean(conv.variable_conversion) : null,
      };
    });

    // Derive vendor for GE header from first line's PO chain
    const firstPoLine = linesList[0] ? poLineMap.get(String(linesList[0].po_line_id)) : null;
    const firstPo = firstPoLine ? poMap.get(String(firstPoLine.po_id)) : null;
    const firstVendor = firstPo ? vendorMap.get(String(firstPo.vendor_id)) : null;

    return okResponse({
      gate_entry: {
        ...gateEntry,
        vendor_id: firstVendor?.id ?? null,
        vendor_code: firstVendor?.vendor_code ?? null,
        vendor_name: firstVendor?.vendor_name ?? null,
        vendor_type: firstPo?.vendor_type ?? null,
        vendor_gst: firstVendor?.gst_number ?? null,
        vendor_address: [firstVendor?.reg_address_line1, firstVendor?.reg_address_city, firstVendor?.reg_address_state, firstVendor?.reg_address_pin].filter(Boolean).join(", ") || null,
      },
      lines: resolvedLines,
    }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GE_LINE_GRN_LIST_FAILED";
    const status = message.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, message, status, message);
  }
}

// ── GET /api/procurement/grns/material-vendor-doc-names ─────────────────────
export async function getMaterialVendorDocNamesHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const materialId = toTrimmedString(url.searchParams.get("material_id"));
    const vendorId = toTrimmedString(url.searchParams.get("vendor_id"));
    if (!materialId || !vendorId) {
      return procurementErrorResponse(req, ctx, "GRN_ID_REQUIRED", 400, "material_id and vendor_id are required.");
    }
    const { data } = await serviceRoleClient
      .schema("erp_master").from("material_vendor_doc_name")
      .select("doc_name").eq("material_id", materialId).eq("vendor_id", vendorId)
      .order("created_at", { ascending: false });
    return okResponse({ items: (data ?? []).map((r: JsonRecord) => r.doc_name) }, ctx.request_id, req);
  } catch {
    return procurementErrorResponse(req, ctx, "GRN_LIST_FAILED", 500, "Unable to fetch doc names.");
  }
}

// ── POST /api/procurement/grns/from-line ────────────────────────────────────
// New-style: create + post GRN for a single GE line in one call.
export async function createAndPostGRNFromLineHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    console.log("[GRN_FROM_LINE] START user:", ctx.auth_user_id, "body:", JSON.stringify(body));
    const gateEntryLineId = toTrimmedString(body.gate_entry_line_id);
    if (!gateEntryLineId) {
      return procurementErrorResponse(req, ctx, "GRN_GATE_ENTRY_LINE_REQUIRED", 400, "gate_entry_line_id is required.");
    }

    // Fetch GE line
    const { data: geLine, error: geLineError } = await serviceRoleClient
      .schema("erp_procurement").from("gate_entry_line")
      .select("*").eq("id", gateEntryLineId).single();
    if (geLineError || !geLine) {
      console.error("[GRN_FROM_LINE] GE line not found:", gateEntryLineId, geLineError?.message);
      return procurementErrorResponse(req, ctx, "GRN_GATE_ENTRY_LINE_NOT_FOUND", 404, "Gate entry line not found.");
    }

    // Check no active GRN for this line
    const { data: existing } = await serviceRoleClient
      .schema("erp_procurement").from("goods_receipt")
      .select("id, status").eq("gate_entry_line_id", gateEntryLineId)
      .in("status", ["DRAFT", "POSTED"]).maybeSingle();
    if (existing) {
      return procurementErrorResponse(req, ctx, "GRN_ALREADY_EXISTS", 400, "A GRN already exists for this gate entry line.");
    }

    // Fetch GE header
    const { data: gateEntry, error: geError } = await serviceRoleClient
      .schema("erp_procurement").from("gate_entry")
      .select("*").eq("id", String(geLine.gate_entry_id)).single();
    if (geError || !gateEntry) {
      return procurementErrorResponse(req, ctx, "GE_NOT_FOUND", 404, "Gate entry not found.");
    }

    // Fetch material
    const material = await fetchMaterial(String(geLine.material_id));

    // Resolve PO data
    let poId: string | null = null;
    let poLineData: PurchaseOrderLineRow | null = null;
    let poData: PurchaseOrderRow | null = null;
    let vendorId: string | null = null;
    if (geLine.po_line_id) {
      const bundle = await fetchPoLineBundle(String(geLine.po_line_id));
      poLineData = bundle.poLine;
      poData = bundle.po;
      poId = String(poData.id);
      vendorId = toTrimmedString(poData.vendor_id) || null;
    }

    // Receipt calculations
    const geQty = parsePositiveNumber(geLine.ge_qty) ?? 0;
    const receivedQty = parseNullableNumber(body.received_qty) ?? geQty;
    if (receivedQty < 0) {
      return procurementErrorResponse(req, ctx, "GRN_RECEIVED_QTY_INVALID", 400, "Received qty cannot be negative.");
    }
    const discrepancyQty = Number((geQty - receivedQty).toFixed(6));
    const discrepancyRemarks = toTrimmedString(body.discrepancy_remarks) || null;
    if (discrepancyQty !== 0 && !discrepancyRemarks) {
      return procurementErrorResponse(req, ctx, "GRN_DISCREPANCY_REMARKS_REQUIRED", 400, "Remarks are required when received qty differs from invoice qty.");
    }

    // UOM conversion: if PO UOM ≠ base UOM, stock qty = received_qty × per_pack_qty
    const baseUomCode = toTrimmedString(material.base_uom_code) || toTrimmedString(geLine.uom_code) || "PCS";
    const poUomCode = toTrimmedString(geLine.uom_code) || baseUomCode;
    const uomMismatch = baseUomCode !== poUomCode;
    const perPackQty = parseNullableNumber(body.per_pack_qty);
    const stockQty = uomMismatch && perPackQty && perPackQty > 0
      ? Number((receivedQty * perPackQty).toFixed(6))
      : receivedQty;
    if (!baseUomCode) {
      return procurementErrorResponse(req, ctx, "GRN_UOM_REQUIRED", 400, "Material base UOM is not configured.");
    }

    const targetStockType: string = material.qa_required_on_inward ? "QUALITY_INSPECTION" : "UNRESTRICTED";

    // Storage location
    const storageLocationId = toTrimmedString(body.storage_location_id) || null;
    if (!storageLocationId) {
      return procurementErrorResponse(req, ctx, "GRN_STORAGE_REQUIRED", 400, "Storage location is required.");
    }
    await verifyLocationMapped(String(gateEntry.company_id), storageLocationId);
    const pidBlocked = await hasPhysicalInventoryBlock(String(geLine.material_id), storageLocationId);
    if (pidBlocked) {
      return procurementErrorResponse(req, ctx, "MATERIAL_POSTING_BLOCKED", 409, "Material has an active physical inventory count in progress.");
    }

    // Accounts
    const rateConfirmed = body.rate_confirmed === true;
    const poRate = parseNullableNumber(body.po_rate) ?? parseNullableNumber(poLineData?.unit_rate);
    const invoiceRate = parseNullableNumber(body.invoice_rate);
    const effectiveGrnRate = rateConfirmed ? (poRate ?? 0) : 0;
    // grn_rate is quoted per the PO/transaction UOM (e.g. per PKT) — stock is
    // valued per base UOM (e.g. per NOS), so divide by the same pack factor
    // used to convert stockQty above, or the value posted to stock is wrong
    // by a factor of perPackQty.
    const baseUomRate = uomMismatch && perPackQty && perPackQty > 0
      ? Number((effectiveGrnRate / perPackQty).toFixed(6))
      : effectiveGrnRate;

    // Expiry
    const expiryTypeRaw = toUpperTrimmedString(body.expiry_type);
    const expiryType = EXPIRY_TYPES.has(expiryTypeRaw) ? expiryTypeRaw : "N_A";
    let expiryDate: string | null = null;
    if (expiryType === "DATE") {
      expiryDate = toTrimmedString(body.expiry_date) || null;
    } else if (expiryType === "SPAN" && body.shelf_life_months) {
      const geDate = new Date(String(gateEntry.ge_date ?? todayIsoDate()));
      geDate.setMonth(geDate.getMonth() + Number(body.shelf_life_months));
      expiryDate = geDate.toISOString().slice(0, 10);
    }

    const grnDate = toTrimmedString(body.grn_date) || todayIsoDate();

    // Create GRN
    const grnNumber = await generateProcurementDocNumber("GRN");
    const { data: grn, error: grnError } = await serviceRoleClient
      .schema("erp_procurement").from("goods_receipt")
      .insert({
        grn_number: grnNumber,
        grn_date: grnDate,
        posting_date: grnDate,
        company_id: gateEntry.company_id,
        vendor_id: vendorId,
        gate_entry_id: String(geLine.gate_entry_id),
        gate_entry_line_id: gateEntryLineId,
        po_id: poId,
        po_line_id: geLine.po_line_id ?? null,
        material_id: geLine.material_id,
        storage_location_id: storageLocationId,
        movement_type_code: "P101",
        status: "DRAFT",
        // Receipt
        ge_qty: geQty,
        received_qty: receivedQty,
        uom_code: geLine.uom_code ?? material.base_uom_code,
        discrepancy_qty: discrepancyQty,
        discrepancy_remarks: discrepancyRemarks,
        target_stock_type: targetStockType,
        batch_lot_number: toTrimmedString(body.batch_lot_number) || null,
        expiry_type: expiryType,
        expiry_date: expiryDate,
        shelf_life_months: body.shelf_life_months ? Number(body.shelf_life_months) : null,
        per_pack_qty: parseNullableNumber(body.per_pack_qty),
        // Documents
        invoice_number: toTrimmedString(body.invoice_number) || null,
        invoice_date: toTrimmedString(body.invoice_date) || null,
        bl_number: toTrimmedString(body.bl_number) || null,
        bl_date: toTrimmedString(body.bl_date) || null,
        boe_number: toTrimmedString(body.boe_number) || null,
        boe_date: toTrimmedString(body.boe_date) || null,
        // Transporter
        transporter_id: toTrimmedString(body.transporter_id) || null,
        lr_number: toTrimmedString(body.lr_number) || null,
        lr_date: toTrimmedString(body.lr_date) || null,
        // Material
        invoice_name: toTrimmedString(body.invoice_name) || null,
        // Accounts
        po_rate: poRate,
        invoice_rate: invoiceRate,
        rate_confirmed: rateConfirmed,
        gst_pct: parseNullableNumber(body.gst_pct),
        grn_rate: effectiveGrnRate,
        created_by: ctx.auth_user_id,
      })
      .select("*").single();

    if (grnError || !grn) {
      console.error("[GRN_FROM_LINE] GRN INSERT failed:", grnError?.message);
      return procurementErrorResponse(req, ctx, "GRN_CREATE_FAILED", 500, "Unable to create GRN.");
    }
    console.log("[GRN_FROM_LINE] GRN created DRAFT:", grn.id, "grn_number:", grnNumber);

    // All steps after this point must succeed. If anything fails, delete the DRAFT GRN so
    // there is no half-created record — the caller can safely retry from scratch.
    async function rollbackGrn() {
      await serviceRoleClient.schema("erp_procurement").from("goods_receipt")
        .delete().eq("id", String(grn.id));
    }

    // §106: Material Document for this GRN receipt; grn_number becomes the reference.
    const grnMatDoc = await generateMaterialDocNumber(String(gateEntry.company_id));

    // Post stock movement
    const postingResp = await serviceRoleClient.schema("erp_inventory")
      .rpc("post_stock_movement", {
        p_document_number: grnNumber,
        p_document_date: grnDate,
        p_posting_date: grnDate,
        p_movement_type_code: "P101",
        p_company_id: gateEntry.company_id,
        p_storage_location_id: storageLocationId,
        p_material_id: geLine.material_id,
        p_quantity: stockQty,
        p_base_uom_code: baseUomCode,
        p_unit_value: baseUomRate,
        p_stock_type_code: targetStockType,
        p_direction: "IN",
        p_posted_by: ctx.auth_user_id,
        p_reversal_of_id: null,
        p_material_doc_number: grnMatDoc.docNumber,
        p_material_doc_year: grnMatDoc.docYear,
        p_reference_document_number: grnNumber,
        p_reference_document_type: "GRN",
        p_reference_document_id: grn.id ?? null,
      });

    if (postingResp.error || !Array.isArray(postingResp.data) || postingResp.data.length === 0) {
      console.error("[GRN_FROM_LINE] stock posting RPC failed. grn_number:", grnNumber,
        "material_id:", geLine.material_id, "storage_location_id:", storageLocationId,
        "company_id:", gateEntry.company_id, "stockQty:", stockQty, "baseUomCode:", baseUomCode,
        "targetStockType:", targetStockType, "rpc_error:", JSON.stringify(postingResp.error),
        "rpc_data:", JSON.stringify(postingResp.data));
      await rollbackGrn();
      return procurementErrorResponse(req, ctx, "GRN_POST_RPC_FAILED", 500, "Stock posting failed.");
    }
    console.log("[GRN_FROM_LINE] stock posted OK. grn_number:", grnNumber, "stock_doc:", postingResp.data[0]);

    const postingRow = postingResp.data[0] as JsonRecord;

    // Mark GRN as POSTED
    await serviceRoleClient.schema("erp_procurement").from("goods_receipt")
      .update({
        status: "POSTED",
        stock_document_id: postingRow.stock_document_id ?? null,
        stock_ledger_id: postingRow.stock_ledger_id ?? null,
        posted_by: ctx.auth_user_id,
        posted_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
      })
      .eq("id", String(grn.id));

    // Mark GE line as done
    await serviceRoleClient.schema("erp_procurement").from("gate_entry_line")
      .update({ grn_posted: true }).eq("id", gateEntryLineId);

    // PO line update
    if (geLine.po_line_id) {
      await updatePoLineReceipt(String(geLine.po_line_id), receivedQty);
      if (poLineData?.vendor_material_info_id) {
        await serviceRoleClient.schema("erp_master").from("vendor_material_info")
          .update({ last_purchase_price: effectiveGrnRate, last_grn_date: grnDate })
          .eq("id", String(poLineData.vendor_material_info_id));
      }
    }

    // QA document
    if (targetStockType === "QUALITY_INSPECTION" || Boolean(material.qa_required_on_inward)) {
      await createQaDocumentForGrn(
        ctx, grn as GrnRow,
        String(geLine.material_id),
        stockQty,
        baseUomCode,
        targetStockType,
        toTrimmedString(grn.batch_lot_number) || null,
        geLine.po_line_id ? String(geLine.po_line_id) : null,
        null,
      );
    }

    // CSN sync-back
    const csnId = toTrimmedString(geLine.csn_id);
    if (csnId) {
      const vendorType = toUpperTrimmedString(poData?.vendor_type) || "DOMESTIC";
      const csnPatch: JsonRecord = {
        status: "GRD",
        grn_id: grn.id,
        grn_date: grnDate,
        received_qty: receivedQty,
        total_received_qty: receivedQty,
        invoice_number: grn.invoice_number ?? null,
        last_updated_at: new Date().toISOString(),
      };
      if (vendorType === "DOMESTIC") {
        csnPatch.domestic_transporter_id = grn.transporter_id ?? null;
        csnPatch.lr_number = grn.lr_number ?? null;
        csnPatch.lr_date = grn.lr_date ?? null;
      } else {
        csnPatch.transporter_id = grn.transporter_id ?? null;
        csnPatch.bl_number = grn.bl_number ?? null;
        csnPatch.bl_date = grn.bl_date ?? null;
        csnPatch.boe_number = grn.boe_number ?? null;
        csnPatch.boe_date = grn.boe_date ?? null;
        csnPatch.lr_number_port_to_plant = grn.lr_number ?? null;
        csnPatch.post_clearance_lr_date = grn.lr_date ?? null;
      }
      await serviceRoleClient.schema("erp_procurement").from("consignment_note")
        .update(csnPatch).eq("id", csnId);
    }

    // Save material_vendor_doc_name if new invoice_name given
    const invoiceName = toTrimmedString(grn.invoice_name);
    if (invoiceName && vendorId && grn.material_id) {
      await serviceRoleClient.schema("erp_master").from("material_vendor_doc_name")
        .upsert(
          { material_id: String(grn.material_id), vendor_id: vendorId, doc_name: invoiceName },
          { onConflict: "material_id,vendor_id,doc_name", ignoreDuplicates: true },
        );
    }

    // Check if all GE lines posted → update GE status
    const { data: geLines } = await serviceRoleClient.schema("erp_procurement").from("gate_entry_line")
      .select("grn_posted").eq("gate_entry_id", String(geLine.gate_entry_id));
    const allPosted = (geLines ?? []).every((l: JsonRecord) => l.grn_posted === true);
    if (allPosted) {
      await serviceRoleClient.schema("erp_procurement").from("gate_entry")
        .update({ status: "GRN_POSTED", last_updated_at: new Date().toISOString() })
        .eq("id", String(geLine.gate_entry_id));
    }

    console.log("[GRN_FROM_LINE] SUCCESS grn_number:", grnNumber, "status: POSTED");
    return okResponse(await hydrateGrn(String(grn.id)), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GRN_CREATE_FAILED";
    console.error("[GRN_FROM_LINE] UNHANDLED ERROR:", message, error instanceof Error ? error.stack : JSON.stringify(error));
    const status = message.includes("REQUIRED") ? 400 : message.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, message, status, message);
  }
}

// ── GET /api/procurement/grns ────────────────────────────────────────────────
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
    const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);

    let query = serviceRoleClient
      .schema("erp_procurement").from("goods_receipt")
      .select("id, grn_number, grn_date, status, company_id, vendor_id, gate_entry_id, gate_entry_line_id, material_id, received_qty, uom_code, po_id, invoice_number, invoice_date, transporter_id, lr_number, lr_date")
      .order("grn_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (companyId) query = query.eq("company_id", companyId);
    if (status && GRN_STATUSES.has(status)) query = query.eq("status", status);
    if (vendorId) query = query.eq("vendor_id", vendorId);
    if (dateFrom) query = query.gte("grn_date", dateFrom);
    if (dateTo) query = query.lte("grn_date", dateTo);

    const { data, error } = await query;
    if (error) {
      return procurementErrorResponse(req, ctx, "GRN_LIST_FAILED", 500, "Unable to list GRNs.");
    }

    const rows = (data ?? []) as JsonRecord[];
    if (rows.length === 0) return okResponse({ items: [] }, ctx.request_id, req);

    // Bulk resolve FKs
    const vendorIds = [...new Set(rows.map((r) => String(r.vendor_id ?? "")).filter(Boolean))];
    const materialIds = [...new Set(rows.map((r) => String(r.material_id ?? "")).filter(Boolean))];
    const geIds = [...new Set(rows.map((r) => String(r.gate_entry_id ?? "")).filter(Boolean))];
    const transporterIds = [...new Set(rows.map((r) => String(r.transporter_id ?? "")).filter(Boolean))];

    const [vendorResp, matResp, geResp, transporterResp] = await Promise.all([
      vendorIds.length > 0
        ? serviceRoleClient.schema("erp_master").from("vendor_master")
            .select("id, vendor_code, vendor_name").in("id", vendorIds)
        : { data: [], error: null },
      materialIds.length > 0
        ? serviceRoleClient.schema("erp_master").from("material_master")
            .select("id, pace_code, material_name").in("id", materialIds)
        : { data: [], error: null },
      geIds.length > 0
        ? serviceRoleClient.schema("erp_procurement").from("gate_entry")
            .select("id, ge_number").in("id", geIds)
        : { data: [], error: null },
      transporterIds.length > 0
        ? serviceRoleClient.schema("erp_master").from("transporter_master")
            .select("id, transporter_code, transporter_name").in("id", transporterIds)
        : { data: [], error: null },
    ]);

    // For old-style GRNs, fetch total_qty from lines
    const oldStyleIds = rows.filter((r) => !r.gate_entry_line_id).map((r) => String(r.id));
    let lineQtyMap = new Map<string, number>();
    if (oldStyleIds.length > 0) {
      const { data: lineQtyRows } = await serviceRoleClient
        .schema("erp_procurement").from("goods_receipt_line")
        .select("grn_id, received_qty").in("grn_id", oldStyleIds);
      for (const lr of (lineQtyRows ?? []) as JsonRecord[]) {
        const prev = lineQtyMap.get(String(lr.grn_id)) ?? 0;
        lineQtyMap.set(String(lr.grn_id), prev + (parseNullableNumber(lr.received_qty) ?? 0));
      }
    }

    const vendorMap = new Map((vendorResp.data ?? []).map((v: JsonRecord) => [v.id, v]));
    const matMap = new Map((matResp.data ?? []).map((m: JsonRecord) => [m.id, m]));
    const geMap = new Map((geResp.data ?? []).map((g: JsonRecord) => [g.id, g]));
    const transporterMap = new Map((transporterResp.data ?? []).map((t: JsonRecord) => [t.id, t]));

    const enriched = rows.map((r) => {
      const vendor = vendorMap.get(String(r.vendor_id));
      const mat = matMap.get(String(r.material_id));
      const ge = geMap.get(String(r.gate_entry_id));
      const transporter = transporterMap.get(String(r.transporter_id));
      const isNewStyle = Boolean(r.gate_entry_line_id);
      const totalQty = isNewStyle
        ? (parseNullableNumber(r.received_qty) ?? 0)
        : (lineQtyMap.get(String(r.id)) ?? 0);
      return {
        id: r.id,
        grn_number: r.grn_number,
        grn_date: r.grn_date,
        status: r.status,
        vendor_code: vendor?.vendor_code ?? null,
        vendor_name: vendor?.vendor_name ?? null,
        material_code: mat?.pace_code ?? null,
        material_name: mat?.material_name ?? null,
        ge_number: ge?.ge_number ?? null,
        received_qty: Number(totalQty.toFixed(6)),
        uom_code: r.uom_code ?? null,
        invoice_number: r.invoice_number ?? null,
        invoice_date: r.invoice_date ?? null,
        transporter_code: transporter?.transporter_code ?? null,
        transporter_name: transporter?.transporter_name ?? null,
        lr_number: r.lr_number ?? null,
        lr_date: r.lr_date ?? null,
      };
    });

    return okResponse({ items: enriched }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GRN_LIST_FAILED";
    return procurementErrorResponse(req, ctx, message, 500, message);
  }
}

// ── GET /api/procurement/grns/:id ────────────────────────────────────────────
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

// ── POST /api/procurement/grns/:id/reverse ───────────────────────────────────
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
      .schema("erp_procurement").from("goods_receipt")
      .select("*").eq("id", grnId).single();
    if (grnError || !grn) {
      return procurementErrorResponse(req, ctx, "GRN_NOT_FOUND", 404, "GRN not found.");
    }
    if (toUpperTrimmedString(grn.status) !== "POSTED") {
      return procurementErrorResponse(req, ctx, "GRN_NOT_POSTED", 400, "Only POSTED GRNs can be reversed.");
    }

    const isNewStyle = Boolean(grn.gate_entry_line_id);

    if (isNewStyle) {
      // New-style: data on header
      const material = await fetchMaterial(String(grn.material_id));
      const receivedQty = parsePositiveNumber(grn.received_qty) ?? 0;
      const stockTypeCode = toUpperTrimmedString(grn.target_stock_type) || "UNRESTRICTED";

      // Mirror the same PO-UOM -> base-UOM conversion used at posting time
      // (createAndPostGRNFromLineHandler) — otherwise the reversal moves the
      // wrong quantity/value when the GRN was received in a pack UOM
      // (e.g. PKT) that differs from the material's base UOM (e.g. NOS).
      const baseUomCode = toTrimmedString(material.base_uom_code) || toTrimmedString(grn.uom_code) || "PCS";
      const grnUomMismatch = toTrimmedString(grn.uom_code) !== baseUomCode;
      const grnPerPackQty = parseNullableNumber(grn.per_pack_qty);
      const reversalStockQty = grnUomMismatch && grnPerPackQty && grnPerPackQty > 0
        ? Number((receivedQty * grnPerPackQty).toFixed(6))
        : receivedQty;
      const reversalBaseUomRate = grnUomMismatch && grnPerPackQty && grnPerPackQty > 0
        ? Number(((parseNullableNumber(grn.grn_rate) ?? 0) / grnPerPackQty).toFixed(6))
        : (parseNullableNumber(grn.grn_rate) ?? 0);

      // §106: the reversal is its own Material Document (no more "-REV" suffix hack);
      // grn_number is the reference, and reversal_of_id links back to the original posting.
      const revMatDoc = await generateMaterialDocNumber(String(grn.company_id));
      const reversalResp = await serviceRoleClient.schema("erp_inventory")
        .rpc("post_stock_movement", {
          p_document_number: grn.grn_number,
          p_document_date: todayIsoDate(),
          p_posting_date: todayIsoDate(),
          p_movement_type_code: "P102",
          p_company_id: grn.company_id,
          p_storage_location_id: grn.storage_location_id,
          p_material_id: grn.material_id,
          p_quantity: reversalStockQty,
          p_base_uom_code: baseUomCode,
          p_unit_value: reversalBaseUomRate,
          p_stock_type_code: stockTypeCode,
          p_direction: "OUT",
          p_posted_by: ctx.auth_user_id,
          p_reversal_of_id: grn.stock_document_id,
          p_material_doc_number: revMatDoc.docNumber,
          p_material_doc_year: revMatDoc.docYear,
          p_reference_document_number: grn.grn_number,
          p_reference_document_type: "GRN",
          p_reference_document_id: grn.id ?? null,
        });
      if (reversalResp.error) {
        return procurementErrorResponse(req, ctx, "GRN_REVERSE_RPC_FAILED", 500, "Stock reversal failed.");
      }

      if (grn.po_line_id) await reversePoLineReceipt(String(grn.po_line_id), receivedQty);

      await serviceRoleClient.schema("erp_procurement").from("gate_entry_line")
        .update({ grn_posted: false }).eq("id", String(grn.gate_entry_line_id));

      // Void QA documents for this GRN
      await serviceRoleClient.schema("erp_procurement").from("inward_qa_document")
        .delete().eq("grn_id", grnId);

      // Reset CSN
      const { data: geLine } = await serviceRoleClient.schema("erp_procurement").from("gate_entry_line")
        .select("csn_id").eq("id", String(grn.gate_entry_line_id)).maybeSingle();
      const csnId = toTrimmedString(geLine?.csn_id);
      if (csnId) {
        await serviceRoleClient.schema("erp_procurement").from("consignment_note")
          .update({ status: "GED", grn_id: null, grn_date: null, received_qty: null, last_updated_at: new Date().toISOString() })
          .eq("id", csnId);
      }
    } else {
      // Old-style: iterate goods_receipt_line
      const { data: lines, error: linesError } = await serviceRoleClient
        .schema("erp_procurement").from("goods_receipt_line")
        .select("*").eq("grn_id", grnId).order("line_number", { ascending: true });
      if (linesError) {
        return procurementErrorResponse(req, ctx, "GRN_LINE_FETCH_FAILED", 500, "Unable to fetch GRN lines.");
      }

      // §106: one Material Document for the whole (multi-line) reversal event; grn_number
      // is the reference. Generated once, shared by every line's reversal item.
      const revLoopMatDoc = await generateMaterialDocNumber(String(grn.company_id));

      // DEPENDENT: each reversal mutates stock, PO, GE, and CSN state that later line checks must see in committed order.
      for (const line of (lines ?? []) as GrnLineRow[]) {
        const material = await fetchMaterial(String(line.material_id));
        const receivedQty = parsePositiveNumber(line.received_qty) ?? 0;
        const stockTypeCode = toUpperTrimmedString(line.target_stock_type) || "UNRESTRICTED";

        const reversalResp = await serviceRoleClient.schema("erp_inventory")
          .rpc("post_stock_movement", {
            p_document_number: grn.grn_number,
            p_document_date: todayIsoDate(),
            p_posting_date: todayIsoDate(),
            p_movement_type_code: "P102",
            p_company_id: grn.company_id,
            p_storage_location_id: line.storage_location_id,
            p_material_id: line.material_id,
            p_quantity: receivedQty,
            p_base_uom_code: material.base_uom_code ?? line.uom_code,
            p_unit_value: parseNullableNumber(line.grn_rate) ?? 0,
            p_stock_type_code: stockTypeCode,
            p_direction: "OUT",
            p_posted_by: ctx.auth_user_id,
            p_reversal_of_id: line.stock_document_id,
            p_material_doc_number: revLoopMatDoc.docNumber,
            p_material_doc_year: revLoopMatDoc.docYear,
            p_reference_document_number: grn.grn_number,
            p_reference_document_type: "GRN",
            p_reference_document_id: grn.id ?? null,
          });
        if (reversalResp.error) {
          return procurementErrorResponse(req, ctx, "GRN_REVERSE_RPC_FAILED", 500, "Stock reversal failed.");
        }

        if (line.po_line_id) await reversePoLineReceipt(String(line.po_line_id), receivedQty);

        await serviceRoleClient.schema("erp_procurement").from("gate_entry_line")
          .update({ grn_posted: false }).eq("id", String(line.gate_entry_line_id));

        const geLineResp = await serviceRoleClient.schema("erp_procurement").from("gate_entry_line")
          .select("csn_id").eq("id", String(line.gate_entry_line_id)).maybeSingle();
        const csnId = toTrimmedString(geLineResp.data?.csn_id);
        if (csnId) {
          await serviceRoleClient.schema("erp_procurement").from("consignment_note")
            .update({ status: "GED", grn_id: null, grn_date: null, received_qty: null, last_updated_at: new Date().toISOString() })
            .eq("id", csnId);
        }

        await serviceRoleClient.schema("erp_procurement").from("inward_qa_document")
          .delete().eq("grn_id", grnId).eq("grn_line_id", String(line.id));
      }
    }

    // Update GRN header
    await serviceRoleClient.schema("erp_procurement").from("goods_receipt")
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

    // Revert GE status to OPEN
    await serviceRoleClient.schema("erp_procurement").from("gate_entry")
      .update({ status: "OPEN", last_updated_at: new Date().toISOString() })
      .eq("id", String(grn.gate_entry_id));

    return okResponse(await hydrateGrn(grnId), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GRN_REVERSE_FAILED";
    const status = message.includes("REQUIRED") ? 400 : message.includes("NOT_FOUND") ? 404 : 500;
    return procurementErrorResponse(req, ctx, message, status, message);
  }
}

// ── Legacy handlers (kept for backward compat with existing DRAFT GRNs) ──────

export async function createGRNDraftHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  return procurementErrorResponse(req, ctx, "GRN_USE_FROM_LINE_ENDPOINT", 400, "Use POST /api/procurement/grns/from-line to create a GRN.");
}

export async function updateGRNDraftHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  return procurementErrorResponse(req, ctx, "GRN_UPDATE_NOT_SUPPORTED", 400, "New-style GRNs are created and posted in one step.");
}

export async function postGRNHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  return procurementErrorResponse(req, ctx, "GRN_USE_FROM_LINE_ENDPOINT", 400, "Use POST /api/procurement/grns/from-line to create and post a GRN.");
}
