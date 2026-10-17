# PACE ERP — PO22 Phase 2D: Final Optimizer and Store Instruction Contract

**Status:** DESIGN / IMPLEMENTATION HANDOFF ONLY — not authorization to modify code or data.  
**Prepared:** 17 October 2026  
**Repository:** `almegagroup/pace-erp`  
**Baseline:** Phase 1 audit; Phase 2B architecture at commit `d2e6c3b305e3786954d081b1a54857126ee7a024`; owner decisions through 17 October 2026; read-only Supabase PROD source checks.  
**Scope:** CMP003, CMP005, CMP011, and later MTS companies under one company-configured engine.

## 1. Decision and non-negotiable boundaries

PO22's existing **Current Month (CM)**, **Next Month (NM)**, Target/Critical policies, approved `NM Req Days = min(NM days, max(0, Target Days − CM Days Left))`, PO21 effective demand and `buildRequirementRows()` remain **unchanged**. Do not change existing calculations or tests to implement optimization. The optimizer is an additive deterministic layer, consuming a reproducible snapshot of those source facts and generating **advisory** recommendations; never create a PO, CSN, GRN, reservation, transfer posting or issue. It cannot mutate manual settings. Changes in scenario trigger another **user-initiated** run, not an obligatory auto-trigger.

The key separation is:

1. **Current-stock-backed Store instruction:** only currently physically posted eligible, unrestricted **R+S** stock net of existing valid reservations, respecting material-specific exclusive protection and the competition among all groups. No future arrival becomes executable solely because it has an ETA.
2. **Forward procurement/coverage projection:** the same allocation strategy and CM+NM demand plus actual current stock, existing open PO/GE/CSN/lot supply by evidence-backed arrival, proposed purchases and split delivery lots; output planned coverage, exposure dates, new PO qty and possible future allocation scenarios. These are *not* instructions to consume unreceived stock.
3. **R→R advisory redistribution:** optional location-level suggestions without scheduling or generating R→S/S→S activity. Physical R→S movements remain entirely with Store/Plant operators.

No part of the model assumes a material will be physically available earlier than a posted receipt date. Pending/unknown ETA is not on-time confirmed stock. A source fact is not duplicated between posted stock and future supply.

## 2. Owner-approved operational workflow

1. Procurement user chooses one company and runs PO22 planning (generally every fortnight; a run can be requested at any time).
2. Optimizer takes the **remaining CM + entire NM** demand already determined by PO22. The Store report covers these periods, not an arbitrary fixed 15-day calculation horizon. The 15-day cadence is how often Procurement normally shares the report.
3. Solver jointly assigns current available materials to fixed/exclusive source demands and flexible RM/PM group pools, respecting dated priorities and preserving residual physical inventory. It uses the existence and expected arrival dates of PO/CSN to choose a sensible current-stock mix and identify future risk, **without issuing future materials for immediate Store use**.
4. Procurement receives: material-wise consumption and shortage; product-wise Store instructions for current physical stock; group-wise and material-wise summaries; R→R suggestions; purchase recommendation / proposed split deliveries; coverage gaps and commercial caveats.
5. Procurement shares a **human-readable product-wise Store report** with the relevant company's Store; users follow the applicable product line when the production mix changes. There is **no mandatory report approval, acknowledgement, deviation-enforcement, revision-chain or automatic change-notification workflow**. Previous run snapshots remain available for traceability; if the user reruns, the newly generated report is the updated view.
6. Actual Stores/Production issue and R→S transfer remain operational responsibilities. New posted receipts, issues, transfers, PO/CSN ETA or cost changes only affect a newly run plan.

**Important operational interpretation:** A CM+NM report can show *planned needs for both months*, but an **executable quantity** is constrained to the physically held stock at the run snapshot. The future portion not yet physically backed appears as `PROJECTED / NOT YET EXECUTABLE` or `UNCOVERED`, never as an instruction to consume it. Instructions must distinguish product scheduling demand from guaranteed ability to supply all possible product switches: a single shared quantity cannot be promised in full independently to multiple mutually competing production alternatives.

## 3. Demand, exclusivity and joint allocation

**Grain:** `(company, run, effective PO21 product/ProdShade/SKU, formulation source line, material group or fixed material, requested consumption period/date, base UOM)` with immutable source IDs. A single effective source line/day yields **either** `FIXED_EXCLUSIVE` **or** `GROUP_POOL`, never both. A fixed direct material is not re-added from an exclusive-policy row. The policy qualifies/protects its *existing* line demand rather than creating a duplicate amount.

- RM `Use Primary = No`: candidate set is active members of that source's group only; uncovered demand remains owned by `GROUP_POOL` with no fabricated material ID.
- RM `Use Primary = Yes`: primary identity and effective formulation evidence preserved; alternate eligibility follows the approved formulation semantics, not arbitrary UUID/lexical assignment.
- PM alternative groups come from effective Pack BOM; no RM primary toggle imposed on PM.
- Group members are technically eligible for consumption within their valid group/date. Monthly six-month material **selection gates only new tentative procurement**; deselection never invalidates existing stock, previously ordered inbound or valid consumption.
- Every material appearing in multiple groups, plus fixed/exclusive lines, competes over **one conservation state** by material and date. Fixed/exclusive non-substitutable demand is safeguarded by its required dates and credible arrivals. Do not permanently lock a static quantity without date context. Historical actual material usage is optional optimization evidence, **not fixed mix percentages**.
- Feasibility/shortage is explicit when production cannot be covered. Do not silently reduce an exclusive requirement, apply a false material allocation, or describe unallocated group demand as a vendor-specific purchase.

**Time-phased conservation (conceptual):** `closing[m,t] = opening[m,t] + actual_valid_posted_receipts[m,t] − allocated_consumption[m,t]` for executable snapshot planning; a separate scenario balance may add `dated_inbound[m,t]` and proposed deliveries **only on their projected dates**. Material totals, per-product allocations, protected exclusive use, remaining stock and all group allocations must reconcile exactly. Both demand and inventory must share a canonical base UOM; missing L→KG or pack conversion is an explicit exception, not zero quantity.

**Critical vs Target:** Production stoppage/fixed-demand shortage, Critical coverage breach and Target/Safety coverage deviation are distinct, labelled outcomes. The solver prioritizes avoiding real production interruptions and critical shortfalls, then minimizes uncovered group demand, excessive orders/stock and transfers, then compares complete commercial evidence. The existing policy values are owner controlled.

## 4. R+S available-stock and non-executable incoming

Company/material pooled supply is the sum of **eligible, unrestricted, posted R-series and S-series stock** minus *applicable, not already issued/otherwise deducted* reservations. Retain company, SLoc, lot, stock type, document and material provenance. No stock unit can be credited twice; internal R→R and R→S movements change location, **not** company total. QA, blocked, invalid, excluded and unposted supply is never credited as physically executable.

- **CMP003 OT01 and OT02 are hard excluded** from all planning supply, coverage, allocation, transfer and inbound availability. Keep company-specific exclusion policy; other companies' exclusions are configurable. No code-level company special case.
- **Do not exclude R003 simply for being R003.** E.g. Sodium Gluconate inward at R003, later used via R001: its eligible R003 physical stock counts in company supply and may prompt `R003 → R001` suggestion.
- Eligible S stock counts towards company availability despite R→S actions being outside optimizer scope. **No artificial R→S lead time or restriction** in procurement coverage.
- The optimizer cannot promise that an R/S quantity is dedicated to every product simultaneously. Store report must describe a **single coherent allocation scenario** and its selected production period(s), plus shortages/alternatives where the production mix can vary.
- Incoming `PO`, `CSN` (dispatched or not), `GE`, partial receipt/lot and proposed delivery are kept in a **future dated supply ledger**, matched through the existing PO22 partition logic and constrained to remaining open physical quantity. The GRN-posted part flows into opening stock and must no longer appear as future inbound. Unknown/overdue ETA needs explicit uncertainty and cannot meet date-certain coverage.

## 5. R→R transfer suggestions (and only R→R)

A recommended R→R transfer requires a physically available eligible source R stock and a defensible *destination R* inferred from relevant existing material/PO/GRN/location/usage evidence. It is **optional advice**, not a prerequisite to counting pooled company stock for procurement coverage, nor a reservation or transfer posting.

Proposed fields: `company`, `run_id`, `material_id/code/name`, `source_R`, `destination_R`, `source_available_now`, `suggested_qty`, `why_destination`, `recommended_period` (if supported), `evidence_refs`, `confidence`, `advisory_only=true`.

Example Sodium Gluconate: R003 current stock plus justified R001 usage location can yield `R003 → R001`. If destination R is not supported by a reliable source, show `destination unknown / store decision`, **not** a fabricated route/date. The user decides whether/when/how much to move, and may choose differently. Never produce R→S, S→S or S→R transfer recommendation. S stock remains in pooled coverage but does not become a proposed source for R→R transfer.

Transfers never increase total company material stock. They do not reduce purchase requirement merely through location arithmetic; company inventory was already pooled. Never assume a transfer is posted before actual inventory ledger evidence.

## 6. Store Material Usage Instruction — output contract

Generate one **company-scoped, product-first, human-readable report** from each run, with filtering, dense printable/exportable rows, and no side panels/cards as the primary working UI. The **coverage horizon is remaining CM + NM**; generation/sharing is generally fortnightly but user-initiated. No fake fixed daily schedule: where PO21 gives only monthly/fractional demand, label the time range as period-level forecast, not confirmed production dates.

**Report header:** company name/code, as-of date, CM+NM period, generated time, run ID, snapshot fingerprint, planning status (`EXECUTABLE_PHYSICAL_STOCK` vs `PROJECTED_FUTURE`), policy version and short explanation of excluded stock/unknowns.

**Product-first detailed rows** (where deterministically backed):

| Field | Meaning |
|---|---|
| Product / SKU / ProdShade / Stroke or Pack BOM ID | Exact source identity; never collapse dissimilar products solely by group |
| Period / required-by | Current remaining month or next month; exact date only if genuinely sourced |
| Source line type + Group | `FIXED_EXCLUSIVE` or selected Group ID/name; PM vs RM distinguished |
| Planned material / material name/code | Specific solver-backed eligible member; null for uncovered group pool |
| Demand qty / UOM | Requirement attributable to this product/source line |
| Executable qty / UOM | **Current posted stock allocated to this row only** |
| Projected future allocation qty | For planning visibility; never an immediate Store instruction |
| Uncovered qty and reason | Physical shortage, group unallocated, blocked, conversion missing, etc. |
| Available evidence / reservation / exclusive flag | Current company R+S material and protection provenance |
| Note | Straightforward Store-facing usage guidance and warnings |

**Summaries:** (a) Product × Group × Material for store action; (b) Material across all products (current executable allocation, projected use, closing residual, shortage); (c) Group across products (fixed vs flexible, member allocation and unallocated group demand); (d) optional R→R redistribution table; (e) incoming PO/CSN/ETA and coverage/risk as **clearly separated non-executable information**. All summary totals must equal detailed row totals.

**Illustrative format only, not company data:**

| Product | Group | Material | Period | Need | From physical stock | Pending/future |
|---|---|---|---|---:|---:|---:|
| Product A | RDP | ELOTEX-60W | CM remainder | 12 MT | 8 MT | 4 MT unbacked |
| Product B | RDP_TLA | VAE DA 1100 | CM remainder | 4 MT | 4 MT | 0 |

Store must not take 4 MT from the planned incoming column as an issue instruction. If the product mix changes, Store selects that product's applicable row; availability remains subject to actual remaining stock/production schedules. Report is informative, not a second transactional reservation system.

## 7. Procurement coverage, vendor orders and future stock reuse

Project dated supply and material consumption through CM+NM for current recommendations, and use a longer scenario horizon (e.g. six-month selection/coverage) **only where necessary** to evaluate MOQ excess, further periods or lead-time risk; do **not** change PO22 CM/NM formulas or automatically buy six months' demand.

- Existing PO/CSN source events are not supply twice. Source precedence honors posted GRN, gate entry, mother/sub CSN and partial receipts, status, cancellation/knockoff, open PO balance and latest valid plant ETA. A claimed delivery before actual receipt remains a projection.
- New tentative buy must be selected in the appropriate **order month** under user-controlled selection; no automatic overwrite. All members still technically consumption-eligible.
- Supplier MOQ and order multiple are **separate vendor-material-route/effective contract constraints**; do not globally assume 25 MT unless the specific vendor contract requires it. For an enforceable 25 MT order multiple, 28 MT need implies 50 MT PO. Lot deliveries may be 25 MT on separate dates if vendor capability/evidence supports them.
- A 50 MT PO and its 25+25 MT lots are one order obligation; each arrival becomes projected stock **only on its own arrival date**. Once posted, the actual unused remainder continues as company stock in later runs. E.g. 25 MT receipt minus 3 MT actually consumed leaves 22 MT **assuming no other movements/reservations**; this may meet later eligible group demand and avoid new PO.
- Show procurement choice, projected coverage dates, PO-by date, requested dispatch, actual dispatch where available, calculated plant ETA, lot qty, cash consequences and explicit shortage/uncertainty. No known ETA means no on-time commitment.

**Lead time:** configured vendor lead time is PO-release to estimated plant receipt and already includes processing; never add processing again. Requested dispatch is a distinct requested milestone; infer it only when verified lead-time stage evidence exists, else `UNKNOWN`/user-entered. CSN actual dispatch comes from evidence, not from PO date. Changes to DRAFT/POSTED AC01 data can alter a fresh run's commercial comparison but do not retroactively rewrite prior runs.

## 8. Commercial evidence and AI contract

**Verified PROD observation as of 17 Oct 2026 (read-only spot audit, not full validation):**

| Source | Findings and constraints |
|---|---|
| `erp_procurement.landed_cost` | CMP003: 26 POSTED; CMP005: 42 DRAFT; CMP011: 4 POSTED + 32 DRAFT. `grn_id` populated, `po_id` null in sampled company records; exact GRN/material/unit cost and tax classification **not fully verified**. |
| `erp_procurement.landed_cost_line` / `landed_cost_deduction_line` | Freight, unloading, insurance etc.; these are **cost components**, not automatically full landed unit purchase price. |
| `erp_procurement.purchase_order` | 154 company PO headers checked, all with `payment_term_id`. PO payment term is authoritative for existing PO; new orders should use applicable vendor-material default plus `payment_terms_master`, with advance/LC/reference-date treatment. |
| `erp_master.vendor_material_payment_term` / `payment_terms_master` | 132 association rows / 18 term-master rows observed. Need exact default/active precedence; logs were empty in audit. |
| `erp_master.lead_time_master_domestic` | 129 active rows; `transit_days` field name **does not by itself prove total end-to-end lead-time semantics**. Reconcile code/owner-approved total lead-time configuration before using PO-by date. Do not add processing twice. |
| `erp_procurement.consignment_note` | Across checked company scope 162 CSNs, 129 with plant ETA, 116 with dispatch quantity populated; field presence is not dispatch event proof. Source hierarchy and partial receipts must be applied. |
| `erp_production.reservation_document` | 28 CMP003 and 45 CMP005 OPEN/PARTIAL reservations in the spot check; material/location/UOM/status dedupe needed. |
| `erp_inventory.storage_location_plant_map` | CMP003: 3 R + 3 S; CMP005: 2 R + 2 S; CMP011: 1 R + 1 S; OT01 mapped, OT02 absent from checked mappings. **Still hard-exclude OT02 if later present.** |
| `erp_master.vendor_material_info` | 132 records, 90 populated last purchase prices, `last_purchase_currency` absent in inspected rows; cannot infer currency from blank. |

**AC01 DRAFT → POSTED owner clarification:** DRAFT normally progresses to POSTED. DRAFT is evolving *provisional* cost evidence, not a permanent missing-data failure; POSTED is finalized evidence. A fresh manual run consumes current approved-use evidence tagged `PROVISIONAL`/`FINAL`, with explicit as-of timestamp and component completeness. Never treat DRAFT as a guaranteed future final value or rank incomplete cost as definitively cheapest.

**Working capital:** Vendor Master and PO term evidence can support provisional payment timing; actual budget/credit/funding rate/FX/tax recoverability/collection assumptions require authority. If absent, mark component `UNKNOWN`; production-feasibility optimization still runs. No arbitrary zero-cost fallbacks.

**AI:** Can explain, prioritize review, analyze historical usage, compare *validated* strategies and request alternative scenarios. It cannot directly assign Group shortage, change manual policy, issue stock or write numerical recommendation fields. A scenario affecting numeric output requires planner authorization and a **new deterministic solver calculation + full constraint validation**. Source IDs/fingerprint/company scope checked. API budget uses server-side atomic reservation/settlement under agreed B13 cap; if AI unavailable, planning remains operable. Pricing source/reset timezone remain technical verification items.

## 9. Proposed data/API/UI delta relative to Phase 2B

**Design additions, not deployed:**

- Existing `optimizer_run_input` and `optimizer_virtual_allocation`: source-line/product and period identity mandatory; capture `physical_executable_qty` separately from `projected_future_qty`; prohibit executable quantity backed by incoming events.
- `optimizer_store_instruction_row` (or an equivalent immutable projection from allocations): `(run_id, company, product/source IDs, period, group/fixed, material nullable, required_qty, executable_qty, projected_qty, uncovered_qty, evidence references, explanation codes)`; enforce sums, material eligibility and no claim against unreceived supply.
- `optimizer_r_to_r_suggestion` (or derivation on read): source R, destination R nullable, material, current source balance, suggested qty, reason, confidence, advisory-only; no transfer document linkage required.
- `optimizer_report_export` can be a stateless download endpoint if historical run snapshots suffice; no extra mutable approvals or acknowledgment table required.
- Keep `optimizer_supply_event` with lifecycle identity/date/stock state and avoid converting CSN ETAs into physical available rows.
- Human-friendly dense page/report with product-wise view as default, export/print, material/group summaries and separate conditional R→R section; no cards/side panels in operational UI.
- APIs may expose `GET /runs/:id/store-instructions` and `GET /runs/:id/store-report` only **after separately authorized implementation**. Do not wire them to PO or transfer posting endpoints.

**Potential conflict resolved:** Phase 2B's `optimizer_transfer_policy` remains optional R→R evidence only; no R→S feasibility constraint may reduce company-level R+S planning supply. Generic location policy governs exclusions and unrestricted stock eligibility.

## 10. Numeric and integrity acceptance tests

1. **Non-regression:** existing PO22 CM/NM values and NM Requirement Days are identical before/after; `buildRequirementRows()` unchanged.
2. **Company/ACL:** mixed-company inputs cannot be pooled or reported together; future company onboards by data, not code fork.
3. **OT:** CMP003 OT01 and OT02 never contribute to supply/coverage or movement suggestions (including future inbound).
4. **R+S pooling:** R001 10t + S001 3t = 13t company material before eligible reservations. R→S posted movement changes location but not aggregate. QA/blocked excluded.
5. **R003 Sodium Gluconate:** posted unrestricted R003 stock counts; justified R003→R001 may be suggested; S transfers never suggested.
6. **No phantom transfer:** suggestion never posts movement or creates net stock; unspecified destination stays unknown rather than invented.
7. **One demand per source:** direct/exclusive line creates exactly one fixed demand; Group line creates exactly one pool; no duplicate protection demand.
8. **Use Primary = No:** uncovered group qty stays group-owned, not UUID/lexical first; PM alternatives treated independently.
9. **Multi-group shared stock:** one material shared across RDP, RDP_PLC, RDP_TLA and an exclusive stroke cannot be allocated more than physical balance; date-prioritized protection.
10. **Store executable gate:** 20t posted + 25t CSN ETA = **no more than 20t immediately executable** before reservations/protection; after 10t partial GRN and fresh user run, executable capacity rises only by net newly posted amount.
11. **Current-vs-future consistency:** projected arrivals may improve projected CM+NM cover but never imply earlier Store issue; coverage gap before ETA visibly persists.
12. **Product switch:** report supplies product-specific chosen members and period; mutually competing allocations cannot each independently claim shared stock in full.
13. **CM+NM / fortnight:** run on 17 Oct covers 17–31 Oct + 1–30 Nov (subject to existing as-of semantics); the 15-day communication cadence never changes demand formula.
14. **Vendor multiple:** 28t need with verified 25t multiple gives 50t order, split 25+25 as permitted; delivery lots total exactly the order qty and dated cover is lot-specific.
15. **Excess carry-forward:** actual 25t receipt with 3t consumption leaves 22t net residual absent other events; a future run can allocate it before buying again.
16. **Existing commitments:** PO/CSN/GE/lot/GRN and partial receipts are reconciled once; cancelled/knocked-off balance removed without deleting historic evidence.
17. **Monthly selection:** selected month gates new buy only; existing stock/inbound consumption possible when new-buy deselected.
18. **Draft cost:** CMP005/CMP011 provisional AC01 cost usable with explicit uncertainty; after POSTED and new run evidence state changes without retroactive run rewrite.
19. **Payments:** existing PO term overrides vendor default for commitment; unknown payment/cost component prevents a false best-price conclusion.
20. **AI numeric boundary:** AI numeric proposal cannot alter a report without planner-authorized deterministic rerun; AI/budget failure does not break base planning.
21. **UOM/data gaps:** missing L→KG, pack UOM, unmatched product/group or ambiguous dates result in visible exception rather than arithmetic guessing.
22. **Reconciliation:** every Store detailed row sums to material and Group aggregates; issued/allocated current stock not double assigned; no stock/PO or transfer posting API invoked.

## 11. Exact remaining technical checks (not new business-policy questions)

1. Validate **PO21→source-line/product/ProdShade→group member** identity and real historical consumption mapping; is actual material consumption source reliably joined to product and group, including substitute use?
2. Verify authoritative **daily/fortnight demand time phasing**; do not fabricate exact product production dates from monthly totals.
3. Validate stock ledger posting/status/type, R/S location policy, reservation status/grain/UOM and **double-deduction risk** in PROD for each company.
4. Validate R→R destination evidence and existing `erp_inventory.location_transfer_rule` / request/posting semantics; no inferred mandatory route without evidence.
5. Resolve per-vendor MOQ/order multiple, effective dates, purchase UOM conversion and **split delivery confirmation** from actual contract/PO/source.
6. Resolve AC01→GRN→material/quantity purchase-base/charges/deductions/taxes/FX to defensible landed unit price; DRAFT freshness/currency and final POSTED precedence.
7. Verify Vendor Master/payment mapping effective default, PO term authority, advance/LC date basis and credible cash/funding evidence.
8. Verify precise PO/CSN/GE/lot lifecycle partition and supplier-delivery reliability pairing (requested vs actual dispatch, receipt and revised ETA).
9. Verify configured **total** vendor lead-time source: domestic `transit_days` alone may not establish it; do not double-add components.
10. Check AI provider pricing / budget reset timezone / company ACL and reporting export role permissions only when AI/UI work is separately approved.
11. Obtain DEV baseline PO22 numerical UAT before implementation: Phase 2B indicates migration/menu/ACL were not rolled out; verify current state afresh rather than assume deployed.

If an input cannot be verified, flag the exact affected feature as `NOT_SOURCE_READY` rather than invent it or block every other deterministic function.

## 12. Chronological Phase 3 implementation handoff (NOT AUTHORIZATION)

**Gate 0 — Baseline:** Obtain owner authorization for existing PO22 DEV rollout and its untouched UAT snapshots; confirm company ACL and current build state. Stop if baseline results differ from approved CM/NM.

**Phase 3A — Source contract & reproducibility:** Read-only repo/DB evidence check of §11, company-scoped immutable snapshot/fixture design, source-field precedence and unknown states. Present outstanding source risks before migration. Do not modify PO22 formulas.

**Phase 3B — Policy & monthly selection:** After explicit approval implement company location exclusions, vendor order constraint source adapters and six-month manual new-buy selection with ACL and tests. Selection never blocks existing stock/PO/CSN.

**Phase 3C — Pure deterministic joint solver:** New module beside existing PO22 pure logic; current R+S conservation, fixed/group allocation, dated protection, current-physical executable gate, future supply separation; test CMP003/005/011 and multiple periods.

**Phase 3D — Procurement & R→R advisory:** MOQ/multiple, dated lot deliveries, excess carry-forward, coverage, PO-by/requested dispatch/actual dispatch/ETA, optional R→R suggestion only; strong lifecycle tests.

**Phase 3E — Store-facing reporting:** Dense product-first CM+NM instruction report, material/group summaries, clear physical vs projected state, fortnightly manual generation/export; no enforcement or transfer/PO posts.

**Phase 3F — Commercial & AI:** AC01 provisional/final data, payment terms, qualified cash and supplier evidence, deterministic score; optional AI gateway only after verified UAT, hard cap and numeric validator.

**Gate 1 — DEV acceptance and owner review:** Verify all §10 cases on representative snapshots. Check unchanged PO22 numeric baseline; require separate approval before any PROD migration/merge/deploy.

## 13. Phase 2B → Phase 2D change log

- Added **stock-only Store execution gate** distinct from future procurement scenario.
- Added **product-first CM+NM Store report**, fortnightly manual communication, no mandated approval/revision/deviation enforcement.
- Added **R→R-only advisory suggestion**, explicitly including valid R003→R001 Sodium Gluconate and forbidding R→S scheduling.
- Clarified current company **R+S** pooled inventory, OT01/OT02 hard exclusion, existing S stock use and no stock count from unreceived CSN/PO.
- Clarified vendor-dependent multiples, 25+25 split and residual-stock reuse.
- Clarified DRAFT AC01 is provisional evolving evidence, POSTED final; manual fresh-run repricing.
- Clarified AI as advisory only, no numerical authority outside planner-authorized deterministic rerun.
- Consolidated read-only source observations and isolated technical evidence gaps.

**Conclusion:** Owner business intent is captured. This document is suitable for engineering scoping and gap closure, **not** confirmation that all source relationships are production-verified or that the solver/deployment exists. Nothing in this document authorizes an operational write.