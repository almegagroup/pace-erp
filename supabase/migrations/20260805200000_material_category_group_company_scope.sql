-- material_category_group ("Material Group (Alternate)", used from Stroke
-- Master's Alternate picker) was built with no company_id at all -- a group
-- created while working under one company was visible/reusable under every
-- other company. Add company_id, backfill existing dev rows from their own
-- members' material_company_ext mapping (all 4 existing rows resolve to
-- CMP003), then enforce NOT NULL and move the uniqueness to
-- (company_id, group_code) instead of a global group_code.

ALTER TABLE erp_master.material_category_group
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES erp_master.companies(id);

UPDATE erp_master.material_category_group g
SET company_id = mce.company_id
FROM erp_master.material_category_group_member gm
JOIN erp_master.material_company_ext mce ON mce.material_id = gm.material_id
WHERE gm.group_id = g.id AND g.company_id IS NULL;

-- Fallback for any group whose member material has no material_company_ext
-- row to infer from (e.g. a packaging material never plant-extended) --
-- every remaining dev row was in fact created under CMP003 (verified
-- 2026-08-05), so this is a safe, verified fallback for dev, not a guess.
UPDATE erp_master.material_category_group
SET company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP003')
WHERE company_id IS NULL;

ALTER TABLE erp_master.material_category_group
  ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE erp_master.material_category_group
  DROP CONSTRAINT IF EXISTS material_category_group_group_code_key;

ALTER TABLE erp_master.material_category_group
  ADD CONSTRAINT material_category_group_company_group_code_key
  UNIQUE (company_id, group_code);
