# PO22 — MANDATORY START HERE FOR CHATGPT, CLAUDE AND CODEX
**Updated:** 2026-10-19. **Purpose:** Session reset / independent agents must not reinterpret or redo the project.

## Step 0: Truth hierarchy (read before touching any files)
1. **Owner's latest explicit decision**, especially **strictly company-independent PO22; cross-company effect ONLY from explicit user-created item+qty+destination Sub-CSN**; no automatic intercompany allocation/transfer/import MOQ pooling.
2. Original full approved design: `main:docs/mts-planning/PO22-PHASE-2D-FINAL-OPTIMIZER-AND-STORE-CONTRACT.md` (13 sections, original **22** numeric acceptance cases).
3. `common:docs/po22-common/APPROVED-CONTRACT-TRACEABILITY.md` and `REQUIREMENTS-AND-DECISIONS.md`.
4. `common:docs/po22-common/GOOGLE-SHEET-FORMULA-REFERENCE.md` and the native source workbook; sheet formulas are **historical behavioral evidence**, NOT permission to change approved CM/NM or assume defective formula is an agreed optimization rule.
5. Latest live `agent/codex:docs/INTEGRATION-REGISTER.md` and actual Git SHAs **verified afresh**. `common:CODEX-INTEGRATION-REGISTER-SNAPSHOT.md` is a frozen dated fallback, NEVER a live reference.
6. Exact source code, named tests, bounded read-only PROD evidence and owner-controlled UAT; no completeness/deployment assertion based on an agent's narrative.

## Mission: preserve continuity; no more unbounded audit loop
- **ChatGPT:** requirement-source reconciliation, business decision consistency, master traceability and documentation coordination. Do not edit PO22 code on other branches.
- **Claude:** independent implementation/security/numeric correctness review, reproducible defects and acceptance evidence; do not secretly become a competing code integration owner.
- **Codex:** sole PO22 implementation owner on `agent/codex`, continuing from actual commits. No phase-by-phase design reset, no duplicate existing modules, no unauthorized production operations.
- Any agent that discovers a conflict reports source lines, last owner decision, affected feature and exact proposed resolution. Owner decides when business semantics are genuinely ambiguous.
- When one agent is working, the others may inspect but must not independently push documentation to `common`. The designated documentation integrator handles reviewed updates sequentially; until a formal policy is signed off, **treat `common` as read-only for other agents**.

## Git workflow & risk
`docs/BRANCH-WORKFLOW.md` on `main` is locked and previously authorized five branches only. The owner requested `common` as a **new documentation coordination branch**, now created as an explicit exception. **Do not assume the old locked rules automatically authorize multiwriter pushes or common → dev/main promotion.** Do not bypass fast-forward-only owner-approval policy. No rebase, cherry-pick, force push, reset or conflict-only merges.

`common` contains a copy of baseline repo plus PO22 documentation commits. It **does NOT contain unpromoted Codex implementation commits**; read those from `agent/codex` in place. Never mistake file contents on `common` for the latest source code.

## What exists vs what remains
- `main`: approved Requirement CM/NM and Phase 3A, Phase 3B **foundation**, Phase 2D approved design. This is code baseline, not proof of live deployment.
- `agent/codex`: Phase 3B lifecycle/source readers, API, selection and persistence foundation; Phase 3C shared-stock core and PO21 source evidence adapter; Phase 3D partial coverage/advisory core. Unpromoted. Consult [commit-to-file map](COMMIT-TO-FILE-MAP.md) and latest live Integration Register.
- Phase 3E Store UI/export not evidenced complete. Phase 3F commercial + AI not evidenced complete. Real end-to-end UAT remains outstanding.
- Exact effective `customer_plan_line.id` / version attribution for each demand is unresolved in inspected 31029d43 code: loaded plan IDs are returned prior to effective selection; individual demand keys carry product/formulation line but no exact effective plan-line ID/version.
- The original 22 approved numerical acceptance tests must remain. A new passing test count is not business completion.

## First ten-minute recovery checklist
1. `git fetch origin --prune` or GitHub compare; verify refs for `main`, `dev`, `agent/codex`, `agent/claude`, `agent/chatgpt`, `common`. Do NOT mutate another lane.
2. Compare `origin/main...origin/agent/codex` for exact current ahead/behind and changed files; never assume this dated snapshot is current.
3. Read docs in hierarchy, scan exact source and tests and update the single feature register by **SHA / file / test / business UAT**.
4. For each change distinguish `DESIGN_APPROVED`, `CODE_ON_AGENT`, `IN_MAIN`, `DEPLOYED`, `UAT_ACCEPTED`. These are different states.
5. Confirm 3C/3D resolved defects by current code, not stale earlier review.
6. Resume from first dependency **not yet finished**. Do not restart design or perform broad speculative refactors.
7. If using PROD, only bounded owner-authorized SELECT/read-only verification; migrations, ACL apply, deployment and operational write require separate owner permission.

## Concrete files
- [Requirements master index](REQUIREMENTS-AND-DECISIONS.md)
- [Approved contract mapping](APPROVED-CONTRACT-TRACEABILITY.md)
- [Original sheet formulas](GOOGLE-SHEET-FORMULA-REFERENCE.md)
- [28-item business acceptance matrix](REQUIREMENT-ACCEPTANCE-MATRIX.md) + original 22 numerical cases
- [Commit-to-file implementation map](COMMIT-TO-FILE-MAP.md)
- [Codex full integration register snapshot](CODEX-INTEGRATION-REGISTER-SNAPSHOT.md)
- [Prior dated status](PROGRESS-SNAPSHOT.md)

## Agent output protocol
Every handoff/update must report: `exact current SHA | requirement ID | business source | code path | code implemented? | test command / observed vs recorded result | real data/UAT result | outstanding defect | owner | next permitted action`. Never describe source-reader or passing tests as a completed commercial optimizer or production release.
