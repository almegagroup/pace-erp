-- =============================================================================
-- Migration: 20260428080000_80_security_fix_definer_functions
-- Phase:     Security Fix (post Phase 2-A + Phase 3-A)
-- Goal:      Fix Supabase Security Advisor warnings on the two SECURITY DEFINER
--            functions created in Phase 2-A and Phase 3-A:
--
--            Warning 1 & 2 — Function Search Path Mutable
--              Both functions lacked SET search_path, leaving them vulnerable
--              to search_path injection. Fix: recreate with SET search_path.
--
--            Warning 3–6 — Public/Signed-In Can Execute SECURITY DEFINER Function
--              Both functions were callable by anonymous and authenticated users
--              directly (default EXECUTE granted to PUBLIC). Fix: revoke from
--              public + authenticated, grant only to service_role.
--
-- These functions are only ever called from the backend via serviceRoleClient.
-- No end-user or authenticated session should ever call them directly.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- FUNCTION 1 — erp_hr.upsert_day_record_leave
-- Recreated with: SET search_path = erp_hr, public
-- Called by: expandLeaveToDateRecords in leave.handlers.ts (service_role only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION erp_hr.upsert_day_record_leave(
  p_company_id        UUID,
  p_employee_id       UUID,
  p_record_date       DATE,
  p_leave_request_id  UUID,
  p_leave_type_id     UUID
) RETURNS VOID
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = erp_hr, public
AS $$
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
          THEN employee_day_records.declared_status
        ELSE 'LEAVE'
      END,
      leave_request_id = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR', 'WEEK_OFF_CALENDAR')
          THEN employee_day_records.leave_request_id
        ELSE p_leave_request_id
      END,
      leave_type_id    = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR', 'WEEK_OFF_CALENDAR')
          THEN employee_day_records.leave_type_id
        ELSE p_leave_type_id
      END,
      source           = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR', 'WEEK_OFF_CALENDAR')
          THEN employee_day_records.source
        ELSE 'LEAVE_APPROVED'
      END,
      updated_at       = now();
END;
$$;

-- Revoke from public (covers both anonymous and authenticated by default)
REVOKE EXECUTE
  ON FUNCTION erp_hr.upsert_day_record_leave(UUID, UUID, DATE, UUID, UUID)
  FROM PUBLIC;

-- Grant only to service_role (used exclusively by backend serviceRoleClient)
GRANT EXECUTE
  ON FUNCTION erp_hr.upsert_day_record_leave(UUID, UUID, DATE, UUID, UUID)
  TO service_role;


-- ---------------------------------------------------------------------------
-- FUNCTION 2 — erp_hr.upsert_day_record_out_work
-- Recreated with: SET search_path = erp_hr, public
-- Called by: expandOutWorkToDateRecords in out_work.handlers.ts (service_role only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION erp_hr.upsert_day_record_out_work(
  p_company_id            UUID,
  p_employee_id           UUID,
  p_record_date           DATE,
  p_out_work_request_id   UUID,
  p_day_scope             TEXT,
  p_departure_time        TIME
) RETURNS VOID
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = erp_hr, public
AS $$
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
          THEN employee_day_records.declared_status
        ELSE 'OUT_WORK'
      END,
      out_work_request_id     = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR', 'WEEK_OFF_CALENDAR')
          THEN employee_day_records.out_work_request_id
        ELSE p_out_work_request_id
      END,
      out_work_day_scope      = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR', 'WEEK_OFF_CALENDAR')
          THEN employee_day_records.out_work_day_scope
        ELSE p_day_scope
      END,
      out_work_departure_time = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR', 'WEEK_OFF_CALENDAR')
          THEN employee_day_records.out_work_departure_time
        ELSE p_departure_time
      END,
      source                  = CASE
        WHEN employee_day_records.source IN ('HOLIDAY_CALENDAR', 'WEEK_OFF_CALENDAR')
          THEN employee_day_records.source
        ELSE 'OUT_WORK_APPROVED'
      END,
      updated_at              = now();
END;
$$;

-- Revoke from public (covers both anonymous and authenticated by default)
REVOKE EXECUTE
  ON FUNCTION erp_hr.upsert_day_record_out_work(UUID, UUID, DATE, UUID, TEXT, TIME)
  FROM PUBLIC;

-- Grant only to service_role (used exclusively by backend serviceRoleClient)
GRANT EXECUTE
  ON FUNCTION erp_hr.upsert_day_record_out_work(UUID, UUID, DATE, UUID, TEXT, TIME)
  TO service_role;
