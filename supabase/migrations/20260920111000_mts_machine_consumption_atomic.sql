-- §138.18 -- Store the MTS machine-bucket issue together with Verify.
--
-- Page 4 derives availability from machine_stock_log.  The matching P261
-- issue must therefore write its OUT row inside the same post_document
-- transaction as the inventory posting; otherwise a verified order can be
-- consumed in inventory but remain available to the next auto-derive.

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

  IF jsonb_array_length(COALESCE(p_context->'machine_stock_log_rows','[]'::jsonb)) > 0 THEN
    INSERT INTO erp_production.machine_stock_log (
      company_id,
      storage_location_id,
      material_id,
      machine_id,
      batch_number,
      qty,
      direction,
      source_type,
      reference_document_type,
      reference_document_id,
      created_by
    )
    SELECT
      (row_json->>'company_id')::uuid,
      (row_json->>'storage_location_id')::uuid,
      (row_json->>'material_id')::uuid,
      NULLIF(row_json->>'machine_id','')::uuid,
      NULLIF(row_json->>'batch_number',''),
      (row_json->>'qty')::numeric,
      row_json->>'direction',
      row_json->>'source_type',
      row_json->>'reference_document_type',
      (row_json->>'reference_document_id')::uuid,
      NULLIF(row_json->>'created_by','')::uuid
    FROM jsonb_array_elements(p_context->'machine_stock_log_rows') AS row_json;
  END IF;

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
  SET status                     = 'VERIFIED',
      actual_qty                 = (v_header->>'actual_qty')::numeric,
      fg_stock_ledger_id         = v_fg_ledger,
      qi_release_stock_ledger_id = v_qi_ledger,
      verified_at                = now(),
      verified_by                = NULLIF(v_header->>'verified_by','')::uuid,
      has_unapproved_deviation   = COALESCE((v_header->>'has_unapproved_deviation')::boolean, false),
      urgent_posting_date        = NULLIF(v_header->>'urgent_posting_date','')::date,
      last_updated_at            = now(),
      last_updated_by            = NULLIF(v_header->>'last_updated_by','')::uuid
  WHERE id = p_process_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROD_PO_VERIFY_HEADER_NOT_FOUND: %', p_process_order_id;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION erp_production.complete_process_po_verify(uuid, jsonb, jsonb) IS
  'post_document একই transaction-এ ডাকে। Process PO Verify-র line ledger ids, reservation issue, MTS machine-bucket OUT rows, reco rows, header VERIFIED + urgent_posting_date।';
