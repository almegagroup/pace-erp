-- Root cause of the recurring "PROCUREMENT_PO_ORDER_GROUP_CREATE_FAILED"
-- 500 on PO Create save: erp_procurement.po_order_group was created
-- without the GRANTs that every sibling table (e.g. purchase_order) has
-- for service_role/authenticated. Postgres returned 42501
-- "permission denied for table po_order_group" on every insert attempt —
-- this was never a PostgREST schema-cache staleness issue.

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON erp_procurement.po_order_group TO service_role;

GRANT SELECT ON erp_procurement.po_order_group TO authenticated;
