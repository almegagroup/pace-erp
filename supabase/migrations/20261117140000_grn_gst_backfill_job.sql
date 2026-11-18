-- Background job row for the AC01 "GRN stock-value correction" Apply.
-- The cascade for one material can take minutes; the request now returns a job id at once and the screen polls this row,
-- so a dropped connection can no longer leave the browser waiting on work that has already finished.
CREATE TABLE IF NOT EXISTS erp_procurement.grn_gst_backfill_job (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id  uuid        NOT NULL,
  status       text        NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'DONE', 'FAILED')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  result       jsonb,
  error        text,
  created_by   uuid
);

-- One RUNNING job per material: a second Apply for the same material is refused instead of racing the first.
CREATE UNIQUE INDEX IF NOT EXISTS ux_grn_gst_backfill_job_running_material
  ON erp_procurement.grn_gst_backfill_job (material_id) WHERE status = 'RUNNING';

ALTER TABLE erp_procurement.grn_gst_backfill_job ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON erp_procurement.grn_gst_backfill_job FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON erp_procurement.grn_gst_backfill_job TO service_role;

NOTIFY pgrst, 'reload schema';
