## LAYER-0 — FILE & FOLDER INVENTORY
Scope: Physical presence only (no logic analysis)

### 0.1 Backend (Supabase)

Path: supabase/functions/api/

/SUPABASE
ª   .gitignore
ª   config.toml
ª   functions.zip
ª   migrations.zip
ª   
+---.branches
ª       _current_branch
ª       
+---.temp
ª       cli-latest
ª       gotrue-version
ª       pooler-url
ª       postgres-version
ª       project-ref
ª       rest-version
ª       storage-migration
ª       storage-version
ª       
+---functions
ª   +---api
ª       ª   .gitkeep
ª       ª   index.ts
ª       ª   
ª       +---_acl
ª       ª       acl_resolver.ts
ª       ª       decision_trace.ts
ª       ª       vwed_engine.ts
ª       ª       
ª       +---_core
ª       ª   ª   health.ts
ª       ª   ª   response.ts
ª       ª   ª   
ª       ª   +---admin
ª       ª   ª   +---acl
ª       ª   ª   ª       assign_capability_to_role.handler.ts
ª       ª   ª   ª       disable_company_module.handler.ts
ª       ª   ª   ª       disable_role_permission.handler.ts
ª       ª   ª   ª       enable_company_module.handler.ts
ª       ª   ª   ª       list_capabilities.handler.ts
ª       ª   ª   ª       list_company_modules.handler.ts
ª       ª   ª   ª       list_role_capabilities.handler.ts
ª       ª   ª   ª       list_role_permissions.handler.ts
ª       ª   ª   ª       unassign_capability_from_role.handler.ts
ª       ª   ª   ª       upsert_capability.handler.ts
ª       ª   ª   ª       upsert_role_permission.handler.ts
ª       ª   ª   ª       
ª       ª   ª   +---company
ª       ª   ª   ª       create_company.handler.ts
ª       ª   ª   ª       update_company_state.handler.ts
ª       ª   ª   ª       
ª       ª   ª   +---department
ª       ª   ª   ª       create_department.handler.ts
ª       ª   ª   ª       
ª       ª   ª   +---group
ª       ª   ª   ª       create_group.handler.ts
ª       ª   ª   ª       map_company_to_group.handler.ts
ª       ª   ª   ª       unmap_company_group.handler.ts
ª       ª   ª   ª       update_group_state.handler.ts
ª       ª   ª   ª       
ª       ª   ª   +---project
ª       ª   ª   ª       create_project.handler.ts
ª       ª   ª   ª       list_projects.handler.ts
ª       ª   ª   ª       update_project_state.handler.ts
ª       ª   ª   ª       
ª       ª   ª   +---signup
ª       ª   ª   ª       approve.handler.ts
ª       ª   ª   ª       list_pending.handler.ts
ª       ª   ª   ª       reject.handler.ts
ª       ª   ª   ª       
ª       ª   ª   +---user
ª       ª   ª       ª   list_users.handler.ts
ª       ª   ª       ª   update_user_role.handler.ts
ª       ª   ª       ª   update_user_state.handler.ts
ª       ª   ª       ª   
ª       ª   ª       +---_guards
ª       ª   ª               self_lockout.guard.ts
ª       ª   ª               
ª       ª   +---auth
ª       ª   ª   ª   accountState.ts
ª       ª   ª   ª   authClient.ts
ª       ª   ª   ª   authDelegate.ts
ª       ª   ª   ª   credentialGuards.ts
ª       ª   ª   ª   identifierResolver.ts
ª       ª   ª   ª   login.handler.ts
ª       ª   ª   ª   logout.handler.ts
ª       ª   ª   ª   me.handler.ts
ª       ª   ª   ª   menu.handler.ts
ª       ª   ª   ª   
ª       ª   ª   +---signup
ª       ª   ª           signup.handler.ts
ª       ª   ª           
ª       ª   +---me
ª       ª   +---session
ª       ª           session.admin_revoke.ts
ª       ª           session.cookie.ts
ª       ª           session.create.ts
ª       ª           session.types.ts
ª       ª           
ª       +---_lib
ª       ª       logger.ts
ª       ª       request_id.ts
ª       ª       
ª       +---_pipeline
ª       ª       acl.ts
ª       ª       context.ts
ª       ª       cors.ts
ª       ª       csrf.ts
ª       ª       rate_limit.ts
ª       ª       runner.ts
ª       ª       session.ts
ª       ª       session_lifecycle.ts
ª       ª       step_headers.ts
ª       ª       
ª       +---_security
ª       ª       csp.ts
ª       ª       human_verification.ts
ª       ª       security_headers.ts
ª       ª       
ª       +---_shared
ª               applyflow_client.ts
ª               context_headers.ts
ª               env.ts
ª               gst_profile.service.ts
ª               gst_resolver.ts
ª               index.ts
ª               rls_assert.ts
ª               role_ladder.ts
ª               serviceRoleClient.ts

### 0.2 Frontend

Path: frontend/

/frontend/src/admin
/frontend/src/assets
/frontend/src/context
/frontend/src/layout
/frontend/src/navigation
/frontend/src/router
/frontend/src/App.css
/frontend/src/App.jsx
/frontend/src/index.css
/frontend/src/main.jsx
/frontend/src/admin\ga
/frontend/src/admin\sa
/frontend/src/admin\adminEntryGuard.js
/frontend/src/admin\ga\GADashboardShell.jsx
/frontend/src/admin\sa\SADashboardShell.jsx
/frontend/src/assets\react.svg
/frontend/src/context\MenuContext.js
/frontend/src/context\MenuProvider.jsx
/frontend/src/context\useMenu.js
/frontend/src/layout\HiddenRouteRedirect.jsx
/frontend/src/layout\MenuShell.jsx
/frontend/src/navigation\backGuardEngine.js
/frontend/src/navigation\backValidation.js
/frontend/src/navigation\keyboardAclBridge.js
/frontend/src/navigation\keyboardIntentEngine.js
/frontend/src/navigation\keyboardIntentMap.js
/frontend/src/navigation\navigationEventLogger.js
/frontend/src/navigation\navigationPersistence.js
/frontend/src/navigation\screenRegistry.js
/frontend/src/navigation\screenRules.js
/frontend/src/navigation\screenStackEngine.js
/frontend/src/navigation\screenStackInvariant.js
/frontend/src/router\AppRouter.jsx
/frontend/src/router\DeepLinkGuard.jsx
/frontend/src/router\RouteGuard.jsx
/frontend/src/router\routeIndex.js

### 0.3 Database / Migrations

Path: supabase/migrations/

migrations
        .gitkeep
        20260122101000_gate0_0_6_create_erp_schemas.sql
        20260122102000_gate0_0_6B_enable_rls_globally.sql
        20260122103000_gate0_0_6C_default_deny_policies.sql
        20260122104000_gate0_0_6D_service_role_bypass.sql
        20260122105000_gate0_0_6E_anon_authenticated_lockdown.sql
        20260123101000_gate4_4_1_create_erp_users.sql
        20260123102000_gate4_4_1D_create_signup_requests.sql
        20260123103000_gate4_4_2A_user_code_p_sequence.sql
        20260123104000_gate4_4_2B_create_signup_approval_audit.sql
        20260126101000_gate4_4_2A_signup_requests_and_user_code_fn.sql
        20260126120000_gate5_5_7_rls_context_header_helpers.sql
        20260126121000_gate5_5_7A_rls_policy_templates.sql
        20260126130000_gate6_6_2_create_company_master.sql
        20260126131000_gate6_6_2A_company_code_generator.sql
        20260126134000_gate6_6_3_1_create_gst_cache.sql
        20260126135000_gate6_6_2A_company_state_rules.sql
        20260126136000_gate6_6_3_create_project_master.sql
        20260126137000_gate6_6_3A_project_state_and_code.sql
        20260126138000_gate6_6_4_create_department_master.sql
        202602012639000_gate6_6_4A_department_state_and_code.sql
        20260211101000_gate6_6_5_create_company_project_map.sql
        20260211102000_gate6_6_5A_company_project_invariants.sql
        20260211103000_gate6_6_6_create_user_company_map.sql
        20260211104000_gate6_6_6A_primary_company_rule.sql
        20260211105000_gate6_6_7_create_user_project_map.sql
        20260211106000_gate6_6_7A_user_project_subset_rule.sql
        20260211107000_gate6_6_8_create_user_department_map.sql
        20260211108000_gate6_6_8A_department_scope_rule.sql
        20260220101000_gate6_6_9A_create_menu_master.sql
        20260220102000_gate6_6_9A_create_menu_tree.sql
        20260220103000_gate6_6_9A_create_menu_actions.sql
        20260220104000_gate6_6_9_create_role_menu_permissions.sql
        20260220105000_gate6_6_10_create_capabilities.sql
        20260220106000_gate6_6_10_create_capability_menu_actions.sql
        20260220107000_gate6_6_10_create_role_capabilities.sql
        20260220108000_gate6_6_10A_create_capability_precedence_rules.sql
        20260221102000_gate6_6_11_create_company_modules.sql
        20260221103000_gate6_6_11A_create_module_hard_deny_rules.sql
        20260222101000_gate6_6_12_create_user_overrides.sql
        20260222102000_gate6_6_12A_create_user_override_audit.sql
        20260222103000_gate6_6_13_create_approver_map.sql
        20260222104000_gate6_6_13A_create_approver_invariants.sql
        20260224100000_gate3_3_1_create_erp_sessions.sql
        20260224101000_gate6_6_6_create_user_roles.sql
        20260224102000_gate6_6_6A_create_user_company_roles.sql
        20260301101000_gate6_6_18_create_acl_versions.sql
        20260301102000_gate6_6_18A_create_precomputed_acl_view.sql
        20260302101000_gate6_6_19_bind_acl_to_rls.sql
        20260302102000_gate6_6_19A_rls_deny_fallback.sql
        20260305101000_gate7_7_1_create_menu_master.sql
        20260305102000_gate7_7_1A_menu_invariants.sql
        20260305103000_gate7_7_2_create_menu_tree.sql
        20260305104000_gate7_7_2A_menu_tree_invariants.sql
        20260306101000_gate7_7_3_create_menu_snapshot.sql
        20260306102000_gate7_7_3A_menu_snapshot_refresh_rules.sql
        20260315100500_gate9_9_2_company_master_assertions.sql
        20260315101000_gate9_9_2A_company_delete_constraints.sql
        20260315102000_gate9_9_3_create_group_master.sql
        20260315103000_gate9_9_3A_create_company_group_map.sql
        20260315104000_gate9_9_3B_group_delete_constraints.sql

### 0.4 Docs

Path: docs/

PACE-ERP\DOCS
    ACL_SSOT.md
    DB_RLS_PHILOSOPHY.md
    FILE_HEADER_STANDARD.md
    GATE_0_FREEZE.md
    GATE_1_FREEZE.md
    GATE_2_AUTH_BOUNDARY.md
    GATE_2_FREEZE.md
    GATE_3_FREEZE.md
    GATE_4_FREEZE.md
    GATE_4_ID_4_USER_LIFECYCLE.md
    GATE_5_FREEZE.md
    GATE_6_FREEZE.md
    GATE_6_G0_ACL_AUTHORITY_LOCK.md
    GATE_6_G1_ROLE_SYSTEM.md
    GATE_7_FREEZE.md
    GATE_7_MENU_AUTHORITY.md
    GATE_8_FREEZE.md
    GATE_8_G0_NAVIGATION_AUTHORITY_LOCK.md
    GATE_8_G1_SCREEN_REGISTRY.md
    GATE_9_G0_ADMIN_UNIVERSE_AUTHORITY_LOCK.md
    HEADER_ENFORCEMENT_RULE.md
    pace_erp_roles_responsibilities_charter.md
    PACE_ERP_STATE.md
    PACE_ERP_STATUS_CONSOLIDATED.md
    PACE_ERP_SYSTEM_MAP.md
    SSOT.md
    
No subfolders exist 

## LAYER-1A — CONTENT INDEX
Scope: What each file claims to do (no wiring judgement)

| File Path | File-ID | Gate | Declared Purpose | Key Responsibilities |
|----------|--------|------|------------------|---------------------|

| supabase/functions/api/index.ts | 1A | Gate-1 | Single backend entry | RequestId generate, health route, preflight, pipeline invoke, security headers |

XRAY · Layer-1A · Backend Entry Surface

File: api/index.ts
- exports: default handler(req)
- imports:
  - log
  - generateRequestId
  - handleHealth
  - runPipeline
  - applySecurityHeaders
  - applyCSP
  - applyCORS
  - handlePreflight
  - errorResponse
- short-circuit:
  - GET /health
  - CORS preflight
- main path:
  - runPipeline(req, requestId)
- response wrapping:
  - CORS → SecurityHeaders → CSP
- error envelope:
  - structured log
  - action mapping

| supabase/functions/api/_pipeline/runner.ts | 1A | Gate-1 | Pipeline executor | Route detect, public/protected split, session→context→ACL→handler dispatch |

XRAY · Layer-1A · Pipeline Orchestrator Index

File: _pipeline/runner.ts
- exports: runPipeline(req, requestId)
- defines:
  - PUBLIC_ROUTES set
  - enforceSessionLogout helper
- stages indexed:
  - headers
  - cors
  - csrf
  - rate_limit
  - session
  - lifecycle
  - context
  - acl
- handler surface:
  - public routes (auth)
  - protected routes (admin, menu, acl)
- resolution mechanism:
  - routeKey switch

| supabase/functions/api/_pipeline/session.ts | 2.2C | Gate-2 | Session resolution | Read cookie, lookup erp_core.sessions, ACTIVE/REVOKED/EXPIRED decision |

XRAY · Layer-1A · Session Step Index

File: _pipeline/session.ts
- exports:
  - stepSession(req, requestId)
  - SessionResolution (type)
- helpers:
  - readCookie()
- cookie used:
  - erp_session
- DB surface:
  - table: erp_core.sessions
  - fields: auth_user_id, state
- possible outcomes:
  - ABSENT
  - ACTIVE
  - REVOKED
  - EXPIRED

  | supabase/functions/api/_pipeline/session_lifecycle.ts | 3.x | Gate-3 | Session lifecycle | Idle warning, idle expiry, TTL expiry, no mutation |

  XRAY · Layer-1A · Session Lifecycle Index

File: _pipeline/session_lifecycle.ts
- exports:
  - enforceIdleLifecycle(session, now)
  - SessionLifecycleResult (type)
- helpers:
  - isDeviceChanged()
- inputs expected on session ctx:
  - created_at (future)
  - last_activity_at (future)
  - device_id (optional)
  - previous_device_id (optional)
- possible lifecycle outcomes:
  - ACTIVE (pass-through)
  - IDLE_WARNING
  - IDLE_EXPIRED
  - TTL_EXPIRED

| supabase/functions/api/_pipeline/context.ts | 5.x | Gate-5 | Context resolver | Company/project/department resolution, admin bypass, invariants |

XRAY · Layer-1A · Context Index

File: _pipeline/context.ts

Exports:
- stepContext(req, session)
- ContextResolution (type)
- PipelineSession (type)

DB dependencies:
- RPC: erp_map.get_primary_company
- Table: erp_map.user_company_roles
- Table: erp_map.user_projects
- Table: erp_map.user_departments

Headers consumed:
- x-project-id (optional)
- x-department-id (optional)

Special paths:
- Admin universe override → companyId = "ADMIN_UNIVERSE"

| supabase/functions/api/_pipeline/acl.ts | 6.x | Gate-6 | ACL adapter | Input sanity, call resolveAcl, ALLOW/DENY decision |

XRAY · Layer-1A · ACL Index

File: _pipeline/acl.ts

Exports:
- stepAcl(...)
- AclDecision (type)

External dependency:
- resolveAcl() from _acl/acl_resolver.ts

Inputs required to allow evaluation:
- context.state === "RESOLVED"
- authUserId
- companyId
- resourceCode
- action
- moduleEnabled

Fail-safe behavior:
- Any ambiguity → DENY
- Empty permission arrays passed to resolver

## LAYER-1B — WIRING REALITY
Scope: Actual data flow & dependencies (no verdict)

| File Path | Receives From | Sends To | External Dependencies | Assumptions / Symbols | Breaks If Missing |
|-----------|---------------|----------|------------------------|------------------------|-------------------|
| supabase/functions/api/index.ts |
| Receives From | HTTP Request |
| Sends To | runPipeline(req, requestId) |
| External Dependencies | _pipeline/runner.ts, security_headers.ts, csp.ts, cors.ts |
| Assumptions / Symbols | requestId generator always available |
| Breaks If Missing | runner.ts export |

| supabase/functions/api/_pipeline/runner.ts |
| Receives From | index.ts |
| Sends To | stepHeaders → stepCors → stepCsrf → stepRateLimit → stepSession → enforceIdleLifecycle → stepContext → stepAcl → handler |
| External Dependencies | all _pipeline steps + _core handlers |
| Assumptions / Symbols | routeKey matches handler; PUBLIC_ROUTES defined |
| Breaks If Missing | any step export / handler mapping |

| supabase/functions/api/_pipeline/session.ts |
| Receives From | runner.ts |
| Sends To | SessionResolution |
| External Dependencies | erp_core.sessions table |
| Assumptions / Symbols | cookie name = erp_session |
| Breaks If Missing | sessions table / RLS bypass |

| supabase/functions/api/_pipeline/session_lifecycle.ts |
| Receives From | runner.ts (SessionResolution) |
| Sends To | SessionLifecycleResult |
| External Dependencies | none (pure) |
| Assumptions / Symbols | created_at, last_activity_at exist in future |
| Breaks If Missing | lifecycle fields (no-op paths) |

| supabase/functions/api/_pipeline/context.ts |
| Receives From | runner.ts (authUserId) |
| Sends To | ContextResolution |
| External Dependencies | RPC erp_map.get_primary_company; mapping tables |
| Assumptions / Symbols | admin bypass uses roleCode |
| Breaks If Missing | mapping tables / role binding |

| supabase/functions/api/_pipeline/acl.ts |
| Receives From | runner.ts (context + route) |
| Sends To | AclDecision |
| External Dependencies | resolveAcl() |
| Assumptions / Symbols | permissions arrays empty (symbolic) |
| Breaks If Missing | resourceCode/action/moduleEnabled |



