-- SO02 PGI groups must allocate business and material-document numbers in the
-- same transaction as stock, invoice, reservation, and reconciliation writes.
-- A rejected PGI therefore rolls every counter update back as well.
CREATE OR REPLACE FUNCTION erp_inventory.post_sales_invoice_groups_atomic(p_groups jsonb, p_posted_by uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = erp_inventory, erp_procurement, public
AS $$
DECLARE
  v_group jsonb;
  v_context jsonb;
  v_movements jsonb;
  v_invoice_id uuid;
  v_company_id uuid;
  v_invoice_number text;
  v_invoice_date date;
  v_matdoc_number text;
  v_matdoc_year text;
BEGIN
  IF p_groups IS NULL OR jsonb_typeof(p_groups) <> 'array' OR jsonb_array_length(p_groups) = 0 THEN
    RAISE EXCEPTION 'PGI_INVOICE_GROUPS_INVALID';
  END IF;

  FOR v_group IN SELECT value FROM jsonb_array_elements(p_groups) LOOP
    v_invoice_id := (v_group->>'invoice_id')::uuid;
    v_context := v_group->'context';
    v_company_id := (v_context#>>'{invoice,company_id}')::uuid;
    v_invoice_date := COALESCE(NULLIF(v_context#>>'{invoice,invoice_date}', '')::date, current_date);
    IF v_invoice_id IS NULL OR v_company_id IS NULL THEN
      RAISE EXCEPTION 'PGI_INVOICE_GROUP_CONTEXT_INVALID';
    END IF;

    SELECT erp_procurement.generate_doc_number('SALES_INVOICE') INTO v_invoice_number;
    SELECT doc_number, doc_year
      INTO v_matdoc_number, v_matdoc_year
      FROM erp_inventory.generate_material_doc_number(v_company_id);

    v_context := jsonb_set(v_context, '{invoice,invoice_number}', to_jsonb(v_invoice_number), true);
    SELECT jsonb_agg(
      movement || jsonb_build_object(
        'document_number', v_invoice_number,
        'document_date', v_invoice_date,
        'reference_document_number', v_invoice_number,
        'material_doc_number', v_matdoc_number,
        'material_doc_year', v_matdoc_year
      )
      ORDER BY ordinal
    ) INTO v_movements
    FROM jsonb_array_elements(v_group->'movements') WITH ORDINALITY AS entries(movement, ordinal);

    PERFORM erp_inventory.post_document('SALES_INVOICE', v_invoice_id, v_movements, p_posted_by, v_context);
  END LOOP;
END;
$$;
