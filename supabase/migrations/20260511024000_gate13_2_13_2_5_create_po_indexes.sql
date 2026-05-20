/*
 * File-ID: 13.2.5
 * File-Path: supabase/migrations/20260511024000_gate13_2_13_2_5_create_po_indexes.sql
 * Gate: 13.2
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Indexes on purchase_order and purchase_order_line for common query patterns.
 * Authority: Backend
 */

BEGIN;

-- purchase_order indexes
CREATE INDEX IF NOT EXISTS idx_po_company         ON erp_procurement.purchase_order (company_id);
CREATE INDEX IF NOT EXISTS idx_po_vendor          ON erp_procurement.purchase_order (vendor_id);
CREATE INDEX IF NOT EXISTS idx_po_status          ON erp_procurement.purchase_order (status);
CREATE INDEX IF NOT EXISTS idx_po_date            ON erp_procurement.purchase_order (po_date);
CREATE INDEX IF NOT EXISTS idx_po_delivery_type   ON erp_procurement.purchase_order (delivery_type);
CREATE INDEX IF NOT EXISTS idx_po_lc_required     ON erp_procurement.purchase_order (lc_required) WHERE lc_required = true;

-- purchase_order_line indexes
CREATE INDEX IF NOT EXISTS idx_pol_po             ON erp_procurement.purchase_order_line (po_id);
CREATE INDEX IF NOT EXISTS idx_pol_material       ON erp_procurement.purchase_order_line (material_id);
CREATE INDEX IF NOT EXISTS idx_pol_status         ON erp_procurement.purchase_order_line (line_status);
CREATE INDEX IF NOT EXISTS idx_pol_open           ON erp_procurement.purchase_order_line (po_id, line_status) WHERE line_status = 'OPEN';

-- Grants
GRANT SELECT ON erp_procurement.purchase_order      TO authenticated;
GRANT SELECT ON erp_procurement.purchase_order_line TO authenticated;
GRANT ALL    ON erp_procurement.purchase_order      TO service_role;
GRANT ALL    ON erp_procurement.purchase_order_line TO service_role;
GRANT ALL    ON erp_procurement.document_number_series TO service_role;
GRANT ALL    ON erp_procurement.invoice_number_series  TO service_role;

COMMIT;
