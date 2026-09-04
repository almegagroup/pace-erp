-- §136 (2026-09-04, business owner "Urgent Dispatch" design) -- schema for the
-- whole workflow: Process PO priority + Manager Approval gate + backdated
-- Verify posting date (Urgent only), and the DO-line-level Urgent dispatch
-- decision that lets PGI bypass the same-day Tally-date match rule.
--
-- Why this exists: urgent MTO/HPS orders are sometimes billed in Tally same
-- day, but PACE's own Process PO -> Packing PO -> DO -> PGI chain only
-- completes the next real day (very frequent, especially month-end). PACE's
-- posting_date must always be the REAL processing date (stock/WAR integrity
-- -- see dispatchBackfillPosting.ts's own note), so the fix is NOT to force
-- dates to match; it's a controlled, audited exception: QA flags the batch
-- Urgent -> a Manager (L2/L3) approves the rush -> Verify/Final post at a
-- user-entered date -> that same "urgent-sourced" status follows the
-- material through FO/DO -> at PGI, only a DO line explicitly marked Urgent
-- bypasses the strict date-match block; everything else keeps it.

-- 1) Process PO: priority + Manager Approval gate + backdated Verify date.
ALTER TABLE erp_production.process_order
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL', 'URGENT')),
  ADD COLUMN IF NOT EXISTS manager_decided_by uuid NULL,
  ADD COLUMN IF NOT EXISTS manager_decided_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS urgent_posting_date date NULL;

COMMENT ON COLUMN erp_production.process_order.priority IS
  'NORMAL (default) or URGENT -- set by QA at QA Approve time (MTO/HPS only). URGENT requires Manager Approval before Start Batch and unlocks the urgent_posting_date override at Verify.';
COMMENT ON COLUMN erp_production.process_order.urgent_posting_date IS
  'Manual override for Verify''s stock posting_date -- URGENT priority only. Real execution still happens today, in real chronological order; this is a label, matching how dispatchBackfillPosting.ts''s own Phase 1 already works. NULL for NORMAL priority (Verify uses todayIso() as before).';

ALTER TABLE erp_production.process_order DROP CONSTRAINT process_order_status_check;
ALTER TABLE erp_production.process_order ADD CONSTRAINT process_order_status_check
  CHECK (status = ANY (ARRAY['STANDARD', 'QA_APPROVED', 'MANAGER_APPROVED', 'QA_REJECTED', 'BATCH_STARTED', 'FINAL', 'VERIFIED', 'REVERSED', 'CANCELLED']));

-- 2) Delivery Challan (DO) line: the actual bypass decision, made at DO
-- creation time, per line -- not inherited automatically from the Process
-- PO's own priority, because one urgent batch can split across an urgent FO
-- and a completely normal one (confirmed with the business owner). NULL
-- means "not asked" (line isn't sourced from an urgent-tagged Packing PO);
-- the handler enforces YES/NO is mandatory whenever it IS so-sourced.
ALTER TABLE erp_procurement.delivery_challan_line
  ADD COLUMN IF NOT EXISTS urgent_dispatch_decision text NULL CHECK (urgent_dispatch_decision IN ('YES', 'NO'));

COMMENT ON COLUMN erp_procurement.delivery_challan_line.urgent_dispatch_decision IS
  'Set only when this line draws from a Packing PO whose source Process PO is priority=URGENT. YES lets PGI post at the Tally Invoice Date even if it does not match today; NO (or NULL, non-urgent-sourced) keeps the normal same-day match rule. Mandatory (handler-enforced) whenever the line IS urgent-sourced.';
