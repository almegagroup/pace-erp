# PACE ERP — Communication Automation Master Plan

**Status:** DESIGN LOCK / IMPLEMENTATION NOT STARTED  
**Date:** 2026-09-14  
**Initial channel:** Email only  
**Initial delivery provider:** MSG91  
**Pilot page:** PO11 — Procurement Planning  
**Pilot companies:** CMP003 and CMP006  
**Future channel:** WhatsApp (architecture-ready, live implementation deferred)

---

## 1. Business Goal

Build one reusable PACE ERP Communication Automation framework with two clearly separated layers:

1. **SA Central Enrollment** — Super Admin decides which PACE page is communication-enabled and exactly which sub-page/surface should show the Automation Settings action.
2. **Page-level Automation Configuration** — authorized users configure recipients, subject, schedule, datasets, columns, conditions, preview, and match behavior from that page/surface.

Email is the first live channel. WhatsApp is a future channel and must not complicate the first release.

PO11 is the first pilot.

---

## 2. SA UX — must stay simple

The SA page must NOT be a complex technical configuration screen.

### 2.1 Search-first enrollment

SA sees one primary search box:

`Search by TX Code or Page Name`

Examples:

- `PO11`
- `Procurement Planning`
- partial page name

Search results should come from the existing PACE page/menu catalog (current menu master / route identity), not from a manually duplicated page list.

The result shows only human-usable information such as:

- TX Code
- Page Name
- Module / parent menu if useful
- Route (optional, secondary)
- Current communication enrollment state

SA selects a result and clicks **Enlist / Configure**.

### 2.2 Parent page + dependent sub-pages/surfaces

Selecting a page is not enough.

A page may contain several dependent views/tabs/sub-pages/surfaces. SA must be able to choose exactly where the Automation Settings button is visible.

Example PO11 surfaces currently include concepts such as:

- Main / default page surface
- Planning Dashboard
- Monthly Plan Input
- SLOC Group Setup
- Item Group Setup
- History / Archive
- Report View

The exact keys must come from the page's developer-defined surface manifest; labels shown to SA should be friendly.

SA UI should conceptually look like:

```text
PO11 — Procurement Planning

Email: [ ON ]

Show Automation Settings on:
[x] Planning Dashboard
[x] Monthly Plan Input
[ ] SLOC Group Setup
[ ] Item Group Setup
[ ] History / Archive
[x] Report View

[ Save ]
```

This is intentionally simpler than asking SA to manage routes, resource codes, datasets, database tables, or technical flags.

### 2.3 De-enrollment

SA must be able to:

- disable Email for the whole enlisted page,
- remove one or more selected surfaces,
- de-enlist the page entirely if needed.

Disabling/de-enlisting must stop new configuration use on those surfaces without deleting historical delivery/audit records.

---

## 3. Safety Model — SA can choose location, not data internals

The SA search/enrollment model must not create a security hole.

### 3.1 Existing PACE menu/page catalog is discovery source

SA may search normal PACE pages by TX code or page name.

### 3.2 Developer-defined Communication Surface Manifest is the technical allowlist

Each communication-capable page must declare a code-owned manifest such as:

```text
Page: PO11
Stable page identity: tx_code/resource_code
Surfaces:
- planning_dashboard
- monthly_plan_input
- sloc_group_setup
- item_group_setup
- history_archive
- report_view
```

Each surface has:

- stable `surface_key`
- friendly label
- how frontend determines whether that surface is active
- supported communication channels
- later: report dataset adapter(s)

SA cannot invent a surface key.

### 3.3 Enrollment is different from report-data access

SA selecting `PO11 > Planning Dashboard` means:

> “Automation Settings is allowed to appear here.”

It does NOT mean:

> “SA can choose arbitrary database tables/columns.”

Report datasets/fields remain developer-controlled by the later Report Manifest / Adapter.

---

## 4. Page-level Automation Settings

When all are true:

1. parent page is enlisted,
2. Email is enabled for the parent page,
3. current surface is selected by SA,
4. user has the required ACL/company scope,
5. the page/surface has a valid communication manifest,

then the page/surface shows:

`Automation Settings`

The action opens a center drawer following PACE dense-operator UX conventions.

The drawer eventually contains:

1. General
2. Channel
3. Recipients (TO/CC/BCC)
4. Subject
5. Schedule
6. Dataset/Table selection
7. Column selection/order
8. Conditions
9. CURRENT_MATCHING / NEWLY_MATCHED behavior
10. Preview / Send Test
11. Save / Activate

---

## 5. Report Manifest / Adapter

The Communication Engine must never query arbitrary database tables based on user input.

Each supported page exposes safe, server-authoritative report datasets and fields through a typed manifest/adapter.

Manifest field metadata may include:

- field key
- label
- data type
- displayable yes/no
- conditionable yes/no
- allowed operators
- formatting
- stable row identity contribution

Users store/select **manifest field keys**, never raw database column names.

---

## 6. PO11 Pilot Contract

### 6.1 Pilot scope

PO11 is the first page.

Initial business companies are CMP003 and CMP006, but the framework must not hard-code company codes.

### 6.2 PO11 surface enrollment

The PO11 Communication Surface Manifest must be derived from the actual current PO11 UI and must cover the stable sub-page/tab/view identities that SA may select.

The current implementation is known to contain views including:

- Planning Dashboard
- Monthly Plan Input
- SLOC Group Setup
- Item Group Setup
- History / Archive
- report-mode view

Codex must re-read the current dev implementation before locking exact surface keys.

### 6.3 PO11 decision grain

Default procurement-alert output mirrors PO11 decision grain:

- standalone material => one decision row
- planning item group => one group decision row

Group-member detail may be optional later.

### 6.4 Candidate PO11 report fields

Expected candidates, subject to current-code verification:

- Planning Status
- Item Type
- Material Code
- Material Name
- Group Name
- Source SLOC Group
- Monthly Requirement Qty
- Available Stock Qty
- Safety Stock Qty
- Replenishment Stock Qty
- Shortfall Qty when authoritatively defined
- TRN Stock Qty
- Gate Entry Stock Qty
- QA Stock Qty
- Safety Days
- Processing Days
- Lead Time Days
- UOM

`CRITICAL / REPLENISH / NORMAL` must reuse PO11's server-authoritative logic and must not be independently reimplemented in the communication engine.

---

## 7. Central Data Model — revised for parent page + surfaces

Final physical names may be adjusted to repository conventions after discovery, but the logical model is locked.

### 7.1 Existing page catalog remains source of truth

Do not duplicate every PACE page into a new communication table just to support SA search.

Search should use the existing page/menu master wherever possible.

### 7.2 `erp_communication.page_enrollment`

Represents a page that SA has enlisted for communication.

Concepts:

- id
- reference to stable existing page/menu identity
- tx_code/resource_code snapshots if useful for audit/debugging
- Email enabled
- future WhatsApp enabled
- active/enlisted state
- audit fields

This is runtime enrollment, not the source of technical page metadata.

### 7.3 `erp_communication.surface_enrollment`

Represents selected dependent page surfaces where the Automation Settings action is allowed.

Concepts:

- id
- `page_enrollment_id`
- stable `surface_key`
- active
- optional channel-specific enabled state if architecture requires it
- audit fields

The backend must validate `surface_key` against that page's code-owned Communication Surface Manifest.

Unknown/invented surface keys are rejected.

### 7.4 Later automation tables

Later phases add:

- `automation_rule`
- `automation_recipient`
- dataset selection
- column selection/order
- conditions
- match-state tracking
- delivery outbox/history

These are deliberately not Phase 1 responsibilities except where a minimal foundation is required.

---

## 8. Runtime visibility rule

Frontend must not hard-code `if (txCode === 'PO11') show button` as the long-term mechanism.

Conceptually:

```text
isCommunicationActionVisible({ pageIdentity, surfaceKey, channel, user })
```

returns true only when:

- the page is enlisted,
- channel enabled,
- surface selected,
- technical manifest supports the surface/channel,
- user ACL permits configuration/use.

This same pattern should work for future pages.

---

## 9. Schedule / Conditions / Recipients

These are later page-level configuration concerns.

### Schedule

- Manual Only
- Daily
- Weekly
- Monthly
- time
- timezone (default Asia/Kolkata)
- selected weekdays/month-day
- skip-empty default

One central scheduler evaluates due rules; never one cron per rule.

### Recipients

- TO
- CC
- BCC
- email
- active/inactive

### Conditions

No SQL entry.

Safe operators include:

- =
- !=
- IN
- NOT IN
- >
- >=
- <
- <=
- BETWEEN
- IS EMPTY
- IS NOT EMPTY

Example:

`Planning Status IN (CRITICAL, REPLENISH)`

### Match modes

- `CURRENT_MATCHING`
- `NEWLY_MATCHED`

---

## 10. Delivery Architecture

```text
SA searches TX/Page Name
        ↓
Enlists parent page
        ↓
Selects allowed sub-page surfaces
        ↓
Authorized page user configures automation
        ↓
Central scheduler finds due rule
        ↓
Page report adapter loads authoritative rows
        ↓
Conditions applied
        ↓
Selected columns rendered
        ↓
Idempotent outbox job
        ↓
MSG91 Email adapter
        ↓
SENT / FAILED / retry / DEAD
        ↓
History + audit
```

Email delivery failure must never roll back or block the ERP transaction that created/changed the underlying business data.

---

## 11. MSG91 Policy

MSG91 is the initial Email delivery provider.

- backend only
- auth key in server environment secret
- never expose key to browser/Git/config tables
- provider receives only final minimum email payload
- provider does not receive Supabase credentials or ERP database access
- integrate behind `EmailProvider.send(...)`
- provider errors/message IDs may be persisted for audit
- future provider replacement must not require rewriting page logic

---

## 12. Implementation Phases

### Phase 1 — Communication Enrollment Foundation

Build only the parent-page + surface enrollment foundation.

Deliver:

1. discover current menu/page identity and PO11 surface/tab model,
2. create `erp_communication` foundation,
3. create page enrollment model referencing the existing PACE page catalog,
4. create selected-surface enrollment model,
5. define code-owned Communication Surface Manifest contract,
6. define PO11 initial surface manifest from current dev code,
7. add backend search/read contract needed later by SA UI:
   - search page by TX/name using existing page catalog,
   - read page communication enrollment,
   - read available technical surfaces,
   - read selected/enabled surfaces,
8. validate that unknown surfaces cannot be enrolled,
9. no real SA UI yet,
10. no email sending/provider/schedule/recipient/rule engine yet.

**Exit condition:** backend can safely answer:

- what PACE page matches the TX/name,
- whether it is enlisted,
- which communication surfaces are technically available,
- which surfaces are selected,
- whether Email is enabled.

### Phase 2 — Simple SA Enrollment UI

Build search-first SA page:

1. search TX code/page name,
2. select result,
3. Enlist,
4. Email ON/OFF,
5. checkbox selected surfaces,
6. Save,
7. de-enlist/disable.

SA does not see technical manifest internals.

### Phase 3 — Report Manifest Framework

Add safe dataset/field/operator contracts.

### Phase 4 — PO11 Report Adapter

Normalize authoritative PO11 planning decision data.

### Phase 5 — Surface-aware Automation Button + Drawer Shell

Selected surfaces only show the action.

### Phase 6 — Rule Configuration

Recipients, subject, schedule, datasets, columns, activation.

### Phase 7 — Condition Builder + Preview

Typed condition evaluation and preview.

### Phase 8 — Central Scheduler

Single due-rule evaluator.

### Phase 9 — Outbox / Queue

Idempotent delivery lifecycle.

### Phase 10 — MSG91 Email Adapter

Server-side delivery integration.

### Phase 11 — CURRENT vs NEWLY_MATCHED

Transition-state tracking.

### Phase 12 — Delivery History / Audit / Operations

Status, attempts, errors, manual retry where safe.

### Phase 13 — Security / UAT / PO11 Production Pilot

CMP003 + CMP006 controlled rollout.

### Phase 14 — More Pages

New pages plug in through surface manifest + report adapter rather than rebuilding the communication engine.

### Future — WhatsApp

Reuse enrollment, surface placement, scheduling, conditions, queue, and audit; add WhatsApp-specific recipient/render/provider layer only after Email is stable.

---

## 13. Security / ACL Requirements

1. SA mutation uses existing Super Admin authorization patterns; no frontend hard-coded role names.
2. Page/surface enrollment is validated server-side.
3. Unknown surface keys are rejected.
4. Page-level automation configuration respects company and page ACL.
5. Cross-company data cannot mix accidentally.
6. Secrets never reach browser.
7. Report fields/operators come only from manifests.
8. HTML values are safely encoded.
9. Configuration changes record actor/time.
10. Delivery has an idempotency boundary.

---

## 14. PO11 UAT Examples

At final pilot, verify among other cases:

- PO11 not enlisted => no automation action.
- PO11 enlisted but Email OFF => no usable Email action.
- PO11 Email ON + only Planning Dashboard selected => button appears there, not on Monthly Plan Input/Setup/History surfaces.
- Add Monthly Plan Input => button appears there without deployment.
- Remove Planning Dashboard => button disappears there without deleting historical rules/delivery audit.
- CMP003 rule never sends CMP006 rows and vice versa.
- configured Critical/Replenish conditions behave as PO11 does.
- no matching rows => skipped when configured.
- provider failure does not affect PO11 transactions.
- duplicate scheduler run does not duplicate a logical delivery.

---

## 15. Non-goals for initial Email rollout

- live WhatsApp sending
- push notification
- in-app notification center
- arbitrary SQL builder
- arbitrary DB table/column selection
- marketing campaign tooling
- provider logic embedded in PO11

---

## 16. Implementation Gate

Each phase requires a dedicated task brief and explicit business-owner approval.

Current task brief:

`docs/CODEX-COMMUNICATION-AUTOMATION-PHASE-1-FOUNDATION-TASK-BRIEF.md`

**Do not implement Phase 1 until the business owner explicitly says `YES`.**
