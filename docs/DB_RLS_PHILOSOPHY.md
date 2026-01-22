# PACE-ERP — RLS Philosophy (Gate-0 / ID-0.6A)

## Status
LOCKED — Philosophy Only  
(No SQL, no policies, no enablement)

---

## Core Principle

**Default = DENY**

No row is visible or mutable unless explicitly allowed
by ERP backend authority.

---

## Identity vs Access

- Supabase Auth answers: **Who are you**
- ERP answers: **What are you allowed to do**

RLS must never trust identity alone.

---

## Access Preconditions (ALL must pass)

For any ERP row to be accessible:

1. Supabase identity exists
2. ERP user record exists
3. ERP user state = ACTIVE
4. Context is valid (company / project)
5. ACL evaluation passes

Failure of any step = RLS DENY

---

## Service Role Rules

- Service role MAY bypass RLS
- Only from backend Edge Functions
- Never exposed to frontend
- Never used from client SDK

Service role bypass is **controlled execution**, not god-mode.

---

## Schema-wise Rules

### erp_core
- All tables RLS protected
- No anon access
- No blanket auth.uid() trust

### erp_acl
- Backend-only access
- No direct client visibility

### erp_audit
- INSERT only
- UPDATE / DELETE forbidden
- Append-only by design

### erp_meta
- Backend-only
- Internal state only

---

## Anonymous Access

- anon role = zero ERP access
- No ERP table in public schema
- No fallback or guest access

---

## Non-Negotiables

- RLS is NOT written for frontend convenience
- Backend convenience NEVER weakens RLS
- If backend needs access → service role is used
- Policies must be deterministic and minimal

---

## Gate Dependency

- This document MUST be read before:
  - 0.6B Enable RLS
  - 0.6C Default deny policies
  - 0.6D Service role bypass
  - 0.6E anon/auth lockdown

Violation of this philosophy invalidates the implementation.
