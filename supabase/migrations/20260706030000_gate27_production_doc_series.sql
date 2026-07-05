/*
 * Migration: 20260706030000_gate27_production_doc_series
 * Gate: 27
 * Purpose: Add PROC_PO and PACK_PO document number series entries for all
 *          4 business companies using erp_procurement.generate_company_doc_number().
 */

INSERT INTO erp_procurement.company_doc_number_series
  (company_id, document_type, prefix, number_padding, active)
VALUES
  -- ASC
  ('9c0812ca-8a90-4d41-a9bd-f34ab582a773','PROC_PO','ASCPROC',4,true),
  ('9c0812ca-8a90-4d41-a9bd-f34ab582a773','PACK_PO','ASCPACK',4,true),
  -- JI
  ('d5bdd034-b207-4c49-ba3a-3c093e6b1f55','PROC_PO','JIPROC',4,true),
  ('d5bdd034-b207-4c49-ba3a-3c093e6b1f55','PACK_PO','JIPACK',4,true),
  -- RRP
  ('69c032be-ace7-42af-83f9-e35ff01971b3','PROC_PO','RRPPROC',4,true),
  ('69c032be-ace7-42af-83f9-e35ff01971b3','PACK_PO','RRPPACK',4,true),
  -- AMS
  ('f594eef8-856b-4253-b565-bcb0e962cf00','PROC_PO','AMSPROC',4,true),
  ('f594eef8-856b-4253-b565-bcb0e962cf00','PACK_PO','AMSPACK',4,true)
ON CONFLICT DO NOTHING;
