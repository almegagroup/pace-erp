-- Variant is a descriptive configuration attribute, never part of the FG SKU.
-- One active configuration therefore exists for each Prodshade + Pack Code.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prodshade_pack_config_active_identity
  ON erp_production.prodshade_pack_config (material_id, pack_code_id)
  WHERE active = true;
