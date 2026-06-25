-- Opening/legacy STO support, mirroring the PO opening flow for
-- auditability/reporting parity. Unlike PO, STO already supports
-- multiple lines per document, so no duplicate sto_number handling
-- is needed here - sto_number keeps its plain UNIQUE constraint.

ALTER TABLE erp_procurement.stock_transfer_order
  ADD COLUMN is_opening_sto boolean NOT NULL DEFAULT false;
