# PACE ERP — Communication Automation Phase 5
## Surface-aware Automation Settings Action + Drawer Shell — Codex Task Brief

**Status:** READY FOR IMPLEMENTATION  
**Branch:** `dev` only  
**Depends on:** Phases 1–4 complete  
**Pilot page:** PO11 — Procurement Planning  
**Channel:** EMAIL only  

---

## 1. Goal

Phase 5 connects the central Communication Enrollment decision to runtime PACE pages.

Phase 1/2 already decide **WHERE** Communication Automation is allowed. Phase 3/4 define safe report metadata and PO11 data. Phase 5 must now make an `Automation Settings` action appear only on an allowed runtime page/surface and open a reusable drawer shell.

Phase 5 is **visibility + shell only**.

It must NOT implement automation rule persistence, recipients, subject, schedules, conditions, preview, scheduler, queue, provider integration, or email delivery.

---

## 2. Mandatory read-first

Before changing code, read current `dev` and at minimum:

1. `CLAUDE.md`
2. `docs/PACE-ERP-COMMUNICATION-AUTOMATION-MASTER-PLAN.md`
3. `docs/CODEX-COMMUNICATION-AUTOMATION-PHASE-2-SA-ENROLLMENT-UI-TASK-BRIEF.md`
4. `docs/CODEX-COMMUNICATION-AUTOMATION-PHASE-2-UX-COMPONENT-GUIDELINES.md`
5. `docs/CODEX-COMMUNICATION-AUTOMATION-PHASE-3-REPORT-MANIFEST-FRAMEWORK-TASK-BRIEF.md`
6. `docs/CODEX-COMMUNICATION-AUTOMATION-PHASE-4-PO11-REPORT-ADAPTER-TASK-BRIEF.md`
7. current Communication Surface Manifest
8. current Communication Enrollment handlers/routes/schema
9. current Report Manifest / Report Adapter registry
10. `frontend/src/admin/sa/screens/SACommunicationAutomation.jsx`
11. `frontend/src/components/layer/DrawerBase.jsx`
12. `frontend/src/pages/dashboard/procurement/planning/ProcurementPlanningPage.jsx`
13. current auth/context/company/ACL helper patterns and route registry

Do not implement from stale assumptions.

---

## 3. Architecture lock

The runtime visibility decision must be generic and server-authoritative.

Conceptually:

```text
isCommunicationActionVisible({
  pageIdentity,
  surfaceKey,
  channel,
  companyContext,
  user
})
```

The action is visible only when all required gates pass:

1. page has a developer-owned Communication Surface Manifest,
2. requested surface exists in that manifest,
3. requested channel is supported on that surface,
4. page is currently enlisted/active,
5. EMAIL is currently enabled,
6. that exact surface is currently enrolled/active,
7. the current authenticated user is allowed to access the underlying page in the current company context.

Unknown or malformed identities fail closed.

Do not hard-code `PO11 === visible` or any equivalent special-case visibility rule.

---

## 4. Critical security boundary — do NOT use the Phase-2 admin API at runtime

Phase-2 admin APIs are intentionally protected by `context.isAdmin === true` and expose enrollment-management state.

Normal runtime page users must **not** call:

- admin page search,
- admin enrollment GET,
- admin enrollment POST,
- any `/api/admin/communication/...` endpoint.

Implement a separate minimal runtime read capability under the normal authenticated API pipeline.

This runtime capability must not grant enrollment-edit authority.

It must never mutate Communication Enrollment.

---

## 5. Runtime API / service contract

Implement a generic, minimal, read-only runtime visibility endpoint/service using repository-native routing conventions.

A suitable conceptual request is:

```text
page identity:
- tx_code
- resource_code

surface_key
channel = EMAIL
company_id when the page is company-scoped
```

The exact HTTP shape should follow PACE conventions.

The response should expose only what the runtime UI needs, for example:

```json
{
  "visible": true,
  "page": {
    "tx_code": "PO11",
    "resource_code": "PROC_PLANNING_VIEW",
    "title": "Procurement Planning"
  },
  "surface": {
    "key": "planning_dashboard",
    "label": "Planning Dashboard"
  },
  "channel": "EMAIL"
}
```

Equivalent minimal shape is acceptable.

Do NOT expose:

- enrollment row IDs,
- admin audit metadata,
- arbitrary menu rows,
- raw database names,
- provider secrets,
- rule data that does not exist yet.

If `visible=false`, keep the response minimal.

---

## 6. Runtime enrollment resolution

Resolve the page from server-owned catalog/manifest identity, not from a client-supplied `page_menu_id` that the UI can arbitrarily choose.

Validate the page identity against:

- Communication Surface Manifest,
- PACE menu/page catalog where necessary,
- Communication Enrollment rows.

Expected DB logic conceptually:

```text
page enrollment active
AND email_enabled
AND surface enrollment active
```

Use existing schema and indexes. Do not create duplicate enrollment storage.

No Phase-5 migration is expected.

---

## 7. User ACL / company safety

Central SA/GA enrollment means "this surface may expose automation"; it does NOT bypass normal PACE authorization.

Runtime visibility must respect the current user's real page access for the selected company.

For company-scoped pages such as PO11:

- include the page-selected company context,
- validate company membership/scope using existing PACE helpers,
- evaluate canonical page access using the existing ACL/menu snapshot machinery,
- do not derive access from role names,
- do not assume the session's selected company equals the page-local company selector,
- do not grant visibility solely because a user knows the endpoint.

Do not invent an `EDIT` requirement unless the current master plan or established PACE access contract explicitly requires it. Phase 5 should gate on the underlying page access needed to use that surface; future rule-management authorization can be refined in Phase 6.

SA/GA should continue to work through canonical admin access behavior, not a frontend role check.

---

## 8. Fail-closed frontend behavior

The frontend action must be hidden when:

- visibility request is loading,
- visibility request fails,
- backend returns `visible=false`,
- company context is missing where required,
- current surface cannot be resolved.

Never optimistically show the action before server confirmation.

Do not display an error banner merely because an optional automation action cannot be resolved; log/handle using current frontend conventions and remain hidden.

---

## 9. Generic frontend runtime helper

Create a reusable frontend API/helper/hook rather than embedding raw fetch calls inside PO11.

Conceptual responsibilities:

```text
useCommunicationActionVisibility({
  txCode,
  resourceCode,
  surfaceKey,
  channel: "EMAIL",
  companyId
})
```

Exact naming should follow current repository conventions.

Requirements:

- centralized API request helper,
- React Query or existing data-fetch convention,
- query key includes page identity + surface + channel + company context,
- disabled when required input is missing,
- stale result from an old company/surface must not show on the new one,
- no call to admin APIs.

---

## 10. Generic Automation Settings action component

Create a reusable action/button component if that matches current component architecture.

Requirements:

- label: `Automation Settings`,
- rendered only after backend visibility resolves true,
- follows existing ERP button/action styling,
- no floating FAB,
- no oversized promotional card,
- no duplicate button framework,
- keyboard/focus behavior should follow existing page conventions.

The component must not contain PO11-specific business logic.

---

## 11. Generic drawer shell

Clicking `Automation Settings` opens a reusable drawer shell.

Reuse existing:

`frontend/src/components/layer/DrawerBase.jsx`

Prefer the same center-drawer pattern already used by Phase 2 unless current UX conventions strongly indicate another existing pattern.

The shell should show concise read-only context such as:

- Automation Settings
- page / TX identity
- current surface label
- channel: Email

The shell may include a neutral placeholder area for future rule configuration.

Do NOT expose internal phase numbers to end users if avoidable.

### Actions

Phase 5 drawer should have only safe shell actions, normally:

- Close

Do NOT add a fake Save button that persists nothing.

Do NOT add Test Send.

Escape/close behavior must work using `DrawerBase` conventions.

---

## 12. No dirty-state complexity yet

Phase 5 has no editable rule fields and no persisted automation draft.

Therefore:

- no dirty-state model is needed,
- no unsaved-changes confirmation is needed,
- no rule save API is needed.

Do not prematurely build Phase-6 state management.

---

## 13. PO11 surface mapping

Integrate the generic runtime action into PO11 using stable developer-owned surface keys.

Current PO11 mapping:

```text
normal route + dashboard tab -> planning_dashboard
normal route + input tab     -> monthly_plan_input
normal route + sloc tab      -> sloc_group_setup
normal route + item tab      -> item_group_setup
normal route + history tab   -> history_archive
full report route            -> report_view
```

Use the current actual implementation to confirm tab/route IDs before coding.

Do not let the user/admin type these keys.

Do not infer them by comparing friendly labels.

A page-specific mapping at the PO11 integration boundary is acceptable; the visibility engine itself must remain generic.

---

## 14. PO11 placement

Place `Automation Settings` in an existing action/toolbar lane appropriate to the current surface.

Do not create:

- a new dashboard card,
- a side panel,
- a second header,
- an unrelated floating control.

The button should feel like a normal PACE page action.

For the standalone full report route, use the same generic action and `report_view` surface identity.

---

## 15. Company change behavior

PO11 has an explicit page-level company selector.

When the selected company changes:

1. visibility must re-resolve using the new company context,
2. stale visibility from the prior company must not remain displayed,
3. if the drawer is open, close it before/when context changes rather than showing a drawer tied to the previous company,
4. no rule/config state exists yet, so no discard confirmation is needed.

---

## 16. Surface/tab change behavior

When the user changes PO11 tabs/surfaces:

1. close an open Automation Settings drawer tied to the old surface,
2. resolve visibility for the new surface,
3. show the action only if that exact surface is enrolled,
4. do not carry old-surface metadata into the new surface.

The full report route must similarly resolve `report_view`, not `planning_dashboard`.

---

## 17. Enrollment changes must take effect without frontend code changes

Phase-2 central control remains authoritative.

Example:

```text
SA/GA enables:
[x] planning_dashboard
[ ] monthly_plan_input
[x] report_view
```

Then runtime should behave:

```text
Planning Dashboard -> action visible
Monthly Plan Input -> action hidden
Report View -> action visible
```

If SA/GA later disables Email or de-enlists PO11, future/refetched runtime checks must hide all PO11 automation actions without any frontend code change.

Do not hard-code today's enrolled surface list into PO11.

---

## 18. Report Manifest / Adapter relation in Phase 5

Do not make report dataset existence a hidden replacement for Phase-2 enrollment.

Phase-2 enrollment remains the authority for **WHERE the action may appear**.

Phase-3/4 manifests/adapters remain the authority for **WHAT report data exists**.

The shell may display safe dataset metadata if it is useful and naturally available, but this is optional in Phase 5.

Do not start dataset selection or field selection UI yet.

A selected/enrolled surface with no dataset must not cause arbitrary SQL/data discovery. Keep the shell safe and generic.

---

## 19. Backend tests — required

Add focused tests using injected/fake dependencies where appropriate.

At minimum cover:

1. valid manifest + active enrollment + Email enabled + active surface + authorized user => visible true,
2. page not communication-capable => false/fail closed,
3. unknown surface => false/fail closed,
4. unsupported channel => false/fail closed,
5. no page enrollment => false,
6. page enrollment inactive/de-enlisted => false,
7. Email disabled => false,
8. surface not enrolled/inactive => false,
9. another surface enrolled but requested surface not enrolled => false,
10. company scope/access denied => false/appropriate authorization failure without leaking admin data,
11. normal authorized user can receive visible=true without being SA/GA,
12. admin-only enrollment mutation authority is not exposed by runtime endpoint,
13. malformed page/surface inputs fail closed.

If existing route tests use a different pattern, follow the repository convention but cover the same semantics.

---

## 20. Frontend tests / guards — required

Use the current repo's practical testing/guard conventions.

Verify at minimum:

1. action hidden while query is loading,
2. action hidden on runtime API error,
3. action hidden on `visible=false`,
4. action visible on `visible=true`,
5. click opens drawer shell,
6. drawer shows correct page/surface/channel context,
7. Close/Escape closes drawer,
8. changing surface closes stale drawer and re-resolves visibility,
9. changing company closes stale drawer and re-resolves visibility,
10. report route uses `report_view`,
11. no admin communication API is called by PO11 runtime,
12. no Save/Test Send/rule persistence request exists in Phase 5.

If component-level automated testing infrastructure is unavailable, implement deterministic helper tests plus the repository's existing JSX/build/static guards and document the limitation.

---

## 21. Manual Dev acceptance matrix

Using Phase-2 SA/GA control on Dev, deliberately configure PO11 and verify runtime behavior.

Suggested matrix:

### A. Enlisted + Email ON

Select only:

- `planning_dashboard`
- `report_view`

Expected:

- Planning Dashboard: visible
- Monthly Plan Input: hidden
- SLOC Group Setup: hidden
- Item Group Setup: hidden
- History / Archive: hidden
- Report View: visible

### B. Add Monthly Plan Input

Expected:

- Monthly Plan Input becomes visible after runtime refresh/refetch,
- no PO11 code edit required.

### C. Email OFF

Expected:

- all PO11 Automation Settings actions hidden.

### D. Re-enable Email, then de-enlist page

Expected:

- all actions hidden.

### E. Re-enlist

Expected:

- only currently selected surfaces return.

### F. ACL

Verify:

- SA works,
- GA works,
- a normal user with legitimate PO11 access gets the runtime action when surface is enabled,
- a user without PO11/company access cannot use the runtime visibility endpoint to obtain an enabled action.

Clean up test enrollment state after verification if the test changed Dev configuration intentionally; document the final Dev state.

---

## 22. Database policy

Expected:

`No Phase-5 database migration required.`

Use existing Phase-1/2 enrollment tables.

Do NOT create:

- rule tables,
- recipient tables,
- schedule tables,
- condition tables,
- draft tables,
- queue/outbox tables.

If a migration appears necessary, STOP and explain before expanding scope.

---

## 23. Strictly out of scope

Do NOT implement:

- automation rule CRUD,
- rule persistence,
- recipient selection,
- TO / CC / BCC,
- subject templates,
- body templates,
- schedule configuration,
- Manual/Daily/Weekly/Monthly scheduling logic,
- condition builder,
- condition evaluation,
- AND/OR builder,
- dataset/column selection UI,
- preview,
- Test Send,
- current matching execution,
- newly matched tracking,
- scheduler,
- pg_cron,
- outbox/queue,
- retries/dead-letter,
- delivery history,
- MSG91,
- SMTP,
- provider secrets,
- actual email sending,
- WhatsApp,
- Phase 6.

---

## 24. Expected file organization

Inspect current repository conventions first. Conceptually prefer separate concerns such as:

```text
backend communication runtime visibility resolver/handler/route
frontend communication runtime API/helper/hook
frontend reusable Automation Settings action
frontend reusable Automation Settings drawer shell
PO11 thin surface integration
focused tests
```

Do not put enrollment SQL, ACL logic, PO11 tab mapping, and drawer rendering in one giant file.

---

## 25. Workflow

Follow PACE workflow exactly:

1. Start from latest `dev`.
2. `git status`.
3. Preserve unrelated local work.
4. Implement Phase 5 only.
5. Run focused backend/frontend tests, build, lint/type/guards as applicable.
6. No migration unless genuinely necessary.
7. Apply no unnecessary Dev DB changes except deliberate temporary enrollment settings for acceptance testing.
8. Review full diff.
9. Confirm no Phase-6+ leakage.
10. Commit.
11. Push to `dev`.
12. Verify Render Dev deployment.
13. Verify Vercel Dev deployment.
14. Verify manual runtime matrix against Dev enrollment.
15. STOP.

Do not merge to `main`.

Do not touch Production.

---

## 26. Acceptance criteria

Phase 5 is complete only when:

1. generic server-authoritative runtime visibility resolver exists,
2. runtime endpoint/service is distinct from admin enrollment API,
3. normal authenticated authorized users can resolve visibility without SA/GA mutation authority,
4. developer Surface Manifest is validated,
5. active page enrollment is required,
6. Email enabled is required,
7. exact active surface enrollment is required,
8. current company/page ACL is respected,
9. unknown inputs fail closed,
10. frontend visibility helper is reusable,
11. action is hidden during loading/error/false state,
12. generic `Automation Settings` action exists,
13. generic `DrawerBase` shell exists,
14. no fake Save/Test Send appears,
15. PO11 maps all six stable surfaces correctly,
16. report route uses `report_view`,
17. surface/company changes cannot leave stale action/drawer context,
18. SA/GA enrollment changes dynamically control runtime visibility,
19. no hardcoded PO11 visibility rule exists,
20. no admin API is used by normal PO11 runtime,
21. no Phase-6 rule configuration/persistence exists,
22. no database migration is required unless explicitly justified,
23. Render + Vercel Dev are healthy,
24. Production/main remain untouched.

---

## 27. Final report required from Codex

Report exactly:

### 1. Status
DONE / PARTIAL / BLOCKED

### 2. Files changed

### 3. Runtime visibility architecture
Explain all gates and the server-side resolution flow.

### 4. Runtime endpoint/service
- route or internal contract,
- request inputs,
- minimal response,
- authentication/authorization behavior,
- why it does not expose admin mutation authority.

### 5. Company/ACL enforcement
Explain how page-local company selection is respected and how role-name hardcoding was avoided.

### 6. Frontend generic runtime helper
Explain query key, fail-closed behavior, loading/error behavior.

### 7. Generic Automation Settings action
Explain component reuse and visibility behavior.

### 8. Drawer shell
Explain DrawerBase usage, context displayed, actions, Escape/Close.

### 9. PO11 surface mapping
List all six exact mappings and explain full-report handling.

### 10. Surface/company transition behavior
Explain how stale drawer/visibility is prevented.

### 11. Tests/checks
List exact commands and results.

### 12. Manual Dev enrollment matrix
Report results for Dashboard/Input/SLOC/Item/History/Report across enable/disable/de-enlist/re-enlist scenarios.

### 13. ACL verification
Report SA, GA, normal authorized user, unauthorized user behavior.

### 14. Database
Expected statement:

`No Phase-5 database migration required.`

### 15. Final Dev enrollment state
State whether any temporary Phase-5 enrollment test rows/settings remain and why.

### 16. Dev commit SHA

### 17. Push status

### 18. Render Dev deployment
Commit + status.

### 19. Vercel Dev deployment
Commit + status.

### 20. Production confirmation
Explicitly confirm:
- `main` not changed,
- Production Supabase not changed.

### 21. Scope confirmation
Explicitly confirm NOT implemented:
- Phase-6 rule CRUD/persistence,
- recipients,
- subject/body configuration,
- schedules,
- condition builder/evaluation,
- dataset/column selection UI,
- preview,
- Test Send,
- scheduler,
- queue/outbox,
- MSG91,
- email sending,
- WhatsApp.

Then STOP.

Do not begin Phase 6.
