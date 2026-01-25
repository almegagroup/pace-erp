# 🔒 PACE-ERP — Gate-3 Freeze Declaration

**Gate:** 3  
**Domain:** SESSION / SECURITY / OBSERVABILITY  
**Status:** 🔒 FROZEN  
**Authority:** Backend  
**Scope:** Session Lifecycle Governance  
**Date:** (fill when you freeze)

---

## 1️⃣ Purpose of Gate-3

Gate-3 exists to transition ERP sessions from:

> **“session exists” → “session is governed over time”**

This gate defines **how long a session may live**, **when it must die**, and **how logout is enforced**, without introducing storage, policy values, or UI concerns.

Gate-3 is a **behaviour + contract gate**, not a storage or configuration gate.

---

## 2️⃣ What Gate-3 DEFINITIVELY Establishes (Locked)

### ✅ Session Lifecycle Authority
- Session existence is decided in **Gate-2**
- Session continuation is governed in **Gate-3**
- No other layer may override this responsibility

### ✅ Deterministic Session States
Gate-3 recognises and enforces:
- `ACTIVE`
- `IDLE_WARNING`
- `IDLE_EXPIRED`
- `TTL_EXPIRED`
- `REVOKED`
- `SESSION_FORCE_LOGOUT`

### ✅ Enforcement Guarantees
- Absolute TTL always overrides idle logic
- Idle logic never extends TTL
- Any `SESSION_*` outcome **forces LOGOUT**
- Logout is deterministic and immediate

---

## 3️⃣ What Gate-3 IMPLEMENTS

### 3.1 Idle Lifecycle (Logic Locked)
- Detect inactivity
- Emit warning signal
- Force logout on idle expiry  
*(Policy values intentionally deferred)*

### 3.2 Absolute TTL (Logic Locked)
- Age-based session expiry
- No extension allowed under any circumstance  
*(TTL value intentionally deferred)*

### 3.3 Single Active Session (DONE)
- New login revokes all existing ERP sessions
- Exactly one ACTIVE session per user

### 3.4 Admin Force Revoke (DONE)
- SA may revoke all sessions of a user
- Next request forces logout

### 3.5 Device Signals (Soft, Non-Blocking)
- Device change detection
- Signal only, no enforcement

### 3.6 Session Fixation Prevention
- Session identifier rotation on login
- Fresh cookie issuance on every auth

### 3.7 Deterministic Logout Enforcement (DONE)
- Any `SESSION_*` state results in forced logout
- Centralised enforcement in pipeline runner

### 3.8 Observability (DONE)
- Structured session timeline logs
- Request-ID linked
- No behaviour change
- RCA / audit ready

---

## 4️⃣ What Gate-3 EXPLICITLY DOES NOT Handle

The following are **intentionally out of scope** and MUST NOT be added under Gate-3:

- ❌ DB schema creation or migration
- ❌ Session table evolution
- ❌ Policy value locking (TTL duration, idle time)
- ❌ Device trust enforcement
- ❌ Project / tenant context
- ❌ Role or permission logic
- ❌ RPC-based session decisions

All of the above belong to **future gates**.

---

## 5️⃣ HALF-DONE Items (Intentional & Valid)

The following are marked **HALF-DONE by design**:

| Area | Reason |
|----|----|
| Idle timeout values | Policy not locked yet |
| TTL duration | Config / policy gate pending |
| Device trust enforcement | Security trust gate pending |
| Session DB fields | Storage gate pending |

Each HALF-DONE item:
- Has logic implemented
- Has completion gate identified
- Will **not silently complete**

This is **not a failure state**.

---

## 6️⃣ DB Migration Policy (Locked)

> **Gate-3 introduces ZERO database migrations.**

This is intentional.

- Gate-3 assumes **logical presence** of session attributes
- Physical storage decisions belong to storage-focused gates
- Behaviour and storage are deliberately decoupled

---

## 7️⃣ RPC Policy (Locked)

- No RPC is used in Gate-3
- All session decisions occur in backend handlers
- DB remains a data store, not a behaviour authority

RPC may be introduced in **future non-security domains only**.

---

## 8️⃣ Final Freeze Statement

> **Gate-3 is hereby declared FROZEN.**

This means:
- All behaviour is final
- All contracts are locked
- No further changes are permitted under Gate-3
- Any new requirement must be implemented in a new Gate with a new ID

---

## 9️⃣ Gate-3 Status Summary

| ID | Status |
|---|---|
| 3.1 → 3.1B | 🟡 HALF-DONE |
| 3.2 → 3.2A | 🟡 HALF-DONE |
| 3.3 → 3.3A | ✅ DONE |
| 3.4 → 3.4A | ✅ DONE |
| 3.5 → 3.5A | 🟡 HALF-DONE |
| 3.6 → 3.6A | 🟡 HALF-DONE |
| 3.7 → 3.7A | ✅ DONE |
| 3.8 | ✅ DONE |
| **3.9** | **🔒 FROZEN** |

---

## 10️⃣ Authoritative Closure

Gate-3 is **complete at the layer level**.

Future work will proceed only through:
- New Gate
- Explicit ID
- State-file entry

No ambiguity remains.

---
