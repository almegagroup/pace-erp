BEGIN;

CREATE TABLE IF NOT EXISTS erp_production.batch_number_instance (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES erp_master.companies(id),
  po_type                 TEXT NOT NULL,
  prodshade_material_id   UUID REFERENCES erp_master.material_master(id),
  batch_number            TEXT NOT NULL,
  status                  TEXT NOT NULL CHECK (status = ANY (ARRAY['ACTIVE','VOIDED','RELEASED'])),
  source_process_order_id UUID REFERENCES erp_production.process_order(id),
  voided_at               TIMESTAMPTZ,
  released_by             UUID,
  released_at             TIMESTAMPTZ,
  release_reason          TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_by         UUID,
  CONSTRAINT uq_batch_number_instance_company_number UNIQUE (company_id, batch_number)
);

CREATE INDEX IF NOT EXISTS ix_batch_number_instance_company_status
  ON erp_production.batch_number_instance (company_id, status, po_type, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_batch_number_instance_source_order
  ON erp_production.batch_number_instance (source_process_order_id);

GRANT ALL ON TABLE erp_production.batch_number_instance TO service_role;

COMMIT;
