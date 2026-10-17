# PO22 Requirement — Phase 1 Full Audit

**Audit date:** 2026-10-17  
**Repository baseline:** `agent/codex` `6919969054593037a3458a07a32410a2935499f9`  
**Method:** repository inspection plus read-only DEV (`ytapuwiqicmvpanmzelb`) and PROD (`bsjpvkigpllichlknmah`) queries. No database writes, migrations, deployment, merge, or PO22 calculation change was made.

## 1. Status and evidence boundary

`agent/codex` contains the recovered PO22 implementation. It is **not in the current remote main branch**: `origin/main` is `7ec7f247f923cf37bfaeba107e0e879df146d9c3`, an ancestor of the audited branch, and the PO22 diff is still branch-only. Therefore source code is not evidence of deployment.

Read-only environment checks on 2026-10-17 found the following in **both DEV and PROD**:

| Item | DEV | PROD | Conclusion |
|---|---|---|---|
| `erp_planning.material_requirement_policy` | absent | absent | PO22 Material Settings schema is not applied. |
| `erp_planning.save_material_requirement_policies(...)` | absent | absent | Settings save cannot operate. |
| PO22 migration `20261016100000` | not recorded | not recorded | PO22 is not database-deployed. |
| PO22 menu/resource/capability actions | absent | absent | PO22 cannot be provisioned into the ACL snapshot yet. |
| Historical procurement reference snapshot migration | absent | present | Historical lead-time data is not environment-parity evidence. |

This report uses “implemented” only for code on the audited branch; it never means deployed.

## 2. Feature matrix

| Area | State | Evidence / limitation |
|---|---|---|
| Dense keyboard-first Requirement UI | Implemented on branch | `frontend/src/pages/dashboard/procurement/planning/MtsRequirementPage.jsx:161`; report/detail grids and Excel export at `:413-556`. Not menu-provisioned in either environment. |
| PO21 effective monthly demand and historical `demand_at` | Implemented | `mts_requirement.logic.ts:156`, handler loader `mts_requirement.handlers.ts:300`; FINAL over ROLLING, plus ADDITIONAL and URGENT EXTRA. Stroke settings are current-state only, so they cannot be historically reconstructed. |
| Date-wise CM/NM demand and approved NM rule | Implemented and tested | `skuDailyDemand` at `logic.ts:229`; metrics in `logic.ts:1048-1254`; test T17. Rule is `min(NM days, max(0, Target - CM days left))`, not CMP003's legacy 15th-day switch. |
| SKU → ProdShade → Stroke / Pack BOM explosion | Implemented with exceptions | `explodeDemand` at `logic.ts:437`; formulation loaders at `handlers.ts:186`. Missing SKU KG conversion, stroke, dosage, location, Pack BOM, or PM conversion becomes an exception, not a fabricated quantity. |
| Multi-pack user-facing quantity | Implemented | Pack provenance from `logic.ts:616-650`, displayed/exported by `MtsRequirementPage.jsx:283-286,377`. It is presentation-only and does not alter base-unit math. |
| Material groups / Use Primary | Partial | One group pool, not copied to each member; primary decision resolves at `logic.ts:361`. See verified uncovered-pool attribution defect in §5. |
| Exclusive/mandatory material protection | Missing | There is no data model or allocation constraint for protected/exclusive demand by ProdShade, time period, coverage floor, or next consignment. |
| Required-SLoc stock / QA / Blocked / reservations | Partial | Correctly separates stock types and deducts OPEN/PARTIAL reservations only when as-of is today (`logic.ts:694`, `handlers.ts:354,381`). It lacks an explicit CMP003 location eligibility/OT01 policy. |
| Open PO, partial receipt, Gate Entry, CSN/Sub-CSN, lots, ETA | Implemented for current inbound calculation | `loadInbound` at `handlers.ts:395`; `partitionPoLineInbound` at `logic.ts:861`. It caps all components to open PO balance, excludes mother CSNs with children and foreign consignee CSNs, and leaves ETA missing/overdue out of on-time cover. |
| MOQ, coverage and effective-dated policy history | Code complete, DB unavailable | append-only migration `20261016100000...sql:29-243`, handlers `:876-1047`. Supports minimum floor only, not order multiples. |
| Six-month eligibility | Missing | Current universe is current approved MTS Strokes, Pack BOMs, and active group members; there is no six-month look-back / look-forward evidence contract. |
| Lead time | Partial | Configured vendor route + received ERP CSN + historical samples at `handlers.ts:502`; no supplier performance confidence, vendor processing time, price, payment, freight, or working-capital model. |
| Historical procurement evidence | Partial / environment-dependent | Reader is called in `handlers.ts:510`; PROD has the reference-snapshot table, DEV does not. History is evidence only and never current supply. |
| ACL and route registry | Code prepared, unapplied | routes at `route-acl-registry.ts:376-380`, route dispatcher `procurement.routes.ts:798-806`, proposed provisioning in `docs/mts-planning/acl/MTS-REQUIREMENT-ACL-PROVISIONING.sql`. |
| Automatic purchase order creation / AI numeric orders | Deliberately absent | Correct for this phase. No PO mutation path exists in PO22. |

## 3. Source contracts actually used

| Domain | Tables/functions and relevant fields | PO22 use |
|---|---|---|
| PO21 | `erp_planning.customer_plan_line`: `company_id`, `plan_month`, `sku_material_id`, `plan_type`, `version_no`, `is_current`, `base_qty`, urgent fields, `is_cancelled`, `created_at`; `customer_plan_effective(company_id, months)` | Effective SKU-month demand; PO22 loader performs the version reconstruction. |
| Formulation | `erp_production.stroke_master`, `mts_current_stroke`, `stroke_line`: material/group/alternate, dosage, default SLoc; `stroke_plan_setting`, `stroke_plan_period`, `stroke_group_primary_decision`; `pack_bom`, `pack_bom_line` | RM stroke and PM Pack BOM explosion. Direct `alternate_material_id` is explicitly ignored, with a warning. |
| Master/group/UOM | `erp_master.material_master`, `material_uom_conversion`, `material_category_group_member`, `material_category_group` | RM/PM eligibility, fixed conversion, active group candidate list. Group members are lexically sorted in `logic.ts:380-386`. |
| Stock/consumption | `erp_inventory.get_stock_history(company, from, to, ..., material_ids, ...)`; `erp_production.reservation_document` | Start-of-as-of ledger stock and net P261−P262 consumption; only UNRESTRICTED at master-derived required locations is usable. |
| Inbound | `erp_procurement.purchase_order`, `purchase_order_line`, `gate_entry`, `gate_entry_line`, `consignment_note`, `po_lot_balances` | Mutually exclusive GE / dispatched CSN / lot / PO-remainder events, with ETA buckets. |
| Policy | proposed `erp_planning.material_requirement_policy` | Per company/material effective Target, Critical, MOQ source/value/UOM, append-only revisions. Not applied. |
| Historical lead time | `erp_history.purchase_order`, `purchase_order_line`, movements and `public.history_lead_time_samples(company)` | Observed historical evidence only; no current stock or open supply effect. |
| ACL | `erp_menu.menu_master`, `erp_menu.menu_tree`, `acl.menu_master`, `acl.capability_menu_actions` | Proposed page VIEW and companion policy WRITE grants, then new version/snapshots. Not applied. |

## 4. Calculation contracts that should be preserved

1. PO21 remains read-only. The report computes from append-only plan versions and does not write back a plan.
2. CM stock is the posted ledger balance at the start of the selected as-of date; CM consumption is separately reported, not subtracted twice from forecast demand.
3. QA, Blocked, and other stock types remain visible but unusable. Other locations remain transfer candidates, not instant supply.
4. PO-side open quantity is a ceiling: Gate Entry, CSN, lots, and PO remainder are partitioned rather than added together. Unknown ETA is not supply today.
5. Target/Critical and MOQ are individual-material, company-scoped, effective-dated policy—not group defaults and not inferred from historical PO size.
6. The approved coverage-based NM formula is retained unchanged.

## 5. Verified defects and material risks

### A. Uncovered group demand can be assigned to a default candidate — **verified defect**

`activeMembers()` sorts eligible members by material ID (`logic.ts:380-386`). For an RM group with Use Primary = No, `explodeDemand()` sets `candidates = [...members]` (`logic.ts:546-552`). `allocateDemand()` then defines `target = record.candidates[0]` and attributes all unfilled demand to that target (`logic.ts:782-813`). Thus the unfilled pool is placed on the first sorted group member even though no primary has been approved. The same first-candidate design is used for PM groups.

This does not double-count demand, but it produces a false material-level shortage/purchase signal. A future optimizer must retain the shortage as a group-pool requirement until it has a deterministic, approved allocation decision. Do **not** solve it with percentages or lexical ordering.

### B. CMP003 OT01 / R- and S-series policy is not encoded — **verified gap**

The engine has no OT01 exclusion or location-class eligibility rule. It treats a location as usable only if it is named on an effective Stroke/Pack BOM line; every other unrestricted location is shown as transfer-only (`logic.ts:694-781`). This happens to avoid unrelated locations, but it cannot prove that OT01 is always excluded or that eligible R/S stock is selected without double count. A location-policy source and transfer feasibility model are required before calling CMP003 coverage production-safe.

### C. Real CMP003 group complexity exists — **verified PROD evidence**

Read-only PROD inspection found 104 grouped approved MTS stroke lines spanning 20 groups for CMP003; RDP itself has five active members. The `RDP`, `RDP_PLC`, `RDP_TLA`, and other RDP-related groups appear in approved CMP003 strokes. This is not a hypothetical edge case. No direct-alternate line was present in that sample, but the code's explicit direct-alternate exclusion remains a general gap.

### D. Material shared between groups has no global eligibility/protection model

The allocator subtracts shared physical stock as it processes pools, which prevents stock duplication. But it has no constraint describing whether a member is eligible in every group, whether it must be protected for an exclusive formulation, or what priority/date/coverage rule wins. Pool order is deterministic but is not a business optimization objective.

### E. Commercial optimization inputs are absent

PO22 does not load landed price, tax/freight, payment-term cash date, credit limit, working-capital budget, vendor capacity, vendor processing lead time, supplier OTIF/quality performance, or confirmed vendor MOQ/order multiple. It cannot safely claim financial impact or choose an economically preferred vendor.

### F. Deployment and historical-data readiness are incomplete

The policy schema, API save RPC, menu, resources, capability actions and snapshots do not exist in DEV or PROD. Historical procurement schema is also behind in DEV. Even a perfect branch build cannot provide a usable PO22 report until a controlled DEV rollout applies and verifies these prerequisites.

## 6. Production-safe shared optimizer architecture

The next system should be a separate, deterministic planning layer—not a replacement for `buildRequirementRows`.

```text
PO22 immutable run input
  ├─ demand timeline + formulation eligibility
  ├─ material/location stock and reservations
  ├─ existing inbound event timeline
  ├─ approved coverage/MOQ/order-multiple/vendor policy
  └─ commercial and supplier-performance evidence
             ↓
deterministic feasibility + allocation solver
  ├─ virtual, run-scoped allocations/protected floors
  ├─ group-pool shortage left unassigned until eligible allocation chosen
  ├─ transfer proposals with source/destination/date feasibility
  └─ buy candidates with release date, ETA, quantity and reason
             ↓
validated recommendation snapshot (immutable inputs/fingerprint/rules/version)
             ↓
AI explanation/ranking only; deterministic validator accepts/rejects every number
```

Required solver constraints: material/location/day conservation; group and exclusive eligibility; stock counted once; existing PO/GE/CSN/lot precedence; receipt/ETA confidence; MOQ and order multiple semantics; vendor-material eligibility; lead-time/release-date feasibility; capacity/cash constraints; and no implied transfer. Objective sequencing should first minimize stock-out/critical breaches, then excess coverage/working capital, then landed cost and supplier risk. An AI component may explain or rank deterministic candidates, but may never create a numeric order independently of this validator.

## 7. Proposed migrations and API contracts (design only)

1. **Complete PO22 foundation deployment first:** apply `20261016100000`, run the approved ACL provisioning, create fresh company ACL versions, capture/generate/activate snapshots, rebuild affected menu snapshots, and verify the route/API contract.
2. **`erp_planning.requirement_run` and child input/snapshot tables:** immutable run metadata, as-of/time horizon, source fingerprint, rule version, warnings, solver status, actor and provenance. Never mutate PO21, stock, PO, CSN, or policy history.
3. **Eligibility and protection tables:** effective-dated group member applicability by Stroke/Pack BOM/ProdShade, explicit primary-or-pool ownership mode, exclusive/protected material rule, and allowed storage-location classes. No default candidate and no percentage allocation.
4. **Location/transfer feasibility:** source/destination, allowed direction, lead time, capacity/handling and approval state. It must distinguish immediately usable stock from a recommended transfer.
5. **Vendor commercial evidence:** material-vendor route, vendor MOQ vs order multiple, processing/transit distributions, landed-cost components, payment terms and source/quality timestamps. Retain raw evidence; do not overwrite master facts from a recommendation.
6. **Recommendation tables:** material/location/vendor quantities, recommended PO release date, ETA-to-plant, coverage/risk/cash impact, deterministic explanation codes, and accepted/rejected/superseded status. They are proposals only; a later explicitly-authorized workflow may turn an accepted proposal into a PO draft.

Suggested read APIs: `GET /mts-requirement/runs`, `POST /mts-requirement/runs` (compute/snapshot only), `GET /mts-requirement/runs/:id`, and `GET /mts-requirement/runs/:id/recommendations`. Suggested write APIs require a separate recommendation-maintenance resource and must never call a PO creation endpoint.

## 8. Chronological implementation plan

1. Controlled DEV rollout of existing PO22 schema/ACL/API/frontend, with migration and snapshot checks; no production rollout.
2. Establish a frozen CMP003/CMP005/CMP011 UAT source snapshot and reconcile PO22 report quantities before adding optimizer behavior.
3. Resolve the uncovered group-pool ownership defect as a data/rule model, then add deterministic tests before changing allocation output.
4. Define CMP003 location eligibility: OT01 treatment, R/S eligibility, transfer conditions, and reservation ownership; add storage-location acceptance tests.
5. Add six-month eligibility/history evidence and explicit exclusive/protection rules.
6. Add vendor/commercial evidence with source quality and effective dates.
7. Build a pure optimizer and its database-backed immutable input/output snapshots; test it independently of React and AI.
8. Add AI explanation/ranking behind deterministic validation and human accept/ignore controls.
9. Only after UAT: consider a separately approved conversion from accepted recommendation to PO draft. Never auto-create a PO.

## 9. Test matrix

| Test | Current state | Required before optimizer UAT |
|---|---|---|
| T1 company/ACL isolation | partial DB coverage planned | run against applied DEV ACL snapshot for all three companies. |
| T2/T3 stroke periods and Use Primary | unit test passes | use actual CMP003 RDP periods and saved primary decisions. |
| T4/T5 shared material / count once | unit test passes | one material in multiple groups and an exclusive requirement must prove no silent reassignment. |
| CMP003 RDP, Use Primary = No | missing | assert shortage remains a group-pool shortage—not first UUID/lexical member. |
| CMP003 RDP + exclusive material | missing | protect exclusive date-wise demand before drawing shared alternative stock. |
| CMP003 OT01/R/S locations | missing | OT01 excluded; eligible R/S only under approved location/transfer policy; no double count across locations. |
| T7–T9 Pack BOM, pack unit, UOM | unit test passes | include multi-pack SKU and CMP003 litre-base exception: fail visibly until fixed L→KG conversion exists. |
| T11/T12 stock and reservations | unit test passes | live-like QA/Blocked/reserved/other-SLoc/transfer cases. |
| T13/T14 inbound partition/ETA | unit test passes | partial GRN, knock-off, Gate Entry, mother/sub-CSN, cross-company CSN, missing ETA. |
| T17 NM formula | unit test passes | retain approved coverage-based formula for CMP003/CMP005/CMP011. |
| T18/T19 policy/MOQ | code tests plus unapplied SQL test | distinguish vendor MOQ, company minimum and order multiple; test policy revision history. |
| Lead-time/financial impact | missing | verify observed supplier data, landed price/payment terms, data freshness and unknown handling. |
| Determinism/audit replay | T21 passes for PO22 | optimizer run must reproduce from the frozen input fingerprint. |

Current automated evidence: `deno test --no-check .../mts_requirement.logic.test.ts` passed **20/20** on this branch; `deno check` passed for the PO22 logic and handler. These checks do not demonstrate environment deployment or real-data UAT.

## 10. PO23 reuse candidates

PO23 can reuse PO22's pure effective-demand calculation, day timeline/calendar, SKU/ProdShade/Stroke/Pack BOM extraction, fixed UOM conversion guard, stock ledger/reservation partitioning, inbound event partitioning, coverage projection, policy effective-date lookup, lead-time evidence, canonical input fingerprint and grid/export conventions. It must not reuse the current default-target group allocation for new purchase recommendations.

## 11. Business decisions still required

1. For Use Primary = No and PM groups, who owns an uncovered group-pool shortage before a procurement allocation is approved?
2. Which material/group lines are exclusive or mandatory for which ProdShade/date range, and what coverage floor protects them?
3. CMP003: exactly which OT01, R-series and S-series locations are eligible; when is transfer feasible, how long does it take, and who approves it?
4. Is a material group membership alone sufficient technical eligibility, or must formulation/QA approve alternatives at Stroke/ProdShade level?
5. Are MOQ and order multiple distinct? If so, which source wins: vendor commitment, company policy, contract, or pack/transport constraint?
6. What is the authoritative commercial model for landed price, payment date, working-capital budget and vendor capacity?
7. What supplier-performance metrics, periods and minimum sample counts are acceptable for recommendation ranking?
8. What six-month eligibility rule should retain materials not in the current formulation but with valid pending demand/inbound obligations?
9. What is the owner-approved definition of a recommended PO date and ETA-to-plant when the vendor processing component is unknown?
10. What human workflow may accept a recommendation, and must that acceptance create only a PO draft or no PO at all?

## 12. Audit conclusion

PO22 is a useful deterministic requirement-report foundation on `agent/codex`; its CM/NM, coverage, stock separation, inbound partitioning and traceability contracts are substantial. It is not deployed and is not yet a production-safe procurement optimizer. The first blocker for controlled DEV UAT is deployment of the already-reviewed schema and ACL through the approved sequence. The first blocker for individual-material purchase recommendations is the unresolved/incorrect ownership of uncovered group pools, followed by explicit exclusive-material and CMP003 location/transfer rules.
