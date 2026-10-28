/*
 * PO22 D9 (owner 2026-10-28): the window inside which the planner may advise the vendor to move a not-yet-dispatched
 * consignment. ETD - today must be MORE than import_min_days (import) / domestic_min_days (domestic), otherwise the advice is
 * "cannot be scheduled - talk to the vendor". Per company; no row = the code defaults (15 / 7). Planning data only.
 * After applying: NOTIFY pgrst, 'reload schema'; reconcile schema_migrations; run migration-integrity-check.
 */
BEGIN;

CREATE TABLE IF NOT EXISTS erp_planning.company_reschedule_window (
  company_id        uuid PRIMARY KEY REFERENCES erp_master.companies(id),
  import_min_days   integer NOT NULL DEFAULT 15 CHECK (import_min_days >= 0 AND import_min_days <= 365),
  domestic_min_days integer NOT NULL DEFAULT 7  CHECK (domestic_min_days >= 0 AND domestic_min_days <= 365),
  remarks           text CHECK (remarks IS NULL OR length(remarks) <= 300),
  created_by        uuid NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE erp_planning.company_reschedule_window IS
  'PO22 D9: days before ETD within which a vendor can no longer be asked to move a shipment. Import default 15, domestic default 7.';
ALTER TABLE erp_planning.company_reschedule_window ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON erp_planning.company_reschedule_window TO service_role;

COMMIT;
