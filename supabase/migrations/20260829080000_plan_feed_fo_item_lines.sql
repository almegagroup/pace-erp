-- FO header/item-line foundation. Existing plan_feed rows remain the canonical
-- FO header for compatibility; every existing row is backfilled as its first
-- item line before new mixed-item FO flows are enabled.
BEGIN;

CREATE TABLE IF NOT EXISTS erp_production.plan_feed_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_feed_id uuid NOT NULL REFERENCES erp_production.plan_feed(id) ON DELETE CASCADE,
  material_id uuid REFERENCES erp_master.material_master(id),
  sku text,
  description text,
  ordered_qty_kg numeric(14,4) NOT NULL CHECK (ordered_qty_kg > 0),
  pack_qty integer,
  ordered_stroke_number text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_feed_id, material_id, sku)
);

INSERT INTO erp_production.plan_feed_item (
  plan_feed_id, material_id, sku, description, ordered_qty_kg, pack_qty,
  ordered_stroke_number, created_by, created_at, last_updated_by, last_updated_at
)
SELECT id, material_id, sku, description, ordered_qty_kg, pack_qty,
  ordered_stroke_number, created_by, created_at, last_updated_by, last_updated_at
FROM erp_production.plan_feed
ON CONFLICT (plan_feed_id, material_id, sku) DO NOTHING;

ALTER TABLE erp_procurement.sales_order_map_allocation
  ADD COLUMN IF NOT EXISTS plan_feed_item_id uuid
    REFERENCES erp_production.plan_feed_item(id);

ALTER TABLE erp_production.plan_feed_packing_order_allocation
  ADD COLUMN IF NOT EXISTS plan_feed_item_id uuid
    REFERENCES erp_production.plan_feed_item(id);

UPDATE erp_production.plan_feed_packing_order_allocation allocation
SET plan_feed_item_id = item.id
FROM erp_production.plan_feed_item item
WHERE item.plan_feed_id = allocation.plan_feed_id
  AND item.material_id = (SELECT material_id FROM erp_production.packing_order po WHERE po.id = allocation.packing_order_id)
  AND allocation.plan_feed_item_id IS NULL;

-- Legacy SO Map rows did not carry an item-line reference. Backfill only an
-- unambiguous material match; unresolved historic mismatches remain NULL and
-- are never guessed into the wrong FO item.
WITH legacy_item_matches AS (
  SELECT
    allocation.id AS allocation_id,
    item.id AS plan_feed_item_id,
    count(*) OVER (PARTITION BY allocation.id) AS match_count
  FROM erp_procurement.sales_order_map_allocation allocation
  JOIN erp_procurement.sales_order_line so_line ON so_line.id = allocation.so_line_id
  JOIN erp_production.plan_feed_item item
    ON item.plan_feed_id = allocation.fo_id
   AND item.material_id = so_line.material_id
  WHERE allocation.fo_id IS NOT NULL
    AND allocation.plan_feed_item_id IS NULL
)
UPDATE erp_procurement.sales_order_map_allocation allocation
SET plan_feed_item_id = legacy_item_matches.plan_feed_item_id
FROM legacy_item_matches
WHERE allocation.id = legacy_item_matches.allocation_id
  AND legacy_item_matches.match_count = 1;

CREATE OR REPLACE FUNCTION erp_production.assert_plan_feed_allocation_item_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  item_fo_id uuid;
BEGIN
  IF NEW.plan_feed_item_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT plan_feed_id INTO item_fo_id
  FROM erp_production.plan_feed_item
  WHERE id = NEW.plan_feed_item_id;
  IF item_fo_id IS NULL OR item_fo_id <> NEW.plan_feed_id THEN
    RAISE EXCEPTION 'plan_feed_item_id must belong to allocation plan_feed_id'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION erp_procurement.assert_so_map_allocation_item_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  item_fo_id uuid;
BEGIN
  IF NEW.plan_feed_item_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT plan_feed_id INTO item_fo_id
  FROM erp_production.plan_feed_item
  WHERE id = NEW.plan_feed_item_id;
  IF item_fo_id IS NULL OR item_fo_id <> NEW.fo_id THEN
    RAISE EXCEPTION 'plan_feed_item_id must belong to allocation fo_id'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_plan_feed_packing_order_allocation_item_owner
  ON erp_production.plan_feed_packing_order_allocation;
CREATE TRIGGER trg_plan_feed_packing_order_allocation_item_owner
  BEFORE INSERT OR UPDATE OF plan_feed_id, plan_feed_item_id
  ON erp_production.plan_feed_packing_order_allocation
  FOR EACH ROW EXECUTE FUNCTION erp_production.assert_plan_feed_allocation_item_owner();

DROP TRIGGER IF EXISTS trg_sales_order_map_allocation_item_owner
  ON erp_procurement.sales_order_map_allocation;
CREATE TRIGGER trg_sales_order_map_allocation_item_owner
  BEFORE INSERT OR UPDATE OF fo_id, plan_feed_item_id
  ON erp_procurement.sales_order_map_allocation
  FOR EACH ROW EXECUTE FUNCTION erp_procurement.assert_so_map_allocation_item_owner();

CREATE INDEX IF NOT EXISTS idx_plan_feed_item_fo ON erp_production.plan_feed_item(plan_feed_id);
CREATE INDEX IF NOT EXISTS idx_pfpoa_fo_item ON erp_production.plan_feed_packing_order_allocation(plan_feed_item_id)
  WHERE plan_feed_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_so_map_allocation_fo_item ON erp_procurement.sales_order_map_allocation(plan_feed_item_id)
  WHERE plan_feed_item_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON erp_production.plan_feed_item TO service_role;
COMMENT ON TABLE erp_production.plan_feed_item IS
  'Mixed-item FO lines. plan_feed remains the FO header/legacy first-line record during the staged migration.';

NOTIFY pgrst, 'reload schema';
COMMIT;
