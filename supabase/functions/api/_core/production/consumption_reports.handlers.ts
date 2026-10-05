/*
 * File-ID: 27.FE-PR25-PR26-BE
 * File-Path: supabase/functions/api/_core/production/consumption_reports.handlers.ts
 * Gate: 27
 * Domain: PRODUCTION
 * Purpose: PR25 "RM/PM Sale Report" + PR26 "Excess Consumption Report" — both read-only,
 *          company-scoped, "Everyone Reports" (CAP_EVERYONE_REPORTS) month-end reports
 *          replicating the business's existing manual Excel reconciliation. Both source
 *          almost entirely from erp_production.dispatch_reco (§133.14 -- already live-writing
 *          per-invoice RM/PM/INT reconciliation at PGI time, was write-only/no report until now)
 *          plus, for PR25's direct RM/PM/INT column, posted sales_invoice_line rows.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { okResponse, errorResponse } from "../response.ts";
import { resolveAc06RatesAsOf } from "./ac06_workspace.handlers.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import { assertProdReadRole, toTrimmedString } from "./production.shared.ts";

type JsonRecord = Record<string, unknown>;

function crErr(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

function monthOf(dateStr: string): string {
  return dateStr ? dateStr.slice(0, 7) : "";
}

function monthStart(dateStr: string): string {
  const month = monthOf(dateStr);
  return month ? `${month}-01` : "";
}

async function resolveMaterialMap(materialIds: string[]): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(materialIds.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (ids.length === 0) return map;
  const rows = await fetchInChunks<JsonRecord>(ids, (chunk) =>
    serviceRoleClient.schema("erp_master").from("material_master")
      .select("id, external_code, material_name, document_name, material_type").in("id", chunk));
  for (const row of rows) map.set(String(row.id), row);
  return map;
}

// GET /api/production/rm-pm-sale-report -- PR25
// Row grain: one row per (Material, Tally Invoice Month). "RM/PM Sale" = direct RM/PM/INT invoice
// dispatch qty (from sales_invoice_line, joined back to sales_order_line for
// line_material_type). "MTEST STD/Actual/APL" = the same material's RM/PM/INT content
// embedded in that month's MTEST FG dispatches, already ratio-derived in dispatch_reco
// (§133.14) -- shown as 3 independent bases (never picking one), per business owner's
// locked design: "user download kore konta use korbe tar bapar". Never shows FG/SFG rows
// themselves -- those are only the source that gets exploded into RM/PM/INT content here.
export async function listRmPmSaleReportHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const search = toTrimmedString(url.searchParams.get("search")).toLowerCase();

    if (!companyId) return crErr(req, ctx, "PROD_RMPM_SALE_COMPANY_REQUIRED", 400, "Company is required.");
    await assertCompanyScope(ctx, companyId);
    if (!dateFrom || !dateTo) return crErr(req, ctx, "PROD_RMPM_SALE_DATE_RANGE_REQUIRED", 400, "Date range is required.");

    // 1. Direct RM/PM/INT sale -- posted invoice lines whose SO line is RM/PM/INT.
    let invoiceQuery = serviceRoleClient
      .schema("erp_procurement").from("sales_invoice")
      .select("id, tally_invoice_date")
      .eq("company_id", companyId)
      .is("cancelled_at", null);
    // Same Supabase-client typing gap as batch_variance_report.handlers.ts's own
    // gte/lte calls -- DbQueryBuilder's generated type doesn't declare these.
    // Dispatch reporting is always by the Tally Invoice Date. PACE's
    // `invoice_date` is the posting date and may fall in a later month.
    invoiceQuery = (invoiceQuery as unknown as { gte: (c: string, v: string) => typeof invoiceQuery }).gte("tally_invoice_date", dateFrom);
    invoiceQuery = (invoiceQuery as unknown as { lte: (c: string, v: string) => typeof invoiceQuery }).lte("tally_invoice_date", dateTo);
    const { data: invoiceRows, error: invErr } = await invoiceQuery;
    if (invErr) throw new Error("PROD_RMPM_SALE_INVOICE_LOOKUP_FAILED");
    const invoiceRowList = (invoiceRows ?? []) as JsonRecord[];
    const invoiceIds = invoiceRowList.map((r) => String(r.id));
    const tallyInvoiceDateById = new Map(invoiceRowList.map((r) => [String(r.id), toTrimmedString(r.tally_invoice_date)]));

    const invoiceLines = invoiceIds.length > 0
      ? await fetchInChunks<JsonRecord>(invoiceIds, (chunk) =>
          serviceRoleClient.schema("erp_procurement").from("sales_invoice_line")
            .select("invoice_id, material_id, quantity, so_line_id").in("invoice_id", chunk))
      : [];

    const soLineIds = [...new Set(invoiceLines.map((l) => toTrimmedString(l.so_line_id)).filter(Boolean))];
    const soLineRows = soLineIds.length > 0
      ? await fetchInChunks<JsonRecord>(soLineIds, (chunk) =>
          serviceRoleClient.schema("erp_procurement").from("sales_order_line")
            .select("id, line_material_type").in("id", chunk))
      : [];
    const materialTypeBySoLine = new Map(soLineRows.map((r) => [String(r.id), toTrimmedString(r.line_material_type)]));

    type Bucket = { material_id: string; month: string; rm_pm_qty: number; mtest_std: number; mtest_actual: number; mtest_apl: number };
    const buckets = new Map<string, Bucket>();
    const bucketKey = (materialId: string, month: string) => `${materialId}::${month}`;

    const DIRECT_TYPES = new Set(["RM", "PM", "INT"]);
    for (const line of invoiceLines) {
      const materialType = materialTypeBySoLine.get(toTrimmedString(line.so_line_id));
      if (!materialType || !DIRECT_TYPES.has(materialType)) continue;
      const materialId = toTrimmedString(line.material_id);
      if (!materialId) continue;
      const month = monthOf(tallyInvoiceDateById.get(toTrimmedString(line.invoice_id)) ?? "");
      const key = bucketKey(materialId, month);
      const bucket = buckets.get(key) ?? { material_id: materialId, month, rm_pm_qty: 0, mtest_std: 0, mtest_actual: 0, mtest_apl: 0 };
      bucket.rm_pm_qty += Number(line.quantity ?? 0);
      buckets.set(key, bucket);
    }

    // 2. MTEST-derived RM/PM/INT content -- dispatch_reco already carries the
    // batch-ratio-derived Standard/Actual/AP-Approved per material per invoice line.
    // Found live 2026-09-04 (business owner, CMP006) -- dispatch_reco.po_type is
    // populated from the PACKING order's own po_type (computeDispatchRecoRows in
    // do_unified.handlers.ts reads pko.po_type), which uses the packing-PO naming
    // convention (PMTO/PHPS/PMTS/PTEST), never the process-PO naming (MTO/HPS/
    // MTS/MTEST/INT). Filtering on "MTEST" here could never match a single row,
    // for any company -- confirmed live: dispatch_reco's only real po_type values
    // across the whole table are PTEST and PMTO, and CMP006's one real MTEST PGI
    // (invoice 9200000002) already has 13 correctly-computed dispatch_reco rows
    // sitting there with po_type='PTEST', invisible to this report the whole time.
    let recoQuery = serviceRoleClient
      .schema("erp_production").from("dispatch_reco")
      .select("material_id, tally_invoice_date, standard_qty, actual_qty, ap_approved_qty")
      .eq("company_id", companyId).eq("po_type", "PTEST").eq("is_voided", false);
    recoQuery = (recoQuery as unknown as { gte: (c: string, v: string) => typeof recoQuery }).gte("tally_invoice_date", dateFrom);
    recoQuery = (recoQuery as unknown as { lte: (c: string, v: string) => typeof recoQuery }).lte("tally_invoice_date", dateTo);
    const { data: recoRows, error: recoErr } = await recoQuery;
    if (recoErr) throw new Error("PROD_RMPM_SALE_RECO_LOOKUP_FAILED");
    for (const row of (recoRows ?? []) as JsonRecord[]) {
      const materialId = toTrimmedString(row.material_id);
      if (!materialId) continue;
      const month = monthOf(toTrimmedString(row.tally_invoice_date));
      const key = bucketKey(materialId, month);
      const bucket = buckets.get(key) ?? { material_id: materialId, month, rm_pm_qty: 0, mtest_std: 0, mtest_actual: 0, mtest_apl: 0 };
      bucket.mtest_std += Number(row.standard_qty ?? 0);
      bucket.mtest_actual += Number(row.actual_qty ?? 0);
      bucket.mtest_apl += Number(row.ap_approved_qty ?? 0);
      buckets.set(key, bucket);
    }

    const materialMap = await resolveMaterialMap([...buckets.values()].map((b) => b.material_id));

    let rows = [...buckets.values()].map((b) => {
      const material = materialMap.get(b.material_id);
      return {
        month: b.month,
        material_id: b.material_id,
        item_type: toTrimmedString(material?.material_type) || null,
        item_name: toTrimmedString(material?.material_name) || null,
        external_code: toTrimmedString(material?.external_code) || null,
        document_name: toTrimmedString(material?.document_name) || null,
        rm_pm_sale_qty: Number(b.rm_pm_qty.toFixed(6)),
        mtest_std_qty: Number(b.mtest_std.toFixed(6)),
        mtest_actual_qty: Number(b.mtest_actual.toFixed(6)),
        mtest_apl_qty: Number(b.mtest_apl.toFixed(6)),
        total_std: Number((b.rm_pm_qty + b.mtest_std).toFixed(6)),
        total_actual: Number((b.rm_pm_qty + b.mtest_actual).toFixed(6)),
        total_apl: Number((b.rm_pm_qty + b.mtest_apl).toFixed(6)),
      };
    });

    if (search) {
      rows = rows.filter((r) =>
        (r.item_name ?? "").toLowerCase().includes(search) ||
        (r.external_code ?? "").toLowerCase().includes(search) ||
        (r.document_name ?? "").toLowerCase().includes(search) ||
        (r.item_type ?? "").toLowerCase().includes(search));
    }

    rows.sort((a, b) => (a.month === b.month ? (a.item_name ?? "").localeCompare(b.item_name ?? "") : a.month.localeCompare(b.month)));

    return okResponse({ data: rows }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_RMPM_SALE_REPORT_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") ? 400 : 500;
    return crErr(req, ctx, code, status, "RM/PM Sale report failed");
  }
}

// GET /api/production/excess-consumption-report -- PR26
// Row grain: one row per dispatch_reco line that has a process_order_id (i.e. an
// MTO/HPS/MTEST batch behind it). The report follows the legacy Excess Consumption
// worksheet: physical Actual usage plus the material's AC06 Wastage/OTHR percentage
// effective on the Tally Invoice Date, from which Total Actuals and Excess % are derived.
export async function listExcessConsumptionReportHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const search = toTrimmedString(url.searchParams.get("search")).toLowerCase();

    if (!companyId) return crErr(req, ctx, "PROD_EXCESS_CONSUMPTION_COMPANY_REQUIRED", 400, "Company is required.");
    await assertCompanyScope(ctx, companyId);
    if (!dateFrom || !dateTo) return crErr(req, ctx, "PROD_EXCESS_CONSUMPTION_DATE_RANGE_REQUIRED", 400, "Date range is required.");

    let recoQuery = serviceRoleClient
      .schema("erp_production").from("dispatch_reco")
      .select("material_id, invoice_number, tally_invoice_date, process_order_number, batch_number, packing_order_id, so_number, fo_number, dispatch_qty_kg, standard_qty, actual_qty")
      .eq("company_id", companyId).eq("is_voided", false)
      .not("process_order_id", "is", null);
    // Reports are dispatched/invoiced by the Tally Invoice Date. `invoice_date`
    // is PACE posting metadata and can fall in a different month (or even the
    // following month), which would hide valid August dispatches.
    recoQuery = (recoQuery as unknown as { gte: (c: string, v: string) => typeof recoQuery }).gte("tally_invoice_date", dateFrom);
    recoQuery = (recoQuery as unknown as { lte: (c: string, v: string) => typeof recoQuery }).lte("tally_invoice_date", dateTo);
    const { data: recoRows, error: recoErr } = await recoQuery.order("tally_invoice_date", { ascending: false });
    if (recoErr) throw new Error("PROD_EXCESS_CONSUMPTION_LOOKUP_FAILED");
    const recos = (recoRows ?? []) as JsonRecord[];

    // Wastage is not a fixed report percentage. It is the material-specific
    // AC06 Wastage/OTHR value, including AC06's date-effective splits. Resolve
    // separately for each invoice date so a mid-month AC06 rate change applies
    // to the correct dispatches.
    const materialIdsByInvoiceDate = new Map<string, string[]>();
    for (const reco of recos) {
      const invoiceDate = toTrimmedString(reco.tally_invoice_date);
      const materialId = toTrimmedString(reco.material_id);
      if (!invoiceDate || !materialId) continue;
      materialIdsByInvoiceDate.set(invoiceDate, [...(materialIdsByInvoiceDate.get(invoiceDate) ?? []), materialId]);
    }
    const rateMonths = [...new Set([...materialIdsByInvoiceDate.keys()].map(monthStart).filter(Boolean))];
    const { data: ac06MonthRows, error: ac06MonthErr } = rateMonths.length > 0
      ? await serviceRoleClient.schema("erp_production").from("ac06_month")
        .select("id, rate_month, status").eq("company_id", companyId).in("rate_month", rateMonths)
      : { data: [], error: null };
    if (ac06MonthErr) throw new Error("PROD_EXCESS_CONSUMPTION_AC06_LOOKUP_FAILED");
    const ac06MonthByStart = new Map((ac06MonthRows ?? []).map((row) => [toTrimmedString(row.rate_month), row as JsonRecord]));
    const wastagePctByInvoiceDateMaterial = new Map<string, number>();
    await Promise.all([...materialIdsByInvoiceDate.entries()].map(async ([invoiceDate, materialIds]) => {
      const month = ac06MonthByStart.get(monthStart(invoiceDate));
      if (!month) return;
      const rates = await resolveAc06RatesAsOf({
        id: toTrimmedString(month.id), rate_month: toTrimmedString(month.rate_month), status: toTrimmedString(month.status),
      }, [...new Set(materialIds)], invoiceDate);
      for (const [materialId, rate] of rates) {
        wastagePctByInvoiceDateMaterial.set(`${invoiceDate}::${materialId}`, Number(rate.wastage_other_pct ?? 0));
      }
    }));

    const packingOrderIds = [...new Set(recos.map((r) => toTrimmedString(r.packing_order_id)).filter(Boolean))];
    const packingRows = packingOrderIds.length > 0
      ? await fetchInChunks<JsonRecord>(packingOrderIds, (chunk) =>
          serviceRoleClient.schema("erp_production").from("packing_order")
            .select("id, material_id").in("id", chunk))
      : [];
    const skuMaterialIdByPko = new Map(packingRows.map((r) => [String(r.id), toTrimmedString(r.material_id)]));

    const materialMap = await resolveMaterialMap([
      ...recos.map((r) => toTrimmedString(r.material_id)),
      ...packingRows.map((r) => toTrimmedString(r.material_id)),
    ]);

    let rows = recos.map((r) => {
      const material = materialMap.get(toTrimmedString(r.material_id));
      const skuMaterialId = skuMaterialIdByPko.get(toTrimmedString(r.packing_order_id));
      const skuMaterial = skuMaterialId ? materialMap.get(skuMaterialId) : undefined;
      const dispatchQty = Number(r.dispatch_qty_kg ?? 0);
      const standardQty = Number(r.standard_qty ?? 0);
      const actualQty = Number(r.actual_qty ?? 0);
      const wastagePct = wastagePctByInvoiceDateMaterial.get(`${toTrimmedString(r.tally_invoice_date)}::${toTrimmedString(r.material_id)}`) ?? 0;
      const standardPct = dispatchQty > 0 ? (standardQty / dispatchQty) * 100 : 0;
      const actualPct = dispatchQty > 0 ? (actualQty / dispatchQty) * 100 : 0;
      const wastageQty = actualQty * (wastagePct / 100);
      const totalActualQty = actualQty + wastageQty;
      return {
        month: monthOf(toTrimmedString(r.tally_invoice_date)),
        order_number: toTrimmedString(r.process_order_number) || null,
        item_type: toTrimmedString(material?.material_type) || null,
        // The legacy sheet intentionally has both Base Code and RM Code. In PACE
        // both are the RM/PM/INT external code, so use one canonical source.
        base_code: toTrimmedString(material?.external_code) || null,
        rm_code: toTrimmedString(material?.external_code) || null,
        rm_description: toTrimmedString(material?.material_name) || null,
        sku_code: toTrimmedString(skuMaterial?.external_code) || null,
        batch_qty: dispatchQty,
        invoice_number: toTrimmedString(r.invoice_number) || null,
        invoice_date: r.tally_invoice_date,
        asian_order_number: toTrimmedString(r.fo_number) || null,
        purchase_order_number: toTrimmedString(r.so_number) || null,
        standard_pct: Number(standardPct.toFixed(4)),
        standard_qty: Number(standardQty.toFixed(6)),
        actual_pct: Number(actualPct.toFixed(4)),
        actual_usage_qty: Number(actualQty.toFixed(6)),
        wastage_pct: Number(wastagePct.toFixed(6)),
        wastage_qty: Number(wastageQty.toFixed(6)),
        total_actual_qty: Number(totalActualQty.toFixed(6)),
        excess_pct: Number((actualPct - standardPct).toFixed(4)),
      };
    });

    if (search) {
      rows = rows.filter((r) =>
        (r.base_code ?? "").toLowerCase().includes(search) ||
        (r.rm_code ?? "").toLowerCase().includes(search) ||
        (r.rm_description ?? "").toLowerCase().includes(search) ||
        (r.sku_code ?? "").toLowerCase().includes(search) ||
        (r.order_number ?? "").toLowerCase().includes(search) ||
        (r.invoice_number ?? "").toLowerCase().includes(search) ||
        (r.purchase_order_number ?? "").toLowerCase().includes(search) ||
        (r.asian_order_number ?? "").toLowerCase().includes(search));
    }

    return okResponse({ data: rows }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_EXCESS_CONSUMPTION_REPORT_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") ? 400 : 500;
    return crErr(req, ctx, code, status, "Excess Consumption report failed");
  }
}
