-- Physical-inventory quantities and multi-UoM conversion options must share
-- Material Master's base UoM, never a legacy stock-ledger label.
create or replace function erp_procurement.set_physical_inventory_item_master_uom()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_base_uom_code text;
begin
  select nullif(btrim(master.base_uom_code), '')
  into v_base_uom_code
  from erp_master.material_master master
  where master.id = new.material_id;

  if v_base_uom_code is not null then
    new.base_uom_code = v_base_uom_code;
  end if;

  return new;
end;
$$;

revoke all on function erp_procurement.set_physical_inventory_item_master_uom() from public;

drop trigger if exists physical_inventory_item_master_uom on erp_procurement.physical_inventory_item;
create trigger physical_inventory_item_master_uom
before insert or update of material_id, base_uom_code
on erp_procurement.physical_inventory_item
for each row
execute function erp_procurement.set_physical_inventory_item_master_uom();

-- Correct only uncounted, open CMP003 PID lines; posted and counted records
-- remain immutable audit history.
update erp_procurement.physical_inventory_item item
set base_uom_code = master.base_uom_code
from erp_procurement.physical_inventory_document document,
     erp_master.material_master master
where item.document_id = document.id
  and master.id = item.material_id
  and document.company_id = (
    select id from erp_master.companies where company_code = 'CMP003'
  )
  and document.status = 'OPEN'
  and item.physical_qty is null
  and nullif(btrim(master.base_uom_code), '') is not null
  and item.base_uom_code is distinct from master.base_uom_code;
