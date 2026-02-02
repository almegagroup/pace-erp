🔒 PACE-ERP — Gate-5 Freeze Declaration

File-ID: 5.9
File-Path: docs/GATE_5_FREEZE.md
Gate: 5
Phase: 5
Domain: CONTEXT / GOVERNANCE / SECURITY / DB
Status: 🔒 FROZEN
Authority: Backend
Scope: Context Authority & Resolution Governance
Date: (fill when frozen)

1️⃣ Purpose of Gate-5

Gate-5 exists to answer exactly one question:

“এই request-এর জন্য কোন business context প্রযোজ্য?”

Gate-5 নিশ্চিত করে যে:

Context কখনোই frontend দ্বারা নির্ধারিত হবে না

Backend ছাড়া কেউ context claim করতে পারবে না

Context failure হলে behaviour deterministic থাকবে

Gate-5 একটি authority + safety gate।

এটি explicitly করে না:

ACL policy define

Role escalation

Business permission evaluation

Actual company / project / department data creation

2️⃣ Context Authority Model (LOCKED)
✅ Absolute Authority Rule

Frontend → ZERO authority

Backend → Single source of context truth

Database → Enforcement layer, decision maker নয়

🔒 Locked Rule

Frontend-supplied context hints permanently ignored

Context resolve হয় backend pipeline-এর ভিতরে

কোনো request context ছাড়া proceed করতে পারে না

এই rule পরিবর্তনযোগ্য নয়।

3️⃣ Context Resolution Contract (LOCKED)

Gate-5 context-কে represent করে exactly:

UNRESOLVED

RESOLVED

আর কোনো implicit fallback নেই।

Invariant:

UNRESOLVED context = no business logic execution

RESOLVED context = single, isolated context per request

4️⃣ What Gate-5 IMPLEMENTS
4.1 Context Authority Lock — ✅ DONE (ID-5)

Backend-only context origin declared

Frontend context permanently disqualified

Authority invariant enforced

4.2 Context Resolver Pipeline — 🟡 PARTIAL (ID-5.1 → 5.1B)

Implemented:

Resolver skeleton

Deterministic resolution stages

Explicit UNRESOLVED representation

Missing-context handling contract

Deferred:

Actual ERP user → company / project / dept mapping
(ACL truth not available yet)

4.3 Org / Scope Boundary Declaration — 🟡 PARTIAL (ID-5.2 → 5.4A)

Declared (LOCKED):

Company boundary

Single-company invariant

Project ↔ company binding

Department boundary & access rule

Deferred:

Real org / project / department data

ACL-driven policy truth

4.4 Admin Universe Separation — 🟡 PARTIAL (ID-5.5 → 5.5A)

Implemented:

SA / GA bypass path declared

Isolation invariant enforced (admin ≠ ACL user)

Deferred:

Actual SA / GA detection source (ACL gate)

4.5 Context Failure Semantics — ✅ DONE (ID-5.6 → 5.6A)

LOCKED behaviour:

Context failure returns CONTEXT_* error codes

No logout on context failure

No silent fallback

No leakage

This behaviour is final and immutable.

4.6 DB / RLS Alignment — 🟡 PARTIAL (ID-5.7 → 5.7A)

Implemented:

Context-aware service-role DB client

Header-based RLS alignment path

Structural safety for zero-row return

Deferred:

Actual table-level RLS policies
(belongs to DB hard-lock gate)

4.7 Observability — ⏸ DEFERRED (ID-5.8)

Reason:

Context truth not yet meaningful

Logging now would create noise, not signal

Will be implemented when:

Context resolution becomes data-backed (Gate-6)

5️⃣ What Gate-5 EXPLICITLY DOES NOT Handle

❌ ACL policy
❌ Role hierarchy
❌ Company / project creation
❌ Department models
❌ Business permission checks
❌ Menu visibility
❌ UI behaviour
❌ Table-level RLS rules

These belong to future gates.

6️⃣ HALF-DONE Items (VALID & INTENTIONAL)
ID Range	Reason	Completes In
5.1	Context mapping needs ACL truth	Gate-6
5.2–5.4A	Org / project / dept data absent	Gate-6
5.5–5.5A	Admin detection via ACL	Gate-6
5.7–5.7A	Table-level RLS enforcement	Gate-7
5.8	Context observability	Gate-6

All HALF-DONE items:

Reason documented

Completion gate identified

Will not silently complete

7️⃣ Invariants (NON-NEGOTIABLE)

Frontend = zero context authority

Backend = single context authority

One request = one context

No cross-scope mixing

Context failure ≠ session failure

Local == Production behaviour

🔒 Final Freeze Statement

Gate-5 — Context Authority Gate is hereby declared FROZEN.

This means:

Context authority model is final

Failure semantics are locked

Resolution contract is immutable

No reinterpretation permitted

📊 Gate-5 Status Summary
ID	Status
5	✅ DONE
5.1	🟡 PARTIAL
5.1A	✅ DONE
5.1B	🟡 PARTIAL
5.2 → 5.4A	🟡 PARTIAL
5.5 → 5.5A	🟡 PARTIAL
5.6 → 5.6A	✅ DONE
5.7 → 5.7A	🟡 PARTIAL
5.8	⏸ DEFERRED
5.9	🔒 FROZEN
🔐 Authoritative Closure

Gate-5 is complete at the governance layer.

Next gate:
➡️ Gate-6 — ACL & Business Truth