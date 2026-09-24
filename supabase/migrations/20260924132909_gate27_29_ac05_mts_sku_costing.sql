-- Gate 27.29 / AC05: the Gate 27.25 monthly chart was superseded by the
-- vendor-code keyed, effective-dated MTS SKU costing design in §142.
DROP TABLE IF EXISTS erp_production.mts_sku_monthly_rate;

CREATE TABLE erp_production.ac05_mts_sku_rate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  company_vendor_code_map_id uuid NOT NULL REFERENCES erp_production.company_vendor_code_map(id),
  sku_material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  resolved_stroke_master_id uuid REFERENCES erp_production.stroke_master(id),
  rate_per_base_uom numeric,
  rate_per_inner_pack numeric,
  rate_per_outer_uom numeric,
  rm_wastage_pct numeric,
  pack_wastage_pct numeric,
  effective_date date NOT NULL,
  status text NOT NULL DEFAULT 'RATED' CHECK (status IN ('PENDING', 'RATED')),
  source text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'AC06_SPLIT_CASCADE')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  UNIQUE (company_vendor_code_map_id, sku_material_id, effective_date)
);

CREATE INDEX ON erp_production.ac05_mts_sku_rate (company_id, status);
