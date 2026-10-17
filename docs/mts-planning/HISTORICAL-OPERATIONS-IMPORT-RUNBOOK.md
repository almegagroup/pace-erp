# Historical Operations Import Runbook

## Safety boundary

This runbook is for an authorised historical backfill only.  It does not
authorise any production mutation, stock posting, GL posting, invoice action,
or deployment.  Apply the reviewed migration first; do not run an import in
PROD until the business owner explicitly authorises that separate operation.

## One source file at a time

Use a stable `source_file_key` for the logical source file.  For a correction
to that same file, keep the same key and sheet/row/line identity.  The import
then updates the one historical source row rather than creating a duplicate.
Never use an invoice number as the row identity: a single invoice can have
multiple dispatch lines.

The authenticated caller needs
`PROC_HISTORICAL_OPERATIONS_IMPORT:WRITE` in the selected company. This is the
separate POTMP authority; it is not inherited from PO21 planning maintenance.
The API does not use browser Google Sheets access and has no hardcoded secret;
an approved server-side extraction process supplies the parsed JSON payload.

## Required payload contract

Common fields:

```json
{
  "company_id": "<UUID>",
  "record_kind": "PRODUCTION | FG_DISPATCH",
  "source_system": "HISTORICAL_FILE",
  "source_file_key": "cmp003-production-2024-v1",
  "source_file_name": "source.xlsx",
  "source_sheet_name": "Production",
  "rows": []
}
```

Every row must include `source_row_number`, optional stable
`source_line_key`, `external_sku` **as text**, an ISO source date and original
quantity/UOM.  Production uses `production_date`; dispatch uses
`dispatch_date`.  Dispatch may additionally contain `dispatch_category`
(`DIRECT`/`DEPOT`), MDN, invoice/order/consignee/depot values,
`original_dispatch_status`, explicit `cancellation_flag`, and
`stock_posting_evidence`.

Do not turn a spreadsheet number into a SKU string after the fact: leading
zeroes may already be lost.  `00000000000`, unmapped SKU, invalid date, and
missing or variable UOM conversion produce exceptions.  Cancelled dispatch
rows remain traceable but do not contribute to dispatched KG.  `CROSS CHECK`
is ignored as cancellation evidence.

## Procedure

1. Confirm the source period ends on 2026-09-30.  October 2026 onward belongs
   to ERP live data and must not be imported.
2. Submit `POST /api/procurement/mts-plan/historical-import/dry-run` with the
   payload.  Review every row with `validation_status` and every issue.
3. Correct source data or material/UOM master data where appropriate.  Re-run
   dry-run until the unresolved exceptions are understood and accepted.
4. Submit the exact reviewed payload to
   `POST /api/procurement/mts-plan/historical-import/commit` once.  A network
   failure is ambiguous: first query the batch/source identity; do not blindly
   retry a commit.
5. Check `erp_history.import_batch.reconciliation`: submitted, importable,
   exception, cancelled and validated-KG totals must reconcile with the
   reviewed source control total.
6. Open MTS Customer Plan → Plan Report for September and October.  Confirm
   September rows say `HISTORICAL`, October rows say `ERP_LIVE`, and warnings
   are resolved or formally accepted.

## Deployment and rollback

Before schema application, add `erp_history` to the Supabase project's exposed
schemas alongside the existing private ERP schemas; the backend service-role
client requires it.  Then apply the migration through the standard pipeline,
run `NOTIFY pgrst, 'reload schema';`, and run
`node scripts/migration-integrity-check.mjs` against the target project.

Rollback before any import is a reviewed schema rollback only.  After imports,
do **not** delete historical rows casually: preserve batch/exception audit
evidence and use a corrective re-import with the same stable source identity.
No rollback procedure ever calls inventory, GL, invoice, DO or process-order
tables.

## Historical procurement batches (POTMP)

Use the **Historical Operations Import** page route
`/dashboard/procurement/historical-operations-import` with the same
normal ERP session and the company selected explicitly. Choose one procurement
import type at a time, paste a reviewed JSON array from a TXT file, dry-run,
review every returned issue/count, tick approval, then commit only the exact
unchanged payload.

1. Import `PO_SHEET` headers first (`Historical Purchase Orders / headers`), in
   batches of at most **500 combined rows**.
2. Import its PO lines next (`Historical PO Lines`), also at most 500 rows.
   Lines can resolve a parent committed in an earlier batch only when company
   and `source_system` agree.
3. Import `MVT_TRACKER` as `Historical Consignment Movements`, at most 500
   rows. Each movement needs its own stable `source_record_key`; invoice/BL
   alone is invalid as a uniqueness strategy.
4. Import `Product_Data_Base` only as `Product Database Reference Snapshot`.
   Enter the source extraction timestamp; this is an undated/current default
   snapshot, never a historical transaction or payment/lead-time proof.

For procurement, retain all source fields and evaluate PO order dates and
actual movement events independently for **2024-09-01 … 2026-08-31**. Keep
older parents needed by an in-window movement; label them as dependencies.
Do not use hidden `MOVEMENT_TRACKER`, scheduled ETD/ETA as actual events,
fuzzy vendor/material matching, or automatic live-master creation. The
existing Production/FG Dispatch workflow and its 2,000-row / 30-Sep-2026
boundary are unchanged.

After each dry-run, record the batch checksum and inspect submitted, stored,
validated, unmapped, quarantined, warning/error and UOM totals. A commit is
permitted only when there are no blocking errors; stored `UNMAPPED` rows are
not valid planning evidence. No runbook step authorises a production import
or deployment without the business owner's separate approval.
