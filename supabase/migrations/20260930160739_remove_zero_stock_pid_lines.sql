-- Location-wise PID creation previously split FG receipts and subsequent OUT
-- movements by missing Packing-PO lineage. Remove only the resulting zero-stock
-- rows from the two open, still-uncounted documents; do not alter count history.
with targets as (
  select item.id
  from erp_procurement.physical_inventory_document document
  join erp_master.companies company on company.id = document.company_id
  join erp_procurement.physical_inventory_item item on item.document_id = document.id
  where (company.company_code, document.document_number) in (
      ('CMP003', '6500000021'),
      ('CMP006', '6500000024')
    )
    and document.status = 'OPEN'
    and item.physical_qty is null
    and item.book_qty > 0
    and exists (
      select 1
      from (
        select coalesce(sum(
          case when upper(trim(ledger.direction)) = 'OUT' then -ledger.quantity else ledger.quantity end
        ), 0) as as_of_stock_qty
        from erp_inventory.stock_ledger ledger
        where ledger.company_id = document.company_id
          and ledger.storage_location_id = item.storage_location_id
          and ledger.material_id = item.material_id
          and upper(trim(ledger.stock_type_code)) = upper(trim(item.stock_type))
          and (item.batch_number is null or coalesce(ledger.batch_number, '') = item.batch_number)
          and ledger.created_at <= document.created_at
      ) as as_of_stock
      where as_of_stock.as_of_stock_qty <= 0
    )
)
delete from erp_procurement.physical_inventory_item item
using targets
where item.id = targets.id;
