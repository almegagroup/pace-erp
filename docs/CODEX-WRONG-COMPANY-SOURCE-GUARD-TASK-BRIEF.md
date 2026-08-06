# CODEX TASK — New Guard: Wrong Company Source on Business Pages (Bug Pattern #11)

## Objective

Build a new CI guard script, `scripts/wrong-company-source-guard.mjs`, that
catches a business (non-admin) frontend page importing/using an
**admin-only or global, unscoped company list** instead of the correct
ACL/runtime-scoped company source. Read `CLAUDE.md`'s pattern #11 ("Wrong
company source / single-company auto-resolution bypass") before starting:

> Business pages must never use admin/global company sources when
> ACL/runtime company context exists. Canonical UI rule: single-company user
> = company shown explicitly as read-only/locked; multi-company user =
> choose only from allowed companies. Prefer the shared transaction-company
> pattern instead of page-local custom company pickers.

The concrete historical bug (IN03 Current Stock page, feasibility §116
discovery note, 2026-08-04) used
`useCompaniesForOmQuery` — a hook that calls `GET /api/admin/companies` with
`skipAcl: true` and returns **every company in the system with no ACL
scoping at all** — on a business (non-SA-admin) report page. The fix was to
source Company from `useMenu()`'s `runtimeContext.availableCompanies`
instead (the same source `TransactionCompanySelector` uses). This guard
exists so the next page doesn't repeat that exact mistake.

---

## Read first

- `frontend/src/hooks/queries/useOmMasterQueries.js` — line ~132,
  `useCompaniesForOmQuery()`. This hook wraps `listCompaniesForOm()` (from
  `frontend/src/pages/dashboard/om/omApi.js`, calls `GET /api/admin/companies`
  with no company scoping) — it is **only legitimate on SA/GA admin
  screens**, where "see every company, unscoped" is the actual intended
  behavior.
- `frontend/src/hooks/queries/useAdminMasterQueries.js` — line ~7,
  `useAdminCompaniesQuery()`. Same shape, same admin-only intent, different
  name — also only legitimate under `frontend/src/admin/`.
- `frontend/src/components/inputs/TransactionCompanySelector.jsx` and
  `frontend/src/components/inputs/transactionCompanyRuntime.js` — the
  **correct** pattern: sources company options from `useMenu()`'s
  `runtimeContext.availableCompanies` (ACL/session-scoped — respects
  single-company auto-resolve vs multi-company dropdown per the canonical
  rule in `CLAUDE.md` §3 "Canonical company rule" / Design Authority Law 12).
  This is what every real business page should use, directly or indirectly
  (e.g. by rendering `<TransactionCompanySelector />` itself, or by reading
  `runtimeContext.availableCompanies` from `useMenu()` directly for a
  page that needs the raw list rather than a picker widget).
- Confirmed today (2026-08-06) via
  `grep -rn "useCompaniesForOmQuery" frontend/src`: this hook currently has
  **zero usages outside `frontend/src/admin/`** — the codebase is clean of
  this specific violation right now. That means this guard, run today,
  should produce **zero findings** — use that as your correctness check
  while building it (if you get non-zero findings against current code,
  your detection logic has a bug — go re-check it, don't just baseline
  whatever you find).

---

## Step 1 — Define the "forbidden admin/global company source" list

Build a small, explicit list of import specifiers/hook names that are
admin-only company sources, not business-safe:
- `useCompaniesForOmQuery` (from `frontend/src/hooks/queries/useOmMasterQueries.js`)
- `useAdminCompaniesQuery` (from `frontend/src/hooks/queries/useAdminMasterQueries.js`)
- Any direct `fetch`/`fetchApi`/`fetchJson` call to the literal string
  `"/api/admin/companies"` (grep shows several legitimate uses of this
  literal already, all inside `frontend/src/admin/sa/screens/**` — see
  Step 3 for how to scope the check so those don't false-positive).

Keep this list as a small, named array/const at the top of the script (not
scattered inline) so it's easy for a human to extend later if a new
admin-only company hook gets added.

---

## Step 2 — Scan business pages

Scan `frontend/src/pages/**/*.jsx` and `frontend/src/pages/**/*.js`
(business pages — this is the directory that must stay clean) for:
- An `import { useCompaniesForOmQuery, ... } from ".../useOmMasterQueries.js"`
  (or relative-path equivalent) followed by actual usage of
  `useCompaniesForOmQuery(` in the same file — flag the import even if
  unused is arguably dead-code-not-ACL-risk, but simplest and safest is:
  flag any file that both imports AND calls it.
- Same for `useAdminCompaniesQuery`.
- Any literal `"/api/admin/companies"` string appearing anywhere in a
  `frontend/src/pages/**` file (this string should never appear outside
  `frontend/src/admin/**`).

Do NOT scan `frontend/src/admin/**` — every hit there is legitimate by
design (SA/GA-only screens are meant to see the full unscoped company list).
Do NOT scan `frontend/src/components/**` — the shared
`TransactionCompanySelector`/`transactionCompanyRuntime.js` files themselves
may legitimately reference these under the hood if that's ever how they're
implemented (check first — if they currently use a different, ACL-scoped
source as described above, this exclusion is just a safety margin, not an
expected hit).

---

## Step 3 — Report and fail

```
FAIL — business page uses an admin/global (unscoped) company source:
  frontend/src/pages/dashboard/inventory/SomeReportPage.jsx
    uses: useCompaniesForOmQuery
    fix: use useMenu()'s runtimeContext.availableCompanies, or render
         <TransactionCompanySelector /> directly — see
         frontend/src/components/inputs/TransactionCompanySelector.jsx
```

No BASELINE mechanism needed for this guard — confirmed today the codebase
is currently clean of this pattern in `frontend/src/pages/**`, so start at
zero-tolerance. (If your scan somehow finds an existing violation, list it
in your final report rather than silently baselining it — a company-scope
leak is a real security-relevant gap per `CLAUDE.md` pattern #2/#11, not a
style nit like the role-check guard's baseline.)

---

## Step 4 — Wire into CI

Add to `.github/workflows/ci-basic.yml`, matching the existing step style:
```yaml
      - name: Wrong company source guard
        run: node scripts/wrong-company-source-guard.mjs
```

---

## Step 5 — Commit

Include `Co-Authored-By: Codex` per this repo's convention. Scope: only
`scripts/wrong-company-source-guard.mjs` and the CI workflow addition — no
application code changes (there should be nothing to fix right now, per the
confirmed-clean baseline above).
