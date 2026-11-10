/*
 * File-ID: IN15-BE
 * File-Path: supabase/functions/api/_core/production/mts_hold_trail.handlers.ts
 * Domain: PRODUCTION
 * Purpose: IN15 "MTS FG Hold & Block Trail" -- every MTS FG quantity put into Quality Inspection / Blocked
 *          (at MTS Verify) and what happened to it after (IN13 status changes), plus a SKU-level "held now" summary.
 *          Read-only. Spec: docs/superpowers/specs/2026-11-10-mts-hold-block-trail-design.md
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import { assertProdReadRole, toTrimmedString, toUpperTrimmedString } from "./production.shared.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
import {
  oisErr,
  parseIsoDate,
  parseMultiValueParams,
  resolveAllowedCompanyIds,
  scopeCompanyIds,
} from "./order_information_system.handlers.ts";
import {
  buildTrailEvents,
  computeHeldSummary,
  filterEventsByStatus,
  type HoldRow,
  type SscRow,
} from "./mts_hold_trail.logic.ts";

type JsonRecord = Record<string, unknown>;

const MAX_DATE_RANGE_DAYS = 365;
const PAGE_SIZE = 1000;
const IST = "+05:30";
const VALID_STATUSES = new Set(["QUALITY_INSPECTION", "BLOCKED"]);

function addOneDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

// Every read below throws on failure: a failed read must surface as an error, never as an empty / "nothing was held" report.
async function readAllPages<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error("MTS_HOLD_TRAIL_READ_FAILED");
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export async function getMtsHoldTrailHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const requestedCompanyIds = parseMultiValueParams(url, "company_ids", "company_id");
    const materialIdFilter = parseMultiValueParams(url, "material_ids", "material_id");
    const statuses = parseMultiValueParams(url, "statuses", "status")
      .map((value) => value.toUpperCase())
      .filter((value) => VALID_STATUSES.has(value));
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));

    if (!dateFrom || !dateTo) return oisErr(req, ctx, "MTS_HOLD_TRAIL_DATE_RANGE_REQUIRED", 400, "Event date range is required.");
    const from = parseIsoDate(dateFrom);
    const to = parseIsoDate(dateTo);
    if (!from || !to || to.getTime() < from.getTime()) {
      return oisErr(req, ctx, "MTS_HOLD_TRAIL_DATE_RANGE_INVALID", 400, "date_from/date_to are invalid.");
    }
    if (Math.floor((to.getTime() - from.getTime()) / 86400000) > MAX_DATE_RANGE_DAYS) {
      return oisErr(req, ctx, "MTS_HOLD_TRAIL_DATE_RANGE_TOO_WIDE", 400, "Date range cannot exceed 365 days.");
    }

    const allowedCompanyIds = await resolveAllowedCompanyIds(ctx);
    const companyIds = scopeCompanyIds(allowedCompanyIds, requestedCompanyIds);
    // A company the caller does not have means nothing -- never "all companies".
    if (companyIds !== null && companyIds.length === 0) {
      return okResponse({ items: [], summary: [], total: 0 }, ctx.request_id, req);
    }
    const rangeStart = `${dateFrom}T00:00:00${IST}`;
    const rangeEndExclusive = `${addOneDay(dateTo)}T00:00:00${IST}`;
    const inRange = (iso: string) => {
      const at = Date.parse(iso);
      return at >= Date.parse(rangeStart) && at < Date.parse(rangeEndExclusive);
    };

    // 1. Hold rows written by MTS Verify (only holds exist here -- Unrestricted-at-Verify is never in this table).
    const rawHolds = await readAllPages<JsonRecord>((rangeFrom, rangeTo) => serviceRoleClient
      .schema("erp_production").from("mts_verify_hold_allocation")
      .select("id, process_order_id, packing_order_id, batch_number, batch_number_from, batch_number_to, sku_material_id, target_stock_type, declared_pack_qty, held_pack_qty, qty_kg, reason, created_by, created_at")
      .gte("created_at", rangeStart).lt("created_at", rangeEndExclusive)
      .order("created_at", { ascending: false }).order("id", { ascending: true })
      .range(rangeFrom, rangeTo));

    // 2. IN13 / Verify stock-status postings that touch QI or Blocked. All time: the "held now" summary is a balance.
    const sscQuery = (rangeFrom: number, rangeTo: number) => {
      let query = serviceRoleClient.schema("erp_inventory").from("stock_status_change_posting")
        .select("id, document_number, company_id, material_id, storage_location_id, batch_number, packing_po_number, from_stock_type, to_stock_type, quantity, uom_code, reason, status, requires_approval, reversal_of_posting_id, created_by, created_at, approved_by, approved_at")
        .or("from_stock_type.in.(QUALITY_INSPECTION,BLOCKED),to_stock_type.in.(QUALITY_INSPECTION,BLOCKED)")
        .order("created_at", { ascending: false }).order("id", { ascending: true });
      if (companyIds !== null) query = query.in("company_id", companyIds);
      return query.range(rangeFrom, rangeTo);
    };
    const rawSsc = await readAllPages<JsonRecord>((rangeFrom, rangeTo) => sscQuery(rangeFrom, rangeTo));

    // 3. Parent documents + materials, all id-lists chunked (§8E).
    const processOrderIds = [...new Set(rawHolds.map((row) => toTrimmedString(row.process_order_id)).filter(Boolean))];
    const packingOrderIds = [...new Set(rawHolds.map((row) => toTrimmedString(row.packing_order_id)).filter(Boolean))];
    const [processOrders, packingOrders] = await Promise.all([
      fetchInChunks<JsonRecord>(processOrderIds, (idChunk) => serviceRoleClient.schema("erp_production").from("process_order")
        .select("id, company_id, po_number, status").in("id", idChunk)),
      fetchInChunks<JsonRecord>(packingOrderIds, (idChunk) => serviceRoleClient.schema("erp_production").from("packing_order")
        .select("id, po_number").in("id", idChunk)),
    ]).catch(() => { throw new Error("MTS_HOLD_TRAIL_READ_FAILED"); });
    const processOrderById = new Map(processOrders.map((row) => [toTrimmedString(row.id), row]));
    const packingOrderById = new Map(packingOrders.map((row) => [toTrimmedString(row.id), row]));

    const materialIds = [...new Set([
      ...rawHolds.map((row) => toTrimmedString(row.sku_material_id)),
      ...rawSsc.map((row) => toTrimmedString(row.material_id)),
    ].filter(Boolean))];
    const materials = await fetchInChunks<JsonRecord>(materialIds, (idChunk) => serviceRoleClient.schema("erp_master").from("material_master")
      .select("id, material_name, document_name, external_code, material_type").in("id", idChunk))
      .catch(() => { throw new Error("MTS_HOLD_TRAIL_READ_FAILED"); });
    const materialById = new Map(materials.map((row) => [toTrimmedString(row.id), row]));
    const materialFilter = new Set(materialIdFilter);
    const keepMaterial = (materialId: string) => materialFilter.size === 0 || materialFilter.has(materialId);

    // 4. Shape the rows for the pure logic. Holds: caller's companies only (company comes from the Process PO).
    const holdRows: HoldRow[] = [];
    for (const row of rawHolds) {
      const processOrder = processOrderById.get(toTrimmedString(row.process_order_id));
      const companyId = toTrimmedString(processOrder?.company_id);
      if (!processOrder || !companyId) continue;
      if (companyIds !== null && !companyIds.includes(companyId)) continue;
      if (!keepMaterial(toTrimmedString(row.sku_material_id))) continue;
      holdRows.push({
        id: toTrimmedString(row.id),
        company_id: companyId,
        process_order_id: toTrimmedString(row.process_order_id),
        process_order_number: toTrimmedString(processOrder.po_number) || null,
        process_order_status: toTrimmedString(processOrder.status) || null,
        packing_order_number: toTrimmedString(packingOrderById.get(toTrimmedString(row.packing_order_id))?.po_number) || null,
        material_id: toTrimmedString(row.sku_material_id),
        batch_number: toTrimmedString(row.batch_number),
        batch_number_from: toTrimmedString(row.batch_number_from),
        batch_number_to: toTrimmedString(row.batch_number_to),
        target_stock_type: toTrimmedString(row.target_stock_type),
        declared_pack_qty: Number(row.declared_pack_qty ?? 0),
        held_pack_qty: Number(row.held_pack_qty ?? 0),
        qty_kg: Number(row.qty_kg ?? 0),
        reason: toTrimmedString(row.reason) || null,
        created_by: toTrimmedString(row.created_by) || null,
        created_at: toTrimmedString(row.created_at),
      });
    }

    // Aggregate MTS SKU stock only: FG with no Packing PO (a Packing-PO-specific FG row belongs to the ordinary FG flow).
    const sscRows: SscRow[] = [];
    for (const row of rawSsc) {
      const materialId = toTrimmedString(row.material_id);
      const material = materialById.get(materialId);
      if (!material || toUpperTrimmedString(material.material_type) !== "FG") continue;
      if (toTrimmedString(row.packing_po_number)) continue;
      if (!keepMaterial(materialId)) continue;
      sscRows.push({
        id: toTrimmedString(row.id),
        document_number: toTrimmedString(row.document_number),
        company_id: toTrimmedString(row.company_id),
        material_id: materialId,
        storage_location_id: toTrimmedString(row.storage_location_id) || null,
        batch_number: toTrimmedString(row.batch_number) || null,
        packing_po_number: null,
        from_stock_type: toTrimmedString(row.from_stock_type),
        to_stock_type: toTrimmedString(row.to_stock_type),
        quantity: Number(row.quantity ?? 0),
        uom_code: toTrimmedString(row.uom_code) || null,
        reason: toTrimmedString(row.reason) || null,
        status: toTrimmedString(row.status),
        requires_approval: row.requires_approval === true,
        reversal_of_posting_id: toTrimmedString(row.reversal_of_posting_id) || null,
        created_by: toTrimmedString(row.created_by) || null,
        created_at: toTrimmedString(row.created_at),
        approved_by: toTrimmedString(row.approved_by) || null,
        approved_at: toTrimmedString(row.approved_at) || null,
      });
    }

    const events = filterEventsByStatus(buildTrailEvents(holdRows, sscRows.filter((row) => inRange(row.created_at))), statuses);
    const summaryRows = computeHeldSummary(sscRows);

    // 5. Names (§8A): users, companies, SKU labels.
    const userIds = [...new Set(events.flatMap((event) => [event.by_user_id, event.approved_by_user_id]).filter(Boolean) as string[])];
    const companyIdsInResult = [...new Set([...events.map((event) => event.company_id), ...summaryRows.map((row) => row.company_id)].filter(Boolean))];
    const [userNames, companies] = await Promise.all([
      resolveUserDisplayNames(userIds),
      fetchInChunks<JsonRecord>(companyIdsInResult, (idChunk) => serviceRoleClient.schema("erp_master").from("companies")
        .select("id, company_code").in("id", idChunk)),
    ]).catch(() => { throw new Error("MTS_HOLD_TRAIL_READ_FAILED"); });
    const companyCodeById = new Map(companies.map((row) => [toTrimmedString(row.id), toTrimmedString(row.company_code)]));
    const skuLabel = (materialId: string) => {
      const material = materialById.get(materialId);
      return [material?.material_name, material?.document_name, material?.external_code].map(toTrimmedString).filter(Boolean).join(" — ") || "—";
    };
    const userLabel = (authUserId: string | null) => {
      if (!authUserId) return "—";
      const label = userNames.get(authUserId);
      return label && label !== authUserId ? label : "—";
    };

    const items = events.map((event) => ({
      key: event.key,
      event_type: event.event_type,
      event_at: event.event_at,
      company_code: companyCodeById.get(event.company_id) || "—",
      sku: skuLabel(event.material_id),
      process_order_number: event.process_order_number,
      packing_order_number: event.packing_order_number,
      batch_number: event.batch_number,
      from_stock_type: event.from_stock_type,
      to_stock_type: event.to_stock_type,
      bags: event.bags,
      qty_kg: event.qty_kg,
      by: userLabel(event.by_user_id),
      approved_by: userLabel(event.approved_by_user_id),
      reason: event.reason_display,
      document_number: event.document_number,
      state: event.state,
    }));
    const summary = summaryRows.map((row) => ({
      company_code: companyCodeById.get(row.company_id) || "—",
      sku: skuLabel(row.material_id),
      qi_kg: row.qi_kg,
      blocked_kg: row.blocked_kg,
      last_event_at: row.last_event_at,
    })).filter((row) => Math.abs(row.qi_kg) > 1e-9 || Math.abs(row.blocked_kg) > 1e-9);

    return okResponse({ items, summary, total: items.length }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTS_HOLD_TRAIL_FAILED";
    console.error("[mts_hold_trail] failed:", code);
    return oisErr(req, ctx, code, 500, "Unable to load the MTS hold & block trail.");
  }
}
