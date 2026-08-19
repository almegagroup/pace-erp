-- IN13 Stock Status Change (feasibility §126) — SAP MB1B-equivalent generic
-- Unrestricted/QI/Blocked transfer posting. New doc_type (SSC), a flat
-- posting-log table (no separate request/header stage — each row is
-- self-contained, matching the locked "single page, direct action" design,
-- §126.6), registered against the shared post_document() engine (§8D).

-- 1. Document number series (§8) — free gap between PI (6500000001) and
--    PT (7000000001), avoids the already-documented-but-unused PARTIAL_REV
--    slot at 9600000001 to prevent a future collision.
INSERT INTO erp_procurement.document_number_series (doc_type, starting_number, last_number, pad_width)
VALUES ('SSC', 6600000001, 0, 10)
ON CONFLICT (doc_type) DO NOTHING;

-- 2. Posting log table
CREATE TABLE IF NOT EXISTS erp_inventory.stock_status_change_posting (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_number text NOT NULL,
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  storage_location_id uuid NOT NULL REFERENCES erp_inventory.storage_location_master(id),
  batch_number text NULL,
  packing_po_number text NULL,
  from_stock_type text NOT NULL CHECK (from_stock_type IN ('UNRESTRICTED', 'QUALITY_INSPECTION', 'BLOCKED')),
  to_stock_type text NOT NULL CHECK (to_stock_type IN ('UNRESTRICTED', 'QUALITY_INSPECTION', 'BLOCKED')),
  movement_type_code text NOT NULL,
  quantity numeric(20,6) NOT NULL,
  entered_quantity numeric(20,6) NOT NULL,
  uom_code text NOT NULL,
  reason text NOT NULL,
  requires_approval boolean NOT NULL DEFAULT false,
  -- DRAFT: row just inserted, about to post in the same request (no-approval
  -- transitions only) — should always become POSTED within the same call; a
  -- row stuck here is a genuine partial-posting failure (see suspect_statuses
  -- below). PENDING_APPROVAL: genuinely awaiting a Manager's Approve click
  -- (Blocked->Unrestricted only) — can legitimately sit for a long time, never
  -- flagged as suspect.
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'POSTED', 'REVERSED')),
  stock_document_id_out uuid REFERENCES erp_inventory.stock_document(id),
  stock_document_id_in uuid REFERENCES erp_inventory.stock_document(id),
  reversal_of_posting_id uuid REFERENCES erp_inventory.stock_status_change_posting(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid NULL,
  approved_at timestamptz NULL,
  last_updated_by uuid NULL,
  last_updated_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS ix_ssc_posting_company_created
  ON erp_inventory.stock_status_change_posting (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_ssc_posting_material_location_batch
  ON erp_inventory.stock_status_change_posting (material_id, storage_location_id, batch_number);
CREATE INDEX IF NOT EXISTS ix_ssc_posting_status
  ON erp_inventory.stock_status_change_posting (status) WHERE status IN ('DRAFT', 'PENDING_APPROVAL');

-- 3. post_document() completion function (§8D) — 'POST' fills in the
--    doc/ledger refs on an existing row (works for both the immediate-post
--    path and the approve-then-post path, since both pre-insert the row
--    before calling post_document); 'REVERSE' inserts a fresh row for the
--    reversal and marks the original REVERSED.
CREATE OR REPLACE FUNCTION erp_inventory.complete_stock_status_change_action(
  p_posting_id uuid,
  p_postings jsonb,
  p_context jsonb
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_action text := upper(coalesce(p_context->>'action', ''));
  v_posted_by uuid := NULLIF(p_context->>'posted_by', '')::uuid;
  v_now timestamptz := now();
  v_out_doc_id uuid;
  v_in_doc_id uuid;
  v_original erp_inventory.stock_status_change_posting%ROWTYPE;
  v_new_id uuid;
BEGIN
  IF v_action NOT IN ('POST', 'REVERSE') THEN
    RAISE EXCEPTION 'SSC_COMPLETION_ACTION_INVALID: %', v_action;
  END IF;

  SELECT NULLIF(p->>'stock_document_id', '')::uuid INTO v_out_doc_id
  FROM jsonb_array_elements(p_postings) AS p WHERE p->>'line_ref' = 'out' LIMIT 1;

  SELECT NULLIF(p->>'stock_document_id', '')::uuid INTO v_in_doc_id
  FROM jsonb_array_elements(p_postings) AS p WHERE p->>'line_ref' = 'in' LIMIT 1;

  IF v_out_doc_id IS NULL OR v_in_doc_id IS NULL THEN
    RAISE EXCEPTION 'SSC_COMPLETION_POSTING_REF_MISSING: %', p_posting_id;
  END IF;

  IF v_action = 'POST' THEN
    UPDATE erp_inventory.stock_status_change_posting
    SET status = 'POSTED',
        stock_document_id_out = v_out_doc_id,
        stock_document_id_in = v_in_doc_id,
        approved_by = CASE WHEN requires_approval THEN v_posted_by ELSE approved_by END,
        approved_at = CASE WHEN requires_approval THEN v_now ELSE approved_at END,
        last_updated_by = v_posted_by,
        last_updated_at = v_now
    WHERE id = p_posting_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SSC_COMPLETION_ROW_NOT_FOUND: %', p_posting_id;
    END IF;
  ELSE
    SELECT * INTO v_original
    FROM erp_inventory.stock_status_change_posting
    WHERE id = p_posting_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SSC_COMPLETION_ROW_NOT_FOUND: %', p_posting_id;
    END IF;

    v_new_id := gen_random_uuid();

    INSERT INTO erp_inventory.stock_status_change_posting (
      id, document_number, company_id, material_id, storage_location_id,
      batch_number, packing_po_number, from_stock_type, to_stock_type,
      movement_type_code, quantity, entered_quantity, uom_code, reason,
      requires_approval, status, stock_document_id_out, stock_document_id_in,
      reversal_of_posting_id, created_by, created_at
    ) VALUES (
      v_new_id, coalesce(p_context->>'reversal_document_number', v_original.document_number),
      v_original.company_id, v_original.material_id, v_original.storage_location_id,
      v_original.batch_number, v_original.packing_po_number,
      v_original.to_stock_type, v_original.from_stock_type,
      coalesce(p_context->>'reversal_movement_type_code', ''),
      v_original.quantity, v_original.entered_quantity, v_original.uom_code,
      coalesce(p_context->>'reversal_reason', 'Reversal of ' || v_original.document_number),
      false, 'POSTED', v_out_doc_id, v_in_doc_id, p_posting_id, v_posted_by, v_now
    );

    UPDATE erp_inventory.stock_status_change_posting
    SET status = 'REVERSED', last_updated_by = v_posted_by, last_updated_at = v_now
    WHERE id = p_posting_id;
  END IF;
END;
$$;

-- 4. Register with the shared posting engine (§8D). suspect_statuses = DRAFT
--    only — PENDING_APPROVAL is a legitimate long-lived wait state, not a
--    stalled posting, so it must never be flagged (see column comment above).
INSERT INTO erp_inventory.posting_source_registry
  (reference_document_type, label, source_schema, source_table, status_column, suspect_statuses, is_active, completion_schema, completion_function, notes)
VALUES (
  'STOCK_STATUS_CHANGE', 'Stock Status Change (IN13)', 'erp_inventory', 'stock_status_change_posting',
  'status', ARRAY['DRAFT'], true, 'erp_inventory', 'complete_stock_status_change_action',
  'DRAFT-এ আটকে থাকা row মানে no-approval transition posting মাঝপথে থেমেছে। PENDING_APPROVAL কখনো suspect না — Blocked→Unrestricted-এর জন্য ইচ্ছাকৃতভাবে দীর্ঘ সময় অপেক্ষা করতে পারে (§126.3)।'
)
ON CONFLICT (reference_document_type) DO UPDATE
  SET completion_schema = EXCLUDED.completion_schema,
      completion_function = EXCLUDED.completion_function,
      label = EXCLUDED.label,
      source_schema = EXCLUDED.source_schema,
      source_table = EXCLUDED.source_table,
      status_column = EXCLUDED.status_column,
      suspect_statuses = EXCLUDED.suspect_statuses,
      notes = EXCLUDED.notes,
      is_active = true;
