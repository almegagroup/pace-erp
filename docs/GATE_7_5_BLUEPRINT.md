🔒 GATE_7_5_BLUEPRINT.md

Status: FROZEN
Gate: 7.5
Scope: Enterprise Approval & Workflow Blueprint
Phase: Pre-Engine (Design Freeze)
Authority: Backend (Single Source of Truth)

1️⃣ Purpose

This document formally freezes the deterministic behavioural model of the Approval & Workflow Engine for PACE-ERP before engine implementation begins.

No execution logic is implemented at this stage.
This is a constitutional design lock.

2️⃣ Architectural Position

This blueprint operates under:

Gate-6 (ACL Authority — SEALED)

Gate-7 (Menu Visibility — SEALED)

Constitution Sections 1–14

This workflow system:

Must not bypass ACL

Must not bypass RLS

Must not introduce alternate authority

3️⃣ Core Entity — Workflow Request

Every approval-requiring action generates a Workflow Request.

Examples:

Leave request

Expense claim

Profile change

Any module-defined approval event

4️⃣ Workflow Lifecycle Model (Frozen)
States
DRAFT
PENDING
APPROVED
REJECTED
CANCELLED
State Definitions
DRAFT

Created but not submitted

Visible only to creator

No approval routing active

Transition:

DRAFT → PENDING
PENDING

Approval process active

Routing depends on approval type

Override allowed (until final)

Transitions:

PENDING → APPROVED
PENDING → REJECTED
PENDING → CANCELLED
APPROVED

Final state

Immutable

No further change allowed

REJECTED

Final state

Immutable

Resubmission requires new request

CANCELLED

Cancelled by creator

Immutable

Approval chain stops immediately

5️⃣ Approval Type Contracts (Frozen)

Approval policy is intrinsic to module (module_registry).

Supported types:

ANYONE
SEQUENTIAL
MUST_ALL
🟢 ANYONE

Notification:
All configured approvers receive request simultaneously.

Completion:

First APPROVE → Final APPROVED

First REJECT → Final REJECTED

Post-decision:

Remaining approvers lose action privilege

Audit trail remains visible

🔵 SEQUENTIAL

Notification:

Stage 1 approver notified first

After approval → Stage 2

After approval → Stage 3

Rejection:

Any stage rejection → Final REJECTED

Completion:

Final stage decision determines final state

Override:

Higher stage may override lower decision before final lock

🟣 MUST_ALL

Notification:
All configured approvers notified simultaneously.

Completion:

All must APPROVE → Final APPROVED

Any REJECT → Immediate REJECTED

Override:
Higher role may override before final lock.

6️⃣ Hierarchy & Override Model

Approval stages follow role hierarchy:

Lower → Higher → Highest

Higher approver may override lower decision
until final state is reached.

Once request becomes APPROVED or REJECTED:

No further override permitted.

Director Role:

No approver above Director

Director decision is highest authority

Self-approval strictly prohibited.

7️⃣ Version Compatibility Contract (Frozen)
7.1 Version Binding

At request creation:

Current acl_version_id must be captured.

Routing configuration logically frozen.

7.2 Policy Change Isolation

Changes in:

module_registry

approver_map

role mapping

ACL rules

MUST NOT affect running PENDING requests.

7.3 Deterministic Evaluation

All decision validation must use:

Captured acl_version_id

Frozen approval configuration

8️⃣ RLS & Isolation Contract (Refined)

Workflow tables must:

Contain company_id

Enforce strict RLS

Default = DENY

Require stepAcl validation

Cross-Company Access Rule

Access allowed ONLY IF:

User mapped to that company (primary or work)

User mapped to that project

User configured as approver (if approval context)

stepAcl grants permission

Cross-company leakage without explicit mapping is prohibited.

9️⃣ Deterministic Guarantees

The system guarantees:

No mid-flight rule mutation

No policy drift

No cross-company leak

No silent override

No mutable final state

No approval without ACL validation

No execution outside pipeline order

10️⃣ Engine Phase Constraints (Declared)

Future Engine Implementation MUST:

Bind workflow to stepAcl

Bind to acl_versions

Enforce RLS strictly

Use append-only audit trail

Avoid hidden side effects

Follow migration-first discipline

11️⃣ Constitutional Alignment

Aligned with:

Section 1 — Backend SSOT

Section 2 — RLS Philosophy

Section 3 — Request Pipeline Law

Section 6 — Session Law

Section 11 — Admin Universe Law

Section 14 — Checklist Governance

No new authority introduced.
No existing invariant removed.

🔒 Gate 7.5 Blueprint Freeze Declaration

This document:

Freezes workflow lifecycle

Freezes approval behaviour

Freezes version binding

Freezes isolation model

Introduces zero execution logic

Engine phase may now proceed under this blueprint.

✅ Status
Gate 7.5
Foundation → SEALED
Structure → SEALED
Blueprint → SEALED
Engine → Ready to Begin