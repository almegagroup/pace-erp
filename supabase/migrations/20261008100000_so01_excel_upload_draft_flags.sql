-- §4 (FG-STO-MTS-DISPATCH-DESIGN-DOC.md) — SO01 MTS Excel Upload design, locked
-- 2026-10-08. Widens sales_order.status to allow a DRAFT state (used while a
-- bulk-Excel-upload SO has no lines yet / is still being filled) and adds the
-- two new Page-2 checkboxes' storage plus the Draft SO List's own tracking
-- flag.
ALTER TABLE erp_procurement.sales_order
  DROP CONSTRAINT sales_order_status_check;

ALTER TABLE erp_procurement.sales_order
  ADD CONSTRAINT sales_order_status_check
  CHECK (status = ANY (ARRAY['DRAFT', 'CREATED', 'ISSUED', 'INVOICED', 'CLOSED', 'CANCELLED']));

ALTER TABLE erp_procurement.sales_order
  ADD COLUMN is_excel_upload boolean NOT NULL DEFAULT false,
  ADD COLUMN is_dd_dispatch boolean NOT NULL DEFAULT false,
  ADD COLUMN excel_uploaded boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN erp_procurement.sales_order.is_excel_upload IS
  'Page-2 "Excel Upload" checkbox at create time — this SO was created with no item lines, to be bulk-filled later via the Draft SO List''s Excel upload flow.';
COMMENT ON COLUMN erp_procurement.sales_order.is_dd_dispatch IS
  'Page-2 "DD Dispatch" checkbox — pure flag for Dependent(Direct)+MTS dispatch (deferred Invoice-then-PGI). No SO01-side behavior change; consumed by the future DO/PGI design.';
COMMENT ON COLUMN erp_procurement.sales_order.excel_uploaded IS
  'Set true the first time an Excel-upload batch allocates at least one line into this SO. Independent of status — stays DRAFT until Enter SO confirms it.';
