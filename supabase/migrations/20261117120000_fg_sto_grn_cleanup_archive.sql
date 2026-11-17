-- Archive for the 2026-11-17 FG STO GE/GRN clean-up (prod, CMP005 receipts of CMP003 FG STOs):
--   * the two GE/GRN chains of STOs ASCS2627-0015 / ASCS2627-0016 (November LR) are deleted outright;
--   * the GE/GRN dates of the three October STOs are moved to LR date + 5 days.
-- Every row deleted or edited is first copied here as JSON so the change can be inspected or rebuilt.
-- Service-role only: it holds stock and financial rows and is never exposed through the API.

CREATE TABLE IF NOT EXISTS erp_history.fg_sto_grn_cleanup_20261117 (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_table text        NOT NULL,
  source_key   text,
  row_data     jsonb       NOT NULL,
  archived_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_history.fg_sto_grn_cleanup_20261117 IS
  'Pre-change copy of every row deleted or edited by the 2026-11-17 FG STO GE/GRN clean-up (CMP005): gate_entry, gate_entry_line, gate_exit_inbound, goods_receipt, stock_document, stock_ledger, stock_snapshot, consignment_note, stock_transfer_order_line, counters.';

ALTER TABLE erp_history.fg_sto_grn_cleanup_20261117 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON erp_history.fg_sto_grn_cleanup_20261117 FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON erp_history.fg_sto_grn_cleanup_20261117 TO service_role;

NOTIFY pgrst, 'reload schema';
