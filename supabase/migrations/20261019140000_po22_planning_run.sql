/*
 * Migration: 20261019140000_po22_planning_run
 * Purpose:   PO22 user-triggered planning runs kept for traceability (Phase 2D §2/§6: no approval,
 *            acknowledgement or revision chain; a rerun is simply the newer view).
 *            One immutable row per saved run: requirement + planning + Store report payload.
 *   Planning data only. Never touches PO, CSN, GRN, stock, reservation or GL.
 *   After applying (owner approval required): NOTIFY pgrst, 'reload schema'; reconcile schema_migrations;
 *   run migration-integrity-check.
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_planning.mts_planning_run (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES erp_master.companies(id),
  plan_month         date NOT NULL CHECK (date_trunc('month', plan_month)::date = plan_month),
  as_of              date NOT NULL,
  demand_at          timestamptz,
  source_fingerprint text NOT NULL,
  run_label          text CHECK (run_label IS NULL OR length(run_label) <= 200),
  result             jsonb NOT NULL,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_mts_planning_run_company
  ON erp_planning.mts_planning_run (company_id, created_at DESC);
COMMENT ON TABLE erp_planning.mts_planning_run IS
  'PO22 saved planning runs (immutable): requirement, daily planning projection, advisory buys and Store report as calculated at run time.';

CREATE OR REPLACE FUNCTION erp_planning.guard_mts_planning_run_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'MTS_PLANNING_RUN_IMMUTABLE: saved planning runs cannot be changed or deleted';
END;
$$;

DROP TRIGGER IF EXISTS trg_mts_planning_run_immutable ON erp_planning.mts_planning_run;
CREATE TRIGGER trg_mts_planning_run_immutable
  BEFORE UPDATE OR DELETE ON erp_planning.mts_planning_run
  FOR EACH ROW EXECUTE FUNCTION erp_planning.guard_mts_planning_run_immutable();

ALTER TABLE erp_planning.mts_planning_run ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON erp_planning.mts_planning_run TO service_role;

COMMIT;
