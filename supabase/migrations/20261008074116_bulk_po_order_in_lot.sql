-- ============================================================================
-- Section 145 (feasibility doc) -- Bulk PO "Order in LOT"
--
-- A Bulk PO flagged order_in_lot is ordered lot by lot: the first lot becomes the
-- PO, every later lot is added through "Lot Amend" and goes through the normal PO
-- approval before it counts. Gate Entry / GRN / AC01 then work against a lot
-- number. Rate, GST, CRCP, cutoff and effective date are untouched.
--
--   * purchase_order.order_in_lot            -- the flag (BULK only, set at create)
--   * purchase_order_lot                      -- one row per lot per PO line
--   * gate_entry_line.lot_number              -- the lot a truck is received against
--   * normalize_lot_number()                  -- "1" / "01" / "0001" are the same lot
--   * po_lot_balances()                       -- lot balance, mirrors the PO-level
--                                                 "open - GE-not-yet-GRN'd" arithmetic
--   * add_po_lots() / activate_pending_po_lots() / reject_pending_po_lots()
--                                             -- the lot-amend lifecycle, each ONE
--                                                transaction (CLAUDE.md 8D)
-- ============================================================================

BEGIN;

-- ── 1. Flag on the PO ───────────────────────────────────────────────────────
ALTER TABLE erp_procurement.purchase_order
  ADD COLUMN IF NOT EXISTS order_in_lot boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'erp_procurement.purchase_order'::regclass
      AND conname = 'purchase_order_order_in_lot_bulk_only_check'
  ) THEN
    ALTER TABLE erp_procurement.purchase_order
      ADD CONSTRAINT purchase_order_order_in_lot_bulk_only_check
      CHECK (NOT order_in_lot OR delivery_type = 'BULK');
  END IF;
END $$;

COMMENT ON COLUMN erp_procurement.purchase_order.order_in_lot IS
  'Section 145 -- Bulk PO ordered lot by lot. Set at create only; ordered_qty then always equals the sum of ACTIVE lot_qty.';

-- ── 2. Lots ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.purchase_order_lot (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id             uuid NOT NULL REFERENCES erp_procurement.purchase_order(id) ON DELETE CASCADE,
  po_line_id        uuid NOT NULL REFERENCES erp_procurement.purchase_order_line(id) ON DELETE CASCADE,
  lot_number        text NOT NULL,
  lot_qty           numeric(20,6) NOT NULL,
  delivery_date     date NOT NULL,
  status            text NOT NULL DEFAULT 'PENDING',
  -- NULL for the original lot (created with the PO); the po_amendment_log
  -- amendment_number that added it for every later lot (drives "NEW" on the print).
  amendment_number  integer NULL,
  created_by        uuid NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  approved_by       uuid NULL,
  approved_at       timestamptz NULL,
  CONSTRAINT purchase_order_lot_number_format_check CHECK (lot_number ~ '^[0-9]{4}$' AND lot_number <> '0000'),
  CONSTRAINT purchase_order_lot_qty_check CHECK (lot_qty > 0),
  CONSTRAINT purchase_order_lot_status_check CHECK (status IN ('PENDING', 'ACTIVE', 'REJECTED')),
  CONSTRAINT purchase_order_lot_unique_number UNIQUE (po_line_id, lot_number)
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_lot_po ON erp_procurement.purchase_order_lot (po_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_lot_po_line_status ON erp_procurement.purchase_order_lot (po_line_id, status);

ALTER TABLE erp_procurement.purchase_order_lot ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.purchase_order_lot FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE erp_procurement.purchase_order_lot IS
  'Section 145 -- lots of a Bulk "Order in LOT" PO line. PENDING until the lot-amend is approved; only ACTIVE lots count toward ordered_qty and accept Gate Entry.';

-- ── 3. Gate Entry line carries the lot it is received against ───────────────
ALTER TABLE erp_procurement.gate_entry_line
  ADD COLUMN IF NOT EXISTS lot_number text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'erp_procurement.gate_entry_line'::regclass
      AND conname = 'gate_entry_line_lot_number_format_check'
  ) THEN
    ALTER TABLE erp_procurement.gate_entry_line
      ADD CONSTRAINT gate_entry_line_lot_number_format_check
      CHECK (lot_number IS NULL OR lot_number ~ '^[0-9]{4}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gate_entry_line_po_line_lot
  ON erp_procurement.gate_entry_line (po_line_id, lot_number)
  WHERE lot_number IS NOT NULL;

-- ── 4. Lot number normalisation: "1", "01", "0001" are the same lot ─────────
CREATE OR REPLACE FUNCTION erp_procurement.normalize_lot_number(p_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN btrim(coalesce(p_input, '')) ~ '^[0-9]{1,4}$'
      AND btrim(p_input)::int > 0
    THEN lpad(btrim(p_input), 4, '0')
    ELSE NULL
  END;
$$;

-- ── 5. Lot balances (same arithmetic as the PO-level Bulk GE balance) ───────
-- received  = POSTED GRNs received against GE lines carrying the lot
-- reserved  = active (not cancelled/pruned) GE lines carrying the lot that have
--             no DRAFT/POSTED GRN yet -- pass p_exclude_ge_line_id to leave one
--             GE line out (a GRN being posted must not subtract its own GE).
CREATE OR REPLACE FUNCTION erp_procurement.po_lot_balances(
  p_po_line_ids uuid[],
  p_exclude_ge_line_id uuid DEFAULT NULL
)
RETURNS TABLE (
  po_line_id uuid,
  lot_id uuid,
  lot_number text,
  lot_qty numeric,
  delivery_date date,
  status text,
  amendment_number integer,
  received_qty numeric,
  reserved_qty numeric,
  balance_qty numeric
)
LANGUAGE sql
STABLE
SET search_path = erp_procurement, public
AS $$
  SELECT
    l.po_line_id,
    l.id,
    l.lot_number,
    l.lot_qty,
    l.delivery_date,
    l.status,
    l.amendment_number,
    COALESCE(rcv.qty, 0)::numeric,
    COALESCE(rsv.qty, 0)::numeric,
    GREATEST(0, l.lot_qty - COALESCE(rcv.qty, 0) - COALESCE(rsv.qty, 0))::numeric
  FROM erp_procurement.purchase_order_lot l
  LEFT JOIN LATERAL (
    SELECT sum(g.received_qty) AS qty
    FROM erp_procurement.goods_receipt g
    JOIN erp_procurement.gate_entry_line gl
      ON gl.id = COALESCE(g.gate_entry_line_id, g.source_gate_entry_line_id)
    WHERE g.status = 'POSTED'
      AND gl.po_line_id = l.po_line_id
      AND gl.lot_number = l.lot_number
  ) rcv ON true
  LEFT JOIN LATERAL (
    SELECT sum(gl.ge_qty) AS qty
    FROM erp_procurement.gate_entry_line gl
    JOIN erp_procurement.gate_entry h ON h.id = gl.gate_entry_id
    WHERE gl.po_line_id = l.po_line_id
      AND gl.lot_number = l.lot_number
      AND h.status NOT IN ('CANCELLED', 'PRUNED')
      AND (p_exclude_ge_line_id IS NULL OR gl.id <> p_exclude_ge_line_id)
      AND NOT EXISTS (
        SELECT 1 FROM erp_procurement.goods_receipt g2
        WHERE COALESCE(g2.gate_entry_line_id, g2.source_gate_entry_line_id) = gl.id
          AND g2.status IN ('DRAFT', 'POSTED')
      )
  ) rsv ON true
  WHERE l.po_line_id = ANY (p_po_line_ids);
$$;

-- ── 6. Lot Amend: add lots (PENDING) and send the PO for approval ───────────
-- p_lots: [{ "po_line_id": uuid, "qty": number, "delivery_date": "YYYY-MM-DD" }, ...]
-- Lot numbers are assigned here (never typed by a user): next free number per line.
CREATE OR REPLACE FUNCTION erp_procurement.add_po_lots(
  p_po_id uuid,
  p_actor uuid,
  p_lots jsonb,
  p_remarks text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, public
AS $$
DECLARE
  v_po erp_procurement.purchase_order%ROWTYPE;
  v_entry jsonb;
  v_line erp_procurement.purchase_order_line%ROWTYPE;
  v_qty numeric;
  v_date date;
  v_next int;
  v_amend int;
  v_out jsonb := '[]'::jsonb;
  v_lot_number text;
BEGIN
  SELECT * INTO v_po FROM erp_procurement.purchase_order WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROCUREMENT_PO_NOT_FOUND'; END IF;
  IF NOT v_po.order_in_lot THEN RAISE EXCEPTION 'PROCUREMENT_PO_NOT_LOT_ORDER'; END IF;
  IF v_po.status <> 'CONFIRMED' THEN RAISE EXCEPTION 'PROCUREMENT_PO_LOT_AMEND_BLOCKED'; END IF;
  IF jsonb_typeof(p_lots) <> 'array' OR jsonb_array_length(p_lots) = 0 THEN
    RAISE EXCEPTION 'PROCUREMENT_LOT_REQUIRED';
  END IF;
  IF EXISTS (SELECT 1 FROM erp_procurement.purchase_order_lot WHERE po_id = p_po_id AND status = 'PENDING') THEN
    RAISE EXCEPTION 'PROCUREMENT_LOT_AMEND_PENDING';
  END IF;

  SELECT COALESCE(max(amendment_number), 0) + 1 INTO v_amend
  FROM (
    SELECT amendment_number FROM erp_procurement.po_amendment_log WHERE po_id = p_po_id
    UNION ALL
    SELECT amendment_number FROM erp_procurement.purchase_order_lot WHERE po_id = p_po_id AND amendment_number IS NOT NULL
  ) s;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_lots) LOOP
    SELECT * INTO v_line FROM erp_procurement.purchase_order_line
      WHERE id = (v_entry->>'po_line_id')::uuid AND po_id = p_po_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PROCUREMENT_PO_LINE_NOT_FOUND'; END IF;
    IF v_line.line_status IN ('KNOCKED_OFF', 'CANCELLED') THEN
      RAISE EXCEPTION 'PROCUREMENT_PO_LOT_AMEND_BLOCKED';
    END IF;

    v_qty := (v_entry->>'qty')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'PROCUREMENT_LOT_QTY_INVALID'; END IF;
    v_date := NULLIF(v_entry->>'delivery_date', '')::date;
    IF v_date IS NULL THEN RAISE EXCEPTION 'PROCUREMENT_LOT_DELIVERY_DATE_REQUIRED'; END IF;

    SELECT COALESCE(max(lot_number::int), 0) + 1 INTO v_next
    FROM erp_procurement.purchase_order_lot WHERE po_line_id = v_line.id;
    IF v_next > 9999 THEN RAISE EXCEPTION 'PROCUREMENT_LOT_NUMBER_EXHAUSTED'; END IF;
    v_lot_number := lpad(v_next::text, 4, '0');

    INSERT INTO erp_procurement.purchase_order_lot
      (po_id, po_line_id, lot_number, lot_qty, delivery_date, status, amendment_number, created_by)
    VALUES (p_po_id, v_line.id, v_lot_number, v_qty, v_date, 'PENDING', v_amend, p_actor);

    INSERT INTO erp_procurement.po_amendment_log
      (po_id, po_line_id, amendment_number, field_changed, old_value, new_value,
       requires_approval, approval_status, amended_by)
    VALUES (p_po_id, v_line.id, v_amend, 'lot_added', NULL,
            v_lot_number || ' / ' || trim(trailing '.' FROM trim(trailing '0' FROM v_qty::text)) || ' / ' || v_date::text,
            true, 'PENDING', p_actor);

    v_out := v_out || jsonb_build_object('po_line_id', v_line.id, 'lot_number', v_lot_number, 'lot_qty', v_qty, 'delivery_date', v_date);
  END LOOP;

  UPDATE erp_procurement.purchase_order
     SET status = 'PENDING_APPROVAL', last_updated_at = now(), last_updated_by = p_actor
   WHERE id = p_po_id;

  INSERT INTO erp_procurement.po_approval_log (po_id, action, from_status, to_status, remarks, actioned_by)
  VALUES (p_po_id, 'ESCALATED', 'CONFIRMED', 'PENDING_APPROVAL', p_remarks, p_actor);

  RETURN jsonb_build_object('po_id', p_po_id, 'amendment_number', v_amend, 'lots', v_out);
END;
$$;

-- ── 7. Approval: PENDING lots become ACTIVE and the PO line grows ───────────
-- Called from every PO approval path for the POs being approved. A PO with no
-- PENDING lot is a no-op, so it is safe to call unconditionally.
CREATE OR REPLACE FUNCTION erp_procurement.activate_pending_po_lots(
  p_po_ids uuid[],
  p_actor uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, public
AS $$
DECLARE
  v_row record;
  v_line erp_procurement.purchase_order_line%ROWTYPE;
  v_new_ordered numeric;
  v_new_open numeric;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT po_line_id, sum(lot_qty) AS delta
    FROM erp_procurement.purchase_order_lot
    WHERE po_id = ANY (p_po_ids) AND status = 'PENDING'
    GROUP BY po_line_id
  LOOP
    SELECT * INTO v_line FROM erp_procurement.purchase_order_line WHERE id = v_row.po_line_id FOR UPDATE;
    v_new_ordered := v_line.ordered_qty + v_row.delta;
    v_new_open := COALESCE(v_line.open_qty, v_line.ordered_qty) + v_row.delta;

    UPDATE erp_procurement.purchase_order_line
       SET ordered_qty = v_new_ordered,
           open_qty = v_new_open,
           ordered_qty_base_uom = CASE
             WHEN v_line.ordered_qty > 0 AND v_line.ordered_qty_base_uom IS NOT NULL
             THEN round(v_line.ordered_qty_base_uom * v_new_ordered / v_line.ordered_qty, 6)
             ELSE v_line.ordered_qty_base_uom END,
           total_value = round(v_new_ordered * COALESCE(v_line.unit_rate, 0), 4),
           line_status = CASE
             WHEN v_line.line_status IN ('KNOCKED_OFF', 'CANCELLED') THEN v_line.line_status
             WHEN v_new_open <= 0 THEN 'FULLY_RECEIVED'
             WHEN v_new_open < v_new_ordered THEN 'PARTIALLY_RECEIVED'
             ELSE 'OPEN' END,
           last_updated_at = now()
     WHERE id = v_row.po_line_id;
    v_count := v_count + 1;
  END LOOP;

  UPDATE erp_procurement.purchase_order_lot
     SET status = 'ACTIVE', approved_by = p_actor, approved_at = now()
   WHERE po_id = ANY (p_po_ids) AND status = 'PENDING';

  RETURN v_count;
END;
$$;

-- ── 8. Rejection: PENDING lots are discarded, the PO goes back to CONFIRMED ─
-- (a plain amendment reject drops a PO to DRAFT; a live Bulk PO must stay live).
-- Returns the ids of the POs that actually had a pending lot-amend.
CREATE OR REPLACE FUNCTION erp_procurement.reject_pending_po_lots(
  p_po_ids uuid[],
  p_actor uuid,
  p_remarks text
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, public
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT array_agg(DISTINCT po_id) INTO v_ids
  FROM erp_procurement.purchase_order_lot
  WHERE po_id = ANY (p_po_ids) AND status = 'PENDING';

  IF v_ids IS NULL THEN RETURN ARRAY[]::uuid[]; END IF;

  UPDATE erp_procurement.purchase_order_lot
     SET status = 'REJECTED'
   WHERE po_id = ANY (v_ids) AND status = 'PENDING';

  UPDATE erp_procurement.po_amendment_log
     SET approval_status = 'REJECTED', rejection_reason = p_remarks, approved_by = p_actor, approved_at = now()
   WHERE po_id = ANY (v_ids) AND field_changed = 'lot_added' AND approval_status = 'PENDING';

  UPDATE erp_procurement.purchase_order
     SET status = 'CONFIRMED', last_updated_at = now(), last_updated_by = p_actor
   WHERE id = ANY (v_ids) AND status = 'PENDING_APPROVAL';

  INSERT INTO erp_procurement.po_approval_log (po_id, action, from_status, to_status, remarks, actioned_by)
  SELECT id, 'REJECTED', 'PENDING_APPROVAL', 'CONFIRMED', p_remarks, p_actor
  FROM unnest(v_ids) AS id;

  RETURN v_ids;
END;
$$;

REVOKE ALL ON FUNCTION erp_procurement.add_po_lots(uuid, uuid, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_procurement.activate_pending_po_lots(uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_procurement.reject_pending_po_lots(uuid[], uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.add_po_lots(uuid, uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION erp_procurement.activate_pending_po_lots(uuid[], uuid) TO service_role;
GRANT EXECUTE ON FUNCTION erp_procurement.reject_pending_po_lots(uuid[], uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION erp_procurement.po_lot_balances(uuid[], uuid) TO service_role;
GRANT EXECUTE ON FUNCTION erp_procurement.normalize_lot_number(text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
