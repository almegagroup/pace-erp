/*
 * File-ID: 27.1
 * File-Path: supabase/migrations/20260629181941_gate27_27_1_add_sfg_material_type.sql
 * Gate: 27
 * Phase: 27
 * Domain: MASTER
 * Purpose: Add SFG (Semi-Finished Goods) to the material_type allowed value set, for
 *          Process PO bulk output (pre-packing FG) under the Two-Order Model (83.4).
 * Authority: Backend
 */

BEGIN;

ALTER TABLE erp_master.material_master
  DROP CONSTRAINT IF EXISTS material_master_material_type_check;

ALTER TABLE erp_master.material_master
  ADD CONSTRAINT material_master_material_type_check
  CHECK (material_type = ANY (ARRAY['RM', 'PM', 'INT', 'SFG', 'FG', 'TRA', 'CONS']));

ALTER TABLE erp_master.material_type_category
  DROP CONSTRAINT IF EXISTS material_type_category_material_type_check;

ALTER TABLE erp_master.material_type_category
  ADD CONSTRAINT material_type_category_material_type_check
  CHECK (material_type = ANY (ARRAY['RM', 'PM', 'INT', 'SFG', 'FG', 'TRA', 'CONS']));

-- Material code sequence row required for generate_material_pace_code('SFG')
INSERT INTO erp_master.material_code_sequence (material_type, prefix, padding)
VALUES ('SFG', 'SFG-', 5)
ON CONFLICT (material_type) DO NOTHING;

COMMIT;
