-- =============================================================================
-- Migration: 20260428070000_70_7_hr_historical_backfill
-- Phase:     7  (HR Attendance — Historical Backfill)
-- Goal:      Populate erp_hr.employee_day_records for all historically approved
--            leave and out-work requests that existed before Phase 2 / Phase 3
--            were deployed (i.e. before the expand hooks were live).
--
-- Safety:    Uses the same SECURITY DEFINER upsert functions as the live path:
--              - erp_hr.upsert_day_record_leave
--              - erp_hr.upsert_day_record_out_work
--            Both functions guard HOLIDAY_CALENDAR / WEEK_OFF_CALENDAR rows —
--            they will NOT be overwritten by this backfill.
--
--            The upsert is idempotent: re-running this migration is safe.
--            Rows already written by the live hook are overwritten with the
--            same data (no net change).
--
-- Scope:     Only APPROVED workflow requests are backfilled.
--            CANCELLED / REJECTED requests produce no day records (same as
--            the live path where expand only fires on APPROVED).
--
-- Run order: Must run AFTER Phase 2-A and Phase 3-A migrations are applied.
-- =============================================================================


-- =============================================================================
-- SECTION 1 — Backfill leave day records
-- =============================================================================
-- For every APPROVED leave request, call upsert_day_record_leave for each
-- calendar date in [from_date, to_date] inclusive.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  d DATE;
BEGIN
  FOR r IN
    SELECT
      lr.leave_request_id,
      lr.requester_auth_user_id,
      lr.parent_company_id,
      lr.leave_type_id,
      lr.from_date,
      lr.to_date
    FROM erp_hr.leave_requests lr
    JOIN acl.workflow_requests wr
      ON wr.request_id = lr.workflow_request_id
    WHERE wr.current_state = 'APPROVED'
      AND lr.from_date IS NOT NULL
      AND lr.to_date   IS NOT NULL
    ORDER BY lr.from_date
  LOOP
    FOR d IN
      SELECT gs::DATE
      FROM generate_series(r.from_date, r.to_date, '1 day'::interval) AS gs
    LOOP
      PERFORM erp_hr.upsert_day_record_leave(
        r.parent_company_id,
        r.requester_auth_user_id,
        d,
        r.leave_request_id,
        r.leave_type_id
      );
    END LOOP;
  END LOOP;
END;
$$;


-- =============================================================================
-- SECTION 2 — Backfill out-work day records
-- =============================================================================
-- For every APPROVED out-work request, call upsert_day_record_out_work for
-- each calendar date in [from_date, to_date] inclusive.
-- PARTIAL_DAY requests will have day_scope = 'PARTIAL_DAY' and a non-NULL
-- office_departure_time — both are stored correctly by the upsert function.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  d DATE;
BEGIN
  FOR r IN
    SELECT
      owr.out_work_request_id,
      owr.requester_auth_user_id,
      owr.parent_company_id,
      owr.from_date,
      owr.to_date,
      owr.day_scope,
      owr.office_departure_time
    FROM erp_hr.out_work_requests owr
    JOIN acl.workflow_requests wr
      ON wr.request_id = owr.workflow_request_id
    WHERE wr.current_state = 'APPROVED'
      AND owr.from_date IS NOT NULL
      AND owr.to_date   IS NOT NULL
    ORDER BY owr.from_date
  LOOP
    FOR d IN
      SELECT gs::DATE
      FROM generate_series(r.from_date, r.to_date, '1 day'::interval) AS gs
    LOOP
      PERFORM erp_hr.upsert_day_record_out_work(
        r.parent_company_id,
        r.requester_auth_user_id,
        d,
        r.out_work_request_id,
        r.day_scope,
        r.office_departure_time
      );
    END LOOP;
  END LOOP;
END;
$$;


-- =============================================================================
-- SECTION 3 — Verification counts
-- =============================================================================
-- Run these SELECT statements after applying the migration to confirm the
-- backfill produced reasonable numbers. Compare against leave/out-work register
-- report totals.
--
-- SELECT COUNT(*) FROM erp_hr.employee_day_records WHERE source = 'LEAVE_APPROVED';
-- SELECT COUNT(*) FROM erp_hr.employee_day_records WHERE source = 'OUT_WORK_APPROVED';
-- SELECT COUNT(*) FROM erp_hr.employee_day_records;
-- =============================================================================
