/*
 * File-Path: supabase/migrations/20261006110000_po12_tab2_returnable_transfer.sql
 * Domain: PROCUREMENT
 * Purpose: PO12 Tab 2 (Returnable Material Transfer) — Transfer/Receive/Report mechanism.
 *          Final design locked 2026-10-05. A new, separate multi-line document type —
 *          NOT a retrofit of the old single-line plant_transfer_order (Gate-23/L6),
 *          which stays untouched. Reuses the old mechanism's own movement codes
 *          (P303 Issue, P305 Receive — already seeded, cross-company-legal) and §8D's
 *          post_document() transactional gate (CLAUDE.md 8D / feasibility §107.8) instead
 *          of calling post_stock_movement directly, so this new source never adds to the
 *          stock-posting-guard.mjs ratchet baseline.
 */

BEGIN;

-- ── Document number series — new 'RMT' band (free gap after RTV/DN/EXR, CLAUDE.md §8) ──
INSERT INTO erp_procurement.document_number_series (doc_type, pad_width, starting_number)
VALUES ('RMT', 10, 8300000001)
ON CONFLICT (doc_type) DO NOTHING;

-- ── Header ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.returnable_transfer (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number   text NOT NULL,
  from_company_id   uuid NOT NULL,
  to_company_id     uuid NOT NULL,
  is_return         boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'TRANSFERRED'
    CHECK (status IN ('TRANSFERRED', 'RECEIVED', 'REVERSED')),
  transfer_date     date NOT NULL,
  remarks           text NULL,
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  received_by       uuid NULL,
  received_at       timestamptz NULL,
  reversed_by       uuid NULL,
  reversed_at       timestamptz NULL,
  reversal_reason   text NULL,
  last_updated_by   uuid NULL,
  last_updated_at   timestamptz NULL,
  CHECK (from_company_id <> to_company_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_returnable_transfer_number
  ON erp_procurement.returnable_transfer (transfer_number);
CREATE INDEX IF NOT EXISTS idx_returnable_transfer_from
  ON erp_procurement.returnable_transfer (from_company_id);
CREATE INDEX IF NOT EXISTS idx_returnable_transfer_to_status
  ON erp_procurement.returnable_transfer (to_company_id, status);
CREATE INDEX IF NOT EXISTS idx_returnable_transfer_date
  ON erp_procurement.returnable_transfer (transfer_date);

-- ── Lines ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.returnable_transfer_line (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id                   uuid NOT NULL REFERENCES erp_procurement.returnable_transfer(id) ON DELETE CASCADE,
  line_number                   int NOT NULL,
  material_id                   uuid NOT NULL,
  material_type                 text NULL,
  source_storage_location_id    uuid NOT NULL,
  target_storage_location_id    uuid NULL,
  quantity                      numeric(20,6) NOT NULL CHECK (quantity > 0),
  uom_code                      text NOT NULL,
  valuation_rate                numeric(20,6) NOT NULL DEFAULT 0,
  issue_stock_document_id       uuid NULL,
  receipt_stock_document_id     uuid NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transfer_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_returnable_transfer_line_transfer
  ON erp_procurement.returnable_transfer_line (transfer_id);
CREATE INDEX IF NOT EXISTS idx_returnable_transfer_line_material
  ON erp_procurement.returnable_transfer_line (material_id);

GRANT SELECT, INSERT, UPDATE ON erp_procurement.returnable_transfer TO service_role;
GRANT SELECT, INSERT, UPDATE ON erp_procurement.returnable_transfer_line TO service_role;

-- ── posting_source_registry — CLAUDE.md 8D gate ────────────────────────────────────
-- No suspect status: both CREATE and RECEIVE actions write header/line + their stock
-- posting atomically via post_document, so there is no observable in-between window to
-- flag. 'TRANSFERRED' is a legitimate, long-lived state (goods genuinely in transit,
-- can sit for days before Receive) that already has its own posting by design — not a
-- stuck transaction, so it must NOT be a suspect status (would false-positive forever).
INSERT INTO erp_inventory.posting_source_registry (
  reference_document_type, label, source_schema, source_table, status_column,
  suspect_statuses, completion_schema, completion_function, notes
) VALUES (
  'RETURNABLE_TRANSFER',
  'PO12 Tab 2 — Returnable Material Transfer',
  'erp_procurement', 'returnable_transfer', 'status',
  ARRAY[]::text[],
  'erp_procurement', 'complete_returnable_transfer_action',
  'CLAUDE.md / PROCUREMENT-DESIGN-DOC.md lock 2026-10-05. TRANSFERRED is intentionally not suspect (see migration header comment).'
)
ON CONFLICT (reference_document_type) DO NOTHING;

-- ── complete_returnable_transfer_action — business writes inside post_document's
-- transaction (CLAUDE.md 8D). One function, two actions (CREATE / RECEIVE), dispatched
-- by p_context->>'action' — same shape as erp_procurement.complete_pgi_invoice_action.
--
-- Movement JSON contract (set by the TS caller, see returnable_transfer.handlers.ts):
--   each movement carries line_ref = '<line_number>_out' or '<line_number>_in' so this
--   function can map a posted stock_document_id back to the right business line.
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

  ELSE
    RAISE EXCEPTION 'RETURNABLE_TRANSFER_UNKNOWN_ACTION: %', v_action;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION erp_procurement.complete_returnable_transfer_action(uuid, jsonb, jsonb) IS
  'PO12 Tab 2 business writes, called by post_document() inside the same transaction as the P303/P305 postings (CLAUDE.md 8D). 2026-10-05 lock.';

REVOKE ALL ON FUNCTION erp_procurement.complete_returnable_transfer_action(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.complete_returnable_transfer_action(uuid, jsonb, jsonb) TO service_role;

COMMIT;
