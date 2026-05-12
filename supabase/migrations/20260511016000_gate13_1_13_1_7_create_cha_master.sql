/*
 * File-ID: 13.1.7
 * File-Path: supabase/migrations/20260511016000_gate13_1_13_1_7_create_cha_master.sql
 * Gate: 13.1
 * Phase: 13
 * Domain: L2_MASTERS
 * Purpose: CHA Master and CHA-Port mapping for import clearance agent tracking.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.cha_master (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System-generated: CHA-0001, CHA-0002 etc.
  cha_code            text NOT NULL UNIQUE,
  cha_name            text NOT NULL,

  -- Customs broker license number - mandatory
  cha_license_number  text NOT NULL,

  gst_number          text NULL,
  pan_number          text NULL,
  contact_person      text NULL,
  phone               text NULL,
  email               text NULL,
  address             text NULL,

  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL
);

COMMENT ON TABLE erp_master.cha_master IS
'Clearing and Handling Agent master. Procurement-managed (no SA required). Referenced by CSN import fields, port_master.default_cha_id, and Landed Cost entries.';

-- CHA-Port Mapping
-- Which ports this CHA operates at (reference/filter only - not a hard constraint)
CREATE TABLE IF NOT EXISTS erp_master.cha_port_map (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cha_id      uuid NOT NULL
    REFERENCES erp_master.cha_master(id)
    ON DELETE RESTRICT,
  port_id     uuid NOT NULL
    REFERENCES erp_master.port_master(id)
    ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (cha_id, port_id)
);

COMMENT ON TABLE erp_master.cha_port_map IS
'Maps CHA agents to ports where they operate. Used for reference and dropdown filtering - not a hard constraint. A CSN can use any CHA regardless of this mapping.';

-- CHA code sequence
CREATE TABLE IF NOT EXISTS erp_master.cha_code_sequence (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_number int NOT NULL DEFAULT 0
);
INSERT INTO erp_master.cha_code_sequence (id, last_number) VALUES (1, 0)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION erp_master.generate_cha_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.cha_code_sequence
  SET last_number = last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'CHA-' || lpad(v_next::text, 4, '0');
END;
$$;

CREATE INDEX IF NOT EXISTS idx_cha_code    ON erp_master.cha_master (cha_code);
CREATE INDEX IF NOT EXISTS idx_cha_active  ON erp_master.cha_master (active);
CREATE INDEX IF NOT EXISTS idx_cpm_cha     ON erp_master.cha_port_map (cha_id);
CREATE INDEX IF NOT EXISTS idx_cpm_port    ON erp_master.cha_port_map (port_id);

GRANT SELECT ON erp_master.cha_master         TO authenticated;
GRANT SELECT ON erp_master.cha_port_map       TO authenticated;
GRANT ALL    ON erp_master.cha_master         TO service_role;
GRANT ALL    ON erp_master.cha_port_map       TO service_role;
GRANT ALL    ON erp_master.cha_code_sequence  TO service_role;

COMMIT;
