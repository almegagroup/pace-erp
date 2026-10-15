# PACE MTS Planning — Shared Work Protocol
Status: active coordination proposal, 2026-10-13

## Shared Git workflow
- ChatGPT writes business baseline, functional design and acceptance criteria on **agent/chatgpt**.
- Claude Code writes verified code/schema discovery and implementation notes on **agent/claude**.
- Codex writes assigned implementation patches on **agent/codex**.
- Integrate reviewed work through PRs into **dev**, then test and approve promotion to **main** and production. No automatic merging or PROD changes.
- A conversation-only generated file is not shared: it becomes shared only after Git commit/push to GitHub.
- Every handoff reports repository branch, exact commit SHA, changed paths, PR and blockers.

## Document directory
- BUSINESS-REQUIREMENTS.md (ChatGPT-owned; Claude reviews)
- TECHNICAL-DISCOVERY.md (Claude-owned; ChatGPT reviews)
- PAGE-MAP.md (joint, accepted page and automatic-engine inventory)
- MASTER-CONTRACT.md (joint, approved business+technical contract)
- DECISION-REGISTER.md (known/assumed/open/closed decisions)
- IMPLEMENTATION-STATUS.md (migration/backend/frontend/tests/DEV/PROD by page)
- pages/Pxx-*.md (implementation-ready precise contracts)

## Safe handoff
1. Owner fetches latest dev and their agent branch; does not reset or overwrite concurrent work.
2. Commit and push actual changed files to owner branch.
3. Review via GitHub PR/commit, record disagreements precisely and resolve.
4. Once a page contract is approved, implement migration -> backend -> frontend -> tests and DEV UAT.
5. No incomplete draft PR (#647 / previous #650) or other work is merged merely for branch cleanup. Preserve historical artifacts/revisions.
6. Explicit user approval before any production data migration or deployment.

## Business scope reminder
Rolling/Final/Additional/Urgent customer demand (urgent can be re-prioritisation without net new demand), historical imports and source provenance, separate estimates/actuals, Stroke/BOM requirement, book opening/date-selected calibration, PO/CSN/Sub-CSN/STO/PTO supply, AC01 landed cost and vendor share advisory optimisation, AI hard budget, multi-company ACL. The detailed baseline must be committed as a separate file; this protocol is not a substitute.
