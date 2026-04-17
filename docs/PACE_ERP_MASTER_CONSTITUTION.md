# PACE ERP MASTER CONSTITUTION

## PART 1 — SYSTEM AUTHORITY (SSOT)

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

  Amendment — SECTION 16 (Database Access Law)

Status: FINAL
Authority: Architecture Law
Scope: All Backend DB Access (Gate-0 → ∞)

SECTION 16 — DATABASE SCHEMA ACCESS LAW
16.1 Non-Public Schema Rule

PACE-ERP database tables exist under multiple schemas:

erp_core
erp_master
erp_map
erp_menu
erp_acl
erp_audit
erp_cache
acl

No ERP table exists under public.

Therefore public schema must never be assumed by backend code.

16.2 Mandatory Query Pattern

All Supabase queries MUST explicitly declare schema.

Allowed pattern:

db.schema("erp_core").from("users")

Forbidden pattern:

db.schema("erp_core").from("users")

Reason:

Supabase client may default to:

public.<table>

Which leads to errors like:

Could not find the table 'public.erp_core.users'
16.3 Absolute Rule

Every database call must follow:

db.schema("<schema>").from("<table>")

Examples:

Correct
db.schema("erp_core").from("users")
db.schema("erp_master").from("companies")
db.schema("erp_map").from("user_projects")
db.schema("erp_menu").from("menu_master")
db.schema("erp_audit").from("workflow_events")
db.schema("erp_cache").from("gst_profiles")
Incorrect
db.schema("erp_core").from("users")
db.schema("erp_master").from("companies")
db.schema("erp_map").from("user_projects")
16.4 Enforcement Requirement

Any backend file violating this rule is considered:

STRUCTURAL VIOLATION

Such files:

Must not be merged
Must not pass review
Must not reach production
16.5 Review Checklist Addition

Code review must verify:

No usage of db.from("schema.table")

Instead verify:

db.schema("schema").from("table")
16.6 Migration Compatibility Guarantee

Using explicit schema ensures:

schema cache correctness
PostgREST compatibility
future migration safety
multi-schema isolation
16.7 Developer Responsibility

All future database code must follow schema-first access.

No exceptions allowed.

Amendment Summary

New binding law added:

SECTION 16 — DATABASE SCHEMA ACCESS LAW

This ensures:

No future schema resolution bugs
No PostgREST schema cache errors
No public schema assumptions

  This is now:
  🔒 Architectural + Governance Constitution
  Forensic Audit Base Layer

---

## PART 2 — COST CONTROL & BACKEND RULEBOOK

# ERP MASTER GUIDE
## Long-Term Cost Control Constitution & Backend SSOT Rulebook

---

# PART 1: ERP LONG-TERM COST CONTROL CONSTITUTION

## Article 1: Core Philosophy
ERP must run on minimum infrastructure for maximum duration.

Rules:
- Single backend as long as possible
- Single primary database as long as possible
- External storage for non-critical data
- Infrastructure expansion only when required

---

## Article 2: Database Usage Law

Allowed:
- Active business data
- Current workflow data
- Recent transactions (6–12 months)

Forbidden:
- Old logs indefinitely
- Files/images in DB
- Unused or redundant data

---

## Article 3: Log Retention Law

- Retention: 30–90 days maximum
- Older logs must be exported and deleted

Principle:
Logs are the biggest hidden cost driver.

---

## Article 4: Archive Law

Structure:
- Active DB → recent data
- External storage → historical data

Rules:
- Archive after 12–24 months
- Archive must be low-cost storage

---

## Article 5: Dashboard Law

Allowed:
- Manual refresh
- 30–60 second refresh (limited cases)

Forbidden:
- High-frequency polling
- Full-table scans

---

## Article 6: API Efficiency Law

Mandatory:
- Pagination
- Filtering
- Small response payloads

Forbidden:
- Unbounded queries
- Full dataset fetch

---

## Article 7: Infrastructure Expansion Law

Expansion allowed only when:
- System performance degrades
- User experience is affected

Forbidden:
- Preemptive scaling
- Over-engineering

---

## Article 8: Storage Law

Database:
- Structured relational data only

External storage:
- Logs
- Files
- Archive

---

## Article 9: Cost Trigger Rules

Upgrade only when:
- CPU > 80% sustained
- DB size exceeds threshold with growth
- API latency noticeable

---

## Article 10: Simplicity Principle

Simple systems scale longer and cheaper than complex systems.

---

# PART 2: ERP BACKEND SSOT RULEBOOK

## Section 1: Backend Authority

- Frontend has zero authority
- Backend controls all logic and data access

---

## Section 2: API Design

Standards:
- List endpoints must be paginated
- Detail endpoints return single entity
- Summary endpoints return aggregated data

---

## Section 3: Database Design

Mandatory columns:
- created_at
- updated_at

Indexing:
- user_id
- date/time fields
- status fields

---

## Section 4: Data Lifecycle

Flow:
Create → Active → Archive → Delete (logs only)

---

## Section 5: Performance Rules

Targets:
- API response < 500ms

Methods:
- Use summary tables
- Avoid heavy joins

---

## Section 6: Logging Rules

Allowed:
- Structured logs
- Error logs

Forbidden:
- Debug logs in production

---

## Section 7: Job Handling

Allowed:
- External cron
- Manual triggers

Forbidden:
- Early worker usage

---

## Section 8: Reporting Rules

Allowed:
- Summary-based reporting
- Filtered queries

Forbidden:
- Full dataset scans

---

## Section 9: Security Rules

Mandatory:
- RLS enabled
- Service keys hidden
- Backend-only DB access

---

## Section 10: Module Design

- Modules must be independent
- Avoid tight coupling

---

## Section 11: Scalability Path

Phase 1:
- Single backend
- Single DB

Phase 2:
- Archive system

Phase 3:
- Workers and scaling if needed

---

## Section 12: Anti-Patterns

- Full data fetch
- Continuous live polling
- Using DB for file storage
- Unlimited log retention
- Multiple DBs too early
- Over-engineering

---

# PART 3: IMPLEMENTATION CHECKLIST

## Step 1: Repository Audit

Check for:
- Unbounded queries
- Missing pagination
- Heavy queries
- Uncontrolled logging

---

## Step 2: Priority Fixes

High priority:
- Pagination
- Log retention
- API filters

Medium:
- Summary tables
- Archive structure

Low:
- Optimization
- Caching

---

## Step 3: System Additions

- Archive pipeline
- Summary tables
- Admin tools

---

## Step 4: Safeguards

- API limits
- Response size limits
- Log cleanup automation

---

# PART 4: HYBRID ARCHIVE ARCHITECTURE (USER-SEAMLESS + LOW COST)

## Objective

Ensure:
- User can access any historical data (including 3–5+ years)
- System cost remains low and controlled
- Database remains fast and small

---

## Layered Data Architecture

### Layer 1: Active Data (Supabase - Primary Tables)

- Last 2 Financial Years (Apr–Mar cycle)
- Used for all daily operations
- Fully indexed and optimized

---

### Layer 2: Archive Tables (Same Supabase DB)

- Additional 3–5 Financial Years
- Separate archive tables:
  - transactions_archive
  - production_archive
  - material_movement_archive

Properties:
- Queryable via SQL
- Indexed for key filters (material_id, date, plant)
- Used for most historical queries

---

### Layer 3: Deep Archive (External Storage)

- Very old data (5+ years)
- Stored in object storage (R2 / S3 / B2)

Properties:
- Compressed (JSON/CSV/GZIP)
- Immutable (append-only)
- Used rarely

---

## Data Lifecycle Policy

### Business Data

- Current FY + Previous FY → Active Tables
- Next 3–5 FY → Archive Tables
- Older → External Storage

---

### Logs

- 0–60 days → Active DB
- 60–365 days → External Archive
- 1+ year → Manual deletion

---

## Backend Query Routing Logic

Backend must determine source dynamically:

1. Query Active Tables
2. Query Archive Tables if needed
3. Fetch from Deep Archive if required
4. Merge and return unified response

---

## User Experience Rules

- User must not be aware of data layers
- All filters work uniformly
- For older data:
  - Show loader: "Fetching historical data..."

---

## Performance Strategy

- 90% queries → Active DB
- 9% queries → Archive Tables
- 1% queries → Deep Archive

---

## Cost Optimization Rules

- Keep Active DB small (2 FY)
- Limit Archive Tables to 3–5 FY
- Move oldest data to cheap storage
- Use compression for archive files

---

## Critical Design Principle

Data must remain queryable for business use.

Therefore:
- Business data archive = Database tables
- Logs/archive backup = External storage

---

## Anti-Pattern Warning

Do NOT:
- Temporarily load archive data into DB for queries
- Re-insert and delete large datasets repeatedly

Reason:
- High cost
- Performance degradation
- System instability

---

# PART 5: EXTERNAL ARCHIVE ACCESS & COST CONTROL

## Objective

Enable:
- Seamless access to 3+ year old business data
- Minimal database growth
- Ultra-low storage cost

---

## External Archive Principle

External archive is NOT a database.

- No direct SQL queries
- Data is stored as structured files
- Backend handles all access

---

## Architecture Flow

User → Frontend → Backend → (Active DB + Archive Tables + External Storage)

---

## Data Access Flow

When user requests historical data:

1. Query Active Tables
2. Query Archive Tables
3. If not found → Fetch from External Archive
4. Merge results
5. Return unified response

---

## File Structure Design (Critical)

Files must be split for efficient access:

Structure:

transactions/
  {year}/
    {month}/
      material_{id}.json.gz


Rules:
- Split by year → month → entity (material/production)
- Use compression (gzip)
- Keep files small and targeted

---

## Archive Index Table (Supabase)

Maintain metadata for fast lookup:

archive_index:
- year
- month
- entity_type
- entity_id
- file_path


Purpose:
- Quickly identify which file to load
- Avoid scanning storage

---

## Backend Fetch Logic

- Locate file via archive_index
- Fetch file from storage
- Decompress
- Filter required data
- Return response

---

## Performance Strategy

- Load only required files
- Never load full-year data unnecessarily
- Use selective fetch based on filters

---

## Cost Control Strategy

- External storage cost: ~$0.015/GB/month
- No egress cost (R2)
- DB size remains controlled

Example:
- 100GB archive ≈ $1.5/month

---

## User Experience Rules

- User must not know data source
- Show loader for historical data:
  "Fetching historical data..."

---

## Limitations

- No SQL joins on external data
- Slight latency for deep archive

---

## Anti-Patterns

Do NOT:
- Load full archive into DB temporarily
- Use large monolithic archive files
- Skip indexing metadata

---

## Final Design Principle

- Active data → Fast (DB)
- Mid history → Queryable (Archive Tables)
- Deep history → Cheap (External Storage)

---

# FINAL PRINCIPLE

ERP systems succeed when:
- Active data is fast
- Historical data is accessible
- Storage cost is controlled
- Complexity is minimized


> ERP systems fail due to complexity and uncontrolled data growth, not infrastructure cost.

---

## PART 3 — UNIFIED PRINCIPLES

The following overlap index is a pointer-only cross-reference between PART 1 and PART 2. No text from either source has been rewritten, paraphrased, or merged. Where the same topic is addressed in both Parts, both versions remain fully in force and must be read together.

| Overlapping Topic | PART 1 Anchor | PART 2 Anchor |
|---|---|---|
| Backend = Single Source of Truth / Frontend has zero authority | PART 1 — SECTION 1.1 (Backend = Single Source of Truth); PART 1 — SECTION 5 (Frontend Contract Law) | PART 2 — PART 2: ERP BACKEND SSOT RULEBOOK → Section 1: Backend Authority |
| Row-Level Security mandatory / Default DENY | PART 1 — SECTION 2 (RLS Philosophy — Locked); PART 1 — SECTION 2.1 (Default = DENY); PART 1 — SECTION 2.3 (Schema Rules) | PART 2 — PART 2: ERP BACKEND SSOT RULEBOOK → Section 9: Security Rules |
| Service role / service keys never client-exposed | PART 1 — SECTION 2.3 (Service role → Only via backend Edge Functions / Never client exposed) | PART 2 — PART 2: ERP BACKEND SSOT RULEBOOK → Section 9: Security Rules (Service keys hidden / Backend-only DB access) |
| Database access discipline / schema rules | PART 1 — SECTION 16 (Database Schema Access Law, 16.1 – 16.7) | PART 2 — PART 2: ERP BACKEND SSOT RULEBOOK → Section 3: Database Design |
| API / performance limits, pagination, filtering | (not covered in PART 1) | PART 2 — PART 1: ERP LONG-TERM COST CONTROL CONSTITUTION → Article 6: API Efficiency Law; PART 2 — PART 2: ERP BACKEND SSOT RULEBOOK → Section 2: API Design; PART 2 — PART 2: ERP BACKEND SSOT RULEBOOK → Section 5: Performance Rules |
| Log discipline / retention | (not covered in PART 1) | PART 2 — PART 1: ERP LONG-TERM COST CONTROL CONSTITUTION → Article 3: Log Retention Law; PART 2 — PART 2: ERP BACKEND SSOT RULEBOOK → Section 6: Logging Rules |
| Migration-first / structural DB changes | PART 1 — SECTION 10 (Migration-First Law) | PART 2 — PART 2: ERP BACKEND SSOT RULEBOOK → Section 3: Database Design (mandatory columns, indexing) |
| Data lifecycle / archive | (not covered in PART 1) | PART 2 — PART 2: ERP BACKEND SSOT RULEBOOK → Section 4: Data Lifecycle; PART 2 — PART 1: Article 4: Archive Law; PART 2 — PART 4: Hybrid Archive Architecture; PART 2 — PART 5: External Archive Access & Cost Control |

Conflict Resolution (unchanged from PART 1 — SECTION 15):

1. This Constitution (PART 1 + PART 2 + PART 3 together)
2. PACE_ERP_STATE.md
3. Gate Freeze Docs
4. Chat

Where PART 1 and PART 2 both speak to the same concern, BOTH apply. The stricter rule governs. No rule in either Part is weakened, relaxed, or overridden by this cross-reference index.
