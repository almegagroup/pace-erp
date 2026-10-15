/*
 * Migration: 20261015100000_erp_planning_prodshade_groups
 * Purpose:   MTS Customer Plan "Product Group" (owner, 2026-10-15).
 *   Two-level grouping of Prodshades, per company:
 *     Mother group  →  Child group  →  Prodshade
 *   * A Prodshade belongs to at most ONE child group (PK on company+prodshade).
 *   * A child group belongs to exactly ONE mother group (NOT NULL FK).
 *   * New Prodshades simply have no membership until a user adds them.
 *   All three tabs show Mother / Child group on the left; Tab 1 and Tab 3 add
 *   Prodshade / Child / Mother total rows. Planning-only master data — it
 *   never touches material master, Stroke Master or production.
 *
 *   save_prodshade_groups() replaces a company's whole layout in one
 *   transaction (CLAUDE.md §8B), serialised per company by an advisory lock.
 */

BEGIN;

CREATE TABLE erp_planning.prodshade_mother_group (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES erp_master.companies(id),
  group_name  text NOT NULL CHECK (btrim(group_name) <> '' AND length(group_name) <= 120),
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_prodshade_mother_group_name
  ON erp_planning.prodshade_mother_group (company_id, lower(btrim(group_name)));

CREATE TABLE erp_planning.prodshade_child_group (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES erp_master.companies(id),
  mother_group_id uuid NOT NULL REFERENCES erp_planning.prodshade_mother_group(id),
  group_name      text NOT NULL CHECK (btrim(group_name) <> '' AND length(group_name) <= 120),
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_prodshade_child_group_name
  ON erp_planning.prodshade_child_group (company_id, lower(btrim(group_name)));
CREATE INDEX ix_prodshade_child_group_mother ON erp_planning.prodshade_child_group (mother_group_id);

CREATE TABLE erp_planning.prodshade_group_member (
  company_id            uuid NOT NULL REFERENCES erp_master.companies(id),
  prodshade_material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  child_group_id        uuid NOT NULL REFERENCES erp_planning.prodshade_child_group(id),
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, prodshade_material_id)
);
CREATE INDEX ix_prodshade_group_member_child ON erp_planning.prodshade_group_member (child_group_id);

COMMENT ON TABLE erp_planning.prodshade_mother_group IS 'MTS planning Product Group, top level (per company).';
COMMENT ON TABLE erp_planning.prodshade_child_group IS 'MTS planning Product Group, second level; exactly one mother group.';
COMMENT ON TABLE erp_planning.prodshade_group_member IS 'Prodshade → child group; one group per Prodshade per company.';

ALTER TABLE erp_planning.prodshade_mother_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_planning.prodshade_child_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_planning.prodshade_group_member ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON erp_planning.prodshade_mother_group TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON erp_planning.prodshade_child_group TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON erp_planning.prodshade_group_member TO service_role;

-- p_layout = {
--   "mothers":  [{ "key": "m1", "id": uuid|null, "name": "..." }],
--   "children": [{ "key": "c1", "id": uuid|null, "name": "...", "mother_key": "m1" }],
--   "members":  [{ "prodshade_material_id": uuid, "child_key": "c1" }]
-- }
-- Groups missing from the payload are deleted; Prodshades missing from
-- "members" become ungrouped.
CREATE OR REPLACE FUNCTION erp_planning.save_prodshade_groups(
  p_company_id uuid,
  p_actor      uuid,
  p_layout     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_mothers  jsonb := coalesce(p_layout->'mothers', '[]'::jsonb);
  v_children jsonb := coalesce(p_layout->'children', '[]'::jsonb);
  v_members  jsonb := coalesce(p_layout->'members', '[]'::jsonb);
  v_item     jsonb;
  v_id       uuid;
  v_name     text;
  v_key      text;
  v_mother   uuid;
  v_child    uuid;
  v_pid      uuid;
  v_mother_ids uuid[] := '{}';
  v_child_ids  uuid[] := '{}';
  v_mother_map jsonb := '{}'::jsonb;
  v_child_map  jsonb := '{}'::jsonb;
  v_n        integer;
BEGIN
  IF p_company_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'MTS_PLAN_INVALID_INPUT: company and actor are required';
  END IF;
  IF jsonb_typeof(v_mothers) <> 'array' OR jsonb_typeof(v_children) <> 'array' OR jsonb_typeof(v_members) <> 'array' THEN
    RAISE EXCEPTION 'MTS_PLAN_INVALID_INPUT: mothers, children and members must be arrays';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('erp_planning.prodshade_groups:' || p_company_id::text));

  -- Duplicate names inside the payload (case/space-insensitive).
  SELECT count(*) INTO v_n FROM (
    SELECT lower(btrim(e->>'name')) FROM jsonb_array_elements(v_mothers) e GROUP BY 1 HAVING count(*) > 1) d;
  IF v_n > 0 THEN RAISE EXCEPTION 'MTS_PLAN_GROUP_NAME_DUPLICATE: two mother groups have the same name'; END IF;
  SELECT count(*) INTO v_n FROM (
    SELECT lower(btrim(e->>'name')) FROM jsonb_array_elements(v_children) e GROUP BY 1 HAVING count(*) > 1) d;
  IF v_n > 0 THEN RAISE EXCEPTION 'MTS_PLAN_GROUP_NAME_DUPLICATE: two child groups have the same name'; END IF;

  -- Members are rewritten at the end; clearing them first frees renamed /
  -- deleted groups. Temporarily park names so a swap of two names is allowed.
  DELETE FROM erp_planning.prodshade_group_member WHERE company_id = p_company_id;
  UPDATE erp_planning.prodshade_child_group SET group_name = '~' || id::text WHERE company_id = p_company_id;
  UPDATE erp_planning.prodshade_mother_group SET group_name = '~' || id::text WHERE company_id = p_company_id;

  -- Mother groups.
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_mothers) LOOP
    v_key  := nullif(btrim(coalesce(v_item->>'key', '')), '');
    v_name := nullif(btrim(coalesce(v_item->>'name', '')), '');
    v_id   := nullif(v_item->>'id', '')::uuid;
    IF v_key IS NULL OR v_name IS NULL THEN
      RAISE EXCEPTION 'MTS_PLAN_GROUP_NAME_REQUIRED: every mother group needs a name';
    END IF;
    IF v_id IS NOT NULL THEN
      UPDATE erp_planning.prodshade_mother_group
         SET group_name = v_name, updated_by = p_actor, updated_at = now()
       WHERE id = v_id AND company_id = p_company_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'MTS_PLAN_GROUP_NOT_FOUND: mother group % is not in this company', v_id; END IF;
    ELSE
      INSERT INTO erp_planning.prodshade_mother_group (company_id, group_name, created_by, updated_by)
      VALUES (p_company_id, v_name, p_actor, p_actor) RETURNING id INTO v_id;
    END IF;
    v_mother_ids := v_mother_ids || v_id;
    v_mother_map := v_mother_map || jsonb_build_object(v_key, v_id);
  END LOOP;

  -- Child groups (each needs a mother from this payload).
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
         SET group_name = v_name, mother_group_id = v_mother, updated_by = p_actor, updated_at = now()
       WHERE id = v_id AND company_id = p_company_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'MTS_PLAN_GROUP_NOT_FOUND: child group % is not in this company', v_id; END IF;
    ELSE
      INSERT INTO erp_planning.prodshade_child_group (company_id, mother_group_id, group_name, created_by, updated_by)
      VALUES (p_company_id, v_mother, v_name, p_actor, p_actor) RETURNING id INTO v_id;
    END IF;
    v_child_ids := v_child_ids || v_id;
    v_child_map := v_child_map || jsonb_build_object(v_key, v_id);
  END LOOP;

  -- Groups left out of the payload are removed.
  DELETE FROM erp_planning.prodshade_child_group
   WHERE company_id = p_company_id AND NOT (id = ANY (v_child_ids));
  DELETE FROM erp_planning.prodshade_mother_group
   WHERE company_id = p_company_id AND NOT (id = ANY (v_mother_ids));

  -- Members: Prodshade must be one of this company's MTS Prodshades.
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
    BEGIN
      INSERT INTO erp_planning.prodshade_group_member (company_id, prodshade_material_id, child_group_id, created_by)
      VALUES (p_company_id, v_pid, v_child, p_actor);
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'MTS_PLAN_GROUP_PRODSHADE_DUPLICATE: a Prodshade can be in only one group';
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'mother_groups', coalesce(array_length(v_mother_ids, 1), 0),
    'child_groups', coalesce(array_length(v_child_ids, 1), 0),
    'members', jsonb_array_length(v_members)
  );
END;
$$;

REVOKE ALL ON FUNCTION erp_planning.save_prodshade_groups(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_planning.save_prodshade_groups(uuid, uuid, jsonb) TO service_role;

COMMIT;
