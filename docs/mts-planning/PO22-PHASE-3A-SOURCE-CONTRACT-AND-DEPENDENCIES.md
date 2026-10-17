# PO22 Phase 3A — Source Contract and Dependency Report

Date: 2026-10-17
Scope: Phase 3A source normalization and reproducibility only. This is not a solver, procurement recommendation, Store instruction, UI, migration, or operational integration.

## Implemented Phase 3A boundary

`mts_optimizer_input.types.ts` defines a company-scoped immutable input snapshot for future deterministic runs. `mts_optimizer_input.logic.ts` accepts already read-only-loaded source evidence and:

- rejects a row whose company differs from the requested company;
- converts demand, posted stock, reservations and inbound quantities to verified material base UOMs;
- retains a `null` base quantity and a specific missing-data state instead of guessing a conversion;
- deduplicates exact stock and inbound lifecycle keys; conflicting duplicates are retained once and labelled;
- labels an unknown ETA explicitly, so later coverage logic cannot silently credit it;
- produces an order-independent FNV-1a source fingerprint over the normalized evidence.

The snapshot is an in-memory Phase 3A contract only. It has no database persistence and therefore does not claim that a stored run is available yet. Persistent run/snapshot tables, a cryptographic stored digest, ACL resources and APIs remain Phase 3B+ work.

## Verified current PO22 source contracts

| Source domain | Existing PO22 loader/logic evidence | Phase 3A normalization contract |
|---|---|---|
| PO21 demand | `mts_requirement.handlers.ts` loads append-only `erp_planning.customer_plan_line`; `effectivePlanAt()` resolves FINAL/ROLLING/ADDITIONAL/URGENT. | Keep source key, company, product/source-line identity, required-by evidence and base-UOM demand. Exact daily production dates remain unknown unless sourced. |
| Stroke / Pack BOM | Current stroke, periods, primary decisions and Pack BOM loaders feed `explodeDemand()`. | Future extractor must emit one `FIXED_EXCLUSIVE` or `GROUP_POOL` demand record per source line, never both. |
| Group membership | `erp_master.material_category_group_member` and primary decision loaders create active candidates. | Group identity is kept in demand evidence; no Phase 3A allocation chooses a member. |
| R/S stock | `erp_inventory.get_stock_history()` supplies ledger-backed balances, separated by location and stock type. | Each posted stock event requires a lifecycle-unique key, company, material, location, type, posting time and UOM. Location eligibility/OT01/OT02 policy is intentionally not implemented here. |
| Reservations | OPEN/PARTIAL reservation documents are loaded by material/location. | A reservation is separate evidence; no subtraction is performed in Phase 3A, preventing accidental double deduction. |
| PO/GE/CSN/lots | Existing `partitionPoLineInbound()` caps Gate Entry, dispatched CSN, lots and PO remainder to the open PO balance. | Each already partitioned physical inbound event requires a unique lifecycle key. Unknown ETA stays explicit. No inbound becomes executable current stock. |
| Historical consumption | Current PO22 derives net P261/P262 from ledger history. | Future source adapter must preserve source key, material, date/UOM and product/group join evidence; no historical percentage allocation is derived in Phase 3A. |

## Files deliberately unchanged

- `supabase/functions/api/_core/procurement/mts_requirement.logic.ts`, including `buildRequirementRows()`.
- `mts_requirement.handlers.ts`, PO22 routes, frontend and Material Settings migration.
- All stock, PO, CSN, GRN, reservation and production data paths.

## Source dependencies before Phase 3B

1. Confirm PO21 product/ProdShade/stroke-line identity and actual-consumption/substitute join evidence for each company.
2. Confirm an authoritative daily or fortnightly production-demand source; monthly PO21 values cannot create invented exact dates.
3. Verify ledger posting/status/UOM grain, reservation status/grain and double-deduction risk for CMP003, CMP005 and CMP011.
4. Confirm CMP003 R/S eligible-location evidence and OT01/OT02 exclusion as a company policy; do not infer from location-code prefixes.
5. Verify lifecycle-unique source keys for PO, Gate Entry, CSN/sub-CSN, lots, partial GRN and knock-off events.
6. Verify material UOM conversions, especially the CMP003 litre-to-KG exception and all Pack BOM unit paths.
7. Confirm vendor MOQ/order-multiple, delivery-lot and total lead-time source contracts before any procurement scenario exists.
8. Obtain an approved DEV baseline of current PO22 CM/NM output before changing any integration surface; no owner PROD UAT is assumed by Phase 3A.

## Phase 3B entry criteria

Phase 3B may add source adapters, persistent snapshot/run tables and company policy/selection data only after the listed dependencies are evidenced and owner-approved. It must continue to preserve PO22 CM/NM and the approved NM Requirement Days calculation.
