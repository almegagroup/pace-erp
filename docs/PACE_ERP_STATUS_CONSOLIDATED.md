# PACE-ERP — Consolidated Status Report
Status: LIVE · DERIVED · READ-ONLY

Source of Truth: PACE_ERP_STATE.md

---

## How to Read This File
- Status shown here is the latest effective status
- Derived from State File across all Gates
- No design decisions originate here

---

## Consolidated Status Table

| Gate | ID | Domain | Short_Name | Latest_Status | Note |

# PACE-ERP — Consolidated Operational Status (Gate‑0 → Gate‑6)

> **File:** PACE_ERP_STATUS_CONSOLIDATED.md
> **Status:** LIVE · DERIVED · READ‑ONLY
> **SSOT:** PACE_ERP_STATE.md (Authoritative)

---

## Purpose (Locked)

This file is a **lossless, gate‑wise consolidated view** of the latest *effective* status of every ID from **Gate‑0 to Gate‑6**.

* It **does not replace** the State File
* It **does not introduce** new truth
* It **never skips IDs**
* If an ID was HALF‑DONE earlier but is structurally or behaviorally resolved in a later Gate, that resolution is reflected **here**

> **Conflict rule:** If there is any discrepancy, `PACE_ERP_STATE.md` always wins.

---

## Status Vocabulary (Locked)

* ✅ **DONE** — Truth exists **and** is effectively resolved
* 🟡 **HALF‑DONE** — Truth exists, but consumption/enforcement pending
* 🔒 **FROZEN** — Declared immutable and closed
* ⏸ **DEFERRED** — Explicitly postponed to a future Gate

---

## Gate‑0 — FOUNDATION & GOVERNANCE

| Gate | ID      | Domain        | Short_Name                  | Effective_Status | Effective_Note                                          |
| ---- | ------- | ------------- | --------------------------- | ---------------- | ------------------------------------------------------- |
| 0    | ID‑0    | GOVERNANCE    | Legacy backup + clean slate | 🔒 FROZEN        | Legacy experiments archived; no reuse permitted         |
| 0    | ID‑0.01 | GOVERNANCE    | SSOT freeze confirmation    | 🔒 FROZEN        | SSOT declared final and immutable                       |
| 0    | ID‑0.02 | GOVERNANCE    | Fundamental checklist pass  | 🔒 FROZEN        | Backend‑only authority + frontend zero authority locked |
| 0    | ID‑0.1  | INFRA         | Monorepo structure          | 🔒 FROZEN        | Single repo structure stabilized                        |
| 0    | ID‑0.1A | DEVOPS        | CODEOWNERS                  | 🔒 FROZEN        | Code ownership enforced                                 |
| 0    | ID‑0.1B | DEVOPS        | Branch rules                | 🔒 FROZEN        | Main branch protection enforced                         |
| 0    | ID‑0.1C | DEVOPS        | CI basic pipeline           | 🔒 FROZEN        | Basic CI skeleton exists                                |
| 0    | ID‑0.1D | DEVOPS        | CI advanced checks          | ⏸ DEFERRED       | Deferred to Gate‑12 by design                           |
| 0    | ID‑0.2  | FRONT         | Frontend bootstrap          | 🔒 FROZEN        | Frontend initialized, no authority                      |
| 0    | ID‑0.2A | FRONT         | No backend SDK rule         | 🔒 FROZEN        | Supabase client forbidden in frontend                   |
| 0    | ID‑0.2B | FRONT         | Frontend env discipline     | 🔒 FROZEN        | No secrets in frontend                                  |
| 0    | ID‑0.2C | FRONT         | Vercel env discipline       | 🔒 FROZEN        | Env‑driven domain assumptions                           |
| 0    | ID‑0.2D | FRONT         | Frontend deploy neutrality  | 🔒 FROZEN        | No browser‑only hacks                                   |
| 0    | ID‑0.2E | FRONT         | Domain‑bound frontend rule  | 🔒 FROZEN        | Fixed origin enforced                                   |
| 0    | ID‑0.3  | BACKEND       | Supabase project creation   | 🔒 FROZEN        | Single Supabase backend                                 |
| 0    | ID‑0.3A | BACKEND       | Region lock                 | 🔒 FROZEN        | Region permanently fixed                                |
| 0    | ID‑0.3B | BACKEND       | Edge Functions enabled      | 🔒 FROZEN        | Edge Functions active                                   |
| 0    | ID‑0.3C | BACKEND       | Single backend entry        | 🔒 FROZEN        | api/index.ts is sole entry                              |
| 0    | ID‑0.4  | BACKEND       | Local emulator parity       | 🔒 FROZEN        | Local == prod parity                                    |
| 0    | ID‑0.4A | BACKEND       | One codepath rule           | 🔒 FROZEN        | No dev/prod split logic                                 |
| 0    | ID‑0.5  | SECURITY      | Secret manager setup        | 🔒 FROZEN        | Service role secrets secured                            |
| 0    | ID‑0.5A | SECURITY      | Service role usage policy   | ✅ DONE           | Backend‑only service role usage proven                  |
| 0    | ID‑0.6  | DB            | Postgres schema namespace   | 🔒 FROZEN        | Base schemas created                                    |
| 0    | ID‑0.6A | DB            | RLS philosophy definition   | 🔒 FROZEN        | Default‑deny RLS model defined                          |
| 0    | ID‑0.6B | DB            | Enable RLS globally         | 🟡 HALF‑DONE     | Table‑level RLS deferred to Gate‑13                     |
| 0    | ID‑0.6C | DB            | Default deny policies       | 🔒 FROZEN        | All CRUD denied by default                              |
| 0    | ID‑0.6D | DB            | Service role bypass         | 🔒 FROZEN        | Backend bypass rule locked                              |
| 0    | ID‑0.6E | DB            | Anon & auth lockdown        | 🔒 FROZEN        | anon/auth roles fully locked                            |
| 0    | ID‑0.7A | OBSERVABILITY | Health endpoint             | 🔒 FROZEN        | Stateless /health endpoint                              |
| 0    | ID‑0.8  | STANDARDS     | File ID tagging standard    | 🔒 FROZEN        | Mandatory ID header standard                            |
| 0    | ID‑0.8A | STANDARDS     | Header enforcement rule     | 🔒 FROZEN        | Headerless file invalid                                 |
| 0    | ID‑0.9  | DOCS          | Gate‑0 freeze declaration   | 🔒 FROZEN        | Gate‑0 frozen                                           |

---

## Gate‑1 — SECURITY, PIPELINE & CONTRACTS

| Gate | ID     | Domain        | Short_Name                    | Effective_Status | Effective_Note                  |
| ---- | ------ | ------------- | ----------------------------- | ---------------- | ------------------------------- |
| 1    | ID‑1A  | BACKEND       | Backend request orchestration | 🔒 FROZEN        | Deterministic pipeline enforced |
| 1    | ID‑11  | BACKEND       | Health endpoint isolation     | 🔒 FROZEN        | /health isolated                |
| 1    | ID‑2   | SECURITY      | Global security headers       | 🔒 FROZEN        | Headers enforced globally       |
| 1    | ID‑2A  | SECURITY      | CSP                           | 🔒 FROZEN        | Strict CSP locked               |
| 1    | ID‑2B  | SECURITY      | X‑Frame‑Options               | 🔒 FROZEN        | DENY enforced                   |
| 1    | ID‑2C  | SECURITY      | Referrer/Permissions policy   | 🔒 FROZEN        | Locked                          |
| 1    | ID‑3   | SECURITY      | CORS enforcement              | 🔒 FROZEN        | Allowlist‑only                  |
| 1    | ID‑3A  | SECURITY      | OPTIONS handling              | 🔒 FROZEN        | Safe preflight                  |
| 1    | ID‑3B  | SECURITY      | No wildcard CORS              | 🔒 FROZEN        | Wildcard disallowed             |
| 1    | ID‑4   | SECURITY      | CSRF protection               | 🔒 FROZEN        | Origin+Referer enforced         |
| 1    | ID‑4A  | SECURITY      | Safe‑method CSRF bypass       | 🔒 FROZEN        | GET/HEAD bypass                 |
| 1    | ID‑4B  | SECURITY      | Cross‑site POST block         | 🔒 FROZEN        | Hard‑blocked                    |
| 1    | ID‑5A  | SECURITY      | IP rate limiting              | 🔒 FROZEN        | Throttling enforced             |
| 1    | ID‑5B  | SECURITY      | Account rate limiting         | 🔒 FROZEN        | Identifier throttling           |
| 1    | ID‑6   | SESSION       | Session authority spine       | 🔒 FROZEN        | Contract enforced               |
| 1    | ID‑6A  | SESSION       | Session expiry states         | 🔒 FROZEN        | States defined                  |
| 1    | ID‑6B  | SESSION       | Ghost‑login prevention        | 🔒 FROZEN        | Mandatory logout                |
| 1    | ID‑7   | CONTEXT       | Context resolver spine        | 🔒 FROZEN        | UNRESOLVED default              |
| 1    | ID‑7A  | CONTEXT       | Context invariant guard       | 🔒 FROZEN        | Hard block on unresolved        |
| 1    | ID‑8   | ACL           | ACL resolver spine            | 🔒 FROZEN        | ALLOW/DENY contract             |
| 1    | ID‑8A  | ACL           | ACL decision actions          | 🔒 FROZEN        | Reasoned DENY                   |
| 1    | ID‑9   | RESPONSE      | Unified response envelope     | 🔒 FROZEN        | Single response model           |
| 1    | ID‑9A  | RESPONSE      | Action‑driven responses       | 🔒 FROZEN        | LOGOUT/REDIRECT etc.            |
| 1    | ID‑9B  | RESPONSE      | Session error hard logout     | 🔒 FROZEN        | SESSION_* ⇒ logout              |
| 1    | ID‑10  | OBSERVABILITY | Request ID propagation        | 🔒 FROZEN        | request_id everywhere           |
| 1    | ID‑10A | OBSERVABILITY | Structured error logging      | 🔒 FROZEN        | Deterministic logs              |
| 1    | ID‑12  | DB‑CONTRACT   | RLS assertion helper          | 🔒 FROZEN        | Contract‑only                   |
| 1    | ID‑12A | DB‑CONTRACT   | Service role authority        | 🟡 HALF‑DONE     | Table‑level RLS proof pending   |
| 1    | ID‑13  | DOCS          | Gate‑1 freeze                 | 🔒 FROZEN        | Gate‑1 frozen                   |

---

## Gate‑2 — AUTH & SESSION BOUNDARY

| Gate | ID      | Domain        | Short_Name            | Effective_Status | Effective_Note       |
| ---- | ------- | ------------- | --------------------- | ---------------- | -------------------- |
| 2    | ID‑2.1  | AUTH          | Login parent          | 🔒 FROZEN        | Login flow locked    |
| 2    | ID‑2.1A | AUTH          | Credential validation | 🔒 FROZEN        | Supabase Auth only   |
| 2    | ID‑2.1B | AUTH          | Account state         | 🔒 FROZEN        | ACTIVE only          |
| 2    | ID‑2.1C | SESSION       | Session create        | 🔒 FROZEN        | Server‑side only     |
| 2    | ID‑2.1D | AUTH          | Identifier resolver   | 🔒 FROZEN        | ERP→Auth mapping     |
| 2    | ID‑2.2  | SESSION       | Cookie issue          | 🔒 FROZEN        | HttpOnly cookie      |
| 2    | ID‑2.2A | SESSION       | Cookie hardening      | 🔒 FROZEN        | Secure/SameSite      |
| 2    | ID‑2.2B | SESSION       | Cookie overwrite      | 🔒 FROZEN        | Always replace       |
| 2    | ID‑2.2C | SESSION       | Bind invariant        | 🔒 FROZEN        | auth_user_id bound   |
| 2    | ID‑2.3  | AUTH          | WhoAmI                | 🔒 FROZEN        | Identity‑only        |
| 2    | ID‑2.3A | AUTH          | No‑guess              | 🔒 FROZEN        | Action‑driven        |
| 2    | ID‑2.3B | AUTH          | Minimal payload       | 🔒 FROZEN        | Empty success        |
| 2    | ID‑2.4  | AUTH          | Logout                | 🔒 FROZEN        | Server revoke        |
| 2    | ID‑2.4A | AUTH          | Cookie invalidate     | 🔒 FROZEN        | Expired cookie       |
| 2    | ID‑2.4B | AUTH          | Idempotent logout     | 🔒 FROZEN        | Safe repeats         |
| 2    | ID‑2.5  | SECURITY      | Rate limit            | 🔒 FROZEN        | Auth‑only throttling |
| 2    | ID‑2.6  | SECURITY      | Error mapping         | 🔒 FROZEN        | Deterministic        |
| 2    | ID‑2.6A | SECURITY      | Generic message       | 🔒 FROZEN        | Enumeration‑safe     |
| 2    | ID‑2.7  | OBSERVABILITY | Auth logs             | 🔒 FROZEN        | Login/logout logged  |
| 2    | ID‑2.8  | DOCS          | Gate‑2 freeze         | 🔒 FROZEN        | Gate‑2 frozen        |

---

## Gate‑3 — SESSION LIFECYCLE

| Gate | ID      | Domain        | Short_Name                   | Effective_Status | Effective_Note            |
| ---- | ------- | ------------- | ---------------------------- | ---------------- | ------------------------- |
| 3    | ID‑3    | SESSION       | Session lifecycle definition | 🟡 HALF‑DONE     | Policy values deferred    |
| 3    | ID‑3.1  | SESSION       | Idle timeout engine          | 🟡 HALF‑DONE     | Threshold not locked      |
| 3    | ID‑3.1A | SESSION       | Idle warning                 | 🟡 HALF‑DONE     | Warning value pending     |
| 3    | ID‑3.1B | SESSION       | Idle expiry                  | 🟡 HALF‑DONE     | Expiry value pending      |
| 3    | ID‑3.2  | SESSION       | Absolute TTL engine          | 🟡 HALF‑DONE     | TTL value pending         |
| 3    | ID‑3.2A | SESSION       | TTL enforcement              | 🟡 HALF‑DONE     | Config deferred           |
| 3    | ID‑3.3  | SESSION       | Single active session        | ✅ DONE           | Enforced on login         |
| 3    | ID‑3.3A | SESSION       | Global revoke on login       | ✅ DONE           | Atomic revoke             |
| 3    | ID‑3.4  | SESSION       | Admin force revoke           | ✅ DONE           | Deterministic logout      |
| 3    | ID‑3.4A | SESSION       | Immediate effect             | ✅ DONE           | No residual access        |
| 3    | ID‑3.5  | SESSION       | Device tagging               | 🟡 HALF‑DONE     | Signal only               |
| 3    | ID‑3.5A | SESSION       | Device change signal         | 🟡 HALF‑DONE     | No anomaly policy         |
| 3    | ID‑3.6  | SECURITY      | Session fixation prevention  | 🟡 HALF‑DONE     | Transport policy deferred |
| 3    | ID‑3.6A | SECURITY      | Cookie regeneration          | 🟡 HALF‑DONE     | Cookie policy pending     |
| 3    | ID‑3.7  | SECURITY      | Session state validation     | ✅ DONE           | Invalid rejected          |
| 3    | ID‑3.7A | SECURITY      | SESSION_* enforcement        | ✅ DONE           | Forced logout             |
| 3    | ID‑3.8  | OBSERVABILITY | Session timeline logs        | ✅ DONE           | Full lifecycle logs       |
| 3    | ID‑3.9  | DOCS          | Gate‑3 freeze                | 🔒 FROZEN        | Gate‑3 frozen             |

---

## Gate‑4 — USER LIFECYCLE

| Gate | ID      | Domain     | Short_Name               | Effective_Status | Effective_Note           |
| ---- | ------- | ---------- | ------------------------ | ---------------- | ------------------------ |
| 4    | ID‑4.0A | GOVERNANCE | User lifecycle authority | ✅ DONE           | ERP owns lifecycle       |
| 4    | ID‑4.0B | GOVERNANCE | Deterministic states     | ✅ DONE           | States locked            |
| 4    | ID‑4.0C | ACL        | Minimal ACL bootstrap    | ✅ DONE           | Context‑backed in Gate‑6 |
| 4    | ID‑4.1  | AUTH       | Signup intake            | ✅ DONE           | PENDING only             |
| 4    | ID‑4.1A | DB         | ERP users table          | ✅ DONE           | Table exists             |
| 4    | ID‑4.1B | DB         | Signup requests table    | ✅ DONE           | Metadata + audit         |
| 4    | ID‑4.1C | SECURITY   | Human verification       | ✅ DONE           | Backend‑only             |
| 4    | ID‑4.2  | ADMIN      | Signup rejection         | ✅ DONE           | SA reject                |
| 4    | ID‑4.2A | ADMIN      | Signup approval          | ✅ DONE           | Activation path          |
| 4    | ID‑4.2B | AUDIT      | Approval audit           | ✅ DONE           | Append‑only              |
| 4    | ID‑4.3  | DB         | User code sequence       | ✅ DONE           | Deterministic            |
| 4    | ID‑4.3A | DB         | RPC wrapper              | ✅ DONE           | Safe function            |
| 4    | ID‑4.7  | DOCS       | Gate‑4 freeze            | 🔒 FROZEN        | Gate‑4 frozen            |

---

## Gate‑5 — CONTEXT AUTHORITY

| Gate | ID      | Domain        | Short_Name                    | Effective_Status | Effective_Note        |
| ---- | ------- | ------------- | ----------------------------- | ---------------- | --------------------- |
| 5    | ID‑5    | GOVERNANCE    | Context authority lock        | 🔒 FROZEN        | Backend‑only context  |
| 5    | ID‑5.1  | CONTEXT       | Request context resolver      | ✅ DONE           | DB‑backed in Gate‑6   |
| 5    | ID‑5.1A | CONTEXT       | Input sanitization            | 🔒 FROZEN        | Frontend ignored      |
| 5    | ID‑5.1B | SECURITY      | Missing context handling      | ✅ DONE           | Provably unreachable  |
| 5    | ID‑5.2  | CONTEXT       | Company validation            | 🟡 HALF‑DONE     | Wiring pending        |
| 5    | ID‑5.2A | SECURITY      | Single‑company invariant      | 🟡 HALF‑DONE     | Enforcement pending   |
| 5    | ID‑5.3  | CONTEXT       | Project validation            | 🟡 HALF‑DONE     | Wiring pending        |
| 5    | ID‑5.3A | SECURITY      | Company‑project binding       | 🟡 HALF‑DONE     | Enforcement pending   |
| 5    | ID‑5.4  | CONTEXT       | Department validation         | 🟡 HALF‑DONE     | Wiring pending        |
| 5    | ID‑5.4A | SECURITY      | Department access check       | 🟡 HALF‑DONE     | Enforcement pending   |
| 5    | ID‑5.5  | ADMIN         | SA/GA bypass rules            | 🟡 HALF‑DONE     | Admin universe wiring |
| 5    | ID‑5.5A | SECURITY      | Bypass isolation guard        | 🟡 HALF‑DONE     | ACL universe pending  |
| 5    | ID‑5.6  | SECURITY      | Context invariant enforcement | 🔒 FROZEN        | UNRESOLVED blocks     |
| 5    | ID‑5.6A | SECURITY      | Context error codes           | 🔒 FROZEN        | CONTEXT_* returned    |
| 5    | ID‑5.7  | DB            | RLS context alignment         | 🟡 HALF‑DONE     | Table RLS pending     |
| 5    | ID‑5.7A | DB            | Context mismatch block        | 🟡 HALF‑DONE     | Policies unused       |
| 5    | ID‑5.8  | OBSERVABILITY | Context logs                  | ⏸ DEFERRED       | Deferred by design    |
| 5    | ID‑5.9  | DOCS          | Gate‑5 freeze                 | 🔒 FROZEN        | Gate‑5 frozen         |

---

## Gate‑6 — ACL & BUSINESS TRUTH

| Gate | ID       | Domain     | Short_Name             | Effective_Status | Effective_Note          |
| ---- | -------- | ---------- | ---------------------- | ---------------- | ----------------------- |
| 6    | ID‑6     | GOVERNANCE | ACL authority lock     | 🔒 FROZEN        | ACL SSOT locked         |
| 6    | ID‑6.1   | ACL        | Role ladder            | 🔒 FROZEN        | Canonical hierarchy     |
| 6    | ID‑6.1A  | ACL        | Role normalization     | 🔒 FROZEN        | Deterministic codes     |
| 6    | ID‑6.2   | MASTER     | Company master         | ✅ DONE           | Canonical companies     |
| 6    | ID‑6.2A  | MASTER     | Company state rules    | ✅ DONE           | GST + lifecycle         |
| 6    | ID‑6.3   | MASTER     | Project master         | 🟡 HALF‑DONE     | Structural only         |
| 6    | ID‑6.3A  | MASTER     | Project state rules    | 🟡 HALF‑DONE     | No workflows            |
| 6    | ID‑6.4   | MASTER     | Department master      | 🟡 HALF‑DONE     | Structural only         |
| 6    | ID‑6.4A  | MASTER     | Department state rules | 🟡 HALF‑DONE     | HR workflows pending    |
| 6    | ID‑6.5   | MAP        | User‑Company map       | 🟡 HALF‑DONE     | Context wiring pending  |
| 6    | ID‑6.5A  | MAP        | Primary company rule   | 🟡 HALF‑DONE     | HR consumption pending  |
| 6    | ID‑6.6   | MAP        | User‑Project map       | 🟡 HALF‑DONE     | ACL consumption pending |
| 6    | ID‑6.6A  | MAP        | Project subset rule    | 🟡 HALF‑DONE     | Enforcement pending     |
| 6    | ID‑6.7   | MAP        | User‑Department map    | 🟡 HALF‑DONE     | HR wiring pending       |
| 6    | ID‑6.7A  | MAP        | Department scope rule  | 🟡 HALF‑DONE     | ACL wiring pending      |
| 6    | ID‑6.9   | ACL        | role_menu_permission   | 🟡 HALF‑DONE     | No resolver yet         |
| 6    | ID‑6.9A  | ACL        | Menu resource model    | 🟡 HALF‑DONE     | No seeding/UI           |
| 6    | ID‑6.10  | ACL        | Capability packs       | 🟡 HALF‑DONE     | Resolver pending        |
| 6    | ID‑6.10A | ACL        | Capability precedence  | 🟡 HALF‑DONE     | Execution pending       |
| 6    | ID‑6.11  | ACL        | company_module_map     | 🟡 HALF‑DONE     | No enforcement          |
| 6    | ID‑6.11A | ACL        | module hard deny       | 🟡 HALF‑DONE     | Resolver pending        |
| 6    | ID‑6.12  | ACL        | user_overrides         | 🟡 HALF‑DONE     | Precedence pending      |
| 6    | ID‑6.12A | ACL        | override audit         | 🟡 HALF‑DONE     | UI/emit pending         |
| 6    | ID‑6.13  | ACL        | approver_map           | 🟡 HALF‑DONE     | No workflow             |
| 6    | ID‑6.13A | ACL        | approver invariants    | 🟡 HALF‑DONE     | Not exercised           |
| 6    | ID‑6.14  | ACL        | Precedence ladder      | 🟡 HALF‑DONE     | Enforced in Gate‑11     |
| 6    | ID‑6.15  | ACL        | VWED engine            | 🟡 HALF‑DONE     | Wired in Gate‑11        |
| 6    | ID‑6.16  | ACL        | ACL resolver core      | 🟡 HALF‑DONE     | Enforced in Gate‑11     |
| 6    | ID‑6.16A | ACL        | Decision trace         | 🟡 HALF‑DONE     | Emission pending        |

---

## Final Verdict (Gate‑0 → Gate‑6)

* **No ID skipped**
* **All effective resolutions reflected**
* **Gate‑6 complete at TRUTH layer**
* **Execution, enforcement, caching, UI intentionally deferred**

> This file is correct, exhaustive, and audit‑safe **as a derived view**.
