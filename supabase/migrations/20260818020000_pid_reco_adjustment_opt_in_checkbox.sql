-- §119.14.1 correction (2026-08-18) -- reverses §119.14's "no flag, always
-- proportional" decision. Small residual leftovers on batch-tracked SFG/FG
-- are normal and will keep happening; forcing a proportional RM/PM/INT reco
-- adjustment on every single one is too aggressive. New per-item opt-in:
-- MI07 only cascades to reco when the poster explicitly ticks it for that row.

BEGIN;

ALTER TABLE erp_procurement.physical_inventory_item
  ADD COLUMN IF NOT EXISTS apply_reco_adjustment boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN erp_procurement.physical_inventory_item.apply_reco_adjustment IS
  '§119.14.1 -- when true AND this item is batch-tracked SFG/FG, MI07 post cascades a proportional RM/PM/INT process_order_line_reco/packing_order_line_reco adjustment. Default false: post only moves the SFG/FG stock itself, reco untouched. Ignored for non-batch-tracked / RM/PM/INT / MTS-typed rows.';

COMMIT;
