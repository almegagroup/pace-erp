# Historical Import API (for the importing agent)

Status: code complete, **NOT VERIFIED** — the two import RPCs are not yet applied
on DEV (see OM-IMPLEMENTATION-LOG, 2026-10-15). Do not call commit endpoints
until that entry says VERIFIED.

All data lands only in the private `erp_history` schema. Nothing here reads into
or writes live PO / CSN / GRN / stock / GL records.

## Common rules

| Item | Rule |
|---|---|
| Auth | Normal ERP session cookie. ACL: `PROC_MTS_CUSTOMER_PLAN_MAINTAIN` / WRITE for dry-run and commit; `PROC_MTS_CUSTOMER_PLAN` / VIEW for reads. Company scope is enforced. |
| Company | `company_id` (uuid) must be a company in the caller's scope. |
| Identity | Send **codes**, never ids. `vendor_id` / `material_id` in a payload are rejected (`HISTORY_RAW_ID_NOT_ACCEPTED`). |
| Codes | Send SKU / material codes as JSON **strings** (leading zeros are significant). |
| Dates | `YYYY-MM-DD` only. |
| Atomicity | One request = one PostgreSQL transaction. Any ERROR → nothing written. |
| Dry-run first | Dry-run and commit run the same validation inside the database. Commit returns 409 `HISTORY_IMPORT_REVIEW_REQUIRED` when ERROR issues exist. |
| Idempotency | The server hashes the request body (sha256). Re-sending an identical committed request returns `idempotent_replay: true` and the original `batch_id`; nothing is written twice. |
| Corrections | Re-import the corrected record with the same identity (below). The row is updated in place, `source_revision_count` +1, `first_import_batch_id` preserved. |
| Severity | `ERROR` blocks the whole request. `WARNING` keeps the row with status `UNMAPPED` / `QUARANTINED` and records an `import_exception`; such rows never enter totals. |
| Request errors | 400 `HISTORY_IMPORT_INVALID` (missing company/source/arrays), 400 `HISTORY_IMPORT_BATCH_SIZE`, 403 forbidden / out of scope. |

## 1. Historical Production / FG Dispatch

`POST /api/procurement/mts-plan/historical-import/dry-run`
`POST /api/procurement/mts-plan/historical-import/commit`

```json
{
  "company_id": "uuid",
  "record_kind": "PRODUCTION | FG_DISPATCH",
  "source_system": "GOOGLE_SHEETS",
  "source_file_key": "drive-file-id",
  "source_file_name": "Production FY26",
  "source_sheet_name": "Sep-2026",
  "rows": [
    { "source_row_number": 12, "source_line_key": "",
      "external_sku": "00012345678",
      "production_date": "2026-09-14",
      "original_quantity": 1200, "original_uom": "KG",
      "prodshade": "...", "shift": "A", "machine": "M1",
      "stroke_reference": "...", "process_order_reference": "..." }
  ]
}
```

FG_DISPATCH rows use `dispatch_date` and may add `dispatch_category` (DIRECT/DEPOT),
`mdn`, `invoice_number`, `order_reference`, `consignee`, `depot_code`,
`original_dispatch_status`, `cancellation_flag` (boolean), `stock_posting_status`
(POSTED/NOT_POSTED).

- 1–2000 rows per request.
- Identity: `(company, source_system, source_file_key, source_sheet_name, source_row_number, source_line_key)`. Keep these stable across re-imports.
- Dates must be ≤ 2026-09-30 (from 2026-10-01 PO21 uses posted ERP data). Later dates → QUARANTINED.
- Units: KG, MT, or a unit with exactly one active fixed conversion to KG on the material. Otherwise QUARANTINED (never guessed).
- SKU `00000000000` → QUARANTINED for manual mapping.
- Cancelled dispatch (flag true or status CANCELLED) is stored but never counted.

ERROR codes: `HISTORY_DUPLICATE_SOURCE_ROW`, `HISTORY_RAW_ID_NOT_ACCEPTED`.
WARNING codes: `HISTORY_SOURCE_ROW_REQUIRED`, `HISTORY_SKU_MUST_BE_TEXT`, `HISTORY_SKU_REQUIRED` (these three: row not stored), `HISTORY_UNKNOWN_SKU`, `HISTORY_DATE_INVALID`, `HISTORY_QUANTITY_INVALID`, `HISTORY_UOM_REQUIRED`, `HISTORY_SKU_UNMAPPED`, `HISTORY_UOM_CONVERSION_MISSING`.

Dry-run response: `{ dry_run, committed:false, committable, summary, issues[], rows[] }`.
Commit response: `{ committed:true, batch_id, status, summary, issues[], checksum }`.

## 2. Historical Procurement (PO header → line → consignment movement)

`POST /api/procurement/historical-procurement-import/dry-run`
`POST /api/procurement/historical-procurement-import/commit`

```json
{
  "company_id": "uuid",
  "source_system": "GOOGLE_SHEETS",
  "source_file_key": "drive-file-id",
  "source_sheet_name": "PO Tracker",
  "purchase_orders": [
    { "source_row_number": 4, "external_po_number": "PO-123", "order_date": "2025-11-02",
      "supplier_name": "...", "vendor_code": "V0001", "supply_type": "LOCAL|DOMESTIC|IMPORT",
      "payment_terms": "...", "payment_days": 45, "currency_code": "INR",
      "original_status": "...", "cancellation_flag": false }
  ],
  "purchase_order_lines": [
    { "source_row_number": 5, "external_po_number": "PO-123", "external_line_reference": "10",
      "material_code": "RM-0001", "item_description": "...",
      "original_quantity": 5, "original_uom": "MT", "unit_rate": 81.5 }
  ],
  "consignment_movements": [
    { "source_row_number": 9, "source_record_key": "PO-123/10/INV-55",
      "external_po_number": "PO-123", "external_line_reference": "10",
      "invoice_number": "INV-55", "supply_type": "IMPORT",
      "etd_date": "2025-12-01", "atd_date": "...", "eta_port_date": "...", "ata_port_date": "...",
      "boe_date": "...", "lr_date": "...", "dispatch_date": "...", "inward_date": "2026-01-20",
      "original_quantity": 5, "original_uom": "MT", "cancellation_flag": false }
  ]
}
```

- 1–500 records per request (headers + lines + movements together).
- Identity: header `(company, source_system, external_po_number)`; line `(PO, external_line_reference)`; movement `(company, source_system, source_record_key)`. Row numbers are lineage only — re-sorting a sheet does not create duplicates.
- **Cross-batch linkage (deterministic):** a line may reference a PO header in the same request *or* one committed earlier with the same `source_system`; a movement likewise for its PO line. Import order for large files: **all headers → all lines → all movements**, each split into ≤500-record requests. An unresolved reference is an ERROR, never a silent drop or guessed link.
- `vendor_code` must be an active vendor of the company (else ERROR). No vendor_code but a supplier name → header kept as UNMAPPED (WARNING).
- `material_code` matches the company-active material's `external_code` or `pace_code`; ambiguous → ERROR; not found → UNMAPPED (WARNING).
- `normalized_kg` is computed by the server; any client value is ignored.

ERROR codes: `HISTORY_SOURCE_ROW_REQUIRED`, `HISTORY_PO_NUMBER_REQUIRED`, `HISTORY_PO_DUPLICATE_IN_BATCH`, `HISTORY_DATE_INVALID`, `HISTORY_NUMBER_INVALID`, `HISTORY_SUPPLY_TYPE_INVALID`, `HISTORY_BOOLEAN_INVALID`, `HISTORY_RAW_ID_NOT_ACCEPTED`, `HISTORY_VENDOR_NOT_FOUND`, `HISTORY_LINE_IDENTITY_REQUIRED`, `HISTORY_LINE_DUPLICATE_IN_BATCH`, `HISTORY_PO_HEADER_UNRESOLVED`, `HISTORY_MATERIAL_AMBIGUOUS`, `HISTORY_SOURCE_RECORD_KEY_REQUIRED`, `HISTORY_MOVEMENT_DUPLICATE_IN_BATCH`, `HISTORY_PO_LINE_UNRESOLVED`.
WARNING codes: `HISTORY_VENDOR_UNMAPPED`, `HISTORY_MATERIAL_UNMAPPED`, `HISTORY_UOM_CONVERSION_MISSING`.

## 3. Reads / reconciliation

- `GET /api/procurement/mts-plan/actuals?company_id=&months=2026-08-01,2026-09-01,2026-10-01`
  → `rows[]` (month, material, identity_level SKU|PRODSHADE, production_kg / dispatch_kg, source HISTORICAL|ERP_LIVE), `coverage { PRODUCTION[], DISPATCH[] }` (covered month without a value = 0, uncovered = blank), `warnings[]`.
- `GET /api/procurement/historical/lead-times?company_id=&group_by=COMPANY|VENDOR|MATERIAL`
  → labelled groups, split LOCAL/DOMESTIC vs IMPORT, with sample count, average, median, p80, p90, variability.
- Reconciliation per batch: `erp_history.import_batch` (`submitted_row_count`, `imported_row_count`, `exception_row_count`, `normalized_kg_total`, `reconciliation` summary) and `erp_history.import_exception` (open while `resolved_at IS NULL`).
