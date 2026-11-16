-- A Sub-CSN travels with its Mother: when the Mother is TRN, still-ORD
-- Sub-CSNs (not STO-linked) become TRN. Idempotent backfill.
UPDATE erp_procurement.consignment_note sub
SET status = 'TRN', last_updated_at = now()
FROM erp_procurement.consignment_note mother
WHERE sub.mother_csn_id = mother.id
  AND mother.status = 'TRN'
  AND sub.status = 'ORD'
  AND sub.sto_id IS NULL;

NOTIFY pgrst, 'reload schema';
