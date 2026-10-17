import { adaptOptimizerPhase3BSources, createPersistentOptimizerInputSnapshot, resolveNewBuyEligibility, resolveSixMonthNewBuyEligibility } from "./mts_optimizer_phase3b.logic.ts";
import { OptimizerSourceEvidenceConflictError, OptimizerSourceIdentityError, type OptimizerPhase3BAdapterInput } from "./mts_optimizer_phase3b.types.ts";

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }

function fixture(): OptimizerPhase3BAdapterInput {
  return {
    company_id: "CMP003", as_of: "2026-10-17", captured_at: "2026-10-17T08:00:00.000Z",
    materials: [{ material_id: "MAT-1", base_uom_code: "KG", to_base_factors: { KG: 1, MT: 1000 } }],
    stock_eligibility: { policy_source: "COMPANY_LOCATION_POLICY", eligible_stock_type_codes: ["UNRESTRICTED"], excluded_storage_location_ids: ["OT01", "OT02"] },
    demand: [{ source_table: "erp_production.stroke_line", source_identity: "stroke-1", source_key: "demand-1", company_id: "CMP003", product_id: "SKU-1", source_line_id: "stroke-1", required_by: null, demand_kind: "GROUP_POOL", group_id: "RDP", material_id: null, uom_evidence: { base_uom_code: "KG", to_base_factors: { MT: 1000 }, source: "stroke line" }, qty: 2, uom_code: "MT" }],
    stock: [{ source_table: "erp_inventory.get_stock_history", source_identity: "ledger-1", source_key: "ledger-1", company_id: "CMP003", material_id: "MAT-1", storage_location_id: "R003", stock_type_code: "UNRESTRICTED", qty: 4, uom_code: "MT", posted_at: "2026-10-16T23:00:00Z" }],
    reservations: [{ source_table: "erp_production.reservation_document", source_identity: "res-1", source_key: "res-1", company_id: "CMP003", material_id: "MAT-1", storage_location_id: "R003", qty: 1, uom_code: "MT", status: "OPEN" }],
    po_lines: [{ source_table: "erp_procurement.purchase_order_line", source_identity: "po-line-extract-1", company_id: "CMP003", po_line_id: "po-line-1", lifecycle_identities: { po_line_id: "po-line-1", gate_entry_line_id_by_reference: { "GE-1": "ge-line-1" }, csn_id_by_number: { "CSN-1": "csn-1" }, lot_id_by_number: { "LOT-1": "lot-1" } }, line: { material_id: "MAT-1", po_number: "PO-1", line_number: 1, open_qty: 10, base_per_po_unit: 1000, expected_delivery_date: "2026-10-25", at_gate: [{ qty_base: 2000, reference: "GE-1", date: "2026-10-17" }], csns: [{ csn_number: "CSN-1", status: "TRN", dispatch_qty: 3, received_qty: 1, eta: "2026-10-20", is_mother_with_children: false }], lots: [{ lot_number: "LOT-1", balance_qty: 4, delivery_date: "2026-10-22" }] } }],
    sto_inbound: [],
  };
}

function snapshot(adapted: ReturnType<typeof adaptOptimizerPhase3BSources>, selections = resolveSixMonthNewBuyEligibility(adapted.raw.company_id, "2026-10-01", adapted.raw.materials.map((m) => m.material_id), [])) {
  return createPersistentOptimizerInputSnapshot(adapted.raw, { captured_at: adapted.raw.captured_at, captured_by: "P0076", adapter_versions: { phase3b: "1" }, source_identity_manifest: adapted.source_identity_manifest, source_versions: { erp_schema: "UNKNOWN" } }, selections);
}

Deno.test("Group Pool remains null and inbound uses verified lifecycle identities", () => {
  const adapted = adaptOptimizerPhase3BSources(fixture());
  equal(adapted.raw.demand[0].material_id, null, "GROUP_POOL remains unassigned");
  equal(adapted.raw.inbound.map((x) => [x.source_key, x.lifecycle_kind, x.qty]), [["po-line:po-line-1:gate-entry-line:ge-line-1", "AT_GATE", 2000], ["po-line:po-line-1:csn:csn-1", "IN_TRANSIT", 2000], ["po-line:po-line-1:lot:lot-1", "SCHEDULED_LOT", 4000], ["po-line:po-line-1:remainder", "PO_REMAINDER", 2000]], "one capped PO lifecycle");
});

Deno.test("identical repeated PO extraction collapses and conflicting duplicate fails closed", () => {
  const base = fixture();
  const exact: OptimizerPhase3BAdapterInput = { ...base, po_lines: [base.po_lines[0], { ...base.po_lines[0], source_identity: "duplicate-join" }] };
  equal(adaptOptimizerPhase3BSources(exact).raw.inbound.length, 4, "duplicate cannot inflate incoming");
  const conflicting: OptimizerPhase3BAdapterInput = { ...base, po_lines: [base.po_lines[0], { ...base.po_lines[0], line: { ...base.po_lines[0].line, open_qty: 11 } }] };
  let caught: unknown; try { adaptOptimizerPhase3BSources(conflicting); } catch (error) { caught = error; }
  assert(caught instanceof OptimizerSourceEvidenceConflictError, "conflicting PO duplicate blocks source");
});

Deno.test("missing GE/CSN/lot identity is rejected instead of falling back to an ordinal", () => {
  const base = fixture();
  const input: OptimizerPhase3BAdapterInput = { ...base, po_lines: [{ ...base.po_lines[0], lifecycle_identities: { ...base.po_lines[0].lifecycle_identities, gate_entry_line_id_by_reference: {} } }] };
  let caught: unknown; try { adaptOptimizerPhase3BSources(input); } catch (error) { caught = error; }
  assert(caught instanceof OptimizerSourceIdentityError, "missing physical identity not invented");
});

Deno.test("ambiguous repeated physical references fail closed instead of sharing an event key", () => {
  const base = fixture();
  const input: OptimizerPhase3BAdapterInput = { ...base, po_lines: [{ ...base.po_lines[0], line: { ...base.po_lines[0].line, at_gate: [...base.po_lines[0].line.at_gate, { ...base.po_lines[0].line.at_gate[0], qty_base: 1000 }] } }] };
  let caught: unknown; try { adaptOptimizerPhase3BSources(input); } catch (error) { caught = error; }
  assert(caught instanceof OptimizerSourceIdentityError, "duplicate GE reference cannot reuse an identity");
});

Deno.test("received, knocked-off and mother CSNs do not become new incoming quantity", () => {
  const base = fixture();
  const line = { ...base.po_lines[0].line, at_gate: [], csns: [{ csn_number: "RECEIVED", status: "TRN", dispatch_qty: 3, received_qty: 3, eta: "2026-10-20", is_mother_with_children: false }, { csn_number: "KNOCKED", status: "KOF", dispatch_qty: 3, received_qty: 0, eta: "2026-10-20", is_mother_with_children: false }, { csn_number: "MOTHER", status: "TRN", dispatch_qty: 3, received_qty: 0, eta: "2026-10-20", is_mother_with_children: true }], lots: [] };
  const input: OptimizerPhase3BAdapterInput = { ...base, po_lines: [{ ...base.po_lines[0], line, lifecycle_identities: { ...base.po_lines[0].lifecycle_identities, csn_id_by_number: { RECEIVED: "csn-received", KNOCKED: "csn-knocked", MOTHER: "csn-mother" } } }] };
  equal(adaptOptimizerPhase3BSources(input).raw.inbound.map((row) => [row.lifecycle_kind, row.qty]), [["PO_REMAINDER", 10000]], "only actual open PO balance remains");
});

Deno.test("company and STO receiving-company identity are isolated", () => {
  const input = fixture(); input.po_lines[0].company_id = "CMP005";
  let caught: unknown; try { adaptOptimizerPhase3BSources(input); } catch (error) { caught = error; }
  assert(caught instanceof Error && caught.message.includes("not requested company"), "mixed PO evidence rejected");
  const base = fixture();
  const sto: OptimizerPhase3BAdapterInput = { ...base, sto_inbound: [{ source_table: "erp_procurement.consignment_note", source_identity: "sto-csn-1", source_key: "sto-csn-1", company_id: "CMP003", receiving_company_id: "CMP005", material_id: "MAT-1", qty: 1, uom_code: "MT", eta_to_plant: "2026-10-20", lifecycle_kind: "IN_TRANSIT", reference: "STO-1" }] };
  let stoCaught: unknown; try { adaptOptimizerPhase3BSources(sto); } catch (error) { stoCaught = error; }
  assert(stoCaught instanceof Error && stoCaught.message.includes("STO_CSN_RECEIVING_COMPANY"), "STO destination enforced");
});

Deno.test("CMP005/CMP011 use same adapter without CMP003 location assumptions", () => {
  for (const companyId of ["CMP005", "CMP011"]) {
    const base = fixture();
    const input: OptimizerPhase3BAdapterInput = { ...base, company_id: companyId, stock_eligibility: { ...base.stock_eligibility, excluded_storage_location_ids: [], policy_source: `${companyId}_POLICY` }, demand: base.demand.map((row) => ({ ...row, company_id: companyId })), stock: base.stock.map((row) => ({ ...row, company_id: companyId })), reservations: base.reservations.map((row) => ({ ...row, company_id: companyId })), po_lines: base.po_lines.map((row) => ({ ...row, company_id: companyId })) };
    const adapted = adaptOptimizerPhase3BSources(input);
    equal([adapted.raw.company_id, adapted.raw.stock[0].storage_location_id], [companyId, "R003"], `${companyId} scope and location retained`);
  }
});

Deno.test("CMP003 OT exclusion and deselection never remove stock or confirmed inbound", async () => {
  const base = fixture();
  const input: OptimizerPhase3BAdapterInput = { ...base, stock: [...base.stock, { ...base.stock[0], source_identity: "ot01", source_key: "ot01", storage_location_id: "OT01" }] };
  const adapted = adaptOptimizerPhase3BSources(input);
  const selection = resolveNewBuyEligibility("CMP003", "2026-11-01", ["MAT-1"], [{ company_id: "CMP003", material_id: "MAT-1", selection_month: "2026-11-01", is_selected_for_new_purchase: false, version_no: 1, is_current: true, source_key: "selection-1" }]);
  const result = await snapshot(adapted, [selection]);
  equal(result.normalized.stock.map((row) => [row.storage_location_id, row.planning_eligible]), [["R003", true], ["OT01", false]], "OT01 excluded");
  equal([result.normalized.stock.length, result.normalized.inbound.length], [2, 4], "new-buy decision cannot filter evidence");
});

Deno.test("six months resolve independently; missing decision stays UNKNOWN with no carry-forward", () => {
  const rows = [{ company_id: "CMP003", material_id: "MAT-1", selection_month: "2026-11-01", is_selected_for_new_purchase: true, version_no: 2, is_current: true, source_key: "nov-2" }, { company_id: "CMP003", material_id: "MAT-1", selection_month: "2026-10-01", is_selected_for_new_purchase: false, version_no: 1, is_current: true, source_key: "oct-1" }, { company_id: "CMP003", material_id: "MAT-1", selection_month: "2026-10-01", is_selected_for_new_purchase: true, version_no: 0, is_current: false, source_key: "oct-history" }];
  const window = resolveSixMonthNewBuyEligibility("CMP003", "2026-10-01", ["MAT-1", "MAT-2"], rows);
  equal(window.map((month) => [month.selection_month, month.decisions.map((decision) => decision.state)]), [["2026-10-01", ["DESELECTED", "UNKNOWN"]], ["2026-11-01", ["SELECTED", "UNKNOWN"]], ["2026-12-01", ["UNKNOWN", "UNKNOWN"]], ["2027-01-01", ["UNKNOWN", "UNKNOWN"]], ["2027-02-01", ["UNKNOWN", "UNKNOWN"]], ["2027-03-01", ["UNKNOWN", "UNKNOWN"]]], "no implicit approval/expiry/carry-forward");
});

Deno.test("selection conflict, UOM/ETA gap, and reservation conflict stay fail-closed", async () => {
  const rows = [{ company_id: "CMP003", material_id: "MAT-1", selection_month: "2026-11-01", is_selected_for_new_purchase: true, version_no: 1, is_current: true, source_key: "selection-a" }, { company_id: "CMP003", material_id: "MAT-1", selection_month: "2026-11-01", is_selected_for_new_purchase: false, version_no: 1, is_current: true, source_key: "selection-b" }];
  let conflict: unknown; try { resolveNewBuyEligibility("CMP003", "2026-11-01", ["MAT-1"], rows); } catch (error) { conflict = error; }
  assert(conflict instanceof Error, "selection cannot depend on source order");
  const base = fixture();
  const bad: OptimizerPhase3BAdapterInput = { ...base, po_lines: [{ ...base.po_lines[0], line: { ...base.po_lines[0].line, base_per_po_unit: null } }], reservations: [...base.reservations, { ...base.reservations[0], qty: 2 }] };
  const result = await snapshot(adaptOptimizerPhase3BSources(bad));
  assert(result.normalized.missing_data.some((item) => item.code === "MISSING_UOM_CONVERSION"), "unknown PO UOM explicit");
  assert(result.normalized.planning_blockers.some((item) => item.domain === "EXECUTABLE_STOCK"), "reservation conflict blocks stock");
  equal(result.normalized.inbound[0].projected_supply_eligible, false, "unknown ETA/UOM gets no credit");
});

Deno.test("SHA supply vs planning-decision fingerprints are content-stable and distinct", async () => {
  const first = fixture(); const second = fixture(); second.captured_at = "2026-10-18T08:00:00.000Z";
  const extraStock = { ...first.stock[0], source_identity: "ledger-2", source_key: "ledger-2", storage_location_id: "S001", qty: 2 };
  first.stock = [first.stock[0], extraStock];
  second.stock = [extraStock, second.stock[0]];
  const unselected = resolveSixMonthNewBuyEligibility("CMP003", "2026-10-01", ["MAT-1"], []);
  const a = await snapshot(adaptOptimizerPhase3BSources(first), unselected);
  const b = await snapshot(adaptOptimizerPhase3BSources(second), unselected);
  equal([a.sha256_supply_fingerprint, a.sha256_business_fingerprint], [b.sha256_supply_fingerprint, b.sha256_business_fingerprint], "capture metadata excluded");
  const selected = resolveSixMonthNewBuyEligibility("CMP003", "2026-10-01", ["MAT-1"], [{ company_id: "CMP003", material_id: "MAT-1", selection_month: "2026-10-01", is_selected_for_new_purchase: true, version_no: 1, is_current: true, source_key: "oct" }]);
  const changed = await snapshot(adaptOptimizerPhase3BSources(first), selected);
  assert(changed.sha256_supply_fingerprint === a.sha256_supply_fingerprint && changed.sha256_business_fingerprint !== a.sha256_business_fingerprint, "selection affects only decision digest");
  assert(Object.isFrozen(a) && Object.isFrozen(a.provenance) && Object.isFrozen(a.selection_window), "snapshot immutable");
});

Deno.test("planning snapshot rejects absent, incomplete, repeated or inconsistent six-month decisions", async () => {
  const adapted = adaptOptimizerPhase3BSources(fixture());
  const valid = resolveSixMonthNewBuyEligibility("CMP003", "2026-10-01", ["MAT-1"], []);
  const provenance = { captured_at: adapted.raw.captured_at, captured_by: null, adapter_versions: { phase3b: "1" }, source_identity_manifest: adapted.source_identity_manifest, source_versions: { erp_schema: "UNKNOWN" } };
  for (const invalid of [[], valid.slice(0, 5), [...valid.slice(0, 5), valid[4]]]) {
    let error: unknown;
    try { await createPersistentOptimizerInputSnapshot(adapted.raw, provenance, invalid); } catch (caught) { error = caught; }
    assert(error instanceof Error, "missing, partial or duplicate month window must fail");
  }
  const stale = valid.map((row, index) => index === 0 ? { ...row, selected_material_ids: ["MAT-1"] } : row);
  let staleError: unknown;
  try { await createPersistentOptimizerInputSnapshot(adapted.raw, provenance, stale); } catch (caught) { staleError = caught; }
  assert(staleError instanceof Error, "selected IDs cannot contradict month decisions");
});

Deno.test("selected material identities in snapshots are frozen arrays, not mutable Sets", async () => {
  const adapted = adaptOptimizerPhase3BSources(fixture());
  const window = resolveSixMonthNewBuyEligibility("CMP003", "2026-10-01", ["MAT-1"], [
    { company_id: "CMP003", material_id: "MAT-1", selection_month: "2026-10-01", is_selected_for_new_purchase: true, version_no: 1, is_current: true, source_key: "selection-one" },
  ]);
  const record = await snapshot(adapted, window);
  equal(record.selection_window[0].selected_material_ids, ["MAT-1"], "selected list persists in fingerprintable form");
  assert(Object.isFrozen(record.selection_window[0].selected_material_ids), "selected IDs cannot be mutated");
  const before = record.sha256_business_fingerprint;
  assert(before.startsWith("sha256:"), "immutable evidence has valid digest");
});
