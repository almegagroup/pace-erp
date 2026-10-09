BEGIN;

-- §6 (FG-STO-MTS-DISPATCH-DESIGN-DOC.md) — the Sales/Dispatch-domain "FO
-- Number" (Asian Paints' own per-dispatch-occasion number, from their Tally
-- "Other References" column, S-prefix "5005...") is a DIFFERENT concept from
-- erp_production.plan_feed.fo_number (Production's own Plan Feed FO, §83.18).
-- MTS never uses plan_feed, so a VDC (Dependent Direct) dispatch's Ship-To
-- group is always the existing "address" source (customer_address_id set,
-- fo_id NULL) -- this column gives that group its own external FO identity,
-- additive to the existing sales_order_map_group shape (§133.9), no existing
-- column/constraint touched.
ALTER TABLE erp_procurement.sales_order_map_group
  ADD COLUMN IF NOT EXISTS external_fo_number text;

-- One FO Number is unique within its own SO (business rule: a repeat
-- dispatch to the same customer under the same SO gets a NEW FO Number) --
-- never globally unique, since FO numbering is Asian Paints' own series.
CREATE UNIQUE INDEX IF NOT EXISTS ux_so_map_group_so_external_fo_number
  ON erp_procurement.sales_order_map_group (so_id, external_fo_number)
  WHERE external_fo_number IS NOT NULL;

NOTIFY pgrst, 'reload schema';
COMMIT;
