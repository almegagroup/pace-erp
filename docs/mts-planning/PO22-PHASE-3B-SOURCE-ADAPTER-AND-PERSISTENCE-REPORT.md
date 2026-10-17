# PO22 Phase 3B — Source Adapters, Monthly Selection and Snapshot Persistence

Date: 2026-10-17
Status: implemented in code for review only; no migration, ACL script, API, UI, DEV/PROD write, deployment, allocation solver, transfer or purchase-order action has run.

## Delivered boundary

Phase 3B adds an isolated, pure source-adapter boundary in `mts_optimizer_phase3b.logic.ts`. It turns already-read-only-extracted, company-scoped evidence into the immutable Phase 3A normalized input contract. It uses the established `partitionPoLineInbound()` evidence lifecycle for each PO line rather than summing PO, Gate Entry, CSN/sub-CSN, lots and remainder independently.

It is additive: `mts_requirement.logic.ts`, `buildRequirementRows()`, existing CM/NM calculation, approved coverage-based NM Requirement Days, PO22 routes/frontend/ACL provisioner and operational tables are not changed.

The adapter records each source location unchanged. It accepts only an explicit source policy—eligible stock types and excluded locations. CMP003 fails closed if the supplied policy omits OT01 or OT02; it does not derive eligibility from an `R`/`S` prefix. Valid `R003` stock is retained as location evidence. QA/blocked eligibility is controlled solely by the supplied stock-type policy. Incoming PO/GE/CSN/lots are future projected evidence only and no module exposes a Store instruction.

## Exact source contracts

| Domain | Phase 3B contract | Existing verified reader/evidence |
|---|---|---|
| Effective PO21 demand | `erp_planning.customer_plan_line(id, company_id, product_id, plan_month, version_type, qty)` | `mts_requirement.handlers.ts` `loadEffectivePlan()`; its existing FINAL/ROLLING/ADDITIONAL/URGENT precedence remains untouched. |
| Product/ProdShade/Stroke/Pack BOM | `stroke_master`, `stroke_line`, `pack_bom`, `pack_bom_line`, group member source listed in `OPTIMIZER_SOURCE_TABLES.demand` | Existing `loadMtsMasters()` / `loadStrokeSettings()` and `explodeDemand()` contract. Adapter requires the extractor to emit exactly one `FIXED_EXCLUSIVE` or material-null `GROUP_POOL` record per line. It assigns no member. |
| Material/UOM | `material_master(id, base_uom_code, material_type)`, `material_uom_conversion(...)` | Existing PO22 master loader and Phase 3A normalizer. A missing material/UOM conversion stays a missing-data condition. CMP003 litre-to-KG has no invented factor. |
| Posted physical stock | `get_stock_history(...)`, location master/map | Existing `loadStockAndConsumption()` ledger-backed row output. Adapter preserves `storage_location_id`, `stock_type_code`, posting time and company. It does not net a reservation or treat inbound as stock. |
| Reservations | `reservation_document(id, company_id, material_id, storage_location_id, balance_qty, status)` | Existing `loadReservations()` OPEN/PARTIAL shape. Source identity must be the real reservation lifecycle identity, not material/location alone. Phase 3A rejects conflicting duplicates and blocks affected executable stock. |
| PO/GE/CSN/sub-CSN/lots | `purchase_order`, `purchase_order_line`, `gate_entry(_line)`, `consignment_note`, `po_lot_balances()` fields listed in `OPTIMIZER_SOURCE_TABLES.inbound` | Existing `loadInbound()` feeds `partitionPoLineInbound()`: PO line ceiling → un-GRN'd gate quantity → dispatched child/standalone CSN net receipt → lot balance → remainder. A mother CSN with children contributes no duplicate quantity. |
| Manual selection | new effective-dated `erp_planning.mts_optimizer_material_selection` | Gates only later tentative new purchase. It deliberately never filters posted stock or confirmed inbound evidence. |
| Snapshot/provenance | new immutable `erp_planning.mts_optimizer_input_snapshot` | `createPersistentOptimizerInputSnapshot()` uses SHA-256 over business evidence; `captured_at`/actor/adapter versions and source-table list are provenance metadata. |

## Source dependencies and fail-closed behavior

1. **Production dates:** PO21 is monthly. Until an authoritative daily/fortnightly production schedule is supplied, the adapter leaves `required_by` null rather than inventing dates.
2. **Demand extraction:** a read-only extractor still needs verified PO21 → product/ProdShade → current Stroke/Pack BOM provenance at source-line grain, particularly CMP003 RDP Use Primary = No. Phase 3B has the null-material `GROUP_POOL` contract but does not allocate it.
3. **Location policy:** no persisted company location-policy master is introduced here. Each run must provide verified stock type/location evidence; CMP003 needs explicit OT01/OT02 exclusion. No R→S timing or transfer is inferred.
4. **Stock/reservation identity:** `get_stock_history` needs a reproducible lifecycle/source key and the reservation source needs its document ID/status/UOM. Without those, use Phase 3A blockers rather than a quantity.
5. **Inbound lineage:** confirmed `open_qty`, GRN state, CSN mother/child relation, consignee company and UOM conversion must be retained. Unknown/invalid/overdue ETA receives no on-time projected credit.
6. **Historical consumption:** no source has yet been verified at product/group/substitute consumption grain. It remains `NOT_SOURCE_READY` and is not converted into a fixed allocation percentage.
7. **Company ownership:** every evidence row must prove requested company ownership. Cross-company producing-company allocation and inbound destined to another company remain out of scope.

## Review-only migration and ACL impact

`20261017085658_erp_planning_mts_optimizer_phase3b.sql` proposes two append-only planning tables only:

- effective monthly manual selection by company/material;
- immutable JSON input snapshots with a SHA-256 business fingerprint and provenance.

No operational table, function or record is changed. The migration has **not** been applied. Rollback is limited to the two empty planning tables/triggers after preserving any review evidence; it must never rewrite source stock, reservations or procurement documents.

`acl/MTS-OPTIMIZER-PHASE-3B-ACL-PROVISIONING.sql` is also **not run**. It proposes `PROC_MTS_OPTIMIZER_INPUT:VIEW` and `PROC_MTS_OPTIMIZER_SELECTION:WRITE` for the existing company-scoped PO21 capabilities. It intentionally grants no inventory movement, PO, CSN, GRN or transfer action. It documents the required new-version capture → direct verification → snapshot generation → activation → user menu-snapshot rebuild sequence, including ACL-MASTER verification.

## Tests added

- Group Pool retains `material_id = null`; R003 location identity is retained.
- CMP003 mixed-company evidence is rejected before normalization.
- CMP003 OT01 flows to the existing explicit exclusion boundary.
- PO lifecycle partitions a single 10-unit open line into Gate Entry, net dispatched CSN, lot and remainder exactly once.
- A monthly deselection does not remove physical stock or confirmed inbound.
- Equivalent business evidence receives an equal `sha256:` digest across different capture timestamps and the snapshot is deeply frozen.

## Phase 3C blockers

Phase 3C cannot safely begin until the open source identities above are checked against actual data for CMP003/CMP005/CMP011, daily demand evidence is available where date-wise protection is required, reservation/stock lifecycle identities are proven, and owner review approves applying the Phase 3B migration/ACL plus a separate API/read path. Phase 3B contains no allocation solver or recommendation capability.
