-- §138.16 (2026-09-18) — MTS Page 5: batch->pack-size planning staging table.
--
-- Page 5 builds N rows (each destined to become one Packing PO on Page 6's
-- Save) before any Packing PO document exists. This table is the durable
-- staging area between the two pages -- without it, navigating away from
-- Page 5 before reaching Page 6 would silently lose the whole plan, and
-- Page 6 would have no independent way to load "what did Page 5 decide"
-- (mirrors why Page 4's material plan is itself persisted rather than kept
-- only in frontend state).
--
-- One row per pack-size allocation. `status` starts PLANNED; Page 6's Save
-- flips a row to CONVERTED and fills packing_order_id once the real
-- packing_order it produced exists. A CANCELLED status exists for the same
-- reason process_order/packing_order use CANCELLED rather than DELETE
-- elsewhere in this schema -- nothing in this codebase hard-deletes a
-- planning/business row, per the established "nothing truly deleted"
-- principle (batch_number_instance RELEASED, process_order_line_reco
-- is_voided, etc.).
BEGIN;

CREATE TABLE IF NOT EXISTS erp_production.mts_packing_plan_row (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  process_order_id      uuid NOT NULL REFERENCES erp_production.process_order(id) ON DELETE CASCADE,
  batch_number_from     text NOT NULL,
  batch_number_to       text NOT NULL,
  pack_code_id          uuid NOT NULL REFERENCES erp_production.pack_code_master(id) ON DELETE RESTRICT,
  outer_unit_per_batch  numeric NOT NULL CHECK (outer_unit_per_batch > 0),
  storage_location_id   uuid NOT NULL REFERENCES erp_inventory.storage_location_master(id) ON DELETE RESTRICT,
  display_order         integer NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'CONVERTED', 'CANCELLED')),
  packing_order_id      uuid NULL REFERENCES erp_production.packing_order(id) ON DELETE SET NULL,
  created_by            uuid NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_updated_by       uuid NULL,
  last_updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mts_packing_plan_row_process_order
  ON erp_production.mts_packing_plan_row (process_order_id)
  WHERE status <> 'CANCELLED';

GRANT ALL ON erp_production.mts_packing_plan_row TO service_role;

COMMENT ON TABLE erp_production.mts_packing_plan_row IS
  '§138.16 Page 5 staging: one row per pack-size batch-sub-range allocation for an MTS Process PO, before it becomes a real Packing PO on Page 6 Save.';

NOTIFY pgrst, 'reload schema';
COMMIT;
