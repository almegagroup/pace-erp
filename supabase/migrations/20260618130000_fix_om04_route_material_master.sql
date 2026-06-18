-- Fix OM04: route_path was /sa/om/material/create (old single-create page).
-- Material Master redesign replaced it with /sa/om/materials (new SAP-style grid).
-- Update erp_menu route + title + rebuild SA menu snapshots.

BEGIN;

-- 1. Update erp_menu.menu_master route_path and title
UPDATE erp_menu.menu_master
SET
  route_path   = '/sa/om/materials',
  title        = 'Material Master'
WHERE tx_code = 'OM04';

-- 2. Rebuild SA menu snapshots (auth_user_id is the correct column name)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT auth_user_id
    FROM erp_cache.session_menu_snapshot
    WHERE universe = 'SA'
  LOOP
    BEGIN
      PERFORM public.rebuild_sa_menu_snapshot(r.auth_user_id);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END;
$$;

COMMIT;
