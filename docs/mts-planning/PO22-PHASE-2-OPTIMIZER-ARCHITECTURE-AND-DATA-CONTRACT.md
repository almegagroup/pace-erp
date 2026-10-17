# PO22 Phase 2 — Optimizer Architecture and Data Contract

**Status:** DESIGN ONLY — not a migration, API, frontend, AI integration, or deployment plan approval.  
**Date:** 2026-10-17  
**Baseline:** `docs/mts-planning/PO22-PHASE-1-FULL-AUDIT-2026-10-17.md`, `BUSINESS-REQUIREMENTS.md`, and `DECISION-REGISTER.md`.  
**Scope:** CMP003, CMP005, CMP011 and future MTS companies through one company-scoped engine.

## 1. Non-negotiable boundary

The optimizer is a new deterministic planning layer *after* existing PO22 Requirement calculation. It consumes immutable PO22/PO21 evidence and returns advisory allocation, transfer, and buy recommendations. It must not change:

- PO21 effective demand rules, PO22 CM/NM calculations, Target/Critical policy, or the approved coverage-based NM Requirement Days formula;
- stock, reservation, Stroke, Pack BOM, PO, CSN, GRN, vendor, or policy master facts;
- existing confirmed PO/CSN obligations; or
- transactional procurement authority. A recommendation never creates a purchase order.

The PO22 run remains the source of CM/NM requirements and coverage facts. An optimizer run has its own immutable input fingerprint and rule version; it never silently rewrites an earlier run.

## 2. Target architecture

```text
Existing PO22 deterministic report
  PO21 demand + effective Stroke/Pack BOM + stock + reservations + PO/CSN/lot
                                  │
                                  ▼
Optimizer input snapshot (immutable, company-scoped, dated)
  eligibility · location policy · transfer feasibility · policy · commercial evidence
                                  │
                                  ▼
Deterministic feasibility/allocation solver
  consumption allocation → protected demand → transfer proposals → new-buy candidates
                                  │
                                  ▼
Deterministic validator + explanation codes
                                  │
                   ┌──────────────┴───────────────┐
                   ▼                              ▼
      planner-reviewed recommendation       optional AI explanation/ranking
                   │                              │
                   └──────────────┬───────────────┘
                                  ▼
                 accept / ignore / supersede audit record
                         (still no PO creation)
```

The solver is pure and testable. Persistence captures input, output, decision and provenance; React only renders them. AI is outside the numerical authority path.

## 3. Proposed `erp_planning` data model

All tables below are proposals. They are not deployed. UUID primary keys, `company_id`, audit columns (`created_at`, `created_by`), and RLS/company ACL checks are mandatory. No proposed table updates an operational source table.

### 3.1 Effective-dated policy and eligibility

| Proposed table | Key / fields | Constraints and purpose |
|---|---|---|
| `optimizer_material_eligibility_policy` | `company_id`, `material_id`, `effective_from`, `version_no`, `is_current`; `eligibility_mode` (`INCLUDE`, `EXCLUDE_NEW_BUY`, `EXCLUDE_CONSUMPTION`, `REVIEW`); `six_month_start`, `six_month_end`, `reason_code`, `remarks` | Append-only revision, one current row per company/material/effective date. Manual policy controls eligibility for the stated horizon. `EXCLUDE_*` never erases existing stock or confirmed inbound evidence. |
| `optimizer_group_usage_rule` | `company_id`, source kind (`STROKE_LINE`/`PACK_BOM_LINE`), source ID, `material_group_id`, `effective_from`, version; `rm_primary_mode` (`PRIMARY_ALLOWED`, `PRIMARY_EXCLUDED`, `POOL_ONLY`); `shortage_ownership_mode` (`GROUP_POOL` only initially) | RM inherits PO21 Stroke × group Use Primary. PM has no primary toggle. A group with no valid optimizer allocation remains a pool, never a default material. |
| `optimizer_exclusive_demand_rule` | `company_id`, `material_id`, source ProdShade/Stroke/Pack BOM reference, `effective_from/to`, `protection_mode`, `minimum_coverage_days`, `reason_code` | Prevents common stock from being consumed by a flexible pool before mandatory dated demand is protected. Exact business meaning of exclusivity remains owner-approved input. |
| `optimizer_location_policy` | `company_id`, `storage_location_id`, `effective_from`, version; `planning_role` (`RM_REQUIRED`, `PM_REQUIRED`, `TRANSFER_SOURCE`, `EXCLUDED`), `supply_eligible`, `new_buy_receipt_eligible`, `hard_exclusion_reason` | Required consumption location normally comes from effective Stroke/Pack BOM. This table supplies company-specific guardrails/exceptions, not a replacement for those master links. CMP003 OT01 requires an effective `EXCLUDED`/`supply_eligible=false` row. |
| `optimizer_transfer_policy` | `company_id`, `from_location_id`, `to_location_id`, effective date/version; `allowed`, `requires_approval`, `execution_lead_days`, `capacity_qty`, `reason_code` | A suggestion is feasible only if this rule allows it. Intra-company transfer execution may have zero elapsed days once posted, but unposted stock is never credited to destination supply. |

Both material and location policies should use the same append-only retirement pattern as the proposed PO22 `material_requirement_policy` migration. Policy changes require a distinct optimizer-policy WRITE resource; a run records the exact policy version set it used.

### 3.2 Run, snapshot and recommendation records

| Proposed table | Grain / core fields | Constraints |
|---|---|---|
| `optimizer_run` | one run: `company_id`, `as_of_date`, CM/NM/horizon end, optional `demand_at`, `source_fingerprint`, `rule_version`, `status`, `calibration_reference`, `requested_by`, `calculated_at` | Run is immutable after `COMPLETED`/`FAILED`; company scope required. It references no mutable “latest” result. |
| `optimizer_run_input` | run + typed source fact (`DEMAND`, `STOCK`, `RESERVATION`, `INBOUND`, `POLICY`, `ELIGIBILITY`, `COMMERCIAL`) + source identity + canonical JSON | Store actual inputs and source timestamps/checksums sufficient for replay. PII/commercial fields follow access policy. |
| `optimizer_demand_pool` | run, pool key, day, source kind/reference, `material_group_id`, demand quantity/base UOM, `pool_state` (`FIXED_MATERIAL`, `GROUP_UNALLOCATED`, `GROUP_ALLOCATED`, `EXCLUSIVE`) | Unique `(run, pool_key, day)`. `GROUP_UNALLOCATED` has no `material_id`; it cannot be promoted to a buy line until deterministic allocation is valid. |
| `optimizer_virtual_allocation` | run, day, material, SLoc, pool, quantity, allocation kind (`STOCK`, `INBOUND`, `TRANSFER`, `NEW_BUY`, `PROTECTED`) | Unique enough to prevent duplicate source use. It is a planning reservation only, never `reservation_document` or stock posting. |
| `optimizer_recommendation` | run, recommendation type (`BUY`, `TRANSFER`, `UNALLOCATED_GROUP_RISK`), material nullable for unallocated group, vendor/SLoc nullable, quantity/base UOM, status, priority, deterministic explanation codes | A BUY needs a material, vendor and validated order quantity. A group-risk line deliberately has no material/vendor. |
| `optimizer_recommendation_schedule` | recommendation, `po_by_date`, `requested_dispatch_date`, `estimated_plant_eta`, confidence, source/event references | Dates remain separately auditable; none means UNKNOWN, never today/zero. |
| `optimizer_recommendation_decision` | recommendation, `decision` (`ACCEPTED`, `IGNORED`, `SUPERSEDED`), reason, actor/time | Accepting is a planning decision only. It must not call PO/CSN/stock APIs. |
| `optimizer_commercial_evidence` | run, material/vendor/route, currency, landed-cost components, payment-term evidence, reliability measures, freshness/quality status | Raw input snapshot only; missing values are marked UNKNOWN/STALE, not defaulted to zero. |
| `optimizer_ai_usage_ledger` | provider/model, month bucket, reservation/settlement amounts, token usage, run/recommendation references, actor, status | Implements B13's server-side concurrency-safe budget reservation/settlement. No AI call may bypass it. |

## 4. Company, material and location policy model

1. **Company is the ACL and planning boundary.** Each source fact, policy and run belongs to one company. Cross-company production/transfer stays explicitly modelled as a future separately-approved event; it is never inferred from stock.
2. **Required location is formulation-derived.** For a demand pool, `stroke_line.default_storage_location_id` or `pack_bom_line.storage_location_id` defines the direct consumption destination. This preserves the PO22 source contract.
3. **CMP003 OT01 is a hard planning exclusion.** No OT01 balance, reservation, inbound, transfer source/destination or coverage credit may enter optimizer supply. The exclusion is effective-dated/configured, visible in evidence and tested—not a code literal.
4. **R/S/P are not blanket availability shortcuts.** The solver evaluates the source-derived required location plus `optimizer_location_policy`. Eligible remote R/S stock is a possible transfer source only after its own reservations, mandatory demand, policy and source-surplus test; it is never added directly to destination cover.
5. **Transfer feasibility is a state transition.** A suggested transfer consumes virtual source availability and has a destination available date. If operational execution is instantaneous, that date can equal the approved execution date, but unposted physical stock remains at the source until the transaction occurs.
6. **QA/Blocked/other restricted stock remains non-supply.** It may be shown as a risk/evidence line but cannot satisfy a demand constraint without a separately approved release event.

## 5. Demand-pool and exclusive-demand model

For every day `t`, PO22 produces source quantity `D[p,t]` for a fixed material line or a material group pool `p`.

- A fixed line is represented as one allowed material.
- RM Use Primary = Yes permits the Stroke line primary plus active group members, but preserves primary identity and source trace.
- RM Use Primary = No permits active members only. If no allocation is chosen, `pool_state = GROUP_UNALLOCATED` and its shortage remains on the pool.
- PM alternatives derive from active Pack BOM group relationships; no RM Use Primary setting is borrowed for PM.
- An exclusive/mandatory rule creates protected date-wise material demand before flexible pool allocation. Protection changes dynamically with valid forecast, policy and inbound changes; it is not a static “75 days” hold.
- A material that appears in multiple groups is one physical material/location balance. All allocations draw from the same material/location/day inventory state.

### Allocation variables and constraints

Let `x[p,m,l,t]` be material `m` allocated from location `l` to pool `p` on day `t`; `s[m,l,t]` be virtual available balance; `i[m,l,t]` confirmed dated inbound; `f[a,t]` approved transfer proposal; and `q[m,v,t]` new-buy quantity.

1. **Pool fulfilment:** `Σ(m,l) x[p,m,l,t] + h[p,t] = D[p,t]`. For unallocated flexible groups, `h` stays a group shortage, not a member shortage.
2. **Eligibility:** `x = 0` unless material is valid for the source Stroke/BOM/group/date and manual six-month policy permits consumption.
3. **Physical conservation:** a material/location unit can appear in at most one allocation at a time; balances roll forward as prior balance + arrived confirmed inbound + posted/approved feasible transfer arrival − allocations.
4. **Exclusive protection:** allocations to flexible pools cannot reduce a material below that date's protected exclusive demand plus required critical floor, unless the run explicitly reports an unavoidable prioritized shortage.
5. **Existing obligations:** current stock and confirmed PO/CSN/GE/lot events are always represented as supply evidence regardless of `EXCLUDE_NEW_BUY`; ETA/pending status controls when, not whether, they are visible.
6. **Location:** direct required SLoc is supply; remote SLoc needs a permitted transfer edge and source-surplus proof. OT01 has no solver edge.
7. **New buy:** `q` is zero unless material/vendor/route are active, lead time is known enough to meet the requested ETA or the line is labelled infeasible, and MOQ/multiple constraints hold.
8. **No hidden time travel:** stock starts from posted ledger at as-of; dispatch/arrival reflects actual CSN event state and current calculated plant ETA. An estimated arrival never becomes an actual arrival.

Use lexicographic objectives: (1) minimize mandatory production interruption and critical breaches; (2) minimize unallocated group risk and infeasible date gaps; (3) minimize excess inventory/avoidable transfers; (4) minimize deterministic commercial score only where evidence is complete; (5) prefer better supplier reliability as a transparent tie-breaker. The solver must report every relaxation, never conceal it in a single score.

## 6. Six-month material selection precedence

The six-month window is a manual planning control, not a deletion mechanism. It applies separately to **new buy**, **new consumption allocation**, and **existing supply evidence**.

1. Current date-effective approved Stroke/Pack BOM line establishes a baseline candidate.
2. Active group membership establishes technically possible alternatives only for that source line; membership alone does not prove an exclusive use is safe.
3. An effective manual optimizer eligibility policy has precedence for new-buy/new-allocation use within its stated six-month interval.
4. Explicit `EXCLUDE_NEW_BUY` blocks new tentative orders but retains existing stock, confirmed PO/CSN/lot and their risk in the timeline.
5. Explicit `EXCLUDE_CONSUMPTION` blocks new flexible allocation but does not make physically existing stock disappear; it is shown as blocked-by-policy evidence.
6. If source master and manual policy conflict or an end date is missing, state is `REVIEW`; no automatic allocation/buy recommendation is emitted.
7. Every run snapshots selected, excluded and review materials with the source rule and effective dates.

## 7. MOQ versus order multiple

MOQ is a lower bound on one vendor-material order. An order multiple is an indivisible increment; they are independent constraints.

| Case | Deterministic rule | Recommendation |
|---|---|---|
| Net new requirement 700 KG; supplier MOQ 1,000 KG; multiple 250 KG | `q >= 1000`, `q mod 250 = 0` | 1,000 KG. |
| Net new requirement 1,250 KG; MOQ 1,000 KG; multiple 600 KG | smallest multiple ≥ `max(1250,1000)` | 1,800 KG, with excess 550 KG explained. |
| Company minimum 1,000 KG but supplier permits 400 KG dispatch lot | Apply contractual/order MOQ to `q`; do not turn dispatch lot into MOQ | 1,000 KG order; schedule may model 400 KG dispatch only if PO/CSN evidence permits it. |

The existing PO22 policy table remains the manual Target/Critical/MOQ authority. Order multiples require a separate vendor-material commercial source; absent evidence means `multiple = UNKNOWN`, not 1.

## 8. Vendor, dispatch and ETA event model

`configured_total_lead_days` is an effective-dated order-release-to-plant-ETA duration and **already includes vendor processing**. The optimizer must not append another processing duration to it.

| Event / date | Meaning | Source and use |
|---|---|---|
| PO-by date | Latest release date to target estimated plant ETA under configured total lead time | Proposal only; `eta - configured_total_lead_days`. |
| Requested dispatch date | Requested supplier dispatch milestone on a proposed/confirmed PO | Stored separately; only derived when a verified component split exists. It is never treated as actual dispatch. |
| Actual dispatch date | Physical vendor dispatch | CSN/event evidence only. |
| CSN status | ORD/TRN/other lifecycle state, dispatched qty, partial receipt, mother/sub relation | Determines remaining confirmed supply and its confidence. |
| Updated plant ETA | Latest calculated ETA to plant for the applicable CSN | Current projected arrival; it can change between runs and must carry source/time. |
| GRN/posted receipt | Inventory fact | Removes future inbound and is reflected in ledger stock; never added twice. |

If total lead time is unknown, a buy candidate may be listed only as `ETA_UNKNOWN / not schedule-feasible`; it cannot receive an on-time coverage credit. Existing CSNs are always considered before proposed buying.

## 9. Commercial evidence and missing-data policy

Potential evidence sources are AC01 approved landed-cost/costing facts, PO/PO-line price and currency, approved freight/tax components, vendor payment terms, vendor-material mapping, lead-time masters, received-CSN observations, historical procurement samples, and—only when verified—dispatch/collection cash timing. These sources must be captured with effective date, currency, source identity and freshness.

- Missing landed cost/payment term/reliability/capacity is `UNKNOWN`, never zero or “best”.
- Production continuity constraints still run with unknown commercial values; economics cannot silently choose a supplier on incomplete evidence.
- Currency/FX, recoverable tax, credit limit, cash budget, vendor capacity and customer collection logic are unavailable until authoritative sources are verified.
- Commercial score must expose component values, missing reasons and weight/rule version. It cannot be an opaque AI score.

## 10. Planning-run API contract

All APIs are proposed and require new company-scoped resource/action entries. None shares PO creation access.

### Create deterministic run

`POST /api/procurement/mts-optimizer/runs`

```json
{
  "company_id": "uuid",
  "as_of_date": "YYYY-MM-DD",
  "plan_month": "YYYY-MM-01",
  "horizon_end": "YYYY-MM-DD",
  "demand_at": "ISO timestamp or null",
  "calibration_reference": { "ledger_date": "YYYY-MM-DD" },
  "scenario_label": "optional planner label"
}
```

Response contains immutable `run_id`, source fingerprint, policy versions, calculated pool rows, allocation/recommendation rows, exceptions, unknown data list, objective/relaxation results and no transactional document ID.

### Read and decide

- `GET /api/procurement/mts-optimizer/runs?company_id=...`
- `GET /api/procurement/mts-optimizer/runs/:run_id`
- `GET /api/procurement/mts-optimizer/runs/:run_id/recommendations`
- `POST /api/procurement/mts-optimizer/recommendations/:id/decision`

Decision body is `{ "decision": "ACCEPTED|IGNORED|SUPERSEDED", "reason": "..." }`. An ACCEPTED decision records planner intent only. It does not create a PO, CSN, transfer, reservation or stock movement.

A material buy response requires: material/vendor/route identity, base and purchase UOM quantity, MOQ and multiple evidence, PO-by, requested dispatch, ETA confidence, coverage before/after, risk/explanation codes, commercial evidence state and deterministic validation result. An unallocated group-risk response carries the pool identity and eligible candidates but intentionally no false material buy quantity.

## 11. AI Gateway contract and validation boundary

The existing AI foundation is not sufficient for planning budget/audit requirements. A planning-specific gateway must create a concurrency-safe budget reservation under the B13 USD 5/month hard cap before any provider call and settle actual usage afterward. Budget exhaustion disables AI only, not deterministic planning.

**Input:** a compact, ACL-filtered deterministic run/recommendation snapshot: IDs/labels, allowed candidate set, quantities, dates, policy/unknown flags, explanation codes and source fingerprint. It excludes unrestricted raw database access and gives the model no authority to query or mutate ERP.

**Output:** structured JSON limited to `explanation`, `risk_summary`, `evidence_references`, `ranked_existing_recommendation_ids`, `questions_for_planner`, and optional `proposed_quantity`/date fields.

**Validator:** rejects an output unless run ID/fingerprint match; referenced IDs belong to the company/run; quantities satisfy deterministic MOQ/multiple/eligibility/location/lead-time constraints; dates are feasible; no absent supplier/material is invented; and no field asks for a transaction. AI cannot turn a `GROUP_UNALLOCATED` pool into a material buy. Any failed numeric output is discarded and logged with a validation reason.

## 12. Acceptance tests

| Company / case | Acceptance condition |
|---|---|
| CMP003 OT01 | OT01 never contributes stock, inbound, transfer or coverage; report shows exclusion evidence. |
| CMP003 RDP Use Primary = No | Shortfall remains `GROUP_UNALLOCATED`; it is not attributed to lexical/UUID-first RDP member. |
| CMP003 exclusive RDP/DA1100-type case | Date-wise mandatory demand/protected floor is served before flexible alternatives consume shared material; all stock allocations sum to physical balance once. |
| CMP003 R/S remote stock | Source required SLoc cover excludes remote stock; transfer recommendation appears only with policy, surplus proof and an arrival date; it is not double-counted. |
| CMP003 litre SKU | Missing fixed L→KG conversion prevents consumption/buy numbers and produces a visible exception. |
| CMP005 PM in nonstandard location | Effective Pack BOM location plus company policy determines direct versus transfer treatment; no R/P prefix assumption. |
| CMP005 RDP/multi-group material | Existing PO/CSN and stock are consumed at most once across all pools; existing supply remains visible if material is excluded for new buy. |
| CMP011 40 KG multi-pack | Base-unit requirement and displayed pack provenance reconcile; a multiple/MOQ recommendation remains in procurement UOM. |
| All three companies | Company scope prevents reading/allocating another company's material, stock, policy, vendor or recommendation. |
| Future company onboarding | Add company ACL, source-verified MTS formulation, location policy and initial manual policies; no code fork or company code conditional. |
| Inbound lifecycle | Partial receipt, knock-off, Gate Entry, mother/sub-CSN, foreign consignee, updated ETA and unknown ETA follow current PO22 partitioning before optimizer supply. |
| Commercial unknown | Solver may flag production risk but cannot rank a vendor as cheapest/best from missing landed cost or payment data. |
| AI failure/budget exhaustion | Deterministic run persists; no provider call/transaction occurs; explanation is unavailable with an auditable reason. |

## 13. Chronological implementation sequence

1. Complete controlled DEV rollout of existing PO22 (`mts_requirement.logic.ts`, `mts_requirement.handlers.ts`, migration `20261016100000...`, ACL provisioning) and verify snapshot rebuilding. Do not start the optimizer before its foundation runs in DEV.
2. Freeze representative CMP003/CMP005/CMP011 PO22 source snapshots and obtain numeric UAT sign-off for current behaviour.
3. Implement and test append-only optimizer policy/run tables in `erp_planning`; verify exposed schema, RLS, route registry and ACL before any UI.
4. Implement a pure solver beside—not inside—`buildRequirementRows` in `supabase/functions/api/_core/procurement/mts_requirement.logic.ts`; retain PO22 contract tests unchanged and add optimizer-specific pure tests.
5. Implement source loaders by reusing `loadFormulationMasters`, `loadStockAndConsumption`, `loadReservations`, `loadInbound`, `loadLeadTimes`, `effectivePolicy`, and `canonicalJson` from the existing PO22 files, without copying or altering their semantics.
6. Add location/exclusive/eligibility policy maintenance only after owner decisions and dedicated WRITE ACL design.
7. Build read-only run/recommendation UI using `ErpDenseGrid` and the current PO22 detailed provenance pattern. Add accept/ignore audit only; no PO button.
8. Add commercial evidence and deterministic scoring only after sources/freshness rules are verified.
9. Add planning AI gateway, budget ledger, validator and ACL after deterministic recommendations pass UAT.

## 14. Decisions still requiring owner approval

1. Who may make the deterministic allocation choice for an uncovered RM Use-Primary-No/PM group pool, and what allocation modes are permitted?
2. Define exclusive/mandatory material protection at the exact Stroke/ProdShade/date grain and whether coverage floor is Critical, Target or another approved value.
3. Confirm CMP003 OT01 hard exclusion effective date and whether any exceptional OT01 flow can ever be introduced through an explicitly approved future policy.
4. Approve initial company/location policy records and which transfer routes require planner versus operational approval.
5. Confirm whether MOQ and order multiple are maintained per vendor-material-route, company-material, contract, or combination—and their precedence.
6. Confirm the accepted source and meaning of landed cost, payment-term cash date, FX, tax recoverability, cash budget, capacity and supplier reliability.
7. Confirm six-month eligibility ownership, review cadence and whether `EXCLUDE_CONSUMPTION` can override an active approved formulation source.
8. Decide what should happen when configured total lead time is unknown or conflicts with observed supplier performance.
9. Approve AI monthly reset timezone, model/provider price source, setting-change ACL and whether AI may return numeric suggestions at all after deterministic validation.
10. Define the future hand-off from an accepted recommendation to a PO draft, if any; this is explicitly out of scope for PO22 optimizer implementation.

## 15. Owner-review summary

Ready for review: a shared, company-configured optimizer shape; immutable run/audit model; group-pool-first shortage handling; explicit CMP003 OT01/location/transfer guardrails; MOQ/multiple semantics; separate PO-by/dispatch/ETA events; and a hard deterministic/AI boundary.

Outstanding: exclusive-demand business rules, group-pool allocation authority, location policy seed data, commercial evidence sources, six-month eligibility governance, and AI operational governance. No design item above is represented as deployed or authorized for implementation.
