-- AC01 saves may revise a GRN's landed cost repeatedly as invoices and charges arrive.
-- The 2026-08-21 function removed the one-time correction guard, but its older
-- unique audit-log index remained and still rejected a second valid correction.
-- Keep the append-only audit trail while allowing multiple entries per target ledger row.

DROP INDEX IF EXISTS erp_inventory.ux_valuation_correction_log_target;

CREATE INDEX IF NOT EXISTS idx_valuation_correction_log_target_ledger
  ON erp_inventory.valuation_correction_log (target_ledger_id)
  WHERE target_ledger_id IS NOT NULL;

COMMENT ON INDEX erp_inventory.idx_valuation_correction_log_target_ledger IS
  'Supports repeatable AC01 valuation-correction audit reads; target ledger IDs are intentionally non-unique.';
