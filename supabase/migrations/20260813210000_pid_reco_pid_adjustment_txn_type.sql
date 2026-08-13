-- §119.14: PID gain/loss on batch-tracked SFG/FG proportionally adjusts the batch's reco lines
-- (append-only delta rows, matching the existing PARTIAL_REVERSAL/COR6_CORRECTION convention) —
-- needs its own source_txn_type so these rows are distinguishable and so PR19's own ratio-basis
-- query can include them (a future PR19 on a PID-corrected batch must see the corrected total).

ALTER TABLE erp_production.process_order_line_reco
  DROP CONSTRAINT process_order_line_reco_source_txn_type_check;
ALTER TABLE erp_production.process_order_line_reco
  ADD CONSTRAINT process_order_line_reco_source_txn_type_check
  CHECK (source_txn_type IN ('PRODUCTION', 'RETURN', 'PARTIAL_REVERSAL', 'COR6_CORRECTION', 'OPENING', 'PID_ADJUSTMENT'));

ALTER TABLE erp_production.packing_order_line_reco
  DROP CONSTRAINT packing_order_line_reco_source_txn_type_check;
ALTER TABLE erp_production.packing_order_line_reco
  ADD CONSTRAINT packing_order_line_reco_source_txn_type_check
  CHECK (source_txn_type IN ('PRODUCTION', 'RETURN', 'PARTIAL_REVERSAL', 'COR6_CORRECTION', 'OPENING', 'PID_ADJUSTMENT'));
