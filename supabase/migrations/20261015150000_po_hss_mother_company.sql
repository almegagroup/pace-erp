-- High Sea Sale (HSS) with a Mother Company (business owner, 2026-10-15).
--
-- Some suppliers sell to PACE on High Sea Sale through their Indian entity
-- (e.g. Nouryon Asia bills Nouryon India, Nouryon India bills PACE). The PO is
-- raised on the Indian entity -- the party PACE pays, often a DOMESTIC vendor
-- in Vendor Master -- but the goods are imported: customs, CHA and the import
-- CSN flow all apply, and the lead time is the shipping time of the overseas
-- "Mother Company", not the Indian entity's domestic lead time.
--
--   purchase_order.hss_mother_vendor_id     Mother Company chosen on the PO
--   consignment_note.hss_mother_vendor_id   copied from the PO; the import lead
--                                           time (lead_time_master_import) is
--                                           looked up on this vendor + port
--   vendor_master.default_hss_mother_vendor_id
--                                           pre-fills the Mother Company, but
--                                           only when the PO is marked HSS
--
-- An HSS PO is stored as vendor_type = 'IMPORT' with
-- import_trade_type = 'HIGH_SEA_SALE', whatever the vendor's own type is.

ALTER TABLE erp_master.vendor_master
  ADD COLUMN IF NOT EXISTS default_hss_mother_vendor_id uuid NULL
    REFERENCES erp_master.vendor_master(id);

ALTER TABLE erp_procurement.purchase_order
  ADD COLUMN IF NOT EXISTS hss_mother_vendor_id uuid NULL
    REFERENCES erp_master.vendor_master(id);

ALTER TABLE erp_procurement.consignment_note
  ADD COLUMN IF NOT EXISTS hss_mother_vendor_id uuid NULL
    REFERENCES erp_master.vendor_master(id);

ALTER TABLE erp_master.vendor_master
  DROP CONSTRAINT IF EXISTS ck_vendor_default_hss_mother_not_self;
ALTER TABLE erp_master.vendor_master
  ADD CONSTRAINT ck_vendor_default_hss_mother_not_self
  CHECK (default_hss_mother_vendor_id IS NULL OR default_hss_mother_vendor_id <> id);

ALTER TABLE erp_procurement.purchase_order
  DROP CONSTRAINT IF EXISTS ck_po_hss_mother_requires_hss;
ALTER TABLE erp_procurement.purchase_order
  ADD CONSTRAINT ck_po_hss_mother_requires_hss
  CHECK (hss_mother_vendor_id IS NULL OR import_trade_type = 'HIGH_SEA_SALE');

CREATE INDEX IF NOT EXISTS idx_purchase_order_hss_mother_vendor
  ON erp_procurement.purchase_order (hss_mother_vendor_id)
  WHERE hss_mother_vendor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_consignment_note_hss_mother_vendor
  ON erp_procurement.consignment_note (hss_mother_vendor_id)
  WHERE hss_mother_vendor_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
