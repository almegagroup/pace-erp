SRIYA ERP – Unified ACL Architecture (FINAL LOCKED DESIGN)
IMPORTANT NOTE
This version includes ALL 7 PROBLEMS + ALL 7 SOLUTIONS → nothing missing, nothing skipped.
(Problem 1 to Problem 7 → each issue AND each solution included.)
________________________________________
1. ROLE SYSTEM (FINALIZED)
•	SA (999) – ERP GOD, unrestricted, cannot be denied.
•	GA (888) – Group GOD, multi-company within group.
•	DIRECTOR (100) – Multi-company authority.
•	L4_MANAGER (95) – Senior multi-company manager.
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
•	Chain: L1_USER → L1/L2 Manager → L3/L4 Manager → Director → GA → SA.
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
13 roles × 100 menus × 7 actions = 9100 permission cells → impossible manually.
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

---

## 29. Work Context Access Model — UNION MODEL (SUPERSEDES Sections 23, 25 — LOCKED 2026-08-05)

### 29.1 What changed and why

Sections 23 and 25 above locked a **switcher model**: one Work Context
selected at a time inside a Work Company, with menu recompute on switch
(the "Ankan — Production Context vs HR Context" example). The business
owner discarded this model some time ago in intent, but the runtime never
matched — the switcher UI, the single-`work_context_id` context resolution,
and the ACL enforcement check all still assumed exactly one active Work
Context per session.

This was found on 2026-08-05 via a real case: P0009 (Nilkamal), role
L2_MANAGER, holds two Work Contexts in CMP003 — QUALITY (secondary) and
PRODUCTION (primary). All QUALITY-department capabilities were correctly
granted to him in the ACL tables, but he could never see or use any of
them, because the runtime resolved and enforced against his primary
Work Context (PRODUCTION) only, on every request, with no path to reach
QUALITY's grants short of a context switch — and the switcher itself
filtered out `DEPT_`-prefixed Work Contexts (which is what every
department-derived Work Context in this system actually is), so there was
no way to switch at all. This is a general defect, not specific to P0009:
any user assigned to more than one Work Context in the same company has
been silently restricted to only their primary one since Work Contexts
were introduced.

### 29.2 New rule (LOCKED)

**A user's effective access within a Work Company is the UNION of every
Work Context assigned to them in that company** — not a single selected
one. There is no "active Work Context" to switch; whatever the user is
assigned, they see and can act on, simultaneously, all the time.

- If a resource:action is ALLOW under **any** of the user's assigned Work
  Contexts for the current Work Company, the action is ALLOWED.
- The menu is the union of every menu item visible under any of the
  user's assigned Work Contexts for the current Work Company.
- This does **not** change Work Company scope (Section 3) — a user still
  only acts inside their assigned Work Companies, selected explicitly
  (single-company auto-resolve, multi-company picker — Law 12, unchanged).
  Union applies strictly *within* one selected Work Company, across that
  company's multiple assigned Work Contexts.
- This does **not** change Parent Company / HR scope (Section 2) — unrelated axis.
- SA/GA/DIRECTOR bypass is unaffected (already full-access, unconditional).

### 29.3 Sections superseded

- **Section 23 ("Work Context Definition")** — the clause "Work Context
  itself is the runtime selector" and "one user may change menu by
  changing Work Company or Work Context" no longer apply to Work Context.
  Work Company selection remains a runtime selector (Section 3/17); Work
  Context no longer is.
- **Section 25 ("Automatic Menu Change Rule")** — the Work-Context-switch
  half is void (no such switch exists anymore). The Work-Company-switch
  half stays locked as-is.
- The `MenuShell.jsx` Work Context switcher UI (dropdown + Alt+W/F8) is
  dead code once this lands and should be removed, not left as an inert
  control that no longer does anything meaningful.

### 29.4 Technical scope (backend, three layers — DB layer needs no change)

`precomputed_acl_view` and `menu_snapshot` already store one row per
assigned Work Context — the data layer was never the problem. Only the
*read/resolution* layer needs to change:

1. **Context resolution** (`_shared/canonical_access.ts`'s
   `resolveDefaultWorkContextId`, `_pipeline/context.ts`) — resolve the
   user's **full set** of Work Context IDs for the selected company, not
   one.
2. **ACL enforcement** (`_pipeline/acl.ts`, `_shared/acl_snapshot.ts`'s
   `readAclSnapshotDecision`) — ALLOW if the resource:action is ALLOW
   under **any** Work Context ID in the set (OR across the set, not a
   single-row lookup).
3. **Menu snapshot & cache** (`_core/auth/menu.handler.ts`,
   `_shared/acl_runtime.ts`, `erp_cache.session_menu_snapshot`) — union
   menu rows across the set; cache key drops the single `work_context_id`
   column (keyed by session + universe + company only, since there is no
   longer a single selected context to key on).

### 29.5 Risks / invariants to preserve while implementing

- Single-Work-Context users (the common case) must see **zero behavior
  change** — a union of one is that one. Verify explicitly, don't assume.
- The OR-across-context-set logic in the ACL enforcement layer is the
  highest-risk piece — a bug there can only make access *too permissive*,
  never too restrictive, so it gets the most careful review.
- Changing the `session_menu_snapshot` cache key invalidates every
  existing cached row on deploy — expected, one-time rebuild cost, not a bug.
- Do not conflate this with `GLOBAL_ACL` / multi-company `workspace_mode`
  (Section 17, "union of all companies, navigation only") — that is a
  different axis (cross-company) and must keep working exactly as-is;
  this change is scoped to cross-Work-Context-within-one-company only.

---

## 30. Page Visibility vs Data Access Separation — `menu_visible` (LOCKED design 2026-08-05, ✅ IMPLEMENTED 2026-08-06 — dev + prod both live)

### 30.1 Problem

Today, one `resource_code:action` decision does two jobs at once: it
decides whether the **page** appears in the sidebar, and it decides
whether the **data/write** behind that resource is allowed. These are
not the same question. A page routinely needs read access to *another*
module's resource purely as a background lookup — a dropdown, a
cross-reference, a validation check — with no intention of that other
module's full page ever appearing in the user's sidebar.

Because the system has no way to grant "data yes, page no," every such
lookup has historically been solved by granting the **whole page-level
capability** of the other module instead (2026-08-05 examples: Production
given full `OM_CUSTOMER_LIST`/`OM_CUSTOMER_CREATE` just so Plan Feed's
Customer dropdown/create-modal would work; QUALITY given `PROC_GRN_LIST`
just so the QA queue page could resolve a GRN's storage location). Each
fix was individually correct and narrow in *scope* (right department,
right resource), but structurally wrong in *shape* — it always grants a
navigable page as a side effect, whether or not that's wanted, because
there is no other lever to pull.

This is the direct cause of Section 26's failure mode in practice:
"most users require many custom edits" was starting to become true not
because access decisions were wrong, but because the tooling forces
every cross-module data need to be solved by capability-widening at the
page level.

### 30.2 New rule (LOCKED)

**A capability's grant on `resource_code:action` decides data access.
A separate `menu_visible` flag on that same grant decides whether the
resource's page is offered in the sidebar.** Both flow from the exact
same capability row — nothing new to assign, just one more bit per grant.

This mirrors SAP's own separation: `S_TCODE` (can this transaction/menu
entry be opened) is independent of Authorization Objects (can this
activity — Create/Change/Display — succeed on this data), and F4 search
helps inside any transaction rely on the Authorization Object check
alone, never on holding the full master-data-maintenance transaction.

- `menu_visible = true` (default, matches every existing row): behaves
  exactly as today — ALLOW on VIEW makes the page appear in the sidebar.
- `menu_visible = false`: the resource:action still resolves ALLOW for
  any backend call that checks it (dropdown, lookup, cross-reference,
  validation) — but `generate_menu_snapshot()` does not insert a page row
  for it. The page does not appear, greyed or otherwise.
- Whether a given grant should carry `menu_visible = true` or `false` is
  a **per-grant business decision**, not automatic from the resource's
  "VIEW-only vs write" shape — Section 31's audit decides this per case
  (e.g. QUALITY's `PROC_GRN_LIST` grant stays `true`, because QA staff
  genuinely benefit from browsing GRNs directly, not just as a lookup —
  see Section 31.2's Split-Authority discussion for the reasoning class
  this belongs to).

### 30.3 Schema change

- `acl.capability_menu_actions` and its versioned copy
  `acl.version_capability_menu_actions` each gain
  `menu_visible boolean not null default true`.
- Default `true` on both means **zero behavior change for every existing
  row** the moment the column lands — this is additive, not a migration
  of meaning.

### 30.4 Propagation (two functions, both must carry the flag through)

1. **`acl.generate_acl_snapshot()`** — `precomputed_acl_view` currently
   has no column tracking which capability produced a given resolved
   decision (Section 3 background: the `resolved_base` /
   `override_candidates` / `final_ranked` CTE chain dedups down to one
   winning row per user+context+resource+action via `ROW_NUMBER()`).
   `menu_visible` must ride along through that same resolution and land
   as a column on `precomputed_acl_view`.
2. **`erp_menu.generate_menu_snapshot()`** — today inserts a page row
   whenever ALLOW + VIEW is present. Must add `menu_visible = true` as a
   third required condition before inserting a page row. The
   ALLOW+VIEW-but-`menu_visible=false` case must **not** insert a page
   row, visible or greyed — it simply does not become a menu entry.

### 30.5 Precedence-resolution risk (must be resolved before implementation, not during)

If two different capabilities grant the **same** `resource_code:action`
to the **same** user+context with **different** `menu_visible` values
(e.g. one narrow lookup-only grant with `false`, one legitimate
page-owning grant with `true`), the existing `ROW_NUMBER()` dedup keeps
only one row — and today's precedence rules (deny-wins, override beats
role, etc.) were never designed with a `menu_visible` tiebreak in mind.

**Resolution rule (LOCKED):** `menu_visible` must be OR-reduced across
every ALLOW-decision-contributing row for that user+context+resource+
action pair, not carried through the single winning row. If *any*
grant the user holds for that exact resource:action says `true`, the
page shows. This mirrors Section 29's Work-Context union logic — a
capability that wants the page hidden can only narrow *itself*, never
suppress a page another one of the user's own grants legitimately wants
visible.

### 30.6 What does NOT change

- Union Work Context model (Section 29) — orthogonal axis, both apply
  independently.
- Company scope, Work Company selection (Law 12) — untouched.
- Every existing capability's current page-visibility behavior — all
  default to `true`, identical to today, until Section 31's audit
  deliberately flips specific grants to `false`.
- The underlying `resource_code:action` ALLOW/DENY semantics — unchanged.

### 30.7 Rollout plan

Given this touches core precedence-resolution SQL
(`generate_acl_snapshot()`), build and verify in **dev**
(`ytapuwiqicmvpanmzelb`) first — schema change, both function changes,
the OR-reduce fix from 30.5, and a live before/after check on
`precomputed_acl_view` for at least one multi-grant-collision case —
before touching prod. Only after dev verification does this get applied
to prod as a migration (schema) + the same function changes (also
migration, since these are `SECURITY DEFINER` functions, not data).

### 30.8 Relationship to Sections 26/27

Sections 26 ("Exception Rule") and 27 ("Scalability Rule") already
locked the *intent* — override/exception should stay rare, Work Context
+ Capability Pack should drive access, not per-user stitching. This
section is the missing *mechanism* that makes that intent achievable in
practice: without it, every legitimate cross-module data need forces a
page-level capability grant as an unwanted side effect, which is exactly
the pressure that pushes toward "many custom edits" Section 26 warns
against. Section 30 is a prerequisite for Section 31.

---

## 31. Capability Pyramid Restructure (LOCKED intent 2026-08-05, design pending Section 30)

### 31.1 Why

Capability grants have accreted incident-by-incident (`CAP_PROC_QA`,
`CAP_OM_CUSTOMER_CREATE_ONLY`, `CAP_OM_CUSTOMER_VIEW`, and others across
this project's history) — each individually correct, none designed as
part of a single coherent picture of what any one department actually
needs. The business owner's explicit direction (2026-08-05): stop
patch-work, rebuild the capability set into one concrete pyramid,
department by department, deleting and recreating capabilities freely
where needed — exceptions only where a real exception exists.

### 31.2 Target four-layer model

1. **Universal Baseline** — pure reference/master data, safe for any
   department regardless of function (Material, Customer, Vendor,
   Transporter, CHA, Payment Terms, Port, IN02/IN03). One bundle
   (`CAP_EVERYONE_REPORTS`-style), granted to everyone uniformly. Not
   decided per-incident going forward — a resource either qualifies for
   this baseline on its own merits (true reference data, already
   company-scoped safely) or it doesn't.
2. **Department Operations Bundle** — one bundle per department,
   designed once from that department's actual job function (not grown
   bug-by-bug), including its own primary pages plus any `menu_visible:
   false` cross-module lookups it genuinely needs (Section 30). Example
   target: `CAP_QUALITY_OPERATIONS`, `CAP_PRODUCTION_OPERATIONS`.
3. **Split-Authority (Maker-Checker) Bundle** — two named departments
   paired by deliberate design, one as maker, one as checker, on a
   specific resource family. **Already exists correctly in two live
   cases, confirmed 2026-08-05, consistent across both CMP003 and
   CMP006** — this is not a new invention, just a name for an already-
   correct pattern to keep using deliberately rather than by accident:
   - Pack BOM (PR05-08): SUPPLY CHAIN = maker (`CAP_PACKBOM_CREATE_SCM`
     + `CAP_PACKBOM_APPROVE_SCM`), PRODUCTION = view-only
     (`CAP_PACKBOM_VIEW`).
   - Costing config (AC05/AC06): ACCOUNTS = maker (`CAP_ACC_COSTING`),
     AUDIT = independent checker (`CAP_ACC_COSTING_AUDITOR`, VIEW+WRITE+
     APPROVE) — deliberately a *different* department from Accounts,
     not Accounts reviewing itself.
   **Known loose end to resolve in the audit:** `CAP_PROD_PACKBOM_CREATE`
   / `CAP_PROD_PACKBOM_APPROVE` capabilities exist but are currently
   wired only to ACL-MASTER, never to real PRODUCTION — determine
   during the audit whether this is intentional unused scaffolding (to
   delete) or an unfinished intent to someday give Production its own
   create path (to either wire up or delete, not leave ambiguous).
4. **Individual Exception** — `acl.version_user_overrides`, person-
   specific only, per Section 26. Not a department-wide grant under a
   different name.

### 31.3 Migration approach

Audit every existing capability row, classify each into exactly one of
the four layers above, and for each department produce one clean target
bundle. Consolidate/rename/delete freely — the business owner has
explicitly authorized deleting and recreating capabilities rather than
preserving today's names for continuity's sake.

### 31.4 Explicit dependency on Section 30

This restructure cannot produce a *clean* pyramid without `menu_visible`
already existing — otherwise every Department Operations Bundle (layer
2) that includes a cross-module lookup is forced to also grant that
other module's full page, reintroducing the exact problem this
restructure is meant to fix. **Section 30 must land and be verified
(dev, then prod) before Section 31's audit/rebuild begins.**

### 31.5 Sequencing (LOCKED)

**Phase 1 — Section 30:** schema + function changes, dev-verified, then
prod. **Phase 2 — Section 31:** full capability audit and pyramid
rebuild, department by department, only after Phase 1 is live in prod.

### Implementation record (2026-08-06)

**Phase 1 (§30) is live in both dev and prod.** 3 migrations
(`20260805210000_capability_menu_actions_menu_visible.sql`,
`20260805220000_generate_acl_snapshot_menu_visible.sql`,
`20260805230000_generate_menu_snapshot_menu_visible.sql`) — schema column
on both `capability_menu_actions` tables + `precomputed_acl_view`, the
OR-reduce propagation in `generate_acl_snapshot()`, and the
`menu_visible = TRUE` gate in `generate_menu_snapshot()`'s
`allowed_resource_codes` CTE. Verified in dev via a real toggle
(`OM_CUSTOMER_LIST:VIEW`) and a genuine two-source collision
(capability=false, role=true → page stayed visible, confirming the
OR-reduce). Verified in prod: `generate_acl_snapshot()` re-run for
CMP003 (1286 rows) and CMP006 (1177 rows) — 100% `menu_visible=true`,
zero behavior change, exactly as designed since no grant has been
deliberately narrowed to `false` yet.

**⚠️ Deployment mistake caught same-day, corrected before any real
damage:** applying migration 2 to prod, the `ALTER TABLE
acl.precomputed_acl_view ADD COLUMN menu_visible ...` line (which lived
inside that same migration file alongside the function replace) was
dropped when the SQL was copied into the prod `apply_migration` call —
only the `CREATE OR REPLACE FUNCTION` part went through. This surfaced
immediately as a hard error the moment `generate_acl_snapshot()` was
re-run on real prod data (`column "menu_visible" ... does not exist`),
not silently. Fixed by running the missing `ALTER TABLE` directly
(the local migration file was already correct — only the copy into the
prod tool call was incomplete), then re-verifying both companies clean.
**Lesson:** when a migration file bundles a schema change with a
function replace, copy the *entire* file into the migration tool call,
not just the part that looks like "the real change" — a schema
prerequisite silently split off from its function can pass a naive
`{"success": true}` apply and only fail later, on first real use.

Same session, Section 30 also drove a **Step 1 gap-closure pass**: the
page-dependency manifest (`PAGE-DEPENDENCY-MANIFEST.json` /
`PAGE-CROSS-MODULE-DEPENDENCIES.json`, `docs/Operation Management/
implementation-specs/`) was walked end-to-end against live prod grants,
not just the one page that had been reported. Real gaps found and fixed
(all via the standard ACL version-bump cycle, CMP003+CMP006, versions
44→46): `OM_CUSTOMER_CREATE:EDIT` for Production (Plan Feed's party-type
edit, 403'd despite VIEW+WRITE being present), `OM_VENDOR_LIST:VIEW`
made universal via `CAP_EVERYONE_REPORTS` (Accounts had zero access —
19 pages depend on it), `OM_MATERIAL_CREATE:EDIT` for Production
(Pack BOM / Stroke pages), `SA_OM_PACK_CODE_MASTER` for Production
(had **zero** grants for anyone, including ACL-MASTER — PackConfigPage
was unusable for everyone), `PROC_QA_QUEUE` for Production (SFG Result
Recording / PR18 was completely inaccessible). Confirmed already-correct
and left untouched: `OM_MATERIAL_LIST:VIEW` (already universal),
`SA_PROD_BATCH_SERIES`/`SA_PROD_SEGMENT_LOCATIONS` (Production already
had full access), `PROC_PAYMENT_TERMS_MASTER` (correctly SCM-only, ASL
is SCM's own page), `PROD_OLD_PACKING_PO`/`PROC_SO_CREATE` (correctly
ACL-MASTER-only — Opening Stock and Sales Order Create are both still
pre-launch, not yet rolled out to any real department by design).

**Not yet done (Phase 2, §31):** no existing grant has actually been
flipped to `menu_visible=false` yet — every grant added or already
present still defaults to `true`, so today's sidebar behavior is
unchanged for every user. The mechanism is live and proven; deciding
*which* specific grants should narrow to `false` (e.g. Production's new
`OM_MATERIAL_CREATE`/`SA_OM_PACK_CODE_MASTER`/`PROC_QA_QUEUE` access —
all lookup-only from Plan Feed/PR18's perspective, arguably should not
surface their own standalone pages in Production's sidebar) is deferred
to the full §31 capability-pyramid audit, not decided ad hoc here.
