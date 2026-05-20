/*
 * File-ID: 13.8.5
 * File-Path: supabase/migrations/20260511084000_gate13_8_13_8_5_create_indexes.sql
 * Gate: 13.8
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Indexes on RTV, Debit Note, Exchange, Landed Cost, and Invoice Verification tables.
 * Authority: Backend
 */

BEGIN;

-- RTV indexes
CREATE INDEX IF NOT EXISTS idx_rtv_number     ON erp_procurement.return_to_vendor (rtv_number);
CREATE INDEX IF NOT EXISTS idx_rtv_company    ON erp_procurement.return_to_vendor (company_id);
CREATE INDEX IF NOT EXISTS idx_rtv_vendor     ON erp_procurement.return_to_vendor (vendor_id);
CREATE INDEX IF NOT EXISTS idx_rtv_grn        ON erp_procurement.return_to_vendor (grn_id);
CREATE INDEX IF NOT EXISTS idx_rtv_status     ON erp_procurement.return_to_vendor (status);
CREATE INDEX IF NOT EXISTS idx_rtv_settlement ON erp_procurement.return_to_vendor (settlement_mode);

CREATE INDEX IF NOT EXISTS idx_rtvl_rtv       ON erp_procurement.return_to_vendor_line (rtv_id);
CREATE INDEX IF NOT EXISTS idx_rtvl_material  ON erp_procurement.return_to_vendor_line (material_id);

-- Debit Note indexes
CREATE INDEX IF NOT EXISTS idx_dn_number      ON erp_procurement.debit_note (dn_number);
CREATE INDEX IF NOT EXISTS idx_dn_vendor      ON erp_procurement.debit_note (vendor_id);
CREATE INDEX IF NOT EXISTS idx_dn_rtv         ON erp_procurement.debit_note (rtv_id);
CREATE INDEX IF NOT EXISTS idx_dn_status      ON erp_procurement.debit_note (status);

-- Exchange Reference indexes
CREATE INDEX IF NOT EXISTS idx_exr_number     ON erp_procurement.exchange_reference (exchange_ref_number);
CREATE INDEX IF NOT EXISTS idx_exr_rtv        ON erp_procurement.exchange_reference (rtv_id);
CREATE INDEX IF NOT EXISTS idx_exr_grn        ON erp_procurement.exchange_reference (replacement_grn_id) WHERE replacement_grn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exr_status     ON erp_procurement.exchange_reference (status);

-- Landed Cost indexes
CREATE INDEX IF NOT EXISTS idx_lc_number      ON erp_procurement.landed_cost (lc_number);
CREATE INDEX IF NOT EXISTS idx_lc_company     ON erp_procurement.landed_cost (company_id);
CREATE INDEX IF NOT EXISTS idx_lc_grn         ON erp_procurement.landed_cost (grn_id) WHERE grn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lc_csn         ON erp_procurement.landed_cost (csn_id) WHERE csn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lc_status      ON erp_procurement.landed_cost (status);

CREATE INDEX IF NOT EXISTS idx_lcl_lc         ON erp_procurement.landed_cost_line (lc_id);
CREATE INDEX IF NOT EXISTS idx_lcl_type       ON erp_procurement.landed_cost_line (cost_type);

-- Invoice Verification indexes
CREATE INDEX IF NOT EXISTS idx_iv_number      ON erp_procurement.invoice_verification (iv_number);
CREATE INDEX IF NOT EXISTS idx_iv_company     ON erp_procurement.invoice_verification (company_id);
CREATE INDEX IF NOT EXISTS idx_iv_vendor      ON erp_procurement.invoice_verification (vendor_id);
CREATE INDEX IF NOT EXISTS idx_iv_status      ON erp_procurement.invoice_verification (status);
CREATE INDEX IF NOT EXISTS idx_iv_po          ON erp_procurement.invoice_verification (po_id) WHERE po_id IS NOT NULL;

-- Blocked IV alert index (for Accounts dashboard - IVs needing resolution)
CREATE INDEX IF NOT EXISTS idx_iv_blocked
  ON erp_procurement.invoice_verification (company_id, created_at)
  WHERE status = 'BLOCKED';

CREATE INDEX IF NOT EXISTS idx_ivl_iv         ON erp_procurement.invoice_verification_line (iv_id);
CREATE INDEX IF NOT EXISTS idx_ivl_grn        ON erp_procurement.invoice_verification_line (grn_id);
CREATE INDEX IF NOT EXISTS idx_ivl_grn_line   ON erp_procurement.invoice_verification_line (grn_line_id);
CREATE INDEX IF NOT EXISTS idx_ivl_match      ON erp_procurement.invoice_verification_line (match_status);

-- Grants - all 8 tables
GRANT SELECT ON erp_procurement.return_to_vendor          TO authenticated;
GRANT SELECT ON erp_procurement.return_to_vendor_line     TO authenticated;
GRANT SELECT ON erp_procurement.debit_note                TO authenticated;
GRANT SELECT ON erp_procurement.exchange_reference        TO authenticated;
GRANT SELECT ON erp_procurement.landed_cost               TO authenticated;
GRANT SELECT ON erp_procurement.landed_cost_line          TO authenticated;
GRANT SELECT ON erp_procurement.invoice_verification      TO authenticated;
GRANT SELECT ON erp_procurement.invoice_verification_line TO authenticated;

GRANT ALL    ON erp_procurement.return_to_vendor          TO service_role;
GRANT ALL    ON erp_procurement.return_to_vendor_line     TO service_role;
GRANT ALL    ON erp_procurement.debit_note                TO service_role;
GRANT ALL    ON erp_procurement.exchange_reference        TO service_role;
GRANT ALL    ON erp_procurement.landed_cost               TO service_role;
GRANT ALL    ON erp_procurement.landed_cost_line          TO service_role;
GRANT ALL    ON erp_procurement.invoice_verification      TO service_role;
GRANT ALL    ON erp_procurement.invoice_verification_line TO service_role;

COMMIT;
