-- STO is being brought to full parity with PO's audit trail: an
-- append-only approval action log (mirrors po_approval_log) and an
-- amendment log supporting approval-gated qty/rate changes on a
-- CREATED STO (mirrors po_amendment_log).

CREATE TABLE erp_procurement.sto_approval_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sto_id uuid NOT NULL REFERENCES erp_procurement.stock_transfer_order(id),
  action text NOT NULL,
  from_status text,
  to_status text,
  remarks text,
  actioned_by uuid,
  actioned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE erp_procurement.sto_amendment_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sto_id uuid NOT NULL REFERENCES erp_procurement.stock_transfer_order(id),
  sto_line_id uuid REFERENCES erp_procurement.stock_transfer_order_line(id),
  amendment_number integer NOT NULL,
  field_changed text NOT NULL,
  old_value text,
  new_value text,
  requires_approval boolean NOT NULL DEFAULT false,
  approval_status text NOT NULL DEFAULT 'APPROVED',
  approved_by uuid,
  approved_at timestamptz,
  rejection_reason text,
  amended_by uuid,
  amended_at timestamptz NOT NULL DEFAULT now()
);
