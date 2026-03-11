🔒 PACE-ERP — Gate-6 Freeze Declaration (FINAL)

File-ID: 6.2
File-Path: docs/GATE_6_FREEZE.md
Gate: 6
Phase: 6
Domain: ACL / MASTER DATA / GOVERNANCE / SECURITY
Status: 🔒 FROZEN
Authority: Backend
Scope: ACL & Business Truth (Single Source of Authorization Truth)
Date: (fill current freeze date)

1️⃣ Purpose of Gate-6

Gate-6 answers one immutable question:

“এই system-এ কে, কোথায়, কী করতে পারে — তার FINAL TRUTH কী?”

Gate-6:

Authorization truth DEFINE করে

Business & ACL structure LOCK করে

Deterministic resolution model establish করে

Enforcement contract declare করে

Future gates-এর জন্য immutable foundation দেয়

Gate-6 is a TRUTH + RESOLUTION + ENFORCEMENT GATE
এটি UI, rendering বা optimization gate নয়।

2️⃣ ACL Authority Model (LOCKED)
Absolute Authorization Rule

Frontend → ZERO authority
Backend ACL Engine → ONLY source of permission truth
Database (RLS) → Enforcement layer

🔒 Locked Rules

কোনো permission frontend থেকে infer করা যাবে না

কোনো UI decision authoritative নয়

Permission truth = backend ACL resolver only

RLS = enforcement, not interpretation

এই model পরিবর্তনযোগ্য নয়।

3️⃣ Role System — Canonical Hierarchy (SEALED)
3.1 Role Ladder (ID-6.1, 6.1A)

Canonical role set

Numeric deterministic rank

Normalized identity

No runtime role mutation

🔒 Invariants

Higher rank ⊇ lower rank (unless explicit DENY)

Deterministic comparison only

No dynamic role creation

Status: 🔒 SEALED

4️⃣ Business Master Truth (SEALED)
4.1 Company Master (ID-6.2 → 6.2A)

Canonical org root

Deterministic company identity

ACTIVE lifecycle enforced

RLS FORCE enabled

Status: 🔒 SEALED

4.2 Project Master (ID-6.3 → 6.3A)

SAP Global Model:

Project is global entity

Not company-bound

Company ↔ Project via mapping layer

Lifecycle bounded

Isolation via mapping + centralized RLS

Status: 🔒 SEALED (Post SAP Upgrade)

4.3 Department Master (ID-6.4 → 6.4A)

Company-bound HR scope

Deterministic lifecycle

Isolation via RLS

Status: 🔒 SEALED

5️⃣ User ↔ Organization Truth (SEALED)
5.1 User ↔ Company (6.6 → 6.6A)

Deterministic primary company

Multiple work companies allowed

Unique primary rule enforced

Status: 🔒 SEALED

5.2 User ↔ Project (6.7 → 6.7A)

UserProject ⊆ CompanyProject

Mapping-based validation

Cross-company leakage forbidden

Status: 🔒 SEALED

5.3 User ↔ Department (6.8 → 6.8B)

Single HR department identity

Department ∈ user’s company

Unique HR binding

Status: 🔒 SEALED

6️⃣ ACL Permission Structure (SEALED)
6.1 Role Menu Permissions (6.9 → 6.9A)

Canonical resource registry

Action vocabulary

Default DENY base

Data-driven menu hierarchy

Status: 🔒 SEALED (Structural Layer)

6.2 Capability Packs (6.10 → 6.10A)

Permission bundling model

Conflict precedence metadata

No execution embedded

Status: 🔒 SEALED (Structural Layer)

6.3 Company Module Map (6.11 → 6.11A)

Company-level module enablement

Hard-deny declaration

No runtime leakage

Status: 🔒 SEALED

6.4 User Overrides (6.12 → 6.12A)

Explicit ALLOW / DENY exception

Append-only audit

Company-scoped

Status: 🔒 SEALED

7️⃣ Approval Routing Structure (SEALED)
7.1 Approver Map (6.13 → 6.13A)

Ordered stage model

Role OR explicit user (XOR)

No duplicate stage

Deterministic routing surface

Workflow execution intentionally deferred.

Status: 🔒 SEALED (Structural Layer)

8️⃣ ACL Decision Brain (SEALED)
8.1 Precedence Ladder (6.14)

Final order (IMMUTABLE):

Hard Deny

User DENY

User ALLOW

Role / Capability / Module

Default DENY

Status: 🔒 SEALED

8.2 VWED Engine & Resolver (6.15 → 6.16A)

Stateless evaluator

Deterministic decision

Default DENY

Structured decision trace

No silent allow

Status: 🔒 SEALED

9️⃣ Versioning & Snapshot (SEALED)
9.1 ACL Versions (6.18)

Single active version per company

Version uniqueness enforced

Deterministic evaluation base

Status: 🔒 SEALED

9.2 Precomputed ACL View (6.18A)

Version-bound snapshot

User-scoped

Deterministic identity

RLS FORCE

Status: 🔒 SEALED

🔟 DB / RLS Binding (SEALED)
10.1 RLS Enforcement (6.19 → 6.19A)

ENABLE + FORCE RLS everywhere

Company isolation

Lifecycle enforcement

Default deny fallback

Status: 🔒 SEALED

1️⃣1️⃣ What Gate-6 Explicitly Does NOT Handle

❌ Menu rendering
❌ UI navigation
❌ Snapshot UI exposure
❌ Approval workflow execution
❌ Performance caching
❌ Observability dashboard
❌ Audit visualization

These belong to future gates.

🔒 Final Freeze Statement

Gate-6 — ACL, Business Structure, Resolver & Enforcement Layer is hereby declared FROZEN.

This means:

Authorization truth is final

Role hierarchy immutable

Business model locked

Scope mapping immutable

Precedence order immutable

Enforcement contract immutable

RLS contract immutable

Future gates may CONSUME
But must not REINTERPRET

Any conflict:

👉 Gate-6 SSOT wins.

📊 Gate-6 Status Summary
Layer	Status
Layer-1	🔒 SEALED
Layer-2	🔒 SEALED
Layer-3	🔒 SEALED
Layer-4	🔒 SEALED
Layer-5	🔒 SEALED
Layer-6	🔒 SEALED
Freeze (6.2)	🔒 FROZEN
🔐 Authoritative Closure

Gate-6 is complete at:

Truth Layer

Structural Layer

Scope Layer

Permission Layer

Decision Brain

Enforcement Layer

Next Gate:

➡️ Gate-7 — Menu, Visibility & Snapshot Consumption