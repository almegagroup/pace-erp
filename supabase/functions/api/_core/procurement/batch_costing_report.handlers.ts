/*
 * File-Path: supabase/functions/api/_core/procurement/batch_costing_report.handlers.ts
 * Purpose: AC09 Batch Costing Report (Accounts). For every dispatched MTO/HPS
 *          item where the SO's declared Stroke does not match the Stroke the
 *          batch was actually produced from (the same mismatch SO04's own
 *          "Stroke Mismatch only" checkbox flags), explode AC07's own
 *          dosage-weighted RM/INT/PM/Conversion calculation into a flat,
 *          PR24-style ledger -- one row per line (SKU identity, each RM/INT,
 *          Conversion, each PM, then two FG-rate rows: per kg and per Pack).
 *          Every row carries the SAME dispatch-identity columns SO04 itself
 *          uses (Company through Actual Stroke), never blanked/grouped, so a
 *          spreadsheet export never loses context on any single line.
 *          RM/INT/Conversion/PM lines each carry a Cost column for BOTH the
 *          SO Stroke and the Dispatched/Actual Stroke side by side -- SO
 *          Stroke blanks out for a material/row whenever that declared
 *          stroke was never actually created in Stroke Master (business
 *          owner rule, same as AC08). PM/Conversion never depend on which
 *          stroke was used, so both columns carry the identical value.
 *          Rate resolution follows the SO line's own Costing Rate Month: a
 *          real month resolves from AC06 (open/live or Closed/archive); a
 *          "MANUAL" month resolves from AC08's own saved
 *          erp_procurement.manual_costing_rate_entry rows for that SO line.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { fetchAllRows } from "../../_shared/fetchAllRows.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { materialMap, packCodeRow, resolvePmComposition } from "../production/ac07_costing.handlers.ts";

type JsonRecord = Record<string, unknown>;
type BatchCostingHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const RESOURCE = "ACC_BATCH_COSTING_REPORT";
const FG_TYPES = ["MTO", "HPS"];
const SEGMENT_BY_FG_TYPE: Record<string, string> = { MTO: "ADMIX", HPS: "HPS" };
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

function reportError(req: Request, ctx: BatchCostingHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

// Named to satisfy company-scope-write-acl-guard.mjs's require\w*Access( detection.
async function requireViewAccess(req: Request, ctx: BatchCostingHandlerContext, companyId: string): Promise<Response | null> {
  const allowed = await canMaintainCompanyResource(ctx, companyId, RESOURCE, "VIEW");
  return allowed ? null : reportError(req, ctx, "BCR_FORBIDDEN", 403, "You do not have Batch Costing Report access for this company.");
}

// Same qty-per-pack math AC08/AC07 already use -- PM composition drawn from
// the ONE specific Packing PO this batch actually dispatched from (used only
// for non-fixed/variable-fill pack codes, 599/000/001).
async function actualPackingOrderPmLines(packingOrder: JsonRecord): Promise<JsonRecord[]> {
  const packingOrderId = textValue(packingOrder.id);
  if (!packingOrderId) return [];
  const { data: allLines, error } = await serviceRoleClient.schema("erp_production")
    .from("packing_order_line")
    .select("line_type, material_id, actual_material_id, qty_per_pack, total_qty, actual_qty")
    .eq("packing_order_id", packingOrderId);
  if (error) throw new Error("BCR_PACKING_PO_LINE_LOOKUP_FAILED");
  const pmLines = ((allLines ?? []) as JsonRecord[]).filter((row) => row.line_type === "PM");
  if (pmLines.length === 0) return [];
  const packCount = Number(packingOrder.num_packs ?? 0);
  return pmLines.map((line) => {
    const materialId = textValue(line.actual_material_id) || textValue(line.material_id);
    const actualQty = Number(line.actual_qty ?? line.total_qty ?? 0);
    const storedQtyPerPack = Number(line.qty_per_pack ?? 0);
    return { material_id: materialId, qty: packCount > 0 ? actualQty / packCount : storedQtyPerPack };
  });
}

type RateInfo = { rate: number | null; wastage_other_pct: number; costing_group_name: string | null; source: string };

async function resolveRatesForMaterials(
  companyId: string,
  soLineId: string,
  costingRateMonth: string,
  materialIds: string[],
): Promise<Map<string, RateInfo>> {
  const result = new Map<string, RateInfo>();
  if (materialIds.length === 0) return result;

  if (upperValue(costingRateMonth) === "MANUAL") {
    const { data, error } = await serviceRoleClient.schema("erp_procurement").from("manual_costing_rate_entry")
      .select("material_id, rate").eq("sales_order_line_id", soLineId);
    if (error) throw new Error("BCR_MANUAL_RATE_LOOKUP_FAILED");
    for (const row of (data ?? []) as JsonRecord[]) {
      result.set(textValue(row.material_id), {
        rate: row.rate === null ? null : Number(row.rate),
        wastage_other_pct: 0,
        costing_group_name: null,
        source: "AC08 · Manual",
      });
    }
    return result;
  }

  const { data: monthRow, error: monthErr } = await serviceRoleClient.schema("erp_production").from("ac06_month")
    .select("id, rate_month, status").eq("company_id", companyId).eq("rate_month", costingRateMonth).maybeSingle();
  if (monthErr) throw new Error("BCR_MONTH_LOOKUP_FAILED");
  if (!monthRow) return result;

  const monthLabel = `AC06 · ${monthYear(costingRateMonth)} (${monthRow.status === "CLOSED" ? "Closed" : "Open"})`;
  if (monthRow.status === "CLOSED") {
    const { data: archive, error: archErr } = await serviceRoleClient.schema("erp_production").from("ac06_month_archive")
      .select("id").eq("source_month_id", textValue(monthRow.id)).maybeSingle();
    if (archErr) throw new Error("BCR_ARCHIVE_LOOKUP_FAILED");
    if (archive?.id) {
      const rows = await fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient.schema("erp_production")
        .from("ac06_month_archive_line").select("material_id, rate, wastage_other_pct, costing_group_name_snapshot")
        .eq("archive_id", textValue(archive.id)).in("material_id", chunk));
      for (const row of rows) result.set(textValue(row.material_id), {
        rate: row.rate === null ? null : Number(row.rate),
        wastage_other_pct: Number(row.wastage_other_pct ?? 0),
        costing_group_name: (row.costing_group_name_snapshot as string) ?? null,
        source: monthLabel,
      });
    }
  } else {
    const rows = await fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient.schema("erp_production")
      .from("ac06_month_line").select("material_id, rate, wastage_other_pct, costing_group_name_snapshot")
      .eq("month_id", textValue(monthRow.id)).in("material_id", chunk));
    for (const row of rows) result.set(textValue(row.material_id), {
      rate: row.rate === null ? null : Number(row.rate),
      wastage_other_pct: Number(row.wastage_other_pct ?? 0),
      costing_group_name: (row.costing_group_name_snapshot as string) ?? null,
      source: monthLabel,
    });
  }
  return result;
}

// GET /api/procurement/batch-costing-report
export async function getBatchCostingReportHandler(req: Request, ctx: BatchCostingHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = textValue(url.searchParams.get("company_id"));
    const dateFrom = textValue(url.searchParams.get("date_from"));
    const dateTo = textValue(url.searchParams.get("date_to"));
    const fromDate = parseIsoDate(dateFrom);
    const toDate = parseIsoDate(dateTo);
    if (!companyId) return reportError(req, ctx, "BCR_COMPANY_REQUIRED", 400, "company_id is required.");
    if (!fromDate || !toDate || toDate < fromDate) {
      return reportError(req, ctx, "BCR_DATE_INVALID", 400, "A valid Tally Invoice Date range is required.");
    }
    if ((toDate.getTime() - fromDate.getTime()) / 86400000 > MAX_RANGE_DAYS) {
      return reportError(req, ctx, "BCR_DATE_TOO_WIDE", 400, `Date range cannot exceed ${MAX_RANGE_DAYS} days.`);
    }
    await assertCompanyScope(ctx, companyId);
    const accessError = await requireViewAccess(req, ctx, companyId);
    if (accessError) return accessError;

    const { data: companyRow, error: companyErr } = await serviceRoleClient
      .schema("erp_master").from("companies").select("company_code").eq("id", companyId).maybeSingle();
    if (companyErr) throw new Error("BCR_COMPANY_LOOKUP_FAILED");
    const companyCode = textValue((companyRow as JsonRecord | null)?.company_code);

    const invoices = await fetchAllRows<JsonRecord>((from, to) => serviceRoleClient
      .schema("erp_procurement").from("sales_invoice")
      .select("id, invoice_number, invoice_date, company_id, dc_id, so_id, status, tally_invoice_number, tally_invoice_date, inbound_number, fo_number")
      .eq("company_id", companyId).eq("status", "POSTED")
      .gte("tally_invoice_date", dateFrom).lte("tally_invoice_date", dateTo)
      .order("tally_invoice_date", { ascending: true }).order("id", { ascending: true }).range(from, to));
    if (invoices.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    const invoiceIds = invoices.map((row) => textValue(row.id));
    const invoiceLines = await fetchInChunks<JsonRecord>(invoiceIds, (chunk) => serviceRoleClient
      .schema("erp_procurement").from("sales_invoice_line")
      .select("id, invoice_id, so_line_id, dc_line_id, material_id, quantity, taxable_value")
      .in("invoice_id", chunk), 50);

    const dcLineIds = uniqueValues(invoiceLines.map((row) => row.dc_line_id));
    const dcLines = await fetchInChunks<JsonRecord>(dcLineIds, (chunk) => serviceRoleClient
      .schema("erp_procurement").from("delivery_challan_line")
      .select("id, dc_id, so_line_id, material_id, batch_number, packing_order_id, pack_qty, pack_uom_code")
      .in("id", chunk));
    const dcLineById = new Map(dcLines.map((row) => [textValue(row.id), row]));

    const soLineIds = uniqueValues(invoiceLines.flatMap((line) => [line.so_line_id, dcLineById.get(textValue(line.dc_line_id))?.so_line_id]));
    const soLines = await fetchInChunks<JsonRecord>(soLineIds, (chunk) => serviceRoleClient
      .schema("erp_procurement").from("sales_order_line")
      .select("id, so_id, fg_type, declared_stroke_number, costing_rate_month")
      .in("id", chunk));
    const soLineById = new Map(soLines.map((row) => [textValue(row.id), row]));
    const soIds = uniqueValues([...invoices.map((row) => row.so_id), ...soLines.map((row) => row.so_id)]);
    const salesOrders = await fetchInChunks<JsonRecord>(soIds, (chunk) => serviceRoleClient
      .schema("erp_procurement").from("sales_order")
      .select("id, customer_po_number, dispatch_type, dispatch_category").in("id", chunk));
    const soById = new Map(salesOrders.map((row) => [textValue(row.id), row]));

    const materialIds = uniqueValues(invoiceLines.map((row) => row.material_id));
    const materials = await materialMap(materialIds);

    const packingOrderIds = uniqueValues(dcLines.map((row) => row.packing_order_id));
    const packingOrders = await fetchInChunks<JsonRecord>(packingOrderIds, (chunk) => serviceRoleClient
      .schema("erp_production").from("packing_order")
      .select("id, po_number, process_order_id, num_packs, actual_qty_kg").in("id", chunk));
    const packingById = new Map(packingOrders.map((row) => [textValue(row.id), row]));
    const processOrderIds = uniqueValues(packingOrders.map((row) => row.process_order_id));
    const processOrders = await fetchInChunks<JsonRecord>(processOrderIds, (chunk) => serviceRoleClient
      .schema("erp_production").from("process_order")
      .select("id, stroke_master_id").in("id", chunk));
    const processById = new Map(processOrders.map((row) => [textValue(row.id), row]));
    const actualStrokeIds = uniqueValues(processOrders.map((row) => row.stroke_master_id));
    const actualStrokeRows = await fetchInChunks<JsonRecord>(actualStrokeIds, (chunk) => serviceRoleClient
      .schema("erp_production").from("stroke_master")
      .select("id, stroke_number, prodshade_material_id").in("id", chunk));
    const strokeById = new Map(actualStrokeRows.map((row) => [textValue(row.id), row]));

    const invoiceById = new Map(invoices.map((row) => [textValue(row.id), row]));
    const groups = new Map<string, JsonRecord[]>();
    for (const line of invoiceLines) {
      const key = `${textValue(line.invoice_id)}|${textValue(line.material_id)}`;
      groups.set(key, [...(groups.get(key) ?? []), line]);
    }

    // First pass: build one "batch" candidate per (invoice, material) group,
    // scoped to MTO/HPS with a real declared-vs-actual Stroke mismatch --
    // same population SO04's own "Stroke Mismatch only" checkbox flags.
    type Batch = {
      key: string; invoice: JsonRecord; material: JsonRecord; soLine: JsonRecord; so: JsonRecord;
      dcLine: JsonRecord; packingOrder: JsonRecord | null; actualStroke: JsonRecord | null;
      soStroke: JsonRecord | null; declaredStrokeNumber: string; lines: JsonRecord[];
    };
    const batches: Batch[] = [];
    for (const [key, lines] of groups.entries()) {
      const invoice = invoiceById.get(textValue(lines[0]?.invoice_id)) ?? {};
      const materialId = textValue(lines[0]?.material_id);
      const material = materials.get(materialId) ?? {};
      const firstLine = lines[0];
      const dcLine = dcLineById.get(textValue(firstLine?.dc_line_id)) ?? {};
      const soLine = soLineById.get(textValue(firstLine?.so_line_id || dcLine.so_line_id)) ?? {};
      const so = soById.get(textValue(soLine.so_id || invoice.so_id)) ?? {};
      const fgType = upperValue(soLine.fg_type);
      if (!FG_TYPES.includes(fgType)) continue;
      const declaredStrokeNumber = textValue(soLine.declared_stroke_number);
      if (!declaredStrokeNumber) continue;
      const packingOrder = packingById.get(textValue(dcLine.packing_order_id)) ?? null;
      const processOrder = packingOrder ? processById.get(textValue(packingOrder.process_order_id)) ?? null : null;
      const actualStroke = processOrder ? strokeById.get(textValue(processOrder.stroke_master_id)) ?? null : null;
      const actualStrokeNumber = textValue(actualStroke?.stroke_number);
      const mismatch = upperValue(declaredStrokeNumber) !== upperValue(actualStrokeNumber);
      if (!mismatch) continue;
      batches.push({ key, invoice, material, soLine, so, dcLine, packingOrder, actualStroke, soStroke: null, declaredStrokeNumber, lines });
    }
    if (batches.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    // Resolve the SO Stroke's own stroke_master row per batch (blank/null
    // when that declared stroke was never actually created -- same rule
    // AC08 already locks).
    const prodshadeIds = uniqueValues(batches.map((b) => b.actualStroke?.prodshade_material_id));
    const declaredNumbers = uniqueValues(batches.map((b) => b.declaredStrokeNumber));
    if (prodshadeIds.length > 0 && companyId) {
      const soStrokeRows = await fetchInChunks<JsonRecord>(prodshadeIds, (chunk) => serviceRoleClient.schema("erp_production")
        .from("stroke_master").select("id, stroke_number, prodshade_material_id")
        .eq("company_id", companyId).in("prodshade_material_id", chunk).in("stroke_number", declaredNumbers))
        .catch(() => { throw new Error("BCR_SO_STROKE_LOOKUP_FAILED"); });
      const soStrokeByKey = new Map<string, JsonRecord>();
      for (const row of soStrokeRows) {
        soStrokeByKey.set(`${textValue(row.prodshade_material_id)}|${upperValue(row.stroke_number)}`, row);
      }
      for (const batch of batches) {
        const prodshadeId = textValue(batch.actualStroke?.prodshade_material_id);
        batch.soStroke = soStrokeByKey.get(`${prodshadeId}|${upperValue(batch.declaredStrokeNumber)}`) ?? null;
      }
    }

    const strokeIds = uniqueValues(batches.flatMap((b) => [textValue(b.soStroke?.id), textValue(b.actualStroke?.id)]));
    const strokeLines = await fetchInChunks<JsonRecord>(strokeIds, (chunk) => serviceRoleClient.schema("erp_production")
      .from("stroke_line").select("stroke_master_id, material_id, dosage_pct").in("stroke_master_id", chunk))
      .catch(() => { throw new Error("BCR_STROKE_LINE_LOOKUP_FAILED"); });
    function summedDosagePct(strokeMasterId: string, materialId: string): number | null {
      if (!strokeMasterId) return null;
      const matches = strokeLines.filter((row) => textValue(row.stroke_master_id) === strokeMasterId && textValue(row.material_id) === materialId);
      if (matches.length === 0) return null;
      return matches.reduce((sum, row) => sum + Number(row.dosage_pct ?? 0), 0);
    }

    const rmIntMaterialIds = uniqueValues(strokeLines.map((row) => row.material_id));
    const rmIntMaterials = await materialMap(rmIntMaterialIds);

    const rows: JsonRecord[] = [];
    for (const batch of batches) {
      const { invoice, material, soLine, so, dcLine, packingOrder, actualStroke, soStroke, lines } = batch;
      const tallyDate = textValue(invoice.tally_invoice_date);
      const costingRateMonth = textValue(soLine.costing_rate_month);
      const fgType = upperValue(soLine.fg_type);
      const packQty = rounded(lines.reduce((sum, line) => sum + numberValue(dcLine.pack_qty), 0), 6) || Number(dcLine.pack_qty ?? 0);
      const baseQty = rounded(lines.reduce((sum, line) => sum + numberValue(line.quantity), 0), 6);
      const packCount = Number(packingOrder?.num_packs ?? 0);
      const perPackQty = packCount > 0 ? Number(packingOrder?.actual_qty_kg ?? 0) / packCount : 0;

      const identity = {
        company_code: companyCode,
        month_year: monthYear(tallyDate),
        invoice_number: textValue(invoice.invoice_number),
        tally_invoice_number: textValue(invoice.tally_invoice_number),
        tally_invoice_date: tallyDate,
        inbound_number: textValue(invoice.inbound_number),
        fo_number: textValue(invoice.fo_number),
        external_so_number: textValue(so.customer_po_number),
        dispatch_type: textValue(so.dispatch_type),
        dispatch_category: textValue(so.dispatch_category),
        fg_type: fgType,
        document_name: textValue(material.document_name),
        external_code: textValue(material.external_code),
        item_category: textValue(material.material_category),
        batch_number: textValue(dcLine.batch_number),
        packing_po_number: textValue(packingOrder?.po_number),
        so_stroke_number: batch.declaredStrokeNumber,
        actual_stroke_number: textValue(actualStroke?.stroke_number),
        pack_qty: packQty, pack_uom: textValue(dcLine.pack_uom_code),
        base_qty: baseQty, base_uom: "KG",
      };

      rows.push({
        row_key: `${batch.key}|SKU`, group_key: batch.key, row_type: "SKU",
        ...identity, item: textValue(material.material_name),
        costing_group: null, costing_source: null, rate: null, wastage_other_pct: null, basis: null,
        dosage_or_qty: null, cost_so_stroke: null, cost_dispatched_stroke: null,
      });

      const strokeMaterialIds = uniqueValues([
        ...strokeLines.filter((row) => textValue(row.stroke_master_id) === textValue(soStroke?.id)).map((row) => row.material_id),
        ...strokeLines.filter((row) => textValue(row.stroke_master_id) === textValue(actualStroke?.id)).map((row) => row.material_id),
      ]);
      const rateByMaterial = await resolveRatesForMaterials(companyId, textValue(soLine.id), costingRateMonth, strokeMaterialIds);

      let rmcSo: number | null = 0;
      let rmcDispatched = 0;
      let anySoDosage = false;
      for (const materialId of strokeMaterialIds) {
        const rmMaterial = rmIntMaterials.get(materialId) ?? {};
        const soDosage = summedDosagePct(textValue(soStroke?.id), materialId);
        const dispatchedDosage = summedDosagePct(textValue(actualStroke?.id), materialId);
        const rateInfo = rateByMaterial.get(materialId) ?? null;
        const wastageFactor = 1 + Number(rateInfo?.wastage_other_pct ?? 0) / 100;
        const costSo = soDosage != null && rateInfo?.rate != null ? (soDosage / 100) * rateInfo.rate * wastageFactor : null;
        const costDispatched = dispatchedDosage != null && rateInfo?.rate != null ? (dispatchedDosage / 100) * rateInfo.rate * wastageFactor : null;
        if (costSo != null) { rmcSo = (rmcSo ?? 0) + costSo; anySoDosage = true; }
        if (costDispatched != null) rmcDispatched += costDispatched;

        rows.push({
          row_key: `${batch.key}|RM|${materialId}`, group_key: batch.key,
          row_type: textValue(rmMaterial.material_type) === "INT" ? "INT" : "RM",
          ...identity, item: textValue(rmMaterial.material_name), external_code: textValue(rmMaterial.external_code),
          item_category: textValue(rmMaterial.material_category),
          costing_group: rateInfo?.costing_group_name ?? "Standalone", costing_source: rateInfo?.source ?? null,
          rate: rateInfo?.rate ?? null, wastage_other_pct: rateInfo?.wastage_other_pct ?? null, basis: rateInfo ? "%" : null,
          dosage_or_qty: dispatchedDosage != null ? dispatchedDosage : soDosage,
          cost_so_stroke: costSo != null ? rounded(costSo) : null,
          cost_dispatched_stroke: costDispatched != null ? rounded(costDispatched) : null,
        });
      }
      if (!anySoDosage) rmcSo = null;

      const segment = SEGMENT_BY_FG_TYPE[fgType] ?? null;
      let conversionRate: number | null = null;
      if (segment && actualStroke?.prodshade_material_id) {
        const { data: convRate, error: convErr } = await serviceRoleClient.schema("erp_production").rpc("resolve_conversion_rate", {
          p_company_id: companyId, p_segment_code: segment, p_prodshade_material_id: textValue(actualStroke.prodshade_material_id),
          p_posting_date: tallyDate || new Date().toISOString().slice(0, 10),
        });
        if (convErr) throw new Error("BCR_CONVERSION_RATE_LOOKUP_FAILED");
        conversionRate = convRate === null || convRate === undefined ? null : Number(convRate);
      }
      rows.push({
        row_key: `${batch.key}|CONV`, group_key: batch.key, row_type: "CONV",
        ...identity, item: `Conversion Cost — Segment ${segment ?? "—"}`,
        costing_group: null, costing_source: "Conversion Config",
        rate: conversionRate, wastage_other_pct: null, basis: null, dosage_or_qty: null,
        cost_so_stroke: conversionRate, cost_dispatched_stroke: conversionRate,
      });
      const sfgSo = rmcSo != null && conversionRate != null ? rmcSo + conversionRate : null;
      const sfgDispatched = conversionRate != null ? rmcDispatched + conversionRate : null;

      const packCode = textValue(material.pack_code);
      const packCodeInfo = await packCodeRow(packCode);
      const isFixedBom = packCodeInfo?.bom_required === true;
      let pmLinesRaw: JsonRecord[] = [];
      let perPackQtyForPm = perPackQty;
      if (packCode) {
        if (isFixedBom) {
          const pmComposition = await resolvePmComposition(textValue(soLine.material_id), material);
          pmLinesRaw = pmComposition.lines;
          if (pmComposition.perPackQtyFixed != null) perPackQtyForPm = pmComposition.perPackQtyFixed;
        } else if (packingOrder) {
          pmLinesRaw = await actualPackingOrderPmLines(packingOrder);
        }
      }
      const pmMaterialIds = uniqueValues(pmLinesRaw.map((row) => row.material_id));
      const pmMaterials = await materialMap(pmMaterialIds);
      const pmRateByMaterial = await resolveRatesForMaterials(companyId, textValue(soLine.id), costingRateMonth, pmMaterialIds);
      let pmcPerKg = 0;
      let anyPmRate = false;
      for (const line of pmLinesRaw) {
        const materialId = textValue(line.material_id);
        const pmMaterial = pmMaterials.get(materialId) ?? {};
        const rateInfo = pmRateByMaterial.get(materialId) ?? null;
        const qty = Number(line.qty ?? line.qty_per_pack ?? 0);
        const isFlat = /BARREL/i.test(textValue(pmMaterial.material_name));
        const adjustedRate = rateInfo?.rate != null
          ? (isFlat ? rateInfo.rate + Number(rateInfo.wastage_other_pct ?? 0) : rateInfo.rate * (1 + Number(rateInfo.wastage_other_pct ?? 0) / 100))
          : null;
        const lineCostPerPack = adjustedRate != null ? adjustedRate * qty : null;
        const lineCostPerKg = lineCostPerPack != null && perPackQtyForPm > 0 ? lineCostPerPack / perPackQtyForPm : null;
        if (lineCostPerKg != null) { pmcPerKg += lineCostPerKg; anyPmRate = true; }
        rows.push({
          row_key: `${batch.key}|PM|${materialId}`, group_key: batch.key, row_type: "PM",
          ...identity, item: textValue(pmMaterial.material_name), external_code: textValue(pmMaterial.external_code),
          item_category: textValue(pmMaterial.material_category),
          costing_group: rateInfo?.costing_group_name ?? "Standalone", costing_source: rateInfo?.source ?? null,
          rate: rateInfo?.rate ?? null, wastage_other_pct: rateInfo?.wastage_other_pct ?? null,
          basis: isFlat ? "₹ flat/unit" : "%", dosage_or_qty: qty,
          cost_so_stroke: lineCostPerKg != null ? rounded(lineCostPerKg) : null,
          cost_dispatched_stroke: lineCostPerKg != null ? rounded(lineCostPerKg) : null,
        });
      }
      const pmc = anyPmRate ? pmcPerKg : null;

      const fgCostPerKgSo = sfgSo != null && pmc != null ? sfgSo + pmc : null;
      const fgCostPerKgDispatched = sfgDispatched != null && pmc != null ? sfgDispatched + pmc : null;
      rows.push({
        row_key: `${batch.key}|FG_RATE_KG`, group_key: batch.key, row_type: "FG_RATE_KG",
        ...identity, item: "Costing Rate for FG (per kg)",
        costing_group: null, costing_source: "RMC + Conv + PMC", rate: null, wastage_other_pct: null, basis: null,
        dosage_or_qty: null,
        cost_so_stroke: fgCostPerKgSo != null ? rounded(fgCostPerKgSo) : null,
        cost_dispatched_stroke: fgCostPerKgDispatched != null ? rounded(fgCostPerKgDispatched) : null,
        so_stroke_missing: !soStroke,
      });
      rows.push({
        row_key: `${batch.key}|FG_RATE_PACK`, group_key: batch.key, row_type: "FG_RATE_PACK",
        ...identity, item: `Costing Rate for FG (per Pack — ${rounded(perPackQtyForPm, 3)} kg)`,
        costing_group: null, costing_source: `× ${rounded(perPackQtyForPm, 3)} kg / Pack`, rate: null, wastage_other_pct: null, basis: null,
        dosage_or_qty: null,
        cost_so_stroke: fgCostPerKgSo != null ? rounded(fgCostPerKgSo * perPackQtyForPm, 2) : null,
        cost_dispatched_stroke: fgCostPerKgDispatched != null ? rounded(fgCostPerKgDispatched * perPackQtyForPm, 2) : null,
        so_stroke_missing: !soStroke,
      });
    }

    rows.sort((a, b) => textValue(a.tally_invoice_date).localeCompare(textValue(b.tally_invoice_date))
      || textValue(a.invoice_number).localeCompare(textValue(b.invoice_number), undefined, { numeric: true })
      || textValue(a.group_key).localeCompare(textValue(b.group_key)));
    return okResponse({ data: rows }, ctx.request_id, req);
  } catch (err) {
    console.error("BATCH_COSTING_REPORT_FAILED", err);
    const code = err instanceof Error ? err.message : "BATCH_COSTING_REPORT_FAILED";
    return reportError(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, "Unable to load Batch Costing Report.");
  }
}
