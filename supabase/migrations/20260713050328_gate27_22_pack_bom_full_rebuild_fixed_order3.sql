/*
 * Migration: 20260713093000_gate27_22_pack_bom_full_rebuild
 * Gate: 27.22
 * Purpose: Rebuild Pack BOM as company-scoped OUTPUT/SFG/PM BOM with line storage locations,
 *          PACE movement display codes, primary-container markers, and outer-UOM conversion support.
 * Authority: Backend
 */

BEGIN;

INSERT INTO erp_master.uom_master (code, name, uom_type) VALUES
  ('BTL', 'Bottle', 'PACKING'),
  ('JAR', 'Jar', 'PACKING'),
  ('BBL', 'Barrel', 'PACKING'),
  ('IBC', 'Intermediate Bulk Container', 'PACKING')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE erp_production.pack_code_master
  ADD COLUMN IF NOT EXISTS outer_uom_code text;

ALTER TABLE erp_production.pack_code_master
  DROP CONSTRAINT IF EXISTS pack_code_master_pack_type_check;

ALTER TABLE erp_production.pack_code_master
  ADD CONSTRAINT pack_code_master_pack_type_check
    CHECK (pack_type IN ('BARREL','IBC','TANKER','MTEST','BOTTLE','PACKET','BAG','JAR'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pack_code_master_outer_uom_code_fkey'
      AND conrelid = 'erp_production.pack_code_master'::regclass
  ) THEN
    ALTER TABLE erp_production.pack_code_master
      ADD CONSTRAINT pack_code_master_outer_uom_code_fkey
        FOREIGN KEY (outer_uom_code) REFERENCES erp_master.uom_master(code);
  END IF;
END $$;

INSERT INTO erp_production.pack_code_master
  (pack_code, pack_name, pack_type, billing_uom, bom_required, outer_uom_code, active)
VALUES
  ('050', '050 Bottle', 'BOTTLE', 'PER_UNIT', true, 'BTL', true),
  ('110', '110 Bottle', 'BOTTLE', 'PER_UNIT', true, 'BTL', true),
  ('120', '120 Bottle', 'BOTTLE', 'PER_UNIT', true, 'BTL', true),
  ('207', '207 Packet', 'PACKET', 'PER_UNIT', true, 'PKT', true),
  ('210', '210 Bag', 'BAG', 'PER_UNIT', true, 'BAG', true),
  ('250', '250 Bottle', 'BOTTLE', 'PER_UNIT', true, 'BTL', true),
  ('310', '310 Jar', 'JAR', 'PER_UNIT', true, 'JAR', true),
  ('320', '320 Jar', 'JAR', 'PER_UNIT', true, 'JAR', true),
  ('330', '330 Jar', 'JAR', 'PER_UNIT', true, 'JAR', true),
  ('340', '340 Jar', 'JAR', 'PER_UNIT', true, 'JAR', true),
  ('350', '350 Jar', 'JAR', 'PER_UNIT', true, 'JAR', true),
  ('450', '450 Barrel', 'BARREL', 'PER_UNIT', true, 'BBL', true),
  ('510', '510 IBC', 'IBC', 'PER_KG', false, 'IBC', true),
  ('599', '599 Barrel', 'BARREL', 'PER_UNIT', false, 'BBL', true),
  ('000', '000 Tanker', 'TANKER', 'PER_KG', false, 'KG', true),
  ('001', '001 Packet', 'MTEST', 'PER_UNIT', false, 'PKT', true)
ON CONFLICT (pack_code) DO UPDATE SET
  pack_name = EXCLUDED.pack_name,
  pack_type = EXCLUDED.pack_type,
  billing_uom = EXCLUDED.billing_uom,
  bom_required = EXCLUDED.bom_required,
  outer_uom_code = EXCLUDED.outer_uom_code,
  active = EXCLUDED.active;

ALTER TABLE erp_production.pack_bom
  ADD COLUMN IF NOT EXISTS company_id uuid;

UPDATE erp_production.pack_bom pb
SET company_id = resolved.company_id
FROM (
  SELECT pb_inner.id, min(mpe.company_id) AS company_id
  FROM erp_production.pack_bom pb_inner
  JOIN erp_master.material_plant_ext mpe
    ON mpe.material_id = pb_inner.sku_material_id
   AND mpe.status = 'ACTIVE'
  GROUP BY pb_inner.id
  HAVING count(DISTINCT mpe.company_id) = 1
) resolved
WHERE pb.id = resolved.id
  AND pb.company_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM erp_production.pack_bom WHERE company_id IS NULL) THEN
    RAISE EXCEPTION 'GATE27_22_PACK_BOM_COMPANY_BACKFILL_AMBIGUOUS';
  END IF;
END $$;

ALTER TABLE erp_production.pack_bom
  ALTER COLUMN company_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pack_bom_company_id_fkey'
      AND conrelid = 'erp_production.pack_bom'::regclass
  ) THEN
    ALTER TABLE erp_production.pack_bom
      ADD CONSTRAINT pack_bom_company_id_fkey
        FOREIGN KEY (company_id) REFERENCES erp_master.companies(id);
  END IF;
END $$;

ALTER TABLE erp_production.pack_bom
  DROP CONSTRAINT IF EXISTS pack_bom_sku_material_id_key;

DROP INDEX IF EXISTS erp_production.pack_bom_sku_material_id_key;
DROP INDEX IF EXISTS erp_production.ux_pack_bom_sku_open;
DROP INDEX IF EXISTS erp_production.ux_pack_bom_company_sku_open;

CREATE UNIQUE INDEX ux_pack_bom_company_sku_open
  ON erp_production.pack_bom (company_id, sku_material_id)
  WHERE status IN ('DRAFT', 'ACTIVE');

ALTER TABLE erp_production.pack_bom_line
  ADD COLUMN IF NOT EXISTS storage_location_id uuid,
  ADD COLUMN IF NOT EXISTS movement_type_code text,
  ADD COLUMN IF NOT EXISTS is_primary_container boolean NOT NULL DEFAULT false;

ALTER TABLE erp_production.pack_bom_line
  DROP CONSTRAINT IF EXISTS pack_bom_line_line_type_check;

ALTER TABLE erp_production.pack_bom_line
  ADD CONSTRAINT pack_bom_line_line_type_check
    CHECK (line_type IN ('OUTPUT', 'SFG', 'INPUT'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pack_bom_line_storage_location_id_fkey'
      AND conrelid = 'erp_production.pack_bom_line'::regclass
  ) THEN
    ALTER TABLE erp_production.pack_bom_line
      ADD CONSTRAINT pack_bom_line_storage_location_id_fkey
        FOREIGN KEY (storage_location_id) REFERENCES erp_inventory.storage_location_master(id);
  END IF;
END $$;

ALTER TABLE erp_production.pack_bom_change_request_line
  ADD COLUMN IF NOT EXISTS is_primary_container boolean NOT NULL DEFAULT false;

COMMIT;
