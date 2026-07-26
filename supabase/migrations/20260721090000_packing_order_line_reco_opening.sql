-- Widen packing_order_line_reco.source_txn_type to match process_order_line_reco's
-- own CHECK (PRODUCTION, RETURN, PARTIAL_REVERSAL, COR6_CORRECTION, OPENING).
-- Immediate need: PR23 "Old Packing PO" (§104.9) writes OPENING rows for pre-go-live
-- FG batches, mirroring PR22's own process_order_line_reco write. RETURN/
-- PARTIAL_REVERSAL added now too so a future Packing-PO-side PR19/Return extension
-- doesn't need another migration just for this CHECK.

ALTER TABLE erp_production.packing_order_line_reco
  DROP CONSTRAINT packing_order_line_reco_source_txn_type_check;

ALTER TABLE erp_production.packing_order_line_reco
  ADD CONSTRAINT packing_order_line_reco_source_txn_type_check
  CHECK (source_txn_type IN ('PRODUCTION', 'RETURN', 'PARTIAL_REVERSAL', 'COR6_CORRECTION', 'OPENING'));
