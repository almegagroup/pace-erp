-- SO05 Sales Return: header, invoice, item and repack-line persistence.
-- P651 posting is completed through erp_inventory.post_document by the API
-- handler; tables deliberately remain service-role-only like the existing
-- erp_procurement transactional documents.

INSERT INTO erp_procurement.document_number_series
  (doc_type, starting_number, last_number, pad_width)
VALUES ('SRET', 9800000001, 0, 10)
ON CONFLICT (doc_type) DO NOTHING;

CREATE TABLE erp_procurement.sales_return_receipt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL UNIQUE,
  receipt_date date NOT NULL,
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  return_type text NOT NULL CHECK (return_type IN ('DEPENDENT_DIRECT','DEPENDENT_DEPOT','INDEPENDENT_PARTY','INDEPENDENT_PARTY_ASIAN_BILLED','STO')),
  sending_parent_company_id uuid NULL REFERENCES erp_master.fg_parent_company(id),
  sending_vdc_id uuid NULL REFERENCES erp_master.fg_depot_code(id),
  sending_depot_id uuid NULL REFERENCES erp_master.fg_depot_code(id),
  sending_customer_id uuid NULL REFERENCES erp_master.customer_master(id),
  sending_customer_address_id uuid NULL REFERENCES erp_master.customer_address(id),
  sending_company_id uuid NULL REFERENCES erp_master.companies(id),
  sending_name text NULL, sending_address text NULL, sending_state text NULL, sending_gst_number text NULL,
  asian_side_choice text NULL CHECK (asian_side_choice IS NULL OR asian_side_choice IN ('VDC','DC','NONE')),
  asian_side_name text NULL, asian_side_address text NULL, asian_side_state text NULL, asian_side_gst_number text NULL,
  vehicle_number text NULL, transporter_id uuid NULL REFERENCES erp_master.transporter_master(id),
  transporter_name_freetext text NULL, lr_number text NULL, lr_date date NULL,
  gross_weight numeric NULL, net_weight numeric NULL, driver_number text NULL, driver_contact_number text NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED')),
  remarks text NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid NULL, last_updated_at timestamptz NULL
);

CREATE TABLE erp_procurement.sales_return_invoice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES erp_procurement.sales_return_receipt(id) ON DELETE CASCADE,
  tick_on boolean NOT NULL DEFAULT false, invoice_number text NOT NULL, invoice_date date NULL,
  reference_document_number text NULL, amount numeric NULL,
  gst_treatment text NULL CHECK (gst_treatment IS NULL OR gst_treatment IN ('INCLUSIVE','EXCLUSIVE')),
  gst_rate numeric NULL, gst_amount numeric NULL, state text NULL,
  freight_term text NULL CHECK (freight_term IS NULL OR freight_term IN ('FOR','TO_PAY')),
  detail_status text NOT NULL DEFAULT 'PENDING' CHECK (detail_status IN ('PENDING','DETAIL_CAPTURED')),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE erp_procurement.sales_return_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES erp_procurement.sales_return_invoice(id) ON DELETE CASCADE,
  line_number integer NOT NULL, line_material_type text NOT NULL CHECK (line_material_type IN ('RM','PM','INT','SFG','FG')),
  fg_type text NULL CHECK (fg_type IS NULL OR fg_type IN ('MTO','HPS','MTEST','MTS')),
  material_id uuid NULL REFERENCES erp_master.material_master(id), manual_sku_name text NULL,
  declared_stroke_number text NULL, batch_number text NULL, batch_resolved boolean NOT NULL DEFAULT false,
  packing_order_id uuid NULL REFERENCES erp_production.packing_order(id), expiry_date date NULL,
  num_packs numeric NULL, per_pack_qty numeric NULL, quantity numeric NOT NULL CHECK (quantity > 0), uom_code text NOT NULL,
  storage_location_id uuid NOT NULL REFERENCES erp_inventory.storage_location_master(id),
  is_repacked boolean NOT NULL DEFAULT false, stock_document_id uuid NULL REFERENCES erp_inventory.stock_document(id),
  stock_ledger_id uuid NULL REFERENCES erp_inventory.stock_ledger(id),
  posting_status text NOT NULL DEFAULT 'DRAFT' CHECK (posting_status IN ('DRAFT','POSTED')),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, line_number)
);

CREATE TABLE erp_procurement.sales_return_repack_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES erp_procurement.sales_return_item(id) ON DELETE CASCADE,
  target_material_id uuid NULL REFERENCES erp_master.material_master(id), target_manual_sku_name text NULL,
  num_packs numeric NULL, per_pack_qty numeric NULL, quantity numeric NOT NULL CHECK (quantity > 0), uom_code text NOT NULL,
  storage_location_id uuid NOT NULL REFERENCES erp_inventory.storage_location_master(id),
  stock_document_id uuid NULL REFERENCES erp_inventory.stock_document(id), stock_ledger_id uuid NULL REFERENCES erp_inventory.stock_ledger(id),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_sales_return_receipt_company_date ON erp_procurement.sales_return_receipt(company_id, receipt_date DESC);
CREATE INDEX ix_sales_return_invoice_pending ON erp_procurement.sales_return_invoice(detail_status) WHERE detail_status = 'PENDING';
CREATE INDEX ix_sales_return_item_pending_batch ON erp_procurement.sales_return_item(batch_resolved) WHERE batch_resolved = false;
CREATE INDEX ix_sales_return_item_pending_packing ON erp_procurement.sales_return_item(material_id, batch_number) WHERE packing_order_id IS NULL;

-- PR23 is owned by erp_production, while the rows it resolves live in
-- erp_procurement.  Keep the cross-schema/company predicate in one audited
-- SECURITY DEFINER function so the API cannot accidentally backfill a
-- same-material/same-batch return from another company.
CREATE OR REPLACE FUNCTION erp_procurement.backfill_sales_return_packing_order(
  p_packing_order_id uuid
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = erp_procurement, erp_production, public AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  UPDATE erp_procurement.sales_return_item i
  SET packing_order_id = po.id
  FROM erp_procurement.sales_return_invoice inv
  JOIN erp_procurement.sales_return_receipt r ON r.id = inv.receipt_id
  JOIN erp_production.packing_order po ON po.id = p_packing_order_id
  WHERE i.invoice_id = inv.id
    AND i.packing_order_id IS NULL
    AND i.line_material_type = 'FG'
    AND i.fg_type IN ('MTO','HPS','MTEST')
    AND i.material_id = po.material_id
    AND i.batch_number = po.batch_number
    AND r.company_id = po.company_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;
REVOKE ALL ON FUNCTION erp_procurement.backfill_sales_return_packing_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.backfill_sales_return_packing_order(uuid) TO service_role;

-- post_document invokes this completion in the same transaction as P651.
CREATE OR REPLACE FUNCTION erp_procurement.complete_sales_return_post(
  p_item_id uuid, p_postings jsonb, p_context jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = erp_procurement, public AS $$
BEGIN
  UPDATE erp_procurement.sales_return_item i
  SET stock_document_id = (p->>'stock_document_id')::uuid,
      stock_ledger_id = (p->>'stock_ledger_id')::uuid
  FROM jsonb_array_elements(p_postings) p
  WHERE i.id = p_item_id AND p->>'line_ref' = 'item:' || i.id::text;

  UPDATE erp_procurement.sales_return_repack_line r
  SET stock_document_id = (p->>'stock_document_id')::uuid,
      stock_ledger_id = (p->>'stock_ledger_id')::uuid
  FROM jsonb_array_elements(p_postings) p
  WHERE r.item_id = p_item_id AND p->>'line_ref' = 'repack:' || r.id::text;

  UPDATE erp_procurement.sales_return_item
  SET posting_status = 'POSTED'
  WHERE id = p_item_id;
END;
$$;
REVOKE ALL ON FUNCTION erp_procurement.complete_sales_return_post(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.complete_sales_return_post(uuid, jsonb, jsonb) TO service_role;

-- One outer transaction per receipt, while each item remains the reference id
-- on its own P651 stock_document (required by IN02/IN03 lot resolution).
CREATE OR REPLACE FUNCTION erp_procurement.post_sales_return_receipt(
  p_receipt_id uuid, p_item_groups jsonb, p_posted_by uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = erp_procurement, erp_inventory, public AS $$
DECLARE
  v_group jsonb;
  v_receipt erp_procurement.sales_return_receipt%ROWTYPE;
BEGIN
  SELECT * INTO v_receipt FROM erp_procurement.sales_return_receipt
  WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SRET_RECEIPT_NOT_FOUND'; END IF;
  IF v_receipt.status = 'POSTED' THEN RETURN; END IF;
  IF jsonb_typeof(p_item_groups) <> 'array' OR jsonb_array_length(p_item_groups) = 0 THEN
    RAISE EXCEPTION 'SRET_POSTING_GROUPS_REQUIRED';
  END IF;

  -- DEPENDENT: every item group posts inside this one database transaction.
  FOR v_group IN SELECT value FROM jsonb_array_elements(p_item_groups)
  LOOP
    PERFORM erp_inventory.post_document(
      'SALES_RETURN', (v_group->>'item_id')::uuid, v_group->'movements', p_posted_by,
      jsonb_build_object('receipt_id', p_receipt_id, 'posted_by', p_posted_by)
    );
  END LOOP;

  UPDATE erp_procurement.sales_return_receipt
  SET status='POSTED', last_updated_by=p_posted_by, last_updated_at=now()
  WHERE id=p_receipt_id;
END;
$$;
REVOKE ALL ON FUNCTION erp_procurement.post_sales_return_receipt(uuid, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.post_sales_return_receipt(uuid, jsonb, uuid) TO service_role;

INSERT INTO erp_inventory.posting_source_registry
  (reference_document_type, label, source_schema, source_table, status_column, suspect_statuses, is_active, completion_schema, completion_function)
VALUES ('SALES_RETURN', 'Sales Return (SO05)', 'erp_procurement', 'sales_return_item', 'posting_status', ARRAY['DRAFT'], true, 'erp_procurement', 'complete_sales_return_post')
ON CONFLICT (reference_document_type) DO UPDATE SET
  completion_schema = EXCLUDED.completion_schema, completion_function = EXCLUDED.completion_function,
  source_schema = EXCLUDED.source_schema, source_table = EXCLUDED.source_table, status_column = EXCLUDED.status_column,
  suspect_statuses = EXCLUDED.suspect_statuses, is_active = true;
