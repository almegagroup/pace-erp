-- RECONCILIATION MARKER ONLY
-- ----------------------------------------
-- This version number was already written to the remote migration ledger
-- during a one-off PO11 production ACL correction that should have been
-- executed as direct database configuration, not as a business-data
-- migration.
--
-- The real PO11 access rule must continue to be managed as live ACL/menu/
-- snapshot data per company and work-context, following the established
-- direct-DB operating pattern used elsewhere in this ERP.
--
-- This local file intentionally does nothing. Its only purpose is to keep
-- the migration ledger aligned so future schema deployments do not drift.

begin;
select 1;
commit;
