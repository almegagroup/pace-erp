/* PO22 Phase 3B — verified, read-only lifecycle identity extractor.
 *
 * This is an INTERNAL building block, not an exposed API endpoint.
 * The calling handler MUST authorize requestedCompanyId using the existing ACL
 * and company scope before invoking this service-role reader.
 * It intentionally does not calculate available balance or change PO22.
 */
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import {
  indexAuthoritativeLotIds,
  reconcileGateReceiving,
  verifyReservationIdentity,
  verifyStockLedgerIdentity,
  type ReconciledGateEvidence,
  type VerifiedLotIdentity,
  type VerifiedReservationIdentity,
  type VerifiedLedgerIdentity,
} from "./mts_optimizer_phase3b_receiving.logic.ts";

type DbRow = Record<string, unknown>;
const value = (v: unknown) => String(v ?? "").trim();
const chunked = <T>(rows: readonly T[], size = 100): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
};

async function byIds(
  table: "purchase_order_line" | "purchase_order" | "gate_entry_line" | "gate_entry" | "purchase_order_lot" | "stock_ledger",
  schema: "erp_procurement" | "erp_inventory",
  columns: string,
  filterField: string,
  ids: readonly string[],
): Promise<DbRow[]> {
  const found: DbRow[] = [];
  for (const part of chunked([...new Set(ids.filter(Boolean))])) {
    const { data, error } = await serviceRoleClient.schema(schema).from(table)
      .select(columns).in(filterField, part);
    if (error) throw new Error(`PHASE3B_SOURCE_READ_FAILED:${table}`);
    found.push(...(data ?? []) as DbRow[]);
  }
  return found;
}

export type VerifiedLifecycleIdentityRead = Readonly<{
  gate_lines: readonly ReconciledGateEvidence[];
  po_lot_identities: readonly VerifiedLotIdentity[];
  reservations: readonly (VerifiedReservationIdentity & { source_key: string })[];
  stock_ledger_source_keys: readonly string[];
  /** An event ID is provenance only. Stock availability comes from verified balances. */
  stock_ledger_events_are_not_balances: true;
}>;

/**
 * Read the exact source IDs needed by the Phase 3B adapter.
 * Never call this with arbitrary PO-line / stock-ledger IDs from client input.
 * Those IDs must first be selected by an authorized company-scoped read path.
 *
 * Foreign PO owners are permitted only as evidence of cross-company physical
 * receiving; no PO ownership is transferred and posted GE never becomes inbound.
 */
export async function readOptimizerLifecycleIdentities(
  requestedCompanyId: string,
  selectedPoLineIds: readonly string[],
  selectedMaterialIds: readonly string[],
  selectedStockLedgerIds: readonly string[],
): Promise<VerifiedLifecycleIdentityRead> {
  if (!requestedCompanyId) throw new Error("PHASE3B_COMPANY_REQUIRED");
  const lineIds = [...new Set(selectedPoLineIds.filter(Boolean))];
  const lines = await byIds("purchase_order_line", "erp_procurement", "id,po_id,material_id", "id", lineIds);
  const lineById = new Map(lines.map((row) => [value(row.id), row]));
  if (lineById.size !== lineIds.length) throw new Error("PHASE3B_PO_LINE_IDENTITY_INCOMPLETE");

  const poIds = [...new Set(lines.map((line) => value(line.po_id)))];
  const pos = await byIds("purchase_order", "erp_procurement", "id,company_id", "id", poIds);
  const poById = new Map(pos.map((row) => [value(row.id), row]));
  if (poById.size !== poIds.length) throw new Error("PHASE3B_PO_OWNER_IDENTITY_INCOMPLETE");

  const geLines = await byIds("gate_entry_line", "erp_procurement", "id,gate_entry_id,po_line_id,material_id,grn_posted", "po_line_id", lineIds);
  const gateIds = [...new Set(geLines.map((row) => value(row.gate_entry_id)))];
  const gates = await byIds("gate_entry", "erp_procurement", "id,company_id,status", "id", gateIds);
  const gatesById = new Map(gates.map((row) => [value(row.id), row]));

  const gateInput = geLines.map((row) => {
    const poLine = lineById.get(value(row.po_line_id));
    const po = poLine ? poById.get(value(poLine.po_id)) : null;
    const header = gatesById.get(value(row.gate_entry_id));
    if (!poLine || !po || !header || value(row.material_id) !== value(poLine.material_id)) {
      throw new Error(`PHASE3B_GE_LINEAGE_UNVERIFIED:${value(row.id)}`);
    }
    return {
      gate_entry_line_id: value(row.id),
      gate_entry_id: value(row.gate_entry_id),
      po_line_id: value(row.po_line_id),
      po_company_id: value(po.company_id),
      receiving_company_id: value(header.company_id),
      material_id: value(row.material_id),
      grn_posted: typeof row.grn_posted === "boolean" ? row.grn_posted : null,
      gate_status: value(header.status),
    };
  });
  const gateEvidence = reconcileGateReceiving(requestedCompanyId, gateInput);

  const lots = await byIds("purchase_order_lot", "erp_procurement", "id,po_line_id,lot_number", "po_line_id", lineIds);
  const lotRecords = lots.map((row) => ({
    id: value(row.id), po_line_id: value(row.po_line_id), lot_number: value(row.lot_number),
  }));
  indexAuthoritativeLotIds(lotRecords);

  const reservations: (VerifiedReservationIdentity & { source_key: string })[] = [];
  for (const part of chunked([...new Set(selectedMaterialIds.filter(Boolean))])) {
    const { data, error } = await serviceRoleClient.schema("erp_production").from("reservation_document")
      .select("id,company_id,material_id,storage_location_id,uom_code,status,balance_qty")
      .eq("company_id", requestedCompanyId).in("status", ["OPEN", "PARTIAL"])
      .in("material_id", part);
    if (error) throw new Error("PHASE3B_RESERVATION_READ_FAILED");
    for (const row of (data ?? []) as DbRow[]) {
      const identity = row as unknown as VerifiedReservationIdentity;
      reservations.push({ ...identity, source_key: verifyReservationIdentity(requestedCompanyId, identity) });
    }
  }

  const stockLedger = await byIds("stock_ledger", "erp_inventory",
    "id,stock_document_id,company_id,storage_location_id,material_id,stock_type_code,base_uom_code",
    "id", selectedStockLedgerIds);
  if (new Set(stockLedger.map((row) => value(row.id))).size !== new Set(selectedStockLedgerIds.filter(Boolean)).size) {
    throw new Error("PHASE3B_LEDGER_IDENTITY_INCOMPLETE");
  }
  const ledgerSourceKeys = stockLedger.map((row) =>
    verifyStockLedgerIdentity(requestedCompanyId, row as unknown as VerifiedLedgerIdentity)).sort();

  return Object.freeze({
    gate_lines: gateEvidence,
    po_lot_identities: Object.freeze(lotRecords.sort((a, b) => a.id.localeCompare(b.id)).map(Object.freeze)),
    reservations: Object.freeze(reservations.sort((a, b) => a.source_key.localeCompare(b.source_key)).map(Object.freeze)),
    stock_ledger_source_keys: Object.freeze(ledgerSourceKeys),
    stock_ledger_events_are_not_balances: true as const,
  });
}
