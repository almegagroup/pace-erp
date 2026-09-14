# PACE ERP — Communication Automation Master Plan

**Status:** DESIGN LOCK / IMPLEMENTATION NOT STARTED  
**Date:** 2026-09-14  
**Initial channel:** Email only  
**Initial delivery provider:** MSG91  
**Pilot page:** PO11 — Procurement Planning  
**Pilot companies:** CMP003 and CMP006  
**Future channel:** WhatsApp (architecture-ready, implementation deferred)

---

## 1. Business Goal

Build one reusable PACE ERP communication framework so that:

1. Super Admin (SA) can centrally decide which ERP pages are allowed to expose communication automation.
2. When a page is enabled, that page automatically exposes an **Automation / Communication Settings** action.
3. Authorized users can configure, from the page itself:
   - recipients (TO / CC / BCC),
   - subject,
   - schedule,
   - report dataset/table,
   - visible columns and order,
   - send conditions,
   - current-matching vs newly-matched behavior,
   - preview/test behavior.
4. The framework evaluates the page's **server-authoritative report data**, not frontend-rendered state.
5. Matching data is queued and sent through MSG91 Email.
6. Email failure must never fail or roll back the originating ERP business transaction.
7. The same framework can later support WhatsApp without rebuilding page-level business logic.

The framework must be generic, but the first implementation and UAT target is PO11.

---

## 2. Locked Architecture Principles

### 2.1 Central enablement, page-specific configuration

Two different responsibilities must remain separate:

- **SA Central Control:** decides *where* communication automation is allowed.
- **Page Automation Drawer:** decides *who receives what, when, and under which conditions*.

SA must not edit page-specific report logic.

### 2.2 Technical allowlist; never arbitrary database access

A page cannot become report-enabled merely because an SA selects a database table.

Each supported page must have a developer-controlled **Report Manifest / Adapter** that explicitly declares:

- safe datasets,
- safe fields,
- displayable fields,
- conditionable fields,
- supported operators,
- field types,
- labels,
- optional formatting rules.

Users must never be allowed to type SQL, table names, schema names, or arbitrary column names.

### 2.3 Server-authoritative decisions

Automation conditions must be evaluated on backend-authoritative data.

For PO11, `CRITICAL`, `REPLENISH`, and `NORMAL` must come from/reuse the same authoritative planning logic used by PO11. The communication engine must not create an independent copy of PO11 threshold logic that can drift from the page.

### 2.4 Provider-independent core

PACE owns:

- rule configuration,
- scheduling,
- conditions,
- datasets,
- selected columns,
- recipients,
- queue,
- audit/history,
- retry/idempotency.

MSG91 only delivers the final email payload.

Provider integration must sit behind an adapter boundary such as:

`EmailProvider.send(...)`

The initial adapter is MSG91; a later provider swap must not require rewriting PO11 or the communication rule engine.

### 2.5 Business transaction isolation

No ERP transaction should wait for or depend on email delivery.

The send path must be asynchronous through an outbox/queue. Provider failure affects the delivery job only.

### 2.6 Security boundaries

- MSG91 secret/auth key: server-side environment secret only.
- Never expose provider secrets to frontend, normal configuration tables, logs, or Git.
- Page/report fields are allowlisted by code.
- Rule access is ACL-controlled.
- Rule execution is company-scoped.
- HTML/body values must be escaped/safely rendered.
- Recipient changes and rule changes must be auditable.
- Duplicate scheduler execution must not create duplicate deliveries.

---

## 3. User Experience

### 3.1 SA Central Page

A new SA-facing page will provide a central grid similar to:

| Tx Code | Page | Email Supported | Email Enabled | WhatsApp Supported | WhatsApp Enabled | Active |
|---|---|---:|---:|---:|---:|---:|
| PO11 | Procurement Planning | Yes | ON/OFF | Future | OFF | Yes |

The SA page controls **page/channel availability only**.

When PO11 Email is disabled, the page-level automation button must not be available for normal configuration/use.

### 3.2 Page-level Automation Settings

An enabled page exposes an action such as:

`Automation Settings`

The initial UI will be a center drawer following PACE dense-operator UX conventions.

Sections:

1. General
2. Channel
3. Recipients
4. Subject
5. Schedule
6. Dataset/Table Selection
7. Column Selection + Order
8. Conditions
9. Match Behavior
10. Preview / Test
11. Save / Activate

### 3.3 Recipients

Support at minimum:

- TO
- CC
- BCC
- email address
- active/inactive

Future options may include resolved PACE users/roles/departments, but Phase 1 email automation does not require dynamic organizational recipients.

### 3.4 Subject templates

Subject may use safe supported tokens, for example:

- `{{company_code}}`
- `{{company_name}}`
- `{{page_name}}`
- `{{report_name}}`
- `{{date}}`
- `{{critical_count}}`
- `{{replenishment_count}}`

Unsupported/untrusted arbitrary template execution is forbidden.

### 3.5 Schedule

Target schedule modes:

- Manual Only
- Daily
- Weekly
- Monthly

Configurable values include:

- time,
- timezone (default `Asia/Kolkata`),
- weekly day(s),
- monthly day,
- active/inactive,
- send-empty-report vs skip-empty-report (default: skip).

A single central scheduler should evaluate due rules. Do **not** create one database cron job per rule.

### 3.6 Condition builder

Conditions must use dropdowns and typed values, not SQL.

Initial operators:

- `=`
- `!=`
- `IN`
- `NOT IN`
- `>`
- `>=`
- `<`
- `<=`
- `BETWEEN`
- `IS EMPTY`
- `IS NOT EMPTY`

Compound conditions must initially support a safe, understandable AND model. OR/grouped expression support should be added only if a real report requires it.

Example PO11 condition:

`Planning Status IN (CRITICAL, REPLENISH)`

### 3.7 Match behavior

Two modes:

#### CURRENT_MATCHING
At every due run, all rows currently matching the rule are included.

#### NEWLY_MATCHED
Only rows that newly enter the matching condition are included. A row remaining in the same matching state must not repeatedly alert. If it later leaves the condition and re-enters, it may alert again.

State tracking must use stable row identity supplied by the page adapter.

### 3.8 Preview

Preview must execute the same backend dataset + condition + selected-column pipeline used by a real run, but must not enqueue/send a real message unless the user explicitly chooses **Send Test**.

---

## 4. PO11 Pilot Contract

### 4.1 Scope

PO11 is the first report adapter.

Initial production business scope is CMP003 and CMP006. The generic framework must not hard-code those company codes; company access/configuration stays data/ACL driven.

### 4.2 PO11 decision grain

Default email output should mirror the procurement decision grain of PO11:

- standalone material => one decision row,
- planning item group => one group decision row.

Group-member detail can be an optional dataset/expansion later; it should not be forced into the default alert mail.

### 4.3 Candidate PO11 fields

The final manifest must be verified against the actual backend adapter before implementation, but expected fields include:

- Planning Status
- Item Type (Standalone / Group)
- Material Code
- Material Name
- Group Name
- Source SLOC Group
- Monthly Requirement Qty
- Available Stock Qty
- Safety Stock Qty
- Replenishment Stock Qty
- Shortfall Qty (if defined by the adapter)
- TRN Stock Qty
- Gate Entry Stock Qty
- QA Stock Qty
- Safety Days
- Processing Days
- Lead Time Days
- UOM

Only fields that the PO11 adapter can authoritatively and safely expose may be registered.

### 4.4 Default pilot rule example

CMP003:

- Channel: Email
- Condition: `Planning Status IN (CRITICAL, REPLENISH)`
- Frequency: Daily
- Time: user-configurable
- Empty result: Skip
- Match mode: CURRENT_MATCHING initially; NEWLY_MATCHED must also be supported by the framework before final rollout if included in the release scope.

CMP006 uses an independent rule and independent recipients/schedule.

---

## 5. Proposed Data Model

Final names may be adjusted to match repository/database conventions after discovery, but the logical model is locked.

### 5.1 `erp_communication.page_registry`

Technical page/channel allowlist plus runtime SA enablement.

Key concepts:

- page key / tx code / resource code
- title / route
- active
- `supports_email`
- `email_enabled`
- `supports_whatsapp`
- `whatsapp_enabled`
- audit columns

`supports_*` is a technical capability; `*_enabled` is an SA runtime switch. They must not be conflated.

### 5.2 `erp_communication.automation_rule`

One configurable automation rule for one page/company/channel.

Concepts:

- page registry reference
- company
- channel
- rule name
- active
- subject template
- schedule configuration
- timezone
- empty-result behavior
- match mode
- last/next run metadata where required
- audit columns

### 5.3 `erp_communication.automation_recipient`

- rule
- recipient type (`TO`, `CC`, `BCC`)
- email address
- display name (optional)
- active
- audit columns

### 5.4 Dataset / column selection

Store selected dataset(s) and selected manifest field keys/order. Persist **manifest keys**, not raw database column names.

### 5.5 Conditions

Persist:

- rule
- manifest field key
- operator
- typed value payload
- order

Backend validation must ensure every stored field/operator pair is allowed by the current manifest.

### 5.6 Match-state tracking

Needed for `NEWLY_MATCHED` mode:

- rule
- stable row key
- prior match state / fingerprint
- transition timestamps

### 5.7 Delivery outbox / history

A delivery job should have an idempotency key and lifecycle such as:

- `PENDING`
- `PROCESSING`
- `SENT`
- `FAILED`
- `SKIPPED`
- `DEAD`

Attempts/provider responses should be auditable without storing provider secrets.

---

## 6. End-to-End Runtime Flow

```text
SA enables Email for PO11
        ↓
PO11 Automation Settings becomes available
        ↓
Authorized user saves company-specific rule
        ↓
Central scheduler identifies due rule
        ↓
Page report adapter loads server-authoritative dataset
        ↓
Communication engine validates/apply conditions
        ↓
No rows? ──→ SKIPPED (when skip-empty enabled)
        ↓ rows found
Selected datasets/columns/order applied
        ↓
HTML/text payload rendered
        ↓
Idempotent delivery job created
        ↓
Queue worker
        ↓
MSG91 Email Provider Adapter
        ↓
SENT / FAILED / retry / DEAD
        ↓
History + audit visible in ERP
```

---

## 7. Implementation Phases and Sequence

### Phase 1 — Communication Foundation

**Goal:** build the safe technical foundation only. No real email sending and no page drawer yet.

Deliver:

1. Read/align with `CLAUDE.md`, ACL/menu/company-scope conventions, migration rules, and current dev architecture.
2. Create the `erp_communication` foundation schema and page registry model.
3. Separate technical capability (`supports_email`) from runtime enablement (`email_enabled`).
4. Register PO11 as an Email-capable page, initially disabled unless business owner explicitly directs otherwise during implementation.
5. Add backend read contract/service for registry state that later SA UI and page button logic can consume.
6. Add validation/constants for supported channel values (`EMAIL`, future `WHATSAPP`) without implementing WhatsApp delivery.
7. Add required indexes, constraints, grants/RLS/security pattern consistent with the repo.
8. Add tests/guard verification.
9. Do not add MSG91, scheduler, automation rules, recipients, or PO11 UI in this phase.

**Exit condition:** the system has a secure page communication registry and can answer, server-side, whether a known page/channel is supported/enabled.

### Phase 2 — SA Central Communication Control

Deliver the SA page/API to view supported pages and toggle runtime channel enablement. SA may change `email_enabled`; SA may not turn unsupported channels into supported channels.

### Phase 3 — Report Manifest Framework

Create the typed developer-controlled manifest/adapter contract that declares safe datasets, safe fields, operators, row identity, formatting metadata, and page report loader.

### Phase 4 — PO11 Report Adapter

Implement the first adapter by reusing PO11 server-authoritative planning logic. Normalize standalone/group decision rows and expose only approved fields.

### Phase 5 — Page Button + Automation Drawer Shell

When central registry enables Email for PO11 and the user has permission, show the automation action. Build the center drawer shell and company-aware rule context.

### Phase 6 — Rule Configuration

Implement rule CRUD, recipients, subject template, dataset selection, column selection/order, schedule settings, and activation.

### Phase 7 — Condition Builder + Preview

Implement typed condition validation/execution and real-data preview. No arbitrary SQL.

### Phase 8 — Scheduler

Implement one central due-rule evaluator. ERP time/frequency changes must not require deployment or one-cron-per-rule changes.

### Phase 9 — Outbox / Queue

Create idempotent delivery jobs and retry lifecycle. Business transactions remain isolated.

### Phase 10 — MSG91 Email Adapter

Add server-side MSG91 integration, environment-secret configuration, provider response/error mapping, and test send.

### Phase 11 — CURRENT vs NEWLY_MATCHED

Add stable row-state tracking and transition behavior for event-style alerts.

### Phase 12 — Delivery History + Audit + Operations

Expose delivery status/history, attempts, last run, last error, configuration audit, and safe manual retry where appropriate.

### Phase 13 — Security/UAT/Production Pilot

Test CMP003 and CMP006 end-to-end including no-row skip, provider failure, duplicate scheduler execution, company isolation, ACL, SA disable, and retries. Roll out Email only after UAT.

### Phase 14 — Reusable Rollout to More Pages

New pages should require primarily:

1. page technical registration,
2. report manifest,
3. adapter,
4. page action integration if not fully generic.

Do not rebuild scheduler/provider/queue per page.

### Future Phase — WhatsApp

Add a WhatsApp provider adapter and channel-specific rendering/rules only after Email is stable. Reuse central enablement, scheduling, conditions, datasets, recipients (where applicable), audit, and queue.

---

## 8. MSG91 Integration Policy

MSG91 is selected for the initial Email delivery implementation.

Rules:

- integration is backend-only,
- provider auth key is an environment secret,
- provider key is never stored in page/rule configuration,
- provider does not receive Supabase/ERP credentials,
- provider receives only the minimum final message payload required to deliver the email,
- MSG91 outage cannot block procurement/ERP transactions,
- provider-specific message IDs/errors may be stored for delivery audit,
- code must use a provider adapter so MSG91 can be replaced later.

Provider/account verification and exact current MSG91 API contract must be checked again at the phase where the adapter is implemented.

---

## 9. Scheduler Policy

PACE production currently has PostgreSQL scheduling capability available, but the exact execution path must be chosen during scheduler implementation after repo/server review.

Locked behavior:

- one central scheduler/evaluator,
- no cron-per-user-rule model,
- configurable time/frequency stored in ERP,
- timezone-aware,
- idempotent execution,
- scheduler overlap must not duplicate deliveries,
- execution engine must be safe if a prior run is delayed.

---

## 10. Security and ACL Requirements

1. SA central-control mutation requires Super Admin-authorized capability, following existing PACE ACL conventions; never hard-code a role name in frontend business logic.
2. Page automation configuration must respect page resource/action permissions and company scope.
3. A user must not configure a rule for a company outside their allowed transactional scope.
4. Cross-company delivery must never mix rows from two companies unless a future report explicitly declares a safe multi-company contract.
5. Secrets never enter the browser.
6. Only manifest-declared fields/operators can be persisted/executed.
7. Email addresses must be normalized/validated.
8. HTML values must be safely encoded.
9. Subject/template tokens are from an allowlist.
10. Every configuration mutation records actor/time.
11. Every delivery has an idempotency boundary.
12. Provider error bodies/logs must not leak secrets.

---

## 11. PO11 UAT Matrix

At minimum verify:

1. SA Email OFF => automation action unavailable/non-usable.
2. SA Email ON => authorized PO11 user can open settings.
3. CMP003 rule cannot accidentally send CMP006 data.
4. CMP006 rule cannot accidentally send CMP003 data.
5. `CRITICAL` row matches configured condition.
6. `REPLENISH` row matches configured condition.
7. `NORMAL` row excluded when not requested.
8. No matching rows => no email when skip-empty is enabled.
9. Selected columns only appear in preview/email.
10. Column order matches configuration.
11. Group decision grain matches PO11 decision grain.
12. Recipient TO/CC/BCC mapping is correct.
13. Daily schedule fires once for a due window.
14. Weekly schedule fires only on selected days.
15. Duplicate scheduler invocation does not duplicate the same logical delivery.
16. MSG91 failure => delivery job fails/retries; PO11 data remains unaffected.
17. Manual test does not corrupt scheduled-run state.
18. CURRENT_MATCHING repeats while still matching.
19. NEWLY_MATCHED sends only on transition/re-entry.
20. Audit identifies who changed rule/recipient/schedule.

---

## 12. Non-Goals for Initial Email Rollout

Do not include unless separately approved:

- WhatsApp live sending,
- push notifications,
- in-app notification center,
- arbitrary SQL report builder,
- arbitrary database table/column selection,
- attachment generation/PDF export,
- dynamic role/department recipients,
- user-written executable template code,
- marketing campaign tooling,
- provider-specific logic embedded into PO11.

---

## 13. Delivery Milestones

### Milestone A — Foundation
Phase 1 complete and verified.

### Milestone B — Control + PO11 Configuration
SA control, manifest, PO11 adapter, drawer, conditions, preview.

### Milestone C — Automation + Delivery
Scheduler, queue, MSG91, retries, match-state behavior, history.

### Milestone D — PO11 Production Pilot
CMP003 + CMP006 UAT and controlled go-live.

### Milestone E — Generic Expansion
Add more ERP pages through manifest/adapter registration without rebuilding the engine.

---

## 14. Implementation Gate

**Do not implement phases automatically from this document.**

Each phase must have a dedicated Codex task brief and explicit business-owner approval before implementation. The first implementation brief is:

`docs/CODEX-COMMUNICATION-AUTOMATION-PHASE-1-FOUNDATION-TASK-BRIEF.md`

Phase 1 must not begin until the business owner explicitly says **Yes**.
