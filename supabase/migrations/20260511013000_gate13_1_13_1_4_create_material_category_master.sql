/*
 * File-ID: 13.1.4
 * File-Path: supabase/migrations/20260511013000_gate13_1_13_1_4_create_material_category_master.sql
 * Gate: 13.1
 * Phase: 13
 * Domain: L2_MASTERS
 * Purpose: Material Category Master for procurement planning grouping and lead time lookup.
 * Authority: Backend
 */

BEGIN;

-- Material Category Master
-- This is the PROCUREMENT PLANNING category (e.g. "RM - Fibre", "PM - Carton").
-- NOT the same as material_category_group (Gate-12) which groups functional substitutes.
CREATE TABLE IF NOT EXISTS erp_master.material_category_master (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System-generated: MC-0001, MC-0002 etc.
  category_code   text NOT NULL UNIQUE,
  category_name   text NOT NULL,
  description     text NULL,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL
);

COMMENT ON TABLE erp_master.material_category_master IS
'Procurement planning material categories (e.g. RM - Fibre, PM - Carton). Used for ETA grouping and lead time lookup. Separate from material_category_group (functional equivalents / substitution). SA-managed.';

-- Material-to-Category Assignment
-- Each material belongs to one procurement planning category.
CREATE TABLE IF NOT EXISTS erp_master.material_category_assignment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  material_id     uuid NOT NULL
    REFERENCES erp_master.material_master(id)
    ON DELETE RESTRICT,

  category_id     uuid NOT NULL
    REFERENCES erp_master.material_category_master(id)
    ON DELETE RESTRICT,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL,

  -- One category per material
  UNIQUE (material_id)
);

COMMENT ON TABLE erp_master.material_category_assignment IS
'Maps each material to its procurement planning category. One-to-one: a material has exactly one planning category.';

-- Category code sequence
CREATE TABLE IF NOT EXISTS erp_master.material_category_code_sequence (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_number int NOT NULL DEFAULT 0
);
INSERT INTO erp_master.material_category_code_sequence (id, last_number) VALUES (1, 0)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION erp_master.generate_material_category_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.material_category_code_sequence
  SET last_number = last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'MC-' || lpad(v_next::text, 4, '0');
END;
$$;

CREATE INDEX IF NOT EXISTS idx_mcm_code     ON erp_master.material_category_master (category_code);
CREATE INDEX IF NOT EXISTS idx_mcm_active   ON erp_master.material_category_master (active);
CREATE INDEX IF NOT EXISTS idx_mca_material ON erp_master.material_category_assignment (material_id);
CREATE INDEX IF NOT EXISTS idx_mca_category ON erp_master.material_category_assignment (category_id);

GRANT SELECT ON erp_master.material_category_master         TO authenticated;
GRANT SELECT ON erp_master.material_category_assignment     TO authenticated;
GRANT ALL    ON erp_master.material_category_master         TO service_role;
GRANT ALL    ON erp_master.material_category_assignment     TO service_role;
GRANT ALL    ON erp_master.material_category_code_sequence  TO service_role;

COMMIT;
