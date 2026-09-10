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
 *          Every dispatch group (invoice + process/packing PO) also gets a
 *          synthesized FG summary row -- dispatch_reco itself carries no
 *          SKU/FG line (verified live), so the FG identity + RM/INT totals
 *          are built here from the packing order's own header material_id.
 *          Full design: feasibility doc Section 135, locked mock
 *          reco_data_mock.html (column order/row shapes are copied from that
 *          mock verbatim, not re-derived).
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
const STANDALONE_LABEL = "Standalone"; // AC09's own wording for an ungrouped material.
const FG_COSTING_GROUP_LABEL = "n/a — FG"; // Costing Group is an RM/PM/INT (AC06) concept only.

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
// (CLAUDE.md §83.2's own P-prefix convention) so "FG Type" reads
// consistently across every row shape in this report, and so the MTEST
// SO-Stroke fallback and the Page 1 FG Type filter both match real data
// instead of silently matching nothing (the exact live bug this
// normalization fixes -- an unnormalized po_type==="MTEST" check never
// matched a single real dispatch_reco row, since dispatch_reco only ever
// stores "PTEST").
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

// SO-Stroke re-derivation for a genuine stroke mismatch (SO Stroke != Actual
// Stroke -- the same population AC09 exists to report on, per its own
// declared_stroke_number-based check). "Standard Qty -- Dispatched Stroke"
// is simply the batch's own real process_order_line_reco.standard_qty (it
// IS the dosage-weighted standard under whatever stroke actually produced
// the batch). "Standard Qty -- SO Stroke" asks a different, hypothetical
// question -- what would Standard have been under the SO's OWN declared
// stroke's recipe, at this batch's real output quantity -- so it needs the
// SO stroke's own stroke_line dosage% and the process order's own actual_qty
// (its real output).
// ⚠️ UNVERIFIED against live data: live prod (2026-09-09) has zero real
// dispatch with a plan_feed.ordered_stroke_number/actual-stroke mismatch
// (the §135.3-locked "SO Stroke" source) to test this branch against --
// real mismatches DO exist in prod, but only under sales_order_line.
// declared_stroke_number (AC09's own source), a different column the
// locked §135.3 design deliberately did not choose. Falls back to the
// Dispatched-Stroke value (never a hard error, never a false zero) if the
// SO stroke's own stroke_master/stroke_line rows can't be resolved.
type SoStrokeResolution = {
  strokeMasterIdByProcessOrder: Map<string, string>;
  dosageByStrokeMaterial: Map<string, number>; // key = `${stroke_master_id}|${material_id}`
};

async function resolveSoStrokeStandardOverrides(
  companyId: string,
  cases: Array<{ processOrderId: string; prodshadeMaterialId: string; poType: string; soStroke: string }>,
): Promise<SoStrokeResolution> {
  const strokeMasterIdByProcessOrder = new Map<string, string>();
  const dosageByStrokeMaterial = new Map<string, number>();
  if (cases.length === 0) return { strokeMasterIdByProcessOrder, dosageByStrokeMaterial };

  const strokeKeyToCases = new Map<string, typeof cases>();
  for (const c of cases) {
    const key = `${c.prodshadeMaterialId}|${c.soStroke}|${c.poType}`;
    strokeKeyToCases.set(key, [...(strokeKeyToCases.get(key) ?? []), c]);
  }

  const lookups = await Promise.all([...strokeKeyToCases.entries()].map(async ([key, group]) => {
    const [prodshadeMaterialId, soStroke, poType] = key.split("|");
    const { data, error } = await serviceRoleClient.schema("erp_production").from("stroke_master")
      .select("id").eq("company_id", companyId).eq("prodshade_material_id", prodshadeMaterialId)
      .eq("stroke_number", soStroke).eq("po_type", poType).eq("status", "APPROVED").maybeSingle();
    if (error) throw new Error("RECO_DATA_SO_STROKE_LOOKUP_FAILED");
    return { strokeMasterId: data?.id ? textValue(data.id) : "", cases: group };
  }));

  for (const { strokeMasterId, cases: group } of lookups) {
    if (!strokeMasterId) continue;
    for (const c of group) strokeMasterIdByProcessOrder.set(c.processOrderId, strokeMasterId);
  }

  const strokeMasterIds = uniqueValues(lookups.map((l) => l.strokeMasterId));
  const lines = await fetchInChunks<JsonRecord>(strokeMasterIds, (chunk) => serviceRoleClient.schema("erp_production")
    .from("stroke_line").select("stroke_master_id, material_id, dosage_pct").in("stroke_master_id", chunk));
  for (const row of lines) {
    dosageByStrokeMaterial.set(`${textValue(row.stroke_master_id)}|${textValue(row.material_id)}`, numberValue(row.dosage_pct));
  }

  return { strokeMasterIdByProcessOrder, dosageByStrokeMaterial };
}

type RecoRow = {
  row_kind: "FG_SUMMARY" | "LINE";
  section: "DISPATCH" | "PARTIAL_REVERSAL" | "RPS";
  is_corrected: boolean;
  // §135.12: whether this dispatch is billed to Asian Paints at all -- a
  // plain INDEPENDENT_PARTY RM/PM/INT sale is a real sale with no AP
  // reconciliation concept behind it. Read straight off dispatch_reco's own
  // is_asian_billed column; always true for DISPATCH/PARTIAL_REVERSAL rows
  // in practice (both only ever exist for a batch-linked MTO/HPS/MTEST FG
  // dispatch, which is inherently Asian Paints' own production) -- the
  // real variation is on RPS rows.
  is_asian_billed: boolean;
  company_code: string;
  month_year: string;
  pace_doc_number: string;
  tally_invoice_number: string;
  tally_invoice_date: string;
  inbound_number: string;
  fo_number: string;
  dispatch_type: string;
  dispatch_category: string;
  type_badge: string;
  fg_type: string;
  pace_code: string;
  item_name: string;
  document_name: string;
  external_code: string;
  costing_group: string;
  process_order_number: string;
  batch_number: string;
  packing_order_number: string;
  so_stroke: string;
  actual_stroke: string;
  // §135.6-F (2026-09-10): the FG SKU this line belongs to, and the real
  // prodshade material attached to its batch's own Packing PO -- both
  // repeated on EVERY line (not just the FG_SUMMARY row) so a filtered/
  // sorted Excel view never loses which SKU/prodshade a row belongs to.
  sku_label: string;
  actual_prodshade_label: string;
  invoice_total_qty_kg: number | null;
  invoice_total_pack_qty: number | null;
  dispatch_qty_kg: number | null;
  pack_qty: number | null;
  dosage_or_qty: number | null;
  // §135.6-F: dosage_or_qty (above) is the ACTUAL/dispatched stroke's own
  // dosage% (or PM qty-per-pack) -- this is the SO stroke's OWN dosage% for
  // the same material, separate column, same RM/INT-only scope. Equal to
  // dosage_or_qty whenever SO Stroke == Actual Stroke (the common case);
  // only genuinely differs on a real mismatch.
  dosage_pct_so_stroke: number | null;
  standard_qty_so_stroke: number | null;
  standard_qty_dispatched_stroke: number | null;
  actual_qty: number | null;
  ap_approved_qty: number | null;
  invoice_id: string;
  material_id: string;
  group_key: string;
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
    // §135.6-D (2026-09-10): NOT filtered on is_voided anymore. A reversed
    // dispatch must still show in its OWN historical period (the receivable
    // was already recognized there) -- is_voided/voided_at stay write-only
    // audit markers now, never used to exclude a row from this report.
    // A PGI reversal instead writes a SEPARATE negative mirror row (same
    // material/PO/invoice identity, reversal_of_id pointing back to the
    // original, own tally_invoice_date = the reversal's own date) so the
    // set-off lands in the period the reversal actually happened in --
    // mirrors the already-locked PARTIAL_REVERSAL pattern below (section B).
    const dispatchRecoRows = await fetchAllRows<JsonRecord>((from, to) => serviceRoleClient
      .schema("erp_production").from("dispatch_reco")
      .select("id, invoice_id, invoice_number, invoice_date, tally_invoice_number, tally_invoice_date, inbound_number, dc_id, dc_number, source_type, so_id, so_number, fo_id, fo_number, dispatch_category, process_order_id, process_order_number, batch_number, packing_order_id, packing_order_number, po_type, dispatch_qty_kg, material_id, line_material_type, standard_qty, actual_qty, ap_approved_qty, is_voided, is_asian_billed, reversal_of_id")
      .eq("company_id", companyId)
      .gte("tally_invoice_date", dateFrom).lte("tally_invoice_date", dateTo)
      .order("tally_invoice_date", { ascending: true }).order("id", { ascending: true }).range(from, to));

    // ---- B. PARTIAL_REVERSAL rows, sourced directly from the reco tables --
    // dispatch_reco is written once at PGI time; a Partial Reversal happens
    // AFTER the batch was already dispatched/invoiced, so it never reaches
    // dispatch_reco at all. Filtered on last_updated_at (the only
    // append-timestamp these append-only tables carry) since there is no
    // dedicated posting-date column (§135.6-B). standard_qty IS selected --
    // process_order_line_reco/packing_order_line_reco carry a real (negated)
    // standard_qty on the PARTIAL_REVERSAL row too, confirmed live -- only
    // the SO-Stroke *derivation* is meaningless for a reversal (no SO/FO
    // attached), not the Dispatched-Stroke figure itself.
    const rangeStart = `${dateFrom}T00:00:00.000Z`;
    const rangeEnd = `${dateTo}T23:59:59.999Z`;
    const [processReversalRows, packingReversalRows] = await Promise.all([
      fetchAllRows<JsonRecord>((from, to) => serviceRoleClient.schema("erp_production").from("process_order_line_reco")
        .select("id, company_id, po_number, batch_number, po_type, process_order_id, material_id, line_material_type, standard_qty, actual_qty, ap_approved_qty, source_txn_type, reference_document_number, last_updated_at")
        .eq("company_id", companyId).eq("source_txn_type", "PARTIAL_REVERSAL").eq("is_voided", false)
        .gte("last_updated_at", rangeStart).lte("last_updated_at", rangeEnd)
        .order("last_updated_at", { ascending: true }).range(from, to)),
      fetchAllRows<JsonRecord>((from, to) => serviceRoleClient.schema("erp_production").from("packing_order_line_reco")
        .select("id, company_id, po_number, batch_number, po_type, packing_order_id, material_id, standard_qty, actual_qty, ap_approved_qty, source_txn_type, reference_document_number, last_updated_at")
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
    const soIds = uniqueValues(dispatchRecoRows.map((row) => row.so_id));

    const [processLineRecoRows, packingOrders, feeds, salesOrders, processOrderHeaders] = await Promise.all([
      fetchInChunks<JsonRecord>(processOrderIds, (chunk) => serviceRoleClient.schema("erp_production")
        .from("process_order_line_reco")
        .select("process_order_id, material_id, stroke_number, dosage_pct, line_material_type, source_txn_type, is_voided")
        .eq("is_voided", false).in("process_order_id", chunk)),
      fetchInChunks<JsonRecord>(packingOrderIds, (chunk) => serviceRoleClient.schema("erp_production")
        .from("packing_order").select("id, num_packs, material_id").in("id", chunk)),
      fetchInChunks<JsonRecord>(foIds, (chunk) => serviceRoleClient.schema("erp_production")
        .from("plan_feed").select("id, ordered_stroke_number").in("id", chunk)),
      fetchInChunks<JsonRecord>(soIds, (chunk) => serviceRoleClient.schema("erp_procurement")
        .from("sales_order").select("id, dispatch_type").in("id", chunk)),
      fetchInChunks<JsonRecord>(processOrderIds, (chunk) => serviceRoleClient.schema("erp_production")
        .from("process_order").select("id, material_id, actual_qty, po_type").in("id", chunk)),
    ]);

    // FG material identity (packing_order.material_id is the FG SKU header
    // field -- confirmed live, 2026-09-09 -- dispatch_reco itself never
    // carries an SKU line).
    const fgMaterialIdByPackingOrderId = new Map(packingOrders.map((row) => [textValue(row.id), textValue(row.material_id)]));
    const allFgMaterialIds = uniqueValues(packingOrders.map((row) => row.material_id));
    // §135.6-F: process_order.material_id is the batch's REAL prodshade
    // (what production actually made, per Packing PO) -- also needs
    // resolving for the new "Actual Prodshade" column.
    const allProdshadeMaterialIds = uniqueValues(processOrderHeaders.map((row) => row.material_id));
    const materials = await materialMap([...materialIds, ...allFgMaterialIds, ...allProdshadeMaterialIds]);
    function materialLabel(materialId: string): string {
      const m = materials.get(materialId);
      if (!m) return "";
      const name = textValue(m.document_name) || textValue(m.material_name);
      return name ? `${textValue(m.pace_code) || "—"} — ${name}` : textValue(m.pace_code);
    }

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
    const dispatchTypeBySoId = new Map(salesOrders.map((row) => [textValue(row.id), textValue(row.dispatch_type)]));
    const processOrderById = new Map(processOrderHeaders.map((row) => [textValue(row.id), row]));

    const monthsInRange = uniqueValues([
      ...dispatchRecoRows.map((row) => firstOfMonth(row.tally_invoice_date)),
    ]);
    const costingGroupByKey = await resolveCostingGroupNames(companyId, monthsInRange, materialIds);
    const costingGroupLabel = (materialId: string, tallyDate: unknown): string =>
      costingGroupByKey.get(`${firstOfMonth(tallyDate)}|${materialId}`) || STANDALONE_LABEL;

    // ---- Net-sum dispatch_reco rows per (invoice, process/packing PO, material) --
    // A COR6 correction that landed before PGI produces a SECOND raw
    // dispatch_reco row for the same material -- fold it into one row
    // (§135.6-A) instead of showing it twice. Verified against real prod
    // duplicates (2026-09-09): dispatch_qty_kg is a constant, denormalized
    // per (invoice, packing PO) value -- identical across every duplicate
    // row (e.g. 3220/3220, 10000/10000) -- so it is taken ONCE per group,
    // never summed; only Standard/Actual/AP-Approved genuinely vary between
    // the original and the correction and must be net-summed.
    // §135.6-D: a reversal_of_id row (negative mirror, own later
    // tally_invoice_date) must NEVER fold into the same group as its
    // original -- its dispatch_qty_kg is deliberately NOT the same constant
    // (it's negated), so the "take dispatch_qty_kg once" rule above would
    // silently discard the negative value and leave a misleading row (full
    // positive Dispatch Qty, ~zero Standard/Actual/AP). Reversal rows key
    // off their own id instead of the shared invoice/PO/material tuple, so
    // each always renders as its own distinct line in its own period.
    type DispatchGroup = {
      rows: JsonRecord[];
      dispatch_qty_kg: number;
      standard_qty: number | null;
      actual_qty: number | null;
      ap_approved_qty: number | null;
    };
    const dispatchGroups = new Map<string, DispatchGroup>();
    for (const row of dispatchRecoRows) {
      const isReversal = Boolean(textValue(row.reversal_of_id));
      const key = isReversal
        ? `REV|${textValue(row.id)}`
        : [
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
    // identity is a header field on packing_order (material_id), never
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

    // ---- SO-Stroke mismatch cases: collect once per (process order), not
    // per line -- the stroke lookup is shared by every RM/INT material in
    // that batch. See resolveSoStrokeStandardOverrides() header comment.
    const mismatchProcessOrderIds = new Set<string>();
    for (const [, group] of dispatchGroups) {
      const sample = group.rows[0];
      const processOrderId = textValue(sample.process_order_id);
      if (!processOrderId) continue;
      const foId = textValue(sample.fo_id);
      const soStroke = orderedStrokeByFoId.get(foId) ?? "";
      const actualStroke = strokeByProcessOrderId.get(processOrderId) ?? "";
      if (soStroke && actualStroke && upperValue(soStroke) !== upperValue(actualStroke)) {
        mismatchProcessOrderIds.add(processOrderId);
      }
    }
    const processOrderIdToFoId = new Map<string, string>();
    for (const [, group] of dispatchGroups) {
      const sample = group.rows[0];
      const poId = textValue(sample.process_order_id);
      if (poId && !processOrderIdToFoId.has(poId)) processOrderIdToFoId.set(poId, textValue(sample.fo_id));
    }
    const soStrokeMismatchCases = [...mismatchProcessOrderIds].map((processOrderId) => {
      const header = processOrderById.get(processOrderId);
      const foId = processOrderIdToFoId.get(processOrderId) ?? "";
      return {
        processOrderId,
        prodshadeMaterialId: textValue(header?.material_id),
        poType: normalizeFgType(header?.po_type),
        soStroke: orderedStrokeByFoId.get(foId) ?? "",
      };
    }).filter((c) => c.prodshadeMaterialId && c.soStroke);
    const soStrokeResolution = await resolveSoStrokeStandardOverrides(companyId, soStrokeMismatchCases);
    function resolveSoStrokeStandard(processOrderId: string, materialId: string, fallback: number | null): number | null {
      const strokeMasterId = soStrokeResolution.strokeMasterIdByProcessOrder.get(processOrderId);
      if (!strokeMasterId) return fallback;
      const outputQty = numberValue(processOrderById.get(processOrderId)?.actual_qty);
      const dosage = soStrokeResolution.dosageByStrokeMaterial.get(`${strokeMasterId}|${materialId}`);
      if (dosage === undefined) return fallback; // material not in the SO stroke's own recipe -- keep the dispatched-stroke figure rather than a false zero.
      return rounded((dosage / 100) * outputQty, 6);
    }
    // §135.6-F: raw SO-stroke dosage% (not the derived qty above) for the
    // new "Dosage % — SO Stroke" column. Same fallback rule: no mismatch,
    // or material absent from the SO stroke's own recipe -> use the
    // dispatched-stroke dosage rather than a false blank/zero.
    function resolveSoStrokeDosage(processOrderId: string, materialId: string, fallback: number | null): number | null {
      const strokeMasterId = soStrokeResolution.strokeMasterIdByProcessOrder.get(processOrderId);
      if (!strokeMasterId) return fallback;
      const dosage = soStrokeResolution.dosageByStrokeMaterial.get(`${strokeMasterId}|${materialId}`);
      return dosage === undefined ? fallback : dosage;
    }

    const dispatchRows: RecoRow[] = [...dispatchGroups.values()].map((group) => {
      const sample = group.rows[0];
      const materialId = textValue(sample.material_id);
      const material = materials.get(materialId);
      const processOrderId = textValue(sample.process_order_id);
      const packingOrderId = textValue(sample.packing_order_id);
      const isSku = upperValue(sample.line_material_type) === "SKU";
      const isPm = upperValue(sample.line_material_type) === "PM";
      const foId = textValue(sample.fo_id);
      const orderedStroke = orderedStrokeByFoId.get(foId) ?? "";
      const actualStroke = strokeByProcessOrderId.get(processOrderId) ?? "";
      const fgType = normalizeFgType(sample.po_type);
      // MTEST: SO and Actual stroke are the same formulation by definition
      // (§108-era MTEST design) -- fall back to Actual when no ordered
      // stroke exists on the FO instead of leaving SO Stroke blank.
      const soStroke = orderedStroke || (fgType === "MTEST" ? actualStroke : "");
      const invoiceId = textValue(sample.invoice_id);
      const section: RecoRow["section"] = upperValue(sample.dispatch_category).startsWith("RPS") || (!processOrderId && !packingOrderId) ? "RPS" : "DISPATCH";
      const dispatchQty = section === "RPS" ? null : rounded(group.dispatch_qty_kg, 6); // RPS: no "dispatch" concept, blank per locked mock.
      const standardDispatchedStroke = group.standard_qty === null ? null : rounded(group.standard_qty, 6);
      const actualQty = group.actual_qty === null ? null : rounded(group.actual_qty, 6);
      const apApprovedQty = group.ap_approved_qty === null ? null : rounded(group.ap_approved_qty, 6);
      // PM composition never depends on stroke -- both Standard columns are
      // identical for PM. For RM/INT, only differ on a genuine mismatch.
      const standardSoStroke = isSku || section === "RPS" ? null
        : isPm ? standardDispatchedStroke
        : (!soStroke || upperValue(soStroke) === upperValue(actualStroke))
          ? standardDispatchedStroke
          : resolveSoStrokeStandard(processOrderId, materialId, standardDispatchedStroke);
      const packCount = packCountByPackingOrderId.get(packingOrderId) ?? null;
      const dosageOrQty = isSku ? null
        : isPm ? (packCount ? rounded((group.actual_qty ?? 0) / packCount, 6) : null)
        : dosageByKey.get(`${processOrderId}|${materialId}`) ?? null;
      const dosageSoStroke = isSku || section === "RPS" ? null
        : isPm ? dosageOrQty // PM composition never depends on stroke.
        : (!soStroke || upperValue(soStroke) === upperValue(actualStroke))
          ? dosageOrQty
          : resolveSoStrokeDosage(processOrderId, materialId, dosageOrQty);
      const skuLabel = materialLabel(fgMaterialIdByPackingOrderId.get(packingOrderId) ?? "");
      const actualProdshadeLabel = materialLabel(textValue(processOrderById.get(processOrderId)?.material_id));
      return {
        row_kind: "LINE",
        section,
        // §135.6-D: a reversal_of_id row is a net-off credit, same visual
        // treatment (amber) as a COR6-netted line -- both mean "don't read
        // this as a first-pass dispatch figure without checking why".
        is_corrected: group.rows.length > 1 || Boolean(sample.reversal_of_id),
        is_asian_billed: sample.is_asian_billed !== false,
        company_code: companyCode,
        month_year: monthYear(sample.tally_invoice_date),
        pace_doc_number: textValue(sample.invoice_number),
        tally_invoice_number: textValue(sample.tally_invoice_number),
        tally_invoice_date: textValue(sample.tally_invoice_date),
        inbound_number: textValue(sample.inbound_number),
        fo_number: textValue(sample.fo_number),
        dispatch_type: dispatchTypeBySoId.get(textValue(sample.so_id)) ?? "",
        dispatch_category: textValue(sample.dispatch_category),
        type_badge: typeBadge(sample.line_material_type),
        fg_type: fgType,
        pace_code: textValue(material?.pace_code),
        item_name: textValue(material?.material_name),
        document_name: textValue(material?.document_name),
        external_code: textValue(material?.external_code),
        costing_group: costingGroupLabel(materialId, sample.tally_invoice_date),
        process_order_number: textValue(sample.process_order_number),
        batch_number: textValue(sample.batch_number),
        packing_order_number: textValue(sample.packing_order_number),
        so_stroke: soStroke,
        actual_stroke: actualStroke,
        sku_label: skuLabel,
        actual_prodshade_label: actualProdshadeLabel,
        invoice_total_qty_kg: invoiceId && packingOrderId ? rounded(invoiceTotalQty.get(invoiceId) ?? 0, 6) : null,
        invoice_total_pack_qty: invoiceId && packingOrderId ? rounded(invoiceTotalPack.get(invoiceId) ?? 0, 6) : null,
        dispatch_qty_kg: dispatchQty,
        pack_qty: packCount,
        dosage_or_qty: dosageOrQty,
        dosage_pct_so_stroke: dosageSoStroke,
        standard_qty_so_stroke: standardSoStroke,
        standard_qty_dispatched_stroke: standardDispatchedStroke,
        actual_qty: actualQty,
        ap_approved_qty: apApprovedQty,
        invoice_id: invoiceId,
        material_id: materialId,
        group_key: `${invoiceId}|${processOrderId}|${packingOrderId}`,
      };
    });

    // ---- FG summary row per dispatch group (locked mock's "sku-row") ----
    // Aggregates that group's own RM+INT lines (PM excluded, matching the
    // mock's own aggregation) into Standard(both)/Actual/AP-Approved totals,
    // carries the FG SKU's own identity (packing_order.material_id).
    const fgSummaryByGroupKey = new Map<string, RecoRow>();
    for (const line of dispatchRows) {
      if (line.section === "RPS") continue; // RPS has no packing order/FG identity at all.
      const packingOrderId = line.group_key.split("|")[2] ?? "";
      const fgMaterialId = fgMaterialIdByPackingOrderId.get(packingOrderId) ?? "";
      let summary = fgSummaryByGroupKey.get(line.group_key);
      if (!summary) {
        const fgMaterial = materials.get(fgMaterialId);
        summary = {
          row_kind: "FG_SUMMARY",
          section: line.section,
          is_corrected: false,
          is_asian_billed: line.is_asian_billed,
          company_code: line.company_code,
          month_year: line.month_year,
          pace_doc_number: line.pace_doc_number,
          tally_invoice_number: line.tally_invoice_number,
          tally_invoice_date: line.tally_invoice_date,
          inbound_number: line.inbound_number,
          fo_number: line.fo_number,
          dispatch_type: line.dispatch_type,
          dispatch_category: line.dispatch_category,
          type_badge: "FG",
          fg_type: line.fg_type,
          pace_code: textValue(fgMaterial?.pace_code),
          item_name: textValue(fgMaterial?.material_name),
          document_name: textValue(fgMaterial?.document_name),
          external_code: textValue(fgMaterial?.external_code),
          costing_group: FG_COSTING_GROUP_LABEL,
          process_order_number: line.process_order_number,
          batch_number: line.batch_number,
          packing_order_number: line.packing_order_number,
          so_stroke: line.so_stroke,
          actual_stroke: line.actual_stroke,
          sku_label: line.sku_label,
          actual_prodshade_label: line.actual_prodshade_label,
          invoice_total_qty_kg: line.invoice_total_qty_kg,
          invoice_total_pack_qty: line.invoice_total_pack_qty,
          dispatch_qty_kg: line.dispatch_qty_kg,
          pack_qty: line.pack_qty,
          // §135.6-F: SUM of this group's own RM+INT lines' dosage% (should
          // land close to 100% -- the recipe's own dosage total), not left
          // blank like the locked mock's other FG-row-blank fields.
          dosage_or_qty: null,
          dosage_pct_so_stroke: null,
          standard_qty_so_stroke: null,
          standard_qty_dispatched_stroke: null,
          actual_qty: null,
          ap_approved_qty: null,
          invoice_id: line.invoice_id,
          material_id: fgMaterialId,
          group_key: line.group_key,
        };
        fgSummaryByGroupKey.set(line.group_key, summary);
      }
      if (line.type_badge === "RM" || line.type_badge === "INT") {
        summary.standard_qty_so_stroke = (summary.standard_qty_so_stroke ?? 0) + (line.standard_qty_so_stroke ?? 0);
        summary.standard_qty_dispatched_stroke = (summary.standard_qty_dispatched_stroke ?? 0) + (line.standard_qty_dispatched_stroke ?? 0);
        summary.actual_qty = (summary.actual_qty ?? 0) + (line.actual_qty ?? 0);
        summary.ap_approved_qty = (summary.ap_approved_qty ?? 0) + (line.ap_approved_qty ?? 0);
        summary.dosage_or_qty = (summary.dosage_or_qty ?? 0) + (line.dosage_or_qty ?? 0);
        summary.dosage_pct_so_stroke = (summary.dosage_pct_so_stroke ?? 0) + (line.dosage_pct_so_stroke ?? 0);
      }
    }
    for (const summary of fgSummaryByGroupKey.values()) {
      if (summary.standard_qty_so_stroke !== null) summary.standard_qty_so_stroke = rounded(summary.standard_qty_so_stroke, 6);
      if (summary.standard_qty_dispatched_stroke !== null) summary.standard_qty_dispatched_stroke = rounded(summary.standard_qty_dispatched_stroke, 6);
      if (summary.actual_qty !== null) summary.actual_qty = rounded(summary.actual_qty, 6);
      if (summary.ap_approved_qty !== null) summary.ap_approved_qty = rounded(summary.ap_approved_qty, 6);
      if (summary.dosage_or_qty !== null) summary.dosage_or_qty = rounded(summary.dosage_or_qty, 4);
      if (summary.dosage_pct_so_stroke !== null) summary.dosage_pct_so_stroke = rounded(summary.dosage_pct_so_stroke, 4);
    }

    // ---- C. PARTIAL_REVERSAL rows (§135.6-B) ----
    // Borrow the ORIGINAL dispatch's PACE Doc # + Tally Invoice Date for
    // display (a reversal has no invoice of its own) by matching the same
    // (process/packing PO, material) key against the DISPATCH rows already
    // built above -- falls back to the reversal's own reference_document_number
    // when no matching original dispatch row is in this same date window.
    const originalByProcessMaterial = new Map<string, RecoRow>();
    const originalByPackingMaterial = new Map<string, RecoRow>();
    for (const line of dispatchRows) {
      const [, processOrderId, packingOrderId] = line.group_key.split("|");
      if (processOrderId) originalByProcessMaterial.set(`${processOrderId}|${line.material_id}`, line);
      if (packingOrderId) originalByPackingMaterial.set(`${packingOrderId}|${line.material_id}`, line);
    }

    const reversalRows: RecoRow[] = [
      ...processReversalRows.map((row) => {
        const processOrderId = textValue(row.process_order_id);
        const materialId = textValue(row.material_id);
        const material = materials.get(materialId);
        const original = originalByProcessMaterial.get(`${processOrderId}|${materialId}`);
        const standardQty = nullableNumber(row.standard_qty);
        const actualQty = nullableNumber(row.actual_qty);
        const apApprovedQty = nullableNumber(row.ap_approved_qty);
        const rev: RecoRow = {
          row_kind: "LINE",
          section: "PARTIAL_REVERSAL",
          is_corrected: false,
          is_asian_billed: true, // PR19 only ever corrects a batch-linked MTO/HPS/MTEST FG dispatch -- always Asian Paints' own production.
          company_code: companyCode,
          month_year: monthYear(original?.tally_invoice_date ?? ""),
          pace_doc_number: original?.pace_doc_number ?? textValue(row.reference_document_number),
          tally_invoice_number: "",
          tally_invoice_date: original?.tally_invoice_date ?? "",
          inbound_number: "",
          fo_number: "",
          dispatch_type: "",
          dispatch_category: "PREV",
          type_badge: typeBadge(row.line_material_type),
          fg_type: original?.fg_type ?? normalizeFgType(row.po_type),
          pace_code: textValue(material?.pace_code),
          item_name: textValue(material?.material_name),
          document_name: textValue(material?.document_name),
          external_code: textValue(material?.external_code),
          costing_group: original?.costing_group ?? STANDALONE_LABEL,
          process_order_number: textValue(row.po_number),
          batch_number: textValue(row.batch_number),
          packing_order_number: "",
          so_stroke: "", // no SO/FO attached to a reversal -- always blank (§135.6-B, corrected earlier this session).
          actual_stroke: original?.actual_stroke ?? strokeByProcessOrderId.get(processOrderId) ?? "",
          sku_label: original?.sku_label ?? "",
          actual_prodshade_label: original?.actual_prodshade_label ?? materialLabel(textValue(processOrderById.get(processOrderId)?.material_id)),
          invoice_total_qty_kg: null,
          invoice_total_pack_qty: null,
          dispatch_qty_kg: null,
          pack_qty: null,
          dosage_or_qty: null,
          dosage_pct_so_stroke: null,
          standard_qty_so_stroke: null,
          standard_qty_dispatched_stroke: standardQty === null ? null : rounded(standardQty, 6),
          actual_qty: actualQty === null ? null : rounded(actualQty, 6),
          ap_approved_qty: apApprovedQty === null ? null : rounded(apApprovedQty, 6),
          invoice_id: "",
          material_id: materialId,
          group_key: `PREV|${textValue(row.id)}`,
        };
        return rev;
      }),
      ...packingReversalRows.map((row) => {
        const packingOrderId = textValue(row.packing_order_id);
        const materialId = textValue(row.material_id);
        const material = materials.get(materialId);
        const original = originalByPackingMaterial.get(`${packingOrderId}|${materialId}`);
        const standardQty = nullableNumber(row.standard_qty);
        const actualQty = nullableNumber(row.actual_qty);
        const apApprovedQty = nullableNumber(row.ap_approved_qty);
        const rev: RecoRow = {
          row_kind: "LINE",
          section: "PARTIAL_REVERSAL",
          is_corrected: false,
          is_asian_billed: true, // PR19 only ever corrects a batch-linked MTO/HPS/MTEST FG dispatch -- always Asian Paints' own production.
          company_code: companyCode,
          month_year: monthYear(original?.tally_invoice_date ?? ""),
          pace_doc_number: original?.pace_doc_number ?? textValue(row.reference_document_number),
          tally_invoice_number: "",
          tally_invoice_date: original?.tally_invoice_date ?? "",
          inbound_number: "",
          fo_number: "",
          dispatch_type: "",
          dispatch_category: "PREV",
          type_badge: "PM",
          fg_type: original?.fg_type ?? normalizeFgType(row.po_type),
          pace_code: textValue(material?.pace_code),
          item_name: textValue(material?.material_name),
          document_name: textValue(material?.document_name),
          external_code: textValue(material?.external_code),
          costing_group: original?.costing_group ?? STANDALONE_LABEL,
          process_order_number: original?.process_order_number ?? "",
          batch_number: textValue(row.batch_number),
          packing_order_number: textValue(row.po_number),
          so_stroke: "",
          actual_stroke: original?.actual_stroke ?? "",
          sku_label: original?.sku_label ?? materialLabel(fgMaterialIdByPackingOrderId.get(packingOrderId) ?? ""),
          actual_prodshade_label: original?.actual_prodshade_label ?? "",
          invoice_total_qty_kg: null,
          invoice_total_pack_qty: null,
          dispatch_qty_kg: null,
          pack_qty: null,
          dosage_or_qty: null,
          dosage_pct_so_stroke: null,
          standard_qty_so_stroke: null,
          standard_qty_dispatched_stroke: standardQty === null ? null : rounded(standardQty, 6),
          actual_qty: actualQty === null ? null : rounded(actualQty, 6),
          ap_approved_qty: apApprovedQty === null ? null : rounded(apApprovedQty, 6),
          invoice_id: "",
          material_id: materialId,
          group_key: `PREV|${textValue(row.id)}`,
        };
        return rev;
      }),
    ];

    const allRows = [...fgSummaryByGroupKey.values(), ...dispatchRows, ...reversalRows];
    allRows.sort((left, right) => textValue(left.tally_invoice_date).localeCompare(textValue(right.tally_invoice_date))
      || left.group_key.localeCompare(right.group_key)
      || (left.row_kind === right.row_kind ? 0 : left.row_kind === "FG_SUMMARY" ? -1 : 1)
      || textValue(left.item_name).localeCompare(textValue(right.item_name)));

    return okResponse({ data: allRows }, ctx.request_id, req);
  } catch (err) {
    console.error("RECO_DATA_FAILED", err);
    const code = err instanceof Error ? err.message : "RECO_DATA_FAILED";
    return reportError(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, "Unable to load Reco Data report.");
  }
}
