import { adaptOptimizerPhase3BSources, createPersistentOptimizerInputSnapshot, resolveNewBuyEligibility } from "./mts_optimizer_phase3b.logic.ts";
import type { OptimizerPhase3BAdapterInput } from "./mts_optimizer_phase3b.types.ts";

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
    po_lines: [{ source_table: "erp_procurement.purchase_order_line", source_identity: "po-line-1", company_id: "CMP003", po_line_id: "po-line-1", line: { material_id: "MAT-1", po_number: "PO-1", line_number: 1, open_qty: 10, base_per_po_unit: 1000, expected_delivery_date: "2026-10-25", at_gate: [{ qty_base: 2000, reference: "GE-1", date: "2026-10-17" }], csns: [{ csn_number: "CSN-1", status: "TRN", dispatch_qty: 3, received_qty: 1, eta: "2026-10-20", is_mother_with_children: false }], lots: [{ lot_number: "LOT-1", balance_qty: 4, delivery_date: "2026-10-22" }] } }],
    sto_inbound: [],
  };
}

Deno.test("Phase 3B preserves group-pool null material and valid non-prefix location evidence", () => {
  const raw = adaptOptimizerPhase3BSources(fixture());
  equal(raw.demand[0].material_id, null, "GROUP_POOL remains unassigned");
  equal(raw.stock[0].storage_location_id, "R003", "source location retained");
  equal(raw.inbound.map((x) => [x.lifecycle_kind, x.qty]), [["AT_GATE", 2000], ["IN_TRANSIT", 2000], ["SCHEDULED_LOT", 4000], ["PO_REMAINDER", 2000]], "PO lifecycle partitions once to open quantity");
});

Deno.test("Phase 3B rejects mixed-company evidence before normalizing it", () => {
  const input = fixture(); input.po_lines[0].company_id = "CMP005";
  let caught: unknown; try { adaptOptimizerPhase3BSources(input); } catch (error) { caught = error; }
  assert(caught instanceof Error && caught.message.includes("not requested company"), "company isolation must fail closed");
});

Deno.test("CMP005 and CMP011 use the same company-isolated adapter without CMP003 location assumptions", () => {
  for (const companyId of ["CMP005", "CMP011"]) {
    const base = fixture();
    const input: OptimizerPhase3BAdapterInput = {
      ...base,
      company_id: companyId,
      stock_eligibility: { ...base.stock_eligibility, excluded_storage_location_ids: [], policy_source: `${companyId}_POLICY` },
      demand: base.demand.map((row) => ({ ...row, company_id: companyId })),
      stock: base.stock.map((row) => ({ ...row, company_id: companyId })),
      reservations: base.reservations.map((row) => ({ ...row, company_id: companyId })),
      po_lines: base.po_lines.map((row) => ({ ...row, company_id: companyId })),
    };
    const raw = adaptOptimizerPhase3BSources(input);
    equal(raw.company_id, companyId, `${companyId} stays isolated`);
    equal(raw.stock[0].storage_location_id, "R003", `${companyId} does not receive a location-prefix filter`);
  }
});

Deno.test("CMP003 OT exclusion is carried into the Phase 3A policy boundary", async () => {
  const base = fixture();
  const input: OptimizerPhase3BAdapterInput = { ...base, stock: [...base.stock, { ...base.stock[0], source_identity: "ot01", source_key: "ot01", storage_location_id: "OT01" }] };
  const raw = adaptOptimizerPhase3BSources(input);
  const snapshot = await createPersistentOptimizerInputSnapshot(raw, { captured_at: raw.captured_at, captured_by: "P0076", adapter_versions: { source: "1" } });
  equal(snapshot.normalized.stock.map((row) => [row.storage_location_id, row.planning_eligible]), [["R003", true], ["OT01", false]], "OT01 cannot become planning supply");
});

Deno.test("monthly new-buy selection does not remove physical stock or confirmed inbound", () => {
  const input = fixture();
  const eligibility = resolveNewBuyEligibility("CMP003", "2026-11-01", [{ company_id: "CMP003", material_id: "MAT-1", selection_month: "2026-11-01", is_selected_for_new_purchase: false, version_no: 1, source_key: "selection-1" }]);
  assert(!eligibility.selected_material_ids.has("MAT-1"), "deselection gates new buy");
  const raw = adaptOptimizerPhase3BSources(input);
  equal([raw.stock.length, raw.inbound.length], [1, 4], "selection never filters stock or inbound evidence");
});

Deno.test("unusable PO UOM evidence remains explicit and receives no projected credit", async () => {
  const input = fixture();
  const poLine = input.po_lines[0];
  const bad: OptimizerPhase3BAdapterInput = { ...input, po_lines: [{ ...poLine, line: { ...poLine.line, base_per_po_unit: null } }] };
  const raw = adaptOptimizerPhase3BSources(bad);
  equal(raw.inbound.length, 1, "blocked PO line stays visible as evidence");
  assert(raw.inbound[0].reference.includes("PO_UOM_RATIO_MISSING"), "source warning identifies cause");
  const snapshot = await createPersistentOptimizerInputSnapshot(raw, { captured_at: raw.captured_at, captured_by: null, adapter_versions: { source: "1" } });
  assert(snapshot.normalized.missing_data.some((item) => item.code === "MISSING_UOM_CONVERSION"), "blocked quantity is an explicit missing-data state");
  equal(snapshot.normalized.inbound[0].projected_supply_eligible, false, "unverified PO receives no projected credit");
});

Deno.test("conflicting duplicate selection evidence fails closed", () => {
  const rows = [
    { company_id: "CMP003", material_id: "MAT-1", selection_month: "2026-11-01", is_selected_for_new_purchase: true, version_no: 1, source_key: "selection-a" },
    { company_id: "CMP003", material_id: "MAT-1", selection_month: "2026-11-01", is_selected_for_new_purchase: false, version_no: 1, source_key: "selection-b" },
  ];
  let caught: unknown; try { resolveNewBuyEligibility("CMP003", "2026-11-01", rows); } catch (error) { caught = error; }
  assert(caught instanceof Error && caught.message.includes("Conflicting duplicate"), "selection conflict cannot depend on source order");
});

Deno.test("SHA-256 snapshot is stable for equivalent business evidence and deeply frozen", async () => {
  const first = fixture(); const second = fixture(); second.captured_at = "2026-10-18T08:00:00.000Z";
  const a = await createPersistentOptimizerInputSnapshot(adaptOptimizerPhase3BSources(first), { captured_at: first.captured_at, captured_by: null, adapter_versions: { source: "1" } });
  const b = await createPersistentOptimizerInputSnapshot(adaptOptimizerPhase3BSources(second), { captured_at: second.captured_at, captured_by: null, adapter_versions: { source: "1" } });
  equal(a.sha256_business_fingerprint, b.sha256_business_fingerprint, "capture metadata is excluded from business digest");
  assert(a.sha256_business_fingerprint.startsWith("sha256:") && a.sha256_business_fingerprint.length === 71, "cryptographic digest present");
  assert(Object.isFrozen(a) && Object.isFrozen(a.provenance) && Object.isFrozen(a.normalized.stock), "persistent snapshot is immutable");
});
