-- IN15 (MTS FG Hold & Block Trail): QA must say WHY a quantity is put into Quality Inspection / Blocked.
--
-- 1. `mts_verify_hold_allocation.reason` -- written by MTS Verify (NULL for holds made before this migration).
-- 2. `complete_process_po_verify` writes that reason into the hold row and into the stock_status_change_posting
--    row (it used to write the fixed text 'MTS Verify QA stock allocation' there; that text stays as the fallback
--    when no reason was sent).
--
-- The function is patched FROM ITS LIVE DEFINITION, not re-declared from an older migration file: the live body
-- is whatever earlier migrations left in this database, and re-declaring it from a stale copy is exactly how an
-- earlier migration silently dropped a branch. Each edit must match exactly once or the migration aborts, so it
-- can never become a silent no-op on another database.

ALTER TABLE erp_production.mts_verify_hold_allocation
  ADD COLUMN IF NOT EXISTS reason text NULL;

COMMENT ON COLUMN erp_production.mts_verify_hold_allocation.reason IS
  'QA reason for holding this quantity (MTS Verify). NULL for holds made before the reason became compulsory.';

DO $patch$
DECLARE
  v_def text := pg_get_functiondef('erp_production.complete_process_po_verify(uuid,jsonb,jsonb)'::regprocedure);
  v_edits text[][] := ARRAY[
    ARRAY['held_pack_qty, qty_kg, created_by',
          'held_pack_qty, qty_kg, created_by, reason'],
    ARRAY['(row_json->>''qty_kg'')::numeric, v_verified_by',
          '(row_json->>''qty_kg'')::numeric, v_verified_by, NULLIF(btrim(row_json->>''reason''), '''')'],
    ARRAY['''MTS Verify QA stock allocation'', false',
          'COALESCE(NULLIF(btrim(v_item->>''reason''), ''''), ''MTS Verify QA stock allocation''), false']
  ];
  v_i int;
  v_hits int;
BEGIN
  FOR v_i IN 1 .. array_length(v_edits, 1) LOOP
    v_hits := (length(v_def) - length(replace(v_def, v_edits[v_i][1], ''))) / length(v_edits[v_i][1]);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'MTS_HOLD_REASON_PATCH: expected exactly 1 match for edit %, found %', v_i, v_hits;
    END IF;
    v_def := replace(v_def, v_edits[v_i][1], v_edits[v_i][2]);
  END LOOP;
  EXECUTE v_def;
END
$patch$;

NOTIFY pgrst, 'reload schema';
