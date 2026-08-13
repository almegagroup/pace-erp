-- complete_pid_post — PID (MI07 Post Differences) business writes, §119.9/§119.14.
--
-- post_document() posts every non-zero-difference item's 701/702 in one transaction, then calls
-- this function in the SAME transaction: item posted_stock_document_id, block release, document
-- POSTED, and — for batch-tracked SFG/FG items only — the proportional reco genealogy adjustment
-- (§119.14: append-only delta rows in process_order_line_reco/packing_order_line_reco, main
-- RM/PM/INT stock untouched). MI07 is document-wide atomic (§119.9 correction): every item in the
-- document is already counted before this can even be called (PENDING_APPROVAL requires 100%), so
-- there is no more "partial posting, some items later" case — this either fully succeeds or the
-- whole document's Post attempt rolls back.
--
-- Zero-difference items never appear in p_postings (post_document only posts non-zero movements)
-- — their ids arrive via p_context->'zero_diff_item_ids' so their blocks still get released here.

CREATE OR REPLACE FUNCTION erp_procurement.complete_pid_post(
  p_document_id uuid,
  p_postings    jsonb,   -- post_document's result: [{line_ref, stock_document_id, stock_ledger_id, ...}]
  p_context     jsonb    -- {posted_by, zero_diff_item_ids, process_order_reco_rows, packing_order_reco_rows,
                          --  process_order_header_updates, packing_order_header_updates}
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_inventory, erp_production, public
AS $fn$
DECLARE
  v_posted_by uuid := NULLIF(p_context->>'posted_by', '')::uuid;
BEGIN
  -- No EXCEPTION handler, deliberately (matches post_document/complete_process_po_verify) —
  -- any failure here rolls back the movements post_document already posted too.

  -- ── 1. Each counted item's own posting reference ────────────────────────────────────
  UPDATE erp_procurement.physical_inventory_item pii
  SET posted_stock_document_id = (p->>'stock_document_id')::uuid
  FROM jsonb_array_elements(p_postings) AS p
  WHERE pii.id = (p->>'line_ref')::uuid;

  -- ── 2. Release every posting block for this document (zero-diff items included — they
  --      never appear in p_postings, so this must be document-scoped, not postings-scoped) ──
  DELETE FROM erp_inventory.physical_inventory_block
  WHERE pi_document_id = p_document_id;

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

  -- ── 6. Document itself — every item is guaranteed counted+processed at this point
  --      (PENDING_APPROVAL required 100% before Post could even be called) ────────────────
  UPDATE erp_procurement.physical_inventory_document
  SET status    = 'POSTED',
      posted_by = v_posted_by,
      posted_at = now()
  WHERE id = p_document_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PI_POST_DOCUMENT_NOT_FOUND: %', p_document_id;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION erp_procurement.complete_pid_post(uuid, jsonb, jsonb) IS
  'post_document calls this in the same transaction. PID (MI07) business writes: item posting refs, block release, §119.14 batch-genealogy reco deltas + header totals, document POSTED. feasibility §119.9/§119.14.';

REVOKE ALL ON FUNCTION erp_procurement.complete_pid_post(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.complete_pid_post(uuid, jsonb, jsonb) TO service_role;

-- ── Register PI in posting_source_registry (§119.11) — now that the completion function
--    exists, the health-check gate has something real to point at. suspect_statuses simplified
--    by the atomic-Post correction (§119.9): only POSTED is a "done" state, everything else is
--    suspect if a posting is found tagged to it.
INSERT INTO erp_inventory.posting_source_registry
  (reference_document_type, label, source_schema, source_table, status_column, suspect_statuses,
   is_active, notes, completion_schema, completion_function)
VALUES
  ('PI', 'Physical Inventory (PID)', 'erp_procurement', 'physical_inventory_document', 'status',
   ARRAY['OPEN', 'COUNTED', 'PENDING_APPROVAL'], true,
   'MI07 Post is document-wide atomic (§119.9) — POSTED is the only non-suspect terminal state.',
   'erp_procurement', 'complete_pid_post')
ON CONFLICT (reference_document_type) DO UPDATE
SET completion_schema = EXCLUDED.completion_schema,
    completion_function = EXCLUDED.completion_function,
    suspect_statuses = EXCLUDED.suspect_statuses,
    notes = EXCLUDED.notes;
