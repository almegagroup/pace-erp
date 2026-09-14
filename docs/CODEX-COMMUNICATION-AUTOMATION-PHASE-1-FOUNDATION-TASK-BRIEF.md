# CODEX TASK — Communication Automation Phase 1 Foundation

**Status:** READY FOR APPROVAL — DO NOT IMPLEMENT UNTIL BUSINESS OWNER SAYS `YES`  
**Date:** 2026-09-14  
**Branch:** `dev`  
**Master plan:** `docs/PACE-ERP-COMMUNICATION-AUTOMATION-MASTER-PLAN.md`

---

## Read first

1. `CLAUDE.md` — mandatory dev, ACL, company-scope, migration-integrity and guard rules.
2. `docs/PACE-ERP-COMMUNICATION-AUTOMATION-MASTER-PLAN.md` — full design lock.
3. Existing SA/admin pages and menu search/picker patterns.
4. Current `erp_menu.menu_master`, route identity and page/sub-page/tab patterns.
5. Current PO11 page implementation on `dev`, especially how tabs/report-mode/sub-views are identified.

Do not infer stale route/tab identity. Re-read current code first.

---

## Phase 1 Goal

Build only the safe technical foundation needed for a future **simple SA enrollment experience** where SA can:

1. search a PACE page by TX code or page name,
2. enlist that page,
3. see that page's valid dependent sub-pages/surfaces,
4. select exactly which surface(s) may show the Automation Settings action,
5. enable/disable Email for the enlisted page.

Phase 1 itself does **not** build the final SA UI and does **not** send email.

At Phase 1 exit, backend contracts and data model must already support this UX without later redesign.

---

## Hard scope boundary

### IN scope

- discover/reuse existing PACE menu/page catalog as page search source,
- communication page-enrollment data model,
- communication sub-page/surface-enrollment data model,
- developer-owned Communication Surface Manifest contract,
- initial PO11 surface manifest based on current dev implementation,
- backend page search/read contracts needed by Phase 2,
- backend enrollment-state read contract,
- server-side validation of known page + valid surface keys,
- Email enabled state at parent-page enrollment level,
- future WhatsApp capability represented only as a reserved channel where needed,
- ACL/security/grants/indexes/audit patterns consistent with PACE,
- verification/guard work.

### OUT of scope — do not touch

- final SA UI page,
- MSG91 API or credentials,
- SMTP/email sending,
- automation rule CRUD,
- recipients / TO / CC / BCC,
- subject templates,
- schedule/time/frequency,
- scheduler / pg_cron,
- queue/outbox,
- retries/history,
- report dataset/column configuration,
- condition builder,
- preview/test send,
- PO11 Critical/Replenishment report adapter,
- page-level Automation Settings drawer/button rendering,
- WhatsApp sending,
- production changes.

If implementation requires any OUT-of-scope feature, stop and report instead of expanding scope.

---

## Core UX contract this foundation must support

The future SA screen is intentionally simple.

### Search

One search box:

`Search by TX Code or Page Name`

Search results should come from existing PACE menu/page records whenever possible; do not duplicate every page into a new communication registry solely for discovery.

### Enlist

SA selects a page and enlists it for communication.

### Surface selection

After page selection, SA sees only valid developer-declared dependent surfaces with friendly labels and checkboxes.

Example concept for PO11:

```text
PO11 — Procurement Planning

Email [ON]

Show Automation Settings on:
[x] Planning Dashboard
[x] Monthly Plan Input
[ ] SLOC Group Setup
[ ] Item Group Setup
[ ] History / Archive
[x] Report View
```

SA must not type routes, resource codes, surface keys, database table names, or SQL.

---

## Locked conceptual model

### Existing Page Catalog

Current PACE page/menu master remains the discovery source for searchable page identity wherever feasible.

### `erp_communication.page_enrollment`

Represents a page that SA has enlisted.

Logical fields include:

- `id` UUID PK
- stable existing page/menu reference if available
- `tx_code` / `resource_code` snapshot/reference as useful for integrity/debugging
- `email_enabled`
- future `whatsapp_enabled` only if needed for forward-compatible shape
- `active` / enlisted state
- audit fields following repo conventions

Do not create rows for every PACE page pre-emptively. Enrollment rows should represent enlisted pages.

### `erp_communication.surface_enrollment`

Represents an allowed dependent sub-page/surface for an enlisted page.

Logical fields:

- `id` UUID PK
- `page_enrollment_id`
- stable `surface_key`
- `active`
- audit fields

Uniqueness must prevent duplicate active enrollment for the same page/surface.

### Communication Surface Manifest

The valid surface list is developer-owned code, not editable free text.

Each page manifest should conceptually declare:

- stable page identity
- supported channel(s)
- list of surfaces
- each surface's stable `surface_key`
- friendly label
- enough metadata for later frontend active-surface detection

Do not put report datasets/fields into this Phase-1 surface manifest unless structurally necessary; Report Manifest is a later phase.

---

## Work Stream A — Repository discovery before code

Before editing, inspect and record in the final implementation summary:

1. current menu/page identity conventions (`id`, `tx_code`, `resource_code`, `route_path`),
2. best existing backend search/picker pattern for page lookup by TX/name,
3. SA/admin route + ACL conventions,
4. audit column conventions,
5. RLS/grant/backend-owned config patterns,
6. route ACL registry and guard scripts,
7. PO11 current tabs/views/report-mode implementation,
8. whether any generic tab/surface identity helper already exists.

Prefer reuse over parallel architecture.

---

## Work Stream B — Database foundation

Create a dev migration consistent with current repo rules.

Target schema:

`erp_communication`

If a demonstrably existing communication/config schema is more appropriate, stop and report before changing the locked model.

### B.1 `page_enrollment`

Requirements:

- references an existing stable PACE page/menu identity where feasible,
- stores Email runtime enabled state,
- stores active/enlisted state,
- audit columns,
- one logical enrollment per parent page.

Do not duplicate page title/route as independent mutable truth unless needed as immutable audit snapshot.

### B.2 `surface_enrollment`

Requirements:

- FK to parent enrollment,
- `surface_key` text/code,
- active state,
- audit columns,
- uniqueness suitable for parent+surface.

Database alone cannot know code manifest contents, therefore application/backend validation is mandatory for surface keys.

### B.3 Constraints/indexes/security

Add only needed constraints/indexes.

Follow existing PACE patterns for:

- grants,
- RLS if applicable,
- backend/service access,
- mutation restrictions.

No untrusted direct frontend writes.

---

## Work Stream C — Communication Surface Manifest contract

Create the smallest reusable code-owned contract for technical page/surface support.

Logical example only:

```js
{
  txCode: 'PO11',
  resourceCode: 'PROC_PLANNING_VIEW',
  channels: ['EMAIL'],
  surfaces: [
    { key: 'planning_dashboard', label: 'Planning Dashboard' },
    { key: 'monthly_plan_input', label: 'Monthly Plan Input' }
  ]
}
```

Match current repository language/style rather than copying this shape blindly.

Required validation helper must safely answer:

- is this page technically communication-capable?
- is this channel supported?
- is this `surface_key` valid for this page?

Unknown page/channel/surface must fail closed.

---

## Work Stream D — PO11 surface manifest

Re-read current `ProcurementPlanningPage.jsx` on dev and derive stable, friendly surfaces from actual implementation.

Known concepts that must be checked include:

- Planning Dashboard
- Monthly Plan Input
- SLOC Group Setup
- Item Group Setup
- History / Archive
- report-mode / Planning Dashboard Report

Do not assume every visual tab deserves a separate communication surface; document the final mapping and why.

Important: surface keys must remain stable even if friendly labels later change.

No PO11 mail data adapter in this phase.

---

## Work Stream E — Backend search/read contracts for Phase 2 SA UX

Build only the backend capabilities needed for the later simple SA page.

### E.1 Search existing pages

Authenticated/authorized search conceptually supports:

- TX code exact/partial match,
- page title/name partial match.

Return a compact result such as:

- stable page/menu id
- tx_code
- resource_code
- title
- route/module parent if useful
- whether currently enlisted
- whether a technical Communication Surface Manifest exists

Do not expose arbitrary menu/internal data unnecessarily.

### E.2 Read technical surfaces + enrollment state

For a selected page return conceptually:

```json
{
  "page": {
    "tx_code": "PO11",
    "resource_code": "PROC_PLANNING_VIEW",
    "title": "Procurement Planning",
    "enlisted": true,
    "email_enabled": true
  },
  "surfaces": [
    {
      "key": "planning_dashboard",
      "label": "Planning Dashboard",
      "supported": true,
      "selected": true
    }
  ]
}
```

Actual response style must follow current API conventions.

Phase 1 may include internal service functions and a minimal authenticated read route if that is the normal architecture. Final SA mutation UI/API belongs to Phase 2.

---

## Work Stream F — Mutation validation foundation

Even if final SA mutation endpoint is deferred, provide reusable server-side validators that Phase 2 must use:

- page exists in PACE catalog,
- manifest exists for page before surface enrollment,
- EMAIL is technically supported before enabling Email,
- `surface_key` exists in the page's manifest,
- deactivated/unknown page fails safely.

SA must never be able to create a made-up surface by posting arbitrary text.

---

## Work Stream G — ACL / security

Follow PACE's real SA capability model; never hard-code `role === 'SA'` in frontend/backend business logic if ACL resources/actions are the project standard.

Search/read/mutation foundation must not create a privilege bypass around menu/ACL rules.

No company-specific report data is touched in Phase 1.

---

## Work Stream H — Verification

Before declaring complete verify:

1. migration applies cleanly on dev,
2. migration integrity passes,
3. existing page catalog remains source of search truth,
4. no pre-population of every ERP page into communication enrollment,
5. PO11 manifest contains only real current surfaces,
6. valid PO11 surface is recognized,
7. invented PO11 surface key is rejected,
8. unsupported/unmanifested page cannot silently gain surface enrollment,
9. backend search finds PO11 by `PO11`,
10. backend search finds PO11 by `Procurement Planning` text,
11. enrollment-state read contract can represent multiple selected surfaces,
12. Email enabled state is independent of which surfaces are selected,
13. no MSG91/email/scheduler/rule/recipient/queue code is introduced,
14. no PO11 business behavior changes,
15. relevant route ACL/company/role/lint/type/guard checks show zero new regressions,
16. no production changes.

Document pre-existing failures separately.

---

## Acceptance criteria

Phase 1 is complete only when the foundation can safely represent and read this scenario:

> PO11 is found by TX/name, enlisted for Email, and exactly `Planning Dashboard`, `Monthly Plan Input`, and `Report View` are selected surfaces while setup/history surfaces remain unselected.

And it can safely reject:

> `PO11 + made_up_surface`

No email is sent and no final SA UI/button/drawer is built yet.

---

## Implementation sequence after explicit approval

When the business owner explicitly says `YES`:

1. Read-first discovery.
2. Confirm current page/menu and PO11 surface conventions.
3. Finalize migration/table naming to match repo conventions.
4. Create/apply dev migration only.
5. Implement generic Communication Surface Manifest contract.
6. Implement PO11 surface manifest.
7. Implement page search + enrollment-state read contract.
8. Implement reusable validation helpers.
9. Add minimal route/ACL wiring only as required by current architecture.
10. Run migrations/guards/tests.
11. Review diff for scope creep/security.
12. Report exact files, migration, checks and results.
13. STOP — do not begin Phase 2.

---

## Explicit implementation gate

**Do not implement merely because this file exists.**

Implementation starts only after the business owner explicitly says:

`YES`

After Phase 1 is completed and verified, stop and wait for separate Phase 2 approval.
