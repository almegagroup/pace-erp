/*
 * File-Path: supabase/functions/api/_core/procurement/bulk_post_checks.ts
 * Domain: PROCUREMENT / Sales
 * Purpose: SO02 Bulk Posting "suspicious data" checks. Every Bulk-DO-Upload
 *          DO's details come from the user's own sheet, and Tally carries no
 *          DO/FO reference to reconcile against, so a sheet mistake cannot be
 *          proven wrong from outside. These checks look for internal
 *          inconsistencies -- the same Tally invoice / LR / IBN used twice,
 *          dates that contradict each other, invoice-series date order --
 *          across the queue AND every other
 *          non-cancelled DO / invoice of the company. A flag is a prompt to
 *          look, never a block: posting stays the user's decision.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";

type JsonRecord = Record<string, unknown>;
const text = (value: unknown) => String(value ?? "").trim();
const norm = (value: unknown) => text(value).replace(/\s+/g, " ").toUpperCase();

export type BulkPostCheck = { code: string; message: string };

type QueueDo = {
  id: string;
  dc_number: string;
  dc_date: string;
  fo_numbers: Set<string>;
  tally_invoice_number: string;
  tally_invoice_date: string;
  inbound_number: string;
  lr_number: string;
  lr_date: string;
  transporter_key: string;
  transporter_label: string;
  vehicle_number: string;
  dispatch_date: string;
};

function addCheck(map: Map<string, BulkPostCheck[]>, dcId: string, code: string, message: string) {
  const list = map.get(dcId) ?? [];
  if (!list.some((entry) => entry.code === code && entry.message === message)) list.push({ code, message });
  map.set(dcId, list);
}

function splitInvoiceNumber(value: string): { prefix: string; serial: number } | null {
  const match = norm(value).match(/^(.*?)(\d+)$/);
  return match ? { prefix: match[1], serial: Number(match[2]) } : null;
}

/**
 * `docs` are the queue's delivery_challan rows; `lines` are the queue's
 * per-line items (already carrying fo_number, sku_code, pack_qty).
 */
export async function computeBulkPostChecks(companyId: string, docs: JsonRecord[], lines: JsonRecord[]): Promise<Map<string, BulkPostCheck[]>> {
  const checks = new Map<string, BulkPostCheck[]>();
  const queue = new Map<string, QueueDo>();
  for (const doc of docs) {
    queue.set(text(doc.id), {
      id: text(doc.id),
      dc_number: text(doc.dc_number),
      dc_date: text(doc.dc_date),
      fo_numbers: new Set(),
      tally_invoice_number: norm(doc.pre_invoice_tally_invoice_number),
      tally_invoice_date: text(doc.pre_invoice_tally_invoice_date),
      inbound_number: norm(doc.pre_invoice_inbound_number),
      lr_number: norm(doc.lr_number),
      lr_date: text(doc.lr_date),
      transporter_key: text(doc.transporter_id) || norm(doc.transporter_name_freetext),
      transporter_label: text(doc.transporter_label) || text(doc.transporter_name_freetext),
      vehicle_number: norm(doc.vehicle_number).replace(/\s+/g, ""),
      dispatch_date: text(doc.dispatch_date),
    });
  }
  for (const line of lines) {
    const fo = text(line.fo_number) || text(line.so_number);
    if (fo) queue.get(text(line.id))?.fo_numbers.add(fo);
  }
  const queueDos = [...queue.values()];
  const foText = (entry: QueueDo) => [...entry.fo_numbers].join(", ") || "—";

  // ---- Same Tally invoice / LR / IBN on another DO (queue or already
  // posted / manually created) --------------------------------------------
  const tallyNumbers = [...new Set(queueDos.map((entry) => entry.tally_invoice_number).filter(Boolean))];
  const lrNumbers = [...new Set(queueDos.map((entry) => entry.lr_number).filter(Boolean))];
  const inboundNumbers = [...new Set(queueDos.map((entry) => entry.inbound_number).filter(Boolean))];
  const otherDoSelect = "id, dc_number, status, transporter_id, transporter_name_freetext, lr_number, pre_invoice_tally_invoice_number, pre_invoice_inbound_number";
  const [byTally, byLr, byInbound, invoicesByTally, invoicesByInbound] = await Promise.all([
    fetchInChunks<JsonRecord>(tallyNumbers, (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan")
      .select(otherDoSelect).eq("selling_company_id", companyId).neq("status", "CANCELLED").in("pre_invoice_tally_invoice_number", chunk)),
    fetchInChunks<JsonRecord>(lrNumbers, (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan")
      .select(otherDoSelect).eq("selling_company_id", companyId).neq("status", "CANCELLED").in("lr_number", chunk)),
    fetchInChunks<JsonRecord>(inboundNumbers, (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan")
      .select(otherDoSelect).eq("selling_company_id", companyId).neq("status", "CANCELLED").in("pre_invoice_inbound_number", chunk)),
    fetchInChunks<JsonRecord>(tallyNumbers, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_invoice")
      .select("id, dc_id, invoice_number, tally_invoice_number").neq("status", "CANCELLED").in("tally_invoice_number", chunk)),
    fetchInChunks<JsonRecord>(inboundNumbers, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_invoice")
      .select("id, dc_id, invoice_number, inbound_number").neq("status", "CANCELLED").in("inbound_number", chunk)),
  ]);
  // Invoices can belong to another company; keep only this company's DOs.
  const invoiceDcIds = [...new Set([...invoicesByTally, ...invoicesByInbound].map((row) => text(row.dc_id)).filter(Boolean))];
  const invoiceDcRows = await fetchInChunks<JsonRecord>(invoiceDcIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan")
    .select("id, dc_number, selling_company_id").in("id", chunk));
  const invoiceDcById = new Map(invoiceDcRows.filter((row) => text(row.selling_company_id) === companyId).map((row) => [text(row.id), row]));

  const doLabel = (row: JsonRecord) => `DO ${text(row.dc_number)}${queue.has(text(row.id)) ? "" : ` (${text(row.status) || "already posted"})`}`;

  for (const entry of queueDos) {
    if (entry.tally_invoice_number) {
      const others = byTally.filter((row) => norm(row.pre_invoice_tally_invoice_number) === entry.tally_invoice_number && text(row.id) !== entry.id);
      const invoiceOthers = invoicesByTally.filter((row) => norm(row.tally_invoice_number) === entry.tally_invoice_number && text(row.dc_id) !== entry.id && invoiceDcById.has(text(row.dc_id)));
      const labels = [...others.map(doLabel), ...invoiceOthers.map((row) => `Invoice ${text(row.invoice_number)} (DO ${text(invoiceDcById.get(text(row.dc_id))?.dc_number)})`)];
      if (labels.length) addCheck(checks, entry.id, "TALLY_INVOICE_REUSED", `Tally Invoice ${entry.tally_invoice_number} is also on ${[...new Set(labels)].join(", ")}`);
    }
    if (entry.lr_number) {
      const others = byLr.filter((row) => norm(row.lr_number) === entry.lr_number && text(row.id) !== entry.id
        && (text(row.transporter_id) || norm(row.transporter_name_freetext)) === entry.transporter_key);
      if (others.length) addCheck(checks, entry.id, "LR_REUSED", `LR ${entry.lr_number} of the same transporter is also on ${others.map(doLabel).join(", ")}`);
    }
    if (entry.inbound_number) {
      const others = byInbound.filter((row) => norm(row.pre_invoice_inbound_number) === entry.inbound_number && text(row.id) !== entry.id);
      const invoiceOthers = invoicesByInbound.filter((row) => norm(row.inbound_number) === entry.inbound_number && text(row.dc_id) !== entry.id && invoiceDcById.has(text(row.dc_id)));
      const labels = [...others.map(doLabel), ...invoiceOthers.map((row) => `Invoice ${text(row.invoice_number)}`)];
      if (labels.length) addCheck(checks, entry.id, "IBN_REUSED", `Inbound Number ${entry.inbound_number} is also on ${[...new Set(labels)].join(", ")}`);
    }
  }

  // ---- Dates that contradict each other ----------------------------------
  for (const entry of queueDos) {
    if (!entry.tally_invoice_number) addCheck(checks, entry.id, "TALLY_INVOICE_MISSING", "Tally Invoice Number is blank");
    if (entry.tally_invoice_date && entry.dc_date && entry.tally_invoice_date !== entry.dc_date) {
      addCheck(checks, entry.id, "INVOICE_DATE_NOT_DO_DATE", `Tally Invoice Date ${entry.tally_invoice_date} differs from DO Date ${entry.dc_date}`);
    }
    if (entry.lr_date && entry.dc_date && entry.lr_date < entry.dc_date) {
      addCheck(checks, entry.id, "LR_BEFORE_DO", `LR Date ${entry.lr_date} is before DO Date ${entry.dc_date}`);
    }
    if (entry.dispatch_date && entry.lr_date && entry.dispatch_date < entry.lr_date) {
      addCheck(checks, entry.id, "DISPATCH_BEFORE_LR", `Dispatch Date ${entry.dispatch_date} is before LR Date ${entry.lr_date}`);
    }
  }

  // ---- One truck, one day, two transporters ------------------------------
  const truckDay = new Map<string, QueueDo[]>();
  for (const entry of queueDos) {
    if (!entry.vehicle_number || !entry.dispatch_date) continue;
    const key = `${entry.vehicle_number}::${entry.dispatch_date}`;
    truckDay.set(key, [...(truckDay.get(key) ?? []), entry]);
  }
  for (const group of truckDay.values()) {
    const transporters = new Set(group.map((entry) => entry.transporter_key));
    if (transporters.size < 2) continue;
    for (const entry of group) {
      const others = group.filter((other) => other.transporter_key !== entry.transporter_key);
      addCheck(checks, entry.id, "TRUCK_TWO_TRANSPORTERS", `Truck ${entry.vehicle_number} on ${entry.dispatch_date} is under ${entry.transporter_label || "this transporter"} here but under another transporter on ${others.map((other) => `DO ${other.dc_number}`).join(", ")}`);
    }
  }

  // ---- Invoice series: odd prefix, number out of date order ----------------
  const parsed = queueDos.map((entry) => ({ entry, split: splitInvoiceNumber(entry.tally_invoice_number) }))
    .filter((row): row is { entry: QueueDo; split: { prefix: string; serial: number } } => row.split !== null);
  const prefixCounts = new Map<string, number>();
  for (const { split } of parsed) prefixCounts.set(split.prefix, (prefixCounts.get(split.prefix) ?? 0) + 1);
  const commonPrefix = [...prefixCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (commonPrefix !== undefined && parsed.length >= 5) {
    for (const { entry, split } of parsed) {
      if (split.prefix !== commonPrefix && (prefixCounts.get(split.prefix) ?? 0) <= Math.max(1, parsed.length * 0.05)) {
        addCheck(checks, entry.id, "INVOICE_PREFIX_UNUSUAL", `Tally Invoice ${entry.tally_invoice_number} does not follow the usual "${commonPrefix}…" series`);
      }
    }
  }
  const bySeries = new Map<string, Array<{ entry: QueueDo; serial: number }>>();
  for (const { entry, split } of parsed) {
    if (!entry.tally_invoice_date) continue;
    bySeries.set(split.prefix, [...(bySeries.get(split.prefix) ?? []), { entry, serial: split.serial }]);
  }
  for (const series of bySeries.values()) {
    series.sort((a, b) => a.serial - b.serial);
    // This is an advisory date-order comparison only. Tally can legitimately
    // contain back-dated entries, so it must never imply that the invoice is
    // invalid or stop posting.
    let latest = series[0];
    for (const current of series.slice(1)) {
      if (current.entry.tally_invoice_date < latest.entry.tally_invoice_date) {
        addCheck(checks, current.entry.id, "INVOICE_OUT_OF_ORDER", `Invoice date of lower series ${latest.entry.tally_invoice_number} (${latest.entry.tally_invoice_date}) is higher than this invoice ${current.entry.tally_invoice_number} (${current.entry.tally_invoice_date}).`);
      }
      if (current.entry.tally_invoice_date >= latest.entry.tally_invoice_date) latest = current;
    }
  }

  return checks;
}
