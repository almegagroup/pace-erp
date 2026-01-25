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

### Gate‑0

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


### Gate‑1

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
