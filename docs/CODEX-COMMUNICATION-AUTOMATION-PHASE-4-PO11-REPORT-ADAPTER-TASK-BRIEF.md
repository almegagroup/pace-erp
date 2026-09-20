# PACE ERP — Communication Automation Phase 4
## PO11 Report Adapter — Codex Task Brief

**Status:** READY FOR IMPLEMENTATION  
**Branch:** `dev` only  
**Depends on:** Phase 1, Phase 2, Phase 3 complete  
**Pilot page:** PO11 — Procurement Planning  
**Dataset:** `planning_alert`  

---

## 1. Goal

Implement the first real Communication Report Adapter for PO11.

Phase 3 defined **what** the safe `planning_alert` dataset may expose. Phase 4 must now define **how authoritative PO11 business data is loaded and normalized into those manifest field keys**.

Phase 4 must produce server-owned decision rows at the PO11 dashboard decision grain:

- one Planning Item Group = one decision row,
- one standalone material = one decision row.

This phase is data/adaptor work only. It does not add the Automation Settings button/drawer, rules, schedules, recipients, preview UI, scheduler, queue, MSG91, or email sending.

---

## 2. Mandatory read-first

Before changing code, read current `dev` completely enough to understand the active implementation, especially:

1. `CLAUDE.md`
2. `docs/PACE-ERP-COMMUNICATION-AUTOMATION-MASTER-PLAN.md`
3. `docs/CODEX-COMMUNICATION-AUTOMATION-PHASE-3-REPORT-MANIFEST-FRAMEWORK-TASK-BRIEF.md`
4. `supabase/functions/api/_core/communication/report_manifest/`
5. `supabase/functions/api/_core/procurement/planning.handlers.ts`
6. `frontend/src/pages/dashboard/procurement/planning/ProcurementPlanningPage.jsx`
7. PO11 implementation specs / final gap register relevant to dashboard grouping and stock/status logic.

Re-read current code. Do not implement from an old description alone.

---

## 3. Core architecture lock

Keep these layers separate:

```text
Report Manifest
= safe datasets / fields / operators

Report Adapter
= authoritative business rows mapped to manifest fields

Rule Engine (later)
= selected dataset / fields / conditions / schedule
```

The adapter must never accept raw SQL, table names, column names, or client-owned expressions.

---

## 4. Authoritative PO11 logic — do not duplicate independently

Current PO11 backend already owns important material-row calculations including:

- monthly requirement,
- safety / processing / lead days,
- derived safety stock,
- derived replenishment stock,
- fixed override handling,
- Unrestricted stock less open reservations as usable / available stock,
- TRN stock,
- Gate Entry stock,
- QA stock,
- material status `NORMAL / WARNING / CRITICAL`,
- zero threshold = unconfigured, not shortage.

The Communication adapter must reuse the existing PO11 calculation path.

Do **not** build a second independent implementation of these calculations inside `communication/`.

### Group decision rows

The existing PO11 frontend currently shapes group-total decision rows from the authoritative workspace member rows. Phase 4 must not simply copy that frontend algorithm into an unrelated communication adapter.

Instead, centralize/extract a **server-authoritative reusable PO11 decision-row builder** and have the Communication adapter consume that canonical decision-row result.

If necessary to remove business-logic duplication, refactor PO11's existing data path so the current PO11 dashboard/report and the Communication adapter use the same server-authoritative decision-row semantics. Preserve existing user-visible PO11 behavior.

Do not create a second competing group-total formula.

---

## 5. Read-only adapter requirement

The Communication report adapter is a read/report path.

It MUST NOT create or mutate procurement planning merely because a report is loaded.

Specifically, adapter execution must not:

- call `ensurePlanExists` in a way that creates a new monthly plan,
- auto-create plan lines,
- auto-include materials as a side effect,
- update planning lines,
- close/reopen a month,
- change item groups/SLOC groups,
- write any PO11 business state.

Reuse the existing read-only capability pattern used by PO11/IN03 where appropriate (`loadWorkspaceRows(... ensureAutoIncluded: false)` or an extracted equivalent).

### No plan

If the requested company/month has no existing PO11 plan:

- return an empty adapter result,
- do not create a blank plan.

### CLOSED plan

A CLOSED month is immutable and must never be recalculated from today's stock.

For `planning_alert`, do not silently rebuild a historical alert from current stock.

Initial Phase-4 behavior should be explicit and safe: closed/live-alert requests return no live alert rows (or another clearly typed non-live/empty result if current architecture strongly prefers it). Do not query current stock to reconstruct a closed month.

Document the final behavior and test it.

---

## 6. Adapter context

Define a typed server-owned input/context suitable for future preview and scheduler use.

At minimum it must identify:

- `company_id`
- `plan_month`

Normalize / validate `plan_month` using PO11's canonical month rules rather than inventing a different format.

Do not hard-code CMP003/CMP006.

Do not require a browser to be open.

Do not require a frontend route state.

Future scheduled execution must be able to call the same adapter server-side.

---

## 7. PO11 decision grain

Return only decision rows:

### Standalone material

One row per visible, non-excluded standalone material.

### Planning Item Group

One row per visible Planning Item Group.

Do not emit member detail as separate `planning_alert` decision rows.

Do not include `excluded_from_dashboard = true` material in the alert decision set.

The result grain must match the PO11 dashboard business decision grain, not raw plan-line grain.

---

## 8. Group-total business parity

The canonical group decision row must preserve existing PO11 rules.

Verify current code before implementing, including these known rules:

- if member monthly requirements exist, Group Requirement = sum of member requirements,
- otherwise group-level direct requirement config may supply the group requirement,
- Safety Days = average of members,
- Processing Days = average of members,
- Lead Time Days = average of members,
- derived safety/replenishment use the group requirement + averaged days,
- member fixed Safety overrides aggregate by sum when present,
- member fixed Replenishment overrides aggregate by sum when present,
- effective group Safety/Replenishment use the fixed aggregate when available, otherwise derived aggregate,
- Available Stock = sum of member available/usable stock,
- TRN = sum,
- Gate Entry = sum,
- QA = sum,
- shortage status uses Available/usable stock only,
- TRN / Gate Entry / QA are informational and must not hide a shortage,
- zero Safety/Replenishment threshold is unconfigured, not shortage.

Do not change these business rules in Phase 4.

---

## 9. Planning Status mapping

The Phase-3 manifest exposes:

- `CRITICAL`
- `REPLENISH`
- `NORMAL`

PO11's current internal tone uses:

- `CRITICAL`
- `WARNING`
- `NORMAL`

The adapter may map:

```text
CRITICAL -> CRITICAL
WARNING  -> REPLENISH
NORMAL   -> NORMAL
```

The adapter must not independently recalculate an already-authoritative standalone material status.

For a group row, status must come from the single canonical PO11 group decision calculation, not a communication-specific formula.

---

## 10. `planning_alert` row contract

Map every Phase-3 manifest field to a deterministic value.

Current dataset fields include:

- `planning_status`
- `decision_type`
- `decision_key`
- `material_type`
- `material_code`
- `material_name`
- `group_name`
- `source_sloc_group`
- `monthly_requirement_qty`
- `available_stock_qty`
- `safety_stock_qty`
- `replenishment_stock_qty`
- `trn_stock_qty`
- `gate_entry_stock_qty`
- `qa_stock_qty`
- `safety_days`
- `processing_days`
- `lead_time_days`
- `uom`

Do not add undeclared fields to adapter output without first deliberately updating the manifest contract and tests.

Do not expose raw DB column names/technical payloads.

---

## 11. Decision type

Use exactly the Phase-3 enum values:

- `ITEM_GROUP`
- `STANDALONE_MATERIAL`

Do not invent additional values in Phase 4.

---

## 12. Stable decision identity

Phase 3 defined row identity using:

- `decision_type`
- `decision_key`

`decision_key` must be stable enough for repeated runs and future `NEWLY_MATCHED` tracking.

Recommended semantics:

### Item Group
Use the stable Planning Item Group identity (not group label text).

### Standalone material
Use a deterministic business identity derived from the material + planning/SLOC scope rather than the monthly plan-line UUID, because plan-line rows may be recreated across months.

Do not use:

- array index,
- sort position,
- display label,
- current row number.

Document the exact identity contract.

---

## 13. Material/group identity fields

For a standalone material:

- material fields should contain the material's values,
- `group_name` should be empty/neutral.

For an Item Group decision row:

- `group_name` must contain the group name,
- do not pretend one member is the group's material code/name unless the existing PO11 business contract explicitly defines that.

Use deterministic neutral values for non-applicable display fields (for example empty string) rather than leaking technical IDs into display fields.

For group `material_type` / UOM / SLOC display semantics, preserve current PO11 dashboard behavior where it is clearly defined. If members are heterogeneous and current UI has no authoritative business rule, use a deterministic safe representation and document it; do not silently fabricate one member as authoritative except where current PO11 already does so.

---

## 14. Generic adapter registry

Phase 3 defined `ReportDatasetAdapter` as the future adapter boundary.

Implement a generic code-owned adapter registry/resolver if not already present.

Conceptually it must support:

```text
page + dataset_key -> adapter
```

or an equally safe repository-native contract.

Requirements:

- adapter must correspond to an existing Report Manifest dataset,
- duplicate adapter registration rejected,
- unknown adapter/dataset fails closed,
- no dynamic module path/client-selected implementation,
- no raw DB query definition in registry metadata.

Register PO11 `planning_alert` as the first adapter.

---

## 15. Adapter output validation

Before returning rows to future consumers, validate adapter output against the Phase-3 manifest.

At minimum validate:

- every row is an object,
- only declared manifest field keys are emitted,
- required identity fields exist,
- identity values are deterministic/non-empty where required,
- `planning_status` and `decision_type` use declared enum values,
- numeric fields are finite numbers,
- string fields are strings,
- boolean/date/datetime types follow the generic manifest rules if used later,
- duplicate row identities are rejected,
- malformed rows fail closed.

Prefer a reusable generic row validator rather than PO11-only ad hoc checks.

Do not allow adapter output to bypass the Phase-3 manifest contract.

---

## 16. No HTTP/UI requirement by default

Phase 4 does not require a new public HTTP route or frontend page.

Prefer implementing and testing the server-side adapter directly.

If an HTTP endpoint is genuinely needed for integration verification, it must be:

- read-only,
- authenticated/authorized,
- not a Phase-5 Automation Settings endpoint,
- not a rule API,
- not exposed merely for developer convenience.

Justify any route in the final report.

---

## 17. Authorization and company safety

The adapter is internal server-side infrastructure, but company scope must remain explicit.

Do not allow client-controlled company IDs to bypass existing PACE company/ACL rules in any newly exposed route.

If no route is added, keep the adapter interface server-owned and require an explicit validated company context from its caller.

Do not hard-code role names.

Do not hard-code company codes.

---

## 18. Tests — generic adapter framework

Add focused automated tests for at least:

1. valid adapter registration passes,
2. duplicate adapter registration rejects,
3. adapter for unknown manifest dataset rejects,
4. unknown adapter resolution rejects,
5. output row with undeclared field rejects,
6. output row missing identity rejects,
7. duplicate decision identity rejects,
8. invalid enum output rejects,
9. invalid numeric output rejects,
10. valid output passes.

---

## 19. Tests — PO11 decision rows

Use deterministic fixtures / pure-helper tests to verify:

### Standalone

1. one standalone material -> one decision row,
2. excluded standalone -> not emitted,
3. internal `WARNING` -> manifest `REPLENISH`,
4. stable standalone `decision_key`,
5. TRN/GE/QA present but do not change shortage status.

### Group

6. N members -> one `ITEM_GROUP` decision row,
7. member requirement sum wins when member requirements exist,
8. direct group requirement is used only when member requirement total is zero,
9. Safety/Processing/Lead days average correctly,
10. fixed safety aggregates correctly,
11. fixed replenishment aggregates correctly,
12. available/TRN/GE/QA sums correctly,
13. group status follows canonical PO11 threshold logic,
14. zero thresholds remain NORMAL/unconfigured,
15. stable Item Group decision key,
16. member rows are not emitted as separate alert decision rows.

### Read-only behavior

17. no existing plan -> empty rows and no plan creation,
18. CLOSED plan -> no recalculation from current stock,
19. adapter execution causes zero planning writes / auto-includes.

---

## 20. Parity verification against current PO11

For Dev pilot data (at least CMP003 and CMP006 if available), compare adapter decision rows with the current PO11 dashboard semantics for a representative open month.

Verify at minimum:

- decision row count,
- group vs standalone count,
- planning status,
- monthly requirement,
- available stock,
- safety stock,
- replenishment stock,
- TRN / Gate Entry / QA,
- group totals.

Do not mutate the plan during this verification.

If direct automated parity against the frontend is impractical, verify both against the same canonical backend decision-row builder and document the evidence.

---

## 21. Database policy

A Phase-4 database migration is not expected.

Do not create tables for adapter metadata or output rows.

Do not persist report output in Phase 4.

Do not persist rules.

If an unexpected schema change seems necessary, stop and explain rather than expanding scope automatically.

---

## 22. Strict out of scope

Do NOT implement:

- Automation Settings button,
- Automation Settings drawer,
- rule CRUD,
- recipient CRUD,
- TO/CC/BCC,
- subject template,
- schedule,
- condition-builder UI,
- report preview UI,
- Test Send,
- scheduler,
- pg_cron,
- outbox/queue,
- retry/dead-letter,
- delivery history,
- MSG91,
- SMTP,
- email sending,
- WhatsApp,
- CURRENT_MATCHING execution state,
- NEWLY_MATCHED state tracking,
- Phase 5.

---

## 23. Expected file organization

Inspect repository conventions first, but keep concerns separated conceptually:

```text
communication/report_manifest/
  existing manifest framework
  generic adapter registry / output validation if appropriate

procurement/planning/
  canonical reusable PO11 decision-row shaping helper if appropriate

communication/adapters/
  PO11 planning_alert adapter (or repository-native equivalent)

tests
```

Do not put PO11 business calculations inside a generic communication registry.

Do not create one giant file.

---

## 24. Workflow

Follow PACE workflow exactly:

1. Start from latest `dev`.
2. Check `git status`.
3. Preserve unrelated local work.
4. Implement locally.
5. Run focused tests/type checks/guards.
6. No migration unless genuinely required.
7. If no migration, do not touch Dev Supabase unnecessarily.
8. Review complete diff.
9. Confirm no Phase-5+ leakage.
10. Commit.
11. Push to `dev`.
12. Verify Render Dev deployment for backend changes.
13. Verify Vercel only if frontend files were intentionally changed for PO11 parity/refactor.
14. STOP.

Do not merge to `main`.

Do not touch Production.

---

## 25. Acceptance criteria

Phase 4 is complete only when:

1. `planning_alert` has a registered real adapter.
2. Adapter is read-only.
3. No plan is created by report execution.
4. Closed months are not recalculated using current stock.
5. One group = one decision row.
6. One standalone material = one decision row.
7. Group members are not emitted as separate alert rows.
8. Existing PO11 stock/status calculation path is reused.
9. Group decision logic is canonicalized server-side rather than independently copied into Communication.
10. `WARNING` maps to manifest `REPLENISH`.
11. All Phase-3 manifest fields are mapped deterministically.
12. Stable decision identity exists.
13. Adapter output is validated against manifest.
14. Duplicate row identities fail closed.
15. Dev parity with PO11 is demonstrated.
16. No rule/schedule/email/UI work is added.
17. No migration unless explicitly justified.
18. Render Dev is healthy.
19. Production is untouched.
20. Phase 5 is not started.

---

## 26. Final report required from Codex

Report exactly:

### 1. Status
DONE / PARTIAL / BLOCKED

### 2. Files changed

### 3. Canonical PO11 decision-row architecture
Explain where item calculations and group shaping now live and how duplicate business logic was avoided.

### 4. Adapter contract
- adapter key / dataset key,
- input context,
- output type,
- registry/resolver.

### 5. Read-only behavior
Confirm:
- no plan creation,
- no auto-include,
- no planning writes,
- no closed-month recalc.

### 6. Field mapping
List every `planning_alert` field and its PO11 source/derivation.

### 7. Decision identity
Explain exact `decision_type + decision_key` semantics for:
- Item Group,
- Standalone Material.

### 8. Group parity
Explain requirement/safety/replenishment/stock/status aggregation.

### 9. Output validation
Explain manifest validation, enum/type validation, and duplicate identity protection.

### 10. Tests
List exact commands and results.

### 11. Dev parity evidence
CMP003/CMP006 or equivalent representative Dev verification.

### 12. Database
Expected: `No Phase-4 database migration required.`

### 13. Dev commit SHA

### 14. Push status

### 15. Render Dev deployment
Commit + status.

### 16. Vercel
Only if frontend changed.

### 17. Production confirmation
Confirm main/Production untouched.

### 18. Scope confirmation
Explicitly confirm NOT implemented:
- Phase-5 Automation Settings button/drawer,
- rules,
- recipients,
- schedules,
- preview UI,
- scheduler,
- queue,
- MSG91,
- email sending,
- WhatsApp.

Then STOP.

Do not begin Phase 5.
