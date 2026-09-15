# PACE ERP — Communication Automation Phase 6
## Rule Configuration — Persistence, Recipients, Subject, Schedule, Dataset, Columns, Activation

**Status:** READY FOR IMPLEMENTATION  
**Branch:** `dev` only  
**Depends on:** Phases 1–5 complete  
**Pilot page:** PO11 — Procurement Planning  
**Initial channel:** EMAIL only  

---

## 1. Goal

Phase 6 turns the Phase-5 `Automation Settings` shell into a real configuration surface and introduces the durable rule model.

Phase 6 must support:

- multiple rules per company/page/surface,
- rule name and lifecycle,
- Email channel,
- TO / CC / BCC recipients,
- safe subject template,
- schedule configuration,
- safe Report Manifest dataset selection,
- safe display-column selection and ordering,
- save draft / activate / deactivate,
- optimistic concurrency,
- audit fields.

Phase 6 does **not** implement conditions, preview, scheduler execution, queue/outbox, provider delivery, match-state tracking, or email sending.

---

## 2. Mandatory read-first

Before changing code, read current latest `dev` and at minimum:

1. `CLAUDE.md`
2. `docs/PACE-ERP-COMMUNICATION-AUTOMATION-MASTER-PLAN.md`
3. Phase 1–5 Communication task briefs
4. current Phase-5 completion implementation (`7bc8490d71cf5dae1437b4a9b75792a87d0ea14b` or later latest `dev`)
5. `supabase/functions/api/_core/communication/surface_manifest.ts`
6. `supabase/functions/api/_core/communication/runtime_visibility.handlers.ts`
7. `supabase/functions/api/_core/communication/report_manifest/`
8. `supabase/functions/api/_core/communication/report_adapters/` or current adapter location
9. current communication routes / route ACL registry
10. Phase-1/2 Communication migrations, including backend-only policies and atomic enrollment save pattern
11. `frontend/src/components/communication/AutomationSettingsDrawer.jsx`
12. `frontend/src/communication/`
13. PO11 communication-surface mapping
14. repository-native dense form/list components, toast/confirm utilities and current API/query patterns.

Do not implement from this brief alone. Re-read current code and preserve repository conventions.

---

## 3. Architectural boundary

Keep these concerns separate:

```text
SA Enrollment
= WHERE Automation Settings may exist

Report Manifest
= WHICH safe datasets/fields exist

Report Adapter
= HOW authoritative rows are loaded

Automation Rule (Phase 6)
= saved user configuration selecting safe manifest keys

Condition Builder (Phase 7)
= WHICH rows match

Scheduler / Delivery (Phase 8+)
= WHEN and HOW rules execute
```

Phase 6 must never accept or persist:

- raw SQL,
- schema names,
- table names,
- raw DB column names,
- SELECT clauses,
- WHERE expressions,
- formatter code,
- arbitrary template code.

Only server-owned stable keys from manifests may be persisted.

---

## 4. Phase-6 authorization refinement — configuration requires EDIT

Phase 5 intentionally used the underlying page's `VIEW` permission only to prove runtime visibility safely before rule management existed.

Phase 6 introduces sensitive writable configuration: recipient email addresses, subject templates, schedules and activation.

Therefore the `Automation Settings` action and all Phase-6 configuration APIs must now require canonical page **EDIT** permission in the page-selected company.

For PO11:

```text
company membership/scope
+
PROC_PLANNING_VIEW : EDIT
```

Requirements:

- use `assertCompanyScope(...)`,
- use canonical company/resource ACL helpers such as `canMaintainCompanyResource(..., "EDIT")`,
- no hard-coded role list,
- SA/GA continue through canonical admin behavior (`context.isAdmin`),
- VIEW-only PO11 users must not receive rule configuration metadata or recipient addresses,
- cross-company page selector context must be evaluated against the target company, not merely the session-selected company.

Update Phase-5 runtime action visibility accordingly so the button is shown only to users who may configure rules.

Non-company-scoped manifests must remain fail-closed until a canonical global EDIT resolver is deliberately implemented.

---

## 5. Rule ownership model

Automation rules are shared **company/page/surface configuration**, not private user preferences.

An authorized EDIT user for that company/page may view and maintain the rules on that surface.

Do not make rules visible only to their creator.

Persist `created_by` / `last_updated_by` for audit, but do not use creator ownership as authorization.

---

## 6. Multiple rules

Allow multiple rules for the same:

- company,
- page,
- surface,
- EMAIL channel.

Each rule requires a human-readable `rule_name`.

Rule names should be unique case-insensitively within the same company + surface + channel scope.

Examples:

- `Daily Critical Stock Alert`
- `Monday Procurement Review`
- `Manual Planning Report`

Do not assume one rule per surface.

---

## 7. Rule lifecycle

Use an explicit lifecycle rather than a misleading single checkbox.

Recommended stable statuses:

- `DRAFT`
- `ACTIVE`
- `INACTIVE`

Semantics:

### DRAFT
Saved but not active.

### ACTIVE
Configuration has passed all Phase-6 activation validation and is eligible for later execution phases.

### INACTIVE
Previously configured/paused rule. It remains stored and auditable.

Do not physically delete rules in Phase 6.

De-enrolling a page/surface or turning Email off must make runtime configuration unavailable and later execution ineligible, but must not delete the rule.

Do not silently rewrite all rule statuses when SA/GA enrollment changes.

---

## 8. Logical database model

Create Phase-6 persistence inside existing `erp_communication` using repository conventions.

A schema migration **is expected in Phase 6**.

Use `supabase migration new ...`; do not invent an arbitrary migration filename manually.

### 8.1 `automation_rule`

Conceptual fields:

- `id` uuid PK
- canonical target `company_id`
- reference to the existing selected communication surface/enrollment identity
- `channel` (`EMAIL` only in Phase 6)
- `rule_name`
- `status` (`DRAFT` / `ACTIVE` / `INACTIVE`)
- `dataset_key`
- `subject_template`
- `schedule_kind`
- `schedule_time`
- `schedule_timezone`
- weekly-day configuration
- monthly-day configuration
- `skip_empty` boolean default true
- optimistic concurrency `version_no`
- `created_at`
- `created_by`
- `last_updated_at`
- `last_updated_by`

Use the repository's canonical Company FK if the schema has one appropriate for transactional configuration. Re-discover it; do not guess a table name from this brief.

Reference stable enrollment/surface records so SA deactivation can preserve rules rather than orphaning them.

### 8.2 `automation_recipient`

Conceptual fields:

- `id`
- `automation_rule_id`
- recipient type `TO` / `CC` / `BCC`
- `email`
- `active`
- display order
- audit timestamps/user IDs as appropriate to current conventions

Reject blank/invalid email values server-side.

Prevent duplicate normalized addresses within the same rule + recipient type.

At least one active `TO` address is required for `ACTIVE` status.

### 8.3 `automation_rule_column`

Persist only selected safe output fields:

- `automation_rule_id`
- `field_key`
- `display_order`
- audit fields if appropriate

`field_key` is a Report Manifest key, not a DB column.

A rule must have at least one selected displayable field before activation.

Prevent duplicate field keys and duplicate display positions.

### 8.4 Deliberately absent in Phase 6

Do NOT create:

- condition table,
- condition group table,
- match-state table,
- scheduler table,
- outbox table,
- delivery-history table,
- provider table,
- message body/template engine table.

---

## 9. Database security

Follow the established Communication schema model:

- RLS enabled,
- browser roles receive no direct table access,
- backend service role is the application data path,
- backend-only restrictive policy / equivalent defense in depth,
- no service-role secret in frontend,
- no direct Supabase table CRUD from browser.

If an atomic save RPC is implemented with `SECURITY DEFINER`:

- use an explicit empty/safe `search_path`,
- keep it in the private Communication schema,
- revoke execute from PUBLIC / anon / authenticated,
- grant only the server roles that need it,
- do not use SECURITY DEFINER as a substitute for application authorization.

Backend ACL checks remain mandatory before invoking the RPC.

---

## 10. Atomic save requirement

A rule save changes parent configuration + recipients + selected columns.

These must be one atomic transaction.

Do not perform:

```text
save rule
then save recipients
then save columns
```

as independent commits that can leave partial configuration.

Prefer a server-only transactional RPC following the successful Phase-1 atomic enrollment-save pattern.

Backend must first validate all manifest/business inputs, then call the atomic persistence boundary.

A failed child write must leave the previous saved rule fully unchanged.

---

## 11. Optimistic concurrency

Multiple authorized users may edit shared rules.

Add a stable `version_no` (or repository-equivalent optimistic version) and require existing-rule saves to send the version last read.

Expected semantics:

```text
read version 4
user A saves -> version 5
user B tries saving stale version 4 -> conflict
```

Return a clear conflict such as:

`COMMUNICATION_RULE_VERSION_CONFLICT`

Do not silently overwrite newer changes.

Frontend should show a concise refresh/reload instruction on conflict rather than retrying blindly.

---

## 12. Schedule contract

Persist only schedule configuration. Do not execute it yet.

Stable schedule kinds:

- `MANUAL`
- `DAILY`
- `WEEKLY`
- `MONTHLY`

### MANUAL

- no execution time required,
- no weekday,
- no month day.

### DAILY

- execution time required.

### WEEKLY

- execution time required,
- one or more weekdays required,
- normalize weekdays deterministically (recommended ISO 1=Monday ... 7=Sunday),
- reject duplicates/out-of-range values.

### MONTHLY

- execution time required,
- one day-of-month required,
- accept only a deliberately documented valid range.

If 29–31 are supported, do not implement short-month execution semantics in Phase 6; document that Phase 8 must define it before scheduler activation. Do not silently invent scheduler behavior now.

### Timezone

- default `Asia/Kolkata`,
- timezone must come from a code-owned allowlist / proper IANA validation,
- do not allow arbitrary executable/timezone expressions.

### Skip empty

Persist `skip_empty`, default `true`.

No scheduler is built in this phase.

---

## 13. Subject template contract

Persist a text subject template only.

No HTML/body template editor in Phase 6.

Use a server-owned safe token allowlist. Initial safe tokens may include the already locked concepts:

- `{{company_code}}`
- `{{company_name}}`
- `{{date}}`
- `{{page_name}}`
- `{{report_name}}`
- `{{critical_count}}`
- `{{replenishment_count}}`

Reconcile these against the current master plan and code before finalizing.

Requirements:

- backend parses tokens,
- unknown tokens reject,
- no nested expressions,
- no JavaScript/template functions,
- no arbitrary property traversal,
- sensible max subject length,
- subject required for activation.

Phase 6 only stores/validates the subject. It does not render or send email.

---

## 14. Recipient contract

Support:

- TO
- CC
- BCC

Requirements:

- normalized trimmed email,
- server validation,
- deterministic ordering,
- duplicate protection,
- active/inactive recipient state if retained by the model,
- at least one active TO for rule activation,
- CC/BCC optional.

Do not implement:

- arbitrary SQL recipient lookup,
- dynamic recipient expressions,
- role/group expansion,
- external address-book integration.

Those may be considered later as separate safe capabilities.

---

## 15. Dataset selection

Dataset choices must come only from the Phase-3 Report Manifest registry for the exact current page + surface.

Conceptually:

```text
listDatasetsForPage(page)
then restrict to current surface
```

For the PO11 pilot today:

`planning_alert` is valid only where its manifest is bound (currently `planning_dashboard` and `report_view`).

If the current enrolled surface has **no bound report dataset**:

- drawer may still open because Phase-2 enrollment controls WHERE,
- show a concise `No automation dataset is available for this surface.` state,
- do not allow rule creation/activation,
- do not discover DB tables,
- do not fall back to another surface's dataset.

Unknown/stale `dataset_key` must fail closed.

---

## 16. Column selection/order

After dataset selection, show only fields whose Report Manifest has:

`displayable = true`

Rules:

- persist `field_key`, never DB column name,
- non-displayable fields cannot be selected,
- unknown fields reject,
- duplicates reject,
- ordering must be deterministic,
- new rule defaults to the manifest's `default_display_field_keys`,
- activation requires at least one selected field.

Do not expose `decision_key` merely because it exists for identity if it is marked `displayable=false`.

Do not add conditions here; conditionable fields belong to Phase 7.

---

## 17. Configuration bootstrap API

Create a generic server-authoritative configuration bootstrap/read contract separate from SA admin APIs.

A suitable conceptual request includes:

- `tx_code`
- `resource_code`
- `surface_key`
- `company_id`
- `channel=EMAIL`

It must validate:

1. developer Surface Manifest,
2. active page enrollment,
3. Email enabled,
4. exact active surface enrollment,
5. company scope,
6. underlying page EDIT ACL.

A suitable response may include:

- safe page/surface/channel labels,
- available Report Manifest datasets bound to this surface,
- displayable field metadata and defaults,
- safe subject-token metadata,
- schedule choices/timezone options,
- existing rule summaries for this company/surface.

Do not expose:

- raw DB metadata,
- admin enrollment IDs,
- service-role details,
- provider secrets,
- arbitrary manifest internals not needed by the UI.

---

## 18. Rule APIs

Use repository-native route shapes, but implement generic contracts for at least:

- list/bootstrap rules for current company/page/surface,
- read one rule,
- create/save draft,
- update existing rule atomically,
- activate,
- deactivate.

Separate endpoints or one strict save endpoint with explicit target status are both acceptable if repository conventions support them cleanly.

Every read/write by rule ID must re-resolve and verify that the rule belongs to the caller's requested/authorized company + page + surface.

Prevent IDOR/BOLA:

- knowing another rule UUID must not expose or mutate it,
- company A cannot load/update company B's rule,
- one page/surface cannot load/update another page/surface's rule.

Do not add a hard-delete endpoint in Phase 6.

---

## 19. Strict payload parsing

Rule write payloads must be strictly parsed.

Reject or ignore according to repository security convention any unexpected Phase-7+ inputs such as:

- `conditions`
- raw SQL
- query strings
- table names
- raw column names
- template functions
- match-state configuration.

Prefer rejecting unexpected unsafe fields rather than silently persisting them somewhere generic.

---

## 20. Activation validation

A rule may become `ACTIVE` only when all Phase-6 configuration is valid.

At minimum:

1. current page/surface enrollment is still active,
2. EMAIL still enabled,
3. current user has target-company EDIT ACL,
4. rule name valid,
5. dataset exists and is bound to exact current surface,
6. >=1 displayable output field selected,
7. >=1 active TO recipient,
8. all recipient emails valid,
9. subject exists and contains only safe tokens,
10. schedule configuration is internally valid,
11. timezone valid,
12. optimistic version matches for update.

A DRAFT may be saved with incomplete recipient/subject/schedule activation requirements, but it must still have safe structural identity (company/page/surface/channel/dataset where applicable) and may never contain unknown manifest keys/raw technical input.

If a surface has no dataset, do not create even a meaningless rule pointing to an invented dataset.

---

## 21. Manifest drift safety

Code-owned Report Manifests may evolve later.

If a previously saved rule references a dataset or field that no longer exists/is no longer valid for that surface:

- do not substitute another dataset/field silently,
- do not expose raw DB fallback,
- mark/read the rule as configuration-invalid or otherwise fail closed using repository-native semantics,
- block activation until corrected.

Do not automatically delete historical configuration merely because the code manifest changed.

---

## 22. UI — evolve the Phase-5 drawer, do not create a new app

Reuse the existing `AutomationSettingsDrawer` / `DrawerBase` center-drawer pattern.

Keep the PACE dense operator UX.

Do not create:

- a new side panel,
- floating FAB,
- dashboard card system,
- separate full-page rule designer,
- nested modal maze.

A practical Phase-6 drawer can contain:

1. Rule selector/list + `New Rule`
2. General
   - Rule Name
   - Status
   - Channel = Email (read-only)
3. Recipients
   - TO
   - CC
   - BCC
4. Subject
5. Schedule
6. Dataset
7. Columns / ordering
8. Save Draft / Save / Activate / Deactivate as appropriate
9. Close

Use existing form, dense grid/list, button, toast, confirm and keyboard conventions.

Do not render fake sections for Phase 7+.

---

## 23. Surface with no dataset — UI

For PO11 surfaces such as any currently enrolled surface that has no Report Manifest dataset bound:

- retain the safe page/surface/channel context,
- show a concise no-dataset message,
- no rule editor/create action,
- Close remains available.

Do not make the user choose `planning_alert` on a surface where the manifest did not bind it.

---

## 24. Column UX

Show human labels, not field keys as primary text.

Support selection and explicit order using existing dense controls.

Do not invent drag-and-drop if the repo does not already have a robust accessible pattern; Up/Down controls or an existing ordering component are acceptable.

Persist stable `field_key` + display order.

---

## 25. Recipient UX

Use dense editable rows or repository-native repeatable input patterns.

Each row needs:

- Type: TO / CC / BCC
- Email
- active state if supported

Provide clear validation for invalid/duplicate email.

Do not send any message from this screen in Phase 6.

---

## 26. Schedule UX

Schedule choices:

- Manual Only
- Daily
- Weekly
- Monthly

Show only fields relevant to selected type.

Examples:

- Daily -> Time + Timezone
- Weekly -> Weekday(s) + Time + Timezone
- Monthly -> Day + Time + Timezone

Default timezone: `Asia/Kolkata`.

No cron expression field.

No free-form recurrence expression.

---

## 27. Rule action behavior

Recommended user flow:

### New rule

- initialize dataset/columns from safe manifest defaults when exactly one dataset is available,
- status starts DRAFT,
- user can Save Draft,
- Activate only after validation passes.

### Existing active rule

- edit and Save atomically,
- activation remains valid only if saved configuration passes validation,
- Deactivate requires confirmation.

### Existing draft/inactive rule

- edit/save,
- activate explicitly.

No hard delete.

---

## 28. Company/surface transition behavior

Preserve Phase-5 context hardening.

If company or surface changes while the drawer/editor is open:

- close/reset the drawer immediately,
- discard unsaved local Phase-6 edits only after an appropriate existing dirty-state confirmation pattern if the user initiated the navigation and dirty state exists,
- never move a draft from Company A/Surface A into Company B/Surface B,
- never auto-reopen after the new context resolves.

Phase 6 now has real editable state, so implement proper dirty-state protection using existing confirmation utilities.

Do not silently save on context change.

---

## 29. Dirty-state protection

Unlike Phase 5, Phase 6 has persisted editable data.

Required:

- detect unsaved changes,
- Close/Escape with dirty state -> confirmation,
- rule switch with dirty state -> confirmation,
- New Rule while dirty -> confirmation,
- company/surface navigation while dirty -> use the best repository-supported guard; never silently transplant or save the draft.

Use existing `openActionConfirm` or current canonical confirmation utility.

Do not build a second confirmation framework.

---

## 30. No conditions yet

Do NOT add condition rows or condition persistence.

An active rule with no conditions will later mean the dataset is unfiltered/all-current rows unless Phase 7 deliberately refines semantics.

Because no scheduler exists until Phase 8, Phase-6 activation cannot send anything yet.

Do not pretend to execute rules.

---

## 31. Backend tests — required

Add focused tests for at least:

### Authorization / scope

1. EDIT-authorized target-company user can bootstrap/read/save,
2. VIEW-only user cannot configure or receive recipient details,
3. wrong company scope denied,
4. rule UUID from another company denied,
5. rule UUID from another surface/page denied,
6. SA/GA admin path works without frontend role checks,
7. de-enrolled/Email-off/surface-off configuration fails closed.

### Dataset / columns

8. valid bound dataset accepted,
9. unknown dataset rejected,
10. dataset bound to another surface rejected,
11. valid display fields accepted,
12. unknown field rejected,
13. non-displayable field rejected,
14. duplicate column rejected,
15. duplicate display order rejected,
16. default display fields resolve correctly.

### Recipients / subject

17. valid TO/CC/BCC accepted,
18. activation without TO rejected,
19. invalid email rejected,
20. duplicate recipient rejected,
21. valid safe subject tokens accepted,
22. unknown/malformed token rejected.

### Schedule

23. MANUAL valid without time,
24. DAILY requires time,
25. WEEKLY requires valid unique weekday(s) + time,
26. invalid weekday rejected,
27. MONTHLY requires valid day + time,
28. invalid timezone rejected,
29. skip_empty default true.

### Lifecycle / atomicity

30. DRAFT incomplete activation-only fields may save safely,
31. ACTIVE requires full validation,
32. ACTIVE -> INACTIVE persists without deletion,
33. stale version update returns conflict,
34. successful save increments version,
35. failed recipient/column save leaves previous parent+children unchanged,
36. no hard delete path exists.

---

## 32. Database tests / verification

Verify on Dev after applying the migration:

- tables exist only in intended schema,
- RLS enabled,
- browser roles cannot directly read/write,
- service-role path works,
- atomic RPC permissions are server-only,
- uniqueness/check constraints behave,
- stale-version conflict works,
- partial child failure rolls back.

Run Supabase advisors if available/relevant and review any new security/performance findings caused by this migration.

---

## 33. Frontend tests / guards

At minimum verify:

1. Phase-5 action remains fail-closed and now corresponds to configuration authorization,
2. drawer bootstrap loads only after authorized context,
3. no-dataset surface shows no rule creation UI,
4. default dataset/columns initialize from manifest metadata,
5. rule list supports multiple rules,
6. Save Draft persists and reloads,
7. Activate validates required fields,
8. Deactivate requires confirmation,
9. version conflict is surfaced safely,
10. invalid/duplicate recipient feedback,
11. safe token validation feedback,
12. schedule conditional fields,
13. column selection/order persists,
14. dirty Close/Escape requires confirmation,
15. dirty rule switch requires confirmation,
16. company/surface transition cannot transplant/reopen stale draft,
17. no Conditions/Preview/Test Send controls exist,
18. no admin enrollment API is used by rule UI,
19. no direct Supabase table access from frontend.

Use automated component tests where the repository supports them; otherwise add deterministic helper tests plus build/static guards and document limitations.

---

## 34. Manual Dev acceptance matrix

Create temporary Dev enrollment/rule data only for verification.

Suggested:

### A. Enrollment

Enable PO11 Email on:

- `planning_dashboard`
- `report_view`

Optionally enable one no-dataset surface to verify safe empty capability behavior.

### B. Authorization

Verify:

- SA works,
- GA works,
- normal PO11 EDIT user works,
- PO11 VIEW-only user cannot configure,
- user without company/page access cannot configure.

### C. Create rule

On CMP003 or an available Dev company context:

- create `Daily Critical Stock Alert` as DRAFT,
- select `planning_alert`,
- select default display fields,
- add one TO and optional CC/BCC,
- set a safe subject,
- Daily schedule at a test time, Asia/Kolkata,
- save,
- reload and verify exact persistence.

### D. Multiple rule

Create a second rule such as Manual Only and prove rules remain independent.

### E. Activation

- missing TO -> activation rejected,
- invalid subject token -> rejected,
- valid full configuration -> ACTIVE,
- deactivate -> INACTIVE.

### F. Concurrency

Open/read the same version twice; save one, then prove stale save conflicts.

### G. No-dataset surface

Open Automation Settings on an enrolled PO11 surface with no bound report dataset:

- drawer opens safely,
- no rule can be created,
- no arbitrary dataset fallback.

### H. Context transition

With unsaved changes, verify Close/rule switch/company/surface transitions use dirty-state protection and cannot move the draft into another context.

### Cleanup

Remove/disable temporary Dev test rules and enrollment data using safe application/admin paths as appropriate. Report final Dev test state explicitly.

Do not touch Production.

---

## 35. Migration workflow

Phase 6 requires schema work.

Follow repository/Supabase conventions:

1. create migration using the current Supabase CLI/repo method,
2. review SQL carefully,
3. apply to **Dev Supabase only**,
4. verify migration history,
5. run security/advisor checks where available,
6. never apply to Production in this phase,
7. commit migration with implementation,
8. deploy Dev backend/frontend,
9. verify Dev behavior.

Do not merge to `main`.

---

## 36. Strictly out of scope

Do NOT implement:

- conditions,
- condition groups,
- typed condition evaluation,
- report preview,
- Test Send,
- rule execution,
- schedule evaluation,
- central scheduler,
- pg_cron,
- outbox/queue,
- retry/dead-letter,
- message rendering/body templates,
- MSG91,
- SMTP,
- actual email sending,
- provider message IDs,
- delivery history,
- CURRENT_MATCHING execution state,
- NEWLY_MATCHED tracking,
- WhatsApp,
- Phase 7.

---

## 37. Acceptance criteria

Phase 6 is complete only when:

1. durable rule/recipient/column persistence exists,
2. migration applied to Dev only,
3. rule configuration requires target-company page EDIT ACL,
4. Phase-5 runtime action reflects configuration authorization,
5. multiple rules per company/surface supported,
6. lifecycle DRAFT/ACTIVE/INACTIVE works,
7. recipient TO/CC/BCC config works,
8. safe subject template validation works,
9. schedule config persists without execution,
10. dataset selection comes only from Report Manifest,
11. columns come only from displayable manifest fields,
12. surface with no dataset cannot create a rule,
13. activation validation is fail-closed,
14. atomic parent+recipient+column saves prevent partial state,
15. optimistic concurrency prevents silent overwrite,
16. cross-company/page/surface IDOR is blocked,
17. backend-only DB security preserved,
18. Phase-5 company/surface stale-context protection preserved,
19. dirty-state protection exists for real edits,
20. no condition/preview/scheduler/outbox/provider work leaked in,
21. Render Dev healthy,
22. Vercel Dev healthy,
23. Dev temporary test residue is documented/cleaned,
24. `main` and Production remain untouched.

---

## 38. Final report required from Codex

Report exactly:

### 1. Status
DONE / PARTIAL / BLOCKED

### 2. Files changed

### 3. Database migration
- migration filename/version,
- tables/functions/indexes/policies,
- Dev apply result,
- Production confirmation.

### 4. Rule data model
Explain rule, recipient, column and lifecycle contracts.

### 5. Authorization
Explain target-company EDIT enforcement, SA/GA behavior and VIEW-only denial.

### 6. Atomic save + concurrency
Explain transaction boundary and version-conflict behavior.

### 7. Configuration bootstrap/API
List routes/contracts and fail-closed gates.

### 8. Dataset/column safety
Explain manifest resolution and no-dataset behavior.

### 9. Recipient + subject safety
Explain normalization, duplicate handling and token allowlist.

### 10. Schedule contract
Explain all four schedule types, timezone and skip-empty persistence.

### 11. Drawer UX
Explain multiple rule handling, save/activate/deactivate and no-dataset state.

### 12. Dirty-state/context transitions
Explain Close/Escape/rule switch/company/surface behavior.

### 13. Tests/checks
List exact commands and results.

### 14. Dev manual acceptance
Report authorization, persistence, activation, concurrency, no-dataset and context-transition checks.

### 15. Final Dev test state
State all temporary enrollment/rule rows left or cleaned.

### 16. Supabase security/advisors
Report relevant findings introduced by Phase 6.

### 17. Dev commit SHA

### 18. Push status

### 19. Render Dev deployment
Commit + status.

### 20. Vercel Dev deployment
Commit + status.

### 21. Production confirmation
Explicitly confirm:
- `main` unchanged,
- Production Supabase migration not applied,
- Production Render untouched.

### 22. Scope confirmation
Explicitly confirm NOT implemented:
- Conditions,
- Preview,
- Test Send,
- scheduler,
- queue/outbox,
- MSG91,
- email sending,
- CURRENT_MATCHING/NEWLY_MATCHED state,
- WhatsApp,
- Phase 7.

Then STOP.

Do not begin Phase 7.
