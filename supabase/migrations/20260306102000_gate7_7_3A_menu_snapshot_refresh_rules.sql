/*
 * File-ID: 7.3A
 * File-Path: supabase/migrations/20260306102000_gate7_7_3A_menu_snapshot_refresh_rules.sql
 * Gate: 7
 * Phase: 7
 * Domain: ACL
 * Purpose: Snapshot invalidation & refresh rules
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- SNAPSHOT REFRESH RULES
-- Defines WHEN a snapshot must be regenerated
-- ============================================================

CREATE TABLE IF NOT EXISTS erp_menu.menu_snapshot_refresh_rules (
  id              SERIAL PRIMARY KEY,

  trigger_source  TEXT NOT NULL,
  trigger_event   TEXT NOT NULL,

  description     TEXT NOT NULL,

  requires_refresh BOOLEAN NOT NULL DEFAULT true
);

COMMENT ON TABLE erp_menu.menu_snapshot_refresh_rules IS
'Declarative rules defining when menu snapshots become invalid and must be regenerated.';

-- Seed canonical refresh rules
INSERT INTO erp_menu.menu_snapshot_refresh_rules
(trigger_source, trigger_event, description)
VALUES
  ('ACL', 'ROLE_CHANGED', 'User role changed'),
  ('ACL', 'CAPABILITY_CHANGED', 'Capability assignment changed'),
  ('ACL', 'USER_OVERRIDE_CHANGED', 'User override added or removed'),
  ('ACL', 'MODULE_TOGGLE', 'Company module enablement changed'),
  ('MENU', 'MENU_TREE_CHANGED', 'Menu structure updated'),
  ('SYSTEM', 'MANUAL_INVALIDATE', 'Admin-triggered snapshot reset')
ON CONFLICT DO NOTHING;

COMMIT;
