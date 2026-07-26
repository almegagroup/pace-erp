-- Migration: SAP-style document number ranges
-- Each doc type gets its own number range so the range itself identifies the doc type.
-- No prefix needed — range is the identifier (SAP pattern).
--
-- Range design:
--   GE  100001+   GEX 150001+   GXO 160001+
--   GRN 200001+   CSN 300001+
--   IV  400001+   LC  450001+
--   QA  500001+
--   OS  600001+   PI  650001+   PT  700001+
--   RTV 800001+   DN  810001+   EXR 820001+
--   SO  900001+   DC  910001+   SALES_INVOICE 920001+

UPDATE erp_procurement.document_number_series SET starting_number = 100001 WHERE doc_type = 'GE'           AND starting_number < 100001;
UPDATE erp_procurement.document_number_series SET starting_number = 150001 WHERE doc_type = 'GEX'          AND starting_number < 150001;
UPDATE erp_procurement.document_number_series SET starting_number = 160001 WHERE doc_type = 'GXO'          AND starting_number < 160001;
UPDATE erp_procurement.document_number_series SET starting_number = 200001 WHERE doc_type = 'GRN'          AND starting_number < 200001;
UPDATE erp_procurement.document_number_series SET starting_number = 300001 WHERE doc_type = 'CSN'          AND starting_number < 300001;
UPDATE erp_procurement.document_number_series SET starting_number = 400001 WHERE doc_type = 'IV'           AND starting_number < 400001;
UPDATE erp_procurement.document_number_series SET starting_number = 450001 WHERE doc_type = 'LC'           AND starting_number < 450001;
UPDATE erp_procurement.document_number_series SET starting_number = 500001 WHERE doc_type = 'QA'           AND starting_number < 500001;
UPDATE erp_procurement.document_number_series SET starting_number = 600001 WHERE doc_type = 'OS'           AND starting_number < 600001;
UPDATE erp_procurement.document_number_series SET starting_number = 650001 WHERE doc_type = 'PI'           AND starting_number < 650001;
UPDATE erp_procurement.document_number_series SET starting_number = 700001 WHERE doc_type = 'PT'           AND starting_number < 700001;
UPDATE erp_procurement.document_number_series SET starting_number = 800001 WHERE doc_type = 'RTV'          AND starting_number < 800001;
UPDATE erp_procurement.document_number_series SET starting_number = 810001 WHERE doc_type = 'DN'           AND starting_number < 810001;
UPDATE erp_procurement.document_number_series SET starting_number = 820001 WHERE doc_type = 'EXR'          AND starting_number < 820001;
UPDATE erp_procurement.document_number_series SET starting_number = 900001 WHERE doc_type = 'SO'           AND starting_number < 900001;
UPDATE erp_procurement.document_number_series SET starting_number = 910001 WHERE doc_type = 'DC'           AND starting_number < 910001;
UPDATE erp_procurement.document_number_series SET starting_number = 920001 WHERE doc_type = 'SALES_INVOICE' AND starting_number < 920001;
