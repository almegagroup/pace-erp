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

HR mane Primary company r work company seta decided agei.
ebar asi approval system e
HR r work e approver same o hote pare aladao hote pare. Max 3 jon, min 2 jon approver hobe,
Approver er sequence hobe Lower role approver, higher role approver r higher er uporer role er approver. Higher approver lower approver er decision change korte parbe.
Approval type jeta hobe example diye bojhachhi
1. Anyone - Dhoro, keu leave request korlo, ebar jotojon approver ache oi module er tader sobar kache request jabe, kintu je kono ekjon decision diye diile baki ar karo decision er dorkar nei, bakider kach theke request r thakbena, kintu report e approver ra dekhte pabe ke ki decision nilo.
2. Sequential - Same jinis e first e lower role approver er kache request jabe, baki der kache jabena, se decision nilo, then sei request jabe tar porer immediate higher role approver je ache, se dicision nilo, tar por jabe last je approver ache, se decision nilo. eksathe sobar kache jabena. ebar proti higher role approver tar lower approver er decision change korte pare. last decision will be the final decision.
3. Must all - Tin joner kachei jabe eksathe , tin jon kei tader decision janate hobe. Tin joner decision na pele request complete hobena, dekhte gele 2 r 3 fundamentally aki, kintu method alada.

ebar asi second plan, amar kache multiple module thakbe, kintu sob module e approval system er dorkar nei. seta SA deide korte parbe, kon kon kaj e approval system lagbe, kon kon guloy lagbena.

last je ta plan, ei approver jakhon set korbo, takhon role alada alada hote hobe, aki role er dujon approver thakte parbena, and bivinno module er jonno amra differ approver set korte parbo, mane specific user ke approver banate parbo, ebar seta jodi compatibility pack  e incorporate kora jay setao kora jete pare, je simple, stable, secure, fast r sclable hobe seta korte hobe.

Diroctor role er kajer kono approver thakbena, director er kaj ke keu approve korbena, r director will be higher approver.


## 13. Project, Module, Page & Company Assignment Clarification

Locked interpretation:

- Project is reusable and may be assigned to multiple companies
- Module belongs under exactly one Project
- Page or Resource belongs under exactly one Module
- Company-specific does NOT mean duplicate module creation
- Company-specific means the same module code may be assigned to different companies

Correct execution model:

1. Create Project
2. Create Module under that Project
3. Bind pages / resources / governed actions under that Module
4. Assign the same Module to selected companies

Examples:

- Supply Chain Management = Project
- Supply Chain = Module
- Planning / Create PO / Manage PO = resources under Supply Chain
- ASCL may receive Supply Chain
- MCPL may receive the same Supply Chain

Important rule:

The system must never require:

- one module copy for ASCL
- one module copy for MCPL

That would be structurally wrong.

The correct rule is:

- one module truth
- many company assignments

## 14. Approval Target Unit Clarification

Locked interpretation:

- approval requirement must be tied to exact work scope
- exact work scope means page / resource / action truth
- module is a grouping layer, not automatic proof that all work inside it needs approval

Meaning:

The same Module may contain:

- approval-required work
- non-approval work

Examples:

- Leave Request may require approval
- Leave Approval page may exist under the same HR module
- Process Order Create may not require approval
- both may still belong under their respective Modules

Therefore:

- approval must not be treated as blanket module-wide truth by default
- SA must be able to decide which exact work needs approval

## 15. Approver Scope Visibility Clarification

Locked interpretation:

- being an approver does NOT create universal approval visibility
- approver visibility must be limited to exact assigned approval scope
- exact assigned scope may be resource-based, action-based, company-based, or approved combined scope

Examples:

- Bikash may be approver for one Maintenance work surface only
- Bikash may be approver for one company or multiple companies
- Bikash must never see every approval in the system only because he is an approver somewhere

Therefore:

- approver authority must be narrow and explicit
- inbox visibility must follow approver assignment exactly
- role approver and specific-user approver both remain valid,
  but neither grants blanket approval access

## 16. Runtime Scope Clarification

This section formally clarifies the runtime ACL scope model for a scalable,
sellable ERP product.

Locked interpretation:

- `Parent Company` = HR truth
- `Work Company` = selected operational company
- `Department` = HR / organizational label
- `Work Context` = selected runtime functional responsibility
- `Role` = authority ladder / rank class
- `Capability Pack` = reusable permission bundle
- `Menu` = projection only

This section supersedes any loose interpretation where `Department`
alone acts as the full ACL brain.

## 17. Company Definition

Locked interpretation:

- `Company` is the legal / operating business entity
- one user may have exactly one Parent Company
- one user may have one or multiple Work Companies
- all runtime operational access must be evaluated inside one selected Work Company

Therefore:

- multi-company behavior is valid
- cross-company access must always be explicit
- menu / action truth must be company-contextual at runtime

## 18. Project Definition

Locked interpretation:

- `Project` is the higher business container
- `Project` is not duplicated per company by default
- the same Project may be assigned to multiple companies
- modules live under Project

Therefore:

- Project is reusable
- company-specific rollout happens by assignment, not by cloning Project truth

## 19. Module Definition

Locked interpretation:

- `Module` is the functional business unit
- examples: HR, Stores, Production, Payroll, Finance
- `Module` is global truth
- company-specific behavior comes from company-module assignment,
  not from duplicate Module creation

Therefore:

- one Module truth may be enabled in many companies
- module enablement is company-scoped
- module absence must behave as deny

## 20. Page Definition

Locked interpretation:

- `Page` is the actual governed workspace / screen
- coder declares page existence
- SA decides whether and where that page is published into the menu tree
- page does not define its own permission

Therefore:

- page existence is coder-owned
- page visibility is ACL + menu projection owned
- page route typing by SA is not acceptable as primary governance flow

## 21. Role Definition

Locked interpretation:

- `Role` defines authority class and rank
- role alone is not the final access answer
- the same role may behave differently in different companies
- role should normally inherit reusable capability packs

Therefore:

- role is stable identity
- final permission remains contextual

## 22. Department Definition

Locked interpretation:

- `Department` is primarily HR / organizational identity
- examples: Production, HR, Stores, Finance
- Department may inform defaults or reporting,
  but must not be overloaded as the only runtime ACL selector

Therefore:

- changing Department may influence menu only when Department is part of the selected Work Context
- Department alone must not be forced to carry all functional responsibility logic

## 23. Work Context Definition

Locked interpretation:

- `Work Context` is the runtime functional responsibility chosen inside a selected Work Company
- Work Context is the missing runtime unit needed to handle real ERP life safely
- examples:
  - Production Operator
  - HR Operations
  - Plant Head
  - Store Controller
  - Audit Reviewer

Work Context may be derived from:

- Department
- company-specific responsibility assignment
- capability pack binding
- approver scope

But Work Context itself is the runtime selector.

Therefore:

- one user may hold different Work Contexts in different companies
- one user may change menu by changing Work Company or Work Context
- menu recompute must be automatic after context change

## 24. Final Access Formula

Locked interpretation:

Final runtime access must be derived from:

`User + Selected Work Company + Selected Work Context + Role + Enabled Modules + Overrides`

Where:

- Parent Company still governs HR truth
- Work Company governs operational company boundary
- Work Context governs functional runtime responsibility
- Role governs authority ladder
- Enabled Modules govern company rollout
- Overrides remain explicit exception layer only

## 25. Automatic Menu Change Rule

Locked interpretation:

- if user changes selected Work Company,
  menu must recompute automatically
- if user changes selected Work Context,
  menu must recompute automatically
- SA must not manually re-stitch the same user's menu every time the user's daily context changes

Examples:

- Ankan
  - Company A + Production Context -> Production menu
  - Company A + HR Context -> HR menu
  - Company B + Store Context -> Store menu

- Pradip
  - ASCL + Plant Head Context -> Plant Head menu
  - MCPL + Production Context -> Production governance menu

Therefore:

- runtime context switching is system behavior
- manual menu flipping by SA is not valid steady-state ERP behavior

## 26. Exception Rule

Locked interpretation:

- default access must be system-derived
- per-user manual permission stitching must not be the primary model
- `user_overrides` remain allowed as exception layer
- exception is valid only for targeted special cases,
  not as the day-to-day replacement for capability design

Therefore:

- `default pack + a few excludes/additions` is acceptable
- `most users require many custom edits` means the core model is wrong

## 27. Scalability Rule

Locked interpretation:

For a globally sellable ERP:

- Department must not be the overloaded central ACL brain
- Work Context + Capability Pack + Company Scope must drive access
- Menu must remain projection only
- SA must govern through UI
- hidden SQL / code / hardcoded navigation must not be required for business growth

## 28. Implementation Consequence

This document locks the product direction as follows:

- clarify truth first
- build Work Context model
- align ACL runtime to capability-driven derivation
- align menu generation to runtime context
- keep override as exception only

If any current implementation behaves otherwise,
the implementation must be realigned to this section,
not the other way around.
