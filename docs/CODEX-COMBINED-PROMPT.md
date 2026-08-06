# Codex - Combined Task Prompt (4 build-time guards/pilots, run non-stop)

## Execution Status Note (2026-08-06)

This section records what was actually completed in the repo during the
2026-08-06 Codex pass, what remains incomplete, and why.

### Task 1 - `docs/CODEX-JSDOC-CHECKJS-PILOT-TASK-BRIEF.md`

- Status: **Completed and committed**
- Commit: `09ce38a3` - `Add JSDoc checkJs pilot for OM customer payloads`
- What was done:
  - Added JSDoc payload typedefs and `@param` typing for OM customer
    create/update API helpers in `frontend/src/pages/dashboard/om/omApi.js`
  - Added narrow `frontend/jsconfig.json` with `checkJs`
- Verification performed:
  - Deliberate mismatch produced:
    `frontend/src/pages/dashboard/om/omApi.js(546,3): error TS2820: Type '"domestic"' is not assignable to type '"DOMESTIC" | "EXPORT"'`
  - After reverting the probe:
    `npx.cmd -p typescript@5.9.2 tsc --noEmit -p frontend/jsconfig.json`
    exited `0`
- Could not / did not do:
  - No CI wiring was added, by design of the brief

### Task 2 - `docs/CODEX-HARDCODED-ROLE-GUARD-EXPANSION-TASK-BRIEF.md`

- Status: **Completed and committed**
- Commit: `e973bc98` - `Expand hardcoded role-check guard coverage`
- What was done:
  - Expanded `scripts/hardcoded-role-check-guard.mjs` to scan frontend files
    (excluding `frontend/src/admin/**`)
  - Broadened `_ROLES` / `_ROLE_CODES` detection
  - Added the newly surfaced known violations to the guard's `BASELINE`
- Verification performed:
  - `Hardcoded role-check guard - scanned 432 file(s), 0 new hardcoded rank-check pattern(s) found`
  - `OK - no new hardcoded rank-check patterns found outside the documented baseline.`
- Could not / did not do:
  - Did **not** fix the flagged frontend/backend files themselves, because
    the brief explicitly scoped this task to guard expansion only

### Task 3 - `docs/CODEX-WRONG-COMPANY-SOURCE-GUARD-TASK-BRIEF.md`

- Status: **Completed and committed**
- Commit: `d3c06576` - `Add wrong company source guard`
- What was done:
  - Created `scripts/wrong-company-source-guard.mjs`
  - Added the CI step in `.github/workflows/ci-basic.yml`
  - Tightened the scan to ignore page-helper API modules like `*Api.js`
    after the first verification pass found a false positive in
    `frontend/src/pages/dashboard/om/omApi.js`
- Verification performed:
  - Final clean run:
    `Wrong company source guard - scanned 154 business page file(s), 0 admin/global company source violation(s) found`
  - `OK - no business page uses an admin/global company source.`
- Could not / did not do:
  - No application fix was needed; the live tree was clean after the detector
    was tuned to real page scope

### Task 4 - `docs/CODEX-ROUTE-ACL-REGISTRY-GUARD-TASK-BRIEF.md`

- Status: **Partially implemented, not committed**
- What was done:
  - Created `scripts/route-acl-registry-guard.mjs`
  - Added a draft CI step in `.github/workflows/ci-basic.yml`
  - Iterated on parser logic for mixed CRLF/LF route files and nested
    regex-based dispatch extraction
- Verification performed:
  - Latest run output:
    `Route/ACL registry guard - scanned 9 route file(s), 414 exact dispatch(es), 185 pattern dispatch(es), 369 missing registry match(es) found`
- Why it was not completed / committed:
  - The detector surfaced a large **pre-existing route/ACL backlog** in the
    current repo state
  - Committing the CI step as-is would immediately turn the branch red
  - This task's brief explicitly says not to silently baseline such
    mismatches and not to fix application routes in the detector task itself
- Important examples from the surfaced backlog:
  - `POST:/api/admin/acl/company-module/enable`
  - `PATCH:/api/admin/signup-requests/correct`
  - `GET:/api/admin/menu`
  - `POST:/api/workflow/decision`
  - `POST:/^\/api\/procurement\/invoice-verifications\/[^/]+\/run-match$/`
  - `PUT:/^\/api\/procurement\/exchange-refs\/[^/]+\/link-grn$/`
- Current conclusion:
  - Task 4 needs a follow-up decision before landing:
    either fix/triage the surfaced backlog first, or knowingly land a
    failing zero-tolerance ratchet

You are working in the PACE ERP repo (`C:\Users\cpalm\Documents\pace-erp`).
This is one combined session covering **4 independent, self-contained
tasks**. Each has its own full brief already written to disk - read each
brief file in full before starting that task's work. Do not ask the human
for clarification between tasks; each brief is written to be fully
self-contained (what to read first, exact code locations, exact validation
steps, exact commit scope). If a brief references "the human reviewer,"
that means: note it in your final summary at the end of all 4 tasks, do not
stop and wait for a reply mid-task.

Work through the 4 tasks **in this order** (independent of each other, but
this order goes cheapest/lowest-risk first):

1. **`docs/CODEX-JSDOC-CHECKJS-PILOT-TASK-BRIEF.md`**
   Add JSDoc types to `createCustomer`/`updateCustomer` in
   `frontend/src/pages/dashboard/om/omApi.js`, add a narrowly-scoped
   `frontend/jsconfig.json` with `checkJs`, verify it actually catches a
   deliberate mismatch, then revert the mismatch. Editor-time only, no CI
   change, no runtime behavior change.

2. **`docs/CODEX-HARDCODED-ROLE-GUARD-EXPANSION-TASK-BRIEF.md`**
   Widen `scripts/hardcoded-role-check-guard.mjs`'s detection regex and add
   frontend scanning (`frontend/src`, excluding `admin/`). Do NOT fix any
   files this newly catches - add them to the script's `BASELINE` with a
   one-line reason each, following the existing style in that file exactly.

3. **`docs/CODEX-WRONG-COMPANY-SOURCE-GUARD-TASK-BRIEF.md`**
   Build a new `scripts/wrong-company-source-guard.mjs` from scratch,
   catching business pages that use `useCompaniesForOmQuery` /
   `useAdminCompaniesQuery` / a raw `/api/admin/companies` fetch outside
   `frontend/src/admin/`. Confirmed clean today - should produce zero
   findings; wire it into CI at zero-tolerance (no BASELINE mechanism for
   this one).

4. **`docs/CODEX-ROUTE-ACL-REGISTRY-GUARD-TASK-BRIEF.md`**
   Build a new `scripts/route-acl-registry-guard.mjs` from scratch, statically
   cross-checking every route dispatched in
   `supabase/functions/api/_routes/*.routes.ts` against
   `supabase/functions/api/_acl/route-acl-registry.ts` (both the
   `EXACT_ROUTE_ACL` object and the `PATTERN_ROUTE_ACL` regex array), plus
   `ACL_SUPPORT_ROUTES` in `_pipeline/runner.ts` for exempt routes. This is
   the most parsing-heavy of the 4 - **the brief contains an explicit
   warning about mixed CRLF/LF line endings across the 9 route files,
   confirmed via `file` on each one; read that section carefully before
   writing your line-scanning logic, this exact class of bug already cost
   real debugging time once today on a similar parsing script.**

---

## Ground rules for all 4 tasks

- **Do not touch application/business logic.** Every task's scope is
  strictly "build/extend a guard script" or "add JSDoc annotations" - none
  of these 4 tasks should modify any handler, page component's runtime
  behavior, or database schema. If a brief's own instructions ever seem to
  imply an application-code fix, that's a signal to re-read the brief's
  "Scope" section - every one of them explicitly says file-fixing is a
  **separate**, already-assigned human task, not yours.
- **Each task ends with its own commit.** 4 tasks = 4 commits (not one
  giant commit at the end). Every commit message must end with
  `Co-Authored-By: Codex` on its own line, per this repo's convention (see
  `CLAUDE.md` memory note "Codex's commits must include
  'Co-Authored-By: Codex' for verification").
- **Verify before committing.** Every brief has its own verification step
  (run the guard, confirm expected pass/fail behavior, or run `tsc --noEmit`
  for the JSDoc pilot). Do not commit a guard script you haven't actually
  run against the real repo.
- **New CI steps go in `.github/workflows/ci-basic.yml`**, matching the
  existing step style exactly (see the current "Hardcoded role-check guard"
  / "Approver-chain guard" / "Resource-code domain guard" steps for the
  pattern - same YAML shape, just a new `name:`/`run:` pair per new guard).
  Tasks 2-4 each add one step (task 2 adds none - its guard already has a
  CI step, you're only changing what the existing command detects).
  Task 1 (JSDoc pilot) adds **no** CI step - it's explicitly editor-time
  only, do not add a `tsc --noEmit` CI gate for it.
- **If any brief's "known real positive/negative" example file no longer
  exists or no longer matches what the brief describes** (code moves fast
  in this repo), don't guess - search for the closest current equivalent
  using the same reasoning the brief describes (e.g. "a role-array constant
  gating an approve button"), and note in your final summary that the
  originally-cited example had moved/changed.

## When all 4 are done

Write a short final summary (not a new file - just your closing message)
covering, per task:
- What you built/changed.
- What you verified and how (paste the key command output, e.g. the guard
  script's pass/fail output, or the `tsc` before/after for the JSDoc pilot).
- Any findings you deliberately did NOT fix (per each brief's scope), listed
  clearly so the human reviewer can pick them up next - especially any
  route-acl-registry mismatches found by task 4's guard (a genuine finding
  there is a live authorization gap and should be called out prominently,
  not buried).
