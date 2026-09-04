-- §136 (2026-09-04) -- complete_process_po_verify additionally persists
-- process_order.urgent_posting_date (the Current date-1 label used for this
-- Verify's postings, when priority=URGENT) so Packing PO Final can later
-- read and reuse the exact same value (never recompute it independently --
-- the two steps can happen on different real days).

CREATE OR REPLACE FUNCTION erp_production.complete_process_po_verify(
  p_process_order_id uuid,
  p_postings         jsonb,
  p_context          jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_production, erp_inventory, public
AS $fn$
DECLARE
  v_fg_ledger  uuid;
  v_qi_ledger  uuid;
  v_header     jsonb := COALESCE(p_context->'header', '{}'::jsonb);
BEGIN
  UPDATE erp_production.process_order_line pol
  SET stock_ledger_id = (p->>'stock_ledger_id')::uuid
  FROM jsonb_array_elements(p_postings) AS p
  WHERE p->>'line_ref' NOT IN ('FG', 'QI_OUT', 'QI_RELEASE')
    AND pol.id = (p->>'line_ref')::uuid;

  UPDATE erp_production.reservation_document rd
  SET issued_qty      = (r->>'issued_qty')::numeric,
      status          = r->>'status',
      last_updated_at = now(),
      last_updated_by = NULLIF(v_header->>'last_updated_by','')::uuid
  FROM jsonb_array_elements(COALESCE(p_context->'reservations','[]'::jsonb)) AS r
  WHERE rd.id = (r->>'reservation_id')::uuid;

  IF jsonb_array_length(COALESCE(p_context->'reco_rows','[]'::jsonb)) > 0 THEN
    INSERT INTO erp_production.process_order_line_reco
    SELECT (jsonb_populate_record(
              NULL::erp_production.process_order_line_reco,
              jsonb_build_object(
                'id',                  gen_random_uuid(),
                'line_material_type',  'RM',
                'is_formulation_line', true,
                'is_voided',           false,
                'source_txn_type',     'PRODUCTION',
                'reco_document_year',  '',
                'last_updated_at',     now()
              ) || row_json
            )).*
    FROM jsonb_array_elements(p_context->'reco_rows') AS row_json;
  END IF;

  SELECT (p->>'stock_ledger_id')::uuid INTO v_fg_ledger
  FROM jsonb_array_elements(p_postings) AS p WHERE p->>'line_ref' = 'FG';

  SELECT (p->>'stock_ledger_id')::uuid INTO v_qi_ledger
  FROM jsonb_array_elements(p_postings) AS p WHERE p->>'line_ref' = 'QI_RELEASE';

  UPDATE erp_production.process_order
  SET status                   = 'VERIFIED',
      actual_qty               = (v_header->>'actual_qty')::numeric,
      fg_stock_ledger_id       = v_fg_ledger,
      qi_release_stock_ledger_id = v_qi_ledger,
      verified_at              = now(),
      verified_by              = NULLIF(v_header->>'verified_by','')::uuid,
      has_unapproved_deviation = COALESCE((v_header->>'has_unapproved_deviation')::boolean, false),
      urgent_posting_date      = NULLIF(v_header->>'urgent_posting_date','')::date,
      last_updated_at          = now(),
      last_updated_by          = NULLIF(v_header->>'last_updated_by','')::uuid
  WHERE id = p_process_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROD_PO_VERIFY_HEADER_NOT_FOUND: %', p_process_order_id;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION erp_production.complete_process_po_verify(uuid, jsonb, jsonb) IS
  'post_document একই transaction-এ ডাকে। Process PO Verify-র business write: line ledger ids, reservation issue, reco rows, header VERIFIED + urgent_posting_date (§136)।';
