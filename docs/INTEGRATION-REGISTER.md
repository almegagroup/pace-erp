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
| `origin/agent/codex` | `40cc0b635cf806a7bbdf0fcf7a8497b0d6dc6eb2` | `main` is ancestor; 2 commits ahead | Linear fast-forward candidate, pending owner promotion approval. |
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
| Phase 3B physical identity readers (PO, GE, CSN/sub-CSN, GRN, lot, reservation, ledger), company scope, selection API, snapshot persistence | `agent/codex`: `74c406d8`, `40cc0b63`, pending STO-consignee hardening; overlapping review evidence `agent/chatgpt`: `e3247a24`…`02e2243a` | Implemented on Codex branch; reimplemented linearly, not history-integrated | **No** — pending explicit fast-forward promotion | 57/57 prior Deno tests; STO hardening regression pending commit | Bounded read-only production reconciliation confirmed PO/GE/GRN identity joins and identified STO CSNs as a separate, valid consignee-owned lifecycle family. Demand-line extraction and approved migration/ACL application remain pending. | Commit isolated STO correction; Codex remains implementation owner |
| Phase 3C fixed/group joint dated allocation | `agent/codex`: `2ba56276` | Core deterministic allocator implemented on Codex branch | **No** — pending explicit fast-forward promotion | 66/66 Deno tests; direct TypeScript checks; frontend production build passes | Input must still be supplied by a verified PO21 → product/ProdShade → Stroke/Pack-BOM source-line reader. Current implementation deliberately rejects widened group membership and does not invent a missing PM line identity. | Add the verified demand reader and run snapshot-to-allocation integration cases; Codex |
| Phase 3D coverage, consignments, MOQ/order multiple, PO-by / ETA recommendations | `agent/codex`: `3c0ce204`, `f2ff8d5f` | Daily coverage and advisory buy core implemented on Codex branch | **No** — pending explicit fast-forward promotion | 71/71 Deno tests, including ETA, unallocated group pool, MOQ/multiple, lead-time and missing-policy cases | Needs the verified source-line demand reader plus real vendor/route terms before it can emit a complete future-consignment or commercial scenario. It never treats projected arrival as executable Store stock; missing Target/Critical remains `UNKNOWN_POLICY`. | Connect only verified snapshots and commercial evidence; Codex |
| Phase 3E PO22 planning UI, Store instructions, export/exceptions | None | Pending | No | Not started | Depends on 3D deterministic outputs and ACL rollout | Sequentially after 3D; Codex |
| Phase 3F commercial optimization, AI scenarios and backtesting | None | Pending | No | Not started | Depends on deterministic 3C–3E outputs and verified commercial sources | Sequentially after 3E; Codex |

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

No live database query, write, migration application, ACL provisioning,
deployment, or promotion was part of this evidence.

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
   Codex. For other modules, assign a single owner before implementation; other
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
