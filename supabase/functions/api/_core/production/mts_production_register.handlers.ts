/*
 * File-ID: 27.FE-PR24-MTS-REGISTER-BE
 * File-Path: supabase/functions/api/_core/production/mts_production_register.handlers.ts
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: PR24 "MTS Production Register" sub-report -- MTS batch history at
 *          STANDARD/PENDING, FINAL/PENDING VERIFY, VERIFIED, and CANCELLED
 *          status. See feasibility doc §143.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import { assertProdReadRole, toTrimmedString } from "./production.shared.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
import {
  oisErr,
  parseIsoDate,
  parseMultiValueParams,
  resolveAllowedCompanyIds,
  scopeCompanyIds,
} from "./order_information_system.handlers.ts";

type JsonRecord = Record<string, unknown>;

const MAX_DATE_RANGE_DAYS = 365;
const PAGE_SIZE = 1000;
// process_order_line has ~7-10 rows per Process PO; a small id chunk keeps one
// chunk well under chunkedIn.ts's own per-page cap (it paginates anyway).
const LINE_CHUNK_SIZE = 25;

function round6(value: number): number {
  return Number(value.toFixed(6));
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseBatchNumber(value: string): { prefix: string; serial: number } | null {
  const match = /^(.*?)(\d+)$/.exec(value);
  return match ? { prefix: match[1], serial: Number(match[2]) } : null;
}

// Batches in one pack row = the length of its [from..to] range, by numeric suffix
// (ER3309..ER3335 = 27), never by string order. A MTS Process PO's batch numbers
// are generated consecutively in one creation session (resolveMtsBatchRangeNumbers),
// so a PO has no gaps inside a range and the range length is exact.
function countBatchesInRange(from: string, to: string): number | null {
  const fromParsed = parseBatchNumber(from);
  const toParsed = parseBatchNumber(to);
  if (!fromParsed || !toParsed || fromParsed.prefix !== toParsed.prefix || toParsed.serial < fromParsed.serial) return null;
  return toParsed.serial - fromParsed.serial + 1;
}

async function fetchMtsProcessOrders(companyIds: string[] | null, dateFrom: string, dateTo: string): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = serviceRoleClient.schema("erp_production").from("process_order")
      .select("id, company_id, po_number, material_id, stroke_master_id, shift_id, production_date, planned_qty, number_of_batches, batch_number_from, batch_number_to, status, created_by, verified_by")
      .eq("po_type", "MTS")
      // MTS does not use the ordinary Start Batch flow. A completed Page-6
      // document is FINAL until QA posts it from PR12, so omitting FINAL made
      // every Verify-pending MTS disappear from PR24's register.
      .in("status", ["STANDARD", "FINAL", "VERIFIED", "CANCELLED"])
      .gte("production_date", dateFrom)
      .lte("production_date", dateTo)
      .order("production_date", { ascending: true })
      .order("po_number", { ascending: true });
    if (companyIds) query = query.in("company_id", companyIds);
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (query as any).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error("PROD_MTS_REGISTER_LOOKUP_FAILED");
    const page = (data ?? []) as JsonRecord[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

// GET /api/production/order-information-system/mts-register/pending-count
// A separate, date-independent count for PR24's action badge. "Pending" means
// either just standardized (STANDARD) or ready for PR12 Verify (FINAL); a
// VERIFIED/CANCELLED MTS has no action remaining and must not raise the badge.
export async function getMtsProductionRegisterPendingCountHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const requestedCompanyIds = parseMultiValueParams(url, "company_ids", "company_id");
    const allowedCompanyIds = await resolveAllowedCompanyIds(ctx);
    const companyIds = scopeCompanyIds(allowedCompanyIds, requestedCompanyIds);
    if (companyIds !== null && companyIds.length === 0) {
      return okResponse({ data: { count: 0 } }, ctx.request_id, req);
    }

    let query = serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .select("id", { count: "exact", head: true })
      .eq("po_type", "MTS")
      .in("status", ["STANDARD", "FINAL"]);
    if (companyIds) query = query.in("company_id", companyIds);
    const { count, error } = await query;
    if (error) throw new Error("PROD_MTS_REGISTER_PENDING_COUNT_FAILED");
    return okResponse({ data: { count: count ?? 0 } }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_MTS_REGISTER_PENDING_COUNT_FAILED";
    return oisErr(req, ctx, code, 500, "MTS pending count failed");
  }
}

// GET /api/production/order-information-system/mts-register
// Same no-rank / company-boundary-only access as PR24 itself (§143) -- resource
// PROD_ORDER_INFO_SYSTEM/VIEW, the caller's real erp_map.user_companies list is the scope.
export async function getMtsProductionRegisterHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const requestedCompanyIds = parseMultiValueParams(url, "company_ids", "company_id");
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));

    if (!dateFrom || !dateTo) {
      return oisErr(req, ctx, "PROD_OIS_DATE_RANGE_REQUIRED", 400, "Production date range is required.");
    }
    const from = parseIsoDate(dateFrom);
    const to = parseIsoDate(dateTo);
    if (!from || !to || to.getTime() < from.getTime()) {
      return oisErr(req, ctx, "PROD_OIS_DATE_RANGE_INVALID", 400, "date_from/date_to are invalid.");
    }
    if (Math.floor((to.getTime() - from.getTime()) / 86400000) > MAX_DATE_RANGE_DAYS) {
      return oisErr(req, ctx, "PROD_OIS_DATE_RANGE_TOO_WIDE", 400, "Date range cannot exceed 365 days.");
    }

    const allowedCompanyIds = await resolveAllowedCompanyIds(ctx);
    const companyIds = scopeCompanyIds(allowedCompanyIds, requestedCompanyIds);
    // Asked for a company the caller does not have -> definitely nothing, never "all".
    if (companyIds !== null && companyIds.length === 0) {
      return okResponse({ data: [] }, ctx.request_id, req);
    }

    const processOrders = await fetchMtsProcessOrders(companyIds, dateFrom, dateTo);
    if (processOrders.length === 0) return okResponse({ data: [] }, ctx.request_id, req);
    const processOrderIds = processOrders.map((row) => String(row.id));

    let packingRows: JsonRecord[];
    let lineRows: JsonRecord[];
    try {
      [packingRows, lineRows] = await Promise.all([
        fetchInChunks<JsonRecord>(processOrderIds, (idChunk) =>
          serviceRoleClient.schema("erp_production").from("packing_order")
            .select("id, process_order_id, po_number, material_id, num_packs, fill_qty_per_pack, planned_qty_kg, actual_qty_kg, batch_number_from, batch_number_to, status")
            .in("process_order_id", idChunk)),
        fetchInChunks<JsonRecord>(processOrderIds, (idChunk) =>
          serviceRoleClient.schema("erp_production").from("process_order_line")
            .select("process_order_id, stock_ledger_id").not("stock_ledger_id", "is", null).in("process_order_id", idChunk),
        LINE_CHUNK_SIZE),
      ]);
    } catch {
      throw new Error("PROD_MTS_REGISTER_LOOKUP_FAILED");
    }

    const packingByProcess = new Map<string, JsonRecord[]>();
    for (const row of packingRows) {
      const key = String(row.process_order_id);
      const list = packingByProcess.get(key) ?? [];
      list.push(row);
      packingByProcess.set(key, list);
    }
    // A newly Standardized or cancelled MTS PO may have no pack row. It still belongs
    // in batch history as a header-level row, with pack/actual-only cells left blank.
    const registerProcessOrders = processOrders;

    const ledgerIdsByProcess = new Map<string, string[]>();
    for (const row of lineRows) {
      const key = String(row.process_order_id);
      const list = ledgerIdsByProcess.get(key) ?? [];
      list.push(String(row.stock_ledger_id));
      ledgerIdsByProcess.set(key, list);
    }
    const allLedgerIds = [...new Set([...ledgerIdsByProcess.values()].flat())];

    const prodshadeIds = [...new Set(registerProcessOrders.map((row) => String(row.material_id)))];
    const skuIds = [...new Set(packingRows.map((row) => String(row.material_id)))];
    const materialIds = [...new Set([...prodshadeIds, ...skuIds])];
    const strokeIds = [...new Set(registerProcessOrders.map((row) => toTrimmedString(row.stroke_master_id)).filter(Boolean))];
    const shiftIds = [...new Set(registerProcessOrders.map((row) => toTrimmedString(row.shift_id)).filter(Boolean))];
    const userIds = [...new Set(registerProcessOrders.flatMap((row) => [toTrimmedString(row.created_by), toTrimmedString(row.verified_by)]).filter(Boolean))];

    let ledgerRows: JsonRecord[];
    let materialRows: JsonRecord[];
    let strokeRows: JsonRecord[];
    let shiftRows: JsonRecord[];
    let userDisplayMap: Map<string, string>;
    try {
      [ledgerRows, materialRows, strokeRows, shiftRows, userDisplayMap] = await Promise.all([
        fetchInChunks<JsonRecord>(allLedgerIds, (idChunk) =>
          serviceRoleClient.schema("erp_inventory").from("stock_ledger")
            .select("id, posting_date").in("id", idChunk)),
        fetchInChunks<JsonRecord>(materialIds, (idChunk) =>
          serviceRoleClient.schema("erp_master").from("material_master")
            .select("id, external_code, material_name, document_name, base_uom_code").in("id", idChunk)),
        fetchInChunks<JsonRecord>(strokeIds, (idChunk) =>
          serviceRoleClient.schema("erp_production").from("stroke_master")
            .select("id, stroke_number, conversion_uom_code, conversion_factor").in("id", idChunk)),
        fetchInChunks<JsonRecord>(shiftIds, (idChunk) =>
          serviceRoleClient.schema("erp_production").from("shift_master")
            .select("id, shift_name").in("id", idChunk)),
        resolveUserDisplayNames(userIds),
      ]);
    } catch {
      throw new Error("PROD_MTS_REGISTER_ENRICH_FAILED");
    }

    const postingDateByLedger = new Map(ledgerRows.map((row) => [String(row.id), toTrimmedString(row.posting_date)]));
    const materialMap = new Map(materialRows.map((row) => [String(row.id), row]));
    const strokeMap = new Map(strokeRows.map((row) => [String(row.id), row]));
    const shiftMap = new Map(shiftRows.map((row) => [String(row.id), toTrimmedString(row.shift_name)]));

    const result: JsonRecord[] = [];
    for (const po of registerProcessOrders) {
      const poId = String(po.id);
      const prodshade = materialMap.get(String(po.material_id));
      const stroke = strokeMap.get(toTrimmedString(po.stroke_master_id));
      const packs = (packingByProcess.get(poId) ?? []).slice().sort((a, b) =>
        toTrimmedString(a.batch_number_from).localeCompare(toTrimmedString(b.batch_number_from), undefined, { numeric: true })
        || toTrimmedString(a.po_number).localeCompare(toTrimmedString(b.po_number)));
      const reportPacks = packs.length > 0 ? packs : [null];
      const processStatus = toTrimmedString(po.status) || "STANDARD";
      const isVerified = processStatus === "VERIFIED";
      const isPending = processStatus === "STANDARD" || processStatus === "FINAL";
      const statusLabel = processStatus === "FINAL"
        ? "PENDING VERIFY"
        : processStatus === "STANDARD"
          ? "PENDING (STANDARD)"
          : processStatus;

      const processBatches = toNumber(po.number_of_batches);
      const batchSizeKg = processBatches > 0 ? toNumber(po.planned_qty) / processBatches : 0;

      // Prodshade UOM: the Stroke's own conversion UOM (IWC liquid, KG-per-litre
      // factor) when defined, else the Prodshade's own base UOM. Only Batch Size and
      // Pack Size are shown in it -- every total stays in Base UOM (KG).
      const conversionUom = toTrimmedString(stroke?.conversion_uom_code);
      const conversionFactor = toNumber(stroke?.conversion_factor);
      const useConversion = Boolean(conversionUom) && conversionFactor > 0;
      const prodshadeUom = useConversion ? conversionUom : (toTrimmedString(prodshade?.base_uom_code) || "KG");
      const toProdshadeUom = (kg: number) => (useConversion ? round6(kg / conversionFactor) : round6(kg));

      const postingDates = (ledgerIdsByProcess.get(poId) ?? [])
        .map((ledgerId) => postingDateByLedger.get(ledgerId) ?? "")
        .filter(Boolean)
        .sort();

      for (const pack of reportPacks) {
        const sku = pack ? materialMap.get(String(pack.material_id)) : null;
        const fillKg = pack ? toNumber(pack.fill_qty_per_pack) : 0;
        const numPacks = pack ? toNumber(pack.num_packs) : 0;
        const batchFrom = toTrimmedString(pack?.batch_number_from) || toTrimmedString(po.batch_number_from);
        const batchTo = toTrimmedString(pack?.batch_number_to) || toTrimmedString(po.batch_number_to);
        let numberOfBatches = batchFrom && batchTo ? countBatchesInRange(batchFrom, batchTo) : null;
        // A legacy pack row with no batch range: only unambiguous when the Process PO has exactly one pack row.
        if (numberOfBatches === null && packs.length <= 1) numberOfBatches = processBatches;

        const totalInput = numberOfBatches === null ? null : round6(batchSizeKg * numberOfBatches);
        // Before Verify there is no actual output or stock posting. Do not fall
        // back to planned pack values here: they must never look like actuals.
        const totalOutput = isVerified && pack
          ? round6(pack.actual_qty_kg != null ? toNumber(pack.actual_qty_kg) : numPacks * fillKg)
          : null;
        const lossGain = totalInput === null || totalOutput === null ? null : round6(totalOutput - totalInput);
        const lossGainPct = totalInput && totalInput > 0 && lossGain !== null ? round6((lossGain / totalInput) * 100) : null;

        result.push({
          id: pack ? String(pack.id) : `process:${poId}`,
          status: processStatus,
          status_label: statusLabel,
          is_pending: isPending,
          production_date: toTrimmedString(po.production_date),
          shift_name: shiftMap.get(toTrimmedString(po.shift_id)) ?? null,
          prodshade_code: prodshade?.external_code ?? null,
          prodshade_document_name: prodshade?.document_name || prodshade?.material_name || null,
          stroke_number: stroke?.stroke_number ?? null,
          process_po_number: po.po_number,
          packing_po_number: pack?.po_number ?? null,
          sku_code: sku?.external_code ?? null,
          sku_document_name: sku?.document_name || sku?.material_name || null,
          start_batch: batchFrom || null,
          to_batch: batchTo || null,
          number_of_batches: numberOfBatches,
          batch_size: toProdshadeUom(batchSizeKg),
          prodshade_uom: prodshadeUom,
          total_input_base_uom: totalInput,
          total_output_base_uom: totalOutput,
          pack_size: toProdshadeUom(fillKg),
          number_of_bags: numPacks,
          loss_gain: lossGain,
          loss_gain_pct: lossGainPct,
          posting_date: isVerified ? (postingDates[0] ?? null) : null,
          standard_by: userDisplayMap.get(toTrimmedString(po.created_by)) ?? null,
          verified_by: isVerified ? (userDisplayMap.get(toTrimmedString(po.verified_by)) ?? null) : null,
        });
      }
    }

    return okResponse({ data: result }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_MTS_REGISTER_FAILED";
    return oisErr(req, ctx, code, 500, "MTS Production Register failed");
  }
}
