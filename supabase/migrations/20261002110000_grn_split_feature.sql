-- ============================================================================
-- §3.9.5 "GRN Split" (1 GRN : many Invoices) -- Bulk-only, business-owner-
-- locked design, 2026-10-02 (PROCUREMENT-DESIGN-DOC.md §3.9.5).
--
-- Scope: a vendor sometimes splits ONE truck's material across MULTIPLE
-- invoices (commonly to stay under the e-way-bill value threshold), but the
-- GRN was already created as exactly ONE GRN. This migration lets Store turn
-- that one GRN into N GRNs (one per invoice), reversing the original and
-- posting N fresh ones, all in a SINGLE atomic transaction via the existing
-- erp_inventory.post_document() "common gate" (CLAUDE.md §8D) -- a reverse-
-- then-repost that nets to zero must never be done as separate round trips,
-- or a transient negative-stock state is possible if anything else touched
-- the same material/location in between.
--
-- Bulk-only because RM/PM/INT under Bulk are NOT batch-tracked (unlike
-- MTO/HPS/MTEST's SFG/FG) -- there is no batch-genealogy-aware partial-
-- reversal risk here (the exact risk that made §3.9.2 explicitly EXCLUDE
-- "a GRN split across invoices" as a case). This is that excluded case,
-- reopened specifically for this narrower, non-batch-tracked scope.
--
-- ⚠️ DEVIATION FROM ORIGINAL DESIGN, recorded 2026-10-02: the original lock
-- called for dropping ux_goods_receipt_gate_entry_line (a unique index on
-- gate_entry_line_id with no status filter, so even a REVERSED GRN
-- permanently occupies its slot -- a real pre-existing gap, confirmed
-- 0 real Prod occurrences). DROP INDEX hung indefinitely via both
-- apply_migration and execute_sql on this Dev project -- reproduced on a
-- throwaway scratch index too (CREATE INDEX/ALTER INDEX RENAME both worked
-- instantly; only DROP INDEX hung), so this is a Supabase-infra-level issue
-- outside application control, not a lock/code problem. Worked around
-- without touching that index at all: split-created GRNs get
-- gate_entry_line_id = NULL (never violating the still-active unique index)
-- and carry the GE line reference via the new source_gate_entry_line_id
-- column instead, read by the same "does this GE line already have a GRN"
-- checks (grn.handlers.ts). The original gap (can't recreate a GRN after a
-- PLAIN single reversal) stays open, unrelated to Split -- retry the DROP
-- INDEX in a later migration once the infra issue clears, and this column
-- split could in principle be collapsed back at that point (not required --
-- leaving both columns is harmless going forward).
-- ============================================================================

-- ── 1. split_source_grn_id -- marks a GRN as one of the N created by a split ─
ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN IF NOT EXISTS split_source_grn_id uuid NULL
    REFERENCES erp_procurement.goods_receipt(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_goods_receipt_split_source
  ON erp_procurement.goods_receipt(split_source_grn_id)
  WHERE split_source_grn_id IS NOT NULL;

COMMENT ON COLUMN erp_procurement.goods_receipt.split_source_grn_id IS
  '§3.9.5 "GRN Split" -- when set, this GRN was created by splitting the referenced '
  '(now REVERSED) original GRN across multiple vendor invoices for the same truck/delivery. '
  'NULL for every ordinary GRN. Drives the AC01 "split" marker on the original row.';

-- ── 2. source_gate_entry_line_id -- GE line reference for split rows only ───
-- See the DEVIATION note above: ux_goods_receipt_gate_entry_line couldn't be
-- dropped (infra issue), so split rows can never set gate_entry_line_id
-- directly without violating it. This column carries the same reference for
-- split-created rows, read by the same "does this GE line already have a
-- GRN" checks as gate_entry_line_id.
ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN IF NOT EXISTS source_gate_entry_line_id uuid NULL
    REFERENCES erp_procurement.gate_entry_line(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_goods_receipt_source_ge_line
  ON erp_procurement.goods_receipt(source_gate_entry_line_id)
  WHERE source_gate_entry_line_id IS NOT NULL;

COMMENT ON COLUMN erp_procurement.goods_receipt.source_gate_entry_line_id IS
  '§3.9.5 "GRN Split" -- a split-created GRN cannot reuse gate_entry_line_id directly '
  '(ux_goods_receipt_gate_entry_line is still a hard unique index, one row per GE line, '
  'undroppable right now -- see this migration''s header note). This column carries the '
  'same GE line reference for split rows only, read by the same "does this GE line already '
  'have a GRN" checks as gate_entry_line_id.';

-- Performance-only replacement for the one effective use the dropped index
-- would have served (plain lookup, not uniqueness) -- harmless alongside the
-- still-active unique index.
CREATE INDEX IF NOT EXISTS idx_goods_receipt_gate_entry_line
  ON erp_procurement.goods_receipt(gate_entry_line_id)
  WHERE gate_entry_line_id IS NOT NULL;

-- ── 3. complete_grn_split -- post_document's completion function for GRN ────
-- Called by post_document() inside the SAME transaction as the P102 reversal
-- + N fresh P101 receipts. Same division of labor as every other
-- post_document migration in this codebase (CLAUDE.md 8D): calculations
-- (proportional split, validation) stay in TypeScript; only the WRITE moves
-- here. Reversal header fields mirror reverseGRNHandler's own update exactly
-- -- no new reversal vocabulary introduced.
CREATE OR REPLACE FUNCTION erp_procurement.complete_grn_split(
  p_reference_document_id uuid,   -- the ORIGINAL (to-be-reversed) GRN's id
  p_postings               jsonb, -- post_document's result: [{line_ref, stock_document_id, stock_ledger_id, valuation_rate}, ...]
  p_context                jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, public
AS $fn$
DECLARE
  v_actor  uuid := NULLIF(p_context->>'actor', '')::uuid;
  v_reason text := p_context->>'reversal_reason';
  v_split  jsonb;
  v_post   jsonb;
  v_row    erp_procurement.goods_receipt%ROWTYPE;
BEGIN
  -- No EXCEPTION handler, same as post_document / complete_pgi_invoice_action
  -- -- any failure here rolls back the whole transaction, stock movements
  -- included. That's the entire point of this migration.

  UPDATE erp_procurement.goods_receipt
  SET status = 'REVERSED',
      movement_type_code = 'P102',
      reversal_grn_id = id,
      reversal_approved_by = v_actor,
      reversal_approved_at = now(),
      reversal_reason = v_reason,
      last_updated_at = now()
  WHERE id = p_reference_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GRN_SPLIT_ORIGINAL_NOT_FOUND: %', p_reference_document_id;
  END IF;

  -- Each split's full new-row payload is built in TypeScript by cloning the
  -- original GRN row (select "*") and overriding only what differs -- this
  -- guarantees every NOT NULL column is already populated from the live row,
  -- so jsonb_populate_record never has to guess a value this function didn't
  -- explicitly intend. gate_entry_line_id must be NULL and
  -- source_gate_entry_line_id must carry the real GE line id (see §DEVIATION
  -- note above) -- enforced by the TypeScript caller, not re-checked here.
  FOR v_split IN SELECT value FROM jsonb_array_elements(p_context->'splits')
  LOOP
    SELECT p INTO v_post
    FROM jsonb_array_elements(p_postings) p
    WHERE p->>'line_ref' = v_split->>'line_ref';
    IF v_post IS NULL THEN
      RAISE EXCEPTION 'GRN_SPLIT_POSTING_NOT_FOUND: %', v_split->>'line_ref';
    END IF;

    v_row := jsonb_populate_record(
      null::erp_procurement.goods_receipt,
      v_split || jsonb_build_object(
        'stock_document_id', v_post->>'stock_document_id',
        'stock_ledger_id', v_post->>'stock_ledger_id'
      )
    );

    INSERT INTO erp_procurement.goods_receipt SELECT (v_row).*;
  END LOOP;
END;
$fn$;

COMMENT ON FUNCTION erp_procurement.complete_grn_split(uuid, jsonb, jsonb) IS
  'post_document একই transaction-এ ডাকে -- §3.9.5 "GRN Split": original GRN reverse করে, N-টা নতুন split GRN বসায়।';

REVOKE ALL ON FUNCTION erp_procurement.complete_grn_split(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.complete_grn_split(uuid, jsonb, jsonb) TO service_role;

-- Register this completion function against the EXISTING 'GRN' entry in
-- posting_source_registry (verified live before writing this migration:
-- completion_function was NULL there -- GRN's own ordinary create/reverse
-- flow hasn't migrated to post_document yet per §8D's own stated order, so
-- this is the first and only caller of post_document('GRN', ...) today).
UPDATE erp_inventory.posting_source_registry
SET completion_schema = 'erp_procurement',
    completion_function = 'complete_grn_split'
WHERE reference_document_type = 'GRN'
  AND completion_function IS NULL;
