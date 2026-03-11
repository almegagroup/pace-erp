🔒 PACE-ERP — Gate-9 Freeze Declaration

File-ID: 9.18
File-Path: docs/GATE_9_FREEZE.md
Gate: 9
Phase: 9
Domain: ADMIN GOVERNANCE / MASTER DATA / CONTROL-PLANE
Status: 🔒 FROZEN
Authority: Backend
Scope: Admin Control Plane & Governance Layer
Baseline: Post Gate-8 Navigation Seal + Gate-7.5 Workflow Engine Completion
Date: (fill on commit)

1️⃣ Purpose of Gate-9

Gate-9 exists to answer one operational question:

“ERP system কে configure করবে এবং কীভাবে system governance maintain হবে?”

Gate-9 provides the administrative control plane.

Gate-9:

❌ Business transactions execute করে না
❌ Permission evaluate করে না
❌ Navigation control করে না

Gate-9 শুধুমাত্র:

• System configuration control করে
• Master data governance দেয়
• Admin operations traceable করে
• ERP operational observability দেয়

Gate-9 is a CONTROL-PLANE GOVERNANCE GATE.

2️⃣ Admin Universe Authority Model (LOCKED)

Admin universe হলো ERP system-এর governance layer।

Admin users control:

• projects
• departments
• users
• menus
• ACL configuration
• modules
• approval routing

Frontend এর কোনো authority নেই।

Rules:

Admin actions must go through:

dispatchAdminRoutes()
↓
handler execution
↓
audit logging

Direct DB manipulation forbidden.

🔒 Admin Control Plane Authority: LOCKED

3️⃣ Master Data Governance (ID-9 → 9.5)

Gate-9 provides ERP master data administration.

3.1 Global Registry (ID-9 / 9.1)

System master entities declared.

Examples:

• projects
• modules
• menus
• roles

ERP globally knows:

• what resources exist
• what modules exist
• what projects exist

🟢 Structural layer COMPLETE
🔒 Governance layer SEALED

3.2 Master Lifecycle Control (ID-9.2)

Admin can manage lifecycle:

• create entity
• disable entity
• archive entity

Example:

Project lifecycle:

ACTIVE
INACTIVE
ARCHIVED

Lifecycle change never deletes data.

🟢 Lifecycle governance COMPLETE
🔒 Lifecycle discipline LOCKED

3.3 Company Binding (ID-9.3)

Global entities bind to companies.

Example:

Project → Company A
Project → Company B

Binding table:

erp_map.company_projects

This enables multi-tenant ERP distribution.

🟢 Mapping architecture COMPLETE
🔒 Isolation preserved

4️⃣ Operational Master Entities
4.1 Project Master (ID-9.4)

Table:

erp_master.projects

Admin can:

• create project
• manage lifecycle
• map project to companies

Operational hierarchy:

Company
  ↓
Project
  ↓
Department

Project defines operational scope.

🔒 ID-9.4 SEALED

4.2 Project Lifecycle Rules (ID-9.4A)

Project states:

ACTIVE
INACTIVE
ARCHIVED

Rules:

Inactive project blocks new transactions.

Existing data preserved.

🔒 ID-9.4A SEALED

4.3 Department Master (ID-9.5)

Table:

erp_master.departments

Represents HR structure.

Examples:

Finance
HR
Compliance
Operations

Department belongs to company.

🔒 ID-9.5 SEALED

5️⃣ User Governance (ID-9.6 → 9.6A)

Admin panel controls ERP user lifecycle.

Admin actions:

• activate user
• suspend user
• assign role

Tables:

erp_core.users
erp_acl.user_roles

Critical rule:

User disabled → sessions revoked.

adminForceRevokeSessions()

🔒 ID-9.6 SEALED

5.1 Self-Lockout Protection (ID-9.6A)

Admin cannot:

• remove own admin role
• disable self

Guard:

assertSelfLockoutSafe()

Prevents admin universe collapse.

🔒 ID-9.6A SEALED

6️⃣ ACL Governance Surface (ID-9.7 → 9.11)

Gate-9 declares ACL governance tools.

These configure permissions but do not evaluate them.

ACL runtime evaluation belongs to Gate-10.

6.1 Role Permission Matrix (ID-9.7)

Table:

acl.role_menu_permissions

Defines:

role → menu → action

Example:

FINANCE_MANAGER → INVOICE → EDIT

🔒 Governance declared
Execution deferred to Gate-10

6.2 Capability Packs (ID-9.7A)

Permission bundles.

Example:

FINANCE_MANAGER
HR_ADMIN
AUDIT_VIEWER

Capability pack → permission set.

Simplifies role governance.

Execution occurs in ACL resolver.

6.3 User Overrides (ID-9.8)

Per-user exception layer.

Example:

Role denies export
Specific user allowed export

Tables:

acl.user_overrides
acl.user_override_audit

Precedence:

User Override
   >
Role Permission

Runtime resolution:

Gate-10 ACL engine.

6.4 Company Module Map (ID-9.9)

Module enablement per company.

Example:

Company A → Finance enabled
Company B → Finance disabled

Tables:

acl.company_module_map
acl.company_module_deny_rules

Module disabled → hard deny.

6.5 Approval Routing Admin (ID-9.10)

Admin configures workflow routing.

Example:

Purchase Order
Stage-1 → Manager
Stage-2 → Director

Table:

acl.approver_map

Workflow execution handled in:

Gate-7.5 Workflow Engine.

6.6 ACL Versioning (ID-9.11)

Allows permission rollback.

Table:

acl.acl_versions

Constraint:

one active version per company

Snapshot build:

generate_acl_snapshot()

Admin handlers:

activate_acl_version.handler.ts
rollback_acl_version.handler.ts

Execution:

Gate-10 runtime engine.

7️⃣ Admin Menu Governance (ID-9.12)

Admin controls ERP UI menu registry.

Tables:

erp_menu.menu_master
erp_menu.menu_tree

Admin operations:

• create menu
• update menu
• reorder hierarchy
• enable / disable menu

Menu changes trigger:

menu_snapshot rebuild

Menu visibility depends on:

acl.precomputed_acl_view

🔒 ID-9.12 SEALED

8️⃣ Audit & Governance Observability
8.1 Audit Log Viewer (ID-9.13)

Admin can inspect system actions.

Table:

erp_audit.admin_action_audit

Route:

GET /api/admin/audit

Fields visible:

• action_code
• resource_type
• admin_user_id
• performed_at
• status

Append-only.

🔒 ID-9.13 SEALED

8.2 Admin Action Audit Trail (ID-9.14)

All admin actions logged.

Logging occurs inside:

dispatchAdminRoutes()

Captured metadata:

• routeKey
• request_id
• admin_user_id
• status
• snapshot

Table protected via:

RLS ENABLE
RLS FORCE

🔒 ID-9.14 SEALED

9️⃣ Session Governance (ID-9.15)

Admin can monitor active sessions.

Table:

erp_core.sessions

Admin can view:

• user_id
• last_seen_at
• expires_at

Future capability:

• revoke session
• force logout

Session authority remains backend.

🔒 ID-9.15 SEALED

🔟 Operational Diagnostics (ID-9.16)

Diagnostics panel shows system health.

Data sources:

acl.acl_versions
acl.precomputed_acl_view
erp_menu.menu_snapshot
erp_core.sessions

Admin sees:

• active ACL version
• snapshot freshness
• session count
• system metadata

Diagnostics are:

read-only
observability only.

🔒 ID-9.16 SEALED

1️⃣1️⃣ Admin Route Audit Integration (ID-9.17)

Admin route execution automatically audited.

Execution flow:

admin request
↓
handler execution
↓
response generated
↓
logAdminAction()
↓
audit record stored

Guarantees:

• no silent admin action
• full control-plane traceability

🔒 ID-9.17 SEALED

1️⃣2️⃣ What Gate-9 DOES NOT Handle

Gate-9 intentionally does not implement:

❌ ACL permission resolution
❌ workflow execution
❌ menu visibility computation
❌ business transaction logic
❌ navigation control

These belong to other gates.

1️⃣3️⃣ Deferred Items
Responsibility	Completes In
ACL runtime resolution	Gate-10
Snapshot optimization	Gate-10
Business module execution	Gate-11+
Advanced audit analytics	Observability Gate

Deferred ≠ missing.

Deferred = controlled architecture roadmap.

1️⃣4️⃣ Invariants (NON-NEGOTIABLE)

Admin actions must be audited

Admin routes cannot bypass dispatch layer

Master entities cannot be mutated outside handlers

ACL governance ≠ ACL execution

Control plane ≠ business execution

Violation invalidates Gate-9.

🔒 Final Freeze Statement

Gate-9 — Admin Control Plane & Governance Gate
is hereby declared FROZEN.

Meaning:

Admin governance architecture is final
Master data admin layer is stable
Audit trail is mandatory

Any future change requires new gate declaration.

📊 Gate-9 Status Summary
ID	Status
9 → 9.6A	✅ DONE
9.7 → 9.11	🔒 GOVERNANCE DECLARED
9.12 → 9.17	✅ DONE
9.18	🔒 FROZEN
🔐 Authoritative Closure

Gate-9 is complete at:

• Governance layer
• Admin control plane
• Master data management
• Audit infrastructure
• Observability layer

Next gate:

➡ Gate-10 — ACL Runtime Execution Engine