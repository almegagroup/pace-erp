🔒 PACE-ERP — Gate-6 Freeze Declaration

File-ID: 6.2
File-Path: docs/GATE_6_FREEZE.md
Gate: 6
Phase: 6
Domain: ACL / MASTER DATA / GOVERNANCE / SECURITY
Status: 🔒 FROZEN
Authority: Backend
Scope: ACL & Business Truth (Single Source of Authorization Truth)
Date: (fill when frozen)

1️⃣ Purpose of Gate-6

Gate-6 exists to answer exactly one question:

“এই system-এ কে, কোথায়, কী করতে পারে — তার FINAL TRUTH কী?”

Gate-6:

Authorization truth DEFINE করে

Business & ACL structure LOCK করে

Future execution gates-এর জন্য immutable foundation দেয়

Gate-6 একটি TRUTH DEFINITION GATE —
এটি execution, rendering, optimization gate নয়।

2️⃣ ACL Authority Model (LOCKED)
✅ Absolute Authorization Rule

Frontend → ZERO authority

Backend ACL engine → ONLY source of permission truth

Database (RLS) → enforcement layer, decision maker নয়

🔒 Locked Rule

কোনো permission frontend থেকে infer করা যাবে না

কোনো UI decision authoritative নয়

Permission truth = backend ACL only

এই rule পরিবর্তনযোগ্য নয়।

3️⃣ Role System — Canonical Hierarchy (LOCKED)
3.1 Role Ladder (ID-6.1, 6.1A)

Canonical role set with numeric ranks

Deterministic comparison helpers

Inheritance is implicit via rank

🔒 Invariants:

Higher rank ⊇ lower rank (unless explicitly denied later)

Role normalization deterministic

No dynamic / runtime role creation

4️⃣ Business Master Truth (LOCKED)

Gate-6 declares what business entities exist and how they are allowed to relate.

4.1 Company Master (ID-6.2 → 6.2A)

Canonical company identity

Deterministic company_code

GST-aware lifecycle

ACTIVE / INACTIVE invariants enforced

Company = legal & operational root truth

4.2 Project Master (ID-6.3 → 6.3A) — 🟡 PARTIAL

Declared (LOCKED):

Project belongs to exactly one company

Project lifecycle defined

Safe deletion constraints declared

Deferred:

Runtime enforcement via ACL & RLS

UI / admin workflows

4.3 Department Master (ID-6.4 → 6.4A) — 🟡 PARTIAL

Declared (LOCKED):

Department bound to a single company

HR scope isolation rule

Deferred:

HR module usage

RLS enforcement

5️⃣ User ↔ Organization Truth (LOCKED)
5.1 User ↔ Company (ID-6.6 → 6.6A)

Declared:

Parent Company (HR truth)

Work Company (operational scope)

Deterministic primary / HR company rule

🔒 Invariants:

HR modules → Parent Company

Business modules → Work Company

Violation = hard DENY (later gate)

5.2 User ↔ Project (ID-6.7 → 6.7A)

Declared:

User project access ⊆ company projects

Cross-company leakage forbidden

5.3 User ↔ Department (ID-6.8 → 6.8A)

Declared:

Department ∈ user’s company

HR isolation invariant locked

6️⃣ ACL Permission Truth (LOCKED STRUCTURE)
6.1 Role-Menu Permissions (ID-6.9 → 6.9A) — 🟡 PARTIAL

Declared:

Resource-action (VWED…) model

Canonical resource codes

Menu permission truth storage

Deferred:

Snapshot generation

UI rendering

6.2 Capability Packs (ID-6.10 → 6.10A) — 🟡 PARTIAL

Declared:

Permission grouping via capability packs

Precedence rules between role & pack

Deferred:

Runtime resolution

Admin UI

6.3 Company Module Map (ID-6.11 → 6.11A) — 🟡 PARTIAL

Declared:

Module enablement per company

Hard-deny rule if module disabled

Deferred:

Runtime enforcement

6.4 User Overrides (ID-6.12 → 6.12A) — 🟡 PARTIAL

Declared:

Explicit ALLOW / DENY per user

Override audit requirement

Deferred:

Runtime precedence execution

7️⃣ Approval Truth (LOCKED STRUCTURE)
7.1 Approver Map (ID-6.13 → 6.13A) — 🟡 PARTIAL

Declared:

Targeted approvers

Max 3 approvers

No circular / empty chains

Deferred:

Workflow execution

UI flows

8️⃣ ACL Decision Brain (DEFINED, NOT EXECUTED)
8.1 Precedence Ladder (ID-6.14)

Declared final order:

Hard Deny

User DENY

User ALLOW

Role / Capability / Company / Dept

Default DENY

This ladder is FINAL & IMMUTABLE.

8.2 VWED Engine & Resolver (ID-6.15 → 6.16A) — 🟡 PARTIAL

Implemented:

Deterministic evaluation logic

Decision trace structure

Deferred:

Runtime wiring

Snapshot binding

9️⃣ Versioning & Performance Foundations
9.1 ACL Versions (ID-6.18) — 🟡 PARTIAL
9.2 Precomputed ACL View (ID-6.18A) — 🟡 PARTIAL

Declared:

Versioned ACL change sets

Precompute-ready schema

Deferred:

Population

Rollback UI

TTL cache

🔟 DB / RLS Binding Declaration
10.1 RLS Alignment (ID-6.19 → 6.19A) — 🟡 PARTIAL

Declared:

ACL verdict → RLS binding contract

Zero-row deny fallback

Deferred:

ENABLE / FORCE RLS

USING / WITH CHECK policies
(Belongs to DB hard-lock gate)

1️⃣1️⃣ What Gate-6 EXPLICITLY DOES NOT Handle

❌ Menu rendering
❌ ACL snapshot generation
❌ UI routing
❌ Performance caching
❌ Version rollback execution
❌ Table-level RLS policies
❌ Workflow execution

These belong to future gates by design.

1️⃣2️⃣ HALF-DONE Items (VALID & INTENTIONAL)
ID Range	Reason	Completes In
6.3–6.4A	Business data exists, enforcement later	Gate-7
6.9–6.16A	ACL truth defined, execution later	Gate-10
6.18–6.18A	Versioning structure only	Gate-12
6.19–6.19A	RLS binding declared	Gate-13

All HALF-DONE items:

Explicitly documented

Correctly gated

No silent dependency

🔒 Final Freeze Statement

Gate-6 — ACL & Business Truth Gate is hereby declared FROZEN.

This means:

ACL truth is final

Role hierarchy is immutable

Business & org structure is locked

Precedence rules cannot change

Future gates may CONSUME but must not REINTERPRET

Any future conflict:

👉 Gate-6 SSOT wins.

📊 Gate-6 Status Summary
ID	Status
6	✅ DONE
6.1 → 6.2A	✅ DONE
6.3 → 6.8A	🟡 PARTIAL
6.9 → 6.16A	🟡 PARTIAL
6.18 → 6.19A	🟡 PARTIAL
6.2	🔒 FROZEN
🔐 Authoritative Closure

Gate-6 is complete at the truth & governance layer.

Next gate:
➡️ Gate-7 — Menu, Visibility & Snapshot Consumption