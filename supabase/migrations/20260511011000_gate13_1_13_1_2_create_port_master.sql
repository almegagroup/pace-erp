/*
 * File-ID: 13.1.2
 * File-Path: supabase/migrations/20260511011000_gate13_1_13_1_2_create_port_master.sql
 * Gate: 13.1
 * Phase: 13
 * Domain: L2_MASTERS
 * Purpose: Port Master - SEA/AIR/LAND ports referenced by CSN import tracking and lead time masters.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.port_master (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System-generated: PORT-0001, PORT-0002 etc.
  port_code       text NOT NULL UNIQUE,
  port_name       text NOT NULL,

  -- SEA | AIR | LAND
  port_type       text NOT NULL
    CHECK (port_type IN ('SEA', 'AIR', 'LAND')),

  state           text NULL,
  country         text NOT NULL DEFAULT 'India',

  -- Default CHA for this port - references erp_master.cha_master(id)
  -- Plain UUID: CHA master created in 13.1.7; no FK to avoid ordering dependency
  default_cha_id  uuid NULL,

  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL
);

COMMENT ON TABLE erp_master.port_master IS
'Port master for SEA/AIR/LAND ports. SA-managed. Referenced by CSN import fields, Lead Time Master Import (port_of_discharge), and Port-to-Plant Transit Master.';

COMMENT ON COLUMN erp_master.port_master.default_cha_id IS
'Optional default CHA for this port. Plain UUID reference to erp_master.cha_master(id) - no FK constraint to avoid circular dependency with CHA master.';

-- Port code sequence
CREATE TABLE IF NOT EXISTS erp_master.port_code_sequence (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_number int NOT NULL DEFAULT 0
);
INSERT INTO erp_master.port_code_sequence (id, last_number) VALUES (1, 0)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION erp_master.generate_port_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.port_code_sequence
  SET last_number = last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'PORT-' || lpad(v_next::text, 4, '0');
END;
$$;

CREATE INDEX IF NOT EXISTS idx_pm_port_code ON erp_master.port_master (port_code);
CREATE INDEX IF NOT EXISTS idx_pm_port_type ON erp_master.port_master (port_type);
CREATE INDEX IF NOT EXISTS idx_pm_active    ON erp_master.port_master (active);

GRANT SELECT ON erp_master.port_master         TO authenticated;
GRANT ALL    ON erp_master.port_master         TO service_role;
GRANT ALL    ON erp_master.port_code_sequence  TO service_role;

COMMIT;
