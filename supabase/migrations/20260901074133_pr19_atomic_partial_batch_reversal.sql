-- Gate 27.19 / CLAUDE.md §8D / feasibility §107.8
--
-- PR19 (Partial Batch Reversal) migrated from N sequential post_stock_movement() calls
-- + 3 separate follow-up inserts (header, lines, Reco credit rows) into ONE transactional
-- erp_inventory.post_document() call, matching Process PO Verify / Packing PO Final /
-- PGI+Invoice's existing pattern.
--
-- Real prod incident that motivated this (2026-09-01): CMP003 batch EV02625's reversal
-- posted all 12 stock movements successfully, but the trailing Reco credit-row insert then
-- failed on a NOT NULL violation (process_order_line_reco.approved_status was never set by
-- the old insert) -- the API returned an error, the user retried, and the retry correctly
-- failed with "available: 0" since the stock had, in fact, already moved. Nothing about that
-- sequence was reversible from the UI. Making the whole write atomic removes this failure
-- mode structurally, the same way it was already removed for Process PO Verify.

CREATE OR REPLACE FUNCTION erp_production.complete_partial_batch_reversal(
  p_reversal_id uuid,
  p_postings jsonb,
  p_context jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_production, erp_inventory, public
AS $function$
DECLARE
  v_header jsonb := COALESCE(p_context->'header', '{}'::jsonb);
BEGIN
  INSERT INTO erp_production.partial_batch_reversal (
    id, company_id, document_number, po_type, prodshade_material_id, source_batch_number,
    source_process_order_id, selected_row_type, selected_material_id,
    selected_storage_location_id, selected_packing_order_id, reverse_qty,
    actual_total_output, reversal_ratio, salvage_batch_number, salvage_process_order_id,
    status, created_by
  ) VALUES (
    p_reversal_id,
    (v_header->>'company_id')::uuid,
    v_header->>'document_number',
    v_header->>'po_type',
    (v_header->>'prodshade_material_id')::uuid,
    v_header->>'source_batch_number',
    (v_header->>'source_process_order_id')::uuid,
    v_header->>'selected_row_type',
    (v_header->>'selected_material_id')::uuid,
    (v_header->>'selected_storage_location_id')::uuid,
    NULLIF(v_header->>'selected_packing_order_id', '')::uuid,
    (v_header->>'reverse_qty')::numeric,
    (v_header->>'actual_total_output')::numeric,
    (v_header->>'reversal_ratio')::numeric,
    NULLIF(v_header->>'salvage_batch_number', ''),
    NULLIF(v_header->>'salvage_process_order_id', '')::uuid,
    'POSTED',
    (v_header->>'created_by')::uuid
  );

  -- Each line in p_context->'lines' carries its own `line_ref` (matching a movement's
  -- line_ref if it posted one, or absent/null for an excluded PM line that never posted) --
  -- the LEFT JOIN LATERAL resolves the real stock_ledger_id for posted lines and leaves it
  -- NULL for excluded ones, exactly like the original two-step TS code did.
  INSERT INTO erp_production.partial_batch_reversal_line (
    reversal_id, line_type, material_id, formulation_material_id, included, qty, uom_code,
    movement_type_code, direction, storage_location_id, stock_ledger_id, display_order
  )
  SELECT
    p_reversal_id,
    l->>'line_type',
    (l->>'material_id')::uuid,
    NULLIF(l->>'formulation_material_id', '')::uuid,
    (l->>'included')::boolean,
    (l->>'qty')::numeric,
    l->>'uom_code',
    NULLIF(l->>'movement_type_code', ''),
    NULLIF(l->>'direction', ''),
    NULLIF(l->>'storage_location_id', '')::uuid,
    post.stock_ledger_id,
    (l->>'display_order')::int
  FROM jsonb_array_elements(p_context->'lines') AS l
  LEFT JOIN LATERAL (
    SELECT (p->>'stock_ledger_id')::uuid AS stock_ledger_id
    FROM jsonb_array_elements(p_postings) AS p
    WHERE p->>'line_ref' = l->>'line_ref'
  ) post ON true;

  -- §106 Phase 3 — Reco/Costing credit rows (negative RM/INT, source_txn_type =
  -- PARTIAL_REVERSAL). jsonb_populate_record fills every column TS did not explicitly set
  -- (id, is_voided, last_updated_at) from the table's own defaults, same idiom as
  -- complete_process_po_verify's PRODUCTION reco insert.
  IF jsonb_array_length(COALESCE(p_context->'reco_rows', '[]'::jsonb)) > 0 THEN
    INSERT INTO erp_production.process_order_line_reco
    SELECT (jsonb_populate_record(
              NULL::erp_production.process_order_line_reco,
              -- jsonb_populate_record sets any key absent from the merged object to NULL --
              -- it does NOT fall back to the column's own DEFAULT the way a real INSERT with
              -- an omitted column would. is_formulation_line must be listed explicitly here
              -- for exactly that reason (caught by a rolled-back dry run before this migration
              -- ever reached prod -- it violated the NOT NULL constraint with no default applied).
              jsonb_build_object('id', gen_random_uuid(), 'is_formulation_line', true, 'is_voided', false, 'last_updated_at', now())
              || row_json
            )).*
    FROM jsonb_array_elements(p_context->'reco_rows') AS row_json;
  END IF;
END;
$function$;

-- Register PARTIAL_REV so post_document() will route to the function above. The header row
-- is only ever created already-POSTED, atomically with every posting and the Reco rows --
-- there is no pre-existing draft/suspect status for this table to get stuck in mid-flight,
-- so suspect_statuses is intentionally empty (stock_health_check()'s Tier-2 check will never
-- find a row here to flag, by construction, not by omission).
INSERT INTO erp_inventory.posting_source_registry (
  reference_document_type, label, source_schema, source_table, status_column,
  suspect_statuses, is_active, notes, completion_schema, completion_function
) VALUES (
  'PARTIAL_REV', 'Partial Batch Reversal (PR19)', 'erp_production', 'partial_batch_reversal',
  'status', '{}', true,
  'Migrated to post_document/complete_partial_batch_reversal 2026-09-01 after a real prod incident (CMP003 batch EV02625): stock posted successfully but the trailing Reco credit-row insert failed on a NOT NULL violation, leaving the API showing an error for a reversal that had, in fact, already posted. The header row here is created already-POSTED in the same transaction as every movement and Reco row -- nothing can ever be caught mid-flight, hence the empty suspect_statuses.',
  'erp_production', 'complete_partial_batch_reversal'
)
ON CONFLICT (reference_document_type) DO UPDATE SET
  completion_schema = EXCLUDED.completion_schema,
  completion_function = EXCLUDED.completion_function,
  notes = EXCLUDED.notes,
  is_active = true;
