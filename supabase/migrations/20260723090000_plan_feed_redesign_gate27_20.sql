-- §83.18-REVISED (LOCKED 2026-07-23): Plan Feed (PR00) full redesign.
--
-- 1. customer_master gets a nullable fo_customer_type so the FO Party dropdown can be
--    filtered by PO Type (MTO/HPS share one value, ZTEST/MTS get their own). RM/PM
--    Sales customers keep fo_customer_type NULL -- shared master, not a new one.
--    NOTE: customer_master already has an unrelated `customer_type` column (DOMESTIC/
--    EXPORT-style commercial classification, live data exists) -- caught via a 42701
--    duplicate-column error on first apply attempt; this is a deliberately different
--    column, not a rename or reuse of that one.
-- 2. plan_feed gets ordered_stroke_number (manual, Production fills in later; live
--    existence-check against stroke_master happens in the handler, not the DB).
-- 3. FO<->Packing PO linkage moves from a single FK (packing_order.plan_feed_id) to a
--    many-to-many allocation table with its own qty, so one Packing PO can be fully,
--    partially, or not-at-all allocated to one or more FOs, adjustable at any time.
--    The only invariant: sum(allocated_qty_kg) per packing_order_id <= that PO's own
--    actual qty -- enforced in the handler (post_stock_movement-style app-level check),
--    not a DB CHECK, since it depends on packing_order.actual_qty_kg at write time.
-- 4. packing_order.plan_feed_id and process_order.plan_feed_id are dropped -- both are
--    0 rows in Dev (never used), and process_order.plan_feed_id directly contradicts
--    the already-locked §83.4 rule "Process PO header does NOT carry any FO reference"
--    (a stale leftover from the original Gate-27 schema migration, dead in every
--    handler -- confirmed via code search before dropping).

ALTER TABLE erp_master.customer_master
  ADD COLUMN fo_customer_type TEXT
    CHECK (fo_customer_type IS NULL OR fo_customer_type IN ('MTO_HPS', 'ZTEST', 'MTS'));

ALTER TABLE erp_production.plan_feed
  ADD COLUMN ordered_stroke_number TEXT;

ALTER TABLE erp_production.packing_order
  DROP CONSTRAINT packing_order_plan_feed_id_fkey,
  DROP COLUMN plan_feed_id;

ALTER TABLE erp_production.process_order
  DROP CONSTRAINT process_order_plan_feed_id_fkey,
  DROP COLUMN plan_feed_id;

CREATE TABLE erp_production.plan_feed_packing_order_allocation (
  id                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_feed_id      UUID           NOT NULL REFERENCES erp_production.plan_feed(id),
  packing_order_id  UUID           NOT NULL REFERENCES erp_production.packing_order(id),
  allocated_qty_kg  NUMERIC(14,4)  NOT NULL CHECK (allocated_qty_kg > 0),
  created_by        UUID           NOT NULL,
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  last_updated_by   UUID,
  last_updated_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  UNIQUE (plan_feed_id, packing_order_id)
);

CREATE INDEX idx_pfpoa_plan_feed_id ON erp_production.plan_feed_packing_order_allocation(plan_feed_id);
CREATE INDEX idx_pfpoa_packing_order_id ON erp_production.plan_feed_packing_order_allocation(packing_order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON erp_production.plan_feed_packing_order_allocation TO service_role;
