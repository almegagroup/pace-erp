/*
 * File-ID: 13.1.6
 * File-Path: supabase/migrations/20260511015000_gate13_1_13_1_6_create_transporter_master.sql
 * Gate: 13.1
 * Phase: 13
 * Domain: L2_MASTERS
 * Purpose: Transporter Master with usage_direction flag for context-filtered dropdown on inbound/outbound docs.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.transporter_master (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System-generated: TR-00001, TR-00002 etc.
  transporter_code    text NOT NULL UNIQUE,
  transporter_name    text NOT NULL,

  -- INBOUND: vendor→plant. OUTBOUND: plant→customer/plant. BOTH: appears in both.
  -- Application layer filters: inbound docs show INBOUND+BOTH. Outbound docs show OUTBOUND+BOTH.
  usage_direction     text NOT NULL
    CHECK (usage_direction IN ('INBOUND', 'OUTBOUND', 'BOTH')),

  -- ROAD | RAIL | COURIER | MULTI-MODAL
  mode                text NOT NULL DEFAULT 'ROAD'
    CHECK (mode IN ('ROAD', 'RAIL', 'COURIER', 'MULTI-MODAL')),

  contact_person      text NULL,
  phone               text NULL,
  email               text NULL,
  pan_number          text NULL,
  gst_number          text NULL,
  address             text NULL,

  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL
);

COMMENT ON TABLE erp_master.transporter_master IS
'Single transporter master. usage_direction controls dropdown visibility per context. INBOUND+BOTH shown on CSN/GE. OUTBOUND+BOTH shown on Gate Exit/Dispatch. Free-text entry always allowed at usage point for unregistered transporters.';

-- Transporter code sequence
CREATE TABLE IF NOT EXISTS erp_master.transporter_code_sequence (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_number int NOT NULL DEFAULT 0
);
INSERT INTO erp_master.transporter_code_sequence (id, last_number) VALUES (1, 0)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION erp_master.generate_transporter_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.transporter_code_sequence
  SET last_number = last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'TR-' || lpad(v_next::text, 5, '0');
END;
$$;

CREATE INDEX IF NOT EXISTS idx_tm_code      ON erp_master.transporter_master (transporter_code);
CREATE INDEX IF NOT EXISTS idx_tm_direction ON erp_master.transporter_master (usage_direction);
CREATE INDEX IF NOT EXISTS idx_tm_active    ON erp_master.transporter_master (active);

GRANT SELECT ON erp_master.transporter_master          TO authenticated;
GRANT ALL    ON erp_master.transporter_master          TO service_role;
GRANT ALL    ON erp_master.transporter_code_sequence   TO service_role;

COMMIT;
