🔒 PACE-ERP — Gate-4 Freeze Declaration

File-ID: 4.7
File-Path: docs/GATE_4_FREEZE.md
Gate: 4
Phase: 4
Domain: USER LIFECYCLE / AUTH / ADMIN / AUDIT
Status: 🔒 HARD FROZEN
Authority: Backend (DB-owned lifecycle engine)
Scope: ERP User Lifecycle Governance
Date: (fill at freeze commit)

1️⃣ Purpose of Gate-4

Gate-4 governs the transition:

“Auth identity exists” → “ERP lifecycle is governed”

Gate-4 defines:

Who may exist as an ERP user

Under whose authority activation occurs

What deterministic system footprint is created

Gate-4 is a Lifecycle Governance Gate.

It explicitly does NOT define:

Password handling

Session semantics

Business permissions

Context resolution

UI behaviour

2️⃣ Lifecycle Authority (LOCKED)
Authority Separation
Layer	Authority
Supabase Auth	Identity + Credentials
Gate-4	ERP lifecycle state

Only Gate-4 may:

Activate ERP users

Reject ERP users

Assign deterministic user_code

Bootstrap minimal ACL

No other gate may mutate lifecycle state.

3️⃣ Lifecycle States (LOCKED)

Gate-4 recognises exactly:

PENDING

ACTIVE

REJECTED

DISABLED (reserved for future gate only)

No additional states are permitted.

State transitions are strictly:

PENDING → ACTIVE
PENDING → REJECTED
ACTIVE → DISABLED (future gate only)

Reverse transitions are not allowed under Gate-4.

4️⃣ Implementation Summary
4.1 Signup Intake — ✅ SEALED

Public endpoint /api/signup

Backend human verification mandatory

Supabase Auth identity must already exist

Creates ERP user in PENDING

Creates signup request in PENDING

Always returns generic success (enumeration-safe)

⚠ Atomicity Note (Design Boundary)

Signup intake intentionally performs:

Insert → erp_core.users

Insert → erp_core.signup_requests

These are not wrapped in a DB transaction.

This is deliberate:

Intake is not lifecycle mutation

Atomic lifecycle enforcement begins exclusively inside DB-owned approval and rejection functions.

4.1B Signup Rate Limiting — 🟡 DEFERRED

Purpose:
Abuse containment via public signup throttling.

Status:
Deferred to Gate-5 (Context & Security hardening).

Reason:
Rate limiting is operational security, not lifecycle governance.

Non-blocking:
Absence of rate limiting does not compromise lifecycle integrity.

4.2 Approval Workflow — ✅ HARD SEALED (Atomic)

Approval is performed exclusively via:

erp_meta.approve_signup_atomic(UUID, UUID)
Guarantees:

Row lock (FOR UPDATE)

State validation

Deterministic sequence generation

Single lifecycle transition

Single-role bootstrap

Append-only audit log

Fully atomic execution

Result:
Table	Before	After
signup_requests	PENDING	APPROVED
users	PENDING	ACTIVE
user_code	NULL	P000X
user_roles	none	L1_USER

No handler-level mutation exists.

4.3 Rejection Workflow — ✅ HARD SEALED (Atomic)

Performed exclusively via:

erp_meta.reject_signup_atomic(UUID, UUID)
Guarantees:

Row lock

State validation

Lifecycle transition atomic

Append-only audit

No ACL bootstrap

Result:
Table	Before	After
signup_requests	PENDING	REJECTED
users	PENDING	REJECTED

Rejection is final under Gate-4.

4.4 Deterministic user_code — ✅ SEALED

Format: P0001, P0002, …

Generated only inside atomic approval function

Backed by erp_core.user_code_p_seq

Immutable

Unique

Assigned once

4.5 Minimal ACL Bootstrap — ✅ SEALED (Single-Role Architecture)

On approval:

Exactly one role is assigned

L1_USER

Rank = 10

Insert is idempotent (ON CONFLICT DO NOTHING)

Multi-role architecture is explicitly disallowed.

Role changes (promotion/demotion) belong to future ACL governance gate.

4.6 Audit & Observability — ✅ SEALED

Every approval/rejection:

Insert into erp_audit.signup_approvals

Append-only

No update

No delete

Structured logging emitted

Audit integrity is DB-enforced.

5️⃣ What Gate-4 Explicitly Does NOT Handle

❌ Password validation
❌ Session creation
❌ Context resolution
❌ Permission evaluation
❌ Menu rendering
❌ Role escalation
❌ Business table mutation

These are delegated to:

➡ Gate-5 (Context)
➡ Gate-6 (ACL runtime materialisation)
➡ Gate-7+ (Business domain logic)

6️⃣ DB Object Scope (LOCKED)

Gate-4 may define:

erp_core.users

erp_core.signup_requests

erp_core.user_code_p_seq

erp_meta.approve_signup_atomic()

erp_meta.reject_signup_atomic()

erp_audit.signup_approvals

Gate-4 may NOT introduce:

Context tables

Business tables

ACL expansion schemas

Permission packs

7️⃣ RPC & Mutation Policy (UPDATED)

Lifecycle mutation authority resides exclusively inside DB-owned atomic functions.

No backend handler, present or future, may directly mutate:
- erp_core.users
- erp_core.signup_requests
- erp_acl.user_roles (for lifecycle bootstrap)

Handlers:

May call RPC

Must not mutate lifecycle tables directly

No dual mutation path is allowed.

8️⃣ Invariants (Non-Negotiable)

Supabase Auth = Credential SSOT

ERP never handles passwords

Enumeration safety everywhere

Single lifecycle authority (DB)

Single role per user

Local == Production behaviour

No partial state transitions

🔒 Final Freeze Statement

Gate-4 is hereby declared HARD FROZEN.

This means:

Lifecycle mutation logic is final

Approval & rejection are DB-owned

Atomic guarantees are DB-enforced and non-bypassable.

No handler-level mutation permitted

No new lifecycle states allowed

No ACL expansion under Gate-4

Any modification requires a new Gate.

📊 Gate-4 Final Status
ID      Status
4.0A    🟢 SEALED
4.0B    🟢 SEALED
4.0C    🟢 SEALED
4.1     🟢 SEALED
4.1A    🟢 SEALED
4.1B    🟡 DEFERRED (Gate-5)
4.1C    🟢 SEALED
4.2     🟢 SEALED
4.2A    🟢 SEALED
4.2B    🟢 SEALED
4.3     🟢 SEALED
4.7     🔒 HARD FROZEN
🔐 Authoritative Closure

Gate-4 lifecycle governance is complete.

All user activation semantics are deterministic, atomic, and sealed.

Next execution layer:

➡ Gate-5 — Context Resolution & Login Pipeline