# 🔒 PACE-ERP — Gate-2 Freeze Declaration
**Gate:** 2  
**Domain:** AUTH / SESSION / SECURITY  
**Status:** FROZEN · IMMUTABLE

---

## Purpose

This document formally declares **Gate-2 (Auth Boundary & Session Authority)** as
**complete, locked, and frozen**.

From this point forward:
- No new behaviour
- No refactor
- No semantic change

is allowed inside Gate-2.

---

## Scope of Gate-2 (What is Frozen)

Gate-2 definitively establishes:

### 1. Authentication Boundary
- Supabase Auth is the **only credential authority**
- ERP never handles passwords
- Identity ≠ roles ≠ permissions

### 2. Login Flow (Server-side)
- Identifier resolution (email / ERP code)
- Enumeration-safe credential verification
- ERP account state enforcement
- ERP session creation (server-side)

### 3. Session Authority
- HttpOnly, Secure, SameSite cookie
- Cookie overwrite on login
- Deterministic logout & invalidation
- Session bind invariant enforced

### 4. Identity APIs
- `/api/login`
- `/api/me` (WhoAmI, no-guess, minimal payload)
- `/api/logout` (idempotent)

### 5. Security Controls
- Auth rate limiting (IP + identifier)
- Generic error messages (no enumeration)
- Deterministic error codes
- Auth event logs (success / failure / logout)

---

## Explicitly Out of Scope (Not Part of Gate-2)

The following are **intentionally NOT included** in Gate-2:

- Role resolution
- Permissions / ACL enforcement
- Project / tenant context
- DB schema creation or migrations
- RLS policy enforcement on individual tables

These belong to **future Gates**.

---

## Dependency Acknowledgement

Gate-2 **assumes** the existence of the following DB objects
(created in earlier Gates):

- `erp_core.users`
- `erp_core.sessions`

No new migrations are introduced in Gate-2.

---

## Freeze Rules

After this declaration:

- Gate-2 files are **read-only**
- Any required change must occur in a **new Gate**
- Historical behaviour is preserved

Violation of this freeze invalidates system guarantees.

---

## Declaration

Gate-2 is hereby declared:

> **🔒 FROZEN · COMPLETE · IMMUTABLE**

Date: `2026-01-25`  
Authority: PACE-ERP System Architecture
