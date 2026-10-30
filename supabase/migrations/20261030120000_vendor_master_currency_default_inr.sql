-- vendor_master.currency_code defaulted to 'BDT', so every vendor created without
-- an explicit currency (all 129 DOMESTIC vendors in prod) carried Bangladeshi Taka.
-- The PO create page now defaults line currency from the vendor master, so a wrong
-- master default matters. DOMESTIC vendors are INR; IMPORT vendors are untouched.
ALTER TABLE erp_master.vendor_master ALTER COLUMN currency_code SET DEFAULT 'INR';

UPDATE erp_master.vendor_master
   SET currency_code = 'INR'
 WHERE vendor_type = 'DOMESTIC'
   AND currency_code = 'BDT';
