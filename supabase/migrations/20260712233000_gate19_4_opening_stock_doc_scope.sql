/*
 * File-ID: 19.2.2
 * File-Path: supabase/migrations/20260712233000_gate19_4_opening_stock_doc_scope.sql
 * Gate: 19
 * Phase: 19.2
 * Domain: PROCUREMENT
 * Purpose: Scope opening stock documents by material type and optional PO type.
 * Authority: Database
 */

BEGIN;

ALTER TABLE erp_procurement.opening_stock_document
  ADD COLUMN IF NOT EXISTS material_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS po_type TEXT NULL;

UPDATE erp_procurement.opening_stock_document
SET material_type = COALESCE(material_type, 'RM')
WHERE material_type IS NULL;

ALTER TABLE erp_procurement.opening_stock_document
  ALTER COLUMN material_type SET NOT NULL;

ALTER TABLE erp_procurement.opening_stock_document
  DROP CONSTRAINT IF EXISTS opening_stock_document_material_type_check,
  DROP CONSTRAINT IF EXISTS opening_stock_document_po_type_check,
  DROP CONSTRAINT IF EXISTS opening_stock_document_po_type_required_check;

ALTER TABLE erp_procurement.opening_stock_document
  ADD CONSTRAINT opening_stock_document_material_type_check
    CHECK (material_type IN ('RM', 'PM', 'INT', 'SFG', 'FG')),
  ADD CONSTRAINT opening_stock_document_po_type_check
    CHECK (po_type IS NULL OR po_type IN ('MTO', 'HPS', 'MTS', 'MTEST')),
  ADD CONSTRAINT opening_stock_document_po_type_required_check
    CHECK (
      (material_type IN ('SFG', 'FG') AND po_type IS NOT NULL)
      OR (material_type IN ('RM', 'PM', 'INT') AND po_type IS NULL)
    );

DROP INDEX IF EXISTS erp_procurement.opening_stock_document_company_id_cut_off_date_key;
DROP INDEX IF EXISTS opening_stock_document_company_id_cut_off_date_key;

CREATE UNIQUE INDEX opening_stock_document_company_cutoff_scope_key
  ON erp_procurement.opening_stock_document (
    company_id,
    cut_off_date,
    material_type,
    COALESCE(po_type, '')
  );

COMMIT;
