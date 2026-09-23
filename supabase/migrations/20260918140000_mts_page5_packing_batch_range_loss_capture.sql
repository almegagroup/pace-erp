-- §138.16 (2026-09-18) — MTS Page 5: Packing PO batch-range planning + loss capture.
--
-- packing_order.batch_number_from/batch_number_to: a Page 5 row (which becomes
-- one Packing PO) can cover a SUB-RANGE of its parent Process PO's own declared
-- batch range (e.g. batches 1-6 of a 40-batch Process PO packed as 20 KG bags).
-- The existing packing_order.batch_number (singular) column stays as-is and
-- unused for MTS at Create time -- same "chosen/confirmed at Final" convention
-- MTO/HPS already uses on packing_order_line.batch_number, since the exact
-- per-physical-batch SFG allocation only firms up once those batches are
-- actually produced/verified.
--
-- process_order.planned_loss_qty/planned_loss_reason: Page 5's "Consider Loss"
-- capture (business owner lock 2026-09-18) -- pure data capture at planning
-- time, before the SFG is even produced. The actual write-off POSTING
-- mechanism is explicitly deferred to a later Process PO Verify redesign
-- session for MTS; this column only holds the declared qty/reason until then.
BEGIN;

ALTER TABLE erp_production.packing_order
  ADD COLUMN IF NOT EXISTS batch_number_from text NULL,
  ADD COLUMN IF NOT EXISTS batch_number_to text NULL;

ALTER TABLE erp_production.process_order
  ADD COLUMN IF NOT EXISTS planned_loss_qty numeric NULL,
  ADD COLUMN IF NOT EXISTS planned_loss_reason text NULL;

ALTER TABLE erp_production.process_order
  ADD CONSTRAINT process_order_planned_loss_qty_check
  CHECK (planned_loss_qty IS NULL OR planned_loss_qty >= 0);

COMMENT ON COLUMN erp_production.packing_order.batch_number_from IS
  'MTS Page 5 planning: first Process-PO batch number this Packing PO covers. NULL for MTO/HPS/MTEST (single-batch, unchanged).';
COMMENT ON COLUMN erp_production.packing_order.batch_number_to IS
  'MTS Page 5 planning: last Process-PO batch number this Packing PO covers (inclusive). NULL for MTO/HPS/MTEST.';
COMMENT ON COLUMN erp_production.process_order.planned_loss_qty IS
  '§138.16 Consider-Loss: qty of the planned SFG output the user explicitly accepted as not being planned for any Packing PO at Page 5 time. Data capture only -- no stock/costing effect until the Verify redesign (deferred) defines the posting mechanism.';

NOTIFY pgrst, 'reload schema';
COMMIT;
