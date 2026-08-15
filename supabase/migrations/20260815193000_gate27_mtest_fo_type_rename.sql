-- Gate-27 MTEST/ZTEST redesign follow-up:
-- rename the legacy FO customer type value ZTEST -> MTEST everywhere it is persisted,
-- while preserving the same logical bucket (MTO/HPS, MTEST, MTS).

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'erp_master.customer_master'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%fo_customer_type%'
  loop
    execute format('alter table erp_master.customer_master drop constraint %I', constraint_name);
  end loop;
end $$;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'erp_master.fg_dispatch_customer'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%fo_customer_type%'
  loop
    execute format('alter table erp_master.fg_dispatch_customer drop constraint %I', constraint_name);
  end loop;
end $$;

update erp_master.customer_master
set fo_customer_type = 'MTEST'
where fo_customer_type = 'ZTEST';

update erp_master.fg_dispatch_customer
set fo_customer_type = 'MTEST'
where fo_customer_type = 'ZTEST';

alter table erp_master.customer_master
  add constraint customer_master_fo_customer_type_check
  check (fo_customer_type is null or fo_customer_type in ('MTO_HPS', 'MTEST', 'MTS'));

alter table erp_master.fg_dispatch_customer
  add constraint fg_dispatch_customer_fo_customer_type_check
  check (fo_customer_type is null or fo_customer_type in ('MTO_HPS', 'MTEST', 'MTS'));
