/*
 * File-ID: 27.FE-PR24-BE
 * File-Path: supabase/functions/api/_core/production/order_information_system.handlers.ts
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: PR24 "Order Information System" — SAP COOIS-equivalent selection screen + full
 *          transaction ledger report for Process/Packing Orders. See feasibility doc §122.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import { assertProdReadRole, toTrimmedString, toUpperTrimmedString } from "./production.shared.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";

type JsonRecord = Record<string, unknown>;

const MAX_DATE_RANGE_DAYS = 365;
const MAX_ORDERS_MATCHED = 200;

function oisErr(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

function parseMultiValueParams(url: URL, pluralKey: string, singularKey?: string): string[] {
  const collected = [
    ...url.searchParams.getAll(pluralKey),
    singularKey ? url.searchParams.get(singularKey) ?? "" : "",
  ];
  return [...new Set(
    collected
      .flatMap((entry) => String(entry ?? "").split(","))
      .map((entry) => toTrimmedString(entry))
      .filter(Boolean),
  )];
}

function parseIsoDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// §122.5 — no rank gate, company-boundary only. Mirrors listProcessOrders/listPackingOrders'
// own scoping (§112) — returns null for SA/GA/admin-bypass (no filter), otherwise the
// caller's real erp_map.user_companies list. A requested company outside that list is
// silently dropped, never a 403 here — the caller-facing "no leak" behavior for PO Number
// lookups depends on this never revealing which companies exist vs which the user can see.
async function resolveAllowedCompanyIds(ctx: ProdHandlerContext): Promise<string[] | null> {
  if (ctx.context.isAdmin === true || ctx.roleCode === "SA" || ctx.roleCode === "GA") {
    return null;
  }
  const { data, error } = await serviceRoleClient
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", ctx.auth_user_id);
  if (error) {
    console.error("[order_information_system.getReport] user_companies query failed:", JSON.stringify(error));
    throw new Error("PROD_OIS_SCOPE_FAILED");
  }
  return [...new Set(((data ?? []) as JsonRecord[]).map((row) => String(row.company_id ?? "")).filter(Boolean))];
}

function scopeCompanyIds(allowed: string[] | null, requested: string[]): string[] | null {
  if (!allowed) return requested.length > 0 ? requested : null; // SA/GA: unfiltered unless caller narrowed it themselves
  if (requested.length === 0) return allowed;
  const scoped = requested.filter((id) => allowed.includes(id));
  return scoped; // deliberately NOT throwing on a denied id — see resolveAllowedCompanyIds' no-leak note
}

// GET /api/production/order-information-system
export async function getOrderInformationReportHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);

    const poNumber = toTrimmedString(url.searchParams.get("po_number"));
    const tab = toUpperTrimmedString(url.searchParams.get("tab")) === "PACKING" ? "PACKING" : "PROCESS";
    const requestedCompanyIds = parseMultiValueParams(url, "company_ids", "company_id");
    const orderType = toUpperTrimmedString(url.searchParams.get("order_type"));
    const materialId = toTrimmedString(url.searchParams.get("material_id"));
    const batchNumber = toTrimmedString(url.searchParams.get("batch_number"));
    const machineId = toTrimmedString(url.searchParams.get("machine_id"));
    const segmentCode = toUpperTrimmedString(url.searchParams.get("segment_code"));
    const strokeMasterId = toTrimmedString(url.searchParams.get("stroke_master_id"));
    const statuses = parseMultiValueParams(url, "statuses", "status").map((s) => s.toUpperCase());
    const hasDeviationOnly = toTrimmedString(url.searchParams.get("has_unapproved_deviation")) === "true";
    const showLinkedPacking = toTrimmedString(url.searchParams.get("show_linked_packing")) === "true";
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));

    const allowedCompanyIds = await resolveAllowedCompanyIds(ctx);
    const companyIds = scopeCompanyIds(allowedCompanyIds, requestedCompanyIds);
    // Empty (not null) means: caller explicitly asked for companies they don't have —
    // resolve to "definitely nothing" rather than accidentally falling through to "all".
    if (companyIds !== null && companyIds.length === 0 && requestedCompanyIds.length > 0) {
      return okResponse({ data: [], meta: { order_count: 0, movement_count: 0 } }, ctx.request_id, req);
    }

    const bypassDateRange = Boolean(poNumber);
    if (!bypassDateRange) {
      if (!dateFrom || !dateTo) {
        return oisErr(req, ctx, "PROD_OIS_DATE_RANGE_REQUIRED", 400, "Posting date range is required unless a PO Number is given.");
      }
      const from = parseIsoDate(dateFrom);
      const to = parseIsoDate(dateTo);
      if (!from || !to || to.getTime() < from.getTime()) {
        return oisErr(req, ctx, "PROD_OIS_DATE_RANGE_INVALID", 400, "date_from/date_to are invalid.");
      }
      const diffDays = Math.floor((to.getTime() - from.getTime()) / 86400000);
      if (diffDays > MAX_DATE_RANGE_DAYS) {
        return oisErr(req, ctx, "PROD_OIS_DATE_RANGE_TOO_WIDE", 400, "Date range cannot exceed 365 days.");
      }
    }

    // ── Step 1: resolve which Process/Packing Orders are in scope ─────────────────────────
    let processOrders: JsonRecord[] = [];
    let packingOrdersDirect: JsonRecord[] = []; // only populated by a direct PACK_PO po_number lookup

    if (poNumber) {
      const isPackingNumber = poNumber.startsWith("94");
      if (isPackingNumber || tab === "PACKING") {
        let pq = serviceRoleClient.schema("erp_production").from("packing_order")
          .select("id, company_id, po_number, po_type, process_order_id, status, num_packs, fill_qty_per_pack")
          .eq("po_number", poNumber);
        if (companyIds) pq = pq.in("company_id", companyIds);
        const { data, error } = await pq;
        if (error) throw new Error("PROD_OIS_LOOKUP_FAILED");
        packingOrdersDirect = (data ?? []) as JsonRecord[];
        const processOrderIds = [...new Set(packingOrdersDirect.map((r) => String(r.process_order_id ?? "")).filter(Boolean))];
        if (processOrderIds.length > 0) {
          const { data: parents, error: parentErr } = await serviceRoleClient
            .schema("erp_production").from("process_order")
            .select("id, company_id, po_number, po_type, batch_number, status, stroke_master_id")
            .in("id", processOrderIds);
          if (parentErr) throw new Error("PROD_OIS_LOOKUP_FAILED");
          processOrders = (parents ?? []) as JsonRecord[];
        }
      } else {
        let pq = serviceRoleClient.schema("erp_production").from("process_order")
          .select("id, company_id, po_number, po_type, batch_number, status, stroke_master_id")
          .eq("po_number", poNumber);
        if (companyIds) pq = pq.in("company_id", companyIds);
        const { data, error } = await pq;
        if (error) throw new Error("PROD_OIS_LOOKUP_FAILED");
        processOrders = (data ?? []) as JsonRecord[];
      }
    } else if (tab === "PROCESS") {
      let pq = serviceRoleClient.schema("erp_production").from("process_order")
        .select("id, company_id, po_number, po_type, batch_number, status, material_id, machine_id, segment_code, stroke_master_id, has_unapproved_deviation")
        .order("created_at", { ascending: false })
        .limit(MAX_ORDERS_MATCHED);
      if (companyIds) pq = pq.in("company_id", companyIds);
      if (orderType) pq = pq.eq("po_type", orderType);
      if (materialId) pq = pq.eq("material_id", materialId);
      if (batchNumber) pq = pq.eq("batch_number", batchNumber);
      if (machineId) pq = pq.eq("machine_id", machineId);
      if (segmentCode) pq = pq.eq("segment_code", segmentCode);
      if (strokeMasterId) pq = pq.eq("stroke_master_id", strokeMasterId);
      if (statuses.length > 0) pq = pq.in("status", statuses);
      if (hasDeviationOnly) pq = pq.eq("has_unapproved_deviation", true);
      const { data, error } = await pq;
      if (error) throw new Error("PROD_OIS_LOOKUP_FAILED");
      processOrders = (data ?? []) as JsonRecord[];
    } else {
      let pq = serviceRoleClient.schema("erp_production").from("packing_order")
        .select("id, company_id, po_number, po_type, process_order_id, status, material_id, segment_code, num_packs, fill_qty_per_pack")
        .order("created_at", { ascending: false })
        .limit(MAX_ORDERS_MATCHED);
      if (companyIds) pq = pq.in("company_id", companyIds);
      if (orderType) pq = pq.eq("po_type", orderType);
      if (materialId) pq = pq.eq("material_id", materialId);
      if (segmentCode) pq = pq.eq("segment_code", segmentCode);
      if (statuses.length > 0) pq = pq.in("status", statuses);
      const { data, error } = await pq;
      if (error) throw new Error("PROD_OIS_LOOKUP_FAILED");
      packingOrdersDirect = (data ?? []) as JsonRecord[];
      const processOrderIds = [...new Set(packingOrdersDirect.map((r) => String(r.process_order_id ?? "")).filter(Boolean))];
      if (processOrderIds.length > 0) {
        const { data: parents, error: parentErr } = await serviceRoleClient
          .schema("erp_production").from("process_order")
          .select("id, company_id, po_number, po_type, batch_number, status, stroke_master_id")
          .in("id", processOrderIds);
        if (parentErr) throw new Error("PROD_OIS_LOOKUP_FAILED");
        processOrders = (parents ?? []) as JsonRecord[];
      }
    }

    if (processOrders.length === 0 && packingOrdersDirect.length === 0) {
      return okResponse({ data: [], meta: { order_count: 0, movement_count: 0 } }, ctx.request_id, req);
    }

    // ── Step 2: resolve linked Packing Orders (checkbox, or implied by a direct PACK_PO lookup) ──
    const processOrderIds = processOrders.map((o) => String(o.id));
    const batchNumbers = [...new Set(processOrders.map((o) => toTrimmedString(o.batch_number)).filter(Boolean))];
    const companyIdsInScope = [...new Set(processOrders.map((o) => String(o.company_id)).concat(packingOrdersDirect.map((o) => String(o.company_id))))];

    let linkedPackingOrders: JsonRecord[] = [...packingOrdersDirect];
    if (showLinkedPacking && processOrderIds.length > 0) {
      const { data: linked, error: linkedErr } = await serviceRoleClient
        .schema("erp_production").from("packing_order")
        .select("id, company_id, po_number, po_type, process_order_id, status, num_packs, fill_qty_per_pack")
        .in("process_order_id", processOrderIds);
      if (linkedErr) throw new Error("PROD_OIS_LOOKUP_FAILED");
      const seen = new Set(linkedPackingOrders.map((r) => String(r.id)));
      for (const row of (linked ?? []) as JsonRecord[]) {
        if (!seen.has(String(row.id))) {
          linkedPackingOrders.push(row);
          seen.add(String(row.id));
        }
      }
    }
    const packingOrderIds = linkedPackingOrders.map((o) => String(o.id));

    // ── Step 3: resolve stock_document ids tagged directly to these orders ────────────────
    // processOrderIds/packingOrderIds are capped at MAX_ORDERS_MATCHED, but each order can
    // have several stock_document rows over its lifecycle (Standard/Final/Verify/corrections/
    // reversals), so docIds isn't bounded the same way -- chunked for safety (see
    // _shared/chunkedIn.ts / the IN02/PR24 URL-length fix).
    const docIds = new Set<string>();
    if (processOrderIds.length > 0) {
      const rows = await fetchInChunks<JsonRecord>(processOrderIds, (idChunk) =>
        serviceRoleClient.schema("erp_inventory").from("stock_document")
          .select("id").eq("reference_document_type", "PROC_PO").in("reference_document_id", idChunk))
        .catch(() => { throw new Error("PROD_OIS_LOOKUP_FAILED"); });
      for (const row of rows) docIds.add(String(row.id));
    }
    if (packingOrderIds.length > 0) {
      const rows = await fetchInChunks<JsonRecord>(packingOrderIds, (idChunk) =>
        serviceRoleClient.schema("erp_inventory").from("stock_document")
          .select("id").eq("reference_document_type", "PACK_PO").in("reference_document_id", idChunk))
        .catch(() => { throw new Error("PROD_OIS_LOOKUP_FAILED"); });
      for (const row of rows) docIds.add(String(row.id));
    }

    // ── Step 4: fetch stock_ledger rows — by resolved doc ids, UNION by batch_number ───────
    // §122.2 — both conditions are required: reference-tag alone misses non-PROC_PO/PACK_PO
    // events against the same batch (e.g. a PID difference posting, tagged 'PI'); batch_number
    // alone misses every RM/PM/INT line, which never carries a batch number of its own.
    const ledgerRowsById = new Map<string, JsonRecord>();

    if (docIds.size > 0) {
      const ledgerSelect = "id, stock_document_id, posting_date, company_id, storage_location_id, material_id, batch_number, movement_type_code, direction, quantity, posted_quantity, base_uom_code, value, posted_value, valuation_rate, created_at";
      let rows: JsonRecord[];
      try {
        rows = await fetchInChunks<JsonRecord>([...docIds], (idChunk) => {
          let lq = serviceRoleClient.schema("erp_inventory").from("stock_ledger")
            .select(ledgerSelect)
            .in("stock_document_id", idChunk);
          if (!bypassDateRange) {
            lq = (lq as unknown as { gte: (c: string, v: string) => typeof lq }).gte("posting_date", dateFrom);
            lq = (lq as unknown as { lte: (c: string, v: string) => typeof lq }).lte("posting_date", dateTo);
          }
          return lq;
        });
      } catch {
        throw new Error("PROD_OIS_LEDGER_FETCH_FAILED");
      }
      for (const row of rows) ledgerRowsById.set(String(row.id), row);
    }

    if (batchNumbers.length > 0) {
      let lq = serviceRoleClient.schema("erp_inventory").from("stock_ledger")
        .select("id, stock_document_id, posting_date, company_id, storage_location_id, material_id, batch_number, movement_type_code, direction, quantity, posted_quantity, base_uom_code, value, posted_value, valuation_rate, created_at")
        .in("batch_number", batchNumbers)
        .in("company_id", companyIdsInScope);
      if (!bypassDateRange) {
        lq = (lq as unknown as { gte: (c: string, v: string) => typeof lq }).gte("posting_date", dateFrom);
        lq = (lq as unknown as { lte: (c: string, v: string) => typeof lq }).lte("posting_date", dateTo);
      }
      const { data, error } = await lq;
      if (error) throw new Error("PROD_OIS_LEDGER_FETCH_FAILED");
      for (const row of (data ?? []) as JsonRecord[]) ledgerRowsById.set(String(row.id), row);
    }

    const ledgerRows = [...ledgerRowsById.values()].sort((a, b) => {
      const dateCompare = String(a.posting_date ?? "").localeCompare(String(b.posting_date ?? ""));
      if (dateCompare !== 0) return dateCompare;
      return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
    });

    if (ledgerRows.length === 0) {
      return okResponse({ data: [], meta: { order_count: processOrders.length + packingOrdersDirect.length, movement_count: 0 } }, ctx.request_id, req);
    }

    // ── Step 5: bulk-resolve everything the grid needs to render ───────────────────────────
    const stockDocIds = [...new Set(ledgerRows.map((r) => String(r.stock_document_id)).filter(Boolean))];
    const materialIds = [...new Set(ledgerRows.map((r) => String(r.material_id)).filter(Boolean))];
    const rowCompanyIds = [...new Set(ledgerRows.map((r) => String(r.company_id)).filter(Boolean))];

    // stockDocIds/materialIds scale 1:1 with the row count -- a wide date range with no
    // narrowing filter can put hundreds of distinct ids in a single .in() call, which
    // PostgREST sends as a GET request with the id list encoded in the URL. Found live
    // 2026-08-19 on IN02's equivalent query (~400 ids -> a URL long enough to be rejected
    // before ever reaching Postgres/PostgREST, no server-side log trail either). Chunked via
    // fetchInChunks to keep each request small regardless of result-set size.
    let docRows: JsonRecord[];
    let materialRows: JsonRecord[];
    let companyRows: JsonRecord[];
    try {
      [docRows, materialRows, companyRows] = await Promise.all([
        fetchInChunks<JsonRecord>(stockDocIds, (idChunk) =>
          serviceRoleClient.schema("erp_inventory").from("stock_document")
            .select("id, reference_document_type, reference_document_id, reference_document_number")
            .in("id", idChunk)),
        fetchInChunks<JsonRecord>(materialIds, (idChunk) =>
          serviceRoleClient.schema("erp_master").from("material_master")
            .select("id, pace_code, external_code, material_name, material_type")
            .in("id", idChunk)),
        fetchInChunks<JsonRecord>(rowCompanyIds, (idChunk) =>
          serviceRoleClient.schema("erp_master").from("companies")
            .select("id, company_code").in("id", idChunk)),
      ]);
    } catch {
      throw new Error("PROD_OIS_ENRICH_FAILED");
    }
    const docMap = new Map(docRows.map((r) => [String(r.id), r]));
    const materialMap = new Map(materialRows.map((r) => [String(r.id), r]));
    const companyMap = new Map(companyRows.map((r) => [String(r.id), r]));

    // APL Qty / Variance / Dosage / Standard sidecar — §122.3, redesigned 2026-08-26.
    // Previously matched by (process_order_id|packing_order_id) + material_id, which stamps
    // the SAME aggregated numbers onto EVERY stock_ledger row for that material — including a
    // later P262 reversal or a correction-added extra P261 line. Confirmed live on prod
    // (CMP006 PO 9300000070, batch BM05698, material WATER): a COR6 correction posted a P262
    // credit of 1.8, and the old logic showed that P262 row with the SAME Standard Qty/Dosage%
    // as the original P261 issue — a user reading the grid row-by-row would double-count it.
    //
    // Fix: each process_order_line/packing_order_line row has its own stock_ledger_id, which
    // always anchors to that line's OWN ORIGINAL posting (verified live — corrections/
    // reversals post a NEW stock_ledger row but never repoint this column). Reco rows are
    // now aggregated per line_id (so a correction against the same line still nets in), then
    // attached ONLY to that line's anchor stock_ledger row. Any other ledger row for the same
    // material in the same order (a P262 reversal, or a second, independent line — e.g. the
    // same RM entered twice in the Stroke recipe, each with its own line + anchor) shows null,
    // never a duplicated/borrowed value. SFG/FG rows still never match (no process_order_line
    // exists for them), so they stay null exactly as before.
    const [procLineRows, packLineRows] = await Promise.all([
      processOrderIds.length > 0
        ? fetchInChunks<JsonRecord>(processOrderIds, (idChunk) =>
            serviceRoleClient.schema("erp_production").from("process_order_line")
              .select("id, stock_ledger_id").in("process_order_id", idChunk).not("stock_ledger_id", "is", null))
            .catch(() => { throw new Error("PROD_OIS_ENRICH_FAILED"); })
        : Promise.resolve([]),
      packingOrderIds.length > 0
        ? fetchInChunks<JsonRecord>(packingOrderIds, (idChunk) =>
            serviceRoleClient.schema("erp_production").from("packing_order_line")
              .select("id, stock_ledger_id").in("packing_order_id", idChunk).not("stock_ledger_id", "is", null))
            .catch(() => { throw new Error("PROD_OIS_ENRICH_FAILED"); })
        : Promise.resolve([]),
    ]);
    const [procRecoResp, packRecoResp] = await Promise.all([
      processOrderIds.length > 0
        ? serviceRoleClient.schema("erp_production").from("process_order_line_reco")
            .select("process_order_line_id, ap_approved_qty, variance_qty, dosage_pct, standard_qty")
            .in("process_order_id", processOrderIds).eq("is_voided", false)
        : Promise.resolve({ data: [], error: null }),
      packingOrderIds.length > 0
        ? serviceRoleClient.schema("erp_production").from("packing_order_line_reco")
            .select("packing_order_line_id, ap_approved_qty, variance_qty, standard_qty")
            .in("packing_order_id", packingOrderIds).eq("is_voided", false)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (procRecoResp.error || packRecoResp.error) throw new Error("PROD_OIS_ENRICH_FAILED");

    type RecoAgg = { apl: number; variance: number; dosagePct: number | null; standardQty: number | null };
    const recoByProcLineId = new Map<string, RecoAgg>();
    for (const row of (procRecoResp.data ?? []) as JsonRecord[]) {
      const key = String(row.process_order_line_id);
      const prev = recoByProcLineId.get(key) ?? { apl: 0, variance: 0, dosagePct: null, standardQty: null };
      const rowDosagePct = row.dosage_pct != null ? Number(row.dosage_pct) : null;
      recoByProcLineId.set(key, {
        apl: prev.apl + (Number(row.ap_approved_qty) || 0),
        variance: prev.variance + (Number(row.variance_qty) || 0),
        // A correction row against this same line (e.g. COR6_CORRECTION) may have no
        // dosage_pct of its own — add nothing rather than resetting the running total.
        dosagePct: rowDosagePct != null ? (prev.dosagePct ?? 0) + rowDosagePct : prev.dosagePct,
        standardQty: (prev.standardQty ?? 0) + (Number(row.standard_qty) || 0),
      });
    }
    const recoByPackLineId = new Map<string, RecoAgg>();
    for (const row of (packRecoResp.data ?? []) as JsonRecord[]) {
      const key = String(row.packing_order_line_id);
      const prev = recoByPackLineId.get(key) ?? { apl: 0, variance: 0, dosagePct: null, standardQty: null };
      recoByPackLineId.set(key, {
        apl: prev.apl + (Number(row.ap_approved_qty) || 0),
        variance: prev.variance + (Number(row.variance_qty) || 0),
        // Corrected 2026-08-26: packing_order_line_reco.standard_qty IS a real, populated
        // column (qty_per_pack x num_packs at Final) -- this was previously discarded as
        // null, even though the data existed. There is genuinely no dosage_pct column for
        // PM (Pack BOM has no %-based concept, only qty_per_pack), so that stays null.
        dosagePct: null,
        standardQty: (prev.standardQty ?? 0) + (Number(row.standard_qty) || 0),
      });
    }

    const recoByStockLedgerId = new Map<string, RecoAgg>();
    for (const line of procLineRows) {
      const reco = recoByProcLineId.get(String(line.id));
      if (reco) recoByStockLedgerId.set(String(line.stock_ledger_id), reco);
    }
    for (const line of packLineRows) {
      const reco = recoByPackLineId.get(String(line.id));
      if (reco) recoByStockLedgerId.set(String(line.stock_ledger_id), reco);
    }

    // §122.1, refined 2026-08-26 — every row is tagged with the Process Order it ultimately
    // belongs to (directly via a PROC_PO reference, via a linked Packing PO's own parent, or
    // via the batch_number union for non-PO-tagged events like a PID difference), then
    // re-sorted group-by-group into 6 fixed tiers so a large date-range list visually reads
    // as a sequence of distinct order-groups instead of an undifferentiated blob:
    //   1. Process PO's own SFG P101 (the batch's output — always leads its group)
    //   2. Process PO's RM/INT issues (what made that SFG)
    //   3. Packing PO's FG P101 (the SFG turned into a dispatchable SKU)
    //   4. Packing PO's PM issues (what packed that FG)
    //   5. QA movements (P32x/P33x/P34x release/hold/reject family) — regardless of which
    //      order they're tagged to; Process PO Verify's own P321 auto-release leg on the SAME
    //      SFG material as tier 1 belongs here, not tier 1, since it's a QA action, not the
    //      output-creation event itself.
    //   6. Packing PO's SFG P261 (the SFG being consumed to make that FG — closes the loop)
    // Anything not matching any of the above (e.g. a bare P262 reversal leg) falls into a
    // catch-all last tier rather than silently breaking the sort.
    // Stroke Number column (business owner, 2026-09-03) -- resolved from each row's
    // owning Process Order's stroke_master_id, same "owningOrder" every row already
    // computes below for grouping. SFG/FG rows on an INT/MTEST order (no stroke) get
    // null, same as every other "not applicable" field on this report.
    const strokeMasterIds = [...new Set(processOrders.map((o) => toTrimmedString(o.stroke_master_id)).filter(Boolean))];
    const strokeRows = strokeMasterIds.length > 0
      ? await fetchInChunks<JsonRecord>(strokeMasterIds, (idChunk) =>
          serviceRoleClient.schema("erp_production").from("stroke_master")
            .select("id, stroke_number").in("id", idChunk))
          .catch(() => { throw new Error("PROD_OIS_ENRICH_FAILED"); })
      : [];
    const strokeNumberById = new Map(strokeRows.map((r) => [String(r.id), r.stroke_number]));

    const processOrderById = new Map(processOrders.map((o) => [String(o.id), o]));
    const processOrderByBatch = new Map(
      processOrders.filter((o) => toTrimmedString(o.batch_number)).map((o) => [toTrimmedString(o.batch_number), o]),
    );
    const packingOrderById = new Map(linkedPackingOrders.map((po) => [String(po.id), po]));
    const packingOrderToProcessOrder = new Map(
      linkedPackingOrders
        .map((po) => [String(po.id), processOrderById.get(String(po.process_order_id))] as const)
        .filter((entry): entry is [string, JsonRecord] => Boolean(entry[1])),
    );

    const QA_MOVEMENT_PREFIXES = ["P32", "P33", "P34"];
    function computeRowTier(refType: string, materialType: string, movementTypeCode: string): number {
      const mvt = toUpperTrimmedString(movementTypeCode);
      if (QA_MOVEMENT_PREFIXES.some((prefix) => mvt.startsWith(prefix))) return 5;
      if (refType === "PROC_PO") {
        if (materialType === "SFG" && mvt === "P101") return 1;
        if (materialType === "RM" || materialType === "INT") return 2;
      }
      if (refType === "PACK_PO") {
        if (materialType === "FG" && mvt === "P101") return 3;
        if (materialType === "PM") return 4;
        if (materialType === "SFG" && mvt === "P261") return 6;
      }
      return 7;
    }

    const rows = ledgerRows.map((row) => {
      const doc = docMap.get(String(row.stock_document_id));
      const material = materialMap.get(String(row.material_id));
      const company = companyMap.get(String(row.company_id));
      const refType = toTrimmedString(doc?.reference_document_type);
      const refId = toTrimmedString(doc?.reference_document_id);
      // Keyed by this exact ledger row's own id — only the line's ORIGINAL anchor posting
      // matches (see the recoByStockLedgerId build above); a later reversal/correction
      // posting against the same material is a different stock_ledger row and gets null.
      const reco = recoByStockLedgerId.get(String(row.id));

      let owningOrder: JsonRecord | undefined;
      if (refType === "PROC_PO") owningOrder = processOrderById.get(refId);
      else if (refType === "PACK_PO") owningOrder = packingOrderToProcessOrder.get(refId);
      if (!owningOrder && toTrimmedString(row.batch_number)) owningOrder = processOrderByBatch.get(toTrimmedString(row.batch_number));
      const groupPoNumber = owningOrder ? toTrimmedString(owningOrder.po_number) : (toTrimmedString(doc?.reference_document_number) || "UNGROUPED");

      const materialType = toUpperTrimmedString(material?.material_type);
      const tier = computeRowTier(refType, materialType, String(row.movement_type_code ?? ""));
      // Num Packs / Per Pack only mean anything on the Packing PO's own FG receipt row
      // (tier 3) -- every other row leaves these null, not zero, since "not applicable"
      // and "zero packs" are different facts.
      const packingOrder = tier === 3 ? packingOrderById.get(refId) : undefined;
      return {
        id: row.id,
        company_id: row.company_id,
        company_code: company?.company_code ?? null,
        posting_date: row.posting_date,
        material_id: row.material_id,
        material_name: material?.material_name ?? null,
        external_code: material?.external_code || material?.pace_code || null,
        pace_code: material?.pace_code ?? null,
        material_type: material?.material_type ?? null,
        stroke_number: owningOrder ? strokeNumberById.get(toTrimmedString(owningOrder.stroke_master_id)) ?? null : null,
        movement_type_code: row.movement_type_code,
        direction: row.direction,
        // Signed: negative for OUT, positive for IN (posted_quantity is a GENERATED column
        // on stock_ledger -- see feasibility doc Section 124).
        quantity: row.posted_quantity,
        base_uom_code: row.base_uom_code,
        batch_number: row.batch_number,
        reference_document_type: refType || null,
        reference_document_number: toTrimmedString(doc?.reference_document_number) || null,
        dosage_pct: reco ? reco.dosagePct : null,
        standard_qty: reco ? reco.standardQty : null,
        apl_qty: reco ? reco.apl : null,
        variance_qty: reco ? reco.variance : null,
        num_packs: packingOrder ? packingOrder.num_packs ?? null : null,
        fill_qty_per_pack: packingOrder ? packingOrder.fill_qty_per_pack ?? null : null,
        // Tier 1 (Process PO's own SFG receipt) is where every group visually begins —
        // the frontend bands this row so a long, mixed-date-range list reads as a
        // sequence of distinct groups instead of one undifferentiated blob.
        is_group_start: tier === 1,
        _group_po_number: groupPoNumber,
        _created_at: toTrimmedString(row.created_at),
        _tier: tier,
      };
    });

    const groupMinDate = new Map<string, string>();
    for (const row of rows) {
      const key = row._group_po_number;
      const current = groupMinDate.get(key);
      if (!current || String(row.posting_date) < current) groupMinDate.set(key, String(row.posting_date));
    }
    rows.sort((a, b) => {
      const groupCompare = (groupMinDate.get(a._group_po_number) ?? "").localeCompare(groupMinDate.get(b._group_po_number) ?? "");
      if (groupCompare !== 0) return groupCompare;
      if (a._group_po_number !== b._group_po_number) return a._group_po_number.localeCompare(b._group_po_number);
      if (a._tier !== b._tier) return a._tier - b._tier;
      const dateCompare = String(a.posting_date ?? "").localeCompare(String(b.posting_date ?? ""));
      if (dateCompare !== 0) return dateCompare;
      return a._created_at.localeCompare(b._created_at);
    });
    for (const row of rows) {
      delete (row as JsonRecord)._group_po_number;
      delete (row as JsonRecord)._created_at;
      delete (row as JsonRecord)._tier;
    }

    return okResponse({
      data: rows,
      meta: { order_count: processOrders.length + packingOrdersDirect.length, movement_count: rows.length },
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_OIS_REPORT_FAILED";
    return oisErr(req, ctx, code, 500, "Order Information System report failed");
  }
}

// GET /api/production/order-information-system/batch-counts
// Business owner ask (2026-09-03): a PR24 "Batch Counts" button opens a Date Range
// modal, then a full-page report of how many batches were made per SFG per Stroke
// in that range. "Made" = batch_started_at (the moment a real batch NUMBER is
// generated at Start Batch, per §83.4 — the same event that makes a batch a batch,
// regardless of how far it later got). REVERSED excluded — a reversed batch's
// number is voided (§83.4 "Reverse... makes the batch number permanently dead" /
// RELEASED-for-reuse mechanism), so it never produced real output. Same
// no-rank/company-boundary-only access as the main report above.
export async function getBatchCountsReportHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const requestedCompanyIds = parseMultiValueParams(url, "company_ids", "company_id");
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));

    if (!dateFrom || !dateTo) {
      return oisErr(req, ctx, "PROD_OIS_DATE_RANGE_REQUIRED", 400, "Date range is required.");
    }
    const from = parseIsoDate(dateFrom);
    const to = parseIsoDate(dateTo);
    if (!from || !to || to.getTime() < from.getTime()) {
      return oisErr(req, ctx, "PROD_OIS_DATE_RANGE_INVALID", 400, "date_from/date_to are invalid.");
    }
    const diffDays = Math.floor((to.getTime() - from.getTime()) / 86400000);
    if (diffDays > MAX_DATE_RANGE_DAYS) {
      return oisErr(req, ctx, "PROD_OIS_DATE_RANGE_TOO_WIDE", 400, "Date range cannot exceed 365 days.");
    }
    // batch_started_at is a timestamptz; date_to must include the whole day.
    const toExclusive = new Date(to.getTime() + 86400000).toISOString();

    const allowedCompanyIds = await resolveAllowedCompanyIds(ctx);
    const companyIds = scopeCompanyIds(allowedCompanyIds, requestedCompanyIds);
    if (companyIds !== null && companyIds.length === 0 && requestedCompanyIds.length > 0) {
      return okResponse({ data: [] }, ctx.request_id, req);
    }

    // No batch_started_at filter here — fetched once, unrestricted by date, so the
    // SAME row set can be grouped into both the selected-range count and the
    // "Till Date" (all-time) count below without a second round trip.
    let pq = serviceRoleClient.schema("erp_production").from("process_order")
      .select("company_id, stroke_master_id, material_id, batch_number, batch_started_at")
      .not("batch_number", "is", null)
      .neq("status", "REVERSED");
    if (companyIds) pq = pq.in("company_id", companyIds);
    const { data, error } = await pq;
    if (error) throw new Error("PROD_OIS_BATCH_COUNTS_FAILED");

    const rangeStartMs = new Date(`${dateFrom}T00:00:00Z`).getTime();
    const rangeEndExclusiveMs = new Date(toExclusive).getTime();
    const rows = (data ?? []) as JsonRecord[];
    // "Till Date" (business owner, 2026-09-03) — the same group's all-time total
    // batch count, next to the selected-range count, regardless of which range
    // was picked in the modal.
    type GroupAgg = { companyId: string; strokeMasterId: string | null; materialId: string; batchNumbersInRange: Set<string>; batchNumbersTillDate: Set<string> };
    const groups = new Map<string, GroupAgg>();
    for (const row of rows) {
      const companyId = String(row.company_id);
      const strokeMasterId = toTrimmedString(row.stroke_master_id) || null;
      const materialId = String(row.material_id);
      const key = `${companyId}::${strokeMasterId ?? ""}::${materialId}`;
      if (!groups.has(key)) groups.set(key, { companyId, strokeMasterId, materialId, batchNumbersInRange: new Set(), batchNumbersTillDate: new Set() });
      const group = groups.get(key)!;
      const batchNumber = toTrimmedString(row.batch_number);
      const batchStartedAtMs = row.batch_started_at ? new Date(String(row.batch_started_at)).getTime() : NaN;
      group.batchNumbersTillDate.add(batchNumber);
      if (Number.isFinite(batchStartedAtMs) && batchStartedAtMs >= rangeStartMs && batchStartedAtMs < rangeEndExclusiveMs) {
        group.batchNumbersInRange.add(batchNumber);
      }
    }

    const groupList = [...groups.values()];
    const strokeMasterIds = [...new Set(groupList.map((g) => g.strokeMasterId).filter((v): v is string => Boolean(v)))];
    const materialIds = [...new Set(groupList.map((g) => g.materialId))];
    const companyIdsInResult = [...new Set(groupList.map((g) => g.companyId))];

    let strokeRows: JsonRecord[];
    let materialRows: JsonRecord[];
    let companyRows: JsonRecord[];
    try {
      [strokeRows, materialRows, companyRows] = await Promise.all([
        strokeMasterIds.length > 0
          ? fetchInChunks<JsonRecord>(strokeMasterIds, (idChunk) =>
              serviceRoleClient.schema("erp_production").from("stroke_master")
                .select("id, stroke_number").in("id", idChunk))
          : Promise.resolve([]),
        fetchInChunks<JsonRecord>(materialIds, (idChunk) =>
          serviceRoleClient.schema("erp_master").from("material_master")
            .select("id, pace_code, external_code, material_name, document_name, material_category, material_type").in("id", idChunk)),
        fetchInChunks<JsonRecord>(companyIdsInResult, (idChunk) =>
          serviceRoleClient.schema("erp_master").from("companies")
            .select("id, company_code").in("id", idChunk)),
      ]);
    } catch {
      throw new Error("PROD_OIS_BATCH_COUNTS_ENRICH_FAILED");
    }
    const strokeMap = new Map(strokeRows.map((r) => [String(r.id), r.stroke_number]));
    const materialMap = new Map(materialRows.map((r) => [String(r.id), r]));
    const companyMap = new Map(companyRows.map((r) => [String(r.id), r]));

    // Row inclusion stays exactly what it was before Till Date existed: only groups
    // with at least one batch actually started IN the selected range. Till Date is
    // an extra column on those same rows, not a reason to widen the row set to
    // every SFG/Stroke combo ever made — that would drown the range the user asked
    // for in all-time noise.
    const result = groupList
      .filter((g) => g.batchNumbersInRange.size > 0)
      .map((g) => {
        const material = materialMap.get(g.materialId);
        const company = companyMap.get(g.companyId);
        return {
          company_id: g.companyId,
          company_code: company?.company_code ?? null,
          stroke_master_id: g.strokeMasterId,
          stroke_number: g.strokeMasterId ? strokeMap.get(g.strokeMasterId) ?? null : null,
          material_id: g.materialId,
          material_name: material?.material_name ?? null,
          document_name: material?.document_name || material?.material_name || null,
          material_category: material?.material_category ?? null,
          material_type: material?.material_type ?? null,
          batch_count: g.batchNumbersInRange.size,
          till_date_count: g.batchNumbersTillDate.size,
        };
      });
    result.sort((a, b) => {
      const companyCompare = String(a.company_code ?? "").localeCompare(String(b.company_code ?? ""));
      if (companyCompare !== 0) return companyCompare;
      const strokeCompare = String(a.stroke_number ?? "").localeCompare(String(b.stroke_number ?? ""), undefined, { numeric: true });
      if (strokeCompare !== 0) return strokeCompare;
      return String(a.material_name ?? "").localeCompare(String(b.material_name ?? ""));
    });

    return okResponse({ data: result }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_OIS_BATCH_COUNTS_FAILED";
    return oisErr(req, ctx, code, 500, "Batch Counts report failed");
  }
}
