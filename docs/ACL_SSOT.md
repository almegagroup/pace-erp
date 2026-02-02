SRIYA ERP – Unified ACL Architecture (FINAL LOCKED DESIGN)
IMPORTANT NOTE
This version includes ALL 7 PROBLEMS + ALL 7 SOLUTIONS → nothing missing, nothing skipped.
(Problem 1 to Problem 7 → each issue AND each solution included.)
________________________________________
1. ROLE SYSTEM (FINALIZED)
•	SA (999) – ERP GOD, unrestricted, cannot be denied.
•	GA (888) – Group GOD, multi-company within group.
•	DIRECTOR (100) – Multi-company authority.
•	L3_MANAGER (90) – Multi-company.
•	L2_AUDITOR (80) – Highest auditor.
•	L1_AUDITOR (70) – Auditor.
•	L2_MANAGER (60) – Single-company manager.
•	L1_MANAGER (50) – Single-company.
•	L4_USER (40) – Senior user.
•	L3_USER (30) – Skilled user.
•	L2_USER (20) – Basic user.
•	L1_USER (10) – Entry-level.
Approver Cone (Locked)
•	Max 3 approvers.
•	Chain: L1_USER → L1/L2 Manager → L3 → Director → GA → SA.
•	Auditors cannot approve.
Delete Restriction
•	Delete only via GA (proposal) + SA (final approve).
________________________________________
2. MENU SYSTEM (DYNAMIC, NON-HARDCODED)
•	SA builds full Menu → Submenu → Sub-submenu.
•	Stored in: menu_master, menu_tree.
•	Dynamic dashboard; no hardcoded sidebar.
Permission Sources
1.	Role rules
2.	Company mapping rules
3.	Department rules
4.	User overrides
5.	Approver mapping
VWED Model
View, Write, Edit, Delete, Approve (+ custom actions).
Rendering Flow
1.	Load menu tree (cached)
2.	Load role/company/dept permissions
3.	Load user overrides
4.	Load approver rules
5.	Apply Final Precedence Ladder
6.	Render final allowed tree
________________________________________
3. PERMISSION ENGINE — FINAL PRECEDENCE LADDER
Locked precedence (highest → lowest): 1. Hard Deny (locked/suspended) 2. User DENY (explicit) 3. User ALLOW (explicit) 4. Role + Company + Dept rules 5. Default Deny
This is the fundamental brain of ACL.
________________________________________
4. ALL 7 PROBLEMS + ALL 7 SOLUTIONS (FULL, NOTHING MISSED)
Problem 1 — Permission Precedence Missing
Issue
Role allow vs user deny conflict. ### Final Locked Solution - Final Precedence Ladder (Hard Deny → User Deny → User Allow → Role/Company → Default Deny) - Completely removes ambiguity.
________________________________________
Problem 2 — Role × Menu × Action Explosion
Issue
12 roles × 100 menus × 7 actions = 8400 permission cells → impossible manually.
Final Locked Solution
•	Capability Packs (Manager, Auditor, Finance, Director, Stores, QA, etc.)
•	Role Inheritance (higher role auto gets lower role permissions)
•	Selective Inheritance Break (role-level deny to override inherited allow)
•	Auto Templates for new menus
This reduces 80–90% manual configuration.
________________________________________
Problem 3 — ACL Evaluation Too Slow
Issue
Every click → multiple joins + recalculation → slow dashboard, high DB cost.
Final Locked Solution
•	60s TTL Cache (user’s final ACL snapshot)
•	Precomputed ACL View (precomputed_acl_view) → 1 lookup per request
•	Menu Tree Caching → no repeated rebuild
Impact
•	90–95% DB read reduction
•	Faster UI, cheaper infra, more stability
________________________________________
Problem 4 — No Versioning + No Rollback
Issue
One wrong ACL update could break entire system. No way to restore.
Final Locked Solution
•	acl_versions table (snapshot of every change)
•	Diff/Compare viewer
•	1-Click Rollback to any older version
Ensures zero-risk ACL editing.
________________________________________
Problem 5 — Self-Lockout Risk (SA/GA could lock themselves out)
Issue
GA/SA accidentally removing admin menus → system unrecoverable.
Final Locked Solution
•	SA always gets /* (cannot be removed or overridden)
•	GA Essential Admin Pack always ON
•	Protected System Menus (/admin/acl, /admin/menu-builder, /admin/rollback, etc.)
System becomes self-protected.
________________________________________
Problem 6 — No Simulation / Preview Mode
Issue
SA/GA could not see what a user actually sees after ACL changes.
Final Locked Solution
•	Preview-as-User mode
•	See EXACT dashboard/actions of any user before saving ACL
Removes blind changes.
________________________________________
Problem 7 — No Capability Packs
Issue
ACL setup extremely heavy, repetitive, error-prone.
Final Locked Solution
•	Standard Capability Packs (base templates)
•	Auto Template Apply for new menus
•	Role Inheritance + user overrides for fine control
Now ACL is scalable & fast.
________________________________________
5. MULTI-COMPANY & TARGETED APPROVER LOGIC
Company-Specific Permissions
Same role can behave differently per company.
Examples: - ASCL → L3_MANAGER = Process PO → View only - MCPL → L3_MANAGER = Bulk PO → View + Approve
company_module_map (Locked)
Defines which module works for which company.
Examples: - Process PO → ASCL, MCPL, ACPL - Dolomite Process PO → Only MCPL
Targeted Approvers (Locked)
Approver rights are workflow-specific & user-specific.
Examples: - Engineering PO → Approver: Bikash only - Production PO → Approver: Ramen only
Role Approve ≠ Approver. Final apply depends on approver_map.
________________________________________
6. BACKEND vs UI OWNERSHIP MATRIX
Backend Only (SA/GA cannot modify)
•	Permission Ladder
•	SA/GA Protection Rules
•	Default Deny
•	TTL Cache logic
•	Precomputed ACL View structure + refresh
•	Route/middleware logic
•	System bootstrap logic
Admin UI (SA/GA controlled)
•	Menu tree builder
•	Role-menu VWED assignment
•	Capability pack assignment
•	User overrides
•	Approver mapping
•	Company-module mapping
•	User-company-department mapping
•	Version history + rollback
•	Preview-as-user
Hybrid
•	acl_versions structure backend + actions UI
•	Precompute refresh triggers backend + data UI
________________________________________
7. COST • SPEED • RELIABILITY • SECURITY SUMMARY
Cost Effective
•	90–95% DB read reduction
•	Smaller servers needed
•	Versioning prevents expensive downtime
Fast
•	Cached ACL
•	Precomputed lookups
•	Lightweight menu logic
Reliable
•	Versioning
•	Rollback
•	Preview
•	Self-protection
Secure
•	Hard Deny highest priority
•	Default Deny model
•	SA immune from misconfig
•	Auditors restricted
________________________________________
8. FUNDAMENTAL COMPLETENESS
All core ACL fundamentals are COMPLETE and LOCKED: - Role architecture - Menu architecture - Precedence engine - Multi-company logic - Approver system - Capability packs - Versioning + rollback - Self-protection - Simulation mode - Cost optimization foundation
Only implementation remains.
________________________________________
9. IMPLEMENTATION ROADMAP
1.	Build all ACL tables
2.	Implement resolver + precomputed view
3.	Build Admin Panel basics
4.	Seed SA/GA
5.	Test with preview-as-user
6.	Start user onboarding
7.	Add modules one-by-one into menu system
________________________________________

# 🔒 ACL SSOT — Parent Company, Work Company & Approval Foundations

**Project:** PACE‑ERP / SRIYA ERP
**Gate:** Gate‑6 (ACL & Business Truth)
**Status:** AUTHORITATIVE · LOCKED · SINGLE SOURCE OF TRUTH

---

## 1. Purpose of This Document

This document formally defines **two foundational ACL concepts** that were clarified and locked through architectural discussion:

1. **Parent Company vs Work Company separation**
2. **Approval requirement & approval method model**

These rules are **mandatory**, **backend‑authoritative**, and **non‑negotiable**.
Any ACL, workflow, menu, or UI behaviour must **consume** these rules and must **not reinterpret** them.

---

## 2. Parent Company — HR Authority (LOCKED)

### 2.1 Definition

**Parent Company** represents the **employment & HR source of truth** for a user.

Except for the `DIRECTOR` role:

* Every ACL user **must have exactly one Parent Company**
* Parent Company is **mandatory**

### 2.2 What Parent Company Owns

All HR‑related data and authority are **strictly bound** to the Parent Company:

* Leave
* Salary / CTC
* Loan / Advance
* Outside travel eligibility
* Employee profile & identity

  * Employee ID
  * PF
  * ESIC
  * HR master data

> Parent Company answers the question:
> **“এই মানুষটা আসলে কোন company‑র employee?”**

### 2.3 Invariants

* Parent Company ≠ operational scope
* HR modules **must never** depend on Work Company
* Parent Company may be equal to a Work Company, but this is **not required**

---

## 3. Work Company — Operational Authority (LOCKED)

### 3.1 Definition

**Work Company** represents where a user is authorized to **perform operational work**.

A user:

* May have **one or multiple Work Companies**
* Performs business actions only within assigned Work Companies

### 3.2 What Work Company Owns

All non‑HR business modules are **Work Company scoped**, including (but not limited to):

* Purchase
* Production
* Stores
* Supply / Dispatch
* Finance (operational)
* Plant‑level approvals

> Work Company answers the question:
> **“এই মানুষটা কোন কোন company‑র কাজ সামলাতে পারবে?”**

### 3.3 Invariants

* A user **cannot** act on a company outside their Work Company scope

* All Work‑context actions must validate:

  `target_company ∈ user.work_companies`

* Violation results in **hard DENY** at ACL layer

---

## 4. Relationship Between Parent & Work Company

### 4.1 Allowed Combinations

| Scenario                                     | Valid |
| -------------------------------------------- | ----- |
| Parent Company = Work Company                | ✅ Yes |
| Parent Company ≠ Work Company                | ✅ Yes |
| Same Parent Company, multiple Work Companies | ✅ Yes |

### 4.2 Explicit Rule

* **HR modules** → Parent Company bound
* **All other modules** → Work Company bound

This separation is **fundamental** and must not be merged or blurred.

---

## 5. Approval — High‑Level Authority Model (LOCKED)

### 5.1 Approval Is Selective

* **Not all actions require approval**
* Only actions explicitly marked as requiring approval will invoke approval logic

Approval is:

* ❌ NOT module‑based
* ❌ NOT entity‑based
* ✅ **Action‑based**

---

## 6. Approval Context Separation

### 6.1 HR Approvals

* Bound to **Parent Company**
* Examples:

  * Leave approval
  * Salary / HR changes

### 6.2 Work Approvals

* Bound to **Work Company**
* Examples:

  * Purchase Order creation
  * Operational approvals

> HR approvers and Work approvers **may be same or different**.

No forced coupling exists.

---

## 7. Approver Count Rules (HARD LIMIT)

* **Minimum approvers:** 2
* **Maximum approvers:** 3

| Approver Count | Valid |
| -------------- | ----- |
| 1              | ❌ No  |
| 2              | ✅ Yes |
| 3              | ✅ Yes |
| 4+             | ❌ No  |

---

## 8. Approval Methods (ONLY 3 — LOCKED)

Exactly **three approval methods** exist. No others are permitted.

### 8.1 Method‑1: Any One Approver

* Any single approver may approve
* First approval completes the request
* Any rejection → request rejected

---

### 8.2 Method‑2: Sequential (Hierarchy‑wise)

* Approvers act **one‑by‑one in hierarchy order**
* Next approver activates only after previous approval

**Rejection Rule (IMPORTANT):**

* **Any approver rejecting at any level → request rejected immediately**

---

### 8.3 Method‑3: All Approvers Must Approve

* All assigned approvers must approve
* Single rejection → request rejected

---

## 9. Action‑Level Approval Requirement

Approval requirement is determined **per action**.

Examples:

| Action                          | Approval Required |
| ------------------------------- | ----------------- |
| Purchase Order Create           | ✅ Yes             |
| Purchase Order Edit             | ❌ No              |
| Production Process Order Create | ❌ No              |

> Entity or module identity alone **never** implies approval.

---

## 10. Non‑Goals of This Document

This document **does NOT define**:

* UI behaviour
* Approval UI flow
* Notifications
* SLA / timeout
* Retry / resubmission mechanics

These belong to future **workflow & UI gates**.




---

## 11. Final Lock Statement

* Parent Company vs Work Company separation is **final**
* Approval requirement & approval methods are **final**
* These rules are part of **Gate‑6 ACL authority**
* Any future design **must comply** with this document

If any future discussion contradicts this document → **this document wins**.

## 12. Clarifications: 
DIRECTOR role MUST have exactly one Parent Company,
used only for HR & identity purposes.

Parent Company does NOT restrict Director’s work scope.

Any rejection marks the request as FINAL_REJECTED.
If resubmission is allowed, it must be a NEW request with a new ID.

For actions impacting both HR and Work scope:
Parent Company approval is mandatory and authoritative.
Work Company approval is optional and secondary.

---

**Declared as ACL SSOT**
**Gate:** 6
**Status:** 🔒 LOCKED

This version is COMPLETE and contains ALL 7 issues + ALL 7 solutions without missing anything.
