/*
 * Migration: 20261015130000_erp_planning_process_po_exclusion
 * Purpose:   SA "Process PO Exclusion" page (owner, 2026-10-15), tx OM13 under
 *            SA → Operation Masters.
 *   Per company, SA ticks "Exclude from Process PO" on a whole Mother group,
 *   on a Child group, or on single Prodshades (the Product Group layout of
 *   erp_planning). An excluded Prodshade is not offered when a Process PO is
 *   created for that company, so the list stays short and correct.
 *   * A Prodshade that is in no group is never excluded (owner): to exclude
 *     it, put it in a group first.
 *   * A tick on a Mother covers every Child and Prodshade under it, including
 *     ones added later; a tick on a Child covers its Prodshades.
 *   * Nothing is deleted: un-ticking sets is_active = false.
 */

BEGIN;

CREATE TABLE erp_planning.process_po_exclusion (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES erp_master.companies(id),
  scope_type  text NOT NULL CHECK (scope_type IN ('MOTHER', 'CHILD', 'PRODSHADE')),
  scope_id    uuid NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_process_po_exclusion UNIQUE (company_id, scope_type, scope_id)
);
COMMENT ON TABLE erp_planning.process_po_exclusion IS
  'SA OM13: Exclude from Process PO. scope_id = prodshade_mother_group.id (MOTHER), prodshade_child_group.id (CHILD) or the Prodshade material id (PRODSHADE). Only grouped Prodshades can be excluded.';

ALTER TABLE erp_planning.process_po_exclusion ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON erp_planning.process_po_exclusion TO service_role;

-- Prodshades of a company that must not be offered on Process PO create.
CREATE OR REPLACE FUNCTION erp_planning.process_po_excluded_prodshades(p_company_id uuid)
RETURNS TABLE (prodshade_material_id uuid)
LANGUAGE sql
STABLE
AS $$
  SELECT gm.prodshade_material_id
  FROM erp_planning.prodshade_group_member gm
  JOIN erp_planning.prodshade_child_group cg ON cg.id = gm.child_group_id AND cg.is_active
  JOIN erp_planning.prodshade_mother_group mg ON mg.id = cg.mother_group_id AND mg.is_active
  WHERE gm.company_id = p_company_id AND gm.is_active
    AND EXISTS (
      SELECT 1 FROM erp_planning.process_po_exclusion x
      WHERE x.company_id = p_company_id AND x.is_active
        AND ((x.scope_type = 'MOTHER' AND x.scope_id = mg.id)
          OR (x.scope_type = 'CHILD' AND x.scope_id = cg.id)
          OR (x.scope_type = 'PRODSHADE' AND x.scope_id = gm.prodshade_material_id))
    );
$$;

-- Replaces a company's ticks in one transaction. Ids not listed are un-ticked.
CREATE OR REPLACE FUNCTION erp_planning.save_process_po_exclusions(
  p_company_id    uuid,
  p_actor         uuid,
  p_mother_ids    uuid[],
  p_child_ids     uuid[],
  p_prodshade_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_mothers    uuid[] := coalesce(p_mother_ids, '{}');
  v_children   uuid[] := coalesce(p_child_ids, '{}');
  v_prodshades uuid[] := coalesce(p_prodshade_ids, '{}');
  v_bad        integer;
BEGIN
  IF p_company_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'PROC_PO_EXCLUSION_INVALID_INPUT: company and actor are required';
  END IF;

  SELECT count(*) INTO v_bad FROM unnest(v_mothers) AS t(id)
  WHERE NOT EXISTS (SELECT 1 FROM erp_planning.prodshade_mother_group g
                    WHERE g.id = t.id AND g.company_id = p_company_id AND g.is_active);
  IF v_bad > 0 THEN RAISE EXCEPTION 'PROC_PO_EXCLUSION_GROUP_NOT_FOUND: a Mother group is not active in this company'; END IF;

  SELECT count(*) INTO v_bad FROM unnest(v_children) AS t(id)
  WHERE NOT EXISTS (SELECT 1 FROM erp_planning.prodshade_child_group g
                    WHERE g.id = t.id AND g.company_id = p_company_id AND g.is_active);
  IF v_bad > 0 THEN RAISE EXCEPTION 'PROC_PO_EXCLUSION_GROUP_NOT_FOUND: a Child group is not active in this company'; END IF;

  -- Owner rule: only a Prodshade that is in a group can be excluded.
  SELECT count(*) INTO v_bad FROM unnest(v_prodshades) AS t(id)
  WHERE NOT EXISTS (SELECT 1 FROM erp_planning.prodshade_group_member m
                    WHERE m.prodshade_material_id = t.id AND m.company_id = p_company_id AND m.is_active);
  IF v_bad > 0 THEN RAISE EXCEPTION 'PROC_PO_EXCLUSION_NOT_GROUPED: put the Prodshade in a group before excluding it'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('erp_planning.process_po_exclusion:' || p_company_id::text));

  UPDATE erp_planning.process_po_exclusion
     SET is_active = false, updated_by = p_actor, updated_at = now()
   WHERE company_id = p_company_id AND is_active
     AND NOT ((scope_type = 'MOTHER' AND scope_id = ANY (v_mothers))
           OR (scope_type = 'CHILD' AND scope_id = ANY (v_children))
           OR (scope_type = 'PRODSHADE' AND scope_id = ANY (v_prodshades)));

  INSERT INTO erp_planning.process_po_exclusion (company_id, scope_type, scope_id, created_by, updated_by)
  SELECT p_company_id, s.scope_type, s.scope_id, p_actor, p_actor
  FROM (
    SELECT 'MOTHER'::text AS scope_type, id AS scope_id FROM unnest(v_mothers) AS id
    UNION SELECT 'CHILD', id FROM unnest(v_children) AS id
    UNION SELECT 'PRODSHADE', id FROM unnest(v_prodshades) AS id
  ) s
  ON CONFLICT (company_id, scope_type, scope_id) DO UPDATE
    SET is_active = true, updated_by = EXCLUDED.updated_by, updated_at = now()
    WHERE NOT erp_planning.process_po_exclusion.is_active;

  RETURN jsonb_build_object(
    'mother_groups', cardinality(v_mothers),
    'child_groups', cardinality(v_children),
    'prodshades', cardinality(v_prodshades),
    'excluded_prodshades', (SELECT count(*) FROM erp_planning.process_po_excluded_prodshades(p_company_id))
  );
END;
$$;

REVOKE ALL ON FUNCTION erp_planning.process_po_excluded_prodshades(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_planning.save_process_po_exclusions(uuid, uuid, uuid[], uuid[], uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_planning.process_po_excluded_prodshades(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION erp_planning.save_process_po_exclusions(uuid, uuid, uuid[], uuid[], uuid[]) TO service_role;

-- SA menu: Operation Masters → "Process PO Exclusion" (OM13). SA / GA only.
INSERT INTO erp_menu.menu_master (
  menu_code, resource_code, title, description, route_path, menu_type,
  universe, is_system, display_order, is_active, created_by, tx_code
)
SELECT 'SA_PROD_PROCESS_PO_EXCLUSION', 'SA_PROD_PROCESS_PO_EXCLUSION', 'Process PO Exclusion',
       'Exclude Product Groups / Prodshades from the Process PO create list, per company',
       '/sa/production/process-po-exclusion', 'PAGE', 'SA', false, 240, true, 'system', 'OM13'
WHERE NOT EXISTS (SELECT 1 FROM erp_menu.menu_master WHERE resource_code = 'SA_PROD_PROCESS_PO_EXCLUSION')
  AND NOT EXISTS (SELECT 1 FROM erp_menu.menu_master WHERE tx_code = 'OM13');

INSERT INTO acl.menu_master (menu_code, display_name, description, is_system)
SELECT 'SA_PROD_PROCESS_PO_EXCLUSION', 'Process PO Exclusion', 'SA: exclude Product Groups / Prodshades from Process PO create', false
WHERE NOT EXISTS (SELECT 1 FROM acl.menu_master WHERE menu_code = 'SA_PROD_PROCESS_PO_EXCLUSION');

INSERT INTO erp_menu.menu_tree (parent_menu_id, child_menu_id, display_order)
SELECT p.id, c.id, 240
FROM erp_menu.menu_master p, erp_menu.menu_master c
WHERE p.resource_code = 'GRP_SA_OM' AND c.resource_code = 'SA_PROD_PROCESS_PO_EXCLUSION'
  AND NOT EXISTS (SELECT 1 FROM erp_menu.menu_tree t WHERE t.child_menu_id = c.id);

COMMIT;
