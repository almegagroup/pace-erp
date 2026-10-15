/*
 * Migration: 20261015110000_erp_planning_prodshade_groups_soft_delete
 * Purpose:   Product Group save, soft-delete design (2026-10-15).
 *   Nothing is ever deleted: a group removed by the user becomes
 *   is_active = false (its name is parked as '~<id>' so the name can be
 *   reused), and a Prodshade taken out of every group keeps its member row
 *   with is_active = false. Readers use is_active = true only.
 *
 *   save_prodshade_groups() replaces a company's whole active layout in one
 *   transaction (CLAUDE.md §8B), serialised per company by an advisory lock.
 */

BEGIN;

ALTER TABLE erp_planning.prodshade_mother_group ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE erp_planning.prodshade_child_group  ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE erp_planning.prodshade_group_member ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE erp_planning.prodshade_group_member ADD COLUMN updated_by uuid;
ALTER TABLE erp_planning.prodshade_group_member ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- p_layout = {
--   "mothers":  [{ "key": "m1", "id": uuid|null, "name": "..." }],
--   "children": [{ "key": "c1", "id": uuid|null, "name": "...", "mother_key": "m1" }],
--   "members":  [{ "prodshade_material_id": uuid, "child_key": "c1" }]
-- }
-- Groups missing from the payload become inactive; Prodshades missing from
-- "members" become ungrouped (member row inactive).
CREATE OR REPLACE FUNCTION erp_planning.save_prodshade_groups(
  p_company_id uuid,
  p_actor      uuid,
  p_layout     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_mothers    jsonb := coalesce(p_layout->'mothers', '[]'::jsonb);
  v_children   jsonb := coalesce(p_layout->'children', '[]'::jsonb);
  v_members    jsonb := coalesce(p_layout->'members', '[]'::jsonb);
  v_item       jsonb;
  v_id         uuid;
  v_name       text;
  v_key        text;
  v_mother     uuid;
  v_child      uuid;
  v_pid        uuid;
  v_mother_map jsonb := '{}'::jsonb;
  v_child_map  jsonb := '{}'::jsonb;
  v_mothers_n  integer := 0;
  v_children_n integer := 0;
  v_n          integer;
BEGIN
  IF p_company_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'MTS_PLAN_INVALID_INPUT: company and actor are required';
  END IF;
  IF jsonb_typeof(v_mothers) <> 'array' OR jsonb_typeof(v_children) <> 'array' OR jsonb_typeof(v_members) <> 'array' THEN
    RAISE EXCEPTION 'MTS_PLAN_INVALID_INPUT: mothers, children and members must be arrays';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('erp_planning.prodshade_groups:' || p_company_id::text));

  SELECT count(*) INTO v_n FROM (
    SELECT lower(btrim(e->>'name')) FROM jsonb_array_elements(v_mothers) e GROUP BY 1 HAVING count(*) > 1) d;
  IF v_n > 0 THEN RAISE EXCEPTION 'MTS_PLAN_GROUP_NAME_DUPLICATE: two mother groups have the same name'; END IF;
  SELECT count(*) INTO v_n FROM (
    SELECT lower(btrim(e->>'name')) FROM jsonb_array_elements(v_children) e GROUP BY 1 HAVING count(*) > 1) d;
  IF v_n > 0 THEN RAISE EXCEPTION 'MTS_PLAN_GROUP_NAME_DUPLICATE: two child groups have the same name'; END IF;
  SELECT count(*) INTO v_n FROM (
    SELECT e->>'prodshade_material_id' FROM jsonb_array_elements(v_members) e GROUP BY 1 HAVING count(*) > 1) d;
  IF v_n > 0 THEN RAISE EXCEPTION 'MTS_PLAN_GROUP_PRODSHADE_DUPLICATE: a Prodshade can be in only one group'; END IF;

  -- Start from "everything inactive"; the payload re-activates what it keeps.
  -- Names are parked so a rename / swap / re-use of a name never collides.
  UPDATE erp_planning.prodshade_group_member
     SET is_active = false, updated_by = p_actor, updated_at = now()
   WHERE company_id = p_company_id AND is_active;
  UPDATE erp_planning.prodshade_child_group
     SET group_name = '~' || id::text, is_active = false
   WHERE company_id = p_company_id;
  UPDATE erp_planning.prodshade_mother_group
     SET group_name = '~' || id::text, is_active = false
   WHERE company_id = p_company_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_mothers) LOOP
    v_key  := nullif(btrim(coalesce(v_item->>'key', '')), '');
    v_name := nullif(btrim(coalesce(v_item->>'name', '')), '');
    v_id   := nullif(v_item->>'id', '')::uuid;
    IF v_key IS NULL OR v_name IS NULL THEN
      RAISE EXCEPTION 'MTS_PLAN_GROUP_NAME_REQUIRED: every mother group needs a name';
    END IF;
    IF v_id IS NOT NULL THEN
      UPDATE erp_planning.prodshade_mother_group
         SET group_name = v_name, is_active = true, updated_by = p_actor, updated_at = now()
       WHERE id = v_id AND company_id = p_company_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'MTS_PLAN_GROUP_NOT_FOUND: mother group % is not in this company', v_id; END IF;
    ELSE
      INSERT INTO erp_planning.prodshade_mother_group (company_id, group_name, created_by, updated_by)
      VALUES (p_company_id, v_name, p_actor, p_actor) RETURNING id INTO v_id;
    END IF;
    v_mothers_n := v_mothers_n + 1;
    v_mother_map := v_mother_map || jsonb_build_object(v_key, v_id);
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_children) LOOP
    v_key    := nullif(btrim(coalesce(v_item->>'key', '')), '');
    v_name   := nullif(btrim(coalesce(v_item->>'name', '')), '');
    v_id     := nullif(v_item->>'id', '')::uuid;
    v_mother := nullif(v_mother_map->>coalesce(v_item->>'mother_key', ''), '')::uuid;
    IF v_key IS NULL OR v_name IS NULL THEN
      RAISE EXCEPTION 'MTS_PLAN_GROUP_NAME_REQUIRED: every child group needs a name';
    END IF;
    IF v_mother IS NULL THEN
      RAISE EXCEPTION 'MTS_PLAN_CHILD_GROUP_MOTHER_REQUIRED: child group "%" has no mother group', v_name;
    END IF;
    IF v_id IS NOT NULL THEN
      UPDATE erp_planning.prodshade_child_group
         SET group_name = v_name, mother_group_id = v_mother, is_active = true, updated_by = p_actor, updated_at = now()
       WHERE id = v_id AND company_id = p_company_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'MTS_PLAN_GROUP_NOT_FOUND: child group % is not in this company', v_id; END IF;
    ELSE
      INSERT INTO erp_planning.prodshade_child_group (company_id, mother_group_id, group_name, created_by, updated_by)
      VALUES (p_company_id, v_mother, v_name, p_actor, p_actor) RETURNING id INTO v_id;
    END IF;
    v_children_n := v_children_n + 1;
    v_child_map := v_child_map || jsonb_build_object(v_key, v_id);
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_members) LOOP
    v_pid   := nullif(v_item->>'prodshade_material_id', '')::uuid;
    v_child := nullif(v_child_map->>coalesce(v_item->>'child_key', ''), '')::uuid;
    IF v_pid IS NULL OR v_child IS NULL THEN
      RAISE EXCEPTION 'MTS_PLAN_GROUP_MEMBER_INVALID: each member needs a Prodshade and a child group';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM erp_production.stroke_master s
      WHERE s.company_id = p_company_id AND s.prodshade_material_id = v_pid
        AND s.po_type = 'MTS' AND s.status = 'APPROVED'
    ) THEN
      RAISE EXCEPTION 'MTS_PLAN_GROUP_PRODSHADE_INVALID: Prodshade % has no APPROVED MTS stroke in this company', v_pid;
    END IF;
    INSERT INTO erp_planning.prodshade_group_member (company_id, prodshade_material_id, child_group_id, created_by, updated_by)
    VALUES (p_company_id, v_pid, v_child, p_actor, p_actor)
    ON CONFLICT (company_id, prodshade_material_id) DO UPDATE
      SET child_group_id = EXCLUDED.child_group_id, is_active = true,
          updated_by = EXCLUDED.updated_by, updated_at = now();
  END LOOP;

  RETURN jsonb_build_object(
    'mother_groups', v_mothers_n,
    'child_groups', v_children_n,
    'members', jsonb_array_length(v_members)
  );
END;
$$;

REVOKE ALL ON FUNCTION erp_planning.save_prodshade_groups(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_planning.save_prodshade_groups(uuid, uuid, jsonb) TO service_role;

COMMIT;
