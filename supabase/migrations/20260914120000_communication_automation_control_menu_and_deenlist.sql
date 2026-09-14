/*
 * Communication Automation — Phase 2 control UI identity and de-enlistment.
 *
 * Publishes the central SA/GA-admin menu surface and extends the Phase 1
 * atomic RPC only for the defined active=false de-enlistment state. No page
 * automation action, rules, recipients, scheduling, provider, or delivery
 * behavior is introduced here.
 */

BEGIN;

INSERT INTO erp_menu.menu_master (
  menu_code,
  tx_code,
  resource_code,
  title,
  description,
  route_path,
  menu_type,
  universe,
  is_system,
  display_order,
  is_active,
  created_at,
  created_by
)
VALUES (
  'SA_COMMUNICATION_AUTOMATION',
  'SC09',
  'SA_COMMUNICATION_AUTOMATION',
  'Communication Automation',
  'Search and configure page-level communication enrollment and approved surfaces.',
  '/sa/communication-automation',
  'PAGE',
  'SA',
  true,
  90,
  true,
  pg_catalog.now(),
  'SYSTEM'
)
ON CONFLICT (menu_code) DO UPDATE
SET
  tx_code = EXCLUDED.tx_code,
  resource_code = EXCLUDED.resource_code,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  route_path = EXCLUDED.route_path,
  menu_type = EXCLUDED.menu_type,
  universe = EXCLUDED.universe,
  is_system = EXCLUDED.is_system,
  display_order = EXCLUDED.display_order,
  is_active = true,
  updated_at = pg_catalog.now(),
  updated_by = 'SYSTEM';

DELETE FROM erp_menu.menu_tree
WHERE child_menu_id = (
  SELECT id
  FROM erp_menu.menu_master
  WHERE menu_code = 'SA_COMMUNICATION_AUTOMATION'
);

INSERT INTO erp_menu.menu_tree (
  parent_menu_id,
  child_menu_id,
  display_order,
  created_at,
  created_by
)
SELECT
  parent_menu.id,
  child_menu.id,
  90,
  pg_catalog.now(),
  'SYSTEM'
FROM erp_menu.menu_master AS parent_menu
JOIN erp_menu.menu_master AS child_menu
  ON child_menu.menu_code = 'SA_COMMUNICATION_AUTOMATION'
WHERE parent_menu.menu_code = 'GRP_SA_ACCESS';

CREATE OR REPLACE FUNCTION erp_communication.save_page_enrollment(
  p_page_menu_id uuid,
  p_menu_code_snapshot text,
  p_resource_code_snapshot text,
  p_email_enabled boolean,
  p_active boolean,
  p_surface_keys text[],
  p_actor uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_enrollment_id uuid;
  v_surface_keys text[] := COALESCE(p_surface_keys, ARRAY[]::text[]);
BEGIN
  IF p_page_menu_id IS NULL OR p_actor IS NULL
    OR p_menu_code_snapshot IS NULL OR pg_catalog.btrim(p_menu_code_snapshot) = ''
    OR p_resource_code_snapshot IS NULL OR pg_catalog.btrim(p_resource_code_snapshot) = '' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNICATION_ENROLLMENT_RPC_INVALID_INPUT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(v_surface_keys) AS candidate(surface_key)
    WHERE candidate.surface_key IS NULL OR pg_catalog.btrim(candidate.surface_key) = ''
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNICATION_ENROLLMENT_RPC_INVALID_SURFACE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT candidate.surface_key
      FROM pg_catalog.unnest(v_surface_keys) AS candidate(surface_key)
      GROUP BY candidate.surface_key
      HAVING count(*) > 1
    ) AS duplicate_surface
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNICATION_ENROLLMENT_RPC_DUPLICATE_SURFACE';
  END IF;

  IF p_active = true AND pg_catalog.cardinality(v_surface_keys) = 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNICATION_ENROLLMENT_RPC_SURFACE_SELECTION_REQUIRED';
  END IF;

  IF p_active = false AND (p_email_enabled = true OR pg_catalog.cardinality(v_surface_keys) <> 0) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNICATION_ENROLLMENT_RPC_INVALID_DEENLISTMENT';
  END IF;

  INSERT INTO erp_communication.page_enrollment (
    page_menu_id,
    menu_code_snapshot,
    resource_code_snapshot,
    email_enabled,
    active,
    created_at,
    created_by,
    last_updated_at,
    last_updated_by
  )
  VALUES (
    p_page_menu_id,
    p_menu_code_snapshot,
    p_resource_code_snapshot,
    p_email_enabled,
    p_active,
    pg_catalog.now(),
    p_actor,
    pg_catalog.now(),
    p_actor
  )
  ON CONFLICT (page_menu_id) DO UPDATE
  SET menu_code_snapshot = EXCLUDED.menu_code_snapshot,
      resource_code_snapshot = EXCLUDED.resource_code_snapshot,
      email_enabled = EXCLUDED.email_enabled,
      active = EXCLUDED.active,
      last_updated_at = EXCLUDED.last_updated_at,
      last_updated_by = EXCLUDED.last_updated_by
  RETURNING id INTO v_enrollment_id;

  INSERT INTO erp_communication.surface_enrollment (
    page_enrollment_id,
    surface_key,
    active,
    created_at,
    created_by,
    last_updated_at,
    last_updated_by
  )
  SELECT
    v_enrollment_id,
    candidate.surface_key,
    p_active,
    pg_catalog.now(),
    p_actor,
    pg_catalog.now(),
    p_actor
  FROM pg_catalog.unnest(v_surface_keys) AS candidate(surface_key)
  ON CONFLICT (page_enrollment_id, surface_key) DO UPDATE
  SET active = EXCLUDED.active,
      last_updated_at = EXCLUDED.last_updated_at,
      last_updated_by = EXCLUDED.last_updated_by;

  UPDATE erp_communication.surface_enrollment
  SET active = false,
      last_updated_at = pg_catalog.now(),
      last_updated_by = p_actor
  WHERE page_enrollment_id = v_enrollment_id
    AND NOT (surface_key = ANY (v_surface_keys))
    AND active IS DISTINCT FROM false;

  RETURN v_enrollment_id;
END;
$function$;

ALTER FUNCTION erp_communication.save_page_enrollment(uuid, text, text, boolean, boolean, text[], uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION erp_communication.save_page_enrollment(uuid, text, text, boolean, boolean, text[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_communication.save_page_enrollment(uuid, text, text, boolean, boolean, text[], uuid) FROM anon;
REVOKE ALL ON FUNCTION erp_communication.save_page_enrollment(uuid, text, text, boolean, boolean, text[], uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION erp_communication.save_page_enrollment(uuid, text, text, boolean, boolean, text[], uuid) TO service_role;

DELETE FROM erp_menu.menu_snapshot
WHERE universe = 'SA';

DELETE FROM erp_cache.session_menu_snapshot
WHERE universe = 'SA';

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
