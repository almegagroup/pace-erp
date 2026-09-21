CREATE OR REPLACE FUNCTION erp_production.reject_mts_documents_atomic(
  p_process_order_id uuid,
  p_actor_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = erp_production, public
AS $$
DECLARE
  v_parent erp_production.process_order%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF p_process_order_id IS NULL OR p_actor_id IS NULL OR NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'PROD_MTS_QA_REJECT_PAYLOAD_INVALID';
  END IF;
  SELECT * INTO v_parent FROM erp_production.process_order WHERE id = p_process_order_id FOR UPDATE;
  IF NOT FOUND OR v_parent.po_type <> 'MTS' OR v_parent.status NOT IN ('STANDARD', 'FINAL') THEN
    RAISE EXCEPTION 'PROD_MTS_QA_REJECT_STATUS_INVALID';
  END IF;
  PERFORM 1 FROM erp_production.packing_order WHERE process_order_id = p_process_order_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM erp_production.packing_order
    WHERE process_order_id = p_process_order_id AND status NOT IN ('STANDARD', 'CANCELLED')
  ) THEN
    RAISE EXCEPTION 'PROD_MTS_QA_REJECT_CHILD_NOT_CANCELLABLE';
  END IF;
  UPDATE erp_production.packing_order
  SET status = 'CANCELLED', cancel_reason = p_reason, last_updated_by = p_actor_id, last_updated_at = v_now
  WHERE process_order_id = p_process_order_id AND status = 'STANDARD';
  UPDATE erp_production.mts_packing_plan_row
  SET status = 'CANCELLED', last_updated_by = p_actor_id, last_updated_at = v_now
  WHERE process_order_id = p_process_order_id AND status <> 'CANCELLED';
  UPDATE erp_production.reservation_document
  SET status = 'CANCELLED', last_updated_by = p_actor_id, last_updated_at = v_now
  WHERE status IN ('OPEN', 'PARTIAL') AND (
    (source_type = 'PROCESS_PO' AND source_id = p_process_order_id) OR
    (source_type = 'PACKING_PO' AND source_id IN (SELECT id FROM erp_production.packing_order WHERE process_order_id = p_process_order_id))
  );
  UPDATE erp_production.batch_number_instance
  SET status = 'RELEASED', released_by = p_actor_id, released_at = v_now,
      release_reason = 'MTS QA reject: ' || trim(p_reason), last_updated_by = p_actor_id, last_updated_at = v_now
  WHERE source_process_order_id = p_process_order_id AND status IN ('ACTIVE', 'CLAIMED');
  UPDATE erp_production.process_order
  SET status = 'CANCELLED', qa_rejection_reason = p_reason, qa_decided_by = p_actor_id, qa_decided_at = v_now,
      prune_reason = p_reason, pruned_by = p_actor_id, pruned_at = v_now,
      last_updated_by = p_actor_id, last_updated_at = v_now
  WHERE id = p_process_order_id;
END;
$$;
