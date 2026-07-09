/*
 * File-Path: supabase/migrations/20260709025725_stock_document_item_number.sql
 * Domain: INVENTORY (stock posting engine, Gate-16.0)
 * Purpose: SAP MKPF/MSEG-style fix — one business document_number can have multiple
 *          movement items (e.g. a RELEASE usage decision's OUT-then-IN pair, or two
 *          partial-decision batches on the same QA document, or RTV's direct-path
 *          block-out+block-in+return triple). document_number previously had a bare
 *          UNIQUE constraint, so any second post_stock_movement() call reusing the same
 *          business document number always collided (23505) after the first committed —
 *          discovered via the Inward QA usage-decision flow, same latent bug also present
 *          in rtv.handlers.ts's isDirectPath (3 calls, same rtv_number).
 * Authority: Backend
 */

BEGIN;

ALTER TABLE erp_inventory.stock_document
  ADD COLUMN IF NOT EXISTS item_number integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN erp_inventory.stock_document.item_number IS
'Item number within document_number, mirroring SAP MKPF (header, document_number) / MSEG (item, item_number). Auto-assigned by post_stock_movement() as MAX(item_number)+1 for the given document_number — callers never set this.';

ALTER TABLE erp_inventory.stock_document
  DROP CONSTRAINT IF EXISTS stock_document_document_number_key;

ALTER TABLE erp_inventory.stock_document
  ADD CONSTRAINT stock_document_document_number_item_number_key UNIQUE (document_number, item_number);

-- ── post_stock_movement (no plant_id) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION erp_inventory.post_stock_movement(
  p_document_number text,
  p_document_date date,
  p_posting_date date,
  p_movement_type_code text,
  p_company_id uuid,
  p_storage_location_id uuid,
  p_material_id uuid,
  p_quantity numeric,
  p_base_uom_code text,
  p_unit_value numeric,
  p_stock_type_code text,
  p_direction text,
  p_posted_by uuid,
  p_reversal_of_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(stock_document_id uuid, stock_ledger_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_stock_doc_id     uuid;
  v_ledger_id        uuid;
  v_item_number      integer;
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

  PERFORM 1 FROM erp_inventory.movement_type_master WHERE code = p_movement_type_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT_TYPE: %', p_movement_type_code;
  END IF;

  PERFORM 1 FROM erp_inventory.stock_type_master WHERE code = p_stock_type_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_STOCK_TYPE: %', p_stock_type_code;
  END IF;

  PERFORM 1 FROM erp_inventory.storage_location_master WHERE id = p_storage_location_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_STORAGE_LOCATION: %', p_storage_location_id;
  END IF;

  -- SAP MSEG-style item numbering: next item under this document_number. Existing rows
  -- for this document_number are locked first so concurrent calls for the same document
  -- serialize instead of racing on the same item_number.
  PERFORM 1 FROM erp_inventory.stock_document WHERE document_number = p_document_number FOR UPDATE;
  SELECT COALESCE(MAX(item_number), 0) + 1 INTO v_item_number
  FROM erp_inventory.stock_document
  WHERE document_number = p_document_number;

  INSERT INTO erp_inventory.stock_document (
    document_number, item_number, document_date, posting_date, movement_type_code,
    company_id, source_location_id, target_location_id, source_stock_type, target_stock_type,
    material_id, quantity, base_uom_code, value, valuation_rate, batch_id,
    posted_by, posted_at, status, reversal_document_id, created_by
  ) VALUES (
    p_document_number, v_item_number, p_document_date, p_posting_date, p_movement_type_code,
    p_company_id,
    CASE WHEN p_direction = 'OUT' THEN p_storage_location_id ELSE NULL END,
    CASE WHEN p_direction = 'IN'  THEN p_storage_location_id ELSE NULL END,
    CASE WHEN p_direction = 'OUT' THEN p_stock_type_code ELSE NULL END,
    CASE WHEN p_direction = 'IN'  THEN p_stock_type_code ELSE NULL END,
    p_material_id, p_quantity, p_base_uom_code, p_quantity * p_unit_value, p_unit_value, NULL,
    p_posted_by, now(), 'POSTED', p_reversal_of_id, p_posted_by
  )
  RETURNING id INTO v_stock_doc_id;

  INSERT INTO erp_inventory.stock_ledger (
    stock_document_id, posting_date, company_id, storage_location_id, material_id, batch_id,
    stock_type_code, movement_type_code, direction, quantity, base_uom_code, value,
    valuation_rate, created_by
  ) VALUES (
    v_stock_doc_id, p_posting_date, p_company_id, p_storage_location_id, p_material_id, NULL,
    p_stock_type_code, p_movement_type_code, p_direction, p_quantity, p_base_uom_code,
    p_quantity * p_unit_value, p_unit_value, p_posted_by
  )
  RETURNING id INTO v_ledger_id;

  SELECT id, quantity, value, valuation_rate
    INTO v_snapshot_id, v_old_qty, v_old_value, v_old_rate
  FROM erp_inventory.stock_snapshot
  WHERE company_id = p_company_id
    AND storage_location_id = p_storage_location_id
    AND material_id = p_material_id
    AND stock_type_code = p_stock_type_code
    AND batch_id IS NULL
  FOR UPDATE;

  IF p_direction = 'IN' THEN
    IF v_snapshot_id IS NULL THEN
      v_new_qty := p_quantity;
      v_new_value := p_quantity * p_unit_value;
      v_new_rate := CASE WHEN v_new_qty = 0 THEN p_unit_value ELSE v_new_value / v_new_qty END;

      INSERT INTO erp_inventory.stock_snapshot (
        company_id, storage_location_id, material_id, batch_id, stock_type_code,
        quantity, base_uom_code, value, valuation_rate, last_ledger_id, last_updated_at
      ) VALUES (
        p_company_id, p_storage_location_id, p_material_id, NULL, p_stock_type_code,
        v_new_qty, p_base_uom_code, v_new_value, v_new_rate, v_ledger_id, now()
      );
    ELSE
      v_new_qty := v_old_qty + p_quantity;
      v_new_value := v_old_value + (p_quantity * p_unit_value);
      v_new_rate := CASE WHEN v_new_qty = 0 THEN p_unit_value ELSE v_new_value / v_new_qty END;

      UPDATE erp_inventory.stock_snapshot
      SET quantity = v_new_qty, base_uom_code = p_base_uom_code, value = v_new_value,
          valuation_rate = v_new_rate, last_ledger_id = v_ledger_id, last_updated_at = now()
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
    SET quantity = v_new_qty, base_uom_code = p_base_uom_code,
        value = CASE WHEN v_new_value < 0 THEN 0 ELSE v_new_value END,
        valuation_rate = v_new_rate, last_ledger_id = v_ledger_id, last_updated_at = now()
    WHERE id = v_snapshot_id;
  END IF;

  RETURN QUERY SELECT v_stock_doc_id, v_ledger_id;
END;
$function$;

-- ── post_stock_movement (with plant_id) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION erp_inventory.post_stock_movement(
  p_document_number text,
  p_document_date date,
  p_posting_date date,
  p_movement_type_code text,
  p_company_id uuid,
  p_plant_id uuid,
  p_storage_location_id uuid,
  p_material_id uuid,
  p_quantity numeric,
  p_base_uom_code text,
  p_unit_value numeric,
  p_stock_type_code text,
  p_direction text,
  p_posted_by uuid,
  p_reversal_of_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(stock_document_id uuid, stock_ledger_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_stock_doc_id     uuid;
  v_ledger_id        uuid;
  v_item_number      integer;
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

  PERFORM 1 FROM erp_inventory.movement_type_master WHERE code = p_movement_type_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT_TYPE: %', p_movement_type_code;
  END IF;

  PERFORM 1 FROM erp_inventory.stock_type_master WHERE code = p_stock_type_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_STOCK_TYPE: %', p_stock_type_code;
  END IF;

  PERFORM 1 FROM erp_inventory.storage_location_master WHERE id = p_storage_location_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_STORAGE_LOCATION: %', p_storage_location_id;
  END IF;

  PERFORM 1 FROM erp_inventory.stock_document WHERE document_number = p_document_number FOR UPDATE;
  SELECT COALESCE(MAX(item_number), 0) + 1 INTO v_item_number
  FROM erp_inventory.stock_document
  WHERE document_number = p_document_number;

  INSERT INTO erp_inventory.stock_document (
    document_number, item_number, document_date, posting_date, movement_type_code,
    company_id, plant_id, source_location_id, target_location_id, source_stock_type, target_stock_type,
    material_id, quantity, base_uom_code, value, valuation_rate, batch_id,
    posted_by, posted_at, status, reversal_document_id, created_by
  ) VALUES (
    p_document_number, v_item_number, p_document_date, p_posting_date, p_movement_type_code,
    p_company_id, p_plant_id,
    CASE WHEN p_direction = 'OUT' THEN p_storage_location_id ELSE NULL END,
    CASE WHEN p_direction = 'IN' THEN p_storage_location_id ELSE NULL END,
    CASE WHEN p_direction = 'OUT' THEN p_stock_type_code ELSE NULL END,
    CASE WHEN p_direction = 'IN' THEN p_stock_type_code ELSE NULL END,
    p_material_id, p_quantity, p_base_uom_code, p_quantity * p_unit_value, p_unit_value, NULL,
    p_posted_by, now(), 'POSTED', p_reversal_of_id, p_posted_by
  )
  RETURNING id INTO v_stock_doc_id;

  INSERT INTO erp_inventory.stock_ledger (
    stock_document_id, posting_date, company_id, plant_id, storage_location_id, material_id, batch_id,
    stock_type_code, movement_type_code, direction, quantity, base_uom_code, value,
    valuation_rate, created_by
  ) VALUES (
    v_stock_doc_id, p_posting_date, p_company_id, p_plant_id, p_storage_location_id, p_material_id, NULL,
    p_stock_type_code, p_movement_type_code, p_direction, p_quantity, p_base_uom_code,
    p_quantity * p_unit_value, p_unit_value, p_posted_by
  )
  RETURNING id INTO v_ledger_id;

  SELECT id, quantity, value, valuation_rate
    INTO v_snapshot_id, v_old_qty, v_old_value, v_old_rate
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
      v_new_rate := CASE WHEN v_new_qty = 0 THEN p_unit_value ELSE v_new_value / v_new_qty END;

      INSERT INTO erp_inventory.stock_snapshot (
        company_id, plant_id, storage_location_id, material_id, batch_id, stock_type_code,
        quantity, base_uom_code, value, valuation_rate, last_ledger_id, last_updated_at
      ) VALUES (
        p_company_id, p_plant_id, p_storage_location_id, p_material_id, NULL, p_stock_type_code,
        v_new_qty, p_base_uom_code, v_new_value, v_new_rate, v_ledger_id, now()
      );
    ELSE
      v_new_qty := v_old_qty + p_quantity;
      v_new_value := v_old_value + (p_quantity * p_unit_value);
      v_new_rate := CASE WHEN v_new_qty = 0 THEN p_unit_value ELSE v_new_value / v_new_qty END;

      UPDATE erp_inventory.stock_snapshot
      SET quantity = v_new_qty, base_uom_code = p_base_uom_code, value = v_new_value,
          valuation_rate = v_new_rate, last_ledger_id = v_ledger_id, last_updated_at = now()
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
    SET quantity = v_new_qty, base_uom_code = p_base_uom_code,
        value = CASE WHEN v_new_value < 0 THEN 0 ELSE v_new_value END,
        valuation_rate = v_new_rate, last_ledger_id = v_ledger_id, last_updated_at = now()
    WHERE id = v_snapshot_id;
  END IF;

  RETURN QUERY SELECT v_stock_doc_id, v_ledger_id;
END;
$function$;

COMMIT;
