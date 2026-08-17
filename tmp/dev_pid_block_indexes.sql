SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'erp_inventory'
  AND tablename = 'physical_inventory_block'
ORDER BY indexname;
