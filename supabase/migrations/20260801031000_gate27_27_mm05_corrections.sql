alter table erp_master.fg_dispatch_customer
  add column if not exists state text,
  add column if not exists full_address text,
  add column if not exists pin_code text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fg_dispatch_customer_state_check'
  ) then
    alter table erp_master.fg_dispatch_customer
      add constraint fg_dispatch_customer_state_check
      check (
        state is null or state in (
          'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh',
          'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
          'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
          'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu',
          'Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
          'Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli and Daman and Diu',
          'Delhi','Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry'
        )
      );
  end if;
end $$;
