# ERP Execution Sequence Realignment

Purpose:
This document realigns the ERP build execution sequence
after reviewing the current roadmap,
ACL SSOT,
Constitution,
and the latest architecture observations.

Companion references:
- FULL_ERP_BUILD_ROADMAP.md
- ERP_BUILD_PROGRESS_LOG.md
- docs/ACL_SSOT.md
- docs/Base Docs/PACE_ERP_CONSTITUTION_SSOT.md
- docs/PACE_ERP_STATE.md

Working rule:
We do not proceed by assumption.
We lock business truth first,
then align schema truth,
then align backend routes,
then align admin UI,
then expand governed user surfaces.

---

# 1. Current Situation

Current truth:
- public auth is stable
- protected shell is stable
- SA control-panel surfaces are partially built
- current Step 2 SA route build-up is still in progress
- keyboard-first protected UX work has advanced
- core ACL backend foundation exists in several areas

Meaning:
The repo is no longer at bootstrap stage.
But it is also not yet at a fully governed,
fully operable ERP control-plane state.

The next work must focus on alignment,
not random expansion.

---

# 2. Confirmed Architecture Truth

## 2.1 Parent Company vs Work Company

Locked interpretation:
- Parent Company = HR identity truth
- Work Company = operational work scope

Implications:
- every user must have exactly one Parent Company
- a user may have one or many Work Companies
- HR modules bind to Parent Company
- non-HR operational work binds to Work Company

Practical meaning:
One employee may belong to ASCL as Parent Company,
but may operate in multiple companies as Work Companies.

---

## 2.2 Project, Module, Page Structure

Locked business interpretation:
- Project is reusable
- Module belongs under Project
- Page or Resource belongs under Module
- Company assignment happens after that

Meaning:
We do NOT build a separate module per company.

Correct model:
- build one global Project
- build one global Module under that Project
- bind pages and resources under that Module
- assign that same Module to selected companies

Example:
- Supply Chain Management = Project
- Supply Chain = Module
- Planning / Create PO / Manage PO = Pages or Resources
- same Supply Chain module code may be assigned to ASCL and MCPL

Important rule:
Company-specific means assignment difference,
not duplicate module creation.

---

## 2.3 Approval Truth

Locked business interpretation:
- approval is selective
- SA decides which work needs approval
- not every work action needs approval
- specific users may be approvers
- same person being approver does NOT imply global approval authority
- approver visibility must be limited to assigned approval scope only

Target approval authority model:
- approval requirement must be tied to action or resource truth
- approver scope must be exact and narrow
- same user may be approver for one action,
  one module surface,
  one company,
  or multiple companies,
  but never automatically for everything

Director clarification:
- Director may be the highest approver
- no approver may exist above Director
- Director's own work is not subject to higher approval

---

# 3. What Is Already Aligned

The following areas are already directionally aligned enough
to continue building on:

- Parent Company truth exists through primary company logic
- multi-company operational scope exists structurally
- company-module assignment layer exists
- ACL precedence resolver exists
- precomputed ACL snapshot layer exists
- menu resource and menu snapshot foundations exist
- approver routing base table exists
- 2 to 3 approver structural bound exists
- duplicate approver role and duplicate explicit user protection exists
- Director highest-stage invariant exists

Meaning:
The repo already contains strong structural foundations.

---

# 4. What Is Not Yet Aligned

These are the important gaps now blocking clean execution order.

## Gap A - Page or Resource to Module binding is not yet explicit enough

Current issue:
The repo has menu resources and routes,
and it has module_registry,
but page or resource ownership under a specific module
is not yet the clear primary truth.

Impact:
We cannot cleanly express:
- Leave Request page belongs to HR module
- Request Approval page belongs to HR module
- Create PO page belongs to Supply Chain module
- Planning page belongs to Supply Chain module

without a stronger formal module to resource binding layer.

## Gap B - Approval policy is currently too module-centered

Current issue:
The repo already models approval policy inside module_registry.

But business truth now requires:
- approval is selective
- SA decides which work needs approval
- same module may contain some approval-required work
  and some non-approval work

Impact:
Approval truth must move or expand
from module-only thinking
to action or resource level truth.

## Gap C - Approver visibility scope is not yet governed tightly enough

Current issue:
Approver routing exists by company + module + stage.

But business truth now requires:
- Bikash may approve only the assigned work
- Bikash must not see all approvals of all work
  just because he is an approver somewhere

Impact:
Approver routing and approver inbox visibility
must be narrowed to exact approval scope.

## Gap D - Project truth needs final operational interpretation

Current issue:
The repo contains both old company-bound project truth
and later project decoupling direction.

Correct target:
- Project must be reusable
- Company assignment must happen through mapping,
  not by cloning the project per company

Impact:
We must treat project as reusable truth
before further module and scope UI work grows.

## Gap E - Many ACL and workflow foundations exist,
but are not yet fully operable through SA UI

Current issue:
Backend handlers and tables exist in several areas,
but route exposure and dedicated SA screens are still incomplete.

Impact:
We must avoid assuming governance is complete
only because structural backend files exist.

---

# 5. Final Corrected Hierarchy

This is the hierarchy we should now build against.

1. Project
2. Module
3. Page or Resource or Action
4. Company Assignment
5. User Scope
6. Approval Scope

Interpretation:

Project:
Reusable business program layer

Module:
Functional subsystem under a Project

Page or Resource or Action:
Actual working surfaces and governed actions

Company Assignment:
Which companies get that Module or resource family

User Scope:
Which user can work in which company,
project,
department,
or business scope

Approval Scope:
Which exact work needs approval,
who may approve it,
and who may see it

---

# 6. Ordered Execution Sequence

This is the corrected execution order from now.

## Step 1 - Lock the corrected business truth

Work:
- lock Project -> Module -> Page or Resource hierarchy
- lock Parent Company vs Work Company usage
- lock approval as selective work truth
- lock approver visibility as exact assigned scope only
- lock Director no-higher-approver rule in execution wording

Output:
- one written authority reference for execution

Why first:
If we skip this,
all downstream schema and UI work may drift.

## Step 2 - Confirm reusable Project truth

Work:
- align execution understanding around reusable projects
- treat company assignment as mapping layer
- reject duplicate project-per-company thinking

Output:
- Project is accepted as reusable global truth
- company-project mapping remains the assignment layer

Why before user scope:
User scope must know whether it binds to reusable projects
or company-owned projects.

## Step 3 - Introduce or tighten Module -> Resource truth

Work:
- define how each page or governed resource belongs to one module
- make page ownership explicit
- make approval-target ownership explicit

Output:
- every governed page or resource has module ownership
- no orphan page remains

Why before approval work:
Approval cannot be governed cleanly
if the system cannot say which module owns which work surface.

## Step 4 - Shift approval policy from module-only to exact work scope

Work:
- define approval-needed truth at action or resource scope
- keep module as grouping layer,
  not as the only approval policy layer
- allow same module to contain both:
  approval-required work and non-approval work

Output:
- SA can later decide approval need per governed work item

Why before approver governance:
We must know WHAT needs approval
before deciding WHO approves it.

## Step 5 - Tighten approver routing scope

Work:
- extend or refine approver truth so scope is exact
- approver assignment must never imply blanket approval visibility
- preserve:
  distinct role rule,
  2 to 3 approver bound,
  explicit user approver option,
  Director highest rule

Output:
- exact approval-scope routing model
- exact inbox visibility model

Why before approval UI:
Without this,
approval inbox design will leak authority.

## Step 6 - Expose governance backend surfaces cleanly

Work:
- expose the missing admin routes cleanly
- align backend routes with the corrected truth
- make route ownership explicit for:
  modules,
  approvals,
  approver rules,
  capabilities,
  overrides,
  versions,
  preview

Output:
- backend governance routes become consumable by SA UI

Why before large UI build:
The Constitution requires backend authority first.

## Step 7 - Finish current Step 2 SA route inventory gaps

Work:
- keep current SA command-center surfaces intact
- ensure no orphan route remains
- prepare the exact next route:
  /sa/users/scope

Output:
- Step 2 remains coherent
- user scope route becomes the next clean execution target

## Step 8 - Start User Scope Governance

This is the first point where we should begin /sa/users/scope.

Work:
- map user to Parent Company
- map user to Work Companies
- show role context
- show future Project and Department hooks
- keep HR truth and operational scope visibly separate

Output:
- real user scope governance surface

## Step 9 - Continue downstream governance

After user scope,
continue in this order:

1. company-project and project scope visibility if needed
2. module assignment by company
3. approval rule control
4. approver rule control
5. ACL governance
6. menu governance
7. preview-as-user
8. workflow and approval inbox surfaces

---

# 7. User Scope Start Gate

We should NOT start /sa/users/scope immediately
just because the route is next in the old roadmap.

We should start /sa/users/scope only after the following are true.

## Mandatory readiness conditions

- Project reusable truth is accepted
- Module to page or resource ownership is defined
- approval policy is no longer treated as module-only truth
- approver visibility model is narrowed to exact scope
- Parent Company vs Work Company interpretation is stable
- user scope screen contract is written
- required backend read and write contract for scope mapping is clear

## Meaning

User scope is not only:
- assign parent company
- assign work company

User scope is the first governed place where
project,
module,
company,
and approval readiness
start touching the same user reality.

So if upstream truth is vague,
user scope will become a patchwork screen.

We must prevent that.

---

# 8. What Is Already Safe To Do Before User Scope

These tasks are safe and recommended before /sa/users/scope starts:

- write the corrected authority model in docs
- define Project -> Module -> Resource ownership
- define approval-needed target unit
- define approver visibility target unit
- review affected existing tables and identify what stays
- review affected existing workflow logic and identify what must change
- write the /sa/users/scope contract after those truths are stable

---

# 9. Practical Build Order Summary

Short execution summary:

1. lock corrected business truth
2. lock reusable Project truth
3. lock Module -> Resource ownership
4. lock approval-needed target unit
5. lock approver visibility target unit
6. expose aligned backend governance routes
7. write /sa/users/scope contract
8. build /sa/users/scope
9. continue module governance
10. continue approval governance
11. continue ACL governance
12. continue menu governance
13. continue preview and workflow surfaces

---

# 10. Final Direction

The repo already has strong foundations.
But the next work must be alignment-first,
not screen-first.

We do not want:
- duplicate module thinking
- blanket approver authority
- module-only approval modeling
- orphan pages outside clear module ownership

We do want:
- reusable Projects
- reusable Modules
- company-wise assignment
- user-wise governed scope
- exact approval visibility
- exact admin control

This document is now the practical execution guide
for the next build phase before and through User Scope Governance.

# 11. Working Rule

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

---

# 12. Protected Session Cluster Realignment

This section is now added as a controlled next-phase execution guide
for protected ERP session behavior.

It must be read together with:
- Constitution
- Gate-2 Session
- Gate-3 Session Lifecycle
- Gate-8 Protected Navigation
- current protected-shell and workspace-lock behavior

This section does NOT authorize random implementation.
It defines the exact model to implement in a new session.

## 12.1 Locked Business Interpretation

Target operating model:
- one login creates one authoritative ERP session cluster
- one session cluster may open maximum 3 governed Home workspaces
- those 3 Home workspaces must open as separate browser windows
- they are NOT generic unlimited tabs
- all cluster members share the same backend session truth
- idle warning,
  idle expiry,
  absolute TTL,
  workspace lock,
  unlock,
  logout,
  admin revoke,
  and forced session replacement
  must remain cluster-synchronized

Meaning:
- if one window acknowledges idle warning,
  all cluster windows recover together
- if one window is locked,
  all cluster windows lock
- if one window is unlocked,
  all cluster windows unlock
- if one window logs out,
  all cluster windows log out
- if admin revokes the session,
  all cluster windows die together
- if the same login ID signs in again anywhere,
  the previous cluster dies fully
  and the new login starts a fresh cluster

Important boundary:
- this is not multi-login expansion
- this is controlled multi-window operation under one session authority

## 12.2 Constitution Interpretation

The Constitution must remain intact.

Locked authority rule:
- backend remains the only authority for session truth
- frontend may coordinate,
  display,
  and synchronize UX
  but frontend may never become the authority for:
  active session count,
  cluster legitimacy,
  revoke truth,
  TTL truth,
  or max-window enforcement

Meaning:
- frontend may use browser coordination helpers
- but max-3 enforcement must be backend-backed
- forced replacement on new login must be backend-backed
- all warnings and lock state must be explainable from session authority

Frontend authority remains:
- display
- focus handling
- window coordination
- broadcast relay

Backend authority remains:
- session creation
- session replacement
- cluster lifecycle
- window-slot admission
- revoke
- expiry
- session legitimacy

## 12.3 Explicit Target Model

The correct model is:

1. Login creates one backend session cluster
2. First protected Home window becomes cluster window 1
3. User may explicitly open window 2 and window 3 from inside the governed app
4. Window 4 must be denied
5. A fresh login anywhere using the same credentials revokes the old cluster
6. Old cluster windows must all hard logout
7. New cluster starts again from one Home window and may expand back up to 3

Important clarification:
- cluster expansion is by controlled "open new Home window" flow
- not by allowing arbitrary unlimited duplicated tabs
- if a user manually goes to login again,
  that is treated as a fresh login and old cluster must die

## 12.4 Window Form Rule

For this phase,
the governed expansion target is:
- separate browser windows

Not the target:
- arbitrary same-session tab duplication

Meaning:
- the official flow should open or register a new protected Home window
- same-session expansion must not depend on the user manually duplicating tabs
- browser-window membership must be deliberate and governable

---

# 13. Current Misalignment Against This Target

The repo currently contains the opposite behavior in key places:

- backend session create currently revokes all active sessions on each new login
- frontend protected shell currently enforces single-tab ownership
- workspace lock is currently browser-tab local
- idle warning state is currently frontend-local and not yet cluster-authoritative

Meaning:
- the current system protects single-session/single-tab behavior
- it does NOT yet implement controlled multi-window clustered operation

So this future change must be treated as architecture work,
not as a small UI tweak.

---

# 14. Required Execution Order For The Session Cluster Phase

This is the correct execution order for the future session-cluster implementation.

## Step SC-1 - Lock the authority contract in writing

Work:
- declare that one login creates one session cluster
- declare maximum cluster size = 3 Home windows
- declare separate-window target
- declare fresh login replaces old cluster
- declare cluster-wide sync rules for warning,
  lock,
  unlock,
  revoke,
  logout,
  and TTL

Output:
- written execution truth with no ambiguity

## Step SC-2 - Design backend session-cluster truth first

Work:
- define parent session cluster truth in backend storage
- define child window-slot truth in backend storage
- define max-3 admission rule in backend authority
- define replacement semantics for fresh login
- define what happens when a window closes unexpectedly

Output:
- backend-first cluster model
- no frontend-assumed admission logic

## Step SC-3 - Define lifecycle and synchronization events

Work:
- define exact cluster events:
  warning,
  warning acknowledged,
  lock,
  unlock,
  logout,
  revoke,
  expired,
  replaced by new login
- define how each event propagates to all windows
- define how stale windows detect cluster death

Output:
- event vocabulary for cluster synchronization

## Step SC-4 - Align protected-shell routing and shell ownership

Work:
- replace single-tab ownership thinking
  with governed cluster membership thinking
- protected shell must know whether the current window belongs to
  a valid admitted cluster slot
- invalid or excess windows must be rejected deterministically

Output:
- protected shell becomes cluster-aware

## Step SC-5 - Build frontend coordination only after backend truth exists

Work:
- add browser coordination for cluster windows
- sync warning state across all admitted windows
- sync lock/unlock across all admitted windows
- sync logout/revoke across all admitted windows
- keep backend as the final source of truth on every critical transition

Output:
- user-perceived cluster sync
- no frontend-only fake authority

## Step SC-6 - Add controlled "Open New Home Window" flow

Work:
- only governed protected Home surfaces may open additional windows
- new window must register as cluster window 2 or 3
- if cluster is already at 3,
  deny opening window 4
- expansion must open a separate browser window
  and not depend on manual tab duplication

Output:
- SAP-like 3-window work mode

## Step SC-7 - Final forced-replacement validation

Work:
- same-user fresh login anywhere must revoke old cluster
- all old windows must die together
- new login begins with one fresh Home window
- same behavior must hold even if the new login happens
  from the same browser in another page

Output:
- clean single-cluster-per-login guarantee

---

# 15. File Planning Rules For This Phase

This phase must follow existing repo patterns.

## 15.1 Header Pattern

All new implementation files must preserve the repo header style where applicable:
- File-ID
- File-Path
- Gate
- Phase
- Domain
- Purpose
- Authority

No ad-hoc undocumented file headers are allowed.

## 15.2 Naming Pattern

Use existing naming logic,
not new stylistic invention.

Backend:
- session core helpers stay under session-oriented files
- auth request handlers stay under auth handler naming
- route exposure stays under existing route files
- use existing dotted handler/helper style
  such as `session.create.ts`,
  `session.cookie.ts`,
  `*.handler.ts`

Frontend:
- store-level coordination files stay under `frontend/src/store`
- shell or route enforcement stays under `frontend/src/router`
- visual overlays stay under `frontend/src/components`
- use concise concern-based naming,
  not framework-fashion naming

Migrations:
- use timestamp-first migration naming
- keep gate and descriptive suffix in filename
- keep comment header aligned with existing migration pattern

## 15.3 Scripting Pattern

If supporting scripts are required:
- they must follow repo-consistent script structure
- they must not bypass existing backend authority
- they must not introduce shadow session state outside the governed model

## 15.4 Authority Placement Rule

Likely authority mapping for this phase:
- backend session truth = Gate-2 / Gate-3
- protected shell coordination = Gate-8
- admin revoke compatibility = existing admin session governance surface

No frontend-only shortcut may redefine these boundaries.

---

# 16. Implementation Guardrails

This phase must explicitly avoid the following mistakes:

- unlimited same-session tabs
- frontend-only max-window counting
- lock state that exists only in one browser window
- warning acknowledgement that clears only one window
- session replacement that kills only one surface while leaving others alive
- introducing a second authority source outside backend session truth

This phase must explicitly guarantee:

- one login -> one backend session cluster
- maximum 3 admitted Home windows
- separate-window governed expansion
- cluster-wide lock,
  unlock,
  warning,
  logout,
  revoke,
  and replacement behavior
- deterministic hard logout of all old windows on fresh login

This section is now part of the practical execution guide
and must govern the next implementation session for protected multi-window behavior.

---

# 17. Next Session Heads-Up

The next implementation session must begin from this exact understanding:

- do NOT continue single-tab thinking
- do NOT build generic unlimited tab support
- do NOT let frontend become session-cluster authority
- do build a backend-authoritative session cluster model
- do target maximum 3 governed Home windows
- do keep all 3 windows synchronized for:
  idle warning,
  idle logout,
  absolute TTL,
  workspace lock,
  unlock,
  revoke,
  logout,
  and fresh-login replacement

Implementation start rule:
- begin with Step SC-1 and Step SC-2 only
- do not jump into UI-first experimentation
- first write and align backend session-cluster truth,
  then align protected-shell membership,
  then align frontend coordination

Current repo warning:
- existing `singleTabSession` logic reflects the old policy
- existing session create logic reflects single-session replacement logic
- both must be treated as current-state inputs,
  not as the target design

Success condition for the next session:
- one fresh login starts one cluster
- user may expand that cluster to 3 governed Home windows
- all cluster windows stay synchronized
- any fresh login elsewhere kills the old cluster completely

---

# 18. Runtime Validation Closure

Date:
2026-03-28

Runtime validation and stabilization have now been completed for this realignment target.

Confirmed outcome:
- fresh login creates one backend-authoritative session cluster
- governed Home-window expansion opens separate ERP windows correctly
- the practical Home-window limit is enforced at 3 admitted windows
- a 4th open attempt is blocked without logging the user out
- lock,
  warning,
  logout,
  revoke,
  and replacement coordination remain cluster-oriented,
  not single-tab oriented
- login handoff and redirect experience have been tightened for faster protected entry

UX closure notes:
- the visible shell entrypoint for governed expansion is now the `New Window` button
- reserved browser shortcut handling was intentionally removed instead of forcing a fragile keyboard binding
- redirect handoff now shows loading motion and rotating data-security/data-hygiene guidance while the protected home route resolves

Residual implementation note:
- child-window auto-close on logout remains best-effort because browser popup-closing rules are not fully deterministic,
  but the implemented path now prefers closure for auxiliary windows and keeps the primary surface as the returning login anchor

Execution status for this realignment:
- SC target is functionally closed for the governed Home-window scope
- future work should treat this session-cluster model as current-state baseline,
  not as experimental partial wiring
