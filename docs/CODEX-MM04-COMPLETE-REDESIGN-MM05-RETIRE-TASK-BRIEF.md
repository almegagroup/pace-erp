# CODEX TASK — MM04 Complete Redesign (Unified Customer Master) + MM05 Full Retirement

## ✅ STATUS (2026-08-27) — Claude direct-implemented, all Work Streams complete, verified

This brief was fully executed directly (not handed to Codex) in the same session it was
written. Kept as historical reference / read-first context for the SO/DO phase next, not as an
open task.

- **A (migrations)** — done: `20260827100000_mm04_dependent_flag_origin_company.sql`,
  `20260827110000_mm05_retire_dead_tables.sql`. `origin_company_id` left NULLABLE (2 pre-existing
  orphan customers, no company map at all — documented in the migration, not backfillable).
- **B (`is_dependent` auto-recompute)** — done, in `customer_address.handlers.ts`.
- **C (retroactive Vendor-link)** — done: `linkCustomerToVendorHandler` + `CustomerEditForm.jsx`'s
  "Link to existing Vendor" panel.
- **D (GST duplicate-detect + reuse)** — done: `findCustomerByGstHandler` +
  `CustomerCreateForm.jsx`'s "Map to my Company" flow, reusing the pre-existing
  `mapCustomerToCompanyHandler`.
- **E (list columns + title)** — done: `CustomerListPage.jsx` rebuilt to the §132.7 column spec,
  MM04 title → "Customer Master" (DB, both `erp_menu.menu_master` and `acl.menu_master`).
- **F (ErpDenseGrid + center drawer + keyboard nav)** — turned out to be **already built**
  (§129.8's migration had already happened by the time this brief was executed — verified live in
  `CustomerListPage.jsx` before touching it). Only the Save-hotkey wiring
  (`useErpScreenHotkeys`) was actually missing and has been added to both
  `CustomerCreateForm.jsx`/`CustomerEditForm.jsx`.
- **G (MM05 retirement)** — done, with one real correction along the way: the old
  `fg_dispatch_customer.handlers.ts` file mixed dead MM05 code with **live** Parent-Company/VDC
  handlers still used by MM04's own `VdcParentCompanyMasterPage.jsx`. Deleting the whole file (as
  this brief originally said) would have broken that live page. Fixed by splitting it: the live
  Parent-Company/VDC handlers moved to a new `fg_parent_company.handlers.ts`, only the genuinely
  dead ~320 lines removed. Menu/ACL rows (`erp_menu.menu_master`, `acl.menu_master`,
  `acl.capability_menu_actions` — 3 rows, `acl.version_capability_menu_actions` — 204 rows,
  `acl.precomputed_acl_view` — 816 rows, `erp_menu.menu_tree`, `erp_menu.menu_snapshot`) all
  cleaned in dev. Dead tables dropped (`fg_dispatch_customer`, `fg_dispatch_customer_address`,
  confirmed 0 rows before drop).
- **Verification** — `deno check` (baseline 33 pre-existing errors, zero new, confirmed via
  git-stash before/after), `eslint` (zero new errors across every touched file), migration
  integrity (`in_sync=true`), and all 8 guard scripts (route-acl-registry, company-scope,
  company-scope-write-acl, frontend-payload, jsx-no-undef, hardcoded-role-check,
  wrong-company-source, resource-code-domain) — all clean.
- **Not done (explicitly out of scope, unchanged)**: SO01/DO/Invoice, the polymorphic
  Ship-To/Bill-To resolver's actual build, IBN capture, prod replication of any of this (dev-only
  so far). Live click-through in the deployed app also not done — no dev login in this
  environment, same limitation as every other recent session.

---


## Read first

1. `CLAUDE.md` — §8A-8E (mandatory dev rules), the 15 bug-pattern checklist, the Bug-Pattern
   Guard Playbook, and the §6 "🔒 নতুন locked sequence" block (2026-08-27 update note points
   here).
2. Feasibility doc `docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`
   **Section 132 (132.1–132.9)** — this is the full design lock this brief implements. Read all
   of it before writing any code; this brief only summarizes it into concrete file-level steps.
3. Section 129 (the prior MM04 build this extends) and Section 113.6/113.7 (customer
   company-scope, GST pattern) for context on what already exists.

## Hard scope boundary — read this twice

**IN scope:** MM04 (`erp_master.customer_master` + `customer_address` + the shared
`fg_parent_company`/`fg_depot_code`) data-model changes, MM04 UI redesign, and MM05
(`OM_FG_DISPATCH_CUSTOMER`) full retirement.

**OUT of scope — do not touch:** SO01/DO/Invoice pages or handlers, the polymorphic
Ship-To/Bill-To resolver's actual consumption by SO (§132.4/§132.6 — concept locked, build
deferred), IBN capture on Sales Order (§132.2 — deferred), `fo_customer_type`/Plan Feed
item-filtering logic (untouched, orthogonal per §132.4). If you find yourself editing
`sales_order.handlers.ts`, `SOCreatePage.jsx`, or `delivery_order.handlers.ts`, stop — that is a
different, not-yet-started task.

---

## Work Stream A — DB Migration

New migration file (`supabase/migrations/<timestamp>_mm04_complete_redesign.sql`):

### A.1 — `customer_master.is_dependent`
```sql
ALTER TABLE erp_master.customer_master ADD COLUMN is_dependent boolean NOT NULL DEFAULT false;
UPDATE erp_master.customer_master cm
SET is_dependent = EXISTS (
  SELECT 1 FROM erp_master.customer_address ca
  WHERE ca.customer_id = cm.id AND ca.depot_code_id IS NOT NULL
);
CREATE INDEX idx_customer_master_is_dependent ON erp_master.customer_master(is_dependent);
```
Rule (§132.5 point 2): TRUE if **at least one** address is VDC-mapped, FALSE otherwise. A
customer's addresses can be a mix of mapped/unmapped VDCs (§132.5 point 3, business-owner
confirmed, no restriction) — this is why the rule is ANY, not ALL.

### A.2 — `customer_master.origin_company_id`
```sql
ALTER TABLE erp_master.customer_master ADD COLUMN origin_company_id uuid REFERENCES erp_master.companies(id);
-- backfill: earliest customer_company_map row per customer
UPDATE erp_master.customer_master cm
SET origin_company_id = sub.company_id
FROM (
  SELECT DISTINCT ON (customer_id) customer_id, company_id
  FROM erp_master.customer_company_map
  ORDER BY customer_id, created_at ASC
) sub
WHERE sub.customer_id = cm.id;
```
**Column stays NULLABLE — confirmed live on dev (2026-08-27): 2 of 5 existing customers
(`C-00004`, `C-00006`) have zero `customer_company_map` rows at all (pre-existing data gap,
predates §113.6's "company mapping mandatory at create" fix).** Do not force `NOT NULL` and do
not guess a company for these two — leave them NULL, same spirit as VDC mapping being
optional/Stage-2. Every customer created **after** this brief ships will always get this set,
since `createCustomerHandler` already makes company-mapping mandatory at create time (§113.6) —
`origin_company_id` should be set in that same handler, from the first (and at create-time, only)
`customer_company_map` row being inserted, not derived after the fact.

**Immutable after set** (§132.9) — no handler should ever UPDATE this column after creation.

### A.3 — Apply, reconcile, verify
Follow `CLAUDE.md` §8A migration-integrity rules exactly: apply via `apply_migration`, reconcile
`schema_migrations` if timestamps drift, `NOTIFY pgrst, 'reload schema';`, then
`node scripts/migration-integrity-check.mjs` on dev. Do this in dev only — prod is a separate,
later step (§7's Dev→Prod workflow), not part of this brief.

---

## Work Stream B — Backend: `is_dependent` auto-recompute

In `supabase/functions/api/_core/om/customer_address.handlers.ts`, both
`updateCustomerAddressHandler` and `bulkMapCustomerAddressesHandler` currently update
`depot_code_id` and return. After that update succeeds (same function, right before the
`okResponse` return), add a step that:
1. Re-reads the affected `customer_id` (single address → its own `customer_id`; bulk → the one
   shared `customer_id` already resolved earlier in `bulkMapCustomerAddressesHandler`).
2. Runs `EXISTS(SELECT 1 FROM customer_address WHERE customer_id = X AND depot_code_id IS NOT NULL)`.
3. Updates `customer_master.is_dependent` to that boolean.

This is a single extra query per call, not a loop — §8B does not apply here (one customer per
call, not N).

---

## Work Stream C — Backend: retroactive Vendor-link

Today `updateCustomerHandler` (`customer.handlers.ts`) never accepts `vendor_id` in its
`mutableFields` — set only at create time. Add a new, explicit action rather than silently
allowing `vendor_id` inside the generic update body (so this stays a deliberate, auditable
action, not an accidental field edit):

- New handler `linkCustomerToVendorHandler` (`POST` or `PATCH`, your choice matching this file's
  existing convention) — takes `customer_id` + `vendor_id`. Guards: `assertCustomerCompanyScope`
  (EDIT), reject if `existing.vendor_id` is already set (this is a one-time transition,
  independent → vendor-linked; do not allow re-linking to a different vendor — if that's ever
  needed it's a new, separate decision, not part of this brief). On success: set `vendor_id`,
  and pull `customer_name`/`gst_number` from the vendor the same way `handleVendorSelect` does
  client-side today (reuse whatever server-side vendor-profile fetch already exists, e.g. the
  same lookup `createCustomerHandler` would use if you follow that code path — check first
  rather than duplicating logic).
- New route + `route-acl-registry.ts` entry (checklist #8) — same resource/action as
  `updateCustomerHandler` (`OM_CUSTOMER_CREATE:EDIT`), just a distinct route path.
- Frontend: `CustomerEditForm.jsx` — when `!isVendorLinked`, show a "Link to existing Vendor"
  action (vendor picker, same options query as `CustomerCreateForm.jsx` already uses) that calls
  this new endpoint. After success, `customer_name`/`gst_number` become read-only exactly like
  the existing vendor-linked-at-creation case already does (`isVendorLinked` check already gates
  this in `updateCustomerHandler`'s `mutableFields` — no change needed there, it already excludes
  those fields once `vendor_id` is set).

---

## Work Stream D — Backend + Frontend: GST-based duplicate-detect + reuse

**Locked (§132.8):** GST present → check across ALL companies for an existing customer with that
GST; found → offer "Map to my Company" (reuses the row, no new `customer_master` insert). GST
absent (Unregistered party) → skip the check entirely, normal create.

- New handler `findCustomerByGstHandler` (mirrors `findFgParentCompanyByGst` in whichever file
  that lives in — read it first, match its shape/response contract). Takes `gst_number`, searches
  `customer_master` with **no company_id filter** (this is intentionally cross-company — do not
  add `assertCompanyScope` here, the whole point is finding matches outside the caller's own
  company scope; confirm this doesn't trip the company-scope-guard script, and if it does, add
  the documented exception the way other legitimate cross-company lookups are handled).
- **Reuse mechanism already exists — do not rebuild it.** `mapCustomerToCompanyHandler` and
  `listCustomerCompanyMapsHandler` (referenced in feasibility §113.7 as already-existing) do the
  actual "map existing customer to a new company" insert into `customer_company_map`. Verify
  they still exist and still work before wiring the new find-by-GST flow to them — if they were
  since removed/renamed, that's a discrepancy to flag, not silently re-implement.
- `CustomerCreateForm.jsx`: after `handleCheckGst()` succeeds (or on GST field blur, whichever
  fits the existing flow better), if `gst_number` is non-empty, call `findCustomerByGstHandler`.
  Match found + not already mapped to the current company → show a distinct "This GST belongs to
  an existing customer — Map to my Company instead?" affordance in place of the normal Save
  button; clicking it calls the existing map handler and closes the form via the same `onSaved`
  callback (so callers like Plan Feed's inline modal and MM04's own create page both get the
  right behavior for free). Match found + already mapped to current company → surface this as a
  plain "already exists in this company" notice (nothing to map). No match, or GST blank → normal
  create flow, unchanged.

---

## Work Stream E — Frontend: List column spec + title rename

- `CustomerListPage.jsx` — rebuild the grid's columns to exactly this list (§132.7): Party Name,
  Address (Site Name — note: a customer can have multiple addresses; decide alongside this
  whether the list shows one row per customer with its *first/primary* address, or the list stays
  customer-grain with a separate address sub-view in the drawer — read §129.8's already-locked
  drawer plan, which nests the address grid *inside* the customer drawer, meaning the **list
  itself stays customer-grain, not address-grain** — don't re-litigate this, just implement it),
  Category (Dependent/Independent from `is_dependent`), VDC/DC (blank if none), Parent Company
  (blank if none), GST Number (blank if none), Created From (Company) (from `origin_company_id`,
  bulk-resolved to `company_name`, §8A).
- Backend: whichever handler feeds this list (`listCustomersHandler`) must bulk-resolve
  `origin_company_id` → company name, and (for any customer with `is_dependent = true`) resolve
  one representative VDC/Parent-Company pair for display — since a customer can have multiple
  addresses on multiple different VDCs (§132.5 point 3), decide and document in your PR
  description which one you show when there's more than one (e.g., first-mapped by `created_at`)
  — this is a display simplification, not a new business rule; the full breakdown is still
  visible inside the drawer's address grid.
- Title: MM04's `erp_menu.menu_master`/`acl.menu_master` row title "FG Sales Customer" → "Customer
  Master". **This is MCP data, not a migration** (§8A rule) — do it via `execute_sql`/direct
  update on both dev and (later, separately) prod, not a migration file.

---

## Work Stream F — Frontend: ErpDenseGrid + Center Drawer + keyboard nav

Follow the exact pattern already built for AC01 (`AC01Page.jsx`) and already locked for this
page specifically in §129.8 — this brief is that migration actually happening:

- `CustomerListPage.jsx` — grid gains `cellNavigate virtualize`; `onRowActivate` opens a center
  `DrawerBase` (`side="center"`, `min(1480px, calc(100vw - 24px))`) instead of navigating to
  `CustomerDetailPage`'s own route. Keep the route itself working (direct-link/refresh case) —
  don't delete `CustomerDetailPage.jsx`, just also render it inside the drawer, or extract its
  content into a shared component both the route and the drawer render (check how AC01 handles
  this exact duplication before picking an approach).
- Inside the drawer: Customer header fields (Name/GST/Category/etc.) redesigned as a **compact
  table/grid layout**, not the current long stacked-vertical form — this is the concrete fix for
  "boddo clumsy, boddo scroll" from this session. Below that, the Address list as a **nested**
  `ErpDenseGrid` (`cellNavigate virtualize`) — `CustomerAddressVdcMappingPage.jsx`'s existing
  multi-select bulk-map action stays, just needs to live inside this nested grid instead of (or
  in addition to) its current standalone page.
- Keyboard: Tab/Arrow-key navigation should fall out of `ErpDenseGrid`'s existing built-in
  support (check `ErpDenseGrid.jsx` — per §129.8's own note, Enter is already handled via
  `onRowActivate`, no new keydown listener needed at the page level). Save/Edit and other action
  buttons need keyboard shortcuts matching this app's existing shortcut-keyed-button convention
  (grep for how AC01/AC03 already do this — reuse the same mechanism, don't invent a new one),
  including for buttons that live inside this center drawer specifically (confirm the shortcut
  system works when focus is inside a drawer, not just on a bare page).

---

## Work Stream G — MM05 full retirement (Option 1 — full retire, per business-owner decision)

1. **Menu/ACL (MCP data, dev only for now):** delete the `OM_FG_DISPATCH_CUSTOMER` row from
   `erp_menu.menu_master` and `acl.menu_master` (tx_code `MM05`). Confirm no other live
   capability/version-table row still references it before deleting (check
   `acl.capability_menu_actions` and the versioned `acl.version_*` tables too — a stale grant
   left behind is harmless but check anyway).
2. **Dead tables (migration, since this is schema DDL):** `DROP TABLE erp_master.fg_dispatch_customer`
   and `erp_master.fg_dispatch_customer_address` — confirmed 0 rows in dev (re-verify at
   implementation time, don't trust this brief's snapshot if time has passed). Do **not** touch
   `erp_master.fg_parent_company` or `erp_master.fg_depot_code` — those stay, shared with MM04
   (§129.2, unchanged).
3. **Dead code:** delete `frontend/src/pages/dashboard/om/FgDispatchCustomerPage.jsx` and
   `supabase/functions/api/_core/om/fg_dispatch_customer.handlers.ts`. Remove their route
   registrations, `route-acl-registry.ts` entries, and any `operationScreens.js` screen_code
   referencing them. Grep the whole repo for `fg_dispatch_customer` and `FgDispatchCustomer`
   after deleting to confirm zero dangling references (imports, route tables, API client
   functions) — a leftover import here is exactly the pattern-#14 (JSX-no-undef) or dead-route
   class of bug this project has been bitten by before.

---

## 15-bug-pattern checklist — apply explicitly, not just "should be fine"

Per the standing rule (feasibility §116/§129.10 precedent), run this against every concrete
choice above before calling it done, not just once at the start:

- **#2 company-scope:** every new/changed handler in Work Streams B/C/D/E goes through
  `assertCustomerCompanyScope` — except the intentionally-cross-company `findCustomerByGstHandler`
  (Work Stream D), which must be a documented, deliberate exception, not an oversight.
- **#8 route/ACL registry:** every new route (`linkCustomerToVendorHandler`,
  `findCustomerByGstHandler`) gets a `route-acl-registry.ts` entry.
- **#13 payload-completeness:** run `frontend-payload-guard.mjs` after wiring the new frontend
  call sites.
- **#14 JSX-no-undef:** run `jsx-no-undef-guard.mjs` after the drawer/grid restructuring in Work
  Stream F, and after deleting `FgDispatchCustomerPage.jsx` in Work Stream G.
- **#15 API-client double-unwrap:** check each new `fetchXxx()` call site's target handler for
  whether it returns `pagination` before assuming `res.data` vs `res` — do not copy a sibling
  call site blindly.

---

## Verification plan

1. `deno check` on every touched backend file — `git stash` before/after, zero *new* errors
   (existing `.range()`/`.or()`/`.gt()` typing noise is pre-existing baseline, not yours to fix).
2. `eslint` on every touched frontend file — zero new errors/warnings.
3. Guard scripts: `company-scope-guard` (or whichever covers `customer.handlers.ts` today),
   `frontend-payload-guard.mjs`, `jsx-no-undef-guard.mjs`, `route-acl-registry-guard.mjs`.
4. `node scripts/migration-integrity-check.mjs` → `in_sync = true` on dev after Work Stream A/G.2.
5. Direct SQL check on dev: all 5 existing `customer_master` rows have `origin_company_id` set
   (not NULL) and `is_dependent` computed correctly against their actual `customer_address` rows.
6. `grep -r "fg_dispatch_customer\|FgDispatchCustomer" --include="*.ts" --include="*.jsx"` returns
   nothing after Work Stream G.
7. No dev-login in this environment for live click-through — note this explicitly as unverified
   in your completion log, same as every other recent session has had to.

## Explicitly NOT in this brief (do not start these)

SO01/DO/Invoice changes, the polymorphic Ship-To/Bill-To resolver's actual build/consumption,
IBN capture, and prod replication of any of the above (dev-only for this brief; prod is a
separate, later step per the established Dev→Prod workflow, §7).

## Commit convention

Follow this repo's normal commit discipline — do not amend, create new commits per logical work
stream if it's cleaner to review that way. If Codex executes this brief, commits must carry
`Co-Authored-By: Codex` per the established convention ([[feedback_codex_commit_marker]]).
