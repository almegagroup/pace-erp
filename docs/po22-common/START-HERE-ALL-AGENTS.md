# PO22 — MANDATORY START HERE FOR CHATGPT, CLAUDE AND CODEX
**Updated:** 2026-10-19. **Purpose:** Session reset / independent agents must not reinterpret or redo the project.

## Step 0: Truth hierarchy (read before touching any files)
1. **Owner's latest explicit decision**, especially **strictly company-independent PO22; cross-company effect ONLY from explicit user-created item+qty+destination Sub-CSN**; no automatic intercompany allocation/transfer/import MOQ pooling.
2. Original full approved design: `main:docs/mts-planning/PO22-PHASE-2D-FINAL-OPTIMIZER-AND-STORE-CONTRACT.md` (13 sections, original **22** numeric acceptance cases).
3. `common:docs/po22-common/APPROVED-CONTRACT-TRACEABILITY.md` and `REQUIREMENTS-AND-DECISIONS.md`.
4. `common:docs/po22-common/GOOGLE-SHEET-FORMULA-REFERENCE.md` and the native source workbook; sheet formulas are **historical behavioral evidence**, NOT permission to change approved CM/NM or assume defective formula is an agreed optimization rule.
5. Latest live `agent/codex:docs/INTEGRATION-REGISTER.md` and actual Git SHAs **verified afresh**. `common:CODEX-INTEGRATION-REGISTER-SNAPSHOT.md` is a frozen dated fallback, NEVER a live reference.
6. Exact source code, named tests, bounded read-only PROD evidence and owner-controlled UAT; no completeness/deployment assertion based on an agent's narrative.

## Owner controls execution assignment — latest explicit decision (2026-10-19)
**The business owner may appoint Codex, Claude or ChatGPT to any PO22 task at any time. No permanent AI implementation or verification owner exists.** Assignment is per bounded task, never a forever-exclusive ownership claim. The owner may hand a task from one agent to another. Do not refuse a new assignment merely because an older register says Codex is permanent owner.

**Continuity contract for every assigned agent:**
1. Read this common workspace, approved contracts, exact live branch SHAs, existing implementation/tests, current task status, and latest handoff before acting.
2. Confirm the owner-assigned task, file territory, current base commit, permitted branch and operating restrictions. Existing `agent/*` branch ownership and locked branch safety rules still apply; **changing task owner does not silently authorize an agent to edit another agent's branch**. If the intended code branch cannot be safely worked on, report the branch handoff problem and obtain owner authorization for the permitted integration path.
3. Work only in the agreed file territory; avoid concurrent overlapping changes.
4. At the end, report exact file changes/commit SHA, tests run and result, source proof, known limitations, unfinished steps and the safe next entry point. Include whether code is agent-only, merged to main, deployed, or UAT accepted.
5. Update common progress and handoff **through a serialized, conflict-checked documentation write** coordinated by the currently assigned documentation updater. If the agent cannot safely update `common`, supply a ready-to-apply handoff and leave status OPEN—never claim it was recorded.
6. Next assigned agent repeats verification against live Git and resumes rather than rebuilding from narrative memory.

**Do not turn the task-handoff mechanism into a requirement for user approval of routine safe work.** Separate owner approval remains mandatory for deployment, migration/ACL application, operational data writes, and branch promotion.

## Mission: preserve continuity; no more unbounded audit loop
- **ChatGPT, Claude and Codex:** roles are **assigned by the user per task**; any may be asked to design, audit, implement or verify as permitted by the tools and branch workflow. Never infer a permanent role from a prior register. Continue from actual commits; do not repeat completed work or make unauthorized operational changes.
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
