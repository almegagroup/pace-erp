/*
 * File-ID: 7.1A
 * File-Path: supabase/migrations/20260305102000_gate7_7_1A_menu_invariants.sql
 * Gate: 7
 * Phase: 7
 * Domain: ACL
 * Purpose: Structural safety invariants for menu registry
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- HARD INVARIANTS — MENU SAFETY
-- ============================================================

-- menu_code must be globally unique
CREATE UNIQUE INDEX IF NOT EXISTS ux_menu_master_menu_code
ON erp_menu.menu_master (menu_code);

-- resource_code must be globally unique
CREATE UNIQUE INDEX IF NOT EXISTS ux_menu_master_resource_code
ON erp_menu.menu_master (resource_code);

-- route_path must be unique if present
CREATE UNIQUE INDEX IF NOT EXISTS ux_menu_master_route_path
ON erp_menu.menu_master (route_path)
WHERE route_path IS NOT NULL;

-- PAGE menus MUST have a route_path
ALTER TABLE erp_menu.menu_master
ADD CONSTRAINT chk_page_requires_route
CHECK (
  (menu_type = 'PAGE' AND route_path IS NOT NULL)
  OR
  (menu_type = 'GROUP' AND route_path IS NULL)
);

-- system menus cannot be deactivated
CREATE OR REPLACE FUNCTION erp_menu.prevent_system_menu_disable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_system = true AND NEW.is_active = false THEN
    RAISE EXCEPTION 'System menu cannot be disabled';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_system_menu_disable
ON erp_menu.menu_master;

CREATE TRIGGER trg_prevent_system_menu_disable
BEFORE UPDATE ON erp_menu.menu_master
FOR EACH ROW
EXECUTE FUNCTION erp_menu.prevent_system_menu_disable();

COMMIT;
