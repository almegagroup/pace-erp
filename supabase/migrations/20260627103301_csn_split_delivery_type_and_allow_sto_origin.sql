-- Allow CSNs to originate from an STO (INTER_PLANT) instead of a PO
ALTER TABLE erp_procurement.consignment_note ALTER COLUMN po_id DROP NOT NULL;
ALTER TABLE erp_procurement.consignment_note ALTER COLUMN po_line_id DROP NOT NULL;

-- Every CSN must trace back to either a PO or an STO
ALTER TABLE erp_procurement.consignment_note
  ADD CONSTRAINT consignment_note_origin_check CHECK (po_id IS NOT NULL OR sto_id IS NOT NULL);

-- Split csn_type's overloaded BULK value into a separate delivery_type dimension (mirrors purchase_order.delivery_type)
ALTER TABLE erp_procurement.consignment_note ADD COLUMN delivery_type text;

UPDATE erp_procurement.consignment_note cn
SET delivery_type = COALESCE(po.delivery_type, 'STANDARD')
FROM erp_procurement.purchase_order po
WHERE cn.po_id = po.id;

UPDATE erp_procurement.consignment_note
SET delivery_type = 'STANDARD'
WHERE delivery_type IS NULL;

ALTER TABLE erp_procurement.consignment_note ALTER COLUMN delivery_type SET NOT NULL;
ALTER TABLE erp_procurement.consignment_note
  ADD CONSTRAINT consignment_note_delivery_type_check CHECK (delivery_type = ANY (ARRAY['STANDARD','BULK','TANKER']));

-- csn_type now only carries IMPORT/DOMESTIC (BULK moved to delivery_type above)
UPDATE erp_procurement.consignment_note SET csn_type = 'DOMESTIC' WHERE csn_type = 'BULK';

ALTER TABLE erp_procurement.consignment_note DROP CONSTRAINT consignment_note_csn_type_check;
ALTER TABLE erp_procurement.consignment_note
  ADD CONSTRAINT consignment_note_csn_type_check CHECK (csn_type = ANY (ARRAY['IMPORT','DOMESTIC']));
