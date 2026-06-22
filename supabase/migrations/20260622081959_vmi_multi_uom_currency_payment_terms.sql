-- Vendor-Material Link (VMI / ASL) redesign:
-- A vendor-material pair can be supplied in more than one UOM (e.g. Tanker
-- one delivery, Barrel the next), more than one currency, and more than one
-- payment term. Each list carries a single default, selectable/overridable
-- at PO creation time. Conversion factors here are vendor-specific (how this
-- vendor packs/delivers) and are intentionally independent of Material
-- Master's own alternate-UOM chain (which is for internal stock/PID
-- counting and is vendor-agnostic).
--
-- lead_time_days, po_uom_code, conversion_factor, variable_conversion are
-- dropped from the header row: lead time belongs to the separate Import/
-- Domestic Lead Time Masters, and UOM/conversion now lives in its own list
-- table below.

ALTER TABLE erp_master.vendor_material_info
  DROP COLUMN IF EXISTS po_uom_code,
  DROP COLUMN IF EXISTS conversion_factor,
  DROP COLUMN IF EXISTS variable_conversion,
  DROP COLUMN IF EXISTS lead_time_days;

CREATE TABLE erp_master.vendor_material_uom (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vmi_id uuid NOT NULL REFERENCES erp_master.vendor_material_info(id) ON DELETE CASCADE,
  uom_code text NOT NULL REFERENCES erp_master.uom_master(code),
  conversion_factor numeric NOT NULL CHECK (conversion_factor > 0),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  UNIQUE (vmi_id, uom_code)
);

CREATE UNIQUE INDEX ux_vendor_material_uom_one_default
  ON erp_master.vendor_material_uom (vmi_id)
  WHERE is_default;

CREATE TABLE erp_master.vendor_material_currency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vmi_id uuid NOT NULL REFERENCES erp_master.vendor_material_info(id) ON DELETE CASCADE,
  currency_code text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  UNIQUE (vmi_id, currency_code)
);

CREATE UNIQUE INDEX ux_vendor_material_currency_one_default
  ON erp_master.vendor_material_currency (vmi_id)
  WHERE is_default;

CREATE TABLE erp_master.vendor_material_payment_term (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vmi_id uuid NOT NULL REFERENCES erp_master.vendor_material_info(id) ON DELETE CASCADE,
  payment_term_id uuid NOT NULL REFERENCES erp_master.payment_terms_master(id),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  UNIQUE (vmi_id, payment_term_id)
);

CREATE UNIQUE INDEX ux_vendor_material_payment_term_one_default
  ON erp_master.vendor_material_payment_term (vmi_id)
  WHERE is_default;
