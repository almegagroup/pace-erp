# IDENTITY BINDING MAP

==========================================================
ROUTE REGISTRY
==========================================================

Route ID (Backend Identity):
Format: ${method}:${pathname}

Example:
GET:/api/purchase

Handler:
Defined centrally in runner.ts

Gate:
Gate-1 → Immutable pipeline enforcement

Invariant:
Route ID is the only identity passed to ACL layer.
No implicit frontend route identity used for authorization.
==========================================================
MENU MASTER
==========================================================

Menu Code:
Human-readable logical identifier (UI projection layer)

Parent Code:
Defines UI hierarchy only

Route Linked:
Frontend route path (may differ from backend route ID)

Invariant:
Menu existence does NOT imply permission.
Permission derived exclusively from ACL snapshot.

==========================================================
MENU ACTIONS
==========================================================

Action Code:
VIEW / WRITE / EDIT / DELETE / APPROVE / EXPORT

Menu Code:
Logical grouping identifier

Permission Key:
(resource_code + action_code)

Current Runtime State:
Action defaults to VIEW.
Granular action-level enforcement not fully activated.

==========================================================
SCREEN REGISTRY
==========================================================

Screen Key:
Frontend internal identity

Route:
Frontend path (e.g., /dashboard/purchase)

Menu Code:
Used for sidebar projection

Component:
React component binding

Invariant:
Screen registry holds zero security authority.
Authorization always backend-derived.

==========================================================
SNAPSHOT CONSUMPTION
==========================================================

ACL Key:
resource_code (Backend Route ID)

Menu Key:
menu_code (UI projection only)

Action Key:
action_code (defaults to VIEW at runtime)

Version Binding:
Runtime must select exactly one ACL version per company.
If:
- No version → DENY
- Multiple active versions → DENY

Snapshot row missing → DENY
decision != ALLOW → DENY
==========================================================
IDENTITY ALIGNMENT CHECK
==========================================================

Backend Route ID → ACL resource_code
(Deterministic mapping required)

Menu Code → UI projection only
(Not security authority)

Action Code → Snapshot action_code
(Currently defaults to VIEW)

Screen Key → Frontend navigation identity
(No authority impact)

Result:

Security Alignment: VERIFIED
Determinism: VERIFIED
Granular Identity Normalization: PARTIAL
Governance Drift Risk: LOW (centralized runner binding present)

