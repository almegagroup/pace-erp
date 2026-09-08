/*
 * File-Path: supabase/functions/api/_core/procurement/reco_data.handlers.ts
 * Purpose: AC10 RECO DATA report (Accounts). First real consumer of the
 *          Stock-vs-AP-Reco two-layer model (§104) -- surfaces
 *          process_order_line_reco / packing_order_line_reco / dispatch_reco
 *          (Standard / Actual / AP Approved) for every posted dispatch in a
 *          Tally Invoice Date range, plus two row shapes that never reach
 *          dispatch_reco on their own:
 *            - PARTIAL_REVERSAL (PR19) rows, which append to the reco tables
 *              AFTER PGI already ran, so dispatch_reco never sees them --
 *              pulled directly from process_order_line_reco/
 *              packing_order_line_reco filtered by source_txn_type.
 *            - COR6_CORRECTION rows, which DO reach dispatch_reco (they land
 *              there whenever the correction happened before PGI), but as an
 *              extra raw row for the same material -- netted into the same
 *              dispatch row here rather than shown twice.
 *          RPS "Shape 2" rows (§133.18, plain RM/PM/INT dispatch with no
 *          packing_order_id) already exist in dispatch_reco as-is and need no
 *          special handling beyond passing their own dispatch_category
 *          through.
 *          Full design: feasibility doc Section 135.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { fetchAllRows } from "../../_shared/fetchAllRows.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { materialMap } from "../production/ac07_costing.handlers.ts";

type JsonRecord = Record<string, unknown>;
type RecoDataHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const RESOURCE = "ACC_RECO_DATA";
const MAX_RANGE_DAYS = 366;

function textValue(value: unknown): string {
  return String(value ?? "").trim();
}
function upperValue(value: unknown): string {
  return textValue(value).toUpperCase();
}
function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function rounded(value: number, decimals = 4): number {
  return Number(value.toFixed(decimals));
}
function uniqueValues(values: unknown[]): string[] {
  return [...new Set(values.map(textValue).filter(Boolean))];
}
function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function monthYear(value: unknown): string {
  const normalized = textValue(value);
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(normalized);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}
function firstOfMonth(value: unknown): string {
  const normalized = textValue(value);
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(normalized);
  return match ? `${match[1]}-${match[2]}-01` : "";
}
function typeBadge(lineMaterialType: unknown): string {
  const v = upperValue(lineMaterialType);
  return v === "SKU" ? "FG" : v; // internal row_type stays "SKU" -- only the rendered label is "FG" (§135.6).
}
// dispatch_reco.po_type stores the PACKING PO's own type family
// (PMTO/PHPS/PMTS/PTEST -- confirmed live, 2026-09-09), while
// process_order_line_reco.po_type stores the PROCESS PO family
// (MTO/HPS/MTS/MTEST) -- two different tables, two different vocabularies
// for the "same" concept. Normalized here to the Process PO family
// (CLAUDE.md §83.2's own P-prefix convention) so po_type reads consistently
// across every row shape in this report, and so the MTEST SO-Stroke
// fallback (§135.6-A) and the FG Type filter both match real data instead
// of silently matching nothing (the exact live bug this normalization
// fixes -- an unnormalized po_type==="MTEST" check never matched a single
// real dispatch_reco row, since dispatch_reco only ever stores "PTEST").
const FG_TYPE_MAP: Record<string, string> = { PMTO: "MTO", PHPS: "HPS", PMTS: "MTS", PTEST: "MTEST" };
function normalizeFgType(poType: unknown): string {
  const v = upperValue(poType);
  return FG_TYPE_MAP[v] ?? v;
}

function reportError(req: Request, ctx: RecoDataHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

// Named to satisfy company-scope-write-acl-guard.mjs's require\w*Access( detection.
async function requireViewAccess(req: Request, ctx: RecoDataHandlerContext, companyId: string): Promise<Response | null> {
  const allowed = await canMaintainCompanyResource(ctx, companyId, RESOURCE, "VIEW");
  return allowed ? null : reportError(req, ctx, "RECO_DATA_FORBIDDEN", 403, "You do not have Reco Data access for this company.");
}

// Costing Group name per (material, month) -- same AC06 open/live source AC09
// reads, but this report only needs the group-name snapshot, never the rate.
// CLOSED months read from ac06_month_archive_line instead of ac06_month_line
// -- same branch AC09's resolveRatesForMaterials() already makes; verified
// live against real prod data (2026-09-09) that CLOSED ac06_month rows do
// carry a real ac06_month_archive row, so this mirrors the established
// pattern rather than assuming ac06_month_line stays authoritative post-close.
async function resolveCostingGroupNames(
  companyId: string,
  months: string[],
  materialIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>(); // key = `${monthFirstDay}|${materialId}`
  if (months.length === 0 || materialIds.length === 0) return result;
  const { data: monthRows, error: monthErr } = await serviceRoleClient.schema("erp_production").from("ac06_month")
    .select("id, rate_month, status").eq("company_id", companyId).in("rate_month", months);
  if (monthErr) throw new Error("RECO_DATA_MONTH_LOOKUP_FAILED");
  for (const monthRow of (monthRows ?? []) as JsonRecord[]) {
    const monthId = textValue(monthRow.id);
    const monthKey = textValue(monthRow.rate_month);
    if (monthRow.status === "CLOSED") {
      const { data: archive, error: archErr } = await serviceRoleClient.schema("erp_production").from("ac06_month_archive")
        .select("id").eq("source_month_id", monthId).maybeSingle();
      if (archErr) throw new Error("RECO_DATA_ARCHIVE_LOOKUP_FAILED");
      if (!archive?.id) continue;
      const rows = await fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient.schema("erp_production")
        .from("ac06_month_archive_line").select("material_id, costing_group_name_snapshot")
        .eq("archive_id", textValue(archive.id)).in("material_id", chunk));
      for (const row of rows) {
        const name = textValue(row.costing_group_name_snapshot);
        if (name) result.set(`${monthKey}|${textValue(row.material_id)}`, name);
      }
      continue;
    }
    const rows = await fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient.schema("erp_production")
      .from("ac06_month_line").select("material_id, costing_group_name_snapshot")
      .eq("month_id", monthId).in("material_id", chunk));
    for (const row of rows) {
      const name = textValue(row.costing_group_name_snapshot);
      if (name) result.set(`${monthKey}|${textValue(row.material_id)}`, name);
    }
  }
  return result;
}

type RecoRow = {
  section: "DISPATCH" | "PARTIAL_REVERSAL" | "RPS";
  is_corrected: boolean;
  company_code: string;
  month_year: string;
  tally_invoice_number: string;
  tally_invoice_date: string;
  pace_doc_number: string;
  inbound_number: string;
  dispatch_category: string;
  fo_number: string;
  so_stroke: string;
  actual_stroke: string;
  process_order_number: string;
  batch_number: string;
  packing_order_number: string;
  po_type: string;
  type_badge: string;
  pace_code: string;
  item_name: string;
  external_code: string;
  costing_group: string;
  dosage_pct: number | null;
  invoice_total_qty_kg: number | null;
  invoice_total_pack_qty: number | null;
  dispatch_qty_kg: number | null;
  pack_qty: number | null;
  standard_qty: number | null;
  actual_qty: number | null;
  ap_approved_qty: number | null;
  variance: number | null;
  so_number: string;
  invoice_id: string;
  material_id: string;
};

// GET /api/procurement/reco-data
export async function getRecoDataHandler(req: Request, ctx: RecoDataHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = textValue(url.searchParams.get("company_id"));
    const dateFrom = textValue(url.searchParams.get("date_from"));
    const dateTo = textValue(url.searchParams.get("date_to"));
    const fromDate = parseIsoDate(dateFrom);
    const toDate = parseIsoDate(dateTo);
    if (!companyId) return reportError(req, ctx, "RECO_DATA_COMPANY_REQUIRED", 400, "company_id is required.");
    if (!fromDate || !toDate || toDate < fromDate) {
      return reportError(req, ctx, "RECO_DATA_DATE_INVALID", 400, "A valid Tally Invoice Date range is required.");
    }
    if ((toDate.getTime() - fromDate.getTime()) / 86400000 > MAX_RANGE_DAYS) {
      return reportError(req, ctx, "RECO_DATA_DATE_TOO_WIDE", 400, `Date range cannot exceed ${MAX_RANGE_DAYS} days.`);
    }
    await assertCompanyScope(ctx, companyId);
    const accessError = await requireViewAccess(req, ctx, companyId);
    if (accessError) return accessError;

    const { data: companyRow, error: companyErr } = await serviceRoleClient
      .schema("erp_master").from("companies").select("company_code").eq("id", companyId).maybeSingle();
    if (companyErr) throw new Error("RECO_DATA_COMPANY_LOOKUP_FAILED");
    const companyCode = textValue((companyRow as JsonRecord | null)?.company_code);

    // ---- A. DISPATCH + RPS rows, sourced from dispatch_reco (§135.6-A/-C) ----
    const dispatchRecoRows = await fetchAllRows<JsonRecord>((from, to) => serviceRoleClient
      .schema("erp_production").from("dispatch_reco")
      .select("id, invoice_id, invoice_number, invoice_date, tally_invoice_number, tally_invoice_date, inbound_number, dc_id, dc_number, source_type, so_id, so_number, fo_id, fo_number, dispatch_category, process_order_id, process_order_number, batch_number, packing_order_id, packing_order_number, po_type, dispatch_qty_kg, material_id, line_material_type, standard_qty, actual_qty, ap_approved_qty, is_voided")
      .eq("company_id", companyId).eq("is_voided", false)
      .gte("tally_invoice_date", dateFrom).lte("tally_invoice_date", dateTo)
      .order("tally_invoice_date", { ascending: true }).order("id", { ascending: true }).range(from, to));

    // ---- B. PARTIAL_REVERSAL rows, sourced directly from the reco tables --
    // dispatch_reco is written once at PGI time; a Partial Reversal happens
    // AFTER the batch was already dispatched/invoiced, so it never reaches
    // dispatch_reco at all. Filtered on last_updated_at (the only
    // append-timestamp these append-only tables carry) since there is no
    // dedicated posting-date column (§135.6-B).
    const rangeStart = `${dateFrom}T00:00:00.000Z`;
    const rangeEnd = `${dateTo}T23:59:59.999Z`;
    const [processReversalRows, packingReversalRows] = await Promise.all([
      fetchAllRows<JsonRecord>((from, to) => serviceRoleClient.schema("erp_production").from("process_order_line_reco")
        .select("id, company_id, po_number, batch_number, po_type, process_order_id, material_id, line_material_type, actual_qty, ap_approved_qty, source_txn_type, reference_document_number, last_updated_at")
        .eq("company_id", companyId).eq("source_txn_type", "PARTIAL_REVERSAL").eq("is_voided", false)
        .gte("last_updated_at", rangeStart).lte("last_updated_at", rangeEnd)
        .order("last_updated_at", { ascending: true }).range(from, to)),
      fetchAllRows<JsonRecord>((from, to) => serviceRoleClient.schema("erp_production").from("packing_order_line_reco")
        .select("id, company_id, po_number, batch_number, po_type, packing_order_id, material_id, actual_qty, ap_approved_qty, source_txn_type, reference_document_number, last_updated_at")
        .eq("company_id", companyId).eq("source_txn_type", "PARTIAL_REVERSAL").eq("is_voided", false)
        .gte("last_updated_at", rangeStart).lte("last_updated_at", rangeEnd)
        .order("last_updated_at", { ascending: true }).range(from, to)),
    ]);

    if (dispatchRecoRows.length === 0 && processReversalRows.length === 0 && packingReversalRows.length === 0) {
      return okResponse({ data: [] }, ctx.request_id, req);
    }

    // ---- Bulk lookups, independent of each other (§8B) ----
    const materialIds = uniqueValues([
      ...dispatchRecoRows.map((row) => row.material_id),
      ...processReversalRows.map((row) => row.material_id),
      ...packingReversalRows.map((row) => row.material_id),
    ]);
    const processOrderIds = uniqueValues([
      ...dispatchRecoRows.map((row) => row.process_order_id),
      ...processReversalRows.map((row) => row.process_order_id),
    ]);
    const packingOrderIds = uniqueValues([
      ...dispatchRecoRows.map((row) => row.packing_order_id),
      ...packingReversalRows.map((row) => row.packing_order_id),
    ]);
    const foIds = uniqueValues(dispatchRecoRows.map((row) => row.fo_id));

    const [materials, processLineRecoRows, packingOrders, feeds] = await Promise.all([
      materialMap(materialIds),
      fetchInChunks<JsonRecord>(processOrderIds, (chunk) => serviceRoleClient.schema("erp_production")
        .from("process_order_line_reco")
        .select("process_order_id, material_id, stroke_number, dosage_pct, line_material_type, source_txn_type, is_voided")
        .eq("is_voided", false).in("process_order_id", chunk)),
      fetchInChunks<JsonRecord>(packingOrderIds, (chunk) => serviceRoleClient.schema("erp_production")
        .from("packing_order").select("id, num_packs").in("id", chunk)),
      fetchInChunks<JsonRecord>(foIds, (chunk) => serviceRoleClient.schema("erp_production")
        .from("plan_feed").select("id, ordered_stroke_number").in("id", chunk)),
    ]);

    const strokeByProcessOrderId = new Map<string, string>();
    const dosageByKey = new Map<string, number>(); // `${process_order_id}|${material_id}` -> dosage_pct, PRODUCTION only
    for (const row of processLineRecoRows) {
      const poId = textValue(row.process_order_id);
      const stroke = textValue(row.stroke_number);
      if (stroke && !strokeByProcessOrderId.has(poId)) strokeByProcessOrderId.set(poId, stroke);
      if (upperValue(row.source_txn_type) === "PRODUCTION") {
        const dosage = nullableNumber(row.dosage_pct);
        if (dosage !== null) dosageByKey.set(`${poId}|${textValue(row.material_id)}`, dosage);
      }
    }
    const packCountByPackingOrderId = new Map(packingOrders.map((row) => [textValue(row.id), numberValue(row.num_packs)]));
    const orderedStrokeByFoId = new Map(feeds.map((row) => [textValue(row.id), textValue(row.ordered_stroke_number)]));

    const monthsInRange = uniqueValues([
      ...dispatchRecoRows.map((row) => firstOfMonth(row.tally_invoice_date)),
    ]);
    const costingGroupByKey = await resolveCostingGroupNames(companyId, monthsInRange, materialIds);

    // ---- Net-sum dispatch_reco rows per (invoice, process/packing PO, material) --
    // A COR6 correction that landed before PGI produces a SECOND raw
    // dispatch_reco row for the same material -- fold it into one row
    // (§135.6-A) instead of showing it twice. Verified against real prod
    // duplicates (2026-09-09): dispatch_qty_kg is a constant, denormalized
    // per (invoice, packing PO) value -- identical across every duplicate
    // row (e.g. 3220/3220, 10000/10000) -- so it is taken ONCE per group,
    // never summed; only Standard/Actual/AP-Approved genuinely vary between
    // the original and the correction and must be net-summed.
    type DispatchGroup = {
      rows: JsonRecord[];
      dispatch_qty_kg: number;
      standard_qty: number | null;
      actual_qty: number | null;
      ap_approved_qty: number | null;
    };
    const dispatchGroups = new Map<string, DispatchGroup>();
    for (const row of dispatchRecoRows) {
      const key = [
        textValue(row.invoice_id), textValue(row.process_order_id), textValue(row.packing_order_id), textValue(row.material_id),
      ].join("|");
      const group = dispatchGroups.get(key) ?? { rows: [], dispatch_qty_kg: numberValue(row.dispatch_qty_kg), standard_qty: null, actual_qty: null, ap_approved_qty: null };
      group.rows.push(row);
      const std = nullableNumber(row.standard_qty);
      const act = nullableNumber(row.actual_qty);
      const app = nullableNumber(row.ap_approved_qty);
      if (std !== null) group.standard_qty = (group.standard_qty ?? 0) + std;
      if (act !== null) group.actual_qty = (group.actual_qty ?? 0) + act;
      if (app !== null) group.ap_approved_qty = (group.ap_approved_qty ?? 0) + app;
      dispatchGroups.set(key, group);
    }

    // Invoice-level totals (§135.6 #21/#22). Verified against real prod data
    // (2026-09-09): dispatch_reco carries NO "SKU"/FG row at all -- the FG
    // identity is a header field on packing_order (sku_material_id), never
    // its own dispatch_reco line -- so "whole invoice total" is the SUM of
    // each DISTINCT (invoice, packing PO)'s own dispatch_qty_kg/pack count,
    // not a filter on line_material_type (dispatch_qty_kg is already the
    // same denormalized per-PO value on every one of its RM/PM/INT rows).
    const invoiceTotalQty = new Map<string, number>();
    const invoiceTotalPack = new Map<string, number>();
    const seenInvoicePackingPairs = new Set<string>();
    for (const [, group] of dispatchGroups) {
      const sample = group.rows[0];
      const invoiceId = textValue(sample.invoice_id);
      const packingOrderId = textValue(sample.packing_order_id);
      const pairKey = `${invoiceId}|${packingOrderId}`;
      if (!invoiceId || !packingOrderId || seenInvoicePackingPairs.has(pairKey)) continue;
      seenInvoicePackingPairs.add(pairKey);
      invoiceTotalQty.set(invoiceId, (invoiceTotalQty.get(invoiceId) ?? 0) + group.dispatch_qty_kg);
      const packCount = packCountByPackingOrderId.get(packingOrderId) ?? 0;
      invoiceTotalPack.set(invoiceId, (invoiceTotalPack.get(invoiceId) ?? 0) + packCount);
    }

    const dispatchRows: RecoRow[] = [...dispatchGroups.values()].map((group) => {
      const sample = group.rows[0];
      const materialId = textValue(sample.material_id);
      const material = materials.get(materialId);
      const processOrderId = textValue(sample.process_order_id);
      const packingOrderId = textValue(sample.packing_order_id);
      const isSku = upperValue(sample.line_material_type) === "SKU";
      const foId = textValue(sample.fo_id);
      const orderedStroke = orderedStrokeByFoId.get(foId) ?? "";
      const actualStroke = strokeByProcessOrderId.get(processOrderId) ?? "";
      // MTEST: SO and Actual stroke are the same formulation by definition
      // (§108-era MTEST design) -- fall back to Actual when no ordered
      // stroke exists on the FO instead of leaving SO Stroke blank.
      const soStroke = orderedStroke || (normalizeFgType(sample.po_type) === "MTEST" ? actualStroke : "");
      const invoiceId = textValue(sample.invoice_id);
      const dispatchQty = rounded(group.dispatch_qty_kg, 6);
      const standardQty = group.standard_qty === null ? null : rounded(group.standard_qty, 6);
      const actualQty = group.actual_qty === null ? null : rounded(group.actual_qty, 6);
      const apApprovedQty = group.ap_approved_qty === null ? null : rounded(group.ap_approved_qty, 6);
      return {
        section: upperValue(sample.dispatch_category).startsWith("RPS") || (!processOrderId && !packingOrderId) ? "RPS" : "DISPATCH",
        is_corrected: group.rows.length > 1,
        company_code: companyCode,
        month_year: monthYear(sample.tally_invoice_date),
        tally_invoice_number: textValue(sample.tally_invoice_number),
        tally_invoice_date: textValue(sample.tally_invoice_date),
        pace_doc_number: textValue(sample.invoice_number),
        inbound_number: textValue(sample.inbound_number),
        dispatch_category: textValue(sample.dispatch_category),
        fo_number: textValue(sample.fo_number),
        so_stroke: soStroke,
        actual_stroke: actualStroke,
        process_order_number: textValue(sample.process_order_number),
        batch_number: textValue(sample.batch_number),
        packing_order_number: textValue(sample.packing_order_number),
        po_type: normalizeFgType(sample.po_type),
        type_badge: typeBadge(sample.line_material_type),
        pace_code: textValue(material?.pace_code),
        item_name: textValue(material?.material_name),
        external_code: textValue(material?.external_code),
        costing_group: costingGroupByKey.get(`${firstOfMonth(sample.tally_invoice_date)}|${materialId}`) ?? "",
        dosage_pct: isSku ? null : dosageByKey.get(`${processOrderId}|${materialId}`) ?? null,
        invoice_total_qty_kg: invoiceId && packingOrderId ? rounded(invoiceTotalQty.get(invoiceId) ?? 0, 6) : null,
        invoice_total_pack_qty: invoiceId && packingOrderId ? rounded(invoiceTotalPack.get(invoiceId) ?? 0, 6) : null,
        dispatch_qty_kg: dispatchQty,
        pack_qty: packingOrderId ? (packCountByPackingOrderId.get(packingOrderId) ?? null) : null,
        standard_qty: standardQty,
        actual_qty: actualQty,
        ap_approved_qty: apApprovedQty,
        variance: actualQty !== null && apApprovedQty !== null ? rounded(actualQty - apApprovedQty, 6) : null,
        so_number: textValue(sample.so_number),
        invoice_id: invoiceId,
        material_id: materialId,
      };
    });

    // ---- C. PARTIAL_REVERSAL rows (§135.6-B) ----
    // Borrow the ORIGINAL dispatch's PACE Doc # + Tally Invoice Date for
    // display (a reversal has no invoice of its own) by matching the same
    // (process/packing PO, material) key against the DISPATCH rows already
    // built above -- falls back to the reversal's own reference_document_number
    // when no matching original dispatch row is in this same date window.
    const originalByProcessMaterial = new Map<string, RecoRow>();
    const originalByPackingMaterial = new Map<string, RecoRow>();
    for (const [key, group] of dispatchGroups) {
      const [invoiceId, processOrderId, packingOrderId, materialId] = key.split("|");
      const built = dispatchRows.find((r) => r.invoice_id === invoiceId && r.material_id === materialId
        && r.process_order_number === textValue(group.rows[0].process_order_number)
        && r.packing_order_number === textValue(group.rows[0].packing_order_number));
      if (!built) continue;
      if (processOrderId) originalByProcessMaterial.set(`${processOrderId}|${materialId}`, built);
      if (packingOrderId) originalByPackingMaterial.set(`${packingOrderId}|${materialId}`, built);
    }

    const reversalRows: RecoRow[] = [
      ...processReversalRows.map((row) => {
        const processOrderId = textValue(row.process_order_id);
        const materialId = textValue(row.material_id);
        const material = materials.get(materialId);
        const original = originalByProcessMaterial.get(`${processOrderId}|${materialId}`);
        const actualQty = nullableNumber(row.actual_qty);
        const apApprovedQty = nullableNumber(row.ap_approved_qty);
        return {
          section: "PARTIAL_REVERSAL" as const,
          is_corrected: false,
          company_code: companyCode,
          month_year: monthYear(original?.tally_invoice_date ?? ""),
          tally_invoice_number: "",
          tally_invoice_date: original?.tally_invoice_date ?? "",
          pace_doc_number: original?.pace_doc_number ?? textValue(row.reference_document_number),
          inbound_number: "",
          dispatch_category: "PREV",
          fo_number: "",
          so_stroke: "",
          actual_stroke: strokeByProcessOrderId.get(processOrderId) ?? "",
          process_order_number: textValue(row.po_number),
          batch_number: textValue(row.batch_number),
          packing_order_number: "",
          po_type: normalizeFgType(row.po_type),
          type_badge: typeBadge(row.line_material_type),
          pace_code: textValue(material?.pace_code),
          item_name: textValue(material?.material_name),
          external_code: textValue(material?.external_code),
          costing_group: original?.costing_group ?? "",
          dosage_pct: null,
          invoice_total_qty_kg: null,
          invoice_total_pack_qty: null,
          dispatch_qty_kg: null,
          pack_qty: null,
          standard_qty: null,
          actual_qty: actualQty === null ? null : rounded(actualQty, 6),
          ap_approved_qty: apApprovedQty === null ? null : rounded(apApprovedQty, 6),
          variance: actualQty !== null && apApprovedQty !== null ? rounded(actualQty - apApprovedQty, 6) : null,
          so_number: "",
          invoice_id: "",
          material_id: materialId,
        };
      }),
      ...packingReversalRows.map((row) => {
        const packingOrderId = textValue(row.packing_order_id);
        const materialId = textValue(row.material_id);
        const material = materials.get(materialId);
        const original = originalByPackingMaterial.get(`${packingOrderId}|${materialId}`);
        const actualQty = nullableNumber(row.actual_qty);
        const apApprovedQty = nullableNumber(row.ap_approved_qty);
        return {
          section: "PARTIAL_REVERSAL" as const,
          is_corrected: false,
          company_code: companyCode,
          month_year: monthYear(original?.tally_invoice_date ?? ""),
          tally_invoice_number: "",
          tally_invoice_date: original?.tally_invoice_date ?? "",
          pace_doc_number: original?.pace_doc_number ?? textValue(row.reference_document_number),
          inbound_number: "",
          dispatch_category: "PREV",
          fo_number: "",
          so_stroke: "",
          actual_stroke: original?.actual_stroke ?? "",
          process_order_number: original?.process_order_number ?? "",
          batch_number: textValue(row.batch_number),
          packing_order_number: textValue(row.po_number),
          po_type: normalizeFgType(row.po_type),
          type_badge: "PM",
          pace_code: textValue(material?.pace_code),
          item_name: textValue(material?.material_name),
          external_code: textValue(material?.external_code),
          costing_group: original?.costing_group ?? "",
          dosage_pct: null,
          invoice_total_qty_kg: null,
          invoice_total_pack_qty: null,
          dispatch_qty_kg: null,
          pack_qty: null,
          standard_qty: null,
          actual_qty: actualQty === null ? null : rounded(actualQty, 6),
          ap_approved_qty: apApprovedQty === null ? null : rounded(apApprovedQty, 6),
          variance: actualQty !== null && apApprovedQty !== null ? rounded(actualQty - apApprovedQty, 6) : null,
          so_number: "",
          invoice_id: "",
          material_id: materialId,
        };
      }),
    ];

    const allRows = [...dispatchRows, ...reversalRows];
    allRows.sort((left, right) => textValue(left.tally_invoice_date).localeCompare(textValue(right.tally_invoice_date))
      || textValue(left.pace_doc_number).localeCompare(textValue(right.pace_doc_number), undefined, { numeric: true })
      || textValue(left.item_name).localeCompare(textValue(right.item_name)));

    return okResponse({ data: allRows }, ctx.request_id, req);
  } catch (err) {
    console.error("RECO_DATA_FAILED", err);
    const code = err instanceof Error ? err.message : "RECO_DATA_FAILED";
    return reportError(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, "Unable to load Reco Data report.");
  }
}
