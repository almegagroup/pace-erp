/*
 * Migration: 20261019130000_po22_planning_location_policy
 * Purpose:   PO22 counted-stock locations per company (owner decisions D1 / D9 / D12, 2026-10-19,
 *            common:docs/po22-common/OWNER-DECISIONS-2026-10-19-REQUIREMENT-AND-GROUPS.md).
 *
 *   role COUNTED          stock counts as usable (pooled over all counted locations of the company);
 *   role TRANSFER_SOURCE  stock is shown, never counted, and referred for an R→R transfer (R003 only);
 *   role EXCLUDED         stock is neither counted nor referred (OT01 / OT02, F-series FG, admix S/P/T/L 003).
 *   A plant location without a row is treated as TRANSFER_SOURCE by the engine (shown, not counted).
 *
 *   Seeds CMP003 / CMP005 / CMP011 from erp_inventory.storage_location_plant_map by location code
 *   (codes are identical in DEV and PROD; UUIDs are not). Re-runnable (ON CONFLICT DO NOTHING keeps
 *   any role the user changed later).
 *   After applying (owner approval required): NOTIFY pgrst, 'reload schema'; reconcile schema_migrations;
 *   run migration-integrity-check.
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_planning.company_planning_location_policy (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES erp_master.companies(id),
  storage_location_id uuid NOT NULL REFERENCES erp_inventory.storage_location_master(id),
  role                text NOT NULL CHECK (role IN ('COUNTED', 'TRANSFER_SOURCE', 'EXCLUDED')),
  remarks             text CHECK (remarks IS NULL OR length(remarks) <= 300),
  updated_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_company_planning_location_policy UNIQUE (company_id, storage_location_id)
);
COMMENT ON TABLE erp_planning.company_planning_location_policy IS
  'PO22 planning role of each company storage location: COUNTED (usable, pooled), TRANSFER_SOURCE (shown + transfer referral, not counted), EXCLUDED. Owner D1/D12.';
ALTER TABLE erp_planning.company_planning_location_policy ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON erp_planning.company_planning_location_policy TO service_role;

INSERT INTO erp_planning.company_planning_location_policy (company_id, storage_location_id, role, remarks)
SELECT m.company_id, s.id,
       CASE
         WHEN s.code IN ('R001', 'R002', 'S001', 'S002', 'P001', 'P002') THEN 'COUNTED'
         WHEN s.code = 'R003' THEN 'TRANSFER_SOURCE'
         ELSE 'EXCLUDED'
       END,
       'Seeded from owner decision D12 (2026-10-19)'
FROM erp_inventory.storage_location_plant_map m
JOIN erp_master.companies c ON c.id = m.company_id
JOIN erp_inventory.storage_location_master s ON s.id = m.storage_location_id
WHERE c.company_code IN ('CMP003', 'CMP005', 'CMP011')
  AND (s.code IN ('R001', 'R002', 'S001', 'S002', 'P001', 'P002', 'R003', 'OT01', 'OT02', 'S003', 'P003', 'T003', 'L003')
       OR s.code LIKE 'F%')
ON CONFLICT (company_id, storage_location_id) DO NOTHING;

COMMIT;
