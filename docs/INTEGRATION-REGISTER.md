# PACE ERP Integration Register

> **Canonical integration source of truth.** This document records the only
> accepted baseline, all active agent-branch work, its evidence, and the next
> lawful action. It does not claim a branch is deployed merely because code
> exists there. Update this register in the same commit as every phase or
> cross-branch decision.

## Control rules

- `origin/main` is the production-code baseline. `origin/dev` is an integration
  lane only; neither is changed without the owner's explicit promotion approval.
- `agent/codex`, `agent/chatgpt`, and `agent/claude` are work lanes, never
  production-complete baselines.
- The exact fast-forward-only procedure in `docs/BRANCH-WORKFLOW.md` governs
  every promotion. Rebase, cherry-pick, force-push, reset, and conflict-only
  merge commits are prohibited.
- A branch may be promoted only when `origin/main` is its ancestor. If it has
  diverged, its verified behavior must be reimplemented linearly on the current
  authorized owner's branch and tested; its history is never merged around.
- An entry is **accepted** only after the owner authorizes the prescribed
  `agent/* → dev → main` fast-forward promotion and all corresponding SHAs are
  equal. A test result on an agent branch is evidence, not acceptance.
- Every new agent task must first add or update a row below, identify touched
  module/file territory, record exact commit(s), test commands/results, and
  name one owner. This applies to PO22 and every other PACE ERP module.

## Current baseline snapshot

Recorded: 2026-10-19, after `git fetch origin --prune`.

| Ref | SHA | Relation to `main` | Integration meaning |
|---|---|---|---|
| `origin/main` | `4cf13ff3a664793734f6dc151ed44ff4da1b6cd6` | baseline | Production-code baseline; no deployment claim. |
| `origin/dev` | `4cf13ff3a664793734f6dc151ed44ff4da1b6cd6` | identical | Integration lane currently aligned with `main`. |
| `origin/agent/codex` | `4a8f091e` | `main` is ancestor; Codex-only commits ahead | Linear work lane; no promotion is authorized. |
| `origin/agent/chatgpt` | `02e2243ac0b3b90ff49cff5d05a56063747b68c0` | diverged at `9ac1e467`; `main` +1 / branch +5 | Not directly promotable; preserve as review evidence only. |
| `origin/agent/claude` | `cbe1e957977519879cf7ec24e699e5d59a68fd49` | diverged at `8c17b9b3`; `main` +31 / branch +3 | Not directly promotable; contains an historic merge commit and must not be merged around. |

Open PR evidence at the time of record: PR #675 (`agent/claude → main`) is
**closed** and was reported conflicting; no open PR is an approved substitute
for the fast-forward process.

## PO22 canonical progress and decision register

| Feature / contract | Evidence branch and commit | Status | Accepted baseline? | Test evidence | Open issue / blocker | Next action / owner |
|---|---|---|---|---|---|---|
| PO22 requirement engine, CM/NM, approved NM Requirement Days, Material Settings | `main`: `12762593`; historic equivalent `agent/claude`: `ec8758bf` | Complete code baseline | **Yes**, code-equivalent content is in `main`; historic Claude SHA itself is not integrated | Existing requirement regression suite (20 tests) passes on Codex Phase 3B branch | Real-data UAT and ACL/migration rollout remain separately gated | Preserve contracts; Codex owns future PO22 work |
| Multi-pack user-facing unit/quantity display | `main`: `69199690` | Complete code baseline | **Yes** | Included in accepted `main` history; no new change in this phase | UI business UAT remains outside this branch register | Verify only when PO22 UI UAT is authorized |
| Phase 2D optimizer/store contract | `main`: `843b47f` | Approved design | **Yes**, as a design contract | Document review contract, not deployment evidence | No solver implementation | Codex uses it as Phase 3+ contract |
| Phase 3A normalization, immutable snapshots, fail-closed UOM/stock/inbound policy | `main`: `c7dfe79e`, `dc4a24e6` | Complete source-contract foundation | **Yes** | 13 normalization tests included in current 57-test run | Real source extraction remains a dependency | Codex preserves and regresses before every later phase |
| Phase 3B pure adapter / table migration foundation | `main`: `ba8aca7e`, `02e4d6cd` | Partial accepted foundation | **Yes** for pure contracts/table migration only | 13 Phase 3B logic tests included in current run | API/reader/selection save were not in accepted baseline | Codex adds controlled implementation below |
| Phase 3B physical identity readers (PO, GE, CSN/sub-CSN, GRN, lot, reservation, ledger), company scope, selection API, snapshot persistence | `agent/codex`: `74c406d8`, `40cc0b63`, `4b1925cd`; overlapping review evidence `agent/chatgpt`: `e3247a24`…`02e2243a` | Implemented on Codex branch; reimplemented linearly, not history-integrated | **No** — pending explicit fast-forward promotion | 78/78 Deno tests; direct handler/source-reader checks and ACL/company-scope guards pass | Bounded read-only production reconciliation confirmed PO/GE/GRN identity joins and identified STO CSNs as a separate, valid consignee-owned lifecycle family. PO21/formulation demand evidence is now exposed by a company-scoped VIEW endpoint. Persisted combined run assembly and approved migration/ACL application remain pending. | Assemble only verified evidence into a snapshot; Codex remains implementation owner |
| Procurement — PO delivery-date to CSN ETA cascade | `main`: `c494886d`; `agent/codex` task workspace | Implemented on agent branch | **No** | `deno test --no-check --allow-env .../csn.eta.logic.test.ts`: 3/3 pass; `deno check .../csn.handlers.ts`: pass | Delivery date remains optional. A PO delivery-date amendment now refreshes every linked CSN's ETD/ETA, while the existing CSN edit path already recalculates from ETD and LR date. Production backfill for PO 208 still requires the business delivery date. | Commit and promote only through the required fast-forward flow, then backfill PO 208 after its delivery date is supplied. |
| PO21 effective plan-line version attribution per demand (defect #1) | `d42e60a` on top of `agent/codex` `910ec92` | Implemented by Claude on the Codex line | Promoted to `dev`, **not** `main` | 84/84 Deno tests (78 existing unchanged + 6 new), `deno check` clean, all CI guards pass | Attribution only — CM/NM/`buildRequirementRows()` numbers unchanged (regression test). Adapter fails closed with `PLAN_LINE_ATTRIBUTION_MISSING`. Reader `plan_line_source_ids` = effective versions only (+ `loaded_plan_line_count`). | Codex continues PO22 from `origin/dev` |
| Phase 3C fixed/group joint dated allocation | `agent/codex`: `2ba56276`, `2ac5bcb1`, `31029d43` | Core deterministic allocator plus verified demand-evidence adapter implemented on Codex branch | **No** — pending explicit fast-forward promotion | 78/78 Deno tests after the adapter | PO21 plan versions, Stroke Lines, Pack BOM INPUT lines and group-member identities now flow through a read-only source reader. Source-to-stock/snapshot run assembly and a complete PM group eligibility decision remain pending. | Assemble verified demand/stock/inbound evidence into one snapshot; Codex |
| Phase 3D coverage, consignments, MOQ/order multiple, PO-by / ETA recommendations | `agent/codex`: `3c0ce204`, `f2ff8d5f`, `2ac5bcb1` | Daily coverage and advisory buy core implemented on Codex branch | **No** — pending explicit fast-forward promotion | 73/73 Deno tests, including ETA, unallocated group pool, MOQ/multiple, lead-time, missing-policy and coverage-driven arrival cases | Demand reader now exists but is not yet assembled with a persisted snapshot. It never treats projected arrival as executable Store stock; missing Target/Critical remains `UNKNOWN_POLICY`; Critical/Target breach drives ETA rather than first negative balance. Real vendor/route terms are still required for commercial scenarios. | Connect only verified snapshots and commercial evidence; Codex |
| Phase 3E PO22 planning UI, Store instructions, export/exceptions | None | Pending | No | Not started | Depends on 3D deterministic outputs and ACL rollout | Sequentially after 3D; Codex |
| Phase 3F commercial optimization, AI scenarios and backtesting | None | Pending | No | Not started | Depends on deterministic 3C–3E outputs and verified commercial sources | Sequentially after 3E; Codex |
| PO22 monthly member selector — complete group candidates | `agent/codex`, on top of `dev` `71eeb693` | Implemented for direct owner request (2026-10-22) | Promoted to `dev`, not `main` | `deno check .../mts_planning.handlers.ts`; PO22 regression suite **88/88**; frontend selector ESLint pass | No database write or migration is required. Older saved planning runs use the existing sparse-group fallback; recalculate to receive complete candidates. | User UAT: each displayed shortage group must show its active mapped members and allow month-by-month selection. |
| PO22 4A group-attribution and Excel display labels | `agent/codex` `8b6be27d`, on top of `dev` `d5f79eed` | Implemented for direct owner request (2026-10-22) | Promoted to `dev`, not `main` | `deno check .../mts_item_plan.handlers.ts`; relevant planner suite **40/40**; frontend Excel workbook **4/4** and selector/export ESLint pass | No migration. The Item Plan's expanded day detail now exposes only resolved group labels; Excel refuses UUID-shaped company labels and uses the server/runtime human label fallback. | User UAT: open a date with group use and download the workbook; no UUID appears in either surface. |
| PO22 4A Excel clipboard copy | `agent/codex` `275ca8e8` | Implemented for direct owner request (2026-10-22) | Promoted to `dev`; `main` remains blocked by its divergent shared history | Focused ESLint: **0 errors** (2 existing `ErpDenseGrid` warnings); `node --input-type=module` clipboard TSV assertion passes; `npm.cmd run build` passes | No migration. All PO22 Item Plan dense grids now copy their currently visible (filtered) rows with headers; manual tables in Your lots, vendor comparison, What-if Safety and AI results use the same tab-separated Excel format. Full repository lint still has pre-existing unrelated errors. | User UAT: click **Copy table + headers**, then paste into Excel and verify the first row is the table header. |
| PO22 selection-authorised buys and INR cost display | `agent/codex` (`82638121`) | Promoted to `dev` (2026-10-22) | `agent/codex` and `origin/dev` at `82638121`; `main` remains blocked by its divergent shared history | Family planner / planning / cost logic tests **31/31**; both planning and Item Plan handler checks pass; frontend build passes | No migration. An unchecked displayed member cannot receive a new own-use or group engine lot; its stock/inbound still remains available. Planning reads MM03's default vendor-material currency when legacy last-purchase currency is blank, then applies the dated INR FX; unknown currency/FX remains an explicit cost gap rather than a false ₹ value. | User UAT: leave Wacker unchecked and recalculate—no Wacker future lot; validate USD cost is shown in INR with a valid FX rate. |
| PO22 CC-date posted GR arrival visibility | `agent/codex` `3be4d398`, fast-forwarded to `dev` (2026-10-22) | Promoted to `dev` | **No** — `main` is divergent, so a fast-forward release is not lawful | Requirement + Item Plan Deno tests **64/64**, family-planner tests **8/8**, direct handler/type checks pass, frontend build passes | No migration. Requirement stock opens at the start of the CC date, so a GR posted on that same date was previously neither opening stock nor an inbound ETA event. The loader now emits every matching posted GR as an `Actual GR` ETA-to-plant event on that CC date, with bounded/paged reads and UOM conversion. | User UAT: set CC date to a day with a posted GR and verify its quantity and **Actual GR** label on that date; verify the closing balance reconciles to opening + same-day GR − use. |
| PO22 missing-PO21 demand rule | `agent/codex` `94d2997d`, fast-forwarded to `dev` (2026-10-22) | Promoted to `dev` | **No** — `main` is divergent, so a fast-forward release is not lawful | PO22 Deno regression suites **91/91**; Item Plan / Planning handlers type-check; frontend lint and build pass | Owner decision: when a horizon month has no PO21 plan, demand is exactly zero. Historical forecast values may remain analytical only; they cannot enter BOM explosion, coverage, or a buy recommendation. The Item Plan labels these months `No PO21 plan` rather than incorrectly calling them Plan or Forecast. | User UAT: for a month with no PO21 line, verify zero pro-rata use, no engine lot caused by that month, and the `No PO21 plan` demand label. |

### Phase 3B equivalence decision

`agent/chatgpt` contains five unintegrated PO22 commits. Its changed Phase 3B
files overlap with Codex's reader/receiving files. It is not a fast-forward
candidate, so no merge, rebase, or cherry-pick is allowed. Codex has retained
the verified behavior as a clean reimplementation and extended it with CSN,
GRN, selection, persistence, route, and ACL boundaries. The canonical future
source is therefore `agent/codex` commits `74c406d8` and `40cc0b63`, subject to
the acceptance rule above. The ChatGPT branch remains immutable comparison
evidence.

`agent/claude`'s `ec8758bf` implementation is content-equivalent to the
accepted `main` commit `12762593`; it is not an integration candidate. Its
remaining documentation conflict-resolution commit must not be used to bypass
the branch workflow.

### Read-only production reconciliation evidence

On 2026-10-19, bounded `SELECT` queries against the owner-authorized
production project inspected only schema presence, company-scoped aggregate
counts and lifecycle referential integrity for CMP003, CMP005 and CMP011. No
credentials, identifiers, quantities or commercial values are retained here.

| Purpose | Source tables | Outcome |
|---|---|---|
| Verify Phase 3B source availability | Planning, procurement, production and inventory tables named in the Phase 3B contract | Required source families exist; selection and snapshot tables are present but contain no run evidence yet. |
| Verify PO/GE/GRN receiving lineage | `purchase_order_line`, `gate_entry_line`, `goods_receipt` | Bounded consistency checks found no missing matched receiver-GRN lineage for posted gate evidence. |
| Verify CSN ownership rule | `consignment_note`, PO and STO lineage fields | Direct PO CSNs had expected PO-line lineage. Valid STO CSN patterns had no PO line by design and proved consignee ownership; reader now represents them separately and never mixes them with PO-line CSN evidence. |

These checks are source-contract evidence only. They neither produce an input
snapshot nor authorize a quantity, recommendation, migration, ACL change or
operational action.

### Recorded PO22 validation evidence

| Commit range | Exact command / check | Result |
|---|---|---|
| `74c406d8` + `40cc0b63`, rerun after register creation | `deno test --no-check supabase/functions/api/_core/procurement/mts_optimizer_phase3b_receiving.logic.test.ts supabase/functions/api/_core/procurement/mts_optimizer_phase3b.persistence.test.ts supabase/functions/api/_core/procurement/mts_optimizer_input.logic.test.ts supabase/functions/api/_core/procurement/mts_optimizer_phase3b.logic.test.ts supabase/functions/api/_core/procurement/mts_requirement.logic.test.ts` | **57 passed, 0 failed** |
| `74c406d8` + `40cc0b63` | `deno check` over the new receiving, source-reader, persistence and handler modules | Pass |
| `74c406d8` | `node scripts/route-acl-registry-guard.mjs`, `node scripts/company-scope-guard.mjs`, `node scripts/company-scope-write-acl-guard.mjs` | Pass; existing unrelated registry warnings retained |
| `74c406d8` | `npm.cmd run build` in `frontend/` | Pass; existing duplicate JSX attribute and bundle-size warnings retained |
| `74c406d8` | `deno check supabase/functions/api/_routes/procurement.routes.ts` | Not a Phase 3B failure: 96 pre-existing errors in unrelated procurement handlers. New direct modules type-check cleanly. |
| `2ba56276` | `deno check supabase/functions/api/_core/procurement/mts_optimizer_input.types.ts supabase/functions/api/_core/procurement/mts_optimizer_input.logic.ts supabase/functions/api/_core/procurement/mts_optimizer_phase3c.types.ts supabase/functions/api/_core/procurement/mts_optimizer_phase3c.logic.ts` | Pass |
| `2ba56276` | Combined Phase 3A/3B/3C/PO22 `deno test --no-check` suite | **66 passed, 0 failed** |
| `2ba56276` | `npm.cmd run build` in `frontend/` | Pass; existing duplicate JSX attribute and bundle-size warnings retained |
| `3c0ce204` | Combined Phase 3A/3B/3C/3D/PO22 `deno test --no-check` suite | **70 passed, 0 failed** |
| `f2ff8d5f` | Combined Phase 3A/3B/3C/3D/PO22 `deno test --no-check` suite | **71 passed, 0 failed** |
| `2ac5bcb1` | Combined Phase 3A/3B/3C/3D/PO22 `deno test --no-check` suite | **73 passed, 0 failed** |
| `31029d43` | `deno test --no-check supabase/functions/api/_core/procurement/mts_optimizer_input.logic.test.ts supabase/functions/api/_core/procurement/mts_optimizer_phase3b.logic.test.ts supabase/functions/api/_core/procurement/mts_optimizer_phase3b_receiving.logic.test.ts supabase/functions/api/_core/procurement/mts_optimizer_phase3b.persistence.test.ts supabase/functions/api/_core/procurement/mts_optimizer_phase3c.logic.test.ts supabase/functions/api/_core/procurement/mts_optimizer_phase3c_demand.logic.test.ts supabase/functions/api/_core/procurement/mts_optimizer_phase3d.logic.test.ts supabase/functions/api/_core/procurement/mts_requirement.logic.test.ts` | **78 passed, 0 failed** |
| `31029d43` | `deno check supabase/functions/api/_core/procurement/mts_optimizer_phase3c_source.reader.ts supabase/functions/api/_core/procurement/mts_requirement.handlers.ts` | Pass |
| `4b1925cd` | `deno check supabase/functions/api/_core/procurement/mts_optimizer_phase3b.handlers.ts supabase/functions/api/_core/procurement/mts_optimizer_phase3c_source.reader.ts`; route-ACL and company-scope guards; combined Deno suite | Pass; **78 passed, 0 failed** |

No live database query, write, migration application, ACL provisioning,
deployment, or promotion was part of this evidence.

### 2026-10-19 owner decision — PO22 implementation owner is Claude

The business owner assigned **all remaining PO22 work to Claude**: data inputs
(vendor MOQ/multiple/Booking Time, item Rate, FX rates, BOE rate, company
interest %), engine fixes, Requirement-tab alignment, run assembly, Planning
tab, Store report, cost-to-cost comparison and AI. Codex and ChatGPT do **not**
implement PO22; they may review a finished step. Codex's existing PO22 commits
are already on `dev` and are the base Claude builds on. Owner decisions D1–D11
are in `common:docs/po22-common/OWNER-DECISIONS-2026-10-19-REQUIREMENT-AND-GROUPS.md`.
"Codex owns / remains implementation owner" wording in older rows below is
superseded by this decision.

### 2026-10-19 owner decision — one progressive line on `dev`

Owner: every agent's work goes to `dev`, no agent repeats another's topic,
work must be progressive; `dev` → `main` is the owner's later release step.
See the continuity rule in `docs/BRANCH-WORKFLOW.md`. `dev` carries the Codex
line (`910ec92`, incl. migration `20261019070346` and the PO22 evidence route)
plus `d42e60a`; `main` is untouched, so that migration/route reach PROD only at
the owner's release. Before starting, each agent reads this register and takes
only the next unclaimed item for its module.

## Cross-module coordination procedure

1. **Register first.** Before a task changes code, create/update one row in
   this file with module territory, implementation owner, branch/base SHA and
   acceptance criteria.
2. **Prove the baseline.** Fetch, verify `main`/`dev` SHAs, and use the
   fast-forward-only check in `BRANCH-WORKFLOW.md`. Do not start from a stale or
   divergent branch.
3. **Compare, do not merge around.** For each other active agent branch,
   record commits, changed paths, equivalence/conflict decision, dependencies,
   and test evidence. A divergent branch becomes read-only evidence.
4. **One implementation owner per module.** The register assigns PO22 to
   Claude (owner decision 2026-10-19). For other modules, assign a single owner before implementation; other
   agents may provide review evidence but do not create competing integrations.
5. **Commit phase evidence together.** Code, tests, migrations, ACL proposal,
   documentation, and this register update belong in the same phase commit
   series. Never apply a migration or ACL merely because the file exists.
6. **Promote only with authorization.** On owner approval, run the documented
   fast-forward `agent/* → dev → main` sequence, rerun prescribed gates, record
   the resulting equal SHAs here, and set the row to accepted. Otherwise stop at
   the agent-branch state.

## Register update template

| Field | Required value |
|---|---|
| Module / phase | One bounded feature or phase |
| Owner | Exactly one implementation owner |
| Baseline | `main` SHA and agent branch SHA |
| Evidence | Other branch SHA(s), changed paths, equivalence/conflict decision |
| Tests | Exact commands and pass/fail totals |
| Integration state | Draft / implemented on agent branch / accepted in `main` |
| Blockers / decision | Explicit source, business-rule, ACL, migration or owner gate |
| Next action | Ordered action and accountable owner |
