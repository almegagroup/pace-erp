-- Separate CSN number series for FG STOs (FG STO CSNs are 31xxxxxxxx; PO / RM-PM STO CSNs stay 30xxxxxxxx).
-- Band 31 was unused in prod (document_number_series, consignment_note). Same 10-digit convention as the rest
-- of the §8 ranges; last_number 0 makes generate_doc_number() start at starting_number.
INSERT INTO erp_procurement.document_number_series (doc_type, starting_number, last_number, pad_width)
SELECT 'FG_STO_CSN', 3100000001, 0, 10
WHERE NOT EXISTS (SELECT 1 FROM erp_procurement.document_number_series WHERE doc_type = 'FG_STO_CSN');
