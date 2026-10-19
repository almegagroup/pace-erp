/* PO22 Phase 3B — verified, read-only lifecycle identity extractor.
 *
 * This is an INTERNAL building block, not an exposed API endpoint.
 * The calling handler MUST authorize requestedCompanyId using the existing ACL
 * and company scope before invoking this service-role reader.
 * It intentionally does not calculate available balance or change PO22.
 */
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import {
  indexAuthoritativeLotIds,
  reconcileCsnReceiving,
  reconcileGateReceiving,
  verifyGrnReceivingCompany,
  verifyReservationIdentity,
  verifyStockLedgerIdentity,
  verifyStoCsnReceiving,
  type ReconciledGateEvidence,
  type VerifiedLotIdentity,
  type VerifiedReservationIdentity,
  type VerifiedLedgerIdentity,
} from "./mts_optimizer_phase3b_receiving.logic.ts";

type DbRow = Record<string, unknown>;
const value = (v: unknown) => String(v ?? "").trim();
async function byIds(
  table: "purchase_order_line" | "purchase_order" | "gate_entry_line" | "gate_entry" | "purchase_order_lot" | "consignment_note" | "stock_ledger",
  schema: "erp_procurement" | "erp_inventory",
  columns: string,
  filterField: string,
  ids: readonly string[],
): Promise<DbRow[]> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  return uniqueIds.length === 0 ? [] : await fetchInChunks<DbRow>(uniqueIds, (part) => serviceRoleClient.schema(schema).from(table)
    .select(columns).in(filterField, part), 100);
}
export type VerifiedLifecycleIdentityRead = Readonly<{
  gate_lines: readonly ReconciledGateEvidence[];
  /** CSN/sub-CSN documents remain lifecycle evidence; no quantity is credited here. */
  csn_documents: readonly Readonly<{
    id: string; po_line_id: string; mother_csn_id: string | null; material_id: string;
    owning_company_id: string; receiving_company_id: string; status: string;
    disposition: "RECEIVING_COMPANY" | "OTHER_COMPANY_RECEIPT"; has_children: boolean;
  }>[];
  /** STO CSNs have no PO line by design and are therefore a separate source family. */
  sto_csn_documents: readonly Readonly<{
    id: string; source_company_id: string; receiving_company_id: string;
    sto_line_id: string; material_id: string; status: string;
  }>[];
  /** A GRN proves receipt only for its own verified GE line; it is never new inbound. */
  grn_documents: readonly Readonly<{
    id: string; gate_entry_line_id: string; company_id: string; status: string;
  }>[];
  po_lot_identities: readonly VerifiedLotIdentity[];
  po_lot_balance_identities: readonly Readonly<{ lot_id: string; po_line_id: string; lot_number: string; balance_qty: number }>[];
  reservations: readonly (VerifiedReservationIdentity & { source_key: string })[];
  stock_ledger_source_keys: readonly string[];
  /** An event ID is provenance only. Stock availability comes from verified balances. */
  stock_ledger_events_are_not_balances: true;
}>;

/**
 * A ledger-backed as-of balance is authoritative for quantity, but does not
 * identify one physical event.  Keep that distinction explicit: callers may
 * use these balances for a Phase 3B snapshot, never a selected ledger event.
 */
export type OptimizerAsOfStockBalanceEvidence = Readonly<{
  source_key: string;
  company_id: string;
  material_id: string;
  storage_location_id: string;
  stock_type_code: string;
  qty: number;
  uom_code: string;
  as_of_date: string;
  source: "erp_inventory.get_stock_history";
}>;

/** Direct, active master conversions only; no density or multi-hop factor is invented. */
export type OptimizerMaterialUomEvidence = Readonly<{
  material_id: string;
  base_uom_code: string;
  to_base_factors: Readonly<Record<string, number>>;
}>;

export async function readOptimizerMaterialUoms(materialIds: readonly string[]): Promise<readonly OptimizerMaterialUomEvidence[]> {
  const ids = [...new Set(materialIds.filter(Boolean))];
  if (ids.length === 0) return Object.freeze([]);
  const [materials, conversions] = await Promise.all([
    fetchInChunks<DbRow>(ids, (part) => serviceRoleClient.schema("erp_master").from("material_master")
      .select("id,base_uom_code").in("id", part), 100),
    fetchInChunks<DbRow>(ids, (part) => serviceRoleClient.schema("erp_master").from("material_uom_conversion")
      .select("material_id,from_uom_code,to_uom_code,conversion_factor,active,variable_conversion")
      .eq("active", true).eq("variable_conversion", false).in("material_id", part), 100),
  ]);
  const baseByMaterial = new Map(materials.map((row) => [value(row.id), value(row.base_uom_code).toUpperCase()]));
  if (baseByMaterial.size !== ids.length || [...baseByMaterial.values()].some((uom) => !uom)) throw new Error("PHASE3B_MATERIAL_UOM_IDENTITY_INCOMPLETE");
  const factors = new Map<string, Record<string, number>>();
  for (const [materialId, base] of baseByMaterial) factors.set(materialId, { [base]: 1 });
  for (const row of conversions) {
    const materialId = value(row.material_id);
    const base = baseByMaterial.get(materialId);
    const from = value(row.from_uom_code).toUpperCase();
    const to = value(row.to_uom_code).toUpperCase();
    const factor = Number(row.conversion_factor);
    if (!base || !from || to !== base || !Number.isFinite(factor) || factor <= 0) continue;
    const previous = factors.get(materialId)![from];
    if (previous !== undefined && previous !== factor) throw new Error(`PHASE3B_UOM_CONVERSION_CONFLICT:${materialId}:${from}`);
    factors.get(materialId)![from] = factor;
  }
  return Object.freeze([...baseByMaterial.entries()].map(([material_id, base_uom_code]) => Object.freeze({ material_id, base_uom_code, to_base_factors: Object.freeze({ ...factors.get(material_id)! }) }))
    .sort((a, b) => a.material_id.localeCompare(b.material_id)));
}
export async function readOptimizerAsOfStockBalances(
  requestedCompanyId: string,
  cmStart: string,
  asOf: string,
  materialIds: readonly string[],
): Promise<readonly OptimizerAsOfStockBalanceEvidence[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cmStart) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf) || cmStart > asOf) {
    throw new Error("PHASE3B_AS_OF_WINDOW_INVALID");
  }
  const materialList = [...new Set(materialIds.filter(Boolean))];
  if (materialList.length === 0) return Object.freeze([]);
  const dayBefore = new Date(Date.parse(`${asOf}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const [history, uoms] = await Promise.all([
    fetchInChunks<DbRow>(materialList, (part) => serviceRoleClient.schema("erp_inventory").rpc("get_stock_history", {
      p_company_id: requestedCompanyId,
      p_from_date: cmStart,
      p_to_date: dayBefore,
      p_material_type_codes: null,
      p_material_ids: part,
      p_storage_location_ids: null,
    }), 40),
    readOptimizerMaterialUoms(materialList),
  ]);
  const baseUom = new Map(uoms.map((row) => [row.material_id, row.base_uom_code]));
  if (baseUom.size !== materialList.length || [...baseUom.values()].some((uom) => !uom)) throw new Error("PHASE3B_MATERIAL_UOM_IDENTITY_INCOMPLETE");
  return Object.freeze(history.flatMap((row) => {
    const materialId = value(row.material_id);
    const locationId = value(row.storage_location_id);
    const stockType = value(row.stock_type_code);
    const qty = Number(row.closing ?? 0);
    if (!materialId || !locationId || !stockType || !Number.isFinite(qty)) throw new Error("PHASE3B_STOCK_BALANCE_EVIDENCE_INVALID");
    if (Math.abs(qty) < 0.0000001) return [];
    return [Object.freeze({
      source_key: `stock-history:${requestedCompanyId}:${asOf}:${materialId}:${locationId}:${stockType}`,
      company_id: requestedCompanyId,
      material_id: materialId,
      storage_location_id: locationId,
      stock_type_code: stockType,
      qty,
      uom_code: baseUom.get(materialId)!,
      as_of_date: asOf,
      source: "erp_inventory.get_stock_history" as const,
    })];
  }).sort((a, b) => a.source_key.localeCompare(b.source_key)));
}

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
  for (const line of lines) {
    const po = poById.get(value(line.po_id));
    const isPoOwner = value(po?.company_id) === requestedCompanyId;
    const isReceivingCompany = gateInput.some((gate) => gate.po_line_id === value(line.id) && gate.receiving_company_id === requestedCompanyId);
    if (!isPoOwner && !isReceivingCompany) throw new Error(`PHASE3B_PO_LINE_OUTSIDE_COMPANY:${value(line.id)}`);
  }

  const csnRows = await byIds("consignment_note", "erp_procurement", "id,po_line_id,mother_csn_id,material_id,company_id,consignee_company_id,status", "po_line_id", lineIds);
  const csnById = new Map(csnRows.map((row) => [value(row.id), row]));
  if (csnById.size !== csnRows.length) throw new Error("PHASE3B_CSN_DUPLICATE_IDENTITY");
  const csnIds = [...csnById.keys()];
  const childRows = csnIds.length === 0 ? [] : await fetchInChunks<DbRow>(csnIds, (part) => serviceRoleClient.schema("erp_procurement").from("consignment_note")
    .select("id,mother_csn_id").in("mother_csn_id", part), 100);
  const mothersWithChildren = new Set(childRows.map((row) => value(row.mother_csn_id)).filter(Boolean));
  const csnDocuments = csnRows.map((row) => {
    const id = value(row.id);
    const poLineId = value(row.po_line_id);
    const poLine = lineById.get(poLineId);
    const materialId = value(row.material_id);
    const owner = value(row.company_id);
    const consignee = value(row.consignee_company_id) || owner;
    const status = value(row.status).toUpperCase();
    if (!id || !poLine || !materialId || materialId !== value(poLine.material_id) || !owner || !consignee || !status) {
      throw new Error(`PHASE3B_CSN_LINEAGE_UNVERIFIED:${id || poLineId}`);
    }
    return reconcileCsnReceiving(requestedCompanyId, {
      id, po_line_id: poLineId, mother_csn_id: value(row.mother_csn_id) || null,
      material_id: materialId, owning_company_id: owner, receiving_company_id: consignee, status,
      has_children: mothersWithChildren.has(id),
    });
  }).sort((a, b) => a.id.localeCompare(b.id));

  const selectedMaterialSet = [...new Set(selectedMaterialIds.filter(Boolean))];
  const stoCsnRows = selectedMaterialSet.length === 0 ? [] : await fetchInChunks<DbRow>(selectedMaterialSet, (part) => serviceRoleClient.schema("erp_procurement").from("consignment_note")
    .select("id,company_id,consignee_company_id,sto_line_id,material_id,status")
    .eq("consignee_company_id", requestedCompanyId).not("sto_line_id", "is", null).in("material_id", part), 100);
  const stoCsnDocuments = stoCsnRows.map((row) => verifyStoCsnReceiving({
    id: value(row.id), source_company_id: value(row.company_id), receiving_company_id: value(row.consignee_company_id),
    sto_line_id: value(row.sto_line_id), material_id: value(row.material_id), status: value(row.status),
  }, requestedCompanyId)).sort((a, b) => a.id.localeCompare(b.id));

  const gateLineIds = gateInput.map((row) => row.gate_entry_line_id);
  const grnResults = await Promise.all([
    ...Array.from({ length: Math.ceil(gateLineIds.length / 100) }, (_, index) => serviceRoleClient.schema("erp_procurement").from("goods_receipt")
      .select("id,company_id,status,gate_entry_line_id,source_gate_entry_line_id")
      .in("gate_entry_line_id", gateLineIds.slice(index * 100, (index + 1) * 100))),
    ...Array.from({ length: Math.ceil(gateLineIds.length / 100) }, (_, index) => serviceRoleClient.schema("erp_procurement").from("goods_receipt")
      .select("id,company_id,status,gate_entry_line_id,source_gate_entry_line_id")
      .in("source_gate_entry_line_id", gateLineIds.slice(index * 100, (index + 1) * 100))),
  ]);
  const grnById = new Map<string, DbRow>();
  for (const result of grnResults) {
    if (result.error) throw new Error("PHASE3B_GRN_READ_FAILED");
    for (const row of (result.data ?? []) as DbRow[]) {
      const id = value(row.id);
      const existing = grnById.get(id);
      if (!id || (existing && JSON.stringify(existing) !== JSON.stringify(row))) throw new Error(`PHASE3B_GRN_DUPLICATE_IDENTITY:${id}`);
      grnById.set(id, row);
    }
  }
  const grnDocuments = [...grnById.values()].map((row) => {
    const id = value(row.id);
    const companyId = value(row.company_id);
    const status = value(row.status).toUpperCase();
    const gateLineId = value(row.gate_entry_line_id) || value(row.source_gate_entry_line_id);
    if (!id || !companyId || !status || !gateLineId || !gateLineIds.includes(gateLineId)) throw new Error(`PHASE3B_GRN_LINEAGE_UNVERIFIED:${id}`);
    const gate = gateInput.find((candidate) => candidate.gate_entry_line_id === gateLineId)!;
    return verifyGrnReceivingCompany({ id, gate_entry_line_id: gateLineId, company_id: companyId, status }, gate.receiving_company_id);
  }).sort((a, b) => a.id.localeCompare(b.id));
  for (const gate of gateInput.filter((row) => row.grn_posted)) {
    if (!grnDocuments.some((grn) => grn.gate_entry_line_id === gate.gate_entry_line_id && grn.status === "POSTED")) {
      throw new Error(`PHASE3B_GRN_POSTED_IDENTITY_MISSING:${gate.gate_entry_line_id}`);
    }
  }

  const lots = await byIds("purchase_order_lot", "erp_procurement", "id,po_line_id,lot_number", "po_line_id", lineIds);
  const lotRecords = lots.map((row) => ({
    id: value(row.id), po_line_id: value(row.po_line_id), lot_number: value(row.lot_number),
  }));
  const lotIndex = indexAuthoritativeLotIds(lotRecords);
  // The actual PROD RPC is STABLE and returns the authoritative lot_id,
  // not merely a lot number. Verify it against the immutable source row ID.
  const lotBalances: { lot_id: string; po_line_id: string; lot_number: string; balance_qty: number }[] = [];
  const lotBalanceChunks = await Promise.all(lineIds.length === 0 ? [] : Array.from({ length: Math.ceil(lineIds.length / 100) }, (_, index) =>
    serviceRoleClient.schema("erp_procurement")
      .rpc("po_lot_balances", { p_po_line_ids: lineIds.slice(index * 100, (index + 1) * 100), p_exclude_ge_line_id: null })
  ));
  for (const result of lotBalanceChunks) {
    if (result.error) throw new Error("PHASE3B_LOT_BALANCE_RPC_FAILED");
    for (const row of (result.data ?? []) as DbRow[]) {
      const poLine = value(row.po_line_id);
      const lotNumber = value(row.lot_number);
      const lotId = value(row.lot_id);
      const expected = lotIndex.get(JSON.stringify([poLine, lotNumber]));
      const balance = Number(row.balance_qty);
      if (!expected || expected !== lotId || !Number.isFinite(balance) || balance < 0) {
        throw new Error(`PHASE3B_LOT_BALANCE_LINEAGE_UNVERIFIED:${poLine}:${lotNumber}`);
      }
      lotBalances.push({ lot_id: lotId, po_line_id: poLine, lot_number: lotNumber, balance_qty: balance });
    }
  }

  const reservations: (VerifiedReservationIdentity & { source_key: string })[] = [];
  const materialChunks = Array.from({ length: Math.ceil([...new Set(selectedMaterialIds.filter(Boolean))].length / 100) }, (_, index) => [...new Set(selectedMaterialIds.filter(Boolean))].slice(index * 100, (index + 1) * 100));
  const reservationChunks = await Promise.all(materialChunks.map((part) => serviceRoleClient.schema("erp_production").from("reservation_document")
      .select("id,company_id,material_id,storage_location_id,uom_code,status,balance_qty")
      .eq("company_id", requestedCompanyId).in("status", ["OPEN", "PARTIAL"])
      .in("material_id", part)));
  for (const result of reservationChunks) {
    if (result.error) throw new Error("PHASE3B_RESERVATION_READ_FAILED");
    for (const row of (result.data ?? []) as DbRow[]) {
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
    csn_documents: Object.freeze(csnDocuments),
    sto_csn_documents: Object.freeze(stoCsnDocuments),
    grn_documents: Object.freeze(grnDocuments),
    po_lot_identities: Object.freeze(lotRecords.sort((a, b) => a.id.localeCompare(b.id)).map((row): VerifiedLotIdentity => Object.freeze(row))),
    po_lot_balance_identities: Object.freeze(lotBalances.sort((a, b) => a.lot_id.localeCompare(b.lot_id)).map((row): Readonly<{ lot_id: string; po_line_id: string; lot_number: string; balance_qty: number }> => Object.freeze(row))),
    reservations: Object.freeze(reservations.sort((a, b) => a.source_key.localeCompare(b.source_key)).map((row): VerifiedReservationIdentity & { source_key: string } => Object.freeze(row))),
    stock_ledger_source_keys: Object.freeze(ledgerSourceKeys),
    stock_ledger_events_are_not_balances: true as const,
  });
}
