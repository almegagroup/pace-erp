-- Remove business data that was incorrectly placed in migrations.
-- These should be configured per-tenant via UI or MCP, not baked into migrations.
-- After applying this migration, re-seed via MCP for each environment.

BEGIN;

-- ─── 1. Opening Stock — remove ACL capability wiring ─────────────────────────
-- Was added in: 20260619000001_opening_stock_sa_to_acl.sql
-- The erp_menu.menu_master UPDATE (SA→ACL universe move) stays — that is structural.
-- Only the acl.menu_master + capability_menu_actions rows are business config.

DELETE FROM acl.capability_menu_actions
WHERE menu_id = (SELECT id FROM acl.menu_master WHERE menu_code = 'PROC_OPENING_STOCK_LIST');

DELETE FROM acl.menu_master WHERE menu_code = 'PROC_OPENING_STOCK_LIST';

-- ─── 2. HR Leave Types — remove India-specific seeded types ──────────────────
-- Was added in: 20260427101000_10_1a_hr_leave_types.sql (Step 3)
-- The table structure, indexes, RLS, and NOT NULL enforcement stay — those are structural.
-- Only the seeded rows (GEN/CL/SL/EL/LOP) are business data.

-- Drop NOT NULL temporarily so FK references can be nullified
ALTER TABLE erp_hr.leave_requests ALTER COLUMN leave_type_id DROP NOT NULL;

-- Nullify leave_request references to the seeded types
UPDATE erp_hr.leave_requests
SET leave_type_id = NULL
WHERE leave_type_id IN (
  SELECT leave_type_id FROM erp_hr.leave_types
  WHERE type_code IN ('GEN', 'CL', 'SL', 'EL', 'LOP')
);

-- Delete the seeded leave types
DELETE FROM erp_hr.leave_types
WHERE type_code IN ('GEN', 'CL', 'SL', 'EL', 'LOP');

COMMIT;
