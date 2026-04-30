-- =============================================================================
-- File:      20260430090000_95_hr_calendar_day_kind_overrides.sql
-- Purpose:   Extend HR calendar to support explicit per-date HOLIDAY / WEEK_OFF /
--            WORKING_DAY entries while preserving company-level recurring week-off
--            configuration.
-- =============================================================================

ALTER TABLE erp_hr.company_holiday_calendar
  ADD COLUMN day_kind TEXT NOT NULL DEFAULT 'HOLIDAY'
  CHECK (day_kind IN ('HOLIDAY', 'WEEK_OFF', 'WORKING_DAY'));

ALTER TABLE erp_hr.company_holiday_calendar
  ALTER COLUMN holiday_name DROP NOT NULL;

COMMENT ON COLUMN erp_hr.company_holiday_calendar.day_kind IS
  'Per-date calendar truth. HOLIDAY = holiday/non-working day, WEEK_OFF = explicit one-off week off, WORKING_DAY = explicit override that removes recurring week-off for this date.';

COMMENT ON COLUMN erp_hr.company_holiday_calendar.holiday_name IS
  'Human-readable label or note for the calendar entry. Required for HOLIDAY entries; optional for WEEK_OFF and WORKING_DAY overrides.';
