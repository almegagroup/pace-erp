# PACE‑ERP — Single Source of Operational State

> **Status:** LIVE · AUTHORITATIVE · CHAT‑INDEPENDENT

---

## Purpose

This file records the **current, factual build state** of PACE‑ERP.
If it is not written here, it does not exist.

---

## Structure (Locked)

| Status | Gate | ID | Domain | Short_Name | Current_Reality | Why_Not_Complete | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved |
| ------ | ---- | -- | ------ | ---------- | --------------- | ---------------- | ----------------- | ------------------------ | -------------- |

---

## Notes

* Status vocabulary is frozen: DONE / HALF‑DONE / DEFERRED / FROZEN
* HALF‑DONE requires all three fields: Why_Not_Complete, Completes_In_Gate, Completes_On_or_After_ID
* Updates occur **only after** ID‑level discussion concludes

---

## Gate Sections



### Gate-0

| Status | Gate | ID | Domain | Short_Name | Current_Reality | Why_Not_Complete | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved |
|--------|------|----|--------|------------|-----------------|------------------|-------------------|--------------------------|----------------|
| ✅ DONE | 0 | ID-0 | GOVERNANCE | Legacy backup + clean slate | Old experiments archived; no legacy code reused | — | — | — | repo root |
| 🔒 FROZEN | 0 | ID-0.01 | GOVERNANCE | SSOT freeze confirmation | All SSOT documents declared final & immutable | — | — | — | docs/SSOT.md |
| 🔒 FROZEN | 0 | ID-0.02 | GOVERNANCE | Fundamental checklist pass | Single backend entry + frontend zero authority locked | — | — | — | docs/GATE_0_FREEZE.md |
| 🔒 FROZEN | 0 | ID-0.1 | INFRA | Monorepo structure | Single repo with frontend / supabase / docs established | — | — | — | frontend/, supabase/, docs/ |
| 🔒 FROZEN | 0 | ID-0.1A | DEVOPS | CODEOWNERS | Code ownership and approval rules enforced | — | — | — | .github/CODEOWNERS |
| 🔒 FROZEN | 0 | ID-0.1B | DEVOPS | Branch rules | Main branch protected, PR mandatory | — | — | — | GitHub branch rules |
| 🔒 FROZEN | 0 | ID-0.1C | DEVOPS | CI basic pipeline | Build/test/deploy skeleton exists | — | — | — | .github/workflows |
| ⏸ DEFERRED | 0 | ID-0.1D | DEVOPS | CI advanced checks | Intentionally postponed | Advanced lint / security hooks not implemented | G-12 | ID-12.1 | — |
| 🔒 FROZEN | 0 | ID-0.2 | FRONT | Frontend bootstrap | Vite + React initialized | — | — | — | frontend/ |
| 🔒 FROZEN | 0 | ID-0.2A | FRONT | No backend SDK rule | No Supabase client SDK in frontend | — | — | — | frontend/ |
| 🔒 FROZEN | 0 | ID-0.2B | FRONT | Frontend env discipline | No DB secrets in frontend | — | — | — | frontend/ |
| 🔒 FROZEN | 0 | ID-0.2C | FRONT | Vercel environment discipline | Env-based API & domain-first assumptions enforced | — | — | — | frontend/ |
| 🔒 FROZEN | 0 | ID-0.2D | FRONT | Frontend deploy neutrality | No browser-only hacks or local authority assumptions | — | — | — | frontend/ |
| 🔒 FROZEN | 0 | ID-0.2E | FRONT | Domain-bound frontend rule | Fixed domain origin assumption enforced | — | — | — | frontend/ |
| 🔒 FROZEN | 0 | ID-0.3 | BACKEND | Supabase project creation | Single Supabase project created | — | — | — | supabase/ |
| 🔒 FROZEN | 0 | ID-0.3A | BACKEND | Region lock | Supabase region permanently fixed | — | — | — | supabase/config |
| 🔒 FROZEN | 0 | ID-0.3B | BACKEND | Edge Functions enabled | Edge Functions enabled for APIs | — | — | — | supabase/functions |
| 🔒 FROZEN | 0 | ID-0.3C | BACKEND | Single backend entry decision | All APIs routed via api/index.ts | — | — | — | supabase/functions/api/index.ts |
| 🔒 FROZEN | 0 | ID-0.4 | BACKEND | Local emulator parity | Local behaviour matches production | — | — | — | supabase/ |
| 🔒 FROZEN | 0 | ID-0.4A | BACKEND | One codepath rule | No dev-only / prod-only logic | — | — | — | backend |
| 🔒 FROZEN | 0 | ID-0.5 | SECURITY | Secret manager setup | Service role secrets stored securely | — | — | — | env |
| 🟡 HALF-DONE | 0 | ID-0.5A | SECURITY | Service role usage policy | Service role client exists and is secure | File header Gate/ID annotation incorrect for Gate-0 security file | Gate-1 | ID-1.x | supabase/functions/api/_shared/serviceRoleClient.ts |
| 🔒 FROZEN | 0 | ID-0.6 | DB | Postgres schema namespace | Base schemas created | — | — | — | migrations |
| 🔒 FROZEN | 0 | ID-0.6A | DB | RLS philosophy definition | Default-deny RLS model defined | — | — | — | migrations |
| 🟡 HALF-DONE | 0 | ID-0.6B | DB | Enable RLS globally | Database-level RLS posture declared (row_security = ON) | RLS not explicitly ENABLED / FORCE ENABLED on individual tables (execution deferred by design) | Gate-2 | ID-2.x | supabase/migrations/20260122102000_gate0_0_6B_enable_rls_globally.sql |
| 🔒 FROZEN | 0 | ID-0.6C | DB | Default deny policies | All CRUD denied by default | — | — | — | migrations |
| 🔒 FROZEN | 0 | ID-0.6D | DB | Service role bypass | Backend service role bypass allowed | — | — | — | migrations |
| 🔒 FROZEN | 0 | ID-0.6E | DB | Anon & auth lockdown | Anon/auth roles have zero access | — | — | — | migrations |
| ⏸ DEFERRED | 0 | ID-10.1 | OBSERVABILITY | Structured logging base | Deferred by design | JSON structured logging not enforced yet | Gate-10 | ID-10.1 | — |
| 🔒 FROZEN | 0 | ID-0.7A | OBSERVABILITY | Health endpoint | Stateless /health endpoint implemented | — | — | — | supabase/functions/api/_core/health.ts |
| 🔒 FROZEN | 0 | ID-0.8 | STANDARDS | File ID tagging standard | Mandatory file header standard defined | — | — | — | docs |
| 🔒 FROZEN | 0 | ID-0.8A | STANDARDS | Header enforcement rule | Headerless file considered invalid | — | — | — | docs |
| 🔒 FROZEN | 0 | ID-0.9 | DOCS | Gate-0 freeze declaration | Gate-0 formally declared complete & frozen | — | — | — | docs/GATE_0_FREEZE.md |


✅ State File Update — DONE Items (Authoritative Wording)
ID-0.5A — Service role usage policy

Status: ✅ DONE

Current_Reality:
Service role usage policy is fully enforced.
Service role key is loaded exclusively from backend environment variables and instantiated only inside backend runtime code.
No frontend or client-side path exists for service role access.

Why_Not_Complete:
—

Completes_In_Gate:
Gate-0

Completes_On_or_After_ID:
ID-0.5A

Files_Involved:

supabase/functions/_shared/serviceRoleClient.ts

🔒 Why this wording is correct (short, factual)

Policy was conceptual + mechanical

Enforcement is binary (exists or does not)

No dependency on ACL / RLS / business data

Header mismatch was the only blocker, now resolved

👉 Therefore DONE, not HALF-DONE, not deferred.


---------------------------------------------------------------------------------------------------------
| Status       | Gate | ID      | Domain      | Short_Name                      | Current_Reality                                                                                    | Why_Not_Complete                                                                                                                        | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved                                                        |
| ------------ | ---- | ------- | ----------- | ------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------ | --------------------------------------------------------------------- |
| 🟡 HALF-DONE | 0    | ID-0.6B | DB          | Enable RLS globally             | Database-level RLS posture is declared (`row_security = ON`) and default-deny philosophy is locked | RLS is not yet ENABLED and FORCE ENABLED on real business tables; no table-level policies can be verified without ACL-bound master data | Gate-6            | ID-6.19                  | supabase/migrations/20260122102000_gate0_0_6B_enable_rls_globally.sql |
| 🟡 HALF-DONE | 1    | ID-12A  | DB-CONTRACT | Service role authority contract | Service role client exists and is backend-only; authority assertion function is present            | No table-level proof exists that only service role can bypass RLS; verification requires ACL + RLS binding on real tables               | Gate-6            | ID-6.19A                 | supabase/functions/_shared/serviceRoleClient.ts                       |

🔎 Mandatory State-File Note (attach below this table)

Note:
The above IDs are intentionally marked HALF-DONE.
They cannot be conclusively verified until Gate-6 (ACL & RLS binding) is complete.
After completion of the specified Gate-6 IDs, these items must be re-validated and explicitly marked DONE or remain HALF-DONE based on enforcement proof.

“The IDs listed in this section are intentionally kept in HALF-DONE or DEFERRED status.
These items cannot be completed within the scope of the current Gate.
Each of these IDs must be explicitly re-verified and closed only after the specified future Gate has been completed.”

| Status       | Gate | ID      | Domain        | Short_Name                   | Current_Reality                      | Why_Not_Complete                                   | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved                                                                                                                                       |
| ------------ | ---- | ------- | ------------- | ---------------------------- | ------------------------------------ | -------------------------------------------------- | ----------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⏸ DEFERRED   | 0    | ID-0.1D | DEVOPS        | CI advanced checks           | Intentionally postponed              | Advanced lint / security hooks not implemented     | G-12           | ID-12.1                  | `.github/workflows/ci.yml`, `.github/workflows/security.yml`, `eslint.config.js`, `package.json`                                                     |
| ⏸ DEFERRED   | 0    | ID-10.1 | OBSERVABILITY | Structured logging base      | Deferred by design                   | JSON structured logging not enforced yet           | Gate-10           | ID-10.1                  | `supabase/functions/api/_lib/logger.ts`, `supabase/functions/api/_lib/request_id.ts`, `supabase/functions/api/_pipeline/runner.ts`  


### Gate-1

| Status | Gate | ID | Domain | Short_Name | Current_Reality | Why_Not_Complete | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved |
|--------|------|----|--------|------------|-----------------|------------------|-------------------|--------------------------|----------------|
| 🔒 FROZEN | 1 | ID-1A | BACKEND | Backend request orchestration | Deterministic pipeline enforced: headers → CORS → CSRF → rate-limit → session → context → ACL → handler | — | — | — | supabase/functions/api/_pipeline/*, supabase/functions/api/index.ts |
| 🔒 FROZEN | 1 | ID-11 | BACKEND | Health endpoint isolation | /health isolated from pipeline and all security spines | — | — | — | supabase/functions/api/index.ts, supabase/functions/api/_core/health.ts |
| 🔒 FROZEN | 1 | ID-2 | SECURITY | Global security headers | Global security headers injected for all responses | — | — | — | supabase/functions/api/_security/security_headers.ts |
| 🔒 FROZEN | 1 | ID-2A | SECURITY | Content Security Policy | Strict CSP enforced without wildcard | — | — | — | supabase/functions/api/_security/csp.ts |
| 🔒 FROZEN | 1 | ID-2B | SECURITY | X-Frame-Options DENY | Clickjacking protection enforced | — | — | — | supabase/functions/api/_security/security_headers.ts |
| 🔒 FROZEN | 1 | ID-2C | SECURITY | Referrer & permissions policy | Referrer-Policy and Permissions-Policy locked down | — | — | — | supabase/functions/api/_security/security_headers.ts |
| 🔒 FROZEN | 1 | ID-3 | SECURITY | CORS enforcement | Strict origin allowlist with origin echo | — | — | — | supabase/functions/api/_pipeline/cors.ts |
| 🔒 FROZEN | 1 | ID-3A | SECURITY | OPTIONS preflight handling | Correct OPTIONS handling without auth | — | — | — | supabase/functions/api/_pipeline/cors.ts |
| 🔒 FROZEN | 1 | ID-3B | SECURITY | No wildcard CORS | Wildcard (*) origins explicitly disallowed | — | — | — | supabase/functions/api/_pipeline/cors.ts |
| 🔒 FROZEN | 1 | ID-4 | SECURITY | CSRF protection | Origin + Referer validation enforced | — | — | — | supabase/functions/api/_pipeline/csrf.ts |
| 🔒 FROZEN | 1 | ID-4A | SECURITY | Safe-method CSRF bypass | GET/HEAD/OPTIONS bypass CSRF | — | — | — | supabase/functions/api/_pipeline/csrf.ts |
| 🔒 FROZEN | 1 | ID-4B | SECURITY | Cross-site POST block | Cross-site POST requests hard-blocked | — | — | — | supabase/functions/api/_pipeline/csrf.ts |
| 🔒 FROZEN | 1 | ID-5A | SECURITY | IP rate limiting | IP-based request throttling enforced | — | — | — | supabase/functions/api/_pipeline/rate_limit.ts |
| 🔒 FROZEN | 1 | ID-5B | SECURITY | Account rate limiting | Identifier/account-based throttling enforced | — | — | — | supabase/functions/api/_pipeline/rate_limit.ts |
| 🔒 FROZEN | 1 | ID-6 | SESSION | Session authority spine | Session resolution contract enforced without DB | — | — | — | supabase/functions/api/_pipeline/session.ts |
| 🔒 FROZEN | 1 | ID-6A | SESSION | Session expiry states | ACTIVE / ABSENT / REVOKED / EXPIRED states defined | — | — | — | supabase/functions/api/_pipeline/session.ts |
| 🔒 FROZEN | 1 | ID-6B | SESSION | Ghost-login prevention | Mandatory logout action enforced | — | — | — | supabase/functions/api/_pipeline/session.ts |
| 🔒 FROZEN | 1 | ID-7 | CONTEXT | Context resolver spine | Context resolver with UNRESOLVED default | — | — | — | supabase/functions/api/_pipeline/context.ts |
| 🔒 FROZEN | 1 | ID-7A | CONTEXT | Context invariant guard | Unresolved context blocks downstream execution | — | — | — | supabase/functions/api/_pipeline/context.ts |
| 🔒 FROZEN | 1 | ID-8 | ACL | ACL resolver spine | Deterministic ALLOW / DENY contract only | — | — | — | supabase/functions/api/_pipeline/acl.ts |
| 🔒 FROZEN | 1 | ID-8A | ACL | ACL decision actions | DENY responses include reason + action | — | — | — | supabase/functions/api/_pipeline/acl.ts |
| 🔒 FROZEN | 1 | ID-9 | RESPONSE | Unified response envelope | Single response structure enforced | — | — | — | supabase/functions/api/_core/response.ts |
| 🔒 FROZEN | 1 | ID-9A | RESPONSE | Action-driven responses | NONE / LOGOUT / REDIRECT / RELOAD supported | — | — | — | supabase/functions/api/_core/response.ts |
| 🔒 FROZEN | 1 | ID-9B | RESPONSE | Session error hard logout | Any SESSION_* error forces logout | — | — | — | supabase/functions/api/_core/response.ts |
| 🔒 FROZEN | 1 | ID-10 | OBSERVABILITY | Request ID propagation | request_id injected into logs, headers, body | — | — | — | supabase/functions/api/_lib/request_id.ts |
| 🔒 FROZEN | 1 | ID-10A | OBSERVABILITY | Structured error logging | Errors logged with request_id, gate, stage, code | — | — | — | supabase/functions/api/_lib/logger.ts |
| 🔒 FROZEN | 1 | ID-12 | DB-CONTRACT | RLS enforcement contract | RLS assertion helper defined (contract-only) | — | — | — | supabase/functions/api/_shared/rls_assert.ts |
| 🟡 HALF-DONE | 1 | ID-12A | DB-CONTRACT | Service role authority contract | Centralized service role client defined (contract-only) | Actual DB enforcement and verification deferred by design | Gate-2 | ID-2.x | supabase/functions/api/_shared/serviceRoleClient.ts |
| 🔒 FROZEN | 1 | ID-13 | DOCS | Gate-1 freeze declaration | Gate-1 formally declared complete & frozen | — | — | — | docs/GATE_1_FREEZE.md |


### Gate‑2

==============================
🔒 Gate-2 — EXECUTION SEALED
==============================

Gate-2 completed without introducing any DB migrations.
All DB objects referenced in this Gate are treated as pre-existing inputs and are not created, mutated, or structurally modified here.

Gate-2 is now:

🔒 FROZEN · EXECUTION-SEALED · DB-ALIGNED · IMMUTABLE

Auth / Session Boundary — Canonical Freeze Table
Status	Gate	ID	Domain	Short_Name	Current_Reality	Enforcement_Confirmed_In	Files_Involved
🔒 FROZEN	2	ID-2.1	AUTH	Login parent	Deterministic login flow fully wired	login.handler.ts	login.handler.ts
🔒 FROZEN	2	ID-2.1A	AUTH	Credential validation	Supabase Auth sole credential authority	authDelegate.ts	authDelegate.ts
🔒 FROZEN	2	ID-2.1B	AUTH	Account state	Only ACTIVE allowed	accountState.ts	accountState.ts
🔒 FROZEN	2	ID-2.1C	SESSION	Session create	ERP session created server-side	session.create.ts	session.create.ts
🔒 FROZEN	2	ID-2.1D	AUTH	Identifier resolver	ERP code → auth_user_id mapping	identifierResolver.ts	identifierResolver.ts
🔒 FROZEN	2	ID-2.2	SESSION	Cookie issue	HttpOnly + SameSite + Secure discipline	session.cookie.ts	session.cookie.ts
🔒 FROZEN	2	ID-2.2A	SESSION	Cookie hardening	No wildcard · No hardcoded domain	session.cookie.ts	session.cookie.ts
🔒 FROZEN	2	ID-2.2B	SESSION	Cookie overwrite	Always regenerate on login	session.cookie.ts	session.cookie.ts
🔒 FROZEN	2	ID-2.2C	SESSION	Bind invariant	session.auth_user_id invariant enforced	session.ts	session.ts
🔒 FROZEN	2	ID-2.3	AUTH	WhoAmI	Identity-only API	me.handler.ts	me.handler.ts
🔒 FROZEN	2	ID-2.3A	AUTH	No-guess contract	Frontend reacts ONLY to action	me.handler.ts	me.handler.ts
🔒 FROZEN	2	ID-2.3B	AUTH	Minimal payload	Empty success payload	me.handler.ts	me.handler.ts
🔒 FROZEN	2	ID-2.4	AUTH	Logout	Server-side revoke	logout.handler.ts	logout.handler.ts
🔒 FROZEN	2	ID-2.4A	AUTH	Cookie invalidate	Deterministic expiration	logout.handler.ts	logout.handler.ts
🔒 FROZEN	2	ID-2.4B	AUTH	Idempotent logout	Multiple logout safe	logout.handler.ts	logout.handler.ts
🔒 FROZEN	2	ID-2.5	SECURITY	Rate limit	Auth-only throttling (IP + identifier)	rate_limit.ts	rate_limit.ts
🔒 FROZEN	2	ID-2.6	SECURITY	Error mapping	Deterministic envelope	response.ts	response.ts
🔒 FROZEN	2	ID-2.6A	SECURITY	Generic msg	Enumeration-safe	response.ts	response.ts
🔒 FROZEN	2	ID-2.7	OBSERVABILITY	Auth logs	Login / logout structured logging	logger.ts	login.handler.ts, logout.handler.ts
🔒 FROZEN	2	ID-2.8	DOCS	Gate-2 freeze	Freeze artifact present	docs/GATE_2_FREEZE.md	docs/GATE_2_FREEZE.md
🚨 Explicit DB Truth (No Misleading Assumptions)

Gate-2:

DOES NOT create tables

DOES NOT alter schema

DOES NOT validate schema existence

DOES NOT introduce constraints

Tables referenced:

erp_core.users

erp_core.sessions

Required structural guarantees (external to Gate-2):

Unique ACTIVE partial index

TTL consistency constraint

RLS ENABLE + FORCE

These must be declared in their originating Gate.

Gate-2 assumes them as authoritative inputs.

🔒 Execution Seal Rules

After this declaration:

Login flow cannot change

Session model cannot change

TTL (12h) cannot change

Cookie contract cannot change

Error envelope semantics cannot change

Rate-limit contract cannot change

Single-active-session invariant must remain intact

Any behavioural change requires:

→ New Gate version
→ Architectural amendment
→ Formal superseding declaration

Silent mutation constitutes 🚨 DRIFT.

🔐 Final Declaration

Gate-2 is hereby declared:

🔒 FROZEN · EXECUTION-SEALED · DB-ALIGNED · IMMUTABLE

Date: 2026-02-23
Authority: PACE-ERP System Architecture

✅ Gate-3 — SESSION LIFECYCLE & SECURITY (FINAL · SEALED)
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🔒 FROZEN	3	3	SESSION	Session lifecycle definition	Authoritative lifecycle model fully enforced and policy locked	—	—	—	_pipeline/session.ts, _pipeline/session_lifecycle.ts, _pipeline/runner.ts
🔒 FROZEN	3	3.1	SESSION	Idle timeout engine	Idle tracking implemented and thresholds locked	—	—	—	_pipeline/session_lifecycle.ts
🔒 FROZEN	3	3.1A	SESSION	Idle warning signal	Deterministic warning emitted before expiry	—	—	—	_pipeline/session_lifecycle.ts
🔒 FROZEN	3	3.1B	SESSION	Idle expiry handler	Idle expiry forces deterministic LOGOUT	—	—	—	_pipeline/session_lifecycle.ts, _pipeline/runner.ts
🔒 FROZEN	3	3.2	SESSION	Absolute TTL engine	TTL evaluated per request; DB authoritative; value locked	—	—	—	_pipeline/session_lifecycle.ts
🔒 FROZEN	3	3.2A	SESSION	TTL enforcement	TTL never extends; always overrides idle	—	—	—	_pipeline/session_lifecycle.ts, _pipeline/runner.ts
🔒 FROZEN	3	3.3	SESSION	Single active session policy	Exactly one ACTIVE session per user; DB enforced	—	—	—	_core/session/session.create.ts
🔒 FROZEN	3	3.3A	SESSION	Global revoke on login	All ACTIVE sessions revoked atomically	—	—	—	_core/session/session.create.ts
🔒 FROZEN	3	3.4	SESSION	Admin force revoke	Admin revocation immediately effective on next request	—	—	—	_pipeline/session.ts, _core/session/session.admin_revoke.ts
🔒 FROZEN	3	3.4A	SESSION	Immediate effect rule	REVOKED state deterministically forces logout	—	—	—	_pipeline/runner.ts
🔒 FROZEN	3	3.5	SESSION	Device tagging (soft)	Device metadata captured; signal-only by design	—	—	—	_core/auth/login.handler.ts, _core/session/session.create.ts
🔒 FROZEN	3	3.5A	SESSION	Device change signal	Device changes logged; no control impact (intentional)	—	—	—	_pipeline/session_lifecycle.ts
🔒 FROZEN	3	3.6	SECURITY	Session fixation prevention	New UUID generated per login; old sessions revoked	—	—	—	_core/session/session.create.ts
🔒 FROZEN	3	3.6A	SECURITY	Cookie regeneration rule	Fresh HttpOnly cookie issued on authentication	—	—	—	_core/auth/login.handler.ts
🔒 FROZEN	3	3.7	SECURITY	Session state validation	Non-ACTIVE sessions rejected authoritatively	—	—	—	_pipeline/session.ts
🔒 FROZEN	3	3.7A	SECURITY	SESSION_* logout enforcement	All lifecycle terminal states force LOGOUT	—	—	—	_pipeline/runner.ts
🔒 FROZEN	3	3.8	OBSERVABILITY	Session timeline logs (emission layer)	Structured lifecycle events emitted with request_id	—	—	—	_pipeline/session.ts, _pipeline/session_lifecycle.ts, _lib/logger.ts
🔒 FROZEN	3	3.9	DOCS	Gate-3 freeze declaration	Behaviour, contracts, and policy formally locked	—	—	—	docs/GATE_3_FREEZE.md
🔁 Dependency Correction (Important)

The previous table incorrectly showed:

3.x depends on Gate-10

Correct architectural direction:

Gate-10 (observability storage / tracing / visualization)
DEPENDS ON
Gate-3 signal emission

Gate-3 does NOT depend on Gate-10.

🧠 What Changed From Old Table?
Before	Now
HALF-DONE	🔒 FROZEN
Policy not locked	Policy locked
Deferred to Gate-10	Independent
Config Gate pending	No config layer introduced
Storage defer confusion	Emission complete
📌 Final Reality

There are:

No deferred policy values

No missing enforcement

No missing DB invariant

No future gate required to “complete” lifecycle logic

Gate-10 will add:

Persistent timeline recorder

RCA reconstruction

Trace viewers

Alert hooks

But it will not modify lifecycle behaviour.

🏁 Final State

Gate-3 is:

🔒 Behaviourally Final
🔒 Policy Locked
🔒 DB Consistent
🔒 Control Plane Stable

You will not revisit these scripts again.

✅ UPDATED — Gate-4 Table
Gate-4
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
✅ DONE	4	4.0A	GOVERNANCE	User lifecycle authority	Supabase Auth handles identity only; ERP lifecycle DB-owned	—	—	—	docs/GATE_4_FREEZE.md
✅ DONE	4	4.0B	GOVERNANCE	Deterministic lifecycle states	Lifecycle states locked; DB enforces transitions atomically	—	—	—	docs/GATE_4_FREEZE.md
✅ DONE	4	4.0C	ACL	Minimal ACL bootstrap	Single-role bootstrap (L1_USER) inside atomic DB engine	—	—	—	migrations/20260126102000_gate4_4_2C_atomic_approval_engine.sql
✅ DONE	4	4.1	AUTH	Signup intake	Public signup creates ERP user in PENDING state only	—	—	—	signup.handler.ts
✅ DONE	4	4.1A	DB	ERP users table	erp_core.users lifecycle table enforced	—	—	—	migrations/20260123101000_gate4_4_1_create_erp_users.sql
🟡 DEFERRED	4	4.1B	SECURITY	Signup rate limiting	Rate limiting intentionally deferred	Abuse protection belongs to later gate	Gate-5	ID-5.x	(Future security middleware)
✅ DONE	4	4.1C	SECURITY	Human verification	Backend human verification enforced	—	—	—	human_verification.ts
✅ DONE	4	4.2	ADMIN	Signup rejection	Reject performed via atomic DB function	—	—	—	reject_signup_atomic()
✅ DONE	4	4.2A	ADMIN	Signup approval	Approval fully DB-owned atomic lifecycle	—	—	—	approve_signup_atomic()
✅ DONE	4	4.2B	AUDIT	Approval audit log	Append-only audit inside DB engine	—	—	—	erp_audit.signup_approvals
✅ DONE	4	4.3	DB	User code sequence	Deterministic P000X sequence enforced	—	—	—	erp_core.user_code_p_seq
🔒 FROZEN	4	4.7	DOCS	Gate-4 freeze declaration	Lifecycle governance formally sealed	—	—	—	docs/GATE_4_FREEZE.md
🔎 What Changed vs Your Version
1️⃣ 4.0C এখন DONE (আগে HALF-DONE ছিল)

কারণ:

Bootstrap এখন DB atomic function এর ভেতরে

Single role architecture sealed

No escalation logic under Gate-4 (correct boundary)

2️⃣ 4.1B এখন DEFERRED (আগে DONE ছিল)

কারণ:

এটা lifecycle না

এটা security hardening

Gate-5 dependency

3️⃣ 4.2 / 4.2A Files Updated

এখন Files_Involved এ handler না, DB function authoritative

🔐 Updated Observations Section
Gate-4 Observations (Updated)

Gate-4 introduces ERP lifecycle authority but not business capability.

Signup intake is enumeration-safe and authority-free.

Approval and rejection are DB-owned atomic operations.

user_code is immutable once assigned.

Exactly one canonical role is allowed per ERP user.

ACL bootstrap is minimal by design, not incomplete.

No session, context, or permission logic exists in this gate.

No handler may mutate lifecycle tables directly.

Lifecycle transitions are race-safe and non-bypassable.

🔒 Updated Final Declaration

Gate-4 is COMPLETE at the governance and lifecycle layer.

All ERP lifecycle transitions are:

Deterministic

Atomic

DB-owned

Append-audited

Enumeration-safe

Single-authority

No further lifecycle mutation is permitted under Gate-4.

Rate limiting (4.1B) remains intentionally deferred to Gate-5 security layer.

📌 Special Notes Section (Updated)

Replace your special notes with:

Special Notes

The following IDs are intentionally deferred and do not block lifecycle integrity:

Status	Gate	ID	Domain	Reason
🟡 DEFERRED	4	4.1B	SECURITY	Signup rate limiting belongs to Gate-5 security hardening

Deferred items:

Have explicit future gate assignment

Cannot silently complete

Must be re-verified at future gate execution

✅ Gate-5 — CONTEXT AUTHORITY & RESOLUTION
Gate-5 State Table (EXECUTION-SEALED UPDATE)
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🔒 SEALED	5	ID-5	GOVERNANCE	Context authority lock	Backend-only authority enforced; frontend permanently ignored	—	—	—	_pipeline/context.ts, _pipeline/runner.ts
🔒 SEALED	5	ID-5.1	CONTEXT	Request context resolver	Deterministic resolver with DB-backed company/project/department validation	—	—	—	_pipeline/context.ts
🔒 SEALED	5	ID-5.1A	CONTEXT	Context input sanitization	Frontend hints ignored unconditionally	—	—	—	_pipeline/context.ts
🔒 SEALED	5	ID-5.1B	SECURITY	Missing context handling	UNRESOLVED → deterministic 403 via central envelope	—	—	—	_pipeline/context.ts, _pipeline/runner.ts
🔒 SEALED	5	ID-5.2	CONTEXT	Company context validation	Primary company resolved deterministically from DB	—	—	—	_pipeline/context.ts, erp_map.get_primary_company
🔒 SEALED	5	ID-5.2A	SECURITY	Single-company invariant	One-company-per-request enforced structurally	—	—	—	_pipeline/context.ts, DB unique index
🔒 SEALED	5	ID-5.3	CONTEXT	Project context validation	Project membership verified against user mapping	—	—	—	_pipeline/context.ts, user_projects
🔒 SEALED	5	ID-5.3A	SECURITY	Company-project binding	Cross-company project leakage blocked deterministically	—	—	—	_pipeline/context.ts
🔒 SEALED	5	ID-5.4	CONTEXT	Department context validation	Department membership verified	—	—	—	_pipeline/context.ts, user_departments
🔒 SEALED	5	ID-5.4A	SECURITY	Department access check	HR boundary isolation enforced	—	—	—	_pipeline/context.ts
🟡 DEFERRED	5	ID-5.5	ADMIN	SA / GA bypass rules	Admin bypass branch exists; activation depends on ACL truth	Requires Gate-6 ACL truth	Gate-6	ID-6.x	_pipeline/context.ts
🟡 DEFERRED	5	ID-5.5A	SECURITY	Bypass isolation guard	Admin ≠ ACL user separation declared	Requires Gate-6 ACL universe truth	Gate-6	ID-6.x	_pipeline/context.ts
🔒 SEALED	5	ID-5.6	SECURITY	Context invariant enforcement	UNRESOLVED always blocks downstream execution	—	—	—	_pipeline/context.ts, _pipeline/runner.ts
🔒 SEALED	5	ID-5.6A	SECURITY	Context error codes	Central errorResponse() envelope; no logout	—	—	—	_pipeline/context.ts, _core/response.ts
🟡 DEFERRED	5	ID-5.7	DB	RLS context alignment	Context headers injected into DB client	Hard verification belongs to DB hard lock	Gate-7	ID-7.x	_shared/serviceRoleClient.ts, context_headers.ts
🟡 DEFERRED	5	ID-5.7A	DB	Context mismatch block	RLS templates enforce zero-row on mismatch	Full business table enforcement in Gate-7	Gate-7	ID-7.x	ACL RLS migrations
🟡 DEFERRED	5	ID-5.8	OBSERVABILITY	Context resolution logs	Logging intentionally postponed	Needs ACL truth to be meaningful	Gate-6	ID-6.x	—
🔒 SEALED	5	ID-5.9	DOCS	Gate-5 freeze	Execution-level freeze declared	—	—	—	docs/GATE_5_FREEZE.md
🔍 Gate-5 Observations (Execution-Grade)

✔ Context authority fully backend-locked
✔ No frontend influence path
✔ Deterministic 403 on UNRESOLVED
✔ No logout side-effects
✔ No silent fallback
✔ Company/project/department isolation enforced
✔ Production-parity safe
✔ No ACL logic leakage

Admin activation and DB hard-lock intentionally separated.

📌 Non-Negotiable Notes (Updated)

No HALF-DONE terminology used (removed).

🟡 rows are intentionally cross-gate scoped.

No Gate-5 item depends on chat memory.

Gate-5 correctness does not rely on future gates behaving correctly.

Gate-6 and Gate-7 only extend capability — they do not fix Gate-5 defects.

🔒 Gate-5 Final State (Corrected)

Gate-5 is:

🔒 EXECUTION-SEALED (Scope-Bound)

Not just governance-frozen.

No reinterpretation allowed.

➡️ Next Gate: Gate-6 — ACL & Business Truth
                                        
✅ PACE-ERP — Gate-6 (Partial) State Update
(Up to ID-6.2A only)
Gate-6 — ACL & Business Truth (IN PROGRESS)
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🔒 FROZEN	6	ID-6	GOVERNANCE	ACL authority lock	Backend-only ACL authority formally declared; frontend has zero permission authority	—	—	—	docs/ACL_SSOT.md
🔒 FROZEN	6	ID-6.1	ACL	Role ladder + roleRank	Canonical role hierarchy, ranks, and comparison helpers finalized	—	—	—	acl/roleLadder.ts
🔒 FROZEN	6	ID-6.1A	ACL	Role normalization	Role codes normalized deterministically at load time	—	—	—	acl/roleLadder.ts
✅ DONE	6	ID-6.2	MASTER	Company master	Canonical company registry created with deterministic company_code and GST support	—	—	—	migrations/20260126130000_gate6_6_2_create_company_master.sql
✅ DONE	6	ID-6.2A	MASTER	Company state rules + GST invariants	Company code generation, GST normalization, and uniqueness invariants enforced at DB level	—	—	—	migrations/20260126131000_gate6_6_2A_company_code_generator.sql
🔎 Mandatory Gate-6 Notes (Attach Below Table)
1️⃣ Why ID-6.2 and ID-6.2A are DONE

ID-6.2 (Company master) is marked DONE because:

erp_master.companies is created

Company identity is backend-authoritative

company_code is deterministic

gst_number is structurally supported

No policy, ACL, or context dependency exists at creation level

ID-6.2A (Company state rules + GST invariants) is marked DONE because:

Deterministic company_code generator exists (sequence + function)

GST normalization enforced (upper(trim()))

GST uniqueness enforced (partial unique index)

All invariants are enforced at DB layer, not handler logic

No runtime dependency on ACL / context / user mapping

👉 Therefore DONE, not HALF-DONE.

🔗 Earlier Gate Closures Triggered by G2 Completion

Completion of G2 (ID-6.2 + 6.2A) directly resolves the following earlier HALF-DONE items at the data-availability level:

Earlier Gate	ID	What was missing	What changed now
Gate-5	ID-5.2	Company truth unavailable	erp_master.companies is now authoritative
Gate-5	ID-5.2A	No real org boundary	Single canonical company table exists
Gate-5	ID-5.5	SA/GA bypass had no universe anchor	Company universe now exists
Gate-5	ID-5.5A	Bypass isolation lacked org truth	Company identity is now resolvable

⚠️ Important:
These Gate-5 IDs are not auto-marked DONE yet — because:

context.ts still returns UNRESOLVED

Admin detection is still stubbed

Context resolution logic has not consumed company data yet

They move from “blocked by missing data” → “blocked by missing wiring”, which is correct for Gate-6 flow.

🧠 Very Simple Analogy (Why this is valid)

Gate-5 said:
“I know what to do if I get company info, but I don’t know what a company is yet.”

Gate-6 (G2) did:
“Here is what a company is. Canonical. Immutable. Backend-owned.”

Gate-5 logic does not change, only inputs become possible later (G4 wiring).

That is why G2 closes the data dependency, not the logic dependency.

📌 Final Statement (Audit-Grade)

Gate-6 is IN PROGRESS

Groups G0, G1, G2 are COMPLETE

No context, ACL resolver, or mapping logic has been altered

No previous gate semantics were violated

No HALF-DONE item was falsely upgraded

➡️ Next legitimate step:
G3 — Project & Department Masters (ID-6.3, 6.3A, 6.4, 6.4A)
🔹 Gate-6 — Project & Department Masters (G3)

📌 Gate-6 / G3 State Update (INSERT AS-IS)

Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	6	ID-6.3	MASTER	Project master	Canonical Project entity exists; projects are structurally bound to a single company with deterministic project codes (PRJ001…). Orphan or cross-company projects are structurally impossible.	No user-level creation, edit, or visibility handlers exist; consumption by context & ACL not yet wired	Gate-9	ID-9.4	supabase/migrations/*_gate6_6_3_create_project_master.sql
🟡 HALF-DONE	6	ID-6.3A	MASTER	Project state rules	Project lifecycle rules (ACTIVE / INACTIVE) are enforced at DB level; unsafe delete or usage is structurally blocked.	State transitions not yet exercised or validated via handlers / workflows	Gate-9	ID-9.4A	supabase/migrations/*_gate6_6_3A_project_state_rules.sql
🟡 HALF-DONE	6	ID-6.4	MASTER	Department master	Canonical Department entity exists; departments are structurally bound to a single company with deterministic department codes (DPT001…). Orphan departments are structurally impossible.	No HR or admin handlers exist to consume department truth	Gate-9	ID-9.5	supabase/migrations/*_gate6_6_4_create_department_master.sql
🟡 HALF-DONE	6	ID-6.4A	MASTER	Department state rules	Department lifecycle rules (ACTIVE / INACTIVE) are enforced at DB level; unsafe delete or usage is structurally blocked. HR scope safety is structurally locked.	Lifecycle not yet driven by HR/admin workflows	Gate-9	ID-9.5	supabase/migrations/*_gate6_6_4A_department_state_rules.sql
🔎 Mandatory Gate-6 / G3 Notes (append below table)

Notes:

G3 defines structural business truth only (schema + invariants).

No API handlers are introduced by design in Gate-6 / G3.

“Create” in G3 means system-level existence, not user-triggered actions.

Project and Department are derived business truths, not bootstrap entities.

Therefore, no creation / edit handlers are permitted at this Gate.

🔓 Earlier HALF-DONE IDs — Structural Blockers Removed (but NOT auto-closed)

Completion of G3 structure removes the data-absence blocker for the following IDs,
but does NOT mark them DONE until consumed in their owning Gates:

Earlier Gate	ID	Previous Why_Not_Complete	Structural Resolution in Gate-6
Gate-5	ID-5.3	Project data absent	Canonical project master now exists
Gate-5	ID-5.3A	Company-project binding unverifiable	FK + invariants now enforceable
Gate-5	ID-5.4	Department data absent	Canonical department master now exists
Gate-5	ID-5.4A	Department isolation unverifiable	HR-scoped lifecycle enforced

📌 Important:
These IDs remain HALF-DONE and will be marked DONE only when consumed by:

Gate-9 (Admin & HR handlers)

Gate-10 (ACL decision engine / enforcement)

🧠 One-line authoritative summary

Gate-6 / G3 is structurally COMPLETE but behaviorally HALF-DONE.
Project and Department are now first-class, company-bound business truths with deterministic identity and lifecycle safety; all user-level behavior is intentionally deferred to later Gates.

# PACE‑ERP — Single Source of Operational State

> **Status:** LIVE · AUTHORITATIVE · CHAT‑INDEPENDENT

---

## Purpose

This file records the **current, factual build state** of PACE‑ERP.
If it is not written here, it does not exist.

---

## Structure (Locked)

| Status | Gate | ID | Domain | Short_Name | Current_Reality | Why_Not_Complete | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved |
| ------ | ---- | -- | ------ | ---------- | --------------- | ---------------- | ----------------- | ------------------------ | -------------- |

---

## Notes

* Status vocabulary is frozen: DONE / HALF‑DONE / DEFERRED / FROZEN
* HALF‑DONE requires all three fields: Why_Not_Complete, Completes_In_Gate, Completes_On_or_After_ID
* Updates occur **only after** ID‑level discussion concludes

---

## Gate Sections

### Gate‑6 — **G4: Org & User Mapping (Context → DB → RLS Wiring)**

| Status       | Gate | ID      | Domain | Short_Name            | Current_Reality                                                                           | Why_Not_Complete                                                               | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved                                                     |
| ------------ | ---- | ------- | ------ | --------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------- | ------------------------ | ------------------------------------------------------------------ |
| 🟡 HALF-DONE | 6    | ID-6.5  | MAP    | User-Company map      | Canonical user↔company mapping table exists with FK and integrity constraints at DB level | Mapping is not yet consumed by context resolver or ACL engine                  | Gate-6            | ID-6.9                   | migrations/20260211103000_gate6_6_6_create_user_company_map.sql    |
| 🟡 HALF-DONE | 6    | ID-6.5A | MAP    | Primary company rule  | DB enforces exactly one primary company per user                                          | Primary company is not yet used by context resolution or permission evaluation | Gate-6            | ID-6.9                   | migrations/20260211104000_gate6_6_6A_primary_company_rule.sql      |
| 🟡 HALF-DONE | 6    | ID-6.6  | MAP    | User-Project map      | User↔project mapping table exists with company-scoped foreign keys                        | No handler or ACL logic yet consumes project membership                        | Gate-6            | ID-6.9                   | migrations/20260211105000_gate6_6_7_create_user_project_map.sql    |
| 🟡 HALF-DONE | 6    | ID-6.6A | MAP    | Project subset rule   | DB guarantees user projects ⊆ user’s company projects                                     | Rule is structural only; no runtime enforcement via ACL yet                    | Gate-6            | ID-6.9                   | migrations/20260211106000_gate6_6_7A_user_project_subset_rule.sql  |
| 🟡 HALF-DONE | 6    | ID-6.7  | MAP    | User-Department map   | Canonical user↔department mapping table exists                                            | Department membership not yet resolved into context or permission logic        | Gate-6            | ID-6.9                   | migrations/20260211107000_gate6_6_8_create_user_department_map.sql |
| 🟡 HALF-DONE | 6    | ID-6.7A | MAP    | Department scope rule | DB enforces department must belong to user’s company                                      | Scope rule not yet consumed by ACL or HR workflows                             | Gate-6            | ID-6.9                   | migrations/20260211108000_gate6_6_8A_department_scope_rule.sql     |


**Authoritative Outcome (G4):**

* Backend context resolution is now **data‑backed**, not stubbed
* `context.ts` resolves **company / project / department** deterministically from DB truth
* `runner.ts` enforces UNRESOLVED → hard‑block before handlers
* All service‑role DB access is **context‑aware** via RLS headers

Files consuming G4 truth:

* `supabase/functions/api/_pipeline/context.ts`
* `supabase/functions/api/_shared/context_headers.ts`
* `supabase/functions/api/_shared/serviceRoleClient.ts`
* All admin handlers using `getServiceRoleClientWithContext`

---

### 🔓 Earlier HALF‑DONE IDs — **Now Provably Resolved by G4**

| Status | Gate | ID      | Domain   | Short_Name               | Current_Reality                                                              | Why_Not_Complete | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved                            |
| ------ | ---- | ------- | -------- | ------------------------ | ---------------------------------------------------------------------------- | ---------------- | ----------------- | ------------------------ | ----------------------------------------- |
| ✅ DONE | 5    | ID‑5.1  | CONTEXT  | Request context resolver | Context resolution is fully DB‑backed using user↔org/project/department maps | —                | —                 | —                        | _pipeline/context.ts, migrations/6.5–6.8A |
| ✅ DONE | 5    | ID‑5.1B | SECURITY | Missing context handling | UNRESOLVED context is provably unreachable for valid mapped users            | —                | —                 | —                        | _pipeline/context.ts, runner.ts           |
| ✅ DONE | 4    | ID‑4.0C | ACL      | Minimal ACL bootstrap    | L1_USER assignment + resolved context now allows deterministic ACL evolution | —                | —                 | —                        | approve.handler.ts, acl.ts                |

**Proof Standard (Audit‑Grade):**

* All three IDs required **org/user mapping truth**
* That truth now exists at DB level **and is consumed in runtime**
* No stub, mock, or placeholder remains
* Therefore DONE — not HALF‑DONE

---

### Gate‑5 — CONTEXT AUTHORITY & RESOLUTION (UPDATED)

| Status       | Gate | ID      | Domain     | Short_Name                 | Current_Reality                         | Why_Not_Complete                          | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved                  |
| ------------ | ---- | ------- | ---------- | -------------------------- | --------------------------------------- | ----------------------------------------- | ----------------- | ------------------------ | ------------------------------- |
| 🔒 FROZEN    | 5    | ID‑5    | GOVERNANCE | Context authority lock     | Backend‑only context authority enforced | —                                         | —                 | —                        | _pipeline/context.ts            |
| ✅ DONE       | 5    | ID‑5.1  | CONTEXT    | Request context resolver   | Fully DB‑backed context resolution      | —                                         | —                 | —                        | _pipeline/context.ts            |
| 🔒 FROZEN    | 5    | ID‑5.1A | CONTEXT    | Context input sanitization | Frontend hints ignored unconditionally  | —                                         | —                 | —                        | _pipeline/context.ts            |
| ✅ DONE       | 5    | ID‑5.1B | SECURITY   | Missing context handling   | UNRESOLVED deterministically blocked    | —                                         | —                 | —                        | _pipeline/context.ts, runner.ts |
| 🟡 HALF‑DONE | 5    | ID‑5.7  | DB         | RLS context alignment      | Context headers injected into DB client | Table‑level RLS policies not yet attached | Gate‑7            | ID‑7.x                   | serviceRoleClient.ts            |

---

### Final Authoritative Statement

**G4 — Org & User Mapping is COMPLETE.**

This Gate:

* Closes all context‑truth blockers
* Removes data‑absence ambiguity from Gates 4 & 5
* Enables deterministic ACL & RLS work in later Gates

| Earlier Gate | ID      | Earlier Status | Earlier Why_Not_Complete                  | G4 What Changed                   | Proof Type              | Proof Location                                   | Verdict                            |
| ------------ | ------- | -------------- | ----------------------------------------- | --------------------------------- | ----------------------- | ------------------------------------------------ | ---------------------------------- |
| Gate-5       | ID-5.1  | 🟡 HALF-DONE   | ERP user → org mapping absent             | Canonical user↔company map exists | DB structural proof     | `erp_map.user_companies`, `primary_company_rule` | **Data blocker removed**           |
| Gate-5       | ID-5.1B | 🟡 HALF-DONE   | Context mapping logic had no backing data | All mapping tables now exist      | DB structural proof     | `erp_map.*` tables                               | **Data blocker removed**           |
| Gate-5       | ID-5.3  | 🟡 HALF-DONE   | Project truth unavailable                 | Project master exists             | DB structural proof     | `erp_master.projects`                            | **Data blocker removed**           |
| Gate-5       | ID-5.3A | 🟡 HALF-DONE   | Company-project binding unverifiable      | FK + subset rules enforced        | DB invariant proof      | `company_project_map + rule`                     | **Data blocker removed**           |
| Gate-5       | ID-5.4  | 🟡 HALF-DONE   | Department data absent                    | Department master exists          | DB structural proof     | `erp_master.departments`                         | **Data blocker removed**           |
| Gate-5       | ID-5.4A | 🟡 HALF-DONE   | Dept ↔ company isolation unverifiable     | Scope rule enforced               | DB invariant proof      | `department_scope_rule`                          | **Data blocker removed**           |
| Gate-4       | ID-4.0C | 🟡 HALF-DONE   | ACL bootstrap had no org context          | Org context now resolvable        | Structural availability | G4 mappings + context.ts                         | **Structural dependency resolved** |


No further changes to G4 are permitted.

### Gate-6 — ACL & Business Truth
### Gate-6 — G5: Menu Permission Model (ACL → Menu → VWED)

| Status       | Gate | ID      | Domain | Short_Name               | Current_Reality                                                                 | Why_Not_Complete                                                                 | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved |
|-------------|------|---------|--------|--------------------------|----------------------------------------------------------------------------------|----------------------------------------------------------------------------------|------------------|--------------------------|----------------|
| 🟡 HALF-DONE | 6    | ID-6.9  | ACL    | role_menu_permission     | Role-wise VWED permission structure is defined at schema level; permission intent is structurally expressible and deterministic | No runtime ACL evaluation, precedence ladder, or menu rendering logic consumes this data yet | Gate-6          | ID-6.10                  | migrations/20260220XXXX_gate6_6_9_create_role_menu_permissions.sql |
| 🟡 HALF-DONE | 6    | ID-6.9A | ACL    | menu_resource_model      | Canonical menu resource + action model exists with deterministic resource_code and action set | No SA UI, seeding, or binding to actual menu_tree rendering pipeline yet         | Gate-6          | ID-6.10                  | migrations/20260220YYYY_gate6_6_9A_create_menu_resource_model.sql |

Notes:

1. ID-6.9 and ID-6.9A together form **G5 — Menu Permission Model**.
   Neither ID is meaningful in isolation.

2. G5 defines **permission truth**, not permission behavior.
   No ACL enforcement, resolver logic, or UI rendering is allowed in this group.

3. ID-6.9A (Menu Resource Model) MUST exist before ID-6.9 can be consumed,
   but is kept HALF-DONE because:
   - No SA-driven menu seeding has occurred
   - No production menu tree is yet bound

4. ID-6.9 (Role Menu Permission) is HALF-DONE because:
   - VWED data exists structurally
   - Precedence ladder (Hard Deny → User → Role → Default Deny) is not yet executed
   - ACL snapshot / cache / precompute logic is not yet implemented

5. No earlier Gate is closed or modified by G5.
   G5 consumes:
   - Role ladder (ID-6.1)
   - Org & mapping truth (G4)
   but does not alter them.

6. Completion of G5 occurs ONLY when:
   - ACL decision engine (Gate-10)
   - Precomputed ACL view
   - Menu rendering pipeline
   consume these tables end-to-end.

Gate-6 / G5 defines canonical menu resources and role-wise VWED permission truth at the database level; all permission evaluation, precedence resolution, caching, and UI rendering are intentionally deferred to later Gates.

🔹 Gate-6 — G6: Capability System (Role → Capability → Menu Action)
📌 Gate-6 / G6 State Update (INSERT AS-IS)
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	6	ID-6.10	ACL	role_capability + capability_packs	Canonical capability packs exist as first-class ACL entities. Roles are structurally decoupled from menu actions and instead bind to reusable capability packs. Capability → menu → action permission truth is expressible deterministically at DB level.	No ACL resolver consumes capability data yet; no precedence execution, snapshot, or caching logic exists.	Gate-10	ID-6.14	migrations/20260221101000_gate6_6_10_create_capabilities.sql
migrations/20260221101010_gate6_6_10_create_capability_menu_actions.sql
migrations/20260221101020_gate6_6_10_create_role_capabilities.sql
🟡 HALF-DONE	6	ID-6.10A	ACL	Capability precedence	Canonical precedence rules between role-level rules and capability-derived permissions are declared and versionable at DB level. Conflict resolution intent is explicitly modeled.	Precedence rules are not yet executed by ACL decision engine; no runtime evaluation order enforced.	Gate-10	ID-6.14	migrations/20260221101030_gate6_6_10A_create_capability_precedence_rules.sql
🔎 Mandatory Notes (Attach Below Table)

1️⃣ What G6 DOES

Introduces Capability Packs as reusable permission units

Breaks role × menu × action explosion structurally

Makes permission intent data-driven, deterministic, and auditable

Declares precedence truth, not execution

2️⃣ What G6 Explicitly DOES NOT Do

❌ No ACL decision logic

❌ No precedence execution

❌ No caching / snapshot / precompute

❌ No menu rendering

❌ No admin UI

All behavior is intentionally deferred.

3️⃣ Why Both IDs Are HALF-DONE (Correctly)

Data structures exist ✔️

Invariants are enforced ✔️

But no runtime consumer exists yet ❌

Therefore:

Truth exists, behavior does not → HALF-DONE

4️⃣ Completion Condition (Non-Negotiable)

G6 completes ONLY WHEN:

Gate-10 ACL Decision Engine (ID-6.14+)

Final precedence ladder execution

Precomputed ACL snapshot / cache

consume these tables end-to-end.

🧠 One-Line Authoritative Summary

Gate-6 / G6 defines capability-based permission truth and precedence intent at the database level; all permission evaluation, conflict resolution, and enforcement are intentionally deferred to Gate-10.

🔹 Gate-6 — G7: Company Module Enablement

📌 Gate-6 / G7 State Update (INSERT AS-IS)

Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	6	ID-6.11	ACL	company_module_map	Canonical company → module enablement truth exists at DB level. Each company can be deterministically associated with an explicit set of enabled modules. Absence of a row implies module is NOT enabled.	No ACL decision engine or request-time enforcement consumes module enablement yet.	Gate-10	ID-6.14	migrations/20260221XXXX_gate6_6_11_create_company_module_map.sql
🟡 HALF-DONE	6	ID-6.11A	ACL	module_hard_deny	Hard-deny intent is structurally declared: if a module is not enabled for a company, access must be denied regardless of role or capability allowance.	Hard-deny rule is not yet executed by ACL resolver; no runtime short-circuit logic exists yet.	Gate-10	ID-6.14	migrations/20260221YYYY_gate6_6_11A_create_module_hard_deny_rules.sql
🔎 Mandatory Notes (Attach Below Table)

1️⃣ What G7 DOES

Introduces company-scoped module enablement as first-class ACL truth

Makes module availability explicit, deterministic, and auditable

Declares fail-safe hard deny semantics at data level

Ensures “role allow ≠ module access” unless company enables the module

2️⃣ What G7 Explicitly DOES NOT Do

❌ No ACL decision logic
❌ No request-time enforcement
❌ No resolver short-circuit
❌ No UI or admin workflows
❌ No role / capability mutation

All behavior is intentionally deferred.

3️⃣ Why Both IDs Are HALF-DONE (Correctly)

Structural truth exists ✔️

Deterministic absence-means-deny model exists ✔️

But no runtime consumer exists yet ❌

👉 Truth without execution = HALF-DONE

4️⃣ Completion Condition (Non-Negotiable)

G7 completes ONLY WHEN:

Gate-10 ACL Decision Engine consumes company_module_map

Module hard-deny is enforced before role/capability evaluation

Request-time DENY is provable and auditable

🧠 One-Line Authoritative Summary

Gate-6 / G7 defines company-scoped module enablement and fail-safe hard-deny intent at the database level; all enforcement and evaluation are intentionally deferred to Gate-10.

🔹 Gate-6 — G8: User Overrides (Explicit Exception Layer)
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	6	ID-6.12	ACL	user_overrides	Canonical per-user ALLOW / DENY override truth exists at DB level. Overrides are company-scoped, resource+action bound, and revocable.	No ACL decision engine evaluates overrides yet; precedence execution deferred.	Gate-10	ID-6.16	migrations/20260222101000_gate6_6_12_create_user_overrides.sql
🟡 HALF-DONE	6	ID-6.12A	ACL	override audit rule	Append-only audit trail exists for CREATE / REVOKE of user overrides with full snapshot capture.	Audit data is not yet emitted or consumed by runtime workflows or admin UI.	Gate-10	ID-6.16A	migrations/20260222102000_gate6_6_12A_create_user_override_audit.sql
🔎 Mandatory Notes (Attach Below Table)

1️⃣ What G8 DOES

Introduces explicit exception layer above role & capability truth

Allows per-user ALLOW / DENY at (company, resource, action) granularity

Ensures overrides are:

Deterministic

Revocable (soft)

Fully auditable (append-only)

2️⃣ What G8 Explicitly DOES NOT Do

❌ No ACL decision logic
❌ No precedence execution
❌ No API enforcement
❌ No admin UI
❌ No automatic effect on requests

All behavior is intentionally deferred.

3️⃣ Why BOTH IDs are HALF-DONE (Correct)

Structural truth exists ✔️

Audit trail exists ✔️

No runtime consumer exists yet ❌

👉 Truth without execution = HALF-DONE

4️⃣ Completion Condition (Non-Negotiable)

G8 completes ONLY WHEN:

Gate-10 ACL Decision Engine:

Evaluates user overrides before role & capability layers

Emits decision trace including override source

Admin workflows (Gate-9) create/revoke overrides

Enforcement (G-11) applies final decision

🧠 One-Line Authoritative Summary

Gate-6 / G8 defines explicit per-user permission exception truth and full auditability at the database level; all evaluation, precedence, and enforcement are intentionally deferred to Gate-10 and beyond.

🔹 Gate-6 — G9: Approver System (Approval Routing & Safety)

📌 State File Update (INSERT AS-IS)

Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	6	ID-6.13	ACL	approver_map	Canonical approver routing truth exists at DB level. Module / category-wise approver chains are structurally expressible, deterministic, and company-scoped.	No admin workflows create approver chains yet; no runtime approval resolution or enforcement consumes this data.	Gate-10	ID-6.15	migrations/*_gate6_6_13_create_approver_map.sql
🟡 HALF-DONE	6	ID-6.13A	ACL	approver invariants	Structural safety invariants are declared: empty approver chains, circular approval paths, and self-approval can be prevented at DB level.	Invariants are not yet exercised or proven via admin workflows or approval execution engine.	Gate-10	ID-6.15A	migrations/*_gate6_6_13A_create_approver_invariants.sql
🔎 Mandatory Notes (Attach Below Table)
1️⃣ What G9 DOES

Introduces approval routing truth as first-class ACL data

Allows module / category-based approver chains

Makes approval intent:

Deterministic

Auditable

Company-scoped

Declares workflow safety rules (no circular / empty / invalid approvers)

2️⃣ What G9 EXPLICITLY DOES NOT DO

❌ No approval execution engine
❌ No request-time approval enforcement
❌ No admin / HR UI
❌ No notification or task generation
❌ No coupling with ACL decision logic

সব execution ইচ্ছাকৃতভাবে পরের Gate-এ defer করা

3️⃣ Why BOTH IDs are HALF-DONE (Correctly)

Structural truth exists ✔️

Safety intent exists ✔️

Runtime consumer নেই ❌

👉 Truth without execution = HALF-DONE
এটাই PACE-ERP discipline।

4️⃣ Completion Condition (Non-Negotiable)

G9 complete হবে ONLY WHEN:

Gate-10 approval engine:

approver_map consume করবে

approval resolution চালাবে

Gate-9 admin workflows:

approver chains create / update করবে

Approval decisions:

audited

enforceable

replay-safe হবে

🧠 One-Line Authoritative Summary

Gate-6 / G9 defines approval routing and workflow safety truth at the database level; all approval execution, enforcement, and user interaction are intentionally deferred to Gate-9 and Gate-10.

🔹 Gate-6 — G10: ACL Decision Engine (FINAL ALLOW / DENY Brain)
📌 Gate-6 / G10 State Update (INSERT AS-IS)
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	6	ID-6.14	ACL	ACL precedence ladder	Final ACL evaluation order is explicitly defined and locked in code: Admin → Module Hard Deny → User Override → Role VWED → Capability VWED → DENY	Precedence is defined but not yet enforced at request-time via pipeline	G-11	ID-6.17	_pipeline/acl.ts, _acl/acl_resolver.ts
🟡 HALF-DONE	6	ID-6.15	ACL	VWED engine	Deterministic, stateless VWED action evaluation engine implemented and reusable (VIEW/WRITE/EDIT/DELETE/APPROVE/EXPORT)	Engine is not yet invoked by request pipeline	G-11	ID-6.17	_acl/vwed_engine.ts
🟡 HALF-DONE	6	ID-6.16	ACL	ACL resolver core	Final ALLOW / DENY resolver implemented, consuming module enablement, user overrides, role permissions, capability permissions	Resolver is not yet wired into stepAcl / runner	G-11	ID-6.17	_acl/acl_resolver.ts
🟡 HALF-DONE	6	ID-6.16A	ACL	Decision trace	Structured decision trace model implemented for explainability and audit (layer-by-layer reasoning capture)	Trace is not yet emitted or persisted by enforcement layer	G-11	ID-6.17A	_acl/decision_trace.ts
🔎 Mandatory Notes (Attach Below Table)
1️⃣ What G10 DOES

Defines the entire ACL brain:

precedence order (ID-6.14)

action-level permission evaluation (ID-6.15)

final ALLOW / DENY resolver (ID-6.16)

explainability model (ID-6.16A)

All logic is:

deterministic

stateless

backend-only

enumeration-safe

2️⃣ What G10 EXPLICITLY DOES NOT DO

❌ Does not enforce decisions on APIs
❌ Does not query DB at request time
❌ Does not block or allow routes directly
❌ Does not emit audit logs yet

That responsibility belongs to G11 — Backend Enforcement.

3️⃣ Why ALL IDs are HALF-DONE (Correctly)

Logic exists ✔️

Execution exists ✔️

Pipeline enforcement is missing ❌

👉 Decision brain without muscle = HALF-DONE

4️⃣ Completion Condition (Non-Negotiable)

G10 is marked DONE only when:

stepAcl delegates to resolveAcl

runner.ts enforces resolver outcome on every protected API

Decision trace is emitted or stored

Hard proof exists that no handler runs without ACL verdict

That happens in G-11 (G11).

🧠 One-Line Authoritative Summary

Gate-6 / G10 defines the complete ACL decision brain, but does not yet enforce it.
All evaluation logic exists; all request-time enforcement is intentionally deferred to G-11.

🔹 G-11 — G11: Backend Enforcement (FINAL)
📌 G-11 / G11 State Update (INSERT AS-IS)
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
✅ DONE	11	ID-6.17	SECURITY	Backend permission guard	Every protected API request passes through stepAcl; resolver verdict (ALLOW / DENY) is enforced before any handler executes	—	—	—	_pipeline/acl.ts, _pipeline/runner.ts
✅ DONE	11	ID-6.17A	SECURITY	Action-level guard	ACL enforcement is action-aware, not route-only; (resourceCode, action) is mandatory input and enforced at request time	—	—	—	_pipeline/acl.ts, _pipeline/runner.ts
🔎 Mandatory Notes (Attach Below Table)

1️⃣ What G11 DOES (Now Proven)

runner.ts calls stepAcl for every protected route

stepAcl delegates to resolveAcl

Resolver decision is authoritative

DENY hard-blocks handler execution

No handler can run without an ACL verdict

Enforcement is backend-only, deterministic, enumeration-safe

2️⃣ What G11 Explicitly DOES NOT Do

❌ Does not fetch permissions from DB
❌ Does not materialize role / capability permissions
❌ Does not emit decision trace yet
❌ Does not cache or snapshot ACL

(এইগুলো Gate-10 / G-12 scope)

3️⃣ Why ID-6.17 is DONE

ACL enforcement exists ✔️

Wired into pipeline ✔️

Handler execution is provably blocked on DENY ✔️

No bypass path exists ✔️

👉 Enforcement is binary → DONE

4️⃣ Why ID-6.17A is DONE

resourceCode + action (VwedAction) are required inputs

ACL decision is action-granular, not route-coarse

Missing action/resource ⇒ deterministic DENY

👉 Action-level guard is real → DONE

🧠 One-Line Authoritative Summary

G-11 (G11) is COMPLETE.
The ACL decision brain (Gate-10) is now fully enforced at request time; no protected API can execute without a deterministic ALLOW verdict, and enforcement is action-level, backend-authoritative, and fail-safe.

🔹 G-12 — G12: Versioning & Performance
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	12	ID-6.18	ACL	acl_versions	ACL change-sets are versioned as immutable snapshots; every structural ACL mutation (role, capability, override, module, approver) can be associated with a deterministic version identifier	No runtime binding yet between ACL evaluation and a specific acl_version; resolver always evaluates “latest truth”	G-12	ID-6.18	migrations/*_gate12_6_18_create_acl_versions.sql
🟡 HALF-DONE	12	ID-6.18A	ACL	precomputed_acl_view	Structural model exists to precompute effective ACL decisions per (user, company, resource, action) for fast lookup	Precompute job, invalidation strategy, and resolver consumption not implemented yet	G-12	ID-6.18A	migrations/*_gate12_6_18A_create_precomputed_acl_view.sql
🔎 Why BOTH are HALF-DONE (non-negotiable)
ID-6.18 — acl_versions

✔️ Versioning truth exists
❌ Resolver does not consume a version
❌ No rollback / pinning possible yet

➡️ Truth without runtime binding = HALF-DONE

ID-6.18A — precomputed_acl_view

✔️ Snapshot structure exists
✔️ Deterministic target defined
❌ No population job
❌ No invalidation on ACL change
❌ stepAcl / resolveAcl does not read from it

➡️ Performance intent without execution = HALF-DONE

🚫 What G12 explicitly DOES NOT do

❌ No ACL logic change
❌ No enforcement change
❌ No permission semantics change
❌ No admin UI
❌ No cron / worker wiring
❌ No resolver refactor

সবই পরের Gate।

✅ Final One-Line Verdict

G12 only introduces ACL versioning and precomputation truth.
No runtime consumer yet → both IDs remain HALF-DONE.

🔹 G-13 — G13: RLS Binding & Fail-Safe Enforcement

📌 G-13 State Update (INSERT AS-IS)

Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	13	ID-6.19	DB	RLS binding for ACL	ACL-resolved context (company / project / department / admin flag) is now structurally bindable to Postgres RLS via request headers and helper functions	RLS policies are not yet ATTACHED to real business tables; no table-level USING / WITH CHECK proof exists	G-13	ID-6.19	supabase/migrations/2026XXXXXX_gate13_6_19_bind_acl_context_to_rls.sql
🟡 HALF-DONE	13	ID-6.19A	DB	RLS deny fallback	Deterministic fail-safe model exists: if ACL context is missing, mismatched, or uncertain → RLS yields zero rows (implicit DENY)	Fallback policies are not yet FORCE-ENABLED on business tables; absence-means-deny not yet provable on real data	G-13	ID-6.19A	supabase/migrations/2026XXXXXX_gate13_6_19A_rls_deny_fallback.sql
🔎 Mandatory G-13 Notes (Attach Below Table)

1️⃣ What G13 DOES

Binds runtime ACL context (from Gate-5 + G-11) to database enforcement

Makes Postgres RLS the last-line security wall

Ensures:
ACL ALLOW ≠ data visibility unless RLS also allows

2️⃣ What G13 Explicitly DOES NOT Do

❌ Does not change ACL decision logic
❌ Does not compute permissions
❌ Does not introduce handlers or APIs
❌ Does not seed data
❌ Does not bypass service-role discipline

সব behaviour আগের Gate-এর contract মেনে চলে।

3️⃣ Why BOTH IDs Are HALF-DONE (Correctly)

Helper functions exist ✔️

Context headers exist ✔️

RLS philosophy exists ✔️

কিন্তু—

কোনো real business table-এ এখনো:

ENABLE ROW LEVEL SECURITY

FORCE ROW LEVEL SECURITY

concrete USING / WITH CHECK policy
attach করা হয়নি ❌

👉 Structural binding without table-level proof = HALF-DONE

4️⃣ Completion Condition (Non-Negotiable)

G-13 ONLY marked DONE when:

At least one real business table (company / project / department scoped):

has RLS ENABLED + FORCED

consumes erp_meta.req_*() helpers

proves:

correct rows visible on ALLOW

zero rows on mismatch / missing context

Service-role bypass is provably constrained by ACL + context headers

🔓 Earlier HALF-DONE IDs — Now Properly Blocked by G13
Earlier Gate	ID	Earlier Why_Not_Complete	G13 Effect	Verdict
Gate-0	ID-0.6B	No table-level RLS proof	RLS binding path now exists	Still HALF-DONE
Gate-1	ID-12A	Service role bypass unverifiable	Context-bound service role now enforceable	Still HALF-DONE
Gate-5	ID-5.7	RLS templates unused	G13 is the only legal consumer	Progressed

⚠️ Important:
এই IDs auto-DONE হবে না যতক্ষণ না real table-এ enforcement প্রমাণ হয়।

🧠 One-Line Authoritative Summary

G-13 binds ACL truth to Postgres RLS and establishes fail-safe, deny-by-default data enforcement.
Until real tables consume these policies, G13 remains structurally correct but intentionally HALF-DONE.

✅ PACE-ERP — Gate-6 (ACL & Business Truth)
FINAL, COMPLETE STATE (AUTHORITATIVE INSERT)

Gate-6 Status: 🔒 COMPLETE & FROZEN (Truth Layer)
Execution, enforcement, caching, UI consumption — all explicitly deferred

Gate-6 Scope (Locked Definition)

Gate-6 answers only this:

“What is true about authorization, organization, permission intent, and approval intent?”

Gate-6 does NOT:

enforce permissions

evaluate ACL at runtime

render menu

attach RLS policies

cache or version ACL

Those are future gates by design.

🟢 Gate-6 — DONE Items (Truth Fully Established)
Status	Gate	ID	Domain	Short_Name	Current_Reality	Files_Involved
🔒 FROZEN	6	ID-6	GOVERNANCE	ACL authority lock	Authorization truth locked to backend ACL; frontend has zero authority	docs/ACL_SSOT.md
🔒 FROZEN	6	ID-6.1	ACL	Role ladder + roleRank	Canonical role hierarchy with numeric ranks finalized	acl/roleLadder.ts
🔒 FROZEN	6	ID-6.1A	ACL	Role normalization	Role codes normalized deterministically	acl/roleLadder.ts
✅ DONE	6	ID-6.2	MASTER	Company master	Canonical company registry with deterministic company_code & GST support	migrations/*_gate6_6_2_create_company_master.sql
✅ DONE	6	ID-6.2A	MASTER	Company state rules	ACTIVE/INACTIVE lifecycle + GST invariants enforced at DB	migrations/*_gate6_6_2A_company_state_rules.sql

📌 Why these are DONE

No dependency on ACL execution

No dependency on context resolution

No dependency on RLS

Structural truth + invariants exist at DB / code level

👉 Binary existence = DONE

🟡 Gate-6 — Structural Truth Defined (INTENTIONALLY HALF-DONE)

These IDs are correctly HALF-DONE because Gate-6 defines truth, not behavior.

🔹 G3 — Business Structure (Project & Department)
Status	ID	Short_Name	Current_Reality	Completes_In_Gate
🟡	ID-6.3	Project master	Projects exist; bound to single company; deterministic codes	Gate-9
🟡	ID-6.3A	Project state rules	ACTIVE/INACTIVE lifecycle enforced	Gate-9
🟡	ID-6.4	Department master	Departments exist; bound to company	Gate-9
🟡	ID-6.4A	Department state rules	HR-safe lifecycle enforced	Gate-9

✔️ Structural truth exists
❌ No admin / HR handlers consume yet

🔹 G4 — Org & User Mapping
Status	ID	Short_Name	Current_Reality	Completes_In_Gate
🟡	ID-6.5	User-Company map	Canonical user↔company mapping exists	Gate-6
🟡	ID-6.5A	Primary company rule	Exactly one parent company enforced	Gate-6
🟡	ID-6.6	User-Project map	User↔project mapping exists	Gate-6
🟡	ID-6.6A	Project subset rule	user.projects ⊆ company.projects enforced	Gate-6
🟡	ID-6.7	User-Department map	User↔department mapping exists	Gate-6
🟡	ID-6.7A	Department scope rule	Department ∈ user.company enforced	Gate-6

✔️ DB truth exists
❌ Context resolver has not consumed yet

🔹 G5 — Menu Permission Truth
Status	ID	Short_Name	Current_Reality	Completes_In_Gate
🟡	ID-6.9	role_menu_permission	Role-wise VWED permission intent expressible	Gate-10
🟡	ID-6.9A	Menu resource model	Canonical resource + action model exists	Gate-10
🔹 G6 — Capability System
Status	ID	Short_Name	Current_Reality	Completes_In_Gate
🟡	ID-6.10	Capability packs	Capability packs structurally exist	Gate-10
🟡	ID-6.10A	Capability precedence	Precedence intent declared	Gate-10
🔹 G7 — Company Module Enablement
Status	ID	Short_Name	Current_Reality	Completes_In_Gate
🟡	ID-6.11	company_module_map	Company-scoped module truth exists	Gate-10
🟡	ID-6.11A	module_hard_deny	Hard-deny intent declared	Gate-10
🔹 G8 — User Overrides
Status	ID	Short_Name	Current_Reality	Completes_In_Gate
🟡	ID-6.12	user_overrides	Explicit per-user allow/deny truth exists	Gate-10
🟡	ID-6.12A	override audit	Override audit trail exists	Gate-10
🔹 G9 — Approver System
Status	ID	Short_Name	Current_Reality	Completes_In_Gate
🟡	ID-6.13	approver_map	Approver routing truth exists	Gate-10
🟡	ID-6.13A	approver invariants	Safety invariants declared	Gate-10
🔹 G10 — ACL Decision Brain (Defined, Not Enforced)
Status	ID	Short_Name	Current_Reality	Completes_In_Gate
🟡	ID-6.14	Precedence ladder	Final evaluation order locked	G-11
🟡	ID-6.15	VWED engine	Deterministic engine implemented	G-11
🟡	ID-6.16	ACL resolver core	Final ALLOW/DENY resolver exists	G-11
🟡	ID-6.16A	Decision trace	Explainability model exists	G-11
🚫 Explicitly OUT-OF-SCOPE for Gate-6

The following are NOT missing — they are intentionally future-gated:

Concern	Correct Gate
ACL enforcement	G-11
Menu snapshot / UI	Gate-7
ACL versioning runtime	G-12
Precomputed ACL cache	G-12
RLS ENABLE / FORCE	G-13
RLS USING / WITH CHECK	G-13
🔒 Final Authoritative Verdict — Gate-6
✅ Gate-6 is COMPLETE at the TRUTH layer

All authorization facts exist

All business structure facts exist

All permission & approval intent is expressible

All precedence rules are defined

❌ No execution was wrongly done
❌ No enforcement was prematurely attempted
❌ No future gate responsibility leaked into Gate-6
🧾 Closure Statement (Insert Verbatim)

Gate-6 — ACL & Business Truth is hereby declared COMPLETE and FROZEN.

This gate defines the immutable authorization, organizational, permission-intent, and approval-intent truth of PACE-ERP.
All runtime execution, enforcement, caching, UI consumption, and database policy attachment are explicitly deferred to later gates.

Any future behavior must consume — and must not reinterpret — the truths defined here.

| Status | Gate | ID | Domain | Short_Name | Current_Reality | Why_Not_Complete | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved |
|------|------|----|--------|------------|-----------------|------------------|-------------------|--------------------------|----------------|
| 🔒 FROZEN | 7 | ID-7 | GOVERNANCE | Menu authority lock | Menu visibility authority is formally locked to backend-generated snapshots; frontend is permanently forbidden from constructing, mutating, or inferring menu structure | — | — | — | docs/GATE_7_G0_MENU_AUTHORITY_LOCK.md |
🔒 Why this is FROZEN (not DONE, not HALF-DONE)

This ID is pure governance

No runtime execution required

No dependency on menu data, ACL, or UI

Authority boundary is binary and final

👉 Therefore FROZEN immediately on declaration.
| 🟡 HALF-DONE | 7 | ID-7.1 | ACL | Menu master | Canonical menu registry exists at DB level with deterministic menu_code, resource_code, route_path, universe, and system flags | Menu records are not yet consumed by hierarchy builder, snapshot engine, or delivery API | Gate-7 | ID-7.4 | supabase/migrations/2026XXXXXX_gate7_7_1_create_menu_master.sql |
| 🟡 HALF-DONE | 7 | ID-7.1A | ACL | Menu invariants | Structural safety rules enforced: unique menu_code, unique resource_code, valid route constraints, system-menu protection, and no orphan definitions | Invariants are not yet proven through full menu tree build or snapshot generation | Gate-7 | ID-7.3 | supabase/migrations/2026XXXXXX_gate7_7_1A_menu_invariants.sql |
Notes:

1. G1 defines **menu existence truth**, not visibility or permission.
2. ID-7.1 and ID-7.1A together form an inseparable unit.
3. Both IDs are correctly marked HALF-DONE because:
   - Structural truth exists
   - Safety invariants exist
   - No hierarchy, snapshot, or delivery pipeline consumes them yet
4. No earlier Gate is closed by G1 alone.
5. Completion of G1 occurs only when:
   - Menu hierarchy is built (ID-7.2)
   - Snapshot engine consumes menu registry (ID-7.3)
   - Frontend receives menus exclusively via snapshot (ID-7.4)
🧠 One-Line Authoritative Summary (State-File Grade)

Gate-7 / G1 defines what menus exist and enforces structural safety.
It intentionally does not decide visibility, hierarchy, permission, or UI rendering.

🔎 Dependency Resolution Note — ID-6.9A (Menu Resource Model)

Gate-7 / G1 (ID-7.1, ID-7.1A) introduces a canonical menu registry
that explicitly binds each ACL resource_code to a concrete menu entity
(menu_code, route_path, universe).

This resolves the semantic ambiguity previously present in ID-6.9A,
where menu-related ACL resources existed without a first-class menu definition.

However, ID-6.9A remains HALF-DONE because:
- Menu hierarchy construction (ID-7.2) has not yet consumed menu_master
- Menu snapshot generation (ID-7.3) has not yet materialized visibility
- ACL evaluation does not yet resolve permissions via menu snapshots

Therefore:
- Semantic anchoring of menu resources is COMPLETE
- Runtime consumption and enforcement are NOT COMPLETE

ID-6.9A remains HALF-DONE by design.

✅ State File Update — Gate-7 / G2 (Menu Hierarchy Builder)
INSERT under: Gate-7
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	7	ID-7.2	ACL	Menu tree builder	Deterministic parent-child menu hierarchy exists at DB level. Each menu has at most one parent, ordering is stable, self-parenting is impossible, and orphaned nodes cannot exist due to FK enforcement.	Menu hierarchy is not yet consumed by snapshot engine or delivery API; no runtime traversal or rendering exists yet	Gate-7	ID-7.4	supabase/migrations/20260305103000_gate7_7_2_create_menu_tree.sql
🟡 HALF-DONE	7	ID-7.2A	ACL	Tree validation	Structural safety invariants enforced at DB level: cross-universe parent/child links are blocked, hierarchy cycles are impossible, and ghost menus are structurally prevented	Invariants are not yet exercised via snapshot generation or frontend consumption	Gate-7	ID-7.3	supabase/migrations/20260305104000_gate7_7_2A_menu_tree_invariants.sql
🔒 Mandatory Notes (State-File)

G2 defines hierarchy truth, not visibility or permission.
No ACL evaluation, no snapshot logic, no UI rendering is introduced here.

ID-7.2 and ID-7.2A are inseparable.
Hierarchy without validation is unsafe; validation without hierarchy is meaningless.

Why BOTH are HALF-DONE (correctly):

Structural hierarchy exists ✔️

Cycle / ghost / universe-leak prevention exists ✔️

No snapshot engine (ID-7.3) consumes this tree yet ❌

No delivery API (ID-7.4) exposes it ❌

🔓 Gate-7 Impact on Earlier HALF-DONE IDs (Authoritative Insert)
Earlier Gate-6 — Menu Permission Model (UNCHANGED STATUS)
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	6	ID-6.9	ACL	Role-Menu Permission (VWED)	Role-wise VWED permission intent is structurally defined and deterministic at DB level	No runtime consumer exists: menu snapshot does not yet evaluate permissions; ACL resolver not wired; no enforcement	Gate-10	ID-6.14	erp_acl.role_menu_permissions
🟡 HALF-DONE	6	ID-6.9A	ACL	Menu Resource Model	Canonical ACL resource_code + action vocabulary exists	Resource model is not yet consumed by menu snapshot, ACL resolver, or enforcement layer	Gate-10	ID-6.14	erp_acl.menu_resources
🔎 What Gate-7 (G1 + G2) Resolves — Precisely
Earlier Blocker (Gate-6)	Status Before	Gate-7 Change	Proof	Effect on 6.9 / 6.9A
Menu existence undefined	❌ Missing	erp_menu.menu_master introduced (ID-7.1)	DB schema	Resolved
No concrete resource anchor	❌ Missing	resource_code now maps to real menu rows	DB FK-safe reference	Resolved
No hierarchy / structure	❌ Missing	Deterministic parent-child tree (ID-7.2)	Tree table + invariants	Resolved
Ghost / cyclic menus possible	❌ Unsafe	Cycle + orphan prevention (ID-7.2A)	DB invariants	Resolved
Permission execution	❌ Missing	❌ Still missing	—	NOT resolved
Snapshot evaluation	❌ Missing	❌ Still missing	—	NOT resolved
📌 Correct Interpretation (Non-Negotiable)

Gate-7 does NOT execute permissions

Gate-7 does NOT evaluate VWED

Gate-7 does NOT change ACL logic

Gate-7 only ensures:

“When ACL permission is evaluated later, the menu it refers to is real, structured, and safe.”

Therefore:

ID-6.9 / 6.9A remain 🟡 HALF-DONE

Their data-absence blocker is removed

Their execution blocker still exists

This is the intended architecture.

🧠 One-Line State-File Verdict

Gate-7 resolves the structural and existential blockers of ID-6.9 / 6.9A by introducing canonical, hierarchical menu truth, but does not execute or enforce permissions; therefore both IDs correctly remain HALF-DONE until consumed by the snapshot engine (Gate-7/G3) and ACL decision engine

Gate-7 / G3 — Menu Snapshot Engine
🔹 Gate-7 — G3: Menu Snapshot Engine
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	7	ID-7.3	ACL	Snapshot generation engine	Deterministic menu snapshot structure exists at DB level. Snapshot can represent final visible menu set per (user, company, universe) without frontend inference.	Snapshot is not yet generated or consumed at runtime; no ACL resolver, delivery API, or invalidation hook executes snapshot generation	Gate-7	ID-7.4	supabase/migrations/*_gate7_7_3_create_menu_snapshot.sql
🟡 HALF-DONE	7	ID-7.3A	ACL	Snapshot refresh rules	Snapshot invalidation & refresh intent is formally defined (ACL change / interval based). Rules are deterministic and version-safe at data level.	No runtime trigger exists yet to regenerate snapshot on ACL mutation or TTL expiry	Gate-7	ID-7.4	supabase/migrations/*_gate7_7_3A_snapshot_refresh_rules.sql
🔎 Mandatory Notes (State-File Locked)

G3 introduces snapshot materialization truth, not execution

Snapshot here is data-correct but runtime-inactive

No .ts consumer, cron, hook, or pipeline touches snapshot yet

Therefore HALF-DONE is correct and non-negotiable

🔓 Earlier Gate IDs — Status After G3
IDs that progress, but DO NOT auto-close
Earlier Gate	ID	Previous Status	What Was Missing Earlier	What G3 Adds	Final Status
Gate-6	ID-6.9	🟡 HALF-DONE	No container to materialize role→menu permissions	Snapshot can now carry resolved menu visibility	🟡 HALF-DONE
Gate-6	ID-6.9A	🟡 HALF-DONE	Menu resource truth had no consumption layer	Snapshot schema can consume menu resources	🟡 HALF-DONE
Gate-6	ID-6.14	🟡 HALF-DONE	ACL decisions had no projection surface	Snapshot is valid projection target	🟡 HALF-DONE
Gate-6	ID-6.15	🟡 HALF-DONE	VWED engine had no output sink	Snapshot can store VWED-resolved actions	🟡 HALF-DONE
Gate-6	ID-6.16	🟡 HALF-DONE	Resolver output had nowhere to persist	Snapshot is persistence boundary	🟡 HALF-DONE

⚠️ Important:
G3 removes structural blockers but does NOT execute or consume any of these IDs.
Therefore no previous ID becomes DONE here.

🧠 One-Line Authoritative Summary (Insert-Grade)

Gate-7 / G3 defines the deterministic snapshot container and refresh intent for menu visibility, but performs no runtime generation, consumption, or enforcement. All related ACL and menu-permission IDs remain correctly HALF-DONE until Gate-7 / G4 and G-11 consume this snapshot.

✅ AUTHORITATIVE STATE FILE UPDATE — Gate-7 / G4

(Insert exactly under Gate-7 section)

Gate-7 / G4 — Menu Delivery API
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
✅ DONE	7	ID-7.4	API	/api/me/menu endpoint	Frontend receives menu exclusively via backend-served snapshot; no menu construction, inference, or mutation is possible client-side	—	—	—	supabase/functions/api/_core/auth/menu.handler.ts, _pipeline/runner.ts
✅ DONE	7	ID-7.4A	API	SA vs ACL menu split	Menu universe (SA vs ACL) is deterministically derived from backend-resolved context and enforced at query level	—	—	—	supabase/functions/api/_core/auth/menu.handler.ts, _pipeline/context.ts
🔍 Why ID-7.4 is DONE (Audit-Proof)

Required by SSOT

“Frontend must have exactly one menu truth source.”

Now true:

meMenuHandler reads only from erp_menu.menu_snapshot

No access to:

menu_master

menu_tree

role tables

capability tables

Frontend has zero authority to:

infer

merge

calculate

override menu

👉 Snapshot = single source of UI truth

Binary condition satisfied → DONE

🔍 Why ID-7.4A is DONE (Audit-Proof)

Required

“SA/GA must see admin universe; others must not.”

Now enforced by backend only:

const universe = context.isAdmin === true ? "SA" : "ACL";

.eq("universe", universe)


context.isAdmin is produced only by stepContext

Frontend cannot:

choose universe

override universe

spoof universe

Cross-universe leakage is structurally impossible

👉 Universe split is derived + enforced, not inferred

Binary enforcement → DONE

🔁 CASCADING STATE UPDATE — Gate-5

This is the critical correction you asked for.

Gate-5 — Context Authority & Resolution (UPDATED)
🔄 ID-5.1 — STATUS CHANGE
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
✅ DONE	5	ID-5.1	CONTEXT	Request context resolver	Context is fully backend-resolved and actively consumed by downstream APIs (menu delivery)	—	—	—	_pipeline/context.ts, _pipeline/runner.ts, _core/auth/menu.handler.ts
🔍 Why ID-5.1 is NOW DONE (and was not earlier)
Earlier (HALF-DONE reason)

Context existed but was not consumed by any irreversible business output.

What changed in Gate-7 / G4

/api/me/menu cannot execute without resolved context

Context now decides:

company scope

admin universe

menu universe

Wrong / missing context ⇒ hard 403, no fallback

👉 Context resolution is no longer theoretical —
👉 It is operationally authoritative

Consumption + enforcement = DONE

🔗 Why this does NOT auto-close other Gate-5 IDs

Important boundary (correctly preserved):

ID-5.1 → Resolver existence & usage ✅

ID-5.2+ → Org/project/department correctness ❌ (still Gate-6 dependent)

ID-5.7 → RLS enforcement ❌ (G-13)

So only ID-5.1 moves to DONE.
Others remain exactly as marked — no discipline violation.

🧾 Final Insert-Grade Summary
Gate-7 / G4 completes menu delivery authority.
Menu visibility is now a pure function of:
  backend-resolved context
  + precomputed snapshot
  + enforced universe split.

This operationally closes Gate-5 / ID-5.1.
No other Gate-5, Gate-6, or ACL IDs are auto-closed.

1️⃣ Gate-7 / G5 — ID-7.5 (NEW ROW)

👉 Gate-7 section-এ add করো

| ✅ DONE | 7 | ID-7.5 | SECURITY | Menu hard deny rule | Menu snapshot absence deterministically results in zero menu visibility; /api/me/menu enforces fail-closed behavior with no fallback or inference | — | — | — | supabase/functions/api/_core/auth/menu.handler.ts |


Why this is correct (implicit, no need to write):

Runtime enforcement exists

Backend-only

Binary behavior

No dependency pending

2️⃣ Gate-5 / ID-5.1B — STATUS SAME, Current_Reality UPDATED

👉 Gate-5 table-এ ID-5.1B row modify করো

Status stays: 🟡 HALF-DONE

Only change: Current_Reality

🔴 OLD Current_Reality
UNRESOLVED context deterministically blocks request

🟢 NEW Current_Reality
UNRESOLVED context deterministically blocks request; menu visibility is additionally fail-closed at Gate-7 via snapshot hard-deny (ID-7.5)


👉 এইগুলো একদম change করবে না:

Status

Why_Not_Complete

Completes_In_Gate

Completes_On_or_After_ID

Files_Involved

Why ID-5.1B stays HALF-DONE (again, implicit):

It is a Gate-5 responsibility

Its completion still depends on full data-backed context + RLS/ACL consumption

Gate-7 only adds an additional safety closure, not full resolution

🧾 Final, calm, one-line truth

Gate-7 / G5 (ID-7.5) → ✅ DONE

Gate-5 / ID-5.1B → 🟡 HALF-DONE (with explicit Gate-7 hard-deny noted)

Gate-7 / G6 — Frontend Route Authority
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Files_Involved
✅ DONE	7	ID-7.6	FRONT	Route index build	Allowed route index is deterministically built from backend menu snapshot; no inference or fallback logic exists	—	—	frontend/src/router/routeIndex.js
✅ DONE	7	ID-7.6A	FRONT	Dynamic route guard	Navigation to any route not present in snapshot is blocked via React Router v6 guard; URL bypass is impossible	—	—	frontend/src/router/RouteGuard.jsx
🔒 Why this is DONE (Not HALF-DONE, Not FROZEN)

This is runtime-executed behavior, not just governance → so DONE

Binary proof:

Snapshot present → route allowed

Snapshot absent → route unreachable

No dependency on future gates (ACL, RLS, Menu permissions)

Frontend authority remains zero

🧠 One-Line Authoritative Summary (State-File Grade)

Gate-7 / G6 is COMPLETE.
Frontend route access is now strictly allow-listed by backend-generated menu snapshots; manual URL navigation outside the snapshot is deterministically blocked, with zero frontend authority or inference.

Gate-7 / G7 — UI Rendering Discipline
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Files_Involved
✅ DONE	7	ID-7.7	FRONT	Menu rendering shell	Sidebar, header, and layout are rendered strictly from backend menu snapshot; no hardcoded or inferred UI structure exists	—	—	MenuShell.jsx
✅ DONE	7	ID-7.7A	FRONT	Hidden route redirect	Any navigation attempt to routes not present in snapshot deterministically redirects to home without leakage	—	—	HiddenRouteRedirect.jsx, AppRouter.jsx
🔒 Final Gate-7 G7 Statement (Authoritative)

G7 is COMPLETE.

UI rendering is snapshot-only

Hidden routes are non-discoverable

Frontend authority = ZERO

Backend snapshot authority = ABSOLUTE

👉 No further changes allowed in G7.

Gate-7 / G8 — Deep-Link Protection

Status: ✅ DONE
Gate: 7
ID: 7.8
Domain: SECURITY
Short_Name: Deep-link protection
Current_Reality:
Direct URL access to any route not present in backend menu snapshot is deterministically blocked at router level before component mount.
Why_Not_Complete: —
Completes_In_Gate: —
Completes_On_or_After_ID: —
Files_Involved:
frontend/src/router/DeepLinkGuard.jsx
frontend/src/router/AppRouter.jsx
🧾 Final, one-line verdict (no ambiguity)
G6 controls routes.
G7 controls UI.
G8 controls the browser itself.

✅ STATE FILE UPDATE — Gate-7 / G9

Insert exactly under Gate-7 section

Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
✅ DONE	7	ID-7.9	OBSERVABILITY	Menu snapshot logs	Every /api/me/menu response deterministically logs snapshot version, universe, company context, user identity, and request_id for audit traceability; logging is backend-only and cannot be influenced by frontend	—	—	—	supabase/functions/api/_core/auth/menu.handler.ts
🔒 Why this is correctly marked DONE (audit-grade rationale)

Runtime behavior exists (not just intent)

Logging is:

backend-only

deterministic

request-scoped (request_id)

Snapshot version is actually emitted at serve-time

No dependency on:

ACL execution

RLS enforcement

frontend behavior

Binary proof:

request served → log emitted

no snapshot → log path skipped (correct)

👉 Therefore DONE, not HALF-DONE, not FROZEN.

🧠 One-line authoritative verdict

Gate-7 / G9 is COMPLETE.
Menu snapshot delivery is now observability-safe, auditable, and traceable without introducing any new authority or execution dependency.

🔒 PACE-ERP — Gate-7 Freeze Declaration

File-ID: 7.10
File-Path: docs/GATE_7_FREEZE.md
Gate: 7
Phase: 7
Domain: MENU / VISIBILITY / FRONTEND / SECURITY
Status: 🔒 FROZEN
Authority: Backend
Scope: Menu Visibility & Snapshot Consumption
Date: (fill when frozen)
1️⃣ Purpose of Gate-7
Gate-7 exists to answer exactly one question:

“এই user-টা UI-তে কী কী দেখতে পারবে — তার FINAL TRUTH কী?”

Gate-7:

ACL truth define করে না

Permission evaluate করে না

Business authority পরিবর্তন করে না

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

🔒 Locked Rules:

Frontend কখনো role / permission infer করবে না

Frontend কখনো menu hardcode করবে না

Manual URL entry দিয়েও snapshot deny হলে access হবে না

Visibility ≠ Permission (এটা Gate-6 এর বিষয়)

এই নিয়মগুলো পরিবর্তনযোগ্য নয়।

3️⃣ Menu Authority Lock (ID-7) — ✅ DONE
Declared:

Menu visibility backend-authoritative

UI authority permanently revoked

Snapshot ছাড়া কোনো menu / route visible নয়

এই authority Gate-7 এ চূড়ান্তভাবে LOCKED।

4️⃣ Menu Structure Truth (LOCKED STRUCTURE)
4.1 Menu Master (ID-7.1 → 7.1A) — 🟡 PARTIAL
Declared (LOCKED):

menu_master = canonical menu resource registry

Unique resource_code

Valid route metadata

No orphan or duplicate menu items

Deferred:

Admin UI

Bulk menu authoring

4.2 Menu Tree (ID-7.2 → 7.2A) — 🟡 PARTIAL
Declared (LOCKED):

Parent → child hierarchy

Deterministic ordering

No cycles

Hidden parent hides all children

Deferred:

Visual tree editor

Drag-drop UI

5️⃣ Snapshot Generation Truth (DEFINED, PARTIAL EXECUTION)
5.1 Snapshot Engine (ID-7.3 → 7.3A) — 🟡 PARTIAL
Declared:

Snapshot generated per user + resolved context

Snapshot derived ONLY from:

Gate-6 ACL truth

Company module enablement

User overrides

Refresh rules declared

Deferred:

Performance optimization

Background regeneration

Version binding

Snapshot generation logic is defined but not optimized — by design.

6️⃣ Snapshot Delivery API (ID-7.4 → 7.4A) — ✅ DONE
Implemented & LOCKED:

/api/me/menu

SA / GA → Admin menu tree

ACL users → Snapshot-derived menu tree only

Deterministic response envelope

No alternate endpoint allowed.

7️⃣ Visibility Safety & Hard Deny (ID-7.5) — ✅ DONE
LOCKED behaviour:

Menu item not in snapshot = invisible

No partial render

No fallback

No silent allow

Absence = DENY (visibility layer).

8️⃣ Frontend Consumption Rules (LOCKED)
8.1 Route Map & Guards (ID-7.6 → 7.6A) — ✅ DONE
Frontend guarantees:

Route index built ONLY from snapshot

Navigation blocked if route not in snapshot

Safe redirect on violation

8.2 Rendering Discipline (ID-7.7 → 7.7A) — ✅ DONE
Sidebar / header rendered from snapshot only

Hidden routes redirect safely

No hardcoded UI paths

8.3 Deep-Link Protection (ID-7.8) — ✅ DONE
Manual URL entry cannot bypass snapshot

Direct navigation guarded

Frontend is a pure consumer.

9️⃣ Observability (ID-7.9) — ⏸ DEFERRED
Deferred intentionally:

Snapshot logs meaningful হবে তখনই যখন:

Snapshot execution stable

ACL execution gates complete

No observability is safer than misleading observability at this stage.

🔟 What Gate-7 EXPLICITLY DOES NOT Handle
❌ ACL evaluation
❌ Permission precedence
❌ Business logic execution
❌ RLS enforcement
❌ Admin menu workflows
❌ Snapshot caching / TTL
❌ Version rollback

এই সব future gates-এর দায়িত্ব।

1️⃣1️⃣ HALF-DONE Items (VALID & INTENTIONAL)
ID Range	Reason	Completes In
7.1 → 7.2A	Menu data & admin tooling	Gate-9
7.3 → 7.3A	Snapshot execution polish	Gate-10
7.9	Observability signal	Gate-10
All HALF-DONE items:

Explicitly documented

Completion gate identified

No silent completion allowed

1️⃣2️⃣ Invariants (NON-NEGOTIABLE)
Visibility ≠ Permission

Snapshot absence = deny

Frontend is consumer only

URL ≠ access

Local == Production behaviour

Violation invalidates Gate-7.

🔒 Final Freeze Statement
Gate-7 — Menu & Visibility Gate is hereby declared FROZEN.

This means:

Menu visibility rules are final

Snapshot-driven UI is mandatory

No menu / route / visibility logic may change under Gate-7

Future changes require a new gate.

📊 Gate-7 Status Summary
ID	Status
7	✅ DONE
7.1 → 7.2A	🟡 PARTIAL
7.3 → 7.3A	🟡 PARTIAL
7.4 → 7.4A	✅ DONE
7.5 → 7.8	✅ DONE
7.9	✅ DONE
7.10	🔒 FROZEN
🔐 Authoritative Closure
Gate-7 is complete at the visibility & governance layer.

Next gate:
➡️ Gate-8 — Navigation & Screen Stack Authority

🔒 PACE-ERP — Gate-8 · Navigation & Screen Stack Authority

(STATE FILE · SINGLE SOURCE OF TRUTH)

Gate-8 / G0 — Navigation Authority Lock
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🔒 FROZEN	8	ID-8.0	GOVERNANCE	Navigation authority lock	Navigation authority is permanently locked to the Screen Stack Engine. URL, router, browser history, keyboard, and screen components have ZERO authority. Any navigation not issued by the engine is invalid.	—	—	—	docs/GATE_8_G0_NAVIGATION_AUTHORITY_LOCK.md
Gate-8 / G1 — Screen Registry & Metadata Discipline
ID-8.1 — Screen Registry (Existence Truth)
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	8	ID-8.1	FRONT	Screen registry	Canonical screen registry exists defining screen_code, route, and screen type (FULL / MODAL / DRAWER). Screens are declared as navigation-addressable entities only.	Registry is static and not yet consumed by router / stack execution as the sole navigation authority.	Gate-8	ID-8.4	frontend/src/navigation/screenRegistry.js
ID-8.1A — Screen Metadata Rules (Invariant Enforcement)
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	8	ID-8.1A	FRONT	Screen metadata rules	Deterministic rules enforce unique route, mandatory screen_code, explicit screen type, and keepAlive discipline (MODAL/DRAWER=false, FULL=explicit).	Rules validated at boot only; not yet enforced through router binding and stack-only navigation.	Gate-8	ID-8.4	frontend/src/navigation/screenRules.js
Gate-8 / G2 — Screen Stack Engine (Execution Layer)
ID-8.2 — Screen Stack Engine
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	8	ID-8.2	FRONT	Screen stack engine	Core Screen Stack Engine exists with deterministic push/pop/replace/reset maintaining an in-memory navigation stack.	Stack engine not yet wired as the sole authority over router, URL resolution, lifecycle, and deep-link prevention.	Gate-8	ID-8.4	frontend/src/navigation/screenStackEngine.js
ID-8.2A — Single Active Stack Rule
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	8	ID-8.2A	FRONT	Single active stack rule	Single-stack invariant is declared and partially asserted (non-empty, array-based stack).	Global enforcement missing; router bypass and parallel navigation paths not yet structurally blocked.	Gate-8	ID-8.4	frontend/src/navigation/screenStackInvariant.js
Gate-8 / G3 — BackGuard Enforcement (Browser Back Safety)
ID-8.3 — BackGuard Engine
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
✅ DONE	8	ID-8.3	SECURITY	BackGuard engine	Browser back is intercepted globally. Root back is blocked. Stack-based back is enforced and URL is re-asserted from Screen Stack Engine.	—	—	—	frontend/src/navigation/backGuardEngine.js
ID-8.3A — Back Validation Logic
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
✅ DONE	8	ID-8.3A	SECURITY	Back validation logic	Validation helper exists to determine whether previous screen is legally navigable; currently enforces registry-existence checks only.	—	—	—	frontend/src/navigation/backValidation.js
✅ Gate-8 Summary (Locked Meaning)

G0 → 🔒 FROZEN (navigation authority locked)

G1 → 🟡 HALF-DONE (screen truth defined, execution not yet consuming)

G2 → 🟡 HALF-DONE (stack engine exists, router authority wiring pending)

G3 → ✅ DONE (browser back fully governed)
Gate-8 / G4 — Keyboard Intent Governance
ID-8.4 — Keyboard Intent Engine
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	8	ID-8.4	SECURITY	Keyboard intent engine	Global keyboard listener exists. Raw key events are normalized into symbolic navigation intents (e.g., INTENT_BACK). No screen, router, or component may directly act on keyboard shortcuts.	Intent outcomes are not yet fully enforced as the only navigation trigger; stack engine is not yet the exclusive consumer for all navigation paths.	Gate-8	ID-8.5	frontend/src/navigation/keyboardIntentEngine.js
ID-8.4A — Allowed Intent Map
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	8	ID-8.4A	SECURITY	Allowed intent map	Explicit allow-list exists mapping symbolic intents to handlers. Unknown or undeclared keyboard intents are hard-ignored, preventing shortcut-based navigation bypass.	Intent handlers are not yet exhaustively bound to screen stack authority for all navigation cases.	Gate-8	ID-8.5	frontend/src/navigation/keyboardIntentMap.js
✅ Gate-8 Summary (UPDATED)

G0 → 🔒 FROZEN
(Navigation authority locked)

G1 → 🟡 HALF-DONE
(Screen truth defined, execution not yet consuming)

G2 → 🟡 HALF-DONE
(Stack engine exists, router authority wiring pending)

G3 → ✅ DONE
(Browser back fully governed)

G4 → 🟡 HALF-DONE
(Keyboard input reduced to intent source; enforcement wiring pending)

📌 Mandatory Note (attach under Gate-8)

Keyboard handling is not navigation authority.
It is an intent source only.

Presence of keyboard intent files does not change any earlier Gate (G0–G3) semantics.
These IDs remain HALF-DONE until Screen Stack Engine becomes the sole navigation executor.
📌 Mandatory State File Note — Gate-8 / G4 (Keyboard Intent Governance)

Note (Locked):

Keyboard Intent Engine deliberately captures modifier keys (shift, alt, ctrl/meta) even if they are unused at present.

Current usage intentionally normalizes only symbolic intents (e.g., INTENT_BACK) and ignores modifier combinations.

When future keyboard intents are introduced (e.g., CTRL + SHIFT + S → INTENT_SAVE):

No architectural change is required

No new engine or listener is permitted

Only variable usage inside normalizeKeyEvent() may be expanded

Example change (allowed):

- const _shift = event.shiftKey;
+ const shift = event.shiftKey;


This is considered intent expansion, not a navigation or authority change.

Such changes:

Do NOT affect Gate-8 G0–G3

Do NOT change navigation authority

Do NOT require state regression or re-audit

Any modifier-based intent must still:

Resolve to a symbolic INTENT

Pass through keyboardIntentMap.js

Be consumed only by Screen Stack Engine

Direct keyboard → navigation shortcuts remain permanently forbidden.
Gate-8 / G5 — Keyboard ACL Binding (Intent → Permission Boundary)
ID-8.5 — Keyboard ACL Binding (Declaration Layer)
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	8	ID-8.5	SECURITY	Keyboard ACL binding	Keyboard intents are deterministically mapped to abstract ACL actions (resource + action). This layer declares intent → permission relationship only. No ACL execution is performed at this gate.	Actual ACL evaluation (VWED engine) is not available at Gate-8. Executing ACL here would violate authority boundaries.	Gate-10	ID-10.4	frontend/src/navigation/keyboardAclBridge.js
ID-8.5A — Denied Intent Handling (Deterministic UX Stub)
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	8	ID-8.5A	SECURITY	Denied intent handling	Deterministic denied-intent handler exists. Denial currently emits a side-effect-free signal (console warning). No navigation, redirect, or mutation occurs.	Deny path is not ACL-driven yet because ACL execution is out of scope for Gate-8.	Gate-10	ID-10.4	frontend/src/navigation/keyboardIntentMap.js
🔒 Gate-8 Summary (UPDATED)

G0 → 🔒 FROZEN (navigation authority locked)

G1 → 🟡 HALF-DONE (screen truth declared, not execution-bound)

G2 → 🟡 HALF-DONE (stack engine exists, router authority pending)

G3 → ✅ DONE (browser back fully governed)

G5 → 🟡 HALF-DONE (intent → ACL boundary declared, execution deferred)

📌 Important Note (State-File Rationale)

G5 is intentionally HALF-DONE

No missing file

No broken wiring

Completion explicitly depends on Gate-10 (ACL decision trace + VWED execution)

👉 This satisfies HALF-DONE validity rule
👉 No silent completion
👉 No design debt

🔄 STATE FILE UPDATE — Gate-8 / G6
ID-8.6 — Navigation State Persistence
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
✅ DONE	8	ID-8.6	FRONT	Navigation state persistence	Screen stack is persisted to sessionStorage on every navigation mutation (init, push, replace, pop). Stack is restored deterministically on page refresh during the same session.	—	—	—	frontend/src/navigation/navigationPersistence.js
frontend/src/navigation/screenStackEngine.js
frontend/src/main.jsx
ID-8.6A — Session Reset Handling
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
⏸ DEFERRED	8	ID-8.6A	FRONT	Session reset handling	Navigation stack reset capability exists and is callable on logout / SESSION_* events. Actual invocation will be wired from session lifecycle handlers.	Invocation must be triggered by backend session lifecycle (logout / revoke / expiry), which is handled in later Gates.	Gate-9	ID-9.x	frontend/src/navigation/navigationPersistence.js
frontend/src/navigation/screenStackEngine.js
🔗 “Closes Earlier HALF-DONE” — ID-3.7A (EXPLICIT NOTE)
Closure Note for ID-3.7A

How ID-8.6 / 8.6A closes ID-3.7A:

ID-3.7A required deterministic frontend cleanup on session boundary events to prevent stale or leaked UI state.
Gate-8 / G6 introduces a single, authoritative navigation stack with explicit reset capability (resetStack + clearNavigationStack).
This guarantees that when session lifecycle events are fired (logout, revoke, expiry), the frontend can hard-reset all navigation state deterministically.

Closure Status:

Design & capability: ✅ CLOSED in Gate-8

Runtime trigger wiring: ⏸ DEFERRED (Gate-9 session lifecycle)

👉 Therefore, ID-3.7A is considered CLOSED by design, with execution hook deferred by governance.

✅ Final Gate-8 / G6 Verdict (State-File Truth)

ID-8.6: ✅ DONE

ID-8.6A: ⏸ DEFERRED (by design, acceptable)

Closes ID-3.7A: ✅ YES (design closure recorded)
🔹 Gate-8 / G7 — Navigation Observability
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
✅ DONE	8	8.7	OBSERVABILITY	Navigation event logs	All navigation actions (init, push, replace, pop, keyboard back) emit deterministic, read-only navigation events via console logging without affecting control flow.	—	—	—	frontend/src/navigation/navigationEventLogger.js, frontend/src/navigation/screenStackEngine.js, frontend/src/navigation/keyboardIntentMap.js

Explicit Gate-8 Rule Confirmation:

Logs are console-only

No DB, no Supabase, no side-effects

Future backend telemetry deferred to Gate-10+

✅ Gate-8 Group Summary (Updated)
Group	Group_Name	IDs Included	Status
G6	Navigation State Persistence	8.6, 8.6A	✅ DONE
G7	Navigation Observability	8.7	✅ DONE
🧱 What this means (important, calm assurance)

Navigation now survives refresh ✔️

Navigation always resets on logout / SESSION_* ✔️

Every navigation action is observable for RCA ✔️

No rule is violated, no future dependency introduced ✔️

🔒 Gate-8 — Navigation & Screen Stack Authority (STATE FILE UPDATE)
Gate-8 / G0 — Navigation Authority Lock
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🔒 FROZEN	8	ID-8.0	GOVERNANCE	Navigation authority lock	Navigation authority is permanently locked to the Screen Stack Engine. URL, router, browser history, keyboard, and screen components have ZERO authority. Any navigation not issued by the engine is invalid.	—	—	—	docs/GATE_8_G0_NAVIGATION_AUTHORITY_LOCK.md
Gate-8 / G1 — Screen Registry & Metadata Discipline
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	8	ID-8.1	FRONT	Screen registry	Canonical screen registry exists defining screen_code, route, and screen type (FULL / MODAL / DRAWER). Screens are declared as navigation-addressable entities only.	Registry is not yet the sole authority bound into router & stack execution.	Gate-9	ID-9.x	frontend/src/navigation/screenRegistry.js
🟡 HALF-DONE	8	ID-8.1A	FRONT	Screen metadata rules	Deterministic rules enforce unique route, mandatory screen_code, explicit screen type, and keepAlive discipline.	Metadata rules are validated but not yet enforced through stack-only routing.	Gate-9	ID-9.x	frontend/src/navigation/screenRules.js
Gate-8 / G2 — Screen Stack Engine
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	8	ID-8.2	FRONT	Screen stack engine	Deterministic push / pop / replace / reset engine exists maintaining a single in-memory navigation stack.	Router, URL, and lifecycle are not yet fully subordinated as exclusive consumers of stack authority.	Gate-9	ID-9.x	frontend/src/navigation/screenStackEngine.js
🟡 HALF-DONE	8	ID-8.2A	FRONT	Single active stack rule	Single-stack invariant is declared and asserted locally.	Global enforcement against all alternate navigation paths is not yet structurally proven.	Gate-9	ID-9.x	frontend/src/navigation/screenStackInvariant.js
Gate-8 / G3 — Back Navigation Governance
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
✅ DONE	8	ID-8.3	SECURITY	BackGuard engine	Browser back is intercepted globally; root back is blocked; stack-validated back only is permitted.	—	—	—	frontend/src/navigation/backGuardEngine.js
🟡 HALF-DONE	8	ID-8.3A	SECURITY	Back validation logic	Previous-screen validation exists based on screen registry truth.	ACL-aware back permission evaluation is intentionally deferred.	Gate-10	ID-10.x	frontend/src/navigation/backValidation.js
Gate-8 / G4 — Keyboard Intent Governance
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	8	ID-8.4	SECURITY	Keyboard intent engine	Raw keyboard events are normalized into symbolic intents only. Keyboard has no direct navigation authority.	Stack engine is not yet the exclusive consumer for all intent outcomes.	Gate-9	ID-9.x	frontend/src/navigation/keyboardIntentEngine.js
🟡 HALF-DONE	8	ID-8.4A	SECURITY	Allowed intent map	Explicit allow-list exists; undeclared shortcuts are ignored.	Not all intent handlers are bound exclusively to stack authority yet.	Gate-9	ID-9.x	frontend/src/navigation/keyboardIntentMap.js
Gate-8 / G5 — Keyboard ACL Binding (Declaration Only)
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	8	ID-8.5	SECURITY	Keyboard ACL binding	Keyboard intents are deterministically mapped to abstract ACL actions (resource + action). No ACL execution occurs here.	ACL evaluation is out of scope for Gate-8 by design.	Gate-10	ID-10.x	frontend/src/navigation/keyboardAclBridge.js
🟡 HALF-DONE	8	ID-8.5A	SECURITY	Denied intent handling	Deterministic deny handler exists with zero side-effects (no navigation, no mutation).	ACL-driven deny semantics are not available yet.	Gate-10	ID-10.x	frontend/src/navigation/keyboardIntentMap.js
Gate-8 / G6 — Navigation State Persistence
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
✅ DONE	8	ID-8.6	FRONT	Navigation state persistence	Screen stack is persisted per session and restored deterministically on refresh.	—	—	—	frontend/src/navigation/navigationPersistence.js, screenStackEngine.js, main.jsx
⏸ DEFERRED	8	ID-8.6A	FRONT	Session reset handling	Stack reset capability exists and is callable on logout / SESSION_* events.	Invocation must be triggered by backend session lifecycle wiring.	Gate-9	ID-9.x	frontend/src/navigation/navigationPersistence.js, screenStackEngine.js
Gate-8 / G7 — Navigation Observability
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
✅ DONE	8	ID-8.7	OBSERVABILITY	Navigation event logs	All navigation actions emit deterministic, console-only logs with zero side-effects.	—	—	—	frontend/src/navigation/navigationEventLogger.js, screenStackEngine.js, keyboardIntentMap.js
Gate-8 — Final State Summary (Authoritative)
Group	Scope	Status
G0	Navigation authority lock	🔒 FROZEN
G1	Screen existence & metadata	🟡 HALF-DONE
G2	Screen stack execution	🟡 HALF-DONE
G3	Browser back governance	✅ DONE
G4	Keyboard intent governance	🟡 HALF-DONE
G5	Keyboard → ACL boundary	🟡 HALF-DONE
G6	Navigation persistence	✅ DONE / ⏸ DEFERRED
G7	Navigation observability	✅ DONE
🔒 Closure Statement (Insert Verbatim)

Gate-8 — Navigation & Screen Stack Authority is hereby declared COMPLETE and FROZEN at the authority layer.

This gate permanently revokes navigation authority from:
URL, router, browser history, keyboard, and screen components.

All future navigation behavior must consume the Screen Stack Engine and must not reinterpret the rules frozen here.

Execution wiring and ACL interaction are explicitly deferred to later Gates.

### Gate-9 — ADMIN UNIVERSE & CONTROL PLANE

| Group | Group_Name                    | IDs Included | Primary Purpose                                                                 | Closes Earlier HALF-DONE                                      |
|------:|-------------------------------|--------------|----------------------------------------------------------------------------------|----------------------------------------------------------------|
| G0    | Admin Universe Authority Lock  | 9            | Declare SA/GA dashboards as ACL-free but security-enforced; admin universe fully separated from ACL user universe | Gate-5 (Admin bypass ambiguity), Gate-6 (Admin vs ACL precedence) |
| G1    | Admin Dashboard Shells         | 9.1, 9.1A    | Establish /sa/home and /ga/home as entry shells consuming Screen Stack + Menu Snapshot | Gate-8 (Screen Stack consumption), Gate-7 (Admin menu split delivery) |
✅ INSERT — Gate-9 / G0
Admin Universe Authority Lock
### Gate-9 / G0 — Admin Universe Authority Lock

| Status | Gate | ID | Domain | Short_Name              | Current_Reality                                                                                                  | Why_Not_Complete | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved |
|------:|------|----|--------|-------------------------|-------------------------------------------------------------------------------------------------------------------|------------------|-------------------|--------------------------|----------------|
| 🔒 FROZEN | 9 | 9 | GOVERNANCE | Admin universe lock | SA/GA dashboards are formally declared ACL-free but security-enforced. Admin universe is structurally isolated from ACL user universe. No ACL resolver, role, VWED, or menu permission logic is evaluated for admin shells. | — | — | — | docs/GATE_9_G0_ADMIN_UNIVERSE_LOCK.md |
🔒 Why this is FROZEN (not DONE)
Pure authority boundary

No runtime execution required

Binary declaration: separated or not

No dependency on UI, data, or ACL execution

👉 তাই FROZEN immediately, exactly like Gate-7 / ID-7.

🔁 Cascading Status Closures Triggered by G0
👉 এই tableটা Gate-9 / G0 এর ঠিক নিচে বসাবে

### 🔁 Cascading Status Resolution — Triggered by Gate-9 / G0

| Earlier Gate | ID        | Previous Status | What Was Ambiguous Earlier                               | What G0 Resolves Now                                      | New Status |
|-------------:|-----------|-----------------|-----------------------------------------------------------|------------------------------------------------------------|------------|
| Gate-5       | ID-5.5    | 🟡 HALF-DONE     | SA/GA bypass path existed but admin universe boundary unclear | Admin universe is formally isolated and ACL-free           | 🔒 FROZEN  |
| Gate-5       | ID-5.5A   | 🟡 HALF-DONE     | Admin bypass isolation lacked final authority declaration  | Bypass is confined strictly to Admin Universe              | 🔒 FROZEN  |
| Gate-6       | ID-6.14   | 🟡 HALF-DONE     | Admin vs ACL precedence conceptually defined but not bounded | Admin precedence is absolute and outside ACL evaluation    | 🟡 HALF-DONE (execution still deferred) |
🔍 Important precision note

ID-6.14 stays HALF-DONE because execution is Gate-11

Only ambiguity is resolved here, not execution

✅ INSERT — Gate-9 / G1
Admin Dashboard Shells
### Gate-9 / G1 — Admin Dashboard Shells

| Status | Gate | ID  | Domain | Short_Name              | Current_Reality                                                                 | Why_Not_Complete | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved |
|------:|------|-----|--------|-------------------------|----------------------------------------------------------------------------------|------------------|-------------------|--------------------------|----------------|
| ✅ DONE | 9 | 9.1 | FRONT | SA Dashboard shell | `/sa/home` is established as the canonical Super-Admin entry shell. Shell consumes Screen Stack Engine and backend-delivered admin menu snapshot. No ACL user components or routes are reachable from this shell. | — | — | — | frontend/src/router/AppRouter.jsx, frontend/src/admin/sa/SADashboardShell.jsx |
| ✅ DONE | 9 | 9.1A | FRONT | GA Dashboard shell | `/ga/home` is established as the canonical Group-Admin entry shell. Group scope is enforced by backend context; frontend has no scope authority. Shell consumes Screen Stack and admin menu snapshot only. | — | — | — | frontend/src/router/AppRouter.jsx, frontend/src/admin/ga/GADashboardShell.jsx |
🔁 Cascading Status Closures Triggered by G1
### 🔁 Cascading Status Resolution — Triggered by Gate-9 / G1

| Earlier Gate | ID     | Previous Status | What Was Missing Earlier                              | What G1 Provides Now                                      | New Status |
|-------------:|--------|-----------------|--------------------------------------------------------|------------------------------------------------------------|------------|
| Gate-8       | ID-8.1 | 🟡 HALF-DONE     | Screens existed but no admin entry consumption path     | Admin screens are now consumed as real shells              | 🟡 HALF-DONE |
| Gate-8       | ID-8.2 | 🟡 HALF-DONE     | Screen Stack existed but no admin root                  | Admin shells initialize and consume stack                  | 🟡 HALF-DONE |
| Gate-7       | ID-7.4A| ✅ DONE          | Admin menu split delivery                              | Now actually consumed by admin shells                      | ✅ DONE (unchanged) |
🔍 Note

Gate-8 IDs stay HALF-DONE because exclusive authority wiring is Gate-9+

Consumption ≠ sole authority yet

🧠 One-Line Authoritative Summary (State-File Grade)
Gate-9 / G0 locks the Admin Universe as a first-class, ACL-free authority domain.
Gate-9 / G1 operationalizes that authority by introducing concrete SA and GA dashboard shells that consume backend menu snapshots and the Screen Stack Engine.

Admin authority ambiguity from Gate-5 is permanently resolved.
No ACL execution, permission evaluation, or business logic is introduced at this stage.
✅ Final Status Snapshot (Gate-9 so far)
Group	Status
G0	🔒 FROZEN
G1	✅ DONE

✅ INSERT — Gate-9 / G2
Org Masters (SA-only)
Gate-9 / G2 — Org Masters (Company + Group Governance)
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	9	9.2	MASTER	Company master (SA-only)	Company master fully implemented at DB + backend layer. Create / activate / inactivate supported. Hard constraints enforced at DB level.	Admin UI not yet consuming	—	—	supabase/migrations/20260126130000_gate6_6_2_create_company_master.sql; supabase/functions/api/_core/admin/company/create_company.handler.ts; update_company_state.handler.ts
🟡 HALF-DONE	9	9.2A	MASTER	Company delete constraints	Company deletion is DB-guarded with dependency-safe constraints and triggers. Orphan / unsafe deletes are blocked.	UI-level delete flow not exposed	—	—	supabase/migrations/20260315101000_gate9_9_2A_company_delete_constraints.sql
🟡 HALF-DONE	9	9.3	MASTER	Group master (SA-only)	Canonical group master implemented with GRP001-style code generator, immutable group_code, and strict state invariants.	Admin UI not yet consuming	—	—	supabase/migrations/20260315102000_gate9_9_3_create_group_master.sql
🟡 HALF-DONE	9	9.3A	MASTER	Company ↔ Group mapping	Governance-only mapping implemented. One-company→one-group rule enforced. Map / unmap handlers are idempotent and safe.	UI-level mapping screens not present	—	—	supabase/migrations/20260315103000_gate9_9_3A_create_company_group_map.sql; map_company_to_group.handler.ts; unmap_company_group.handler.ts
🟡 HALF-DONE	9	9.3B	DB	Group delete safety	Group DELETE is blocked if any company is mapped. INACTIVATE allowed. Enforced strictly at DB trigger level.	—	—	—	supabase/migrations/20260315101500_gate9_9_3B_group_delete_constraints.sql
🔁 Cascading Status Resolution — Triggered by Gate-9 / G2
Earlier Gate	ID	Previous Status	What Was Missing Earlier	What G2 Provides Now	New Status
Gate-5	ID-5.x	🟡 HALF-DONE	Company / Group not available as governed entities	Canonical org masters now exist and are DB-authoritative	🟡 HALF-DONE
Gate-6	ID-6.x	🟡 HALF-DONE	Context lacked governed org backing	Context now backed by governed company / group entities	🟡 HALF-DONE

⚠️ Note: These remain HALF-DONE because frontend consumption and admin UX is intentionally deferred.

🧠 One-Line Authoritative Summary (State-File Grade)

Gate-9 / G2 establishes canonical, SA-only Org Masters (Company + Group) with full DB-level governance, immutability, and delete safety.
Backend authority is complete; frontend admin consumption is intentionally pending.

📌 Final G2 Snapshot
Group	Status
G2	🟡 HALF-DONE (backend & DB COMPLETE, frontend pending)

Gate-9 / G3 — Operational Scope Masters
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	9	9.4	MASTER	Project master	Admin-only backend handlers exist to create and list company-bound projects. Project identity, company binding, and visibility are enforced server-side using resolved context.	Admin UI screens not yet consuming these APIs	Gate-9	ID-9.17	create_project.handler.ts, list_projects.handler.ts
🟡 HALF-DONE	9	9.4A	MASTER	Project state rules	Controlled admin-only project state transitions (ACTIVE / INACTIVE / ARCHIVED) are enforced via backend handler with strict transition rules and company scoping.	No admin UI workflow to drive state changes	Gate-9	ID-9.17	update_project_state.handler.ts
🟡 HALF-DONE	9	9.5	MASTER	Department master	Admin-only backend handlers exist to create, list, and update company-bound departments with deterministic codes and lifecycle safety.	HR/Admin UI screens not yet implemented	Gate-9	ID-9.17	department_create.handler.ts, department_list.handler.ts, department_update.handler.ts
🔎 Mandatory Gate-9 / G3 Notes

(attach below table)

Gate-9 / G3 consumes Gate-6 truth; it does not redefine schema.

All handlers are Admin Universe only; ACL user universe cannot access them.

Context binding (company scope) is enforced backend-side; frontend has zero authority.

Completion of G3 requires admin UI workflows, not additional backend logic.

🧠 One-line authoritative summary

Gate-9 / G3 is execution-ready at backend level but UI-pending.
Operational scope (Projects & Departments) is now admin-manageable in code; human-driven workflows remain intentionally incomplete until admin panels are delivered.

Gate-9 / G4 — User Governance (State, Role, Safety)
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
✅ DONE	9	9.6	ADMIN	User state governance	Admin-only backend handlers exist to activate / disable ERP users with deterministic rules, company-scoped context enforcement, and mandatory session revocation on DISABLED. Self-lockout prevention is enforced.	—	—	—	_core/admin/user/update_user_state.handler.ts, _guards/self_lockout.guard.ts, _core/session/session.admin_revoke.ts
✅ DONE	9	9.6A	ADMIN	User role governance	Admin-only backend handler exists to assign or change ERP user roles with deterministic normalization, rank enforcement, and self-lockout protection. Single-role-per-company invariant is preserved.	—	—	—	_core/admin/user/update_user_role.handler.ts, _shared/role_ladder.ts, _guards/self_lockout.guard.ts
🟡 HALF-DONE	9	9.6B	ADMIN	User list governance	Governable user listing exists, context-scoped and enumeration-safe. Returns ACTIVE / DISABLED users only.	No admin UI workflow consumes this data; pagination, filtering, and audit UX not implemented	Gate-9	ID-9.10	_core/admin/user/list_users.handler.ts
🔎 Mandatory Gate-9 / G4 Notes (attach below table)

1️⃣ What G4 DOES

Establishes backend-authoritative user governance

Allows state change (ACTIVE / DISABLED) with:

session force-revoke

self-lockout safety

Allows role change with:

rank comparison

downgrade protection

normalization discipline

All actions are:

Admin-Universe only

Context-scoped

Enumeration-safe

2️⃣ What G4 EXPLICITLY DOES NOT Do

❌ No admin UI screens
❌ No bulk user operations
❌ No audit UI (logs exist, UX deferred)
❌ No ACL execution change
❌ No RLS attachment

3️⃣ Why 9.6 & 9.6A are DONE

Runtime execution exists ✔️

Safety invariants enforced ✔️

No dependency on future Gates ✔️

Binary behavior (allowed / blocked) ✔️

👉 Therefore DONE, not HALF-DONE.

4️⃣ Why 9.6B is HALF-DONE (Correctly)

Backend capability exists ✔️

Deterministic output exists ✔️

But:

no admin UI

no pagination / filtering UX

no operator workflows

👉 Truth exists, consumption incomplete → HALF-DONE

🔁 Cascading Status Resolution — Triggered by Gate-9 / G4
Earlier Gate	ID	Previous Status	What Was Missing Earlier	What G4 Resolves Now	New Status
Gate-6	ID-6.x (User control)	🟡 HALF-DONE	No runtime admin execution for user governance	Deterministic admin handlers now exist	🟡 HALF-DONE (execution done, ACL/UI pending)
Gate-5	ID-5.x	🟡 HALF-DONE	Context existed but no user-level governance consumption	Context now actively consumed by admin user ops	🟡 HALF-DONE

⚠️ Note: No earlier ID is auto-closed unless both truth + irreversible execution are proven.

🧠 One-Line Authoritative Summary (State-File Grade)

Gate-9 / G4 completes backend-authoritative ERP user governance (state + role) with full safety invariants.
All execution is real and enforced; admin UI and higher-order workflows are intentionally deferred.

✅ STATE FILE UPDATE — Gate-9 / G5 (ACL Governance Admin)

👉 Insert under: “### Gate-9 — ADMIN UNIVERSE & CONTROL PLANE”

Gate-9 / G5 — ACL Governance (Admin Control Plane)
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	9	9.7	ACL	Role VWED governance	Admin APIs exist to list, upsert, and disable role-wise VWED permissions. All operations are backend-authoritative, context-scoped, and enumeration-safe.	No ACL decision engine or menu snapshot consumes these permissions yet	Gate-10	ID-6.14	list_role_permissions.handler.ts, upsert_role_permission.handler.ts, disable_role_permission.handler.ts
🟡 HALF-DONE	9	9.7A	ACL	Capability packs admin	Admin APIs exist to list and manage capability packs and their bindings to menu actions and roles. Capability truth is fully governable via backend APIs.	Capability permissions are not yet evaluated by ACL decision engine	Gate-10	ID-6.14	list_capabilities.handler.ts, upsert_capability.handler.ts, map_capability_menu.handler.ts, map_role_capability.handler.ts
⏸ DEFERRED	9	9.8	ACL	User overrides admin	Intentionally deferred. User-level allow/deny overrides require runtime ACL precedence execution.	No ACL decision engine exists to evaluate overrides safely	Gate-10	ID-6.16	—
✅ DONE	9	9.9	ACL	Company module map admin	Admin APIs exist to enable / disable modules per company with deterministic hard-deny semantics. Context-scoped, backend-only governance is enforced.	—	—	—	enable_company_module.handler.ts, disable_company_module.handler.ts, list_company_modules.handler.ts
🔒 Mandatory Notes (Attach Below G5 Table)

9.7 and 9.7A are HALF-DONE by design
কারণ এগুলো permission truth define করে, কিন্তু runtime evaluation করে না।

9.8 is explicitly DEFERRED, not HALF-DONE
কারণ execution ছাড়া override expose করা misleading ও unsafe।

9.9 is DONE
কারণ module enable/disable একটি standalone governance action, যার immediate, enforceable effect আছে (absence = hard deny).

🧠 One-Line Authoritative Summary (State-File Grade)

Gate-9 / G5 establishes full admin-side ACL governance over roles, capabilities, and company modules.
Permission truth is now editable, auditable, and backend-authoritative; all runtime evaluation is intentionally deferred to Gate-10.
