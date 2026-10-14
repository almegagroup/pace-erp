# MTS Intelligent Procurement Planning — Technical Discovery (Step 1B)

Date: 2026-10-13, Step 1C update 2026-10-14 · Author: Claude Code (technical architect) · Tracks: almegagroup/pace-erp#649
Status: **DISCOVERY ONLY.** No migration, backend, frontend, PROD or DEV data change was made.
Next gate: ChatGPT business/functional reconciliation → business owner approval → implementation.

Companion files: `EXISTING-MODULE-REUSE-MATRIX.md`, `PAGE-DEPENDENCY-MAP.md`, `OPEN-TECHNICAL-QUESTIONS.md`.

## 0. Method and evidence labels

| Label | Meaning |
|---|---|
| **VERIFIED** | Read directly from PROD (`bsjpvkigpllichlknmah`) or DEV (`ytapuwiqicmvpanmzelb`) catalogue/data via read-only SQL on 2026-10-13, or from repository code at commit `571b225`. |
| **PROPOSED** | Technical recommendation by Claude. Not approved, not built. |
| **OPEN** | Cannot be decided from code/DB; needs business owner or ChatGPT reconciliation. Listed in `OPEN-TECHNICAL-QUESTIONS.md`. |

Row counts are `pg_stat_user_tables.n_live_tup` estimates unless stated as `count(*)`. All SQL was `SELECT`-only.

Sources read: `CLAUDE.md` (§3 15 bug patterns, §8A–8E), `docs/PACE_ERP_MASTER_CONSTITUTION.md` (Part 1B Rules 1–5, incl. Rule 5 "Planning views = Criteria → Execute → Results"), `docs/PACE_ERP_UI_PATTERNS.md`, `docs/BRANCH-WORKFLOW.md`, `docs/MTS-PLANNING-V1-CONTRACT.md`, `docs/MTS-PLANNING-PAGE-INVENTORY-AND-BUILD-SEQUENCE-2026-10-13.md`, `docs/AI-CORE-HAIKU-FOUNDATION.md`, `docs/FG-STO-MTS-DISPATCH-DESIGN-DOC.md`, feasibility doc §35.6 (PO11), §83.16, §138.

> The C0/C1 contract file named in #649 (`PACE_MTS_C0_C1_MASTER_IMPLEMENTATION_CONTRACT_2026-10-13.md`) is **not in the repository** (VERIFIED: `grep -rl PACE_MTS_C0 docs` → none). Its O-01…O-07 gates are carried into `OPEN-TECHNICAL-QUESTIONS.md` from the issue text only.

## 1. Headline findings

1. **No customer-plan / demand / forecast data model exists anywhere** (VERIFIED: no table matching `%forecast%`, `%demand%`, `%customer_plan%` in any schema on PROD). Rolling/Final/Additional/Urgent plans are **NEW REQUIRED**.
2. **`erp_production.plan_feed` is not an MTS demand source.** PROD: 502 FOs, party `fo_customer_type` = MTO_HPS 409 / MTEST 93 / **MTS 0**; `plan_feed_packing_order_allocation` against PMTS = 0; `sales_order_line.fg_type='MTS'` with `plan_feed_id` = 0 (VERIFIED). Reusing it would mix MTO order-feeds with MTS forecasts → double count risk (CLAUDE.md pattern #6-shape).
3. **ERP MTS production history is ~10 days long.** VERIFIED MTS process orders in PROD: 108 VERIFIED, production_date 2026-10-02 → 2026-10-12, companies CMP003 / CMP005 / CMP011. Any plan-vs-actual for earlier periods must come from historical Google Sheets/Excel → Historical Import is a hard prerequisite for comparison pages.
4. **MTS dispatch is not in `dispatch_reco`.** PROD `dispatch_reco` categories: PMTO 5192, PTEST 1345, PHPS 37, RPS 99 — **no PMTS** (VERIFIED). MTS dispatch actuals must come from `erp_procurement.sales_order_line` (`fg_type='MTS'`, 176 lines) / `sales_invoice_line` / `stock_ledger` P601/P602. **Step 1C:** none of these has posted MTS data yet — all 15 MTS SOs are CREATED, 0 P601/P602 and 0 invoice lines on PMTS SKUs; MTS SOs bill Asian Paints via `sales_order.bill_to_type` DEPOT/VDC (`fg_depot_code`/`fg_parent_company`), with `customer_id` NULL.
5. **PO11 is reusable as an engine pattern, not as the MTS planner.** `procurement_monthly_plan*` is a monthly reorder-point model (daily requirement = monthly ÷ days; safety + (processing + lead) × daily; netting Unrestricted − OPEN reservations + QA + TRN-CSN + open GE). It has no daily time-phasing, no PO/PO-lot open quantity, no stroke explosion (VERIFIED `planning.handlers.ts:1090-1250`).
6. **PO12 is no longer a Plant Transfer Order page.** VERIFIED `frontend/src/pages/dashboard/procurement/transfer/PlantTransferPage.jsx` header: PO12 = Tab 1 CRCP Discrepancy + Tab 2 Returnable Material Transfer; the Gate-23 PTO list is "no longer reachable", `erp_procurement.plant_transfer_order` = 0 rows PROD. The earlier note "PO12 maps to PTO" in `MTS-PLANNING-PAGE-INVENTORY…md` is **superseded** by this evidence.
7. **AC01 = "GRN Landed Cost Hub"** under resource `PROC_IV_LIST` (menu title still "Invoice Verifications"); separate AC03 `PROC_LC_LIST` "Landed Costs" page also exists. Atomic RPCs `erp_procurement.save_ac01_grn_cost` and `save_ac01_grn_cost_with_verification` (VERIFIED pg_proc). AC01 data is per GRN — usable for historical landed cost, not a forward cost forecast.
8. **Lead-time masters are vendor-level, not material-level.** `erp_master.lead_time_master_domestic(vendor_id, company_id, transit_days, effective_from/to)` 126 rows; `lead_time_master_import(vendor_id, port_of_discharge_id, sail_time_days, clearance_days, …)` 8 rows; no `material_id` column (VERIFIED). No vendor processing/production time field exists. Material-level planning fields **do** exist on `erp_master.material_plant_ext` (`safety_stock_qty`, `reorder_point_qty`, `min_order_qty`, `lead_time_days`) but PROD has only 10 rows and **0** with any of these populated (VERIFIED `count(*)`).
9. **Feeder-transfer rules are empty.** `erp_inventory.location_transfer_rule` (source_location_id, dest_location_id, transfer_type, active) = 0 rows PROD and DEV, and has no material/effective-date column (VERIFIED). The contract's "R003 → R001 Sodium Gluconate" rule has no stored representation today.
10. **Mother/Sub-CSN exists in code, unused in data.** Columns `consignment_note.is_mother_csn`, `mother_csn_id`; created by `csn.handlers.ts` `createSubCSNHandler` and automatically by `gate_entry.handlers.ts` `resolveCrossCompanyCsnLink` (CRCP partial GE). PROD: 294 CSNs, 0 mother/sub links (VERIFIED).
11. **AI infrastructure is a gated smoke test only.** `supabase/functions/api/_core/ai/ai.provider.ts` (Haiku, 4000-char prompt cap, max 1024 output tokens, 12s timeout) + `POST /api/ai/smoke-test` (`skipAcl: true`, admin + `AI_CORE_ENABLED` gate). **No usage ledger, no budget cap, no per-module quota, no persisted audit** (VERIFIED; also stated in `docs/AI-CORE-HAIKU-FOUNDATION.md` "Not implemented"). A hard budget cap is NEW REQUIRED before any planning AI feature.
12. **"Plant" = company in the current schema.** There is no plant table/`plant_id`; `storage_location_plant_map(storage_location_id, company_id, …)` and `material_plant_ext(company_id, …)` key "plant" by `company_id` (VERIFIED columns). The contract's `company_id + plant_id` must therefore map to company + storage-location (group) unless a new plant concept is approved (Q-T01).
13. **DEV is not representative.** DEV: 11 process orders, 0 `mts_packing_plan_row`, 0 `dispatch_reco`, 0 `purchase_order_lot`, 0 PO11 plans, 1 `mts_current_stroke` (VERIFIED). Realistic testing needs DEV fixtures or anonymised PROD-shaped seed data (OPEN — see Q-T07).

## 2. Area-by-area audit

### 2.1 Customer Rolling / Final / Additional / Urgent plans
- VERIFIED absent: no table/function/route. Customer master: `erp_master.customer_master` (PROD 1741) with `fo_customer_type` MTS 1426 / MTO_HPS 218 / MTEST 51 / null 46; `customer_company_map` 1741; `parent_customer_master` 0 PROD; FG depot structure `erp_master.fg_parent_company` 17, `fg_depot_code` 47 (PROD).
- Plan grain (customer × period × Prodshade vs SKU), revision semantics, Urgent basis: **OPEN** (Q-B01…B05).
- PROPOSED: new schema objects (header + immutable revision + line + import lineage) — see §4.

### 2.2 Production and dispatch actuals
- Production: `erp_production.process_order` (`po_type`, `status`, `production_date`, `batch_number_from/to`, `number_of_batches`, `mts_used_current_stroke`, `planned_loss_qty`), `process_order_line` (actual material consumed, `stock_ledger_id`), `process_order_line_reco`, `packing_order` (`po_type` PMTS 118 PROD), `mts_packing_plan_row` (118), `mts_batch_yield_variance` (1744), `mts_creation_snapshot` (113, jsonb page4/5/6 plans). VERIFIED.
- Existing read model: PR24 "MTS Production Register" — `GET /api/production/order-information-system/mts-register` (`PROD_ORDER_INFO_SYSTEM`/VIEW), `_core/production/mts_production_register.handlers.ts`, `frontend/src/pages/dashboard/production/MtsRegisterModal.jsx`. Row grain = FINAL Packing PO of VERIFIED MTS Process PO (CLAUDE.md §6, feasibility §143).
- Dispatch: `sales_order_line` (`fg_type`, `material_id`, `base_qty`, `pack_qty`), `sales_invoice(_line)`, `delivery_challan(_line)`, `stock_ledger` movement P601/P602 (bucket SALE_DISPATCH). STO FG/depot dispatch design is still open per `docs/FG-STO-MTS-DISPATCH-DESIGN-DOC.md` §2–3.
- Stock-ledger-based period aggregation already exists: `erp_inventory.get_stock_history(p_company_id, p_from_date, p_to_date, p_material_type_codes, p_material_ids, p_storage_location_ids)` → opening/closing/bucketed movements; every posted movement type in PROD is mapped in `stock_history_bucket_map` (VERIFIED: 0 unmapped). Used by IN14 `GET /api/procurement/stock-history` (`PROC_STOCK_HISTORY`).

### 2.3 Production estimates
- VERIFIED absent as stored data. Nearest artefacts: `mts_creation_snapshot` (per actual Process PO, not a forecast) and PO11's `monthly_requirement_qty` (manual, per RM/PM, ADMIX/HPS scope only — feasibility §35.6).
- NEW REQUIRED; distinction estimate vs customer plan vs management target is OPEN (Q-B06).

### 2.4 Prodshade, Stroke, SKU, Pack BOM
- Stroke: `stroke_master` (PROD 345; APPROVED/MTS 45; `revision_no`, `source_stroke_master_id`, `conversion_uom_code`, `conversion_factor`, `default_storage_location_id`), `stroke_line` (`material_id`, `alternate_material_id`, `material_group_id`, `dosage_pct`, `default_storage_location_id`), `stroke_po_type_applicability` (351), `stroke_change_request(_line)`.
- MTS default stroke: `erp_production.mts_current_stroke(company_id, prodshade_material_id, stroke_number, set_by, set_at)` — 40 rows PROD across 3 companies; **no effective-date window** (VERIFIED). Routes `GET/POST /api/production/mts-current-stroke` (`PROD_STROKE_MASTER`).
- Material substitutes: `erp_master.material_category_group` (58) / `_member` (132); `stroke_line.material_group_id`.
- SKU/pack: `prodshade_pack_config(material_id, pack_code_id, fill_qty, variant)` 476; `pack_code_master` (19, `outer_uom_code`, `bom_required`); `pack_bom(company_id, sku_material_id, status)` 482 / `pack_bom_line(line_type, material_id, qty, uom_code, material_group_id, is_primary_container)` 1407; `material_uom_conversion` 495.
- Requirement explosion logic already exists **per actual Process PO** in `_core/production/mts_creation_session.handlers.ts` (material plan, packing plan, PM auto-derive) and `save_mts_material_plan_atomic` RPC. It is transaction-coupled (commits a PO); a side-effect-free reuse needs extraction (PROPOSED, Q-T03).

### 2.5 Inventory, stock ledger, calibration
- `stock_ledger` (PROD 37,958; append-only rules), `stock_snapshot` (1085; blended, `batch_id` always NULL per CLAUDE.md §83.15), `reservation_document` (9852; `status`, `balance_qty`, `batch_number`), `stock_type_master` 6.
- IN03 current stock (`GET /api/procurement/current-stock`), IN02 ledger, IN14 history are reusable read paths.
- "Calibration" (book vs physical/planner opening) has no table. Physical inventory exists (`physical_inventory_document/item`, PROD 31/559) as the only physical-count source. Calibration history = NEW REQUIRED, must never write to ledger (consistent with contract).

### 2.6 Purchase Orders and PO lots
- `purchase_order` (243 PROD; `order_in_lot`, `expected_delivery_date`, `effective_start_date`, `cutoff_date`, `status`), `purchase_order_line` (`ordered_qty_base_uom`, `open_qty`, `line_status`, `unit_rate`, `currency_code`), `purchase_order_lot(po_line_id, lot_number, lot_qty, delivery_date, status, amendment_number)` 5 rows / 3 POs with `order_in_lot` (VERIFIED). Route `GET /api/procurement/po-lot-orders` gated `PROC_PO_CREATE`/EDIT.
- PO11 does **not** consume `open_qty` or lots today (VERIFIED §1.5).

### 2.7 CSN, Mother/Sub-CSN, STO
- `consignment_note` (294 PROD: DOMESTIC 280, IMPORT 14) with full ETA chain (`etd`, `scheduled_eta_to_port`, `eta_at_port`, `ata_at_port`, `eta_to_plant_calculated`, `transit_days_snapshot`), `status`, `pre_ge_status`, `dispatch_qty`, `total_received_qty`, `sto_id`, `sto_line_id`, `consignee_company_id`. `csn_field_history` 1507 gives ETA revision history.
- PO11 counts only `status='TRN'` CSNs joined via `purchase_order.company_id` — STO-origin CSNs are excluded from its in-transit (VERIFIED `planning.handlers.ts` TRN query).
- STO: `stock_transfer_order` (2 PROD, `sto_type` INTER_PLANT), `_line`, `_crcp_company`, approval via PO13.

### 2.8 PO12 / transfers
- PO12 (`PROC_PLANT_TRANSFER_LIST`, `/dashboard/procurement/transfer`) = CRCP Discrepancy + Returnable Transfer (VERIFIED). Legacy PTO handlers remain (`_core/procurement/pto.handlers.ts`: create/list/get/approve/one-step/issue/receive/cancel/`storageLocationTransferHandler`), table single-material header, 0 rows.
- Intra-company location movement = IN10 `PROC_LOC_TRANSFER_REQ` / IN11 `PROC_LOC_TRANSFER_POST` (`location_transfer_request/_line/_posting` PROD 42/130/129; RPC `complete_location_transfer_action`).
- Inter-company/plant = STO.

### 2.9 AC01 landed cost
- `_core/procurement/ac01.handlers.ts` (list/get/save GRN cost, deduction types); tables `landed_cost` (198), `landed_cost_line` (217; `cost_type`, `party_type`, `gst_treatment`, `entry_mode`, `percentage`), `landed_cost_deduction_line` (70). Per-GRN actuals; per-unit landed cost per vendor/material can be derived historically (formula OPEN — Q-B10). WAR does not consume landed cost (CLAUDE.md §111).

### 2.10 Vendor mapping, rates, lead time, payment terms
- `vendor_material_info` (127 PROD; `last_purchase_price`, `last_purchase_currency`, `last_grn_date`, `status`), `vendor_material_uom`, `vendor_material_currency`, `vendor_material_payment_term(is_default)`, `vendor_company_map` 226, `payment_terms_master` 18, `port_plant_transit_master` 5.
- No vendor capacity, MOQ, approved-share, or risk fields exist (VERIFIED by column list). Vendor sourcing policy = NEW REQUIRED.

### 2.11 AI infrastructure and budget control
- See §1.11. Routing: `_pipeline/protected_routes.dispatch.ts:33`. Model constant `claude-haiku-5-5` in provider. Budget/usage ledger: NEW REQUIRED.

## 3. Transaction ownership (who may write what)

| Data | Owner (existing) | Planning may… |
|---|---|---|
| `stock_ledger` / `stock_snapshot` | `post_document` / `post_stock_movement` (CLAUDE.md §8C/§8D) | Read only. Never post. |
| PO / PO lot | PO01/PO14 handlers, PO13 approval | Read; emit *proposal* only. |
| CSN / Sub-CSN | PO02 CSN Tracker, GE handlers | Read only. |
| STO | PO07 + PO13 | Read; proposal only. |
| Location transfer | IN10/IN11 | Read; proposal only. |
| Stroke / current stroke | PR01/PR02 + `mts_current_stroke` | Read; planning-scenario override stored separately (contract). |
| Pack BOM | PR05–PR08 | Read only. |
| AC01 cost | AC01 RPC | Read only. |
| Customer plan, estimates, scenarios, calibration notes, AI usage | **none today** | New planning-owned tables (PROPOSED). |

## 4. Historical Sheets + future ERP entries in one canonical model (PROPOSED)

Constraints observed: no lineage tables exist; ERP actuals only from 2026-10-02 for MTS; contract forbids importing ambiguous formulas verbatim.

PROPOSED shape (names illustrative, final DDL after business sign-off):
- `plan_header` (company_id, customer_id, plan_period, plan_type ∈ ROLLING/FINAL/ADDITIONAL/URGENT — enum OPEN, current_revision_id).
- `plan_revision` (append-only; revision_no, effective_at, entered_by, **source_system ∈ ERP_ENTRY / SHEET_IMPORT**, import_batch_id NULL for ERP entry, supersedes_revision_id, reason).
- `plan_line` (revision_id, material_id → Prodshade or SKU per Q-B02, quantity, uom_code, base_qty, delivery bucket).
- `plan_import_batch` (file name, sheet/tab, checksum, uploaded_by, status DRAFT/VALIDATED/COMMITTED/REJECTED) and `plan_import_row` (raw jsonb, row fingerprint = hash(company, customer key, period, item key, plan_type, qty), mapped ids, validation errors). Commit converts validated rows into `plan_revision(source_system='SHEET_IMPORT')`.
- Uniqueness on (fingerprint) prevents duplicate re-import; unresolved customer/item keys stay in staging, never auto-create masters.
- One register query reads both sources; a "source" column shows ERP vs Sheet + batch.
- Absent historical Rolling must be stored as *absent* (no synthetic row) — consistent with page-inventory doc item 1.

## 5. Cross-cutting rules every new page must satisfy (VERIFIED from repo rules)
- ACL: new resource codes in `erp_menu.menu_master` + `acl.menu_master` + live `capability_menu_actions` + **new `acl_versions` row** before capture (CLAUDE.md §8 second correction) + ACL-MASTER (P0076) check + `route-acl-registry.ts` entry per route (pattern #8).
- Company scope: `assertCompanyScope()`; UI company via `TransactionCompanySelector` / `useMenu().runtimeContext.availableCompanies` — never `/api/admin/companies` (pattern #2/#11).
- No hardcoded role arrays (pattern #1/#12); guards in `scripts/*-guard.mjs` run in CI.
- `fetchInChunks` for unbounded `.in()` (§8E); batch independent reads (§8B).
- Planning pages = criteria → execute (Constitution Rule 5; `ErpSelectionScreen` is only specified in `docs/PACE_ERP_UI_PATTERNS.md`, not present in `frontend/src` — VERIFIED); `useQuery` only (Rule 2); no raw UUIDs (Rule 1).
- Migration integrity + `NOTIFY pgrst, 'reload schema'` after every DEV apply (§8A).
- New schema (if any) must be added to PostgREST exposed schemas in both Dashboards (§8).

## 6. What was not verified
- Google Sheets source structure (no file in repo) — Q-B01.
- PROD RLS policies on candidate tables (not inspected; all API writes use service role per existing pattern).
- Whether business "plant" means company, a storage-location group (as PO11's `planning_sloc_group` does), or a physical site spanning companies — Q-T01.

## 7. Step 1C update (2026-10-14)

Owner decisions B01–B14 and T01–T07 were reconciled against PROD (read-only) and code. Full table: `OPEN-TECHNICAL-QUESTIONS.md` §1C. Summary of what changed in this discovery:

| # | Finding | Evidence | Status |
|---|---|---|---|
| 1 | Asian Paints is not in `customer_master`; MTS billing identity is `fg_parent_company` / `fg_depot_code` via `sales_order.bill_to_type` DEPOT/VDC | PROD SELECT; 15 MTS SOs with `customer_id` NULL | CONFLICT with B04 wording → owner confirm key |
| 2 | No MTS dispatch has been posted yet (0 P601, 0 invoice lines) | PROD SELECT | GAP for B08 plan-vs-actual |
| 3 | SKU↔Prodshade has no FK; production uses name/code match (`resolveSkuMaterial`, `mts_creation_session.handlers.ts:288`); 59/59 go-live pairs unique today | PROD SELECT + code | Technical risk; per-run uniqueness check |
| 4 | 9 of 22 CMP005 MTS SKUs have no ACTIVE company Pack BOM | PROD SELECT | Data GAP (PM requirement missing) |
| 5 | R/S/P SLoc codes span PUTTY (001), TLA (002), ADMIX (003); no segment attribute; `production_segment_location_config` empty | PROD SELECT | CONFLICT with T01 "R+S / P" as written → MTS SLoc eligibility map |
| 6 | "Primary item" in groups: `member.is_primary` used 3 times in total; `alternate_material_id` unused in MTS strokes | PROD SELECT | CONFLICT (definition) for B09 |
| 7 | Book Opening must be a strict ledger sum, and must be stored at capture because back-dated postings exist (667 in 30 days) | PROD SELECT, `get_stock_history` source | B12 implementation rule |
| 8 | 41/75 ORD CSNs have no ETA to plant | PROD SELECT | T05: UNKNOWN-ETA presentation needed in owner spec |
| 9 | `po_line_available_qty` / `po_lot_balances` exist in PROD and implement GE-not-GRN netting | PROD `pg_proc` | T06 source confirmed |
| 10 | No receivable/collection table; USD POs without FX source; AC01 has DRAFT rows | PROD catalogue + SELECT | B10 GAP |
| 11 | Pack BOM PM rows are `line_type='INPUT'` | PROD SELECT | Correction to wording elsewhere |
| 12 | Procurement group `GRP_ACL_PROCUREMENT` verified; free tx codes PO15, PO20+ | PROD menu | T08 still OPEN |

Owner instruction recorded: the business owner designs every Planning page; all pages go under the Procurement menu group; T08 codes and page count stay OPEN; `PAGE-DEPENDENCY-MAP.md` is provisional and not approved.

## 8. Step 1C closure — verified technical evidence (2026-10-14)

Owner resolutions recorded on 2026-10-14 (B04, T01/B09 location, B09 RM primary, B09 PM artwork) were verified against code and read-only PROD. Full detail and labels: `OPEN-TECHNICAL-QUESTIONS.md` § "Step 1C Closure".

**Decisions (owner, authoritative):** company-wise Asian Paints plans with no Dispatch distribution key; required location derived from MTS Stroke / Pack BOM, with stock elsewhere shown as transfer suggestions; RM primary = original material on the effective Stroke line, with Use Primary Yes/No; PM groups have no Use Primary toggle and use date-wise authorised artwork allocation.

**Verified facts:**

| Topic | Fact | Evidence |
|---|---|---|
| RM required SLoc | `stroke_line.default_storage_location_id`; 406/408 go-live MTS lines populated | `process_order.handlers.ts:3231-3309`; PROD SELECT |
| PM required SLoc | `pack_bom_line.storage_location_id` (`line_type='INPUT'`); 224/224 populated; segment fallback table empty | `mts_creation_session.handlers.ts:391-418, 436`; PROD SELECT |
| Usable stock | UNRESTRICTED snapshot at SLoc − reservations `OPEN`/`PARTIAL` at SLoc; machine buckets are a split, not additive | `mts_creation_session.handlers.ts:22, 420`; `process_order.handlers.ts:563` |
| Primary RM | formulation material = `stroke_line.material_id`; `member.is_primary` never read | `process_order.handlers.ts:302-332, 651`; `mts_creation_session.handlers.ts:376-389` |
| Group allocation once | standard qty allocated once; pool decremented across groups | `process_order.handlers.ts:651, 3283-3292` |
| PM artwork | old/new pairs exist only as names in groups; no artwork, approval, effective or phase-out data; BARREL group is a size alternative | PROD SELECT; no `artwork` reference in code |
| Dispatch reconciliation | company = `sales_order.company_id`, SKU = `sales_order_line.material_id`, qty = posted P601 − P602 / POSTED invoice; STO-billed invoices excluded | PROD columns |
| SO quantity | MTS DD lines with 20,000,000 KG ceilings — not demand or dispatch | PROD SELECT |
| Inbound location | 129/129 open PO lines `receiving_location_id` NULL; no default GRN location; GRN location chosen at GRN | PROD SELECT; `grn.handlers.ts:993` |
| PO vs CSN | 1 open PO line where open CSN qty > PO available; inbound must be capped at PO-side available | PROD SELECT using `po_line_available_qty()` |

**Known data / master-data gaps:** 2 RM stroke lines without location; 9 CMP005 SKUs without Pack BOM; no SLoc transfer lead time; production does not check group-member `active` or material status; artwork authorisation not represented; no posted MTS dispatch; no collections/FX source.

**Assumptions (PROPOSED, not approved):** inbound expected location = last posted GRN location, labelled INFERRED; zero-day SLoc transfer lead time, stated in output; inactive members excluded by planning.
