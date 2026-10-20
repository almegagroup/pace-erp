# PO22 Implementation & Acceptance Snapshot

**Status:** SNAPSHOT ONLY, recorded 2026-10-19 from available GitHub commit evidence. Not a claim of latest branch SHA, deployment, completed UI, or PROD UAT. Always inspect current `agent/codex` and `docs/INTEGRATION-REGISTER.md` before making updates.

| Component | Code evidence / commit | State | Required acceptance |
|---|---|---|---|
| Existing PO22 requirements CM/NM | accepted main foundation | Baseline exists | Regression tests + real-world UAT; unchanged formulas |
| Phase 3A immutable normalization | accepted main foundation | Foundation exists | Evidence/UOM and company-safe normalization tests |
| Phase 3B lifecycle readers, selection, snapshot metadata | `74c406d8`, `40cc0b63`, `a256fe8a`, `4b1925cd` | Agent implementation; not automatically deployed | Source reconciliation, company ACL, migrations separately approved, live UAT |
| Phase 3C joint posted-stock fixed/group allocation | `2ba56276` | Core implemented in agent branch | Company-wise dated conservation and membership hardening |
| Phase 3C PO21/formulation source reader | `31029d43` | Read-only evidence extractor added | Exact effective plan-line/version -> demand lineage, no dropped records |
| Phase 3D daily coverage/advisory | `3c0ce204`, `f2ff8d5f` | **Partial core** | Target/Critical-driven arrival, full Min/Max, right-side projections and backtests |
| Demand evidence API | `4b1925cd` | Endpoint added on agent branch | Negative ACL/company-scope tests and UAT |
| Phase 3E UI/Store | no verified implementation in reviewed commits | Pending / verify current branch | Operational end-to-end user workflow |
| Phase 3F commercial optimizer/AI | no verified implementation in reviewed commits | Pending / verify current branch | Financially traceable alternatives, AI verification and backtesting |
| Integration register updates | `d50e1e02`, `910ec92e` and others | Exists on Codex agent branch | Exact latest commits, tests, acceptance state |

## Verified review issues (do not confuse with confirmed PROD bugs)
1. `mts_optimizer_phase3c.logic.ts` group candidates indexed by demand_source_key but exact group ID cross-check not assured by allocator itself in the reviewed `2ba56276` source; check newer changes before labeling outstanding.
2. `mts_optimizer_phase3d.logic.ts` reviewed `3c0ce204` source schedules proposed ETA as shortage day or horizon end, not policy-driven target day; full Planning/Prediction parity absent.
3. `mts_optimizer_phase3c_source.reader.ts:69-89` at `31029d43`: returns all loaded `plan_line_source_ids` rather than effective contributors; adapter source key does not carry exact effective `customer_plan_line.id` / version. Traceability gap; must not confuse with CM/NM formula regression.
4. `mts_optimizer_phase3c_demand.logic.ts:95-128`: group member ID/group/UOM guards implemented; add conflicting/duplicate source identity tests.
5. `mts_optimizer_phase3b.handlers.ts:99-125`: company scope and resource VIEW guard present for demand endpoint; negative access tests and deployed ACL remain unverified.

## Recorded historic test evidence (not independently rerun here)
- Post Phase 3C: 66/66 reported.
- Post Phase 3D: 71/71 reported.
- Post demand-source API: 78/78 reported.
Re-evaluate exact latest commit and full tests. No source-level passing count is business UAT.

## Live data / release gate
Owner permits bounded **read-only** PROD data inspection for verification because DEV lacks representative records. No PROD/DEV writes, migrations/ACL application, deployments, PO/CSN/GRN actions or branch promotions without owner authorization. Codex remains sole PO22 code implementation owner unless owner changes it.

## Format for all future updates
`Requirement | Decision status (approved/open) | Source IDs/joins | Exact code path/line | SHA | Test command + result | UAT evidence | Agent owner | Remaining blocker | Next action`.

Consolidate source references and true progress before claiming a 100% design. Never delete or silently relabel unresolved items. Same-branch concurrent writes prohibited pending documented coordination policy.
