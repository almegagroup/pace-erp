SELECT
  column_name,
  is_nullable,
  data_type
FROM information_schema.columns
WHERE table_schema = 'erp_inventory'
  AND table_name = 'physical_inventory_block'
ORDER BY ordinal_position;
