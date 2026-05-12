/*
 * File-ID: 13.9.3
 * File-Path: supabase/migrations/20260511092000_gate13_9_13_9_3_create_indexes.sql
 * Gate: 13.9
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Indexes on sales_order, sales_order_line, sales_invoice, sales_invoice_line.
 * Authority: Backend
 */

BEGIN;

-- Sales Order indexes
CREATE INDEX IF NOT EXISTS idx_so_number      ON erp_procurement.sales_order (so_number);
CREATE INDEX IF NOT EXISTS idx_so_company     ON erp_procurement.sales_order (company_id);
CREATE INDEX IF NOT EXISTS idx_so_customer    ON erp_procurement.sales_order (customer_id);
CREATE INDEX IF NOT EXISTS idx_so_status      ON erp_procurement.sales_order (status);
CREATE INDEX IF NOT EXISTS idx_so_date        ON erp_procurement.sales_order (so_date);

CREATE INDEX IF NOT EXISTS idx_sol_so         ON erp_procurement.sales_order_line (so_id);
CREATE INDEX IF NOT EXISTS idx_sol_material   ON erp_procurement.sales_order_line (material_id);
CREATE INDEX IF NOT EXISTS idx_sol_status     ON erp_procurement.sales_order_line (line_status);

-- Open lines dashboard partial index
CREATE INDEX IF NOT EXISTS idx_sol_open
  ON erp_procurement.sales_order_line (so_id, line_status)
  WHERE line_status = 'OPEN';

-- Sales Invoice indexes
CREATE INDEX IF NOT EXISTS idx_si_number      ON erp_procurement.sales_invoice (invoice_number);
CREATE INDEX IF NOT EXISTS idx_si_company     ON erp_procurement.sales_invoice (company_id);
CREATE INDEX IF NOT EXISTS idx_si_customer    ON erp_procurement.sales_invoice (customer_id);
CREATE INDEX IF NOT EXISTS idx_si_dc          ON erp_procurement.sales_invoice (dc_id);
CREATE INDEX IF NOT EXISTS idx_si_so          ON erp_procurement.sales_invoice (so_id) WHERE so_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_si_status      ON erp_procurement.sales_invoice (status);
CREATE INDEX IF NOT EXISTS idx_si_date        ON erp_procurement.sales_invoice (invoice_date);

CREATE INDEX IF NOT EXISTS idx_sil_invoice    ON erp_procurement.sales_invoice_line (invoice_id);
CREATE INDEX IF NOT EXISTS idx_sil_so_line    ON erp_procurement.sales_invoice_line (so_line_id) WHERE so_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sil_dc_line    ON erp_procurement.sales_invoice_line (dc_line_id) WHERE dc_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sil_material   ON erp_procurement.sales_invoice_line (material_id);

-- Grants
GRANT SELECT ON erp_procurement.sales_order          TO authenticated;
GRANT SELECT ON erp_procurement.sales_order_line     TO authenticated;
GRANT SELECT ON erp_procurement.sales_invoice        TO authenticated;
GRANT SELECT ON erp_procurement.sales_invoice_line   TO authenticated;

GRANT ALL    ON erp_procurement.sales_order          TO service_role;
GRANT ALL    ON erp_procurement.sales_order_line     TO service_role;
GRANT ALL    ON erp_procurement.sales_invoice        TO service_role;
GRANT ALL    ON erp_procurement.sales_invoice_line   TO service_role;

COMMIT;
