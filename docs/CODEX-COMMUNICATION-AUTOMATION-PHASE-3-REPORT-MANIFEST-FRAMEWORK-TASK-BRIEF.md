# CODEX TASK — Communication Automation Phase 3: Report Manifest Framework

**Status:** READY FOR IMPLEMENTATION AFTER BUSINESS OWNER APPROVAL  
**Date:** 2026-09-14  
**Branch:** `dev`  
**Depends on:** Phase 1 + Phase 2 COMPLETE on Dev  
**Master plan:** `docs/PACE-ERP-COMMUNICATION-AUTOMATION-MASTER-PLAN.md`

---

## 1. Mandatory Read-First

Before changing code, read completely:

1. `CLAUDE.md`
2. `docs/PACE-ERP-COMMUNICATION-AUTOMATION-MASTER-PLAN.md`
3. `docs/CODEX-COMMUNICATION-AUTOMATION-PHASE-1-FOUNDATION-TASK-BRIEF.md`
4. `docs/CODEX-COMMUNICATION-AUTOMATION-PHASE-2-SA-ENROLLMENT-UI-TASK-BRIEF.md`
5. `docs/CODEX-COMMUNICATION-AUTOMATION-PHASE-2-UX-COMPONENT-GUIDELINES.md`
6. This Phase-3 task brief
7. Current communication implementation on latest `dev`, especially:
   - Communication Surface Manifest
   - enrollment handlers/routes
   - Phase-2 SA/GA control UI
8. Current PO11 implementation/docs only to understand authoritative planning concepts and field semantics. Do NOT implement the PO11 row adapter in this phase.

Inspect current repository conventions for typed registries/manifests, error types, backend tests/guards, and code-owned allowlists before choosing file names/locations.

---

# 2. Phase 3 Goal

Build a reusable, server-authoritative **Report Manifest Framework** that defines:

> Which communication datasets exist, which fields are safe to expose, how those fields are typed/formatted, and which condition operators are allowed.

Phase 1/2 answered **WHERE** communication automation may be configured.

Phase 3 answers **WHAT DATA SHAPE IS ALLOWED**.

Phase 3 must NOT fetch real business report rows.

Actual PO11 authoritative data loading is Phase 4.

---

# 3. Core Safety Rule

The Communication Automation system must NEVER allow a user or frontend to provide:

- raw SQL,
- schema name,
- table name,
- arbitrary DB column name,
- arbitrary SELECT expression,
- arbitrary filter expression,
- arbitrary formatter function name.

Users and future UI may reference only stable developer-owned manifest keys.

The manifest is code-owned and server-authoritative.

Frontend metadata is never the security authority.

---

# 4. Required Conceptual Model

The framework needs three logical levels:

## 4.1 Report Registry / Page Binding

A communication-capable page may expose zero or more report datasets.

The framework must be able to resolve datasets using stable PACE page identity plus, where appropriate, `surface_key`.

Conceptually:

```text
Page: PO11 / PROC_PLANNING_VIEW
Surface: planning_dashboard
Datasets:
- planning_alert
```

A dataset may be available on more than one valid surface only if explicitly declared by code.

Do not infer dataset availability from labels/routes at runtime.

## 4.2 Dataset Manifest

Each dataset has stable metadata such as:

- `dataset_key`
- friendly `label`
- optional description
- supported page identity
- supported surface key(s)
- stable row identity definition/contract
- field list
- default display field keys
- whether empty output is meaningful if useful as metadata

No SQL and no DB table/column metadata exposed to consumers.

## 4.3 Field Manifest

Each field has stable metadata such as:

- `field_key`
- friendly label
- semantic data type
- `displayable`
- `conditionable`
- allowed condition operators
- formatting metadata or format kind
- optional enum choices when truly stable/server-owned
- optional default display/order metadata
- null handling metadata only if needed

The exact TypeScript shape may follow repository conventions, but these safety concepts are required.

---

# 5. Stable Keys

Stable keys are contracts.

Friendly labels may change without breaking saved future automation rules.

Example:

```text
field_key: available_stock_qty
label today: Available Stock
label later: Usable Stock
```

The stable key remains unchanged.

Same principle applies to:

- dataset keys
- surface keys
- enum values where they are persisted as rule values.

---

# 6. Semantic Data Types

Define a small explicit type system suitable for future condition builder and rendering.

At minimum support the concepts needed for the pilot and future reuse:

- `STRING`
- `NUMBER`
- `INTEGER` if materially distinct from NUMBER in current conventions
- `BOOLEAN`
- `DATE`
- `DATETIME`
- `ENUM`

Do not create dozens of types.

If repository conventions support a cleaner minimal set, use them while preserving typed validation.

---

# 7. Condition Operators

Define one canonical operator allowlist/enum for the communication report framework.

Initial allowed operators:

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

Use stable internal operator keys if existing project conventions prefer identifiers such as `EQ`, `NE`, etc.; if so, friendly labels can map to the business symbols above.

Do not accept arbitrary operator strings.

---

# 8. Operator Compatibility by Type

The framework must support validation that an operator is legal for a field's type.

Example principles:

### STRING
Typically allow:
- `=`
- `!=`
- `IN`
- `NOT IN`
- `IS EMPTY`
- `IS NOT EMPTY`

### ENUM
Typically allow:
- `=`
- `!=`
- `IN`
- `NOT IN`
- `IS EMPTY`
- `IS NOT EMPTY`

### NUMBER / INTEGER
Typically allow:
- `=`
- `!=`
- `>`
- `>=`
- `<`
- `<=`
- `BETWEEN`
- `IN`
- `NOT IN`
- `IS EMPTY`
- `IS NOT EMPTY`

### DATE / DATETIME
Typically allow comparison/BETWEEN and empty operators as appropriate.

### BOOLEAN
Typically allow equality/inequality only unless repository conventions justify otherwise.

Dataset fields may further restrict the type-level operator set.

A field may never declare an operator that is invalid for its semantic type.

---

# 9. Formatting Contract

Manifest metadata should express safe formatting intent, not executable user code.

Examples of safe format kinds:

- plain text
- quantity / decimal
- integer
- date
- datetime
- enum label
- boolean

If UOM is a separate field, do not bake business-specific UOM lookups into this generic framework.

Do not expose arbitrary JavaScript/SQL formatter expressions.

---

# 10. Stable Row Identity Contract

Future `NEWLY_MATCHED` behavior requires stable row identity.

Phase 3 must therefore make row identity part of the dataset contract, without implementing match tracking yet.

The manifest must be able to say which safe field key(s) contribute to the stable business row identity, or expose an equivalent code-owned identity strategy.

Validation must ensure identity references only fields declared by that dataset.

Do NOT implement `NEWLY_MATCHED` state tracking in this phase.

---

# 11. Required Validation Helpers

Provide reusable server-side helpers that fail closed.

At minimum, the framework must be able to validate/resolve:

1. page/report manifest exists,
2. requested `surface_key` is valid for that page and report binding,
3. requested `dataset_key` exists,
4. requested field key exists in the dataset,
5. field is displayable before it can be selected as an output column,
6. field is conditionable before it can be used in a condition,
7. requested operator is globally known,
8. requested operator is allowed for the field,
9. enum value is valid when the manifest owns a fixed enum set,
10. row-identity field references are valid,
11. duplicate field keys/dataset keys are rejected at manifest-definition validation time.

Use explicit typed/domain errors or repo-native equivalents.

Unknown dataset/field/operator must fail closed.

---

# 12. Manifest Definition Validation

Do not rely only on runtime request validation.

Add a way to validate the developer-authored manifest itself.

Catch errors such as:

- duplicate dataset key
- duplicate field key
- empty stable key
- display defaults referencing missing/non-displayable field
- identity fields referencing missing fields
- conditionable field with no valid operators when operators are required
- field operator incompatible with field type
- dataset bound to unknown Communication Surface Manifest surface
- channel/page binding inconsistency if applicable

Prefer validation that can run in automated tests/guards and fails loudly during development.

---

# 13. Relationship to Communication Surface Manifest

Do not create a second independent page/surface truth.

The Report Manifest Framework must integrate with the existing developer-owned Communication Surface Manifest.

If a dataset is declared for:

`PO11 > planning_dashboard`

then `planning_dashboard` must already be a valid technical communication surface for PO11.

Unknown surface bindings must fail manifest validation.

Enrollment state is still separate:

- Surface Manifest = technically valid surface
- Page/surface enrollment = SA/GA enabled location
- Report Manifest = technically safe datasets/fields

Do not merge these concepts into one table/config object.

---

# 14. PO11 Pilot Metadata Contract — Phase 3 Only

To prove the generic framework works, define the initial **PO11 report metadata contract** without implementing real row loading.

The first dataset should conceptually represent the procurement planning decision/alert report.

Recommended stable dataset key:

`planning_alert`

Use a different key only if current repo conventions strongly justify it; document the final key.

Friendly label could be:

`Planning Alert`

## Candidate safe fields

Re-read current PO11 code/docs and define metadata only for fields that are genuinely authoritative and meaningful.

Expected candidates include:

- planning status
- item type
- material code
- material name
- group name
- source SLOC group
- monthly requirement quantity
- available stock quantity
- safety stock quantity
- replenishment stock quantity
- shortfall quantity only if authoritatively defined in current PO11 logic
- TRN stock quantity
- Gate Entry stock quantity
- QA stock quantity
- safety days
- processing days
- lead time days
- UOM

Do not invent fields that current PO11 cannot authoritatively produce.

Do not fetch those values in Phase 3.

## Planning Status

Planning Status is expected to be an ENUM whose stable business values reuse PO11 authoritative meanings:

- `CRITICAL`
- `REPLENISH`
- `NORMAL`

Do not reimplement threshold/status calculations in the Report Manifest.

The manifest only declares the field metadata/allowed values.

Phase 4 will load rows from the existing authoritative PO11 logic.

## Row grain

Document the dataset's intended Phase-4 grain:

- one planning item group = one decision row
- one standalone material = one decision row

Do not implement grouping/calculation logic in Phase 3.

---

# 15. Surface Binding for PO11

Re-read the current PO11 surface manifest before binding the dataset.

Do not assume all PO11 surfaces should expose the planning report dataset.

Bind `planning_alert` only to surfaces where it makes business/UX sense for future automation configuration.

Likely candidates are planning dashboard/report-view surfaces, but Codex must inspect the actual current page behavior and document the final binding.

Do not bind setup/history surfaces merely because they exist.

---

# 16. Adapter Separation — Critical

Design the framework so Phase 4 can attach an adapter/loader to a dataset without changing the safe manifest contract.

Conceptually there should be separation like:

```text
Report Manifest
= metadata + safety contract

Report Adapter
= authoritative row loader / normalizer
```

The exact interface can differ.

Phase 3 may define an adapter interface/type if useful for clean architecture, but MUST NOT implement PO11 `loadRows()` or query business tables.

Do not create a fake adapter returning sample rows in production code.

Tests may use in-memory fixture manifests/rows only where needed to validate generic helper behavior.

---

# 17. Backend Read/Discovery API

A new HTTP endpoint is NOT automatically required in Phase 3.

Prefer building the server-authoritative framework and validators first.

If existing architecture makes a read-only manifest discovery endpoint clearly necessary now, Codex must justify it in the final report and ensure:

- it exposes metadata only, never business rows,
- it does not expose DB schema/table/column internals,
- authorization is safe,
- it does not prematurely implement Phase-5/6 UI.

Do not create frontend UI solely to consume the manifest in Phase 3.

---

# 18. Database / Migration Policy

The Report Manifest is code-owned.

Therefore Phase 3 is expected to require **no database migration**.

Do NOT create tables for datasets/fields/operators just to store developer-owned manifest metadata.

Do NOT make report field definitions SA-editable.

Only add a migration if a genuinely unavoidable repo-level technical need is discovered; stop and explain before expanding scope.

Production must not be touched.

---

# 19. Tests Required

At minimum cover the generic framework with automated tests/guards appropriate to the repo.

## Manifest definition tests

1. valid manifest passes
2. duplicate dataset key rejects
3. duplicate field key rejects
4. empty key rejects
5. invalid surface binding rejects
6. missing identity field rejects
7. missing default display field rejects
8. default field that is not displayable rejects
9. incompatible field/operator definition rejects

## Runtime resolution/validation tests

10. valid page + surface + dataset resolves
11. unknown dataset rejects
12. unknown field rejects
13. display selection on non-displayable field rejects
14. condition on non-conditionable field rejects
15. unknown operator rejects
16. type-incompatible operator rejects
17. field-specific disallowed operator rejects
18. valid enum value passes
19. invalid enum value rejects where enum values are fixed
20. duplicate requested output fields reject or normalize according to one explicitly documented contract

## PO11 metadata tests

21. PO11 manifest is registered
22. chosen dataset key is stable and unique
23. planning-status metadata contains only authoritative stable values
24. no raw table/schema/SQL metadata is present in public manifest shape
25. all PO11 dataset surface bindings exist in the Communication Surface Manifest
26. row identity contract references declared fields only

---

# 20. Security Verification

Confirm:

- no raw SQL support
- no arbitrary table selection
- no arbitrary column selection
- no frontend-owned manifest authority
- no direct DB field names required in future user payloads
- unknown keys fail closed
- adapter/data loading remains separate
- no provider secrets
- no actual business rows exposed by Phase 3

---

# 21. Strict Out of Scope

Do NOT implement:

- PO11 real report row adapter/loader
- PO11 SQL/business queries for communication
- Automation Settings button on PO11
- Automation Settings drawer
- rule persistence
- recipients
- TO/CC/BCC
- subject templates
- schedules
- condition-builder UI
- condition execution against live rows
- preview
- test email
- scheduler
- cron/pg_cron
- queue/outbox
- retries/history
- MSG91
- SMTP
- email sending
- `CURRENT_MATCHING` execution
- `NEWLY_MATCHED` state tracking
- WhatsApp
- Production changes

Do not start Phase 4 automatically.

---

# 22. Expected Files / Placement

Codex must inspect the repo and choose the most natural server-side location.

Conceptually, implementation may include files for:

- report manifest types/constants
- report manifest registry
- validators/resolvers
- PO11 report metadata manifest
- tests/guards

Do not force these exact filenames if repository conventions indicate better names.

Keep generic framework code separate from PO11-specific metadata.

---

# 23. Local → Dev Workflow

Follow exactly:

1. Start from latest `dev`.
2. Check working tree; preserve unrelated local work.
3. Implement Phase 3 locally.
4. Run focused tests/type checks/guards.
5. Confirm no migration is needed; do not touch Dev Supabase if none is needed.
6. Review diff for Phase-4+ scope leakage.
7. Commit.
8. Push to `dev`.
9. Verify Render Dev deployment if backend/runtime code changed.
10. Verify Vercel status only if frontend/shared build is affected.
11. STOP.

Do NOT merge to `main`.
Do NOT touch Production/Main Supabase.
Do NOT begin Phase 4.

---

# 24. Checks / Guards

Run all relevant repository checks, including as applicable:

- Deno/type check for touched backend code
- backend/unit tests
- route ACL guard only if routes are touched
- migration integrity only if an unexpected migration is added
- hardcoded-role guard
- resource/domain guards
- frontend build only if frontend/shared code was actually touched
- any manifest-specific validation/test command introduced for this framework

Introduce zero new failures.

Document pre-existing failures separately.

---

# 25. Acceptance Criteria

Phase 3 is COMPLETE only when:

1. there is one generic code-owned Report Manifest contract,
2. datasets have stable keys and safe metadata,
3. fields have stable keys, labels, semantic types, display/condition permissions and allowed operators,
4. operator compatibility is centrally validated,
5. stable row identity is part of the dataset contract,
6. manifests are validated against the existing Communication Surface Manifest,
7. unknown dataset/field/operator fails closed,
8. PO11 has a real metadata-only pilot dataset contract,
9. PO11 planning-status enum uses authoritative stable values only,
10. no PO11 business rows are loaded,
11. no arbitrary SQL/table/column mechanism exists,
12. no database migration is introduced unless explicitly justified,
13. no Phase-4+ feature is implemented,
14. Dev code/deployment is healthy,
15. Production remains untouched.

---

# 26. Final Report Required from Codex

When complete, report exactly:

## 1. Status
DONE / PARTIAL / BLOCKED

## 2. Files changed

## 3. Generic Report Manifest contract
Describe:
- dataset contract
- field contract
- semantic types
- operator model
- row identity contract

## 4. Registry / resolution model
Explain how page + surface + dataset resolution works.

## 5. Validation behavior
List how unknown/invalid dataset, field, operator, enum value and surface binding fail closed.

## 6. PO11 metadata contract
Report:
- dataset key + label
- bound surface keys
- field keys/labels/types
- planning-status enum values
- row identity definition
- intended future Phase-4 row grain

## 7. Adapter separation
Confirm no PO11 real row loader/query was implemented.

## 8. Database
Explicitly state whether a migration was required.
Expected: `No Phase-3 database migration required.`

## 9. Tests/checks
List exact commands and results.

## 10. Dev commit SHA

## 11. Dev push status

## 12. Dev deployment status
Render/Vercel as applicable.

## 13. Production confirmation
Explicitly confirm Main/Production was NOT touched.

## 14. Scope confirmation
Explicitly confirm NOT implemented:
- PO11 live adapter
- Automation Settings button/drawer
- recipients/rules/schedules
- live condition execution/preview
- scheduler/outbox
- MSG91/email sending
- WhatsApp

Then STOP. Do not begin Phase 4.
