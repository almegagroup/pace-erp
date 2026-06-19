/*
 * Purpose: Fix OM07 menu route to point to new SA Vendor Master page.
 */

BEGIN;

UPDATE erp_menu.menu_master
SET
  route_path = '/sa/om/vendors',
  title      = 'Vendor Master'
WHERE tx_code = 'OM07';

-- Rebuild SA menu snapshots so sidebar picks up the new route
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT auth_user_id FROM erp_cache.session_menu_snapshot LIMIT 50 LOOP
    BEGIN
      PERFORM public.rebuild_sa_menu_snapshot(r.auth_user_id);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END;
$$;

COMMIT;
