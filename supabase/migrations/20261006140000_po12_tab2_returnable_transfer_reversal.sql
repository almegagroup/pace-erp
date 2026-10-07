/*
 * File-Path: supabase/migrations/20261006140000_po12_tab2_returnable_transfer_reversal.sql
 * Domain: PROCUREMENT
 * Purpose: PO12 Tab 2 (Returnable Material Transfer) — Cancel/Reversal action for an
 *          in-transit (post-Transfer, pre-Receive) posting. Deliberately deferred at
 *          the original 2026-10-05 lock ("today a mis-posted Transfer has no UI undo
 *          path ... Flagged for a follow-up pass, same shape as old PTO's own
 *          cancelPTOHandler/P304, if/when needed") — this is that follow-up.
 *
 * Schema: nothing to ALTER. The original migration
 * (20261006110000_po12_tab2_returnable_transfer.sql) already anticipated this --
 * returnable_transfer.status's own CHECK constraint already allows 'REVERSED', and
 * reversed_by/reversed_at/reversal_reason columns already exist, unused until now.
 * Only erp_procurement.complete_returnable_transfer_action needs a new branch.
 *
 * Movement: P304 ("P303 Reversal", IN_TRANSIT -> UNRESTRICTED, reverses_movement_type_
 * code = P303 -- seeded migration 20260509103000) posts the exact opposite of P303's
 * own two legs, both at the FROM company only (the TO company was never touched by
 * Transfer, so there is nothing to undo there): OUT from IN_TRANSIT, IN to
 * UNRESTRICTED, same storage location, same material/qty/rate as the original
 * Transfer line. Only a TRANSFERRED (not yet RECEIVED) document may be reversed this
 * way -- a RECEIVED transfer's stock has already left IN_TRANSIT into the TO
 * company's own UNRESTRICTED, which this action does not touch.
 */

BEGIN;

CREATE OR REPLACE FUNCTION erp_procurement.complete_returnable_transfer_action(
  p_reference_document_id uuid,
  p_postings              jsonb,
  p_context               jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, public
AS $fn$
DECLARE
  v_action text := p_context->>'action';
  v_header jsonb := p_context->'header';
  v_lines  jsonb := p_context->'lines';
  v_line   jsonb;
BEGIN
  -- No EXCEPTION handler, deliberately — any failure here rolls back the whole
  -- transaction, stock postings included (same rule as post_document itself).

  IF v_action = 'CREATE' THEN
    INSERT INTO erp_procurement.returnable_transfer (
      id, transfer_number, from_company_id, to_company_id, is_return, status,
      transfer_date, remarks, created_by
    ) VALUES (
      p_reference_document_id,
      v_header->>'transfer_number',
      (v_header->>'from_company_id')::uuid,
      (v_header->>'to_company_id')::uuid,
      COALESCE((v_header->>'is_return')::boolean, false),
      'TRANSFERRED',
      (v_header->>'transfer_date')::date,
      v_header->>'remarks',
      (v_header->>'created_by')::uuid
    );

    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      INSERT INTO erp_procurement.returnable_transfer_line (
        transfer_id, line_number, material_id, material_type,
        source_storage_location_id, quantity, uom_code, valuation_rate,
        issue_stock_document_id
      ) VALUES (
        p_reference_document_id,
        (v_line->>'line_number')::int,
        (v_line->>'material_id')::uuid,
        v_line->>'material_type',
        (v_line->>'source_storage_location_id')::uuid,
        (v_line->>'quantity')::numeric,
        v_line->>'uom_code',
        (v_line->>'valuation_rate')::numeric,
        (
          SELECT (p->>'stock_document_id')::uuid FROM jsonb_array_elements(p_postings) p
          WHERE p->>'line_ref' = (v_line->>'line_number') || '_out'
          LIMIT 1
        )
      );
    END LOOP;

  ELSIF v_action = 'RECEIVE' THEN
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      UPDATE erp_procurement.returnable_transfer_line
      SET target_storage_location_id = (v_line->>'target_storage_location_id')::uuid,
          receipt_stock_document_id = (
            SELECT (p->>'stock_document_id')::uuid FROM jsonb_array_elements(p_postings) p
            WHERE p->>'line_ref' = (v_line->>'line_number') || '_in'
            LIMIT 1
          )
      WHERE id = (v_line->>'line_id')::uuid AND transfer_id = p_reference_document_id;
    END LOOP;

    UPDATE erp_procurement.returnable_transfer
    SET status = 'RECEIVED',
        received_by = (p_context->>'received_by')::uuid,
        received_at = COALESCE((p_context->>'received_at')::timestamptz, now()),
        last_updated_by = (p_context->>'received_by')::uuid,
        last_updated_at = now()
    WHERE id = p_reference_document_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'RETURNABLE_TRANSFER_RECEIVE_NOT_FOUND: %', p_reference_document_id;
    END IF;

  ELSIF v_action = 'REVERSE' THEN
    -- Re-check status inside the transaction too (not just the TS caller's own
    -- pre-check) -- the row was locked FOR UPDATE by the caller before this point,
    -- so this guards against a stale read winning a race against a concurrent
    -- Receive, not against a genuine double-reverse.
    UPDATE erp_procurement.returnable_transfer
    SET status = 'REVERSED',
        reversed_by = (p_context->>'reversed_by')::uuid,
        reversed_at = COALESCE((p_context->>'reversed_at')::timestamptz, now()),
        reversal_reason = p_context->>'reversal_reason',
        last_updated_by = (p_context->>'reversed_by')::uuid,
        last_updated_at = now()
    WHERE id = p_reference_document_id AND status = 'TRANSFERRED';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'RETURNABLE_TRANSFER_REVERSE_INVALID_STATUS: %', p_reference_document_id;
    END IF;

  ELSE
    RAISE EXCEPTION 'RETURNABLE_TRANSFER_UNKNOWN_ACTION: %', v_action;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION erp_procurement.complete_returnable_transfer_action(uuid, jsonb, jsonb) IS
  'PO12 Tab 2 business writes, called by post_document() inside the same transaction as the P303/P305/P304 postings (CLAUDE.md 8D). 2026-10-05 lock + 2026-10-06 REVERSE addendum.';

COMMIT;
