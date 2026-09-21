-- MTS Verify is the one irreversible transaction after Pages 1-6 (and, for a
-- non-current Stroke, QA Approval).  MTS has no physical SFG stock: its linked
-- PMTS Packing POs declare SKU output, so Verify issues RM+PM, receives SKU and
-- optionally transfers that SKU to QI/Blocked in one post_document transaction.

CREATE TABLE IF NOT EXISTS erp_production.mts_verify_check (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  process_order_id uuid NOT NULL REFERENCES erp_production.process_order(id) ON DELETE CASCADE,
  check_code text NOT NULL,
  checked_by uuid NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mts_verify_check_unique UNIQUE (process_order_id, check_code)
);

CREATE TABLE IF NOT EXISTS erp_production.mts_verify_hold_allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  process_order_id uuid NOT NULL REFERENCES erp_production.process_order(id) ON DELETE CASCADE,
  packing_order_id uuid NOT NULL REFERENCES erp_production.packing_order(id) ON DELETE RESTRICT,
  batch_number_from text NOT NULL,
  batch_number_to text NOT NULL,
  batch_number text NOT NULL,
  sku_material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  target_stock_type text NOT NULL CHECK (target_stock_type IN ('QUALITY_INSPECTION', 'BLOCKED')),
  declared_pack_qty numeric NOT NULL CHECK (declared_pack_qty >= 0),
  held_pack_qty numeric NOT NULL CHECK (held_pack_qty > 0),
  qty_kg numeric NOT NULL CHECK (qty_kg > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mts_verify_hold_process_order
  ON erp_production.mts_verify_hold_allocation(process_order_id, batch_number);

GRANT ALL ON erp_production.mts_verify_check TO service_role;
GRANT ALL ON erp_production.mts_verify_hold_allocation TO service_role;

-- Page 6 historically created a virtual SFG reservation for its PMTS child.
-- MTS has no physical SFG receipt, so the virtual line must never reduce the
-- usable-stock balance. Existing rows are released here; a following migration
-- installs the trigger that cancels future virtual reservations in their creating
-- transaction. PM reservations remain active as before.
UPDATE erp_production.reservation_document AS rd
SET status = 'CANCELLED', last_updated_at = now()
FROM erp_production.packing_order_line AS pol
JOIN erp_production.packing_order AS pko ON pko.id = pol.packing_order_id
JOIN erp_production.process_order AS po ON po.id = pko.process_order_id
WHERE rd.source_type = 'PACKING_PO'
  AND rd.source_line_id = pol.id
  AND po.po_type = 'MTS'
  AND pol.line_type = 'SFG'
  AND rd.status IN ('OPEN', 'PARTIAL');
