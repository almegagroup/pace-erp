CANONICAL TRUTH MAP (Extracted from SSOT)
==========================================================
ACL SYSTEM

Truth-ACL-Admin-1:
SA/GA operate within ACL engine under highest precedence rule.
Engine is never bypassed; decision remains deterministic.

Invariant-ACL-Admin-1:
Admin override is precedence-based, not pipeline-skipping.

Truth-ACL-1:
ACL decision authority resides exclusively in the Backend layer. Database enforces, but never decides.

Truth-ACL-2:
ACL resolution must operate only on RESOLVED context (authUserId + roleCode + companyId).

Truth-ACL-3:
If ACL input is incomplete or indeterminate, system must DENY by default (fail-closed).

Invariant-ACL-1:
No request may reach a handler before ACL decision.

Invariant-ACL-2:
ACL snapshot (precomputed_acl_view) is the only materialized permission source for runtime decisions.

Snapshot Determinism Clause:

Exactly one ACL version per company must be selected deterministically
by runtime resolver.

System must guarantee:
- At most one active version per company.
- If multiple active versions exist → DENY.
- If no active version exists → DENY.

Database-level enforcement is recommended but not mandatory
if runtime guarantees determinism.

==========================================================
ROLE HIERARCHY

Truth-R-1:
Role hierarchy is rank-based and deterministic. Higher rank cannot be overridden by lower rank.

Truth-R-2:
Role resolution must bind at user-company scope (not global).

Rank Rules:

Rank comparison determines authority precedence.

isHigherRank / isSameOrHigherRank must govern escalation.

Equal rank does not imply override.

Universe Rules:

SA / GA operate in Admin Universe.

Company-bound roles operate in ACL Universe.

No cross-universe implicit privilege inheritance.

==========================================================
APPROVAL FOUNDATION

Truth-A-1:
Approval chains are deterministic and snapshot-bound at time of action.

Truth-A-2:
Approver authority derives from role + context + module enablement.

Truth-A-3:
Approval requirement is action-level, not module-level.

Truth-A-4:
Exactly three approval methods exist:
- Any One
- Sequential
- All Must Approve

Invariant-A-1:
Any rejection results in deterministic FINAL_REJECTED state.

Escalation Logic:
If designated approver unavailable → escalation follows predefined role ladder, not dynamic assumption.

Snapshot Binding Rule:
Approval decisions must bind to the resolved ACL version
selected deterministically at time of execution.
Retroactive rule change cannot alter past approvals.

==========================================================
PARENT vs WORK COMPANY RULES

Truth-C-1:
Parent Company governs HR authority exclusively.

Truth-C-2:
Work Company governs operational authority exclusively.

Invariant-C-1:
All operational actions must validate:
target_company ∈ user.work_companies.

Invariant-C-2:
HR modules must bind strictly to Parent Company.

Isolation Rule:
User may only access projects/departments explicitly mapped via erp_map tables.

Context Rule:
CompanyId resolution precedes projectId and departmentId resolution.
No project/department may resolve without valid company binding.

==========================================================
MENU & NAVIGATION AUTHORITY

Truth-M-1:
Menu rendering must be derived from ACL snapshot, not hardcoded role assumptions.

Truth-M-2:
Menu visibility does not equal action permission; action must still pass ACL step.

Identity Binding Rule:

Backend route identity (method:path) must map deterministically
to ACL resource_code.

Frontend route paths may differ from backend route keys,
but transformation must be centralized and deterministic.

No implicit or hardcoded per-screen mapping allowed.

==========================================================
GLOBAL ISOLATION INVARIANTS

Invariant-I-1:
Frontend holds zero security authority.

Invariant-I-2:
Database never performs business logic decisions.

Invariant-I-3:
Every request must pass through immutable pipeline order:
Session → Context → ACL → Handler → DB.

Current Implementation Note:

System currently operates under route-level authorization model.

Action parameter defaults to VIEW for runtime evaluation.

Granular action-level enforcement (WRITE / EDIT / DELETE / APPROVE)
exists in schema but is not fully activated in runtime resolution.

This is a governance depth limitation,
not a security vulnerability.