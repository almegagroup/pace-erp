-- §136 follow-up (2026-09-08): Manager Reject is the symmetric counterpart to
-- Manager Approve for an Urgent Process Order awaiting Manager decision
-- (QA_APPROVED for MTO/HPS, STANDARD for MTEST). It applies the same
-- CANCELLED decision as QA Reject, but the reason is captured separately from
-- qa_rejection_reason so the audit trail can tell a QA-quality rejection
-- apart from a Manager's own business/urgency decision.
ALTER TABLE erp_production.process_order
  ADD COLUMN IF NOT EXISTS manager_rejection_reason text;
