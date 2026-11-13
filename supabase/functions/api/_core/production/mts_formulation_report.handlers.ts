/*
 * File-ID: PR27-BE
 * File-Path: supabase/functions/api/_core/production/mts_formulation_report.handlers.ts
 * Gate: 27
 * Domain: PRODUCTION
 * Purpose: PR27 "MTS Formulation Report" -- for every VERIFIED MTS Process PO in a date range: the SFG made and every
 *          RM / INT it used, then per Packing PO the SKU made and every PM it used, each line with Formulation material,
 *          Actual material, dosage, formulation qty, actual qty and variance. Read-only. Row building lives in
 *          mts_formulation_report.logic.ts (unit-tested); this file only reads, scopes and enriches.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import { assertProdReadRole, toTrimmedString } from "./production.shared.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import {
  oisErr,
  parseIsoDate,
  parseMultiValueParams,
  resolveAllowedCompanyIds,
  scopeCompanyIds,
} from "./order_information_system.handlers.ts";
import { buildFormulationRows, type JsonRow, type MaterialInfo } from "./mts_formulation_report.logic.ts";

const MAX_DATE_RANGE_DAYS = 365;
const PAGE_SIZE = 1000;
// process_order_line has ~7-10 rows per Process PO; a small id chunk keeps one chunk well under chunkedIn.ts's page cap.
const LINE_CHUNK_SIZE = 25;

async function fetchVerifiedMtsProcessOrders(companyIds: string[] | null, dateFrom: string, dateTo: string, prodshadeIds: string[]): Promise<JsonRow[]> {
  const rows: JsonRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = serviceRoleClient.schema("erp_production").from("process_order")
      .select("id, company_id, po_number, material_id, stroke_master_id, production_date, planned_qty, number_of_batches, batch_number_from, batch_number_to")
      .eq("po_type", "MTS")
      // Actual quantities only exist after Verify; a pending PO would show a prefilled 0 as if it were real.
      .eq("status", "VERIFIED")
      .gte("production_date", dateFrom)
      .lte("production_date", dateTo)
      .order("production_date", { ascending: true })
      .order("po_number", { ascending: true });
    if (companyIds) query = query.in("company_id", companyIds);
    if (prodshadeIds.length > 0) query = query.in("material_id", prodshadeIds);
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (query as any).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error("PROD_MTS_FORMULATION_LOOKUP_FAILED");
    const page = (data ?? []) as JsonRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

// GET /api/production/mts-formulation-report
// Same no-rank / company-boundary-only access as the other "Everyone" reports: resource PROD_MTS_FORMULATION_REPORT /
// VIEW decides who may open it, the caller's real erp_map.user_companies list decides which companies they see.
export async function getMtsFormulationReportHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const requestedCompanyIds = parseMultiValueParams(url, "company_ids", "company_id");
    const prodshadeIds = parseMultiValueParams(url, "prodshade_ids", "prodshade_id");
    const skuIds = parseMultiValueParams(url, "sku_ids", "sku_id");
    const poNumbers = parseMultiValueParams(url, "po_numbers", "po_number");
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));

    if (!dateFrom || !dateTo) {
      return oisErr(req, ctx, "PROD_MTS_FORMULATION_DATE_RANGE_REQUIRED", 400, "Production date range is required.");
    }
    const from = parseIsoDate(dateFrom);
    const to = parseIsoDate(dateTo);
    if (!from || !to || to.getTime() < from.getTime()) {
      return oisErr(req, ctx, "PROD_MTS_FORMULATION_DATE_RANGE_INVALID", 400, "date_from/date_to are invalid.");
    }
    if (Math.floor((to.getTime() - from.getTime()) / 86400000) > MAX_DATE_RANGE_DAYS) {
      return oisErr(req, ctx, "PROD_MTS_FORMULATION_DATE_RANGE_TOO_WIDE", 400, "Date range cannot exceed 365 days.");
    }

    const allowedCompanyIds = await resolveAllowedCompanyIds(ctx);
    const companyIds = scopeCompanyIds(allowedCompanyIds, requestedCompanyIds);
    // Asked for a company the caller does not have -> definitely nothing, never "all".
    if (companyIds !== null && companyIds.length === 0) {
      return okResponse({ items: [], total: 0 }, ctx.request_id, req);
    }

    const processOrders = await fetchVerifiedMtsProcessOrders(companyIds, dateFrom, dateTo, prodshadeIds);
    if (processOrders.length === 0) return okResponse({ items: [], total: 0 }, ctx.request_id, req);
    const processOrderIds = processOrders.map((row) => String(row.id));

    let processLines: JsonRow[];
    let packingOrders: JsonRow[];
    try {
      [processLines, packingOrders] = await Promise.all([
        fetchInChunks<JsonRow>(processOrderIds, (idChunk) =>
          serviceRoleClient.schema("erp_production").from("process_order_line")
            .select("id, process_order_id, material_id, actual_material_id, planned_qty, actual_qty, uom_code, dosage_pct, display_order, stroke_line_id")
            .in("process_order_id", idChunk),
        LINE_CHUNK_SIZE),
        fetchInChunks<JsonRow>(processOrderIds, (idChunk) =>
          serviceRoleClient.schema("erp_production").from("packing_order")
            .select("id, process_order_id, po_number, material_id, batch_number_from, batch_number_to, planned_qty_kg, actual_qty_kg, status")
            .in("process_order_id", idChunk)),
      ]);
    } catch {
      throw new Error("PROD_MTS_FORMULATION_LOOKUP_FAILED");
    }

    // SKU / PO-number filters narrow the Packing POs; a Process PO stays only while at least one of its Packing POs matches
    // (or, with no SKU / number filter, always), so a filter never leaves a Process block with a different SKU's output.
    const skuFilter = new Set(skuIds);
    const poFilter = new Set(poNumbers);
    const processNumberById = new Map(processOrders.map((row) => [String(row.id), String(row.po_number)]));
    const packingMatches = (pack: JsonRow): boolean =>
      (skuFilter.size === 0 || skuFilter.has(String(pack.material_id)))
      && (poFilter.size === 0 || poFilter.has(String(pack.po_number)) || poFilter.has(processNumberById.get(String(pack.process_order_id)) ?? ""));
    const filtering = skuFilter.size > 0 || poFilter.size > 0;
    const keptPacking = filtering ? packingOrders.filter(packingMatches) : packingOrders;
    const keptProcessIds = new Set(
      filtering
        ? [
          ...keptPacking.map((pack) => String(pack.process_order_id)),
          // a Process PO number typed directly keeps that PO even when it has no Packing PO yet (only with no SKU filter)
          ...(skuFilter.size === 0 ? processOrders.filter((po) => poFilter.has(String(po.po_number))).map((po) => String(po.id)) : []),
        ]
        : processOrderIds,
    );
    const finalProcessOrders = processOrders.filter((po) => keptProcessIds.has(String(po.id)));
    if (finalProcessOrders.length === 0) return okResponse({ items: [], total: 0 }, ctx.request_id, req);

    const packingIds = keptPacking.map((pack) => String(pack.id));
    let packingLines: JsonRow[];
    try {
      packingLines = await fetchInChunks<JsonRow>(packingIds, (idChunk) =>
        serviceRoleClient.schema("erp_production").from("packing_order_line")
          .select("id, packing_order_id, line_type, material_id, actual_material_id, total_qty, actual_qty, uom_code, display_order")
          .eq("line_type", "PM")
          .in("packing_order_id", idChunk),
      LINE_CHUNK_SIZE);
    } catch {
      throw new Error("PROD_MTS_FORMULATION_LOOKUP_FAILED");
    }

    const finalIds = new Set(finalProcessOrders.map((po) => String(po.id)));
    const finalProcessLines = processLines.filter((line) => finalIds.has(String(line.process_order_id)));
    const materialIds = [...new Set([
      ...finalProcessOrders.map((po) => String(po.material_id)),
      ...finalProcessLines.flatMap((line) => [String(line.material_id), toTrimmedString(line.actual_material_id)]),
      ...keptPacking.map((pack) => String(pack.material_id)),
      ...packingLines.flatMap((line) => [String(line.material_id), toTrimmedString(line.actual_material_id)]),
    ].filter(Boolean))];
    const strokeIds = [...new Set(finalProcessOrders.map((po) => toTrimmedString(po.stroke_master_id)).filter(Boolean))];

    let materialRows: JsonRow[];
    let strokeRows: JsonRow[];
    try {
      [materialRows, strokeRows] = await Promise.all([
        fetchInChunks<JsonRow>(materialIds, (idChunk) =>
          serviceRoleClient.schema("erp_master").from("material_master")
            .select("id, external_code, material_name, document_name, material_type").in("id", idChunk)),
        fetchInChunks<JsonRow>(strokeIds, (idChunk) =>
          serviceRoleClient.schema("erp_production").from("stroke_master")
            .select("id, stroke_number").in("id", idChunk)),
      ]);
    } catch {
      throw new Error("PROD_MTS_FORMULATION_ENRICH_FAILED");
    }
    const materials = new Map<string, MaterialInfo>(materialRows.map((row) => [String(row.id), {
      id: String(row.id),
      external_code: toTrimmedString(row.external_code) || null,
      material_name: toTrimmedString(row.material_name) || null,
      document_name: toTrimmedString(row.document_name) || null,
      material_type: toTrimmedString(row.material_type) || null,
    }]));
    const strokes = new Map<string, string>(strokeRows.map((row) => [String(row.id), toTrimmedString(row.stroke_number)]));

    const items = buildFormulationRows({
      processOrders: finalProcessOrders,
      processLines: finalProcessLines,
      packingOrders: keptPacking,
      packingLines,
      materials,
      strokes,
    });
    return okResponse({ items, total: items.length }, ctx.request_id, req);
  } catch (err) {
    console.error("[mts_formulation_report] request_id:", ctx.request_id, "error:", err);
    const code = err instanceof Error ? err.message : "PROD_MTS_FORMULATION_FAILED";
    return oisErr(req, ctx, code, 500, "MTS Formulation Report failed");
  }
}
