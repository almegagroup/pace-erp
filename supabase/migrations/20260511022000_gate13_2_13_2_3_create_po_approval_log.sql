/*
 * File-ID: 13.2.3
 * File-Path: supabase/migrations/20260511022000_gate13_2_13_2_3_create_po_approval_log.sql
 * Gate: 13.2
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: PO approval log - tracks every approval action with reason.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.po_approval_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Intra-schema FK
  po_id       uuid NOT NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE RESTRICT,

  -- APPROVED | REJECTED | ESCALATED
  action      text NOT NULL
    CHECK (action IN ('APPROVED', 'REJECTED', 'ESCALATED')),

  -- From status → to status
  from_status text NOT NULL,
  to_status   text NOT NULL,

  remarks     text NULL,
  actioned_by uuid NOT NULL,
  actioned_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_procurement.po_approval_log IS
'Append-only audit log of every PO approval action. Never updated - only inserted.';

CREATE INDEX IF NOT EXISTS idx_pal_po ON erp_procurement.po_approval_log (po_id);

GRANT SELECT ON erp_procurement.po_approval_log TO authenticated;
GRANT ALL    ON erp_procurement.po_approval_log TO service_role;

COMMIT;
