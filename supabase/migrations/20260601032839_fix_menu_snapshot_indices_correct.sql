/*
 * Migration: Correct menu_snapshot unique indices
 *
 * Previous migration (20260601000001) used IF NOT EXISTS which caused it to
 * skip creating the correct ux_menu_snapshot_acl index on environments that
 * already had a partial index with that name (but missing work_context_id).
 *
 * This migration explicitly drops and recreates both indices with the
 * correct definitions — safe to run on any environment.
 */

DROP INDEX IF EXISTS erp_menu.ux_menu_snapshot_sa;
DROP INDEX IF EXISTS erp_menu.ux_menu_snapshot_acl;

-- SA universe: no company, no work_context
CREATE UNIQUE INDEX ux_menu_snapshot_sa
  ON erp_menu.menu_snapshot (user_id, universe, snapshot_version, menu_code)
  WHERE universe = 'SA'
    AND company_id IS NULL
    AND work_context_id IS NULL;

-- ACL universe: includes work_context_id — partitions per work context
CREATE UNIQUE INDEX ux_menu_snapshot_acl
  ON erp_menu.menu_snapshot (user_id, company_id, work_context_id, universe, snapshot_version, menu_code)
  WHERE universe = 'ACL'
    AND work_context_id IS NOT NULL;
