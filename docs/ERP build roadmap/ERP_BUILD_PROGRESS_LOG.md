# ERP Build Progress Log

Purpose:
This file records the execution progress of the Full ERP Build Roadmap.

Roadmap source:
FULL_ERP_BUILD_ROADMAP.md

Working rule:
After every meaningful roadmap step, this log must be updated.

---

# 1. Status Legend

- PENDING
- IN PROGRESS
- BLOCKED
- COMPLETED
- DEFERRED

---

# 2. Baseline Entry

Date:
2026-03-26

Program state:
Started

Baseline summary:
- public auth flow is stable
- protected shell is stable
- session lifecycle is stabilized
- workspace lock is stabilized
- locked refresh logout is working
- same-browser single-tab enforcement is working
- SA shell exists
- ERP build-up phase now begins

Current roadmap position:
Step 1 complete
Step 2 next

Immediate next focus:
SA Dashboard Information Architecture

---

# 3. Active Step Tracker

Current active step:
Step 2 - SA Dashboard Information Architecture

Current status:
IN PROGRESS

Goal of this step:
Define the full SA control-panel structure and route map
for the ERP build program.

Completion target:
- SA navigation sections declared
- SA screen inventory declared
- route ownership declared
- no orphan SA screen remains

---

# 4. Decision Log

## Decision 001

Date:
2026-03-26

Decision:
The next major program is SA-led full ERP build-up.

Reason:
Security and session foundations are now stable enough
to move from bootstrap stabilization into ERP control-plane execution.

Impact:
Work now shifts from auth and shell hardening
to SA governance, org masters, user governance,
ACL governance, menu governance, workflow governance,
and module rollout readiness.

## Decision 002

Date:
2026-03-26

Decision:
All future roadmap execution must follow the existing repo writing standard.

Reason:
The codebase already uses recognizable patterns for headers,
authority tags, purpose declaration, migration naming,
and implementation structure.

Impact:
Future scripts, handlers, frontend files, docs, and migration files
must be written in the same repository style instead of introducing
new inconsistent formats.

---

# 5. Execution Entries

Use this section to append all future progress updates.

## Entry Template

Date:
YYYY-MM-DD

Roadmap step:
Step X - Title

Status:
PENDING / IN PROGRESS / BLOCKED / COMPLETED / DEFERRED

What was done:
- item
- item
- item

What changed in repo:
- file
- file
- file

What was verified:
- item
- item

Problems or blockers:
- item
- item

Decision or note:
Short explanation

Next step:
Step X - Title

---

## Entry 002

Date:
2026-03-26

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- inventoried current SA frontend screens
- inventoried current SA route map
- inventoried existing backend admin capability surface
- defined the target SA control-plane section map

What changed in repo:
- docs/ERP build roadmap/FULL_ERP_BUILD_ROADMAP.md
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- frontend SA currently exposes only a small route surface
- backend admin routes already support a broader control plane
- Step 2 can now proceed from real inventory instead of assumptions

Problems or blockers:
- frontend SA information architecture is incomplete compared to backend admin capability
- route and screen ownership still need final concrete screen-by-screen build sequence

Decision or note:
The first practical roadmap move is to finish the SA control-plane map
before expanding org masters and user governance screens.

Next step:
Finalize the exact SA screen-by-screen build sequence for Command Center,
Onboarding and User Governance, and Org Masters

## Entry 003

Date:
2026-03-26

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- finalized the functional contract of /sa/control-panel
- mapped the control panel to the existing backend diagnostics endpoint
- declared the control panel blocks and linked SA launch surfaces

What changed in repo:
- docs/ERP build roadmap/FULL_ERP_BUILD_ROADMAP.md
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- GET /api/admin/control-panel already exists
- system-health, sessions, audit, users, and signup surfaces can be linked from this screen

Problems or blockers:
- pending signup count is not yet part of the control-panel endpoint payload
- some linked SA routes still need dedicated frontend screens

Decision or note:
/sa/control-panel will be the SA command center and the first real screen
to build under the roadmap execution program.

Next step:
Implement /sa/control-panel screen and wire it to the existing admin control panel endpoint

## Entry 004

Date:
2026-03-26

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- implemented SA Control Panel screen
- wired the screen to admin diagnostics endpoints
- added screen registry entry for SA control panel
- added route wiring for /sa/control-panel
- added SA Home quick launch to the control panel
- added temporary core admin route fallback so the new screen is reachable during this phase

What changed in repo:
- frontend/src/admin/sa/screens/SAControlPanel.jsx
- frontend/src/router/AppRouter.jsx
- frontend/src/navigation/screens/adminScreens.js
- frontend/src/admin/sa/screens/SAHome.jsx
- frontend/src/router/routeIndex.js

What was verified:
- /sa/control-panel screen exists in route map
- SA Home can open the control panel
- control panel reads from /api/admin/control-panel
- control panel reads from /api/admin/system-health

Problems or blockers:
- full sessions, audit, and system-health dedicated SA screens are not built yet
- admin menu snapshot governance for the new route is not yet formalized at menu-control-plane level

Decision or note:
The SA command center is now the first real roadmap-built screen
for the ERP control plane.

Next step:
Build the next SA command-center linked surfaces beginning with session control or user governance

## Entry 005

Date:
2026-03-26

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- implemented the SA Sessions screen
- wired full session list consumption from the admin session endpoint
- added session status filtering
- added refresh action
- added session revoke action
- linked session control from the SA control panel

What changed in repo:
- frontend/src/admin/sa/screens/SASessions.jsx
- frontend/src/router/AppRouter.jsx
- frontend/src/navigation/screens/adminScreens.js
- frontend/src/admin/sa/screens/SAControlPanel.jsx
- frontend/src/router/routeIndex.js

What was verified:
- /sa/sessions route is registered
- control panel can open Session Control
- session list reads from /api/admin/sessions
- revoke action posts to /api/admin/sessions/revoke

Problems or blockers:
- dedicated audit and system-health screens are still pending
- admin menu governance for new SA routes is still in transitional fallback mode

Decision or note:
The SA command center now has its first linked operational surface,
moving the control plane beyond dashboard-only visibility.

Next step:
Build the SA audit viewer or continue into user governance

## Entry 006

Date:
2026-03-26

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- implemented the SA Audit screen
- wired full audit list consumption from the admin audit endpoint
- added audit status filtering
- added refresh action
- linked audit viewer from the SA control panel

What changed in repo:
- frontend/src/admin/sa/screens/SAAudit.jsx
- frontend/src/router/AppRouter.jsx
- frontend/src/navigation/screens/adminScreens.js
- frontend/src/admin/sa/screens/SAControlPanel.jsx
- frontend/src/router/routeIndex.js

What was verified:
- /sa/audit route is registered
- control panel can open Audit Viewer
- audit list reads from /api/admin/audit

Problems or blockers:
- dedicated system-health screen is still pending
- admin menu governance for new SA routes is still in transitional fallback mode

Decision or note:
The SA command center now has audit visibility in addition to session governance,
bringing the control plane closer to a real operational admin surface.

Next step:
Build the SA system-health screen or move into user governance completion

## Entry 007

Date:
2026-03-26

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- implemented the SA System Health screen
- wired system diagnostics consumption from the admin system-health endpoint
- linked system health from the SA control panel

What changed in repo:
- frontend/src/admin/sa/screens/SASystemHealth.jsx
- frontend/src/router/AppRouter.jsx
- frontend/src/navigation/screens/adminScreens.js
- frontend/src/admin/sa/screens/SAControlPanel.jsx
- frontend/src/router/routeIndex.js

What was verified:
- /sa/system-health route is registered
- control panel can open System Health
- health data reads from /api/admin/system-health

Problems or blockers:
- admin menu governance for new SA routes is still in transitional fallback mode
- command-center linked surfaces are now present, but user governance and org master surfaces still need deeper completion

Decision or note:
The SA control panel now has the three core linked operational surfaces:
session governance,
audit visibility,
and system diagnostics.

Next step:
Move into user governance completion or formalize menu reachability for the new SA command-center routes

## Entry 008

Date:
2026-03-26

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- implemented the SA Users screen
- replaced the placeholder user screen with real admin governance UI
- added ACTIVE and DISABLED filtering
- added direct state change actions for activate and disable flows
- expanded the admin user list payload to include role visibility data
- added temporary route fallback coverage for /sa/users and /sa/signup-requests during this phase

What changed in repo:
- frontend/src/admin/sa/screens/SAUsers.jsx
- frontend/src/router/routeIndex.js
- supabase/functions/api/_core/admin/user/list_users.handler.ts
- docs/ERP build roadmap/FULL_ERP_BUILD_ROADMAP.md
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- /sa/users now renders a real governance surface instead of a placeholder
- user list reads from /api/admin/users
- state change action posts to /api/admin/users/state
- role_code and role_rank are now included in the user inventory payload for frontend visibility
- frontend lint completed successfully
- frontend build completed successfully

Problems or blockers:
- dedicated role assignment and user scope mapping screens are still pending
- admin menu governance for the expanded SA route set is still in transitional fallback mode
- Node verification on this Windows setup required elevated execution outside the default sandbox

Decision or note:
/sa/users is now the first real Onboarding and User Governance surface,
while deeper role and scope governance remain sequenced as later dedicated screens.

Next step:
Build the dedicated signup request surface or continue into /sa/users/roles for role assignment governance

## Entry 009

Date:
2026-03-26

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- implemented the SA Signup Requests screen
- replaced the placeholder onboarding queue with a real pending signup intake surface
- wired pending request consumption from the admin signup endpoint
- added approve and reject action flow to the existing atomic backend routes
- linked the screen back to control panel and user governance surfaces

What changed in repo:
- frontend/src/admin/sa/screens/SASignupRequests.jsx
- docs/ERP build roadmap/FULL_ERP_BUILD_ROADMAP.md
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- /sa/signup-requests now renders a real onboarding queue instead of a placeholder
- pending list reads from /api/admin/signup-requests
- approve action posts to /api/admin/signup-requests/approve
- reject action posts to /api/admin/signup-requests/reject
- frontend lint completed successfully
- frontend build completed successfully

Problems or blockers:
- dedicated role assignment and user scope mapping screens are still pending
- admin menu governance for the expanded SA route set is still in transitional fallback mode

Decision or note:
The onboarding queue is now operational from the SA control surface,
so signup intake and user lifecycle are both reachable from UI.

Next step:
Proceed sequentially into /sa/users/roles for dedicated role assignment governance

## Entry 010

Date:
2026-03-26

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- implemented the dedicated SA User Roles screen
- added route wiring for /sa/users/roles
- added screen registry wiring for the role assignment surface
- linked role assignment from the user directory screen
- wired role changes to the existing admin user role endpoint
- strengthened backend role updates to support both update and first-time assignment via upsert
- expanded temporary route fallback coverage to include /sa/users/roles during this phase

What changed in repo:
- frontend/src/admin/sa/screens/SAUserRoles.jsx
- frontend/src/admin/sa/screens/SAUsers.jsx
- frontend/src/navigation/screens/adminScreens.js
- frontend/src/router/AppRouter.jsx
- frontend/src/router/routeIndex.js
- supabase/functions/api/_core/admin/user/update_user_role.handler.ts
- docs/ERP build roadmap/FULL_ERP_BUILD_ROADMAP.md
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md
- TEMP_UI_BOOT_LOG.md

What was verified:
- /sa/users/roles route is registered
- user directory can open the role assignment surface
- role panel reads user inventory from /api/admin/users
- role apply action posts to /api/admin/users/role
- backend role writes now tolerate missing user_roles rows
- frontend lint completed successfully
- frontend build completed successfully

Problems or blockers:
- user scope mapping is still pending
- admin menu governance for the expanded SA route set is still in transitional fallback mode

Decision or note:
Role assignment is now split into its own governance surface,
which keeps lifecycle control and authority mapping sequential and easier to reason about.

Next step:
Proceed sequentially into /sa/users/scope for user scope mapping governance

## Entry 011

Date:
2026-03-26

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- shifted the protected workspace shell toward a keyboard-first ERP interaction model
- extended the central keyboard intent system with workspace zone focus and shortcut help intents
- rebuilt the shared protected shell to support menu-first navigation, action-strip focus, and content-zone cycling
- refactored the shared dashboard surface into a denser operator action workspace
- normalized the current SA operational screens away from decorative SaaS-style gradients toward a flatter ERP workspace background

What changed in repo:
- frontend/src/layout/MenuShell.jsx
- frontend/src/components/dashboard/EnterpriseDashboard.jsx
- frontend/src/navigation/workspaceFocusBus.js
- frontend/src/navigation/keyboardIntentEngine.js
- frontend/src/navigation/keyboardIntentMap.js
- frontend/src/navigation/keyboardAclBridge.js
- frontend/src/index.css
- frontend/src/admin/sa/screens/SAControlPanel.jsx
- frontend/src/admin/sa/screens/SASessions.jsx
- frontend/src/admin/sa/screens/SAAudit.jsx
- frontend/src/admin/sa/screens/SASystemHealth.jsx
- frontend/src/admin/sa/screens/SASignupRequests.jsx
- frontend/src/admin/sa/screens/SAUsers.jsx
- frontend/src/admin/sa/screens/SAUserRoles.jsx
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md
- TEMP_UI_BOOT_LOG.md

What was verified:
- protected workspace shell now exposes keyboard zone navigation via F6 and Shift+F6
- protected dashboards now render in a denser operator-style action layout
- public routes were not included in the keyboard-first shell conversion
- frontend lint completed successfully
- frontend build completed successfully

Problems or blockers:
- current operational screens are improved by shell-level and styling-level changes, but deeper per-screen keyboard workflows can still be strengthened later
- admin menu governance for expanded SA route coverage is still in transitional fallback mode

Decision or note:
The ERP UI direction is now explicitly moving away from mouse-first SaaS interaction
toward keyboard-first protected workspaces without introducing a command-line or T-code model.

Next step:
Continue scope mapping build-up under the new keyboard-first protected workspace pattern

## Entry 012

Date:
2026-03-26

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- fixed the SA signup decision flow so frontend no longer treats backend no-op as a real approval or rejection
- added backend decision outcome payload and failure observability for signup approve and reject routes
- changed the signup queue screen to refresh and verify queue state after a decision instead of using optimistic removal only
- fixed the SA control panel version rendering so backend system metadata objects no longer crash the React screen

What changed in repo:
- supabase/functions/api/_core/admin/signup/approve.handler.ts
- supabase/functions/api/_core/admin/signup/reject.handler.ts
- frontend/src/admin/sa/screens/SASignupRequests.jsx
- frontend/src/admin/sa/screens/SAControlPanel.jsx
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- frontend lint completed successfully
- frontend build completed successfully
- control panel system version rendering is now object-safe
- signup queue now re-reads backend state after approve or reject actions

Problems or blockers:
- if the DB-owned approval engine itself fails for a specific user, the new backend logs must be read to identify the exact SQL-side reason

Decision or note:
The previous signup UI could show false success because backend handlers preserved enumeration safety with generic ok responses.
That mismatch is now removed for the SA governance surface.

Next step:
Retest signup approval, role visibility after approval, and control panel loading against live backend state

## Entry 013

Date:
2026-03-26

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- audited the currently implemented SA mutation surfaces for false-success behavior
- hardened user state change so backend returns explicit applied outcome
- hardened role assignment so backend returns explicit applied outcome
- hardened session revoke so backend returns explicit revoked outcome only when a row was actually affected
- updated the affected frontend screens to refetch and verify backend state after each mutation instead of trusting optimistic local changes

What changed in repo:
- supabase/functions/api/_core/admin/user/update_user_state.handler.ts
- supabase/functions/api/_core/admin/user/update_user_role.handler.ts
- supabase/functions/api/_core/admin/session/revoke_session.handler.ts
- frontend/src/admin/sa/screens/SAUsers.jsx
- frontend/src/admin/sa/screens/SAUserRoles.jsx
- frontend/src/admin/sa/screens/SASessions.jsx
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- current live SA mutation screens now use backend outcome verification
- frontend lint completed successfully
- frontend build completed successfully

Problems or blockers:
- placeholder screens that do not yet expose live mutation actions were outside this false-success audit scope

Decision or note:
Current wired SA actions should no longer show success merely because a generic ok envelope was returned.
The UI now depends on verified backend state for completion.

Next step:
Retest the live SA mutation flows against real data before continuing deeper roadmap build-out

## Entry 014

Date:
2026-03-26

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- traced the failing live signup approval flow down to schema-qualified Supabase RPC usage
- fixed admin signup approve and reject handlers so non-public functions are called through explicit schema scoping instead of dotted rpc names
- audited and corrected the same RPC usage pattern in context resolution, ACL snapshot activation, and workflow decision processing paths
- removed placeholder snapshot counters from SA Home and replaced them with live control-panel and system-health driven values
- continued keyboard-first SA operational build-out while keeping public routes unchanged

What changed in repo:
- supabase/functions/api/_core/admin/signup/approve.handler.ts
- supabase/functions/api/_core/admin/signup/reject.handler.ts
- supabase/functions/api/_pipeline/context.ts
- supabase/functions/api/_core/admin/acl/activate_acl_version.handler.ts
- supabase/functions/api/_core/workflow/process_decision.handler.ts
- supabase/functions/api/_core/admin/diagnostics/control_panel.handler.ts
- frontend/src/admin/sa/screens/SAHome.jsx
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- direct DB diagnostics confirmed the approval engine itself was healthy
- production failure reason exposed the real issue as incorrect RPC schema resolution
- frontend lint completed successfully
- frontend build completed successfully

Problems or blockers:
- backend and frontend deploy remained required before production would reflect the corrected RPC invocation pattern

Decision or note:
The signup approval failure was not caused by runner.ts, lifecycle mismatch, or the DB approval function body.
It was caused by calling non-public functions with dotted rpc names, which production PostgREST resolved incorrectly.

Next step:
Retest live SA approval, rejection, and any other schema-scoped RPC-backed governance action after deploy

## Entry 015

Date:
2026-03-28

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- implemented shared keyboard-first hardening primitives for protected ERP pages
- added visible quick-filter support and stable sorting helpers for dense protected inventories
- expanded SA screens to support more consistent arrow-key navigation, quick filtering, and sticky action access
- hardened the SA User Scope company picker so Parent Company selection is now keyboard- and mouse-usable
- confirmed the signup runtime break was not caused by backend logic; the live failure came from a wrong frontend deployment anon key

What changed in repo:
- frontend/src/components/inputs/QuickFilterInput.jsx
- frontend/src/components/layer/BlockingLayer.jsx
- frontend/src/components/layer/DrawerBase.jsx
- frontend/src/shared/erpCollections.js
- frontend/src/shared/erpRoles.js
- frontend/src/admin/sa/screens/SAControlPanel.jsx
- frontend/src/admin/sa/screens/SACompanyCreate.jsx
- frontend/src/admin/sa/screens/SAAudit.jsx
- frontend/src/admin/sa/screens/SASessions.jsx
- frontend/src/admin/sa/screens/SASignupRequests.jsx
- frontend/src/admin/sa/screens/SAUserRoles.jsx
- frontend/src/admin/sa/screens/SAUsers.jsx
- frontend/src/admin/sa/screens/SAUserScope.jsx
- frontend/src/navigation/erpRovingFocus.js
- supabase/functions/api/_core/admin/user/get_user_scope.handler.ts
- supabase/functions/api/_core/admin/user/list_users.handler.ts
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- frontend lint completed successfully
- frontend build completed successfully
- backend deno check completed successfully on changed admin user handlers
- SA scope picker is now reachable through keyboard and mouse after live frontend deployment
- signup failure RCA was completed and traced to wrong frontend deployment anon key, not SPF, ImprovMX, or backend CORS policy

Problems or blockers:
- the broader protected-page keyboard standard still needs to be carried forward screen by screen as new protected work surfaces are added
- live behavior remains dependent on correct frontend deployment environment values

Decision or note:
Protected ERP pages must follow a keyboard-first operating model.
The SA scope drawer issue was a real accessibility blocker and is now resolved in the shared layer path.
The signup incident also confirmed that direct Supabase frontend paths can fail independently of backend health when deployment env values drift.

Next step:
Continue protected-surface keyboard hardening and governance work in roadmap order,
using the new shared sorting, filtering, and navigation primitives as the default pattern.

---

2026-03-27

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- hardened SA role governance so the current operator cannot edit their own role
- blocked last-SA demotion to reduce accidental self-lockout risk
- introduced business-only company filtering for user scope governance
- added company_kind classification so SYSTEM companies stay out of business scope mapping
- replaced the SA Create Company placeholder with a real GST-driven company creation flow
- wired GST lookup to cache-first resolution, Applyflow fallback, and company-master autofill
- added state_name, full_address, and pin_code capture for company master creation
- fixed Applyflow integration to use key_secret query parameter as required by vendor docs
- normalized Appyflow status values before cache insert so GST cache writes succeed

What changed in repo:
- frontend/src/admin/sa/screens/SAUserRoles.jsx
- frontend/src/admin/sa/screens/SAUserScope.jsx
- frontend/src/admin/sa/screens/SACompanyCreate.jsx
- supabase/functions/api/_core/admin/user/_guards/self_lockout.guard.ts
- supabase/functions/api/_core/admin/user/get_user_scope.handler.ts
- supabase/functions/api/_core/admin/user/update_user_scope.handler.ts
- supabase/functions/api/_core/admin/company/create_company.handler.ts
- supabase/functions/api/_core/admin/company/get_company_gst_profile.handler.ts
- supabase/functions/api/_shared/applyflow_client.ts
- supabase/functions/api/_shared/gst_company_fields.ts
- supabase/functions/api/_shared/gst_resolver.ts
- supabase/migrations/20260410114000_gate9_9_2B_company_kind_business_filter.sql
- supabase/migrations/20260410115000_gate9_9_2C_company_address_fields.sql
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- frontend lint completed successfully
- frontend build completed successfully
- deno check completed successfully on changed GST/backend files
- live GST lookup now works after vendor-aligned Applyflow request correction
- SA company create screen now resolves GST profile and is ready for business-company creation

Problems or blockers:
- live environment still needs the new migrations applied before all company-master fields and business/system filtering are fully authoritative in database state
- broader company-master enrichment beyond legal name, GST, state, full address, and pin code remains out of scope for this step

Decision or note:
SA governance is now materially safer.
Business scope and system scope are no longer mixed by design,
and company creation is now moving on a GST-backed flow instead of a placeholder screen.

Next step:
Continue with the next company-governance task from the user,
using the now-working GST-backed create-company surface as the new baseline

---

2026-03-27

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- replaced browser-native confirm dialogs across current SA mutation screens with a shared ERP confirmation overlay
- enriched admin user payloads using existing ERP user plus signup intake data so governance screens now show user code, user name, parent company, and designation
- refactored SA role assignment and user directory screens to present identity-first operator context instead of code-only rows
- enriched the session governance payload so session rows now identify the ERP user rather than forcing SA to interpret long auth identifiers
- fixed SA system-health rendering so object-shaped system version metadata no longer crashes the screen
- corrected protected-route history handling so browser back from the dashboard root now follows the logout confirmation path and logout no longer leaves stale protected dashboard history behind

What changed in repo:
- frontend/src/store/actionConfirm.js
- frontend/src/components/ActionConfirmOverlay.jsx
- frontend/src/App.jsx
- frontend/src/admin/sa/screens/SASignupRequests.jsx
- frontend/src/admin/sa/screens/SAUsers.jsx
- frontend/src/admin/sa/screens/SAUserRoles.jsx
- frontend/src/admin/sa/screens/SASessions.jsx
- frontend/src/admin/sa/screens/SASystemHealth.jsx
- frontend/src/components/layer/BlockingLayer.jsx
- frontend/src/navigation/backGuardEngine.js
- frontend/src/store/sessionWarning.js
- frontend/src/pages/public/LoginScreen.jsx
- supabase/functions/api/_core/admin/user/list_users.handler.ts
- supabase/functions/api/_core/admin/session/list_sessions.handler.ts
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- frontend lint completed successfully
- frontend build completed successfully
- current SA screens no longer use browser-native confirm dialogs
- no new DB table or migration was required for the identity enrichment work

Problems or blockers:
- changes still depend on deploy before production behavior matches the local verified state

Decision or note:
Operator-facing SA screens must prioritize identifiable ERP business context over long technical identifiers.
Current governance surfaces now move closer to practical ERP operation while remaining within the existing schema.

Next step:
Continue live retest of the patched SA governance surfaces, then resume the next sequential governance build surface after validation

## Entry 016

Date:
2026-03-27

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- refactored the protected shell into dashboard-home mode and focused task-page mode
- added direct keyboard focus jumps so operators can reach content without repeated shell traversal
- changed protected scrolling so only the active content pane scrolls
- strengthened dashboard action cards to behave more like explicit keyboard-targetable action buttons

What changed in repo:
- frontend/src/layout/MenuShell.jsx
- frontend/src/navigation/keyboardIntentEngine.js
- frontend/src/navigation/keyboardIntentMap.js
- frontend/src/navigation/keyboardAclBridge.js
- frontend/src/components/dashboard/EnterpriseDashboard.jsx
- frontend/src/index.css
- TEMP_UI_BOOT_LOG.md
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- frontend lint completed successfully
- frontend build completed successfully

Problems or blockers:
- deeper per-screen keyboard patterns are still inconsistent in some operational screens
- this step improves shell-level flow first, but screen-local tablists and form action layouts still need follow-up passes

Decision or note:
The previous always-visible protected shell created too much keyboard friction for real ERP work.
The UI now begins moving toward a home-dashboard plus focused task-page model closer to operator expectations.

Next step:
Re-test the updated protected UX in live SA screens, then continue screen-level keyboard and workflow refinement where friction remains

## Entry 017

Date:
2026-03-27

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- fixed dashboard action queue arrow-key movement so focused action rows now move correctly with Up and Down
- expanded the shared blocking-layer keyboard contract for modal, popup, and future drawer interactions
- enabled arrow-key and Home/End movement inside declared overlay action groups
- prepared overlay forms for ERP-style vertical keyboard traversal using the workspace lock screen as the first live example

What changed in repo:
- frontend/src/components/dashboard/EnterpriseDashboard.jsx
- frontend/src/components/layer/BlockingLayer.jsx
- frontend/src/components/layer/ModalBase.jsx
- frontend/src/components/layer/DrawerBase.jsx
- frontend/src/components/ActionConfirmOverlay.jsx
- frontend/src/components/LogoutConfirmOverlay.jsx
- frontend/src/components/SessionOverlay.jsx
- frontend/src/components/WorkspaceLockOverlay.jsx
- TEMP_UI_BOOT_LOG.md
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- frontend lint completed successfully
- frontend build completed successfully

Problems or blockers:
- explicit tab-strip components are not yet centralized in the current repo, so tab-style arrow contracts still need to be applied where those controls appear later
- screen-local tables and filter strips still need separate keyboard refinement beyond the shared overlay base

Decision or note:
ERP UX consistency must come from shared interaction contracts, not isolated screen patches.
Modal, popup, and future drawer behavior now starts following that rule.

Next step:
Continue the next UX pass on screen-local tables, tab strips, and selection lists so protected workflows rely less on repeated Tab traversal

## Entry 018

Date:
2026-03-27

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- added a reusable roving-focus helper for protected screen-local keyboard navigation
- applied arrow-key navigation to SA filter strips and local action bars
- applied vertical or grid-style keyboard movement to current SA table action controls
- made control-panel preview tables and audit rows keyboard-traversable for faster operator review

What changed in repo:
- frontend/src/navigation/erpRovingFocus.js
- frontend/src/admin/sa/screens/SAControlPanel.jsx
- frontend/src/admin/sa/screens/SAAudit.jsx
- frontend/src/admin/sa/screens/SAUsers.jsx
- frontend/src/admin/sa/screens/SASessions.jsx
- frontend/src/admin/sa/screens/SASignupRequests.jsx
- frontend/src/admin/sa/screens/SAUserRoles.jsx
- TEMP_UI_BOOT_LOG.md
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- frontend lint completed successfully
- frontend build completed successfully

Problems or blockers:
- native select controls still keep their own browser arrow semantics, so deeper custom picker work may still be needed later if role selection should behave like a fully custom ERP chooser
- GA and non-SA operational surfaces have not yet received the same screen-local keyboard pass

Decision or note:
Keyboard-first ERP UX must be enforced both at shell level and at individual work-surface level.
This pass extends the contract into current SA control-plane screens instead of stopping at the shell.

Next step:
Manually re-test the updated SA work surfaces, then extend the same screen-local keyboard contract into GA and future user-role operational screens

## Entry 019

Date:
2026-03-27

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- created a dedicated execution-sequence realignment note for the next ERP build phase
- locked the corrected Project -> Module -> Page or Resource interpretation into ACL authority docs
- locked the clarified approval target-unit and approver-visibility rules into ACL authority docs
- added explicit schema truth for Module -> Resource ownership through a dedicated mapping migration

What changed in repo:
- docs/ERP build roadmap/ERP_EXECUTION_SEQUENCE_REALIGNMENT.md
- docs/ACL_SSOT.md
- supabase/migrations/20260410110000_gate7_5_21_create_module_resource_map.sql
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- current execution order is now documented before /sa/users/scope work begins
- the repo now has an explicit schema place for binding governed resources to one module
- the corrected business interpretation is now written down instead of being chat-only

Problems or blockers:
- approval policy in current implementation is still centered too heavily on module-level truth
- approver routing and visibility are still not yet narrowed to exact action or resource scope
- existing backend governance routes and SA UI surfaces remain incomplete in several ACL and workflow areas

Decision or note:
We will not jump directly into /sa/users/scope just because the old route sequence suggests it.
First we will finish the upstream alignment needed so user scope becomes a clean governance surface instead of a patchwork screen.

Next step:
Review the current approval and workflow schema against the new action or resource-level approval target model,
then implement the next alignment change before /sa/users/scope starts

## Entry 020

Date:
2026-03-27

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- reviewed the current workflow and approval schema against the corrected action or resource-level target model
- identified that workflow_requests and current approval truth are still centered too heavily on module scope
- added a dedicated resource-level approval policy table so exact governed work can now declare whether approval is required
- preserved the existing approval method and 2 to 3 approver discipline while moving the source of truth closer to real work scope

What changed in repo:
- supabase/migrations/20260410111000_gate7_5_22_create_resource_approval_policy.sql
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- the repo now has a schema place for selective approval policy below blanket module level
- approval-required and non-approval work can now be modeled separately even inside the same module

Problems or blockers:
- current approver routing is still keyed too broadly at company + module scope
- workflow request and decision processing are still not yet narrowed to exact resource and action scope
- admin governance routes and SA screens for approval control remain incomplete

Decision or note:
We are intentionally realigning approval truth before /sa/users/scope begins.
Otherwise user scope would be built before the real approval target unit is stable.

Next step:
Tighten approver routing and approval visibility from module-wide scope toward exact resource and action scope before /sa/users/scope starts

## Entry 021

Date:
2026-03-27

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- added exact resource and action scope columns to approver routing truth and workflow request truth
- replaced blanket module-wide approver uniqueness with scope-aware uniqueness for both legacy module scope and exact work scope
- added scope integrity rules so exact approver rows must point to a module-owned resource and an approval-required resource-action pair
- updated approval admin handlers to read and write exact scoped approver rules
- updated workflow decision processing so exact-scoped approver rules are filtered correctly instead of being mixed with broad module rows

What changed in repo:
- supabase/migrations/20260410112000_gate7_5_23_narrow_approver_scope.sql
- supabase/functions/api/_core/admin/approval/upsert_approver_rule.handler.ts
- supabase/functions/api/_core/admin/approval/list_approver_rules.handler.ts
- supabase/functions/api/_core/workflow/process_decision.handler.ts
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- the schema now has a place to represent exact approver scope below blanket module scope
- admin approval rule handlers now accept exact governed scope fields
- workflow decision routing now filters approver scope more narrowly when workflow rows carry exact resource and action data

Problems or blockers:
- workflow request creation paths are still not yet aligned end-to-end around exact resource and action scope
- admin route exposure and SA approval governance UI are still incomplete
- /sa/users/scope contract is still pending and must wait until these upstream truth layers are stable enough

Decision or note:
Approver means exact delegated approval authority only.
The system is now moving closer to that truth structurally instead of assuming module-wide visibility by default.

Next step:
Review the remaining workflow request creation and approval-governance route gaps,
then write the /sa/users/scope contract once upstream truth is stable enough

## Entry 022

Date:
2026-03-27

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- exposed approval-governance backend routes for listing,
  creating,
  updating,
  and deleting approver rules
- connected the existing approval admin handlers into the protected admin route dispatcher
- kept the approval governance move backend-first before any SA approval UI build begins

What changed in repo:
- supabase/functions/api/_routes/admin.routes.ts
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- approval admin handlers are no longer stranded as unexposed backend files
- the backend now has a consumable route surface for approver governance build-up

Problems or blockers:
- the route surface now exists,
  but no SA approval governance screen consumes it yet
- exact workflow request creation still needs aligned resource and action scope usage
- /sa/users/scope contract is still pending

Decision or note:
Backend authority must be reachable before SA UI consumes it.
This approval-governance route exposure step follows that rule.

Next step:
Write the /sa/users/scope contract from the now-aligned Parent Company,
Work Company,
Module,
and Approval foundations,
then begin the user-scope implementation sequence

## Entry 023

Date:
2026-03-27

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- added the dedicated /sa/users/scope screen contract into the full ERP roadmap
- defined the screen around Parent Company,
  Work Company,
  reusable Project visibility,
  and future Department hooks
- made the distinction explicit that user scope does not duplicate module governance or grant blanket approval authority

What changed in repo:
- docs/ERP build roadmap/FULL_ERP_BUILD_ROADMAP.md
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- /sa/users/scope is now no longer a vague placeholder route in the roadmap
- the user-scope screen now has a stable business contract before implementation begins

Problems or blockers:
- backend read and write handlers for user scope mapping are still not built
- frontend route and screen implementation for /sa/users/scope are still pending
- project and department mapping remain future hooks from this screen contract,
  not yet implemented live surfaces

Decision or note:
The repo now has enough upstream alignment to begin the actual user-scope implementation sequence.
The next work should move from truth alignment into backend user-scope route creation.

Next step:
Implement the backend read and write foundation for /sa/users/scope,
then wire the new SA screen route and UI surface

## Entry 024

Date:
2026-03-27

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- split Parent Company truth away from Work Company scope through a dedicated parent-company mapping table
- preserved the existing get_primary_company authority contract while moving it onto the new parent-company source
- implemented backend read foundation for /api/admin/users/scope
- implemented backend write foundation for /api/admin/users/scope covering parent company,
  work companies,
  and optional project and department mappings
- exposed the new user-scope routes through the protected admin dispatcher

What changed in repo:
- supabase/migrations/20260410113000_gate6_6_6B_split_parent_from_work_company.sql
- supabase/functions/api/_core/admin/user/get_user_scope.handler.ts
- supabase/functions/api/_core/admin/user/update_user_scope.handler.ts
- supabase/functions/api/_routes/admin.routes.ts
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- Parent Company is no longer forced to share the same storage truth as Work Company scope
- the backend now has a dedicated user-scope read and write surface for the upcoming SA screen
- existing get_primary_company consumers can continue using the same function contract

Problems or blockers:
- frontend /sa/users/scope route and screen are still not implemented
- screen registry and user-directory launch wiring are still pending for user scope
- project and department hooks exist in backend foundation,
  but user-facing interaction still needs the new screen

Decision or note:
We corrected a structural truth before the UI was built:
Parent Company is HR identity truth,
while Work Company remains operational scope.
This prevents the user-scope screen from being built on a mixed model.

Next step:
Implement the /sa/users/scope frontend route,
screen,
and launch wiring on top of the new backend user-scope foundation

## Entry 025

Date:
2026-03-27

Roadmap step:
Step 2 - SA Dashboard Information Architecture

Status:
IN PROGRESS

What was done:
- implemented the SA User Scope screen
- wired the screen to the new backend user-scope read and write endpoints
- added route registration for /sa/users/scope
- added screen registry and temporary route fallback coverage for the new user-scope surface
- linked the user directory to open the scope screen for a selected user

What changed in repo:
- frontend/src/admin/sa/screens/SAUserScope.jsx
- frontend/src/admin/sa/screens/SAUsers.jsx
- frontend/src/navigation/screens/adminScreens.js
- frontend/src/router/AppRouter.jsx
- frontend/src/router/routeIndex.js
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- frontend lint completed successfully
- frontend build completed successfully
- /sa/users/scope now has a real frontend route and screen
- user directory can open the user-scope surface

Problems or blockers:
- exact approval-governance UI surfaces are still not yet built
- menu governance for the expanded SA route set is still in temporary fallback mode
- backend user-scope foundation is now present,
  but live environment validation still depends on deploy and runtime testing

Decision or note:
User scope is now no longer a roadmap-only placeholder.
The system now has a first real surface for separating Parent Company truth from Work Company scope.

Next step:
Retest the new /sa/users/scope surface against live backend state,
then continue into module governance and approval-governance surfaces in roadmap order

---

## Entry 026

Date:
2026-03-28

Roadmap step:
Protected Session Cluster Realignment - SC-1 and SC-2

Status:
IN PROGRESS

What was done:
- wrote the dedicated session-cluster authority contract as a separate execution reference
- added backend storage foundation for parent session clusters
- added governed window-slot storage foundation for admitted cluster members
- linked existing ERP session rows to optional parent cluster identity
- declared typed backend constants for cluster states,
  slot states,
  and future synchronization event vocabulary

What changed in repo:
- docs/ERP build roadmap/ERP_SESSION_CLUSTER_AUTHORITY.md
- supabase/migrations/20260410116000_gate3_10_session_cluster_foundation.sql
- supabase/functions/api/_core/session/session.cluster.types.ts
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- backend schema now has a dedicated place for one ACTIVE cluster per user
- backend schema now has a dedicated place for maximum 3 admitted governed windows
- current runtime behavior remains unchanged because protected-shell and login wiring were intentionally not changed in this step

Problems or blockers:
- session create,
  logout,
  revoke,
  and lifecycle handlers do not yet read or write the new cluster tables
- protected shell still enforces the old single-tab policy
- cluster synchronization events are declared,
  but not yet propagated through backend and frontend lifecycle flows

Decision or note:
This step intentionally starts with authority and storage truth only.
The repo now has backend-first cluster foundations without prematurely jumping into frontend-only coordination.

Next step:
Define SC-3 cluster lifecycle and synchronization events,
then wire backend login and session lifecycle handlers to create,
replace,
and terminate clusters before protected-shell behavior is changed

## Entry 027

Date:
2026-03-28

Roadmap step:
Protected Session Cluster Realignment - SC-3 through SC-7 foundation wiring

Status:
IN PROGRESS

What was done:
- extended the session-cluster foundation to support window-instance identity and one-time join tickets
- wired login to create a fresh session cluster and replace the old active cluster on fresh login
- wired backend session resolution to validate active cluster truth and admitted window-token truth
- wired logout,
  admin revoke,
  user disable revoke,
  and lifecycle expiry paths to terminate the whole cluster instead of only one browser surface
- exposed protected backend routes for cluster admission,
  controlled open-window tickets,
  and best-effort window close signaling
- replaced the old protected single-tab ownership behavior with governed cluster-window ownership guarding
- added frontend cluster admission storage,
  cluster fetch header injection,
  same-cluster warning/lock/logout broadcast sync,
  and the governed New Window action from protected Home shells

What changed in repo:
- supabase/migrations/20260410116000_gate3_10_session_cluster_foundation.sql
- supabase/functions/api/_core/session/session.cluster.ts
- supabase/functions/api/_core/session/session.cluster.handler.ts
- supabase/functions/api/_core/session/session.cluster.types.ts
- supabase/functions/api/_core/session/session.create.ts
- supabase/functions/api/_core/auth/login.handler.ts
- supabase/functions/api/_core/auth/logout.handler.ts
- supabase/functions/api/_core/session/session.admin_revoke.ts
- supabase/functions/api/_core/admin/session/revoke_session.handler.ts
- supabase/functions/api/_core/admin/session/list_sessions.handler.ts
- supabase/functions/api/_pipeline/session.ts
- supabase/functions/api/_pipeline/runner.ts
- supabase/functions/api/_pipeline/protected_routes.dispatch.ts
- supabase/functions/api/_routes/session.routes.ts
- frontend/src/store/sessionCluster.js
- frontend/src/store/sessionWarning.js
- frontend/src/store/workspaceLock.js
- frontend/src/components/SessionClusterBridge.jsx
- frontend/src/components/SessionWatchdog.jsx
- frontend/src/auth/AuthBootstrap.jsx
- frontend/src/router/ProtectedBranchShell.jsx
- frontend/src/layout/MenuShell.jsx
- frontend/src/main.jsx
- frontend/src/App.jsx
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- frontend lint completed successfully
- frontend build completed successfully
- migration naming is now sequenced after the existing 20260410115000 file
- the protected shell no longer depends on the old single-tab ownership rule
- the repo now has a backend-backed route surface for cluster admission and governed new-window expansion

Problems or blockers:
- backend route and handler wiring were verified structurally,
  but live session-cluster behavior still depends on applying the new migration and exercising the flows against runtime backend state
- window-close handling remains best-effort because browser unload delivery is never perfectly guaranteed
- same-cluster UX synchronization is currently browser-coordination based,
  while backend remains the authority for cluster legitimacy and forced replacement

Decision or note:
This pass moves the repo from session-cluster theory into working implementation foundations.
The live target is now backend-authoritative cluster legitimacy with frontend coordination layered on top,
instead of the previous same-browser single-tab policy.

Next step:
Apply the new migration,
run live login and multi-window validation,
then tighten any runtime edge cases found during real browser testing

## Entry 028

Date:
2026-03-28

Roadmap step:
Protected Session Cluster Realignment - runtime stabilization and UX completion

Status:
COMPLETED

What was done:
- completed live runtime stabilization for governed multi-window session clusters
- reduced login-to-home handoff time by parallelizing protected bootstrap profile and menu fetches
- replaced the plain redirect placeholder with a secure redirect experience that shows animated loading and shuffled data-security/data-hygiene guidance
- removed the reserved keyboard shortcut path for opening new windows and kept governed expansion on the visible shell button
- hardened popup boot so child windows reset inherited sessionStorage state before cluster admission
- fixed max-window denial so a 4th window request is blocked with a user-facing restriction message instead of forcing logout
- aligned logout confirmation behavior so the explicit Logout button now matches the Esc confirmation path
- tightened child-window logout behavior so auxiliary windows attempt auto-close while the primary window returns to login

What changed in repo:
- frontend/src/auth/AuthBootstrap.jsx
- frontend/src/admin/AuthResolver.jsx
- frontend/src/layout/MenuShell.jsx
- frontend/src/store/sessionCluster.js
- frontend/src/store/sessionWarning.js
- supabase/functions/api/_core/response.ts
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- backend type-check completed successfully with `deno check supabase/functions/api/index.ts`
- frontend lint completed successfully
- frontend build completed successfully
- live browser validation confirmed governed new-window opening now works
- live browser validation confirmed login redirect,
  redirect-screen guidance,
  logout confirmation,
  and max-window restriction behavior are now aligned with the intended UX

Problems or blockers:
- child-window auto-close remains browser-behavior-sensitive by nature,
  so it is still implemented as best-effort popup closure with redirect fallback if the browser refuses the close call

Decision or note:
The protected session-cluster realignment is now functionally complete for the governed Home-window scope.
The old single-tab behavior is no longer the active model,
and runtime behavior now matches the backend-authoritative cluster design validated during testing.

Next step:
Resume the main ERP roadmap from the next scheduled program item outside this session-cluster stabilization pass

## Entry 032

Date:
2026-03-28

Roadmap step:
Keyboard-First ERP global framework - shared screen hotkeys

Status:
COMPLETED

What was done:
- introduced a shared route-level screen hotkey registry so screens can register save,
  refresh,
  quick-search focus,
  and primary-focus actions without writing their own global keydown listeners
- wired the global shortcuts:
  `Ctrl+S`,
  `Alt+R`,
  `Alt+Shift+F`,
  and
  `Alt+Shift+P`
  into the central keyboard intent engine
- migrated the existing SA Company Create and SA User Scope save flow away from manual `window` key listeners into the shared hotkey registry
- registered refresh and search hotkeys across the current SA list/diagnostic screens,
  plus primary-focus hotkeys for the current dashboard homes

What changed in repo:
- frontend/src/store/erpScreenHotkeys.js
- frontend/src/hooks/useErpScreenHotkeys.js
- frontend/src/navigation/keyboardIntentEngine.js
- frontend/src/navigation/keyboardIntentMap.js
- frontend/src/navigation/keyboardAclBridge.js
- frontend/src/layout/MenuShell.jsx
- frontend/src/admin/sa/screens/SAHome.jsx
- frontend/src/admin/sa/screens/SAControlPanel.jsx
- frontend/src/admin/sa/screens/SAUsers.jsx
- frontend/src/admin/sa/screens/SAUserRoles.jsx
- frontend/src/admin/sa/screens/SAUserScope.jsx
- frontend/src/admin/sa/screens/SACompanyCreate.jsx
- frontend/src/admin/sa/screens/SASessions.jsx
- frontend/src/admin/sa/screens/SAAudit.jsx
- frontend/src/admin/sa/screens/SASignupRequests.jsx
- frontend/src/admin/sa/screens/SASystemHealth.jsx
- frontend/src/admin/ga/screens/GAHome.jsx
- frontend/src/pages/dashboard/UserDashboardHome.jsx
- docs/Base Docs/ERP_KEYBOARD_FIRST_INTERACTION_STANDARD.md
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- frontend lint completed successfully
- frontend build completed successfully
- shared hotkeys now execute through the central keyboard intent system instead of isolated screen-local listeners where this layer was adopted

Problems or blockers:
- future screens still need to register themselves to this shared hotkey registry as they are built
- dense form-enter traversal still remains a separate future enhancement for the keyboard-first layer

Decision or note:
The keyboard-first foundation now has two reusable global layers:
command-bar registration
and
shared screen hotkey registration.
Future screens should consume those layers instead of inventing ad-hoc keydown logic.

Next step:
Carry the same global framework into the next governance build wave and later add shared dense-form traversal for HR data-entry modules

## Entry 031

Date:
2026-03-28

Roadmap step:
Keyboard-First ERP rollout - current SA protected screens

Status:
COMPLETED

What was done:
- extended the new `Ctrl+K` ERP command bar across the current SA protected surface
- added screen-command registration for:
  - SA Home
  - SA Control Panel
  - SA Users
  - SA User Roles
  - SA User Scope
  - SA Company Create
  - SA Sessions
  - SA Audit
  - SA Signup Requests
  - SA System Health
- added minimum command-bar coverage for the currently implemented
  GA home
  and
  generic user dashboard home
- exposed the practical keyboard actions that matter on those screens:
  refresh,
  quick search focus,
  quick-launch jumps,
  related-screen jumps,
  and current-screen governance actions
- kept all existing protected-session behavior unchanged while making the present SA control plane keyboard-accessible through one shared command center

What changed in repo:
- frontend/src/admin/sa/screens/SAHome.jsx
- frontend/src/admin/sa/screens/SAControlPanel.jsx
- frontend/src/admin/sa/screens/SAUsers.jsx
- frontend/src/admin/sa/screens/SAUserRoles.jsx
- frontend/src/admin/sa/screens/SAUserScope.jsx
- frontend/src/admin/sa/screens/SACompanyCreate.jsx
- frontend/src/admin/sa/screens/SASessions.jsx
- frontend/src/admin/sa/screens/SAAudit.jsx
- frontend/src/admin/sa/screens/SASignupRequests.jsx
- frontend/src/admin/sa/screens/SASystemHealth.jsx
- frontend/src/admin/ga/screens/GAHome.jsx
- frontend/src/pages/dashboard/UserDashboardHome.jsx
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- frontend lint completed successfully
- frontend build completed successfully
- command-bar coverage now exists across the current SA protected screens without removing existing runtime protections

Problems or blockers:
- future org-master screens,
  module governance screens,
  approval-governance screens,
  and upcoming HR module screens still need to be built or registered to the same keyboard-first standard

Decision or note:
For the currently implemented SA surface,
keyboard-first operation is no longer limited to isolated screens.
The command-bar pattern is now a live control-plane baseline.

Next step:
Carry the same keyboard-first standard into the next governance build wave:
Company Master,
Group Master,
Project Master,
Department Master,
and the HR module surfaces

## Entry 030

Date:
2026-03-28

Roadmap step:
Keyboard-First ERP foundation - protected command bar baseline

Status:
COMPLETED

What was done:
- introduced a protected-shell ERP command bar opened by `Ctrl+K`
- added a reusable screen-command registry so each protected screen can publish its own keyboard actions
- exposed shell actions,
  allowed navigation targets,
  and current-screen actions through one keyboard command center
- wired the first route-level screen commands into:
  `SA Company Create`
  and
  `SA User Scope`
- preserved existing protected behavior:
  idle warning,
  idle logout,
  absolute warning,
  absolute logout,
  workspace lock,
  logout confirmation,
  and max-3 governed window flow

What changed in repo:
- frontend/src/store/erpCommandPalette.js
- frontend/src/hooks/useErpScreenCommands.js
- frontend/src/components/ErpCommandPalette.jsx
- frontend/src/navigation/keyboardIntentEngine.js
- frontend/src/navigation/keyboardIntentMap.js
- frontend/src/navigation/keyboardAclBridge.js
- frontend/src/layout/MenuShell.jsx
- frontend/src/admin/sa/screens/SACompanyCreate.jsx
- frontend/src/admin/sa/screens/SAUserScope.jsx
- docs/Base Docs/ERP_KEYBOARD_FIRST_INTERACTION_STANDARD.md
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- frontend lint completed successfully
- frontend build completed successfully
- command bar integration was added without removing any protected-session or governed multi-window behavior

Problems or blockers:
- this is only the first keyboard-first layer;
  most remaining protected screens still need screen-level command registration

Decision or note:
Keyboard-first ERP work has now moved from intention
to reusable runtime foundation.
Future protected screens should register commands
instead of inventing one-off keyboard behavior.

Next step:
Extend keyboard command registration across the remaining SA governance screens,
then carry the same pattern into org masters and upcoming HR modules

## Entry 029

Date:
2026-03-28

Roadmap step:
Protected Session Cluster Realignment - post-validation UX polish and client refresh hardening

Status:
COMPLETED

What was done:
- hardened frontend boot against stale client-shell cache state so deploys no longer depend on users manually pressing Ctrl+F5
- upgraded governed new-window loading with branded artwork,
  loading animation,
  and rotating security/data-hygiene guidance
- restored shared ERP branding in the protected shell sidebar using the public icon asset
- exposed the governed `New Window` action from all protected pages instead of only the dashboard home screen
- kept the same backend-authoritative max-3 multi-window rules while improving practical day-to-day workflow access

What changed in repo:
- frontend/src/main.jsx
- frontend/src/auth/redirectGuidance.js
- frontend/src/admin/AuthResolver.jsx
- frontend/src/store/sessionCluster.js
- frontend/src/layout/MenuShell.jsx
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- frontend lint completed successfully
- frontend build completed successfully
- live validation confirmed users can launch governed new windows from non-home protected pages
- live validation confirmed the branded loader experience now appears for both redirect handoff and new-window expansion

Problems or blockers:
- stale browser environments created before this hardening may still need one final deploy cycle before all users naturally converge onto the fresh client shell

Decision or note:
The session-cluster feature set is now not only functionally stable,
but also practical for side-by-side report checking and cross-screen ERP workflows without forcing users back to Home before opening another governed window.

Next step:
Continue from the next roadmap item outside protected session-cluster work unless a new production issue appears

## Entry 030

Date:
2026-03-28

Roadmap step:
Keyboard-Native UI Phase - shell grammar rebuild, canonical templates, and first SA surface conversion

Status:
COMPLETED

What was done:
- rebuilt the protected frontend shell around fixed keyboard-owned zones:
  menu,
  action rail,
  and work canvas
- kept `Alt+M`,
  `Alt+A`,
  and `Alt+C` meaningful on task screens instead of only dashboard-like surfaces
- replaced the old card-oriented screen scaffold with dense operator-work-canvas templates for:
  entry form,
  master list,
  approval review,
  and report filter screens
- strengthened dense-form traversal so section jumps now work through reusable shared behavior
- restyled the command bar and shared modal layer to match the new keyboard-native shell grammar
- rebuilt `SA Company Create` as the first canonical entry-form surface on the new template
- rebuilt `SA Users` as the first canonical master-list surface on the new template
- preserved current protected/session/security/governance behavior while replacing the frontend interaction model

What changed in repo:
- frontend/src/layout/MenuShell.jsx
- frontend/src/components/templates/ErpScreenScaffold.jsx
- frontend/src/components/templates/ErpEntryFormTemplate.jsx
- frontend/src/components/templates/ErpMasterListTemplate.jsx
- frontend/src/components/templates/ErpApprovalReviewTemplate.jsx
- frontend/src/components/templates/ErpReportFilterTemplate.jsx
- frontend/src/hooks/useErpDenseFormNavigation.js
- frontend/src/components/ErpCommandPalette.jsx
- frontend/src/components/layer/ModalBase.jsx
- frontend/src/components/inputs/QuickFilterInput.jsx
- frontend/src/admin/sa/screens/SACompanyCreate.jsx
- frontend/src/admin/sa/screens/SAUsers.jsx
- frontend/src/index.css
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- frontend lint completed successfully
- frontend build completed successfully
- the rebuild was applied without touching session-cluster,
  lock,
  logout,
  idle,
  or route/menu governance behavior

Problems or blockers:
- only the first canonical entry-form and master-list examples have been rebuilt so far;
  the remaining SA governance screens still need migration into the same template system
- shared picker behavior and deeper table-level roving patterns still need broader rollout across more screens

Decision or note:
The frontend interaction model is now being treated as replaceable structure,
not as an admin UI to be lightly polished.
Future org masters,
governance surfaces,
and HR modules must consume this shell and template grammar instead of reviving the old card/admin layout.

Next step:
Carry the same keyboard-native template system into the remaining SA governance screens,
then start the org-master wave directly on these reusable templates

## Entry 031

Date:
2026-03-28

Roadmap step:
Keyboard-Native UI Phase - universal shortcut visibility and current-screen help wiring

Status:
COMPLETED

What was done:
- added universal registry-backed shortcut visibility for protected screens
- wired the shell to read current-route screen commands and screen hotkeys directly from the shared registries
- exposed current-screen hotkeys visibly in:
  shell help,
  action rail,
  and footer strip
- exposed current-screen commands visibly in the stable action rail so operators no longer need to depend only on the command bar to discover available actions
- kept the same protected-shell,
  session-cluster,
  lock,
  logout,
  and route/menu governance behavior unchanged while extending keyboard discoverability

What changed in repo:
- frontend/src/layout/MenuShell.jsx
- frontend/src/store/erpScreenHotkeys.js
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- frontend lint completed successfully
- frontend build completed successfully
- registered screen hotkeys now have a reusable shell-level visibility path
- registered screen commands now have a reusable shell-level visibility path

Problems or blockers:
- visible help can only show actions already registered by each screen;
  any screen without route-level registrations will still show only shell defaults
- repo state still records broader backend/runtime items as HALF-DONE or DEFERRED,
  so the full ERP cannot yet be declared globally complete

Decision or note:
Keyboard help is now a platform feature of the protected shell,
not a one-off overlay.
From this point forward,
every protected screen should register commands and hotkeys so the shell can expose them deterministically.

Next step:
Continue migrating remaining screens and missing workflow surfaces into the same registry-backed keyboard-native model,
while closing the separately documented backend and DB state gaps gate-by-gate

## Entry 032

Date:
2026-03-28

Roadmap step:
Keyboard-Native UI Phase - visible governance-surface rebuild pass

Status:
COMPLETED

What was done:
- rebuilt the inner working surfaces of key SA governance pages so they no longer read as leftover light admin cards inside the new shell
- restyled:
  approval rules,
  role permissions,
  company module map,
  user scope,
  and parent-company picker drawer
  into the same dense operator-work-canvas grammar
- moved row cards,
  editors,
  selection surfaces,
  and destructive actions into the darker governed shell language so the governance pages now visibly match the rebuild direction
- aligned the shared drawer layer with the same protected keyboard-native visual system as the command bar and modal overlays

What changed in repo:
- frontend/src/admin/sa/screens/SAApprovalRules.jsx
- frontend/src/admin/sa/screens/SARolePermissions.jsx
- frontend/src/admin/sa/screens/SACompanyModuleMap.jsx
- frontend/src/admin/sa/screens/SAUserScope.jsx
- frontend/src/components/layer/DrawerBase.jsx
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- frontend build completed successfully
- frontend lint completed successfully
- governance pages now inherit visibly rebuilt inner surfaces instead of only the outer shell/template layer

Problems or blockers:
- other governance and master screens still need the same direct inner-surface rebuild pass
- this is still frontend interaction work only;
  broader backend and DB state-file gaps remain separately tracked

Decision or note:
This closes the most obvious mismatch the user reported:
the governance pages should now visibly look rebuilt,
not only technically wrapped by the new shell.

Next step:
Continue the same visible rebuild pass across the remaining SA and non-SA operational screens until the old admin-card grammar is fully eliminated

# 6. Initial Program Entry

Date:
2026-03-26

Roadmap step:
Step 1 - SA Control Plane Baseline Freeze

Status:
COMPLETED

What was done:
- created dedicated roadmap folder under docs
- created full chronological ERP roadmap
- created persistent execution log file
- declared SA-led ERP build-up as the next official program

What changed in repo:
- docs/ERP build roadmap/FULL_ERP_BUILD_ROADMAP.md
- docs/ERP build roadmap/ERP_BUILD_PROGRESS_LOG.md

What was verified:
- roadmap file exists
- log file exists
- chronology order is defined

Problems or blockers:
- none at this step

Decision or note:
We will execute the ERP build program strictly in roadmap order
and keep this file updated continuously.

Next step:
Step 2 - SA Dashboard Information Architecture
