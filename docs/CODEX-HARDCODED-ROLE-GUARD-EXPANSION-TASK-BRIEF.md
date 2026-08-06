# CODEX TASK — Expand Hardcoded Role-Check Guard (Bug Pattern #1 / #12)

## Objective

`scripts/hardcoded-role-check-guard.mjs` exists to catch a recurring PACE ERP
bug: a handler or page defines its own **local hardcoded role list** (or a
local `assert*Or*Role`-style function) and uses that as the real gatekeeper
for a write/action, instead of trusting the ACL decision the backend already
computed. Read `CLAUDE.md`'s "Recurring 13 Bug Patterns" section, patterns #1
and #12, before starting — they contain two real, live examples of this bug
(`qa_test_method.handlers.ts`'s `assertQARole()`, and
`POOrderGroupDetailPage.jsx`'s `PO_APPROVER_ROLES`) with full root-cause
detail.

The guard today (confirmed 2026-08-06) has **two real coverage gaps**:

1. **It never scans `frontend/src`.** `SCAN_DIR` is hardcoded to
   `supabase/functions/api/_core` only. The exact same bug shape exists on
   the frontend (buttons hidden by a hardcoded role list instead of trusting
   backend authorization) — confirmed live in `POOrderGroupDetailPage.jsx`
   and `STODetailPage.jsx` (both already fixed by hand this session, see
   `CLAUDE.md` pattern #12 for the fix pattern used).
2. **Its regex only matches names ending in `_OR_SA_ROLES`/`_OR_ADMIN_ROLES`.**
   Real violations use different naming: `PO_APPROVER_ROLES`,
   `STO_APPROVER_ROLES`, `QA_MANAGER_ROLE_CODES`, `QA_ALLOWED_ROLES`. None of
   these match today's `ROLE_CONST_PATTERN`.

Your job: fix both gaps in the guard script itself, run it, and reconcile the
BASELINE so CI goes green — **without fixing the underlying files**. File
fixes are being done separately by a human reviewer (judgment calls about
whether each flagged file's page/action is truly ACL-governed already). Your
scope is the **guard's detection power**, not the bug fixes.

---

## Read first

- `scripts/hardcoded-role-check-guard.mjs` — the file you're editing. Read
  every line, including the comments — they explain WHY the current regex is
  narrow (to avoid flagging the legitimate `workflow_scope.ts`
  approver-chain engine's `roleCode === "DIRECTOR"`-style fallback checks).
  Your expanded pattern must preserve that precision — don't turn this into
  a generic `roleCode ===` grep, that will drown in false positives.
- `.github/workflows/ci-basic.yml` — confirms this script already runs in CI
  (`node scripts/hardcoded-role-check-guard.mjs`, step "Hardcoded role-check
  guard"). No workflow change needed — same script, same step, just now also
  covers frontend.
- `CLAUDE.md` pattern #1 and #12 (search for "Recurring 13 Bug Patterns")
  for full context on both known real bugs and their fixes.

---

## Step 1 — Widen the role-array/function name regex

Current:
```js
const ROLE_CONST_PATTERN = /\b[A-Z][A-Z0-9_]*_OR_(SA|ADMIN)_ROLES\s*=/;
const ROLE_FN_PATTERN = /\bfunction\s+assert(Manager|Admin)Or\w*Role\s*\(/;
```

Replace/extend so it ALSO catches:
- Any `SCREAMING_SNAKE_CASE` constant assigned a `new Set([...])` or array
  literal `[...]` whose name ends in `_ROLES` or `_ROLE_CODES` (covers
  `PO_APPROVER_ROLES`, `STO_APPROVER_ROLES`, `QA_MANAGER_ROLE_CODES`,
  `QA_ALLOWED_ROLES`, and the existing `_OR_SA_ROLES`/`_OR_ADMIN_ROLES`
  shape — the new pattern should be a strict superset, don't lose the old
  matches).
- Keep requiring the RHS to look like a role-list literal (`new Set([`,
  `= [`, or similar) — do NOT match a bare `_ROLES` string constant that
  holds something unrelated (e.g. a UI label). A reasonable heuristic: the
  matched line (or next ~3 lines, since some lists are multi-line) must
  contain at least one of the known real role-code tokens
  (`DIRECTOR|SA|GA|L1_|L2_|L3_|L4_|MANAGER|USER|AUDITOR`) OR simply require
  the array elements to be quoted strings — either is fine, pick whichever
  keeps false positives near zero. Test it against the two known-good real
  examples below before finalizing.
- Keep `ROLE_FN_PATTERN` as-is (it already generically matches
  `assert*Or*Role` function declarations) but ALSO match the exported
  **arrow-function** form used on the frontend, e.g.
  `function assertQARole(` — already covered — but frontend code sometimes
  defines these as `const assertXRole = (...) => {` or inline
  `.has(shellProfile?.roleCode)` checks against one of the new array
  constants. You do not need to separately detect the arrow-function form —
  catching the array constant itself (Step 1's main change) is sufficient,
  since every real violation found so far pairs a role-array constant with a
  `.has(...)`/`.includes(...)` check, not a standalone function.

Validate your new regex against these **known real positives** (must flag):
- `supabase/functions/api/_core/procurement/qa_test_method.handlers.ts` —
  `QA_ALLOWED_ROLES` / `assertQARole`
- `frontend/src/pages/dashboard/procurement/qa/QAQueuePage.jsx` —
  `QA_MANAGER_ROLE_CODES`
- `frontend/src/pages/dashboard/production/SfgResultRecordingPage.jsx` —
  `QA_MANAGER_ROLE_CODES`
- `frontend/src/pages/dashboard/om/vendor/VendorDetailPage.jsx` —
  `MANAGER_OR_SA_ROLES`
- `frontend/src/pages/dashboard/om/material/MaterialDetailPage.jsx` —
  `MANAGER_OR_SA_ROLES`

And against these **known real negatives** (must NOT flag — legitimate,
already-audited approver-chain code):
- `supabase/functions/api/_core/procurement/po.handlers.ts` —
  `assertProcurementHeadRole` and any `roleCode === "DIRECTOR"` fallback
  checks tied to `workflow_scope.ts`
- `supabase/functions/api/_shared/workflow_scope.ts` itself

(Two of the "known real positives" above —
`POOrderGroupDetailPage.jsx`/`PO_APPROVER_ROLES` and
`STODetailPage.jsx`/`STO_APPROVER_ROLES` — have ALREADY been fixed by hand
(the constant is deleted from those two files). Don't expect to find them in
the live tree; they're listed here only so you understand the naming shape
the regex must catch. If you do find any trace of them, that's a signal
something regressed — flag it, don't silently ignore it.)

---

## Step 2 — Add frontend scanning

Current:
```js
const SCAN_DIR = join(ROOT, "supabase", "functions", "api", "_core");
...
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(handlers|handler|shared)\.ts$/.test(entry)) out.push(full);
  }
  return out;
}
```

Change to scan **both** roots:
- `supabase/functions/api/_core` (existing, files matching
  `\.(handlers|handler|shared)\.ts$` — unchanged)
- `frontend/src` (new — scan files matching `\.(jsx|js)$`, but SKIP
  `frontend/src/admin/**` entirely, since SA-only admin screens are exempt
  from ACL by design — same reasoning the existing BASELINE entry for
  `list_companies.handler.ts` documents. Also skip any `*.test.jsx`/
  `*.test.js` and `frontend/src/**/__tests__/**` if present.)

Keep the two scans logically separate in the output (report backend and
frontend violations in clearly labeled groups) but they can share the same
BASELINE set and the same exit-code logic (any new, unbaselined violation on
either side = FAIL).

Update `relPath()` — it already computes repo-relative paths via
`relative(ROOT, file)`, so it should work unchanged for both roots as long as
`walk()` is called with the correct starting directory each time.

---

## Step 3 — Run it, triage findings, update BASELINE

Run:
```
node scripts/hardcoded-role-check-guard.mjs
```

It will now almost certainly report NEW violations that were previously
invisible (frontend files, and any backend files using the newly-widened
constant regex). For each one found:

1. **Do not fix the file.** That is out of scope for this task.
2. Add it to `BASELINE` in the script, with a **one-line reason comment**
   directly above it, following the exact style of the existing entry for
   `list_companies.handler.ts`. Use this reason for every new entry unless
   you have specific evidence otherwise:
   ```js
   // Known violation, not yet fixed — flagged 2026-08-0X by the expanded
   // guard (frontend/backend scan + broader _ROLES/_ROLE_CODES naming net).
   // See CLAUDE.md pattern #1/#12 for the fix pattern (delete the local
   // list, trust the backend's own ACL/approver-chain decision). Tracked
   // for a follow-up fix pass — do not remove from BASELINE without
   // actually fixing the file first.
   ```
3. If you find a violation that looks like a plain **UI label array** or
   something clearly unrelated to authorization (i.e. a false positive from
   your new regex), do NOT add it to BASELINE — instead, tighten the regex
   so it doesn't match that shape, then re-run. The goal is zero false
   positives, not a BASELINE full of noise.

Keep iterating until:
```
node scripts/hardcoded-role-check-guard.mjs
```
exits 0 (every real violation is either fixed — none should be, per scope —
or baselined with a reason).

---

## Step 4 — Verify CI wiring unchanged

Confirm `.github/workflows/ci-basic.yml`'s "Hardcoded role-check guard" step
still just runs `node scripts/hardcoded-role-check-guard.mjs` — no change
needed there, the same command now does more work. Do not add a second CI
step.

---

## Step 5 — Commit

Use a commit message describing the guard expansion (not the underlying
bugs it now surfaces). Include `Co-Authored-By: Codex` per this repo's
convention (see memory: "Codex's commits must include
'Co-Authored-By: Codex' for verification").

Do NOT touch any file outside `scripts/hardcoded-role-check-guard.mjs` and,
if genuinely necessary, `.github/workflows/ci-basic.yml` — no application
code changes in this task.
