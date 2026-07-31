create table if not exists erp_production.sloc_group (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references erp_master.companies(id),
  name text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  unique (company_id, name)
);

create table if not exists erp_production.sloc_group_member (
  id uuid primary key default gen_random_uuid(),
  sloc_group_id uuid not null references erp_production.sloc_group(id) on delete cascade,
  storage_location_id uuid not null references erp_inventory.storage_location_master(id),
  added_by uuid not null,
  added_at timestamptz not null default now(),
  unique (sloc_group_id, storage_location_id)
);

create index if not exists idx_sloc_group_company
  on erp_production.sloc_group(company_id, name);

create index if not exists idx_sloc_group_member_group
  on erp_production.sloc_group_member(sloc_group_id);
