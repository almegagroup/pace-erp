🔒 PACE-ERP — Gate-3 Freeze Declaration (Final)

Gate: 3
Domain: SESSION / SECURITY
Status: 🔒 FROZEN · COMPLETE · DETERMINISTIC
Authority: Backend Control Plane
Scope: Session Lifecycle Governance
Date: 2026-02-23

1️⃣ Purpose of Gate-3

Gate-3 governs session continuity over time.

It transitions ERP sessions from:

“Session is structurally valid”
to
“Session remains valid under deterministic time constraints.”

Gate-3 is a behavioural enforcement layer only.

It does not:

Create schema

Define configuration systems

Introduce policy engines

Introduce observability storage layers

Gate-3 enforces time-based validity only.

2️⃣ Architectural Authority Separation (Locked)
✔ Gate-2

Creates and validates ERP sessions.

✔ Gate-3

Governs time-based validity of ACTIVE sessions.

❗ No other layer may override lifecycle decisions.

Lifecycle authority is exclusive to Gate-3.

3️⃣ Deterministic Lifecycle Outcomes (Locked)

Gate-3 produces the following outcomes:

ACTIVE

ABSOLUTE_WARNING

IDLE_WARNING

IDLE_EXPIRED

TTL_EXPIRED

REVOKED

All terminal states result in forced logout.

No frontend influence exists over lifecycle decisions.

4️⃣ Behavioural Guarantees (Locked)
4.1 Absolute TTL

TTL stored in DB (expires_at)

TTL duration: 12 hours

Absolute warning: 10 hours

TTL cannot be extended

TTL check runs before idle logic

TTL overrides idle logic

TTL is DB-authoritative and backend-enforced.

4.2 Idle Enforcement

Idle warning: 10 minutes

Idle expiration: 30 minutes

Idle reset occurs only if lifecycle result is ACTIVE

Idle reset updates last_seen_at

Idle reset never modifies TTL

Lifecycle logic remains pure.
DB mutation occurs only in pipeline runner.

4.3 Single Active Session

New login revokes all ACTIVE sessions

Exactly one ACTIVE session per user

Enforced by DB partial unique index

No trusted device exception

Invariant is DB-guaranteed.

4.4 Deterministic Logout Enforcement

The following always force logout:

TTL_EXPIRED

IDLE_EXPIRED

REVOKED

Any non-ACTIVE state

Logout guarantees:

Cookie invalidated

LOGOUT action returned

DB errors never block logout

5️⃣ Lifecycle Purity Rule (Locked)

session_lifecycle.ts performs no DB mutation

Lifecycle logic is side-effect free

DB updates occur only in pipeline runner

Separation of evaluation and mutation is permanent

This separation may not be violated.

6️⃣ Observability Scope (Clarified)

Gate-3 requires:

Structured lifecycle event emission

request_id linkage

Deterministic event naming

Gate-3 does NOT require:

Persistent timeline storage

RCA dashboards

Log retention systems

Visualization layers

Those belong to Gate-10.

Dependency direction:

Gate-10 consumes Gate-3 signals.
Gate-3 does not depend on Gate-10.

7️⃣ Explicitly Out of Scope

Gate-3 does NOT include:

Role resolution

ACL enforcement

Context binding

Session schema evolution

Configurable policy framework

Device trust scoring

RPC lifecycle engines

Alert infrastructure

Trace viewers

These belong to higher gates.

8️⃣ Policy Lock (Final)

The following values are permanently frozen:

Policy	Value
TTL Duration	12 hours
Absolute Warning	10 hours
Idle Warning	10 minutes
Idle Expiry	30 minutes

Any change requires:

New Gate ID

Explicit architectural declaration

9️⃣ DB Interaction Policy

Gate-3 introduces:

No new tables

No new migrations

No new columns

It relies on:

expires_at

last_seen_at

status

DB is storage authority.
Gate-3 is behavioural authority.

🔟 RPC & External Control Policy

No RPC is used for lifecycle enforcement

No external system influences lifecycle decisions

Lifecycle enforcement is fully backend deterministic

This rule is locked.

1️⃣1️⃣ Seal Guarantee

From this point forward:

Lifecycle behaviour is final

TTL logic is final

Idle logic is final

Single-session invariant is final

Logout enforcement is final

No behavioural modification permitted

Any change requires a new Gate ID.

1️⃣2️⃣ Status Summary
Component	Status
Absolute TTL	✅ DONE
Idle Enforcement	✅ DONE
Single Session Enforcement	✅ DONE
Deterministic Logout	✅ DONE
Lifecycle Purity	✅ DONE
Observability Emission	✅ DONE
Behaviour Freeze	🔒 LOCKED
🔒 Final Declaration

Gate-3 is hereby declared:

🔒 FROZEN · COMPLETE · DB-CONSISTENT · DETERMINISTIC

No ambiguity remains.
No dependency remains.
No behavioural evolution is permitted inside this Gate.

Future changes require a new architectural version.