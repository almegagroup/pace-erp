/*
 * File-ID: 11.2
 * File-Path: supabase/migrations/20260509101000_gate11_11_2_create_movement_type_master.sql
 * Gate: 11
 * Phase: 11
 * Domain: INVENTORY
 * Purpose: Create the movement_type_master table for all valid stock movements.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.movement_type_master (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The PACE P-prefix code. e.g. P101, P261, P321
  code                        text NOT NULL UNIQUE,
  name                        text NOT NULL,

  -- IN = stock increases, OUT = stock decreases, TRANSFER = both sides change
  direction                   text NOT NULL CHECK (direction IN ('IN', 'OUT', 'TRANSFER')),

  -- Which stock type does this movement read from (source)?
  -- NULL means no source deduction (e.g. opening stock P561)
  source_stock_type           text NULL,

  -- Which stock type does this movement write to (target)?
  -- NULL means stock is consumed/destroyed (e.g. scrap P551)
  target_stock_type           text NULL,

  -- What document must be referenced when this movement is posted?
  -- NULL means no reference required
  reference_document_required boolean NOT NULL DEFAULT false,
  reference_document_type     text NULL,
  -- Valid values: PO, PROCESS_ORDER, PACKING_ORDER, DISPATCH_INSTRUCTION,
  --               PID_DOCUMENT, PLANT_TRANSFER_ORDER, OPENING_STOCK

  -- Which movement type reverses this one? e.g. P102 reverses P101
  reversal_of                 text NULL REFERENCES erp_inventory.movement_type_master(code),
  reversed_by                 text NULL,

  -- If true: only role-restricted users can post this movement
  role_restricted             boolean NOT NULL DEFAULT false,

  -- If true: approval required before posting
  approval_required           boolean NOT NULL DEFAULT false,

  -- If true: this is a PACE custom movement (901-999 range)
  is_custom                   boolean NOT NULL DEFAULT false,

  -- SA can deactivate a movement type to prevent its use
  active                      boolean NOT NULL DEFAULT true,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NULL
);

COMMENT ON TABLE erp_inventory.movement_type_master IS
'Master list of all valid PACE-ERP stock movements. P-prefix. SA-locked. No movement posts without an active record here.';

COMMENT ON COLUMN erp_inventory.movement_type_master.code IS
'PACE P-prefix movement code. e.g. P101, P261, P321. Stored as-is in stock_ledger.';

COMMENT ON COLUMN erp_inventory.movement_type_master.role_restricted IS
'If true, only users with explicit role permission can post this movement. Used for FOR_REPROCESS movements (P901-P906).';

COMMIT;
