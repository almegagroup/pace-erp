/*
 * File-ID: 9.3
 * File-Path: supabase/migrations/20260315102000_gate9_9_3_create_group_master.sql
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: Canonical Group master for Admin Universe
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- GROUP MASTER (ADMIN UNIVERSE)
-- Governance-only entity. NOT a security boundary.
-- ============================================================

CREATE TABLE IF NOT EXISTS erp_master.groups (
  id           BIGSERIAL PRIMARY KEY,

  group_code   TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,

  state        TEXT NOT NULL DEFAULT 'ACTIVE',

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_master.groups IS
'Canonical group registry for admin governance. Groups are NOT security boundaries.';

-- ------------------------------------------------------------
-- GROUP CODE SEQUENCE (GRP001, GRP002, ...)
-- ------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS erp_master.group_code_seq
START WITH 1
INCREMENT BY 1;

CREATE OR REPLACE FUNCTION erp_master.generate_group_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  seq_val BIGINT;
BEGIN
  seq_val := nextval('erp_master.group_code_seq');
  RETURN 'GRP' || lpad(seq_val::TEXT, 3, '0');
END;
$$;

-- ------------------------------------------------------------
-- DEFAULT GROUP CODE ASSIGNMENT
-- ------------------------------------------------------------

ALTER TABLE erp_master.groups
ALTER COLUMN group_code
SET DEFAULT erp_master.generate_group_code();

-- ------------------------------------------------------------
-- STATE INVARIANT
-- ------------------------------------------------------------

ALTER TABLE erp_master.groups
ADD CONSTRAINT chk_group_state_valid
CHECK (state IN ('ACTIVE', 'INACTIVE'));

-- ------------------------------------------------------------
-- IMMUTABLE GROUP CODE
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION erp_master.prevent_group_code_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.group_code IS DISTINCT FROM OLD.group_code THEN
    RAISE EXCEPTION
      'GROUP_CODE_IMMUTABLE: group_code cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_group_code_update
ON erp_master.groups;

CREATE TRIGGER trg_prevent_group_code_update
BEFORE UPDATE
ON erp_master.groups
FOR EACH ROW
EXECUTE FUNCTION erp_master.prevent_group_code_update();

COMMIT;
