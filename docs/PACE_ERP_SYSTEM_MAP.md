📘 PACE_ERP_SYSTEM_MAP.md

Purpose: Assistant Continuity & Mental Model Lock
Status: LIVE · EXPLANATORY · NON-AUTHORITATIVE

⚠️ This file is NOT a state ledger.
It explains how the system is wired, not what is done.

0. Role of This Document

This document exists to answer only one question:

“How does this ERP actually work end-to-end, without relying on chat memory?”

Rules:

This file never overrides PACE_ERP_STATE.md

This file never declares DONE / HALF / FROZEN

This file may evolve, but must never contradict frozen gates

If conflict arises:

STATE FILE > GATE FREEZE > THIS MAP

1. Global Mental Model (Invariant)

The ERP operates as a pipeline of authority, not a monolith.

Truth Definition
   ↓
Context Resolution
   ↓
ACL Decision
   ↓
Enforcement
   ↓
Visibility (UI)


Each layer is:

Independently testable

Independently incomplete

Strictly ordered

No layer is allowed to “peek ahead”.

2. Layer-1: Canonical Truth Layer (DB Truth)
Purpose

Define what exists in the ERP universe.

Characteristics

Declarative only

No runtime decision logic

No user-specific behaviour

Schemas involved
erp_master   → companies, projects, departments, groups
erp_map      → user ↔ company / project / department bindings
erp_acl      → roles, capabilities, overrides, modules
acl          → low-level ACL engine resources
erp_menu     → UI menu definitions (existence only)
erp_audit    → append-only security logs
erp_cache    → non-authoritative external facts

Invariant

Presence of data ≠ permission ≠ execution

This layer may be fully populated while the system is still non-operational.

3. Layer-2: Context Resolution Layer
Purpose

Resolve “who is operating in which scope”.

Inputs

auth_user_id (from Supabase Auth)

request headers

deterministic mappings

Outputs
company_id
project_id (optional)
department_id (optional)
universe (SA / ACL)

Sources

erp_map.user_companies

erp_map.user_projects

erp_map.user_departments

erp_acl.user_roles

Failure Mode (Intentional)

If context cannot be resolved:

Request terminates

No ACL decision is attempted

No partial fallback

Context resolution failure is a hard stop, not an error state.

4. Layer-3: ACL Decision Engine
Purpose

Answer a single binary question:

“Is action X on resource Y allowed in this resolved context?”

Decision Order (LOCKED)

Universe bypass

SA universe → allow all

Company module enablement

Disabled module → hard deny

User overrides

Explicit allow / deny

Role VWED

Base role permissions

Capability VWED

Capability pack permissions

Default

DENY

Properties

Pure function

Side-effect free

No DB mutation

No UI awareness

ACL engine does not care whether:

UI exists

Route exists

Handler exists

5. Layer-4: Enforcement Layer
Purpose

Make ACL decisions real.

Enforcement Points

API handler guards

Pipeline middleware

Database RLS policies

Key Rule

Even if API code is buggy, DB RLS must still deny.

This creates defence in depth:

App-level enforcement

DB-level enforcement

6. Layer-5: Visibility & Navigation Layer
Purpose

Control what the user sees, not what the user can do.

Core Artifact
erp_menu.menu_snapshot


Snapshot is:

Precomputed

Per user + company + universe

Immutable per version

UI Rules

Frontend never computes permissions

Frontend renders snapshot only

Absence of menu ≠ permission denied

Presence of menu ≠ permission granted

7. Dual Menu Systems — Intentional Separation
Systems
System	Role
acl.menu_*	Security resources
erp_menu.*	UI projection
Rationale

Security decisions must not depend on UI structure.

UI structure must not imply security guarantees.

They may reference the same conceptual feature, but:

They are not the same object

They are not required to be 1-to-1

8. HALF-DONE Is a Valid System State
Principle

PACE-ERP is built truth-first.

Therefore:

Tables may exist without execution

Execution may exist without UI

UI may exist without approval flow

This is by design, not technical debt.

Execution is enabled only when the entire chain is wired.

9. What This File Is Allowed to Change

Allowed:

Add new layers

Expand decision ordering explanation

Clarify dependency direction

Annotate future gates

Not allowed:

Redefine authority

Mark completion

Override frozen logic

Introduce new invariants silently

10. How This File Is Used (Operational Rule)

When user provides updates:

I read this file first

I map new info onto this mental model

I update my understanding, not the state file

Only after discussion → state file may change

This file exists so that:

I never ask you to “re-explain the system”.

11. Stability Assertion (For Assistant)

Based on current analysis:

Architecture is internally consistent

No schema conflict exists

No rebuild is required

No drop / rename cascade is required

All perceived issues so far were:

Naming perception

Layer overlap confusion

Mental wiring gaps

Not system flaws.

12. Final Internal Note

This ERP is large enough that confusion is expected.

Confusion at this stage indicates:

Depth achieved

Complexity reached

System is no longer trivial

That is not failure.

END OF FILE