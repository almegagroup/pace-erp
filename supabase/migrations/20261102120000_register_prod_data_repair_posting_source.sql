-- stock_health_check() flagged 76 stock_document rows (reference_document_type = 'PROD_DATA_REPAIR',
-- all dated 2026-10-15) as "unregistered_posting_source". They are the deliberate marker of a one-off
-- prod data repair, not a business module, so there is no document table that could sit half-posted.
-- Register the type so the check recognises it. suspect_statuses is empty on purpose (same as
-- PARTIAL_REV): the partial-posting probe therefore always reports 0 for it.
-- source_table points at stock_document itself only because the registry columns are NOT NULL.
INSERT INTO erp_inventory.posting_source_registry
  (reference_document_type, label, source_schema, source_table, status_column, suspect_statuses, notes)
VALUES
  ('PROD_DATA_REPAIR', 'Prod data repair (one-off)', 'erp_inventory', 'stock_document', 'document_number', ARRAY[]::text[],
   'Marker for manual prod corrections (e.g. 2026-10-15). Not a business module: nothing can be half-posted, hence no suspect statuses.')
ON CONFLICT (reference_document_type) DO NOTHING;
