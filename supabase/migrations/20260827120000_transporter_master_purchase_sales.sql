-- File-Path: supabase/migrations/20260827120000_transporter_master_purchase_sales.sql
-- Purpose: Transporter Master becomes Purchase+Sales dual-use (business owner
--          directive, 2026-08-27). Adds:
--            1. business_context (PURCHASE/SALES) -- which side created this
--               transporter, used ONLY as a default sort-priority hint in
--               pickers, never a hard access/visibility restriction (a
--               Purchase-created transporter is fully usable in Sales and
--               vice versa -- one shared global table, no duplication).
--               Existing 17 rows backfilled to PURCHASE (the master was
--               entirely Vendor-centric before this change).
--            2. last_updated_by/last_updated_at -- did not exist before;
--               needed to show "created/updated by which department" in the
--               redesigned UI. updateTransporterHandler will start setting
--               these going forward.
-- Authority: Backend

ALTER TABLE erp_master.transporter_master
  ADD COLUMN IF NOT EXISTS business_context text,
  ADD COLUMN IF NOT EXISTS last_updated_by uuid,
  ADD COLUMN IF NOT EXISTS last_updated_at timestamptz;

UPDATE erp_master.transporter_master SET business_context = 'PURCHASE' WHERE business_context IS NULL;

ALTER TABLE erp_master.transporter_master
  ALTER COLUMN business_context SET NOT NULL,
  ALTER COLUMN business_context SET DEFAULT 'PURCHASE';

ALTER TABLE erp_master.transporter_master
  ADD CONSTRAINT transporter_master_business_context_check
  CHECK (business_context = ANY (ARRAY['PURCHASE'::text, 'SALES'::text]));
