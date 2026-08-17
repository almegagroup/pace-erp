SELECT
  column_name,
  is_nullable,
  data_type
FROM information_schema.columns
WHERE table_schema = 'erp_inventory'
  AND table_name = 'physical_inventory_block'
ORDER BY ordinal_position;

SELECT
  conname,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class t
  ON t.oid = c.conrelid
JOIN pg_namespace n
  ON n.oid = t.relnamespace
WHERE n.nspname = 'erp_inventory'
  AND t.relname = 'physical_inventory_block'
ORDER BY conname;

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'erp_inventory'
  AND tablename = 'physical_inventory_block'
ORDER BY indexname;

SELECT
  count(*) AS null_stock_type_rows
FROM erp_inventory.physical_inventory_block
WHERE stock_type IS NULL;
