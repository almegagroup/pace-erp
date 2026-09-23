# PACE ERP — Communication Automation Phase 7
## Typed Condition Builder + Server-Authoritative Preview

**Status:** READY FOR IMPLEMENTATION  
**Branch:** `dev` only  
**Depends on:** Phases 1–6 COMPLETE  
**Phase-6 completion SHA before this brief:** `d0c7f43463591df7cd9f631afe879f8f0610e68f`  
**Pilot page:** PO11 — Procurement Planning  
**Initial dataset:** `planning_alert`  
**Initial channel:** EMAIL only

---

## 1. Goal

Phase 7 adds two capabilities to the existing Phase-6 Automation Settings drawer:

1. a safe, typed **Condition Builder** persisted with each automation rule,
2. a read-only **Preview** that loads real server-authoritative report-adapter rows, applies the draft conditions, and returns only safe selected output fields.

Phase 7 does **not** execute schedules, send email, create outbox jobs, track CURRENT/NEWLY matching state, or integrate MSG91.

---

## 2. Read first

Before changing code, read:

1. `CLAUDE.md`
2. `docs/PACE-ERP-COMMUNICATION-AUTOMATION-MASTER-PLAN.md`
3. Communication Automation Phase 1–6 task briefs
4. current latest `dev`
5. `supabase/functions/api/_core/communication/report_manifest/types.ts`
6. PO11 `planning_alert` Report Manifest
7. `report_adapter_registry.ts`
8. PO11 planning-alert adapter
9. current Phase-6 rule configuration handlers/tests
10. current Phase-6 migrations/RPCs
11. `AutomationSettingsDrawer.jsx`
12. `ProcurementPlanningPage.jsx`
13. current Communication routes + ACL registry

Do not implement from this brief alone. Reconcile with the current repository.

---

## 3. Locked architecture

```text
Surface Manifest
= WHERE configuration may appear

Report Manifest
= WHICH safe fields/operators exist

Report Adapter
= authoritative source rows

Phase-6 Rule
= recipients/subject/schedule/dataset/columns/lifecycle

Phase-7 Conditions
= WHICH adapter rows match

Phase-7 Preview
= show current authoritative rows after conditions

Phase-8+
= scheduler/delivery
```

Condition evaluation must happen against normalized **Report Adapter output**, never against raw database tables chosen by the user.

---

## 4. Condition model — flat and deliberate

Phase 7 supports a flat list of conditions with one rule-level condition logic:

- `ALL` = every condition must match (logical AND)
- `ANY` = at least one condition must match (logical OR)

No nested groups, parentheses, arbitrary expression trees, SQL, JavaScript, or free-form formulas in Phase 7.

Zero conditions means **all source rows match**.

Use a name such as `condition_logic`; do NOT call this CURRENT/NEWLY `match_mode`, because Phase 11 owns CURRENT_MATCHING / NEWLY_MATCHED semantics.

---

## 5. Manifest is the authority

A condition field is valid only when the selected Report Manifest dataset declares:

```text
conditionable = true
```

The operator is valid only when the field's own:

```text
allowed_operators
```

contains that operator.

The current PO11 manifest already provides these contracts.

Examples:

- `planning_status`: EQ / NE / IN / NOT_IN
- quantity/day fields: EQ / NE / GT / GTE / LT / LTE / BETWEEN
- string fields: only their manifest-declared operators
- hidden `decision_key`: not conditionable

Never infer extra operators from the datatype if the manifest does not allow them.

---

## 6. Supported operators

Phase 7 supports the existing manifest keys only:

- `EQ`
- `NE`
- `IN`
- `NOT_IN`
- `GT`
- `GTE`
- `LT`
- `LTE`
- `BETWEEN`
- `IS_EMPTY`
- `IS_NOT_EMPTY`

Frontend should show friendly labels, but persist stable operator keys.

---

## 7. Typed operand contract

Persist condition operands as a strictly validated typed JSON value (or repository-equivalent typed representation).

Recommended logical shapes:

### EQ / NE / GT / GTE / LT / LTE

One scalar value.

### IN / NOT_IN

Array of one or more unique scalar values.

### BETWEEN

Array of exactly two scalar values:

```text
[min, max]
```

Reject inverted ranges where the datatype supports ordering.

### IS_EMPTY / IS_NOT_EMPTY

No operand; persisted operand should be `null`.

The backend must validate the operand against the manifest field datatype before persistence or preview.

No arbitrary nested JSON objects.

---

## 8. Datatype semantics

Implement one reusable typed condition engine.

### STRING

- operand must be string
- trim input at configuration boundary
- comparison semantics must be deterministic and explicitly tested
- recommended Phase-7 contract: exact case-sensitive comparison after trimming condition input; do not use locale-dependent fuzzy matching

### ENUM

- operand must be one of the manifest `enum_values[].value`
- IN/NOT_IN lists contain only valid enum values
- no arbitrary enum text

### NUMBER

- finite numeric value only
- no NaN / Infinity / numeric strings after persistence normalization

### INTEGER

- integer only

### BOOLEAN

- boolean only

### DATE

- strict valid `YYYY-MM-DD`
- compare as real date semantics, not unchecked free text

### DATETIME

- strict ISO-8601 datetime
- normalize/compare instants deterministically

### Empty semantics

`IS_EMPTY` should treat `null`/`undefined` and empty/whitespace-only strings as empty.

`IS_NOT_EMPTY` is the inverse.

Do not treat numeric zero or boolean false as empty.

---

## 9. Database migration expected

Phase 7 adds condition persistence, so a Dev-only schema migration is expected.

Use the normal Supabase migration workflow. Never edit already-applied Phase-6 migrations in place.

### 9.1 `automation_rule_condition`

Conceptual fields:

- `id` uuid PK
- `automation_rule_id` FK
- `field_key`
- `operator_key`
- typed `operand_json` / equivalent
- `display_order`
- audit fields if consistent with current Communication tables

Constraints should prevent obvious malformed ordering/blank keys, while manifest/type validation remains in application code.

Delete conditions by replacing the rule's child condition set atomically; no hard-delete rule endpoint is needed.

### 9.2 `automation_rule.condition_logic`

Add rule-level condition logic with values:

- `ALL`
- `ANY`

Default `ALL`.

Use a DB constraint.

Do not add CURRENT_MATCHING / NEWLY_MATCHED state here.

---

## 10. Atomic rule save must expand to conditions

Phase-6 rule save is atomic across:

- rule parent
- recipients
- selected columns

Phase 7 must extend the same atomic boundary to include:

- conditions
- `condition_logic`

A failed condition insert/constraint must roll the entire save back, including parent/recipients/columns.

Do not save conditions through independent browser CRUD.

Update both normal save and activate RPC paths consistently.

Optimistic `version_no` behavior must remain intact.

---

## 11. Lifecycle behavior must remain Phase-6 correct

Do not regress:

```text
new Save -> DRAFT
new Activate -> ACTIVE
DRAFT Save -> DRAFT
DRAFT Activate -> ACTIVE
ACTIVE Save -> ACTIVE
ACTIVE Deactivate -> INACTIVE
INACTIVE Save -> INACTIVE
INACTIVE Activate -> ACTIVE
```

Conditions may be edited on DRAFT, ACTIVE, and INACTIVE rules.

If an ACTIVE rule is edited, its normal Save must validate that its full configuration, including all conditions, remains valid before preserving ACTIVE status.

---

## 12. Rule read/bootstrap contracts

Rule read must return:

- `condition_logic`
- ordered conditions

Configuration bootstrap/dataset metadata must expose only what UI needs to build conditions safely:

For each field:

- `field_key`
- label
- datatype
- `conditionable`
- allowed operators
- enum values when applicable
- format metadata if useful

Do not expose raw DB metadata.

Displayable and conditionable are separate concepts.

A field may be conditionable without being displayed; obey the manifest contract exactly.

---

## 13. Condition persistence validation

Before save/activate:

1. selected dataset exists for exact page/surface
2. every condition field exists in that dataset
3. every condition field is `conditionable=true`
4. operator is explicitly allowed by that field
5. operand shape matches operator
6. operand type matches field datatype
7. enum operand uses allowed enum value
8. duplicate `display_order` rejected
9. deterministic condition ordering
10. reasonable maximum condition count enforced server-side

Recommended hard maximum for Phase 7: **25 conditions per rule**.

Reject unknown condition keys/extra object properties.

---

## 14. Dataset change behavior

Changing a rule's dataset may invalidate conditions.

Do not silently map conditions from one dataset to another.

When the user deliberately changes dataset in the drawer:

- selected columns reset to the new dataset defaults (existing Phase-6 behavior),
- conditions reset to empty,
- condition logic resets to `ALL` or remains `ALL` by explicit contract,
- mark editor dirty.

If loading an existing historical rule whose saved conditions no longer exist in the current manifest, preserve the saved rule for audit but mark configuration invalid/fail closed; do not silently delete/translate conditions.

---

## 15. Typed condition evaluator

Create one reusable pure condition evaluator independent from PO11.

Conceptually:

```text
evaluateCondition(fieldManifest, rowValue, condition)
evaluateConditionSet(datasetManifest, row, conditionLogic, conditions)
```

Rules:

- no `eval()`
- no dynamic code generation
- no SQL generation
- no string-to-function mapping from client input
- switch only over code-owned operator keys
- fail closed on unexpected type/operator

Zero conditions => true.

ALL => every condition true.

ANY => at least one condition true.

---

## 16. Preview endpoint

Add a generic authenticated runtime endpoint for preview.

Conceptual route:

```text
POST /api/communication/rules/preview
```

Use repository naming conventions if a cleaner shape already exists.

The preview request should carry the current unsaved editor configuration needed to preview:

- page identity
- surface
- company
- channel
- dataset key
- selected output column field keys/order
- condition logic
- conditions
- code-owned/adapted report preview context

It must NOT require saving the rule first.

Preview is read-only and must not increment `version_no`.

---

## 17. Preview authorization

Preview must use the same current configuration authorization as Phase 6:

- manifest page/surface/channel valid
- active page enrollment
- Email enabled
- exact surface active
- target company scope valid
- underlying page `EDIT` ACL valid

Do not allow VIEW-only users to use the configuration preview endpoint if they cannot configure Automation Settings.

No admin enrollment APIs are used.

---

## 18. Preview must use Report Adapter Registry

The preview pipeline must be:

```text
resolve authorized configuration context
        ↓
resolve exact Report Manifest dataset
        ↓
validate columns + conditions
        ↓
build safe adapter context
        ↓
REPORT_ADAPTER_REGISTRY.loadRows(...)
        ↓
validated authoritative normalized rows
        ↓
condition evaluator
        ↓
project selected display columns
        ↓
return bounded preview
```

Never query procurement tables directly from generic preview code.

Never duplicate PO11 status/business calculations.

PO11 adapter remains source of the normalized planning decision rows.

---

## 19. Preview adapter-context safety

PO11 `planning_alert` currently requires:

- `company_id`
- `plan_month`

The authorized company must come from the already-resolved Phase-6 target company context.

The client must NOT be allowed to smuggle/override adapter `company_id` inside arbitrary report-context JSON.

For PO11 preview, the page may provide current `plan_month`; server validates strict `YYYY-MM`, then constructs:

```text
{ company_id: authorizedCompanyId, plan_month: validatedPlanMonth }
```

Prefer a code-owned adapter-preview-context resolver/normalizer so future datasets can safely define their own permitted runtime preview parameters without forwarding arbitrary client objects to adapters.

Do not persist `plan_month` into the rule in Phase 7. Scheduler-time period semantics belong to Phase 8.

---

## 20. Preview output contract

Return safe bounded metadata such as:

- dataset key/label
- selected column metadata in configured order
- `total_source_rows`
- `total_matching_rows`
- `returned_rows`
- `truncated`
- safe row objects containing selected display fields only

Recommended hard preview row cap: **100 rows**.

Even if more rows match, do not return unlimited data.

Do not return hidden `decision_key` unless it is explicitly displayable (currently it is not).

Do not return recipient details in preview output.

Do not render/send email.

---

## 21. Preview source snapshot

Preview is a point-in-time read.

For PO11:

- current page company
- current `plan_month`
- canonical report adapter decision rows

The preview does not freeze data and does not promise future scheduler output will be identical.

Show a concise UI note such as:

`Preview uses the current server data for the selected company and month.`

---

## 22. Preview error behavior

Fail closed for:

- unauthorized company
- VIEW-only/no EDIT
- de-enrolled page/surface
- Email off
- missing/invalid dataset
- no report adapter
- invalid preview context
- unknown/non-conditionable field
- disallowed operator
- invalid operand type
- non-displayable requested output field
- adapter output validation failure

Do not return partial unsafe rows after validation failure.

---

## 23. Drawer UX — Conditions

Extend existing Automation Settings drawer; do not build a separate page.

Add a `Conditions` section after Dataset/Columns or in the most coherent dense order.

UI must be driven by the selected dataset manifest metadata.

### Condition header

```text
Match: [ ALL conditions | ANY condition ]
```

### Each condition row

- Field
- Operator
- typed value control(s)
- Move Up / Move Down if ordering is exposed
- Remove

`Add Condition` appends a new row.

No cards, no nested visual query builder, no side panel.

---

## 24. Typed controls

Frontend controls must follow datatype/operator:

### ENUM

- EQ/NE: select
- IN/NOT_IN: multi-select/checklist using manifest enum values

### NUMBER / INTEGER

- numeric input
- BETWEEN: From + To numeric controls

### BOOLEAN

- true/false select or equivalent

### DATE

- date input
- BETWEEN: From + To dates

### DATETIME

- datetime-local input with explicit normalization contract

### STRING

- text input
- IN/NOT_IN: dense repeatable values or repository-native multi-value control

### IS_EMPTY / IS_NOT_EMPTY

- no value control

Changing field/operator must clear incompatible old operand values rather than carrying stale hidden data.

---

## 25. Condition labels

Show friendly manifest labels and friendly operator labels:

- Equals
- Not Equal
- In
- Not In
- Greater Than
- Greater Than or Equal
- Less Than
- Less Than or Equal
- Between
- Is Empty
- Is Not Empty

Persist stable keys only.

---

## 26. Preview UX

Add a `Preview` action/section in the drawer.

Preview should be explicit; do not run a server preview on every keystroke.

Suggested behavior:

1. user edits conditions
2. clicks `Preview`
3. server validates current draft configuration
4. drawer shows:
   - matching row count
   - source row count
   - bounded result grid using selected columns in configured order
   - truncated message when >100 matches

Preview must work with unsaved DRAFT edits.

Do not mark the editor clean merely because Preview succeeded.

Do not persist automatically on Preview.

---

## 27. Preview table behavior

Use existing dense PACE grid/table patterns where practical.

No paging API required in Phase 7; capped preview is sufficient.

Show an empty state when zero rows match.

Do not expose technical identity fields or raw JSON.

Respect manifest field format metadata for human display where current reusable formatters exist; otherwise use safe deterministic rendering without inventing email formatting logic.

---

## 28. Dirty state

Condition edits and condition-logic changes must set the existing Phase-6 editor dirty state.

Preserve all Phase-6 dirty guards:

- Close/Escape
- rule switch
- New Rule
- company change
- surface/tab change

Dataset change clearing conditions must be part of dirty state.

Preview does not clear dirty state.

---

## 29. Rule activation behavior

Conditions are optional.

A valid rule with zero conditions may activate and means all dataset rows match.

If conditions exist, activation must reject any condition that is invalid against the current manifest.

No requirement for preview before activation.

Do not introduce CURRENT_MATCHING / NEWLY_MATCHED selection yet.

---

## 30. Database security

Preserve current Communication model:

- RLS enabled
- no direct anon/authenticated table CRUD
- service-role backend path
- `SECURITY DEFINER` RPCs with safe/empty search_path
- revoke PUBLIC/anon/authenticated execute
- server authorization before RPC

New condition table must follow the same backend-only protection.

---

## 31. Backend tests — condition parsing/evaluation

Add deterministic tests for at least:

1. zero conditions -> row matches
2. ALL logic
3. ANY logic
4. unknown logic rejected
5. unknown field rejected
6. non-conditionable field rejected
7. disallowed operator rejected
8. EQ / NE
9. IN / NOT_IN
10. GT / GTE / LT / LTE
11. BETWEEN inclusive semantics
12. IS_EMPTY / IS_NOT_EMPTY
13. STRING operand validation
14. ENUM allowlist validation
15. NUMBER finite validation
16. INTEGER validation
17. BOOLEAN validation
18. DATE validation/comparison
19. DATETIME validation/comparison
20. invalid operand shape rejected
21. IN empty list rejected
22. BETWEEN wrong length rejected
23. BETWEEN inverted range rejected
24. max condition count enforced
25. false/0 are not treated as empty

---

## 32. Backend tests — persistence/lifecycle

Verify:

26. conditions save/reload in display order
27. condition logic save/reload
28. successful save increments version
29. stale version conflict still works
30. condition child failure rolls back parent/recipients/columns/conditions
31. new rule remains DRAFT on normal save
32. ACTIVE normal save remains ACTIVE
33. INACTIVE normal save remains INACTIVE
34. activation accepts zero conditions
35. activation rejects invalid persisted/draft conditions
36. dataset change cannot silently retain invalid conditions
37. IDOR/cross-company/cross-surface protections remain intact

---

## 33. Preview tests

Verify:

38. preview requires EDIT authorization
39. VIEW-only denied
40. wrong company denied
41. de-enrolled/Email-off/surface-off denied
42. current unsaved conditions can preview
43. selected display columns only returned
44. non-displayable output field rejected
45. PO11 preview constructs adapter context with authorized company
46. client cannot override adapter company
47. invalid PO11 `plan_month` rejected
48. canonical PO11 adapter rows used
49. planning status condition uses adapter `CRITICAL/REPLENISH/NORMAL`
50. conditions filter expected fixture rows
51. total source vs matching counts correct
52. 100-row cap works
53. `truncated` correct
54. zero matches returns valid empty preview
55. preview performs no writes / version increment
56. adapter failure fails closed

---

## 34. Frontend tests

At minimum cover:

1. Conditions section only when dataset available
2. conditionable fields only
3. operator list follows selected field manifest
4. enum control uses manifest values
5. numeric BETWEEN uses two controls
6. empty operators hide operand input
7. changing field/operator clears incompatible operand
8. add/remove condition marks dirty
9. condition logic change marks dirty
10. dataset change clears conditions safely
11. Preview button does not save
12. Preview success preserves dirty state
13. preview row/count rendering
14. zero-match state
15. truncated state
16. preview error state
17. existing Phase-6 dirty navigation behavior still works
18. no CURRENT/NEWLY controls
19. no Test Send/email-send controls

---

## 35. Dev manual acceptance — PO11

Use Dev only. Create temporary enrollment/rule data if needed.

### A. Basic condition

On PO11 `planning_dashboard`, configure:

```text
Planning Status IN (CRITICAL, REPLENISH)
```

Preview current Dev company/month.

Verify every returned row has one of those statuses and counts match the authoritative adapter output.

### B. Numeric condition

Example:

```text
Available Stock Quantity <= Replenishment Stock Quantity
```

Do NOT implement field-to-field comparisons in Phase 7.

Because operands are constants only, instead test a real constant threshold such as:

```text
Available Stock Quantity <= 1000
```

Verify typed numeric behavior.

### C. ALL

Use two compatible conditions and prove both must match.

### D. ANY

Use two conditions and prove either may match.

### E. Zero conditions

Preview all current source decision rows.

### F. Invalid field/operator

Direct API attempt with hidden `decision_key` or unsupported operator must fail.

### G. Company safety

Preview CMP003 context and prove no CMP006 data can be injected by client preview context.

### H. Draft preview

Change unsaved conditions, Preview, then cancel/close appropriately; prove preview did not persist them.

### I. Active lifecycle

Save condition edits on ACTIVE rule and prove status remains ACTIVE and version increments.

### J. Cleanup

Remove all temporary rule/enrollment test rows and report final counts.

---

## 36. Performance/safety

Condition evaluation may happen in memory over validated adapter rows in Phase 7.

Do not convert user conditions into SQL predicates.

Preview response hard cap = 100 rows.

Add a reasonable condition count cap = 25.

Avoid repeated adapter loads inside one preview request.

No N+1 database loading introduced by the condition engine.

---

## 37. Migration workflow

1. create new migration using repository/Supabase convention
2. never edit Phase-6 applied migrations
3. review SQL
4. apply to Dev Supabase only
5. verify migration history
6. verify RLS/grants/RPC permissions
7. run security/performance advisors
8. Production untouched

---

## 38. Strictly out of scope

Do NOT implement:

- nested condition groups
- parentheses/expression language
- field-to-field comparisons
- arbitrary SQL
- raw table/column filtering
- preview paging/export
- Test Send
- email rendering/body
- scheduler
- cron
- schedule execution
- outbox/queue
- retry/dead-letter
- MSG91/SMTP
- actual email delivery
- CURRENT_MATCHING
- NEWLY_MATCHED
- transition-state storage
- delivery history
- WhatsApp
- Phase 8

---

## 39. Acceptance criteria

Phase 7 is COMPLETE only when:

1. condition table + condition logic persist safely
2. conditions are part of atomic rule save/activate transaction
3. optimistic versioning still works
4. manifest conditionable/operator allowlists are authoritative
5. all supported datatypes/operators evaluate deterministically
6. zero conditions means all rows
7. flat ALL/ANY logic works
8. no arbitrary expression/SQL exists
9. preview uses Report Adapter Registry only
10. PO11 preview uses authorized company + validated plan month
11. client cannot override company through preview context
12. preview works with unsaved editor state
13. preview returns selected display fields only
14. preview capped at 100 rows with total/matching counts
15. preview performs no writes
16. Phase-6 lifecycle semantics preserved
17. Phase-6 EDIT ACL/IDOR protections preserved
18. Phase-6 dirty guards preserved
19. Dev migration/security verified
20. tests/manual acceptance pass
21. temporary Dev test data cleaned/documented
22. Render Dev healthy
23. frontend Dev deployment healthy
24. `main` and Production untouched
25. no Phase-8+ functionality leaked in

---

## 40. Required final report

Return exactly:

### 1. Status
DONE / PARTIAL / BLOCKED

### 2. Files changed

### 3. Migration
Version/name, table/column/RPC changes, Dev apply status.

### 4. Condition persistence model

### 5. Typed evaluator
List datatype/operator semantics.

### 6. Atomic save + lifecycle
Confirm Phase-6 status semantics remain correct.

### 7. Preview API
Route, auth gates, input/output, row cap.

### 8. PO11 preview context
Explain authorized company + `plan_month` handling.

### 9. Security
Manifest-only fields/operators, no SQL/raw DB metadata, IDOR/ACL.

### 10. Drawer UX
Condition builder + Preview behavior.

### 11. Tests
Exact commands/results.

### 12. Manual Dev acceptance
Report each scenario.

### 13. Final Dev test state
Exact row counts for enrollment/rules/recipients/columns/conditions after cleanup.

### 14. Supabase advisors
Only Phase-7-relevant findings.

### 15. Dev commit SHA

### 16. Push status

### 17. Render Dev
Commit + LIVE status.

### 18. Frontend Dev
Commit + successful deployment.

### 19. Production confirmation
Explicitly confirm:
- `main` unchanged
- Production Supabase untouched
- Phase-7 migration not applied to Production
- Production Render untouched

### 20. Scope confirmation
Explicitly confirm NOT implemented:
- nested groups/expression language
- Test Send
- scheduler
- queue/outbox
- MSG91/email sending
- CURRENT_MATCHING / NEWLY_MATCHED
- delivery history
- WhatsApp
- Phase 8

Then STOP.

Do not begin Phase 8.
