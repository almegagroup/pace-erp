# MTS Planning — Open Questions (Step 1B)

Date: 2026-10-13 · Owner of answers: business owner via ChatGPT reconciliation (`agent/chatgpt`), technical items by Claude.
Coordination: `docs/mts-planning/COLLABORATION-PROTOCOL.md` on `agent/chatgpt` (read 2026-10-13). This file feeds the joint `DECISION-REGISTER.md`.
Nothing below is decided. "Blocks" = earliest step in `PAGE-DEPENDENCY-MAP.md` §3 that cannot start without an answer.

## B — Business / functional (ChatGPT + business owner)

| ID | Question | Why it matters (evidence) | Blocks |
|---|---|---|---|
| Q-B01 (=O-01) | Exact historical Sheets/Excel sources: file, tab, columns, sample rows, and how Rolling/Final/Additional/Urgent and their revisions appear | No source files in repo; C0/C1 contract file from #649 also not committed (`grep` → none) | Step 1 DDL, Step 2 |
| Q-B02 (=O-02) | Plan grain: customer × month × **Prodshade** or **SKU** (pack-level)? Per depot / parent customer? Quantity unit (KG, litre, outer pack)? | SKU→Prodshade via `prodshade_pack_config`; IWC uses litre via `stroke_master.conversion_factor`; depots in `fg_depot_code` | Step 1 |
| Q-B03 (=O-03) | Urgent plan: re-prioritisation only, net-new demand, or either (flag)? What does it reference (an earlier revision / date)? | Protocol scope says "can be re-prioritisation without net new demand" — needs a stored flag to avoid double count | Step 1 |
| Q-B04 (=O-04) | Customer & item mapping for Sheet names; behaviour for unmatched rows (stage & reject vs create master) | `customer_master` 1741 PROD, `fo_customer_type` null for 46 | Step 2 |
| Q-B05 (=O-05) | Who may create / revise / approve / cancel plans, estimates, scenarios and proposals? Approval needed or entry = final? | ACL must be resource+action, no hardcoded roles (CLAUDE.md #1/#12) | Step 1 ACL |
| Q-B06 | Is "Production Estimate" a separate document from customer plan and management target, and at which grain? Separate page or tab? | Contract separates forecast components; nothing stored today | Step 3 |
| Q-B07 | Inter-company / inter-plant transfer proposals should target **STO (PO07)** or the dormant **PTO** (`plant_transfer_order`, 0 rows; PO12 now = CRCP + Returnable)? | `PlantTransferPage.jsx` header; earlier inventory doc assumed PO12 = PTO | Step 8 |
| Q-B08 | Does MTS FG reach customers via depot STO (FG STO) as well as direct SO? Which counts as "dispatch actual" for plan-vs-actual? | `dispatch_reco` has no PMTS; `FG-STO-MTS-DISPATCH-DESIGN-DOC.md` §2–3 still open | Step 4 |
| Q-B09 | Substitute selection rule inside a material group (priority, ratio, approval) during explosion | `stroke_line.material_group_id`, `alternate_material_id`; contract says "no double count formulation vs actual" | Step 5 |
| Q-B10 | Landed-cost per unit formula for commercial comparison (which AC01 cost types, GST/ITC handling, currency) | `landed_cost_line.cost_type/gst_treatment/party_type`; WAR does not include landed cost (CLAUDE.md §111) | Step 9 |
| Q-B11 | Authoritative safety-stock / lead-time / MOQ source: `material_plant_ext` (0 populated), PO11 plan-line fields, vendor lead-time masters, or new policy table? | Three partial sources exist (EXISTING-MODULE-REUSE-MATRIX G4/G6) | Step 7 |
| Q-B12 | Calibration: what is compared (book vs physical count vs planner's Sheet opening), and who approves a calibration entry? | Only PID documents hold physical counts | Step 6 |
| Q-B13 | Monthly AI budget amount, who can raise it, behaviour when exhausted | No ledger exists | Step 10 |
| Q-B14 | Which companies are in MTS planning scope at go-live? (PROD MTS POs exist for CMP003, CMP005, CMP011; `mts_current_stroke` in 3 companies) | Scope of ACL rollout + test data | Step 1 ACL |

## T — Technical (Claude to resolve, may need owner confirmation)

| ID | Question | Current evidence | Proposed default |
|---|---|---|---|
| Q-T01 | Meaning of `plant_id` in the contract — schema has no plant entity; plant = `company_id` in `storage_location_plant_map` and `material_plant_ext` | VERIFIED columns | Use company + optional planning SLoc group (PO11 `planning_sloc_group`) unless business defines a physical-site concept |
| Q-T02 | Reuse PO11 `planning_sloc_group` / `planning_item_group` for MTS or create MTS-specific grouping? | PO11 tables are ADMIX/HPS-scoped (§35.6) but company-generic in shape | Reuse read-only for SLoc pools; keep MTS plan data separate |
| Q-T03 | Extract a side-effect-free requirement explosion from `_core/production/mts_creation_session.handlers.ts` (+ `save_mts_material_plan_atomic`) | Logic is coupled to PO creation | Extract pure functions + parity tests on real VERIFIED POs; do not change PR09 behaviour |
| Q-T04 | New schema (`erp_planning`) vs tables in `erp_production` | New schema requires PostgREST exposure in DEV+PROD Dashboards (CLAUDE.md §8) | Owner decision; new schema is cleaner for no-write guard scoping |
| Q-T05 | CSN status semantics for "planned / confirmed / dispatched / received" mapping | PO11 counts only `status='TRN'`; `pre_ge_status`, ETA fields exist; full enum not yet captured | Capture CHECK constraints + live distribution before Step 7 |
| Q-T06 | Dedupe rule PO open qty ↔ PO lots ↔ CSN dispatch ↔ Sub-CSN ↔ GE so one inbound unit is counted once | 0 mother/sub links in PROD; lots on 3 POs | Hierarchy: GE(open) > CSN in transit > lot > PO open remainder; verify with business |
| Q-T07 | DEV fixtures: DEV has 0 `mts_packing_plan_row`, 0 `dispatch_reco`, 0 lots | VERIFIED counts | Synthetic DEV seed via migration-free MCP script, never PROD copy of personal data |
| Q-T08 | Tx-code prefix and menu group for planning pages (`MP##`? under `GRP_ACL_PROCUREMENT` or a new group?) | PO11 sits in procurement | Owner decision |
| Q-T09 | `GET /api/procurement/po-lot-orders` is gated `PROC_PO_CREATE`/EDIT — planning viewers need a VIEW-level path | `route-acl-registry.ts:64` | New planning-scoped read endpoint, not loosening PO create ACL |
| Q-T10 | AI provider prompt cap is 4000 chars, output ≤1024 tokens; enough for scenario explanations? | `_core/ai/ai.provider.ts` | Summarise deterministic outputs server-side before sending |
| Q-T11 | `ErpSelectionScreen` is specified but not built | `docs/PACE_ERP_UI_PATTERNS.md:51-120`; not in `frontend/src` | Build once as shared component in Step 1 or follow IN02/IN03 page-local pattern |
| Q-T12 | Performance of 180-day × material daily projection | Planning reads ledger/snapshot; §8E chunking; PROD ledger ~38k rows | Server-side SQL function returning compact arrays; virtualised grid |

## Corrections to earlier repo notes (for the Decision Register)
1. `MTS-PLANNING-PAGE-INVENTORY…2026-10-13.md` "PO12 maps to Plant Transfer Order (PTO)" — **superseded**: PO12 is now CRCP Discrepancy + Returnable Transfer; PTO list is unreachable (`frontend/src/pages/dashboard/procurement/transfer/PlantTransferPage.jsx`).
2. Same doc "AC01 is GRN landed-cost hub" — **confirmed**, with nuance: menu title/resource are still "Invoice Verifications"/`PROC_IV_LIST`; a separate AC03 `PROC_LC_LIST` Landed Costs page also exists.
3. `MTS-PLANNING-V1-CONTRACT.md` "reuse `location_transfer_rule`" — table has 0 rows and no material/effective-date columns; feeder rules need a new structure.
