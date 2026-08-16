BEGIN;

-- The previous PID stock-type migration added the correct unique indexes,
-- but the old ones were not schema-qualified and therefore were not actually
-- dropped on environments where erp_inventory is not on search_path.
DROP INDEX IF EXISTS erp_inventory.physical_inventory_block_blended_uk;
DROP INDEX IF EXISTS erp_inventory.physical_inventory_block_batch_uk;

COMMIT;
