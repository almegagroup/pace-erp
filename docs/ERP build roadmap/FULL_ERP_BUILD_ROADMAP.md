# Full ERP Build Roadmap

Purpose:
This document is the execution roadmap for building the full ERP system from the current stable foundation.

Primary control model:
SA is the top authority.
SA must be able to configure, govern, and operate the full ERP control plane.

Execution rule:
We will work strictly in chronology order.
We do not skip unresolved dependencies.
We update the companion log after every meaningful step.

Companion log:
ERP_BUILD_PROGRESS_LOG.md

Reference foundations:
- docs/ACL_SSOT.md
- docs/PACE_ERP_STATE.md
- docs/PACE_ERP_STATUS_CONSOLIDATED.md
- docs/Base Docs/FILE_HEADER_STANDARD.md
- TEMP_UI_BOOT_LOG.md

---

# 0. Current Start Point

Current baseline:
- public auth flow is working
- protected shells are working
- session lifecycle is stabilized
- workspace lock is working
- same-browser single-tab enforcement is working
- core SA shell exists
- signup approval backend exists
- core admin handlers already exist in several areas

Meaning:
The system is now ready to move from bootstrap and hardening
into full ERP control-plane build-up.

---

# 1. Final Target

Final target state:
SA can bootstrap and control the full ERP system without direct DB intervention.

That includes:
- org structure creation
- user onboarding approval
- user state control
- role assignment
- module enablement
- ACL governance
- menu governance
- workflow and approval governance
- session governance
- audit visibility
- module-by-module ERP rollout

---

# 2. Delivery Principles

Principle 1:
SA control plane comes before ACL user experience expansion.

Principle 2:
Backend authority must exist before admin UI consumes it.

Principle 3:
Every admin screen must map to an authoritative backend route.

Principle 4:
No module rollout starts before its governance surface exists.

Principle 5:
Every phase must end with a clear exit state before the next phase starts.

Principle 6:
All new repo work must follow the existing repository writing pattern.

---

# 2A. Repository Execution Standard

This roadmap does not allow ad-hoc file writing styles.

Every new implementation must follow the same repo discipline already used in this codebase.

That includes:
- proper file headers
- file purpose declaration
- authority declaration
- gate and phase identification where applicable
- deterministic naming
- existing script structure style
- existing migration structure style
- existing documentation structure style

Script-writing rule:
If the repo already has an established pattern for a file category,
new files of that category must follow the same pattern.

Examples:
- backend handlers must follow the established handler structure
- frontend files must follow the established identification style where used
- pipeline files must preserve the existing gate and authority language
- docs must remain execution-readable and structured

Migration-writing rule:
New migration files must follow the existing migration naming convention exactly.

That means:
- timestamp-first naming
- gate or milestone identification where applicable
- descriptive suffix naming
- same SQL layout discipline as the existing migration set

Important rule:
We do not introduce random file styles,
random headers,
random naming schemes,
or random migration formatting.

We build new work in the same language and structure
as the current repo standard.

Review rule for all future roadmap steps:
- header present where required
- purpose clear
- file identity clear
- naming matches repo convention
- migration naming matches existing pattern
- implementation style matches neighboring files

---

# 3. Roadmap Chronology

## Step 1. SA Control Plane Baseline Freeze

Goal:
Formally freeze the current stable foundation and declare the next build program.

Build:
- confirm current auth, shell, session, lock, and single-tab behavior as baseline
- confirm which existing SA backend handlers are already available
- confirm which SA screens already exist and which are placeholders
- define the exact execution sequence of the ERP build program

Exit criteria:
- roadmap accepted
- progress log started
- current baseline declared stable enough for ERP build-up

## Step 2. SA Dashboard Information Architecture

Goal:
Turn SA shell into a real control panel instead of only a landing shell.

Build:
- define SA navigation sections
- define dashboard home cards and shortcuts
- define control categories
- define route map for all SA screens

Core SA sections:
- control panel
- signup requests
- users
- sessions
- audit
- company master
- group master
- project master
- department master
- role and ACL governance
- menu governance
- module governance
- workflow and approval governance
- diagnostics

Exit criteria:
- final SA menu map declared
- every SA screen has an owner and purpose
- no orphan SA screen remains

Step 2 output:
Define the SA control plane in the following structure.

### SA Control Plane - Final Section Map

Section A - Command Center
- SA Home
- Control Panel
- System Health
- Session Control
- Audit Viewer

Section B - Onboarding and User Governance
- Signup Requests
- User Directory
- User State Control
- User Role Assignment
- User Scope Mapping

Section C - Org Masters
- Company Master
- Group Master
- Company to Group Mapping
- Project Master
- Department Master

Section D - Module and Access Governance
- Company Module Map
- Role Permission Governance
- Capability Pack Governance
- Menu Governance
- ACL Version Governance
- User Override Governance

Section E - Workflow and Approval Governance
- Approval Rule Control
- Approver Map Governance
- Approval Requirement Toggle by module or action
- Workflow Simulation or Preview

### Step 2 - Route Blueprint

Core routes that must exist after Step 2 design finalization:
- /sa/home
- /sa/control-panel
- /sa/system-health
- /sa/sessions
- /sa/audit
- /sa/signup-requests
- /sa/users
- /sa/users/roles
- /sa/users/scope
- /sa/company
- /sa/company/create
- /sa/groups
- /sa/groups/map-company
- /sa/projects
- /sa/departments
- /sa/modules
- /sa/acl/roles
- /sa/acl/capabilities
- /sa/acl/versions
- /sa/menu
- /sa/workflow
- /sa/approvals

### Step 2 - Current Inventory Snapshot

Current frontend SA routes observed:
- /sa/home
- /sa/control-panel
- /sa/system-health
- /sa/sessions
- /sa/audit
- /sa/company/create
- /sa/users
- /sa/users/roles
- /sa/signup-requests

Current backend admin capability already present:
- signup request review
- company create
- group create and map
- project create and list
- department create
- user list and state change
- user role change
- session list and revoke
- audit list
- diagnostics and control panel

Meaning:
Step 2 is not about inventing the admin universe from zero.
It is about aligning existing backend authority
with a complete frontend SA control-plane map.

### Step 2 - First Delivery Priority

We should define and then build the SA control plane in this order:

1. Command Center
2. Onboarding and User Governance
3. Org Masters
4. Module and Access Governance
5. Workflow and Approval Governance

### Step 2 - /sa/control-panel Screen Contract

Purpose:
This is the SA command center.
It is not a data-entry screen.
It is the operational overview and launch surface
for the full ERP control plane.

Primary backend source:
- GET /api/admin/control-panel

Secondary linked surfaces:
- /sa/system-health
- /sa/sessions
- /sa/audit
- /sa/signup-requests
- /sa/users
- /sa/company

The screen should contain the following blocks:

Block 1 - System Status Summary
- system version
- database status
- quick runtime status badge

Block 2 - ERP Counters
- user count
- active session count
- pending signup count when available
- audit activity count when available

Block 3 - Recent Sessions Preview
- latest active sessions
- session id short form
- auth user id short form
- created at
- last seen at
- open full session control action

Block 4 - Recent Admin Audit Preview
- latest admin actions
- action code
- admin user id
- performed at
- success or failed status
- open full audit viewer action

Block 5 - SA Quick Launch
- go to signup requests
- go to user control
- go to company master
- go to session control
- go to audit viewer
- go to system health

Block 6 - Priority Alerts Strip
- database down
- no active session data
- signup queue pending
- audit failures or risky events when available

Block 7 - Build Program Shortcuts
- org masters
- user governance
- ACL governance
- menu governance
- workflow governance

Design rule:
The control panel must act like an enterprise command center,
not a simple card grid.

It should answer:
- Is the ERP operational?
- Where does SA need attention right now?
- Which governance surface should SA open next?

### Step 2 - /sa/users Screen Contract

Purpose:
This is the SA user directory and lifecycle control surface.
It gives SA direct visibility into user state and current role posture
before the dedicated role and scope screens are built.

Primary backend source:
- GET /api/admin/users

State governance action:
- POST /api/admin/users/state

Deferred but already existing authority:
- POST /api/admin/users/role

The screen should contain the following blocks:

Block 1 - User Governance Summary
- total governable users
- active user count
- disabled user count
- privileged role count

Block 2 - User State Filter
- ALL
- ACTIVE
- DISABLED

Block 3 - User Directory Table
- user_code
- auth user id short form
- current role visibility
- current state badge
- created at
- activate or disable action

Contract gap check:
- GET /api/admin/users must expose role_code and role_rank
- dedicated role assignment remains a later route at /sa/users/roles

Design rule:
The first /sa/users build is about authoritative visibility
and safe state control.
It should not wait for the full user detail workflow
to become useful.

### Step 2 - /sa/signup-requests Screen Contract

Purpose:
This is the SA onboarding intake queue.
It gives SA a direct approval and rejection surface
for incoming ERP access requests before user mapping begins.

Primary backend source:
- GET /api/admin/signup-requests

Decision actions:
- POST /api/admin/signup-requests/approve
- POST /api/admin/signup-requests/reject

The screen should contain the following blocks:

Block 1 - Intake Summary
- total pending requests
- requests with company hint
- requests with phone contact
- requests with designation hint

Block 2 - Request Review Table
- requester name
- auth user id short form
- parent company hint
- designation hint
- phone number
- submitted at
- approve action
- reject action

Design rule:
The signup queue must be operational,
not only informational.
SA should be able to process onboarding decisions
without leaving the control surface.

Important rule:
Approval and rejection remain DB-owned atomic actions.
Frontend only sends the decision to the authoritative backend route.

### Step 2 - /sa/users/roles Screen Contract

Purpose:
This is the dedicated SA role assignment workspace.
It lets SA assign or change the canonical ERP role
without mixing that decision into broader lifecycle screens.

Primary backend source:
- GET /api/admin/users

Role decision action:
- POST /api/admin/users/role

The screen should contain the following blocks:

Block 1 - Role Governance Summary
- total users in scope
- assigned role count
- unassigned role count
- manager tier count

Block 2 - Role Filter Surface
- all roles
- unassigned
- selected canonical role slices

Block 3 - Role Assignment Table
- user_code
- auth user id short form
- current role badge
- next role selector
- current state visibility
- apply role action

Important rule:
Role assignment must remain authoritative even if
the user has no existing role row.
Backend write behaviour therefore must tolerate
both update and first-time assignment states.

### Step 2 - /sa/users/scope Screen Contract

Purpose:
This is the dedicated SA user scope governance workspace.
It lets SA separate HR identity truth from operational work truth
and prepare a user for real ERP operation without direct DB mapping.

Business interpretation:
- Parent Company = HR identity truth
- Work Company = operational work scope
- Project is reusable
- Module assignment is separate from user scope
- approval readiness depends on later exact work scope governance,
  not on vague role assignment only

Primary backend sources:
- GET /api/admin/users
- future user scope read endpoint

Required future write actions:
- map user to parent company
- map user to work company
- map user to project
- map user to department

The screen should contain the following blocks:

Block 1 - User Scope Summary
- user_code
- user_name
- current state
- current role
- parent company
- count of mapped work companies
- count of mapped projects when available
- department visibility when available

Block 2 - Parent Company Binding
- exactly one parent company selector
- current parent company display
- explicit note that HR identity and HR approvals bind here

Block 3 - Work Company Mapping
- multi-select or controlled assignment list
- current work companies
- add and remove work company actions
- explicit note that operational work can only happen inside these companies

Block 4 - Project Scope Hook
- reusable project visibility
- project assignment summary
- future project mapping action surface

Block 5 - Department Scope Hook
- department assignment summary
- future department mapping action surface

Block 6 - Readiness Strip
- missing parent company
- no work company assigned
- no role assigned
- user not yet operationally ready

Important rules:
- every user must have exactly one parent company
- a user may have one or many work companies
- HR truth must never be confused with operational scope
- user scope does not grant blanket approval authority
- user scope does not duplicate module assignment governance

Exit condition for this screen:
- SA can take an approved user,
  bind HR identity truth,
  bind operational company scope,
  and make later project and department governance possible
  without manual DB work

## Step 3. Org Master Build-Out

Goal:
Give SA the ability to create and govern ERP organizational structure.

Build:
- company master UI consumption
- company state management
- group master UI consumption
- company to group mapping
- project master UI consumption
- department master UI consumption

Required outputs:
- company list and create flow
- group list and create flow
- group to company map flow
- project list and create flow
- department list and create flow

Exit criteria:
- SA can create full org skeleton from UI
- all created records are visible and governable
- state changes are reflected correctly

## Step 4. Signup and User Governance Completion

Goal:
Give SA full control over user intake and lifecycle.

Build:
- signup request list screen
- signup request approval and rejection workflow
- approved user visibility
- active and disabled user list
- user state change UI
- self-lockout safe handling confirmation

Required outputs:
- pending signup intake queue
- approve and reject action flow
- user lifecycle governance panel

Exit criteria:
- SA can process onboarding end-to-end
- SA can disable users and terminate access safely
- user governance no longer depends on direct DB inspection

## Step 5. Role Assignment and User Mapping Governance

Goal:
Let SA place users inside the ERP structure correctly.

Build:
- assign role to user
- map user to parent company
- map user to work company
- map user to project
- map user to department
- define reporting line or approver chain anchors where needed

Important rule:
User identity exists first.
Operational mapping comes after approval.

Exit criteria:
- SA can take an approved user and make the user operationally ready
- no ACL user needs manual DB mapping to enter the ERP universe

## Step 6. Module Governance by SA

Goal:
Let SA decide which companies can use which ERP modules.

Build:
- company module map UI
- module enable and disable controls
- module state visibility
- module rollout policy per company

Exit criteria:
- SA can enable or disable modules by company from UI
- module availability is no longer implicit or manual

## Step 7. ACL Governance Control Plane

Goal:
Let SA govern ERP permission structure from admin UI.

Build:
- role permission governance
- capability pack governance
- role to capability binding
- company module and role interaction visibility
- user override governance if allowed by runtime safety
- ACL version preparation and activation flow

Required outputs:
- role permission editor
- capability registry
- role capability map
- ACL version viewer
- activate and rollback controls if supported

Exit criteria:
- SA can change governance inputs from UI
- ACL structure becomes operable, not only declared

## Step 8. Menu Governance Control Plane

Goal:
Let SA govern the visible ERP universe.

Build:
- menu master admin UI
- menu hierarchy governance
- menu to resource mapping governance
- menu visibility preview
- snapshot regeneration or refresh trigger rules

Exit criteria:
- SA can manage menu structure without code edits
- menu and permission governance become coordinated

## Step 9. Workflow and Approval Governance

Goal:
Let SA decide where approval is required and how approval moves.

Build:
- approval-required toggle by module or action
- approver rule governance
- approval chain configuration
- workflow map visibility
- simulation or preview where possible

Important business target:
Not every module needs approval.
SA must be able to decide where approval applies and where it does not.

Exit criteria:
- approval system becomes configurable
- workflow governance is no longer hardcoded

## Step 10. Session, Audit, and Operations Governance

Goal:
Give SA operational visibility over the ERP runtime.

Build:
- active session screen
- session revoke controls
- audit log screen
- admin action history
- diagnostic and health panels

Exit criteria:
- SA can observe active ERP runtime state
- SA can revoke suspicious or stale access
- admin actions are traceable

## Step 11. SA Configuration Completion Pass

Goal:
Reach the point where SA can fully bootstrap a fresh ERP tenant from UI.

Bootstrap flow target:
1. create company
2. create group
3. map company to group
4. create project
5. create department
6. approve signup
7. assign role
8. map user operational scope
9. enable modules
10. configure ACL
11. configure menu
12. configure approvals
13. verify session and audit controls

Exit criteria:
- fresh ERP environment can be configured fully from SA UI
- no hidden manual bootstrap step remains

## Step 12. ACL User Universe Activation

Goal:
After SA control plane is complete, expand the ACL user universe safely.

Build:
- user dashboard routes and shells by module
- ACL user navigation surfaces
- functional screens for approved and mapped users
- approval-aware actions

Rule:
We do not scale ACL user feature screens before SA governance is ready.

Exit criteria:
- ACL user side starts from a governed system, not a partially manual system

## Step 13. ERP Module Rollout Framework

Goal:
Define how every business module will be built from now on.

Per-module build order:
1. master data
2. mappings
3. admin governance
4. ACL resources and menu nodes
5. workflow and approval rules
6. backend handlers
7. UI screens
8. reports and audit hooks
9. QA and freeze

First module wave recommendation:
- org masters completion
- user governance completion
- ACL governance completion
- approval governance completion

Second module wave recommendation:
- procurement
- inventory
- projects or operations
- finance-adjacent modules only after upstream control truth is ready

## Step 14. Final Freeze and Launch Readiness

Goal:
Move from build-up mode into controlled rollout mode.

Build:
- close remaining manual bootstrap gaps
- freeze SA control plane
- freeze ACL governance path
- freeze module rollout standard
- run end-to-end admin bootstrap rehearsal

Exit criteria:
- SA can build and govern the ERP universe end-to-end
- module development can continue on a stable control foundation

---

# 4. Immediate Execution Queue

This is the order we should start with now:

1. Step 2 - SA Dashboard Information Architecture
2. Step 3 - Org Master Build-Out
3. Step 4 - Signup and User Governance Completion
4. Step 5 - Role Assignment and User Mapping Governance
5. Step 6 - Module Governance by SA
6. Step 7 - ACL Governance Control Plane
7. Step 8 - Menu Governance Control Plane
8. Step 9 - Workflow and Approval Governance
9. Step 10 - Session, Audit, and Operations Governance

---

# 5. Definition Of Done For This Program

The SA-led ERP build program is considered complete only when:
- SA can create the org structure from UI
- SA can approve and govern users from UI
- SA can assign role and scope from UI
- SA can enable modules from UI
- SA can govern ACL and menu from UI
- SA can configure approval behavior from UI
- SA can review sessions and audit from UI
- a fresh ERP setup can be bootstrapped without manual DB edits

---

# 6. Working Rule

We will always do the following after each completed step:
- update ERP_BUILD_PROGRESS_LOG.md
- mark what was completed
- mark what remains pending
- declare the next step clearly

We will also always enforce:
- repo-consistent headers
- repo-consistent script structure
- repo-consistent migration naming
- repo-consistent file-writing pattern
