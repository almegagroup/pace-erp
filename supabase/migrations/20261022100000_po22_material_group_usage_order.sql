/*
 * Migration: 20261022100000_po22_material_group_usage_order
 * Purpose:   PO22 Material Settings — "Group Settings" (owner 2026-10-22).
 *
 *   Per company × material group (erp_master.material_category_group): which
 *   member is used first when several members can serve the same Stroke /
 *   Pack BOM line.
 *     MOST_STOCK_FIRST  — the member with the most free stock first (Method C).
 *     LEAST_STOCK_FIRST — the member with the least stock first (finish small
 *                         stocks before opening a bigger one).
 *     FIXED_ORDER       — members in member_order; the next one only when the
 *                         one above has no stock left.
 *   No row for a group = the old behaviour (planning: Method C; production
 *   auto-derive: its §138.12 rule).
 *
 *   Read by PO22 planning (allocation, Store Report) and by the MTS production
 *   auto-derive (Process PO create, MTS creation session, Packing combine), so
 *   both pick members in the same order.
 *
 *   Effective-dated, append-only versioned (same shape as
 *   material_requirement_policy). Planning-only master data: never touches
 *   material master, stock, PO, production documents or GL.
 *
 *   After applying (DEV or PROD): NOTIFY pgrst, 'reload schema'; reconcile
 *   schema_migrations to this file's version; run migration-integrity-check.
 */

BEGIN;

CREATE TABLE erp_planning.material_group_usage_order (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES erp_master.companies(id),
  material_group_id  uuid NOT NULL REFERENCES erp_master.material_category_group(id),
  effective_from     date NOT NULL,
  version_no         integer NOT NULL CHECK (version_no >= 1),
  is_current         boolean NOT NULL DEFAULT true,
  order_mode         text NOT NULL CHECK (order_mode IN ('MOST_STOCK_FIRST', 'LEAST_STOCK_FIRST', 'FIXED_ORDER')),
  member_order       uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  remarks            text CHECK (remarks IS NULL OR length(remarks) <= 500),
  save_batch_id      uuid NOT NULL,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_material_group_usage_order_version
    UNIQUE (company_id, material_group_id, effective_from, version_no),
  CONSTRAINT ck_material_group_usage_order_fixed CHECK (
    order_mode <> 'FIXED_ORDER' OR cardinality(member_order) >= 1
  )
);

CREATE UNIQUE INDEX ux_material_group_usage_order_current
  ON erp_planning.material_group_usage_order (company_id, material_group_id, effective_from)
  WHERE is_current;
CREATE INDEX ix_material_group_usage_order_company
  ON erp_planning.material_group_usage_order (company_id, material_group_id, effective_from DESC)
  WHERE is_current;

COMMENT ON TABLE erp_planning.material_group_usage_order IS
  'PO22 Group Settings: which member of a material group is used first, per company, effective-dated, append-only versioned. No row = default (planning Method C, production §138.12).';

CREATE TRIGGER trg_material_group_usage_order_append_only
  BEFORE UPDATE OR DELETE ON erp_planning.material_group_usage_order
  FOR EACH ROW EXECUTE FUNCTION erp_planning.guard_append_only();

ALTER TABLE erp_planning.material_group_usage_order ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON erp_planning.material_group_usage_order TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Atomic batch save (CLAUDE.md §8B). The backend has already checked that each
-- group (and every member_order id) belongs to this company's MTS strokes /
-- Pack BOMs. p_rows: [{ material_group_id, effective_from, order_mode,
-- member_order?: uuid[], remarks? }]
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION erp_planning.save_material_group_usage_orders(
  p_company_id uuid,
  p_actor      uuid,
  p_rows       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, erp_planning, erp_master
AS $$
DECLARE
  v_batch     uuid := gen_random_uuid();
  v_row       jsonb;
  v_group     uuid;
  v_from      date;
  v_mode      text;
  v_order     uuid[];
  v_remarks   text;
  v_current   erp_planning.material_group_usage_order%ROWTYPE;
  v_saved     integer := 0;
  v_unchanged integer := 0;
  v_seen      text[] := ARRAY[]::text[];
  v_key       text;
BEGIN
  IF p_company_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'MTS_REQ_GROUP_ORDER_INVALID_INPUT: company and actor are required';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'MTS_REQ_GROUP_ORDER_NO_ROWS: nothing to save';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_group   := nullif(v_row->>'material_group_id', '')::uuid;
    v_from    := nullif(v_row->>'effective_from', '')::date;
    v_mode    := upper(coalesce(v_row->>'order_mode', ''));
    v_order   := coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(v_row->'member_order', '[]'::jsonb))::uuid), ARRAY[]::uuid[]);
    v_remarks := nullif(btrim(coalesce(v_row->>'remarks', '')), '');

    IF v_group IS NULL OR v_from IS NULL THEN
      RAISE EXCEPTION 'MTS_REQ_GROUP_ORDER_INVALID_INPUT: group and effective date are required';
    END IF;
    IF v_mode NOT IN ('MOST_STOCK_FIRST', 'LEAST_STOCK_FIRST', 'FIXED_ORDER') THEN
      RAISE EXCEPTION 'MTS_REQ_GROUP_ORDER_INVALID_INPUT: unknown order %', v_mode;
    END IF;
    IF v_mode = 'FIXED_ORDER' AND cardinality(v_order) = 0 THEN
      RAISE EXCEPTION 'MTS_REQ_GROUP_ORDER_INVALID_INPUT: Fixed order needs the member list';
    END IF;
    IF v_mode <> 'FIXED_ORDER' THEN v_order := ARRAY[]::uuid[]; END IF;
    v_key := v_group::text || '|' || v_from::text;
    IF v_key = ANY (v_seen) THEN
      RAISE EXCEPTION 'MTS_REQ_GROUP_ORDER_DUPLICATE_ROW: group % appears twice for effective date %', v_group, v_from;
    END IF;
    v_seen := array_append(v_seen, v_key);

    v_current := NULL; -- never carry the previous row's version into this one
    SELECT * INTO v_current FROM erp_planning.material_group_usage_order
     WHERE company_id = p_company_id AND material_group_id = v_group AND effective_from = v_from AND is_current
     FOR UPDATE;

    IF FOUND AND v_current.order_mode = v_mode AND v_current.member_order = v_order
       AND v_current.remarks IS NOT DISTINCT FROM v_remarks THEN
      v_unchanged := v_unchanged + 1;
      CONTINUE;
    END IF;

    IF FOUND THEN
      UPDATE erp_planning.material_group_usage_order SET is_current = false WHERE id = v_current.id;
    END IF;
    INSERT INTO erp_planning.material_group_usage_order
      (company_id, material_group_id, effective_from, version_no, is_current, order_mode, member_order, remarks, save_batch_id, created_by)
    VALUES
      (p_company_id, v_group, v_from, coalesce(v_current.version_no, 0) + 1, true, v_mode, v_order, v_remarks, v_batch, p_actor);
    v_saved := v_saved + 1;
  END LOOP;

  RETURN jsonb_build_object('save_batch_id', v_batch, 'saved', v_saved, 'unchanged', v_unchanged);
END;
$$;

REVOKE ALL ON FUNCTION erp_planning.save_material_group_usage_orders(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_planning.save_material_group_usage_orders(uuid, uuid, jsonb) TO service_role;

COMMIT;
