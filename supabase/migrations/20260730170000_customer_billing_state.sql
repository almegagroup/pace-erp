-- §113 Stage 3 (GST design session, 2026-07-30): deriveSalesInvoiceGstType()
-- decided CGST+SGST vs IGST purely from GSTIN state-code prefix. An
-- unregistered customer has no GSTIN, so the state code was always empty on
-- their side, which made the comparison always fail and fall through to
-- IGST -- wrong for an unregistered customer physically in the same state
-- as the selling company. Place of supply must be derived from the
-- customer's own registered state, not their GST registration status.
-- Mirrors erp_master.companies.state_name (plain text, same style) --
-- customer_master's address model is simpler than vendor_master's
-- reg/corr split, so one field is enough here.

ALTER TABLE erp_master.customer_master
  ADD COLUMN billing_state text;
