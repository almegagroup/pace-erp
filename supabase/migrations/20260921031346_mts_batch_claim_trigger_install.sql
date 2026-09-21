CREATE OR REPLACE FUNCTION erp_production.mark_mts_batch_claim_used_after_verify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = erp_production, public
AS $$
BEGIN
  IF NEW.po_type = 'MTS' AND NEW.status = 'VERIFIED' AND OLD.status IS DISTINCT FROM 'VERIFIED' THEN
    UPDATE erp_production.batch_number_instance
      SET status = 'USED', last_updated_by = NEW.last_updated_by, last_updated_at = now()
      WHERE source_process_order_id = NEW.id AND status = 'CLAIMED';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION erp_production.mark_mts_batch_claim_used_after_verify() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_production.mark_mts_batch_claim_used_after_verify() TO service_role;

DROP TRIGGER IF EXISTS trg_process_order_mark_mts_batch_claim_used ON erp_production.process_order;
CREATE TRIGGER trg_process_order_mark_mts_batch_claim_used
AFTER UPDATE OF status ON erp_production.process_order
FOR EACH ROW EXECUTE FUNCTION erp_production.mark_mts_batch_claim_used_after_verify();

NOTIFY pgrst, 'reload schema';
