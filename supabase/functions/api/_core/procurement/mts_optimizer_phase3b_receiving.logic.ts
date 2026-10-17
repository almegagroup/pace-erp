/* PO22 Phase 3B — evidence-only receiving-company and source-ID reconciliation.
 * Pure, read-only. Never counts an already GRN-posted Gate Entry as inbound.
 * It does not mutate PO, GE, GRN, reservations or stock; it is NOT a solver.
 */
export type VerifiedGateLine = {
  gate_entry_line_id: string;
  gate_entry_id: string;
  po_line_id: string;
  po_company_id: string;
  receiving_company_id: string;
  material_id: string;
  grn_posted: boolean | null;
  gate_status: string;
};

export type GateEvidenceDisposition =
  | "AT_GATE_PROJECTED_ONLY"
  | "POSTED_STOCK_ONLY"
  | "OTHER_COMPANY_RECEIPT"
  | "BLOCKED_SOURCE";

export type ReconciledGateEvidence = Readonly<{
  source_key: string;
  po_line_id: string;
  po_company_id: string;
  receiving_company_id: string;
  material_id: string;
  disposition: GateEvidenceDisposition;
  reason: string;
}>;

const BLOCKED_GATE_STATUSES = new Set(["CANCELLED", "PRUNED"]);
const POSTED_GATE_STATUSES = new Set(["GRN_POSTED"]);

function requiredId(value: string, field: string): string {
  const id = String(value ?? "").trim();
  if (!id) throw new Error(`PHASE3B_SOURCE_ID_MISSING:${field}`);
  return id;
}

/** Keep real receiving-company ownership distinct from bill-to/PO ownership. */
export function reconcileGateReceiving(
  requestedCompanyId: string,
  rows: readonly VerifiedGateLine[],
): readonly ReconciledGateEvidence[] {
  const requested = requiredId(requestedCompanyId, "requested_company_id");
  const seen = new Map<string, string>();
  const output: ReconciledGateEvidence[] = [];
  for (const row of rows) {
    const id = requiredId(row.gate_entry_line_id, "gate_entry_line_id");
    requiredId(row.gate_entry_id, "gate_entry_id");
    const poLine = requiredId(row.po_line_id, "po_line_id");
    const poOwner = requiredId(row.po_company_id, "po_company_id");
    const receiver = requiredId(row.receiving_company_id, "receiving_company_id");
    const material = requiredId(row.material_id, "material_id");
    const status = String(row.gate_status ?? "").trim().toUpperCase();
    if (!status || typeof row.grn_posted !== "boolean") {
      throw new Error(`PHASE3B_GATE_STATE_UNVERIFIED:${id}`);
    }
    const signature = JSON.stringify([row.gate_entry_id, poLine, poOwner, receiver, material, row.grn_posted, status]);
    const prior = seen.get(id);
    if (prior && prior !== signature) throw new Error(`PHASE3B_DUPLICATE_GE_CONFLICT:${id}`);
    if (prior) continue;
    seen.set(id, signature);

    let disposition: GateEvidenceDisposition;
    let reason: string;
    if (receiver !== requested) {
      disposition = "OTHER_COMPANY_RECEIPT";
      reason = "Gate Entry belongs to another receiving company, regardless of PO owner";
    } else if (BLOCKED_GATE_STATUSES.has(status)) {
      disposition = "BLOCKED_SOURCE";
      reason = "Gate Entry cancelled/pruned";
    } else if (row.grn_posted || POSTED_GATE_STATUSES.has(status)) {
      disposition = "POSTED_STOCK_ONLY";
      reason = "Already GRN-posted: use receiving-company posted stock, never incoming again";
    } else {
      disposition = "AT_GATE_PROJECTED_ONLY";
      reason = "Unposted Gate Entry at requested company; projected evidence only, not executable stock";
    }
    output.push(Object.freeze({
      source_key: `gate-entry-line:${id}`,
      po_line_id: poLine,
      po_company_id: poOwner,
      receiving_company_id: receiver,
      material_id: material,
      disposition,
      reason,
    }));
  }
  return Object.freeze(output.sort((a, b) => a.source_key.localeCompare(b.source_key)));
}

export type VerifiedLotIdentity = Readonly<{
  id: string;
  po_line_id: string;
  lot_number: string;
}>;

/** PO-lot balance RPC must be joined back to the authoritative PO-lot row ID. */
export function indexAuthoritativeLotIds(rows: readonly VerifiedLotIdentity[]): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const row of rows) {
    const lotId = requiredId(row.id, "purchase_order_lot.id");
    const poLine = requiredId(row.po_line_id, "purchase_order_lot.po_line_id");
    const lotNumber = requiredId(row.lot_number, "purchase_order_lot.lot_number");
    const key = JSON.stringify([poLine, lotNumber]);
    const prior = result.get(key);
    if (prior && prior !== lotId) throw new Error(`PHASE3B_AMBIGUOUS_LOT_ID:${poLine}:${lotNumber}`);
    result.set(key, lotId);
  }
  return result;
}

export type VerifiedReservationIdentity = Readonly<{
  id: string;
  company_id: string;
  material_id: string;
  storage_location_id: string;
  uom_code: string;
  status: string;
  balance_qty: number;
}>;

/** Preserve document identity; never synthesize from material/location. */
export function verifyReservationIdentity(companyId: string, row: VerifiedReservationIdentity): string {
  const id = requiredId(row.id, "reservation_document.id");
  if (requiredId(row.company_id, "reservation_document.company_id") !== companyId) {
    throw new Error(`PHASE3B_RESERVATION_COMPANY_MISMATCH:${id}`);
  }
  requiredId(row.material_id, "reservation_document.material_id");
  requiredId(row.storage_location_id, "reservation_document.storage_location_id");
  requiredId(row.uom_code, "reservation_document.uom_code");
  const status = requiredId(row.status, "reservation_document.status").toUpperCase();
  if (!["OPEN", "PARTIAL"].includes(status) || !Number.isFinite(row.balance_qty) || row.balance_qty < 0) {
    throw new Error(`PHASE3B_RESERVATION_STATE_INVALID:${id}`);
  }
  return `reservation-document:${id}`;
}

export type VerifiedLedgerIdentity = Readonly<{
  id: string;
  stock_document_id: string;
  company_id: string;
  storage_location_id: string;
  material_id: string;
  stock_type_code: string;
  base_uom_code: string;
}>;

/** Ledger event identity is audit evidence, not an on-hand balance by itself. */
export function verifyStockLedgerIdentity(companyId: string, row: VerifiedLedgerIdentity): string {
  const id = requiredId(row.id, "stock_ledger.id");
  if (requiredId(row.company_id, "stock_ledger.company_id") !== companyId) {
    throw new Error(`PHASE3B_STOCK_COMPANY_MISMATCH:${id}`);
  }
  requiredId(row.stock_document_id, "stock_ledger.stock_document_id");
  requiredId(row.storage_location_id, "stock_ledger.storage_location_id");
  requiredId(row.material_id, "stock_ledger.material_id");
  requiredId(row.stock_type_code, "stock_ledger.stock_type_code");
  requiredId(row.base_uom_code, "stock_ledger.base_uom_code");
  return `stock-ledger:${id}`;
}
