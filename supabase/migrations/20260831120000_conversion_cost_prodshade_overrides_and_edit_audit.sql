/*
 * AC04: Conversion-cost rates may be corrected in place, including converting a
 * segment default into a Prodshade override. Keep the original creator and add
 * an explicit last-edit audit trail for that business correction.
 */

ALTER TABLE erp_production.conversion_cost_config
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid NULL;

