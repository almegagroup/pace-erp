# CODEX TASK — Communication Automation Phase 2: SA/GA Enrollment UI

**Status:** READY FOR APPROVAL — DO NOT IMPLEMENT UNTIL BUSINESS OWNER SAYS `YES`  
**Date:** 2026-09-14  
**Branch:** `dev`  
**Depends on:** Communication Automation Phase 1 Foundation  
**Master plan:** `docs/PACE-ERP-COMMUNICATION-AUTOMATION-MASTER-PLAN.md`

---

## 1. Read First

Before changing code, read completely:

1. `CLAUDE.md`
2. `docs/PACE-ERP-COMMUNICATION-AUTOMATION-MASTER-PLAN.md`
3. `docs/CODEX-COMMUNICATION-AUTOMATION-PHASE-1-FOUNDATION-TASK-BRIEF.md`
4. This Phase-2 task brief
5. Current Phase-1 implementation on `dev`:
   - `supabase/functions/api/_core/admin/communication/communication_enrollment.handlers.ts`
   - `supabase/functions/api/_core/communication/surface_manifest.ts`
   - communication migrations
   - admin route + route ACL wiring
6. Existing current SA/GA frontend pages, routing, API client patterns, dense-table/form patterns, notification/toast/error patterns, and admin menu/navigation conventions.

Do not infer stale frontend/admin conventions. Read the current dev branch first.

---

# 2. Phase 2 Goal

Build the **simple central SA/GA Communication Enrollment UI** on top of the already-completed Phase-1 backend.

The user experience must allow SA/GA to:

1. search an existing PACE page by TX Code or Page Name,
2. select the page,
3. see whether that page is technically communication-capable,
4. enlist/configure a communication-capable page,
5. switch Email ON/OFF,
6. select exactly which valid dependent sub-pages/surfaces may later show the Automation Settings action,
7. save the configuration atomically through the Phase-1 backend,
8. de-enlist/disable a previously enrolled page.

Phase 2 is a **central control UI only**.

It does NOT add page-level Automation Settings buttons, email rules, recipients, schedules, report datasets, MSG91, or email sending.

---

# 3. Locked Authorization

This control is available to:

- Super Admin (SA)
- Global Admin (GA)

Use the existing PACE admin-universe authorization model (`context.isAdmin` / existing frontend admin access pattern).

Do NOT add a new role model.
Do NOT hard-code frontend role arrays if the current project architecture has an existing admin capability/context guard.
Normal users must not access or mutate this control.

---

# 4. UX Principle — Keep It Very Simple

The SA/GA page must NOT become a complex configuration workspace.

No card-heavy dashboard.
No side-panel maze.
No technical database fields.
No raw route/resource/surface editing.
No SQL.

Prefer PACE's dense operator/admin style.

The page should conceptually have only two working areas:

```text
Communication Automation Control

Search TX Code or Page Name
[ PO11________________________ ]

Search Results
-------------------------------------------------------------
TX     Page                  Communication    Enlisted
PO11   Procurement Planning  Ready            Yes/No
-------------------------------------------------------------

Selected Page
PO11 — Procurement Planning

Email: [ ON / OFF ]

Show Automation Settings on:
[x] Planning Dashboard
[x] Monthly Plan Input
[ ] SLOC Group Setup
[ ] Item Group Setup
[ ] History / Archive
[x] Planning Dashboard Report

[ Save ]   [ De-enlist ]
```

Exact components must follow existing PACE component/style conventions.

---

# 5. Search Behavior

Use the Phase-1 backend search endpoint rather than duplicating page data in frontend.

Expected backend route currently:

`GET /api/admin/communication/pages?q=...`

Re-verify current dev route before implementation.

Search must support:

- exact TX code (`PO11`)
- partial TX/menu code where backend supports it
- exact page title
- partial page title

## Search result display

Show only useful human-readable columns, preferably:

- TX Code
- Page Name
- Communication readiness
- Enlisted status

Route/resource code may be available internally but should not dominate the UI.

## Search debounce

Avoid one network call per keystroke if existing PACE search patterns use debounce. Use a modest debounce consistent with the app.

Do not add unnecessary minimum search length that conflicts with the Phase-1 backend contract.

---

# 6. Communication-Ready vs Not Ready

Search may return normal PACE pages without a Communication Surface Manifest.

For results where:

`communication_capable = false`

show a simple status such as:

`Not communication-ready`

The page may be selected for inspection if useful, but **must not be enlistable/configurable**.

Do not allow SA/GA to bypass the developer-owned surface manifest.

For:

`communication_capable = true`

allow configuration.

PO11 is the first expected communication-ready page.

---

# 7. Selected Page State

When a communication-ready search result is selected, use the Phase-1 enrollment-state endpoint.

Expected route currently:

`GET /api/admin/communication/enrollment?page_menu_id=...`

Re-verify current dev contract.

Render:

- TX Code
- Page Name
- current enlisted state
- Email enabled state
- developer-declared valid surfaces
- currently selected surfaces

Do NOT create the surface list in frontend manually.

The surface list returned by backend is authoritative for the UI.

---

# 8. Email Toggle

The page has one simple Email control:

`Email: ON / OFF`

Phase 2 supports Email only.

Do NOT show a fake active WhatsApp toggle.

If desired, a non-interactive future label may be omitted entirely. Prefer omission over clutter.

Turning Email OFF must be allowed without deleting enrollment history/state.

Do not interpret Email OFF as delete.

---

# 9. Surface Selection

Show friendly labels returned by backend as checkboxes.

For PO11, current expected surfaces are:

- `planning_dashboard` → Planning Dashboard
- `monthly_plan_input` → Monthly Plan Input
- `sloc_group_setup` → SLOC Group Setup
- `item_group_setup` → Item Group Setup
- `history_archive` → History / Archive
- `report_view` → Planning Dashboard Report

Do not hard-code these as the source of truth in frontend. They are listed here only as acceptance examples.

The frontend submits backend-returned stable keys.

The backend already validates unknown/invented keys.

---

# 10. Save Behavior

Use the existing atomic Phase-1 mutation endpoint.

Expected route currently:

`POST /api/admin/communication/enrollment`

Re-verify exact request contract.

The save must send the complete desired state, conceptually:

```json
{
  "page_menu_id": "...",
  "email_enabled": true,
  "active": true,
  "surface_keys": [
    "planning_dashboard",
    "monthly_plan_input",
    "report_view"
  ]
}
```

Do not perform separate frontend writes for parent + surfaces.

One Save action => one atomic backend mutation.

## Save UX

- disable Save while request is in flight,
- prevent double-submit,
- show clear success confirmation,
- on failure, preserve the user's unsaved selection and show the backend error safely,
- after success, refresh/read canonical backend state rather than assuming local state is authoritative.

---

# 11. Dirty-State Protection

If the user has changed Email/surface selection but has not saved yet:

- switching to another search result must not silently discard edits,
- use the lightest existing PACE pattern for unsaved-change confirmation,
- do not build a complicated draft system.

If no reusable confirmation pattern exists, implement a minimal confirmation consistent with current UX.

---

# 12. De-enlist Behavior

SA/GA must be able to de-enlist a page.

Use the existing Phase-1 state model rather than deleting audit rows.

Preferred behavior:

- set enrollment `active = false`,
- set Email disabled as part of the desired state,
- surfaces become non-active through the atomic save contract,
- historical rows remain for audit/future reactivation.

Use an explicit confirmation before de-enlisting.

After success, UI should clearly show that the page is no longer enlisted.

Do NOT physically delete enrollment history unless the existing Phase-1 contract explicitly requires deletion (it currently should not).

---

# 13. Initial / Empty State

When no page is selected:

Show a small instruction, for example:

`Search by TX Code or Page Name to configure Communication Automation.`

Do not fill the screen with empty cards/metrics.

---

# 14. API Client Layer

Follow the existing frontend API organization.

Do not scatter raw `fetch()` calls across the UI if PACE uses central API helpers.

Create/reuse the smallest communication-admin API wrapper needed for:

- search pages,
- get enrollment,
- save enrollment.

Keep response parsing/error normalization consistent with current PACE API patterns.

---

# 15. Admin Route / Menu Placement

Before adding frontend route/menu entries, inspect the current SA/GA administration structure.

Use the least disruptive existing pattern.

Preferred outcome:

A clearly named admin page such as:

`Communication Automation`

or

`Communication Control`

under the existing SA/GA administrative area.

Do NOT invent a duplicate admin shell.

If a new menu-master record/migration is required by the current PACE menu architecture:

1. use the existing menu/tx/resource conventions,
2. create a new forward-only Dev migration,
3. apply only to Dev,
4. document the chosen TX/resource identity,
5. do not touch Production.

If the existing admin navigation supports a page without a new menu DB row, prefer the established pattern rather than forcing a migration.

---

# 16. Phase 2 Does NOT Add the PO11 Button Yet

Very important:

Phase 2 controls **where the button will later be allowed**.

It does NOT render `Automation Settings` inside PO11 yet.

That is a later phase (surface-aware page button/drawer work after report-manifest/adapter sequencing defined in the master plan).

So after Phase 2:

SA/GA may save:

- PO11 Email = ON
- Planning Dashboard selected
- Report View selected

but PO11 itself still does not need to display the Automation Settings button in this phase.

---

# 17. Strict Out of Scope

Do NOT implement:

- MSG91
- SMTP/email sending
- recipients
- TO/CC/BCC
- subject templates
- Daily/Weekly/Monthly schedules
- cron / pg_cron
- queue/outbox
- retry/history UI
- report datasets
- report field/column selection
- condition builder
- preview/test mail
- PO11 Critical/Replenishment email adapter
- PO11 Automation Settings button
- PO11 center drawer
- WhatsApp
- production database changes

If any of these appear necessary, stop and report instead of expanding scope.

---

# 18. Security Requirements

Verify all of the following:

1. Only SA/GA can load/use the control page according to existing admin patterns.
2. Normal users cannot use the backend mutation even if they manually call it.
3. Frontend does not write directly to `erp_communication` tables.
4. Frontend does not call the database RPC directly.
5. All mutations go through the authenticated backend endpoint.
6. Surface keys come from backend state/manifest.
7. Non-capable pages cannot be enlisted.
8. No provider secrets exist.
9. No company report/business data is exposed by this Phase-2 page.
10. Backend remains the authority.

---

# 19. Required Functional Verification

At minimum test:

### Search

1. `PO11` returns Procurement Planning.
2. `Procurement Planning` returns PO11.
3. partial page-name search works according to backend behavior.
4. unknown search shows clean no-results state.
5. non-communication-capable PACE page is visible as `Not communication-ready` and cannot be enlisted.

### Enrollment read

6. selecting PO11 loads all six current backend-declared surfaces.
7. no surface list is sourced from frontend hard-code.

### Save

8. Email ON + 3 surfaces saves successfully.
9. refresh/reselect reproduces exact saved state.
10. changing to 2 different surfaces updates canonical state without duplicates.
11. previously inactive surface can be re-selected/reactivated.
12. Email OFF saves without deleting page history.
13. de-enlist makes page inactive and surfaces non-active as designed.
14. re-enlist works cleanly.

### Error / protection

15. double-click Save cannot create duplicate operations/state.
16. backend error displays safely and preserves current unsaved choices.
17. unsaved edits are not silently discarded when switching selected page.
18. normal user access is denied.
19. SA works.
20. GA works.

### Regression

21. existing admin pages still work.
22. existing PO11 behavior is unchanged.
23. Phase-1 endpoint behavior is unchanged except for expected UI use.
24. no email is sent.
25. Production is untouched.

---

# 20. Visual / UX Acceptance

The final page should feel like a small administrative tool, not a dashboard product.

Acceptance:

- one obvious search field,
- compact results,
- one selected-page configuration area,
- one Email toggle,
- simple surface checkboxes,
- Save + De-enlist actions,
- no unnecessary cards,
- no side panels,
- keyboard-friendly controls where existing PACE components support them,
- clear loading/error/success states.

---

# 21. Local → Dev Workflow

Follow the PACE workflow exactly:

1. Start from latest `dev`.
2. Confirm clean/known working tree and do not overwrite unrelated local work.
3. Implement locally.
4. Run relevant local checks.
5. If a migration is genuinely required for admin menu registration, create it locally and apply to **Dev Supabase only**.
6. Verify Dev database if touched.
7. Review diff for scope leakage/security.
8. Commit.
9. Push to `dev`.
10. Verify Vercel/Render Dev deployment(s) relevant to changed code reach the new commit and are healthy.
11. STOP.

Do not merge to `main`.
Do not touch Production/Main Supabase.

---

# 22. Checks / Guards

Run all checks relevant to touched files and repository conventions, including as applicable:

- frontend ESLint
- frontend build
- JSX undefined guard
- frontend payload guard
- hard-coded role guard
- route ACL registry guard if backend routes are touched
- Deno/type checks if backend code is touched
- migration integrity if a migration is added
- resource/domain/menu guards affected by a new admin menu identity

Document pre-existing failures separately and introduce zero new regressions.

---

# 23. Acceptance Criteria

Phase 2 is complete only when an SA/GA can perform this workflow in Dev:

1. Open Communication Automation Control.
2. Search `PO11`.
3. Select `Procurement Planning`.
4. Turn Email ON.
5. Select exactly:
   - Planning Dashboard
   - Monthly Plan Input
   - Planning Dashboard Report
6. Save once.
7. Reload/reselect and see exactly those three selected.
8. Change selection and save again.
9. Turn Email OFF or de-enlist.
10. Re-enlist without duplicate database rows.

And:

- non-admin cannot access/mutate it,
- non-communication-ready pages cannot be enlisted,
- no PO11 page button exists yet,
- no email/send configuration exists yet,
- Production remains untouched.

---

# 24. Final Report Required from Codex

When complete, report exactly:

## 1. Status
DONE / PARTIAL / BLOCKED

## 2. Files changed

## 3. Admin page placement
- route
- menu/admin location
- TX/resource/menu identity if a new menu entry was required

## 4. Frontend API contracts used
- search
- read enrollment
- save enrollment

## 5. UX behavior
- search
- communication-ready status
- Email toggle
- surfaces
- Save
- De-enlist
- dirty-state behavior

## 6. Authorization
Confirm:
- SA allowed
- GA allowed
- normal users denied

## 7. Migration
If added:
- filename
- reason
- Dev apply result
- integrity result

If none:
- explicitly state no Phase-2 DB migration was needed.

## 8. Verification/tests
List exact commands and results.

## 9. Dev commit SHA

## 10. Dev push status

## 11. Dev deployment status
Confirm relevant Render/Vercel deployment is healthy/current.

## 12. Production confirmation
Explicitly confirm Production/Main DB was NOT touched.

## 13. Scope confirmation
Explicitly confirm none of the following were started:
- MSG91/email sending
- recipient/rule/schedule engine
- PO11 Automation Settings button/drawer
- Report Manifest/PO11 report adapter
- WhatsApp

Then STOP. Do not begin Phase 3 automatically.

---

# 25. Explicit Implementation Gate

**Do not implement merely because this file exists.**

Implementation starts only after the business owner explicitly says:

`YES`

After Phase 2 is completed and verified, stop and wait for separate approval for the next phase.
