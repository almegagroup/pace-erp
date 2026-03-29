# ERP Keyboard-Native UI Execution Plan

Purpose:
This document locks the practical build direction
for the next ERP frontend phase.

It exists because the target is now clearer:
the ERP must become keyboard-main,
not just shortcut-enabled.

This does NOT mean copying Tally visuals.
It means adopting a keyboard-native operating model
that gives the same speed,
focus,
and low-mouse workflow advantage,
while preserving our governed ERP architecture.

Companion references:
- FULL_ERP_BUILD_ROADMAP.md
- ERP_EXECUTION_SEQUENCE_REALIGNMENT.md
- ERP_BUILD_PROGRESS_LOG.md
- docs/ACL_SSOT.md
- docs/Base Docs/ERP_KEYBOARD_FIRST_INTERACTION_STANDARD.md
- docs/Base Docs/PACE_ERP_CONSTITUTION_SSOT.md

Working rule:
We do not break already-working governance and session behavior.
We rebuild the UI interaction model around keyboard dominance
while preserving backend authority and protected-shell safety.

---

# 1. Locked User Intent

The requested destination is:
- full keyboard-operated ERP
- mouse usage close to zero for primary work
- dense,
  fast,
  operator-friendly screens
- deterministic focus movement
- no dead-end workflows that force mouse recovery

Important clarification:
The target is NOT:
- a superficial shortcut layer over the current card-style UI
- a Tally visual clone
- a separate new system that ignores current ERP governance

The target IS:
- a keyboard-native ERP shell
- keyboard-native screen templates
- keyboard-native dense data-entry forms
- keyboard-native lists,
  filters,
  approvals,
  and reports

---

# 2. Non-Negotiable Compatibility

The following already-built features must remain intact
throughout the UI rebuild:

- idle warning
- idle logout
- absolute warning
- absolute logout
- workspace lock screen
- governed max-3 window session cluster
- cluster-wide logout / lock / revoke / replacement behavior
- auto-suggest / quick filter behavior
- menu snapshot authority
- route guard authority
- logout confirmation flow

Meaning:
The frontend interaction model may change,
but these protections and governance behaviors must survive unchanged.

---

# 3. Current Truth

Current repo truth:
- backend governance foundation is already strong in many areas
- protected shell is stable
- session-cluster work is complete enough for current-state use
- keyboard command bar foundation now exists
- route-level keyboard hotkey registry now exists
- current protected SA screens already have command-bar coverage

But:
- the current UI is still mostly admin-card style
- the current UI is not yet keyboard-native by layout
- existing keyboard work is still an overlay on top of the present UI

Meaning:
The repo is ready for a controlled interaction-model rebuild,
not for random shortcut accumulation.

---

# 4. Final Target Model

The correct target model is:

1. keyboard-native shell
2. keyboard-native screen templates
3. keyboard-native shared components
4. keyboard-native governance screens
5. keyboard-native HR operational modules

Interpretation:

Keyboard-native shell:
- fixed zones
- deterministic focus ownership
- stable action rail
- stable footer hints
- stable command/help strip

Keyboard-native screen templates:
- master list/manage screen
- entry form screen
- approval/review screen
- report/filter screen

Keyboard-native shared components:
- filter input
- auto-suggest picker
- dropdown/select
- checkbox groups
- grid/table traversal
- confirm overlays
- drawer/popup selectors

Keyboard-native governance screens:
- SA control surfaces
- org masters
- user governance
- module/approval governance

Keyboard-native HR operational modules:
- Leave
- Out Work
- later HR flows

---

# 5. UX Rules That Must Hold Everywhere

## 5.1 Focus Is Absolute

- every screen must expose one primary focus target
- focus must never vanish into blank space
- overlays must trap focus
- closing overlay must restore focus safely

## 5.2 Same Action Means Same Result

- `Esc` = close / back / cancel
- `Ctrl+K` = command bar
- `Ctrl+S` = save when the screen supports save
- `Alt+R` = refresh when the screen supports refresh
- `Alt+Shift+F` = search/filter focus when available
- `Alt+Shift+P` = primary working target when available
- `Alt+H` = home
- `Alt+M` = menu zone
- `Alt+A` = action zone
- `Alt+C` = content zone
- `Alt+L` = lock workspace

## 5.3 Dense Work Must Not Need Mouse Rescue

- list navigation must be keyboard reachable
- filters must be keyboard reachable
- pickers must be keyboard reachable
- save/approve/reject/apply actions must be keyboard reachable
- common related-screen jumps must be keyboard reachable

## 5.4 Browser-Reserved Key Traps Must Be Avoided

- do not rely on fragile browser-reserved shortcuts
- when a key is unreliable,
  command bar and deterministic focus path must remain sufficient

---

# 6. Build Strategy

The rebuild must happen in two coordinated layers.

## 6.1 Global Layer

This is the shared keyboard-native framework:

- command bar
- screen hotkey registry
- focus zone manager
- shared dense-form traversal
- shared roving focus for tables and lists
- shared picker behavior
- shared footer/action hint system
- shared screen action registration model

This layer is reusable.
It must be written once and consumed everywhere.

## 6.2 Page Layer

Each page must still define:

- its primary focus target
- its screen actions
- its save action
- its refresh action
- its search/filter action
- its section jump points
- its row or form traversal behavior

Meaning:
Global framework reduces repeated code,
but page-level keyboard mapping still remains necessary.

---

# 7. Ordered Execution Sequence

This is the corrected sequence for the keyboard-native UI phase.

## Step KUI-1 - Lock the interaction truth

Work:
- lock that the target is keyboard-native,
  not shortcut-patched
- lock that current protected/session features stay intact
- lock that Tally-like speed is the goal,
  but not visual cloning

Output:
- one written execution authority reference

## Step KUI-2 - Complete the global keyboard framework

Work:
- command bar
- screen command registry
- screen hotkey registry
- focus-zone routing
- shared save / refresh / search / primary-target hotkeys

Status:
- already substantially done

Output:
- reusable keyboard framework

## Step KUI-3 - Add dense-form traversal foundation

Work:
- define shared `Enter` next-field rule
- define shared `Shift+Enter` previous-field rule
- define textarea exceptions
- define save-on-final-row rule where appropriate
- define how sections jump without mouse

Output:
- reusable form-entry engine for future HR modules

Why now:
Without this,
the UI will still feel admin-panel-like instead of operator-fast.

## Step KUI-4 - Define 4 canonical screen templates

Work:
- master list/manage template
- entry form template
- approval/review template
- report/filter template

Output:
- one template set that future ERP screens reuse

Why before broader rebuild:
Otherwise every new screen will drift stylistically and behaviorally.

## Step KUI-5 - Retrofit current implemented screens into keyboard-native structure

Work:
- SA surfaces move from card/admin layout
  toward keyboard-native structure
- retain their current backend and feature behavior
- keep command-bar and hotkey coverage

Targets:
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

Output:
- current control plane stops being only shortcut-enabled
  and becomes structurally keyboard-native

## Step KUI-6 - Build org-master screens directly on the new templates

Work:
- Company Master Manage
- Group Master
- Company -> Group Mapping
- Project Master
- Department Master

Output:
- operational org governance screens
  built natively in the new model

Why before HR module go-live:
These masters are upstream truth for user scope and module rollout.

## Step KUI-7 - Build governance screens still missing from SA control plane

Work:
- company-module map
- approval rule control
- approver scope governance
- ACL governance UI where immediately needed

Output:
- SA gains the practical controls needed before live HR rollout

## Step KUI-8 - Build Leave and Out Work modules on the keyboard-native templates

Work:
- Leave entry
- Leave review / approval
- Out Work entry
- Out Work review / approval
- menu exposure
- role/scope usage

Output:
- first live HR modules

## Step KUI-9 - Run live validation in real work mode

Work:
- keyboard-only walkthrough
- multi-window workflow test
- lock/logout/idle compatibility test
- approval test
- report/filter traversal test

Output:
- proof that the system is practically usable without mouse dependence

---

# 8. Immediate Work Order

This is the exact next sequence from now.

## Immediate Task 1

Complete shared dense-form traversal.

Meaning:
- `Enter`
- `Shift+Enter`
- section jump
- picker interaction
- row transition

must become reusable global behavior.

## Immediate Task 2

Design and build the first keyboard-native screen templates:
- master list/manage template
- entry form template

These two templates are enough to start the org-master wave.

## Immediate Task 3

Rebuild one current SA screen
as the first canonical example
using the new template.

Best candidates:
- SA Company Create
or
- SA Users

## Immediate Task 4

Once the template proves stable,
carry it into:
- Company Master Manage
- Group Master
- Project Master
- Department Master

---

# 9. What Must Not Happen

We must explicitly avoid:

- piling more one-off shortcuts onto the old layout
- breaking session-cluster behavior
- breaking lock/logout/idle behavior
- rebuilding visuals without rebuilding focus flow
- making forms look dense but still mouse-dependent
- rebuilding org-master screens before template truth is locked

---

# 10. Success Condition

This phase is successful when:

- the shell remains secure and governed
- the session features still work unchanged
- the UI feels keyboard-native,
  not shortcut-patched
- operators can move screen-to-screen,
  field-to-field,
  and action-to-action
  with near-zero mouse dependency
- new org-master and HR module screens are built on reusable keyboard-native templates

---

# 11. Final Direction

The correct conclusion is:

- backend governance remains usable
- session and security foundations remain usable
- keyboard-command and hotkey foundations now exist
- but the frontend interaction model still needs a structural rebuild

So from this point forward,
the next frontend work must be:

- template-first
- keyboard-native
- compatibility-safe
- sequence-driven

This document is now the execution guide
for the keyboard-native ERP UI phase.

---

# 12. Immediate Post-Completion Sequence

This section exists so focus is not lost
after the keyboard-native UI phase is complete.

Once the keyboard-native UI phase is stable enough,
the next work must continue in this exact order.

## 12.1 Org Masters

Build and complete:
- Company Master Manage/List
- Group Master
- Company -> Group Mapping
- Project Master
- Department Master

Why first:
- these are upstream governance truth
- user scope must stop depending on partial masters
- module and HR rollout should not proceed on weak master data

## 12.2 User Scope Retest

After org masters are ready:
- retest Parent Company mapping
- retest Work Company mapping
- retest Project mapping
- retest Department mapping
- verify that user scope now works against real master data,
  not placeholder or partial upstream truth

## 12.3 Module Governance

Then build and complete:
- Company Module Map UI
- practical module governance controls needed for rollout

Why here:
- company-wise module enablement must exist
  before HR modules are exposed live

## 12.4 Approval Governance

Then build and complete:
- Approval Rule UI
- Approver Scope Governance UI
- immediately needed ACL governance UI
- menu governance / exposure control where needed for rollout

Why here:
- Leave and Out Work cannot go live cleanly
  without approval truth and exposure truth

## 12.5 HR Module Build

Then build:
- Leave Module
- Out Work Module

Important rule:
- both modules must be built on the same keyboard-native UI templates
- no side-route UI pattern should be introduced here

## 12.6 Practical Go-Live Validation

Before live use,
run this sequence:
- org master validation
- user scope validation with real masters
- Leave approval flow definition and validation
- Out Work approval flow definition and validation
- module visibility and menu exposure validation
- multi-window workflow validation
- end-to-end keyboard-only walkthrough

## 12.7 Locked Summary

So after this keyboard-native UI phase,
we will go to:

1. Org Masters
2. User Scope retest
3. Module Governance
4. Approval / Approver Governance
5. Menu exposure where needed
6. Leave Module
7. Out Work Module
8. End-to-end live validation

This section is locked specifically
to prevent focus drift
and random step-jumping after the UI phase.
