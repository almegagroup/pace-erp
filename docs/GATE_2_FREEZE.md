🔒 PACE-ERP — Gate-2 Freeze Declaration (Final)

Gate: 2
Domain: AUTH · SESSION · SECURITY
Status: 🔒 FROZEN · EXECUTION-SEALED · DB-ALIGNED · IMMUTABLE

1️⃣ Constitutional Status

Gate-2 is hereby declared:

Functionally Complete · Deterministic · DB-Authoritative · Execution-Sealed

From this declaration onward:

No behavioural change

No session model alteration

No TTL modification

No identity contract modification

No cookie model change

No rate-limit semantic change

No error envelope modification

is permitted within Gate-2.

All future evolution must occur in higher Gates.

2️⃣ Authentication Boundary (Identity Isolation)

Gate-2 establishes strict identity isolation:

Supabase Auth is the sole credential authority

ERP never stores, hashes, or verifies passwords

Authentication ≠ ERP account lifecycle

Identifier resolution is enumeration-safe

Generic error policy enforced

No identity leakage permitted

This boundary is permanently locked.

3️⃣ Login Flow (Server-Side Deterministic Model)

Login execution guarantees:

Identifier resolution (email / ERP code)

Account state enforcement (ACTIVE only)

Single ACTIVE session per user

Automatic revocation of prior ACTIVE sessions

Fresh session UUID generation (fixation prevention)

Deterministic 12-hour TTL

last_seen_at initialized on creation

Session cookie regeneration on every successful login

All login behaviour is strictly backend-controlled.

Frontend has zero authority.

4️⃣ Session Authority (DB-Backed Model)

The session model is fully DB-authoritative.

Authoritative Table: erp_core.sessions

Enforced guarantees:

session_id as primary key

Status constraint enforced

Unique ACTIVE session per user (partial index)

Deterministic TTL enforcement

revoked_at, revoked_reason, revoked_by

RLS ENABLE + FORCE

No frontend mutation of session state is possible.

Session bind invariant is enforced:

Cookie → DB → auth_user_id → request context

5️⃣ Session Lifecycle Integration (Gate-2 → Gate-3 Boundary)

Gate-2 guarantees:

Only ACTIVE sessions pass

Logout is idempotent

Server-side revoke on logout

Cookie invalidation always executed

DB errors never block logout

Lifecycle warnings do not mutate session state

Lifecycle evolution belongs to Gate-3 and above.

6️⃣ Identity APIs (Frozen Surface)

The following routes are permanently frozen in behaviour:

POST /api/login

GET /api/me

POST /api/logout

All responses are:

Deterministic

Enumeration-safe

Action-driven

Traceable (request_id)

No role, ACL, tenant, or context information may ever be returned from these APIs.

7️⃣ Security Controls (Frozen Discipline)

Gate-2 permanently locks:

Auth rate limiting (IP + identifier)

Generic error envelope enforcement

Deterministic logout action model

Structured security logging

HttpOnly + SameSite + Secure cookie discipline

No hardcoded cookie domain

No wildcard behaviour

8️⃣ Explicitly Out of Scope

Gate-2 does NOT include:

Role resolution

ACL decisions

Context resolution

Tenant/project binding

Menu rendering

Approval workflows

These belong strictly to later Gates.

9️⃣ DB Dependency Confirmation

Gate-2 relies on:

erp_core.users

erp_core.sessions

Unique ACTIVE partial index

TTL constraint

RLS FORCE enabled

Gate-2 introduces no schema mutations post-freeze.

🔒 Freeze Rules (Execution-Level Seal)

After this declaration:

Gate-2 code is immutable

Session model cannot evolve inside this Gate

Single-session invariant must remain intact

12-hour TTL is permanently locked

Error envelope semantics are locked

Rate-limit contract is locked

Any modification requires:

A new Gate version
Or an architectural amendment

Violation invalidates deterministic guarantees.

🔐 Final Declaration

Gate-2 is hereby declared:

🔒 FROZEN · EXECUTION-SEALED · DB-ALIGNED · IMMUTABLE

Date: 2026-02-23
Authority: PACE-ERP System Architecture