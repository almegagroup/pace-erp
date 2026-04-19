# PACE ERP — Canonical Architecture Plan
**Classification:** SSOT Product-Architecture Decision Record  
**Status:** Live reference — updated 2026-04-19  
**Basis:** Live codebase audit + DB investigation + confirmed runtime failures + stated business requirements

---

## PART 0 — CURRENT LIVE STATE (DB Investigation 2026-04-19)

### User Roster (CMP003)

| Code | Email | Role | Department | Companies |
|------|-------|------|------------|-----------|
| P0002 | himanshu@almegapaints.com | DIRECTOR | DPT019 @ CMP004 | CMP003,004,005,006,011,012 |
| P0003 | mgr.almegascl@gmail.com | L3_MANAGER | DPT010 @ CMP003 | CMP003 |
| P0004 | scm@almegagroup.in | L1_MANAGER | DPT009 @ CMP003 | CMP003,005,006,011,012 |
| P0005 | scm1@almegagroup.in | L2_USER | DPT009 @ CMP003 | CMP003,005,006,011,012 |
| P0006 | scm2@almegagroup.in | L2_USER | DPT009 @ CMP003 | CMP003,005,006,011,012 |
| P0007 | report.almegascl@gmail.com | L2_AUDITOR | DPT001 @ CMP003 | CMP003 |
| P0008 | billing.almegascl@gmail.com | L1_AUDITOR | DPT001 @ CMP003 | CMP003 |
| P0009 | admixhod.ascl@almegagroup.in | L2_MANAGER | DPT003 @ CMP003 | CMP003 |
| P0010 | commercials.almegagroup@gmail.com | L2_MANAGER | DPT062 @ CMP010 | CMP003,005,006,010,011 |
| P0011 | tanmoy.chowdhury@almegagroup.in | L4_MANAGER | DPT010 @ CMP003 | CMP003,005,006,011,012 |
| P0012 | mntmgr.almegascl@gmail.com | L2_MANAGER | DPT006 @ CMP003 | CMP003 |
| P0013 | rmstores.almegascl@gmail.com | L4_USER | DPT002 @ CMP003 | CMP003 |
| P0014 | stores.ascl@almegagroup.in | L1_MANAGER | DPT002 @ CMP003 | CMP003 |
| P0015 | control.ascl@almegagroup.in | L2_MANAGER | DPT003 @ CMP003 | CMP003 |

### Work Context State (CMP003)

| User | Work Contexts Assigned | Gap |
|------|----------------------|-----|
| P0002 | HR_DIRECTOR (all companies) | No GENERAL_OPS — intentional (director) |
| P0003 | GENERAL_OPS, HR_APPROVER, HR_AUDIT | ❌ No DEPT_DPT010 |
| P0004 | GENERAL_OPS, HR_APPROVER | ❌ No DEPT_DPT009 |
| P0005 | GENERAL_OPS | ❌ No DEPT_DPT009 |
| P0006 | GENERAL_OPS | ❌ No DEPT_DPT009 |
| P0007 | GENERAL_OPS | ❌ No DEPT_DPT001 |
| P0008 | GENERAL_OPS | ❌ No DEPT_DPT001 |
| P0009 | GENERAL_OPS, HR_APPROVER | ❌ No DEPT_DPT003 |
| P0010 | GENERAL_OPS (no capabilities!) | ❌ GENERAL_OPS has no capability in CMP010 |
| P0011 | GENERAL_OPS, HR_APPROVER, HR_AUDIT | ❌ No DEPT_DPT010 |
| P0012 | GENERAL_OPS, HR_APPROVER | ❌ No DEPT_DPT006 |
| P0013 | GENERAL_OPS | ❌ No DEPT_DPT002 |
| P0014 | GENERAL_OPS, HR_APPROVER | ❌ No DEPT_DPT002 |
| P0015 | GENERAL_OPS, HR_APPROVER | ❌ No DEPT_DPT003 |

### DEPT_* Work Contexts in CMP003

| work_context_code | work_context_id | department_id |
|---|---|---|
| DEPT_DPT001 | 4d7c15d9-f4f0-4ecd-ab51-d9ffc0706a56 | d8c6b48c-e5cb-4714-980a-6ee6d2a7f5cd |
| DEPT_DPT002 | e5e40529-a052-4c95-b3c6-0b78d4ed0cd3 | 95acdaa3-c594-4976-8e83-bb69027741c6 |
| DEPT_DPT003 | 65b41258-b2f7-42c8-8df1-8d38cb359c1b | 59e81fc4-3685-44ad-b9c5-ba0d400fdeae |
| DEPT_DPT004 | 49c268c0-dabd-4add-9a0a-b8344a205aa0 | 22cbc292-d733-4594-9e17-4e972680d9ca |
| DEPT_DPT005 | 5f63207e-860d-4e48-9598-eab3fbafe742 | 752da13d-20d3-4274-b0c2-f888d7adf76a |
| DEPT_DPT006 | 89fb53a5-d137-4866-b481-43832f29360a | 070904c8-7308-4026-9dc4-263d0d53f527 |
| DEPT_DPT007 | 243c7077-03ab-4853-8d6c-961ee62f5b26 | 249c48d2-c729-4c41-92e7-f90f80fd8ffd |
| DEPT_DPT008 | 74b74a3f-19f2-4727-ae5a-c83a7142283a | f1094ff5-70cd-4d59-ba4a-37fe3b48a0b8 |
| DEPT_DPT009 | 7dae4025-9459-4cdb-ad3a-35b6968f0d19 | ec694634-aa8d-41d0-bb37-a276861ff4b2 |
| DEPT_DPT010 | 6f688260-27df-4fb8-8ad7-aac06c2f7430 | ff0867d8-ca43-49a9-b61d-0a9ec43f636d |

### Approver Map (CMP003) — Current State

**LEAVE (PRJ001_LEAVE_MODULE):**
- DEPT_DPT009 → P0004 (stage 1)
- DEPT_DPT010 → P0002 + P0011 (stage 1)
- DEPT_DPT002 → P0009 + P0014 + P0015 (stage 1)
- DEPT_DPT003 → P0009 + P0015 (stage 1)
- DEPT_DPT004 → P0009 (stage 1)
- DEPT_DPT006 → P0012 (stage 1)
- DEPT_DPT007 → P0012 (stage 1)
- COMPANY_WIDE → P0003 (stage 1)

**OUTWORK (PRJ001_OUT_WORK_MODULE):**
- DEPT_DPT009 → P0004 (stage 1)
- DEPT_DPT002 → P0009 + P0014 + P0015 (stage 1)
- DEPT_DPT003 → P0009 + P0015 (stage 1)
- DEPT_DPT004 → P0009 (stage 1)
- DEPT_DPT010 → P0002 + P0011 (stage 1)
- COMPANY_WIDE → P0003 (stage 1)

### Key IDs
- CMP003 company_id: `c04f0a8b-ecf0-48ee-becc-174fc377723e`
- P0006 auth_user_id: `712d2a17-8a66-4f61-a027-9f76b0885509`

---

## PART 1 — ARCHITECTURE DECISION (SSOT)

### Three Operator Types

| Type | Who | Company count | Shell mode |
|------|-----|--------------|------------|
| Type 1 — Standard | Works in exactly one company | 1 | Mode A — session-scoped company |
| Type 2 — Central Multi-Company | Works across 2+ companies | > 1 | Mode B — global capability menu, company per-transaction |
| Type 3 — Admin (SA/GA) | System administration | All | Already correct, unchanged |

**Detection rule (runtime, at login):**
```
COUNT(listCanonicalCompanyIds()) == 1  →  Type 1 → Mode A
COUNT(listCanonicalCompanyIds())  > 1  →  Type 2 → Mode B
```

No database flag. No admin action. Pure live count from `erp_map.user_companies`.

### Three Workspace Modes

- **Mode A** — Single-Company Workspace: Shell locked to session company. Current model, correct for Type 1. Unchanged.
- **Mode B** — Multi-Company Operational Workspace: Global capability menu. Company selected in-page per transaction. New.
- **Mode C** — Cross-Company Analytical Workspace: Explicit multi-company selection for aggregated read views. Future.

### Core Rule
> **Global work surface. Local company-scoped execution.**
> The shell shows what the user can do. Each transaction specifies exactly where to do it.

### Operator Type Is Runtime-Derived — Never Permanent

- No `operator_type` column in DB
- Derived fresh at every login
- Changes only when `erp_map.user_companies` changes (company assigned or removed)
- New shell visible only at next login — never mid-session
- Session `workspace_mode` hint (SINGLE/MULTI) is non-authoritative; never used for ACL decisions

---

## PART 2 — MODULE TAXONOMY

Every module belongs to exactly one category:

| Category | Company selection | Context resolution | Use when |
|----------|------------------|--------------------|----------|
| SINGLE_COMPANY_STANDARD | Session company (implicit) | Session-mode | Self-service actions, always own company |
| PAGE_COMPANY_TRANSACTION | In-page dropdown | Request-mode | Central operators acting for specific company |
| CROSS_COMPANY_WORKSPACE | Multi-select filter | Per-company ACL validation | Aggregate reporting, planning |
| SHELL_COMPANY_STRICT | Shell-selected before entering | Session-mode | High-risk irreversible operations |

**Current module assignments:**
| Module | Category |
|--------|----------|
| Leave apply (self) | SINGLE_COMPANY_STANDARD |
| Outwork request (self) | SINGLE_COMPANY_STANDARD |
| HR Approval Inbox | PAGE_COMPANY_TRANSACTION |
| My Requests list | SINGLE_COMPANY_STANDARD |
| Department register / history | PAGE_COMPANY_TRANSACTION |
| PO create (future) | PAGE_COMPANY_TRANSACTION |
| Stock planning (future) | CROSS_COMPANY_WORKSPACE |
| Group reports (future) | CROSS_COMPANY_WORKSPACE |
| Payroll (future) | SHELL_COMPANY_STRICT |
| ACL management | SHELL_COMPANY_STRICT |

---

## PART 3 — WORK CONTEXT DESIGN

### DEPT_* Contexts Are Internal Routing Labels — Not User-Facing

Users never see or select DEPT_* contexts. They are:
- Invisible in the shell
- Resolved automatically by the backend when a workflow request is submitted
- Used exclusively to determine which approver_map rule applies

**Flow:**
```
User (in GENERAL_OPS) → clicks "Apply Leave"
→ backend: user.department = DPT009 → routing context = DEPT_DPT009
→ approver_map: DEPT_DPT009 → P0004
→ workflow created, P0004's inbox updated
```

### Three HR Capability Scopes — Must Never Overlap

| Scope | Capability | Contexts that carry it | What it unlocks |
|-------|-----------|----------------------|-----------------|
| Self-service | CAP_HR_SELF_SERVICE | GENERAL_OPS + all DEPT_* | Leave apply, outwork, personal requests |
| Approver | CAP_HR_APPROVER | HR_APPROVER only | Approval inbox, scope decisions |
| Report/History | CAP_HR_AUDIT_VIEW | HR_AUDIT only | Registers, history, audit views |
| Director | CAP_HR_DIRECTOR | HR_DIRECTOR only | All of the above + director reports |

**GENERAL_OPS must NEVER carry CAP_HR_APPROVER or CAP_HR_AUDIT_VIEW.**

### Self-Approval Rule
`isWorkflowActionableForApprover()` already blocks self-approval (`requesterAuthUserId === authUserId → false`).  
When P0004 applies leave: DEPT_DPT009 → P0004 (blocked by self-rule) + COMPANY_WIDE → P0003 (can approve). ✓

---

## PART 4 — CONFIRMED BUGS

### Bug 1 — ACL role_candidates has no capability gate (CRITICAL)
**File:** `supabase/migrations/20260410130000_gate6_6_18H_acl_version_source_freeze_and_work_context_projection.sql`  
**Effect:** Role-based menu permissions broadcast to ALL work contexts without checking `work_context_capabilities`. GENERAL_OPS gets approver menus. Stale `precomputed_acl_view` data persists.  
**Fix (Phase 1):** Add `work_context_capabilities` join to `role_candidates` CTE. Truncate + regenerate all active ACL snapshots.

### Bug 2 — DEPT_* contexts never provisioned for existing users (CRITICAL)
**File:** `supabase/functions/api/_shared/work_context_governance.ts` → `ensureGeneralOpsWorkContext()`  
**Effect:** Every user with a department gets `HR_REQUESTER_SCOPE_DEPARTMENT_CONTEXT_MISSING` when trying to apply leave or outwork.  
**Fix (Phase 2):** Extend provisioning to create DEPT_* contexts per identity department. Backfill all existing users.

### Bug 3 — `role_capabilities` table is empty
**Effect:** Capability-based ACL path (Path A) is completely dead. All menus come from role_menu_permissions only.  
**Fix (Phase 1):** Populate `acl.role_capabilities` for all roles.

### Bug 4 — `is_primary = false` for all user_companies rows
**Effect:** `resolveCompanyId()` picks an arbitrary company when no `selected_company_id` in session.  
**Fix (Phase 3):** Set correct `is_primary = true` for each user's home company.

---

## PART 5 — PHASE PLAN

### Phase 0 — Alim Hotfix (Do Now, SA Console)

**Problem:** P0006 cannot apply leave because DEPT_DPT009 is missing from their `user_work_contexts`.

**Same problem affects:** P0004, P0005 (DPT009), P0003, P0011 (DPT010), P0007, P0008 (DPT001), P0009, P0015 (DPT003), P0012 (DPT006), P0013, P0014 (DPT002).

**Fix SQL:**
```sql
INSERT INTO erp_acl.user_work_contexts (auth_user_id, company_id, work_context_id, is_primary)
SELECT u.auth_user_id, 'c04f0a8b-ecf0-48ee-becc-174fc377723e', mapping.work_context_id, false
FROM (VALUES
  ('P0003', '6f688260-27df-4fb8-8ad7-aac06c2f7430'),  -- DPT010
  ('P0004', '7dae4025-9459-4cdb-ad3a-35b6968f0d19'),  -- DPT009
  ('P0005', '7dae4025-9459-4cdb-ad3a-35b6968f0d19'),  -- DPT009
  ('P0006', '7dae4025-9459-4cdb-ad3a-35b6968f0d19'),  -- DPT009
  ('P0007', '4d7c15d9-f4f0-4ecd-ab51-d9ffc0706a56'),  -- DPT001
  ('P0008', '4d7c15d9-f4f0-4ecd-ab51-d9ffc0706a56'),  -- DPT001
  ('P0009', '65b41258-b2f7-42c8-8df1-8d38cb359c1b'),  -- DPT003
  ('P0011', '6f688260-27df-4fb8-8ad7-aac06c2f7430'),  -- DPT010
  ('P0012', '89fb53a5-d137-4866-b481-43832f29360a'),  -- DPT006
  ('P0013', 'e5e40529-a052-4c95-b3c6-0b78d4ed0cd3'),  -- DPT002
  ('P0014', 'e5e40529-a052-4c95-b3c6-0b78d4ed0cd3'),  -- DPT002
  ('P0015', '65b41258-b2f7-42c8-8df1-8d38cb359c1b')   -- DPT003
) AS mapping(user_code, work_context_id)
JOIN erp_core.users u ON u.user_code = mapping.user_code
ON CONFLICT DO NOTHING;
```

**Expected result:** 12 rows inserted. All CMP003 departmental users can now apply leave.

---

### Phase 1 — ACL Fix (Before Any New Module)

**Goal:** Fix menu leakage. GENERAL_OPS must not show approver/audit menus.

**Step 1 — Fix role_candidates CTE in generate_acl_snapshot**

In `generate_acl_snapshot`, `role_candidates` CTE must join `work_context_capabilities` so role permissions only apply to work contexts that explicitly carry the matching capability.

Current (wrong):
```sql
role_candidates: role_menu_permissions → broadcast to all user work contexts
```

Target:
```sql
role_candidates: role_menu_permissions → only work contexts WHERE work_context has matching capability
```

New migration file: `20260420_phase1_acl_capability_gate.sql`

**Step 2 — Populate acl.role_capabilities**

`role_capabilities` is empty — capability path (Path A) is dead. Populate it for all roles. Specific capability assignments to be designed per role.

**Step 3 — Force regenerate all ACL snapshots**

After the migration:
```sql
-- Clear stale data
TRUNCATE acl.precomputed_acl_view;

-- Regenerate for all active company versions
SELECT acl.generate_acl_snapshot(acl_version_id, company_id)
FROM acl.acl_versions
WHERE status = 'ACTIVE';
```

**Step 4 — Clear stale menu snapshots**

```sql
DELETE FROM erp_cache.session_menu_snapshot
WHERE universe = 'ACL';
```

Users will get correct menus on next page load.

---

### Phase 2 — Provisioning Fix (Before Any New Module)

**Goal:** No user should ever hit `HR_REQUESTER_SCOPE_DEPARTMENT_CONTEXT_MISSING` again.

**Step 1 — Extend `ensureGeneralOpsWorkContext()`**

File: `supabase/functions/api/_shared/work_context_governance.ts`

Extend to also call `ensureDepartmentWorkContext()` for each row in `erp_map.user_departments` for the user at the given company. This must be atomic — GENERAL_OPS + all DEPT_* contexts created together.

**Step 2 — Hook into department assignment**

When a department is assigned to a user in the provisioning flow, trigger context creation immediately.

**Step 3 — Add graceful degradation to `resolveRequesterSubjectWorkContext()`**

File: `supabase/functions/api/_core/hr/shared.ts:908`

Instead of throwing `HR_REQUESTER_SCOPE_DEPARTMENT_CONTEXT_MISSING`, return a structured result so the HR handler shows a user-friendly message: "Your department workspace is not set up. Contact HR administration."

Log as a provisioning alert, not a user-facing error.

---

### Phase 3 — Multi-Company Surface (Before Multi-Company Modules)

**Goal:** Type 2 users get Mode B shell with GLOBAL_ACL menu. No shell-switching required.

**Step 1 — Operator type detection at login**

File: `supabase/functions/api/_core/auth/login.handler.ts`

After resolving the primary company, call `listCanonicalCompanyIds()` and count results. Write `workspace_mode: 'SINGLE' | 'MULTI'` to the session record.

**Step 2 — GLOBAL_ACL snapshot generation**

File: `supabase/functions/api/_shared/acl_runtime.ts`

Add `rebuildGlobalAclMenuSnapshot()`:
- Union of ALLOW decisions across all user companies from `precomputed_acl_view`
- No `work_context_id` filter
- Keyed by `(session_id, universe = 'GLOBAL_ACL')`
- Invalidated when any contributing company's ACL version changes

**Step 3 — Menu handler GLOBAL_ACL branch**

File: `supabase/functions/api/_core/auth/menu.handler.ts`

Add `universe = 'GLOBAL_ACL'` branch. Route Type 2 users to global snapshot.

**Step 4 — `me_context` handler demotion**

File: `supabase/functions/api/_core/auth/me_context.handler.ts`

`POST /api/me/context` for Type 2 users: save preference hint only. Do NOT trigger menu rebuild.

**Step 5 — `stepContext()` identity mode**

File: `supabase/functions/api/_pipeline/context.ts`

Add identity-mode path where `companyId` can be `undefined` for Type 2 shells. Transaction handlers receive company from request body, not session.

**Step 6 — Frontend shell update**

File: `frontend/src/layout/MenuShell.jsx`

Make company/work-context switcher conditional on `workspace_mode`. Type 2 users: hide shell company selector, show global menu.

**Step 7 — Fix is_primary for all users**

```sql
-- Set is_primary = true for each user's home company
-- (Run after identifying correct primary company per user)
UPDATE erp_map.user_companies
SET is_primary = true
WHERE (auth_user_id, company_id) IN (
  -- map each user to their correct primary company
);
```

---

### Phase 4 — Module-by-Module Transaction Migration

**Goal:** Migrate specific modules to PAGE_COMPANY_TRANSACTION mode.

Order of migration:
1. HR Approval Inbox (high value for multi-company approvers)
2. Department register / history view
3. Outwork (when multi-company outwork is needed)
4. PO create (when procurement module is built)

Each migration: add in-page company context bar, switch from session-mode to request-mode context resolution. Type 1 users see company pre-filled and read-only — no change for them.

---

## PART 6 — FILE IMPACT MAP

### Must Change

| File | Problem | What changes |
|------|---------|-------------|
| `supabase/migrations/20260410130000_*18H*` | role_candidates no capability gate | Add work_context_capabilities join |
| `supabase/functions/api/_pipeline/context.ts` | enforceContextInvariants blocks Type 2 | Add identity-mode path |
| `supabase/functions/api/_shared/acl_runtime.ts` | No GLOBAL_ACL snapshot path | Add rebuildGlobalAclMenuSnapshot() |
| `supabase/functions/api/_core/auth/me_context.handler.ts` | POST triggers menu rebuild for all | Make rebuild conditional on workspace_mode |
| `supabase/functions/api/_core/auth/menu.handler.ts` | No GLOBAL_ACL universe branch | Add GLOBAL_ACL branch |
| `supabase/functions/api/_shared/work_context_governance.ts` | Only creates GENERAL_OPS | Extend to create DEPT_* contexts |
| `supabase/functions/api/_core/auth/login.handler.ts` | No operator type detection | Count companies, write workspace_mode |
| `frontend/src/layout/MenuShell.jsx` | Company switcher always shown | Conditional on workspace_mode |

### Preserve — Do Not Touch

| File | Why preserved |
|------|--------------|
| `acl.precomputed_acl_view` (table structure) | Per-company, per-work-context ACL is correct |
| `erp_acl.work_contexts`, `user_work_contexts` | Work context model is correct |
| `supabase/functions/api/_shared/workflow_scope.ts` | All type guards correct |
| `supabase/functions/api/_shared/canonical_access.ts` | listCanonicalCompanyIds() is exactly right |
| `supabase/functions/api/_core/hr/shared.ts:808–947` | resolveRequesterSubjectWorkContext() architecture correct |
| `acl.workflow_requests` + routing model | Correct approver routing |
| `context.ts:188–203` (x-project-id pattern) | This IS the model for Phase 3 |

---

## PART 7 — INVARIANTS (Must Never Be Violated)

1. **GENERAL_OPS never submits a workflow request.** It is a navigation context, not an execution context.
2. **Every user with a department must have the matching DEPT_* work context before any HR flow is accessible.** Enforced at provisioning time.
3. **Self-approval is blocked.** `isWorkflowActionableForApprover()` already enforces this — do not remove.
4. **ACL enforcement is always per-company at transaction time.** The global menu is navigation only — it never grants access.
5. **GLOBAL_ACL snapshot is never used for authorization decisions.** Backend handlers always validate against `precomputed_acl_view`.
6. **Module taxonomy category is set at design time and never changed at runtime.** A module does not change from SINGLE_COMPANY_STANDARD to PAGE_COMPANY_TRANSACTION based on who is logged in.
7. **Session workspace_mode is a hint, not an enforcement field.** Never read by ACL or authorization code.
8. **Operator type has no persistent representation.** Never add operator_type or workspace_mode as an enforcing column on users or sessions.

---

## PART 8 — MIGRATION ORDER GATE

```
Phase 0 (Alim hotfix SQL)
    ↓
Phase 1 (ACL bug fix migration)
    ↓
Phase 2 (Provisioning invariant)
    ↓  ← GATE: No new module built before this point
Phase 3 (Operator type + GLOBAL_ACL)
    ↓  ← GATE: No multi-company module designed before this point
Phase 4 (Module-by-module transaction migration)
```

**Phase 1 and 2 must be complete before any new module is built.**  
**Phase 3 must be complete before any PAGE_COMPANY_TRANSACTION or CROSS_COMPANY_WORKSPACE module is designed.**

---

*Last updated: 2026-04-19 | Based on live DB audit of CMP003 production data*
