/*
 * Gate: 27.26 AC06 v3
 * Purpose: Lock AC06 data entry to May 2026 onward and stop read-triggered closure.
 */

BEGIN;

ALTER TABLE erp_production.ac06_month
  ADD CONSTRAINT ac06_month_start_date_check
  CHECK (rate_month >= DATE '2026-05-01') NOT VALID;

ALTER TABLE erp_production.ac06_month
  VALIDATE CONSTRAINT ac06_month_start_date_check;

COMMENT ON FUNCTION erp_production.auto_close_expired_ac06_months(date) IS
  'Reserved for an explicit scheduled close job. Workspace reads must not invoke it; authorized users manually close AC06 months.';

COMMIT;
