/*
 * Migration: 20260710011522_gate27_stroke_master_storage_location_fkeys
 * Gate: 27.2
 * Purpose: default_storage_location_id was added without a FK constraint.
 *          PostgREST's embed hint syntax (!default_storage_location_id) used
 *          in stroke_master.handlers.ts requires an actual FK to resolve the
 *          relationship — without it every list/get call 500'd.
 */

BEGIN;

ALTER TABLE erp_production.stroke_master
  ADD CONSTRAINT stroke_master_default_storage_location_id_fkey
    FOREIGN KEY (default_storage_location_id) REFERENCES erp_inventory.storage_location_master(id);

ALTER TABLE erp_production.stroke_line
  ADD CONSTRAINT stroke_line_default_storage_location_id_fkey
    FOREIGN KEY (default_storage_location_id) REFERENCES erp_inventory.storage_location_master(id);

COMMIT;
