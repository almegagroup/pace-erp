🔒 PACE-ERP — Gate-8 · G1 Screen Registry

File-ID: 8.1
File-Path: docs/GATE_8_G1_SCREEN_REGISTRY.md
Gate: 8
Phase: 8
Domain: FRONT / NAVIGATION / GOVERNANCE
Status: 🔒 FROZEN (Structure)
Authority: Navigation Engine
Scope: Screen Existence & Metadata Truth
Date: (fill when frozen)

────────────────────────────────────
1️⃣ Purpose of Gate-8 / G1
────────────────────────────────────

Gate-8 G1 exists to answer exactly one question:

“এই application-এ কোন কোন SCREEN সত্যি সত্যি EXIST করে?”

Gate-8 G1:

• Screen existence DEFINE করে  
• Screen identity LOCK করে  
• Screen type & lifecycle metadata LOCK করে  

This gate defines **STRUCTURAL TRUTH**, not behavior.

────────────────────────────────────
2️⃣ Screen Registry — Canonical Truth (ID-8.1)
────────────────────────────────────

🔒 Absolute Rule:

If a screen is NOT registered here,
it DOES NOT EXIST.

Not in:
• Router
• Component tree
• URL
• Deep link
• Keyboard shortcut

Screen existence = Registry ONLY.

────────────────────────────────────
3️⃣ Screen Identity Invariants (LOCKED)
────────────────────────────────────

Each screen MUST define:

• screen_code (canonical, immutable)
• route_path (if user-addressable)
• universe (SA | ACL | SHARED)

🔒 Invariants:

• screen_code is globally unique
• route collision is forbidden
• screen_code can never be reused
• Screen identity is immutable after declaration

────────────────────────────────────
4️⃣ Screen Metadata Rules (ID-8.1A)
────────────────────────────────────

Each screen MUST declare:

• screen_type
  – FULL    (primary workspace)
  – MODAL   (blocking overlay)
  – DRAWER  (side overlay)

• keepAlive flag
  – true  → state preserved on pop
  – false → state destroyed on pop

🔒 Locked Rules:

• Screen type is registry-defined, not UI-defined
• keepAlive is governance, not optimization
• Screen cannot override its declared metadata

────────────────────────────────────
5️⃣ Structural Safety Invariants
────────────────────────────────────

The registry guarantees:

• No duplicate screens
• No ambiguous screen behavior
• No implicit screen creation
• No runtime screen mutation

Violation of registry invariants = system defect.

────────────────────────────────────
6️⃣ Relationship to Other Gates
────────────────────────────────────

Gate-8 G1 CONSUMES:

• Gate-7 Menu Registry (menu → screen mapping)

Gate-8 G1 ENABLES:

• Screen Stack Engine (G2)
• BackGuard Engine (G3)
• Keyboard Intent Binding (G4 / G5)

Gate-8 G1 DOES NOT:

❌ Control navigation flow
❌ Push or pop screens
❌ Handle browser back
❌ Evaluate ACL
❌ Bind keyboard shortcuts

────────────────────────────────────
7️⃣ Failure Semantics
────────────────────────────────────

If a screen is requested that is NOT registered:

• Navigation is BLOCKED
• Screen is NOT rendered
• No fallback is allowed
• Error is deterministic

Absence = DENY (existence layer).

────────────────────────────────────
8️⃣ Status & Completion Rules
────────────────────────────────────

ID-8.1   Screen Registry        → 🟡 HALF-DONE
ID-8.1A  Screen Metadata Rules  → 🟡 HALF-DONE

Why HALF-DONE:

• Structural truth exists ✔️
• Runtime consumption not yet wired ❌

Completion requires:

• G2 Screen Stack Engine consumption
• G3 BackGuard validation
• G4/G5 Keyboard binding

────────────────────────────────────
🔒 Final Freeze Statement
────────────────────────────────────

Gate-8 G1 — Screen Registry
is hereby declared **STRUCTURALLY FROZEN**.

This means:

• Screen existence rules are immutable
• Screen metadata rules cannot change
• Future gates may CONSUME but must not reinterpret

Any conflict:

👉 Gate-8 G1 SSOT wins.

────────────────────────────────────
🔐 Authoritative Closure
────────────────────────────────────

Gate-8 G1 is complete at the structural truth layer.

Next group:
➡️ Gate-8 G2 — Screen Stack Engine
