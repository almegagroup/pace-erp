# PHASE 3 — IMPLEMENTATION LOG
**Classification:** Live Implementation Record  
**Status:** ✅ COMPLETE — 3-A ✅ 3-B ✅ 3-C ✅ 3-D Backend ✅ 3-D Frontend ✅  
**Last Updated:** 2026-04-20  
**Basis:** PACE_ERP_ARCHITECTURE_PLAN.md + Live codebase audit

---

## OVERVIEW

**Goal:** Type 2 users (multi-company) get Mode B shell with GLOBAL_ACL menu. No shell-switching required.

**Pre-condition:** Phase 0, Phase 1, Phase 2 must be complete before Phase 3-B begins.

**Definition of Done:**
- P0004 logs in → sees global menu → approves leave for CMP005 without switching company
- P0003 logs in → sees same Mode A shell as before → no change
- Company revoked mid-session → next action blocked cleanly → no crash

---

## SUB-PHASE MAP

```
Phase 3-A — Foundation
      ↓
Phase 3-B — Snapshot Infrastructure
      ↓
Phase 3-C — Context Pipeline
      ↓
Phase 3-D — Frontend
```

---

## PHASE 3-A — FOUNDATION

**Status:** ✅ COMPLETE  
**Goal:** Detect operator type at login. Write workspace_mode to session.

### What Changes

| File | Change |
|------|--------|
| `supabase/migrations/20260420100000_phase3a_session_workspace_mode.sql` | Add `workspace_mode` column to `erp_core.sessions` |
| `supabase/functions/api/_core/auth/login.handler.ts` | After primary company resolve → call `listCanonicalCompanyIds()` → count → write `workspace_mode: SINGLE / MULTI` |
| `supabase/functions/api/_core/auth/me_context.handler.ts` | Include `workspace_mode` in GET response |
| `supabase/functions/api/_pipeline/session.ts` | `workspace_mode` added to SELECT + `SessionResolution` type + return |

### Rules
- `workspace_mode` is a **hint only** — never used for ACL or authorization decisions
- Derived fresh at every login from live company count
- No `operator_type` column anywhere — ever

### Design Decision — `is_primary` via SA UI (not migration)
`is_primary` in `erp_map.user_companies` must be set by SA explicitly via UI — not via data migration. Reasons:
- Parent company ≠ department company necessarily (e.g. P0004 parent = CMP006 but works in CMP003)
- Data migrations break on fresh deployments (no business data exists yet)
- SA knows which company is the user's actual primary work company
- Same flow covers both existing users and new users going forward

**This is Phase 3-D scope** — SA user management page → companies list → "Set as Primary" action.

### Verification
- [ ] P0003 logs in → session has `workspace_mode: SINGLE`
- [ ] P0004 logs in → session has `workspace_mode: MULTI`
- [ ] `GET /api/me/context` returns `workspace_mode` in response
- [ ] `is_primary` settable via SA UI (Phase 3-D)

### Intentionally Deferred in This Step
| Item | Reason | Completes In |
|------|--------|-------------|
| `is_primary` set for users | Must be set via SA UI, not data migration | Phase 3-D |
| `rebuildGlobalAclMenuSnapshot()` call in login | Snapshot infrastructure not built yet | Phase 3-B |

### Log
| Date | Action | Result |
|------|--------|--------|
| 2026-04-20 | Migration `20260420100000_phase3a_session_workspace_mode.sql` created | `workspace_mode` column added to `erp_core.sessions` |
| 2026-04-20 | `session.create.ts` — `workspaceMode` param added + inserted | ✅ |
| 2026-04-20 | `login.handler.ts` — `listCanonicalCompanyIds()` imported, company count detects SINGLE/MULTI | ✅ |
| 2026-04-20 | `_pipeline/session.ts` — `workspace_mode` added to SELECT + `SessionResolution` type + return | ✅ |
| 2026-04-20 | `me_context.handler.ts` — `workspace_mode` included in GET response | ✅ |
| 2026-04-20 | `is_primary` data migration approach rejected — moved to SA UI in Phase 3-D | Design decision |

---

## PHASE 3-B — SNAPSHOT INFRASTRUCTURE

**Status:** ✅ COMPLETE  
**Pre-condition:** Phase 1 (capability gate fix) must be complete.  
**Goal:** Build GLOBAL_ACL snapshot at login for Type 2 users. Wire menu handler.

### What Changes

| File | Change |
|------|--------|
| `supabase/functions/api/_shared/acl_runtime.ts` | Add `rebuildGlobalAclMenuSnapshot()` — union of ALLOW decisions across all user companies from `precomputed_acl_view`, keyed by `(session_id, universe = GLOBAL_ACL)` |
| `supabase/functions/api/_core/auth/login.handler.ts` | After `workspace_mode` written → if MULTI → call `rebuildGlobalAclMenuSnapshot()` |
| `supabase/functions/api/_core/auth/menu.handler.ts` | Add `universe = GLOBAL_ACL` branch → route Type 2 users to global snapshot |

### GLOBAL_ACL Snapshot Rules
- Union of ALLOW from `precomputed_acl_view` across ALL user companies
- No `work_context_id` filter — navigation only
- Keyed by `(session_id, universe = GLOBAL_ACL)`
- Invalidated when any contributing company's ACL version changes
- **Never used for authorization decisions** — backend handlers always validate against `precomputed_acl_view`

### Verification
- [ ] P0004 logs in → `GLOBAL_ACL` snapshot built with menus from all 5 companies
- [ ] P0003 logs in → no GLOBAL_ACL snapshot built (SINGLE)
- [ ] Menu handler returns GLOBAL_ACL menus for P0004
- [ ] Menu handler returns ACL menus for P0003 (unchanged)

### Log
| Date | Action | Result |
|------|--------|--------|
| 2026-04-20 | Migration `20260420120000_phase3b_global_acl_universe.sql` — CHECK constraint extended with `GLOBAL_ACL` | ✅ |
| 2026-04-20 | `acl_runtime.ts` — `rebuildGlobalAclMenuSnapshot()` added — union of all companies, dedup by menu_code | ✅ |
| 2026-04-20 | `login.handler.ts` — `workspaceMode` param added to `buildAndStoreMenuSnapshot`, GLOBAL_ACL branch added for MULTI | ✅ |
| 2026-04-20 | `menu.handler.ts` — `workspace_mode` added to `MenuHandlerCtx`, GLOBAL_ACL universe branch added | ✅ |
| 2026-04-20 | `menu.routes.ts` — `workspace_mode: session.workspaceMode` passed to `meMenuHandler` | ✅ |

---

## PHASE 3-C — CONTEXT PIPELINE

**Status:** ✅ COMPLETE  
**Pre-condition:** Phase 3-A complete.  
**Goal:** Type 2 users send company in request body. Context resolves from request, not session.

### What Changes

| File | Change |
|------|--------|
| `supabase/functions/api/_pipeline/context.ts` | Add identity-mode path — if `workspace_mode = MULTI`, `companyId` resolved from request body (`x-company-id` header or body field), not session |
| `supabase/functions/api/_core/auth/me_context.handler.ts` | `POST /api/me/context` for Type 2 — save preference hint only, do NOT trigger menu rebuild |

### Context Resolution Rules for Type 2
- Company comes from request, not session
- Work context resolved per company per request — same logic as Type 1 but company source changes
- `enforceContextInvariants()` must not block undefined companyId for Type 2 shell-level requests
- Transaction handlers (approval, leave, etc.) still validate company access via `user_companies` — no bypass

### Verification
- [ ] P0004 sends request with `company_id: CMP005` in body → context resolves to CMP005
- [ ] P0004 sends request with revoked `company_id: CMP999` → context UNRESOLVED → 403
- [ ] `POST /api/me/context` for P0004 → saves preference, no menu rebuild
- [ ] `POST /api/me/context` for P0003 → behaves same as before

### Log
| Date | Action | Result |
|------|--------|--------|
| 2026-04-20 | `context.ts` — `workspaceMode` added to `PipelineSession` type | ✅ |
| 2026-04-20 | `context.ts` — MULTI path: `x-company-id` header → strict membership validate → `resolveContextForCompany` | ✅ |
| 2026-04-20 | `context.ts` — `resolveContextForCompany()` extracted as shared path for both SINGLE and MULTI | ✅ |
| 2026-04-20 | `runner.ts` — `workspaceMode` passed to `stepContext` from active session | ✅ |
| 2026-04-20 | `me_context.handler.ts` — MULTI users: POST saves preference only, no menu snapshot rebuild | ✅ |

---

## PHASE 3-D — FRONTEND

**Status:** ✅ COMPLETE  
**Pre-condition:** Phase 3-A, 3-B, 3-C all complete.  
**Goal:** Type 2 users see Mode B shell. In-page company selector. Transition hints.

### What Changes

| File | Change |
|------|--------|
| `frontend/src/layout/MenuShell.jsx` | Company/work-context switcher conditional on `workspace_mode`. Type 2 → hide shell company selector, show global menu |
| PAGE_COMPANY_TRANSACTION pages | Add in-page company dropdown — pre-filled + read-only for Type 1, selectable for Type 2 |
| First-time Mode B hint component | One-time dismissible hint on first MULTI session |
| Error handling | If action returns 403 (revoked company) → show message, refresh available companies list |
| SA User Management page | User's company list → "Set as Primary" action → `PATCH /api/admin/users/scope/primary-company` → updates `erp_map.user_companies.is_primary` |

### UI Rules
- Type 1 users: zero visible change
- Type 2 users: no shell company switcher, global menu, in-page company selector per transaction
- SA users: unchanged
- Mode B hint shown once only — dismissible — not shown again
- Company revoked mid-session: next 403 → dropdown refreshes → removed company disappears

### Verification
- [ ] P0004 shell → no company switcher → global menu visible
- [ ] P0003 shell → company switcher present → same as before
- [ ] P0004 opens Approval Inbox → company filter dropdown visible (`* All` default) → filters by specific company → works
- [ ] P0004 approves leave for CMP005 → `x-company-id: CMP005` sent → decision recorded
- [ ] P0004's CMP005 revoked mid-session → next decision → 403 → toast shown → context refreshes → CMP005 disappears from selectors → no crash
- [ ] First login as Type 2 → Mode B hint banner visible → Dismiss clicked → not shown again
- [ ] SA opens user → work companies drawer → sees "Primary" badge on current primary → "Set as Primary" on others → clicks → `is_primary` updates → notice shown → next login default company changes

### Log
| Date | Action | Result |
|------|--------|--------|
| 2026-04-20 | `update_user_scope.handler.ts` — `is_primary` set correctly: parent company in work list → primary, else first work company | ✅ |
| 2026-04-20 | `set_primary_company.handler.ts` — new handler for `PATCH /api/admin/users/scope/primary-company` | ✅ |
| 2026-04-20 | `admin.routes.ts` — route wired | ✅ |
| 2026-04-20 | `frontend/src/store/shellSnapshotCache.js` — `workspaceMode` added to `EMPTY_RUNTIME_CONTEXT` + `normalizeRuntimeContext` | ✅ |
| 2026-04-20 | `frontend/src/context/MenuProvider.jsx` — `workspaceMode` added to `setRuntimeContext` normalization | ✅ |
| 2026-04-20 | `frontend/src/layout/MenuShell.jsx` — `workspaceMode` wired from context API; `showCompanySwitcher` blocks MULTI; Mode B hint (one-time, dismissible, localStorage); `workspaceMode` added to all `setRuntimeContext` calls | ✅ |
| 2026-04-20 | `frontend/src/config/errorMessages.js` (NEW) — central error code → human message map | ✅ |
| 2026-04-20 | `frontend/src/components/inputs/ErpCompanySelector.jsx` (NEW) — keyboard-first component; mode="required" (blank) or mode="all" (* All) | ✅ |
| 2026-04-20 | `frontend/src/pages/dashboard/hr/hrApi.js` — `submitWorkflowDecision` accepts optional `companyId`; passes as `x-company-id` header | ✅ |
| 2026-04-20 | `frontend/src/pages/dashboard/hr/HrWorkflowPages.jsx` — `department` column added; approval inbox MULTI company filter (`*` All default); `x-company-id` passed in decisions; 403 company revoked → toast + context refresh | ✅ |
| 2026-04-20 | `supabase/functions/api/_core/admin/user/get_user_scope.handler.ts` — `is_primary` fetched from `user_companies`; `primary_company_id` exposed in scope response | ✅ |
| 2026-04-20 | `frontend/src/admin/sa/screens/SAUserScope.jsx` — `setPrimaryCompany` API; `primaryWorkCompanyId` state; "Set as Primary" button in work companies drawer; "Primary" badge for current primary | ✅ |

---

## INVARIANTS (Must Never Be Violated)

1. `workspace_mode` is never read by ACL or authorization code
2. GLOBAL_ACL snapshot is navigation only — never used for access decisions
3. Backend always validates company access via live `user_companies` at transaction time
4. Shell change only at next login — never mid-session
5. No `operator_type` or `workspace_mode` column on users table — ever
6. Type 1 user experience must not change at all

---

## FILES — DO NOT TOUCH

| File | Why |
|------|-----|
| `acl.precomputed_acl_view` table structure | Per-company, per-work-context ACL is correct |
| `erp_acl.work_contexts`, `user_work_contexts` | Work context model is correct |
| `supabase/functions/api/_shared/canonical_access.ts` | `listCanonicalCompanyIds()` is exactly right |
| `context.ts:188–203` (x-project-id pattern) | This is the model for Phase 3-C |
| `acl.approver_map` + routing model | Correct approver routing |

---

*Created: 2026-04-20 | Updated: 2026-04-20*
