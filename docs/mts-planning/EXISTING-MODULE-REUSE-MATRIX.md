# MTS Planning — Existing Module Reuse Matrix

Date: 2026-10-13, updated 2026-10-14 (Step 1C) · Status: DISCOVERY. Evidence labels as in `TECHNICAL-DISCOVERY.md` §0.
Classification: **REUSE** (use as-is, read-only) · **EXTEND** (exists, needs additive change) · **NEW** (nothing exists) · **NOT VERIFIED**.
PROD = `bsjpvkigpllichlknmah`, counts = estimates on 2026-10-13. Code paths relative to `supabase/functions/api/` unless prefixed `frontend/`.

## A. Demand side

| # | Capability | Class | Evidence (table / code / route) | Note |
|---|---|---|---|---|
| A1 | Customer Rolling/Final/Additional/Urgent plan storage | **NEW** | No `%forecast%/%demand%/%customer_plan%` table in PROD/DEV (VERIFIED catalogue query) | Grain/enums OPEN Q-B01–B05 |
| A2 | Plan revision / immutable history | **NEW** | none | PROPOSED append-only revision table |
| A3 | Historical Sheets import staging + fingerprints | **NEW** | none; `erp_procurement.sales_order_excel_upload_result` is SO-specific (0 rows) | Pattern ref only: SO01 Excel upload (`docs/FG-STO-MTS-DISPATCH-DESIGN-DOC.md` §4) |
| A4 | Customer master / company mapping | **Do NOT use for Asian Paints identity** (Step 1C) | `customer_master` has no Asian Paints Ltd row (5 name matches are dealers); all 15 MTS SOs have `customer_id` NULL | Plan carries company only now (B04) |
| A5 | Asian Paints billing identity (depot / parent company) | **REUSE (read)** — candidate customer key (OPEN, owner to confirm) | `fg_parent_company` 17 ("ASIAN PAINTS LTD- <STATE>", company-scoped, GSTIN), `fg_depot_code` 47; MTS SOs bill via `sales_order.bill_to_type` DEPOT/VDC (Step 1C) | B04 CONFLICT |
| A6 | MTO/HPS FO feed (`plan_feed`) | **Do NOT reuse for MTS demand** | `erp_production.plan_feed` 502, 0 MTS parties, 0 PMTS allocation (VERIFIED) | UX reference only (contract) |
| A7 | Production estimate entry | **NEW** | none; PO11 `monthly_requirement_qty` is RM/PM-level manual (§35.6) | Q-B06 |
| A8 | Management target / market adjustment | **NEW** | none | Contract lists as separate forecast components |

## B. Actuals

| # | Capability | Class | Evidence | Note |
|---|---|---|---|---|
| B1 | MTS production actuals | **REUSE** | `process_order` (MTS VERIFIED 108, 2026-10-02→12), `packing_order` PMTS 118, `mts_packing_plan_row`, `mts_batch_yield_variance`; PR24 `GET /api/production/order-information-system/mts-register` (`_core/production/mts_production_register.handlers.ts`) | ERP history only ~10 days |
| B2 | Pre-ERP production history | **NEW (import)** | not in DB | via A3 importer |
| B3 | MTS dispatch actuals | **EXTEND** (new read model) — **no posted data yet** | `sales_order_line.fg_type='MTS'` 176 (all SOs CREATED), MTS DO lines 932 all CREATED, **0** P601/P602 and **0** invoice lines on PMTS SKUs (Step 1C); `dispatch_reco` has no PMTS | Bill-To criterion = `sales_order.bill_to_type` DEPOT/VDC + `sales_invoice` once PGI exists |
| B4 | Depot STO dispatch of MTS FG | **NOT VERIFIED** | design open in `docs/FG-STO-MTS-DISPATCH-DESIGN-DOC.md` §2 | Q-B08 |
| B5 | Material consumption actuals | **REUSE** | `process_order_line` (actual material + `stock_ledger_id`), IN14 `get_stock_history` CONS bucket (P261/P262) | |

## C. Formulation / BOM

| # | Capability | Class | Evidence | Note |
|---|---|---|---|---|
| C1 | Default MTS stroke | **REUSE** | `erp_production.mts_current_stroke` (40 rows, 3 companies), `GET/POST /api/production/mts-current-stroke` (`PROD_STROKE_MASTER`) | No effective dating |
| C2 | Date-effective planning stroke override | **NEW** | none | Must not mutate C1 (contract) |
| C3 | Stroke recipe | **REUSE** | `stroke_master` (APPROVED/MTS 45; `revision_no`, `conversion_factor`), `stroke_line` (`dosage_pct`, `alternate_material_id`, `material_group_id`) | |
| C4 | Material groups / substitutes | **REUSE** | `material_category_group` 58 / `_member` 132 | Substitution priority rule OPEN Q-B09 |
| C5 | SKU ↔ Prodshade ↔ pack | **REUSE rule, no FK** | `prodshade_pack_config` 476 (global, no company); production resolves SKU by name/code match `resolveSkuMaterial()` `mts_creation_session.handlers.ts:288`; PROD: 59/59 go-live pairs unique (Step 1C) | Planning needs reverse lookup + uniqueness check per run |
| C6 | Pack BOM (PM explosion) | **REUSE** | `pack_bom` 482 (company-scoped), `pack_bom_line` 1407 (`is_primary_container`) | |
| C7 | Requirement explosion engine | **EXTEND** | Shared core `buildMtsMaterialPlanGroupsForOrder()` `_core/production/process_order.handlers.ts:3231`, called from `mts_creation_session.handlers.ts:196`; golden data `mts_creation_snapshot.page4_material_plan` (125) | T03: extract pure requirement calc, separate from availability (`fetchLocationNetAvailability` :420) |

## D. Inventory

| # | Capability | Class | Evidence | Note |
|---|---|---|---|---|
| D1 | Current stock by company/SLoc/stock type | **REUSE** | `stock_snapshot` 1085, IN03 `GET /api/procurement/current-stock` (`PROC_CURRENT_STOCK`) | snapshot not batch-split |
| D2 | Open reservations | **REUSE** | `erp_production.reservation_document` (`status='OPEN'`, `balance_qty`) | Same netting as IN03/PO11 |
| D3 | Book stock as of date | **EXTEND** | `erp_inventory.get_stock_history(...)` (STABLE) folds `is_opening_source` movements into opening; 667/36,647 ledger rows in last 30 days back-dated (Step 1C) | Calibration needs strict `posting_date < D` sum + stored captured value (B12) |
| D4 | Batch-level stock | **REUSE (derive)** | `stock_ledger.batch_number` sum | Expensive at scale (§8E) |
| D5 | Calibration (book vs planner/physical) history | **NEW** | none; PID tables are physical-count source only | Never writes ledger |
| D6 | SLoc grouping for planning | **Do NOT reuse PO11 groups** (owner T02) + **NEW eligibility map** | Go-live SLocs R/S/P001 = PUTTY, 002 = TLA, 003 = ADMIX; `location_type` WAREHOUSE for all; `production_segment_location_config` 0 rows (Step 1C) | B09/T01 CONFLICT: owner-maintained MTS SLoc eligibility needed |

## E. Inbound supply

| # | Capability | Class | Evidence | Note |
|---|---|---|---|---|
| E1 | Open PO quantity | **REUSE** | `purchase_order_line.open_qty`, `line_status`, `purchase_order.status`, `expected_delivery_date` | Not consumed by PO11 today |
| E2 | PO lots with dates | **REUSE** | `purchase_order_lot` (5 rows, 3 POs `order_in_lot`); PROD functions `erp_procurement.po_lot_balances(uuid[],…)` and `po_line_available_qty(uuid,…)` (Step 1C) | Planning reads server-side under its own VIEW ACL (T09); no use of `GET /api/procurement/po-lot-orders` |
| E3 | CSN in-transit + ETA | **REUSE** | `consignment_note` ETA chain, `csn_field_history`, `GET /api/procurement/csns` (`PROC_CSN_TRACKER`) | Status semantics OPEN Q-T05 |
| E4 | Mother/Sub-CSN | **REUSE (read)** | `is_mother_csn`, `mother_csn_id`; `csn.handlers.ts` `createSubCSNHandler`; `gate_entry.handlers.ts` `resolveCrossCompanyCsnLink`; 0 links in PROD | Double-count rule required |
| E5 | Open gate entries | **REUSE** | `gate_entry_line.grn_posted=false` (as PO11) | |
| E6 | STO inbound | **REUSE** | `stock_transfer_order(_line)` 2 PROD, `GET /api/procurement/stos` | |
| E7 | Bulk RM arrival schedule (no CSN) | **NEW** | none | Contract step 6 |

## F. Transfers

| # | Capability | Class | Evidence | Note |
|---|---|---|---|---|
| F1 | Intra-company location transfer execution | **REUSE (target workflow)** | IN10/IN11, `location_transfer_request/_line/_posting`, RPC `complete_location_transfer_action` | Planning proposes only |
| F2 | Feeder rule (material + effective date) | **NEW** (or EXTEND `location_transfer_rule`) | `location_transfer_rule` 0 rows, no material/date column | Contract: extend at planning layer, not posting policy |
| F3 | PO12 Plant Transfer Order | **Not applicable as-is** | PO12 = CRCP Discrepancy + Returnable Transfer (`PlantTransferPage.jsx`); `plant_transfer_order` 0 rows; `pto.handlers.ts` unreachable from UI | Q-B07 decide inter-company proposal target (STO vs PTO) |
| F4 | Inter-company transfer economics (GST) | **NOT VERIFIED** | STO has GST fields per §113; PTO has `gst_applicable` | |

## G. Commercial

| # | Capability | Class | Evidence | Note |
|---|---|---|---|---|
| G1 | Vendor–material mapping (ASL) | **REUSE** | `vendor_material_info` 127, `GET /api/om/vendor-material-infos` (`OM_VENDOR_LIST`) | |
| G2 | Last price | **REUSE** | `vendor_material_info.last_purchase_price/currency/last_grn_date`, `purchase_order_line.unit_rate` | |
| G3 | Landed cost history | **REUSE (read)** | AC01 `_core/procurement/ac01.handlers.ts`, RPC `save_ac01_grn_cost`; `landed_cost` 145 POSTED / 60 DRAFT; posted cost types only FREIGHT / UNLOADING / TRANSPORTER_CHARGE_OTHER_THAN_BASIC (Step 1C) | Exclude/label DRAFT; collections have no ERP table; USD POs (13 lines) have no FX source (B10) |
| G4 | Lead time | **EXTEND** | `lead_time_master_domestic` (vendor+company) 126, `lead_time_master_import` (vendor+port) 8, `port_plant_transit_master` 5, `material_plant_ext.lead_time_days` (0 populated) | No material/vendor-pair lead time |
| G5 | Payment terms | **REUSE** | `payment_terms_master` 18, `vendor_material_payment_term(is_default)` 128 | Working-capital formula OPEN |
| G6 | Safety stock / MOQ | **EXTEND or NEW** | `material_plant_ext.safety_stock_qty/min_order_qty/reorder_point_qty` (0 populated); PO11 `safety_days`/`fixed_safety_stock_qty` per plan line | Q-B11 which is authoritative |
| G7 | Vendor share / capacity / risk | **NEW** | no columns | |

## H. Platform

| # | Capability | Class | Evidence | Note |
|---|---|---|---|---|
| H1 | ACL / menu / company scope | **REUSE** | `route-acl-registry.ts`, `_shared/companyScope.ts`, `TransactionCompanySelector`, §8 4-step ACL sequence | New resource codes needed |
| H2 | Criteria → results UI | **EXTEND** | `frontend/src/components/data/ErpDenseGrid.jsx` exists; `ErpSelectionScreen` is specified in `docs/PACE_ERP_UI_PATTERNS.md:51-120` but **no component found in `frontend/src`** (VERIFIED grep) | Build shared component once, or follow existing page-local criteria pattern (IN02/IN03) |
| H3 | Excel export | **EXTEND** | `frontend/src/shared/downloadColoredExcelFile.js` (style baseline, contract) | Multi-sheet exporter NEW |
| H4 | Scheduled close / carry-forward | **REUSE pattern** | `erp_procurement.auto_close_expired_procurement_plans()` | |
| H5 | AI provider | **REUSE** | `_core/ai/ai.provider.ts` (prompt ≤4000 chars, ≤1024 output tokens, usage returned) | Needs planning-scoped ACL route; smoke route is admin-only `skipAcl` (T10) |
| H6 | AI budget cap, usage ledger, audit, per-module quota | **NEW** | none (VERIFIED + `docs/AI-CORE-HAIKU-FOUNDATION.md`) | Hard prerequisite for any AI page |
| H7 | Communication/alerts | **REUSE pattern** | `po11CommunicationSurface.js`, `erp_communication.*` (0 rules DEV) | Optional later |
| H8 | Health / reconciliation guards | **REUSE pattern** | `scripts/*-guard.mjs`, `stock_health_check()` | Add planning no-write guard (PROPOSED) |
