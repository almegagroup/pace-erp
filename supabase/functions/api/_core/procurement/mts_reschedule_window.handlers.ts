/*
 * PO22 D9 — DB side of the reschedule feasibility window (pure rule: mts_reschedule_window.logic.ts).
 * Reads the company's two windows (settings), and per piece the CSN (ETD, vendor, type) and the PO (import type, vendor).
 */
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { poNumberOfReference } from "./mts_item_plan.logic.ts";
import { type RescheduleRoute, type RescheduleWindows, resolveRescheduleWindows } from "./mts_reschedule_window.logic.ts";

type JsonRecord = Record<string, unknown>;
const text = (value: unknown): string => (value === null || value === undefined ? "" : String(value).trim());

export type ReschedulePieceFacts = {
  route: RescheduleRoute | null;
  etd: string | null;
  vendor_id: string | null;
};

export type RescheduleContext = {
  windows: RescheduleWindows;
  /** Facts of one inbound piece (CSN id and/or the PO number inside its reference). */
  factsOf: (piece: { csn_id?: string; reference: string }) => ReschedulePieceFacts;
};

/** Import = the PO carries an import trade type (DIRECT_IMPORT, HIGH_SEA_SALE …); a domestic PO has none. */
export function routeOfPo(importTradeType: unknown, csnType: unknown): RescheduleRoute | null {
  if (text(importTradeType)) return "IMPORT";
  const type = text(csnType).toUpperCase();
  if (type === "IMPORT") return "IMPORT";
  return type ? "DOMESTIC" : null;
}

export async function loadRescheduleContext(companyId: string, pieces: ReadonlyArray<{ csn_id?: string; reference: string }>): Promise<RescheduleContext> {
  const csnIds = [...new Set(pieces.map((piece) => piece.csn_id).filter((id): id is string => Boolean(id)))];
  const poNumbers = [...new Set(pieces.map((piece) => poNumberOfReference(piece.reference)).filter((n): n is string => Boolean(n)))];
  const [windowRes, csnRows, poRows] = await Promise.all([
    serviceRoleClient.schema("erp_planning").from("company_reschedule_window").select("import_min_days, domestic_min_days").eq("company_id", companyId).maybeSingle(),
    csnIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(csnIds, (chunk) => serviceRoleClient.schema("erp_procurement")
      .from("consignment_note").select("id, csn_type, etd, vendor_id").in("id", chunk)),
    poNumbers.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(poNumbers, (chunk) => serviceRoleClient.schema("erp_procurement")
      .from("purchase_order").select("po_number, import_trade_type, vendor_id").eq("company_id", companyId).in("po_number", chunk)),
  ]);
  // A missing table row / a read error must never block planning: the code defaults apply.
  const saved = windowRes.error ? null : (windowRes.data as JsonRecord | null);
  const windows = resolveRescheduleWindows(saved ? { import_min_days: Number(saved.import_min_days), domestic_min_days: Number(saved.domestic_min_days) } : null);
  const csnById = new Map(csnRows.map((row) => [text(row.id), row]));
  const poByNumber = new Map(poRows.map((row) => [text(row.po_number), row]));
  return {
    windows,
    factsOf: (piece) => {
      const csn = piece.csn_id ? csnById.get(piece.csn_id) : undefined;
      const poNumber = poNumberOfReference(piece.reference);
      const po = poNumber ? poByNumber.get(poNumber) : undefined;
      const etd = csn ? text(csn.etd).slice(0, 10) : "";
      return {
        route: routeOfPo(po?.import_trade_type, csn?.csn_type),
        etd: etd || null,
        vendor_id: text(csn?.vendor_id) || text(po?.vendor_id) || null,
      };
    },
  };
}
