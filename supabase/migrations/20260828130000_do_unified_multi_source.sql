-- DO (Delivery Order, TX SO03) §133.12 unified redesign — a DO is now
-- per-VEHICLE and can carry lines from multiple SO/STO documents at once
-- (previously one DO = exactly one source document, §113.13). Feasibility
-- doc §133.12/§133.12-addendum (2026-08-28).

-- ── dc_type widened: a vehicle can carry both SO and STO items together ────
ALTER TABLE erp_procurement.delivery_challan
  DROP CONSTRAINT delivery_challan_dc_type_check,
  ADD CONSTRAINT delivery_challan_dc_type_check
    CHECK (dc_type IN ('SALES', 'STO', 'MIXED'));

COMMENT ON COLUMN erp_procurement.delivery_challan.dc_type IS
  'SALES/STO/MIXED — MIXED added for §133.12''s multi-source DO (one vehicle can carry both SO and STO items). The old singular sales_order_id/sto_id/customer_id/ship_to_* header columns are only meaningful for pre-redesign single-source DOs; a §133.12 DO leaves them NULL and tracks its real sources via delivery_challan_source, with Bill-To/Ship-To resolved fresh at Invoice/PGI time per line instead of snapshotted at DO-create time.';

-- ── header: vehicle/weight detail (§133.12 Page 3) ──────────────────────────
ALTER TABLE erp_procurement.delivery_challan
  ADD COLUMN lr_date date,
  ADD COLUMN gross_weight numeric,
  ADD COLUMN net_weight numeric,
  ADD COLUMN driver_number text,
  ADD COLUMN driver_contact_number text;

COMMENT ON COLUMN erp_procurement.delivery_challan.net_weight IS
  '§133.12 Page 3 — auto = sum of every line''s base-UoM qty, whole-truck summary only. NOT used for per-invoice freight calc (§133.13 correction — each split invoice uses its own item subset''s weight, not this DO-wide total).';

-- ── new: which SO/STO documents contribute to this DO ───────────────────────
CREATE TABLE erp_procurement.delivery_challan_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dc_id uuid NOT NULL REFERENCES erp_procurement.delivery_challan(id),
  source_type text NOT NULL CHECK (source_type IN ('SALES_ORDER', 'STO')),
  source_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_challan_source_unique UNIQUE (dc_id, source_type, source_id)
);

CREATE INDEX idx_delivery_challan_source_dc_id ON erp_procurement.delivery_challan_source(dc_id);
CREATE INDEX idx_delivery_challan_source_source ON erp_procurement.delivery_challan_source(source_type, source_id);

COMMENT ON TABLE erp_procurement.delivery_challan_source IS
  '§133.12 — one row per SO/STO document referenced by this multi-source DO. Invoice/PGI (§133.13) Page 1''s "DO Number দিলে" lookup and Page 2''s DO-wise review both read this. A single-source pre-redesign DO has exactly one row here too (backfilled from its own sales_order_id/sto_id at read time, not stored retroactively).';

-- ── delivery_challan_line: batch/expiry/Packing-PO + SO-Map allocation trace ──
ALTER TABLE erp_procurement.delivery_challan_line
  ADD COLUMN so_map_allocation_id uuid REFERENCES erp_procurement.sales_order_map_allocation(id),
  ADD COLUMN batch_number text,
  ADD COLUMN expiry_date date,
  ADD COLUMN packing_order_id uuid REFERENCES erp_production.packing_order(id);

COMMENT ON COLUMN erp_procurement.delivery_challan_line.so_map_allocation_id IS
  '§133.12 — set only when this line was drawn from a Dependent(Direct/Depot/No-Inbound) SO through SO Map (an FO or manual-customer-address allocation). NULL for Independent Party lines (drawn straight from sales_order_line, §133.12-addendum) and for all STO lines.';
COMMENT ON COLUMN erp_procurement.delivery_challan_line.packing_order_id IS
  'FG (MTO/HPS/MTEST) lines only, auto-populated from the line''s FO link (§133.12 Page 1 point 5) — batch_number + packing_order_id together identify the exact committed batch/pack-group, which is why FG/SFG lines never merge at DO Page 2 consolidation while RM/PM/INT do.';

NOTIFY pgrst, 'reload schema';
