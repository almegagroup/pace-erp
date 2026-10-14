# MTS Planning — Technical Page Inventory & Dependency Map

> **⚠️ PROVISIONAL — NOT APPROVED (status updated 2026-10-14, Step 1C).** The business owner will design and define every Planning page personally. This file is a **technical dependency aid only**: it does not define, merge or finalise any page, and the `MP##` / `PLAN_*` labels are **withdrawn** as code proposals. All Planning pages will sit under the Procurement menu group (`GRP_ACL_PROCUREMENT`); tx codes and page count stay OPEN (T08). The dependency facts (which source tables, services and DB units each capability needs) remain valid inputs for when the owner's page specs arrive. Step 1C blockers are listed in `OPEN-TECHNICAL-QUESTIONS.md` §1C.3.

Date: 2026-10-13 · Status: **PROPOSED** (technical), awaiting ChatGPT business reconciliation.
This does **not** treat the earlier 19-workspace list (`docs/MTS-PLANNING-PAGE-INVENTORY-AND-BUILD-SEQUENCE-2026-10-13.md`) as the final menu. Each workspace there is mapped below to a proposed page, a tab/drawer of another page, or a backend-only service. Tx codes and resource codes are placeholders (`MP##`, `PLAN_*`) until approved — the `MP` prefix itself is OPEN (Q-T08).

## 1. Proposed page inventory

Legend — Mode: M manual / S semi-auto / A auto. Type: PAGE (menu node, own ACL resource) · TAB (inside a page, shares its resource unless noted) · SVC (backend calculation, no UI of its own) · EXISTING (reuse existing page).

| ID | Proposed page / unit | Type | Maps to old WS # | Mode | Reads (VERIFIED sources) | Writes (NEW, planning-owned only) | Hard deps |
|---|---|---|---|---|---|---|---|
| MP01 | Customer Plan Register | PAGE | 01, 05(part) | S | NEW plan tables; `customer_master`; `material_master` | — | MP-DB1 |
| MP01-T1 | Plan Entry & Revision (multi-row editor) | TAB/drawer of MP01, own WRITE action | 02 | M | same | plan header/revision/line | MP-DB1 |
| MP02 | Historical Import & Validation | PAGE | 03 | S | staging tables, masters | import batch/rows; commits into plan revisions | MP-DB1, MP-DB2, O-01 Sheets mapping |
| MP03 | Production Estimate Entry | PAGE (or TAB of MP01 — OPEN Q-B06) | 04 | M | MP01 data, `process_order` MTS actuals | estimate revision/lines | MP-DB3 |
| MP04 | Plan vs Actual & History | PAGE (report, criteria-first) | 05, 19 | A | plans, estimates, `process_order`/`packing_order` (MTS), `sales_order_line`/`sales_invoice_line` (fg_type MTS), `stock_ledger` P601 | — | MP01–MP03, SVC-ACT |
| MP05 | Production Schedule Scenario | PAGE | 06 | S | estimates, `machine_master`/`machine_po_type_map`, `shift_master`, open MTS `process_order` | scenario + daily prod lines | MP-DB4 |
| MP05-T1 | Stroke/Formulation Scenario | TAB of MP05 | 07 | S | `mts_current_stroke`, `stroke_master/_line`, `material_category_group*` | date-effective planning override (never touches master) | MP-DB4 |
| SVC-REQ | Requirement explosion (RM via stroke, PM via Pack BOM) | SVC | 08 | A | `stroke_line`, `pack_bom(_line)`, `prodshade_pack_config`, `material_uom_conversion` | cached run result (optional) | extraction from `mts_creation_session.handlers.ts` (Q-T03) |
| MP06 | Book Stock & Calibration | PAGE | 09 | S | `get_stock_history`, `stock_snapshot`, `reservation_document`, PID docs | calibration entries (no ledger write) | MP-DB5 |
| MP07 | Material Daily Projection (single/consolidated) | PAGE | 10, 11 | S | SVC-REQ, MP06, open PO/lots, CSN, GE, STO | saved what-if versions | SVC-REQ, SVC-SUP, MP06 |
| SVC-SUP | Inbound supply normaliser (PO open qty, lots, CSN + Mother/Sub, GE, STO, bulk arrival) | SVC | 12, 13 (data part) | A | `purchase_order_line`, `purchase_order_lot`, `consignment_note`, `csn_field_history`, `gate_entry_line`, `stock_transfer_order_line` | — | Q-T05 status semantics, Q-T06 dedupe |
| MP08 | Supply Adjustment Proposals (prepone/defer/bridge, CSN/STO allocation) | PAGE | 12, 13 | S | MP07, SVC-SUP | proposals only | MP07 |
| MP09 | Transfer & Alternative Decision | PAGE (or TAB of MP08) | 14 | S | `location_transfer_request*`, STO, feeder rules, `material_category_group*` | feeder rule (NEW) + proposals | MP-DB6, Q-B07 |
| MP10 | Safety Stock & Vendor Sourcing Policy | PAGE (master-like) | 15 | M/S | `material_plant_ext`, lead-time masters (PO11 config excluded per T02), `vendor_material_info` | policy rows with effective history | Q-B11 |
| MP11 | Vendor Share & Commercial Analysis | PAGE (report) | 16 | S | AC01 `landed_cost*`, `purchase_order_line.unit_rate`, `payment_terms_master`, `vendor_material_payment_term` | — | MP10, Q-B10 |
| MP12 | Scenario Review & Decision Log | PAGE | 18 | S | all proposal tables | approve/reject decisions (no transaction posting) | MP08/MP09, approval authority Q-B05 |
| SVC-AI | AI explanation / scenario assistant | SVC + contextual panel on MP04/MP07/MP08 | 17 | A/S | redacted deterministic outputs only | usage ledger | **AI budget ledger + hard cap (NEW)** |
| EX-PO11 | ADMIX/HPS Procurement Planning | EXISTING (unchanged) | — | — | `procurement_monthly_plan*` | — | must stay separate (contract) |
| EX-IN03/IN14/PR24/PO02 | Current Stock / Stock History / MTS Register / CSN Tracker | EXISTING (drill-through targets) | — | — | — | — | — |

Proposed DB units (all NEW, DEV-first, migration files): **MP-DB1** plan header/revision/line · **MP-DB2** import batch/row staging · **MP-DB3** estimate revision/line · **MP-DB4** scenario + schedule + stroke override · **MP-DB5** calibration entries · **MP-DB6** feeder rule (material + effective dates) · **MP-DB7** proposals/decisions · **MP-DB8** AI usage ledger + budget. Schema placement (`erp_planning` new schema vs `erp_production`) is OPEN (Q-T04); a new schema needs PostgREST exposure in both Dashboards (CLAUDE.md §8).

## 2. Dependency graph

```
Masters (REUSE): customer_master, material_master, stroke_*, mts_current_stroke, pack_bom*, prodshade_pack_config
        │
MP-DB1 ──► MP01 Register ──► MP01-T1 Entry
   │            ▲
MP-DB2 ──► MP02 Import ──┘ (commits revisions)
        │
MP-DB3 ──► MP03 Estimate
        │
SVC-ACT (production + dispatch actual read model) ──► MP04 Plan vs Actual
        │
MP-DB4 ──► MP05 Schedule ──► MP05-T1 Stroke scenario
                                  │
                           SVC-REQ explosion
                                  │
MP-DB5 ──► MP06 Calibration ──────┤
SVC-SUP inbound supply ───────────┤
                                  ▼
                        MP07 Daily Projection
                                  │
MP-DB6/7 ──► MP08 Supply proposals ─► MP09 Transfers/Alternatives
                                  │
MP10 Policy ──► MP11 Commercial   │
                                  ▼
                        MP12 Decision log
MP-DB8 + hard cap ──► SVC-AI (panels on MP04/MP07/MP08)
```

## 3. Proposed implementation sequence (each step = one DEV-tested PR, PROD untouched until release gate)

| Step | Unit | DEV migration | Backend | Frontend | Tests / evidence | Gate before next |
|---|---|---|---|---|---|---|
| 0 | Business reconciliation | — | — | — | ChatGPT + owner answer Q-B01…B06, Q-T01, Q-T04, Q-T08 | **STOP here now** |
| 1 | MP-DB1 + MP01/MP01-T1 | header/revision/line, constraints, indexes | list/detail/create/revise, `assertCompanyScope`, registry entries | register + editor | revision immutability, company denial, no overwrite | ACL 4-step on DEV, P0076 check |
| 2 | MP-DB2 + MP02 | staging + fingerprint unique | preview/dry-run/commit (atomic RPC) | mapping/reject grid | re-import idempotent; absent Rolling stays absent; 3 sample periods reconciled (contract) | Sample Sheets supplied |
| 3 | MP-DB3 + MP03 | estimate tables | create/revise | grid | separation from customer plan | Q-B06 |
| 4 | SVC-ACT + MP04 | none (read model) or SQL function | actual aggregation (`fetchInChunks`) | criteria-first report | numbers tie to PR24 / IN14 | — |
| 5 | MP-DB4 + MP05/T1 + SVC-REQ | scenario/override | pure explosion extracted & unit-tested against `mts_creation_session` outputs for real VERIFIED POs | schedule grid | explosion parity test | Q-T03 |
| 6 | MP-DB5 + MP06 | calibration | book stock via `get_stock_history` | grid | no ledger write (guard) | — |
| 7 | SVC-SUP + MP07 | saved versions | supply normaliser | 180-day grid (virtualised) | Mother/Sub no double count; performance on PROD-size seed | Q-T05/T06 |
| 8 | MP-DB6/7 + MP08/MP09 | rules/proposals | proposal APIs (no PO/CSN/STO writes) | grids | planning no-write guard script | Q-B07 |
| 9 | MP10/MP11 | policy | read models | grids | — | Q-B10/B11 |
| 10 | MP-DB8 + SVC-AI | usage ledger, cap | atomic budget reservation before provider call | contextual panels | cap enforced under concurrency | owner approves budget |
| 11 | MP12 + UAT | decisions | — | — | UAT script | — |
| R | PROD release (per step or batch) | `supabase db push` via normal flow, integrity check `in_sync=true`, `NOTIFY pgrst` | deploy | deploy | PROD ACL 4-step, exposed schema check | owner approval each time |

Branching: per `docs/BRANCH-WORKFLOW.md`, Claude works on `agent/claude`; promotion to `dev`/`main` only on owner instruction.

## 4. Planning no-write invariant (PROPOSED)
A new `scripts/planning-no-write-guard.mjs` (Playbook pattern, CLAUDE.md §3) should fail CI if any file under the planning handler folder calls `post_stock_movement`/`post_document` or writes to `purchase_order*`, `consignment_note`, `stock_transfer_order*`, `location_transfer_*`. Enforces contract step 7 mechanically.

## 5. Technical dependencies added at Step 1C closure (2026-10-14) — still PROVISIONAL

These are data dependencies only. They do not define pages.
- **Required-location dependency:** any requirement, projection or transfer calculation depends on `stroke_line.default_storage_location_id` (RM) and `pack_bom_line.storage_location_id` (PM), plus `stock_snapshot` and `reservation_document` (`OPEN`/`PARTIAL`) per SLoc. No R/S/P list.
- **Inbound-location dependency:** inbound supply has no recorded arrival SLoc; it depends on last posted `goods_receipt.storage_location_id` per company + material (INFERRED) until PO lines carry `receiving_location_id`.
- **PM allocation dependency:** artwork-aware allocation depends on the owner's §C7 decision in `OPEN-TECHNICAL-QUESTIONS.md`. Without it only active-member allocation is possible.
- **Actual-dispatch dependency:** plan-vs-actual depends on posted P601/P602 / POSTED invoices; none exist yet for MTS.
- **No Dispatch keys:** company plans do not depend on `fg_parent_company` / `fg_depot_code` (owner B04).
