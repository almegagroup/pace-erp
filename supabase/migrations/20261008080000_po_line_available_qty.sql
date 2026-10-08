-- Section 145 -- PO-line "available for Gate Entry" quantity, the same arithmetic the Bulk GE
-- drawer already uses (open_qty minus active Gate Entry lines that have no DRAFT/POSTED GRN yet),
-- as one reusable function. Lets the GRN screen show "PO balance" without re-deriving it in TS,
-- and leave the GE line currently being received out of the reserved total (a GRN must not
-- subtract its own Gate Entry from the balance it is about to consume).

BEGIN;

CREATE OR REPLACE FUNCTION erp_procurement.po_line_available_qty(
  p_po_line_id uuid,
  p_exclude_ge_line_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = erp_procurement, public
AS $$
  SELECT GREATEST(
    0,
    COALESCE(l.open_qty, l.ordered_qty) - COALESCE((
      SELECT sum(gl.ge_qty)
      FROM erp_procurement.gate_entry_line gl
      JOIN erp_procurement.gate_entry h ON h.id = gl.gate_entry_id
      WHERE gl.po_line_id = l.id
        AND h.status NOT IN ('CANCELLED', 'PRUNED')
        AND (p_exclude_ge_line_id IS NULL OR gl.id <> p_exclude_ge_line_id)
        AND NOT EXISTS (
          SELECT 1 FROM erp_procurement.goods_receipt g
          WHERE COALESCE(g.gate_entry_line_id, g.source_gate_entry_line_id) = gl.id
            AND g.status IN ('DRAFT', 'POSTED')
        )
    ), 0)
  )::numeric
  FROM erp_procurement.purchase_order_line l
  WHERE l.id = p_po_line_id;
$$;

GRANT EXECUTE ON FUNCTION erp_procurement.po_line_available_qty(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
