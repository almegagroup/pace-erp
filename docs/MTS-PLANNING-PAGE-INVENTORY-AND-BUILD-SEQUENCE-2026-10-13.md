# MTS Procurement Planning — Canonical Page Inventory and Build Order
Date: 2026-10-13
Status: EXECUTION BASELINE / DEV only
Authority: business discussion + PACE ERP Phase 0 audit; unresolved technical mappings marked OPEN.

## Interaction model
Every page may expose manual (M), semi-automatic (S), and automatic (A) capabilities. Excel-familiar dense grid for entry and review; real AI analysis is additive, not a substitute for tables. 19 logical workspaces are not necessarily 19 menu nodes. Avoid card-per-material and obligatory side drawers. Backend ACL, company selection, source provenance, audit and deterministic computation are mandatory.

## Ordered page backlog
| # | Page | Mode | Depends on | Migration / backend / frontend deliverable |
|---|---|---|---|---|
| 01 | Customer Plan Register | S | Master/company/ACL | Canonical plan+revision+line read view; paged scoped list API; dense register with old/new source column |
| 02 | Customer Plan Entry & Revision | M | 01 model | Revision/version schema; validate create/revise API; keyboard-first multi-line editor |
| 03 | Historical Import & Validation | S | 01–02 | Import batch/row staging, fingerprints and source lineage; preview/dry-run/commit API; mapping/reject/retry grid |
| 04 | Production Estimate Entry | M | 01–02, production actuals | Separate estimate revisions & assumptions; scoped create/revise; monthly material/Prodshade grid |
| 05 | Plan History & Comparison | A/S | 01–04 | Plan-versus-actual read model and provenance; comparison and revisions grid |
| 06 | Production Schedule & Capacity Scenario | S | 04–05 | Scenario allocations; read current process order/capacity; editable simulation grid |
| 07 | Stroke/Formulation Scenario | S | 06, approved stroke | Date-effective approval-safe alternative selection; scenario comparison |
| 08 | Material Requirement Calculation | A | 06–07, pack BOM | Deterministic requirements projection; breakdown trace per source plan/BOM/stroke |
| 09 | Book Stock Reconciliation & Calibration | S | 08, stock ledger | Selected date true book opening and calibration history; compare book/projected; never update ledger |
| 10 | Per-Material Daily Planning | S | 08–09, PO/CSN | 180+ daily inward/usage/closing/coverage, what-if quantity/date, saved versions |
| 11 | Consolidated Multi-Plant Planning | S | 10, ACL | Multiple authorised plants, shared-stock constraints, conservation & transfer windows |
| 12 | Mother/Sub-CSN/STO Allocation Scenario | S | 11, CSN, STO | Consignment allocation proposal, shipment milestone aware, no double counting |
| 13 | Supply Schedule and PO/CSN Adjustment | S | 10–12 | PO/lot and ETA-aware prepone/defer/bridge feasibility proposals, not actual transaction edits |
| 14 | Stock Transfer and Approved Alternative Decision | S | 07, 11–13, PO12 PTO | Location/plant/company movements, GST/transfer economics and constraints |
| 15 | Safety Stock and Vendor Sourcing Policy | M/S | 08–14 | Plant/material approved target, vendor-specific lead time/risk sourcing inputs and effective history |
| 16 | Vendor Business Share & Commercial Analysis | S | 15, AC01/payment masters | Quantity share monthly/quarterly/annual/vendor specific (advisory); landed cost and working capital |
| 17 | AI Forecasting and Optimisation | A/S | 05, 08, 10–16 | Validated deterministic facts + Haiku explanation/scenario tool, atomically enforced budget cap |
| 18 | Scenario Review, Decisions and History | S | 10–17 | Proposal revision/approval/impact and reference to authorised operational workflow |
| 19 | Planning Accuracy and Performance Review | A | 05, 17–18 | Forecast-vs-actual, supplier forecast errors, cost and decision impact |

## Phase-gated integration
Phase 1 pages 01–05; Phase 2 pages 06–10; Phase 3 pages 11–14; Phase 4 pages 15–18; Phase 5 page 19 plus UAT. Reusable AI can appear contextually in prior pages after budget/safety infrastructure ships.

## Immediate implementation unit — pages 01+02
First DEV feature branch deliverables in order:
1. Evidence-backed source mapping: original Google Sheets PLAN etc and rolling plan workbook, separate genuine customer Final from derived PLANNING/REQUIREMENT; no invented Rolling.
2. Inspect PROD and DEV masters and existing erp_production.plan_feed/plan_feed_item versus customer plan. They are not interchangeable; reuse FK to existing entities and prevent demand double count.
3. Migration containing canonical header/revision/line, company and customer keys, period and plan type (ROLLING/FINAL/ADDITIONAL/URGENT), source metadata, indexes, constraints; migrations only, review RLS and approved workflow before applying.
4. Backend API: list/detail/create/revise with company selected and backend ACL; immutable revision trail and per-row validation, no source-mixing.
5. Frontend: dense register and tabular multi-row editor using existing PACE design patterns, search, filtering, keyboard paste and error presentation.
6. Tests: old + new in same register, revisions preserved, row/company access denial, absent original Rolling marked unavailable, no silent overwrites, no duplicate from re-import.
7. Subsequent page 03 migration/API/UI importer, then page 04 estimate and page 05 history comparison. One testable PR per delivery, PROD unchanged.

## Verified repo/DB facts
- PROD erp_production.plan_feed and plan_feed_item exist as production/order feed. Must investigate before model final.
- No tables matching customer_plan / demand_plan / plan_revision / import_batch present in DEV erp_procurement/erp_production at audit.
- PO11 erp_procurement.procurement_monthly_plan is ADMIX/HPS specific.
- AC01 is GRN landed-cost hub, atomic save_ac01_grn_cost RPC.
- PO12 maps to Plant Transfer Order (PTO), NOT vendor PO and not automatically equal to STO.
- Mother/Sub-CSN implementation exists, currently zero populated parent/sub links in PROD.
- All future AI budget must be hard-capped; routine deterministic work cannot consume Claude tokens.
- Discussed business constraints and formulas remain in Phase 0 audit and comprehensive blueprint.

## Definition of DONE per page
Migration created and tested on DEV, backend routes authorised and tested, frontend accessible and keyboard usable, real DEV rows, source mapping/reconciliation evidence, performance checks, no unexpected writes to PO/CSN/stock, screenshots/test logs, draft PR with exact changed files and pending issues.

DO NOT auto-merge PR 647 or deploy PROD.