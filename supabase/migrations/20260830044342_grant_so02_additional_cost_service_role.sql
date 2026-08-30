-- §133.13 created these tables after the schema-wide bootstrap grant.  The
-- API uses the service-role client for the category lookup/create and for the
-- invoice posting validation, so both tables need the same CRUD grant as the
-- existing sales-invoice tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE erp_procurement.additional_cost_category TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE erp_procurement.sales_invoice_additional_cost_line TO service_role;
