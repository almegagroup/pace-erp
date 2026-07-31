alter table erp_production.mts_sku_monthly_rate
  add column if not exists dispatch_uom_code text,
  add column if not exists rate_per_kg numeric;

update erp_production.mts_sku_monthly_rate
set dispatch_uom_code = coalesce(dispatch_uom_code, 'KG'),
    rate_per_kg = coalesce(rate_per_kg, rate)
where dispatch_uom_code is null
   or rate_per_kg is null;

alter table erp_production.mts_sku_monthly_rate
  alter column dispatch_uom_code set not null,
  alter column rate_per_kg set not null;

create index if not exists idx_mts_sku_monthly_rate_company_month_status
  on erp_production.mts_sku_monthly_rate (company_id, rate_month, status);
