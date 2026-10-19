/*
 * PO22 Phase 3B — atomic, append-only monthly new-buy selection save.
 *
 * This migration is repository-only until separately approved for DEV/PROD.
 * It changes no operational procurement, stock, reservation or production data.
 */

BEGIN;

CREATE OR REPLACE FUNCTION erp_planning.save_mts_optimizer_material_selection(
  p_company_id uuid,
  p_actor uuid,
  p_rows jsonb,
  p_source_system text DEFAULT 'ERP_ENTRY'
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_row record;
  v_version integer;
  v_saved integer := 0;
  v_batch_id uuid := gen_random_uuid();
BEGIN
  IF p_company_id IS NULL OR p_actor IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'MTS_OPTIMIZER_SELECTION_INVALID_INPUT';
  END IF;
  IF jsonb_array_length(p_rows) > 1200 OR p_source_system NOT IN ('ERP_ENTRY', 'MIGRATION_IMPORT') THEN
    RAISE EXCEPTION 'MTS_OPTIMIZER_SELECTION_INVALID_INPUT';
  END IF;

  CREATE TEMP TABLE _mts_optimizer_selection_save ON COMMIT DROP AS
  SELECT material_id::uuid AS material_id,
         selection_month::date AS selection_month,
         is_selected_for_new_purchase::boolean AS is_selected_for_new_purchase,
         source_ref
  FROM jsonb_to_recordset(p_rows) AS input(
    material_id text,
    selection_month text,
    is_selected_for_new_purchase boolean,
    source_ref jsonb
  );

  IF EXISTS (
    SELECT 1 FROM _mts_optimizer_selection_save
    WHERE material_id IS NULL
       OR selection_month IS NULL
       OR date_trunc('month', selection_month)::date <> selection_month
       OR is_selected_for_new_purchase IS NULL
  ) OR EXISTS (
    SELECT 1 FROM _mts_optimizer_selection_save
    GROUP BY material_id, selection_month HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'MTS_OPTIMIZER_SELECTION_INVALID_INPUT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _mts_optimizer_selection_save input
    LEFT JOIN erp_master.material_master material ON material.id = input.material_id
    WHERE material.id IS NULL OR material.status <> 'ACTIVE' OR material.material_type NOT IN ('RM', 'PM')
  ) THEN
    RAISE EXCEPTION 'MTS_OPTIMIZER_SELECTION_MATERIAL_INVALID';
  END IF;

  FOR v_row IN SELECT * FROM _mts_optimizer_selection_save ORDER BY material_id, selection_month LOOP
    -- Serialize each version stream so a concurrent save cannot create two current rows.
    PERFORM pg_advisory_xact_lock(hashtext(p_company_id::text || ':' || v_row.material_id::text || ':' || v_row.selection_month::text));
    UPDATE erp_planning.mts_optimizer_material_selection
       SET is_current = false
     WHERE company_id = p_company_id
       AND material_id = v_row.material_id
       AND selection_month = v_row.selection_month
       AND is_current;

    SELECT coalesce(max(version_no), 0) + 1 INTO v_version
      FROM erp_planning.mts_optimizer_material_selection
     WHERE company_id = p_company_id
       AND material_id = v_row.material_id
       AND selection_month = v_row.selection_month;

    INSERT INTO erp_planning.mts_optimizer_material_selection (
      company_id, material_id, selection_month, version_no, is_current,
      is_selected_for_new_purchase, source_system, source_ref, save_batch_id, created_by
    ) VALUES (
      p_company_id, v_row.material_id, v_row.selection_month, v_version, true,
      v_row.is_selected_for_new_purchase, p_source_system, v_row.source_ref, v_batch_id, p_actor
    );
    v_saved := v_saved + 1;
  END LOOP;

  RETURN jsonb_build_object('save_batch_id', v_batch_id, 'saved_count', v_saved);
END;
$$;

REVOKE ALL ON FUNCTION erp_planning.save_mts_optimizer_material_selection(uuid, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_planning.save_mts_optimizer_material_selection(uuid, uuid, jsonb, text) TO service_role;

COMMIT;
