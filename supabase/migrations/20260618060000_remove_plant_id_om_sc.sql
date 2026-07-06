-- Migration: Remove plant_id from all OM/SC tables
-- Rationale: In PACE ERP, each Company IS a Plant for OM/Supply Chain.
-- The Plant concept (erp_master.projects) will only be introduced later
-- in Engineering & Maintenance. All OM/SC operations are scoped at company level.
--
-- Tables affected:
--   erp_master.material_plant_ext
--   erp_inventory.storage_location_plant_map
--   erp_inventory.stock_document
--   erp_inventory.stock_ledger
--   erp_inventory.stock_snapshot
--   erp_inventory.physical_inventory_block
--   erp_procurement.opening_stock_document
--   erp_procurement.purchase_order
--   erp_procurement.gate_entry
--   erp_procurement.gate_exit_inbound
--   erp_procurement.gate_exit_outbound
--   erp_procurement.inward_qa_document
--   erp_procurement.physical_inventory_document

-- ============================================================
-- 1. erp_master.material_plant_ext
-- ============================================================
ALTER TABLE erp_master.material_plant_ext
  DROP CONSTRAINT IF EXISTS material_plant_ext_material_id_company_id_plant_id_key,
  DROP CONSTRAINT IF EXISTS material_plant_ext_plant_id_fkey;

DROP INDEX IF EXISTS erp_master.idx_mpe_material_plant;
DROP INDEX IF EXISTS erp_master.material_plant_ext_material_id_company_id_plant_id_key;

ALTER TABLE erp_master.material_plant_ext
  DROP COLUMN IF EXISTS plant_id;

CREATE UNIQUE INDEX material_plant_ext_material_id_company_id_key
  ON erp_master.material_plant_ext (material_id, company_id);

CREATE INDEX idx_mpe_material_company
  ON erp_master.material_plant_ext (material_id, company_id);

-- ============================================================
-- 2. erp_inventory.storage_location_plant_map
-- ============================================================
ALTER TABLE erp_inventory.storage_location_plant_map
  DROP CONSTRAINT IF EXISTS storage_location_plant_map_storage_location_id_company_id_p_key,
  DROP CONSTRAINT IF EXISTS storage_location_plant_map_plant_id_fkey;

DROP INDEX IF EXISTS erp_inventory.storage_location_plant_map_storage_location_id_company_id_p_key;
DROP INDEX IF EXISTS erp_inventory.idx_slpm_one_default_grn;

ALTER TABLE erp_inventory.storage_location_plant_map
  DROP COLUMN IF EXISTS plant_id;

CREATE UNIQUE INDEX storage_location_plant_map_storage_location_id_company_id_key
  ON erp_inventory.storage_location_plant_map (storage_location_id, company_id);

CREATE UNIQUE INDEX idx_slpm_one_default_grn
  ON erp_inventory.storage_location_plant_map (company_id)
  WHERE is_default_grn_location = TRUE AND active = TRUE;

-- ============================================================
-- 3. erp_inventory.stock_document
-- ============================================================
DROP INDEX IF EXISTS erp_inventory.idx_sd_company_plant;

ALTER TABLE erp_inventory.stock_document
  DROP COLUMN IF EXISTS plant_id;

CREATE INDEX idx_sd_company
  ON erp_inventory.stock_document (company_id);

-- ============================================================
-- 4. erp_inventory.stock_ledger
-- ============================================================
DROP INDEX IF EXISTS erp_inventory.idx_sl_company_plant_material;

ALTER TABLE erp_inventory.stock_ledger
  DROP COLUMN IF EXISTS plant_id;

CREATE INDEX idx_sl_company_material
  ON erp_inventory.stock_ledger (company_id, material_id);

-- ============================================================
-- 5. erp_inventory.stock_snapshot
-- ============================================================
DROP INDEX IF EXISTS erp_inventory.idx_ss_unique_stock_position;
DROP INDEX IF EXISTS erp_inventory.idx_ss_company_plant_material;

ALTER TABLE erp_inventory.stock_snapshot
  DROP COLUMN IF EXISTS plant_id;

CREATE UNIQUE INDEX idx_ss_unique_stock_position
  ON erp_inventory.stock_snapshot (
    company_id, storage_location_id, material_id, stock_type_code,
    COALESCE(batch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX idx_ss_company_material
  ON erp_inventory.stock_snapshot (company_id, material_id);

-- ============================================================
-- 6. erp_inventory.physical_inventory_block
-- ============================================================
ALTER TABLE erp_inventory.physical_inventory_block
  DROP CONSTRAINT IF EXISTS physical_inventory_block_material_id_plant_id_storage_locat_key,
  DROP CONSTRAINT IF EXISTS physical_inventory_block_plant_id_fkey;

DROP INDEX IF EXISTS erp_inventory.physical_inventory_block_material_id_plant_id_storage_locat_key;
DROP INDEX IF EXISTS erp_inventory.idx_pib_material_plant_sloc;

ALTER TABLE erp_inventory.physical_inventory_block
  DROP COLUMN IF EXISTS plant_id;

CREATE UNIQUE INDEX physical_inventory_block_material_id_storage_location_id_key
  ON erp_inventory.physical_inventory_block (material_id, storage_location_id);

CREATE INDEX idx_pib_material_sloc
  ON erp_inventory.physical_inventory_block (material_id, storage_location_id);

-- ============================================================
-- 7. erp_procurement.opening_stock_document
-- ============================================================
ALTER TABLE erp_procurement.opening_stock_document
  DROP CONSTRAINT IF EXISTS opening_stock_document_company_id_plant_id_cut_off_date_key,
  DROP CONSTRAINT IF EXISTS opening_stock_document_plant_id_fkey;

DROP INDEX IF EXISTS erp_procurement.opening_stock_document_company_id_plant_id_cut_off_date_key;

ALTER TABLE erp_procurement.opening_stock_document
  DROP COLUMN IF EXISTS plant_id;

CREATE UNIQUE INDEX opening_stock_document_company_id_cut_off_date_key
  ON erp_procurement.opening_stock_document (company_id, cut_off_date);

-- ============================================================
-- 8. erp_procurement.purchase_order
-- ============================================================
ALTER TABLE erp_procurement.purchase_order
  DROP CONSTRAINT IF EXISTS purchase_order_plant_id_fkey;

ALTER TABLE erp_procurement.purchase_order
  DROP COLUMN IF EXISTS plant_id;

-- ============================================================
-- 9. erp_procurement.gate_entry
-- ============================================================
ALTER TABLE erp_procurement.gate_entry
  DROP CONSTRAINT IF EXISTS gate_entry_plant_id_fkey;

ALTER TABLE erp_procurement.gate_entry
  DROP COLUMN IF EXISTS plant_id;

-- ============================================================
-- 10. erp_procurement.gate_exit_inbound
-- ============================================================
ALTER TABLE erp_procurement.gate_exit_inbound
  DROP CONSTRAINT IF EXISTS gate_exit_inbound_plant_id_fkey;

ALTER TABLE erp_procurement.gate_exit_inbound
  DROP COLUMN IF EXISTS plant_id;

-- ============================================================
-- 11. erp_procurement.gate_exit_outbound
-- ============================================================
ALTER TABLE erp_procurement.gate_exit_outbound
  DROP CONSTRAINT IF EXISTS gate_exit_outbound_plant_id_fkey;

ALTER TABLE erp_procurement.gate_exit_outbound
  DROP COLUMN IF EXISTS plant_id;

-- ============================================================
-- 12. erp_procurement.inward_qa_document
-- ============================================================
ALTER TABLE erp_procurement.inward_qa_document
  DROP CONSTRAINT IF EXISTS inward_qa_document_plant_id_fkey;

ALTER TABLE erp_procurement.inward_qa_document
  DROP COLUMN IF EXISTS plant_id;

-- ============================================================
-- 13. erp_procurement.physical_inventory_document
-- ============================================================
DROP INDEX IF EXISTS erp_procurement.idx_pid_plant_status;

ALTER TABLE erp_procurement.physical_inventory_document
  DROP CONSTRAINT IF EXISTS physical_inventory_document_plant_id_fkey;

ALTER TABLE erp_procurement.physical_inventory_document
  DROP COLUMN IF EXISTS plant_id;

CREATE INDEX idx_pid_status
  ON erp_procurement.physical_inventory_document (status);
