/*
 * File-ID: 7.5.21
 * File-Path: supabase/migrations/20260410110000_gate7_5_21_create_module_resource_map.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ACL
 * Purpose: Declare explicit Module -> Resource ownership truth.
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- MODULE -> RESOURCE MAP
-- ------------------------------------------------------------
-- Purpose:
--   - Bind each governed resource to exactly one module
--   - Prevent orphan pages/resources outside module ownership
--   - Keep module global while company assignment remains separate
--   - Prepare approval scope to move below module level safely
-- ============================================================

CREATE TABLE IF NOT EXISTS acl.module_resource_map (
  module_code   TEXT NOT NULL
    REFERENCES acl.module_registry(module_code)
    ON DELETE CASCADE,

  resource_code TEXT NOT NULL
    REFERENCES erp_menu.menu_master(resource_code)
    ON DELETE CASCADE,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID NULL,

  CONSTRAINT pk_module_resource_map
    PRIMARY KEY (module_code, resource_code),

  CONSTRAINT uq_module_resource_unique_resource
    UNIQUE (resource_code)
);

COMMENT ON TABLE acl.module_resource_map IS
'Explicit ownership map between global modules and governed resources. One resource belongs to exactly one module. Company assignment remains separate through company_module_map.';

COMMENT ON COLUMN acl.module_resource_map.module_code IS
'Global module identity. Same module may later be assigned to many companies.';

COMMENT ON COLUMN acl.module_resource_map.resource_code IS
'Governed page or ACL resource owned by exactly one module.';

ALTER TABLE acl.module_resource_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE acl.module_resource_map FORCE ROW LEVEL SECURITY;

COMMIT;
