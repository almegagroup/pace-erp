/*
 * File-ID: 13.7.4
 * File-Path: supabase/migrations/20260511073000_gate13_7_13_7_4_create_sto_indexes.sql
 * Gate: 13.7
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Indexes on STO, DC, and Gate Exit Outbound tables.
 * Authority: Backend
 */

BEGIN;

CREATE INDEX IF NOT EXISTS idx_sto_number   ON erp_procurement.stock_transfer_order (sto_number);
CREATE INDEX IF NOT EXISTS idx_sto_sending  ON erp_procurement.stock_transfer_order (sending_company_id);
CREATE INDEX IF NOT EXISTS idx_sto_recv     ON erp_procurement.stock_transfer_order (receiving_company_id);
CREATE INDEX IF NOT EXISTS idx_sto_status   ON erp_procurement.stock_transfer_order (status);
CREATE INDEX IF NOT EXISTS idx_sto_csn      ON erp_procurement.stock_transfer_order (related_csn_id) WHERE related_csn_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stol_sto     ON erp_procurement.stock_transfer_order_line (sto_id);
CREATE INDEX IF NOT EXISTS idx_stol_mat     ON erp_procurement.stock_transfer_order_line (material_id);

CREATE INDEX IF NOT EXISTS idx_dc_number    ON erp_procurement.delivery_challan (dc_number);
CREATE INDEX IF NOT EXISTS idx_dc_sto       ON erp_procurement.delivery_challan (sto_id) WHERE sto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dc_so        ON erp_procurement.delivery_challan (sales_order_id) WHERE sales_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gxo_company  ON erp_procurement.gate_exit_outbound (company_id);
CREATE INDEX IF NOT EXISTS idx_gxo_sto      ON erp_procurement.gate_exit_outbound (sto_id) WHERE sto_id IS NOT NULL;

GRANT SELECT ON erp_procurement.stock_transfer_order      TO authenticated;
GRANT SELECT ON erp_procurement.stock_transfer_order_line TO authenticated;
GRANT SELECT ON erp_procurement.delivery_challan          TO authenticated;
GRANT SELECT ON erp_procurement.delivery_challan_line     TO authenticated;
GRANT SELECT ON erp_procurement.gate_exit_outbound        TO authenticated;
GRANT ALL    ON erp_procurement.stock_transfer_order      TO service_role;
GRANT ALL    ON erp_procurement.stock_transfer_order_line TO service_role;
GRANT ALL    ON erp_procurement.delivery_challan          TO service_role;
GRANT ALL    ON erp_procurement.delivery_challan_line     TO service_role;
GRANT ALL    ON erp_procurement.gate_exit_outbound        TO service_role;

COMMIT;
