/*
 * File-ID: 13.3.2
 * File-Path: supabase/migrations/20260511031000_gate13_3_13_3_2_create_csn_indexes.sql
 * Gate: 13.3
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Indexes on consignment_note for common query patterns including alert queries.
 * Authority: Backend
 */

BEGIN;

CREATE INDEX IF NOT EXISTS idx_csn_number     ON erp_procurement.consignment_note (csn_number);
CREATE INDEX IF NOT EXISTS idx_csn_company    ON erp_procurement.consignment_note (company_id);
CREATE INDEX IF NOT EXISTS idx_csn_po         ON erp_procurement.consignment_note (po_id);
CREATE INDEX IF NOT EXISTS idx_csn_po_line    ON erp_procurement.consignment_note (po_line_id);
CREATE INDEX IF NOT EXISTS idx_csn_type       ON erp_procurement.consignment_note (csn_type);
CREATE INDEX IF NOT EXISTS idx_csn_status     ON erp_procurement.consignment_note (status);
CREATE INDEX IF NOT EXISTS idx_csn_material   ON erp_procurement.consignment_note (material_id);
CREATE INDEX IF NOT EXISTS idx_csn_vendor     ON erp_procurement.consignment_note (vendor_id);
CREATE INDEX IF NOT EXISTS idx_csn_mother     ON erp_procurement.consignment_note (mother_csn_id) WHERE mother_csn_id IS NOT NULL;

-- Alert query indexes (Section 90.7)
-- LC Alerts: import CSNs with lc_required = true and LC not complete
CREATE INDEX IF NOT EXISTS idx_csn_lc_alert
  ON erp_procurement.consignment_note (company_id, lc_due_date)
  WHERE lc_required = true
    AND status NOT IN ('GRN_DONE', 'CLOSED');

-- Vessel Booking Alerts: import CSNs with no vessel booking confirmed
CREATE INDEX IF NOT EXISTS idx_csn_vessel_alert
  ON erp_procurement.consignment_note (company_id)
  WHERE csn_type = 'IMPORT'
    AND vessel_booking_confirmed_date IS NULL
    AND status NOT IN ('ARRIVED', 'GRN_DONE', 'CLOSED');

GRANT SELECT ON erp_procurement.consignment_note TO authenticated;
GRANT ALL    ON erp_procurement.consignment_note TO service_role;

COMMIT;
