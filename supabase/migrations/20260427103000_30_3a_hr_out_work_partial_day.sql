-- =============================================================================
-- Migration: 20260427103000_30_3a_hr_out_work_partial_day
-- Phase:     3-A  (HR Attendance — Out Work Partial Day)
-- Goal:      1. Add day_scope, office_departure_time, applied_by_auth_user_id
--               to erp_hr.out_work_requests
--            2. Backfill existing rows to FULL_DAY (explicit, defensive)
--            3. Create erp_hr.upsert_day_record_out_work DB function
--               (same HOLIDAY_CALENDAR / WEEK_OFF_CALENDAR guard as leave)
-- Design:    HR_ATTENDANCE_FULL_DESIGN.md § Entity 3
-- Plan:      HR_ATTENDANCE_IMPLEMENTATION_PLAN.md § Phase 3-A
-- Safe to re-run: No — ALTER TABLE is not idempotent; run exactly once.
-- =============================================================================


-- =============================================================================
-- SECTION 1 — Extend erp_hr.out_work_requests
-- =============================================================================

-- day_scope: FULL_DAY (default) or PARTIAL_DAY (single date, departure time required)
ALTER TABLE erp_hr.out_work_requests
  ADD COLUMN day_scope TEXT NOT NULL DEFAULT 'FULL_DAY'
    CONSTRAINT ck_out_work_requests_day_scope
      CHECK (day_scope IN ('FULL_DAY', 'PARTIAL_DAY'));

-- Time employee departed office on a partial-day out-work (NULL for FULL_DAY)
ALTER TABLE erp_hr.out_work_requests
  ADD COLUMN office_departure_time TIME;

-- HR backdated applications set this to the HR user's auth ID (NULL = self-apply)
-- Used by Phase 4 (HR Backdated Application). Column added here so Phase 3
-- and Phase 4 share the same field on the same table without a later ALTER.
ALTER TABLE erp_hr.out_work_requests
  ADD COLUMN applied_by_auth_user_id UUID
    REFERENCES auth.users(id);


-- =============================================================================
-- SECTION 2 — Backfill existing rows
-- =============================================================================
-- day_scope already defaults to 'FULL_DAY' for the ALTER above, but we run
-- an explicit UPDATE as a defensive measure for any row that may have slipped
-- through with a NULL (should not happen given the NOT NULL DEFAULT, but safe).

UPDATE erp_hr.out_work_requests
SET
  day_scope              = 'FULL_DAY',
  office_departure_time  = NULL
WHERE day_scope IS NULL;


-- =============================================================================
-- SECTION 3 — erp_hr.upsert_day_record_out_work DB function
-- =============================================================================
-- Called by expandOutWorkToDateRecords (Phase 3-B backend) for each date in
-- the approved out-work range.
--
-- Guard rule (same as leave): if an existing row has
-- source IN ('HOLIDAY_CALENDAR', 'WEEK_OFF_CALENDAR'), do NOT overwrite it.
-- The day record retains its HOLIDAY / WEEK_OFF status. The out-work request
-- still links to the record but the declared_status is preserved.
-- =============================================================================

CREATE OR REPLACE FUNCTION erp_hr.upsert_day_record_out_work(
  p_company_id            UUID,
  p_employee_id           UUID,
  p_record_date           DATE,
  p_out_work_request_id   UUID,
  p_day_scope             TEXT,
  p_departure_time        TIME
) RETURNS VOID AS $$
BEGIN
  INSERT INTO erp_hr.employee_day_records (
    company_id,
    employee_auth_user_id,
    record_date,
    declared_status,
    out_work_request_id,
    out_work_day_scope,
    out_work_departure_time,
    source,
    created_at,
    updated_at
  )
  VALUES (
    p_company_id,
    p_employee_id,
    p_record_date,
    'OUT_WORK',
    p_out_work_request_id,
    p_day_scope,
    p_departure_time,
    'OUT_WORK_APPROVED',
    now(),
    now()
  )
  ON CONFLICT (company_id, employee_auth_user_id, record_date) DO UPDATE
    SET
      declared_status         = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR', 'WEEK_OFF_CALENDAR')
          THEN employee_day_records.declared_status     -- preserve holiday/week-off
        ELSE 'OUT_WORK'
      END,
      out_work_request_id     = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR', 'WEEK_OFF_CALENDAR')
          THEN employee_day_records.out_work_request_id -- preserve
        ELSE p_out_work_request_id
      END,
      out_work_day_scope      = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR', 'WEEK_OFF_CALENDAR')
          THEN employee_day_records.out_work_day_scope  -- preserve
        ELSE p_day_scope
      END,
      out_work_departure_time = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR', 'WEEK_OFF_CALENDAR')
          THEN employee_day_records.out_work_departure_time -- preserve
        ELSE p_departure_time
      END,
      source                  = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR', 'WEEK_OFF_CALENDAR')
          THEN employee_day_records.source              -- preserve
        ELSE 'OUT_WORK_APPROVED'
      END,
      updated_at              = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
