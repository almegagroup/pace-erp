BEGIN;

-- MTS has a batch series per Prodshade. A batch number may therefore recur in
-- one company on a different MTS Prodshade; only the same Prodshade must be
-- blocked. Non-MTS batches keep their existing company-wide identity because
-- they have no equivalent Prodshade-scoped range contract.
ALTER TABLE erp_production.batch_number_instance
  DROP CONSTRAINT IF EXISTS uq_batch_number_instance_company_number;

CREATE UNIQUE INDEX IF NOT EXISTS ux_batch_number_instance_mts_prodshade_number
  ON erp_production.batch_number_instance (company_id, prodshade_material_id, batch_number)
  WHERE po_type = 'MTS';

CREATE UNIQUE INDEX IF NOT EXISTS ux_batch_number_instance_non_mts_company_number
  ON erp_production.batch_number_instance (company_id, batch_number)
  WHERE po_type <> 'MTS';

COMMIT;
