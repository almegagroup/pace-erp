# CODEX TASK — Remove Hardcoded Role Bypass in qa_test_method.handlers.ts (Bug Pattern #1)

## Objective

`supabase/functions/api/_core/procurement/qa_test_method.handlers.ts`
gates every write with a local hardcoded role check instead of trusting
ACL — the exact recurring bug this repo calls Pattern #1 (see CLAUDE.md's
"Recurring 13 Bug Patterns" section, item #1, for the general shape; this
file is one of its two remaining live instances, tracked as task #32/#33).

Remove the hardcoded gate. The route is already correctly ACL-governed —
your job is to stop the handler from silently overriding that.

---

## Why this is safe to remove (read before editing)

`route-acl-registry.ts` already maps every route in this file to
`PROC_QA_QUEUE` (VIEW/WRITE):
```
"GET:/api/procurement/qa-test-methods":          { resourceCode: "PROC_QA_QUEUE", action: "VIEW"  }
"POST:/api/procurement/qa-test-methods":         { resourceCode: "PROC_QA_QUEUE", action: "WRITE" }
"GET:/api/procurement/qa-category-test-config":  { resourceCode: "PROC_QA_QUEUE", action: "VIEW"  }
"POST:/api/procurement/qa-category-test-config": { resourceCode: "PROC_QA_QUEUE", action: "WRITE" }
```
`PROC_QA_QUEUE` is PO06 (Inward QA / Quality Inspection Queue) — a fully
decided, currently-live ACL resource (`PROD-ACL-Access-Decisions.md`,
Group 5, implemented 2026-08-06, ACL v54). QUALITY department (any rank,
full VIEW/WRITE/EDIT/DELETE/APPROVE) and Plant Head (`CAP_QA_PLANTHEAD`)
already hold real, correct grants on this exact resource.

The file's own local gate is actively broken, not just redundant:
```ts
const QA_ALLOWED_ROLES = ["SA", "DIRECTOR", "PROCUREMENT_HEAD", "QA_OFFICER", "STORE_MANAGER"];
const QA_MANAGER_ROLES = ["SA", "DIRECTOR", "PROCUREMENT_HEAD", "STORE_MANAGER"];
```
`PROCUREMENT_HEAD`, `QA_OFFICER`, `STORE_MANAGER` are not real role codes —
they don't exist anywhere in `role_ladder.ts`'s real `ROLE` enum
(the real ladder is `SA`/`GA`/`DIRECTOR`/`L4_MANAGER`/`L3_MANAGER`/
`L2_MANAGER`/`L1_MANAGER`/`L4_USER`/`L3_USER`/`L2_USER`/`L1_USER`/
`L1_AUDITOR`/`L2_AUDITOR`). A real QUALITY department user — say an
`L3_USER` with a fully correct `PROC_QA_QUEUE:WRITE` ALLOW from ACL — still
gets a 403 here today, because `ctx.roleCode` (`"L3_USER"`) is never in
either array. Only `SA`/`GA` (which bypass ACL entirely upstream) and
`DIRECTOR` can ever pass. Removing the local gate doesn't loosen access —
it makes the page actually usable by the department ACL already says can
use it.

---

## Step 1 — Remove the gate

In `supabase/functions/api/_core/procurement/qa_test_method.handlers.ts`:

1. Delete the `QA_ALLOWED_ROLES` and `QA_MANAGER_ROLES` constants (lines
   ~26-27) and their preceding comment.
2. Delete the `assertQARole` and `assertQAManagerRole` functions
   (lines ~46-56).
3. Remove all 4 call sites (`assertQARole(ctx)` at the 4 locations found
   via `grep -n "assertQARole" supabase/functions/api/_core/procurement/qa_test_method.handlers.ts`
   — confirm the exact count/lines yourself, don't assume the brief's line
   numbers are still accurate by the time you run this).
4. Do **not** replace the call sites with anything — no-op removal, same
   pattern as every other Pattern #1 fix already done this session
   (`opening_stock.handlers.ts`, `physical_inventory.handlers.ts`,
   `plan_feed.handlers.ts`, `pack_bom.handlers.ts`, `process_order.handlers.ts`,
   `stroke_master.handlers.ts` — grep any of these for
   `// ACL-gated via route-acl-registry` to see the comment style already
   used at each removal site; add the same one-line comment here).
5. Leave `ApiError`, `logDbError`, `parseBody`, `toTrimmedString`,
   `TEST_GROUPS`, and everything else in the file untouched — this is a
   surgical removal, not a rewrite.

---

## Step 2 — Verify

1. `deno check supabase/functions/api/_core/procurement/qa_test_method.handlers.ts`
   before (git-stash) and after — zero new errors, matching every prior
   fix this session's own verification pattern.
2. `grep -n "assertQARole\|assertQAManagerRole\|QA_ALLOWED_ROLES\|QA_MANAGER_ROLES" supabase/functions/api/_core/procurement/qa_test_method.handlers.ts`
   — must return nothing.

---

## Step 3 — Shrink the guard's BASELINE

`scripts/hardcoded-role-check-guard.mjs`'s `BASELINE` set currently has
this file listed with the comment "Known violation, not yet fixed —
flagged 2026-08-06... Tracked as task #32." Remove that line from
`BASELINE` (keep the other entry,
`supabase/functions/api/_core/admin/company/list_companies.handler.ts` —
that one is a legitimate SA-only admin endpoint, not a bug, leave it
baselined with its own existing reason).

Run `node scripts/hardcoded-role-check-guard.mjs` — must exit clean with
zero new violations and the shrunk baseline.

---

## Step 4 — Commit

Clear commit message stating the fix and that it was verified against
`route-acl-registry.ts`'s existing `PROC_QA_QUEUE` mapping (not a new ACL
grant — the grant already existed, this file was the only thing blocking
it). `Co-Authored-By: Codex` per this repo's convention. Scope: only
`qa_test_method.handlers.ts` and `scripts/hardcoded-role-check-guard.mjs`
— no other files.
