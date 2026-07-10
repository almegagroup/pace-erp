/*
 * Migration: 20260710061955_gate27_stroke_change_request_group_fkeys
 * Gate: 27.3
 * Purpose: old_group_id/new_group_id on stroke_change_request_line had no FK,
 *          unlike stroke_line.material_group_id. Add for integrity/consistency
 *          now that the handler actually reads/writes these columns correctly.
 */

BEGIN;

ALTER TABLE erp_production.stroke_change_request_line
  ADD CONSTRAINT stroke_change_request_line_old_group_id_fkey
    FOREIGN KEY (old_group_id) REFERENCES erp_master.material_category_group(id);

ALTER TABLE erp_production.stroke_change_request_line
  ADD CONSTRAINT stroke_change_request_line_new_group_id_fkey
    FOREIGN KEY (new_group_id) REFERENCES erp_master.material_category_group(id);

COMMIT;
