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
| ⏸ DEFERRED | 0 | ID-0.1D | DEVOPS | CI advanced checks | Intentionally postponed | Advanced lint / security hooks not implemented | Gate-12 | ID-12.1 | — |
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
| ⏸ DEFERRED   | 0    | ID-0.1D | DEVOPS        | CI advanced checks           | Intentionally postponed              | Advanced lint / security hooks not implemented     | Gate-12           | ID-12.1                  | `.github/workflows/ci.yml`, `.github/workflows/security.yml`, `eslint.config.js`, `package.json`                                                     |
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

=====================
🔒 Gate-2 — FROZEN
=====================

Gate-2 completed without introducing any DB migrations.
All DB objects used here are assumed inputs and not validated or created in this Gate.

Auth / Session Boundary
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🔒 FROZEN	2	ID-2.1	AUTH	Login parent	Login flow fully wired	—	—	—	login.handler.ts
🔒 FROZEN	2	ID-2.1A	AUTH	Credential validation	Supabase Auth only	—	—	—	authDelegate.ts
🔒 FROZEN	2	ID-2.1B	AUTH	Account state	ACTIVE only allowed	—	—	—	accountState.ts
🔒 FROZEN	2	ID-2.1C	SESSION	Session create	ERP session created server-side	—	—	—	session.create.ts
🔒 FROZEN	2	ID-2.1D	AUTH	Identifier resolver	ERP code → auth_user_id	—	—	—	identifierResolver.ts
🔒 FROZEN	2	ID-2.2	SESSION	Cookie issue	HttpOnly cookie issued	—	—	—	session.cookie.ts
🔒 FROZEN	2	ID-2.2A	SESSION	Cookie hardening	Secure, SameSite, Domain	—	—	—	session.cookie.ts
🔒 FROZEN	2	ID-2.2B	SESSION	Overwrite	Always replace cookie	—	—	—	session.cookie.ts
🔒 FROZEN	2	ID-2.2C	SESSION	Bind invariant	session.auth_user_id invariant	—	—	—	login.handler.ts
🔒 FROZEN	2	ID-2.3	AUTH	WhoAmI	Identity only API	—	—	—	me.handler.ts
🔒 FROZEN	2	ID-2.3A	AUTH	No-guess	Frontend reacts only to action	—	—	—	me.handler.ts
🔒 FROZEN	2	ID-2.3B	AUTH	Minimal payload	Empty success payload	—	—	—	me.handler.ts
🔒 FROZEN	2	ID-2.4	AUTH	Logout	Server-side revoke	—	—	—	logout.handler.ts
🔒 FROZEN	2	ID-2.4A	AUTH	Cookie invalidate	Expired cookie set	—	—	—	logout.handler.ts
🔒 FROZEN	2	ID-2.4B	AUTH	Idempotent	Multiple logout safe	—	—	—	logout.handler.ts
🔒 FROZEN	2	ID-2.5	SECURITY	Rate limit	Auth-only throttling	—	—	—	rate_limit.ts
🔒 FROZEN	2	ID-2.6	SECURITY	Error mapping	Deterministic codes	—	—	—	response.ts
🔒 FROZEN	2	ID-2.6A	SECURITY	Generic msg	Enumeration-safe	—	—	—	response.ts
🔒 FROZEN	2	ID-2.7	OBSERVABILITY	Auth logs	Login / logout logged	—	—	—	login.handler.ts, logout.handler.ts
🔒 FROZEN	2	ID-2.8	DOCS	Gate-2 freeze	Gate-2 frozen	—	—	—	docs/GATE_2_FREEZE.md
🚨 Explicit DB Truth (No Misleading Assumptions)

Gate-2 DOES NOT create tables

Gate-2 DOES NOT validate table existence

Tables referenced by code:

erp_core.users

erp_core.sessions

Their creation must be documented in a different Gate

This file does not claim they were created earlier unless explicitly shown

🔒 Final Declaration

Gate-2 is FROZEN, COMPLETE, and IMMUTABLE.

### Gate-3 — SESSION LIFECYCLE & SECURITY (POST-AUDIT)

| Status | Gate | ID | Domain | Short_Name | Current_Reality | Why_Not_Complete | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved |
|--------|------|----|--------|------------|-----------------|------------------|-------------------|--------------------------|----------------|

| 🟡 HALF-DONE | 3 | 3 | SESSION | Session lifecycle definition | Authoritative session lifecycle model defined and enforced via Gate-2 + Gate-3 pipeline | Storage-level state persistence and final policy values deferred | Policy / Storage Gate | TBD | _pipeline/session.ts, _pipeline/session_lifecycle.ts, _pipeline/runner.ts |

| 🟡 HALF-DONE | 3 | 3.1 | SESSION | Idle timeout engine | Idle tracking logic implemented and wired into lifecycle enforcement | Idle timeout value not locked | Policy / Config Gate | TBD | _pipeline/session_lifecycle.ts |

| 🟡 HALF-DONE | 3 | 3.1A | SESSION | Idle warning signal | Idle warning signal emitted deterministically before expiry | Warning threshold value not locked | Policy / Config Gate | TBD | _pipeline/session_lifecycle.ts |

| 🟡 HALF-DONE | 3 | 3.1B | SESSION | Idle expiry handler | Idle expiry forces deterministic LOGOUT | Expiry threshold value not locked | Policy / Config Gate | TBD | _pipeline/session_lifecycle.ts, _pipeline/runner.ts |

| 🟡 HALF-DONE | 3 | 3.2 | SESSION | Absolute TTL engine | Absolute TTL logic implemented; session age evaluated on every request | TTL duration value not locked | Policy / Config Gate | TBD | _pipeline/session_lifecycle.ts |

| 🟡 HALF-DONE | 3 | 3.2A | SESSION | TTL enforcement | TTL never extends and always overrides idle logic | TTL duration value not locked | Policy / Config Gate | TBD | _pipeline/session_lifecycle.ts, _pipeline/runner.ts |

| ✅ DONE | 3 | 3.3 | SESSION | Single active session policy | New login enforces exactly one ACTIVE ERP session | — | — | — | _core/session/session.create.ts |

| ✅ DONE | 3 | 3.3A | SESSION | Global revoke on login | All existing ACTIVE sessions revoked atomically on login | — | — | — | _core/session/session.create.ts |

| ✅ DONE | 3 | 3.4 | SESSION | Admin force revoke | Any non-ACTIVE session state forces logout on next request | — | — | — | _pipeline/session.ts, _pipeline/runner.ts |

| ✅ DONE | 3 | 3.4A | SESSION | Immediate effect rule | SESSION_FORCE_LOGOUT enforced deterministically with zero residual access | — | — | — | _pipeline/runner.ts |

| 🟡 HALF-DONE | 3 | 3.5 | SESSION | Device tagging (soft) | Device metadata captured and stored as signal only | No trust or enforcement policy by design | Trust / Security Gate | TBD | _core/auth/login.handler.ts, _core/session/session.create.ts |

| 🟡 HALF-DONE | 3 | 3.5A | SESSION | Device change signal | Device change detected and logged without blocking | No anomaly response policy by design | Trust / Security Gate | TBD | _pipeline/session_lifecycle.ts |

| 🟡 HALF-DONE | 3 | 3.6 | SECURITY | Session fixation prevention | New session identifier generated on every login | Final transport hardening policy deferred | Security / Transport Gate | TBD | _core/session/session.create.ts |

| 🟡 HALF-DONE | 3 | 3.6A | SECURITY | Cookie regeneration rule | Fresh HttpOnly cookie always issued on authentication | Cookie policy lock deferred | Security / Transport Gate | TBD | _core/auth/login.handler.ts |

| ✅ DONE | 3 | 3.7 | SECURITY | Session state validation | Revoked / expired / invalid sessions rejected authoritatively | — | — | — | _pipeline/session.ts |

| ✅ DONE | 3 | 3.7A | SECURITY | SESSION_* logout enforcement | All SESSION_* outcomes deterministically force LOGOUT | — | — | — | _pipeline/runner.ts |

| ✅ DONE | 3 | 3.8 | OBSERVABILITY | Session timeline logs | Full session lifecycle events logged with request_id and structured meta | — | — | — | _pipeline/session.ts, _pipeline/session_lifecycle.ts, _lib/logger.ts |

| 🔒 FROZEN | 3 | 3.9 | DOCS | Gate-3 freeze declaration | Gate-3 behaviour, contracts, and observability formally locked after audit | — | — | — | docs/GATE_3_FREEZE.md |

Special Notes:

--------------------------------------------------------------------------------------------------------

“The IDs listed in this section are intentionally kept in HALF-DONE or DEFERRED status.
These items cannot be completed within the scope of the current Gate.
Each of these IDs must be explicitly re-verified and closed only after the specified future Gate has been completed.”

| Status       | Gate | ID      | Domain        | Short_Name                   | Current_Reality                      | Why_Not_Complete                                   | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved                                                                                                                                       |
| ------------ | ---- | ------- | ------------- | ---------------------------- | ------------------------------------ | -------------------------------------------------- | ----------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |                 |
| 🟡 HALF-DONE | 3    | 3       | SESSION       | Session lifecycle definition | Lifecycle model defined and enforced | Storage-level persistence & policy values deferred | Gate-10           | ID-10.3                  | `supabase/functions/api/_pipeline/session.ts`, `supabase/functions/api/_pipeline/session_lifecycle.ts`, `supabase/functions/api/_pipeline/runner.ts` |
| 🟡 HALF-DONE | 3    | 3.1     | SESSION       | Idle timeout engine          | Idle tracking logic implemented      | Idle timeout value not locked                      | Gate-10           | ID-10.3                  | `supabase/functions/api/_pipeline/session_lifecycle.ts`                                                                                              |
| 🟡 HALF-DONE | 3    | 3.1A    | SESSION       | Idle warning signal          | Warning emitted deterministically    | Warning threshold value not locked                 | Gate-10           | ID-10.3                  | `supabase/functions/api/_pipeline/session_lifecycle.ts`                                                                                              |
| 🟡 HALF-DONE | 3    | 3.1B    | SESSION       | Idle expiry handler          | Idle expiry forces LOGOUT            | Expiry threshold value not locked                  | Gate-10           | ID-10.3                  | `supabase/functions/api/_pipeline/session_lifecycle.ts`, `supabase/functions/api/_pipeline/runner.ts`                                                |
| 🟡 HALF-DONE | 3    | 3.2     | SESSION       | Absolute TTL engine          | TTL logic implemented                | TTL duration value not locked                      | Gate-10           | ID-10.3                  | `supabase/functions/api/_pipeline/session_lifecycle.ts`                                                                                              |
| 🟡 HALF-DONE | 3    | 3.2A    | SESSION       | TTL enforcement              | TTL always overrides idle            | TTL duration value not locked                      | Gate-10           | ID-10.3                  | `supabase/functions/api/_pipeline/session_lifecycle.ts`, `supabase/functions/api/_pipeline/runner.ts`                                                |
| 🟡 HALF-DONE | 3    | 3.5     | SESSION       | Device tagging (soft)        | Device metadata captured             | No trust / enforcement policy                      | Gate-10           | ID-10.3                  | `supabase/functions/api/_core/auth/login.handler.ts`, `supabase/functions/api/_core/session/session.create.ts`                                       |
| 🟡 HALF-DONE | 3    | 3.5A    | SESSION       | Device change signal         | Change detected, non-blocking        | No anomaly response policy                         | Gate-10           | ID-10.3                  | `supabase/functions/api/_pipeline/session_lifecycle.ts`                                                                                              |
| 🟡 HALF-DONE | 3    | 3.6     | SECURITY      | Session fixation prevention  | New session identifier generated     | Transport hardening policy deferred                | Gate-10           | ID-10.5                  | `supabase/functions/api/_core/session/session.create.ts`                                                                                             |
| 🟡 HALF-DONE | 3    | 3.6A    | SECURITY      | Cookie regeneration rule     | Fresh cookie issued                  | Cookie policy lock deferred                        | Gate-10           | ID-10.5                  | `supabase/functions/api/_core/auth/login.handler.ts`   

### Gate-4

| Status | Gate | ID | Domain | Short_Name | Current_Reality | Why_Not_Complete | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved |
|--------|------|----|--------|------------|-----------------|------------------|-------------------|--------------------------|----------------|
| ✅ DONE | 4 | 4.0A | GOVERNANCE | User lifecycle authority | Supabase Auth handles identity only; ERP user lifecycle owned by Gate-4 | — | — | — | docs/GATE_4_FREEZE.md |
| ✅ DONE | 4 | 4.0B | GOVERNANCE | Deterministic lifecycle states | ERP user states locked to PENDING / ACTIVE / REJECTED / DISABLED | — | — | — | docs/GATE_4_FREEZE.md |
| 🟡 HALF-DONE | 4 | 4.0C | ACL | Minimal ACL bootstrap | Only L1_USER assigned on approval; no escalation logic | Extended ACL system not implemented | Gate-6 | ID-6.x | approve.handler.ts |
| ✅ DONE | 4 | 4.1 | AUTH | Signup intake | Public signup creates ERP user in PENDING state only | — | — | — | signup.handler.ts |
| ✅ DONE | 4 | 4.1A | DB | ERP users table | erp_core.users created; lifecycle only | — | — | — | migrations/20260123101000_gate4_4_1_create_erp_users.sql |
| ✅ DONE | 4 | 4.1B | DB | Signup requests table | erp_core.signup_requests created with metadata & decision fields | — | — | — | migrations/20260126101000_gate4_4_2A_signup_requests_and_user_code_fn.sql |
| ✅ DONE | 4 | 4.1C | SECURITY | Human verification | Deterministic backend human verification enforced | — | — | — | human_verification.ts |
| ✅ DONE | 4 | 4.2 | ADMIN | Signup rejection | SA can reject signup; ERP user → REJECTED | — | — | — | reject.handler.ts |
| ✅ DONE | 4 | 4.2A | ADMIN | Signup approval | SA approval activates ERP user and assigns user_code | — | — | — | approve.handler.ts |
| ✅ DONE | 4 | 4.2B | AUDIT | Approval audit log | All approve/reject actions logged append-only | — | — | — | migrations/erp_audit.signup_approvals.sql |
| ✅ DONE | 4 | 4.3 | DB | User code sequence | Deterministic P0001 sequence created | — | — | — | migrations/user_code_p_seq |
| ✅ DONE | 4 | 4.3A | DB | RPC-safe sequence wrapper | SQL function created for Supabase RPC | — | — | — | migrations/20260126101000_gate4_4_2A_signup_requests_and_user_code_fn.sql |
| 🔒 FROZEN | 4 | 4.7 | DOCS | Gate-4 freeze declaration | User lifecycle governance formally frozen | — | — | — | docs/GATE_4_FREEZE.md |

### Gate-4 Observations

1. Gate-4 introduces ERP user existence but does not grant business capability.
2. Signup is enumeration-safe and authority-free.
3. Approval is the only path to ACTIVE ERP state.
4. user_code is immutable once assigned.
5. ACL bootstrap is intentionally minimal and deferred.
6. No session, context, or permission logic exists in this gate.
7. All behaviour is backend-authoritative and production-parity safe.

### Gate-4 Final Declaration

Gate-4 is COMPLETE at the governance and lifecycle layer.

All ERP user lifecycle rules are:
- Deterministic
- Audited
- Enumeration-safe
- Backend-authoritative

No further changes are permitted under Gate-4.
Special Notes:

--------------------------------------------------------------------------------------------------------

“The IDs listed in this section are intentionally kept in HALF-DONE or DEFERRED status.
These items cannot be completed within the scope of the current Gate.
Each of these IDs must be explicitly re-verified and closed only after the specified future Gate has been completed.”

| Status       | Gate | ID      | Domain        | Short_Name                   | Current_Reality                      | Why_Not_Complete                                   | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved                                                                                                                                       |
| ------------ | ---- | ------- | ------------- | ---------------------------- | ------------------------------------ | -------------------------------------------------- | ----------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |                 |
                                                                                                |
| 🟡 HALF-DONE | 4    | 4.0C    | ACL           | Minimal ACL bootstrap        | Only L1_USER assigned on approval    | Extended ACL system not implemented                | Gate-6            | ID-6.x                   | `supabase/functions/api/_core/admin/signup/approve.handler.ts`, `supabase/functions/api/_pipeline/acl.ts`

✅ Gate-5 — CONTEXT AUTHORITY & RESOLUTION
Gate-5 State Table (UPDATED)
| Status       | Gate | ID      | Domain        | Short_Name                    | Current_Reality                                                        | Why_Not_Complete                                 | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved                                                                                   |
| ------------ | ---- | ------- | ------------- | ----------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------ | ----------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| 🔒 FROZEN    | 5    | ID-5    | GOVERNANCE    | Context authority lock        | Context authority locked to backend only; frontend permanently ignored | —                                                | —                 | —                        | supabase/functions/api/_pipeline/context.ts, _pipeline/runner.ts                                 |
| 🟡 HALF-DONE | 5    | ID-5.1  | CONTEXT       | Request context resolver      | Deterministic resolver pipeline exists with UNRESOLVED/RESOLVED states | ERP user → org/project/department mapping absent | Gate-6            | ID-6.x                   | supabase/functions/api/_pipeline/context.ts                                                      |
| 🔒 FROZEN    | 5    | ID-5.1A | CONTEXT       | Context input sanitization    | Frontend-supplied context hints ignored unconditionally                | —                                                | —                 | —                        | supabase/functions/api/_pipeline/context.ts                                                      |
| 🟡 HALF-DONE | 5    | ID-5.1B | SECURITY      | Missing context handling      | UNRESOLVED context deterministically blocks request                    | Context mapping logic unavailable                | Gate-6            | ID-6.x                   | supabase/functions/api/_pipeline/context.ts, _pipeline/runner.ts                                 |
| 🟡 HALF-DONE | 5    | ID-5.2  | CONTEXT       | Company context validation    | Company boundary declared in pipeline                                  | Company data + ACL truth unavailable             | Gate-6            | ID-6.x                   | supabase/functions/api/_pipeline/context.ts                                                      |
| 🟡 HALF-DONE | 5    | ID-5.2A | SECURITY      | Single-company invariant      | One-company-per-request invariant locked                               | Real org data missing                            | Gate-6            | ID-6.x                   | supabase/functions/api/_pipeline/context.ts                                                      |
| 🟡 HALF-DONE | 5    | ID-5.3  | CONTEXT       | Project context validation    | Project ↔ company binding contract declared                            | Project data absent                              | Gate-6            | ID-6.x                   | supabase/functions/api/_pipeline/context.ts                                                      |
| 🟡 HALF-DONE | 5    | ID-5.3A | SECURITY      | Company-project binding       | Cross-company leakage prevention declared                              | Binding enforcement deferred                     | Gate-6            | ID-6.x                   | supabase/functions/api/_pipeline/context.ts                                                      |
| 🟡 HALF-DONE | 5    | ID-5.4  | CONTEXT       | Department context validation | Department boundary declared                                           | Department / HR data absent                      | Gate-6            | ID-6.x                   | supabase/functions/api/_pipeline/context.ts                                                      |
| 🟡 HALF-DONE | 5    | ID-5.4A | SECURITY      | Department access check       | Department isolation contract defined                                  | ACL-backed policy unavailable                    | Gate-6            | ID-6.x                   | supabase/functions/api/_pipeline/context.ts                                                      |
| 🟡 HALF-DONE | 5    | ID-5.5  | ADMIN         | SA / GA bypass rules          | Admin universe bypass path declared                                    | SA/GA detection source missing                   | Gate-6            | ID-6.x                   | supabase/functions/api/_pipeline/context.ts                                                      |
| 🟡 HALF-DONE | 5    | ID-5.5A | SECURITY      | Bypass isolation guard        | Admin bypass isolated from ACL users                                   | Requires ACL universe truth                      | Gate-6            | ID-6.x                   | supabase/functions/api/_pipeline/context.ts                                                      |
| 🔒 FROZEN    | 5    | ID-5.6  | SECURITY      | Context invariant enforcement | UNRESOLVED context always blocks downstream execution                  | —                                                | —                 | —                        | supabase/functions/api/_pipeline/context.ts, _pipeline/runner.ts                                 |
| 🔒 FROZEN    | 5    | ID-5.6A | SECURITY      | Context error codes           | CONTEXT_* error codes returned; no logout triggered                    | —                                                | —                 | —                        | supabase/functions/api/_pipeline/context.ts, _pipeline/runner.ts                                 |
| 🟡 HALF-DONE | 5    | ID-5.7  | DB            | RLS context alignment         | Context injected into DB client via headers                            | Table-level RLS not applied yet                  | Gate-7            | ID-7.x                   | _shared/serviceRoleClient.ts, migrations/20260126120000_gate5_5_7_rls_context_header_helpers.sql |
| 🟡 HALF-DONE | 5    | ID-5.7A | DB            | Context mismatch block        | RLS templates defined for zero-row return on mismatch                  | Templates not applied to business tables         | Gate-7            | ID-7.x                   | migrations/20260126121000_gate5_5_7A_rls_policy_templates.sql                                    |
| ⏸ DEFERRED   | 5    | ID-5.8  | OBSERVABILITY | Context resolution logs       | Logging intentionally deferred                                         | Context not data-backed yet                      | Gate-6            | ID-6.x                   | —                                                                                                |
| 🔒 FROZEN    | 5    | ID-5.9  | DOCS          | Gate-5 freeze                 | Gate-5 governance & contracts formally frozen                          | —                                                | —                 | —                        | docs/GATE_5_FREEZE.md                                                                            |


🔍 Gate-5 Observations (Audit-Grade)

Context authority is fully locked — frontend has zero influence.

UNRESOLVED context never reaches business logic (hard block in runner).

Failure semantics are deterministic, non-logout, non-leaky.

Admin universe separation is structurally present but policy-deferred.

RLS alignment is contract-ready, not yet enforced on business tables.

No ACL, role, or permission logic leaks into Gate-5.

Behaviour is production-parity safe even with stubbed resolution.

📌 Significant Notes (Non-Negotiable)

All 🟡 HALF-DONE rows:

Have explicit reasons

Have completion Gate + ID

Will not auto-complete

No Gate-5 item depends on chat memory.

Gate-5 correctness does not depend on future gates behaving correctly.

🔒 Gate-5 Final State

Gate-5 is FROZEN at the governance layer.
No changes are permitted unless Gate-6 explicitly consumes these contracts.

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

Enforcement (Gate-11) applies final decision

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
🟡 HALF-DONE	6	ID-6.14	ACL	ACL precedence ladder	Final ACL evaluation order is explicitly defined and locked in code: Admin → Module Hard Deny → User Override → Role VWED → Capability VWED → DENY	Precedence is defined but not yet enforced at request-time via pipeline	Gate-11	ID-6.17	_pipeline/acl.ts, _acl/acl_resolver.ts
🟡 HALF-DONE	6	ID-6.15	ACL	VWED engine	Deterministic, stateless VWED action evaluation engine implemented and reusable (VIEW/WRITE/EDIT/DELETE/APPROVE/EXPORT)	Engine is not yet invoked by request pipeline	Gate-11	ID-6.17	_acl/vwed_engine.ts
🟡 HALF-DONE	6	ID-6.16	ACL	ACL resolver core	Final ALLOW / DENY resolver implemented, consuming module enablement, user overrides, role permissions, capability permissions	Resolver is not yet wired into stepAcl / runner	Gate-11	ID-6.17	_acl/acl_resolver.ts
🟡 HALF-DONE	6	ID-6.16A	ACL	Decision trace	Structured decision trace model implemented for explainability and audit (layer-by-layer reasoning capture)	Trace is not yet emitted or persisted by enforcement layer	Gate-11	ID-6.17A	_acl/decision_trace.ts
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

That happens in Gate-11 (G11).

🧠 One-Line Authoritative Summary

Gate-6 / G10 defines the complete ACL decision brain, but does not yet enforce it.
All evaluation logic exists; all request-time enforcement is intentionally deferred to Gate-11.

🔹 Gate-11 — G11: Backend Enforcement (FINAL)
📌 Gate-11 / G11 State Update (INSERT AS-IS)
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

(এইগুলো Gate-10 / Gate-12 scope)

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

Gate-11 (G11) is COMPLETE.
The ACL decision brain (Gate-10) is now fully enforced at request time; no protected API can execute without a deterministic ALLOW verdict, and enforcement is action-level, backend-authoritative, and fail-safe.

🔹 Gate-12 — G12: Versioning & Performance
Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	12	ID-6.18	ACL	acl_versions	ACL change-sets are versioned as immutable snapshots; every structural ACL mutation (role, capability, override, module, approver) can be associated with a deterministic version identifier	No runtime binding yet between ACL evaluation and a specific acl_version; resolver always evaluates “latest truth”	Gate-12	ID-6.18	migrations/*_gate12_6_18_create_acl_versions.sql
🟡 HALF-DONE	12	ID-6.18A	ACL	precomputed_acl_view	Structural model exists to precompute effective ACL decisions per (user, company, resource, action) for fast lookup	Precompute job, invalidation strategy, and resolver consumption not implemented yet	Gate-12	ID-6.18A	migrations/*_gate12_6_18A_create_precomputed_acl_view.sql
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

🔹 Gate-13 — G13: RLS Binding & Fail-Safe Enforcement

📌 Gate-13 State Update (INSERT AS-IS)

Status	Gate	ID	Domain	Short_Name	Current_Reality	Why_Not_Complete	Completes_In_Gate	Completes_On_or_After_ID	Files_Involved
🟡 HALF-DONE	13	ID-6.19	DB	RLS binding for ACL	ACL-resolved context (company / project / department / admin flag) is now structurally bindable to Postgres RLS via request headers and helper functions	RLS policies are not yet ATTACHED to real business tables; no table-level USING / WITH CHECK proof exists	Gate-13	ID-6.19	supabase/migrations/2026XXXXXX_gate13_6_19_bind_acl_context_to_rls.sql
🟡 HALF-DONE	13	ID-6.19A	DB	RLS deny fallback	Deterministic fail-safe model exists: if ACL context is missing, mismatched, or uncertain → RLS yields zero rows (implicit DENY)	Fallback policies are not yet FORCE-ENABLED on business tables; absence-means-deny not yet provable on real data	Gate-13	ID-6.19A	supabase/migrations/2026XXXXXX_gate13_6_19A_rls_deny_fallback.sql
🔎 Mandatory Gate-13 Notes (Attach Below Table)

1️⃣ What G13 DOES

Binds runtime ACL context (from Gate-5 + Gate-11) to database enforcement

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

Gate-13 ONLY marked DONE when:

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

Gate-13 binds ACL truth to Postgres RLS and establishes fail-safe, deny-by-default data enforcement.
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
🟡	ID-6.14	Precedence ladder	Final evaluation order locked	Gate-11
🟡	ID-6.15	VWED engine	Deterministic engine implemented	Gate-11
🟡	ID-6.16	ACL resolver core	Final ALLOW/DENY resolver exists	Gate-11
🟡	ID-6.16A	Decision trace	Explainability model exists	Gate-11
🚫 Explicitly OUT-OF-SCOPE for Gate-6

The following are NOT missing — they are intentionally future-gated:

Concern	Correct Gate
ACL enforcement	Gate-11
Menu snapshot / UI	Gate-7
ACL versioning runtime	Gate-12
Precomputed ACL cache	Gate-12
RLS ENABLE / FORCE	Gate-13
RLS USING / WITH CHECK	Gate-13
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