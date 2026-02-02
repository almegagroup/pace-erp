# 🔐 PACE-ERP — Gate-4 / ID-4  
## User Lifecycle Boundary (Decision Document)

**Gate:** 4  
**ID:** 4  
**Domain:** GOVERNANCE · USER LIFECYCLE  
**Nature:** DECISION DOC (NO CODE · NO MIGRATION)  
**Status:** READY FOR FREEZE  

---

## 1. Purpose

This document defines **what it means to be an ERP user** in PACE-ERP.

It explicitly separates:
- Identity vs Access
- Password vs Permission
- Login vs Dashboard Access

No implementation is allowed to reinterpret this document.
All future Gates MUST comply with it.

---

## 2. Core Separation (Non-Negotiable)

### 2.1 Identity ≠ ERP User

- Supabase Auth user = **identity only**
- ERP user = **access authority**

Either may exist without the other.

ERP never treats Supabase Auth presence as access permission.

---

### 2.2 Password ≠ Access

- Password lifecycle is owned by **Supabase Auth**
- ERP access lifecycle is owned by **ERP governance**

System Admin (SA) NEVER:
- sets passwords
- resets passwords
- views credentials

---

## 3. ERP User Lifecycle States (LOCKED)

An ERP user may exist ONLY in the following states:

| State | Meaning |
|------|--------|
| `PENDING` | Signup requested, no access |
| `ACTIVE` | Approved by SA, access allowed |
| `REJECTED` | Explicitly denied access |
| `DISABLED` | Access revoked after activation |

The following states are **explicitly forbidden**:
- `FIRST_LOGIN_REQUIRED`
- `TEMP_ACTIVE`
- `AUTO_APPROVED`
- any time-based or conditional state

---

## 4. Allowed State Transitions (STRICT)

Only the following transitions are allowed:

∅ → PENDING (public signup request)
PENDING → ACTIVE (SA approval)
PENDING → REJECTED (SA rejection)
ACTIVE → DISABLED (SA action)
DISABLED → ACTIVE (SA re-enable)

yaml
Copy code

No automatic transitions are allowed.
No self-service activation is allowed.

---

## 5. Authority Model

| Action | Authority |
|------|----------|
| Create ERP user (PENDING) | System (public API) |
| Approve / Reject | **System Admin (SA) only** |
| Disable / Re-enable | **System Admin (SA) only** |
| Login attempt | End user |
| Dashboard access | System (deterministic) |

No GA, Manager, or other role may modify lifecycle state.

---

## 6. Signup Truth

Signup means:
- Supabase Auth identity exists
- ERP user record created in `PENDING`
- **NO ERP access is granted**

Signup API responses MUST:
- be generic
- be enumeration-safe
- reveal nothing about approval outcome

---

## 7. Login vs Access Rule (CRITICAL)

### 7.1 Login Success ≠ Dashboard Access

It is valid for the system to allow:
- successful authentication
- session creation

and still deny:
- ERP dashboard access

If ERP user state ≠ `ACTIVE`.

---

### 7.2 Enforcement Model

- Session may exist
- UI access is blocked deterministically
- No frontend guesswork
- No redirect heuristics

Backend is the sole authority.

---

## 8. User Code Rule (`P0001`)

- `user_code` is generated **ONLY** on SA approval
- Never at signup
- Never reused
- Immutable once assigned

`user_code` represents ERP identity,
not authentication identity.

---

## 9. Explicit Non-Scope of ID-4

This ID does NOT define:
- Roles or permissions
- ACL evaluation
- Context (company / project)
- Menu visibility
- Navigation
- Audit schema design

These belong to later Gates.

---

## 10. Freeze Rule

Once this document is approved:
- No new lifecycle states may be introduced
- No reinterpretation is allowed
- All future Gates MUST reference this document

This ID becomes **constitutional**.

---

## 11. Acceptance Criteria

ID-4 is considered DONE when:
- This document is approved verbatim
- No code is written
- No DB migration is introduced
- Subsequent IDs (4.1, 4.2, 4.4) reference this file

---

**End of Document**