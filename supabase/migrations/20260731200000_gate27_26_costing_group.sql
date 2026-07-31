create table if not exists erp_production.costing_group (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references erp_master.companies(id),
  name text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  unique (company_id, name)
);

create table if not exists erp_production.costing_group_member (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references erp_production.costing_group(id) on delete cascade,
  material_id uuid not null references erp_master.material_master(id),
  added_from_storage_location_id uuid references erp_inventory.storage_location_master(id),
  added_by uuid not null,
  added_at timestamptz not null default now(),
  unique (material_id)
);

create table if not exists erp_production.costing_rate_line (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references erp_master.companies(id),
  material_id uuid not null references erp_master.material_master(id),
  rate_month date not null,
  rate numeric not null default 0,
  group_id uuid references erp_production.costing_group(id),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  unique (company_id, material_id, rate_month)
);

create index if not exists idx_costing_group_company
  on erp_production.costing_group(company_id, name);

create index if not exists idx_costing_group_member_group
  on erp_production.costing_group_member(group_id);

create index if not exists idx_costing_rate_line_company_month
  on erp_production.costing_rate_line(company_id, rate_month, status);
