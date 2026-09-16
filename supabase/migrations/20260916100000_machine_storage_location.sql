/*
 * File-Path: supabase/migrations/20260916100000_machine_storage_location.sql
 * Domain: MASTER / PRODUCTION
 * Purpose: Machine + Storage Location mapping (feasibility doc §138.1) --
 *          MTS machine-respect shop floor stock tracking's foundation.
 *          A machine sits at exactly one storage location at a time
 *          (single FK, not a many-to-many map like machine_po_type_map --
 *          business owner explicitly locked single-location cardinality,
 *          re-mappable later but never more than one active location).
 * Authority: Backend
 */

BEGIN;

ALTER TABLE erp_master.machine_master
  ADD COLUMN IF NOT EXISTS storage_location_id uuid NULL
    REFERENCES erp_inventory.storage_location_master(id);

COMMENT ON COLUMN erp_master.machine_master.storage_location_id IS
'Which storage location this machine physically sits at (§138.1) -- NULL until SA maps it via SA Machine Master''s Sloc Mapping tab. Single location per machine, re-mappable, never many-to-many. Used to filter the Process PO Standard machine dropdown by the selected Stroke''s default_storage_location_id.';

CREATE INDEX IF NOT EXISTS idx_machine_master_storage_location
  ON erp_master.machine_master (storage_location_id);

COMMIT;
