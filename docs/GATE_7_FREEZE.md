🔒 PACE-ERP — Gate-7 Freeze Declaration (UPDATED)

File-ID: 7.10
File-Path: docs/GATE_7_FREEZE.md
Gate: 7
Phase: 7
Domain: MENU / VISIBILITY / FRONTEND / SECURITY
Status: 🔒 FROZEN
Authority: Backend
Scope: Menu Visibility & Snapshot Consumption
Baseline: Post Gate-6 Execution Seal + Phase-A DB Hardening
Date: (fill on commit)

1️⃣ Purpose of Gate-7

Gate-7 exists to answer exactly one question:

“এই user-টা UI-তে কী কী দেখতে পারবে — তার FINAL TRUTH কী?”

Gate-7:

❌ ACL truth define করে না

❌ Permission evaluate করে না

❌ Business authority পরিবর্তন করে না

Gate-7 কেবল:

Gate-6 ACL truth consume করে

Deterministic menu snapshot তৈরি করে

Frontend-কে read-only visibility truth দেয়

Gate-7 একটি VISIBILITY CONSUMPTION GATE —
এটি authorization, execution, বা navigation authority gate নয়।

2️⃣ Menu Visibility Authority Model (LOCKED)
✅ Absolute Visibility Rule

Backend snapshot → ONLY source of menu & route visibility truth

Frontend → ZERO authority
URL / Route / Menu → snapshot ছাড়া কিছুই visible নয়

🔒 Locked Rules

Frontend কখনো role / permission infer করবে না

Frontend কখনো menu hardcode করবে না

Manual URL entry দিয়েও snapshot deny হলে access হবে না

Visibility ≠ Permission (Permission = Gate-6)

এই নিয়মগুলো পরিবর্তনযোগ্য নয়।

3️⃣ Menu Authority Lock (ID-7) — ✅ DONE

Declared & Locked:

Menu visibility backend-authoritative

UI authority permanently revoked

Snapshot ছাড়া কোনো menu / route visible নয়

এই authority Gate-7 এ চূড়ান্তভাবে LOCKED।

4️⃣ Menu Structure Truth (LOCKED STRUCTURE)
4.1 Menu Master (ID-7.1)

Declared (LOCKED):

menu_master = canonical menu resource registry

Unique resource_code

Valid route metadata

No orphan / duplicate menu items

RLS FORCE enabled

Deferred (Tooling Only)

Admin UI

Bulk authoring interface

🟢 Structural layer COMPLETE
🔒 Governance layer SEALED

4.2 Menu Tree (ID-7.2 → 7.2A)

Declared (LOCKED):

Parent → child deterministic hierarchy

Deterministic ordering

No cycles

Hidden parent hides all children

Structural invariants DB-enforced.

Deferred (UI Tooling)

Visual tree editor

Drag-drop admin UI

🟢 Structural integrity COMPLETE
🔒 Projection safety GUARANTEED

5️⃣ Snapshot Generation Truth
5.1 Snapshot Engine (ID-7.3) — ✅ EXECUTION SEALED

Declared:

Snapshot generated per:

user

company

active ACL version

Snapshot derived ONLY from:

Gate-6 precomputed ACL truth

Company module enablement

User overrides

🔎 Projection Integrity Proven

precomputed_acl_view থেকে ALLOW row delete করা হয়েছে

Snapshot regenerate করা হয়েছে

menu_snapshot empty হয়েছে

Meaning:

No fallback

No auto allow

No recompute in frontend

Snapshot = single source

Absence = visibility deny

🔒 7.3 EXECUTION SEALED

5.2 Snapshot Refresh Rules (ID-7.3A) — 🔒 SEALED (Phase-A Model)

Declared:

Deterministic rebuild capability

Refresh rule registry defined

Manual regenerate available

No stale serve

Explicit Model

Automatic trigger-based regeneration = deferred
Manual deterministic regeneration = constitutionally valid

Optimization ≠ Governance requirement.

🔒 7.3A SEALED (Stability-First Model)

6️⃣ Snapshot Delivery API (ID-7.4) — ✅ DONE

Implemented & LOCKED:

/api/me/menu only endpoint

SA / GA → Admin universe menu

ACL users → Snapshot-derived tree only

Deterministic envelope

No alternate endpoint allowed.

7️⃣ Visibility Safety & Hard Deny (ID-7.5) — ✅ DONE

LOCKED behaviour:

Menu item not in snapshot = invisible

No partial render

No fallback

No silent allow

Absence = DENY (visibility layer)

8️⃣ Frontend Consumption Rules (LOCKED)
8.1 Route Map & Guards (ID-7.6)

Route index built ONLY from snapshot

Navigation blocked if route not in snapshot

Safe redirect enforced

8.2 Rendering Discipline (ID-7.7)

Sidebar / header rendered from snapshot only

Hidden routes redirect safely

No hardcoded UI paths

8.3 Deep-Link Protection (ID-7.8)

Manual URL entry cannot bypass snapshot

Direct navigation guarded

Frontend is a pure consumer.

🔒 Frontend Authority Model: FINAL

9️⃣ Observability (ID-7.9) — 🔒 FUNCTIONALLY COMPLETE

Current State:

Serve-time visibility deterministic

No misleading logging

No partial audit

Advanced observability intentionally deferred to later gate.

No false sense of security allowed.

🔟 What Gate-7 EXPLICITLY DOES NOT Handle

❌ ACL evaluation
❌ Permission precedence
❌ Business execution
❌ RLS enforcement
❌ Approval workflow
❌ Snapshot performance tuning
❌ Version rollback

These belong to other gates.

1️⃣1️⃣ Deferred Items (EXPLICIT & VALID)
ID Range	Nature	Completes In
7.1 Tooling	Admin UX	Gate-9
7.3 Optimization	Background rebuild	Gate-10
7.9 Deep observability	Trace persistence	Gate-13

Deferred ≠ Missing
Deferred = Controlled roadmap alignment

1️⃣2️⃣ Invariants (NON-NEGOTIABLE)

Visibility ≠ Permission

Snapshot absence = deny

Frontend = consumer only

URL ≠ access

Local == Production behaviour

Violation invalidates Gate-7.

🔒 Final Freeze Statement

Gate-7 — Menu & Visibility Gate is hereby declared FROZEN.

This means:

Menu visibility rules are final

Snapshot-driven UI is mandatory

No menu / route / visibility logic may change under Gate-7

Future change requires new gate

📊 Gate-7 Status Summary (UPDATED)
ID	Status
7	✅ DONE
7.1	🟢 STRUCTURAL COMPLETE
7.2 → 7.2A	🟢 STRUCTURAL COMPLETE
7.3	🔒 SEALED
7.3A	🔒 SEALED (Phase-A Model)
7.4	✅ DONE
7.5 → 7.8	✅ DONE
7.9	🔒 FUNCTIONALLY COMPLETE
7.10	🔒 FROZEN
🔐 Authoritative Closure

Gate-7 is complete at:

Governance layer

Structural layer

Projection layer

Delivery layer

Frontend enforcement layer

Next gate:

➡️ Gate-8 — Navigation & Screen Stack Authority