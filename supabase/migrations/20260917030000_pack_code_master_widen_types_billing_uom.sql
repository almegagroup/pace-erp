-- pack_type: add CARTON + DRUM. Discovered while fixing the retail-pack multi-layer design
-- (§retail-pack-layers) that a 2-layer pack code's pack_type should represent the OUTER/
-- commercial dispatch identity (matching the existing Bag-vs-Jar duplication precedent), not
-- the inner layer -- e.g. 050 is dispatched as a Carton of Bottles, so its pack_type should be
-- CARTON, not BOTTLE (BOTTLE is fully captured by inner_uom_code already). DRUM was simply
-- missing from the original set.
ALTER TABLE erp_production.pack_code_master
  DROP CONSTRAINT pack_code_master_pack_type_check;

ALTER TABLE erp_production.pack_code_master
  ADD CONSTRAINT pack_code_master_pack_type_check
    CHECK (pack_type = ANY (ARRAY['BAG','BARREL','BOTTLE','CARTON','DRUM','IBC','JAR','MTEST','PACKET','TANKER']));

-- billing_uom: PER_UNIT/PER_KG replaced with PER_OUTER_UOM/PER_INNER_UOM/PER_BASE_UOM.
-- PER_KG hardcoded a KG assumption that doesn't hold once a SKU's base UOM can be LTR (or
-- anything else) -- PER_BASE_UOM resolves dynamically to whatever that SKU's own base UOM is.
-- PER_UNIT was ambiguous once a pack code can have 2 layers (per-outer-pack vs per-inner-pack
-- billing are genuinely different things) -- split into PER_OUTER_UOM/PER_INNER_UOM explicitly.
-- Verified via grep (backend + frontend) that no code branches on the old string values --
-- this field is currently selected/displayed only (AC07 costing, Packing PO), never consumed
-- in any calculation, so this rename carries no runtime behavior risk.
ALTER TABLE erp_production.pack_code_master
  DROP CONSTRAINT pack_code_master_billing_uom_check;

UPDATE erp_production.pack_code_master
SET billing_uom = CASE billing_uom
  WHEN 'PER_UNIT' THEN 'PER_OUTER_UOM'
  WHEN 'PER_KG' THEN 'PER_BASE_UOM'
  ELSE billing_uom
END;

ALTER TABLE erp_production.pack_code_master
  ADD CONSTRAINT pack_code_master_billing_uom_check
    CHECK (billing_uom = ANY (ARRAY['PER_OUTER_UOM','PER_INNER_UOM','PER_BASE_UOM']));
