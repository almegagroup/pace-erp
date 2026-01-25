# PACE-ERP — Gate-1 Freeze Declaration (ID-13)

## Status

**GATE-1 IS COMPLETE AND FROZEN**

This document formally declares that **Gate-1** of the PACE-ERP project
has been completed and is now **immutable**.

Gate-1 establishes the **security execution spine** upon which
all future business logic (Gate-2 onward) must operate.

---

## Scope Covered by Gate-1

Gate-1 permanently locks the following foundations:

### 1. Backend Request Orchestration

* Single backend entry (`api/index.ts`) **extended but not replaced**
* Deterministic request pipeline order (ID-1A):

  ```
  headers → CORS → CSRF → rate-limit → session → context → ACL → handler
  ```
* Explicit health endpoint isolation (`/health` only)

---

### 2. Security Headers & Browser Protection

* Global security headers (ID-2)
* Strict CSP policy (ID-2A)
* X-Frame-Options DENY (ID-2B)
* Referrer-Policy enforcement (ID-2C)
* Permissions-Policy lockdown

---

### 3. CORS & CSRF Enforcement

* Strict CORS allowlist with origin echo (ID-3)
* No wildcard (`*`) enforcement (ID-3B)
* Correct OPTIONS preflight handling (ID-3A)
* CSRF guard via Origin + Referer validation (ID-4)
* Safe-method bypass (GET / HEAD / OPTIONS) (ID-4A)
* Hard block on cross-site POST (ID-4B)

---

### 4. Rate Limiting Spine

* IP-based throttle (ID-5A)
* Account / identifier-based throttle (ID-5B)
* In-memory, best-effort implementation (explicitly non-durable)
* Deterministic error signalling (`RATE_LIMIT_IP`, `RATE_LIMIT_ACCOUNT`)

---

### 5. Session Authority Spine

* Session resolver skeleton (ID-6)
* Session lookup contract:

  * `ACTIVE`
  * `ABSENT`
  * `REVOKED`
  * `EXPIRED` (ID-6A)
* Ghost-login prevention via mandatory `LOGOUT` action (ID-6B)

> ⚠️ **No DB lookup exists yet** — this is a **contract-only layer**

---

### 6. Context Isolation Spine

* Context resolver skeleton (ID-7)
* Explicit `UNRESOLVED` default
* Invariant leak-prevention placeholders (ID-7A)

> Any unresolved context **must block business logic** in future gates.

---

### 7. ACL Authorization Spine

* ACL resolver skeleton (ID-8)
* Deterministic decision contract:

  * `ALLOW`
  * `DENY` with reason + action (ID-8A)
* No authorization logic yet — **structure only**

---

### 8. Unified Response & Error Contract

* Single API response envelope (ID-9)
* Action-driven responses:

  * `NONE`
  * `LOGOUT`
  * `REDIRECT`
  * `RELOAD` (ID-9A)
* Mandatory hard logout on any `SESSION_*` error (ID-9B)

---

### 9. Observability & Traceability

* Request ID generation
* Request ID injected into:

  * Logs
  * Response body
  * `X-Request-Id` response header (ID-10)
* Structured error logging with:

  * request_id
  * gate
  * stage
  * error code (ID-10A)

---

### 10. Public Surface Lockdown

* `/health` is the **only** public endpoint (ID-11)
* Explicit guard-bypass ban — no silent early returns (ID-11A)

---

### 11. Database Authority Contracts (IMPORTANT)

The following are **defined but NOT executed in Gate-1**:

#### a) RLS Enforcement Contract (ID-12)

* `assertRlsEnabled()` helper exists
* **No DB query may be written in future without passing this check**
* No runtime DB verification yet (contract-only)

#### b) Service Role Authority Contract (ID-12A)

* Centralized `serviceRoleClient` defined
* `assertServiceRole()` helper declared
* **No DB access is allowed except via service role**

> ⚠️ **Important Note (Must Not Be Forgotten)**
>
> * A **placeholder / fake service role key** may exist in non-prod or local setups & PROD also.
> * This is **intentional for Gate-1**
> * Actual enforcement + verification will occur in later DB gates
> * Presence of this contract is a **governance lock**, not an implementation

---

## Explicit Non-Goals of Gate-1 (Locked)

Gate-1 deliberately does **NOT** include:

* ❌ Any business logic
* ❌ Any feature API
* ❌ Any UI assumption
* ❌ Any DB query
* ❌ Any RLS execution
* ❌ Any service role query execution
* ❌ Any auth provider integration logic

---

## Freeze Rules (Effective Immediately)

After this declaration:

* ❌ No modification to Gate-1 pipeline order
* ❌ No change to security headers, CSP, CORS, CSRF logic
* ❌ No bypass of session / context / ACL spines
* ❌ No change to error or response envelope
* ❌ No removal of placeholder authority contracts (ID-12 / 12A)
* ❌ No new public endpoints
* ❌ No DB access introduced in Gate-1

Any such change requires a **formal unfreeze decision**,
which is **not permitted** under normal development flow.

---

## Enforcement

* Any commit modifying Gate-1 scope after this freeze is **invalid**
* Any PR violating this freeze must be **rejected**
* Any build bypassing Gate-1 guarantees is **non-compliant**

---

## Forward Development Rule

All future development must proceed strictly from:

> **Gate-2 onward**

Gate-1 may only be **referenced and extended**, never altered.

---

## Declaration

This freeze is intentional and irreversible for the lifecycle of this project.

Gate-1 now represents the **security execution constitution**
of PACE-ERP.

Violating this freeze reintroduces implicit authority,
breaks determinism, and invalidates audit guarantees.

---

**Declared by:** Project Authority
**Gate:** 1
**ID:** 13
**Status:** **FROZEN**
