-- GRN reverse now also prunes the gate entry and puts the CSN back to its pre-GE status (TRN) when this was the GE's
-- last live GRN (a gate exit record stays as history; owner 2026-11-19: GE pruned, CSN back to TRN, all in the one reverse).
-- Same effect as pruneGateEntryHandler (CSN -> pre_ge_status, GE -> PRUNED). Patches the function in place so the
-- body from 20261119180000 stays the single source.
DO $patch$
DECLARE
  v_def text;
  v_block text := $blk$
  -- Last live GRN of the gate entry and no gate exit: prune the GE and release its CSNs back to pre-GE status.
  IF NOT EXISTS (SELECT 1 FROM erp_procurement.gate_entry_line WHERE gate_entry_id = v_grn.gate_entry_id AND grn_posted)
     AND NOT EXISTS (SELECT 1 FROM erp_procurement.goods_receipt g
                     WHERE g.gate_entry_id = v_grn.gate_entry_id AND g.id <> v_grn.id AND g.status <> 'REVERSED') THEN
    UPDATE erp_procurement.consignment_note c
    SET status = COALESCE(NULLIF(c.pre_ge_status, ''), 'ORD'),
        pre_ge_status = NULL, gate_entry_id = NULL, gate_entry_date = NULL, last_updated_at = now()
    WHERE c.id IN (SELECT csn_id FROM erp_procurement.gate_entry_line
                   WHERE gate_entry_id = v_grn.gate_entry_id AND csn_id IS NOT NULL);
    UPDATE erp_procurement.gate_entry
    SET status = 'PRUNED', last_updated_at = now()
    WHERE id = v_grn.gate_entry_id;
  END IF;
$blk$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'erp_procurement' AND p.proname = 'complete_grn_reverse';
  IF v_def IS NULL OR position('PRUNED' IN v_def) > 0 THEN
    RETURN; -- missing or already patched
  END IF;
  v_def := replace(v_def, E'\nEND;\n', E'\n' || v_block || E'END;\n');
  IF position('PRUNED' IN v_def) = 0 THEN
    RAISE EXCEPTION 'complete_grn_reverse patch did not apply';
  END IF;
  EXECUTE v_def;
END
$patch$;
