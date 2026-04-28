-- =============================================================================
-- Migration: 20260427102000_20_2a_hr_employee_day_records
-- Phase:     2-A  (HR Attendance — Day Records + Holiday Calendar)
-- Goal:      1. Create erp_hr.employee_day_records (core attendance day table)
--            2. Create erp_hr.company_holiday_calendar (per-company holiday dates)
--            3. Create erp_hr.company_week_off_config (per-company week-off days)
--            4. Add effective_leave_days to erp_hr.leave_requests
--            5. Create erp_hr.upsert_day_record_leave DB function (with
--               HOLIDAY_CALENDAR / WEEK_OFF_CALENDAR guard)
-- Design:    HR_ATTENDANCE_FULL_DESIGN.md § Entity 4, 5, 6 + PART 12
-- Plan:      HR_ATTENDANCE_IMPLEMENTATION_PLAN.md § Phase 2-A
-- =============================================================================


-- =============================================================================
-- SECTION 1 — erp_hr.employee_day_records
-- =============================================================================

CREATE TABLE erp_hr.employee_day_records (
  day_record_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 UUID NOT NULL REFERENCES erp_master.companies(id),
  employee_auth_user_id      UUID NOT NULL REFERENCES auth.users(id),
  record_date                DATE NOT NULL,

  declared_status            TEXT NOT NULL
                               CHECK (declared_status IN (
                                 'PRESENT', 'LEAVE', 'OUT_WORK',
                                 'HOLIDAY', 'WEEK_OFF', 'ABSENT', 'MISS_PUNCH'
                               )),

  -- Leave linkage (NULL when declared_status != 'LEAVE')
  leave_request_id           UUID REFERENCES erp_hr.leave_requests(leave_request_id),
  leave_type_id              UUID REFERENCES erp_hr.leave_types(leave_type_id),

  -- Out-work linkage (NULL when declared_status != 'OUT_WORK')
  out_work_request_id        UUID REFERENCES erp_hr.out_work_requests(out_work_request_id),
  out_work_day_scope         TEXT CHECK (out_work_day_scope IN ('FULL_DAY', 'PARTIAL_DAY')),
  out_work_departure_time    TIME,

  -- Future biometric columns — present now, all NULL until biometric integration
  -- Do NOT repurpose before biometric phase
  biometric_first_punch      TIMESTAMPTZ,
  biometric_last_punch       TIMESTAMPTZ,
  biometric_work_minutes     INTEGER,
  biometric_reconciled_at    TIMESTAMPTZ,
  biometric_reconcile_note   TEXT,

  -- Manual correction audit
  manually_corrected         BOOLEAN NOT NULL DEFAULT FALSE,
  corrected_by               UUID REFERENCES auth.users(id),
  corrected_at               TIMESTAMPTZ,
  correction_note            TEXT,
  previous_status            TEXT,  -- what declared_status was before correction

  -- Record lifecycle source
  source                     TEXT NOT NULL
                               CHECK (source IN (
                                 'LEAVE_APPROVED',
                                 'OUT_WORK_APPROVED',
                                 'HOLIDAY_CALENDAR',
                                 'WEEK_OFF_CALENDAR',
                                 'MANUAL_HR',
                                 'BIOMETRIC_AUTO'
                               )),

  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One truth per person per day — SACRED constraint
  UNIQUE (company_id, employee_auth_user_id, record_date)
);

CREATE INDEX idx_day_records_company_date_status
  ON erp_hr.employee_day_records (company_id, record_date, declared_status);

CREATE INDEX idx_day_records_employee_date
  ON erp_hr.employee_day_records (company_id, employee_auth_user_id, record_date DESC);

ALTER TABLE erp_hr.employee_day_records ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read day records (handler enforces company scoping)
CREATE POLICY day_records_read_authenticated
  ON erp_hr.employee_day_records
  FOR SELECT
  TO authenticated
  USING (TRUE);


-- =============================================================================
-- SECTION 2 — erp_hr.company_holiday_calendar
-- =============================================================================

CREATE TABLE erp_hr.company_holiday_calendar (
  holiday_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES erp_master.companies(id),
  holiday_date   DATE NOT NULL,
  holiday_name   TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES auth.users(id),

  -- One holiday entry per date per company
  UNIQUE (company_id, holiday_date)
);

CREATE INDEX idx_holiday_calendar_company_date
  ON erp_hr.company_holiday_calendar (company_id, holiday_date);

ALTER TABLE erp_hr.company_holiday_calendar ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read holidays (needed for sandwich preview in apply form)
CREATE POLICY holiday_calendar_read_authenticated
  ON erp_hr.company_holiday_calendar
  FOR SELECT
  TO authenticated
  USING (TRUE);


-- =============================================================================
-- SECTION 3 — erp_hr.company_week_off_config
-- =============================================================================

CREATE TABLE erp_hr.company_week_off_config (
  week_off_config_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES erp_master.companies(id),

  -- ISO weekday numbers: 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun
  -- Default [6, 7] = Saturday + Sunday
  -- If no row exists for a company, backend defaults to [6, 7]
  week_off_days       INTEGER[] NOT NULL DEFAULT ARRAY[6, 7],

  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          UUID REFERENCES auth.users(id),

  -- Exactly one config row per company
  UNIQUE (company_id)
);

ALTER TABLE erp_hr.company_week_off_config ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read week-off config (needed for sandwich preview)
CREATE POLICY week_off_config_read_authenticated
  ON erp_hr.company_week_off_config
  FOR SELECT
  TO authenticated
  USING (TRUE);


-- =============================================================================
-- SECTION 4 — Add effective_leave_days to erp_hr.leave_requests
-- =============================================================================

ALTER TABLE erp_hr.leave_requests
  ADD COLUMN effective_leave_days INTEGER;

-- NULL = pre-Phase 2 row (no sandwich calc was done at apply time)
-- Phase 8 (Leave Balance) treats NULL as total_days for backward compatibility
-- Value is computed at apply-time by createLeaveRequestHandler and locked.
-- Never recalculated after submission — even if the holiday calendar changes.

COMMENT ON COLUMN erp_hr.leave_requests.effective_leave_days IS
  'Sandwich-adjusted leave count. Excludes leading/trailing holidays and week-offs '
  'but includes sandwiched ones. Computed and locked at apply-time. '
  'NULL for pre-Phase-2 rows (treat as total_days for balance purposes).';


-- =============================================================================
-- SECTION 5 — erp_hr.upsert_day_record_leave DB function
-- =============================================================================
-- Called by expandLeaveToDateRecords (Phase 2-B backend) for each date in the
-- approved leave range.
--
-- Guard rule: if an existing row has source IN ('HOLIDAY_CALENDAR','WEEK_OFF_CALENDAR'),
-- do NOT overwrite it — the holiday/week-off status takes precedence.
-- The leave request still charges the employee (via effective_leave_days) but the
-- day record retains its HOLIDAY/WEEK_OFF declared_status.
-- =============================================================================

CREATE OR REPLACE FUNCTION erp_hr.upsert_day_record_leave(
  p_company_id        UUID,
  p_employee_id       UUID,
  p_record_date       DATE,
  p_leave_request_id  UUID,
  p_leave_type_id     UUID
) RETURNS VOID AS $$
BEGIN
  INSERT INTO erp_hr.employee_day_records (
    company_id,
    employee_auth_user_id,
    record_date,
    declared_status,
    leave_request_id,
    leave_type_id,
    source,
    created_at,
    updated_at
  )
  VALUES (
    p_company_id,
    p_employee_id,
    p_record_date,
    'LEAVE',
    p_leave_request_id,
    p_leave_type_id,
    'LEAVE_APPROVED',
    now(),
    now()
  )
  ON CONFLICT (company_id, employee_auth_user_id, record_date) DO UPDATE
    SET
      declared_status  = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR', 'WEEK_OFF_CALENDAR')
          THEN employee_day_records.declared_status   -- preserve holiday/week-off
        ELSE 'LEAVE'
      END,
      leave_request_id = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR', 'WEEK_OFF_CALENDAR')
          THEN employee_day_records.leave_request_id  -- preserve
        ELSE p_leave_request_id
      END,
      leave_type_id    = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR', 'WEEK_OFF_CALENDAR')
          THEN employee_day_records.leave_type_id     -- preserve
        ELSE p_leave_type_id
      END,
      source           = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR', 'WEEK_OFF_CALENDAR')
          THEN employee_day_records.source            -- preserve
        ELSE 'LEAVE_APPROVED'
      END,
      updated_at       = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
