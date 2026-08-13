-- IN01/PID Full Redesign — Schema changes (feasibility doc Section 119)
-- §119.6: PENDING_APPROVAL/CANCELLED status + submit/reopen tracking
-- §119.11: document cancel tracking
-- §119.12: item-level storage_location_id (multi-location PID documents), document.company_id
-- §119.13: is_opening_stock_source flag
-- §119.7:  batch_number/packing_order_id on items (FG/SFG batch/PO grain)

BEGIN;

-- ── physical_inventory_document ────────────────────────────────────────────

ALTER TABLE erp_procurement.physical_inventory_document
  ADD COLUMN company_id uuid REFERENCES erp_master.companies(id);

-- Table has 0 rows in dev+prod today (verified before writing this migration) — safe to
-- backfill-then-enforce in one statement, no existing row could violate it.
UPDATE erp_procurement.physical_inventory_document pid
SET company_id = slm.company_id
FROM erp_inventory.storage_location_plant_map slm
WHERE pid.company_id IS NULL AND pid.storage_location_id = slm.storage_location_id;

ALTER TABLE erp_procurement.physical_inventory_document
  ALTER COLUMN company_id SET NOT NULL;

-- storage_location_id becomes optional — only LOCATION_WISE mode requires it now (§119.12,
-- ITEM_WISE mode is company-scoped and can span multiple locations via item-level location).
ALTER TABLE erp_procurement.physical_inventory_document
  ALTER COLUMN storage_location_id DROP NOT NULL;

ALTER TABLE erp_procurement.physical_inventory_document
  ADD CONSTRAINT physical_inventory_document_location_wise_requires_sloc
  CHECK (mode <> 'LOCATION_WISE' OR storage_location_id IS NOT NULL);

ALTER TABLE erp_procurement.physical_inventory_document
  DROP CONSTRAINT physical_inventory_document_status_check;

ALTER TABLE erp_procurement.physical_inventory_document
  ADD CONSTRAINT physical_inventory_document_status_check
  CHECK (status IN ('OPEN', 'COUNTED', 'PENDING_APPROVAL', 'POSTED', 'CANCELLED'));

ALTER TABLE erp_procurement.physical_inventory_document
  ADD COLUMN is_opening_stock_source boolean NOT NULL DEFAULT false,
  ADD COLUMN submitted_by  uuid NULL,
  ADD COLUMN submitted_at  timestamptz NULL,
  ADD COLUMN cancelled_by  uuid NULL,
  ADD COLUMN cancelled_at  timestamptz NULL,
  ADD COLUMN cancel_reason text NULL;

COMMENT ON COLUMN erp_procurement.physical_inventory_document.is_opening_stock_source IS
'§119.13 — when true, posting_date+1 becomes the effective Opening Stock reference date for
every item in this document once POSTED. No separate stock movement — the PID''s own 701/702
already updates stock_snapshot; this flag only feeds the (future) Opening Stock reference table.';

-- ── physical_inventory_item ─────────────────────────────────────────────────

ALTER TABLE erp_procurement.physical_inventory_item
  ADD COLUMN storage_location_id uuid,
  ADD COLUMN batch_number        text NULL,
  ADD COLUMN packing_order_id    uuid NULL REFERENCES erp_production.packing_order(id);

UPDATE erp_procurement.physical_inventory_item pii
SET storage_location_id = pid.storage_location_id
FROM erp_procurement.physical_inventory_document pid
WHERE pii.storage_location_id IS NULL AND pii.document_id = pid.id;

ALTER TABLE erp_procurement.physical_inventory_item
  ALTER COLUMN storage_location_id SET NOT NULL;

COMMENT ON COLUMN erp_procurement.physical_inventory_item.batch_number IS
'§119.7 — populated only for SFG/FG under MTO/HPS/MTEST po_type. NULL for RM/PM/INT and
MTS-typed SFG/FG (batch-blind, matches §108/§116 grain rule).';
COMMENT ON COLUMN erp_procurement.physical_inventory_item.packing_order_id IS
'§119.7 — populated only for FG under MTO/HPS/MTEST po_type (batch+Packing-PO grain). NULL
for SFG (batch-only grain) and for anything blended (RM/PM/INT, MTS-typed SFG/FG).';

ALTER TABLE erp_procurement.physical_inventory_item
  DROP CONSTRAINT physical_inventory_item_document_id_material_id_stock_type_key;

-- Two-tier uniqueness: NULL <> NULL in Postgres unique indexes, so a single constraint
-- spanning batch_number/packing_order_id would silently stop enforcing uniqueness for the
-- common RM/PM/INT/blended case (both NULL). Partial indexes keep both cases genuinely unique.
CREATE UNIQUE INDEX physical_inventory_item_blended_uk
  ON erp_procurement.physical_inventory_item (document_id, material_id, stock_type, storage_location_id)
  WHERE batch_number IS NULL AND packing_order_id IS NULL;

CREATE UNIQUE INDEX physical_inventory_item_batch_uk
  ON erp_procurement.physical_inventory_item (document_id, material_id, stock_type, storage_location_id, batch_number, packing_order_id)
  WHERE batch_number IS NOT NULL OR packing_order_id IS NOT NULL;

CREATE INDEX idx_pii_storage_location ON erp_procurement.physical_inventory_item (storage_location_id);
CREATE INDEX idx_pii_batch_number ON erp_procurement.physical_inventory_item (batch_number) WHERE batch_number IS NOT NULL;

-- ── physical_inventory_block ─────────────────────────────────────────────────
-- §119.7: batch-tracked SFG/FG must block per-batch, not blanket material+location — otherwise
-- counting one batch would block every other batch of the same material at that location too.

ALTER TABLE erp_inventory.physical_inventory_block
  ADD COLUMN batch_number text NULL;

DROP INDEX erp_inventory.physical_inventory_block_material_id_storage_location_id_key;

CREATE UNIQUE INDEX physical_inventory_block_blended_uk
  ON erp_inventory.physical_inventory_block (material_id, storage_location_id)
  WHERE batch_number IS NULL;

CREATE UNIQUE INDEX physical_inventory_block_batch_uk
  ON erp_inventory.physical_inventory_block (material_id, storage_location_id, batch_number)
  WHERE batch_number IS NOT NULL;

-- ── physical_inventory_reopen_log ───────────────────────────────────────────
-- §119.6: Reopen requires a mandatory reason; kept as its own append-only log (not a single
-- overwritten column) so a document reopened multiple times keeps full history, matching this
-- codebase's established "nothing truly deleted/overwritten" audit discipline.

CREATE TABLE erp_procurement.physical_inventory_reopen_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES erp_procurement.physical_inventory_document(id) ON DELETE RESTRICT,
  reopened_by   uuid NOT NULL,
  reopened_at   timestamptz NOT NULL DEFAULT now(),
  reason        text NOT NULL
);

COMMENT ON TABLE erp_procurement.physical_inventory_reopen_log IS
'§119.6 — one row per Reopen action on a PID document (PENDING_APPROVAL -> back to editable).
Reopen authority = whoever holds Post authority for that document (§119.5 escalating rule).';

CREATE INDEX idx_pi_reopen_log_document ON erp_procurement.physical_inventory_reopen_log (document_id);

GRANT ALL ON erp_procurement.physical_inventory_reopen_log TO service_role;

COMMIT;
