# PACE ERP Full System Handoff

Date: 2026-03-29
Status: Working reference for tomorrow's execution
Purpose: One-file operational map of what the ERP is supposed to be, how it currently runs, which handlers use which schemas, what is correct, what is wrong, and what is still missing

## 1. Authority Order

This file is a working handoff and synthesis document.
It is useful for execution, but it does not outrank the frozen authority documents.

Authority order:

1. `docs/Base Docs/PACE_ERP_CONSTITUTION_SSOT.md`
2. `docs/PACE_ERP_STATE.md`
3. Gate freeze documents and gate-wise roadmap docs
4. Audit and xray documents
5. This handoff file

If this file conflicts with the constitution or the state file, the constitution and state file win.

## 2. What PACE ERP Is Trying To Be

The intended system is:

- backend-authoritative ERP
- frontend with zero business/security authority
- single Edge Function backend entry
- deterministic pipeline for every request
- keyboard-first protected ERP
- governance-led admin and ACL model
- menu snapshot authority, not frontend-made menus
- session-controlled multi-window cluster with max-3 governed windows

The constitution locks these non-negotiables:

- Supabase Auth answers identity only
- ERP answers access, context, ACL, and session lifecycle
- frontend must not use Supabase SDK for business authority
- all ERP traffic goes through the single `api` Edge Function
- protected session behavior must remain intact
- default security posture is deny

## 3. Current Big Picture

The repo already has real backbone, not just scaffolding.

Working backbone that clearly exists:

- single backend entry at `supabase/functions/api/index.ts`
- locked request pipeline in `supabase/functions/api/_pipeline/runner.ts`
- public auth flow for login and signup
- protected session resolution, lifecycle enforcement, context resolution, ACL resolution
- protected route dispatch split into admin, ACL, workflow, menu, and session families
- ERP menu snapshot model
- governance/admin CRUD surfaces for SA
- session cluster and governed multi-window foundation
- ACL and workflow tables plus real handlers
- keyboard-first frontend shell and shared screen templates

The repo also still has known incompleteness:

- some state-file items remain `HALF-DONE` or `DEFERRED`
- some ACL/runtime proof is still structural rather than fully field-proven
- some non-SA screens still need the same keyboard-native UI migration pass
- some backend correctness risks still need cleanup and proof

## 4. End-To-End Workflow

### 4.1 Public Auth Flow

Primary files:

- `supabase/functions/api/_core/auth/login.handler.ts`
- `supabase/functions/api/_core/auth/signup/signup.handler.ts`
- `supabase/functions/api/_core/auth/logout.handler.ts`
- `supabase/functions/api/_core/auth/me.handler.ts`

Flow:

1. User authenticates through Supabase-backed identity flow.
2. `POST /api/login` verifies credentials through backend auth delegate logic.
3. ERP account state is checked in `erp_core.users`.
4. ERP session is created in `erp_core.sessions`.
5. Session cookie is issued from backend.
6. Login builds and stores menu snapshot into `erp_cache.session_menu_snapshot`.
7. `POST /api/signup` creates ERP user in `erp_core.users` as `PENDING`.
8. Signup request row is created in `erp_core.signup_requests`.
9. SA approval later activates the user.

Key truth:

- login success is not the same as business access
- session, context, and ACL must still pass downstream

### 4.2 Protected Request Flow

Primary files:

- `supabase/functions/api/index.ts`
- `supabase/functions/api/_pipeline/runner.ts`
- `supabase/functions/api/_pipeline/protected_routes.dispatch.ts`

Locked pipeline order:

1. headers
2. CORS
3. CSRF
4. rate limit
5. session
6. session lifecycle
7. context
8. ACL
9. handler dispatch

Important runtime behavior:

- `/health` is the only true bypass
- public login/signup still go through the pipeline shell
- protected requests must have active session, resolved context, and allowed ACL
- idle warning, idle logout, absolute warning, absolute logout remain active

### 4.3 Menu Workflow

Primary files:

- `supabase/functions/api/_core/auth/menu.handler.ts`
- `supabase/functions/api/_routes/menu.routes.ts`

Flow:

1. Menu authority is backend-owned.
2. Login builds session snapshot from `erp_menu.menu_snapshot`.
3. SA universe reads SA snapshot rows.
4. ACL universe reads company-bound snapshot rows.
5. Snapshot is stored in `erp_cache.session_menu_snapshot`.
6. Protected shell consumes backend-delivered menu structure.

### 4.4 Admin Governance Flow

Primary dispatcher:

- `supabase/functions/api/_routes/admin.routes.ts`

This family covers:

- signup request review
- company provisioning
- group/company mapping
- project master
- department create
- approval-rule maintenance
- user directory
- user role and scope changes
- session visibility and revoke
- system diagnostics and control panel
- audit viewing

### 4.5 Workflow Decision Flow

Primary files:

- `supabase/functions/api/_routes/workflow.routes.ts`
- `supabase/functions/api/_core/workflow/process_decision.handler.ts`

Flow:

1. Protected request enters workflow decision route.
2. Company context is required.
3. Handler resolves request and approver state from ACL tables.
4. Decision writes to workflow decision/event tables.
5. Audit/event trail is preserved in `erp_audit.workflow_events`.

### 4.6 Session Cluster Flow

Primary files:

- `supabase/functions/api/_routes/session.routes.ts`
- `supabase/functions/api/_core/session/session.cluster.handler.ts`
- `supabase/functions/api/_core/session/session.cluster.ts`

Flow:

1. Existing active session requests open-window ticket.
2. New governed window is admitted into the cluster.
3. Max-3 window rule is enforced by backend cluster logic.
4. Window-close updates cluster/window state.

## 5. Route Family And Handler Inventory

This is the practical handler map that matters most for execution.

### 5.1 Backend Entry And Pipeline

| Area | File | What It Does |
| --- | --- | --- |
| backend entry | `supabase/functions/api/index.ts` | single Edge Function entry, request id, health handling, wraps full pipeline |
| main runner | `supabase/functions/api/_pipeline/runner.ts` | executes locked pipeline order and dispatches routes |
| protected dispatch | `supabase/functions/api/_pipeline/protected_routes.dispatch.ts` | fans protected requests into route families |

### 5.2 Public/Auth Handlers

| Route or Function | Handler File | Primary Schemas/Tables |
| --- | --- | --- |
| `POST /api/login` | `supabase/functions/api/_core/auth/login.handler.ts` | `erp_core.users`, `erp_core.sessions`, `erp_map.user_company_roles`, `erp_menu.menu_snapshot`, `erp_cache.session_menu_snapshot` |
| `POST /api/signup` | `supabase/functions/api/_core/auth/signup/signup.handler.ts` | `erp_core.users`, `erp_core.signup_requests` |
| `POST /api/logout` | `supabase/functions/api/_core/auth/logout.handler.ts` | `erp_core.sessions`, session cluster tables |
| `GET /api/me` | `supabase/functions/api/_core/auth/me.handler.ts` | session identity response, no frontend authority |
| `GET /api/me/profile` | `supabase/functions/api/_core/auth/me_profile.handler.ts` | profile read path using ERP user/session context |
| `POST /api/unlock` | `supabase/functions/api/_core/auth/unlock.handler.ts` | lock/unlock protected session path |
| `GET /api/me/menu` | `supabase/functions/api/_core/auth/menu.handler.ts` | `erp_menu.menu_snapshot`, `erp_cache.session_menu_snapshot`, `erp_map.user_company_roles` |

### 5.3 Admin/Governance Handlers

| Area | Handler File | Primary Schemas/Tables |
| --- | --- | --- |
| pending signup list | `supabase/functions/api/_core/admin/signup/list_pending.handler.ts` | `erp_core.signup_requests`, `erp_core.users` |
| approve signup | `supabase/functions/api/_core/admin/signup/approve.handler.ts` | `erp_core.signup_requests`, `erp_core.users`, role/bootstrap ACL tables |
| reject signup | `supabase/functions/api/_core/admin/signup/reject.handler.ts` | `erp_core.signup_requests`, `erp_core.users` |
| create company | `supabase/functions/api/_core/admin/company/create_company.handler.ts` | `erp_master.companies` |
| GST profile fetch | `supabase/functions/api/_core/admin/company/get_company_gst_profile.handler.ts` | `erp_master.companies` |
| create group | `supabase/functions/api/_core/admin/group/create_group.handler.ts` | `erp_master.groups` |
| update group state | `supabase/functions/api/_core/admin/group/update_group_state.handler.ts` | `erp_master.groups` |
| map company to group | `supabase/functions/api/_core/admin/group/map_company_to_group.handler.ts` | `erp_master.companies`, `erp_master.groups`, `erp_map.company_group` |
| unmap company from group | `supabase/functions/api/_core/admin/group/unmap_company_group.handler.ts` | `erp_map.company_group` |
| create project | `supabase/functions/api/_core/admin/project/create_project.handler.ts` | `erp_master.projects`, `erp_map.company_projects` |
| list projects | `supabase/functions/api/_core/admin/project/list_projects.handler.ts` | `erp_map.company_projects` |
| update project state | `supabase/functions/api/_core/admin/project/update_project_state.handler.ts` | `erp_master.projects`, `erp_map.company_projects` |
| create department | `supabase/functions/api/_core/admin/department/create_department.handler.ts` | `erp_master.departments` |
| list approver rules | `supabase/functions/api/_core/admin/approval/list_approver_rules.handler.ts` | `acl.approver_map` |
| upsert approver rule | `supabase/functions/api/_core/admin/approval/upsert_approver_rule.handler.ts` | `acl.approver_map` |
| delete approver rule | `supabase/functions/api/_core/admin/approval/delete_approver_rule.handler.ts` | `acl.approver_map` |
| list users | `supabase/functions/api/_core/admin/user/list_users.handler.ts` | `erp_core.users`, `erp_acl.user_roles`, `erp_core.signup_requests` |
| get user scope | `supabase/functions/api/_core/admin/user/get_user_scope.handler.ts` | `erp_core.users`, `erp_acl.user_roles`, `erp_core.signup_requests`, `erp_map.user_parent_companies`, `erp_map.user_companies`, `erp_map.user_projects`, `erp_map.user_departments`, `erp_master.companies`, `erp_master.projects`, `erp_master.departments` |
| update user scope | `supabase/functions/api/_core/admin/user/update_user_scope.handler.ts` | `erp_core.users`, `erp_acl.user_roles`, `erp_master.companies`, `erp_master.projects`, `erp_master.departments`, `erp_map.user_parent_companies`, `erp_map.user_companies`, `erp_map.user_projects`, `erp_map.user_departments` |
| update user state | `supabase/functions/api/_core/admin/user/update_user_state.handler.ts` | `erp_core.users`, `erp_acl.user_roles` |
| update user role | `supabase/functions/api/_core/admin/user/update_user_role.handler.ts` | `erp_acl.user_roles` |
| list audit logs | `supabase/functions/api/_core/admin/audit/list_audit_logs.handler.ts` | `erp_audit.admin_action_audit` |
| list sessions | `supabase/functions/api/_core/admin/session/list_sessions.handler.ts` | `erp_core.sessions`, `erp_core.users`, `erp_core.signup_requests` |
| revoke session | `supabase/functions/api/_core/admin/session/revoke_session.handler.ts` | `erp_core.sessions`, session cluster tables |
| system health | `supabase/functions/api/_core/admin/diagnostics/system_health.handler.ts` | `erp_core.sessions`, `acl.precomputed_acl_view`, `erp_menu.menu_snapshot` |
| control panel | `supabase/functions/api/_core/admin/diagnostics/control_panel.handler.ts` | `erp_core.sessions`, `erp_master.companies`, `erp_core.users`, `erp_map.user_company_roles`, `erp_core.signup_requests`, `erp_audit.admin_action_audit` |

### 5.4 ACL Handlers

| Area | Handler File | Primary Schemas/Tables |
| --- | --- | --- |
| enable company module | `supabase/functions/api/_core/admin/acl/enable_company_module.handler.ts` | `acl.company_module_map` |
| disable company module | `supabase/functions/api/_core/admin/acl/disable_company_module.handler.ts` | `acl.company_module_map` |
| list company modules | `supabase/functions/api/_core/admin/acl/list_company_modules.handler.ts` | `acl.company_module_map` |
| list role permissions | `supabase/functions/api/_core/admin/acl/list_role_permissions.handler.ts` | `acl.role_menu_permissions` |
| upsert role permission | `supabase/functions/api/_core/admin/acl/upsert_role_permission.handler.ts` | `acl.role_menu_permissions` |
| disable role permission | `supabase/functions/api/_core/admin/acl/disable_role_permission.handler.ts` | `acl.role_menu_permissions` |
| capability list | `supabase/functions/api/_core/admin/acl/list_capabilities.handler.ts` | `acl.capabilities` |
| capability upsert | `supabase/functions/api/_core/admin/acl/upsert_capability.handler.ts` | `acl.capabilities` |
| role capabilities list | `supabase/functions/api/_core/admin/acl/list_role_capabilities.handler.ts` | `acl.role_capabilities` |
| capability unassign | `supabase/functions/api/_core/admin/acl/unassign_capability_from_role.handler.ts` | `acl.role_capabilities` |
| ACL version list | `supabase/functions/api/_core/admin/acl/list_acl_versions.handler.ts` | `acl.acl_versions` |
| ACL version activate | `supabase/functions/api/_core/admin/acl/activate_acl_version.handler.ts` | `acl.acl_versions` |
| user override upsert | `supabase/functions/api/_core/admin/acl/upsert_user_override.handler.ts` | `acl.user_overrides` |
| user override revoke | `supabase/functions/api/_core/admin/acl/revoke_user_override.handler.ts` | `acl.user_overrides` |

### 5.5 Workflow Handlers

| Route or Function | Handler File | Primary Schemas/Tables |
| --- | --- | --- |
| `POST /api/workflow/decision` | `supabase/functions/api/_core/workflow/process_decision.handler.ts` | `acl.workflow_requests`, `acl.approver_map`, `acl.precomputed_acl_view`, `acl.workflow_decisions`, `erp_audit.workflow_events` |

### 5.6 Session Cluster Handlers

| Route or Function | Handler File | Primary Schemas/Tables |
| --- | --- | --- |
| `POST /api/session/cluster/admit` | `supabase/functions/api/_core/session/session.cluster.handler.ts` | session cluster tables |
| `POST /api/session/cluster/open-window` | `supabase/functions/api/_core/session/session.cluster.handler.ts` | session cluster tables |
| `POST /api/session/cluster/window-close` | `supabase/functions/api/_core/session/session.cluster.handler.ts` | session cluster tables |

## 6. Schema Map

This is the practical schema ownership model visible from docs, handlers, and migrations.

### 6.1 `erp_core`

Purpose:

- users
- sessions
- signup requests
- session lifecycle backbone

Observed tables in active use:

- `users`
- `sessions`
- `signup_requests`

Status:

- critical and real
- actively used by login, signup, me, session admin, diagnostics

### 6.2 `erp_master`

Purpose:

- company and master entities

Observed tables in active use:

- `companies`
- `groups`
- `projects`
- `departments`

Status:

- active and tied into SA governance flows

### 6.3 `erp_map`

Purpose:

- relational mapping between users, companies, projects, departments, and groups

Observed tables in active use:

- `user_company_roles`
- `company_group`
- `company_projects`
- `user_parent_companies`
- `user_companies`
- `user_projects`
- `user_departments`

Status:

- critical for context and scope
- recent split introduced `user_parent_companies`

### 6.4 `erp_acl`

Purpose:

- older role rows still consumed by some admin user flows

Observed tables in active use:

- `user_roles`

Status:

- still active in handler reality
- naming overlap with `acl` schema means this area should stay documented carefully

### 6.5 `acl`

Purpose:

- governance ACL runtime, module mapping, workflow approvals, permissions

Observed tables in active use:

- `company_module_map`
- `role_menu_permissions`
- `capabilities`
- `role_capabilities`
- `acl_versions`
- `user_overrides`
- `approver_map`
- `workflow_requests`
- `workflow_decisions`
- `precomputed_acl_view`
- `module_resource_map`

Status:

- core governance schema
- real handlers already consume it
- some proof and policy hardening needed post-split

### 6.6 `erp_menu`

Purpose:

- authoritative menu records and snapshots

Observed tables in active use:

- `menu_master`
- `menu_tree`
- `menu_snapshot`

Status:

- active and central to protected shell menu authority

### 6.7 `erp_cache`

Purpose:

- session-bound cached menu snapshot

Observed tables in active use:

- `session_menu_snapshot`

Status:

- active and intentionally service-role dominated

### 6.8 `erp_audit`

Purpose:

- append-only audit and workflow event evidence

Observed tables in active use:

- `admin_action_audit`
- `workflow_events`

Status:

- active
- needed post-split privilege seal adjustment

## 7. Migration Reality

This section is not a line-by-line dump of every migration file.
It captures the migration bands that currently matter most for execution and correctness.

### 7.1 Major Migration Bands

| Migration Area | Meaning |
| --- | --- |
| Gate-0 schema and deny foundation | base schemas, deny-first stance, service-role discipline |
| Gate-6 ACL and RLS wave | table-level business RLS activation and relational policy work |
| Menu/session cluster waves | menu snapshot and governed multi-window behavior |
| Gate-6.6.6 split wave | parent company and work company separation |
| post-split security seal | final hardening for missed objects introduced by the split |

### 7.2 Key Migration Files Worth Remembering

| File | Why It Matters |
| --- | --- |
| `supabase/migrations/20260122102000_gate0_0_6B_enable_rls_globally.sql` | global RLS posture declaration |
| `supabase/migrations/20260316101000_gate6_6_19B_full_business_rls_activation.sql` | major business-table RLS activation wave |
| `supabase/migrations/20260317120000_gate6_6_19_FINAL_relational_rls.sql` | final relational RLS wave before later split additions |
| `supabase/migrations/20260317130000_gate6_6_19F_authenticated_privilege_formalization.sql` | authenticated privilege formalization wave |
| `supabase/migrations/20260410113000_gate6_6_6B_split_parent_from_work_company.sql` | split parent company from operational company scope |
| `supabase/migrations/20260410118000_gate6_6_19J_post_split_security_seal.sql` | post-split hardening seal added in this session |

### 7.3 What The New Security Seal Migration Fixes

File:

- `supabase/migrations/20260410118000_gate6_6_19J_post_split_security_seal.sql`

It seals three confirmed gaps:

1. `erp_map.user_parent_companies`
   - table existed after split
   - RLS/policy/privilege hardening had not caught up
2. `erp_audit.workflow_events`
   - policy existed
   - authenticated schema/table privilege wiring was incomplete
3. `acl.module_resource_map`
   - RLS existed
   - companion read policy was missing

Important truth:

- this is a security hardening migration
- not a data backfill migration

## 8. Frontend And UI Reality

The frontend has materially moved toward the keyboard-first target.

Shared shell/template work already done:

- `frontend/src/layout/MenuShell.jsx`
- `frontend/src/components/templates/ErpScreenScaffold.jsx`
- `frontend/src/components/templates/ErpEntryFormTemplate.jsx`
- `frontend/src/components/templates/ErpMasterListTemplate.jsx`
- `frontend/src/components/templates/ErpApprovalReviewTemplate.jsx`
- `frontend/src/components/templates/ErpReportFilterTemplate.jsx`
- `frontend/src/components/ErpCommandPalette.jsx`
- `frontend/src/components/layer/ModalBase.jsx`
- `frontend/src/components/layer/DrawerBase.jsx`
- `frontend/src/components/ErpPaginationStrip.jsx`
- `frontend/src/hooks/useErpPagination.js`

Visible SA screens already moved through the new grammar:

- `SAHome`
- `SAUsers`
- `SAUserRoles`
- `SAUserScope`
- `SAApprovalRules`
- `SARolePermissions`
- `SACompanyModuleMap`
- `SAProjectMaster`
- `SASessions`
- `SAAudit`
- `SASignupRequests`

Current frontend direction:

- launcher mode versus active workspace mode
- larger central work area
- keyboard-native shell
- visible and stable command flows
- flatter worksheet-like screens instead of card-admin style

Still true:

- more polishing is needed
- remaining non-SA screens still need the same migration grammar
- some visual and interaction issues remain for tomorrow's pass

## 9. What Is Correct Right Now

These parts look structurally sound from the docs plus actual code scan.

### 9.1 Strong/Correct

- single backend entry exists and is real
- locked pipeline order exists in real code
- `/health` isolation exists
- login/signup/session backbone is real
- backend-issued session cookies are real
- session lifecycle enforcement exists
- menu snapshot authority is backend-owned
- protected route dispatch split exists
- session cluster/governed window family exists
- major SA governance backend handlers exist
- key ACL/workflow handlers exist
- keyboard-first shell foundation exists
- visible SA governance UI rebuild is already underway and usable
- post-split security seal migration now exists in repo

### 9.2 Likely Stable Enough To Build On

- auth/session request flow
- admin route family structure
- menu snapshot model
- SA governance screen direction
- list pagination component pattern
- command bar foundation

## 10. What Is Wrong, Risky, Or Incomplete

This section is the most important execution section.

### 10.1 Confirmed Risks

1. ACL route-to-resource mapping still looks structurally weak in the main pipeline.
   Current reality in `supabase/functions/api/_pipeline/runner.ts` is still placeholder-like:
   `resourceCode: routeKey` and `action: "VIEW"`.
   That means full runtime ACL semantics may not yet be mapped to true resource/action pairs.

2. `menu.handler.ts` still contains debug log noise.
   This is not architecture-breaking, but it is cleanup debt and can pollute observability.

3. Project create is not yet fully proven clean in live flow.
   Structured error metadata was improved, but the live `REQUEST_BLOCKED` root cause still needs one more reproduction/proof pass.

4. State-file gaps still exist outside the UI pass.
   Some items remain `HALF-DONE` or `DEFERRED` in `docs/PACE_ERP_STATE.md`, especially around later-gate proof and closure.

5. Frontend migration is not ERP-wide yet.
   SA has major progress, but non-SA universes are not fully brought under the same screen grammar.

### 10.2 Governance/Docs Reality Mismatch Risks

- some docs are aspirational while code is partially there
- some code is operational but not yet sealed by full regression proof
- some schema security expectations were correct in intention but incomplete in later split objects

### 10.3 UI/UX Incomplete Areas

- more SA governance polishing remains
- command bar needs continued refinement
- shortcut visibility and mnemonic consistency need further pass
- some filters/search placement still need rule-based consistency
- remaining pages need workspace-width protection so work area does not shrink

## 11. What Is Still Missing

### 11.1 Backend/DB Missing Or Needing Proof

- final proof that ACL runtime maps true resource/action semantics, not placeholders
- full live closure of blocked project-create path
- broader review of post-split objects for any late security seal misses beyond the confirmed set
- full gate closure for state-file `HALF-DONE` and `DEFERRED` items that are scheduled for future gates

### 11.2 Frontend Missing

- non-SA module migration into the same keyboard-native workspace grammar
- complete screen-by-screen standardization of primary focus, hotkeys, command registration, and deterministic list navigation
- final polish pass for SA governance surfaces
- more compact, even cleaner SAP/Tally-like work presentation

### 11.3 Operational Missing

- one authoritative screen-by-screen completion checklist
- one live regression checklist covering:
  - login
  - signup approval
  - menu load
  - lock/unlock
  - idle warning/logout
  - absolute warning/logout
  - session cluster window open/close
  - user scope save
  - role permission update
  - module map change
  - workflow decision save

## 12. What The System Wants Versus What Is Already Done

### 12.1 Wants

- full backend-authoritative ERP
- full keyboard-operated protected workspace
- SA governance fully usable and clean
- ACL semantics correctly enforced at runtime and DB
- menu and session governance never delegated to frontend
- deterministic operator flow

### 12.2 Already Done

- foundational backend architecture
- real admin/ACL/workflow handler families
- core schema layout and migrations
- session/menu cluster backbone
- SA governance frontend rebuild direction
- pagination/shared templates
- post-split security seal migration

### 12.3 Not Done Yet

- full ERP-wide UI rebuild completion
- full proof closure of some backend/ACL semantics
- full state-file closure
- final polish and regression confidence

## 13. Recommended Tomorrow Start Sequence

If tomorrow starts from SA governance completion, this is the clean sequence:

1. finish SA governance visual/polish pass
2. verify every SA governance screen follows one keyboard contract
3. test every SA governance save/filter/list path
4. confirm work area width and pagination consistency
5. reproduce remaining backend errors from UI and label root cause exactly
6. close any remaining SA governance handler/data mismatches
7. then move to non-SA with the same shell/template grammar

Recommended first screens for tomorrow:

- `SARolePermissions`
- `SAApprovalRules`
- `SACompanyModuleMap`
- `SAUserScope`
- `SAUsers`
- `SAUserRoles`

## 14. Bottom-Line Truth

This ERP is not empty and not fake.
It already has real architecture, real handlers, real schema usage, real migrations, and a real frontend rebuild direction.

But it is also not fully complete.

The honest current state is:

- strong backbone exists
- SA governance is significantly advanced
- keyboard-first shell direction is real
- security hardening needed one more post-split seal and that file now exists
- some backend proof and some frontend completion work still remain

This file should be used tomorrow as the execution anchor for:

- SA governance completion
- backend/DB risk verification
- non-SA rollout planning
