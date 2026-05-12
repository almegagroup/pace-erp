/*
 * File-ID: 13.2.4
 * File-Path: supabase/migrations/20260511023000_gate13_2_13_2_4_create_po_amendment_log.sql
 * Gate: 13.2
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: PO amendment log - tracks field changes, flags which need approval.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.po_amendment_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Intra-schema FK
  po_id               uuid NOT NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE RESTRICT,

  po_line_id          uuid NULL
    REFERENCES erp_procurement.purchase_order_line(id)
    ON DELETE RESTRICT,

  amendment_number    int NOT NULL,

  -- Field that was changed
  field_changed       text NOT NULL,
  old_value           text NULL,
  new_value           text NULL,

  -- Rate or Qty changes require approval (Section 87.11)
  requires_approval   boolean NOT NULL DEFAULT false,

  -- PENDING | APPROVED | REJECTED
  approval_status     text NOT NULL DEFAULT 'APPROVED'
    CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),

  approved_by         uuid NULL,
  approved_at         timestamptz NULL,
  rejection_reason    text NULL,

  amended_by          uuid NOT NULL,
  amended_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_procurement.po_amendment_log IS
'Append-only amendment audit. requires_approval = true for rate and qty changes (Procurement Head approval required). All other fields = false (free amendment).';

COMMENT ON COLUMN erp_procurement.po_amendment_log.requires_approval IS
'TRUE for field_changed IN (unit_rate, ordered_qty). FALSE for all other fields (delivery date, remarks, cost center, incoterm, payment terms).';

CREATE INDEX IF NOT EXISTS idx_paml_po   ON erp_procurement.po_amendment_log (po_id);
CREATE INDEX IF NOT EXISTS idx_paml_line ON erp_procurement.po_amendment_log (po_line_id) WHERE po_line_id IS NOT NULL;

GRANT SELECT ON erp_procurement.po_amendment_log TO authenticated;
GRANT ALL    ON erp_procurement.po_amendment_log TO service_role;

COMMIT;
