# 🔒 PACE-ERP — Gate-4 Freeze Declaration

**File-ID:** 4.7  
**File-Path:** docs/GATE_4_FREEZE.md  
**Gate:** 4  
**Phase:** 4  
**Domain:** USER LIFECYCLE / AUTH / ADMIN / AUDIT  
**Status:** 🔒 FROZEN  
**Authority:** Backend  
**Scope:** ERP User Lifecycle Governance  
**Date:** (fill when frozen)

---

## 1️⃣ Purpose of Gate-4

Gate-4 exists to transition ERP users from:

> **“identity exists” → “ERP access is governed”**

This gate defines **who may exist as an ERP user**, **under whose approval**, and **with what minimal system footprint**.

Gate-4 is a **governance + lifecycle gate**.

It explicitly does **NOT** define:
- permissions
- context
- business access
- session semantics

---

## 2️⃣ Lifecycle Authority (LOCKED)

### ✅ Authority Split
- **Supabase Auth** → identity + credentials only
- **Gate-4** → ERP user existence & lifecycle

No other gate may:
- activate ERP users
- reject ERP users
- assign ERP `user_code`

---

## 3️⃣ Lifecycle States (LOCKED)

Gate-4 recognises **exactly**:

- `PENDING`
- `ACTIVE`
- `REJECTED`
- `DISABLED` *(future gate only)*

No additional states are allowed under Gate-4.

---

## 4️⃣ What Gate-4 IMPLEMENTS

### 4.1 Signup Intake — ✅ DONE (ID-4.1 → 4.1C)

- Public `/api/signup`
- Mandatory backend human-verification
- Supabase Auth identity **must already exist**
- Creates ERP user in `PENDING`
- Captures metadata for SA review
- Always returns **generic success** (enumeration-safe)

❗ **Atomicity Note (Intentional)**  
`erp_core.users` and `erp_core.signup_requests` are inserted separately.

- This is **not a bug**
- This is a **deliberate Gate-4 design choice**
- Atomic transactions are deferred to later lifecycle gates

---

### 4.2 Signup Metadata Capture — ✅ DONE

Captured **only for SA decision context**:
- name
- parent company
- designation hint
- phone number

Rules:
- Metadata has **no authority**
- Metadata does **not affect login**
- Metadata does **not grant access**

---

### 4.3 SA Approval Workflow — ✅ DONE (ID-4.2A)

- Only **SA** may approve
- Approval results in:
  - ERP user → `ACTIVE`
  - Deterministic `P0001`-style `user_code`
  - Minimal ACL bootstrap (`L1_USER` only)

Mechanics:
- `erp_core.user_code_p_seq`
- RPC-safe SQL function `erp_meta.next_user_code_p_seq()`

❌ No FIRST_LOGIN_REQUIRED concept exists.

---

### 4.4 Rejection Workflow — ✅ DONE (ID-4.2)

- signup request → `REJECTED`
- ERP user → `REJECTED`
- No `user_code`
- No ACL assignment
- Rejection is **final under Gate-4**

---

### 4.5 Deterministic `user_code` Generation — ✅ DONE

- Format: `P0001`, `P0002`, …
- Generated **only at approval**
- Backed by DB sequence
- Immutable once assigned
- Used as ERP login identifier

---

### 4.6 Minimal ACL Bootstrap — 🟡 PARTIAL (BY DESIGN)

- On approval:
  - Exactly one role: `L1_USER`
- No escalation
- No overrides

Reason:
- Full ACL logic belongs to **future ACL gates**
- Gate-4 only asserts **existence**, not authority

---

### 4.7 Audit & Observability — ✅ DONE

- Every approve / reject:
  - Append-only insert into `erp_audit.signup_approvals`
- Structured logs emitted
- Request-ID linked
- No mutation, no deletion

---

## 5️⃣ What Gate-4 EXPLICITLY DOES NOT Handle

❌ Password handling  
❌ Session creation  
❌ Login success semantics  
❌ Context / company binding  
❌ Role escalation  
❌ Permission evaluation  
❌ Menu visibility  
❌ UI logic  

These belong to **later gates**.

---

## 6️⃣ HALF-DONE Items (VALID & INTENTIONAL)

| Area | Reason |
|----|----|
| Extended ACL bootstrap | Gate-6 dependency |
| Role escalation | ACL governance gate pending |
| Context binding | Gate-5 responsibility |
| DISABLED lifecycle | Future admin lifecycle gate |

All HALF-DONE items:
- Have boundaries defined
- Have completion gate identified
- Will **not silently complete**

---

## 7️⃣ DB Migration Policy (LOCKED)

Gate-4 introduces **only lifecycle-essential DB objects**:

Allowed:
- `erp_core.users`
- `erp_core.signup_requests`
- `erp_audit.signup_approvals`
- `erp_core.user_code_p_seq`
- `erp_meta.next_user_code_p_seq()`

Not allowed:
- ACL schema expansion
- Context schema
- Business tables

---

## 8️⃣ RPC Policy (LOCKED)

- No RPC-driven lifecycle decisions
- RPC used **only** as deterministic DB primitive
- Behaviour authority remains in backend handlers

---

## 9️⃣ Invariants (NON-NEGOTIABLE)

- Supabase Auth = credential SSOT
- ERP never handles passwords
- Enumeration safety everywhere
- Backend is sole authority
- Local == Production behaviour

---

## 🔒 Final Freeze Statement

> **Gate-4 is hereby declared FROZEN.**

This means:
- User lifecycle behaviour is final
- Signup / approval / rejection contracts are locked
- No changes permitted under Gate-4

---

## 📊 Gate-4 Status Summary

| ID | Status |
|---|---|
| 4 | 🟢 COMPLETE |
| 4.0A | ✅ DONE |
| 4.0B | ✅ DONE |
| 4.0C | 🟡 PARTIAL (by design) |
| 4.1 → 4.1C | ✅ DONE |
| 4.2 → 4.2B | ✅ DONE |
| **4.7** | **🔒 FROZEN** |

---

## 🔐 Authoritative Closure

Gate-4 is **complete at the governance layer**.

Next gate:
➡️ **Gate-5 — Context Resolution**

No ambiguity remains.
