-- Found live 2026-09-30 (business owner): a PID (Physical Inventory Document)
-- opened in CMP003 against a storage location code (e.g. "R003") was blocking
-- PGI/GRN/dispatch postings in CMP006 for the SAME material at the SAME
-- storage_location_id -- even though the two companies' stock is entirely
-- separate (stock_snapshot/stock_ledger both key by company_id). Root cause:
-- erp_inventory.storage_location_master carries no company_id at all (a
-- location code like "R003" is shared/reused across sister companies that
-- share a physical site), but physical_inventory_block -- the table the
-- posting-block check (hasPhysicalInventoryBlock, _shared/physicalInventoryBlock.ts)
-- reads -- was keyed ONLY by (material_id, storage_location_id, stock_type[,
-- batch_number]), with no company_id column, so a block registered by one
-- company's PID matched every other company's postings against that same
-- shared location row too. The same gap also meant two different companies
-- could never open a PID at the same time against a material at a shared
-- location code -- the old unique indexes below would have rejected the
-- second company's PID's block-insert as a duplicate.
ALTER TABLE erp_inventory.physical_inventory_block
  ADD COLUMN company_id uuid;

UPDATE erp_inventory.physical_inventory_block pib
SET company_id = pid.company_id
FROM erp_procurement.physical_inventory_document pid
WHERE pib.pi_document_id = pid.id
  AND pib.company_id IS NULL;

ALTER TABLE erp_inventory.physical_inventory_block
  ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE erp_inventory.physical_inventory_block
  ADD CONSTRAINT physical_inventory_block_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES erp_master.companies(id);

-- Replace the old (material, location, stock_type[, batch]) uniqueness/lookup
-- indexes with company-scoped equivalents -- same shape, company_id prefixed.
DROP INDEX IF EXISTS erp_inventory.idx_pib_material_sloc;
DROP INDEX IF EXISTS erp_inventory.idx_pib_material_sloc_stock_type;
DROP INDEX IF EXISTS erp_inventory.physical_inventory_block_blended_stock_type_uk;
DROP INDEX IF EXISTS erp_inventory.physical_inventory_block_batch_stock_type_uk;

CREATE INDEX idx_pib_company_material_sloc
  ON erp_inventory.physical_inventory_block (company_id, material_id, storage_location_id);

CREATE INDEX idx_pib_company_material_sloc_stock_type
  ON erp_inventory.physical_inventory_block (company_id, material_id, storage_location_id, stock_type);

CREATE UNIQUE INDEX physical_inventory_block_blended_stock_type_uk
  ON erp_inventory.physical_inventory_block (company_id, material_id, storage_location_id, stock_type)
  WHERE (batch_number IS NULL);

CREATE UNIQUE INDEX physical_inventory_block_batch_stock_type_uk
  ON erp_inventory.physical_inventory_block (company_id, material_id, storage_location_id, stock_type, batch_number)
  WHERE (batch_number IS NOT NULL);

NOTIFY pgrst, 'reload schema';
