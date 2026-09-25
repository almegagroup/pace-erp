Production business date correction: 2026-09-12 to 2026-09-11

User approved the five-table scope after review. Production project bsjpvkigpllichlknmah; company CMP006.
Customer PO 11411779; SO 9000000271; DO 9100000262; invoice 9200000258; Tally invoice ACPLF/0540/26-27.

Committed changes:
- erp_procurement.sales_invoice: 1 row, invoice_date and tally_invoice_date.
- erp_procurement.delivery_challan: 1 row, dc_date.
- erp_inventory.stock_document: 1 row (document 00000795), document_date and posting_date.
- erp_inventory.stock_ledger: 1 row (ledger_seq 5556), posting_date.
- erp_production.dispatch_reco: 14 rows, invoice_date and tally_invoice_date.

Single transaction; 5-second lock timeout and 30-second statement timeout. Ledger ACCESS EXCLUSIVE lock held through commit; remaining four tables locked SHARE ROW EXCLUSIVE. Exact identity, status, original date and linked-row count assertions used.
Saved stock_ledger_no_update rule definition from pg_rewrite; temporarily dropped within the transaction, updated the exact ledger row and recreated the identical enabled rule before commit. Delete guard retained.
Compared all affected records before and after, excluding only approved date fields: all other fields identical. Audit timestamps, quantities, values, rates and status retained.
Separate post-commit read verified all dates and both enabled ledger rules.
