-- plant_id was removed from inventory tables in June. This exact overload is
-- broken, has no active callers, and only remains as a legacy lint failure.
DROP FUNCTION IF EXISTS erp_inventory.post_stock_movement(
  text, date, date, text, uuid, uuid, uuid, uuid, numeric, text,
  numeric, text, text, uuid, uuid
);
