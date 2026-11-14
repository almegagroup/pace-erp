-- One active invoice per delivery-order group -- enforced where the write happens (inside the posting transaction).
--
-- Found live 2026-11-14 (prod, CMP005 SO02 Bulk Post): 66 delivery orders each got TWO identical POSTED invoices ~0.6 s
-- apart (same Tally number, items, qty, value) and two P601 stock issues, because two overlapping Bulk Post runs both
-- passed the TypeScript "does this DO already have an invoice?" check -- a check-then-act made on a status read at the
-- START of the request, with nothing in the database refusing the second write.
--
-- Fix: a thin outer wrapper around the registered completion function. For a CREATE it
--   1. locks the delivery_challan row (FOR UPDATE) so concurrent posts for one DO queue up, and
--   2. re-checks, inside the transaction, that no other DRAFT/POSTED invoice exists for the same DO group
--      (dc_id + so_id + sto_id + fo_id, NULL-safe),
-- and raises DO_ALREADY_INVOICED otherwise. Because post_sales_invoice_groups_atomic allocates the invoice number and
-- material-document number in this same transaction, a refused duplicate rolls those counters back too -- it consumes
-- no number and leaves no stock movement. A CANCELLED invoice does not count, so re-creating a cancelled group still
-- works. REVERSE is passed straight through.
--
-- The wrapper is registered in place of complete_pgi_invoice_action_with_sto_commercials, which it calls, so both the
-- Bulk/groups path and the single-DO path are covered by the one guard. Existing duplicate rows are not touched here;
-- they are cleaned separately (the guard only governs new CREATEs).

CREATE OR REPLACE FUNCTION erp_procurement.complete_pgi_invoice_action_guarded(
  p_reference_document_id uuid,
  p_postings jsonb,
  p_context jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_production, public
AS $fn$
DECLARE
  v_dc_id uuid := NULLIF(p_context->>'dc_id', '')::uuid;
  v_inv   jsonb := p_context->'invoice';
  v_dc_status text;
BEGIN
  IF p_context->>'action' = 'CREATE' THEN
    SELECT dc.status INTO v_dc_status
    FROM erp_procurement.delivery_challan dc
    WHERE dc.id = v_dc_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PGI_INVOICE_DC_NOT_FOUND: %', v_dc_id;
    END IF;
    IF upper(v_dc_status) NOT IN ('CREATED', 'DISPATCHED') THEN
      RAISE EXCEPTION 'DO_NOT_READY_FOR_PGI: delivery order % is %', v_dc_id, v_dc_status;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM erp_procurement.sales_invoice si
      WHERE si.dc_id = v_dc_id
        AND si.id <> p_reference_document_id
        AND si.status IN ('DRAFT', 'POSTED')
        AND si.so_id  IS NOT DISTINCT FROM NULLIF(v_inv->>'so_id', '')::uuid
        AND si.sto_id IS NOT DISTINCT FROM NULLIF(v_inv->>'sto_id', '')::uuid
        AND si.fo_id  IS NOT DISTINCT FROM NULLIF(v_inv->>'fo_id', '')::uuid
    ) THEN
      RAISE EXCEPTION 'DO_ALREADY_INVOICED: delivery order % already has an active invoice for this group', v_dc_id;
    END IF;
  END IF;

  PERFORM erp_procurement.complete_pgi_invoice_action_with_sto_commercials(p_reference_document_id, p_postings, p_context);
END;
$fn$;

COMMENT ON FUNCTION erp_procurement.complete_pgi_invoice_action_guarded(uuid, jsonb, jsonb) IS
  'Outer completion wrapper for SALES_INVOICE: serialises on the delivery_challan row and refuses a second active invoice for the same DO group (DO_ALREADY_INVOICED), then delegates to complete_pgi_invoice_action_with_sto_commercials.';

REVOKE ALL ON FUNCTION erp_procurement.complete_pgi_invoice_action_guarded(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.complete_pgi_invoice_action_guarded(uuid, jsonb, jsonb) TO service_role;

UPDATE erp_inventory.posting_source_registry
SET completion_function = 'complete_pgi_invoice_action_guarded'
WHERE reference_document_type = 'SALES_INVOICE'
  AND completion_schema = 'erp_procurement'
  AND completion_function = 'complete_pgi_invoice_action_with_sto_commercials';

-- Verification: the registry now points at the guard, and the guard exists with the expected signature.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM erp_inventory.posting_source_registry
    WHERE reference_document_type = 'SALES_INVOICE' AND completion_function = 'complete_pgi_invoice_action_guarded'
  ) THEN
    RAISE EXCEPTION 'PGI guard registration failed: SALES_INVOICE does not point at complete_pgi_invoice_action_guarded';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
