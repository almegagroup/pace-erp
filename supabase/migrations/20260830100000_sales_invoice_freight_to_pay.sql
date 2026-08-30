-- §133.13 freight clarification -- retain the commercial reason an invoice
-- has no freight amount: TO PAY means the customer settles freight directly.
-- The wrapper keeps this write in the same P601/PGI transaction as the
-- existing completion function; it never creates a post-commit side write.
BEGIN;

ALTER TABLE erp_procurement.sales_invoice
  ADD COLUMN IF NOT EXISTS freight_to_pay boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN erp_procurement.sales_invoice.freight_to_pay IS
  '§133.13: true when Freight Term is not FOR and customer pays freight directly. No freight amount or freight GST belongs on this invoice.';

CREATE OR REPLACE FUNCTION erp_procurement.complete_pgi_invoice_action_with_freight_to_pay(
  p_reference_document_id uuid,
  p_postings jsonb,
  p_context jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_production, public
AS $$
BEGIN
  PERFORM erp_procurement.complete_pgi_invoice_action(
    p_reference_document_id,
    p_postings,
    p_context
  );

  IF p_context->>'action' = 'CREATE' THEN
    UPDATE erp_procurement.sales_invoice
    SET freight_to_pay = COALESCE((p_context->'invoice'->>'freight_to_pay')::boolean, false)
    WHERE id = p_reference_document_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION erp_procurement.complete_pgi_invoice_action_with_freight_to_pay(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.complete_pgi_invoice_action_with_freight_to_pay(uuid, jsonb, jsonb) TO service_role;

DO $$
BEGIN
  UPDATE erp_inventory.posting_source_registry
  SET completion_schema = 'erp_procurement',
      completion_function = 'complete_pgi_invoice_action_with_freight_to_pay'
  WHERE reference_document_type = 'SALES_INVOICE';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALES_INVOICE_POSTING_SOURCE_NOT_FOUND';
  END IF;
END;
$$;

COMMIT;
