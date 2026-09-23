/*
 * File-Path: supabase/migrations/20260915140000_machine_po_type_map.sql
 * Domain: MASTER / PRODUCTION
 * Purpose: Which Process PO type(s) a machine is usable for -- so Process PO
 *          Create/Edit can filter Machine options by the PO's own po_type,
 *          instead of listing every active machine in the company regardless
 *          of what it's actually meant to run.
 * Authority: Backend
 */

BEGIN;

-- A machine can serve more than one PO type (e.g. one mixer used for both
-- MTO and HPS), so this is a many-to-many map, not a single column on
-- machine_master -- same shape as the existing stroke_po_type_applicability
-- table for Stroke Master.
CREATE TABLE IF NOT EXISTS erp_master.machine_po_type_map (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id  uuid NOT NULL REFERENCES erp_master.machine_master(id) ON DELETE CASCADE,
  -- Only the Process PO types that actually require a machine assignment
  -- today (process_order.handlers.ts's own REQUIRED_MACHINE_TYPES set).
  -- MTEST is deliberately excluded -- Process PO Create never shows a
  -- Machine field for MTEST at all (exempt by design, §83.9).
  po_type     text NOT NULL CHECK (po_type IN ('MTO', 'HPS', 'MTS', 'INT')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (machine_id, po_type)
);

CREATE INDEX IF NOT EXISTS idx_machine_po_type_map_machine  ON erp_master.machine_po_type_map (machine_id);
CREATE INDEX IF NOT EXISTS idx_machine_po_type_map_po_type  ON erp_master.machine_po_type_map (po_type);

COMMENT ON TABLE erp_master.machine_po_type_map IS
'Which Process PO type(s) a machine is configured to run -- filters the Machine picker on Process PO Create/Edit by po_type.';

GRANT SELECT, INSERT, UPDATE, DELETE ON erp_master.machine_po_type_map TO service_role;

COMMIT;
