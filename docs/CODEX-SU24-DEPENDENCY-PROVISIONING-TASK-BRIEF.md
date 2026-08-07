# CODEX TASK — SU24-Style Dependency-Provisioning Report

## Objective

Build a report-generating script, `scripts/dependency-provisioning-check.mjs`,
that automates the cross-check Claude has been doing **by hand** for every
ACL group decided this session (2026-08-06): for each department that has
real, standalone access to a page, does that department also hold every
ACL grant that page's own frontend code actually depends on?

This is PACE ERP's equivalent of SAP's SU24 — when a transaction is added to
a role, SU24 inspects what the transaction's own code actually touches and
proposes the authorization objects it needs, instead of a human guessing.
Today that inspection is manual, and manual has repeatedly been wrong or
incomplete — see "Why this matters" below for concrete, already-fixed
examples from this exact session. The goal is a script a human (or Claude)
runs after deciding any ACL group, that prints every gap it finds so it
can be reviewed and fixed in the same pass — not a CI-blocking guard (ACL
grants live in the database, not in git-tracked files, so a build-time gate
can't see most of what changes).

---

## Why this matters — real gaps this exact mechanism would have caught

All of these were found by hand this session, each one requiring the same
manual steps: open `PAGE-DEPENDENCY-MANIFEST.json`, find the page's file,
read its `deps` array, then query live ACL tables to check whether the
department that owns the page also holds each dependency.

1. **Group 1 (2026-08-06):** `ProductionPOCreatePage.jsx` (PR09, Production's
   own page) calls `POST /api/om/material/category-group` →
   `OM_MATERIAL_CREATE:WRITE`. The original 2026-07-28 design note claimed
   "zero PM04 access is safe for Production" — checked only Stroke
   Master's read-only picker, never checked PR09's own inline
   "+New Category" form. Wrong, fixed with a narrow `menu_visible=false`
   companion capability.
2. **Group 1 (2026-08-06):** `PlanFeedPage.jsx` (PR00, Production's own page)
   needs `OM_CUSTOMER_LIST:VIEW` + `OM_CUSTOMER_CREATE:WRITE`/`EDIT` for its
   Party dropdown + "+New Party" — never accounted for when Group 1 was
   first decided, since the "SCM+Director only" premise was never checked
   against Production's *own* pages.
3. **Group 11 (2026-08-06, re-verification pass):** Accounts (SO01/SO02's
   creator department) had **zero** grant on `OM_CUSTOMER_CREATE`,
   `OM_CUSTOMER_LIST`, `PROC_PAYMENT_TERMS_MASTER`, `PROC_PO_LIST`, or
   `PROC_DO_LIST` — all five are real dependencies of `SOCreatePage.jsx`/
   `SODetailPage.jsx`/`SalesInvoiceDetailPage.jsx`/`PgiInvoiceCreatePage.jsx`,
   undiscovered for 6 days (decided 2026-07-31) until this script's
   equivalent manual process caught it.

Each of these is the exact same shape: **department has the page, but not
one of the page's own real dependencies** — and each was only found because
a human happened to think to check. That doesn't scale across ~150 pages
and 9+ departments.

---

## Read first

1. `docs/Operation Management/implementation-specs/PAGE-DEPENDENCY-MANIFEST.json`
   — already built (by a prior one-off script, not part of this repo, per
   the note in `CODEX-ROUTE-ACL-REGISTRY-GUARD-TASK-BRIEF.md`). Array of
   `{ page: "frontend/src/pages/.../Foo.jsx", dependencyCount, deps: [{ fn,
   method, path, resourceCode, action, skipAcl }] }`. `resourceCode` is
   either a real ACL resource code, or the literal string `"UNRESOLVED"`
   when the path didn't match anything in `route-acl-registry.ts` (skip
   these — nothing to check). `skipAcl: true` entries are also not gated by
   ACL at all — skip these too, they need no grant from anyone.
   **This file may be stale** (pages/dependencies added since it was built)
   — check its own age against recent `git log` on `frontend/src/pages/` and
   flag in your final report if it looks more than a few weeks old, but do
   not regenerate it as part of this task (out of scope — a fresh
   regeneration script is a separate task if the manifest is confirmed
   stale).

2. `frontend/src/navigation/screens/projects/*/​*Screens.js` (e.g.
   `operationModule/operationScreens.js`, `hrModule/hrScreens.js`) — maps
   `screen_code` (== ACL `resource_code`) → `route` (URL path, relative,
   e.g. `/dashboard/om/materials`). This is your resource_code → route
   lookup.

3. `frontend/src/router/AppRouter.jsx` — maps route path (as used in
   `<Route path="..." element={<ComponentName />} />`) → component name.
   Routes are nested (`<Route path="dashboard">` wrapping children with
   relative sub-paths) — you'll need to walk the JSX tree and concatenate
   parent+child paths to get the full path matching what the screen
   registries store. The file's own `import ComponentName from "..."` lines
   at the top give you component name → file path. Chain these three
   (screen registry → AppRouter route → AppRouter import) to get
   **resource_code → file path**, which is the manifest's own join key.

4. `scripts/acl-master-drift-check.mjs` — read this in full, it is your
   template for both *shape* and *house style*. Same pattern to follow:
   the script prints one big SQL query to stdout and does **not** connect
   to a database itself — the human (or Claude, via the `supabase` MCP
   tool) runs the printed SQL separately, against dev or prod as needed.
   Do not deviate from this pattern by adding a DB client/connection
   string to this script.

5. `CLAUDE.md`'s "Cross-Module Dependency Taxonomy" section (search
   `PROD-ACL-Access-Decisions.md` for "Cross-Module Dependency Taxonomy
   (established 2026-08-06)") — the ক/খ/গ/ঘ classification this whole
   mechanism exists to partially automate. Type ঘ (backend sync-back,
   `serviceRoleClient`, bypasses ACL entirely) **never appears in the
   manifest at all** — it's not a frontend-callable route, so there's
   nothing to detect for it, which is correct and requires no special
   handling. Type ক (inline quick-create) and Type খ (read-only reference
   lookup) are exactly what the manifest captures and what this script
   detects. Type গ (genuine co-ownership) cannot be told apart
   automatically from ক/খ by inspecting code alone — see "Output format"
   below for how to flag likely-গ cases for a human decision instead of
   silently suggesting a fix.

---

## Step 1 — Build the resource_code → dependencies lookup (in JS, no DB)

Write a pure function (or a small internal module) that:

1. Reads every `*Screens.js` file under `frontend/src/navigation/screens/`,
   builds `route_path -> resource_code` (from each entry's `screen_code` +
   `route`).
2. Parses `AppRouter.jsx`: extract every `<Route path="..." element={<X />}>`,
   tracking nesting to build full concatenated paths, producing
   `full_route_path -> ComponentName`. Then parse the file's own top-level
   `import` statements to get `ComponentName -> file_path`. Chain both to
   get `full_route_path -> file_path`.
3. Join (1) and (2) on route path to get `resource_code -> file_path`.
   Some resource codes will have no matching file (companion/route-only
   resources like `OM_MATERIAL_CREATE`, `PROC_DO_CREATE` — these are never
   themselves a page) — that's expected, skip them, they're never the
   *owning* side of a dependency check, only ever the *dependency* side.
4. For each `resource_code -> file_path` pair, look up `file_path` in
   `PAGE-DEPENDENCY-MANIFEST.json`'s `page` field (exact match on the
   repo-relative path) to get that page's `deps` array. Filter out
   `resourceCode === "UNRESOLVED"` and `skipAcl === true` entries. Dedupe
   by `(resourceCode, action)`.

End state: an in-memory (and printed, for transparency/debugging) list of
`{ owning_resource_code, dependency_resource_code, dependency_action }`
triples. Print this list as a JSON block near the top of the script's
output, before the SQL — so a human reviewing the report can sanity-check
the mapping itself, not just trust it blindly.

---

## Step 2 — Emit the SQL, following `acl-master-drift-check.mjs`'s pattern

Using the triples from Step 1, generate one SQL query (a single
`console.log` of a SQL string, same as the reference script) that:

1. For each department (`work_context_name`, excluding `ACL-MASTER`,
   `DIRECTOR`, `DIRECTOR-REPORTS`, `MANAGEMENT-REPORTS` — these follow
   different rules per Basic Rules #3/#5/#7, not ordinary department
   membership, and including them would produce noise, not signal) that
   holds **`menu_visible = true` `ALLOW`** on a triple's
   `owning_resource_code` (meaning: this department has *real, standalone*
   page access, not just a hidden companion grant on that resource) —
2. Check whether that **same department** (same `work_context_name`,
   joined across both `c04f0a8b-ecf0-48ee-becc-174fc377723e` (CMP003) and
   `88240088-9af7-46f5-86af-c4e635d3c9cd` (CMP006) — hardcode these two,
   matching every other script in this repo) also resolves `ALLOW` on
   `(dependency_resource_code, dependency_action)` — **regardless of
   `menu_visible`** on the dependency side (a hidden companion grant is a
   perfectly valid way to satisfy a dependency, that's the whole point of
   the taxonomy).
3. If not, that's a gap — report `(company_code, work_context_name,
   owning_resource_code, dependency_resource_code, dependency_action)`.

Query against `acl.precomputed_acl_view`, but **only the active
`acl_version_id` per company** (`JOIN acl.acl_versions av ON
av.acl_version_id = pav.acl_version_id AND av.is_active = true`) — this
table accumulates rows from every historical version forever (confirmed
this session, see the doc's Group 11 "false alarm" note) and querying
without this filter produces false positives from stale/deactivated
versions.

Embed the Step-1 triples as an inline `VALUES (...), (...), ...` CTE in the
generated SQL (like `known_intentional_exclusions` does in the reference
script) — this is what makes the mapping computed-in-JS-but-checked-in-SQL
approach work without a live DB connection from Node.

---

## Step 3 — Output format, including the Type-গ flag

For each gap found, alongside the `(company, department, owning_resource,
dependency_resource, dependency_action)` tuple, add a heuristic **risk
flag** to help a human triage quickly:

- **LOW** — dependency action is `VIEW` only. Almost always Type খ
  (reference lookup). Safe to suggest a narrow `menu_visible=false`
  VIEW-only companion capability without much deliberation.
- **MEDIUM** — dependency action is `WRITE`/`EDIT` (inline create/update).
  Likely Type ক, but confirm the dependency truly is an inline embedded
  form (not a redirect to the dependency's own full page) before
  suggesting a companion grant — check the manifest's `fn` name and the
  actual page code briefly.
- **HIGH** — dependency action is `DELETE`/`APPROVE`, or the dependency
  resource is itself a page with its own full department ownership
  elsewhere in the ACL doc (i.e. granting this department that action
  would give them real power over a resource someone else already owns
  outright). **Do not suggest a fix for these** — flag as "needs explicit
  business-owner confirmation (Type গ), see Cross-Module Dependency
  Taxonomy" and stop there.

For LOW/MEDIUM gaps, additionally print (not execute) the suggested
capability-creation SQL, following this session's established pattern
exactly (see any of today's `CAP_*_DEPENDENCY` capabilities in
`PROD-ACL-Access-Decisions.md` for the shape — new capability with a
`_DEPENDENCY` suffix, `menu_visible=false` on every menu-action row,
`role_capabilities` matching whatever the department's *own* primary
capability already grants — this last part requires one more query per
gap to find the department's existing primary capability on the owning
resource and copy its role list, do not hardcode a role list).

---

## Step 4 — Do not auto-apply anything

This script only prints. Applying any suggested fix is **always** a
separate, explicit action taken by a human (or Claude, reviewing the
report) — same discipline as every ACL change this session, including the
version-bump/capture/generate/verify cycle and the doc update. Say so
explicitly in the script's own `--help`/header comment, matching
`acl-master-drift-check.mjs`'s own header comment style.

---

## Step 5 — Commit

`scripts/dependency-provisioning-check.mjs` only. No application code
changes, no DB changes. Clear commit message,
`Co-Authored-By: Codex` per this repo's convention.
