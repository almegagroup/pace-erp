-- Section 113 (Sales Module Redesign) — Task A
-- Adds gst_category to customer_master, matching vendor_master's existing
-- REGISTERED/UNREGISTERED/COMPOSITION/EXPORT classification (see SAVendorMaster.jsx).
-- gst_number stays a free-text optional field; gst_category is the real
-- "is this customer GST-registered" signal, independent of whether a
-- gst_number happens to be filled in.

ALTER TABLE erp_master.customer_master
  ADD COLUMN gst_category text NULL;

ALTER TABLE erp_master.customer_master
  ADD CONSTRAINT customer_master_gst_category_check
  CHECK (gst_category IS NULL OR gst_category IN ('REGISTERED', 'UNREGISTERED', 'COMPOSITION', 'EXPORT'));
