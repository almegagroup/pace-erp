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
