-- Enable RLS on all erp_procurement tables
-- Backend uses service_role (bypasses RLS) — no functional impact
-- Blocks direct PostgREST access from anon/authenticated roles

ALTER TABLE erp_procurement.purchase_order            ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.purchase_order_line       ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.po_approval_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.po_amendment_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.consignment_note          ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.gate_entry                ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.gate_entry_line           ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.gate_exit_inbound         ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.goods_receipt             ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.goods_receipt_line        ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.inward_qa_document        ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.inward_qa_test_line       ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.inward_qa_decision_line   ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.stock_transfer_order      ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.stock_transfer_order_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.delivery_challan          ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.delivery_challan_line     ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.gate_exit_outbound        ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.return_to_vendor          ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.return_to_vendor_line     ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.debit_note                ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.exchange_reference        ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.landed_cost               ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.landed_cost_line          ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.invoice_verification      ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.invoice_verification_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.sales_order               ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.sales_order_line          ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.sales_invoice             ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.sales_invoice_line        ENABLE ROW LEVEL SECURITY;
