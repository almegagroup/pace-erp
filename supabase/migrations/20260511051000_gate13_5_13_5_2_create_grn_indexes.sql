/*
 * File-ID: 13.5.2
 * File-Path: supabase/migrations/20260511051000_gate13_5_13_5_2_create_grn_indexes.sql
 * Gate: 13.5
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Indexes on goods_receipt and goods_receipt_line.
 * Authority: Backend
 */

BEGIN;

CREATE INDEX IF NOT EXISTS idx_grn_number     ON erp_procurement.goods_receipt (grn_number);
CREATE INDEX IF NOT EXISTS idx_grn_company    ON erp_procurement.goods_receipt (company_id);
CREATE INDEX IF NOT EXISTS idx_grn_ge         ON erp_procurement.goods_receipt (gate_entry_id);
CREATE INDEX IF NOT EXISTS idx_grn_po         ON erp_procurement.goods_receipt (po_id) WHERE po_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grn_status     ON erp_procurement.goods_receipt (status);
CREATE INDEX IF NOT EXISTS idx_grn_date       ON erp_procurement.goods_receipt (grn_date);

CREATE INDEX IF NOT EXISTS idx_grl_grn        ON erp_procurement.goods_receipt_line (grn_id);
CREATE INDEX IF NOT EXISTS idx_grl_material   ON erp_procurement.goods_receipt_line (material_id);
CREATE INDEX IF NOT EXISTS idx_grl_po_line    ON erp_procurement.goods_receipt_line (po_line_id) WHERE po_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grl_gel        ON erp_procurement.goods_receipt_line (gate_entry_line_id);
CREATE INDEX IF NOT EXISTS idx_grl_stock_type ON erp_procurement.goods_receipt_line (target_stock_type);

GRANT SELECT ON erp_procurement.goods_receipt      TO authenticated;
GRANT SELECT ON erp_procurement.goods_receipt_line TO authenticated;
GRANT ALL    ON erp_procurement.goods_receipt      TO service_role;
GRANT ALL    ON erp_procurement.goods_receipt_line TO service_role;

COMMIT;
