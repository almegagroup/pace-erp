/*
 * File-ID: 7.3C
 * File-Path: supabase/migrations/20260410102000_gate7_7_3C_sa_global_menu_snapshot.sql
 * Gate: 7
 * Phase: 7
 * Domain: MENU
 * Purpose: Convert SA snapshot to global (company-independent) while preserving ACL behavior
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- 1️⃣ SAFETY CHECK — ensure no invalid SA rows exist
-- ============================================================

DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM erp_menu.menu_snapshot
  WHERE universe = 'SA'
    AND company_id IS NOT NULL;

  IF v_count > 0 THEN
    RAISE EXCEPTION
      'Migration blocked: SA rows still contain company_id (% rows). Cleanup required before applying migration.',
      v_count;
  END IF;
END $$;

-- ============================================================
-- 2️⃣ DROP NOT NULL constraint on company_id
-- ============================================================

ALTER TABLE erp_menu.menu_snapshot
ALTER COLUMN company_id DROP NOT NULL;

COMMENT ON COLUMN erp_menu.menu_snapshot.company_id IS
'NULL for SA (global snapshot), NOT NULL for ACL (company-scoped snapshot).';

-- ============================================================
-- 3️⃣ DROP OLD UNIFIED INDEX (if exists)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'erp_menu'
      AND tablename = 'menu_snapshot'
      AND indexname = 'ux_menu_snapshot_identity'
  ) THEN
    EXECUTE 'DROP INDEX erp_menu.ux_menu_snapshot_identity';
  END IF;
END $$;

-- ============================================================
-- 4️⃣ CREATE ACL UNIQUE INDEX (company-scoped)
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS ux_menu_snapshot_acl
ON erp_menu.menu_snapshot (
  user_id,
  company_id,
  universe,
  snapshot_version,
  menu_code
)
WHERE universe = 'ACL';

COMMENT ON INDEX erp_menu.ux_menu_snapshot_acl IS
'Ensures uniqueness for ACL snapshots (company-scoped).';

-- ============================================================
-- 5️⃣ CREATE SA UNIQUE INDEX (global)
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS ux_menu_snapshot_sa
ON erp_menu.menu_snapshot (
  user_id,
  universe,
  snapshot_version,
  menu_code
)
WHERE universe = 'SA';

COMMENT ON INDEX erp_menu.ux_menu_snapshot_sa IS
'Ensures uniqueness for SA snapshots (global, company-independent).';

-- ============================================================
-- 6️⃣ ADD STRICT INTEGRITY CONSTRAINT
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_menu_snapshot_scope'
  ) THEN

    ALTER TABLE erp_menu.menu_snapshot
    ADD CONSTRAINT chk_menu_snapshot_scope
    CHECK (
      (universe = 'SA'  AND company_id IS NULL)
      OR
      (universe = 'ACL' AND company_id IS NOT NULL)
    );

  END IF;
END $$;

COMMENT ON CONSTRAINT chk_menu_snapshot_scope ON erp_menu.menu_snapshot IS
'SA rows must have NULL company_id; ACL rows must have non-null company_id.';

COMMIT;