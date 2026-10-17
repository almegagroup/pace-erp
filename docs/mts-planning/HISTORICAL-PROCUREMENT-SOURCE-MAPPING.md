# Historical Procurement Source Mapping

Source workbook: **ALMEGA - Supply Chain File**
(`1tUoPMEOglPkY7nHvMTtvR-27YCCxM0THYXnc7dbgkEA`), inspected again 2026-10-16.
The workbook timezone is Asia/Calcutta.

## Approved source tabs

| Workbook tab | History target | Source values retained |
| --- | --- | --- |
| `PO_SHEET` | `erp_history.purchase_order`, `purchase_order_line` | Order/revised order number, order date, supplier, item, quantity/unit, supply type, schedule ETA/ETD, payment terms/days, rate/currency, source row. |
| `MVT_TRACKER` | `erp_history.consignment_movement` | PO line/order reference, dispatch quantity, ETD/ATD, BL/invoice/BOE/LR/inward/MDN dates and numbers, actual movement status, source row. |
| `Product_Data_Base` | `erp_history.product_reference_snapshot` | Supplier, item/category/type, area/unit, supply type, prefix and lead-time defaults, extraction timestamp and full source payload. It is an **undated/current reference snapshot**, not a transaction fact or proven historic commercial term. |

`MOVEMENT_TRACKER` is a hidden derived/query view and must **not** be imported:
it would duplicate `MVT_TRACKER` movement facts.

## Mapping and validation rules

- Extractors submit `external_sku` as text. Leading zeroes are never converted
  through a spreadsheet number.
- A material/vendor is mapped only with a unique verified ERP match. No match
  or multiple matches becomes an `erp_history.import_exception`, with original
  source values preserved.
- One PO header may have many imported PO lines; one line may have many
  consignment movements. Invoice or BL number alone is never used as a unique
  movement key.
- `Dispatch Date`, `ATD`, `ATA`, `BOE`, `LR`, and `Inward Date` are distinct
  source fields. Scheduled ETA is never promoted to actual arrival.
- Procurement has a separate analytical period: PO order dates and actual movement event dates are each evaluated against **2024-09-01 through 2026-08-31 inclusive**. A parent PO/header/line needed by an in-window movement is retained even if its order date is older, labelled `dependency_outside_window`; it is not silently dropped. Production and FG dispatch actuals retain their separate 2026-09-30/2026-10-01 cutover.
- An actual movement event is chosen only from Inward, LR, BOE, actual port arrival, ATD or dispatch date (in that reconciliation priority). Scheduled ETA/ETD stays distinct and is never substituted as an actual event. Missing/ambiguous event dates are reviewable exceptions.
- The workbook's `UNIT`/`AREA` are source organisation fields, not proof of an ERP company. The importing user selects CMP003, CMP005 or CMP011 explicitly; the extractor must preserve the original source values and must not infer company ownership.
- `Revised Order Number` is retained alongside `Order Number`; neither is guessed from the other. `Payment Days`, payment terms, UOM and conversion values are source facts only when supplied. Missing/ambiguous values are exceptions, not defaults.
- Procurement events are reconciled with live ERP PO/CSN only by verified exact identities. Live records take precedence when the same activity exists in both; history never contributes to open supply, in-transit, stock or current commitments. Historical cancelled rows remain traceable but are excluded from valid movement and lead-time totals.
- Browser code never reads Google Sheets. An authorised server-side extractor
  sends a reviewed JSON payload through the historical import API; the actual
  backfill remains separately authorised.

## Verified source column mapping

| Source tab | Source columns inspected | JSON import fields / handling |
| --- | --- | --- |
| `PO_SHEET` | `Order Number`, `Revised Order Number`, `Order Date`, `SUPPLIER`, `ITEM`, `Order Quantity`, `Order Unit`, `Supply Type`, `Rate`, `Cur.`, `Payment Days`, `Payment Terms`, `Payment Type`, `PO STATUS`, scheduled ETA/ETD | Header: `external_po_number`, `revised_po_number`, `order_date`, `supplier_name`, `vendor_code` only when a verified source code exists, `supply_type`, `payment_terms`, `payment_days`, `currency_code`, `original_status`, `cancellation_flag`. Line: stable source line reference, `material_code` only when verified, `item_description`, `original_quantity`, `original_uom`, `unit_rate`. Schedules are retained only in source lineage; not used as actual movements. |
| `MVT_TRACKER` | `ORDER`, `Line Item`, `Order Date`, `SUPPLIER`, `ITEM`, `Dispatch Quantity`, `Order Unit`, `Import/Local ATD`, `BL NUMBER/DATE`, `INVOICE NUMBER/DATE`, `IMPORT ETA/ATA`, `BOE DATE/NUMBER`, `LR DATE/NUMBER`, `INWARD DATE`, `MDN NUMBER`, payment fields, source references | `source_record_key` must be extractor-stable (not invoice/BL alone), parent PO/line reference, source quantity/UOM, plus separately preserved dispatch, ETD, ATD, ETA, actual port arrival, BOE, LR, inward, invoice/BL/MDN data and cancellation state. One PO line may yield many movement rows. |
| `Product_Data_Base` | `Suppliers`, `Area`, `Unit`, `Item Name`, `CATEGORY`, `TYPE`, `Supply Type`, `Prefix`, `Vessel Booking`, `Sail Time`, `Clearance`, `Transporter Arrangement`, `KP`, `OP`, `ETA/ETD` | `product_reference_snapshots[]` with `source_row_number`, stable `source_record_key`, supplier/item/category/type/UOM/supply/prefix and `source_lead_time_defaults`, plus mandatory `source_extracted_at`. No default is represented as a historic PO term or actual date. |

The hidden `MOVEMENT_TRACKER` remains excluded even if an extractor can read it.
