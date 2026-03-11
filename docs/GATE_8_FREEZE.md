🔒 PACE-ERP — Gate-8 Freeze Declaration
File-ID: 8.8
File-Path: docs/GATE_8_FREEZE.md
Gate: 8
Phase: 8
Domain: NAVIGATION / SCREEN STACK / FRONTEND / SECURITY
Status: 🔒 FROZEN
Authority: Screen Stack Engine
Scope: Navigation Authority, Screen Stack, Back Navigation, Keyboard Intent
Date: (fill when frozen)
1️⃣ Purpose of Gate-8

Gate-8 exists to answer one architectural question:

“ERP application-এর ভেতরে navigation-এর FINAL AUTHORITY কোথায়?”

Gate-8 এর দায়িত্ব:

Navigation authority lock করা
Screen stack model define করা
Browser / Router / Keyboard কে signal layer বানানো

Gate-8 intentionally করে না:

ACL permission evaluation
Menu visibility
Business logic execution
RLS enforcement
Session lifecycle authority

Gate-8 purely একটি

NAVIGATION AUTHORITY GATE
2️⃣ Navigation Authority Model (LOCKED)

Gate-8 এ final architecture define হয়েছে:

Screen Stack Engine
↓
Single Navigation Authority

ERP navigation flow:

User Intent
↓
Stack Engine
↓
Router Render

Router কখনো navigation authority নয়।

Absolute Navigation Rule

All navigation MUST originate from:

pushScreen()
replaceScreen()
popScreen()
resetStack()

Declared in:

File-ID: 8.2
frontend/src/navigation/screenStackEngine.js
Authority Revoked From

The following sources have zero navigation authority:

URL
Browser history
Router navigation
Screen components
Keyboard shortcuts

These can only produce signals.

3️⃣ Navigation Authority Lock
ID-8.0 — ✅ DONE

Audit confirmed:

Router does not control navigation
Browser back intercepted
Keyboard produces intent only
Stack drives navigation state

Files involved:

screenStackEngine.js
backGuardEngine.js
keyboardIntentEngine.js
keyboardIntentMap.js

Navigation authority permanently locked to:

Screen Stack Engine
4️⃣ Screen Truth & Safety
Screen Registry
ID-8.1 / 8.1A

Files:

frontend/src/navigation/screenRegistry.js
frontend/src/navigation/screenRules.js

Purpose:

Define canonical list of valid ERP screens.

Each screen must declare:

screen_code
route
type
keepAlive policy
universe

Example:

DASHBOARD_HOME → /dashboard
SA_HOME → /sa/home
GA_HOME → /ga/home
Registry Safety Rules

Implemented in:

screenRules.js

Validation includes:

screen_code presence
route presence
unique routes
type discipline
keepAlive discipline

Examples blocked:

duplicate routes
MODAL keepAlive true
DRAWER keepAlive true
missing screen_code
Status
Structure → LOCKED
Runtime mutation → NOT allowed

Registry behaviour is deterministic.

ID-8.1 → 8.1A
Status: ✅ DONE
5️⃣ Screen Stack Engine
ID-8.2 / 8.2A

Files:

screenStackEngine.js
screenStackInvariant.js

Defines the navigation execution model.

Stack Behaviour

The system maintains:

exactly ONE navigation stack

Example:

[DASHBOARD → PROJECT_LIST → PROJECT_DETAIL]

Navigation operations:

pushScreen
replaceScreen
popScreen
resetStack
Root Protection

Implemented rules:

Root screen cannot be popped
Navigation must initialize once
Stack cannot become empty
Stack Invariant Enforcement

File:

screenStackInvariant.js

Guarantees:

stack is array
stack never empty
single active stack
Restore Safety Fix (Gate-8 Correction)

During audit a risk was identified:

replaceStack() accepted arbitrary stack

Fix implemented:

registry validation before restore

Example check:

SCREEN_REGISTRY contains screen_code
route matches registry

This prevents corrupted session restore.

Status
ID-8.2 → 8.2A
Status: ✅ DONE
6️⃣ Browser Back Governance
ID-8.3 / 8.3A

Files:

backGuardEngine.js
backValidation.js

Back navigation model:

Browser Back
↓
BackGuard
↓
Stack pop
↓
Router render

Browser history cannot directly change navigation.

BackGuard Fix (Gate-8 Correction)

Audit discovered potential URL / stack desynchronisation risk.

Fix applied:

active screen derived from stack
URL rewritten from stack

Browser history no longer trusted.

Status
ID-8.3 → 8.3A
Status: ✅ DONE

ACL integration intentionally deferred to Gate-10.

7️⃣ Keyboard Governance
ID-8.4 / 8.4A

Files:

keyboardIntentEngine.js
keyboardIntentMap.js

Keyboard model:

Keyboard → Intent
Intent → Engine
Engine → Stack action

Example:

Escape → INTENT_BACK

Unknown shortcuts ignored.

Cleanup (Gate-8 Correction)

Audit found unused variables:

_shift
_alt

These were removed / disabled.

This ensures:

deterministic keyboard behaviour
no hidden shortcuts
Status
ID-8.4 → 8.4A
Status: 🟡 PARTIAL

Reason:

ACL enforcement deferred

Completes in:

Gate-10
8️⃣ Keyboard ACL Binding
ID-8.5 / 8.5A

File:

keyboardAclBridge.js

Defines mapping:

INTENT → ACL resource/action

Example:

INTENT_BACK → NAVIGATION/BACK

Gate-8 behaviour:

ACL NOT executed

Gate-10 will introduce:

real ACL evaluation
9️⃣ Navigation State Persistence
ID-8.6

File:

navigationPersistence.js

Purpose:

preserve navigation state during refresh
Persistence Behaviour

System stores:

screen stack snapshot

in:

sessionStorage
Security Fix (Gate-8 Correction)

Audit found restore risk.

Fix implemented:

validate snapshot against SCREEN_REGISTRY

Restore allowed only if:

screen_code exists
route matches registry
stack not empty

Corrupted storage ignored.

Logout Reset

Implemented:

clearNavigationStack()

Behaviour:

remove storage
reset memory stack
Status
ID-8.6
Status: ✅ DONE
🔟 Navigation Observability
ID-8.7

File:

navigationEventLogger.js

Purpose:

record navigation events

Example logs:

PUSH
POP
REPLACE
INTENT_BACK

Important constraint:

logging must never affect navigation behaviour

Implementation:

console.info only

No side effects.

Status
ID-8.7
Status: ✅ DONE
1️⃣1️⃣ Router Mapping Verification

Audit verified alignment between:

SCREEN_REGISTRY
AppRouter routes
Menu snapshot routes

Routes confirmed identical:

/dashboard
/sa/home
/ga/home

Router does not introduce new screens.

Status:

Verified
1️⃣2️⃣ What Gate-8 Explicitly Does NOT Handle

Gate-8 intentionally avoids:

ACL permission evaluation
Menu visibility
Session lifecycle authority
Business logic execution
RLS enforcement
Component rendering

These belong to future gates.

1️⃣3️⃣ HALF-DONE Items
ID	Reason	Completes In
8.4 → 8.5A	Keyboard ACL execution	Gate-10
Router-Stack lifecycle wiring	Router restore sync	Gate-9
Session lifecycle triggers	Logout/session expiry binding	Gate-9

All HALF-DONE items are:

explicitly documented
completion gate declared
not silently assumed complete
1️⃣4️⃣ Navigation Invariants (NON-NEGOTIABLE)

The following invariants are permanently locked:

Navigation ≠ Permission
Intent ≠ Authority
URL ≠ Navigation
Keyboard ≠ Action

And:

Screen Stack = Single Source of Truth

Environment parity rule:

Local behaviour == Production behaviour

Violation of these rules invalidates Gate-8.

🔒 Final Freeze Statement

Gate-8 — Navigation Authority & Screen Stack Gate
is hereby declared FROZEN.

This means:

Navigation authority rules are final
Screen Stack Engine is the single navigation source
Router / URL / Keyboard authority permanently revoked

No future code may reinterpret navigation behaviour defined here.

Future gates must consume these rules, not modify them.

📊 Gate-8 Status Summary
ID	Status
8.0	✅ DONE
8.1 → 8.2A	✅ DONE
8.3 → 8.3A	✅ DONE
8.4 → 8.5A	🟡 PARTIAL
8.6	✅ DONE
8.7	✅ DONE
8.8	🔒 FROZEN
🔐 Authoritative Closure

Gate-8 successfully establishes:

Navigation Authority
Screen Stack Safety
Back Navigation Governance
Keyboard Intent Isolation
Navigation Persistence Safety

The ERP now has a deterministic navigation model.

All future navigation behaviour must operate within the rules frozen here.