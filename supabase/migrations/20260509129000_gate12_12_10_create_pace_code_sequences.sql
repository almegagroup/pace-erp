/*
 * File-ID: 12.10
 * File-Path: supabase/migrations/20260509129000_gate12_12_10_create_pace_code_sequences.sql
 * Gate: 12
 * Phase: 12
 * Domain: MASTER
 * Purpose: Create PACE code sequence tables and SECURITY DEFINER generator functions for materials, vendors, and customers.
 * Authority: Backend
 */

BEGIN;

-- Material code sequences - one per material type
CREATE TABLE IF NOT EXISTS erp_master.material_code_sequence (
  material_type   text PRIMARY KEY,
  last_number     int NOT NULL DEFAULT 0,
  prefix          text NOT NULL,
  padding         int NOT NULL DEFAULT 5
);

-- Seed one row per active material type
INSERT INTO erp_master.material_code_sequence (material_type, prefix, padding) VALUES
  ('RM',   'RM-',   5),
  ('PM',   'PM-',   5),
  ('INT',  'INT-',  5),
  ('FG',   'FG-',   5),
  ('TRA',  'TRA-',  5),
  ('CONS', 'CONS-', 5)
ON CONFLICT (material_type) DO NOTHING;

-- Function: atomically generate next PACE material code
CREATE OR REPLACE FUNCTION erp_master.generate_material_pace_code(
  p_material_type text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_seq   erp_master.material_code_sequence%ROWTYPE;
  v_next  int;
  v_code  text;
BEGIN
  UPDATE erp_master.material_code_sequence
  SET last_number = last_number + 1
  WHERE material_type = p_material_type
  RETURNING * INTO v_seq;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_MATERIAL_TYPE: %', p_material_type;
  END IF;

  v_code := v_seq.prefix || lpad(v_seq.last_number::text, v_seq.padding, '0');
  RETURN v_code;
END;
$$;

-- Vendor code sequence
CREATE TABLE IF NOT EXISTS erp_master.vendor_code_sequence (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton
  last_number int NOT NULL DEFAULT 0
);
INSERT INTO erp_master.vendor_code_sequence (id, last_number) VALUES (1, 0)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION erp_master.generate_vendor_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.vendor_code_sequence
  SET last_number = last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'V-' || lpad(v_next::text, 5, '0');
END;
$$;

-- Customer code sequence
CREATE TABLE IF NOT EXISTS erp_master.customer_code_sequence (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_number int NOT NULL DEFAULT 0
);
INSERT INTO erp_master.customer_code_sequence (id, last_number) VALUES (1, 0)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION erp_master.generate_customer_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.customer_code_sequence
  SET last_number = last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'C-' || lpad(v_next::text, 5, '0');
END;
$$;

COMMIT;
