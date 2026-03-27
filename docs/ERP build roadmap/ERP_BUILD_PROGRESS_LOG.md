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

---

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
