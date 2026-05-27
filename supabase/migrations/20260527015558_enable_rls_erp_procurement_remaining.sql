-- Enable RLS on remaining erp_procurement tables
-- (opening stock, physical inventory, number series, plant transfer)
-- Backend uses service_role (bypasses RLS) — no functional impact

ALTER TABLE erp_procurement.company_doc_number_counter  ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.company_doc_number_series   ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.document_number_series      ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.invoice_number_series       ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.opening_stock_document      ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.opening_stock_line          ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.physical_inventory_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.physical_inventory_item     ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.plant_transfer_order        ENABLE ROW LEVEL SECURITY;
