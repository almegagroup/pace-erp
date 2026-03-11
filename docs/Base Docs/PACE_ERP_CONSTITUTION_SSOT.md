  🔒 PACE_ERP_CONSTITUTION_SSOT.md

  Status: FINAL
  Scope: Gate-0 → Gate-9 Structural Authority
  Nature: Binding Governance + Architecture + Operational Law

  SECTION 1 — SYSTEM AUTHORITY CONSTITUTION
  1.1 Backend = Single Source of Truth

  Identity validation → Supabase Auth

  Access decision → ERP

  Context resolution → ERP

  ACL evaluation → ERP

  Session lifecycle → ERP

  Frontend has ZERO authority.

  1.2 Supabase Scope

  Supabase answers:

  “Who are you?”

  ERP answers:

  “What are you allowed to do?”

  ERP never:

  Stores passwords

  Validates passwords

  Replaces auth.users

  SECTION 2 — RLS PHILOSOPHY (LOCKED)
  2.1 Default = DENY

  No ERP row is visible or mutable unless explicitly allowed by backend authority.

  2.2 Access Preconditions (ALL Required)

  Supabase identity exists

  ERP user exists

  ERP user state = ACTIVE

  Context valid

  ACL evaluation passes

  Failure of any = HARD DENY

  2.3 Schema Rules

  erp_core → RLS enforced

  erp_acl → backend only

  erp_audit → INSERT only (append-only)

  erp_meta → backend only

  anon role → zero ERP access

  Service role:

  Only via backend Edge Functions

  Never client exposed

  Controlled bypass only

  SECTION 3 — REQUEST PIPELINE LAW

  Pipeline order is immutable:

  Headers

  CORS

  CSRF

  Rate limit

  Session resolve

  Context resolve

  ACL resolve

  Handler

  Deviation = Structural violation.

  SECTION 4 — LOCAL = PRODUCTION PARITY LAW

  Logic must NEVER branch on:

  NODE_ENV

  localhost checks

  environment flags

  Only configuration values differ.
  Logic path never differs.

  SECTION 5 — FRONTEND CONTRACT LAW

  Frontend MUST NOT:

  Use Supabase SDK

  Perform auth logic

  Perform ACL logic

  Perform context resolution

  Hardcode domains

  Read/write auth cookies

  Infer auth from window.location

  Allowed env key:

  VITE_API_BASE

  All backend traffic:
  → Single Edge Function entry: api

  Frontend is domain-bound, not domain-authoritative.

  SECTION 6 — SESSION & COOKIE LAW

  Session:

  ERP controlled

  Single active session

  Idle timeout

  Absolute TTL

  Admin revoke allowed

  Cookie rules:

  HttpOnly

  SameSite=Lax

  Secure if HTTPS

  Path=/

  No Domain attribute

  Always overwrite

  Frontend never touches cookies.

  SECTION 7 — USER LIFECYCLE LAW

  Signup:

  Supabase user created

  ERP user created (PENDING)

  Human verification required

  Generic response

  Approval:

  SA approves ERP access

  ERP user → ACTIVE

  Default minimal ACL assigned

  Login success ≠ Dashboard access
  ACL must pass for dashboard.

  No FIRST_LOGIN_REQUIRED state exists.

  SECTION 8 — HUMAN VERIFICATION LAW

  Mandatory for:

  Signup

  Login

  Password reset

  Admin recovery

  Backend generates challenge
  Backend validates challenge
  Frontend never evaluates correctness

  No CAPTCHA
  No third-party dependency

  SECTION 9 — FILE DISCIPLINE LAW

  Every file MUST start with:

  /*
  * File-ID:
  * File-Path:
  * Gate:
  * Phase:
  * Domain:
  * Purpose:
  * Authority:
  */

  Missing header = INVALID file
  Invalid file:

  Must not be merged

  Must not be executed

  Must not be reviewed

  One file = One responsibility
  No hidden side effects

  SECTION 10 — MIGRATION-FIRST LAW

  All structural DB changes:

  Must be migration

  Idempotent

  Order-safe

  Environment-agnostic

  Manual DB edits forbidden.

  SECTION 11 — ADMIN UNIVERSE LAW

  SA / GA:

  Operate under ACL precedence-based unrestricted authority.
  ACL engine always evaluates; override occurs via highest rank rule.
  Pipeline, session, and context invariants are never bypassed.
  Security layers remain enforced.

  SECTION 12 — ROLES & RESPONSIBILITIES CONTRACT (BINDING)
  12.1 YOU (Project Owner)

  Business Owner

  Final Decision Authority

  Does NOT write code

  Does NOT resolve wiring

  Only checks file presence

  You MUST:

  Follow PACE_ERP_STATE.md

  Approve freeze

  Provide business decisions

  You MUST NOT:

  Debug dependencies

  Reconstruct logic

  Infer completion

  Maintain chat continuity

  12.2 ME (Architect & Builder)

  I MUST:

  Plan Gate-wise structure

  Deliver exact file path & content

  Declare dependencies

  Maintain state accuracy

  Introduce no surprise rules

  I MUST NOT:

  Change design silently

  Introduce hidden dependency

  Leave undocumented half-logic

  SECTION 13 — STATE FILE CONSTITUTION

  File name:
  PACE_ERP_STATE.md

  Location:

  /docs/
    SSOT.md
    GATE_X_FREEZE.md
    PACE_ERP_STATE.md

  Each row MUST contain:

  | Status | Gate | ID | Domain | Short_Name | Current_Reality | Why_Not_Complete | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved |

  Allowed status values:

  ✅ DONE

  🟡 HALF-DONE

  ⏸ DEFERRED

  🔒 FROZEN

  HALF-DONE valid only if:

  Why_Not_Complete written

  Completes_In_Gate written

  Completes_On_or_After_ID written

  No silent completion allowed.
  State file overrides chat memory.

  SECTION 14 — CHECKLIST GOVERNANCE SYSTEM
  Gate Entry Checklist

  Previous Gate frozen

  State updated

  HALF-DONE targets declared

  ID Completion Checklist

  Files exist

  DB tables exist

  Wiring complete

  State updated

  HALF-DONE Validation Checklist

  Missing piece declared

  Completion Gate declared

  Completion ID declared

  Gate Freeze Checklist

  All IDs DONE / valid DEFERRED

  State updated

  Freeze declaration row present

  Checklist > Chat > Explanation

  SECTION 15 — CONFLICT RESOLUTION ORDER

  This Constitution

  PACE_ERP_STATE.md

  Gate Freeze Docs

  Chat

  FINAL LOCK DECLARATION

  This document:

  Merges all previously provided governance documents

  Removes duplication

  Preserves every invariant

  Introduces zero new rules

  Drops zero existing rules

  This is now:
  🔒 Architectural + Governance Constitution
  Forensic Audit Base Layer