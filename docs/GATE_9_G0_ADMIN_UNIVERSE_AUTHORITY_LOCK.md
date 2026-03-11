PACE-ERP — Gate-9 / ID-9
Admin Universe Authority Lock (SSOT · FROZEN)
Status

🔒 FROZEN

This document is a permanent authority declaration for the Admin Universe boundary.

Once declared, this authority model must never be reinterpreted or altered without a new Gate and SSOT declaration.

Purpose

This document formally declares and freezes the Admin Universe authority boundary in PACE-ERP.

The Admin Universe is:

ACL-independent

Security-enforced

System-governance only

It exists to guarantee that system governance remains recoverable even if ACL becomes misconfigured.

This lock permanently prevents:

Admin self-lockout

ACL circular dependencies

Governance deadlocks

System recovery failure during ACL errors

Definition — Admin Universe

The Admin Universe consists of all dashboards, APIs, and screens responsible for governing the ERP system itself, not executing business operations.

Canonical Admin Universe surfaces include:

/sa/*      → Super Admin dashboards
/ga/*      → Group Admin dashboards
/api/admin/* → Administrative control APIs

Only the backend may classify a request as belonging to the Admin Universe.

Frontend inference or detection of Admin Universe access is invalid and forbidden.

Core Authority Rule (Hard Lock)

ACL DOES NOT GOVERN ACCESS TO THE ADMIN UNIVERSE

If all of the following conditions are true:

A valid ERP session exists

The session role is SA or GA

The request targets an Admin Universe route

Then:

The ACL engine MUST NOT be executed

The request MUST continue through all security layers

This means:

ACL bypass ≠ Security bypass

ACL is skipped only for Admin Universe access evaluation, never for security enforcement.

Mandatory Security Enforcement (Non-Negotiable)

All Admin Universe requests MUST still pass the full security pipeline:

Session resolution

Session ACTIVE validation

Role verification (SA or GA)

CORS enforcement

CSRF protection

Rate limiting

Request tracing

Audit logging

Admin Universe access is immune to ACL misconfiguration,
but it is never immune to security enforcement.

Explicitly Forbidden (Permanent)

The following behaviors are permanently invalid:

Using ACL permissions to control Admin Universe access

role_menu_permission governing Admin dashboards

Capability packs gating Admin routes

user_overrides affecting Admin access

Frontend logic attempting to detect admin privileges

Any attempt to route Admin access through the ACL engine

Any implementation attempting the above violates the system architecture and must be rejected.

Authority Precedence (Frozen)

The authority precedence in PACE-ERP is permanently defined as:

SECURITY
↑
ADMIN UNIVERSE
↑
ACL UNIVERSE

Meaning:

Security always governs everything

Admin governance precedes ACL

ACL governs only the non-admin user universe

Admin authority never overrides security enforcement.

Failure Mode Without This Lock (Rationale)

Without this declaration, the system becomes vulnerable to:

Total administrative lockout caused by ACL misconfiguration

Irrecoverable permission states

Circular dependency where fixing ACL requires ACL permission

This lock permanently eliminates those failure modes.

Relationship to Earlier Gates

This declaration operationally resolves the following earlier ambiguities:

Gate-5 → Admin bypass ambiguity
Gate-6 → Admin vs ACL precedence ambiguity

From Gate-9 onward, Admin Universe authority is architecturally sealed.

Immutability Declaration

This document is frozen.

Any future change to Admin authority boundaries requires:

A new Gate

A new SSOT document

A formal freeze declaration

No reinterpretation, extension, or modification is allowed.

Declaration

Gate-9 / ID-9 — Admin Universe Authority Lock
is hereby declared COMPLETE and IMMUTABLE.