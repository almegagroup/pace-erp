-- Page 4 must preserve the identity of a Stroke Line, not merely its material.
-- A real stroke may use the same material more than once at different dosages.
ALTER TABLE erp_production.process_order_line
  ADD COLUMN IF NOT EXISTS stroke_line_id uuid NULL
  REFERENCES erp_production.stroke_line(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_process_order_line_stroke_line_id
  ON erp_production.process_order_line (stroke_line_id)
  WHERE stroke_line_id IS NOT NULL;

-- Saves the complete MTS Page-4 material plan as one database transaction.
-- The lock and the existing-line guard also close the double-submit race.
CREATE OR REPLACE FUNCTION erp_production.save_mts_material_plan_atomic(
  p_process_order_id uuid,
  p_actor_id uuid,
  p_required_by_date date,
  p_lines jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = erp_production, public
AS $$
DECLARE
  v_line jsonb;
  v_line_id uuid;
  v_count integer := 0;
BEGIN
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one MTS material-plan line is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_process_order_id::text));
  IF EXISTS (
    SELECT 1 FROM erp_production.process_order_line
    WHERE process_order_id = p_process_order_id
  ) THEN
    RAISE EXCEPTION 'Material plan already saved for this Process Order';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO erp_production.process_order_line (
      process_order_id, stroke_line_id, material_id, actual_material_id,
      planned_qty, actual_qty, uom_code, issue_sloc_id, is_rm, display_order,
      dosage_pct, is_formulation_line, approved_status, ap_approved_qty, variance_qty
    ) VALUES (
      p_process_order_id, (v_line->>'stroke_line_id')::uuid,
      (v_line->>'material_id')::uuid, NULLIF(v_line->>'actual_material_id', '')::uuid,
      (v_line->>'planned_qty')::numeric, (v_line->>'actual_qty')::numeric,
      v_line->>'uom_code', (v_line->>'issue_sloc_id')::uuid, true,
      (v_line->>'display_order')::integer, NULLIF(v_line->>'dosage_pct', '')::numeric,
      COALESCE((v_line->>'is_formulation_line')::boolean, false),
      v_line->>'approved_status', (v_line->>'ap_approved_qty')::numeric,
      NULLIF(v_line->>'variance_qty', '')::numeric
    ) RETURNING id INTO v_line_id;

    IF (v_line->>'actual_qty')::numeric > 0 THEN
      INSERT INTO erp_production.reservation_document (
        source_type, source_id, source_line_id, company_id, material_id,
        storage_location_id, required_qty, uom_code, required_by_date, status,
        created_by, created_at, last_updated_by, last_updated_at
      ) VALUES (
        'PROCESS_PO', p_process_order_id, v_line_id, (v_line->>'company_id')::uuid,
        COALESCE(NULLIF(v_line->>'actual_material_id', '')::uuid, (v_line->>'material_id')::uuid),
        (v_line->>'issue_sloc_id')::uuid, (v_line->>'actual_qty')::numeric,
        v_line->>'uom_code', p_required_by_date, 'OPEN', p_actor_id, now(), p_actor_id, now()
      );
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION erp_production.save_mts_material_plan_atomic(uuid, uuid, date, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_production.save_mts_material_plan_atomic(uuid, uuid, date, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
