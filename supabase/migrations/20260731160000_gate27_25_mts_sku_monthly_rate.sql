create table if not exists erp_production.mts_sku_monthly_rate (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references erp_master.companies(id),
  material_id uuid not null references erp_master.material_master(id),
  rate_month date not null,
  rate numeric not null default 0,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  unique (company_id, material_id, rate_month)
);

create index if not exists idx_mts_sku_monthly_rate_company_month
  on erp_production.mts_sku_monthly_rate (company_id, rate_month);

create index if not exists idx_mts_sku_monthly_rate_material_status
  on erp_production.mts_sku_monthly_rate (material_id, status);
