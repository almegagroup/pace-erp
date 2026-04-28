# HR Attendance — Full Design Authority

**Classification:** Design SSOT
**Status:** FINAL — Ready for Implementation
**Created:** 2026-04-27
**Basis:** Repository audit + full design session

---

## PURPOSE

This document is the single source of truth for the Leave / Out Work / Attendance redesign.

It covers:
- Current state and its limitations
- Problem diagnosis
- Target future-ready data model
- Workflow design
- Out Work partial-day design
- Governance and correction design
- Future biometric readiness
- Phase map with weightages

Companion files:
- `HR_ATTENDANCE_IMPLEMENTATION_PLAN.md` — detailed implementation instructions per phase
- `HR_ATTENDANCE_PROGRESS_LOG.md` — live log of what has been done

---

## PART 1 — CURRENT STATE

### What exists today

The ERP has two HR request flows built on a shared pattern.

**Leave** (`erp_hr.leave_requests`):
- User submits `from_date`, `to_date`, `reason`
- System computes `total_days` (inclusive)
- Request flows through `acl.workflow_requests`
- States: PENDING → APPROVED / REJECTED / CANCELLED
- No leave type field exists

**Out Work** (`erp_hr.out_work_requests`):
- User submits `from_date`, `to_date`, `reason`, `destination_name`, `destination_address`
- Same workflow engine
- Only full-day range supported — no partial-day official movement

**Infrastructure that is solid and must be preserved:**
- Workflow engine with ANYONE / SEQUENTIAL / MUST_ALL approval types
- ACL-based approver and viewer scoping
- Audit trail in `erp_audit.workflow_events`
- Multi-tenant `parent_company_id` isolation
- Kolkata-timezone-aware date logic
- 3-day backdate protection
- Register/report views with CSV export

**What does not exist:**
- Attendance module (no tables, no routes, no UI)
- Leave types
- Date-wise expansion of any request
- Leave balance or entitlements
- Partial-day out-work
- HR backdated application on behalf of employee
- Manual attendance correction
- Any reconciliation concept

---

## PART 2 — PROBLEM DIAGNOSIS

The current design works as a **request tracker**, not as an **HR data source**.

### Problem 1 — Range is an opaque blob

A leave from 14 Apr → 17 Apr with `total_days = 4` is stored as one row.
The system cannot answer "Was 15 Apr a leave day for this person?" without range arithmetic.
Future biometric: when a punch arrives for 15 Apr, what status does it reconcile against? The schema has no answer.

### Problem 2 — No leave type

All leave is a generic blob. Cannot report by type. Cannot enforce balance limits. Cannot compute carry-forward.

### Problem 3 — Out Work is too blunt

An employee who came to office at 10 AM and left for field duty at 12 PM cannot be represented.
Storing this as a full-day out-work record is factually incorrect.

### Problem 4 — HR calculates everything manually

No system-generated date-wise view. HR must mentally compute date ranges.
This breaks down completely at scale.

### Problem 5 — Backdate limit blocks legitimate late applications

3-day backdate limit is correct for employee self-discipline.
But if an employee forgets and HR needs to apply on their behalf after 3 days, there is no mechanism.
Without this, absent days incorrectly deduct from salary instead of leave balance.

### Problem 6 — No manual correction for missed punches

When biometric arrives, a missed punch with no declared leave = Absent.
There is no mechanism for HR to correct this to Present with audit trail.

### Problem 7 — No biometric landing zone

When biometric integration arrives, there is no table where it can land.
The system would require a redesign at that point, not just an addition.

---

## PART 3 — CORE DESIGN PRINCIPLE

> A **request** is a user action.
> An **attendance day record** is the ground truth for a calendar day.
> These are two separate concepts.
> The request creates or updates the day record.
> The day record is what HR and future biometric both consume.

### Three Layers

```
Layer 1 — Request Layer
  What the user (or HR on their behalf) submitted.
  Leave request, Out Work request.
  Range-based. Stored in leave_requests / out_work_requests.

Layer 2 — Day Record Layer
  One row per employee per calendar day.
  The ground truth of what happened that day.
  Populated when a request is approved.
  Queryable directly — no range arithmetic.

Layer 3 — (Future) Biometric Punch Layer
  Raw punch events from biometric hardware.
  Reconciled against Day Records.
  NOT being built now. Columns reserved.
```

Layers 1 and 2 are being built now.
Layer 3 columns exist in the schema but hold NULL values until biometric is integrated.

---

## PART 4 — DATA MODEL

### Entity 1 — `erp_hr.leave_types`

The catalogue of leave types per company. Extensible, not hardcoded.

```
leave_type_id          UUID          PK
company_id             UUID          FK → erp_master.companies
type_code              TEXT          e.g. "CL", "SL", "EL", "LOP", "GEN"
type_name              TEXT          e.g. "Casual Leave", "Sick Leave"
is_paid                BOOLEAN       whether this leave is paid
requires_document      BOOLEAN       e.g. sick leave may need medical certificate
max_days_per_year      INTEGER       nullable — NULL means unlimited
carry_forward_allowed  BOOLEAN
is_active              BOOLEAN       default TRUE
sort_order             INTEGER       for display ordering
created_at             TIMESTAMPTZ
created_by             UUID          FK → auth.users

UNIQUE (company_id, type_code)
INDEX on (company_id, is_active, sort_order)
```

Seeded per company on setup: GEN, CL, SL, EL, LOP (General — for migration of old rows).
Nothing in the leave flow is hardcoded to type codes.

`max_days_per_year` and `carry_forward_allowed` are present now but not enforced yet.
They will be the foundation for the future Leave Policy & Balance module.
Do not remove or repurpose these columns.

**Management Authority:**

| Actor | Can Do | Restriction |
|---|---|---|
| HR user with `HR_LEAVE_TYPE_MANAGE` permission | Add, edit, deactivate leave types for their own company | Cannot touch other companies' types |
| SA | Add, edit, deactivate for any company | Full access — used for initial setup or extension beyond HR scope |
| Employee / Approver | None | Read-only (sees active types in dropdown only) |

SA does not manage leave types day-to-day. SA uses the existing ACL admin panel to assign the `HR_LEAVE_TYPE_MANAGE` resource code to the appropriate HR users per company. Those HR users then manage their own company's leave catalogue.

**Deactivation behaviour:**
- `is_active = FALSE` → type no longer appears in the leave apply dropdown
- Existing approved requests and day records using this type are unaffected
- A deactivated type can be reactivated at any time
- A type cannot be hard-deleted if any leave_request references it (FK constraint prevents this)

**New company seeding:**
The 5 default types (GEN, CL, SL, EL, LOP) are seeded:
1. By the Phase 1-A migration (for all existing companies at migration time)
2. By the `createCompanyHandler` in future (when a new company is created — hook must seed defaults)
   This hook is part of Phase 1-B scope.

---

### Entity 2 — `erp_hr.leave_requests` (extended)

Existing table extended. No column removed. No existing row broken.

```
leave_request_id        UUID          PK   (existing)
workflow_request_id     UUID          FK   (existing)
requester_auth_user_id  UUID          FK   (existing)
parent_company_id       UUID          FK   (existing)
leave_type_id           UUID          FK → erp_hr.leave_types    ← NEW
applied_by_auth_user_id UUID          FK → auth.users            ← NEW (nullable)
                                       NULL = self-applied
                                       non-NULL = HR applied on behalf
from_date               DATE               (existing)
to_date                 DATE               (existing)
total_days              INTEGER            (existing)
effective_leave_days    INTEGER       nullable   ← NEW
                                       calendar days minus sandwiched holidays/week-offs
                                       NULL means not yet computed (pre-Phase 2 rows)
                                       used for leave balance deduction (Phase 8)
reason                  TEXT               (existing)
cancelled_at            TIMESTAMPTZ        (existing)
cancelled_by            UUID               (existing)
created_at              TIMESTAMPTZ        (existing)
created_by              UUID               (existing)
```

`applied_by_auth_user_id` distinguishes self-application from HR backdated application.
Existing rows: `applied_by_auth_user_id = NULL` (self-applied, backward compatible).

`effective_leave_days` captures the sandwich-adjusted leave count calculated at apply-time.
- `total_days` = raw inclusive calendar days (e.g. Mon–Fri = 5, always includes holidays/week-offs)
- `effective_leave_days` = days actually charged after sandwich rule (excludes leading/trailing holidays/week-offs)
- Example: Mon (leave) → Tue (holiday) → Wed (leave) → `total_days = 3`, `effective_leave_days = 3` (sandwich applies)
- Example: Mon (leave) → Tue (holiday) → no more leave → `total_days = 2`, `effective_leave_days = 1`
- Existing rows: NULL (will not be backfilled — Phase 8 balance will treat NULL as total_days)

---

### Entity 3 — `erp_hr.out_work_requests` (extended)

```
out_work_request_id       UUID          PK   (existing)
workflow_request_id       UUID          FK   (existing)
requester_auth_user_id    UUID          FK   (existing)
parent_company_id         UUID          FK   (existing)
destination_id            UUID          FK   (existing, nullable)
destination_name          TEXT               (existing)
destination_address       TEXT               (existing)
from_date                 DATE               (existing)
to_date                   DATE               (existing)
total_days                INTEGER            (existing)
day_scope                 TEXT          NOT NULL DEFAULT 'FULL_DAY'   ← NEW
                                         "FULL_DAY" | "PARTIAL_DAY"
office_departure_time     TIME          nullable                       ← NEW
                                         required when day_scope = PARTIAL_DAY
applied_by_auth_user_id   UUID          FK → auth.users  nullable     ← NEW
reason                    TEXT               (existing)
cancelled_at              TIMESTAMPTZ        (existing)
cancelled_by              UUID               (existing)
created_at                TIMESTAMPTZ        (existing)
created_by                UUID               (existing)
```

Constraints:
- `day_scope = 'PARTIAL_DAY'` → `from_date` must equal `to_date` (enforced in handler)
- `day_scope = 'PARTIAL_DAY'` → `office_departure_time` is required
- `day_scope = 'FULL_DAY'` → `office_departure_time` must be NULL

Existing rows: `day_scope = 'FULL_DAY'`, `office_departure_time = NULL` (via migration backfill).

---

### Entity 4 — `erp_hr.employee_day_records` ← THE CORE NEW TABLE

One row per employee per calendar day. The ground truth.

```
day_record_id              UUID          PK
company_id                 UUID          FK → erp_master.companies
employee_auth_user_id      UUID          FK → auth.users
record_date                DATE          the calendar day

declared_status            TEXT          NOT NULL
                                          "PRESENT"
                                          "LEAVE"
                                          "OUT_WORK"
                                          "HOLIDAY"
                                          "WEEK_OFF"
                                          "ABSENT"
                                          "MISS_PUNCH"   (future biometric only)

leave_request_id           UUID          FK → erp_hr.leave_requests     nullable
leave_type_id              UUID          FK → erp_hr.leave_types         nullable
out_work_request_id        UUID          FK → erp_hr.out_work_requests   nullable
out_work_day_scope         TEXT          nullable: "FULL_DAY" | "PARTIAL_DAY"
out_work_departure_time    TIME          nullable

-- Future biometric columns (present now, NULL until biometric integration)
biometric_first_punch      TIMESTAMPTZ   nullable
biometric_last_punch       TIMESTAMPTZ   nullable
biometric_work_minutes     INTEGER       nullable
biometric_reconciled_at    TIMESTAMPTZ   nullable
biometric_reconcile_note   TEXT          nullable

-- Manual correction audit
manually_corrected         BOOLEAN       default FALSE
corrected_by               UUID          FK → auth.users  nullable
corrected_at               TIMESTAMPTZ   nullable
correction_note            TEXT          nullable
previous_status            TEXT          nullable  (what it was before correction)

-- Record lifecycle
source                     TEXT          NOT NULL
                                          "LEAVE_APPROVED"
                                          "OUT_WORK_APPROVED"
                                          "HOLIDAY_CALENDAR"
                                          "WEEK_OFF_CALENDAR"
                                          "MANUAL_HR"
                                          "BIOMETRIC_AUTO"   (future)
created_at                 TIMESTAMPTZ
updated_at                 TIMESTAMPTZ

UNIQUE (company_id, employee_auth_user_id, record_date)
INDEX on (company_id, record_date, declared_status)
INDEX on (company_id, employee_auth_user_id, record_date DESC)
```

**Why this table solves everything:**

Query: "What was Rohan doing on 15 Apr?"
→ `SELECT * FROM employee_day_records WHERE employee = X AND record_date = '2026-04-15'`
→ One row. One answer.

Query: "How many casual leave days did Rohan take in April?"
→ `COUNT(*) WHERE declared_status = 'LEAVE' AND leave_type_id = CL_type AND record_date BETWEEN ...`
→ Pure aggregation. No range arithmetic.

Future biometric: punch arrives for Rohan on 15 Apr
→ Look up day record
→ If `declared_status = 'LEAVE'` → exception, employee punched on a leave day
→ If no row exists → create row as PRESENT, fill biometric columns
→ No model change required.

`UNIQUE (company_id, employee_auth_user_id, record_date)` = one truth per person per day.

---

### Entity 5 — `erp_hr.company_holiday_calendar`

Per-company holiday dates. Lazy approach — only rows that exist count as holidays.
No pre-population of day records for all employees. The calendar is consulted at apply-time
for sandwich calculation, and at approval-time to guard `upsert_day_record_leave`.

```
holiday_id     UUID          PK
company_id     UUID          FK → erp_master.companies
holiday_date   DATE          the calendar date
holiday_name   TEXT          descriptive label, e.g. "Diwali", "Republic Day"
created_at     TIMESTAMPTZ
created_by     UUID          FK → auth.users

UNIQUE (company_id, holiday_date)
INDEX on (company_id, holiday_date)
```

**Management Authority:**

| Actor | Can Do | Restriction |
|---|---|---|
| HR user with `HR_CALENDAR_MANAGE` permission | Add, edit, delete holidays for their own company | Cannot touch other companies' calendars |
| SA | Full access | Used for initial setup |
| Employee / Approver | None | Not visible to non-HR |

`HR_CALENDAR_MANAGE` is a new resource code. SA assigns it to HR users via the ACL admin panel
(same pattern as `HR_LEAVE_TYPE_MANAGE`).

Holidays are always company-scoped. National holidays must be entered per-company by HR.
There is no shared global holiday list — each company maintains its own.

---

### Entity 6 — `erp_hr.company_week_off_config`

Per-company weekly off day configuration. Defaults: Saturday and Sunday (days 6 and 0 in JS DOW).

```
week_off_config_id   UUID          PK
company_id           UUID          FK → erp_master.companies  UNIQUE
week_off_days        INTEGER[]     array of ISO weekday numbers
                                    1=Monday, 2=Tuesday, ..., 6=Saturday, 7=Sunday
                                    Default: [6, 7]  (Saturday, Sunday)
updated_at           TIMESTAMPTZ
updated_by           UUID          FK → auth.users
```

`UNIQUE (company_id)` — exactly one config row per company.

If no row exists for a company → default week-off days are Saturday and Sunday.
This means the table starts empty and only needs a row when a company deviates from the default.

**Management Authority:** Same as holiday calendar — `HR_CALENDAR_MANAGE` required.

**Day numbering:** ISO weekday convention: 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun.
Backend must normalize DOW comparisons to ISO weekday numbers consistently.

---

### Entity Relationships

```
leave_types ──────────────────────── leave_requests
                                            │
                        ┌───────────────────┤
                        │                   │
                        ▼                   ▼
              employee_day_records ←── out_work_requests
                        │
                        ▼
              (future) biometric_punches

company_holiday_calendar ─────────────────────────────┐
company_week_off_config  ─────────────────────────────┤
                                                       ▼
                                          (consulted at apply-time for
                                           sandwich calc + block rule;
                                           guard in upsert functions)
```

---

## PART 5 — WORKFLOW DESIGN

### User Self-Apply Flow — Leave

```
1. User opens Apply Leave
2. Selects leave_type from dropdown (loaded from leave_types for their company)
3. Selects from_date, to_date
4. System shows expansion preview: "4 days — 14 Apr (Mon), 15 Apr (Tue) ..."
5. User enters reason
6. Submits

Backend:
- Validates date range, backdate limit (3 days — existing logic)
- Validates leave_type_id belongs to company
- Checks no overlapping approved leave or out-work for any date in range
- Creates leave_request (with leave_type_id, applied_by_auth_user_id = NULL)
- Creates workflow_request
- Does NOT create day_records — request is PENDING
```

### User Self-Apply Flow — Out Work

```
1. User opens Apply Out Work
2. Selects Day Scope: Full Day / Partial Day
3. If FULL_DAY: selects from_date, to_date
   If PARTIAL_DAY: selects single date, enters office_departure_time
4. Selects destination
5. Enters reason
6. Submits

Backend:
- If PARTIAL_DAY: enforces from_date == to_date
- Validates no overlap with existing approved leave for same dates
- Creates out_work_request
- Creates workflow_request
- Does NOT create day_records
```

### HR Backdated Apply Flow

```
1. HR opens Attendance Correction screen
2. Selects employee, date
3. Sees current status for that date (Absent or no record)
4. Selects "Apply Leave on behalf" or "Apply Out Work on behalf"
5. Fills form (leave_type, reason, etc.)
6. Submits

Backend:
- Requires HR_LEAVE_BACKDATED_APPLY or HR_OUT_WORK_BACKDATED_APPLY permission
- No backdate limit for HR
- Sets applied_by_auth_user_id = HR's user ID (not NULL)
- Workflow is created normally — goes to approver
- HR cannot approve their own backdated application (workflow rule)
- A different authorized person must approve
```

### Approver Leave Type Override (Before Decision)

An employee may submit a leave request under the wrong leave type.
Example: applied as "Casual Leave" but it should have been "Sick Leave".

The approver can correct the leave type **before committing their approval decision**.
Once the decision (APPROVED or REJECTED) is committed, the leave type is locked and cannot be changed.

```
Rules:
- Approver sees current leave_type on the request detail page
- A "Change Leave Type" dropdown is shown only when request is still PENDING
- Approver selects the correct type and saves → leave_request.leave_type_id updated
- This change is recorded in the workflow audit log (erp_audit.workflow_events)
- After the correction, approver proceeds to approve/reject as normal
- Once APPROVED or REJECTED, the leave type field becomes read-only — no further changes

Balance implications:
- Leave balance deduction (Phase 8) will use the final leave_type_id at the time
  the day records are created (i.e., after approval).
- If the approver corrected the type before approving, the corrected type is what
  gets stored in employee_day_records and what Phase 8 will count against.
- The design and enforcement of balance deduction is deferred to Phase 8.
```

---

### Approver Flow — Leave Approved

```
Backend on APPROVED:
1. Updates workflow_request state
2. Appends workflow_event (audit)
3. Expands the date range day by day
4. For each date in [from_date .. to_date]:
   UPSERT employee_day_records:
     declared_status     = "LEAVE"
     leave_request_id    = this request
     leave_type_id       = this leave type  ← uses the final type (post any approver correction)
     source              = "LEAVE_APPROVED"
     updated_at          = now()

   On UPSERT conflict (same employee, same date):
     - If existing source = "HOLIDAY_CALENDAR" or "WEEK_OFF_CALENDAR":
       Do NOT overwrite — holiday/week-off takes priority
     - Otherwise: overwrite

Backend on REJECTED:
1. Updates workflow_request state
2. No day_records created or modified
```

### Approver Flow — Out Work Approved

```
Backend on APPROVED:
For each date in [from_date .. to_date]:
  UPSERT employee_day_records:
    declared_status          = "OUT_WORK"
    out_work_request_id      = this request
    out_work_day_scope       = "FULL_DAY" or "PARTIAL_DAY"
    out_work_departure_time  = if PARTIAL_DAY
    source                   = "OUT_WORK_APPROVED"
```

### Cancel Flow

```
User or HR cancels an APPROVED leave or out-work:
1. workflow_request state → CANCELLED
2. DELETE FROM employee_day_records
   WHERE leave_request_id = this request
   (or out_work_request_id = this request)
   AND source = "LEAVE_APPROVED" or "OUT_WORK_APPROVED"

Day records are safely removable because they trace back to this request via FK.
```

### HR Manual Correction Flow

```
HR finds a day marked ABSENT that should be PRESENT (employee forgot to punch):

1. HR opens day record for that employee and date
2. Sees: declared_status = "ABSENT", source = "BIOMETRIC_AUTO" or no record
3. HR changes declared_status to "PRESENT"
4. System records:
   manually_corrected  = TRUE
   corrected_by        = HR's user ID
   corrected_at        = now()
   correction_note     = HR's note
   previous_status     = "ABSENT"

Requires permission: HR_ATTENDANCE_MANUAL_CORRECTION
Cannot be done by employee. Cannot be done by someone without that permission.
Full audit trail — cannot be hidden.
```

### Day Record Generation Timing

| Event | Day Records Action |
|---|---|
| Request submitted (PENDING) | None |
| Request approved | Expand range → UPSERT day records |
| Request rejected | None |
| Request cancelled (after approval) | DELETE day records for this request |
| HR manually corrects | UPDATE with audit columns |
| Holiday calendar loaded | INSERT with source = HOLIDAY_CALENDAR |
| Future: biometric punch | UPDATE biometric_* columns |

---

## PART 6 — OUT WORK PARTIAL DAY DESIGN

### The Business Scenario

Employee arrives office at 10:00 AM.
At 12:00 PM, manager sends them to meet a client.
They return at 6:00 PM.

This day is:
- Not a leave day
- Not a full-day out-work (they were in office for the first half)
- Not an absent day
- The employee attended office AND did official outdoor work on the same day

### How the Model Handles It

```
out_work_request:
  day_scope               = "PARTIAL_DAY"
  from_date               = to_date = "2026-04-15"
  office_departure_time   = "12:00"
  total_days              = 1

employee_day_record:
  declared_status          = "OUT_WORK"
  out_work_day_scope       = "PARTIAL_DAY"
  out_work_departure_time  = "12:00"
```

`declared_status = "OUT_WORK"` is correct — official outdoor work happened.
`day_scope = "PARTIAL_DAY"` carries the nuance that office was attended first.

### Why NOT `declared_status = "PRESENT"` with a time note?

`declared_status` is for HR categorization and future biometric reconciliation — not a time log.
When HR sees "Rohan — 15 Apr — OUT_WORK (Partial, left 12:00)" they understand exactly what happened.
Marking it PRESENT would hide the outdoor movement from registers and reports.

### Future Biometric Reconciliation for PARTIAL_DAY

When biometric comes:
- Biometric shows IN punch at 10:00, OUT punch at 18:00
- Day record: OUT_WORK, PARTIAL_DAY, office_departure_time = 12:00
- Reconciliation: IN punch before departure_time → employee was in office first ✓
- No MISS_PUNCH flagged — punches are coherent with the declared partial-day out-work
- Work minutes = total punch span = 8 hours — correctly reflects the full working day

### Constraints

- PARTIAL_DAY out-work: `from_date` must equal `to_date` — enforced in backend
- `office_departure_time` required for PARTIAL_DAY, must be NULL for FULL_DAY
- PARTIAL_DAY cannot span multiple days by definition

### UI

Apply form:
```
Day Scope:  ○ Full Day (can span multiple dates)
            ● Office → Field  (single day, attended office first)

  ↳ Date: [15 Apr 2026]
  ↳ Departed office at: [12:00]
```

Register view:
```
| Employee | Date    | Scope        | Departed | Destination  |
|----------|---------|--------------|----------|--------------|
| Rohan    | 15 Apr  | Partial Day  | 12:00    | Client Site  |
| Priya    | 16 Apr  | Full Day     | —        | Head Office  |
```

---

## PART 7 — GOVERNANCE DESIGN

### Backdate Rules

| Actor | Backdate Limit | Permission |
|---|---|---|
| Employee (self) | 3 days | Standard HR_LEAVE_APPLY |
| HR on behalf of employee | Unlimited | HR_LEAVE_BACKDATED_APPLY |
| HR on behalf of employee (out-work) | Unlimited | HR_OUT_WORK_BACKDATED_APPLY |

### Who Can Approve What

| Application Type | Approver |
|---|---|
| Employee self-apply | Configured approver per company module |
| HR applies on behalf of employee | HR's manager / designated approver |
| HR applies on behalf of themselves | HR's manager (HR cannot approve own) |

Rule: The person who applies cannot also approve. This is enforced by the existing workflow engine.

### Leave Type Management Permission

```
Resource code: HR_LEAVE_TYPE_MANAGE
```

Assigned by SA via the existing ACL admin panel on a per-company basis.
Only the assigned HR user(s) for a company can add, edit, or deactivate leave types for that company.
HR cannot manage leave types of any other company — `parent_company_id` isolation enforced server-side.

SA retains the ability to manage leave types for any company directly.
SA uses this when: setting up a new company, extending types beyond what the HR user has configured,
or correcting a misconfiguration.

---

### Manual Correction Permission

```
Resource code: HR_ATTENDANCE_MANUAL_CORRECTION
```

Only assigned roles can correct day records.
Every correction is stored with: who changed it, when, what it was before, and a note.
No correction can be hidden or untracked.

---

## PART 8 — FUTURE BIOMETRIC READINESS

### What is prepared now

The `employee_day_records` table is the biometric landing zone.
When biometric hardware integration is built, the touchpoint is well-defined.

### Reconciliation Logic (to be built later, not now)

```
Biometric event arrives: employee_id + date + first_punch + last_punch

1. Look up employee_day_records WHERE employee = X AND record_date = D

2. No row exists:
   Create row: declared_status = "PRESENT", fill biometric columns, source = "BIOMETRIC_AUTO"

3. Row exists with declared_status = "LEAVE":
   Flag as exception — employee punched in on a declared leave day

4. Row exists with declared_status = "OUT_WORK":
   If FULL_DAY: punch from client site expected, may not come from office terminal → mark reconciled
   If PARTIAL_DAY: check if office IN punch exists before office_departure_time → if yes, consistent

5. No punch arrives by EOD for a row with no declared status:
   Mark declared_status = "ABSENT" or "MISS_PUNCH"
```

None of this requires changing the data model.
The biometric columns are already present — they hold NULL until biometric is activated.

### What biometric will add later (additive only)

- Biometric device sync job (cron or webhook) writing to employee_day_records
- A reconciliation engine computing final attendance from declared + biometric
- MISS_PUNCH handling flow
- Work hours reporting from biometric_work_minutes
- Late arrival / early departure detection

**No redesign required. All additive.**

---

## PART 9 — PHASE MAP WITH WEIGHTAGES

Total implementation = 100% (weightages are relative — exact % are effort guidance, not strict)

```
Phase 1 — Leave Types                                     10%
  Phase 1-A: DB Migration (leave_types table + leave_requests extension)    3%
  Phase 1-B: Backend (list types handler, create/update handlers updated)   4%
  Phase 1-C: Frontend (dropdown in apply form, type shown in lists)         3%

Phase 2 — Day Records + Leave Expansion + Holiday Calendar  25%
  Phase 2-A: DB Migration (employee_day_records + holiday/week-off tables
             + effective_leave_days on leave_requests)                      5%
  Phase 2-B: Backend: sandwich calc at apply-time + block rule +
             effective_leave_days stored; expansion on approve              10%
  Phase 2-C: Backend cleanup on leave cancel                                2%
  Phase 2-D: Backend CRUD for holiday calendar + week-off config +
             sandwich preview endpoint + HR_CALENDAR_MANAGE resource code   5%
  Phase 2-E: Frontend: holiday calendar management UI + week-off config UI  3%

Phase 3 — Out Work Partial Day + Expansion                15%
  Phase 3-A: DB Migration (out_work_requests extension)                     3%
  Phase 3-B: Backend handlers update (partial day logic + expansion)        7%
  Phase 3-C: Frontend (scope toggle, departure time field, register badge)  5%

Phase 4 — HR Backdated Application                        20%
  Phase 4-A: ACL resource codes + permission setup                          4%
  Phase 4-B: Backend handlers (HR apply on behalf, no backdate limit)       9%
  Phase 4-C: Frontend (HR correction screen, on-behalf form)                7%

Phase 5 — Manual Attendance Correction                    15%
  Phase 5-A: ACL resource code + permission setup                           3%
  Phase 5-B: Backend correction handler with audit                          7%
  Phase 5-C: Frontend correction UI with audit trail display                5%

Phase 6 — HR Summary Reports                              20%
  Phase 6-A: Backend report handlers                                        10%
    - Attendance Summary (monthly per employee, grouped by status + leave type)
    - Daily Attendance Register (date-wise grid, max 31 days)
    - Per-Employee Yearly Leave Summary (month-wise breakdown for full year)
    - Department-wise Attendance Report (grouped by department, date range)
    - Leave Usage Report (how many days taken per type — balance column present
      but shows "Policy not configured" until Phase 8 is implemented)
  Phase 6-B: Frontend report screens                                        10%
    - Monthly Attendance Summary table with CSV export
    - Daily Attendance Register grid (rows=employees, columns=dates) with CSV export
    - Yearly Leave Summary per employee with CSV export
    - Department-wise Attendance Report with CSV export
    - Leave Usage Report table with CSV export

Phase 7 — Historical Backfill                              5% (mandatory, no UI)
  One-time migration script to expand all historically approved requests
  into employee_day_records. Idempotent UPSERT. Run by SA after Phase 2 + Phase 3.
  Without this, HR summary reports will be incomplete for all past data.

Phase 8 — Leave Policy & Balance Management               Future / Not scoped now
  ⚠ DETAILED DESIGN DISCUSSION REQUIRED BEFORE ANY IMPLEMENTATION ⚠
  This phase cannot be started without a separate dedicated design session.

  Scope includes (preliminary, not final):
  - Leave entitlement configuration per employee per type per year
  - Monthly accrual logic (how many days accrue per month per type)
  - Balance ledger (credits and debits per employee per type)
  - Leave encashment rules (who can encash, max encashable days, when)
  - Post-encashment balance tracking
  - Balance visibility for employee, manager, HR
  - Year-end carry-forward processing

  Foundation already in place from current design:
  - leave_types.max_days_per_year — ready for entitlement reference
  - leave_types.carry_forward_allowed — ready for year-end logic
  - employee_day_records.leave_type_id — counting days taken is already possible
  - leave_requests.leave_type_id — all requests are type-tagged

  When Phase 8 design session happens, these existing structures will be the starting point.
  No rework needed — only additive tables and logic.

Phase 9 — Biometric Integration                           Future / Not scoped
```

### Dependency Chain

```
Phase 1 (Leave Types)
    ↓
Phase 2 (Day Records + Leave Expansion)
    ↓
Phase 3 (Out Work Partial Day + Expansion)     ← can run parallel with Phase 2 after Phase 1
    ↓
Phase 4 (HR Backdated Application)             ← depends on Phase 2 + Phase 3 complete
    ↓
Phase 5 (Manual Correction)                    ← depends on Phase 2 complete
    ↓
Phase 6 (HR Summary Reports)                   ← depends on Phase 2 + Phase 3 complete
    ↓
Phase 7 (Historical Backfill)                  ← run immediately after Phase 2 + Phase 3
    ↓
Phase 8 (Leave Policy & Balance)               ← FUTURE — separate design session first
    ↓
Phase 9 (Biometric Integration)                ← FUTURE — separate design session first
```

Phases 4, 5, and 6 can be parallelized after Phase 2 and Phase 3 are complete.
Phase 7 must run before Phase 6 reports are considered accurate.

---

## PART 10 — OUT WORK DESTINATION COMPANY ISOLATION

### Requirement

Out Work destinations are parent-company-scoped.

- A user sees only their own company's destination list
- A user can only create destinations for their own company
- A user can only select a destination that belongs to their own company
- One company's destinations are never visible to users of another company
- Exception: users with multi-company report access (ACL viewer scope) can see destinations
  across companies — but only within their permitted company scope

### Current Implementation Status

Already correctly implemented at the handler level:

| Layer | Status | Detail |
|---|---|---|
| Schema | ✅ | `out_work_destinations.company_id` exists, UNIQUE on `(company_id, name, address)` |
| List handler | ✅ | `loadDestinationRows` filters by `company_id = parentCompanyId` |
| Create handler | ✅ | Inserts with `company_id = parentCompany.company_id` |
| Select-by-ID handler | ✅ | Validates `.eq("company_id", parentCompany.company_id)` |
| RLS | ⚠ | Currently `USING (TRUE)` — all authenticated users can SELECT all rows at DB level |

The RLS gap is not a security breach because the service role client in handlers enforces company
filtering before any data reaches the user. However, it should be noted for future review.

### Rules That Must Be Maintained During Phase 3 Implementation

When Phase 3 modifies out-work handlers:
1. `listOutWorkDestinationsHandler` must always filter by `company_id = parentCompanyId`
2. `createOutWorkDestinationHandler` must always set `company_id = parentCompany.company_id`
3. `createOutWorkRequestHandler` when using destination_id must always validate
   that the destination's `company_id` matches the request's `parent_company_id`
4. Report handlers (`listOutWorkRegisterHandler`, `getDepartmentAttendanceReportHandler`)
   must filter destinations by the user's permitted company scope via ACL viewer rules

These rules apply to HR backdated out-work applications (Phase 4) as well.
HR applying on behalf of an employee must use destinations from that employee's company only.

---

## PART 11 — HOLIDAY & WEEK-OFF CALENDAR MANAGEMENT

### Business Rules

1. **Company-wise holidays.** Every company manages its own holiday list independently.
   There is no global holiday list. If two companies share the same national holiday,
   each company must add it separately.

2. **Default week-off days.** Saturday and Sunday are the default weekly off days for every company.
   A company can override this by configuring `company_week_off_config` (e.g. Friday+Saturday).

3. **HR manages the calendar.** Any user with `HR_CALENDAR_MANAGE` resource permission
   can add, edit, and delete their company's holidays and configure week-off days.
   SA assigns this permission via the ACL admin panel — same pattern as leave type management.

4. **Holidays do not pre-populate day records.** The "lazy" approach is used.
   Day records for all employees are NOT created in advance when a holiday is added.
   Instead, the holiday calendar is consulted at two critical points:
   - At **leave apply-time** — to calculate sandwich leave adjustment
   - At **leave approval-time** — the `upsert_day_record_leave` DB function guards
     against overwriting HOLIDAY_CALENDAR and WEEK_OFF_CALENDAR day records

5. **Week-offs are not stored as day records.** Week-off determination is always
   computed from `company_week_off_config` (or the default Sat/Sun) on the fly.
   There are no pre-created WEEK_OFF rows for all employees.

### Scope

Phase 2-D: Backend CRUD handlers for holiday and week-off config.
Phase 2-E: Frontend management UI for HR.

---

## PART 12 — SANDWICH LEAVE POLICY

### What is Sandwich Leave?

When an employee applies for leave that brackets a holiday or week-off, the system must
decide whether those bracketed days count as leave deduction.

**PACE ERP Policy: Sandwich Rule is enforced. All bracketed days count.**

Definition: If a holiday or week-off falls between two working days that are both leave days
(or falls between the first and last working-day leave in a multi-day range), those
holidays/week-offs are counted as charged leave days.

### Algorithm

Given leave range [from_date, to_date]:

```
1. Build the set of "working days" in the range:
   working_days = dates in [from_date, to_date]
     where date is NOT in company_holiday_calendar
       AND DOW(date) is NOT in company_week_off_config.week_off_days

2. If working_days is empty → BLOCK the application.
   Return error: "Your selected date range contains no working days."

3. first_working = min(working_days)
   last_working  = max(working_days)

4. effective_leave_days = count of dates in [first_working, last_working]
   (inclusive, regardless of whether each date is a holiday, week-off, or working day)

   This means: all days between the first and last working-day leave are charged.
   Only leading holidays/week-offs before the first working day and trailing
   holidays/week-offs after the last working day are excluded.

5. total_days = count of dates in [from_date, to_date]  (unchanged — always inclusive range)
```

### Examples

| Scenario | from_date | to_date | total_days | effective_leave_days | Notes |
|---|---|---|---|---|---|
| All working days | Mon | Fri | 5 | 5 | No sandwich — no holidays |
| Weekend at end | Mon | Sun | 7 | 5 | Sat+Sun trailing → not counted |
| Weekend in middle | Thu | Tue (next wk) | 6 | 6 | Sat+Sun sandwiched → counted |
| Holiday at start | Holiday Mon, leave Tue | Wed | 3 | 2 | Mon leading → not counted |
| Holiday in middle | Mon leave, Tue holiday, Wed leave | Wed | 3 | 3 | Tue sandwiched → counted |
| Only holidays | Hol Mon | Hol Tue | 2 | 0 → BLOCKED | No working days → blocked |
| Single day (working) | Mon | Mon | 1 | 1 | Normal |
| Single day (holiday) | Holiday Mon | Mon | 1 | 0 → BLOCKED | Blocked |

### Display at Apply-Time

When the user selects a date range, the frontend computes a preview:
- If range is blocked → show error inline, disable submit button
- If effective < total → show amber info box:
  "X working day(s) in this range. Y holiday/week-off day(s) between your leave days
   will also be charged (sandwich rule). You will be charged Y effective leave days."
- If effective == total → no special notice needed

The frontend calls the backend to get the calculation (not pure client-side) so that
the holiday calendar is authoritative. A dedicated lightweight endpoint returns:
`{ working_days, effective_leave_days, is_blocked, sandwich_days }` given a date range.

### Storage

`effective_leave_days` is stored on `erp_hr.leave_requests` at submission time.
It is never recalculated after submission — the value is locked at apply-time.

Day records still reflect the actual day status:
- Holidays between leave days → HOLIDAY rows (from HOLIDAY_CALENDAR source) — not overwritten
- Week-offs between leave days → WEEK_OFF rows (from WEEK_OFF_CALENDAR source) — not overwritten
- Working days within range → LEAVE rows (from LEAVE_APPROVED source)

`effective_leave_days` is the counter used for Phase 8 balance deduction.
`total_days` is preserved as the raw range count for display/reporting.

### Invariants Specific to Sandwich Policy

- The sandwich calculation always uses the authoritative server-side holiday calendar.
  Frontend preview is informational. Server recalculates at submit and stores the value.
- If the holiday calendar changes after a request is submitted, `effective_leave_days`
  is NOT recalculated. The value is locked at submission. This is by design — retroactive
  changes to the calendar do not affect submitted requests.
- `effective_leave_days` must always be ≤ `total_days`.
- `effective_leave_days` = 0 is invalid — blocked before reaching storage.

---

## INVARIANTS — MUST NEVER BE VIOLATED

1. Day records are always derived from approved requests. Never create for PENDING.
2. Cancellation must clean day records. Approved → cancelled = day records deleted.
3. HOLIDAY_CALENDAR and WEEK_OFF_CALENDAR rows must not be overwritten by leave approval.
4. PARTIAL_DAY out-work is always single-date. Enforced in backend, not just frontend.
5. Leave type must belong to the same company as the request. Validated server-side.
6. `UNIQUE (company_id, employee_auth_user_id, record_date)` is sacred. One truth per person per day.
7. HR backdated applications go through approval workflow. HR cannot self-approve.
8. Manual corrections carry full audit trail. No silent edits.
9. The person who applies cannot approve the same request.
10. Biometric columns are reserved. Do not repurpose them for other use before biometric integration.
11. Out work destinations are always company-scoped. A user never sees or selects another company's destination.
12. Destination validation must happen server-side — frontend dropdown is not sufficient guard.
13. Approver may correct leave_type_id only while the request is PENDING. Once APPROVED or REJECTED, the leave type is immutable. Any type change after decision is prohibited — the day records already reflect the committed type.
14. Holidays are company-scoped. One company's holiday calendar must never affect another company's leave calculations or day records.
15. Week-off determination is always computed from `company_week_off_config` (default: Sat+Sun). Day records are NOT pre-created for week-offs. Week-off rows in employee_day_records are created by the leave expansion guard only — they are never bulk-created for all employees.
16. Leave applications with zero working days in the selected range must be blocked at both the API layer and the frontend. The block is not advisory — it is an error that prevents submission.
17. `effective_leave_days` is calculated and locked at submission time using the current holiday calendar. A subsequent holiday calendar change does NOT trigger recalculation of any existing request's `effective_leave_days`.
18. `effective_leave_days` must be ≥ 1 on every stored leave request. Zero is invalid — the block rule (Invariant 16) prevents it.
19. The sandwich calculation is always performed server-side. The frontend preview is informational only. The stored `effective_leave_days` is always the server-computed value.
20. `HR_CALENDAR_MANAGE` authorises holiday and week-off management only. It does not grant leave type management (`HR_LEAVE_TYPE_MANAGE`), leave approval, or any other HR permission. These are separate resource codes.
