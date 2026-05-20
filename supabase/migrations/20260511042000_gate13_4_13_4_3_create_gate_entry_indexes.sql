/*
 * File-ID: 13.4.3
 * File-Path: supabase/migrations/20260511042000_gate13_4_13_4_3_create_gate_entry_indexes.sql
 * Gate: 13.4
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Indexes on gate_entry, gate_entry_line, gate_exit_inbound.
 * Authority: Backend
 */

BEGIN;

CREATE INDEX IF NOT EXISTS idx_ge_number    ON erp_procurement.gate_entry (ge_number);
CREATE INDEX IF NOT EXISTS idx_ge_company   ON erp_procurement.gate_entry (company_id);
CREATE INDEX IF NOT EXISTS idx_ge_date      ON erp_procurement.gate_entry (ge_date);
CREATE INDEX IF NOT EXISTS idx_ge_status    ON erp_procurement.gate_entry (status);

CREATE INDEX IF NOT EXISTS idx_gel_ge       ON erp_procurement.gate_entry_line (gate_entry_id);
CREATE INDEX IF NOT EXISTS idx_gel_po       ON erp_procurement.gate_entry_line (po_id) WHERE po_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gel_csn      ON erp_procurement.gate_entry_line (csn_id) WHERE csn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gel_material ON erp_procurement.gate_entry_line (material_id);

-- Partial index for open lines not yet GRN-posted (Section 13.5 in original Gate-13 spec)
CREATE INDEX IF NOT EXISTS idx_gel_grn_posted
  ON erp_procurement.gate_entry_line (gate_entry_id)
  WHERE grn_posted = false;

CREATE INDEX IF NOT EXISTS idx_gxi_ge       ON erp_procurement.gate_exit_inbound (gate_entry_id);
CREATE INDEX IF NOT EXISTS idx_gxi_company  ON erp_procurement.gate_exit_inbound (company_id);

GRANT SELECT ON erp_procurement.gate_entry         TO authenticated;
GRANT SELECT ON erp_procurement.gate_entry_line    TO authenticated;
GRANT SELECT ON erp_procurement.gate_exit_inbound  TO authenticated;
GRANT ALL    ON erp_procurement.gate_entry         TO service_role;
GRANT ALL    ON erp_procurement.gate_entry_line    TO service_role;
GRANT ALL    ON erp_procurement.gate_exit_inbound  TO service_role;

COMMIT;
