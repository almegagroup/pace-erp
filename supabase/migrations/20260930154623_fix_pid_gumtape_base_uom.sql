-- Gum Tape was standardised to MTR, but the original CMP003 opening-stock row
-- retained NOS. Correct the editable source row and the still-open PID snapshot
-- without changing posted count history. stock_ledger is deliberately immutable
-- audit history, so its legacy label is not rewritten.
do $$
declare
  v_company_id uuid;
  v_material_id uuid;
begin
  select id into v_company_id
  from erp_master.companies
  where company_code = 'CMP003';

  select id into v_material_id
  from erp_master.material_master
  where pace_code = 'PM-00003';

  if v_company_id is null or v_material_id is null then
    return;
  end if;

  update erp_inventory.stock_document
  set base_uom_code = 'MTR'
  where company_id = v_company_id
    and material_id = v_material_id
    and reference_document_type = 'OS'
    and reference_document_number = '6000000003'
    and base_uom_code = 'NOS';

  update erp_procurement.physical_inventory_item item
  set base_uom_code = 'MTR'
  from erp_procurement.physical_inventory_document document
  where item.document_id = document.id
    and document.company_id = v_company_id
    and document.document_number = '6500000020'
    and document.status = 'OPEN'
    and item.material_id = v_material_id
    and item.base_uom_code = 'NOS'
    and item.physical_qty is null;
end;
$$;
