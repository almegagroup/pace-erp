-- Sub-CSNs need to record which company they are destined for, distinct
-- from the mother CSN's own company_id (the importing/buying company).
-- Without this, a sub-CSN created for distribution to another company
-- never shows up in that company's procurement planning view, since
-- planning resolves a CSN's company via its mother PO's company_id.
-- Null for ordinary (non-distributed) CSNs.

ALTER TABLE erp_procurement.consignment_note
  ADD COLUMN consignee_company_id uuid REFERENCES erp_master.companies(id);
