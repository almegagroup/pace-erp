# PO22 Phase 2 — Optimizer Architecture and Data Contract

**Status:** DESIGN ONLY — no migration, API, frontend, AI integration, deployment, or PO-creation approval.
**Revision:** Phase 2B owner-confirmed rules, 2026-10-17.
**Baseline:** `PO22-PHASE-1-FULL-AUDIT-2026-10-17.md`, `BUSINESS-REQUIREMENTS.md`, `DECISION-REGISTER.md`.

## 1. Scope and preserved boundary

One shared optimizer serves CMP003, CMP005, CMP011 and future MTS companies. It uses company-scoped policies, data and ACL—never company-specific calculation branches.

It sits after existing PO22 Requirement calculation and consumes immutable PO22/PO21 evidence. It must not modify PO21 effective demand, PO22 CM/NM columns, Target/Critical policy, the approved coverage-based NM Requirement Days formula, `buildRequirementRows()`, or existing PO22 tests. It creates advisory allocation, transfer-context and new-buy recommendations only; it never writes stock, reservation, formulation, PO, CSN, GRN, vendor or operational policy data. Accepted recommendations never create POs.

```text
Existing PO22 report (unchanged)
  demand · formulation · stock · reservations · PO/CSN/lot lifecycle
                         ↓
Immutable optimizer run input, company scoped and dated
  monthly new-buy selection · R/S pool policy · OT exclusions · commercial evidence
                         ↓
Deterministic solver: protect fixed demand → allocate groups → project supply → buy/delivery lots
                         ↓
Deterministic validation and explanation codes
                  ↙                         ↘
        planner decision              optional AI analysis only
                  ↓
        advisory audit record — no transaction
```

Completed runs retain source fingerprint, rule/policy versions, timestamps, unknown data and every constraint relaxation. React renders results only.

## 2. Proposed `erp_planning` data contract

All objects are proposals, not deployed. Every table has UUID key, `company_id`, creation audit, RLS/company ACL and append-only revision where it holds policy.

### 2.1 Company controls

| Table | Key fields | Constraint / purpose |
|---|---|---|
| `optimizer_material_procurement_selection` | company, material, `planning_month`, version/current, `new_buy_selected`, reason/remarks | User-controlled monthly eligibility for **new tentative procurement**. One current record per company/material/month. AI cannot alter it. Deselection never removes existing stock or confirmed inbound from allocation evidence. |
| `optimizer_group_usage_rule` | company, source kind/ID, material group, effective date/version, RM primary state, `shortage_ownership_mode` | Each formulation line becomes exactly one `FIXED_EXCLUSIVE` or `GROUP_POOL`, never both. RM respects Stroke × group Use Primary; PM has no primary toggle. Group shortage is group-owned. |
| `optimizer_exclusive_demand_rule` | company, material, ProdShade/Stroke/Pack-BOM source, effective dates, protection metadata | Represents non-substitutable date-wise demand before flexible allocation. |
| `optimizer_location_policy` | company, location, effective date/version, role (`R_S_ELIGIBLE`, `P_ELIGIBLE`, `EXCLUDED`, `OTHER`), supply/new-buy-receipt flags, reason | Supplements formulation location provenance. CMP003 OT01 and OT02 use effective `EXCLUDED` records; no company code is hardcoded in solver logic. |
| `optimizer_transfer_policy` | company, from/to location, effective version, allowed/approval/operational metadata | Only for transfers in optimizer scope. R→S machine distribution is manual plant work outside procurement scheduling—no artificial R→S lead time or suggested R→S transfer. |
| `optimizer_vendor_order_constraint` | company, vendor, material, route, effective range/version, MOQ, order multiple, purchase UOM, source evidence | Vendor MOQ and order multiple are separate constraints. Missing multiple is `UNKNOWN`, never one. |

### 2.2 Immutable run, supply and output records

| Table | Grain / fields | Constraint |
|---|---|---|
| `optimizer_run` | company, as-of, CM/NM/horizon, demand version, fingerprint, rule version, calibration reference, status | Immutable after completion/failure. |
| `optimizer_run_input` | run + source category (`DEMAND`, `STOCK`, `RESERVATION`, `INBOUND`, `POLICY`, `SELECTION`, `COMMERCIAL`) + canonical snapshot | Sufficient provenance for deterministic replay. |
| `optimizer_demand_pool` | run, pool/day, source ref, group, base-UOM demand, state (`FIXED_EXCLUSIVE`, `GROUP_UNALLOCATED`, `GROUP_ALLOCATED`) | Exactly one state per source line/day. `GROUP_UNALLOCATED` has no material ID and cannot yield a false material buy. |
| `optimizer_supply_event` | run, material, source location, date/null, qty/UOM, kind (`OPENING_STOCK`, `GE`, `CSN`, `LOT`, `PO_REMAINDER`, `PROPOSED_DELIVERY`), lifecycle identifiers/confidence | Stores current remaining lifecycle supply separately from original PO quantity. |
| `optimizer_virtual_allocation` | run, day, material, company R/S supply-pool/location provenance, demand pool, qty, kind (`STOCK`, `INBOUND`, `NEW_BUY`, `PROTECTED`) | Planning-only conservation record; never a stock/reservation posting. |
| `optimizer_recommendation` | run, `BUY` or `UNALLOCATED_GROUP_RISK`, material/vendor nullable as appropriate, qty/UOM, priority/status, codes | BUY needs eligible material/vendor and solver validation. Group risk has no invented material or vendor. |
| `optimizer_delivery_lot` | recommendation/supply event, sequence, qty, requested/confirmed dispatch, proposed/current ETA, status/confidence | Supports staggered lots; proposed lots must sum to their recommended PO quantity. |
| `optimizer_recommendation_schedule` | recommendation, PO-by, requested dispatch, estimated plant ETA, source/confidence | PO placement, requested dispatch, actual dispatch and ETA remain distinct. |
| `optimizer_recommendation_decision` | recommendation, accepted/ignored/superseded, reason, actor/time | Planning audit only; cannot create PO, CSN, transfer, reservation or ledger entry. |
| `optimizer_commercial_evidence` | run, material/vendor/route, AC01/PO/vendor evidence, currency, cost, payment, reliability/consumption/freshness | Missing data is `UNKNOWN`/`STALE`, never zero. |
| `optimizer_ai_usage_ledger` | provider/model/month, atomic reservation/settlement, usage, run/actor/status | B13 hard-cap audit; no AI call bypasses it. |

## 3. Stock availability: company R/S pool

1. Pool eligible **unrestricted** R-series and S-series stock at company level by material, retaining original SLoc provenance and deducting valid reservations before allocation.
2. CMP003 OT01 and OT02 contribute nothing: not opening supply, inbound, allocation, coverage, transfer source/destination or recommendation.
3. QA, Blocked and other restricted stock are evidence/risk only until a valid operational release exists.
4. Eligible existing S-stock is immediately relevant to procurement planning. Do not impose an R→S transfer lead time. R→S machine distribution is manual plant activity, outside PO22 scheduling.
5. R001→R002 redistribution may occur operationally but cannot create a procurement shortage: company R/S conservation prevents buying the same quantity twice.
6. Effective Stroke/Pack BOM locations stay PO22 provenance/direct-consumption facts. This revised R/S pooling applies only in optimizer scenarios and does not change PO22 stock/report formulas.
7. A balance outside eligible policy remains visible as non-supply evidence; nothing is implicitly moved between companies.

## 4. Joint group and exclusive allocation

Each formulation line/day creates one record only:

- `FIXED_EXCLUSIVE`: non-substitutable material demand, protected date-wise; or
- `GROUP_POOL`: one shared demand with active group members eligible to consume it.

RM eligibility follows effective Stroke and Use Primary; PM alternatives derive only from active Pack BOM group relationships. Historical consumption may inform scenario/risk/economics but is never a fixed allocation percentage.

Let `x[p,m,t]` be material consumption for pool `p`, `S[m,t]` eligible company R/S opening balance after reservations, `I[m,t]` dated existing lifecycle supply, `q[m,v]` a new vendor order, `d[q,k,t]` a delivery lot, and `h[p,t]` shortage.

1. `Σm x[p,m,t] + h[p,t] = D[p,t]`. When allocation is not deterministically valid, `h` stays `GROUP_UNALLOCATED`.
2. `x=0` unless the member is active and eligible for the exact source group/date. Monthly new-buy deselection never blocks stock/PO/CSN consumption.
3. `S[m,t+1] = S[m,t] + I[m,t] + Σk d[q,k,t] - Σp x[p,m,t]`. A physical unit is allocated once only across every group and exclusive use.
4. Flexible-group allocation cannot reduce material below fixed/exclusive date-wise demand plus protection floor except a separately reported, prioritized unavoidable shortage.
5. Existing stock and confirmed PO/GE/CSN/lot lifecycle supply are considered before tentative buy. Original PO quantity is never current outstanding supply.
6. Unused valid supply—including MOQ/multiple excess—carries into future months before new procurement.
7. New `q` is zero unless the material is selected for that month, vendor/route and MOQ/multiple are valid, and deterministic date/lead-time validation succeeds. Unknown ETA is risk, not on-time cover.

Objectives are lexicographic: production continuity/critical breaches; unallocated group risk/date gaps; avoid excess/duplicate procurement; then only complete commercial evidence and supplier reliability. Every relaxation gets an explanation code.

## 5. Monthly six-month new-procurement selection

The user chooses whether each material is eligible for **new tentative procurement** in each month of the six-month horizon. That manual choice is authoritative.

1. Active formulation/group membership establishes technical consumption possibility.
2. Selection gates only a new-buy recommendation. Existing stock, confirmed PO/CSN/lots and their consumption remain relevant after deselection.
3. A deselected material can leave a shortage/risk result; the solver cannot silently substitute or change the selection.
4. AI may describe a pattern or request a scenario. It cannot edit selection/settings; a user-approved change creates a new validated solver run.
5. Each run snapshots monthly selection and source/effective dates.

## 6. Vendor MOQ, order multiples and delivery lots

MOQ is the lower bound of one vendor-material PO; order multiple is its indivisible increment. Both are vendor-specific and enforceable only with source evidence:

`q[m,v] >= MOQ[m,v]` and `q[m,v] mod Multiple[m,v] = 0`.

Delivery lots satisfy `Σk d[q,k] = q[m,v]`, each with separate requested/confirmed dispatch and ETA.

| Requirement | MOQ / multiple | Recommendation |
|---|---|---|
| 700 KG | MOQ 1,000 KG; multiple 250 KG | 1,000 KG PO. |
| 1,250 KG | MOQ 1,000 KG; multiple 600 KG | 1,800 KG PO; 550 KG excess carries forward. |
| **28 MT** | enforceable multiple **25 MT** | **50 MT PO**, with 25 MT + 25 MT staggered lots when each ETA is represented. |

For existing commitments, PO line open balance, Gate Entry, dispatched/received CSN, lot balance, cancellation/knock-off and GRN determine remaining quantity. Original PO qty is not re-counted.

## 7. Lead time, dispatch and ETA

Configured lead time is the effective **PO release to expected plant delivery** duration and already includes vendor processing. Never add processing again.

| Field | Meaning |
|---|---|
| PO-by | Advisory release deadline: target ETA less configured total lead time. |
| Requested dispatch | Supplier commitment for a proposed/confirmed PO; not PO date or actual dispatch. |
| Actual dispatch | Physical CSN/event evidence; can precede/follow requested dispatch. |
| CSN lifecycle | Status, partial dispatch/receipt, mother/sub relation and consignee determine remaining confirmed supply. |
| Plant ETA | Latest calculated CSN ETA to plant; current preferred in-transit evidence with source/time. |
| Unknown date | Explicit `UNKNOWN`, no on-time coverage credit. |
| GRN | Stock fact, not future inbound; count once through ledger. |

Existing CSN/lifecycle evidence wins over stale PO promise. Proposed lot ETA stays a proposal until confirmed CSN evidence replaces it.

## 8. Commercial evidence

AC01 is the candidate source for actual landed-cost evidence, subject to field/source verification. Vendor Master is the candidate source for new-order payment terms; existing PO terms are evidence for existing commitments. Where authoritative, the run includes historical consumption, supplier performance, projected cash impact and working capital.

- Missing landed cost, payment terms, performance, FX/tax, capacity, cash or working-capital data is `UNKNOWN`, not zero/best.
- Continuity solver still runs; commercial vendor ranking is unavailable/partial with explicit reasons.
- Commercial score is deterministic, component-visible and versioned—not an AI score.

## 9. Proposed APIs

All APIs are proposed and require distinct company-scoped ACL resources. They never reuse PO-create access.

`POST /api/procurement/mts-optimizer/runs`

```json
{
  "company_id": "uuid",
  "as_of_date": "YYYY-MM-DD",
  "plan_month": "YYYY-MM-01",
  "horizon_end": "YYYY-MM-DD",
  "demand_at": "ISO timestamp or null",
  "calibration_reference": { "ledger_date": "YYYY-MM-DD" },
  "scenario_label": "optional"
}
```

Response carries run/fingerprint/rule and policy versions, pools, allocations, delivery lots, projected coverage, buy/risk recommendations, evidence confidence, unknowns and relaxations—never a transactional document ID.

- `GET /api/procurement/mts-optimizer/runs?company_id=...`
- `GET /api/procurement/mts-optimizer/runs/:run_id`
- `GET /api/procurement/mts-optimizer/runs/:run_id/recommendations`
- `POST /api/procurement/mts-optimizer/recommendations/:id/decision`

Accept/ignore/supersede only records planning intent; it cannot post any document or stock activity.

## 10. AI Gateway and numerical authority

AI analyzes patterns, risks, alternative strategies and suggested policy improvements. The deterministic solver alone calculates and validates quantities, PO-by dates, delivery schedules, stock projection and feasible allocations.

AI receives only ACL-filtered compact run evidence: recommendation IDs, candidate sets, policy/selection state, risk/unknown flags, calculated results and fingerprint. It cannot query or mutate ERP.

AI may return explanations, evidence references, strategy ranking, questions and **scenario requests**. A scenario request cannot change manual settings or final numbers; after user authorization it starts a new deterministic run. AI cannot allocate an unallocated group pool or create a material buy.

The planning gateway atomically reserves/settles B13 hard-cap usage. AI failure, validation rejection or budget exhaustion is recorded and never blocks deterministic planning. Recommendations never create POs.

## 11. Acceptance tests

| Case | Condition |
|---|---|
| CMP003 OT01/OT02 | Neither contributes stock, inbound, transfer, allocation or coverage; evidence shows exclusion. |
| CMP003 R/S company pool | Eligible unrestricted R/S balance pools once after reservations; no artificial R→S delay blocks existing S stock. |
| CMP003 R001→R002 | Redistribution cannot create a new purchase need or duplicate procurement. |
| CMP003 RDP Use Primary = No | Shortfall is `GROUP_UNALLOCATED`, never UUID/lexical first material. |
| CMP003 exclusive plus RDP | Fixed/exclusive date-wise demand is protected before flexible allocation; shared physical pool cannot over-allocate. |
| CMP003 litre SKU | Missing L→KG conversion produces exception, never quantities. |
| CMP005 PM/nonstandard location | Company/source policy decides availability without R/P prefix assumption; existing commitments remain visible when deselected for new buy. |
| CMP005 shared material | One material across groups/exclusive use is consumed once over all days. |
| CMP011 multi-pack | Base math, pack provenance and vendor UOM/multiple reconcile. |
| 28 MT / 25 MT | 50 MT PO plus two 25 MT lots; individual lot ETA drives coverage; excess carries forward. |
| Inbound lifecycle | Partial GRN, knock-off, GE, mother/sub-CSN, foreign consignee, latest/unknown ETA use current PO22 partitioning first. |
| Monthly deselection | New buy blocked; existing stock/PO/CSN remains allocation evidence. |
| Future company | ACL + source-verified formulation + R/S/OT policy + monthly selection onboards it with no code fork. |
| Commercial unknown / AI outage | Continuity solver completes; commercial/AI states are unknown/unavailable with reason and no automatic action. |

## 12. Implementation sequence (not authorization)

1. Controlled DEV rollout of existing PO22 foundation: current migration, ACL provisioning, route/API checks and snapshots. Do not start optimizer implementation before it succeeds.
2. Freeze CMP003/CMP005/CMP011 UAT source snapshots and sign off existing PO22 numerical behavior; do not edit `buildRequirementRows()`.
3. Verify source fields/seed data for R/S/OT policy, reservations, lifecycle supply, AC01, Vendor Master and existing PO terms.
4. Add append-only optimizer controls/runs/supply-event/delivery-lot tables under `erp_planning`, with RLS/ACL and no operational writes.
5. Implement a pure solver beside—not inside—`buildRequirementRows`, reusing existing PO22 source semantics (`loadFormulationMasters`, `loadStockAndConsumption`, `loadReservations`, `loadInbound`, `loadLeadTimes`, `effectivePolicy`, `canonicalJson`).
6. Add deterministic optimizer tests before any read-only `ErpDenseGrid` result UI.
7. Add commercial score only after source verification; add AI gateway/budget/validator only after deterministic UAT.

## 13. Genuine operational data-source / technical questions

1. Which exact approved AC01 fields supply landed cost, freight/tax, currency/effective date and fallback behavior?
2. Which Vendor Master fields/version provide applicable new-order terms, and which PO fields are authoritative for commitments?
3. Which records/quality thresholds define supplier performance without inventing a score?
4. What is the authoritative cash/working-capital input for budget, credit, FX, recoverable tax and collection timing?
5. Which reservation statuses and exact location identities seed/validate R/S/OT policy for each company?
6. Which lifecycle fields win when requested dispatch, CSN hierarchy, partial receipt and recalculated plant ETA conflict?
7. What provider price/config source and month-reset timezone implement the already-approved AI budget technically?

## 14. Design-change summary and readiness

Phase 2B replaces the earlier per-location transfer assumption with company-level eligible R/S pooling, hard OT01/OT02 exclusion and no artificial R→S scheduling delay. It confirms one demand-record state per formulation line, joint fixed/group allocation, monthly new-buy-only selection, vendor MOQ/multiple with split delivery lots, lifecycle-based outstanding supply, AC01/Vendor/PO commercial-source direction, and AI as analysis-only behind deterministic reruns.

The design is ready for owner review and source verification. It is **not implementation-ready** until existing PO22 is rolled out to DEV and the seven operational source/seed questions above are verified. Phase 3 must not start without separate approval.
