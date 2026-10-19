# PO22 Phase 3B — Source Adapters, Monthly Selection and Snapshot Persistence

> Canonical integration state, accepted-baseline status, branch evidence and
> next actions are maintained only in `docs/INTEGRATION-REGISTER.md`.

Date: 2026-10-17 (implementation integration updated 2026-10-19)
Status: source-identity readers, company-scoped evidence/selection APIs, append-only selection-save migration and immutable snapshot persistence service are implemented in code for review. No DEV/PROD write, migration application, ACL provisioning, deployment, allocation solver, transfer or purchase-order action has run.

## Delivered boundary

Phase 3B adds an isolated, pure source-adapter boundary in `mts_optimizer_phase3b.logic.ts`. It turns already-read-only-extracted, company-scoped evidence into the immutable Phase 3A normalized input contract. It uses the established `partitionPoLineInbound()` evidence lifecycle for each PO line rather than summing PO, Gate Entry, CSN/sub-CSN, lots and remainder independently.

Hardening update: a PO line is first deduplicated by its verified PO-line ID. Identical repeated extraction/join evidence collapses; any different duplicate fails closed. GE line IDs, CSN/sub-CSN IDs and lot IDs are mandatory for a physical event key. There is no fallback to a partition ordinal; an unavailable source ID raises `OptimizerSourceIdentityError` and must be reported as `NOT_SOURCE_READY` by the later read path.

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
| Manual selection | new effective-dated `erp_planning.mts_optimizer_material_selection` | Resolves each of six months independently. Missing current selection is `UNKNOWN`, not selected; no expiry/carry-forward rule is invented. It never filters posted stock or confirmed inbound evidence. |
| Snapshot/provenance | new immutable `erp_planning.mts_optimizer_input_snapshot` | `createPersistentOptimizerInputSnapshot()` has separate SHA-256 supply and supply+selection-decision fingerprints. Capture time is excluded; source identity/version manifest, missing-data blockers and provenance remain retained. No insert/read implementation exists yet. |

## Source dependencies and fail-closed behavior

1. **Production dates:** PO21 is monthly. Until an authoritative daily/fortnightly production schedule is supplied, the adapter leaves `required_by` null rather than inventing dates.
2. **Demand extraction:** a read-only extractor still needs verified PO21 → product/ProdShade → current Stroke/Pack BOM provenance at source-line grain, particularly CMP003 RDP Use Primary = No. Phase 3B has the null-material `GROUP_POOL` contract but does not allocate it.
3. **Location policy:** no persisted company location-policy master is introduced here. Each run must provide verified stock type/location evidence; CMP003 needs explicit OT01/OT02 exclusion. No R→S timing or transfer is inferred.
4. **Stock/reservation identity:** `get_stock_history` needs a reproducible lifecycle/source key and the reservation source needs its document ID/status/UOM. Without those, use Phase 3A blockers rather than a quantity.
5. **Inbound lineage:** confirmed `purchase_order_line.id`, `gate_entry_line.id`, CSN/sub-CSN ID, lot ID, open quantity/partial GRN state, CSN mother/child relation, consignee company and UOM conversion must be retained. Unknown/invalid/overdue ETA receives no on-time projected credit. Existing PO22 loader currently selects the PO-line and CSN IDs but not `gate_entry_line.id` or a lot row ID, so a Phase 3B live extractor must add those fields before it can produce a physical-event snapshot.
6. **Historical consumption:** no source has yet been verified at product/group/substitute consumption grain. It remains `NOT_SOURCE_READY` and is not converted into a fixed allocation percentage.
7. **Company ownership:** every evidence row must prove requested company ownership. Cross-company producing-company allocation and inbound destined to another company remain out of scope.
8. **Selection policy:** the owner has confirmed manual monthly control but has not approved a default, expiry or carry-forward rule. A missing current month/material selection is intentionally `UNKNOWN` and blocks only a tentative new-buy scenario; an owner decision is required before a later solver can treat it as selected or deselected.

## Review-only migration and ACL impact

`20261017085658_erp_planning_mts_optimizer_phase3b.sql` creates two append-only planning tables only. It is recorded in the inspected production migration history, but the inspected tables have no selection or snapshot rows and no active optimizer ACL resources. This task does not re-run or edit that migration:

- effective monthly manual selection by company/material, with a trigger that permits only `is_current: true → false` retirement; new current versions must be inserted;
- immutable JSON input snapshots with distinct SHA-256 supply and planning-decision fingerprints, the required six-month selection window and provenance.

No operational table, function or record is changed. The new repository-only migration `20261019070346_mts_optimizer_phase3b_selection_save_rpc.sql` adds the atomic, version-retiring selection-save RPC required by the API. It has **not** been applied. Rollback is limited to that new function after preserving any review evidence; it must never rewrite source stock, reservations or procurement documents.

`acl/MTS-OPTIMIZER-PHASE-3B-ACL-PROVISIONING.sql` is also **not run**. It proposes `PROC_MTS_OPTIMIZER_INPUT:VIEW` and `PROC_MTS_OPTIMIZER_SELECTION:WRITE` for the existing company-scoped PO21 capabilities. It intentionally grants no inventory movement, PO, CSN, GRN or transfer action. The tables explicitly revoke `PUBLIC`, `anon` and `authenticated`; only the later ACL-authorized server path may use the service role. It documents the required new-version capture → direct verification → snapshot generation → activation → user menu-snapshot rebuild sequence, including ACL-MASTER verification.

## Tests added

- Group Pool retains `material_id = null`; R003 location identity is retained.
- CMP003 mixed-company evidence is rejected before normalization.
- CMP003 OT01 flows to the existing explicit exclusion boundary.
- PO lifecycle partitions a single 10-unit open line into Gate Entry, net dispatched CSN, lot and remainder exactly once using physical IDs; repeated identical extraction cannot inflate it, and conflicting duplicate evidence rejects it.
- Already-received, knocked-off and mother CSN evidence never becomes new incoming quantity; missing physical IDs reject the source rather than using a synthetic ordinal.
- A monthly deselection does not remove physical stock or confirmed inbound. Every one of six months is independent and a missing decision remains `UNKNOWN`.
- Equivalent supply and manual-decision evidence receives equal SHA-256 fingerprints across capture timestamps; a selection decision changes only the complete planning-decision digest; the snapshot is deeply frozen.

## Phase 3C blockers

Phase 3C cannot safely begin until the open source identities above are checked against actual data for CMP003/CMP005/CMP011, daily demand evidence is available where date-wise protection is required, reservation/stock lifecycle identities are proven, and owner review approves applying the Phase 3B migration/ACL plus a separate API/read path. Phase 3B contains no allocation solver or recommendation capability.

## Post-review corrections

- Six independent consecutive monthly selection states are now required for every planning snapshot; empty or partial windows are rejected, while UNKNOWN material decisions are explicitly retained. The selection decision list and selected-material IDs are cross-validated.
- Selected material IDs are deeply frozen, canonical JSON-compatible arrays instead of mutable JavaScript Sets.
- **Verified live mapping now isolated:** the new dedicated reader obtains `gate_entry_line.id` and joins the lot-balance RPC's `lot_id` to `purchase_order_lot.id`, without changing the existing PO22 loader. Full PO21 demand-line extraction remains separate and must be proven against company-isolated records before it can create a persistent input snapshot.

## 2026-10-19 implementation integration

The Phase 3B boundary now has a dedicated read-only source reader and a company-scoped API; it does **not** alter `mts_requirement.logic.ts` or invoke its approved calculation path.

| Capability | Implemented behavior | Safety boundary |
|---|---|---|
| PO / GE / CSN / GRN / lot provenance | `mts_optimizer_phase3b_source.reader.ts` validates `purchase_order_line.id`, PO owner, `gate_entry_line.id`, receiving company, CSN/sub-CSN and mother relationship, `goods_receipt.id`/GE-line receiver, `purchase_order_lot.id`, and `po_lot_balances.lot_id`. | Duplicate or conflicting identities fail closed. A posted GE/GRN is receipt evidence only, never projected inbound. |
| Reservation / ledger provenance | Real `reservation_document.id` and `stock_ledger.id` are required; material/location composites are never fabricated. | Reservation status, quantity, UOM, company and location must all validate. Ledger events are provenance only, not balance quantities. |
| As-of stock / UOM | `get_stock_history` supplies ledger-backed closing balances through the day before `as_of`; direct active fixed `material_uom_conversion` rows are verified against each material base UOM. | Variable conversion, indirect conversion and unsupported litre-to-KG conversion are not invented. |
| Company isolation | `assertCompanyScope` plus resource-specific VIEW/WRITE checks precede every API reader or save. PO ownership and physical receiving company stay distinct. | CMP003/CMP005/CMP011 share one implementation; no R/S prefix inference exists and policy remains explicit. |
| Manual six-month selection | The selection API calls a proposed atomic RPC that retires the prior current version then inserts a new append-only version. | Missing material/month stays `UNKNOWN`; it governs tentative new buying only, never posted stock or confirmed inbound. |
| Snapshot persistence | `toOptimizerSnapshotInsertRow()` serializes normalized immutable evidence and `persistOptimizerInputSnapshot()` only inserts to the immutable planning table. | Supply and business-decision SHA-256 digests remain distinct; capture timestamps are excluded from business evidence. |

### New API surface (not active until separate migration and ACL approval)

- `GET /api/procurement/mts-optimizer/lifecycle-evidence` — source identity, UOM and optional as-of balance evidence only.
- `GET|POST /api/procurement/mts-optimizer/selections` — current/history read and manual new-buy decision save.
- `GET /api/procurement/mts-optimizer/snapshots` — immutable snapshot metadata only.

These routes require the proposed `PROC_MTS_OPTIMIZER_INPUT:VIEW` and `PROC_MTS_OPTIMIZER_SELECTION:WRITE` resources and the caller's company scope. They expose no stock posting, transfer, GRN, CSN mutation, PO creation, solver or recommendation capability.

### Remaining source-contract boundary

Full persistent input capture deliberately remains server-side and unexposed until a dedicated, verified PO21 → product/ProdShade → stroke/Pack-BOM line-grain demand extractor can produce every `FIXED_EXCLUSIVE` / material-null `GROUP_POOL` record with source identities. The existing PO22 requirement loader is not repurposed or changed. This is a Phase 3B source dependency, not permission to fabricate dates, conversion factors, group-member allocations or lifecycle IDs.

### 2026-10-19 STO consignee correction

Bounded, read-only production lineage checks for CMP003, CMP005 and CMP011
showed that a valid stock-transfer-order CSN may have no `po_line_id` by
design. `mts_optimizer_phase3b_source.reader.ts` now reads that lifecycle
family separately by its real CSN and STO-line identity, validates its actual
consignee company, and does not route it through direct PO-line partitioning.
It remains future evidence only; this correction creates neither stock,
transfer instruction nor incoming-quantity credit.
