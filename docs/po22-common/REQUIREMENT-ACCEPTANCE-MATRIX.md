# PO22 Business Acceptance & Progress Matrix
Status: IN PROGRESS — test evidence and business UAT are different. Always refresh commit SHAs from current `agent/codex`.

| ID | Requirement / exact decision | Design authority | Implementation evidence | Acceptance / gap |
|---|---|---|---|---|
| PO22-01 | Effective PO21 plan and unchanged CM/NM/NM days | Phase2D §1, §3 | `main` baseline; `31029d43` uses old explosion | Test against approved before/after output and PROD |
| PO22-02 | Company isolation & no automatic cross-company pooling | Owner later explicit Sub-CSN decision | Phase3B ACL/receiving evidence; Phase3C company snapshot | Negative cross-company + MOQ tests mandatory |
| PO22-03 | Cross-company movement only owner-created item-specific Sub-CSN | Owner explicit decision | `a256fe8a` STO evidence | Full source/destination lifecycle UAT pending |
| PO22-04 | Exact effective PO21 line/version -> SKU -> ProdShade -> formulation line | Phase2D §3 | `31029d43`, `4b1925cd` | Missing individual effective line ID/version attribution |
| PO22-05 | Stroke use-primary and PM group semantics | Phase2D §3 | `mts_optimizer_phase3c_demand.logic.ts` | Active effective source & member negative tests |
| PO22-06 | Member immutable ID, group identity, UOM / conversion | Phase2D §3 | Phase3C source adapter | Source-line ID conflict tests and PROD membership validation |
| PO22-07 | Shared stock exactly once among fixed/multi-group | Phase2D §3 | `2ba56276` | Cross-group & company grain tests, policy cases |
| PO22-08 | Material-null GROUP_POOL residual not fake member | Phase2D §3 | Phase3C logic | Existing test; test source handoff to 3D |
| PO22-09 | Posted unrestricted eligible R+S, exclusions, R003 | Phase2D §4 | Phase3A/B/3C pure logic | Company-SLoc configuration and ledger UAT |
| PO22-10 | Reservation fail-closed, no double deduction | Phase2D §4 | Phase3B/3C guards | Posted issue/reservation netting tests |
| PO22-11 | No incoming executable / GRN double count | Phase2D §1/4/7 | Phase3B lifecycle, Phase3C/3D type guards | Partial GRN and delayed ETA historical tests |
| PO22-12 | Optional R→R suggestion only | Phase2D §5 | No verified production UI in snapshot | Dest proof, advisory-only and no R→S tests |
| PO22-13 | Material Target/Critical and unknown policy | Phase2D §1/3 | `f2ff8d5f`; `2ac5bcb1` | Date-driven policy and material-by-company scope UAT |
| PO22-14 | Full daily planning + R:W predicted future consignments | Sheet formula source | `3c0ce204` partial daily engine | Full formula parity and corrected target trigger |
| PO22-15 | Supplier MOQ vs order multiple and dated split lots | Phase2D §7 | Phase3D basic constraints | Same-company supplier contract and 25+25 UAT |
| PO22-16 | Local/import, route, vendor, LC, payment and working capital | Phase2D §7/8 and owner VAE scenario | Not verified complete | Commercial source mapping and scenario solver |
| PO22-17 | Fixed coverage + group economic recommended allocation | Owner VAE example, Phase2D §3 | Physical greedy allocator only in reviewed commits | Datewise joint economic solver and alternatives |
| PO22-18 | CM+NM product-first Store report, dense UI & exports | Phase2D §2/6/9 | Pending as of reviewed commits | All header/detail/summaries no side panels |
| PO22-19 | No mandatory approvals, user-triggered rerun, snapshot trace | Phase2D §2/6 | Snapshot metadata partial | User workflow UAT |
| PO22-20 | Monthly six-month manual selection only new-buy gate | Phase2D §3/7 | Phase3B selection | Source month/company/version, stock still eligible on deselect |
| PO22-21 | AC01 DRAFT provisional / POSTED final landed cost | Phase2D §8 | No complete optimizer evidence | Trace GRN costs, tax and unit price, uncertainty |
| PO22-22 | AI explain/advice only, cost cap and deterministic rerun | Phase2D §8 | Pending | Budget/ACL and no AI numerical overrides |
| PO22-23 | Historical production, dispatch, demand and supplier performance | Owner planning discussions + Phase2D §11 | Source mapping unverified | Time-based backtesting |
| PO22-24 | Material/SKU/CSN month-specific manual overrides | Owner planning discussions | Pending verification | Source/actor/time and deterministic rerun |
| PO22-25 | Owner-report management exceptions and company-specific outputs | Owner planning discussions | Pending verification | Shortage/ETA/coverage/cash/report UAT |
| PO22-26 | No unauthorized operational writes, no unapproved migrations/deploy | Phase2D §1/12; owner instruction | API evidence guarded | Security tests and controlled release |
| PO22-27 | Actual Store instructions never overcommit scenarios | Phase2D §2/6 | Core allocator but no full UI | Detail totals = material/group summaries |
| PO22-28 | Import MOQ independently per company; no 12+8+5 combining | Latest owner clarification | No combined-company solver accepted | Explicit negative scenario regression |

## Phase 2D §10
The **original 22 numbered acceptance scenarios** in `docs/mts-planning/PO22-PHASE-2D-FINAL-OPTIMIZER-AND-STORE-CONTRACT.md` remain mandatory in their entirety. This matrix supplements them; it does not replace or reduce them.

## Latest work state
Consult `docs/INTEGRATION-REGISTER.md` on `agent/codex` for current working SHA and exact tests. New work on agent branch ≠ accepted `main` ≠ deployed PROD. No overall completion percentage inferred from unit-test count.
