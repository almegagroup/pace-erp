-- AC01 GRN Landed Cost Hub — three real gaps found live 2026-08-21 by the business owner:
--
-- 1. `revised_payment_date` was read/written by the frontend and by
--    buildListRow(), but the column never existed on goods_receipt at all —
--    the field silently did nothing (saveAC01GRNCostHandler never even sent
--    it to the RPC, and the RPC has no parameter for it either).
--
-- 2. No per-party (Vendor / Transporter / Last Mile Transporter) payable
--    breakdown exists — every cost line and deduction line was generic, with
--    no way to say which of the three parties it's actually owed to. Only a
--    single blended "Vendor Payable" (material cost only) existed.
--
-- 3. No overwrite mechanism for the three parties' payables, mirroring the
--    existing "Confirmed Rate" overwrite pattern for the vendor's material
--    rate.

ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN revised_payment_date date,
  ADD COLUMN vendor_payable_override numeric,
  ADD COLUMN transporter_payable_override numeric,
  ADD COLUMN last_mile_payable_override numeric;

-- party_type on cost lines: which of the three parties this specific charge
-- is owed to. Duty/finance-type lines default to VENDOR (their invoice/bill
-- typically flows through the vendor in this business), Freight/CHA-type
-- lines default to TRANSPORTER, Last-Mile-specific lines default to
-- LAST_MILE_TRANSPORTER -- all defaults are just a starting suggestion, the
-- user can always override via the party dropdown.
ALTER TABLE erp_procurement.landed_cost_line
  ADD COLUMN party_type text NOT NULL DEFAULT 'VENDOR'
    CHECK (party_type IN ('VENDOR', 'TRANSPORTER', 'LAST_MILE_TRANSPORTER'));

-- party_type on deduction lines: same three-way choice, defaults to VENDOR
-- (the common case, e.g. TDS on the vendor's own payment) but a deduction
-- can equally apply against a Transporter's or Last Mile Transporter's
-- payable (e.g. TDS u/s 194C on a transport/contractor payment).
ALTER TABLE erp_procurement.landed_cost_deduction_line
  ADD COLUMN party_type text NOT NULL DEFAULT 'VENDOR'
    CHECK (party_type IN ('VENDOR', 'TRANSPORTER', 'LAST_MILE_TRANSPORTER'));
