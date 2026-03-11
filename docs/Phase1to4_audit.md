🔷 PHASE-1 — STRUCTURAL FOUNDATION AUDIT
✔ Master Schemas Present

Schemas verified:

erp_core

erp_master

erp_map

acl

erp_menu

Status: ✔ OK

✔ Companies Table

Table: erp_master.companies

Columns:

id (uuid, PK)

company_code (unique)

company_name

gst_number (unique, format check)

status (ACTIVE/INACTIVE check)

created_at

created_by

Constraints:

PK OK

Unique company_code OK

GST unique OK

GST format check present

status check duplicated (2 check constraints detected)

Issue:
⚠ Duplicate status check constraint exists (companies_status_check + chk_company_status_valid)

Severity: LOW (cleanup recommended)

✔ Projects Table

Table: erp_master.projects

company_id FK

status column present

RLS policy aligned to company_id

Status: ✔ Structurally correct

No structural issue found.

✔ Departments Table

Table: erp_master.departments

company_id present

status present

RLS aligned

Status: ✔ Structurally correct

✔ Mapping Tables
erp_map.user_companies

PK (auth_user_id, company_id)

FK to users

FK to companies

RLS present

Status: ✔ OK

⚠ Primary company invariant (exactly one primary) not DB-enforced yet.

erp_map.user_projects

FK to projects

RLS uses EXISTS company binding

Status: ✔ Correct isolation logic

erp_map.user_company_roles

RLS aligned

Company isolation intact

Status: ✔ OK

🔷 PHASE-2 — ACL SNAPSHOT RUNTIME AUDIT

File:

supabase/functions/api/_pipeline/acl.ts
File-ID: ID-6
✔ stepAcl Flow Verified

Public short-circuit ✔

Context RESOLVED enforcement ✔

Mandatory input check ✔

Snapshot consumption ✔

Missing input = DENY ✔

Resolver executed after snapshot ✔

✔ Snapshot Source

Table:
acl.precomputed_acl_view

Filtered by:

acl_version_id

auth_user_id

company_id

resource_code

action_code

Status: ✔ Correct snapshot consumption

⚠ Pending Verification

Snapshot completeness vs precedence ladder (not stress-tested)

Snapshot refresh trigger validation pending

Version switch deterministic test pending

Severity: MEDIUM (forensic pending)

🔷 PHASE-3 — CONTEXT + RLS ALIGNMENT
✔ Company Isolation

All major tables use:

company_id = erp_meta.req_company_id()

RLS policies:

user_companies ✔

user_company_roles ✔

projects ✔

user_projects ✔

departments ✔

Status: ✔ Isolation correct

⚠ Pending RLS Hard Audit (6.19)

Need confirmation:

FORCE RLS enabled on all protected tables

No permissive leak

anon/auth zero direct access

Status: ❗ Not fully verified

Severity: HIGH (required before hard seal)

🔷 PHASE-4 — APPROVAL GOVERNANCE AUDIT
✔ approver_map Table

Columns verified:

approver_id

company_id

module_code

approval_stage

approver_role_code

approver_user_id

created_at

created_by

Status: ✔ Governance structure correct

✔ role_menu_permission

Columns:

role_code

menu_id

action

effect

approval_required

Status: ✔ Approval flag present

✔ APPROVE Action

ACL engine supports:

VIEW

WRITE

EDIT

DELETE

APPROVE

EXPORT

Status: ✔ APPROVE integrated

⚠ What Not Built (Not Audit Scope)

approval_transactions table

approval state machine

stage engine

min/max approver rule

approval API

These belong to future Gate-6.5

🔷 PHASE-4 CONCLUSION

Approval Governance Layer: ✔ COMPLETE
Approval Execution Engine: ❌ Not built (expected)

🔷 GATE-7 MENU AUTHORITY AUDIT
✔ menu_snapshot Table

Columns verified:

user_id

company_id

snapshot_version

menu_code

resource_code

route_path

is_visible

parent_menu_code

Status: ✔ Structurally correct

✔ stepAcl Independent of Menu

Menu uses snapshot
ACL independent of menu

Layer separation correct.

⚠ Pending

Snapshot refresh determinism test

Deep-link bypass test

Hard deny simulation

Snapshot logging verification

Severity: MEDIUM

🔷 CURRENT SYSTEM STATUS SUMMARY
Layer	Status
Master Tables	✔ Stable
Mapping Layer	✔ Stable
ACL Structure	✔ Stable
ACL Runtime	✔ Functional
Approval Governance	✔ Stable
Approval Engine	Not built
RLS Forensic	Pending
Snapshot Forensic	Pending
Deep-Link Security	Pending
🔷 REMAINING AUDIT BEFORE HARD SEAL
Gate-6 Forensic Needed:

RLS FORCE validation

Snapshot integrity matrix test

Version switch test

Override conflict simulation

Gate-7 Forensic Needed:

Manual URL abuse test

Hidden route enforcement

Snapshot regeneration test

SA/ACL separation runtime test

🔷 FINAL STATUS

Phase-1 → Phase-4 Audit: ✔ COMPLETE (Governance + Structural Level)

Gate-6 & Gate-7 Hard Seal: ❌ NOT YET
(Forensic stress + invariant simulation required)

🔴 RISK ASSESSMENT ADDENDUM

(Gate-6 & Gate-7 — Pre-Seal Confidence Review)

1️⃣ Data Leak Risk
Architectural Status

RLS philosophy declared

Context-bound company filtering active

Service role isolated (backend only)

ACL evaluated before handler

Forensic Status

Full-table RLS FORCE verification: ❗ NOT completed

Anonymous/auth role leak sweep: ❗ NOT completed

Cross-company access simulation: ❗ NOT executed

Conclusion

Design-level isolation exists.
Forensic-level proof pending.
Seal not yet recommended.

2️⃣ Permission Bypass Risk
Architectural Status

Frontend zero authority

Single backend entry

stepAcl enforced pre-handler

Snapshot-driven resolution

Default deny model active

Forensic Status

Deep-link abuse test: ❗ NOT executed

Action-level keyboard intent abuse: ❗ NOT executed

Module disable vs role allow conflict simulation: ❗ NOT executed

Conclusion

Pipeline correct.
Abuse-simulation incomplete.

3️⃣ Snapshot Inconsistency Risk
Architectural Status

acl_versions active

precomputed_acl_view implemented

Active version lookup in stepAcl

Forensic Status

Version switch immediate effect test: ❗ NOT executed

Snapshot refresh trigger determinism: ❗ PARTIALLY VERIFIED

TTL hard policy lock: ❗ NOT formally sealed

Conclusion

Mechanism exists.
Consistency guarantees not fully validated.

4️⃣ Silent Logic Bug Risk
Architectural Status

Precedence ladder implemented

Override + role + module integration present

Default deny fallback active

Forensic Status

Full conflict matrix test (role × override × module × action): ❗ NOT executed

Edge-case precedence inversion test: ❗ NOT executed

Approval interaction test: ❗ NOT applicable (engine incomplete)

Conclusion

Logical structure coherent.
Edge-matrix execution proof missing.

🔒 SSOT 7-Problem Compliance Status
Problem 1 — Permission Precedence

✔ Implemented (resolveAcl ladder present)
❗ Not fully matrix-tested

Problem 2 — Role × Menu Explosion

✔ Capability tables exist
✔ Role-capability mapping exists
❗ Auto-template + inheritance break stress test incomplete

Problem 3 — ACL Too Slow

✔ precomputed_acl_view implemented
✔ Snapshot-based lookup active
❗ TTL refresh deterministic guarantee incomplete

Problem 4 — No Versioning

✔ acl_versions table active
✔ Active version consumption live
❗ Diff viewer missing
❗ Rollback UI not built
❗ Version switch simulation pending

Problem 5 — Self Lockout Risk

✔ SA bypass design declared
✔ Admin universe separation exists
❗ SA immune enforcement not formally proven
❗ Essential GA pack enforcement not verified

Problem 6 — Preview Mode

❌ Not implemented

Problem 7 — Capability Packs

✔ Core structure exists
❗ Full automation + inheritance + UI integration incomplete

🧠 Aggregate SSOT Alignment Score (Architectural vs Forensic)
Dimension	Status
Architectural Alignment	HIGH
Structural Completeness	HIGH
Forensic Validation	MEDIUM-LOW
Abuse Simulation	LOW
Hard Seal Readiness	NOT READY
🚦Current Gate-6 & Gate-7 Confidence Level

System is:

✔ Architecturally aligned
✔ Layer-correct
✔ Authority-correct
✔ SSOT-consistent

But:

❗ Not battle-tested
❗ Not abuse-validated
❗ Not fully forensic-verified

🎯 Executive Conclusion

Your ERP is not misbuilt.
It is pre-hardened but not pre-sealed.

Live deployment at this stage would be technically possible,
but not governance-grade safe.

Seal requires:

RLS forensic sweep

ACL precedence matrix validation

Snapshot determinism proof

SA/GA self-lockout proof

Deep-link abuse simulation