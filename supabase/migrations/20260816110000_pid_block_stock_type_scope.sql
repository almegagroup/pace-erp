-- PID posting-block identity must match PID item identity.
-- Root cause fixed here: a PID item is scoped by material + storage_location +
-- stock_type (+ optional batch), but physical_inventory_block was only unique on
-- material + storage_location (+ optional batch). That caused false conflicts
-- when the same material existed at the same location in multiple stock types.

BEGIN;

ALTER TABLE erp_inventory.physical_inventory_block
  ADD COLUMN IF NOT EXISTS stock_type text;

ALTER TABLE erp_inventory.physical_inventory_block
  DROP CONSTRAINT IF EXISTS physical_inventory_block_stock_type_check;

ALTER TABLE erp_inventory.physical_inventory_block
  ADD CONSTRAINT physical_inventory_block_stock_type_check
  CHECK (stock_type IN ('UNRESTRICTED', 'QUALITY_INSPECTION', 'BLOCKED'));

COMMENT ON COLUMN erp_inventory.physical_inventory_block.stock_type IS
'PID posting-block grain must match the counted stock bucket: material + storage_location + stock_type (+ batch when batch-tracked).';

-- Drop stale residual rows tied to non-active documents before rebuilding the
-- active block set from the source-of-truth item table.
DELETE FROM erp_inventory.physical_inventory_block b
USING erp_procurement.physical_inventory_document pid
WHERE pid.id = b.pi_document_id
  AND pid.status NOT IN ('OPEN', 'COUNTED', 'PENDING_APPROVAL');

-- Backfill any rows that can be matched 1:1 to a PID item so the column can be
-- made NOT NULL after the rebuild.
UPDATE erp_inventory.physical_inventory_block b
SET stock_type = pii.stock_type
FROM erp_procurement.physical_inventory_item pii
JOIN erp_procurement.physical_inventory_document pid
  ON pid.id = pii.document_id
WHERE pid.id = b.pi_document_id
  AND pid.status IN ('OPEN', 'COUNTED', 'PENDING_APPROVAL')
  AND b.material_id = pii.material_id
  AND b.storage_location_id = pii.storage_location_id
  AND b.batch_number IS NOT DISTINCT FROM pii.batch_number
  AND b.stock_type IS NULL;

-- Rebuild the active block set from PID items so any historical under-grained
-- rows are repaired into one row per real item scope.
INSERT INTO erp_inventory.physical_inventory_block (
  material_id,
  storage_location_id,
  stock_type,
  batch_number,
  pi_document_id
)
SELECT DISTINCT
  pii.material_id,
  pii.storage_location_id,
  pii.stock_type,
  pii.batch_number,
  pii.document_id
FROM erp_procurement.physical_inventory_item pii
JOIN erp_procurement.physical_inventory_document pid
  ON pid.id = pii.document_id
WHERE pid.status IN ('OPEN', 'COUNTED', 'PENDING_APPROVAL')
  AND NOT EXISTS (
    SELECT 1
    FROM erp_inventory.physical_inventory_block b
    WHERE b.pi_document_id = pii.document_id
      AND b.material_id = pii.material_id
      AND b.storage_location_id = pii.storage_location_id
      AND b.stock_type = pii.stock_type
      AND b.batch_number IS NOT DISTINCT FROM pii.batch_number
  );

-- Remove any leftover legacy rows that still have no stock_type after the
-- active-set rebuild; they no longer represent a valid PID block identity.
DELETE FROM erp_inventory.physical_inventory_block
WHERE stock_type IS NULL;

ALTER TABLE erp_inventory.physical_inventory_block
  ALTER COLUMN stock_type SET NOT NULL;

DROP INDEX IF EXISTS erp_inventory.physical_inventory_block_material_id_storage_location_id_key;
DROP INDEX IF EXISTS physical_inventory_block_blended_uk;
DROP INDEX IF EXISTS physical_inventory_block_batch_uk;

CREATE UNIQUE INDEX physical_inventory_block_blended_stock_type_uk
  ON erp_inventory.physical_inventory_block (material_id, storage_location_id, stock_type)
  WHERE batch_number IS NULL;

CREATE UNIQUE INDEX physical_inventory_block_batch_stock_type_uk
  ON erp_inventory.physical_inventory_block (material_id, storage_location_id, stock_type, batch_number)
  WHERE batch_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pib_material_sloc_stock_type
  ON erp_inventory.physical_inventory_block (material_id, storage_location_id, stock_type);

COMMIT;
