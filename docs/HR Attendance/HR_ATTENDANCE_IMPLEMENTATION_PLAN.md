# HR Attendance — Implementation Plan

**Classification:** Implementation Authority
**Status:** READY — Awaiting execution
**Created:** 2026-04-27
**Design Basis:** HR_ATTENDANCE_FULL_DESIGN.md

---

## PURPOSE

This document contains the detailed, step-by-step implementation instructions for every phase of the HR Attendance redesign.

Each phase is self-contained. Each phase must be completed and verified before the next begins (unless explicitly marked parallelizable).

Companion files:
- `HR_ATTENDANCE_FULL_DESIGN.md` — the design authority
- `HR_ATTENDANCE_PROGRESS_LOG.md` — the live progress log

---

## PHASE SEQUENCE

```
Phase 1 — Leave Types                              [10%]
Phase 2 — Day Records + Leave Expansion            [20%]
Phase 3 — Out Work Partial Day + Expansion         [15%]
Phase 4 — HR Backdated Application                 [20%]
Phase 5 — Manual Attendance Correction             [15%]
Phase 6 — HR Summary Reports                       [20%]
Phase 7 — Historical Backfill (optional)           [0%]
```

---

## PHASE 1 — LEAVE TYPES [10%]

**Goal:** Leave type must exist in every leave request.
**Breaks existing flows:** No — `leave_type_id` is nullable until backfill, then NOT NULL.
**User-visible:** Yes — leave apply form gets a type dropdown.

---

### Phase 1-A — DB Migration [3%]

**File to create:**
`supabase/migrations/20260427_10_1a_hr_leave_types.sql`

**Steps:**

1. Create `erp_hr.leave_types` table:

```sql
CREATE TABLE erp_hr.leave_types (
  leave_type_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             UUID NOT NULL REFERENCES erp_master.companies(company_id),
  type_code              TEXT NOT NULL,
  type_name              TEXT NOT NULL,
  is_paid                BOOLEAN NOT NULL DEFAULT TRUE,
  requires_document      BOOLEAN NOT NULL DEFAULT FALSE,
  max_days_per_year      INTEGER,
  carry_forward_allowed  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             UUID REFERENCES auth.users(id),
  UNIQUE (company_id, type_code)
);

CREATE INDEX idx_leave_types_company ON erp_hr.leave_types (company_id, is_active, sort_order);
ALTER TABLE erp_hr.leave_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY leave_types_read_authenticated ON erp_hr.leave_types
  FOR SELECT TO authenticated USING (TRUE);
```

2. Add `leave_type_id` to `erp_hr.leave_requests` (nullable first):

```sql
ALTER TABLE erp_hr.leave_requests
  ADD COLUMN leave_type_id UUID REFERENCES erp_hr.leave_types(leave_type_id),
  ADD COLUMN applied_by_auth_user_id UUID REFERENCES auth.users(id);
```

3. Seed default leave types for every existing company:

```sql
INSERT INTO erp_hr.leave_types
  (company_id, type_code, type_name, is_paid, requires_document, carry_forward_allowed, sort_order)
SELECT
  company_id,
  unnest(ARRAY['GEN','CL','SL','EL','LOP']) AS type_code,
  unnest(ARRAY['General Leave','Casual Leave','Sick Leave','Earned Leave','Loss of Pay']) AS type_name,
  unnest(ARRAY[TRUE, TRUE, TRUE, TRUE, FALSE]) AS is_paid,
  unnest(ARRAY[FALSE, FALSE, TRUE, FALSE, FALSE]) AS requires_document,
  unnest(ARRAY[FALSE, FALSE, FALSE, TRUE, FALSE]) AS carry_forward_allowed,
  unnest(ARRAY[0, 1, 2, 3, 4]) AS sort_order
FROM erp_master.companies
ON CONFLICT (company_id, type_code) DO NOTHING;
```

4. Backfill existing leave_requests with the GEN type for their company:

```sql
UPDATE erp_hr.leave_requests lr
SET leave_type_id = (
  SELECT lt.leave_type_id FROM erp_hr.leave_types lt
  WHERE lt.company_id = lr.parent_company_id AND lt.type_code = 'GEN'
  LIMIT 1
)
WHERE lr.leave_type_id IS NULL;
```

5. Make `leave_type_id` NOT NULL after backfill:

```sql
ALTER TABLE erp_hr.leave_requests
  ALTER COLUMN leave_type_id SET NOT NULL;
```

**Verification:** All existing leave_requests have a leave_type_id. No NULL rows remain.

---

### Phase 1-B — Backend [4%]

**Files to create/modify:**

**New file:** `supabase/functions/api/_core/hr/leave_types.handlers.ts`

**Handler 1: `listLeaveTypesHandler`**
- Route: `GET /api/hr/leave/types`
- Auth: authenticated
- Logic:
  - Resolve company from session
  - SELECT from leave_types WHERE company_id = X AND is_active = TRUE ORDER BY sort_order
  - Return array of: `{ leave_type_id, type_code, type_name, is_paid, requires_document, max_days_per_year, carry_forward_allowed }`

**Handler 2: `listAllLeaveTypesHandler`** (for management screen — includes inactive)
- Route: `GET /api/hr/leave/types/all`
- Auth: requires `HR_LEAVE_TYPE_MANAGE`
- Logic:
  - Resolve company from session
  - SELECT from leave_types WHERE company_id = X ORDER BY sort_order (no is_active filter)
  - Return full rows including: `{ leave_type_id, type_code, type_name, is_paid, requires_document, max_days_per_year, carry_forward_allowed, is_active, sort_order }`

**Handler 3: `createLeaveTypeHandler`**
- Route: `POST /api/hr/leave/types`
- Auth: requires `HR_LEAVE_TYPE_MANAGE`
- Payload: `{ type_code, type_name, is_paid, requires_document, max_days_per_year, carry_forward_allowed, sort_order }`
- Logic:
  - Resolve `company_id` from session — HR can only create for their own company
  - Validate: `type_code` is non-empty, no special characters
  - Validate: `UNIQUE (company_id, type_code)` — reject duplicate
  - INSERT with `created_by = current user`
  - Return the created row

**Handler 4: `updateLeaveTypeHandler`**
- Route: `PATCH /api/hr/leave/types/:leave_type_id`
- Auth: requires `HR_LEAVE_TYPE_MANAGE`
- Payload (all optional): `{ type_name, is_paid, requires_document, max_days_per_year, carry_forward_allowed, is_active, sort_order }`
- Logic:
  - Load leave type, verify `company_id` matches session company — server-side isolation
  - `type_code` is NOT updatable after creation (changing the code would break Phase 8 balance logic)
  - Apply updates
  - Return updated row

**Modify:** `supabase/functions/api/_core/hr/shared.ts`
- Add: `LEAVE_RESOURCE_CODES.types = "HR_LEAVE_TYPES"`
- Add: `LEAVE_RESOURCE_CODES.typeManage = "HR_LEAVE_TYPE_MANAGE"`

**Modify:** `supabase/functions/api/_core/sa/company.handlers.ts` (or wherever company creation lives)
- After a new company is successfully created, seed the 5 default leave types (GEN, CL, SL, EL, LOP)
  for that company — same values as the Phase 1-A migration INSERT
- This ensures every new company always starts with the defaults without manual SA action

**Modify:** `supabase/functions/api/_core/hr/leave.handlers.ts`

**`createLeaveRequestHandler` changes:**
- Accept `leave_type_id` in payload
- Validate: `leave_type_id` is non-null
- Validate: `leave_type_id` exists in `erp_hr.leave_types` WHERE `company_id = parent_company_id`
- Insert `leave_type_id` into the new row
- Insert `applied_by_auth_user_id = NULL` (self-apply)

**`updateLeaveRequestHandler` changes:**
- Accept optional `leave_type_id` update
- Apply same company validation if provided
- **Approver leave type correction (pre-decision):**
  - Accept `leave_type_id` override from the approver when the request is still PENDING
  - Validate: new `leave_type_id` belongs to the same `parent_company_id` as the request
  - Validate: request state is PENDING — reject update if state is already APPROVED or REJECTED
  - Write the change to the audit log (`erp_audit.workflow_events` or equivalent), recording who changed it, when, and what the previous type was
  - Once the decision is committed (APPROVED / REJECTED), any further `leave_type_id` update must be rejected with an error
  - Balance deduction logic based on the final committed type is deferred to Phase 8

**`listMyLeaveRequestsHandler` changes:**
- JOIN `erp_hr.leave_types` on `leave_type_id`
- Add `type_code`, `type_name` to response row

**`listLeaveApprovalInboxHandler` changes:**
- Same JOIN and response fields

**`listLeaveRegisterHandler` changes:**
- Same JOIN and response fields
- Add `type_code` as a filterable field

**Modify:** `supabase/functions/api/_routes/hr.routes.ts`
- Add: `GET /api/hr/leave/types → listLeaveTypesHandler`
- Add: `GET /api/hr/leave/types/all → listAllLeaveTypesHandler`
- Add: `POST /api/hr/leave/types → createLeaveTypeHandler`
- Add: `PATCH /api/hr/leave/types/:leave_type_id → updateLeaveTypeHandler`

---

### Phase 1-C — Frontend [3%]

**Modify:** `frontend/src/pages/dashboard/hr/hrApi.js`
- Add: `listLeaveTypes()` → `GET /api/hr/leave/types`
- Add: `listAllLeaveTypes()` → `GET /api/hr/leave/types/all`
- Add: `createLeaveType(payload)` → `POST /api/hr/leave/types`
- Add: `updateLeaveType(leaveTypeId, payload)` → `PATCH /api/hr/leave/types/:id`

**Modify:** `frontend/src/pages/dashboard/hr/HrWorkflowPages.jsx`

**`LeaveApplyPage` changes:**
- Add state: `leaveTypes`, `selectedLeaveTypeId`
- On mount: call `listLeaveTypes()` and store in state
- Add dropdown before reason field: "Leave Type" — renders `type_name` options
- On submit: include `leave_type_id` in payload
- Validation: leave type must be selected

**`LeaveRequestDetailPage` changes:**
- Show: "Leave Type: Casual Leave" badge/row in detail view

**`LeaveMyRequestsPage` changes:**
- Add `type_name` column to the list table

**`LeaveApprovalInboxPage` changes:**
- Add `type_name` column
- **Approver leave type correction:**
  - In the request detail view (opened from inbox), show a "Leave Type" field
  - When the request is PENDING: render as an editable dropdown (ErpComboboxField) populated from `listLeaveTypes()`
  - When the request is APPROVED or REJECTED: render as read-only text — no dropdown, no edit
  - "Save Type Change" button — calls `updateLeaveRequestHandler` with the new `leave_type_id` before the approve/reject action
  - After saving the type change, the updated type is shown and the approver can then proceed to approve or reject
  - Do NOT allow type change and decision submission in a single action — two explicit steps: (1) save type, (2) decide

**`LeaveRegisterResultsPage` changes:**
- Add `type_name` column
- Add leave type filter to `LeaveRegisterPage` filter form

**New page: `LeaveTypeManagementPage`**
- Visible only to users with `HR_LEAVE_TYPE_MANAGE` permission (checked via session ACL)
- Shows all leave types for the session company (both active and inactive)
- Table columns: Type Code | Type Name | Paid | Requires Doc | Max Days/Year | Carry Forward | Status | Actions
- Actions per row:
  - Edit — inline form: type_name, is_paid, requires_document, max_days_per_year, carry_forward_allowed, sort_order
  - Toggle Active/Inactive — one-click with confirmation dialog:
    "Deactivating this type will hide it from new leave applications. Existing approved leaves are unaffected."
- "Add New Type" button → inline form: type_code (required, unique), type_name, and all other fields
  - `type_code` is set at creation only — shown as read-only in edit form with note: "Type code cannot be changed after creation"
- Add to HR navigation menu (conditionally shown only to users with `HR_LEAVE_TYPE_MANAGE`)

**Definition of Done — Phase 1:**
- Leave apply form shows type dropdown (active types only)
- New leave requests store leave_type_id
- All existing leave requests show "General Leave"
- Register can filter by leave type
- HR with `HR_LEAVE_TYPE_MANAGE` can add, edit, deactivate leave types for their company
- SA can assign/revoke `HR_LEAVE_TYPE_MANAGE` via existing ACL admin panel
- New company creation seeds 5 default types automatically
- No existing functionality broken

---

## PHASE 2 — DAY RECORDS + LEAVE EXPANSION + HOLIDAY CALENDAR [25%]

**Goal:**
1. When a leave is approved, system creates date-wise day records (one per calendar day).
2. Leave application enforces Sandwich Leave Policy — holiday/week-off days between
   working-day leaves count as charged leave. Applications with zero working days are blocked.
3. HR can manage company holiday calendar and week-off config.

**Breaks existing flows:** No — day records table is new, sandwich calc is additive to apply flow.
**User-visible:** Phase 2-D/2-E add new HR management pages; Phase 2-B changes apply-time UX (info/block).

---

### Phase 2-A — DB Migration [5%]

**File to create:**
`supabase/migrations/20260427_20_2a_hr_employee_day_records.sql`

This single migration file contains four logical sections:
1. `employee_day_records` table + indexes + RLS
2. `company_holiday_calendar` table + indexes + RLS
3. `company_week_off_config` table + RLS
4. `effective_leave_days` column on `leave_requests`

```sql
-- ============================================================
-- SECTION 1 — employee_day_records
-- ============================================================
CREATE TABLE erp_hr.employee_day_records (
  day_record_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 UUID NOT NULL REFERENCES erp_master.companies(company_id),
  employee_auth_user_id      UUID NOT NULL REFERENCES auth.users(id),
  record_date                DATE NOT NULL,

  declared_status            TEXT NOT NULL
                               CHECK (declared_status IN (
                                 'PRESENT','LEAVE','OUT_WORK',
                                 'HOLIDAY','WEEK_OFF','ABSENT','MISS_PUNCH'
                               )),

  leave_request_id           UUID REFERENCES erp_hr.leave_requests(leave_request_id),
  leave_type_id              UUID REFERENCES erp_hr.leave_types(leave_type_id),
  out_work_request_id        UUID REFERENCES erp_hr.out_work_requests(out_work_request_id),
  out_work_day_scope         TEXT CHECK (out_work_day_scope IN ('FULL_DAY','PARTIAL_DAY')),
  out_work_departure_time    TIME,

  biometric_first_punch      TIMESTAMPTZ,
  biometric_last_punch       TIMESTAMPTZ,
  biometric_work_minutes     INTEGER,
  biometric_reconciled_at    TIMESTAMPTZ,
  biometric_reconcile_note   TEXT,

  manually_corrected         BOOLEAN NOT NULL DEFAULT FALSE,
  corrected_by               UUID REFERENCES auth.users(id),
  corrected_at               TIMESTAMPTZ,
  correction_note            TEXT,
  previous_status            TEXT,

  source                     TEXT NOT NULL
                               CHECK (source IN (
                                 'LEAVE_APPROVED','OUT_WORK_APPROVED',
                                 'HOLIDAY_CALENDAR','WEEK_OFF_CALENDAR',
                                 'MANUAL_HR','BIOMETRIC_AUTO'
                               )),

  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (company_id, employee_auth_user_id, record_date)
);

CREATE INDEX idx_day_records_company_date_status
  ON erp_hr.employee_day_records (company_id, record_date, declared_status);
CREATE INDEX idx_day_records_employee_date
  ON erp_hr.employee_day_records (company_id, employee_auth_user_id, record_date DESC);

ALTER TABLE erp_hr.employee_day_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY day_records_read_authenticated ON erp_hr.employee_day_records
  FOR SELECT TO authenticated USING (TRUE);

-- ============================================================
-- SECTION 2 — company_holiday_calendar
-- ============================================================
CREATE TABLE erp_hr.company_holiday_calendar (
  holiday_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES erp_master.companies(company_id),
  holiday_date   DATE NOT NULL,
  holiday_name   TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES auth.users(id),

  UNIQUE (company_id, holiday_date)
);

CREATE INDEX idx_holiday_calendar_company_date
  ON erp_hr.company_holiday_calendar (company_id, holiday_date);

ALTER TABLE erp_hr.company_holiday_calendar ENABLE ROW LEVEL SECURITY;
CREATE POLICY holiday_calendar_read_authenticated ON erp_hr.company_holiday_calendar
  FOR SELECT TO authenticated USING (TRUE);

-- ============================================================
-- SECTION 3 — company_week_off_config
-- ============================================================
CREATE TABLE erp_hr.company_week_off_config (
  week_off_config_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES erp_master.companies(company_id) UNIQUE,
  week_off_days       INTEGER[] NOT NULL DEFAULT ARRAY[6, 7],
                        -- ISO weekday: 1=Mon...5=Fri, 6=Sat, 7=Sun
                        -- Default: Saturday + Sunday
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          UUID REFERENCES auth.users(id)
);

ALTER TABLE erp_hr.company_week_off_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY week_off_config_read_authenticated ON erp_hr.company_week_off_config
  FOR SELECT TO authenticated USING (TRUE);

-- ============================================================
-- SECTION 4 — effective_leave_days on leave_requests
-- ============================================================
ALTER TABLE erp_hr.leave_requests
  ADD COLUMN effective_leave_days INTEGER;
-- NULL = pre-Phase 2 row (treated as total_days for Phase 8 balance purposes)
-- Value is computed at apply-time and locked. Never recalculated after submission.
```

---

### Phase 2-B — Backend: Sandwich Calc at Apply-Time + Leave Expansion on Approve [12%]

This phase has two distinct parts:

**Part B1 — Sandwich Calculation at Apply-Time**

Add a new shared helper `computeSandwichLeave` in `shared.ts` (or a new `sandwich.ts` helper file):

```typescript
interface SandwichResult {
  totalDays: number;           // raw inclusive calendar days
  workingDays: number;         // working days in the range
  effectiveLeaveDays: number;  // working days + sandwiched non-working days
  sandwichDays: number;        // non-working days that are charged (in between)
  isBlocked: boolean;          // true if zero working days
  blockedReason?: string;
}

async function computeSandwichLeave(
  companyId: string,
  fromDate: string,  // YYYY-MM-DD
  toDate: string,    // YYYY-MM-DD
  supabase: SupabaseClient
): Promise<SandwichResult> {
  // 1. Load holidays for company in range
  const { data: holidays } = await supabase
    .from('erp_hr.company_holiday_calendar')
    .select('holiday_date')
    .eq('company_id', companyId)
    .gte('holiday_date', fromDate)
    .lte('holiday_date', toDate);
  const holidaySet = new Set((holidays ?? []).map((h) => h.holiday_date));

  // 2. Load week-off config (or use default Sat+Sun = [6, 7])
  const { data: woCfg } = await supabase
    .from('erp_hr.company_week_off_config')
    .select('week_off_days')
    .eq('company_id', companyId)
    .maybeSingle();
  const weekOffDays: number[] = woCfg?.week_off_days ?? [6, 7]; // ISO weekday numbers

  // 3. Enumerate all dates in [fromDate, toDate]
  const allDates = generateDateRange(fromDate, toDate);
  const totalDays = allDates.length;

  // 4. Classify each date
  // ISO weekday: 1=Mon...7=Sun
  function isWeekOff(dateStr: string): boolean {
    const d = new Date(dateStr);
    // getDay() returns 0=Sun...6=Sat; convert to ISO: Sun=7, Mon=1...Sat=6
    const jsDay = d.getDay();
    const isoDay = jsDay === 0 ? 7 : jsDay;
    return weekOffDays.includes(isoDay);
  }

  function isNonWorking(dateStr: string): boolean {
    return holidaySet.has(dateStr) || isWeekOff(dateStr);
  }

  const workingDates = allDates.filter((d) => !isNonWorking(d));
  const workingDays = workingDates.length;

  if (workingDays === 0) {
    return {
      totalDays, workingDays: 0, effectiveLeaveDays: 0,
      sandwichDays: 0, isBlocked: true,
      blockedReason: "Your selected date range contains no working days."
    };
  }

  // 5. Sandwich: all days from first working day to last working day are charged
  const firstWorking = workingDates[0];
  const lastWorking = workingDates[workingDates.length - 1];
  const chargedDates = allDates.filter((d) => d >= firstWorking && d <= lastWorking);
  const effectiveLeaveDays = chargedDates.length;
  const sandwichDays = effectiveLeaveDays - workingDays;

  return { totalDays, workingDays, effectiveLeaveDays, sandwichDays, isBlocked: false };
}
```

**Modify `createLeaveRequestHandler`:**

After validating from_date, to_date, and before inserting:

```typescript
// Sandwich check
const sandwich = await computeSandwichLeave(
  parentCompany.company_id, fromDate, toDate, supabase
);

if (sandwich.isBlocked) {
  return res.status(400).json({ error: sandwich.blockedReason });
}

// Insert with effective_leave_days
const { data: newLeave } = await supabase
  .from('erp_hr.leave_requests')
  .insert({
    ...existingFields,
    total_days: sandwich.totalDays,
    effective_leave_days: sandwich.effectiveLeaveDays,
  })
  .select()
  .single();
```

**Add a lightweight preview endpoint:**

Route: `GET /api/hr/leave/sandwich-preview`

Query params: `from_date`, `to_date` (company_id resolved from session).

Returns: `{ total_days, working_days, effective_leave_days, sandwich_days, is_blocked, blocked_reason }`

This endpoint is called by the frontend as the user selects their date range to show the
informational preview before submit.

```typescript
async function getLeaveSandwichPreviewHandler(req, res) {
  // Auth + company resolution (standard pattern)
  const { from_date, to_date } = req.query;
  // Validate dates...
  const result = await computeSandwichLeave(
    parentCompany.company_id, from_date, to_date, supabase
  );
  return res.json(result);
}
```

Route registration in `hr.routes.ts`:
```
GET /api/hr/leave/sandwich-preview  → getLeaveSandwichPreviewHandler  (authenticated, no special ACL)
```

---

**Part B2 — Leave Expansion on Approve** (unchanged from original design)

**After a leave request is APPROVED, call:**

```typescript
async function expandLeaveToDateRecords(
  leaveRequestId: string,
  supabase: SupabaseClient
): Promise<void> {
  // 1. Load the leave request
  const { data: lr } = await supabase
    .from('erp_hr.leave_requests')
    .select('requester_auth_user_id, parent_company_id, from_date, to_date, leave_type_id')
    .eq('leave_request_id', leaveRequestId)
    .single();

  // 2. Generate all dates in range (inclusive)
  const dates = generateDateRange(lr.from_date, lr.to_date); // YYYY-MM-DD strings

  // 3. UPSERT one row per date
  for (const date of dates) {
    await supabase.rpc('upsert_day_record_leave', {
      p_company_id: lr.parent_company_id,
      p_employee_id: lr.requester_auth_user_id,
      p_record_date: date,
      p_leave_request_id: leaveRequestId,
      p_leave_type_id: lr.leave_type_id
    });
  }
}
```

**Create DB function** `upsert_day_record_leave` in migration:

```sql
CREATE OR REPLACE FUNCTION erp_hr.upsert_day_record_leave(
  p_company_id UUID,
  p_employee_id UUID,
  p_record_date DATE,
  p_leave_request_id UUID,
  p_leave_type_id UUID
) RETURNS VOID AS $$
BEGIN
  INSERT INTO erp_hr.employee_day_records (
    company_id, employee_auth_user_id, record_date,
    declared_status, leave_request_id, leave_type_id, source
  )
  VALUES (
    p_company_id, p_employee_id, p_record_date,
    'LEAVE', p_leave_request_id, p_leave_type_id, 'LEAVE_APPROVED'
  )
  ON CONFLICT (company_id, employee_auth_user_id, record_date) DO UPDATE
    SET
      declared_status  = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR','WEEK_OFF_CALENDAR')
          THEN employee_day_records.declared_status  -- do not overwrite holiday/week-off
        ELSE 'LEAVE'
      END,
      leave_request_id = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR','WEEK_OFF_CALENDAR')
          THEN employee_day_records.leave_request_id
        ELSE p_leave_request_id
      END,
      leave_type_id    = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR','WEEK_OFF_CALENDAR')
          THEN employee_day_records.leave_type_id
        ELSE p_leave_type_id
      END,
      source           = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR','WEEK_OFF_CALENDAR')
          THEN employee_day_records.source
        ELSE 'LEAVE_APPROVED'
      END,
      updated_at       = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Helper function** `generateDateRange` in TypeScript shared.ts:

```typescript
function generateDateRange(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  let current = new Date(fromDate);
  const end = new Date(toDate);
  while (current <= end) {
    dates.push(current.toISOString().substring(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}
```

**Modify:** The workflow decision handler (wherever approve/reject is processed).
Locate the handler for `POST /api/hr/workflow/decide` or equivalent in the codebase.

**After a leave request is APPROVED, call:**

```typescript
async function expandLeaveToDateRecords(
  leaveRequestId: string,
  supabase: SupabaseClient
): Promise<void> {
  // 1. Load the leave request
  const { data: lr } = await supabase
    .from('erp_hr.leave_requests')
    .select('requester_auth_user_id, parent_company_id, from_date, to_date, leave_type_id')
    .eq('leave_request_id', leaveRequestId)
    .single();

  // 2. Generate all dates in range (inclusive)
  const dates = generateDateRange(lr.from_date, lr.to_date); // YYYY-MM-DD strings

  // 3. UPSERT one row per date
  for (const date of dates) {
    await supabase.rpc('upsert_day_record_leave', {
      p_company_id: lr.parent_company_id,
      p_employee_id: lr.requester_auth_user_id,
      p_record_date: date,
      p_leave_request_id: leaveRequestId,
      p_leave_type_id: lr.leave_type_id
    });
  }
}
```

**Create DB function** `upsert_day_record_leave` in migration:

```sql
CREATE OR REPLACE FUNCTION erp_hr.upsert_day_record_leave(
  p_company_id UUID,
  p_employee_id UUID,
  p_record_date DATE,
  p_leave_request_id UUID,
  p_leave_type_id UUID
) RETURNS VOID AS $$
BEGIN
  INSERT INTO erp_hr.employee_day_records (
    company_id, employee_auth_user_id, record_date,
    declared_status, leave_request_id, leave_type_id, source
  )
  VALUES (
    p_company_id, p_employee_id, p_record_date,
    'LEAVE', p_leave_request_id, p_leave_type_id, 'LEAVE_APPROVED'
  )
  ON CONFLICT (company_id, employee_auth_user_id, record_date) DO UPDATE
    SET
      declared_status  = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR','WEEK_OFF_CALENDAR')
          THEN employee_day_records.declared_status  -- do not overwrite holiday/week-off
        ELSE 'LEAVE'
      END,
      leave_request_id = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR','WEEK_OFF_CALENDAR')
          THEN employee_day_records.leave_request_id
        ELSE p_leave_request_id
      END,
      leave_type_id    = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR','WEEK_OFF_CALENDAR')
          THEN employee_day_records.leave_type_id
        ELSE p_leave_type_id
      END,
      source           = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR','WEEK_OFF_CALENDAR')
          THEN employee_day_records.source
        ELSE 'LEAVE_APPROVED'
      END,
      updated_at       = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Helper function** `generateDateRange` in TypeScript shared.ts:

```typescript
function generateDateRange(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  let current = new Date(fromDate);
  const end = new Date(toDate);
  while (current <= end) {
    dates.push(current.toISOString().substring(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}
```

---

### Phase 2-C — Backend: Cleanup on Cancel [2%]

**When a leave request is CANCELLED (after having been APPROVED):**

```typescript
async function removeLeaveFromDateRecords(
  leaveRequestId: string,
  supabase: SupabaseClient
): Promise<void> {
  await supabase
    .from('erp_hr.employee_day_records')
    .delete()
    .eq('leave_request_id', leaveRequestId)
    .eq('source', 'LEAVE_APPROVED');
}
```

Call this in `cancelLeaveRequestHandler` only when the previous state was APPROVED.
If the request was still PENDING when cancelled, no day records exist — skip silently.

---

### Phase 2-D — Backend: Holiday Calendar CRUD + Week-Off Config + Resource Code [5%]

**New file to create:** `supabase/functions/api/_core/hr/calendar.handlers.ts`

**New resource code** to add in `shared.ts`:
```typescript
export const HR_CALENDAR_MANAGE = "HR_CALENDAR_MANAGE";
```
Register this code in the SA ACL admin panel (same process as `HR_LEAVE_TYPE_MANAGE`).

**Handlers to implement:**

```
listHolidaysHandler         GET  /api/hr/calendar/holidays
  — query param: company_id (optional; resolved from session if omitted)
  — returns: { holidays: [{ holiday_id, holiday_date, holiday_name }] }
  — auth: authenticated; no special ACL (any user can see company holidays for preview purposes)

createHolidayHandler        POST /api/hr/calendar/holidays
  — body: { holiday_date: "YYYY-MM-DD", holiday_name: string }
  — auth: HR_CALENDAR_MANAGE required
  — validates: holiday_date is valid, not past (warn but allow), company isolation

updateHolidayHandler        PATCH /api/hr/calendar/holidays
  — body: { holiday_id, holiday_date?, holiday_name? }
  — auth: HR_CALENDAR_MANAGE required
  — validates: holiday belongs to user's company

deleteHolidayHandler        DELETE /api/hr/calendar/holidays/:holiday_id
  — auth: HR_CALENDAR_MANAGE required
  — validates: holiday belongs to user's company

getWeekOffConfigHandler     GET  /api/hr/calendar/week-off
  — returns: { week_off_days: [6, 7] }  (default if no config row exists)
  — auth: authenticated

upsertWeekOffConfigHandler  PUT  /api/hr/calendar/week-off
  — body: { week_off_days: number[] }  (array of ISO weekday numbers 1-7)
  — validates: array has 1-6 elements (at least one work day must remain)
  — validates: all values are integers in range [1, 7]
  — auth: HR_CALENDAR_MANAGE required
  — does an UPSERT on company_week_off_config
```

**Route registration** in `hr.routes.ts`:
```
GET    /api/hr/calendar/holidays         → listHolidaysHandler
POST   /api/hr/calendar/holidays         → createHolidayHandler
PATCH  /api/hr/calendar/holidays         → updateHolidayHandler
DELETE /api/hr/calendar/holidays/:id     → deleteHolidayHandler
GET    /api/hr/calendar/week-off         → getWeekOffConfigHandler
PUT    /api/hr/calendar/week-off         → upsertWeekOffConfigHandler
```

**Also add to `hrApi.js` (frontend API layer) — to be consumed by Phase 2-E:**
```
listHolidays(companyId?)         → GET /api/hr/calendar/holidays
createHoliday(payload)           → POST
updateHoliday(payload)           → PATCH
deleteHoliday(holidayId)         → DELETE
getWeekOffConfig()               → GET /api/hr/calendar/week-off
upsertWeekOffConfig(weekOffDays) → PUT
```

---

### Phase 2-E — Frontend: Holiday Calendar Management UI [3%]

**New files to create:**

`frontend/src/pages/dashboard/hr/calendar/HolidayCalendarPage.jsx`
- Wrapper page (same pattern as `LeaveTypeManagementPage.jsx`)
- Renders `HolidayCalendarWorkspace` from `HrWorkflowPages.jsx`

**New workspace** `HolidayCalendarWorkspace` in `HrWorkflowPages.jsx`:
- Two sections: Holidays list + Week-off config
- **Holidays section:**
  - Table: Date | Name | Actions (Edit / Delete)
  - Add button → inline form or modal: date picker + name
  - Edit → prefilled modal
  - Delete → confirm dialog
  - Sorted by date ascending
  - Shows current year by default; year selector to navigate
- **Week-off section:**
  - Checkbox grid: Mon Tue Wed Thu Fri Sat Sun
  - Sat + Sun checked by default
  - "Save" button → calls `upsertWeekOffConfig`
  - At least one working day must remain (validation)

**Requires `HR_CALENDAR_MANAGE` ACL resource** — page must guard via existing resource-check pattern.
If user lacks permission, show "You do not have permission to manage the HR calendar."

**New route** in `AppRouter.jsx`:
```
<Route path="hr/calendar/holidays" element={<HolidayCalendarPage />} />
```

**New page file:** `frontend/src/pages/dashboard/hr/calendar/HolidayCalendarPage.jsx`

**Sandwich preview integration** (also Phase 2-E, touches `LeaveApplyWorkspace`):

After the user selects both `from_date` and `to_date` in the leave apply form:
- Debounce 400ms, then call `GET /api/hr/leave/sandwich-preview?from_date=...&to_date=...`
- If `is_blocked = true` → show error banner, disable submit button
- If `sandwich_days > 0` → show amber info box:
  "X working day(s) in your selected range. Y holiday/week-off day(s) between your leave days
   will also be counted (sandwich rule). You will be charged Z effective leave days."
- If no sandwich → no special UI (normal submit)

Add state to `LeaveApplyWorkspace`:
```
sandwichPreview: null | SandwichResult
sandwichLoading: boolean
```

---

**Definition of Done — Phase 2:**
- Approve a leave → employee_day_records rows created for every date in range
- Cancel an approved leave → those rows deleted
- Reject a leave → no rows created
- Holiday rows not overwritten by leave approval
- `generateDateRange` tested with single-day, multi-day, and month-boundary ranges
- Apply leave with range containing only holidays → blocked with clear error
- Apply leave Mon–Wed where Tue is a holiday → `effective_leave_days = 3` (sandwich)
- Apply leave Mon only → `effective_leave_days = 1` (no sandwich)
- HR can add/edit/delete holidays for their company
- HR can configure week-off days
- `sandwich-preview` endpoint returns correct values for all scenarios
- `HR_CALENDAR_MANAGE` resource code registered and assignable via SA ACL panel

---

## PHASE 3 — OUT WORK PARTIAL DAY + EXPANSION [15%]

**Goal:** Out work supports partial-day official movement. Out work approval creates day records.
**Breaks existing flows:** No — new columns default to FULL_DAY. Existing out-work rows unaffected.
**User-visible:** Yes — out-work form gets scope toggle.

---

### Phase 3-A — DB Migration [3%]

**File to create:**
`supabase/migrations/20260427_30_3a_hr_out_work_partial_day.sql`

```sql
ALTER TABLE erp_hr.out_work_requests
  ADD COLUMN day_scope TEXT NOT NULL DEFAULT 'FULL_DAY'
    CHECK (day_scope IN ('FULL_DAY','PARTIAL_DAY')),
  ADD COLUMN office_departure_time TIME,
  ADD COLUMN applied_by_auth_user_id UUID REFERENCES auth.users(id);

-- Backfill existing rows
UPDATE erp_hr.out_work_requests
SET day_scope = 'FULL_DAY', office_departure_time = NULL
WHERE day_scope IS NULL;
```

---

### Phase 3-B — Backend [7%]

**Modify:** `supabase/functions/api/_core/hr/out_work.handlers.ts`

**`createOutWorkRequestHandler` changes:**
- Accept `day_scope` (default `"FULL_DAY"` if not provided — backward compatible)
- Accept `office_departure_time` (nullable)
- If `day_scope = "PARTIAL_DAY"`:
  - Enforce `from_date == to_date`
  - Require `office_departure_time` to be non-null
  - Validate `office_departure_time` is a valid HH:MM time string
- If `day_scope = "FULL_DAY"`:
  - Set `office_departure_time = NULL`
- Insert both new columns

**`updateOutWorkRequestHandler` changes:**
- Same partial-day validation logic

**Create function** `expandOutWorkToDateRecords` (same pattern as leave):

```typescript
async function expandOutWorkToDateRecords(
  outWorkRequestId: string,
  supabase: SupabaseClient
): Promise<void> {
  const { data: owr } = await supabase
    .from('erp_hr.out_work_requests')
    .select('requester_auth_user_id, parent_company_id, from_date, to_date, day_scope, office_departure_time')
    .eq('out_work_request_id', outWorkRequestId)
    .single();

  const dates = generateDateRange(owr.from_date, owr.to_date);

  for (const date of dates) {
    await supabase.rpc('upsert_day_record_out_work', {
      p_company_id: owr.parent_company_id,
      p_employee_id: owr.requester_auth_user_id,
      p_record_date: date,
      p_out_work_request_id: outWorkRequestId,
      p_day_scope: owr.day_scope,
      p_departure_time: owr.office_departure_time
    });
  }
}
```

**Create DB function** `upsert_day_record_out_work` in migration (same HOLIDAY guard as leave).

**Create function** `removeOutWorkFromDateRecords` for cancellation (same pattern as leave).

**Hook both into the workflow decision handler.**

**`listMyOutWorkRequestsHandler`, `listOutWorkRegisterHandler` changes:**
- Include `day_scope`, `office_departure_time` in response

**Destination company isolation — verify these are unchanged after Phase 3 edits:**
- `listOutWorkDestinationsHandler` → still filters by `company_id = parentCompanyId`
- `createOutWorkDestinationHandler` → still inserts with `company_id = parentCompany.company_id`
- `createOutWorkRequestHandler` when `destination_id` provided → still validates
  `.eq("company_id", parentCompany.company_id)` before accepting the destination
- HR backdated out-work handler (Phase 4) → must also enforce same company validation
  on destination_id — HR cannot use one company's destination for another company's employee

---

### Phase 3-C — Frontend [5%]

**Modify:** `frontend/src/pages/dashboard/hr/hrApi.js`
- Update `createOutWorkRequest` payload to include `day_scope`, `office_departure_time`

**Modify:** `frontend/src/pages/dashboard/hr/HrWorkflowPages.jsx`

**`OutWorkApplyPage` changes:**
- Add state: `dayScope` (default "FULL_DAY"), `officeDepartureTime`
- Add toggle/radio before destination field:
  - "Full Day" — can select date range (from_date / to_date)
  - "Office → Field (Partial Day)" — single date only, shows departure time field
- When PARTIAL_DAY selected:
  - Hide to_date field, lock it to from_date
  - Show: "Departed office at" time input (HH:MM, 24h)
- On submit: include `day_scope` and `office_departure_time` in payload
- Validation: if PARTIAL_DAY, departure time is required

**`OutWorkRequestDetailPage` changes:**
- Show day scope badge: "Full Day" or "Partial Day"
- If Partial Day: show "Office → Field at HH:MM"

**`OutWorkMyRequestsPage` changes:**
- Add scope badge column

**`OutWorkRegisterResultsPage` changes:**
- Add "Scope" column with FULL_DAY / PARTIAL_DAY badge
- Add "Departed" column (shows departure time or "—")

**Definition of Done — Phase 3:**
- Full day out-work: unchanged behavior, creates day records on approve
- Partial day out-work: single date enforced, departure time stored, day record created
- Cancellation removes day records for both cases
- Register shows scope correctly

---

## PHASE 4 — HR BACKDATED APPLICATION [20%]

**Goal:** HR can apply leave or out-work on behalf of any employee for any past date.
**Breaks existing flows:** No — additive new routes and screens.
**User-visible:** Yes — new HR correction screen.

---

### Phase 4-A — ACL Resource Codes [4%]

**Modify:** `supabase/functions/api/_core/hr/shared.ts`

Add to resource codes:
```typescript
LEAVE_RESOURCE_CODES.backdatedApply = "HR_LEAVE_BACKDATED_APPLY"
OUT_WORK_RESOURCE_CODES.backdatedApply = "HR_OUT_WORK_BACKDATED_APPLY"
```

**SA must configure** these resource codes in the ACL system and assign them to HR roles.
This is done via the existing SA → ACL admin panel (no code change needed in ACL system).

---

### Phase 4-B — Backend [9%]

**New file:** `supabase/functions/api/_core/hr/attendance_correction.handlers.ts`

**Handler: `hrBackdatedLeaveApplyHandler`**
- Route: `POST /api/hr/leave/backdated-apply`
- Auth: requires `HR_LEAVE_BACKDATED_APPLY` permission
- Payload:
  ```typescript
  {
    target_employee_auth_user_id: string,
    company_id: string,
    leave_type_id: string,
    from_date: string,
    to_date: string,
    reason: string,
    correction_note: string
  }
  ```
- Logic:
  - No backdate limit check (HR is exempt)
  - Validate leave_type_id belongs to company
  - Check no overlapping approved leave for target employee
  - Create leave_request with:
    - `requester_auth_user_id = target_employee_auth_user_id`
    - `applied_by_auth_user_id = current HR user`
  - Create workflow_request — goes to approver as normal
  - The applying HR user cannot also be the approver (workflow engine already enforces this)

**Handler: `hrBackdatedOutWorkApplyHandler`**
- Route: `POST /api/hr/out-work/backdated-apply`
- Auth: requires `HR_OUT_WORK_BACKDATED_APPLY` permission
- Same pattern as above

**Handler: `listDayRecordsByEmployeeHandler`**
- Route: `GET /api/hr/attendance/day-records`
- Auth: requires `HR_LEAVE_BACKDATED_APPLY` or `HR_ATTENDANCE_MANUAL_CORRECTION`
- Params: `employee_auth_user_id`, `from_date`, `to_date`
- Returns: array of day records for the given employee and date range
- Used by the HR correction screen to show current status per day

**Modify:** `supabase/functions/api/_routes/hr.routes.ts`
- Add new routes

---

### Phase 4-C — Frontend [7%]

**New page: `HrAttendanceCorrectionPage`**
Location: `frontend/src/pages/dashboard/hr/`

**Screen flow:**
1. HR selects employee from a searchable dropdown
2. HR selects date range (no backdate limit in this screen)
3. System calls `listDayRecordsByEmployeeHandler` and shows:
   - A table: Date | Declared Status | Source | Applied By
   - Absent/no-record rows highlighted
4. HR clicks a row → options appear:
   - "Apply Leave on behalf" → opens inline form (leave type, reason, note)
   - "Apply Out Work on behalf" → opens inline form (destination, scope, reason, note)
5. On submit → calls `hrBackdatedLeaveApplyHandler` or `hrBackdatedOutWorkApplyHandler`
6. Success → request goes to workflow approval inbox of the configured approver

**Add to HR navigation menu.**

**Definition of Done — Phase 4:**
- HR can apply leave/out-work for any employee for any past date
- Applied records show "Applied by: [HR Name]" in detail view
- Goes through approval workflow — HR cannot self-approve on behalf
- Employee's own backdate limit unchanged
- Audit: `applied_by_auth_user_id` stored on every HR-on-behalf request

---

## PHASE 5 — MANUAL ATTENDANCE CORRECTION [15%]

**Goal:** HR can correct a day record (e.g., Absent → Present for missed punch) with full audit trail.
**Breaks existing flows:** No — additive operation on existing day records.
**User-visible:** Yes — correction action in HR attendance screen.

---

### Phase 5-A — ACL Resource Code [3%]

**Modify:** `supabase/functions/api/_core/hr/shared.ts`

```typescript
ATTENDANCE_RESOURCE_CODES = {
  manualCorrection: "HR_ATTENDANCE_MANUAL_CORRECTION",
  dayRecords: "HR_ATTENDANCE_DAY_RECORDS"
}
```

SA configures and assigns to HR roles via ACL admin panel.

---

### Phase 5-B — Backend [7%]

**Add to `attendance_correction.handlers.ts`:**

**Handler: `manualCorrectDayRecordHandler`**
- Route: `POST /api/hr/attendance/manual-correct`
- Auth: requires `HR_ATTENDANCE_MANUAL_CORRECTION` permission
- Payload:
  ```typescript
  {
    day_record_id: string,     // if row exists
    -- OR create new row if no row exists yet:
    company_id: string,
    employee_auth_user_id: string,
    record_date: string,
    -- correction fields:
    new_declared_status: string,  // "PRESENT" | "ABSENT" | etc.
    correction_note: string
  }
  ```
- Logic:
  - If `day_record_id` provided: load existing row
  - Store `previous_status = existing declared_status`
  - Update:
    ```
    declared_status    = new_declared_status
    manually_corrected = TRUE
    corrected_by       = current HR user
    corrected_at       = now()
    correction_note    = provided note
    previous_status    = old status
    source             = "MANUAL_HR"
    updated_at         = now()
    ```
  - If no row exists yet (employee had no record for that date):
    - INSERT new row with `source = "MANUAL_HR"`, manually_corrected = TRUE
  - Appends to `erp_audit.workflow_events` or similar audit log

---

### Phase 5-C — Frontend [5%]

**In `HrAttendanceCorrectionPage` (built in Phase 4):**
- Add "Correct Status" action button on each day row
- Opens inline panel:
  - Shows: "Current status: ABSENT | Change to: [dropdown]"
  - Available statuses: PRESENT, ABSENT (limited — cannot set LEAVE or OUT_WORK here, that goes through proper apply flow)
  - Correction note: required text field
- On submit → calls `manualCorrectDayRecordHandler`
- Row updates in-place after success

**In detail view of any day record:**
- If `manually_corrected = TRUE`:
  - Show audit block: "Manually corrected by [Name] on [Date] — was [previous_status] — Note: [note]"

**Definition of Done — Phase 5:**
- HR can change Absent → Present for any employee's past date
- Every correction shows full audit trail
- LEAVE and OUT_WORK statuses cannot be set via manual correction (must go through proper workflow)
- No silent edits possible

---

## PHASE 6 — HR SUMMARY REPORTS [20%]

**Goal:** HR can see all attendance and leave reports with zero manual calculation.
**Breaks existing flows:** No — new read-only screens.
**User-visible:** Yes — five new report screens.

---

### Phase 6-A — Backend [10%]

**New file:** `supabase/functions/api/_core/hr/attendance_reports.handlers.ts`

---

**Handler 1: `getMonthlyAttendanceSummaryHandler`**
- Route: `GET /api/hr/attendance/summary/monthly`
- Params: `year`, `month`, optional `employee_auth_user_id`
- Query: GROUP BY employee + declared_status + leave_type_id for given month
- Enrich with user display names and leave type names
- Return: per-employee counts by status and leave type

---

**Handler 2: `getDailyAttendanceRegisterHandler`**
- Route: `GET /api/hr/attendance/register/daily`
- Params: `from_date`, `to_date` (max 31-day range), optional employee filter
- Returns: one row per employee per date in range
- For dates with no row: placeholder with `declared_status = null`

---

**Handler 3: `getYearlyLeaveSummaryHandler`**
- Route: `GET /api/hr/attendance/summary/yearly`
- Params: `year`, `employee_auth_user_id` (required — one employee at a time)
- Query: GROUP BY month + declared_status + leave_type_id for full year
- Return: 12-row breakdown (one per month) with counts per leave type
- Shows: how many CL, SL, EL, LOP, Out Work, Present, Absent per month

---

**Handler 4: `getDepartmentAttendanceReportHandler`**
- Route: `GET /api/hr/attendance/report/department`
- Params: `from_date`, `to_date`, optional `department_work_context_id`
- Query: join employee_day_records with user work context to get department
- GROUP BY department + declared_status
- Return: per-department totals — total leave days, out-work days, absent days, present days

---

**Handler 5: `getLeaveUsageReportHandler`**
- Route: `GET /api/hr/attendance/report/leave-usage`
- Params: `year`, optional `employee_auth_user_id`
- Query: COUNT days taken per employee per leave_type for the year
- Return per employee per leave type:
  ```
  {
    employee: ...,
    leave_type_id: ...,
    type_name: ...,
    days_taken: 5,
    max_days_per_year: 12,        ← from leave_types (null if not configured)
    balance_remaining: null,      ← null until Phase 8 (Leave Policy) is implemented
    policy_configured: false      ← flag: true only after Phase 8
  }
  ```
- Note: `balance_remaining` will always be null in this phase.
  Phase 8 (Leave Policy & Balance) will populate it.
  The column is present now so frontend can show "Policy not configured yet" gracefully.

**Add all routes** in `hr.routes.ts`.

---

### Phase 6-B — Frontend [10%]

**New page: `MonthlyAttendanceSummaryPage`**
- Filter: month/year picker, optional employee filter
- Table:
  ```
  | Employee    | CL | SL | EL | LOP | Out Work | Present | Absent |
  |-------------|----|----|----|----|----------|---------|--------|
  | Rohan Kumar |  2 |  1 |  0 |  0 |    3     |   18    |   0    |
  ```
- Export to CSV

**New page: `DailyAttendanceRegisterPage`**
- Filter: date range (max 31 days), optional employee filter
- Grid: rows = employees, columns = dates
- Each cell: status badge (L, OW, P, A, —)
- Click any cell → day record detail in sidebar
- Export to CSV

**New page: `YearlyLeaveSummaryPage`**
- Filter: year, employee selector (one at a time)
- Table: 12 rows (months) × leave types + out-work + present + absent
- Export to CSV

**New page: `DepartmentAttendanceReportPage`**
- Filter: date range, optional department filter
- Table: department rows with total leave, out-work, absent, present counts
- Export to CSV

**New page: `LeaveUsageReportPage`**
- Filter: year, optional employee filter
- Table:
  ```
  | Employee    | Leave Type   | Days Taken | Max/Year | Balance        |
  |-------------|--------------|------------|----------|----------------|
  | Rohan Kumar | Casual Leave |     5      |   12     | Not configured |
  | Rohan Kumar | Sick Leave   |     2      |    7     | Not configured |
  ```
- "Not configured" shown clearly until Phase 8 is implemented
- Export to CSV

**Add all five pages to HR navigation menu.**

**Definition of Done — Phase 6:**
- [ ] Monthly attendance summary shows correct counts per employee per type
- [ ] Daily register grid shows correct status per cell
- [ ] Yearly summary shows 12-month breakdown for selected employee
- [ ] Department report shows department-wise totals
- [ ] Leave usage report shows days taken — balance column shows "Not configured"
- [ ] CSV export works for all five reports
- [ ] Zero manual calculation needed anywhere

---

## PHASE 7 — HISTORICAL BACKFILL [Mandatory, 5%]

**Goal:** Populate day records for all historically approved leaves and out-works.
**Why mandatory:** Without this, HR summary reports will be incomplete for all past data. Phases 1-6 only cover new approvals going forward.
**Risk:** Read-only from existing tables, write to new table. Idempotent — safe to re-run.
**When to run:** Immediately after Phase 2 and Phase 3 are complete. Run by SA via migration.

**Migration script:**

```sql
-- Backfill leave day records for all approved leave requests
INSERT INTO erp_hr.employee_day_records (
  company_id, employee_auth_user_id, record_date,
  declared_status, leave_request_id, leave_type_id, source
)
SELECT
  lr.parent_company_id,
  lr.requester_auth_user_id,
  gs.d::DATE,
  'LEAVE',
  lr.leave_request_id,
  lr.leave_type_id,
  'LEAVE_APPROVED'
FROM erp_hr.leave_requests lr
JOIN acl.workflow_requests wr ON wr.workflow_request_id = lr.workflow_request_id
CROSS JOIN LATERAL generate_series(lr.from_date, lr.to_date, '1 day'::interval) AS gs(d)
WHERE wr.current_state = 'APPROVED'
ON CONFLICT (company_id, employee_auth_user_id, record_date) DO NOTHING;

-- Backfill out-work day records for all approved out-work requests
INSERT INTO erp_hr.employee_day_records (
  company_id, employee_auth_user_id, record_date,
  declared_status, out_work_request_id, out_work_day_scope,
  out_work_departure_time, source
)
SELECT
  owr.parent_company_id,
  owr.requester_auth_user_id,
  gs.d::DATE,
  'OUT_WORK',
  owr.out_work_request_id,
  owr.day_scope,
  owr.office_departure_time,
  'OUT_WORK_APPROVED'
FROM erp_hr.out_work_requests owr
JOIN acl.workflow_requests wr ON wr.workflow_request_id = owr.workflow_request_id
CROSS JOIN LATERAL generate_series(owr.from_date, owr.to_date, '1 day'::interval) AS gs(d)
WHERE wr.current_state = 'APPROVED'
ON CONFLICT (company_id, employee_auth_user_id, record_date) DO NOTHING;
```

---

## PHASE 8 — LEAVE POLICY & BALANCE MANAGEMENT [Future — Not scoped]

⚠ DO NOT IMPLEMENT WITHOUT A DEDICATED DESIGN SESSION ⚠

This phase requires a full separate design discussion before any code is written.
The scope below is preliminary only — it will change after that discussion.

**Why a separate session is needed:**
- Leave entitlement rules vary per company, per employee grade, per leave type
- Accrual logic (monthly vs annual vs joining-date-based) needs business decisions
- Encashment rules (who can encash, how much, when, tax implications) need HR input
- Year-end carry-forward processing needs policy decisions
- All of these affect salary computation — high-risk area

**Foundation already in place from current phases (no rework needed):**
- `leave_types.max_days_per_year` — ready to hold entitlement reference
- `leave_types.carry_forward_allowed` — ready for year-end logic
- `employee_day_records.leave_type_id` — counting days taken is already queryable
- `leave_requests.leave_type_id` — all requests are type-tagged
- `getLeaveUsageReportHandler` already returns `days_taken` per type per employee
- `LeaveUsageReportPage` already shows "Not configured" as placeholder for balance

**Preliminary scope (to be confirmed in design session):**
- Leave entitlement table: per employee per type per year
- Monthly accrual ledger: credits per month per employee per type
- Balance ledger: running balance (opening + credits - debits)
- Leave encashment flow: request → approval → balance deduction → payroll flag
- Maximum encashable days (per type, per year)
- Post-encashment balance tracking
- Year-end processing: carry-forward up to max allowed, lapse the rest
- Balance visibility: employee sees own, manager sees team, HR sees all

**When ready to implement:**
Start with the dedicated design session.
Then update this file with the full Phase 8 plan before writing any code.

---

## GENERAL RULES FOR ALL PHASES

1. Each phase migration file gets a unique timestamp prefix: `20260427_10_`, `20260427_20_`, etc.
2. Every new backend handler follows the existing error handling pattern in the codebase.
3. Every new DB function is created in the `erp_hr` schema.
4. RLS must be enabled on every new table.
5. No phase modifies or removes any existing column.
6. New columns that are NOT NULL must be backfilled before the NOT NULL constraint is applied.
7. Every frontend change must preserve existing keyboard navigation patterns.
8. The `generateDateRange` function must be in `shared.ts` and reused — not duplicated.
9. Log progress in `HR_ATTENDANCE_PROGRESS_LOG.md` after each sub-phase completes.
