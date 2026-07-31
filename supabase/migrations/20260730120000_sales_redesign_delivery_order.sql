-- Section 113 (Sales Module Redesign) — Task E: Delivery Order (DO)
-- Extends the existing delivery_challan/_line tables into the shared
-- RM/PM/INT DO for both SO and STO (§113.3) rather than a new parallel
-- table. Cost Center is header-level (§113 lock); Storage Location is
-- per-line (chosen at DO time, not at SO/STO Create — §113.8).

ALTER TABLE erp_procurement.delivery_challan
  ADD COLUMN cost_center_id uuid NULL;

ALTER TABLE erp_procurement.delivery_challan_line
  ADD COLUMN storage_location_id uuid NULL;

ALTER TABLE erp_procurement.delivery_challan_line
  ADD CONSTRAINT delivery_challan_line_storage_location_id_fkey
  FOREIGN KEY (storage_location_id) REFERENCES erp_inventory.storage_location_master(id);

-- §113 CSN-sync design: DO save auto-captures dispatch qty into the linked
-- CSN (mirrors gate_entry.handlers.ts's upsertCsnArrival on the receiving
-- side, via a new upsertCsnDispatch()). total_received_qty already
-- accumulates on the receiving side; total_dispatch_qty is its counterpart
-- on the dispatch side — dispatch_qty alone has no running-total column.
ALTER TABLE erp_procurement.consignment_note
  ADD COLUMN total_dispatch_qty numeric NULL DEFAULT 0;
