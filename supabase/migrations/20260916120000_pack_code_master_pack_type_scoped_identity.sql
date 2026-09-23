-- Pack Code Master: pack_code identity was globally UNIQUE(pack_code), but FG SKUs must mirror
-- Asian Paints' own external SKU numbering, which reuses the same trailing digits across
-- different physical pack types (e.g. their "...320" means a 20 KG Bag for one product family
-- and a 20 Ltr Jar/Drum for another). Scope uniqueness to (pack_code, pack_type) so both can
-- coexist as separate pack_code_master rows.
--
-- Also adds inner_uom_code: retail-pack FG (pack codes 050-250 range) commonly has TWO alternate
-- packaging layers, not one — e.g. Bottle (inner, holds product) packed into a Carton (outer,
-- dispatch unit). outer_uom_code already captures the outer/dispatch layer; inner_uom_code now
-- declares the inner layer at the pack-code identity level (shared across every SKU using that
-- pack code), so Pack BOM can validate which PM line fills that role instead of relying purely
-- on a free-standing is_primary_container checkbox. NULL means single-layer (e.g. Barrel, Bag
-- with no separate outer carton).

ALTER TABLE erp_production.pack_code_master
  DROP CONSTRAINT pack_code_master_pack_code_key;

ALTER TABLE erp_production.pack_code_master
  ADD CONSTRAINT pack_code_master_pack_code_pack_type_key UNIQUE (pack_code, pack_type);

ALTER TABLE erp_production.pack_code_master
  ADD COLUMN inner_uom_code text NULL
    REFERENCES erp_master.uom_master(code);

COMMENT ON COLUMN erp_production.pack_code_master.inner_uom_code IS
'Inner packaging layer UOM (e.g. Bottle, Pouch) for pack codes with 2 alternate layers. NULL = single-layer pack code. outer_uom_code is the dispatch/outer layer.';
