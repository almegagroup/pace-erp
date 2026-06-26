/*
 * File-Path: supabase/migrations/20260627110000_csn_redesign_foundation.sql
 * Purpose: Foundation schema for CSN redesign: destination port on PO, CSN status-code migration,
 *          CSN tracker layouts/history, and additional CSN operational fields.
 * Authority: Backend
 */

BEGIN;

ALTER TABLE erp_procurement.purchase_order
  ADD COLUMN IF NOT EXISTS destination_port_id uuid NULL;

ALTER TABLE erp_procurement.purchase_order_line
  ADD COLUMN IF NOT EXISTS knocked_off_qty numeric(20, 6) NOT NULL DEFAULT 0;

ALTER TABLE erp_procurement.consignment_note
  ADD COLUMN IF NOT EXISTS invoice_date date NULL,
  ADD COLUMN IF NOT EXISTS soft_copy_received boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hard_copy_received boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hard_copy_courier_number text NULL,
  ADD COLUMN IF NOT EXISTS courier_dispatch_date date NULL,
  ADD COLUMN IF NOT EXISTS courier_received_date date NULL,
  ADD COLUMN IF NOT EXISTS courier_date_to_cha date NULL,
  ADD COLUMN IF NOT EXISTS courier_cha_receive_date date NULL,
  ADD COLUMN IF NOT EXISTS cha_docket_number text NULL,
  ADD COLUMN IF NOT EXISTS inactive_reason_code text NULL,
  ADD COLUMN IF NOT EXISTS inactive_from_status text NULL,
  ADD COLUMN IF NOT EXISTS inactive_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS inactive_by uuid NULL;

ALTER TABLE erp_procurement.consignment_note
  DROP CONSTRAINT IF EXISTS consignment_note_status_check;

ALTER TABLE erp_procurement.consignment_note
  ADD CONSTRAINT consignment_note_status_check
  CHECK (status IN ('ORD', 'TRN', 'GED', 'GRD', 'CAN', 'KOF'));

UPDATE erp_procurement.consignment_note AS cn
SET status = CASE cn.status
  WHEN 'ORDERED' THEN 'ORD'
  WHEN 'IN_TRANSIT' THEN 'TRN'
  WHEN 'ARRIVED' THEN 'GED'
  WHEN 'GRN_DONE' THEN 'GRD'
  WHEN 'OPEN' THEN 'ORD'
  WHEN 'CLOSED' THEN CASE
    WHEN EXISTS (
      SELECT 1
      FROM erp_procurement.purchase_order_line pol
      WHERE pol.id = cn.po_line_id
        AND pol.line_status = 'KNOCKED_OFF'
    ) THEN 'KOF'
    WHEN EXISTS (
      SELECT 1
      FROM erp_procurement.stock_transfer_order_line stol
      JOIN erp_procurement.stock_transfer_order sto
        ON sto.id = stol.sto_id
      WHERE sto.id = cn.sto_id
        AND stol.line_status = 'KNOCKED_OFF'
    ) THEN 'KOF'
    ELSE 'CAN'
  END
  ELSE cn.status
END
WHERE cn.status IN ('ORDERED', 'IN_TRANSIT', 'ARRIVED', 'GRN_DONE', 'OPEN', 'CLOSED');

UPDATE erp_procurement.consignment_note
SET inactive_reason_code = status
WHERE status IN ('CAN', 'KOF')
  AND inactive_reason_code IS NULL;

CREATE TABLE IF NOT EXISTS erp_procurement.csn_tracker_layout (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('GLOBAL', 'USER')),
  created_by uuid NOT NULL,
  visible_columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS erp_procurement.csn_field_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  csn_id uuid NOT NULL REFERENCES erp_procurement.consignment_note(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  old_value text NULL,
  new_value text NULL,
  changed_by uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_csn_tracker_layout_scope
  ON erp_procurement.csn_tracker_layout (scope, created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_csn_field_history_lookup
  ON erp_procurement.csn_field_history (csn_id, field_name, changed_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON erp_procurement.csn_tracker_layout TO authenticated;
GRANT ALL ON erp_procurement.csn_tracker_layout TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON erp_procurement.csn_field_history TO authenticated;
GRANT ALL ON erp_procurement.csn_field_history TO service_role;

COMMIT;
