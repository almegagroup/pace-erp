BEGIN;

-- §6 (FG-STO-MTS-DISPATCH-DESIGN-DOC.md) — VDC (Dependent Direct) dispatch:
-- Invoice is created first, PGI (actual P601 stock posting) happens only
-- once Truck Number + Dispatch Date are both known (truck physically
-- arrives). This status value is additive -- every existing status check in
-- do_unified.handlers.ts (updateDeliveryOrderUnifiedHandler's 'CREATED'-only
-- edit gate, previewInvoiceGroupsHandler's CREATED/DISPATCHED view gate,
-- postPgiInvoiceGroupsHandler) is untouched and never produces or reads
-- 'INVOICED' -- only the new VDC-only Invoice-only/PGI-only endpoints
-- (implementation Phase 4) will. DC/RM/PM/INT keep going straight
-- CREATED -> DISPATCHED exactly as today.
ALTER TABLE erp_procurement.delivery_challan
  DROP CONSTRAINT delivery_challan_status_check;

ALTER TABLE erp_procurement.delivery_challan
  ADD CONSTRAINT delivery_challan_status_check
  CHECK (status = ANY (ARRAY['AUTO_GENERATED'::text, 'CREATED'::text, 'INVOICED'::text, 'DISPATCHED'::text, 'CANCELLED'::text]));

-- pgi_deferred marks a VDC row as using the new split flow at all (set at
-- Bulk DO Upload time for VDC rows only) -- lets the new Invoice-only/
-- PGI-only endpoints identify their own rows without inferring it from
-- status alone. dispatch_date is the deferred PGI's own target posting
-- date (Truck Number already has a home: the existing vehicle_number
-- column -- no duplicate column added).
ALTER TABLE erp_procurement.delivery_challan
  ADD COLUMN IF NOT EXISTS pgi_deferred boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dispatch_date date NULL;

COMMENT ON COLUMN erp_procurement.delivery_challan.pgi_deferred IS
  'true only for a VDC (Dependent Direct) row created through the new Bulk DO Upload split flow -- Invoice posts now, PGI is deferred until dispatch_date (and vehicle_number, reused as Truck Number) are both set. false (default) for every existing DC/RM/PM/INT row, which keeps the atomic Invoice+PGI path unchanged.';
COMMENT ON COLUMN erp_procurement.delivery_challan.dispatch_date IS
  'VDC deferred-PGI only -- set by the Truck + Dispatch Date Upload (SO03), validated LR Date <= dispatch_date <= today (tightening to today-2..today from 2026-10-14). The new PGI-only endpoint posts P601 dated as this value, not today.';

NOTIFY pgrst, 'reload schema';
COMMIT;
