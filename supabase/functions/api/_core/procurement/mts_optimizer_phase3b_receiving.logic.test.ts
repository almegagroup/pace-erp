import {
  reconcileGateReceiving,
  indexAuthoritativeLotIds,
  verifyReservationIdentity,
  verifyStockLedgerIdentity,
  type VerifiedGateLine,
} from "./mts_optimizer_phase3b_receiving.logic.ts";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function equal(a: unknown, b: unknown, message: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${message}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}
const gate = (overrides: Partial<VerifiedGateLine> = {}): VerifiedGateLine => ({
  gate_entry_line_id: "ge-line-1", gate_entry_id: "ge-1", po_line_id: "po-line-1",
  po_company_id: "CMP003", receiving_company_id: "CMP005", material_id: "MAT-1",
  grn_posted: false, gate_status: "OPEN", ...overrides,
});
Deno.test("cross-company unposted GE is projected only at the actual receiver", () => {
  equal(reconcileGateReceiving("CMP005", [gate()])[0].disposition, "AT_GATE_PROJECTED_ONLY", "receiver can see pending GE");
  equal(reconcileGateReceiving("CMP003", [gate()])[0].disposition, "OTHER_COMPANY_RECEIPT", "PO owner cannot claim foreign GE");
});
Deno.test("cross-company GRN-posted GE must come from receiving stock and never incoming", () => {
  const g = gate({ grn_posted: true, gate_status: "GRN_POSTED" });
  equal(reconcileGateReceiving("CMP005", [g])[0].disposition, "POSTED_STOCK_ONLY", "posted receipt not projected");
  equal(reconcileGateReceiving("CMP003", [g])[0].disposition, "OTHER_COMPANY_RECEIPT", "buyer cannot claim receipt");
});

Deno.test("duplicate join evidence is idempotent but conflicting GE identities fail closed", () => {
  equal(reconcileGateReceiving("CMP005", [gate(), gate()]).length, 1, "duplicated join row");
  let error: unknown;
  try { reconcileGateReceiving("CMP005", [gate(), gate({ receiving_company_id: "CMP011" })]); }
  catch (caught) { error = caught; }
  assert(error instanceof Error && error.message.includes("DUPLICATE_GE_CONFLICT"), "conflicting duplicate");
});

Deno.test("missing GE posted-state or source IDs fail closed", () => {
  for (const row of [gate({ grn_posted: null }), gate({ gate_entry_line_id: "" })]) {
    let failed = false;
    try { reconcileGateReceiving("CMP005", [row]); } catch { failed = true; }
    assert(failed, "unknown GE evidence must not be credited");
  }
});

Deno.test("PO lot identity is scoped to line and number, ambiguous IDs reject", () => {
  const ids = indexAuthoritativeLotIds([{ id: "lot-a", po_line_id: "line-a", lot_number: "1" }, { id: "lot-b", po_line_id: "line-b", lot_number: "1" }]);
  equal(ids.get(JSON.stringify(["line-b", "1"])), "lot-b", "different lines can reuse number");
  let failed = false;
  try { indexAuthoritativeLotIds([{ id: "lot-a", po_line_id: "line-a", lot_number: "1" }, { id: "lot-c", po_line_id: "line-a", lot_number: "1" }]); } catch { failed = true; }
  assert(failed, "same line+number with two IDs must block");
});

Deno.test("reservation identity is real document ID and company scoped", () => {
  const r = { id: "res-id", company_id: "CMP003", material_id: "mat", storage_location_id: "R003", uom_code: "KG", status: "OPEN", balance_qty: 4 };
  equal(verifyReservationIdentity("CMP003", r), "reservation-document:res-id", "document identity");
  let failed = false;
  try { verifyReservationIdentity("CMP005", r); } catch { failed = true; }
  assert(failed, "cross-company reservation");
});

Deno.test("stock ledger source identity is never fabricated from company+location", () => {
  const s = { id: "ledger-1", stock_document_id: "stockdoc-1", company_id: "CMP003", material_id: "mat", storage_location_id: "R003", stock_type_code: "UNRESTRICTED", base_uom_code: "KG" };
  equal(verifyStockLedgerIdentity("CMP003", s), "stock-ledger:ledger-1", "ledger identity");
  let failed = false;
  try { verifyStockLedgerIdentity("CMP011", s); } catch { failed = true; }
  assert(failed, "cross-company ledger");
});
