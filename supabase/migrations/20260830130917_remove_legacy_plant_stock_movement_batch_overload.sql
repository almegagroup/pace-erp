-- The only remaining plant-aware overload has a trailing batch_number
-- parameter. Its referenced plant_id columns no longer exist.
DROP FUNCTION IF EXISTS erp_inventory.post_stock_movement(
  text, date, date, text, uuid, uuid, uuid, uuid, numeric, text,
  numeric, text, text, uuid, uuid, text
);
