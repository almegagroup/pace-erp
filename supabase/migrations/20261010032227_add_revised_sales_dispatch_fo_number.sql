BEGIN;

-- The original Asian Paints Sales/Dispatch FO remains an immutable audit
-- reference.  A corrected number is stored separately and becomes the
-- operational lookup value for future VDC/DD activity.
ALTER TABLE erp_procurement.sales_order_map_group
  ADD COLUMN IF NOT EXISTS revised_external_fo_number text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_so_map_group_so_revised_external_fo_number
  ON erp_procurement.sales_order_map_group (so_id, revised_external_fo_number)
  WHERE revised_external_fo_number IS NOT NULL;

NOTIFY pgrst, 'reload schema';
COMMIT;
