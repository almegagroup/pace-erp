-- Phase D (§3.7 Point 3.3 + Bulk GE-Creation Drawer design, business-owner session
-- 2026-09-28..30). Adds:
-- 1) Bulk-only Effective Start Date + Cutoff Date on purchase_order/stock_transfer_order --
--    the document-date-based validity window that replaces knock-off as the real gate for
--    whether a vendor's Challan/Invoice can post against a Bulk PO/STO. Resolves the
--    in-transit-orphaned-on-knock-off gap (knockOffPOLineHandler has no CSN-based safeguard
--    for Bulk, unlike the CSN path's eligibleStatuses:["ORD"] check).
-- 2) gate_entry.person_name -- who is physically filling the GE (general GE feature, not
--    Bulk-only).
-- 3) gate_entry_line.bulk_* -- Bulk-specific reference fields captured at GE since Bulk has
--    no CSN to carry them (Challan/Invoice/Container/Ewaybill number, paired dates, LR
--    number). Carries forward to GRN unchanged.

BEGIN;

ALTER TABLE erp_procurement.purchase_order
  ADD COLUMN effective_start_date date NULL,
  ADD COLUMN cutoff_date date NULL;

COMMENT ON COLUMN erp_procurement.purchase_order.effective_start_date IS
'Bulk-only (delivery_type=BULK), mandatory for that type, editable any time post-approval
(same as CRCP). Window start for validating a vendor document (Challan/Invoice) date at GE --
window end is the next PO''s effective_start_date for the same (vendor_id, company_id,
material), or this PO''s own cutoff_date if knocked off with no successor yet.';

COMMENT ON COLUMN erp_procurement.purchase_order.cutoff_date IS
'Bulk-only. Set at manual knock-off when no successor PO (same vendor+company+material, later
effective_start_date) exists yet -- bounds this PO''s document-date validity window instead of
leaving it open-ended.';

ALTER TABLE erp_procurement.stock_transfer_order
  ADD COLUMN effective_start_date date NULL,
  ADD COLUMN cutoff_date date NULL;

COMMENT ON COLUMN erp_procurement.stock_transfer_order.effective_start_date IS
'Bulk-only (delivery_type=BULK). Same mechanism as purchase_order.effective_start_date,
grouped by (sending_company_id, receiving_company_id, material) instead of vendor -- STO has
no external vendor.';

COMMENT ON COLUMN erp_procurement.stock_transfer_order.cutoff_date IS
'Bulk-only. Same mechanism as purchase_order.cutoff_date.';

ALTER TABLE erp_procurement.gate_entry
  ADD COLUMN person_name text NULL;

COMMENT ON COLUMN erp_procurement.gate_entry.person_name IS
'Who is physically filling this GE (all GE types, not Bulk-only). Non-Security department:
auto-filled read-only with the logged-in user''s own name. Security department: left blank for
manual entry -- mandatory (handler-enforced) before line entry can proceed, since Security
terminals are commonly shared logins across shifts.';

ALTER TABLE erp_procurement.gate_entry_line
  ADD COLUMN bulk_challan_number text NULL,
  ADD COLUMN bulk_challan_date date NULL,
  ADD COLUMN bulk_invoice_number text NULL,
  ADD COLUMN bulk_invoice_date date NULL,
  ADD COLUMN bulk_container_number text NULL,
  ADD COLUMN bulk_ewaybill_number text NULL,
  ADD COLUMN bulk_lr_number text NULL;

COMMENT ON COLUMN erp_procurement.gate_entry_line.bulk_challan_number IS
'Bulk-only GE capture (Bulk has no CSN to carry these). At least one of bulk_challan_number /
bulk_invoice_number / bulk_container_number / bulk_ewaybill_number is mandatory
(handler-enforced). Carries forward to GRN unchanged.';

COMMENT ON COLUMN erp_procurement.gate_entry_line.bulk_challan_date IS
'Mandatory whenever bulk_challan_number is filled.';

COMMENT ON COLUMN erp_procurement.gate_entry_line.bulk_invoice_number IS
'See bulk_challan_number -- one of the four identifier fields.';

COMMENT ON COLUMN erp_procurement.gate_entry_line.bulk_invoice_date IS
'Mandatory whenever bulk_invoice_number is filled.';

COMMENT ON COLUMN erp_procurement.gate_entry_line.bulk_container_number IS
'Captured now; master-list mapping/cross-tally against this is Phase 2 (§3.6), not this
phase.';

COMMENT ON COLUMN erp_procurement.gate_entry_line.bulk_lr_number IS
'Bulk-only, optional (no mandatory pairing, unlike the other bulk_* identifier fields) --
carries forward to GRN if filled.';

COMMIT;
