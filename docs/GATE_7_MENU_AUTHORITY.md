# 🔒 Gate-7 — Menu Authority Lock

Status: FINAL · IMMUTABLE  
Gate: 7  
ID: 7  
Domain: GOVERNANCE  

---

## Purpose

This document formally locks **menu authority** to the backend.

From this point onward:

- Frontend has **zero authority** to decide menu visibility
- Menu is treated as a **security surface**, not a UI concern
- All menu visibility MUST originate from backend snapshot logic

---

## Authority Declaration

### Menu Truth Source

The **only valid source** of menu visibility is:

> Backend-generated menu snapshot  
> derived from:
> - User context
> - ACL decision truth
> - Module enablement
> - Hard deny rules

Frontend MUST NOT infer, compute, or mutate menu state.

---

## Forbidden Frontend Behaviors (Hard Rules)

The following are permanently disallowed:

- Role-based menu rendering
- Route-based menu inference
- Static or hardcoded menu lists
- Feature-flag driven menu visibility
- URL presence ≠ menu visibility assumptions

Violation of any rule invalidates Gate-7.

---

## Required Frontend Behavior

Frontend is restricted to:

- Rendering menu **only** from backend snapshot
- Treating snapshot as opaque data
- Never assuming route access from URL shape

Frontend may not “fix”, “patch”, or “guess” missing menu items.

---

## Security Rationale

Menu visibility is a **permission boundary**.

If a menu item is visible:
- It implies potential access
- Even if backend later denies the request

Therefore:
> Menu visibility must be at least as strict as ACL enforcement.

---

## Immutability Clause

This authority lock is FINAL.

Any future gate may:
- Consume this rule
- Build upon it

No future gate may:
- Weaken it
- Override it
- Bypass it

---

## Gate-7 Contract

ID-7 is complete when:

- This document exists
- No frontend code violates this authority model
- All future menu logic explicitly consumes backend snapshots

