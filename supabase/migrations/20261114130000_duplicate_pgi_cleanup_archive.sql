-- Archive for the 2026-11-14 duplicate PGI/Invoice clean-up (prod, CMP005 SO02 Bulk Post -- see
-- 20261114120000_pgi_one_active_invoice_per_group_guard.sql for the cause).
--
-- The clean-up deletes 66 duplicate invoices and their stock postings outright (business decision: no reversal pairs).
-- Everything it deletes or edits is first copied here as JSON so the removal can be inspected or rebuilt later.
-- Service-role only: it holds financial rows and is never exposed through the API.

CREATE TABLE IF NOT EXISTS erp_history.duplicate_pgi_cleanup_20261114 (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_table text        NOT NULL,
  source_key   text,
  row_data     jsonb       NOT NULL,
  archived_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_history.duplicate_pgi_cleanup_20261114 IS
  'Pre-delete copy of every row removed or edited by the 2026-11-14 duplicate PGI/Invoice clean-up (CMP005): sales_invoice, sales_invoice_line, stock_document, stock_ledger, plus before-images of the touched stock_snapshot buckets and counters.';

ALTER TABLE erp_history.duplicate_pgi_cleanup_20261114 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON erp_history.duplicate_pgi_cleanup_20261114 FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON erp_history.duplicate_pgi_cleanup_20261114 TO service_role;

NOTIFY pgrst, 'reload schema';
