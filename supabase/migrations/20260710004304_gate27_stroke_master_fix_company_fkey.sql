/*
 * Migration: 20260710004304_gate27_stroke_master_fix_company_fkey
 * Gate: 27.2
 * Purpose: stroke_master.company_id_fkey pointed at erp_master.projects instead
 *          of erp_master.companies (copy-paste error in the original Gate-27
 *          migration) — every real company_id violated the FK, causing every
 *          Stroke Master create to fail with a 500.
 */

BEGIN;

ALTER TABLE erp_production.stroke_master
  DROP CONSTRAINT stroke_master_company_id_fkey;

ALTER TABLE erp_production.stroke_master
  ADD CONSTRAINT stroke_master_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES erp_master.companies(id);

COMMIT;
