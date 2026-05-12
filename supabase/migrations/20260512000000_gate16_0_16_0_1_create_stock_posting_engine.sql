/*
 * File-ID: 16.0.1
 * File-Path: supabase/migrations/20260512000000_gate16_0_16_0_1_create_stock_posting_engine.sql
 * Gate: 16.0
 * Phase: 16
 * Domain: INVENTORY
 * Purpose: Atomic stock posting engine - stock_document + stock_ledger + stock_snapshot in one function.
 * Authority: Backend
 */

BEGIN;

CREATE OR REPLACE FUNCTION erp_inventory.post_stock_movement(
  p_document_number     text,
  p_document_date       date,
  p_posting_date        date,
  p_movement_type_code  text,
  p_company_id          uuid,
  p_plant_id            uuid,
  p_storage_location_id uuid,
  p_material_id         uuid,
  p_quantity            numeric(20,6),
  p_base_uom_code       text,
  p_unit_value          numeric(20,4),
  p_stock_type_code     text,
  p_direction           text,
  p_posted_by           uuid,
  p_reversal_of_id      uuid DEFAULT NULL
)
RETURNS TABLE (
  stock_document_id uuid,
  stock_ledger_id   uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_stock_doc_id     uuid;
  v_ledger_id        uuid;
  v_snapshot_id      uuid;
  v_old_qty          numeric(20,6);
  v_old_value        numeric(20,4);
  v_old_rate         numeric(20,6);
  v_new_qty          numeric(20,6);
  v_new_value        numeric(20,4);
  v_new_rate         numeric(20,6);
BEGIN
  IF p_direction NOT IN ('IN', 'OUT') THEN
    RAISE EXCEPTION 'INVALID_DIRECTION: must be IN or OUT';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: must be > 0';
  END IF;

  IF p_unit_value IS NULL OR p_unit_value < 0 THEN
    RAISE EXCEPTION 'INVALID_UNIT_VALUE: must be >= 0';
  END IF;

  PERFORM 1
  FROM erp_inventory.movement_type_master
  WHERE code = p_movement_type_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT_TYPE: %', p_movement_type_code;
  END IF;

  PERFORM 1
  FROM erp_inventory.stock_type_master
  WHERE code = p_stock_type_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_STOCK_TYPE: %', p_stock_type_code;
  END IF;

  PERFORM 1
  FROM erp_inventory.storage_location_master
  WHERE id = p_storage_location_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_STORAGE_LOCATION: %', p_storage_location_id;
  END IF;

  INSERT INTO erp_inventory.stock_document (
    document_number,
    document_date,
    posting_date,
    movement_type_code,
    company_id,
    plant_id,
    source_location_id,
    target_location_id,
    source_stock_type,
    target_stock_type,
    material_id,
    quantity,
    base_uom_code,
    value,
    valuation_rate,
    batch_id,
    posted_by,
    posted_at,
    status,
    reversal_document_id,
    created_by
  ) VALUES (
    p_document_number,
    p_document_date,
    p_posting_date,
    p_movement_type_code,
    p_company_id,
    p_plant_id,
    CASE WHEN p_direction = 'OUT' THEN p_storage_location_id ELSE NULL END,
    CASE WHEN p_direction = 'IN' THEN p_storage_location_id ELSE NULL END,
    CASE WHEN p_direction = 'OUT' THEN p_stock_type_code ELSE NULL END,
    CASE WHEN p_direction = 'IN' THEN p_stock_type_code ELSE NULL END,
    p_material_id,
    p_quantity,
    p_base_uom_code,
    p_quantity * p_unit_value,
    p_unit_value,
    NULL,
    p_posted_by,
    now(),
    'POSTED',
    p_reversal_of_id,
    p_posted_by
  )
  RETURNING id INTO v_stock_doc_id;

  INSERT INTO erp_inventory.stock_ledger (
    stock_document_id,
    posting_date,
    company_id,
    plant_id,
    storage_location_id,
    material_id,
    batch_id,
    stock_type_code,
    movement_type_code,
    direction,
    quantity,
    base_uom_code,
    value,
    valuation_rate,
    created_by
  ) VALUES (
    v_stock_doc_id,
    p_posting_date,
    p_company_id,
    p_plant_id,
    p_storage_location_id,
    p_material_id,
    NULL,
    p_stock_type_code,
    p_movement_type_code,
    p_direction,
    p_quantity,
    p_base_uom_code,
    p_quantity * p_unit_value,
    p_unit_value,
    p_posted_by
  )
  RETURNING id INTO v_ledger_id;

  SELECT
    id,
    quantity,
    value,
    valuation_rate
  INTO
    v_snapshot_id,
    v_old_qty,
    v_old_value,
    v_old_rate
  FROM erp_inventory.stock_snapshot
  WHERE company_id = p_company_id
    AND plant_id = p_plant_id
    AND storage_location_id = p_storage_location_id
    AND material_id = p_material_id
    AND stock_type_code = p_stock_type_code
    AND batch_id IS NULL
  FOR UPDATE;

  IF p_direction = 'IN' THEN
    IF v_snapshot_id IS NULL THEN
      v_new_qty := p_quantity;
      v_new_value := p_quantity * p_unit_value;
      v_new_rate := CASE
        WHEN v_new_qty = 0 THEN p_unit_value
        ELSE v_new_value / v_new_qty
      END;

      INSERT INTO erp_inventory.stock_snapshot (
        company_id,
        plant_id,
        storage_location_id,
        material_id,
        batch_id,
        stock_type_code,
        quantity,
        base_uom_code,
        value,
        valuation_rate,
        last_ledger_id,
        last_updated_at
      ) VALUES (
        p_company_id,
        p_plant_id,
        p_storage_location_id,
        p_material_id,
        NULL,
        p_stock_type_code,
        v_new_qty,
        p_base_uom_code,
        v_new_value,
        v_new_rate,
        v_ledger_id,
        now()
      );
    ELSE
      v_new_qty := v_old_qty + p_quantity;
      v_new_value := v_old_value + (p_quantity * p_unit_value);
      v_new_rate := CASE
        WHEN v_new_qty = 0 THEN p_unit_value
        ELSE v_new_value / v_new_qty
      END;

      UPDATE erp_inventory.stock_snapshot
      SET quantity = v_new_qty,
          base_uom_code = p_base_uom_code,
          value = v_new_value,
          valuation_rate = v_new_rate,
          last_ledger_id = v_ledger_id,
          last_updated_at = now()
      WHERE id = v_snapshot_id;
    END IF;
  ELSE
    IF v_snapshot_id IS NULL THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK';
    END IF;

    v_new_qty := v_old_qty - p_quantity;

    IF v_new_qty < 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK';
    END IF;

    v_new_value := v_old_value - (p_quantity * v_old_rate);
    v_new_rate := v_old_rate;

    UPDATE erp_inventory.stock_snapshot
    SET quantity = v_new_qty,
        base_uom_code = p_base_uom_code,
        value = CASE WHEN v_new_value < 0 THEN 0 ELSE v_new_value END,
        valuation_rate = v_new_rate,
        last_ledger_id = v_ledger_id,
        last_updated_at = now()
    WHERE id = v_snapshot_id;
  END IF;

  RETURN QUERY
  SELECT v_stock_doc_id, v_ledger_id;
END;
$$;

GRANT EXECUTE ON FUNCTION erp_inventory.post_stock_movement(
  text,
  date,
  date,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  numeric,
  text,
  numeric,
  text,
  text,
  uuid,
  uuid
) TO service_role;

COMMIT;
