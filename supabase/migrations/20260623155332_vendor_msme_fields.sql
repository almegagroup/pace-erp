-- Optional, non-mandatory MSME registration fields on Vendor Master.
-- Can be filled in any time after creation.

ALTER TABLE erp_master.vendor_master
  ADD COLUMN msme_registered boolean NULL,
  ADD COLUMN msme_certificate_number text NULL;

COMMENT ON COLUMN erp_master.vendor_master.msme_registered IS
'Optional — whether this vendor is MSME registered. NULL = not specified.';
COMMENT ON COLUMN erp_master.vendor_master.msme_certificate_number IS
'Optional — MSME registration certificate number, if msme_registered = true.';
