-- SO01 unified RM/PM/INT/SFG/FG Sales Order redesign — schema foundation.
-- Feasibility doc §133.7-§133.11 (2026-08-28).

-- ── sales_order header additions ────────────────────────────────────────────
ALTER TABLE erp_procurement.sales_order
  ADD COLUMN dispatch_type text,
  ADD COLUMN ibn_required boolean,
  ADD COLUMN dispatch_category text,
  ADD COLUMN material_types text[] NOT NULL DEFAULT '{}',
  ADD COLUMN freight_term text,
  ADD COLUMN bill_to_type text,
  ADD COLUMN bill_to_parent_company_id uuid REFERENCES erp_master.fg_parent_company(id),
  ADD COLUMN bill_to_depot_code_id uuid REFERENCES erp_master.fg_depot_code(id),
  ADD COLUMN bill_to_vdc_id uuid REFERENCES erp_master.fg_depot_code(id),
  ADD COLUMN bill_to_name text,
  ADD COLUMN bill_to_address text,
  ADD COLUMN bill_to_state text,
  ADD COLUMN bill_to_gst_number text,
  ADD COLUMN billing_to_depot boolean,
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN closed_by uuid,
  ADD COLUMN closed_reason text;

ALTER TABLE erp_procurement.sales_order
  ADD CONSTRAINT sales_order_dispatch_type_check
    CHECK (dispatch_type IS NULL OR dispatch_type IN (
      'DEPENDENT_DIRECT', 'DEPENDENT_DEPOT', 'INDEPENDENT_PARTY',
      'INDEPENDENT_PARTY_ASIAN_BILLED', 'DEPENDENT_NO_INBOUND'
    )),
  ADD CONSTRAINT sales_order_dispatch_category_check
    CHECK (dispatch_category IS NULL OR dispatch_category IN ('RPS', 'SRPS', 'FRPS', 'FSRPS')),
  ADD CONSTRAINT sales_order_freight_term_check
    CHECK (freight_term IS NULL OR freight_term IN (
      'FOR', 'FREIGHT_SEPARATE', 'FREIGHT_AT_ACTUALS', 'EX_TRANSPORTER_GODOWN'
    )),
  ADD CONSTRAINT sales_order_bill_to_type_check
    CHECK (bill_to_type IS NULL OR bill_to_type IN ('PARENT_COMPANY', 'DEPOT', 'CUSTOMER')),
  ADD CONSTRAINT sales_order_material_types_check
    CHECK (material_types <@ ARRAY['RM', 'PM', 'INT', 'SFG', 'FG']::text[]);

COMMENT ON COLUMN erp_procurement.sales_order.dispatch_type IS
  'Feasibility §133.7 — 5 fixed dispatch types, drives Bill-To/Ship-To resolution and IBN necessity.';
COMMENT ON COLUMN erp_procurement.sales_order.ibn_required IS
  'Auto-resolved from dispatch_type for 4 of 5 types; user-editable Yes/No only for INDEPENDENT_PARTY_ASIAN_BILLED (§133.7 2026-08-28 correction).';
COMMENT ON COLUMN erp_procurement.sales_order.dispatch_category IS
  'Derived from material_types (§133.14): RM/PM/INT only=RPS, +SFG=SRPS, +FG no SFG=FRPS, +FG+SFG=FSRPS.';

-- ── sales_order_line additions ──────────────────────────────────────────────
ALTER TABLE erp_procurement.sales_order_line
  ADD COLUMN line_material_type text,
  ADD COLUMN fg_type text,
  ADD COLUMN batch_number text,
  ADD COLUMN expiry_date date,
  ADD COLUMN hsn_code text,
  ADD COLUMN currency_code text NOT NULL DEFAULT 'INR',
  ADD COLUMN gst_treatment text NOT NULL DEFAULT 'EXCLUSIVE',
  ADD COLUMN cgst_amount numeric,
  ADD COLUMN sgst_amount numeric,
  ADD COLUMN igst_amount numeric,
  ADD COLUMN pack_uom_code text,
  ADD COLUMN pack_qty numeric,
  ADD COLUMN per_pack_qty numeric,
  ADD COLUMN base_qty numeric,
  ADD COLUMN rate_basis text,
  ADD COLUMN costing_rate_month text,
  ADD COLUMN packing_order_id uuid;

ALTER TABLE erp_procurement.sales_order_line
  ADD CONSTRAINT sales_order_line_material_type_check
    CHECK (line_material_type IS NULL OR line_material_type IN ('RM', 'PM', 'INT', 'SFG', 'FG')),
  ADD CONSTRAINT sales_order_line_fg_type_check
    CHECK (fg_type IS NULL OR fg_type IN ('MTO', 'HPS', 'MTEST', 'MTS')),
  ADD CONSTRAINT sales_order_line_gst_treatment_check
    CHECK (gst_treatment IN ('INCLUSIVE', 'EXCLUSIVE')),
  ADD CONSTRAINT sales_order_line_rate_basis_check
    CHECK (rate_basis IS NULL OR rate_basis IN ('PACK_UOM', 'BASE_UOM', 'FIXED'));

COMMENT ON COLUMN erp_procurement.sales_order_line.rate_basis IS
  'Feasibility §133.8-E — MTO/HPS/MTS: PACK_UOM or BASE_UOM. MTEST: FIXED (default), PACK_UOM, or BASE_UOM.';
COMMENT ON COLUMN erp_procurement.sales_order_line.costing_rate_month IS
  'AC06 rate_month (YYYY-MM) for MTO/HPS, auto SO date month for MTEST, or literal ''MANUAL'' — §133.8-E/§133.11.';
COMMENT ON COLUMN erp_procurement.sales_order_line.packing_order_id IS
  'FG/SFG lines linked via a mapped FO already know their Packing PO — §133.9.';

-- ── New master: Additional Cost Category (§133.13, inline-creatable, reusable) ──
CREATE TABLE erp_master.additional_cost_category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  CONSTRAINT additional_cost_category_code_unique UNIQUE (code)
);

COMMENT ON TABLE erp_master.additional_cost_category IS
  'Feasibility §133.13 — inline-creatable, reusable cost categories for Invoice/PGI Additional Cost lines.';

-- ── plan_feed.party_id — real FK, was a bare UUID (§133.9 flagged gap) ──────
ALTER TABLE erp_production.plan_feed
  ADD CONSTRAINT plan_feed_party_id_fkey
    FOREIGN KEY (party_id) REFERENCES erp_master.customer_master(id);

NOTIFY pgrst, 'reload schema';
