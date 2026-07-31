create table if not exists erp_master.fg_parent_company (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references erp_master.companies(id),
  company_name text not null,
  gst_number text,
  state text not null,
  full_address text,
  pin_code text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  unique (company_id, company_name, state)
);

create table if not exists erp_master.fg_depot_code (
  id uuid primary key default gen_random_uuid(),
  parent_company_id uuid not null references erp_master.fg_parent_company(id),
  dispatch_type text not null check (dispatch_type in ('DIRECT', 'DEPOT')),
  code text not null,
  description text,
  address_line text,
  state text,
  pin_code text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  unique (parent_company_id, code)
);

create table if not exists erp_master.fg_dispatch_customer (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  registration_type text not null check (registration_type in ('REGISTERED', 'UNREGISTERED')),
  gst_number text,
  fo_customer_type text check (fo_customer_type in ('MTO_HPS', 'ZTEST', 'MTS')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  last_updated_by uuid,
  last_updated_at timestamptz
);

create table if not exists erp_master.fg_dispatch_customer_address (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references erp_master.fg_dispatch_customer(id),
  depot_code_id uuid not null references erp_master.fg_depot_code(id),
  address_line text not null,
  state text not null,
  pin_code text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  last_updated_by uuid,
  last_updated_at timestamptz
);

create index if not exists idx_fg_parent_company_company_id
  on erp_master.fg_parent_company(company_id);

create index if not exists idx_fg_depot_code_parent_company_id
  on erp_master.fg_depot_code(parent_company_id);

create index if not exists idx_fg_dispatch_customer_gst_number
  on erp_master.fg_dispatch_customer(gst_number);

create index if not exists idx_fg_dispatch_customer_address_customer_id
  on erp_master.fg_dispatch_customer_address(customer_id);

create index if not exists idx_fg_dispatch_customer_address_depot_code_id
  on erp_master.fg_dispatch_customer_address(depot_code_id);

create or replace function erp_master.validate_fg_depot_code_row()
returns trigger
language plpgsql
as $$
declare
  parent_state text;
begin
  select state into parent_state
  from erp_master.fg_parent_company
  where id = new.parent_company_id;

  if parent_state is null then
    raise exception 'MM05_PARENT_COMPANY_NOT_FOUND'
      using errcode = '23503';
  end if;

  if new.dispatch_type = 'DEPOT' then
    if coalesce(trim(new.address_line), '') = '' or coalesce(trim(new.state), '') = '' then
      raise exception 'MM05_DEPOT_ADDRESS_REQUIRED'
        using errcode = '23514';
    end if;
    if trim(new.state) <> trim(parent_state) then
      raise exception 'MM05_STATE_MISMATCH'
        using errcode = '23514';
    end if;
  else
    if new.address_line is not null or new.state is not null or new.pin_code is not null then
      raise exception 'MM05_DIRECT_DEPOT_INLINE_ADDRESS_FORBIDDEN'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create or replace function erp_master.validate_fg_dispatch_customer_address_row()
returns trigger
language plpgsql
as $$
declare
  depot_dispatch_type text;
  parent_state text;
begin
  select dc.dispatch_type, pc.state
    into depot_dispatch_type, parent_state
  from erp_master.fg_depot_code dc
  join erp_master.fg_parent_company pc on pc.id = dc.parent_company_id
  where dc.id = new.depot_code_id;

  if depot_dispatch_type is null then
    raise exception 'MM05_DEPOT_CODE_NOT_FOUND'
      using errcode = '23503';
  end if;

  if depot_dispatch_type <> 'DIRECT' then
    raise exception 'MM05_ADDRESS_REQUIRES_DIRECT_DEPOT'
      using errcode = '23514';
  end if;

  if trim(new.state) <> trim(parent_state) then
    raise exception 'MM05_STATE_MISMATCH'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_fg_depot_code_row on erp_master.fg_depot_code;
create trigger trg_validate_fg_depot_code_row
before insert or update on erp_master.fg_depot_code
for each row execute function erp_master.validate_fg_depot_code_row();

drop trigger if exists trg_validate_fg_dispatch_customer_address_row on erp_master.fg_dispatch_customer_address;
create trigger trg_validate_fg_dispatch_customer_address_row
before insert or update on erp_master.fg_dispatch_customer_address
for each row execute function erp_master.validate_fg_dispatch_customer_address_row();
