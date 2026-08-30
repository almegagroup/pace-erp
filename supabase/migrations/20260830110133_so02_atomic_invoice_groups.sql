CREATE OR REPLACE FUNCTION erp_inventory.post_sales_invoice_groups_atomic(p_groups jsonb, p_posted_by uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = erp_inventory, erp_procurement, public
AS $fn$
DECLARE v_group jsonb;
BEGIN
  IF p_groups IS NULL OR jsonb_typeof(p_groups) <> 'array' OR jsonb_array_length(p_groups) = 0 THEN
    RAISE EXCEPTION 'PGI_INVOICE_GROUPS_INVALID';
  END IF;
  FOR v_group IN SELECT value FROM jsonb_array_elements(p_groups) LOOP
    PERFORM erp_inventory.post_document('SALES_INVOICE', (v_group->>'invoice_id')::uuid, v_group->'movements', p_posted_by, v_group->'context');
  END LOOP;
END;
$fn$;
