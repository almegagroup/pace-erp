-- AC08 Manual Costing Rate Entry (business owner, 2026-09-07) -- a Sales Order
-- line whose Costing Rate Month is 'MANUAL' (§133.8-E, SO01CreatePage.jsx's
-- costingMonthCell) has no AC06 month to draw RM/INT/PM rates from at all.
-- This table is where Accounts hand-enters those rates once a real dispatch
-- exists (so the SO Stroke vs Production/Actual Stroke recipe comparison has
-- something to show), one row per material per SO line -- deliberately
-- case-by-case (business owner, explicit): a rate entered here is NOT a
-- reusable company+material rate, it only ever answers for this exact SO
-- line's own manual costing case.

CREATE TABLE IF NOT EXISTS erp_procurement.manual_costing_rate_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_line_id uuid NOT NULL REFERENCES erp_procurement.sales_order_line(id),
  material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  rate numeric NOT NULL CHECK (rate >= 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sales_order_line_id, material_id)
);

CREATE INDEX IF NOT EXISTS idx_manual_costing_rate_entry_so_line
  ON erp_procurement.manual_costing_rate_entry (sales_order_line_id);
