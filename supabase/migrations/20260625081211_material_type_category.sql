-- Material category lookup, scoped per material_type (RM/PM/INT/FG/TRA/CONS).
-- Used to back a type-scoped dropdown (with inline create) for
-- material_master.material_category, which remains a free-text column.
-- This table is purely the source of valid/known category values per type.

CREATE TABLE erp_master.material_type_category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_type text NOT NULL CHECK (material_type = ANY (ARRAY['RM','PM','INT','FG','TRA','CONS'])),
  category_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (material_type, category_name)
);

-- Seed with categories already in use on real material_master rows.
INSERT INTO erp_master.material_type_category (material_type, category_name) VALUES
  ('RM', 'BASE RM'),
  ('RM', 'BIOCIDE'),
  ('PM', 'CONSUMABLES');
