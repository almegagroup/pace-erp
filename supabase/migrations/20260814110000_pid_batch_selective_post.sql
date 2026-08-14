-- MI07 batch-selective posting (§119, business-owner directive 2026-08-14): keep the atomicity
-- guarantee, but scope it to whichever items the user selected in this Post action ("batch"),
-- not the whole document. A document can now go through multiple Post actions over time, each
-- one atomic for its own selected batch, until every non-zero-difference item is posted.
--
-- Zero-difference items never need a real posting (no ledger movement) — their block release is
-- recomputed fresh from live data every call (cheap, idempotent), independent of which batch is
-- currently being posted, so they never block a later "fully done" check.

CREATE OR REPLACE FUNCTION erp_procurement.complete_pid_post(
  p_document_id uuid,
  p_postings    jsonb,   -- post_document's result: [{line_ref, stock_document_id, stock_ledger_id, ...}] for THIS batch only
  p_context     jsonb    -- {posted_by, process_order_reco_rows, packing_order_reco_rows,
                          --  process_order_header_updates, packing_order_header_updates}
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_inventory, erp_production, public
AS $fn$
DECLARE
  v_posted_by uuid := NULLIF(p_context->>'posted_by', '')::uuid;
  v_all_done  boolean;
BEGIN
  -- No EXCEPTION handler, deliberately (matches post_document/complete_process_po_verify) —
  -- any failure here rolls back the movements post_document already posted too.

  -- ── 1. Each counted item's own posting reference (this batch's items only, from p_postings) ──
  UPDATE erp_procurement.physical_inventory_item pii
  SET posted_stock_document_id = (p->>'stock_document_id')::uuid
  FROM jsonb_array_elements(p_postings) AS p
  WHERE pii.id = (p->>'line_ref')::uuid;

  -- ── 2. Release blocks for: zero-difference items (recomputed fresh, document-wide, harmless
  --      to repeat every call) + items just posted in THIS batch. Items with a non-zero
  --      difference that are NOT in this batch keep their block — still pending a decision. ──
  DELETE FROM erp_inventory.physical_inventory_block b
  USING erp_procurement.physical_inventory_item pii
  WHERE b.pi_document_id = p_document_id
    AND pii.document_id = p_document_id
    AND b.material_id = pii.material_id
    AND b.storage_location_id = pii.storage_location_id
    AND b.batch_number IS NOT DISTINCT FROM pii.batch_number
    AND (
      COALESCE(pii.difference_qty, 0) = 0
      OR pii.id IN (SELECT (p->>'line_ref')::uuid FROM jsonb_array_elements(p_postings) AS p)
    );

  -- ── 3. §119.14 — batch-tracked SFG genealogy: append-only delta rows, RM/INT lines ──────
  IF jsonb_array_length(COALESCE(p_context->'process_order_reco_rows', '[]'::jsonb)) > 0 THEN
    INSERT INTO erp_production.process_order_line_reco
    SELECT (jsonb_populate_record(
              NULL::erp_production.process_order_line_reco,
              jsonb_build_object(
                'id',                  gen_random_uuid(),
                'is_formulation_line', true,
                'is_voided',           false,
                'source_txn_type',     'PID_ADJUSTMENT',
                'reco_document_year',  '',
                'reference_document_type', 'PI',
                'last_updated_at',     now(),
                'last_updated_by',     v_posted_by
              ) || row_json
            )).*
    FROM jsonb_array_elements(p_context->'process_order_reco_rows') AS row_json;
  END IF;

  -- ── 4. §119.14 — batch-tracked FG genealogy: append-only delta rows, PM lines ───────────
  IF jsonb_array_length(COALESCE(p_context->'packing_order_reco_rows', '[]'::jsonb)) > 0 THEN
    INSERT INTO erp_production.packing_order_line_reco
    SELECT (jsonb_populate_record(
              NULL::erp_production.packing_order_line_reco,
              jsonb_build_object(
                'id',                  gen_random_uuid(),
                'is_voided',           false,
                'source_txn_type',     'PID_ADJUSTMENT',
                'reco_document_year',  '',
                'reference_document_type', 'PI',
                'last_updated_at',     now()
              ) || row_json
            )).*
    FROM jsonb_array_elements(p_context->'packing_order_reco_rows') AS row_json;
  END IF;

  -- ── 5. Batch header totals — so a FUTURE PR19/PID on the same batch computes its ratio
  --      from the corrected total, not a stale pre-PID one ─────────────────────────────
  UPDATE erp_production.process_order po
  SET actual_qty = po.actual_qty + (u->>'delta_qty')::numeric
  FROM jsonb_array_elements(COALESCE(p_context->'process_order_header_updates', '[]'::jsonb)) AS u
  WHERE po.id = (u->>'process_order_id')::uuid;

  UPDATE erp_production.packing_order pko
  SET actual_qty_kg = pko.actual_qty_kg + (u->>'delta_qty')::numeric
  FROM jsonb_array_elements(COALESCE(p_context->'packing_order_header_updates', '[]'::jsonb)) AS u
  WHERE pko.id = (u->>'packing_order_id')::uuid;

  -- ── 6. Document itself — only flips to POSTED once EVERY non-zero-difference item across
  --      the WHOLE document (not just this batch) has been posted. Otherwise stays
  --      PENDING_APPROVAL, ready for the next batch's Post action. ─────────────────────────
  SELECT NOT EXISTS (
    SELECT 1 FROM erp_procurement.physical_inventory_item
    WHERE document_id = p_document_id
      AND COALESCE(difference_qty, 0) <> 0
      AND posted_stock_document_id IS NULL
  ) INTO v_all_done;

  IF v_all_done THEN
    UPDATE erp_procurement.physical_inventory_document
    SET status    = 'POSTED',
        posted_by = v_posted_by,
        posted_at = now()
    WHERE id = p_document_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PI_POST_DOCUMENT_NOT_FOUND: %', p_document_id;
    END IF;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION erp_procurement.complete_pid_post(uuid, jsonb, jsonb) IS
  'post_document calls this in the same transaction. PID (MI07) business writes: item posting refs (this batch), per-item block release, §119.14 batch-genealogy reco deltas + header totals, document POSTED once every item is done. feasibility §119.9/§119.14, batch-selective correction 2026-08-14.';

UPDATE erp_inventory.posting_source_registry
SET notes = 'MI07 Post is now batch-selective (2026-08-14) — atomic per selected batch, not document-wide. A document can pass through multiple Post actions; POSTED is reached once every non-zero-difference item has been posted.'
WHERE reference_document_type = 'PI';
