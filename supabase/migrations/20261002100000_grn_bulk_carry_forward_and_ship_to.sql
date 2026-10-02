-- §3.9.2 "GRN Invoice Mapping" + Point 3.2.7 "GRN-level Ship To Leg capture"
-- (business-owner design session, 2026-10-01..02). Adds:
-- 1) Bulk-only carry-forward columns on goods_receipt -- fields captured at GE
--    (Phase D's bulk_* columns on gate_entry_line) that have no existing GRN
--    equivalent (Challan/Container/Ewaybill, RST Number). Invoice Number/Date/
--    Rate/LR Number/LR Date reuse the GRN's own existing columns (already
--    nullable) -- no duplicate columns needed for those.
-- 2) ship_to_company_id -- CRCP-general (any delivery_type), captures which
--    company the vendor's physical invoice actually names as Ship-To, distinct
--    from the PO/STO's own Bill-To company and from the GRN's own receiving
--    company.

BEGIN;

ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN bulk_challan_number text NULL,
  ADD COLUMN bulk_challan_date date NULL,
  ADD COLUMN bulk_container_number text NULL,
  ADD COLUMN bulk_ewaybill_number text NULL,
  ADD COLUMN rst_number text NULL,
  ADD COLUMN ship_to_company_id uuid NULL;

COMMENT ON COLUMN erp_procurement.goods_receipt.bulk_challan_number IS
'Bulk-only, carried forward from gate_entry_line.bulk_challan_number at GRN creation --
no re-entry. See gate_entry_line.bulk_challan_number for the mandatory-identifier rule.';

COMMENT ON COLUMN erp_procurement.goods_receipt.bulk_challan_date IS
'Bulk-only, carried forward from gate_entry_line.bulk_challan_date.';

COMMENT ON COLUMN erp_procurement.goods_receipt.bulk_container_number IS
'Bulk-only, carried forward from gate_entry_line.bulk_container_number.';

COMMENT ON COLUMN erp_procurement.goods_receipt.bulk_ewaybill_number IS
'Bulk-only, carried forward from gate_entry_line.bulk_ewaybill_number.';

COMMENT ON COLUMN erp_procurement.goods_receipt.rst_number IS
'Carried forward from gate_entry_line.rst_number (not Bulk-specific as a concept, but
only populated today via the Bulk GE-Creation Drawer). Distinct from
gate_exit_inbound.rst_number_tare (Tare weighing, captured later at Gate Exit).';

COMMENT ON COLUMN erp_procurement.goods_receipt.ship_to_company_id IS
'CRCP-general (§3.2.7) -- the company the vendor''s physical invoice actually names as
Ship-To. Plain uuid, no FK (cross-schema reference to companies, same convention as
goods_receipt.company_id/vendor_id). Mandatory whenever the source PO/STO has
crcp_enabled=true (handler-enforced); must be either the PO/STO''s own issuing company or
one of its CRCP-allowed companies. NULL/unused when crcp_enabled=false.';

COMMIT;
