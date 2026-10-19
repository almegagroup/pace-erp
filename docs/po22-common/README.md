# PO22 Common Workspace — START HERE
Status: INITIAL CONSOLIDATION, NOT FINAL BUSINESS SIGN-OFF.
Branch: `common` (created from `main` on 2026-10-19 at the business owner's explicit request).

**MANDATORY for all three agents: [START-HERE-ALL-AGENTS.md](START-HERE-ALL-AGENTS.md), then [COMMIT-TO-FILE-MAP.md](COMMIT-TO-FILE-MAP.md).** Do not start PO22 work from this README alone.\n\n## Purpose
One readable place for the business owner, Codex, Claude, and ChatGPT to find:
1. Approved business rules and decisions, with sources and verification state.
2. Exact implemented/integrated state, commits, tests and blockers.
3. An objective requirement-to-test acceptance matrix.
4. Open questions that must not be silently guessed.

## Critical integrity rules
- `common` is a **coordination/documentation branch, not a release baseline**. Do not merge it into `dev`/`main` or treat it as deployed code.
- The owner requested `common`, which changes the earlier five-branch-only policy in `docs/BRANCH-WORKFLOW.md`. That locked file and the formal promotion rules remain unchanged; reconcile/document the new exception explicitly **before** any cross-agent write workflow.
- Until a single-writer, reviewed update protocol is approved, all three agents **read** `common`; do not concurrently push or rewrite this branch. Designate a documentation integrator to commit updates with fetch/compare and no overwrites.
- **Latest owner decision:** Codex, Claude, or ChatGPT may be assigned implementation, verification, research or documentation **per task**, with mandatory reproducible handoff. There is no permanent AI role. Assignment does not bypass agent-branch permissions or owner-controlled integration gates.
- Never reset, rebase, cherry-pick, force-push or silently overwrite remote state. Main and dev promotions still need explicit owner permission.
- Source of truth for an implemented feature is exact source SHA + tests + acceptance evidence, not a design document or agent statement.
- Real PROD data is read-only for verification; no operational writes, migrations, ACL application, deployment, PO creation or stock postings without separate owner approval.

## Documents
- [Business design & decisions master index](REQUIREMENTS-AND-DECISIONS.md)
- [Complete approved contract traceability](APPROVED-CONTRACT-TRACEABILITY.md)
- [Historic Google Sheet formula reference](GOOGLE-SHEET-FORMULA-REFERENCE.md)
- [28-requirement acceptance matrix](REQUIREMENT-ACCEPTANCE-MATRIX.md)
- [Implementation snapshot and gap register](PROGRESS-SNAPSHOT.md)\n- [Complete historical Codex register copy](CODEX-INTEGRATION-REGISTER-SNAPSHOT.md)\n- [Commit-to-file inventory for all agent/codex changed paths](COMMIT-TO-FILE-MAP.md)
- Existing detailed contracts: `docs/mts-planning/PO22-PHASE-2D-FINAL-OPTIMIZER-AND-STORE-CONTRACT.md`, PO22 Phase 3A/B contracts and reports.
- Existing project register: `docs/INTEGRATION-REGISTER.md` on `agent/codex`. Refresh exact branch SHAs before editing any status.

## Process to reach a complete specification
Trace every rule to owner-approved decisions, existing PO22 contracts, actual schema and tests. For each rule record: company scope, inputs, priority, exception behavior, source lineage, UI behavior, expected output, corresponding test, and acceptance status. Missing evidence stays OPEN; never invent it. This workspace is **not yet a claim of 100% comprehensive verified design**.
