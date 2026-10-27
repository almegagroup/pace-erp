/*
 * Migration: 20261027100000_po_bulk_continuity_exception
 * Purpose:   Bulk PO "PO Continuity" (business owner, 2026-10-27).
 *
 *   The general §3.7 Bulk Effective Date rule stays: a later live PO for the
 *   same vendor + company + material ends an earlier PO's challan/invoice date
 *   window at its own effective_start_date. PO Continuity is a per-PO,
 *   user-chosen EXCEPTION to that rule: each row says "successor_po_id must
 *   not end po_id's window". No approval step.
 *
 *   After applying (DEV or PROD): NOTIFY pgrst, 'reload schema'; reconcile
 *   schema_migrations to this file's version; run migration-integrity-check.
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.purchase_order_continuity_exception (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id            uuid NOT NULL REFERENCES erp_procurement.purchase_order(id) ON DELETE CASCADE,
  successor_po_id  uuid NOT NULL REFERENCES erp_procurement.purchase_order(id) ON DELETE CASCADE,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_po_continuity_exception UNIQUE (po_id, successor_po_id),
  CONSTRAINT ck_po_continuity_not_self CHECK (po_id <> successor_po_id)
);

COMMENT ON TABLE erp_procurement.purchase_order_continuity_exception IS
  'Bulk PO Continuity: successor_po_id does not end po_id''s Effective Date window (exception to the §3.7 general rule, no approval).';

ALTER TABLE erp_procurement.purchase_order_continuity_exception ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON erp_procurement.purchase_order_continuity_exception TO service_role;

COMMIT;
