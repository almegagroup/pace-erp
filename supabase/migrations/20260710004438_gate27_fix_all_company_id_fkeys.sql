/*
 * Migration: 20260710004438_gate27_fix_all_company_id_fkeys
 * Gate: 27.2
 * Purpose: Same company_id -> erp_master.projects copy-paste bug (fixed for
 *          stroke_master in the previous migration) existed across the rest
 *          of the Gate-27 schema. Repoint every erp_production.*.company_id
 *          FK at erp_master.companies(id).
 */

BEGIN;

ALTER TABLE erp_production.batch_number_series
  DROP CONSTRAINT batch_number_series_company_id_fkey;
ALTER TABLE erp_production.batch_number_series
  ADD CONSTRAINT batch_number_series_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES erp_master.companies(id);

ALTER TABLE erp_production.production_segment_location_config
  DROP CONSTRAINT production_segment_location_config_company_id_fkey;
ALTER TABLE erp_production.production_segment_location_config
  ADD CONSTRAINT production_segment_location_config_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES erp_master.companies(id);

ALTER TABLE erp_production.plan_feed
  DROP CONSTRAINT plan_feed_company_id_fkey;
ALTER TABLE erp_production.plan_feed
  ADD CONSTRAINT plan_feed_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES erp_master.companies(id);

ALTER TABLE erp_production.process_order
  DROP CONSTRAINT process_order_company_id_fkey;
ALTER TABLE erp_production.process_order
  ADD CONSTRAINT process_order_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES erp_master.companies(id);

ALTER TABLE erp_production.packing_order
  DROP CONSTRAINT packing_order_company_id_fkey;
ALTER TABLE erp_production.packing_order
  ADD CONSTRAINT packing_order_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES erp_master.companies(id);

COMMIT;
