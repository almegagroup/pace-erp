-- §138.19 -- Page 4 reads a bucket by company + location + machine + material.
-- One index serves both a normal machine (machine_id = value) and a foreign
-- machine's Unassigned bucket (machine_id IS NULL).

CREATE INDEX IF NOT EXISTS idx_machine_stock_log_bucket_lookup
  ON erp_production.machine_stock_log (
    company_id,
    storage_location_id,
    machine_id,
    material_id
  );
